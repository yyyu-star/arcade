import { describe, expect, it } from 'vitest';
import { CHAR_FX } from '../src/content/meta.ts';
import { MARKET_GOODS, MARKET_PRICE, NIGHT_MARKET } from '../src/content/market.ts';
import { createWorld, Ev, step, type Setup, type World } from '../src/core/index.ts';

const M = NIGHT_MARKET;
const make = (o: Partial<Setup> = {}): World => createWorld({ seed: 21, mode: 'vigil', danger: 0, ...o });
/** 跳到某一拍前（只为测夜市的时间点；主角无敌，选卡就选第一张） */
function runTo(w: World, tick: number, from = tick - 400): number[] {
  const seen: number[] = [];
  w.tick = Math.max(w.tick, from);
  while (w.tick < tick && w.phase !== 'over') {
    w.invuln = 1e9;
    step(w, 0, w.phase === 'choose' ? 0 : -1);
    for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === Ev.NightMarket) seen.push(w.ev.a[i]!, w.tick);
  }
  return seen;
}

describe('守夜夜市（10-20）', () => {
  it('5:00 前 5 秒预告、5:00 开、开 20 秒收；10:00 再一次', () => {
    const w = make();
    const at = M.at[0]!;
    const ev = runTo(w, at + M.open + 2, at - 400);
    expect(ev).toEqual([0, at - M.warn, 1, at, 2, at + M.open]);
    expect(w.mkIndex).toBe(1);
    runTo(w, M.at[1]! + 1);
    expect(w.mkPhase).toBe(2);
  });
  it('更夫提前 10 秒预告、多开 5 秒', () => {
    const w = make({ character: 'gengfu' });
    const at = M.at[0]!;
    const ev = runTo(w, at + M.open + CHAR_FX.gengfuMarketLonger + 2, at - 600);
    expect(ev).toEqual([0, at - M.warn - CHAR_FX.gengfuMarketWarn, 1, at, 2, at + M.open + CHAR_FX.gengfuMarketLonger]);
  });
  it('三摊不重样；站在摊前一会儿、钱够就买下，钱不够不读条', () => {
    const w = make();
    runTo(w, M.at[0]! + 1);
    expect(new Set(w.mkGood).size).toBe(w.mkGood.length);
    expect(w.mkGood.length).toBe(M.stalls);
    w.x = w.mkX[0]!;
    w.y = w.mkY[0]!;
    w.coins = w.mkPrice[0]! - 1;
    for (let t = 0; t < M.hold + 5; t++) step(w, 0, w.phase === 'choose' ? 0 : -1), (w.x = w.mkX[0]!), (w.y = w.mkY[0]!), (w.invuln = 1e9);
    expect(w.mkSold[0]).toBe(0);
    w.coins = w.mkPrice[0]! + 7;
    for (let t = 0; t < M.hold + 5; t++) step(w, 0, w.phase === 'choose' ? 0 : -1), (w.x = w.mkX[0]!), (w.y = w.mkY[0]!), (w.invuln = 1e9);
    expect(w.mkSold[0]).toBe(1);
    expect(w.coins).toBeLessThanOrEqual(7 + 50); // 买完剩 7（这几拍可能顺手捡到铜钱）
  });
  it('第二次贵 1.5 倍，采药女打九折', () => {
    const base = (w: World): number[] => w.mkGood.map((g) => MARKET_PRICE[MARKET_GOODS[g]!]);
    const a = make();
    runTo(a, M.at[0]!);
    a.mkPrice.forEach((p, k) => expect(p).toBe(base(a)[k]));
    runTo(a, M.at[1]!);
    a.mkPrice.forEach((p, k) => expect(p).toBe(Math.ceil(base(a)[k]! * M.later)));
    const c = make({ character: 'caiyao' });
    runTo(c, M.at[0]!);
    c.mkPrice.forEach((p, k) => expect(p).toBe(Math.ceil(base(c)[k]! * CHAR_FX.caiyaoMarket)));
  });
  it('买到伤害增益：伤害 +15% 持续 60 秒，到点恢复', () => {
    // 符师：小道士每 5 级涨伤害，会混进来
    const w = make({ character: 'fushi' });
    runTo(w, M.at[0]! + 1);
    const m0 = w.stats.might;
    // 把第一摊换成伤害增益、价格 0，站上去买
    w.mkGood[0] = MARKET_GOODS.indexOf('might');
    w.mkPrice[0] = 0;
    for (let t = 0; t < M.hold + 2; t++) step(w, 0, w.phase === 'choose' ? 0 : -1), (w.x = w.mkX[0]!), (w.y = w.mkY[0]!), (w.invuln = 1e9);
    expect(w.mkSold[0]).toBe(1);
    expect(w.stats.might).toBeCloseTo(m0 * (1 + M.might), 6);
    runTo(w, w.mightUntil + 1, w.tick);
    expect(w.stats.might).toBeCloseTo(m0, 6);
  });
  it('实盘局暂不开夜市', () => {
    const w = make({ live: true });
    expect(runTo(w, M.at[0]! + 2)).toEqual([]);
  });
});
