/**
 * 好友在线（平台 0.13.0，docs/social.md 1.2，docs/platform-backend.md 15.13）：浏览器在前台时每 2 分钟报一次"我在哪"，
 * 平台记在用户行上（presence_json、presence_at，跟 last_seen_at 一起写，不另开表）；好友列表据此显示在线、在哪。
 * 只给好友看；本人关了 show_where，好友那边既看不到在线也看不到在哪，只剩"几天前来过"。
 */
import { GAME_IDS } from '../../src/games';
import type { Limits } from './config';
import type { Ctx } from './context';
import { ApiError, noContent } from './http';

export type Place = 'lobby' | 'game' | 'room';

export interface Where {
  place: Place;
  game?: string;
  room?: string;
  seats?: string;
}

const PLACES = new Set<Place>(['lobby', 'game', 'room']);
/** 房间码：kit 的码是 6 位数字。卡死这个格式：好友页、kit 直接拿它拼 /games/<game>/?room=<room>，不能放进别的字符 */
export const ROOM_RE = /^\d{6}$/;
/** 几个人 / 几个座位，如 "3/4" */
const SEATS_RE = /^\d{1,2}\/\d{1,2}$/;

/** 请求体 → 位置；不合格 400。lobby 不带 game；game、room 要带认识的游戏；room 还要带房间码 */
export function parseWhere(body: Record<string, unknown>): Where {
  const { place, game, room, seats } = body;
  if (typeof place !== 'string' || !PLACES.has(place as Place)) throw new ApiError(400, 'bad_request');
  const p = place as Place;
  if (p === 'lobby') return { place: p };
  if (typeof game !== 'string' || !GAME_IDS.has(game)) throw new ApiError(400, 'bad_request');
  if (p === 'game') return { place: p, game };
  if (typeof room !== 'string' || !ROOM_RE.test(room)) throw new ApiError(400, 'bad_request');
  if (seats !== undefined && (typeof seats !== 'string' || !SEATS_RE.test(seats))) throw new ApiError(400, 'bad_request');
  return seats === undefined ? { place: p, game, room } : { place: p, game, room, seats };
}

/**
 * POST /api/presence：204。离上次写不到 presenceEveryMs 就不写（0 行），否则 1 行（位置、时间、last_seen_at 一起）。
 * 只读档、live 类预算用完时路由直接回 204 不写（可丢的写，router.ts 的 quiet）：报位置失败不该打扰玩家。
 */
export async function postPresence(c: Ctx): Promise<Response> {
  const where = parseWhere(c.body);
  const user = c.session!.user;
  if (c.now - user.presence_at < c.limits.presenceEveryMs) return noContent();
  await c.db.run(
    c.db.stmt('UPDATE users SET presence_json = ?1, presence_at = ?2, last_seen_at = ?2 WHERE id = ?3', JSON.stringify(where), c.now, user.id),
  );
  user.presence_at = c.now;
  user.last_seen_at = c.now;
  return noContent();
}

/** 好友列表里这个人的在线、在哪：关了开关的一律 online: false、没有 where（和离线看起来一样） */
export function presenceOf(row: { presence_json: string | null; presence_at: number; show_where: number }, now: number, limits: Limits): { online: boolean; where?: Where } {
  if (!row.show_where || now - row.presence_at >= limits.presenceOnlineMs) return { online: false };
  const where = row.presence_json ? (JSON.parse(row.presence_json) as Where) : undefined;
  return where ? { online: true, where } : { online: true };
}
