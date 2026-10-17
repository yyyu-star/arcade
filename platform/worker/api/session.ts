/** 会话：读 cookie、查库、顺带更新 last_seen_at 和续期、新建与删除（docs/platform-backend.md 5.1）。 */
import type { Env } from '../env';
import type { Limits } from './config';
import { newSessionToken, sessionHashFromCookie } from './crypto';
import type { Db } from './db';
import { readCookie, SID_COOKIE, sessionCookies } from './http';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  friend_code: string;
  avatar_json: string | null;
  catchphrase_id: number | null;
  created_at: number;
  last_seen_at: number;
  role: 'user' | 'admin';
  /** 最近一次报位置的时间（0.13.0），没报过是 0 */
  presence_at: number;
  /** 让好友看到我在不在线、在哪（0.13.0），1 开 0 关 */
  show_where: number;
  /** 好友动态（0.17.0）：0 是关了，好友看不到我的动态，也不再生成 */
  show_feed: number;
}

export interface Session {
  tokenHash: string;
  renewedAt: number;
  expiresAt: number;
  user: UserRow;
}

/** 头像存成 JSON 文本，没设过是 null */
export function avatarOf(avatarJson: string | null): unknown {
  return avatarJson ? (JSON.parse(avatarJson) as unknown) : null;
}

/** 只给本人看的用户对象（15.1）。 */
export function userJson(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    friendCode: u.friend_code,
    avatar: avatarOf(u.avatar_json),
    catchphraseId: u.catchphrase_id,
    createdAt: u.created_at,
    showWhere: u.show_where !== 0,
    showFeed: u.show_feed !== 0,
    // 只增不改（15.1）：普通用户没有这个字段，前端据此决定露不露"管理"入口；接口另有服务端检查
    ...(u.role === 'admin' ? { isAdmin: true as const } : {}),
  };
}

export const USER_COLUMNS =
  'u.id, u.username, u.display_name, u.friend_code, u.avatar_json, u.catchphrase_id, u.created_at, u.last_seen_at, u.role, u.presence_at, u.show_where, u.show_feed';

/** 没带 cookie、cookie 格式不对、会话不存在或过期，都返回 null。 */
export async function loadSession(request: Request, env: Env, db: Db, now: number): Promise<Session | null> {
  const value = readCookie(request, SID_COOKIE);
  if (!value) return null;
  const hash = await sessionHashFromCookie(env, value);
  if (!hash) return null;
  const row = await db.first<UserRow & { renewed_at: number; expires_at: number }>(
    db.stmt(
      `SELECT ${USER_COLUMNS}, s.renewed_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`,
      hash,
    ),
  );
  if (!row || row.expires_at <= now) return null;
  const { renewed_at, expires_at, ...user } = row;
  return { tokenHash: hash, renewedAt: renewed_at, expiresAt: expires_at, user };
}

/**
 * 顺带的写入：last_seen_at 每小时最多 1 次，会话离上次续期超过 30 天就续到 400 天。
 * 返回续期后要重设的 cookie（没续期返回空数组）。cookieValue 是请求里的原 cookie 值。
 */
export async function touchSession(
  db: Db,
  s: Session,
  cookieValue: string,
  limits: Limits,
  now: number,
): Promise<string[]> {
  const stmts: D1PreparedStatement[] = [];
  let cookies: string[] = [];
  if (now - s.user.last_seen_at >= limits.lastSeenEveryMs) {
    stmts.push(db.stmt('UPDATE users SET last_seen_at = ?1 WHERE id = ?2', now, s.user.id));
    s.user.last_seen_at = now;
  }
  if (now - s.renewedAt >= limits.sessionRenewMs) {
    const expires = now + limits.sessionTtlMs;
    stmts.push(db.stmt('UPDATE sessions SET renewed_at = ?1, expires_at = ?2 WHERE token_hash = ?3', now, expires, s.tokenHash));
    cookies = sessionCookies(cookieValue, limits.sessionTtlMs);
  }
  if (stmts.length) await db.batch(stmts);
  return cookies;
}

/** 新会话：语句交给调用方和别的写入一起 batch；cookies 在写入成功后再设。 */
export async function newSession(
  env: Env,
  db: Db,
  userId: string,
  limits: Limits,
  now: number,
): Promise<{ stmt: D1PreparedStatement; cookies: string[] }> {
  const t = await newSessionToken(env);
  return {
    stmt: db.stmt(
      'INSERT INTO sessions (token_hash, user_id, created_at, renewed_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)',
      t.hash, userId, now, now + limits.sessionTtlMs,
    ),
    cookies: sessionCookies(t.cookie, limits.sessionTtlMs),
  };
}

/** 注销账号要删的所有行（7.3）：一次 batch，D1 里是一个事务。Cron 清理 1 年未登录的账号也用它。 */
export function deleteUserStatements(db: Db, userId: string, username: string): D1PreparedStatement[] {
  const counterKeys = [
    `login:fail:${username}`, `reauth:fail:${userId}`, `profile:${userId}`, `acct:${userId}`,
    `save:${userId}`, `freq:${userId}`, `fcode:${userId}`, `fcnew:${userId}`, `block:${userId}`, `score:${userId}`, `admin:${userId}`, `react:${userId}`,
  ];
  return [
    db.stmt('DELETE FROM sessions WHERE user_id = ?1', userId),
    db.stmt('DELETE FROM credentials WHERE user_id = ?1', userId),
    db.stmt('DELETE FROM saves WHERE user_id = ?1', userId),
    // 主键以 user_id 开头，按人删是前缀扫描，不扫全表
    db.stmt('DELETE FROM boards WHERE user_id = ?1', userId),
    // 钱包一人一行（迁移 0005），桌上那一份也一起没了
    db.stmt('DELETE FROM wallets WHERE user_id = ?1', userId),
    db.stmt('DELETE FROM friendships WHERE user_a = ?1 OR user_b = ?1', userId),
    db.stmt('DELETE FROM blocks WHERE blocker = ?1 OR blocked = ?1', userId),
    // 邀请（迁移 0007）：发出的、收到的都删；两个方向各走一个索引
    db.stmt('DELETE FROM invites WHERE from_id = ?1', userId),
    db.stmt('DELETE FROM invites WHERE to_id = ?1', userId),
    // 好友动态（迁移 0008）：本人发的走 (user_id, created_at) 索引；本人赞的没有按人的索引，要扫全表——表只留 7 天，注销很少，接受。
    // 别人给本人动态的赞留着，7 天后跟着 Cron 删
    db.stmt('DELETE FROM feed WHERE user_id = ?1', userId),
    db.stmt('DELETE FROM feed_reactions WHERE user_id = ?1', userId),
    db.stmt(`DELETE FROM rate_counters WHERE key IN (${counterKeys.map((_, i) => `?${i + 1}`).join(', ')})`, ...counterKeys),
    db.stmt('DELETE FROM users WHERE id = ?1', userId),
  ];
}
