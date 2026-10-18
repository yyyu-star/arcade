/**
 * 各地区的特色怪（DESIGN.md 3.5）：哪张守夜图、哪个夜探镇有哪些特色怪、从第几分钟起占多少刷怪、图专属精英什么时候出。
 * 特色怪是"从原来的刷怪里分一块出来"，不额外加量：每次补怪先按本分钟的合计占比抽一次，抽中了刷特色怪，没抽中走原来的分钟表，
 * 所以总量和节奏不变。没登记的地图（雪原、义庄）一次额外的随机数都不抽，刷怪和以前逐位相同。
 * 怪的行为在 `core/step.ts` 的 mobAct，数值在 `enemies.ts`。
 */
import type { EnemyKind } from './enemies.ts';
import type { RaidTemplateId } from './explore.ts';
import type { MapId } from './maps.ts';

const S = 30;

export interface RegionMob {
  kind: EnemyKind;
  /** [从第几分钟起, 占刷怪的比例]，按分钟升序；到了某一档就用那一档的比例，直到下一档 */
  share: readonly (readonly [number, number])[];
}

export interface RegionElite {
  /** 第几拍出（守夜；危险档的"精英晚到"同样生效） */
  at: number;
  enemy: EnemyKind;
  count: number;
}

export interface Region {
  mobs: readonly RegionMob[];
  /** 图专属精英（夜探没有） */
  elites?: readonly RegionElite[];
}

/** 守夜：三张新图 */
export const VIGIL_REGIONS: Partial<Record<MapId, Region>> = {
  // 竹林：竹精从地里钻出来（先冒圈）、蛇精藏着窜出来；竹王 6:30 和 11:00 各一次
  bamboo: {
    mobs: [
      { kind: 'bamsprout', share: [[1, 0.144], [5, 0.216]] },
      { kind: 'snakespirit', share: [[3, 0.1], [7, 0.14]] },
    ],
    elites: [
      { at: 390 * S, enemy: 'bambooking', count: 1 },
      { at: 660 * S, enemy: 'bambooking', count: 1 },
    ],
  },
  // 河滩：溺鬼拖住人、河蟹横着走；河伯 6:30 和 11:00 各一次
  riverbank: {
    mobs: [
      { kind: 'drown', share: [[1, 0.1], [5, 0.15]] },
      { kind: 'crab', share: [[3, 0.1], [7, 0.14]] },
    ],
    elites: [
      { at: 390 * S, enemy: 'hebo', count: 1 },
      { at: 660 * S, enemy: 'hebo', count: 1 },
    ],
  },
  // 冰湖：冰傀碎成两个、冰凌预告冰刺；冰魄 6:30 和 11:00 各一次
  icelake: {
    mobs: [
      { kind: 'icegolem', share: [[2, 0.1], [6, 0.14]] },
      { kind: 'icicle', share: [[4, 0.04], [8, 0.055]] },
    ],
    elites: [
      { at: 390 * S, enemy: 'frostsoul', count: 1 },
      { at: 660 * S, enemy: 'frostsoul', count: 1 },
    ],
  },
};

/** 夜探：每个镇一种特色怪（教学镇没有） */
export const RAID_REGIONS: Partial<Record<RaidTemplateId, Region>> = {
  guzhen: { mobs: [{ kind: 'nightwatch', share: [[2, 0.1], [6, 0.15]] }] },
  dukou: { mobs: [{ kind: 'drown', share: [[2, 0.12], [6, 0.18]] }] },
  shansi: { mobs: [{ kind: 'stonemonk', share: [[3, 0.12], [7, 0.18]] }] },
};

function shareOf(m: RegionMob, minute: number): number {
  let s = 0;
  for (const [from, v] of m.share) if (minute >= from) s = v;
  return s;
}

/** 这一分钟特色怪合计占刷怪的比例 */
export function regionTotal(r: Region, minute: number): number {
  let t = 0;
  for (const m of r.mobs) t += shareOf(m, minute);
  return t;
}

/** r（0 到 regionTotal 之间的一个随机数）落在哪种特色怪上 */
export function regionKind(r: Region, minute: number, x: number): EnemyKind {
  let last = r.mobs[0]!.kind;
  for (const m of r.mobs) {
    const s = shareOf(m, minute);
    if (s <= 0) continue;
    last = m.kind;
    x -= s;
    if (x < 0) return last;
  }
  return last;
}

/** 钻地出场的怪：刷在主角附近（不是屏幕外的一圈），自己带出场的预警 */
export const EMERGE_KINDS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['water', 'bamsprout', 'drown']);
