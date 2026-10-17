/**
 * 夜探的寻路格子：32 单位一格，格子中心离挡路的块不到主角半径就算堵着。
 * 用途：生成地图时保证出生点走得到每个宝箱和每座门；撤离指引算"沿路走到最近的开着的门有多远"、地上的脚印往哪走；巡夜将游荡的路口连线。
 * 只用整数和四则运算；最短路是 Dijkstra（直走 10、斜走 14，不许切墙角），堆里的键是"距离 × 2^20 + 格子号"，相等时按格子号，结果唯一。
 */
import type { RaidBlock } from './blocks.ts';

export const NAV_CELL = 32;
/** 格子中心离块多近算堵：主角半径 14 再留 10（贴墙走的路线一拐弯就会被墙角卡住，沿路走的机器人和脚印都离墙远一点） */
export const NAV_CLEAR = 24;
export const NAV_INF = 0x3fffffff;

const KEY = 1 << 20;

export class NavGrid {
  readonly n: number;
  readonly size: number;
  /** 1 = 走得通 */
  readonly free: Uint8Array;

  constructor(blocks: readonly RaidBlock[], size: number) {
    this.size = size;
    this.n = Math.floor(size / NAV_CELL);
    const n = this.n;
    this.free = new Uint8Array(n * n).fill(1);
    // 场地边上一圈（核心把主角夹在 [20, size − 20]）
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = (i + 0.5) * NAV_CELL;
        const cy = (j + 0.5) * NAV_CELL;
        if (cx < 20 || cy < 20 || cx > size - 20 || cy > size - 20) this.free[j * n + i] = 0;
      }
    }
    for (const b of blocks) {
      const i0 = Math.max(0, Math.ceil((b.x - NAV_CLEAR) / NAV_CELL - 0.5));
      const i1 = Math.min(n - 1, Math.floor((b.x + b.w + NAV_CLEAR) / NAV_CELL - 0.5));
      const j0 = Math.max(0, Math.ceil((b.y - NAV_CLEAR) / NAV_CELL - 0.5));
      const j1 = Math.min(n - 1, Math.floor((b.y + b.h + NAV_CLEAR) / NAV_CELL - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.free[j * n + i] = 0;
    }
  }

  /** 坐标 → 格子号（夹在场地里） */
  index(x: number, y: number): number {
    const n = this.n;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / NAV_CELL)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(y / NAV_CELL)));
    return j * n + i;
  }

  cx(c: number): number {
    return ((c % this.n) + 0.5) * NAV_CELL;
  }
  cy(c: number): number {
    return (Math.floor(c / this.n) + 0.5) * NAV_CELL;
  }

  /** 离 (x, y) 最近的走得通的格子（主角贴着墙时自己那格可能算堵）；3 圈内没有回 −1 */
  nearestFree(x: number, y: number): number {
    const c = this.index(x, y);
    if (this.free[c]) return c;
    const n = this.n;
    const ci = c % n;
    const cj = Math.floor(c / n);
    for (let ring = 1; ring <= 3; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          if (this.free[j * n + i]) return j * n + i;
        }
      }
    }
    return -1;
  }

  /**
   * 从 sources 出发到每一格的最短路长（单位：格 × 10，直走 10、斜走 14）；走不到是 NAV_INF。
   * 夜探里每次开门、关门才算一次（一局几次），一次 4 万格。
   */
  field(sources: readonly number[]): Int32Array {
    const n = this.n;
    const dist = new Int32Array(n * n).fill(NAV_INF);
    const heap = new Heap(n * n * 8);
    for (const s of sources) {
      if (!this.free[s] || dist[s] === 0) continue;
      dist[s] = 0;
      heap.push(s);
    }
    while (heap.size > 0) {
      const k = heap.pop();
      const c = k % KEY;
      const d = (k - c) / KEY;
      if (d !== dist[c]) continue;
      const i = c % n;
      const j = (c - i) / n;
      for (let t = 0; t < 8; t++) {
        const di = DI[t]!;
        const dj = DJ[t]!;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = nj * n + ni;
        if (!this.free[nc]) continue;
        // 斜着走不许切墙角：两边直着的格子都要通
        if (di !== 0 && dj !== 0 && (!this.free[j * n + ni] || !this.free[nj * n + i])) continue;
        const nd = d + (di !== 0 && dj !== 0 ? 14 : 10);
        if (nd < dist[nc]!) {
          dist[nc] = nd;
          heap.push(nd * KEY + nc);
        }
      }
    }
    return dist;
  }

  /** 两点间的直线走不走得通（巡夜将游荡的路口连线用）：每 8 单位查一次半径 r 的圆 */
  lineClear(x0: number, y0: number, x1: number, y1: number, r: number, free: (x: number, y: number, r: number) => boolean): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
    for (let s = 0; s <= steps; s++) if (!free(x0 + (dx * s) / steps, y0 + (dy * s) / steps, r)) return false;
    return true;
  }

  /** 从格子 c 沿最短路下坡走一步（8 邻里最小的，相等取先查到的）；已经在终点或走不动回 −1 */
  downhill(dist: Int32Array, c: number): number {
    const n = this.n;
    const i = c % n;
    const j = (c - i) / n;
    let best = -1;
    let bd = dist[c]!;
    for (let t = 0; t < 8; t++) {
      const ni = i + DI[t]!;
      const nj = j + DJ[t]!;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nc = nj * n + ni;
      if (dist[nc]! < bd) {
        bd = dist[nc]!;
        best = nc;
      }
    }
    return best;
  }
}

/** 8 邻：先直后斜 */
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/** 最小堆（Float64Array，键唯一） */
class Heap {
  private readonly a: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.a = new Float64Array(cap);
  }
  push(v: number): void {
    const a = this.a;
    if (this.size >= a.length) return;
    let i = this.size++;
    a[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= v) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const v = a[--this.size]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && a[r]! < a[l]! ? r : l;
      if (a[m]! >= v) break;
      a[i] = a[m]!;
      i = m;
    }
    if (this.size > 0) a[i] = v;
    return top;
  }
}
