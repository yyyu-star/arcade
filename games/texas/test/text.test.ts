/** 给人看的牌型（翻牌后在我的底牌旁边显示）；摊牌时认诈唬 */
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards.ts';
import { HIGH_CARD, PAIR } from '../src/core/eval.ts';
import type { LogEntry } from '../src/core/table.ts';
import { bluffer } from '../src/core/fame.ts';
import { madeHand } from '../src/view/text.ts';

describe('我现在凑成的牌', () => {
  it.each([
    ['Ah Kd 9c 4s 2s', '高牌 A'],
    ['Qs Qd 2c 7h 9s', '一对 Q'],
    ['Qs Qd 2c 2h 9s 9d 3c', '两对 Q 和 9'],
    ['Ks Kd Kc 8h 2s', '三条 K'],
    ['As 2d 3c 4h 5s 9d Kc', '顺子 A–5'],
    ['9s Td Jc Qh Ks 2d 2c', '顺子 9–K'],
    ['As Ks 9s 4s 2s 2d', '同花 A 大'],
    ['Qs Qd Qc 2h 2s 9s 9d', '葫芦 Q 带 9'],
    ['Qs Qd Qc 2h 2s 2d 9d', '葫芦 Q 带 2'],
    ['7s 7d 7c 7h As', '四条 7'],
    ['5h 6h 7h 8h 9h Ah', '同花顺 5–9'],
    ['Ah 2h 3h 4h 5h', '同花顺 A–5'],
    ['Ts Js Qs Ks As', '皇家同花顺'],
  ])('%s → %s', (cards, text) => {
    expect(madeHand(parseCards(cards))).toBe(text);
  });
});

describe('认诈唬（0.2.3）', () => {
  const e = (seat: number, act: LogEntry['act'], amount = 0): LogEntry => ({ seat, act, amount });
  const log = [e(1, 'sb', 10), e(2, 'bb', 20), e(1, 'call', 10), e(2, 'check'), e(-1, 'flop'), e(1, 'bet', 40), e(2, 'raise', 120), e(1, 'call', 80), e(-1, 'turn'), e(2, 'bet', 200)];
  it('翻牌以后最后一次下注的人亮出高牌才算', () => {
    expect(bluffer(log, 2, HIGH_CARD)).toBe(true);
    expect(bluffer(log, 2, PAIR)).toBe(false);
    expect(bluffer(log, 1, HIGH_CARD)).toBe(false);
  });
  it('翻牌前的加注不算', () => {
    expect(bluffer([e(1, 'raise', 60), e(2, 'call', 40), e(-1, 'flop'), e(2, 'check'), e(1, 'check')], 1, HIGH_CARD)).toBe(false);
  });
});
