/**
 * 沿赛道取点的小工具（mapart.ts 用）：偏移线、格线上的点、弯的范围。
 */
import type { Geometry, Pt } from '../track/shape.ts';
import type { Track } from '../track/types.ts';

/**
 * 沿赛道从第 from 格到第 to 格（格数可以带小数、可以跨过 0 号格）的一条折线，往左偏 off(u)（u 是从 0 到 1 的进度，负数往右）。
 * 偏移跟着进度变的线：维修通道的进出口
 */
export function along(geo: Geometry, cells: number, from: number, to: number, off: (u: number) => number, step = 4): Pt[] {
  const per = geo.length / cells;
  const a = from * per;
  let b = to * per;
  if (b <= a) b += geo.length;
  const n = Math.max(1, Math.ceil((b - a) / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const p = geo.at(a + ((b - a) * i) / n);
    const o = off(i / n);
    out.push({ x: p.c.x + Math.sin(p.angle) * o, y: p.c.y - Math.cos(p.angle) * o });
  }
  return out;
}

/** 第 i 格起点的格线上、往左偏 off 的点，和那里的方向 */
export function edgePoint(geo: Geometry, i: number, off: number): { x: number; y: number; angle: number } {
  const e = geo.edges[((i % geo.edges.length) + geo.edges.length) % geo.edges.length]!;
  return { x: e.c.x + Math.sin(e.angle) * off, y: e.c.y - Math.cos(e.angle) * off, angle: e.angle };
}

/** 一个弯铺路肩、缓冲区的范围：从弯道线前一格起，到连着转弯的最后一格；side 是弯外侧（往右转时外侧在左边，offset 为正） */
export function bendRange(track: Track, geo: Geometry, at: number): { from: number; to: number; side: number } {
  const N = track.spaces;
  let turn = 0;
  let end = at;
  for (let k = 0; k < 12; k++) {
    const t = geo.turn[(at + k) % N]!;
    if (k > 1 && Math.abs(t) < 0.04) break;
    turn += t;
    end = at + k;
  }
  return { from: at - 1, to: end + 1, side: turn > 0 ? 1 : -1 };
}
