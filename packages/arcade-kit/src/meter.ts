/**
 * 每个游戏 Worker 一个的"计量"（Durable Object，全局只有一个实例，名字固定）：管住免费版每天 10 万行写入（docs/platform-backend.md 4.7）。
 * 同一个对象里放三样东西，一次 RPC 办完，比"每人一个小 DO + 一个计量"少一次请求、少写建表那几行：
 * - 当天（UTC）全站的写入行数：房间自己数写了几行，攒够一批（RoomLimits.meterBatch，默认 200）或者结束时报一次；
 * - 当天全站开了几个房间（最后一道闸）；
 * - 每个人现在开着的房间、当天开了几个（按人的开房额度）。
 *
 * 门槛（QuotaLimits，游戏在 wrangler.jsonc 的 vars.KIT_QUOTA 里改，不用改代码）：
 * - 写入到 busyWrites（默认 6 万）：不开新房、不进新人，在打的照常；
 * - 写入到 stopWrites（默认 8.5 万）：在打的房间在这一段结束（RoomGame.breakPoint）时体面收场；
 * - 开房先过按人额度，再过全站额度。
 *
 * 写入：开房（占额度）写 2 行（这个人那一行、当天那一行），报一次写 1 行，结束（还额度加最后一报）写 2 行；计量自己写的也记进当天的数。
 * 自愈：每个开着的房间记一个"最晚到什么时候"（开房时间 + 房间寿命 + 1 分钟）。房间关的时候来还额度，
 * 还不上（计量连不上、房间被驱逐时出错）就等到点自动作废，不会把人永远卡在"你已经有一个房间了"。
 * 当天的数在 UTC 0 点后的第一次调用时清零（和免费版额度重置的时间一样）；房间跨天报上来的写入记在新的一天，偏保守。
 *
 * 这里的方法只给 kit 自己调（房间经 RPC），游戏不直接用；kitUsage 给运维和测试看。
 */
import { DurableObject } from 'cloudflare:workers';
import { METER_NAME, meterStub } from './internal.js';
import { kitStoreOf, MirrorStore } from './store.js';

export interface QuotaLimits {
  /** 每人同时开着的房间数（自己开的，打完、关掉、到寿命就还） */
  roomsPerUser: number;
  /** 每人每天（UTC）最多开几个房间 */
  dailyRoomsPerUser: number;
  /** 全站每天（UTC）最多开几个房间 */
  dailyRooms: number;
  /** 当天写入到这么多行：不开新房、不进新人 */
  busyWrites: number;
  /** 当天写入到这么多行：在打的房间这一段打完收场 */
  stopWrites: number;
  /**
   * 进房猜码（0.14.0，第三轮审计）：每个人每小时最多几次"房间码不存在"、每个 IP 每小时最多几次。超了这一小时里进任何房间都回 1013，
   * 存在的房间也一样（不然 1013 和 welcome 的差别照样说出房间在不在）。房间码只有 6 位，不限就能一个个试出谁开着房
   */
  joinMissesPerUser: number;
  joinMissesPerIp: number;
}

export const DEFAULT_QUOTA: QuotaLimits = {
  roomsPerUser: 1,
  dailyRoomsPerUser: 6,
  dailyRooms: 300,
  busyWrites: 60_000,
  stopWrites: 85_000,
  // 正常人输错码一小时也就几次；一个 IP 后面可能是一家人、一个宿舍，放宽一些
  joinMissesPerUser: 20,
  joinMissesPerIp: 60,
};

/** KIT_QUOTA 里由房间读的字段（0.7.0）：emoteMs 每多少毫秒补一个短语令牌（0 不限速），emoteBurst 最多攒几个 */
export const ROOM_QUOTA_FIELDS: readonly string[] = ['emoteMs', 'emoteBurst'];

/** 计量的绑定名和环境变量名固定（和 ROOM、ARCADE 一样）。 */
export interface MeterEnv {
  METER?: DurableObjectNamespace;
  /** 部分覆盖 DEFAULT_QUOTA，比如 { "dailyRooms": 500 }；wrangler.jsonc 的 vars 里写对象，或者写成 JSON 字符串 */
  KIT_QUOTA?: (Partial<QuotaLimits> & { emoteMs?: number; emoteBurst?: number }) | string;
}

/** ok 照常；busy 不开新房、不进新人；stop 在打的这一段打完收场。 */
export type MeterLevel = 'ok' | 'busy' | 'stop';

export type Reserve = { ok: true } | { ok: false; error: 'has_room'; code: string } | { ok: false; error: 'daily_limit' | 'busy' };

/** 几个人一起占（0.20.0）：被挡时 userId 是第一个被挡的人；全站忙（busy）不是哪一个人的事，userId 为 null */
export type ReserveMany =
  | { ok: true }
  | { ok: false; userId: string; error: 'has_room'; code: string }
  | { ok: false; userId: string; error: 'daily_limit' }
  | { ok: false; userId: null; error: 'busy' };

/** kitPeek 的结果（0.20.0）：room 是这个人开着的房间码，daily 是今天的开房次数用完了 */
export interface Peek {
  room: string | null;
  daily: boolean;
  level: MeterLevel;
}

export interface Usage {
  day: string;
  writes: number;
  rooms: number;
  level: MeterLevel;
  limits: QuotaLimits;
}

interface UserRow {
  day: string;
  /** 当天开了几个 */
  count: number;
  /** 开着的房间，until 之后自动作废 */
  live: { code: string; until: number }[];
}

/** PG 模式里 miss 那个 KV 记在哪张"表"（0.21.0，宿主那边按 (game, ns, name, table, key) 存） */
const KV_TABLE = 'kv';

function missCount(r: { h: number; n: number } | null, h: number): number {
  return r && r.h === h ? r.n : 0;
}

function parseJson<T>(v: string | null): T | undefined {
  if (v === null) return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

/** 房间寿命之外多留一分钟：房间到寿命那一刻的闹钟、关房、还额度都在这之前做完。 */
const EXPIRY_SLACK_MS = 60_000;

export class RoomMeter extends DurableObject<MeterEnv> {
  private ready = false;
  private limitsCache: QuotaLimits | null = null;
  /**
   * 自托管 PG 模式（0.21.0，env 里有 KIT_STORE）的内存镜像：kit_day、kit_user 两张表和进房猜码的 miss 都打镜像，
   * 每次调用末尾一次事务提交（miss 原来是 KV 的 get、put 中间隔着 await，镜像里同步读改写，顺手没了丢更新的窗口）。
   * 没有 KIT_STORE 时为 null，照旧用 ctx.storage.sql 和 KV，行为不变
   */
  private readonly pg: MirrorStore | null;

  constructor(ctx: DurableObjectState, env: MeterEnv) {
    super(ctx, env);
    const rpc = kitStoreOf(env);
    this.pg = rpc ? new MirrorStore(rpc, 'meter') : null;
  }

  /**
   * 一次调用：PG 模式先把这个实例读进镜像，同步做完，再提交（提交失败往外抛，房间当计量连不上）；
   * 默认模式直接跑（fn 是同步的，和原来写在 async 方法里一样）。name 是 idFromName 用的名字（全站那一个，或 kit-miss:<key>）
   */
  private async run<T>(name: string, fn: () => T): Promise<T> {
    const pg = this.pg;
    if (!pg) return fn();
    await pg.open(name);
    const out = fn();
    await pg.flush(null);
    return out;
  }

  /** 进程重启后宿主唤醒（0.21.0）：计量没有闹钟，只把镜像读进来；幂等。没有 KIT_STORE 时什么都不做 */
  async kitWake(name: string): Promise<void> {
    if (this.pg) await this.pg.open(name);
  }

  /** 开房前占一个名额（房间调）。房间没建成要调 kitRelease(…, cancel) 退回。 */
  async kitReserve(userId: string, code: string, until: number): Promise<Reserve> {
    const r = await this.kitReserveMany([userId], code, until);
    return r.ok ? r : r.error === 'has_room' ? { ok: false, error: 'has_room', code: r.code } : { ok: false, error: r.error };
  }

  /**
   * 一张桌给几个人一起占名额（0.20.0，快速匹配）：要么都占上，要么一个都不占，占不上的回第一个被挡的人。
   * 全站开房数只记 1（一张桌一个房间）。一次写 1 + 人数 行（每人那一行加当天那一行），写在计量里、记进当天的数，不算房间的"每步 ≤ 2 行"
   */
  async kitReserveMany(userIds: readonly string[], code: string, until: number): Promise<ReserveMany> {
    return this.run(METER_NAME, () => {
      const now = Date.now();
      const lim = this.limits();
      const day = this.day(now);
      const users = userIds.map((id) => ({ id, row: this.user(id, day.day, now) }));
      // 先说"回你的房间"：在打的房间不受全站门槛影响，回去照样能玩
      for (const { id, row } of users) if (row.live.length >= lim.roomsPerUser) return { ok: false, userId: id, error: 'has_room', code: row.live[row.live.length - 1]!.code };
      for (const { id, row } of users) if (row.count >= lim.dailyRoomsPerUser) return { ok: false, userId: id, error: 'daily_limit' };
      if (levelOf(day.writes, lim) !== 'ok' || day.rooms >= lim.dailyRooms) return { ok: false, userId: null, error: 'busy' };
      let w = 0;
      for (const { id, row } of users) {
        row.count++;
        row.live.push({ code, until: until + EXPIRY_SLACK_MS });
        w += this.saveUser(id, row);
      }
      this.saveDay(day.day, day.writes + w + 1, day.rooms + 1);
      return { ok: true };
    });
  }

  /**
   * 房间结束（打完、关掉）时还名额，顺便报最后一批写入（writes 可以是 0）。cancel：房间没建成，开房次数也退回。
   * 名额已经不在（还过一次、或者已经到点作废）就只记写入，可以重复调。
   */
  async kitRelease(userId: string, code: string, writes: number, cancel = false): Promise<MeterLevel> {
    return this.kitReleaseMany([userId], code, writes, cancel);
  }

  /**
   * 一张桌的几个人一起还（0.20.0）。cancel：开房次数也退回；room：全站开房数也退 1（默认跟着 cancel：整桌没建成）。
   * 匹配桌开打时没来的人（0.20.0）是 cancel 但不退全站数：桌子开成了，只是他的那一份退给他
   */
  async kitReleaseMany(userIds: readonly string[], code: string, writes: number, cancel = false, room = cancel): Promise<MeterLevel> {
    return this.run(METER_NAME, () => {
      const now = Date.now();
      const day = this.day(now);
      let w = 0;
      let found = false;
      for (const id of userIds) {
        const user = this.user(id, day.day, now);
        const i = user.live.findIndex((r) => r.code === code);
        if (i < 0) continue;
        found = true;
        user.live.splice(i, 1);
        if (cancel && user.count > 0) user.count--;
        w += this.saveUser(id, user);
      }
      const rooms = room && found ? Math.max(0, day.rooms - 1) : day.rooms;
      const total = day.writes + clean(writes) + w + 1;
      this.saveDay(day.day, total, rooms);
      return levelOf(total, this.limits());
    });
  }

  /**
   * 只读（0.20.0，快速匹配入队前问）：这个人现在开着的房间（没有为 null）、今天的开房次数用完没有、全站的门槛。
   * 入队前就挡掉"有房间""今天用完了""联机忙"的人，不让他们白等 15 秒
   */
  async kitPeek(userId: string): Promise<Peek> {
    return this.run(METER_NAME, () => {
      const now = Date.now();
      const lim = this.limits();
      const day = this.day(now);
      const user = this.user(userId, day.day, now);
      const lv = levelOf(day.writes, lim);
      // 全站开房数到了也开不了新桌，对排队的人和"联机忙"一样
      const level = lv === 'ok' && day.rooms >= lim.dailyRooms ? 'busy' : lv;
      return {
        room: user.live.length >= lim.roomsPerUser ? user.live[user.live.length - 1]!.code : null,
        daily: user.count >= lim.dailyRoomsPerUser,
        level,
      };
    });
  }

  /** 报一批写入（房间攒够一批时调），回现在的门槛。 */
  async kitReport(writes: number): Promise<MeterLevel> {
    return this.run(METER_NAME, () => {
      const day = this.day(Date.now());
      const total = day.writes + clean(writes) + 1;
      this.saveDay(day.day, total, day.rooms);
      return levelOf(total, this.limits());
    });
  }

  /** 只读：现在的门槛（房间放新人进来之前问，不写库）。 */
  async kitLevel(): Promise<MeterLevel> {
    return this.run(METER_NAME, () => {
      return levelOf(this.day(Date.now()).writes, this.limits());
    });
  }

  /**
   * 进房猜码（0.14.0）：这两个方法用在 missStub 按人、按 IP 取的小实例上（不是全站那一个），不碰 SQL 表，只存一个 { 第几个小时, 几次 }。
   * kitMissBlocked 只读，进房前问（门槛在这里按 KIT_QUOTA 算，worker.ts 不用在运行时引用本文件：它要能在普通 Node 里加载）；
   * kitMiss 记一次（1 行），只有真的进了一个不存在的房间才调，超了门槛的人进不到这一步，所以一小时最多写门槛那么多行
   */
  async kitMissBlocked(kind: 'user' | 'ip', key?: string): Promise<boolean> {
    const lim = this.limits();
    return (await this.kitMisses(key)) >= (kind === 'user' ? lim.joinMissesPerUser : lim.joinMissesPerIp);
  }

  /**
   * 只读：这一小时记了几次（给测试看）。key（0.21.0）是 missStub 用的那个（u:<userId>、ip:<地址>）：
   * PG 模式靠它找到 PG 里这个小实例的行（kit-miss:<key>）；默认模式不看它
   */
  async kitMisses(key?: string): Promise<number> {
    if (this.pg) return this.run(`kit-miss:${key ?? ''}`, () => missCount(this.pgMiss(), hourOf(Date.now())));
    const r = await this.ctx.storage.get<{ h: number; n: number }>('miss');
    return r && r.h === hourOf(Date.now()) ? r.n : 0;
  }

  async kitMiss(key?: string): Promise<number> {
    const h = hourOf(Date.now());
    if (this.pg) {
      return this.run(`kit-miss:${key ?? ''}`, () => {
        const n = missCount(this.pgMiss(), h) + 1;
        this.pg!.put(KV_TABLE, 'miss', JSON.stringify({ h, n }));
        return n;
      });
    }
    const r = await this.ctx.storage.get<{ h: number; n: number }>('miss');
    const n = (r && r.h === h ? r.n : 0) + 1;
    await this.ctx.storage.put('miss', { h, n });
    return n;
  }

  /** PG 模式镜像里的 miss（存成 JSON） */
  private pgMiss(): { h: number; n: number } | null {
    const v = this.pg!.get(KV_TABLE, 'miss');
    if (v === null) return null;
    try {
      return JSON.parse(v) as { h: number; n: number };
    } catch {
      return null;
    }
  }

  /** 只读：当天的数，给运维和测试看。 */
  async kitUsage(): Promise<Usage> {
    return this.run(METER_NAME, () => {
      const day = this.day(Date.now());
      const limits = this.limits();
      return { day: day.day, writes: day.writes, rooms: day.rooms, level: levelOf(day.writes, limits), limits };
    });
  }

  // ---------- 存储 ----------

  private ensure(): void {
    if (this.ready || this.pg) return;
    const sql = this.ctx.storage.sql;
    // 建表只有第一次真的写（之后 IF NOT EXISTS 什么都不做）；建表那几行记不进当天的数，一个游戏一生只有一次
    sql.exec('CREATE TABLE IF NOT EXISTS kit_day (k INTEGER PRIMARY KEY, day TEXT NOT NULL, writes INTEGER NOT NULL, rooms INTEGER NOT NULL)');
    // WITHOUT ROWID：按 userId 存一棵树，改一个人只写 1 行（普通表还要多写一份索引）
    sql.exec('CREATE TABLE IF NOT EXISTS kit_user (id TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID');
    this.ready = true;
  }

  /** 当天那一行；过了 UTC 0 点就是新的一天，从 0 算（不先写，下次保存时一起写）。 */
  private day(now: number): { day: string; writes: number; rooms: number } {
    this.ensure();
    const today = utcDay(now);
    const row = this.pg
      ? parseJson<{ day: string; writes: number; rooms: number }>(this.pg.get('kit_day', 1))
      : this.ctx.storage.sql.exec<{ day: string; writes: number; rooms: number }>('SELECT day, writes, rooms FROM kit_day WHERE k = 1').toArray()[0];
    return row && row.day === today ? row : { day: today, writes: 0, rooms: 0 };
  }

  private saveDay(day: string, writes: number, rooms: number): void {
    if (this.pg) return void this.pg.put('kit_day', 1, JSON.stringify({ day, writes, rooms }));
    this.ctx.storage.sql.exec(
      'INSERT INTO kit_day (k, day, writes, rooms) VALUES (1, ?, ?, ?) ON CONFLICT (k) DO UPDATE SET day = excluded.day, writes = excluded.writes, rooms = excluded.rooms',
      day,
      writes,
      rooms,
    );
  }

  /** 这个人那一行：换了一天开房次数清零，到点的房间作废（只在内存里，下次保存时才写）。 */
  private user(userId: string, today: string, now: number): UserRow {
    const raw = this.pg
      ? (((v) => (v === null ? undefined : { v }))(this.pg.get('kit_user', userId)))
      : this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM kit_user WHERE id = ?', userId).toArray()[0];
    let row: UserRow = { day: today, count: 0, live: [] };
    if (raw) {
      try {
        row = JSON.parse(raw.v) as UserRow;
      } catch {
        console.error('meter user row unreadable', userId);
      }
    }
    return { day: today, count: row.day === today ? row.count : 0, live: row.live.filter((r) => r.until > now) };
  }

  /** 存这个人那一行，返回写了几行。没有开着的房间、当天也没开过的，删掉这一行，不留着占地方。 */
  private saveUser(userId: string, row: UserRow): number {
    if (this.pg) return row.live.length === 0 && row.count === 0 ? this.pg.delete('kit_user', userId) : this.pg.put('kit_user', userId, JSON.stringify(row));
    const sql = this.ctx.storage.sql;
    if (row.live.length === 0 && row.count === 0) return sql.exec('DELETE FROM kit_user WHERE id = ?', userId).rowsWritten;
    return sql.exec('INSERT INTO kit_user (id, v) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET v = excluded.v', userId, JSON.stringify(row)).rowsWritten;
  }

  /** 门槛按调用时的环境变量算；配错的字段记日志、用默认值（不让一个手误把额度放开或关死）。 */
  private limits(): QuotaLimits {
    if (this.limitsCache) return this.limitsCache;
    this.limitsCache = parseQuota(this.env.KIT_QUOTA);
    return this.limitsCache;
  }
}

/**
 * 房间以外的 DO（比如游戏自己的钱包）把写了几行记进当天的数，回现在的门槛（0.3.0）。
 * 计量每收一次报数自己写 1 行，所以只适合写得少的地方（钱包一次操作报一次，就是每次多 1 行）；房间自己会攒一批再报，不用它。
 * 没绑 METER 时什么都不做、回 ok（和房间一样，只为平滑升级）。连不上时抛错，调用方决定怎么办
 */
export async function meterReport(env: MeterEnv, writes: number): Promise<MeterLevel> {
  if (!env.METER) return 'ok';
  return (meterStub(env.METER) as DurableObjectStub<RoomMeter>).kitReport(writes);
}

/** 只读：现在的门槛（0.3.0；写之前问一下，stop 时就别写了）。没绑 METER 回 ok，连不上抛错。 */
export async function meterLevel(env: MeterEnv): Promise<MeterLevel> {
  if (!env.METER) return 'ok';
  return (meterStub(env.METER) as DurableObjectStub<RoomMeter>).kitLevel();
}

/** 解析 KIT_QUOTA：对象或 JSON 字符串，只认 DEFAULT_QUOTA 里有的字段、非负整数；别的记日志后忽略。 */
export function parseQuota(raw: unknown): QuotaLimits {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      console.error('KIT_QUOTA is not JSON, using defaults');
      v = null;
    }
  }
  const out: QuotaLimits = { ...DEFAULT_QUOTA };
  if (v === undefined || v === null) return out;
  if (typeof v !== 'object' || Array.isArray(v)) {
    console.error('KIT_QUOTA is not an object, using defaults');
    return out;
  }
  for (const [k, n] of Object.entries(v)) {
    // 房间自己读的字段（0.7.0：快捷短语的节奏），计量不管
    if (ROOM_QUOTA_FIELDS.includes(k)) continue;
    if (!(k in DEFAULT_QUOTA)) console.error('KIT_QUOTA unknown field', k);
    else if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) console.error('KIT_QUOTA bad value for', k);
    else out[k as keyof QuotaLimits] = n;
  }
  if (out.stopWrites < out.busyWrites) console.error('KIT_QUOTA stopWrites is below busyWrites');
  return out;
}

export function levelOf(writes: number, lim: QuotaLimits): MeterLevel {
  if (writes >= lim.stopWrites) return 'stop';
  if (writes >= lim.busyWrites) return 'busy';
  return 'ok';
}

function hourOf(now: number): number {
  return Math.floor(now / 3_600_000);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** 房间报上来的行数：只认非负整数（RPC 那头是自己人，这里防的是自己算错） */
function clean(n: number): number {
  return Number.isInteger(n) && n > 0 ? n : 0;
}
