/** 好友动态的名场面（0.16.0）：判定只看亮出来的牌和分池结果，模板文件守平台的格式（docs/platform-backend.md 15.17） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards.ts';
import { evalCards } from '../src/core/eval.ts';
import { BIG_POT_BB, FEED_MOMENTS, FEED_PER_GAME, feedMoment, shouldReport, type FeedMoment } from '../src/core/feed.ts';
import type { HandResult, LogEntry } from '../src/core/table.ts';

const BB = 20;
const hand = (boardStr: string, shown: [number, string][], winner: number, over: Partial<HandResult> = {}): HandResult => {
  const board = parseCards(boardStr);
  return {
    handNo: 1,
    board,
    shown: shown.map(([seat, hole]) => {
      const h = parseCards(hole);
      return { seat, hole: h, value: evalCards([...h, ...board]) };
    }),
    pots: [{ amount: 400, winners: [{ seat: winner, won: 400 }] }],
    uncalled: null,
    byFold: false,
    ...over,
  };
};
const e = (seat: number, act: LogEntry['act'], amount = 0, allin = false): LogEntry => ({ seat, act, amount, ...(allin ? { allin: true as const } : {}) });

describe('名场面判定', () => {
  it('皇家同花顺、同花顺、四条：亮出来、赢了才算；n 是赢下的', () => {
    expect(feedMoment(hand('Th Jh Qh 2c 3d', [[0, 'Kh Ah'], [1, 'As Ad']], 0), [], 0, BB)).toEqual({ moment: 'royal_flush', n: 400 });
    expect(feedMoment(hand('Th Jh Qh 2c 3d', [[0, '9h 8h'], [1, 'As Ad']], 0), [], 0, BB)).toEqual({ moment: 'straight_flush', n: 400 });
    // K 高的同花顺不是皇家
    expect(feedMoment(hand('Th Jh Qh 2c 3d', [[0, '9h Kh'], [1, 'As Ad']], 0), [], 0, BB)?.moment).toBe('straight_flush');
    expect(feedMoment(hand('9h 9d 9c 2s 5h', [[0, '9s Kd'], [1, 'As Ad']], 0), [], 0, BB)).toEqual({ moment: 'quads', n: 400 });
    // 四条输给了同花顺：不报输的
    expect(feedMoment(hand('9h 9d 9c 7h 8h', [[0, '9s Kd'], [1, 'Th Jh']], 1), [], 0, BB)).toBeNull();
    // 输的那家看不到；没摊牌的不知道是什么牌
    expect(feedMoment(hand('Th Jh Qh 2c 3d', [[0, 'Kh Ah'], [1, 'As Ad']], 0), [], 1, BB)).toBeNull();
    expect(feedMoment(hand('Th Jh Qh 2c 3d', [], 0, { byFold: true }), [], 0, BB)).toBeNull();
  });
  it('全下翻盘：自己全下、转牌落后、河牌逆转赢了主池；盲注被迫全下的不算', () => {
    // 转牌（A 7 2 9）时 1 号一对 A、0 号一对 9；河牌 K 来了 0 号两对翻盘
    const r = hand('Ah 7d 2c 9s Kh', [[0, 'Kd 9d'], [1, 'Ac 3d']], 0);
    expect(feedMoment(r, [e(0, 'raise', 400, true), e(1, 'call', 400)], 0, BB)).toEqual({ moment: 'allin_comeback', n: 400 });
    expect(feedMoment(r, [e(0, 'raise', 400), e(1, 'call', 400)], 0, BB)).toBeNull();
    expect(feedMoment(r, [e(0, 'bb', 20, true), e(1, 'call', 20)], 0, BB)).toBeNull();
    // 转牌就领先的全下赢了：不是翻盘
    expect(feedMoment(hand('Ah 7d 2c 9s Kh', [[0, 'Kd 9d'], [1, 'Ac 3d']], 1), [e(1, 'raise', 400, true), e(0, 'call', 400)], 1, BB)).toBeNull();
  });
  it('一手赢下 100 个大盲以上算大锅，弃牌赢的也算（不用亮牌）；差一个不算', () => {
    const big = BIG_POT_BB * BB;
    const fold = (won: number) => hand('Ah 7d 2c', [], 0, { byFold: true, pots: [{ amount: won, winners: [{ seat: 0, won }] }] });
    expect(feedMoment(fold(big), [], 0, BB)).toEqual({ moment: 'big_pot', n: big });
    expect(feedMoment(fold(big - 1), [], 0, BB)).toBeNull();
    // 分池：各个池赢的加起来
    const split = hand('Ah 7d 2c 9s Kh', [[0, 'Kd Ks'], [1, 'Qc Qd']], 0, {
      pots: [
        { amount: 1_200, winners: [{ seat: 0, won: 1_200 }] },
        { amount: 800, winners: [{ seat: 0, won: 800 }] },
      ],
    });
    expect(feedMoment(split, [], 0, BB)).toEqual({ moment: 'big_pot', n: 2_000 });
  });
  it('一局同一种只报一次、最多报 2 条', () => {
    const sent = new Set<FeedMoment>();
    expect(shouldReport(sent, 'quads')).toBe(true);
    sent.add('quads');
    expect(shouldReport(sent, 'quads')).toBe(false);
    expect(shouldReport(sent, 'big_pot')).toBe(true);
    sent.add('big_pot');
    expect(sent.size).toBe(FEED_PER_GAME);
    expect(shouldReport(sent, 'royal_flush')).toBe(false);
  });
});

describe('public/moments.json（平台按模板拼文字）', () => {
  const raw = readFileSync(new URL('../public/moments.json', import.meta.url), 'utf8');
  const all = JSON.parse(raw) as Record<string, { text: string }>;
  it('判定里的每个编号都有模板，文件里没有多余的编号', () => {
    expect(Object.keys(all).sort()).toEqual([...FEED_MOMENTS].sort());
  });
  it('编号 1–24 位、字母开头；模板 ≤ 40 字，只用 {name} 和 {n}（报的时候只带一个数）', () => {
    for (const [id, m] of Object.entries(all)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
      expect([...m.text].length, id).toBeLessThanOrEqual(40);
      expect(m.text, id).toContain('{name}');
      const holes = m.text.match(/\{[^}]*\}/g) ?? [];
      for (const h of holes) expect(['{name}', '{n}'], `${id} ${h}`).toContain(h);
      // 去掉占位符后不能再有花括号（平台见了就不显示）
      expect(m.text.replace(/\{name\}|\{n\}/g, ''), id).not.toMatch(/[{}]/);
    }
  });
});
