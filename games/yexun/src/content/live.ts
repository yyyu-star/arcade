/**
 * 实盘（DESIGN.md 第 4 节）：档位、开局配置、结回倍数。Worker 只从这里取档位表和 liveReturn，不引规则核心（整个核心会被打进 Worker）。
 * 倍数曲线第 7 步按模拟器每格 2,000 局配到 balance.md 第 2 节的区间：形状四档共用，天亮倍数每档一个（DESIGN.md 4.2）。
 */
import type { Danger } from './waves.ts';

/**
 * 实盘开没开（守夜）。第 7 步按模拟器每格 2,000 局把四档的天亮倍数配进 balance.md 的区间后打开（2026-10-17）。
 * 关掉时菜单不显示实盘，Worker 拒绝带入（直接调接口也带不进去）；结回、退回照常，免得万一有挂着的一份结不掉。
 * 夜探实盘另做（基准价值要先模拟），菜单上先写"很快开放"。
 */
export const LIVE_OPEN = true;

export type LiveTier = 'small' | 'medium' | 'large' | 'luxe';
export const LIVE_TIER_IDS: readonly LiveTier[] = ['small', 'medium', 'large', 'luxe'];

export interface LiveTierDef {
  id: LiveTier;
  name: string;
  /** 一份多少筹码（docs/economy.md 第 2 节） */
  stake: number;
  /** 固定映射的危险档（4.1）：只维护一套怪表 */
  danger: Danger;
  /** 撑到天亮结回几倍（万分比）；中途倒下按 VIGIL_SHAPE 折算，打倒尸王再加 VIGIL_BOSS_ADD_BP。第 7 步用 .local 的 fit.mjs 从模拟器结局拟合 */
  dawnBp: number;
}

export const LIVE_TIERS: Record<LiveTier, LiveTierDef> = {
  small: { id: 'small', name: '小', stake: 2_000, danger: 0, dawnBp: 12_700 },
  medium: { id: 'medium', name: '中', stake: 10_000, danger: 2, dawnBp: 17_900 },
  large: { id: 'large', name: '大', stake: 50_000, danger: 3, dawnBp: 17_900 },
  luxe: { id: 'luxe', name: '豪华', stake: 200_000, danger: 4, dawnBp: 19_300 },
};

export function isLiveTier(v: unknown): v is LiveTier {
  return typeof v === 'string' && (LIVE_TIER_IDS as readonly string[]).includes(v);
}

/** 一场最多赢 3 份（结回 ≤ 带入 × 3，economy.md 第 2 节）；倍数按万分之一传 */
export const LIVE_MAX_BP = 30_000;

/**
 * 守夜的结回倍数（4.2）：中途倒下按撑到的秒数逐拍插值，点是 [秒, 占天亮倍数的万分比]；3:00 以前为 0。
 * 曲线从 3:00 起平滑上升，没有"4 分 01 秒才有钱"的断崖。四档形状相同，只按 dawnBp 缩放：配平时每档只调一个数。
 * 第 12 轮全量（每格 2,000 局）拟合：中途回得少、天亮给得多，小白（早死）和普通（多半撑到天亮）才拉得开，
 * 原来的形状（10 分钟回 55%）下四档小白都压不进 balance.md 的区间。
 */
export const VIGIL_SHAPE: readonly (readonly [number, number])[] = [
  [180, 0],
  [300, 560],
  [600, 2_200],
  [840, 2_880],
  [900, 10_000],
];
/** 打倒尸王比撑到天亮多结回多少（万分比），总数不超过 LIVE_MAX_BP */
export const VIGIL_BOSS_ADD_BP = 2_000;

/** 实盘档 tier 的守夜撑了 ticks 拍（每秒 30 拍）、赢没赢、打没打倒尸王 → 结回倍数（万分比，整数） */
export function vigilBp(tier: LiveTier, ticks: number, won: boolean, bossKilled: boolean): number {
  const dawn = LIVE_TIERS[tier].dawnBp;
  if (bossKilled) return Math.min(LIVE_MAX_BP, dawn + VIGIL_BOSS_ADD_BP);
  if (won) return dawn;
  // 按拍插值：整数运算，浏览器和 Worker、各平台算出来一样
  const t = Math.max(0, Math.floor(ticks));
  let share = VIGIL_SHAPE[VIGIL_SHAPE.length - 1]![1];
  for (let i = 1; i < VIGIL_SHAPE.length; i++) {
    const [s1, b1] = VIGIL_SHAPE[i]!;
    if (t >= s1 * 30) continue;
    const [s0, b0] = VIGIL_SHAPE[i - 1]!;
    share = t <= s0 * 30 ? b0 : b0 + Math.floor(((b1 - b0) * (t - s0 * 30)) / ((s1 - s0) * 30));
    break;
  }
  return Math.floor((share * dawn) / 10_000);
}

/** 危险档对应的实盘档（模拟器按它算期望；危险 1、5 没有实盘，返回 undefined） */
export function tierOfDanger(d: number): LiveTier | undefined {
  return LIVE_TIER_IDS.find((t) => LIVE_TIERS[t].danger === d);
}

/** 结回多少筹码：桌上那一份 × 倍数，向下取整（和开盘一样） */
export function liveReturn(stake: number, bp: number): number {
  return Math.floor((stake * Math.max(0, Math.min(LIVE_MAX_BP, Math.floor(bp)))) / 10_000);
}
