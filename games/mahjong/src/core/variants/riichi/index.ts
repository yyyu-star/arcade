/**
 * 立直麻将：把规则（rules.ts）包成统一的玩法接口（../types.ts），加上视图、选项和动作的校验、超时代出、一场的结果和称号。
 * 还没登记进 ../index.ts 的玩法表：界面和单机做完以前房间、单机都开不出立直（docs/riichi.md 第 6 节）。
 */
import { MAX_TITLES, type Payment, type SettleStats } from '../../match/index.ts';
import { wallLeft, type ClaimKind, type Meld } from '../../table/index.ts';
import type { Tile } from '../../tiles/index.ts';
import { NEUTRAL_TUNE, type MatchResult, type Tune, type Variant, type VariantAi } from '../types.ts';
import {
  actorsOf,
  applyMut,
  begin,
  canKyuushu,
  canTsumo,
  DEFAULT_OPTS,
  discardOptions,
  doraIndicators,
  finishMatch,
  furiten,
  kanOptions,
  restakeMut,
  resumeMut,
  riichiOptions,
  RULES_VERSION,
  SEATS,
  seatedMut,
  seatWind,
  tenpaiKinds,
  TILESET,
  VARIANT,
  type Final,
  type Phase,
  type RcAction,
  type RcEvent,
  type RcOpts,
  type RcRiverTile,
  type RcState,
  type RoundSummary,
  type SeatStats,
} from './rules.ts';

export * from './rules.ts';
export * from './score.ts';

/** 好友房的时限 */
export const TURN_MS: Record<'turn' | 'claim', number> = { turn: 25_000, claim: 12_000 };
/** 一局结算停多久（役种表比川麻长，多停两秒） */
export const END_PAUSE_MS = 10_000;

/** 别人摸的牌视图里用这个数代替 */
export const HIDDEN = -1;

/** 我现在能做什么（界面的按钮、电脑的选择都从这里来） */
export interface Prompt {
  discard?: Tile[];
  /** 宣告立直时能打的牌（打了还听牌） */
  riichi?: Tile[];
  tsumo?: true;
  kan?: Tile[];
  kyuushu?: true;
  /** 声明窗口里我能做的（只给有选择、还没答的人）；chi 是几种吃法（顺子最小那张的牌种） */
  claim?: { w: number; opts: ClaimKind[]; chi: number[] };
}

export interface SeatView {
  kind: 'human' | 'ai';
  persona: number;
  chips: number;
  points: number;
  /** 自风 0–3（东南西北） */
  wind: number;
  riichi: 0 | 1 | 2;
  riichiAt: number;
  melds: Meld[];
  river: RcRiverTile[];
  count: number;
  /** 一局结束时和了、听牌的人亮出来的手牌 */
  hand: Tile[] | null;
  stats: SeatStats;
}

export interface RcView {
  variant: typeof VARIANT;
  v: number;
  phase: Phase;
  opts: RcOpts;
  share: number;
  base: number;
  wind: number;
  hand: number;
  honba: number;
  sticks: number;
  dealer: number;
  first: number;
  turn: number;
  wall: number;
  /** 翻开的宝牌指示牌 */
  dora: Tile[];
  seats: SeatView[];
  /** 自己的手牌、摸到的牌；听哪些牌、振听没有（只按自己的牌和河算）；tune 给电脑 */
  me: { seat: number; hand: Tile[]; drawn: Tile | null; waits: number[]; furiten: ReturnType<typeof furiten>; tune: Tune } | null;
  prompt: Prompt | null;
  claim: { id: number; tile: Tile; from: number; rob: boolean; answered: boolean } | null;
  events: RcEvent[];
  ledger: Payment[];
  history: RoundSummary[];
  final: Final | null;
  result: MatchResult | null;
}

const clone = <T>(x: T): T => structuredClone(x);

function prompt(s: RcState, seat: number): Prompt | null {
  if (s.phase === 'turn' && s.turn === seat) {
    const out: Prompt = { discard: discardOptions(s, seat) };
    const r = riichiOptions(s, seat);
    if (r.length) out.riichi = r;
    if (canTsumo(s, seat)) out.tsumo = true;
    const k = kanOptions(s, seat);
    if (k.length) out.kan = k;
    if (canKyuushu(s, seat)) out.kyuushu = true;
    return out;
  }
  if (s.phase === 'claim') {
    const c = s.claim!;
    const opts = c.opts[seat]!;
    if (opts.length && c.ans[seat] === null && !c.bot[seat]) return { claim: { w: c.id, opts, chi: c.chi[seat]!.slice() } };
  }
  return null;
}

export function view(s: RcState, seat: number | null): RcView {
  const last = s.phase === 'end' || s.phase === 'over' ? s.history[s.history.length - 1] : undefined;
  const shown = (i: number): boolean => !!last && (last.wins.some((w) => w.seat === i) || !!last.tenpai?.[i]);
  const seats: SeatView[] = s.players.map((p, i) => ({
    kind: s.kinds[i]!,
    persona: s.personas[i]!,
    chips: s.chips[i]!,
    points: s.points[i]!,
    wind: seatWind(s, i),
    riichi: p.riichi,
    riichiAt: p.riichiAt,
    melds: clone(p.melds),
    river: p.river.map((r) => ({ ...r })),
    count: p.hand.length,
    hand: i === seat || shown(i) ? p.hand.slice() : null,
    stats: { ...s.stats[i]! },
  }));
  const me =
    seat === null
      ? null
      : (() => {
          const p = s.players[seat]!;
          return {
            seat,
            hand: p.hand.slice(),
            drawn: s.turn === seat ? s.drawn : null,
            waits: p.hand.length % 3 === 1 ? tenpaiKinds(p) : [],
            furiten: p.hand.length % 3 === 1 ? furiten(p) : null,
            tune: { ...(s.tunes?.[seat] ?? NEUTRAL_TUNE) },
          };
        })();
  const events = s.events.map((e): RcEvent => (e.e === 'draw' && e.seat !== seat ? { ...e, tile: HIDDEN } : clone(e)));
  const c = s.claim;
  return {
    variant: VARIANT,
    v: s.v,
    phase: s.phase,
    opts: { ...s.opts },
    share: s.share,
    base: s.base,
    wind: s.wind,
    hand: s.hand,
    honba: s.honba,
    sticks: s.sticks,
    dealer: s.dealer,
    first: s.first,
    turn: s.turn,
    wall: wallLeft(s.wall),
    dora: doraIndicators(s),
    seats,
    me,
    prompt: seat === null ? null : prompt(s, seat),
    claim: c ? { id: c.id, tile: c.tile, from: c.from, rob: c.rob !== null, answered: seat !== null && (c.ans[seat] !== null || c.bot[seat]!) } : null,
    events,
    ledger: s.ledger.map((x) => ({ ...x })),
    history: clone(s.history),
    final: s.final ? clone(s.final) : null,
    result: s.phase === 'over' ? result(s) : null,
  };
}

// ---------- 称号和一场的结果 ----------

/** 称号从稀有到常见（一场最多报 5 个给平台） */
export const TITLE_ORDER = ['rc_yakuman', 'rc_top', 'rc_iron_wall'] as const;

export function titlesOf(s: RcState): string[][] {
  const top = s.final?.rank[0];
  return s.stats.map((st, i) => {
    const t = new Set<string>();
    if (st.yakuman) t.add('rc_yakuman');
    if (top === i) t.add('rc_top');
    if (st.dealIn === 0 && st.rounds >= 8) t.add('rc_iron_wall');
    return TITLE_ORDER.filter((x) => t.has(x));
  });
}

export function result(s: RcState): MatchResult {
  const titles = titlesOf(s);
  return {
    seats: s.chips.map((c, i) => {
      // 一场最多赢 3 份：超出的不进（归庄家），和川麻一样
      const chips = Math.min(c, s.stake[i]! + s.share * 3);
      const st = s.stats[i]!;
      const stats: SettleStats = {
        rounds: st.rounds,
        wins: st.wins,
        best: Math.max(0, chips - s.stake[i]!),
        ...(titles[i]!.length ? { titles: titles[i]!.slice(0, MAX_TITLES) } : {}),
        max: { rc_han: st.maxHan },
        sum: { rc_riichi: st.riichi, rc_tsumo: st.tsumo },
      };
      return { chips, net: chips - s.stake[i]!, stats };
    }),
  };
}

// ---------- 选项、动作的校验 ----------

export function options(raw: unknown): RcOpts | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTS };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = { ...DEFAULT_OPTS, ...(raw as Partial<RcOpts>) };
  if (o.length !== 'hanchan' && o.length !== 'tonpuu') return null;
  return { length: o.length };
}

const isTile = (x: unknown): x is Tile => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 136;
const isWin = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) < 1e9;
const isKind = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 27;

/** 只收真人能发的动作。expire 和带 bot 的回答只由服务端的 timeout、auto 造（理由同川麻） */
export function parse(raw: unknown): RcAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.t) {
    case 'discard':
      if (!isTile(a.tile) || (a.riichi !== undefined && a.riichi !== true)) return null;
      return a.riichi ? { t: 'discard', tile: a.tile, riichi: true } : { t: 'discard', tile: a.tile };
    case 'tsumo':
      return { t: 'tsumo' };
    case 'kyuushu':
      return { t: 'kyuushu' };
    case 'kan':
      return isTile(a.tile) ? { t: 'kan', tile: a.tile } : null;
    case 'claim': {
      if (!isWin(a.w) || !['ron', 'kan', 'pon', 'chi', 'pass'].includes(a.c as string) || a.bot !== undefined) return null;
      if (a.low !== undefined && (a.c !== 'chi' || !isKind(a.low))) return null;
      const out: RcAction = { t: 'claim', w: a.w, c: a.c as 'ron' | 'kan' | 'pon' | 'chi' | 'pass' };
      return a.low === undefined ? out : { ...out, low: a.low as number };
    }
    default:
      return null;
  }
}

export function apply(s: RcState, seat: number, a: RcAction): RcState | { error: string } {
  const next = structuredClone(s);
  next.events = [];
  const err = applyMut(next, seat, a);
  return err ? { error: err } : next;
}

/** 超时代出：能自摸就自摸，不然打摸到的那张（不能打就打最右边能打的）；声明窗口整个收掉 */
export function timeout(s: RcState, seat: number, ai: VariantAi<RcView, RcAction>): RcAction {
  if (s.phase === 'claim') return { t: 'expire', w: s.claim!.id };
  if (s.phase === 'turn' && s.turn === seat) {
    if (canTsumo(s, seat)) return { t: 'tsumo' };
    const opts = discardOptions(s, seat);
    const drawn = s.drawn;
    return { t: 'discard', tile: drawn !== null && opts.includes(drawn) ? drawn : opts[opts.length - 1]! };
  }
  return auto(s, seat, ai);
}

/** 电脑、托管：声明窗口里没选择的直接"过"，有选择的问电脑；回答都带 bot */
export function auto(s: RcState, seat: number, ai: VariantAi<RcView, RcAction>): RcAction {
  if (s.phase === 'claim') {
    const c = s.claim!;
    if (!c.opts[seat]!.length) return { t: 'claim', w: c.id, c: 'pass', bot: true };
    const a = ai.decide(view(s, seat));
    return a.t === 'claim' ? { ...a, bot: true } : { t: 'claim', w: c.id, c: 'pass', bot: true };
  }
  return ai.decide(view(s, seat));
}

/** 是不是赤宝牌（界面画红五用） */
export const isRed = (t: Tile): boolean => TILESET.red.includes(t);

export const riichi: Variant<RcState, RcAction, RcView, RcOpts> = {
  id: VARIANT,
  name: '立直麻将',
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
  turnMs: (s) => (s.phase === 'claim' ? TURN_MS.claim : TURN_MS.turn),
  view,
  timeout,
  auto,
  over: (s) => s.phase === 'over',
  breakPoint: (s) => s.phase === 'end' || s.phase === 'over',
  result,
  finish: (s) => {
    if (s.phase === 'over') return s;
    const next = structuredClone(s);
    next.events = [];
    next.claim = null;
    finishMatch(next);
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
