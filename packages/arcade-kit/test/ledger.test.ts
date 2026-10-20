/**
 * 0.3.0 的可选接口（RoomGame.options / seatCount / seated / effects / settled / closing / free、GameRoom.perform、meterReport / meterLevel），
 * 用"记账桌"（test/ledger.ts）测。和 room.test.ts 一样跑在本地 workerd 里，每一步断言写入 ≤ 2 行。
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roomStub } from '../src/internal.ts';
import { meterLevel, meterReport } from '../src/meter.ts';
import type { StateMsg } from '../src/protocol.ts';
import { advance, type Conn, createRoom, freezeClock, join, meter, openRoom, PG, refusedWith, resetMeter, roomRow, upgrade } from './helpers.ts';
import { bank, type LedgerRoom, type LedgerState, type LedgerView, type ToyBank } from './ledger.ts';

const P = '/ledger';

/** 用真时间等条件成立（vi.waitFor 在假时钟下会把 Date 往前拨） */
async function poll(ok: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met');
}

beforeEach(async () => {
  freezeClock();
  await resetMeter();
  await runInDurableObject(bank(env), (b: ToyBank) => {
    b.down = false;
    b.keep = false;
    b.calls.clear();
    b.done.clear();
  });
});

const ledgerStub = (code: string) => roomStub(env.LEDGER_ROOM, code) as DurableObjectStub<LedgerRoom>;

async function inspect(code: string) {
  // 两种存储都能读（0.21.0）：PG 模式那一行在假 PG 里
  const v = await roomRow(ledgerStub(code), code);
  return runInDurableObject(ledgerStub(code), async (room: LedgerRoom, state) => {
    const hasTable = v !== null;
    const row = v !== null ? { v: JSON.stringify(v) } : undefined;
    return {
      last: room.lastStepWrites,
      max: room.maxStepWrites,
      persist: row
        ? (JSON.parse(row.v) as {
            game: LedgerState;
            ending?: unknown;
            effectsAt?: number | null;
            effectTries?: number;
            status: string;
            seq: number;
            turnSeq: number;
            turnSince: number;
            noHumanSince: number | null;
          })
        : null,
      hasTable,
      alarm: await state.storage.getAlarm(),
    };
  });
}

const bankState = () =>
  runInDurableObject(bank(env), (b: ToyBank) => ({ calls: Object.fromEntries(b.calls), done: Object.fromEntries(b.done) }));
const setBank = (down: boolean) =>
  runInDurableObject(bank(env), (b: ToyBank) => {
    b.down = down;
  });

const view = (m: StateMsg<unknown>) => m.frames.at(-1)!.view as LedgerView;
/** 等到这条连接看到满足条件的状态 */
const seen = async (c: Conn, pred: (v: LedgerView) => boolean) =>
  (await c.until((m) => m.t === 'state' && m.frames.length > 0 && m.frames.at(-1)!.view !== null && pred(view(m as StateMsg<unknown>)))) as StateMsg<unknown>;

async function writesOk(code: string) {
  const { last, max } = await inspect(code);
  expect(last).toBeLessThanOrEqual(2);
  expect(max).toBeLessThanOrEqual(2);
}

/** 开房，u1（房主，0 号位）和 u2（1 号位）坐好 */
async function twoSeated() {
  const code = await openRoom('u1', P);
  const host = (await join(code, 'u1', P)).conn;
  const guest = (await join(code, 'u2', P)).conn;
  guest.send({ t: 'sit', seat: 1 });
  await guest.until((m) => m.t === 'state' && m.you.seat === 1);
  return { code, host, guest };
}

describe('开局选项（options / seatCount）', () => {
  it('选项不合格 bad_options；有真人坐在用不到的座位上 seat_closed；合格就开局，只给用到的座位补电脑，后面的座位一直空着', async () => {
    const code = await openRoom('u1', P);
    const host = (await join(code, 'u1', P)).conn;
    const guest = (await join(code, 'u2', P)).conn;
    guest.send({ t: 'sit', seat: 3 });
    await guest.until((m) => m.t === 'state' && m.you.seat === 3);
    host.send({ t: 'start', opts: { seats: 2, buyIn: 50 } });
    expect(await host.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_closed' });
    host.send({ t: 'start', opts: { seats: 9, buyIn: 50 } });
    expect(await host.until((m) => m.t === 'error')).toMatchObject({ code: 'bad_options' });
    expect((await inspect(code)).persist!.status).toBe('waiting');

    guest.send({ t: 'sit', seat: 1 });
    await guest.until((m) => m.t === 'state' && m.you.seat === 1);
    host.send({ t: 'start', opts: { seats: 3, buyIn: 50 } });
    const started = await seen(host, (v) => v.pending === 0);
    expect(started.room.seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai', 'empty']);
    const { persist } = await inspect(code);
    expect(persist!.game.opts).toEqual({ seats: 3, buyIn: 50 });
    expect(persist!.game.kinds).toEqual(['human', 'human', 'ai', 'empty']);
    expect(persist!.game.chips).toEqual([50, 50, 50, 0]);
    // 后面的座位一直空着：开打以后谁也坐不进去
    const late = (await join(code, 'u3', P)).conn;
    late.send({ t: 'sit', seat: 3 });
    expect(await late.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_taken' });
    await writesOk(code);
  });
});

describe('开房就定选项（0.4.0）', () => {
  it('开房带选项：校验过的进 RoomInfo.opts，所有人进房就看到；开房仍是建表 2 + 状态 1 + 闹钟 1 行', async () => {
    const code = await openRoom('u1', P, { seats: 3, buyIn: 50 });
    expect((await inspect(code)).last).toBe(PG ? 2 : 4);
    const host = await join(code, 'u1', P);
    const guest = await join(code, 'u2', P);
    expect(host.welcome.room.opts).toEqual({ seats: 3, buyIn: 50 });
    expect(guest.welcome.room.opts).toEqual({ seats: 3, buyIn: 50 });
    guest.conn.send({ t: 'sit', seat: 1 });
    const st = (await guest.conn.until((m) => m.t === 'state' && m.you.seat === 1)) as StateMsg<unknown>;
    expect(st.room.opts).toEqual({ seats: 3, buyIn: 50 });
  });

  it('等人时坐到这一局用不到的座位：seat_closed，什么都不写；用得到的照常坐', async () => {
    const code = await openRoom('u1', P, { seats: 2, buyIn: 50 });
    await join(code, 'u1', P);
    const guest = (await join(code, 'u2', P)).conn;
    for (const seat of [2, 3]) {
      guest.send({ t: 'sit', seat });
      expect(await guest.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_closed' });
      expect((await inspect(code)).last).toBe(0);
    }
    guest.send({ t: 'sit', seat: 1 });
    await guest.until((m) => m.t === 'state' && m.you.seat === 1);
  });

  it('开打时以开房定的为准：start 带的 opts 不看（合格的不换，不合格的也不拒）', async () => {
    const code = await openRoom('u1', P, { seats: 3, buyIn: 50 });
    const host = (await join(code, 'u1', P)).conn;
    const guest = (await join(code, 'u2', P)).conn;
    guest.send({ t: 'sit', seat: 1 });
    await guest.until((m) => m.t === 'state' && m.you.seat === 1);
    host.send({ t: 'start', opts: { seats: 2, buyIn: 10 } });
    const started = await seen(host, (v) => v.pending === 0);
    expect(started.room.seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai', 'empty']);
    expect(started.room.opts).toEqual({ seats: 3, buyIn: 50 });
    const { persist } = await inspect(code);
    expect(persist!.game.opts).toEqual({ seats: 3, buyIn: 50 });
    expect(persist!.game.chips).toEqual([50, 50, 50, 0]);
    await writesOk(code);
    // 不合格的也一样不看
    const code2 = await openRoom('u3', P, { seats: 2, buyIn: 50 });
    const host2 = (await join(code2, 'u3', P)).conn;
    host2.send({ t: 'start', opts: { seats: 9, buyIn: 999 } });
    expect((await seen(host2, (v) => v.pending === 0)).room.seats.map((s) => s.kind)).toEqual(['human', 'ai', 'empty', 'empty']);
  });

  it('开房选项不合格：400 bad_options，不建房间、不占名额（同一个人马上还能开）', async () => {
    const before = await meter().kitUsage();
    for (const bad of [null, { seats: 9, buyIn: 50 }, { seats: 1, buyIn: 50 }, 'x']) {
      const res = await createRoom('u1', P, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_options' });
    }
    expect(await meter().kitUsage()).toEqual(before);
    expect((await createRoom('u1', P, { seats: 2, buyIn: 1 })).status).toBe(201);
  });

  it('不带选项开的房间和以前一样：没有 opts，等人时哪个座位都能坐，开打时由 start 定', async () => {
    const code = await openRoom('u1', P);
    const host = await join(code, 'u1', P);
    expect(host.welcome.room).not.toHaveProperty('opts');
    const guest = (await join(code, 'u2', P)).conn;
    guest.send({ t: 'sit', seat: 3 });
    const st = (await guest.until((m) => m.t === 'state' && m.you.seat === 3)) as StateMsg<unknown>;
    expect(st.room).not.toHaveProperty('opts');
    expect((await inspect(code)).persist).not.toHaveProperty('opts');
  });

  it('游戏没写 options 的（比大小）：开房带了选项也不看，房间和以前一模一样', async () => {
    const code = await openRoom('u1', '', { seats: 2 });
    const { welcome } = await join(code, 'u1');
    expect(welcome.room).not.toHaveProperty('opts');
    expect(welcome.room.seats).toHaveLength(4);
  });
});

describe('对外的事（effects / perform / settled）', () => {
  it('开局时真人的买入交给 perform 去办，办完写回状态（1 行），每笔只办一次；每一步写入 ≤ 2 行', async () => {
    const { code, host } = await twoSeated();
    host.send({ t: 'start' });
    const v = view(await seen(host, (x) => x.pending === 0 && x.chips[0] === 100));
    expect(v.chips).toEqual([100, 100, 100, 100]);
    expect(v.log).toEqual(['e0', 'e1']);
    const b = await bankState();
    expect(b.calls).toEqual({ e0: 1, e1: 1 });
    expect(b.done).toEqual({ e0: { userId: 'u1', kind: 'debit', amount: 100 }, e1: { userId: 'u2', kind: 'debit', amount: 100 } });
    // 写回那一步只写状态 1 行
    expect((await inspect(code)).last).toBe(1);
    await writesOk(code);
  });

  it('办失败了：记下退避时间、设闹钟（≤ 2 行），不在每一步都去碰；到点醒来重试成功', async () => {
    const { code, host } = await twoSeated();
    await setBank(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.send({ t: 'start' });
    await host.state();
    await poll(async () => (await inspect(code)).persist!.effectTries === 1);
    const first = await inspect(code);
    expect(first.persist!.effectsAt).toBe(Date.now() + 15_000);
    expect(first.alarm).toBe(Date.now() + 15_000);
    expect(first.persist!.game.pending).toHaveLength(2);
    await writesOk(code);
    // 没到点：有人出手也不重试（不然银行一直挂着时每一步都多一次调用）
    host.act('p0', { t: 'pass' });
    await host.until((m) => m.t === 'state' && m.ack === 'p0');
    expect((await bankState()).calls).toEqual({});
    // 到点再失败一次：退避翻倍
    advance(15_000);
    await runDurableObjectAlarm(ledgerStub(code));
    expect((await inspect(code)).persist!).toMatchObject({ effectTries: 2, effectsAt: Date.now() + 30_000 });
    await setBank(false);
    advance(30_000);
    await runDurableObjectAlarm(ledgerStub(code));
    const done = await inspect(code);
    expect(done.persist!.game.pending).toEqual([]);
    expect(done.persist!).toMatchObject({ effectTries: 0, effectsAt: null });
    expect(done.persist!.game.chips.slice(0, 2)).toEqual([100, 100]);
    await writesOk(code);
    err.mockRestore();
  });

  it('游戏的 settled 写错了（办完的事还留在 effects 里）：记日志、交给退避，不在每一步之后反复重办', async () => {
    const { code, host } = await twoSeated();
    await runInDurableObject(bank(env), (b: ToyBank) => {
      b.keep = true;
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.send({ t: 'start' });
    await host.state();
    await poll(async () => (await inspect(code)).persist!.effectTries === 1);
    // 每笔只办了一次（不是 EFFECT_ROUNDS 轮），记下退避
    expect((await bankState()).calls).toEqual({ e0: 1, e1: 1 });
    expect((await inspect(code)).persist!.effectsAt).toBe(Date.now() + 15_000);
    expect(err.mock.calls.some((c) => String(c[0]).includes('left effects pending'))).toBe(true);
    // 没到点，有人出手也不重办
    host.act('p0', { t: 'pass' });
    await host.until((m) => m.t === 'state' && m.ack === 'p0');
    expect((await bankState()).calls).toEqual({ e0: 1, e1: 1 });
    await writesOk(code);
    // 游戏修好了（这里是银行不再带 keep）：到点重办一次，写回
    await runInDurableObject(bank(env), (b: ToyBank) => {
      b.keep = false;
    });
    advance(15_000);
    await runDurableObjectAlarm(ledgerStub(code));
    await poll(async () => (await inspect(code)).persist!.game.pending.length === 0);
    expect((await bankState()).calls).toEqual({ e0: 2, e1: 2 });
    expect((await inspect(code)).persist!).toMatchObject({ effectTries: 0, effectsAt: null });
    err.mockRestore();
  });
});

describe('座位换人（seated）', () => {
  it('开打后有人接管电脑的座位：游戏知道换成了真人，买入照办；离座交给电脑：游戏知道换成了电脑。都和入座、离座那一步一起写', async () => {
    const { code, host } = await twoSeated();
    host.send({ t: 'start' });
    await seen(host, (v) => v.pending === 0);
    const c = (await join(code, 'u3', P)).conn;
    c.send({ t: 'sit', seat: 2 });
    const v = view(await seen(c, (x) => x.kinds[2] === 'human' && x.pending === 0));
    expect(v.chips[2]).toBe(100);
    expect((await bankState()).done.e2).toEqual({ userId: 'u3', kind: 'debit', amount: 100 });
    c.send({ t: 'leave' });
    await seen(host, (x) => x.kinds[2] === 'ai');
    expect((await inspect(code)).last).toBe(1);
    // 主人回到自己的座位：游戏照样收到 human，按自己的状态认出是同一个人，筹码不动、不再扣买入
    c.send({ t: 'sit', seat: 2 });
    const back = view(await seen(c, (x) => x.kinds[2] === 'human'));
    expect(back.chips[2]).toBe(100);
    expect(back.pending).toBe(0);
    await writesOk(code);
  });
});

describe('不轮流的操作（free）', () => {
  it('不轮到也能发、旧的 baseSeq 不算 stale；该谁出手没变就不改期限和 turnSeq，轮到的人照常出', async () => {
    const { code, host, guest } = await twoSeated();
    host.send({ t: 'start' });
    await seen(host, (v) => v.pending === 0 && v.chips[1] === 100);
    await seen(guest, (v) => v.pending === 0 && v.chips[1] === 100);
    const before = await inspect(code);
    const turnSeq = before.persist!.turnSeq;
    // 轮到 0 号；1 号用很旧的 baseSeq 发两个不轮流的操作
    advance(5_000);
    guest.act('w1', { t: 'wave' }, 0);
    const w = (await guest.until((m) => m.t === 'state' && m.ack === 'w1')) as StateMsg<unknown>;
    expect(view(w).log.at(-1)).toBe('wave1');
    expect(w.room.turn).toMatchObject({ seat: 0, deadline: before.persist!.turnSince + 30_000 });
    guest.act('c1', { t: 'cashout' }, 0);
    await seen(guest, (v) => v.chips[1] === 0 && v.pending === 0);
    expect((await bankState()).done.e2).toEqual({ userId: 'u2', kind: 'credit', amount: 100 });
    const after = await inspect(code);
    expect(after.persist!.turnSeq).toBe(turnSeq);
    // 0 号拿开局时看到的 seq 出手，不算 stale
    host.act('p0', { t: 'pass' }, before.persist!.seq);
    expect(await host.until((m) => (m.t === 'state' && m.ack === 'p0') || m.t === 'error')).toMatchObject({ t: 'state' });
    // 轮流的操作照旧要轮到才行
    guest.act('p1', { t: 'pass' }, 0);
    expect(await guest.until((m) => m.t === 'error' && m.moveId === 'p1')).toMatchObject({ code: 'stale' });
    await writesOk(code);
  });
});

describe('等外面的事（waiting，0.3.2）', () => {
  it('谁也不用出手、游戏说在等：不当出错，不计时、不驱动电脑、不写；有人发不轮流的操作，接着打', async () => {
    const errors = vi.spyOn(console, 'error');
    const { code, host, guest } = await twoSeated();
    host.send({ t: 'start' });
    await seen(host, (v) => v.pending === 0 && v.chips[1] === 100);
    const t0 = Date.now();
    host.act('n', { t: 'nap' });
    const napped = (await host.until((m) => m.t === 'state' && m.ack === 'n')) as StateMsg<unknown>;
    expect(napped.room.status).toBe('playing');
    expect(napped.room.turn).toBeNull();
    await writesOk(code);
    // 开局时设的这一手的闹钟到点：没有要代出的，只把闹钟改到房间寿命，牌局不动
    advance(30_000);
    expect(await runDurableObjectAlarm(ledgerStub(code))).toBe(true);
    const idle = await inspect(code);
    expect(idle.persist!.status).toBe('playing');
    expect(idle.persist!.game.moves).toBe(0);
    expect(idle.alarm).toBe(t0 + 3 * 3_600_000);
    // 之后一直等着：闹钟就算被叫醒也没有到期的事，牌局一行不写
    const seq = idle.persist!.seq;
    advance(20 * 60_000);
    await runDurableObjectAlarm(ledgerStub(code));
    const still = await inspect(code);
    expect(still.persist!.seq).toBe(seq);
    expect(still.alarm).toBe(t0 + 3 * 3_600_000);
    // 回来：轮到 0 号，从现在算 30 秒；出完电脑接着出，轮到 1 号
    guest.act('w', { t: 'wake' });
    const woke = (await host.until((m) => m.t === 'state' && m.room.turn !== null)) as StateMsg<unknown>;
    expect(woke.room.turn).toMatchObject({ seat: 0, deadline: Date.now() + 30_000 });
    host.act('p0', { t: 'pass' });
    expect((await seen(guest, (v) => v.turn === 1)).room.turn).toMatchObject({ seat: 1 });
    expect(errors.mock.calls.some((c) => c[0] === 'game has nobody to act but is not over')).toBe(false);
    await writesOk(code);
    errors.mockRestore();
  });
});

describe('关房前先结算（closing）', () => {
  it('没人 10 分钟关房：先断开所有人、留着存储把桌上的筹码结回去，办完再删；关着的房间进不来', async () => {
    const { code, host, guest } = await twoSeated();
    host.send({ t: 'start' });
    await seen(host, (v) => v.pending === 0 && v.chips[1] === 100);
    await setBank(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.ws.close(1000, 'bye');
    guest.ws.close(1000, 'bye');
    await host.closedWith();
    await poll(async () => (await inspect(code)).persist!.noHumanSince != null);
    advance(10 * 60_000);
    await runDurableObjectAlarm(ledgerStub(code));
    const ending = await inspect(code);
    expect(ending.persist!.ending).toMatchObject({ reason: 'room closed' });
    expect(ending.persist!.game.pending.map((e) => [e.seat, e.kind, e.amount])).toEqual([
      [0, 'credit', 100],
      [1, 'credit', 100],
    ]);
    expect(ending.max).toBeLessThanOrEqual(2);
    // 正在关：进不来
    expect(await refusedWith(await upgrade(code, 'u1', { prefix: P }))).toBe(4000);
    await setBank(false);
    advance(15_000);
    await runDurableObjectAlarm(ledgerStub(code));
    const gone = await inspect(code);
    expect(gone.hasTable).toBe(false);
    expect(gone.alarm).toBeNull();
    const b = await bankState();
    expect(Object.values(b.done).filter((d) => d.kind === 'credit')).toEqual([
      { userId: 'u1', kind: 'credit', amount: 100 },
      { userId: 'u2', kind: 'credit', amount: 100 },
    ]);
    err.mockRestore();
  });

  it('关房时一直办不完：到了 closingMs 记日志照样删，不会永远留着', async () => {
    const { code, host } = await twoSeated();
    host.send({ t: 'start' });
    await seen(host, (v) => v.pending === 0 && v.chips[1] === 100);
    await setBank(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    advance(3 * 3_600_000);
    await runDurableObjectAlarm(ledgerStub(code));
    expect((await inspect(code)).persist!.ending).toBeTruthy();
    for (let i = 0; i < 20 && (await inspect(code)).hasTable; i++) {
      const { alarm } = await inspect(code);
      vi.setSystemTime(alarm!);
      await runDurableObjectAlarm(ledgerStub(code));
      await writesOk(code);
    }
    expect((await inspect(code)).hasTable).toBe(false);
    expect(err.mock.calls.some((c) => String(c[0]).includes('giving up'))).toBe(true);
    err.mockRestore();
  });

  it('房间关的时候没有要办的事：和以前一样马上删', async () => {
    const code = await openRoom('solo', P);
    await join(code, 'solo', P);
    advance(3 * 3_600_000);
    await runDurableObjectAlarm(ledgerStub(code));
    expect((await inspect(code)).hasTable).toBe(false);
  });
});

describe('房间以外的 DO 用计量（meterReport / meterLevel）', () => {
  it('报数记进当天的数（计量自己再记 1 行），回门槛；没绑 METER 时回 ok、什么都不做', async () => {
    const before = await meter().kitUsage();
    expect(await meterReport(env, 5)).toBe('ok');
    expect((await meter().kitUsage()).writes).toBe(before.writes + 6);
    expect(await meterLevel(env)).toBe('ok');
    expect(await meterReport({}, 5)).toBe('ok');
    expect(await meterLevel({})).toBe('ok');
  });
});
