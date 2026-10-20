import { describe, expect, it } from 'vitest';
import { MERGES, type WeaponId } from '../src/content/weapons.ts';
import { createWorld, Ev, fingerprint, grantWeapon, openChestNow, Shot, spawnNow, step, type World } from '../src/core/index.ts';

/** 干净的一局：只有给定的两件法器，没有怪，刷怪也推到很远以后（测的是双修，不是波次） */
function arena(a: WeaponId, b: WeaponId, merged = true): World {
  const w = createWorld({ seed: 7, mode: 'vigil', danger: 0 });
  w.weapons.length = 0;
  w.wstats.length = 0;
  grantWeapon(w, a, 8, true);
  grantWeapon(w, b, 8, true);
  if (merged) openChestNow(w);
  w.nextEvent = 1e9;
  w.spawnAcc = -1e9;
  w.hp = w.stats.hpMax = 1e6;
  return w;
}

function evSeen(w: World, t: number, a = -1): boolean {
  for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === t && (a < 0 || w.ev.a[i] === a)) return true;
  return false;
}

describe('双修：符剑合璧（飞剑 + 符咒）', () => {
  it('一件进化、另一件满级就在宝箱合成（1.1）；另一件没满级不合成', () => {
    const w = arena('flysword', 'talisman');
    expect(w.merges).toContain('fujian');
    for (const [lv, want] of [[8, true], [7, false]] as const) {
      const v = createWorld({ seed: 7, mode: 'vigil', danger: 0 });
      v.weapons.length = 0;
      v.wstats.length = 0;
      grantWeapon(v, 'flysword', 8, true);
      grantWeapon(v, 'talisman', lv, false);
      openChestNow(v);
      expect(v.merges.includes('fujian')).toBe(want);
    }
  });

  it('飞剑打中的怪被贴符，到点炸开；没合成就不贴', () => {
    for (const merged of [true, false]) {
      const w = arena('flysword', 'talisman', merged);
      const i = spawnNow(w, 'jiangshi', w.x + 120, w.y);
      let sealed = false;
      let boomed = false;
      for (let t = 0; t < 200 && w.phase === 'play'; t++) {
        if (w.eAlive[i]) {
          w.eHp[i] = 1e6;
          w.eKX[i] = 0;
          w.eKY[i] = 0;
        }
        step(w, 0, -1);
        if (w.eMark[i]! > 0) sealed = true;
        if (evSeen(w, Ev.Seal, 1)) boomed = true;
      }
      expect(sealed).toBe(merged);
      expect(boomed).toBe(merged);
    }
  });

  it('符的倒计时到了才炸，炸完符没了、计数归零、伤到怪', () => {
    const w = arena('flysword', 'talisman');
    const i = spawnNow(w, 'jiangshi', w.x + 400, w.y);
    w.eHp[i] = 1e6;
    w.eMark[i] = w.tick + 5;
    w.marks = 1;
    for (let t = 0; t < 4; t++) step(w, 0, -1);
    expect(w.eMark[i]).toBeGreaterThan(0);
    let boom = false;
    for (let t = 0; t < 3; t++) {
      step(w, 0, -1);
      if (evSeen(w, Ev.Seal, 1)) boom = true;
    }
    expect(boom).toBe(true);
    expect(w.eMark[i]).toBe(0);
    expect(w.marks).toBe(0);
    expect(w.eHp[i]!).toBeLessThan(1e6);
  });

  it('贴了符的怪没了，符跟着没了，不会落到顶替它的新怪身上', () => {
    const w = arena('flysword', 'talisman');
    const i = spawnNow(w, 'jiangshi', w.x + 400, w.y);
    w.eMark[i] = w.tick + 1000;
    w.marks = 1;
    w.eAlive[i] = 0;
    w.eCount--;
    step(w, 0, -1);
    expect(w.eMark[i]).toBe(0);
    expect(w.marks).toBe(0);
  });
});

describe('双修：焚天金钟（金钟罩 + 火葫芦）', () => {
  it('护盾在身时外圈烧人，盾碎时地上留火', () => {
    const w = arena('shield', 'gourd');
    expect(w.merges).toContain('fenzhong');
    step(w, 0, -1);
    for (let t = 0; t < 600 && w.shield < w.shieldMax; t++) step(w, 0, -1);
    expect(w.shield).toBeGreaterThan(0);
    const ring = spawnNow(w, 'jiangshi', w.x + 100, w.y);
    let fired = false;
    let lowest = 1e6;
    for (let t = 0; t < 40; t++) {
      w.eHp[ring] = 1e6;
      w.eKX[ring] = 0;
      w.eKY[ring] = 0;
      w.eX[ring] = w.x + 100;
      w.eY[ring] = w.y;
      step(w, 0, -1);
      lowest = Math.min(lowest, w.eHp[ring]!);
      if (evSeen(w, Ev.FireRing)) fired = true;
    }
    expect(fired).toBe(true);
    expect(lowest).toBeLessThan(1e6);
    // 盾碎：一只怪贴脸打一下
    w.shield = 1;
    w.invuln = 0;
    spawnNow(w, 'jiangshi', w.x, w.y);
    let pools = 0;
    for (let t = 0; t < 10 && pools === 0; t++) {
      step(w, 0, -1);
      for (let s = 0; s < w.sAlive.length; s++) if (w.sAlive[s] && w.sKind[s] === Shot.Burn) pools++;
    }
    expect(pools).toBeGreaterThanOrEqual(5);
  });

  it('没盾、没合成都没有火环', () => {
    const w = arena('shield', 'gourd');
    for (let t = 0; t < 30; t++) {
      w.shield = 0;
      step(w, 0, -1);
      expect(evSeen(w, Ev.FireRing)).toBe(false);
    }
    const v = arena('shield', 'gourd', false);
    for (let t = 0; t < 600 && v.shield < 1; t++) step(v, 0, -1);
    for (let t = 0; t < 30; t++) {
      step(v, 0, -1);
      expect(evSeen(v, Ev.FireRing)).toBe(false);
    }
  });
});

describe('双修：铃落桃花（桃花雨 + 镇魂铃）', () => {
  it('合成后空中的花瓣朝怪挪过去，没合成不动', () => {
    const drift = (merged: boolean): number => {
      const w = arena('petals', 'bell', merged);
      const i = spawnNow(w, 'jiangshi', w.x + 200, w.y);
      let maxMove = 0;
      for (let t = 0; t < 120; t++) {
        w.eHp[i] = 1e6;
        w.eX[i] = w.x + 200;
        w.eY[i] = w.y;
        w.eKX[i] = 0;
        w.eKY[i] = 0;
        const before = new Map<number, number>();
        for (let s = 0; s < w.sAlive.length; s++) if (w.sAlive[s] && w.sKind[s] === Shot.Petal) before.set(s, w.sX[s]!);
        step(w, 0, -1);
        for (const [s, x0] of before) if (w.sAlive[s] && w.sKind[s] === Shot.Petal) maxMove = Math.max(maxMove, Math.abs(w.sX[s]! - x0));
      }
      return maxMove;
    };
    expect(drift(true)).toBeGreaterThan(3);
    expect(drift(false)).toBe(0);
  });
});

describe('双修：确定性和登记', () => {
  const PAIRS: [WeaponId, WeaponId][] = [
    ['flysword', 'talisman'],
    ['shield', 'gourd'],
    ['petals', 'bell'],
  ];
  for (const [a, b] of PAIRS) {
    it(`${a} + ${b}：同种子同输入逐拍指纹相同`, () => {
      const run = (): number[] => {
        const w = createWorld({ seed: 11, mode: 'vigil', danger: 1 });
        w.weapons.length = 0;
        w.wstats.length = 0;
        grantWeapon(w, a, 8, true);
        grantWeapon(w, b, 8, true);
        openChestNow(w);
        const out: number[] = [];
        for (let t = 0; t < 900 && w.phase !== 'over'; t++) {
          step(w, t % 90 < 45 ? 1 : 5, w.phase === 'choose' ? 0 : -1);
          out.push(fingerprint(w));
        }
        return out;
      };
      expect(run()).toEqual(run());
    });
  }

  it('五个双修各有自己的颜色，两件法器的类型或五行不同', () => {
    const duals = MERGES.filter((m) => m.dual);
    expect(duals.length).toBe(5);
    expect(new Set(duals.map((m) => m.color)).size).toBe(5);
  });
});
