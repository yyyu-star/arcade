import { describe, expect, it } from 'vitest';
import { DANGERS, type Danger } from '../src/content/waves.ts';
import { createWorld, Ev, grantWeapon, spawnNow, step, type World } from '../src/core/index.ts';

/** 只有满级金钟罩、没有刷怪的一局；护罩补满 3 层后放一只怪贴脸 */
function arena(danger: Danger): World {
  const w = createWorld({ seed: 7, mode: 'vigil', danger });
  w.weapons.length = 0;
  w.wstats.length = 0;
  grantWeapon(w, 'shield', 8);
  w.nextEvent = 1e9;
  w.spawnAcc = -1e9;
  w.hp = w.stats.hpMax = 1e6;
  // shieldMax 要等金钟罩第一次出手才写上
  for (let t = 0; t < 3000 && (w.shieldMax === 0 || w.shield < w.shieldMax); t++) step(w, 0, -1);
  return w;
}

/** 怪贴脸、等它打中一下，返回挨打前后的护罩层数和有没有破罩事件 */
function hitBy(danger: Danger, kind: 'shishi' | 'jiangshi'): { before: number; after: number; broke: boolean } {
  const w = arena(danger);
  const before = w.shield;
  w.invuln = 0;
  spawnNow(w, kind, w.x, w.y);
  let broke = false;
  for (let t = 0; t < 30 && w.shield === before; t++) {
    step(w, 0, -1);
    for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === Ev.Shield && w.ev.a[i] === 2) broke = true;
  }
  return { before, after: w.shield, broke };
}

describe('破罩：危险 4、5 的精英一下打碎金钟罩全部层（0.4.7）', () => {
  it('只在危险 4、5 打开；夜探的危险档不带', () => {
    expect(([0, 1, 2, 3, 4, 5] as Danger[]).filter((d) => DANGERS[d].eliteBreak)).toEqual([4, 5]);
  });
  it('危险 4 精英：全部层一下碎掉，报破罩', () => {
    const r = hitBy(4, 'shishi');
    expect(r.before).toBeGreaterThan(1);
    expect(r.after).toBe(0);
    expect(r.broke).toBe(true);
  });
  it('危险 3 精英、危险 4 普通怪：照旧只碎一层', () => {
    for (const [d, k] of [[3, 'shishi'], [4, 'jiangshi']] as const) {
      const r = hitBy(d, k);
      expect(r.after).toBe(r.before - 1);
      expect(r.broke).toBe(false);
    }
  });
});
