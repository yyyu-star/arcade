/** 每副结束的复盘（src/view/recap.ts，0.6.1）：只看公开的出牌记录和名次 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, interpret, parseCards, type DealResult, type PlayRecord } from '../src/variants/guandan/core/index.ts';
import { dealRecap } from '../src/view/recap.ts';

// 同一手可能有好几种解释（同花顺也是顺子）：取最大的那种
const play = (s: string) => interpret(parseCards(s), 2, DEFAULT_OPTIONS).at(-1)!;
const deal = (order: number[]): DealResult => ({ dealNo: 1, order, winnerTeam: order[0]! % 2, up: 1, doubleDown: false, levelsBefore: [2, 2], levelsAfter: [3, 2], aFailedTeam: -1, aResetTeam: -1 });

describe('每副复盘', () => {
  it('两队各炸了几次、最大的一炸是谁的（同花顺压过四张）', () => {
    const hist: PlayRecord[] = [
      { seat: 1, play: play('S9 H9 C9 D9') },
      { seat: 2, play: play('♠10 ♠J ♠Q ♠K ♠A') },
      { seat: 3, play: null },
      { seat: 0, play: play('S3') },
      { seat: 0, play: play('C5 D5 H5 S5') },
    ];
    const r = dealRecap(deal([0, 2, 1, 3]), hist);
    expect(r.bombs).toEqual([2, 1]);
    expect(r.top?.seat).toBe(2);
    expect(r.top?.play.type).toBe('straightFlush');
  });

  it('没人炸：最大一炸是 null，头游出了几手（不算"不要"）', () => {
    const hist: PlayRecord[] = [
      { seat: 1, play: play('S3') },
      { seat: 2, play: null },
      { seat: 1, play: play('S4 D4') },
      { seat: 0, play: play('S6') },
    ];
    const r = dealRecap(deal([1, 3, 0, 2]), hist);
    expect(r).toEqual({ bombs: [0, 0], top: null, firstPlays: 2 });
  });
});
