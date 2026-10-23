/** 一手打完的结果条（0.1.1）：谁赢了多少、什么牌；分池时看得出每个池子归谁 */
import { describe, expect, it } from 'vitest';
import { evalCards } from '../src/core/eval.ts';
import { parseCards } from '../src/core/cards.ts';
import type { HandResult } from '../src/core/table.ts';
import { resultLines, seatName } from '../src/view/table.ts';
import { personaName } from '../src/view/text.ts';

const NAMES = ['你', '阿飙', '稳哥', '老好'];
const name = (s: number): string => NAMES[s]!;
const value = (cards: string): number => evalCards(parseCards(cards));
const strip = (h: string): string => h.replace(/<[^>]+>/g, '');
const base = { handNo: 1, board: [], uncalled: null };

describe('结果条', () => {
  it('大家都弃牌：谁拿下多少', () => {
    const r: HandResult = { ...base, byFold: true, shown: [], pots: [{ amount: 60, winners: [{ seat: 1, won: 60 }] }] };
    expect(resultLines(r, name, 0).map((l) => strip(l.html))).toEqual(['大家都弃牌，阿飙 拿下 60']);
  });

  it('我赢了：写 +多少和牌型，标成我的', () => {
    const shown = [{ seat: 0, value: value('Ah Ad Kc Kd 9s'), hole: [] }];
    const r = { ...base, byFold: false, shown, pots: [{ amount: 820, winners: [{ seat: 0, won: 820 }] }] } as unknown as HandResult;
    expect(resultLines(r, name, 0)).toEqual([{ html: expect.stringContaining('你赢了'), mine: true }]);
    expect(strip(resultLines(r, name, 0)[0]!.html)).toBe('你赢了 +820 · 两对');
  });

  it('几个池子同一个人赢：并成一行写总数', () => {
    const shown = [{ seat: 2, value: value('7h 7d 7c Kd 9s'), hole: [] }];
    const r = {
      ...base,
      byFold: false,
      shown,
      pots: [
        { amount: 3850, winners: [{ seat: 2, won: 3850 }] },
        { amount: 600, winners: [{ seat: 2, won: 600 }] },
      ],
    } as unknown as HandResult;
    expect(resultLines(r, name, 0).map((l) => strip(l.html))).toEqual(['稳哥 三条 赢 4,450']);
  });

  it('不同的人赢不同的池子：每个池子一行，边池不带数字编号（不会和金额连着读）', () => {
    const shown = [
      { seat: 2, value: value('7h 7d 7c Kd 9s'), hole: [] },
      { seat: 3, value: value('Ah Ad Kc Kd 9s'), hole: [] },
    ];
    const r = {
      ...base,
      byFold: false,
      shown,
      pots: [
        { amount: 900, winners: [{ seat: 2, won: 900 }] },
        { amount: 600, winners: [{ seat: 3, won: 600 }] },
      ],
    } as unknown as HandResult;
    expect(resultLines(r, name, 0).map((l) => strip(l.html))).toEqual(['主池 900 稳哥 三条 赢 900', '边池 600 老好 两对 赢 600']);
  });

  it('平分：谁和谁各多少', () => {
    const shown = [
      { seat: 0, value: value('Ah Ad Kc Kd 9s'), hole: [] },
      { seat: 3, value: value('Ah Ad Kc Kd 9s'), hole: [] },
    ];
    const r = { ...base, byFold: false, shown, pots: [{ amount: 40, winners: [{ seat: 0, won: 20 }, { seat: 3, won: 20 }] }] } as unknown as HandResult;
    const [l] = resultLines(r, name, 0);
    expect(strip(l!.html)).toBe('平分：你、老好 各 20 · 两对');
    expect(l!.mine).toBe(true);
  });
});

describe('座位名（结果条）', () => {
  // 锦标赛里电脑座位 owner 是 'player'，从前按 owner==='house' 判，赢家一律显示"空位"
  it('锦标赛里的电脑（owner player、persona 有值）显示性格名，不是空位', () => {
    const n = seatName({ owner: 'player', persona: 3 }, false, null);
    expect(n).not.toBe('空位');
    expect(n).toBe(personaName(3));
  });
  it('现金桌电脑、我、好友房真人、空位', () => {
    expect(seatName({ owner: 'house', persona: 2 }, false, null)).toBe(personaName(2));
    expect(seatName({ owner: 'player', persona: -1 }, true, null)).toBe('你');
    expect(seatName({ owner: 'player', persona: -1 }, false, '小明')).toBe('小明');
    expect(seatName({ owner: 'none', persona: -1 }, false, null)).toBe('空位');
  });
});
