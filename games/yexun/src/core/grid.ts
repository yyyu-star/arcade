/**
 * 怪的格子分区（DESIGN.md 5.1）：每拍按位置重建一次（计数排序，O(n)），查询只看相关的几个格子。
 * 查询结果按"格子顺序 + 格子里放进去的顺序"排，确定。
 */
import { MAX_ENEMIES, type World } from './state.ts';

export const CELL = 64;

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

  private cell(x: number, y: number): number {
    const CW = this.CW;
    const CH = this.CH;
    let cx = Math.floor(x / CELL);
    let cy = Math.floor(y / CELL);
    cx = cx < 0 ? 0 : cx >= CW ? CW - 1 : cx;
    cy = cy < 0 ? 0 : cy >= CH ? CH - 1 : cy;
    return cy * CW + cx;
  }

  build(w: World): void {
    const start = this.start;
    start.fill(0);
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!w.eAlive[i]) continue;
      const c = this.cell(w.eX[i]!, w.eY[i]!);
      this.cellOf[i] = c;
      start[c + 1]!++;
    }
    const cells = this.CW * this.CH;
    for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
    // 每个格子的写指针从它的起点开始
    const pos = this.posScratch;
    pos.set(start.subarray(0, cells));
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!w.eAlive[i]) continue;
      const c = this.cellOf[i]!;
      this.items[pos[c]!++] = i;
    }
  }


  /**
   * 圆心 (x, y)、半径 r 里碰得到的怪（怪自己的半径也算上），结果放在 out[0..n)。
   * 返回个数。
   */
  query(w: World, x: number, y: number, r: number): number {
    const CW = this.CW;
    const CH = this.CH;
    const reach = r + 50;
    let x0 = Math.floor((x - reach) / CELL);
    let x1 = Math.floor((x + reach) / CELL);
    let y0 = Math.floor((y - reach) / CELL);
    let y1 = Math.floor((y + reach) / CELL);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= CW) x1 = CW - 1;
    if (y1 >= CH) y1 = CH - 1;
    let n = 0;
    const out = this.out;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * CW + cx;
        for (let k = this.start[c]!; k < this.start[c + 1]!; k++) {
          const i = this.items[k]!;
          if (!w.eAlive[i]) continue;
          const dx = w.eX[i]! - x;
          const dy = w.eY[i]! - y;
          const rr = r + w.eR[i]!;
          if (dx * dx + dy * dy <= rr * rr) out[n++] = i;
        }
      }
    }
    this.n = n;
    return n;
  }
}
