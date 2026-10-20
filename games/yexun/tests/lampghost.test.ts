import { describe, expect, it } from 'vitest';
import { ENEMY_BY_KIND } from '../src/content/enemies.ts';
import { lampShare, type Danger } from '../src/content/waves.ts';
import { WEAPONS } from '../src/content/weapons.ts';
import { createWorld, step, type World } from '../src/core/index.ts';
import { MONSTER_INFO } from '../src/view/ui/codex.ts';
import { counterLine, counters, multiplier } from '../src/view/ui/counters.ts';

const LAMP = ENEMY_BY_KIND.lampghost.code;

/** 在第 minute 分钟开局，走 ticks 拍，数这期间场上最多同时有多少提灯鬼、一共多少只怪（按每拍新增的存活数粗估） */
function census(mode: 'vigil' | 'raid', danger: Danger, minute: number, ticks: number): { lamp: number; all: number } {
  const w: World = createWorld({ seed: 11, mode, danger, ...(mode === 'raid' ? { raid: { template: 'guzhen', tier: 1 } as never } : {}) });
  w.weapons.length = 0;
  w.wstats.length = 0;
  w.nextEvent = 1 << 30;
  w.tick = minute * 60 * 30;
  let lamp = 0;
  let all = 0;
  const seen = new Set<string>();
  for (let t = 0; t < ticks; t++) {
    w.hp = w.stats.hpMax;
    step(w, 0, -1);
    for (let i = 0; i < w.eAlive.length; i++) {
      if (!w.eAlive[i]) continue;
      const key = `${i}:${w.eGen[i]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all++;
      if (w.eKind[i] === LAMP) lamp++;
    }
  }
  return { lamp, all };
}

describe('提灯鬼', () => {
  it('登记：编号接着往后，图鉴有名字，火 ×0.5', () => {
    expect(LAMP).toBe(ENEMY_BY_KIND.lampghost.code);
    expect(MONSTER_INFO.lampghost.name).toBe('提灯鬼');
    expect(ENEMY_BY_KIND.lampghost.vs?.火).toBe(0.5);
    expect(ENEMY_BY_KIND.lampghost.elite).toBeUndefined();
  });

  it('占比：危险 3 起、第 5 分钟起 15%，第 12 分钟起 25%；守夜以外和低档为 0', () => {
    expect(lampShare('vigil', 2, 8)).toBe(0);
    expect(lampShare('vigil', 3, 4.9)).toBe(0);
    expect(lampShare('vigil', 3, 5)).toBe(0.15);
    expect(lampShare('vigil', 4, 11.9)).toBe(0.15);
    expect(lampShare('vigil', 5, 12)).toBe(0.25);
    expect(lampShare('raid', 5, 12)).toBe(0);
  });

  it('刷怪：危险 2 不出；危险 3 第 5 分钟后出，比例在一成半上下；第 4 分钟还不出', () => {
    expect(census('vigil', 2, 8, 900).lamp).toBe(0);
    expect(census('vigil', 3, 4, 900).lamp).toBe(0);
    const c = census('vigil', 3, 8, 900);
    expect(c.lamp).toBeGreaterThan(0);
    expect(c.lamp / c.all).toBeGreaterThan(0.07);
    expect(c.lamp / c.all).toBeLessThan(0.25);
  });

  it('夜探不出（夜探走自己的刷怪表）', () => {
    expect(census('raid', 5, 8, 900).lamp).toBe(0);
  });

  it('伤害：火法器 ×0.5，木 ×1.2，镇 ×1.15，剑不变（1.1 第四轮：克火、不再欺负木流派）', () => {
    const vs = ENEMY_BY_KIND.lampghost.vs;
    const of = (id: keyof typeof WEAPONS): number => multiplier(vs, WEAPONS[id].type, WEAPONS[id].el);
    const fire = Object.values(WEAPONS).find((d) => d.el === '火' && d.type !== '符' && d.type !== '镇')!;
    expect(multiplier(vs, fire.type, '火')).toBeCloseTo(0.5);
    expect(of('petals')).toBeCloseTo(1.2);
    expect(multiplier(vs, '镇', '金')).toBeCloseTo(1.15);
    expect(multiplier(vs, '剑', '金')).toBe(1);
  });
});

describe('选卡的克制小字', () => {
  const name = (k: string): string => MONSTER_INFO[k as keyof typeof MONSTER_INFO].name;
  it('每件法器都有结果，且只有常规怪，克的倍数 > 1、怕的 < 1', () => {
    for (const d of Object.values(WEAPONS)) {
      const { strong, weak } = counters(d.type, d.el);
      expect(strong.length).toBeLessThanOrEqual(2);
      expect(weak.length).toBeLessThanOrEqual(2);
      for (const k of strong) {
        expect(ENEMY_BY_KIND[k].elite || ENEMY_BY_KIND[k].boss).toBeFalsy();
        expect(multiplier(ENEMY_BY_KIND[k].vs, d.type, d.el)).toBeGreaterThan(1);
      }
      for (const k of weak) expect(multiplier(ENEMY_BY_KIND[k].vs, d.type, d.el)).toBeLessThan(1);
    }
  });
  it('火克河蟹、怕提灯鬼；剑怕灯笼鬼、石僧一类的硬怪', () => {
    const fire = counters('灵', '火');
    expect(fire.strong[0]).toBe('crab');
    expect(fire.weak).toContain('lampghost');
    expect(counterLine('灵', '火', name)).toMatch(/^克 .+ · 怕 .*提灯鬼/);
    expect(counters('剑', '金').weak.length).toBeGreaterThan(0);
  });
});
