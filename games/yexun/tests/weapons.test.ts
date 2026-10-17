import { describe, expect, it } from 'vitest';
import { MERGES, WEAPON_IDS, WEAPONS } from '../src/content/weapons.ts';
import { createWorld, Ev, grantWeapon, openChestNow, step } from '../src/core/index.ts';

// 每件法器单独拿着（满级），原地站 40 秒：都要打出伤害、杀得了怪，事件里有它自己的特效
describe('法器', () => {
  for (const id of WEAPON_IDS) {
    it(`${WEAPONS[id].name}：单独拿着能打能杀`, () => {
      const w = createWorld({ seed: 3, mode: 'vigil', danger: 0 });
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
    const w = createWorld({ seed: 4, mode: 'vigil', danger: 2 });
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
    const w = createWorld({ seed: 5, mode: 'vigil', danger: 2 });
    w.weapons.length = 0;
    w.wstats.length = 0;
    grantWeapon(w, 'rope', 1);
    // 只看绳子的效果：站着不动只靠一根 1 级绳子撑不了多久（开局升级放慢以后十几秒就倒），血给足
    w.hp = 1e9;
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

describe('进化和合成', () => {
  const run = (id: (typeof WEAPON_IDS)[number], evolved: boolean): number => {
    const w = createWorld({ seed: 3, mode: 'vigil', danger: 0 });
    w.weapons.length = 0;
    w.wstats.length = 0;
    grantWeapon(w, id, 8, evolved);
    while (w.tick < 30 * 40 && w.phase !== 'over') step(w, 0, w.phase === 'choose' ? 0 : -1);
    return w.weapons.find((x) => x.id === id)!.dmg;
  };
  for (const id of WEAPON_IDS) {
    it(`${WEAPONS[id].evolve!.name}：进化后打得比满级多`, () => {
      expect(run(id, true)).toBeGreaterThan(run(id, false));
    }, 30_000);
  }

  it('两件都进化了，宝箱合成，空出一个法器格', () => {
    for (const m of MERGES) {
      const w = createWorld({ seed: 1, mode: 'vigil', danger: 0 });
      w.weapons.length = 0;
      w.wstats.length = 0;
      grantWeapon(w, m.a, 8, true);
      grantWeapon(w, m.b, 8, true);
      openChestNow(w);
      expect(w.merges).toContain(m.id);
      expect(w.ev.type.slice(0, w.ev.n)).toContain(Ev.Merge);
      // 再开不会重复合成
      openChestNow(w);
      expect(w.merges.filter((x) => x === m.id).length).toBe(1);
    }
  });

  it('合成以后照样能凑满 7 件法器', () => {
    const w = createWorld({ seed: 2, mode: 'vigil', danger: 0 });
    w.weapons.length = 0;
    w.wstats.length = 0;
    grantWeapon(w, 'sword', 8, true);
    grantWeapon(w, 'flysword', 8, true);
    openChestNow(w);
    for (const id of ['talisman', 'coins', 'mirror', 'bell', 'rope'] as const) grantWeapon(w, id, 1);
    expect(w.weapons.length).toBe(7);
    // 跑一阵不出错（第 7 格的命中冷却不越界）
    while (w.tick < 30 * 30 && w.phase !== 'over') step(w, 0, w.phase === 'choose' ? 0 : -1);
    expect(w.weapons[6]!.dmg).toBeGreaterThan(0);
  }, 20_000);
});
