/**
 * scripts/sim.ts 的多线程部分（一场一个种子，各场互不相干，分给几个线程跑）：
 * - vs：每档 × 每种策略打 N 场（一场 100 手、默认 6 人桌、玩家对 5 个电脑，--size=<2–9> 改人数）。每场的输赢就是"这一场的每百手大盲"，
 *   所以均值 ± 标准差/√场数 直接是每百手的误差，不用另估方差；
 * - mix：性格混桌（默认 6 人），一场 2,000 手；每场从 10 种性格里按种子洗出几种、排好座位（各性格出场、坐谁旁边都轮得开），
 *   误差按各场之间的标准差估。
 */
import { shuffle, stream } from 'arcade-kit/rng';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { PERSONAS } from '../src/ai/personas.ts';
import { categoryOf, evalCards } from '../src/core/eval.ts';
import { bluffer } from '../src/core/fame.ts';
import { LEVELS, ROOM_LEVEL, SOLO_LEVEL, STAKES, stakesOf, type StakesId } from '../src/core/stakes.ts';
import { MAX_SEATS, PERSONA_COUNT, type LogEntry, type Table } from '../src/core/table.ts';
import { runBots, runVs } from '../test/bots.ts';
import { STRATEGIES } from '../test/strategies.ts';

export const SESSION_HANDS = 100;
const MIX_HANDS = 2_000;
/** 混桌里筹码超过 3 份买入就把多的带走（bots.ts 的 cashOut，0.3.0 起；之前的混桌数字没有这一条） */
const CASH_OUT = 3;

type Job =
  | { kind: 'vs'; stakes: StakesId; strategy: string; size: number; from: number; to: number; persona?: number; humans: number; level?: number }
  | { kind: 'mix'; stakes: StakesId; size: number; from: number; to: number; form: boolean };
/** vs：每场的毫大盲；mix：每场每种性格的 [手数, 净赢筹码] */
type Result = { mbb: number[]; personas: number[]; table: number[]; bluff: number[][] } | { rounds: [number, number][][]; style: number[][]; table: number[]; bluff: number[][]; per: number[][][] };

/**
 * 整桌的热闹程度（0.3.0）：打完的手数、看到翻牌的人次、摊牌的手数、底池合计（大盲）；
 * 0.3.0 实打后加：开局时有人上头的手数、摊牌亮出诈唬的手数（画面的"诈唬"标记，fame.ts 的 bluffer）、诈唬把别人打弃的手数、
 * 上头的座位·手数、发到牌的座位·手数
 */
const TABLE = 9;
/** 诈唬统计（每种性格）：发到牌的手数、摊牌亮出诈唬（被抓）、翻牌后最后下注且只有高牌却把别人都打弃（偷到） */
const BLUFF = 3;

/** 打法统计（每种性格）：发到牌的手数、翻牌前主动入池、翻牌前加注、翻牌后下注加注、翻牌后跟注 */
const STYLE = 5;

/** 第 k 场的种子：档位、策略都不进种子，同一个 k 在各档各策略发的牌一样（配对比较，误差小一些） */
const seedOf = (k: number): number[] => [k, 0x7e4a5, 3, 4, 5, 6, 7, 8];

function work(j: Job): Result {
  if (j.kind === 'mix') {
    const rounds: [number, number][][] = [];
    const style = PERSONAS.map(() => new Array<number>(STYLE).fill(0));
    const table = new Array<number>(TABLE).fill(0);
    const bluff = PERSONAS.map(() => new Array<number>(BLUFF).fill(0));
    // 每一场每种性格的 [发到牌, 入池, 翻牌前加注]（0.5.0）：看同一个性格场与场之间打法差多少
    const per: number[][][] = [];
    for (let k = j.from; k < j.to; k++) {
      const personas = mixPersonas(k, j.size);
      const cur = PERSONAS.map(() => [0, 0, 0]);
      // 每一步看新增的操作记录（一手的最后一个操作会随新的一手清掉，少数几条，不影响比例）
      let hand = -1;
      let seen = 0;
      let vpip = new Set<number>();
      let pfr = new Set<number>();
      const track = tableTracker(table, bluff);
      const st = runBots({
        seed: [k, 2, 3, 4, 5, 6, 7, 8],
        size: j.size,
        hands: MIX_HANDS,
        stakes: j.stakes,
        personas,
        chaos: false,
        form: j.form,
        cashOut: CASH_OUT,
        onStep: (t) => {
          track(t);
          if (t.handNo !== hand) {
            for (const i of vpip) style[personas[i]!]![1]!++, cur[personas[i]!]![1]!++;
            for (const i of pfr) style[personas[i]!]![2]!++, cur[personas[i]!]![2]!++;
            vpip = new Set();
            pfr = new Set();
            hand = t.handNo;
            seen = 0;
            t.seats.forEach((s, i) => s.status !== 'out' && (style[personas[i]!]![0]!++, cur[personas[i]!]![0]!++));
          }
          let flop = t.log.slice(0, seen).some((e) => e.seat < 0);
          for (const e of t.log.slice(seen)) {
            if (e.seat < 0) flop = true;
            else if (!flop && (e.act === 'call' || e.act === 'raise')) {
              vpip.add(e.seat);
              if (e.act === 'raise') pfr.add(e.seat);
            }
            else if (flop && (e.act === 'bet' || e.act === 'raise')) style[personas[e.seat]!]![3]!++;
            else if (flop && e.act === 'call') style[personas[e.seat]!]![4]!++;
          }
          seen = t.log.length;
        },
      });
      rounds.push(st.byPersona.map((p) => [p.hands, p.net]));
      per.push(cur);
    }
    return { rounds, style, table, bluff, per };
  }
  const mbb: number[] = [];
  const personas = new Array<number>(PERSONA_COUNT).fill(0);
  const table = new Array<number>(TABLE).fill(0);
  const bluff = PERSONAS.map(() => new Array<number>(BLUFF).fill(0));
  for (let k = j.from; k < j.to; k++) {
    const r = runVs({
      seed: seedOf(k),
      stakes: j.stakes,
      size: j.size,
      hands: SESSION_HANDS,
      strategy: STRATEGIES[j.strategy]!,
      persona: j.persona,
      humans: j.humans,
      ...(j.level !== undefined ? { level: j.level } : {}),
      onStep: tableTracker(table, bluff),
    });
    mbb.push(r.mbb);
    r.personas.forEach((n, i) => (personas[i]! += n));
  }
  return { mbb, personas, table, bluff };
}

/**
 * 整桌热闹程度的计数器（0.3.0），每一步调一次，累加到 acc（见 TABLE）和 bluff（见 BLUFF，按开局时的性格记，真人座位不记）。
 * 翻牌时还在的人 = 发到牌的 − 翻牌前弃的：一手的最后一个操作会随新的一手清掉看不到，但它要么让一手在翻牌前结束（没人看翻牌），要么不是弃。
 * 诈唬也一样：摊牌前的最后一个操作是跟注或过牌，弃牌收池的最后一个操作是弃，都不是下注、加注，少了它不影响"翻牌后最后一个下注的人"
 */
function tableTracker(acc: number[], bluff: number[][]): (t: Table) => void {
  let hand = -1;
  let seen = 0;
  let flop = false;
  let dealt = 0;
  let preFolds = 0;
  let log: LogEntry[] = [];
  let holes: Table['seats'][number]['hole'][] = [];
  let board: Table['board'] = [];
  let pers: number[] = [];
  return (t) => {
    if (t.handNo !== hand) {
      const last = t.lastHand;
      if (hand >= 0 && last && last.handNo === hand) {
        acc[0]!++;
        if (last.board.length >= 3) acc[1]! += dealt - preFolds;
        if (!last.byFold) acc[2]!++;
        acc[3]! += last.pots.reduce((a, x) => a + x.amount, 0) / t.bb;
        if (last.byFold) {
          // 偷到：翻牌后最后下注的人只有高牌（按收池时的公共牌算），别人都弃了
          const w = last.pots[0]?.winners[0]?.seat ?? -1;
          const h = holes[w];
          if (board.length >= 3 && h?.length === 2 && categoryOf(evalCards([...h, ...board])) === 0 && bluffer(log, w, 0)) {
            acc[6]!++;
            if (pers[w]! >= 0) bluff[pers[w]!]![2]!++;
          }
        } else {
          let caught = false;
          for (const s of last.shown)
            if (bluffer(log, s.seat, categoryOf(s.value))) {
              caught = true;
              if (pers[s.seat]! >= 0) bluff[pers[s.seat]!]![1]!++;
            }
          if (caught) acc[5]!++;
        }
      }
      hand = t.handNo;
      seen = 0;
      flop = false;
      log = [];
      dealt = t.seats.filter((s) => s.status !== 'out').length;
      preFolds = 0;
      // 只记电脑出手的座位：runVs 里真人坐 0 号（persona -1），runBots 里全是带性格的座位
      pers = t.seats.map((s) => (s.persona >= 0 && s.persona < PERSONA_COUNT ? s.persona : -1));
      t.seats.forEach((s, i) => s.status !== 'out' && pers[i]! >= 0 && bluff[pers[i]!]![0]!++);
      const hot = t.seats.filter((s) => s.status !== 'out' && (s.tilt ?? 0) > 0).length;
      if (hot > 0) acc[4]!++;
      acc[7]! += hot;
      acc[8]! += dealt;
    }
    for (const e of t.log.slice(seen)) {
      log.push(e);
      if (e.seat < 0) flop = true;
      else if (!flop && e.act === 'fold') preFolds++;
    }
    seen = t.log.length;
    holes = t.seats.map((s) => s.hole);
    board = t.board;
  };
}

/** 整桌那一行：每手平均几个人看翻牌、摊牌比例、平均底池 */
function tableLine(parts: { table: number[] }[]): string {
  const [n, flop, sd, pot] = parts.reduce((a, x) => a.map((v, m) => v + x.table[m]!), new Array<number>(TABLE).fill(0));
  const [, , , , tilt, caught, stolen, hot, seats] = parts.reduce((a, x) => a.map((v, m) => v + x.table[m]!), new Array<number>(TABLE).fill(0));
  return (
    `每手平均 ${(flop! / n!).toFixed(2)} 人看翻牌，摊牌 ${((sd! * 100) / n!).toFixed(0)}%（每 ${(n! / sd!).toFixed(1)} 手一次），平均底池 ${(pot! / n!).toFixed(1)} 个大盲；` +
    `有人上头 ${((tilt! * 100) / n!).toFixed(0)}% 的手（每个座位 ${((hot! * 100) / seats!).toFixed(1)}% 的手在上头），摊牌亮出诈唬每百手 ${((caught! * 100) / n!).toFixed(2)} 次、诈唬打弃别人 ${((stolen! * 100) / n!).toFixed(2)} 次`
  );
}

/** 各性格的诈唬：每百手（这种性格发到牌的手）摊牌被抓几次、偷到几次 */
function bluffLine(parts: { bluff: number[][] }[]): string {
  return PERSONAS.flatMap((p, i) => {
    const [h, caught, stolen] = parts.reduce((a, x) => a.map((v, m) => v + x.bluff[i]![m]!), new Array<number>(BLUFF).fill(0));
    return h ? [`${p.name} ${((caught! * 100) / h).toFixed(2)}/${((stolen! * 100) / h).toFixed(2)}`] : [];
  }).join('、');
}

/** 混桌第 k 场坐哪几种性格、怎么排：10 种洗一遍取前 size 个 */
export function mixPersonas(k: number, size: number): number[] {
  return shuffle(Array.from({ length: PERSONA_COUNT }, (_, i) => i), stream([k, 2, 3, 4, 5, 6, 7, 8], 'mix')).slice(0, size);
}

/** 命令行的 --size=<人数>（2–9），默认 6 */
export function sizeArg(): number {
  const a = process.argv.find((x) => x.startsWith('--size='));
  const n = a ? Number(a.slice(7)) : 6;
  if (!Number.isInteger(n) || n < 2 || n > MAX_SEATS) throw new Error(`bad --size ${a}`);
  return n;
}

if (!isMainThread) parentPort!.postMessage(work(workerData as Job));

const THREADS = Math.max(1, availableParallelism() - 2);

/** 把 n 场切成几段分给线程 */
function fanout<R extends Result>(n: number, job: (from: number, to: number) => Job): Promise<R[]> {
  const chunk = Math.ceil(n / THREADS);
  const jobs: Promise<R>[] = [];
  for (let from = 0; from < n; from += chunk)
    jobs.push(
      new Promise((ok, fail) => {
        const w = new Worker(new URL(import.meta.url), { workerData: job(from, Math.min(n, from + chunk)) });
        w.once('message', ok);
        w.once('error', fail);
      }),
    );
  return Promise.all(jobs);
}

const meanSe = (xs: number[]): [number, number, number] => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
  return [m, sd / Math.sqrt(xs.length), sd];
};

/**
 * npm run sim -- --vs [每格场数] [档位,...] [策略,...] [--persona=编号] [--size=人数] [--humans=玩家数] [--level=0–5 | --room]
 * --humans（0.4.0，好友房）：前几个座位都是玩家、打印他们合起来的输赢。
 * 电脑的强弱档（0.5.0）：不给按单机的（SOLO_LEVEL），--room 按好友房的（ROOM_LEVEL），--level= 钉死一档（DESIGN.md 4.7、6.5）
 */
export async function vsMain(args: string[]): Promise<void> {
  const sessions = Number(args[0] ?? 600);
  const stakes = (args[1]?.split(',') ?? STAKES.map((s) => s.id)) as StakesId[];
  const strategies = args[2]?.split(',') ?? Object.keys(STRATEGIES);
  // 调参用：--persona=<编号> 把电脑全换成同一种性格
  const pin = process.argv.find((a) => a.startsWith('--persona='));
  const persona = pin ? Number(pin.slice(10)) : undefined;
  const size = sizeArg();
  const h = process.argv.find((a) => a.startsWith('--humans='));
  const humans = h ? Number(h.slice(9)) : 1;
  if (!Number.isInteger(humans) || humans < 1 || humans >= size) throw new Error(`bad --humans ${h}`);
  const lv = process.argv.find((a) => a.startsWith('--level='));
  const fixed = lv ? Number(lv.slice(8)) : undefined;
  if (fixed !== undefined && !(Number.isInteger(fixed) && fixed >= 0 && fixed < LEVELS)) throw new Error(`bad ${lv}`);
  const room = process.argv.includes('--room');
  const levelOf = (st: StakesId): number => fixed ?? (room ? ROOM_LEVEL : SOLO_LEVEL)[st];
  const t0 = performance.now();
  console.log(`\n${humans} 个玩家（合起来算）对 ${size - humans} 个电脑（强弱档 ${fixed ?? (room ? '按好友房' : '按单机')}）：每格 ${sessions} 场 × ${SESSION_HANDS} 手，${THREADS} 线程`);
  console.log('档位    策略      每百手大盲（±1 标准误）  赢的场次   手数');
  for (const st of stakes) {
    const mix = new Array<number>(PERSONA_COUNT).fill(0);
    for (const sg of strategies) {
      const parts = await fanout<{ mbb: number[]; personas: number[]; table: number[]; bluff: number[][] }>(sessions, (from, to) => ({ kind: 'vs', stakes: st, strategy: sg, size, from, to, persona, humans, level: levelOf(st) }));
      const xs = parts.flatMap((p) => p.mbb).map((x) => x / 1000);
      parts.forEach((p) => p.personas.forEach((n, i) => (mix[i]! += n)));
      const [mean, se, sd] = meanSe(xs);
      const won = xs.filter((x) => x > 0).length / xs.length;
      console.log(
        `${st.padEnd(6)}  ${sg.padEnd(8)}  ${mean.toFixed(1).padStart(7)} ± ${se.toFixed(1).padEnd(5)}（标准差 ${sd.toFixed(0)}）  ${(won * 100).toFixed(0).padStart(3)}%   ${xs.length * SESSION_HANDS}`,
      );
      console.log(`        整桌：${tableLine(parts)}`);
      console.log(`        诈唬（每百手被抓/偷到，按电脑性格）：${bluffLine(parts)}`);
    }
    const all = mix.reduce((a, b) => a + b, 0);
    console.log(`        电脑出场：${PERSONAS.map((p, i) => `${p.name} ${((mix[i]! * 100) / all).toFixed(0)}%`).join('、')}`);
  }
  console.log(`用时 ${((performance.now() - t0) / 1000).toFixed(0)} 秒`);
}

/** 性格混桌：size 人桌打 hands 手（向上取整到 2,000 的倍数） */
export async function mixMain(hands: number, stakes: StakesId, size = 6): Promise<void> {
  const n = Math.max(6, Math.ceil(hands / MIX_HANDS));
  const bb = stakesOf(stakes).bb;
  // --no-form：电脑不抽这一场的状态（0.5.0 以前的样子），对照场与场之间的浮动
  const form = !process.argv.includes('--no-form');
  const parts = await fanout<{ rounds: [number, number][][]; style: number[][]; table: number[]; bluff: number[][]; per: number[][][] }>(n, (from, to) => ({ kind: 'mix', stakes, size, from, to, form }));
  const per = parts.flatMap((p) => p.per);
  const rounds = parts.flatMap((p) => p.rounds);
  const total = rounds.length * MIX_HANDS;
  console.log(`\n性格对打：${size} 人桌 ${total} 手（${stakesOf(stakes).name}，${rounds.length} 场 × ${MIX_HANDS} 手，每场洗性格、换座位）`);
  console.log(`  整桌：${tableLine(parts)}`);
  console.log(`  诈唬（每百手被抓/偷到）：${bluffLine(parts)}`);
  PERSONAS.forEach((p, i) => {
    // 只算这种性格上了桌的场次
    const on = rounds.filter((r) => r[i]![0] > 0);
    if (!on.length) return;
    const h = on.reduce((a, r) => a + r[i]![0], 0);
    const net = on.reduce((a, r) => a + r[i]![1], 0);
    const [, se] = meanSe(on.map((r) => (r[i]![1] / bb / r[i]![0]) * 100));
    const [dealt, vpip, pfr, aggr, calls] = parts.reduce((a, x) => a.map((v, m) => v + x.style[i]![m]!), new Array<number>(STYLE).fill(0));
    const pct = (x: number): string => `${((x * 100) / dealt!).toFixed(0)}%`;
    // 场与场之间（0.5.0）：这种性格上桌够 200 手的场次，入池率、翻牌前加注率的标准差（百分点）
    const sessions = per.map((r) => r[i]!).filter((x) => x[0]! >= 200);
    const sd = (m: number): string => (sessions.length > 2 ? meanSe(sessions.map((x) => (x[m]! * 100) / x[0]!))[2].toFixed(1) : '—');
    console.log(
      `  ${p.name}  每百手 ${((net / bb / h) * 100).toFixed(1).padStart(6)} ± ${se.toFixed(1)} 个大盲（${h} 手）  入池 ${pct(vpip!)}（场间 ±${sd(1)}）、翻牌前加注 ${pct(pfr!)}（±${sd(2)}）、翻牌后下注加注 / 跟注 ${(aggr! / calls!).toFixed(1)}`,
    );
  });
}
