/**
 * 快速匹配的档位（0.26.0，kit 0.20.0 的 MatchQueue，设计在 kit 的 docs/match.md）：Worker 的排队类和页面共用，纯函数。
 * 娱乐一个档位 fun（好友房的娱乐规则，打到过 A）；实盘每档一个 real-<档位>（好友房实盘的规则，5 副）。
 * 一桌最多 4 个真人，空位电脑补；座位由房间随机排（kit 默认）。
 */
import { TIER_IDS, type TierId } from '../stake/index.ts';
import { ROOM_PATH } from './version.ts';

export type MatchTier = 'fun' | `real-${TierId}`;

export const MATCH_FUN: MatchTier = 'fun';

/** 全部档位；单独部署（没有钱包）只开 fun */
export const MATCH_TIERS: readonly MatchTier[] = [MATCH_FUN, ...TIER_IDS.map((t): MatchTier => `real-${t}`)];

/** 一桌最多几个真人 */
export const MATCH_TABLE = 4;

/** 实盘档位 → 排队的档位；null 是娱乐 */
export function matchTierOf(stake: TierId | null): MatchTier {
  return stake === null ? MATCH_FUN : `real-${stake}`;
}

/** 排队的档位 → 实盘档位（娱乐是 null）；认不得的是 undefined */
export function stakeOfTier(tier: string): TierId | null | undefined {
  if (tier === MATCH_FUN) return null;
  const t = /^real-(.+)$/.exec(tier)?.[1];
  return t && (TIER_IDS as readonly string[]).includes(t) ? (t as TierId) : undefined;
}

/** 开桌带的开局选项：和好友房开房一样（娱乐不带，实盘 { stake }），房间的 parseRoomOpts 校验 */
export function matchRoomOptions(tier: string): { stake: TierId } | undefined {
  const s = stakeOfTier(tier);
  return s ? { stake: s } : undefined;
}

/** 排队的路径（游戏 Worker 里，在 ROOM_PATH 下面，run_worker_first 已经放行） */
export const MATCH_PATH = `${ROOM_PATH}/match`;
