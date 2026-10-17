/**
 * 好友与屏蔽（docs/platform-backend.md 5.6、15.4）。写入都记在"好友与资料"类。
 *
 * - 一对人在 friendships 里只有一行（user_a < user_b）：pending 时 requested_by 是发请求的一方，accepted 是好友。
 * - 对别人只给公开资料：userId、昵称、头像，不给用户名（用户名是登录凭据的一半）。
 * - 屏蔽：删掉双方之间的好友关系或请求；被屏蔽的人照常能发请求（返回 pending、写入请求行），
 *   只是屏蔽方的"收到的请求"里不显示，也接受不了，对方看不出自己被屏蔽。
 */
import { str } from './auth';
import { checkUserId, type Ctx, DAY, userParams } from './context';
import { newFriendCode, normalizeFriendCode } from './crypto';
import { ApiError, json, noContent } from './http';
import { meter } from './meter';
import { hit } from './ratelimit';
import { beijingDayNumber } from './time';
import { avatarOf } from './session';
import { presenceOf } from './presence';

interface ProfileRow {
  id: string;
  display_name: string;
  avatar_json: string | null;
}

/** 给别人看的公开资料（15.1）。 */
function publicProfile(u: ProfileRow) {
  return { userId: u.id, displayName: u.display_name, avatar: avatarOf(u.avatar_json) };
}

/** 一对人在表里的顺序。 */
function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** 几天前来过：按北京时间的日历天算，0 是今天（15.4）。不给精确时间。 */
export function daysAgo(lastSeen: number, now: number): number {
  return Math.max(0, beijingDayNumber(now) - beijingDayNumber(lastSeen));
}

/** 路径里的好友码：格式不对直接 404，不计数、不碰库。 */
export function codeParams(segments: string[]): Record<string, string> {
  let raw: string;
  try {
    raw = decodeURIComponent(segments[0]!);
  } catch {
    // 坏的百分号编码（如 /f/%E0）：当没找到，不是服务端出错
    throw new ApiError(404, 'not_found');
  }
  const code = normalizeFriendCode(raw);
  if (!code) throw new ApiError(404, 'not_found');
  return { code };
}

interface RelationRow {
  status: 'pending' | 'accepted';
  requested_by: string;
}

async function relationRow(c: Ctx, me: string, other: string): Promise<RelationRow | null> {
  const [a, b] = pair(me, other);
  return c.db.first<RelationRow>(c.db.stmt('SELECT status, requested_by FROM friendships WHERE user_a = ?1 AND user_b = ?2', a, b));
}

async function iBlocked(c: Ctx, me: string, other: string): Promise<boolean> {
  return !!(await c.db.first(c.db.stmt('SELECT 1 FROM blocks WHERE blocker = ?1 AND blocked = ?2', me, other)));
}

/** 我这边的计数：好友数、发出的待处理、收到的待处理。收到的不算我屏蔽了的人：那些请求看不见，不能让它们占满名额、挡住别人。 */
async function counts(c: Ctx, userId: string): Promise<{ friends: number; outgoing: number; incoming: number }> {
  const row = await c.db.first<{ friends: number; outgoing: number; incoming: number }>(
    c.db.stmt(
      `SELECT
         COALESCE(SUM(status = 'accepted'), 0) AS friends,
         COALESCE(SUM(status = 'pending' AND requested_by = ?1), 0) AS outgoing,
         COALESCE(SUM(status = 'pending' AND requested_by != ?1
           AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker = ?1 AND b.blocked = requested_by)), 0) AS incoming
       FROM friendships WHERE user_a = ?1 OR user_b = ?1`,
      userId,
    ),
  );
  return row ?? { friends: 0, outgoing: 0, incoming: 0 };
}

/** GET /api/friends：好友、收到的请求、发出的请求。只读，0 行。 */
export async function listFriends(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const rows = await c.db.all<ProfileRow & RelationRow & { last_seen_at: number; blocked: number; presence_json: string | null; presence_at: number; show_where: number }>(
    c.db.stmt(
      `SELECT u.id, u.display_name, u.avatar_json, u.last_seen_at, u.presence_json, u.presence_at, u.show_where, f.status, f.requested_by,
              EXISTS (SELECT 1 FROM blocks b WHERE b.blocker = ?1 AND b.blocked = u.id) AS blocked
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ?1 OR f.user_b = ?1
       ORDER BY f.created_at DESC`,
      me,
    ),
  );
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    // 在线、在哪（0.13.0）：只给好友；对方关了开关就和离线一样
    if (r.status === 'accepted') friends.push({ ...publicProfile(r), lastSeenDaysAgo: daysAgo(r.last_seen_at, c.now), ...presenceOf(r, c.now, c.limits) });
    // 请求不带时间：精确到毫秒的时间能看出对方几点在线，界面也用不上
    else if (r.requested_by === me) outgoing.push(publicProfile(r));
    else if (!r.blocked) incoming.push(publicProfile(r));
  }
  // 在线的排前面，其余按最近来过
  friends.sort((x, y) => Number(y.online) - Number(x.online) || x.lastSeenDaysAgo - y.lastSeenDaysAgo);
  return json(200, { friends, incoming, outgoing });
}

/**
 * GET /api/friends/code/<code>：打开 /f/<码> 时看看这是谁、和我什么关系。每次先计 fcode（1 行），没找到也算，免得拿来枚举。
 * GET 本来不拦写入：只读档、"好友与资料"类预算用完时计不了数，就不给查（503）。
 */
export async function lookupCode(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  if (c.tier === 'readonly' || meter.exhausted('social', c.limits, c.now)) throw new ApiError(503, 'busy');
  await hit(c.db, `fcode:${me}`, c.limits.friendCodeLookupsPerDay, DAY, c.now);
  const target = await c.db.first<ProfileRow>(
    c.db.stmt('SELECT id, display_name, avatar_json FROM users WHERE friend_code = ?1', c.params.code),
  );
  if (!target) throw new ApiError(404, 'not_found');
  if (target.id === me) return json(200, { user: publicProfile(target), relation: 'self' });
  const blocked = await iBlocked(c, me, target.id);
  const row = await relationRow(c, me, target.id);
  let relation = 'none';
  if (row?.status === 'accepted') relation = 'friends';
  else if (row && row.requested_by === me) relation = 'pending_out';
  // 我屏蔽了的人发来的请求不显示（同 listFriends）
  else if (row && !blocked) relation = 'pending_in';
  return json(200, { user: publicProfile(target), relation, ...(blocked ? { blocked: true } : {}) });
}

/**
 * 每天发请求的上限：真要写请求之前先计数（1 行，带条件的 UPSERT，满了 0 行、抛 429），重复发、已经是好友不计。
 * 先计数再写：并发打进来的请求在计数这一步排队，最多放过上限那么多个（审阅 2026-10-14：先查后写会被并发冲破）。
 */
async function takeRequest(c: Ctx, me: string): Promise<void> {
  await hit(c.db, `freq:${me}`, c.limits.friendRequestsPerDay, DAY, c.now);
}

/** 好友数没满的条件（放进 UPDATE 的 WHERE，并发时也不会冲破上限）。?1、?2 是两个人，?3 是上限。 */
const BOTH_UNDER_FRIENDS_MAX = `
  (SELECT COUNT(*) FROM friendships WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted') < ?3
  AND (SELECT COUNT(*) FROM friendships WHERE (user_a = ?2 OR user_b = ?2) AND status = 'accepted') < ?3`;

/** 把一条待处理的请求改成好友；好友数满了改不了，返回 false。1 行。 */
async function makeFriends(c: Ctx, x: string, y: string): Promise<boolean> {
  const [a, b] = pair(x, y);
  const meta = await c.db.run(
    c.db.stmt(
      `UPDATE friendships SET status = 'accepted' WHERE user_a = ?1 AND user_b = ?2 AND status = 'pending' AND ${BOTH_UNDER_FRIENDS_MAX}`,
      a, b, c.limits.friendsMax,
    ),
  );
  return meta.changes > 0;
}

async function targetById(c: Ctx, id: string): Promise<{ id: string }> {
  checkUserId(id);
  const target = await c.db.first<{ id: string }>(c.db.stmt('SELECT id FROM users WHERE id = ?1', id));
  if (!target) throw new ApiError(404, 'not_found');
  return target;
}

async function targetByCode(c: Ctx, me: string): Promise<{ id: string }> {
  const code = normalizeFriendCode(str(c.body.friendCode));
  if (!code) throw new ApiError(404, 'not_found');
  const target = await c.db.first<{ id: string }>(c.db.stmt('SELECT id FROM users WHERE friend_code = ?1', code));
  if (!target) {
    // 没找到也计一次查码（1 行），和 GET /api/friends/code 共用每天的上限：不然拿这个接口猜码就绕过了上限
    await hit(c.db, `fcode:${me}`, c.limits.friendCodeLookupsPerDay, DAY, c.now);
    throw new ApiError(404, 'not_found');
  }
  return target;
}

/**
 * POST /api/friends/requests {friendCode} 或 {userId}（0.10.5）：发请求。
 * - 已经是好友、已经发过：照原样回，0 行；
 * - 对方已经向我发过：直接成为好友，2 行（改状态 1 + freq 1）；
 * - 新请求：3 行（friendships 表 + user_b 索引 + freq 1）。对方屏蔽了我也照常写，对方看不到（5.6）。
 */
export async function sendRequest(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const me = c.session!.user.id;
  // 0.10.5：战绩页上的"加好友"按用户 id 发。id 是 22 位随机串，只在排行榜、好友列表里看得到，猜不出来，不计查码次数
  const target = c.body.userId !== undefined ? await targetById(c, str(c.body.userId)) : await targetByCode(c, me);
  if (target.id === me) throw new ApiError(422, 'invalid_target');
  if (await iBlocked(c, me, target.id)) throw new ApiError(422, 'unblock_first');

  const [a, b] = pair(me, target.id);
  const row = await relationRow(c, me, target.id);
  if (row?.status === 'accepted') return json(200, { status: 'friends' });
  if (row && row.requested_by === me) return json(200, { status: 'pending' });

  // 先只读查一遍上限（满了 0 行）；写的时候条件还在 SQL 里，并发冲不破
  const [mine, theirs] = [await counts(c, me), await counts(c, target.id)];
  if (row) {
    // 对方先发过：互相发了请求就自动成为好友
    if (mine.friends >= limits.friendsMax || theirs.friends >= limits.friendsMax) throw new ApiError(422, 'limit_reached');
    await takeRequest(c, me);
    if (!(await makeFriends(c, me, target.id))) {
      // 并发里别人先把好友数占满了，或者这条请求刚被撤回：再看一眼
      if (await relationRow(c, me, target.id)) throw new ApiError(422, 'limit_reached');
      throw new ApiError(404, 'not_found');
    }
    return json(200, { status: 'friends' });
  }
  if (mine.outgoing >= limits.friendPendingMax || theirs.incoming >= limits.friendPendingMax) throw new ApiError(422, 'limit_reached');
  await takeRequest(c, me);
  let meta: D1Meta;
  try {
    meta = await db.run(
      db.stmt(
        `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at)
         SELECT ?1, ?2, 'pending', ?3, ?4
         WHERE (SELECT COUNT(*) FROM friendships WHERE (user_a = ?3 OR user_b = ?3) AND status = 'pending' AND requested_by = ?3) < ?6
           AND (SELECT COUNT(*) FROM friendships f WHERE (f.user_a = ?5 OR f.user_b = ?5) AND f.status = 'pending' AND f.requested_by != ?5
                AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker = ?5 AND bl.blocked = f.requested_by)) < ?6`,
        a, b, me, now, target.id, limits.friendPendingMax,
      ),
    );
  } catch (e) {
    // 撞主键：查完关系到写入之间，这一对已经有了一行（freq 已经计过，不退也不再计）
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      const again = await relationRow(c, me, target.id);
      // 两人同时互发：对方那条先写进去了，和"对方先发过"一样直接成为好友（复审 2026-10-14：原来两边都停在"已发送"）
      if (again?.status === 'pending' && again.requested_by !== me) {
        if (await makeFriends(c, me, target.id)) return json(200, { status: 'friends' });
        const last = await relationRow(c, me, target.id);
        if (last?.status === 'accepted') return json(200, { status: 'friends' });
        if (last) throw new ApiError(422, 'limit_reached');
        throw new ApiError(404, 'not_found');
      }
      return json(200, { status: again?.status === 'accepted' ? 'friends' : 'pending' });
    }
    throw e;
  }
  // 并发里待处理的名额被别的请求先占满了（这次的计数不退，同"撤回不退还"）
  if (!meta.changes) throw new ApiError(422, 'limit_reached');
  return json(200, { status: 'pending' });
}

/** POST /api/friends/<userId>/accept：接受对方发来的请求（我屏蔽了的人发的，当没有）。1 行。 */
export async function acceptRequest(c: Ctx): Promise<Response> {
  const { limits } = c;
  const me = c.session!.user.id;
  const other = c.params.userId!;
  const row = await relationRow(c, me, other);
  if (!row || row.status !== 'pending' || row.requested_by !== other || (await iBlocked(c, me, other))) {
    throw new ApiError(404, 'not_found');
  }
  const [mine, theirs] = [await counts(c, me), await counts(c, other)];
  if (mine.friends >= limits.friendsMax || theirs.friends >= limits.friendsMax) throw new ApiError(422, 'limit_reached');
  if (!(await makeFriends(c, me, other))) {
    if (await relationRow(c, me, other)) throw new ApiError(422, 'limit_reached');
    throw new ApiError(404, 'not_found');
  }
  return json(200, { status: 'friends' });
}

/** POST /api/friends/<userId>/decline：拒绝对方发来的请求。1 行。 */
export async function declineRequest(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const [a, b] = pair(me, c.params.userId!);
  const meta = await c.db.run(
    c.db.stmt("DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2 AND status = 'pending' AND requested_by = ?3", a, b, c.params.userId!),
  );
  if (!meta.changes) throw new ApiError(404, 'not_found');
  return noContent();
}

/** DELETE /api/friends/<userId>：删好友，或撤回自己发出的请求。1 行。 */
export async function removeFriend(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const [a, b] = pair(me, c.params.userId!);
  const meta = await c.db.run(
    c.db.stmt(
      "DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2 AND (status = 'accepted' OR requested_by = ?3)",
      a, b, me,
    ),
  );
  if (!meta.changes) throw new ApiError(404, 'not_found');
  return noContent();
}

/** GET /api/blocks：我屏蔽的人。只读，0 行。 */
export async function listBlocks(c: Ctx): Promise<Response> {
  const rows = await c.db.all<ProfileRow>(
    c.db.stmt(
      `SELECT u.id, u.display_name, u.avatar_json FROM blocks b JOIN users u ON u.id = b.blocked
       WHERE b.blocker = ?1 ORDER BY b.created_at DESC`,
      c.session!.user.id,
    ),
  );
  return json(200, { blocks: rows.map(publicProfile) });
}

/**
 * 屏蔽、解除屏蔽每人每天合计 friendBlocksPerDay 次（block:<userId>，1 行），在写之前计。
 * 不然"屏蔽→解除"来回刷，每轮 2 行，二十来分钟就能把"好友与资料"一天的预算刷光（审阅 2026-10-14）。
 */
async function takeBlock(c: Ctx, me: string): Promise<void> {
  await hit(c.db, `block:${me}`, c.limits.friendBlocksPerDay, DAY, c.now);
}

/**
 * POST /api/blocks {userId}：屏蔽，同时删掉双方之间的好友关系或请求。
 * 写入：计数 1 + blocks 1（+1 有关系要删时）；已经屏蔽过只读查一下，0 行。
 */
export async function block(c: Ctx): Promise<Response> {
  const { db } = c;
  const me = c.session!.user.id;
  const other = userParams([str(c.body.userId)]).userId!;
  if (other === me) throw new ApiError(422, 'invalid_target');
  if (!(await db.first(db.stmt('SELECT 1 FROM users WHERE id = ?1', other)))) throw new ApiError(404, 'not_found');
  if (await iBlocked(c, me, other)) return noContent();
  await takeBlock(c, me);
  const [a, b] = pair(me, other);
  await db.batch([
    db.stmt('INSERT INTO blocks (blocker, blocked, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING', me, other, c.now),
    db.stmt('DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2', a, b),
  ]);
  return noContent();
}

/** DELETE /api/blocks/<userId>：解除屏蔽。计数 1 + 删 1 = 2 行；没屏蔽过 404、0 行。和屏蔽共用每天的次数。 */
export async function unblock(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const other = c.params.userId!;
  if (!(await iBlocked(c, me, other))) throw new ApiError(404, 'not_found');
  await takeBlock(c, me);
  await c.db.run(c.db.stmt('DELETE FROM blocks WHERE blocker = ?1 AND blocked = ?2', me, other));
  return noContent();
}

/** POST /api/me/friend-code：换一个好友码，旧码和旧链接立刻失效。3 行（fcnew 计数 1，users 表 + 唯一索引 2）。 */
export async function changeFriendCode(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const user = c.session!.user;
  // 先计数再改（并发冲不破每天 3 次）；撞码重试时不再计
  await hit(db, `fcnew:${user.id}`, limits.friendCodeChangesPerDay, DAY, now);
  for (let attempt = 0; ; attempt++) {
    const code = newFriendCode();
    try {
      await db.run(db.stmt('UPDATE users SET friend_code = ?1 WHERE id = ?2', code, user.id));
      user.friend_code = code;
      return json(200, { friendCode: code });
    } catch (e) {
      // 40 bit 撞上的概率极小；撞上就换一个再试（这条没写）
      if (!(e instanceof Error && e.message.includes('users.friend_code')) || attempt >= 2) throw e;
    }
  }
}
