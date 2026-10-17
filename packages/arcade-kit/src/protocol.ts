/**
 * 房间和浏览器之间的消息（docs/platform-backend.md 4.3）。
 *
 * - 服务端说了算：客户端只发"我想做什么"（act 里的 action），合不合法、结果是什么都由房间算；
 * - 每条下行消息带 seq（房间这一局的步数），客户端按 seq 去重、丢掉旧的；
 * - 客户端的每个操作带 moveId，断线重连后重发没确认的操作，房间按 moveId 认出重复的；
 * - 协议带版本号 v，新旧代码会并存（部署后正在打的房间还跑旧代码，4.5），所以消息格式只加字段、不改含义；
 * - 心跳是纯文本 "ping" / "pong"，由运行时自动应答（setWebSocketAutoResponse），不唤醒房间、不计费。
 */

/** 协议版本：只在不兼容时加一。 */
export const PROTOCOL_VERSION = 1;

export const PING = 'ping';
export const PONG = 'pong';

/** 房间码：6 位数字（9.1）。 */
export const ROOM_CODE_RE = /^[0-9]{6}$/;

/**
 * 关闭码。1008（违规）和 4000 段客户端都不重连（4.5）；1006 等异常断开才重连。
 * 1009 是消息太大（4.6），属于程序错误，也不重连。
 */
export const CLOSE = {
  /** 发得太快（令牌桶）或其他违规 */
  policy: 1008,
  /** 入站消息超过大小上限 */
  tooBig: 1009,
  /** 平台暂时认不了人（不可用、超时）：稍后再试，客户端照常按退避重连 */
  tryLater: 1013,
  /** 房间关了（打完、超时、没人、超过寿命或消息总数） */
  roomClosed: 4000,
  /** 同一个账号在别处连上了，这条连接让位 */
  replaced: 4001,
  /** 没入座的连接满了（RoomLimits.extraConnections，默认 4 条；入座的人不占这个数） */
  full: 4003,
  /** 没有这个房间（码不对或已经关了） */
  noRoom: 4004,
  /** 客户端太旧，刷新页面 */
  tooOld: 4005,
  /** 这个人在这个房间的重连次数用完了（反复连上再断开） */
  tooManyJoins: 4029,
  /** 这个人在这个房间发的消息太多（超过房间一生入站额度里他那一份）：只断开他，房间照常 */
  userQuota: 4030,
  /** 今天联机的额度快用完了，不进新人（0.2.0）：已经在这个房间里坐过的人照常能回来 */
  busy: 4503,
  /** 没登录，或者平台暂时认不出人：先登录再来 */
  unauthorized: 4401,
  /** 不是本站页面发起的 */
  forbidden: 4403,
} as const;

/**
 * 4000（roomClosed）带的原因（0.2.0），客户端在 onStatus 的第三个参数里拿到。
 * quota：今天全站的写入额度快用完了，房间在这一段（比如这一副）打完时收场。其他原因（打完、超时、没人）不带这个。
 */
export const CLOSE_REASON = {
  quota: 'quota',
} as const;

/**
 * 开房（acceptCreate）失败时回的 JSON `{ error, code? }`（0.2.0）：
 * - login 401 没登录；forbidden 403 不是本站页面；
 * - has_room 409 这个人已经有一个开着的房间（code 是那个房间的码，页面给"回到房间"）；
 * - daily_limit 429 这个人今天开房次数用完了；
 * - busy 503 今天联机的人太多了（全站写入或开房数到了门槛），明天再来；
 * - unavailable 503 平台或计量暂时连不上、房间出错，稍后再试；
 * - bad_options 400 开房时带的选项不合格（0.4.0，游戏 Worker 传了 options 时才会有）。
 */
export type CreateError = 'login' | 'forbidden' | 'has_room' | 'daily_limit' | 'busy' | 'unavailable' | 'bad_options';

/** 不重连的关闭码。 */
export function isFinalClose(code: number): boolean {
  return code === CLOSE.policy || code === CLOSE.tooBig || (code >= 4000 && code < 5000);
}

// ---------- 上行（浏览器 → 房间） ----------

/** 坐到某个座位（等人时选空位，开打后可以接管电脑的座位）。 */
export interface SitMsg {
  t: 'sit';
  seat: number;
}
/** 离开座位（等人时空出来；开打后由电脑接手）。 */
export interface LeaveMsg {
  t: 'leave';
}
/** 开局：空座位由电脑补上。opts 是房主选的开局选项（0.3.0，游戏的 RoomGame.options 校验；不合格回 bad_options）。 */
export interface StartMsg {
  t: 'start';
  opts?: unknown;
}
/**
 * 一个操作意图，内容由游戏定。moveId 由客户端生成（同一个操作重发时不变）。
 * baseSeq 是做这个决定时看到的最新 seq：牌局在那之后变过（别人出了牌、超时代出了），房间回 stale 不做，
 * 免得断线前点的旧操作在重连后被套到新的一手上。
 */
export interface ActMsg<A = unknown> {
  t: 'act';
  moveId: string;
  baseSeq: number;
  action: A;
}
/**
 * 快捷短语（0.6.0）：只发游戏短语表里的编号（0 到 RoomGame.emotes - 1），不收自由文本，不用审内容。
 * 只有入座的人能发（电脑座位由房间子类经 GameRoom.botEmote 发，0.10.0），每个座位一个令牌桶；房间只转发、不存，被拒回 error（见 EMOTE_ERRORS），页面可以不提示。
 */
export interface EmoteMsg {
  t: 'emote';
  id: number;
  /** 冲着哪个座位（0.7.0，可选）：扔道具、点名嘲讽。得是有人的别的座位，不然回 bad_target；不带就和 0.6.0 一样 */
  to?: number;
}
export type UpMsg<A = unknown> = SitMsg | LeaveMsg | StartMsg | ActMsg<A> | EmoteMsg;

// ---------- 下行（房间 → 浏览器） ----------

export type SeatKind = 'empty' | 'human' | 'ai';

/** 座位的公开信息：谁坐着、是真人还是电脑、在不在线、是不是电脑在代打。 */
export interface SeatInfo {
  kind: SeatKind;
  /**
   * 真人的昵称；开打后绑了人的座位由电脑代打时（主人离座了）是原主人的昵称，牌桌可以显示"电脑代某某打"（0.1.1）。
   * 没绑人的电脑座位和空位为 null（电脑的名字由游戏按座位号自己定）
   */
  name: string | null;
  /** 真人掉线了（座位还留着） */
  away: boolean;
  /** 真人掉线超过宽限，电脑在代打；回来就交还 */
  auto: boolean;
  /**
   * 开打后这个座位已经绑了人（主人离座了也算）：kind 是 'ai' 时别人接管不了（seat_reserved），大厅不用给它挂"接管"按钮；
   * 只有原主人能回来（看 you.bound）。等人阶段都是 false。0.1.1 起房间总会带，旧房间代码不带
   */
  reserved?: boolean;
}

/**
 * 这条连接是谁：seat 是现在坐的座位（没入座为 null）；
 * bound 是这个人开打后绑定的座位（离座了也还是它，可以"回到我的座位"；还没开打、一局里没坐过为 null）。
 * bound 是 0.1.1 加的，房间总会带
 */
export interface You {
  seat: number | null;
  bound?: number | null;
}

export type RoomStatus = 'waiting' | 'playing' | 'over';

export interface RoomInfo {
  code: string;
  status: RoomStatus;
  seats: SeatInfo[];
  /**
   * 当前要出手的座位和截止时间（毫秒时间戳），没在等人出手时为 null。
   * seats（0.1.1）：游戏写了 RoomGame.actors 才有，是这一刻还能出手的全部座位（一组人时就是还没点的那几个），seat 是其中第一个；
   * 截止时间对整组只有一个
   */
  turn: { seat: number; deadline: number | null; seats?: number[] } | null;
  /**
   * 开房时定下的开局选项（0.4.0）：RoomGame.options 校验过的原样，进房的人开打前就知道这一局怎么打（档位、几个座位）。
   * 开房时没带选项的房间没有这个字段（开打时由 start 定，和以前一样）
   */
  opts?: unknown;
  /**
   * 正在"停一会儿再接着来"（0.5.0，RoomGame.pause）：until 是房间接着推进的时间戳（毫秒），页面拿它画倒计时。
   * 只有在停时才有，这时 turn 是 null；游戏的 resume 出错时房间会把它往后推
   */
  pause?: { until: number };
}

/** 一帧画面：按座位过滤过的游戏视图，delay 是相对上一帧的播放延迟（电脑连续出牌时用，4.4）。 */
export interface Frame<V = unknown> {
  view: V;
  delay: number;
}

/** 进房（含重连）时的全量快照。 */
export interface WelcomeMsg<V = unknown> {
  t: 'welcome';
  v: number;
  minClientVersion: number;
  seq: number;
  you: You;
  room: RoomInfo;
  view: V | null;
  /**
   * 房间发这条消息时的时间（毫秒，0.13.1）：RoomClient 拿它和 room.turn.deadline 算"还剩多久"，不用浏览器自己的钟（可能差几分钟）。
   * 用来发现房间的闹钟没设上、到点了却没人推进（见 RoomClient 的看门狗）。旧房间不带
   */
  now?: number;
  /**
   * 快捷短语的节奏（0.7.0，游戏有短语时才带）：每 ms 毫秒补 1 个令牌、最多攒 burst 个。RoomClient 按它在本地排队发，
   * 用户感觉不到限速；运维在 KIT_QUOTA 里改，不用发版
   */
  emote?: { ms: number; burst: number };
}

/** 每一步之后的状态。ack 只发给做这一步的那条连接：对应它的 moveId。 */
export interface StateMsg<V = unknown> {
  t: 'state';
  seq: number;
  you: You;
  room: RoomInfo;
  /** 至少一帧；最后一帧就是当前状态 */
  frames: Frame<V>[];
  ack?: string;
  /** 同 WelcomeMsg.now（0.13.1） */
  now?: number;
  /**
   * 别人看不出来的一步（0.7.1）：不轮流的操作没改任何别人能看到的东西（比如声明窗口里真人答"碰"），房间只回给出手的人、seq 不加（和上一条一样）。
   * 只和 ack 一起出现；RoomClient 0.7.1 起认它（seq 一样也交给页面），旧的 RoomClient 当重复丢掉
   */
  quiet?: true;
}

/**
 * 操作被拒（不合法、不该你、格式不对、牌局已经变了 stale、不是房主 not_host）。不改 seq。
 * code 是固定的错误码，游戏的 apply 返回的错误码也原样放在这里（见 RoomGame.apply）。
 */
export interface ErrorMsg {
  t: 'error';
  code: string;
  moveId?: string;
}

/**
 * 有人发了快捷短语（0.6.0）：seat 是房间的座位号（游戏按自己的视角换算），id 是短语编号。
 * 发给房间里所有收到过快照的连接（含发的人自己，页面收到再冒气泡）。不带 seq，不改牌局，断线时错过的不补发。
 * 不在 DownMsg 里：RoomClient 把它交给 onEmote，不进 onMessage，不用短语的游戏按 DownMsg 写的代码一行不用改
 */
export interface EmotedMsg {
  t: 'emote';
  seat: number;
  id: number;
  /** 发的时候指定了对象才有（0.7.0），房间的座位号 */
  to?: number;
  /** 电脑座位发的（0.10.0，GameRoom.botEmote）才有；页面可以不区分 */
  bot?: true;
}

/**
 * 快捷短语被拒时 error 的 code（0.6.0）：no_emotes 这个游戏没有短语表；bad_emote 编号不对；
 * not_seated 没入座（旁观的不能发）；room_over 房间打完了；emote_too_fast 这个座位离上一句不到 emoteMs；
 * bad_target（0.7.0）带的 to 不是有人的别的座位
 */
export const EMOTE_ERRORS = ['no_emotes', 'bad_emote', 'not_seated', 'room_over', 'emote_too_fast', 'bad_target'] as const;

export type DownMsg<V = unknown> = WelcomeMsg<V> | StateMsg<V> | ErrorMsg;
