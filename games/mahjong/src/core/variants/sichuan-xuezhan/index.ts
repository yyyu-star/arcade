/**
 * 川麻·血战到底：把规则（rules.ts）包成统一的玩法接口（../types.ts），加上视图、选项和动作的校验、超时代出、一场的结果和称号。
 */
import { MAX_TITLES, type Payment, type SettleStats } from '../../match/index.ts';
import { wallLeft, type ClaimKind, type Meld, type RiverTile } from '../../table/index.ts';
import type { Suit, Tile } from '../../tiles/index.ts';
import { NEUTRAL_TUNE, type MatchResult, type Tune, type Variant, type VariantAi } from '../types.ts';
import {
  actorsOf,
  applyMut,
  begin,
  canZimo,
  DEFAULT_OPTS,
  discardOptions,
  kanOptions,
  resumeMut,
  restakeMut,
  RULES_VERSION,
  SEATS,
  seatedMut,
  TILESET,
  VARIANT,
  type Phase,
  type RoundSummary,
  type SeatStats,
  type Win,
  type XzAction,
  type XzEvent,
  type XzOpts,
  type XzState,
} from './rules.ts';

export * from './rules.ts';
export * from './fan.ts';

/** 好友房的时限（DESIGN.md 2.9） */
export const TURN_MS: Record<'swap' | 'que' | 'turn' | 'claim', number> = { swap: 30_000, que: 30_000, turn: 25_000, claim: 12_000 };
/** 一局结算停多久再开下一局 */
export const END_PAUSE_MS = 8_000;

/** 暗杠的牌别人看不见：视图里用这个数代替 */
export const HIDDEN = -1;

/** 我现在能做什么（界面的按钮、电脑的选择都从这里来） */
export interface Prompt {
  swap?: true;
  que?: true;
  /** 能打的牌（有缺先打缺） */
  discard?: Tile[];
  zimo?: true;
  kan?: Tile[];
  /** 声明窗口里我能做的（只给有选择、还没答的人） */
  claim?: { w: number; opts: ClaimKind[] };
}

export interface SeatView {
  kind: 'human' | 'ai';
  persona: number;
  chips: number;
  /** 定的缺：定缺阶段别人的不给，只给"选好了没有" */
  que: Suit | -1;
  ready: boolean;
  melds: Meld[];
  river: RiverTile[];
  count: number;
  won: Win | null;
  /** 胡了、或者一局结束时亮出来的手牌 */
  hand: Tile[] | null;
  stats: SeatStats;
}

export interface XzView {
  variant: typeof VARIANT;
  v: number;
  phase: Phase;
  opts: XzOpts;
  share: number;
  base: number;
  round: number;
  dealer: number;
  turn: number;
  wall: number;
  swapDir: number | null;
  seats: SeatView[];
  /** tune 是这个座位当电脑时这一场的状态（只给本人，电脑出手时用） */
  me: { seat: number; hand: Tile[]; drawn: Tile | null; swapOut: Tile[] | null; swapIn: Tile[] | null; tune: Tune } | null;
  prompt: Prompt | null;
  /** 正在被声明的那张牌（公开），我答过没有 */
  claim: { id: number; tile: Tile; from: number; rob: boolean; answered: boolean } | null;
  events: XzEvent[];
  ledger: Payment[];
  history: RoundSummary[];
  result: MatchResult | null;
}

const clone = <T>(x: T): T => structuredClone(x);

function prompt(s: XzState, seat: number): Prompt | null {
  const p = s.players[seat]!;
  if (s.phase === 'swap') return p.swapOut ? null : { swap: true };
  if (s.phase === 'que') return p.que >= 0 ? null : { que: true };
  if (s.phase === 'turn' && s.turn === seat) {
    const out: Prompt = { discard: discardOptions(p) };
    if (canZimo(s, seat)) out.zimo = true;
    const k = kanOptions(s, seat);
    if (k.length) out.kan = k;
    return out;
  }
  if (s.phase === 'claim') {
    const c = s.claim!;
    const opts = c.opts[seat]!;
    if (opts.length && c.ans[seat] === null) return { claim: { w: c.id, opts } };
  }
  return null;
}

export function view(s: XzState, seat: number | null): XzView {
  const reveal = s.phase === 'end' || s.phase === 'over';
  const queOpen = s.phase !== 'swap' && s.phase !== 'que';
  const seats: SeatView[] = s.players.map((p, i) => ({
    kind: s.kinds[i]!,
    persona: s.personas[i]!,
    chips: s.chips[i]!,
    que: queOpen || i === seat ? p.que : -1,
    ready: s.phase === 'swap' ? !!p.swapOut : s.phase === 'que' ? p.que >= 0 : true,
    melds: p.melds.map((m) => (m.kan === 'concealed' && i !== seat && !reveal && !p.won ? { ...m, tiles: m.tiles.map(() => HIDDEN) } : clone(m))),
    river: p.river.map((r) => ({ ...r })),
    count: p.hand.length,
    won: p.won ? clone(p.won) : null,
    hand: reveal || p.won || i === seat ? p.hand.slice() : null,
    stats: clone(s.stats[i]!),
  }));
  const me =
    seat === null
      ? null
      : (() => {
          const p = s.players[seat]!;
          const tune = s.tunes?.[seat] ?? NEUTRAL_TUNE;
          return { seat, hand: p.hand.slice(), drawn: s.turn === seat ? s.drawn : null, swapOut: p.swapOut?.slice() ?? null, swapIn: p.swapIn?.slice() ?? null, tune: { ...tune } };
        })();
  // 别人摸的牌、暗杠的牌只说"有这么回事"（画面要动一下），不给牌面
  const events = s.events.map((e): XzEvent => {
    if (e.e === 'draw' && e.seat !== seat) return { ...e, tile: HIDDEN };
    if (e.e === 'kan' && e.kan === 'concealed' && e.seat !== seat && !reveal) return { ...e, tile: HIDDEN };
    return clone(e);
  });
  const c = s.claim;
  return {
    variant: VARIANT,
    v: s.v,
    phase: s.phase,
    opts: { ...s.opts },
    share: s.share,
    base: s.base,
    round: s.round,
    dealer: s.dealer,
    turn: s.turn,
    wall: wallLeft(s.wall),
    swapDir: s.swapDir,
    seats,
    me,
    prompt: seat === null ? null : prompt(s, seat),
    claim: c ? { id: c.id, tile: c.tile, from: c.from, rob: c.rob, answered: seat !== null && (c.ans[seat] !== null || c.bot[seat]!) } : null,
    events,
    ledger: s.ledger.map((x) => ({ ...x })),
    history: clone(s.history),
    result: s.phase === 'over' ? result(s) : null,
  };
}

// ---------- 称号和一场的结果 ----------

/** 称号从稀有到常见（一场最多报 5 个给平台，先挑稀有的；结算页全显示） */
export const TITLE_ORDER = [
  'xz_heaven',
  'xz_earth',
  'xz_dragon',
  'xz_golden_hook',
  'xz_rob_gang',
  'xz_sea_moon',
  'xz_gang_flower',
  'xz_capped',
  'xz_qing',
  'xz_seven',
  'xz_last_stand',
  'xz_iron_wall',
  'xz_gang_king',
  'xz_zimo_king',
  'xz_winner',
  'xz_pao_king',
] as const;

/** 每个座位这一场的全部称号：自己挣的 + 跟全场比出来的（大赢家、点炮王、杠王……） */
export function titlesOf(s: XzState): string[][] {
  const net = s.chips.map((c, i) => c - s.stake[i]!);
  const top = Math.max(...net);
  const most = (f: (x: SeatStats) => number, min: number): number[] => {
    const m = Math.max(...s.stats.map(f));
    return m >= min ? s.stats.map((x, i) => (f(x) === m ? i : -1)).filter((i) => i >= 0) : [];
  };
  const pao = most((x) => x.pao, 3);
  const gang = most((x) => x.gangs, 3);
  return s.stats.map((st, i) => {
    const t = new Set(st.flags);
    if (top > 0 && net[i] === top) t.add('xz_winner');
    if (pao.includes(i)) t.add('xz_pao_king');
    if (gang.includes(i)) t.add('xz_gang_king');
    if (st.zimo >= 3) t.add('xz_zimo_king');
    if (st.pao === 0 && st.rounds >= 8) t.add('xz_iron_wall');
    return TITLE_ORDER.filter((x) => t.has(x));
  });
}

export function result(s: XzState): MatchResult {
  const titles = titlesOf(s);
  return {
    seats: s.chips.map((c, i) => {
      // 一场最多赢 3 份：超出的不进（归庄家）
      const chips = Math.min(c, s.stake[i]! + s.share * 3);
      const st = s.stats[i]!;
      const stats: SettleStats = {
        rounds: st.rounds,
        wins: st.wins,
        best: Math.max(0, st.best),
        ...(titles[i]!.length ? { titles: titles[i]!.slice(0, MAX_TITLES) } : {}),
        max: { xz_fan: st.maxFan },
        sum: { xz_gang: st.gangs, xz_zimo: st.zimo },
      };
      return { chips, net: chips - s.stake[i]!, stats };
    }),
  };
}

// ---------- 选项、动作的校验 ----------

export function options(raw: unknown): XzOpts | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTS };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = { ...DEFAULT_OPTS, ...(raw as Partial<XzOpts>) };
  if (![4, 8, 16].includes(o.rounds) || ![3, 4, 5].includes(o.cap)) return null;
  if (typeof o.swap !== 'boolean' || typeof o.transfer !== 'boolean' || (o.zimo !== 'di' && o.zimo !== 'fan')) return null;
  return { rounds: o.rounds, cap: o.cap, swap: o.swap, zimo: o.zimo, transfer: o.transfer };
}

const isTile = (x: unknown): x is Tile => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 108;
const isWin = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) < 1e9;

/**
 * 只收真人能发的动作。expire（收掉整个声明窗口）和 bot（电脑的回答，答完离开名单）只由服务端的 timeout、auto 造：
 * 客户端能发的话，任何人都能在别人打牌后马上收掉窗口，砍掉别人碰、杠、胡的时间
 */
export function parse(raw: unknown): XzAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.t) {
    case 'swap':
      return Array.isArray(a.tiles) && a.tiles.length === 3 && a.tiles.every(isTile) ? { t: 'swap', tiles: a.tiles.slice() } : null;
    case 'que':
      return a.suit === 0 || a.suit === 1 || a.suit === 2 ? { t: 'que', suit: a.suit } : null;
    case 'discard':
      return isTile(a.tile) ? { t: 'discard', tile: a.tile } : null;
    case 'zimo':
      return { t: 'zimo' };
    case 'kan':
      return isTile(a.tile) ? { t: 'kan', tile: a.tile } : null;
    case 'claim':
      if (!isWin(a.w) || !['ron', 'kan', 'pon', 'pass'].includes(a.c as string)) return null;
      return a.bot === undefined ? { t: 'claim', w: a.w, c: a.c as 'ron' | 'kan' | 'pon' | 'pass' } : null;
    default:
      return null;
  }
}

/** 做一步：复制一份再改，这一步的事件从空开始记 */
export function apply(s: XzState, seat: number, a: XzAction): XzState | { error: string } {
  const next = structuredClone(s);
  next.events = [];
  const err = applyMut(next, seat, a);
  return err ? { error: err } : next;
}

/** 超时代出：换三张、定缺照电脑的选法；自己的一手能胡就胡，不然打（缺门优先）最右边那张；声明窗口整个收掉 */
export function timeout(s: XzState, seat: number, ai: VariantAi<XzView, XzAction>): XzAction {
  if (s.phase === 'claim') return { t: 'expire', w: s.claim!.id };
  if (s.phase === 'turn' && s.turn === seat) {
    if (canZimo(s, seat)) return { t: 'zimo' };
    const opts = discardOptions(s.players[seat]!);
    const drawn = s.drawn;
    return { t: 'discard', tile: drawn !== null && opts.includes(drawn) ? drawn : opts[opts.length - 1]! };
  }
  return auto(s, seat, ai);
}

/** 电脑、托管：声明窗口里没选择的直接"过"（不用想），有选择的问电脑；回答都带 bot（答完离开名单） */
export function auto(s: XzState, seat: number, ai: VariantAi<XzView, XzAction>): XzAction {
  if (s.phase === 'claim') {
    const c = s.claim!;
    if (!c.opts[seat]!.length) return { t: 'claim', w: c.id, c: 'pass', bot: true };
    const a = ai.decide(view(s, seat));
    return a.t === 'claim' ? { ...a, bot: true } : { t: 'claim', w: c.id, c: 'pass', bot: true };
  }
  return ai.decide(view(s, seat));
}

export const sichuanXuezhan: Variant<XzState, XzAction, XzView, XzOpts> = {
  id: VARIANT,
  name: '川麻·血战到底',
  tileSet: TILESET,
  rulesVersion: RULES_VERSION,
  seats: SEATS,
  defaults: DEFAULT_OPTS,
  options,
  begin,
  actors: actorsOf,
  apply,
  parse,
  free: (a) => a.t === 'claim' && !a.bot,
  pause: (s) => (s.phase === 'end' ? END_PAUSE_MS : null),
  resume: (s) => {
    const next = structuredClone(s);
    next.events = [];
    resumeMut(next);
    return next;
  },
  turnMs: (s) => (s.phase === 'swap' || s.phase === 'que' || s.phase === 'turn' || s.phase === 'claim' ? TURN_MS[s.phase] : TURN_MS.turn),
  view,
  timeout,
  auto,
  over: (s) => s.phase === 'over',
  breakPoint: (s) => s.phase === 'end' || s.phase === 'over',
  result,
  finish: (s) => {
    if (s.phase === 'over') return s;
    const next = structuredClone(s);
    next.phase = 'over';
    next.events = [{ e: 'over' }];
    return next;
  },
  seated: (s, seat, kind) => {
    const next = structuredClone(s);
    next.events = [];
    seatedMut(next, seat, kind);
    return next;
  },
  restake: (s, seat, chips) => {
    const next = structuredClone(s);
    next.events = [];
    restakeMut(next, seat, chips);
    return next;
  },
};
