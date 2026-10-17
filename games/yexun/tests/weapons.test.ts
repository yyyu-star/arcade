import { describe, expect, it } from 'vitest';
import { WEAPON_IDS, WEAPONS } from '../src/content/weapons.ts';
import { createWorld, Ev, grantWeapon, step } from '../src/core/index.ts';

// 每件法器单独拿着（满级），原地站 40 秒：都要打出伤害、杀得了怪，事件里有它自己的特效
describe('法器', () => {
  for (const id of WEAPON_IDS) {
    it(`${WEAPONS[id].name}：单独拿着能打能杀`, () => {
      const w = createWorld({ seed: 3, mode: 'vigil', difficulty: 'easy' });
      w.weapons.length = 0;
      w.wstats.length = 0;
      grantWeapon(w, id, 8);
      const seen = new Set<number>();
      while (w.tick < 30 * 40 && w.phase !== 'over') {
        // 升级就选第一张（可能拿到别的法器；伤害只看这一件）
        step(w, 0, w.phase === 'choose' ? 0 : -1);
        for (let i = 0; i < w.ev.n; i++) seen.add(w.ev.type[i]!);
      }
      const o = w.weapons.find((x) => x.id === id)!;
      expect(o.dmg).toBeGreaterThan(0);
      expect(o.kills).toBeGreaterThan(0);
      expect(seen.has(Ev.Hit)).toBe(true);
    }, 20_000);
  }

  it('金钟罩挡下一次伤害、碎的时候震开', () => {
    const w = createWorld({ seed: 4, mode: 'vigil', difficulty: 'normal' });
    grantWeapon(w, 'shield', 1);
    let up = 0;
    let broke = 0;
    while (w.tick < 30 * 60 && w.phase !== 'over') {
      step(w, 0, w.phase === 'choose' ? 0 : -1);
      for (let i = 0; i < w.ev.n; i++) {
        if (w.ev.type[i] === Ev.Shield) {
          if (w.ev.a[i] === 1) up++;
          else broke++;
        }
      }
      expect(w.shield).toBeLessThanOrEqual(w.shieldMax);
    }
    expect(up).toBeGreaterThan(0);
    expect(broke).toBeGreaterThan(0);
  }, 20_000);

  it('缚妖索捆住的怪基本不动（只剩挤开和击退的余量）', () => {
    // 1 级的绳子伤害低，跳尸这类血厚的捆住不会马上死，看得出动没动
    const w = createWorld({ seed: 5, mode: 'vigil', difficulty: 'normal' });
    w.weapons.length = 0;
    w.wstats.length = 0;
    grantWeapon(w, 'rope', 1);
    let bound = 0;
    let boundMove = 0;
    let free = 0;
    let freeMove = 0;
    while (w.tick < 30 * 150 && w.phase !== 'over') {
      step(w, 0, w.phase === 'choose' ? 0 : -1);
      for (let i = 0; i < w.eAlive.length; i++) {
        if (!w.eAlive[i]) continue;
        const m = Math.abs(w.eX[i]! - w.ePX[i]!) + Math.abs(w.eY[i]! - w.ePY[i]!);
        if (m > 100) continue; // 挪到主角前面的圈上
        if (w.eBind[i]! > w.tick) {
          bound++;
          boundMove += m;
        } else {
          free++;
          freeMove += m;
        }
      }
    }
    expect(bound).toBeGreaterThan(0);
    expect(boundMove / bound).toBeLessThan((freeMove / free) * 0.3);
  }, 20_000);
});
