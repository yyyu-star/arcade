/**
 * 快速匹配的排队（0.20.0，设计 docs/match.md）：游戏 Worker 里的 Durable Object 继承它，填上一桌几个真人，就能按档位排队凑桌。
 * 每个档位一个实例（matchStub 按档位取），浏览器经 worker.ts 的 acceptMatch 连进来，连接本身就是"排着"。
 *
 * 守的规矩（和房间同一套，docs/platform-backend.md 第 4 节）：
 * - 0 行存储：排着的人就是 ctx.getWebSockets()，附件里只放 userId、昵称、开始排的时间；被驱逐后名单还在；
 * - 只用一个闹钟：最早那个人等满 waitMs 的时刻，只往早了调（setAlarm 也算一行写入）；
 * - 只用 ctx.acceptWebSocket，不用 setTimeout / setInterval；排队连接只收不发，浏览器发什么都 1008 断开；
 * - 不碰牌局：不 import 规则、不读房间状态。电脑补位、公平底线全在房间里，和好友房一样；
 * - 名额由房间开桌时向计量一次占齐（kitCreateMatch），排队本身不占。
 */
import { DurableObject } from 'cloudflare:workers';
import { type Identity, KIT_HOST, newRoomCode, parseIdentity, roomStub } from './internal.js';
import { CLOSE, type MatchDownMsg, type MatchSoloWhy } from './protocol.js';
import type { MatchOutcome } from './room.js';
import { kitStoreOf, MirrorStore } from './store.js';

export type { MatchDownMsg, MatchSoloWhy } from './protocol.js';

/** 排队对象要的绑定：房间 ROOM（开桌），平台 ARCADE（可选，屏蔽名单；单独部署没有） */
export interface MatchEnv {
  ROOM: DurableObjectNamespace;
  ARCADE?: Fetcher;
}

interface Waiter {
  userId: string;
  name: string;
  /** 开始排的时间（毫秒） */
  since: number;
  /** 档位（一个实例只有一个档位；放在附件里，被驱逐后闹钟醒来还知道） */
  tier: string;
}

/** 开桌时房间码撞了最多再换几次 */
const CODE_TRIES = 5;
/** 一次凑桌最多重来几轮（有人被计量挡掉、请出去以后接着凑） */
const FORM_ROUNDS = 8;
/** 平台屏蔽名单一次最多问几个人（平台 blockedAmong 的上限，德州 9 人桌） */
const BLOCK_MAX = 9;
/**
 * 凑桌时找平台、找房间最多等多久（毫秒，安全审阅 0.20.0）：凑桌持着"正在凑"的锁，平台或房间卡住时整个档位都会一直"等待中"。
 * 超时的屏蔽名单按空的算，建房按 unavailable（这一桌的人转单机）
 */
export const MATCH_CALL_MS = 3_000;

export abstract class MatchQueue<Env extends MatchEnv = MatchEnv> extends DurableObject<Env> {
  /** 一桌最多几个真人（凑满就开）。按档位不同的游戏覆盖 tableSize */
  protected abstract readonly seats: number;
  /** 最多等多久（毫秒）：到点 ≥ 2 人就开，只剩自己就转单机 */
  protected readonly waitMs: number = 15_000;
  /** 一个档位最多排几个人，满了 1013（挡刷连接） */
  protected readonly maxQueue: number = 200;
  /** 每人每小时最多排几次，超了 4029（内存里记，被驱逐就清零，接受） */
  protected readonly perHour: number = 30;
  /** 凑桌时找平台、找房间最多等多久（毫秒，见 MATCH_CALL_MS） */
  protected readonly callMs: number = MATCH_CALL_MS;

  /** 这个档位一桌最多几个真人；默认 seats */
  protected tableSize(_tier: string): number {
    return this.seats;
  }

  /** 这个档位开桌带的开局选项（交给房间的 RoomGame.options 校验）；默认不带 */
  protected roomOptions(_tier: string): unknown {
    return undefined;
  }

  /**
   * 这几个人之间谁屏蔽了谁（平台 0.25.0 的 ARCADE.blockedAmong，最多 9 人，只读）。没有平台（单独部署）、出错都当没有，回 []。
   * 测试覆盖它换成假名单
   */
  protected async blockedAmong(userIds: string[]): Promise<[string, string][]> {
    const arcade = this.env.ARCADE as unknown as { blockedAmong?: (ids: unknown) => Promise<unknown> } | undefined;
    if (!arcade || userIds.length < 2) return [];
    try {
      const out = await arcade.blockedAmong!(userIds.slice(0, BLOCK_MAX));
      return Array.isArray(out) ? out.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') : [];
    } catch (e) {
      console.error('blockedAmong failed, matching without it', e instanceof Error ? e.message : e);
      return [];
    }
  }

  /** 开一张匹配桌（房间的 kitCreateMatch）。游戏不用覆盖；kit 的测试用它模拟房间卡住 */
  protected createMatchRoom(code: string, players: Identity[], opts: unknown): Promise<MatchOutcome> {
    const stub = roomStub(this.env.ROOM, code) as unknown as { kitCreateMatch(code: string, players: Identity[], opts?: unknown): Promise<MatchOutcome> };
    return stub.kitCreateMatch(code, players, opts);
  }

  /** 现在设着的闹钟；undefined 是还不知道，用前 getAlarm() 读 */
  private alarmAt: number | null | undefined;
  /** 正在凑桌（中间 await 了平台和房间）：这时进来的人、到点的闹钟只记一笔，凑完再来一轮 */
  private forming = false;
  private again = false;
  /** 凑桌途中已经选中的人：别的一轮不再选他们 */
  private readonly taken = new Set<string>();
  /** 每人这一小时排了几次 */
  private readonly hourly = new Map<string, number[]>();

  /**
   * 自托管 PG 模式（0.21.0，env 里有 KIT_STORE）：排队不存表，只把闹钟记进 PG，进程重启后宿主按它 kitWake；
   * 没有 KIT_STORE 时为 null，行为不变
   */
  private readonly pg: MirrorStore | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const rpc = kitStoreOf(env);
    this.pg = rpc ? new MirrorStore(rpc, 'match') : null;
  }

  /** PG 模式：把现在的闹钟提交进 PG（和存着的一样就不调）；出错只记日志，排队照常 */
  private async pgAlarm(): Promise<void> {
    const pg = this.pg;
    if (!pg || pg.name === null || this.alarmAt === undefined) return;
    try {
      await pg.open(pg.name);
      await pg.flush(this.alarmAt);
    } catch (e) {
      console.error('match store commit failed', e instanceof Error ? e.message : e);
    }
  }

  /**
   * 进程重启后宿主唤醒（0.21.0，只有 KIT_STORE 绑定能调）：按 PG 里存的闹钟重设（过期的马上响，醒来凑桌时队里没人就什么都不做）。
   * 幂等：闹钟已经设着的不动；没有 KIT_STORE 时什么都不做
   */
  async kitWake(name: string): Promise<void> {
    const pg = this.pg;
    if (!pg) return;
    try {
      await pg.open(name);
      if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
      const at = pg.storedAlarm;
      if (at !== null && this.alarmAt === null) {
        this.alarmAt = at;
        await this.ctx.storage.setAlarm(at);
      }
    } catch (e) {
      console.error('match wake failed', e instanceof Error ? e.message : e);
      this.alarmAt = undefined;
    }
  }

  /** 入队：只认 kit 自己拼的内部地址（worker.ts 的 acceptMatch），身份在 x-kit-user 头里。 */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== KIT_HOST || url.pathname !== '/match' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('not a kit request', { status: 400 });
    }
    const me = parseIdentity(request.headers.get('x-kit-user'));
    const tier = url.searchParams.get('tier');
    if (!me || !tier) return new Response('no identity', { status: 401 });
    // PG 模式记下自己的名字（matchStub 用的），提交闹钟时带上
    if (this.pg && this.pg.name === null) await this.pg.open(`kit-match:${tier}`).catch((e: unknown) => console.error('match store open failed', e instanceof Error ? e.message : e));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const done = new Response(null, { status: 101, webSocket: client });
    const now = Date.now();
    // 只数还排着的（附件还在）：已经出队、正在关的连接不占队长
    const others = this.waiting().filter((o) => o !== server);
    const mine = others.filter((o) => waiterOf(o)?.userId === me.userId);
    if (others.length - mine.length >= this.maxQueue) {
      server.close(CLOSE.tryLater, 'queue full');
      return done;
    }
    // 一小时前的旧条目顺手清掉（排过一次就走的人不能让这张表一直涨）
    for (const [u, ts] of this.hourly) if (now - ts[ts.length - 1]! >= 3_600_000) this.hourly.delete(u);
    const times = (this.hourly.get(me.userId) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= this.perHour) {
      this.hourly.set(me.userId, times);
      server.close(CLOSE.tooManyJoins, 'too often');
      return done;
    }
    times.push(now);
    this.hourly.set(me.userId, times);
    // 同一个人只排一次：旧的那条让位
    for (const o of mine) this.drop(o, CLOSE.replaced, 'replaced');
    server.serializeAttachment({ userId: me.userId, name: me.name, since: now, tier } satisfies Waiter);
    // 先回 101 再凑桌：凑桌要找平台、房间，不能让新来的人连连接都拿不到
    this.ctx.waitUntil(this.form());
    return done;
  }

  /** 排队连接只收不发：发什么都断开（不让它变成能刷的入口） */
  override async webSocketMessage(ws: WebSocket): Promise<void> {
    this.drop(ws, CLOSE.policy, 'queue is receive-only');
    this.pushWaiting();
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      // 已经关了
    }
    ws.serializeAttachment(null);
    this.pushWaiting();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    ws.serializeAttachment(null);
    this.pushWaiting();
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    try {
      await this.form();
    } catch (e) {
      // 闹钟里不往外抛（会自动重试、每次计费）
      console.error('match alarm failed', e instanceof Error ? e.message : e);
    }
    await this.pgAlarm();
  }

  // ---------- 凑桌 ----------

  /**
   * 凑一轮：凑满一桌立刻开；最早的人等够了：≥ 2 人就开，只剩自己转单机。凑完还有人就把闹钟对到下一个人。
   * 凑桌中间要 await（平台、房间），这时别的入口进来只记 again，凑完再来一轮
   */
  private async form(): Promise<void> {
    if (this.forming) {
      this.again = true;
      return;
    }
    this.forming = true;
    try {
      let rounds = 0;
      do {
        this.again = false;
        while (rounds++ < FORM_ROUNDS && (await this.formOnce()));
      } while (this.again && rounds < FORM_ROUNDS);
    } finally {
      this.forming = false;
      this.taken.clear();
    }
    this.pushWaiting();
    await this.planAlarm();
  }

  /** 凑一桌；凑出了（或者有人被请出去了）回 true，接着凑下一桌 */
  private async formOnce(): Promise<boolean> {
    const list = this.queue().filter((w) => !this.taken.has(w.me.userId));
    if (!list.length) return false;
    const tier = list[0]!.me.tier;
    const size = Math.max(1, Math.min(this.tableSize(tier), BLOCK_MAX));
    const due = Date.now() >= list[0]!.me.since + this.waitMs;
    if (list.length < size && !due) return false;
    const blocks = await withTimeout(this.blockedAmong(list.slice(0, BLOCK_MAX).map((w) => w.me.userId)), this.callMs).catch((e: unknown) => {
      console.error('blockedAmong timed out, matching without it', e instanceof Error ? e.message : e);
      return [] as [string, string][];
    });
    const chosen: typeof list = [];
    for (const w of list.slice(0, BLOCK_MAX)) {
      if (chosen.length >= size) break;
      if (chosen.some((c) => blocks.some(([a, b]) => (a === c.me.userId && b === w.me.userId) || (a === w.me.userId && b === c.me.userId)))) continue;
      chosen.push(w);
    }
    if (chosen.length < size && !due) return false;
    if (chosen.length < 2) {
      // 等够了却只有自己（或者在的人都和他互相屏蔽）：转单机
      this.solo(chosen[0]!.ws, 'alone');
      return true;
    }
    for (const c of chosen) this.taken.add(c.me.userId);
    const players: Identity[] = chosen.map((c) => ({ userId: c.me.userId, name: c.me.name }));
    let out: MatchOutcome = { r: 'unavailable' };
    let code = '';
    for (let i = 0; i < CODE_TRIES; i++) {
      code = newRoomCode();
      try {
        out = await withTimeout(this.createMatchRoom(code, players, this.roomOptions(tier)), this.callMs);
      } catch (e) {
        console.error('kitCreateMatch failed', e instanceof Error ? e.message : e);
        out = { r: 'unavailable' };
      }
      if (out.r !== 'exists') break;
    }
    for (const c of chosen) this.taken.delete(c.me.userId);
    // 等的这一会儿可能有人走了、换了页面：按 userId 找他现在的连接
    const sockOf = (userId: string) => this.waiting().find((ws) => waiterOf(ws)?.userId === userId);
    if (out.r === 'created') {
      for (const c of chosen) {
        const ws = sockOf(c.me.userId);
        if (ws) this.finish(ws, { t: 'matched', code });
      }
      return true;
    }
    if (out.r === 'refused') {
      if (out.userId === null) {
        // 全站忙：这一轮的人都转单机，其他人留着（到点还会被同样挡掉）
        for (const c of chosen) {
          const ws = sockOf(c.me.userId);
          if (ws) this.solo(ws, 'busy');
        }
        return true;
      }
      const ws = sockOf(out.userId);
      if (ws) {
        if (out.why === 'has_room') this.finish(ws, { t: 'has_room', code: out.code });
        else this.solo(ws, 'daily_limit');
        return true;
      }
      return true;
    }
    // 房间那边出错、超时、选项不对：这一轮的人转单机，不让他们一直等。
    // bad / bad_options 是游戏配错了（tableSize 比这一局的座位多、roomOptions 过不了 RoomGame.options），每桌都会这样：
    // 大声记日志；游戏在自己的测试里用 game.ts 的 matchConfigErrors 先查
    if (out.r === 'bad' || out.r === 'bad_options') console.error(`MatchQueue misconfigured for tier ${tier}: room said ${out.r} (check tableSize / roomOptions with matchConfigErrors)`);
    else console.error('match room not created', out.r);
    for (const c of chosen) {
      const ws = sockOf(c.me.userId);
      if (ws) this.solo(ws, 'unavailable');
    }
    // 房间那边不好（超时、出错）：这一次不接着凑，剩下的人等下一次闹钟，不让锁一直被连着的超时占着
    this.again = false;
    return false;
  }

  /** 只往早了调闹钟：最早那个人等够的时刻 */
  private async planAlarm(): Promise<void> {
    const list = this.queue();
    if (!list.length) return;
    const next = list[0]!.me.since + this.waitMs;
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt !== null && this.alarmAt <= next && this.alarmAt > Date.now() - 1_000) return;
    this.alarmAt = next;
    try {
      await this.ctx.storage.setAlarm(next);
    } catch (e) {
      console.error('match setAlarm failed', e instanceof Error ? e.message : e);
      this.alarmAt = undefined;
    }
    await this.pgAlarm();
  }

  // ---------- 连接 ----------

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private waiting(): WebSocket[] {
    return this.sockets().filter((ws) => waiterOf(ws) !== null);
  }

  /** 排着的人，按开始排的先后；同一个人只算最新的那条 */
  private queue(): { ws: WebSocket; me: Waiter }[] {
    const by = new Map<string, { ws: WebSocket; me: Waiter }>();
    for (const ws of this.waiting()) {
      const me = waiterOf(ws)!;
      const had = by.get(me.userId);
      if (!had || had.me.since <= me.since) by.set(me.userId, { ws, me });
    }
    return [...by.values()].sort((a, b) => a.me.since - b.me.since);
  }

  /** 人数变了就推一次（不每秒推，页面自己倒计时） */
  private pushWaiting(): void {
    const list = this.queue();
    if (!list.length) return;
    // 倒计时按最早的那个人算：他到点时大家一起凑，后来的人等不满 waitMs
    const left = Math.max(0, list[0]!.me.since + this.waitMs - Date.now());
    const msg: MatchDownMsg = { t: 'waiting', n: list.length, seats: this.tableSize(list[0]!.me.tier), left };
    for (const { ws } of list) send(ws, msg);
  }

  private solo(ws: WebSocket, why: MatchSoloWhy): void {
    this.finish(ws, { t: 'solo', why });
  }

  /** 发最后一条，出队、关掉 */
  private finish(ws: WebSocket, msg: MatchDownMsg): void {
    send(ws, msg);
    this.drop(ws, 1000, msg.t);
  }

  private drop(ws: WebSocket, code: number, reason: string): void {
    ws.serializeAttachment(null);
    try {
      ws.close(code, reason);
    } catch {
      // 已经关了
    }
  }
}

function waiterOf(ws: WebSocket): Waiter | null {
  const a = ws.deserializeAttachment() as Waiter | null | undefined;
  return a && typeof a.userId === 'string' ? a : null;
}

function send(ws: WebSocket, msg: MatchDownMsg): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // 连接正在关
  }
}

/**
 * 等一个外部调用最多 ms 毫秒，超时抛错（调用方按失败处理）。只在凑桌这一次请求里等，不是房间的状态计时，
 * 所以用运行时的 scheduler.wait（不是 setTimeout、也不占那一个闹钟）
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // 超时以后原来的调用照样可能失败：先接住它的错，免得变成没人处理的 rejection
  const settled = p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
  const out = await Promise.race([settled, scheduler.wait(ms).then(() => null)]);
  if (out === null) throw new Error(`timed out after ${ms} ms`);
  if (!out.ok) throw out.e;
  return out.v;
}
