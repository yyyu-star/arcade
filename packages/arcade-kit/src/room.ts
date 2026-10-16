/**
 * 房间基类：游戏 Worker 里的 Durable Object 继承它，填上规则（RoomGame）就是一张联机桌（docs/platform-backend.md 第 4 节）。
 *
 * 守的规矩（4.1–4.6），每条都有测试：
 * - 只用 ctx.acceptWebSocket（休眠），只用一个闹钟，不用 setTimeout / setInterval；心跳 ping/pong 由运行时自动应答；
 * - 每一步最多写 2 行：房间状态一行（到期时间、计数都合在这一行里），外加"最早到期时间变早了"才重设闹钟（setAlarm 也算一行）。
 *   闹钟只往早了调：期限往后推（比如出完牌下一手的 30 秒）时不动它，到点醒来发现没到期再改，那一步只写这两行。
 *   例外只有开房：第一次建表另算 2 行（SQLite 的建表记录），一个房间只有这一次；
 * - 状态没变不写：没入座的人进出、本来就有人在线时又连进来一个，都不写库、不广播；
 * - 服务端说了算，下发前按座位过滤：每条连接只收到 game.view(state, 它的座位) 的结果，绝不发别人的隐藏信息；
 * - 续局：接受连接、发快照、记下座位在同一段没有 await 的代码里做完；只向已经收到快照的连接广播；广播在 await（设闹钟）之前；
 * - 每个入口（fetch、RPC、webSocketMessage、webSocketClose、alarm）都包一层：先计数、再查硬限制，最后才进游戏代码；游戏代码抛错只记日志，
 *   闹钟里不往外抛（闹钟失败会自动重试最多 6 次，每次都计费，4.4）。
 * - 内存里的东西都是缓存：被驱逐后从存储重建（attachment 里只放 userId、昵称）；闹钟时间以 getAlarm() 读到的为准。
 * - 额度（0.2.0，绑了 METER 才有，见 meter.ts）：开房先向计量占名额；自己数写了几行，攒够 meterBatch 行或房间结束时报给计量；
 *   打完、关房时还房主的名额。找计量都在 entry 之外（同步的那一步做完、广播完以后）await，不影响"一步之内没有 await"。
 *   计量说今天快满了（busy）就不进新人；说满了（stop）就在这一段打完（RoomGame.breakPoint）时收场。
 */
import { DurableObject } from 'cloudflare:workers';
import type { RoomEffect, RoomGame, RoomSetup } from './game.js';
import { type Identity, KIT_HOST, meterStub, parseIdentity } from './internal.js';
import type { MeterEnv, MeterLevel, RoomMeter } from './meter.js';
import { ENTROPY_WORDS } from './rng.js';
import {
  CLOSE,
  CLOSE_REASON,
  type DownMsg,
  type EmotedMsg,
  type Frame,
  PING,
  PONG,
  PROTOCOL_VERSION,
  ROOM_CODE_RE,
  type RoomInfo,
  type RoomStatus,
  type SeatInfo,
} from './protocol.js';

export type { RoomEffect, RoomGame, RoomSetup } from './game.js';
export type { Identity } from './internal.js';

export interface RoomLimits {
  /** 单条入站消息字节数，超了 1009 断开 */
  maxMessageBytes: number;
  /** 每个连接的令牌桶：每秒补几个、最多攒几个，超了 1008 断开 */
  ratePerSec: number;
  rateBurst: number;
  /** 房间一生的入站消息数，超了房间结束 */
  maxInbound: number;
  /**
   * 一个人最多用掉 maxInbound 的几成（0–1）。超了只断开他本人（4030）、以后也进不来，房间照常：
   * 一个人刷不完整个房间的额度。默认 0.4：正常一局一个人用不到一成（掼蛋 4 真人桌一局全桌约 1000 条）
   */
  maxInboundShare: number;
  /**
   * 每个人一生的"掉线后回来"次数（只数会写库的那种），用完以后他再连是 4029。断开总是跟在一次进房后面，
   * 所以也管住了断开的写入。按 userId 分开算：别人刷不光你的额度，离座再坐下也不清零；没入座的人进出不写库，不受这个管。
   * 这些重连同时算进 maxInbound，房间一生的写入总数有上限
   */
  maxJoins: number;
  /** 没入座的连接最多几条（来看的、还没选座位的），超了 4003。入座的人不占这个数，掉线回来总能进 */
  extraConnections: number;
  /** 房间最长寿命 */
  maxLifeMs: number;
  /** 没有真人连着多久关房间 */
  noHumanMs: number;
  /** 每一手的时间，超时代出 */
  turnMs: number;
  /** 掉线宽限：超过就由电脑托管，回来交还 */
  graceMs: number;
  /** 电脑连续出手时每一步的播放间隔 */
  aiDelayMs: number;
  /** 一次最多连算几步电脑，剩下的按闹钟接着算（防死循环） */
  maxAiBatch: number;
  /** 客户端版本低于这个就 4005 让它刷新 */
  minClientVersion: number;
  /**
   * 快捷短语的令牌桶（0.7.0 起）：每个座位每 emoteMs 补 1 个、最多攒 emoteBurst 个，没令牌回 emote_too_fast、不转发。
   * 这两个是代码里的默认值；游戏 wrangler.jsonc 的 vars.KIT_QUOTA 里写了 emoteMs / emoteBurst 就以那里为准（不用发版就能调）。
   * emoteMs 为 0 表示不限速
   */
  emoteMs: number;
  emoteBurst: number;
  /**
   * 写了多少行报一次计量（0.2.0）。计量每报一次自己写 1 行，200 就是多花 0.5%；
   * 太大的话计量知道得晚，满了以后房间还会多写最多这么多行才收场
   */
  meterBatch: number;
  /**
   * 关房时还有对外的事没办完（RoomGame.effects，0.3.0）：断开所有人以后留着存储接着办，最多等这么久，
   * 到了还办不完就记日志照样删（办事的一方要有自己的兜底，比如钱包到期退回买入）
   */
  closingMs: number;
}

/** 4.5、4.6 的默认值。 */
export const DEFAULT_LIMITS: RoomLimits = {
  maxMessageBytes: 4096,
  ratePerSec: 5,
  rateBurst: 10,
  maxInbound: 3000,
  maxInboundShare: 0.4,
  maxJoins: 300,
  extraConnections: 4,
  maxLifeMs: 3 * 3_600_000,
  noHumanMs: 10 * 60_000,
  turnMs: 30_000,
  graceMs: 60_000,
  aiDelayMs: 900,
  maxAiBatch: 64,
  minClientVersion: 0,
  emoteMs: 1000,
  emoteBurst: 3,
  meterBatch: 200,
  closingMs: 60 * 60_000,
};

/** 闹钟里出错时，过这么久再醒来重试（不用"马上"，免得每次都出错时连着计费）。 */
const ALARM_RETRY_MS = 60_000;
/** 每个座位记住最近几个做成的 moveId（0.11.1）：客户端断线时攒着没确认的操作，重连后原样补发 */
const RECENT_MOVES = 8;

/** 计量说的门槛在内存里记多久（不进新人时用；报数、还名额时顺便更新）。 */
const LEVEL_TTL_MS = 30_000;

/** 计量连不上以后，过多久再试着报数（不每一步都去碰一次） */
const METER_RETRY_MS = 60_000;

/** 对外的事办失败了，第一次过这么久重试，之后每次翻倍，最多 EFFECT_RETRY_MAX_MS。 */
const EFFECT_RETRY_MS = 15_000;
const EFFECT_RETRY_MAX_MS = 10 * 60_000;
/** 一步之后最多连着办几轮对外的事（办完一笔可能引出下一笔，比如买入到账后开下一手）。 */
const EFFECT_ROUNDS = 4;

/** owners 里"绑了、但不是任何人"：0.1.0 存下的已开打房间里的电脑座位（谁都不能接管）。userId 不会是空串 */
const NOBODY = '';

/** 游戏错误码的格式：固定的短码，不能夹带牌面之类的信息。 */
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,31}$/;

// ---------- 存储里的那一行 ----------

interface SeatState {
  kind: 'empty' | 'human' | 'ai';
  userId: string | null;
  name: string | null;
  /** 掉线时刻；在线为 null */
  awaySince: number | null;
  /** 掉线超过宽限，电脑在代打 */
  auto: boolean;
  /** 这个座位最后一次做成的操作的 moveId（重发去重） */
  lastMoveId: string | null;
  /**
   * 最近做成的几个 moveId，新的在后（0.11.1，最多 RECENT_MOVES 个；旧房间的状态里没有，读到时当空的）。
   * 只记最后一个不够：连发 A、B，A 的 ack 丢了，重连后补发 A，lastMoveId 已经是 B，不轮流的操作（free）就会被做第二遍
   */
  recentMoves?: string[];
}

interface Persist<S> {
  /** 结构版本：只加字段，不改含义 */
  sv: 1;
  code: string;
  /** 房主的 userId：只有房主能开局（9.1） */
  host: string;
  createdAt: number;
  status: RoomStatus;
  seq: number;
  /** 牌局最后一次变化（开局、出了一步）时的 seq */
  gameSeq: number;
  /**
   * 这一手（或这一组，RoomGame.actors）开始时的 gameSeq；客户端的 baseSeq 比它小就是 stale。
   * 一手一个人时每出一步都是新的一手，它和 gameSeq 一样（就是 0.1.0 的判法）；一组人时组里有人出手不变，后出的人不会因此被判 stale。
   * 0.1.1 加的字段，读 0.1.0 存下的房间时补成 gameSeq
   */
  turnSeq: number;
  seats: SeatState[];
  game: S | null;
  rulesVersion: number | null;
  /** 当前这一手（或这一组）从什么时候开始算 */
  turnSince: number | null;
  /** 电脑一批没算完，什么时候接着算 */
  aiAt: number | null;
  /** 从什么时候起没有入座的真人连着（只连着没入座的人也算"没人"，他们不能让房间一直活着） */
  noHumanSince: number | null;
  /** 一生收到的入站消息数，含会写库的重连（没写库的那些在内存里攒着，下次写库时一起记） */
  inbound: number;
  /** 上面这个数按 userId 分开记，只用来在关房日志里指出是谁发得最多 */
  inboundBy: Record<string, number>;
  /**
   * 开打以后每个座位绑定的 userId（null 是还没有真人坐过的电脑座位）。开局时记下入座的人；
   * 开打后坐过某个座位的人只能回这个座位，绑给别人的座位谁也接管不了（电脑一直替那个人打）；
   * 没坐过的人只能接管没绑人的电脑座位，接管后绑给他。这样一个人一局里只能看到一个座位的牌。
   * 0.1.1 加的字段；0.1.0 存下的房间没有它，读出来时按当时的座位补上（loadPersist）
   */
  owners: (string | null)[];
  /**
   * 每个人"掉线后回来"（会写库的那种进房）的次数，见 RoomLimits.maxJoins。按 userId 记、不挂在座位对象上：
   * 离座再坐下会换一个新座位，挂在座位上就会清零
   */
  joins: Record<string, number>;
  /** 写了还没报给计量的行数（0.2.0；内存里的为准，随这一行一起存，被驱逐后接着数） */
  unmetered?: number;
  /** 对外的事办失败了，什么时候再试（0.3.0；null 是不用等） */
  effectsAt?: number | null;
  /** 连着失败了几次（退避用） */
  effectTries?: number;
  /** 正在关：人都断开了，留着存储把对外的事办完再删（0.3.0） */
  ending?: { reason: string; at: number } | null;
  /** 开房时定下的开局选项（0.4.0，RoomGame.options 校验过的）；没有就是开打时由 start 定 */
  opts?: unknown;
}

interface Attachment {
  userId: string;
  name: string;
}

const TABLE = 'kit_room';

/** 开房的结果（kitCreate → worker.ts 的 acceptCreate）。 */
export type CreateOutcome =
  | { r: 'created' | 'exists' | 'bad' | 'bad_options' | 'error' | 'unavailable' | 'busy' | 'daily_limit' }
  | { r: 'has_room'; code: string };

/** 房间里一步的结果：要广播的帧、给做这步的连接回 ack。 */
interface StepOut<S> {
  /** 广播的帧：每个元素是一个状态，广播时按座位换成视图 */
  frames: { state: S | null; delay: number }[];
  ack?: { ws: WebSocket; moveId: string };
}

export abstract class GameRoom<S, A, V, Env = unknown, O = unknown, E extends RoomEffect = RoomEffect> extends DurableObject<Env> {
  protected abstract readonly game: RoomGame<S, A, V, O, E>;
  protected readonly limits: RoomLimits = DEFAULT_LIMITS;

  /**
   * 去外面办一笔事（0.3.0，游戏写了 effects 时房间子类实现）：比如经 DO 调用从 userId 的钱包扣买入。
   * userId 是 effect.seat 绑定的人（没绑人的电脑座位是 null）。返回值原样交给 RoomGame.settled；抛错算失败，按退避重试。
   * 同一笔可能被办两次（断线、被驱逐），办事的一方按 effect.id 去重。在 entry 之外 await，不打断"一步之内没有 await"
   */
  protected perform(_effect: E, _userId: string | null): Promise<unknown> {
    return Promise.reject(new Error('GameRoom.perform is not implemented'));
  }

  /**
   * 每一步广播完之后调一次（0.10.0，可选覆盖）：state 是这一步结束时的牌局状态（服务端全量，含隐藏信息）。
   * 给"电脑也会互动"用：房间子类看这一步的**公开**事件（谁出了什么、谁赢了一把），需要时调 botEmote 让电脑座位发一句短语。
   * 同步执行、不能 await、不能写存储；抛错只记日志，不影响这一步。公平约束（游戏侧守）：电脑发不发、发什么只看公开信息，
   * 不读任何真人的短语、不读隐藏的牌。房间要收场（closing）时不调
   */
  protected onStep(_state: S): void {}

  /**
   * 真人发的短语校验通过、广播完之后调一次（0.10.1，可选覆盖）：from 是发的座位，id 是编号，to 是对象座位（没指定是 undefined）。
   * **只许用来调 botEmote 让电脑回一句**（被点名的电脑回嘴、全桌起哄），别的什么都不做：
   * - 故意不给牌局状态：电脑的出牌决策（RoomGame.ai）绝不能读到真人的短语，游戏也不许把短语记进状态、字段或存储，留着以后喂给电脑；
   * - 同步执行、不能 await、不能写存储；抛错只记日志，不影响已经广播的那一句；
   * - 电脑自己的 botEmote 不会再触发它（不然几个电脑互相回个没完）；回应同样走那个电脑座位的令牌桶，刷不出限速。
   */
  protected onEmote(_from: number, _id: number, _to?: number): void {}

  /**
   * 让电脑座位发一句快捷短语（0.10.0）：广播的消息和真人发的一样（{ t: 'emote', seat, id, to? }），多带 bot: true，客户端可以不管它。
   * 只有电脑在出手的座位能发：kind 是 ai，或者真人掉线后由电脑托管（auto）。id、to 的校验和真人一样，走同一个座位的令牌桶
   * （emoteMs / emoteBurst），不写存储、不改 seq。发出去了回 true；座位是真人在打、空位、编号不对、目标不对、房间打完了、太快了，回 false 不广播
   */
  protected botEmote(seat: number, id: number, to?: number): boolean {
    const st = this.st;
    const n = this.game.emotes;
    if (!st || st.status === 'over' || !hasEmotes(n)) return false;
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.game.seats || !this.isAuto(seat)) return false;
    if (!Number.isInteger(id) || id < 0 || id >= n) return false;
    if (to !== undefined && (!Number.isInteger(to) || to < 0 || to >= this.game.seats || to === seat || st.seats[to]!.kind === 'empty')) return false;
    if (!this.takeEmote(seat)) return false;
    const msg: EmotedMsg = { t: 'emote', seat, id, ...(to !== undefined ? { to } : {}), bot: true };
    for (const o of this.sockets()) if (attachmentOf(o)) this.send(o, msg);
    return true;
  }

  /** 内存缓存，被驱逐后从存储重建 */
  private st: Persist<S> | null | undefined;
  /** 现在设着的闹钟；undefined 表示还不知道（刚建出来），进第一个入口前用 getAlarm() 读 */
  private alarmAt: number | null | undefined;
  /** 这一步要设的闹钟，entry 最后（广播之后）才真正 setAlarm */
  private alarmToSet: number | null = null;
  private pendingInbound = 0;
  private readonly pendingBy = new Map<string, number>();
  private readonly buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();
  /** 每个座位快捷短语的令牌桶（内存里；被驱逐就重置成满的，驱逐前至少空闲了一阵，本来也该满了） */
  private readonly emoteBuckets = new Map<number, { tokens: number; at: number }>();
  private emoteRateCache: EmoteRate | null = null;
  /** 这一步写了几行（sql 的 rowsWritten + setAlarm、关房各 1）；测试断言 ≤ 2 */
  private writes = 0;
  /** 每个入口结束时记下来，给测试看 */
  lastStepWrites = 0;
  maxStepWrites = 0;
  /** 这个实例一共写了几行（测试断言"整轮"的写入） */
  totalWrites = 0;
  lastStepFailed = false;
  /** 写了还没报给计量的行数 */
  private unmetered = 0;
  /** 这一步做完以后要还房主的名额（打完、关房），entry 最后去找计量 */
  private release: { host: string; code: string } | null = null;
  /** 计量最近一次说的门槛（内存；被驱逐就重新问） */
  private level: { value: MeterLevel; at: number } | null = null;
  /** 计量连不上时，什么时候再试着报数 */
  private meterRetryAt = 0;
  /** 计量说满了：在打的房间走到 breakPoint 就收场 */
  private winding = false;
  /** 这一步走到了收场点：commit 广播完就关房 */
  private closing = false;
  /** 正在办的对外的事（内存；被驱逐就重新办，办事的一方按 id 去重） */
  private readonly inflight = new Set<string>();
  private effectsBusy = false;
  /** 游戏写了 pause 没写 resume，已经记过日志（0.5.0；每个实例只记一次） */
  private warnedNoResume = false;
  /** 每个实例不一样（测试用来确认真的被驱逐、构造函数重跑过） */
  readonly instanceId = crypto.randomUUID();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 构造函数里不碰存储：探一个不存在的房间码不能留下任何东西
    // 心跳不唤醒房间、不计费（4.1）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // ---------- 入口 ----------

  /**
   * 开房（游戏 Worker 经 RPC 调，见 worker.ts 的 acceptCreate）。绑了计量时先占名额（按人、全站、当天写入），
   * 占不到就不建房间、这个房间对象什么都不写；占到了却没建成，退回去。
   */
  async kitCreate(code: string, host: Identity, rawOpts?: unknown): Promise<CreateOutcome> {
    // 开房就定选项（0.4.0）：不合格的不占名额、不建房间
    const fixed = rawOpts !== undefined && this.game.options ? this.checkOpts(rawOpts) : null;
    if (fixed === undefined) return { r: 'bad_options' };
    const meter = this.meter();
    let reserved = false;
    // 码不对、房间已经在（码撞了）的先挡掉，不去占名额；这两样 create 里还会再查一遍
    if (meter && validHost(code, host) && !this.load()) {
      try {
        const r = await meter.kitReserve(host.userId, code, Date.now() + this.limits.maxLifeMs);
        if (!r.ok) return r.error === 'has_room' ? { r: 'has_room', code: r.code } : { r: r.error };
        reserved = true;
      } catch (e) {
        console.error('meter unreachable, refusing new room', e instanceof Error ? e.message : e);
        return { r: 'unavailable' };
      }
    }
    const before = this.maxStepWrites;
    const out = await this.entry(() => this.create(code, host, fixed?.opts));
    // 开房那一步另算（含建表），不计入"每步最多 2 行"的统计；房间已经在的（exists）没写东西，照常计
    if (out === 'created') this.maxStepWrites = before;
    else if (reserved && meter) await meter.kitRelease(host.userId, code, 0, true).catch(() => console.error('meter release failed', code));
    return { r: out instanceof Response ? 'error' : out };
  }

  /** 进房：只认 kit 自己拼的内部地址（worker.ts 的 acceptJoin），身份在 x-kit-user 头里。 */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== KIT_HOST || url.pathname !== '/ws' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('not a kit request', { status: 400 });
    }
    const me = parseIdentity(request.headers.get('x-kit-user'));
    if (!me) return new Response('no identity', { status: 401 });
    const gate = await this.newcomerGate(me.userId);
    if (gate !== null) return this.refuse(gate);
    return this.entry(() => this.join(me, url.searchParams.get('cv')));
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.entry(() => this.onMessage(ws, message));
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.entry(() => {
      // 对方先关的：回一个关闭帧把握手做完，不然对方一直等
      try {
        ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
      } catch {
        // 已经关了
      }
      this.onGone(ws);
    });
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.entry(() => this.onGone(ws));
  }

  override async alarm(): Promise<void> {
    // 闹钟里出错不往外抛：抛出去会自动重试最多 6 次，每次都计费（4.4）
    try {
      // 运行时叫醒我们时这个闹钟已经用掉了
      this.alarmAt = null;
      await this.entry(() => this.onAlarm());
      // 出错时状态可能没走到"重设闹钟"那一步：房间还在、又没有闹钟，就过一会儿再醒来，不然房间永远没人关
      // setAlarm 本身失败时 alarmAt 是 undefined（不知道），以存储里读到的为准（0.11.1）
      if (this.lastStepFailed && this.load() && (this.alarmAt === undefined ? await this.ctx.storage.getAlarm() : this.alarmAt) === null) {
        this.alarmAt = Date.now() + ALARM_RETRY_MS;
        this.lastStepWrites++;
        this.totalWrites++;
        this.unmetered++;
        this.maxStepWrites = Math.max(this.maxStepWrites, this.lastStepWrites);
        await this.setAlarmSafely(this.alarmAt);
      }
    } catch (e) {
      console.error('room alarm failed', e instanceof Error ? e.message : e);
    }
  }

  /**
   * 包装层：先清这一步的写入计数，跑游戏代码（同步，中间没有 await），记下写了几行，最后才设闹钟（广播之后，4.5）。
   * 游戏代码抛错只记日志：fetch 回 500，消息和关闭事件吞掉；内存缓存作废（下次从存储读），已经算好的闹钟照样设
   * （状态可能已经写进去了；闹钟设早了没关系，醒来会重新算）。
   */
  private async entry<T>(run: () => T): Promise<T | Response> {
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    this.writes = 0;
    this.closing = false;
    let out: T | Response;
    this.lastStepFailed = false;
    try {
      out = run();
    } catch (e) {
      console.error('room handler failed', e instanceof Error ? e.message : e);
      this.lastStepFailed = true;
      this.st = undefined;
      this.pendingInbound = 0;
      this.pendingBy.clear();
      out = new Response('room error', { status: 500 });
    }
    const at = this.alarmToSet;
    this.alarmToSet = null;
    if (at !== null) this.writes++;
    this.lastStepWrites = this.writes;
    this.totalWrites += this.writes;
    this.unmetered += this.writes;
    this.maxStepWrites = Math.max(this.maxStepWrites, this.writes);
    if (at !== null && !(await this.setAlarmSafely(at))) this.lastStepFailed = true;
    await this.afterStep();
    return out;
  }

  /**
   * 设闹钟；失败了不往外抛（0.11.1）。planAlarm 已经把 alarmAt 改成了新时间，失败时它就是错的：
   * 留着的话以后 planAlarm 看"已经设了更早的"一直不重设，房间就没人收场。改回"不知道"，下一个入口按 getAlarm() 重新读、照常重排
   */
  private async setAlarmSafely(at: number): Promise<boolean> {
    try {
      await this.ctx.storage.setAlarm(at);
      return true;
    } catch (e) {
      console.error('room setAlarm failed', e instanceof Error ? e.message : e);
      this.alarmAt = undefined;
      return false;
    }
  }

  // ---------- 计量（0.2.0） ----------

  /**
   * 计量的绑定：默认是 env.METER。没绑（0.1.x 的游戏还没加绑定）就不限额、不计数——这只为平滑升级，正式环境一定要绑。
   * 游戏不用覆盖它；kit 的测试靠它换一个能"断线"的计量
   */
  protected meterNamespace(): DurableObjectNamespace | undefined {
    return (this.env as unknown as MeterEnv | undefined)?.METER;
  }

  private meter(): DurableObjectStub<RoomMeter> | null {
    const ns = this.meterNamespace();
    return ns ? (meterStub(ns) as DurableObjectStub<RoomMeter>) : null;
  }

  /**
   * 一步做完、广播完以后找计量：要还名额的还（带上最后一批写入），没有就看写入攒够一批没有，够了报一次。
   * 先从 unmetered 里扣掉再 await，报失败了加回去：中间别的事件进来不会把同一批报两次。
   * 被驱逐时存下的 unmetered 可能还没扣掉刚报过的那批，会再报一次，偏保守。
   */
  private async afterStep(): Promise<void> {
    const meter = this.meter();
    if (!meter) {
      this.release = null;
      this.unmetered = 0;
      return;
    }
    const now = Date.now();
    const release = this.release;
    // 计量刚连不上过：房间还在的等一会儿再试；房间已经关了的只有这一次机会
    const due = release !== null || this.unmetered >= this.limits.meterBatch;
    if (due && (now >= this.meterRetryAt || !this.st)) {
      const n = this.unmetered;
      this.release = null;
      this.unmetered = 0;
      try {
        const level = release ? await meter.kitRelease(release.host, release.code, n) : await meter.kitReport(n);
        this.level = { value: level, at: Date.now() };
        this.meterRetryAt = 0;
      } catch (e) {
        console.error('meter report failed', e instanceof Error ? e.message : e);
        // 房间还在的（打完了、还在给大家看结果），下次接着报、接着还；关掉了的就丢了，名额到点自动作废
        if (this.st) {
          this.unmetered += n;
          this.release ??= release;
        }
        this.meterRetryAt = now + METER_RETRY_MS;
      }
    }
    if (this.level?.value === 'stop' && !this.winding) {
      this.winding = true;
      await this.entry(() => this.windDown());
    }
    await this.runEffects();
  }

  /** 计量说满了：没在打（等人、打完了）的、正停在收场点的、游戏没有收场点的，马上关；在打的等 step 走到收场点。 */
  private windDown(): void {
    const st = this.load();
    if (!st || st.ending) return;
    if (st.status !== 'playing' || !this.game.breakPoint || this.game.breakPoint(st.game as S)) {
      console.error('daily writes reached stop, closing room', st.code);
      this.closeRoom(CLOSE_REASON.quota);
    }
  }

  /**
   * 今天额度快用完时不进新人（计量说 busy、stop）：房主、坐着的、开打后绑了座位的、已经连着的照常进。
   * 计量连不上时也不进新人，但用 1013 让客户端过一会儿重试。只读，不写库。返回关闭码，放行为 null
   */
  private async newcomerGate(userId: string): Promise<number | null> {
    const meter = this.meter();
    const st = this.load();
    if (!meter || !st || st.host === userId || this.seatOf(userId) !== null || this.boundOf(userId) !== null) return null;
    if (this.sockets().some((o) => attachmentOf(o)?.userId === userId)) return null;
    const now = Date.now();
    if (!this.level || now - this.level.at >= LEVEL_TTL_MS) {
      try {
        this.level = { value: await meter.kitLevel(), at: now };
      } catch (e) {
        console.error('meter unreachable, refusing newcomer', e instanceof Error ? e.message : e);
        return CLOSE.tryLater;
      }
    }
    return this.level.value === 'ok' ? null : CLOSE.busy;
  }

  /** 进房被拒：接受升级后马上用关闭码关掉（浏览器拿不到 HTTP 状态码）。 */
  private refuse(code: number): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].close(code, code === CLOSE.busy ? 'busy' : 'try later');
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---------- 开房、进房 ----------

  private create(code: string, host: Identity, opts: O | undefined): 'created' | 'exists' | 'bad' {
    if (!validHost(code, host)) return 'bad';
    if (this.load()) return 'exists';
    // 只在开房时建表（一个房间只这一次，SQLite 记建表也算写入，如实计数）
    this.writes += this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (k INTEGER PRIMARY KEY, v TEXT NOT NULL)`).rowsWritten;
    const now = Date.now();
    const seats: SeatState[] = Array.from({ length: this.game.seats }, () => emptySeat());
    // 房主先坐 0 号位，但还没连上：算掉线，连上就"回来"
    seats[0] = humanSeat(host.userId, host.name, now);
    this.st = {
      sv: 1, code, host: host.userId, createdAt: now, status: 'waiting', seq: 0, gameSeq: 0, turnSeq: 0, seats, game: null, rulesVersion: null,
      turnSince: null, aiAt: null, noHumanSince: now, inbound: 0, inboundBy: {}, joins: {}, owners: seats.map(() => null),
      ...(opts !== undefined ? { opts } : {}),
    };
    // 没人连进来也要能关掉：设闹钟（10 分钟没真人就关）
    this.planAlarm();
    this.save();
    return 'created';
  }

  /** 进房（含重连）：接受、记座位、发快照，中间没有 await（4.5 续局的写法）。 */
  private join(me: Identity, rawCv: string | null): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const done = () => new Response(null, { status: 101, webSocket: client });
    const st = this.load();
    if (!st) {
      server.close(CLOSE.noRoom, 'no room');
      return done();
    }
    if (st.ending) {
      server.close(CLOSE.roomClosed, st.ending.reason);
      return done();
    }
    const cv = Number(rawCv ?? '0');
    if (!Number.isFinite(cv) || cv < this.limits.minClientVersion) {
      server.close(CLOSE.tooOld, 'client too old');
      return done();
    }
    const seat = this.seatOf(me.userId);
    const others = this.sockets().filter((o) => o !== server && attachmentOf(o));
    const mine = others.filter((o) => attachmentOf(o)!.userId === me.userId);
    if (seat === null) {
      // 没入座的连接单独封顶；入座的人不占这个数，旁观的再多也挡不住座位的主人回来
      const watching = others.filter((o) => o !== server && this.seatOf(attachmentOf(o)!.userId) === null && !mine.includes(o));
      if (watching.length >= this.limits.extraConnections) {
        server.close(CLOSE.full, 'room full');
        return done();
      }
    }
    // 会写库的进房：入座的人掉线后回来，或者房间里原本没有入座的人连着
    const s = seat === null ? null : st.seats[seat]!;
    const changed = s !== null && (s.awaySince !== null || s.auto || s.name !== me.name || st.noHumanSince !== null);
    // 消息额度用完的人进不来（不然断开以后重连还能接着发）
    if (this.inboundOf(st, me.userId) >= this.userInboundCap()) {
      server.close(CLOSE.userQuota, 'too many messages');
      return done();
    }
    const used = st.joins[me.userId] ?? 0;
    if (s && changed && used >= this.limits.maxJoins) {
      server.close(CLOSE.tooManyJoins, 'too many joins');
      return done();
    }
    // 会写库的进房也算一条入站消息：房间一生的写入总数因此被 maxInbound 封住
    if (s && changed) {
      const r = this.countInbound(st, me.userId);
      if (r === 'user') {
        server.close(CLOSE.userQuota, 'too many messages');
        return done();
      }
      if (r === 'room') {
        this.closeRoom();
        return done();
      }
    }
    // 同一个账号只留一条连接：旧的让位
    for (const other of mine) {
      other.serializeAttachment(null);
      other.close(CLOSE.replaced, 'replaced');
    }
    server.serializeAttachment({ userId: me.userId, name: me.name } satisfies Attachment);

    if (s && changed) {
      // 托管被收回、而且正轮到他：这一手从现在重新算 30 秒。只是掉线没到托管就回来的，不重置（不然隔 29 秒重连一次就能一直拖着）
      // 一组人时不重置：组的期限中途不改，和"组里有人出手不重新计时"一致
      if (s.auto && st.status === 'playing' && st.turnSince !== null && seat !== null && this.onlyActor(seat)) st.turnSince = Date.now();
      // 回来了：交还座位（电脑托管也收回）
      s.awaySince = null;
      s.auto = false;
      s.name = me.name;
      st.joins[me.userId] = used + 1;
      st.noHumanSince = null;
    }
    // 状态没变（没入座的人进来、在线时又从别的设备连一次）不写库、不广播
    if (changed) this.commit({ frames: [{ state: st.game, delay: 0 }] }, server);
    this.send(server, this.welcome(seat, this.boundOf(me.userId)));
    return done();
  }

  // ---------- 消息 ----------

  private onMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const st = this.load();
    const me = attachmentOf(ws);
    if (!st || !me || st.ending) return void ws.close(CLOSE.roomClosed, 'room closed');
    const bytes = typeof message === 'string' ? new TextEncoder().encode(message).byteLength : message.byteLength;
    if (bytes > this.limits.maxMessageBytes) return void ws.close(CLOSE.tooBig, 'message too big');
    if (!this.takeToken(ws)) return void ws.close(CLOSE.policy, 'too fast');
    const counted = this.countInbound(st, me.userId);
    if (counted === 'user') return void ws.close(CLOSE.userQuota, 'too many messages');
    if (counted === 'room') return this.closeRoom();

    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = typeof message === 'string' ? JSON.parse(message) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      msg = parsed as Record<string, unknown>;
    } catch {
      return this.reject(ws, 'bad_message');
    }
    const seat = this.seatOf(me.userId);
    switch (msg.t) {
      case 'sit':
        return this.sit(ws, me, seat, msg.seat);
      case 'leave':
        return this.leave(seat);
      case 'start':
        return this.start(ws, me, seat, msg.opts);
      case 'act':
        return this.act(ws, seat, msg.moveId, msg.baseSeq, msg.action);
      case 'emote':
        return this.emote(ws, seat, msg.id, msg.to);
      default:
        return this.reject(ws, 'bad_message');
    }
  }

  /**
   * 快捷短语（0.6.0）：校验编号、按座位限频，然后只广播，不写存储、不改 seq。
   * 入站已经在 onMessage 里记过（占令牌桶和这个人的那一份额度），刷不出房间一生的上限以外。
   * to（0.7.0，可选）：冲着哪个座位发（扔道具、点名嘲讽）。得是有人（真人或电脑）的别的座位，不然回 bad_target；被拒的不算这个座位的一句
   */
  private emote(ws: WebSocket, seat: number | null, raw: unknown, to: unknown): void {
    const st = this.st!;
    const n = this.game.emotes;
    if (!hasEmotes(n)) return this.reject(ws, 'no_emotes');
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= n) return this.reject(ws, 'bad_emote');
    if (seat === null) return this.reject(ws, 'not_seated');
    if (st.status === 'over') return this.reject(ws, 'room_over');
    if (to !== undefined && (typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= this.game.seats || to === seat || st.seats[to]!.kind === 'empty')) {
      return this.reject(ws, 'bad_target');
    }
    if (!this.takeEmote(seat)) return this.reject(ws, 'emote_too_fast');
    const msg: EmotedMsg = { t: 'emote', seat, id: raw, ...(to !== undefined ? { to } : {}) };
    for (const o of this.sockets()) if (attachmentOf(o)) this.send(o, msg);
    try {
      this.onEmote(seat, raw, to as number | undefined);
    } catch (e) {
      console.error('onEmote threw', st.code, e instanceof Error ? e.message : e);
    }
  }

  /** 快捷短语的节奏：KIT_QUOTA 里写了就用那里的，没写用 RoomLimits（只算一次） */
  private emoteRate(): EmoteRate {
    this.emoteRateCache ??= emoteRateOf((this.env as unknown as MeterEnv | undefined)?.KIT_QUOTA, { ms: this.limits.emoteMs, burst: this.limits.emoteBurst });
    return this.emoteRateCache;
  }

  private takeEmote(seat: number): boolean {
    const { ms, burst } = this.emoteRate();
    if (ms <= 0) return true;
    const now = Date.now();
    const b = this.emoteBuckets.get(seat) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.at) / ms);
    b.at = now;
    this.emoteBuckets.set(seat, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private sit(ws: WebSocket, me: Attachment, current: number | null, raw: unknown): void {
    const st = this.st!;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= this.game.seats) return this.reject(ws, 'bad_seat');
    if (current === raw) return this.reject(ws, 'already_seated');
    const target = st.seats[raw]!;
    if (st.status === 'over') return this.reject(ws, 'room_over');
    if (st.status === 'waiting') {
      // 开房时定了选项的（0.4.0）：这一局用不到的座位现在就不让坐，免得房主开打时才被 seat_closed 拒
      if (st.opts !== undefined && raw >= this.countOf(st.opts as O)) return this.reject(ws, 'seat_closed');
      if (target.kind !== 'empty') return this.reject(ws, 'seat_taken');
      if (current !== null) st.seats[current] = emptySeat();
    } else {
      // 开打以后只能坐电脑在打的座位，而且得是还没坐下的人
      if (target.kind !== 'ai') return this.reject(ws, 'seat_taken');
      if (current !== null) return this.reject(ws, 'already_seated');
      // 座位绑人：坐过的只能回自己那个座位，别人的座位（主人离座了也算）谁也接管不了。
      // 不然 A 可以离座、接管对手的电脑座位看牌、再离座回到自己的座位
      const mine = st.owners.indexOf(me.userId);
      if (mine !== -1 && mine !== raw) return this.reject(ws, 'not_your_seat');
      if (mine === -1 && st.owners[raw] !== null) return this.reject(ws, 'seat_reserved');
      st.owners[raw] = me.userId;
    }
    st.seats[raw] = humanSeat(me.userId, me.name, null);
    // 入座的人连着：房间不再算"没人"
    st.noHumanSince = null;
    const frames = [{ state: st.game, delay: 0 }];
    if (st.status === 'playing') {
      const now = Date.now();
      // 接管的正好是这一手唯一要出的人：从现在算。一组人时不重置整组的期限
      if (this.onlyActor(raw)) st.turnSince = now;
      this.seatChanged(raw, 'human', now);
      frames[0] = { state: st.game, delay: 0 };
      // 桌上没真人时电脑停着（runAuto）；有人接管了别的座位，轮到的电脑要接着出，不然没人能让牌局往下走
      frames.push(...this.runAuto(now));
    }
    this.commit({ frames });
  }

  private leave(seat: number | null): void {
    const st = this.st!;
    if (seat === null) return;
    // 等人时空出来；开打后由电脑接手（不判负），轮到它就接着出。座位还绑着他，留下昵称给牌桌显示"电脑代某某打"
    st.seats[seat] = st.status === 'playing' ? { ...aiSeat(), name: st.seats[seat]!.name } : emptySeat();
    if (!this.seatedOnline()) st.noHumanSince ??= Date.now();
    if (st.status === 'playing') this.seatChanged(seat, 'ai', Date.now());
    const frames = [{ state: st.game, delay: 0 }];
    if (st.status === 'playing') frames.push(...this.runAuto(Date.now()));
    this.commit({ frames });
  }

  private start(ws: WebSocket, me: Attachment, seat: number | null, rawOpts: unknown): void {
    const st = this.st!;
    // 房主选择开打（9.1）
    if (me.userId !== st.host) return this.reject(ws, 'not_host');
    if (st.status !== 'waiting') return this.reject(ws, 'already_started');
    if (seat === null) return this.reject(ws, 'not_seated');
    // 开局选项（0.3.0）：游戏校验；这一局用几个座位，后面的座位一直空着。
    // 开房时定了的（0.4.0）以开房的为准，start 带的 opts 不看（大家进房时看到的就是开打时的）
    const fixed = st.opts !== undefined ? { opts: st.opts as O, count: this.countOf(st.opts as O) } : null;
    const checked = fixed ?? this.checkOpts(rawOpts);
    if (!checked) return this.reject(ws, 'bad_options');
    const { opts, count } = checked;
    if (st.seats.some((s, i) => i >= count && s.kind === 'human')) return this.reject(ws, 'seat_closed');
    // 空座位由电脑补满；入座的人从这一刻起绑在自己的座位上
    st.seats = st.seats.map((s, i) => (s.kind === 'empty' && i < count ? aiSeat() : s));
    st.owners = st.seats.map((s) => (s.kind === 'human' ? s.userId : null));
    st.rulesVersion = this.game.rulesVersion;
    st.game = this.begin(st.code, { opts, seats: st.seats.map((s) => s.kind) });
    st.gameSeq = st.seq + 1;
    st.turnSeq = st.gameSeq;
    st.status = 'playing';
    const now = Date.now();
    st.turnSince = now;
    if (!this.game.over(st.game)) this.stalled(this.actorsOf(st.game));
    this.commit({ frames: [{ state: st.game, delay: 0 }, ...this.runAuto(now)] });
  }

  /**
   * 开局拿随机：写了 begin 的给 256 位熵（只在这里用一次，房间不存；游戏要接着发牌就把它放进自己的状态，那只在服务端）。
   * 只有 start 的旧游戏照旧给 32 位种子，记一条警告：这种种子能被玩家用手牌反推出来。
   */
  private begin(code: string, setup: RoomSetup<O>): S {
    const rv = this.game.rulesVersion;
    if (this.game.begin) return this.game.begin(Array.from(crypto.getRandomValues(new Uint32Array(ENTROPY_WORDS))), rv, setup);
    console.warn('game has no begin(); 32-bit seed can be brute-forced from a hand', code);
    return this.game.start(crypto.getRandomValues(new Uint32Array(1))[0]!, rv);
  }

  private act(ws: WebSocket, seat: number | null, moveId: unknown, baseSeq: unknown, raw: unknown): void {
    const st = this.st!;
    if (typeof moveId !== 'string' || moveId.length < 1 || moveId.length > 64) return this.reject(ws, 'bad_message');
    if (typeof baseSeq !== 'number' || !Number.isInteger(baseSeq)) return this.reject(ws, 'bad_message', moveId);
    if (seat === null) return this.reject(ws, 'not_seated', moveId);
    const s = st.seats[seat]!;
    // 重发的同一个操作：不再做一遍，只回 ack 和当前状态
    if (s.lastMoveId === moveId || s.recentMoves?.includes(moveId)) {
      const bound = this.boundOf(attachmentOf(ws)!.userId);
      return this.send(ws, this.stateMsg(seat, bound, [{ state: st.game, delay: 0 }], moveId));
    }
    if (st.status !== 'playing') return this.reject(ws, 'not_playing', moveId);
    const action = this.game.parse(raw);
    if (action === null) return this.reject(ws, 'bad_action', moveId);
    // 不轮流的操作（0.3.0）：不看轮没轮到、不判 stale
    const free = this.game.free?.(action) === true;
    // 做决定时看到的牌局已经过时（断线前点的、在别人出牌之后才送到的）：不做，客户端看最新状态再出。
    // 按这一手（组）开始的时候算：同一组里别人先点了，后点的人照样算数
    if (!free && baseSeq < st.turnSeq) return this.reject(ws, 'stale', moveId);
    if (!free && !this.actorsOf(st.game as S).includes(seat)) return this.reject(ws, 'not_your_turn', moveId);
    const now = Date.now();
    // 不轮流的操作有可能别人什么都看不出来（比如声明窗口里真人答"碰"，0.7.1）：先记下别人眼里的样子，做完比一比
    const seen = free ? this.othersSee(seat) : null;
    const out = this.step(seat, action, now, free);
    if (out) return this.reject(ws, out, moveId);
    s.lastMoveId = moveId;
    s.recentMoves = [...(s.recentMoves ?? []), moveId].slice(-RECENT_MOVES);
    const auto = this.runAuto(now);
    if (seen !== null && auto.length === 0 && this.othersSee(seat) === seen) return this.commitQuiet(ws, seat, moveId);
    this.commit({ frames: [{ state: st.game, delay: 0 }, ...auto], ack: { ws, moveId } });
  }

  /**
   * 除了 seat 以外的人看到的一切（其他座位和没入座的人的视图、房间信息），拼成一个串用来比较（0.7.1）。
   * 不只比在线的连接：掉线的人回来拿到的快照也不能和没这一步时不一样
   */
  private othersSee(seat: number): string {
    const st = this.st!;
    const game = st.game as S;
    const views: unknown[] = [this.game.view(game, null)];
    for (let i = 0; i < st.seats.length; i++) if (i !== seat) views.push(this.game.view(game, i));
    return JSON.stringify([this.roomInfo(), views]);
  }

  /**
   * 别人看不出来的一步（0.7.1）：照常存（和闹钟，最多 2 行），只回给出手的连接，seq 不加。
   * 广播出去（哪怕内容一样）或者 seq 跳一下，别人就知道有人做了点什么——比如声明窗口里有真人能碰、杠、胡。
   * 回给他的消息 seq 和上一条一样、带着他的 ack 和 quiet：RoomClient 0.7.1 起认这种消息，旧页面会丢掉（只是自己的画面慢一步更新）
   */
  private commitQuiet(ws: WebSocket, seat: number, moveId: string): void {
    if (!this.closing) {
      this.planAlarm();
      this.save();
    }
    this.send(ws, this.stateMsg(seat, this.boundOf(attachmentOf(ws)!.userId), [{ state: this.st!.game, delay: 0 }], moveId, true));
    if (this.closing) {
      console.error('daily writes reached stop, room closed at a break point', this.st!.code);
      this.closeRoom(CLOSE_REASON.quota);
    }
  }

  /** 连接断了：留着座位，记下掉线时间；没有入座的人连着就开始算"没人"的时间。没入座的人走了不写。 */
  private onGone(ws: WebSocket): void {
    const st = this.load();
    const me = attachmentOf(ws);
    ws.serializeAttachment(null);
    if (!st || !me) return;
    const stillHere = this.sockets().some((o) => o !== ws && attachmentOf(o)?.userId === me.userId);
    if (stillHere) return;
    const now = Date.now();
    let changed = false;
    const seat = this.seatOf(me.userId);
    if (seat !== null && st.seats[seat]!.awaySince === null) {
      st.seats[seat]!.awaySince = now;
      changed = true;
    }
    if (seat !== null && st.noHumanSince === null && !this.seatedOnline(ws)) {
      st.noHumanSince = now;
      changed = true;
    }
    if (changed) this.commit({ frames: [{ state: st.game, delay: 0 }] }, ws);
  }

  // ---------- 闹钟 ----------

  private onAlarm(): void {
    const st = this.load();
    if (!st) return;
    const now = Date.now();
    if (st.ending) return this.endingAlarm(st, now);
    if (now >= st.createdAt + this.limits.maxLifeMs) return this.closeRoom();
    if (st.noHumanSince !== null && now >= st.noHumanSince + this.limits.noHumanMs) return this.closeRoom();

    const frames: { state: S | null; delay: number }[] = [];
    let changed = false;
    // 掉线超过宽限：电脑托管（只在开打以后有意义，等人时不管）
    for (const s of st.status === 'playing' ? st.seats : []) {
      if (s.kind === 'human' && s.awaySince !== null && !s.auto && now >= s.awaySince + this.limits.graceMs) {
        s.auto = true;
        changed = true;
      }
    }
    if (st.status === 'playing') {
      const due = this.deadline();
      // 停够了（0.5.0）：让游戏接着来一步，电脑在下面照常接着出
      if (due !== null && now >= due && this.pauseOf(st.game as S) !== null) {
        if (this.resumeStep(now)) frames.push({ state: st.game, delay: 0 });
        changed = true;
      }
      // 真人这一手超时：代出（掉线还没到宽限的也是这样）。一组人时对组里还没出的真人逐个代出，
      // 换成新的一手就停（新的一手从现在重新计时）
      else if (due !== null && now >= due) {
        const turnSeq = st.turnSeq;
        let stuck = false;
        for (const seat of this.actorsOf(st.game as S).filter((x) => !this.isAuto(x))) {
          if (this.closing || st.status !== 'playing' || st.turnSeq !== turnSeq || !this.actorsOf(st.game as S).includes(seat)) break;
          if (this.timeoutStep(seat, now)) frames.push({ state: st.game, delay: 0 });
          else stuck = true;
        }
        // 有人代出不了（游戏的 timeout 和 ai 都给了不合法的操作）：这一组的期限推到 ALARM_RETRY_MS 以后再试。
        // 不推的话期限一直是过去的时间，闹钟会在当前时刻反复响、每次写一行
        if (stuck && st.status === 'playing' && st.turnSeq === turnSeq) {
          st.turnSince = now + ALARM_RETRY_MS - this.turnMsOf(st.game as S);
          changed = true;
        }
      }
      if (st.aiAt !== null && now >= st.aiAt) st.aiAt = null;
      frames.push(...this.runAuto(now));
    }
    // 对外的事到了重试的时间：清掉等待，这一步之后（afterStep）接着办
    if (st.effectsAt != null && now >= st.effectsAt) {
      st.effectsAt = null;
      changed = true;
    }
    changed ||= frames.length > 0;
    if (changed) return this.commit({ frames: frames.length ? frames : [{ state: st.game, delay: 0 }] });
    // 什么都没到期：只把闹钟改到新的最早时间，不写状态、不广播
    this.planAlarm();
  }

  /** 只用一个闹钟：所有到期时间取最早的。 */
  private nextDeadline(): number | null {
    const st = this.st;
    if (!st) return null;
    // 正在关的房间只等两件事：重试对外的事、到点放弃
    if (st.ending) return Math.min(st.ending.at + this.limits.closingMs, st.effectsAt ?? Infinity);
    const ds = [st.createdAt + this.limits.maxLifeMs];
    if (st.effectsAt != null) ds.push(st.effectsAt);
    if (st.noHumanSince !== null) ds.push(st.noHumanSince + this.limits.noHumanMs);
    if (st.status === 'playing') {
      for (const s of st.seats) if (s.kind === 'human' && s.awaySince !== null && !s.auto) ds.push(s.awaySince + this.limits.graceMs);
      const due = this.deadline();
      if (due !== null) ds.push(due);
      if (st.aiAt !== null) ds.push(st.aiAt);
    }
    return Math.min(...ds);
  }

  /**
   * 只在比现在设的更早（或没设）时重设，因为每次 setAlarm 也算一行写入。
   * alarmAt 马上改（同步），真正 setAlarm 留到 entry 最后：这中间别的事件看到的已经是新时间，不会把它往后改。
   */
  private planAlarm(): void {
    const next = this.nextDeadline();
    if (next === null || (this.alarmAt != null && this.alarmAt <= next)) return;
    this.alarmAt = next;
    this.alarmToSet = next;
  }

  // ---------- 规则和电脑 ----------

  /**
   * 做一步；不合法返回错误码。换成了新的一手（组）时，从 at 起计时。
   * free（不轮流的操作）：该谁出手没变就不算新的一手，不改期限和 turnSeq。
   */
  private step(seat: number, action: A, at: number, free = false): string | null {
    const st = this.st!;
    const before = this.turnOf(st.game as S);
    let next: S | { error: string };
    try {
      next = this.game.apply(st.game as S, seat, action);
    } catch (e) {
      console.error('game.apply threw', e instanceof Error ? e.message : e);
      return 'rule_error';
    }
    if (isError(next)) return ERROR_CODE_RE.test(next.error) ? next.error : 'illegal_move';
    this.land(next, before, free ? null : seat, at);
    return null;
  }

  /**
   * 牌局换成 next 以后的收尾：打完了、卡住了、换了新的一手（组）。mover 是出手的座位；
   * null 是不轮流的变化（free 操作、座位换人、对外的事办完）：该谁出手原样没变就还是同一手。
   */
  private land(next: S, before: { seats: number[]; group: string | null }, mover: number | null, at: number): void {
    const st = this.st!;
    const wasPaused = st.game !== null && this.pauseOf(st.game) !== null;
    st.game = next;
    st.gameSeq = st.seq + 1;
    const over = this.game.over(next);
    // 计量说满了：走到这一段的结尾（或者整场打完）就收场，电脑不再接着出
    if (this.winding && (over || this.game.breakPoint?.(next))) this.closing = true;
    if (over) {
      st.status = 'over';
      st.turnSince = null;
      this.release = { host: st.host, code: st.code };
      return;
    }
    const after = this.turnOf(next);
    if (this.stalled(after.seats)) return;
    const same = mover === null ? sameTurn(before, after) : sameGroup(before, mover, after);
    // 刚进入停顿（0.5.0）一定从现在算：从等外面的事变过来（前后都没人出手）、或者游戏给了同一个组标识的，上面会当成同一手
    const enteredPause = !wasPaused && after.seats.length === 0 && this.pauseOf(next) !== null;
    if (!same || enteredPause) {
      st.turnSeq = st.gameSeq;
      st.turnSince = at;
    }
  }

  /** 开打以后座位换了人（0.3.0）：告诉游戏（RoomGame.seated），和这一步一起写。游戏出错只记日志、牌局不动。 */
  private seatChanged(seat: number, kind: 'human' | 'ai', at: number): void {
    const st = this.st!;
    if (!this.game.seated || st.game === null) return;
    const before = this.turnOf(st.game);
    let next: S;
    try {
      next = this.game.seated(st.game, seat, kind);
    } catch (e) {
      console.error('game.seated threw', e instanceof Error ? e.message : e);
      return;
    }
    if (next !== st.game) this.land(next, before, null, at);
  }

  /**
   * 牌局没打完、却没有任何座位能出手：游戏出错了，房间不然会一直卡着（没人能出、也不会超时）。
   * 记日志，按打完处理（不再计时、不再驱动电脑），房间之后照常按没人、寿命到期关掉。
   * 游戏说在等外面的事（RoomGame.waiting，0.3.2）的不算：停着等，牌局再变时重新看。
   */
  private stalled(seats: number[]): boolean {
    const st = this.st!;
    if (seats.length) return false;
    // 在停一会儿（0.5.0）：到点由闹钟接着来，不算卡住
    if (this.pauseOf(st.game as S) !== null) return false;
    try {
      if (this.game.waiting?.(st.game as S) === true) return false;
    } catch (e) {
      console.error('game.waiting threw', e instanceof Error ? e.message : e);
    }
    console.error('game has nobody to act but is not over', st.code);
    st.status = 'over';
    st.turnSince = null;
    this.release = { host: st.host, code: st.code };
    return true;
  }

  /** 超时代出：先用 timeout，被规则拒了再用 ai 试一次。都不行返回 false（记日志）。 */
  private timeoutStep(seat: number, now: number): boolean {
    const st = this.st!;
    let err = this.step(seat, (this.game.timeout ?? this.game.ai)(st.game as S, seat), now);
    if (err && this.game.timeout) err = this.step(seat, this.game.ai(st.game as S, seat), now);
    if (err) console.error('timeout and ai moves both rejected', st.code, seat, err);
    return !err;
  }

  /**
   * 这一刻能出手的座位：游戏写了 actors 用它（去掉不合法、重复的），没写就是 [turn]（和 0.1.0 一样）。
   * group 是游戏给的组标识（没给为 null），用来判断出完一步还是不是同一组。
   */
  private turnOf(state: S): { seats: number[]; group: string | null } {
    if (!this.game.actors) {
      const seat = this.game.turn(state);
      return { seats: seat === null ? [] : [seat], group: null };
    }
    const raw = this.game.actors(state);
    const list = Array.isArray(raw) ? raw : raw.seats;
    const group = !Array.isArray(raw) && typeof raw.group === 'string' ? raw.group : null;
    const seats: number[] = [];
    for (const s of list) if (Number.isInteger(s) && s >= 0 && s < this.game.seats && !seats.includes(s)) seats.push(s);
    return { seats, group };
  }

  private actorsOf(state: S): number[] {
    return this.turnOf(state).seats;
  }

  /** 这一手只有这一个座位要出（一个人的一手，不是一组）。 */
  private onlyActor(seat: number): boolean {
    const seats = this.actorsOf(this.st!.game as S);
    return seats.length === 1 && seats[0] === seat;
  }

  private turnMsOf(state: S): number {
    const ms = this.game.turnMs?.(state);
    return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : this.limits.turnMs;
  }

  /**
   * 这一手（组）的截止时间；没有在等真人（都是电脑、托管，或者没人要出）时为 null。
   * 在停一会儿时（0.5.0）是停够的时间：nextDeadline 把它算进唯一的闹钟。
   */
  private deadline(): number | null {
    const st = this.st!;
    if (st.status !== 'playing' || st.turnSince === null) return null;
    const state = st.game as S;
    const actors = this.actorsOf(state);
    if (!actors.length) {
      const ms = this.pauseOf(state);
      return ms === null ? null : st.turnSince + ms;
    }
    if (!actors.some((x) => !this.isAuto(x))) return null;
    return st.turnSince + this.turnMsOf(state);
  }

  /** 停顿的截止时间（0.5.0）：在打、在停时才有，给 RoomInfo.pause */
  private pausedUntil(): number | null {
    const st = this.st!;
    if (st.status !== 'playing' || st.game === null || this.pauseOf(st.game) === null) return null;
    return this.deadline();
  }

  /**
   * 这一刻要停多久（0.5.0，RoomGame.pause）：没人能出手、没打完、游戏给了正的有限数才算，否则 null。
   * 只写了 pause 没写 resume 的，停了也没法接着来，当作没有停顿（行为和 0.4.0 一样），只记一次日志免得每步刷屏。
   */
  private pauseOf(state: S): number | null {
    if (!this.game.pause) return null;
    if (!this.game.resume) {
      if (!this.warnedNoResume) console.error('game has pause() but no resume(); pause ignored');
      this.warnedNoResume = true;
      return null;
    }
    if (this.actorsOf(state).length || this.game.over(state)) return null;
    let ms: number | null;
    try {
      ms = this.game.pause(state);
    } catch (e) {
      console.error('game.pause threw', e instanceof Error ? e.message : e);
      return null;
    }
    return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  /**
   * 停够了：调游戏的 resume 做一步（和闹钟这一步一起写）。resume 抛错、或者返回的还在停，就不用它的结果，
   * 把截止时间推到 ALARM_RETRY_MS 以后再试——不推的话截止时间一直是过去的，闹钟会在当前时刻反复响、每次写一行。
   * 返回 true 是牌局往前走了。
   */
  private resumeStep(now: number): boolean {
    const st = this.st!;
    const state = st.game as S;
    const before = this.turnOf(state);
    let next: S | undefined;
    try {
      next = this.game.resume!(state);
    } catch (e) {
      console.error('game.resume threw', st.code, e instanceof Error ? e.message : e);
    }
    if (next !== undefined && this.pauseOf(next) === null) {
      this.land(next, before, null, now);
      return true;
    }
    if (next !== undefined) console.error('game.resume left the room paused', st.code);
    st.turnSince = now + ALARM_RETRY_MS - this.pauseOf(state)!;
    return false;
  }

  private isAuto(seat: number): boolean {
    const s = this.st!.seats[seat]!;
    return s.kind === 'ai' || (s.kind === 'human' && s.auto);
  }

  /** 轮到电脑（或托管）时一次算到下一个真人回合，每步带播放延迟（4.4）；算不完的按闹钟接着算。 */
  private runAuto(now: number): { state: S | null; delay: number }[] {
    const st = this.st!;
    const frames: { state: S | null; delay: number }[] = [];
    // 桌上一个真人都没有（都离座了）就停着，不让电脑在空房间里自己打完（等有人接管或房间超时关掉）
    if (!st.seats.some((s) => s.kind === 'human')) return frames;
    while (st.status === 'playing' && !this.closing) {
      // 一组人时组里的电脑、托管一个个代出，剩下的真人各自点
      const seat = this.actorsOf(st.game as S).find((x) => this.isAuto(x));
      if (seat === undefined) break;
      if (frames.length >= this.limits.maxAiBatch) {
        st.aiAt = now + frames.length * this.limits.aiDelayMs;
        break;
      }
      let action: A;
      try {
        action = this.game.ai(st.game as S, seat);
      } catch (e) {
        console.error('game.ai threw', e instanceof Error ? e.message : e);
        break;
      }
      // 下一手的计时从电脑出完开始算（加上客户端播放的时间）
      const err = this.step(seat, action, now + (frames.length + 1) * this.limits.aiDelayMs);
      if (err) {
        console.error('game.ai made an illegal move', err);
        break;
      }
      frames.push({ state: st.game, delay: this.limits.aiDelayMs });
    }
    return frames;
  }

  // ---------- 对外的事（0.3.0，RoomGame.effects） ----------

  /** 游戏说还没办完的事；格式不对的丢掉、游戏出错当没有（都记日志）。 */
  private effectsOf(state: S): E[] {
    if (!this.game.effects || !this.game.settled) return [];
    try {
      return this.game.effects(state).filter((e) => {
        const ok = !!e && typeof e.id === 'string' && e.id.length > 0 && Number.isInteger(e.seat) && e.seat >= 0 && e.seat < this.game.seats;
        if (!ok) console.error('game.effects returned a bad effect');
        return ok;
      });
    } catch (e) {
      console.error('game.effects threw', e instanceof Error ? e.message : e);
      return [];
    }
  }

  /**
   * 一步做完以后（entry 之外）把没在办的事交给 perform，办完再用一步（entry）把结果写回状态。
   * 办完一笔可能引出下一笔，最多连着 EFFECT_ROUNDS 轮；有失败的就记下退避时间、交给闹钟。
   * 正在关的房间办完了就删掉。同一时间只有一处在跑（写回那一步的 afterStep 不会再进来）。
   */
  private async runEffects(): Promise<void> {
    if (this.effectsBusy || !this.game.effects || !this.game.settled) return;
    this.effectsBusy = true;
    try {
      for (let round = 0; round < EFFECT_ROUNDS; round++) {
        const st = this.load();
        if (!st || st.game === null || (st.effectsAt != null && st.effectsAt > Date.now())) return;
        const todo = this.effectsOf(st.game).filter((e) => !this.inflight.has(e.id));
        if (!todo.length) {
          if (st.ending) await this.entry(() => this.wipe(st.ending!.reason));
          return;
        }
        for (const e of todo) this.inflight.add(e.id);
        const owners = st.owners;
        const results = await Promise.allSettled(todo.map((e) => this.perform(e, owners[e.seat] || null)));
        for (const e of todo) this.inflight.delete(e.id);
        const done: { id: string; value: unknown }[] = [];
        let failed = false;
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') done.push({ id: todo[i]!.id, value: r.value });
          else {
            failed = true;
            console.error('room effect failed', st.code, todo[i]!.id, r.reason instanceof Error ? r.reason.message : r.reason);
          }
        });
        const stuck = await this.entry(() => this.settle(done, failed));
        if (failed || stuck === true) return;
      }
    } finally {
      this.effectsBusy = false;
    }
  }

  /**
   * 把办完的事写回状态（1 行，需要时再设闹钟）；有失败的记下退避时间。正在关的房间全办完了就删掉。
   * 返回 true：游戏的 settled 写错了，办完的事还留在 effects() 里。记日志、当失败交给退避，不在这一轮里接着重办（否则每步之后同一笔要办 EFFECT_ROUNDS 次）。
   */
  private settle(done: { id: string; value: unknown }[], failed: boolean): boolean {
    const st = this.load();
    if (!st || st.game === null) return false;
    const now = Date.now();
    const before = this.turnOf(st.game);
    const pending = new Set(this.effectsOf(st.game).map((e) => e.id));
    let next: S = st.game;
    for (const d of done) {
      if (!pending.has(d.id)) continue;
      try {
        next = this.game.settled!(next, d.id, d.value);
      } catch (e) {
        console.error('game.settled threw', e instanceof Error ? e.message : e);
      }
    }
    const left = new Set(this.effectsOf(next).map((e) => e.id));
    const stuck = done.filter((d) => left.has(d.id)).map((d) => d.id);
    if (stuck.length) {
      console.error('game.settled left effects pending', st.code, stuck.join(','));
      failed = true;
    }
    if (failed) {
      st.effectTries = (st.effectTries ?? 0) + 1;
      st.effectsAt = now + Math.min(EFFECT_RETRY_MAX_MS, EFFECT_RETRY_MS * 2 ** (st.effectTries - 1));
    } else {
      st.effectTries = 0;
      st.effectsAt = null;
    }
    if (st.ending) {
      st.game = next;
      if (!failed && left.size === 0) this.wipe(st.ending.reason);
      else {
        this.planAlarm();
        this.save();
      }
      return stuck.length > 0;
    }
    const frames: { state: S | null; delay: number }[] = [];
    if (next !== st.game) {
      this.land(next, before, null, now);
      frames.push({ state: st.game, delay: 0 }, ...(st.status === 'playing' ? this.runAuto(now) : []));
    }
    this.commit({ frames: frames.length ? frames : [{ state: st.game, delay: 0 }] });
    return stuck.length > 0;
  }

  /** 正在关的房间醒来：到了 closingMs 还没办完就放弃（记日志删掉）；到了重试时间就清掉等待，afterStep 接着办。 */
  private endingAlarm(st: Persist<S>, now: number): void {
    const ending = st.ending!;
    if (now >= ending.at + this.limits.closingMs) {
      console.error('room closing: effects still pending, giving up', st.code, this.effectsOf(st.game as S).map((e) => e.id).join(','));
      return this.wipe(ending.reason);
    }
    if (st.effectsAt != null && now >= st.effectsAt) {
      st.effectsAt = null;
      this.planAlarm();
      return this.save();
    }
    this.planAlarm();
  }

  // ---------- 写库、广播 ----------

  /**
   * 一步的收尾：seq 加一、算闹钟、写那一行，然后广播（都在同步代码里），闹钟留到 entry 最后设。
   * 这一步走到了收场点（closing）：不写了，广播完直接关房，大家先看到这一副的结果再收到 4000 和原因。
   */
  private commit(out: StepOut<S>, exclude?: WebSocket): void {
    const st = this.st!;
    st.seq++;
    if (!this.closing) {
      this.planAlarm();
      this.save();
    }
    this.broadcast(out, exclude);
    if (this.closing) {
      console.error('daily writes reached stop, room closed at a break point', st.code);
      this.closeRoom(CLOSE_REASON.quota);
      return;
    }
    if (st.game != null) {
      try {
        this.onStep(st.game);
      } catch (e) {
        console.error('onStep threw', st.code, e instanceof Error ? e.message : e);
      }
    }
  }

  /** 一个人在这个房间最多能用多少条入站额度。 */
  private userInboundCap(): number {
    return Math.max(1, Math.floor(this.limits.maxInbound * this.limits.maxInboundShare));
  }

  private inboundOf(st: Persist<S>, userId: string): number {
    return (st.inboundBy[userId] ?? 0) + (this.pendingBy.get(userId) ?? 0);
  }

  /**
   * 记一条入站（消息或会写库的重连）。'user'：这个人的那一份用完了，调用方只断开他（这条不记，不写库）；
   * 'room'：房间一生的上限到了，调用方关房；'ok'：照常。
   */
  private countInbound(st: Persist<S>, userId: string): 'ok' | 'user' | 'room' {
    if (this.inboundOf(st, userId) >= this.userInboundCap()) {
      console.error('room user inbound share reached', st.code, userId);
      return 'user';
    }
    this.pendingInbound++;
    this.pendingBy.set(userId, (this.pendingBy.get(userId) ?? 0) + 1);
    if (st.inbound + this.pendingInbound <= this.limits.maxInbound) return 'ok';
    // 只记 userId 和条数，不记消息内容
    let top = '';
    let most = 0;
    for (const id of new Set([...Object.keys(st.inboundBy), ...this.pendingBy.keys()])) {
      const n = (st.inboundBy[id] ?? 0) + (this.pendingBy.get(id) ?? 0);
      if (n > most) [top, most] = [id, n];
    }
    console.error('room inbound limit reached', st.code, 'top sender', top, most);
    return 'room';
  }

  private save(): void {
    const st = this.st!;
    st.inbound += this.pendingInbound;
    this.pendingInbound = 0;
    for (const [id, n] of this.pendingBy) st.inboundBy[id] = (st.inboundBy[id] ?? 0) + n;
    this.pendingBy.clear();
    // 连同这一行、这一步要设的闹钟一起算上（entry 最后才加进内存里的 unmetered）
    st.unmetered = this.unmetered + this.writes + 1 + (this.alarmToSet !== null ? 1 : 0);
    const cur = this.ctx.storage.sql.exec(
      `INSERT INTO ${TABLE} (k, v) VALUES (1, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(st),
    );
    this.writes += cur.rowsWritten;
  }

  /** 只读：表不在（从没开过房、或者关房时连表一起删了）就是没有这个房间，不建表、不写任何东西。 */
  private load(): Persist<S> | null {
    if (this.st !== undefined) return this.st;
    const sql = this.ctx.storage.sql;
    const hasTable = sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, TABLE).toArray().length > 0;
    const row = hasTable ? sql.exec<{ v: string }>(`SELECT v FROM ${TABLE} WHERE k = 1`).toArray()[0] : undefined;
    this.st = row ? loadPersist<S>(row.v) : null;
    if (this.st) this.unmetered = this.st.unmetered ?? 0;
    return this.st;
  }

  /**
   * 关房间：断开所有人、删闹钟、删存储（4.1），不留任何东西；房主的名额在 entry 最后还（afterStep）。
   * 游戏有对外的事（0.3.0）：先让游戏记下收场要办的（RoomGame.closing），还有没办完的就断开所有人、留着存储接着办（ending），
   * 办完或者到了 closingMs 再删。
   */
  private closeRoom(reason = 'room closed'): void {
    const st = this.st;
    if (st && !st.ending && st.game !== null && this.game.effects && this.game.settled) {
      let final: S = st.game;
      try {
        if (this.game.closing) final = this.game.closing(st.game);
      } catch (e) {
        console.error('game.closing threw', e instanceof Error ? e.message : e);
      }
      if (this.effectsOf(final).length) {
        for (const ws of this.sockets()) {
          ws.serializeAttachment(null);
          ws.close(CLOSE.roomClosed, reason);
        }
        st.game = final;
        st.ending = { reason, at: Date.now() };
        st.effectsAt = null;
        st.effectTries = 0;
        this.release = { host: st.host, code: st.code };
        this.closing = false;
        this.planAlarm();
        this.save();
        return;
      }
    }
    this.wipe(reason);
  }

  /** 真的删掉：断开所有人、删闹钟、删存储。 */
  private wipe(reason: string): void {
    for (const ws of this.sockets()) {
      ws.serializeAttachment(null);
      ws.close(CLOSE.roomClosed, reason);
    }
    if (this.st) this.release = { host: this.st.host, code: this.st.code };
    this.st = null;
    this.alarmToSet = null;
    this.alarmAt = null;
    this.writes++;
    void this.ctx.storage.deleteAlarm();
    void this.ctx.storage.deleteAll();
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  /** 还有没有入座的真人连着（不算 except 这条） */
  private seatedOnline(except?: WebSocket): boolean {
    return this.sockets().some((o) => {
      const a = o === except ? null : attachmentOf(o);
      return a !== null && this.seatOf(a.userId) !== null;
    });
  }

  /** 校验开局选项（游戏写了 options 时）和它定的座位数；不合格返回 undefined */
  private checkOpts(raw: unknown): { opts: O | undefined; count: number } | undefined {
    let opts: O | undefined;
    if (this.game.options) {
      const o = this.game.options(raw);
      if (o === null) return undefined;
      opts = o;
    }
    const count = this.countOf(opts);
    return Number.isInteger(count) && count >= 1 && count <= this.game.seats ? { opts, count } : undefined;
  }

  private countOf(opts: O | undefined): number {
    return this.game.seatCount ? this.game.seatCount(opts) : this.game.seats;
  }

  private seatOf(userId: string): number | null {
    const i = this.st?.seats.findIndex((s) => s.kind === 'human' && s.userId === userId) ?? -1;
    return i >= 0 ? i : null;
  }

  private roomInfo(): RoomInfo {
    const st = this.st!;
    // owners 里是 userId，只下发"绑没绑"，不下发是谁
    const seats: SeatInfo[] = st.seats.map((s, i) => {
      const reserved = st.owners[i] != null;
      return {
        kind: s.kind,
        name: s.kind === 'human' || (s.kind === 'ai' && reserved) ? s.name : null,
        away: s.kind === 'human' && s.awaySince !== null,
        auto: s.kind === 'human' && s.auto,
        reserved,
      };
    });
    let turn: RoomInfo['turn'] = null;
    if (st.status === 'playing') {
      const seats = this.actorsOf(st.game as S);
      if (seats.length) turn = { seat: seats[0]!, deadline: this.deadline(), ...(this.game.actors ? { seats } : {}) };
    }
    const until = this.pausedUntil();
    return {
      code: st.code,
      status: st.status,
      seats,
      turn,
      ...(st.opts !== undefined ? { opts: st.opts } : {}),
      ...(until !== null ? { pause: { until } } : {}),
    };
  }

  /** 这个人开打后绑定的座位（离座了也还是它）；还没开打、没坐过为 null。 */
  private boundOf(userId: string): number | null {
    const i = this.st!.owners.indexOf(userId);
    return i >= 0 ? i : null;
  }

  private welcome(seat: number | null, bound: number | null): DownMsg<V> {
    const st = this.st!;
    return {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      minClientVersion: this.limits.minClientVersion,
      seq: st.seq,
      you: { seat, bound },
      room: this.roomInfo(),
      view: st.game === null ? null : this.game.view(st.game, seat),
      // 有短语的游戏告诉页面限速的节奏（0.7.0），RoomClient 按它排队，用户感觉不到限速
      ...(hasEmotes(this.game.emotes) ? { emote: this.emoteRate() } : {}),
    };
  }

  private stateMsg(seat: number | null, bound: number | null, frames: { state: S | null; delay: number }[], ack?: string, quiet = false): DownMsg<V> {
    const st = this.st!;
    const out: Frame<V>[] = frames.map((f) => ({ view: (f.state === null ? null : this.game.view(f.state, seat)) as V, delay: f.delay }));
    return { t: 'state', seq: st.seq, you: { seat, bound }, room: this.roomInfo(), frames: out, ...(ack ? { ack } : {}), ...(quiet ? { quiet: true as const } : {}) };
  }

  /** 按座位过滤后广播：同一个座位（加上绑定的座位，没入座的人各自不同）的消息只算一次。只发给已经收到快照（有 attachment）的连接。 */
  private broadcast(out: StepOut<S>, exclude?: WebSocket): void {
    const bySeat = new Map<string, DownMsg<V>>();
    for (const ws of this.sockets()) {
      if (ws === exclude) continue;
      const me = attachmentOf(ws);
      if (!me) continue;
      const seat = this.seatOf(me.userId);
      const bound = this.boundOf(me.userId);
      const key = `${seat}|${bound}`;
      const isAcked = out.ack?.ws === ws;
      let msg = isAcked ? undefined : bySeat.get(key);
      if (!msg) {
        msg = this.stateMsg(seat, bound, out.frames, isAcked ? out.ack!.moveId : undefined);
        if (!isAcked) bySeat.set(key, msg);
      }
      this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: DownMsg<V> | EmotedMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 连接正在关，忽略：webSocketClose 会处理座位
    }
  }

  private reject(ws: WebSocket, code: string, moveId?: string): void {
    this.send(ws, { t: 'error', code, ...(moveId ? { moveId } : {}) });
  }

  /** 每个连接一个令牌桶（内存里；被驱逐后重置成满的，驱逐前至少空闲了一阵，本来也该满了）。 */
  private takeToken(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: this.limits.rateBurst, at: now };
    b.tokens = Math.min(this.limits.rateBurst, b.tokens + ((now - b.at) / 1000) * this.limits.ratePerSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    this.buckets.set(ws, b);
    return true;
  }
}

/** 读存储里的那一行；0.1.0 存下的房间没有后来加的字段，按当时的状态补上（结构只加字段，不改含义）。 */
function loadPersist<S>(raw: string): Persist<S> {
  const st = JSON.parse(raw) as Persist<S>;
  // 已经开打的：坐着的真人绑他自己；电脑座位一律当作已绑（NOBODY），谁都不能接管——
  // 0.1.0 没记谁离过座，放开的话离过座的人读出来就成了"没坐过"，又能去换座位看牌。等人阶段开局时才绑
  st.owners ??= st.seats.map((s) => (st.status === 'waiting' ? null : s.kind === 'human' ? s.userId : NOBODY));
  st.turnSeq ??= st.gameSeq;
  return st;
}

/**
 * 出完这一步还是不是同一组。不管给没给组标识，都要"出手的人离开名单、没有新座位加入"：
 * 这样一组里每个人最多出一次（或被代出一次），期限不会停在过去（游戏每次都给同一个 group 时，每一手照样是新的一手）。
 * 给了组标识（任何一边）：再要求两边标识一样（别的人跟着离开也行）。
 * 没给就推断：组里不止一个人，出手的那个离开、其他人原样留着（不多不少）；一手一个人时永远不是（和 0.1.0 一样）。
 */
function sameGroup(
  before: { seats: number[]; group: string | null },
  seat: number,
  after: { seats: number[]; group: string | null },
): boolean {
  const b = before.seats;
  const a = after.seats;
  const shrank = a.every((x) => x !== seat && b.includes(x));
  if (before.group !== null || after.group !== null) return shrank && before.group !== null && before.group === after.group;
  return shrank && b.length > 1 && a.length === b.length - 1;
}

function validHost(code: string, host: Identity): boolean {
  return ROOM_CODE_RE.test(code) && !!host && typeof host.userId === 'string' && !!host.userId && typeof host.name === 'string';
}

function emptySeat(): SeatState {
  return { kind: 'empty', userId: null, name: null, awaySince: null, auto: false, lastMoveId: null };
}

function aiSeat(): SeatState {
  return { kind: 'ai', userId: null, name: null, awaySince: null, auto: false, lastMoveId: null };
}

function humanSeat(userId: string, name: string, awaySince: number | null): SeatState {
  return { kind: 'human', userId, name, awaySince, auto: false, lastMoveId: null };
}

function isError(x: unknown): x is { error: string } {
  return !!x && typeof x === 'object' && 'error' in x && typeof (x as { error: unknown }).error === 'string' && Object.keys(x).length === 1;
}

function attachmentOf(ws: WebSocket): Attachment | null {
  const a = ws.deserializeAttachment() as Attachment | null | undefined;
  return a && typeof a.userId === 'string' ? a : null;
}

/** 该谁出手原样没变（座位一样、组标识一样）：不轮流的变化之后还是同一手。 */
function sameTurn(before: { seats: number[]; group: string | null }, after: { seats: number[]; group: string | null }): boolean {
  return before.group === after.group && before.seats.length === after.seats.length && before.seats.every((x, i) => after.seats[i] === x);
}

/** 快捷短语的节奏（0.7.0）：每 ms 毫秒补 1 个令牌、最多攒 burst 个 */
export interface EmoteRate {
  ms: number;
  burst: number;
}

function hasEmotes(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** KIT_QUOTA（对象或 JSON 字符串）里的 emoteMs / emoteBurst 覆盖默认值；不合格的忽略。burst 至少 1 */
export function emoteRateOf(raw: unknown, base: EmoteRate): EmoteRate {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const q = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  return { ms: ok(q.emoteMs) ? q.emoteMs : base.ms, burst: Math.max(1, ok(q.emoteBurst) ? q.emoteBurst : base.burst) };
}
