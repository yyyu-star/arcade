import { describe, expect, it } from 'vitest';
import { BALANCE, createRun, dailySetup, isRankedSetup, replay, rulesOf, runMonths, runSummary, shortGoal, shortSetup } from '../src/core/index.ts';
import { recordRun, emptyProfile, bestKey } from '../src/platform/profile.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';
import { segmentForSeed } from '../tools/segments-disk.ts';

/** 0.10.0 娱乐短局（docs/design-balance.md）：5 个月、月供打折、最后一个月月底多交一笔首付。 */

describe('短局的开局设置', () => {
  it('从 BALANCE.short 抄进这局，首付比例按难度（高手之后沿用最后一个）；算正常开局', () => {
    const setup = shortSetup('newbie', 2);
    expect(setup).toEqual({ persona: 'newbie', difficulty: 2, short: { months: BALANCE.short.months, billMult: BALANCE.short.billMult, goal: BALANCE.short.goal[1] } });
    expect(shortSetup('newbie', 8).short?.goal).toBe(BALANCE.short.goal.at(-1));
    expect(isRankedSetup(setup)).toBe(true);
    const s = createRun('short-setup', setup).state;
    expect(runMonths(s)).toBe(BALANCE.short.months);
    // 首付 = 开局资产 × 比例，取整到百元；宝妈开局资产不一样
    expect(shortGoal(s)).toBe(Math.round((BALANCE.short.goal[1]! * 100_000) / 100) * 100);
    expect(shortGoal(createRun('short-setup', shortSetup('mom', 1)).state)).toBe(Math.round((BALANCE.short.goal[0]! * 94_000) / 100) * 100);
    expect(shortGoal(createRun('full', { persona: 'newbie', difficulty: 2 }).state)).toBe(0);
  });

  it('月供按这局的倍数打折；每日挑战、实盘不能是短局', () => {
    const full = createRun('bills', { persona: 'newbie', difficulty: 1 }).state;
    const short = createRun('bills', shortSetup('newbie', 1)).state;
    expect(rulesOf(short).billMult).toBeCloseTo(rulesOf(full).billMult * BALANCE.short.billMult, 10);
    expect(() => createRun('x', { ...dailySetup('2026-10-16').setup, short: { months: 5, billMult: 0.25, goal: 1 } })).toThrow('不能是短局');
    expect(() => createRun('x', { short: { months: 13, billMult: 0.25, goal: 1 } })).toThrow();
    expect(() => createRun('x', { short: { months: 5, billMult: 0, goal: 1 } })).toThrow();
    // 每日挑战本身不带短局，照旧一年
    expect(dailySetup('2026-10-16').setup.short).toBeUndefined();
  });

  it('真实行情下第 2 级的消息噪声只加在完整一年的局里', () => {
    useMarket((seed: string) => segmentForSeed(seed));
    const seg = segmentForSeed('noise');
    const full = createRun('noise', { persona: 'newbie', difficulty: 2 }, { segment: seg }).state;
    const short = createRun('noise', shortSetup('newbie', 2), { segment: seg }).state;
    expect(rulesOf(full).msgNoise).toBeCloseTo(BALANCE.fx.choppy!.realNoise!, 10);
    expect(rulesOf(short).msgNoise).toBe(0);
    useMarket(null);
  });
});

describe('打完短局', () => {
  useExt(true);
  useMarket(null);

  it('最后一个月的账单里多一笔首付；交得上就赢、交不上就输；同一种子同一串操作结果一样', () => {
    let won = 0;
    let lost = 0;
    for (let i = 0; i < 16; i++) {
      const end = playRun(`short-${i}`, botByName('normal'), shortSetup('newbie', 1));
      const again = replay(end.seed, end.actions, end.setup, { ext: true });
      expect(again.account).toBe(end.account);
      expect(again.phase).toBe(end.phase);
      if (end.phase === 'won') {
        won += 1;
        expect(end.month).toBe(BALANCE.short.months);
        expect(end.bill.extras?.some((x) => x.id === 'down_payment' && x.amount === shortGoal(end))).toBe(true);
      } else lost += 1;
    }
    expect(won).toBeGreaterThan(0);
    expect(won + lost).toBe(16);
  });

  it('档案：短局和完整一年分开记最好成绩，赢了照样解锁下一级', () => {
    const end = Array.from({ length: 16 }, (_, i) => playRun(`short-rec-${i}`, botByName('normal'), shortSetup('newbie', 1))).find((s) => s.phase === 'won');
    expect(end).toBeDefined();
    const sum = runSummary(end!);
    expect(sum.short).toBe(true);
    expect(sum.ranked).toBe(true);
    const r = recordRun(emptyProfile(), sum, '2026-10-16');
    expect(r.profile.best[bestKey('newbie', 1, true)]?.wins).toBe(1);
    expect(r.profile.best[bestKey('newbie', 1)]).toBeUndefined();
    expect(r.profile.maxDifficulty).toBe(2);
  });
});
