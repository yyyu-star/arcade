/**
 * 选卡三件套：刷新、封禁、跳过（所有者 10-20，DESIGN 3.9）。
 * 跳过不再换 15% 经验，改成随机小奖；进化、打倒精英首领补刷新，让刷新不只是开局那几次。
 * 实盘局和娱乐一样（0.4.7 配平时重配了实盘系数）。
 */
export const PICKS = {
  rerolls: 3,
  bans: 2,
  /** 刷新最多攒到几次 */
  rerollMax: 9,
} as const;

/** 跳过的随机小奖：0 铜钱、1 回血、2 下次升级多一张卡（不叠加）、3 刷新 +1。weight 是概率（合计 1） */
export const SKIP_PRIZES = [
  { id: 'coins', weight: 0.35 },
  { id: 'heal', weight: 0.25 },
  { id: 'card', weight: 0.25 },
  { id: 'reroll', weight: 0.15 },
] as const;
export type SkipPrize = (typeof SKIP_PRIZES)[number]['id'];
/** 铜钱 = base + perLevel × 当前等级；回血按最大血量的比例 */
export const SKIP_FX = { coinBase: 10, coinPerLevel: 2, heal: 0.2 } as const;
