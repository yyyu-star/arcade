/**
 * 好友动态（0.17.0，docs/social.md 第 2 节；接口见 docs/platform-backend.md 15.17）。写入记在"在线"类。
 *
 * - 两个来源：实盘结回时平台自己生成（feedFromSettle，钱包 RPC 结回成功后调），游戏页报的娱乐名场面（POST /api/feed）。
 *   每人每天（北京时间）合计 feedPerDay 条，超了静默不写；本人关了 show_feed 也不写。数和插入在同一条语句里。
 * - 只存编号和数字，文字在浏览器里拼：结回的按平台的模板，名场面按游戏的 /games/<id>/moments.json。
 * - 只给好友看（和本人），保留 feedKeepMs；关了开关的人，已经生成的好友也看不到。
 * - 赞和扔道具：每条每人一次；不是好友的、自己的、过期的、不存在的一律 404，看不出是哪种。
 */
import { GAME_IDS } from '../../src/games';
import type { Ctx } from './context';
import { feedIdPrefix, newFeedId } from './crypto';
import type { Db } from './db';
import { ApiError, json, noContent } from './http';
import type { Limits } from './config';
import { hit } from './ratelimit';
import { avatarOf } from './session';
import type { SettleFeed } from './wallet';
import { beijingDate, beijingDayStart } from './time';

const MOMENT_RE = /^[a-z][a-z0-9_]{0,23}$/;
/** 能扔的：赞和 table-fun 的道具（kit 的 PROPS，不含 like 以外的重名） */
export const REACTIONS = new Set(['like', 'tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb', 'rose', 'cheers']);

/**
 * 插一条动态：本人开着开关、今天还没满 feedPerDay 条才写（2 行），否则 0 行。返回写没写。
 * "今天"按北京时间算，和每日榜一致。
 */
async function insert(db: Db, userId: string, game: string, kind: 'settle' | 'moment', data: unknown, now: number, limits: Limits): Promise<boolean> {
  const dayStart = beijingDayStart(beijingDate(now));
  const meta = await db.run(
    db.stmt(
      `INSERT INTO feed (id, user_id, game, kind, data, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2 AND show_feed = 1)
         AND (SELECT COUNT(*) FROM feed WHERE user_id = ?2 AND created_at >= ?7) < ?8`,
      newFeedId(now), userId, game, kind, JSON.stringify(data), now, dayStart, limits.feedPerDay,
    ),
  );
  return (meta.changes ?? 0) > 0;
}

/** 钱包结回成功后调（wallet-service）：db 要已经切到"在线"类。出错由调用方吞掉，结回不受影响 */
export function feedFromSettle(db: Db, userId: string, ev: SettleFeed, now: number, limits: Limits): Promise<boolean> {
  return insert(db, userId, ev.game, 'settle', { tier: ev.tier, units: ev.units, titles: ev.titles }, now, limits);
}

/** POST /api/feed {game, moment, n?}：204，写 2 行或 0 行（满了、关了都静默）。 */
export async function postMoment(c: Ctx): Promise<Response> {
  const { game, moment, n } = c.body;
  if (typeof game !== 'string' || !GAME_IDS.has(game) || typeof moment !== 'string' || !MOMENT_RE.test(moment)) throw new ApiError(400, 'bad_request');
  if (n !== undefined && !(Array.isArray(n) && n.length <= 3 && n.every((x) => Number.isSafeInteger(x)))) throw new ApiError(400, 'bad_request');
  await insert(c.db, c.session!.user.id, game, 'moment', n === undefined ? { m: moment } : { m: moment, n }, c.now, c.limits);
  return noContent();
}

interface ItemRow {
  id: string;
  user_id: string;
  display_name: string;
  avatar_json: string | null;
  game: string;
  kind: string;
  data: string;
  created_at: number;
}

/** GET /api/feed：我和好友最近 feedKeepMs 的，新的在前，最多 50 条；关了开关的人的不给。只读。 */
export async function listFeed(c: Ctx): Promise<Response> {
  const { db, now, limits } = c;
  const me = c.session!.user.id;
  // 从好友名单出发按 (user_id, created_at) 索引的范围查，和好友榜一样固定连接顺序
  const rows = await db.all<ItemRow>(
    db.stmt(
      `WITH f(id) AS (
         SELECT ?1
         UNION ALL
         SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END FROM friendships
         WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted')
       SELECT i.id, i.user_id, u.display_name, u.avatar_json, i.game, i.kind, i.data, i.created_at
       FROM f CROSS JOIN feed i ON i.user_id = f.id AND i.created_at > ?2
       JOIN users u ON u.id = i.user_id AND u.show_feed = 1
       ORDER BY i.created_at DESC LIMIT 50`,
      me, now - limits.feedKeepMs,
    ),
  );
  const reactions = rows.length
    ? await db.all<{ item_id: string; user_id: string; kind: string }>(
        db.stmt(
          `SELECT item_id, user_id, kind FROM feed_reactions WHERE item_id IN (SELECT value FROM json_each(?1))`,
          JSON.stringify(rows.map((r) => r.id)),
        ),
      )
    : [];
  return json(200, {
    items: rows.map((r) => {
      const mine = reactions.find((x) => x.item_id === r.id && x.user_id === me)?.kind;
      const counts: Record<string, number> = {};
      for (const x of reactions) if (x.item_id === r.id) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
      return {
        id: r.id,
        user: { userId: r.user_id, displayName: r.display_name, avatar: avatarOf(r.avatar_json) },
        game: r.game,
        kind: r.kind,
        at: r.created_at,
        data: JSON.parse(r.data) as unknown,
        reactions: counts,
        ...(mine ? { mine } : {}),
      };
    }),
  });
}

const ID_RE = /^[0-9a-z]{9}[A-Za-z0-9_-]{11}$/;

/** 路径里的动态 id：格式不对 404，不碰库 */
export function feedParams(segments: string[]): Record<string, string> {
  const id = segments[0]!;
  if (!ID_RE.test(id)) throw new ApiError(404, 'not_found');
  return { id };
}

/** POST /api/feed/<id>/react {kind}：204；每条每人一次，再点 0 行。计数 1 + 插入 1 = 2 行。 */
export async function react(c: Ctx): Promise<Response> {
  const { db, now, limits } = c;
  const me = c.session!.user.id;
  const kind = c.body.kind;
  if (typeof kind !== 'string' || !REACTIONS.has(kind)) throw new ApiError(400, 'bad_request');
  const id = c.params.id!;
  // 只能给好友的、没过期的、对方开着开关的；自己的不行
  const item = await db.first<{ user_id: string }>(
    db.stmt(
      `SELECT i.user_id FROM feed i JOIN users u ON u.id = i.user_id AND u.show_feed = 1
       JOIN friendships f ON f.user_a = MIN(i.user_id, ?2) AND f.user_b = MAX(i.user_id, ?2) AND f.status = 'accepted'
       WHERE i.id = ?1 AND i.created_at > ?3 AND i.user_id != ?2`,
      id, me, now - limits.feedKeepMs,
    ),
  );
  if (!item) throw new ApiError(404, 'not_found');
  if (await db.first(db.stmt('SELECT 1 FROM feed_reactions WHERE item_id = ?1 AND user_id = ?2', id, me))) return noContent();
  await hit(db, `react:${me}`, limits.feedReactPerDay, 86_400_000, now);
  await db.run(db.stmt('INSERT INTO feed_reactions (item_id, user_id, kind, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING', id, me, kind, now));
  return noContent();
}

/** Cron：删 keepMs 以前的动态和它们的赞，按 id 的时间前缀走主键范围 */
export function feedCleanupCutoff(now: number, limits: Limits): string {
  return feedIdPrefix(now - limits.feedKeepMs);
}
