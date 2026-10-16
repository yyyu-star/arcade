/**
 * 实盘的档位表和结回算法：画面和 Worker 都用（docs/design-live.md 第 1、6 节）。
 * 单独一个文件、运行时只依赖 balance.ts 的数，Worker 打包时不会把规则引擎带进去。
 */
import { BALANCE } from './balance.ts';

export type LiveTier = 'small' | 'mid' | 'big' | 'lux';

export interface LiveTierDef {
  id: LiveTier;
  name: string;
  /** 一份（筹码），和 economy.md 第 2 节的档位表一致 */
  stake: number;
  /** 这一档用的难度 */
  difficulty: number;
}

/** 四档：越往上行情越难、群里的消息越真假难辨（实测见设计稿第 3.3 节） */
export const LIVE_TIERS: readonly LiveTierDef[] = [
  { id: 'small', name: '小档', stake: 2_000, difficulty: 1 },
  { id: 'mid', name: '中档', stake: 10_000, difficulty: 2 },
  { id: 'big', name: '大档', stake: 50_000, difficulty: 3 },
  { id: 'lux', name: '豪华档', stake: 200_000, difficulty: 3 },
];

/** 结回倍数的上限（万分之几）：最多拿回 cap 份 */
export const LIVE_MAX_BP = BALANCE.live.cap * 10_000;

export function isLiveTier(x: unknown): x is LiveTier {
  return LIVE_TIERS.some((t) => t.id === x);
}

export function liveTierById(id: LiveTier): LiveTierDef {
  return LIVE_TIERS.find((t) => t.id === id) as LiveTierDef;
}

/** 按倍数（万分之几）算结回多少筹码 */
export function liveReturn(stake: number, bp: number): number {
  return Math.floor((stake * bp) / 10_000);
}
