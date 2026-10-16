import { stream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { mcIters } from '../src/ai/decide.ts';
import { equity } from '../src/ai/equity.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { classCards, handClass, preflopEquity } from '../src/ai/preflop.ts';
import { parseCards } from '../src/core/cards.ts';
import { PERSONA_COUNT } from '../src/core/table.ts';
import { runBots } from './bots.ts';
import { SEED } from './helpers.ts';

const eq = (hole: string, board: string, opp: number, iters = 20_000): number =>
  equity(parseCards(hole), parseCards(board), opp, iters, stream(SEED, 'test', opp));

describe('胜率', () => {
  it('和公开的胜率表一致（±2%）', () => {
    expect(eq('As Ah', '', 1)).toBeCloseTo(852, -1.4);
    expect(eq('As Ah', '', 5)).toBeCloseTo(492, -1.4);
    expect(eq('7c 2d', '', 1)).toBeCloseTo(346, -1.4);
    expect(eq('Ks Qs', '', 1)).toBeCloseTo(634, -1.4);
    // 河牌：两张公共牌对子的 AA 对 1 人
    expect(eq('As Ah', 'Kd Kc 2h 7s 9d', 1)).toBeGreaterThan(850);
  });

  it('翻牌前的表和重新算的一致（±1.5%），类别覆盖 169 种', () => {
    const seen = new Set<number>();
    for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) seen.add(handClass(a, b));
    expect(seen.size).toBe(169);
    for (const k of [0, 168, 12 * 13 + 11, 5 * 13 + 9]) {
      const [a, b] = classCards(k);
      expect(handClass(a, b)).toBe(k);
      for (const opp of [1, 3, 5]) {
        const fresh = equity([a, b], [], opp, 20_000, stream(SEED, 'check', k * 8 + opp));
        expect(Math.abs(preflopEquity(a, b, opp) - fresh)).toBeLessThanOrEqual(15);
      }
    }
  });
});

describe('电脑', () => {
  it('性格的个数和规则里的一致', () => {
    expect(PERSONAS.length).toBe(PERSONA_COUNT);
  });

  it('CPU：单次决策 p99 < 2 ms，一批（真人两次说话之间）p99 < 10 ms', () => {
    // 豪华桌最费：翻牌后要按对手的范围重抽底牌（equity.ts 的 floors）。
    // 量的是墙上时间：本机整套并行跑、机器忙的时候，一次抖动就能把 p99 顶过线（CI 上约 0.5 ms / 3.5 ms）。
    // 最多量 3 遍、各取最好的：代码真变慢了三遍都过不了线，偶发的抖动不会三遍都赶上（0.3.5 前偶发超时）
    const p99 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.99)]!;
    let best = { decide: Infinity, batch: Infinity };
    for (let k = 0; k < 3 && (best.decide >= 2 || best.batch >= 10); k++) {
      const st = runBots({ seed: SEED, size: 6, hands: 300, stakes: 'lux', timing: true, chaos: false });
      const run = { decide: p99(st.decideMs), batch: p99(st.batchMs) };
      console.log(`第 ${k + 1} 遍：决策 ${st.decideMs.length} 次 p99 ${run.decide.toFixed(3)} ms；一批 ${st.batchMs.length} 次 p99 ${run.batch.toFixed(3)} ms`);
      best = { decide: Math.min(best.decide, run.decide), batch: Math.min(best.batch, run.batch) };
    }
    expect(best.decide).toBeLessThan(2);
    expect(best.batch).toBeLessThan(10);
    expect(mcIters(5)).toBeLessThanOrEqual(mcIters(1));
  });
});
