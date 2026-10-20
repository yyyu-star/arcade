/** 手牌分列（纯函数，不依赖 Phaser，单元测试直接测）。一列超过 maxCol 张（默认 5）拆成相邻两列，保证手机上每张都点得到。 */
import { planHand } from '../../variants/guandan/ai/index.ts';
import { cardValue, isWild, sortHand, suitOf, type Card, type PlayType } from '../../variants/guandan/core/index.ts';

export type SortMode = 'rank' | 'type';

export const MAX_COL = 5;

const TYPE_ORDER: Record<PlayType, number> = {
  jokerBomb: 0, bomb: 1, straightFlush: 2, plate: 3, tube: 4, straight: 5, fullHouse: 6, triple: 7, pair: 8, single: 9,
};

function splitCol(col: Card[], maxCol: number): Card[][] {
  if (col.length <= maxCol) return [col];
  const half = Math.ceil(col.length / 2);
  return [col.slice(0, half), col.slice(half)];
}

/** 分列（纯函数，测试也用）：每列从上到下的牌。 */
export function columnsFor(hand: readonly Card[], level: number, mode: SortMode, maxCol = MAX_COL): Card[][] {
  const sorted = sortHand(hand, level);
  if (mode === 'type') {
    const plan = planHand(sorted, level);
    const used = new Set<Card>();
    const groups = [...plan.groups].sort(
      (a, b) =>
        TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.cards.length - a.cards.length || b.value - a.value,
    );
    const cols: Card[][] = [];
    for (const g of groups) {
      const cards = g.cards.filter((c) => !used.has(c));
      cards.forEach((c) => used.add(c));
      if (cards.length) cols.push(...splitCol(cards, maxCol));
    }
    // 理牌没覆盖到的牌（理论上没有）按点数补在最后
    const rest = sorted.filter((c) => !used.has(c));
    if (rest.length) cols.push(...columnsFor(rest, level, 'rank', maxCol));
    return cols;
  }
  const byKey = new Map<number, Card[]>();
  for (const c of sorted) {
    const k = isWild(c, level) ? 15.5 : cardValue(c, level);
    const list = byKey.get(k) ?? [];
    list.push(c);
    byKey.set(k, list);
  }
  const keys = [...byKey.keys()].sort((a, b) => b - a);
  const cols: Card[][] = [];
  for (const k of keys) {
    const col = byKey.get(k)!.sort((a, b) => suitOf(a) - suitOf(b));
    cols.push(...splitCol(col, maxCol));
  }
  return cols;
}

