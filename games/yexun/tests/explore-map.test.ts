import { describe, expect, it } from 'vitest';
import { RAID_TEMPLATES, type RaidTemplateId } from '../src/content/explore.ts';
import { pushOut, type Block } from '../src/content/maps.ts';
import { Rng } from '../src/core/rng.ts';
import { overlaps } from '../src/explore/blocks.ts';
import { generateMap, type RaidMap } from '../src/explore/mapgen.ts';
import { NAV_INF } from '../src/explore/nav.ts';

const ALL: RaidTemplateId[] = ['guzhen', 'dukou', 'shansi', 'teach'];
const SEEDS = [1, 2, 3, 7, 42, 1234, 99991, 0xdeadbeef];

const cache = new Map<string, RaidMap>();
function map(t: RaidTemplateId, s: number): RaidMap {
  const k = `${t}:${s}`;
  if (!cache.has(k)) cache.set(k, generateMap(t, s));
  return cache.get(k)!;
}

/** 生成结果里不含索引、寻路格子的部分，比较用 */
const plain = (m: RaidMap): unknown => ({ blocks: m.blocks, yards: m.yards, chests: m.chests, guards: m.guards, gates: m.gates, spawn: m.spawn, nodes: m.nodes, links: m.links });

describe('夜探地图生成', () => {
  it('同一种子同一模板逐位相同；换种子就不一样', () => {
    for (const t of ALL) {
      expect(JSON.stringify(plain(generateMap(t, 5)))).toBe(JSON.stringify(plain(map(t, 5 === 5 ? 5 : 0))));
      expect(JSON.stringify(plain(map(t, 1)))).not.toBe(JSON.stringify(plain(map(t, 2))));
    }
  });

  for (const t of ALL) {
    it(`${t}：出生点沿路走得到每座门、每个宝箱；宝箱、门、出生点、守卫不压墙`, () => {
      for (const s of SEEDS) {
        const m = map(t, s);
        const reach = m.nav.field([m.nav.index(m.spawn.x, m.spawn.y)]);
        expect(m.index.free(m.spawn.x, m.spawn.y, 20), `${t}/${s} 出生点`).toBe(true);
        for (const g of m.gates) {
          expect(m.index.free(g.x, g.y, 60), `${t}/${s} ${g.name}`).toBe(true);
          expect(reach[m.nav.index(g.x, g.y)]! < NAV_INF, `${t}/${s} ${g.name} 走不到`).toBe(true);
        }
        for (const c of m.chests) {
          expect(m.index.free(c.x, c.y, 20)).toBe(true);
          expect(reach[m.nav.index(c.x, c.y)]! < NAV_INF, `${t}/${s} 宝箱 (${c.x}, ${c.y}) 走不到`).toBe(true);
          expect(c.items.length).toBe(c.tier === 'wood' ? 1 : c.tier === 'copper' ? 2 : 3);
        }
        for (const g of m.guards) expect(m.index.free(g.x, g.y, 28)).toBe(true);
        for (const b of m.blocks) {
          expect(b.w).toBeGreaterThan(0);
          expect(b.h).toBeGreaterThan(0);
        }
      }
    });
  }

  it('宝箱三档的位置（2.3）：木箱在街上，铜箱在院里，金箱在庙和石兽院；深处更值钱的箱子更多', () => {
    for (const t of ['guzhen', 'dukou', 'shansi'] as const) {
      const tpl = RAID_TEMPLATES[t];
      for (const s of SEEDS) {
        const m = map(t, s);
        const inYard = (x: number, y: number): string | null => m.yards.find((y0) => x > y0.x && x < y0.x + y0.w && y > y0.y && y < y0.y + y0.h)?.kind ?? null;
        const wood = m.chests.filter((c) => c.tier === 'wood');
        expect(wood.length).toBe(tpl.wood);
        for (const c of wood) expect(inYard(c.x, c.y)).toBeNull();
        for (const c of m.chests.filter((c) => c.tier === 'copper')) expect(['yard', 'ruin', 'plaza']).toContain(inYard(c.x, c.y));
        const gold = m.chests.filter((c) => c.tier === 'gold');
        expect(gold.length).toBe(tpl.temples.length + 2);
        for (const c of gold) expect(['temple', 'vault']).toContain(inYard(c.x, c.y));
        const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
        expect(mean(gold.map((c) => c.depth))).toBeGreaterThan(mean(wood.map((c) => c.depth)));
      }
    }
  });

  it('守卫：最值钱的院子只有一个门、石兽守着两个金箱；庙里有巡夜将；铜箱有时带精英（3.5）', () => {
    let copperGuarded = 0;
    for (const t of ['guzhen', 'dukou', 'shansi'] as const) {
      for (const s of SEEDS) {
        const m = map(t, s);
        const vault = m.yards.find((y) => y.kind === 'vault')!;
        expect(vault.doors.length).toBe(1);
        const beasts = m.guards.filter((g) => g.kind === 'beast');
        expect(beasts.length).toBe(1);
        const guarded = m.chests.filter((c) => c.guard >= 0 && m.guards[c.guard]!.kind === 'beast');
        expect(guarded.length).toBe(2);
        expect(m.guards.filter((g) => g.role === 'patrol').length).toBe(RAID_TEMPLATES[t].temples.length);
        copperGuarded += m.guards.filter((g) => g.role === 'copper').length;
      }
    }
    expect(copperGuarded).toBeGreaterThan(0);
  });

  it('教学镇：小地图，没有守卫，三档宝箱都有', () => {
    for (const s of SEEDS) {
      const m = map('teach', s);
      expect(m.size).toBe(2800);
      expect(m.guards.length).toBe(0);
      expect(new Set(m.chests.map((c) => c.tier))).toEqual(new Set(['wood', 'copper', 'gold']));
    }
  });

  it('渡口：一条河横穿全图（含环街），只在几条竖街上留桥', () => {
    const { bridges } = RAID_TEMPLATES.dukou.river!;
    for (const s of SEEDS) {
      const m = map('dukou', s);
      const river = m.blocks.filter((b) => b.look === 'river');
      expect(river.length).toBe(bridges + 1);
      expect(river[0]!.x).toBe(0);
      expect(river.at(-1)!.x + river.at(-1)!.w).toBe(m.size);
      const water = river.reduce((a, b) => a + b.w, 0);
      expect(m.size - water).toBe(bridges * (400 - 2 * 90));
    }
  });

  it('山寺：几道台阶墙横断全图，每道只留几个窄口；墙下那排院子不往北开门', () => {
    const { rows, gaps, gapWidth } = RAID_TEMPLATES.shansi.terraces!;
    for (const s of SEEDS) {
      const m = map('shansi', s);
      const widths = new Map<number, number>();
      for (const b of m.blocks.filter((b) => b.look === 'terrace')) widths.set(b.y, (widths.get(b.y) ?? 0) + b.w);
      expect(widths.size).toBe(rows.length);
      for (const w of widths.values()) expect(m.size - w).toBe(gaps * gapWidth);
      for (const y of m.yards) if (y.kind !== 'plaza' && rows.some((r) => Math.abs(y.y - ((r + 1) * 400 - 120)) < 1)) expect(y.doors).not.toContain(0);
    }
  });

  it('游荡用的路口连成一张图（任一路口走得到其他路口）', () => {
    for (const t of ALL) {
      for (const s of SEEDS.slice(0, 4)) {
        const m = map(t, s);
        const seen = new Set([0]);
        const q = [0];
        while (q.length) for (const n of m.links[q.pop()!]!) if (!seen.has(n)) (seen.add(n), q.push(n));
        expect(seen.size).toBe(m.nodes.length);
      }
    }
  });

  it('分桶推挤和 maps.ts 的 pushOut 逐位一样', () => {
    const m = map('guzhen', 3);
    const asBlocks: Block[] = m.blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, look: 'wall_h' }));
    const rng = new Rng(9, 'test');
    for (let k = 0; k < 4000; k++) {
      // 一半撒在墙附近
      const b = m.blocks[rng.int(m.blocks.length)]!;
      const x = k & 1 ? rng.next() * m.size : b.x - 30 + rng.next() * (b.w + 60);
      const y = k & 1 ? rng.next() * m.size : b.y - 30 + rng.next() * (b.h + 60);
      const r = 10 + rng.int(40);
      const a = { x, y };
      const c = { x, y };
      const ma = m.index.pushOut(a, r);
      const mc = pushOut(asBlocks, c, r);
      expect(ma).toBe(mc);
      expect(a.x).toBe(c.x);
      expect(a.y).toBe(c.y);
      expect(m.index.free(x, y, r)).toBe(!m.blocks.some((bb) => overlaps(bb, x, y, r)));
    }
  });
});
