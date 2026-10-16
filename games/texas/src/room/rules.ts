/**
 * 好友房的规则（DESIGN.md 6.1）：把牌桌（core/table.ts）接到 kit 的房间上。纯函数，房间（worker/room.ts）和页面共用。
 *
 * 座位上坐的是谁由 kit 管（kinds：真人还是电脑），桌上的筹码由牌桌管，每一步之后用 sync 把两边对上：
 * - 真人坐下（开局、接管电脑、离座后回来）：从他的钱包扣满买入，到账后坐上牌桌。接管电脑的座位时，电脑这一手弃牌、打完把筹码收回庄家；
 * - 真人离座（交给电脑）：这一手弃牌，桌上剩下的筹码和还没上桌的买入马上结回钱包（0.2.4，投进池子的留在池子里），这一手打完电脑坐进来；
 *   这一手全下着的，等这一手打完再结；
 * - 桌上一个真人都没有了：替电脑把这一手打完，房间就算打完（over），kit 还开房名额、办完结回再关；
 * - 房间要关：这一手作废、各人投的退回，所有人桌上的筹码结回钱包。
 * 钱包的事记在状态里（effects），房间去办、办完写回（settled）；同一笔可能办两次，钱包按操作 id 去重。
 *
 * 钱包是平台的（docs/platform-backend.md 5.9）：每一份（ref）可以多次带入（补码），但只能结回一次，结完那一份就没了，再结回 no_stake。
 * 所以一个座位（开打后座位和人一一对应，kit 的 owners）同一时间只办一笔（fx 里这个座位排第一的那笔）；
 * 牌桌结出来的筹码、没上桌的买入都先攒在 owed，等他完全离桌、没有在路上的买入了，合成一笔结回，这一份就封上（sealed）；
 * 之后再坐下开新的一份（ref 里的第几份加一），结回还在路上时新的买入排在它后面。
 */
import type { RoomEffect, RoomGame } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { stream } from 'arcade-kit/rng';
import { aiAction } from '../bot.ts';
import { NO_FAME, noteHand, settleStats, type Fame, type SettleStats } from '../core/fame.ts';
import { STAKES, stakesOf, type StakesId } from '../core/stakes.ts';
import {
  MAX_SEATS,
  addChips,
  apply as applyTable,
  cashOut,
  closeTable,
  deal,
  isFail,
  newTable,
  paid,
  RNG,
  RULES_VERSION,
  seatHouse,
  seatPlayer,
  stay,
  type Action,
  type Fail,
  type Table,
} from '../core/table.ts';
import { view as tableView, type View } from '../core/view.ts';

/** kit 的座位数：一桌最多 9 人（0.2.0），开房时定用前几个 */
export const SEATS = MAX_SEATS;
/** 每一手轮到谁的限时（房间的 turnMs；页面拿它画倒计时圈） */
export const TURN_MS = 25_000;
/** 好友房里电脑每出一手的播放时间（房间的 aiDelayMs，worker/room.ts）：页面放动画、补足停顿都按它 */
export const AI_DELAY_MS = 1_600;
/** 开打时最多等这么久的买入回话：钱包一直连不上的人先当没坐上，到账了下一手再上 */
export const OPENING_MS = 30_000;
/**
 * 好友房的 emote 编号表（0.3.0，kit 0.7.0：短语、表情、道具共用一个编号，房间只转发编号、校验范围和 to）：
 * 0–14 嘲讽短语（view/fun.ts 的 TAUNTS）、15–26 表情包（kit/fun 的 STICKERS）、27–34 道具（kit/fun 的 PROPS，催促炸弹就是对人扔 bomb）。
 * 只往后加，不改顺序；测试核对和页面、kit 的表一样长
 */
export const TAUNT_COUNT = 15;
export const STICKER_BASE = TAUNT_COUNT;
export const STICKER_COUNT = 12;
export const PROP_BASE = STICKER_BASE + STICKER_COUNT;
export const PROP_COUNT = 8;
export const EMOTE_COUNT = PROP_BASE + PROP_COUNT;
/**
 * 一手打完停多久再发下一手（0.1.1，kit 0.5.0 的 pause）：所有人看同一个结果条和倒计时圈，不等谁点（有人走开就卡住）。
 * 从这一手最后一帧播完算起；页面摊牌、分池的动画要占掉三秒左右，剩下的时间结果静静摆着
 */
export const HAND_PAUSE_MS = 7_000;

export interface RoomOpts {
  stakes: StakesId;
  size: number;
}

const DEFAULT_OPTS: RoomOpts = { stakes: 'small', size: 6 };

/** 要去钱包办的一笔：debit 带入（坐下、补码），credit 把这一份结回去；ref 是钱包里"桌上那一份"的号：房间号 + s 座位 + n 第几份 */
export interface Pending extends RoomEffect {
  kind: 'debit' | 'credit';
  amount: number;
  ref: string;
  /** 结回时带上这一份的小结（0.3.0，平台 settle.stats） */
  stats?: SettleStats;
}

/** 交给房间去办的：带上档位（操作 id = ref-id） */
export interface WalletEffect extends Pending {
  stakes: StakesId;
}

export interface RoomState {
  t: Table;
  /** 房间号（开局随机，不用房间码：房间码会重复用，钱包认得过期的 ref）：每一份的 ref 和钱包操作 id 的前缀（不是秘密） */
  ref: string;
  /** kit 那边每个座位坐的是谁（SEATS 个） */
  kinds: SeatKind[];
  /** 还没办完的钱包的事，按先后；每个座位同一时间只办排第一的那笔 */
  fx: Pending[];
  /** 已经扣到、还没坐上牌桌的（这一手打完才能上） */
  held: number[];
  /** 要结回去、还没排上的（离桌的筹码、扣到了却用不上的买入） */
  owed: number[];
  /** 每个座位现在是第几份（0 是还没开过） */
  share: number[];
  /** 这一份封上了（结回排上了，或者还没开过）：再坐下开新的一份 */
  sealed: boolean[];
  /** 这一份有带入办成过（没有的话钱包里就没有这一份，离桌不用结回） */
  funded: boolean[];
  /** 这个座位上一次买入被钱包拒了的原因 */
  refused: (string | null)[];
  nextId: number;
  /** 房间要关了：牌桌已经散了，只等结算 */
  closed: boolean;
  /** 刚开打、开打时坐下的人的买入还没全有回话：先不发第一手，免得先到账的人和电脑先打起来、别人干看一手 */
  opening: boolean;
  /** 最近一次出手（页面按它播动画：房间的帧里只有前后两个视图）；n 每次加一 */
  last?: LastAct;
  /**
   * 这一场每个座位的账（0.1.1，一场结束时给每个人看输赢）：inn 带入办成的总数，outs 结回排上的总数。
   * 开打后座位和人一一对应（kit 的 owners），所以按座位记就是按人记。0.1.0 开的房间没有，当 0
   */
  inn?: number[];
  outs?: number[];
  /**
   * 每个座位这一份的战绩（0.3.0，结回时报给平台）：dealt 是最近一次发牌的手数、players 是那一手发牌时坐着的真人座位
   * （接管电脑的人，电脑替他打完的那一手不算他的），noted 是记过的最后一手；inn 是这一份带入办成的。0.2.x 的房间没有，从现在起记
   */
  fame?: { dealt: number; noted: number; players: number[]; per: Fame[]; inn: number[] };
}

export interface LastAct {
  n: number;
  seat: number;
  action: RoomAction;
}

/**
 * 客户端能发的；timeout 只由房间代出，离座走 kit 的 leave。
 * rebuy 的 amount：钱包不够一整份时少带一点（平台 0.10.2）；不给就带满
 */
export type RoomAction = Action | { t: 'rebuy'; amount?: number };

export interface RoomView extends View {
  size: number;
  /** 这一场每个座位的输赢（结回的 + 现在桌上和没上桌的 − 带入的）；没带入过的座位是 null */
  net: (number | null)[];
  /** 每个座位：正在等钱包扣买入（坐下、补码） */
  buying: boolean[];
  /** 每个座位：买入已经到账、等这一手打完上桌（0.2.5，中途坐下、接管电脑座位的人写"下一手上桌"） */
  next?: boolean[];
  /** 我上一次买入被钱包拒了的原因 */
  refused: string | null;
  /** 我可以补码（桌上不满一份就行，0.3.0），或者坐下时带入被拒了、还没上桌（0.2.5，重试） */
  canRebuy: boolean;
  closed: boolean;
  last: LastAct | null;
}

const SIMPLE = new Set<string>(['fold', 'check', 'call', 'allin', 'away', 'back', 'rebuy']);

export const texasRoom: RoomGame<RoomState, RoomAction, RoomView, RoomOpts, WalletEffect> = {
  seats: SEATS,
  rulesVersion: RULES_VERSION,

  options(raw) {
    if (raw === undefined) return DEFAULT_OPTS;
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (!STAKES.some((x) => x.id === o.stakes) || !Number.isInteger(o.size)) return null;
    const size = o.size as number;
    return size >= 2 && size <= SEATS ? { stakes: o.stakes as StakesId, size } : null;
  },
  seatCount: (opts) => (opts ?? DEFAULT_OPTS).size,

  begin(entropy, _rv, setup) {
    const opts = setup?.opts ?? DEFAULT_OPTS;
    const r = stream(entropy, RNG.room);
    const kinds = Array.from({ length: SEATS }, (_, i) => setup?.seats[i] ?? 'empty');
    let s: RoomState = {
      t: newTable(opts.stakes, opts.size, entropy, { holdHands: true }),
      ref: `r${hex(r.u32())}${hex(r.u32())}`,
      kinds,
      fx: [],
      held: new Array<number>(SEATS).fill(0),
      owed: new Array<number>(SEATS).fill(0),
      share: new Array<number>(SEATS).fill(0),
      sealed: new Array<boolean>(SEATS).fill(true),
      funded: new Array<boolean>(SEATS).fill(false),
      refused: new Array<string | null>(SEATS).fill(null),
      nextId: 0,
      closed: false,
      opening: true,
      inn: new Array<number>(SEATS).fill(0),
      outs: new Array<number>(SEATS).fill(0),
    };
    kinds.forEach((k, i) => {
      if (k === 'human' && i < opts.size) s = buy(s, i);
    });
    return sync(s);
  },
  start() {
    throw new Error('texas rooms use begin');
  },

  parse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as { t?: unknown; to?: unknown };
    if (a.t === 'raise') return Number.isSafeInteger(a.to) ? { t: 'raise', to: a.to as number } : null;
    if (a.t === 'rebuy') {
      const n = (raw as { amount?: unknown }).amount;
      if (n === undefined) return { t: 'rebuy' };
      return Number.isSafeInteger(n) && (n as number) > 0 ? { t: 'rebuy', amount: n as number } : null;
    }
    return typeof a.t === 'string' && SIMPLE.has(a.t) ? ({ t: a.t } as RoomAction) : null;
  },
  free: (a) => a.t === 'away' || a.t === 'back' || a.t === 'rebuy',

  apply(s, seat, a) {
    if (s.closed) return { error: 'closed' };
    // 带入不看桌上是不是他：被拒以后还没坐上的也要能再带（0.2.5）
    if (a.t === 'rebuy') return canRebuy(s, seat) ? sync(buy(s, seat, a.amount)) : { error: 'cannot_rebuy' };
    // 开打等买入到了期限（房间按"轮到这个人"计时，到点代出 timeout）：不等了，先发第一手
    if (s.opening) return a.t === 'timeout' && seat === openingSeat(s) ? sync({ ...s, opening: false }) : { error: 'not_seated' };
    const c = s.t.seats[seat];
    // 真人的买入还没到账、接管的电脑还在打这一手：桌上还不是他（电脑座位由房间替电脑出）
    if (!c || c.owner === 'none' || (s.kinds[seat] === 'human' && c.owner !== 'player')) return { error: 'not_seated' };
    const t = applyTable(s.t, seat, a);
    return isFail(t) ? t : sync({ ...s, t, last: { n: (s.last?.n ?? 0) + 1, seat, action: a } });
  },

  // 开打等买入时"轮到"第一个还没回话的人：房间替这一步计时（OPENING_MS），页面在他头像上画倒计时圈
  turn: (s) => (s.closed ? null : s.opening ? openingSeat(s) : s.t.toAct),
  turnMs: (s) => (s.opening ? OPENING_MS : TURN_MS),
  // 一手打完停着：房间停 HAND_PAUSE_MS 再发下一手（kit 0.5.0，用房间唯一的闹钟）
  pause: (s) => (!s.closed && s.t.hold ? HAND_PAUSE_MS : null),
  resume: (s) => sync({ ...s, t: deal(s.t) }),
  // 一手和一手之间没人要出手：等人坐下、补码、回来，或者买入到账（kit 0.3.2）
  waiting: (s) => s.t.phase === 'idle' && !s.t.hold,
  // 桌上一个真人都没有了、也没有买入在路上（0.2.4：离开就"立即结算"）：这一场打完，kit 马上还开房名额，办完结回再关房。
  // 不再让电脑自己一直打下去：原来要等"10 分钟没真人连着"，房主每次被送回来重新连上，房间就一直关不掉。
  // 这一手已经由 sync 替电脑打完了（停着或空闲）
  over: (s) => !s.kinds.includes('human') && !s.fx.some((e) => e.kind === 'debit') && s.t.toAct === null,
  // 嘲讽短语（kit 0.6.0 的 emote）：只转发编号、限频，不进状态、不写存储，和牌局无关
  emotes: EMOTE_COUNT,
  // 一手刚开、只交了盲注：收场时这一手作废，退回的只有盲注
  breakPoint: (s) => s.t.phase === 'idle' || s.t.log.every((e) => e.act === 'sb' || e.act === 'bb'),

  // 电脑座位按性格打；真人掉线托管只过牌或弃牌（1.4），和超时一样记进"连着超时"，两手以后暂离
  ai: (s, seat) => (s.opening || s.t.seats[seat]?.owner === 'player' ? { t: 'timeout' } : aiAction(s.t, seat)),
  timeout: () => ({ t: 'timeout' }),

  seated(s0, seat, kind) {
    let s: RoomState = { ...s0, kinds: s0.kinds.map((k, i) => (i === seat ? kind : k)) };
    if (kind !== 'human' || s.closed) return sync(s);
    const c = s.t.seats[seat];
    // 说了离桌、这一手还没打完就回来了：还没结回就接着坐；已经结回了（0.2.4 离开马上结）就等这一手打完，买新的一份坐下
    if (c?.owner === 'player' && !(c.leaving && s.sealed[seat])) return sync(c.leaving ? { ...s, t: stay(s.t, seat) } : s);
    if (!buying(s, seat)) s = buy(s, seat);
    return sync(s);
  },

  view(s, seat) {
    const v = tableView(s.t, seat);
    const mine = seat === null ? undefined : s.t.seats[seat];
    // 接管时电脑还在打的这一手、还没坐上桌：这个座位的牌不是他的
    if (mine?.owner !== 'player') v.hole = [];
    return {
      ...v,
      size: s.t.seats.length,
      buying: s.t.seats.map((_, i) => buying(s, i)),
      // 钱到账了还没在这一手里：扣到了等空出座位（接管电脑的），或者已经坐上、这一手发牌时还没到账
      next: s.t.seats.map((c, i) => s.kinds[i] === 'human' && (s.held[i]! > 0 || (c.owner === 'player' && c.status === 'out' && !c.away && c.stack > 0 && s.t.phase !== 'idle'))),
      refused: seat === null ? null : (s.refused[seat] ?? null),
      canRebuy: seat !== null && canRebuy(s, seat),
      closed: s.closed,
      last: s.last ?? null,
      net: s.t.seats.map((c, i) => {
        const inn = s.inn?.[i] ?? 0;
        if (!inn) return null;
        // 离开时已经结回的（封上了）：还留在池子里的那些算输掉的，不再算他的
        const now = (c.owner === 'player' && !s.sealed[i] ? c.stack + c.total : 0) + s.held[i]! + s.owed[i]!;
        return (s.outs?.[i] ?? 0) + now - inn;
      }),
    };
  },

  // 每个座位只交排第一的那笔：同一份的带入、结回按先后办，结回办完以后的带入才开新的一份
  effects: (s) => s.fx.filter((e, i) => s.fx.findIndex((x) => x.seat === e.seat) === i).map((e) => ({ ...e, stakes: s.t.stakes })),

  settled(s, id, result) {
    const e = s.fx.find((x) => x.id === id);
    if (!e) return s;
    const next = { ...s, fx: s.fx.filter((x) => x !== e) };
    // 结回的：钱包收了（或者那一份已经到期退过，expired）都算办完；要重办的房间那边抛错，不会到这里
    if (e.kind === 'credit') return sync(next);
    // 被拒了：开打时等的就是这一笔的话，现在可以发第一手了
    if (!isOk(result)) return sync({ ...next, refused: set(s.refused, e.seat, errorOf(result)) });
    const funded = set(s.funded, e.seat, true);
    // 这一场带入的账（0.1.1 输赢）
    const inn = set(s.inn ?? new Array<number>(SEATS).fill(0), e.seat, (s.inn?.[e.seat] ?? 0) + e.amount);
    // 这一份带入的（0.3.0 战绩：结回时算这一份的净赢）
    const fm = fameOf(s);
    const fame = { ...fm, inn: set(fm.inn, e.seat, fm.inn[e.seat]! + e.amount) };
    // 扣到了但人已经走了、房间要关了：攒着，和这一份一起结回去
    if (s.closed || s.kinds[e.seat] !== 'human') return sync({ ...next, funded, inn, fame, owed: set(s.owed, e.seat, s.owed[e.seat]! + e.amount) });
    return sync({ ...next, funded, inn, fame, held: set(s.held, e.seat, s.held[e.seat]! + e.amount) });
  },

  // 这一手作废、各人投的退回，桌上的筹码和没上桌的买入一起攒着，每人合成一笔结回
  closing: (s) => collect({ ...s, t: closeTable(s.t), closed: true }),
};

// ---------- 内部 ----------

const hex = (n: number): string => n.toString(16).padStart(8, '0');

const isOk = (r: unknown): boolean => (r as { ok?: unknown } | null)?.ok === true;

/** 钱包拒绝的原因（固定的短码），认不出来的算 error */
function errorOf(r: unknown): string {
  const e = (r as { error?: unknown } | null)?.error;
  return typeof e === 'string' && /^[a-z_]{1,32}$/.test(e) ? e : 'error';
}

const set = <T>(a: readonly T[], i: number, v: T): T[] => a.map((x, j) => (j === i ? v : x));

const debiting = (s: RoomState, seat: number): boolean => s.fx.some((e) => e.seat === seat && e.kind === 'debit');

/** 开打时还在等钱包回话的第一个座位（没有了就是 null） */
const openingSeat = (s: RoomState): number | null => s.fx.find((e) => e.kind === 'debit')?.seat ?? null;

/** 这个座位有买入在路上，或者扣到了还没上桌 */
const buying = (s: RoomState, seat: number): boolean => s.held[seat]! > 0 || debiting(s, seat);

/**
 * 补码：桌上不满一份就能补到满（0.3.0：好友房不设多余的限制；原来要输光了才能补）；
 * 或者坐下（开局、中途、接管）时带入被拒了、还没坐上牌桌：再带一次（0.2.5，原来被拒以后就卡在空座位上）
 */
const canRebuy = (s: RoomState, seat: number): boolean => {
  const c = s.t.seats[seat];
  if (s.closed || s.kinds[seat] !== 'human' || buying(s, seat)) return false;
  return c?.owner === 'player' ? !c.leaving && c.stack < stakesOf(s.t.stakes).max : s.refused[seat] !== null;
};

/**
 * 从这个座位的人的钱包扣：坐下扣满买入；桌上还有筹码的补码只补到满（0.3.0）。
 * want：钱包不够一整份时自己说带多少（平台 0.10.2 起开一份只要求余额够这次带入）：坐下最少这一档的最少买入，补码最少一个大盲，最多带满
 */
function buy(s: RoomState, seat: number, want?: number): RoomState {
  // 上一份封上了（或者还没开过）：开新的一份；还开着（补码、离座没结完又回来）就加在这一份上
  const fresh = s.sealed[seat]!;
  const n = fresh ? s.share[seat]! + 1 : s.share[seat]!;
  const c = s.t.seats[seat];
  const st = stakesOf(s.t.stakes);
  const seated = c?.owner === 'player' && !c.leaving;
  const full = seated ? st.max - c.stack : st.max;
  const amount = want === undefined ? full : Math.min(full, Math.max(seated ? st.bb : st.min, want));
  const e: Pending = { id: `b${s.nextId}`, seat, kind: 'debit', amount, ref: shareRef(s, seat, n) };
  return {
    ...s,
    fx: [...s.fx, e],
    nextId: s.nextId + 1,
    share: set(s.share, seat, n),
    sealed: set(s.sealed, seat, false),
    funded: fresh ? set(s.funded, seat, false) : s.funded,
    refused: set(s.refused, seat, null),
  };
}

const shareRef = (s: RoomState, seat: number, n: number): string => `${s.ref}s${seat}n${n}`;

/**
 * 攒要结回的，能结的合成一笔：牌桌结出来的筹码、走了的人没上桌的买入记进 owed；
 * 完全离桌（不是真人了、牌桌上也不是他了或者已经弃牌只等这一手打完，或者房间要关）、没有在路上的带入的座位，这一份结回、封上。
 * 这一份一笔带入都没办成（钱包里没有），就只封上。
 * 封上以后又攒到的（离开马上结了、这一手又被房间收场作废退回来的那点）结不回去了（钱包一份只结一次），留在 owed 里随房间删掉
 */
function collect(s0: RoomState): RoomState {
  let t = s0.t;
  const owed = [...s0.owed];
  for (const p of t.out) {
    owed[p.seat]! += p.amount;
    t = paid(t, p.id);
  }
  const held = [...s0.held];
  const sealed = [...s0.sealed];
  const fx = [...s0.fx];
  const outs = [...(s0.outs ?? new Array<number>(SEATS).fill(0))];
  const fm = fameOf(s0);
  const fame = { ...fm, per: [...fm.per], inn: [...fm.inn] };
  let nextId = s0.nextId;
  for (let i = 0; i < s0.kinds.length; i++) {
    const c = t.seats[i];
    const gone = s0.closed || (s0.kinds[i] !== 'human' && (c?.owner !== 'player' || (c.leaving && c.status === 'folded' && c.stack === 0)));
    if (!gone) continue;
    owed[i]! += held[i]!;
    held[i] = 0;
    if (sealed[i] || debiting(s0, i)) continue;
    if (s0.funded[i] || owed[i]! > 0) {
      // 这一份的小结（0.3.0）：打了几手、赢了几手、最大一把、称号；报完清零，下一份从头记
      const stats = settleStats(fame.per[i]!, owed[i]! - fame.inn[i]!, stakesOf(t.stakes).max);
      fx.push({ id: `c${nextId++}`, seat: i, kind: 'credit', amount: owed[i]!, ref: shareRef(s0, i, s0.share[i]!), stats });
      outs[i]! += owed[i]!;
    }
    fame.per[i] = NO_FAME;
    fame.inn[i] = 0;
    owed[i] = 0;
    sealed[i] = true;
  }
  return { ...s0, t, owed, held, sealed, fx, nextId, outs, fame };
}

/** 牌桌上的调用这里只会因为写错了才失败：抛出去，房间记日志、这一步不算 */
function must(t: Table | Fail): Table {
  if (isFail(t)) throw new Error(`texas room: ${t.error}`);
  return t;
}

/** 把牌桌上的座位和 kit 的座位对上（见文件头）。房间要关了就不再动牌桌 */
function sync(s0: RoomState): RoomState {
  if (s0.closed) return collect(s0);
  let s = seatPass(s0);
  // 桌上一个真人都没有了：kit 不在没人的房间里驱动电脑，这里替电脑把这一手打完，离桌的人的筹码才能马上结回去
  if (s.t.toAct !== null && !s.kinds.includes('human')) {
    let t = s.t;
    for (let k = 0; k < 500 && t.toAct !== null; k++) t = must(applyTable(t, t.toAct, aiAction(t, t.toAct)));
    s = seatPass({ ...s, t });
  }
  return collect(noteFame(s));
}

/** 战绩（0.3.0）：老房间没有就从现在起记 */
function fameOf(s: RoomState): NonNullable<RoomState['fame']> {
  const n = s.t.seats.length;
  return s.fame ?? { dealt: s.t.handNo, noted: s.t.lastHand?.handNo ?? 0, players: [], per: new Array<Fame>(n).fill(NO_FAME), inn: new Array<number>(n).fill(0) };
}

/**
 * 一手打完：那一手发牌时坐着的真人（这一份还开着的）记一手；新的一手发了：记下这时坐着的真人。
 * 一手打完时牌桌停着（holdHands），log 还是这一手完整的
 */
function noteFame(s: RoomState): RoomState {
  const t = s.t;
  const fm = fameOf(s);
  let { dealt, noted, players, per } = fm;
  const r = t.lastHand;
  if (r && r.handNo !== noted && r.handNo === dealt) {
    per = per.map((f, i) => (players.includes(i) && !s.sealed[i] ? noteHand(f, r, t.log, i) : f));
    noted = r.handNo;
  }
  if (t.phase !== 'idle' && t.handNo !== dealt) {
    dealt = t.handNo;
    players = t.seats.flatMap((c, i) => (c.owner === 'player' ? [i] : []));
  }
  return dealt === fm.dealt && noted === fm.noted && per === fm.per ? (s.fame ? s : { ...s, fame: fm }) : { ...s, fame: { ...fm, dealt, noted, players, per } };
}

function seatPass(s: RoomState): RoomState {
  let t = s.t;
  const held = [...s.held];
  const owed = [...s.owed];
  const max = stakesOf(t.stakes).max;
  // 一次把能坐的都坐上，最后再开这一手（一个一个坐的话，先坐上的两个就先打起来了）
  for (let i = 0; i < t.seats.length; i++) {
    const human = s.kinds[i] === 'human';
    const c0 = t.seats[i]!;
    // 座位换了人：原来的这一手弃牌，打完离桌（真人的筹码结回钱包，电脑的收回庄家）
    if (c0.owner !== 'none' && !c0.leaving && (c0.owner === 'player') !== human) t = must(applyTable(t, i, { t: 'leave' }));
    const c = t.seats[i]!;
    if (human && held[i]! > 0) {
      if (c.owner === 'none') {
        t = must(seatPlayer(t, i, held[i]!, false));
        held[i] = 0;
      } else if (c.owner === 'player' && !c.leaving && c.status === 'out') {
        // 补到满；补码在路上时又赢了、放不下的那点攒着，离桌时和这一份一起结回（0.3.0 补码不再要输光）
        const fit = Math.min(held[i]!, max - c.stack);
        if (fit > 0) t = must(addChips(t, i, fit, false));
        owed[i]! += held[i]! - fit;
        held[i] = 0;
      }
    } else if (!human && c.owner === 'none' && s.kinds[i] === 'ai') t = must(seatHouse(t, i, false));
    // 离开了、这一手已经弃牌：桌上剩下的马上结回（collect 接着排上），不等这一手打完
    if (!human) t = cashOut(t, i);
  }
  const opening = s.opening && s.fx.some((e) => e.kind === 'debit');
  // 一手刚打完停着（hold）时不发：房间停够了由 resume 发
  return { ...s, t: !opening && t.phase === 'idle' && !t.hold ? deal(t) : t, held, owed, opening };
}
