/** 关键时刻的分档（art-v3 ④）：炸弹的戏按张数和牌型分三档，纯函数 */
import { describe, expect, it } from 'vitest';
import { bombDrama } from '../src/view/highlights.ts';

const bomb = (n: number, type: 'bomb' | 'straightFlush' | 'jokerBomb' = 'bomb') => ({ type, cards: Array.from({ length: n }, (_, i) => i) });

describe('bombDrama', () => {
  it('四炸一档，五六炸二档，七炸以上三档', () => {
    expect(bombDrama(bomb(4))).toBe(1);
    expect(bombDrama(bomb(5))).toBe(2);
    expect(bombDrama(bomb(6))).toBe(2);
    expect(bombDrama(bomb(7))).toBe(3);
    expect(bombDrama(bomb(10))).toBe(3);
  });

  it('同花顺、天王炸直接三档', () => {
    expect(bombDrama(bomb(5, 'straightFlush'))).toBe(3);
    expect(bombDrama(bomb(4, 'jokerBomb'))).toBe(3);
  });
});
