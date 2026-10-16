import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, BALANCE, MAX_DIFFICULTY, PERSONAS } from '../src/core/index.ts';
import { parseParams } from '../src/debug/params.ts';
import { presetProfile } from '../src/debug/profiles.ts';
import { reviveProfile } from '../src/platform/profile.ts';
import type { KeyValueStore } from '../src/platform/settings.ts';
import { bestText, dailyBadgeView, dailyTag, dailyText, dailyDate, levelLabel, personaLockText, profileLine } from '../src/view/labels.ts';
import { funSetup, isUnscored, loadLastSetup, loadViewed, markUnscored, saveLastSetup, saveViewed, unscoredResult } from '../src/view/meta/prefs.ts';
import { emptyProfile } from '../src/platform/profile.ts';
import { GRID_MAX, achievementUnlocks, unlocksOf } from '../src/view/meta/unlocks.ts';

function memStore(init: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('长线界面的文字', () => {
  it('日期、难度、纪录', () => {
    // 按北京时间：UTC 16:00 起算第二天，本机时区不影响
    expect(dailyDate(new Date(Date.UTC(2026, 0, 5, 15, 59)))).toBe('2026-01-05');
    expect(dailyDate(new Date(Date.UTC(2026, 0, 5, 16, 0)))).toBe('2026-01-06');
    expect(dailyDate(new Date(Date.UTC(2026, 11, 31, 16, 30)))).toBe('2027-01-01');
    expect(levelLabel(1, '新手')).toBe('第 1 级·新手（最简单）');
    expect(levelLabel(3, '高手')).toBe('第 3 级·高手（难度 3/8）');
    expect(levelLabel(8, '末日')).toBe('第 8 级·末日（最难）');
    expect(dailyTag('2026-10-10')).toBe('每日挑战 10/10');
    expect(bestText(undefined)).toBe('还没玩过');
    expect(bestText({ runs: 3, wins: 0, bestAccount: 0, bestMonths: 5 })).toContain('最多还清 5 个月');
    expect(bestText({ runs: 3, wins: 1, bestAccount: 120000, bestMonths: 12 })).toContain('通关 1 次');
    expect(dailyText(undefined)).toBe('今天还没挑战过');
    expect(dailyText({ attempts: 2, won: false, bestAccount: 0, bestMonths: 4 })).toContain('还清 4 个月');
    // 0.6.9 开始菜单「每日挑战」的小牌子：没打过「新题」，打过有名次写名次，名次读不到（没读、没上榜、1 万名外）写「已打」
    expect(dailyBadgeView(undefined)).toEqual({ text: '新题', fresh: true });
    expect(dailyBadgeView({ attempts: 0 }, 3)).toEqual({ text: '新题', fresh: true });
    expect(dailyBadgeView({ attempts: 1 }, 7)).toEqual({ text: '第7名', fresh: false });
    expect(dailyBadgeView({ attempts: 2 }, null).text).toBe('已打');
    expect(dailyBadgeView({ attempts: 2 }).text).toBe('已打');
    expect(personaLockText(null)).toBe('');
    expect(personaLockText({ name: '数据派', desc: '做点什么' })).toContain('「数据派」');
    expect(profileLine({ runs: 0, wins: 0, maxDifficulty: 1 }, 0, 40, 0, 30)).toContain('快速开始');
    expect(profileLine({ runs: 5, wins: 2, maxDifficulty: 3 }, 12, 40, 4, 30)).toBe('通关 2/5 局 · 已解锁第 3 级 · 图鉴 12/40 · 成就 4/30');
  });
});

describe('画面自己的小记录', () => {
  it('上次开局：读坏了或不认识的回到新手 + 第 1 级 + 短局；0.10.0 以前存的没有短局这一项，也按短局', () => {
    expect(loadLastSetup(memStore())).toEqual({ persona: 'newbie', difficulty: 1, short: true });
    expect(loadLastSetup(memStore({ 'kaipan.setup.last': '{bad' }))).toEqual({ persona: 'newbie', difficulty: 1, short: true });
    expect(loadLastSetup(memStore({ 'kaipan.setup.last': JSON.stringify({ persona: 'nobody', difficulty: 99 }) }))).toEqual({ persona: 'newbie', difficulty: 1, short: true });
    const st = memStore();
    const id = PERSONAS[2]!.id;
    saveLastSetup({ persona: id, difficulty: 4, short: false }, st);
    expect(loadLastSetup(st)).toEqual({ persona: id, difficulty: 4, short: false });
  });

  it('娱乐开局设置：短局带上 BALANCE.short 的规则和这一级的首付比例，完整一年只有人设和难度', () => {
    expect(funSetup({ persona: 'newbie', difficulty: 2, short: false })).toEqual({ persona: 'newbie', difficulty: 2 });
    expect(funSetup({ persona: 'newbie', difficulty: 2, short: true })).toEqual({
      persona: 'newbie',
      difficulty: 2,
      short: { months: BALANCE.short.months, billMult: BALANCE.short.billMult, goal: BALANCE.short.goal[1] },
    });
    // 高手之后的几级沿用最后一个比例
    expect(funSetup({ persona: 'newbie', difficulty: 8, short: true }).short?.goal).toBe(BALANCE.short.goal.at(-1));
  });
  it('图鉴看过的：只留字符串', () => {
    const st = memStore({ 'kaipan.codex.viewed.v1': JSON.stringify({ stocks: ['a', 3], items: 'x' }) });
    expect(loadViewed(st)).toEqual({ stocks: ['a'], friends: [], items: [], events: [], achievements: [] });
    saveViewed({ stocks: [], friends: ['f'], items: [], events: [], achievements: [] }, st);
    expect(loadViewed(st).friends).toEqual(['f']);
  });
});

describe('调试局标记', () => {
  it('按种子 + 开局设置认局，清除后不再算调试局', () => {
    const st = memStore();
    const a = { seed: 's1', setup: { persona: 'newbie' as const, difficulty: 2 } };
    expect(isUnscored(a, st)).toBe(false);
    markUnscored(a, st);
    expect(isUnscored(a, st)).toBe(true);
    expect(isUnscored({ seed: 's1', setup: null }, st)).toBe(false);
    markUnscored(null, st);
    expect(isUnscored(a, st)).toBe(false);
    const r = unscoredResult(emptyProfile());
    expect(r.ignored).toBe('debug');
    expect(r.newAchievements).toEqual([]);
  });
});

describe('结束页的弹窗顺序', () => {
  it('成就合并成格子，之后是人设、难度', () => {
    expect(achievementUnlocks([])).toEqual([]);
    expect(achievementUnlocks(['a'])).toEqual([{ kind: 'achievement', id: 'a' }]);
    const many = Array.from({ length: GRID_MAX + 2 }, (_, i) => `a${i}`);
    const u = achievementUnlocks(many);
    expect(u).toHaveLength(2);
    expect(u[0]).toEqual({ kind: 'achievements', ids: many.slice(0, GRID_MAX) });
    const list = unlocksOf({ ignored: null, newAchievements: ['x', 'y'], newPersonas: ['quant' as never], newDifficulty: 2 });
    expect(list.map((x) => x.kind)).toEqual(['achievements', 'persona', 'difficulty']);
    expect(unlocksOf({ ignored: 'debug', newAchievements: ['x'], newPersonas: [], newDifficulty: null })).toEqual([]);
    expect(unlocksOf(null)).toEqual([]);
  });
});

describe('调试：档案样本与 URL 参数', () => {
  it('全解锁 / 全新 / 玩过几局的档案都能通过档案校验', () => {
    const all = presetProfile('all').profile;
    expect(reviveProfile(JSON.parse(JSON.stringify(all)))).toEqual(all);
    expect(all.personas).toHaveLength(PERSONAS.length);
    expect(all.maxDifficulty).toBe(MAX_DIFFICULTY);
    expect(Object.keys(all.achievements)).toHaveLength(ACHIEVEMENTS.length);
    const fresh = presetProfile('fresh').profile;
    expect(fresh.runs).toBe(0);
    expect(fresh.personas.length).toBeLessThan(PERSONAS.length);
    const part = presetProfile('partial');
    expect(reviveProfile(JSON.parse(JSON.stringify(part.profile)))).toEqual(part.profile);
    expect(part.viewed.stocks.length).toBeLessThan(part.profile.seen.stocks.length);
  });
  it('difficulty 夹到 1..8；persona、daily', () => {
    expect(parseParams('?difficulty=12').setup?.difficulty).toBe(MAX_DIFFICULTY);
    expect(parseParams('?difficulty=0').setup?.difficulty).toBe(1);
    expect(parseParams('?persona=nobody').setup).toBeNull();
    const id = PERSONAS[1]!.id;
    expect(parseParams(`?persona=${id}`).setup?.persona).toBe(id);
    const d = parseParams('?daily=2026-10-10');
    expect(d.seed).toBe('daily-2026-10-10');
    expect(d.setup?.daily).toBe('2026-10-10');
    expect(d.setup?.persona).toBeTruthy();
  });
});
