/**
 * 撤离指引（DESIGN.md 2.3"别让人因为找不到门输光"）：最近的开着的门（按沿路走的距离，不是直线）、还有多远、
 * 屏幕边上的箭头指哪（直线方向）、地上的脚印（沿最短路往前的一串点）。机器人小白也只靠这些找门。
 * 最短路场在开着的门变了的时候才重算（一局几次）；每帧沿场下坡走一遍找终点和脚印，几百步。
 */
import { GATE } from '../content/explore.ts';
import { dist } from '../core/fmath.ts';
import { NAV_CELL, NAV_INF } from './nav.ts';
import type { Raid } from './raid.ts';

/** 脚印最多几个、隔几格一个 */
export const TRAIL = { max: 10, every: 3 };

export interface Guide {
  /** 最近的开着的门（下标）；没有开着的门是 −1 */
  gate: number;
  /** 沿路走过去的距离（单位） */
  dist: number;
  /** 直线方向（单位向量，屏幕边的箭头用） */
  dirX: number;
  dirY: number;
  /** 脚印：x0, y0, x1, y1, …，从主角脚下往门的方向 */
  trail: Float64Array;
  trailN: number;
}

export function newGuide(): Guide {
  return { gate: -1, dist: 0, dirX: 0, dirY: 0, trail: new Float64Array(TRAIL.max * 2), trailN: 0 };
}

const cache = new WeakMap<Raid, { mask: number; field: Int32Array }>();

/** 当前开着的门的最短路场（门圈里走得通的格子都是起点） */
export function gateField(raid: Raid): Int32Array | null {
  if (raid.gateMask === 0) return null;
  const hit = cache.get(raid);
  if (hit && hit.mask === raid.gateMask) return hit.field;
  const nav = raid.map.nav;
  const src: number[] = [];
  const rr = GATE.r * 0.6;
  raid.map.gates.forEach((g, k) => {
    if (!raid.gateOpen[k]) return;
    const c0 = nav.index(g.x - rr, g.y - rr);
    const c1 = nav.index(g.x + rr, g.y + rr);
    const i0 = c0 % nav.n;
    const i1 = c1 % nav.n;
    const j0 = Math.floor(c0 / nav.n);
    const j1 = Math.floor(c1 / nav.n);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * nav.n + i;
        if (nav.free[c] && dist(nav.cx(c) - g.x, nav.cy(c) - g.y) <= rr) src.push(c);
      }
    }
  });
  const field = nav.field(src);
  cache.set(raid, { mask: raid.gateMask, field });
  return field;
}

/** 算一次指引写进 out；没有开着的门或者走不到回 false（out.gate = −1） */
export function guide(raid: Raid, x: number, y: number, out: Guide): boolean {
  out.gate = -1;
  out.trailN = 0;
  const field = gateField(raid);
  if (!field) return false;
  const nav = raid.map.nav;
  let c = nav.nearestFree(x, y);
  if (c < 0 || field[c]! >= NAV_INF) return false;
  out.dist = (field[c]! / 10) * NAV_CELL;
  let steps = 0;
  for (;;) {
    const nx = nav.downhill(field, c);
    if (nx < 0) break;
    c = nx;
    if (++steps % TRAIL.every === 0 && out.trailN < TRAIL.max) {
      out.trail[out.trailN * 2] = nav.cx(c);
      out.trail[out.trailN * 2 + 1] = nav.cy(c);
      out.trailN++;
    }
  }
  // 走到底的那格在哪座开着的门圈里
  let best = -1;
  let bd = Infinity;
  raid.map.gates.forEach((g, k) => {
    if (!raid.gateOpen[k]) return;
    const d = dist(g.x - nav.cx(c), g.y - nav.cy(c));
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  out.gate = best;
  const g = raid.map.gates[best]!;
  const d = dist(g.x - x, g.y - y);
  out.dirX = d > 0 ? (g.x - x) / d : 0;
  out.dirY = d > 0 ? (g.y - y) / d : 0;
  return true;
}
