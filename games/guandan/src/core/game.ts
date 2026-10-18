/**
 * 整局状态机：发牌 → 进贡/抗贡 → 还贡 → 出牌（不要、接风）→ 名次与升级 → 下一副，直到某队过 A。
 *
 * 纯函数：dispatch(state, action) 不修改传入的 state，返回新状态和本步事件。
 * 状态是普通 JSON（牌是整数），可以直接存档；同一种子 + 同一串动作，结果逐位相同。
 * 座位 0..3 按出牌顺序排列，next(s) = (s + 1) % 4 是下家；对家同队：队伍 = 座位 % 2。
 */
import { ACE, BIG_JOKER, HAND_SIZE, SMALL_JOKER, cardValue, fullDeck, isJoker, isWild, rankOf, sortHand, suitOf, type Card } from './cards.ts';
import { resolveOptions, type Options } from './options.ts';
import { beats, chooseInterpretation, interpret, playsBeating, samePlayShape, bombTier, type Play, type PlayType } from './patterns.ts';
import { rngFor } from './rng.ts';
import { type Entropy, isEntropy, shuffle as keyedShuffle, stream } from 'arcade-kit/rng';

export type Seat = number;
export type Team = number;

/**
 * 规则版本：改了会影响牌局结果的规则（牌型、比大小、进贡、升级、发牌）就加 1，同时让 rulesSupported 继续认旧版本
 * （旧版本的牌局要按旧规则打完）。和状态结构版本 GameState.v 不是一回事：v 管存储格式，这个管玩法。
 * 联机时房间和页面可能新旧并存几十分钟，进行中的牌局按开局时记下的版本打（docs/platform-backend.md 第 4.3 节）。
 */
export const RULES_VERSION = 2;

/**
 * 按种子发牌的规则版本（单机、复现、存档）：同一个种子永远发出同样的牌。版本 2 只差在发牌：
 * 联机房间用 256 位密钥（arcade-kit/rng 的 ChaCha20）发牌，状态里不留种子（0.3.0）。32 位的种子哈希能被玩家拿手牌反推出全桌的牌，联机不能再用。
 * 开局时记下版本，回退到只认 1 的旧代码时，联机牌局会被拒（"刷新页面"），而不是拿空种子接着发牌
 */
export const SEEDED_RULES_VERSION = 1;

/** 这份代码能不能接着打这个规则版本的牌局 */
export function rulesSupported(rules: number): boolean {
  return rules === SEEDED_RULES_VERSION || rules === RULES_VERSION;
}

/** 状态里记的规则版本；0.1.10 及以前的存档没有这个字段，按 1 算 */
export function rulesOf(state: Pick<GameState, 'rules'>): number {
  return (state as Partial<GameState>).rules ?? 1;
}
export type Phase = 'tribute' | 'return' | 'play' | 'dealEnd' | 'gameOver';

export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export const teamOf = (s: Seat): Team => s % 2;
export const partnerOf = (s: Seat): Seat => (s + 2) % 4;
export const nextSeat = (s: Seat): Seat => (s + 1) % 4;

export interface Trick {
  /** 本轮领出的人 */
  leader: Seat;
  /** 本轮目前最大的一手；null 表示还没人出（轮到的人必须领出） */
  last: { seat: Seat; play: Play } | null;
  /** 最后一手之后各座位是否已表示"不要" */
  passed: boolean[];
}

export interface TributeEntry {
  from: Seat;
  /** 受贡的人；双下时两张贡牌都交上来之后才确定，之前为 -1 */
  to: Seat;
  /** 进贡的牌；还没交为 null */
  card: Card | null;
  /** 还贡的牌；还没还为 null */
  back: Card | null;
}

export interface TributeState {
  kind: 'single' | 'double';
  entries: TributeEntry[];
  /** 进贡完成后先出牌的人（贡牌大的进贡者） */
  leader: Seat;
}

export interface DealResult {
  dealNo: number;
  /** 出完的先后顺序（4 个座位）；双下时后两位按出牌顺序补齐 */
  order: Seat[];
  winnerTeam: Team;
  /** 头游所在队升了几级（0 表示过 A 赢下整局或退回打 2） */
  up: number;
  doubleDown: boolean;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  /** 本副打 A 未过的队（-1 表示没有） */
  aFailedTeam: Team;
  /** 本副因打 A 失败次数用完而退回打 2 的队（-1 表示没有） */
  aResetTeam: Team;
}

export interface PlayRecord {
  seat: Seat;
  /** null 表示"不要" */
  play: Play | null;
}

export interface GameState {
  v: 1;
  /** 开局时的规则版本（RULES_VERSION） */
  rules: number;
  /** 单机的种子；联机（有 key）的牌局为空串 */
  seed: string;
  /**
   * 联机牌局的 256 位密钥（8 个 u32，房间开局时用 crypto 生成，arcade-kit 的 begin）：每一副都从 stream(key, 'deal', 第几副) 发牌。
   * 只在服务端的状态里，viewFor 不带它；单机没有这个字段
   */
  key?: number[];
  options: Options;
  /** 已接受的动作数（电脑的随机流用它分流） */
  step: number;
  /** 两队当前级数（2..14） */
  levels: [number, number];
  /** 两队打 A 未过的次数 */
  aFails: [number, number];
  dealNo: number;
  /** 本副打哪一队的级；第一副双方都打 2，为 -1 */
  declarer: Team;
  /** 本副级数（级牌点数） */
  level: number;
  phase: Phase;
  hands: Card[][];
  /** 出牌阶段轮到谁；其他阶段为 -1 */
  turn: Seat;
  trick: Trick;
  /** 本副已出完的座位（先后顺序） */
  finished: Seat[];
  /** 本副全部出牌记录（公开信息） */
  history: PlayRecord[];
  tribute: TributeState | null;
  /** 本副是否抗贡 */
  antiTribute: boolean;
  lastDeal: DealResult | null;
  winner: Team;
}

/** 玩家（或替他代出的电脑）做的动作，都带座位 */
export type SeatAction =
  | { type: 'play'; seat: Seat; cards: Card[]; as?: { type: PlayType; rank: number; extra?: number } }
  | { type: 'pass'; seat: Seat }
  | { type: 'tribute'; seat: Seat; card: Card }
  | { type: 'return'; seat: Seat; card: Card };

/**
 * 牌桌自己推进的动作：开下一副。不属于任何座位——联机时只由房间在全员"准备"或倒计时结束后发出，
 * 玩家发来的一律不收；单机时由本地会话代替房间发出（玩家点"下一副"）。
 */
export type TableAction = { type: 'nextDeal' };

export type Action = SeatAction | TableAction;

/** 是不是玩家能发的动作（房间收到玩家消息时先用它过滤，再核对 seat 是不是这条连接的座位） */
export function isSeatAction(a: Action): a is SeatAction {
  return a.type === 'play' || a.type === 'pass' || a.type === 'tribute' || a.type === 'return';
}

export type GameEvent =
  | { type: 'dealStart'; dealNo: number; level: number; declarer: Team; levels: [number, number] }
  | { type: 'antiTribute'; seats: Seat[] }
  | { type: 'tributeAsked'; payers: Seat[] }
  | { type: 'tribute'; from: Seat; to: Seat; card: Card }
  /** 还贡：card 只有双方看得到，其他座位的视角里为 null */
  | { type: 'returnCard'; from: Seat; to: Seat; card: Card | null }
  | { type: 'lead'; seat: Seat }
  | { type: 'play'; seat: Seat; play: Play; left: number }
  | { type: 'pass'; seat: Seat }
  /** 一轮结束；jiefeng = 出牌的人已出完，由其对家接风 */
  | { type: 'trickWon'; seat: Seat; leader: Seat; jiefeng: boolean }
  | { type: 'finish'; seat: Seat; place: number }
  | { type: 'dealEnd'; result: DealResult }
  | { type: 'gameOver'; winner: Team; levels: [number, number] }
  | { type: 'turn'; seat: Seat };

export interface DispatchResult {
  state: GameState;
  events: GameEvent[];
  /** 非法动作时给出原因，state 原样返回、events 为空 */
  error?: string;
}

/** 状态是纯 JSON 数据，用 JSON 往返深拷贝（不依赖宿主环境的 structuredClone）。 */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function emptyTrick(leader: Seat): Trick {
  return { leader, last: null, passed: [false, false, false, false] };
}

/** 开一局（单机）。seed 决定所有发牌和首出，同一个种子永远同样的结果；options 见 options.ts。 */
export function createGame(seed: string | number, options?: Partial<Options>): { state: GameState; events: GameEvent[] } {
  return newGame(String(seed), undefined, options);
}

/** 开一局（联机）：256 位密钥决定所有发牌和首出，没有种子。 */
export function createKeyedGame(key: Entropy, options?: Partial<Options>): { state: GameState; events: GameEvent[] } {
  if (!isEntropy(key)) throw new Error('key must be 8 u32 words');
  return newGame('', [...key], options);
}

function newGame(seed: string, key: number[] | undefined, options?: Partial<Options>): { state: GameState; events: GameEvent[] } {
  const state: GameState = {
    v: 1,
    rules: key ? RULES_VERSION : SEEDED_RULES_VERSION,
    seed,
    ...(key ? { key } : {}),
    options: resolveOptions(options),
    step: 0,
    levels: [2, 2],
    aFails: [0, 0],
    dealNo: 0,
    declarer: -1,
    level: 2,
    phase: 'play',
    hands: [[], [], [], []],
    turn: -1,
    trick: emptyTrick(0),
    finished: [],
    history: [],
    tribute: null,
    antiTribute: false,
    lastDeal: null,
    winner: -1,
  };
  const events: GameEvent[] = [];
  startDeal(state, events);
  return { state, events };
}

function startDeal(s: GameState, ev: GameEvent[]): void {
  s.dealNo += 1;
  const last = s.lastDeal;
  s.declarer = last ? last.winnerTeam : -1;
  s.level = last ? s.levels[last.winnerTeam]! : 2;
  const deck = s.key ? keyedShuffle(fullDeck(), stream(s.key, 'deal', s.dealNo)) : rngFor(s.seed, 'deal', s.dealNo).shuffle(fullDeck());
  s.hands = SEATS.map((seat) => sortHand(deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE), s.level));
  s.finished = [];
  s.history = [];
  // 上一副最后一轮的牌不留到新的一副（进贡阶段桌上是空的；牌号重新洗过，留着会让人以为是新一副的牌）
  s.trick = emptyTrick(0);
  s.tribute = null;
  s.antiTribute = false;
  s.turn = -1;
  ev.push({ type: 'dealStart', dealNo: s.dealNo, level: s.level, declarer: s.declarer, levels: [...s.levels] });

  if (!last) {
    // 第一副：首出的人由种子抽（实体比赛是翻牌/抽牌定，效果等同随机）
    beginPlay(s, ev, s.key ? stream(s.key, 'firstLead').below(4) : rngFor(s.seed, 'firstLead').int(4));
    return;
  }
  const payers = last.doubleDown ? [last.order[2]!, last.order[3]!] : [last.order[3]!];
  const bigJokers = (seat: Seat) => s.hands[seat]!.filter((c) => rankOf(c) === BIG_JOKER).length;
  const anti = payers.some((p) => bigJokers(p) >= 2) || (s.options.antiTributeCombined && payers.reduce((n, p) => n + bigJokers(p), 0) >= 2);
  if (anti) {
    s.antiTribute = true;
    ev.push({ type: 'antiTribute', seats: payers });
    beginPlay(s, ev, last.order[0]!);
    return;
  }
  s.tribute = {
    kind: last.doubleDown ? 'double' : 'single',
    entries: payers.map((p) => ({ from: p, to: last.doubleDown ? -1 : last.order[0]!, card: null, back: null })),
    leader: -1,
  };
  s.phase = 'tribute';
  ev.push({ type: 'tributeAsked', payers });
}

function beginPlay(s: GameState, ev: GameEvent[], leader: Seat): void {
  s.phase = 'play';
  s.trick = emptyTrick(leader);
  s.turn = leader;
  ev.push({ type: 'lead', seat: leader });
  ev.push({ type: 'turn', seat: leader });
}

/** 进贡时允许交的牌：手里最大的牌（红桃级牌除外），同样大的任选一张。 */
export function tributeChoices(hand: readonly Card[], level: number): Card[] {
  let best = -1;
  for (const c of hand) if (!isWild(c, level)) best = Math.max(best, cardValue(c, level));
  return hand.filter((c) => !isWild(c, level) && cardValue(c, level) === best);
}

/** 还贡时允许还的牌：本位点数不超过 returnMaxRank 且不是级牌；手里没有时可还任意一张非王、非级牌，再没有就任意一张。 */
export function returnChoices(hand: readonly Card[], level: number, opts: Options): Card[] {
  const ok = hand.filter((c) => !isJoker(c) && rankOf(c) !== level && rankOf(c) <= opts.returnMaxRank);
  if (ok.length) return ok;
  const loose = hand.filter((c) => !isJoker(c) && rankOf(c) !== level);
  return loose.length ? loose : [...hand];
}

function removeCards(hand: Card[], cards: readonly Card[]): boolean {
  for (const c of cards) {
    const i = hand.indexOf(c);
    if (i < 0) return false;
    hand.splice(i, 1);
  }
  return true;
}

function giveCard(s: GameState, from: Seat, to: Seat, card: Card): void {
  removeCards(s.hands[from]!, [card]);
  s.hands[to] = sortHand([...s.hands[to]!, card], s.level);
}

/** 当前必须行动的座位（画面用来判断"轮到谁"；出牌阶段只有一个人）。 */
export function seatsToAct(s: GameState): Seat[] {
  switch (s.phase) {
    case 'play':
      return s.turn >= 0 ? [s.turn] : [];
    case 'tribute':
      return s.tribute!.entries.filter((e) => e.card === null).map((e) => e.from);
    case 'return':
      return s.tribute!.entries.filter((e) => e.back === null).map((e) => e.to);
    default:
      return [];
  }
}

const active = (s: GameState, seat: Seat) => !s.finished.includes(seat);

function nextActive(s: GameState, seat: Seat): Seat {
  let x = nextSeat(seat);
  for (let i = 0; i < 4 && !active(s, x); i++) x = nextSeat(x);
  return x;
}

export function dispatch(state: GameState, action: Action): DispatchResult {
  const fail = (error: string): DispatchResult => ({ state, events: [], error });
  if (state.phase === 'gameOver') return fail('整局已经结束');
  if (!rulesSupported(rulesOf(state))) return fail('这局是用别的版本的规则开的，刷新页面后再打');
  const s = clone(state);
  s.rules = rulesOf(state);
  const ev: GameEvent[] = [];

  switch (action.type) {
    case 'nextDeal': {
      if (s.phase !== 'dealEnd') return fail('这一副还没打完');
      startDeal(s, ev);
      break;
    }
    case 'tribute': {
      if (s.phase !== 'tribute' || !s.tribute) return fail('现在不是进贡的时候');
      const entry = s.tribute.entries.find((e) => e.from === action.seat);
      if (!entry || entry.card !== null) return fail('这个座位不用进贡');
      if (!tributeChoices(s.hands[action.seat]!, s.level).includes(action.card)) return fail('必须进贡手里最大的牌（红桃级牌除外）');
      entry.card = action.card;
      removeCards(s.hands[action.seat]!, [action.card]);
      if (s.tribute.entries.every((e) => e.card !== null)) settleTribute(s, ev);
      break;
    }
    case 'return': {
      if (s.phase !== 'return' || !s.tribute) return fail('现在不是还贡的时候');
      const entry = s.tribute.entries.find((e) => e.to === action.seat && e.back === null);
      if (!entry) return fail('这个座位不用还贡');
      if (!returnChoices(s.hands[action.seat]!, s.level, s.options).includes(action.card)) {
        return fail(`还贡只能还 ${s.options.returnMaxRank} 或以下的牌，不能还级牌和王`);
      }
      entry.back = action.card;
      giveCard(s, action.seat, entry.from, action.card);
      ev.push({ type: 'returnCard', from: action.seat, to: entry.from, card: action.card });
      if (s.tribute.entries.every((e) => e.back !== null)) beginPlay(s, ev, s.tribute.leader);
      break;
    }
    case 'pass': {
      if (s.phase !== 'play') return fail('现在不是出牌的时候');
      if (action.seat !== s.turn) return fail('还没轮到你');
      if (!s.trick.last) return fail('该你领出，不能不要');
      s.trick.passed[action.seat] = true;
      s.history.push({ seat: action.seat, play: null });
      ev.push({ type: 'pass', seat: action.seat });
      afterPass(s, ev, action.seat);
      break;
    }
    case 'play': {
      if (s.phase !== 'play') return fail('现在不是出牌的时候');
      if (action.seat !== s.turn) return fail('还没轮到你');
      const hand = s.hands[action.seat]!;
      const cards = [...action.cards];
      if (new Set(cards).size !== cards.length) return fail('同一张牌选了两次');
      if (!cards.every((c) => hand.includes(c))) return fail('手里没有这些牌');
      const options = interpret(cards, s.level, s.options);
      if (options.length === 0) return fail('不是合法的牌型');
      const target = s.trick.last?.play ?? null;
      let play: Play | null;
      if (action.as) {
        const want = { type: action.as.type, rank: action.as.rank, extra: action.as.extra ?? -1 };
        play = options.find((p) => samePlayShape(p, want)) ?? null;
        if (!play) return fail('这些牌不能当作指定的牌型');
        if (target && !beats(play, target)) return fail('压不过上家');
      } else {
        play = chooseInterpretation(options, target);
        if (!play) return fail('压不过上家');
      }
      removeCards(hand, cards);
      s.trick.last = { seat: action.seat, play };
      s.trick.passed = [false, false, false, false];
      s.history.push({ seat: action.seat, play });
      ev.push({ type: 'play', seat: action.seat, play, left: hand.length });
      afterPlay(s, ev, action.seat);
      break;
    }
    default:
      return fail('未知动作');
  }
  s.step += 1;
  return { state: s, events: ev };
}

function settleTribute(s: GameState, ev: GameEvent[]): void {
  const t = s.tribute!;
  const order = s.lastDeal!.order;
  if (t.kind === 'single') {
    t.leader = t.entries[0]!.from;
  } else {
    const [a, b] = t.entries as [TributeEntry, TributeEntry];
    const va = cardValue(a.card!, s.level);
    const vb = cardValue(b.card!, s.level);
    // 贡牌一样大时按座次：头游的下家进贡给头游、先出牌
    const firstNext = nextSeat(order[0]!);
    const aBig = va > vb || (va === vb && a.from === firstNext);
    const big = aBig ? a : b;
    const small = aBig ? b : a;
    big.to = order[0]!;
    small.to = order[1]!;
    t.leader = big.from;
  }
  for (const e of t.entries) {
    s.hands[e.to] = sortHand([...s.hands[e.to]!, e.card!], s.level);
    ev.push({ type: 'tribute', from: e.from, to: e.to, card: e.card! });
  }
  s.phase = 'return';
}

function afterPass(s: GameState, ev: GameEvent[], seat: Seat): void {
  const last = s.trick.last!;
  const others = SEATS.filter((x) => active(s, x) && x !== last.seat);
  if (others.every((x) => s.trick.passed[x])) {
    const jiefeng = !active(s, last.seat);
    const leader = jiefeng ? partnerOf(last.seat) : last.seat;
    ev.push({ type: 'trickWon', seat: last.seat, leader, jiefeng });
    s.trick = emptyTrick(leader);
    s.turn = leader;
    ev.push({ type: 'lead', seat: leader });
  } else {
    s.turn = nextActive(s, seat);
  }
  ev.push({ type: 'turn', seat: s.turn });
}

function afterPlay(s: GameState, ev: GameEvent[], seat: Seat): void {
  if (s.hands[seat]!.length === 0) {
    s.finished.push(seat);
    ev.push({ type: 'finish', seat, place: s.finished.length });
    const f = s.finished;
    const sameTeamTop2 = f.length === 2 && teamOf(f[0]!) === teamOf(f[1]!);
    if (f.length === 3 || sameTeamTop2) {
      // 剩下的人按出牌顺序补到名次末尾
      let x = seat;
      while (f.length < 4) {
        x = nextSeat(x);
        if (!f.includes(x)) f.push(x);
      }
      endDeal(s, ev);
      return;
    }
  }
  s.turn = nextActive(s, seat);
  ev.push({ type: 'turn', seat: s.turn });
}

/** 打到几结束；0.24.0 及以前的存档里 options 没有 endLevel，按 A */
export function endLevelOf(s: Pick<GameState, 'options'>): number {
  const e = (s.options as Partial<Options>).endLevel;
  return typeof e === 'number' && Number.isInteger(e) && e >= 3 && e < ACE ? e : ACE;
}

function endDeal(s: GameState, ev: GameEvent[]): void {
  const order = [...s.finished];
  const head = order[0]!;
  const winnerTeam = teamOf(head);
  const partnerPlace = order.indexOf(partnerOf(head)); // 1 / 2 / 3
  const up = partnerPlace === 1 ? 3 : partnerPlace === 2 ? 2 : 1;
  const levelsBefore: [number, number] = [...s.levels];
  let aFailedTeam: Team = -1;
  let aResetTeam: Team = -1;
  let gameWon = false;
  let applied = up;

  if (s.declarer >= 0 && s.level === ACE) {
    // 打 A：本方拿头游且对家不是末游才算过 A
    if (winnerTeam === s.declarer && partnerPlace <= 2) {
      gameWon = true;
    } else {
      aFailedTeam = s.declarer;
      s.aFails[s.declarer] = s.aFails[s.declarer]! + 1;
      const limit = s.options.aFailLimit;
      if (limit > 0 && s.aFails[s.declarer]! >= limit) {
        aResetTeam = s.declarer;
        s.levels[s.declarer] = 2;
        s.aFails[s.declarer] = 0;
      }
    }
  }
  if (gameWon) {
    applied = 0;
  } else if (aResetTeam === winnerTeam) {
    applied = 0; // 刚退回打 2 的队这一副不再升级
  } else {
    const before = s.levels[winnerTeam]!;
    const after = Math.min(ACE, before + up);
    s.levels[winnerTeam] = after;
    if (after === ACE && before !== ACE) s.aFails[winnerTeam] = 0;
    // 短局（options.endLevel < A）：升到终点就赢，不用"过"；旧存档没有这个字段，按 A 算
    if (after >= endLevelOf(s) && endLevelOf(s) < ACE) gameWon = true;
  }
  const result: DealResult = {
    dealNo: s.dealNo,
    order,
    winnerTeam,
    up: applied,
    doubleDown: partnerPlace === 1,
    levelsBefore,
    levelsAfter: [...s.levels],
    aFailedTeam,
    aResetTeam,
  };
  s.lastDeal = result;
  s.turn = -1;
  ev.push({ type: 'dealEnd', result });
  if (gameWon) {
    s.phase = 'gameOver';
    s.winner = winnerTeam;
    ev.push({ type: 'gameOver', winner: winnerTeam, levels: [...s.levels] });
  } else {
    s.phase = 'dealEnd';
  }
}

// ───────────────────────── 玩家视角 ─────────────────────────

export interface TributeView {
  kind: 'single' | 'double';
  entries: TributeEntry[];
  leader: Seat;
}

/**
 * 某个座位能看到的全部信息：自己的手牌、各家张数、公开的出牌记录。联机下发的也是它。
 * seat = -1 是没入座的人（联机房间里来看的），只有公开信息：手牌为空，看不到任何人的还贡牌和没分配的贡牌。
 */
export interface PlayerView {
  seat: Seat;
  /** 开局时的规则版本 */
  rules: number;
  options: Options;
  step: number;
  phase: Phase;
  dealNo: number;
  level: number;
  declarer: Team;
  levels: [number, number];
  aFails: [number, number];
  hand: Card[];
  counts: number[];
  turn: Seat;
  toAct: Seat[];
  trick: Trick;
  finished: Seat[];
  history: PlayRecord[];
  tribute: TributeView | null;
  antiTribute: boolean;
  /** 我现在要交/还的牌，以及允许的牌 */
  myTribute: { kind: 'tribute' | 'return'; to: Seat; allowed: Card[] } | null;
  lastDeal: DealResult | null;
  winner: Team;
}

export function viewFor(state: GameState, seat: Seat): PlayerView {
  const s = state;
  let tribute: TributeView | null = null;
  let myTribute: PlayerView['myTribute'] = null;
  if (s.tribute) {
    // 没入座（-1）单独判断：双下没分配时 to 也是 -1，靠"座位相等"会让旁观的人被当成受贡人
    const seated = seat >= 0;
    tribute = {
      kind: s.tribute.kind,
      leader: s.tribute.leader,
      entries: s.tribute.entries.map((e) => ({
        from: e.from,
        to: e.to,
        // 贡牌交出后公开；双下未分配前只有本人看得到。还贡只有双方看得到。
        card: e.to >= 0 || (seated && e.from === seat) ? e.card : null,
        back: seated && (e.from === seat || e.to === seat) ? e.back : null,
      })),
    };
    const hand = s.hands[seat] ?? [];
    if (seat < 0) {
      // 没入座的人（seat = -1）：只有公开信息，没有自己的贡牌
    } else if (s.phase === 'tribute') {
      const e = s.tribute.entries.find((x) => x.from === seat && x.card === null);
      if (e) myTribute = { kind: 'tribute', to: e.to, allowed: tributeChoices(hand, s.level) };
    } else if (s.phase === 'return') {
      const e = s.tribute.entries.find((x) => x.to === seat && x.back === null);
      if (e) myTribute = { kind: 'return', to: e.from, allowed: returnChoices(hand, s.level, s.options) };
    }
  }
  return {
    seat,
    rules: rulesOf(s),
    options: clone(s.options),
    step: s.step,
    phase: s.phase,
    dealNo: s.dealNo,
    level: s.level,
    declarer: s.declarer,
    levels: [...s.levels],
    aFails: [...s.aFails],
    hand: seat >= 0 ? [...s.hands[seat]!] : [],
    counts: s.hands.map((h) => h.length),
    turn: s.turn,
    toAct: seatsToAct(s),
    trick: clone(s.trick),
    finished: [...s.finished],
    history: clone(s.history),
    tribute,
    antiTribute: s.antiTribute,
    myTribute,
    lastDeal: s.lastDeal ? clone(s.lastDeal) : null,
    winner: s.winner,
  };
}

/** 事件按座位裁剪：别人之间的还贡牌不给看，没入座（-1）的一张都不给。贡牌事件只在分配之后发，本来就公开。 */
export function eventsFor(events: readonly GameEvent[], seat: Seat): GameEvent[] {
  return events.map((e) =>
    e.type === 'returnCard' && (seat < 0 || (e.from !== seat && e.to !== seat)) ? { ...e, card: null } : e,
  );
}

/** 轮到这个座位出牌时的全部合法出法（不含"不要"）；没轮到返回空。 */
export function legalPlays(view: PlayerView): Play[] {
  if (view.phase !== 'play' || view.turn !== view.seat) return [];
  return playsBeating(view.hand, view.trick.last?.play ?? null, view.level, view.options);
}

export function canPass(view: PlayerView): boolean {
  return view.phase === 'play' && view.turn === view.seat && view.trick.last !== null;
}

/**
 * 提示：合法出法按"人会先想到的"排好，画面上点一次"提示"取下一个。
 * 普通牌型在前、炸弹在后；同一档里先选不伤牌的：不拆炸弹（含天王炸、天然同花顺）、不用逢人配、不把对子三张拆散，再按牌型、从小到大。
 * 想要电脑的推荐（会看全局、记牌、配合队友），用 src/ai 的 suggest(view)，画面上放在第一个。
 */
export function hint(view: PlayerView): Play[] {
  const list = legalPlays(view);
  const level = view.level;
  const typeOrder: Record<PlayType, number> = {
    single: 0, pair: 1, triple: 2, fullHouse: 3, straight: 4, tube: 5, plate: 6, bomb: 7, straightFlush: 7, jokerBomb: 7,
  };
  // 手里每个点数的天然张数（逢人配不算）
  const have = new Array<number>(18).fill(0);
  for (const c of view.hand) if (!isWild(c, level)) have[rankOf(c)]!++;
  const jokerBomb = have[SMALL_JOKER] === 2 && have[BIG_JOKER] === 2;
  // 天然同花顺用到的"点数+花色"（两副牌同一张可能有两张）：拆掉它和拆炸弹一样伤
  const key = (c: Card) => rankOf(c) * 4 + suitOf(c);
  const copies = new Map<number, number>();
  for (const c of view.hand) if (!isWild(c, level) && !isJoker(c)) copies.set(key(c), (copies.get(key(c)) ?? 0) + 1);
  const inFlush = new Set<number>();
  for (let suit = 0; suit < 4; suit++) {
    for (let top = 5; top <= ACE; top++) {
      const keys: number[] = [];
      for (let r = top - 4; r <= top; r++) keys.push((r === 1 ? ACE : r) * 4 + suit);
      if (keys.every((k) => copies.has(k))) for (const k of keys) inFlush.add(k);
    }
  }
  const wilds = (p: Play) => p.cards.filter((c) => isWild(c, level)).length;
  /** 伤牌程度：4 = 拆炸弹，2 = 用逢人配，1 = 拆散对子/三张；可以叠加 */
  const harm = (p: Play): number => {
    const taken = new Array<number>(18).fill(0);
    for (const c of p.cards) if (!isWild(c, level)) taken[rankOf(c)]!++;
    let h = wilds(p) > 0 ? 2 : 0;
    let split = false;
    let breaks = false;
    for (let r = 2; r <= BIG_JOKER; r++) {
      const n = taken[r]!;
      if (n === 0 || n === have[r]) continue;
      if (r >= SMALL_JOKER ? jokerBomb && p.type !== 'jokerBomb' : have[r]! >= 4) breaks = true;
      else split = true;
    }
    if (jokerBomb && p.type !== 'jokerBomb' && (taken[SMALL_JOKER]! > 0 || taken[BIG_JOKER]! > 0)) breaks = true;
    if (p.type !== 'straightFlush' && !breaks) {
      const used = new Map<number, number>();
      for (const c of p.cards) if (!isWild(c, level) && !isJoker(c)) used.set(key(c), (used.get(key(c)) ?? 0) + 1);
      for (const [k, n] of used) if (inFlush.has(k) && copies.get(k)! - n < 1) breaks = true;
    }
    if (breaks) h += 4;
    if (split) h += 1;
    return h;
  };
  const keyed = list.map((p) => ({ p, h: harm(p), w: wilds(p) }));
  keyed.sort(
    (a, b) =>
      bombTier(a.p) - bombTier(b.p) ||
      a.h - b.h ||
      typeOrder[a.p.type] - typeOrder[b.p.type] ||
      a.p.value - b.p.value ||
      a.w - b.w ||
      a.p.extra - b.p.extra,
  );
  return keyed.map((x) => x.p);
}

// ───────────────────────── 联机用：下一副预告、超时代出 ─────────────────────────

/** 结算页上的"下一副谁进贡"（只有公开信息：谁交给谁、是不是抗贡） */
export interface NextPreview {
  /** 下一副抗贡：进贡的人手里有两张大王（双下时两人合计），不用进贡 */
  anti: boolean;
  /** 要进贡的座位：单下 1 个（末游），双下 2 个（三游、末游）；抗贡时也列出来，表示是谁抗的 */
  payers: Seat[];
  /** 单下时受贡的人（头游）；双下要等两张贡牌交上来比大小才定，为 -1 */
  to: Seat;
}

/**
 * 一副结束（phase = 'dealEnd'）时推演下一副开头，给结算页展示；其他阶段返回 null。不改传入的状态。
 * 联机时客户端没有完整状态（下一副的牌在服务端），所以由房间算好随结算一起下发。
 * 抗贡要看下一副发到的牌，提前公布的只是"抗不抗"，和下一副开头的公告一样，不多透露手牌。
 */
export function previewNext(state: GameState): NextPreview | null {
  if (state.phase !== 'dealEnd' || !state.lastDeal) return null;
  const r = dispatch(state, { type: 'nextDeal' });
  if (r.error) return null;
  const anti = r.events.find((e) => e.type === 'antiTribute');
  const asked = r.events.find((e) => e.type === 'tributeAsked');
  const payers = anti?.type === 'antiTribute' ? anti.seats : asked?.type === 'tributeAsked' ? asked.payers : [];
  const doubleDown = payers.length === 2;
  return { anti: !!anti, payers: [...payers], to: doubleDown ? -1 : state.lastDeal.order[0]! };
}

/**
 * 超时或掉线时替这个座位代出："能不出就不出，必须出就出最小的"。只看这个座位的视角（不偷看别人的牌），结果确定。
 * - 出牌：能不要就不要（队友的牌也不接）；必须领出时出一张最小的单牌（同样小先出不是逢人配的，再按牌号）；
 * - 进贡：允许的牌里牌号最小的一张（允许的牌一样大）；还贡：允许的牌里最小的一张；
 * - 没轮到这个座位、或者一副结束等房间开下一副：返回 null。
 * 掉线久了转电脑托管时用 src/ai 的 decide，不用这个。
 */
export function timeoutAction(view: PlayerView): SeatAction | null {
  const seat = view.seat;
  if (!view.toAct.includes(seat)) return null;
  const smallest = (cards: readonly Card[]): Card | undefined =>
    [...cards].sort(
      (a, b) =>
        cardValue(a, view.level) - cardValue(b, view.level) ||
        Number(isWild(a, view.level)) - Number(isWild(b, view.level)) ||
        a - b,
    )[0];
  if (view.phase === 'play') {
    if (canPass(view)) return { type: 'pass', seat };
    const c = smallest(view.hand);
    return c === undefined ? null : { type: 'play', seat, cards: [c] };
  }
  if ((view.phase === 'tribute' || view.phase === 'return') && view.myTribute) {
    const c = smallest(view.myTribute.allowed);
    return c === undefined ? null : { type: view.myTribute.kind, seat, card: c };
  }
  return null;
}

/** 从种子和动作序列重放出状态（存档校验、复现 bug、联机校验用）。遇到非法动作抛错。 */
export function replay(seed: string | number, options: Partial<Options> | undefined, actions: readonly Action[]): GameState {
  let { state } = createGame(seed, options);
  for (const a of actions) {
    const r = dispatch(state, a);
    if (r.error) throw new Error(`replay: 第 ${state.step} 步非法：${r.error}`);
    state = r.state;
  }
  return state;
}
