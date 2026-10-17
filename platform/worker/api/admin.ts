/**
 * 管理接口 /api/admin/*：测试期是邀请制，账号由管理员建（维护者 2026-10-14 定）。
 *
 * 两种调用方：
 * - 管理命令行工具（tools/admin.ts）：请求头 Authorization: Bearer <ADMIN_TOKEN>，不要 X-Arcade 和 Origin；
 *   令牌对不上按 IP 和全站每小时计数，超了 429（见 bearerAuth）。只有它能建管理员、能动管理员账号。
 * - 平台页 /admin：当前会话是管理员，写请求照常要 X-Arcade 和 Origin。只能动普通账号：
 *   偷到管理员 cookie 的人改不了管理员的密码，也删不掉管理员。
 *
 * 写入都记在"账号安全"类；每个管理员（令牌算一个）每天最多 adminPerDay 次写操作，只算成功的。
 */
import { check, checkUsernameFree, insertUser, str } from './auth';
import { type Ctx, DAY, HOUR } from './context';
import { hashPassword, hashRecoveryCode, newRecoveryCode, newUserId, normalizeRecoveryCode } from './crypto';
import { ApiError, json, noContent, rateLimited } from './http';
import { meter } from './meter';
import { checkCached, clearStatement, dailyCapStatement, hit, peek, remember, takeAnonToken } from './ratelimit';
import { deleteUserStatements, type UserRow } from './session';
import { NOTICE_MAX, readNotice, readRegistrationSwitch, registrationForcedOff, rememberNotice, rememberRegistration, setNoticeStatement, setRegistrationStatement } from './settings';
import { DEFAULT_RULES } from './wallet';
import { planRulesChange, readRulesRow, rememberRules, RULE_RANGE } from './wallet-store';
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  normalizeDisplayName,
  normalizePassword,
  normalizeUsername,
} from './validate';
import { readablePassword } from './words';

const enc = new TextEncoder();

/** 请求头格式：Bearer 后面一个空格，令牌只能是可见 ASCII，最长 256。 */
const BEARER = /^Bearer ([\x21-\x7e]{1,256})$/;

/** 比对了几次令牌。只给测试断言"并发时比对次数有上限"用（同一 isolate 里读得到）。 */
export const tokenComparisons = { count: 0 };

/**
 * 常量时间比较：先各算 SHA-256 再比，长度不同也不会提前返回。
 * ADMIN_TOKEN 没设或不像 "<kid>:<随机串>"（随机串至少 16 个字符）时谁都不认。
 */
async function tokenMatches(env: Ctx['env'], given: string): Promise<boolean> {
  tokenComparisons.count++;
  const want = env.ADMIN_TOKEN;
  if (!want || !/^[^:]+:.{16,}$/.test(want)) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(want))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Bearer 认证。令牌比对前先占一个"失败名额"，比对成功再还回去，所以比对次数有硬上限，也不给"对 / 错"两种不同的限流信号：
 * 1. 只读档、账号安全类预算用完：不比对，回 503 / 429，写 0 行（失败计数写不进去时就不给猜，审阅 2026-10-14）；
 * 2. 先只读查全站和这个 IP 这小时的计数，任何一个满了就 429、不比对、写 0 行；
 * 3. 两个计数各 +1（带条件 UPSERT，满了 0 行写入、抛 429）：并发打进来的请求在这里排队，最多放过上限那么多次比对；
 * 4. 比对：对了把两个名额还回去（共写 4 行），错了名额留着就是失败记录（写 2 行），回 401。请求头格式不对也算错。
 * 全站满了以后，对的令牌也是 429：这时多半有人在猜，维护者的工具等一小时或改用管理员会话。
 */
export async function bearerAuth(c: Ctx): Promise<void> {
  const { db, limits, now } = c;
  const ip = await c.ipHash();
  takeAnonToken(ip, limits, now);
  if (c.tier !== 'normal' && c.tier !== 'noGrowth') throw new ApiError(503, 'busy');
  if (meter.exhausted('acct', limits, now)) throw rateLimited(DAY - (now % DAY));
  const keys: [string, number][] = [
    [`admin:fail:${ip}`, limits.adminFailPerIpHour],
    ['admin:fail:all', limits.adminFailAllHour],
  ];
  checkCached(keys.map(([k]) => k), now);
  const hourEnd = now - (now % HOUR) + HOUR;
  for (const [key, limit] of keys) {
    if ((await peek(db, key, HOUR, now)) >= limit) {
      remember(key, hourEnd);
      throw rateLimited(hourEnd - now);
    }
  }
  for (const [key, limit] of keys) await hit(db, key, limit, HOUR, now);

  const m = BEARER.exec(c.request.headers.get('authorization') ?? '');
  if (!m || !(await tokenMatches(c.env, m[1]!))) throw new ApiError(401, 'unauthorized');
  const start = now - (now % HOUR);
  await db.batch(
    keys.map(([key]) =>
      db.stmt('UPDATE rate_counters SET count = count - 1 WHERE key = ?1 AND window_start = ?2 AND count > 0', key, start),
    ),
  );
  c.admin = { by: 'token' };
}

/** 会话认证：要登录，而且是管理员。 */
export function sessionAdmin(c: Ctx): void {
  const user = c.session!.user;
  if (user.role !== 'admin') throw new ApiError(403, 'not_admin');
  c.admin = { by: 'session', userId: user.id };
}

/** 每个管理员每天的写操作上限：先只读查（超了不算哈希），成功后随 batch 计数（1 行）。 */
async function checkAdminCap(c: Ctx): Promise<D1PreparedStatement> {
  const key = c.admin!.by === 'token' ? 'admin:token' : `admin:${c.admin!.userId}`;
  return dailyCapStatement(c.db, key, c.limits.adminPerDay, c.now);
}

/** 给管理员看的用户信息：比本人看到的少（没有好友码、头像），多了角色和最近登录时间。 */
function adminUserJson(u: Pick<UserRow, 'id' | 'username' | 'display_name' | 'role' | 'created_at' | 'last_seen_at'>) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
  };
}

/** 没给密码就生成一个好记的；给了就和注册一样校验。返回密码和"是不是生成的"。 */
function passwordFrom(body: Record<string, unknown>, username: string): { password: string; generated: boolean } {
  if (body.password === undefined || body.password === null || body.password === '') {
    // 生成的密码几乎不可能撞上弱密码表或包含用户名，撞上就再来一个
    for (;;) {
      const password = readablePassword();
      if (checkPassword(password, username) === 'ok') return { password, generated: true };
    }
  }
  const password = normalizePassword(str(body.password));
  check(checkPassword(password, username));
  return { password, generated: false };
}

/** 读要操作的账号；会话管理员不能动管理员账号（包括自己）。 */
async function loadTarget(c: Ctx): Promise<UserRow> {
  const u = await c.db.first<UserRow>(
    c.db.stmt(
      'SELECT id, username, display_name, friend_code, avatar_json, catchphrase_id, created_at, last_seen_at, role, presence_at, show_where, show_feed FROM users WHERE id = ?1',
      c.params.userId,
    ),
  );
  if (!u) throw new ApiError(404, 'not_found');
  if (c.admin!.by === 'session' && u.role === 'admin') throw new ApiError(403, 'admin_protected');
  return u;
}

/** GET /api/admin/users：按创建时间倒序，最多 adminListMax 条。只读。 */
export async function listUsers(c: Ctx): Promise<Response> {
  // 0.10.7：顺带每人的钱包摘要（余额、桌上的、各游戏上桌次数），没有钱包的 balance 是 null。读的行数多一倍（钱包各 1 行）
  const rows = await c.db.all<UserRow & { balance: number | null; on_table: number; played: string | null }>(
    c.db.stmt(
      `SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.last_seen_at,
         json_extract(w.state, '$.balance') AS balance,
         (SELECT COALESCE(SUM(json_extract(s.value, '$.amount')), 0) FROM json_each(w.state, '$.stakes') AS s) AS on_table,
         (SELECT json_group_object(g.key, json_extract(g.value, '$.n')) FROM json_each(w.state, '$.career') AS g) AS played
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id
       ORDER BY u.created_at DESC, u.id LIMIT ?1`,
      c.limits.adminListMax,
    ),
  );
  return json(200, {
    users: rows.map((r) => ({
      ...adminUserJson(r),
      wallet: { balance: r.balance, onTable: r.on_table, played: r.played ? (JSON.parse(r.played) as Record<string, number>) : {} },
    })),
  });
}

/**
 * POST /api/admin/users：建号，不看注册开关，校验和注册一样。写 6 行：users 3（本行 + 两个唯一索引）、密码、恢复码、每日计数；
 * 用令牌调时另有认证的 4 行（bearerAuth）。
 * 不建会话（是管理员替别人建）。生成的密码和恢复码只在这次返回。
 */
export async function createUser(c: Ctx): Promise<Response> {
  const username = normalizeUsername(str(c.body.username));
  const displayName = normalizeDisplayName(str(c.body.displayName));
  check(checkUsername(username));
  check(checkDisplayName(displayName));
  const role = c.body.role === undefined || c.body.role === 'user' ? 'user' : c.body.role === 'admin' ? 'admin' : null;
  if (!role) throw new ApiError(400, 'bad_request');
  if (role === 'admin' && c.admin!.by !== 'token') throw new ApiError(403, 'admin_protected');
  const { password, generated } = passwordFrom(c.body, username);

  const cap = await checkAdminCap(c);
  await checkUsernameFree(c, username);
  const { user, recoveryCode } = await insertUser(c, { userId: newUserId(), username, displayName, password, role }, [cap]);
  return json(201, { user: adminUserJson(user), ...(generated ? { password } : {}), recoveryCode });
}

/**
 * POST /api/admin/users/<id>/password：重设密码，这个人的所有会话失效，登录和再验证的失败计数清零。
 * newRecoveryCode 为 true 时顺便换恢复码。写入：密码 1 行 + 会话 n 行 + 失败计数 0–2 行 + 每日计数 1 行（+ 恢复码 1 行）。
 */
export async function resetPassword(c: Ctx): Promise<Response> {
  const { db, env, limits, now } = c;
  const target = await loadTarget(c);
  const { password, generated } = passwordFrom(c.body, target.username);
  const withCode = c.body.newRecoveryCode === true;
  if (c.body.newRecoveryCode !== undefined && typeof c.body.newRecoveryCode !== 'boolean') throw new ApiError(400, 'bad_request');

  const cap = await checkAdminCap(c);
  const pwHash = await hashPassword(env, password, limits.pbkdf2Iterations);
  const stmts = [
    db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'password'", pwHash, now, target.id),
    db.stmt('DELETE FROM sessions WHERE user_id = ?1', target.id),
    // 被人故意锁住的号重设后要能马上登上
    clearStatement(db, `login:fail:${target.username}`),
    clearStatement(db, `reauth:fail:${target.id}`),
    cap,
  ];
  let recoveryCode: string | undefined;
  if (withCode) {
    recoveryCode = newRecoveryCode();
    const rcHash = await hashRecoveryCode(env, target.id, normalizeRecoveryCode(recoveryCode)!);
    stmts.push(
      db.stmt("UPDATE credentials SET secret = ?1, created_at = ?2 WHERE user_id = ?3 AND type = 'recovery'", rcHash, now, target.id),
    );
  }
  await db.batch(stmts);
  return json(200, { ...(generated ? { password } : {}), ...(recoveryCode ? { recoveryCode } : {}) });
}

/**
 * POST /api/admin/users/<id>/delete：和本人注销删得一样干净（7.3），再加每日计数 1 行。
 * 不能删自己（会话管理员本来就动不了管理员），不能删最后一个管理员。
 * "最后一个"是先查再删：只有命令行工具能删管理员，一个人用，不考虑两个请求同时删最后两个的情况。
 */
export async function deleteUser(c: Ctx): Promise<Response> {
  const { db } = c;
  if (c.admin!.by === 'session' && c.params.userId === c.admin!.userId) throw new ApiError(409, 'cannot_delete_self');
  const target = await loadTarget(c);
  if (target.role === 'admin') {
    const row = await db.first<{ n: number }>(db.stmt("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"));
    if ((row?.n ?? 0) <= 1) throw new ApiError(409, 'last_admin');
  }
  const cap = await checkAdminCap(c);
  await db.batch([...deleteUserStatements(db, target.id, target.username), cap]);
  return noContent();
}

/** 注册开关的现状：总闸、D1 里的开关、实际开没开、最后修改时间。 */
async function registrationState(c: Ctx) {
  const forcedOff = registrationForcedOff(c.env);
  const { open, updatedAt } = await readRegistrationSwitch(c.db);
  return { open: !forcedOff && open, switchOpen: open, forcedOff, updatedAt };
}

/** GET /api/admin/settings/registration：读 1 行，写 0 行。 */
export async function getRegistration(c: Ctx): Promise<Response> {
  return json(200, await registrationState(c));
}

/**
 * POST /api/admin/settings/registration {open: boolean}：改 D1 里的开关，写 2 行（settings 1 + 每日计数 1）。
 * 总闸关着时也照样记下（等总闸改回 "switch" 时生效），返回里 forcedOff: true，界面据此说明"暂时不起作用"。
 */
export async function setRegistration(c: Ctx): Promise<Response> {
  const open = c.body.open;
  if (typeof open !== 'boolean') throw new ApiError(400, 'bad_request');
  const cap = await checkAdminCap(c);
  await c.db.batch([setRegistrationStatement(c.db, open, c.now), cap]);
  rememberRegistration(open, c.now);
  return json(200, await registrationState(c));
}

/** GET /api/admin/settings/notice（0.10.8）：读 1 行，写 0 行。 */
export async function getNotice(c: Ctx): Promise<Response> {
  return json(200, { notice: await readNotice(c.db), max: NOTICE_MAX });
}

/**
 * POST /api/admin/settings/notice {text}：发公告，空字符串是撤下。写 2 行（settings 1 + 每日计数 1）。
 * 换行和连续空白并成一个空格：大厅只给一行的位置。
 */
export async function setNotice(c: Ctx): Promise<Response> {
  const raw = c.body.text;
  if (typeof raw !== 'string') throw new ApiError(400, 'bad_request');
  const text = raw.replace(/[\s\p{Cc}]+/gu, ' ').trim();
  if (Array.from(text).length > NOTICE_MAX) throw new ApiError(400, 'bad_request', { max: NOTICE_MAX });
  const by = c.session?.user.username ?? '令牌';
  const cap = await checkAdminCap(c);
  await c.db.batch([setNoticeStatement(c.db, text || null, by, c.now), cap]);
  rememberNotice(text ? { text, at: c.now } : null, c.now);
  return json(200, { notice: await readNotice(c.db), max: NOTICE_MAX });
}

/** 钱包规则（0.10.6）：现在的值、默认值、能调的范围、最近 20 次改动。 */
async function walletRulesState(c: Ctx) {
  const { rules, log, updatedAt } = await readRulesRow(c.db);
  return { rules, defaults: DEFAULT_RULES, range: RULE_RANGE, log: [...log].reverse(), updatedAt };
}

/** GET /api/admin/settings/wallet：读 1 行，写 0 行。 */
export async function getWalletRules(c: Ctx): Promise<Response> {
  return json(200, await walletRulesState(c));
}

/**
 * POST /api/admin/settings/wallet {reliefTo?, winUnits?, newBalance?, adminAdjustMax?}：改了即时生效（本 isolate 马上，别的最多 30 秒），不用发版。
 * 有变化时写 2 行（settings 1 + 管理员每日计数 1），没变化 0 行；记下谁、什么时候、从多少改成多少。
 */
export async function setWalletRules(c: Ctx): Promise<Response> {
  const by = c.session?.user.username ?? '令牌';
  const plan = await planRulesChange(c.db, c.body, by, c.now);
  if (plan.stmt) {
    const cap = await checkAdminCap(c);
    await c.db.batch([plan.stmt, cap]);
    rememberRules(plan.rules, c.now);
  }
  return json(200, await walletRulesState(c));
}
