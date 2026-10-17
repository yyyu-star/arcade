/**
 * 选卡卡片上的"克 X / 怕 Y"小字：从 enemies.ts 每种怪的 vs 表派生，不手写。
 * 一件法器对某种怪的伤害倍数 = vs[类型] × vs[五行]（缺的按 1，两个都对上就连乘，和核心里结算伤害一致）。
 * 只算常规怪（精英、Boss、夜探守卫另有说法，不在这里挑）；倍数最高的 1–2 种写"克"，最低的 1–2 种写"怕"。
 */
import { ENEMIES, type EnemyKind } from '../../content/enemies.ts';
import type { Element, WeaponType } from '../../content/weapons.ts';

/** 夜探的守卫，不是常规怪 */
const GUARDS: ReadonlySet<EnemyKind> = new Set(['patrol', 'beast', 'goblin']);

export interface Counters {
  /** 这件法器打得最狠的怪（倍数 > 1），最多 max 种，倍数从高到低 */
  strong: EnemyKind[];
  /** 打得最吃力的怪（倍数 < 1），最多 max 种，倍数从低到高 */
  weak: EnemyKind[];
}

export function multiplier(vs: Partial<Record<WeaponType | Element, number>> | undefined, type: WeaponType, el: Element): number {
  return (vs?.[type] ?? 1) * (vs?.[el] ?? 1);
}

export function counters(type: WeaponType, el: Element, max = 2): Counters {
  const rows: { kind: EnemyKind; m: number }[] = [];
  for (const e of ENEMIES) {
    if (e.elite || e.boss || GUARDS.has(e.kind)) continue;
    rows.push({ kind: e.kind, m: multiplier(e.vs, type, el) });
  }
  // 数组排序是稳定的：倍数相同按怪的编号先后
  const strong = rows.filter((r) => r.m > 1).sort((a, b) => b.m - a.m).slice(0, max).map((r) => r.kind);
  const weak = rows.filter((r) => r.m < 1).sort((a, b) => a.m - b.m).slice(0, max).map((r) => r.kind);
  return { strong, weak };
}

/** 一行小字："克 河蟹 纸人 · 怕 石…"；两头都没有返回 null */
export function counterLine(type: WeaponType, el: Element, nameOf: (k: EnemyKind) => string): string | null {
  const { strong, weak } = counters(type, el);
  const parts: string[] = [];
  if (strong.length) parts.push(`克 ${strong.map(nameOf).join(' ')}`);
  if (weak.length) parts.push(`怕 ${weak.map(nameOf).join(' ')}`);
  return parts.length ? parts.join(' · ') : null;
}
