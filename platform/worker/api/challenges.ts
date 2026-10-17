/**
 * 异步挑战（0.18.0，docs/social.md 第 2 节；接口见 docs/platform-backend.md 15.18，主线过目定的数）。写入记在"排行榜"类。
 *
 * - 把一局的开局（payload，游戏自己的 JSON）存起来做成链接，打开的人就是同一个开局；成绩挂在同一个挑战下。平台不重算、不解析，只存、只排序。
 * - 只给登录的人；发给谁不限（链接能转）。只给公开资料：昵称和 userId，不给用户名。
 * - 每人每挑战只记第一次（主键 (challenge_id, user_id)）；发起人发起时就交了第一条。分数高的在前，同分先交的在前。
 * - 过期（challengeTtlMs）、不存在、id 格式不对一律 404，游戏说同一句"这个挑战打不开了"。
 */
import { GAME_IDS } from '../../src/games';
import type { Ctx } from './context';
import { DAY } from './context';
import { newTimeId } from './crypto';
import { ApiError, json } from './http';
import { hit } from './ratelimit';

const ID_RE = /^[0-9a-z]{9}[A-Za-z0-9_-]{11}$/;
/** payload、stats 的 JSON 各最多这么多字节（UTF-8） */
const JSON_MAX = 1024;
const TOP = 50;

/** 路径里的挑战 id：格式不对 404，不碰库 */
export function challengeParams(segments: string[]): Record<string, string> {
  const id = segments[0]!;
  if (!ID_RE.test(id)) throw new ApiError(404, 'not_found');
  return { id };
}

/** 游戏给的 JSON 原样存：转成字符串后不超过 1 KB；没给（undefined）是 null */
function packJson(x: unknown, required: boolean): string | null {
  if (x === undefined) {
    if (required) throw new ApiError(400, 'bad_request');
    return null;
  }
  const text = JSON.stringify(x);
  if (new TextEncoder().encode(text).length > JSON_MAX) throw new ApiError(413, 'too_big');
  return text;
}

function scoreOf(x: unknown): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) throw new ApiError(400, 'bad_request');
  return x;
}

/** POST /api/challenges {game, payload, score, stats?} → {id, until}。计数 1 + 挑战 2（表 + 索引）+ 发起人的结果 1 = 4 行。 */
export async function createChallenge(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const me = c.session!.user.id;
  const { game } = c.body;
  if (typeof game !== 'string' || !GAME_IDS.has(game)) throw new ApiError(400, 'bad_request');
  const payload = packJson(c.body.payload, true)!;
  const score = scoreOf(c.body.score);
  const stats = packJson(c.body.stats, false);
  await hit(db, `chal:${me}`, limits.challengesPerDay, DAY, now);
  const id = newTimeId(now);
  const until = now + limits.challengeTtlMs;
  await db.batch([
    db.stmt('INSERT INTO challenges (id, game, owner_id, payload, created_at, until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', id, game, me, payload, now, until),
    db.stmt('INSERT INTO challenge_results (challenge_id, user_id, score, stats, created_at) VALUES (?1, ?2, ?3, ?4, ?5)', id, me, score, stats, now),
  ]);
  return json(200, { id, until });
}

interface ChallengeRow {
  game: string;
  owner_id: string;
  owner_name: string;
  payload: string;
  until: number;
}

/** 没过期的挑战；没有就 404 */
async function load(c: Ctx): Promise<ChallengeRow> {
  const row = await c.db.first<ChallengeRow>(
    c.db.stmt(
      `SELECT ch.game, ch.owner_id, u.display_name AS owner_name, ch.payload, ch.until
       FROM challenges ch JOIN users u ON u.id = ch.owner_id
       WHERE ch.id = ?1 AND ch.until > ?2`,
      c.params.id!, c.now,
    ),
  );
  if (!row) throw new ApiError(404, 'not_found');
  return row;
}

interface ResultRow {
  user_id: string;
  display_name: string;
  score: number;
  stats: string | null;
}

/** GET /api/challenges/<id>：开局、发起人、前 50 名、一共几个人、我的名次。只读。 */
export async function getChallenge(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const ch = await load(c);
  // 最多 challengeMaxResults 行，全读出来在这里排名次
  const rows = await c.db.all<ResultRow>(
    c.db.stmt(
      `SELECT r.user_id, u.display_name, r.score, r.stats FROM challenge_results r JOIN users u ON u.id = r.user_id
       WHERE r.challenge_id = ?1 ORDER BY r.score DESC, r.created_at ASC`,
      c.params.id!,
    ),
  );
  let rank = 0;
  const all = rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1]!.score) rank = i + 1;
    return { rank, userId: r.user_id, displayName: r.display_name, score: r.score, stats: r.stats === null ? null : (JSON.parse(r.stats) as unknown), isMe: r.user_id === me };
  });
  const mine = all.find((r) => r.isMe);
  return json(200, {
    game: ch.game,
    payload: JSON.parse(ch.payload) as unknown,
    owner: { userId: ch.owner_id, displayName: ch.owner_name },
    until: ch.until,
    results: all.slice(0, TOP),
    count: all.length,
    me: mine ? { rank: mine.rank, score: mine.score, stats: mine.stats } : null,
  });
}

/**
 * POST /api/challenges/<id>/results {score, stats?}：只记第一次。
 * 交上了 {result: 'ok'}（1 行）；交过了 {result: 'already', mine}（0 行，不改）；满了 409 full（0 行）。
 * 满没满和插入在同一条语句里，并发的也冲不破上限。
 */
export async function submitChallenge(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const me = c.session!.user.id;
  const score = scoreOf(c.body.score);
  const stats = packJson(c.body.stats, false);
  await load(c);
  const id = c.params.id!;
  const meta = await db.run(
    db.stmt(
      `INSERT INTO challenge_results (challenge_id, user_id, score, stats, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT COUNT(*) FROM challenge_results WHERE challenge_id = ?1) < ?6
       ON CONFLICT DO NOTHING`,
      id, me, score, stats, now, limits.challengeMaxResults,
    ),
  );
  if ((meta.changes ?? 0) > 0) return json(200, { result: 'ok' });
  const mine = await db.first<{ score: number; stats: string | null }>(
    db.stmt('SELECT score, stats FROM challenge_results WHERE challenge_id = ?1 AND user_id = ?2', id, me),
  );
  if (!mine) throw new ApiError(409, 'full');
  return json(200, { result: 'already', mine: { score: mine.score, stats: mine.stats === null ? null : (JSON.parse(mine.stats) as unknown) } });
}
