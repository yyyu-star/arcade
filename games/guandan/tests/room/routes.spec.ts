/**
 * 房间的两个路由接在真的入口上（worker/main.ts → index.ts → gate.ts 的 routeRoom），ONLINE 开关、Origin、登录、页面版本。
 */
import { CLIENT_VERSION } from '../../src/net/version.ts';
import { exports } from 'cloudflare:workers';
import { CLOSE } from 'arcade-kit/protocol';
import { runDurableObjectAlarm } from 'cloudflare:test';
import type { WelcomeMsg } from 'arcade-kit/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetView } from '../../src/net/rules.ts';
import { env } from 'cloudflare:workers';
import worker from '../../worker/index.ts';
import * as main from '../../worker/main.ts';
import type { Env } from '../../worker/gate.ts';
import { ROOMS, SITE, advance, cookie, freezeClock, join, openRoom, refusedWith, truth, upgrade, type Conn } from './helpers.ts';

beforeEach(() => freezeClock());

/** 直接调默认导出，换掉部分变量（ONLINE 关着、没配 SITE_ORIGIN） */
function call(req: Request, vars: Partial<Env>): Promise<Response> {
  return worker.fetch(req, { ...(env as unknown as Env), ...vars });
}

describe('部署入口 worker/main.ts', () => {
  it('只有默认导出、房间类 Room、排队 Queue 和计量 RoomMeter（运行时把每个具名导出都当成入口，多了会启动失败）', () => {
    expect(Object.keys(main).sort()).toEqual(['Queue', 'Room', 'RoomMeter', 'default']);
    expect(main.default).toBe(worker);
  });
});

describe('开房', () => {
  it('POST …/room/rooms：登录了 201 + 6 位房间码；房间里开房那一步写 4 行（建表 2 + 状态 1 + 闹钟 1）', async () => {
    const res = await exports.default.fetch(ROOMS, { method: 'POST', headers: { origin: SITE, cookie: cookie('u1') } });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^[0-9]{6}$/);
    const t = await truth(code);
    expect(t.last).toBe(4);
    expect(t.row?.status).toBe('waiting');
    expect(t.row?.seats[0]).toMatchObject({ kind: 'human', userId: 'u1' });
  });

  it('没登录 401、平台不可用 503、别的网站 403、不是 POST 405', async () => {
    const post = (headers: Record<string, string>) => exports.default.fetch(ROOMS, { method: 'POST', headers });
    expect((await post({ origin: SITE })).status).toBe(401);
    expect((await post({ origin: SITE, cookie: cookie('down') })).status).toBe(503);
    expect((await post({ origin: 'https://evil.example', cookie: cookie('u1') })).status).toBe(403);
    expect((await post({ cookie: cookie('u1') })).status).toBe(403);
    expect((await exports.default.fetch(ROOMS, { headers: { origin: SITE, cookie: cookie('u1') } })).status).toBe(405);
  });

  // 只认本站页面发起的开房：设了 SITE_ORIGIN（正式部署由工作流注入）就只认它；不设时 kit 按自己的默认判断，
  // 这里只锁"和请求不是同一个站的一律 403"，不依赖 kit 的默认值是什么（arcade-kit 0.9.0 起不设就按请求自己的 origin）
  it('设了 SITE_ORIGIN 就只认它，别的 origin（包括请求自己的）403', async () => {
    const req = (origin: string) => new Request(ROOMS, { method: 'POST', headers: { origin, cookie: cookie('u1') } });
    expect((await call(req('https://other.test'), { SITE_ORIGIN: 'https://other.test' })).status).toBe(201);
    expect((await call(req(SITE), { SITE_ORIGIN: 'https://other.test' })).status).toBe(403);
  });

  it('不设 SITE_ORIGIN 时，Origin 和请求不是同一个站的 403', async () => {
    const req = (origin: string) => new Request(ROOMS, { method: 'POST', headers: { origin, cookie: cookie('u1') } });
    expect((await call(req('https://evil.example'), { SITE_ORIGIN: undefined })).status).toBe(403);
    expect((await call(new Request(ROOMS, { method: 'POST', headers: { cookie: cookie('u1') } }), { SITE_ORIGIN: undefined })).status).toBe(403);
  });

  it('房间路径下别的地址 404', async () => {
    for (const p of ['/games/guandan/room', '/games/guandan/room/', '/games/guandan/room/rooms/123456', '/games/guandan/room/x']) {
      expect((await exports.default.fetch(`${SITE}${p}`, { method: 'POST', headers: { origin: SITE, cookie: cookie('u1') } })).status).toBe(404);
    }
  });
});

describe('进房', () => {
  it('GET …/rooms/<码>/ws：房主进来坐 0 号位，welcome 带 minClientVersion（CLIENT_VERSION）', async () => {
    const code = await openRoom('u1');
    const { welcome } = await join(code, 'u1');
    expect(welcome.you.seat).toBe(0);
    expect(welcome.minClientVersion).toBe(CLIENT_VERSION);
    expect(welcome.room.code).toBe(code);
    expect(welcome.room.status).toBe('waiting');
  });

  it('被拒的都是先接受升级再用关闭码关：页面太旧 4005、没登录 4401、别的网站 4403、码不对 4004、没有这个房间 4004、平台不可用 1013', async () => {
    const code = await openRoom('u1');
    expect(await refusedWith(await upgrade(code, 'u2', { cv: CLIENT_VERSION - 1 }))).toBe(CLOSE.tooOld);
    expect(await refusedWith(await upgrade(code, null))).toBe(CLOSE.unauthorized);
    expect(await refusedWith(await upgrade(code, 'u2', { origin: 'https://evil.example' }))).toBe(CLOSE.forbidden);
    expect(await refusedWith(await upgrade('12ab', 'u2'))).toBe(CLOSE.noRoom);
    expect(await refusedWith(await upgrade(code === '000000' ? '000001' : '000000', 'u2'))).toBe(CLOSE.noRoom);
    expect(await refusedWith(await upgrade(code, 'down'))).toBe(CLOSE.tryLater);
  });

  it('不是 WebSocket 升级 426', async () => {
    const code = await openRoom('u1');
    const res = await exports.default.fetch(`${ROOMS}/${code}/ws?cv=${CLIENT_VERSION}`, { headers: { origin: SITE, cookie: cookie('u1') } });
    expect(res.status).toBe(426);
  });
});

describe('ONLINE 开关', () => {
  it('不是 "on"（off、没配）：开房 404，进房接受后马上 4004，不碰房间', async () => {
    const code = await openRoom('u1');
    for (const ONLINE of ['off', undefined, 'ON', '']) {
      const create = await call(new Request(ROOMS, { method: 'POST', headers: { origin: SITE, cookie: cookie('u1') } }), { ONLINE });
      expect(create.status).toBe(404);
      const ws = await call(
        new Request(`${ROOMS}/${code}/ws?cv=${CLIENT_VERSION}`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie('u1') } }),
        { ONLINE },
      );
      expect(await refusedWith(ws)).toBe(CLOSE.noRoom);
      const plain = await call(new Request(`${ROOMS}/${code}/ws?cv=${CLIENT_VERSION}`, { headers: { origin: SITE } }), { ONLINE });
      expect(plain.status).toBe(426);
    }
    // 关着的时候没有人进过房间：房主还算掉线
    expect((await truth(code)).row?.seats[0]?.awaySince).not.toBeNull();
  });

  it('没有 ROOM 绑定时按关着处理', async () => {
    const res = await call(new Request(ROOMS, { method: 'POST', headers: { origin: SITE, cookie: cookie('u1') } }), { ROOM: undefined });
    expect(res.status).toBe(404);
  });
});

describe('好友房聊天（0.22.0，kit 0.18.0）', () => {
  it('走真的进房路由：带 chat=1 的连接收到入座的人说的话（脏话打码）；号码整条拒发；没带 chat=1 的收不到', async () => {
    const code = await openRoom('u1');
    const a = (await join(code, 'u1', true)).conn;
    const b = (await join(code, 'u2', true)).conn;
    const old = (await join(code, 'u3')).conn;
    expect((await join(code, 'u4', true)).welcome.chat).toEqual({ ms: 3000, perMin: 10, max: 30 });
    b.send({ t: 'sit', seat: 1 });
    await b.waitFor(() => b.msgs.some((m) => (m.t === 'state' || m.t === 'welcome') && m.you.seat === 1), 'sit');
    const said = (c: Conn) => c.msgs.filter((m) => (m as { t: string }).t === 'chat') as unknown as { seat: number; text: string; masked?: true }[];
    b.send({ t: 'chat', text: '傻逼 好牌' });
    await a.waitFor(() => said(a).length === 1, 'chat');
    expect(said(a)[0]).toEqual({ t: 'chat', seat: 1, text: '** 好牌', masked: true });
    advance(3_000);
    b.send({ t: 'chat', text: '加我 138 0013 8000' });
    await b.waitFor(() => b.msgs.some((m) => m.t === 'error' && m.code === 'chat_blocked'), 'blocked');
    a.send({ t: 'chat', text: '赢了 1,000,000' });
    await b.waitFor(() => said(b).some((m) => m.seat === 0), 'chat 0');
    expect(said(b).map((m) => m.text)).toEqual(['** 好牌', '赢了 1,000,000']);
    expect(said(old)).toEqual([]);
  });
});

describe('快速匹配（0.26.0，kit 0.20.0）', () => {
  const MATCH = `${SITE}/games/guandan/room/match`;
  async function enqueue(tier: string, userId: string): Promise<{ msgs: { t: string; code?: string; why?: string }[]; closed: () => boolean; ws: WebSocket }> {
    const res = await exports.default.fetch(`${MATCH}/${tier}`, { headers: { upgrade: 'websocket', cookie: cookie(userId), origin: SITE } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const msgs: { t: string; code?: string; why?: string }[] = [];
    let closed = false;
    ws.addEventListener('message', (e) => msgs.push(JSON.parse(e.data as string)));
    ws.addEventListener('close', () => (closed = true));
    return { msgs, closed: () => closed, ws };
  }
  const resultOf = async (q: { msgs: { t: string; code?: string; why?: string }[] }) => {
    await vi.waitFor(() => expect(q.msgs.some((m) => m.t !== 'waiting')).toBe(true), { timeout: 3000 });
    return q.msgs.find((m) => m.t !== 'waiting')!;
  };

  it('四个人排娱乐：凑满一桌立刻开，房间是娱乐规则、匹配桌（room.match），人都到齐就自动开打', async () => {
    const qs = [];
    for (const u of ['m1', 'm2', 'm3', 'm4']) qs.push(await enqueue('fun', u));
    const rs = await Promise.all(qs.map(resultOf));
    expect(new Set(rs.map((r) => r.t))).toEqual(new Set(['matched']));
    const code = rs[0]!.code!;
    expect(rs.every((r) => r.code === code)).toBe(true);
    const conns: Conn[] = [];
    let last: WelcomeMsg<NetView> | null = null;
    for (const u of ['m1', 'm2', 'm3', 'm4']) {
      const j = await join(code, u);
      conns.push(j.conn);
      last = j.welcome;
    }
    expect(last!.room.match).toBe(true);
    expect(last!.room.status).toBe('playing');
    expect(last!.room.opts).toEqual({ stake: null });
    for (const c of conns) c.ws.close();
  });

  it('实盘档排到的桌带上档位；不认得的档位 4004', async () => {
    const a = await enqueue('real-small', 'r1');
    const b = await enqueue('real-small', 'r2');
    advance(15_000);
    await runDurableObjectAlarm(env.MATCH.get(env.MATCH.idFromName('kit-match:real-small')));
    const [x, y] = await Promise.all([resultOf(a), resultOf(b)]);
    expect(x.t).toBe('matched');
    expect(y.code).toBe(x.code);
    const j = await join(x.code!, 'r1');
    expect(j.welcome.room.opts).toEqual({ stake: 'small' });
    j.conn.ws.close();
    const bad = await exports.default.fetch(`${MATCH}/real-gold`, { headers: { upgrade: 'websocket', cookie: cookie('r3'), origin: SITE } });
    expect(await refusedWith(bad)).toBe(CLOSE.noRoom);
  });

  it('没有钱包（单独部署）只开娱乐：实盘档 4004', async () => {
    const res = await call(new Request(`${MATCH}/real-small`, { headers: { upgrade: 'websocket', cookie: cookie('s1'), origin: SITE } }), { WALLET: undefined });
    expect(await refusedWith(res)).toBe(CLOSE.noRoom);
  });
});
