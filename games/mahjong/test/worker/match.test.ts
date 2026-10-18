/**
 * 快速匹配（0.21.0，kit 0.20.0 的 MatchQueue，设计在 kit 的 docs/match.md）：走真的 Worker 路由 /games/mahjong/rooms/match/<档位>，
 * 真的排队 DO、房间 DO、（假平台的）钱包 DO。覆盖：入口导出、同档凑满一桌、匹配桌（room.match）自动开打、实盘档开桌带档位、
 * 认不得的档位和单独部署（没有钱包）的实盘档 4004。
 */
import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { CLOSE, type DownMsg, type WelcomeMsg } from 'arcade-kit/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../../src/room/rules.ts';
import * as main from '../../worker/main.ts';
import worker, { type Env } from '../../worker/main.ts';
import { advance, BASE, freezeClock, SITE } from './helpers.ts';

type QMsg = { t: string; code?: string; why?: string };
const MATCH = `${BASE}/rooms/match`;
const cookie = (sid: string) => `__Host-sid=${sid}`;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeEach(() => freezeClock());
afterEach(() => vi.useRealTimers());

let uid = 0;
const user = () => `mq${uid++}`;

/** 排上：收到的话都留着 */
async function enqueue(tier: string, sid: string) {
  const res = await exports.default.fetch(`${MATCH}/${tier}`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie(sid) } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const msgs: QMsg[] = [];
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string' && e.data !== 'pong') msgs.push(JSON.parse(e.data) as QMsg);
  });
  return { ws, msgs };
}

/** 排队的结果（matched、solo、has_room 三选一） */
async function resultOf(q: { msgs: QMsg[] }): Promise<QMsg> {
  for (let t = 0; t < 300; t++) {
    const m = q.msgs.find((x) => x.t !== 'waiting');
    if (m) return m;
    await sleep(10);
  }
  throw new Error(`no result: ${JSON.stringify(q.msgs)}`);
}

/** 被拒的升级：先接受再用关闭码关（浏览器拿不到 HTTP 状态码） */
async function refusedWith(res: Response): Promise<number> {
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const code = new Promise<number>((ok) => ws.addEventListener('close', (e) => ok(e.code)));
  ws.accept();
  return code;
}

async function join(code: string, sid: string) {
  const res = await exports.default.fetch(`${BASE}/rooms/${code}/ws?cv=1`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie(sid) } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const msgs: DownMsg<RoomView>[] = [];
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string' && e.data !== 'pong') msgs.push(JSON.parse(e.data) as DownMsg<RoomView>);
  });
  for (let t = 0; t < 300; t++) {
    const w = msgs.find((m) => m.t === 'welcome');
    if (w) return { ws, msgs, welcome: w as WelcomeMsg<RoomView> };
    await sleep(10);
  }
  throw new Error('no welcome');
}

describe('部署入口 worker/main.ts', () => {
  it('只有默认导出、房间 MahjongRoom、计量 RoomMeter、排队 Queue（运行时把每个具名导出都当成入口，多了会启动失败）', () => {
    expect(Object.keys(main).sort()).toEqual(['MahjongRoom', 'Queue', 'RoomMeter', 'default']);
  });
});

describe('快速匹配（0.21.0）', () => {
  it('四个人排娱乐：凑满一桌立刻开，同一张匹配桌、娱乐规则，人到齐自动开打', async () => {
    const ids = [user(), user(), user(), user()];
    const qs = [];
    for (const u of ids) qs.push(await enqueue('fun', u));
    const rs = await Promise.all(qs.map(resultOf));
    expect(rs.map((r) => r.t)).toEqual(['matched', 'matched', 'matched', 'matched']);
    const code = rs[0]!.code!;
    expect(rs.every((r) => r.code === code)).toBe(true);
    const conns = [];
    for (const u of ids) conns.push(await join(code, u));
    const room = conns.at(-1)!.welcome.room;
    expect(room.match).toBe(true);
    expect(room.opts).toMatchObject({ variant: 'sichuan-xuezhan', stakes: 'fun' });
    for (let t = 0; t < 300 && !conns[0]!.msgs.some((m) => m.t === 'state' && m.room.status === 'playing'); t++) await sleep(10);
    expect(conns[0]!.msgs.some((m) => m.t === 'state' && m.room.status === 'playing')).toBe(true);
    for (const c of [...conns, ...qs]) c.ws.close();
  });

  it('实盘档：两个人等满 15 秒开桌，带上档位；外人进不了匹配桌；认不得的档位 4004', async () => {
    const [a, b, c] = [user(), user(), user()];
    const qa = await enqueue('real-small', a);
    const qb = await enqueue('real-small', b);
    advance(15_000);
    await runDurableObjectAlarm(env.MATCH!.get(env.MATCH!.idFromName('kit-match:real-small')));
    const [x, y] = await Promise.all([resultOf(qa), resultOf(qb)]);
    expect(x.t).toBe('matched');
    expect(y.code).toBe(x.code);
    const j = await join(x.code!, a);
    expect(j.welcome.room.match).toBe(true);
    expect(j.welcome.room.opts).toMatchObject({ stakes: 'small' });
    for (const c of [j, qa, qb]) c.ws.close();
    const outsider = await exports.default.fetch(`${BASE}/rooms/${x.code}/ws?cv=1`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie(c) } });
    expect(await refusedWith(outsider)).toBe(CLOSE.noRoom);
    for (const bad of ['real-gold', 'real-fun', 'FUN']) {
      const res = await exports.default.fetch(`${MATCH}/${bad}`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie(c) } });
      expect(await refusedWith(res)).toBe(CLOSE.noRoom);
    }
  });

  it('没有钱包（单独部署）只开娱乐：实盘档 4004', async () => {
    const solo: Env = { ...(env as unknown as Env), WALLET: undefined };
    const res = await worker.fetch(new Request(`${MATCH}/real-small`, { headers: { upgrade: 'websocket', origin: SITE, cookie: cookie(user()) } }) as never, solo);
    expect(await refusedWith(res)).toBe(CLOSE.noRoom);
  });
});
