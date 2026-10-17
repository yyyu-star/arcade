import { describe, expect, it } from 'vitest';
import { loadSave, recordRun } from '../src/platform/save.ts';

// 测试环境没有 localStorage：读档退回空档、写档静默失败，正好也测了"存储不可用照常能玩"
describe('本机存档', () => {
  it('没有存储时给空档', () => {
    const s = loadSave();
    expect(s.runs).toBe(0);
    expect(s.difficulty).toBe('easy');
  });
  it('纪录：赢了的比没赢的好，同样没赢比撑的时间；认输只记局数', () => {
    const s = loadSave();
    expect(recordRun(s, 'normal', { ticks: 300, kills: 10, won: false })).toBe(true);
    expect(recordRun(s, 'normal', { ticks: 200, kills: 99, won: false })).toBe(false);
    expect(recordRun(s, 'normal', { ticks: 9000, kills: 1, won: false }, false)).toBe(false);
    expect(s.best.normal?.ticks).toBe(300);
    expect(recordRun(s, 'normal', { ticks: 27000, kills: 5, won: true })).toBe(true);
    expect(recordRun(s, 'normal', { ticks: 400, kills: 500, won: false })).toBe(false);
    expect(s.runs).toBe(5);
    expect(s.wins).toBe(1);
  });
});

describe('局外成长（第 5 步）', () => {
  const end = (over: Partial<import('../src/platform/save.ts').RunEnd> = {}) => ({ id: 'r' + Math.floor(Math.abs(over.ticks ?? 1)), danger: 0 as const, won: false, quit: false, ticks: 3000, kills: 50, coins: 30, curses: 0, ...over });
  it('第一局至少给够买一级最便宜加成的铜钱；咒印每条多 25%', async () => {
    const { fresh, finishRun, coins, buyPerk } = await import('../src/platform/save.ts');
    const { FIRST_RUN_COINS, PERKS } = await import('../src/content/meta.ts');
    const s = fresh();
    expect(finishRun(s, end({ id: 'a' })).coins).toBe(FIRST_RUN_COINS);
    expect(Math.min(...Object.values(PERKS).map((p) => p.cost[0]!))).toBeLessThanOrEqual(FIRST_RUN_COINS);
    expect(finishRun(s, end({ id: 'b', coins: 100, curses: 2 })).coins).toBe(150);
    expect(coins(s)).toBe(FIRST_RUN_COINS + 150);
    expect(buyPerk(s, 'liliang', 'x')).toBe(true);
    expect(s.perks.liliang).toBe(1);
    expect(coins(s)).toBe(FIRST_RUN_COINS + 150 - PERKS.liliang.cost[0]!);
  });
  it('钱不够买不了；全退把花的都还回来', async () => {
    const { fresh, finishRun, coins, buyPerk, refundPerks } = await import('../src/platform/save.ts');
    const s = fresh();
    finishRun(s, end({ id: 'a', coins: 400 }));
    const before = coins(s);
    expect(buyPerk(s, 'liliang', '1')).toBe(true);
    expect(buyPerk(s, 'liliang', '2')).toBe(true);
    expect(buyPerk(s, 'kapian', '3')).toBe(false);
    refundPerks(s, 'r');
    expect(s.perks).toEqual({});
    expect(coins(s)).toBe(before);
  });
  it('危险档：第一局锁 0，撑到天亮解锁下一档；连死 3 局问一次降低伤害', async () => {
    const { fresh, finishRun, dangerOpen } = await import('../src/platform/save.ts');
    const s = fresh();
    expect(dangerOpen(s)).toBe(0);
    s.runs = 1;
    expect(dangerOpen(s)).toBe(0);
    expect(finishRun(s, end({ id: 'w', won: true })).unlockedDanger).toBe(1);
    expect(dangerOpen(s)).toBe(1);
    expect(finishRun(s, end({ id: 'd1' })).askAssist).toBe(false);
    expect(finishRun(s, end({ id: 'd2' })).askAssist).toBe(false);
    expect(finishRun(s, end({ id: 'd3' })).askAssist).toBe(true);
    expect(finishRun(s, end({ id: 'd4' })).askAssist).toBe(false);
  });
  it('角色解锁按成绩和铜钱', async () => {
    const { fresh, charOpen, buyChar, finishRun } = await import('../src/platform/save.ts');
    const s = fresh();
    expect(charOpen(s, 'fushi')).toBe(false);
    finishRun(s, end({ id: 'a', ticks: 600 * 30, kills: 1500, coins: 800 }));
    expect(charOpen(s, 'fushi')).toBe(true);
    expect(charOpen(s, 'jianxia')).toBe(true);
    expect(buyChar(s, 'pang', 'n')).toBe(true);
    expect(charOpen(s, 'pang')).toBe(true);
  });
  it('云存档合并：流水按 id 并集，两台设备各赚各花不丢不重；坏数据读成默认', async () => {
    const { fresh, finishRun, coins, mergeSave, reviveSave, buyPerk } = await import('../src/platform/save.ts');
    const a = fresh();
    finishRun(a, end({ id: 'shared', coins: 500 }));
    const b = reviveSave(JSON.parse(JSON.stringify(a)))!;
    finishRun(a, end({ id: 'onA', coins: 200 }));
    finishRun(b, end({ id: 'onB', coins: 300 }));
    buyPerk(b, 'tipo', 'b1');
    const m = mergeSave(a, b);
    expect(coins(m)).toBe(500 + 200 + 300 - 100);
    expect(m.perks.tipo).toBe(1);
    expect(mergeSave(m, m).ledger.length).toBe(m.ledger.length);
    expect(reviveSave({ v: 1, ledger: [['x', 'bad'], 5], perks: { liliang: 99 }, curses: ['dark', 'nope'] })).toMatchObject({ ledger: [], perks: { liliang: 5 }, curses: ['dark'] });
    expect(reviveSave('junk')).toBe(null);
  });
});
