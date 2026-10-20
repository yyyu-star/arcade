/**
 * 快速匹配的档位（0.21.0，kit 0.20.0 的 MatchQueue，设计在 kit 的 docs/match.md）：Worker 的排队类和页面共用，纯函数。
 * 川麻：娱乐一个档位 fun，实盘每档一个 real-<档位>；立直只有娱乐一档 rc-fun（0.25.4）。
 * 开桌的选项和好友房开房一样（这个玩法的默认规则：川麻 4 局、立直半庄），房间的 options 照常校验。
 * 一桌最多 4 个真人，空位电脑补；座位由房间随机排（kit 默认）。
 */
import { DEFAULT_VARIANT, VARIANTS } from '../core/variants/index.ts';
import { STAKES, type StakesId, type TierId } from './stakes.ts';

export type MatchTier = 'fun' | 'rc-fun' | `real-${TierId}`;

export const MATCH_FUN: MatchTier = 'fun';
/** 立直的娱乐档 */
export const MATCH_RC_FUN: MatchTier = 'rc-fun';
const RIICHI = 'riichi';

const TIER_IDS = STAKES.filter((s) => s.wallet).map((s) => s.id as TierId);

/** 全部档位；单独部署（没有钱包）只开两个娱乐档（MATCH_FUN_TIERS） */
export const MATCH_TIERS: readonly MatchTier[] = [MATCH_FUN, MATCH_RC_FUN, ...TIER_IDS.map((t): MatchTier => `real-${t}`)];
export const MATCH_FUN_TIERS: readonly MatchTier[] = [MATCH_FUN, MATCH_RC_FUN];

/** 一桌最多几个真人 */
export const MATCH_TABLE = 4;

/** 选档页的档位和玩法 → 排队的档位（立直只排娱乐，页面上只在娱乐给按钮） */
export function matchTierOf(stakes: StakesId, variant: string = DEFAULT_VARIANT): MatchTier {
  if (variant === RIICHI) return MATCH_RC_FUN;
  return stakes === 'fun' ? MATCH_FUN : `real-${stakes}`;
}

/** 排队的档位 → 选档页的档位；认不得的是 null */
export function stakesOfTier(tier: string): StakesId | null {
  if (tier === MATCH_FUN || tier === MATCH_RC_FUN) return 'fun';
  const t = /^real-(.+)$/.exec(tier)?.[1];
  return t && (TIER_IDS as readonly string[]).includes(t) ? (t as TierId) : null;
}

/** 开桌带的开局选项：和好友房开房的 opts 一样（默认玩法、默认规则），房间的 options 校验；认不得的档位 undefined */
export function matchRoomOptions(tier: string): { variant: string; stakes: StakesId; rules: unknown } | undefined {
  const stakes = stakesOfTier(tier);
  const variant = tier === MATCH_RC_FUN ? RIICHI : DEFAULT_VARIANT;
  return stakes ? { variant, stakes, rules: VARIANTS[variant]!.defaults } : undefined;
}

/** 排队的路径（相对页面；在开房、进房的 rooms/ 下面，wrangler.jsonc 的 run_worker_first 已经放行） */
export const MATCH_PATH = 'rooms/match';
