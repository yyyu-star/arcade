/**
 * 主角的基础数值、升级经验、掉落（DESIGN.md 2.1）。
 */
import type { WeaponId } from './weapons.ts';

export const PLAYER = {
  hp: 100,
  /** 每拍走几个单位（每秒 90） */
  speed: 3,
  r: 14,
  /** 吸魂珠的半径 */
  magnet: 64,
  /** 挨一下以后无敌几拍 */
  invuln: 14,
  /** 暴击率和倍数 */
  crit: 0.06,
  critMul: 2,
  start: 'sword' as WeaponId,
};

/** 场地：守夜的有界雪原 */
export const ARENA = { w: 3200, h: 3200 };

/** 从 level 升到 level + 1 要多少魂 */
export function xpNeed(level: number): number {
  if (level < 20) return 5 + (level - 1) * 9;
  if (level < 40) return 5 + 19 * 9 + (level - 20) * 22;
  return 5 + 19 * 9 + 20 * 22 + (level - 40) * 30;
}

/** 掉落：普通怪每只掉魂珠，另有小概率掉铜钱、肉包（回血）、符纸卷（吸全屏的魂珠） */
export const DROPS = { coin: 0.04, bun: 0.006, scroll: 0.0025, bunHeal: 30 };

/** 魂珠：靠近被吸以后的速度（每拍，越吸越快）；地上最多 soulCap 颗（多的并成大珠）；磁吸半径每级加 magnetPerLevel */
export const PICKUP = { pull: 5, pullAccel: 0.5, grab: 18, soulCap: 80, magnetPerLevel: 0.015 };
