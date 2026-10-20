/**
 * 记牌器：这一副每种点数还有几张没露面（全场 108 张，减去我手里的、减去已经出过的）。
 * 只用公开信息（出过的牌）和自己的手牌，房间和单机给的视图里都有；贡牌从一家到另一家不算露面。
 */
import { BIG_JOKER, SMALL_JOKER, rankOf, type Card } from '../variants/guandan/core/cards.ts';
import type { PlayRecord } from '../variants/guandan/core/index.ts';

export interface CounterCell {
  /** 点数：2..14，小王 16，大王 17 */
  rank: number;
  /** 还没露面的张数 */
  left: number;
}

/** 从大到小：大王、小王、A、K……2（级牌留在自己的位置上，画的时候标红） */
const ORDER = [BIG_JOKER, SMALL_JOKER, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export function countLeft(hand: readonly Card[], history: readonly PlayRecord[]): CounterCell[] {
  const left = new Map<number, number>(ORDER.map((r) => [r, r >= SMALL_JOKER ? 2 : 8]));
  const take = (c: Card): void => {
    const r = rankOf(c);
    left.set(r, (left.get(r) ?? 0) - 1);
  };
  hand.forEach(take);
  for (const h of history) h.play?.cards.forEach(take);
  return ORDER.map((rank) => ({ rank, left: Math.max(0, left.get(rank) ?? 0) }));
}
