/**
 * 好友房的规则（DESIGN.md 第 6 节）：把一个玩法（core/variants）接到 kit 的房间上。纯函数，房间（worker/room.ts）和页面共用。
 * 不认识具体玩法，只走 Variant 接口；玩法由开房选项里的 variant 选。
 *
 * 座位上坐的是谁由 kit 管（kinds），座位上的筹码是谁的由这里管（own）：
 * - 娱乐：不碰钱包，真人一坐下就是他的；
 * - 实盘：真人坐下（开局、接管电脑）先从他的钱包扣一整份（不够一份就被拒，不少带：底分和封顶都按整份），到账了才是他的；
 *   开局时等所有人的带入都有回话（最多 OPENING_MS）再开始换三张，免得有人拿没到账的筹码打；
 * - 没到账、被拒了的真人座位由庄家出筹码、这里替电脑打（kit 只替电脑座位和托管出手），他看着，可以再带一次（rebuy）；
 * - 真人离座：把他手上的筹码（按"最多赢 3 份"截过）连同小结结回钱包，座位交给电脑，筹码归庄家接着打；
 *   实盘一局打到一半走的，电脑替他打完这一局再结回；最后一个真人也走了，电脑替所有座位打完这一局再结回（躲不掉查叫）；
 * - 整场打完、桌上没真人了、房间要关：所有还在桌上的人结回。
 *
 * 实盘至少两个真人（DESIGN.md 第 4 节）：好友房是来和朋友打的，不是来赢电脑的（电脑座位的钱归庄家）。
 * - 开局时坐着的真人不到 2 个（旧页面、脚本绕过了页面的"开打"）：整场不计输赢、不碰钱包，按娱乐打（unrated）；
 * - 开打以后还在下注的真人（筹码是他的、或者带入在路上）不到 2 个：这一场当场结束，桌上的筹码按那一刻的数结回（cut），
 *   不会变成一个人对电脑赢实盘；
 * - 实盘桌的电脑一律最强（src/ai/venues.ts 的 room:<档>），每个座位的状态各自浮动。
 *
 * 再来一场：整场打完（结回已经排上）房间停 REMATCH_MS 等人点。谁点了，他的页面先开好新房间，把房间号发过来（next），
 * 这一间就算打完，所有人的页面跟过去；到点没人点也算打完。kit 打完就还开房名额。实盘的新房间不替谁扣：各人自己坐下、房主开打才带入。
 * 钱包的事记在状态里（effects），房间去办、办完写回（settled）；同一笔可能办两次，钱包按操作 id 去重。
 * 平台钱包一份（ref）只结回一次，所以每个座位同一时间只办排第一的那笔（先扣后结），结过的那份封上，再坐下开新的一份。
 *
 * 声明窗口的公平（DESIGN.md 6.2）在玩法里：真人的回答是 free（不改名单、期限），电脑的回答带 bot、答完离开名单。
 */
import type { RoomEffect, RoomGame } from 'arcade-kit/game';
import { ROOM_CODE_RE, type SeatKind as KitSeat } from 'arcade-kit/protocol';
import { stream } from 'arcade-kit/rng';
import { AIS } from '../ai/index.ts';
import { seatPlan, venueOf } from '../ai/venues.ts';
import { DEFAULT_VARIANT, variantOf, VARIANTS, type AnyVariant } from '../core/variants/index.ts';
import type { SettleStats } from '../core/match/index.ts';
import { EMOTES } from '../game/emotes.ts';
import { baseOf, STAKES, stakesOf, type StakesId } from '../game/stakes.ts';

/** 每个玩法的座位数都是 4（加三人玩法时这里改成按玩法定，kit 的 seatCount） */
export const SEATS = 4;
/** 开局等带入回话最多这么久：钱包一直连不上的人先由庄家出筹码打，到账了再接手 */
export const OPENING_MS = 20_000;
/** 好友房里电脑每出一手的播放时间（房间的 aiDelayMs）：页面按它放动画 */
export const AI_DELAY_MS = 900;
/** 规则版本：玩法自己的版本由玩法管，这里只管房间这一层 */
export const ROOM_RULES = 1;
/** 整场打完等人点"再来一场"多久（房间停着，用 kit 的 pause，不另加定时器） */
export const REMATCH_MS = 180_000;
/** 实盘好友房至少几个真人 */
export const MIN_HUMANS = 2;

export interface RoomOpts {
  variant: string;
  stakes: StakesId;
  /** 玩法的选项（玩法的 options 校验过） */
  rules: unknown;
}

const DEFAULT_OPTS: RoomOpts = { variant: DEFAULT_VARIANT, stakes: 'fun', rules: VARIANTS[DEFAULT_VARIANT]!.defaults };

/** 要去钱包办的一笔：debit 带入，credit 结回；ref 是钱包里"桌上那一份"的号：房间号 + s 座位 + n 第几份 */
export interface Pending extends RoomEffect {
  kind: 'debit' | 'credit';
  amount: number;
  ref: string;
  stats?: SettleStats;
}

/** 交给房间去办的：带上档位（操作 id = ref-id） */
export interface WalletEffect extends Pending {
  stakes: StakesId;
}

export interface RoomState {
  variant: string;
  stakes: StakesId;
  /** 玩法的状态（含密钥，只在服务端） */
  g: unknown;
  /** 房间号（开局随机）：每一份的 ref 和钱包操作 id 的前缀（不是秘密） */
  ref: string;
  /** kit 那边每个座位坐的是谁 */
  kinds: KitSeat[];
  /** 这个座位的筹码是坐着的真人的（带入到账了；娱乐一坐下就是） */
  own: boolean[];
  /** 每个座位现在是第几份（0 是还没开过） */
  share: number[];
  /** 这一份带进来多少（到账的；0 是钱包里没有这一份） */
  inn: number[];
  /** 这一份已经结回（或者排上了）：再坐下开新的一份 */
  sealed: boolean[];
  /** 这个座位上一次带入被钱包拒了的原因 */
  refused: (string | null)[];
  fx: Pending[];
  nextId: number;
  /** 开局等带入回话 */
  opening: boolean;
  /** 整场打完、结回已经排上 */
  done: boolean;
  /** 房间要关了：不再动牌局，只等结回 */
  closed: boolean;
  /** 再来一场：谁（座位）开好了哪个新房间 */
  next: { code: string; by: number } | null;
  /** 整场打完、等"再来一场"到点了没人点 */
  ended: boolean;
  /** 实盘档开局时真人不到 MIN_HUMANS：整场不计输赢、不碰钱包（部署前的房间没有这个字段，按 false） */
  unrated?: boolean;
  /** 实盘开打以后下注的真人不到 MIN_HUMANS，这一场当场结束了 */
  cut?: boolean;
  /**
   * 实盘一局打到一半离座的：筹码还是他的、留在桌上，电脑替他打完这一局再结回（release）。
   * 当场按离座那一刻结回的话，眼看这一局要输（没听牌要被查叫、别人要自摸）就走、过后再坐回来，能躲掉输（审计中危）。部署前的房间没有这个字段，按都没有算
   */
  leaving?: boolean[];
  /** 牌局走了几步（出牌、发下一局）：钱包到账、座位换人这些不算。页面按它判断 g 里的事件是不是新的，免得同一串动画放两遍 */
  n: number;
}

/**
 * play 是玩法的动作（v 是玩法 id），rebuy 是被拒以后再带一次，next 是整场打完后"再来一场"（新房间号）；go 只由房间在开局等带入超时时代出。
 * 客户端发来的在 parse 里就过玩法的 parse（只收真人能发的：expire、bot 只由服务端造）；
 * kit 的 ai、timeout 造的不经过 parse，所以 apply 不再 parse 一遍
 */
export type RoomAction = { t: 'play'; v: string; a: unknown; srv?: true } | { t: 'rebuy' } | { t: 'next'; code: string } | { t: 'go' };

export interface RoomView {
  variant: string;
  stakes: StakesId;
  /** 玩法给这个座位的视图 */
  g: unknown;
  /** 见 RoomState.n */
  n: number;
  /** 每个座位：筹码是坐着的真人的 */
  own: boolean[];
  /** 每个座位：正在等钱包扣带入 */
  buying: boolean[];
  /** 我这一份带进来多少（娱乐、没到账、旁观是 0）。只给本人 */
  inn: number;
  /** 我上一次带入被拒的原因 */
  refused: string | null;
  canRebuy: boolean;
  opening: boolean;
  done: boolean;
  closed: boolean;
  next: { code: string; by: number } | null;
  /** 见 RoomState.unrated、cut */
  unrated: boolean;
  cut: boolean;
}

/**
 * 搭子战绩（docs/platform-backend.md 15.19，DESIGN.md 第 6 节）的输赢：这一场分数（净输赢）为正算赢，平和输都不算。
 * 按座位给，电脑座位也给（kit 按开打时绑的人认，没绑真人的不报）；提前收场（cut）的按收场那一刻算
 */
export function matchWins(s: RoomState): boolean[] {
  return vOf(s).result(s.g).seats.map((x) => x.net > 0);
}

export const mahjongRoom: RoomGame<RoomState, RoomAction, RoomView, RoomOpts, WalletEffect> = {
  seats: SEATS,
  rulesVersion: ROOM_RULES,
  emotes: EMOTES,

  options(raw) {
    if (raw === undefined || raw === null) return DEFAULT_OPTS;
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const v = variantOf(o.variant ?? DEFAULT_VARIANT);
    if (!v || v.seats !== SEATS || !STAKES.some((x) => x.id === o.stakes)) return null;
    const rules = v.options(o.rules);
    return rules ? { variant: v.id, stakes: o.stakes as StakesId, rules } : null;
  },

  begin(entropy, _rv, setup) {
    const opts = setup?.opts ?? DEFAULT_OPTS;
    const v = VARIANTS[opts.variant]!;
    const st = stakesOf(opts.stakes)!;
    const kinds = Array.from({ length: SEATS }, (_, i) => setup?.seats[i] ?? 'ai');
    // 真人不到两个的实盘档不计输赢（页面会把"开打"灰掉，这里防旧页面、脚本）
    const unrated = st.wallet && kinds.filter((k) => k === 'human').length < MIN_HUMANS;
    const wallet = st.wallet && !unrated;
    // 电脑按场地挑性格、各配这一场的状态：实盘桌一律最强（venues.ts）
    const { personas, tunes } = seatPlan(stream(entropy, 'persona'), venueOf('room', st.id, wallet), SEATS);
    const g = v.begin(entropy, opts.rules, kinds.map((k) => (k === 'human' ? 'human' : 'ai')), { share: st.share, base: baseOf(st.share), personas, tunes });
    const r = stream(entropy, 'room');
    let s: RoomState = {
      variant: v.id,
      stakes: st.id,
      g,
      ref: `r${hex(r.u32())}${hex(r.u32())}`,
      kinds,
      own: kinds.map((k) => k === 'human' && !wallet),
      share: zeros(),
      inn: zeros(),
      sealed: new Array<boolean>(SEATS).fill(true),
      refused: new Array<string | null>(SEATS).fill(null),
      fx: [],
      nextId: 0,
      opening: wallet,
      done: false,
      closed: false,
      next: null,
      ended: false,
      unrated,
      cut: false,
      n: 0,
    };
    kinds.forEach((k, i) => {
      if (k === 'human' && wallet) s = buy(s, i, st.share);
    });
    return sync(s);
  },
  start() {
    throw new Error('mahjong rooms use begin');
  },

  parse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as { t?: unknown; a?: unknown };
    if (a.t === 'rebuy') return { t: 'rebuy' };
    // 新房间号只收合法的格式（6 位数字），别的一律不认
    if (a.t === 'next') {
      const code = (raw as { code?: unknown }).code;
      return typeof code === 'string' && ROOM_CODE_RE.test(code) ? { t: 'next', code } : null;
    }
    if (a.t !== 'play') return null;
    // 玩法之间的动作形状可能撞：按登记表的顺序取第一个认得的，apply 再对一下是不是这一桌的玩法
    for (const v of Object.values(VARIANTS)) {
      const x = v.parse(a.a);
      if (x !== null) return { t: 'play', v: v.id, a: x };
    }
    return null;
  },
  free: (a) => a.t === 'rebuy' || a.t === 'next' || (a.t === 'play' && VARIANTS[a.v]!.free(a.a)),

  apply(s, seat, a) {
    // 只有打完、还在等、桌上的真人能点，先点的算
    if (a.t === 'next') return s.done && !s.closed && !s.ended && !s.next && s.kinds[seat] === 'human' ? { ...s, next: { code: a.code, by: seat } } : { error: 'not_now' };
    if (s.closed || s.done) return { error: 'closed' };
    if (a.t === 'rebuy') return canRebuy(s, seat) ? sync(buy(s, seat, stakesOf(s.stakes)!.share)) : { error: 'cannot_rebuy' };
    if (a.t === 'go') return s.opening && seat === openingSeat(s) ? sync({ ...s, opening: false }) : { error: 'not_now' };
    if (s.opening) return { error: 'opening' };
    if (a.v !== s.variant) return { error: 'bad_action' };
    const v = vOf(s);
    // 真人坐着、筹码还不是他的（没到账、被拒了）：由这里替电脑打，他不能出手。
    // 房间到点替这个座位代出（kit 的 timeout、ai）时照样往下推：sync 一次没推完的，不能卡住
    if (s.kinds[seat] === 'human' && !s.own[seat]) {
      if (!a.srv) return { error: 'not_seated' };
      const g = v.apply(s.g, seat, v.auto(s.g, seat, aiOf(s)));
      return isError(g) ? g : sync({ ...s, g, n: s.n + 1 }, true);
    }
    const g = v.apply(s.g, seat, a.a);
    if (isError(g)) return g;
    // 声明窗口里真人答了、窗口还没结束（玩法没出事件）：别人什么都不该看出来。
    // 步数不加、上一步的事件原样留着，别人的视图一点不变，kit 0.7.1 就只回给他、不广播
    const ev = (g as { events?: unknown[] }).events;
    if (v.free(a.a) && ev !== undefined && ev.length === 0) return sync({ ...s, g: { ...(g as object), events: (s.g as { events?: unknown[] }).events ?? [] } });
    return sync({ ...s, g, n: s.n + 1 }, true);
  },

  turn: () => null,
  actors(s) {
    if (s.closed || s.done) return [];
    if (s.opening) return { seats: [openingSeat(s)!], group: 'opening' };
    const act = vOf(s).actors(s.g);
    return act ? { seats: act.seats, group: act.group } : [];
  },
  turnMs: (s) => (s.opening ? OPENING_MS : vOf(s).turnMs(s.g)),
  // 整场打完停着等"再来一场"，到点 resume 就收场
  pause: (s) => (s.done ? REMATCH_MS : s.opening || s.closed ? null : vOf(s).pause(s.g)),
  resume: (s) => (s.done ? { ...s, ended: true } : sync({ ...s, g: vOf(s).resume(s.g), n: s.n + 1 }, true)),
  // 有人开了新房间、等到点了、房间要关，或者桌上没有真人了（离开的都马上结回了）也没有带入在路上：房间就算打完，kit 办完结回再关
  // 部署前存下的房间没有 next、ended 两个字段，按没有算（不能拿 undefined 和 null 比）
  // 真人都走了（含这一局里离座、还没结回的）：kit 桌上没真人时不再推电脑，等这一局打完只会空等到关房，所以马上收场、按那一刻结回（closing）
  over: (s) => s.closed || !!s.ended || !!s.next || (!s.kinds.includes('human') && !s.fx.some((e) => e.kind === 'debit')),
  breakPoint: (s) => s.opening || s.done || vOf(s).breakPoint(s.g),

  ai: (s, seat) => (s.opening ? { t: 'go' } : { t: 'play', v: s.variant, a: vOf(s).auto(s.g, seat, aiOf(s)), srv: true }),
  timeout: (s, seat) => (s.opening ? { t: 'go' } : { t: 'play', v: s.variant, a: vOf(s).timeout(s.g, seat, aiOf(s)), srv: true }),

  seated(s0, seat, kind) {
    let s: RoomState = { ...s0, kinds: set(s0.kinds, seat, kind) };
    if (s.closed || s.done) return s;
    const v = vOf(s);
    if (kind === 'ai') {
      // 离座：他的那一份结回（筹码按"最多赢 3 份"截过，带上这一场的小结），座位交给电脑、筹码归庄家接着打。
      // 实盘一局打到一半走的，这一局照算：电脑替他打完这一局再结回（leaving，见 RoomState）
      if (!s.own[seat]) return sync(s);
      if (walletOf(s) && !s.opening && !v.breakPoint(s.g)) {
        s = { ...s, leaving: set(s.leaving ?? noOne(), seat, true) };
        // 桌上一个真人都没了：kit 不推只有电脑的桌、房间就此打完（over），所以由这里替所有座位把这一局打完再结回，
        // 不按半局的筹码结（几个人串通一起走就能躲掉查叫，第三轮审计）
        return sync(s.kinds.includes('human') ? s : release(playOut(s), true));
      }
      s = settle(s, seat);
      return sync({ ...s, g: v.seated(s.g, seat, 'ai') });
    }
    // 这一局还没结回就回来了：筹码本来就是他的，接着打，不另开一份
    if (s.leaving?.[seat]) s = { ...s, leaving: set(s.leaving, seat, false) };
    if (s.own[seat] || debiting(s, seat)) return sync(s);
    const st = stakesOf(s.stakes)!;
    // 娱乐（含不计输赢的实盘档）：坐下就是他的，从一份重新算
    if (!walletOf(s)) return sync({ ...s, own: set(s.own, seat, true), g: v.restake(v.seated(s.g, seat, 'human'), seat, st.share) });
    return sync(buy(s, seat, st.share));
  },

  view(s, seat) {
    return {
      variant: s.variant,
      stakes: s.stakes,
      g: vOf(s).view(s.g, seat),
      n: s.n,
      own: s.own,
      buying: s.kinds.map((_, i) => debiting(s, i)),
      inn: seat === null ? 0 : s.inn[seat]!,
      refused: seat === null ? null : (s.refused[seat] ?? null),
      canRebuy: seat !== null && canRebuy(s, seat),
      opening: s.opening,
      done: s.done,
      closed: s.closed,
      next: s.next ?? null,
      unrated: !!s.unrated,
      cut: !!s.cut,
    };
  },

  // 每个座位只交排第一的那笔：同一份先扣后结
  effects: (s) => s.fx.filter((e, i) => s.fx.findIndex((x) => x.seat === e.seat) === i).map((e) => ({ ...e, stakes: s.stakes })),

  settled(s, id, result) {
    const e = s.fx.find((x) => x.id === id);
    if (!e) return s;
    const next: RoomState = { ...s, fx: s.fx.filter((x) => x !== e) };
    // 结回的：钱包收了（或者那一份已经到期退过）都算办完；要重办的房间那边抛错，不会到这里
    if (e.kind === 'credit') return sync(next);
    if (!isOk(result)) {
      const why = errorOf(result);
      // 钱包不够一份也不少带（0.15.2）：底分和"最多赢 3 份"都按整份，少带的人输得少、赢得一样多（第三轮审计）。
      // 这一份没开成（下次带入还用这个号），座位由庄家出筹码、电脑接着打
      const g = s.closed ? s.g : vOf(s).seated(s.g, e.seat, 'ai');
      return sync({ ...next, g, refused: set(s.refused, e.seat, why), sealed: set(s.sealed, e.seat, true), share: set(s.share, e.seat, s.share[e.seat]! - 1) });
    }
    const inn = set(s.inn, e.seat, s.inn[e.seat]! + e.amount);
    // 到账时人已经走了、牌局打完了、房间要关了：原样结回去
    if (s.closed || s.done || s.kinds[e.seat] !== 'human') return sync(credit({ ...next, inn }, e.seat, e.amount));
    const v = vOf(s);
    const g = v.restake(v.seated(s.g, e.seat, 'human'), e.seat, e.amount);
    return sync({ ...next, inn, g, own: set(s.own, e.seat, true) });
  },

  // 牌局不再动，所有人桌上的筹码结回钱包
  closing(s) {
    let next: RoomState = { ...s, closed: true, opening: false, ...(s.leaving ? { leaving: noOne() } : {}) };
    for (let i = 0; i < SEATS; i++) if (next.own[i]) next = settle(next, i);
    return next;
  },
};

// ---------- 内部 ----------

const zeros = (): number[] => new Array<number>(SEATS).fill(0);
const hex = (n: number): string => n.toString(16).padStart(8, '0');
const set = <T>(a: readonly T[], i: number, v: T): T[] => a.map((x, j) => (j === i ? v : x));
const vOf = (s: RoomState): AnyVariant => VARIANTS[s.variant]!;
const aiOf = (s: RoomState) => AIS[s.variant]!;
const isError = (x: unknown): x is { error: string } => typeof (x as { error?: unknown }).error === 'string';
const isOk = (r: unknown): boolean => (r as { ok?: unknown } | null)?.ok === true;

/** 钱包拒绝的原因（固定的短码），认不出来的算 error */
function errorOf(r: unknown): string {
  const e = (r as { error?: unknown } | null)?.error;
  return typeof e === 'string' && /^[a-z_]{1,32}$/.test(e) ? e : 'error';
}

/** 这一桌碰钱包：实盘档，而且开局时真人够数 */
const walletOf = (s: RoomState): boolean => stakesOf(s.stakes)!.wallet && !s.unrated;

/** 还在下注的真人：筹码是他的（含离座了、这一局还没结回的），或者带入在路上 */
const betting = (s: RoomState): number => s.kinds.filter((k, i) => s.own[i] || (k === 'human' && debiting(s, i))).length;

const noOne = (): boolean[] => new Array<boolean>(SEATS).fill(false);

/** 桌上没真人了：电脑替所有座位（含离座、这一局还没结回的）把这一局打到结算；事件只留最后一步的（没人在打，旁观的不用看整局的动画） */
function playOut(s: RoomState): RoomState {
  const v = vOf(s);
  const ai = aiOf(s);
  let g = s.g;
  // 上限同 sync：一局几百步就到结算，推不完（不该发生）就按这一刻结回
  for (let k = 0; k < 2_000 && !v.breakPoint(g) && !v.over(g); k++) {
    const seat = v.actors(g)?.seats[0];
    if (seat === undefined) break;
    const next = v.apply(g, seat, v.auto(g, seat, ai));
    if (isError(next)) throw new Error(`mahjong room: play-out move rejected: ${next.error}`);
    g = next;
  }
  return { ...s, g, n: s.n + 1 };
}

/** 一局打完了（停在结算），或者 now（桌上没真人了）：这一局里离座的人现在结回，座位交给电脑 */
function release(s0: RoomState, now = false): RoomState {
  if (!s0.leaving?.some(Boolean)) return s0;
  const v = vOf(s0);
  if (!now && !v.breakPoint(s0.g)) return s0;
  let s = s0;
  for (let i = 0; i < SEATS; i++) {
    if (!s.leaving![i]) continue;
    s = settle({ ...s, leaving: set(s.leaving!, i, false) }, i);
    s = { ...s, g: v.seated(s.g, i, 'ai') };
  }
  return s;
}

const debiting = (s: RoomState, seat: number): boolean => s.fx.some((e) => e.seat === seat && e.kind === 'debit');

/** 开局时还在等钱包回话的第一个座位 */
const openingSeat = (s: RoomState): number | null => s.fx.find((e) => e.kind === 'debit')?.seat ?? null;

/** 真人坐着、筹码不是他的、没有带入在路上：再带一次（被拒了的，比如钱包补够了一份） */
const canRebuy = (s: RoomState, seat: number): boolean =>
  !s.closed && !s.done && s.kinds[seat] === 'human' && !s.own[seat] && !debiting(s, seat) && walletOf(s);

/** 从这个座位的人的钱包扣：上一份封上了就开新的一份 */
function buy(s: RoomState, seat: number, amount: number): RoomState {
  const fresh = s.sealed[seat]!;
  const n = fresh ? s.share[seat]! + 1 : s.share[seat]!;
  const e: Pending = { id: `b${s.nextId}`, seat, kind: 'debit', amount, ref: `${s.ref}s${seat}n${n}` };
  return {
    ...s,
    fx: [...s.fx, e],
    nextId: s.nextId + 1,
    share: set(s.share, seat, n),
    sealed: set(s.sealed, seat, false),
    inn: fresh ? set(s.inn, seat, 0) : s.inn,
    refused: set(s.refused, seat, null),
  };
}

/** 这一份结回 amount 并封上 */
function credit(s: RoomState, seat: number, amount: number, stats?: SettleStats): RoomState {
  const e: Pending = { id: `c${s.nextId}`, seat, kind: 'credit', amount, ref: `${s.ref}s${seat}n${s.share[seat]}`, ...(stats ? { stats } : {}) };
  return { ...s, fx: [...s.fx, e], nextId: s.nextId + 1, sealed: set(s.sealed, seat, true), own: set(s.own, seat, false) };
}

/** 这个座位的人带着桌上的筹码走：实盘结回（娱乐只是不再是他的） */
function settle(s: RoomState, seat: number): RoomState {
  if (!walletOf(s) || s.inn[seat] === 0) return { ...s, own: set(s.own, seat, false) };
  const r = vOf(s).result(s.g).seats[seat]!;
  return credit(s, seat, Math.max(0, r.chips), r.stats);
}

/**
 * 每一步之后：开局的带入都有回话了就开打；真人坐着、筹码不是他的座位由这里替电脑打（kit 不替真人座位出手）；
 * 整场打完了，桌上的真人都结回。这里连着出的几步，玩法的事件接在一起（页面按事件放动画）
 */
function sync(s0: RoomState, moving = false): RoomState {
  let s = s0;
  if (s.closed || s.done) return s;
  if (s.opening && !s.fx.some((e) => e.kind === 'debit')) s = { ...s, opening: false };
  if (s.opening) return s;
  const v = vOf(s);
  s = release(s);
  // 实盘下注的真人不到两个了（有人离座、带入被拒）：这一场到此为止，下面按打完结回所有人
  if (walletOf(s) && betting(s) < MIN_HUMANS) s = { ...s, g: v.finish(s.g), cut: true, n: s.n + 1 };
  const ai = aiOf(s);
  // 这一次是接着玩家的一步（n 变了）就把事件接在后面；从钱包到账、座位换人过来的，前面的事件是上一步的，不再带
  let moved = moving;
  // 上限按一整局算（摸打约 55 手，每手加一个声明窗口最多 3 个回答，再加杠）：一局打完会停在结算，到点 resume 再接着推。
  // 真推不完（不该发生）也不报错，kit 到点代出时 apply 接着推（见上面 srv）
  for (let k = 0; k < 2_000; k++) {
    const act = v.actors(s.g);
    const seat = act?.seats.find((i) => s.kinds[i] === 'human' && !s.own[i]);
    if (seat === undefined || v.over(s.g)) break;
    const prev = moved ? ((s.g as { events?: unknown[] }).events ?? []) : [];
    const g = v.apply(s.g, seat, v.auto(s.g, seat, ai));
    if (isError(g)) throw new Error(`mahjong room: house move rejected: ${g.error}`);
    const ev = (g as { events?: unknown[] }).events;
    s = { ...s, g: ev ? { ...(g as object), events: [...prev, ...ev] } : g, n: moved ? s.n : s.n + 1 };
    moved = true;
  }
  if (!v.over(s.g)) return release(s);
  // 打完了：桌上的筹码（含离座了、还没结回的）一起结回
  s = { ...s, done: true, ...(s.leaving ? { leaving: noOne() } : {}) };
  for (let i = 0; i < SEATS; i++) if (s.own[i]) s = settle(s, i);
  return s;
}
