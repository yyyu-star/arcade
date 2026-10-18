/**
 * 机器人模拟（DESIGN.md 第 8 节）：node tools/sim.ts [--n 局数] [--danger 0,2,4 | --diff easy,normal,hard] [--skill novice,normal] [--build sword,talisman,ward,wood,fire] [--map snow|yizhuang] [--char xiaodao|fushi|jianxia|pang|gengfu|caiyao] [--threads N] [--json 文件] [--from 偏移]
 * --json：把每局的结局（赢没赢、打没打倒尸王、撑了几拍）按格存下来，第 7 步离线调实盘倍数曲线用（曲线不影响对局，改曲线不用重跑）。
 *
 * --from：种子从 from+1 起（默认 0），把一格拆成几片分到不同机器上跑，再用 tools/sim-merge.ts 拼表。
 *
 * 每个组合跑 N 局（种子 from+1..from+N），报：胜率（撑到天亮）± 2 倍标准误、平均撑了多久、打倒尸王的比例、
 * 节奏指标（第一次升级、3 分钟 / 5 分钟内升级次数、全局升级次数、7:30 以后每分钟升级次数，DESIGN.md 13.3）、击杀、一局耗时。
 * 多线程：每个线程跑一部分种子，结果按种子顺序合并，和线程数无关。
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { createWorld, step, Ev } from '../src/core/index.ts';
import { writeFileSync } from 'node:fs';
import { DIFFICULTIES, type Danger } from '../src/content/waves.ts';
import { tierOfDanger, vigilBp } from '../src/content/live.ts';
import type { MapId } from '../src/content/maps.ts';
import type { CharacterId } from '../src/content/meta.ts';
import { Bot, type Build, type Skill } from './bots.ts';
import { RaidBot } from '../src/explore/bot.ts';
import { settleRaid } from '../src/explore/settle.ts';
import type { RaidTemplateId } from '../src/content/explore.ts';
import { MERGES } from '../src/content/weapons.ts';

export interface RunResult {
  won: boolean;
  boss: boolean;
  seconds: number;
  firstLevel: number;
  levels3: number;
  levels5: number;
  levels: number;
  /** 7:30 以后每分钟升几级 */
  late: number;
  kills: number;
  elites: number;
  /** 撑了几拍（实盘倍数按它算） */
  ticks: number;
  /** 夜探：撤出时背包的价值（没撤出是 0）；守夜是 0 */
  value: number;
  /** 合成了几件双修（1.1 验收：普通机器人每 20 局至少 5 次） */
  duals: number;
  /** 第一次合成双修是第几拍（没合成 -1）：比"合成那一刻还活着的局"的胜率用 */
  dualTick: number;
  /** 输了的局最后一下是谁打的（怪的编号；远程弹 1000 + 弹种；赢了或不明 -1） */
  killer: number;
}
const dualsOf = (w: { merges: readonly string[] }): number => w.merges.filter((id) => MERGES.find((m) => m.id === id)?.dual).length;

/** 夜探的玩家模型：小白门一开就走；普通搜到 10 分钟再走；贪心搜到 13 分钟（DESIGN.md 2.3、4.2） */
export const RAID_LEAVE: Record<string, number> = { novice: 0, normal: 600 * 30, greedy: 780 * 30 };

/** 夜探一局：RaidBot 指路（去哪），守夜的机器人躲怪、选卡；返回结局和带出价值 */
export function runRaid(seed: number, danger: Danger, who: string, build: Build, template: RaidTemplateId): RunResult {
  const w = createWorld({ seed, mode: 'raid', danger, raid: { template } });
  const bot = new Bot(who === 'novice' ? 'novice' : 'normal', build, seed);
  const leave = RAID_LEAVE[who] ?? 0;
  const guide = new RaidBot(w.raid!, leave);
  let guard = 0;
  while (w.phase !== 'over' && guard++ < 200_000) {
    if (w.phase !== 'choose') {
      const d = guide.dir(w.x, w.y, w.tick, w.coins);
      bot.goal = d === 0 ? -1 : d;
      bot.detour = !(w.raid!.gateMask !== 0 && w.tick >= leave);
    }
    const a = bot.act(w);
    step(w, a.dir, a.choice);
  }
  const won = w.raid!.outcome === 'escaped';
  return { won, boss: false, seconds: w.tick / 30, firstLevel: 0, levels3: 0, levels5: 0, levels: w.level - 1, late: 0, kills: w.kills, elites: 0, ticks: w.tick, value: won ? settleRaid(w.raid!, 0).value : 0, duals: dualsOf(w), dualTick: -1, killer: won ? -1 : w.hurtBy };
}

export function runOne(seed: number, danger: Danger, skill: Skill, build: Build, map: MapId = 'snow', character: CharacterId = 'xiaodao', noDual = false): RunResult {
  const w = createWorld({ seed, mode: 'vigil', danger, map, character, ...(noDual ? { noDual } : {}) });
  const bot = new Bot(skill, build, seed);
  let firstLevel = -1;
  let levels3 = 0;
  let levels5 = 0;
  let elites = 0;
  let late = 0;
  let dualTick = -1;
  let guard = 0;
  while (w.phase !== 'over' && guard++ < 200_000) {
    const a = bot.act(w);
    step(w, a.dir, a.choice);
    const ev = w.ev;
    for (let i = 0; i < ev.n; i++) {
      const t = ev.type[i];
      if (t === Ev.LevelUp) {
        if (firstLevel < 0) firstLevel = w.tick / 30;
        if (w.tick <= 30 * 180) levels3++;
        if (w.tick <= 30 * 300) levels5++;
        if (w.tick > 30 * 450) late++;
      } else if (t === Ev.Kill && ev.b[i] === 1) elites++;
      else if (t === Ev.Merge && dualTick < 0 && MERGES[ev.a[i]!]?.dual) dualTick = w.tick;
    }
  }
  return { won: w.won, boss: w.bossKilled, seconds: w.tick / 30, firstLevel, levels3, levels5, levels: w.level - 1, late: late / Math.max(1, (w.tick - 30 * 450) / 1800), kills: w.kills, elites, ticks: w.tick, value: 0, duals: dualsOf(w), dualTick, killer: w.won ? -1 : w.hurtBy };
}

interface Cell {
  diff: Danger;
  /** 守夜：novice / normal；夜探另有 greedy（见 RAID_LEAVE） */
  skill: string;
  build: Build;
}

/** 发给工作线程的一小段活：某一格的几个种子（小块 + 全局队列，快慢局自动均衡，格与格之间不用等） */
interface Task {
  id: number;
  cell: Cell;
  /** 守夜的地图，或夜探的镇子模板（raid 为真时） */
  map: string;
  raid: boolean;
  /** 守夜的出战角色（--char） */
  char: CharacterId;
  /** --nodual：双修对照臂（条件满足也不合） */
  noDual: boolean;
  seeds: number[];
}

if (!isMainThread) {
  // 常驻工作线程：每个进程只启动一次（导入核心和内容表要几百毫秒），一直接活到被关掉
  parentPort!.on('message', (t: Task) => {
    parentPort!.postMessage({ id: t.id, rs: t.seeds.map((s) => (t.raid ? runRaid(s, t.cell.diff, t.cell.skill, t.cell.build, t.map as RaidTemplateId) : runOne(s, t.cell.diff, t.cell.skill as Skill, t.cell.build, t.map as MapId, t.char, t.noDual))) });
  });
} else if (process.argv[1]?.endsWith('sim.ts')) {
  const arg = (name: string, def: string): string => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1]! : def;
  };
  const n = Number(arg('--n', '200'));
  const seedFrom = Number(arg('--from', '0'));
  // --danger 0–5；老的 --diff easy,normal,hard 照认（危险 0 / 2 / 4）
  const diffs: Danger[] = process.argv.includes('--danger')
    ? arg('--danger', '2').split(',').map((d) => Number(d) as Danger)
    : arg('--diff', 'easy,normal,hard').split(',').map((d) => DIFFICULTIES[d as keyof typeof DIFFICULTIES].danger);
  const jsonOut = arg('--json', '');
  // --mode raid：夜探（--map 是镇子模板，--skill 可以带 greedy）；默认守夜
  const raid = arg('--mode', 'vigil') === 'raid';
  const skills = arg('--skill', raid ? 'novice,normal,greedy' : 'novice,normal').split(',');
  const builds = arg('--build', 'sword').split(',') as Build[];
  const threads = Math.max(1, Number(arg('--threads', String(availableParallelism()))));
  const chunk = Math.max(1, Number(arg('--chunk', '4')));
  const maps = arg('--map', raid ? 'guzhen,dukou,shansi' : 'snow').split(',');
  const map = maps[0]!;
  const char = arg('--char', 'xiaodao') as CharacterId;
  // 双修对照臂：同一批种子再跑一遍、双修条件满足也不合，和正常臂按种子配对比净强度（1.1 双修验收，主线 10-18）
  const noDual = process.argv.includes('--nodual');

  const cells: (Cell & { map: string })[] = [];
  for (const m of raid ? maps : [map])
    for (const diff of diffs) for (const skill of skills) for (const build of skill === 'novice' ? builds.slice(0, 1) : builds) cells.push({ diff, skill, build, map: m });

  // 任务按格子顺序排队；结果按种子填回，和线程数、分块无关
  const results: RunResult[][] = cells.map(() => new Array<RunResult>(n));
  const pending: number[] = cells.map(() => n);
  const tasks: Task[] = [];
  let tid = 0;
  const owner: { cell: number; from: number }[] = [];
  cells.forEach((cell, ci) => {
    for (let from = 0; from < n; from += chunk) {
      const seeds: number[] = [];
      for (let s = from; s < Math.min(n, from + chunk); s++) seeds.push(seedFrom + s + 1);
      owner.push({ cell: ci, from });
      tasks.push({ id: tid++, cell, map: cell.map, raid, char, noDual, seeds });
    }
  });

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  /** 按现在的倍数曲线：每局结回 − 1 份的均值 ± 2SE（实盘只有危险 0/2/3/4，别的档出 -） */
  const ev = (rs: RunResult[], diff: Danger): string => {
    const tier = tierOfDanger(diff);
    if (!tier) return '-';
    const xs = rs.map((r) => vigilBp(tier, r.ticks, r.won, r.boss) / 10_000 - 1);
    const m = mean(xs);
    const sd = Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
    return `${m >= 0 ? '+' : ''}${m.toFixed(2)} ±${((2 * sd) / Math.sqrt(Math.max(1, xs.length))).toFixed(2)}`;
  };
  const se2 = (p: number, m: number): number => 2 * Math.sqrt((p * (1 - p)) / Math.max(1, m));
  console.log(`${raid ? '夜探' : map === 'snow' ? '雪原' : '义庄'}，每格 ${n} 局（种子 ${seedFrom + 1}..${seedFrom + n}），${threads} 线程`);
  console.log(
    raid
      ? '镇子 | 危险 | 玩家 | 流派 | 撤出 ±2SE | 带出价值（撤出的局） | 平均待了 | 击杀'
      : '危险 | 玩家 | 流派 | 胜率 ±2SE | 打倒尸王 | 平均撑 | 第一次升级 | 3 分钟升级 | 5 分钟升级 | 全局升级 | 后半段每分钟 | 击杀 | 精英 | 实盘期望 ±2SE（份）',
  );
  const lines: string[] = [];
  let printed = 0;
  let tPrev = Date.now();
  const flush = (): void => {
    while (printed < cells.length && pending[printed] === 0) {
      const { diff, skill, build } = cells[printed]!;
      const rs = results[printed]!;
      const win = mean(rs.map((r) => (r.won ? 1 : 0)));
      const now = Date.now();
      if (raid) {
        lines.push(
          [cells[printed]!.map, diff, skill, skill === 'novice' ? '-' : build, `${(win * 100).toFixed(0)}% ±${(se2(win, n) * 100).toFixed(0)}`, mean(rs.filter((r) => r.won).map((r) => r.value)).toFixed(0), `${(mean(rs.map((r) => r.seconds)) / 60).toFixed(1)} 分`, mean(rs.map((r) => r.kills)).toFixed(0)].join(' | ') +
            `   (${((now - tPrev) / 1000).toFixed(1)} s)`,
        );
        console.log(lines[lines.length - 1]);
        tPrev = now;
        printed++;
        continue;
      }
      lines.push(
        [
          diff,
          skill,
          skill === 'novice' ? '-' : build,
          `${(win * 100).toFixed(0)}% ±${(se2(win, n) * 100).toFixed(0)}`,
          `${(mean(rs.map((r) => (r.boss ? 1 : 0))) * 100).toFixed(0)}%`,
          `${(mean(rs.map((r) => r.seconds)) / 60).toFixed(1)} 分`,
          `${mean(rs.map((r) => r.firstLevel)).toFixed(1)} 秒`,
          mean(rs.map((r) => r.levels3)).toFixed(1),
          mean(rs.map((r) => r.levels5)).toFixed(1),
          mean(rs.map((r) => r.levels)).toFixed(1),
          mean(rs.filter((r) => r.seconds > 600).map((r) => r.late)).toFixed(2),
          mean(rs.map((r) => r.kills)).toFixed(0),
          mean(rs.map((r) => r.elites)).toFixed(1),
          ev(rs, diff),
        ].join(' | ') + `   (${((now - tPrev) / 1000).toFixed(1)} s)`,
      );
      console.log(lines[lines.length - 1]);
      tPrev = now;
      printed++;
    }
  };
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    let next = 0;
    let doneTasks = 0;
    const pool: Worker[] = [];
    const feed = (wk: Worker): void => {
      if (next < tasks.length) wk.postMessage(tasks[next++]);
    };
    for (let k = 0; k < Math.min(threads, tasks.length); k++) {
      const wk = new Worker(new URL(import.meta.url));
      pool.push(wk);
      wk.on('error', reject);
      wk.on('message', (m: { id: number; rs: RunResult[] }) => {
        const o = owner[m.id]!;
        m.rs.forEach((r, j) => (results[o.cell]![o.from + j] = r));
        pending[o.cell]! -= m.rs.length;
        flush();
        if (++doneTasks === tasks.length) {
          for (const x of pool) void x.terminate();
          resolve();
        } else feed(wk);
      });
      feed(wk);
    }
    if (!tasks.length) resolve();
  });
  const total = cells.length * n;
  if (jsonOut) {
    // 守夜每局 [赢没赢, 打没打倒尸王, 撑了几拍, 双修几件, 第一次双修的拍, 死因]；夜探每局 [撤没撤出, 带出价值, 待了几拍, 双修几件, -1, 死因]（mode 字段区分）
    writeFileSync(
      jsonOut,
      JSON.stringify(cells.map((c, i) => ({ ...c, mode: raid ? 'raid' : 'vigil', ...(noDual ? { noDual } : {}), from: seedFrom, runs: results[i]!.map((r) => [r.won ? 1 : 0, raid ? r.value : r.boss ? 1 : 0, r.ticks, r.duals, r.dualTick, r.killer]) }))),
    );
    console.log(`每局结局写到 ${jsonOut}`);
  }
  console.log(`共 ${total} 局，${((Date.now() - t0) / 1000).toFixed(1)} 秒，${(total / ((Date.now() - t0) / 1000)).toFixed(2)} 局/秒`);
}
