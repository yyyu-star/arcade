/** 止盈（src/core/takeprofit.ts，0.22.0）：目标怎么算、什么时候算到、存档读回来 */
import { describe, expect, it } from 'vitest';
import { parseTakeProfit, profitTarget, reached, takeProfitLabel, TP_OFF } from '../src/core/takeprofit.ts';

describe('止盈', () => {
  it('关着、没带入时没有目标，永远不触发', () => {
    expect(profitTarget(TP_OFF, 2_000)).toBeNull();
    expect(reached(TP_OFF, 2_000, 1_000_000)).toBe(false);
    expect(reached({ kind: 'pct', pct: 50 }, 0, 5_000)).toBe(false);
  });

  it('按带入的百分比：赢够了才算，差 1 都不算；向上取整', () => {
    const tp = { kind: 'pct', pct: 50 } as const;
    expect(profitTarget(tp, 2_000)).toBe(1_000);
    expect(reached(tp, 2_000, 2_999)).toBe(false);
    expect(reached(tp, 2_000, 3_000)).toBe(true);
    expect(profitTarget(tp, 2_001)).toBe(1_001);
    expect(profitTarget({ kind: 'pct', pct: 200 }, 2_000)).toBe(4_000);
  });

  it('自定义金额：净赢到这个数', () => {
    const tp = { kind: 'amount', amount: 500 } as const;
    expect(reached(tp, 1_000, 1_499)).toBe(false);
    expect(reached(tp, 1_000, 1_500)).toBe(true);
    // 输着的时候不算
    expect(reached(tp, 1_000, 600)).toBe(false);
  });

  it('存档读回：认得的照原样，乱的、越界的一律当关', () => {
    expect(parseTakeProfit({ kind: 'pct', pct: 100 })).toEqual({ kind: 'pct', pct: 100 });
    expect(parseTakeProfit({ kind: 'amount', amount: 3_000 })).toEqual({ kind: 'amount', amount: 3_000 });
    for (const bad of [null, 'pct', { kind: 'pct', pct: -1 }, { kind: 'pct', pct: 1.5 }, { kind: 'amount', amount: 0 }, { kind: 'amount', amount: '9' }, { kind: 'x' }])
      expect(parseTakeProfit(bad)).toEqual(TP_OFF);
  });

  it('按钮上的字', () => {
    const c = (n: number) => n.toLocaleString('en-US');
    expect(takeProfitLabel(TP_OFF, c)).toBe('止盈：关');
    expect(takeProfitLabel({ kind: 'pct', pct: 100 }, c)).toBe('止盈：赢 100%');
    expect(takeProfitLabel({ kind: 'amount', amount: 2_500 }, c)).toBe('止盈：赢 2,500');
  });
});
