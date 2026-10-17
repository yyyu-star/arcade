import { describe, expect, it } from 'vitest';
import { createRun, dispatch, type GameState, type HoldingMove, type RetPart } from '../src/core/index.ts';
import { newbieHint, streak } from '../src/view/hints.ts';
import { moneyWord, recordText } from '../src/view/labels.ts';
import { hintsOn, loadViewPrefs, saveViewPrefs } from '../src/view/meta/prefs.ts';
import { breakdownOf, headlineOf, reasonOf, recapOf } from '../src/view/recap.ts';
import type { KeyValueStore } from '../src/platform/settings.ts';

const SETUP = { themes: ['ai', 'newenergy', 'consumer', 'pharma', 'lowalt', 'pig'] as never, holdings: ['ai_leader', 'con_blue', 'pig_leader'] };

function day(seed: string, n: number): GameState {
  let s = createRun(seed, SETUP).state;
  for (let i = 0; i < n; i++) s = dispatch(s, { type: 'open' }).state;
  return s;
}

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('小白文案的小工具', () => {
  it('赚亏一句话、群友战绩', () => {
    expect(moneyWord(5890)).toBe('赚了 ¥5,890');
    expect(moneyWord(-1200)).toBe('亏了 ¥1,200');
    expect(moneyWord(0.2)).toBe('没赚没亏');
    expect(recordText('说对 5/7')).toBe('说对 5/7');
    expect(recordText('说中 0/0')).toBe('新来的');
    expect(recordText('新来的')).toBe('新来的');
  });
  it('连涨连跌天数', () => {
    expect(streak([1, 2, 3])).toBe(3);
    expect(streak([3, -1, -2])).toBe(-2);
    expect(streak([2, 0])).toBe(0);
    expect(streak([])).toBe(0);
  });
});

describe('收盘小结', () => {
  it('总账、每只一行，金额加起来等于账户变化（不含账户层效果）', () => {
    const s = day('recap-1', 2);
    const r = s.lastDay!;
    const recap = recapOf(r);
    // 开盘前回看说「昨天」，收盘动画里说「今天」
    expect(recap.headline.startsWith('昨天')).toBe(true);
    expect(recapOf(r, '今天').headline.startsWith('今天')).toBe(true);
    expect(recap.lines).toHaveLength(r.holdings.filter((h) => h.stockId).length);
    const sum = r.holdings.reduce((n, h) => n + h.amount, 0) + r.account.effects.reduce((n, e) => n + e.amount, 0);
    expect(Math.abs(sum - (r.account.after - r.account.before))).toBeLessThan(0.02);
    for (const l of recap.lines) expect(l.why.length).toBeGreaterThan(0);
    // 按金额大小排；有两只以上时第二句讲赚最多 / 亏最多的那只
    const amounts = recap.lines.map((l) => Math.abs(l.amount));
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    if (recap.lines.length > 1) expect(recap.highlight).toMatch(/^(赚最多|亏最多)的是/);
  });
  it('每只只讲 1–2 个最大原因，运气也算，最大的那一项一定在', () => {
    const parts: RetPart[] = [
      { kind: 'theme', value: 3, label: 'AI热度涨了 15，让它涨了 3%' },
      { kind: 'role', value: 1.5, label: '它是带头大哥，又多涨了 1.5%' },
      { kind: 'limit', value: -0.5, label: '涨停了' },
      { kind: 'noise', value: 0.2, label: '运气让它涨了 0.2%' },
    ];
    expect(reasonOf(parts)).toBe('AI热度涨了 15，让它涨了 3%；它是带头大哥，又多涨了 1.5%');
    // 运气最大时也要说出来
    const lucky: RetPart[] = [
      { kind: 'theme', value: 0.4, label: '风口小涨' },
      { kind: 'noise', value: -4, label: '运气不好，让它跌了 4%' },
    ];
    expect(reasonOf(lucky)).toBe('运气不好，让它跌了 4%');
    expect(reasonOf([{ kind: 'noise', value: 0.3, label: '运气' }])).toBe('运气');
    expect(reasonOf([])).toBe('几乎没动');
    // 拆解条按影响大小排
    expect(breakdownOf({ parts, ret: 4.2, amount: 100 }).map((x) => x.value)).toEqual([3, 1.5, -0.5, 0.2]);
  });
  it('总账：有赚有亏两头都说；只有一只按这只说', () => {
    const base = day('recap-3', 1).lastDay!;
    const move = (slot: number, stockId: string, amount: number, ret: number): HoldingMove => ({
      ...base.holdings[0]!,
      slot,
      stockId,
      amount,
      ret,
      parts: [{ kind: 'theme', value: ret, label: `风口让它${ret > 0 ? '涨' : '跌'}了` }],
      lead: null,
    });
    const mixed = { ...base, holdings: [move(0, 'ai_leader', 2387, 8), move(1, 'pig_leader', -1433, -6)], account: { ...base.account, before: 100000, after: 100954, effects: [] } };
    const h = headlineOf(mixed, 954, '昨天');
    expect(h).toContain('昨天净赚 ¥954');
    expect(h).toContain('赚了 ¥2,387');
    expect(h).toContain('亏了 ¥1,433');
    const single = { ...base, holdings: [move(0, 'pig_leader', -580, -3)] };
    expect(headlineOf(single, -580, '今天')).toMatch(/^今天亏了 ¥580，都在.+上：风口让它跌了$/);
    expect(recapOf(single).highlight).toBe('');
  });
  it('押跌那一格说自己的赚亏：被轧时不写成"跌 14.8%（涨停）"', () => {
    const base = day('recap-3', 1).lastDay!;
    const mk = (slot: number, stockId: string, amount: number, ret: number, short: boolean): HoldingMove => ({
      ...base.holdings[0]!,
      slot,
      stockId,
      amount,
      ret,
      short,
      parts: [{ kind: 'theme', value: ret, label: '它涨了 10%，你押它跌，所以亏' }],
      lead: null,
    });
    const stocks = [{ ...base.stocks[0]!, id: 'ai_leader', limitUp: true, limitDown: false, blown: false, boards: 2 }, { ...base.stocks[0]!, id: 'pig_leader', limitUp: false, limitDown: true, blown: false, boards: 0 }];
    const r = { ...base, stocks, holdings: [mk(0, 'ai_leader', -2936, -14.8, true), mk(1, 'pig_leader', 900, 9.9, true), mk(2, 'pig_leader', -300, -10, false)], account: { ...base.account, effects: [] } };
    const recap = recapOf(r);
    expect(recap.lines[0]?.head).toMatch(/押跌亏了 14\.8%（连续涨停 2 天，被轧）$/);
    expect(recap.lines[0]?.head).not.toMatch(/ 跌 /);
    expect(recap.highlight).toMatch(/^亏最多的是.+押跌亏了 14\.8%（连续涨停 2 天，被轧）/);
    expect(recap.lines.find((l) => l.amount === 900)?.head).toMatch(/押跌赚了 9\.9%（跌停）$/);
    // 做多的照旧
    expect(recap.lines.find((l) => l.amount === -300)?.head).toMatch(/ 跌 10\.0%（跌停）$/);
  });
  it('手里没股票时直说', () => {
    const s = day('recap-2', 1);
    const r = { ...s.lastDay!, holdings: [] };
    expect(headlineOf(r, 0)).toContain('没有股票');
  });
});

describe('新手提示', () => {
  it('只在开盘前说，每句都承认是猜的', () => {
    for (let i = 0; i < 4; i++) {
      const h = newbieHint(day(`hint-${i}`, i));
      expect(h).not.toBeNull();
      expect(h!.text).toMatch(/猜|听一半|只猫/);
      expect(h!.text).not.toMatch(/萌芽|发酵|主升|高潮|退潮/);
    }
    const s = day('hint-x', 0);
    expect(newbieHint({ ...s, phase: 'reward' } as GameState)).toBeNull();
  });
  it('前 3 局默认打开，玩家选过就按选的', () => {
    const st = memStore();
    expect(loadViewPrefs(st)).toEqual({ hints: 'auto', recap: 'full', bill: 'stage', autoQuiet: true });
    expect(hintsOn(loadViewPrefs(st), 0)).toBe(true);
    expect(hintsOn(loadViewPrefs(st), 3)).toBe(false);
    saveViewPrefs({ hints: 'on' }, st);
    expect(hintsOn(loadViewPrefs(st), 10)).toBe(true);
    saveViewPrefs({ hints: 'off', recap: 'brief' }, st);
    expect(loadViewPrefs(st)).toEqual({ hints: 'off', recap: 'brief', bill: 'stage', autoQuiet: true });
    // 0.17.0 月底账单可以改成简短，读坏的值按默认（舞台）
    saveViewPrefs({ bill: 'quick' }, st);
    expect(loadViewPrefs(st).bill).toBe('quick');
    st.setItem('kaipan.view.prefs', JSON.stringify({ bill: 'nope' }));
    expect(loadViewPrefs(st).bill).toBe('stage');
  });
});
