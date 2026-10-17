import { describe, expect, it } from 'vitest';
import {
  BAMBOO_KING, CRAB, DROWN, ENEMIES, ENEMY_BY_KIND, FROSTSOUL, HEBO, ICEGOLEM, ICICLE, MONK, NIGHTWATCH, SNAKE, SPROUT,
} from '../src/content/enemies.ts';
import { RAID_REGIONS, VIGIL_REGIONS, regionKind, regionTotal } from '../src/content/regions.ts';
import { MAPS, type MapId } from '../src/content/maps.ts';
import { RAID_TEMPLATES } from '../src/content/explore.ts';
import { MONSTER_INFO } from '../src/view/ui/codex.ts';
import { createWorld, Ev, grantWeapon, spawnNow, step, type World } from '../src/core/index.ts';
import { PLAYER_SLOW } from '../src/content/enemies.ts';

/** 干净的场：没有法器、定点事件和补怪都关掉，只剩手放进去的怪 */
function quiet(map: MapId = 'bamboo', seed = 7): World {
  const w = createWorld({ seed, mode: 'vigil', danger: 2, map });
  w.weapons.length = 0;
  w.wstats.length = 0;
  w.nextEvent = 1 << 30;
  w.spawnAcc = -1e9;
  return w;
}
function count(w: World, kind: keyof typeof ENEMY_BY_KIND): number {
  let n = 0;
  for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.eKind[i] === ENEMY_BY_KIND[kind].code) n++;
  return n;
}
function sawMob(w: World, sub: number): boolean {
  for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Mob && w.ev.a[k] === sub) return true;
  return false;
}
/** 往前走 n 拍，返回这期间出现过的 Ev.Mob 子类 */
function run(w: World, n: number): Set<number> {
  const seen = new Set<number>();
  for (let t = 0; t < n; t++) {
    step(w, 0, -1);
    for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Mob) seen.add(w.ev.a[k]!);
  }
  return seen;
}
function kill(w: World, i: number): void {
  w.eHp[i] = 0.5;
  grantWeapon(w, 'bell', 8);
  w.eX[i] = w.x + 20;
  w.eY[i] = w.y;
  for (let t = 0; t < 120 && w.eAlive[i]; t++) step(w, 0, 0);
}

describe('特色怪的登记', () => {
  it('编号接着 20 往后排，图鉴、地区表里的怪都登记过', () => {
    ENEMIES.forEach((e, k) => expect(e.code).toBe(k));
    expect(ENEMY_BY_KIND.bamsprout.code).toBe(21);
    for (const e of ENEMIES) expect(MONSTER_INFO[e.kind], e.kind).toBeTruthy();
    for (const r of [...Object.values(VIGIL_REGIONS), ...Object.values(RAID_REGIONS)]) {
      for (const m of r!.mobs) expect(ENEMY_BY_KIND[m.kind]).toBeTruthy();
      for (const e of r!.elites ?? []) expect(ENEMY_BY_KIND[e.enemy].elite).toBe(true);
    }
  });

  it('三张新图各 2 种特色怪 + 1 种精英，夜探三个镇各 1 种，雪原义庄不动', () => {
    for (const id of ['bamboo', 'riverbank', 'icelake'] as const) {
      expect(VIGIL_REGIONS[id]!.mobs.length).toBe(2);
      expect(new Set(VIGIL_REGIONS[id]!.elites!.map((e) => e.enemy)).size).toBe(1);
      expect(MAPS[id]).toBeTruthy();
    }
    for (const id of ['guzhen', 'dukou', 'shansi'] as const) {
      expect(RAID_REGIONS[id]!.mobs.length).toBe(1);
      expect(RAID_TEMPLATES[id]).toBeTruthy();
    }
    expect(VIGIL_REGIONS.snow).toBeUndefined();
    expect(VIGIL_REGIONS.yizhuang).toBeUndefined();
  });

  it('占比随分钟递增，抽签落在对应的怪上', () => {
    const r = VIGIL_REGIONS.bamboo!;
    expect(regionTotal(r, 0)).toBe(0);
    expect(regionTotal(r, 1)).toBeCloseTo(0.144);
    expect(regionTotal(r, 3)).toBeCloseTo(0.244);
    expect(regionKind(r, 3, 0.05)).toBe('bamsprout');
    expect(regionKind(r, 3, 0.2)).toBe('snakespirit');
  });

  it('新图的守夜图里按时刷出特色怪，竹林的精英进了时间表', () => {
    const w = createWorld({ seed: 11, mode: 'vigil', danger: 2, map: 'bamboo' });
    w.hp = 1e9; // 站着不动也不死，只看刷了什么
    expect(w.schedule.some((e) => e.kind === 'elite' && e.enemy === 'bambooking')).toBe(true);
    const seen = new Set<number>();
    for (let t = 0; t < 30 * 60 * 4; t++) {
      step(w, 0, w.phase === 'choose' ? 0 : -1);
      for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i]) seen.add(w.eKind[i]!);
      if (w.phase === 'over') break;
    }
    expect(seen.has(ENEMY_BY_KIND.bamsprout.code)).toBe(true);
  });

  it('夜探渡口刷溺鬼', () => {
    const w = createWorld({ seed: 3, mode: 'raid', danger: 2, raid: { template: 'dukou' } });
    w.hp = 1e9;
    const seen = new Set<number>();
    for (let t = 0; t < 30 * 60 * 4; t++) {
      step(w, 0, w.phase === 'choose' ? 0 : -1);
      for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i]) seen.add(w.eKind[i]!);
      if (w.phase === 'over') break;
    }
    expect(seen.has(ENEMY_BY_KIND.drown.code)).toBe(true);
  });
});

describe('竹林', () => {
  it('竹精先冒圈，圈里不伤人，出土那一下砸中圈里的人', () => {
    const w = quiet();
    const i = spawnNow(w, 'bamsprout', w.x + 10, w.y);
    expect(sawMob(w, 0)).toBe(true);
    const hp = w.hp;
    for (let t = 0; t < SPROUT.warn - 2; t++) {
      step(w, 0, -1);
      expect(w.hp).toBe(hp);
    }
    const seen = run(w, 4);
    expect(seen.has(1)).toBe(true);
    expect(w.hp).toBeLessThan(hp);
    expect(w.eAlive[i]).toBe(1);
  });

  it('出土时人走远了就砸空', () => {
    const w = quiet();
    spawnNow(w, 'bamsprout', w.x + 300, w.y);
    const hp = w.hp;
    run(w, SPROUT.warn + 1);
    expect(w.hp).toBe(hp);
  });

  it('蛇精藏着慢游，进了范围盘身再窜', () => {
    const w = quiet();
    const i = spawnNow(w, 'snakespirit', w.x + SNAKE.trigger + 120, w.y);
    expect(w.eS[i]).toBe(0);
    const states = new Set<number>();
    for (let t = 0; t < 300; t++) {
      step(w, 0, -1);
      states.add(w.eS[i]!);
    }
    expect([...states].sort()).toEqual([0, 1, 2, 3]);
  });

  it('竹王隔一阵在主角四周种出一圈竹精', () => {
    const w = quiet();
    spawnNow(w, 'bambooking', w.x + 400, w.y);
    expect(count(w, 'bamsprout')).toBe(0);
    run(w, BAMBOO_KING.every[0]! + 2);
    expect(count(w, 'bamsprout')).toBe(BAMBOO_KING.sprouts[0]);
  });
});

describe('河滩', () => {
  it('溺鬼抓住人：拖向自己、脚下变沉，松手后有冷却', () => {
    const w = quiet('riverbank');
    const i = spawnNow(w, 'drown', w.x + DROWN.grab - 10, w.y);
    w.eT[i] = 0;
    const x0 = w.x;
    run(w, 3);
    expect(w.eS[i]).toBe(2);
    run(w, 10);
    expect(w.x).toBeGreaterThan(x0);
    expect(w.tick < w.slowUntil).toBe(true);
    expect(PLAYER_SLOW).toBeLessThan(1);
    run(w, DROWN.hold + 5);
    expect(w.eS[i]).toBe(0);
    expect(w.eAX[i]).toBeGreaterThan(w.tick - 1);
  });

  it('还没冒出来的溺鬼不伤人', () => {
    const w = quiet('riverbank');
    spawnNow(w, 'drown', w.x + 5, w.y);
    const hp = w.hp;
    run(w, DROWN.emerge - 2);
    expect(w.hp).toBe(hp);
  });

  it('河蟹横着走：绕着主角转，不是直线扑上来', () => {
    const w = quiet('riverbank');
    const i = spawnNow(w, 'crab', w.x + 300, w.y);
    const y0 = w.eY[i]!;
    const x0 = w.eX[i]!;
    run(w, 40);
    expect(Math.abs(w.eY[i]! - y0)).toBeGreaterThan(Math.abs(w.eX[i]! - x0) * 2);
    expect(CRAB.side).toBeGreaterThan(0.5);
  });

  it('河伯涨潮：一圈水弹加溺鬼', () => {
    const w = quiet('riverbank');
    spawnNow(w, 'hebo', w.x + 500, w.y);
    const seen = run(w, HEBO.every + 2);
    expect(seen.has(7)).toBe(true);
    expect(count(w, 'drown')).toBe(HEBO.drowns);
    let shots = 0;
    for (let s = 0; s < w.sAlive.length; s++) if (w.sAlive[s]) shots++;
    expect(shots).toBeGreaterThanOrEqual(HEBO.ring);
  });
});

describe('冰湖', () => {
  it('冰傀碎成两个小的，小的不再碎', () => {
    const w = quiet('icelake');
    const i = spawnNow(w, 'icegolem', w.x + 300, w.y);
    w.eSize[i] = 1;
    w.stats.might = 1;
    kill(w, i);
    expect(w.eAlive[i] && w.eSize[i] === 1).toBeFalsy();
    // 钟一直在敲，小的可能已经死了：碎的那一下一定有事件和两只新生的
    let small = 0;
    for (let j = 0; j < w.eAlive.length; j++) if (w.eAlive[j] && w.eKind[j] === ENEMY_BY_KIND.icegolem.code && w.eSize[j] === ICEGOLEM.size) small++;
    expect(small + w.kills).toBeGreaterThanOrEqual(3);
  });

  it('冰凌先标圈，圈里站着就挨冰刺，走开就没事', () => {
    const w = quiet('icelake');
    const i = spawnNow(w, 'icicle', w.x + 200, w.y);
    w.eT[i] = 1;
    const seen = run(w, ICICLE.warn + 5);
    expect(seen.has(4)).toBe(true);
    expect(seen.has(5)).toBe(true);
    expect(w.hp).toBeLessThan(w.stats.hpMax);
    const w2 = quiet('icelake');
    const j = spawnNow(w2, 'icicle', w2.x + 200, w2.y);
    w2.eT[j] = 1;
    for (let t = 0; t < ICICLE.warn + 5; t++) step(w2, t < 3 ? 0 : 5, -1); // 标圈后往一边走开
    expect(w2.hp).toBe(w2.stats.hpMax);
  });

  it('冰魄蓄力后震出霜环，冻脚；每第二次放冰傀', () => {
    const w = quiet('icelake');
    const i = spawnNow(w, 'frostsoul', w.x + 100, w.y);
    w.eT[i] = 1;
    const seen = run(w, FROSTSOUL.warn + 4);
    expect(seen.has(8)).toBe(true);
    expect(seen.has(9)).toBe(true);
    expect(w.hp).toBeLessThan(w.stats.hpMax);
    expect(w.tick < w.slowUntil).toBe(true);
    expect(count(w, 'icegolem')).toBe(0);
    w.eT[i] = 1;
    w.hp = w.stats.hpMax;
    w.invuln = 0;
    run(w, FROSTSOUL.warn + 4);
    expect(count(w, 'icegolem')).toBe(FROSTSOUL.golems);
  });
});

describe('夜探', () => {
  it('更夫鬼敲梆唤小鬼火', () => {
    const w = quiet();
    spawnNow(w, 'nightwatch', w.x + 500, w.y);
    const seen = run(w, NIGHTWATCH.every + 2);
    expect(seen.has(10)).toBe(true);
    expect(count(w, 'wisp')).toBe(NIGHTWATCH.calls);
  });

  it('石僧走近了合掌拍地，圈里的人挨打', () => {
    const w = quiet();
    const i = spawnNow(w, 'stonemonk', w.x + 60, w.y);
    w.eT[i] = 1;
    const seen = run(w, MONK.warn + 4);
    expect(seen.has(11)).toBe(true);
    expect(seen.has(12)).toBe(true);
    expect(w.hp).toBeLessThan(w.stats.hpMax);
  });
});

describe('确定性', () => {
  it('同种子同输入，新图的指纹逐拍相同', () => {
    const a = createWorld({ seed: 21, mode: 'vigil', danger: 2, map: 'icelake' });
    const b = createWorld({ seed: 21, mode: 'vigil', danger: 2, map: 'icelake' });
    for (let t = 0; t < 2400; t++) {
      step(a, (t >> 5) % 9, -1);
      step(b, (t >> 5) % 9, -1);
    }
    expect([a.x, a.y, a.hp, a.kills, a.eCount]).toEqual([b.x, b.y, b.hp, b.kills, b.eCount]);
  });
});
