import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  LIVE_TIERS,
  createRun,
  debtOf,
  isCleanLiveSetup,
  isLive,
  isRankedSetup,
  liveAssets,
  liveMultipleBp,
  liveReturn,
  liveSetup,
  liveStart,
  liveTierOf,
  liveValue,
  replay,
  rulesOf,
  runMonths,
  runSummary,
  surprisePlan,
  topBar,
  type GameState,
} from '../src/core/index.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';

/** 0.6.0 实盘模式的规则（docs/design-live.md 第 1、2 节）：档位、几个月、账单打折、结回倍数（0.10.0 起按档放大涨跌）。钱包不在这里。 */

describe('档位和开局设置', () => {
  it('四档：一份和 economy.md 第 2 节一致；难度 1–3，豪华档和大档同一套行情，靠生活费和涨跌倍数更难', () => {
    expect(LIVE_TIERS.map((t) => [t.id, t.stake, t.difficulty])).toEqual([
      ['small', 2_000, 1],
      ['mid', 10_000, 2],
      ['big', 50_000, 3],
      ['lux', 200_000, 3],
    ]);
    const lev = LIVE_TIERS.map((t) => BALANCE.live.tiers[t.id].lev);
    for (let i = 1; i < lev.length; i++) expect(lev[i]).toBeGreaterThanOrEqual(lev[i - 1] as number);
  });

  it('开局设置：难度由档位定，规则从 BALANCE.live 抄进这局；不算"正常开局"（不进最好成绩、解锁）', () => {
    const setup = liveSetup('big', 'mom');
    const { billMult, lev } = BALANCE.live.tiers.big;
    expect(setup).toEqual({ persona: 'mom', difficulty: 3, live: { months: 5, billMult, lev, tier: 'big' } });
    expect(BALANCE.live.months).toBe(5);
    expect(BALANCE.live.cap).toBe(3);
    expect(isRankedSetup(setup)).toBe(false);
    const s = createRun('live-setup', setup).state;
    expect(isLive(s)).toBe(true);
    expect(runMonths(s)).toBe(5);
    expect(runMonths(createRun('ent', { persona: 'mom', difficulty: 3 }).state)).toBe(12);
  });

  it('设置不对就不开局：月数、账单倍数越界，或者和每日挑战混在一起', () => {
    expect(() => createRun('x', { live: { months: 0, billMult: 0.25 } })).toThrow();
    expect(() => createRun('x', { live: { months: 13, billMult: 0.25 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6.5, billMult: 0.25 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6, billMult: 0 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6, billMult: 1.5 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6, billMult: 0.25, lev: 0.5 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6, billMult: 0.25, lev: 11 } })).toThrow();
    expect(() => createRun('x', { live: { months: 6, billMult: 0.25, tier: 'huge' as never } })).toThrow('未知档位');
    expect(() => createRun('x', { daily: '2026-10-15', live: { months: 6, billMult: 0.25 } })).toThrow('每日挑战不能是实盘');
  });
});

describe('账单打折', () => {
  it('常规月供和突发账单都按这局的倍数打折（难度、人设的倍数照样叠加）', () => {
    for (const t of LIVE_TIERS) {
      const cut = BALANCE.live.tiers[t.id].billMult;
      const ent = createRun('bills', { persona: 'newbie', difficulty: t.difficulty }).state;
      const live = createRun('bills', liveSetup(t.id)).state;
      expect(rulesOf(live).billMult).toBeCloseTo(rulesOf(ent).billMult * cut, 10);
      // 第 1 个月：取整到百元
      expect(Math.abs(live.bill.amount - ent.bill.amount * cut)).toBeLessThanOrEqual(50 + 1e-9);
    }
    const full = surprisePlan('bills', 1, 'newbie');
    const cut = surprisePlan('bills', 1, 'newbie', 0.25);
    expect(cut.map((x) => [x.month, x.extra.id])).toEqual(full.map((x) => [x.month, x.extra.id]));
    for (let i = 0; i < full.length; i++) expect(Math.abs(cut[i]!.extra.amount - full[i]!.extra.amount * 0.25)).toBeLessThanOrEqual(100);
  });
});

describe('打完 5 个月', () => {
  useExt(true);
  useMarket(null);

  it('还完第 5 个月的账单就结束（通关），借款先还掉；同一种子同一串操作结果一样', () => {
    let seen = 0;
    for (let i = 0; i < 12; i++) {
      const end = playRun(`half-${i}`, botByName('gambler'), liveSetup('small'));
      if (end.phase === 'lost') continue;
      seen += 1;
      expect(end.phase).toBe('won');
      expect(end.month).toBe(5);
      expect(end.stats.billsPaid).toBe(5);
      expect(debtOf(end)).toBe(0);
      const again = replay(end.seed, end.actions, end.setup, { ext: true });
      expect(again.account).toBe(end.account);
      expect(again.phase).toBe('won');
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('结算页的数：开局资产、当前资产、倍数（万分之几，向下取整）', () => {
    const end = playRun('half-sum', botByName('normal'), liveSetup('mid', 'retiree'));
    const sum = runSummary(end);
    expect(sum.live).not.toBeNull();
    expect(sum.live?.months).toBe(5);
    expect(sum.live?.start).toBe(80_000);
    expect(sum.live?.assets).toBe(liveAssets(end));
    const lev = BALANCE.live.tiers.mid.lev;
    if (end.phase === 'won') expect(sum.live?.bp).toBe(Math.max(0, Math.min(30_000, Math.floor((1 + lev * (end.account / 80_000 - 1)) * 10_000))));
    // 娱乐局没有
    expect(runSummary(playRun('half-sum', botByName('normal'), { persona: 'retiree', difficulty: 2 })).live).toBeNull();
  });
});

describe('结回倍数', () => {
  const base = (): GameState => createRun('mult', liveSetup('small'), { ext: true }).state;

  it('1 + 涨跌倍数 ×（当前资产 ÷ 开局资产 − 1）：借款要扣掉；封顶 3 倍；破产为 0；扣成负数也是 0', () => {
    const s = base();
    expect(BALANCE.live.tiers.small.lev).toBe(2.8);
    expect(liveStart(s)).toBe(100_000);
    expect(liveMultipleBp(s)).toBe(10_000);
    s.account = 105_432.1;
    expect(liveMultipleBp(s)).toBe(11_520);
    s.account = 900_000;
    expect(liveMultipleBp(s)).toBe(30_000);
    s.account = 150_000;
    s.ext?.loans.push({ id: 'car', amount: 60_000, rate: 0.1, month: 1 });
    expect(liveAssets(s)).toBe(90_000);
    expect(liveMultipleBp(s)).toBe(7_200);
    s.account = 125_000;
    expect(liveMultipleBp(s)).toBe(200);
    s.account = 20_000;
    expect(liveMultipleBp(s)).toBe(0);
    s.account = 150_000;
    s.phase = 'lost';
    expect(liveMultipleBp(s)).toBe(0);
  });

  it('0.10.0 以前开的局没有涨跌倍数，照原来的算式：资产 ÷ 开局资产', () => {
    const s = base();
    const live = s.setup?.live;
    if (live) delete live.lev;
    s.account = 105_432.1;
    expect(liveMultipleBp(s)).toBe(10_543);
  });

  it('结回多少筹码：整数运算，向下取整', () => {
    expect(liveReturn(2_000, 10_000)).toBe(2_000);
    expect(liveReturn(2_000, 10_543)).toBe(2_108);
    expect(liveReturn(2_000, 9_999)).toBe(1_999);
    expect(liveReturn(10_000, 3)).toBe(3);
    expect(liveReturn(200_000, 30_000)).toBe(600_000);
    expect(liveReturn(50_000, 0)).toBe(0);
  });
});

describe('顶栏和档位', () => {
  it('开局设置里记着档位（更早的局按难度认）；顶栏的小牌子按现在的资产算结回约多少；娱乐局没有', () => {
    const s = createRun('bar', liveSetup('mid', 'retiree'), { ext: true }).state;
    expect(liveTierOf(s)?.id).toBe('mid');
    expect(liveTierOf(createRun('bar', liveSetup('lux'), { ext: true }).state)?.id).toBe('lux');
    expect(liveTierOf(createRun('bar', { persona: 'newbie', difficulty: 4, live: { months: 6, billMult: 0.25 } }).state)?.id).toBe('lux');
    expect(topBar(s).live).toEqual({ tierName: '中档', stake: 10_000, value: 10_000 });
    s.account = 84_000;
    expect(liveValue(s)).toBe(11_750);
    expect(topBar(s).live?.value).toBe(11_750);
    const ent = createRun('bar', { persona: 'retiree', difficulty: 2 }, { ext: true }).state;
    expect(liveTierOf(ent)).toBeNull();
    expect(liveValue(ent)).toBeNull();
    expect(topBar(ent).live).toBeNull();
  });

  it('正常从界面开的实盘局：只有人设、难度、实盘规则', () => {
    expect(isCleanLiveSetup(liveSetup('lux', 'coder'))).toBe(true);
    expect(isCleanLiveSetup({ ...liveSetup('small'), account: 1 })).toBe(false);
    expect(isCleanLiveSetup({ persona: 'newbie', difficulty: 1 })).toBe(false);
    expect(isCleanLiveSetup(null)).toBe(false);
  });
});
