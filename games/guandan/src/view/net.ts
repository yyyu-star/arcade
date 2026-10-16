/**
 * 联机会话：连房间（arcade-kit 的 RoomClient），把房间按真实座位发来的视图转成"我 = 0"，排成帧给牌桌一帧帧播放。
 *
 * - 房间说了算：出牌只是"发出去"（apply 返回 sent），结果随下一帧回来；这期间按钮锁着（pending），不重复发。
 * - 每帧带这一步的事件；入座、掉线这类广播会重发同一个状态（view.step 没变），这种帧只刷新画面、不再播放事件。
 * - 进房、重连收到 welcome（全量快照）：清掉没播放的帧，牌桌整桌重画（reset）。
 * - 座位上是谁（真人昵称、电脑、掉线、代打）写进 labels.ts 的 seatIdentity，牌桌的头像和名牌按它画。
 * - 房间码记在本机（guandan.room），刷新页面或回到标题页还能回到这个房间；房间散了就忘掉。
 */
import { RoomClient, type ClientStatus, type RoomClientOptions, type WebSocketLike } from 'arcade-kit/client';
import { CLOSE, CLOSE_REASON, EMOTE_ERRORS, type CreateError, type DownMsg, type RoomInfo } from 'arcade-kit/protocol';
import { PERSONAS, SEAT_PERSONA, decide, situationOf, tiltOf } from '../ai/index.ts';
import type { Action, GameEvent, NextPreview, PlayerView } from '../core/index.ts';
import { ERROR_TEXT, type NetAction, type NetView } from '../net/rules.ts';
import { rotateNetView, rotation, toReal } from '../net/rotate.ts';
import { CLIENT_VERSION, ROOM_PATH } from '../net/version.ts';
import { parseRoomOpts } from '../net/stake.ts';
import type { TierId } from '../stake/index.ts';
import { seatIdentity, setSeatIdentities, type SeatIdentity } from './labels.ts';
import type { BotStyle, TableSession } from './session.ts';
import { QUOTA_TEXT } from './quota-text.ts';
import { KEYS, rawStore } from './store.ts';

export { QUOTA_TEXT };

export interface NetFrame {
  nv: NetView;
  delay: number;
}

export type NetEvent = 'room' | 'frames' | 'reset' | 'error' | 'status' | 'emote';
export type NetListener = (kind: NetEvent, detail?: string) => void;

/** 本机记着的房间（刷新后回得去） */
export interface SavedRoom {
  code: string;
  host: boolean;
  /**
   * 记下的时间：房主是开房那一刻（开完马上进房），别人是第一次进这个房间那一刻。
   * arcade-kit 不下发房间的创建时间，别人拿不到更准的；房间最长活 8 小时，按进房时间算顶多多提示一会儿，点了会说房间散了。
   */
  at: number;
  /** 是谁的房间（平台 /api/me 的 user.id）；进房后才问得到，问到之前是 null。同一台设备换了账号就不能给新账号看（host 也不能被带走） */
  userId: string | null;
}
/** 房间最长活 8 小时（worker/room.ts 的 maxLifeMs），超过就不提"回到房间"了 */
const ROOM_LIFE_MS = 8 * 3_600_000;

export function savedRoom(): SavedRoom | null {
  const r = rawStore.read<SavedRoom>(KEYS.room);
  if (!r || typeof r.code !== 'string' || !/^\d{6}$/.test(r.code) || typeof r.at !== 'number') return null;
  return Date.now() - r.at < ROOM_LIFE_MS ? r : null;
}

export function forgetRoom(): void {
  rawStore.remove(KEYS.room);
}

/**
 * 记着的房间给不给现在这个账号："show" 给；"wait" 还不知道是谁（没登录、连不上平台），先不给、也不清；
 * "forget" 不是他的（或者旧记录、进房后没问到账号的记录），清掉——换了账号的人看不到上一个人的房间，也拿不走房主标记。
 */
export function roomOwnerCheck(saved: SavedRoom, userId: string | null): 'show' | 'wait' | 'forget' {
  if (userId === null) return 'wait';
  return saved.userId !== null && saved.userId === userId ? 'show' : 'forget';
}

/**
 * 现在登录的是谁（平台 /api/me 的 user.id）；没登录、连不上为 null。
 * 每次现问：云同步记的账号可能落后于别的标签页的切换。只在本机记着房间时才问，次数很少。
 */
export async function currentUserId(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher('/api/me', { credentials: 'same-origin' });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { user?: { id?: unknown } | null };
    return typeof body.user?.id === 'string' ? body.user.id : null;
  } catch {
    return null;
  }
}

/** 本机记着的、属于现在这个账号的房间（标题页"回到房间"、大厅"回到刚才的房间"、邀请链接带房主标记之前都要过这一关） */
/**
 * 进房后自动坐哪儿（0.6.0：点开链接就能打，不用再找按钮）：回自己绑着的座位；等人时坐第一个空位；
 * 开打了接管第一个没绑人的电脑座位。实盘房间坐下就要从钱包带入，不替人拿主意（回自己的座位除外）。null：不自动坐
 */
export function autoSeat(room: RoomInfo, you: { seat: number | null; bound?: number | null }, prefer: number | null = null): number | null {
  if (you.seat !== null) return null;
  if (you.bound !== undefined && you.bound !== null) return room.status === 'playing' ? you.bound : null;
  if (parseRoomOpts(room.opts)?.stake) return null;
  // 再来一场跟过来的（0.6.2）：先坐和上一场一样的相对位置（开房的人在 0 号），队友还是那个人
  if (prefer !== null && room.status === 'waiting' && room.seats[prefer]?.kind === 'empty') return prefer;
  const i =
    room.status === 'waiting' ? room.seats.findIndex((s) => s.kind === 'empty') : room.status === 'playing' ? room.seats.findIndex((s) => s.kind === 'ai' && !s.reserved) : -1;
  return i >= 0 ? i : null;
}

export async function myRoom(): Promise<SavedRoom | null> {
  const r = savedRoom();
  if (!r) return null;
  const verdict = roomOwnerCheck(r, await currentUserId());
  // 问的这一会儿记录可能变了（进了别的房间）：只清问之前看到的那一条
  if (verdict === 'forget' && savedRoom()?.code === r.code) forgetRoom();
  return verdict === 'show' ? r : null;
}

/** 这些关闭是"回不去了"（房间散了、码不对、没登录、满了、在别处进了、被拒、额度用完）：不再提"回到房间"，地址栏的码也去掉 */
export function isFinalForRoom(code: number | null): boolean {
  return (
    code === CLOSE.roomClosed ||
    code === CLOSE.noRoom ||
    code === CLOSE.unauthorized ||
    code === CLOSE.full ||
    code === CLOSE.replaced ||
    code === CLOSE.forbidden ||
    code === CLOSE.tooManyJoins ||
    code === CLOSE.userQuota ||
    code === CLOSE.busy
  );
}

/** 地址栏里的房间码跟着当前房间走（其他参数如 online=1 不动）：刷新页面就回到这个房间，离开了就去掉 */
export function roomInUrl(code: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
}

/** 关闭码 → 大白话（玩家看得懂、知道下一步做什么） */
export function closeText(code: number | null, reason: string | null = null): string {
  if (code === CLOSE.roomClosed && reason === CLOSE_REASON.quota) return QUOTA_TEXT.closed;
  switch (code) {
    case CLOSE.busy:
      return QUOTA_TEXT.joinBusy;
    case CLOSE.unauthorized:
      return '还没登录，先登录再来';
    case CLOSE.tryLater:
      return '平台有点忙，正在重新连接…';
    case CLOSE.noRoom:
      return '没有这个房间：看看房间码对不对，或者房间已经散了';
    case CLOSE.tooManyJoins:
      return '你在这个房间进进出出太多次了，换个房间吧';
    case CLOSE.userQuota:
      return '你在这个房间发的消息太多了，先断开；换个房间再玩';
    case CLOSE.full:
      return '房间里人满了，进不去';
    case CLOSE.replaced:
      return '你在别的地方进了这个房间，这里先断开';
    case CLOSE.roomClosed:
      return '房间已经散了（打完了，或者太久没人）';
    case CLOSE.tooOld:
      return '页面版本太旧了，刷新一下再进';
    case CLOSE.forbidden:
      return '请从游戏大厅打开掼蛋再进房间';
    case CLOSE.policy:
    case CLOSE.tooBig:
      return '连接出了点问题，刷新页面再试';
    default:
      return '连不上房间，检查一下网络';
  }
}

export function errorText(code: string): string {
  return ERROR_TEXT[code] ?? '这手牌出不了';
}

/** 房间接口的地址（同域） */
export function roomsUrl(): string {
  return `${ROOM_PATH}/rooms`;
}

function wsUrl(code: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${ROOM_PATH}/rooms/${code}/ws`;
}

/**
 * 开房：成功给房间码，失败给一句话。额度（arcade-kit 0.2.0）不够时 kit 回 JSON { error, code? }：
 * 同时开着的房间到上限（409 has_room）、今天开房次数用完（429）、今天联机的人太多（503 busy）。
 * 0.6.0 起"开房间"永远开新房：has_room 只说清楚，不再把人送回旧房间（不给玩家设没必要的限制）
 */
export async function createRoom(fetcher: typeof fetch = fetch, stake: TierId | null = null): Promise<{ code: string } | { error: string; login?: boolean; quota?: CreateError }> {
  let res: Response;
  try {
    // 实盘房间（0.5.0）：开房时就定档位（arcade-kit 0.4.0 的开房选项），之后不能改
    const init: RequestInit = stake
      ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stake }) }
      : { method: 'POST', credentials: 'same-origin' };
    res = await fetcher(roomsUrl(), init);
  } catch {
    return { error: '连不上服务器，检查一下网络' };
  }
  if (res.status === 201) {
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (body && typeof body.code === 'string' && /^\d{6}$/.test(body.code)) return { code: body.code };
    return { error: '开房没成功，刷新一下再试' };
  }
  if (res.status === 401) return { error: '还没登录，先登录再来', login: true };
  if (res.status === 403) return { error: '请从游戏大厅打开掼蛋再开房' };
  if (res.status === 404) return { error: '好友房暂时关了，单机照常玩' };
  const body = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  if (body?.error === 'has_room') return { error: QUOTA_TEXT.has_room, quota: 'has_room' };
  if (body?.error === 'daily_limit') return { error: QUOTA_TEXT.daily_limit, quota: 'daily_limit' };
  if (body?.error === 'busy') return { error: QUOTA_TEXT.busy, quota: 'busy' };
  if (body?.error === 'bad_options') return { error: '这个档位开不了，换一个试试' };
  // unavailable（平台、计量一时连不上）、开房码连撞：房间没开成，什么都没动
  return { error: '房间没开成（平台一时连不上），过一会儿再点"开个房间"' };
}

type SocketImpl = new (url: string) => WebSocketLike;

/** 测试用：不连真房间时换掉 RoomClient，或者给真 RoomClient 换 WebSocket、计时器 */
export interface NetSessionDeps {
  client?: RoomClient<NetAction, NetView>;
  url?: string;
  WebSocketImpl?: SocketImpl;
  /** 现在登录的是谁（默认问 /api/me） */
  whoAmI?: () => Promise<string | null>;
  setTimer?: RoomClientOptions<NetView>['setTimer'];
  clearTimer?: RoomClientOptions<NetView>['clearTimer'];
}

export class NetSession implements TableSession {
  readonly online = true;
  autoplay = false;
  lastEvents: GameEvent[] = [];
  readonly code: string;
  /** 这个房间是我开的（只有房主能开局；房间不下发谁是房主） */
  readonly host: boolean;
  /** 我的真实座位；没坐下为 null */
  mySeat: number | null = null;
  room: RoomInfo | null = null;
  status: ClientStatus = 'connecting';
  closeCode: number | null = null;
  /** 房间关闭时给的原因（arcade-kit 0.2.0：4000 带 quota 是今天额度满了收场） */
  closeReason: string | null = null;
  /** 最近一次连接断开时的关闭码（arcade-kit 0.1.1 起重连中也带：1006 断网、1013 平台忙）；进了房间（welcome）清空 */
  lastCloseCode: number | null = null;
  /** 开打后我绑定的真实座位（离座了也还是它，能"回到我的座位"）；没开打、没坐过为 null */
  bound: number | null = null;
  /** 画面正在显示的那一帧（我 = 0） */
  shown: NetView | null = null;
  /** 收到了、还没播放的帧 */
  readonly queue: NetFrame[] = [];
  /** 这次连接已经把房间记到账号名下了（只问一次 /api/me） */
  private claimed = false;
  private autoSat = false;
  /** 再来一场跟过来的：想坐的真实座位（和上一场一样的相对位置），空着就自动坐它 */
  prefer: number | null = null;
  /** 再来一场：我开的新房间的码（别人点的跟过去时不是房主） */
  againCode: string | null = null;
  private readonly whoAmI: () => Promise<string | null>;
  /** 发出去还没回音的操作的 moveId */
  pending: string | null = null;
  /** 最近一次被房间拒绝的原因（冒烟看） */
  lastError: string | null = null;
  private readonly listeners = new Set<NetListener>();
  private readonly client: RoomClient<NetAction, NetView>;

  constructor(code: string, host: boolean, deps: NetSessionDeps = {}) {
    this.code = code;
    this.host = host;
    this.whoAmI = deps.whoAmI ?? (() => currentUserId());
    const prev = savedRoom()?.code === code ? savedRoom() : null;
    rawStore.write(KEYS.room, { code, host, at: prev?.at ?? Date.now(), userId: prev?.userId ?? null } satisfies SavedRoom);
    this.client =
      deps.client ??
      new RoomClient<NetAction, NetView>({
        url: deps.url ?? wsUrl(code),
        clientVersion: CLIENT_VERSION,
        onMessage: (m) => this.handle(m),
        onStatus: (s, c, r) => this.onStatus(s, c ?? null, r ?? null),
        // 快捷短语：房间给的是真实座位，换成画面上的（我 = 0），detail 是"座位:编号"
        // detail："画面座位:编号" 或 "画面座位:编号:画面对象座位"
        // "说话人:编号:对象:电脑"（画面座位；没对象是空串，电脑发的末尾是 1）
        onEmote: (seat, id, to, bot) => {
          const r = rotation(this.mySeat ?? 0);
          this.emit('emote', `${r.seat(seat)}:${id}:${to === undefined ? '' : r.seat(to)}:${bot ? 1 : 0}`);
        },
        ...(deps.WebSocketImpl ? { WebSocketImpl: deps.WebSocketImpl } : {}),
        ...(deps.setTimer ? { setTimer: deps.setTimer } : {}),
        ...(deps.clearTimer ? { clearTimer: deps.clearTimer } : {}),
      });
  }

  /** 平台暂时不可用（1013）：连不上不是玩家的网络问题，别让他去查网络 */
  get platformBusy(): boolean {
    return (this.status === 'reconnecting' || this.status === 'failed') && this.lastCloseCode === CLOSE.tryLater;
  }

  /**
   * 连接没好时给玩家看的一句话（大厅、牌桌横条共用）；连着的时候是空串。
   * tap：横条上失败时点一下能重试，要说出来；大厅里另有"再试一次"按钮。
   */
  linkText(tap = false): string {
    switch (this.status) {
      case 'connecting':
      case 'reconnecting':
        return this.platformBusy ? '平台有点忙，正在重试…' : '网络断了，正在重连…';
      case 'failed':
        if (this.platformBusy) return tap ? '平台有点忙，过一会儿点这里重试' : '平台有点忙，过一会儿再试';
        return tap ? '连不上房间，点这里重试' : '连不上房间，检查一下网络';
      case 'closed':
        return closeText(this.closeCode, this.closeReason);
      default:
        return '';
    }
  }

  on(fn: NetListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: NetEvent, detail?: string): void {
    for (const fn of [...this.listeners]) fn(kind, detail);
  }

  private onStatus(s: ClientStatus, code: number | null, reason: string | null = null): void {
    this.status = s;
    if (code !== null) this.lastCloseCode = code;
    if (s === 'closed') {
      this.closeCode = code;
      this.closeReason = reason;
      if (isFinalForRoom(code)) forgetRoom();
    }
    if (s === 'open') this.closeCode = null;
    this.emit('status', s);
  }

  /** 进了房间（cookie 认得人）：把本机记的房间记到现在这个账号名下，换了账号的人看不到它 */
  private async claimRoom(): Promise<void> {
    const id = await this.whoAmI();
    const r = savedRoom();
    if (id === null || r?.code !== this.code) return;
    if (r.userId !== id) rawStore.write(KEYS.room, { ...r, userId: id } satisfies SavedRoom);
  }

  private rot(v: NetView): NetView {
    return rotateNetView(v, this.mySeat ?? 0);
  }

  /** 收到房间消息（RoomClient 已经按 seq 去过重）。测试里直接调。 */
  handle(msg: DownMsg<NetView>): void {
    if (msg.t === 'welcome') {
      if (!this.claimed) {
        this.claimed = true;
        void this.claimRoom();
      }
      this.lastCloseCode = null;
      this.mySeat = msg.you.seat;
      this.bound = msg.you.bound ?? null;
      this.room = msg.room;
      this.queue.length = 0;
      this.pending = null;
      this.lastEvents = [];
      this.shown = msg.view ? this.rot(msg.view) : null;
      this.updateIdentities();
      // 连上了（打开页面、断线重连）就说明人回来了：房间还当我走开着的话，替我点一下"我回来了"。
      // 人一直连着、只是走开的收不到 welcome，照旧要自己点
      if (this.mySeat !== null && this.afk) this.back();
      this.emit('reset');
      // 每次进房只替人坐一次（之后换座、重连都按他自己的）
      if (!this.autoSat) {
        this.autoSat = true;
        const seat = autoSeat(msg.room, msg.you, this.prefer);
        if (seat !== null) this.client.sit(seat);
      }
      return;
    }
    if (msg.t === 'error') {
      // 快捷短语被拒（发太快之类）：不打扰，按钮自己有冷却
      if ((EMOTE_ERRORS as readonly string[]).includes(msg.code)) return;
      // 自动点的"我回来了"晚到一步（已经自己出过牌了）：不用告诉人
      if (msg.code === 'not_away') return;
      if (msg.moveId && msg.moveId === this.pending) this.pending = null;
      this.lastError = msg.code;
      this.emit('error', msg.code);
      return;
    }
    if (msg.ack && msg.ack === this.pending) this.pending = null;
    const seatChanged = msg.you.seat !== this.mySeat;
    this.mySeat = msg.you.seat;
    this.bound = msg.you.bound ?? null;
    this.room = msg.room;
    const frames = msg.frames.filter((f) => f.view !== null).map((f) => ({ nv: this.rot(f.view), delay: f.delay }));
    if (seatChanged) {
      // 换了座位（刚坐下、接管）：视角整个变了，直接跳到最新一帧整桌重画
      this.queue.length = 0;
      const last = frames[frames.length - 1];
      if (last) this.shown = last.nv;
      this.updateIdentities();
      this.emit('reset');
      return;
    }
    this.queue.push(...frames);
    // 帧收下以后再更新（谁走开了看最新一帧）
    this.updateIdentities();
    this.emit(frames.length ? 'frames' : 'room');
  }

  /** 牌桌取下一帧来播 */
  take(): NetFrame | undefined {
    const f = this.queue.shift();
    if (f) this.shown = f.nv;
    return f;
  }

  /** 进牌桌时：还没显示过就拿第一帧，它的事件（发牌）当作进场动画 */
  begin(): void {
    if (this.shown) return;
    const f = this.take();
    this.lastEvents = f ? f.nv.events : [];
  }

  private updateIdentities(): void {
    const room = this.room;
    if (!room) return;
    const me = this.mySeat ?? 0;
    // 走开了的（0.6.3）：看收到的最新一帧（已经按我的座位转过，下标是画面座位）
    const afk = (this.queue[this.queue.length - 1]?.nv ?? this.shown)?.afk;
    const list: (SeatIdentity | null)[] = [];
    for (let shown = 0; shown < 4; shown++) {
      const s = room.seats[toReal(me, shown)];
      if (!s || s.kind === 'empty') list.push(null);
      // 绑了人、主人离座的座位：显示主人的名字和"电脑代打"（和掉线超过宽限一个样子）；没绑人的电脑座位 name 是 null
      else if (s.kind === 'ai') list.push(s.name !== null ? { human: true, name: s.name, away: true, auto: true } : { human: false, name: '', away: false, auto: false, persona: SEAT_PERSONA[toReal(me, shown)] });
      else list.push({ human: true, name: s.name ?? '玩家', away: s.away, auto: s.auto, ...(afk?.[shown] ? { afk: true } : {}) });
    }
    setSeatIdentities(list);
  }

  // ───────────── 房间里的事 ─────────────

  get playing(): boolean {
    return this.room?.status === 'playing' || this.room?.status === 'over';
  }

  /** 能进牌桌了：开打了、我坐下了、手上有局面（已经显示过的，或者开局时排着还没播的第一帧） */
  get canEnterTable(): boolean {
    return this.playing && this.mySeat !== null && (this.shown !== null || this.queue.length > 0);
  }

  sit(realSeat: number): void {
    this.client.sit(realSeat);
  }

  start(): void {
    this.client.start();
  }

  /** 发一句快捷短语、表情或道具（编号见 src/net/emotes.ts）；toView 是画面座位，转成真实座位再发 */
  emote(id: number, toView?: number): void {
    this.client.emote(id, toView === undefined || this.mySeat === null ? undefined : toReal(this.mySeat, toView));
  }

  /** 离开房间：开打后由电脑接手我的座位；忘掉房间码（本机和地址栏里的） */
  leave(): void {
    if (this.mySeat !== null) this.client.leave();
    forgetRoom();
    roomInUrl(null);
    this.close();
  }

  close(): void {
    this.client.close();
    setSeatIdentities([null, null, null, null]);
  }

  retry(): void {
    this.client.retry();
  }

  /** 这一手轮到谁、截止时间（画面座位） */
  turnInfo(): { seat: number; deadline: number | null } | null {
    const t = this.room?.turn;
    if (!t) return null;
    return { seat: rotation(this.mySeat ?? 0).seat(t.seat), deadline: t.deadline };
  }

  /** 结算页上我还能点"继续"（坐着、这副结束了、还没点过、上一手没在路上）。不看房间的"轮到谁"：结算时所有没准备的人都能点 */
  canReady(): boolean {
    const nv = this.shown;
    return nv?.view.phase === 'dealEnd' && !!nv.ready && !nv.ready[0] && this.mySeat !== null && this.status === 'open' && this.pending === null;
  }

  /** 结算页上还在等谁（画面座位，不含已经点了"继续"的）和自动开下一副的时间 */
  readyWait(): { waiting: number[]; deadline: number | null } | null {
    const ready = this.shown?.view.phase === 'dealEnd' ? this.shown.ready : null;
    if (!ready) return null;
    return { waiting: [0, 1, 2, 3].filter((s) => !ready[s]), deadline: this.room?.turn?.deadline ?? null };
  }

  // ───────────── TableSession ─────────────

  view(): PlayerView {
    if (!this.shown) throw new Error('还没收到牌局');
    return this.shown.view;
  }

  apply(a: Action): { events: GameEvent[]; error: string | null; sent?: boolean } {
    if (this.pending) return { events: [], error: '上一手还在路上，等一下', sent: false };
    let na: NetAction;
    switch (a.type) {
      case 'nextDeal':
        // 单机的"下一副"在好友房里是"我准备好了"，人齐了（或到点）由房间开下一副
        na = { type: 'ready' };
        break;
      case 'play':
        na = a.as ? { type: 'play', cards: a.cards, as: a.as } : { type: 'play', cards: a.cards };
        break;
      case 'pass':
        na = { type: 'pass' };
        break;
      default:
        na = { type: a.type, card: a.card };
    }
    this.pending = this.client.act(na);
    return { events: [], error: null, sent: true };
  }

  /** 我走开了、房间在快速替我出（0.6.3）：画面座位 0 是我 */
  get afk(): boolean {
    return !!(this.queue[this.queue.length - 1]?.nv ?? this.shown)?.afk?.[0];
  }

  /** 托管中点"我回来了"（不轮流的操作）；自己出一手也一样会恢复 */
  back(): void {
    this.client.act({ type: 'back' });
  }

  /** 再来一场（0.6.2）：新房间我已经开好了，叫这一桌的人一起过去（不轮流的操作） */
  again(code: string): void {
    this.client.act({ type: 'again', code });
  }

  /** 收到的最新一帧里的"再来一场"（还没播到的也算：牌局已经打完，不用等动画） */
  get againInfo(): NetView['again'] {
    return (this.queue[this.queue.length - 1]?.nv ?? this.shown)?.again;
  }

  /** 实盘房间带入被拒以后再带一份（不轮流的操作，房间不看轮没轮到我；不占"上一手还在路上"） */
  rebuy(): void {
    this.client.act({ type: 'buyin' });
  }

  isBot(seat: number): boolean {
    return seat === 0 && this.autoplay;
  }

  /** 房间里电脑的状态按密钥抽，页面不知道：只给性格和看得见的上头程度 */
  botStyle(seat: number): BotStyle | null {
    const persona = seatIdentity[seat]?.persona;
    if (!persona || !this.shown) return null;
    const v = this.shown.view;
    return { persona, form: 0, tilt: tiltOf(PERSONAS[persona], situationOf(v, seat)) };
  }

  botAction(seat: number): Action | null {
    if (seat !== 0 || !this.shown) return null;
    const v = this.shown.view;
    if (v.phase === 'dealEnd') return this.canReady() ? { type: 'nextDeal' } : null;
    return decide(v, { seed: this.hintSeed(), difficulty: 'hard' });
  }

  hintSeed(): string {
    const v = this.shown?.view;
    return `${this.code}|${v?.dealNo ?? 0}|${v?.step ?? 0}`;
  }

  preview(): NextPreview | null {
    return this.shown?.next ?? null;
  }

  canAct(): boolean {
    return this.status === 'open' && this.pending === null && this.queue.length === 0 && this.mySeat !== null && this.room?.turn?.seat === this.mySeat;
  }
}
