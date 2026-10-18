/** 测试用的连接和时钟。时间只假 Date（和平台测试一样），WebSocket 的等待用真的 setTimeout。 */
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import type { ChattedMsg, DownMsg, EmotedMsg, StateMsg, WelcomeMsg } from '../src/protocol.ts';
import { meterStub, roomStub, SESSION_COOKIE } from '../src/internal.ts';
import type { RoomMeter } from '../src/meter.ts';
import { SITE, type ToyRoom, type ToyView } from './worker.ts';

/**
 * 假时间放在将来：房间按 Date.now() 算闹钟时间，workerd 用真时间调度闹钟，设在过去的闹钟会马上真的响。
 * 放在将来，闹钟只在测试用 runDurableObjectAlarm 时才跑，结果可预期。
 */
export const FIXED_NOW = Date.UTC(2030, 0, 15, 12, 0);

export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

/** 计量的 stub；ns 默认 env.METER，FlakyRoom 用的是 env.FLAKY_METER。 */
export function meter(ns: DurableObjectNamespace = env.METER): DurableObjectStub<RoomMeter> {
  return meterStub(ns) as DurableObjectStub<RoomMeter>;
}

/** 清空计量（同一个测试文件里的存储是共用的；不清的话前面测试开的房间还占着名额）。 */
export async function resetMeter(ns: DurableObjectNamespace = env.METER): Promise<void> {
  await runInDurableObject(meter(ns), (_m: RoomMeter, state) => {
    const sql = state.storage.sql;
    for (const t of ['kit_day', 'kit_user']) {
      if (sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t).toArray().length) sql.exec(`DELETE FROM ${t}`);
    }
  });
}

const cookie = (userId: string | null) => (userId ? `${SESSION_COOKIE}=${userId}` : '');

/** prefix '/flaky' 走 FlakyRoom（test/worker.ts）。 */
/** opts：开房时就定下的开局选项（0.4.0），放在请求体 { opts } 里 */
export async function createRoom(userId: string | null, prefix = '', opts?: unknown): Promise<Response> {
  return exports.default.fetch(`${SITE}${prefix}/rooms`, {
    method: 'POST',
    headers: { origin: SITE, cookie: cookie(userId) },
    ...(opts !== undefined ? { body: JSON.stringify({ opts }) } : {}),
  });
}

export async function openRoom(userId: string, prefix = '', opts?: unknown): Promise<string> {
  const res = await createRoom(userId, prefix, opts);
  if (res.status !== 201) throw new Error(`open room failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { code: string }).code;
}

export function upgrade(
  code: string,
  userId: string | null,
  opts: { origin?: string | null; cv?: number | string; headers?: Record<string, string>; prefix?: string; chat?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = { upgrade: 'websocket', cookie: cookie(userId), ...opts.headers };
  if (opts.origin !== null) headers.origin = opts.origin ?? SITE;
  return exports.default.fetch(`${SITE}${opts.prefix ?? ''}/rooms/${code}/ws?cv=${opts.cv ?? 1}${opts.chat ? '&chat=1' : ''}`, { headers });
}

/** 升级请求被接受后马上关掉的那种：返回关闭码。 */
export async function refusedWith(res: Response): Promise<number> {
  if (res.status !== 101 || !res.webSocket) throw new Error(`expected 101, got ${res.status}`);
  return new Conn(res.webSocket, 'refused').closedWith();
}

type Msg = DownMsg<ToyView> | EmotedMsg | ChattedMsg;

/** 一条测试连接：收到的消息排队，next/until 按顺序取。 */
export class Conn {
  readonly msgs: Msg[] = [];
  private read = 0;
  /** 已经消费到的最新 seq（welcome 或 state） */
  seq = -1;
  closed: { code: number; reason: string } | null = null;
  private wake: (() => void) | null = null;

  constructor(readonly ws: WebSocket, readonly userId: string) {
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string' && e.data !== 'pong') this.msgs.push(JSON.parse(e.data) as Msg);
      this.wake?.();
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake?.();
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** 收到过的最新 seq（真客户端收到就记，不管读没读） */
  latestSeq(): number {
    let max = -1;
    for (const m of this.msgs) if ((m.t === 'state' || m.t === 'welcome') && m.seq > max) max = m.seq;
    return max;
  }

  /** 出手：baseSeq 用收到过的最新 seq，和 RoomClient 一样。 */
  act(moveId: string, action: unknown, baseSeq = this.latestSeq()): void {
    this.send({ t: 'act', moveId, baseSeq, action });
  }

  /** 下一条消息（2 秒等不到就失败）。 */
  async next(): Promise<Msg> {
    const deadline = performance.now() + 2_000;
    while (this.read >= this.msgs.length) {
      if (this.closed) throw new Error(`closed ${this.closed.code} while waiting (${this.userId})`);
      if (performance.now() > deadline) throw new Error(`no message for ${this.userId}`);
      await new Promise<void>((ok) => {
        this.wake = ok;
        setTimeout(ok, 50);
      });
    }
    const m = this.msgs[this.read++]!;
    if ((m.t === 'state' || m.t === 'welcome') && m.seq > this.seq) this.seq = m.seq;
    return m;
  }

  async until(pred: (m: Msg) => boolean): Promise<Msg> {
    for (;;) {
      const m = await this.next();
      if (pred(m)) return m;
    }
  }

  /** 下一条比已经看过的更新的状态（广播到达各连接有先后，晚到的旧消息跳过）。 */
  async state(): Promise<StateMsg<ToyView>> {
    const seen = this.seq;
    return (await this.until((m) => m.t === 'state' && m.seq > seen)) as StateMsg<ToyView>;
  }

  /** 等到 seq ≥ min 的那条状态。 */
  async atLeast(min: number): Promise<StateMsg<ToyView>> {
    if (this.seq >= min) {
      const last = [...this.msgs.slice(0, this.read)].reverse().find((m) => m.t === 'state' && m.seq >= min);
      if (last) return last as StateMsg<ToyView>;
    }
    return (await this.until((m) => m.t === 'state' && m.seq >= min)) as StateMsg<ToyView>;
  }

  /** 等关闭（2 秒）。 */
  async closedWith(): Promise<number> {
    const deadline = performance.now() + 2_000;
    while (!this.closed) {
      if (performance.now() > deadline) throw new Error(`not closed (${this.userId})`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
    return this.closed.code;
  }

  /** 把已经收到的都标成读过。 */
  drain(): void {
    while (this.read < this.msgs.length) {
      const m = this.msgs[this.read++]!;
      if ((m.t === 'state' || m.t === 'welcome') && m.seq > this.seq) this.seq = m.seq;
    }
  }

  /** 读过的所有下行消息原文里有没有这个子串（查隐藏信息有没有漏）。 */
  rawIncludes(needle: string): boolean {
    return this.msgs.some((m) => JSON.stringify(m).includes(needle));
  }
}

export async function join(code: string, userId: string, prefix = '', chat = false): Promise<{ conn: Conn; welcome: WelcomeMsg<ToyView> }> {
  const res = await upgrade(code, userId, { prefix, chat });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const conn = new Conn(res.webSocket, userId);
  const welcome = (await conn.next()) as WelcomeMsg<ToyView>;
  if (welcome.t !== 'welcome') throw new Error(`expected welcome, got ${welcome.t}`);
  return { conn, welcome };
}

export function stub(code: string): DurableObjectStub<ToyRoom> {
  return roomStub(env.ROOM, code) as DurableObjectStub<ToyRoom>;
}

/** 房间里最近一步写了几行、存储里那一行的内容、存储占了多少、表在不在。 */
export function inspect(code: string) {
  return runInDurableObject(stub(code), (room: ToyRoom, state) => {
    const hasTable = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'kit_room'").one().n > 0;
    const row = hasTable ? state.storage.sql.exec<{ v: string }>('SELECT v FROM kit_room WHERE k = 1').toArray()[0] : undefined;
    return {
      last: room.lastStepWrites,
      max: room.maxStepWrites,
      total: room.totalWrites,
      persist: row ? JSON.parse(row.v) : null,
      hasTable,
      size: state.storage.sql.databaseSize,
      instanceId: room.instanceId,
    };
  });
}
