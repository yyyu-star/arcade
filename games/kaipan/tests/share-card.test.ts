import { describe, expect, it } from 'vitest';
import { createRun, liveSetup, runSummary, type RunSummary } from '../src/core/index.ts';
import { gameLink, shareData, shareLine } from '../src/view/shareCard.ts';

/** 0.12.0 分享卡写什么（docs/design-share.md）；画法在共用包，冒烟存一张图看。 */

const base = (): RunSummary => ({ ...runSummary(createRun('share-1').state), maxBoards: 0, bestTrade: null, won: false });
const live = (over: Partial<NonNullable<RunSummary['live']>>): RunSummary => {
  const s = runSummary(createRun('share-live', liveSetup('small', 'newbie', 2)).state);
  return { ...s, maxBoards: 0, bestTrade: null, won: false, live: { ...s.live!, ...over } };
};

describe('名场面：按顺序取第一条符合的', () => {
  it('① 实盘结回 ≥ 3 倍（1× 不说杠杆）', () => {
    expect(shareLine(live({ bp: 34_000, gear: 2 }))).toBe('杠杆 ×2，5 个月结回 ×3.40');
    expect(shareLine(live({ bp: 30_000, gear: 1 }))).toBe('5 个月结回 ×3.00');
  });
  it('② 跌到清零线', () => {
    expect(shareLine({ ...live({ bp: 0, gear: 3, margin: true }), month: 2 })).toBe('杠杆 ×3，第 2 个月清零');
  });
  it('③ 连涨 ≥ 3 天 → ④ 最赚一笔 ≥ +50% → ⑤ 娱乐通关 → ⑥ 打法评语', () => {
    const best = { stockId: 'ai_leader', name: '韭菜芯片', ret: 61.5 };
    expect(shareLine({ ...base(), maxBoards: 3, bestTrade: best })).toBe('连涨 3 天，全程坐在车上');
    expect(shareLine({ ...base(), maxBoards: 2, bestTrade: best })).toBe('韭菜芯片一把赚了 61.5%');
    const won = { ...base(), won: true, bestTrade: { ...best, ret: 20 } };
    expect(shareLine(won)).toBe('12 个月的账全还上了');
    expect(shareLine({ ...won, short: true })).toBe('5 个月的账全还上了');
    expect(shareLine(base())).toBe(base().style.line);
    // 实盘赢了不走"账全还上了"，走评语
    const liveWon = { ...live({ bp: 15_000 }), won: true };
    expect(shareLine(liveWon)).toBe(liveWon.style.line);
  });
  it('实盘的几句不催人再来（照结束页的禁用词）', () => {
    const lines = [live({ bp: 70_000, gear: 3 }), live({ bp: 0, gear: 3, margin: true }), live({ bp: 8_000 })].map((s) => [shareLine(s), shareData(s).big.label, shareData(s).text].join(' '));
    for (const t of lines) for (const w of ['回本', '翻本', '再来一把', '就差一点', '马上', '限时']) expect(t).not.toContain(w);
  });
});

describe('大数字和小数据', () => {
  it('实盘：结回倍数（含杠杆）、还上几个月、清零写 ×0', () => {
    const d = shareData(live({ bp: 34_000, gear: 2 }));
    expect(d.title).toBe('实盘小档 · 2,000');
    expect(d.big).toEqual({ value: '×3.40', label: '杠杆 ×2 · 结回几倍' });
    expect(d.stats).toEqual([{ label: '还上', value: '0/5 个月' }]);
    expect(shareData(live({ bp: 0, gear: 3, margin: true })).big).toEqual({ value: '×0', label: '杠杆 ×3 · 跌到清零线' });
    expect(shareData(live({ bp: 12_000, gear: 1 })).big.label).toBe('结回几倍');
  });

  it('娱乐：资产涨跌幅（比例，不是钱数）、结果、人设；最赚的一笔只写赚了的', () => {
    const s = { ...base(), account: base().startAccount * 1.286, won: true };
    const d = shareData(s);
    expect(d.big).toEqual({ value: '28.6%', label: '这局资产涨了' });
    expect(d.title).toBe('完整一年');
    expect(d.stats[0]).toEqual({ label: '结果', value: '通关' });
    expect(d.stats[1]).toEqual({ label: s.personaName, value: s.difficultyName });
    expect(d.stats).toHaveLength(2);
    const lost = shareData({ ...base(), account: base().startAccount * 0.88, month: 3, bestTrade: { stockId: 'ai_leader', name: '韭菜芯片', ret: 12.5 } });
    expect(lost.big).toEqual({ value: '12.0%', label: '这局资产跌了' });
    expect(lost.stats[2]).toEqual({ label: '韭菜芯片', value: '↑12.5%' });
    expect(lost.stats[0]?.value).toBe('撑了 3 个月');
    expect(shareData({ ...base(), bestTrade: { stockId: 'ai_leader', name: '韭菜芯片', ret: -3 } }).stats).toHaveLength(2);
    expect(shareData({ ...base(), short: true }).title).toBe('短局 · 5 个月');
  });

  it('每日挑战：读到名次写名次，没读到写还上几个月；系统分享那句是邀请', () => {
    const s = { ...base(), daily: '2026-10-15', billsPaid: 4 };
    expect(shareData(s).title).toBe('每日挑战 10/15');
    expect(shareData(s).stats[0]).toEqual({ label: '还上', value: '4/12 个月' });
    expect(shareData(s, 3).stats[0]).toEqual({ label: '今天', value: '第 3 名' });
    expect(shareData(s, 3).text).toBe('开盘每日挑战 · 今天第 3 名，同一局你来试试');
  });

  it('交给共用包的固定部分：游戏名、主题色、小数据不超过 3 条', () => {
    const d = shareData({ ...base(), daily: '2026-10-15', bestTrade: { stockId: 'ai_leader', name: '韭菜芯片', ret: 30 } }, 1);
    expect(d.game).toBe('开盘');
    expect(d.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.stats.length).toBeLessThanOrEqual(3);
    expect(d.artKey).toContain('ai_leader');
  });

  it('放得下：小数据的值不超过 6.5 个字宽，名场面模板不超过 16 个字宽（共用包按宽截断、引号跟着折行）', () => {
    // 汉字记 1，数字、字母、符号约半个字宽
    const width = (t: string): number => [...t].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0);
    const best = { stockId: 'ai_leader', name: '韭菜芯片', ret: 61.5 };
    const cases = [
      live({ bp: 70_000, gear: 3 }),
      { ...live({ bp: 0, gear: 3, margin: true }), month: 12 },
      { ...base(), maxBoards: 12 },
      { ...base(), bestTrade: best },
      { ...base(), won: true, daily: '2026-10-15' },
      { ...base(), month: 12, bestTrade: best },
    ];
    for (const c of cases) {
      const d = shareData(c, 9999);
      if (c.style.line !== d.line) expect(width(d.line!), d.line).toBeLessThanOrEqual(16);
      for (const x of d.stats) expect(width(x.value), x.value).toBeLessThanOrEqual(6.5);
    }
  });
});

describe('分享出去的游戏地址', () => {
  it('按当前页面推，去掉参数，归到游戏首页', () => {
    expect(gameLink('https://game.example.com/games/kaipan/?debug=1#x')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('https://game.example.com/games/kaipan/index.html?seed=1')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('https://game.example.com/games/kaipan')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
  });
});
