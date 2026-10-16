/** 给人看的字：牌型名、电脑的名字、筹码数怎么写。 */
import type { Card } from '../core/cards.ts';
import { CATEGORY_NAMES, categoryOf, evalCards, FLUSH, FULL_HOUSE, PAIR, QUADS, STRAIGHT, STRAIGHT_FLUSH, TRIPS, TWO_PAIR } from '../core/eval.ts';
import { PERSONAS } from '../ai/personas.ts';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const rankText = (rank: number): string => RANKS[rank]!;

export const handName = (value: number): string => CATEGORY_NAMES[categoryOf(value)]!;

/** 我现在凑成的牌（翻牌后在底牌旁边显示）：牌型带上点数，比如"一对 Q""两对 K 和 7""顺子 5–9" */
export function madeHand(cards: readonly Card[]): string {
  const value = evalCards([...cards]);
  const cat = categoryOf(value);
  const count = new Array<number>(13).fill(0);
  for (const c of cards) count[c >> 2]!++;
  // 从大到小，至少有 n 张的点数
  const atLeast = (n: number): number[] => count.flatMap((k, r) => (k >= n ? [r] : [])).reverse();
  const R = rankText;
  switch (cat) {
    case PAIR:
      return `一对 ${R(atLeast(2)[0]!)}`;
    case TWO_PAIR: {
      const [a, b] = atLeast(2);
      return `两对 ${R(a!)} 和 ${R(b!)}`;
    }
    case TRIPS:
      return `三条 ${R(atLeast(3)[0]!)}`;
    case QUADS:
      return `四条 ${R(atLeast(4)[0]!)}`;
    case FULL_HOUSE: {
      const t = atLeast(3)[0]!;
      return `葫芦 ${R(t)} 带 ${R(atLeast(2).find((r) => r !== t)!)}`;
    }
    case STRAIGHT:
    case STRAIGHT_FLUSH: {
      // 牌力值的最低 4 位是顺子最高张 + 1（A-2-3-4-5 记 4）
      const top = (value & 15) - 1;
      if (cat === STRAIGHT_FLUSH && top === 12) return '皇家同花顺';
      return `${CATEGORY_NAMES[cat]} ${top === 3 ? 'A' : R(top - 4)}–${R(top)}`;
    }
    case FLUSH:
      return `同花 ${R((value >> 16) & 15)} 大`;
    default:
      return `高牌 ${R(atLeast(1)[0]!)}`;
  }
}
export const personaName = (p: number): string => PERSONAS[p]?.name ?? '电脑';
export const personaStyle = (p: number): string => PERSONAS[p]?.style ?? '';

/** 12,345；一百万以上写成 123.4万，免得座位上的数字太长 */
export function chips(n: number): string {
  if (n >= 1_000_000) return `${Math.floor(n / 1_000) / 10}万`;
  return n.toLocaleString('en-US');
}

