/** 邀请制：关闭注册、管理接口（Bearer 令牌和管理员会话）、游戏登录闸门用的服务绑定请求。 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { tokenComparisons } from '../worker/api/admin';
import { runCleanup } from '../worker/api/cron';
import { resetMeterForTests } from '../worker/api/meter';
import { handleApi } from '../worker/api/router';
import { resetSettingsCacheForTests } from '../worker/api/settings';
import {
  advance,
  call,
  count,
  env,
  errorOf,
  flushMeter,
  GOOD_PASSWORD,
  ORIGIN,
  registerUser,
  resetAll,
  rowsBy,
  rowsRead,
  rowsWritten,
  sidOf,
  uniqueName,
} from './helpers';

beforeEach(() => resetAll());

const TOKEN = `Bearer ${env.ADMIN_TOKEN}`;

/** 换一套 env 直接调入口（测试注册关闭、令牌没设）。 */
async function direct(path: string, e: Env, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', '203.0.113.7');
  const res = await handleApi(new Request(`${ORIGIN}${path}`, { ...init, headers }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

interface Created {
  user: { id: string; username: string; displayName: string; role: string };
  password?: string;
  recoveryCode: string;
}

async function createByToken(body: Record<string, unknown>): Promise<Created> {
  const res = await call('/api/admin/users', { body, authorization: TOKEN, csrf: false });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Created;
}

/** 用令牌建一个管理员并登录，返回它的会话。 */
async function adminSession() {
  const username = uniqueName('admin');
  const created = await createByToken({ username, displayName: '阿国', password: GOOD_PASSWORD, role: 'admin' });
  const res = await call('/api/auth/login', { body: { username, password: GOOD_PASSWORD } });
  return { ...created, username, cookie: sidOf(res)! };
}

let ipSeq = 0;
/** 每次换个 IP：同一个 IP 每分钟只有 10 个匿名令牌，一个用例里登录次数多了会被它挡住。 */
const login = (username: string, password: string) => call('/api/auth/login', { body: { username, password }, ip: `192.0.2.${++ipSeq % 250}` });
/** 往计量表里塞当天的用量（同 meter.test.ts），让本 isolate 下次上报时读回去。 */
async function seedMeter(cols: Record<string, number>): Promise<void> {
  const names = Object.keys(cols);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO meter_hourly (hour, ${names.join(', ')}, updated_at) VALUES (?1, ${names.map((_, i) => `?${i + 2}`).join(', ')}, 0)`,
  )
    .bind(new Date().toISOString().slice(0, 13), ...Object.values(cols))
    .run();
  resetMeterForTests();
}

const meOf = async (cookie: string) => ((await (await call('/api/me', { cookie })).json()) as { user: Record<string, unknown> | null }).user;

describe('关闭注册', () => {
  const closed = { ...env, REGISTRATION: 'closed' };
  const registerInit = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'x-arcade': '1', origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('关闭时 403 registration_closed，写 0 行，不留任何计数；连请求体都不看', async () => {
    const res = await direct('/api/auth/register', closed, registerInit({ username: 'newbie', password: GOOD_PASSWORD, displayName: '新人' }));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('registration_closed');
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
    // 请求体不合格也一样是 403：判断在校验、计数和 PBKDF2 之前
    expect(await errorOf(await direct('/api/auth/register', closed, registerInit({})))).toBe('registration_closed');
  });

  it('总闸只认 "switch"（不分大小写、去空白）：off、没设、写错、旧的 open/closed 都强制关，D1 开着也没用', async () => {
    for (const v of [undefined, '', 'off', 'OFF', 'open', 'closed', 'swich']) {
      const res = await direct('/api/auth/register', { ...env, REGISTRATION: v }, registerInit({ username: uniqueName(), password: GOOD_PASSWORD, displayName: '新人' }));
      expect(res.status, String(v)).toBe(403);
      expect(await (await direct('/api/me', { ...env, REGISTRATION: v })).json(), String(v)).toMatchObject({ registration: 'closed' });
    }
    const res = await direct('/api/auth/register', { ...env, REGISTRATION: ' Switch ' }, registerInit({ username: uniqueName(), password: GOOD_PASSWORD, displayName: '新人' }));
    expect(res.status).toBe(201);
  });

  it('/api/me 带 registration（没登录、登录了都有）', async () => {
    expect(await (await direct('/api/me', closed)).json()).toMatchObject({ user: null, registration: 'closed' });
    resetSettingsCacheForTests();
    expect(await (await call('/api/me')).json()).toMatchObject({ user: null, registration: 'open' });
    const u = await registerUser();
    expect(await (await call('/api/me', { cookie: u.cookie })).json()).toMatchObject({ registration: 'open' });
  });

  it('关闭时登录、找回照常', async () => {
    const u = await registerUser();
    const res = await direct('/api/auth/login', closed, registerInit({ username: u.username, password: u.password }));
    expect(res.status).toBe(200);
  });
});

describe('管理接口：Bearer 令牌', () => {
  it('对的令牌：不要 X-Arcade 和 Origin；认证占名额再还回去，写 4 行，计数归零', async () => {
    await registerUser();
    const res = await call('/api/admin/users', { authorization: TOKEN });
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(4); // 两个失败计数各 +1，比对成功后各 -1
    expect(rowsBy('acct')).toBe(4);
    for (let i = 0; i < 3; i++) expect((await call('/api/admin/users', { authorization: TOKEN })).status).toBe(200);
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM rate_counters WHERE key LIKE 'admin:fail:%'")).toBe(0);
    const { users } = (await res.json()) as { users: Record<string, unknown>[] };
    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]!).sort()).toEqual(['createdAt', 'displayName', 'id', 'lastSeenAt', 'role', 'username', 'wallet']);
  });

  it('格式不对或对不上一律 401，每次写 2 行（全站 + 这个 IP）', async () => {
    const bad = [
      '', 'Bearer', `Bearer  ${env.ADMIN_TOKEN}`, `bearer ${env.ADMIN_TOKEN}`, `Basic ${env.ADMIN_TOKEN}`,
      `Bearer ${env.ADMIN_TOKEN}x`, `Bearer ${env.ADMIN_TOKEN!.slice(0, -1)}`, `Bearer t1:${'x'.repeat(300)}`,
    ];
    for (const h of bad) {
      const res = await call('/api/admin/users', { authorization: h, ip: `198.51.100.${bad.indexOf(h)}` });
      expect(res.status, JSON.stringify(h)).toBe(401);
      expect(await errorOf(res)).toBe('unauthorized');
      // 空的 Authorization 头到不了 Worker（运行时丢掉了），按没带令牌走会话认证：没会话 401，不写
      expect(rowsWritten(), JSON.stringify(h)).toBe(h === '' ? 0 : 2);
      expect(rowsBy('acct')).toBe(h === '' ? 0 : 2);
    }
  });

  it('每个 IP 每小时错 10 次后 429、0 行，连对的令牌也不比；别的 IP 不受影响；过了整点恢复', async () => {
    for (let i = 0; i < 10; i++) expect((await call('/api/admin/users', { authorization: 'Bearer nope' })).status).toBe(401);
    const blocked = await call('/api/admin/users', { authorization: TOKEN });
    expect(blocked.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    // 换了 isolate（内存缓存没了）也是读库里的计数挡住
    await resetAll.cacheOnly();
    expect((await call('/api/admin/users', { authorization: TOKEN })).status).toBe(429);
    expect((await call('/api/admin/users', { authorization: TOKEN, ip: '198.51.100.9' })).status).toBe(200);
    advance(60 * 60_000);
    expect((await call('/api/admin/users', { authorization: TOKEN })).status).toBe(200);
  });

  it('全站每小时的失败名额满了：换新 IP、用对的令牌也是 429、0 行，不比对（错和对看不出区别）', async () => {
    await resetAll.limits({ adminFailAllHour: 3 });
    for (let i = 0; i < 3; i++) expect((await call('/api/admin/users', { authorization: 'Bearer nope', ip: `198.51.100.${i}` })).status).toBe(401);
    const wrong = await call('/api/admin/users', { authorization: 'Bearer nope', ip: '198.51.100.50' });
    expect(wrong.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    // 换了 isolate 也一样（读库里的计数）
    await resetAll.cacheOnly();
    const right = await call('/api/admin/users', { authorization: TOKEN, ip: '198.51.100.51' });
    expect(right.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    advance(60 * 60_000);
    expect((await call('/api/admin/users', { authorization: TOKEN, ip: '198.51.100.51' })).status).toBe(200);
  });

  it('并发打进来一批错令牌：比对次数不超过全站名额', async () => {
    await resetAll.limits({ adminFailAllHour: 5 });
    tokenComparisons.count = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => call('/api/admin/users', { authorization: 'Bearer nope', ip: `198.51.100.${100 + i}` })),
    );
    const statuses = results.map((r) => r.status);
    expect(tokenComparisons.count).toBeLessThanOrEqual(5);
    expect(statuses.filter((x) => x === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.every((x) => x === 401 || x === 429)).toBe(true);
    expect(await count("SELECT count AS n FROM rate_counters WHERE key = 'admin:fail:all'")).toBe(5);
  });

  it('账号安全类预算用完：令牌一律不比对，429、0 行（GET 也不例外）；管理员会话照常能看列表', async () => {
    const a = await adminSession();
    await seedMeter({ rows_acct: 2_000 });
    for (const authorization of ['Bearer nope', TOKEN]) {
      const res = await call('/api/admin/users', { authorization, ip: '198.51.100.60' });
      expect(res.status, authorization).toBe(429);
      expect(rowsWritten()).toBe(0);
    }
    expect((await call('/api/admin/users', { cookie: a.cookie })).status).toBe(200);
  });

  it('只读档：令牌请求 503、0 行（认证本身要写计数）', async () => {
    const res = await direct('/api/admin/users', { ...env, API_MODE: 'readonly' }, { headers: { authorization: TOKEN } });
    expect(res.status).toBe(503);
    expect(rowsWritten()).toBe(0);
  });

  it('ADMIN_TOKEN 没设或格式不对：谁都不认', async () => {
    for (const t of [undefined, '', 'no-colon-here-0123456789', 't1:short']) {
      const res = await direct('/api/admin/users', { ...env, ADMIN_TOKEN: t }, { headers: { authorization: `Bearer ${t ?? ''}` } });
      expect(res.status, String(t)).toBe(401);
    }
  });

  it('Bearer 只对管理接口有效：别的写接口照样要 X-Arcade 和 Origin', async () => {
    const res = await call('/api/auth/logout', { body: {}, authorization: TOKEN, csrf: false });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('forbidden');
  });

  it('建号绕过注册开关', async () => {
    const res = await direct('/api/admin/users', { ...env, REGISTRATION: 'closed' }, {
      method: 'POST',
      headers: { authorization: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'invited', displayName: '受邀的人' }),
    });
    expect(res.status).toBe(201);
  });
});

describe('管理接口：会话', () => {
  it('没登录 401；普通用户 403 not_admin；都不写', async () => {
    expect((await call('/api/admin/users')).status).toBe(401);
    const u = await registerUser();
    const res = await call('/api/admin/users', { cookie: u.cookie });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('not_admin');
    const post = await call('/api/admin/users', { body: { username: 'x_user', displayName: '某人' }, cookie: u.cookie });
    expect(await errorOf(post)).toBe('not_admin');
    expect(rowsWritten()).toBe(0);
  });

  it('管理员会话的写请求照常要 X-Arcade 和 Origin', async () => {
    const a = await adminSession();
    const res = await call('/api/admin/users', { body: { username: 'x_user', displayName: '某人' }, cookie: a.cookie, csrf: false });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('forbidden');
    expect((await call('/api/admin/users', { body: { username: 'x_user', displayName: '某人' }, cookie: a.cookie, origin: 'https://evil.test' })).status).toBe(403);
  });

  it('/api/me：管理员带 isAdmin: true，普通用户没有这个字段', async () => {
    const a = await adminSession();
    expect(await meOf(a.cookie)).toMatchObject({ isAdmin: true });
    const u = await registerUser();
    expect(await meOf(u.cookie)).not.toHaveProperty('isAdmin');
  });
});

describe('建号', () => {
  it('不给密码：生成好记的密码（3 个词 + 2 位数字，≥ 12 位），只返回这一次；写 6 行', async () => {
    const r = await createByToken({ username: 'Friend_One', displayName: ' 小明 ' });
    // users 3（本行 + 用户名、好友码两个唯一索引，同注册，7.2）+ 密码 1 + 恢复码 1 + 每日计数 1，令牌认证另 4
    expect(rowsWritten()).toBe(10);
    expect(rowsBy('acct')).toBe(10);
    expect(r.user).toMatchObject({ username: 'friend_one', displayName: '小明', role: 'user' });
    expect(r.password).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
    expect(r.password!.length).toBeGreaterThanOrEqual(12);
    expect(r.recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    // 不建会话，不碰注册计数
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'reg:%'")).toBe(0);
    const res = await login('friend_one', r.password!);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).not.toHaveProperty('user.isAdmin');
    // 恢复码也能用
    const rec = await call('/api/auth/recover', { body: { username: 'friend_one', recoveryCode: r.recoveryCode, newPassword: 'Another-Pass-77' } });
    expect(rec.status).toBe(200);
  });

  it('生成的密码每次不一样', async () => {
    const a = await createByToken({ username: 'p_one', displayName: '甲甲' });
    const b = await createByToken({ username: 'p_two', displayName: '乙乙' });
    expect(a.password).not.toBe(b.password);
  });

  it('给了密码：不回显；校验和注册一样', async () => {
    const r = await createByToken({ username: 'given_pw', displayName: '有密码', password: GOOD_PASSWORD });
    expect(r).not.toHaveProperty('password');
    expect((await login('given_pw', GOOD_PASSWORD)).status).toBe(200);
    const bad = async (body: Record<string, unknown>) => {
      const res = await call('/api/admin/users', { body, authorization: TOKEN, csrf: false });
      expect(rowsWritten()).toBe(4); // 只有令牌认证的 4 行，业务一行不写
      return [res.status, await errorOf(res)];
    };
    expect(await bad({ username: 'weak_one', displayName: '弱密码', password: 'iloveyou' })).toEqual([422, 'weak_password']);
    expect(await bad({ username: 'ab', displayName: '短名' })).toEqual([422, 'invalid_username']);
    expect(await bad({ username: 'ok_name', displayName: 'x' })).toEqual([422, 'invalid_display_name']);
    expect(await bad({ username: 'given_pw', displayName: '重名' })).toEqual([409, 'username_taken']);
    expect(await bad({ username: 'role_bad', displayName: '角色', role: 'root' })).toEqual([400, 'bad_request']);
    expect(await bad({ displayName: '没用户名' })).toEqual([400, 'bad_request']);
  });

  it("role: 'admin' 只有令牌能建；会话管理员建普通用户可以，建管理员 403、0 行", async () => {
    const a = await adminSession();
    const ok = await call('/api/admin/users', { body: { username: 'by_session', displayName: '会话建的' }, cookie: a.cookie });
    expect(ok.status).toBe(201);
    expect(rowsWritten()).toBe(6);
    const no = await call('/api/admin/users', { body: { username: 'evil_admin', displayName: '冒充', role: 'admin' }, cookie: a.cookie });
    expect(no.status).toBe(403);
    expect(await errorOf(no)).toBe('admin_protected');
    expect(rowsWritten()).toBe(0);
  });
});

describe('重设密码', () => {
  it('所有会话失效、旧密码作废、登录锁清零；不给就生成；写 1 + 会话数 + 1 + 1 行', async () => {
    const a = await adminSession();
    const u = await registerUser();
    const other = sidOf(await login(u.username, u.password))!;
    // 被人故意输错锁住
    for (let i = 0; i < 5; i++) await login(u.username, 'Wrong-Pass-1');
    expect((await login(u.username, u.password)).status).toBe(429);

    const res = await call(`/api/admin/users/${u.user.id}/password`, { body: {}, cookie: a.cookie });
    expect(res.status).toBe(200);
    // 改密码 1 + 删 2 个会话 + 清 login:fail 1 + 每日计数 1；reauth:fail 没有，删 0 行
    expect(rowsWritten()).toBe(5);
    const { password, recoveryCode } = (await res.json()) as { password: string; recoveryCode?: string };
    expect(password).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
    expect(recoveryCode).toBeUndefined();
    expect(await meOf(u.cookie)).toBeNull();
    expect(await meOf(other)).toBeNull();
    expect((await login(u.username, u.password)).status).toBe(401);
    expect((await login(u.username, password)).status).toBe(200);
    // 恢复码没换
    expect((await call('/api/auth/recover', { body: { username: u.username, recoveryCode: u.recoveryCode, newPassword: 'Another-Pass-77' } })).status).toBe(200);
  });

  it('给了密码不回显；newRecoveryCode: true 同时换恢复码（多写 1 行），旧码作废', async () => {
    const u = await registerUser();
    const res = await call(`/api/admin/users/${u.user.id}/password`, {
      body: { password: 'Chosen-Pass-55', newRecoveryCode: true },
      authorization: TOKEN,
      csrf: false,
    });
    expect(res.status).toBe(200);
    // 密码 1 + 会话 1 + 每日计数 1 + 恢复码 1（没有失败计数，删 0 行），令牌认证另 4
    expect(rowsWritten()).toBe(8);
    const body = (await res.json()) as { password?: string; recoveryCode: string };
    expect(body.password).toBeUndefined();
    expect((await call('/api/auth/recover', { body: { username: u.username, recoveryCode: u.recoveryCode, newPassword: 'Another-Pass-77' } })).status).toBe(401);
    expect((await call('/api/auth/recover', { body: { username: u.username, recoveryCode: body.recoveryCode, newPassword: 'Another-Pass-77' } })).status).toBe(200);
  });

  it('会话管理员动不了管理员（包括自己）；令牌可以', async () => {
    const a = await adminSession();
    const b = await createByToken({ username: 'admin_two', displayName: '二号', role: 'admin' });
    for (const id of [a.user.id, b.user.id]) {
      const res = await call(`/api/admin/users/${id}/password`, { body: {}, cookie: a.cookie });
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toBe('admin_protected');
      expect(rowsWritten()).toBe(0);
    }
    expect((await call(`/api/admin/users/${b.user.id}/password`, { body: {}, authorization: TOKEN, csrf: false })).status).toBe(200);
  });

  it('没有这个人、id 格式不对：404；弱密码 422；都不写', async () => {
    const a = await adminSession();
    expect((await call(`/api/admin/users/${'A'.repeat(22)}/password`, { body: {}, cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/admin/users/bad.id/password', { body: {}, cookie: a.cookie })).status).toBe(404);
    const u = await registerUser();
    expect(await errorOf(await call(`/api/admin/users/${u.user.id}/password`, { body: { password: 'iloveyou' }, cookie: a.cookie }))).toBe('weak_password');
    expect(await errorOf(await call(`/api/admin/users/${u.user.id}/password`, { body: { newRecoveryCode: 'yes' }, cookie: a.cookie }))).toBe('bad_request');
    expect(rowsWritten()).toBe(0);
  });
});

describe('删号', () => {
  it('和本人注销删得一样干净，再加每日计数 1 行', async () => {
    const a = await adminSession();
    const u = await registerUser();
    expect((await call('/api/saves/kaipan/main', { method: 'PUT', body: { data: { a: 1 }, baseRev: 0 }, cookie: u.cookie })).status).toBe(200);
    const res = await call(`/api/admin/users/${u.user.id}/delete`, { body: {}, cookie: a.cookie });
    expect(res.status).toBe(204);
    for (const t of ['users WHERE id', 'sessions WHERE user_id', 'credentials WHERE user_id', 'saves WHERE user_id']) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${t} = ?1`, u.user.id), t).toBe(0);
    }
    // 实测：users 1 + 凭证 2 + 会话 1 + 存档 1 + save 计数 1 + 每日计数 1（删除时索引不另计）
    expect(rowsWritten()).toBe(7);
    expect((await login(u.username, u.password)).status).toBe(401);
  });

  it('不能删自己；会话管理员删不了别的管理员；令牌删不了最后一个管理员', async () => {
    const a = await adminSession();
    const self = await call(`/api/admin/users/${a.user.id}/delete`, { body: {}, cookie: a.cookie });
    expect(self.status).toBe(409);
    expect(await errorOf(self)).toBe('cannot_delete_self');
    const b = await createByToken({ username: 'admin_two', displayName: '二号', role: 'admin' });
    expect(await errorOf(await call(`/api/admin/users/${b.user.id}/delete`, { body: {}, cookie: a.cookie }))).toBe('admin_protected');
    expect(rowsWritten()).toBe(0);

    const asToken = (id: string) => call(`/api/admin/users/${id}/delete`, { body: {}, authorization: TOKEN, csrf: false });
    expect((await asToken(b.user.id)).status).toBe(204);
    const last = await asToken(a.user.id);
    expect(last.status).toBe(409);
    expect(await errorOf(last)).toBe('last_admin');
    expect(rowsWritten()).toBe(4); // 只有令牌认证的 4 行
  });
});

describe('每日上限', () => {
  it('每个管理员每天写操作超了 429、0 行；只算成功的；列表不算；令牌单独算', async () => {
    await resetAll.limits({ adminPerDay: 2 });
    const a = await adminSession(); // 令牌已用 1 次
    const mk = (n: string) => call('/api/admin/users', { body: { username: n, displayName: '某人' }, cookie: a.cookie });
    expect((await mk('cap_one')).status).toBe(201);
    expect((await call('/api/admin/users', { body: { username: 'cap_one', displayName: '重名' }, cookie: a.cookie })).status).toBe(409);
    expect((await mk('cap_two')).status).toBe(201);
    const over = await mk('cap_three');
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    expect((await call('/api/admin/users', { cookie: a.cookie })).status).toBe(200);
    expect((await createByToken({ username: 'tok_one', displayName: '令牌' })).user.username).toBe('tok_one');
    advance(24 * 60 * 60_000);
    expect((await mk('cap_three')).status).toBe(201);
  });
});

describe('列表', () => {
  it('按创建时间倒序，最多 adminListMax 条', async () => {
    await resetAll.limits({ adminListMax: 3 });
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push((await registerUser(undefined, undefined, `198.51.100.${i}`)).username);
      advance(1000);
    }
    const { users } = (await (await call('/api/admin/users', { authorization: TOKEN })).json()) as { users: { username: string }[] };
    expect(users.map((u) => u.username)).toEqual(names.slice(1).reverse());
  });
});

describe('Cron 不清管理员', () => {
  it('一年没登录的普通用户会被清，管理员不会', async () => {
    const a = await adminSession();
    const u = await registerUser();
    advance(366 * 24 * 60 * 60_000);
    await runCleanup(env, Date.now());
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', u.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', a.user.id)).toBe(1);
  });
});

describe('游戏登录闸门：服务绑定调 /api/me', () => {
  /**
   * 模拟游戏 Worker 经服务绑定转发的请求：地址写正式域名，只带玩家的 Cookie（整串原样转发，里面有别的 cookie）
   * 和 cf-connecting-ip，不带 Origin、X-Arcade。走 Worker 入口，和线上一样经过计量。
   */
  const gate = (cookie: string | null, host = 'game.test') => {
    const headers = new Headers({ 'cf-connecting-ip': '198.51.100.77' });
    if (cookie !== null) headers.set('cookie', `kaipan.x=1; __Host-sid=${cookie}; __Host-arcade_li=1`);
    return exports.default.fetch(`https://${host}/api/me`, { headers });
  };

  it('登录着：200 且 user 不为空；没登录、会话失效：200 且 user 为 null', async () => {
    const u = await registerUser();
    const ok = await gate(u.cookie);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { user: { id: string } }).user.id).toBe(u.user.id);
    const anon = await gate(null);
    expect(((await anon.json()) as { user: unknown }).user).toBeNull();
    expect(rowsWritten()).toBe(0);
    expect(((await (await gate('bogus')).json()) as { user: unknown }).user).toBeNull();
  });

  it('Host 不是正式域名：404（游戏要写对地址）', async () => {
    const u = await registerUser();
    expect((await gate(u.cookie, 'arcade.example.workers.dev')).status).toBe(404);
  });

  it('照常计量：一次闸门检查算 1 次调用', async () => {
    const u = await registerUser();
    await flushMeter();
    const before = await count('SELECT SUM(requests) AS n FROM meter_hourly');
    expect((await gate(u.cookie)).status).toBe(200);
    await flushMeter();
    expect((await count('SELECT SUM(requests) AS n FROM meter_hourly')) - before).toBe(1);
  });

  it('停服档：503，游戏据此回 503 页（fail-closed）', async () => {
    const res = await direct('/api/me', { ...env, API_MODE: 'off' }, { headers: { 'cf-connecting-ip': '198.51.100.77' } });
    expect(res.status).toBe(503);
  });
});

describe('注册开关（D1，0.8.0）', () => {
  const regBody = () => ({ username: uniqueName(), password: GOOD_PASSWORD, displayName: '新人' });
  const register = () => call('/api/auth/register', { body: regBody() });
  const meReg = async () => ((await (await call('/api/me')).json()) as { registration: string }).registration;
  const setRow = (value: string | null) =>
    value === null
      ? env.DB.prepare("DELETE FROM settings WHERE key = 'registration'").run()
      : env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = 'registration'").bind(value).run();
  const state = (u: { cookie: string }) => call('/api/admin/settings/registration', { cookie: u.cookie });
  const toggle = (u: { cookie: string }, open: unknown) => call('/api/admin/settings/registration', { body: { open }, cookie: u.cookie });

  it('开着：能注册，/api/me 是 open；关着、没有这一行：403、0 行，/api/me 是 closed', async () => {
    expect((await register()).status).toBe(201);
    expect(await meReg()).toBe('open');
    for (const v of ['closed', null]) {
      await setRow(v);
      resetSettingsCacheForTests();
      const res = await register();
      expect([res.status, await errorOf(res)], String(v)).toEqual([403, 'registration_closed']);
      expect(rowsWritten()).toBe(0);
      expect(await meReg()).toBe('closed');
    }
  });

  it('注册时读最新值：别的 isolate 刚关掉，本 isolate 的 /api/me 缓存还说 open，注册也已经 403；30 秒后 /api/me 跟上', async () => {
    expect(await meReg()).toBe('open');
    await setRow('closed');
    expect(await meReg()).toBe('open');
    expect(await errorOf(await register())).toBe('registration_closed');
    // 注册那次读到的新值也顺手更新了缓存
    expect(await meReg()).toBe('closed');
    await setRow('open');
    expect(await meReg()).toBe('closed');
    advance(30_000);
    expect(await meReg()).toBe('open');
  });

  it('管理员（会话）看和改：改一次写 2 行（开关 1 + 每日计数 1），/api/me 马上跟着变，带最后修改时间', async () => {
    const admin = await adminSession();
    await setRow(null);
    resetSettingsCacheForTests();
    expect(await (await state(admin)).json()).toEqual({ open: false, switchOpen: false, forcedOff: false, updatedAt: null });
    expect(rowsWritten()).toBe(0);
    advance(5_000);
    const on = await toggle(admin, true);
    expect(await on.json()).toEqual({ open: true, switchOpen: true, forcedOff: false, updatedAt: Date.now() });
    expect(rowsWritten()).toBe(2);
    expect(rowsBy('acct')).toBe(2);
    expect(await meReg()).toBe('open');
    expect((await register()).status).toBe(201);
    expect(await (await toggle(admin, false)).json()).toMatchObject({ open: false, switchOpen: false });
    expect(await meReg()).toBe('closed');
    expect((await register()).status).toBe(403);
  });

  it('命令行工具的令牌也能改；普通用户 403 not_admin；没登录 401；open 不是 true/false 400；都写 0 行', async () => {
    const u = await registerUser();
    const res = await call('/api/admin/settings/registration', { body: { open: false }, authorization: TOKEN, csrf: false });
    expect(await res.json()).toMatchObject({ open: false });
    for (const r of [await state(u), await toggle(u, true)]) {
      expect([r.status, await errorOf(r)]).toEqual([403, 'not_admin']);
      expect(rowsWritten()).toBe(0);
    }
    expect((await call('/api/admin/settings/registration', { body: { open: true } })).status).toBe(401);
    const admin = await adminSession();
    for (const bad of ['true', 1, null, undefined]) {
      const r = await toggle(admin, bad);
      expect(r.status, String(bad)).toBe(400);
      expect(rowsWritten()).toBe(0);
    }
    expect(await (await state(admin)).json()).toMatchObject({ open: false, switchOpen: false });
  });

  it('总闸关着：管理接口如实说 forcedOff、实际关着；开关照样能记下，总闸放开后生效', async () => {
    const off = { ...env, REGISTRATION: 'off' };
    const admin = await adminSession();
    const init = (body?: unknown): RequestInit => ({
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-arcade': '1', origin: ORIGIN, cookie: `__Host-sid=${admin.cookie}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(await (await direct('/api/admin/settings/registration', off, init({ open: true }))).json()).toMatchObject({ open: false, switchOpen: true, forcedOff: true });
    expect(await (await direct('/api/me', off)).json()).toMatchObject({ registration: 'closed' });
    expect(await meReg()).toBe('open');
  });

  it('管理员会话改开关：缺 X-Arcade 或 Origin 都是 403，写 0 行，开关不变', async () => {
    const admin = await adminSession();
    const post = (headers: Record<string, string>) =>
      direct('/api/admin/settings/registration', env, {
        method: 'POST',
        headers: { cookie: `__Host-sid=${admin.cookie}`, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ open: false }),
      });
    const variants: Record<string, string>[] = [{ origin: ORIGIN }, { 'x-arcade': '1' }, {}, { 'x-arcade': '1', origin: 'https://evil.test' }];
    for (const h of variants) {
      const res = await post(h);
      expect(res.status, JSON.stringify(h)).toBe(403);
      expect(rowsWritten()).toBe(0);
    }
    expect(await (await state(admin)).json()).toMatchObject({ open: true, switchOpen: true });
  });

  it('错误的 Bearer 调新接口：401，失败计数各加 1（每 IP、全站）', async () => {
    for (const method of ['GET', 'POST'] as const) {
      await resetAll();
      const res = await call('/api/admin/settings/registration', {
        method,
        ...(method === 'POST' ? { body: { open: true } } : {}),
        authorization: 'Bearer t1:wrong-admin-token-0123456789',
        csrf: false,
      });
      expect(res.status, method).toBe(401);
      expect(rowsWritten()).toBe(2);
      expect(await count("SELECT count AS n FROM rate_counters WHERE key = 'admin:fail:all'")).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'admin:fail:%' AND key != 'admin:fail:all' AND count = 1")).toBe(1);
    }
  });

  it('settings 表不存在（读失败）：/api/me 是 closed，注册 403 registration_closed，不是 500；记一行错误日志', async () => {
    await env.DB.prepare('DROP TABLE settings').run();
    const errors = vi.spyOn(console, 'error');
    try {
      resetSettingsCacheForTests();
      expect(await meReg()).toBe('closed');
      const res = await register();
      expect([res.status, await errorOf(res)]).toEqual([403, 'registration_closed']);
      expect(rowsWritten()).toBe(0);
      const logged = errors.mock.calls.filter((c) => c[0] === 'registration switch read failed');
      expect(logged).toHaveLength(1);
      expect(JSON.stringify(logged)).not.toMatch(/sid|password|Correct-Horse/i);
    } finally {
      errors.mockRestore();
      const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0004'))!;
      for (const q of m.queries) await env.DB.prepare(q).run();
    }
  });

  it('只兜读开关这一步：开关读到"开"、后面写库出错，照样 500，不会被当成"注册关着"', async () => {
    await env.DB.prepare("CREATE TRIGGER t_users_fail BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'boom'); END").run();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await register();
      expect([res.status, await errorOf(res)]).toEqual([500, 'internal']);
      expect(errors.mock.calls.some((c) => c[0] === 'registration switch read failed')).toBe(false);
    } finally {
      errors.mockRestore();
      await env.DB.prepare('DROP TRIGGER t_users_fail').run();
    }
  });

  it('注册开着时格式不对（422）也扣内存令牌（有意为之：刷的人不用猜对格式才被限住）', async () => {
    await resetAll({ anonPerIpPerMinute: 2 });
    const bad = { username: uniqueName(), password: '123', displayName: '新人' };
    for (let i = 0; i < 2; i++) expect((await call('/api/auth/register', { body: bad, ip: '198.51.100.31' })).status).toBe(422);
    const res = await call('/api/auth/register', { body: regBody(), ip: '198.51.100.31' });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    expect((await call('/api/auth/register', { body: regBody(), ip: '198.51.100.32' })).status).toBe(201);
  });

  it('注册关着时先过内存令牌桶再读开关：令牌用完后 429，不读 D1', async () => {
    await setRow('closed');
    const init: RequestInit = {
      method: 'POST',
      headers: { 'x-arcade': '1', origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9' },
      body: JSON.stringify(regBody()),
    };
    for (let i = 0; i < 10; i++) expect((await direct('/api/auth/register', env, init)).status).toBe(403);
    expect(rowsRead()).toBeGreaterThan(0);
    const res = await direct('/api/auth/register', env, init);
    expect(res.status).toBe(429);
    expect(rowsRead()).toBe(0);
  });

  it('迁移 0004 在空库上建好表、不带初始数据（没设过按关）', async () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith('0004'));
    expect(m).toBeDefined();
    expect(m!.queries.join('\n')).not.toMatch(/INSERT/i);
    await setRow(null);
    expect(await count('SELECT COUNT(*) AS n FROM settings')).toBe(0);
  });
});
