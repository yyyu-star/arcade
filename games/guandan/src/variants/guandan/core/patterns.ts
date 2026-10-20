/**
 * 牌型：识别（含逢人配的所有解释）、比大小、从手牌枚举出法。
 *
 * 做法：先按当前级数生成全部"牌型模板"（某牌型 + 每个点数要几张，约 400 个），
 * 识别 = 找出与所选牌恰好吻合的模板（缺的张数正好由逢人配补齐），
 * 枚举 = 找出手牌能凑出的模板（缺的张数 ≤ 手里的逢人配）。
 * 模板数固定，所以 27 张手牌加两张逢人配也只是几百次计数比较。
 */
import { ACE, BIG_JOKER, SMALL_JOKER, isWild, natRank, orderValue, rankOf, suitOf, type Card } from './cards.ts';
import type { Options } from './options.ts';
import type { PatternSet } from '../../../core/play.ts';

export type PlayType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'fullHouse'
  | 'straight'
  | 'tube'
  | 'plate'
  | 'bomb'
  | 'straightFlush'
  | 'jokerBomb';

/** 一手牌（某种解释下）。全部是普通数据，可以直接序列化。 */
export interface Play {
  type: PlayType;
  /** 主点数：单张类是那一点（王 16/17）；顺子类是最大那张的本位点数（A2345 记 5，10JQKA 记 14）。 */
  rank: number;
  /** 同牌型内比大小用的值：单张类用牌序（级牌 15），顺子类等于 rank。 */
  value: number;
  /** 三带二里那一对的点数；同花顺的花色。其余为 -1。 */
  extra: number;
  cards: Card[];
}

export const PLAY_TYPE_NAMES: Record<PlayType, string> = {
  single: '单张',
  pair: '对子',
  triple: '三同张',
  fullHouse: '三带二',
  straight: '顺子',
  tube: '三连对',
  plate: '钢板',
  bomb: '炸弹',
  straightFlush: '同花顺',
  jokerBomb: '天王炸',
};

interface Template {
  type: PlayType;
  rank: number;
  value: number;
  extra: number;
  size: number;
  /** [点数, 张数]；王也在这里（16/17） */
  need: [number, number][];
  /** 同花顺限定的花色，其他为 -1 */
  suit: number;
  /** 全部由逢人配组成时也成立（只有级牌的单张、对子） */
  allWildOk: boolean;
}


function buildTemplates(level: number, opts: Options): Template[] {
  const out: Template[] = [];
  const t = (type: PlayType, rank: number, value: number, need: [number, number][], extra = -1, suit = -1): void => {
    let size = 0;
    for (const [, n] of need) size += n;
    out.push({ type, rank, value, extra, size, need, suit, allWildOk: (type === 'single' || type === 'pair') && rank === level });
  };
  const ranks: number[] = [];
  for (let r = 2; r <= ACE; r++) ranks.push(r);
  const allRanks = [...ranks, SMALL_JOKER, BIG_JOKER];

  for (const r of allRanks) t('single', r, orderValue(r, level), [[r, 1]]);
  for (const r of allRanks) t('pair', r, orderValue(r, level), [[r, 2]]);
  for (const r of ranks) t('triple', r, orderValue(r, level), [[r, 3]]);
  const pairRanks = opts.fullHouseJokerPair ? allRanks : ranks;
  for (const r of ranks) {
    for (const p of pairRanks) {
      if (p !== r) t('fullHouse', r, orderValue(r, level), [[r, 3], [p, 2]], p);
    }
  }
  // 顺子 5 张，最大张从 5（A2345）到 A（10JQKA）；不绕圈
  for (let top = 5; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 4; r <= top; r++) need.push([natRank(r), 1]);
    t('straight', top, top, need);
  }
  // 三连对 3 对，AA2233 到 QQKKAA
  for (let top = 3; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 2; r <= top; r++) need.push([natRank(r), 2]);
    t('tube', top, top, need);
  }
  // 钢板 2 个三张，AAA222 到 KKKAAA
  for (let top = 2; top <= ACE; top++) {
    t('plate', top, top, [[natRank(top - 1), 3], [top, 3]]);
  }
  for (const r of ranks) {
    for (let n = 4; n <= opts.maxBombSize; n++) t('bomb', r, orderValue(r, level), [[r, n]]);
  }
  for (let s = 0; s < 4; s++) {
    for (let top = 5; top <= ACE; top++) {
      const need: [number, number][] = [];
      for (let r = top - 4; r <= top; r++) need.push([natRank(r), 1]);
      t('straightFlush', top, top, need, s, s);
    }
  }
  t('jokerBomb', BIG_JOKER, BIG_JOKER, [[SMALL_JOKER, 2], [BIG_JOKER, 2]]);
  return out;
}

const templateCache = new Map<string, Template[]>();

function templates(level: number, opts: Options): Template[] {
  const key = `${level}|${opts.fullHouseJokerPair ? 1 : 0}|${opts.maxBombSize}`;
  let list = templateCache.get(key);
  if (!list) {
    list = buildTemplates(level, opts);
    templateCache.set(key, list);
  }
  return list;
}

/** 一组牌的计数：非逢人配的牌按点数（含王）、按花色 × 点数分别计数，逢人配单独计。 */
interface Counts {
  byRank: number[]; // 下标 0..17
  bySuit: number[][]; // [花色][点数]
  wild: number;
  total: number;
  /** 非逢人配的牌，按点数分桶（同花顺按花色再挑） */
  cards: Card[][];
  wildCards: Card[];
}

function countCards(cards: readonly Card[], level: number): Counts {
  const byRank = new Array<number>(18).fill(0);
  const bySuit = [0, 1, 2, 3].map(() => new Array<number>(18).fill(0));
  const buckets: Card[][] = [];
  for (let i = 0; i < 18; i++) buckets.push([]);
  const wildCards: Card[] = [];
  for (const c of cards) {
    if (isWild(c, level)) {
      wildCards.push(c);
      continue;
    }
    const r = rankOf(c);
    byRank[r]!++;
    const s = suitOf(c);
    if (s >= 0) bySuit[s]![r]!++;
    buckets[r]!.push(c);
  }
  return { byRank, bySuit, wild: wildCards.length, total: cards.length, cards: buckets, wildCards };
}

/** 模板与这组牌恰好吻合（逢人配正好补齐缺口）。 */
function matchesExactly(tp: Template, cnt: Counts): boolean {
  if (tp.size !== cnt.total) return false;
  const natural = cnt.total - cnt.wild;
  if (natural === 0 && !tp.allWildOk) return false;
  let deficit = 0;
  let covered = 0;
  for (const [r, n] of tp.need) {
    const have = tp.suit >= 0 ? cnt.bySuit[tp.suit]![r]! : cnt.byRank[r]!;
    if (have > n) return false;
    if (r >= SMALL_JOKER && have < n) return false; // 逢人配不能当王
    deficit += n - have;
    covered += have;
  }
  // 所有非逢人配的牌都必须落在模板里（同花顺还要求同一花色）
  return covered === natural && deficit === cnt.wild;
}

function toPlay(tp: Template, cards: Card[]): Play {
  return { type: tp.type, rank: tp.rank, value: tp.value, extra: tp.extra, cards };
}

/** 这组牌的全部合法解释（可能为空）。顺序：炸弹类在后，同类按大小升序。 */
export function interpret(cards: readonly Card[], level: number, opts: Options): Play[] {
  if (cards.length === 0) return [];
  const cnt = countCards(cards, level);
  const out: Play[] = [];
  for (const tp of templates(level, opts)) {
    if (matchesExactly(tp, cnt)) out.push(toPlay(tp, [...cards]));
  }
  return out;
}

/** 炸弹档位：0 = 非炸弹。4 张 < 5 张 < 同花顺 < 6 张 < … < 10 张 < 天王炸。 */
export function bombTier(p: Pick<Play, 'type' | 'cards'>): number {
  switch (p.type) {
    case 'bomb':
      return p.cards.length * 10;
    case 'straightFlush':
      return 55;
    case 'jokerBomb':
      return 1000;
    default:
      return 0;
  }
}

export function isBomb(p: Pick<Play, 'type'>): boolean {
  return p.type === 'bomb' || p.type === 'straightFlush' || p.type === 'jokerBomb';
}

/** a 能否压过 b。 */
export function beats(a: Play, b: Play): boolean {
  const ta = bombTier(a);
  const tb = bombTier(b);
  if (ta > 0 || tb > 0) {
    if (ta !== tb) return ta > tb;
    return a.value > b.value;
  }
  return a.type === b.type && a.cards.length === b.cards.length && a.value > b.value;
}

/**
 * 从手牌里按模板挑出具体的牌：缺口用逢人配补，能用本牌就不用逢人配。
 * 同点有多张时先拿"不在同花顺里"的花色——简单做法：优先拿该点数张数最多的花色之外的牌并不划算，
 * 这里按手牌顺序取，保持确定性。
 */
function pickCards(tp: Template, cnt: Counts): Card[] | null {
  let deficit = 0;
  for (const [r, n] of tp.need) {
    const have = tp.suit >= 0 ? cnt.bySuit[tp.suit]![r]! : cnt.byRank[r]!;
    if (r >= SMALL_JOKER && have < n) return null;
    if (have < n) deficit += n - have;
  }
  if (deficit > cnt.wild) return null;
  let naturalUsed = 0;
  const out: Card[] = [];
  for (const [r, n] of tp.need) {
    const bucket = cnt.cards[r]!;
    let took = 0;
    for (const c of bucket) {
      if (took >= n) break;
      if (tp.suit >= 0 && suitOf(c) !== tp.suit) continue;
      out.push(c);
      took++;
    }
    naturalUsed += took;
  }
  if (naturalUsed === 0 && !tp.allWildOk) return null;
  for (let i = 0; i < deficit; i++) out.push(cnt.wildCards[i]!);
  return out;
}

/** 手牌能出的全部出法（每个"牌型 + 点数（+ 带的对子/花色）"取一种用逢人配最少的具体组合）。 */
export function enumeratePlays(hand: readonly Card[], level: number, opts: Options): Play[] {
  const cnt = countCards(hand, level);
  const out: Play[] = [];
  for (const tp of templates(level, opts)) {
    if (tp.size > hand.length) continue;
    const cards = pickCards(tp, cnt);
    if (cards) out.push(toPlay(tp, cards));
  }
  return out;
}

/** 能压过 target 的全部出法；target 为空表示自己领出，返回全部出法。 */
export function playsBeating(hand: readonly Card[], target: Play | null, level: number, opts: Options): Play[] {
  const all = enumeratePlays(hand, level, opts);
  return target ? all.filter((p) => beats(p, target)) : all;
}

/**
 * 同一组牌有多种解释时自动挑一种：跟牌时挑能压过的里面最小的（优先非炸弹），领出时挑最强的。
 */
export function chooseInterpretation(options: readonly Play[], target: Play | null): Play | null {
  const ok = target ? options.filter((p) => beats(p, target)) : [...options];
  if (ok.length === 0) return null;
  const strength = (p: Play) => bombTier(p) * 100 + p.value;
  ok.sort((a, b) => strength(a) - strength(b));
  return target ? ok[0]! : ok[ok.length - 1]!;
}

/** 两手是否同一种解释（牌型、点数、附带点数/花色都相同）。 */
export function samePlayShape(a: Pick<Play, 'type' | 'rank' | 'extra'>, b: Pick<Play, 'type' | 'rank' | 'extra'>): boolean {
  return a.type === b.type && a.rank === b.rank && a.extra === b.extra;
}

/**
 * 掼蛋的牌型按通用层的 PatternSet 包一层（牌馆重构 ①b，docs/doudizhu.md 1.1）：识别要级牌和规则开关；函数本身就是上面这些，行为不变
 */
export const guandanPatterns: PatternSet<Play, { level: number; opts: Options }> = {
  interpret: (cards, c) => interpret(cards, c.level, c.opts),
  beats,
  isBomb,
  choose: chooseInterpretation,
  enumerate: (hand, c) => enumeratePlays(hand, c.level, c.opts),
};
