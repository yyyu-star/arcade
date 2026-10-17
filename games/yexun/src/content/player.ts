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

/**
 * 升级曲线：每段每级多要多少魂（DESIGN.md 13.3：前 3 分钟 ≥ 10 次、5 分钟前 ≥ 16 次，全局 35–45 次，后半段每分钟 1.5–2 次）。
 * 前段平缓（开局升得快），midFrom 级以后陡一截，lateFrom 级以后再陡。
 */
export const XP_CURVE = { first: 20, early: 15, midFrom: 20, mid: 50, lateFrom: 34, late: 110 };

/**
 * 夜探的升级曲线：沿用守夜放慢以前的（2026-10-17 守夜开局放慢以后没跟着改）。夜探的镇子大、怪按区域刷、远没有守夜密，
 * 按守夜的新曲线 3 分钟只有 2–3 级，机器人十有八九倒在第一个院子里。
 */
export const RAID_XP_CURVE = { first: 5, early: 9, midFrom: 20, mid: 44, lateFrom: 40, late: 70 };

/** 从 level 升到 level + 1 要多少魂（raid：夜探用自己的曲线） */
export function xpNeed(level: number, raid = false): number {
  const c = raid ? RAID_XP_CURVE : XP_CURVE;
  if (level < c.midFrom) return c.first + (level - 1) * c.early;
  const atMid = c.first + (c.midFrom - 1) * c.early;
  if (level < c.lateFrom) return atMid + (level - c.midFrom) * c.mid;
  return atMid + (c.lateFrom - c.midFrom) * c.mid + (level - c.lateFrom) * c.late;
}

/** 掉落：普通怪每只掉魂珠，另有小概率掉铜钱、肉包（回血）、符纸卷（磁符：吸全屏的魂珠）、符咒炸弹、铜钱袋 */
export const DROPS = { coin: 0.04, bun: 0.006, scroll: 0.0025, bomb: 0.0012, purse: 0.0015, bunHeal: 30 };

/**
 * 宝箱（精英、纸扎老爷掉）：一次升 1 / 3 / 5 件，开箱有演出（对标 VS 的 1/3/5 箱）。
 * 老爷的箱子至少 3 件：中期 Boss 打下来要有大奖励。
 */
export const CHEST = { five: 0.06, three: 0.24, lordMin: 3 };

/** 符咒炸弹：半径内的小怪全倒（照常掉魂珠），精英和 Boss 掉最大血量的 eliteFrac */
export const BOMB = { r: 520, eliteFrac: 0.08 };

/** 铜钱袋：min..min+span-1 枚 */
export const PURSE = { min: 12, span: 14 };

/**
 * 摆设（守夜）：开局在场地里散 start 个，之后每 every 拍看一眼，主角 nearR 以内少于 near 个就在 minR..nearR 补一个。
 * 走过去碰碎，按 loot 掉一样东西（剩下的概率什么都不掉）。数量对标 VS 的灯台：常见、顺手、不用专门绕路。
 */
export const PROPS = {
  start: 36,
  near: 4,
  nearR: 760,
  minR: 420,
  every: 12 * 30,
  r: 18,
  loot: { bun: 0.3, coins: 0.32, scroll: 0.1, bomb: 0.08, purse: 0.12 },
  /** 掉铜钱时一堆几枚 */
  coins: 5,
};

/**
 * 受伤补偿（主线 4c 选项 A，DESIGN.md 2.4）：血低于 hp 时肉包掉率 × bun——挨打多的人（新手）帮得多，会躲的几乎用不上。
 * 上限：补偿多掉的肉包最多每 gap 拍一个（故意卖血换肉包，回的血比挨的打少）。
 */
export const MERCY = { hp: 0.4, bun: 3, gap: 20 * 30 };

/** 魂珠：靠近被吸以后的速度（每拍，越吸越快）；地上最多 soulCap 颗（多的并成大珠）；磁吸半径每级加 magnetPerLevel */
export const PICKUP = { pull: 5, pullAccel: 0.5, grab: 18, soulCap: 80, magnetPerLevel: 0.015 };
