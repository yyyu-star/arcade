/**
 * 联机房间测试的工具：假时间、开房进房、一条测试连接（收消息排队）、读房间里的真实状态、机器人出手、防泄漏检查。
 * 写法照 arcade-kit 的 test/helpers.ts（假时间放在将来、闹钟只由 runDurableObjectAlarm 触发），只是游戏换成真的掼蛋。
 */
import { CLIENT_VERSION } from '../../src/net/version.ts';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { DownMsg, RoomInfo, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { expect, vi } from 'vitest';
import { decide } from '../../src/ai/index.ts';
import { timeoutAction, type Card, type SeatAction, type TributeState } from '../../src/core/index.ts';
import { guandanRoom as R, type NetAction, type NetState, type NetView } from '../../src/net/rules.ts';
import { ROOM_PATH } from '../../src/net/version.ts';
import type { Room } from '../../worker/room.ts';

export const SITE = env.SITE_ORIGIN ?? 'https://game.test';
export const ROOMS = `${SITE}${ROOM_PATH}/rooms`;

/**
 * 假时间放在将来：房间按 Date.now() 算闹钟，workerd 用真时间调度闹钟，设在过去的闹钟会马上真的响。
 * 放在将来，闹钟只在测试用 runDurableObjectAlarm 时才跑，结果可预期。
 */
export const FIXED_NOW = Date.UTC(2030, 0, 15, 12, 0);

export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

export const cookie = (userId: string | null) => (userId ? `__Host-sid=${userId}` : '');

/** 经真的入口（worker/main.ts 的默认导出）开房；stake 是实盘房间的档位（开房请求体 { stake }） */
export async function openRoom(userId: string, stake?: string): Promise<string> {
  const init: RequestInit = stake
    ? { method: 'POST', headers: { origin: SITE, cookie: cookie(userId), 'content-type': 'application/json' }, body: JSON.stringify({ stake }) }
    : { method: 'POST', headers: { origin: SITE, cookie: cookie(userId) } };
  const res = await exports.default.fetch(ROOMS, init);
  if (res.status !== 201) throw new Error(`open room failed: ${res.status}`);
  return ((await res.json()) as { code: string }).code;
}

export function upgrade(code: string, userId: string | null, opts: { origin?: string; cv?: number; chat?: boolean } = {}): Promise<Response> {
  return exports.default.fetch(`${ROOMS}/${code}/ws?cv=${opts.cv ?? CLIENT_VERSION}${opts.chat ? '&chat=1' : ''}`, {
    headers: { upgrade: 'websocket', cookie: cookie(userId), origin: opts.origin ?? SITE },
  });
}

export type Msg = DownMsg<NetView>;

/** 一条测试连接：收到的消息排队；统计下行条数、字节数；每条消息到达时可以挂一个检查。 */
export class Conn {
  readonly msgs: Msg[] = [];
  /** 原文（查隐藏信息用） */
  readonly raw: string[] = [];
  private read = 0;
  closed: { code: number } | null = null;
  bytes = 0;
  sent = 0;
  private wake: (() => void) | null = null;
  private moveNo = 0;

  readonly ws: WebSocket;
  readonly userId: string;

  constructor(ws: WebSocket, userId: string) {
    this.ws = ws;
    this.userId = userId;
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string' && e.data !== 'pong') {
        this.raw.push(e.data);
        this.bytes += e.data.length;
        this.msgs.push(JSON.parse(e.data) as Msg);
      }
      this.wake?.();
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code };
      this.wake?.();
    });
  }

  send(msg: unknown): void {
    this.sent++;
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** 收到过的最新 seq（welcome 或 state） */
  latestSeq(): number {
    let max = -1;
    for (const m of this.msgs) if ((m.t === 'state' || m.t === 'welcome') && m.seq > max) max = m.seq;
    return max;
  }

  /** 最新的状态消息（welcome 或 state） */
  latest(): WelcomeMsg<NetView> | StateMsg<NetView> | null {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i]!;
      if (m.t === 'state' || m.t === 'welcome') return m;
    }
    return null;
  }

  latestView(): NetView | null {
    const m = this.latest();
    if (!m) return null;
    return m.t === 'welcome' ? m.view : m.frames[m.frames.length - 1]!.view;
  }

  latestRoom(): RoomInfo | null {
    return this.latest()?.room ?? null;
  }

  /** 出手：baseSeq 用收到过的最新 seq，和 RoomClient 一样。返回 moveId */
  act(action: NetAction, baseSeq = this.latestSeq()): string {
    const moveId = `${this.userId}-${++this.moveNo}`;
    this.send({ t: 'act', moveId, baseSeq, action });
    return moveId;
  }

  /** 等到条件成立（看全部已收到的消息），timeoutMs 内等不到就失败 */
  async waitFor(pred: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!pred()) {
      if (performance.now() > deadline) throw new Error(`timeout waiting for ${what} (${this.userId})`);
      await new Promise<void>((ok) => {
        this.wake = ok;
        setTimeout(ok, 20);
      });
    }
  }

  /** 下一条没读过的消息 */
  async next(): Promise<Msg> {
    await this.waitFor(() => this.read < this.msgs.length || this.closed !== null, 'next message');
    if (this.read >= this.msgs.length) throw new Error(`closed ${this.closed!.code} while waiting (${this.userId})`);
    return this.msgs[this.read++]!;
  }

  /** 等到 seq ≥ min */
  atLeast(min: number, timeoutMs?: number): Promise<void> {
    return this.waitFor(() => this.latestSeq() >= min || this.closed !== null, `seq ≥ ${min}`, timeoutMs);
  }

  /** 等这个 moveId 的结果：ack 的状态或 error */
  async result(moveId: string): Promise<StateMsg<NetView> | { t: 'error'; code: string }> {
    let found: Msg | undefined;
    await this.waitFor(() => {
      found = this.msgs.find((m) => (m.t === 'state' && m.ack === moveId) || (m.t === 'error' && m.moveId === moveId));
      return !!found || this.closed !== null;
    }, `result of ${moveId}`);
    if (!found) throw new Error(`closed ${this.closed!.code} before result of ${moveId}`);
    return found as StateMsg<NetView> | { t: 'error'; code: string };
  }

  /** 等关闭（3 秒） */
  async closedWith(): Promise<number> {
    await this.waitFor(() => this.closed !== null, 'close');
    return this.closed!.code;
  }
}

export async function join(code: string, userId: string, chat = false): Promise<{ conn: Conn; welcome: WelcomeMsg<NetView> }> {
  const res = await upgrade(code, userId, { chat });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const conn = new Conn(res.webSocket, userId);
  const welcome = (await conn.next()) as WelcomeMsg<NetView>;
  if (welcome.t !== 'welcome') throw new Error(`expected welcome, got ${welcome.t}`);
  return { conn, welcome };
}

/** 升级请求被接受后马上关掉的那种：返回关闭码 */
export async function refusedWith(res: Response): Promise<number> {
  if (res.status !== 101 || !res.webSocket) throw new Error(`expected 101, got ${res.status}`);
  return new Conn(res.webSocket, 'refused').closedWith();
}

/** 只在测试里按房间码取 stub（正式代码只经 arcade-kit 的 acceptCreate / acceptJoin 找房间） */
export function stub(code: string): DurableObjectStub<Room> {
  return env.ROOM.get(env.ROOM.idFromName(code)) as DurableObjectStub<Room>;
}

/** 房间存储里那一行（arcade-kit 的 Persist，这里只声明用到的字段） */
export interface RoomRow {
  seq: number;
  status: 'waiting' | 'playing' | 'over';
  seats: { kind: 'empty' | 'human' | 'ai'; userId: string | null; awaySince: number | null; auto: boolean }[];
  game: NetState | null;
  turnSince: number | null;
  inbound: number;
}

export interface Truth {
  row: RoomRow | null;
  alarm: number | null;
  last: number;
  max: number;
  total: number;
}

/** 读房间的真实状态（存储里的那一行）、闹钟、写入计数。只在测试里看，不经过任何下发路径 */
export function truth(code: string): Promise<Truth> {
  return runInDurableObject(stub(code), async (room: Room, state) => {
    const t = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'kit_room'").one().n > 0;
    const v = t ? state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').toArray()[0]?.v : undefined;
    return {
      row: v ? (JSON.parse(v) as RoomRow) : null,
      alarm: await state.storage.getAlarm(),
      last: room.lastStepWrites,
      max: room.maxStepWrites,
      total: room.totalWrites,
    };
  });
}

/** 闹钟到点了就跑（可能连着几个：醒来没到期只改闹钟）。返回跑了几次 */
export async function fireDueAlarms(code: string, t?: Truth): Promise<number> {
  let n = 0;
  let cur = t ?? (await truth(code));
  while (cur.alarm !== null && cur.alarm <= Date.now()) {
    if (!(await runDurableObjectAlarm(stub(code)))) break;
    n++;
    if (n > 50) throw new Error('闹钟一直在响');
    cur = await truth(code);
  }
  return n;
}

function withoutSeat(a: SeatAction): NetAction {
  switch (a.type) {
    case 'play':
      return a.as ? { type: 'play', cards: a.cards, as: a.as } : { type: 'play', cards: a.cards };
    case 'pass':
      return { type: 'pass' };
    case 'tribute':
      return { type: 'tribute', card: a.card };
    case 'return':
      return { type: 'return', card: a.card };
  }
}

/** 浏览器里的机器人：只看自己收到的视图，用电脑的出牌逻辑在本地算一手（不碰房间的状态和种子） */
export function botAction(nv: NetView, seed: string): NetAction {
  const v = nv.view;
  if (v.phase === 'dealEnd') return { type: 'ready' };
  const a = decide(v, { seed, difficulty: 'normal' });
  if (a && a.type !== 'nextDeal') return withoutSeat(a);
  const t = timeoutAction(v);
  return t ? withoutSeat(t) : { type: 'pass' };
}

/** 视图里所有带牌的字段（同 tests/net.test.ts） */
function cardsIn(nv: NetView): Card[] {
  const v = nv.view;
  const out: Card[] = [...v.hand];
  for (const h of v.history) if (h.play) out.push(...h.play.cards);
  if (v.trick.last) out.push(...v.trick.last.play.cards);
  for (const e of v.tribute?.entries ?? []) {
    if (e.card !== null) out.push(e.card);
    if (e.back !== null) out.push(e.back);
  }
  if (v.myTribute) out.push(...v.myTribute.allowed);
  for (const e of nv.events) {
    if (e.type === 'play') out.push(...e.play.cards);
    if (e.type === 'tribute') out.push(e.card);
    if (e.type === 'returnCard' && e.card !== null) out.push(e.card);
  }
  return out;
}

/** 房间里这一步之后的真实局面（只取查泄漏要用的） */
export interface HandTruth {
  dealNo: number;
  hands: Card[][];
  tribute: TributeState | null;
}

export function handTruth(game: NetState | null): HandTruth | null {
  return game ? { dealNo: game.g.dealNo, hands: game.g.hands, tribute: game.g.tribute } : null;
}

/**
 * 这一帧（座位 seat，null = 没入座）里有没有不该给它看的牌。truth 是房间里这一步之后的真实局面：
 * 同一副里手牌只会变少（贡牌、还贡在一副开头），所以"这一步之后还在 o 手里"的牌，在这一步的每一帧里也在 o 手里。
 * 电脑一批连出可能跨过一副（下一副重新发牌），不是同一副的帧不拿来比（这些帧由 tests/net.test.ts 的视图测试管）。
 * 贡牌、还贡牌按规则从真实状态算该不该看（不看视图里自己有什么）：贡牌分配了才公开、分配前只有交的人看得到；
 * 还贡牌只有双方看得到；没入座的人只看得到分配过的贡牌。双下的贡牌在离开进贡阶段时才分配，所以进贡阶段的帧里按"没分配"算。
 * 返回第一个问题，没有返回 null。
 */
export function leakIn(nv: NetView | null, seat: number | null, truth: HandTruth | null): string | null {
  if (!nv || !truth || nv.view.dealNo !== truth.dealNo) return null;
  const me = seat ?? -1;
  const entries = truth.tribute?.entries ?? [];
  const allowed = new Set<Card>();
  for (const e of entries) {
    const assigned = e.to >= 0 && (truth.tribute!.kind === 'single' || nv.view.phase !== 'tribute');
    if (e.card !== null && (assigned || (me >= 0 && e.from === me))) allowed.add(e.card);
    if (e.back !== null && me >= 0 && (e.from === me || e.to === me)) allowed.add(e.back);
  }
  // 贡牌、还贡牌字段逐项查：不该看的必须是 null（这张牌之后被出掉了、不在任何人手里也算漏）
  for (const v of nv.view.tribute?.entries ?? []) {
    for (const c of [v.card, v.back]) if (c !== null && !allowed.has(c)) return `座位 ${seat} 看到了不该看的贡牌/还贡牌 ${c}`;
  }
  for (const e of nv.events) {
    const c = e.type === 'tribute' || e.type === 'returnCard' ? e.card : null;
    if (c !== null && !allowed.has(c)) return `座位 ${seat} 的事件里有不该看的贡牌/还贡牌 ${c}`;
  }
  // 不拿视图里的 hand 当"自己的牌"豁免：房间要是把别人的牌塞进 hand，这里也要查出来
  for (const c of cardsIn(nv)) {
    if (allowed.has(c)) continue;
    for (let o = 0; o < 4; o++) {
      if (o !== seat && truth.hands[o]!.includes(c)) return `座位 ${seat} 看到了座位 ${o} 手里的牌 ${c}`;
    }
  }
  return null;
}

/** 一条下行消息的原文和内容检查：不带 seed、hands、key 字段，也没有发牌密钥的任何一个数；每帧不漏别人的牌；最后一帧正好是 view(真实状态, 自己的座位) */
export function checkDown(raw: string, m: Msg, truth: HandTruth | null, game: NetState | null): string | null {
  if (/"seed"|"hands"|"key"/.test(raw)) return `下行消息里有 seed / hands / key 字段：${raw.slice(0, 120)}`;
  // 太小的数会和牌号、步数撞上（随机的 u32 小于一百万的概率约万分之二），只查大的
  for (const w of game?.g.key ?? []) if (w >= 1_000_000 && raw.includes(String(w))) return `下行消息里出现了发牌密钥的数 ${w}`;
  // 报错、快捷短语（0.7.1 起电脑也会发，只带座位和编号）没有视图，上面的原文检查就够了
  if (m.t === 'error' || (m as { t: string }).t === 'emote') return null;
  const seat = m.you.seat;
  const views = m.t === 'welcome' ? [m.view] : m.frames.map((f) => f.view);
  for (const v of views) {
    const bad = leakIn(v, seat, truth);
    if (bad) return bad;
  }
  if (game) {
    const last = views[views.length - 1] ?? null;
    try {
      expect(last).toEqual(R.view(game, seat));
    } catch {
      return `座位 ${seat} 收到的最后一帧不是它自己该看到的视图（seq ${m.seq}）`;
    }
  }
  return null;
}

export function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
}

export function dist(xs: number[]): string {
  if (!xs.length) return '（无）';
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return `min ${f(pct(xs, 0))} / 中位 ${f(pct(xs, 50))} / 均值 ${f(mean)} / p99 ${f(pct(xs, 99))} / max ${f(pct(xs, 100))}`;
}
