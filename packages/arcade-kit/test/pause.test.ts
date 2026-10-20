/**
 * 0.5.0 的"停一会儿再接着来"（RoomGame.pause / resume），用"歇一下的比大小"（test/pause.ts）测。
 * 和 room.test.ts 一样跑在本地 workerd 里，假时间放在将来、闹钟只在测试调用时才跑；每一步断言写入 ≤ 2 行。
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotBytes } from '../src/game.ts';
import { roomStub } from '../src/internal.ts';
import type { StateMsg, WelcomeMsg } from '../src/protocol.ts';
import { DEFAULT_LIMITS } from '../src/room.ts';
import { advance, type Conn, freezeClock, join, openRoom, resetMeter, roomRow } from './helpers.ts';
import { type NoResumeRoom, PAUSE_ACT, type PauseRoom, type PauseState, type PauseView, pauseGame, REST_MS } from './pause.ts';

const P = '/pause';
const AI = DEFAULT_LIMITS.aiDelayMs;
const TURN = DEFAULT_LIMITS.turnMs;
const RETRY = 60_000;

beforeEach(async () => {
  freezeClock();
  await resetMeter();
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Room = PauseRoom | NoResumeRoom;
const pauseStub = (code: string, ns: DurableObjectNamespace = env.PAUSE_ROOM) => roomStub(ns, code) as DurableObjectStub<Room>;

async function inspect(code: string, ns: DurableObjectNamespace = env.PAUSE_ROOM) {
  const v = await roomRow(pauseStub(code, ns), code);
  return runInDurableObject(pauseStub(code, ns), async (room: Room, state) => {
    const row = v !== null ? { v: JSON.stringify(v) } : undefined;
    return {
      last: room.lastStepWrites,
      max: room.maxStepWrites,
      persist: row ? (JSON.parse(row.v) as { game: PauseState; status: string; seq: number; turnSince: number }) : null,
      alarm: await state.storage.getAlarm(),
    };
  });
}

async function writesOk(code: string, ns?: DurableObjectNamespace) {
  const { last, max } = await inspect(code, ns);
  expect(last).toBeLessThanOrEqual(2);
  expect(max).toBeLessThanOrEqual(2);
}

const view = (m: StateMsg<unknown>) => m.frames.at(-1)!.view as PauseView;
const acked = async (c: Conn, moveId: string) => (await c.until((m) => (m.t === 'state' && m.ack === moveId) || (m.t === 'error' && m.moveId === moveId))) as StateMsg<unknown>;

/** u1 开房、坐 0 号位、开打（其余三家电脑），轮到 u1。prefix 选房间类 */
async function started(prefix = P, opts?: unknown) {
  const code = await openRoom('u1', prefix);
  const { conn: host } = await join(code, 'u1', prefix);
  host.send({ t: 'start', ...(opts !== undefined ? { opts } : {}) });
  const s = (await host.state()) as StateMsg<unknown>;
  return { code, host, first: s };
}

/** u1 出一张，三家电脑接着出完这一圈：进入停顿 */
async function toRest(host: Conn, first: StateMsg<unknown>) {
  const card = Math.min(...view(first).mine!);
  host.act('r1', { card });
  return acked(host, 'r1');
}

describe('停一会儿再接着来（pause / resume，0.5.0）', () => {
  it('电脑出完一圈进入停顿：计时从播放完开始，RoomInfo.pause 给截止时间、turn 为 null，闹钟就是它；停顿期间轮流的操作回 not_your_turn', async () => {
    const { code, host, first } = await started();
    expect(first.room.pause).toBeUndefined();
    const t0 = Date.now();
    const m = await toRest(host, first);
    // u1 那一帧 + 三家电脑各一帧，最后停在"一圈出完"
    expect(m.frames).toHaveLength(4);
    expect(view(m).rest).toBe(true);
    expect(m.room.turn).toBeNull();
    expect(m.room.status).toBe('playing');
    expect(m.room.pause).toEqual({ until: t0 + 3 * AI + REST_MS });
    const i = await inspect(code);
    expect(i.persist!.turnSince).toBe(t0 + 3 * AI);
    expect(i.alarm).toBe(t0 + 3 * AI + REST_MS);
    await writesOk(code);
    // 进房、重连的快照里也有
    const { welcome } = await join(code, 'u9', P);
    expect((welcome as WelcomeMsg<unknown>).room.pause).toEqual({ until: t0 + 3 * AI + REST_MS });
    // 停顿期间出牌（看到的是最新的 seq）：照常 not_your_turn
    host.act('x', { card: 1 });
    expect(await acked(host, 'x')).toMatchObject({ t: 'error', code: 'not_your_turn' });
  });

  it('停够了接着来，电脑（含托管）一口气出完下一圈、最后一帧又进入停顿：同一条广播的 pause.until 就是 getAlarm()，都从这一批播放完算', async () => {
    // 0.7.2 查德州"pause.until 比 getAlarm() 早 1–2 帧"：就是这个形状（resume 那一帧 + 几帧电脑，最后一帧停下）。
    // kit 是对的：截止时间 = 闹钟 = 醒来时刻 + 这一批电脑的播放时间 + 停顿。对不上的是拿上一条消息（上一次停顿）的
    // until、或者"醒来时刻 + 停顿"去比，少算的正是这一批电脑的播放时间
    const { code, host, first } = await started();
    const { conn: eye } = await join(code, 'u9', P);
    const m = await toRest(host, first);
    // u1 掉线：宽限过了由电脑托管，四家都由房间代出
    host.ws.close(1000, 'bye');
    await eye.until((x) => x.t === 'state' && (x as StateMsg<unknown>).room.seats[0]!.away);
    advance(DEFAULT_LIMITS.graceMs);
    expect(Date.now()).toBeGreaterThan(m.room.pause!.until);
    await runDurableObjectAlarm(pauseStub(code));
    const s = (await eye.until((x) => x.t === 'state' && (x as StateMsg<unknown>).frames.length > 1)) as StateMsg<unknown>;
    const now = Date.now();
    // resume 那一帧（第二圈从 1 号开始）+ 1、2、3 号电脑 + 托管的 0 号，四帧播放；出完这一圈又停
    expect(s.frames.map((f) => f.delay)).toEqual([0, AI, AI, AI, AI]);
    expect(view(s).played).toHaveLength(8);
    expect(view(s).rest).toBe(true);
    expect(s.room.turn).toBeNull();
    expect(s.room.pause).toEqual({ until: now + 4 * AI + REST_MS });
    const i = await inspect(code);
    expect(i.persist!.seq).toBe(s.seq);
    expect(i.persist!.turnSince).toBe(now + 4 * AI);
    expect(i.alarm).toBe(s.room.pause!.until);
    await writesOk(code);
    // 进房的快照给的也是同一个时间
    const { welcome } = await join(code, 'u8', P);
    expect((welcome as WelcomeMsg<unknown>).room.pause).toEqual({ until: i.alarm });
    // 到点（不早一毫秒）就接着来：第三圈出完整场打完
    advance(i.alarm! - Date.now() - 1);
    await runDurableObjectAlarm(pauseStub(code));
    expect((await inspect(code)).persist!.game.rest).toBe(true);
    advance(1);
    await runDurableObjectAlarm(pauseStub(code));
    const end = (await eye.until((x) => x.t === 'state' && (x as StateMsg<unknown>).room.status !== 'playing')) as StateMsg<unknown>;
    expect(end.room.status).toBe('over');
    expect(view(end).played).toHaveLength(12);
    await writesOk(code);
  });

  it('没到点闹钟不推进（只改闹钟 1 行）；到点 resume 做一步、广播、pause 消失、新一圈的电脑接着出；这一步 ≤ 2 行，始终一个闹钟', async () => {
    const { code, host, first } = await started();
    const m = await toRest(host, first);
    const until = m.room.pause!.until;
    const seq = (await inspect(code)).persist!.seq;
    // 早了 1 毫秒被叫醒：牌局不动、不广播，闹钟还是停顿的截止时间
    advance(until - Date.now() - 1);
    await runDurableObjectAlarm(pauseStub(code));
    const early = await inspect(code);
    expect(early.persist!.seq).toBe(seq);
    expect(early.persist!.game.rest).toBe(true);
    expect(early.alarm).toBe(until);
    expect(early.last).toBe(1);
    // 到点
    advance(1);
    await runDurableObjectAlarm(pauseStub(code));
    const s = (await host.state()) as StateMsg<unknown>;
    expect(s.room.pause).toBeUndefined();
    // resume 那一帧（第二圈从 1 号电脑开始）+ 三家电脑，轮到 u1
    expect(s.frames).toHaveLength(4);
    expect((s.frames[0]!.view as PauseView).rest).toBe(false);
    expect((s.frames[0]!.view as PauseView).turn).toBe(1);
    expect(view(s).played).toHaveLength(7);
    const now = Date.now();
    expect(s.room.turn).toMatchObject({ seat: 0, deadline: now + 3 * AI + TURN });
    const after = await inspect(code);
    expect(after.last).toBeLessThanOrEqual(2);
    expect(after.alarm).toBe(now + 3 * AI + TURN);
    await writesOk(code);
    // 这一圈 u1 最后出，出完又停（没有电脑播放，从现在算）；第三圈从 2 号电脑开始
    host.act('r2', { card: view(s).mine![0]! });
    const r2 = await acked(host, 'r2');
    expect(r2.room.pause).toEqual({ until: Date.now() + REST_MS });
    advance(REST_MS);
    await runDurableObjectAlarm(pauseStub(code));
    const s3 = (await host.state()) as StateMsg<unknown>;
    expect(s3.room.pause).toBeUndefined();
    expect(s3.room.turn).toMatchObject({ seat: 0 });
    await writesOk(code);
  });

  it('停顿期间不轮流的操作、有人接管电脑座位：照常做，不重新计时', async () => {
    const { code, host, first } = await started();
    const m = await toRest(host, first);
    const until = m.room.pause!.until;
    const since = (await inspect(code)).persist!.turnSince;
    advance(2_000);
    host.act('w', { card: PAUSE_ACT.wave });
    const w = await acked(host, 'w');
    expect(view(w).waves).toBe(1);
    expect(w.room.pause).toEqual({ until });
    expect((await inspect(code)).persist!.turnSince).toBe(since);
    await writesOk(code);
    // 别人坐下接管 1 号电脑（座位换人）
    const { conn: u2 } = await join(code, 'u2', P);
    u2.send({ t: 'sit', seat: 1 });
    const sat = (await u2.until((x) => x.t === 'state' && x.you.seat === 1)) as StateMsg<unknown>;
    expect(sat.room.pause).toEqual({ until });
    expect((await inspect(code)).persist!.turnSince).toBe(since);
    expect((await inspect(code)).alarm).toBe(until);
    await writesOk(code);
    // 到点照常接着来：第二圈先轮到 1 号，现在是真人，不再代出
    advance(until - Date.now());
    await runDurableObjectAlarm(pauseStub(code));
    const s = (await u2.state()) as StateMsg<unknown>;
    expect(s.room.pause).toBeUndefined();
    expect(s.room.turn).toMatchObject({ seat: 1, deadline: Date.now() + TURN });
  });

  it('从等外面的事（waiting）直接进入停顿：从进入那一刻算，不沿用之前的计时', async () => {
    const { code, host } = await started();
    host.act('n', { card: PAUSE_ACT.nap });
    const n = await acked(host, 'n');
    expect(n.room.turn).toBeNull();
    expect(n.room.pause).toBeUndefined();
    advance(10_000);
    host.act('r', { card: PAUSE_ACT.restNow });
    const r = await acked(host, 'r');
    expect(r.room.pause).toEqual({ until: Date.now() + REST_MS });
    expect((await inspect(code)).alarm).toBe(Date.now() + REST_MS);
    await writesOk(code);
  });

  it('开局就是停顿：从开局那一刻算，到点接着来', async () => {
    const t0 = Date.now();
    const { code, host, first } = await started(P, { restFirst: true });
    expect(first.room.turn).toBeNull();
    expect(first.room.pause).toEqual({ until: t0 + REST_MS });
    expect((await inspect(code)).alarm).toBe(t0 + REST_MS);
    advance(REST_MS);
    await runDurableObjectAlarm(pauseStub(code));
    const s = (await host.state()) as StateMsg<unknown>;
    expect(s.room.pause).toBeUndefined();
    expect(s.room.turn).toMatchObject({ seat: 0, deadline: Date.now() + TURN });
    await writesOk(code);
  });

  for (const [act, log] of [
    [PAUSE_ACT.breakThrow, 'game.resume threw'],
    [PAUSE_ACT.breakStay, 'game.resume left the room paused'],
  ] as const) {
    it(`resume 出错（${log}）：记日志、截止时间推后 60 秒，不在当前时刻反复响、每次写一行；修好后到点接着来`, async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { code, host, first } = await started();
      const m = await toRest(host, first);
      host.act('b', { card: act });
      await acked(host, 'b');
      advance(m.room.pause!.until - Date.now());
      await runDurableObjectAlarm(pauseStub(code));
      const s = (await host.state()) as StateMsg<unknown>;
      expect(err.mock.calls.some((c) => c[0] === log)).toBe(true);
      const now = Date.now();
      expect(s.room.pause).toEqual({ until: now + RETRY });
      const i = await inspect(code);
      expect(i.persist!.game.rest).toBe(true);
      expect(i.alarm).toBe(now + RETRY);
      await writesOk(code);
      // 再被叫醒（还没到推后的时间）：牌局一行不写，闹钟还在推后的时间
      const seq = i.persist!.seq;
      await runDurableObjectAlarm(pauseStub(code));
      const again = await inspect(code);
      expect(again.persist!.seq).toBe(seq);
      expect(again.alarm).toBe(now + RETRY);
      // 修好（不轮流的操作）、到点：接着来
      host.act('f', { card: PAUSE_ACT.fix });
      await acked(host, 'f');
      advance(RETRY);
      await runDurableObjectAlarm(pauseStub(code));
      const ok = (await host.state()) as StateMsg<unknown>;
      expect(ok.room.pause).toBeUndefined();
      expect(ok.room.turn).toMatchObject({ seat: 0 });
      await writesOk(code);
    });
  }

  it('写了 pause 没写 resume：当作没有停顿，和 0.4.0 一样（没人能出手按出错当打完），只记一次日志', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ns = env.NORESUME_ROOM;
    const { code, host, first } = await started('/noresume');
    const m = await toRest(host, first);
    expect(m.room.status).toBe('over');
    expect(m.room.pause).toBeUndefined();
    expect(err.mock.calls.filter((c) => c[0] === "game has pause() but no resume(); pause ignored")).toHaveLength(1);
    expect(err.mock.calls.some((c) => c[0] === 'game has nobody to act but is not over')).toBe(true);
    expect((await inspect(code, ns)).persist!.status).toBe('over');
    await writesOk(code, ns);
  });

  it('不写 pause 的游戏（比大小）：RoomInfo 里没有 pause 字段；snapshotBytes 只给写了 pause 的游戏算上它', async () => {
    const code = await openRoom('u1');
    const { conn: host, welcome } = await join(code, 'u1');
    expect('pause' in welcome.room).toBe(false);
    host.send({ t: 'start' });
    const s = await host.state();
    expect('pause' in s.room).toBe(false);
    const st = pauseGame.begin!([1, 2, 3, 4, 5, 6, 7, 8], 1);
    expect(snapshotBytes(pauseGame, st)).toBeGreaterThan(snapshotBytes({ ...pauseGame, pause: undefined }, st));
  });
});

describe('别人看不出来的不轮流操作（0.7.1）', () => {
  it('只改出手人自己视图的 free 操作：照常存，只回给他、seq 不加；别人收不到任何消息，下一条广播的 seq 也不跳', async () => {
    const code = await openRoom('u1', P);
    const { conn: host } = await join(code, 'u1', P);
    const { conn: u2 } = await join(code, 'u2', P);
    u2.send({ t: 'sit', seat: 1 });
    await u2.until((x) => x.t === 'state' && x.you.seat === 1);
    host.send({ t: 'start' });
    const playing = (x: { t: string; room?: { status: string } }) => x.t === 'state' && x.room?.status === 'playing';
    const first = (await host.until(playing)) as StateMsg<unknown>;
    await u2.until((x) => playing(x) && (x as StateMsg<unknown>).seq === first.seq);
    const seq = first.seq;
    const seen = u2.msgs.length;
    // 不轮到 u2 也能做（free），做完只有他自己知道
    u2.act('p', { card: PAUSE_ACT.peek });
    const p = await acked(u2, 'p');
    expect(p.seq).toBe(seq);
    expect(p.quiet).toBe(true);
    expect(view(p).peeked).toBe(1);
    expect(p.frames).toHaveLength(1);
    expect((await inspect(code)).persist!.game.peeks).toEqual([0, 1, 0, 0]);
    expect((await inspect(code)).persist!.seq).toBe(seq);
    await writesOk(code);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(host.msgs.filter((m) => m.t === 'state' && m.seq > seq)).toEqual([]);
    expect(host.msgs.some((m) => m.t === 'state' && m.ack === 'p')).toBe(false);
    // 同一个操作重发：照常只回给他（重复的回话不带 quiet，页面当重复丢掉）
    u2.act('p', { card: PAUSE_ACT.peek });
    const again = await acked(u2, 'p');
    expect(again.seq).toBe(seq);
    expect(again.quiet).toBeUndefined();
    expect((await inspect(code)).persist!.game.peeks).toEqual([0, 1, 0, 0]);
    // 别人看得出来的 free 操作照常广播，seq 接着加 1
    expect(u2.msgs.length).toBeGreaterThan(seen);
    u2.act('w', { card: PAUSE_ACT.wave });
    const w = await acked(u2, 'w');
    expect(w.seq).toBe(seq + 1);
    const h = (await host.until((m) => m.t === 'state' && m.seq === seq + 1)) as StateMsg<unknown>;
    expect(view(h).waves).toBe(1);
    expect(view(h).peeked).toBe(0);
    await writesOk(code);
  });

  it('轮流的操作不走这条路：出牌照常广播', async () => {
    const { host, first } = await started();
    const m = await toRest(host, first);
    expect(m.seq).toBeGreaterThan(first.seq);
  });
});
