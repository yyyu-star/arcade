/**
 * 实盘（DESIGN.md 第 4 节）：档位、开局配置、结回倍数。Worker 只从这里取档位表和 liveReturn，不引规则核心（整个核心会被打进 Worker）。
 * 倍数的曲线是第 4.2 节的初值，第 7 步按模拟器每格 2,000 局调到 balance.md 第 2 节的区间。
 */
import type { Danger } from './waves.ts';

/**
 * 实盘开没开。第 7 步按 balance.md 把倍数曲线配平以前关着：4c 的模拟器预估期望倍数−1 有 0.6–1.9，远高于 balance.md，开着就是白送筹码。
 * 关着时菜单不显示实盘，Worker 拒绝带入（直接调接口也带不进去）；结回、退回照常，免得万一有挂着的一份结不掉。
 */
export const LIVE_OPEN = false;

export type LiveTier = 'small' | 'medium' | 'large' | 'luxe';
export const LIVE_TIER_IDS: readonly LiveTier[] = ['small', 'medium', 'large', 'luxe'];

export interface LiveTierDef {
  id: LiveTier;
  name: string;
  /** 一份多少筹码（docs/economy.md 第 2 节） */
  stake: number;
  /** 固定映射的危险档（4.1）：只维护一套怪表 */
  danger: Danger;
}

export const LIVE_TIERS: Record<LiveTier, LiveTierDef> = {
  small: { id: 'small', name: '小', stake: 2_000, danger: 0 },
  medium: { id: 'medium', name: '中', stake: 10_000, danger: 2 },
  large: { id: 'large', name: '大', stake: 50_000, danger: 3 },
  luxe: { id: 'luxe', name: '豪华', stake: 200_000, danger: 4 },
};

export function isLiveTier(v: unknown): v is LiveTier {
  return typeof v === 'string' && (LIVE_TIER_IDS as readonly string[]).includes(v);
}

/** 一场最多赢 3 份（结回 ≤ 带入 × 3，economy.md 第 2 节）；倍数按万分之一传 */
export const LIVE_MAX_BP = 30_000;

/**
 * 守夜的结回倍数（4.2）：按撑到的秒数逐拍插值，打倒尸王另算。点是 [秒, 万分比]；3:00 以前为 0，天亮 1.8，打倒尸王 3.0。
 * 曲线从 3:00 起平滑上升，没有"4 分 01 秒才有钱"的断崖。
 */
export const VIGIL_CURVE: readonly (readonly [number, number])[] = [
  [180, 0],
  [300, 2_500],
  [600, 10_000],
  [840, 13_000],
  [900, 18_000],
];
export const VIGIL_BOSS_BP = 30_000;

/** 守夜撑了 ticks 拍（每秒 30 拍）、赢没赢、打没打倒尸王 → 结回倍数（万分比，整数） */
export function vigilBp(ticks: number, won: boolean, bossKilled: boolean): number {
  if (bossKilled) return VIGIL_BOSS_BP;
  if (won) return VIGIL_CURVE[VIGIL_CURVE.length - 1]![1];
  // 按拍插值：整数运算，浏览器和 Worker、各平台算出来一样
  const t = Math.max(0, Math.floor(ticks));
  for (let i = 1; i < VIGIL_CURVE.length; i++) {
    const [s1, b1] = VIGIL_CURVE[i]!;
    if (t >= s1 * 30) continue;
    const [s0, b0] = VIGIL_CURVE[i - 1]!;
    if (t <= s0 * 30) return b0;
    return b0 + Math.floor(((b1 - b0) * (t - s0 * 30)) / ((s1 - s0) * 30));
  }
  return VIGIL_CURVE[VIGIL_CURVE.length - 1]![1];
}

/** 结回多少筹码：桌上那一份 × 倍数，向下取整（和开盘一样） */
export function liveReturn(stake: number, bp: number): number {
  return Math.floor((stake * Math.max(0, Math.min(LIVE_MAX_BP, Math.floor(bp)))) / 10_000);
}
