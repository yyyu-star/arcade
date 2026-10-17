/**
 * 机器人模拟（DESIGN.md 第 8 节）：node tools/sim.ts [--n 局数] [--diff easy,normal,hard] [--skill novice,normal] [--build sword,talisman,ward,wood,fire] [--map snow|yizhuang] [--threads N]
 *
 * 每个组合跑 N 局（种子 1..N），报：胜率（撑到天亮）± 2 倍标准误、平均撑了多久、打倒尸王的比例、
 * 节奏指标（第一次升级、3 分钟 / 5 分钟内升级次数、全局升级次数、7:30 以后每分钟升级次数，DESIGN.md 13.3）、击杀、一局耗时。
 * 多线程：每个线程跑一部分种子，结果按种子顺序合并，和线程数无关。
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
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

interface Cell {
  diff: Difficulty;
  skill: Skill;
  build: Build;
}

/** 发给工作线程的一小段活：某一格的几个种子（小块 + 全局队列，快慢局自动均衡，格与格之间不用等） */
interface Task {
  id: number;
  cell: Cell;
  map: MapId;
  seeds: number[];
}

if (!isMainThread) {
  // 常驻工作线程：每个进程只启动一次（导入核心和内容表要几百毫秒），一直接活到被关掉
  parentPort!.on('message', (t: Task) => {
    parentPort!.postMessage({ id: t.id, rs: t.seeds.map((s) => runOne(s, t.cell.diff, t.cell.skill, t.cell.build, t.map)) });
  });
} else if (process.argv[1]?.endsWith('sim.ts')) {
  const arg = (name: string, def: string): string => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1]! : def;
  };
  const n = Number(arg('--n', '200'));
  const diffs = arg('--diff', 'easy,normal,hard').split(',') as Difficulty[];
  const skills = arg('--skill', 'novice,normal').split(',') as Skill[];
  const builds = arg('--build', 'sword').split(',') as Build[];
  const threads = Math.max(1, Number(arg('--threads', String(availableParallelism()))));
  const chunk = Math.max(1, Number(arg('--chunk', '4')));
  const map = arg('--map', 'snow') as MapId;

  const cells: Cell[] = [];
  for (const diff of diffs) for (const skill of skills) for (const build of skill === 'novice' ? builds.slice(0, 1) : builds) cells.push({ diff, skill, build });

  // 任务按格子顺序排队；结果按种子填回，和线程数、分块无关
  const results: RunResult[][] = cells.map(() => new Array<RunResult>(n));
  const pending: number[] = cells.map(() => n);
  const tasks: Task[] = [];
  let tid = 0;
  const owner: { cell: number; from: number }[] = [];
  cells.forEach((cell, ci) => {
    for (let from = 0; from < n; from += chunk) {
      const seeds: number[] = [];
      for (let s = from; s < Math.min(n, from + chunk); s++) seeds.push(s + 1);
      owner.push({ cell: ci, from });
      tasks.push({ id: tid++, cell, map, seeds });
    }
  });

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const se2 = (p: number, m: number): number => 2 * Math.sqrt((p * (1 - p)) / Math.max(1, m));
  console.log(`${map === 'snow' ? '雪原' : '义庄'}，每格 ${n} 局，${threads} 线程`);
  console.log('难度 | 玩家 | 流派 | 胜率 ±2SE | 打倒尸王 | 平均撑 | 第一次升级 | 3 分钟升级 | 5 分钟升级 | 全局升级 | 后半段每分钟 | 击杀 | 精英');
  const lines: string[] = [];
  let printed = 0;
  let tPrev = Date.now();
  const flush = (): void => {
    while (printed < cells.length && pending[printed] === 0) {
      const { diff, skill, build } = cells[printed]!;
      const rs = results[printed]!;
      const win = mean(rs.map((r) => (r.won ? 1 : 0)));
      const now = Date.now();
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
  console.log(`共 ${total} 局，${((Date.now() - t0) / 1000).toFixed(1)} 秒，${(total / ((Date.now() - t0) / 1000)).toFixed(2)} 局/秒`);
}
