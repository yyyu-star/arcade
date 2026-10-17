/** 注册、登录、退出、找回、本人资料（docs/platform-backend.md 5.1、15.2）。 */
import { type Ctx, DAY, HOUR } from './context';
import { claimStatement, findUsableCode, inviteFriendStatement } from './invite-codes';
import {
  burnPasswordHash,
  normalizeInviteCode,
  hashPassword,
  hashRecoveryCode,
  newFriendCode,
  newRecoveryCode,
  newUserId,
  normalizeRecoveryCode,
  sessionHashFromCookie,
  verifyPassword,
  verifyRecoveryCode,
} from './crypto';
import { ApiError, clearCookies, json, noContent, rateLimited, withCookies } from './http';
import { meter } from './meter';
import { checkCached, checkFailLock, clearStatement, hit, reserveAttempt, takeAnonToken } from './ratelimit';
import { newSession, touchSession, USER_COLUMNS, type UserRow, userJson } from './session';
import { noticeCached, registrationOpenCached, registrationOpenFresh } from './settings';
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  isUsernameFormat,
  normalizeDisplayName,
  normalizePassword,
  normalizeUsername,
} from './validate';

export function str(v: unknown): string {
  if (typeof v !== 'string') throw new ApiError(400, 'bad_request');
  return v;
}

const badCredentials = () => new ApiError(401, 'bad_credentials');

/** 全站每小时上限（随计量上报，略有滞后，6.6）。 */
function checkHourly(c: Ctx, kind: 'login' | 'recover', limit: number): void {
  if (meter.anonThisHour(kind, c.now) >= limit) throw rateLimited(HOUR - (c.now % HOUR));
}

/** GET /api/me：没带 cookie 时不碰 D1（除了本 isolate 第一次的计量上报）。 */
export async function getMe(c: Ctx): Promise<Response> {
  const base = {
    service: c.tier === 'readonly' ? 'readonly' : 'ok',
    saves: c.tier === 'noGrowth' || meter.exhausted('save', c.limits, c.now) ? 'paused' : 'ok',
    // 登录页据此决定露不露"注册"（只增不改，15.1）；30 秒缓存，真正注册时读最新值（settings.ts）
    registration: (await registrationOpenCached(c)) ? 'open' : 'closed',
  };
  if (!c.sidCookie) return json(200, { user: null, ...base, notice: null });
  if (!c.session) return withCookies(json(200, { user: null, ...base, notice: null }), clearCookies());
  const cookies = await touch(c);
  // 大厅公告（0.10.8）只给登录了的人，30 秒缓存（settings.ts）
  return withCookies(json(200, { user: userJson(c.session.user), ...base, notice: await noticeCached(c) }), cookies);
}

/** 顺带的写入只在正常、停增长档，而且"好友与资料"类预算没用完时做。 */
async function touch(c: Ctx): Promise<string[]> {
  if (!c.session || !c.sidCookie) return [];
  if (c.tier === 'readonly' || meter.exhausted('social', c.limits, c.now)) return [];
  return touchSession(c.db.as('social'), c.session, c.sidCookie, c.limits, c.now);
}

/** PATCH /api/me：改昵称和几个隐私开关，共用每人每天 profilePerDay 次。 */
export async function patchMe(c: Ctx): Promise<Response> {
  const user = c.session!.user;
  // 改昵称、"让好友看到我在哪"（0.13.0）、"好友动态"（0.17.0）、"搭子战绩"（0.19.0）三个开关：至少带一样，几样一起带就一起改（一次计数、一行）
  const hasName = c.body.displayName !== undefined;
  const { showWhere, showFeed, showMates } = c.body;
  if (!hasName && showWhere === undefined && showFeed === undefined && showMates === undefined) throw new ApiError(400, 'bad_request');
  for (const v of [showWhere, showFeed, showMates]) if (v !== undefined && typeof v !== 'boolean') throw new ApiError(400, 'bad_request');
  const displayName = hasName ? normalizeDisplayName(str(c.body.displayName)) : user.display_name;
  if (hasName) check(checkDisplayName(displayName));
  const flagOf = (v: unknown, old: number) => (v === undefined ? old : v ? 1 : 0);
  const flag = flagOf(showWhere, user.show_where);
  const feed = flagOf(showFeed, user.show_feed);
  const mates = flagOf(showMates, user.show_mates);
  await hit(c.db, `profile:${user.id}`, c.limits.profilePerDay, DAY, c.now);
  await c.db.run(
    c.db.stmt('UPDATE users SET display_name = ?1, show_where = ?2, show_feed = ?3, show_mates = ?4 WHERE id = ?5', displayName, flag, feed, mates, user.id),
  );
  user.display_name = displayName;
  user.show_where = flag;
  user.show_feed = feed;
  user.show_mates = mates;
  const cookies = await touch(c);
  return withCookies(json(200, { user: userJson(user) }), cookies);
}

/**
 * POST /api/auth/register：写 9 行（7.2）。注册关闭时回 403，不计 reg 数、不算密码哈希、写 0 行（内存令牌桶照扣，见下）。
 * 开没开：总闸 vars.REGISTRATION 不是 "switch" 就关（不碰 D1）；否则读 D1 的开关（1 行，每次读最新值，settings.ts）。
 * 先过内存令牌桶再读开关：注册关着时有人刷，也只有令牌桶放过的请求才读 D1（不为省这一读改用缓存判断"关"，关了要马上生效）。
 * 读开关失败按关处理（403 registration_closed），登录页看得懂，不回 500；只兜读开关这一步，后面写库出错照样 500。
 * 令牌在校验之前扣：注册开着时格式不对的请求（422）也算一次，有意为之——刷请求的不用先猜对格式才被限住。
 */
export async function register(c: Ctx): Promise<Response> {
  const { db, env, limits, now } = c;
  const ip = await c.ipHash();
  takeAnonToken(ip, limits, now);
  // 邀请码（0.20.0，15.20）：开着时可填可不填，关着时必须带。带了就要对，填错不回落成普通注册
  const rawCode = c.body.inviteCode;
  const withCode = rawCode !== undefined && rawCode !== null && rawCode !== '';
  let open = false;
  try {
    open = await registrationOpenFresh(c);
  } catch (e) {
    // 只记错误本身，不记 cookie、请求体
    console.error('registration switch read failed', e instanceof Error ? e.message : e);
    open = false;
  }
  if (!open && !withCode) throw new ApiError(403, 'registration_closed');
  const username = normalizeUsername(str(c.body.username));
  const password = normalizePassword(str(c.body.password));
  const displayName = normalizeDisplayName(str(c.body.displayName));
  check(checkUsername(username));
  check(checkPassword(password, username));
  check(checkDisplayName(displayName));

  // 试码：每 IP 每小时 invitePerIpHour 次，成败都算（带条件的 UPSERT，超了 429、0 行）。不设全站上限：
  // 全站计数只要算了乱试的，几个 IP 段就能耗光、挡住所有拿着真码的人（0.19.2 的教训）；码 60 bit，按 IP 限住就猜不中
  let invite: { id: string; owner_id: string } | null = null;
  if (withCode) {
    checkCached([`inv:ip:${ip}`], now);
    await hit(db, `inv:ip:${ip}`, limits.invitePerIpHour, HOUR, now);
    const code = normalizeInviteCode(str(rawCode));
    invite = code ? await findUsableCode(db, code, now) : null;
    if (!invite) throw new ApiError(400, 'invite_invalid');
  }

  checkCached([`reg:ip:${ip}`, 'reg:all'], now);
  await hit(db, `reg:ip:${ip}`, limits.regPerIpDay, DAY, now);
  await hit(db, 'reg:all', limits.regAllDay, DAY, now);
  await checkUsernameFree(c, username);

  const userId = newUserId();
  const session = await newSession(env, db, userId, limits, now, !!invite);
  const extra = invite ? [session.stmt, inviteFriendStatement(db, invite.owner_id, userId, now, limits.friendsMax)] : [session.stmt];
  const { user, recoveryCode } = await insertUser(
    c,
    { userId, username, displayName, password, role: 'user' },
    extra,
    invite ? { id: invite.id, claim: claimStatement(db, invite.id, userId, now) } : undefined,
  );
  return withCookies(json(201, { user: userJson(user), recoveryCode }), session.cookies);
}

export function check(result: string): void {
  if (result !== 'ok') throw new ApiError(422, result);
}

export async function checkUsernameFree(c: Ctx, username: string): Promise<void> {
  if (await c.db.first(c.db.stmt('SELECT 1 FROM users WHERE username = ?1', username))) {
    throw new ApiError(409, 'username_taken');
  }
}

/**
 * 建号：users 1 行、密码和恢复码各 1 行，再加上调用方的语句（注册的新会话、管理员的每日计数），一个 batch。
 * 注册和管理员建号共用，校验已经在调用方做完。返回新用户和只给看这一次的恢复码。
 *
 * invite（0.20.0，15.20）：带邀请码注册。batch 第一条是占码（claim，条件更新），users 那条以"码的 used_by 是这个新 id"为条件，
 * 密码、恢复码和 extra 里的语句（调用方要让它们以"users 里有这个新 id"为条件）跟着 users 走。D1 的 batch 是一个事务、按顺序执行：
 * 同一个码两个人同时用，后到的那个占码改了 0 行，后面一行都不写，这里抛 409 invite_used。
 */
export async function insertUser(
  c: Ctx,
  u: { userId: string; username: string; displayName: string; password: string; role: UserRow['role'] },
  extra: D1PreparedStatement[],
  invite?: { id: string; claim: D1PreparedStatement },
): Promise<{ user: UserRow; recoveryCode: string }> {
  const { db, env, limits, now } = c;
  const recoveryCode = newRecoveryCode();
  const pwHash = await hashPassword(env, u.password, limits.pbkdf2Iterations);
  const rcHash = await hashRecoveryCode(env, u.userId, normalizeRecoveryCode(recoveryCode)!);
  // 好友码 40 bit，撞上的概率极小；撞上就换一个再试
  for (let attempt = 0; ; attempt++) {
    const friendCode = newFriendCode();
    try {
      const userInsert = invite
        ? db.stmt(
            `INSERT INTO users (id, username, display_name, friend_code, created_at, last_seen_at, role)
             SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?6 WHERE EXISTS (SELECT 1 FROM invite_codes WHERE id = ?7 AND used_by = ?1)`,
            u.userId, u.username, u.displayName, friendCode, now, u.role, invite.id,
          )
        : db.stmt(
            `INSERT INTO users (id, username, display_name, friend_code, created_at, last_seen_at, role)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)`,
            u.userId, u.username, u.displayName, friendCode, now, u.role,
          );
      // 带码时：users 没插进去（码被别人先占了），这两行也不插
      const ifUser = invite ? ' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)' : '';
      const rs = await db.batch([
        ...(invite ? [invite.claim] : []),
        userInsert,
        db.stmt(`INSERT INTO credentials (user_id, type, secret, created_at) SELECT ?1, 'password', ?2, ?3${ifUser}`, u.userId, pwHash, now),
        db.stmt(`INSERT INTO credentials (user_id, type, secret, created_at) SELECT ?1, 'recovery', ?2, ?3${ifUser}`, u.userId, rcHash, now),
        ...extra,
      ]);
      if (invite && !rs[0]!.meta.changes) throw new ApiError(409, 'invite_used');
      const user: UserRow = {
        id: u.userId, username: u.username, display_name: u.displayName, friend_code: friendCode, avatar_json: null,
        catchphrase_id: null, created_at: now, last_seen_at: now, role: u.role, presence_at: 0, show_where: 1, show_feed: 1, show_mates: 1,
      };
      return { user, recoveryCode };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('users.username')) throw new ApiError(409, 'username_taken');
      if (!msg.includes('users.friend_code') || attempt >= 2) throw e;
    }
  }
}

/**
 * 先查用户名有没有被暂时锁住、再算 PBKDF2，被锁时不花 CPU。用户名不存在时不记失败计数（5.4）。
 * 第三轮审计（0.19.2）：
 * - 全站每小时的名额只算"用户名存在"的尝试：原来查用户名之前就计，拿不存在的用户名换几个 IP 段就能把全站一小时的登录耗光。
 *   撞库要猜的是真账号，这部分照旧全算；乱填的用户名伤不到任何账号，由每个 IP 的上限和令牌桶管；
 * - 算 PBKDF2 之前先占一次尝试（reserveAttempt），对了再清零，堵住锁到期那一刻的并发；
 * - 用户名不存在也白算一次哈希，两种情况响应时间一样。
 */
export async function login(c: Ctx): Promise<Response> {
  const { db, env, limits, now } = c;
  const username = normalizeUsername(str(c.body.username));
  const password = normalizePassword(str(c.body.password));
  if (!isUsernameFormat(username)) throw badCredentials();

  const ip = await c.ipHash();
  takeAnonToken(ip, limits, now);
  checkHourly(c, 'login', limits.loginAllHour);
  const failKey = `login:fail:${username}`;
  await checkFailLock(db, failKey, now);
  await hit(db, `login:ip:${ip}`, limits.loginPerIpHour, HOUR, now);

  const row = await db.first<UserRow & { secret: string }>(
    db.stmt(
      `SELECT ${USER_COLUMNS}, c.secret FROM users u
       JOIN credentials c ON c.user_id = u.id AND c.type = 'password' WHERE u.username = ?1`,
      username,
    ),
  );
  if (!row) {
    await burnPasswordHash(env, password, limits.pbkdf2Iterations);
    throw badCredentials();
  }
  await reserveAttempt(db, failKey, limits, now);
  meter.countAnon('login');
  const v = await verifyPassword(env, password, row.secret, limits.pbkdf2Iterations);
  // 失败在占位时已经记过
  if (!v.ok) throw badCredentials();

  const session = await newSession(env, db, row.id, limits, now);
  const stmts = [session.stmt, db.stmt('UPDATE users SET last_seen_at = ?1 WHERE id = ?2', now, row.id), clearStatement(db, failKey)];
  if (v.rehash) {
    const h = await hashPassword(env, password, limits.pbkdf2Iterations);
    stmts.push(db.stmt("UPDATE credentials SET secret = ?1 WHERE user_id = ?2 AND type = 'password'", h, row.id));
  }
  await db.batch(stmts);
  const { secret: _, ...user } = row;
  user.last_seen_at = now;
  return withCookies(json(200, { user: userJson(user) }), session.cookies);
}

/** POST /api/auth/logout：任何档位都能退出；停服档不碰 D1，只清 cookie（6.6）。 */
export async function logout(c: Ctx): Promise<Response> {
  if (c.tier !== 'off' && c.sidCookie) {
    const hash = await sessionHashFromCookie(c.env, c.sidCookie);
    if (hash) await c.db.run(c.db.stmt('DELETE FROM sessions WHERE token_hash = ?1', hash));
  }
  return withCookies(noContent(), clearCookies());
}

/**
 * POST /api/auth/recover：设新密码、换新恢复码、注销所有会话，给当前设备发新会话；清零登录失败计数。
 * 不按用户名记失败、不锁：恢复码约 100 bit，按 IP 和全站每小时的上限已经猜不动；
 * 按用户名锁的话，知道用户名的人就能同时锁住登录和找回，"找回能解登录锁"的兜底就没了（维护者 2026-10-14 定）。
 */
export async function recover(c: Ctx): Promise<Response> {
  const { db, env, limits, now } = c;
  const username = normalizeUsername(str(c.body.username));
  const code = normalizeRecoveryCode(str(c.body.recoveryCode));
  const newPassword = normalizePassword(str(c.body.newPassword));
  check(checkPassword(newPassword, username));
  if (!isUsernameFormat(username) || !code) throw badCredentials();

  const ip = await c.ipHash();
  takeAnonToken(ip, limits, now);
  checkHourly(c, 'recover', limits.recoverAllHour);
  await hit(db, `rec:ip:${ip}`, limits.recoverPerIpHour, HOUR, now);

  const row = await db.first<UserRow & { secret: string }>(
    db.stmt(
      `SELECT ${USER_COLUMNS}, c.secret FROM users u
       JOIN credentials c ON c.user_id = u.id AND c.type = 'recovery' WHERE u.username = ?1`,
      username,
    ),
  );
  if (!row) throw badCredentials();
  // 全站名额只算用户名存在的（0.19.2，同登录）；恢复码是 HMAC，不存在时不用白算
  meter.countAnon('recover');
  if (!(await verifyRecoveryCode(env, row.id, code, row.secret))) throw badCredentials();

  const nextCode = newRecoveryCode();
  const pwHash = await hashPassword(env, newPassword, limits.pbkdf2Iterations);
  const rcHash = await hashRecoveryCode(env, row.id, normalizeRecoveryCode(nextCode)!);
  const session = await newSession(env, db, row.id, limits, now);
  const stmts = [
    db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'password'", pwHash, now, row.id),
    db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'recovery'", rcHash, now, row.id),
    db.stmt('DELETE FROM sessions WHERE user_id = ?1', row.id),
    session.stmt,
    db.stmt('UPDATE users SET last_seen_at = ?1 WHERE id = ?2', now, row.id),
    // 被人故意锁住的号找回之后要能登上（5.1）；没有这行时删除写 0 行
    clearStatement(db, `login:fail:${username}`),
  ];
  await db.batch(stmts);
  const { secret: _, ...user } = row;
  user.last_seen_at = now;
  return withCookies(json(200, { user: userJson(user), recoveryCode: nextCode }), session.cookies);
}
