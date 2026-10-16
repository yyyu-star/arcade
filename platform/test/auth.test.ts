/** 注册、登录、会话、退出、找回、改昵称（docs/platform-backend.md 15.2）；写入行数对照 7.2。 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  count,
  env,
  errorOf,
  GOOD_PASSWORD,
  registerUser,
  resetAll,
  rowsBy,
  rowsWritten,
  sidOf,
  uniqueName,
} from './helpers';

beforeEach(() => resetAll());

describe('通用检查（15.1）', () => {
  it('只认正式域名，别的 Host 一律 404', async () => {
    const res = await call('/api/me', { host: 'arcade.example.workers.dev' });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe('not_found');
  });

  it('没有的路径 404 not_found，方法不对 405', async () => {
    expect(await errorOf(await call('/api/nope'))).toBe('not_found');
    const res = await call('/api/auth/login');
    expect(res.status).toBe(405);
    expect(await errorOf(res)).toBe('method_not_allowed');
    expect((await call('/api/me', { method: 'OPTIONS' })).status).toBe(405);
  });

  it('写请求缺 X-Arcade 或 Origin 不对：403，不碰 D1', async () => {
    const body = { username: 'alice', password: GOOD_PASSWORD, displayName: '小明' };
    for (const res of [
      await call('/api/auth/register', { body, csrf: false }),
      await call('/api/auth/register', { body, origin: 'https://evil.example.com' }),
    ]) {
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toBe('forbidden');
      expect(rowsWritten()).toBe(0);
    }
  });

  it('请求体超过 8 KB：413；不是 JSON 对象：400', async () => {
    const big = await call('/api/auth/login', { rawBody: JSON.stringify({ username: 'a', password: 'x'.repeat(9000) }) });
    expect(big.status).toBe(413);
    expect(await errorOf(big)).toBe('too_large');
    expect((await call('/api/auth/login', { rawBody: '{not json' })).status).toBe(400);
    expect((await call('/api/auth/login', { rawBody: '[1,2]' })).status).toBe(400);
    expect((await call('/api/auth/login', { body: { username: 1, password: 'x' } })).status).toBe(400);
  });

  it('所有响应 no-store，不设 CORS 头', async () => {
    const res = await call('/api/me');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('注册', () => {
  it('201：发两个 cookie、给恢复码，写 9 行（都记在注册类），库里不存明文', async () => {
    const res = await call('/api/auth/register', {
      body: { username: 'Alice_01', password: GOOD_PASSWORD, displayName: '  小  明 ' },
    });
    expect(res.status).toBe(201);
    expect(rowsWritten()).toBe(9);
    expect(rowsBy('reg')).toBe(9);
    const data = (await res.json()) as { user: Record<string, unknown>; recoveryCode: string };
    expect(data.user).toMatchObject({ username: 'alice_01', displayName: '小 明', avatar: null, catchphraseId: null });
    expect(data.user.friendCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(data.recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){3}[0-9A-HJKMNP-TV-Z]{5}$/);

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^__Host-sid=t1\.[\w-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=34560000$/);
    expect(cookies[1]).toBe('__Host-arcade_li=1; Path=/; Secure; SameSite=Lax; Max-Age=34560000');

    const secrets = await env.DB.prepare('SELECT secret FROM credentials').all<{ secret: string }>();
    const all = JSON.stringify(secrets.results) + JSON.stringify(await env.DB.prepare('SELECT * FROM sessions').all());
    expect(all).not.toContain(GOOD_PASSWORD);
    expect(all).not.toContain(data.recoveryCode.replace(/-/g, ''));
    expect(all).not.toContain(sidOf(res)!.slice(3));
  });

  it('422：用户名、弱密码、昵称、保留昵称', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ username: 'a!', password: GOOD_PASSWORD, displayName: '小明' }, 'invalid_username'],
      [{ username: 'alice', password: 'password1', displayName: '小明' }, 'weak_password'],
      [{ username: 'alice', password: GOOD_PASSWORD, displayName: '明' }, 'invalid_display_name'],
      [{ username: 'alice', password: GOOD_PASSWORD, displayName: '老张2' }, 'reserved_display_name'],
    ];
    for (const [body, code] of cases) {
      const res = await call('/api/auth/register', { body });
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toBe(code);
      expect(rowsWritten()).toBe(0);
    }
  });

  it('409：用户名已被占用（大小写、全角不敏感），只写了两个限流计数', async () => {
    await registerUser('bob_1');
    const res = await call('/api/auth/register', { body: { username: 'ＢＯＢ_1', password: GOOD_PASSWORD, displayName: '小红' } });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe('username_taken');
    expect(rowsWritten()).toBe(2);
  });

  it('每个 IP 每天上限：超了 429 带 Retry-After，被拒的请求写 0 行', async () => {
    await resetAll({ regPerIpDay: 2 });
    await registerUser(uniqueName(), GOOD_PASSWORD, '198.51.100.1');
    await registerUser(uniqueName(), GOOD_PASSWORD, '198.51.100.1');
    const res = await call('/api/auth/register', {
      ip: '198.51.100.1',
      body: { username: uniqueName(), password: GOOD_PASSWORD, displayName: '小红' },
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    expect(rowsWritten()).toBe(0);
    // 换个 IP 照样能注册
    await registerUser(uniqueName(), GOOD_PASSWORD, '198.51.100.2');
  });

  it('全站每天上限 reg:all', async () => {
    await resetAll({ regAllDay: 1 });
    await registerUser(uniqueName(), GOOD_PASSWORD, '198.51.100.3');
    const res = await call('/api/auth/register', {
      ip: '198.51.100.4',
      body: { username: uniqueName(), password: GOOD_PASSWORD, displayName: '小红' },
    });
    expect(res.status).toBe(429);
    // reg:all 满了以后换 IP 再来：内存缓存先挡住，连 reg:ip 都不写
    const again = await call('/api/auth/register', {
      ip: '198.51.100.5',
      body: { username: uniqueName(), password: GOOD_PASSWORD, displayName: '小红' },
    });
    expect(again.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('isolate 内存令牌桶：同一 IP 一分钟超过上限直接 429，不碰 D1', async () => {
    await resetAll({ anonPerIpPerMinute: 2 });
    const body = { username: 'nobody_x', password: GOOD_PASSWORD };
    await call('/api/auth/login', { body, ip: '192.0.2.9' });
    await call('/api/auth/login', { body, ip: '192.0.2.9' });
    const res = await call('/api/auth/login', { body, ip: '192.0.2.9' });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });
});

describe('登录', () => {
  it('成功：写 4 行（会话 2 + IP 计数 1 + last_seen_at 1），发新 cookie', async () => {
    const u = await registerUser();
    const res = await call('/api/auth/login', { body: { username: u.username.toUpperCase(), password: u.password } });
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(4);
    expect(rowsBy('auth')).toBe(4);
    expect(sidOf(res)).not.toBe(u.cookie);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(u.user.id);
  });

  it('密码错：401，写 2 行；用户名不存在：401，只写 IP 计数 1 行', async () => {
    const u = await registerUser();
    const bad = await call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' } });
    expect(bad.status).toBe(401);
    expect(await errorOf(bad)).toBe('bad_credentials');
    expect(rowsWritten()).toBe(2);
    const ghost = await call('/api/auth/login', { body: { username: 'ghost_user', password: 'Wrong-Pass-1' } });
    expect(await errorOf(ghost)).toBe('bad_credentials');
    expect(rowsWritten()).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'login:fail:ghost%'")).toBe(0);
  });

  it('连续错 5 次后要等 30 秒：第 6 次 429、不验密码、0 行；到时间后登录成功并清零（5 行）', async () => {
    const u = await registerUser();
    for (let i = 0; i < 5; i++) {
      expect((await call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' } })).status).toBe(401);
    }
    const locked = await call('/api/auth/login', { body: { username: u.username, password: u.password } });
    expect(locked.status).toBe(429);
    const wait = Number(locked.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(25);
    expect(wait).toBeLessThanOrEqual(30);
    expect(rowsWritten()).toBe(0);

    // 模拟时间到了：把锁改到过去，并清掉本 isolate 的缓存
    await env.DB.prepare('UPDATE rate_counters SET blocked_until = 1 WHERE key = ?1').bind(`login:fail:${u.username}`).run();
    await resetAll.cacheOnly();
    const ok = await call('/api/auth/login', { body: { username: u.username, password: u.password } });
    expect(ok.status).toBe(200);
    expect(rowsWritten()).toBe(5);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters WHERE key = ?1', `login:fail:${u.username}`)).toBe(0);
  });

  it('等待时间翻倍：第 6 次失败要等 60 秒，最长 1 小时', async () => {
    await resetAll({ failMaxMs: 90_000 });
    const u = await registerUser();
    const key = `login:fail:${u.username}`;
    const fail = () => call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' } });
    for (let i = 0; i < 5; i++) await fail();
    for (const expected of [60, 90]) {
      await env.DB.prepare('UPDATE rate_counters SET blocked_until = 1 WHERE key = ?1').bind(key).run();
      await resetAll.cacheOnly();
      await fail();
      const row = await env.DB.prepare('SELECT blocked_until FROM rate_counters WHERE key = ?1').bind(key).first<{ blocked_until: number }>();
      expect(row!.blocked_until - Date.now()).toBe(expected * 1000);
    }
  });

  it('登录只看用户名格式：以后才加进保留名的老用户照样能登录', async () => {
    const u = await registerUser();
    await env.DB.prepare("UPDATE users SET username = 'admin' WHERE id = ?1").bind(u.user.id).run();
    expect((await call('/api/auth/login', { body: { username: 'admin', password: u.password } })).status).toBe(200);
  });

  it('锁着的时候并发打进来的错密码不再写行：失败计数最多 failFree 行', async () => {
    const u = await registerUser();
    const fail = (i: number) =>
      call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' }, ip: `192.0.2.${100 + i}` });
    await Promise.all(Array.from({ length: 20 }, (_, i) => fail(i)));
    const row = await env.DB.prepare('SELECT count FROM rate_counters WHERE key = ?1').bind(`login:fail:${u.username}`).first<{ count: number }>();
    expect(row!.count).toBeLessThanOrEqual(5);
  });

  it('锁到期那一刻并发打进来的失败：只有 1 次写进去，随即重新锁上', async () => {
    const u = await registerUser();
    const key = `login:fail:${u.username}`;
    const now = Date.now();
    await env.DB.prepare('INSERT INTO rate_counters (key, window_start, count, blocked_until) VALUES (?1, ?2, 5, ?3)')
      .bind(key, now - 60_000, now - 1)
      .run();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' }, ip: `192.0.2.${150 + i}` }),
      ),
    );
    const row = await env.DB.prepare('SELECT count, blocked_until FROM rate_counters WHERE key = ?1').bind(key).first<{ count: number; blocked_until: number }>();
    expect(row!.count).toBe(6);
    expect(row!.blocked_until).toBeGreaterThan(now);
  });

  it('每个 IP 每小时上限', async () => {
    await resetAll({ loginPerIpHour: 2, anonPerIpPerMinute: 100 });
    const body = { username: 'ghost_user', password: 'Wrong-Pass-1' };
    await call('/api/auth/login', { body, ip: '192.0.2.50' });
    await call('/api/auth/login', { body, ip: '192.0.2.50' });
    const res = await call('/api/auth/login', { body, ip: '192.0.2.50' });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('全站每小时上限（随计量上报）', async () => {
    await resetAll({ loginAllHour: 2, anonPerIpPerMinute: 100 });
    const body = { username: 'ghost_user', password: 'Wrong-Pass-1' };
    await call('/api/auth/login', { body, ip: '192.0.2.61' });
    await call('/api/auth/login', { body, ip: '192.0.2.62' });
    const res = await call('/api/auth/login', { body, ip: '192.0.2.63' });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });
});

describe('会话与 /api/me', () => {
  it('没带 cookie：user 为 null，带 service 和 saves，0 行', async () => {
    const res = await call('/api/me');
    expect(await res.json()).toEqual({ user: null, service: 'ok', saves: 'ok', registration: 'open', notice: null });
    expect(rowsWritten()).toBe(0);
  });

  it('有效会话：返回本人；1 小时内不再写 last_seen_at', async () => {
    const u = await registerUser();
    const res = await call('/api/me', { cookie: u.cookie });
    const data = (await res.json()) as { user: { id: string; username: string } };
    expect(data.user).toMatchObject({ id: u.user.id, username: u.username });
    expect(rowsWritten()).toBe(0);
  });

  it('超过 1 小时：顺带更新 last_seen_at（1 行，记在好友与资料类）', async () => {
    const u = await registerUser();
    await env.DB.prepare('UPDATE users SET last_seen_at = 1 WHERE id = ?1').bind(u.user.id).run();
    await call('/api/me', { cookie: u.cookie });
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('social')).toBe(1);
  });

  it('离上次续期超过 30 天：续期（1 行）并重设 cookie', async () => {
    const u = await registerUser();
    await env.DB.prepare('UPDATE sessions SET renewed_at = 1').run();
    const res = await call('/api/me', { cookie: u.cookie });
    expect(rowsWritten()).toBe(1);
    expect(sidOf(res)).toBe(u.cookie);
    const s = await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>();
    expect(s!.expires_at).toBeGreaterThan(Date.now() + 399 * 86_400_000);
  });

  it('会话无效或过期：user 为 null，并清掉两个 cookie', async () => {
    const u = await registerUser();
    await env.DB.prepare('UPDATE sessions SET expires_at = 1').run();
    for (const cookie of [u.cookie, `t1.${'A'.repeat(43)}`, 'garbage']) {
      const res = await call('/api/me', { cookie });
      expect(((await res.json()) as { user: unknown }).user).toBeNull();
      expect(res.headers.getSetCookie().every((c) => c.includes('Max-Age=0'))).toBe(true);
    }
  });

  it('退出：删会话（实测 1 行）、清 cookie；没登录也 204', async () => {
    const u = await registerUser();
    const res = await call('/api/auth/logout', { body: {}, cookie: u.cookie });
    expect(res.status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('acct')).toBe(1);
    expect(sidOf(res)).toBe('');
    expect(((await (await call('/api/me', { cookie: u.cookie })).json()) as { user: unknown }).user).toBeNull();
    expect((await call('/api/auth/logout', { body: {} })).status).toBe(204);
  });

  it('改昵称：200，写 2 行；保留名 422', async () => {
    const u = await registerUser();
    const res = await call('/api/me', { method: 'PATCH', body: { displayName: '新名字' }, cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { displayName: string } }).user.displayName).toBe('新名字');
    expect(rowsWritten()).toBe(2);
    const bad = await call('/api/me', { method: 'PATCH', body: { displayName: '小美' }, cookie: u.cookie });
    expect(await errorOf(bad)).toBe('reserved_display_name');
    // 麻将的电脑（0.10.9）
    for (const name of ['幺妹儿', '火锅婆婆2']) {
      expect(await errorOf(await call('/api/me', { method: 'PATCH', body: { displayName: name }, cookie: u.cookie })), name).toBe('reserved_display_name');
    }
    expect((await call('/api/me', { method: 'PATCH', body: { displayName: '新名字' } })).status).toBe(401);
  });

  it('后来才加进保留名单的名字不追溯：已经叫"稳哥"的人照常登录、照常显示；改成别的电脑名字才拦', async () => {
    const u = await registerUser();
    await env.DB.prepare('UPDATE users SET display_name = ?1 WHERE id = ?2').bind('稳哥', u.user.id).run();
    const login = await call('/api/auth/login', { body: { username: u.username, password: u.password } });
    expect(login.status).toBe(200);
    const me = (await (await call('/api/me', { cookie: sidOf(login)! })).json()) as { user: { displayName: string } };
    expect(me.user.displayName).toBe('稳哥');
    const bad = await call('/api/me', { method: 'PATCH', body: { displayName: '阿飙' }, cookie: sidOf(login)! });
    expect(await errorOf(bad)).toBe('reserved_display_name');
  });
});

describe('找回密码', () => {
  it('成功：换新密码和新恢复码、旧会话全失效、清零登录失败计数', async () => {
    const u = await registerUser();
    const other = await call('/api/auth/login', { body: { username: u.username, password: u.password } });
    await call('/api/auth/login', { body: { username: u.username, password: 'Wrong-Pass-1' } });

    const res = await call('/api/auth/recover', {
      body: { username: u.username, recoveryCode: u.recoveryCode.toLowerCase(), newPassword: 'Brand-New-Pass-2' },
    });
    expect(res.status).toBe(200);
    // 改两条凭证 2 + 删 2 个会话（各 1 行）+ 新会话 2 + IP 计数 1 + last_seen 1 + 清零登录失败 1
    expect(rowsWritten()).toBe(9);
    const data = (await res.json()) as { recoveryCode: string };
    expect(data.recoveryCode).not.toBe(u.recoveryCode);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'login:fail:%'")).toBe(0);

    for (const cookie of [u.cookie, sidOf(other)!]) {
      expect(((await (await call('/api/me', { cookie })).json()) as { user: unknown }).user).toBeNull();
    }
    expect(((await (await call('/api/me', { cookie: sidOf(res)! })).json()) as { user: unknown }).user).not.toBeNull();
    expect((await call('/api/auth/login', { body: { username: u.username, password: 'Brand-New-Pass-2' } })).status).toBe(200);
    expect((await call('/api/auth/login', { body: { username: u.username, password: u.password } })).status).toBe(401);

    const old = await call('/api/auth/recover', { body: { username: u.username, recoveryCode: u.recoveryCode, newPassword: 'Another-Pass-3' } });
    expect(old.status).toBe(401);
  });

  it('恢复码错：401，只写 IP 计数 1 行，不按用户名锁；按 IP 每小时上限 429；登录不受影响', async () => {
    await resetAll({ recoverPerIpHour: 6, anonPerIpPerMinute: 100 });
    const u = await registerUser();
    const wrong = { username: u.username, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'Brand-New-Pass-2' };
    for (let i = 0; i < 5; i++) {
      expect((await call('/api/auth/recover', { body: wrong, ip: '192.0.2.70' })).status).toBe(401);
      expect(rowsWritten()).toBe(1);
    }
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'rec:fail:%'")).toBe(0);
    // 同一个 IP 第 6 次还能试（用对的码就成功），第 7 次被 IP 上限挡住
    const ok = await call('/api/auth/recover', { body: { ...wrong, recoveryCode: u.recoveryCode }, ip: '192.0.2.70' });
    expect(ok.status).toBe(200);
    const blocked = await call('/api/auth/recover', { body: wrong, ip: '192.0.2.70' });
    expect(blocked.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    expect((await call('/api/auth/login', { body: { username: u.username, password: 'Brand-New-Pass-2' } })).status).toBe(200);
  });

  it('新密码太弱：422，0 行', async () => {
    const u = await registerUser();
    const res = await call('/api/auth/recover', { body: { username: u.username, recoveryCode: u.recoveryCode, newPassword: '12345678' } });
    expect(await errorOf(res)).toBe('weak_password');
    expect(rowsWritten()).toBe(0);
  });
});
