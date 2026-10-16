/**
 * 独立模式（0.10.0，guest.ts）：没绑 ARCADE 时认游客 cookie；绑了 ARCADE 时游客 cookie 一律不认；GATE=login 却没绑 ARCADE 时 fail-closed。
 * 开房进房走测试 Worker 的 /guest/…（没绑 ARCADE）、/guest-login/…（没绑 ARCADE、GATE=login），其余照常（绑了假平台）。
 */
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { identify } from '../src/auth.ts';
import { detectPlatform } from '../src/client.ts';
import { cleanNickname, guestCookieName, guestIdentity, isStandalone, mintGuestCookie, readGuestCookie } from '../src/guest.ts';
import { SESSION_COOKIE } from '../src/internal.ts';
import { CLOSE } from '../src/protocol.ts';
import { DOWN_PAGE, loginGate, standaloneRoot } from '../src/worker.ts';
import { Conn, refusedWith } from './helpers.ts';
import { SITE } from './worker.ts';
import type { WelcomeMsg } from '../src/protocol.ts';

const NAME = '__Host-kit-guest';

function create(prefix: string, cookie: string, query = ''): Promise<Response> {
  return exports.default.fetch(`${SITE}${prefix}/rooms${query}`, { method: 'POST', headers: { origin: SITE, cookie } });
}

function upgrade(prefix: string, code: string, cookie: string, query = ''): Promise<Response> {
  return exports.default.fetch(`${SITE}${prefix}/rooms/${code}/ws?cv=1${query}`, { headers: { upgrade: 'websocket', origin: SITE, cookie } });
}

async function join(code: string, cookie: string, query = '') {
  const res = await upgrade('/guest', code, cookie, query);
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const conn = new Conn(res.webSocket, cookie);
  const welcome = (await conn.next()) as WelcomeMsg;
  expect(welcome.t).toBe('welcome');
  return { conn, welcome };
}

/** Set-Cookie 里的 name=value */
function pair(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

describe('游客 cookie 和身份', () => {
  it('https 用 __Host- 前缀加 Secure、HttpOnly、SameSite=Lax、Path=/、长期；值 32 字节随机；http（本地开发）不带前缀、不带 Secure', () => {
    const r = new Request(`${SITE}/games/x/`);
    const a = mintGuestCookie(r);
    const b = mintGuestCookie(r);
    expect(a.value).not.toBe(b.value);
    expect(a.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.setCookie).toBe(`${NAME}=${a.value}; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax; Secure`);
    const local = mintGuestCookie(new Request('http://192.168.1.2:8787/games/x/'), { cookie: 'mj-guest' });
    expect(local.setCookie).toBe(`mj-guest=${local.value}; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax`);
    expect(guestCookieName(r, { cookie: 'mj-guest' })).toBe('__Host-mj-guest');
    expect(() => guestCookieName(r, { cookie: 'bad name;' })).toThrow();
  });

  it('只认名字完全对、值是 22–64 位 base64url 的；http 的 cookie 在 https 下不认', () => {
    const v = 'A'.repeat(43);
    const req = (cookie: string, url = `${SITE}/x`) => new Request(url, { headers: { cookie } });
    expect(readGuestCookie(req(`a=1; ${NAME}=${v}; b=2`))).toBe(v);
    for (const c of [`${NAME}=short`, `${NAME}=${'A'.repeat(65)}`, `${NAME}=${'A'.repeat(42)}!`, `x${NAME}=${v}`, `kit-guest=${v}`, ''])
      expect(readGuestCookie(req(c)), c).toBeNull();
    expect(readGuestCookie(req(`kit-guest=${v}`, 'http://localhost:8787/x'))).toBe(v);
  });

  it('身份：userId 是 g: 加哈希（不是 cookie 原值），同一个值永远同一个人；默认昵称"游客"+ 4 位数字', async () => {
    const v = mintGuestCookie(new Request(SITE)).value;
    const a = await guestIdentity(v);
    expect(a.userId).toMatch(/^g:[0-9a-f]{32}$/);
    expect(a.userId).not.toContain(v);
    expect(a.name).toMatch(/^游客\d{4}$/);
    expect(await guestIdentity(v)).toEqual(a);
    expect((await guestIdentity(v, '小明')).name).toBe('小明');
    expect((await guestIdentity(mintGuestCookie(new Request(SITE)).value)).userId).not.toBe(a.userId);
  });

  it('isStandalone：只有没绑 ARCADE、GATE 也不是 login 才算', () => {
    expect(isStandalone({})).toBe(true);
    expect(isStandalone({ GATE: 'off' })).toBe(true);
    expect(isStandalone({ GATE: 'login' })).toBe(false);
    expect(isStandalone({ ARCADE: {} })).toBe(false);
    expect(isStandalone({ ARCADE: {}, GATE: 'off' })).toBe(false);
  });
});

describe('昵称清洗', () => {
  it('收：中英文、数字、少数符号；NFKC 折全角、并空白、去首尾', () => {
    expect(cleanNickname('小明')).toBe('小明');
    expect(cleanNickname('  Kai   Li ')).toBe('Kai Li');
    expect(cleanNickname('Ｔｏｍ')).toBe('Tom');
    expect(cleanNickname('a_b-c.d·e')).toBe('a_b-c.d·e');
    expect(cleanNickname('一二三四五六七八九十一二')).toBe('一二三四五六七八九十一二');
  });

  it('拒：太长、空、控制符、零宽字、方向控制符、emoji、尖括号、不是字符串', () => {
    for (const bad of ['', '   ', '一二三四五六七八九十一二三', 'a\u0000b', 'a​b', 'a‮b', '😀', '<b>', 'a"b', 'x'.repeat(65), null, 12, {}])
      expect(cleanNickname(bad), JSON.stringify(bad)).toBeNull();
  });

  it('拒保留词：中文按包含（电脑、游客……加游戏传的名字），ASCII 按整个词（去掉数字），全角绕不过去', () => {
    for (const bad of ['电脑', '电脑小王', '游客1234', '机器人', 'AI', 'ai 2', 'Bot007', 'ＡＩ', 'cpu-1', '老王来了']) expect(cleanNickname(bad, ['老王']), bad).toBeNull();
    for (const ok of ['Kai', 'Aiden', 'Robotics', '小王']) expect(cleanNickname(ok, ['老王']), ok).toBe(ok);
  });
});

describe('开房进房：独立模式', () => {
  it('没有游客 cookie 开房：发 cookie 并开成；带着它进房认得出、坐在房主位；再连一次是同一个人（旧连接被顶掉）', async () => {
    const res = await create('/guest', '');
    expect(res.status).toBe(201);
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(new RegExp(`^${NAME}=[A-Za-z0-9_-]{43}; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax; Secure$`));
    const { code } = (await res.json()) as { code: string };
    const cookie = pair(set[0]!);
    const first = await join(code, cookie);
    expect(first.welcome.you.seat).toBe(0);
    expect(first.welcome.room.seats[0]!.name).toMatch(/^游客\d{4}$/);
    const again = await join(code, cookie);
    expect(again.welcome.you.seat).toBe(0);
    expect(await first.conn.closedWith()).toBe(CLOSE.replaced);
    again.conn.ws.close();
  });

  it('已经有 cookie 开房不再发；换一个游客 cookie 是另一个人（没坐房主位、没绑座位）', async () => {
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    const res = await create('/guest', cookie);
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual([]);
    const { code } = (await res.json()) as { code: string };
    const host = await join(code, cookie);
    const other = await join(code, pair(mintGuestCookie(new Request(SITE)).setCookie));
    expect(other.welcome.you.seat).toBeNull();
    expect(other.welcome.you.bound ?? null).toBeNull();
    host.conn.ws.close();
    other.conn.ws.close();
  });

  it('昵称：地址里的 ?name= 清洗后用；不合格（保留词、太长）就用默认名', async () => {
    const res = await create('/guest', '', `?name=${encodeURIComponent('小明')}`);
    const cookie = pair(res.headers.getSetCookie()[0]!);
    const { code } = (await res.json()) as { code: string };
    const a = await join(code, cookie, `&name=${encodeURIComponent('  小明 ')}`);
    expect(a.welcome.room.seats[0]!.name).toBe('小明');
    a.conn.ws.close();
    const b = await join(code, cookie, `&name=${encodeURIComponent('老王')}`);
    expect(b.welcome.room.seats[0]!.name).toMatch(/^游客\d{4}$/);
    b.conn.ws.close();
  });

  it('进房没有游客 cookie：4401（进房不发 cookie），不建房间', async () => {
    const res = await create('/guest', '');
    const { code } = (await res.json()) as { code: string };
    expect(await refusedWith(await upgrade('/guest', code, ''))).toBe(CLOSE.unauthorized);
  });

  it('同源检查照旧：别的网站的页面开房 403、进房 4403', async () => {
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    const res = await exports.default.fetch(`${SITE}/guest/rooms`, { method: 'POST', headers: { origin: 'https://evil.example.org', cookie } });
    expect(res.status).toBe(403);
    const ws = await exports.default.fetch(`${SITE}/guest/rooms/123456/ws?cv=1`, { headers: { upgrade: 'websocket', origin: 'https://evil.example.org', cookie } });
    expect(await refusedWith(ws)).toBe(CLOSE.forbidden);
  });
});

describe('开房进房：平台模式不认游客', () => {
  it('绑了 ARCADE：只带游客 cookie 开房 401、进房 4401，不发游客 cookie', async () => {
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    const res = await create('', cookie);
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    const open = await create('', `${SESSION_COOKIE}=hostA`);
    const { code } = (await open.json()) as { code: string };
    expect(await refusedWith(await upgrade('', code, cookie))).toBe(CLOSE.unauthorized);
  });

  it('没绑 ARCADE 却写了 GATE=login：带不带游客 cookie 都不退成游客（没会话 401，有会话 503 平台不可用）', async () => {
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    const a = await create('/guest-login', cookie);
    expect(a.status).toBe(401);
    expect(a.headers.getSetCookie()).toEqual([]);
    expect((await create('/guest-login', `${cookie}; ${SESSION_COOKIE}=x`)).status).toBe(503);
    expect(await refusedWith(await upgrade('/guest-login', '123456', cookie))).toBe(CLOSE.unauthorized);
  });

  it('identify：绑了 ARCADE 时游客 cookie 不看、不问平台、不发 cookie', async () => {
    let asked = 0;
    const arcade = { fetch: () => (asked++, Promise.resolve(Response.json({ user: null }))) } as unknown as Fetcher;
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    expect(await identify(new Request(SITE, { headers: { cookie } }), { ARCADE: arcade }, { mint: true, nickname: '小明' })).toEqual({ error: 'anonymous', setCookie: [] });
    expect(asked).toBe(0);
  });
});

describe('loginGate、standaloneRoot：独立模式', () => {
  const PAGE = '<!doctype html><title>游戏</title>';
  const assets = { fetch: () => Promise.resolve(new Response(PAGE, { headers: { 'content-type': 'text/html' } })) } as unknown as Fetcher;

  it('没绑 ARCADE：不跳登录，回页面；没有游客 cookie 补发，有了不再发；不缓存', async () => {
    const res = await loginGate(new Request(`${SITE}/games/x/?room=123456`), { ASSETS: assets }, { guest: { cookie: 'mj' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(/^__Host-mj=/);
    const back = await loginGate(new Request(`${SITE}/games/x/`, { headers: { cookie: pair(set[0]!) } }), { ASSETS: assets, GATE: 'off' }, { guest: { cookie: 'mj' } });
    expect(back.status).toBe(200);
    expect(back.headers.getSetCookie()).toEqual([]);
  });

  it('绑了 ARCADE：带游客 cookie 照样 302 去登录；没绑 ARCADE 却 GATE=login：没会话 302、有会话 503', async () => {
    const cookie = pair(mintGuestCookie(new Request(SITE)).setCookie);
    const arcade = { fetch: () => Promise.resolve(Response.json({ user: null })) } as unknown as Fetcher;
    const a = await loginGate(new Request(`${SITE}/games/x/`, { headers: { cookie } }), { ASSETS: assets, ARCADE: arcade });
    expect(a.status).toBe(302);
    expect(a.headers.getSetCookie()).toEqual([]);
    const b = await loginGate(new Request(`${SITE}/games/x/`, { headers: { cookie } }), { ASSETS: assets, GATE: 'login' });
    expect(b.status).toBe(302);
    const c = await loginGate(new Request(`${SITE}/games/x/`, { headers: { cookie: `${SESSION_COOKIE}=x` } }), { ASSETS: assets, GATE: 'login' });
    expect(c.status).toBe(503);
    expect(await c.text()).toBe(DOWN_PAGE);
  });

  it('standaloneRoot：独立模式下 / 跳到 /games/<id>/（带查询参数），别的路径和平台模式都不管', () => {
    const r = standaloneRoot(new Request(`${SITE}/?room=123456`), {}, 'mahjong');
    expect(r?.status).toBe(302);
    expect(r?.headers.get('location')).toBe('/games/mahjong/?room=123456');
    expect(standaloneRoot(new Request(`${SITE}/games/mahjong/`), {}, 'mahjong')).toBeNull();
    expect(standaloneRoot(new Request(`${SITE}/`), { ARCADE: {} }, 'mahjong')).toBeNull();
    expect(standaloneRoot(new Request(`${SITE}/`), { GATE: 'login' }, 'mahjong')).toBeNull();
  });

  it('standaloneRoot：独立模式下 /api/me 回 200 { standalone: true }（detectPlatform 认作没有平台，不落到 404）；平台模式不管', async () => {
    const r = standaloneRoot(new Request(`${SITE}/api/me`), {}, 'mahjong');
    expect(r?.status).toBe(200);
    expect(r?.headers.get('cache-control')).toBe('no-store');
    const p = await detectPlatform({ fetchImpl: async () => r! });
    expect(p).toEqual({ platform: false });
    expect(standaloneRoot(new Request(`${SITE}/api/me`), { ARCADE: {} }, 'mahjong')).toBeNull();
    expect(standaloneRoot(new Request(`${SITE}/api/me`), { GATE: 'login' }, 'mahjong')).toBeNull();
    expect(standaloneRoot(new Request(`${SITE}/api/me/x`), {}, 'mahjong')).toBeNull();
  });
});
