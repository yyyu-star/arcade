/**
 * 斗地主电脑的拆牌（docs/ai.md「斗地主」）：把手牌拆成"手数"最少的几组。
 * 先定炸弹和王炸（不拆），其余从最小的点数起一个个试：飞机、连对、顺子、三张、对子、单张，
 * 深搜找手数最少的拆法（节点数封顶，封顶越大拆得越准：新手 1 = 贪心，普通几百，高手几千）。
 * 手数 = 组数 − 三张 / 飞机能带走的单张和对子（带走的算进同一手，不重复计）。
 */
import type { Card } from '../../../core/cards.ts';
import { BIG_JOKER, SMALL_JOKER } from '../../../core/cards.ts';
import { type DdzPlay, type DdzType, ddzValue, interpretDdz, sortDdz } from '../core/index.ts';

export interface Group {
  type: DdzType;
  /** 主体最小点数 */
  v: number;
  /** 主体长度（顺子几张、连对几对、飞机几个三张） */
  len: number;
  cards: Card[];
}

export interface Plan {
  groups: Group[];
  /** 手数（三张、飞机已带走单张 / 对子） */
  hands: number;
  /** 手数 × 100 + 带不走的单张的罚分，越小越好 */
  score: number;
}

const MAX_RUN = 14; // 顺子类最大到 A

function evaluate(groups: readonly Group[]): { hands: number; score: number } {
  let absorbers = 0;
  let smalls = 0;
  let singles = 0;
  for (const g of groups) {
    if (g.type === 'triple') absorbers += 1;
    else if (g.type === 'plane') absorbers += g.len;
    else if (g.type === 'single') {
      smalls++;
      singles++;
    } else if (g.type === 'pair') smalls++;
  }
  const absorbed = Math.min(absorbers, smalls);
  const hands = groups.length - absorbed;
  return { hands, score: hands * 100 + Math.max(0, singles - absorbed) * 3 };
}

const cache = new Map<string, Plan>();

/** 拆牌；同一手牌同一封顶的结果缓存（纯函数，缓存不影响结果） */
export function planHand(hand: readonly Card[], nodeCap: number): Plan {
  const sorted = sortDdz(hand);
  const key = `${nodeCap}:${sorted.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const plan = search(sorted, nodeCap);
  if (cache.size > 20000) cache.clear();
  cache.set(key, plan);
  return plan;
}

function search(sorted: readonly Card[], nodeCap: number): Plan {
  const byV = new Map<number, Card[]>();
  for (const c of sorted) {
    const v = ddzValue(c);
    if (!byV.has(v)) byV.set(v, []);
    byV.get(v)!.push(c);
  }
  const cnt: number[] = new Array(18).fill(0);
  for (const [v, cs] of byV) cnt[v] = cs.length;
  const fixed: Group[] = [];
  if (cnt[SMALL_JOKER]! > 0 && cnt[BIG_JOKER]! > 0) {
    fixed.push({ type: 'rocket', v: BIG_JOKER, len: 1, cards: [byV.get(SMALL_JOKER)![0]!, byV.get(BIG_JOKER)![0]!] });
    cnt[SMALL_JOKER] = 0;
    cnt[BIG_JOKER] = 0;
  }
  for (let v = 3; v <= 15; v++) {
    if (cnt[v] === 4) {
      fixed.push({ type: 'bomb', v, len: 1, cards: byV.get(v)!.slice() });
      cnt[v] = 0;
    }
  }
  // 取走 v 点数的 k 张（从还剩的牌里取最后 k 张，同点数的牌可以互换）
  const grab = (v: number, k: number): Card[] => {
    cnt[v] = cnt[v]! - k;
    return byV.get(v)!.slice(cnt[v], cnt[v]! + k);
  };
  const put = (v: number, k: number): void => {
    cnt[v] = cnt[v]! + k;
  };
  let nodes = 0;
  let best: { groups: Group[]; hands: number; score: number } | null = null;
  const groups: Group[] = [...fixed];

  const dfs = (): void => {
    nodes++;
    if (best && nodes > nodeCap) return;
    let v = 3;
    while (v <= BIG_JOKER && cnt[v] === 0) v++;
    if (v > BIG_JOKER) {
      const e = evaluate(groups);
      if (!best || e.score < best.score) best = { groups: groups.slice(), ...e };
      return;
    }
    const c = cnt[v]!;
    // 连着的长度：每个点数至少 need 张，到 A 为止
    const run = (need: number): number => {
      let l = 0;
      while (v + l <= MAX_RUN && cnt[v + l]! >= need) l++;
      return l;
    };
    const take = (type: DdzType, len: number, per: number): void => {
      const cards: Card[] = [];
      for (let i = 0; i < len; i++) cards.push(...grab(v + i, per));
      groups.push({ type, v, len, cards });
      dfs();
      groups.pop();
      for (let i = 0; i < len; i++) put(v + i, per);
    };
    for (let l = run(3); l >= 2; l--) take('plane', l, 3);
    for (let l = run(2); l >= 3; l--) take('pairs', l, 2);
    for (let l = run(1); l >= 5; l--) take('straight', l, 1);
    if (c >= 3) take('triple', 1, 3);
    if (c >= 2) take('pair', 1, 2);
    take('single', 1, 1);
  };
  dfs();
  const b = best!;
  return { groups: b.groups, hands: b.hands, score: b.score };
}

/** 手数（炸弹、王炸各算一手）。拆法的封顶默认取"普通"那档 */
export function handCount(hand: readonly Card[], nodeCap = 250): number {
  return hand.length === 0 ? 0 : planHand(hand, nodeCap).hands;
}

/**
 * 按拆法列出"领出"的候选：每一组一个；三张带上最小的一个单张（没有就带最小的对子），飞机带上最小的几个单张（或几个对子）。
 * 带牌只取不超过 A 的，2 和王留着自己当大牌。
 */
export function leadPlays(plan: Plan): DdzPlay[] {
  const singles = plan.groups.filter((g) => g.type === 'single' && g.v <= 14).sort((a, b) => a.v - b.v);
  const pairs = plan.groups.filter((g) => g.type === 'pair' && g.v <= 14).sort((a, b) => a.v - b.v);
  const out: DdzPlay[] = [];
  const add = (cards: Card[]): void => {
    const p = interpretDdz(cards)[0];
    if (p) out.push(p);
  };
  for (const g of plan.groups) {
    add(g.cards);
    if (g.type === 'triple' || g.type === 'plane') {
      const k = g.type === 'plane' ? g.len : 1;
      if (singles.length >= k) add([...g.cards, ...singles.slice(0, k).flatMap((x) => x.cards)]);
      else if (pairs.length >= k) add([...g.cards, ...pairs.slice(0, k).flatMap((x) => x.cards)]);
    }
  }
  return out;
}
