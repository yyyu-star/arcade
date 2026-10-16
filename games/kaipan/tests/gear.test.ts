import { describe, expect, it } from 'vitest';
import { BALANCE, LIVE_MAX_BP, createRun, gearInterest, gearLevered, liveGear, liveLevered, liveMultipleBp, liveSetup, replay, runSummary } from '../src/core/index.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';

/** 0.11.0 实盘杠杆（docs/design-live.md 第 2 节）：稳健 1× 和 0.10.0 一模一样；进取、疯狂放大结回、按月付利息、跌到清零线按 0 结。 */

describe('杠杆的开局设置', () => {
  it('稳健 1× 不写 gear（老局、新局同一套规则）；进取、疯狂把封顶、清零线抄进这局，利息按档位打折', () => {
    expect(liveSetup('small', 'newbie', 1)).toEqual(liveSetup('small'));
    expect(liveSetup('small').live?.gear).toBeUndefined();
    for (const x of [2, 3]) {
      for (const tier of ['small', 'mid', 'big', 'lux'] as const) {
        const g = liveSetup(tier, 'newbie', x).live?.gear;
        const def = liveGear(x);
        expect(g).toEqual({ ...def, interest: def.interest * BALANCE.live.tiers[tier].gearRate });
      }
    }
    // 没有的档位按稳健
    expect(liveGear(9)).toEqual(BALANCE.live.gears[0]);
    expect(LIVE_MAX_BP).toBe(Math.max(...BALANCE.live.gears.map((g) => g.cap)) * 10_000);
  });

  it('坏的杠杆设置开不了局', () => {
    const bad = (gear: object) => () => createRun('x', { ...liveSetup('small', 'newbie', 2), live: { ...liveSetup('small', 'newbie', 2).live!, gear: gear as never } });
    expect(bad({ x: 0, cap: 5, interest: 0, call: 0 })).toThrow();
    expect(bad({ x: 2, cap: 50, interest: 0, call: 0 })).toThrow();
    expect(bad({ x: 2, cap: 5, interest: 1, call: 0 })).toThrow();
    expect(bad({ x: 2, cap: 5, interest: 0, call: -0.1 })).toThrow();
  });

  it('放大倍数：1 + 杠杆 ×（档位放大后的倍数 − 1）；1× 原样', () => {
    expect(liveLevered(1.1, 2.8, 1)).toBeCloseTo(1.28, 10);
    expect(liveLevered(1.1, 2.8, 2)).toBeCloseTo(1.56, 10);
    expect(liveLevered(0.9, 1, 3)).toBeCloseTo(0.7, 10);
  });
});

describe('打一局带杠杆的', () => {
  useExt(true);
  useMarket(null);

  it('每月账单里多一笔利息；利息、结回、清零线都随同一种子同一串操作复现', () => {
    const setup = liveSetup('small', 'newbie', 2);
    const s0 = createRun('gear-int', setup).state;
    expect(gearInterest(s0)).toBe(Math.round((setup.live!.gear!.interest * 100_000) / setup.live!.lev! / 100) * 100);
    expect(gearInterest(createRun('gear-int', liveSetup('small')).state)).toBe(0);
    expect(gearLevered(createRun('gear-int', liveSetup('small')).state)).toBeNull();
    for (let i = 0; i < 6; i++) {
      const end = playRun(`gear-${i}`, botByName('normal'), setup);
      const again = replay(end.seed, end.actions, end.setup, { ext: true });
      expect(again.account).toBe(end.account);
      expect(again.endReason).toBe(end.endReason);
      if (end.phase === 'won') expect(end.bill.extras?.some((x) => x.id === 'margin_interest' && x.amount === gearInterest(end))).toBe(true);
      const bp = liveMultipleBp(end);
      expect(bp).toBeGreaterThanOrEqual(0);
      expect(bp).toBeLessThanOrEqual(setup.live!.gear!.cap * 10_000);
    }
  });

  it('跌到清零线：这局输掉、结回 0，结算记下杠杆和清零', () => {
    const setup = liveSetup('small', 'newbie', 3);
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const end = playRun(`margin-${i}`, botByName('xiaobai'), setup);
      if (end.endReason !== 'margin') continue;
      found = true;
      expect(end.phase).toBe('lost');
      expect(liveMultipleBp(end)).toBe(0);
      expect(gearLevered(end)!).toBeLessThanOrEqual(setup.live!.gear!.call);
      const sum = runSummary(end);
      expect(sum.live?.gear).toBe(3);
      expect(sum.live?.margin).toBe(true);
    }
    expect(found).toBe(true);
  });
});
