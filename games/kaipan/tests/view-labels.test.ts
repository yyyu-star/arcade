import { describe, expect, it } from 'vitest';
import { BALANCE, baseBill, createRun, dispatch, runSummary, titleFor, totalDays } from '../src/core/index.ts';
import {
  ABOUT_CONTROLS,
  TURN_LABEL,
  aboutRules,
  billLine,
  billStatus,
  boardsText,
  buyKey,
  claimSign,
  dayLabel,
  endSubtitle,
  holdText,
  ledgerRows,
  sellKey,
  shortItemName,
  stText,
  summaryRows,
  todayText,
  tradeWord,
} from '../src/view/labels.ts';

describe('画面文案：顶栏', () => {
  it('日期与月供', () => {
    expect(dayLabel({ month: 3, day: 2, daysInMonth: 5 })).toBe('3月 2/5');
    expect(billLine({ amount: 15_600, daysLeft: 4 })).toBe('这个月要还 ¥1.56万 · 还剩 4 天');
    expect(billLine({ amount: 3000, daysLeft: 1 })).toBe('这个月要还 ¥3,000 · 还剩 1 天');
  });

  it('月供状态：宽裕、偏紧、不够、信用卡兜底', () => {
    expect(billStatus({ amount: 10_000, account: 100_000, credit: false })).toEqual({ status: 'ok', text: '' });
    expect(billStatus({ amount: 10_000, account: 11_000, credit: false }).status).toBe('tight');
    const short = billStatus({ amount: 10_000, account: 8_000, credit: false });
    expect(short.status).toBe('short');
    expect(short.text).toContain('¥2,000');
    expect(billStatus({ amount: 10_000, account: 8_000, credit: true }).status).toBe('credit');
  });

  it('道具短名取前两个字', () => {
    expect(shortItemName('借钱炒股')).toBe('借钱');
    expect(shortItemName('老王的小本本')).toBe('老王');
    expect(shortItemName('手快')).toBe('手快');
  });
});

describe('画面文案：持仓卡与群聊', () => {
  it('今日 / 持有收益', () => {
    expect(todayText(null)).toBe('新买');
    expect(todayText(null, false)).toBe('等开盘');
    expect(todayText(5.2)).toBe('↑5.2%');
    expect(todayText(-3)).toBe('↓3.0%');
    expect(todayText(0.01)).toBe('0.0%');
    expect(holdText(12.34)).toBe('累计 ↑12.3%');
  });

  it('连板与 ST 提示', () => {
    expect(boardsText(0)).toBe('');
    expect(boardsText(1)).toBe('涨停');
    expect(boardsText(3)).toBe('涨停×3');
    expect(stText({ role: 'st', warnings: 1, uncap: 0, delisted: false })).toBe(`退市警告 1/${BALANCE.st.warnings}`);
    expect(stText({ role: 'st', warnings: 0, uncap: 2, delisted: false })).toBe('翻身了！还会涨停 2 天');
    expect(stText({ role: 'leader', warnings: 0, uncap: 0, delisted: false })).toBe('');
  });

  it('消息方向与快捷键', () => {
    expect([claimSign('up'), claimSign('flat'), claimSign('down')]).toEqual([1, 0, -1]);
    expect(Object.keys(TURN_LABEL).sort()).toEqual(['ebb', 'start', 'top']);
    expect(buyKey(0)).toBe('1');
    expect(sellKey(2)).toBe('Shift+3');
  });
});

describe('画面文案：结束页与关于', () => {
  it('小结讲清本钱、账单、炒股净赚、最后剩多少；爆仓与通关的副标题不同', () => {
    let s = createRun('labels-1').state;
    while (s.phase === 'premarket') s = dispatch(s, { type: 'open' }).state;
    const sum = runSummary(s);
    const rows = summaryRows(sum);
    expect(rows.map((r) => r[0])).toEqual(['撑到', '本钱', '炒股净赚', '还掉的账单', '其他（奖励、利息、罚款）', '最后剩', '最高账户', '涨停天数', '最长连续涨停', '大哥带小弟', '最赚的一笔']);
    const won = endSubtitle({ ...sum, won: true, tradeMoney: 102_000, billMoney: 158_000, account: 43_800 });
    expect(won).toContain('上岸');
    expect(won).toContain('炒股净赚');
    expect(won).toContain('账单');
    expect(endSubtitle({ ...sum, won: false, month: 4 })).toContain('4 月');
    // 旧存档没有合计：退回旧说法
    expect(endSubtitle({ ...sum, won: true, tradeMoney: null, billMoney: null })).toContain('12 个月的钱全还上了');
  });

  it('0.18.1 炒股亏了叫「净亏」，账本、副标题说法一致；每笔都亏时不说「最赚」', () => {
    let s = createRun('labels-1').state;
    while (s.phase === 'premarket') s = dispatch(s, { type: 'open' }).state;
    const sum = { ...runSummary(s), tradeMoney: -3_254_200, billMoney: 219_100, otherMoney: 0 };
    expect(tradeWord(-1)).toBe('炒股净亏');
    expect(tradeWord(0)).toBe('炒股净赚');
    expect(ledgerRows(sum).map((r) => r[0])).toContain('炒股净亏');
    expect(endSubtitle({ ...sum, won: true })).toContain('炒股净亏');
    const lossBest = summaryRows({ ...sum, bestTrade: { stockId: 'ai_leader', name: 'x', ret: -3 } });
    expect(lossBest.at(-1)![0]).toBe('亏得最少的一笔');
  });

  it('通关称号按炒股净赚是本钱的几倍评，不按最后剩多少', () => {
    const t = (money: number, account = 40_000): string => titleFor(true, 12, account, { money, start: 100_000 });
    expect(t(20_000)).toBe('惊险上岸');
    expect(t(102_000)).toBe('上岸散户');
    expect(t(150_000)).toBe('大户新秀');
    expect(t(320_000)).toBe('百万韭菜王');
    // 剩的钱多不算数（自定义开局本钱大）；净赚的绝对数大也不算，只看倍数
    expect(titleFor(true, 12, 1_200_000, { money: 10_000, start: 1_000_000 })).toBe('惊险上岸');
    expect(titleFor(true, 12, 54_680_000, { money: 5_936_400, start: 50_000_000 })).toBe('惊险上岸');
    // 旧存档没有炒股合计：仍按剩多少钱
    expect(titleFor(true, 12, 1_200_000)).toBe('百万韭菜王');
    expect(titleFor(false, 2, 0, { money: 50_000, start: 100_000 })).toBe('新韭菜');
  });

  it('玩法简介的数字来自 core', () => {
    const text = aboutRules().join('');
    expect(text).toContain(`大约 ${Math.round(totalDays() / 12)} 个交易日`);
    expect(text).toContain(`能同时拿 ${BALANCE.slots} 只股票`);
    expect(text).toContain(String(Math.round(baseBill(1))).slice(0, 1));
    expect(ABOUT_CONTROLS.length).toBeGreaterThan(2);
  });
});
