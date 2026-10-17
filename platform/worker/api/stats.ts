/**
 * 战绩页的接口（0.10.3，docs/platform-backend.md 5.10、15.11）。战绩（钱包行里的 career）对登录的人公开，
 * 余额、桌上的筹码、操作记录不给。只读，不写。
 */
import { type Ctx, userParams } from './context';
import { ApiError, json } from './http';
import { beijingWeek } from './time';
import { type Career, type CareerView, careerView } from './wallet';
import { avatarOf } from './session';
import { togetherWith } from './mates';

/** 我和对方的关系：和查好友码（15.4）用同一套取值，战绩页上决定给不给"加好友" */
export type Relation = 'self' | 'friends' | 'pending_out' | 'pending_in' | 'none';

/** /api/stats/me 是自己，否则是 22 位用户 id */
export function statsParams(segments: string[]): Record<string, string> {
  return segments[0] === 'me' ? { userId: 'me' } : userParams(segments);
}

/**
 * GET /api/stats/<userId|me>：一个人的公开资料、各游戏战绩、和我的关系。一次查询读 users、wallets 各 1 行，好友、屏蔽各查 1 行；
 * 是好友时再查一次搭子战绩（这一对每个游戏 1 行）。写 0 行。
 * 对方屏蔽了我：当没有这个人（404），和好友链接一样看不出被屏蔽。
 */
export async function getStats(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const id = c.params.userId === 'me' ? me : c.params.userId!;
  const [a, b] = me < id ? [me, id] : [id, me];
  const row = await c.db.first<{
    id: string;
    display_name: string;
    avatar_json: string | null;
    career: string | null;
    status: string | null;
    requested_by: string | null;
    blocked_me: number;
    i_blocked: number;
    show_mates: number;
  }>(
    c.db.stmt(
      `SELECT u.id, u.display_name, u.avatar_json, u.show_mates,
         (SELECT json_extract(w.state, '$.career') FROM wallets w WHERE w.user_id = u.id) AS career,
         f.status, f.requested_by,
         EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker = u.id AND bl.blocked = ?2) AS blocked_me,
         EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker = ?2 AND bl.blocked = u.id) AS i_blocked
       FROM users u LEFT JOIN friendships f ON f.user_a = ?3 AND f.user_b = ?4
       WHERE u.id = ?1`,
      id,
      me,
      a,
      b,
    ),
  );
  if (!row || (id !== me && row.blocked_me)) throw new ApiError(404, 'not_found');
  // 我屏蔽了的人发来的请求当没有（0.10.17，和好友页的"收到的请求"一样：不显示、接受不了）
  const relation: Relation =
    id === me
      ? 'self'
      : row.status === 'accepted'
        ? 'friends'
        : row.status === 'pending' && row.requested_by === me
          ? 'pending_out'
          : row.status === 'pending' && !row.i_blocked
            ? 'pending_in'
            : 'none';
  const week = beijingWeek(c.now);
  const games: Record<string, CareerView> = {};
  for (const [game, career] of Object.entries((row.career ? JSON.parse(row.career) : {}) as Record<string, Career>)) {
    if (career.n > 0) games[game] = careerView(career, week);
  }
  // 搭子战绩（0.19.0）：只给好友，两边都开着才给；一起没打过就不带
  const together = relation === 'friends' && row.show_mates !== 0 && c.session!.user.show_mates !== 0 ? await togetherWith(c.db, me, id) : {};
  return json(200, {
    user: { userId: row.id, displayName: row.display_name, avatar: avatarOf(row.avatar_json) },
    relation,
    week,
    games,
    ...(Object.keys(together).length ? { together } : {}),
  });
}
