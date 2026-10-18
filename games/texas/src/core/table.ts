/**
 * 一张牌桌的规则（DESIGN.md 第 1 节）：纯函数，输入状态和操作，输出新状态，原状态不动。
 * 状态里只有整数、字符串、数组和普通对象，可以直接 JSON 存取；浏览器（单机）和房间（好友房）共用。
 *
 * 筹码只有三条进出的路：买入（seatPlayer、addChips）、电脑坐下（庄家的筹码），离开牌桌（out，等结回钱包；电脑换人时直接收回）。
 * bank 记"现在桌上一共有多少"，测试每一步都核对 Σ筹码 + Σ这一手投入 = bank。
 */
import type { Card } from './cards.ts';
import { evalCards } from './eval.ts';
import { shuffle, stream, type Entropy, type RandomStream } from 'arcade-kit/rng';
import { HOUSE_MAX_BB, HOUSE_MIN_BB, LEVEL_HOUSE, SOLO_LEVEL, stakesOf, STRONG, type StakesId } from './stakes.ts';

export const RULES_VERSION = 1;
/** 电脑性格的个数（名字和参数在 src/ai/personas.ts）。9 人桌最多 8 个电脑、一桌不重复，所以至少 8 种（0.2.0 起 10 种） */
export const PERSONA_COUNT = 10;
/** 一桌最多几个人（0.2.0 起 9 人） */
export const MAX_SEATS = 9;
/**
 * 随机数的用途（arcade-kit/rng 按"用途 + 序号"分流）：多算一次电脑的蒙特卡洛不会改变后面发的牌。
 * 测试断言这几个名字的哈希互不相同。banter 是好友房电脑对名场面的反应、reply 是被扔时的回应（worker/room.ts）；
 * 名字是 0.6.0 起的，改了随机序列就变，所以不改
 */
export const RNG = { deal: 'deal', button: 'button', house: 'house', ai: 'ai', room: 'room', banter: 'banter', reply: 'reply' } as const;
const DECK: readonly Card[] = Array.from({ length: 52 }, (_, i) => i);
/** 电脑每一场的状态里，松紧、激进最多偏多少（相对强度，0.5.0）：和每次决定的随机浮动（JITTER 80）同一个量级，叠起来一场里看得出来 */
export const FORM_SWING = 90;
/** 连着这么多手超时就暂离 */
const AWAY_AFTER_TIMEOUTS = 2;
/**
 * "上头"（0.3.0，DESIGN.md 4.6）：一手净输到这么多个大盲，接下来 TILT_HANDS 手电脑打得松一点、凶一点。
 * 只由这一手的输赢推出来，同种子同结果；真人座位也记（托管、模拟时电脑替他出手），只有自己的视图看得到
 */
export const TILT_LOSS_BB = 40;
export const TILT_HANDS = 3;

export type Owner = 'none' | 'house' | 'player';
/** 这一手里的状态：out 没发牌 */
export type Status = 'out' | 'active' | 'folded' | 'allin';
export type Phase = 'idle' | 'preflop' | 'flop' | 'turn' | 'river';

export interface SeatState {
  /** none 空座；house 电脑（庄家的筹码）；player 真人买入的 */
  owner: Owner;
  /** 电脑的性格编号，真人 -1 */
  persona: number;
  stack: number;
  status: Status;
  hole: Card[];
  /** 这一轮投的 */
  bet: number;
  /** 这一手一共投的 */
  total: number;
  /** 这一轮说过话 */
  acted: boolean;
  /** 说话时的最高注：之后只被"不够一次加注的全下"抬高的，不重新开放加注 */
  actedAt: number;
  /** 暂离：不发牌、不交盲 */
  away: boolean;
  /** 连着超时的手数 */
  timeouts: number;
  timedOut: boolean;
  /** 这一手打完离桌 */
  leaving: boolean;
  /** "上头"还剩几手（0.3.0）。0 时不存这个字段：旧存档、旧房间状态没有它，一律按 0 算 */
  tilt?: number;
  /**
   * 电脑这一场的状态（0.5.0，DESIGN.md 4.7）：坐下时按种子抽，在性格的范围里浮动，同一个性格每一场打法不一样。
   * [松紧, 激进, 诈唬 ‰, 想得快慢 ‰]：松紧、激进加在门槛上（正数更紧、更凶），诈唬 700–1300 乘在诈唬的概率上，快慢给页面的思考时间。
   * 只有电脑有；旧存档没有，按不浮动算。只在自己的视图里
   */
  form?: number[];
  /** 电脑坐下时带的筹码（0.5.0）：领先、落后按它比 */
  start?: number;
  /**
   * 这个座位这一场公开的打法统计（0.5.0，人人看得到的出手推出来的，不碰底牌）：
   * [发到牌的手数, 翻牌前主动入池, 翻牌前加注, 翻牌后下注加注, 翻牌后跟注]。换人清零；电脑按它看对手松紧、凶不凶
   */
  seen?: number[];
}

export interface LogEntry {
  /** 座位；-1 是发公共牌 */
  seat: number;
  act: 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'flop' | 'turn' | 'river';
  /** 下注、加注是"加到多少"，跟注是"跟了多少"，盲注是交了多少 */
  amount: number;
  allin?: true;
  /** 超时由系统代出 */
  auto?: true;
}

export interface Pot {
  amount: number;
  winners: { seat: number; won: number }[];
}

export interface HandResult {
  handNo: number;
  board: Card[];
  /** 亮出来的牌（只有这些会下发给别人） */
  shown: { seat: number; hole: Card[]; value: number }[];
  pots: Pot[];
  /** 没人跟的那部分退回 */
  uncalled: { seat: number; amount: number } | null;
  /** 别人都弃了，没摊牌 */
  byFold: boolean;
  /**
   * 一手打完后自己主动亮的牌（0.19.0）：每家一条，cards 里是亮的那一张或两张。不算摊牌，不比大小，只给大家看；
   * 摊牌时已经亮过的不能再亮
   */
  showed?: { seat: number; cards: Card[] }[];
}

/** 离开牌桌、等结回钱包的筹码 */
export interface Payout {
  id: string;
  seat: number;
  amount: number;
}

export interface Table {
  rv: number;
  /** 256 位开局熵（arcade-kit/rng 的密钥）：只在本机或房间的状态里，绝不下发 */
  seed: Entropy;
  stakes: StakesId;
  sb: number;
  bb: number;
  handNo: number;
  phase: Phase;
  button: number;
  deck: Card[];
  deckPos: number;
  board: Card[];
  toAct: number | null;
  /** 这一轮的最高注 */
  currentBet: number;
  /** 最小加注的增量（上一次完整加注的大小，至少一个大盲） */
  minRaise: number;
  /** 这一轮最后一个下注或加注的人，-1 没有 */
  lastAggr: number;
  seats: SeatState[];
  log: LogEntry[];
  lastHand: HandResult | null;
  bank: number;
  /** 庄家净投入：电脑坐下带上桌的减去电脑离桌收回的（0.3.3）。真人那边扣的 = 结回的 + 输给电脑的（= 牌桌清空时的 house），测试据此核对没有筹码凭空消失；旧存档没有，按 0 算 */
  house?: number;
  out: Payout[];
  opSeq: number;
  /** 这一手是不是全下后自动发完的（摊牌时所有人亮牌） */
  runout: boolean;
  /** 这一手退回的没人跟的下注 */
  uncalled: { seat: number; amount: number } | null;
  /**
   * 一手打完先停着（0.1.1）：开着时一手打完不马上发下一手，hold 记"刚打完、等着发"，只有 deal 才发下一手，
   * 好让人看清这一手的结果（单机等玩家点"下一手"，好友房等房间停够几秒）。没开（模拟器、老存档）就是打完马上发下一手
   */
  holdHands?: boolean;
  hold?: boolean;
  /**
   * 刚打完的这一手每个座位的底牌（0.19.0，主动亮牌用）：只在一手打完停着（hold）时有，发下一手就删。
   * 和底牌一样是隐藏信息：view 只给这个座位自己的那两张（View.kept）
   */
  kept?: Card[][];
  /** 至少几个真人能打才发牌（0.4.0，好友房是 2：不能一个人带电脑赢实盘）；没填是 1（单机、模拟器、老存档） */
  minHumans?: number;
  /** 电脑的强弱档（0.5.0，stakes.ts 的 LEVELS）：场地按档位定（SOLO_LEVEL、ROOM_LEVEL）；没填的看 strong，再没有按单机的 */
  level?: number;
  /** 0.4.0 的好友房：电脑一律最强，等于 level 5。只为读 0.4.0 开的房间留着 */
  strong?: boolean;
}

/** 这一桌电脑的强弱档 */
export const levelOf = (t: Pick<Table, 'level' | 'strong' | 'stakes'>): number => t.level ?? (t.strong ? 5 : SOLO_LEVEL[t.stakes]);

export type Action =
  | { t: 'fold' }
  | { t: 'check' }
  | { t: 'call' }
  | { t: 'raise'; to: number }
  | { t: 'allin' }
  /** 超时代出：能过牌就过，不能就弃。只由系统（单机计时、房间）发，客户端发来的不收 */
  | { t: 'timeout' }
  /** 从下一手起暂离 */
  | { t: 'away' }
  | { t: 'back' }
  /** 离桌：手里有牌就先弃，这一手打完结算 */
  | { t: 'leave' }
  /** 一手打完停着时亮自己刚才的底牌（0.19.0）：cards 是第几张（0、1），一张或两张；可以先亮一张再亮两张 */
  | { t: 'show'; cards: number[] };

export type Fail = { error: string };
export const isFail = (x: unknown): x is Fail => typeof x === 'object' && x !== null && 'error' in x;

/** 这个座位现在能做什么；不该他说话时是 null */
export interface Legal {
  /** 能过牌（不用跟） */
  check: boolean;
  /** 要跟多少（不够就是全部筹码）；能过牌时是 0 */
  call: number;
  /** 能不能加注（含全下加注） */
  raise: boolean;
  /** 最少加到多少；筹码不够一次最小加注时等于 maxTo（只能全下） */
  minTo: number;
  /** 最多加到多少（全下） */
  maxTo: number;
}

const emptySeat = (): SeatState => ({
  owner: 'none',
  persona: -1,
  stack: 0,
  status: 'out',
  hole: [],
  bet: 0,
  total: 0,
  acted: false,
  actedAt: 0,
  away: false,
  timeouts: 0,
  timedOut: false,
  leaving: false,
});

export function newTable(stakes: StakesId, size: number, seed: Entropy, opts: { holdHands?: boolean; minHumans?: number; level?: number } = {}): Table {
  if (!Number.isInteger(size) || size < 2 || size > MAX_SEATS) throw new Error(`bad table size ${size}`);
  if (seed.length !== 8) throw new Error('seed must be 8 words');
  const s = stakesOf(stakes);
  return {
    rv: RULES_VERSION,
    seed: [...seed],
    stakes,
    sb: s.sb,
    bb: s.bb,
    handNo: 0,
    phase: 'idle',
    button: -1,
    deck: [],
    deckPos: 0,
    board: [],
    toAct: null,
    currentBet: 0,
    minRaise: s.bb,
    lastAggr: -1,
    seats: Array.from({ length: size }, emptySeat),
    log: [],
    lastHand: null,
    bank: 0,
    house: 0,
    out: [],
    opSeq: 0,
    runout: false,
    uncalled: null,
    ...(opts.holdHands ? { holdHands: true, hold: false } : {}),
    ...(opts.minHumans ? { minHumans: opts.minHumans } : {}),
    ...(opts.level !== undefined ? { level: opts.level } : {}),
  };
}

// ---------- 坐下、补码、结算（由可信的调用方做：单机的页面在钱包扣完钱后，房间在钱包回话后） ----------

/** 真人买入坐下。空闲时够人就开下一手（start 为 false 时不开：一次摆好几个座位，摆完再 deal） */
export function seatPlayer(t0: Table, seat: number, amount: number, start = true): Table | Fail {
  const t = structuredClone(t0);
  const s = t.seats[seat];
  if (!s) return { error: 'bad_seat' };
  if (s.owner !== 'none') return { error: 'seat_taken' };
  const st = stakesOf(t.stakes);
  if (!Number.isSafeInteger(amount) || amount < st.min || amount > st.max) return { error: 'bad_amount' };
  t.seats[seat] = { ...emptySeat(), owner: 'player', stack: amount };
  forget(t, seat);
  t.bank += amount;
  if (start) autoStart(t);
  return t;
}

/** 电脑坐下：性格从没人用的里面挑，带 60–100 个大盲 */
export function seatHouse(t0: Table, seat: number, start = true): Table | Fail {
  const t = structuredClone(t0);
  const s = t.seats[seat];
  if (!s) return { error: 'bad_seat' };
  if (s.owner !== 'none') return { error: 'seat_taken' };
  putHouse(t, seat);
  if (start) autoStart(t);
  return t;
}

/** 补码：不在这一手里时才能补，补完不超过这一档的买入上限 */
export function addChips(t0: Table, seat: number, amount: number, start = true): Table | Fail {
  const t = structuredClone(t0);
  const s = t.seats[seat];
  if (!s || s.owner !== 'player' || s.leaving) return { error: 'not_seated' };
  if (s.status !== 'out') return { error: 'in_hand' };
  if (!Number.isSafeInteger(amount) || amount <= 0 || s.stack + amount > stakesOf(t.stakes).max) return { error: 'bad_amount' };
  s.stack += amount;
  t.bank += amount;
  if (start) autoStart(t);
  return t;
}

/** 空闲时够人就开一手（坐下、补码、回来时会自动做；摆好座位以后手动开第一手用；一手打完停着的，由它发下一手） */
export function deal(t0: Table): Table {
  const t = structuredClone(t0);
  if (t.hold) t.hold = false;
  delete t.kept;
  if (t.phase === 'idle') {
    for (let i = 0; i < t.seats.length; i++) refill(t, i);
    startHand(t);
  }
  return t;
}

/** 输光的电脑换一个新的 */
function refill(t: Table, seat: number): void {
  const s = t.seats[seat]!;
  if (s.owner !== 'house' || s.stack > 0) return;
  t.seats[seat] = emptySeat();
  putHouse(t, seat);
}

/** 离开牌桌的筹码已经结回钱包，从待结算里拿掉 */
export function paid(t0: Table, id: string): Table {
  const t = structuredClone(t0);
  t.out = t.out.filter((p) => p.id !== id);
  return t;
}

/** 说了离桌、这一手还没打完又回来了：取消离桌（这一手已经弃了，下一手接着打），筹码不用结回钱包再买一次 */
export function stay(t0: Table, seat: number): Table {
  const t = structuredClone(t0);
  const s = t.seats[seat];
  if (s?.owner === 'player') s.leaving = false;
  return t;
}

/**
 * 好友房点了"离开房间"（0.2.4：离开就"立即结算"）：已经弃了牌、要离桌的人，桌上剩下的筹码马上进待结算，不等这一手打完。
 * 投进池子的留在池子里（这一手由别人接着打完）；座位等这一手打完再空出来。不是这种情况就原样返回
 */
export function cashOut(t0: Table, seat: number): Table {
  const s0 = t0.seats[seat];
  if (s0?.owner !== 'player' || !s0.leaving || s0.status !== 'folded' || s0.stack === 0) return t0;
  const t = structuredClone(t0);
  const s = t.seats[seat]!;
  t.bank -= s.stack;
  t.out.push({ id: `p${++t.opSeq}`, seat, amount: s.stack });
  s.stack = 0;
  return t;
}

/**
 * 牌桌散了（房间要关）：这一手作废，每人这一手投的退回，真人全部离桌、筹码进待结算，电脑的收回庄家。之后不再发牌。
 * 作废而不是打完：剩下的街要等真人出手，房间关的时候等不了
 */
export function closeTable(t0: Table): Table {
  const t = structuredClone(t0);
  for (let i = 0; i < t.seats.length; i++) {
    const s = t.seats[i]!;
    s.stack += s.total;
    s.total = 0;
    s.bet = 0;
    if (s.owner !== 'none') removeSeat(t, i);
  }
  Object.assign(t, { phase: 'idle', toAct: null, board: [], deck: [], deckPos: 0, log: [], currentBet: 0, lastAggr: -1, runout: false, uncalled: null });
  return t;
}

// ---------- 打牌 ----------

export function legal(t: Table, seat: number): Legal | null {
  if (t.toAct !== seat) return null;
  const s = t.seats[seat]!;
  const toCall = Math.max(0, t.currentBet - s.bet);
  const maxTo = s.bet + s.stack;
  // 别人都全下或弃了，再加注没人能跟
  const others = t.seats.some((o, i) => i !== seat && o.status === 'active');
  // 已经说过话、之后只被"不够一次加注的全下"抬高的，只能跟或弃（TDA 规则）
  const reopened = !s.acted || t.currentBet - s.actedAt >= t.minRaise;
  const minTo = t.currentBet === 0 ? t.bb : t.currentBet + t.minRaise;
  return {
    check: toCall === 0,
    call: Math.min(toCall, s.stack),
    raise: others && reopened && maxTo > t.currentBet,
    minTo: Math.min(minTo, maxTo),
    maxTo,
  };
}

export function apply(t0: Table, seat: number, a: Action): Table | Fail {
  const s0 = t0.seats[seat];
  if (!s0 || s0.owner === 'none') return { error: 'not_seated' };
  switch (a.t) {
    case 'away': {
      const t = structuredClone(t0);
      t.seats[seat]!.away = true;
      return t;
    }
    case 'back': {
      const t = structuredClone(t0);
      const s = t.seats[seat]!;
      s.away = false;
      s.timeouts = 0;
      autoStart(t);
      return t;
    }
    case 'leave':
      return leave(structuredClone(t0), seat);
    case 'show':
      return showCards(t0, seat, a.cards);
    default:
      break;
  }
  const lg = legal(t0, seat);
  if (!lg) return { error: 'not_your_turn' };
  const t = structuredClone(t0);
  const s = t.seats[seat]!;
  switch (a.t) {
    case 'timeout':
      s.timedOut = true;
      if (lg.check) act(t, seat, 'check', 0, true);
      else fold(t, seat, true);
      return t;
    case 'fold':
      fold(t, seat, false);
      return t;
    case 'check':
      if (!lg.check) return { error: 'cannot_check' };
      act(t, seat, 'check', 0, false);
      return t;
    case 'call':
      if (lg.check) return { error: 'nothing_to_call' };
      pay(t, seat, lg.call);
      act(t, seat, 'call', lg.call, false);
      return t;
    case 'allin':
      // 全下但不超过最高注就是跟注；超过就是加注，要能加注才行
      if (lg.maxTo <= t.currentBet) {
        if (lg.check) return { error: 'nothing_to_call' };
        pay(t, seat, lg.call);
        act(t, seat, 'call', lg.call, false);
        return t;
      }
      if (!lg.raise) return { error: 'cannot_raise' };
      raiseTo(t, seat, lg.maxTo);
      return t;
    case 'raise':
      if (!lg.raise) return { error: 'cannot_raise' };
      if (!Number.isSafeInteger(a.to) || a.to < lg.minTo || a.to > lg.maxTo) return { error: 'bad_amount' };
      raiseTo(t, seat, a.to);
      return t;
    default:
      return { error: 'bad_action' };
  }
}

// ---------- 内部：一手的流程（都就地改 t，t 已经是复制出来的） ----------

function pay(t: Table, seat: number, amount: number): void {
  const s = t.seats[seat]!;
  s.stack -= amount;
  s.bet += amount;
  s.total += amount;
  if (s.stack === 0) s.status = 'allin';
}

function raiseTo(t: Table, seat: number, to: number): void {
  const s = t.seats[seat]!;
  const wasBet = t.currentBet === 0;
  const inc = to - t.currentBet;
  // 完整加注才抬高最小加注；不够一次加注的全下只抬高最高注
  if (inc >= t.minRaise) t.minRaise = inc;
  t.currentBet = to;
  t.lastAggr = seat;
  pay(t, seat, to - s.bet);
  act(t, seat, wasBet ? 'bet' : 'raise', to, false);
}

function act(t: Table, seat: number, kind: 'check' | 'call' | 'bet' | 'raise', amount: number, auto: boolean): void {
  const s = t.seats[seat]!;
  if (kind !== 'check') note(t, seat, kind);
  s.acted = true;
  s.actedAt = t.currentBet;
  t.log.push({ seat, act: kind, amount, ...(s.status === 'allin' ? { allin: true as const } : {}), ...(auto ? { auto: true as const } : {}) });
  advance(t, seat);
}

/**
 * 记公开的打法统计（0.5.0，SeatState.seen）：翻牌前这一手第一次跟或加算入池、第一次加算加注；翻牌后的下注加注、跟注各记一次。
 * 只用出手本身（人人看得到），在写进操作记录之前看这一手前面他做过什么
 */
function note(t: Table, seat: number, kind: 'call' | 'bet' | 'raise'): void {
  const s = t.seats[seat]!;
  const seen = s.seen ?? [0, 0, 0, 0, 0];
  if (t.board.length === 0) {
    const before = t.log.filter((e) => e.seat === seat && (e.act === 'call' || e.act === 'raise' || e.act === 'bet'));
    if (before.length === 0) seen[1]!++;
    if (kind !== 'call' && !before.some((e) => e.act !== 'call')) seen[2]!++;
  } else seen[kind === 'call' ? 4 : 3]!++;
  s.seen = seen;
}

function fold(t: Table, seat: number, auto: boolean): void {
  t.seats[seat]!.status = 'folded';
  t.log.push({ seat, act: 'fold', amount: 0, ...(auto ? { auto: true as const } : {}) });
  if (t.toAct === seat) return advance(t, seat);
  // 不轮到他时弃牌（离桌）：只剩一个人就结束，否则轮到的人照常说话
  if (live(t).length === 1) endByFold(t);
}

function leave(t: Table, seat: number): Table {
  const s = t.seats[seat]!;
  s.leaving = true;
  if (s.status === 'active') fold(t, seat, false);
  // 不在这一手里（或者已经弃了、全下了要等这一手打完）
  if (t.seats[seat]!.status === 'out') removeSeat(t, seat);
  return t;
}

const live = (t: Table): number[] => t.seats.flatMap((s, i) => (s.status === 'active' || s.status === 'allin' ? [i] : []));

/** 从 from 往后（顺时针）第一个满足条件的座位 */
function nextSeat(t: Table, from: number, ok: (s: SeatState) => boolean): number | null {
  const n = t.seats.length;
  for (let i = 1; i <= n; i++) {
    const k = (from + i) % n;
    if (ok(t.seats[k]!)) return k;
  }
  return null;
}

const needsToAct = (t: Table) => (s: SeatState) => s.status === 'active' && (!s.acted || s.bet < t.currentBet);

function advance(t: Table, from: number): void {
  if (live(t).length === 1) return endByFold(t);
  const next = nextSeat(t, from, needsToAct(t));
  if (next !== null) {
    t.toAct = next;
    return;
  }
  endStreet(t);
}

function endStreet(t: Table): void {
  t.toAct = null;
  returnUncalled(t);
  const withChips = t.seats.filter((s) => s.status === 'active').length;
  if (t.phase === 'river') return showdown(t);
  if (withChips <= 1) {
    // 没人能再下注了：剩下的公共牌一次发完，所有人亮牌
    t.runout = true;
    while (t.board.length < 5) dealStreet(t);
    return showdown(t);
  }
  dealStreet(t);
  for (const s of t.seats) {
    s.bet = 0;
    s.acted = false;
    s.actedAt = 0;
  }
  t.currentBet = 0;
  t.minRaise = t.bb;
  t.lastAggr = -1;
  t.toAct = nextSeat(t, t.button, needsToAct(t));
}

function dealStreet(t: Table): void {
  const n = t.board.length === 0 ? 3 : 1;
  for (let i = 0; i < n; i++) t.board.push(t.deck[t.deckPos++]!);
  t.phase = t.board.length === 3 ? 'flop' : t.board.length === 4 ? 'turn' : 'river';
  t.log.push({ seat: -1, act: t.phase as 'flop' | 'turn' | 'river', amount: 0 });
}

/**
 * 这一轮最高注里没人跟的部分退回（最后一个加注超出别人能跟的）。只退给还在这一手里的人：下了注又弃牌的
 * （好友房里下注后马上离座，不轮到他也算弃牌）那一注是死钱，留在池里给赢家。0.3.3 前也退给弃了牌的人，
 * 可他离座时那一份已经结回钱包、封上了，退回的这一注只能搁在房间里，房间关了就没了
 */
function returnUncalled(t: Table): void {
  let top = -1;
  for (let i = 0; i < t.seats.length; i++) {
    if (t.seats[i]!.status !== 'folded' && (top < 0 || t.seats[i]!.bet > t.seats[top]!.bet)) top = i;
  }
  let second = 0;
  for (let i = 0; i < t.seats.length; i++) if (i !== top) second = Math.max(second, t.seats[i]!.bet);
  if (top < 0) return;
  const s = t.seats[top]!;
  const extra = s.bet - second;
  if (extra <= 0) return;
  s.bet -= extra;
  s.total -= extra;
  s.stack += extra;
  if (s.status === 'allin') s.status = 'active';
  t.uncalled = { seat: top, amount: extra };
}

function endByFold(t: Table): void {
  returnUncalled(t);
  const w = live(t)[0]!;
  const amount = t.seats.reduce((a, s) => a + s.total, 0);
  t.seats[w]!.stack += amount;
  finishHand(t, { shown: [], pots: [{ amount, winners: [{ seat: w, won: amount }] }], byFold: true });
}

/** 按每个人的投入分层做主池、边池。弃了牌的人的钱留在池里，但他没资格分 */
export function buildPots(totals: readonly number[], live: readonly boolean[]): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(totals.filter((x, i) => live[i] && x > 0))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (const x of totals) amount += Math.min(x, lv) - Math.min(x, prev);
    pots.push({ amount, eligible: totals.flatMap((x, i) => (live[i] && x >= lv ? [i] : [])) });
    prev = lv;
  }
  // 弃牌的人投得比所有没弃的人都多（多出来的那部分没人跟、但他已经弃了）：并进最后一个池
  const rest = totals.reduce((a, x) => a + x, 0) - pots.reduce((a, p) => a + p.amount, 0);
  if (rest > 0 && pots.length) pots[pots.length - 1]!.amount += rest;
  return pots;
}

function showdown(t: Table): void {
  const n = t.seats.length;
  const value = t.seats.map((s) => (s.status === 'active' || s.status === 'allin' ? evalCards([...s.hole, ...t.board]) : -1));
  const pots = buildPots(
    t.seats.map((s) => s.total),
    value.map((v) => v >= 0),
  );
  // 零头从按钮左手第一个有资格的人开始发
  const order = Array.from({ length: n }, (_, i) => (t.button + 1 + i) % n);
  const won = new Array<number>(n).fill(0);
  const result: Pot[] = pots.map((p) => {
    const best = Math.max(...p.eligible.map((i) => value[i]!));
    const ws = order.filter((i) => p.eligible.includes(i) && value[i] === best);
    const share = Math.floor(p.amount / ws.length);
    let odd = p.amount - share * ws.length;
    const winners = ws.map((seat) => {
      const w = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      won[seat]! += w;
      return { seat, won: w };
    });
    return { amount: p.amount, winners };
  });
  for (let i = 0; i < n; i++) t.seats[i]!.stack += won[i]!;
  // 亮牌顺序：河牌圈最后下注的人先亮，没人下注从按钮左手开始；之后能赢或打平当前最好的才亮，赢到钱的一定亮
  const start = t.lastAggr >= 0 && value[t.lastAggr]! >= 0 ? t.lastAggr : order.find((i) => value[i]! >= 0)!;
  const shown: HandResult['shown'] = [];
  let best = -1;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const v = value[i]!;
    if (v < 0) continue;
    if (t.runout || won[i]! > 0 || v >= best) {
      shown.push({ seat: i, hole: [...t.seats[i]!.hole], value: v });
      best = Math.max(best, v);
    }
  }
  finishHand(t, { shown, pots: result, byFold: false });
}

function finishHand(t: Table, r: Omit<HandResult, 'handNo' | 'board' | 'uncalled'>): void {
  t.lastHand = { handNo: t.handNo, board: [...t.board], uncalled: t.uncalled, ...r };
  t.uncalled = null;
  // 停着等下一手时留下各家的底牌，好让人主动亮（离桌的座位下面会清空，留下的牌也作废）；不停着的直接发下一手，没有亮牌的时候
  if (t.holdHands) t.kept = t.seats.map((s) => (s.status === 'out' || s.leaving ? [] : [...s.hole]));
  const won = new Array<number>(t.seats.length).fill(0);
  for (const p of r.pots) for (const w of p.winners) won[w.seat]! += w.won;
  for (let i = 0; i < t.seats.length; i++) {
    const s = t.seats[i]!;
    const dealt = s.status !== 'out';
    if (dealt) setTilt(s, s.total - won[i]! >= TILT_LOSS_BB * t.bb ? TILT_HANDS : (s.tilt ?? 0) - 1);
    s.status = 'out';
    s.hole = [];
    s.bet = 0;
    s.total = 0;
    s.acted = false;
    s.actedAt = 0;
    if (dealt) {
      s.timeouts = s.timedOut ? s.timeouts + 1 : 0;
      if (s.timeouts >= AWAY_AFTER_TIMEOUTS) {
        s.away = true;
        s.timeouts = 0;
      }
    }
    s.timedOut = false;
    if (s.leaving) removeSeat(t, i);
    // 电脑输光了：换一个电脑坐进来。一手打完先停着时，等发下一手再换（结果还摆着，不能让新来的顶着上一个人亮的牌）
    else if (!t.holdHands) refill(t, i);
  }
  t.phase = 'idle';
  t.toAct = null;
  t.board = [];
  t.deck = [];
  t.deckPos = 0;
  t.runout = false;
  if (t.holdHands) t.hold = true;
  else startHand(t);
}

/**
 * 主动亮牌（0.19.0）：只在一手打完停着时，亮自己刚才的一张或两张。摊牌已经亮了的不用再亮；
 * 同一家再亮一次（先一张、再两张）就换掉原来那条，亮过的不能收回
 */
function showCards(t0: Table, seat: number, cards: unknown): Table | Fail {
  const hole = t0.kept?.[seat];
  if (!t0.hold || !t0.lastHand || !hole || hole.length !== 2) return { error: 'cannot_show' };
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 2 || !cards.every((k) => k === 0 || k === 1) || new Set(cards).size !== cards.length) return { error: 'bad_cards' };
  if (t0.lastHand.shown.some((x) => x.seat === seat)) return { error: 'already_shown' };
  const before = t0.lastHand.showed?.find((x) => x.seat === seat)?.cards ?? [];
  const picked = hole.filter((c, k) => cards.includes(k) || before.includes(c));
  if (picked.length === before.length) return { error: 'already_shown' };
  const t = structuredClone(t0);
  const r = t.lastHand!;
  r.showed = [...(r.showed ?? []).filter((x) => x.seat !== seat), { seat, cards: picked }];
  return t;
}

/** 上头的手数：0 以下就删掉字段（状态里不留 tilt: 0，和没有这个字段的旧状态一样） */
function setTilt(s: SeatState, n: number): void {
  if (n > 0) s.tilt = n;
  else delete s.tilt;
}

/** 人离开牌桌：真人的筹码进待结算，电脑的筹码收回庄家 */
function removeSeat(t: Table, seat: number): void {
  const s = t.seats[seat]!;
  t.bank -= s.stack;
  if (s.owner === 'house') t.house = (t.house ?? 0) - s.stack;
  if (s.owner === 'player' && s.stack > 0) t.out.push({ id: `p${++t.opSeq}`, seat, amount: s.stack });
  t.seats[seat] = emptySeat();
  forget(t, seat);
}

/**
 * 座位换了人（0.19.1）：上一个人留着等亮的底牌作废、亮过的收起来。不清的话，停着时有人离桌、别人马上坐进同一个座位，
 * view 会把上一个人的两张当成新来的人的 kept 下发（主线审 0.19.0 时指出）
 */
function forget(t: Table, seat: number): void {
  if (t.kept?.[seat]) t.kept[seat] = [];
  // 他亮过的牌是公开的，但按座位号摆：不收的话这一手剩下的几秒里会摆在新来的人座位上（0.19.2）
  const r = t.lastHand;
  if (r?.showed?.some((x) => x.seat === seat)) r.showed = r.showed.filter((x) => x.seat !== seat);
}

function putHouse(t: Table, seat: number): void {
  const r = stream(t.seed, RNG.house, t.opSeq++);
  const used = new Set(t.seats.filter((s) => s.owner === 'house').map((s) => s.persona));
  const free = Array.from({ length: PERSONA_COUNT }, (_, i) => i).filter((i) => !used.has(i));
  // 按这一桌电脑的强弱档的权重挑（stakes.ts 的 LEVEL_HOUSE）；最强档按 STRONG 的顺序挑桌上还没有的最强的。随机数照样取，后面的筹码、状态一样分流
  const lv = levelOf(t);
  const w = LEVEL_HOUSE[lv] ?? LEVEL_HOUSE[0]!;
  let x = r.below(free.reduce((a, i) => a + w[i]!, 0));
  const persona = lv >= 5 ? STRONG.find((i) => !used.has(i))! : free.find((i) => (x -= w[i]!) < 0)!;
  const stack = t.bb * (HOUSE_MIN_BB + r.below(HOUSE_MAX_BB - HOUSE_MIN_BB + 1));
  t.seats[seat] = { ...emptySeat(), owner: 'house', persona, stack, form: drawForm(r), start: stack };
  forget(t, seat);
  t.bank += stack;
  t.house = (t.house ?? 0) + stack;
}

/** 抽电脑这一场的状态（0.5.0，SeatState.form）：松紧、激进各 ±FORM_SWING，诈唬 ×0.7–1.3，想得快慢 ×0.8–1.25 */
export function drawForm(r: RandomStream): number[] {
  return [r.below(2 * FORM_SWING + 1) - FORM_SWING, r.below(2 * FORM_SWING + 1) - FORM_SWING, 700 + r.below(601), 800 + r.below(451)];
}

/** 坐下、补码、回来时顺手开一手：空闲、而且不是"一手刚打完、停着等发"的时候 */
function autoStart(t: Table): void {
  if (t.phase === 'idle' && !t.hold) startHand(t);
}

const canPlay = (s: SeatState): boolean => s.owner !== 'none' && s.stack > 0 && !s.away && !s.leaving;

/**
 * 够人就开下一手：至少两个能打的，其中真人至少 minHumans 个（默认 1；全是电脑或真人都暂离时停着等人，不白打）。
 * 好友房是 2（0.4.0）：真人走得只剩一个、或者另一个暂离了，这一手照常打完，下一手不发，停着等人
 */
function startHand(t: Table): void {
  const players = t.seats.flatMap((s, i) => (canPlay(s) ? [i] : []));
  if (players.length < 2 || players.filter((i) => t.seats[i]!.owner === 'player').length < (t.minHumans ?? 1)) {
    t.phase = 'idle';
    return;
  }
  t.handNo++;
  t.button =
    t.button < 0 ? players[stream(t.seed, RNG.button).below(players.length)]! : nextSeat(t, t.button, canPlay)!;
  t.deck = shuffle(DECK, stream(t.seed, RNG.deal, t.handNo));
  t.deckPos = 0;
  t.board = [];
  t.log = [];
  t.lastAggr = -1;
  t.runout = false;
  for (const i of players) {
    const s = t.seats[i]!;
    s.status = 'active';
    s.hole = [t.deck[t.deckPos++]!, t.deck[t.deckPos++]!];
    s.seen = s.seen ?? [0, 0, 0, 0, 0];
    s.seen[0]!++;
  }
  // 两人桌：按钮位交小盲、翻牌前先说话
  const sb = players.length === 2 ? t.button : nextSeat(t, t.button, (s) => s.status === 'active')!;
  const bb = nextSeat(t, sb, (s) => s.status === 'active')!;
  t.phase = 'preflop';
  for (const [seat, amount, act] of [
    [sb, t.sb, 'sb'],
    [bb, t.bb, 'bb'],
  ] as const) {
    const a = Math.min(amount, t.seats[seat]!.stack);
    pay(t, seat, a);
    t.log.push({ seat, act, amount: a, ...(t.seats[seat]!.status === 'allin' ? { allin: true as const } : {}) });
  }
  t.currentBet = t.bb;
  t.minRaise = t.bb;
  t.toAct = nextSeat(t, bb, needsToAct(t));
  if (t.toAct === null) endStreet(t);
}
