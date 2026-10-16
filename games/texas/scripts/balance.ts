/**
 * 配平（docs/balance.md，DESIGN.md 4.10，0.12.0）：小白（novice）、普通（simple）两个确定性玩家各打很多场，量
 * - 实盘：每档每场的输赢（份，均值 ± 2 倍标准误）、赢的场次、输光的场次、一场多久；
 * - 娱乐：新手、普通、高手三档里"赢"的场次（打完一场筹码比上桌多）。
 * 一场 = 带一份上桌、打 HANDS 手或输光为止，不补码（test/bots.ts 的 runSession）；6 人桌（大厅默认）。
 *
 * npm run sim -- --balance [每格场数，默认 2000] [--hands=手数] [--size=人数] [--fun=新手,普通,高手的强弱档] [--real=小,中,大,豪华的强弱档]
 * 后两个参数调参用：不给就按 stakes.ts 的 SOLO_LEVEL、FUN_LEVEL。
 */
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { FUN_LEVEL, FUN_STAKES, LEVELS, SESSION_HANDS, SOLO_LEVEL, STAKES, type Difficulty, type StakesId } from '../src/core/stakes.ts';
import { runSession } from '../test/bots.ts';
import { STRATEGIES } from '../test/strategies.ts';

type Job = { stakes: StakesId; level: number; strategy: string; size: number; hands: number; from: number; to: number };
type Row = [result: number, hands: number, mine: number, theirs: number];

/** 第 k 场的种子：档位、玩家都不进种子，同一个 k 各格发的牌一样（配对比较） */
const seedOf = (k: number): number[] => [k, 0xba1a, 3, 4, 5, 6, 7, 8];

function work(j: Job): Row[] {
  const rows: Row[] = [];
  for (let k = j.from; k < j.to; k++) {
    const r = runSession({ seed: seedOf(k), stakes: j.stakes, size: j.size, hands: j.hands, strategy: STRATEGIES[j.strategy]!, level: j.level });
    rows.push([r.result, r.hands, r.mine, r.theirs]);
  }
  return rows;
}

if (!isMainThread) parentPort!.postMessage(work(workerData as Job));

const THREADS = Math.max(1, availableParallelism() - 2);

function fanout(n: number, job: (from: number, to: number) => Job): Promise<Row[]> {
  const chunk = Math.ceil(n / THREADS);
  const jobs: Promise<Row[]>[] = [];
  for (let from = 0; from < n; from += chunk)
    jobs.push(
      new Promise((ok, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: job(from, Math.min(n, from + chunk)) });
        w.once('message', ok);
        w.once('error', fail);
      }),
    );
  return Promise.all(jobs).then((x) => x.flat());
}

/**
 * 一场多久（分钟，真人速度）：每手固定 8 秒（发牌约 2.5 秒、收注翻牌约 2 秒、看结果和发下一手约 3.5 秒），
 * 电脑每次说话约 1.2 秒（main.ts 的 think，加上推筹码的动画），我每次说话约 4 秒
 */
export const minutes = (hands: number, mine: number, theirs: number): number => (hands * 8 + theirs * 1.2 + mine * 4) / 60;

export interface Cell {
  mean: number;
  se2: number;
  won: number;
  bust: number;
  over3: number;
  minutes: number;
}

export function summarize(rows: Row[]): Cell {
  const xs = rows.map((r) => r[0]);
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
  const avg = (m: 1 | 2 | 3): number => rows.reduce((a, r) => a + r[m], 0) / n;
  return {
    mean,
    se2: (2 * sd) / Math.sqrt(n),
    won: xs.filter((x) => x > 0).length / n,
    bust: xs.filter((x) => x <= -1 + 1e-9).length / n,
    over3: xs.filter((x) => x > 3).length / n,
    minutes: minutes(avg(1), avg(2), avg(3)),
  };
}

const num = (k: string, d: number): number => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? Number(a.slice(k.length + 3)) : d;
};
const levels = (k: string, d: readonly number[]): number[] => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  const xs = a ? a.slice(k.length + 3).split(',').map(Number) : [...d];
  if (xs.length !== d.length || xs.some((x) => !Number.isInteger(x) || x < 0 || x >= LEVELS)) throw new Error(`bad --${k}`);
  return xs;
};

export async function balanceMain(args: string[]): Promise<void> {
  const n = Number(args[0] ?? 2000);
  const hands = num('hands', SESSION_HANDS);
  const size = num('size', 6);
  const real = levels('real', STAKES.map((s) => SOLO_LEVEL[s.id]));
  const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
  const fun = levels('fun', DIFFS.map((d) => FUN_LEVEL[d]));
  const t0 = performance.now();
  const pct0 = (x: number): string => `${(x * 100).toFixed(0)}%`;
  // 调参用：--levels=0,1,2 只按强弱档打（每一档都是 100 个大盲上桌，和档位无关），每档小白、普通各一行
  const only = process.argv.find((x) => x.startsWith('--levels='));
  if (only) {
    for (const lv of only.slice(9).split(',').map(Number))
      for (const sg of ['novice', 'simple']) {
        const c = summarize(await fanout(n, (from, to) => ({ stakes: 'small', level: lv, strategy: sg, size, hands, from, to })));
        console.log(`  强弱档 ${lv} ${sg === 'novice' ? '小白' : '普通'}  ${c.mean >= 0 ? '+' : ''}${c.mean.toFixed(3)} ± ${c.se2.toFixed(3)} 份  赢 ${pct0(c.won)}  输光 ${pct0(c.bust)}  约 ${c.minutes.toFixed(0)} 分钟`);
      }
    return;
  }
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  const line = (c: Cell): string =>
    `${c.mean >= 0 ? '+' : ''}${c.mean.toFixed(3)} ± ${c.se2.toFixed(3)} 份  赢 ${pct(c.won)}  输光 ${pct(c.bust)}  赢超 3 份 ${pct(c.over3)}  约 ${c.minutes.toFixed(0)} 分钟`;
  console.log(`\n配平：${size} 人桌，一场 ${hands} 手（或输光），每格 ${n} 场，${THREADS} 线程`);
  console.log('实盘（每场输赢，份；均值 ± 2 倍标准误）');
  for (const [i, st] of STAKES.entries())
    for (const sg of ['novice', 'simple']) {
      const c = summarize(await fanout(n, (from, to) => ({ stakes: st.id, level: real[i]!, strategy: sg, size, hands, from, to })));
      console.log(`  ${st.name}（强弱档 ${real[i]}）${sg === 'novice' ? '小白' : '普通'}  ${line(c)}`);
    }
  console.log('娱乐（赢 = 打完一场筹码比上桌多）');
  for (const [i, d] of DIFFS.entries())
    for (const sg of ['novice', 'simple']) {
      const c = summarize(await fanout(n, (from, to) => ({ stakes: FUN_STAKES, level: fun[i]!, strategy: sg, size, hands, from, to })));
      console.log(`  ${d}（强弱档 ${fun[i]}）${sg === 'novice' ? '小白' : '普通'}  ${line(c)}`);
    }
  console.log(`用时 ${((performance.now() - t0) / 1000).toFixed(0)} 秒`);
}
