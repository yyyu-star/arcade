/**
 * 浏览器端连接器（docs/platform-backend.md 4.5）：
 * - 断线后按指数退避加随机抖动重连；房间每次都回全量快照（welcome），客户端整桌重画，不做增量修补；
 * - 页面从后台切回来（document 的 visibilitychange、window 的 pageshow）、网络恢复（window 的 online）时立刻检查连接：iOS Safari、微信切后台会挂起连接；
 *   从往返缓存（bfcache，pageshow 带 persisted）回来的页面，旧连接一律作废、马上重连（0.11.1）；
 * - 静默死掉的连接（0.11.1）：iOS 锁屏、切 App 以后 socket 常常还是 OPEN、也不触发 close，发出去的石沉大海。
 *   每次心跳（和切回前台）发 "ping" 以后等 PONG_WAIT_MS，这期间什么都没收到（连房间自动回的 "pong" 都没有）就判它死了：
 *   不等 close，直接扔掉、按断线重连。建连卡在 CONNECTING 超过 CONNECT_MS 也一样。只看"收到过没有"，不比时钟，后台节流的计时器晚跑也不会误判；
 * - 收到 1008、1009 或 4000 段关闭码时不重连（违规、房间关了、被别处顶掉、版本太旧、没登录 4401、别的网站 4403）；
 * - 平台暂时不可用（1013）照常按退避重连；
 * - 连着 maxFailures 次（默认 20 次，约 4 分钟）都没进得了房间（没收到 welcome）就停下，状态变成 failed，由界面提示"连不上"、让用户点 retry()。
 *   退避和失败次数都在收到 welcome 时才清零，不在 onopen：被拒的连接也会先 open 再关，按 onopen 清零就会一直快速重连；
 * - 下行消息按 seq 去重，旧的丢掉；上行操作带 moveId 和 baseSeq（做决定时看到的 seq），没收到 ack 的在重连后原样重发：
 *   房间认得出重复的 moveId；牌局在那之后变过的，房间回 stale，不会把旧操作套到新的一手上；
 * - 心跳发纯文本 "ping"，房间由运行时自动回 "pong"（setWebSocketAutoResponse），不唤醒房间。
 *
 * 浏览器里的计时器（重连、心跳）可以用 setTimeout，"只用一个闹钟"是房间（Durable Object）那边的规矩。
 */
import { CLOSE, CLOSE_REASON, type CreateError, type DownMsg, type EmotedMsg, isFinalClose, PING, PONG, PROTOCOL_VERSION, type UpMsg } from './protocol.js';

export type ClientStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface RoomClientOptions<V> {
  /** 房间的 WebSocket 地址（游戏 Worker 的路径，如 wss://<站点>/games/<id>/rooms/123456/ws） */
  url: string;
  /** 页面的版本号，房间据此判断要不要让旧页面刷新 */
  clientVersion?: number;
  onMessage(msg: DownMsg<V>): void;
  /**
   * 连接状态变化。closeCode：closed、failed 时是让它停下的那个关闭码；reconnecting 时是刚断开的那条连接的关闭码
   * （1006 网络断了、1013 平台暂时认不了人……，0.1.1 起才带）；connecting、open 时没有。
   * reason：closed 时房间给的关闭原因（0.2.0）；4000 带 CLOSE_REASON.quota 是今天联机额度满了、房间收场，其他时候一般不用看
   */
  onStatus?(status: ClientStatus, closeCode?: number, reason?: string): void;
  /**
   * 有人发了快捷短语（0.6.0，见 RoomGame.emotes）：seat 是房间的座位号，id 是短语编号。不传就丢掉。
   * to（0.7.0）：冲着哪个座位发的，没指定时是 undefined；bot（0.10.0）：电脑座位发的（GameRoom.botEmote）是 true，一般不用区分
   */
  onEmote?(seat: number, id: number, to?: number, bot?: boolean): void;
  /** 下面这些是给测试注入的；浏览器里不用传 */
  WebSocketImpl?: { new (url: string): WebSocketLike };
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** 页面事件来源：events 收 visibilitychange（默认 document），windowEvents 收 pageshow、online（默认 window，没给时用 events）；没有就不监听 */
  events?: EventSourceLike;
  windowEvents?: EventSourceLike;
  isHidden?: () => boolean;
  /** 连着几次没进得了房间（没收到 welcome；被拒的连接也会先 open 再关）就停下，默认 20 */
  maxFailures?: number;
}

export interface EventSourceLike {
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
  removeEventListener(type: string, fn: (ev?: unknown) => void): void;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;
const BASE_MS = 500;
const MAX_MS = 15_000;
const HEARTBEAT_MS = 25_000;
/** 发了 ping 以后等多久没收到任何东西就判连接死了（0.11.1）。房间的自动回 pong 不经过游戏代码，正常几十毫秒就到 */
export const PONG_WAIT_MS = 8_000;
/** 建连最多等多久（0.11.1）：卡在 CONNECTING 的按一次失败算，重连 */
export const CONNECT_MS = 10_000;
/** 快捷短语太快时最多排几个（多的丢最早的） */
const EMOTE_QUEUE = 2;

/** 第 n 次重连（从 0 起）的等待：指数退避，上限 15 秒，乘一个 [0.5, 1) 的随机系数（抖动，免得一桌人同时重连）。 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_MS, BASE_MS * 2 ** attempt);
  return Math.round(cap * (0.5 + random() / 2));
}

export class RoomClient<A = unknown, V = unknown> {
  private ws: WebSocketLike | null = null;
  private status: ClientStatus = 'connecting';
  private attempt = 0;
  /** 连着几次没进得了房间（收到 welcome 清零） */
  private failures = 0;
  /** 这条连接收到过 welcome */
  private welcomed = false;
  private lastSeq = -1;
  private retryTimer: unknown = null;
  private beatTimer: unknown = null;
  /** 探活（0.11.1）：发了 ping 还没收到任何东西；到点还是 true 就判死 */
  private probing = false;
  private probeTimer: unknown = null;
  private connectTimer: unknown = null;
  /** 没收到 ack 的操作：重连后按原 moveId 重发 */
  private pending = new Map<string, UpMsg<A>>();
  private moveCounter = 0;
  /** 快捷短语的本地令牌桶（0.7.0）：节奏按房间 welcome 里给的，没收到前按默认 1 秒 1 个、攒 3 个 */
  private emoteRate = { ms: 1000, burst: 3 };
  private emoteTokens = 3;
  private emoteAt = 0;
  /** 太快时排着的（只留最后 EMOTE_QUEUE 个），到下一个令牌时发 */
  private emoteQueue: { id: number; to?: number }[] = [];
  private emoteTimer: unknown = null;
  private readonly opts: Required<Pick<RoomClientOptions<V>, 'random' | 'setTimer' | 'clearTimer'>> & RoomClientOptions<V>;
  private readonly onWake = () => this.wake(false);
  /** pageshow 带 persisted：页面是从往返缓存里拿回来的，旧连接不能信 */
  private readonly onPageShow = (ev?: unknown) => this.wake((ev as { persisted?: unknown } | undefined)?.persisted === true);
  private readonly onOnline = () => this.wake(false);
  private readonly doc: EventSourceLike | undefined;
  private readonly win: EventSourceLike | undefined;

  constructor(opts: RoomClientOptions<V>) {
    this.opts = {
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      ...opts,
    };
    this.doc = opts.events ?? (typeof document !== 'undefined' ? document : undefined);
    // pageshow、online 只在 window 上派发，挂在 document 上永远收不到（0.11.0 以前就是这样）
    this.win = opts.windowEvents ?? opts.events ?? (typeof window !== 'undefined' ? window : undefined);
    this.doc?.addEventListener('visibilitychange', this.onWake);
    this.win?.addEventListener('pageshow', this.onPageShow);
    this.win?.addEventListener('online', this.onOnline);
    this.connect();
  }

  /** 发一个操作意图；返回 moveId。没连上时先存着，连上后发。 */
  act(action: A): string {
    const moveId = `${Date.now().toString(36)}-${(this.moveCounter++).toString(36)}-${Math.floor(this.opts.random() * 1e9).toString(36)}`;
    const msg: UpMsg<A> = { t: 'act', moveId, baseSeq: this.lastSeq, action };
    this.pending.set(moveId, msg);
    this.trySend(msg);
    return moveId;
  }

  sit(seat: number): void {
    this.trySend({ t: 'sit', seat });
  }

  leave(): void {
    this.trySend({ t: 'leave' });
  }

  /** 房主开局；opts 是开局选项（0.3.0，游戏校验），不带就和以前一样 */
  start(opts?: unknown): void {
    this.trySend(opts === undefined ? { t: 'start' } : { t: 'start', opts });
  }

  /**
   * 快捷短语（0.6.0）：发游戏短语表里的编号；to（0.7.0）是冲着哪个座位（扔道具、点名嘲讽），不带就是对全桌。
   * 0.7.0 起本地按房间的节奏（welcome.emote）排队：太快的排到下一个令牌，只留最后 2 个，不提示用户。没连上就丢掉，不存着重发（过时的短语没意义）；
   * 房间转发回来的 { t: 'emote', seat, id } 经 onEmote 交给页面（不进 onMessage），发的人自己也会收到
   */
  emote(id: number, to?: number): void {
    this.emoteQueue.push(to === undefined ? { id } : { id, to });
    while (this.emoteQueue.length > EMOTE_QUEUE) this.emoteQueue.shift();
    this.flushEmotes();
  }

  /** 按令牌发排着的短语；没令牌就约到下一个令牌的时候。用户这边永远不提示"太快了" */
  private flushEmotes(): void {
    const { ms, burst } = this.emoteRate;
    const now = Date.now();
    if (ms > 0) {
      this.emoteTokens = Math.min(burst, this.emoteTokens + (now - this.emoteAt) / ms);
      this.emoteAt = now;
    }
    while (this.emoteQueue.length && (ms <= 0 || this.emoteTokens >= 1)) {
      const e = this.emoteQueue.shift()!;
      if (ms > 0) this.emoteTokens -= 1;
      this.trySend(e.to === undefined ? { t: 'emote', id: e.id } : { t: 'emote', id: e.id, to: e.to });
    }
    if (this.emoteQueue.length && this.emoteTimer === null) {
      this.emoteTimer = this.opts.setTimer(() => {
        this.emoteTimer = null;
        this.flushEmotes();
      }, Math.ceil((1 - this.emoteTokens) * ms) + 5);
    }
  }

  /** 主动离开：不再重连。 */
  close(): void {
    this.setStatus('closed');
    this.clearTimers();
    this.doc?.removeEventListener('visibilitychange', this.onWake);
    this.win?.removeEventListener('pageshow', this.onPageShow);
    this.win?.removeEventListener('online', this.onOnline);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  /** 停下（failed）以后用户点"重试"：从头再连。 */
  retry(): void {
    if (this.status !== 'failed') return;
    this.attempt = 0;
    this.failures = 0;
    this.setStatus('connecting');
    this.connect();
  }

  get state(): ClientStatus {
    return this.status;
  }

  private connect(): void {
    if (this.status === 'closed') return;
    const Impl = this.opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as { new (url: string): WebSocketLike });
    const url = new URL(this.opts.url);
    url.searchParams.set('cv', String(this.opts.clientVersion ?? 0));
    const ws = new Impl(url.toString());
    this.ws = ws;
    this.connectTimer = this.opts.setTimer(() => {
      this.connectTimer = null;
      if (this.ws === ws && ws.readyState !== OPEN) this.abandon(ws);
    }, CONNECT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.connectTimer !== null) this.opts.clearTimer(this.connectTimer);
      this.connectTimer = null;
      this.welcomed = false;
      this.setStatus('open');
      this.heartbeat();
      // 重发没确认的操作（房间按 moveId 去重）
      for (const msg of this.pending.values()) this.trySend(msg);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      // 收到任何东西都说明连接活着
      this.probing = false;
      if (typeof ev.data !== 'string' || ev.data === PONG) return;
      let msg: DownMsg<V> | EmotedMsg;
      try {
        msg = JSON.parse(ev.data) as DownMsg<V> | EmotedMsg;
      } catch {
        return;
      }
      if (msg.t === 'emote') {
        if (Number.isInteger(msg.seat) && Number.isInteger(msg.id)) this.opts.onEmote?.(msg.seat, msg.id, Number.isInteger(msg.to) ? msg.to : undefined, msg.bot === true);
        return;
      }
      // 本地已经按节奏排队了，房间偶尔还嫌快（比如刚重连、节奏刚调过）：静默丢掉，不打扰页面
      if (msg.t === 'error' && msg.code === 'emote_too_fast' && !msg.moveId) return;
      if (msg.t === 'welcome') {
        if (msg.emote && msg.emote.ms >= 0 && msg.emote.burst >= 1) this.emoteRate = { ms: msg.emote.ms, burst: msg.emote.burst };
        // 快照：整桌重画，从它的 seq 往后接；真的进了房间，退避和失败次数清零
        this.lastSeq = msg.seq;
        this.welcomed = true;
        this.attempt = 0;
        this.failures = 0;
      } else if (msg.t === 'state') {
        const mine = msg.ack !== undefined && this.pending.delete(msg.ack);
        // 旧的、重复的丢掉（ack 已经处理过了）。例外：别人看不出来的一步（0.7.1，quiet），房间只回给我、seq 不加，第一次收到要交给页面
        if (msg.seq < this.lastSeq || (msg.seq === this.lastSeq && !(mine && msg.quiet === true))) return;
        this.lastSeq = msg.seq;
      } else if (msg.t === 'error' && msg.moveId) {
        // 被拒的操作不再重发
        this.pending.delete(msg.moveId);
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.lost(ev.code, ev.reason);
    };
    ws.onerror = () => {
      // 之后一定会有 onclose，在那里处理
    };
  }

  /** 这条连接断了（或者被判死了）：最终关闭码停下，没进过房间的累计失败次数，其余按退避重连 */
  private lost(code: number, reason?: string): void {
    const entered = this.status === 'open' && this.welcomed;
    this.ws = null;
    this.clearTimers();
    if (this.status === 'closed') return;
    if (isFinalClose(code)) {
      this.setStatus('closed', code, reason);
      return;
    }
    // 升级被拒（4xx/5xx）时浏览器只给 1006，分不出原因；1013 是平台暂时不可用：一直进不了房间就停下，别无限重连
    if (!entered && ++this.failures >= (this.opts.maxFailures ?? 20)) {
      this.setStatus('failed', code);
      return;
    }
    this.scheduleRetry(code);
  }

  /** 不等 close 了：摘掉回调、关掉，按 1006（网络断了）走重连。死连接的 close 可能几分钟后才来，也可能不来 */
  private abandon(ws: WebSocketLike): void {
    if (this.ws !== ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // 已经坏了
    }
    this.lost(1006);
  }

  /** 发一个 ping，PONG_WAIT_MS 内什么都没收到就判死（已经在探就不重复发） */
  private probe(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || this.probeTimer !== null) return;
    this.probing = true;
    this.trySend(PING);
    this.probeTimer = this.opts.setTimer(() => {
      this.probeTimer = null;
      if (this.ws === ws && this.probing) this.abandon(ws);
    }, PONG_WAIT_MS);
  }

  /** 带上这次的关闭码：游戏据此区分"网络断了"（1006）和"平台有点忙"（1013）。 */
  private scheduleRetry(code: number): void {
    this.setStatus('reconnecting', code);
    const wait = backoffMs(this.attempt++, this.opts.random);
    this.retryTimer = this.opts.setTimer(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  /**
   * 切回前台、网络恢复：
   * - 连着：探一下活（静默死掉的会在 PONG_WAIT_MS 后判死、重连）；
   * - 在等退避：别等了，马上连；
   * - 有连接却不是 OPEN、也不在建连（CLOSING、CLOSED 却一直没等到 close，从往返缓存回来常见）：扔掉，马上连；
   * - fresh（pageshow 带 persisted）：不管什么状态，旧连接一律扔掉重连。
   */
  private wake(fresh: boolean): void {
    if (this.status === 'closed' || this.status === 'failed' || this.opts.isHidden?.() || (typeof document !== 'undefined' && document.hidden)) return;
    const ws = this.ws;
    if (ws && (fresh || (ws.readyState !== OPEN && ws.readyState !== 0))) {
      // 扔掉以后按断线走一遍（状态、失败次数照常算），再立刻连，不等退避
      this.abandon(ws);
      this.reconnectNow();
      return;
    }
    if (ws && ws.readyState === OPEN) {
      this.probe();
      return;
    }
    if (!ws) this.reconnectNow();
  }

  /** 正在等退避的话，取消等待、马上连 */
  private reconnectNow(): void {
    if (this.retryTimer === null) return;
    this.opts.clearTimer(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  private heartbeat(): void {
    this.beatTimer = this.opts.setTimer(() => {
      this.probe();
      this.heartbeat();
    }, HEARTBEAT_MS);
  }

  private clearTimers(): void {
    for (const t of [this.retryTimer, this.emoteTimer, this.beatTimer, this.probeTimer, this.connectTimer]) if (t !== null) this.opts.clearTimer(t);
    this.retryTimer = this.emoteTimer = this.beatTimer = this.probeTimer = this.connectTimer = null;
    this.probing = false;
  }

  private trySend(msg: UpMsg<A> | typeof PING): void {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    try {
      this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } catch {
      // 断开中，等 onclose
    }
  }

  private setStatus(s: ClientStatus, code?: number, reason?: string): void {
    this.status = s;
    this.opts.onStatus?.(s, code, reason);
  }
}

export { PROTOCOL_VERSION };

// ---------- 开房和给玩家看的默认文案（0.8.0） ----------

/** 开房的结果：成功回房间码；失败回 acceptCreate 的错误码，网络断了是 offline。has_room 带那个房间的码 */
export type CreateResult = { code: string } | { error: CreateError | 'offline'; code?: string };

/**
 * 开房：POST 到游戏 Worker 的开房路由（页面在 `/games/<id>/` 下，传相对路径 `'rooms'` 就对），请求体是 `{ opts }`，
 * 游戏 Worker 从里面取出开局选项交给 acceptCreate（worker.ts 的 `CreateOptions.options`）。带 `X-Arcade: 1`（5.2 的 CSRF 规矩）。
 * 回话不是 JSON（网关的错误页之类）当 unavailable；401 一律当 login
 */
export async function createRoom(url: string | URL, opts: unknown, fetchImpl: typeof fetch = fetch): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'x-arcade': '1', 'content-type': 'application/json' }, body: JSON.stringify({ opts }) });
  } catch {
    return { error: 'offline' };
  }
  const body = (await res.json().catch(() => ({}))) as { code?: unknown; error?: unknown };
  if (res.ok && typeof body.code === 'string') return { code: body.code };
  if (res.status === 401) return { error: 'login' };
  const error = typeof body.error === 'string' ? (body.error as CreateError) : 'unavailable';
  return { error, ...(typeof body.code === 'string' ? { code: body.code } : {}) };
}

/**
 * 开房失败、和房间断开时给玩家看的话（docs/platform-backend.md 15.10 的口径：大白话、说清能做什么）。只写各游戏都通用的说法，
 * 游戏按 key 换掉个别措辞（比如"这一手""这一局"、"桌上的筹码结回钱包"），没换的用默认：
 * - 开房失败：key 是 createRoom 的错误码（login、has_room、daily_limit、busy、bad_options、forbidden、unavailable、offline），不认识的按 unavailable；
 * - 断开：key 是 CLOSE 里的名字（roomClosed、noRoom、replaced……），另有 quota（4000 带 quota 原因：今天额度快满、房间收场）和 other（没列出的关闭码）。
 */
export const ROOM_TEXT = {
  login: '登录过期了，刷新一下页面',
  forbidden: '请从游戏大厅打开',
  has_room: '你同时开着的房间太多了，先离开几个再开',
  daily_limit: '今天开房的次数用完了，明天再来',
  busy: '今天联机的人太多了，明天再来，单机照常玩',
  bad_options: '开房的设置不对，刷新一下再开',
  unavailable: '暂时开不了房，稍后再试',
  offline: '网络断了，连上再试',
  roomClosed: '房间关了',
  quota: '今天联机的人太多了，房间先散了，单机照常玩',
  replaced: '你在别的页面打开了这个房间，这里先断开',
  noRoom: '没有这个房间：码不对，或者房间已经关了',
  tooOld: '页面有新版本了，刷新一下',
  full: '这个房间看的人太多了，进不去',
  tooManyJoins: '你在这个房间进出、操作太多次了，先歇一会儿',
  userQuota: '你在这个房间进出、操作太多次了，先歇一会儿',
  unauthorized: '登录过期了，刷新一下页面',
  other: '和房间断开了',
} as const;

export type RoomTextKey = keyof typeof ROOM_TEXT;
export type RoomTexts = Partial<Record<RoomTextKey, string>>;

const CREATE_KEYS = new Set<string>(['login', 'forbidden', 'has_room', 'daily_limit', 'busy', 'bad_options', 'unavailable', 'offline']);

/** 开房失败给玩家看的话：错误码 → 文案，游戏的 overrides 优先 */
export function createText(error: string, overrides: RoomTexts = {}): string {
  const key = (CREATE_KEYS.has(error) ? error : 'unavailable') as RoomTextKey;
  return overrides[key] ?? ROOM_TEXT[key];
}

/** 和房间断开时给玩家看的话：关闭码（和 4000 带的原因）→ 文案，游戏的 overrides 优先。1013（稍后再试）客户端会自己重连，也给一句 other */
export function closeText(code: number, reason?: string, overrides: RoomTexts = {}): string {
  let key: RoomTextKey = 'other';
  if (code === CLOSE.roomClosed) key = reason === CLOSE_REASON.quota ? 'quota' : 'roomClosed';
  else if (code === CLOSE.busy) key = 'busy';
  else if (code === CLOSE.forbidden) key = 'forbidden';
  else {
    const name = (Object.keys(CLOSE) as (keyof typeof CLOSE)[]).find((k) => CLOSE[k] === code);
    if (name && name in ROOM_TEXT) key = name as RoomTextKey;
  }
  return overrides[key] ?? ROOM_TEXT[key];
}

// ---------- 有没有平台（0.10.0，独立部署时页面降级用） ----------

/**
 * 页面所在站点有没有平台：
 * - `platform: true`：同域 `/api/me` 回 200 且是 `{ user }` 的 JSON。user 是平台的 `/api/me` 原样（没登录为 null）；
 * - `platform: false`：404、405、410，或者 2xx 却不是那个 JSON（独立部署时这个地址落到游戏自己的 Worker 或静态资源上）。
 *   游戏应当藏起登录、云存档、排行榜、钱包，"回大厅"改成回游戏首页；
 * - `platform: 'unknown'`：5xx、429、断网、超时（默认 2.5 秒）。平台可能只是抖了一下：先按有平台处理但别报错，过一会儿再试，
 *   或者干脆当成没有——游戏自己定。
 */
export type PlatformInfo = { platform: true; user: unknown } | { platform: false } | { platform: 'unknown' };

export interface DetectPlatformOptions {
  /** 默认 `/api/me`（站点根下，和游戏挂在哪无关） */
  url?: string | URL;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function detectPlatform(opts: DetectPlatformOptions = {}): Promise<PlatformInfo> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(opts.url ?? '/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 2_500) });
  } catch {
    return { platform: 'unknown' };
  }
  if (res.status === 404 || res.status === 405 || res.status === 410) return { platform: false };
  if (res.status < 200 || res.status >= 300) return { platform: 'unknown' };
  const type = res.headers.get('content-type') ?? '';
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) return { platform: false };
  try {
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body) && 'user' in body) return { platform: true, user: (body as { user: unknown }).user };
  } catch {
    // 读到一半断了算不知道；读完了却不是 JSON 在上面已经按 content-type 挡掉
    return { platform: 'unknown' };
  }
  return { platform: false };
}

/**
 * 独立模式下给开房、进房的地址带上昵称（`?name=`，0.10.0）：`createRoom(withNickname('rooms', name), opts)`、
 * `new RoomClient({ url: withNickname(wsUrl, name), … })`。服务端会严格清洗（guest.ts 的 cleanNickname），不合格就用默认的"游客1234"；
 * 有平台时服务端不看它，昵称以平台为准。name 空的原样返回
 */
export function withNickname(url: string, name?: string | null): string {
  if (!name) return url;
  const i = url.indexOf('#');
  const [head, hash] = i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
  return `${head}${head.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}${hash}`;
}
