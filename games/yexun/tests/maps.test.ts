import { describe, expect, it } from 'vitest';
import { ENEMY_BY_KIND } from '../src/content/enemies.ts';
import { MAPS, pushOut } from '../src/content/maps.ts';
import { ARENA, PLAYER } from '../src/content/player.ts';
import { createWorld, spawnNow, step } from '../src/core/index.ts';
import { yizhuangOpen, type Save } from '../src/platform/save.ts';

const inside = (x: number, y: number, r: number): boolean =>
  MAPS.yizhuang.blocks.some((b) => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h && (Math.max(b.x, Math.min(x, b.x + b.w)) - x) ** 2 + (Math.max(b.y, Math.min(y, b.y + b.h)) - y) ** 2 < r * r - 1e-6);

describe('义庄', () => {
  it('挡路的东西都在场地里，出生点附近空着', () => {
    for (const b of MAPS.yizhuang.blocks) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThan(ARENA.w);
      expect(b.y + b.h).toBeLessThan(ARENA.h);
    }
    expect(inside(ARENA.w / 2, ARENA.h / 2, 120)).toBe(false);
  });

  it('推出来以后不再压着墙（从各个方向撞）', () => {
    for (const b of MAPS.yizhuang.blocks) {
      for (const [fx, fy] of [[0.5, 0.5], [0, 0], [1, 1], [0.1, 0.9], [1.05, 0.5], [0.5, -0.05]] as const) {
        const p = { x: b.x + b.w * fx, y: b.y + b.h * fy };
        // 推一次可能推进相邻的另一块，最多推三次
        for (let k = 0; k < 3 && pushOut(MAPS.yizhuang.blocks, p, PLAYER.r); k++);
        expect(inside(p.x, p.y, PLAYER.r)).toBe(false);
      }
    }
  });

  it('主角走不进院墙；怪也推不进棺材', () => {
    const w = createWorld({ seed: 2, mode: 'vigil', difficulty: 'easy', map: 'yizhuang' });
    w.nextEvent = 1 << 30;
    // 一直往上走（方向 25 = 正上），会撞上正堂
    for (let t = 0; t < 400 && w.phase !== 'over'; t++) {
      step(w, 25, 0);
      w.hp = 100;
      expect(inside(w.x, w.y, PLAYER.r - 0.5)).toBe(false);
    }
    expect(w.y).toBeGreaterThan(ARENA.h / 2 - 330);
    const coffin = MAPS.yizhuang.blocks.find((b) => b.look === 'coffin')!;
    const i = spawnNow(w, 'jiangshi', coffin.x + coffin.w / 2, coffin.y + coffin.h / 2);
    step(w, 0, 0);
    expect(inside(w.eX[i]!, w.eY[i]!, w.eR[i]! * 0.7 - 0.5)).toBe(false);
  });

  it('义庄跳尸多；雪原没有挡路的东西', () => {
    const count = (map: 'snow' | 'yizhuang'): number => {
      const w = createWorld({ seed: 4, mode: 'vigil', difficulty: 'easy', map });
      w.weapons.length = 0;
      w.wstats.length = 0;
      let n = 0;
      // 第 4 分钟起跳尸多：直接数补进来的怪
      w.tick = 30 * 240;
      w.nextEvent = 1 << 30;
      for (let t = 0; t < 30 * 20; t++) {
        step(w, 0, 0);
        w.hp = 100;
      }
      for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.eKind[i] === ENEMY_BY_KIND.jiangshi.code) n++;
      return n / w.eCount;
    };
    expect(count('yizhuang')).toBeGreaterThan(count('snow'));
    expect(createWorld({ seed: 1, mode: 'vigil', difficulty: 'easy' }).blocks.length).toBe(0);
  });

  it('普通档以上撑到过天亮才开', () => {
    const s = (best: Save['best']): Save => ({ v: 1, runs: 3, wins: 1, tips: [], tipsOff: false, difficulty: 'easy', map: 'snow', best });
    expect(yizhuangOpen(s({ easy: { ticks: 27000, kills: 1, won: true } }))).toBe(false);
    expect(yizhuangOpen(s({ normal: { ticks: 27000, kills: 1, won: true } }))).toBe(true);
    expect(yizhuangOpen(s({ hard: { ticks: 9000, kills: 1, won: false } }))).toBe(false);
  });
});
