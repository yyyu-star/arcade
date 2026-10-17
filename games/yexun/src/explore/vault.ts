/**
 * 藏宝阁（DESIGN.md 2.3、3.8）：45 件宝物的图鉴。
 * - "见过"：在夜探里捡到过（哪怕后来死了丢了），图鉴里显示剪影和名字；
 * - "收藏"：带出来过，图鉴点亮，记带出过几件。主界面的总收集度、采药女的解锁（收藏 20 件）按收藏算。
 * 存进 `yexun.save`（主代理接存档时放一个 vault 字段）；这里只是纯函数，输入旧的、输出新的，不改原对象。
 */
import { VAULT_UNLOCK } from '../content/explore.ts';
import { TIERS, TREASURES, TREASURE_BY_ID, type TreasureTier } from '../content/treasures.ts';
import type { RaidResult } from './settle.ts';

export interface VaultSave {
  /** 宝物 id → 带出过几件 */
  got: Record<string, number>;
  /** 见过的宝物 id */
  seen: string[];
}

export function emptyVault(): VaultSave {
  return { got: {}, seen: [] };
}

/** 从存档读回来：只留认得的 id 和正整数 */
export function normalizeVault(raw: unknown): VaultSave {
  const v = emptyVault();
  if (!raw || typeof raw !== 'object') return v;
  const r = raw as { got?: unknown; seen?: unknown };
  if (r.got && typeof r.got === 'object') {
    for (const [id, n] of Object.entries(r.got as Record<string, unknown>)) {
      if (TREASURE_BY_ID[id] && typeof n === 'number' && Number.isInteger(n) && n > 0) v.got[id] = n;
    }
  }
  if (Array.isArray(r.seen)) for (const id of r.seen) if (typeof id === 'string' && TREASURE_BY_ID[id] && !v.seen.includes(id)) v.seen.push(id);
  for (const id of Object.keys(v.got)) if (!v.seen.includes(id)) v.seen.push(id);
  return v;
}

/** 记一局：kept 进收藏，kept 和 lost 都算见过；返回新的藏宝阁和这局第一次收藏到的 id（结算页闪一下） */
export function recordRaid(v: VaultSave, r: Pick<RaidResult, 'kept' | 'lost'>): { vault: VaultSave; fresh: string[] } {
  const got = { ...v.got };
  const seen = v.seen.slice();
  const fresh: string[] = [];
  for (const code of r.kept) {
    const id = TREASURES[code]!.id;
    if (!got[id]) fresh.push(id);
    got[id] = (got[id] ?? 0) + 1;
  }
  for (const code of [...r.kept, ...r.lost]) {
    const id = TREASURES[code]!.id;
    if (!seen.includes(id)) seen.push(id);
  }
  return { vault: { got, seen }, fresh };
}

export interface VaultProgress {
  got: number;
  seen: number;
  total: number;
  byTier: Record<TreasureTier, { got: number; total: number }>;
}

export function vaultProgress(v: VaultSave): VaultProgress {
  const byTier = Object.fromEntries(TIERS.map((t) => [t, { got: 0, total: 0 }])) as Record<TreasureTier, { got: number; total: number }>;
  let got = 0;
  for (const t of TREASURES) {
    byTier[t.tier].total++;
    if (v.got[t.id]) {
      byTier[t.tier].got++;
      got++;
    }
  }
  return { got, seen: v.seen.length, total: TREASURES.length, byTier };
}

/** 采药女：藏宝阁收藏 20 件 */
export function herbalistUnlocked(v: VaultSave): boolean {
  return vaultProgress(v).got >= VAULT_UNLOCK.herbalist;
}
