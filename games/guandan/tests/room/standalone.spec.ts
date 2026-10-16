/**
 * 单独部署（kit 0.10 的独立模式，README"单独部署这个游戏"）：wrangler.jsonc 原样部署时没有 ARCADE、WALLET、GATE。
 * 这里把测试 env 的这三个拿掉直接调 Worker（房间和计量是真的 Durable Object）：站点根转到游戏、首页发游客 cookie、
 * 开房进房认得出同一个人、昵称不许冒充电脑、没有钱包时实盘一律拒绝。有平台时游客 cookie 不认的那一面由 kit 自己的测试管。
 */
import { env } from 'cloudflare:workers';
import type { WelcomeMsg } from 'arcade-kit/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_VERSION, STAKE_PATH } from '../../src/net/version.ts';
import type { NetView } from '../../src/net/rules.ts';
import worker from '../../worker/index.ts';
import type { Env } from '../../worker/gate.ts';
import { Conn, ROOMS, SITE, freezeClock } from './helpers.ts';

beforeEach(() => freezeClock());

// 房间测试的配置没有静态资源绑定：首页由假的 ASSETS 回一个页面
const ASSETS = { fetch: async () => new Response('<!doctype html>掼蛋', { status: 200, headers: { 'content-type': 'text/html' } }) };
const solo: Env = { ...(env as unknown as Env), ASSETS, ARCADE: undefined, WALLET: undefined, GATE: undefined };
const call = (url: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(url, { redirect: 'manual', ...init }), solo);
const name = (s: string): string => `name=${encodeURIComponent(s)}`;

/** 首页发的游客 cookie（name=value） */
async function guest(): Promise<string> {
  const res = await call(`${SITE}/games/guandan/`);
  expect(res.status).toBe(200);
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-kit-guest='));
  expect(set).toBeDefined();
  return set!.split(';')[0]!;
}

async function join(code: string, cookie: string, query = ''): Promise<{ conn: Conn; welcome: WelcomeMsg<NetView> }> {
  const res = await call(`${ROOMS}/${code}/ws?cv=${CLIENT_VERSION}${query}`, { headers: { upgrade: 'websocket', origin: SITE, cookie } });
  expect(res.status).toBe(101);
  const conn = new Conn(res.webSocket!, cookie);
  const welcome = (await conn.next()) as WelcomeMsg<NetView>;
  expect(welcome.t).toBe('welcome');
  return { conn, welcome };
}

describe('单独部署（没有平台）', () => {
  it('站点根转到 /games/guandan/', async () => {
    const res = await call(`${SITE}/`);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!, SITE).pathname).toBe('/games/guandan/');
  });

  it('首页不拦登录，发游客 cookie', async () => {
    expect(await guest()).toMatch(/^__Host-kit-guest=[A-Za-z0-9_-]{22,64}$/);
  });

  it('开房、进房认得出同一个人；昵称不许冒充电脑，好听的照用', async () => {
    const me = await guest();
    // 页面开房、进房都带同一个昵称；"老张1"含电脑人物的名字，换成"游客"加数字
    const fake = `?${name('老张1')}`;
    const res = await call(`${ROOMS}${fake}`, { method: 'POST', headers: { origin: SITE, cookie: me } });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    // 开房的人进来就坐在 0 号：认得出是开房的那个游客
    const a = await join(code, me, `&${fake.slice(1)}`);
    expect(a.welcome.you.seat).toBe(0);
    expect(a.welcome.room.seats[0]!.name).toMatch(/^游客\d{4}$/);
    // 另一个游客：别的人，没有座位；坐下用自己填的昵称
    const b = await join(code, await guest(), `&${name('阿花')}`);
    expect(b.welcome.you.seat).toBeNull();
    b.conn.send({ t: 'sit', seat: 1 });
    await b.conn.waitFor(() => b.conn.latest()?.you.seat === 1, 'sit');
    expect(b.conn.latestRoom()!.seats[1]!.name).toBe('阿花');
    a.conn.ws.close();
    b.conn.ws.close();
  });

  it('没有钱包：实盘房、单机带入结回放弃一律 409 no_wallet', async () => {
    const me = await guest();
    const body = JSON.stringify({ stake: 'small' });
    const room = await call(ROOMS, { method: 'POST', headers: { origin: SITE, cookie: me, 'content-type': 'application/json' }, body });
    expect(room.status).toBe(409);
    expect(await room.json()).toEqual({ error: 'no_wallet' });
    for (const sub of ['buyin', 'settle', 'refund']) {
      const text = JSON.stringify({ tier: 'small' });
      const res = await call(`${SITE}${STAKE_PATH}/${sub}`, {
        method: 'POST',
        headers: { origin: SITE, cookie: me, 'content-type': 'application/json', 'content-length': String(text.length) },
        body: text,
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: 'no_wallet' });
    }
  });
});
