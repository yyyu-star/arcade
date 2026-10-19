/**
 * 好友房锦标赛跑在本地 workerd 里（DESIGN.md 14.3）：真的房间 DO（kit）、真的假钱包 DO。
 * 实盘：开赛前每个真人扣一份报名费，打完按名次在真人之间分奖池，钱包总额守恒；
 * 中途离开 / 掉线：电脑托管打完，照样结回；娱乐：一次都不碰钱包；每一步写入 ≤ 2 行。
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { DownMsg, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { NEW_BALANCE, type FakeBank } from 'arcade-kit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stakesOf } from '../../src/core/stakes.ts';
import type { RoomView } from '../../src/room/rules.ts';
import { roomPayouts } from '../../src/tour/rules.ts';
import { ROOM_LIMITS, type TexasRoom } from '../../worker/room.ts';
import { advance, BASE, freezeClock, SITE, usage, walletOf } from './helpers.ts';

type Msg = DownMsg<RoomView>;
const MAX = stakesOf('small').max;

beforeEach(() => freezeClock());
afterEach(() => vi.useRealTimers());

let uid = 0;
const user = () => `t${uid++}`;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function waitFor(ok: () => Promise<boolean>, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await ok()) return;
    await sleep(20);
  }
  throw new Error('condition not met');
}

async function openRoom(sid: string, opts: object): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${sid}` }, body: JSON.stringify({ opts }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

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
  async until(pred: (m: Msg) => boolean, ms = 5_000): Promise<Msg> {
    const deadline = performance.now() + ms;
    for (let i = 0; ; ) {
      for (; i < this.msgs.length; i++) if (pred(this.msgs[i]!)) return this.msgs[i]!;
      if (performance.now() > deadline) throw new Error(`timed out; last ${JSON.stringify(this.msgs.slice(-3).map((m) => (m.t === 'error' ? m : m.t)))}`);
      await sleep(10);
    }
  }
  async see(pred: (v: RoomView, m: StateMsg<RoomView> | WelcomeMsg<RoomView>) => boolean, ms = 10_000): Promise<RoomView> {
    const deadline = performance.now() + ms;
    for (;;) {
      const v = this.view;
      if (v && pred(v, this.last!)) return v;
      if (performance.now() > deadline) throw new Error(`timed out; last view ${JSON.stringify(v && { phase: v.phase, hand: v.handNo, tour: v.tour && { phase: v.tour.phase, over: v.tour.over } })}`);
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
    const persist = row ? (JSON.parse(row.v) as { game: Record<string, unknown>; status: string }) : null;
    return { max: room.maxStepWrites, persist, alarm: await state.storage.getAlarm() };
  });
}

/** 开一桌锦标赛：房主坐 0 号，其余各坐 1、2…，房主点开始 */
async function tourTable(n: number, opts: { stakes?: string; fun?: true; fill: boolean }) {
  const ids = Array.from({ length: n }, user);
  const code = await openRoom(ids[0]!, { size: 6, tour: true, ...(opts.fun ? { fun: true } : { stakes: opts.stakes ?? 'small' }), fill: opts.fill });
  const conns: Conn[] = [];
  for (const [i, id] of ids.entries()) {
    const c = await join(code, id);
    if (i > 0) {
      c.send({ t: 'sit', seat: i });
      await c.until((m) => m.t === 'state' && m.you.seat === i);
    }
    conns.push(c);
  }
  conns[0]!.send({ t: 'start' });
  await conns[0]!.until((m) => m.t === 'state' && m.room.status === 'playing');
  return { code, ids, conns };
}

let moves = 0;
/**
 * 真人一律"能加就全下，不然过牌或跟"（淘汰得快），轮到谁让谁出；一手打完房间停着（pause）就把时间拨到闹钟再跑闹钟。
 * 直到 done。active：还能出手的连接（离开、断开的不在里面）
 */
async function drive(active: Conn[], done: () => Promise<boolean>, ms = 90_000): Promise<void> {
  const deadline = performance.now() + ms;
  let idle = 0;
  while (!(await done())) {
    if (performance.now() > deadline) throw new Error('drive timed out');
    const top = active.reduce((a, c) => ((c.last?.seq ?? -1) > (a.last?.seq ?? -1) ? c : a));
    const seat = top.last!.room.turn?.seat;
    const pause = top.last!.room.pause;
    if (pause && seat === undefined) {
      const code = top.last!.room.code;
      const { alarm } = await inspect(code);
      advance(Math.max(0, (alarm ?? pause.until) - Date.now()));
      await runDurableObjectAlarm(stub(code));
      await sleep(5);
      continue;
    }
    const c = active.find((x) => x.seat === seat && x.last!.seq === top.last!.seq);
    if (seat === undefined || !c) {
      // 轮到的是电脑或断开的人：房间按闹钟接着出
      if (++idle > 60) {
        idle = 0;
        const code = top.last!.room.code;
        const { alarm } = await inspect(code);
        if (alarm) {
          advance(Math.max(0, alarm - Date.now()));
          await runDurableObjectAlarm(stub(code));
        }
      }
      await sleep(10);
      continue;
    }
    idle = 0;
    const lg = c.view!.legal!;
    const id = `m${moves++}`;
    advance(500);
    c.act(id, lg.raise ? { t: 'raise', to: lg.maxTo } : lg.check ? { t: 'check' } : { t: 'call' });
    const ack = await c.until((m) => (m.t === 'state' && m.ack === id) || (m.t === 'error' && m.moveId === id));
    if (ack.t === 'error' && ack.code !== 'stale') throw new Error(`move rejected: ${ack.code}`);
    await sleep(5);
  }
}

const settledAll = (ids: string[]) => async () => (await Promise.all(ids.map((id) => walletOf(id)))).every((w) => w.stakes.length === 0);

describe('好友房锦标赛：实盘', () => {
  it('3 个真人加 3 个电脑打完：真人各扣一份，奖池 70/30 分给真人，钱包总额守恒，每步写 ≤ 2 行', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await tourTable(3, { fill: true });
    const v = await conns[0]!.see((x) => x.tour?.phase === 'play');
    expect(v.tour).toMatchObject({ fun: false, buyIn: MAX, fill: true, in: true, blinds: [15, 30], level: 0 });
    expect(v.seats.filter((s) => s.owner === 'player').length).toBe(6);
    expect(v.size).toBe(6);
    for (const id of ids) expect(await walletOf(id)).toMatchObject({ balance: NEW_BALANCE - MAX, stakes: [{ game: 'texas', mode: 'server', tier: 'small', amount: MAX }] });
    // 别人的底牌看不到，自己的看得到
    expect(conns[0]!.view!.hole.length).toBe(2);
    await writesOk(code);

    await drive(conns, async () => conns.some((c) => c.view?.tour?.over));
    const fin = conns[0]!.view!;
    await waitFor(settledAll(ids));
    const bal = await Promise.all(ids.map(async (id) => (await walletOf(id)).balance));
    // 总额守恒：奖池 = 3 份，全部分完，平台不出钱
    expect(bal.reduce((a, b) => a + b, 0)).toBe(3 * NEW_BALANCE);
    // 真人之间按名次分：第一 70%，第二 30%，第三 0
    const humanOrder = fin.tour!.order!.filter((k) => k < 3);
    const pool = 3 * MAX;
    const pay = roomPayouts(humanOrder, MAX);
    expect(pay.reduce((a, b) => a + b, 0)).toBe(pool);
    expect(pay).toEqual([Math.floor(pool * 0.7) + (pool - Math.floor(pool * 0.7) - Math.floor(pool * 0.3)), Math.floor(pool * 0.3), 0]);
    humanOrder.forEach((k, i) => expect(bal[k]).toBe(NEW_BALANCE - MAX + pay[i]!));
    expect(fin.tour!.prizes!.slice(0, 3)).toEqual(Array.from({ length: 3 }, (_, k) => pay[humanOrder.indexOf(k)]));
    // 钱包每人只调了两次（扣、结），写两次
    for (const id of ids) expect(await usage(id)).toMatchObject({ writes: 2 });
    await writesOk(code);
  });

  it('中途离开（kit 的 leave）：座位交给电脑托管，打到被淘汰或结束，奖金照结，不需要本人在线', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await tourTable(2, { fill: true });
    await conns[0]!.see((x) => x.tour?.phase === 'play');
    conns[1]!.send({ t: 'leave' });
    await conns[0]!.see((_, m) => m.room.seats[1]!.kind === 'ai');
    conns[1]!.ws.close();
    await drive([conns[0]!], async () => conns[0]!.view?.tour?.over === true);
    await waitFor(settledAll(ids));
    const bal = await Promise.all(ids.map(async (id) => (await walletOf(id)).balance));
    expect(bal.reduce((a, b) => a + b, 0)).toBe(2 * NEW_BALANCE);
    // 2 个真人：第 1 名拿走全部，离开的人也照样按名次（可能是冠军）
    expect(bal.slice().sort((a, b) => a - b)).toEqual([NEW_BALANCE - MAX, NEW_BALANCE + MAX]);
    await writesOk(code);
  });

  it('断线（kit 的托管）：宽限过了由电脑代打，打完照样结回', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await tourTable(2, { fill: false });
    const v = await conns[0]!.see((x) => x.tour?.phase === 'play');
    // 没开电脑补：按实际人数开赛，牌桌上只有 2 个选手，其余座位是空座
    expect(v.seats.map((s) => s.owner)).toEqual(['player', 'player', 'none', 'none', 'none', 'none']);
    conns[1]!.ws.close();
    await sleep(50);
    advance(120_000);
    await runDurableObjectAlarm(stub(code));
    await drive([conns[0]!], async () => conns[0]!.view?.tour?.over === true);
    await waitFor(settledAll(ids));
    const bal = await Promise.all(ids.map(async (id) => (await walletOf(id)).balance));
    expect(bal.reduce((a, b) => a + b, 0)).toBe(2 * NEW_BALANCE);
    expect(bal.slice().sort((a, b) => a - b)).toEqual([NEW_BALANCE - MAX, NEW_BALANCE + MAX]);
    await writesOk(code);
  });

  it('房间到寿命要关：剩下的真人都交给电脑一次跑完，按名次结回，存储删掉', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await tourTable(2, { fill: true });
    await conns[0]!.see((x) => x.tour?.phase === 'play');
    advance(ROOM_LIMITS.maxLifeMs);
    const t0 = performance.now();
    await runDurableObjectAlarm(stub(code));
    await waitFor(settledAll(ids));
    console.log(`texas tour room: closing playOut + settle took ${Math.round(performance.now() - t0)} ms`);
    const bal = await Promise.all(ids.map(async (id) => (await walletOf(id)).balance));
    expect(bal.reduce((a, b) => a + b, 0)).toBe(2 * NEW_BALANCE);
    expect(bal.slice().sort((a, b) => a - b)).toEqual([NEW_BALANCE - MAX, NEW_BALANCE + MAX]);
  });

  it('报名被拒的人不在牌桌上（当旁观），其余的照常开赛；剩下不到两个真人就退回报名费不开赛', { timeout: 60_000 }, async () => {
    const [a, b, c] = [user(), user(), user()];
    // b 的钱包只有 100：扣不了一份
    await runInDurableObject(env.FAKE_BANK.get(env.FAKE_BANK.idFromName(b)), (bank: FakeBank) => bank.setBalance(100, Date.now()));
    const code = await openRoom(a, { size: 6, tour: true, stakes: 'small', fill: true });
    const conns = [await join(code, a), await join(code, b), await join(code, c)];
    for (const [i, x] of conns.entries()) {
      if (i > 0) {
        x.send({ t: 'sit', seat: i });
        await x.until((m) => m.t === 'state' && m.you.seat === i);
      }
    }
    conns[0]!.send({ t: 'start' });
    const vb = await conns[1]!.see((x) => x.refused !== null);
    expect(vb.refused).toBe('no_funds');
    const va = await conns[0]!.see((x) => x.tour?.phase === 'play');
    expect(va.tour!.in).toBe(true);
    expect(conns[1]!.view!.tour).toMatchObject({ in: false });
    expect(conns[1]!.view!.hole).toEqual([]);
    // 被拒的座位在牌桌上是空座；其余 2 个真人 + 3 个电脑
    expect(va.seats[1]!.owner).toBe('none');
    expect(va.seats.filter((s) => s.owner === 'player').length).toBe(5);
    expect((await walletOf(b)).stakes).toEqual([]);
  });

  it('只剩一个真人报上名：不开赛，扣到的报名费原样退回', { timeout: 60_000 }, async () => {
    const [a, b] = [user(), user()];
    await runInDurableObject(env.FAKE_BANK.get(env.FAKE_BANK.idFromName(b)), (bank: FakeBank) => bank.setBalance(100, Date.now()));
    const code = await openRoom(a, { size: 6, tour: true, stakes: 'small', fill: true });
    const ca = await join(code, a);
    const cb = await join(code, b);
    cb.send({ t: 'sit', seat: 1 });
    await cb.until((m) => m.t === 'state' && m.you.seat === 1);
    ca.send({ t: 'start' });
    await waitFor(async () => (await walletOf(a)).stakes.length === 0 && (await usage(a)).calls >= 2);
    expect(await walletOf(a)).toMatchObject({ balance: NEW_BALANCE, stakes: [] });
    expect(ca.view?.tour?.aborted).toBe(true);
  });
});

describe('好友房锦标赛：娱乐和开赛后', () => {
  it('娱乐锦标赛：从不调钱包（扣、结、查都没有），照样打完出名次', { timeout: 120_000 }, async () => {
    const { code, ids, conns } = await tourTable(2, { fun: true, fill: true });
    const v = await conns[0]!.see((x) => x.tour?.phase === 'play');
    expect(v.tour).toMatchObject({ fun: true, buyIn: 0 });
    await drive(conns, async () => conns.some((c) => c.view?.tour?.over));
    const fin = conns[0]!.view!;
    expect(fin.tour!.order!.length).toBe(6);
    expect(fin.tour!.prizes).toBeUndefined();
    await sleep(100);
    for (const id of ids) {
      expect(await usage(id)).toEqual({ calls: 0, writes: 0 });
      expect(await walletOf(id)).toMatchObject({ balance: NEW_BALANCE, stakes: [] });
    }
    await writesOk(code);
  });

  it('开赛后进房的人只能看：就算占了个电脑的座位也出不了手、看不到底牌，牌局照常往下走', { timeout: 60_000 }, async () => {
    const { code, conns } = await tourTable(2, { fill: true });
    await conns[0]!.see((x) => x.tour?.phase === 'play');
    const late = await join(code, user());
    expect(late.view!.tour!.in).toBe(false);
    expect(late.view!.hole).toEqual([]);
    late.send({ t: 'sit', seat: 3 });
    await sleep(100);
    late.act('x1', { t: 'allin' });
    const err = await late.until((m) => m.t === 'error' && m.moveId === 'x1');
    expect(['not_your_turn', 'not_seated']).toContain((err as { code: string }).code);
    expect(late.view!.hole).toEqual([]);
    expect(late.view!.tour!.in).toBe(false);
    await writesOk(code);
  });

  it('开房的选项：锦标赛固定 6 人；fill 只能和锦标赛一起；不合格的开不了', async () => {
    const bad = [
      { stakes: 'small', size: 5, tour: true },
      { stakes: 'gold', size: 6, tour: true },
      { stakes: 'small', size: 6, fill: true },
      { stakes: 'small', size: 6, tour: true, fill: 'yes' },
      { stakes: 'small', size: 6, tour: false },
    ];
    for (const opts of bad) {
      const res = await exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${user()}` }, body: JSON.stringify({ opts }) });
      expect(res.status, JSON.stringify(opts)).toBe(400);
    }
    const ok = await exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${user()}` }, body: JSON.stringify({ opts: { stakes: 'big', size: 6, tour: true, fill: false } }) });
    expect(ok.status).toBe(201);
  });
});

async function writesOk(code: string): Promise<void> {
  const { max } = await inspect(code);
  expect(max).toBeLessThanOrEqual(2);
}
