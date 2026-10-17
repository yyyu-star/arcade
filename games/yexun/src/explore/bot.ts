/**
 * 夜探的机器人走法（给第 7 步的模拟器和这一步的测试）：只用玩家看得到的信息——
 * 宝箱的位置（地图上画着）、开着的门的指引（箭头、距离、脚印，guide.ts）。
 * 小白：门一开就沿脚印走（不贪）；普通：搜到 leaveAt 拍以后再走。怪由核心的机器人另外躲（这里只管去哪）。
 * 输出核心的输入方向：0 不动，1–32 是 32 向。
 */
import { CHEST_OPEN } from '../content/explore.ts';
import { dirIndex, dist } from '../core/fmath.ts';
import { gateField, guide, newGuide, type Guide } from './guide.ts';
import { NAV_INF } from './nav.ts';
import type { Raid } from './raid.ts';

export class RaidBot {
  private readonly raid: Raid;
  /** 这一拍以后，门一开就走 */
  private readonly leaveAt: number;
  private target = -1;
  private field: Int32Array | null = null;
  readonly g: Guide = newGuide();

  constructor(raid: Raid, leaveAt = 0) {
    this.raid = raid;
    this.leaveAt = leaveAt;
  }

  /** 这一拍往哪走 */
  dir(x: number, y: number, tick: number): number {
    const raid = this.raid;
    const chests = raid.map.chests;
    let left = 0;
    for (let c = 0; c < chests.length; c++) if (!raid.chestOpen[c]) left++;
    if (raid.gateMask !== 0 && (tick >= this.leaveAt || left === 0) && guide(raid, x, y, this.g)) {
      // 沿脚印走：脚印就是这张最短路场的下坡
      const field = gateField(raid)!;
      return this.step(x, y, field);
    }
    // 旁边就有没开的箱子：站着搜
    for (let c = 0; c < chests.length; c++) {
      if (!raid.chestOpen[c] && dist(chests[c]!.x - x, chests[c]!.y - y) <= CHEST_OPEN.range * 0.8) return 0;
    }
    if (this.target < 0 || raid.chestOpen[this.target]) this.pick(x, y);
    if (this.target < 0 || !this.field) return 0;
    const ch = chests[this.target]!;
    if (dist(ch.x - x, ch.y - y) < 60) return toward(ch.x - x, ch.y - y);
    return this.step(x, y, this.field);
  }

  /**
   * 沿最短路场走一步：先在身边两圈里找直线走得到、离终点最近的格子，再顺着下坡往前看最多 4 格（直线走得通就看更远的），朝那里走。
   * 只看"下一格"会在门框、墙角上卡住（32 向量化以后斜着蹭墙角，推开又蹭回去）。
   */
  private step(x: number, y: number, field: Int32Array): number {
    const raid = this.raid;
    const nav = raid.map.nav;
    const n = nav.n;
    const c0 = nav.index(x, y);
    const i0 = c0 % n;
    const j0 = (c0 - i0) / n;
    let best = -1;
    let bd = NAV_INF;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const c = j * n + i;
        if (!nav.free[c] || field[c]! >= bd) continue;
        if (!this.clear(x, y, nav.cx(c), nav.cy(c))) continue;
        bd = field[c]!;
        best = c;
      }
    }
    if (best < 0) {
      const c = nav.nearestFree(x, y);
      return c < 0 ? 0 : toward(nav.cx(c) - x, nav.cy(c) - y);
    }
    let aim = best;
    for (let k = 0; k < 4; k++) {
      const nx = nav.downhill(field, aim);
      if (nx < 0 || !this.clear(x, y, nav.cx(nx), nav.cy(nx))) break;
      aim = nx;
    }
    const dx = nav.cx(aim) - x;
    const dy = nav.cy(aim) - y;
    // 已经站在终点格的中心：不动（门圈里等读条）
    if (dx * dx + dy * dy < 4) return 0;
    return toward(dx, dy);
  }

  private clear(x0: number, y0: number, x1: number, y1: number): boolean {
    const index = this.raid.map.index;
    return this.raid.map.nav.lineClear(x0, y0, x1, y1, 13, (x, y, r) => index.free(x, y, r));
  }

  /** 挑直线最近的没开的箱子，算一张到它的最短路场 */
  private pick(x: number, y: number): void {
    const chests = this.raid.map.chests;
    let best = -1;
    let bd = Infinity;
    for (let c = 0; c < chests.length; c++) {
      if (this.raid.chestOpen[c]) continue;
      const d = dist(chests[c]!.x - x, chests[c]!.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    this.target = best;
    if (best < 0) {
      this.field = null;
      return;
    }
    const nav = this.raid.map.nav;
    const c = nav.nearestFree(chests[best]!.x, chests[best]!.y);
    this.field = c < 0 ? null : nav.field([c]);
  }
}

/** 向量 → 输入方向 1–32 */
export function toward(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return (Math.round(dirIndex(dx, dy) / 8) % 32) + 1;
}
