/**
 * 额度（0.2.0）：按人的开房名额、全站每天开房数、每日写入计量的两道门槛、计量连不上时的保守处理。
 * 真的计量 DO（RoomMeter）加真的房间；当天的数直接改存储（不用真的写 6 万行）。FlakyRoom 每 5 行报一次、用能"断线"的 FlakyMeter。
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { roomStub } from '../src/internal.ts';
import { DEFAULT_QUOTA, levelOf, parseQuota, type RoomMeter } from '../src/meter.ts';
import { CLOSE, CLOSE_REASON, isFinalClose, type StateMsg } from '../src/protocol.ts';
import { DEFAULT_LIMITS } from '../src/room.ts';
import { advance, type Conn, createRoom, freezeClock, inspect, join, meter, openRoom, refusedWith, resetMeter, stub, upgrade } from './helpers.ts';
import { type FlakyMeter, type FlakyRoom, SITE, type ToyView } from './worker.ts';

const FLAKY = '/flaky';
const flakyMeter = () => meter(env.FLAKY_METER) as unknown as DurableObjectStub<FlakyMeter>;
const flakyRoom = (code: string) => roomStub(env.FLAKY_ROOM, code) as DurableObjectStub<FlakyRoom>;
const setDown = (down: boolean) =>
  runInDurableObject(flakyMeter(), (m: FlakyMeter) => {
    m.down = down;
  });
const usage = (ns: DurableObjectNamespace = env.METER) => meter(ns).kitUsage();

async function body(res: Response): Promise<Record<string, unknown>> {
  return { status: res.status, ...((await res.json()) as object) };
}

/** 把计量当天的数直接改掉。 */
async function setDay(writes: number, rooms = 0, ns: DurableObjectNamespace = env.METER): Promise<void> {
  const { day } = await usage(ns);
  await runInDurableObject(meter(ns), (_m: RoomMeter, state) => {
    state.storage.sql.exec(
      'INSERT INTO kit_day (k, day, writes, rooms) VALUES (1, ?, ?, ?) ON CONFLICT (k) DO UPDATE SET day = excluded.day, writes = excluded.writes, rooms = excluded.rooms',
      day,
      writes,
      rooms,
    );
  });
}

/** 等到 fn 成立（房间还名额、报数是在广播之后 await 的，测试先收到消息）。 */
async function eventually(fn: () => Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (!(await fn())) {
    if (performance.now() > deadline) throw new Error('condition not met');
    await new Promise((ok) => setTimeout(ok, 20));
  }
}

function lastView(st: StateMsg<ToyView>): ToyView {
  return st.frames[st.frames.length - 1]!.view;
}

/** 房主一个人（另外三家电脑）开局，一直出最小的牌，直到打完或者房间关了。返回收到的最后一条状态。 */
async function playOut(conn: Conn): Promise<StateMsg<ToyView>> {
  conn.send({ t: 'start' });
  let st = await conn.state();
  for (let i = 0; st.room.status === 'playing'; i++) {
    conn.act(`m${i}`, { card: Math.min(...lastView(st).mine!) });
    try {
      st = await conn.state();
    } catch (e) {
      if (conn.closed) return st;
      throw e;
    }
  }
  return st;
}

beforeEach(async () => {
  freezeClock();
  await resetMeter(env.METER);
  await resetMeter(env.FLAKY_METER);
  await setDown(false);
});

describe('按人的开房名额', () => {
  it('同时只能开 1 个：第二个回 409 has_room，带上开着的那个房间的码；别人不受影响', async () => {
    const code = await openRoom('a');
    expect(await body(await createRoom('a'))).toEqual({ status: 409, error: 'has_room', code });
    await openRoom('b');
    expect((await usage()).rooms).toBe(2);
  });

  it('房间关掉（没人超时）就还名额，可以再开', async () => {
    const code = await openRoom('a');
    advance(DEFAULT_LIMITS.noHumanMs);
    await runDurableObjectAlarm(stub(code));
    expect((await inspect(code)).persist).toBeNull();
    await openRoom('a');
    expect((await usage()).rooms).toBe(2);
  });

  it('整场打完就还名额（房间还留着给大家看结果）', async () => {
    const code = await openRoom('a');
    const { conn } = await join(code, 'a');
    expect((await playOut(conn)).room.status).toBe('over');
    expect((await inspect(code)).persist).not.toBeNull();
    await eventually(async () => (await createRoom('a')).status === 201);
  });

  it('房间没来得及还（崩了、存储没了）：名额到"开房时间 + 房间寿命 + 1 分钟"自动作废', async () => {
    const code = await openRoom('a');
    await runInDurableObject(stub(code), async (_r, state) => {
      await state.storage.deleteAlarm();
      await state.storage.deleteAll();
    });
    expect((await createRoom('a')).status).toBe(409);
    advance(DEFAULT_LIMITS.maxLifeMs + 60_000 - 1);
    expect((await createRoom('a')).status).toBe(409);
    advance(1);
    expect((await createRoom('a')).status).toBe(201);
  });

  it('每天最多开 6 个：第 7 个回 429 daily_limit；UTC 0 点以后清零', async () => {
    for (let i = 0; i < DEFAULT_QUOTA.dailyRoomsPerUser; i++) {
      const code = await openRoom('a');
      await meter().kitRelease('a', code, 0);
    }
    expect(await body(await createRoom('a'))).toEqual({ status: 429, error: 'daily_limit' });
    // FIXED_NOW 是中午 12 点
    advance(12 * 3_600_000);
    await openRoom('a');
  });

  it('开房没建成（码撞了以外的失败）退回名额和次数', async () => {
    // 直接按 kit 的顺序走一遍：占到名额、房间说 bad，退回
    const m = meter();
    expect(await m.kitReserve('a', '123456', Date.now())).toEqual({ ok: true });
    await m.kitRelease('a', '123456', 0, true);
    const u = await usage();
    expect(u.rooms).toBe(0);
    expect(await m.kitReserve('a', '654321', Date.now())).toEqual({ ok: true });
  });
});

describe('全站每天开房数', () => {
  it('到 300 个回 503 busy；已经有房间的人照样先被告知回自己的房间', async () => {
    const mine = await openRoom('a');
    await setDay(0, DEFAULT_QUOTA.dailyRooms);
    expect(await body(await createRoom('b'))).toEqual({ status: 503, error: 'busy' });
    expect(await body(await createRoom('a'))).toEqual({ status: 409, error: 'has_room', code: mine });
  });
});

describe('每日写入计量', () => {
  it('门槛：6 万以下 ok，到 6 万 busy，到 8.5 万 stop；每报一次计量自己记 1 行', async () => {
    const m = meter();
    expect(await m.kitReport(59_998)).toBe('ok');
    expect((await usage()).writes).toBe(59_999);
    expect(await m.kitReport(0)).toBe('busy');
    expect(await m.kitReport(24_998)).toBe('busy');
    expect(await m.kitReport(0)).toBe('stop');
    expect(await m.kitLevel()).toBe('stop');
  });

  it('跨天：昨天的写入和开房数不算今天', async () => {
    await setDay(90_000, DEFAULT_QUOTA.dailyRooms);
    expect(await body(await createRoom('a'))).toEqual({ status: 503, error: 'busy' });
    advance(12 * 3_600_000);
    await openRoom('a');
    const u = await usage();
    expect(u.day).toBe('2030-01-16');
    expect(u.rooms).toBe(1);
    expect(u.writes).toBeLessThan(10);
  });

  it('超过 busy：不开新房（503 busy）、不进新人（4503，不重连）；房主、坐着的、连着的照常，在打的照常', async () => {
    const code = await openRoom('host');
    const { conn: h } = await join(code, 'host');
    await join(code, 'watcher');
    await setDay(DEFAULT_QUOTA.busyWrites);
    expect(await body(await createRoom('x'))).toEqual({ status: 503, error: 'busy' });
    // 房间记着的门槛 30 秒内有效
    advance(30_000);
    expect(await refusedWith(await upgrade(code, 'newbie'))).toBe(CLOSE.busy);
    expect(isFinalClose(CLOSE.busy)).toBe(true);
    // 已经连着的人从别的设备再连一次照常
    await join(code, 'watcher');
    h.send({ t: 'start' });
    expect((await h.state()).room.status).toBe('playing');
  });

  it('分批报：攒够 meterBatch 行才报，每报一次计量只多写 1 行；打完、关房时报最后一批并还名额，一行不漏', async () => {
    const code = await openRoom('host', FLAKY);
    const { conn } = await join(code, 'host', FLAKY);
    await playOut(conn);
    conn.ws.close(1000, 'bye');
    await eventually(async () => (await runInDurableObject(flakyRoom(code), (r: FlakyRoom) => r.lastStepWrites)) > 0);
    advance(DEFAULT_LIMITS.noHumanMs);
    await runDurableObjectAlarm(flakyRoom(code));
    const room = await runInDurableObject(flakyRoom(code), (r: FlakyRoom) => r.totalWrites);
    const reports = await runInDurableObject(flakyMeter(), (m: FlakyMeter) => m.reports);
    // 房间写的全报了；计量自己：开房 2 行（这个人、当天）+ 每报 1 行 + 打完还名额 2 行 + 关房再报 1 行（名额已经还过）
    expect((await usage(env.FLAKY_METER)).writes).toBe(room + 2 + reports + 2 + 1);
    expect(reports).toBeGreaterThan(0);
    // 每报一次至少 5 行（最后一批除外，那一批跟着还名额走）
    expect(reports).toBeLessThanOrEqual(Math.floor(room / 5));
  });

  it('没报的写入随房间那一行存下来：被驱逐后接着数，打完时一起报', async () => {
    const code = await openRoom('host', FLAKY);
    const { conn } = await join(code, 'host', FLAKY);
    conn.send({ t: 'start' });
    const st = await conn.state();
    await eventually(async () => (await runInDurableObject(flakyRoom(code), (r: FlakyRoom) => r.lastStepWrites)) > 0);
    const saved = await runInDurableObject(flakyRoom(code), (_r: FlakyRoom, state) =>
      JSON.parse(state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').one().v) as { unmetered: number },
    );
    expect(saved.unmetered).toBeGreaterThan(0);
    const before = (await usage(env.FLAKY_METER)).writes;
    const reportsBefore = await runInDurableObject(flakyMeter(), (m: FlakyMeter) => m.reports);
    await evictDurableObject(flakyRoom(code));
    // 换了实例：totalWrites 从 0 数，存下来的 unmetered 接着算
    conn.act('m0', { card: Math.min(...lastView(st).mine!) });
    let last = await conn.state();
    for (let i = 1; last.room.status === 'playing'; i++) {
      conn.act(`m${i}`, { card: Math.min(...lastView(last).mine!) });
      last = await conn.state();
    }
    const fresh = await runInDurableObject(flakyRoom(code), (r: FlakyRoom) => r.totalWrites);
    const reports = (await runInDurableObject(flakyMeter(), (m: FlakyMeter) => m.reports)) - reportsBefore;
    // 打完还名额：这个人一行、当天一行
    await eventually(async () => (await usage(env.FLAKY_METER)).writes === before + saved.unmetered + fresh + reports + 2);
  });

  it('超过 stop：在打的房间走到收场点（breakPoint）停下电脑、把这一步发出去，再以 4000 + quota 关房', async () => {
    const code = await openRoom('host', FLAKY);
    const { conn: h } = await join(code, 'host', FLAKY);
    h.send({ t: 'start' });
    const st = await h.state();
    await setDay(DEFAULT_QUOTA.stopWrites, 0, env.FLAKY_METER);
    // 让房间知道（有新人来时会问计量；它记着的门槛 30 秒内有效）
    advance(30_000);
    expect(await refusedWith(await upgrade(code, 'newbie', { prefix: FLAKY }))).toBe(CLOSE.busy);
    h.act('m0', { card: Math.min(...lastView(st).mine!) });
    let last = st;
    while (!h.closed) {
      try {
        last = await h.state();
      } catch {
        break;
      }
    }
    expect(await h.closedWith()).toBe(CLOSE.roomClosed);
    expect(h.closed!.reason).toBe(CLOSE_REASON.quota);
    // 停在座位 1 出完：座位 2、3 的电脑没有接着出
    expect(lastView(last).played.length).toBe(2);
    // 关房时还了名额：再开房不再是 409 has_room，而是今天满了的 503 busy
    await eventually(async () => (await createRoom('host', FLAKY)).status === 503);
  });

  it('超过 stop：等人的房间马上关', async () => {
    const code = await openRoom('other', FLAKY);
    const { conn: o } = await join(code, 'other', FLAKY);
    await setDay(DEFAULT_QUOTA.stopWrites, 0, env.FLAKY_METER);
    advance(30_000);
    // 被拒的那条连接关掉时房间醒来、看到记下的 stop，马上关
    expect(await refusedWith(await upgrade(code, 'newbie', { prefix: FLAKY }))).toBe(CLOSE.busy);
    expect(await o.closedWith()).toBe(CLOSE.roomClosed);
    expect(o.closed!.reason).toBe(CLOSE_REASON.quota);
  });

  it('超过 stop、游戏没写 breakPoint：房间知道后马上关', async () => {
    const code = await openRoom('host');
    const { conn: h } = await join(code, 'host');
    h.send({ t: 'start' });
    await h.state();
    await setDay(DEFAULT_QUOTA.stopWrites);
    advance(30_000);
    expect(await refusedWith(await upgrade(code, 'newbie'))).toBe(CLOSE.busy);
    // 不用等下一步：被拒的那条连接关掉时房间就收场了；保险起见再发一条消息叫醒它
    try {
      h.send({ t: 'leave' });
    } catch {
      // 已经关了
    }
    expect(await h.closedWith()).toBe(CLOSE.roomClosed);
    expect(h.closed!.reason).toBe(CLOSE_REASON.quota);
  });
});

describe('计量连不上', () => {
  it('不开新房（503 unavailable）、不进新人（1013，客户端过会儿重试）；在打的照常，恢复后补报、补还名额', async () => {
    const code = await openRoom('host', FLAKY);
    const { conn: h } = await join(code, 'host', FLAKY);
    await setDown(true);
    expect(await body(await createRoom('x', FLAKY))).toEqual({ status: 503, error: 'unavailable' });
    // 房间记着的门槛过期以后才会去问计量
    advance(30_000);
    expect(await refusedWith(await upgrade(code, 'newbie', { prefix: FLAKY }))).toBe(CLOSE.tryLater);
    expect((await playOut(h)).room.status).toBe('over');
    // 打完时房间还名额是广播之后才 await 的：先等它真的被拒，再恢复计量，不然这一下可能赶在恢复之后、直接还成功
    await eventually(() => runInDurableObject(flakyMeter(), (m: FlakyMeter) => m.refusedReleases > 0));
    // 恢复以后：过了重试间隔，房间下一次有事件时补上
    await setDown(false);
    expect((await createRoom('host', FLAKY)).status).toBe(409);
    advance(60_000);
    await join(code, 'host', FLAKY);
    await eventually(async () => (await createRoom('host', FLAKY)).status === 201);
    const room = await runInDurableObject(flakyRoom(code), (r: FlakyRoom) => r.totalWrites);
    expect((await usage(env.FLAKY_METER)).writes).toBeGreaterThanOrEqual(room);
  });
});

describe('开房的错误码', () => {
  it('没登录 401 login，别的网站 403 forbidden（JSON）', async () => {
    expect(await body(await createRoom(null))).toEqual({ status: 401, error: 'login' });
    const res = await exports.default.fetch(`${SITE}/rooms`, { method: 'POST', headers: { origin: 'https://evil.test', cookie: '__Host-sid=a' } });
    expect(await body(res)).toEqual({ status: 403, error: 'forbidden' });
  });
});

describe('KIT_QUOTA', () => {
  it('对象或 JSON 字符串都认，只改写了的字段；不认识的字段、不是非负整数的值忽略', () => {
    expect(parseQuota(undefined)).toEqual(DEFAULT_QUOTA);
    expect(parseQuota('{"dailyRooms":500}')).toEqual({ ...DEFAULT_QUOTA, dailyRooms: 500 });
    expect(parseQuota({ busyWrites: 50_000, stopWrites: 80_000 })).toEqual({ ...DEFAULT_QUOTA, busyWrites: 50_000, stopWrites: 80_000 });
    expect(parseQuota({ dailyRooms: -1, busyWrites: 1.5, roomsPerUser: '3', nope: 1 })).toEqual(DEFAULT_QUOTA);
    expect(parseQuota('not json')).toEqual(DEFAULT_QUOTA);
    expect(parseQuota([1])).toEqual(DEFAULT_QUOTA);
  });

  it('门槛按 ≥ 算', () => {
    expect(levelOf(59_999, DEFAULT_QUOTA)).toBe('ok');
    expect(levelOf(60_000, DEFAULT_QUOTA)).toBe('busy');
    expect(levelOf(85_000, DEFAULT_QUOTA)).toBe('stop');
  });
});
