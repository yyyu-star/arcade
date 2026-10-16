/**
 * 单独部署（DESIGN.md 10.1）：没有 ARCADE、WALLET、GATE，Worker 认游客 cookie。
 * 站点根跳到游戏首页；首页放行并发游客 cookie；/api/me 答"没有平台"；单机实盘的接口直接拒；
 * 开房、进房认出是同一个人，昵称照 ?name= 清洗（电脑人物的名字不许用）；好友房的带入不记账，坐下就有筹码。
 */
import { exports } from 'cloudflare:workers';
import type { DownMsg, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import { stakesOf } from '../../src/core/stakes.ts';
import type { RoomView } from '../../src/room/rules.ts';

const SITE = 'https://texas.example.workers.dev';
const BASE = `${SITE}/games/texas`;
const MAX = stakesOf('small').max;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Msg = DownMsg<RoomView>;

/** 打开首页拿一个游客 cookie（name=value） */
async function guest(): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/`);
  expect(res.status).toBe(200);
  const set = res.headers.get('set-cookie') ?? '';
  expect(set).toMatch(/^__Host-kit-guest=[A-Za-z0-9_-]{43};/);
  expect(set).toMatch(/HttpOnly/);
  return set.split(';')[0]!;
}

class Conn {
  readonly msgs: Msg[] = [];
  last: WelcomeMsg<RoomView> | StateMsg<RoomView> | null = null;
  readonly ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      const m = JSON.parse(e.data) as Msg;
      this.msgs.push(m);
      if (m.t !== 'error' && (!this.last || m.seq >= this.last.seq)) this.last = m;
    });
  }
  get view(): RoomView | null {
    return this.last?.t === 'welcome' ? this.last.view : (this.last?.frames.at(-1)?.view ?? null);
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: (m: Msg) => boolean, ms = 5_000): Promise<Msg> {
    const deadline = performance.now() + ms;
    for (let i = 0; ; ) {
      for (; i < this.msgs.length; i++) if (pred(this.msgs[i]!)) return this.msgs[i]!;
      if (performance.now() > deadline) throw new Error(`timed out: ${JSON.stringify(this.msgs.map((m) => (m.t === 'error' ? m : [m.t, m.room.status, m.you])))}`);
      await sleep(10);
    }
  }
}

async function join(code: string, cookie: string, name?: string): Promise<Conn> {
  const q = name ? `&name=${encodeURIComponent(name)}` : '';
  const res = await exports.default.fetch(`${BASE}/rooms/${code}/ws?cv=1${q}`, { headers: { upgrade: 'websocket', origin: SITE, cookie } });
  expect(res.status).toBe(101);
  const c = new Conn(res.webSocket!);
  await c.until((m) => m.t === 'welcome');
  return c;
}

describe('单独部署', () => {
  it('站点根跳到游戏首页，查询参数带上', async () => {
    const res = await exports.default.fetch(`${SITE}/?room=123456`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/games/texas/?room=123456');
  });

  it('首页放行并发游客 cookie；带着 cookie 再来不重发', async () => {
    const cookie = await guest();
    const again = await exports.default.fetch(`${BASE}/`, { headers: { cookie } });
    expect(again.status).toBe(200);
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('/api/me 答"没有平台"（页面的 detectPlatform 认作 platform: false）', async () => {
    const res = await exports.default.fetch(`${SITE}/api/me`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).not.toHaveProperty('user');
  });

  it('单机实盘的带入、结回直接拒：no_wallet', async () => {
    const cookie = await guest();
    for (const sub of ['buyin', 'cashout']) {
      const res = await exports.default.fetch(`${BASE}/api/solo/${sub}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-arcade': '1', origin: SITE, cookie },
        body: JSON.stringify({ op: 'op-00000001', session: 'sess-00000001', stakes: 'small', amount: MAX }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no_wallet' });
    }
  });

  it('开房、进房认出同一个人；昵称清洗；带入不记账，坐下就有筹码', async () => {
    const a = await guest();
    const b = await guest();
    expect(a).not.toBe(b);
    const res = await exports.default.fetch(`${BASE}/rooms?name=${encodeURIComponent('小明')}`, {
      method: 'POST',
      headers: { origin: SITE, cookie: a },
      body: JSON.stringify({ opts: { stakes: 'small', size: 4 } }),
    });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    // 房主进房就坐在 0 号：认出是开房的那个人
    const host = await join(code, a, '小明');
    expect(host.last!.you.seat).toBe(0);
    // 电脑人物的名字不许当昵称，换成默认的"游客1234"
    const other = await join(code, b, '稳哥');
    other.send({ t: 'sit', seat: 1 });
    const sat = (await other.until((m) => m.t === 'state' && m.you.seat === 1)) as StateMsg<RoomView>;
    expect(sat.room.seats[0]!.name).toBe('小明');
    expect(sat.room.seats[1]!.name).toMatch(/^游客\d{4}$/);
    host.send({ t: 'start' });
    await host.until((m) => m.t === 'state' && m.room.status === 'playing');
    // 没有钱包：两个人的带入都直接办成，各带满一份上桌
    const deadline = performance.now() + 10_000;
    while (!(host.view && host.view.seats[0]!.owner === 'player' && host.view.seats[1]!.owner === 'player')) {
      if (performance.now() > deadline) throw new Error('buy-ins not done');
      await sleep(20);
    }
    const v = host.view!;
    expect(v.refused).toBeNull();
    for (const i of [0, 1]) expect(v.seats[i]!.stack + v.seats[i]!.bet).toBe(MAX);
  });

  it('没有游客 cookie 不能进房', async () => {
    const a = await guest();
    const res = await exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: a }, body: JSON.stringify({ opts: { stakes: 'small', size: 2 } }) });
    const { code } = (await res.json()) as { code: string };
    const ws = await exports.default.fetch(`${BASE}/rooms/${code}/ws?cv=1`, { headers: { upgrade: 'websocket', origin: SITE } });
    const c = new Conn(ws.webSocket!);
    const closed = await new Promise<number>((ok) => c.ws.addEventListener('close', (e) => ok(e.code)));
    expect(closed).toBe(4401);
  });
});
