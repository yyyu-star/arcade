/**
 * 限流（docs/platform-backend.md 5.4、15.6）。
 *
 * - 固定窗口计数：一条带条件的 UPSERT，超限时条件不成立、0 行写入（本地实测）；再把"超限到几点"缓存在内存里，之后连读都省了。
 * - 失败计数：只在密码或恢复码错时记，连续失败 failFree 次后按 30 秒 × 2^(n−5) 等待，最长 1 小时；成功清零。
 * - isolate 内存令牌桶：匿名接口每个 IP 每分钟 anonPerIpPerMinute 次，不碰 D1，只挡突发。
 */
import type { Limits } from './config';
import { DAY } from './context';
import type { Db } from './db';
import { rateLimited } from './http';

const MAX_CACHE = 5_000;
/** 限流键 → 超限到几点。 */
const blockedUntil = new Map<string, number>();
/** IP 哈希 → 令牌桶。 */
const buckets = new Map<string, { tokens: number; at: number }>();

/** 记下"这个键超限到几点"，之后本 isolate 里连 D1 都不碰。 */
export function remember(key: string, until: number): void {
  if (blockedUntil.size >= MAX_CACHE) blockedUntil.clear();
  blockedUntil.set(key, until);
}

function cachedBlock(key: string, now: number): void {
  const until = blockedUntil.get(key);
  if (until === undefined) return;
  if (until > now) throw rateLimited(until - now);
  blockedUntil.delete(key);
}

/** 匿名接口的内存令牌桶。 */
export function takeAnonToken(ipHash: string, limits: Limits, now: number): void {
  const rate = limits.anonPerIpPerMinute;
  let b = buckets.get(ipHash);
  if (!b) {
    if (buckets.size >= MAX_CACHE) buckets.clear();
    b = { tokens: rate, at: now };
    buckets.set(ipHash, b);
  }
  b.tokens = Math.min(rate, b.tokens + ((now - b.at) * rate) / 60_000);
  b.at = now;
  if (b.tokens < 1) throw rateLimited(((1 - b.tokens) * 60_000) / rate);
  b.tokens -= 1;
}

/** 固定窗口计一次的语句（按 UTC 对齐：小时窗口从整点、天窗口从 UTC 0 点算）。超限时 0 行写入、不返回行。 */
function hitStatement(db: Db, key: string, limit: number, windowMs: number, now: number): D1PreparedStatement {
  const start = now - (now % windowMs);
  return db.stmt(
    `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start < ?2 THEN 1 ELSE count + 1 END,
       window_start = ?2
     WHERE window_start < ?2 OR count < ?3
     RETURNING count`,
    key, start, limit,
  );
}

/** 计一次，超限抛 429。写入：新建或加一 1 行，超限 0 行。 */
export async function hit(db: Db, key: string, limit: number, windowMs: number, now: number): Promise<void> {
  cachedBlock(key, now);
  const row = await db.first<{ count: number }>(hitStatement(db, key, limit, windowMs, now));
  if (!row) {
    const until = now - (now % windowMs) + windowMs;
    remember(key, until);
    throw rateLimited(until - now);
  }
}

/** 先查一遍内存里的"超限到几点"，任何一个键还在超限就直接 429，一行都不写（比如 reg:all 满了以后换 IP 注册）。 */
export function checkCached(keys: string[], now: number): void {
  for (const k of keys) cachedBlock(k, now);
}

/** 只读：这个窗口里已经计了几次（给"成功才计数"的上限先查一下）。 */
/**
 * 每天的上限（UTC 天）：先看还有没有名额，满了 429（等到 UTC 0 点）；有就返回计数那一条，由调用方和这次的写入放进同一个 batch。
 * 账号安全的 acct、管理员的 admin 都这么用：被拒的请求不写计数。
 */
export async function dailyCapStatement(db: Db, key: string, limit: number, now: number): Promise<D1PreparedStatement> {
  if ((await peek(db, key, DAY, now)) >= limit) throw rateLimited(DAY - (now % DAY));
  return hitStatement(db, key, limit, DAY, now);
}

export async function peek(db: Db, key: string, windowMs: number, now: number): Promise<number> {
  const start = now - (now % windowMs);
  const row = await db.first<{ count: number; window_start: number }>(
    db.stmt('SELECT count, window_start FROM rate_counters WHERE key = ?1', key),
  );
  return row && row.window_start >= start ? row.count : 0;
}

export interface FailRow {
  count: number;
  window_start: number;
  blocked_until: number;
}

/** 失败计数是否正在等待中；正在等就抛 429。返回这行（没有为 null；成功后有这行才要清零）。 */
export async function checkFailLock(db: Db, key: string, now: number): Promise<FailRow | null> {
  cachedBlock(key, now);
  const row = await db.first<FailRow>(
    db.stmt('SELECT count, window_start, blocked_until FROM rate_counters WHERE key = ?1', key),
  );
  if (row && row.blocked_until > now) {
    remember(key, row.blocked_until);
    throw rateLimited(row.blocked_until - now);
  }
  return row;
}

/**
 * 记一次失败（1 行）。失败数到 failFree 起，设下次能试的时间。
 * 锁着的时候（还没到 blocked_until、窗口也没过）条件不成立，写 0 行：锁到期那一刻并发打进来的一批失败，
 * 最多只有让它重新锁上的那几次写入。
 */
function failStatement(db: Db, key: string, limits: Limits, now: number): D1PreparedStatement {
  return db.stmt(
    `INSERT INTO rate_counters (key, window_start, count, blocked_until) VALUES (?1, ?2, 1, 0)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE count + 1 END,
       blocked_until = CASE
         WHEN window_start + ?3 <= ?2 THEN 0
         WHEN count + 1 >= ?4 THEN ?2 + MIN(?5 * (1 << MIN(count + 1 - ?4, 20)), ?6)
         ELSE 0 END,
       window_start = CASE WHEN window_start + ?3 <= ?2 THEN ?2 ELSE window_start END
     WHERE blocked_until <= ?2 OR window_start + ?3 <= ?2
     RETURNING blocked_until`,
    key, now, limits.failWindowMs, limits.failFree, limits.failBaseMs, limits.failMaxMs,
  );
}

export async function recordFailure(db: Db, key: string, limits: Limits, now: number): Promise<void> {
  const row = await db.first<{ blocked_until: number }>(failStatement(db, key, limits, now));
  if (row && row.blocked_until > now) remember(key, row.blocked_until);
}

/** 清零失败计数（有这行才写，1 行）。 */
export function clearStatement(db: Db, key: string): D1PreparedStatement {
  blockedUntil.delete(key);
  return db.stmt('DELETE FROM rate_counters WHERE key = ?1', key);
}

/** 只给测试用。 */
export function resetRateLimitCacheForTests(): void {
  blockedUntil.clear();
  buckets.clear();
}
