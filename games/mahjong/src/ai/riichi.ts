/**
 * 立直麻将的电脑（docs/riichi.md 第 3 节）。和川麻的电脑（xuezhan.ts）同一套公平规矩：只拿视图，看到的只有自己的牌、
 * 所有人的弃牌和明的副露、宝牌指示牌；没有随机数，"偶尔打错"由局面和这一场的状态（Tune.mood）算出来的数决定。
 *
 * 打牌分三层：
 * 1. 进攻：向听数（一般型、七对、国士取最小）优先，同向听比有效牌张数（减去看得见的），听牌时再按"等的牌值多少点"加权；
 *    宝牌、赤宝牌少打，孤立的字牌先打（客风先于役牌）；
 * 2. 役：副露的手必须有役可和——吃碰前看有没有路线（役牌、断幺九、混清、对对和、一气通贯），听牌了就逐张等的牌真算一遍有没有役；
 *    门清的手没役也行（立直、自摸）；
 * 3. 防守：有人立直，或者有人副露两组以上而且显眼，每张牌按危险度打分（现物、筋、壁、看得见的字牌低；宝牌、生张中张高），
 *    危险度乘上"我离和有多远"决定的权重——听牌的手往前顶，一向听看牌顶，两向听以上全弃和。
 * 性格只换日麻自己的几个参数（鸣牌、默听、弃和、爱杠，见 RC_TRAITS），状态浮动、场地的手软手紧、局面调整都复用川麻的 moodStyle。
 */
import { shanten, ukeire, type Counts } from '../core/hand/index.ts';
import { countsOf, HONOR0, kindOf, rankOf, tileOf, type Tile } from '../core/tiles/index.ts';
import type { Meld } from '../core/table/index.ts';
import { ALL_KINDS, doraOf, RED, scoreWin, SHAPE, waitsOf, type RcAction, type RcView, type WinContext } from '../core/variants/riichi/index.ts';
import type { VariantAi } from '../core/variants/types.ts';
import { PERSONAS, type Persona } from './personas.ts';
import { moodStyle, type Style } from './style.ts';

// ---------- 性格 ----------

/**
 * 日麻要的几个性格参数（0–1000），按 PERSONAS 的编号排。借 moodStyle 的槽位叠状态浮动和手软手紧，所以换成 Persona 的同名字段再传进去：
 * call→pon、dama→greed、fold→defense、kan→kanLove。
 * 手软的场地会把 greed（这里是默听倾向）压低：新手逢听必立直，正合"新手不会默听"。
 */
interface Traits {
  /** 鸣牌积极度：高的有路线就吃碰，低的守门清 */
  call: number;
  /** 默听倾向：高的手大了、等得好就不立直 */
  dama: number;
  /** 押引阈值：高的别人一立直就收，低的顶着打 */
  fold: number;
  /** 爱杠 */
  kan: number;
}

//                           幺妹儿          熊猫哥          盖碗儿          兔头哥          火锅婆婆        板凳儿
const RC_TRAITS: readonly Traits[] = [
  { call: 900, dama: 150, fold: 350, kan: 300 },
  { call: 600, dama: 500, fold: 250, kan: 500 },
  { call: 250, dama: 450, fold: 950, kan: 150 },
  { call: 650, dama: 250, fold: 300, kan: 1_000 },
  { call: 500, dama: 600, fold: 750, kan: 400 },
  { call: 750, dama: 100, fold: 50, kan: 600 },
];

/** 这一手实际用的参数：状态、手软手紧叠好，再按点数局面调 */
export function styleOf(v: RcView): Style {
  const me = v.me!;
  const idx = v.seats[me.seat]!.persona;
  const p = PERSONAS[idx] ?? PERSONAS[0]!;
  const t = RC_TRAITS[idx] ?? RC_TRAITS[0]!;
  const asRc: Persona = { ...p, pon: t.call, greed: t.dama, defense: t.fold, kanLove: t.kan };
  const st = moodStyle(asRc, me.tune);
  let { defense } = st;
  // 最后一局：领先很多收着打，落后很多放开追；点数快见底（飞了就结束）也收一点
  const pts = v.seats.map((s) => s.points);
  const mine = pts[me.seat]!;
  const rival = Math.max(...pts.filter((_, i) => i !== me.seat));
  const last = v.hand === 3 && v.wind >= (v.opts.length === 'tonpuu' ? 0 : 1);
  if (last && mine - rival >= 8_000) defense += 200;
  else if (last && rival - mine >= 12_000) defense -= 200;
  if (mine < 6_000) defense += 100;
  return { ...st, defense: clamp(defense) };
}

const clamp = (x: number, lo = 0, hi = 1_000): number => Math.max(lo, Math.min(hi, Math.round(x)));

// ---------- 看得见的东西 ----------

const isYaochu = (k: number): boolean => k >= HONOR0 || rankOf(k) === 1 || rankOf(k) === 9;
const isRed = (t: Tile): boolean => RED.includes(t);

/** 一组副露（真的或者"假如这么鸣"的）：牌种和是不是明的 */
interface MeldInfo {
  m: Meld;
  kinds: number[];
  open: boolean;
}

const infoOf = (m: Meld): MeldInfo => ({ m, kinds: m.tiles.filter((t) => t >= 0).map(kindOf), open: m.kan !== 'concealed' });

interface Ctx {
  v: RcView;
  me: number;
  /** 手里的牌（出牌时 14 张，声明窗口 13 张） */
  hand: Tile[];
  melds: MeldInfo[];
  style: Style;
  /** 看得见的每种牌的张数：所有人的弃牌（没被拿走的）、所有副露、宝牌指示牌；不含自己手里的 */
  visible: number[];
  /** 宝牌的牌种（可重复） */
  dora: number[];
  /** 每种牌是几张宝牌 */
  doraHits: number[];
  seatWind: number;
  /** 每家的威胁（0–1000）：立直 1000，副露显眼的按副露估 */
  threat: number[];
  maxThreat: number;
  /** 有没有人立直 */
  riichiOpp: boolean;
  /** 现物：对每个有威胁的对手，哪些牌种他肯定不和 */
  safe: (Set<number> | null)[];
}

function visibleCounts(v: RcView): number[] {
  const c = new Array<number>(34).fill(0);
  for (const s of v.seats) {
    for (const r of s.river) if (!r.taken) c[kindOf(r.tile)]!++;
    for (const m of s.melds) for (const t of m.tiles) if (t >= 0) c[kindOf(t)]!++;
  }
  for (const t of v.dora) c[kindOf(t)]!++;
  return c;
}

/** 离庄家几手（庄家先打） */

/**
 * 这一家的威胁：立直是 1000；副露两组以上看着显眼的（三组、副露里有宝牌、役牌、一门到底）按副露和牌河长度估，上限不到立直。
 * 只看公开的副露和弃牌
 */
function threatOf(v: RcView, o: number, doraHits: readonly number[], seatWindOf: (s: number) => number): number {
  const s = v.seats[o]!;
  if (s.riichi) return 1_000;
  const open = s.melds.filter((m) => m.kan !== 'concealed');
  if (open.length < 2) return 0;
  let t = open.length >= 3 ? 650 : 420;
  const kinds = open.flatMap((m) => m.tiles.map(kindOf));
  t += 120 * kinds.filter((k, i) => i % 3 === 0 && doraHits[k]! > 0).length;
  const yakuhai = open.some((m) => m.kind !== 'chi' && (kindOf(m.tiles[0]!) >= 31 || kindOf(m.tiles[0]!) === 27 + v.wind || kindOf(m.tiles[0]!) === 27 + seatWindOf(o)));
  if (yakuhai) t += 60;
  const suited = new Set(kinds.filter((k) => k < HONOR0).map((k) => Math.floor(k / 9)));
  if (suited.size <= 1) t += 100;
  // 河还短，牌还没成型
  if (s.river.length < 6) t = (t * 6) / 10;
  if (o === v.dealer) t = (t * 12) / 10;
  return Math.min(800, Math.round(t));
}

/**
 * 对立直的人，哪些牌是现物：他自己河里的牌，加上他立直宣告以后全桌打出的牌（他没和，就是放过了，同巡振听和立直后振听都管着他）。
 * 先后按河里每张记的"全桌第几张"（n）判断，有人鸣牌打乱轮次也不会算错
 */
function safeSetOf(v: RcView, o: number): Set<number> {
  const s = v.seats[o]!;
  const out = new Set<number>(s.river.map((r) => kindOf(r.tile)));
  if (!s.riichi || s.riichiAt < 0) return out;
  const at = s.river[s.riichiAt]!.n;
  for (const x of v.seats) for (const r of x.river) if (r.n > at) out.add(kindOf(r.tile));
  return out;
}

function ctxOf(v: RcView, hand: Tile[], style: Style): Ctx {
  const me = v.me!.seat;
  const seat = v.seats[me]!;
  const dora = v.dora.map((t) => doraOf(kindOf(t)));
  const doraHits = new Array<number>(34).fill(0);
  for (const k of dora) doraHits[k]!++;
  const seatWindOf = (s: number): number => v.seats[s]!.wind;
  const threat = v.seats.map((_, i) => (i === me ? 0 : threatOf(v, i, doraHits, seatWindOf)));
  return {
    v,
    me,
    hand,
    melds: seat.melds.map(infoOf),
    style,
    visible: visibleCounts(v),
    dora,
    doraHits,
    seatWind: seat.wind,
    threat,
    maxThreat: Math.max(...threat),
    riichiOpp: v.seats.some((s, i) => i !== me && s.riichi > 0),
    safe: threat.map((t, i) => (t > 0 ? safeSetOf(v, i) : null)),
  };
}

// ---------- 役的路线 ----------

const yakuhaiKind = (c: Ctx, k: number): boolean => k >= 31 || k === 27 + c.v.wind || k === 27 + c.seatWind;

/**
 * 这手牌（cnt 是手里的牌，ms 是副露）往下做能不能有役，0 没有、1 有路但远、2 路线清楚、3 已经有（役牌刻子、手里没幺九的断幺等）。
 * 只看牌型，不算和牌；听牌了另有逐张等的牌真算的检查（hasYakuWait）。门清的手不需要这个
 */
function route(c: Ctx, cnt: Counts, ms: readonly MeldInfo[]): number {
  let best = 0;
  // 役牌：刻子已经有了；手里有对子、外面还有一张可碰
  for (const m of ms) if (m.m.kind !== 'chi' && yakuhaiKind(c, m.kinds[0]!)) return 3;
  for (let k = 27; k < 34; k++) {
    if (!yakuhaiKind(c, k)) continue;
    if (cnt[k]! >= 3) return 3;
    if (cnt[k] === 2 && 4 - 2 - c.visible[k]! >= 1) best = 2;
  }
  // 断幺九：副露里没有幺九字牌，手里的幺九字牌越少越好
  if (ms.every((m) => !m.kinds.some(isYaochu))) {
    let yc = 0;
    for (let k = 0; k < 34; k++) if (isYaochu(k)) yc += cnt[k]!;
    best = Math.max(best, yc === 0 ? 3 : yc === 1 ? 2 : yc === 2 ? 1 : 0);
  }
  // 混一色、清一色：副露只有一门（加字牌），手里别的门越少越好
  const suits = new Set(ms.flatMap((m) => m.kinds).filter((k) => k < HONOR0).map((k) => Math.floor(k / 9)));
  if (suits.size <= 1) {
    const own = [0, 0, 0];
    for (let k = 0; k < HONOR0; k++) own[Math.floor(k / 9)]! += cnt[k]!;
    const main = suits.size === 1 ? [...suits][0]! : own.indexOf(Math.max(...own));
    const off = own.reduce((a, n, i) => a + (i === main ? 0 : n), 0);
    // 手里这一门加字牌至少占大半才算在做
    const near = own[main]! + cnt.slice(HONOR0).reduce((a, n) => a + n, 0);
    if (near * 2 >= cnt.reduce((a, n) => a + n, 0) + 2) best = Math.max(best, off === 0 ? 3 : off === 1 ? 2 : off === 2 ? 1 : 0);
  }
  // 对对和：副露都是刻子，手里对子刻子够多
  if (ms.every((m) => m.m.kind !== 'chi')) {
    const pairs = cnt.filter((n) => n >= 2).length;
    const need = 5 - ms.length;
    if (pairs >= need) best = Math.max(best, 2);
    else if (pairs >= need - 1) best = Math.max(best, 1);
  }
  // 一气通贯：某一门 1–9 凑到七种以上
  for (let s = 0; s < 3; s++) {
    let got = 0;
    for (let r = 0; r < 9; r++) if (cnt[s * 9 + r]! > 0 || ms.some((m) => m.m.kind === 'chi' && m.kinds.includes(s * 9 + r))) got++;
    if (got >= 7 && ms.some((m) => m.m.kind === 'chi')) best = Math.max(best, 1);
  }
  return best;
}

/** 副露全是暗杠（门清）吗 */
const closedHand = (ms: readonly MeldInfo[]): boolean => ms.every((m) => !m.open);

// ---------- 听牌的好坏 ----------

interface WaitStats {
  /** 还剩几张能和（看得见的算掉） */
  left: number;
  /** 等几种牌 */
  kinds: number;
  /** 最好的一张和了的基本点（没役是 0） */
  base: number;
  /** 至少有一张和了有役 */
  yaku: boolean;
  /** 按点数加权的张数，和 left 同一个尺度（点数大的一张顶好几张） */
  rich: number;
}

/**
 * 听牌（tiles 是 13 张，ms 是副露）的好坏。逐张等的牌真的算一遍役和点（scoreWin，荣和）：riichi 为 1 就按立直了算。
 * extra 是"假如这么鸣"手里要多算的看得见的牌（鸣出去的那几张还没进副露的计数）
 */
function waitStats(c: Ctx, tiles: readonly Tile[], ms: readonly MeldInfo[], riichi: 0 | 1, extra?: readonly number[]): WaitStats {
  const cnt = countsOf(tiles);
  const waits = waitsOf(cnt, ms.length);
  const owned = new Set<Tile>([...tiles, ...ms.flatMap((m) => m.m.tiles)]);
  const meldObjs = ms.map((m) => m.m);
  let left = 0;
  let kinds = 0;
  let base = 0;
  let rich = 0;
  let yaku = false;
  for (const k of waits) {
    const l = 4 - cnt[k]! - c.visible[k]! - (extra?.[k] ?? 0);
    if (l <= 0) continue;
    // 和牌张用一张还没出现在手里的实物牌（优先非赤）
    let win = -1;
    for (let j = 3; j >= 0 && win < 0; j--) if (!owned.has(tileOf(k, j))) win = tileOf(k, j);
    if (win < 0) continue;
    const ctx: WinContext = {
      win,
      tsumo: false,
      seatWind: c.seatWind,
      roundWind: c.v.wind,
      riichi,
      ippatsu: false,
      rinshan: false,
      chankan: false,
      haitei: false,
      houtei: false,
      tenhou: false,
      chiihou: false,
      dora: c.dora,
      ura: [],
    };
    const r = scoreWin([...tiles, win], meldObjs, ctx);
    const b = r?.base ?? 0;
    left += l;
    kinds++;
    if (r) yaku = true;
    base = Math.max(base, b);
    // 点数的权重：一番三十符（240）约 0.7 张，满贯（2,000）以上封到 3 张
    rich += (l * (500 + Math.min(b, 2_500))) / 1_000;
  }
  return { left, kinds, base, yaku, rich };
}

// ---------- 防守：危险度 ----------

/** 数牌按位置的基础危险（0–1000）：中张最危险，幺九最安全 */
const RANK_DANGER = [0, 300, 380, 480, 560, 560, 560, 480, 380, 300];

/**
 * 打出 k 对 o 有多危险（0–1000，0 是肯定不放铳）。mine 是我自己手里的张数（看得见的一部分）。
 * 读牌的准头（reads）决定筋、壁这些推断信几成：新手只认现物和字牌
 */
function danger(c: Ctx, o: number, k: number, mine: readonly number[]): number {
  if (c.safe[o]!.has(k)) return 0;
  const seen = (x: number): number => c.visible[x]! + mine[x]!;
  const reads = c.style.reads;
  /** 把一个"打折"系数按读牌的准头打折扣（f 是千分比，1000 = 不打折） */
  const trust = (f: number): number => 1_000 - ((1_000 - f) * reads) / 1_000;
  if (k >= HONOR0) {
    const n = seen(k);
    if (n >= 4) return 0;
    let d = [420, 330, 200, 80][n]!;
    const w = c.v.seats[o]!.wind;
    // 他的役牌（三元、场风、他的自风）比客风危险
    if (k >= 31 || k === 27 + c.v.wind || k === 27 + w) d = (d * 125) / 100;
    else d = (d * 80) / 100;
    return Math.round(d);
  }
  if (seen(k) >= 4) return 0;
  const r = rankOf(k);
  let d = RANK_DANGER[r]!;
  const river = new Set(c.v.seats[o]!.river.map((x) => kindOf(x.tile)));
  // 筋：他打过的牌差 3 的另一头，两面听不了
  const lower = r >= 4 && river.has(k - 3);
  const upper = r <= 6 && river.has(k + 3);
  if (r >= 4 && r <= 6) d = lower && upper ? (d * trust(400)) / 1_000 : lower || upper ? (d * trust(800)) / 1_000 : d;
  else if ((r <= 3 && upper) || (r >= 7 && lower)) d = (d * trust(450)) / 1_000;
  // 壁：旁边的牌四张都看见了，能凑出这张的顺子少一路
  const realUp = r <= 7 && (seen(k + 1) >= 4 || seen(k + 2) >= 4);
  const realDown = r >= 3 && (seen(k - 1) >= 4 || seen(k - 2) >= 4);
  if (realUp || realDown) {
    const upOk = realUp || r >= 8;
    const downOk = realDown || r <= 2;
    d = upOk && downOk ? (d * trust(400)) / 1_000 : (d * trust(850)) / 1_000;
  }
  // 宝牌放铳更痛
  if (c.doraHits[k]! > 0) d = (d * 125) / 100;
  return Math.round(d);
}

/** 打出 k 的总危险：每个有威胁的对手的危险度按他的威胁加权 */
function dangerSum(c: Ctx, k: number, mine: readonly number[], cache: Map<number, number>): number {
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let d = 0;
  c.threat.forEach((t, o) => {
    if (t > 0) d += (danger(c, o, k, mine) * t) / 1_000;
  });
  cache.set(k, d);
  return d;
}

// ---------- 出牌 ----------

/** 由局面和这一场的状态算出的 0–999 的数（代替随机数，同一局面同一结果；不同场次的同一局面不一样） */
function noise(v: RcView, salt = 0): number {
  let h = 2166136261;
  const feed = (x: number): void => {
    h = Math.imul(h ^ (x & 0xff), 16777619) >>> 0;
  };
  for (const t of v.me!.hand) feed(t);
  feed(v.wall);
  feed(v.hand);
  feed(v.wind);
  feed(v.honba);
  feed(salt);
  const m = v.me!.tune.mood;
  for (let i = 0; i < 4; i++) feed(m >>> (i * 8));
  return h % 1000;
}

/** 一张牌留着的价值（越小越先打）：客风 < 幺九 < 役牌 < 中张；只拿来在牌效差不多时分高下 */
function worth(c: Ctx, k: number): number {
  if (k >= HONOR0) return yakuhaiKind(c, k) ? (k === 27 + c.v.wind && k === 27 + c.seatWind ? 4 : 3) : 0;
  const r = rankOf(k);
  return r === 1 || r === 9 ? 1 : r === 2 || r === 8 ? 2 : 3;
}

/** 每种牌挑一张实物牌来打：同种里先打不是赤的 */
function pick(hand: readonly Tile[], k: number): Tile {
  const same = hand.filter((t) => kindOf(t) === k);
  return same.find((t) => !isRed(t)) ?? same[0]!;
}

interface Cand {
  tile: Tile;
  k: number;
  /** 打了以后的向听数；副露没役可和的听牌当一向听 */
  sh: number;
  uke: number;
  /** 进攻的分（不含防守） */
  attack: number;
  stats: WaitStats | null;
  /** 防守扣分之后 */
  score: number;
}

/** 副露的手听牌了，但等的牌全都没役：和不了，算还差一步（门清的手不算，立直和自摸能补役） */
function effShanten(c: Ctx, sh: number, stats: WaitStats | null, cnt: Counts, ms: readonly MeldInfo[]): number {
  if (closedHand(ms)) return sh;
  if (sh === 0 && stats && !stats.yaku) return 1;
  // 没役路线的副露手，再近也是白做
  if (sh <= 1 && route(c, cnt, ms) === 0 && !(stats && stats.yaku)) return sh + 1;
  return sh;
}

function evalDiscards(c: Ctx, options: readonly Tile[]): Cand[] {
  const v = c.v;
  const st = c.style;
  const hand = c.hand;
  const mN = c.melds.length;
  const mine = countsOf(hand);
  const kindsSeen = new Set<number>();
  const raw: { tile: Tile; k: number; sh: number }[] = [];
  const cnt = countsOf(hand);
  for (const t of options) {
    const k = kindOf(t);
    if (kindsSeen.has(k)) continue;
    kindsSeen.add(k);
    cnt[k]!--;
    raw.push({ tile: pick(options, k), k, sh: shanten(cnt, mN, SHAPE) });
    cnt[k]!++;
  }
  const minSh = Math.min(...raw.map((x) => x.sh));
  const closed = closedHand(c.melds);
  const drawn = v.me!.drawn;
  const cache = new Map<number, number>();
  const out: Cand[] = [];
  for (const { tile, k, sh } of raw) {
    cnt[k]!--;
    // 一向听以内才细算有效牌和听牌：差得远的候选只会被向听数的差压下去
    const uke = sh <= minSh + 1 ? ukeire(cnt, mN, SHAPE, ALL_KINDS, c.visible).total : 0;
    let stats: WaitStats | null = null;
    if (sh === 0) stats = waitStats(c, withoutOne(hand, tile), c.melds, closed ? 1 : 0);
    const eff = effShanten(c, sh, stats, cnt, c.melds);
    let attack = -eff * 10_000;
    // 听牌：等的牌多少（有功力的再按点数加权）；副露的手等的牌都没役，不算听牌，按有效牌
    if (stats && eff === 0) attack += ((stats.left * (1_000 - st.skill) + stats.rich * st.skill) / 1_000) * 10;
    else attack += uke * 10;
    // 宝牌、赤宝牌少打；孤立的客风字牌最先打；原样打摸来的那张（不露手牌）
    attack -= 25 * (c.doraHits[k]! + (isRed(tile) ? 1 : 0));
    attack -= worth(c, k) * 3;
    if (tile === drawn) attack += 1;
    cnt[k]!++;
    out.push({ tile, k, sh: eff, uke, attack, stats, score: attack });
  }
  // 防守
  if (c.maxThreat > 0) {
    const fold = st.defense / 500;
    for (const x of out) {
      let w = x.sh <= 0 ? 8 : x.sh === 1 ? 24 : 60;
      if (x.sh <= 0 && x.stats) {
        // 听牌的手要不要顶：点数大、等得好就顶，点数小、等得差就收
        const big = x.stats.base >= 2_000 ? 0.5 : x.stats.base >= 1_000 ? 0.8 : 1.3;
        const bad = x.stats.left <= 3 ? 1.4 : 1;
        w *= big * bad;
      }
      if (v.me!.seat === v.dealer) w *= 0.85;
      x.score -= w * fold * dangerSum(c, x.k, mine, cache);
    }
  }
  return out.sort((a, b) => b.score - a.score || a.tile - b.tile);
}

/** 去掉一张实物牌（hand 里有重复的 id 不会有，牌都是唯一的） */
function withoutOne(hand: readonly Tile[], tile: Tile): Tile[] {
  const i = hand.indexOf(tile);
  return hand.filter((_, j) => j !== i);
}

/** 宣告立直时打哪一张：听牌最好的那张（等的牌多、点数大），有人在防就把危险度算进去 */
function chooseRiichiTile(c: Ctx, options: readonly Tile[]): { tile: Tile; stats: WaitStats; dama: WaitStats } {
  const st = c.style;
  const mine = countsOf(c.hand);
  const cache = new Map<number, number>();
  const seen = new Set<number>();
  let best: { tile: Tile; stats: WaitStats; dama: WaitStats; score: number } | null = null;
  for (const t of options) {
    const k = kindOf(t);
    if (seen.has(k)) continue;
    seen.add(k);
    const tile = pick(options, k);
    const rest = withoutOne(c.hand, tile);
    const stats = waitStats(c, rest, c.melds, 1);
    let score = ((stats.left * (1_000 - st.skill) + stats.rich * st.skill) / 1_000) * 10;
    score -= 25 * (c.doraHits[k]! + (isRed(tile) ? 1 : 0)) + worth(c, k) * 3;
    if (c.maxThreat > 0) score -= 8 * (st.defense / 500) * dangerSum(c, k, mine, cache);
    if (!best || score > best.score) best = { tile, stats, dama: waitStats(c, rest, c.melds, 0), score };
  }
  return best!;
}

/** 门清听牌了，立直还是默听（docs/riichi.md 第 3 节） */
function wantRiichi(c: Ctx, r: { stats: WaitStats; dama: WaitStats }): boolean {
  const st = c.style;
  const { stats, dama } = r;
  const wall = c.v.wall;
  // 等的牌看得见的已经没了：立直白送一千点
  if (stats.left === 0) return false;
  // 牌墙太少，来不及和
  if (wall <= 5) return false;
  // 默听没役，只能立直（或者放弃）
  if (!dama.yaku) {
    // 别人已立直，我这手点数低、等得差：不追，留着当安全牌手牌
    if (c.riichiOpp && stats.left <= 3 && stats.base < 1_000) return false;
    return true;
  }
  // 默听已经役满：不立直，也别吓跑别人
  if (dama.base >= 8_000) return false;
  // 默听就满贯以上而且等得多
  const wide = st.greed >= 600 ? 4 : 5;
  if (dama.base >= 2_000 && dama.left >= wide) return false;
  // 爱默听的：三番以上、等得很多也默听
  if (st.greed >= 600 && dama.base >= 960 && dama.left >= 6) return false;
  if (wall <= 7) return false;
  // 别人立直了我才追：点数低、等得差就算了
  if (c.riichiOpp && stats.left <= 3 && stats.base < 2_000) return false;
  return true;
}

// ---------- 杠、九种九牌 ----------

/** 要不要杠 prompt.kan 里的某一张。bestSh 是不杠时打一张最好的向听 */
function wantKan(c: Ctx, t: Tile, bestSh: number): boolean {
  const k = kindOf(t);
  const me = c.v.seats[c.me]!;
  // 立直后 prompt 里留下的都是不改听牌的暗杠：杠，多一张宝牌指示牌、多一次摸牌
  if (me.riichi) return true;
  // 别人立直或显眼：多翻一张宝牌指示牌对谁都是风险，不开新杠
  if (c.maxThreat >= 400 || c.v.wall < 8) return false;
  const cnt = countsOf(c.hand);
  const full = cnt[k] === 4;
  cnt[k] = full ? 0 : cnt[k]! - 1;
  const after = shanten(cnt, c.melds.length + (full ? 1 : 0), SHAPE);
  if (after > bestSh) return false;
  // 暗杠不破坏手牌就杠；加杠让别人有机会抢，爱杠的才做
  return full || c.style.kanLove >= 300;
}

function wantKyuushu(c: Ctx): boolean {
  const cnt = countsOf(c.hand);
  let n = 0;
  for (let k = 0; k < 34; k++) if (isYaochu(k) && cnt[k]! > 0) n++;
  // 十一种以上国士只差两步，值得搏；不然手也不好就流了
  if (n >= 11) return false;
  return shanten(cnt, 0, SHAPE) >= 3;
}

function decideTurn(v: RcView, style: Style): RcAction {
  const pr = v.prompt!;
  const me = v.me!;
  if (pr.tsumo) return { t: 'tsumo' };
  const c = ctxOf(v, me.hand, style);
  if (pr.kyuushu && wantKyuushu(c)) return { t: 'kyuushu' };
  const seat = v.seats[c.me]!;
  const discards = pr.discard!;
  // 立直后只能打摸来的，只有杠可选
  if (seat.riichi) {
    if (pr.kan?.length && wantKan(c, pr.kan[0]!, 0)) return { t: 'kan', tile: pr.kan[0]! };
    return { t: 'discard', tile: discards[0]! };
  }
  if (pr.riichi?.length) {
    const r = chooseRiichiTile(c, pr.riichi);
    if (wantRiichi(c, r)) return { t: 'discard', tile: r.tile, riichi: true };
  }
  const evals = evalDiscards(c, discards);
  const best = evals[0]!;
  for (const t of pr.kan ?? []) if (wantKan(c, t, best.sh)) return { t: 'kan', tile: t };
  let pickC = best;
  // 打错：在第 2 到第 4 好里挑一张，而且不能比最好的多差一向听（由局面算出来，不用随机数）
  const r = noise(v);
  if (style.slip > 0 && evals.length > 1 && r < style.slip) {
    const pool = evals.slice(1, 4).filter((x) => x.sh <= best.sh + 1);
    if (pool.length) pickC = pool[r % pool.length]!;
  }
  return { t: 'discard', tile: pickC.tile };
}

// ---------- 吃碰杠 ----------

interface After {
  sh: number;
  uke: number;
  route: number;
}

/**
 * 鸣了以后（再打一张最好的）的情况。remove 是从手里拿出去的两张或三张牌种，meld 是这一组，banned 是不能马上打的牌种（食替）。
 * 打哪张按：向听、没役路线罚、有效牌
 */
function afterCall(c: Ctx, remove: readonly number[], meld: MeldInfo, banned: readonly number[]): After {
  const cnt = countsOf(c.hand);
  for (const k of remove) cnt[k]!--;
  const ms = [...c.melds, meld];
  const vis = c.visible.slice();
  for (const k of remove) vis[k]!++;
  let best: After & { key: number } = { sh: 99, uke: 0, route: 0, key: -Infinity };
  // 杠不用再打（补一张岭上牌）：直接看这手牌
  if (meld.m.kind === 'kan') {
    const sh = shanten(cnt, ms.length, SHAPE);
    return { sh, uke: ukeire(cnt, ms.length, SHAPE, ALL_KINDS, vis).total, route: route(c, cnt, ms) };
  }
  for (let d = 0; d < 34; d++) {
    if (!cnt[d] || banned.includes(d)) continue;
    cnt[d]!--;
    const sh = shanten(cnt, ms.length, SHAPE);
    if (sh <= best.sh) {
      const uke = ukeire(cnt, ms.length, SHAPE, ALL_KINDS, vis).total;
      let r = route(c, cnt, ms);
      let eff = sh;
      if (sh === 0) {
        // 听牌了：副露的手逐张看等的牌有没有役
        const tiles = tilesOfCounts(c, cnt, remove);
        const extra = new Array<number>(34).fill(0);
        for (const k of remove) extra[k]!++;
        const stats = waitStats(c, tiles, ms, 0, extra);
        if (!stats.yaku) eff = 1;
        else r = Math.max(r, 1);
      }
      const key = -eff * 10_000 - (r === 0 ? 20_000 : 0) + uke * 10;
      if (key > best.key) best = { sh: eff, uke, route: r, key };
    }
    cnt[d]!++;
  }
  return best;
}

/** 把牌种计数换成手里的实物牌（鸣出去的那几张已经不在 cnt 里；其余尽量用手里真有的牌，赤宝牌别丢） */
function tilesOfCounts(c: Ctx, cnt: Counts, removed: readonly number[]): Tile[] {
  const pool = c.hand.slice();
  for (const k of removed) {
    const i = pool.findIndex((t) => kindOf(t) === k);
    if (i >= 0) pool.splice(i, 1);
  }
  const out: Tile[] = [];
  const need = cnt.slice();
  for (const t of pool) {
    const k = kindOf(t);
    if (need[k]! > 0) {
      need[k]!--;
      out.push(t);
    }
  }
  return out;
}

function decideClaim(v: RcView, style: Style): RcAction {
  const cl = v.prompt!.claim!;
  const me = v.me!;
  const w = cl.w;
  if (cl.opts.includes('ron')) return { t: 'claim', w, c: 'ron' };
  const pass: RcAction = { t: 'claim', w, c: 'pass' };
  const c = ctxOf(v, me.hand, style);
  const tile = v.claim!.tile;
  const k = kindOf(tile);
  const from = v.claim!.from;
  const mN = c.melds.length;
  const open = !closedHand(c.melds);
  const cnt = countsOf(c.hand);
  const now = shanten(cnt, mN, SHAPE);
  // 听牌了就守着：鸣牌只会换一张，还丢了听牌形
  if (now === 0) return pass;
  const threatened = c.maxThreat >= 600;
  const synth = (kind: Meld['kind'], ks: number[], by: Tile[]): MeldInfo => ({ m: { kind, tiles: by, from }, kinds: ks, open: true });
  const have = (kinds: number[]): Tile[] => {
    const pool = c.hand.slice();
    return kinds.map((x) => pool.splice(pool.findIndex((t) => kindOf(t) === x), 1)[0]!);
  };
  /** 鸣不鸣：after 是鸣了以后的情况，secured 是这一组本身就带役（役牌刻子） */
  const accept = (after: After, secured: boolean, kind: 'chi' | 'pon' | 'kan'): boolean => {
    if (after.route === 0 || after.sh >= 99) return false;
    const dealt = c.hand.some((t) => c.doraHits[kindOf(t)]! > 0 || isRed(t)) || c.doraHits[k]! > 0 || isRed(tile);
    if (after.sh > now) return false;
    if (after.sh === now) {
      // 向听没变：役牌刻子（多一番）而且有效牌没少，或者特别爱鸣的手
      if (!(secured && kind !== 'chi')) return false;
    }
    // 别人立直或显眼：鸣了能听牌（或者一向听且不太怕）才鸣
    if (threatened && !(after.sh === 0 || (after.sh <= 1 && style.defense < 400))) return false;
    if (secured) return true;
    // 门清的手轻易不鸣：一向听的手门清立直更值，鸣牌积极度高的才
    if (!open && now <= 1 && style.pon < 600) return false;
    // 没有役牌、宝牌撑着的便宜手，鸣牌积极度要够
    return style.pon >= (dealt || after.route >= 3 ? 250 : 500);
  };
  const yakuhaiPon = yakuhaiKind(c, k);
  if (cl.opts.includes('kan') && !threatened) {
    const meld = synth('kan', [k, k, k, k], [...have([k, k, k]), tile]);
    const after = afterCall(c, [k, k, k], meld, []);
    // 大明杠：役牌、爱杠的才做，而且不能让手变差
    if (after.sh <= now && after.route >= 1 && ((yakuhaiPon && style.kanLove >= 300) || style.kanLove >= 900)) return { t: 'claim', w, c: 'kan' };
  }
  if (cl.opts.includes('pon')) {
    const meld = synth('pon', [k, k, k], [...have([k, k]), tile]);
    const after = afterCall(c, [k, k], meld, [k]);
    if (accept(after, yakuhaiPon, 'pon')) return { t: 'claim', w, c: 'pon' };
  }
  if (cl.opts.includes('chi')) {
    let bestLow = -1;
    let best: After | null = null;
    for (const low of cl.chi) {
      const run = [low, low + 1, low + 2];
      const rest = run.filter((x) => x !== k);
      // 食替：不能打刚吃的那种，也不能打吃的这组另一头的牌（同一门里才算）
      const banned = [k];
      if (k === low && rankOf(low) <= 6) banned.push(low + 3);
      else if (k === low + 2 && rankOf(low) >= 2) banned.push(low - 1);
      const meld = synth('chi', run, [...have(rest), tile]);
      const after = afterCall(c, rest, meld, banned);
      if (!best || after.sh < best.sh || (after.sh === best.sh && after.uke > best.uke)) {
        best = after;
        bestLow = low;
      }
    }
    if (best && accept(best, false, 'chi')) return { t: 'claim', w, c: 'chi', low: bestLow };
  }
  return pass;
}

export function decide(v: RcView): RcAction {
  if (!v.me || !v.prompt) throw new Error('ai: nothing to do');
  const style = styleOf(v);
  return v.prompt.claim ? decideClaim(v, style) : decideTurn(v, style);
}

export const riichiAi: VariantAi<RcView, RcAction> = { decide };
