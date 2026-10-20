/**
 * 理牌：把手牌拆成若干"手"（组合），让总手数尽量少、零散小牌尽量少。电脑领出、判断跟牌拆不拆牌都靠它。
 *
 * 做法：先留天王炸和 4 张以上的炸弹，再在剩下的点数计数上做小规模搜索，挑哪些顺子 / 三连对 / 钢板（可用逢人配补一张）
 * 拆出来最省手数，余下的按单张、对子、三张（三张带最小的对子）组织。同花顺单独作为一种可选的预处理。
 * 只看点数计数，搜索节点数有上限，27 张手牌也是毫秒以内。
 */
import {
  ACE,
  BIG_JOKER,
  SMALL_JOKER,
  isWild,
  orderValue,
  rankOf,
  suitOf,
  type Card,
  type Play,
  type PlayType,
} from '../../src/variants/guandan/core/index.ts';

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

const nat = (r: number) => (r === 1 ? ACE : r);

const SEQS: Seq[] = (() => {
  const out: Seq[] = [];
  for (let top = 5; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 4; r <= top; r++) need.push([nat(r), 1]);
    out.push({ type: 'straight', top, need });
  }
  for (let top = 3; top <= ACE; top++) {
    const need: [number, number][] = [];
    for (let r = top - 2; r <= top; r++) need.push([nat(r), 2]);
    out.push({ type: 'tube', top, need });
  }
  for (let top = 2; top <= ACE; top++) out.push({ type: 'plate', top, need: [[nat(top - 1), 3], [top, 3]] });
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

/** 手里能组成的全天然同花顺（不用逢人配），按花色、最大张。 */
function naturalStraightFlushes(hand: readonly Card[], level: number): { suit: number; top: number }[] {
  const has = [0, 1, 2, 3].map(() => new Array<boolean>(15).fill(false));
  for (const c of hand) {
    if (isWild(c, level)) continue;
    const s = suitOf(c);
    if (s >= 0) has[s]![rankOf(c)] = true;
  }
  const out: { suit: number; top: number }[] = [];
  for (let s = 0; s < 4; s++) {
    for (let top = 5; top <= ACE; top++) {
      let ok = true;
      for (let r = top - 4; r <= top && ok; r++) ok = has[s]![nat(r)]!;
      if (ok) out.push({ suit: s, top });
    }
  }
  return out;
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

function planWith(hand: readonly Card[], level: number, sf: { suit: number; top: number } | null): HandPlan {
  const b = new Buckets(hand, level);
  const groups: Group[] = [];
  let bonus = 0;
  if (sf) {
    const cards: Card[] = [];
    for (let r = sf.top - 4; r <= sf.top; r++) cards.push(...b.take(nat(r), 1, sf.suit));
    groups.push({ type: 'straightFlush', rank: sf.top, value: sf.top, extra: sf.suit, cards });
    bonus += 1.6;
  }
  if (b.count(SMALL_JOKER) === 2 && b.count(BIG_JOKER) === 2) {
    groups.push({ type: 'jokerBomb', rank: BIG_JOKER, value: BIG_JOKER, extra: -1, cards: [...b.take(SMALL_JOKER, 2), ...b.take(BIG_JOKER, 2)] });
    bonus += 2;
  }
  for (let r = 2; r <= ACE; r++) {
    const n = b.count(r);
    if (n >= 4) {
      groups.push({ type: 'bomb', rank: r, value: orderValue(r, level), extra: -1, cards: b.take(r, n) });
      bonus += 1 + (n - 4) * 0.15;
    }
  }
  const cnt = new Array<number>(18).fill(0);
  for (let r = 2; r <= BIG_JOKER; r++) cnt[r] = b.count(r);
  const found = searchSeqs(cnt, b.wilds.length, level);
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
  // 剩下的逢人配当级牌用：两张成对，一张当单张
  const w = b.wilds.length;
  if (w === 2) groups.push({ type: 'pair', rank: level, value: 15, extra: -1, cards: [b.takeWild(), b.takeWild()] });
  else if (w === 1) groups.push({ type: 'single', rank: level, value: 15, extra: -1, cards: [b.takeWild()] });
  const leftWildCost = w === 0 ? 0 : 0.5;
  return { groups, cost: found.cost + leftWildCost - bonus + groups.filter((g) => isBombType(g.type)).length };
}

export function isBombType(t: PlayType): boolean {
  return t === 'bomb' || t === 'straightFlush' || t === 'jokerBomb';
}

/** 理出最省的拆法。 */
export function planHand(hand: readonly Card[], level: number): HandPlan {
  let best = planWith(hand, level, null);
  const sfs = naturalStraightFlushes(hand, level);
  for (const sf of sfs.slice(0, 4)) {
    const p = planWith(hand, level, sf);
    if (p.cost < best.cost - 1e-9) best = p;
  }
  return best;
}

/** 只要估价（跟牌时评估拆牌代价用）。 */
export function planCost(hand: readonly Card[], level: number): number {
  return planHand(hand, level).cost;
}

export function groupToPlay(g: Group): Play {
  return { type: g.type, rank: g.rank, value: g.value, extra: g.extra, cards: [...g.cards] };
}
