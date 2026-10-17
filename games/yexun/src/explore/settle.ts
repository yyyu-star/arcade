/**
 * 夜探结算（DESIGN.md 2.3、4.2）。
 * - 撤出：背包里的宝物全带出；娱乐按价值换铜钱（content/explore.ts 的 RAID_EXCHANGE），实盘按价值算结回倍数。
 * - 死亡 / 迷失：背包全丢；娱乐拿这局捡到的铜钱的一半，实盘这一份结回 0。
 * - 教学镇：死了（或迷失）也不丢包，按撤出算宝物和铜钱；教学镇不开实盘。
 * 倍数 = clamp(带出的价值 ÷ 这一档的基准价值, 0, 封顶)；结回 = 带入 × 倍数 向下取整，倍数按万分之一（bp）传，同开盘。
 */
import { RAID_EXCHANGE, RAID_LIVE, type RaidLiveTier } from '../content/explore.ts';
import { bagValue } from './loot.ts';
import type { Raid, RaidOutcome } from './raid.ts';

export interface RaidResult {
  outcome: RaidOutcome;
  /** 带出来的、丢掉的宝物编号 */
  kept: number[];
  lost: number[];
  /** 带出的宝物总价值 */
  value: number;
  /** 这一局到手的铜钱（娱乐：捡到的 + 宝物换的；死了只有捡到的一半） */
  coins: number;
  /** 实盘倍数（万分之一）；娱乐为 0 */
  bp: number;
}

export function settleRaid(raid: Raid, pickedCoins: number): RaidResult {
  const out = raid.outcome;
  const live = raid.setup.live;
  const keep = out === 'escaped' || (raid.teach && out !== 'none');
  const kept = keep ? raid.bag.slice() : [];
  const lost = keep ? [] : raid.bag.slice();
  const value = bagValue(kept);
  let coins: number;
  if (keep) coins = pickedCoins + (live ? 0 : Math.floor(value * RAID_EXCHANGE.rate));
  else coins = Math.floor(pickedCoins * RAID_EXCHANGE.deathCoinShare);
  const bp = live && out === 'escaped' ? liveBp(value, live) : 0;
  return { outcome: out, kept, lost, value, coins, bp };
}

/** 实盘倍数（浮点，显示用） */
export function liveMultiplier(value: number, tier: RaidLiveTier): number {
  const m = value / RAID_LIVE.base[tier];
  return m < 0 ? 0 : m > RAID_LIVE.cap ? RAID_LIVE.cap : m;
}

/** 实盘倍数的万分之一（向下取整） */
export function liveBp(value: number, tier: RaidLiveTier): number {
  return Math.floor(liveMultiplier(value, tier) * 10000);
}

/** 结回：带入 × bp ÷ 10000 向下取整 */
export function livePayout(buyin: number, bp: number): number {
  return Math.floor((buyin * bp) / 10000);
}
