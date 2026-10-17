import { describe, expect, it } from 'vitest';
import { createWorld, grantWeapon, Pick, step, type World } from '../src/core/index.ts';
import { Bot } from '../tools/bots.ts';

/** 跑到第一次弹三选一 */
function toChoice(seed: number): World {
  // 原地不动会在第一次升级前被围死，让机器人走位
  const w = createWorld({ seed, mode: 'vigil', difficulty: 'easy' });
  const bot = new Bot('normal', 'sword', seed);
  while (w.phase === 'play' && w.tick < 30 * 120) step(w, bot.act(w).dir, -1);
  if (w.phase !== 'choose') throw new Error(`种子 ${seed} 两分钟内没升级（${w.phase}）`);
  return w;
}

describe('套装', () => {
  it('剑 2 件加暴击，剑 3 件加暴击伤害', () => {
    const w = createWorld({ seed: 1, mode: 'vigil', difficulty: 'easy' });
    expect(w.stats.critAdd).toBe(0);
    grantWeapon(w, 'flysword');
    expect(w.sets).toContain('剑2');
    expect(w.stats.critAdd).toBeGreaterThan(0);
    expect(w.stats.critDmg).toBe(0);
    grantWeapon(w, 'coins');
    expect(w.sets).toContain('剑3');
    expect(w.stats.critDmg).toBeGreaterThan(0);
  });
  it('符 3 件：符类多发一张；同五行 2 件加伤害', () => {
    const w = createWorld({ seed: 1, mode: 'vigil', difficulty: 'easy' });
    w.weapons.length = 0;
    grantWeapon(w, 'talisman');
    grantWeapon(w, 'thunder');
    const before = w.wstats.map((s) => s.amount);
    grantWeapon(w, 'crane');
    expect(w.sets).toContain('符3');
    expect(w.wstats[0]!.amount).toBe(before[0]! + 1);
    // 雷符和桃木剑都是木：2 件以后雷符伤害 +10%
    const d0 = w.wstats[1]!.dmg;
    grantWeapon(w, 'sword');
    expect(w.sets).toContain('木2');
    expect(w.wstats[1]!.dmg).toBeCloseTo(d0 * 1.1, 6);
  });
});

describe('刷新、封禁、跳过', () => {
  it('刷新换一组卡、次数用完就不动', () => {
    const w = toChoice(5);
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) {
      seen.add(JSON.stringify(w.choices));
      step(w, 0, Pick.Reroll);
    }
    expect(w.rerolls).toBe(0);
    expect(seen.size).toBeGreaterThan(1);
    const now = JSON.stringify(w.choices);
    step(w, 0, Pick.Reroll);
    expect(JSON.stringify(w.choices)).toBe(now);
  });
  it('封禁的东西这一局不再出现', () => {
    const w = toChoice(6);
    const id = w.choices[0]!.id;
    step(w, 0, Pick.Ban + 0);
    expect(w.bans).toBe(0);
    expect(w.banned).toContain(id);
    // 之后一直选第一张打到 5 分钟：被封的从没出现
    const bot = new Bot('normal', 'sword', 6);
    while (w.tick < 30 * 300 && w.phase !== 'over') {
      if (w.phase === 'choose') for (const c of w.choices) expect(c.id).not.toBe(id);
      step(w, bot.act(w).dir, w.phase === 'choose' ? 0 : -1);
    }
  }, 20_000);
  it('跳过换一点经验，不拿东西', () => {
    const w = toChoice(7);
    const xp = w.xp;
    const n = w.weapons.length + Object.keys(w.passives).length;
    step(w, 0, Pick.Skip);
    expect(w.weapons.length + Object.keys(w.passives).length).toBe(n);
    expect(w.xp).toBeGreaterThan(xp);
  });
});
