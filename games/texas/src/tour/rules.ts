/**
 * 单桌锦标赛（Sit & Go）的规则核心：纯函数，一个操作进、新状态出，不碰时间、网络、DOM，也不 await。
 * 单机和好友房共用：页面或房间自己决定电脑什么时候出手、等多久，核心只回答"现在该谁、能做什么、打完怎么办"。
 *
 * 做法：底下的牌桌用 core/table.ts 的 holdHands（一手打完先停着），所有座位都是 owner 'player'（人人同样的比赛筹码，
 * 和钱包无关，不补码、不换人）。一手打完后 tourStep 做三件事：淘汰筹码为零的人并记名次、必要时涨盲、发下一手。
 * 电脑出手和真人出手走同一条路 tourApply(state, seat, action)；电脑的操作由 tourAi 算（只拿视图，同单机，走 src/bot.ts）。
 *
 * 随机：牌序、电脑出手都由 table 的种子按"手数、步数、座位"分流（bot.ts / table.ts）；开局的性格、状态另起 'tour'、'tourform' 流。
 * 同一个种子加同一串操作，结果完全一样。
 */
import { shuffle, stream, type Entropy } from 'arcade-kit/rng';
import { aiAction } from '../bot.ts';
import { apply, deal, drawForm, isFail, newTable, PERSONA_COUNT, type Action, type Fail, type Table } from '../core/table.ts';
import { view, type View } from '../core/view.ts';

export const TOUR_SEATS = 6;
/** 每人的起始比赛筹码 */
export const START_STACK = 1_500;
/** 每涨一级打几手 */
export const HANDS_PER_LEVEL = 6;
/** 盲注表 [小盲, 大盲]：起手 1,500 = 50 个大盲；最后一级不再涨 */
export const BLINDS: readonly (readonly [number, number])[] = [
  [15, 30],
  [25, 50],
  [50, 100],
  [100, 200],
  [150, 300],
  [250, 500],
  [400, 800],
  [600, 1_200],
  [1_000, 2_000],
  [1_500, 3_000],
];

/*
 * 时长估计（scripts/tour-sim.ts 用，不进规则）：单机电脑出手的节奏是 src/main.ts 的 think()，
 * 翻牌前没人加注的顺手弃牌 0.25–0.5 秒，其余 0.5–2.2 秒，按平均约 1 秒算（好友房 AI_DELAY_MS 是 1.6 秒，会更长）。
 * 真人想一步按 4 秒算，每手打完停一下看结果按 3 秒（单机点"下一手"；好友房 HAND_PAUSE_MS 是 7 秒）。
 */
export const BOT_ACT_SEC = 1.0;
export const HUMAN_ACT_SEC = 4;
export const HAND_GAP_SEC = 3;

export interface TourOpts {
  /** 每个座位是不是真人（长度 = 座位数，2–9，一般 6；真人 0 到全部） */
  humans: boolean[];
  /** 起始比赛筹码，默认 START_STACK */
  stack?: number;
  /** 电脑的强弱档（stakes.ts 的 LEVELS），默认 2 */
  level?: number;
  /** 每涨一级打几手，默认 HANDS_PER_LEVEL */
  every?: number;
}

export interface TourState {
  table: Table;
  /** 开局时哪些座位是真人（分奖金用，不随托管变） */
  humans: boolean[];
  /** 现在由电脑出手的座位：开局的电脑，加上中途离开、交给电脑的真人 */
  auto: boolean[];
  /** 盲注级别（BLINDS 的下标，从 0 起） */
  level: number;
  /** 这一级已经发了几手 */
  handsInLevel: number;
  every: number;
  /** 座位 → 名次（1 = 冠军），还没出局的是 null */
  places: (number | null)[];
  /** 这一手开始时（交盲注之前）每个座位的筹码，同一手出局的人按它排名次 */
  startStacks: number[];
  /** 刚打完的这一手淘汰了谁（名次靠前的在前），给界面提示用 */
  lastOut: number[];
  over: boolean;
}

export interface TourView extends View {
  level: number;
  /** 现在的盲注 */
  blinds: readonly [number, number];
  /** 下一级的盲注，已经是最后一级就是 null */
  next: readonly [number, number] | null;
  /** 还有几手（含正在打的）涨盲，最后一级是 0 */
  handsLeft: number;
  places: (number | null)[];
  over: boolean;
}

export function newTour(o: TourOpts, seed: Entropy): TourState {
  const n = o.humans.length;
  const stack = o.stack ?? START_STACK;
  const t = newTable('small', n, seed, { holdHands: true, level: o.level ?? 2 });
  // 每个电脑一个不重复的性格
  const order = shuffle(Array.from({ length: PERSONA_COUNT }, (_, i) => i), stream(seed, 'tour', 0));
  for (let i = 0; i < n; i++) {
    t.seats[i] = {
      ...t.seats[i]!,
      owner: 'player',
      persona: o.humans[i] ? -1 : order[i % PERSONA_COUNT]!,
      stack,
      start: stack,
      ...(o.humans[i] ? {} : { form: drawForm(stream(seed, 'tourform', i)) }),
    };
    t.bank += stack;
  }
  return startNext({
    table: t,
    humans: [...o.humans],
    auto: o.humans.map((h) => !h),
    level: 0,
    handsInLevel: 0,
    every: o.every ?? HANDS_PER_LEVEL,
    places: new Array<number | null>(n).fill(null),
    startStacks: new Array<number>(n).fill(0),
    lastOut: [],
    over: false,
  });
}

/** 发下一手：该涨盲就涨，记下这一手开始时的筹码，改牌桌的盲注，发牌 */
function startNext(s0: TourState): TourState {
  const s = structuredClone(s0);
  if (s.handsInLevel >= s.every && s.level < BLINDS.length - 1) {
    s.level++;
    s.handsInLevel = 0;
  }
  const [sb, bb] = BLINDS[s.level]!;
  s.startStacks = s.table.seats.map((x) => x.stack);
  s.table.sb = sb;
  s.table.bb = bb;
  s.table.minRaise = bb;
  s.table = deal(s.table);
  s.handsInLevel++;
  return s;
}

/** 这一手是不是已经打完、停着等 tourStep */
export const handOver = (s: TourState): boolean => !s.over && s.table.phase === 'idle' && !!s.table.hold;

/**
 * 一手打完以后的处理：筹码为零的淘汰并记名次（同一手出局的，这一手开始时筹码多的名次靠前，一样多的座位号小的靠前），
 * 只剩一人就结束，否则涨盲（够手数时）并发下一手。这一手还没打完或已经结束就原样返回。
 */
export function tourStep(s0: TourState): TourState {
  if (!handOver(s0)) return s0;
  const s = structuredClone(s0);
  const alive = s.table.seats.flatMap((x, i) => (s.places[i] === null && x.stack > 0 ? [i] : []));
  const out = s.table.seats.flatMap((x, i) => (s.places[i] === null && x.stack === 0 ? [i] : []));
  out.sort((a, b) => s.startStacks[b]! - s.startStacks[a]! || a - b);
  out.forEach((seat, k) => (s.places[seat] = alive.length + 1 + k));
  s.lastOut = out;
  if (alive.length <= 1) {
    if (alive.length === 1) s.places[alive[0]!] = 1;
    s.over = true;
    return s;
  }
  return startNext(s);
}

/**
 * 一个操作进、新状态出：真人和电脑都走这里（电脑的操作先用 tourAi 算出来）。
 * 这一步打完了整手，就接着做 tourStep（淘汰、涨盲、发下一手），所以返回的状态总是"有人要说话"或"已结束"。
 * 锦标赛里没有暂离、回来；'leave'（真人离开）= 从此交给电脑，筹码照常打下去，名次按电脑打出来的算
 */
export function tourApply(s: TourState, seat: number, a: Action): TourState | Fail {
  if (s.over) return { error: 'tour_over' };
  if (a.t === 'away' || a.t === 'back') return { error: 'not_in_tour' };
  if (a.t === 'leave') return tourLeave(s, seat);
  const t = apply(s.table, seat, a);
  if (isFail(t)) return t;
  return tourStep({ ...s, table: t });
}

/** 真人离开：座位交给电脑（写上不和别人重复的性格和这一场的状态），之后由 tourAi 出手 */
export function tourLeave(s0: TourState, seat: number): TourState | Fail {
  if (!s0.humans[seat] || s0.auto[seat]) return { error: 'not_human' };
  const s = structuredClone(s0);
  const used = new Set(s.table.seats.map((x) => x.persona));
  const x = s.table.seats[seat]!;
  x.persona = Array.from({ length: PERSONA_COUNT }, (_, i) => (seat + i) % PERSONA_COUNT).find((p) => !used.has(p)) ?? seat % PERSONA_COUNT;
  x.form = drawForm(stream(s.table.seed, 'tourform', seat));
  s.auto[seat] = true;
  return s;
}

/** 现在轮到的电脑座位和它的操作；轮到真人、没人说话、已结束时是 null。算出来再交给 tourApply */
export function tourAi(s: TourState): { seat: number; action: Action } | null {
  const seat = s.table.toAct;
  if (s.over || seat === null || !s.auto[seat]) return null;
  return { seat, action: aiAction(s.table, seat) };
}

/**
 * 让电脑一直打，直到轮到真人或结束（maxSteps 防死循环，默认够打完一整场）。房间可以一次一步地用 tourAi + tourApply，
 * 也可以用这个一次打一批
 */
export function tourRun(s0: TourState, maxSteps = 200_000): TourState {
  let s = s0;
  for (let i = 0; i < maxSteps; i++) {
    const m = tourAi(s);
    if (!m) return s;
    const r = tourApply(s, m.seat, m.action);
    if (isFail(r)) throw new Error(`bot made an illegal move: ${r.error}`);
    s = r;
  }
  throw new Error('tour stuck');
}

/** "直接离开"/"剩下的快速打完"：还在场的真人都交给电脑，一次跑完剩余对局，确定性 */
export function playOut(s0: TourState): TourState {
  let s = s0;
  for (let i = 0; i < s.humans.length; i++) {
    if (s.humans[i] && !s.auto[i]) s = tourLeave(s, i) as TourState;
  }
  return tourRun(s);
}

export const isOver = (s: TourState): boolean => s.over;

/**
 * 名次顺序：座位号，冠军在前。结束以后是最终名次；没结束时还在场的按现在的筹码排在前面，已出局的按名次接在后面
 */
export function finishOrder(s: TourState): number[] {
  return s.places
    .map((p, i) => ({ i, p, c: s.table.seats[i]!.stack }))
    .sort((a, b) => (a.p ?? 0) - (b.p ?? 0) || b.c - a.c || a.i - b.i)
    .map((x) => x.i);
}

/** 界面要的：这个座位看得到的牌桌，加上盲注、涨盲倒数和名次 */
export function tourView(s: TourState, seat: number | null): TourView {
  const next = BLINDS[s.level + 1] ?? null;
  return {
    ...view(s.table, seat),
    level: s.level,
    blinds: BLINDS[s.level]!,
    next,
    handsLeft: next ? s.every - s.handsInLevel + 1 : 0,
    places: [...s.places],
    over: s.over,
  };
}

// ---------- 奖金 ----------

/** 单机：6 人桌前三名拿 3、1.8、1.2 份报名费，其余 0（平均每人正好 1 份）。取整到整数 */
export function payouts(buyIn: number, size = TOUR_SEATS): number[] {
  const p = [Math.round(buyIn * 3), Math.round((buyIn * 18) / 10), Math.round((buyIn * 12) / 10)];
  return Array.from({ length: size }, (_, i) => p[i] ?? 0);
}

/**
 * 好友房：奖池 = 真人数 × 报名费，只在真人之间按名次分；电脑排在谁前面都不影响真人之间的先后。
 * order 是真人座位按名次排的顺序（冠军在前），返回同样顺序的奖金。
 * 1 人退回报名费；2 人第 1 拿全部；3 人 70/30；4 人以上 50/30/20。零头给第 1 名，奖池正好分完
 */
export function roomPayouts(order: readonly number[], buyIn: number): number[] {
  const n = order.length;
  const pool = n * buyIn;
  const pct = n <= 2 ? [] : n === 3 ? [70, 30] : [50, 30, 20];
  const out = new Array<number>(n).fill(0);
  let rest = pool;
  for (let i = 1; i < pct.length; i++) {
    out[i] = Math.floor((pool * pct[i]!) / 100);
    rest -= out[i]!;
  }
  if (n > 0) out[0] = rest;
  return out;
}

/** 好友房：从整场的名次里挑出真人，按先后给奖金 */
export function roomPrizes(s: TourState, buyIn: number): { seat: number; prize: number }[] {
  const hs = finishOrder(s).filter((i) => s.humans[i]);
  const pr = roomPayouts(hs, buyIn);
  return hs.map((seat, k) => ({ seat, prize: pr[k]! }));
}
