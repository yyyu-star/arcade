/**
 * 联机会话（src/view/net.ts）：不连真房间，换一个假的 RoomClient，直接喂房间消息。
 * 看视角有没有转对、帧怎么排队、出手怎么锁、换座位怎么整桌重画、关闭码有没有大白话。
 */
import type { RoomClient } from 'arcade-kit/client';
import { CLOSE, CLOSE_REASON, type RoomInfo, type StateMsg, type WelcomeMsg } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import { testKey, guandanRoom as R, type NetAction, type NetState, type NetView } from '../src/variants/guandan/net/rules.ts';
import { seatIdentity, seatName } from '../src/view/labels.ts';
import { fullSeatName, isWatching } from '../src/view/labels.ts';
import { updateSettings } from '../src/view/store.ts';
import { NetSession, QUOTA_TEXT, autoSeat, closeText, createRoom, currentUserId, isFinalForRoom, roomOwnerCheck, type SavedRoom } from '../src/view/net.ts';

class FakeClient {
  sent: { t: string; action?: NetAction; seat?: number }[] = [];
  private n = 0;
  act(action: NetAction): string {
    this.sent.push({ t: 'act', action });
    return `m${++this.n}`;
  }
  sit(seat: number): void {
    this.sent.push({ t: 'sit', seat });
  }
  start(): void {
    this.sent.push({ t: 'start' });
  }
  leave(): void {
    this.sent.push({ t: 'leave' });
  }
  close(): void {}
  retry(): void {}
}

function make(): { ses: NetSession; fake: FakeClient } {
  const fake = new FakeClient();
  const ses = new NetSession('123456', true, { client: fake as unknown as RoomClient<NetAction, NetView> });
  return { ses, fake };
}

const room = (turn: number | null): RoomInfo => ({
  code: '123456',
  status: 'playing',
  seats: [
    { kind: 'human', name: '阿一', away: false, auto: false },
    { kind: 'ai', name: null, away: false, auto: false },
    { kind: 'human', name: '小二', away: true, auto: false },
    { kind: 'ai', name: null, away: false, auto: false },
  ],
  turn: turn === null ? null : { seat: turn, deadline: Date.now() + 30_000 },
});

function welcome(s: NetState, seat: number): WelcomeMsg<NetView> {
  return { t: 'welcome', v: 1, minClientVersion: 1, seq: 5, you: { seat }, room: room(R.turn(s)), view: R.view(s, seat) };
}

function stateMsg(states: NetState[], seat: number, seq: number, ack?: string): StateMsg<NetView> {
  return { t: 'state', seq, you: { seat }, room: room(R.turn(states[states.length - 1]!)), frames: states.map((x, i) => ({ view: R.view(x, seat), delay: i ? 900 : 0 })), ...(ack ? { ack } : {}) };
}

/** 从开局往后走几步（电脑出） */
function walk(n: number): NetState[] {
  let s = R.begin(testKey(9), R.rulesVersion);
  const out = [s];
  for (let i = 0; i < n; i++) {
    const seat = R.turn(s)!;
    const r = R.apply(s, seat, R.ai(s, seat));
    if ('error' in r) throw new Error(r.error);
    s = r;
    out.push(s);
  }
  return out;
}

describe('联机会话', () => {
  it('进房快照：坐在 2 号位的人看到自己在 0；座位上的人按画面位置记好（对家是 0 号位的阿一）', () => {
    const { ses } = make();
    const st = walk(3);
    ses.handle(welcome(st[3]!, 2));
    expect(ses.mySeat).toBe(2);
    expect(ses.view().seat).toBe(0);
    expect(ses.view().hand).toEqual(st[3]!.g.hands[2]);
    // 画面 2 号位（对家）= 真实 0 号位
    expect(seatIdentity[2]).toEqual({ human: true, name: '阿一', away: false, auto: false });
    expect(seatName(2)).toBe('阿一');
    expect(seatIdentity[1]?.human).toBe(false);
    expect(seatIdentity[0]).toEqual({ human: true, name: '小二', away: true, auto: false });
    ses.close();
  });

  it('帧排队、一帧帧取；出手发出去以后锁住，收到 ack 才解锁', () => {
    const { ses, fake } = make();
    const st = walk(8);
    // 找一个轮到真实 0 号位的局面
    const i = st.findIndex((x) => R.turn(x) === 0 && x.g.phase === 'play');
    expect(i).toBeGreaterThanOrEqual(0);
    ses.handle(welcome(st[i]!, 0));
    expect(ses.canAct()).toBe(false); // 还没 open
    ses.status = 'open';
    expect(ses.canAct()).toBe(true);
    const r = ses.apply({ type: 'pass', seat: 0 });
    expect(r.sent).toBe(true);
    expect(fake.sent.at(-1)).toEqual({ t: 'act', action: { type: 'pass' } });
    expect(ses.canAct()).toBe(false);
    expect(ses.apply({ type: 'pass', seat: 0 }).sent).toBe(false);
    ses.handle(stateMsg([st[i + 1]!, st[i + 2]!], 0, 6, 'm1'));
    expect(ses.pending).toBeNull();
    expect(ses.queue.length).toBe(2);
    expect(ses.take()?.nv.view.step).toBe(st[i + 1]!.g.step);
    expect(ses.shown?.view.step).toBe(st[i + 1]!.g.step);
    ses.close();
  });

  it('被拒的操作解锁并记下原因；结算页的"继续"发 ready', () => {
    const { ses, fake } = make();
    const st = walk(2);
    ses.handle(welcome(st[2]!, 1));
    ses.status = 'open';
    ses.apply({ type: 'nextDeal' });
    expect(fake.sent.at(-1)).toEqual({ t: 'act', action: { type: 'ready' } });
    ses.handle({ t: 'error', code: 'wrong_phase', moveId: 'm1' });
    expect(ses.pending).toBeNull();
    expect(ses.lastError).toBe('wrong_phase');
    ses.close();
  });

  it('换了座位（接管电脑）：清掉排队的帧，按新座位整桌重画', () => {
    const { ses } = make();
    const st = walk(4);
    ses.handle(welcome(st[2]!, 0));
    const seen: string[] = [];
    ses.on((k) => seen.push(k));
    ses.handle(stateMsg([st[3]!, st[4]!], 3, 7));
    expect(seen).toEqual(['reset']);
    expect(ses.mySeat).toBe(3);
    expect(ses.queue.length).toBe(0);
    expect(ses.view().hand).toEqual(st[4]!.g.hands[3]);
    ses.close();
  });

  it('在大厅里坐着等开局：开局那条消息只排帧不显示，也算能进牌桌（进去后 begin 取第一帧当发牌动画）', () => {
    const { ses } = make();
    const st = walk(1);
    const lobby: WelcomeMsg<NetView> = { t: 'welcome', v: 1, minClientVersion: 1, seq: 3, you: { seat: 1 }, room: { ...room(null), status: 'waiting', turn: null }, view: null };
    ses.handle(lobby);
    expect(ses.canEnterTable).toBe(false);
    ses.handle(stateMsg([st[0]!, st[1]!], 1, 4));
    expect(ses.shown).toBeNull();
    expect(ses.canEnterTable).toBe(true);
    ses.begin();
    expect(ses.shown?.view.step).toBe(st[0]!.g.step);
    expect(ses.lastEvents.length).toBeGreaterThan(0);
    expect(ses.queue.length).toBe(1);
    ses.close();
  });

  it('结算页：没点过才能点继续；点了就锁住；房间回来"我已准备"以后不再能点；还在等谁按画面座位给', () => {
    const { ses, fake } = make();
    let end = R.begin(testKey(9), R.rulesVersion);
    for (let i = 0; i < 20000 && end.g.phase !== 'dealEnd'; i++) {
      const seat = R.turn(end)!;
      const r = R.apply(end, seat, R.ai(end, seat));
      if ('error' in r) throw new Error(r.error);
      end = r;
    }
    expect(end.g.phase).toBe('dealEnd');
    // 我坐真实 2 号位，真实 3 号位已经点了
    const r3 = R.apply(end, 3, { type: 'ready' });
    if ('error' in r3) throw new Error(r3.error);
    ses.handle(welcome(r3, 2));
    expect(ses.canReady()).toBe(false); // 还没 open
    ses.status = 'open';
    expect(ses.canReady()).toBe(true);
    // 真实 3 号位 = 我的下家（画面 1 号位）
    expect(ses.readyWait()?.waiting).toEqual([0, 2, 3]);
    ses.apply({ type: 'nextDeal' });
    expect(fake.sent.at(-1)).toEqual({ t: 'act', action: { type: 'ready' } });
    expect(ses.canReady()).toBe(false);
    const r2 = R.apply(r3, 2, { type: 'ready' });
    if ('error' in r2) throw new Error(r2.error);
    ses.handle(stateMsg([r2], 2, 6, 'm1'));
    ses.take();
    expect(ses.pending).toBeNull();
    expect(ses.canReady()).toBe(false);
    expect(ses.readyWait()?.waiting).toEqual([2, 3]);
    ses.close();
  });

  it('开打后座位绑人：记下我绑定的座位；别人离座、电脑代打的座位显示原主人的名字和"电脑代打"', () => {
    const { ses } = make();
    const st = walk(2);
    const info = room(R.turn(st[2]!));
    info.seats[3] = { kind: 'ai', name: '小王', away: false, auto: false, reserved: true };
    // 我离座了（seat null），绑定的是真实 1 号位
    ses.handle({ ...welcome(st[2]!, 1), you: { seat: null, bound: 1 }, room: info, view: R.view(st[2]!, null) });
    expect(ses.mySeat).toBeNull();
    expect(ses.bound).toBe(1);
    // 没入座时按真实座位摆：画面 3 = 真实 3
    expect(seatIdentity[3]).toEqual({ human: true, name: '小王', away: true, auto: true });
    expect(seatName(3)).toBe('小王');
    // 没绑人的电脑座位还是电脑
    expect(seatIdentity[1]?.human).toBe(false);
    ses.close();
  });

  it('记着的房间分账号：只给记下它的那个账号；换了账号（或旧记录没记账号）清掉；还不知道是谁时先不给也不清', () => {
    const r: SavedRoom = { code: '123456', host: true, at: 1, userId: 'uA' };
    expect(roomOwnerCheck(r, 'uA')).toBe('show');
    // 同一台设备换成 B：看不到 A 的房间，A 的房主标记也带不走
    expect(roomOwnerCheck(r, 'uB')).toBe('forget');
    // 没登录、连不上平台：不知道是谁
    expect(roomOwnerCheck(r, null)).toBe('wait');
    // 0.2.0 留下的旧记录、进房后没问到账号的记录：谁都不给
    expect(roomOwnerCheck({ ...r, userId: null }, 'uA')).toBe('forget');
  });

  it('现在是谁：问 /api/me 拿 user.id；没登录、出错、格式不对都是 null', async () => {
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await currentUserId(reply(200, { user: { id: 'uA', displayName: 'A' } }))).toBe('uA');
    expect(await currentUserId(reply(200, { user: null }))).toBeNull();
    expect(await currentUserId(reply(401, { error: 'unauthorized' }))).toBeNull();
    expect(await currentUserId(reply(503, 'down'))).toBeNull();
    expect(await currentUserId(reply(200, { user: { id: 7 } }))).toBeNull();
    expect(await currentUserId((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull();
  });

  it('回不去的关闭都忘掉房间（散了、码不对、没登录、满了、在别处进了、被拒、额度用完）；页面太旧、断网不算', () => {
    for (const c of [CLOSE.roomClosed, CLOSE.noRoom, CLOSE.unauthorized, CLOSE.full, CLOSE.replaced, CLOSE.forbidden, CLOSE.tooManyJoins, CLOSE.userQuota, CLOSE.busy]) {
      expect(isFinalForRoom(c), String(c)).toBe(true);
    }
    for (const c of [CLOSE.tooOld, CLOSE.tryLater, 1006, null]) expect(isFinalForRoom(c), String(c)).toBe(false);
  });

  it('每个关闭码都有一句不一样的大白话', () => {
    const codes = [CLOSE.unauthorized, CLOSE.tryLater, CLOSE.noRoom, CLOSE.tooManyJoins, CLOSE.userQuota, CLOSE.full, CLOSE.replaced, CLOSE.roomClosed, CLOSE.tooOld, CLOSE.forbidden, CLOSE.busy];
    const texts = [...codes.map((c) => closeText(c)), closeText(CLOSE.roomClosed, CLOSE_REASON.quota)];
    expect(new Set(texts).size).toBe(codes.length + 1);
    for (const t of texts) expect(t).toMatch(/[一-龥]/);
    // 额度满了收场、进不了新房间：都告诉他单机照常
    expect(closeText(CLOSE.roomClosed, CLOSE_REASON.quota)).toBe(QUOTA_TEXT.closed);
    expect(closeText(CLOSE.busy)).toBe(QUOTA_TEXT.joinBusy);
    expect(closeText(CLOSE.roomClosed, 'room closed')).toBe(closeText(CLOSE.roomClosed));
  });

  it('开房的额度错误（arcade-kit 0.2.0）都有一句话；同时开着的太多只说清楚，不送回旧房间（0.6.0）', async () => {
    const res = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    expect(await createRoom(res(201, { code: '123456' }))).toEqual({ code: '123456' });
    expect(await createRoom(res(409, { error: 'has_room', code: '654321' }))).toEqual({ error: QUOTA_TEXT.has_room, quota: 'has_room' });
    expect(await createRoom(res(429, { error: 'daily_limit' }))).toEqual({ error: QUOTA_TEXT.daily_limit, quota: 'daily_limit' });
    expect(await createRoom(res(503, { error: 'busy' }))).toEqual({ error: QUOTA_TEXT.busy, quota: 'busy' });
    expect(await createRoom(res(503, { error: 'unavailable' }))).toEqual({ error: '房间没开成（平台一时连不上），过一会儿再点"开个房间"' });
    expect(await createRoom(res(401, { error: 'login' }))).toMatchObject({ login: true });
  });
});

/** 假 WebSocket：测试手动让它连上、关掉 */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closedWith: number | undefined;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(code?: number): void {
    this.closedWith = code;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  /** 平台不可用时 kit 的 Worker 先接下升级再以 1013 关掉，所以先 open 再 close */
  refuse(code: number): void {
    this.open();
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

/** 真 RoomClient + 假 WebSocket + 手动计时器 */
function live(): { ses: NetSession; tick: () => void; last: () => FakeSocket } {
  FakeSocket.all = [];
  const timers: (() => void)[] = [];
  const ses = new NetSession('123456', false, {
    url: 'ws://game.test/games/guandan/room/rooms/123456/ws',
    WebSocketImpl: FakeSocket,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  });
  // 只跑重连的那个计时器（心跳的也在里面，跑了无妨）
  const tick = (): void => {
    for (const fn of timers.splice(0)) fn();
  };
  return { ses, tick, last: () => FakeSocket.all[FakeSocket.all.length - 1]! };
}

describe('连不上时的说法：平台忙（1013）和断网分开说', () => {
  it('1013：重连中说"平台有点忙，正在重试…"，一直不行停下来说"过一会儿再试"；进了房间就忘掉', () => {
    const { ses, tick, last } = live();
    last().refuse(CLOSE.tryLater);
    expect(ses.status).toBe('reconnecting');
    expect(ses.platformBusy).toBe(true);
    expect(ses.linkText()).toBe('平台有点忙，正在重试…');
    expect(ses.linkText(true)).toBe('平台有点忙，正在重试…');
    for (let i = 0; i < 30 && ses.status !== 'failed'; i++) {
      tick();
      last().refuse(CLOSE.tryLater);
    }
    expect(ses.status).toBe('failed');
    expect(ses.linkText()).toBe('平台有点忙，过一会儿再试');
    expect(ses.linkText(true)).toContain('平台有点忙');
    // 点重试、这次进了房间：不再算"平台忙"
    ses.retry();
    last().open();
    const st = walk(0)[0]!;
    last().onmessage!({ data: JSON.stringify(welcome(st, 1)) });
    expect(ses.lastCloseCode).toBeNull();
    expect(ses.status).toBe('open');
    expect(ses.linkText()).toBe('');
  });

  it('1006（断网、升级被拒）：还是说网络', () => {
    const { ses, tick, last } = live();
    last().refuse(1006);
    expect(ses.status).toBe('reconnecting');
    expect(ses.linkText()).toBe('网络断了，正在重连…');
    for (let i = 0; i < 30 && ses.status !== 'failed'; i++) {
      tick();
      last().refuse(1006);
    }
    expect(ses.status).toBe('failed');
    expect(ses.linkText()).toBe('连不上房间，检查一下网络');
    expect(ses.linkText(true)).toBe('连不上房间，点这里重试');
  });
});

describe('连回来自动"我回来了"（0.6.4）', () => {
  const begun = R.begin(testKey(9), R.rulesVersion, { opts: undefined, seats: ['human', 'ai', 'human', 'ai'] });

  it('进房快照里我还"托管中"：替我发一次 back；没走开的、别人走开的不发', () => {
    const away = make();
    away.ses.handle(welcome({ ...begun, idle: [0, 0, 2, 0] }, 2));
    expect(away.fake.sent).toContainEqual({ t: 'act', action: { type: 'back' } });
    const here = make();
    here.ses.handle(welcome({ ...begun, idle: [2, 0, 0, 0] }, 2));
    expect(here.fake.sent.filter((m) => m.t === 'act')).toEqual([]);
  });

  it('晚到一步被拒（not_away）不提示', () => {
    const { ses } = make();
    ses.handle(welcome(begun, 2));
    ses.handle({ t: 'error', code: 'not_away' });
    expect(ses.lastError).toBeNull();
  });
});

describe('进房自动坐下（0.6.0）', () => {
  const seat = (kind: 'human' | 'ai' | 'empty', reserved = false) => ({ kind, name: kind === 'human' ? '玩家' : null, away: false, auto: false, reserved });
  const room = (status: RoomInfo['status'], seats: ReturnType<typeof seat>[], opts?: unknown) => ({ code: '123456', status, seats, ...(opts ? { opts } : {}) }) as unknown as RoomInfo;

  it('等人时坐第一个空位；开打了先旁观、不替人接管（0.13.0）；绑着座位的回自己的座位；已经坐着的不动', () => {
    expect(autoSeat(room('waiting', [seat('human'), seat('empty'), seat('empty'), seat('empty')]), { seat: null })).toBe(1);
    expect(autoSeat(room('playing', [seat('human'), seat('ai', true), seat('ai'), seat('human')]), { seat: null, bound: null })).toBeNull();
    expect(autoSeat(room('playing', [seat('human'), seat('ai', true), seat('ai'), seat('human')]), { seat: null, bound: 1 })).toBe(1);
    expect(autoSeat(room('playing', [seat('human'), seat('ai', true), seat('human'), seat('human')]), { seat: null, bound: null })).toBeNull();
    expect(autoSeat(room('waiting', [seat('human'), seat('empty'), seat('empty'), seat('empty')]), { seat: 0 })).toBeNull();
    expect(autoSeat(room('over', [seat('ai'), seat('ai'), seat('ai'), seat('ai')]), { seat: null })).toBeNull();
  });

  it('再来一场跟过来的（0.6.2）：先坐想坐的座位（和上一场一样的相对位置），被人坐了就坐第一个空位', () => {
    const r = room('waiting', [seat('human'), seat('empty'), seat('empty'), seat('empty')]);
    expect(autoSeat(r, { seat: null }, 2)).toBe(2);
    expect(autoSeat(r, { seat: null }, 0)).toBe(1);
    expect(autoSeat(room('playing', [seat('human'), seat('ai'), seat('ai'), seat('human')]), { seat: null, bound: null }, 2)).toBeNull();
  });

  it('实盘房间坐下就要带入：不替人坐（回自己的座位除外）', () => {
    const r = room('waiting', [seat('human'), seat('empty'), seat('empty'), seat('empty')], { stake: 'mid' });
    expect(autoSeat(r, { seat: null })).toBeNull();
    expect(autoSeat(room('playing', [seat('human'), seat('ai', true), seat('ai'), seat('ai')], { stake: 'mid' }), { seat: null, bound: 1 })).toBe(1);
  });
});

describe('旁观（0.13.0，docs/social.md 1.4）', () => {
  const st = walk(3);
  const spectate = (msgRoom: RoomInfo): WelcomeMsg<NetView> => ({ t: 'welcome', v: 1, minClientVersion: 1, seq: 5, you: { seat: null }, room: msgRoom, view: R.view(st[3]!, -1) });

  it('开打后没坐下也进牌桌，看的是公开视图：没有任何人的手牌；画面座位 0 是真实 0 号，名字不叫"你"', () => {
    const { ses, fake } = make();
    ses.handle(spectate(room(R.turn(st[3]!))));
    expect(ses.watching).toBe(true);
    expect(ses.canEnterTable).toBe(true);
    expect(ses.view().hand).toEqual([]);
    expect(fake.sent.filter((m) => m.t === 'sit')).toEqual([]);
    expect(isWatching()).toBe(true);
    expect(fullSeatName(0)).toBe('阿一');
    ses.close();
    expect(isWatching()).toBe(false);
    expect(fullSeatName(0)).toBe('你');
  });

  it('"坐下"坐哪儿：娱乐房间接管没绑人的电脑座位；绑着座位的回自己的；实盘房间只看（自己的座位除外）；没地方坐是 null', () => {
    const a = make().ses;
    a.handle(spectate(room(null)));
    expect(a.freeSeat()).toBe(1);
    const b = make().ses;
    b.handle({ ...spectate(room(null)), you: { seat: null, bound: 3 } });
    expect(b.freeSeat()).toBe(3);
    const c = make().ses;
    c.handle(spectate({ ...room(null), opts: { stake: 'mid' } } as RoomInfo));
    expect(c.freeSeat()).toBeNull();
    const d = make().ses;
    d.handle(spectate({ ...room(null), seats: room(null).seats.map((x) => ({ ...x, kind: 'human' as const })) }));
    expect(d.freeSeat()).toBeNull();
    // 坐着的人不是旁观
    const e = make().ses;
    e.handle(welcome(st[3]!, 1));
    expect(e.watching).toBe(false);
    expect(e.freeSeat()).toBeNull();
    for (const x of [a, b, c, d, e]) x.close();
  });
});

describe('快速匹配的桌（0.26.0）', () => {
  /** 记下连的地址就行：kit 有 onChat 才在地址上带 chat=1 */
  const urls: string[] = [];
  class FakeSocket {
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor(url: string) {
      urls.push(url);
    }
    send(): void {}
    close(): void {}
  }
  const open = (match: boolean): NetSession => {
    const ses = new NetSession('654321', false, { match, url: 'ws://x/games/guandan/room/rooms/654321/ws', WebSocketImpl: FakeSocket as never });
    ses.close();
    return ses;
  };

  it('聊天选了"不和陌生人"：匹配桌不带 chat=1、聊天页不给；好友房照常带', () => {
    updateSettings({ strangerChat: false });
    urls.length = 0;
    const m = open(true);
    expect(m.match).toBe(true);
    expect(m.chatOn).toBe(false);
    expect(urls.at(-1)).not.toContain('chat=1');
    const f = open(false);
    expect(f.chatOn).toBe(true);
    expect(urls.at(-1)).toContain('chat=1');
    updateSettings({ strangerChat: true });
    expect(open(true).chatOn).toBe(true);
    expect(urls.at(-1)).toContain('chat=1');
  });

  it('房间信息到了以 RoomInfo.match 为准', () => {
    const { ses } = make();
    expect(ses.match).toBe(false);
    ses.handle({ ...welcome(walk(0)[0]!, 0), room: { ...room(0), match: true } });
    expect(ses.match).toBe(true);
  });
});
