import { describe, expect, it } from 'vitest';
import { BEAST, GUARD, RAID_ENEMIES } from '../src/content/explore.ts';
import { ENEMY_BY_KIND, type EnemyKind } from '../src/content/enemies.ts';
import { GUARD_MOVE, guardStep } from '../src/explore/guards.ts';
import { RaidEv, type GuardHost } from '../src/explore/host.ts';
import { Raid, Role } from '../src/explore/raid.ts';

type Host = GuardHost & { tick: number; x: number; y: number; coins: number; evs: number[][] };
function fakeHost(): Host {
  const N = 300;
  const evs: number[][] = [];
  return {
    tick: 0, x: 0, y: 0, coins: 0, evs,
    ev: { push: (t: number, x: number, y: number, a = 0, b = 0, c = 0) => void evs.push([t, x, y, a, b, c]) },
    eAlive: new Uint8Array(N), eGen: new Uint32Array(N), eX: new Float64Array(N), eY: new Float64Array(N),
    eHp: new Float64Array(N), eHpMax: new Float64Array(N), eSpeed: new Float64Array(N), eT: new Int32Array(N),
    eS: new Int32Array(N), eAX: new Float64Array(N), eAY: new Float64Array(N), eV: new Float64Array(N), ePhase: new Uint8Array(N),
  };
}

/** 一局夜探 + 假核心：把排队的守卫刷出来，每拍走一步 */
function setup(seed = 3) {
  const raid = new Raid({ seed, template: 'guzhen', danger: 2 });
  const h = fakeHost();
  h.x = raid.map.spawn.x;
  h.y = raid.map.spawn.y;
  let slots = 0;
  const spawnAll = (): void => {
    for (let g; (g = raid.takeSpawn()) >= 0; ) {
      const s = raid.guardSpawn(g);
      const def = s.kind === 'patrol' || s.kind === 'beast' || s.kind === 'goblin' ? RAID_ENEMIES[s.kind] : ENEMY_BY_KIND[s.kind as EnemyKind];
      const i = slots++;
      h.eAlive[i] = 1;
      h.eGen[i]!++;
      h.eX[i] = s.x;
      h.eY[i] = s.y;
      h.eSpeed[i] = def.speed;
      h.eHp[i] = h.eHpMax[i] = def.hp;
      raid.bindGuard(g, i, h);
    }
  };
  spawnAll();
  let hurt: number[] = [];
  const fx = { hurt: (d: number) => void hurt.push(d) };
  const p = { x: 0, y: 0 };
  const tick = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      h.tick++;
      raid.tick(h);
      spawnAll();
      for (let i = 0; i < slots; i++) {
        const g = raid.guardAt(i, h.eGen[i]!);
        if (g < 0) continue;
        const sp = guardStep(raid, g, h, i, fx);
        p.x = h.eX[i]! + GUARD_MOVE.vx * sp;
        p.y = h.eY[i]! + GUARD_MOVE.vy * sp;
        raid.map.index.pushOut(p, 26);
        h.eX[i] = p.x;
        h.eY[i] = p.y;
      }
    }
  };
  const slotOf = (role: number): number => {
    for (let g = 0; g < raid.gUsed; g++) if (raid.gRole[g] === role) return raid.gSlot[g]!;
    return -1;
  };
  return { raid, h, tick, slotOf, hurt: () => hurt, clearHurt: () => void (hurt = []), slots: () => slots };
}

describe('夜探守卫', () => {
  it('巡夜将：主角远的时候守着不动；走近就追（发 Alert）；被拖出 leash 就回家', () => {
    const { raid, h, tick, slotOf } = setup();
    const i = slotOf(Role.patrol);
    expect(i).toBeGreaterThanOrEqual(0);
    const g = raid.guardAt(i, h.eGen[i]!);
    const hx = raid.gHomeX[g]!;
    const hy = raid.gHomeY[g]!;
    tick(60);
    expect(Math.hypot(h.eX[i]! - hx, h.eY[i]! - hy)).toBeLessThan(13);
    // 主角走到它守的地方旁边
    h.x = hx + GUARD.patrol.aggro - 40;
    h.y = hy;
    tick(1);
    expect(raid.gState[g]).toBe(1);
    expect(h.evs.some((e) => e[0] === RaidEv.Alert && e[3] === Role.patrol && e[5] === i)).toBe(true);
    const d0 = Math.hypot(h.x - h.eX[i]!, h.y - h.eY[i]!);
    tick(20);
    expect(Math.hypot(h.x - h.eX[i]!, h.y - h.eY[i]!)).toBeLessThan(d0);
    // 把它拖出 leash：直接挪远（模拟主角一路跑，它一路追）
    h.eX[i] = hx + GUARD.patrol.leash + 50;
    h.eY[i] = hy;
    h.x = h.eX[i]! + 100;
    tick(1);
    expect(raid.gState[g]).toBe(2);
    const before = Math.hypot(h.eX[i]! - hx, h.eY[i]! - hy);
    tick(30);
    expect(Math.hypot(h.eX[i]! - hx, h.eY[i]! - hy)).toBeLessThan(before);
  });

  it('守铜箱的精英追人时交给这种怪自己的行为（own）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { raid, h } = setup(seed);
      let g = -1;
      for (let k = 0; k < raid.gUsed; k++) if (raid.gRole[k] === Role.copper) g = k;
      if (g < 0) continue;
      const i = raid.gSlot[g]!;
      h.x = raid.gHomeX[g]! + 50;
      h.y = raid.gHomeY[g]!;
      guardStep(raid, g, h, i, { hurt: () => {} });
      expect(GUARD_MOVE.own).toBe(true);
      return;
    }
    throw new Error('8 个种子都没有守铜箱的精英');
  });

  it('镇门石兽：近了甩尾、远了扑；先预警再出手，站在圈里挨打，圈外不挨', () => {
    const { raid, h, tick, slotOf, hurt, clearHurt } = setup();
    const i = slotOf(Role.beast);
    const g = raid.guardAt(i, h.eGen[i]!);
    // 主角贴着石兽：倒数到了就甩尾
    h.x = h.eX[i]! + 60;
    h.y = h.eY[i]!;
    let warned = -1;
    for (let k = 0; k < BEAST.every[0]! + 5 && warned < 0; k++) {
      tick(1);
      h.x = h.eX[i]! + 60;
      h.y = h.eY[i]!;
      const e = h.evs.find((e) => e[0] === RaidEv.Beast && e[3] === 2);
      if (e) warned = h.tick;
    }
    expect(warned).toBeGreaterThan(0);
    expect(h.eS[i]).toBe(3);
    tick(BEAST.sweep.warn);
    expect(h.evs.some((e) => e[0] === RaidEv.Beast && e[3] === 3)).toBe(true);
    expect(hurt()).toEqual([BEAST.sweep.dmg]);
    expect(h.eS[i]).toBe(0);
    // 扑：石兽回到家，主角站在院子里离它 300 的地方，扑的时候躲开
    clearHurt();
    h.evs.length = 0;
    const vault = raid.map.yards.find((y) => y.kind === 'vault')!;
    const cx = vault.x + vault.w / 2;
    const cy = vault.y + vault.h / 2;
    const hx0 = raid.gHomeX[g]!;
    const hy0 = raid.gHomeY[g]!;
    h.eX[i] = hx0;
    h.eY[i] = hy0;
    const ux = (cx - hx0) / Math.hypot(cx - hx0, cy - hy0);
    const uy = (cy - hy0) / Math.hypot(cx - hx0, cy - hy0);
    h.eT[i] = 1;
    h.x = hx0 + ux * 300;
    h.y = hy0 + uy * 300;
    const tx = h.x;
    const ty = h.y;
    tick(1);
    expect(h.eS[i]).toBe(1);
    const warn = h.evs.find((e) => e[0] === RaidEv.Beast && e[3] === 0)!;
    expect([warn[1], warn[2]]).toEqual([tx, ty]);
    // 预警时往旁边跑开 200
    h.x = tx - uy * 200;
    h.y = ty + ux * 200;
    tick(BEAST.pounce.warn + BEAST.pounce.fly);
    expect(h.evs.some((e) => e[0] === RaidEv.Beast && e[3] === 1)).toBe(true);
    expect(hurt()).toEqual([]);
    // 落在预警的圈里
    expect(Math.hypot(h.eX[i]! - tx, h.eY[i]! - ty)).toBeLessThan(5);
    // 再扑一次，这回站着不动：挨打
    h.eS[i] = 0;
    h.eT[i] = 1;
    h.x = hx0;
    h.y = hy0;
    tick(1 + BEAST.pounce.warn + BEAST.pounce.fly);
    expect(hurt()).toEqual([BEAST.pounce.dmg]);
    expect(raid.gState[g]).toBe(1);
  });

  it('镇门石兽二段：血少于一半吼一声，扑击连扑两下', () => {
    const { h, tick, slotOf } = setup();
    const i = slotOf(Role.beast);
    h.eHp[i] = h.eHpMax[i]! * 0.4;
    h.x = h.eX[i]! + 300;
    h.y = h.eY[i]!;
    h.eT[i] = 1;
    tick(1);
    expect(h.evs.some((e) => e[0] === RaidEv.Beast && e[3] === 4)).toBe(true);
    expect(h.ePhase[i]).toBe(1);
    h.x += 400;
    tick((BEAST.pounce.warn + BEAST.pounce.fly) * 2 + 2);
    expect(h.evs.filter((e) => e[0] === RaidEv.Beast && e[3] === 1).length).toBe(BEAST.ragedChain);
    expect(h.eS[i]).toBe(0);
  });

  it('游荡的巡夜将：6:00 从远处的路口出来，沿街走；看见主角就追，跑远了放弃', () => {
    const { raid, h, tick, slots } = setup();
    // 主角躲在出生点（离守卫都远）
    const n0 = slots();
    tick(6 * 1800);
    // 5:00 还出了一只宝妖（RAID_LATE.goblin）
    expect(slots()).toBe(n0 + 2);
    const ev = h.evs.find((e) => e[0] === RaidEv.Roamer)!;
    expect(Math.hypot(ev[1]! - h.x, ev[2]! - h.y)).toBeGreaterThanOrEqual(1200);
    // n0 是 5:00 的宝妖，游荡的巡夜将在它后面
    const i = n0 + 1;
    const g = raid.guardAt(i, h.eGen[i]!);
    expect(raid.gRole[g]).toBe(Role.roamer);
    const x0 = h.eX[i]!;
    const y0 = h.eY[i]!;
    tick(300);
    expect(Math.hypot(h.eX[i]! - x0, h.eY[i]! - y0)).toBeGreaterThan(100);
    expect(raid.map.index.free(h.eX[i]!, h.eY[i]!, 20)).toBe(true);
    // 主角走到它跟前
    h.x = h.eX[i]! + 200;
    h.y = h.eY[i]!;
    tick(1);
    expect(raid.gState[g]).toBe(1);
    h.x = h.eX[i]! + GUARD.roamer.leash + 100;
    tick(1);
    expect(raid.gState[g]).toBe(0);
  });

  it('槽位复用：同一槽位换了一只怪（代数变了）就不再当守卫', () => {
    const { raid, h, slotOf } = setup();
    const i = slotOf(Role.beast);
    expect(raid.guardAt(i, h.eGen[i]!)).toBeGreaterThanOrEqual(0);
    expect(raid.guardAt(i, h.eGen[i]! + 1)).toBe(-1);
    expect(raid.guardAt(299, h.eGen[299]!)).toBe(-1);
  });
});
