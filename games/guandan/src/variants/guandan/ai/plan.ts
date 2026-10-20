/**
 * 理牌：把手牌拆成若干"手"（组合），让总手数尽量少、零散小牌尽量少。电脑领出、判断跟牌拆不拆牌都靠它。
 *
 * 做法：先留天王炸和 4 张以上的炸弹，再在剩下的点数计数上做小规模搜索，挑哪些顺子 / 三连对 / 钢板（可用逢人配补一张）
 * 拆出来最省手数，余下的按单张、对子、三张（三张带最小的对子）组织。同花顺（含差一张用逢人配补的）单独作为可选的预处理。
 * 逢人配：留在手里算资产（估价为负），用来凑炸弹、同花顺代价小，补顺子代价大；所以理牌、跟牌都不会随手花掉它。
 * 只看点数计数，搜索节点数有上限，27 张手牌也是毫秒以内。
 */
import {
  ACE,
  BIG_JOKER,
  SMALL_JOKER,
  isWild,
  natRank,
  orderValue,
  rankOf,
  suitOf,
  type Card,
  type Play,
  type PlayType,
} from '../core/index.ts';

export interface Group {
  type: PlayType;
  rank: number;
  value: number;
  extra: number;
  cards: Card[];
}

export interface HandPlan {
  groups: Group[];
  /** 估价：手数 + 小牌惩罚 - 控制牌奖励。越小越好。 */
  cost: number;
}

interface Seq {
  type: 'straight' | 'tube' | 'plate';
  top: number;
  need: [number, number][];
}


const SEQS: Seq[] = (() => {
  const out: Seq[] = [];
  for (let top = 5; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 4; r <= top; r++) need.push([natRank(r), 1]);
    out.push({ type: 'straight', top, need });
  }
  for (let top = 3; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 2; r <= top; r++) need.push([natRank(r), 2]);
    out.push({ type: 'tube', top, need });
  }
  for (let top = 2; top <= ACE; top++) out.push({ type: 'plate', top, need: [[natRank(top - 1), 3], [top, 3]] });
  return out;
})();

const MAX_NODES = 600;

/** 余下计数的估价（不含顺子类）：单张、对子、三张，三张带掉最小的对子。 */
function residualCost(cnt: number[], level: number): number {
  let singles = 0;
  let pairs = 0;
  let triples = 0;
  let pen = 0;
  for (let r = 2; r <= ACE; r++) {
    const c = cnt[r]!;
    if (c === 0) continue;
    const v = orderValue(r, level);
    // 小牌更难出手：A 以下按差距给一点惩罚；级牌、王是控制牌，给奖励
    const weak = v >= 15 ? -0.3 : v === ACE ? -0.1 : (13 - v) * 0.02;
    if (c === 1) {
      singles++;
      pen += weak;
    } else if (c === 2) {
      pairs++;
      pen += weak * 0.8;
    } else if (c === 3) {
      triples++;
      pen += weak * 0.5;
    }
  }
  const sj = cnt[SMALL_JOKER]!;
  const bj = cnt[BIG_JOKER]!;
  if (sj === 2) pairs++;
  else if (sj === 1) singles++;
  if (bj === 2) pairs++;
  else if (bj === 1) singles++;
  pen -= 0.4 * (sj + bj);
  const attach = Math.min(triples, pairs);
  return singles + pairs + triples - attach + pen;
}

interface SearchResult {
  cost: number;
  picks: number[];
  wildsUsed: number;
}

function searchSeqs(cnt: number[], wilds: number, level: number): SearchResult {
  let best: SearchResult = { cost: residualCost(cnt, level), picks: [], wildsUsed: 0 };
  let nodes = 0;
  const picks: number[] = [];
  const rec = (from: number, wildLeft: number, seqCount: number): void => {
    for (let i = from; i < SEQS.length; i++) {
      if (nodes >= MAX_NODES) return;
      const sq = SEQS[i]!;
      let deficit = 0;
      let natural = 0;
      for (const [r, n] of sq.need) {
        const have = cnt[r]!;
        if (have < n) deficit += n - have;
        natural += Math.min(have, n);
      }
      // 每手最多用一张逢人配补，避免搜索爆炸；也不为凑顺子把逢人配全用掉
      if (deficit > 1 || deficit > wildLeft || natural < 3) continue;
      nodes++;
      const taken: number[] = [];
      for (const [r, n] of sq.need) {
        const t = Math.min(cnt[r]!, n);
        cnt[r] = cnt[r]! - t;
        taken.push(t);
      }
      picks.push(i);
      // 顺子类一手出 5–6 张，算 0.9 手：同样手数时更愿意组成顺子
      const cost = residualCost(cnt, level) + (seqCount + 1) * 0.9 + (wilds - wildLeft + deficit) * 0.6;
      if (cost < best.cost - 1e-9) best = { cost, picks: [...picks], wildsUsed: wilds - wildLeft + deficit };
      rec(i, wildLeft - deficit, seqCount + 1);
      picks.pop();
      sq.need.forEach(([r], k) => {
        cnt[r] = cnt[r]! + taken[k]!;
      });
    }
  };
  rec(0, wilds, 0);
  return best;
}

/**
 * 手里能组成的同花顺：先列全天然的，再列差一张、可以用逢人配补的（有逢人配时）。
 * 同一花色同一段只取一种；数量有上限，控制理牌耗时。
 */
function straightFlushCands(hand: readonly Card[], level: number, wilds: number): Sf[] {
  const has = [0, 1, 2, 3].map(() => new Array<boolean>(15).fill(false));
  for (const c of hand) {
    if (isWild(c, level)) continue;
    const s = suitOf(c);
    if (s >= 0) has[s]![rankOf(c)] = true;
  }
  const natural: Sf[] = [];
  const withWild: Sf[] = [];
  for (let s = 0; s < 4; s++) {
    for (let top = 5; top <= ACE; top++) {
      let miss = 0;
      for (let r = top - 4; r <= top; r++) if (!has[s]![natRank(r)]) miss++;
      if (miss === 0) natural.push({ suit: s, top, wild: 0 });
      else if (miss === 1 && wilds > 0) withWild.push({ suit: s, top, wild: 1 });
    }
  }
  return [...natural.slice(0, 4), ...withWild.slice(-3)];
}

interface Sf {
  suit: number;
  top: number;
  wild: number;
}

class Buckets {
  private byRank: Card[][] = [];
  wilds: Card[] = [];
  constructor(hand: readonly Card[], level: number) {
    for (let i = 0; i < 18; i++) this.byRank.push([]);
    for (const c of hand) {
      if (isWild(c, level)) this.wilds.push(c);
      else this.byRank[rankOf(c)]!.push(c);
    }
  }
  take(rank: number, n: number, suit = -1): Card[] {
    const b = this.byRank[rank]!;
    const out: Card[] = [];
    for (let i = b.length - 1; i >= 0 && out.length < n; i--) {
      if (suit >= 0 && suitOf(b[i]!) !== suit) continue;
      out.push(b[i]!);
      b.splice(i, 1);
    }
    return out;
  }
  count(rank: number): number {
    return this.byRank[rank]!.length;
  }
  takeWild(): Card {
    return this.wilds.pop()!;
  }
}

/**
 * 估价常数（越小越好，大致等于"还要几手才能出完"）：
 * - 炸弹不算手数，还能抢回出牌权，给负值；
 * - 留在手里的逢人配是万能牌，给负值；用掉它（补顺子、凑炸弹）要付代价——这样跟牌和提示都不会随手用掉逢人配。
 */
const BOMB_COST = (n: number) => -0.35 - (n - 4) * 0.1;
const SF_COST = -0.6;
const JOKER_BOMB_COST = -1;
const WILD_KEEP = -0.45;
/** 用逢人配把三张凑成炸弹：几乎不算代价（这正是逢人配该用的地方；模拟里和 0.15 强度相当，选更像人的） */
const WILD_TO_BOMB = -0.2;
/** 用逢人配补同花顺 */
const WILD_TO_SF = 0.15;

function planWith(hand: readonly Card[], level: number, sf: Sf | null): HandPlan {
  const b = new Buckets(hand, level);
  const groups: Group[] = [];
  let cost = 0;
  if (sf) {
    const cards: Card[] = [];
    for (let r = sf.top - 4; r <= sf.top; r++) {
      const got = b.take(natRank(r), 1, sf.suit);
      if (got.length) cards.push(...got);
      else if (b.wilds.length) cards.push(b.takeWild());
    }
    if (cards.length < 5) return { groups: [], cost: Infinity };
    groups.push({ type: 'straightFlush', rank: sf.top, value: sf.top, extra: sf.suit, cards });
    cost += SF_COST + sf.wild * WILD_TO_SF;
  }
  if (b.count(SMALL_JOKER) === 2 && b.count(BIG_JOKER) === 2) {
    groups.push({ type: 'jokerBomb', rank: BIG_JOKER, value: BIG_JOKER, extra: -1, cards: [...b.take(SMALL_JOKER, 2), ...b.take(BIG_JOKER, 2)] });
    cost += JOKER_BOMB_COST;
  }
  for (let r = 2; r <= ACE; r++) {
    const n = b.count(r);
    if (n >= 4) {
      groups.push({ type: 'bomb', rank: r, value: orderValue(r, level), extra: -1, cards: b.take(r, n) });
      cost += BOMB_COST(n);
    }
  }
  // 逢人配凑炸弹：试"不凑"、凑最小的三张、凑最大的三张、（两张逢人配）凑两个最小的三张
  const cnt = new Array<number>(18).fill(0);
  for (let r = 2; r <= BIG_JOKER; r++) cnt[r] = b.count(r);
  const wilds = b.wilds.length;
  const options: number[][] = [[]];
  if (wilds > 0) {
    const trip: number[] = [];
    for (let r = 2; r <= ACE; r++) if (cnt[r] === 3) trip.push(r);
    trip.sort((x, y) => orderValue(x, level) - orderValue(y, level));
    if (trip.length) options.push([trip[0]!]);
    if (trip.length > 1) options.push([trip[trip.length - 1]!]);
    if (wilds > 1 && trip.length > 1) options.push([trip[0]!, trip[1]!]);
  }
  let best: { found: SearchResult; up: number[]; total: number } | null = null;
  for (const up of options) {
    for (const r of up) cnt[r] = 0;
    const found = searchSeqs(cnt, wilds - up.length, level);
    for (const r of up) cnt[r] = 3;
    const left = wilds - up.length - found.wildsUsed;
    let total = found.cost + left * WILD_KEEP;
    for (const _r of up) total += BOMB_COST(4) + WILD_TO_BOMB;
    if (!best || total < best.total - 1e-9) best = { found, up, total };
  }
  const { found, up } = best!;
  cost += best!.total;
  for (const r of up) {
    groups.push({ type: 'bomb', rank: r, value: orderValue(r, level), extra: -1, cards: [...b.take(r, 3), b.takeWild()] });
  }
  for (const i of found.picks) {
    const sq = SEQS[i]!;
    const cards: Card[] = [];
    for (const [r, n] of sq.need) {
      const got = b.take(r, n);
      cards.push(...got);
      for (let k = got.length; k < n; k++) cards.push(b.takeWild());
    }
    groups.push({ type: sq.type, rank: sq.top, value: sq.top, extra: -1, cards });
  }
  // 余下：三张、对子、单张；三张带最小的对子
  const triples: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 2; r <= BIG_JOKER; r++) {
    const n = b.count(r);
    if (n === 3) triples.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }
  const byVal = (x: number, y: number) => orderValue(x, level) - orderValue(y, level);
  triples.sort(byVal);
  pairs.sort(byVal);
  for (const r of triples) {
    const p = pairs.find((x) => x < SMALL_JOKER && orderValue(x, level) < 15);
    const cards = b.take(r, 3);
    if (p !== undefined) {
      pairs.splice(pairs.indexOf(p), 1);
      groups.push({ type: 'fullHouse', rank: r, value: orderValue(r, level), extra: p, cards: [...cards, ...b.take(p, 2)] });
    } else {
      groups.push({ type: 'triple', rank: r, value: orderValue(r, level), extra: -1, cards });
    }
  }
  for (const r of pairs) groups.push({ type: 'pair', rank: r, value: orderValue(r, level), extra: -1, cards: b.take(r, 2) });
  for (const r of singles) groups.push({ type: 'single', rank: r, value: orderValue(r, level), extra: -1, cards: b.take(r, 1) });
  // 剩下的逢人配当级牌用：两张成对，一张当单张（出牌时排在最后，作为控制牌）
  const w = b.wilds.length;
  if (w === 2) groups.push({ type: 'pair', rank: level, value: 15, extra: -1, cards: [b.takeWild(), b.takeWild()] });
  else if (w === 1) groups.push({ type: 'single', rank: level, value: 15, extra: -1, cards: [b.takeWild()] });
  return { groups, cost };
}

export function isBombType(t: PlayType): boolean {
  return t === 'bomb' || t === 'straightFlush' || t === 'jokerBomb';
}

/** 理出最省的拆法。 */
export function planHand(hand: readonly Card[], level: number): HandPlan {
  let best = planWith(hand, level, null);
  let wilds = 0;
  for (const c of hand) if (isWild(c, level)) wilds++;
  for (const sf of straightFlushCands(hand, level, wilds)) {
    const p = planWith(hand, level, sf);
    if (p.cost < best.cost - 1e-9) best = p;
  }
  return best;
}

export function groupToPlay(g: Group): Play {
  return { type: g.type, rank: g.rank, value: g.value, extra: g.extra, cards: [...g.cards] };
}
