/**
 * 一键叫人（0.14.0，docs/social.md 1.3；接口见 docs/platform-backend.md 15.15）。写入记在"在线"类。
 *
 * - 只能叫好友；屏蔽会删掉好友关系，所以被屏蔽的人发不出。不是好友、对方不存在、叫自己一律 403 `not_friend`，看不出是哪种。
 * - 每人 24 小时 invitesPerDay 条、同一个好友 inviteGapMs 一条：直接数 invites 表，和插入写在同一条语句里，
 *   并发的两条也冲不破上限；超了 429、写 0 行。
 * - 收邀请只读；"不了"只改自己收到的那条。删了好友、屏蔽之后，没过期的邀请也不再给对方看。
 */
import { GAME_IDS } from '../../src/games';
import { newInviteId } from './crypto';
import type { Ctx } from './context';
import { ApiError, json, noContent, rateLimited } from './http';
import { ROOM_RE } from './presence';

const ID_RE = /^[A-Za-z0-9_-]{16}$/;

/** 路径里的邀请 id：格式不对 404，不碰库 */
export function inviteParams(segments: string[]): Record<string, string> {
  const id = segments[0]!;
  if (!ID_RE.test(id)) throw new ApiError(404, 'not_found');
  return { id };
}

/** POST /api/invites {to, game, room} → {id}。成功 3 行，其余 0 行。 */
export async function sendInvite(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const me = c.session!.user.id;
  const { to, game, room } = c.body;
  // game、room 会被拼进跳转地址（/games/<game>/?room=<room>），只收登记过的游戏和 6 位数字的房间码
  if (typeof to !== 'string' || typeof game !== 'string' || !GAME_IDS.has(game) || typeof room !== 'string' || !ROOM_RE.test(room)) {
    throw new ApiError(400, 'bad_request');
  }
  if (to === me) throw new ApiError(403, 'not_friend');
  const id = newInviteId();
  const dayAgo = now - 86_400_000;
  const gapAgo = now - limits.inviteGapMs;
  const [a, b] = me < to ? [me, to] : [to, me];
  const meta = await db.run(
    db.stmt(
      `INSERT INTO invites (id, from_id, to_id, game, room, created_at, until)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM friendships WHERE user_a = ?8 AND user_b = ?9 AND status = 'accepted')
         AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker = ?2 AND blocked = ?3) OR (blocker = ?3 AND blocked = ?2))
         AND (SELECT COUNT(*) FROM invites WHERE from_id = ?2 AND created_at > ?10) < ?11
         AND NOT EXISTS (SELECT 1 FROM invites WHERE from_id = ?2 AND created_at > ?12 AND to_id = ?3)`,
      id, me, to, game, room, now, now + limits.inviteTtlMs, a, b, dayAgo, limits.invitesPerDay, gapAgo,
    ),
  );
  if ((meta.changes ?? 0) > 0) return json(200, { id });
  // 没插进去：再读一次是哪条不满足（只读）。不是好友排在前面：对不是好友的人不透露次数
  const friend = await db.first(
    db.stmt(
      `SELECT 1 FROM friendships WHERE user_a = ?1 AND user_b = ?2 AND status = 'accepted'
         AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker = ?3 AND blocked = ?4) OR (blocker = ?4 AND blocked = ?3))`,
      a, b, me, to,
    ),
  );
  if (!friend) throw new ApiError(403, 'not_friend');
  const last = await db.first<{ at: number }>(
    db.stmt('SELECT MAX(created_at) AS at FROM invites WHERE from_id = ?1 AND to_id = ?2 AND created_at > ?3', me, to, gapAgo),
  );
  if (last?.at) throw rateLimited(last.at + limits.inviteGapMs - now);
  const first = await db.first<{ at: number }>(
    db.stmt('SELECT MIN(created_at) AS at FROM invites WHERE from_id = ?1 AND created_at > ?2', me, dayAgo),
  );
  throw rateLimited((first?.at ?? now) + 86_400_000 - now);
}

interface InviteRow {
  id: string;
  from_id: string;
  display_name: string;
  game: string;
  room: string;
  until: number;
}

/** GET /api/invites：给我的、没过期、没点"不了"、对方还是好友的，先到期的在前。只读。 */
export async function listInvites(c: Ctx): Promise<Response> {
  const { db, now } = c;
  const me = c.session!.user.id;
  const rows = await db.all<InviteRow>(
    db.stmt(
      `SELECT i.id, i.from_id, u.display_name, i.game, i.room, i.until
         FROM invites i
         JOIN users u ON u.id = i.from_id
         JOIN friendships f ON f.user_a = MIN(i.from_id, i.to_id) AND f.user_b = MAX(i.from_id, i.to_id) AND f.status = 'accepted'
        WHERE i.to_id = ?1 AND i.until > ?2 AND i.dismissed = 0
        ORDER BY i.until LIMIT 20`,
      me, now,
    ),
  );
  return json(200, {
    invites: rows
      .filter((r) => GAME_IDS.has(r.game))
      .map((r) => ({ id: r.id, from: { id: r.from_id, name: r.display_name }, game: r.game, room: r.room, until: r.until })),
  });
}

/** POST /api/invites/<id>/dismiss：以后不再弹。1 行；不是给我的、已经点过、不存在都是 0 行，一样回 204。 */
export async function dismissInvite(c: Ctx): Promise<Response> {
  const { db } = c;
  await db.run(db.stmt('UPDATE invites SET dismissed = 1 WHERE id = ?1 AND to_id = ?2 AND dismissed = 0', c.params.id!, c.session!.user.id));
  return noContent();
}
