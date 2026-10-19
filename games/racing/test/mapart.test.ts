/** 桌游地图板（DESIGN.md 第 8 节）：每次画出来一样，限速牌立在弯道线延长线的路边、不压路不叠，弯名牌不压赛道、不叠在一起，全图时只画大件。 */
import { describe, expect, it } from 'vitest';
import { FIXED } from '../src/track/fixed.ts';
import { geometry } from '../src/track/shape.ts';
import { LOD, mapArt } from '../src/view/mapart.ts';

describe('地图板', () => {
  for (const t of FIXED) {
    const art = mapArt(t);
    const geo = geometry(t);
    const pts = geo.strip(0, t.spaces, 0, 6);
    const near = (x: number, y: number): number => Math.min(...pts.map((p) => Math.hypot(p.x - x, p.y - y))) - geo.width / 2;

    it(`${t.name}：同一条赛道每次画出来一样`, () => {
      const a = art.draw({ detail: true, rot: false });
      expect(a.length).toBeGreaterThan(10_000);
      expect(art.draw({ detail: true, rot: false })).toBe(a);
      expect(a).not.toMatch(/NaN|Infinity|undefined/);
    });

    it(`${t.name}：每个弯一块弯名牌，横竖两套位置都不压赛道、不叠在一起、离弯道线不远`, () => {
      expect(art.shields.map((s) => s.at)).toEqual(t.corners.map((c) => c.at));
      for (const rot of [false, true]) {
        const pos = art.shields.map((s) => ({ x: rot ? s.rx : s.x, y: rot ? s.ry : s.y, hx: rot ? 13 : s.hw, hy: rot ? s.hw : 13 }));
        pos.forEach((p, i) => {
          for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) expect(near(p.x + dx * p.hx, p.y + dy * p.hy)).toBeGreaterThan(0);
          const e = geo.edges[t.corners[i]!.at]!;
          expect(Math.hypot(p.x - e.c.x, p.y - e.c.y)).toBeLessThan(220);
          for (let j = i + 1; j < pos.length; j++) {
            const q = pos[j]!;
            expect(Math.abs(p.x - q.x) < p.hx + q.hx && Math.abs(p.y - q.y) < p.hy + q.hy).toBe(false);
          }
        });
      }
    });

    it(`${t.name}：限速牌立在路边、在弯道线的延长线上，不压路；全图时只有限速牌，放大了才有弯名牌、格号、制动牌`, () => {
      const far = art.labels({ k: LOD / 2, rot: false, next: -1 });
      const close = art.labels({ k: 1, rot: false, next: t.corners[0]!.at });
      const at = [...close.matchAll(/class="limit" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      expect(at.length).toBe(t.corners.length);
      t.corners.forEach((c, i) => {
        const e = geo.edges[c.at]!;
        const p = at[i]!;
        // 在弯道线（过 e.c、垂直于赛道方向）的延长线上：沿赛道方向的偏移是 0
        expect(Math.abs((p.x - e.c.x) * Math.cos(e.angle) + (p.y - e.c.y) * Math.sin(e.angle))).toBeLessThan(0.2);
        // 牌子整块在路外，离路边不远
        expect(near(p.x, p.y)).toBeGreaterThan(12);
        expect(Math.hypot(p.x - e.c.x, p.y - e.c.y)).toBeLessThan(geo.width / 2 + 30);
      });
      expect((far.match(/class="limit"/g) ?? []).length).toBe(t.corners.length);
      // 挨得近的弯，牌子也不叠：放大时、全图时都查（全图时牌子放大了 sc 倍）
      for (const [svg, sc] of [
        [close, 1],
        [far, 2 / LOD],
      ] as const) {
        const ps = [...svg.matchAll(/class="limit" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y)).toBeGreaterThan(2 * 12 * sc);
      }
      expect(far).not.toContain('class="tag"');
      expect(far).not.toContain('T1');
      expect((close.match(/class="tag"/g) ?? []).length).toBe(t.corners.length);
      // 限速数字只有弯道线上那一处
      expect((close.match(/class="limit"/g) ?? []).length).toBe(t.corners.length);
      expect(close).toContain('T1');
      // 制动牌每个弯 3 块，格号每 5 格一个
      expect((close.match(/<rect x="-6.5"/g) ?? []).length).toBe(t.corners.length * 3);
      expect((close.match(/<circle r="9"/g) ?? []).length).toBe(Math.ceil(t.spaces / 5));
    });
  }
});
