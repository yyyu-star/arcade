import { describe, expect, it } from 'vitest';
import { ENEMY_BY_KIND, TEMPLEGHOST } from '../src/content/enemies.ts';
import { inRects, MAPS, MAP_IDS, MAP_UNLOCK, TERRAIN } from '../src/content/maps.ts';
import { ARENA } from '../src/content/player.ts';
import { VIGIL_REGIONS } from '../src/content/regions.ts';
import { liveMapOk } from '../src/content/live.ts';
import { MONSTER_INFO } from '../src/view/ui/codex.ts';
import { createWorld, Ev, spawnNow, step, type World } from '../src/core/index.ts';

const T = MAPS.temple;
const zones = T.incense!;

function quiet(seed = 7): World {
  const w = createWorld({ seed, mode: 'vigil', danger: 2, map: 'temple' });
  w.weapons.length = 0;
  w.wstats.length = 0;
  w.nextEvent = 1 << 30;
  w.spawnAcc = -1e9;
  return w;
}

describe('荒庙', () => {
  it('登记：地图卡、10 分钟解锁、特色怪和精英、图鉴有庙祝鬼', () => {
    expect(MAP_IDS).toContain('temple');
    expect(MAP_UNLOCK.temple?.seconds).toBe(600);
    expect(VIGIL_REGIONS.temple?.mobs.map((m) => m.kind)).toEqual(['templeghost', 'stonemonk']);
    expect(VIGIL_REGIONS.temple?.elites?.every((e) => e.enemy === 'shishi')).toBe(true);
    expect(MONSTER_INFO.templeghost.name).toBe('庙祝鬼');
  });

  it('块都在场地里，出生点空着；每块香火区里有一尊香炉，香炉四周站得下人', () => {
    for (const b of T.blocks) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThan(ARENA.w);
      expect(b.y + b.h).toBeLessThan(ARENA.h);
    }
    const C = ARENA.w / 2;
    expect(T.blocks.some((b) => C > b.x - 40 && C < b.x + b.w + 40 && C > b.y - 40 && C < b.y + b.h + 40)).toBe(false);
    for (const z of zones) {
      const censers = T.blocks.filter((b) => b.look === 'censer' && inRects([z], b.x + b.w / 2, b.y + b.h / 2));
      expect(censers.length).toBe(1);
      // 香炉下方一步的地方在区里、不压块
      const c = censers[0]!;
      const x = c.x + c.w / 2;
      const y = c.y + c.h + 40;
      expect(inRects([z], x, y)).toBe(true);
      expect(T.blocks.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)).toBe(false);
    }
  });

  it('站在香火区里回血，站在外面不回（小道士本身没有回血）', () => {
    const z = zones[1]!;
    const inn = quiet();
    inn.x = z.x + z.w / 2;
    inn.y = z.y + z.h - 20;
    inn.hp = 10;
    const out = quiet();
    out.hp = 10;
    for (let t = 0; t < 30 * 10; t++) {
      step(inn, 0, -1);
      step(out, 0, -1);
    }
    expect(inn.inIncense).toBe(true);
    expect(out.inIncense).toBe(false);
    expect(inn.hp - 10).toBeGreaterThanOrEqual(Math.floor(TERRAIN.incenseRegen * 10) - 1);
    expect(out.hp).toBe(10);
  });

  it('香火引怪：同一种子，站在香火区里比站在外面来的怪多', () => {
    const z = zones[1]!;
    const a = createWorld({ seed: 11, mode: 'vigil', danger: 2, map: 'temple' });
    const b = createWorld({ seed: 11, mode: 'vigil', danger: 2, map: 'temple' });
    a.x = z.x + z.w / 2;
    a.y = z.y + z.h - 20;
    b.x = z.x + z.w / 2;
    b.y = z.y + z.h + 400;
    let na = 0;
    let nb = 0;
    for (let t = 0; t < 30 * 90; t++) {
      a.hp = b.hp = 999;
      step(a, 0, -1);
      step(b, 0, -1);
      na += a.eCount + a.kills;
      nb += b.eCount + b.kills;
    }
    // 场上的怪加打倒的怪（来过的怪）按时间累计：香火区里明显多
    expect(na).toBeGreaterThan(nb * 1.1);
  });

  it('庙祝鬼先画灰圈，站着不动挨香灰、走慢；走开就没事', () => {
    const w = quiet();
    const i = spawnNow(w, 'templeghost', w.x + 220, w.y);
    w.eT[i] = 1;
    const seen = new Set<number>();
    for (let t = 0; t < TEMPLEGHOST.warn + 4; t++) {
      step(w, 0, -1);
      for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Mob) seen.add(w.ev.a[k]!);
    }
    expect(seen.has(14) && seen.has(15)).toBe(true);
    expect(w.hp).toBeLessThan(w.stats.hpMax);
    expect(w.slowUntil).toBeGreaterThan(w.tick);
    const w2 = quiet();
    const j = spawnNow(w2, 'templeghost', w2.x + 220, w2.y);
    w2.eT[j] = 1;
    for (let t = 0; t < TEMPLEGHOST.warn + 4; t++) step(w2, t < 3 ? 0 : 21, -1);
    expect(w2.hp).toBe(w2.stats.hpMax);
    expect(ENEMY_BY_KIND.templeghost.vs?.火).toBeGreaterThan(1);
  });

  it('实盘暂不开放荒庙（系数配好前）', () => {
    expect(liveMapOk('temple')).toBe(false);
    expect(liveMapOk('snow')).toBe(true);
  });
});
