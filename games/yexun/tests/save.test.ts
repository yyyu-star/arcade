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
  const end = (over: Partial<import('../src/platform/save.ts').RunEnd> = {}) => ({ id: 'r' + Math.floor(Math.abs(over.ticks ?? 1)), danger: 0 as const, won: false, quit: false, ticks: 1000, kills: 30, coins: 30, curses: 0, ...over });
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
  it('一局的铜钱按来源列明细，加起来等于进账；每日首胜一天只给一次', async () => {
    const { fresh, finishRun, coins } = await import('../src/platform/save.ts');
    const { RUN_BONUS } = await import('../src/content/meta.ts');
    const s = fresh();
    finishRun(s, end({ id: 'warm' }));
    const before = coins(s);
    const r = finishRun(s, end({ id: 'w1', danger: 2, won: true, boss: true, ticks: 27_000, kills: 4000, coins: 300, coinBy: { drop: 200, purse: 40, prop: 30, chest: 30 }, day: '2026-10-17' }));
    expect(r.sources.reduce((a, c) => a + c.coins, 0)).toBe(r.coins);
    expect(coins(s) - before).toBe(r.coins);
    expect(r.sources.map((c) => c.label)).toEqual(['捡到的铜钱', '碰碎的摆设', '铜钱袋', '宝箱', '撑了 15 分钟', '打倒 4000 只', '撑到天亮', '打倒尸王', '今天第一次天亮']);
    const k = 1 + RUN_BONUS.dangerStep * 2;
    expect(r.sources[4]!.coins).toBe(Math.floor(15 * RUN_BONUS.perMin * k));
    const again = finishRun(s, end({ id: 'w2', won: true, ticks: 27_000, day: '2026-10-17' }));
    expect(again.sources.some((c) => c.label === '今天第一次天亮')).toBe(false);
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
  it('角色解锁：前三个一开始就有，其余按铜钱 / 守夜 8 分钟 / 夜探撤出', async () => {
    const { fresh, charOpen, buyChar, finishRun } = await import('../src/platform/save.ts');
    const s = fresh();
    for (const c of ['xiaodao', 'fushi', 'jianxia'] as const) expect(charOpen(s, c)).toBe(true);
    expect(charOpen(s, 'gengfu')).toBe(false);
    expect(charOpen(s, 'caiyao')).toBe(false);
    finishRun(s, end({ id: 'a', ticks: 479 * 30, coins: 800 }));
    expect(charOpen(s, 'gengfu')).toBe(false);
    finishRun(s, end({ id: 'b', ticks: 480 * 30 }));
    expect(charOpen(s, 'gengfu')).toBe(true);
    expect(buyChar(s, 'pang', 'n')).toBe(true);
    expect(charOpen(s, 'pang')).toBe(true);
    s.extracts = 1;
    expect(charOpen(s, 'caiyao')).toBe(true);
  });
  it('老存档已经解锁的角色不会被收回（危险 2 通关的更夫、花钱买的胖师叔）', async () => {
    const { fresh, charOpen, reviveSave } = await import('../src/platform/save.ts');
    const s = fresh();
    s.cleared = 2;
    s.bought = ['pang'];
    const old = reviveSave(JSON.parse(JSON.stringify(s)))!;
    expect(old.extracts).toBe(0);
    for (const c of ['gengfu', 'pang'] as const) expect(charOpen(old, c)).toBe(true);
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

describe('上次的模式和镇子（主页一步开始用）', () => {
  it('老存档没有这两项：用默认（守夜、古镇）', async () => {
    const { reviveSave } = await import('../src/platform/save.ts');
    const s = reviveSave({ v: 1, runs: 3 })!;
    expect(s.lastMode).toBe('vigil');
    expect(s.raidTpl).toBe('guzhen');
  });
  it('读得懂就保留，读不懂（含教学镇）回默认', async () => {
    const { reviveSave } = await import('../src/platform/save.ts');
    const a = reviveSave({ v: 1, lastMode: 'raid', raidTpl: 'shansi' })!;
    expect([a.lastMode, a.raidTpl]).toEqual(['raid', 'shansi']);
    const b = reviveSave({ v: 1, lastMode: 'x', raidTpl: 'teach' })!;
    expect([b.lastMode, b.raidTpl]).toEqual(['vigil', 'guzhen']);
  });
  it('只是本机偏好，不进云存档', async () => {
    const { fresh, savePayload } = await import('../src/platform/save.ts');
    const p = savePayload(fresh()) as Record<string, unknown>;
    expect('lastMode' in p).toBe(false);
    expect('raidTpl' in p).toBe(false);
  });
});

describe('实盘守夜也记解锁进度（0.3.11）', () => {
  it('撑过的秒数解锁地图，天亮开下一危险档；不加局数、不发铜钱、不记纪录', async () => {
    const { fresh, recordLiveVigil, mapOpen, coins } = await import('../src/platform/save.ts');
    const { MAP_UNLOCK } = await import('../src/content/maps.ts');
    const s = fresh();
    s.runs = 3;
    const need = MAP_UNLOCK.bamboo!.seconds;
    expect(mapOpen(s, 'bamboo')).toBe(false);
    // 认输按撑到的时间算：差一秒不开
    recordLiveVigil(s, { danger: 2, won: false, ticks: (need - 1) * 30 });
    expect(mapOpen(s, 'bamboo')).toBe(false);
    expect(s.cleared).toBe(-1);
    // 撑到天亮（所有者那一局：中档雪原）
    recordLiveVigil(s, { danger: 2, won: true, ticks: 900 * 30 });
    expect(mapOpen(s, 'bamboo')).toBe(true);
    expect(s.maxSeconds).toBe(900);
    expect(s.cleared).toBe(2);
    expect(s.runs).toBe(3);
    expect(coins(s)).toBe(0);
    expect(s.bestD[2]).toBeUndefined();
    // 低档的天亮不会把已经开过的高档往回改
    recordLiveVigil(s, { danger: 0, won: true, ticks: 900 * 30 });
    expect(s.cleared).toBe(2);
  });
});
