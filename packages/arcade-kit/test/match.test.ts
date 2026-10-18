/**
 * 0.20.0 快速匹配（docs/match.md）：排队 0 行写入、满桌立刻开、到点 ≥ 2 人开 / 1 人转单机、同人顶替、每小时上限、
 * 入队前问计量、屏蔽的人不同桌；匹配桌只认排进来的人、到齐或到点自动开打、没来的电脑代打回来交还、一起还名额。
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchStub, roomStub, SESSION_COOKIE } from '../src/internal.ts';
import type { MatchDownMsg, StateMsg, WelcomeMsg } from '../src/protocol.ts';
import type { MatchOutcome } from '../src/room.ts';
import { advance, Conn, freezeClock, inspect, join, meter, openRoom, refusedWith, resetMeter, stub, upgrade } from './helpers.ts';
import { SITE, type ToyQueue, type ToyView } from './worker.ts';

beforeEach(async () => {
  freezeClock();
  await resetMeter();
});
afterEach(() => {
  vi.useRealTimers();
});

const open: Conn[] = [];
afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.ws.close(1000);
    } catch {
      // 已经关了
    }
  }
});

function queueStub(tier: string): DurableObjectStub<ToyQueue> {
  return matchStub(env.MATCH, tier) as DurableObjectStub<ToyQueue>;
}

async function enqueue(tier: string, userId: string): Promise<Conn> {
  const res = await exports.default.fetch(`${SITE}/match/${tier}`, { headers: { upgrade: 'websocket', origin: SITE, cookie: `${SESSION_COOKIE}=${userId}` } });
  if (res.status !== 101 || !res.webSocket) throw new Error(`enqueue failed: ${res.status}`);
  const c = new Conn(res.webSocket, userId);
  open.push(c);
  return c;
}

/** 下一条排队消息里不是 waiting 的那条（结果） */
async function result(c: Conn): Promise<MatchDownMsg> {
  return (await c.until((m) => (m as unknown as MatchDownMsg).t !== 'waiting')) as unknown as MatchDownMsg;
}

async function matchedCode(c: Conn): Promise<string> {
  const m = await result(c);
  if (m.t !== 'matched') throw new Error(`expected matched, got ${JSON.stringify(m)}`);
  return m.code;
}

describe('排队', () => {
  it('凑满一桌立刻开，四个人同一个码；排队对象一行不写', async () => {
    const cs = [];
    for (const u of ['a1', 'a2', 'a3']) cs.push(await enqueue('four', u));
    const w = (await cs[2]!.next()) as unknown as MatchDownMsg;
    expect(w).toMatchObject({ t: 'waiting', n: 3, seats: 4, left: 15_000 });
    cs.push(await enqueue('four', 'a4'));
    const codes = await Promise.all(cs.map(matchedCode));
    expect(new Set(codes).size).toBe(1);
    for (const c of cs) expect(await c.closedWith()).toBe(1000);
    const keys = await runInDurableObject(queueStub('four'), async (_q, state) => (await state.storage.list()).size);
    expect(keys).toBe(0);
    const room = await inspect(codes[0]!);
    expect(room.persist.match.users.sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(room.persist.status).toBe('waiting');
    // 四个人各占一个名额，全站只算一个房间
    for (const u of ['a1', 'a2', 'a3', 'a4']) expect((await meter().kitPeek(u)).room).toBe(codes[0]);
    expect((await meter().kitUsage()).rooms).toBe(1);
  });

  it('到点有 2 个人就开；只剩自己转单机', async () => {
    const b1 = await enqueue('four', 'b1');
    const b2 = await enqueue('four', 'b2');
    advance(15_000);
    expect(await runDurableObjectAlarm(queueStub('four'))).toBe(true);
    const [x, y] = await Promise.all([matchedCode(b1), matchedCode(b2)]);
    expect(x).toBe(y);

    const c1 = await enqueue('four', 'c1');
    advance(14_000);
    await runDurableObjectAlarm(queueStub('four'));
    // 闹钟只设在 c1 到点那一刻：还没到就什么都不发
    expect(c1.closed).toBeNull();
    advance(1_000);
    expect(await runDurableObjectAlarm(queueStub('four'))).toBe(true);
    expect(await result(c1)).toEqual({ t: 'solo', why: 'alone' });
    expect((await meter().kitPeek('c1')).room).toBeNull();
  });

  it('同一个人再排一次：旧连接 4001 让位', async () => {
    const d1 = await enqueue('four', 'd1');
    const again = await enqueue('four', 'd1');
    expect(await d1.closedWith()).toBe(4001);
    expect(((await again.next()) as unknown as MatchDownMsg)).toMatchObject({ t: 'waiting', n: 1 });
  });

  it('每小时排太多次 4029', async () => {
    for (let i = 0; i < 5; i++) (await enqueue('four', 'e1')).ws.close(1000);
    expect(await (await enqueue('four', 'e1')).closedWith()).toBe(4029);
  });

  it('入队前问计量：有开着的房间回 has_room，不进队', async () => {
    const code = await openRoom('f1');
    const c = await enqueue('four', 'f1');
    expect(await result(c)).toEqual({ t: 'has_room', code });
  });

  it('入队前问计量：今天的开房次数用完了直接转单机', async () => {
    for (let i = 0; i < 6; i++) {
      const code = await openRoom('g1');
      await meter().kitRelease('g1', code, 0);
    }
    expect(await result(await enqueue('four', 'g1'))).toEqual({ t: 'solo', why: 'daily_limit' });
  });

  it('不开放的档位 4004', async () => {
    const res = await exports.default.fetch(`${SITE}/match/nope`, { headers: { upgrade: 'websocket', origin: SITE, cookie: `${SESSION_COOKIE}=h1` } });
    expect(await refusedWith(res)).toBe(4004);
  });

  it('屏蔽过的两个人不同桌（平台的 blockedAmong）；没有平台名单时照常凑', async () => {
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.fakeBlocks = [['k2', 'k1']];
    });
    // 先后分开 1 毫秒：同一时刻排进来的谁先谁后不定
    const k1 = await enqueue('duo', 'k1');
    advance(1);
    const k2 = await enqueue('duo', 'k2');
    expect(k1.closed).toBeNull();
    advance(1);
    const k3 = await enqueue('duo', 'k3');
    const [x, y] = await Promise.all([matchedCode(k1), matchedCode(k3)]);
    expect(x).toBe(y);
    expect(k2.closed).toBeNull();
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.fakeBlocks = [];
    });
    k2.ws.close(1000);
  });

  it('平台没有 blockedAmong（调用出错）就跳过，照常凑', async () => {
    await runInDurableObject(queueStub('four'), (q: ToyQueue) => {
      q.fakeBlocks = null;
    });
    const cs = [];
    for (const u of ['v1', 'v2', 'v3', 'v4']) cs.push(await enqueue('four', u));
    const codes = await Promise.all(cs.map(matchedCode));
    expect(new Set(codes).size).toBe(1);
    await runInDurableObject(queueStub('four'), (q: ToyQueue) => {
      q.fakeBlocks = [];
    });
  });

  it('平台的屏蔽名单卡住：等 callMs 就按没有屏蔽凑桌（安全审阅）', async () => {
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.hang = { blocks: true };
    });
    const w1 = await enqueue('duo', 'w1');
    const w2 = await enqueue('duo', 'w2');
    const [x, y] = await Promise.all([matchedCode(w1), matchedCode(w2)]);
    expect(x).toBe(y);
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.hang = {};
    });
  });

  it('房间卡住：这一桌转单机（unavailable），锁放开，后来的人照常拿到连接、能凑桌', async () => {
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.hang = { create: true };
    });
    const x1 = await enqueue('duo', 'x1');
    const x2 = await enqueue('duo', 'x2');
    expect(await result(x1)).toEqual({ t: 'solo', why: 'unavailable' });
    expect(await result(x2)).toEqual({ t: 'solo', why: 'unavailable' });
    await runInDurableObject(queueStub('duo'), (q: ToyQueue) => {
      q.hang = {};
    });
    const x3 = await enqueue('duo', 'x3');
    const x4 = await enqueue('duo', 'x4');
    const [a, b] = await Promise.all([matchedCode(x3), matchedCode(x4)]);
    expect(a).toBe(b);
  });

  it('排队连接只收不发：发东西就断开', async () => {
    const c = await enqueue('four', 'm1');
    c.send({ t: 'hi' });
    expect(await c.closedWith()).toBe(1008);
  });
});

describe('匹配桌', () => {
  async function duo(a: string, b: string): Promise<string> {
    const ca = await enqueue('duo', a);
    const cb = await enqueue('duo', b);
    const [x] = await Promise.all([matchedCode(ca), matchedCode(cb)]);
    return x!;
  }

  it('两个人都连上就自动开打，空位电脑补；那一步最多 2 行', async () => {
    const code = await duo('n1', 'n2');
    const { conn: a, welcome } = await join(code, 'n1');
    expect(welcome.room.match).toBe(true);
    expect(welcome.room.status).toBe('waiting');
    expect(welcome.you.seat).not.toBeNull();
    const { conn: b, welcome: wb } = await join(code, 'n2');
    open.push(a, b);
    expect(wb.room.status).toBe('playing');
    expect(wb.room.seats.filter((s) => s.kind === 'ai')).toHaveLength(2);
    expect((await inspect(code)).last).toBeLessThanOrEqual(2);
    const s = (await a.until((m) => m.t === 'state' && m.room.status === 'playing')) as StateMsg<ToyView>;
    expect(s.room.match).toBe(true);
  });

  it('只有排进来的人能进；不能开打、等人时不能换座', async () => {
    const code = await duo('p1', 'p2');
    expect(await refusedWith(await upgrade(code, 'stranger'))).toBe(4004);
    const { conn, welcome } = await join(code, 'p1');
    open.push(conn);
    conn.send({ t: 'start' });
    expect(await conn.until((m) => m.t === 'error')).toMatchObject({ code: 'not_host' });
    // 座位是随机排的：挑一个不是自己的空位
    conn.send({ t: 'sit', seat: welcome.room.seats.findIndex((s, i) => s.kind === 'empty' && i !== welcome.you.seat) });
    expect(await conn.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_taken' });
  });

  it('等满 20 秒没来的人电脑代打，他回来交还', async () => {
    const code = await duo('q1', 'q2');
    const { conn } = await join(code, 'q1');
    open.push(conn);
    advance(20_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const st = (await inspect(code)).persist;
    expect(st.status).toBe('playing');
    const q2 = st.seats.findIndex((s: { userId: string | null }) => s.userId === 'q2');
    expect(st.seats[q2]).toMatchObject({ kind: 'human', auto: true });
    expect(st.owners[q2]).toBe('q2');
    // 没来的人：开打那一刻名额和当天次数都退给他（不白扣、不被 has_room 卡住）；来了的人照常占着
    await vi.waitFor(async () => expect((await meter().kitPeek('q2')).room).toBeNull());
    expect((await meter().kitPeek('q1')).room).toBe(code);
    expect((await meter().kitUsage()).rooms).toBe(1);
    const { conn: back, welcome } = (await join(code, 'q2')) as { conn: Conn; welcome: WelcomeMsg<ToyView> };
    open.push(back);
    expect(welcome.you.seat).toBe(q2);
    expect((await inspect(code)).persist.seats[q2]).toMatchObject({ auto: false, awaySince: null });
  });

  it('没人来、房间到点关掉：两个人的名额一起还', async () => {
    const code = await duo('r1', 'r2');
    advance(20_000);
    await runDurableObjectAlarm(stub(code));
    advance(10 * 60_000);
    await runDurableObjectAlarm(stub(code));
    expect((await inspect(code)).persist).toBeNull();
    for (const u of ['r1', 'r2']) expect((await meter().kitPeek(u)).room).toBeNull();
  });

  it('开桌时计量挡了一个人：一个名额都不占，回是谁、为什么', async () => {
    const mine = await openRoom('s1');
    const code = '777777';
    const out = (await (roomStub(env.ROOM, code) as unknown as { kitCreateMatch(c: string, p: unknown, o?: unknown): Promise<MatchOutcome> }).kitCreateMatch(code, [
      { userId: 's2', name: '二' },
      { userId: 's1', name: '一' },
    ])) as MatchOutcome;
    expect(out).toEqual({ r: 'refused', userId: 's1', why: 'has_room', code: mine });
    expect((await meter().kitPeek('s2')).room).toBeNull();
    expect((await inspect(code)).hasTable).toBe(false);
  });

  it('matchSeats 给的座位不合格就随机；同一个人不能排两次进同一桌', async () => {
    const r = roomStub(env.ROOM, '888888') as unknown as { kitCreateMatch(c: string, p: unknown): Promise<MatchOutcome> };
    expect(await r.kitCreateMatch('888888', [{ userId: 't1', name: '一' }, { userId: 't1', name: '一' }])).toEqual({ r: 'bad' });
    expect(await r.kitCreateMatch('888888', [])).toEqual({ r: 'bad' });
  });
});
