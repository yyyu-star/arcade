/**
 * 排行榜页的接口（0.10.4，docs/platform-backend.md 15.12）：本周净赢（总榜 + 每个游戏）、称号收集，都从钱包行里的 career 汇总（5.10）。
 * 不新增写入；读走每个 isolate 5 分钟的缓存，和大厅的"今天 N 人玩过"一样，来看榜的人再多，一个 isolate 5 分钟也只扫一遍钱包。
 * 每日挑战榜是现有的分数榜（15.5）：games.ts 里登记了 daily 的游戏，这里只告诉页面它今天那个榜叫什么，页面用 GET /api/boards 去读。
 */
import type { Ctx } from './context';
import type { Db } from './db';
import { GAME_IDS, GAMES } from '../../src/games';
import { daily as dailyConfig } from './daily';
import { parseDaily } from './boards';
import { ApiError, json } from './http';
import { beijingDate, beijingWeek } from './time';
import { avatarOf } from './session';

const TTL_MS = 5 * 60 * 1000;
const TOP_N = 50;

interface Player {
  userId: string;
  displayName: string;
  avatar: unknown;
  /** 各游戏本周净赢（只有这周结回过的游戏） */
  week: Record<string, number>;
  titles: number;
}

interface Snapshot {
  week: string;
  day: string;
  at: number;
  players: Player[];
  /** 每个每日挑战标签（游戏 id，或"游戏 id:子榜 id"）今天的榜 id（规则版本 -v<n> 最大的那个）；还没人交分时是 null */
  daily: Record<string, string | null>;
}

let cache: Snapshot | null = null;

export function resetLeaderboardCacheForTests(): void {
  cache = null;
}

async function snapshot(db: Db, now: number): Promise<Snapshot> {
  const week = beijingWeek(now);
  const day = beijingDate(now);
  if (cache && cache.week === week && cache.day === day && now - cache.at < TTL_MS) return cache;
  const [rows, daily] = await Promise.all([
    db.all<{ user_id: string; display_name: string; avatar_json: string | null; game: string; wnet: number | null; titles: number }>(
      db.stmt(
        `SELECT w.user_id, u.display_name, u.avatar_json, g.key AS game,
           CASE WHEN json_extract(g.value, '$.wk') = ?1 THEN json_extract(g.value, '$.wnet') END AS wnet,
           (SELECT COUNT(*) FROM json_each(g.value, '$.titles')) AS titles
         FROM wallets w JOIN users u ON u.id = w.user_id, json_each(w.state, '$.career') AS g`,
        week,
      ),
    ),
    // 每日榜 id 是 daily-YYYY-MM-DD[-<子榜>][-v<n>]：每个游戏按前缀范围找，走 boards_rank 索引
    db.all<{ game_id: string; board_id: string }>(
      db.stmt(
        `SELECT DISTINCT game_id, board_id FROM boards
         WHERE game_id IN (SELECT value FROM json_each(?3)) AND board_id >= ?1 AND board_id < ?2`,
        `daily-${day}`,
        `daily-${day}~`,
        JSON.stringify(dailyConfig().games),
      ),
    ),
  ]);
  const byUser = new Map<string, Player>();
  for (const r of rows) {
    let p = byUser.get(r.user_id);
    if (!p) {
      p = { userId: r.user_id, displayName: r.display_name, avatar: avatarOf(r.avatar_json), week: {}, titles: 0 };
      byUser.set(r.user_id, p);
    }
    if (r.wnet !== null) p.week[r.game] = r.wnet;
    p.titles += r.titles;
  }
  // 每日挑战的标签：key 是游戏 id，有子榜的是"游戏 id:子榜 id"（0.16.0）
  const today: Record<string, string | null> = Object.fromEntries(dailyConfig().tabs.map((t) => [t.key, null]));
  for (const { game_id, board_id } of daily) {
    const d = parseDaily(board_id);
    if (!d) continue;
    const key = d.sub === null ? game_id : `${game_id}:${d.sub}`;
    // 登记里没有的（比如游戏改成子榜之前交的不带子榜的榜）不给标签
    if (!(key in today)) continue;
    const cur = today[key];
    if (!cur || d.v > parseDaily(cur)!.v) today[key] = board_id;
  }
  cache = { week, day, at: now, players: [...byUser.values()], daily: today };
  return cache;
}

export interface BoardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatar: unknown;
  value: number;
  isMe: boolean;
}

/** 从大到小排，同分同名次（1, 2, 2, 4）；只给前 50，外加我的名次 */
function rank(list: { p: Player; value: number }[], me: string): { entries: BoardEntry[]; me: { rank: number; value: number } | null } {
  list.sort((a, b) => b.value - a.value || a.p.displayName.localeCompare(b.p.displayName));
  let mine: { rank: number; value: number } | null = null;
  let prev = { value: NaN, rank: 0 };
  const entries: BoardEntry[] = [];
  list.forEach(({ p, value }, i) => {
    const r = value === prev.value ? prev.rank : i + 1;
    prev = { value, rank: r };
    if (p.userId === me) mine = { rank: r, value };
    if (i < TOP_N) entries.push({ rank: r, userId: p.userId, displayName: p.displayName, avatar: p.avatar, value, isMe: p.userId === me });
  });
  return { entries, me: mine };
}

/**
 * GET /api/leaderboard?scope=all|friends：本周净赢（总榜 total + 每个游戏）、称号收集（titles），每个榜前 50 加我的名次；
 * 外加有每日榜的游戏今天的榜 id。写 0 行；缓存过期时读钱包数 + 用户数行，只看好友时另读我的好友关系。
 */
export async function getLeaderboard(c: Ctx): Promise<Response> {
  const me = c.session!.user.id;
  const scope = new URL(c.request.url).searchParams.get('scope') ?? 'all';
  if (scope !== 'all' && scope !== 'friends') throw new ApiError(400, 'bad_request');
  const snap = await snapshot(c.db, c.now);
  let players = snap.players;
  if (scope === 'friends') {
    const rows = await c.db.all<{ id: string }>(
      c.db.stmt(
        `SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END AS id FROM friendships
         WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted'`,
        me,
      ),
    );
    const ids = new Set([me, ...rows.map((r) => r.id)]);
    players = players.filter((p) => ids.has(p.userId));
  }
  const played = players.filter((p) => Object.keys(p.week).length > 0);
  const boards: Record<string, ReturnType<typeof rank>> = {
    total: rank(
      played.map((p) => ({ p, value: Object.values(p.week).reduce((t, x) => t + x, 0) })),
      me,
    ),
  };
  for (const game of GAME_IDS) {
    boards[game] = rank(
      played.filter((p) => Object.hasOwn(p.week, game)).map((p) => ({ p, value: p.week[game]! })),
      me,
    );
  }
  boards.titles = rank(
    players.filter((p) => p.titles > 0).map((p) => ({ p, value: p.titles })),
    me,
  );
  return json(200, { week: snap.week, scope, boards, daily: snap.daily });
}
