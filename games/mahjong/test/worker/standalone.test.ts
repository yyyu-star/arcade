/**
 * 单独部署（kit 0.10 的独立模式，README "单独部署这个游戏"）：wrangler.jsonc 原样部署时没有 ARCADE、WALLET、GATE。
 * 这里把测试 env 的这三个拿掉直接调 Worker（房间 DO 和计量是真的）：站点根转到游戏、首页发游客 cookie、开房进房认得出同一个人、
 * 昵称不许冒充电脑、没有钱包时实盘一律拒绝。有平台时游客 cookie 不认的那一面由 kit 自己的测试管。
 */
import { env } from 'cloudflare:workers';
import type { DownMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import type { RoomView } from '../../src/room/rules.ts';
import worker, { type Env } from '../../worker/main.ts';
import { BASE, SITE } from './helpers.ts';

const solo: Env = { ...(env as unknown as Env), ARCADE: undefined, WALLET: undefined, GATE: undefined, SITE_ORIGIN: SITE };
const call = (url: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(url, { redirect: 'manual', ...init }) as never, solo);
const FUN = { variant: 'sichuan-xuezhan', stakes: 'fun', rules: { rounds: 4, cap: 3, swap: true, zimo: 'di', transfer: true } };

/** 首页发的游客 cookie（name=value） */
async function guest(): Promise<string> {
  const res = await call(`${BASE}/`);
  expect(res.status).toBe(200);
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-kit-guest='));
  expect(set).toBeDefined();
  return set!.split(';')[0]!;
}

/** 浏览器发字符串请求体总带 content-length（Worker 靠它先挡大请求体），这里照样带上 */
function post(url: string, cookie: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const text = JSON.stringify(body);
  return call(url, { method: 'POST', headers: { origin: SITE, cookie, 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(text).byteLength), ...headers }, body: text });
}

const create = (cookie: string, opts: unknown, query = ''): Promise<Response> => post(`${BASE}/rooms${query}`, cookie, { opts });

/** 进房：收到的消息都留着，until 等到想要的那条 */
async function join(code: string, cookie: string, query = '') {
  const res = await call(`${BASE}/rooms/${code}/ws?cv=1${query}`, { headers: { upgrade: 'websocket', origin: SITE, cookie } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const msgs: DownMsg<RoomView>[] = [];
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string' && e.data !== 'pong') msgs.push(JSON.parse(e.data) as DownMsg<RoomView>);
  });
  const until = async (pred: (m: DownMsg<RoomView>) => boolean): Promise<DownMsg<RoomView>> => {
    for (let i = 0, t = 0; t < 300; t++) {
      for (; i < msgs.length; i++) if (pred(msgs[i]!)) return msgs[i]!;
      await new Promise((ok) => setTimeout(ok, 10));
    }
    throw new Error(`timed out waiting for a message: ${JSON.stringify(msgs.map((m) => (m.t === 'state' || m.t === 'welcome' ? { t: m.t, you: m.you } : m)))}`);
  };
  const welcome = (await until((m) => m.t === 'welcome')) as WelcomeMsg<RoomView>;
  return { ws, welcome, until, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('单独部署（没有平台）', () => {
  it('站点根转到 /games/mahjong/', async () => {
    const res = await call(`${SITE}/`);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!, SITE).pathname).toBe('/games/mahjong/');
  });

  it('首页不拦登录，发游客 cookie', async () => {
    expect(await guest()).toMatch(/^__Host-kit-guest=[A-Za-z0-9_-]{22,64}$/);
  });

  it('开房、进房认得出同一个人；昵称不许冒充电脑，好听的照用', async () => {
    const me = await guest();
    // 页面开房、进房都带同一个昵称；"火锅婆婆1"含电脑人物的名字，换成"游客"加数字
    const fake = `?name=${encodeURIComponent('火锅婆婆1')}`;
    const res = await create(me, FUN, fake);
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    // 开房的人进来就坐在 0 号：认得出是开房的那个游客
    const a = await join(code, me, `&${fake.slice(1)}`);
    expect(a.welcome.you.seat).toBe(0);
    expect(a.welcome.room.seats[0]!.name).toMatch(/^游客\d{4}$/);
    // 另一个游客：别的人，没有座位；坐下用自己填的昵称
    const b = await join(code, await guest(), `&name=${encodeURIComponent('阿花')}`);
    expect(b.welcome.you.seat).toBeNull();
    b.send({ t: 'sit', seat: 1 });
    const bs = await b.until((m) => m.t === 'state' && m.you.seat === 1);
    expect(bs.t === 'state' && bs.room.seats[1]!.name).toBe('阿花');
  });

  it('没有钱包：实盘房、单机带入结回一律 no_wallet', async () => {
    const me = await guest();
    const room = await create(me, { ...FUN, stakes: 'small' });
    expect(room.status).toBe(409);
    expect(await room.json()).toEqual({ error: 'no_wallet' });
    for (const sub of ['buyin', 'settle']) {
      const res = await post(`${BASE}/api/stake/${sub}`, me, { op: 'op-00000001', session: 'session-0001', stakes: 'small', amount: 2_000 }, { 'x-arcade': '1' });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'no_wallet' });
    }
  });
});
