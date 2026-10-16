import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  DIFFICULTIES,
  PERSONAS,
  achievementById,
  baseBill,
  baseMarketRules,
  createRun,
  crashPlan,
  credibility,
  recCredibility,
  difficultiesView,
  dispatch,
  fx,
  marketRulesFor,
  moveStocks,
  personaView,
  personasView,
  rngFor,
  rulesFor,
  rulesOf,
  surprisePlan,
  topBar,
  type GameEvent,
  type GameState,
} from '../src/core/index.ts';
import { must } from './helpers.ts';

function regularBill(s: GameState): number {
  return s.bill.amount - (s.bill.extras ?? []).reduce((a, x) => a + x.amount, 0);
}

function advance(s: GameState, stop: (s: GameState) => boolean, limit = 400): { state: GameState; events: GameEvent[] } {
  let st = s;
  let ev: GameEvent[] = [];
  for (let i = 0; i < limit && !stop(st) && st.phase !== 'won' && st.phase !== 'lost'; i++) {
    const a = st.phase === 'premarket' ? { type: 'open' as const } : st.phase === 'reward' ? { type: 'skipReward' as const } : { type: 'choose' as const, option: 1 };
    const r = must(st, a);
    st = r.state;
    ev = r.events;
  }
  return { state: st, events: ev };
}

describe('人设（5 个）', () => {
  it('id 固定；3 个开局可选，coder 由银档成就解锁，youzi 由金档成就解锁', () => {
    expect(PERSONAS.map((p) => p.id)).toEqual(['newbie', 'retiree', 'mom', 'coder', 'youzi']);
    const views = personasView();
    expect(views.filter((v) => v.starter).map((v) => v.id)).toEqual(['newbie', 'retiree', 'mom']);
    const coder = personaView('coder').unlockBy;
    const youzi = personaView('youzi').unlockBy;
    expect(coder && achievementById(coder.id).tier).toBe('silver');
    expect(youzi && achievementById(youzi.id).tier).toBe('gold');
    expect(coder && achievementById(coder.id).unlocks).toBe('coder');
    expect(youzi && achievementById(youzi.id).unlocks).toBe('youzi');
    for (const v of views) {
      expect(v.desc.length).toBeGreaterThan(8);
      expect(v.flavor.length).toBeGreaterThan(5);
    }
  });

  it('缺省是职场新人阿韭：10 万、4 格、没有道具（标准开局）', () => {
    const s = createRun('p-newbie').state;
    expect(s.persona).toBe('newbie');
    expect(s.account).toBe(100_000);
    expect(s.slots).toHaveLength(4);
    expect(s.items).toEqual([]);
    expect(topBar(s).personaName).toBe('职场新人阿韭');
  });

  it('退休老周：8 万、自带白马信仰、金融和大消费必定登场、老王可信度 +0.05、常规月供打折', () => {
    for (let i = 0; i < 30; i++) {
      const s = createRun(`p-ret-${i}`, { persona: 'retiree' }).state;
      expect(s.themeIds).toContain('finance');
      expect(s.themeIds).toContain('consumer');
      expect(s.themeIds).toHaveLength(BALANCE.activeThemes);
    }
    const s = createRun('p-ret', { persona: 'retiree' }).state;
    const base = createRun('p-ret', { themes: s.themeIds }).state;
    expect(s.account).toBe(fx('retiree', 'account'));
    expect(s.items).toEqual(['baima']);
    expect(s.stats.itemsTaken).toEqual([]);
    // 加成体现在荐股眼光上；消息可信度叠加之后封顶 credMax（不会"必中"）
    expect(recCredibility(s, 'laowang', 'finance', rulesOf(s))).toBeCloseTo(recCredibility(base, 'laowang', 'finance', rulesOf(base)) + 0.05);
    expect(credibility(s, 'laowang', 'finance', rulesOf(s))).toBe(BALANCE.chat.credMax);
    expect(fx('retiree', 'billMult')).toBeLessThan(1);
    expect(regularBill(s)).toBe(Math.round((baseBill(1) * fx('retiree', 'billMult')) / 100) * 100);
  });

  it('宝妈芳姐：9.4 万、自带打新中签、张姐可信度 +0.1', () => {
    const s = createRun('p-mom', { persona: 'mom' }).state;
    const base = createRun('p-mom', { themes: s.themeIds }).state;
    expect(s.items).toEqual(['ipo']);
    expect(s.account).toBeCloseTo(fx('mom', 'account') * (1 + fx('ipo', 'pct') / 100), 0);
    expect(recCredibility(s, 'zhangjie', 'pharma', rulesOf(s))).toBeCloseTo(recCredibility(base, 'zhangjie', 'pharma', rulesOf(base)) + 0.1);
    expect(credibility(s, 'zhangjie', 'pharma', rulesOf(s))).toBeLessThanOrEqual(BALANCE.chat.credMax);
    expect(regularBill(s)).toBe(Math.round((baseBill(1) * fx('mom', 'billMult')) / 100) * 100);
  });

  it('程序员小码：9.7 万、自带情绪指标、AI 必定登场；每天只能买 1 只（手快也没用，奖励里不出手快）', () => {
    const s = createRun('p-coder', { persona: 'coder', items: ['double_buy'] }).state;
    expect(s.account).toBe(fx('coder', 'account'));
    expect(s.items).toContain('mood_meter');
    expect(s.themeIds).toContain('ai');
    expect(s.today.buysLeft).toBe(1);
    expect(rulesFor(['double_buy'], 1, 'coder').buysPerDay).toBe(1);
    // 奖励卡里不会出现手快
    for (let i = 0; i < 30; i++) {
      const r = advance(createRun(`p-coder-${i}`, { persona: 'coder', account: 1e7 }).state, (x) => x.phase === 'reward');
      expect(r.state.reward?.cards.some((c) => c.id === 'double_buy')).toBe(false);
    }
  });

  it('游资大佬：30 万、自带妖股猎人和连板梦；月供和突发账单加倍；群主可信度 −0.1 且喊单更勤', () => {
    const s = createRun('p-youzi', { persona: 'youzi' }).state;
    const base = createRun('p-youzi', { themes: s.themeIds }).state;
    expect(s.account).toBe(fx('youzi', 'account'));
    expect(s.items).toEqual(['yaogu', 'lianban']);
    expect(fx('youzi', 'billMult')).toBeGreaterThan(2);
    expect(regularBill(s)).toBe(Math.round((baseBill(1) * fx('youzi', 'billMult')) / 100) * 100);
    const plan = surprisePlan('p-youzi', 1, 'youzi');
    const plain = surprisePlan('p-youzi');
    plan.forEach((x, i) => expect(x.extra.amount).toBeCloseTo(Math.round(((plain[i]?.extra.amount ?? 0) * fx('youzi', 'surpriseMult')) / 100) * 100, -3));
    expect(credibility(s, 'qunzhu', 'ai', rulesOf(s))).toBeCloseTo(credibility(base, 'qunzhu', 'ai', rulesOf(base)) - 0.1);
    expect(rulesOf(s).friendWeight.qunzhu).toBe(fx('youzi', 'qunzhuWeight'));
    // 群主推荐的占比更高
    let q = 0;
    let qBase = 0;
    for (let i = 0; i < 200; i++) {
      q += createRun(`yz-${i}`, { persona: 'youzi' }).state.today.recs.filter((r) => r.friendId === 'qunzhu').length;
      qBase += createRun(`yz-${i}`).state.today.recs.filter((r) => r.friendId === 'qunzhu').length;
    }
    expect(q).toBeGreaterThan(qBase * 1.2);
  });

  it('非法人设报错', () => {
    expect(() => createRun('x', { persona: 'nobody' as never })).toThrow();
  });
});

describe('难度（市场环境 1..8）', () => {
  it('8 级，id 和名字固定，每级都有说明；第 1 级就是 M0 的数值', () => {
    expect(DIFFICULTIES.map((d) => d.id)).toEqual(['slow_bull', 'choppy', 'bear_market', 'fake_news', 'regulation', 'market_crash', 'inflation', 'doom']);
    expect(DIFFICULTIES.map((d) => d.name)).toEqual(['新手', '普通', '高手', '消息失真', '强监管', '股灾', '通胀', '末日']);
    const views = difficultiesView();
    expect(views.map((v) => v.all.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const v of views) expect(v.desc.length).toBeGreaterThan(2);
    const r1 = rulesFor([], 1);
    expect(r1.billMult).toBe(1);
    expect(r1.credDelta).toBe(0);
    expect(r1.msgNoise).toBe(0);
    expect(r1.rewardCards).toBe(BALANCE.reward.cards);
    expect(marketRulesFor(0, 1)).toEqual(baseMarketRules());
  });

  it('逐级叠加的约束', () => {
    expect(rulesFor([], 2).billMult).toBeCloseTo(fx('choppy', 'billMult'));
    expect(marketRulesFor(1, 2).failMult).toBeCloseTo(fx('choppy', 'failMult'));
    expect(marketRulesFor(1, 2).dHNoise).toBeCloseTo(fx('choppy', 'dHNoise'));
    expect(marketRulesFor(1, 1).dHNoise).toBe(0);
    expect(marketRulesFor(1, 3).bearBias - marketRulesFor(1, 2).bearBias).toBeCloseTo(fx('bear_market', 'bearBias'));
    expect(rulesFor([], 4).msgNoise).toBeCloseTo(fx('fake_news', 'noise'));
    expect(rulesFor([], 4).turnCredMult).toBe(fx('fake_news', 'turnCred'));
    expect(marketRulesFor(1, 5).blowMult).toBeCloseTo(fx('regulation', 'blowMult'));
    expect(marketRulesFor(4, 5).stWarnMult).toBeCloseTo(marketRulesFor(4, 4).stWarnMult * fx('regulation', 'stWarnMult'));
    expect(rulesFor([], 7).billMult).toBeCloseTo(fx('choppy', 'billMult') * fx('inflation', 'billMult'));
    expect(rulesFor([], 3).billMult).toBeCloseTo(fx('choppy', 'billMult'));
    expect(rulesFor([], 7).surpriseMult).toBeCloseTo(fx('inflation', 'surpriseMult'));
    expect(rulesFor([], 8).rewardCards).toBe(fx('doom', 'rewardCards'));
    expect(rulesFor([], 8).eventBadMult).toBeCloseTo(fx('doom', 'badMult'));
    // 高等级包含低等级
    expect(rulesFor([], 8).msgNoise).toBeCloseTo(fx('fake_news', 'noise'));
    expect(marketRulesFor(1, 8).blowMult).toBeCloseTo(fx('regulation', 'blowMult'));
  });

  it('第 8 级：月度奖励只给 2 张', () => {
    const r = advance(createRun('doom-cards', { difficulty: 8, account: 1e7 }).state, (x) => x.phase === 'reward');
    expect(r.state.reward?.cards.length).toBeLessThanOrEqual(2);
    expect(r.state.reward?.cards.length).toBeGreaterThan(0);
  });

  it('强监管：全体股票的炸板率 ×1.5', () => {
    const count = (blowMult: number): number => {
      let n = 0;
      const s = createRun('blow', { themes: ['ai', 'newenergy', 'consumer', 'pharma', 'finance', 'pig'] }).state;
      for (let d = 0; d < 3000; d++) {
        for (const st of Object.values(s.stocks)) {
          st.boards = 2;
          st.delisted = false;
          st.uncap = 0;
          st.warnings = 0;
        }
        const mr = { ...marketRulesFor(1, 1), blowMult };
        const moves = moveStocks({ seed: 'blow', day: d, state: s, themeRet: {}, marketRet: 0, mr, rules: rulesOf(s), held: new Set() });
        n += moves.filter((m) => m.blown).length;
      }
      return n;
    };
    const a = count(1);
    const b = count(1.5);
    expect(b / a).toBeGreaterThan(1.35);
    expect(b / a).toBeLessThan(1.65);
  });

  it('股灾（第 6 级起）：随机一个月月初公布传闻，某个交易日起所有题材提前退潮，收盘后揭晓', () => {
    expect(crashPlan('crash', 5)).toBeNull();
    let checked = 0;
    for (let i = 0; i < 12; i++) {
      const seed = `crash-${i}`;
      const plan = crashPlan(seed, 6);
      expect(plan).not.toBeNull();
      if (!plan) continue;
      expect(BALANCE.crash.months).toContain(plan.month);
      expect(crashPlan(seed, 8)).toEqual(plan);
      // 跑到那个月月初
      const start = advance(createRun(seed, { difficulty: 6, account: 1e9 }).state, (x) => x.month === plan.month && x.phase === 'premarket');
      expect(start.state.notice).toMatchObject({ id: 'crash', month: plan.month });
      expect(start.events.find((e) => e.type === 'marketNotice')).toBeDefined();
      expect(topBar(start.state).notice?.name).toBe('市场传闻');
      // 那个月的账单里多一笔"借钱救急"（按常规月供的比例）
      const bail = start.state.bill.extras?.find((x) => x.id === 'bailout');
      expect(bail).toBeDefined();
      // 出事那天盘前：所有题材都是冷门或退潮，大盘暴跌
      const day = advance(start.state, (x) => x.dayInMonth === plan.dayInMonth && x.phase === 'premarket');
      for (const id of day.state.themeIds) expect(['cold', 'ebb']).toContain(day.state.themes[id]?.stage);
      expect(day.state.today.plan.mood).toBe('bear');
      expect(day.state.today.plan.marketRet).toBeLessThan(BALANCE.crash.marketHit + 2);
      const r = must(day.state, { type: 'open' });
      expect(r.state.lastDay?.crash).toBe(true);
      expect(r.events.find((e) => e.type === 'crashHit')).toMatchObject({ month: plan.month });
      // 下个月传闻撤下
      const next = advance(r.state, (x) => x.month === plan.month + 1 || x.month > plan.month);
      if (next.state.phase === 'premarket') expect(next.state.notice).toBeNull();
      checked += 1;
    }
    expect(checked).toBe(12);
    // 低于 6 级不会有传闻
    const low = advance(createRun('crash-0', { difficulty: 5, account: 1e9 }).state, (x) => x.phase === 'won');
    expect(low.state.stats.crashRet).toBeNull();
  });

  it('难度越高，同一个种子的月供只会更多（同一个人设）', () => {
    let prev = 0;
    for (let lv = 1; lv <= 8; lv++) {
      const s = createRun('bill-mono', { difficulty: lv }).state;
      expect(s.bill.amount).toBeGreaterThanOrEqual(prev);
      prev = s.bill.amount;
    }
  });

  it('非法难度报错；0 按 1 处理', () => {
    expect(() => createRun('x', { difficulty: 9 })).toThrow();
    expect(createRun('x', { difficulty: 0 }).state.difficulty).toBe(1);
    expect(dispatch(createRun('x', { difficulty: 3 }).state, { type: 'open' }).error).toBeNull();
    expect(rngFor('x').next()).toBeLessThan(1);
  });
});

describe('难度的细节规则', () => {
  it('消息失真：群聊消息的说中率向 1/3 靠拢；推荐的眼光不受影响；老王的小本本仍然必中', async () => {
    const s1 = createRun('noise', { difficulty: 1 }).state;
    const s4 = createRun('noise', { difficulty: 4, items: ['notebook'] }).state;
    const noise = fx('fake_news', 'noise');
    const c1 = credibility(s1, 'xiaoli', 'ai', rulesOf(s1));
    expect(credibility(s4, 'xiaoli', 'ai', rulesOf(s4))).toBeCloseTo(c1 * (1 - noise) + noise / 3);
    expect(recCredibility(s4, 'xiaoli', 'ai', rulesOf(s4))).toBeCloseTo(recCredibility(s1, 'xiaoli', 'ai', rulesOf(s1)));
    expect(credibility(s4, 'laowang', 'finance', rulesOf(s4))).toBe(1);
  });

  it('股灾后的报复性反弹：被打下来的题材退潮之后冷门很短（萌芽是否必成看 BALANCE.crash.sureRebound）', async () => {
    const { advanceStage } = await import('../src/core/index.ts');
    const t = { id: 'pharma' as const, heat: 10, history: [10], stage: 'ebb' as const, lastStage: 'ebb' as const, left: 0, sure: false, boost: null, rebound: true };
    const st = { ...t } as Parameters<typeof advanceStage>[0];
    advanceStage(st, marketRulesFor(1, 6), rngFor('rb', 0));
    expect(st.stage).toBe('cold');
    expect(st.left).toBeGreaterThanOrEqual(BALANCE.crash.rebound[0]);
    expect(st.left).toBeLessThanOrEqual(BALANCE.crash.rebound[1]);
    st.left = 0;
    advanceStage(st, marketRulesFor(1, 6), rngFor('rb', 1));
    expect(st.stage).toBe('sprout');
    expect(st.sure).toBe(BALANCE.crash.sureRebound);
    expect(st.rebound).toBe(false);
  });
});

describe('震荡：题材每天的热度变化多一层 ±dHNoise 的来回拉扯', () => {
  it('第 1 级的随机序列不变；第 2 级起每天的热度变化在 阶段范围 ± dHNoise 之内，均值不变', async () => {
    const { rollDH, stageDH } = await import('../src/core/index.ts');
    const t = { id: 'pharma' as const, heat: 50, history: [50], stage: 'rally' as const, lastStage: 'rally' as const, left: 3, sure: false, boost: null };
    const m1 = marketRulesFor(1, 1);
    const m2 = marketRulesFor(1, 2);
    const [lo, hi] = stageDH('rally', 'pharma', m1);
    const n = fx('choppy', 'dHNoise');
    let sum1 = 0;
    let sum2 = 0;
    let wider = false;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const a = rollDH({ ...t }, m1, rngFor('chop', i));
      const b = rollDH({ ...t }, m2, rngFor('chop', i));
      expect(a).toBeGreaterThanOrEqual(Math.round(lo));
      expect(a).toBeLessThanOrEqual(Math.round(hi));
      expect(b).toBeGreaterThanOrEqual(Math.round(lo - n));
      expect(b).toBeLessThanOrEqual(Math.round(hi + n));
      if (b < lo - 1 || b > hi + 1) wider = true;
      sum1 += a;
      sum2 += b;
    }
    expect(wider).toBe(true);
    expect(Math.abs(sum1 / N - sum2 / N)).toBeLessThan(0.3);
  });
});
