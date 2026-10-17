/**
 * 搭子战绩（0.19.0，docs/platform-backend.md 15.19，docs/social.md 第 2 节）：好友房打完一场，游戏的服务端经钱包绑定的
 * together() 报同桌真人，平台给其中已经是好友的每一对累计场数、各自赢了几场、做搭档几场、搭档时赢了几场。
 * 只有服务绑定能调（浏览器的 /api 里没有这条路）；看的时候只给好友，任意一方关了 show_mates 两边都看不到。
 */
import type { Db } from './db';

/** 一桌最多报几个真人：德州一桌最多 8 个真人（28 对），再多就是报错了 */
export const TOGETHER_MAX_PLAYERS = 8;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface TogetherPlayer {
  userId: string;
  team?: number;
  win: boolean;
}
export interface TogetherReq {
  op: string;
  players: TogetherPlayer[];
}

/** 游戏传来的 { op, players } → 校验过的；形状不对返回 null（回 bad_request，一行不写） */
export function parseTogether(raw: unknown): TogetherReq | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.op !== 'string' || !OP_RE.test(b.op)) return null;
  if (!Array.isArray(b.players) || b.players.length < 2 || b.players.length > TOGETHER_MAX_PLAYERS) return null;
  const players: TogetherPlayer[] = [];
  const seen = new Set<string>();
  for (const p of b.players as unknown[]) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const { userId, team, win } = p as Record<string, unknown>;
    if (typeof userId !== 'string' || !USER_RE.test(userId) || seen.has(userId) || typeof win !== 'boolean') return null;
    if (team !== undefined && !(Number.isInteger(team) && (team as number) >= 0 && (team as number) <= 3)) return null;
    seen.add(userId);
    players.push(team === undefined ? { userId, win } : { userId, team: team as number, win });
  }
  return { op: b.op, players };
}

/**
 * 记一场：先一条查询找出两两之间是好友的对，再每对一条 UPSERT（同一个 op 再报 0 行）。返回记上了几对。
 * 好友关系查完到写入之间被删的那一对会多记一场——删好友时这一对的行一起删，下一次查就没有了，接受。
 */
export async function recordTogether(db: Db, game: string, req: TogetherReq, now: number): Promise<number> {
  const ids = req.players.map((p) => p.userId);
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const friends = await db.all<{ user_a: string; user_b: string }>(
    db.stmt(`SELECT user_a, user_b FROM friendships WHERE status = 'accepted' AND user_a IN (${marks}) AND user_b IN (${marks})`, ...ids),
  );
  if (!friends.length) return 0;
  const byId = new Map(req.players.map((p) => [p.userId, p]));
  const stmts = friends.map(({ user_a, user_b }) => {
    const lo = byId.get(user_a)!;
    const hi = byId.get(user_b)!;
    const team = lo.team !== undefined && lo.team === hi.team ? 1 : 0;
    return db.stmt(
      `INSERT INTO mates (lo, hi, game, n, lo_wins, hi_wins, team_n, team_wins, last_op, last_at)
       VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (lo, hi, game) DO UPDATE SET
         n = n + 1, lo_wins = lo_wins + excluded.lo_wins, hi_wins = hi_wins + excluded.hi_wins,
         team_n = team_n + excluded.team_n, team_wins = team_wins + excluded.team_wins,
         last_op = excluded.last_op, last_at = excluded.last_at
       WHERE mates.last_op <> excluded.last_op`,
      user_a, user_b, game, Number(lo.win), Number(hi.win), team, team && lo.win ? 1 : 0, req.op, now,
    );
  });
  const rs = await db.batch(stmts);
  return rs.filter((r) => r.meta.changes > 0).length;
}

/** 给好友看的一对：我赢、他赢都按"我"的视角 */
export interface Together {
  n: number;
  wins: number;
  theirWins: number;
  teamN: number;
  teamWins: number;
}

interface MateRow {
  lo: string;
  hi: string;
  game: string;
  n: number;
  lo_wins: number;
  hi_wins: number;
  team_n: number;
  team_wins: number;
}

const view = (r: MateRow, me: string): Together => ({
  n: r.n,
  wins: me === r.lo ? r.lo_wins : r.hi_wins,
  theirWins: me === r.lo ? r.hi_wins : r.lo_wins,
  teamN: r.team_n,
  teamWins: r.team_wins,
});

function add(a: Together | undefined, b: Together): Together {
  if (!a) return b;
  return { n: a.n + b.n, wins: a.wins + b.wins, theirWins: a.theirWins + b.theirWins, teamN: a.teamN + b.teamN, teamWins: a.teamWins + b.teamWins };
}

/** 我和所有人的（各游戏加起来），按对方 userId；只读，主键和 hi 索引各走一遍 */
export async function togetherAll(db: Db, me: string): Promise<Map<string, Together>> {
  const rows = await db.all<MateRow>(
    db.stmt('SELECT lo, hi, game, n, lo_wins, hi_wins, team_n, team_wins FROM mates WHERE lo = ?1 UNION ALL SELECT lo, hi, game, n, lo_wins, hi_wins, team_n, team_wins FROM mates WHERE hi = ?1', me),
  );
  const out = new Map<string, Together>();
  for (const r of rows) {
    const other = r.lo === me ? r.hi : r.lo;
    out.set(other, add(out.get(other), view(r, me)));
  }
  return out;
}

/** 我和一个人的，按游戏分开（战绩页）；只读，主键前缀 */
export async function togetherWith(db: Db, me: string, other: string): Promise<Record<string, Together>> {
  const [lo, hi] = me < other ? [me, other] : [other, me];
  const rows = await db.all<MateRow>(
    db.stmt('SELECT lo, hi, game, n, lo_wins, hi_wins, team_n, team_wins FROM mates WHERE lo = ?1 AND hi = ?2', lo, hi),
  );
  return Object.fromEntries(rows.map((r) => [r.game, view(r, me)]));
}

/** 删好友、屏蔽时删这一对的所有行（每个游戏 1 行） */
export function deletePairStatement(db: Db, a: string, b: string): D1PreparedStatement {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return db.stmt('DELETE FROM mates WHERE lo = ?1 AND hi = ?2', lo, hi);
}
