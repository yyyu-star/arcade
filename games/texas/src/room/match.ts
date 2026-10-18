/**
 * 快速匹配的档位（kit 0.20.0 的 match，DESIGN.md 6.11）：Worker 的排队和页面共用，纯函数。
 * 实盘四档 real-<档位> 开的是实盘好友房；娱乐档 fun（0.21.0）开的是不记筹码的娱乐房间（RoomOpts.fun），单独部署（没钱包）也开。
 * 一桌 6 人（大厅第一次来的默认人数），最多 6 个真人，空位电脑补；开局选项和好友房一样，房间照常用 options 校验。
 */
import { FUN_STAKES, STAKES, type StakesId } from '../core/stakes.ts';
import type { RoomOpts } from './rules.ts';

export type MatchTier = 'fun' | `real-${StakesId}`;

/** 匹配桌几个座位（也是一桌最多几个真人） */
export const MATCH_TABLE = 6;

/** 实盘四档（要钱包） */
export const REAL_TIERS: readonly MatchTier[] = STAKES.map((s) => `real-${s.id}` as const);
/** 全部档位：娱乐在前 */
export const MATCH_TIERS: readonly MatchTier[] = ['fun', ...REAL_TIERS];

/** 大厅选的这一桌排哪一档：娱乐不分档位（娱乐都是 FUN_STAKES） */
export const matchTierOf = (stakes: StakesId, fun = false): MatchTier => (fun ? 'fun' : `real-${stakes}`);

/** 档位 key → 盲注档；不认得的是 undefined */
export function stakeOfTier(tier: string): StakesId | undefined {
  if (tier === 'fun') return FUN_STAKES;
  const m = /^real-(.+)$/.exec(tier);
  return STAKES.find((s) => s.id === m?.[1])?.id;
}

/** 排队开桌时带的开局选项；不认得的档位没有 */
export function matchRoomOptions(tier: string): RoomOpts | undefined {
  if (tier === 'fun') return { stakes: FUN_STAKES, size: MATCH_TABLE, fun: true };
  const stakes = stakeOfTier(tier);
  return stakes ? { stakes, size: MATCH_TABLE } : undefined;
}

/** 排队的路径：/games/texas/rooms/match/<档位>（和进房的 /rooms/<码>/ws 分得开）；页面用相对路径 rooms/match/<档位> */
export const MATCH_PATH = '/games/texas/rooms/match';
