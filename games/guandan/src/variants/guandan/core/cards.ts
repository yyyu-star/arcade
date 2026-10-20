/**
 * 掼蛋的牌：两副 108 张、每人 27 张，级牌和逢人配的牌序、理牌。
 * 牌的编码在通用层 core/cards.ts（牌馆重构 ①b，docs/doudizhu.md 1.1），这里原样再导出，掼蛋各处照旧从这里取。
 */
export * from '../../../core/cards.ts';
import { HEART, rankOf, suitOf, type Card } from '../../../core/cards.ts';

const DECK_SIZE = 108;
export const HAND_SIZE = 27;

/** 逢人配：红桃级牌（两副牌共两张）。 */
export function isWild(c: Card, level: number): boolean {
  return suitOf(c) === HEART && rankOf(c) === level;
}

/**
 * 单张类牌序（单张、对子、三张、三带二、炸弹用）：级牌排在 A 之上记 15，王 16/17，其余按点数。
 */
export function orderValue(rank: number, level: number): number {
  return rank === level ? 15 : rank;
}

export function cardValue(c: Card, level: number): number {
  return orderValue(rankOf(c), level);
}

/** 一整副新牌（两副，108 张），按 id 升序。 */
export function fullDeck(): Card[] {
  const out: Card[] = [];
  for (let c = 0; c < DECK_SIZE; c++) out.push(c);
  return out;
}

/** 理牌顺序：按牌序从小到大，同点按花色；逢人配放在级牌之后、王之前。 */
export function sortHand(cards: readonly Card[], level: number): Card[] {
  const key = (c: Card) => {
    const v = isWild(c, level) ? 15.5 : cardValue(c, level);
    return v * 1000 + (suitOf(c) + 1) * 10 + Math.floor(c / 54);
  };
  return [...cards].sort((a, b) => key(a) - key(b));
}
