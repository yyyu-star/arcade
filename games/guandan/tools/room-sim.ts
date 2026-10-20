/**
 * 联机规则层大批量对打（不经 Durable Object）：照房间驱动规则的方式（turn → ai / timeout → parse(JSON 往返) → apply）打完整局，
 * 统计零错误、零卡死、每局步数和"真人消息数"，给额度估算用（真的房间在 tests/room/ 里用 workerd 跑）。
 *
 *   node tools/room-sim.ts                          默认 3000 局，每步 10% 超时代出，按 CPU 核数并行
 *   node tools/room-sim.ts --games 5000 --timeout 0.2 --threads 8 --seed sim
 *
 * 真人消息数（入站 act）分两种桌算：
 * - 4 真人：除了超时代出的步，每一步都是一条入站 act（含每副结束头游点的"下一副"）；
 * - 1 真人 + 3 电脑：只数 0 号座位不是超时的步（电脑在房间里出，不算入站）。
 * 另外记每步规则 + 电脑的耗时（房间一次批量算电脑时 CPU 花在这里）。
 */
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { testKey, guandanRoom as R, type NetState } from '../src/variants/guandan/net/rules.ts';

interface Job {
  from: number;
  to: number;
  seed: string;
  timeoutRate: number;
}

interface GameStat {
  steps: number;
  deals: number;
  timeouts: number;
  in4: number;
  /** 4 真人桌里发得最多的那一家 */
  in4max: number;
  in1: number;
  /** 每步 ai/timeout + parse + apply 的耗时（毫秒）里最大的一步 */
  maxStepMs: number;
  /** 1 真人 + 3 电脑时，房间一次连续算电脑的最长批次（步数）和这一批的耗时 */
  maxBatch: number;
  maxBatchMs: number;
  totalMs: number;
}

interface Result {
  stats: GameStat[];
  errors: string[];
  stuck: string[];
  /** 每步耗时的抽样（每 5 步取 1） */
  stepMs: number[];
}

/** 字符串 → 32 位种子（确定性，和房间用 crypto 生成的种子一样是 uint32） */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 决定这一步是超时代出还是正常出（确定性：按种子和步数） */
function isTimeout(seed: number, i: number, rate: number): boolean {
  return hash32(`${seed}|t|${i}`) / 2 ** 32 < rate;
}

function playOne(seed: number, timeoutRate: number, errors: string[], stuck: string[], stepMs: number[]): GameStat | null {
  let s: NetState = R.begin(testKey(seed), R.rulesVersion);
  const bySeat = [0, 0, 0, 0];
  const st: GameStat = { steps: 0, deals: 1, timeouts: 0, in4: 0, in4max: 0, in1: 0, maxStepMs: 0, maxBatch: 0, maxBatchMs: 0, totalMs: 0 };
  let batch = 0;
  let batchMs = 0;
  const t0 = performance.now();
  for (let i = 0; !R.over(s); i++) {
    if (i > 20_000) {
      stuck.push(`seed ${seed}: 2 万步还没打完`);
      return null;
    }
    const seat = R.turn(s);
    if (seat === null) {
      stuck.push(`seed ${seed} 第 ${i} 步：没结束但不等任何人`);
      return null;
    }
    const to = isTimeout(seed, i, timeoutRate);
    const a0 = performance.now();
    const a = to ? R.timeout!(s, seat) : R.ai(s, seat);
    const parsed = R.parse(JSON.parse(JSON.stringify(a)));
    if (!parsed) {
      errors.push(`seed ${seed} 第 ${i} 步：parse 拒绝了 ${JSON.stringify(a)}`);
      return null;
    }
    const next = R.apply(s, seat, parsed);
    const ms = performance.now() - a0;
    if ('error' in next) {
      errors.push(`seed ${seed} 第 ${i} 步 ${JSON.stringify(a)}：${next.error}`);
      return null;
    }
    // 进入结算那一步才算一副（结算里每个人点继续又是一步）
    if (next.g.phase === 'dealEnd' && s.g.phase !== 'dealEnd') st.deals++;
    s = next;
    st.steps++;
    if (to) st.timeouts++;
    else {
      st.in4++;
      bySeat[seat]!++;
      st.in4max = Math.max(st.in4max, bySeat[seat]!);
      if (seat === 0) st.in1++;
    }
    st.maxStepMs = Math.max(st.maxStepMs, ms);
    if (i % 5 === 0) stepMs.push(ms);
    // 1 真人 + 3 电脑：0 号座位以外（含超时的 0 号）连续的步就是房间一次批量算的
    if (seat !== 0 || to) {
      batch++;
      batchMs += ms;
      if (batch > st.maxBatch) [st.maxBatch, st.maxBatchMs] = [batch, batchMs];
    } else {
      batch = 0;
      batchMs = 0;
    }
  }
  st.totalMs = performance.now() - t0;
  return st;
}

function run(job: Job): Result {
  const out: Result = { stats: [], errors: [], stuck: [], stepMs: [] };
  for (let g = job.from; g < job.to; g++) {
    const st = playOne(hash32(`${job.seed}|${g}`), job.timeoutRate, out.errors, out.stuck, out.stepMs);
    if (st) out.stats.push(st);
  }
  return out;
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
}

export function dist(xs: number[]): string {
  if (!xs.length) return '（无）';
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  return `min ${f(pct(xs, 0))} / 中位 ${f(pct(xs, 50))} / 均值 ${f(mean)} / p99 ${f(pct(xs, 99))} / max ${f(pct(xs, 100))}`;
}

function arg(name: string, def: string): string {
  const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : def;
}

if (!isMainThread) {
  parentPort!.postMessage(run(workerData as Job));
} else {
  const games = Number(arg('games', '3000'));
  const timeoutRate = Number(arg('timeout', '0.1'));
  const seed = arg('seed', 'room-sim');
  const threads = Math.max(1, Math.min(Number(arg('threads', String(availableParallelism()))), games));
  const t0 = performance.now();
  const per = Math.ceil(games / threads);
  const parts = await Promise.all(
    Array.from({ length: threads }, (_, k) => {
      const job: Job = { from: k * per, to: Math.min(games, (k + 1) * per), seed, timeoutRate };
      return new Promise<Result>((ok, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: job });
        w.once('message', (r: unknown) => ok(r as Result));
        w.once('error', fail);
      });
    }),
  );
  const stats = parts.flatMap((p) => p.stats);
  const errors = parts.flatMap((p) => p.errors);
  const stuck = parts.flatMap((p) => p.stuck);
  const stepMs = parts.flatMap((p) => p.stepMs);
  const sec = (performance.now() - t0) / 1000;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const lines = [
    `联机规则层对打：${games} 局（打完 ${stats.length}），超时代出比例 ${timeoutRate}，${threads} 线程，用时 ${sec.toFixed(1)} 秒`,
    `规则错误 ${errors.length}，卡死 ${stuck.length}`,
    `每局步数：${dist(stats.map((s) => s.steps))}（共 ${sum(stats.map((s) => s.steps))} 步）`,
    `每局副数：${dist(stats.map((s) => s.deals))}`,
    `每局超时代出：${dist(stats.map((s) => s.timeouts))}`,
    `入站 act（4 真人）：${dist(stats.map((s) => s.in4))}`,
    `入站 act（1 真人 + 3 电脑）：${dist(stats.map((s) => s.in1))}`,
    // 房间一生的入站上限（worker/room.ts：maxInbound 8000，一个人最多四成 3200）还要算上 4 次入座、1 次开局，以及掉线回来的次数
    `4 真人桌入站超过 7995 条（会碰到房间的 8000 上限）的局数：${stats.filter((s) => s.in4 > 7995).length}；超过 6000 条：${stats.filter((s) => s.in4 > 6000).length}`,
    `一个人的入站超过 3200 条（房间里一人四成的上限）的局数：1 真人桌 ${stats.filter((s) => s.in1 > 3200).length}，4 真人桌（按最多的那家）${stats.filter((s) => s.in4max > 3200).length}`,
    `按每步平均 3 秒算，超过房间寿命 8 小时（9600 步）的局数：${stats.filter((s) => s.steps > 9600).length}；超过 5 小时（6000 步）：${stats.filter((s) => s.steps > 6000).length}`,
    `每步耗时（ms，抽样 ${stepMs.length}）：${dist(stepMs)}`,
    `每局最慢一步（ms）：${dist(stats.map((s) => s.maxStepMs))}`,
    `1 真人桌最长电脑批次（步）：${dist(stats.map((s) => s.maxBatch))}；这一批耗时（ms）：${dist(stats.map((s) => s.maxBatchMs))}`,
  ];
  console.log(lines.join('\n'));
  for (const e of [...errors, ...stuck].slice(0, 20)) console.log('  ', e);
  if (errors.length || stuck.length) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
