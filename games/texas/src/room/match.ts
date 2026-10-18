/**
 * 快速匹配的档位（kit 0.20.0 的 match，DESIGN.md 6.11）：Worker 的排队和页面共用，纯函数。
 * 德州的好友房都是实盘（没有娱乐房间），所以只开四个实盘档 real-<档位>；娱乐档要先给房间加不记筹码的娱乐模式，另做（主线 2026-10-18）。
 * 一桌 6 人（大厅第一次来的默认人数），最多 6 个真人，空位电脑补；开局选项和好友房一样是 { stakes, size }，房间照常用 options 校验。
 */
import { STAKES, type StakesId } from '../core/stakes.ts';
import type { RoomOpts } from './rules.ts';

export type MatchTier = `real-${StakesId}`;

/** 匹配桌几个座位（也是一桌最多几个真人） */
export const MATCH_TABLE = 6;

export const MATCH_TIERS: readonly MatchTier[] = STAKES.map((s) => `real-${s.id}` as const);

export const matchTierOf = (stakes: StakesId): MatchTier => `real-${stakes}`;

/** 档位 key → 盲注档；不认得的是 undefined */
export function stakeOfTier(tier: string): StakesId | undefined {
  const m = /^real-(.+)$/.exec(tier);
  return STAKES.find((s) => s.id === m?.[1])?.id;
}

/** 排队开桌时带的开局选项；不认得的档位没有 */
export function matchRoomOptions(tier: string): RoomOpts | undefined {
  const stakes = stakeOfTier(tier);
  return stakes ? { stakes, size: MATCH_TABLE } : undefined;
}

/** 排队的路径：/games/texas/rooms/match/<档位>（和进房的 /rooms/<码>/ws 分得开）；页面用相对路径 rooms/match/<档位> */
export const MATCH_PATH = '/games/texas/rooms/match';
