/**
 * 好友周榜和超越提示（0.15.0，docs/social.md 1.5；接口见 docs/platform-backend.md 15.16）。只读，不新增写入。
 *
 * - 只算有每日挑战榜的游戏（games.ts 的 daily）：这周（北京时间周一 0 点起）每天的 daily-<日期> 榜里，每人取最好的一次。
 *   同一周里规则改版（board_id 带 -v<n>）的两版分数不能比，只认这周最新的那一版。
 *   一天几个每日榜的游戏（子榜，0.16.0）每个子榜各算各的。
 * - 只看我和我的好友：从好友名单出发按主键范围查（每人每个游戏最多 7 天 × 几版），和 getBoard 的好友榜一样固定连接顺序。
 * - 超越提示：读的时候比，不另存——好友这周的最好成绩比我的高，就提一句；我这周还没成绩的不提（没有"纪录"可超）。
 */
import { GAME_IDS } from '../../src/games';
import { daily } from './daily';
import { parseDaily } from './boards';
import type { Ctx } from './context';
import { DAY } from './context';
import { ApiError, json } from './http';
import { avatarOf } from './session';
import { beijingDayStart, beijingWeek } from './time';


interface Row {
  user_id: string;
  game_id: string;
  board_id: string;
  score: number;
  updated_at: number;
  display_name: string;
  avatar_json: string | null;
}

/** 这周（周一）和下周一的榜名下界：daily-<日期> 按字典序就是按日期，带 -v 的也落在这个范围里 */
function weekRange(now: number): { week: string; from: string; to: string } {
  const week = beijingWeek(now);
  const next = new Date(beijingDayStart(week) + 7 * DAY + 8 * 3_600_000).toISOString().slice(0, 10);
  return { week, from: `daily-${week}`, to: `daily-${next}` };
}

/** 我和好友这周在这些游戏的每日榜上的所有成绩 */
async function weekRows(c: Ctx, games: readonly string[]): Promise<Row[]> {
  if (games.length === 0) return [];
  const { db, now } = c;
  const me = c.session!.user.id;
  const { from, to } = weekRange(now);
  const marks = games.map((_, i) => `?${i + 4}`).join(', ');
  return db.all<Row>(
    db.stmt(
      `WITH f(id) AS (
         SELECT ?1
         UNION ALL
         SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END FROM friendships
         WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted')
       SELECT b.user_id, b.game_id, b.board_id, b.score, b.updated_at, u.display_name, u.avatar_json
       FROM f CROSS JOIN boards b ON b.user_id = f.id AND b.game_id IN (${marks}) AND b.board_id >= ?2 AND b.board_id < ?3
       JOIN users u ON u.id = b.user_id`,
      me, from, to, ...games,
    ),
  );
}

interface Best {
  userId: string;
  displayName: string;
  avatar: unknown;
  score: number;
  at: number;
}

/** 一个每日榜（子榜）这周每人的最好成绩，只认最新那一版；从高到低，同分先达到的在前。rows 要先按游戏和子榜挑好 */
function bestOf(rows: Row[]): Best[] {
  const parsed = rows.flatMap((r) => {
    const d = parseDaily(r.board_id);
    return d ? [{ r, d }] : [];
  });
  if (parsed.length === 0) return [];
  // 最新那一版：日期最晚的那天里版本号最大的那个榜的版本
  const latest = parsed.reduce((a, x) => (x.d.date > a.d.date || (x.d.date === a.d.date && x.d.v > a.d.v) ? x : a));
  const by = new Map<string, Best>();
  for (const { r, d } of parsed) {
    if (d.v !== latest.d.v) continue;
    const old = by.get(r.user_id);
    if (!old || r.score > old.score || (r.score === old.score && r.updated_at < old.at)) {
      by.set(r.user_id, { userId: r.user_id, displayName: r.display_name, avatar: avatarOf(r.avatar_json), score: r.score, at: r.updated_at });
    }
  }
  return [...by.values()].sort((a, b) => b.score - a.score || a.at - b.at);
}

/** 这个游戏、这个子榜（没有子榜是 null）的行 */
const rowsOf = (rows: Row[], gameId: string, sub: string | null) =>
  rows.filter((r) => r.game_id === gameId && (parseDaily(r.board_id)?.sub ?? null) === sub);

/** 路径参数：只收有每日榜的游戏 */
export function weekParams(segments: string[]): Record<string, string> {
  const gameId = segments[0]!;
  if (!GAME_IDS.has(gameId)) throw new ApiError(404, 'unknown_game');
  if (!daily().games.includes(gameId)) throw new ApiError(404, 'not_found');
  return { gameId };
}

/** 这个游戏的哪个每日榜：有子榜的游戏要带 ?board=<子榜 id>（登记过的），没有子榜的不能带 */
function subOf(c: Ctx): string | null {
  const gameId = c.params.gameId!;
  const board = new URL(c.request.url).searchParams.get('board');
  const tab = daily().tabs.find((t) => t.game.id === gameId && (t.sub?.id ?? null) === board);
  if (!tab) throw new ApiError(404, 'not_found');
  return board;
}

/**
 * GET /api/friends/week/<gameId>[?board=<子榜>]：我和好友这周的最好成绩，形状和 GET /api/boards 一样（entries 前 50 + me），
 * 多一个 week（这周一的日期）。0 行写入。同分同名次。
 */
export async function friendsWeek(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const gameId = c.params.gameId!;
  const list = bestOf(rowsOf(await weekRows(c, [gameId]), gameId, subOf(c)));
  let rank = 0;
  const entries = list.map((b, i) => {
    if (i === 0 || b.score !== list[i - 1]!.score) rank = i + 1;
    return { rank, displayName: b.displayName, avatar: b.avatar, score: b.score, isMe: b.userId === me };
  });
  const mine = entries.find((e) => e.isMe);
  return json(200, { week: weekRange(c.now).week, entries: entries.slice(0, 50), me: mine ? { rank: mine.rank, score: mine.score } : null });
}

/**
 * GET /api/friends/overtakes：每个每日挑战（有子榜的每个子榜）里，这周最好成绩比我高的好友里最高的那个（我这周有成绩才比）。0 行写入。
 * {overtakes: [{gameId, board?: 子榜 id, by: {userId, displayName}, score, mine}]}
 */
export async function overtakes(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const rows = await weekRows(c, daily().games);
  const out = [];
  for (const t of daily().tabs) {
    const list = bestOf(rowsOf(rows, t.game.id, t.sub?.id ?? null));
    const mine = list.find((b) => b.userId === me);
    const top = list[0];
    if (mine && top && top.userId !== me && top.score > mine.score) {
      out.push({ gameId: t.game.id, ...(t.sub ? { board: t.sub.id } : {}), by: { userId: top.userId, displayName: top.displayName }, score: top.score, mine: mine.score });
    }
  }
  return json(200, { overtakes: out });
}
