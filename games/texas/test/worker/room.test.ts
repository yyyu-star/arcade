/**
 * 好友房跑在本地 workerd 里（DESIGN.md 6）：真的房间 DO（kit）、真的钱包 DO、kit 的计量。
 * 每一步断言房间写入 ≤ 2 行；钱包按操作扣、结，不多不少；停着等人时不写。
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { DownMsg, EmotedMsg, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stakesOf } from '../../src/core/stakes.ts';
import { propId } from 'arcade-kit/fun-logic';
import { EMOTE_COUNT, SEATS, TAUNT_COUNT, type RoomState, type RoomView } from '../../src/room/rules.ts';
import { togetherOp } from 'arcade-kit/room';
import { NEW_BALANCE } from 'arcade-kit/testing';
import { ROOM_LIMITS, type TexasRoom } from '../../worker/room.ts';
import { advance, BASE, freezeClock, SITE, statsOf, togetherOf, usage, walletOf } from './helpers.ts';

type Msg = DownMsg<RoomView>;
const MAX = stakesOf('small').max;
/** 番茄的 emote 编号（kit 的 funItem：短语后面 12 个表情，再后面是道具） */
const TOMATO = propId(TAUNT_COUNT, 0);

beforeEach(() => freezeClock());
afterEach(() => vi.useRealTimers());

let uid = 0;
const user = () => `r${uid++}`;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function waitFor(ok: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (await ok()) return;
    await sleep(20);
  }
  throw new Error('condition not met');
}

/** 开房：请求体 { opts } 带档位和人数（body 给了就原样发，用来试不合格的） */
function createRoom(sid: string, body: string | undefined): Promise<Response> {
  return exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${sid}` }, ...(body !== undefined ? { body } : {}) });
}

async function openRoom(sid: string, opts: { stakes: string; size: number }): Promise<string> {
  const res = await createRoom(sid, JSON.stringify({ opts }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

/** 测试用的连接：收到的消息排队；last 是最新的快照或状态 */
class Conn {
  readonly msgs: Msg[] = [];
  last: WelcomeMsg<RoomView> | StateMsg<RoomView> | null = null;
  closed: number | null = null;

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
    ws.addEventListener('close', (e) => (this.closed = e.code));
  }

  get seat(): number | null {
    return this.last?.you.seat ?? null;
  }
  get view(): RoomView | null {
    return this.last?.t === 'welcome' ? this.last.view : (this.last?.frames.at(-1)?.view ?? null);
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  act(moveId: string, action: unknown): void {
    this.send({ t: 'act', moveId, baseSeq: this.last?.seq ?? 0, action });
  }

  async until(pred: (m: Msg) => boolean, ms = 3_000): Promise<Msg> {
    const deadline = performance.now() + ms;
    for (let i = 0; ; ) {
      for (; i < this.msgs.length; i++) if (pred(this.msgs[i]!)) return this.msgs[i]!;
      if (this.closed !== null) throw new Error(`closed ${this.closed}`);
      if (performance.now() > deadline) throw new Error(`timed out waiting for a message: ${JSON.stringify(this.msgs.map((m) => (m.t === 'error' ? m : [m.t, m.room.status, m.you])))}`);
      await sleep(10);
    }
  }

  /** 最新的视图满足条件为止（真实时间：CI 的机器慢，开打要先等钱包扣完买入，3 秒偶尔不够） */
  async see(pred: (v: RoomView, m: StateMsg<RoomView> | WelcomeMsg<RoomView>) => boolean, ms = 10_000): Promise<RoomView> {
    const deadline = performance.now() + ms;
    for (;;) {
      const v = this.view;
      if (v && pred(v, this.last!)) return v;
      if (performance.now() > deadline) throw new Error(`timed out; last view ${JSON.stringify(v && { phase: v.phase, handNo: v.handNo, toAct: v.toAct })}`);
      await sleep(10);
    }
  }
}

async function join(code: string, sid: string): Promise<Conn> {
  const res = await exports.default.fetch(`${BASE}/rooms/${code}/ws?cv=1`, { headers: { upgrade: 'websocket', origin: SITE, cookie: `__Host-sid=${sid}` } });
  expect(res.status).toBe(101);
  const c = new Conn(res.webSocket!);
  await c.until((m) => m.t === 'welcome');
  return c;
}

const stub = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));

function inspect(code: string) {
  return runInDurableObject(stub(code), async (room: TexasRoom, state) => {
    const has = state.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'kit_room'").toArray().length > 0;
    const row = has ? state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').toArray()[0] : undefined;
    const persist = row ? (JSON.parse(row.v) as { game: RoomState; seq: number; createdAt: number; status: string; ending?: unknown }) : null;
    return { last: room.lastStepWrites, max: room.maxStepWrites, total: room.totalWrites, persist, alarm: await state.storage.getAlarm() };
  });
}

async function writesOk(code: string): Promise<void> {
  const { max } = await inspect(code);
  expect(max).toBeLessThanOrEqual(2);
}

/** 开一桌：第一个人是房主，各坐 0、1、2… 号，按选项开打，等所有人的买入都到账 */
async function table(n: number, opts: { stakes: string; size: number }) {
  const ids = Array.from({ length: n }, user);
  const code = await openRoom(ids[0]!, opts);
  const conns: Conn[] = [];
  for (const [i, id] of ids.entries()) {
    const c = await join(code, id);
    // 房主进房就坐在 0 号位
    if (i > 0) {
      c.send({ t: 'sit', seat: i });
      await c.until((m) => m.t === 'state' && m.you.seat === i);
    }
    conns.push(c);
  }
  // 档位和人数开房时已经定了（kit 0.4.0），开打不用再带
  conns[0]!.send({ t: 'start' });
  await conns[0]!.until((m) => m.t === 'state' && m.room.status === 'playing');
  return { code, ids, conns };
}

let moves = 0;
let rebuys = 0;
let pauses = 0;
/** 简单的机器人：能过就过，跟得不多就跟，不然弃。轮到这些连接里的谁就让谁出，直到 done */
async function playUntil(conns: Conn[], done: (v: RoomView) => boolean, maxMoves = 2_000): Promise<number> {
  let n = 0;
  let idle = 0;
  for (;;) {
    const top = conns.reduce((a, c) => ((c.last?.seq ?? -1) > (a.last?.seq ?? -1) ? c : a));
    const v = top.view!;
    if (done(v)) return n;
    const seat = top.last!.room.turn?.seat;
    const c = conns.find((x) => x.seat === seat && x.last!.seq === top.last!.seq);
    // 输光了就补码（补码不轮流，什么时候都能发）
    const broke = conns.find((x) => x.view?.canRebuy && x.seat !== null && x.view.seats[x.seat]!.stack === 0 && x.last!.seq === top.last!.seq);
    if (broke) {
      const id = `rb${moves++}`;
      advance(1_000);
      broke.act(id, { t: 'rebuy' });
      await broke.until((m) => (m.t === 'state' && m.ack === id) || (m.t === 'error' && m.moveId === id));
      await broke.see((x) => !x.canRebuy);
      rebuys++;
      continue;
    }
    // 一手打完房间停着（kit 0.5.0 的 pause）：时间拨到房间存的那个闹钟，跑闹钟，还停着就再来一次。
    // 同一条消息里 pause.until 就等于闹钟（kit 0.7.2 查清、测试锁住）；按闹钟拨是因为闹钟醒来后电脑可能一口气打完下一手又停，
    // 手里那条旧消息的 until 就过时了，新的截止时间多出这一批电脑的播放时间
    const pause = top.last!.room.pause;
    if (pause && seat === undefined) {
      const code = top.last!.room.code;
      for (let k = 0; k < 5 && top.last!.room.pause; k++) {
        const { alarm } = await inspect(code);
        advance(Math.max(0, (alarm ?? pause.until) - Date.now()));
        await runDurableObjectAlarm(stub(code));
        await top.see((_, m) => !m.room.pause, 1_000).catch(() => {});
      }
      pauses++;
      await top.see((_, m) => !m.room.pause);
      continue;
    }
    if (seat === undefined || !c) {
      if (++idle > 300) throw new Error(`stuck: ${JSON.stringify({ turn: top.last!.room.turn, seats: top.last!.room.seats, phase: v.phase, toAct: v.toAct, hand: v.handNo, n })}`);
      await sleep(10);
      continue;
    }
    idle = 0;
    const lg = c.view!.legal!;
    const action = lg.check ? { t: 'check' } : lg.call <= 2 * v.bb ? { t: 'call' } : { t: 'fold' };
    const id = `m${moves++}`;
    advance(1_000);
    c.act(id, action);
    const ack = await c.until((m) => (m.t === 'state' && m.ack === id) || (m.t === 'error' && m.moveId === id));
    // 停顿过后只等了 top 收到新的一手，出手的这条连接可能还拿着旧状态：和真的页面一样，等新状态再来
    if (ack.t === 'error' && ack.code === 'stale') {
      await sleep(20);
      continue;
    }
    if (ack.t === 'error') throw new Error(`move rejected: ${ack.code}`);
    if (++n > maxMoves) throw new Error('too many moves');
  }
}

describe('开房、买入、打牌', () => {
  it('房主选档位和人数开打：真人从钱包扣满买入，空座电脑补；每一步写 ≤ 2 行', async () => {
    const { code, ids, conns } = await table(2, { stakes: 'small', size: 3 });
    const v = await conns[0]!.see((x) => x.handNo >= 1 && x.seats.filter((s) => s.owner === 'player').length === 2, 5_000);
    expect(v.size).toBe(3);
    expect(v.seats.map((s) => s.owner)).toEqual(['player', 'player', 'house']);
    expect(conns[0]!.last!.room.seats.map((s) => s.kind)).toEqual(['human', 'human', 'ai', ...new Array(SEATS - 3).fill('empty')]);
    for (const id of ids) expect(await walletOf(id)).toMatchObject({ balance: NEW_BALANCE - MAX, stakes: [{ game: 'texas', mode: 'server', tier: 'small', amount: MAX }] });
    await writesOk(code);
  });

  it('开房就定档位和人数（kit 0.4.0）：进房的人都看得到，坐不进用不到的座位；开打时 start 带的不看；不合格的开不了', async () => {
    const [host, guest] = [user(), user()];
    const code = await openRoom(host, { stakes: 'mid', size: 3 });
    const h = await join(code, host);
    const g = await join(code, guest);
    expect(g.last!.room.opts).toEqual({ stakes: 'mid', size: 3 });
    g.send({ t: 'sit', seat: 3 });
    expect(await g.until((m) => m.t === 'error')).toMatchObject({ code: 'seat_closed' });
    g.send({ t: 'sit', seat: 2 });
    await g.until((m) => m.t === 'state' && m.you.seat === 2);
    h.send({ t: 'start', opts: { stakes: 'small', size: 6 } });
    const v = await h.see((x) => x.handNo >= 1);
    expect(v).toMatchObject({ stakes: 'mid', size: 3 });
    for (const body of [undefined, '', '{}', 'nope', JSON.stringify({ opts: { stakes: 'gold', size: 3 } }), JSON.stringify({ opts: { stakes: 'mid', size: 10 } }), JSON.stringify({ opts: { stakes: 'mid', size: 3, pad: 'x'.repeat(600) } })]) {
      const res = await createRoom(user(), body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_options' });
    }
    // 分块传的请求体不带 content-length：合格的也不读（读请求体在认人之前，不让没登录的人塞一大段 JSON 进来）
    const chunked = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify({ opts: { stakes: 'mid', size: 3 } })));
        c.close();
      },
    });
    const req = new Request(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${user()}` }, body: chunked });
    expect(req.headers.get('content-length')).toBeNull();
    const res = await exports.default.fetch(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_options' });
  });

  it('客户端发 timeout 不收（只由房间代出）', async () => {
    const { conns } = await table(1, { stakes: 'small', size: 2 });
    const c = conns[0]!;
    c.act('t1', { t: 'timeout' });
    expect(await c.until((m) => m.t === 'error' && m.moveId === 't1')).toMatchObject({ code: 'bad_action' });
  });

  it('钱包不够：买入被拒，原因只给他看，牌桌停着等，房间不散', async () => {
    const { code, conns } = await table(1, { stakes: 'lux', size: 2 });
    const v = await conns[0]!.see((x) => x.refused !== null);
    expect(v.refused).toBe('no_funds');
    expect(conns[0]!.last!.room).toMatchObject({ status: 'playing', turn: null });
    expect((await inspect(code)).persist!.status).toBe('playing');
  });

  it('机器人打 300 手：每一步 ≤ 2 行，记下每手平均写几行（DESIGN 6.3）；离桌、关房都结回钱包，钱包里的数对得上', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await table(2, { stakes: 'small', size: 4 });
    await conns[0]!.see((x) => x.handNo >= 1);
    const w0 = (await inspect(code)).total;
    const h0 = conns[0]!.view!.handNo;
    const n = await playUntil(conns, (v) => v.handNo >= h0 + 300, 20_000);
    const w1 = (await inspect(code)).total;
    console.log(`texas room: 300 hands, ${n} human moves, ${rebuys} rebuys, ${w1 - w0} room rows (${((w1 - w0) / 300).toFixed(2)}/hand)`);
    await writesOk(code);

    // 1 号离座：这一手弃牌（打完）结回钱包，电脑坐进来
    conns[1]!.send({ t: 'leave' });
    await playUntil([conns[0]!], (v) => v.seats[1]!.owner === 'house');
    const left = (await inspect(code)).persist!.game;
    expect(left.t.out).toEqual([]);
    await waitFor(async () => (await walletOf(ids[1]!)).stakes.length === 0);
    expect((await walletOf(ids[1]!)).balance).toBeGreaterThan(0);

    // 关房（到寿命）：0 号桌上的（这一手作废、投的退回）结回钱包，存储删掉
    // 补码那一笔可能还在路上，或者扣到了还没上桌（held）：等钱包的事办完，结回的是桌上的加上 held
    await waitFor(async () => (await inspect(code)).persist!.game.fx.length === 0);
    const g = (await inspect(code)).persist!.game;
    const chips0 = g.t.seats[0]!.stack + g.t.seats[0]!.total + g.held[0]! + g.owed[0]!;
    const bal0 = (await walletOf(ids[0]!)).balance;
    advance(ROOM_LIMITS.maxLifeMs);
    await runDurableObjectAlarm(stub(code));
    for (let i = 0; i < 100 && (await inspect(code)).persist; i++) await sleep(20);
    expect((await inspect(code)).persist).toBeNull();
    const w0end = await walletOf(ids[0]!);
    expect(w0end).toMatchObject({ stakes: [], balance: bal0 + chips0 });
  });
});

describe('电脑的互动（0.6.1；0.13.0 起反应交给 kit 的 botReact）', () => {
  it('名场面（全下摊牌）赢了的电脑，房间替它广播一下（bot: true）：只从电脑座位发、编号在表里、点名桌上的人；大家收到的一样，不写存储', async () => {
    const { code, conns } = await table(2, { stakes: 'small', size: 4 });
    await conns[0]!.see((x) => x.handNo >= 1);
    const w0 = (await inspect(code)).total;
    // 拿房间现在的状态拼一手"0 号全下、2 号电脑跟、摊牌 2 号赢"（名场面）交给 onStep（不改房间的状态）：一手一手往后试，
    // 每手按这一手的种子决定发不发；中间拨 11 秒，过了同一个电脑的冷却、座位的令牌桶也补上
    const sent = await runInDurableObject(stub(code), (room: TexasRoom) => {
      const r = room as unknown as { st: { game: RoomState }; onStep(s: RoomState): void };
      const st = r.st.game;
      const log = [
        { seat: 0, act: 'raise' as const, amount: 600, allin: true as const },
        { seat: 2, act: 'call' as const, amount: 600 },
        { seat: -1, act: 'flop' as const, amount: 0 },
        { seat: 2, act: 'bet' as const, amount: 1000 },
        { seat: 0, act: 'call' as const, amount: 1000 },
      ];
      const base = st.t.lastHand?.handNo ?? st.t.handNo;
      let n = 0;
      for (let h = base + 1; h <= base + 40; h++) {
        advance(11_000);
        const shown = [0, 2].map((seat) => ({ seat, value: (seat === 2 ? 5 : 1) << 20, hole: [] }));
        const lastHand = { handNo: h, board: [], shown, pots: [{ amount: 3_200, winners: [{ seat: 2, won: 3_200 }] }], uncalled: null, byFold: false };
        r.onStep({ ...st, t: { ...st.t, lastHand, log } } as RoomState);
        n++;
      }
      return n;
    });
    expect(sent).toBe(40);
    const of = (c: Conn): EmotedMsg[] => (c.msgs as unknown[]).filter((m): m is EmotedMsg => (m as { t: string }).t === 'emote');
    await conns[1]!.until((m) => (m as { t: string }).t === 'emote');
    await sleep(50);
    const bots = of(conns[0]!);
    console.log(`texas room: ${bots.length} bot emotes in 40 big wins`);
    expect(bots.length).toBeGreaterThan(2);
    for (const m of bots) {
      expect(m).toMatchObject({ bot: true, seat: 2 });
      expect(m.id).toBeLessThan(EMOTE_COUNT);
      if (m.to !== undefined) expect(m.to).toBe(0);
    }
    expect(of(conns[1]!)).toEqual(bots);
    // 广播不写存储
    expect((await inspect(code)).total).toBe(w0);
  });
});

describe('电脑回应真人（0.6.1，kit 0.10.1 的 onEmote）', () => {
  it('真人对电脑扔东西：电脑按性格回（房间替它发，bot: true，回给扔的人），大家收到的一样；对真人扔的电脑不插嘴；不写存储', async () => {
    const { code, conns } = await table(2, { stakes: 'small', size: 4 });
    await conns[0]!.see((x) => x.handNo >= 1);
    const w0 = (await inspect(code)).total;
    const of = (c: Conn): EmotedMsg[] => (c.msgs as unknown[]).filter((m): m is EmotedMsg => (m as { t: string }).t === 'emote');
    // 0 号对 1 号（真人）扔 5 次番茄：电脑不回
    for (let i = 0; i < 5; i++) {
      advance(11_000);
      conns[0]!.send({ t: 'emote', id: TOMATO, to: 1 });
      await conns[1]!.until((m) => (m as { t: string }).t === 'emote' && of(conns[1]!).length >= i + 1);
    }
    await sleep(50);
    expect(of(conns[1]!).filter((m) => m.bot)).toEqual([]);
    // 0 号对 2 号电脑扔 20 次番茄，每次隔 11 秒（过冷却）
    for (let i = 0; i < 20; i++) {
      advance(11_000);
      conns[0]!.send({ t: 'emote', id: TOMATO, to: 2 });
      await sleep(5);
    }
    await sleep(100);
    const bots = of(conns[0]!).filter((m) => m.bot);
    console.log(`texas room: ${bots.length} AI replies to 20 tomatoes`);
    expect(bots.length).toBeGreaterThan(3);
    for (const m of bots) {
      expect(m.seat).toBe(2);
      expect(m.id).toBeLessThan(EMOTE_COUNT);
      if (m.to !== undefined) expect(m.to).toBe(0);
    }
    expect(of(conns[1]!).filter((m) => m.bot)).toEqual(bots);
    expect((await inspect(code)).total).toBe(w0);
  });
});

describe('钱包的事', () => {
  it('同一笔办两次（断线、被驱逐后重办）：平台按"ref-id"去重，只扣一次、只结一次；每次调平台 1 次，重办的不写', async () => {
    const { code, ids } = await table(1, { stakes: 'small', size: 2 });
    await waitFor(async () => (await walletOf(ids[0]!)).stakes.length > 0);
    // 每一份的 ref：房间号 s 座位 n 第几份（8–64 位，房间码只有 6 位、还会重复用，不拿它当 ref）
    const ref = `${(await inspect(code)).persist!.game.ref}s0n1`;
    expect((await walletOf(ids[0]!)).stakes[0]!.ref).toBe(ref);
    const u0 = await usage(ids[0]!);
    expect(u0).toEqual({ calls: 1, writes: 1 });
    const again = (e: object) =>
      runInDurableObject(stub(code), (room: TexasRoom) => (room as unknown as { perform(e: object, u: string): Promise<unknown> }).perform(e, ids[0]!));
    expect(await again({ id: 'b0', seat: 0, kind: 'debit', amount: MAX, ref, stakes: 'small' })).toEqual({ ok: true });
    expect(await walletOf(ids[0]!)).toMatchObject({ balance: NEW_BALANCE - MAX, stakes: [{ amount: MAX }] });
    const credit = { id: 'c9', seat: 0, kind: 'credit', amount: 500, ref, stakes: 'small' };
    await again(credit);
    await again(credit);
    expect(await walletOf(ids[0]!)).toMatchObject({ balance: NEW_BALANCE - MAX + 500, stakes: [] });
    expect(await usage(ids[0]!)).toEqual({ calls: 4, writes: 2 });
    // 那一份已经结过了：再来一笔新 id 的结回，平台回 no_stake，算办完（不重办、不抛）
    expect(await again({ ...credit, id: 'c10' })).toEqual({ ok: false, error: 'no_stake' });
  });

  it('结回时平台忙：抛错让房间按退避重办（同一个操作 id），不当办完', async () => {
    const { code, ids } = await table(1, { stakes: 'small', size: 2 });
    await waitFor(async () => (await walletOf(ids[0]!)).stakes.length > 0);
    const busy = { buyin: async () => ({ ok: false, error: 'busy' }), settle: async () => ({ ok: false, error: 'busy' }) };
    const r = await runInDurableObject(stub(code), async (room: TexasRoom) => {
      const x = room as unknown as { env: { WALLET: unknown }; perform(e: object, u: string): Promise<unknown> };
      const real = x.env.WALLET;
      x.env.WALLET = busy;
      try {
        const debit = await x.perform({ id: 'b7', seat: 0, kind: 'debit', amount: MAX, ref: 'rbusyrefs0n1', stakes: 'small' }, ids[0]!);
        const credit = await x.perform({ id: 'c7', seat: 0, kind: 'credit', amount: 1, ref: 'rbusyrefs0n1', stakes: 'small' }, ids[0]!).then(
          () => 'done',
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        );
        return { debit, credit };
      } finally {
        x.env.WALLET = real;
      }
    });
    expect(r).toEqual({ debit: { ok: false, error: 'busy' }, credit: 'wallet busy' });
  });

  it('浏览器的接口没有好友房的带入、结回', async () => {
    for (const path of ['solo/room_debit', 'room/debit', 'wallet/buyin', 'wallet/settle']) {
      const res = await exports.default.fetch(`${BASE}/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-arcade': '1', origin: SITE, cookie: '__Host-sid=x1' },
        body: JSON.stringify({ op: 'op-12345678', ref: 'rA', amount: 1, stakes: 'small', until: 9e15 }),
      });
      expect(res.status).toBe(404);
    }
  });
});

describe('停着等人（kit 0.3.2 的 waiting）', () => {
  it('一桌只剩一个能打的人、等别人补码：房间停 10 分钟一行不写，闹钟只剩寿命（和没人）；补码到账接着打', async () => {
    const { code, ids, conns } = await table(2, { stakes: 'small', size: 2 });
    await conns[0]!.see((x) => x.handNo >= 1 && x.seats.every((s) => s.owner === 'player'));
    // 两个人一直全下、跟，直到有人输光
    for (let k = 0; k < 50; k++) {
      const top = conns.reduce((a, c) => ((c.last?.seq ?? -1) > (a.last?.seq ?? -1) ? c : a));
      const v = top.view!;
      if (v.seats.some((s) => s.stack === 0 && s.status === 'out')) break;
      const seat = top.last!.room.turn?.seat;
      const c = conns.find((x) => x.seat === seat && x.last!.seq === top.last!.seq);
      // 平分了池子、没人输光：两手之间停着（kit 0.5.0），拨到点让闹钟发下一手（不然这里一直等，偶发失败）
      const pause = top.last!.room.pause;
      if (seat === undefined && pause) {
        advance(Math.max(0, pause.until - Date.now()));
        await runDurableObjectAlarm(stub(code));
        await sleep(10);
        continue;
      }
      if (seat === undefined || !c) {
        await sleep(10);
        continue;
      }
      const id = `a${moves++}`;
      advance(1_000);
      c.act(id, c.view!.legal!.check ? { t: 'check' } : { t: c.view!.legal!.raise ? 'allin' : 'call' });
      await c.until((m) => (m.t === 'state' && m.ack === id) || (m.t === 'error' && m.moveId === id));
    }
    const top = conns.reduce((a, c) => ((c.last?.seq ?? -1) > (a.last?.seq ?? -1) ? c : a));
    const broke = top.view!.seats.findIndex((s) => s.stack === 0);
    expect(broke).toBeGreaterThanOrEqual(0);
    const loser = conns[broke]!;
    await loser.see((v) => v.canRebuy && v.phase === 'idle');
    expect(loser.last!.room.turn).toBeNull();
    // 这一手打完先停 HAND_PAUSE_MS（kit 0.5.0）：到点发不了下一手（只剩一个能打的），转成停着等补码
    const p = loser.last!.room.pause!;
    expect(p.until).toBeGreaterThan(Date.now());
    advance(p.until - Date.now());
    await runDurableObjectAlarm(stub(code));
    await loser.see((_, m) => !m.room.pause);

    // 停下那一刻设着的闹钟可能还是上一手的期限：醒一次，只把闹钟改到寿命（不写牌局）
    const created = (await inspect(code)).persist!.createdAt;
    await runDurableObjectAlarm(stub(code));
    const a = await inspect(code);
    expect(a.persist!.status).toBe('playing');
    expect(a.alarm).toBe(created + ROOM_LIMITS.maxLifeMs);

    // 之后 10 分钟：闹钟在 6 小时以后，中间没有任何东西会醒；一行不写，seq 不动
    advance(10 * 60_000);
    const b = await inspect(code);
    expect(b.total).toBe(a.total);
    expect(b.persist!.seq).toBe(a.persist!.seq);
    expect(b.alarm).toBe(created + ROOM_LIMITS.maxLifeMs);

    // 输光的人点补码：从钱包再扣一份，到账后接着打
    loser.act('rb', { t: 'rebuy' });
    await loser.see((v) => v.seats[broke]!.stack + v.seats[broke]!.total === MAX && v.phase !== 'idle');
    expect((await walletOf(ids[broke]!)).stakes).toMatchObject([{ amount: 2 * MAX }]);
    expect(loser.last!.room.turn).not.toBeNull();
    await writesOk(code);
  });
});

describe('离开马上结（0.2.4）', () => {
  it('最后一个真人点离开：桌上的马上结回钱包，房间算打完、开房名额还了，马上能再开一个', async () => {
    // 两个真人才发牌（0.4.0）：1 号先走（这一手照常打完，之后不发），0 号就是最后一个真人
    const { code, ids, conns } = await table(2, { stakes: 'small', size: 4 });
    await conns[0]!.see((x) => x.handNo >= 1);
    conns[1]!.send({ t: 'leave' });
    await waitFor(async () => (await walletOf(ids[1]!)).stakes.length === 0);
    expect((await inspect(code)).persist?.status).toBe('playing');
    conns[0]!.send({ t: 'leave' });
    await waitFor(async () => (await walletOf(ids[0]!)).stakes.length === 0);
    expect((await walletOf(ids[0]!)).balance).toBeGreaterThan(0);
    // 结回带了这一份的小结（0.3.0，平台 settle.stats），平台收下了（没有 statsIgnored）
    const [st] = await statsOf(ids[0]!);
    expect(st).toMatchObject({ stats: { rounds: expect.any(Number), wins: expect.any(Number), best: expect.any(Number) } });
    expect(st!.ignored).toBeUndefined();
    await waitFor(async () => (await inspect(code)).persist?.status === 'over');
    await writesOk(code);
    // 测试配置每人同时只能开 1 个：名额还了才开得出来
    const again = await openRoom(ids[0]!, { stakes: 'small', size: 3 });
    expect(again).not.toBe(code);
  });
});

describe('搭子战绩（0.17.0，平台 15.19）', () => {
  it('三个真人：先走的和还坐着的各报一场，后两个散桌时再报一场；每对一场，op 是房间码-开房时刻-场次；同一场重报不加', async () => {
    const { code, ids, conns } = await table(3, { stakes: 'small', size: 4 });
    for (const c of conns) await c.see((x) => x.handNo >= 1);
    await playUntil(conns, (v) => v.handNo >= 3);
    conns[2]!.send({ t: 'leave' });
    await waitFor(async () => (await togetherOf(ids[2]!)).length === 2);
    const created = (await inspect(code)).persist!.createdAt;
    const first = await togetherOf(ids[2]!);
    expect(first.map((x) => x.op)).toEqual([togetherOp(code, created, 0), togetherOp(code, created, 1)]);
    for (const x of first) {
      expect(x.game).toBe('texas');
      expect(x.players).toHaveLength(2);
      expect(x.players[0]!.userId).toBe(ids[2]);
      expect(x.players.every((p) => typeof p.win === 'boolean' && p.team === undefined)).toBe(true);
    }
    expect(first.map((x) => x.players[1]!.userId).sort()).toEqual([ids[0], ids[1]].sort());
    // 走的人这一份的净输赢：钱包里一份带入一份结回，余额比开始多就是赢了
    expect(first[0]!.players[0]!.win).toBe((await walletOf(ids[2]!)).balance > NEW_BALANCE);
    // 0、1 号之间这时还不算
    expect((await togetherOf(ids[0]!)).filter((x) => x.players.some((p) => p.userId === ids[1]))).toEqual([]);
    // 被驱逐后醒来：最近切的那几场再报一次，平台按 op 去重、不加
    await runInDurableObject(stub(code), (room: TexasRoom) => {
      const r = room as unknown as { matches: number; onStep(s: RoomState): void; st: { game: RoomState } };
      r.matches = -1;
      r.onStep(r.st.game);
    });
    await sleep(50);
    expect(await togetherOf(ids[2]!)).toHaveLength(2);
    // 剩下的两个人：1 号走时和 0 号一场，0 号最后一个走不再报
    await playUntil(conns.slice(0, 2), (v) => v.handNo >= 5);
    conns[1]!.send({ t: 'leave' });
    await waitFor(async () => (await togetherOf(ids[1]!)).length === 2);
    conns[0]!.send({ t: 'leave' });
    await waitFor(async () => (await inspect(code)).persist?.status === 'over');
    await sleep(50);
    const all = [...(await togetherOf(ids[0]!)), ...(await togetherOf(ids[1]!)), ...(await togetherOf(ids[2]!))];
    // 三对，每对一场（每场记在两个人头上）
    expect(new Set(all.map((x) => x.op)).size).toBe(3);
    expect(all).toHaveLength(6);
    await writesOk(code);
  });
});

describe('换人、托管', () => {
  it('开打后有人接管电脑的座位：扣他的买入，下一手坐上；离线超过宽限由电脑托管，只过牌或弃牌', async () => {
    // 两个真人在打（0.4.0 至少两个才发牌），第三个人接管 3 号电脑
    const { code, conns } = await table(2, { stakes: 'small', size: 4 });
    await conns[0]!.see((x) => x.handNo >= 1);
    const late = user();
    const c = await join(code, late);
    c.send({ t: 'sit', seat: 3 });
    await c.until((m) => m.t === 'state' && m.you.seat === 3);
    await waitFor(async () => (await walletOf(late)).stakes.length > 0);
    expect((await walletOf(late)).stakes).toMatchObject([{ mode: 'server', amount: MAX }]);
    await playUntil([...conns, c], (v) => v.seats[3]!.owner === 'player');

    // 3 号掉线：宽限过后托管，轮到他时只过牌或弃牌（记进日志的是 auto）；另外两个真人接着打
    c.ws.close(1000, 'bye');
    await sleep(50);
    advance(ROOM_LIMITS.graceMs);
    await runDurableObjectAlarm(stub(code));
    await conns[0]!.see((_v, m) => m.room.seats[3]!.auto === true);
    const h = conns[0]!.view!.handNo;
    await playUntil(conns, (v) => v.handNo >= h + 3);
    const s = (await inspect(code)).persist!.game;
    expect(s.t.seats[3]!.owner).toBe('player');
    await writesOk(code);
  }, 20_000); // 0.1.1 起每手之后多一次停顿（拨时钟、跑闹钟），要多打好几手，5 秒的默认上限和别的测试一起跑时不够
});
