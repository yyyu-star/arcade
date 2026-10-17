/**
 * 怪的格子分区（DESIGN.md 5.1）：每拍按位置重建一次（计数排序，O(n)），查询只看相关的几个格子。
 * 查询结果按"格子顺序 + 格子里放进去的顺序"排，确定。
 */
import { MAX_ENEMIES, type World } from './state.ts';

export const CELL = 64;
const INV = 1 / CELL;

export class Grid {
  /** 格子的列数、行数：按这一局的场地大小（守夜 3200 见方，夜探的镇子更大） */
  private readonly CW: number;
  private readonly CH: number;
  readonly start: Int32Array;
  readonly items = new Int32Array(MAX_ENEMIES);
  private readonly cellOf = new Int32Array(MAX_ENEMIES);
  private readonly posScratch: Int32Array;
  /** 查询结果 */
  readonly out = new Int32Array(MAX_ENEMIES);
  n = 0;

  constructor(w: number, h: number) {
    this.CW = Math.ceil(w / CELL);
    this.CH = Math.ceil(h / CELL);
    this.start = new Int32Array(this.CW * this.CH + 1);
    this.posScratch = new Int32Array(this.CW * this.CH);
  }

  build(w: World): void {
    const start = this.start;
    start.fill(0);
    const CW = this.CW;
    const CH = this.CH;
    const alive = w.eAlive;
    const ex = w.eX;
    const ey = w.eY;
    const cellOf = this.cellOf;
    // 活着的怪都找到了就停：槽位总是先填前面的，后面大片是空的
    let left = w.eCount;
    for (let i = 0; i < MAX_ENEMIES && left > 0; i++) {
      if (!alive[i]) continue;
      left--;
      // CELL 是 2 的幂，乘倒数和除法逐位相同；负数截断到 0 和 floor 后夹到 0 结果一样
      let cx = (ex[i]! * INV) | 0;
      let cy = (ey[i]! * INV) | 0;
      if (ex[i]! < 0) cx = 0;
      else if (cx >= CW) cx = CW - 1;
      if (ey[i]! < 0) cy = 0;
      else if (cy >= CH) cy = CH - 1;
      const c = cy * CW + cx;
      cellOf[i] = c;
      start[c + 1]!++;
    }
    const cells = CW * CH;
    for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
    // 每个格子的写指针从它的起点开始
    const pos = this.posScratch;
    pos.set(start.subarray(0, cells));
    const items = this.items;
    left = w.eCount;
    for (let i = 0; i < MAX_ENEMIES && left > 0; i++) {
      if (!alive[i]) continue;
      left--;
      items[pos[cellOf[i]!]!++] = i;
    }
  }

  /** 查询范围的格子行列（含端点），放在 x0..y1 里；query 和 separate 共用 */
  x0 = 0;
  x1 = 0;
  y0 = 0;
  y1 = 0;
  /** 每行的格子数，separate 里按行扫用 */
  get cols(): number {
    return this.CW;
  }
  span(x: number, y: number, reach: number): void {
    let x0 = Math.floor((x - reach) * INV);
    let x1 = Math.floor((x + reach) * INV);
    let y0 = Math.floor((y - reach) * INV);
    let y1 = Math.floor((y + reach) * INV);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.CW) x1 = this.CW - 1;
    if (y1 >= this.CH) y1 = this.CH - 1;
    this.x0 = x0;
    this.x1 = x1;
    this.y0 = y0;
    this.y1 = y1;
  }

  /**
   * 圆心 (x, y)、半径 r 里碰得到的怪（怪自己的半径也算上），结果放在 out[0..n)。
   * 返回个数。
   */
  query(w: World, x: number, y: number, r: number): number {
    this.span(x, y, r + 50);
    const CW = this.CW;
    const x0 = this.x0;
    const x1 = this.x1;
    const y0 = this.y0;
    const y1 = this.y1;
    let n = 0;
    const out = this.out;
    const start = this.start;
    const items = this.items;
    const alive = w.eAlive;
    const ex = w.eX;
    const ey = w.eY;
    const er = w.eR;
    for (let cy = y0; cy <= y1; cy++) {
      // 同一行的相邻格子在 items 里首尾相连，一次扫完
      const k1 = start[cy * CW + x1 + 1]!;
      for (let k = start[cy * CW + x0]!; k < k1; k++) {
        const i = items[k]!;
        if (alive[i] === 0) continue;
        const dx = ex[i]! - x;
        const dy = ey[i]! - y;
        const rr = r + er[i]!;
        if (dx * dx + dy * dy <= rr * rr) out[n++] = i;
      }
    }
    this.n = n;
    return n;
  }
}
