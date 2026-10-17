/**
 * 排行榜（简单版）：维护者 2026-10-14 定"以后也不用防作弊，能作弊是他的本事"。
 * 所以没有成绩票、重放验分、操作记录、上限判断，也不限"每天只认首次"：游戏交什么分就记什么，只防刷额度、只查数据格式。
 *
 * - 每人每榜只留最好的一条，越高越好（越低越好的游戏交相反数）。
 * - 交分写入单独记在"排行榜"类（预算从存档里分出来）：刷榜只停排行榜，不连累云存档；每人每天 scorePerDay 次。
 * - 榜单 ID 只收两种形式，别的一律不收，免得随便开榜把库撑大：
 *   每日榜 daily-YYYY-MM-DD（规则大改时可带 -v<n>），交分时日期只能是北京时间的昨天、今天、明天（时区差和跨零点的一局）；
 *   一天几个每日榜的游戏（games.ts 的 daily 写了子榜，0.16.0）是 daily-YYYY-MM-DD-<子榜>[-v<n>]，子榜要登记过，不再收不带子榜的；
 *   固定榜（如 endless）要在 src/games.ts 的 boards 里登记。
 *   日期放在版本号前面：同一个游戏的所有每日榜按 board_id 排序时就按日期排，Cron 按范围删旧榜只读要删的行。
 * - 读榜只给公开资料（昵称、头像），不给用户名和 userId。
 */
import { checkBodyUser, type Ctx, DAY } from './context';
import { ApiError, json } from './http';
import { hit } from './ratelimit';
import { DAILY_SUB_RE, fixedBoards, GAME_IDS, GAMES } from '../../src/games';
import { daily } from './daily';
import { beijingDate } from './time';
import { avatarOf } from './session';

// 子榜不能像版本号（v2）：不然 daily-…-v2 会被认成子榜"v2"
const DAILY_RE = /^daily-(\d{4}-\d{2}-\d{2})(?:-((?!v\d)[a-z][a-z0-9]{0,15}))?(?:-v([1-9]\d?))?$/;
/** 固定榜的名字：小写字母、数字、短横线，不以 daily 开头（和每日榜分开，也不落进 Cron 删每日榜的范围）。 */
export const FIXED_BOARD_RE = /^(?!daily)[a-z0-9-]{1,40}$/;
const FIXED_BOARDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(GAMES.map((g) => [g.id, new Set(fixedBoards(g).map((b) => b.id))]));

/** 每日榜的日期、子榜、版本号（没有版本号是 0）；不是每日榜的形式时为 null。"v2" 这样的不当子榜（是版本号）。 */
export function parseDaily(boardId: string): { date: string; sub: string | null; v: number } | null {
  const m = DAILY_RE.exec(boardId);
  if (!m) return null;
  const sub = m[2] ?? null;
  if (sub !== null && !DAILY_SUB_RE.test(sub)) return null;
  return { date: m[1]!, sub, v: Number(m[3] ?? 0) };
}

/** 这个游戏收不收这种每日榜：写了子榜的只收登记过的子榜，没写的只收不带子榜的 */
function dailyFits(gameId: string, sub: string | null, subs: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const list = subs.get(gameId);
  return list ? sub !== null && list.has(sub) : sub === null;
}

/** 读榜时认的榜：每日榜（任何日期，过期的 Cron 会删）或登记过的固定榜。 */
export function isKnownBoard(gameId: string, boardId: string, fixed = FIXED_BOARDS, subs = daily().subs): boolean {
  const d = parseDaily(boardId);
  if (d) return dailyFits(gameId, d.sub, subs);
  return FIXED_BOARD_RE.test(boardId) && (fixed.get(gameId)?.has(boardId) ?? false);
}

/** 交分时收的榜：每日榜只收北京时间昨天、今天、明天的，固定榜要登记过。 */
export function acceptsScore(gameId: string, boardId: string, now: number, fixed = FIXED_BOARDS, subs = daily().subs): boolean {
  const d = parseDaily(boardId);
  if (!d) return isKnownBoard(gameId, boardId, fixed, subs);
  return dailyFits(gameId, d.sub, subs) && [now - DAY, now, now + DAY].some((t) => beijingDate(t) === d.date);
}
/** |score| 的上限：安全整数以内，留足余量。 */
const SCORE_MAX = 1e12;
/** 一次读榜给前几名。 */
export const TOP_N = 50;

/** 路径参数：游戏不在白名单 404 unknown_game；不认识的榜 404（读）。 */
export function boardParams(segments: string[]): Record<string, string> {
  const [gameId, boardId] = segments;
  if (!gameId || !GAME_IDS.has(gameId)) throw new ApiError(404, 'unknown_game');
  if (!boardId || !isKnownBoard(gameId, boardId)) throw new ApiError(404, 'not_found');
  return { gameId, boardId };
}

/**
 * POST /api/scores {gameId, boardId, score, userId?}：交一次分。userId 和 saves 一样，不一致 409 wrong_user、0 行。
 * 先计数（1 行，满了 0 行、429），再带条件的 UPSERT：比原来好才写。
 * 写入：第一次上榜 1 + 2（表 + 排名索引）= 3；刷新最好成绩也是 1 + 2 = 3（改分数动了索引，实测）；没更好 1。
 */
export async function submitScore(c: Ctx): Promise<Response> {
  const { db, limits, now } = c;
  const me = c.session!.user.id;
  checkBodyUser(c);
  const { gameId, boardId, score } = c.body;
  if (typeof gameId !== 'string' || typeof boardId !== 'string' || typeof score !== 'number') throw new ApiError(400, 'bad_request');
  if (!GAME_IDS.has(gameId)) throw new ApiError(404, 'unknown_game');
  if (!acceptsScore(gameId, boardId, now)) throw new ApiError(422, 'invalid_board');
  if (!Number.isSafeInteger(score) || Math.abs(score) > SCORE_MAX) throw new ApiError(422, 'invalid_score');

  await hit(db, `score:${me}`, limits.scorePerDay, DAY, now);
  const row = await db.first<{ score: number }>(
    db.stmt(
      `INSERT INTO boards (game_id, board_id, user_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, game_id, board_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
       WHERE excluded.score > boards.score
       RETURNING score`,
      gameId, boardId, me, score, now,
    ),
  );
  if (row) return json(200, { best: row.score, improved: true });
  const old = await db.first<{ score: number }>(
    db.stmt('SELECT score FROM boards WHERE game_id = ?1 AND board_id = ?2 AND user_id = ?3', gameId, boardId, me),
  );
  return json(200, { best: old?.score ?? score, improved: false });
}

interface EntryRow {
  user_id: string;
  score: number;
  display_name: string;
  avatar_json: string | null;
}

/** 已按分数从高到低排好：同分同名次（第 1、1、3 名），名次 = 比你高的人数 + 1。 */
function ranked(rows: EntryRow[], me: string) {
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1]!.score) rank = i + 1;
    return {
      rank,
      displayName: r.display_name,
      avatar: avatarOf(r.avatar_json),
      score: r.score,
      isMe: r.user_id === me,
    };
  });
}

/**
 * GET /api/boards/<gameId>/<boardId>?scope=all|friends：前 50 名，外加我的名次和分数（不在前 50 也给）。0 行写入。
 * 读的行数有上限：
 * - all：前 50 名走排名索引（含 updated_at，同分的先后也不用另排）读约 100 行（榜 + 昵称）；我的名次数"比我高的有几个"，最多数到 boardRankCountMax，再多就只说"多少名以后"（rank 为 null）；
 * - friends：我和我的好友（好友 ≤ 200），按主键逐个查，全部读出来在这里排。
 * 同分时先达到的排前面。
 */
export async function getBoard(c: Ctx): Promise<Response> {
  const { db, limits } = c;
  const me = c.session!.user.id;
  const { gameId, boardId } = c.params as { gameId: string; boardId: string };
  const scope = new URL(c.request.url).searchParams.get('scope') ?? 'all';
  if (scope !== 'all' && scope !== 'friends') throw new ApiError(400, 'bad_request');

  if (scope === 'friends') {
    // 从好友名单出发按主键逐个查（CROSS JOIN 固定连接顺序）；不然 SQLite 会为了省排序沿排名索引扫整个榜（实测）
    const rows = await db.all<EntryRow>(
      db.stmt(
        `WITH f(id) AS (
           SELECT ?3
           UNION ALL
           SELECT CASE WHEN user_a = ?3 THEN user_b ELSE user_a END FROM friendships
           WHERE (user_a = ?3 OR user_b = ?3) AND status = 'accepted')
         SELECT b.user_id, b.score, u.display_name, u.avatar_json
         FROM f CROSS JOIN boards b ON b.game_id = ?1 AND b.board_id = ?2 AND b.user_id = f.id
         JOIN users u ON u.id = b.user_id
         ORDER BY b.score DESC, b.updated_at ASC`,
        gameId, boardId, me,
      ),
    );
    const all = ranked(rows, me);
    const mine = all.find((e) => e.isMe);
    return json(200, { entries: all.slice(0, TOP_N), me: mine ? { rank: mine.rank, score: mine.score } : null });
  }

  const rows = await db.all<EntryRow>(
    db.stmt(
      `SELECT b.user_id, b.score, u.display_name, u.avatar_json
       FROM boards b JOIN users u ON u.id = b.user_id
       WHERE b.game_id = ?1 AND b.board_id = ?2
       ORDER BY b.score DESC, b.updated_at ASC LIMIT ?3`,
      gameId, boardId, TOP_N,
    ),
  );
  const entries = ranked(rows, me);
  const inTop = entries.find((e) => e.isMe);
  if (inTop) return json(200, { entries, me: { rank: inTop.rank, score: inTop.score } });
  const mine = await db.first<{ score: number }>(
    db.stmt('SELECT score FROM boards WHERE game_id = ?1 AND board_id = ?2 AND user_id = ?3', gameId, boardId, me),
  );
  if (!mine) return json(200, { entries, me: null });
  const better = await db.first<{ n: number }>(
    db.stmt(
      'SELECT COUNT(*) AS n FROM (SELECT 1 FROM boards WHERE game_id = ?1 AND board_id = ?2 AND score > ?3 LIMIT ?4)',
      gameId, boardId, mine.score, limits.boardRankCountMax,
    ),
  );
  const n = better?.n ?? 0;
  return json(200, { entries, me: { rank: n >= limits.boardRankCountMax ? null : n + 1, score: mine.score } });
}
