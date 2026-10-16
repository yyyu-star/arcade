/**
 * 川麻·血战到底的规则（DESIGN.md 第 2 节）：状态、动作、每一步怎么走。纯函数，浏览器（单机）和房间（好友房）共用。
 *
 * 一局的流程：发牌 →（换三张）→ 定缺 → 庄家先打 → 摸打、碰杠胡 → 三家胡了或牌墙摸完 → 结算（流局查花猪、查大叫、退税）。
 * 一场：固定局数，或者有人筹码打光、赢满 3 份，这一局打完散场。
 *
 * 声明窗口（别人打出一张、或补杠可以被抢）的公平做法见 DESIGN.md 第 6 节：
 * 名单一律是所有还没胡的别家，真人的回答是 kit 的不轮流操作（free），电脑和托管的回答带 bot 标记、答完离开名单；
 * 有选择的人都答完就裁决，没选择的人当"过"。
 *
 * 所有改动都在 applyMut 里原地做（模拟器直接用它，省掉每步复制）；对外的 apply 先复制一份再改。
 */
import type { Entropy } from 'arcade-kit/rng';
import { stream } from 'arcade-kit/rng';
import { isComplete, waits, type ShapeRules } from '../../hand/index.ts';
import { payMany, payOne, type Payment } from '../../match/index.ts';
import { distance, drawHead, drawTail, newWall, nextSeat, resolveClaims, wallLeft, type Answer, type ClaimKind, type KanType, type Meld, type RiverTile, type Wall } from '../../table/index.ts';
import { buildWall, byTile, countsOf, kindOf, suitKinds, suitOf, type Suit, type Tile, type TileSet } from '../../tiles/index.ts';
import type { MatchSetup, SeatKind, Tune } from '../types.ts';
import { NO_CONTEXT, scoreHand, unitOf, type FanItem, type WinContext } from './fan.ts';

export const VARIANT = 'sichuan-xuezhan' as const;
export const RULES_VERSION = 1;
export const SEATS = 4;
export const TILESET: TileSet = { suits: [0, 1, 2], honors: false, flowers: false, red: [] };
export const SHAPE: ShapeRules = { seven: true, sevenQuads: true, kokushi: false };
/** 能和的牌种：只有数牌 */
export const SUITED_KINDS: readonly number[] = Array.from({ length: 27 }, (_, i) => i);

/** 房间选项（开房就定，进房的人都看得到） */
export interface XzOpts {
  /** 一场几局 */
  rounds: 4 | 8 | 16;
  /** 封顶几番 */
  cap: 3 | 4 | 5;
  /** 换三张 */
  swap: boolean;
  /** 自摸加底（di）还是加番（fan） */
  zimo: 'di' | 'fan';
  /** 呼叫转移 */
  transfer: boolean;
}

export const DEFAULT_OPTS: XzOpts = { rounds: 8, cap: 4, swap: true, zimo: 'di', transfer: true };

/** 刮风下雨每家付几倍底分（DESIGN.md 2.5） */
export const KAN_PAY: Record<KanType, number> = { direct: 2, added: 1, concealed: 2 };

export type Phase = 'swap' | 'que' | 'turn' | 'claim' | 'end' | 'over';

/** 一次胡 */
export interface Win {
  /** 这一局第几个胡（1–3） */
  order: number;
  tile: Tile;
  /** 点炮的人；自摸是 null */
  from: number | null;
  fan: number;
  items: FanItem[];
  capped: boolean;
  /** 胡的时候手里的牌（公开） */
  hand: Tile[];
}

export interface XzPlayer {
  hand: Tile[];
  melds: Meld[];
  river: RiverTile[];
  que: Suit | -1;
  /** 换三张：选出去的、换进来的（只有自己看得到） */
  swapOut: Tile[] | null;
  swapIn: Tile[] | null;
  won: Win | null;
  /** 这一局摸了几次牌（地胡） */
  draws: number;
}

/** 一个座位这一场的统计（都是公开的事，结算页和称号用） */
export interface SeatStats {
  rounds: number;
  wins: number;
  zimo: number;
  pao: number;
  gangs: number;
  maxFan: number;
  /** 最大一局净赢 */
  best: number;
  /** 拿到的称号 id（不含要比较全场的那几个，见 titles.ts） */
  flags: string[];
}

/** 一局的小结（结算页的历史） */
export interface RoundSummary {
  round: number;
  dealer: number;
  net: number[];
  wins: { seat: number; from: number | null; fan: number; items: FanItem[] }[];
  /** 流局（牌墙摸完）还是三家胡了 */
  end: 'wall' | 'three';
}

/** 声明窗口：opts 是每个座位能做的（隐藏），ans 是回答，bot 是电脑、托管代答的（这些座位离开名单） */
export interface Claim {
  id: number;
  tile: Tile;
  from: number;
  /** 是补杠被抢（只能胡） */
  rob: boolean;
  /** 打牌的人是杠后补牌打出的：杠上炮，ref 是那一杠（呼叫转移找回去） */
  kanRef: number | null;
  haidi: boolean;
  opts: ClaimKind[][];
  ans: (Answer | null)[];
  bot: boolean[];
}

/** 这一步发生了什么（画面的动作字、音效、动画都从这里来）；摸到的牌、暗杠的牌只有本人看得到（view 里过滤） */
export type XzEvent =
  | { e: 'deal'; round: number; dealer: number }
  | { e: 'swapped'; dir: number }
  | { e: 'que' }
  | { e: 'draw'; seat: number; tile: Tile; tail: boolean }
  | { e: 'discard'; seat: number; tile: Tile }
  | { e: 'pon'; seat: number; from: number; tile: Tile }
  | { e: 'kan'; seat: number; from: number | null; tile: Tile; kan: KanType }
  | { e: 'hu'; seat: number; from: number | null; tile: Tile; fan: number; items: FanItem[]; rob: boolean }
  | { e: 'pay'; pays: Payment[] }
  | { e: 'end'; end: 'wall' | 'three' }
  | { e: 'over' };

export interface XzState {
  variant: typeof VARIANT;
  v: number;
  /** 随机数密钥：只在状态里，view 绝不带 */
  key: Entropy;
  opts: XzOpts;
  share: number;
  base: number;
  kinds: SeatKind[];
  personas: number[];
  /** 每个座位当电脑时这一场的状态（部署前存下的没有，按不浮动算） */
  tunes?: Tune[];
  round: number;
  dealer: number;
  chips: number[];
  /** 每个座位带进来的（净输赢、"一场最多赢 3 份"按它算；好友房有人接管座位时重新记） */
  stake: number[];
  /** 这一局开始时的筹码（算一局的净输赢） */
  start: number[];
  phase: Phase;
  wall: Wall;
  players: XzPlayer[];
  turn: number;
  /** 这一手摸到的牌（自摸、杠上花） */
  drawn: Tile | null;
  /** 这一手是摸牌开始的（能自摸）；碰了以后只能打 */
  canZimo: boolean;
  /** 这一手的牌是杠后补的：那一杠的编号 */
  afterKan: number | null;
  claim: Claim | null;
  claimSeq: number;
  kanSeq: number;
  swapDir: number | null;
  /** 这一局还没人碰杠（地胡） */
  noCalls: boolean;
  /** 这一局打出了几张 */
  discards: number;
  winners: number;
  /** 这一局第一个胡的人；第一个胡是一炮多响时记点炮的人（下一局的庄） */
  nextDealer: number | null;
  ledger: Payment[];
  /**
   * 每个座位这一局从 ledger 第几笔起算是"现在坐着的人"的（好友房中途换人、带入到账时记；没有这个字段按 0）。
   * 退税只追到两头都还是同一个人的那几笔杠钱：换人前收的不让新人退，换人前付的也不退给新人（自审 C5）
   */
  since?: number[];
  events: XzEvent[];
  history: RoundSummary[];
  stats: SeatStats[];
}

export type XzAction =
  | { t: 'swap'; tiles: Tile[] }
  | { t: 'que'; suit: Suit }
  | { t: 'discard'; tile: Tile }
  | { t: 'zimo' }
  | { t: 'kan'; tile: Tile }
  | { t: 'claim'; w: number; c: Answer; bot?: boolean }
  | { t: 'expire'; w: number };

// ---------- 小工具 ----------

const sortHand = (p: XzPlayer): void => {
  p.hand.sort(byTile);
};
const queKinds = (q: Suit | -1): number[] => (q === -1 ? [] : suitKinds(q));
export const hasQue = (p: XzPlayer): boolean => p.que >= 0 && p.hand.some((t) => suitOf(kindOf(t)) === p.que);
const countKind = (tiles: readonly Tile[], k: number): number => tiles.reduce((a, t) => a + (kindOf(t) === k ? 1 : 0), 0);
const unfinished = (s: XzState): number[] => s.players.map((_, i) => i).filter((i) => !s.players[i]!.won);

/** 14 张能不能和（手里不能有缺门） */
function canWin(p: XzPlayer, hand: Tile[]): boolean {
  if (p.que >= 0 && hand.some((t) => suitOf(kindOf(t)) === p.que)) return false;
  return isComplete(countsOf(hand), p.melds.length, SHAPE);
}

/**
 * 听哪些牌（手里有缺门就是没听）。四张都在自己手里和自己碰杠里的那种不算：摸不到、也没人打得出来，胡不了的叫不算叫（0.3.9）
 */
export function tenpaiKinds(p: XzPlayer): number[] {
  if (hasQue(p)) return [];
  const own = countsOf([...p.hand, ...p.melds.flatMap((m) => m.tiles)]);
  const allowed = SUITED_KINDS.filter((k) => suitOf(k) !== p.que && own[k]! < 4);
  return waits(countsOf(p.hand), p.melds.length, SHAPE, allowed);
}

function emptyStats(): SeatStats {
  return { rounds: 0, wins: 0, zimo: 0, pao: 0, gangs: 0, maxFan: 0, best: 0, flags: [] };
}

function flag(st: SeatStats, id: string): void {
  if (!st.flags.includes(id)) st.flags.push(id);
}

function pay(s: XzState, pays: Payment[]): void {
  if (!pays.length) return;
  s.ledger.push(...pays);
  s.events.push({ e: 'pay', pays });
}

// ---------- 一场、一局 ----------

export function begin(key: Entropy, opts: XzOpts, kinds: readonly SeatKind[], setup: MatchSetup): XzState {
  const s: XzState = {
    variant: VARIANT,
    v: RULES_VERSION,
    key: [...key],
    opts: { ...opts },
    share: setup.share,
    base: setup.base,
    kinds: [...kinds],
    personas: [...setup.personas],
    ...(setup.tunes ? { tunes: setup.tunes.map((t) => ({ ...t })) } : {}),
    round: 0,
    dealer: stream(key, 'seat', 0).below(SEATS),
    chips: setup.chips ? [...setup.chips] : Array.from({ length: SEATS }, () => setup.share),
    stake: setup.chips ? [...setup.chips] : Array.from({ length: SEATS }, () => setup.share),
    start: [],
    phase: 'swap',
    wall: newWall([], 0),
    players: [],
    turn: 0,
    drawn: null,
    canZimo: false,
    afterKan: null,
    claim: null,
    claimSeq: 0,
    kanSeq: 0,
    swapDir: null,
    noCalls: true,
    discards: 0,
    winners: 0,
    nextDealer: null,
    ledger: [],
    events: [],
    history: [],
    stats: Array.from({ length: SEATS }, emptyStats),
  };
  startRound(s);
  return s;
}

function startRound(s: XzState): void {
  const tiles = buildWall(TILESET, stream(s.key, 'deal', s.round));
  s.players = Array.from({ length: SEATS }, () => ({ hand: [], melds: [], river: [], que: -1 as const, swapOut: null, swapIn: null, won: null, draws: 0 }));
  let at = 0;
  for (let i = 0; i < SEATS; i++) {
    const p = s.players[(s.dealer + i) % SEATS]!;
    p.hand = tiles.slice(at, at + 13);
    at += 13;
  }
  s.players[s.dealer]!.hand.push(tiles[at++]!);
  for (const p of s.players) sortHand(p);
  s.wall = newWall(tiles, at);
  s.start = s.chips.slice();
  s.turn = s.dealer;
  s.drawn = null;
  s.canZimo = true;
  s.afterKan = null;
  s.claim = null;
  s.swapDir = null;
  s.noCalls = true;
  s.discards = 0;
  s.winners = 0;
  s.nextDealer = null;
  s.ledger = [];
  delete s.since;
  s.phase = s.opts.swap ? 'swap' : 'que';
  for (const st of s.stats) st.rounds++;
  s.events.push({ e: 'deal', round: s.round, dealer: s.dealer });
}

/** 换三张：四家都选好后，按随机方向一起换（0 给下家、1 给对家、2 给上家） */
function finishSwap(s: XzState): void {
  const dir = stream(s.key, 'swap', s.round).below(3);
  s.swapDir = dir;
  const give = dir + 1;
  for (let i = 0; i < SEATS; i++) {
    const p = s.players[i]!;
    const to = s.players[(i + give) % SEATS]!;
    to.swapIn = p.swapOut!.slice();
  }
  for (const p of s.players) {
    p.hand = p.hand.filter((t) => !p.swapOut!.includes(t)).concat(p.swapIn!);
    sortHand(p);
  }
  s.phase = 'que';
  s.events.push({ e: 'swapped', dir });
}

/** 摸牌：牌墙空了这一局结束 */
function drawFor(s: XzState, seat: number, tail: boolean): void {
  const t = tail ? drawTail(s.wall) : drawHead(s.wall);
  if (t === null) return endRound(s, 'wall');
  const p = s.players[seat]!;
  p.hand.push(t);
  sortHand(p);
  p.draws++;
  s.turn = seat;
  s.drawn = t;
  s.canZimo = true;
  s.phase = 'turn';
  s.events.push({ e: 'draw', seat, tile: t, tail });
}

/** 轮到 from 之后下一个还没胡的人摸牌 */
function advance(s: XzState, from: number): void {
  const next = nextSeat(from, SEATS, (i) => !s.players[i]!.won);
  if (next === null || wallLeft(s.wall) <= 0) return endRound(s, 'wall');
  s.afterKan = null;
  drawFor(s, next, false);
}

/** 有人胡了：记下来、收钱。ron 时 from 是点炮的人；自摸时 from 是 null，每个还没胡的别家付 */
/** 点炮的胡：先记下要收多少（一炮多响时几家一起按比例付，见下面），自摸当场付 */
function recordWin(s: XzState, seat: number, tile: Tile, from: number | null, ctx: WinContext, dues?: { to: number; amount: number }[]): void {
  const p = s.players[seat]!;
  const hand = from === null ? p.hand.slice() : [...p.hand, tile].sort(byTile);
  const r = scoreHand(countsOf(hand), p.melds, ctx, s.opts.cap);
  const unit = unitOf(s.base, r.fan);
  s.winners++;
  p.won = { order: s.winners, tile, from, fan: r.fan, items: r.items, capped: r.capped, hand };
  p.hand = hand;
  if (from === null) {
    const extra = s.opts.zimo === 'di' ? s.base : 0;
    const pays: Payment[] = [];
    for (const i of unfinished(s)) if (i !== seat) pays.push(...payOne(s.chips, i, seat, unit + extra, 'zimo'));
    pay(s, pays);
  } else {
    if (dues) dues.push({ to: seat, amount: unit });
    else pay(s, payOne(s.chips, from, seat, unit, 'hu'));
    s.stats[from]!.pao++;
  }
  const st = s.stats[seat]!;
  st.wins++;
  if (from === null) st.zimo++;
  st.maxFan = Math.max(st.maxFan, r.fan);
  for (const it of r.items) {
    const id = TITLE_OF_FAN[it.id];
    if (id) flag(st, id);
  }
  if (r.capped) flag(st, 'xz_capped');
  if (s.winners === 3) flag(st, 'xz_last_stand');
  s.events.push({ e: 'hu', seat, from, tile, fan: r.fan, items: r.items, rob: ctx.rob });
}

const TITLE_OF_FAN: Partial<Record<FanItem['id'], string>> = {
  qing: 'xz_qing',
  longqidui: 'xz_dragon',
  qidui: 'xz_seven',
  jingou: 'xz_golden_hook',
  gangkai: 'xz_gang_flower',
  qianggang: 'xz_rob_gang',
  haidi: 'xz_sea_moon',
  tianhu: 'xz_heaven',
  dihu: 'xz_earth',
};

/** 收杠钱（刮风下雨）：直杠点杠的人付，补杠、暗杠每个还没胡的别家付 */
function kanPay(s: XzState, seat: number, kan: KanType, from: number | null): number {
  const ref = ++s.kanSeq;
  const amount = KAN_PAY[kan] * s.base;
  const pays: Payment[] = [];
  if (kan === 'direct') pays.push(...payOne(s.chips, from!, seat, amount, 'kan', ref));
  else for (const i of unfinished(s)) if (i !== seat) pays.push(...payOne(s.chips, i, seat, amount, 'kan', ref));
  pay(s, pays);
  s.stats[seat]!.gangs++;
  s.noCalls = false;
  return ref;
}

/** 别人打出（或补杠）一张以后谁能做什么；只要有人有选择就开窗口，返回开没开 */
function openClaim(s: XzState, tile: Tile, from: number, rob: boolean, kanRef: number | null): boolean {
  const k = kindOf(tile);
  const opts: ClaimKind[][] = s.players.map(() => []);
  let any = false;
  for (let i = 0; i < SEATS; i++) {
    const p = s.players[i]!;
    if (i === from || p.won || suitOf(k) === p.que) continue;
    const o = opts[i]!;
    if (!hasQue(p) && canWin(p, [...p.hand, tile])) o.push('ron');
    if (!rob && wallLeft(s.wall) > 0) {
      const n = countKind(p.hand, k);
      if (n >= 3) o.push('kan');
      if (n >= 2) o.push('pon');
    }
    if (o.length) any = true;
  }
  if (!any) return false;
  s.claim = {
    id: ++s.claimSeq,
    tile,
    from,
    rob,
    kanRef,
    haidi: wallLeft(s.wall) === 0,
    opts,
    ans: s.players.map(() => null),
    bot: s.players.map(() => false),
  };
  s.phase = 'claim';
  return true;
}

/** 有选择的人都答完了（或者到点了）：胡 > 杠 / 碰，一炮多响 */
function resolve(s: XzState): void {
  const c = s.claim!;
  s.claim = null;
  const ans = c.ans.map((a, i) => (c.opts[i]!.length ? (a ?? 'pass') : null));
  const r = resolveClaims(ans, c.from, true);
  const thrower = s.players[c.from]!;
  if (r && 'ron' in r) {
    if (s.winners === 0 && r.ron.length > 1) s.nextDealer = c.from;
    else if (s.winners === 0) s.nextDealer = r.ron[0]!;
    if (c.rob) thrower.hand.splice(thrower.hand.indexOf(c.tile), 1);
    else thrower.river[thrower.river.length - 1]!.taken = true;
    // 一炮多响：几家的胡一起付，点炮的付不起时按应收的比例分（2.8，自审 C6；原来先胡的先拿）
    const dues: { to: number; amount: number }[] = [];
    for (const seat of r.ron) {
      recordWin(s, seat, c.tile, c.from, { ...NO_CONTEXT, gangPao: c.kanRef !== null, rob: c.rob, haidi: c.haidi }, dues);
    }
    pay(s, payMany(s.chips, c.from, dues, 'hu'));
    // 呼叫转移：那一杠收到的钱转给胡的人（平分，零头给离点炮者最近的）
    if (c.kanRef !== null && s.opts.transfer) {
      const got = s.ledger.filter((x) => x.kind === 'kan' && x.ref === c.kanRef && x.to === c.from).reduce((a, x) => a + x.amount, 0);
      if (got > 0) {
        const each = Math.floor(got / r.ron.length);
        const dues = r.ron.map((to, i) => ({ to, amount: each + (i === 0 ? got - each * r.ron.length : 0) }));
        pay(s, payMany(s.chips, c.from, dues, 'move', c.kanRef));
      }
    }
    if (s.winners >= 3) return endRound(s, 'three');
    const last = r.ron.reduce((a, b) => (distance(c.from, b, SEATS) > distance(c.from, a, SEATS) ? b : a));
    return advance(s, last);
  }
  if (r) {
    const p = s.players[r.seat]!;
    const k = kindOf(c.tile);
    const mine = p.hand.filter((t) => kindOf(t) === k).slice(0, r.kind === 'kan' ? 3 : 2);
    p.hand = p.hand.filter((t) => !mine.includes(t));
    thrower.river[thrower.river.length - 1]!.taken = true;
    const tiles = [...mine, c.tile].sort(byTile);
    s.turn = r.seat;
    s.afterKan = null;
    if (r.kind === 'kan') {
      p.melds.push({ kind: 'kan', tiles, from: c.from, kan: 'direct' });
      s.events.push({ e: 'kan', seat: r.seat, from: c.from, tile: c.tile, kan: 'direct' });
      const ref = kanPay(s, r.seat, 'direct', c.from);
      drawFor(s, r.seat, true);
      if (s.phase === 'turn') s.afterKan = ref;
      return;
    }
    p.melds.push({ kind: 'pon', tiles, from: c.from });
    s.noCalls = false;
    s.drawn = null;
    s.canZimo = false;
    s.phase = 'turn';
    s.events.push({ e: 'pon', seat: r.seat, from: c.from, tile: c.tile });
    return;
  }
  // 没人要
  if (c.rob) return finishAddedKan(s, c.from, c.tile);
  advance(s, c.from);
}

function finishAddedKan(s: XzState, seat: number, tile: Tile): void {
  const p = s.players[seat]!;
  const k = kindOf(tile);
  p.hand.splice(p.hand.indexOf(tile), 1);
  const m = p.melds.find((x) => x.kind === 'pon' && kindOf(x.tiles[0]!) === k)!;
  m.kind = 'kan';
  m.kan = 'added';
  m.tiles = [...m.tiles, tile].sort(byTile);
  s.events.push({ e: 'kan', seat, from: m.from, tile, kan: 'added' });
  const ref = kanPay(s, seat, 'added', null);
  drawFor(s, seat, true);
  if (s.phase === 'turn') s.afterKan = ref;
}

/** 一局结束：流局时退税、查花猪、查大叫；记小结，换庄，看一场打没打完 */
function endRound(s: XzState, end: 'wall' | 'three'): void {
  s.claim = null;
  s.drawn = null;
  if (end === 'wall') {
    const left = unfinished(s);
    const pig = new Map<number, boolean>();
    const ting = new Map<number, number>();
    for (const i of left) {
      const p = s.players[i]!;
      pig.set(i, hasQue(p));
      const ks = tenpaiKinds(p);
      if (ks.length) {
        let best = 0;
        for (const k of ks) {
          const hand = countsOf(p.hand);
          hand[k]!++;
          best = Math.max(best, scoreHand(hand, p.melds, NO_CONTEXT, s.opts.cap).fan);
        }
        ting.set(i, best);
      }
    }
    // 退税：没听牌的人（含花猪）这一局收的杠钱退回去。杠上炮已经呼叫转移给胡的人的那部分不再退（不然赔两遍）：
    // 同一杠转走的数从先收的那几笔里扣
    for (const i of left) {
      if (ting.has(i)) continue;
      const moved = new Map<number, number>();
      for (const x of s.ledger) if (x.kind === 'move' && x.from === i && x.ref !== undefined) moved.set(x.ref, (moved.get(x.ref) ?? 0) + x.amount);
      const since = s.since ?? [0, 0, 0, 0];
      const mine = (y: Payment, n: number): boolean => n >= since[y.to]! && n >= since[y.from]!;
      for (const x of s.ledger.filter((y, n) => y.kind === 'kan' && y.to === i && mine(y, n))) {
        const gone = Math.min(x.amount, moved.get(x.ref!) ?? 0);
        if (gone) moved.set(x.ref!, moved.get(x.ref!)! - gone);
        if (x.amount > gone) pay(s, payOne(s.chips, i, x.from, x.amount - gone, 'tax', x.ref));
      }
    }
    // 查花猪：赔给每个还没胡、不是花猪的人封顶的数
    const capUnit = unitOf(s.base, s.opts.cap);
    for (const i of left) {
      if (!pig.get(i)) continue;
      const dues = left.filter((j) => j !== i && !pig.get(j)).map((to) => ({ to, amount: capUnit }));
      if (dues.length) pay(s, payMany(s.chips, i, dues, 'pig'));
    }
    // 查大叫：没听牌的（不是花猪）赔给每个听牌的，按他能胡的最大番
    for (const i of left) {
      if (pig.get(i) || ting.has(i)) continue;
      const dues = left.filter((j) => ting.has(j)).map((to) => ({ to, amount: unitOf(s.base, ting.get(to)!) }));
      if (dues.length) pay(s, payMany(s.chips, i, dues, 'cha'));
    }
  }
  const net = s.chips.map((c, i) => c - s.start[i]!);
  net.forEach((n, i) => {
    const st = s.stats[i]!;
    st.best = Math.max(st.best, n);
  });
  const wins = s.players
    .map((p, seat) => ({ p, seat }))
    .filter((x) => x.p.won)
    .sort((a, b) => a.p.won!.order - b.p.won!.order)
    .map(({ p, seat }) => ({ seat, from: p.won!.from, fan: p.won!.fan, items: p.won!.items }));
  s.history.push({ round: s.round, dealer: s.dealer, net, wins, end });
  s.events.push({ e: 'end', end });
  if (s.nextDealer !== null) s.dealer = s.nextDealer;
  s.round++;
  const over = s.round >= s.opts.rounds || s.chips.some((c) => c <= 0) || s.chips.some((c, i) => c >= s.stake[i]! + s.share * 3);
  s.phase = over ? 'over' : 'end';
  if (over) s.events.push({ e: 'over' });
}

// ---------- 动作 ----------

/** 自己这一手能杠的牌：暗杠（手里四张）、补杠（碰过、手里有第四张）；缺门不能杠，牌墙空了不能杠 */
export function kanOptions(s: XzState, seat: number): Tile[] {
  const p = s.players[seat]!;
  if (wallLeft(s.wall) <= 0) return [];
  const out: Tile[] = [];
  const c = countsOf(p.hand);
  for (let k = 0; k < 27; k++) {
    if (suitOf(k) === p.que) continue;
    if (c[k] === 4) out.push(p.hand.find((t) => kindOf(t) === k)!);
    else if (c[k]! >= 1 && p.melds.some((m) => m.kind === 'pon' && kindOf(m.tiles[0]!) === k)) out.push(p.hand.find((t) => kindOf(t) === k)!);
  }
  return out;
}

/** 能打哪些牌：有缺先打缺 */
export function discardOptions(p: XzPlayer): Tile[] {
  const que = p.hand.filter((t) => suitOf(kindOf(t)) === p.que);
  return que.length ? que : p.hand.slice();
}

export function canZimo(s: XzState, seat: number): boolean {
  const p = s.players[seat]!;
  return s.phase === 'turn' && s.turn === seat && s.canZimo && canWin(p, p.hand);
}

/**
 * 做一步（原地改）。返回 null 是成功，字符串是错误码（固定的短码，不带牌面）。
 * 调用前 events 由调用方清空：这一步发生的事都记在里面。
 */
export function applyMut(s: XzState, seat: number, a: XzAction): string | null {
  if (seat < 0 || seat >= SEATS || !Number.isInteger(seat)) return 'bad_seat';
  const p = s.players[seat]!;
  switch (a.t) {
    case 'swap': {
      if (s.phase !== 'swap') return 'not_now';
      if (p.swapOut) return 'already';
      if (a.tiles.length !== 3 || new Set(a.tiles).size !== 3 || !a.tiles.every((t) => p.hand.includes(t))) return 'bad_tiles';
      const suit = suitOf(kindOf(a.tiles[0]!));
      if (!a.tiles.every((t) => suitOf(kindOf(t)) === suit)) return 'same_suit';
      p.swapOut = a.tiles.slice().sort(byTile);
      if (s.players.every((x) => x.swapOut)) finishSwap(s);
      return null;
    }
    case 'que': {
      if (s.phase !== 'que') return 'not_now';
      if (p.que >= 0) return 'already';
      if (a.suit !== 0 && a.suit !== 1 && a.suit !== 2) return 'bad_suit';
      p.que = a.suit;
      if (s.players.every((x) => x.que >= 0)) {
        s.phase = 'turn';
        s.turn = s.dealer;
        s.canZimo = true;
        s.events.push({ e: 'que' });
      }
      return null;
    }
    case 'discard': {
      if (s.phase !== 'turn' || s.turn !== seat) return 'not_your_turn';
      if (!p.hand.includes(a.tile)) return 'bad_tile';
      if (!discardOptions(p).includes(a.tile)) return 'que_first';
      p.hand.splice(p.hand.indexOf(a.tile), 1);
      p.river.push({ tile: a.tile });
      s.discards++;
      s.drawn = null;
      s.canZimo = false;
      const kanRef = s.afterKan;
      s.afterKan = null;
      s.events.push({ e: 'discard', seat, tile: a.tile });
      if (!openClaim(s, a.tile, seat, false, kanRef)) advance(s, seat);
      return null;
    }
    case 'zimo': {
      if (!canZimo(s, seat)) return 'cannot_win';
      const tian = seat === s.dealer && s.discards === 0 && p.draws === 0;
      // 天胡没有摸的那张：记庄家起手的第 14 张（发牌时最后发给他的，牌墙第 53 张）；换三张换走了就记手里最后一张
      const first = s.wall.tiles[SEATS * 13]!;
      const tile = s.drawn ?? (tian && p.hand.includes(first) ? first : p.hand[p.hand.length - 1]!);
      const di = seat !== s.dealer && p.draws === 1 && p.river.length === 0 && s.noCalls;
      if (s.winners === 0) s.nextDealer = seat;
      recordWin(s, seat, tile, null, {
        ...NO_CONTEXT,
        zimo: true,
        gangKai: s.afterKan !== null,
        haidi: wallLeft(s.wall) === 0,
        tian,
        di,
        zimoFan: s.opts.zimo === 'fan',
      });
      s.drawn = null;
      s.afterKan = null;
      if (s.winners >= 3) {
        endRound(s, 'three');
        return null;
      }
      advance(s, seat);
      return null;
    }
    case 'kan': {
      if (s.phase !== 'turn' || s.turn !== seat) return 'not_your_turn';
      if (!kanOptions(s, seat).includes(a.tile)) return 'cannot_kan';
      const k = kindOf(a.tile);
      if (countKind(p.hand, k) === 4) {
        const tiles = p.hand.filter((t) => kindOf(t) === k);
        p.hand = p.hand.filter((t) => kindOf(t) !== k);
        p.melds.push({ kind: 'kan', tiles, from: null, kan: 'concealed' });
        s.events.push({ e: 'kan', seat, from: null, tile: a.tile, kan: 'concealed' });
        const ref = kanPay(s, seat, 'concealed', null);
        drawFor(s, seat, true);
        if (s.phase === 'turn') s.afterKan = ref;
        return null;
      }
      // 补杠：先看有没有人抢杠
      s.drawn = null;
      if (!openClaim(s, a.tile, seat, true, null)) finishAddedKan(s, seat, a.tile);
      return null;
    }
    case 'claim': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c || c.id !== a.w) return 'stale_claim';
      if (seat === c.from || p.won) return 'not_your_turn';
      if (c.ans[seat] !== null || c.bot[seat]) return 'already';
      const opts = c.opts[seat]!;
      if (!opts.length && !(a.bot && a.c === 'pass')) return 'no_claim';
      if (a.c !== 'pass' && !opts.includes(a.c)) return 'cannot_claim';
      c.ans[seat] = a.c;
      if (a.bot) c.bot[seat] = true;
      if (c.opts.every((o, i) => !o.length || c.ans[i] !== null)) resolve(s);
      return null;
    }
    case 'expire': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c || c.id !== a.w) return 'stale_claim';
      if (seat === c.from || p.won) return 'not_your_turn';
      // 到点：还没答的人能胡就胡，否则过
      c.opts.forEach((o, i) => {
        if (o.length && c.ans[i] === null) c.ans[i] = o.includes('ron') ? 'ron' : 'pass';
      });
      resolve(s);
      return null;
    }
  }
}

export function resumeMut(s: XzState): void {
  if (s.phase !== 'end') return;
  startRound(s);
}

/** 这一刻谁能出手（声明窗口的名单见文件头） */
export function actorsOf(s: XzState): { seats: number[]; group: string } | null {
  const all = s.players.map((_, i) => i);
  switch (s.phase) {
    case 'swap':
      return { seats: all.filter((i) => !s.players[i]!.swapOut), group: `swap-${s.round}` };
    case 'que':
      return { seats: all.filter((i) => s.players[i]!.que < 0), group: `que-${s.round}` };
    case 'turn':
      return { seats: [s.turn], group: `turn-${s.round}` };
    case 'claim': {
      const c = s.claim!;
      return { seats: all.filter((i) => i !== c.from && !s.players[i]!.won && !c.bot[i]), group: `claim-${c.id}` };
    }
    default:
      return null;
  }
}

/** 好友房有人接管座位、带入到账：这个座位的筹码和"带进来的"重新记 */
export function restakeMut(s: XzState, seat: number, chips: number): void {
  // 从这一笔起这个座位的杠钱才算新人的（退税不追到他头上，见 since）
  s.since = (s.since ?? [0, 0, 0, 0]).map((x, i) => (i === seat ? s.ledger.length : x));
  s.chips[seat] = chips;
  s.stake[seat] = chips;
  s.start[seat] = chips;
}

/** 好友房里座位换了人：只换"是谁"，统计从头算（离座的人已经带着他的小结结算走了） */
export function seatedMut(s: XzState, seat: number, kind: SeatKind): void {
  if (s.kinds[seat] === kind) return;
  s.kinds[seat] = kind;
  s.stats[seat] = { ...emptyStats(), rounds: s.phase === 'end' || s.phase === 'over' ? 0 : 1 };
}
