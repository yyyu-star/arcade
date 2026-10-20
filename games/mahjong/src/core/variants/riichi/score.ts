/**
 * 日麻（立直麻将，天凤规则）的役、符、点数。只看牌和这一手的时机，不碰点棒、本场、供托。
 *
 * 做法（高点法）：把手牌的全部拆法 × 和牌张可能落在的每个位置都算一遍，取基本点最高的（同点再比番、符）。
 * 位置决定听牌形（单骑/坎张/边张加符）和那一组算明还是暗（荣和完成的刻子按明刻，影响符和三暗刻）。
 * 七对、国士是另外两类解，和一般型的最好解放在一起比，所以二杯口形和七对同时成立时自然取高的。
 *
 * 约定：hand 是手里没有副露出去的牌（含和的那一张），副露另给；所以 hand.length + 3 × 副露数 = 14（杠按 3 算）。
 * 全部是纯函数，没有随机、时间；2 的幂用移位。
 */
import { decompose, isComplete, isSeven, type Counts, type Decomp, type ShapeRules } from '../../hand/index.ts';
import type { Meld } from '../../table/index.ts';
import { countsOf, HONOR0, kindOf, KINDS, rankOf, suitOf, tileOf, type Tile } from '../../tiles/index.ts';

/** 日麻的算法开关：七对、国士都开，七对里四张一样不算两对 */
export const SHAPE: ShapeRules = { seven: true, sevenQuads: false, kokushi: true };

export const ALL_KINDS: readonly number[] = Array.from({ length: KINDS }, (_, k) => k);

/** 赤宝牌：5m、5p、5s 的第 0 张 */
export const RED: readonly Tile[] = [tileOf(4, 0), tileOf(13, 0), tileOf(22, 0)];

const EAST = 27;
const HAKU = 31;
const HATSU = 32;
const CHUN = 33;
const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
/** 绿一色只许这几种：2、3、4、6、8 条和发 */
const GREEN = new Set([19, 20, 21, 23, 25, HATSU]);

const isYaochu = (k: number): boolean => k >= HONOR0 || rankOf(k) === 1 || rankOf(k) === 9;
const isTerminal = (k: number): boolean => k < HONOR0 && (rankOf(k) === 1 || rankOf(k) === 9);

// ---------- 牌型判断 ----------

/** 14 张国士（十三种幺九各一张，其中一种是对子） */
export function isKokushi(counts: Counts): boolean {
  let total = 0;
  let pair = false;
  for (const k of YAOCHU) {
    const x = counts[k]!;
    if (x === 0) return false;
    if (x === 2) pair = true;
    else if (x !== 1) return false;
    total += x;
  }
  return pair && total === 14;
}

/** 和牌：一般型 / 七对（四张一样不算两对）/ 国士。meldCount 是副露组数（杠也算一组） */
export function isAgari(counts: Counts, meldCount: number): boolean {
  if (isComplete(counts, meldCount, SHAPE)) return true;
  return meldCount === 0 && isKokushi(counts);
}

/**
 * 听哪些牌种（13 张）。不看牌还剩几张：自己手里已有 4 张的那种也照算，要不要当"听不到"由规则层决定。
 * 会改 counts13 再还原，返回时 counts13 不变。
 */
export function waitsOf(counts13: Counts, meldCount: number): number[] {
  const out: number[] = [];
  for (const k of ALL_KINDS) {
    counts13[k]!++;
    if (isAgari(counts13, meldCount)) out.push(k);
    counts13[k]!--;
  }
  return out;
}

/** 宝牌：指示牌的下一种。数牌 9 回到 1，风 东南西北东，三元 白发中白 */
export function doraOf(indicator: number): number {
  if (indicator < HONOR0) return indicator % 9 === 8 ? indicator - 8 : indicator + 1;
  if (indicator < HAKU) return indicator === 30 ? EAST : indicator + 1;
  return indicator === CHUN ? HAKU : indicator + 1;
}

// ---------- 役 ----------

export type YakuId =
  | 'riichi'
  | 'double_riichi'
  | 'ippatsu'
  | 'tsumo'
  | 'pinfu'
  | 'tanyao'
  | 'iipeikou'
  | 'yakuhai_round'
  | 'yakuhai_seat'
  | 'haku'
  | 'hatsu'
  | 'chun'
  | 'rinshan'
  | 'chankan'
  | 'haitei'
  | 'houtei'
  | 'chiitoi'
  | 'sanshoku'
  | 'ittsu'
  | 'chanta'
  | 'toitoi'
  | 'sanankou'
  | 'sanshoku_pon'
  | 'sankantsu'
  | 'shousangen'
  | 'honroutou'
  | 'ryanpeikou'
  | 'junchan'
  | 'honitsu'
  | 'chinitsu'
  | 'kokushi'
  | 'suuankou'
  | 'daisangen'
  | 'shousuushii'
  | 'daisuushii'
  | 'tsuuiisou'
  | 'ryuuiisou'
  | 'chinroutou'
  | 'chuuren'
  | 'suukantsu'
  | 'tenhou'
  | 'chiihou';

export const YAKU_NAME: Record<YakuId, string> = {
  riichi: '立直',
  double_riichi: '双立直',
  ippatsu: '一发',
  tsumo: '门前清自摸和',
  pinfu: '平和',
  tanyao: '断幺九',
  iipeikou: '一杯口',
  yakuhai_round: '场风',
  yakuhai_seat: '自风',
  haku: '役牌 白',
  hatsu: '役牌 发',
  chun: '役牌 中',
  rinshan: '岭上开花',
  chankan: '抢杠',
  haitei: '海底摸月',
  houtei: '河底捞鱼',
  chiitoi: '七对子',
  sanshoku: '三色同顺',
  ittsu: '一气通贯',
  chanta: '混全带幺九',
  toitoi: '对对和',
  sanankou: '三暗刻',
  sanshoku_pon: '三色同刻',
  sankantsu: '三杠子',
  shousangen: '小三元',
  honroutou: '混老头',
  ryanpeikou: '二杯口',
  junchan: '纯全带幺九',
  honitsu: '混一色',
  chinitsu: '清一色',
  kokushi: '国士无双',
  suuankou: '四暗刻',
  daisangen: '大三元',
  shousuushii: '小四喜',
  daisuushii: '大四喜',
  tsuuiisou: '字一色',
  ryuuiisou: '绿一色',
  chinroutou: '清老头',
  chuuren: '九莲宝灯',
  suukantsu: '四杠子',
  tenhou: '天和',
  chiihou: '地和',
};

export interface Yaku {
  id: YakuId;
  /** 役满记 13 */
  han: number;
}

export interface WinContext {
  /** 和的那张实物牌 */
  win: Tile;
  tsumo: boolean;
  /** 0–3 东南西北 */
  seatWind: number;
  roundWind: number;
  /** 2 = 双立直 */
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  rinshan: boolean;
  chankan: boolean;
  haitei: boolean;
  houtei: boolean;
  tenhou: boolean;
  chiihou: boolean;
  /** 宝牌的牌种（已从指示牌换算，几张指示就几项，可重复） */
  dora: readonly number[];
  /** 里宝牌种；没立直传 [] */
  ura: readonly number[];
}

export interface HandScore {
  /** 有役满时只列役满 */
  yaku: Yaku[];
  /** 役满倍数；累计役满记 1（kazoe 为 true，yaku 里仍是原来的役） */
  yakuman: number;
  kazoe: boolean;
  /** 役 + 宝牌合计；真役满时为 0 */
  han: number;
  fu: number;
  dora: number;
  aka: number;
  ura: number;
  base: number;
  limit: 'none' | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman';
}

// ---------- 把手牌 + 副露摆成一组组 ----------

interface Grp {
  type: 'seq' | 'pung' | 'kan';
  /** 顺子是最小的那张 */
  kind: number;
  /** 明的：副露出去的，或荣和完成的刻子（符和三暗刻都按明算） */
  open: boolean;
}

type Wait = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

function meldGroup(m: Meld): Grp {
  if (m.kind === 'chi') return { type: 'seq', kind: Math.min(...m.tiles.map(kindOf)), open: true };
  return { type: m.kind === 'kan' ? 'kan' : 'pung', kind: kindOf(m.tiles[0]!), open: m.kan !== 'concealed' };
}

/** 和牌张落在顺子里的听牌形 */
function seqWait(g: number, w: number): Wait {
  if (w === g + 1) return 'kanchan';
  if (w === g && rankOf(g) === 7) return 'penchan'; // 89 等 7
  if (w === g + 2 && rankOf(g) === 1) return 'penchan'; // 12 等 3
  return 'ryanmen';
}

interface Eval {
  yaku: Yaku[];
  /** 只有役满时非空 */
  yakuman: Yaku[];
  fu: number;
}

const y = (id: YakuId, han: number): Yaku => ({ id, han });
const ym = (id: YakuId): Yaku => ({ id, han: 13 });

interface Shared {
  ctx: WinContext;
  menzen: boolean;
  /** 手牌 + 副露的全部牌种计数 */
  all: Counts;
}

/** 和牌形无关的役：时机类，以及只看用了哪些牌的（断幺、混清、字一色…）。七对和一般型共用 */
function common(s: Shared, han: Yaku[], full: Yaku[]): void {
  const { ctx, menzen, all } = s;
  if (ctx.riichi === 2) han.push(y('double_riichi', 2));
  else if (ctx.riichi === 1) han.push(y('riichi', 1));
  if (ctx.ippatsu) han.push(y('ippatsu', 1));
  if (menzen && ctx.tsumo) han.push(y('tsumo', 1));
  if (ctx.rinshan) han.push(y('rinshan', 1));
  if (ctx.chankan) han.push(y('chankan', 1));
  if (ctx.haitei) han.push(y('haitei', 1));
  if (ctx.houtei) han.push(y('houtei', 1));
  if (ctx.tenhou) full.push(ym('tenhou'));
  if (ctx.chiihou) full.push(ym('chiihou'));

  let used = 0;
  let honors = 0;
  let allYaochu = true;
  let noYaochu = true;
  let allTerminal = true;
  let green = true;
  const suits = new Set<number>();
  for (let k = 0; k < KINDS; k++) {
    if (!all[k]) continue;
    used++;
    if (k >= HONOR0) honors++;
    else suits.add(suitOf(k));
    if (isYaochu(k)) noYaochu = false;
    else allYaochu = false;
    if (!isTerminal(k)) allTerminal = false;
    if (!GREEN.has(k)) green = false;
  }
  if (used === 0) return;
  if (noYaochu) han.push(y('tanyao', 1));
  // 混老头：全是幺九，且没有顺子（顺子必含中张，所以"全是幺九"就够了）
  if (allYaochu && honors > 0 && suits.size > 0) han.push(y('honroutou', 2));
  if (suits.size === 1) han.push(honors > 0 ? y('honitsu', menzen ? 3 : 2) : y('chinitsu', menzen ? 6 : 5));
  if (suits.size === 0) full.push(ym('tsuuiisou'));
  if (allTerminal) full.push(ym('chinroutou'));
  if (green) full.push(ym('ryuuiisou'));
}

function evalChiitoi(s: Shared): Eval {
  const han: Yaku[] = [y('chiitoi', 2)];
  const full: Yaku[] = [];
  common(s, han, full);
  // 七对和清老头/字一色可同时成立；混老头在 common 里按"全是幺九"判，七对没有顺子所以对
  return { yaku: han, yakuman: full, fu: 25 };
}

function evalKokushi(s: Shared): Eval {
  const full: Yaku[] = [ym('kokushi')];
  if (s.ctx.tenhou) full.push(ym('tenhou'));
  if (s.ctx.chiihou) full.push(ym('chiihou'));
  return { yaku: [], yakuman: full, fu: 20 };
}

function evalGeneral(s: Shared, groups: readonly Grp[], pair: number, wait: Wait): Eval {
  const { ctx, menzen } = s;
  const han: Yaku[] = [];
  const full: Yaku[] = [];
  common(s, han, full);

  const seqs = groups.filter((g) => g.type === 'seq');
  const sets = groups.filter((g) => g.type !== 'seq');
  const seatKind = EAST + ctx.seatWind;
  const roundKind = EAST + ctx.roundWind;
  const yakuhaiPair = pair >= HAKU || pair === seatKind || pair === roundKind;

  // 平和：门清、全顺子、雀头不是役牌、两面听
  const pinfu = menzen && sets.length === 0 && !yakuhaiPair && wait === 'ryanmen';
  if (pinfu) han.push(y('pinfu', 1));

  // 役牌：每个风/三元的刻子或杠；连风牌（场风=自风）算两个役
  for (const g of sets) {
    if (g.kind === HAKU) han.push(y('haku', 1));
    else if (g.kind === HATSU) han.push(y('hatsu', 1));
    else if (g.kind === CHUN) han.push(y('chun', 1));
    else if (g.kind >= EAST) {
      if (g.kind === roundKind) han.push(y('yakuhai_round', 1));
      if (g.kind === seatKind) han.push(y('yakuhai_seat', 1));
    }
  }

  // 杯口：同一种顺子的"对数"
  if (menzen) {
    const cnt = new Map<number, number>();
    for (const g of seqs) cnt.set(g.kind, (cnt.get(g.kind) ?? 0) + 1);
    let peikou = 0;
    for (const n of cnt.values()) peikou += n >> 1;
    if (peikou >= 2) han.push(y('ryanpeikou', 3));
    else if (peikou === 1) han.push(y('iipeikou', 1));
  }

  // 三色同顺 / 三色同刻 / 一气通贯
  for (let r = 0; r < 9; r++) {
    if ([0, 9, 18].every((b) => seqs.some((g) => g.kind === b + r))) han.push(y('sanshoku', menzen ? 2 : 1));
    if ([0, 9, 18].every((b) => sets.some((g) => g.kind === b + r))) han.push(y('sanshoku_pon', 2));
  }
  for (const b of [0, 9, 18]) {
    if ([0, 3, 6].every((d) => seqs.some((g) => g.kind === b + d))) han.push(y('ittsu', menzen ? 2 : 1));
  }

  // 带幺九：每组（和雀头）都含幺九；有顺子才算混全/纯全（没有顺子是混老头/清老头）
  const touches = (g: Grp): boolean => (g.type === 'seq' ? rankOf(g.kind) === 1 || rankOf(g.kind) === 7 : isYaochu(g.kind));
  if (seqs.length > 0 && isYaochu(pair) && groups.every(touches)) {
    const hasHonor = pair >= HONOR0 || sets.some((g) => g.kind >= HONOR0);
    han.push(hasHonor ? y('chanta', menzen ? 2 : 1) : y('junchan', menzen ? 3 : 2));
  }

  if (sets.length === 4) han.push(y('toitoi', 2));

  const concealed = sets.filter((g) => !g.open).length;
  if (concealed === 3) han.push(y('sanankou', 2));
  const kans = sets.filter((g) => g.type === 'kan').length;
  if (kans === 3) han.push(y('sankantsu', 2));

  const dragons = sets.filter((g) => g.kind >= HAKU).length;
  if (dragons === 2 && pair >= HAKU) han.push(y('shousangen', 2));

  // 役满
  if (concealed === 4 && menzen) full.push(ym('suuankou'));
  if (dragons === 3) full.push(ym('daisangen'));
  const winds = sets.filter((g) => g.kind >= EAST && g.kind < HAKU).length;
  if (winds === 4) full.push(ym('daisuushii'));
  else if (winds === 3 && pair >= EAST && pair < HAKU) full.push(ym('shousuushii'));
  if (kans === 4) full.push(ym('suukantsu'));
  if (isChuuren(s)) full.push(ym('chuuren'));

  // 符
  let fu: number;
  if (pinfu) fu = ctx.tsumo ? 20 : 30;
  else {
    fu = 20;
    if (menzen && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    for (const g of sets) {
      // 刻子：明 2 暗 4；杠是刻子的 4 倍；幺九再翻倍
      const one = (g.open ? 2 : 4) * (g.type === 'kan' ? 4 : 1);
      fu += isYaochu(g.kind) ? one * 2 : one;
    }
    if (pair >= HAKU) fu += 2;
    if (pair === seatKind) fu += 2;
    if (pair === roundKind) fu += 2;
    if (wait === 'tanki' || wait === 'kanchan' || wait === 'penchan') fu += 2;
    // 副露的"平和形"荣和只有 20 符，天凤算 30（自摸有 +2，进位后本来就是 30）
    const open = fu === 20 && !menzen && !ctx.tsumo;
    fu = open ? 30 : Math.ceil(fu / 10) * 10;
  }
  return { yaku: han, yakuman: full, fu };
}

/** 九莲宝灯：门清、只有一门、1112345678999 加任意一张 */
function isChuuren(s: Shared): boolean {
  if (!s.menzen) return false;
  const all = s.all;
  for (const b of [0, 9, 18]) {
    let total = 0;
    for (let i = 0; i < 9; i++) total += all[b + i]!;
    if (total !== 14) continue;
    for (let i = 0; i < 9; i++) if (all[b + i]! < (i === 0 || i === 8 ? 3 : 1)) return false;
    return true;
  }
  return false;
}

// ---------- 点数 ----------

const LIMITS = [
  { han: 11, base: 6000, limit: 'sanbaiman' },
  { han: 8, base: 4000, limit: 'baiman' },
  { han: 6, base: 3000, limit: 'haneman' },
] as const;

export interface Pts {
  base: number;
  limit: HandScore['limit'];
}

/** 番和符换基本点（没有役满、累计役满的判断，那在 scoreWin 里）。符 × 2^(番+2)，5 番以上或超过 2000 封满贯，不切上满贯 */
export function basePoints(han: number, fu: number): Pts {
  for (const l of LIMITS) if (han >= l.han) return { base: l.base, limit: l.limit };
  if (han >= 5) return { base: 2000, limit: 'mangan' };
  const raw = fu * (1 << (han + 2));
  return raw >= 2000 ? { base: 2000, limit: 'mangan' } : { base: raw, limit: 'none' };
}

/** 每家要付多少（向上取整到 100，不含本场）。庄家自摸时 dealer 与 other 相同（每家付一样多） */
export function payments(base: number, winnerIsDealer: boolean, tsumo: boolean): { ron: number } | { dealer: number; other: number } {
  const up = (x: number): number => Math.ceil(x / 100) * 100;
  if (!tsumo) return { ron: up(base * (winnerIsDealer ? 6 : 4)) };
  if (winnerIsDealer) {
    const each = up(base * 2);
    return { dealer: each, other: each };
  }
  return { dealer: up(base * 2), other: up(base) };
}

/**
 * 包牌：副露里鸣出第 3 组三元牌（大三元）或第 4 组风牌（大四喜）的那一组，由打出那张的人（from）负责。
 * 暗杠不能算"鸣出"，但它自己仍是已经成形的一组，计入前面凑够的数。按副露先后判断。
 */
export function liability(melds: readonly Meld[]): { seat: number; yaku: 'daisangen' | 'daisuushii' } | null {
  const dragons = new Set<number>();
  const winds = new Set<number>();
  for (const m of melds) {
    if (m.kind === 'chi') continue;
    const k = kindOf(m.tiles[0]!);
    const called = m.kan !== 'concealed' && m.from !== null;
    if (k >= HAKU && k <= CHUN) {
      dragons.add(k);
      if (dragons.size === 3 && called) return { seat: m.from!, yaku: 'daisangen' };
    } else if (k >= EAST && k < HAKU) {
      winds.add(k);
      if (winds.size === 4 && called) return { seat: m.from!, yaku: 'daisuushii' };
    }
  }
  return null;
}

// ---------- 入口 ----------

/** hand = 手里的牌（含和的那张），melds = 副露。没有役（只有宝牌也算没有）返回 null */
export function scoreWin(hand: readonly Tile[], melds: readonly Meld[], ctx: WinContext): HandScore | null {
  const counts = countsOf(hand);
  const all = counts.slice();
  const owned = new Set<Tile>(hand);
  for (const m of melds)
    for (const t of m.tiles) {
      const k = kindOf(t);
      if (k < KINDS) all[k]!++;
      owned.add(t);
    }
  const menzen = melds.every((m) => m.kind === 'kan' && m.kan === 'concealed');
  const shared: Shared = { ctx, menzen, all };
  const w = kindOf(ctx.win);
  const fixed = melds.map(meldGroup);

  const evals: Eval[] = [];
  if (melds.length === 0) {
    if (isKokushi(counts)) evals.push(evalKokushi(shared));
    else if (isSeven(counts, false)) evals.push(evalChiitoi(shared));
  }
  for (const d of decompose(counts, melds.length)) evals.push(...evalDecomp(shared, d, fixed, w));
  if (evals.length === 0) return null;

  const dora = ctx.dora.reduce((n, k) => n + all[k]!, 0);
  const ura = ctx.ura.reduce((n, k) => n + all[k]!, 0);
  let aka = 0;
  for (const t of RED) if (owned.has(t)) aka++;

  let best: HandScore | null = null;
  for (const e of evals) {
    const r = finish(e, dora, aka, ura);
    if (r && (!best || better(r, best))) best = r;
  }
  return best;
}

/** 一种拆法：和牌张可能落在雀头（单骑）或含它的每一种不同的组里，各算一个解 */
function evalDecomp(s: Shared, d: Decomp, fixed: readonly Grp[], w: number): Eval[] {
  const out: Eval[] = [];
  const base: Grp[] = d.groups.map((g) => ({ type: g.type, kind: g.kind, open: false }));
  const make = (at: number): void => {
    const gs = base.map((g, i) => (i === at && g.type === 'pung' && !s.ctx.tsumo ? { ...g, open: true } : g));
    const wait: Wait = at < 0 ? 'tanki' : gs[at]!.type === 'seq' ? seqWait(gs[at]!.kind, w) : 'shanpon';
    out.push(evalGeneral(s, [...fixed, ...gs], d.pair, wait));
  };
  if (d.pair === w) make(-1);
  const seen = new Set<string>();
  d.groups.forEach((g, i) => {
    const has = g.type === 'seq' ? w >= g.kind && w <= g.kind + 2 : g.kind === w;
    const key = `${g.type}${g.kind}`;
    if (!has || seen.has(key)) return;
    seen.add(key);
    make(i);
  });
  return out;
}

function finish(e: Eval, dora: number, aka: number, ura: number): HandScore | null {
  const yakuHan = e.yaku.reduce((n, x) => n + x.han, 0);
  if (e.yakuman.length > 0) {
    const n = e.yakuman.length;
    return { yaku: e.yakuman, yakuman: n, kazoe: false, han: 0, fu: e.fu, dora, aka, ura, base: 8000 * n, limit: 'yakuman' };
  }
  if (e.yaku.length === 0) return null;
  const han = yakuHan + dora + aka + ura;
  if (han >= 13) return { yaku: e.yaku, yakuman: 1, kazoe: true, han, fu: e.fu, dora, aka, ura, base: 8000, limit: 'yakuman' };
  const p = basePoints(han, e.fu);
  return { yaku: e.yaku, yakuman: 0, kazoe: false, han, fu: e.fu, dora, aka, ura, base: p.base, limit: p.limit };
}

const better = (a: HandScore, b: HandScore): boolean =>
  a.base !== b.base ? a.base > b.base : a.han !== b.han ? a.han > b.han : a.fu > b.fu;
