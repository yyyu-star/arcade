import { describe, expect, it } from 'vitest';
import { LIVE_TIERS } from '../src/core/index.ts';
import { liveStats, type LiveStats } from '../tools/live.ts';

/**
 * 实盘的尺度（docs/design-live.md 第 3 节，仓库根 docs/balance.md 第 2、4 节）：每档 135 局（每段一局），小白 xiaobai、普通 putong、乱买乱卖 random。
 * 种子固定，结果是确定的；局数少，这里只锁形状，目标区间用 `npm run sim -- --balance --runs 2000` 量。
 * 改了数值（账单、难度、情报、真实行情的放大、涨跌倍数……）这里红了，就重新量一遍设计稿第 3 节的表再改这里。
 */
describe('实盘：各档的结回', () => {
  const runs = 135;
  const rows = new Map<string, LiveStats>();
  const at = (tier: string, bot: string): LiveStats => rows.get(`${tier}|${bot}`) as LiveStats;
  for (const t of LIVE_TIERS) for (const b of ['xiaobai', 'putong', 'random']) rows.set(`${t.id}|${b}`, liveStats(t.id, b, runs, 'live6'));

  it('小档小白小赚、普通赚得明显，往上逐档变难', () => {
    for (const b of ['xiaobai', 'putong']) {
      const mean = LIVE_TIERS.map((t) => at(t.id, b).mean);
      for (let i = 1; i < mean.length; i++) expect(mean[i], `${b} ${LIVE_TIERS[i]?.id}`).toBeLessThan(mean[i - 1] as number);
    }
    expect(at('small', 'xiaobai').mean).toBeGreaterThan(1.02);
    expect(at('small', 'xiaobai').p50).toBeGreaterThanOrEqual(1);
    expect(at('small', 'putong').mean).toBeGreaterThan(1.2);
    expect(at('small', 'putong').mean).toBeLessThan(1.45);
    // 豪华档：普通大约打平，小白输
    expect(Math.abs(at('lux', 'putong').mean - 1)).toBeLessThan(0.12);
    expect(at('lux', 'xiaobai').mean).toBeLessThan(0.9);
  });

  it('每档都是普通比小白强；乱买乱卖每档都输', () => {
    for (const t of LIVE_TIERS) {
      expect(at(t.id, 'putong').mean).toBeGreaterThan(at(t.id, 'xiaobai').mean);
      expect(at(t.id, 'random').mean).toBeLessThan(1);
      expect(at(t.id, 'random').mean).toBeLessThan(at(t.id, 'putong').mean);
    }
  });

  it('一局的输赢在一份左右：结回落在 0–2 份的局 ≥ 90%；小档小白、普通几乎不破产', () => {
    for (const r of rows.values()) expect(r.within, `${r.tier} ${r.bot}`).toBeGreaterThanOrEqual(0.9);
    expect(at('small', 'xiaobai').zero).toBeLessThanOrEqual(0.15);
    expect(at('small', 'putong').zero).toBeLessThanOrEqual(0.05);
  });
});
