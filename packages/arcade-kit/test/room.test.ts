/**
 * 房间基类（docs/platform-backend.md 第 4 节）：真的 Durable Object（SQLite）、真的 WebSocket 休眠接口和闹钟，跑在本地 workerd 里。
 * 每个用例断言每一步写入 ≤ 2 行（4.2）；开房那一步如实算上建表。
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateMsg } from '../src/protocol.ts';
import { identityHeader, KIT_HOST, roomStub, SESSION_COOKIE } from '../src/internal.ts';
import { isEntropy } from '../src/rng.ts';
import roomSrc from '../src/room.ts?raw';
import { advance, Conn, freezeClock, inspect, join, openRoom, refusedWith, resetMeter, stub, upgrade } from './helpers.ts';
import type { RoomGame } from '../src/game.ts';
import { SITE, type ToyAction, type ToyRoom, type ToyView, toyGame } from './worker.ts';
import { env, exports } from 'cloudflare:workers';

beforeEach(async () => {
  freezeClock();
  await resetMeter();
});

/** 开房、4 个人进来坐好（u1 是房主在 0 号位，其余按 1、2、3 坐）。 */
async function fullTable() {
  const code = await openRoom('u1');
  const conns: Conn[] = [];
  conns.push((await join(code, 'u1')).conn);
  for (const [i, u] of ['u2', 'u3', 'u4'].entries()) {
    const c = (await join(code, u)).conn;
    c.send({ t: 'sit', seat: i + 1 });
    await c.until((m) => m.t === 'state' && m.you.seat === i + 1);
    conns.push(c);
  }
  // 广播到达各连接有先后：等每条连接都看到最后一次入座
  const seq = (await inspect(code)).persist.seq as number;
  for (const c of conns) await c.atLeast(seq);
  return { code, conns };
}

/** 某个座位出一张牌：等它自己的 ack，再等其余连接看到同一步。返回所有连接收到的那条状态。 */
async function play(conns: (Conn | null)[], seat: number, moveId: string, card: number): Promise<(StateMsg<ToyView> | null)[]> {
  conns[seat]!.act(moveId, { card });
  const mine = (await conns[seat]!.until((m) => m.t === 'state' && m.ack === moveId)) as StateMsg<ToyView>;
  return Promise.all(conns.map((c, k) => (c === null ? null : k === seat ? mine : c.atLeast(mine.seq))));
}

/** 开局，等所有连接收到。 */
async function startAll(conns: Conn[]): Promise<StateMsg<ToyView>[]> {
  conns[0]!.send({ t: 'start' });
  const first = await conns[0]!.state();
  return Promise.all(conns.map((c, k) => (k === 0 ? first : c.atLeast(first.seq))));
}

const lastView = (m: StateMsg<ToyView>) => m.frames.at(-1)!.view;
const hands = async (code: string) => ((await inspect(code)).persist.game.hands as number[][]).map((h) => [...h]);
const played = async (code: string) => ((await inspect(code)).persist.game.played as unknown[]).length;
const alarmOf = (code: string) => runInDurableObject(stub(code), (_r: ToyRoom, s) => s.storage.getAlarm());
/** 让房间接下来 n 次 setAlarm 抛错（模拟存储一时出错） */
const failSetAlarm = (code: string, n: number) =>
  runInDurableObject(stub(code), (_r: ToyRoom, state) => {
    const real = state.storage.setAlarm.bind(state.storage);
    let left = n;
    state.storage.setAlarm = async (...args: Parameters<typeof real>) => {
      if (left-- > 0) throw new Error('storage broke');
      return real(...args);
    };
  });
/** 把房间实例上的 limits / game 换掉（测试里调小上限、让游戏代码出错）。 */
const patchRoom = (code: string, patch: Record<string, unknown>) =>
  runInDurableObject(stub(code), (room: ToyRoom) => {
    Object.assign(room as unknown as Record<string, unknown>, patch);
  });
const limitsOf = (code: string) => runInDurableObject(stub(code), (room: ToyRoom) => ({ ...(room as unknown as { limits: object }).limits }));
/** 等一小会儿，确认没有新消息 */
const quiet = () => new Promise((ok) => setTimeout(ok, 100));

async function writesOk(code: string) {
  const { last, max } = await inspect(code);
  expect(last).toBeLessThanOrEqual(2);
  expect(max).toBeLessThanOrEqual(2);
}

describe('开房、进房', () => {
  it('开房：建表 2 行 + 状态 1 行 + 设"没人 10 分钟"的闹钟 1 行，一个房间只这一次；房主连上写 1 行，收到快照坐在 0 号位', async () => {
    const code = await openRoom('host');
    expect(code).toMatch(/^\d{6}$/);
    expect((await inspect(code)).last).toBe(4);
    expect(await alarmOf(code)).toBe(Date.now() + 10 * 60_000);
    const { welcome } = await join(code, 'host');
    expect(welcome).toMatchObject({ v: 1, you: { seat: 0 }, room: { code, status: 'waiting' }, view: null });
    expect(welcome.room.seats.map((s) => s.kind)).toEqual(['human', 'empty', 'empty', 'empty']);
    expect((await inspect(code)).last).toBe(1);
  });

  it('探一个不存在的房间码：4004，写 0 行，不建表，存储里什么都不留', async () => {
    expect(await refusedWith(await upgrade('000001', 'prober'))).toBe(4004);
    const probe = await inspect('000001');
    expect(probe).toMatchObject({ last: 0, max: 0, hasTable: false, persist: null });
    expect(await alarmOf('000001')).toBeNull();
    // 对照：一个开过的房间存储不是空的
    const code = await openRoom('cmp');
    expect((await inspect(code)).size).toBeGreaterThan(probe.size);
  });

  it('没入座的人进来、离开：不写库、不广播；在线时又连一次（换设备）：旧连接 4001，不写库', async () => {
    const code = await openRoom('h0');
    const host = (await join(code, 'h0')).conn;
    host.drain();
    const w = await join(code, 'watcher');
    expect(w.welcome.you.seat).toBeNull();
    expect((await inspect(code)).last).toBe(0);
    w.conn.ws.close(1000, 'bye');
    await w.conn.closedWith();
    await quiet();
    expect((await inspect(code)).last).toBe(0);
    const again = await join(code, 'h0');
    expect(await host.closedWith()).toBe(4001);
    expect(again.welcome.you.seat).toBe(0);
    expect((await inspect(code)).last).toBe(0);
    await quiet();
    // 旧连接让位不算"掉线"：座位还是在线
    expect((await inspect(code)).persist.seats[0].awaySince).toBeNull();
    expect(host.msgs.filter((m) => m.t === 'state')).toHaveLength(0);
  });
});

describe('4 人入座、轮流出手', () => {
  it('开局后每人只看到自己的手牌；按顺序出完 12 张，所有人看到一样的公开信息；每一步写入 ≤ 2 行', async () => {
    const { code, conns } = await fullTable();
    const starts = await startAll(conns);
    const initial = await hands(code);
    for (const [seat, m] of starts.entries()) {
      expect(m.you.seat).toBe(seat);
      expect(lastView(m).mine).toEqual(initial[seat]);
      expect(m.room).toMatchObject({ status: 'playing', turn: { seat: 0, deadline: Date.now() + 30_000 } });
    }
    await writesOk(code);

    for (let step = 0; step < 12; step++) {
      const seat = step % 4;
      const cur = await hands(code);
      const card = cur[seat]![0]!;
      const got = (await play(conns, seat, `m${step}`, card)) as StateMsg<ToyView>[];
      expect(got[seat]!.ack).toBe(`m${step}`);
      for (const [k, m] of got.entries()) {
        expect(m.seq).toBe(got[0]!.seq);
        expect(lastView(m).played.at(-1)).toEqual({ seat, card });
        if (k !== seat) expect(m.ack).toBeUndefined();
      }
      // 出牌这一步：状态 1 行；下一手的期限往后推，不动闹钟
      expect((await inspect(code)).last).toBe(1);
    }
    const end = await inspect(code);
    expect(end.persist.status).toBe('over');
    expect(end.persist.game.played).toHaveLength(12);
    expect(end.max).toBeLessThanOrEqual(2);
    // 0.1.0 不记回放：存储里没有种子和操作记录
    expect(end.persist).not.toHaveProperty('seed');
    expect(end.persist).not.toHaveProperty('log');
  });

  it('不该你出、牌不在手里、格式不对、没带 baseSeq、没入座：都拒绝，状态和 seq 不变，不写库', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const before = await inspect(code);
    const base = conns[0]!.latestSeq();
    const cases: [Conn, unknown, string][] = [
      [conns[1]!, { t: 'act', moveId: 'a', baseSeq: base, action: { card: (await hands(code))[1]![0] } }, 'not_your_turn'],
      [conns[0]!, { t: 'act', moveId: 'b', baseSeq: base, action: { card: 1000 } }, 'no_such_card'],
      [conns[0]!, { t: 'act', moveId: 'c', baseSeq: base, action: { card: 'x' } }, 'bad_action'],
      [conns[0]!, { t: 'act', baseSeq: base, action: { card: 1 } }, 'bad_message'],
      [conns[0]!, { t: 'act', moveId: 'd', action: { card: 1 } }, 'bad_message'],
      [conns[0]!, 'not json', 'bad_message'],
      [conns[0]!, { t: 'start' }, 'already_started'],
    ];
    for (const [c, msg, code_] of cases) {
      c.send(msg);
      expect(await c.until((m) => m.t === 'error'), JSON.stringify(msg)).toMatchObject({ code: code_ });
      expect((await inspect(code)).last).toBe(0);
    }
    expect((await inspect(code)).persist.seq).toBe(before.persist.seq);
  });

  it('游戏的错误码里夹带了信息（不合格式）：换成 illegal_move 再发，手牌不会漏出去', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    conns[0]!.act('leak', { card: 0 });
    const err = await conns[0]!.until((m) => m.t === 'error');
    expect(err).toEqual({ t: 'error', code: 'illegal_move', moveId: 'leak' });
    expect((await inspect(code)).last).toBe(0);
  });

  it('同一个 moveId 重发（断线重连后补发）：只做一次，回 ack 和当前状态', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const card = (await hands(code))[0]![0]!;
    const base = conns[0]!.latestSeq();
    const [first] = (await play(conns, 0, 'same', card)) as StateMsg<ToyView>[];
    conns[0]!.act('same', { card }, base);
    const again = (await conns[0]!.until((m) => m.t === 'state' && m.ack === 'same')) as StateMsg<ToyView>;
    expect(again.ack).toBe('same');
    expect(again.seq).toBe(first!.seq);
    expect(await played(code)).toBe(1);
    expect((await inspect(code)).last).toBe(0);
  });

  it('补发的 moveId 不是最后一个（0.11.1）：A 的 ack 丢了、之后又做成了 B，补发 A 仍然认得出是重复，只回 ack', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const baseA = conns[0]!.latestSeq();
    const cardA = (await hands(code))[0]![0]!;
    await play(conns, 0, 'move-a', cardA);
    for (const seat of [1, 2, 3]) await play(conns, seat, `m${seat}`, (await hands(code))[seat]![0]!);
    await play(conns, 0, 'move-b', (await hands(code))[0]![0]!);
    const before = await played(code);
    conns[0]!.act('move-a', { card: cardA }, baseA);
    const again = await conns[0]!.until((m) => (m.t === 'state' && m.ack === 'move-a') || (m.t === 'error' && m.moveId === 'move-a'));
    expect(again.t).toBe('state');
    expect(await played(code)).toBe(before);
    expect((await inspect(code)).last).toBe(0);
    const seat0 = (await inspect(code)).persist.seats[0];
    expect(seat0.recentMoves).toEqual(['move-a', 'move-b']);
  });

  it('baseSeq 过时（牌局在那之后变过）：stale，不做；只是有人进出（seq 变了、牌局没变）不算过时', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const old1 = conns[1]!.latestSeq();
    await play(conns, 0, 'p0', (await hands(code))[0]![0]!);
    // 1 号拿着出牌前的 seq 出手：牌局已经变了
    conns[1]!.act('late', { card: (await hands(code))[1]![0] }, old1);
    expect(await conns[1]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale', moveId: 'late' });
    expect(await played(code)).toBe(1);
    expect((await inspect(code)).last).toBe(0);
    // 1 号看到最新状态后，3 号掉线（seq 加一），1 号用掉线前的 seq 出手：照样做
    const base = conns[1]!.latestSeq();
    conns[3]!.ws.close(1000, 'gone');
    await conns[1]!.state();
    conns[1]!.act('ok', { card: (await hands(code))[1]![0] }, base);
    expect(await conns[1]!.until((m) => m.t === 'state' && m.ack === 'ok')).toBeTruthy();
    expect(await played(code)).toBe(2);
  });

  it('只有房主能开局：入座的别人、没入座的人都是 not_host', async () => {
    const code = await openRoom('boss');
    const host = (await join(code, 'boss')).conn;
    const guest = (await join(code, 'guest')).conn;
    const stranger = (await join(code, 'stranger')).conn;
    guest.send({ t: 'sit', seat: 1 });
    await guest.until((m) => m.t === 'state' && m.you.seat === 1);
    for (const c of [guest, stranger]) {
      c.send({ t: 'start' });
      expect(await c.until((m) => m.t === 'error')).toMatchObject({ code: 'not_host' });
    }
    expect((await inspect(code)).persist.status).toBe('waiting');
    host.send({ t: 'start' });
    expect(await host.until((m) => m.t === 'state' && m.room.status === 'playing')).toBeTruthy();
  });
});

describe('隐藏信息不泄露', () => {
  it('每条下行消息里，每个座位看到的手牌只有自己的；没入座的人看不到任何手牌', async () => {
    const { code, conns } = await fullTable();
    const watcher = (await join(code, 'w1')).conn;
    const all5 = [...conns, watcher];
    await startAll(all5);
    const initial = await hands(code);
    for (let step = 0; step < 8; step++) {
      const seat = step % 4;
      await play(all5, seat, `h${step}`, (await hands(code))[seat]![0]!);
    }
    for (const [seat, c] of conns.entries()) {
      for (const m of c.msgs) {
        const views = m.t === 'state' ? m.frames.map((f) => f.view) : m.t === 'welcome' && m.view ? [m.view] : [];
        for (const v of views) {
          if (v === null) continue; // 开局前没有牌局
          expect(Object.keys(v).sort()).toEqual(['counts', 'mine', 'played', 'turn']);
          // 自己的手牌只会越来越少，永远是开局那手牌的一部分
          for (const card of v.mine!) expect(initial[seat]).toContain(card);
          expect(v.mine!.length).toBe(v.counts[seat]);
        }
      }
    }
    for (const m of watcher.msgs) {
      if (m.t === 'state') for (const f of m.frames) if (f.view) expect(f.view.mine).toBeNull();
    }
    // 牌局中途重连拿到的快照也只有自己的手牌
    conns[2]!.ws.close(1000, 'gone');
    const back = await join(code, 'u3');
    expect(back.welcome.view?.mine).toEqual((await hands(code))[2]);
    expect(back.welcome.view?.mine).toHaveLength(1);
    const all = [...conns, watcher].flatMap((c) => c.msgs.map((m) => JSON.stringify(m))).join('\n');
    expect(all).not.toMatch(/"seed"|"log"|"hands"|userId|lastMoveId|"host"/);
  });
});

describe('断线、电脑接管、回来交还', () => {
  it('掉线：座位留着（away）；轮到他时 30 秒超时代出；60 秒后电脑托管、接着替他出；再连回来交还', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const t0 = Date.now();
    // 0 号出一张，轮到 1 号；1 号掉线
    await play(conns, 0, 'x0', (await hands(code))[0]![0]!);
    conns[1]!.ws.close(1000, 'gone');
    const away = await conns[0]!.state();
    expect(away.room.seats[1]).toMatchObject({ kind: 'human', away: true, auto: false });
    await writesOk(code);
    const live = [conns[0]!, null, conns[2]!, conns[3]!];

    // 30 秒到：还没过宽限，按"最小的牌"代出一张，轮到 2 号
    const min1 = Math.min(...(await hands(code))[1]!);
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const timedOut = await conns[0]!.state();
    expect(lastView(timedOut).played.at(-1)).toEqual({ seat: 1, card: min1 });
    expect(timedOut.room.turn?.seat).toBe(2);
    expect(timedOut.room.seats[1]).toMatchObject({ away: true, auto: false });
    await writesOk(code);

    // 2、3、0 马上出完，又轮到 1 号（还没托管，期限是 t0+60s）
    for (const seat of [2, 3, 0]) await play(live, seat, `y${seat}`, (await hands(code))[seat]![0]!);
    expect((await inspect(code)).persist.turnSince).toBe(t0 + 30_000);

    // 掉线满 60 秒：电脑托管，并且马上替他出（一次广播）
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const auto = await conns[0]!.state();
    expect(auto.room.seats[1]).toMatchObject({ away: true, auto: true });
    expect(auto.frames.at(-1)!.view.played.at(-1)?.seat).toBe(1);
    expect(auto.room.turn?.seat).toBe(2);
    await writesOk(code);

    // 托管以后，0 号出完电脑接着替 1 号出，和 0 号那一步一起广播，带播放延迟
    for (const seat of [2, 3]) await play(live, seat, `z${seat}`, (await hands(code))[seat]![0]!);
    const batch = (await play(live, 0, 'z0', (await hands(code))[0]![0]!))[2]!;
    expect(batch.frames).toHaveLength(2);
    expect(batch.frames.map((f) => f.delay)).toEqual([0, 900]);
    expect(batch.frames[1]!.view.played.at(-1)?.seat).toBe(1);
    await writesOk(code);

    // 1 号回来：收到快照，座位交还，别人也看到他回来了
    const back = await join(code, 'u2');
    expect(back.welcome.you.seat).toBe(1);
    expect(back.welcome.room.seats[1]).toMatchObject({ away: false, auto: false });
    expect(back.welcome.view?.mine).toEqual((await hands(code))[1]);
    const seen = await conns[0]!.state();
    expect(seen.room.seats[1]).toMatchObject({ away: false, auto: false });
    await writesOk(code);
  });

  it('轮到自己时断线重连不重置 30 秒：不能靠隔 29 秒重连一次一直拖着', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const t0 = Date.now();
    advance(10_000);
    conns[0]!.ws.close(1000, 'gone');
    await conns[1]!.state();
    advance(10_000);
    const back = await join(code, 'u1');
    expect(back.welcome.room.turn).toEqual({ seat: 0, deadline: t0 + 30_000 });
    expect((await inspect(code)).persist.turnSince).toBe(t0);
    // 原来的期限一到照样代出
    advance(10_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await played(code)).toBe(1);
  });

  it('断线那一刻正在出牌（4.5）：先发出牌再断；重连拿到的快照已经含这一步，重发同一个 moveId 不会再出一次', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const card = (await hands(code))[0]![0]!;
    const base = conns[0]!.latestSeq();
    conns[0]!.act('race', { card }, base);
    conns[0]!.ws.close(1000, 'gone');
    const others = (await Promise.all(
      conns.slice(1).map((c) => c.until((m) => m.t === 'state' && (m.frames.at(-1)?.view?.played.length ?? 0) === 1)),
    )) as StateMsg<ToyView>[];
    const seqAfterMove = others[0]!.seq;
    const back = await join(code, 'u1');
    expect(back.welcome.view?.played).toEqual([{ seat: 0, card }]);
    expect(back.welcome.seq).toBeGreaterThan(seqAfterMove - 1);
    // 客户端按原样重发（moveId 和 baseSeq 都不变）：认出是重复的，只回 ack
    back.conn.act('race', { card }, base);
    const ack = (await back.conn.until((m) => m.t === 'state' && m.ack === 'race')) as StateMsg<ToyView>;
    expect(ack.seq).toBe(back.welcome.seq);
    expect(await played(code)).toBe(1);
    // 别人看到的 seq 连续，没有重复的
    for (const c of conns.slice(1)) {
      const seqs = c.msgs.filter((m) => m.t === 'state').map((m) => (m as StateMsg).seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }
  });

  it('真的被驱逐（构造函数重跑）：从存储重建接着打；连接和 attachment 还在；令牌桶重置成满的', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const watcher = (await join(code, 'w2')).conn;
    // 没入座的人发 9 条会被拒的消息，令牌桶剩 1 个
    for (let i = 0; i < 9; i++) watcher.send({ t: 'sit', seat: 9 });
    for (let i = 0; i < 9; i++) await watcher.until((m) => m.t === 'error');
    const before = (await inspect(code)).instanceId;
    await evictDurableObject(stub(code));
    expect((await inspect(code)).instanceId).not.toBe(before);
    const m = (await play(conns, 0, 'z', (await hands(code))[0]![0]!))[1]!;
    expect(m.room.turn?.seat).toBe(1);
    expect(m.you.seat).toBe(1);
    await writesOk(code);
    // 驱逐后令牌桶是新的：再发 9 条也不会 1008（没驱逐的话第 2 条就断了）。驱逐要先空闲一阵，这个代价可以接受
    for (let i = 0; i < 9; i++) watcher.send({ t: 'sit', seat: 9 });
    for (let i = 0; i < 9; i++) await watcher.until((m) => m.t === 'error');
    expect(watcher.closed).toBeNull();
  });
});

describe('电脑补位与接管', () => {
  it('1 个真人开局：空位电脑补满；真人出完，电脑连着出到再轮到真人，一次广播、每步带延迟', async () => {
    const code = await openRoom('solo');
    const { conn } = await join(code, 'solo');
    conn.send({ t: 'start' });
    const start = await conn.state();
    expect(start.room.seats.map((s) => s.kind)).toEqual(['human', 'ai', 'ai', 'ai']);
    const m = (await play([conn], 0, 's1', (await hands(code))[0]![0]!))[0]!;
    expect(m.frames).toHaveLength(4);
    expect(m.frames.map((f) => f.delay)).toEqual([0, 900, 900, 900]);
    expect(m.room.turn).toEqual({ seat: 0, deadline: Date.now() + 3 * 900 + 30_000 });
    expect((await inspect(code)).last).toBeLessThanOrEqual(2);
  });

  it('开打后进来的人可以接管电脑的座位，不能抢真人的座位', async () => {
    const code = await openRoom('h1');
    const host = (await join(code, 'h1')).conn;
    host.send({ t: 'start' });
    await host.state();
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 0 });
    expect(await late.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_taken' });
    late.send({ t: 'sit', seat: 2 });
    const sat = await late.until((m) => m.t === 'state' && m.you.seat === 2);
    expect(sat.t === 'state' && sat.room.seats[2]).toMatchObject({ kind: 'human', name: '玩家late' });
    await writesOk(code);
  });

  it('开打后离座：电脑接手，不判负', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    conns[3]!.send({ t: 'leave' });
    const m = await conns[0]!.state();
    expect(m.room.seats[3]).toMatchObject({ kind: 'ai', name: '玩家u4', reserved: true });
    await writesOk(code);
  });
});

describe('只用一个闹钟', () => {
  it('闹钟总是最早的到期时间；期限往后推时不重设（出牌那步只写 1 行）；到点醒来没到期就只改闹钟（1 行），不写状态', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const t0 = Date.now();
    // 开局：第一手的 30 秒是最早的
    expect(await alarmOf(code)).toBe(t0 + 30_000);
    advance(10_000);
    await play(conns, 0, 'p', (await hands(code))[0]![0]!);
    expect((await inspect(code)).last).toBe(1);
    expect(await alarmOf(code)).toBe(t0 + 30_000);
    // 到点醒来：1 号的期限是 t0+40s，还没到，只把闹钟改过去，不广播
    const seq = (await inspect(code)).persist.seq;
    advance(20_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect((await inspect(code)).last).toBe(1);
    expect((await inspect(code)).persist.seq).toBe(seq);
    expect(await alarmOf(code)).toBe(t0 + 40_000);
    const before = conns[0]!.msgs.length;
    await quiet();
    expect(conns[0]!.msgs.length).toBe(before);
  });

  it('写完状态、广播时出错：闹钟照样设上（不会丢）', async () => {
    const code = await openRoom('boom');
    const host = (await join(code, 'boom')).conn;
    let once = true;
    await patchRoom(code, {
      game: {
        ...toyGame,
        view: (s: never, seat: number | null) => {
          if (once) {
            once = false;
            throw new Error('view broke');
          }
          return toyGame.view(s, seat);
        },
      },
    });
    host.send({ t: 'start' });
    await quiet();
    const p = await inspect(code);
    expect(p.persist.status).toBe('playing');
    expect(await alarmOf(code)).toBe(Date.now() + 30_000);
  });

  it('闹钟里游戏代码出错：不往外抛，过 60 秒再醒来重试', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    await patchRoom(code, {
      game: {
        ...toyGame,
        timeout: () => {
          throw new Error('timeout broke');
        },
      },
    });
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await alarmOf(code)).toBe(Date.now() + 60_000);
    // 重试的那次 setAlarm 也算一行
    expect((await inspect(code)).last).toBe(1);
    expect((await inspect(code)).persist).not.toBeNull();
  });

  it('setAlarm 自己出错（0.11.1）：不往外抛；闹钟改回"不知道"，下一个入口按 getAlarm() 重新读、照常重排', async () => {
    const { code, conns } = await fullTable();
    await failSetAlarm(code, 1);
    await startAll(conns);
    // 开局要设的出牌超时（30 秒后）没设上，存储里还是开局前的那个
    expect(await alarmOf(code)).not.toBe(Date.now() + 30_000);
    expect((await inspect(code)).persist.status).toBe('playing');
    // 下一个事件（随便谁进出、出牌）把闹钟补上。以前内存里记着"已经设了 30 秒后"，这里会跳过，房间就一直用错的闹钟
    await play(conns, 0, 'after', (await hands(code))[0]![0]!);
    expect(await alarmOf(code)).toBe(Date.now() + 30_000);
  });

  it('闹钟里重设闹钟失败（0.11.1）：过 60 秒再醒来，不会从此没有闹钟', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    await failSetAlarm(code, 1);
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await alarmOf(code)).toBe(Date.now() + 60_000);
  });

  it('开房碰到已经在的房间码（exists）：不清掉"每步最多写几行"的统计', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const before = (await inspect(code)).max;
    expect(before).toBeGreaterThan(0);
    const out = await runInDurableObject(stub(code), (room: ToyRoom) => room.kitCreate(code, { userId: 'x', name: 'x' }));
    expect(out).toEqual({ r: 'exists' });
    expect((await inspect(code)).max).toBe(before);
  });

  it('开局给 256 位熵（begin）：每局不一样，只在服务端的状态里，不下发；只有 start 的旧游戏照旧能开局', async () => {
    const keys: number[][] = [];
    for (const host of ['k1', 'k2']) {
      const code = await openRoom(host);
      const { conn } = await join(code, host);
      conn.send({ t: 'start' });
      await conn.state();
      const key = (await inspect(code)).persist.game.key as number[];
      expect(isEntropy(key)).toBe(true);
      keys.push(key);
      for (const w of key) expect(conn.rawIncludes(String(w))).toBe(false);
      expect(conn.rawIncludes('"key"')).toBe(false);
    }
    expect(keys[0]).not.toEqual(keys[1]);
    // FlakyRoom 的规则没有 begin：走 start(32 位种子)
    const code = await openRoom('legacy', '/flaky');
    const { conn } = await join(code, 'legacy', '/flaky');
    conn.send({ t: 'start' });
    const st = await conn.state();
    expect(st.room.status).toBe('playing');
    const game = await runInDurableObject(roomStub(env.FLAKY_ROOM, code), (_r, state) =>
      JSON.parse(state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').one().v).game,
    );
    expect(game.key).toBeUndefined();
    expect(game.hands.flat()).toHaveLength(12);
  });

  it('源码里没有 setTimeout、setInterval、ws.accept()（4.1）', () => {
    const src = roomSrc.replace(/^\s*(\*|\/\/|\/\*\*).*$/gm, '');
    expect(src).not.toMatch(/setTimeout|setInterval|\.accept\(\)/);
    expect(src).toMatch(/acceptWebSocket/);
  });
});

describe('硬限制（4.6）', () => {
  it('单条消息超过 4 KB：1009 断开', async () => {
    const code = await openRoom('big');
    const { conn } = await join(code, 'big');
    conn.send('x'.repeat(4097));
    expect(await conn.closedWith()).toBe(1009);
  });

  it('发太快（每秒 5 条，最多攒 10 条）：1008 断开', async () => {
    const code = await openRoom('fast');
    const { conn } = await join(code, 'fast');
    for (let i = 0; i < 11; i++) conn.send({ t: 'leave' });
    expect(await conn.closedWith()).toBe(1008);
  });

  it('一生的入站消息超过上限：房间结束，所有人 4000，存储清空', async () => {
    const code = await openRoom('many');
    const { conn } = await join(code, 'many');
    await patchRoom(code, { limits: { ...(await limitsOf(code)), maxInbound: 3, maxInboundShare: 2 } }); // 只测房间一生的上限：个人那一份放到比房间还大
    for (let i = 0; i < 4; i++) {
      conn.send({ t: 'leave' });
      advance(1_000);
    }
    expect(await conn.closedWith()).toBe(4000);
    expect((await inspect(code)).persist).toBeNull();
  });

  it('N1 旁观号反复进出：0 行、不占额度；房主断线重连仍能进来；座位的额度只管这个座位的主人', async () => {
    const code = await openRoom('host1');
    await patchRoom(code, { limits: { ...(await limitsOf(code)), maxJoins: 3 } });
    let host = (await join(code, 'host1')).conn;
    const total0 = (await inspect(code)).total;
    // 没入座的人进出 20 次：一行都不写，房主也收不到任何广播
    host.drain();
    for (let i = 0; i < 20; i++) {
      const { conn } = await join(code, 'spy');
      conn.ws.close(1000, 'bye');
      await conn.closedWith();
    }
    await quiet();
    expect((await inspect(code)).total).toBe(total0);
    expect(host.msgs.slice(-1)[0]?.t).not.toBe('state');
    // 房主断线重连：照样进来（他自己的额度是 3：开房后第一次连上用了 1 次）
    for (let i = 0; i < 2; i++) {
      host.ws.close(1000, 'bye');
      await host.closedWith();
      await quiet();
      const back = await join(code, 'host1');
      expect(back.welcome.you.seat).toBe(0);
      host = back.conn;
    }
    // 在线时换设备：不写库，不占额度
    const before = (await inspect(code)).total;
    const last = (await join(code, 'host1')).conn;
    expect(await host.closedWith()).toBe(4001);
    expect((await inspect(code)).total).toBe(before);
    // 再掉线，第 4 次"掉线后回来"超了他自己的额度：4029，不写库；别人照样能进
    last.ws.close(1000, 'bye');
    await last.closedWith();
    await quiet();
    expect(await refusedWith(await upgrade(code, 'host1'))).toBe(4029);
    expect((await inspect(code)).total).toBe(before + 1); // 只有那次断开写了 1 行
    expect((await join(code, 'friend')).welcome.you.seat).toBeNull();
  });

  it('重连额度按人记：用到上限后离座、再坐下，额度不清零，照样 4029', async () => {
    const code = await openRoom('reseat');
    await patchRoom(code, { limits: { ...(await limitsOf(code)), maxJoins: 2 } });
    const drop = async (c: Conn) => {
      c.ws.close(1000, 'bye');
      await c.closedWith();
      await quiet();
    };
    // 开房后第一次连上用 1 次，掉线回来用第 2 次
    let c = (await join(code, 'reseat')).conn;
    await drop(c);
    c = (await join(code, 'reseat')).conn;
    // 离座、再坐下（换成一个新座位）
    c.send({ t: 'leave' });
    await c.until((m) => m.t === 'state' && m.you.seat === null);
    c.send({ t: 'sit', seat: 0 });
    await c.until((m) => m.t === 'state' && m.you.seat === 0);
    await drop(c);
    expect(await refusedWith(await upgrade(code, 'reseat'))).toBe(4029);
    expect((await inspect(code)).persist.joins).toEqual({ reseat: 2 });
  });

  it('会写库的重连也算入站消息：房间一生的写入被 maxInbound 封住；关房日志记下发得最多的 userId（不记内容）', async () => {
    const code = await openRoom('spam');
    await patchRoom(code, { limits: { ...(await limitsOf(code)), maxInbound: 4, maxInboundShare: 1 } });
    const errors = vi.spyOn(console, 'error');
    const other = (await join(code, 'other')).conn;
    other.send({ t: 'sit', seat: 1 });
    await other.until((m) => m.t === 'state' && m.you.seat === 1);
    let closed = 0;
    for (let i = 0; i < 6 && !closed; i++) {
      const res = await upgrade(code, 'spam');
      const c = new Conn(res.webSocket!, 'spam');
      // 进来了是 0；房间在这次重连时关掉的，next 会因为连接关了而失败，取关闭码
      const first = await c.next().then(
        () => 0,
        () => c.closedWith(),
      );
      if (first) {
        closed = first;
        break;
      }
      c.ws.close(1000, 'bye');
      await c.closedWith();
      await quiet();
    }
    expect(closed).toBe(4000);
    expect(await other.closedWith()).toBe(4000);
    expect((await inspect(code)).persist).toBeNull();
    const log = errors.mock.calls.find((c) => c[0] === 'room inbound limit reached');
    expect(log).toEqual(['room inbound limit reached', code, 'top sender', 'spam', 4]);
    errors.mockRestore();
  });

  it('N2 没入座的连接最多 4 条，再来的 4003；占满以后，掉线的入座玩家回来照样能进，在线的换设备也行', async () => {
    const { code, conns } = await fullTable();
    const total0 = (await inspect(code)).total;
    const watchers: Conn[] = [];
    for (let i = 0; i < 4; i++) watchers.push((await join(code, `v${i}`)).conn);
    expect(await refusedWith(await upgrade(code, 'one-more'))).toBe(4003);
    // 占满的过程一行都没写
    expect((await inspect(code)).total).toBe(total0);
    // 旁观的人自己换设备不受影响
    expect((await join(code, 'v0')).welcome.you.seat).toBeNull();
    expect(await watchers[0]!.closedWith()).toBe(4001);
    // 房主断线重连、2 号换设备：都能进
    conns[0]!.ws.close(1000, 'bye');
    await conns[0]!.closedWith();
    await quiet();
    expect((await join(code, 'u1')).welcome.you.seat).toBe(0);
    expect((await join(code, 'u3')).welcome.you.seat).toBe(2);
    expect(await conns[2]!.closedWith()).toBe(4001);
    // 旁观的人走了才有空位
    watchers[1]!.ws.close(1000, 'bye');
    await watchers[1]!.closedWith();
    await quiet();
    expect((await join(code, 'one-more')).welcome.you.seat).toBeNull();
  });

  it('房间活满 3 小时：关闭、删闹钟、删存储；之后再进是 4004', async () => {
    const code = await openRoom('old');
    const { conn } = await join(code, 'old');
    advance(3 * 3_600_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await conn.closedWith()).toBe(4000);
    expect((await inspect(code)).persist).toBeNull();
    expect(await alarmOf(code)).toBeNull();
    expect(await refusedWith(await upgrade(code, 'old'))).toBe(4004);
  });

  it('没有真人连着 10 分钟：关闭；不到 10 分钟回来就不关', async () => {
    const code = await openRoom('idle');
    const first = (await join(code, 'idle')).conn;
    first.ws.close(1000, 'bye');
    await first.closedWith();
    advance(9 * 60_000);
    await runDurableObjectAlarm(stub(code));
    expect((await inspect(code)).persist).not.toBeNull();
    const back = (await join(code, 'idle')).conn;
    back.ws.close(1000, 'bye');
    await back.closedWith();
    advance(10 * 60_000);
    await runDurableObjectAlarm(stub(code));
    expect((await inspect(code)).persist).toBeNull();
  });

  it('只有没入座的人连着也算"没人"：10 分钟后照样关（旁观的不能让房间一直活着）', async () => {
    const code = await openRoom('ghost');
    const w = (await join(code, 'watcher')).conn;
    expect((await inspect(code)).persist.noHumanSince).toBe(Date.now());
    advance(10 * 60_000);
    await runDurableObjectAlarm(stub(code));
    expect(await w.closedWith()).toBe(4000);
    expect((await inspect(code)).persist).toBeNull();
  });
});

describe('进房认人（worker 入口）', () => {
  it('没登录：4401（不重连）；平台不可用：1013（稍后再试，会重连）；别的网站、没带 Origin：4403；房间码不对：4004；不是 WebSocket：426', async () => {
    const code = await openRoom('auth');
    expect(await refusedWith(await upgrade(code, null))).toBe(4401);
    expect(await refusedWith(await upgrade(code, 'bad'))).toBe(1013);
    expect(await refusedWith(await upgrade(code, 'auth', { origin: 'https://evil.test' }))).toBe(4403);
    expect(await refusedWith(await upgrade(code, 'auth', { origin: null }))).toBe(4403);
    expect(await refusedWith(await upgrade('12345', 'auth'))).toBe(4004);
    const plain = await exports.default.fetch(`${SITE}/rooms/${code}/ws`, { headers: { origin: SITE, cookie: `${SESSION_COOKIE}=auth` } });
    expect(plain.status).toBe(426);
  });

  it('开房：别的网站 403、没登录 401、平台不可用 503、不是 POST 405', async () => {
    const post = (headers: Record<string, string>, method = 'POST') => exports.default.fetch(`${SITE}/rooms`, { method, headers });
    expect((await post({ origin: 'https://evil.test', cookie: `${SESSION_COOKIE}=x` })).status).toBe(403);
    expect((await post({ cookie: `${SESSION_COOKIE}=x` })).status).toBe(403);
    expect((await post({ origin: SITE })).status).toBe(401);
    expect((await post({ origin: SITE, cookie: `${SESSION_COOKIE}=bad` })).status).toBe(503);
    expect((await post({ origin: SITE, cookie: `${SESSION_COOKIE}=x` }, 'GET')).status).toBe(405);
  });

  it('浏览器伪造 x-kit-user 头无效：按 cookie 认人；原始请求直接转给房间一律 400', async () => {
    const code = await openRoom('owner');
    const forged = identityHeader({ userId: 'owner', name: '房主' });
    const res = await upgrade(code, 'mallory', { headers: { 'x-kit-user': forged } });
    const c = new Conn(res.webSocket!, 'mallory');
    const welcome = await c.next();
    expect(welcome).toMatchObject({ t: 'welcome', you: { seat: null } });
    // 游戏 Worker 要是把浏览器的请求原样转给房间：地址不是 kit 的内部地址，拒绝（路径凑成 /ws 也一样）
    for (const path of [`/rooms/${code}/ws`, '/ws']) {
      const raw = await stub(code).fetch(new Request(`${SITE}${path}`, { headers: { upgrade: 'websocket', 'x-kit-user': forged } }));
      expect(raw.status, path).toBe(400);
    }
    // 内部地址但没有身份：401
    const noId = await stub(code).fetch(new Request(`https://${KIT_HOST}/ws`, { headers: { upgrade: 'websocket' } }));
    expect(noId.status).toBe(401);
  });

  it('没有这个房间：连上后马上 4004；页面太旧、版本号不是数字：4005', async () => {
    expect(await refusedWith(await upgrade('000000', 'nobody'))).toBe(4004);
    const code = await openRoom('old-client');
    expect(await refusedWith(await upgrade(code, 'old-client', { cv: 0 }))).toBe(4005);
    expect(await refusedWith(await upgrade(code, 'old-client', { cv: 'abc' }))).toBe(4005);
  });
});

describe('座位绑人（0.1.1）', () => {
  it('开打后离座的人只能回自己原来的座位：接管别人的电脑座位是 not_your_seat，看不到那个座位的牌；回原座位照常', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const h2 = (await hands(code))[2]!;
    for (const k of [2, 1]) {
      conns[k]!.send({ t: 'leave' });
      await conns[k]!.until((m) => m.t === 'state' && m.you.seat === null);
    }
    conns[1]!.send({ t: 'sit', seat: 2 });
    expect(await conns[1]!.until((m) => m.t === 'error')).toMatchObject({ code: 'not_your_seat' });
    await quiet();
    expect(conns[1]!.rawIncludes(`"mine":${JSON.stringify(h2)}`)).toBe(false);
    expect((await inspect(code)).persist.seats[2]).toMatchObject({ kind: 'ai' });
    conns[1]!.send({ t: 'sit', seat: 1 });
    await conns[1]!.until((m) => m.t === 'state' && m.you.seat === 1);
    conns[2]!.send({ t: 'sit', seat: 2 });
    const back = (await conns[2]!.until((m) => m.t === 'state' && m.you.seat === 2)) as StateMsg<ToyView>;
    expect(lastView(back).mine).toEqual(h2);
    expect((await inspect(code)).persist.owners).toEqual(['u1', 'u2', 'u3', 'u4']);
    await writesOk(code);
  });

  it('新来的人能接管没人坐过的电脑座位，接管后就绑在那里、不能再换；别人坐过的电脑座位谁也接管不了（seat_reserved）', async () => {
    const code = await openRoom('h');
    const host = (await join(code, 'h')).conn;
    host.send({ t: 'start' });
    await host.state();
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 2 });
    await late.until((m) => m.t === 'state' && m.you.seat === 2);
    late.send({ t: 'leave' });
    await late.until((m) => m.t === 'state' && m.you.seat === null);
    late.send({ t: 'sit', seat: 3 });
    expect(await late.until((m) => m.t === 'error')).toMatchObject({ code: 'not_your_seat' });
    const late2 = (await join(code, 'late2')).conn;
    late2.send({ t: 'sit', seat: 2 });
    expect(await late2.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_reserved' });
    late.send({ t: 'sit', seat: 2 });
    await late.until((m) => m.t === 'state' && m.you.seat === 2);
    late2.send({ t: 'sit', seat: 3 });
    await late2.until((m) => m.t === 'state' && m.you.seat === 3);
    expect((await inspect(code)).persist.owners).toEqual(['h', null, 'late', 'late2']);
    await writesOk(code);
  });

  it('桌上的真人都离座后电脑停着；有人接管了别的电脑座位，轮到的电脑接着出到他', async () => {
    const code = await openRoom('h');
    const host = (await join(code, 'h')).conn;
    host.send({ t: 'start' });
    await host.state();
    host.send({ t: 'leave' });
    await host.until((m) => m.t === 'state' && m.you.seat === null);
    expect(await played(code)).toBe(0);
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 2 });
    const m = (await late.until((x) => x.t === 'state' && x.you.seat === 2)) as StateMsg<ToyView>;
    expect(m.frames.map((f) => f.delay)).toEqual([0, 900, 900]);
    expect(m.room.turn).toEqual({ seat: 2, deadline: Date.now() + 2 * 900 + 30_000 });
    expect(await played(code)).toBe(2);
    await writesOk(code);
  });

  it('0.1.0 存下的房间（没有 owners、turnSeq）：坐着的人绑自己，电脑座位一律算已绑（谁都不能接管）；stale 照常', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    const old1 = conns[1]!.latestSeq();
    await play(conns, 0, 'p0', (await hands(code))[0]![0]!);
    // 升级前 u3 已经离座：旧格式里看不出 2 号座位是他的
    conns[2]!.send({ t: 'leave' });
    await conns[2]!.until((m) => m.t === 'state' && m.you.seat === null);
    await runInDurableObject(stub(code), (_r: ToyRoom, state) => {
      const p = JSON.parse(state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').one().v) as Record<string, unknown>;
      delete p.owners;
      delete p.turnSeq;
      state.storage.sql.exec('UPDATE kit_room SET v = ? WHERE k = 1', JSON.stringify(p));
    });
    await evictDurableObject(stub(code));
    conns[1]!.act('late', { card: (await hands(code))[1]![0] }, old1);
    expect(await conns[1]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale' });
    conns[3]!.send({ t: 'leave' });
    await conns[3]!.until((m) => m.t === 'state' && m.you.seat === null);
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 3 });
    expect(await late.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_reserved' });
    late.send({ t: 'sit', seat: 2 });
    expect(await late.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_reserved' });
    // 离过座的 u3 读出来也不能再去接管（包括 2 号），这样就没法借升级换座位看牌
    for (const seat of [2, 3]) {
      conns[2]!.send({ t: 'sit', seat });
      expect(await conns[2]!.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_reserved' });
    }
    expect((await inspect(code)).persist.owners).toEqual(['u1', 'u2', '', 'u4']);
  });

  it('大厅分得清座位：reserved（绑了人，主人离座也算）、电脑代打时显示原主人昵称、you.bound；不下发 userId', async () => {
    const code = await openRoom('h');
    const host = (await join(code, 'h')).conn;
    const lobby = await join(code, 'w');
    expect(lobby.welcome.you).toStrictEqual({ seat: null, bound: null });
    expect(lobby.welcome.room.seats.map((x) => x.reserved)).toEqual([false, false, false, false]);
    host.send({ t: 'start' });
    const started = await host.state();
    expect(started.you).toStrictEqual({ seat: 0, bound: 0 });
    expect(started.room.seats.map((x) => [x.kind, x.name, x.reserved])).toEqual([
      ['human', '玩家h', true],
      ['ai', null, false],
      ['ai', null, false],
      ['ai', null, false],
    ]);
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 2 });
    const sat = (await late.until((m) => m.t === 'state' && m.you.seat === 2)) as StateMsg<ToyView>;
    expect(sat.you).toStrictEqual({ seat: 2, bound: 2 });
    late.send({ t: 'leave' });
    const left = (await late.until((m) => m.t === 'state' && m.you.seat === null)) as StateMsg<ToyView>;
    expect(left.you).toStrictEqual({ seat: null, bound: 2 });
    expect(left.room.seats[2]).toStrictEqual({ kind: 'ai', name: '玩家late', away: false, auto: false, reserved: true });
    // 同一次广播，另一个没入座的人看到的 bound 是他自己的（null），不是 late 的
    const seen = await lobby.conn.atLeast(left.seq);
    expect(seen.you).toStrictEqual({ seat: null, bound: null });
    expect(seen.room.seats[2]).toMatchObject({ name: '玩家late', reserved: true });
    // 重连回来也知道自己绑在哪
    late.ws.close(1000, 'bye');
    await late.closedWith();
    expect((await join(code, 'late')).welcome.you).toStrictEqual({ seat: null, bound: 2 });
    await quiet();
    for (const c of [host, lobby.conn, late]) for (const id of ['h', 'w', 'late']) expect(c.rawIncludes(`"${id}"`)).toBe(false);
    await writesOk(code);
  });
});

describe('超时代出被规则拒绝（0.1.1）', () => {
  it('timeout 给的操作不合法：改用 ai 代出', async () => {
    const { code, conns } = await fullTable();
    await startAll(conns);
    await patchRoom(code, { game: { ...toyGame, timeout: () => ({ card: -5 }) } });
    const min0 = Math.min(...(await hands(code))[0]!);
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect((await inspect(code)).persist.game.played).toEqual([{ seat: 0, card: min0 }]);
    await writesOk(code);
  });

  it('timeout 和 ai 都不合法：记日志，这一手的期限推后 60 秒，闹钟不会在当前时刻反复响', async () => {
    const errors = vi.spyOn(console, 'error');
    const { code, conns } = await fullTable();
    await startAll(conns);
    await patchRoom(code, { game: { ...toyGame, timeout: () => ({ card: -5 }), ai: () => ({ card: -5 }) } });
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await alarmOf(code)).toBe(Date.now() + 60_000);
    const m = await conns[1]!.state();
    expect(m.room.turn).toEqual({ seat: 0, deadline: Date.now() + 60_000 });
    await writesOk(code);
    // 再醒几次（没到期）：不写状态
    const total = (await inspect(code)).total;
    for (let i = 0; i < 5; i++) await runDurableObjectAlarm(stub(code));
    expect((await inspect(code)).total - total).toBeLessThanOrEqual(5);
    expect(await alarmOf(code)).toBeGreaterThan(Date.now());
    expect((await inspect(code)).persist.game.played).toEqual([]);
    expect(errors.mock.calls.some((c) => c[0] === 'timeout and ai moves both rejected')).toBe(true);
    // 真人自己出照常
    await play(conns, 0, 'p0', (await hands(code))[0]![0]!);
    errors.mockRestore();
  });
});

describe('按人拆入站额度（0.1.1）', () => {
  it('一个人用完他那一份（maxInboundShare）：只断开他（4030），以后也进不来；房间和别人照常', async () => {
    const errors = vi.spyOn(console, 'error');
    const code = await openRoom('hog');
    const hog = (await join(code, 'hog')).conn;
    const calm = (await join(code, 'calm')).conn;
    calm.send({ t: 'sit', seat: 1 });
    await calm.until((m) => m.t === 'state' && m.you.seat === 1);
    // 一个人最多 5 条：hog 进房（会写库）用了 1 条，还能发 4 条
    await patchRoom(code, { limits: { ...(await limitsOf(code)), maxInbound: 20, maxInboundShare: 0.25 } });
    for (let i = 0; i < 6; i++) hog.send({ t: 'sit', seat: 9 });
    expect(await hog.closedWith()).toBe(4030);
    expect(hog.msgs.filter((m) => m.t === 'error')).toHaveLength(4);
    calm.send({ t: 'leave' });
    await calm.until((m) => m.t === 'state' && m.you.seat === null);
    const p = (await inspect(code)).persist;
    expect(p).not.toBeNull();
    expect(p.inboundBy.hog).toBe(5);
    expect(await refusedWith(await upgrade(code, 'hog'))).toBe(4030);
    // 没入座的人进房不写库、不算入站，也得查他那一份：用完了就进不来
    const spy = (await join(code, 'spy')).conn;
    for (let i = 0; i < 6; i++) spy.send({ t: 'sit', seat: 9 });
    expect(await spy.closedWith()).toBe(4030);
    expect(await refusedWith(await upgrade(code, 'spy'))).toBe(4030);
    expect(errors.mock.calls.some((c) => c[0] === 'room user inbound share reached' && c[2] === 'hog')).toBe(true);
    errors.mockRestore();
  });
});

/**
 * 一组人同时出手的小游戏：先大家点"准备"（一组，限时 20 秒），再按座位一人出一手（一手一人，turnMs 给 -1 → 用默认 30 秒），
 * 然后回到准备，打 2 轮结束。电脑点 1、超时代出点 2，真人点 7，log 里看得出是谁怎么出的。
 */
interface GroupState {
  phase: 'ready' | 'play';
  pending: number[];
  turn: number;
  round: number;
  log: string[];
}
const groupGame: RoomGame<GroupState, ToyAction, GroupState> = {
  seats: 4,
  rulesVersion: 1,
  start: () => ({ phase: 'ready', pending: [0, 1, 2, 3], turn: 0, round: 0, log: [] }),
  parse: toyGame.parse,
  apply: (s, seat, a) => {
    if (s.phase === 'ready') {
      if (!s.pending.includes(seat)) return { error: 'not_pending' };
      const pending = s.pending.filter((x) => x !== seat);
      const log = [...s.log, `r${seat}:${a.card}`];
      return pending.length ? { ...s, pending, log } : { ...s, phase: 'play', pending, turn: 0, log };
    }
    if (s.turn !== seat) return { error: 'not_your_turn' };
    const log = [...s.log, `p${seat}:${a.card}`];
    if (seat < 3) return { ...s, turn: seat + 1, log };
    return { ...s, phase: 'ready', pending: [0, 1, 2, 3], turn: 0, round: s.round + 1, log };
  },
  turn: (s) => (s.phase === 'ready' ? (s.pending[0] ?? null) : s.turn),
  actors: (s) => (s.round >= 2 ? [] : s.phase === 'ready' ? [...s.pending, 9, -1, s.pending[0] ?? 0] : [s.turn]),
  turnMs: (s) => (s.phase === 'ready' ? 20_000 : -1),
  view: (s) => s,
  ai: () => ({ card: 1 }),
  timeout: () => ({ card: 2 }),
  over: (s) => s.round >= 2,
};
const logOf = async (code: string) => (await inspect(code)).persist.game.log as string[];

describe('一组人同时出手（0.1.1 RoomGame.actors / turnMs）', () => {
  it('谁先点都收；组里有人点了，后点的人不算 stale、截止时间不变；组开始之前的决定是 stale；点过的再点是 not_your_turn', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, { game: groupGame });
    const beforeStart = conns[3]!.latestSeq();
    const t0 = Date.now();
    const starts = await startAll(conns);
    const groupSeq = starts[0]!.seq;
    expect(starts[0]!.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 20_000, seats: [0, 1, 2, 3] });
    advance(5_000);
    const after2 = await play(conns, 2, 'r2', 7);
    expect(after2[0]!.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 20_000, seats: [0, 1, 3] });
    // 0 号拿着组开始时的 seq 点（中间 2 号点过，seq 已经变了）：照样收
    conns[0]!.act('r0', { card: 7 }, groupSeq);
    await conns[0]!.until((m) => m.t === 'state' && m.ack === 'r0');
    conns[3]!.act('old', { card: 7 }, beforeStart);
    expect(await conns[3]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale', moveId: 'old' });
    conns[2]!.act('again', { card: 7 });
    expect(await conns[2]!.until((m) => m.t === 'error')).toMatchObject({ code: 'not_your_turn', moveId: 'again' });
    expect(await alarmOf(code)).toBe(t0 + 20_000);
    await writesOk(code);
    // 1、3 点完：进入出牌，是新的一手：只等 0 号，时限回到默认 30 秒，组里拿到的 seq 过时了
    await play(conns, 1, 'r1', 7);
    const mid = conns[0]!.latestSeq();
    const last = await play(conns, 3, 'r3', 7);
    expect(last[0]!.room.turn).toStrictEqual({ seat: 0, deadline: Date.now() + 30_000, seats: [0] });
    conns[0]!.act('p0old', { card: 7 }, mid);
    expect(await conns[0]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale', moveId: 'p0old' });
    expect(await logOf(code)).toEqual(['r2:7', 'r0:7', 'r1:7', 'r3:7']);
    await writesOk(code);
  });

  it('到点：组里还没点的真人逐个用 timeout 代出（一次广播），然后新的一手从现在计时', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, { game: groupGame });
    const t0 = Date.now();
    await startAll(conns);
    advance(5_000);
    await play(conns, 1, 'r1', 7);
    advance(14_999);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await logOf(code)).toEqual(['r1:7']);
    advance(1);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const m = await conns[0]!.state();
    expect(m.frames).toHaveLength(3);
    expect(m.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 50_000, seats: [0] });
    expect(await logOf(code)).toEqual(['r1:7', 'r0:2', 'r2:2', 'r3:2']);
    expect(await alarmOf(code)).toBe(t0 + 50_000);
    await writesOk(code);
  });

  it('组里的电脑马上代出，只等真人；组的计时从进入这组的那一帧算，电脑代出不往后推', async () => {
    const code = await openRoom('solo');
    const { conn } = await join(code, 'solo');
    await patchRoom(code, { game: groupGame });
    const t0 = Date.now();
    conn.send({ t: 'start' });
    const start = await conn.state();
    expect(start.frames.map((f) => f.delay)).toEqual([0, 900, 900, 900]);
    expect(start.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 20_000, seats: [0] });
    advance(1_000);
    await play([conn], 0, 'r0', 7);
    // 出牌：0 号出完，电脑 1–3 连着出，第 4 帧进入下一轮的准备组，电脑接着点
    advance(1_000);
    const m = (await play([conn], 0, 'p0', 7))[0]!;
    expect(m.frames).toHaveLength(7);
    expect(m.room.turn).toStrictEqual({ seat: 0, deadline: Date.now() + 3 * 900 + 20_000, seats: [0] });
    expect(await logOf(code)).toEqual(['r1:1', 'r2:1', 'r3:1', 'r0:7', 'p0:7', 'p1:1', 'p2:1', 'p3:1', 'r1:1', 'r2:1', 'r3:1']);
    await writesOk(code);
  });

  it('不写 actors 的游戏：RoomInfo.turn 没有 seats 字段（和 0.1.0 一样）', async () => {
    const code = await openRoom('plain');
    const { conn } = await join(code, 'plain');
    conn.send({ t: 'start' });
    const m = await conn.state();
    expect(m.room.turn).toStrictEqual({ seat: 0, deadline: Date.now() + 30_000 });
  });
});

/** 有歧义的小游戏：先 2、3 两个人一组；2 先出就换到"只有 3 出"的新阶段，3 先出就换到"只有 0 出"。withGroup 时给组标识。 */
interface PairState {
  phase: 'a' | 'b' | 'c' | 'done';
  log: string[];
}
const pairGame = (withGroup: boolean): RoomGame<PairState, ToyAction, PairState> => {
  const seatsOf = (s: PairState) => (s.phase === 'a' ? [2, 3] : s.phase === 'b' ? [3] : s.phase === 'c' ? [0] : []);
  return {
    seats: 4,
    rulesVersion: 1,
    start: () => ({ phase: 'a', log: [] }),
    parse: toyGame.parse,
    apply: (s, seat, a) => {
      if (!seatsOf(s).includes(seat)) return { error: 'not_pending' };
      const log = [...s.log, `${s.phase}${seat}:${a.card}`];
      return { phase: s.phase === 'a' ? (seat === 2 ? 'b' : 'c') : 'done', log };
    },
    turn: (s) => seatsOf(s)[0] ?? null,
    actors: (s) => (withGroup ? { seats: seatsOf(s), group: s.phase } : seatsOf(s)),
    view: (s) => s,
    ai: () => ({ card: 1 }),
    over: (s) => s.phase === 'done',
  };
};

describe('一组人：组标识、卡住、中途接管（0.1.1）', () => {
  for (const withGroup of [true, false]) {
    it(`[2,3] 里 2 出完换到"只有 3 出"的新阶段：${withGroup ? '给了组标识，是新的一手（重新计时、旧 seq 是 stale）' : '没给组标识，推断成同一组（已知的歧义）'}`, async () => {
      const { code, conns } = await fullTable();
      await patchRoom(code, { game: pairGame(withGroup) });
      const t0 = Date.now();
      const starts = await startAll(conns);
      advance(5_000);
      await play(conns, 2, 'a2', 7);
      const turn = (await inspect(code)).persist.turnSince;
      expect(turn).toBe(withGroup ? t0 + 5_000 : t0);
      conns[3]!.act('b3', { card: 7 }, starts[3]!.seq);
      if (withGroup) expect(await conns[3]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale' });
      else expect(await conns[3]!.until((m) => m.t === 'state' && m.ack === 'b3')).toBeTruthy();
    });
  }

  it('没给组标识：[2,3] 里 3 出完名单换成 [0]（有新座位加入）是新的一手，重新计时、旧 seq 是 stale', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, { game: pairGame(false) });
    const t0 = Date.now();
    const starts = await startAll(conns);
    advance(5_000);
    await play(conns, 3, 'a3', 7);
    expect((await inspect(code)).persist.turnSince).toBe(t0 + 5_000);
    conns[0]!.act('c0', { card: 7 }, starts[0]!.seq);
    expect(await conns[0]!.until((m) => m.t === 'error')).toMatchObject({ code: 'stale' });
  });

  it('给了组标识：同一组里后出的人照样不算 stale、不重新计时', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, { game: { ...groupGame, actors: (s: GroupState) => ({ seats: s.round >= 2 ? [] : s.phase === 'ready' ? s.pending : [s.turn], group: `${s.phase}${s.round}${s.phase === 'play' ? s.turn : ''}` }) } });
    const t0 = Date.now();
    const starts = await startAll(conns);
    advance(5_000);
    await play(conns, 2, 'r2', 7);
    conns[0]!.act('r0', { card: 7 }, starts[0]!.seq);
    const m = (await conns[0]!.until((x) => x.t === 'state' && x.ack === 'r0')) as StateMsg<ToyView>;
    expect(m.room.turn).toStrictEqual({ seat: 1, deadline: t0 + 20_000, seats: [1, 3] });
  });

  it('游戏每次都给同一个 group（一人一手的阶段）：每一手照样是新的一手，期限完整、闹钟不在过去、turnSeq 递增', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, {
      game: { ...toyGame, actors: (s: { turn: number; hands: number[][] }) => ({ seats: toyGame.turn(s as never) === null ? [] : [s.turn], group: 'play' }) },
    });
    await startAll(conns);
    const seq0 = (await inspect(code)).persist.turnSeq as number;
    advance(30_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const m = await conns[0]!.state();
    expect(m.room.turn).toStrictEqual({ seat: 1, deadline: Date.now() + 30_000, seats: [1] });
    expect(await alarmOf(code)).toBe(Date.now() + 30_000);
    const seq1 = (await inspect(code)).persist.turnSeq as number;
    expect(seq1).toBeGreaterThan(seq0);
    // 1 号自己出：2 号也有完整的 30 秒；出牌前的 seq 是 stale
    advance(10_000);
    const old = conns[2]!.latestSeq();
    const after = await play(conns, 1, 'p1', (await hands(code))[1]![0]!);
    expect(after[0]!.room.turn).toStrictEqual({ seat: 2, deadline: Date.now() + 30_000, seats: [2] });
    expect((await inspect(code)).persist.turnSeq).toBeGreaterThan(seq1);
    conns[2]!.act('old', { card: (await hands(code))[2]![0] }, old);
    expect(await conns[2]!.until((x) => x.t === 'error')).toMatchObject({ code: 'stale' });
    // 闹钟没醒前没有人被代出
    expect(await played(code)).toBe(2);
    await writesOk(code);
  });

  it('牌局没打完却没人能出（actors 空了）：记日志，按打完处理，不会卡着', async () => {
    const errors = vi.spyOn(console, 'error');
    const { code, conns } = await fullTable();
    await patchRoom(code, { game: { ...groupGame, actors: (s: GroupState) => (s.phase === 'ready' ? s.pending : []) } });
    await startAll(conns);
    for (const seat of [0, 1, 2]) await play(conns, seat, `r${seat}`, 7);
    const last = (await play(conns, 3, 'r3', 7))[0]!;
    expect(last.room.status).toBe('over');
    expect(last.room.turn).toBeNull();
    expect(errors.mock.calls.some((c) => c[0] === 'game has nobody to act but is not over')).toBe(true);
    expect(await alarmOf(code)).toBeGreaterThan(Date.now());
    errors.mockRestore();
  });

  it('组里托管的人回来收回座位：整组的期限不变', async () => {
    const { code, conns } = await fullTable();
    await patchRoom(code, {
      game: { ...groupGame, turnMs: (s: GroupState) => (s.phase === 'ready' ? 120_000 : -1) },
      limits: { ...(await limitsOf(code)), maxAiBatch: 1 },
    });
    const t0 = Date.now();
    await startAll(conns);
    for (const k of [1, 2]) {
      conns[k]!.ws.close(1000, 'gone');
      await conns[k]!.closedWith();
    }
    await quiet();
    // 掉线满 60 秒：1、2 号托管，一批只代出一个（1 号），2 号还在组里
    advance(60_000);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    expect(await logOf(code)).toEqual(['r1:1']);
    const back = await join(code, 'u3');
    expect(back.welcome.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 120_000, seats: [0, 2, 3] });
    expect((await inspect(code)).persist.turnSince).toBe(t0);
  });

  it('有人接管组里还没出的电脑座位：整组的期限不变', async () => {
    const code = await openRoom('h');
    const host = (await join(code, 'h')).conn;
    await patchRoom(code, { game: groupGame, limits: { ...(await limitsOf(code)), maxAiBatch: 1 } });
    const t0 = Date.now();
    host.send({ t: 'start' });
    const start = await host.state();
    // 一批只代出一个：1 号点了，2、3 号电脑还在组里
    expect(start.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 20_000, seats: [0, 2, 3] });
    advance(5_000);
    const late = (await join(code, 'late')).conn;
    late.send({ t: 'sit', seat: 2 });
    const sat = (await late.until((m) => m.t === 'state' && m.you.seat === 2)) as StateMsg<ToyView>;
    expect(sat.room.turn).toStrictEqual({ seat: 0, deadline: t0 + 20_000, seats: [0, 2] });
    expect((await inspect(code)).persist.turnSince).toBe(t0);
  });
});
