/** 浏览器连接器（4.5）：退避加抖动、哪些关闭码不重连、切回前台马上连、seq 去重、没确认的操作重发。用假的 WebSocket 和计时器。 */
import { describe, expect, it, vi } from 'vitest';
import { backoffMs, CONNECT_MS, MATCH_GRACE_MS, MatchClient, PONG_WAIT_MS, RoomClient, STALL_GRACE_MS, STALL_JITTER_MS, type WebSocketLike } from '../src/client.ts';
import type { DownMsg } from '../src/protocol.ts';

class FakeWs implements WebSocketLike {
  static all: FakeWs[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup() {
  FakeWs.all = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const listeners = new Map<string, (ev?: unknown) => void>();
  let hidden = false;
  const got: DownMsg[] = [];
  const emotes: [number, number, number | undefined][] = [];
  const statuses: string[] = [];
  const client = new RoomClient<{ card: number }>({
    url: 'wss://game.example.com/rooms/123456/ws',
    clientVersion: 3,
    onMessage: (m) => got.push(m),
    onEmote: (seat, id, to) => emotes.push([seat, id, to]),
    onStatus: (s, code) => statuses.push(code ? `${s}:${code}` : s),
    WebSocketImpl: FakeWs,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, id: ++id });
      return id;
    },
    clearTimer: (t) => {
      const i = timers.findIndex((x) => x.id === t);
      if (i >= 0) timers.splice(i, 1);
    },
    events: { addEventListener: (t, fn) => listeners.set(t, fn), removeEventListener: (t) => listeners.delete(t) },
    isHidden: () => hidden,
  });
  /** 跑掉等待时间为 ms 的那个计时器（重连用的）。 */
  const fire = (ms: number) => {
    const i = timers.findIndex((t) => t.ms === ms);
    if (i < 0) throw new Error(`no timer of ${ms}ms; have ${timers.map((t) => t.ms).join(',')}`);
    const [t] = timers.splice(i, 1);
    t!.fn();
  };
  const ws = () => FakeWs.all.at(-1)!;
  return { client, got, emotes, statuses, timers, fire, ws, listeners, setHidden: (h: boolean) => (hidden = h) };
}

const welcome = (seq: number): DownMsg => ({ t: 'welcome', v: 1, minClientVersion: 0, seq, you: { seat: 0 }, room: { code: '123456', status: 'playing', seats: [], turn: null }, view: null });
const state = (seq: number, ack?: string): DownMsg => ({ t: 'state', seq, you: { seat: 0 }, room: { code: '123456', status: 'playing', seats: [], turn: null }, frames: [], ...(ack ? { ack } : {}) });

describe('重连', () => {
  it('退避：0.5、1、2、4、8 秒……封顶 15 秒，乘 [0.5, 1) 的抖动', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, () => 0))).toEqual([250, 500, 1000, 2000, 4000, 7500, 7500]);
    expect(backoffMs(3, () => 0.999)).toBeLessThan(4000);
    expect(backoffMs(20, () => 0.999)).toBeLessThanOrEqual(15_000);
  });

  it('URL 带客户端版本；异常断开（1006）按退避重连，进了房间（收到 welcome）后退避清零', () => {
    const t = setup();
    expect(t.ws().url).toBe('wss://game.example.com/rooms/123456/ws?cv=3');
    t.ws().open();
    t.ws().drop(1006);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
    t.fire(375); // 500 × 0.75
    expect(FakeWs.all).toHaveLength(2);
    t.ws().drop(1006);
    t.fire(750);
    // 只是 open 不清零（被拒的连接也会先 open 再关）
    t.ws().open();
    t.ws().drop(1006);
    t.fire(1500);
    t.ws().open();
    t.ws().push(welcome(1));
    t.ws().drop(1006);
    t.fire(375);
    expect(FakeWs.all).toHaveLength(5);
  });

  it('平台暂时不可用（1013，先 open 再关）：照常按退避重连，不会越连越快；一直这样 20 次就停下', () => {
    const t = setup();
    const waits: number[] = [];
    for (let i = 0; i < 19; i++) {
      t.ws().open();
      t.ws().drop(1013);
      // 0.1.1：reconnecting 带上刚断开的关闭码，游戏能显示"平台有点忙"
      expect(t.statuses.at(-1)).toBe('reconnecting:1013');
      const w = t.timers.find((x) => x.ms !== 25_000)!.ms;
      waits.push(w);
      t.fire(w);
    }
    // 退避一路变长到 15 秒封顶（random 固定 0.5，所以是 0.75 倍）
    expect(waits.slice(0, 6)).toEqual([375, 750, 1500, 3000, 6000, 11250]);
    expect(waits.at(-1)).toBe(11250);
    t.ws().open();
    t.ws().drop(1013);
    expect(t.statuses.at(-1)).toBe('failed:1013');
  });

  it('1008、1009、4000 段（房间关了、被顶掉、版本太旧、没登录 4401、别的网站 4403、满了、次数用完）不重连', () => {
    for (const code of [1008, 1009, 4000, 4001, 4003, 4004, 4005, 4029, 4401, 4403]) {
      const t = setup();
      t.ws().open();
      t.ws().drop(code);
      expect(t.statuses.at(-1)).toBe(`closed:${code}`);
      expect(t.timers.filter((x) => x.ms !== 25_000)).toHaveLength(0);
    }
  });

  it('一次都没连上、连着失败 20 次：停下（failed），不再自己重连；用户点重试从头再连', () => {
    const t = setup();
    for (let i = 0; i < 19; i++) {
      t.ws().drop(1006);
      expect(t.statuses.at(-1)).toBe('reconnecting:1006');
      t.fire(t.timers[0]!.ms);
    }
    t.ws().drop(1006);
    expect(t.statuses.at(-1)).toBe('failed:1006');
    expect(t.timers).toHaveLength(0);
    t.listeners.get('visibilitychange')!();
    expect(FakeWs.all).toHaveLength(20);
    t.client.retry();
    expect(FakeWs.all).toHaveLength(21);
    t.ws().open();
    expect(t.client.state).toBe('open');
  });

  it('进过房间再断：失败次数从进房那次起重新算', () => {
    const t = setup();
    for (let i = 0; i < 10; i++) {
      t.ws().drop(1006);
      t.fire(t.timers[0]!.ms);
    }
    t.ws().open();
    t.ws().push(welcome(0));
    for (let i = 0; i < 19; i++) {
      t.ws().drop(1006);
      expect(t.statuses.at(-1)).toBe('reconnecting:1006');
      t.fire(t.timers.find((x) => x.ms !== 25_000)!.ms);
    }
  });

  it('切回前台：等着重连的马上连，不等退避；在后台不连', () => {
    const t = setup();
    t.ws().open();
    t.ws().drop(1006);
    t.setHidden(true);
    t.listeners.get('visibilitychange')!();
    expect(FakeWs.all).toHaveLength(1);
    t.setHidden(false);
    t.listeners.get('pageshow')!();
    expect(FakeWs.all).toHaveLength(2);
    expect(t.timers.find((x) => x.ms === 375)).toBeUndefined();
  });

  it('连着的时候切回前台：发一个 ping 探一下', () => {
    const t = setup();
    t.ws().open();
    t.listeners.get('visibilitychange')!();
    expect(t.ws().sent).toContain('ping');
  });

  it('静默死掉的连接（0.11.1）：心跳发了 ping，8 秒内什么都没收到就扔掉重连；收到 pong 就不算', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    // 活着的：pong 回来了，到点不动
    t.fire(25_000);
    expect(t.ws().sent.at(-1)).toBe('ping');
    t.ws().onmessage?.({ data: 'pong' });
    t.fire(PONG_WAIT_MS);
    expect(FakeWs.all).toHaveLength(1);
    expect(t.client.state).toBe('open');
    // 死了的：iOS 锁屏后 readyState 还是 OPEN、不触发 close，ping 石沉大海
    t.fire(25_000);
    const dead = t.ws();
    t.fire(PONG_WAIT_MS);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
    expect(dead.onclose).toBeNull();
    t.fire(375);
    expect(FakeWs.all).toHaveLength(2);
    // 死连接的 close 很久以后才来：不影响新连接
    dead.onclose?.({ code: 1006 });
    t.ws().open();
    expect(t.client.state).toBe('open');
  });

  it('探活期间收到的任何消息都算活着（不只是 pong）', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    t.fire(25_000);
    t.ws().push(state(1));
    t.fire(PONG_WAIT_MS);
    expect(t.client.state).toBe('open');
    expect(t.statuses).not.toContain('reconnecting:1006');
  });

  it('建连卡在 CONNECTING 超过 10 秒：按一次失败重连；按时连上的不动', () => {
    const t = setup();
    t.fire(CONNECT_MS);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
    t.fire(375);
    t.ws().open();
    expect(t.timers.find((x) => x.ms === CONNECT_MS)).toBeUndefined();
    expect(FakeWs.all).toHaveLength(2);
  });

  it('切回前台时连着：发 ping 探活，探不到就重连', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    t.listeners.get('visibilitychange')!();
    expect(t.ws().sent).toContain('ping');
    t.fire(PONG_WAIT_MS);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
  });

  it('网络恢复（online）：等着重连的马上连，不等退避', () => {
    const t = setup();
    t.ws().open();
    t.ws().drop(1006);
    expect(FakeWs.all).toHaveLength(1);
    t.listeners.get('online')!();
    expect(FakeWs.all).toHaveLength(2);
  });

  it('从往返缓存回来（pageshow persisted）：旧连接哪怕看着是 OPEN 也扔掉、马上重连；普通的 pageshow 只探活', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    t.listeners.get('pageshow')!({ persisted: false });
    expect(FakeWs.all).toHaveLength(1);
    expect(t.ws().sent).toContain('ping');
    t.ws().onmessage?.({ data: 'pong' });
    const old = t.ws();
    t.listeners.get('pageshow')!({ persisted: true });
    expect(FakeWs.all).toHaveLength(2);
    expect(old.onmessage).toBeNull();
    expect(t.timers.find((x) => x.ms === 375)).toBeUndefined();
  });

  it('切回前台时旧连接已经是 CLOSED 却一直没等到 close：扔掉、马上连', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    t.ws().readyState = 3;
    t.listeners.get('visibilitychange')!();
    expect(FakeWs.all).toHaveLength(2);
  });

  it('close() 摘掉三个页面事件', () => {
    const t = setup();
    t.client.close();
    expect([...t.listeners.keys()]).toEqual([]);
  });

  it('主动 close 后不再重连', () => {
    const t = setup();
    t.ws().open();
    t.client.close();
    t.ws().drop(1006);
    expect(FakeWs.all).toHaveLength(1);
    expect(t.statuses.at(-1)).toBe('closed');
  });
});

describe('看门狗（0.13.1）：房间的闹钟没设上时重连一次把它叫醒', () => {
  const NOW = 1_000_000;
  /** 在打、0 号出手、30 秒后到点；now 是房间发消息时的时间 */
  const turnState = (seq: number, extra: Record<string, unknown> = {}): DownMsg =>
    ({ t: 'state', seq, you: { seat: 0 }, room: { code: '123456', status: 'playing', seats: [], turn: { seat: 0, deadline: NOW + 30_000 } }, frames: [], now: NOW, ...extra }) as DownMsg;
  // random 固定 0.5：抖动是一半
  const WAIT = 30_000 + STALL_GRACE_MS + STALL_JITTER_MS / 2;

  it('时限按房间的 now 算（不看浏览器的钟），过了宽限还停在这一步：扔掉连接重连；同一步只踢一次', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(1));
    t.ws().push(turnState(2));
    const first = t.ws();
    t.fire(WAIT);
    expect(first.readyState).toBe(3);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
    t.fire(375);
    expect(FakeWs.all).toHaveLength(2);
    // 重连后房间还停在同一步（比如闹钟还是设不上）：不再踢，等真人出手或下一次进出
    t.ws().open();
    t.ws().push({ ...(turnState(2) as object), t: 'welcome', v: 1, minClientVersion: 0, view: null } as DownMsg);
    expect(t.timers.some((x) => x.ms === WAIT)).toBe(false);
    // 房间动了（新的一步）：照常看
    t.ws().push(turnState(3));
    expect(t.timers.some((x) => x.ms === WAIT)).toBe(true);
  });

  it('到点前来了新的一步：重新计时，不踢', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(1));
    t.ws().push(turnState(2));
    t.ws().push(turnState(3, { now: NOW + 20_000 }));
    // 只剩一个看门狗计时器，按新的一步算（离时限还剩 10 秒）
    expect(t.timers.filter((x) => x.ms === WAIT)).toHaveLength(0);
    expect(t.timers.filter((x) => x.ms === WAIT - 20_000)).toHaveLength(1);
    t.fire(WAIT - 20_000);
    expect(t.statuses.at(-1)).toBe('reconnecting:1006');
  });

  it('不在打、没有时限、旧房间不带 now：不看', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(1));
    const before = t.timers.length;
    t.ws().push(turnState(2, { now: undefined }));
    t.ws().push(turnState(3, { room: { code: '123456', status: 'playing', seats: [], turn: null } }));
    t.ws().push(turnState(4, { room: { code: '123456', status: 'over', seats: [], turn: { seat: 0, deadline: NOW + 1 } } }));
    expect(t.timers.length).toBe(before);
  });

  it('停一会儿（pause.until）也算时限', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(1));
    t.ws().push(turnState(2, { room: { code: '123456', status: 'playing', seats: [], turn: null, pause: { until: NOW + 5_000 } } }));
    expect(t.timers.some((x) => x.ms === 5_000 + STALL_GRACE_MS + STALL_JITTER_MS / 2)).toBe(true);
  });
});

describe('去重和重发', () => {
  it('按 seq 去重：快照之后只收更新的', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(5));
    t.ws().push(state(5));
    t.ws().push(state(6));
    t.ws().push(state(6));
    t.ws().push(state(4));
    t.ws().push(state(7));
    expect(t.got.map((m) => (m.t === 'error' ? -1 : m.seq))).toEqual([5, 6, 7]);
  });

  it('快捷短语（0.6.0）：emote() 发编号；转发回来的交给 onEmote、不进 onMessage、不动 seq；没连上时丢掉不重发', () => {
    const t = setup();
    t.client.emote(1);
    t.ws().open();
    expect(t.ws().sent).toEqual([]);
    t.ws().push(welcome(5));
    t.client.emote(3);
    expect(JSON.parse(t.ws().sent.at(-1)!)).toEqual({ t: 'emote', id: 3 });
    t.ws().push({ t: 'emote', seat: 2, id: 3 });
    t.ws().push({ t: 'emote', seat: 'x', id: 3 });
    t.ws().push(state(6));
    t.ws().push({ t: 'emote', seat: 1, id: 0, to: 2 });
    t.client.emote(4, 1);
    expect(JSON.parse(t.ws().sent.at(-1)!)).toEqual({ t: 'emote', id: 4, to: 1 });
    expect(t.emotes).toEqual([[2, 3, undefined], [1, 0, 2]]);
    expect(t.got.map((m) => m.t)).toEqual(['welcome', 'state']);
  });

  it('快捷短语的节奏（0.7.0）：按 welcome 给的令牌桶发，快了排队只留最后 2 句、到下一个令牌再发；房间回的 emote_too_fast 不交给页面', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    try {
      const t = setup();
      t.ws().open();
      t.ws().push({ ...welcome(1), emote: { ms: 1000, burst: 3 } });
      for (let i = 0; i < 6; i++) t.client.emote(i);
      const ids = () => t.ws().sent.map((x) => JSON.parse(x) as { id: number }).map((m) => m.id);
      expect(ids()).toEqual([0, 1, 2]);
      const due = t.timers.find((x) => x.ms !== 25_000)!;
      expect(due.ms).toBeGreaterThanOrEqual(1000);
      vi.setSystemTime(Date.now() + 1000);
      t.fire(due.ms);
      // 排队只留最后两句（4、5），3 被挤掉；按顺序一句一句发
      expect(ids()).toEqual([0, 1, 2, 4]);
      vi.setSystemTime(Date.now() + 1000);
      t.fire(t.timers.find((x) => x.ms !== 25_000)!.ms);
      expect(ids()).toEqual([0, 1, 2, 4, 5]);
      t.ws().push({ t: 'error', code: 'emote_too_fast' });
      expect(t.got.map((m) => m.t)).toEqual(['welcome']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('没确认的操作：重连后按原 moveId、原 baseSeq 重发；收到 ack 或被拒后不再重发', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(0));
    const a = t.client.act({ card: 7 });
    const b = t.client.act({ card: 9 });
    expect(t.ws().sent.map((x) => JSON.parse(x).moveId)).toEqual([a, b]);
    t.ws().push(state(1, a));
    t.ws().drop(1006);
    t.fire(375);
    t.ws().open();
    t.ws().push(welcome(1));
    // 只重发没确认的 b，moveId 不变
    // baseSeq 还是出手时看到的 0（后来收到了 seq 1）：牌局要是变过，房间会回 stale
    expect(t.ws().sent.map((x) => JSON.parse(x))).toEqual([{ t: 'act', moveId: b, baseSeq: 0, action: { card: 9 } }]);
    t.ws().push({ t: 'error', code: 'stale', moveId: b });
    t.ws().drop(1006);
    t.fire(375);
    t.ws().open();
    expect(t.ws().sent).toEqual([]);
  });

  it('没连上时先存着，连上后发；ack 对应的重复状态（seq 没变）不再交给游戏', () => {
    const t = setup();
    const a = t.client.act({ card: 1 });
    expect(t.ws().sent).toEqual([]);
    t.ws().open();
    expect(JSON.parse(t.ws().sent[0]!).moveId).toBe(a);
    t.ws().push(welcome(3));
    t.ws().push(state(3, a));
    expect(t.got).toHaveLength(1);
  });

  it('别人看不出来的一步（0.7.1）：seq 没变、带着我这一步的 ack 和 quiet，交给游戏一次；不是我的、没带 quiet、重复的都丢掉', () => {
    const t = setup();
    t.ws().open();
    t.ws().push(welcome(3));
    const a = t.client.act({ card: 1 });
    const b = t.client.act({ card: 2 });
    t.ws().push({ ...state(3, a), quiet: true } as DownMsg);
    t.ws().push({ ...state(3, a), quiet: true } as DownMsg);
    t.ws().push({ ...state(3, 'not-mine'), quiet: true } as DownMsg);
    t.ws().push(state(3, b));
    t.ws().push(state(4));
    expect(t.got.map((m) => (m.t === 'state' ? [m.seq, m.ack ?? null] : m.t))).toEqual(['welcome', [3, a], [4, null]]);
  });
});

describe('MatchClient（0.20.0）', () => {
  function run() {
    FakeWs.all = [];
    const got: unknown[] = [];
    const c = new MatchClient({
      url: 'wss://x/match/four',
      onWaiting: (n, seats, left) => got.push(['waiting', n, seats, left]),
      onMatched: (code) => got.push(['matched', code]),
      onSolo: (why) => got.push(['solo', why]),
      WebSocketImpl: FakeWs,
    });
    c.start();
    return { c, got, ws: FakeWs.all[0]! };
  }

  it('人数、凑成：结果只回一次，之后的关闭不再回调', () => {
    const { got, ws } = run();
    ws.push({ t: 'waiting', n: 2, seats: 4, left: 9000 });
    ws.push({ t: 'matched', code: '123456' });
    ws.drop(1000);
    expect(got).toEqual([['waiting', 2, 4, 9000], ['matched', '123456']]);
  });

  it('has_room 没给 onHasRoom 时当 onMatched；断线按关闭码转单机，不重连', () => {
    const a = run();
    a.ws.push({ t: 'has_room', code: '654321' });
    expect(a.got).toEqual([['matched', '654321']]);
    for (const [code, why] of [[4001, 'replaced'], [4029, 'too_often'], [1013, 'busy'], [1006, 'unavailable']] as const) {
      const b = run();
      b.ws.drop(code);
      expect(b.got).toEqual([['solo', why]]);
      expect(FakeWs.all).toHaveLength(1);
    }
  });

  it('cancel 以后什么都不回调', () => {
    const { c, got, ws } = run();
    c.cancel();
    ws.push({ t: 'matched', code: '123456' });
    ws.drop(1000);
    expect(got).toEqual([]);
  });
});

describe('MatchClient 兜底（0.20.0 安全审阅）', () => {
  it('排队那边到点了还没给结果：再等 MATCH_GRACE_MS 就自己转单机、关掉连接；人数推送会把兜底往后挪', () => {
    vi.useFakeTimers();
    try {
      FakeWs.all = [];
      const got: unknown[] = [];
      const c = new MatchClient({ url: 'wss://x/m', waitMs: 15_000, onMatched: () => got.push('matched'), onSolo: (w) => got.push(w), WebSocketImpl: FakeWs });
      c.start();
      const ws = FakeWs.all[0]!;
      vi.advanceTimersByTime(20_000);
      ws.push({ t: 'waiting', n: 2, seats: 4, left: 9_000 });
      vi.advanceTimersByTime(9_000 + MATCH_GRACE_MS - 1);
      expect(got).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(got).toEqual(['unavailable']);
      expect(ws.readyState).toBe(3);
      ws.push({ t: 'matched', code: '123456' });
      expect(got).toEqual(['unavailable']);
    } finally {
      vi.useRealTimers();
    }
  });
});
