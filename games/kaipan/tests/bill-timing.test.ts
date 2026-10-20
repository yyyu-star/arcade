import { describe, expect, it } from 'vitest';
import { BILL_MS, END_CUTSCENE_MS, OLD_BILL_MS, billStageMs } from '../src/view/trade/billTiming.ts';

/** 0.17.0 月底账单舞台：每月自动停 ≤ 2 秒；一局 12 个月加起来不能比以前多出半分钟（docs/art-v3.md 第 5 节）。 */
describe('月底账单舞台的时长', () => {
  it('每个月自动停不超过 2 秒，简短模式更短', () => {
    expect(billStageMs()).toBeLessThanOrEqual(2000);
    expect(BILL_MS.quick).toBeLessThan(billStageMs());
    expect(BILL_MS.rowMax * 5).toBeLessThanOrEqual(BILL_MS.rows + BILL_MS.rowMax);
  });

  it('完整一年（12 个月）加上结束过场，比以前多出的时间不超过 30 秒', () => {
    const added = (billStageMs() - OLD_BILL_MS) * 12 + END_CUTSCENE_MS;
    expect(added).toBeLessThanOrEqual(30_000);
  });
});
