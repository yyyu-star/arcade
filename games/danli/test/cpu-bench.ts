/**
 * 服务器 CPU 预算（DESIGN.md 5.6，硬约束）：免费版每次请求 10 ms CPU，房间每一步要远低于它——开发机上 p99 不超过 3 ms。
 * 在真的 kit 房间里（test/room-harness.ts）量每一步（一个入口：进来、读状态、规则、存一行、给每个人发视图）花的时间：
 * - 真人出手：结算一发真人的 act（爬动序列 + 道具 + 发射）；
 * - 电脑一步：闹钟响了（上一手的动画停够了），kit 调 ai，联机档电脑想一步、结算这一发。
 * 11 张图（0.4.0 加了 5 张，最宽的寿司长台 3600）、3v3（3 个真人对 3 个电脑），各打一整局；两种局面：
 * - 典型：房间一直在内存里；真人按联机档电脑的瞄法出，往前爬几步、上连发或加力；
 * - 最坏：每一步之前房间都被驱逐（从存储那一行重建、按挖过的坑重画地形），真人每手轮流上三岔 + 连发 +1 + 连发 +2（12 颗）和三个 +2（7 轮），能爬就爬。
 * 由 scripts/cpu.ts 用普通 Node 跑（npm run cpu，npm test 的最后一步）：vitest 转译过的模块调函数要多绕一层，量出来慢一倍，
 * 线上 wrangler 把 Worker 打成一个文件、直接调用，和普通 Node 差不多；也不和别的测试抢 CPU。
 */
import { planLite } from '../src/ai/online.ts';
import { loadout, loadoutCost, type Loadout } from '../src/core/items.ts';
import { MAP_IDS, type MapId } from '../src/core/maps.ts';
import { apply } from '../src/core/rules.ts';
import type { Dir, State } from '../src/core/types.ts';
import { startOf, stepRec } from '../src/net/replay.ts';
import { turnAct, type NetAction, type RoomView } from '../src/net/rules.ts';
import { clock, Harness, roomClass, type Peer } from './room-harness.ts';

/**
 * 门槛：开发机 p99 ≤ 3 ms（DESIGN.md 5.6）；有环境变量 CI 时（GitHub 的共享机器，偶尔慢一截）放宽到 8 ms，还在免费版每次请求 10 ms 以内
 */
export const BUDGET_MS = process.env.CI ? 8 : 3;
export const BUDGET_NOTE = process.env.CI ? 'CI 门槛 8 ms（有环境变量 CI；开发机是 3 ms）' : '开发机门槛 3 ms（CI 上放宽到 8 ms）';


function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

function replayView(v: RoomView): State {
  const g = v.game!;
  let s = startOf(g);
  for (const r of g.log) {
    const out = stepRec(s, r, r.w);
    if ('error' in out) throw new Error(out.error);
    s = out.state;
  }
  return s;
}

/** 真人这一手：联机档电脑的瞄法；heavy 时每手都上体力买得起的最重的叠法（三岔 + 连发 +1 + 连发 +2：4 轮 12 颗；或者三个 +2：7 轮），能爬就爬 */
function humanAct(v: RoomView, heavy: boolean, n: number): NetAction {
  const s = replayView(v);
  const p = planLite(s);
  let l: Loadout = p.loadout;
  if (!l.plane) {
    const options: Loadout[] = (
      heavy
        ? [n % 2 ? { p2: 3 } : { fork: 1, p1: 1, p2: 1 }, { fork: 1, p2: 1 }, { p2: 2 }, { fork: 1 }]
        : [n % 3 === 0 ? { p1: 1, b20: 1 } : n % 3 === 1 ? { b50: 1, b20: 1 } : { b20: 1, b10: 1 }]
    ).map((o) => loadout({ ...o, lid: !heavy && l.lid }));
    l = options.find((o) => loadoutCost(o) <= s.stamina) ?? l;
  }
  const keep = loadoutCost(l);
  // 往对手那边爬几步（爬得动、留够道具的体力）
  const moves: Dir[] = [];
  let cur = s;
  const want = heavy ? 50 : n % 4;
  const dir = p.facing;
  while (moves.length < want) {
    const r = apply(cur, { t: 'move', dir });
    if (!r.ok || r.state.stamina < keep) break;
    cur = r.state;
    moves.push(dir);
  }
  return turnAct(moves, p.angle, p.power, p.facing, l);
}

export interface Run {
  human: number[];
  bot: number[];
}

/** 3 个真人（A 房主、B、C）对 3 个电脑打一整局；cold 时每一步之前驱逐房间 */
async function match(map: MapId, cold: boolean, heavy: boolean): Promise<Run> {
  const h = new Harness(await roomClass());
  await h.create('A');
  const a = await h.join('A');
  await h.send(a, { t: 'start' });
  const b = await h.join('B');
  await h.send(b, { t: 'sit', seat: 1 });
  const c = await h.join('C');
  await h.send(c, { t: 'sit', seat: 2 });
  await h.act(a, { t: 'format', n: 3 });
  await h.act(a, { t: 'map', map });
  a.pump();
  // 真人坐成一队，对面三个电脑
  for (const p of [b, c]) {
    a.pump();
    const at = a.view!.slots.findIndex((x) => x?.k === 'human' && x.seat === p.seat);
    const free = [1, 2].find((i) => a.view!.slots[i] === null);
    if (at >= 3 && free !== undefined) await h.act(p, { t: 'sit', slot: free });
  }
  for (let i = 3; i < 6; i++) {
    a.pump();
    if (!a.view!.slots[i]) await h.act(a, { t: 'addbot', slot: i });
  }
  await h.act(b, { t: 'ready', on: true });
  await h.act(c, { t: 'ready', on: true });
  await h.act(a, { t: 'start' });
  const peers: Peer[] = [a, b, c];
  for (const p of peers) {
    p.pump();
    check(p.errors.length === 0, `准备时被拒：${p.errors.join(',')}`);
  }
  check(a.view!.game!.owners.filter((o) => o !== null).length === 3, '不是 3 个真人');
  const out: Run = { human: [], bot: [] };
  let n = 0;
  for (let guard = 0; guard < 600; guard++) {
    for (const p of peers) p.pump();
    if (a.view!.phase !== 'play') break;
    const room = a.room!;
    if (cold) h.evict();
    if (room.pause || !room.turn) {
      const before = a.view!.game!.log.length;
      const t0 = performance.now();
      await h.alarm();
      const ms = performance.now() - t0;
      a.pump();
      const g = a.view!.game;
      // 这一次闹钟里电脑出了一手（不只是"停够了、轮到真人"）
      if (g && g.log.length > before) out.bot.push(ms);
      continue;
    }
    const who = peers.find((p) => p.seat === room.turn!.seat)!;
    const act = humanAct(who.view!, heavy, n++);
    const t0 = performance.now();
    await h.act(who, act);
    out.human.push(performance.now() - t0);
    if (who.errors.length) throw new Error(`真人的一手被拒：${who.errors.join(',')} ${JSON.stringify(act)}`);
  }
  check(a.view!.phase === 'result', '没打完');
  check(h.maxWrites <= 2, `有一步写了 ${h.maxWrites} 行`);
  return out;
}

function pct(a: readonly number[], p: number): number {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

const fmt = (a: readonly number[]): string => `${a.length} 步，p50 ${pct(a, 0.5).toFixed(2)} ms，p99 ${pct(a, 0.99).toFixed(2)} ms，最慢 ${Math.max(...a).toFixed(2)} ms`;

export interface Report {
  lines: string[];
  /** 名字（典型 / 最坏）→ 真人、电脑每一步的毫秒数 */
  runs: Record<string, Run>;
}

/** 房间开局的熵、房间码（kit 用 crypto.getRandomValues）换成固定的伪随机：同一局能原样再打一遍 */
function seededCrypto(seed: number): () => void {
  const orig = crypto.getRandomValues.bind(crypto);
  let x = seed >>> 0 || 1;
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
    if (arr instanceof Uint32Array) {
      for (let i = 0; i < arr.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        arr[i] = x >>> 0;
      }
      return arr;
    }
    return orig(arr as never) as T;
  }) as typeof crypto.getRandomValues;
  return () => {
    crypto.getRandomValues = orig;
  };
}

/** 每种局面在每张图上打的那一局 */
const PLAN = [
  ['典型', false, false],
  ['最坏', true, true],
] as const;

/** 同一局打几遍：每一步取最快的那一遍（开发机上别的进程抢 CPU、偶尔一次垃圾回收，墙上的钟会虚高；Workers 按 CPU 时间算） */
export const REPEAT = 3;

/** 11 张图 × 典型、最坏各一局，每局原样打 REPEAT 遍 */
export async function measure(): Promise<Report> {
  clock.install();
  try {
    // 先空跑一局让 JIT 热起来（真房间里同一个 Worker 进程也是一直在跑的）
    await match('kitchen', false, false);
    const lines: string[] = [];
    const runs: Record<string, Run> = {};
    for (const [name, cold, heavy] of PLAN) {
      const sum: Run = { human: [], bot: [] };
      for (const [k, map] of MAP_IDS.entries()) {
        let best: Run | null = null;
        for (let rep = 0; rep < REPEAT; rep++) {
          const undo = seededCrypto(1000 + k * 7 + (cold ? 1 : 0));
          clock.now = 1_800_000_000_000;
          let r: Run;
          try {
            r = await match(map, cold, heavy);
          } finally {
            undo();
          }
          if (!best) best = r;
          else {
            check(best.human.length === r.human.length && best.bot.length === r.bot.length, `${map} 再打一遍步数不一样`);
            best = { human: best.human.map((t, i) => Math.min(t, r.human[i]!)), bot: best.bot.map((t, i) => Math.min(t, r.bot[i]!)) };
          }
        }
        lines.push(`${name} ${map}：真人 ${fmt(best!.human)}；电脑 ${fmt(best!.bot)}`);
        sum.human.push(...best!.human);
        sum.bot.push(...best!.bot);
      }
      lines.push(`${name} 合计：真人 ${fmt(sum.human)}；电脑 ${fmt(sum.bot)}`);
      runs[name] = sum;
    }
    return { lines, runs };
  } finally {
    clock.restore();
  }
}

export { pct };
