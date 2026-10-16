/**
 * 账号安全操作：改密码、换恢复码、退出其他设备、注销（docs/platform-backend.md 5.1、5.2、15.2）。
 * 都要再输一次当前密码（注销也可以用恢复码）；再验证失败单独计数，不和登录共用一把锁。
 * 改密码、换恢复码、退出其他设备每人每天合计 acctPerDay 次，只算成功的（6.6、15.6）。
 */
import { check, str } from './auth';
import { type Ctx, DAY } from './context';
import {
  hashPassword,
  hashRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  verifyPassword,
  verifyRecoveryCode,
} from './crypto';
import { ApiError, clearCookies, json, noContent, rateLimited, withCookies } from './http';
import { meter } from './meter';
import { checkFailLock, clearStatement, dailyCapStatement, recordFailure, remember } from './ratelimit';
import { deleteUserStatements, newSession } from './session';
import { checkPassword, normalizePassword } from './validate';

/**
 * 再验证；失败记 reauth:fail 并抛 401。返回要追加进 batch 的"清零失败计数"语句（没有失败记录时为空）。
 *
 * recordFailures 为 false：账号安全类连超额封顶都用完了（6.6），注销仍要放行，但失败计数写不进库，
 * 偷了 cookie 的人就能一直猜密码。所以这时
 * - 库里已经错够 failFree 次的，不再验密码，直接 429；
 * - 猜错一次就在本 isolate 内存里锁这个用户到 UTC 当天结束，也是 429。
 * 代价是本人这天手滑输错一次，在这个 isolate 上当天也注销不了；封顶用完本来就是要紧急止血的时候。
 */
async function reauth(c: Ctx, allowRecoveryCode: boolean, recordFailures = true): Promise<D1PreparedStatement[]> {
  const { db, env, limits, now } = c;
  const userId = c.session!.user.id;
  const failKey = `reauth:fail:${userId}`;
  const fail = await checkFailLock(db, failKey, now);
  const dayEnd = now - (now % DAY) + DAY;
  if (!recordFailures && fail && fail.window_start + limits.failWindowMs > now && fail.count >= limits.failFree) {
    throw rateLimited(dayEnd - now);
  }
  let ok: boolean;
  if (typeof c.body.currentPassword === 'string') {
    const row = await db.first<{ secret: string }>(
      db.stmt("SELECT secret FROM credentials WHERE user_id = ?1 AND type = 'password'", userId),
    );
    ok = !!row && (await verifyPassword(env, normalizePassword(c.body.currentPassword), row.secret, limits.pbkdf2Iterations)).ok;
  } else if (allowRecoveryCode && typeof c.body.recoveryCode === 'string') {
    const code = normalizeRecoveryCode(c.body.recoveryCode);
    const row = await db.first<{ secret: string }>(
      db.stmt("SELECT secret FROM credentials WHERE user_id = ?1 AND type = 'recovery'", userId),
    );
    ok = !!row && !!code && (await verifyRecoveryCode(env, userId, code, row.secret));
  } else {
    throw new ApiError(400, 'bad_request');
  }
  if (!ok) {
    if (!recordFailures) {
      remember(failKey, dayEnd);
      throw rateLimited(dayEnd - now);
    }
    await recordFailure(db, failKey, limits, now);
    throw new ApiError(401, 'bad_credentials');
  }
  return fail ? [clearStatement(db, failKey)] : [];
}

/** 每人每天的 acct 上限：先只读查一下（超了不花 PBKDF2 的 CPU），成功后再计数。 */
async function checkAcctCap(c: Ctx): Promise<D1PreparedStatement> {
  return dailyCapStatement(c.db, `acct:${c.session!.user.id}`, c.limits.acctPerDay, c.now);
}

/** POST /api/account/password：其他会话失效，当前设备换新令牌。 */
export async function changePassword(c: Ctx): Promise<Response> {
  const { db, env, limits, now } = c;
  const user = c.session!.user;
  const newPassword = normalizePassword(str(c.body.newPassword));
  check(checkPassword(newPassword, user.username));
  const count = await checkAcctCap(c);
  const clear = await reauth(c, false);
  const pwHash = await hashPassword(env, newPassword, limits.pbkdf2Iterations);
  const session = await newSession(env, db, user.id, limits, now);
  await db.batch([
    db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'password'", pwHash, now, user.id),
    db.stmt('DELETE FROM sessions WHERE user_id = ?1', user.id),
    session.stmt,
    count,
    ...clear,
  ]);
  return withCookies(noContent(), session.cookies);
}

/** POST /api/account/recovery-code：旧码作废，新码只显示这一次。 */
export async function changeRecoveryCode(c: Ctx): Promise<Response> {
  const { db, env, now } = c;
  const userId = c.session!.user.id;
  const count = await checkAcctCap(c);
  const clear = await reauth(c, false);
  const code = newRecoveryCode();
  const rcHash = await hashRecoveryCode(env, userId, normalizeRecoveryCode(code)!);
  await db.batch([
    db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'recovery'", rcHash, now, userId),
    count,
    ...clear,
  ]);
  return json(200, { recoveryCode: code });
}

/** POST /api/account/logout-others：保留当前会话，删掉其他所有会话。 */
export async function logoutOthers(c: Ctx): Promise<Response> {
  const { db } = c;
  const s = c.session!;
  const count = await checkAcctCap(c);
  const clear = await reauth(c, false);
  await db.batch([
    db.stmt('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2', s.user.id, s.tokenHash),
    count,
    ...clear,
  ]);
  return noContent();
}

/** POST /api/account/delete：一次 batch 删掉这个人的所有行（7.3）。 */
export async function deleteAccount(c: Ctx): Promise<Response> {
  const user = c.session!.user;
  await reauth(c, true, !meter.acctOverflowExhausted(c.limits, c.now));
  await c.db.batch(deleteUserStatements(c.db, user.id, user.username));
  return withCookies(noContent(), clearCookies());
}
