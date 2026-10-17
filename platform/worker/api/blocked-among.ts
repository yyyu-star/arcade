/**
 * 同桌几个人之间的屏蔽关系（0.25.0，packages/arcade-kit/docs/chat.md 第 6 节）：好友房聊天转发时，跳过屏蔽了发话人的那几个连接。
 * 只经服务绑定 `ARCADE.blockedAmong` 调（worker/index.ts），`/api` 里没有这条路：浏览器拿到了就能试出谁屏蔽了自己。
 * 只读，一次一条查询；人数超过一桌的上限（9）当成调用方写错了，不查、回空，房间退回只用本地屏蔽。
 */
import { isUserIdShape } from './context';
import { type Db, newStats } from './db';

/** 一桌最多几个人（德州 9 人桌） */
export const BLOCKED_AMONG_MAX = 9;

/** 最近一次调用的读写统计，只给测试断言"只读、一条查询"用（主模块不放具名导出，见 worker/index.ts） */
export const blockedAmongStats = { last: newStats() };

export type BlockPair = [blocker: string, blocked: string];

/** 去重、去掉不像用户编号的；超过上限回 null */
export function parseBlockedAmong(userIds: unknown): string[] | null {
  if (!Array.isArray(userIds)) return [];
  const ids = [...new Set(userIds.filter((x): x is string => isUserIdShape(x)))];
  return ids.length > BLOCKED_AMONG_MAX ? null : ids;
}

export async function blockedAmong(db: Db, ids: string[]): Promise<BlockPair[]> {
  if (ids.length < 2) return [];
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const rows = await db.all<{ blocker: string; blocked: string }>(
    db.stmt(`SELECT blocker, blocked FROM blocks WHERE blocker IN (${marks}) AND blocked IN (${marks})`, ...ids),
  );
  return rows.map((r) => [r.blocker, r.blocked]);
}
