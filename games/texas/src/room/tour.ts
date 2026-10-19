/**
 * 好友房锦标赛的规则（0.24.0，DESIGN.md 14.3）：kit 的房间 + 单机同一套规则核心（src/tour/rules.ts）。纯函数，房间和页面共用。
 *
 * 和现金桌（rules.ts）的不同：
 * - 没有买入、补码、离座结回：开赛时每个真人交一份报名费（实盘），整场结束按名次在真人之间分奖池；
 * - 开赛时坐着的真人 + （开了电脑补）房间补的电脑座位 = 这一场的选手，座位按房间座位号从小到大排进牌桌（newTour 的 humans 长度 = 选手数）；
 *   没入局的座位（没开电脑补的空位、报名被拒的人）不在牌桌上，视图里是空座；
 * - 开赛后不能再入座：kit 不许游戏拒绝入座，所以后来坐下的人（含离开后又坐回来的）只是占了个名，牌桌上这个座位始终是电脑在打
 *   （apply 只认真人选手本人的操作，别的真人座位轮到时 1.5 秒后由房间代出电脑的一步），他看不到底牌；
 * - 中途离开（kit 的 leave）= 座位交给电脑，名次、奖金照算，由服务端直接结回；掉线（kit 的托管）在断线期间电脑代打，连回来还能接着打。
 *
 * 钱包（server 模式，同现金桌的 effects/settled/perform，worker/room.ts 不用改）：一人一个 ref（`<房间号>s<座位>n1`），
 * 开赛前扣、结束时结回奖金（没拿到的结 0，清掉钱包里那一份），操作 id 去重；扣款明确被拒的人当场出局（不在牌桌上），
 * 等钱包回话最多 OPENING_MS，超时没回话的也不等了——它之后万一扣成了，就原样退回（dropped）。娱乐锦标赛不产生任何钱包的事。
 */
import type { RoomGame } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { stream, type Entropy } from 'arcade-kit/rng';
import { aiAction } from '../bot.ts';
import { FUN_LEVEL, SOLO_LEVEL, stakesOf, type StakesId } from '../core/stakes.ts';
import { apply as applyTable, isFail, levelOf, newTable, RNG, RULES_VERSION, type Action } from '../core/table.ts';
import { view as tableView, type SeatView, type View } from '../core/view.ts';
import { finishOrder, handOver, newTour, playOut, roomPrizes, tourLeave, tourStep, tourView, type TourState } from '../tour/rules.ts';
import {
  EMOTE_COUNT,
  OPENING_MS,
  SEATS,
  TURN_MS,
  texasRoom,
  errorOf,
  hex,
  isOk,
  set,
  settleCap,
  type LastAct,
  type Pending,
  type RoomAction,
  type RoomOpts,
  type RoomView,
  type TourInfo,
  type WalletEffect,
} from './rules.ts';

/** 一手打完停多久再发下一手（kit 的 pause）：比现金桌短，锦标赛一场手数多 */
export const TOUR_PAUSE_MS = 5_000;
/** 占了名的真人座位（后来坐下的）轮到时，等多久由房间代出电脑的一步 */
export const SPARE_MS = 1_500;

export interface TourRoomState {
  tour: true;
  /** 房间号（同现金桌：钱包的 ref、操作 id 的前缀） */
  ref: string;
  stakes: StakesId;
  fun?: true;
  fill: boolean;
  size: number;
  /** 报名费；娱乐是 0 */
  buyIn: number;
  /** kit 的座位（SEATS 个）每个坐的是谁，随 seated 更新 */
  kinds: SeatKind[];
  /** 开赛时坐着的真人座位 */
  humans: number[];
  /** 开赛时房间补的电脑座位（没开电脑补就是空） */
  bots: number[];
  /** 等报名费回话时存着（要用它重新开牌桌）；开赛后删掉 */
  entropy?: Entropy;
  phase: 'opening' | 'play' | 'done';
  aborted?: true;
  fx: Pending[];
  nextId: number;
  /** 报名费扣成了 */
  entered: boolean[];
  /** 报名被钱包拒了的原因 */
  refused: (string | null)[];
  /** 不再等这一笔的回话了（超时、房间关了）：它万一扣成，原样退回 */
  dropped: boolean[];
  closed: boolean;
  /** 牌桌座位 → 房间座位 */
  seats: number[];
  /** 没有真人选手（<2 人）时没有牌桌，房间一开就结束 */
  st: TourState | null;
  last?: LastAct;
}

export const isTourState = (s: object): s is TourRoomState => 'tour' in s;

const level = (o: { fun?: true; stakes: StakesId }): number => (o.fun ? FUN_LEVEL.normal : SOLO_LEVEL[o.stakes]);

/** 牌桌上的座位：真人选手 + 房间补的电脑，按房间座位号 */
const seatList = (humans: readonly number[], bots: readonly number[]): number[] => [...humans, ...bots].sort((a, b) => a - b);

const build = (s: { fun?: true; stakes: StakesId }, seats: readonly number[], humans: readonly number[], entropy: Entropy): TourState =>
  newTour({ humans: seats.map((k) => humans.includes(k)), level: level(s) }, entropy);

/** 这个房间座位现在是不是由真人本人在打：真人选手、没被换成电脑、人还坐着 */
function controls(s: TourRoomState, seat: number, ti = s.seats.indexOf(seat)): boolean {
  return !!s.st && ti >= 0 && s.st.humans[ti]! && !s.st.auto[ti]! && s.kinds[seat] === 'human';
}

const isSpare = (s: TourRoomState, seat: number): boolean => s.kinds[seat] === 'human' && !controls(s, seat);

/** 还在等回话的第一笔报名（不再等的不算） */
const openingSeat = (s: TourRoomState): number | null => s.fx.find((e) => e.kind === 'debit' && !s.dropped[e.seat])?.seat ?? null;

const shareRef = (s: TourRoomState, seat: number): string => `${s.ref}s${seat}n1`;

function credit(s: TourRoomState, seat: number, amount: number): TourRoomState {
  const e: Pending = { id: `c${s.nextId}`, seat, kind: 'credit', amount, ref: shareRef(s, seat) };
  return { ...s, fx: [...s.fx, e], nextId: s.nextId + 1 };
}

/** 报名费的回话都到了（或不等了）：够两个真人就开赛，不够就把扣到的退回 */
function openUp(s0: TourRoomState): TourRoomState {
  if (s0.phase !== 'opening' || openingSeat(s0) !== null) return s0;
  let s: TourRoomState = { ...s0 };
  const ok = s.humans.filter((k) => s.entered[k]);
  const entropy = s.entropy!;
  delete s.entropy;
  if (ok.length < 2 || s.closed) {
    for (const k of ok) s = credit(s, k, s.buyIn);
    return { ...s, phase: 'done', aborted: true };
  }
  const seats = seatList(ok, s.bots);
  let st = s.st && seats.length === s.seats.length && seats.every((k, i) => k === s.seats[i]) && ok.length === s.humans.length ? s.st : build(s, seats, ok, entropy);
  // 等回话的这会儿就离开的人：座位交给电脑
  for (const k of ok) if (s.kinds[k] !== 'human') st = leave(st, seats.indexOf(k));
  return { ...s, seats, st, phase: 'play' };
}

const leave = (st: TourState, ti: number): TourState => {
  const r = tourLeave(st, ti);
  return isFail(r) ? st : r;
};

/** 打完以后：按名次在真人之间分奖池，每个真人结回一笔（没拿到的结 0） */
function finish(s0: TourRoomState): TourRoomState {
  let s: TourRoomState = { ...s0, phase: 'done' };
  if (s.fun || !s.st) return s;
  const cap = settleCap(s.buyIn, stakesOf(s.stakes).max);
  for (const p of roomPrizes(s.st, s.buyIn)) {
    const k = s.seats[p.seat]!;
    if (s.entered[k]) s = credit(s, k, Math.min(p.prize, cap));
  }
  return s;
}

/** 还有真人在亲手打（没出局、没被换成电脑） */
const live = (st: TourState): boolean => st.humans.some((h, i) => h && !st.auto[i] && st.places[i] === null);

/**
 * 这一手打完停着的状态变成下一手（淘汰、涨盲、发牌），整场打完就分奖金。
 * 没有真人在亲手打了（都出局或离开）：真人之间的名次和奖金已经定了（出局的名次不会变，还在场的离开了的由电脑托管，
 * 托管的结果是确定的），剩下的电脑对电脑直接算完，不让房间陪着电脑一手手打几十分钟才结算
 */
function advance(s: TourRoomState): TourRoomState {
  let st = tourStep(s.st!);
  if (!st.over && !live(st)) st = playOut(st);
  return st.over ? finish({ ...s, st }) : { ...s, st };
}

/** 全部打完（房间要关了）：剩下的真人都交给电脑，确定地跑到结束 */
function runOut(s: TourRoomState): TourRoomState {
  if (!s.st || s.phase !== 'play') return s;
  return finish({ ...s, st: playOut(tourStep(s.st)) });
}

/**
 * 报名等了太久、房间要关了：不再等没回话的。那一笔还留在 fx 里让房间办完（扣成了就在 settled 里原样退回），只是不挡开赛
 */
function dropOpening(s: TourRoomState): TourRoomState {
  const dropped = [...s.dropped];
  for (const e of s.fx) if (e.kind === 'debit') dropped[e.seat] = true;
  return openUp({ ...s, dropped });
}

const blanks = new Map<string, View>();
/** 没有牌桌时（没开成）的空视图 */
function blankView(stakes: StakesId, size: number): View {
  const key = `${stakes}:${size}`;
  let v = blanks.get(key);
  if (!v) blanks.set(key, (v = tableView(newTable(stakes, size, [0, 0, 0, 0, 0, 0, 0, 0], { holdHands: true }), null)));
  return v;
}

const EMPTY_SEAT: SeatView = { owner: 'none', persona: -1, stack: 0, bet: 0, total: 0, status: 'out', away: false, leaving: false };

/** 牌桌座位号换成房间座位号：空着的座位摆空座，页面照现金桌的方式画 */
function spread(v: View, map: readonly number[], n: number): View {
  const m = (i: number): number => (i >= 0 ? (map[i] ?? i) : i);
  const seats = Array.from({ length: n }, () => ({ ...EMPTY_SEAT }));
  v.seats.forEach((x, i) => {
    seats[m(i)] = x;
  });
  return {
    ...v,
    seats,
    button: m(v.button),
    toAct: v.toAct === null ? null : m(v.toAct),
    me: v.me === null ? null : m(v.me),
    log: v.log.map((e) => ({ ...e, seat: m(e.seat) })),
    lastHand: v.lastHand && {
      ...v.lastHand,
      shown: v.lastHand.shown.map((x) => ({ ...x, seat: m(x.seat) })),
      pots: v.lastHand.pots.map((p) => ({ ...p, winners: p.winners.map((w) => ({ ...w, seat: m(w.seat) })) })),
      uncalled: v.lastHand.uncalled && { ...v.lastHand.uncalled, seat: m(v.lastHand.uncalled.seat) },
      ...(v.lastHand.showed ? { showed: v.lastHand.showed.map((x) => ({ ...x, seat: m(x.seat) })) } : {}),
    },
  };
}

const forSeats = <T>(s: TourRoomState, fill: T, f: (tableSeat: number) => T): T[] => {
  const out = new Array<T>(s.size).fill(fill);
  s.seats.forEach((k, ti) => {
    out[k] = f(ti);
  });
  return out;
};

/** 好友房锦标赛的 RoomGame（texasGame 按选项分到这里或现金桌） */
export const tourRoom: RoomGame<TourRoomState, RoomAction, RoomView, RoomOpts, WalletEffect> = {
  seats: SEATS,
  rulesVersion: RULES_VERSION,

  begin(entropy, _rv, setup) {
    const o = setup?.opts;
    if (!o?.tour) throw new Error('tour rooms need tour options');
    const kinds = Array.from({ length: SEATS }, (_, i) => setup?.seats[i] ?? 'empty');
    const humans = kinds.flatMap((k, i) => (k === 'human' && i < o.size ? [i] : []));
    const bots = o.fill ? kinds.flatMap((k, i) => (k === 'ai' && i < o.size ? [i] : [])) : [];
    const r = stream(entropy, RNG.room);
    const seats = seatList(humans, bots);
    const base: TourRoomState = {
      tour: true,
      ref: `r${hex(r.u32())}${hex(r.u32())}`,
      stakes: o.stakes,
      ...(o.fun ? { fun: true as const } : {}),
      fill: o.fill === true,
      size: o.size,
      buyIn: o.fun ? 0 : stakesOf(o.stakes).max,
      kinds,
      humans,
      bots,
      phase: 'play',
      fx: [],
      nextId: 0,
      entered: new Array<boolean>(SEATS).fill(false),
      refused: new Array<string | null>(SEATS).fill(null),
      dropped: new Array<boolean>(SEATS).fill(false),
      closed: false,
      seats,
      st: null,
    };
    // 不到两个真人选手开不了：房间一开就结束，不扣报名费
    if (humans.length < 2) return { ...base, phase: 'done', aborted: true };
    const st = build(base, seats, humans, entropy);
    if (o.fun) return { ...base, st };
    // 实盘：先扣报名费，扣完（或被拒）再开赛；牌桌先摆着（底牌不下发）
    let s: TourRoomState = { ...base, st, phase: 'opening', entropy: [...entropy] };
    for (const k of humans) s = { ...s, fx: [...s.fx, { id: `b${s.nextId}`, seat: k, kind: 'debit', amount: s.buyIn, ref: shareRef(s, k) }], nextId: s.nextId + 1 };
    return s;
  },
  start() {
    throw new Error('tour rooms use begin');
  },

  // 操作的形状同现金桌（多收的补码、暂离、回来由 apply 回 not_in_tour）
  parse: (raw) => texasRoom.parse(raw),
  free: (a) => texasRoom.free!(a),
  chat: true,

  apply(s, seat, a) {
    if (s.closed || s.phase === 'done') return { error: 'closed' };
    if (s.phase === 'opening') return a.t === 'timeout' && seat === openingSeat(s) ? dropOpening(s) : { error: 'not_seated' };
    const ti = s.seats.indexOf(seat);
    if (ti < 0 || !s.st) return { error: 'not_seated' };
    if (a.t === 'rebuy' || a.t === 'away' || a.t === 'back' || a.t === 'leave') return { error: 'not_in_tour' };
    let act: Action = a;
    // 占了名的真人座位（后来坐下的）轮到时：房间代出电脑的一步，别的操作一概不收
    if (isSpare(s, seat)) {
      if (a.t !== 'timeout') return { error: 'not_seated' };
      act = aiAt(s, seat);
    }
    const t = applyTable(s.st.table, ti, act);
    if (isFail(t)) return t;
    return { ...s, st: { ...s.st, table: t }, last: { n: (s.last?.n ?? 0) + 1, seat, action: a } };
  },

  turn(s) {
    if (s.closed || s.phase === 'done') return null;
    if (s.phase === 'opening') return openingSeat(s);
    if (!s.st || handOver(s.st) || s.st.over) return null;
    const ti = s.st.table.toAct;
    return ti === null ? null : (s.seats[ti] ?? null);
  },
  turnMs(s) {
    if (s.phase === 'opening') return OPENING_MS;
    const ti = s.st?.table.toAct;
    const k = ti === null || ti === undefined ? undefined : s.seats[ti];
    return k !== undefined && isSpare(s, k) ? SPARE_MS : TURN_MS;
  },
  // 一手打完停着：房间停一会儿再淘汰、涨盲、发下一手
  pause: (s) => (!s.closed && s.phase === 'play' && s.st && handOver(s.st) ? TOUR_PAUSE_MS : null),
  resume: (s) => advance(s),
  waiting: () => false,
  over: (s) => s.closed || s.phase === 'done',
  breakPoint: (s) => !s.st || s.st.table.phase === 'idle' || s.st.table.log.every((e) => e.act === 'sb' || e.act === 'bb'),

  ai: (s, seat) => (s.phase === 'play' ? aiAt(s, seat) : { t: 'timeout' }),
  timeout: () => ({ t: 'timeout' }),
  emotes: EMOTE_COUNT,

  seated(s0, seat, kind) {
    const s: TourRoomState = { ...s0, kinds: s0.kinds.map((k, i) => (i === seat ? kind : k)) };
    // 真人选手离座：座位交给电脑，名次、奖金照算
    if (kind === 'ai' && s.phase === 'play' && s.st) {
      const ti = s.seats.indexOf(seat);
      const left = ti >= 0 && s.st.humans[ti] && !s.st.auto[ti] ? { ...s, st: leave(s.st, ti) } : s;
      // 没有真人在亲手打了（房间里一个真人都没有时 kit 也不会驱动电脑）：替电脑一次打完，奖金马上结回
      return left.st && !live(left.st) ? runOut(left) : left;
    }
    return s;
  },

  view(s, seat) {
    const ti = seat === null ? -1 : s.seats.indexOf(seat);
    const mine = seat !== null && controls(s, seat, ti);
    const st = s.st;
    const tv = st ? tourView(st, mine ? ti : null) : null;
    // 盲注、名次这些是锦标赛的字段，放进 tour 里；不能顺手摊进视图（next 和现金桌视图里的 next 重名）
    const plain: View | null = tv && st ? { ...(({ blinds: _b, next: _n, handsLeft: _h, places: _p, over: _o, ...rest }) => rest)(tv), level: levelOf(st.table) } : null;
    const v: View = { ...(plain ? spread(plain, s.seats, s.size) : blankView(s.stakes, s.size)), stakes: s.stakes };
    // 等报名费回话时牌桌先摆着，底牌不给看
    if (s.phase === 'opening' || !mine) {
      v.hole = [];
      delete v.kept;
    }
    if (s.phase === 'opening') {
      v.legal = null;
      v.toAct = null;
    }
    if (!mine) v.me = null;
    const over = !!st?.over;
    const pz = over && st && !s.fun ? roomPrizes(st, s.buyIn) : [];
    const tour: TourInfo = {
      level: tv?.level ?? 0,
      blinds: tv?.blinds ?? [v.sb, v.bb],
      next: tv?.next ?? null,
      handsLeft: tv?.handsLeft ?? 0,
      phase: s.phase,
      fun: s.fun === true,
      buyIn: s.buyIn,
      fill: s.fill,
      places: forSeats<number | null>(s, null, (i) => st?.places[i] ?? null),
      over,
      in: mine,
      humans: st ? st.humans.flatMap((h, i) => (h ? [s.seats[i]!] : [])) : [],
      ...(s.aborted ? { aborted: true as const } : {}),
      ...(over && st
        ? { order: finishOrder(st).map((i) => s.seats[i]!), ...(s.fun ? {} : { prizes: forSeats<number | null>(s, null, (i) => pz.find((p) => p.seat === i)?.prize ?? null) }) }
        : {}),
    };
    return {
      ...v,
      size: s.size,
      net: new Array<number | null>(s.size).fill(null),
      buying: Array.from({ length: s.size }, (_, i) => s.fx.some((e) => e.seat === i && e.kind === 'debit' && !s.dropped[i])),
      refused: seat === null ? null : (s.refused[seat] ?? null),
      canRebuy: false,
      closed: s.closed,
      last: s.last ?? null,
      needTwo: false,
      tour,
    };
  },

  effects: (s) => s.fx.filter((e, i) => s.fx.findIndex((x) => x.seat === e.seat) === i).map((e) => ({ ...e, stakes: s.stakes, ...(s.fun ? { fun: true as const } : {}) })),

  settled(s0, id, result) {
    const e = s0.fx.find((x) => x.id === id);
    if (!e) return s0;
    const s: TourRoomState = { ...s0, fx: s0.fx.filter((x) => x !== e) };
    // 结回：钱包收了，或那一份已经到期退回（expired）都算办完；平台忙的房间那边抛错重办，不会到这里
    if (e.kind === 'credit') return s;
    if (!isOk(result)) return openUp({ ...s, refused: set(s.refused, e.seat, errorOf(result)) });
    // 不再等的那一笔后来扣成了：原样退回
    if (s.dropped[e.seat] || s.closed || s.phase !== 'opening') return openUp(credit(s, e.seat, e.amount));
    return openUp({ ...s, entered: set(s.entered, e.seat, true) });
  },

  // 房间要关了（寿命到、没人、额度满）：还没开赛的退报名费，开了的剩下的跑完按名次结
  closing(s0) {
    let s = s0;
    if (s.phase === 'opening') s = dropOpening({ ...s, closed: true });
    else s = runOut(s);
    return { ...s, closed: true };
  },
};

/** 电脑在这个座位上的一步：真人选手还没被换成电脑时，先在临时的拷贝里换上性格再算 */
function aiAt(s: TourRoomState, seat: number): Action {
  const st = s.st!;
  const ti = s.seats.indexOf(seat);
  return aiAction((st.humans[ti] && !st.auto[ti] ? leave(st, ti) : st).table, ti);
}

