/**
 * 自托管 PG 模式（0.21.0，store.ts）专有的几条：只在 vitest.pg.config.ts 那一遍跑（绑了 KIT_STORE 和假 PG）；
 * 默认那一遍只查"没有 KIT_STORE 时 kitWake 什么都不做"。其余房间、计量、排队的行为两遍跑的是同一套测试。
 * 钱包那一头（房间状态全丢以后桌上的筹码到期原样退回）靠平台钱包的 until，不依赖房间，testing.test.ts 的"到期原样退回"已经覆盖。
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE } from '../src/protocol.ts';
import { matchStub, meterStub } from '../src/internal.ts';
import type { StateMsg } from '../src/protocol.ts';
import type { RoomMeter } from '../src/meter.ts';
import storeSrc from '../src/store.ts?raw';
import { advance, type Conn, freezeClock, inspect, join, openRoom, PG, pg, resetMeter, roomRow, stub } from './helpers.ts';
import type { ToyRoom, ToyView } from './worker.ts';

beforeEach(async () => {
  freezeClock();
  await resetMeter();
  if (PG) await pg().control({ delayMs: 0, fail: 0, clearLog: true });
});

afterEach(async () => {
  if (PG) await pg().control({ delayMs: 0, fail: 0, failLoad: 0 });
});

const alarmOf = (code: string) => runInDurableObject(stub(code), (_r: ToyRoom, s) => s.storage.getAlarm());

/** 两个人坐好开打，回房主那条连接和开局状态 */
async function twoSeated(): Promise<{ code: string; a: Conn; b: Conn; st: StateMsg<ToyView> }> {
  const code = await openRoom('a');
  const a = (await join(code, 'a')).conn;
  const b = (await join(code, 'b')).conn;
  b.send({ t: 'sit', seat: 1 });
  await b.until((m) => m.t === 'state' && m.you.seat === 1);
  a.send({ t: 'start' });
  const st = (await a.until((m) => m.t === 'state' && m.room.status === 'playing')) as StateMsg<ToyView>;
  await b.atLeast(st.seq);
  return { code, a, b, st };
}

const myCard = (st: StateMsg<ToyView>) => Math.min(...st.frames.at(-1)!.view.mine!);

describe.skipIf(PG)('默认模式（没有 KIT_STORE）', () => {
  it('kitWake 什么都不做：不建表、不写、不设闹钟', async () => {
    const s = stub('777001');
    await s.kitWake('777001');
    const r = await inspect('777001');
    expect(r.hasTable).toBe(false);
    expect(r.total).toBe(0);
    expect(await alarmOf('777001')).toBeNull();
  });

  it('架构：store.ts 不 import 房间、计量（它们按需引用它；默认模式根本不经过它）', () => {
    expect(storeSrc).not.toMatch(/from '\.\/(room|meter|match)\.js'/);
  });
});

describe.skipIf(!PG)('自托管 PG 模式（KIT_STORE）', () => {
  it('不碰 sqlite：房间那一行在 PG 里，DO 自己的 SQLite 里没有 kit_room 表', async () => {
    const { code } = await twoSeated();
    expect((await roomRow(stub(code), code))?.status).toBe('playing');
    const tables = await runInDurableObject(stub(code), (_r: ToyRoom, s) => s.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kit_%'").toArray());
    expect(tables).toEqual([]);
  });

  it('每次提交 ≤ 2 行（房间那一行 + 不算行的闹钟），一整局都是；状态没变的步骤不提交', async () => {
    const { a, b, st } = await twoSeated();
    await pg().control({ clearLog: true });
    a.act('m0', { card: myCard(st) });
    const s1 = (await a.until((m) => m.t === 'state' && m.ack === 'm0')) as StateMsg<ToyView>;
    await b.atLeast(s1.seq);
    // 被拒的操作（不轮到他）：不写存储，也就不提交
    const before = (await pg().log()).length;
    a.act('bad', { card: 1 });
    await a.until((m) => m.t === 'error');
    expect((await pg().log()).length).toBe(before);
    const log = (await pg().log()).filter((c) => c.ns === 'room');
    expect(log.length).toBeGreaterThan(0);
    for (const c of log) expect(c.rows).toBeLessThanOrEqual(2);
  });

  it('提交在广播之前：提交慢的时候，消息等提交完才到', async () => {
    const { a, st } = await twoSeated();
    await pg().control({ delayMs: 400 });
    const t0 = performance.now();
    a.act('slow', { card: myCard(st) });
    await a.until((m) => m.t === 'state' && m.ack === 'slow');
    expect(performance.now() - t0).toBeGreaterThanOrEqual(380);
  });

  it('提交失败：这一步的消息一条都不发，连着的人以 1013 断开；PG 里还是上一步，重连拿到的就是它', async () => {
    const { code, a, b, st } = await twoSeated();
    await pg().control({ fail: 1 });
    a.act('lost', { card: myCard(st) });
    expect(await a.closedWith()).toBe(CLOSE.tryLater);
    expect(await b.closedWith()).toBe(CLOSE.tryLater);
    expect(a.msgs.some((m) => m.t === 'state' && m.ack === 'lost')).toBe(false);
    // 出的那张没落盘（之后两人掉线那两步照常提交，seq 会往前走，但牌局还是出牌前的样子）
    expect((await roomRow<{ game: { played: unknown[] } }>(stub(code), code))!.game.played).toEqual([]);
    const again = await join(code, 'a');
    expect(again.welcome.room.status).toBe('playing');
    expect(again.welcome.view?.mine).toContain(myCard(st));
  });

  it('重启（内存存储清空、闹钟没了）后 kitWake 从 PG 读回来、按存的闹钟重设；重复调没有副作用；到点照常响', async () => {
    const code = await openRoom('host');
    const at = await alarmOf(code);
    expect(at).toBe(Date.now() + 10 * 60_000);
    const saved = (await pg().alarms('toy')).find((x) => x.ns === 'room' && x.name === code);
    expect(saved?.alarmAt).toBe(at);
    // 进程重启：内存存储（含闹钟、记下的房间码）全清，对象重建
    await runInDurableObject(stub(code), async (_r: ToyRoom, s) => {
      await s.storage.deleteAlarm();
      await s.storage.deleteAll();
    });
    await evictDurableObject(stub(code));
    expect(await alarmOf(code)).toBeNull();
    await stub(code).kitWake(code);
    expect(await alarmOf(code)).toBe(at);
    const writes = (await pg().log()).length;
    await stub(code).kitWake(code);
    await stub(code).kitWake(code);
    expect(await alarmOf(code)).toBe(at);
    expect((await pg().log()).length).toBe(writes);
    // 没人来：10 分钟到点关房，PG 里的行和闹钟一起删掉
    advance(10 * 60_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await roomRow(stub(code), code)).toBeNull();
    expect((await pg().alarms('toy')).some((x) => x.ns === 'room' && x.name === code)).toBe(false);
  });

  it('闹钟响时 PG 读不进来：这次用掉的闹钟 60 秒后补一个，PG 好了照常处理', async () => {
    const code = await openRoom('host');
    // 进程重启，镜像也没了；PG 这时连不上
    await runInDurableObject(stub(code), (r: ToyRoom) => (r as unknown as { pg: { drop(): void } }).pg.drop());
    await pg().control({ failLoad: 1 });
    advance(10 * 60_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await alarmOf(code)).toBe(Date.now() + 60_000);
    // PG 好了：到点醒来照常关房（10 分钟没真人）
    advance(60_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await roomRow(stub(code), code)).toBeNull();
  });

  it('重启后直接进房（不等 kitWake）：按 acceptJoin 带的房间码从 PG 读回来，接着玩', async () => {
    const { code, st } = await twoSeated();
    await runInDurableObject(stub(code), async (_r: ToyRoom, s) => {
      await s.storage.deleteAlarm();
      await s.storage.deleteAll();
    });
    await evictDurableObject(stub(code));
    const back = await join(code, 'a');
    expect(back.welcome.room.status).toBe('playing');
    expect(back.welcome.view?.mine).toContain(myCard(st));
  });

  it('计量、排队也有 kitWake：计量只读回来，排队按存的闹钟重设；都幂等', async () => {
    const m = meterStub(env.METER) as DurableObjectStub<RoomMeter>;
    await m.kitWake('kit-meter');
    await m.kitWake('kit-meter');
    expect((await m.kitUsage()).writes).toBe(0);
    const q = matchStub(env.MATCH, 'fun-1') as unknown as { kitWake(n: string): Promise<void> };
    await q.kitWake('kit-match:fun-1');
    await q.kitWake('kit-match:fun-1');
    // 队里没人、PG 里也没存闹钟：什么都不设
    expect(await runInDurableObject(matchStub(env.MATCH, 'fun-1'), (_q: unknown, s) => s.storage.getAlarm())).toBeNull();
  });

  it('进房猜码的计数在 PG 里（kit-miss:<key>），读改写在镜像里同步做完', async () => {
    const key = 'u:pg-guesser';
    const s = (await import('../src/internal.ts')).missStub(env.METER, key) as DurableObjectStub<RoomMeter>;
    expect(await s.kitMiss(key)).toBe(1);
    expect(await s.kitMiss(key)).toBe(2);
    const rows = (await pg().load('toy', 'meter', `kit-miss:${key}`)).rows;
    expect(rows.map(([t, k]) => `${t}/${k}`)).toEqual(['kv/miss']);
    expect(await s.kitMisses(key)).toBe(2);
  });
});
