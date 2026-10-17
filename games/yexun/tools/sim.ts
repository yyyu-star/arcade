/**
 * 机器人模拟（DESIGN.md 第 8 节）：node tools/sim.ts [--n 局数] [--diff easy,normal,hard] [--skill novice,normal] [--build sword,talisman,ward,wood,fire] [--map snow|yizhuang] [--threads N]
 *
 * 每个组合跑 N 局（种子 1..N），报：胜率（撑到天亮）± 2 倍标准误、平均撑了多久、打倒尸王的比例、
 * 节奏指标（第一次升级、3 分钟 / 5 分钟内升级次数、全局升级次数、7:30 以后每分钟升级次数，DESIGN.md 13.3）、击杀、一局耗时。
 * 多线程：每个线程跑一部分种子，结果按种子顺序合并，和线程数无关。
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createWorld, step, Ev } from '../src/core/index.ts';
import { DIFFICULTIES, type Difficulty } from '../src/content/waves.ts';
import type { MapId } from '../src/content/maps.ts';
import { Bot, type Build, type Skill } from './bots.ts';

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
}

export function runOne(seed: number, diff: Difficulty, skill: Skill, build: Build, map: MapId = 'snow'): RunResult {
  const w = createWorld({ seed, mode: 'vigil', danger: DIFFICULTIES[diff].danger, map });
  const bot = new Bot(skill, build, seed);
  let firstLevel = -1;
  let levels3 = 0;
  let levels5 = 0;
  let elites = 0;
  let late = 0;
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
    }
  }
  return { won: w.won, boss: w.bossKilled, seconds: w.tick / 30, firstLevel, levels3, levels5, levels: w.level - 1, late: late / Math.max(1, (w.tick - 30 * 450) / 1800), kills: w.kills, elites };
}

interface Job {
  seeds: number[];
  diff: Difficulty;
  skill: Skill;
  build: Build;
  map: MapId;
}

if (!isMainThread) {
  const job = workerData as Job;
  parentPort!.postMessage(job.seeds.map((s) => runOne(s, job.diff, job.skill, job.build, job.map)));
} else if (process.argv[1]?.endsWith('sim.ts')) {
  const arg = (name: string, def: string): string => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1]! : def;
  };
  const n = Number(arg('--n', '200'));
  const diffs = arg('--diff', 'easy,normal,hard').split(',') as Difficulty[];
  const skills = arg('--skill', 'novice,normal').split(',') as Skill[];
  const builds = arg('--build', 'sword').split(',') as Build[];
  const threads = Number(arg('--threads', String(Math.max(1, availableParallelism() - 1))));
  const map = arg('--map', 'snow') as MapId;

  const runJob = async (diff: Difficulty, skill: Skill, build: Build): Promise<RunResult[]> => {
    const seeds = Array.from({ length: n }, (_, i) => i + 1);
    const chunks: number[][] = Array.from({ length: Math.min(threads, n) }, () => []);
    seeds.forEach((s, i) => chunks[i % chunks.length]!.push(s));
    const parts = await Promise.all(
      chunks.map(
        (c) =>
          new Promise<RunResult[]>((resolve, reject) => {
            const wk = new Worker(new URL(import.meta.url), { workerData: { seeds: c, diff, skill, build, map } satisfies Job });
            wk.once('message', resolve);
            wk.once('error', reject);
          }),
      ),
    );
    // 按种子顺序合并
    const out: RunResult[] = [];
    for (let i = 0; i < n; i++) out.push(parts[i % parts.length]![Math.floor(i / parts.length)]!);
    return out;
  };

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const se2 = (p: number, m: number): number => 2 * Math.sqrt((p * (1 - p)) / Math.max(1, m));
  console.log(`${map === 'snow' ? '雪原' : '义庄'}，每格 ${n} 局，${threads} 线程`);
  console.log('难度 | 玩家 | 流派 | 胜率 ±2SE | 打倒尸王 | 平均撑 | 第一次升级 | 3 分钟升级 | 5 分钟升级 | 全局升级 | 后半段每分钟 | 击杀 | 精英');
  for (const diff of diffs)
    for (const skill of skills)
      for (const build of skill === 'novice' ? builds.slice(0, 1) : builds) {
        const t0 = Date.now();
        const rs = await runJob(diff, skill, build);
        const win = mean(rs.map((r) => (r.won ? 1 : 0)));
        console.log(
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
          ].join(' | ') + `   (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
        );
      }
}
