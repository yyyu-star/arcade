/**
 * 电脑再训练的模拟（0.7.0；docs/ai.md和 docs/stake.md 1.3、3.1 的表从这里来）：
 *
 *   node tools/ai-sim.ts solo  [--matches 2000]  单机各场地：0 号坐"普通"（普通难度、没性格）或"小白"（rookie，见下），
 *                                                搭档和对手按 src/ai/venue.ts；每场 8 副按实盘计分（娱乐场也这么量），给期望（份）± 标准误、胜率
 *   node tools/ai-sim.ts room  [--matches 2000]  好友房实盘：两个普通真人搭档（坐 0、2 或 1、3）对两个电脑、三个真人一个电脑，
 *                                                电脑取 normal / good / hard，一场 5 副；给真人每人的期望 ± 标准误
 *   node tools/ai-sim.ts style [--matches 400]   性格的风格指标：老张、小美、阿强（普通强弱）坐 1 号，别的座位是没性格的普通电脑；
 *                                                压牌率、每副炸弹、开局就炸的比例、每场之间压牌率的起伏、手热和手冷两种状态的差别
 *   node tools/ai-sim.ts time  [--matches 100]   单次决策耗时（各强弱、各性格）：p50 / p99 / 最大
 *   node tools/ai-sim.ts length [--matches 400]  一局多长（0.25.0）：娱乐三档 × 短局（打到 10）/ 完整（过 A），打到整局结束，
 *                                                给副数和估的分钟数（中位数、p90）。分钟数 = 电脑每手按 personas.ts 的 thinkTime（取中间值）+ 出牌动画，
 *                                                我每手 4 秒，每墩收牌、每副结算按 TableScene 的停顿，结算页看 5 秒（stake-text.ts 的估法）
 *   node tools/ai-sim.ts grid  [--matches 2000]  配平（仓库 docs/balance.md）：0 号坐"小白"或"普通"，搭档 × 对手的每种强弱组合（带性格），
 *                                                期望 ± 2 倍标准误、胜率；--mates / --opps 限定组合
 *
 * 两个玩家模型（docs/balance.md 第 1 节，不读隐藏信息、确定性）：
 * - 普通 = 没性格的普通难度电脑（会看牌力、会留炸弹、会配合）；
 * - 小白 = rookie：能出就出最小的（领出出最小的单张，跟牌拿最小的压法），压不过就炸（炸弹乱用），不记牌、不配合，只是不压队友；
 *   进贡、还贡按规则给能给的第一张。
 *
 * 一场：从打 2 开局，打满副数（或有一队过 A）结束；每副按名次给头游那一队计分（双下 3、单下 2、末游 1），输的一队扣同样的分；
 * 累计到 ±20 分（一份）封顶提前结束。份数 = 分 / 20。并行：按 CPU 数分给几个 worker 线程，结果和单线程一样（每场的种子固定）。
 */
import { cpus } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createGame, dispatch, legalPlays, seatsToAct, teamOf, viewFor, type Action, type GameState, type PlayerView } from '../src/variants/guandan/core/index.ts';
import { decide, formOf, type Difficulty, type PersonaId } from '../src/variants/guandan/ai/index.ts';
import { SOLO_BOTS, SOLO_FUN_BOTS, SOLO_LEVELS, botFor, type SoloBots, type Venue } from '../src/variants/guandan/ai/venue.ts';
import { TIER_IDS } from '../src/variants/guandan/stake/index.ts';
import { thinkTime } from '../src/view/personas.ts';

const SHARE = 20;
const BOMB_TYPES: readonly string[] = ['bomb', 'straightFlush', 'jokerBomb'];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

/** 一个座位怎么出：没性格的"真人"代理（普通电脑或小白 rookie），或者带性格的电脑 */
interface SeatSpec {
  difficulty: Difficulty | 'rookie';
  persona?: PersonaId;
}

/** 一场的设置：四个座位、打几副 */
interface Job {
  id: string;
  seats: SeatSpec[];
  deals: number;
  /** 记风格的座位（-1 不记） */
  watch: number;
  timing?: boolean;
  /** 量局长（length 模式）：打到整局结束（不看副数、不封顶），规则带上这个终点（不给是 A） */
  untilOver?: boolean;
  endLevel?: number;
}

interface Style {
  /** 对手出的牌、我有压法时：用不是炸弹的牌压了几次 / 机会几次 */
  beat: number;
  chances: number;
  bombs: number;
  /** 手里还有 15 张以上就炸 */
  earlyBombs: number;
  /** 不急的时候炸：对手都还有 10 张以上 */
  calmBombs: number;
  /** 领出几次、其中领出王或级牌（单张、对子）几次 */
  leads: number;
  bigLeads: number;
  deals: number;
}

interface Result {
  /** 0 号所在队（0、2 号）这一场的分，封顶后 */
  points: number;
  deals: number;
  style: Style | null;
  form: number;
  /** 计时（毫秒），按"强弱/性格"分组 */
  times: Record<string, number[]> | null;
  /** 估的这一局真人要坐多久（秒，length 模式） */
  seconds: number;
}

function dealPoints(s: GameState): number {
  const r = s.lastDeal!;
  const head = r.order[0]!;
  const matePlace = r.order.indexOf(((head + 2) % 4) as 0 | 1 | 2 | 3);
  const pts = matePlace === 1 ? 3 : matePlace === 2 ? 2 : 1;
  return teamOf(head) === 0 ? pts : -pts;
}

/** 小白（docs/balance.md 第 1 节）：能出就出最小的，压不过就炸，不记牌、不配合 */
function rookie(view: PlayerView): Action {
  if (view.myTribute) {
    const card = view.myTribute.allowed[0]!;
    return view.myTribute.kind === 'tribute' ? { type: 'tribute', seat: view.seat, card } : { type: 'return', seat: view.seat, card };
  }
  const plays = legalPlays(view);
  if (plays.length === 0) return { type: 'pass', seat: view.seat };
  // 队友的牌在上面时不压：新手也知道别压自己人（不加这一条，小白对最弱的对手也每场输 0.2 份，不像真人新手）
  const last = view.trick.last;
  if (last && last.seat !== view.seat && teamOf(last.seat) === teamOf(view.seat)) return { type: 'pass', seat: view.seat };
  const bomb = (p: (typeof plays)[number]) => BOMB_TYPES.includes(p.type);
  const small = (a: (typeof plays)[number], b: (typeof plays)[number]) => a.value - b.value || a.cards.length - b.cards.length;
  const plain = plays.filter((p) => !bomb(p)).sort(small);
  const p = plain[0] ?? plays.filter(bomb).sort((a, b) => a.cards.length - b.cards.length || a.value - b.value)[0]!;
  return { type: 'play', seat: view.seat, cards: p.cards, as: { type: p.type, rank: p.rank, extra: p.extra } };
}

function act(job: Job, view: PlayerView, seat: number, times: Record<string, number[]> | null): Action {
  const spec = job.seats[seat]!;
  if (spec.difficulty === 'rookie') return rookie(view);
  const t0 = times ? performance.now() : 0;
  const a = decide(view, { seed: `${job.id}|${seat}`, difficulty: spec.difficulty, persona: spec.persona, match: job.id })!;
  if (times) (times[`${spec.difficulty}/${spec.persona ?? '-'}`] ??= []).push(performance.now() - t0);
  return a;
}

function playMatch(job: Job): Result {
  let { state } = createGame(job.id, job.endLevel ? { endLevel: job.endLevel } : undefined);
  let seconds = 0;
  let points = 0;
  let deals = 0;
  const style: Style | null = job.watch >= 0 ? { beat: 0, chances: 0, bombs: 0, earlyBombs: 0, calmBombs: 0, leads: 0, bigLeads: 0, deals: 0 } : null;
  const times = job.timing ? {} : null;
  const settle = (): boolean => {
    deals++;
    if (job.untilOver) return false;
    points += dealPoints(state);
    if (Math.abs(points) >= SHARE) {
      points = Math.sign(points) * SHARE;
      return true;
    }
    return deals >= job.deals;
  };
  for (let guard = 0; guard < 100_000; guard++) {
    if (state.phase === 'gameOver') {
      settle();
      break;
    }
    if (state.phase === 'dealEnd') {
      if (settle()) break;
      state = dispatch(state, { type: 'nextDeal' }).state;
      continue;
    }
    const seat = seatsToAct(state)[0]!;
    const view = viewFor(state, seat);
    const a = act(job, view, seat, times);
    if (style && seat === job.watch && view.phase === 'play') {
      const last = view.trick.last;
      if (!last && a.type === 'play' && a.cards.length < view.hand.length) {
        style.leads++;
        if (a.as && (a.as.type === 'single' || a.as.type === 'pair') && (a.as.rank >= 16 || a.as.rank === view.level)) style.bigLeads++;
      }
      if (last && teamOf(last.seat) !== teamOf(seat) && legalPlays(view).length > 0) {
        style.chances++;
        // 压牌率只数不用炸弹的压法：爱炸是另一个指标
        if (a.type === 'play' && !(a.as && BOMB_TYPES.includes(a.as.type))) style.beat++;
      }
      if (a.type === 'play' && a.as && BOMB_TYPES.includes(a.as.type)) {
        style.bombs++;
        if (view.hand.length >= 15) style.earlyBombs++;
        const opps = [1, 3].map((d) => (seat + d) % 4).filter((s) => !view.finished.includes(s));
        if (opps.every((s) => view.counts[s]! > 10)) style.calmBombs++;
      }
    }
    const r = dispatch(state, a);
    if (r.error) throw new Error(`${job.id}：${r.error}`);
    if (job.untilOver) seconds += paceOf(job, seat, view, a, r.events);
    state = r.state;
  }
  if (style) style.deals = deals;
  const w = job.watch >= 0 ? job.seats[job.watch]! : null;
  return { points, deals, style, form: w?.persona ? formOf(job.id, job.watch, 1, w.persona) : 0, times, seconds };
}

/** 一步大概要多久（秒）：画面的停顿照 TableScene（0.25.0 的值），电脑想多久照 thinkTime 的中间值，我每手 4 秒 */
function paceOf(job: Job, seat: number, view: PlayerView, a: Action, events: { type: string }[]): number {
  let s = 0;
  if (view.phase === 'play' && (a.type === 'play' || a.type === 'pass')) {
    if (seat === 0) s += 4;
    else {
      const bomb = a.type === 'play' && !!a.as && BOMB_TYPES.includes(a.as.type);
      s += thinkTime({ kind: a.type === 'pass' ? 'pass' : bomb ? 'bomb' : 'play', lead: !view.trick.last, persona: job.seats[seat]!.persona }, () => 0.5) / 1000;
    }
    s += a.type === 'pass' ? 0.18 : 0.45;
  } else if (a.type === 'tribute' || a.type === 'return') s += seat === 0 ? 3 : 0.8;
  for (const e of events) {
    if (e.type === 'trickWon') s += 0.65 + 0.18;
    if (e.type === 'dealEnd') s += 1.1 + 5 + 2;
  }
  return s;
}

// ───────────── 并行 ─────────────


async function runAll(jobs: Job[]): Promise<Result[]> {
  const n = Math.max(1, Math.min(cpus().length, Number(arg('threads', String(cpus().length)))));
  const parts: Job[][] = Array.from({ length: n }, () => []);
  jobs.forEach((j, i) => parts[i % n]!.push(j));
  const outs = await Promise.all(
    parts.map(
      (p) =>
        new Promise<Result[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: p });
          w.once('message', (v) => resolve(v as Result[]));
          w.once('error', reject);
        }),
    ),
  );
  // 按原来的顺序拼回去
  const res: Result[] = new Array(jobs.length);
  outs.forEach((o, k) => o.forEach((r, i) => (res[i * n + k] = r)));
  return res;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const f3 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);

/** 一组场次的结果：期望（份）± 标准误、胜率（赢的场次比例）；side = 1 按 0 号这一队算，-1 按 1 号这一队算 */
function summary(rs: Result[], side = 1): string {
  const shares = rs.map((r) => (side * r.points) / SHARE);
  return `${f3(mean(shares))} ± ${se(shares).toFixed(3)} 份，胜率 ${((shares.filter((x) => x > 0).length / shares.length) * 100).toFixed(0)}%`;
}

/** 期望（份）± 2 倍标准误、胜率（docs/balance.md 第 1 节的报法） */
function summary2(rs: Result[]): string {
  const xs = rs.map((r) => r.points / SHARE);
  return `${f3(mean(xs))} ± ${(2 * se(xs)).toFixed(3)} 份，胜率 ${((xs.filter((x) => x > 0).length / xs.length) * 100).toFixed(0)}%`;
}

const botsText = (b: SoloBots): string => `搭档 ${b.mate} / 对手 ${b.opp}${b.opp3 ? `+${b.opp3}` : ''}`;

function soloJobs(venue: Venue, me: SeatSpec['difficulty'], matches: number, prefix: string): Job[] {
  return Array.from({ length: matches }, (_, i) => {
    const seats: SeatSpec[] = [{ difficulty: me }];
    for (let s = 1; s < 4; s++) seats.push(botFor(venue, s));
    return { id: `${prefix}-${i}`, seats, deals: 8, watch: -1 };
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'solo';
  const prefix = arg('seed', 'ai');
  if (mode === 'solo') {
    const matches = Number(arg('matches', '2000'));
    console.log(`单机各场地，每格 ${matches} 场（8 副），0 号是"普通"/"小白"（docs/balance.md 的两个玩家模型），期望按 0、2 号这一队，± 2 倍标准误：`);
    const venues: [string, Venue][] = [
      ...SOLO_LEVELS.map((l): [string, Venue] => [`娱乐·${l}（${botsText(SOLO_FUN_BOTS[l])}）`, { kind: 'solo', level: l }]),
      ...TIER_IDS.map((t): [string, Venue] => [`实盘·${t}（${botsText(SOLO_BOTS[t])}）`, { kind: 'soloStake', tier: t }]),
    ];
    const only = arg('venue', '');
    for (const [name, v] of venues) {
      if (only && !name.includes(only)) continue;
      const line: string[] = [];
      for (const me of ['normal', 'rookie'] as const) line.push(`${me === 'normal' ? '普通' : '小白'} ${summary2(await runAll(soloJobs(v, me, matches, `${prefix}-solo`)))}`);
      console.log(`- ${name}：${line.join('；')}`);
    }
  } else if (mode === 'room') {
    const matches = Number(arg('matches', '2000'));
    const levels = arg('levels', 'normal,good,hard').split(',') as Difficulty[];
    console.log(`好友房实盘，每格 ${matches} 场（5 副），真人是没性格的普通电脑；电脑按真实座位带性格：`);
    for (const d of levels) {
      const bot = (s: number): SeatSpec => ({ difficulty: d, persona: botFor({ kind: 'roomStake', tier: 'small' }, s).persona });
      const human: SeatSpec = { difficulty: 'normal' };
      const run = (seats: SeatSpec[]) => runAll(Array.from({ length: matches }, (_, i) => ({ id: `${prefix}-room-${i}`, seats, deals: 5, watch: -1 })));
      // 真人搭档坐 0、2（对手是老张、阿强）
      const a = await run([human, bot(1), human, bot(3)]);
      // 真人搭档坐 1、3（对手是 0 号借的老张、小美）
      const b = await run([bot(0), human, bot(2), human]);
      // 三个真人、电脑坐 2 号（小美，和 0 号真人一队）：0、2 号那队里真人只有一个，另外两个真人搭档
      const c = await run([human, human, bot(2), human]);
      console.log(`- 电脑 ${d}：真人搭档坐 0、2 每人 ${summary(a)}；坐 1、3 每人 ${summary(b, -1)}；三个真人一个电脑时搭档那两个真人每人 ${summary(c, -1)}`);
    }
  } else if (mode === 'style') {
    const matches = Number(arg('matches', '400'));
    console.log(`性格的风格（普通强弱，坐 1 号，${matches} 场 × 8 副；别的座位是没性格的普通电脑）：`);
    for (const p of [undefined, 'laozhang', 'xiaomei', 'aqiang'] as (PersonaId | undefined)[]) {
      const seats: SeatSpec[] = [{ difficulty: 'normal' }, { difficulty: 'normal', persona: p }, { difficulty: 'normal' }, { difficulty: 'normal' }];
      const rs = await runAll(Array.from({ length: matches }, (_, i) => ({ id: `${prefix}-style-${i}`, seats, deals: 8, watch: 1 })));
      const sum = (k: keyof Style) => rs.reduce((a, r) => a + r.style![k], 0);
      const rate = (r: Result) => r.style!.beat / Math.max(1, r.style!.chances);
      const perMatch = rs.filter((r) => r.style!.chances >= 20).map(rate);
      const hot = rs.filter((r) => r.form > 0.2);
      const cold = rs.filter((r) => r.form < -0.2);
      const rateOf = (xs: Result[]) => xs.reduce((a, r) => a + r.style!.beat, 0) / Math.max(1, xs.reduce((a, r) => a + r.style!.chances, 0));
      const bombsOf = (xs: Result[]) => xs.reduce((a, r) => a + r.style!.bombs, 0) / Math.max(1, xs.reduce((a, r) => a + r.style!.deals, 0));
      const sd = Math.sqrt(mean(perMatch.map((x) => (x - mean(perMatch)) ** 2)));
      console.log(
        `- ${p ?? '没性格'}：压牌率 ${(sum('beat') / sum('chances') * 100).toFixed(1)}%，每副炸弹 ${(sum('bombs') / sum('deals')).toFixed(2)}，` +
          `开局就炸占 ${(sum('earlyBombs') / Math.max(1, sum('bombs')) * 100).toFixed(0)}%，不急时每副炸 ${(sum('calmBombs') / sum('deals')).toFixed(2)}，领出王或级牌占 ${(sum('bigLeads') / sum('leads') * 100).toFixed(1)}%，每场压牌率的标准差 ${(sd * 100).toFixed(1)} 个百分点` +
          (p ? `；手热的场（${hot.length}）压牌率 ${(rateOf(hot) * 100).toFixed(1)}%、每副炸弹 ${bombsOf(hot).toFixed(2)}，手冷的场（${cold.length}）${(rateOf(cold) * 100).toFixed(1)}%、${bombsOf(cold).toFixed(2)}` : '') +
          `；这一队期望 ${summary(rs, -1)}`,
      );
    }
  } else if (mode === 'time') {
    const matches = Number(arg('matches', '100'));
    const specs: SeatSpec[][] = [
      [{ difficulty: 'normal' }, { difficulty: 'novice', persona: 'laozhang' }, { difficulty: 'easy', persona: 'xiaomei' }, { difficulty: 'normal', persona: 'aqiang' }],
      [{ difficulty: 'normal' }, { difficulty: 'hard', persona: 'laozhang' }, { difficulty: 'good', persona: 'xiaomei' }, { difficulty: 'hard', persona: 'aqiang' }],
    ];
    const all: Record<string, number[]> = {};
    for (const [k, seats] of specs.entries()) {
      const rs = await runAll(Array.from({ length: matches }, (_, i) => ({ id: `${prefix}-time-${k}-${i}`, seats, deals: 8, watch: -1, timing: true })));
      for (const r of rs) for (const [key, xs] of Object.entries(r.times!)) (all[key] ??= []).push(...xs);
    }
    console.log(`单次决策耗时（毫秒，${matches} 场 × 2 组）：`);
    for (const [k, xs] of Object.entries(all)) console.log(`- ${k}：${xs.length} 次，p50 ${pct(xs, 0.5).toFixed(2)}，p99 ${pct(xs, 0.99).toFixed(2)}，最大 ${Math.max(...xs).toFixed(1)}`);
  } else if (mode === 'length') {
    const matches = Number(arg('matches', '400'));
    console.log(`一局多长（每格 ${matches} 局，打到整局结束；0 号是"普通"，搭档和对手按娱乐场地带性格）：`);
    console.log('| 难度 | 局长 | 副数 中位 / p90 | 分钟 中位 / p90 |');
    console.log('|---|---|---|---|');
    for (const level of SOLO_LEVELS) {
      for (const [name, endLevel] of [['短局（打到 10）', 10], ['完整（过 A）', undefined]] as const) {
        const jobs = soloJobs({ kind: 'solo', level }, 'normal', matches, `${prefix}-len-${level}`).map((j) => ({ ...j, untilOver: true, ...(endLevel ? { endLevel } : {}) }));
        const rs = await runAll(jobs);
        const ds = rs.map((r) => r.deals);
        const ms = rs.map((r) => r.seconds / 60);
        console.log(`| ${level} | ${name} | ${pct(ds, 0.5)} / ${pct(ds, 0.9)} | ${pct(ms, 0.5).toFixed(1)} / ${pct(ms, 0.9).toFixed(1)} |`);
      }
    }
  } else if (mode === 'grid') {
    const matches = Number(arg('matches', '2000'));
    const mates = arg('mates', 'easy,normal,good,hard').split(',') as Difficulty[];
    // 对手写 a+b 表示 1 号 a、3 号 b（两个对手不一样强）
    const opps = arg('opps', 'novice,easy,normal,good,hard').split(',');
    const ci = (rs: Result[]): string => {
      const xs = rs.map((r) => r.points / SHARE);
      return `${f3(mean(xs))} ± ${(2 * se(xs)).toFixed(3)}（胜 ${((xs.filter((x) => x > 0).length / xs.length) * 100).toFixed(0)}%）`;
    };
    console.log(`配平网格，每格 ${matches} 场 × 8 副；电脑带性格（1 号老张、2 号小美、3 号阿强），期望按份 ± 2SE：`);
    console.log('| 搭档 / 对手 | 小白 | 普通 |');
    console.log('|---|---|---|');
    for (const mate of mates) {
      for (const opp of opps) {
        const [o1, o3 = o1] = opp.split('+') as [Difficulty, Difficulty?];
        const seats = (me: SeatSpec['difficulty']): SeatSpec[] => [
          { difficulty: me },
          { difficulty: o1, persona: 'laozhang' },
          { difficulty: mate, persona: 'xiaomei' },
          { difficulty: o3, persona: 'aqiang' },
        ];
        const run = (me: SeatSpec['difficulty']) => runAll(Array.from({ length: matches }, (_, i) => ({ id: `${prefix}-grid-${i}`, seats: seats(me), deals: 8, watch: -1 })));
        console.log(`| ${mate} / ${opp} | ${ci(await run('rookie'))} | ${ci(await run('normal'))} |`);
      }
    }
  } else {
    throw new Error(`不认得的模式 ${mode}（solo / room / style / time / length / grid）`);
  }
}

// 放在最后：上面的常量都初始化了再跑
if (!isMainThread) {
  const jobs = workerData as Job[];
  parentPort!.postMessage(jobs.map(playMatch));
} else {
  await main();
}
