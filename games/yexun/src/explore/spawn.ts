/**
 * 夜探的刷怪（DESIGN.md 2.3）：按夜探时间线（content/explore.ts 的 RAID_MINUTES），随时间变强（核心的 SCALE 照旧），
 * 离镇子中心越近越凶（血、伤害、刷怪量都乘深度倍数）。刷出来的点要推出墙、夹进场地。
 */
import { RAID_MINUTES, RAID_ZONE } from '../content/explore.ts';
import type { Minute } from '../content/waves.ts';
import { dist } from '../core/fmath.ts';
import type { RaidMap } from './mapgen.ts';
import type { Raid } from './raid.ts';

/** 这一拍用哪一档刷怪表（每分钟一档，过了最后一档就一直用最后一档） */
export function raidMinute(tick: number): Minute {
  const m = Math.floor(tick / 1800);
  return RAID_MINUTES[m < 0 ? 0 : m >= RAID_MINUTES.length ? RAID_MINUTES.length - 1 : m]!;
}

/** 深度：0 镇边 – 1 镇中心 */
export function raidDepth(map: RaidMap, x: number, y: number): number {
  const d = 1 - dist(x - map.center, y - map.center) / map.center;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** 深度倍数（复用一个对象，热路径不分配）：hp、dmg 按怪刷出来的位置，count 按主角站的位置 */
export const ZONE_MUL = { hp: 1, dmg: 1, count: 1 };
export function raidZoneMul(map: RaidMap, x: number, y: number): typeof ZONE_MUL {
  const d = raidDepth(map, x, y);
  ZONE_MUL.hp = 1 + RAID_ZONE.hp * d;
  ZONE_MUL.dmg = 1 + RAID_ZONE.dmg * d;
  ZONE_MUL.count = 1 + RAID_ZONE.count * d;
  return ZONE_MUL;
}

/** 把刷怪点夹进场地、推出墙（最多推三次：推一次可能推进相邻的另一块）；推完还压着墙就回 false，核心这只就不刷了 */
export function raidSpawnPoint(raid: Raid, p: { x: number; y: number }, r = 16): boolean {
  const s = raid.map.size;
  for (let k = 0; k < 3; k++) {
    p.x = p.x < 10 ? 10 : p.x > s - 10 ? s - 10 : p.x;
    p.y = p.y < 10 ? 10 : p.y > s - 10 ? s - 10 : p.y;
    if (!raid.map.index.pushOut(p, r)) return true;
  }
  return raid.map.index.free(p.x, p.y, r);
}
