/**
 * 夜探地图上挡路的东西和按格子分桶的索引。
 * 守夜的义庄只有二十几块，`maps.ts` 的 pushOut 每次扫全表没问题；夜探一张图几百块，几百只怪每拍都要推，按 256 单位分桶只看附近的。
 * 推法和 `maps.ts` 的 pushOut 逐位一样（tests/explore-map.test.ts 对拍锁住）：候选块按下标从小到大处理，和扫全表的顺序一致。
 */

/** 画面层按 look 画：院墙、正房、摊子、河、台阶墙 */
export type RaidLook = 'wall_h' | 'wall_v' | 'hall' | 'house' | 'stall' | 'river' | 'terrace';

export interface RaidBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  look: RaidLook;
}

const BUCKET = 256;

export class BlockIndex {
  readonly blocks: readonly RaidBlock[];
  private readonly cols: number;
  private readonly rows: number;
  /** 每个桶里的块下标（升序） */
  private readonly buckets: Int32Array[];
  /** 去重：这一次查询里看过的块记上查询号 */
  private readonly stamp: Int32Array;
  private query = 0;

  constructor(blocks: readonly RaidBlock[], size: number) {
    this.blocks = blocks;
    this.cols = Math.ceil(size / BUCKET);
    this.rows = this.cols;
    const lists: number[][] = [];
    for (let i = 0; i < this.cols * this.rows; i++) lists.push([]);
    blocks.forEach((b, k) => {
      const c0 = Math.max(0, Math.floor(b.x / BUCKET));
      const c1 = Math.min(this.cols - 1, Math.floor((b.x + b.w) / BUCKET));
      const r0 = Math.max(0, Math.floor(b.y / BUCKET));
      const r1 = Math.min(this.rows - 1, Math.floor((b.y + b.h) / BUCKET));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c]!.push(k);
    });
    this.buckets = lists.map((l) => Int32Array.from(l));
    this.stamp = new Int32Array(blocks.length);
  }

  /** (x, y) 半径 r 附近可能压到的块，升序写进 out，返回个数 */
  near(x: number, y: number, r: number, out: Int32Array): number {
    this.query++;
    const c0 = Math.max(0, Math.floor((x - r) / BUCKET));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r) / BUCKET));
    const r0 = Math.max(0, Math.floor((y - r) / BUCKET));
    const r1 = Math.min(this.rows - 1, Math.floor((y + r) / BUCKET));
    let n = 0;
    for (let rr = r0; rr <= r1; rr++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets[rr * this.cols + c]!;
        for (let k = 0; k < b.length; k++) {
          const i = b[k]!;
          if (this.stamp[i] === this.query || n >= out.length) continue;
          this.stamp[i] = this.query;
          out[n++] = i;
        }
      }
    }
    // 插入排序（候选很少），保证和扫全表的处理顺序一样
    for (let i = 1; i < n; i++) {
      const v = out[i]!;
      let j = i - 1;
      while (j >= 0 && out[j]! > v) {
        out[j + 1] = out[j]!;
        j--;
      }
      out[j + 1] = v;
    }
    return n;
  }

  /** 和 `maps.ts` 的 pushOut 同一个推法，只看附近的块；返回推过没有 */
  pushOut(p: { x: number; y: number }, r: number): boolean {
    // 扫全表时，推过一次以后后面的块按新位置判断：这里推过就按新位置重新取附近的块，接着处理下标更大的，结果和扫全表一样
    let moved = false;
    let last = -1;
    for (;;) {
      const n = this.near(p.x, p.y, r, cand);
      let k = 0;
      while (k < n && cand[k]! <= last) k++;
      let pushed = false;
      for (; k < n; k++) {
        last = cand[k]!;
        if (pushOne(this.blocks[last]!, p, r)) {
          moved = pushed = true;
          break;
        }
      }
      if (!pushed) return moved;
    }
  }

  /** 圆（x, y, r）是不是一块都没压着 */
  free(x: number, y: number, r: number): boolean {
    const n = this.near(x, y, r, cand);
    for (let k = 0; k < n; k++) if (overlaps(this.blocks[cand[k]!]!, x, y, r)) return false;
    return true;
  }
}

const cand = new Int32Array(256);

export function overlaps(b: RaidBlock, x: number, y: number, r: number): boolean {
  const nx = x < b.x ? b.x : x > b.x + b.w ? b.x + b.w : x;
  const ny = y < b.y ? b.y : y > b.y + b.h ? b.y + b.h : y;
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

/** 一块：照抄 maps.ts pushOut 的循环体 */
function pushOne(b: RaidBlock, p: { x: number; y: number }, r: number): boolean {
  if (p.x + r <= b.x || p.x - r >= b.x + b.w || p.y + r <= b.y || p.y - r >= b.y + b.h) return false;
  const nx = p.x < b.x ? b.x : p.x > b.x + b.w ? b.x + b.w : p.x;
  const ny = p.y < b.y ? b.y : p.y > b.y + b.h ? b.y + b.h : p.y;
  const dx = p.x - nx;
  const dy = p.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 0) {
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    if (ax >= ay) p.x = nx + (dx < 0 ? -r : r);
    else p.y = ny + (dy < 0 ? -r : r);
  } else {
    const l = p.x - b.x;
    const rr = b.x + b.w - p.x;
    const t = p.y - b.y;
    const bb = b.y + b.h - p.y;
    const m = Math.min(l, rr, t, bb);
    if (m === l) p.x = b.x - r;
    else if (m === rr) p.x = b.x + b.w + r;
    else if (m === t) p.y = b.y - r;
    else p.y = b.y + b.h + r;
  }
  return true;
}
