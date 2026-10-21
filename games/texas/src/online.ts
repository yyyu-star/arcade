/**
 * 好友房的一局（DESIGN.md 6）：连房间（kit 的 RoomClient）、按顺序播房间发来的帧、发操作。画面由调用方（main.ts）接 OnlineUi。
 *
 * 房间说了算：页面只发意图（坐下、开打、出手、补码、离座），收到的状态整个替换本地的；断线重连拿全量快照整桌重画。
 * 一步里电脑接着出的几手是几帧，按顺序一帧一帧播（每帧带房间给的停顿）；落下太多（切回前台、重连）就不播了，直接摆最新的。
 */
import { closeText as kitCloseText, createRoom as kitCreateRoom, createText, RoomClient, withNickname, type ChatSendResult, type ClientStatus, type CreateResult, type RoomTexts } from 'arcade-kit/client';
import { EMOTE_ERRORS, type DownMsg, type RoomInfo, type You } from 'arcade-kit/protocol';
import type { LastAct, RoomAction, RoomOpts, RoomView } from './room/rules.ts';
import { site } from './site.ts';

/** 页面的协议版本（房间的 minClientVersion 高于它就让刷新） */
export const CLIENT_VERSION = 1;
/** 房间码是 6 位数字 */
export const isRoomCode = (code: string): boolean => /^\d{6}$/.test(code);
/** 积压超过这么多帧就不播了，直接摆最新的 */
const MAX_BACKLOG = 6;

export interface SavedRoom {
  code: string;
  userId: string | null;
  /** 是我开的（房间不下发房主是谁，只有开房的人自己知道） */
  host: boolean;
  at: number;
  /** 快速匹配排到的桌（0.20.0）：刷新后回来也按陌生人桌对待（聊天看"和陌生人打字聊天"、藏起房间码和叫人） */
  match?: true;
  /** 娱乐档排到的（0.21.0）：刷新后连上以前也不提钱包 */
  fun?: true;
}

export interface OnlineState {
  code: string;
  host: boolean;
  /** 开房时定下的档位和人数（房间发来的 room.opts，kit 0.4.0）；进房前不知道 */
  opts: RoomOpts | null;
  status: ClientStatus;
  room: RoomInfo | null;
  you: You | null;
  view: RoomView | null;
  /** 正在播动画、还有帧没播完：操作区先别亮 */
  busy: boolean;
}

export interface OnlineUi {
  /** 状态变了（进房、换座、连接断开……）：整个重画等人页、提示、操作区 */
  draw(s: OnlineState): void;
  /** 播一步牌局的动画；prev 为 null 是刚进来，直接摆 */
  play(prev: RoomView | null, next: RoomView, last: LastAct | null): Promise<void>;
  /** 一句提示（被拒的操作、买入被拒……） */
  toast(text: string): void;
  /**
   * 有人发了嘲讽、表情、道具（0.3.0，kit 的 emote）：seat 是谁发的，id 见 room/rules.ts 的编号表，to 是对谁；我自己发的也会回来。
   * bot：房间替电脑座位发的（0.6.1，kit 0.10 的 botEmote），即时到，不跟着帧的播放延迟走
   */
  emote(seat: number, id: number, to?: number, bot?: boolean): void;
  /** 有人说了一句（0.19.0，kit 0.18 的好友房聊天）：房间过滤、打码后的字，我自己说的也会回来 */
  chat(seat: number, text: string, masked: boolean): void;
  /** 房间拒了我的一句（本地已经先挡过一遍，一般是刚重连、节奏刚调过） */
  chatError(code: string): void;
  /** 房间停了（关了、被顶掉、连不上）：text 给人看，final 为 true 时不会再连 */
  ended(text: string, code: number): void;
  wait(ms: number): Promise<void>;
  /** 正在播的这一步别再等了、剩下的动画瞬间走完（切回前台、重连追上最新状态时）；on 为 false 恢复正常节奏 */
  skip?(on: boolean): void;
}

export class Online {
  private readonly client: RoomClient<RoomAction, RoomView>;
  private readonly ui: OnlineUi;
  private s: OnlineState;
  private readonly saved: SavedRoom;
  /** 已经摆在画面上的视图（播到哪了） */
  private shown: RoomView | null = null;
  private readonly queue: { view: RoomView | null; delay: number; fresh: boolean }[] = [];
  private playing = false;
  /** 已经收下的最新 seq：房间发来更小的（重连后拿到旧快照、乱序）一律不要，画面不倒退 */
  private seq = -1;
  private readonly onVisible = (): void => {
    // 切回前台：后台时落下的帧不再一手一手重播（像回放旧的操作），直接摆最新的
    if (document.hidden) return;
    if (this.playing || this.queue.length) this.collapse();
  };

  /** name：单独部署时游客的昵称，带在进房地址上（kit 的 ?name=） */
  /** 这条连接带不带聊天（kit 传了 onChat 才带 chat=1）：陌生人桌按设置"和陌生人打字聊天"，进房时定下，中途改了下次进房生效 */
  readonly chatOn: boolean;

  constructor(saved: SavedRoom, ui: OnlineUi, opts: { url?: string; name?: string | null; chat?: boolean } = {}) {
    this.ui = ui;
    this.saved = saved;
    document.addEventListener('visibilitychange', this.onVisible);
    this.chatOn = opts.chat ?? true;
    this.s = { code: saved.code, host: saved.host, opts: null, status: 'connecting', room: null, you: null, view: null, busy: false };
    this.client = new RoomClient<RoomAction, RoomView>({
      url: opts.url ?? withNickname(roomUrl(saved.code), opts.name),
      clientVersion: CLIENT_VERSION,
      onMessage: (m) => this.onMessage(m),
      onStatus: (st, code, reason) => this.onStatus(st, code, reason),
      onEmote: (seat, id, to, bot) => this.ui.emote(seat, id, to, bot),
      ...(this.chatOn ? { onChat: (seat: number, text: string, masked: boolean) => this.ui.chat(seat, text, masked), onChatError: (code: string) => this.ui.chatError(code) } : {}),
    });
  }

  get state(): OnlineState {
    return this.s;
  }

  /** 我在牌桌上的座位：坐着的、离座了还绑着的，都没有就按 0 号摆（旁观） */
  /** 是快速匹配的桌：房间说了算（RoomInfo.match），还没连上时看本机记的 */
  get match(): boolean {
    return this.s.room ? this.s.room.match === true : this.saved.match === true;
  }

  /** 是娱乐房间（0.21.0，快速匹配的娱乐档）：筹码不算数、不碰钱包。房间发来开局选项以前看本机记的 */
  get fun(): boolean {
    return this.s.opts ? this.s.opts.fun === true : this.saved.fun === true;
  }

  /** 是好友房锦标赛（0.24.0）：开房选项里的 tour */
  get tour(): boolean {
    return this.s.opts?.tour === true;
  }

  get mySeat(): number {
    return this.s.you?.seat ?? this.s.you?.bound ?? 0;
  }

  sit(seat: number): void {
    this.client.sit(seat);
  }
  /** 开打（只有房主能；档位和人数开房时已经定了） */
  start(): void {
    this.client.start();
  }
  act(a: RoomAction): void {
    this.client.act(a);
  }
  /** 离座：这一手弃牌，打完筹码结回钱包（电脑接着替这个座位打） */
  leaveSeat(): void {
    this.client.leave();
  }
  /** 发一句嘲讽、一个表情、扔一个道具（编号；to 是对哪个座位）。限频由 kit 在本地排队，被拒了不提示 */
  emote(id: number, to?: number): void {
    this.client.emote(id, to);
  }
  /** 说一句（kit 先在本地查一遍，不行直接回原因，互动面板的聊天页照着提示） */
  chat(text: string): ChatSendResult {
    return this.client.chat(text);
  }
  retry(): void {
    this.client.retry();
  }
  close(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.client.close();
  }

  private onMessage(m: DownMsg<RoomView>): void {
    if (m.t === 'error') {
      // 嘲讽被拒（发太快、没入座、房间打完了）：不弹提示，kit 的互动菜单自己按冷却画
      if (!(EMOTE_ERRORS as readonly string[]).includes(m.code)) this.ui.toast(errorText(m.code));
      return;
    }
    if (m.seq < this.seq) return;
    this.seq = m.seq;
    this.s = { ...this.s, room: m.room, you: m.you, opts: (m.room.opts as RoomOpts | undefined) ?? null };
    if (m.t === 'welcome') {
      // 快照：不管还有什么没播，直接摆到最新（不重播、正在播的这一步也瞬间走完）
      this.queue.length = 0;
      this.queue.push({ view: m.view, delay: 0, fresh: true });
      if (this.playing) this.ui.skip?.(true);
    } else {
      for (const f of m.frames) this.queue.push({ view: (f.view as RoomView | null) ?? null, delay: f.delay, fresh: false });
    }
    void this.pump();
  }

  /** 只留最后一帧、直接摆；正在播的那一步也别再等 */
  private collapse(): void {
    if (this.queue.length) this.queue.splice(0, this.queue.length, { ...this.queue.at(-1)!, fresh: true });
    this.ui.skip?.(true);
  }

  private async pump(): Promise<void> {
    if (this.playing) return this.redraw();
    this.playing = true;
    try {
      while (this.queue.length) {
        // 落下太多、或页面在后台（计时器被节流、动画不走，播出来也没人看）：只留最后一帧，直接摆
        if (this.queue.length > MAX_BACKLOG || (document.hidden && this.queue.length > 1)) this.collapse();
        else if (document.hidden) this.ui.skip?.(true);
        const f = this.queue.shift()!;
        this.s = { ...this.s, busy: true };
        this.redraw();
        if (f.view) {
          const prev = f.fresh ? null : this.shown;
          const last = prev && f.view.last && f.view.last.n !== prev.last?.n ? f.view.last : null;
          // 电脑连着出手时房间给的停顿：大半用来"想"，播完动画不够的再补齐。
          // 房间按每帧 delay 给下一个真人起算计时（kit runAuto），这里一帧播的总时长对上它，计时圈才和房间一致
          const t0 = Date.now();
          if (prev && f.delay > 0) await this.ui.wait(f.delay * 0.65);
          this.shown = f.view;
          this.s = { ...this.s, view: f.view };
          await this.ui.play(prev, f.view, last);
          const rest = f.delay - (Date.now() - t0);
          if (prev && rest > 0 && this.queue.length) await this.ui.wait(rest);
        } else {
          this.shown = null;
          this.s = { ...this.s, view: null };
        }
      }
    } finally {
      this.playing = false;
      this.ui.skip?.(false);
      this.s = { ...this.s, busy: false };
      this.redraw();
    }
  }

  private redraw(): void {
    this.ui.draw(this.s);
  }

  private onStatus(st: ClientStatus, code?: number, reason?: string): void {
    this.s = { ...this.s, status: st };
    this.redraw();
    if (st === 'closed' && code !== undefined && code !== 1000) this.ui.ended(closeText(code, reason, this.fun), code);
  }
}

/** 快速匹配排队的地址（0.20.0）：rooms/match/<档位>，同样按相对路径 */
export function matchUrl(tier: string): string {
  const u = new URL(`rooms/match/${tier}`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.toString();
}

/** 房间的 WebSocket 地址：页面在 /games/texas/ 下，相对路径就对 */
export function roomUrl(code: string): string {
  const u = new URL(`rooms/${code}/ws`, location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.toString();
}

export type { CreateResult } from 'arcade-kit/client';

/**
 * 开房（档位和人数这时就定下，进房的人都看得到）：成功回房间码；同时开着的房间到了上限时 error 是 has_room。
 * name 是单独部署时游客的昵称（kit 的 ?name=，服务端清洗）；有平台时不带
 */
export const createRoom = (opts: RoomOpts, name?: string | null): Promise<CreateResult> => kitCreateRoom(withNickname('rooms', name), opts);

/** kit 的默认说法里换掉德州自己的措辞：房间关了要说桌上的筹码结回钱包、收场是"这一手打完" */
const TEXTS: RoomTexts = {
  roomClosed: '房间关了，桌上的筹码已经结回钱包',
  quota: '今天联机的人太多了，这一手打完先散了，桌上的筹码结回钱包，单机照常玩',
};
/** 单独部署没有钱包（DESIGN.md 10.1）：不提结回 */
const STANDALONE_TEXTS: RoomTexts = {
  roomClosed: '房间关了',
  quota: '今天联机的人太多了，这一手打完先散了，单机照常玩',
};
const texts = (noWallet = false): RoomTexts => (site.standalone || noWallet ? STANDALONE_TEXTS : TEXTS);

export const createError = (e: string): string => createText(e, texts());
/** fun：娱乐房间（0.21.0）也不提结回钱包 */
export const closeText = (code: number, reason?: string, fun = false): string => kitCloseText(code, reason, texts(fun));

/** 房间拒了一个操作：大多是"牌局已经变了"这类，按最新状态重来就行 */
export function errorText(code: string): string {
  switch (code) {
    case 'seat_taken':
    case 'not_your_seat':
      return '这个座位有人了';
    case 'seat_reserved':
      return '这个座位的人暂时走开了，给他留着；换一个亮着的座位';
    case 'seat_closed':
      return '这一局用不到这个座位，坐前面的';
    case 'not_host':
      // 坐着的人都有"开打"按钮（0.3.5：房主换了设备、页面被顶掉后，本机不知道自己是房主，按钮不能藏）
      return '只有开房的人能开打，等他点一下';
    case 'not_in_tour':
      return '锦标赛里没有这个操作';
    case 'cannot_rebuy':
      return '已经是满的了，或者补码还在路上';
    case 'room_over':
    case 'closed':
      return '房间已经散了';
    case 'stale':
    case 'not_your_turn':
      return '';
    default:
      return '这一步没做成，看最新的牌局再来';
  }
}

