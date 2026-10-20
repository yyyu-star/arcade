import { describe, expect, it } from 'vitest';
import { interpret, parseCards, DEFAULT_OPTIONS } from '../src/variants/guandan/core/index.ts';
import { countLeft } from '../src/view/counter.ts';

describe('记牌器', () => {
  it('全场减去我手里的和出过的；王 2 张、其余 8 张起算；"不要"不算', () => {
    const hand = parseCards('♠A ♥A 大王 ♣5');
    const pair = interpret(parseCards('♦K ♣K'), 2, DEFAULT_OPTIONS)[0]!;
    const king = interpret(parseCards('大王'), 2, DEFAULT_OPTIONS)[0]!;
    const left = countLeft(hand, [{ seat: 1, play: pair }, { seat: 2, play: null }, { seat: 3, play: king }]);
    const of = (r: number) => left.find((c) => c.rank === r)!.left;
    expect(of(17)).toBe(0);
    expect(of(16)).toBe(2);
    expect(of(14)).toBe(6);
    expect(of(13)).toBe(6);
    expect(of(5)).toBe(7);
    expect(of(2)).toBe(8);
    expect(left.map((c) => c.rank)).toEqual([17, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});
