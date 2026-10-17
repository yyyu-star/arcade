import { describe, expect, it } from 'vitest';
import { inRects, MAPS, TERRAIN, type MapId } from '../src/content/maps.ts';
import { ARENA, PLAYER } from '../src/content/player.ts';
import { createWorld, fingerprint, grantWeapon, spawnNow, step, type World } from '../src/core/index.ts';

const mk = (map: MapId, seed = 3): World => {
  const w = createWorld({ seed, mode: 'vigil', danger: 0, map });
  w.nextEvent = 1 << 30;
  return w;
};

describe('竹林', () => {
  it('有竹丛，出生点四周空着，竹丛之间能走过去', () => {
    const w = mk('bamboo');
    expect(w.blocks.length).toBeGreaterThan(40);
    const C = ARENA.w / 2;
    for (const b of w.blocks) {
      expect(b.look).toBe('bamboo');
      expect((b as { hp?: number }).hp).toBeGreaterThan(0);
      expect(Math.abs(b.x + b.w / 2 - C) > 200 || Math.abs(b.y + b.h / 2 - C) > 200).toBe(true);
    }
  });

  it('桃木剑砍几下竹子就倒，倒了的怪和主角都走得过去，不会长回来', () => {
    const w = mk('bamboo');
    const k = w.allBlocks.findIndex((b) => b.look === 'bamboo');
    const b = w.allBlocks[k]!;
    const before = w.blocks.length;
    // 站在竹丛右边，桃木剑朝面前和身后各挥一下，竹丛在身后那一道里
    w.x = b.x + b.w + 50;
    w.y = b.y + b.h / 2;
    spawnNow(w, 'paper', w.x + 60, w.y);
    let fell = false;
    for (let t = 0; t < 900 && !fell; t++) {
      step(w, 0, 0);
      w.hp = 100;
      // 怪被打死就补一只（保证法器一直出手）
      if (w.eCount === 0) spawnNow(w, 'paper', w.x + 40, w.y);
      fell = w.blockHp[k]! <= 0;
    }
    expect(fell).toBe(true);
    expect(w.blocks.length).toBeLessThan(before);
    expect(w.blocks.includes(b)).toBe(false);
    // 倒了以后主角能站进原来的位置
    w.x = b.x + b.w / 2;
    w.y = b.y + b.h / 2;
    step(w, 1, 0);
    expect(Math.abs(w.x - (b.x + b.w / 2)) + Math.abs(w.y - (b.y + b.h / 2))).toBeLessThan(10);
    for (let t = 0; t < 300; t++) step(w, 0, 0), (w.hp = 100);
    expect(w.blockHp[k]).toBe(0);
    expect(w.blocks.includes(b)).toBe(false);
  });

  it('没倒的竹子挡得住主角', () => {
    const w = mk('bamboo');
    const b = w.allBlocks.find((q) => q.look === 'bamboo' && q.y + q.h < ARENA.h / 2 - 300)!;
    w.x = b.x + b.w / 2;
    w.y = b.y + b.h + PLAYER.r + 2;
    for (let t = 0; t < 60; t++) step(w, 25, 0);
    expect(w.y).toBeGreaterThanOrEqual(b.y + b.h + PLAYER.r - 0.5);
  });
});

describe('河滩', () => {
  it('水里走得比岸上慢；桥上不慢', () => {
    const w = mk('riverbank');
    const r = MAPS.riverbank.water![0]!;
    const run = (x: number, y: number): number => {
      w.x = x;
      w.y = y;
      step(w, 1, 0); // 向右
      return w.x - x;
    };
    const land = run(1600, 1600);
    const wet = run(r.x + 100, r.y + r.h / 2);
    expect(wet / land).toBeCloseTo(TERRAIN.waterMul, 3);
    const br = MAPS.riverbank.bridges![1]!;
    expect(run(br.x + br.w / 2 - 20, br.y + br.h / 2) / land).toBeCloseTo(1, 3);
    expect(inRects(MAPS.riverbank.water, br.x + br.w / 2, br.y + br.h / 2)).toBe(false);
  });

  it('怪进水也慢', () => {
    const w = mk('riverbank');
    const r = MAPS.riverbank.water![0]!;
    const go = (x: number, y: number): number => {
      w.x = x + 400;
      w.y = y;
      const i = spawnNow(w, 'paper', x, y);
      const x0 = w.eX[i]!;
      step(w, 0, 0);
      return w.eX[i]! - x0;
    };
    const wet = go(r.x + 100, r.y + r.h / 2);
    const dry = go(300, 1700);
    expect(wet / dry).toBeCloseTo(TERRAIN.waterMul, 1);
  });
});

describe('冰湖', () => {
  it('冰上松手要滑一段才停，雪地上松手立刻停', () => {
    const slide = (map: MapId): number => {
      const w = mk(map);
      for (let t = 0; t < 60; t++) step(w, 1, 0);
      const x1 = w.x;
      for (let t = 0; t < 200; t++) step(w, 0, 0);
      return w.x - x1;
    };
    expect(slide('snow')).toBe(0);
    const d = slide('icelake');
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(400);
  });

  it('冰上起步是逐渐加速的；离开冰面恢复直接走', () => {
    const w = mk('icelake');
    const x0 = w.x;
    step(w, 1, 0);
    const first = w.x - x0;
    expect(first).toBeLessThan(w.stats.speed * 0.2);
    for (let t = 0; t < 420; t++) step(w, 1, 0);
    // 走出冰面（冰面右缘 2640）进了雪地
    expect(inRects(MAPS.icelake.ice, w.x, w.y)).toBe(false);
    const x1 = w.x;
    step(w, 1, 0);
    expect(w.x - x1).toBeGreaterThan(w.stats.speed * 0.99);
    step(w, 0, 0);
    expect(w.pvx).toBe(0);
  });

  it('怪在冰上被打退后也滑得更远', () => {
    const run = (map: MapId): number => {
      const w = mk(map);
      w.x = 1000;
      const i = spawnNow(w, 'paper', 1600, 1600);
      w.eKX[i] = 30;
      w.eSpeed[i] = 0;
      for (let t = 0; t < 40; t++) step(w, 0, 0), (w.x = 1000);
      return w.eX[i]! - 1600;
    };
    expect(run('icelake')).toBeGreaterThan(run('snow') * 1.5);
  });
});

describe('地形的确定性', () => {
  it.each(['bamboo', 'riverbank', 'icelake'] as const)('%s：同种子同输入，指纹逐拍相同', (map) => {
    const play = (): number[] => {
      const w = createWorld({ seed: 11, mode: 'vigil', danger: 1, map });
      grantWeapon(w, 'talisman');
      const out: number[] = [];
      for (let t = 0; t < 1500 && w.phase !== 'over'; t++) {
        if (w.phase === 'choose') {
          step(w, 0, 0);
          continue;
        }
        step(w, 1 + ((t >> 5) % 32), -1);
        w.hp = Math.max(w.hp, 50);
        if (t % 50 === 0) out.push(fingerprint(w));
      }
      return out;
    };
    const a = play();
    expect(a.length).toBeGreaterThan(10);
    expect(play()).toEqual(a);
  });
});
