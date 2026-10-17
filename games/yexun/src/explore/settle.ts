/**
 * 夜探结算（DESIGN.md 2.3、4.2）。
 * - 撤出：背包里的宝物全带出；娱乐按价值换铜钱（content/explore.ts 的 RAID_EXCHANGE），实盘按价值算结回倍数。
 * - 死亡 / 迷失：背包全丢；娱乐拿这局捡到的铜钱的一半，实盘这一份结回 0。
 * - 教学镇：死了（或迷失）也不丢包，按撤出算宝物和铜钱；教学镇不开实盘。
 * 倍数 = clamp(带出的价值 ÷ 这一档的基准价值, 0, 封顶)；结回 = 带入 × 倍数 向下取整，倍数按万分之一（bp）传，同开盘。
 */
import { RAID_EXCHANGE, RAID_LIVE, type RaidLiveTemplate, type RaidLiveTier } from '../content/explore.ts';
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
  // 早搜奖励只跟着带出的包走（死了包丢了，奖励也没了）
  const value = bagValue(kept) + (keep ? raid.earlyBonus : 0);
  let coins: number;
  if (keep) coins = pickedCoins + (live ? 0 : Math.floor(value * RAID_EXCHANGE.rate));
  else coins = Math.floor(pickedCoins * RAID_EXCHANGE.deathCoinShare);
  const bp = live && out === 'escaped' && raid.setup.template !== 'teach' ? liveBp(value, live, raid.setup.template, raid.endTick) : 0;
  return { outcome: out, kept, lost, value, coins, bp };
}

/** 撤出时刻的保底：从 1.0 线性涨到这一档的满额，floorRamp 拍给满（撤出越早给得越少，开门就走只拿一点） */
export function liveFloor(ticks: number, tier: RaidLiveTier): number {
  const ramp = RAID_LIVE.floorRamp[tier];
  const k = ticks >= ramp ? 1 : ticks <= 0 ? 0 : ticks / ramp;
  return 1 + (RAID_LIVE.floor[tier] - 1) * k;
}

/** 实盘倍数（浮点，显示用）；ticks = 撤出时刻，缺省按保底给满 */
export function liveMultiplier(value: number, tier: RaidLiveTier, template: RaidLiveTemplate = 'guzhen', ticks: number = RAID_LIVE.floorRamp[tier]): number {
  // 撤出了才会调到这里：至少保底，最多封顶
  const m = value / RAID_LIVE.base[tier][template];
  const floor = liveFloor(ticks, tier);
  return m < floor ? floor : m > RAID_LIVE.cap ? RAID_LIVE.cap : m;
}

/** 实盘倍数的万分之一（向下取整） */
export function liveBp(value: number, tier: RaidLiveTier, template: RaidLiveTemplate = 'guzhen', ticks: number = RAID_LIVE.floorRamp[tier]): number {
  return Math.floor(liveMultiplier(value, tier, template, ticks) * 10000);
}

/** 结回：带入 × bp ÷ 10000 向下取整 */
export function livePayout(buyin: number, bp: number): number {
  return Math.floor((buyin * bp) / 10000);
}
