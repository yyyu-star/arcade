/** 德州自己的那部分互动（0.13.0，DESIGN.md 13.7）：电脑的互动性格、名场面怎么认；其余（菜单、冷却、电脑怎么回）是 kit 的，kit 自己测 */
import { botReact, funIdCount, newBotState } from 'arcade-kit/fun-logic';
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '../src/ai/personas.ts';
import type { HandResult, LogEntry } from '../src/core/table.ts';
import { CHATTY, FUN_TEMPER, momentOf, temperOf } from '../src/fun/moments.ts';
import { TAUNTS } from '../src/fun/taunts.ts';
import { EMOTE_COUNT, TAUNT_COUNT } from '../src/room/rules.ts';

// 1 号电脑全下，0 号真人跟，摊牌 0 号赢；2、3 号电脑也亮了牌、输了
const log: LogEntry[] = [
  { seat: 2, act: 'sb', amount: 10 },
  { seat: 3, act: 'bb', amount: 20 },
  { seat: 1, act: 'raise', amount: 2000, allin: true },
  { seat: 0, act: 'call', amount: 2000 },
  { seat: 2, act: 'call', amount: 1990 },
  { seat: 3, act: 'call', amount: 1980 },
];
const shown = [0, 1, 2, 3].map((seat) => ({ seat, value: (seat === 0 ? 5 : 1) << 20, hole: [] }));
const r = { handNo: 1, board: [], shown, pots: [{ amount: 8000, winners: [{ seat: 0, won: 8000 }] }], uncalled: null, byFold: false } as unknown as HandResult;

describe('德州的互动接线', () => {
  it('每个性格都有互动性格和话多不多；编号表 = 短语 + kit 的 12 表情 + 8 道具，短语只往后加', () => {
    expect(FUN_TEMPER.length).toBe(PERSONAS.length);
    expect(CHATTY.length).toBe(PERSONAS.length);
    expect(temperOf(1)).toBe('rowdy');
    expect(temperOf(3)).toBe('cool');
    expect(TAUNTS.length).toBe(TAUNT_COUNT);
    expect(EMOTE_COUNT).toBe(funIdCount(TAUNTS.length));
    expect(EMOTE_COUNT).toBe(35);
  });

  it('名场面：全下赢算 big-win，赢家是主池唯一赢家，输家是亮了牌没赢的；弃牌赢、平分不算', () => {
    expect(momentOf(r, log)).toEqual({ moment: 'big-win', winner: 0, losers: [1, 2, 3] });
    expect(momentOf({ ...r, byFold: true } as HandResult, log)).toBeNull();
    const split = { ...r, pots: [{ amount: 8000, winners: [{ seat: 0, won: 4000 }, { seat: 1, won: 4000 }] }] } as unknown as HandResult;
    expect(momentOf(split, log)).toBeNull();
    // 没人全下、没诈唬、没反超：不算
    const calm: LogEntry[] = log.map(({ allin: _, ...e }) => e);
    expect(momentOf(r, calm)).toBeNull();
  });

  it('交给 kit 的电脑反应：名场面里输的电脑会冲赢家来，爱闹的比高冷的多；每手最多 2 次', () => {
    const m = momentOf(r, log)!;
    const count = (temper: 'rowdy' | 'cool'): number => {
      let n = 0;
      let x = 1;
      const rand = (): number => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      for (let k = 0; k < 400; k++) {
        const st = newBotState();
        let acts = 0;
        for (const seat of m.losers) {
          const a = botReact({ kind: 'moment', moment: m.moment, winners: [m.winner], losers: m.losers, hand: k }, { seat, temper }, st, k * 100_000, rand);
          if (a) {
            acts++;
            if (a.prop) expect(a.to).toBe(m.winner);
          }
        }
        expect(acts).toBeLessThanOrEqual(2);
        n += acts;
      }
      return n;
    };
    expect(count('rowdy')).toBeGreaterThan(count('cool') * 2);
  });
});
