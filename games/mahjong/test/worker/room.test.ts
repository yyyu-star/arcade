/**
 * 好友房跑在本地 workerd 里（DESIGN.md 第 6 节）：真的房间 DO（kit + 麻将的房间规则）、真的（假平台的）钱包 DO。
 * 覆盖开房、实盘开局的带入、隐藏信息不下发、每步写入 ≤ 2 行、离座马上结回、钱包不够一份时少带、一场打完报搭子战绩。
 * 不打整场（牌局本身在 node 单测里）；不等真实计时，只停在开局后的换三张阶段。
 */
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { DownMsg, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stakesOf } from '../../src/game/stakes.ts';
import type { RoomView } from '../../src/room/rules.ts';
import type { XzView } from '../../src/core/variants/sichuan-xuezhan/index.ts';
import type { MahjongRoom } from '../../worker/room.ts';
import { NEW_BALANCE, type FakeBank } from 'arcade-kit/testing';
import { BASE, freezeClock, SITE, walletOf } from './helpers.ts';

type Msg = DownMsg<RoomView>;
const SHARE = stakesOf('small')!.share;
const OPTS = { variant: 'sichuan-xuezhan', stakes: 'small', rules: { rounds: 4, cap: 3, swap: true, zimo: 'di', transfer: true } };

beforeEach(() => freezeClock());
afterEach(() => vi.useRealTimers());

let uid = 0;
const user = () => `mj${uid++}`;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function createRoom(sid: string, body: string): Promise<Response> {
  return exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${sid}` }, body });
}

async function openRoom(sid: string): Promise<string> {
  const res = await createRoom(sid, JSON.stringify({ opts: OPTS }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

/** 测试用的连接：收到的消息都留着（隐藏信息要查整条消息），last 是最新的快照或状态 */
class Conn {
  readonly raw: string[] = [];
  readonly msgs: Msg[] = [];
  last: WelcomeMsg<RoomView> | StateMsg<RoomView> | null = null;
  closed: number | null = null;
  readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      this.raw.push(e.data);
      const m = JSON.parse(e.data) as Msg;
      this.msgs.push(m);
      if (m.t !== 'error' && (!this.last || m.seq >= this.last.seq)) this.last = m;
    });
    ws.addEventListener('close', (e) => (this.closed = e.code));
  }

  get view(): RoomView | null {
    return this.last?.t === 'welcome' ? this.last.view : (this.last?.frames.at(-1)?.view ?? null);
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  async until(pred: (m: Msg) => boolean, ms = 3_000): Promise<Msg> {
    const deadline = performance.now() + ms;
    for (let i = 0; ; ) {
      for (; i < this.msgs.length; i++) if (pred(this.msgs[i]!)) return this.msgs[i]!;
      if (this.closed !== null) throw new Error(`closed ${this.closed}`);
      if (performance.now() > deadline) throw new Error('timed out waiting for a message');
      await sleep(10);
    }
  }

  /** 最新的视图满足条件为止（真实时间：钱包扣完才开打） */
  async see(pred: (v: RoomView) => boolean, ms = 10_000): Promise<RoomView> {
    const deadline = performance.now() + ms;
    for (;;) {
      const v = this.view;
      if (v && pred(v)) return v;
      if (performance.now() > deadline) throw new Error(`timed out; last view ${JSON.stringify(v && { own: v.own, inn: v.inn, opening: v.opening, refused: v.refused })}`);
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
const inspect = (code: string) => runInDurableObject(stub(code), (room: MahjongRoom) => ({ last: room.lastStepWrites, max: room.maxStepWrites, total: room.totalWrites }));

/** 两个真人（房主坐 0 号、客人坐 1 号），房主开局；不等带入到账。可以预先设好某人的余额 */
async function table(balances: Record<number, number> = {}) {
  const ids = [user(), user()];
  for (const [i, b] of Object.entries(balances)) {
    const bank = env.FAKE_BANK.get(env.FAKE_BANK.idFromName(ids[Number(i)]!));
    await runInDurableObject(bank, (x: FakeBank) => x.setBalance(b, Date.now()));
  }
  const code = await openRoom(ids[0]!);
  const host = await join(code, ids[0]!);
  const guest = await join(code, ids[1]!);
  guest.send({ t: 'sit', seat: 1 });
  await guest.until((m) => m.t === 'state' && m.you.seat === 1);
  host.send({ t: 'start' });
  await host.until((m) => m.t === 'state' && m.room.status === 'playing');
  return { code, ids, host, guest };
}

describe('开房', () => {
  it('选项合格回 201；玩法、档位、规则不合格的回 400 bad_options', async () => {
    const ok = await createRoom(user(), JSON.stringify({ opts: OPTS }));
    expect(ok.status).toBe(201);
    const bad = [
      { ...OPTS, stakes: 'x' },
      { ...OPTS, variant: 'nope' },
      { ...OPTS, rules: { ...OPTS.rules, rounds: 5 } },
    ];
    for (const opts of bad) {
      const res = await createRoom(user(), JSON.stringify({ opts }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_options' });
    }
  });

  it('请求体有内容却解析不了：400 bad_options，不当默认开；没带请求体按默认开', async () => {
    for (const body of ['not json', '[1]', '"x"', 'x'.repeat(2_000)]) {
      const res = await createRoom(user(), body);
      expect(res.status, body.slice(0, 10)).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_options' });
    }
    const empty = await exports.default.fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: SITE, cookie: `__Host-sid=${user()}` } });
    expect(empty.status).toBe(201);
  });
});

describe('实盘开局', () => {
  it('两个真人各扣一份，座位变成他们的；开局等带入的标记收起；每一步写 ≤ 2 行', async () => {
    const { code, ids, host, guest } = await table();
    for (const c of [host, guest]) {
      const v = await c.see((x) => x.own[0]! && x.own[1]! && !x.opening);
      expect(v.inn).toBe(SHARE);
      expect(v.stakes).toBe('small');
    }
    for (const id of ids) expect(await walletOf(id)).toMatchObject({ balance: NEW_BALANCE - SHARE, stakes: [{ game: 'mahjong', mode: 'server', tier: 'small', amount: SHARE }] });
    expect((await inspect(code)).max).toBeLessThanOrEqual(2);
  });

  it('隐藏信息：别人的手牌是 null，只有我的在 me.hand；整条消息里没有密钥字段', async () => {
    const { host } = await table();
    await host.see((x) => x.own[0]! && !x.opening);
    const g = host.view!.g as XzView;
    expect(g.me!.seat).toBe(0);
    expect(g.me!.hand.length).toBeGreaterThan(0);
    expect(g.seats[0]!.hand).not.toBeNull();
    for (const i of [1, 2, 3]) expect(g.seats[i]!.hand).toBeNull();
    // 不管哪条消息（欢迎、状态、帧）都不带密钥；"key" 作为字段名不出现
    const hasKey = (x: unknown): boolean => !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) => k === 'key' || hasKey(v));
    expect(host.msgs.some(hasKey)).toBe(false);
    expect(host.raw.some((r) => r.includes('"key"'))).toBe(false);
  });

  it('一局打到一半离座：这一局照算（电脑替他打完）；房主也走了就收场，两个人的那一份都结回钱包', async () => {
    const { ids, host, guest } = await table();
    await guest.see((x) => x.own[1]! && !x.opening);
    guest.send({ t: 'leave' });
    await guest.until((m) => m.t === 'state' && m.you.seat === null);
    // 这一局（换三张已经发了牌）还没完：他的那一份还在钱包的桌上，筹码还是他的，不提前收场
    await sleep(200);
    expect((await walletOf(ids[1]!)).stakes).toHaveLength(1);
    const mid = await host.see((x) => !x.own[0] || x.own[1]!);
    expect(mid).toMatchObject({ cut: false, done: false, own: [true, true, false, false] });
    // 房主也走：桌上没真人了，房间收场（kit 不推只有电脑的桌），两个人按那一刻的筹码结回
    host.send({ t: 'leave' });
    for (let i = 0; i < 150 && ((await walletOf(ids[0]!)).stakes.length > 0 || (await walletOf(ids[1]!)).stakes.length > 0); i++) await sleep(20);
    expect((await walletOf(ids[0]!)).stakes).toEqual([]);
    expect((await walletOf(ids[1]!)).stakes).toEqual([]);
  });

  it('钱包只有 500：先被拒 no_funds，房间自动少带 500 再扣一次，成功', async () => {
    const { ids, host, guest } = await table({ 1: 500 });
    const v = await guest.see((x) => x.own[1]! && !x.opening);
    expect(v.inn).toBe(500);
    expect(v.refused).toBeNull();
    expect(await walletOf(ids[1]!)).toMatchObject({ balance: 0, stakes: [{ game: 'mahjong', amount: 500 }] });
    // 钱够的那位照常一整份
    const h = await host.see((x) => x.own[0]! && x.own[1]!);
    // 我的 inn 只是我的；他少带的数（就是他的钱包余额）不另外给别人
    expect(h.inn).toBe(SHARE);
  });
});

describe('搭子战绩', () => {
  const together = (userId: string) =>
    runInDurableObject(env.FAKE_BANK.get(env.FAKE_BANK.idFromName(userId)), (b: FakeBank) => b.together.map(({ game, op, players }) => ({ game, op, players })));

  it('一场打完报一次同桌真人和输赢（电脑不报）；同一场重报不加', async () => {
    // 客人钱包是空的：带入被拒，下注的真人不到两个，这一场当场收场（cut），两人都没输赢
    const { code, ids, host } = await table({ 1: 0 });
    await host.see((x) => x.done && x.cut);
    let got: Awaited<ReturnType<typeof together>> = [];
    for (let i = 0; i < 150 && !(got = await together(ids[0]!)).length; i++) await sleep(20);
    expect(got).toEqual([
      { game: 'mahjong', op: expect.stringMatching(new RegExp(`^${code}-[0-9a-z]+-1$`)), players: [{ userId: ids[0], win: false }, { userId: ids[1], win: false }] },
    ]);
    expect(await together(ids[1]!)).toEqual(got);
    // 房间被驱逐后重建、再报同一场：同一个 op，平台（假钱包）不加
    await runInDurableObject(stub(code), (room: MahjongRoom) => {
      (room as unknown as { reportMatch(p: { seat: number; win: boolean }[], m: number): number }).reportMatch([0, 1, 2, 3].map((seat) => ({ seat, win: seat === 0 })), 1);
    });
    await sleep(100);
    expect(await together(ids[0]!)).toEqual(got);
  });
});
