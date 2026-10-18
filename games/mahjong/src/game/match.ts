/**
 * 快速匹配的档位（0.21.0，kit 0.20.0 的 MatchQueue，设计在 kit 的 docs/match.md）：Worker 的排队类和页面共用，纯函数。
 * 娱乐一个档位 fun，实盘每档一个 real-<档位>；开桌的选项和好友房开房一样（默认玩法、默认规则），房间的 options 照常校验。
 * 一桌最多 4 个真人，空位电脑补；座位由房间随机排（kit 默认）。
 */
import { DEFAULT_VARIANT, VARIANTS } from '../core/variants/index.ts';
import { STAKES, type StakesId, type TierId } from './stakes.ts';

export type MatchTier = 'fun' | `real-${TierId}`;

export const MATCH_FUN: MatchTier = 'fun';

const TIER_IDS = STAKES.filter((s) => s.wallet).map((s) => s.id as TierId);

/** 全部档位；单独部署（没有钱包）只开 fun */
export const MATCH_TIERS: readonly MatchTier[] = [MATCH_FUN, ...TIER_IDS.map((t): MatchTier => `real-${t}`)];

/** 一桌最多几个真人 */
export const MATCH_TABLE = 4;

/** 选档页的档位 → 排队的档位 */
export function matchTierOf(stakes: StakesId): MatchTier {
  return stakes === 'fun' ? MATCH_FUN : `real-${stakes}`;
}

/** 排队的档位 → 选档页的档位；认不得的是 null */
export function stakesOfTier(tier: string): StakesId | null {
  if (tier === MATCH_FUN) return 'fun';
  const t = /^real-(.+)$/.exec(tier)?.[1];
  return t && (TIER_IDS as readonly string[]).includes(t) ? (t as TierId) : null;
}

/** 开桌带的开局选项：和好友房开房的 opts 一样（默认玩法、默认规则），房间的 options 校验；认不得的档位 undefined */
export function matchRoomOptions(tier: string): { variant: string; stakes: StakesId; rules: unknown } | undefined {
  const stakes = stakesOfTier(tier);
  return stakes ? { variant: DEFAULT_VARIANT, stakes, rules: VARIANTS[DEFAULT_VARIANT]!.defaults } : undefined;
}

/** 排队的路径（相对页面；在开房、进房的 rooms/ 下面，wrangler.jsonc 的 run_worker_first 已经放行） */
export const MATCH_PATH = 'rooms/match';
