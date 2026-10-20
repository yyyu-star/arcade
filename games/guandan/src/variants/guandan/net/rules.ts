/**
 * 联机房间用的掼蛋规则（arcade-kit 的 RoomGame）：房间（Worker 里的 Durable Object）和浏览器共用，纯函数。
 *
 * - 状态 NetState：完整牌局 + 这一步的事件 + 一副结束时的下一副预告。事件放在状态里，是因为房间广播的每一帧只是"某个座位的视图"，
 *   浏览器要靠这一步的事件播放动画（出牌飞入、接风、名次……）；视图里的 step 用来认出"这一帧有没有新事件"（入座、掉线这类广播会重发同一个状态）。
 * - 操作 NetAction：玩家发来的"想做什么"，不带座位（座位由房间按连接认）。
 * - 一副结束（docs 9.1）：结算页上每个真人点"继续"（ready），电脑和托管座位由房间立刻代点（ai），没点的真人 20 秒到点由房间代点（timeout）；
 *   最后一个人准备好的那一步里直接开下一副。玩家不能直接开下一副（没有这个操作），电脑拿了头游也不会一闪而过。
 *   "这一刻谁能出手"用 actors()（结算时是所有还没准备的座位，双下进贡/还贡时是两个人），时限用 turnMs()——arcade-kit 0.1.1 的可选接口。
 * - 视图 NetView：viewFor（只有这个座位能看到的）+ eventsFor 裁剪过的事件 + 预告。没入座的人用 seat = -1 的公开视图。
 *   种子、别人的手牌都不在里面。
 * - 错误码：房间会把 apply 的错误原样发给出手的人，只能是固定短码（小写字母、数字、下划线）。
 */
import { EMOTE_COUNT } from '../../../net/emotes.ts';
import type { RoomGame } from 'arcade-kit/game';
import { canRebuy, parseRoomOpts, stakeBegin, stakeDeal, stakeFinish, stakeRebuy, stakeSeated, stakeSettled, stakeView, type RoomOpts, type StakeEffect, type StakeTable, type StakeView } from './stake.ts';
import { type Entropy, stream } from 'arcade-kit/rng';
import { decide, type Difficulty, type PersonaId } from '../ai/index.ts';
import type { FunBot } from 'arcade-kit/fun-logic';
import { TEMPER } from './fun-moments.ts';
import { botFor } from '../ai/venue.ts';
import { emptyMatchLog, logDeal, type MatchLog } from '../stake/titles.ts';
import {
  RULES_VERSION,
  createKeyedGame,
  hashSeed,
  dispatch,
  eventsFor,
  previewNext,
  seatsToAct,
  timeoutAction,
  viewFor,
  type Card,
  type GameEvent,
  type GameState,
  type NextPreview,
  type PlayType,
  type PlayerView,
  type SeatAction,
} from '../core/index.ts';

export interface NetState {
  g: GameState;
  /** 最近一步的事件（完整的，下发前按座位裁剪） */
  ev: GameEvent[];
  /** 一副结束时下一副谁进贡；其他时候 null */
  next: NextPreview | null;
  /** 一副结束时各座位（真实座位）点没点"继续"；其他时候 null */
  ready: boolean[] | null;
  /** 实盘房间的桌（0.5.0，src/net/stake.ts）；娱乐房间没有 */
  stake?: StakeTable;
  /** 每个真实座位现在是不是真人（0.6.0：一个真人都没了就结束房间）；0.6.0 以前开的局没有 */
  humans?: boolean[];
  /** 娱乐房间打完一整场后"再来一场"（0.6.2）：谁开了哪个新房间；没人点、停够了是 null；还在等是 undefined */
  again?: Again | null;
  /** 每个真实座位连着被房间代出了几手（0.6.3）：到 IDLE_AFTER 就算走开了、每手只等 IDLE_MS；自己出一手或者点"我回来了"清零。0.6.3 以前开的局没有 */
  idle?: number[];
  /** 这一场攒的公开记录（0.14.0，结束颁奖用，src/net/awards.ts）：每副的名次、炸弹、赢家，按真实座位。0.14.0 以前开的局没有 */
  log?: MatchLog;
}

/** 新房间的码和点的人（真实座位），所有人看得到：大家跟着进同一个房间 */
export interface Again {
  code: string;
  by: number;
}

/** idle：这一手是房间到点代出的（只有 timeout 会带；浏览器发来的经过 parse 不会有），用来数"连着几手没自己出"（0.6.3） */
export type NetAction = (
  | { type: 'play'; cards: Card[]; as?: { type: PlayType; rank: number; extra?: number } }
  | { type: 'pass' }
  | { type: 'tribute'; card: Card }
  | { type: 'return'; card: Card }
  /** 结算页上点"继续"：我准备好打下一副了 */
  | { type: 'ready' }
  /** 实盘房间带入被拒以后点"重新带入"（0.6.0，不轮流的操作） */
  | { type: 'buyin' }
  /** 娱乐房间打完一整场：我开好了新房间，叫大家一起过去（0.6.2，不轮流的操作） */
  | { type: 'again'; code: string }
  /** 托管中点"我回来了"（0.6.3，不轮流的操作） */
  | { type: 'back' }
) & { idle?: true };

export interface NetView {
  view: PlayerView;
  /** 这一步的事件（已按座位裁剪）；view.step 没变的帧里是旧事件，浏览器不再播放 */
  events: GameEvent[];
  next: NextPreview | null;
  /** 一副结束时谁点了"继续"（公开信息） */
  ready: boolean[] | null;
  /** 实盘房间：每个座位的分和到账情况（被拒的原因只给自己）；娱乐房间没有 */
  stake?: StakeView;
  /** 再来一场（0.6.2）：同 NetState.again；不是在等再来一场时没有 */
  again?: Again | null;
  /** 每个座位是不是走开了、房间在替他快速代出（0.6.3，公开：大家看得到他为什么出得快）；0.6.3 以前开的局没有 */
  afk?: boolean[];
  /** 这一场的公开记录（0.14.0，同 NetState.log）：名次、炸弹谁都看得见，大家算出来的奖一样 */
  log?: MatchLog;
}

/** 结算页等大家点"继续"最多多久（docs 9.1） */
export const READY_MS = 20_000;
/** 其他时候每手的时限，和 arcade-kit 默认的 turnMs 一样 */
export const TURN_MS = 30_000;
/** 娱乐房间打完一整场后等"再来一场"多久：没人点就结束房间、还开房名额 */
export const AGAIN_MS = 180_000;
/**
 * 人还连着、但走开了（0.6.3）：连着 IDLE_AFTER 手到点被代出，之后轮到他每手只等 IDLE_MS 就代出，别的三个人不用每手干等 30 秒。
 * 他自己出一手、或者点"我回来了"马上恢复。掉线的人由房间另算（60 秒宽限后电脑托管）
 */
export const IDLE_AFTER = 2;
export const IDLE_MS = 3_000;

/**
 * arcade-kit 0.1.1 的可选接口，这里都写上（测试直接调）：
 * actors 是这一刻可以出手的座位和"这一组"的名字（电脑、托管的由房间立刻代出，真人谁先发都收，到点对没出的真人用 timeout 代出；
 * 房间按 group 认"还是不是同一组"，同组里有人出手不重新计时）。牌局没完时 actors 不能是空的，房间会当成打完了。
 * turnMs 是这一手（这一组）的时限。timeout 必须合法（被拒时房间先改用 ai，再拒就推后 60 秒）。
 */
interface GroupTurn {
  begin(entropy: Entropy, rulesVersion: number, setup?: { opts: RoomOpts | undefined; seats: ('empty' | 'human' | 'ai')[] }): NetState;
  breakPoint(state: NetState): boolean;
  actors(state: NetState): { seats: number[]; group: string };
  turnMs(state: NetState): number;
  timeout(state: NetState, seat: number): NetAction;
}

/**
 * 房间里电脑的随机流：联机牌局从密钥另分一条（用途 room-ai，序号是步数），和发牌的流互不相干；
 * 0.2.x 开的旧局（按种子发牌）照旧用种子
 */
function aiSeed(g: GameState): number | string {
  return g.key ? stream(g.key, 'room-ai', g.step).u32() : `${g.seed}|room`;
}

/** 这一场电脑的状态按它抽（每场不同、整场不变）；和 aiSeed 一样从密钥另分一条 */
function formSeed(g: GameState): number | string {
  return g.key ? stream(g.key, 'room-form', 0).u32() : `${g.seed}|room-form`;
}

/**
 * 房间里这个座位的电脑怎么打（docs/ai.md、docs/stake.md 3.1）：电脑座位按场地取强弱，按真实座位带性格。
 * 掉线太久、房间替真人代打的座位不带性格（替人打牌不该带着老张的脾气），强弱照旧：实盘最强、娱乐普通
 */
function roomBot(s: NetState, seat: number): { difficulty: Difficulty; persona?: PersonaId } {
  if (s.humans?.[seat]) return { difficulty: s.stake ? 'hard' : 'normal' };
  return botFor(s.stake ? { kind: 'roomStake', tier: s.stake.tier } : { kind: 'room' }, seat);
}

/**
 * 房间里的电脑和它们的互动性格（0.12.0 起给 kit 的 botReact）：只算真电脑的座位（替掉线真人代打的不算，不替人说话）。
 * 0.6.0 以前开的局没有 humans，不互动
 */
export function funBots(s: NetState): FunBot[] {
  if (!s.humans) return [];
  const out: FunBot[] = [];
  for (let seat = 0; seat < 4; seat++) {
    if (s.humans[seat]) continue;
    const persona = roomBot(s, seat).persona;
    if (persona) out.push({ seat, temper: TEMPER[persona] });
  }
  return out;
}

/**
 * 只给测试、模拟器用：从一个种子算出一把固定的"密钥"，让联机规则的测试可以复现。它只有种子那么多种可能，不安全，
 * 房间里绝不用它（房间的熵来自 crypto.getRandomValues）
 */
export function testKey(seed: string | number): number[] {
  return Array.from({ length: 8 }, (_, i) => hashSeed(seed, 'test-key', i));
}


const PLAY_TYPES: readonly PlayType[] = ['single', 'pair', 'triple', 'fullHouse', 'straight', 'tube', 'plate', 'bomb', 'straightFlush', 'jokerBomb'];

const isCard = (x: unknown): x is Card => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 108;
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** 校验浏览器发来的操作，只留认得的字段；不合格返回 null（房间回 bad_action） */
export function parseNetAction(raw: unknown): NetAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'pass':
      return { type: 'pass' };
    case 'ready':
      return { type: 'ready' };
    case 'buyin':
      return { type: 'buyin' };
    case 'back':
      return { type: 'back' };
    case 'again':
      return typeof r.code === 'string' && /^\d{6}$/.test(r.code) ? { type: 'again', code: r.code } : null;
    case 'tribute':
    case 'return':
      return isCard(r.card) ? { type: r.type, card: r.card } : null;
    case 'play': {
      const cards = r.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 27 || !cards.every(isCard)) return null;
      if (new Set(cards).size !== cards.length) return null;
      const out: NetAction = { type: 'play', cards: [...cards] };
      if (r.as !== undefined) {
        const as = r.as as Record<string, unknown> | null;
        if (!as || typeof as !== 'object' || !PLAY_TYPES.includes(as.type as PlayType) || !isInt(as.rank, 1, 17)) return null;
        if (as.extra !== undefined && !isInt(as.extra, -1, 17)) return null;
        out.as = { type: as.type as PlayType, rank: as.rank, ...(as.extra !== undefined ? { extra: as.extra as number } : {}) };
      }
      return out;
    }
    default:
      return null;
  }
}

/** 核心的错误（中文，给单机界面看的）→ 发给浏览器的固定短码 */
const ERROR_CODES: Record<string, string> = {
  整局已经结束: 'game_over',
  这一副还没打完: 'deal_not_over',
  现在不是进贡的时候: 'wrong_phase',
  现在不是还贡的时候: 'wrong_phase',
  现在不是出牌的时候: 'wrong_phase',
  这个座位不用进贡: 'not_your_turn',
  这个座位不用还贡: 'not_your_turn',
  还没轮到你: 'not_your_turn',
  该你领出不能不要: 'must_lead',
  '该你领出，不能不要': 'must_lead',
  同一张牌选了两次: 'bad_cards',
  手里没有这些牌: 'bad_cards',
  不是合法的牌型: 'bad_pattern',
  这些牌不能当作指定的牌型: 'bad_pattern',
  压不过上家: 'cannot_beat',
  '必须进贡手里最大的牌（红桃级牌除外）': 'bad_tribute',
};

function errorCode(message: string): string {
  if (ERROR_CODES[message]) return ERROR_CODES[message]!;
  if (message.startsWith('还贡只能还')) return 'bad_return';
  if (message.includes('版本')) return 'rules_version';
  return 'illegal_move';
}

/** 浏览器显示用：短码 → 大白话 */
export const ERROR_TEXT: Record<string, string> = {
  game_over: '这局已经打完了',
  deal_not_over: '这一副还没打完',
  wrong_phase: '现在不能这么出',
  not_your_turn: '还没轮到你',
  must_lead: '该你先出，不能不要',
  bad_cards: '手里没有这些牌',
  bad_pattern: '不是能出的牌型',
  cannot_beat: '压不过上家',
  bad_tribute: '要进贡手里最大的牌（红桃级牌除外）',
  bad_return: '还贡只能还 10 或以下的牌，不能还级牌和王',
  rules_version: '规则更新了，刷新页面再打',
  illegal_move: '这手牌出不了',
  stale: '牌局刚变了，看一眼再出',
  bad_action: '这手牌出不了',
  not_seated: '先坐下再出牌',
  not_playing: '牌局还没开始',
  not_host: '只有开房的人能开局',
  already_started: '已经开局了',
  seat_taken: '这个座位有人了',
  already_seated: '你已经坐下了',
  rule_error: '出了点问题，再试一次',
  already_ready: '已经点过继续了，等其他人',
  cannot_buyin: '现在带不了：这一场打完了，或者上一份还在办',
  cannot_again: '已经有人开了新房间，正在过去',
  not_away: '你已经回来了',
  // 开打后座位绑人（arcade-kit 0.1.1）：坐过的人只能回原座位；别人坐过的电脑座位谁也接管不了
  not_your_seat: '座位被占：你只能回自己原来的座位',
  seat_reserved: '座位被占：这是别人的座位，电脑在替他打',
};

function step(s: NetState, a: SeatAction | { type: 'nextDeal' }): NetState | { error: string } {
  const r = dispatch(s.g, a);
  if (r.error) return { error: errorCode(r.error) };
  const end = r.state.phase === 'dealEnd';
  const out: NetState = { g: r.state, ev: r.events, next: end ? previewNext(r.state) : null, ready: end ? [false, false, false, false] : null };
  if (s.humans) out.humans = s.humans;
  if (s.idle) out.idle = s.idle;
  if (s.log) {
    let m = s.log;
    for (const e of r.events) if (e.type === 'dealEnd') m = logDeal(m, e.result, r.state.history);
    out.log = m;
  }
  if (s.stake) {
    let t = s.stake;
    for (const e of r.events) if (e.type === 'dealEnd') t = stakeDeal(t, e.result, r.state.phase, r.state.history);
    out.stake = t;
  }
  return out;
}

/**
 * 在等"再来一场"：娱乐房间打完一整场、还有真人、还没人点也没停够。实盘房间打完就结回，不在这里等；
 * 0.6.0 以前开的局不知道谁是真人，照旧打完就结束
 */
function waitingAgain(s: NetState): boolean {
  return s.g.phase === 'gameOver' && !s.stake && s.again === undefined && !!s.humans?.some(Boolean);
}

const isAfk = (s: NetState, seat: number): boolean => (s.idle?.[seat] ?? 0) >= IDLE_AFTER;

/** 记下这个座位这一步是不是被代出的：代出的连着数，自己出的（含"我回来了"）清零。0.6.3 以前开的局不记 */
function countIdle(s: NetState, seat: number, idle: boolean): NetState {
  if (!s.idle) return s;
  const n = idle ? s.idle[seat]! + 1 : 0;
  return n === s.idle[seat] ? s : { ...s, idle: s.idle.map((x, i) => (i === seat ? n : x)) };
}

function applyAction(s: NetState, seat: number, a: NetAction): NetState | { error: string } {
  switch (a.type) {
    case 'back':
      return isAfk(s, seat) ? { ...s, ev: [] } : { error: 'not_away' };
    case 'again':
      if (!waitingAgain(s)) return { error: 'cannot_again' };
      return { ...s, ev: [], again: { code: a.code, by: seat } };
    case 'buyin':
      if (!s.stake || !canRebuy(s.stake, seat)) return { error: 'cannot_buyin' };
      return { ...s, ev: [], stake: stakeRebuy(s.stake, seat) };
    case 'ready': {
      if (s.g.phase !== 'dealEnd' || !s.ready) return { error: 'wrong_phase' };
      if (s.ready[seat]) return { error: 'already_ready' };
      const ready = s.ready.map((r, i) => r || i === seat);
      // 最后一个人准备好：这一步里直接开下一副（发牌、进贡的事件跟着这一帧下去）
      if (ready.every(Boolean)) return step(s, { type: 'nextDeal' });
      return { ...s, ev: [], ready };
    }
    default: {
      // idle 只是房间自己的记号，不进规则核心
      const { idle: _idle, ...rest } = a;
      return step(s, { ...rest, seat } as SeatAction);
    }
  }
}

/** 一副结束时还没点"继续"的座位 */
function notReady(s: NetState): number[] {
  return s.ready ? [0, 1, 2, 3].filter((i) => !s.ready![i]) : [];
}

function withoutSeat(a: SeatAction): NetAction {
  switch (a.type) {
    case 'play':
      return a.as ? { type: 'play', cards: a.cards, as: a.as } : { type: 'play', cards: a.cards };
    case 'pass':
      return { type: 'pass' };
    case 'tribute':
      return { type: 'tribute', card: a.card };
    case 'return':
      return { type: 'return', card: a.card };
  }
}

// 三个可选接口按更具体的形状声明（测试直接读 actors(s).seats），整体仍然是 RoomGame
export const guandanRoom: Omit<RoomGame<NetState, NetAction, NetView, RoomOpts, StakeEffect>, keyof GroupTurn> & GroupTurn = {
  seats: 4,
  rulesVersion: RULES_VERSION,
  // 开房选项（kit 0.4.0，开房时定、之后不能改）：娱乐，或者实盘的档位
  options: parseRoomOpts,
  seatCount: () => 4,
  // 快捷短语（kit 0.6.0）：房间只认编号，文字在 emotes.ts
  emotes: EMOTE_COUNT,
  // 好友房打字聊天（kit 0.18.0，仓库根 docs/social.md 3.1）：房间过滤、限速后只转发，不进状态、不写存储；电脑不读
  chat: true,
  // 房间开局给 256 位熵（arcade-kit 0.2.0 的 begin），当发牌的密钥；状态里不留种子。规则版本由核心自己记进状态
  begin: (entropy, _rv, setup) => {
    const { state, events } = createKeyedGame(entropy);
    const out: NetState = { g: state, ev: events, next: null, ready: null, log: emptyMatchLog() };
    if (setup) {
      out.humans = setup.seats.map((k) => k === 'human');
      out.idle = [0, 0, 0, 0];
    }
    const tier = setup?.opts?.stake;
    if (tier) out.stake = stakeBegin(entropy, tier, setup.seats);
    return out;
  },
  // kit 0.2.0 还要求有 start（32 位种子，能被反推）；写了 begin 房间就不会调它，万一被调到也不能悄悄用种子开局
  start: () => {
    throw new Error('guandan online games start with begin(entropy)');
  },
  // 一副打完停在结算页：当天写入额度满了时房间在这里收场（arcade-kit 0.2.0）
  breakPoint: (s) => s.g.phase === 'dealEnd',
  parse: parseNetAction,
  // 重新带入、再来一场、我回来了什么时候都能点，不看轮没轮到（kit 0.3.0 的 free）；能不能做由 apply 判断
  free: (a) => a.type === 'buyin' || a.type === 'again' || a.type === 'back',
  apply: (s, seat, a) => {
    const out = applyAction(s, seat, a);
    return 'error' in out ? out : countIdle(out, seat, a.idle === true);
  },
  // 写了 actors 的房间不再看 turn；留着是 RoomGame 必填，和 actors 的第一个座位一致
  turn: (s) => guandanRoom.actors(s).seats[0] ?? null,
  actors: (s) => {
    const d = s.g.dealNo;
    switch (s.g.phase) {
      case 'play':
        // 每一手都是新的一组（step 每手加一）
        return { seats: s.g.turn >= 0 ? [s.g.turn] : [], group: `play-${d}-${s.g.step}` };
      case 'tribute':
        return { seats: seatsToAct(s.g), group: `tribute-${d}` };
      case 'return':
        return { seats: seatsToAct(s.g), group: `return-${d}` };
      case 'dealEnd':
        return { seats: notReady(s), group: `settle-${d}` };
      default:
        return { seats: [], group: 'over' };
    }
  },
  // 这一手（组）要等的人都走开了：只等 IDLE_MS（0.6.3）
  turnMs: (s) => {
    const seats = guandanRoom.actors(s).seats;
    if (seats.length && seats.every((x) => isAfk(s, x))) return IDLE_MS;
    return s.g.phase === 'dealEnd' ? READY_MS : TURN_MS;
  },
  view: (s, seat) => {
    const me = seat ?? -1;
    const v: NetView = { view: viewFor(s.g, me), events: eventsFor(s.ev, me), next: s.next, ready: s.ready };
    if (s.stake) v.stake = stakeView(s.stake, me);
    if (s.again !== undefined) v.again = s.again;
    if (s.idle) v.afk = s.idle.map((_, i) => isAfk(s, i));
    if (s.log) v.log = s.log;
    return v;
  },
  ai: (s, seat) => {
    if (s.g.phase === 'dealEnd') return { type: 'ready' };
    const a = decide(viewFor(s.g, seat), { seed: aiSeed(s.g), match: formSeed(s.g), ...roomBot(s, seat) });
    if (a && a.type !== 'nextDeal') return withoutSeat(a);
    const t = timeoutAction(viewFor(s.g, seat));
    return t ? withoutSeat(t) : { type: 'pass' };
  },
  // 到点代出的都带 idle 记号（0.6.3），apply 拿它数"连着几手没自己出"
  timeout: (s, seat) => {
    if (s.g.phase === 'dealEnd') return { type: 'ready', idle: true };
    const t = timeoutAction(viewFor(s.g, seat));
    return { ...(t ? withoutSeat(t) : guandanRoom.ai(s, seat)), idle: true };
  },
  // 实盘房间：一场（5 副、过 A、到账的都封顶）打完就结束，结回由 effects 接着办。
  // 真人都点了"离开"（0.6.0 起没真人就结束）：也算打完，kit 马上还开房名额；带入还在路上的等它办完再算（到账了要原样结回）。
  // 只是掉线的人座位还是真人的，不算没人（房间按 noHumanMs 另算）。一副打到一半走的要等电脑把这副打完、按打完的分结回（0.12.4），也先不算完
  // 娱乐房间打完一整场先不算完（0.6.2）：停 AGAIN_MS 等人点"再来一场"，点了或者停够了才算
  over: (s) =>
    (s.g.phase === 'gameOver' && !waitingAgain(s)) || s.stake?.over === true || (s.humans !== undefined && !s.humans.some(Boolean) && !s.stake?.pending.some((e) => e.kind === 'in') && !s.stake?.leaving?.some(Boolean)),
  // 等"再来一场"时谁也不用出手：由房间停着计时（kit 0.5.0），电脑、托管的座位不会被代出
  pause: (s) => (waitingAgain(s) ? AGAIN_MS : null),
  resume: (s) => ({ ...s, ev: [], again: null }),
  // 座位换人（kit 0.3.0）：记下谁是真人；实盘的带入、离开结回在 stakeSeated
  seated: (s, seat, kind) => {
    const humans = s.humans?.map((h, i) => (i === seat ? kind === 'human' : h));
    const t = s.stake ? stakeSeated(s.stake, seat, kind, s.g.phase) : undefined;
    if (!humans && t === s.stake) return s;
    // ev 清空：这一步不是出牌，上一步的事件留着会让 onStep（名场面、搭子战绩）再看到一遍
    return { ...s, ev: [], ...(humans ? { humans } : {}), ...(t ? { stake: t } : {}) };
  },
  effects: (s) => s.stake?.pending ?? [],
  // 钱包办完、关房收场都不是出牌：ev 清空，同 seated
  settled: (s, id, result) => (s.stake ? { ...s, ev: [], stake: stakeSettled(s.stake, id, result) } : s),
  closing: (s) => (s.stake && !s.stake.over ? { ...s, ev: [], stake: stakeFinish(s.stake) } : s),
};
