/**
 * 好友房的一场（DESIGN.md 第 6 节）：连房间（kit 的 RoomClient）、按顺序播房间发来的帧、发操作。画面由 main.ts 接 OnlineUi。
 *
 * 房间说了算：页面只发意图（坐下、开打、出牌、离座），收到的状态整个替换本地的；断线重连拿全量快照整桌重画。
 * 电脑接着出的几手是几帧，按顺序一帧一帧播（每帧带房间给的停顿）；落下太多（切回前台、重连）就不播了，直接摆最新的。
 * 房间码只在地址栏（?room=123456）：刷新原样回到房间，不另存（平台 0.10.1：登录跳转靠 next 带回来）。
 */
import { closeText, createText, RoomClient, type ChatSendResult, type ClientStatus } from 'arcade-kit/client';
import type { DownMsg, RoomInfo, You } from 'arcade-kit/protocol';
import { MATCH_PATH } from './game/match.ts';
import type { RoomAction, RoomOpts, RoomView } from './room/rules.ts';
import { ROOM_TEXTS } from './view/text.ts';

/** 页面的协议版本（房间的 minClientVersion 高于它就让刷新） */
export const CLIENT_VERSION = 1;
/** 积压超过这么多帧就不播了，直接摆最新的 */
const MAX_BACKLOG = 8;

export interface OnlineState {
  code: string;
  /** 开房时定下的玩法、档位、规则（房间发来的 room.opts）；进房前不知道 */
  opts: RoomOpts | null;
  status: ClientStatus;
  room: RoomInfo | null;
  you: You | null;
  view: RoomView | null;
}

export interface OnlineUi {
  /** 状态变了（进房、换座、开打、连接断开……）：重画等人页或牌桌 */
  draw(s: OnlineState, fresh: boolean): void;
  /** 一句提示（被拒的操作） */
  toast(text: string): void;
  /** 有人发了短语、表情包、道具（seat 是房间的座位号） */
  emote(seat: number, id: number, to?: number): void;
  /** 有人说了一句（kit 0.18.0；seat 是房间的座位号，和牌桌、互动用的座位号是同一套） */
  chat(seat: number, text: string, masked: boolean): void;
  /** 房间拒了我说的一句（被本地挡下的不走这里，chat() 直接返回原因） */
  chatError(code: string): void;
  /** 房间停了（关了、被顶掉、连不上），不会再连 */
  ended(text: string, code: number): void;
}

/** 电脑短语跟在帧后面多等这么久 */
const BOT_LAG_MS = 900;

export class Online {
  private readonly client: RoomClient<RoomAction, RoomView>;
  private readonly ui: OnlineUi;
  private s: OnlineState;
  private readonly queue: { view: RoomView | null; delay: number; fresh: boolean }[] = [];
  private playing = false;
  /** 电脑发的短语：房间在推完一批之后马上发，这时那一批的帧还没放完，等放完再显示（不然胡牌还没亮出来，电脑先得意上了） */
  private readonly later: { seat: number; id: number; to?: number }[] = [];
  /** 主动离开了：还在路上的帧、状态变化一律不再画（不然离开后回到选桌页，排队的帧又画出一张牌桌盖上去） */
  private closed = false;

  /** chat: false 时不给 onChat，连接不带 chat=1，房间就不给这个页面发聊天（匹配桌选了"不和陌生人"，0.21.0） */
  constructor(code: string, ui: OnlineUi, opts: { url?: string; chat?: boolean } = {}) {
    this.ui = ui;
    this.s = { code, opts: null, status: 'connecting', room: null, you: null, view: null };
    this.client = new RoomClient<RoomAction, RoomView>({
      url: opts.url ?? roomUrl(code),
      clientVersion: CLIENT_VERSION,
      onMessage: (m) => this.onMessage(m),
      onStatus: (st, c, reason) => this.onStatus(st, c, reason),
      // 传了 onChat 连接才带 chat=1，房间才给这个页面发聊天
      ...(opts.chat === false
        ? {}
        : { onChat: (seat: number, text: string, masked: boolean) => this.ui.chat(seat, text, masked), onChatError: (code: string) => this.ui.chatError(code) }),
      onEmote: (seat, id, to, bot) => {
        if (!bot || (!this.playing && !this.queue.length)) return this.ui.emote(seat, id, to);
        if (this.later.length < 6) this.later.push({ seat, id, ...(to !== undefined ? { to } : {}) });
      },
    });
  }

  get state(): OnlineState {
    return this.s;
  }

  sit(seat: number): void {
    this.client.sit(seat);
  }
  start(): void {
    this.client.start();
  }
  /** 玩法的动作（房间的 parse 认出是哪个玩法） */
  play(a: unknown): void {
    this.client.act({ t: 'play', a } as RoomAction);
  }
  /** 再来一场：我开好的新房间号告诉这一桌 */
  next(code: string): void {
    this.client.act({ t: 'next', code });
  }

  rebuy(): void {
    this.client.act({ t: 'rebuy' });
  }
  emote(id: number, to?: number): void {
    this.client.emote(id, to);
  }
  chat(text: string): ChatSendResult {
    return this.client.chat(text);
  }
  /** 离座：电脑接着替这个座位打；实盘手上的筹码在这一局打完时结回钱包 */
  leaveSeat(): void {
    this.client.leave();
  }
  retry(): void {
    this.client.retry();
  }
  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.later.length = 0;
    this.client.close();
  }

  private onMessage(m: DownMsg<RoomView>): void {
    if (this.closed) return;
    if (m.t === 'error') {
      const text = errorText(m.code);
      if (text) this.ui.toast(text);
      return;
    }
    this.s = { ...this.s, room: m.room, you: m.you, opts: (m.room.opts as RoomOpts | undefined) ?? null };
    if (m.t === 'welcome') {
      // 快照：不管还有什么没播，整桌重画
      this.queue.length = 0;
      this.queue.push({ view: m.view, delay: 0, fresh: true });
    } else {
      for (const f of m.frames) this.queue.push({ view: (f.view as RoomView | null) ?? null, delay: f.delay, fresh: false });
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length) {
        if (this.queue.length > MAX_BACKLOG) this.queue.splice(0, this.queue.length - 1, { ...this.queue.at(-1)!, fresh: true });
        const f = this.queue.shift()!;
        // 电脑连着出手时房间给的停顿：房间按每帧 delay 给下一个真人起算计时，这里一帧一帧等够，计时圈才和房间一致
        if (!f.fresh && f.delay > 0) await sleep(f.delay);
        if (this.closed) return;
        this.s = { ...this.s, view: f.view };
        this.ui.draw(this.s, f.fresh);
      }
    } finally {
      this.playing = false;
    }
    // 播的时候来了只改房间信息的消息（有人坐下、掉线）：最后再画一次
    if (!this.closed) this.ui.draw(this.s, false);
    // 帧放完了：攒着的电脑短语稍等一下再出（胡牌的牌面先亮一会儿）
    if (this.later.length && !this.closed) {
      const list = this.later.splice(0);
      await sleep(BOT_LAG_MS);
      if (!this.closed) for (const e of list) this.ui.emote(e.seat, e.id, e.to);
    }
  }

  private onStatus(st: ClientStatus, code?: number, reason?: string): void {
    if (this.closed) return;
    this.s = { ...this.s, status: st };
    this.ui.draw(this.s, false);
    if ((st === 'closed' || st === 'failed') && code !== undefined && code !== 1000) this.ui.ended(closeText(code, reason, ROOM_TEXTS), code);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** 房间的 WebSocket 地址：页面在 /games/mahjong/ 下，相对路径就对 */
export function roomUrl(code: string): string {
  const u = new URL(`rooms/${code}/ws`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.toString();
}

/** 快速匹配的排队地址（0.21.0）：和房间一样在 rooms/ 下面，相对页面 */
export function matchUrl(tier: string): string {
  const u = new URL(`${MATCH_PATH}/${tier}`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.toString();
}

/** 开房失败的话（开房本身用 kit 的 createRoom('rooms', opts)） */
export const createError = (e: string): string => createText(e, ROOM_TEXTS);

/** 房间拒了一个操作：大多是"牌局已经变了"这类，按最新状态重来就行（空串不提示） */
export function errorText(code: string): string {
  switch (code) {
    case 'seat_taken':
    case 'seat_reserved':
    case 'not_your_seat':
      return '这个座位有人了';
    case 'not_host':
      return '只有房主能开打';
    case 'cannot_rebuy':
      return '现在不用再带';
    case 'room_over':
    case 'closed':
      return '这一场已经打完了';
    case 'opening':
      return '等大家的筹码到账';
    case 'not_seated':
      return '你的筹码还没到账，这个座位先由电脑打';
    case 'stale':
    case 'stale_claim':
    case 'not_your_turn':
    case 'not_now':
    case 'emote_too_fast':
      return '';
    default:
      return '这一步没做成，看最新的牌局再来';
  }
}
