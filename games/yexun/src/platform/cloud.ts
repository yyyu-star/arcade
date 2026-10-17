import { fresh, mergeSave, reviveSave, savePayload, type Save } from './save.ts';

/** 本地存储的最小接口（localStorage 满足；测试里换成内存假的） */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 同步槽只有 profile 一个：教程标记（tips）本来就在存档里、随 savePayload 上云，不单独开槽
 * （DESIGN 5.5 的"教程标记"并进 profile；"不再提示"tipsOff 是本机偏好，不同步）。
 */
export type SlotName = 'profile';

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * keepalive 记账：浏览器给一个页面所有在途的 keepalive 请求合计只留 64 KB 请求体，超了那一个直接发不出去。
 * 发之前看还剩多少，发出去时记上、回来了还回去。
 */
const KEEPALIVE_BYTES = 60 * 1024;
let kaUsed = 0;
const keepaliveLeft = (): number => KEEPALIVE_BYTES - kaUsed;
function keepaliveSend<T>(body: string, send: () => Promise<T>): Promise<T> {
  const n = new TextEncoder().encode(body).length;
  kaUsed += n;
  let p: Promise<T>;
  try {
    p = send();
  } catch (e) {
    kaUsed -= n;
    throw e;
  }
  return p.finally(() => {
    kaUsed -= n;
  });
}
/** 测试用：清掉没回来的请求留下的账 */
export function resetKeepalive(): void {
  kaUsed = 0;
}

/**
 * 云存档：把局外成长存档（profile 槽，含教程标记）同步到平台（docs/platform-backend.md 5.5、15.3）。打到一半的那一局和设置不同步。
 *
 * - 只在有提示 cookie __Host-arcade_li 时才调接口；先 GET /api/me（存档接口不续 last_seen，只玩开盘的人靠这一下才不会被当成一年没来），
 *   再 GET /api/saves/yexun 一次取回所有槽，和本地合并。
 * - 本地改了先记"待上传"，静下来 10 秒再 PUT（一直在改也最多等 60 秒）；切到后台时用 keepalive 补传一个槽。
 * - 冲突（409）由游戏自己合并：集合取并集、计数取较大（各槽的 merge）；合并会改本地时，先把本地备份到 yexun.<槽>.pre-sync。
 * - 换了账号：本地数据是上一个账号的，不带给新账号。一认出来就先把本地存到 yexun.<槽>.pre-switch.<旧 userId>、清成空档、
 *   元数据存盘，然后才去拉新账号的；中途断了（连不上、401、关页面），下次打开也不会把旧账号的东西当成首次同步。
 *   旧账号以后在这台设备上登录回来，存着的那份并回去（并完改名为 .restored，不再并第二次）。
 * - 页面开着时别的标签页可能换了账号：切回前台、上传前（距上次确认超过 1 分钟）、收到 409 时都重新问 /api/me，换了就从头来。
 * - 多个标签页共用 localStorage：别的页存了元数据（storage 事件）就并进来，它传完的槽本页不再重复传。
 * - 元数据在 yexun.cloud：{userId, rev（按槽）, dirty（待上传的槽）}。
 * 不依赖 DOM：fetch、计时器、cookie 判断都从外面传进来，测试里换成假的。
 */

/** 一个同步槽：怎么读写本地、怎么认云端的数据、怎么合并、上传什么。 */
export interface SlotDef<T = unknown> {
  name: SlotName;
  /** 本地没有时为 null */
  read(store: KeyValueStore | null): T | null;
  write(store: KeyValueStore | null, v: T): void;
  /** 云端（不可信）的数据 → 本地格式；读不懂为 null */
  revive(raw: unknown): T | null;
  merge(local: T, cloud: T): T;
  /** 上传的内容：去掉只在本机有意义的字段，控制大小 */
  payload(v: T): unknown;
  empty(): T;
}

export type CloudState = 'out' | 'synced' | 'syncing' | 'pending' | 'merged';
export interface CloudView {
  state: CloudState;
  /** 待上传时的原因（平台忙、连不上、太大），给悬停说明用 */
  note: string | null;
}

export interface CloudDeps {
  store: KeyValueStore | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  slots: readonly SlotDef[];
  hasLoginHint(): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** 状态变了（画面刷新云朵） */
  onChange?(v: CloudView): void;
  /** 云端的数据写进了本地（画面要按新档案重画） */
  onApplied?(): void;
}

export const META_KEY = 'yexun.cloud';
export const preSyncKey = (slot: string): string => `yexun.${slot}.pre-sync`;
export const preSwitchKey = (slot: string, userId: string): string => `yexun.${slot}.pre-switch.${userId}`;
export const DEBOUNCE_MS = 10_000;
export const MAX_WAIT_MS = 60_000;
/** 重新确认"还是不是这个账号"的最小间隔 */
export const RECHECK_MS = 60_000;
/** 强制确认的节流：几秒内刚问过 /api/me 就只核对磁盘，不再问（账号不一致期间每次本地改动都会触发） */
export const FORCE_GAP_MS = 5_000;
/** 切到后台补传的最小间隔：手机上每局都切出去的人，不至于很快用完每天 100 次 */
export const HIDDEN_GAP_MS = 3 * 60_000;
/** 每槽 data ≤ 48 KB（平台的上限，5.5） */
const SLOT_BYTES = 48 * 1024;
/** 一次打开最多 PUT 几次：平台每人每天 100 次，正常玩一局只有几次，这里兜住失控的循环 */
export const SESSION_PUTS = 40;
const API = '/api/saves/yexun';

export const NOTE = {
  paused: '服务器今天有点忙，进度先存在本机，明早恢复后自动传',
  offline: '连不上平台，进度先存在本机，下次再传',
  tooLarge: '云存档空间满了，进度先存在本机；删掉不用的存档再试',
  merged: '和别的设备上的进度合在一起了',
  storage: '这台设备的存储满了，云存档先停一停',
} as const;

interface Meta {
  v: 1;
  userId: string | null;
  rev: Record<string, number>;
  dirty: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** 键排好序的 JSON：比较"内容一样不一样"用 */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function getJson(store: KeyValueStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** 写成功（读回来一致）返回 true；存储不可用、配额满了返回 false。 */
function setRaw(store: KeyValueStore | null, key: string, value: string | null): boolean {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
    return store !== null && store.getItem(key) === value;
  } catch {
    return false;
  }
}

/** 备份、写本地失败（配额满了）：这一轮不再动本地和元数据，免得备份没存上就把本地清掉、或者 rev 记成云端的而本地没合进去 */
class StorageFull extends Error {}

export function loadMeta(store: KeyValueStore | null): Meta {
  const m = getJson(store, META_KEY);
  const meta: Meta = { v: 1, userId: null, rev: {}, dirty: [] };
  if (!isObj(m)) return meta;
  if (typeof m.userId === 'string') meta.userId = m.userId;
  if (isObj(m.rev)) for (const [k, v] of Object.entries(m.rev)) if (Number.isSafeInteger(v) && (v as number) >= 0) meta.rev[k] = v as number;
  if (Array.isArray(m.dirty)) meta.dirty = [...new Set(m.dirty.filter((x): x is string => typeof x === 'string'))];
  return meta;
}

interface Res {
  /** 0 = 连不上 */
  status: number;
  body: Record<string, unknown> | null;
}

/** /api/me 的结论：登录的 userId；null = 平台明确说没登录；'fail' = 没问到（连不上、停服、暂停档等，原因已记下） */
type Who = string | null | 'fail';

export class Cloud {
  private meta: Meta;
  /** 这次打开里确认过的账号 */
  private user: string | null = null;
  private meAt = -Infinity;
  /** 上次问 /api/me 的时间和有没有问到（强制确认的节流用，问失败了也算问过） */
  private askAt = -Infinity;
  private askOk = false;
  private stopped: 'out' | 'paused' | null = null;
  private note: string | null = null;
  private starting = false;
  private started = false;
  private applying = false;
  private merged = false;
  private puts = 0;
  private hiddenAt = -Infinity;
  /** 上次 start 的时间：没连上、未登录的页，回到前台或本地改了时隔 1 分钟以上再试 */
  private startAt = -Infinity;
  /** start 进行中又发现要从头来：这一轮结束后再来一次 */
  private again = false;
  /** 正在问 /api/me 的那次确认（同时来的确认合成一次） */
  private checking: Promise<boolean> | null = null;
  /** 正在上传的槽 → 是不是 keepalive（keepalive 的页面关了也能发完，普通的会被浏览器取消） */
  private readonly inflight = new Map<string, boolean>();
  /** 普通请求在途、离开时又补发了一份 keepalive 的槽（补的那份还没回来）：再点一次「大厅」不再补 */
  private readonly dups = new Set<string>();
  private readonly tooLarge = new Set<string>();
  private readonly timers = new Map<string, { id: unknown; first: number }>();
  /** 429 之后每个槽最早什么时候能再传（之后的改动不能把它提前） */
  private readonly retryAt = new Map<string, number>();
  /** 本地改动计数：上传途中又改了，传完仍算待上传 */
  private readonly gen = new Map<string, number>();
  private readonly d: CloudDeps;

  constructor(deps: CloudDeps) {
    this.d = deps;
    this.meta = loadMeta(deps.store);
  }

  get view(): CloudView {
    if (this.stopped === 'out') return { state: 'out', note: null };
    if (this.starting || this.inflight.size > 0) return { state: 'syncing', note: null };
    const note = this.note ?? (this.stopped === 'paused' ? NOTE.paused : null);
    // 还没开始（没调 start）算未登录；开始了但没问到平台，算待上传（不叫人去登录：只有平台明确说没登录才是未登录）
    if (!this.started && !note) return { state: 'out', note: null };
    if (!this.started || this.meta.dirty.length > 0) return { state: 'pending', note };
    if (this.merged) return { state: 'merged', note: NOTE.merged };
    return { state: 'synced', note: null };
  }

  /** 打开游戏时调一次；发现换了账号时也从这里重来。 */
  async start(): Promise<void> {
    this.startAt = this.d.now();
    if (!this.d.hasLoginHint()) return this.stop('out');
    this.started = false;
    this.stopped = null;
    this.note = null;
    this.starting = true;
    this.changed();
    try {
      const id = await this.whoami();
      if (id === 'fail') return;
      if (id === null) return this.stop('out');
      // 以磁盘上的为准：别的标签页可能已经换过账号
      this.meta = loadMeta(this.d.store);
      if (this.meta.userId !== id) this.switchUser(id);
      this.restoreSwitched(id);
      this.user = id;
      // 带上刚确认的账号（平台 0.7.3）：这中间 cookie 换成别人的话回 409 wrong_user、不给数据，按换号从头来
      const res = await this.call('GET', `${API}?userId=${encodeURIComponent(id)}`);
      // 回包慢的时候别的标签页可能已经换成别的账号、把它的进度写进了本地：先核对磁盘，再合并（和下面的合并在同一段同步代码里）
      if ((res.status === 409 && res.body?.error === 'wrong_user') || loadMeta(this.d.store).userId !== id) {
        this.restart();
        return;
      }
      if (res.status !== 200 || !res.body || !Array.isArray(res.body.saves)) return this.fail(res);
      const entries = new Map<string, Record<string, unknown>>();
      for (const s of res.body.saves) if (isObj(s) && typeof s.slot === 'string') entries.set(s.slot, s);
      let applied = false;
      for (const slot of this.d.slots) applied = this.reconcile(slot, entries.get(slot.name) ?? null) || applied;
      if (applied) this.d.onApplied?.();
      if (!this.saveMeta()) return;
      this.started = true;
    } catch (e) {
      if (!(e instanceof StorageFull)) throw e;
      this.note = NOTE.storage;
      this.stop('paused');
    } finally {
      this.starting = false;
      this.changed();
      if (this.again) {
        this.again = false;
        void this.start();
      }
    }
    if (!this.started) return;
    for (const slot of this.d.slots) await this.flush(slot.name);
  }

  /** 本地的某个槽改了（localChange.touched 转过来）。 */
  touch(name: SlotName): void {
    if (this.applying) return;
    this.gen.set(name, (this.gen.get(name) ?? 0) + 1);
    this.merged = false;
    this.setDirty(name, true);
    this.saveMeta();
    this.changed();
    if (!this.started || this.stopped) return this.retryStart();
    const t = this.timers.get(name);
    const now = this.d.now();
    const first = t?.first ?? now;
    if (t) this.d.clearTimer(t.id);
    const wait = Math.max(Math.min(DEBOUNCE_MS, first + MAX_WAIT_MS - now), (this.retryAt.get(name) ?? 0) - now, 0);
    this.timers.set(name, { id: this.d.setTimer(() => void this.flush(name), wait), first });
  }

  /**
   * 切到后台：只补传一个槽（最该保的排在前面），用 keepalive，页面关了也能发出去；两次之间至少隔 3 分钟。
   * leaving：玩家点了"大厅"马上要离开这一页，不管隔多久，所有待上传的槽都补传；紧接着离开页面时的 visibilitychange
   * 会被 3 分钟间隔挡掉，不重复传。
   */
  hidden(leaving = false): void {
    const now = this.d.now();
    if (!leaving && now - this.hiddenAt < HIDDEN_GAP_MS) return;
    if (!this.started || this.stopped) return;
    const dirty = this.d.slots.map((s) => s.name).filter((n) => this.meta.dirty.includes(n));
    if (!leaving) {
      const name = dirty.find((n) => !this.inflight.has(n));
      if (!name) return;
      this.hiddenAt = now;
      void this.flush(name, true);
      return;
    }
    // 要离开了：待上传的槽都补传（档案排前面），连同已经在途的 keepalive（比如交分）合起来不超过 64 KB 的上限（上面的 keepalive 记账）。
    // 已经有 keepalive 在途的不用管；普通请求在途的，页面一走就会被取消，再补一个 keepalive（补过的不再补）
    const left = dirty.filter((n) => this.inflight.get(n) !== true && !this.dups.has(n));
    if (left.length === 0) return;
    this.hiddenAt = now;
    for (const n of left) void this.flush(n, true, 0, true);
  }

  /** 切回前台：别的标签页可能换了账号，隔 1 分钟以上就重新确认一次。 */
  visible(): void {
    if (!this.started || this.stopped) return this.retryStart();
    if (this.d.now() - this.meAt >= RECHECK_MS) void this.sameUser();
  }

  /** 没连上、未登录、暂停着的页：隔 1 分钟以上再从头试一次（不然这次打开就再也不同步了）。 */
  private retryStart(): void {
    if (!this.starting && this.d.now() - this.startAt >= RECHECK_MS) void this.start();
  }

  /** 别的标签页存了元数据（storage 事件）：换了账号就从头来；它传完的槽，本页记下新 rev、不再算待上传。 */
  absorb(): void {
    const disk = loadMeta(this.d.store);
    if (disk.userId !== this.meta.userId) {
      // 本页确认过账号：重新确认；还没确认过（没启动、未登录）：跟着磁盘的走，以后存元数据也不会把它改回去
      if (this.user !== null) void this.sameUser(true);
      else this.meta = disk;
      return;
    }
    let advanced = false;
    for (const [slot, rev] of Object.entries(disk.rev)) {
      if (rev <= (this.meta.rev[slot] ?? 0)) continue;
      this.meta.rev[slot] = rev;
      if (!disk.dirty.includes(slot)) this.setDirty(slot, false);
      advanced = true;
    }
    if (advanced) {
      this.d.onApplied?.();
      this.changed();
    }
  }

  /** leaving：马上要离开这一页，普通请求在途的槽也再补一个 keepalive */
  private async flush(name: string, keepalive = false, depth = 0, leaving = false): Promise<void> {
    const dropTimer = (): void => {
      const t = this.timers.get(name);
      if (t) this.d.clearTimer(t.id);
      this.timers.delete(name);
    };
    // 普通上传：就是定时器到点了（或者要马上传），先清掉。keepalive 补传真发出去了才清：
    // 发不成（额度不够、429 还在等）的话，原来排好的普通上传照旧，页面没走成也传得上
    if (!keepalive) dropTimer();
    const busy = this.inflight.get(name);
    if (!this.started || this.stopped || this.tooLarge.has(name) || busy === true || (busy === false && (!leaving || this.dups.has(name)))) return;
    if (!this.meta.dirty.includes(name) || this.puts >= SESSION_PUTS) return;
    const wait = (this.retryAt.get(name) ?? 0) - this.d.now();
    if (wait > 0) {
      // 429 之后切后台补传也不能抢跑
      if (!keepalive) this.timers.set(name, { id: this.d.setTimer(() => void this.flush(name), wait), first: this.d.now() });
      return;
    }
    // 磁盘上的元数据已经是别的账号（别的标签页换过）：本地数据不是这个账号的了，不传
    // （核对和下面读本地数据在同一段同步代码里；跨标签页仍不是原子的，见 saveMeta 的说明）
    if (this.user === null) return;
    if (loadMeta(this.d.store).userId !== this.user) {
      if (!keepalive) void this.sameUser(true);
      return;
    }
    // 上传前确认还是这个账号（距上次超过 1 分钟才问；切后台的那一下来不及问，靠切回前台时问过）
    if (!keepalive && this.d.now() - this.meAt >= RECHECK_MS && !(await this.sameUser())) return;
    const slot = this.slot(name);
    const local = slot?.read(this.d.store);
    if (!slot || !local) {
      this.setDirty(name, false);
      this.saveMeta();
      return;
    }
    const data = JSON.stringify(slot.payload(local));
    if (bytes(data) > SLOT_BYTES) {
      this.tooLarge.add(name);
      this.note = NOTE.tooLarge;
      return this.changed();
    }
    // userId 是最近一次 /api/me 确认的账号：平台（0.7.1 起）发现和会话里的不是同一个人就回 409 wrong_user、不写库，
    // 堵住"刚确认完、别的标签页又换了账号"的那一小段（keepalive 补传来不及先问 /api/me，靠的也是它）
    const body = `{"baseRev":${this.meta.rev[name] ?? 0},"userId":${JSON.stringify(this.user)},"data":${data}}`;
    if (keepalive && bytes(body) > keepaliveLeft()) {
      // 额度被在途的 keepalive 占着：没有排好的普通上传就排一个
      if (!this.timers.has(name)) this.timers.set(name, { id: this.d.setTimer(() => void this.flush(name), DEBOUNCE_MS), first: this.d.now() });
      return;
    }
    if (keepalive) dropTimer();
    this.puts += 1;
    if (busy === false) {
      // 同一份已经有普通请求在途、页面马上要走：补一个 keepalive 就不管回话了（两份都到了的话后到的撞上 409，什么也不写；
      // 页面没走成的话，先发的那个照常处理回话，下次上传按冲突合并）
      this.dups.add(name);
      void this.call('PUT', `${API}/${name}`, body, true).then(() => this.dups.delete(name));
      return;
    }
    const gen = this.gen.get(name) ?? 0;
    this.inflight.set(name, keepalive);
    this.changed();
    const res = await this.call('PUT', `${API}/${name}`, body, keepalive);
    this.inflight.delete(name);
    const err = res.body?.error;
    if (res.status === 200 && typeof res.body?.rev === 'number') {
      this.meta.rev[name] = res.body.rev;
      if ((this.gen.get(name) ?? 0) === gen) this.setDirty(name, false);
      this.note = null;
      this.saveMeta();
    } else if (res.status === 409 && err === 'wrong_user') {
      // 会话已经是别的账号了：这份数据不能交，按换了账号从头来
      this.restart();
      return;
    } else if (res.status === 409 && err === 'conflict' && depth < 3) {
      // 冲突也可能是 cookie 已经换成别的账号了：先确认，换了就从头来，绝不拿这份数据去合并或用 0 重交
      if (!(await this.sameUser(true))) return;
      const cur = res.body?.current;
      // 云端没有这个槽（被清理过）：从 0 重新建；有就合并后拿它的 rev 重交
      try {
        if (!isObj(cur)) this.meta.rev[name] = 0;
        else if (this.reconcile(slot, cur)) this.d.onApplied?.();
      } catch (e) {
        if (!(e instanceof StorageFull)) throw e;
        this.note = NOTE.storage;
        return this.stop('paused');
      }
      if (!this.saveMeta()) return;
      return this.flush(name, false, depth + 1);
    } else if (res.status === 429) {
      const after = typeof res.body?.retryAfter === 'number' ? res.body.retryAfter : 10;
      const at = this.d.now() + Math.max(1, after) * 1000;
      this.retryAt.set(name, Math.max(at, this.retryAt.get(name) ?? 0));
      this.timers.set(name, { id: this.d.setTimer(() => void this.flush(name), at - this.d.now()), first: this.d.now() });
    } else if (res.status === 413) {
      this.tooLarge.add(name);
      this.note = NOTE.tooLarge;
    } else this.fail(res);
    this.changed();
  }

  /** 最近一次 /api/me 确认的账号（交分时带上，平台据此认出别的标签页换过号） */
  get userId(): string | null {
    return this.user;
  }

  /** 问 /api/me 现在是谁（顺带续 last_seen）。 */
  private async whoami(): Promise<Who> {
    this.askAt = this.d.now();
    this.askOk = false;
    const me = await this.call('GET', '/api/me');
    if (me.status !== 200 || !me.body) {
      this.fail(me);
      return 'fail';
    }
    this.meAt = this.d.now();
    this.askOk = true;
    const user = me.body.user;
    if (user === null) return null;
    const id = isObj(user) && typeof user.id === 'string' ? user.id : null;
    if (id === null) {
      // 回的东西不对：当作没问到，不当作没登录
      this.fail({ status: 0, body: null });
      return 'fail';
    }
    if (me.body.saves === 'paused') {
      this.stop('paused');
      return 'fail';
    }
    return id;
  }

  /** 还是不是这次打开时的那个账号；换了（或退出了）就停下这一轮，从头来。 */
  private sameUser(force = false): Promise<boolean> {
    const now = this.d.now();
    // 正在从头来：start 会以磁盘为准重新确认
    if (this.starting) return Promise.resolve(false);
    if (!force && now - this.meAt < RECHECK_MS) return Promise.resolve(true);
    // 几秒内刚问过：不再问。没问到就先算没确认（等过了节流再问）；问到了就信那次的结论，只核对磁盘
    if (now - this.askAt < FORCE_GAP_MS) {
      if (!this.askOk) return Promise.resolve(false);
      if (loadMeta(this.d.store).userId === this.user) return Promise.resolve(true);
      this.restart();
      return Promise.resolve(false);
    }
    this.checking ??= this.check().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async check(): Promise<boolean> {
    const id = await this.whoami();
    if (id === 'fail') return false;
    if (id === null) {
      this.stop('out');
      return false;
    }
    // 账号没变、磁盘上的元数据也还是这个账号：照常；否则从头来（start 以磁盘为准，需要时换账号）
    if (id === this.user && loadMeta(this.d.store).userId === this.user) return true;
    this.restart();
    return false;
  }

  /** 停下这一轮（不再上传），从头来；start 进行中就等它结束再来。 */
  private restart(): void {
    for (const t of this.timers.values()) this.d.clearTimer(t.id);
    this.timers.clear();
    this.started = false;
    if (this.starting) this.again = true;
    else void this.start();
  }

  /** 云端的一个槽和本地对一下；本地被改了（写进了云端来的东西）返回 true。 */
  private reconcile(slot: SlotDef, entry: Record<string, unknown> | null): boolean {
    const n = slot.name;
    const local = slot.read(this.d.store);
    const hasLocal = !!local && stable(slot.payload(local)) !== stable(slot.payload(slot.empty()));
    const cloud = entry ? slot.revive(entry.data) : null;
    const rev = entry && Number.isSafeInteger(entry.rev) ? (entry.rev as number) : 0;
    // 云端没有或读不懂：本地有东西就传上去（覆盖读不懂的那份）
    if (!cloud) {
      this.meta.rev[n] = rev;
      this.setDirty(n, hasLocal);
      return false;
    }
    if (!local) {
      this.write(slot, cloud);
      this.meta.rev[n] = rev;
      this.setDirty(n, false);
      return true;
    }
    const merged = slot.merge(local, cloud);
    const changed = stable(merged) !== stable(local);
    if (changed) {
      // 备份存上了（读回来一致）才动本地；本地写上了才把 rev 记成云端的（不然下次会拿没合进去的本地覆盖云端）
      if (!setRaw(this.d.store, preSyncKey(n), JSON.stringify(local))) throw new StorageFull();
      this.write(slot, merged);
    }
    this.meta.rev[n] = rev;
    const ahead = stable(slot.payload(merged)) !== stable(slot.payload(cloud));
    this.setDirty(n, ahead);
    // 两边各有对方没有的东西，才算"合在一起了"
    if (changed && ahead) this.merged = true;
    return changed;
  }

  /**
   * 换了账号（或第一次登录）。上一个账号的本地进度先存起来、本地清成空档、元数据马上存盘，然后才去拉新账号的：
   * 后面哪一步断了，下次打开看到的都是"新账号 + 空档"，不会把旧账号的东西当成首次同步传上去。
   * 新账号以前在这台设备上被换走时存下的那份并回来（之后和云端合并、传上去）。
   */
  private switchUser(id: string): void {
    const old = this.meta.userId;
    if (old !== null) {
      // 先把每个槽都备份好（已有的备份合并进去，不覆盖），全部存上了才清本地
      const backed: SlotDef[] = [];
      for (const slot of this.d.slots) {
        const v = slot.read(this.d.store);
        if (!v) continue;
        const key = preSwitchKey(slot.name, old);
        const prev = slot.revive(getJson(this.d.store, key));
        if (!setRaw(this.d.store, key, JSON.stringify(prev ? slot.merge(prev, v) : v))) throw new StorageFull();
        backed.push(slot);
      }
      for (const slot of backed) this.write(slot, slot.empty());
    }
    // 本地清空了马上把新账号落盘（磁盘上本来是旧账号的，saveMeta 会拒绝，所以直接写）：
    // 之后哪一步失败，下次启动看到的都是"新账号"，不会把新账号的东西备份成旧账号的
    this.meta = { v: 1, userId: id, rev: {}, dirty: [] };
    if (!setRaw(this.d.store, META_KEY, JSON.stringify(this.meta))) throw new StorageFull();
  }

  /**
   * 这个账号以前在这台设备上被换走时存下的进度（pre-switch.<id>）：并回本地。每次启动只要元数据已是这个账号就检查一遍，
   * 中途存储满了下次接着并（合并是幂等的）。全部并完（读回来核对过）才改名为 .restored 留底，以后不再并——
   * 会归零的数字（比如教程被重新开启）按并集合并会被一次次抬回旧值。.restored 每个账号每个槽只留最近一份（同名覆盖）。
   * 并进去的进度在本地、会算作待上传，关了页面也不丢。
   */
  private restoreSwitched(id: string): void {
    const done: [string, unknown][] = [];
    for (const slot of this.d.slots) {
      const key = preSwitchKey(slot.name, id);
      const text = getJson(this.d.store, key);
      const v = slot.revive(text);
      if (!v) continue;
      this.write(slot, slot.merge(slot.read(this.d.store) ?? slot.empty(), v));
      done.push([key, text]);
    }
    for (const [key, text] of done) if (setRaw(this.d.store, `${key}.restored`, JSON.stringify(text))) setRaw(this.d.store, key, null);
  }

  /** 写本地的一个槽；读回来对不上（配额满了）就停下这一轮。 */
  private write(slot: SlotDef, v: unknown): void {
    this.applying = true;
    try {
      slot.write(this.d.store, v);
    } finally {
      this.applying = false;
    }
    const back = slot.read(this.d.store);
    if (!back || stable(back) !== stable(v)) throw new StorageFull();
  }

  private fail(res: Res): void {
    if (res.status === 401) return this.stop('out');
    // 只有平台明确回了 busy 才是停服 / 预算用完（15.1）；别的 503（网关、不是 JSON）按连不上
    if (res.status === 503 && res.body?.error === 'busy') return this.stop('paused');
    this.note = NOTE.offline;
    this.changed();
  }

  private stop(why: 'out' | 'paused'): void {
    this.stopped = why;
    this.starting = false;
    this.changed();
  }

  private setDirty(name: string, on: boolean): void {
    const has = this.meta.dirty.includes(name);
    if (on && !has) this.meta.dirty.push(name);
    if (!on && has) this.meta.dirty = this.meta.dirty.filter((x) => x !== name);
  }

  /**
   * 存元数据前先看磁盘上的：别的标签页可能已经换了账号。磁盘上的是别的账号时——
   * 本页确认过账号就不写（免得把磁盘改回旧账号），重新确认；本页还没确认过（没启动、未登录）就跟着磁盘的走，只加上本页待上传的槽。
   * 注意"读、比较、写"跨标签页不是原子的（localStorage 没有锁）：两页恰好同时写还可能互相覆盖，
   * 剩下的窄缝靠上传前再核对一次磁盘、平台的 wrong_user 和 storage 事件兜住。
   */
  private saveMeta(): boolean {
    const disk = loadMeta(this.d.store);
    if (disk.userId !== this.meta.userId) {
      if (this.user !== null) {
        void this.sameUser(true);
        return false;
      }
      const dirty = this.meta.dirty;
      this.meta = disk;
      for (const n of dirty) this.setDirty(n, true);
    }
    return setRaw(this.d.store, META_KEY, JSON.stringify(this.meta));
  }

  private slot(name: string): SlotDef | undefined {
    return this.d.slots.find((s) => s.name === name);
  }

  private changed(): void {
    this.d.onChange?.(this.view);
  }

  private async call(method: string, url: string, body?: string, keepalive = false): Promise<Res> {
    try {
      const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
      // 写请求必须带 X-Arcade（平台只挡浏览器里的跨站写，15.1）
      if (body !== undefined) Object.assign(init, { body, keepalive, headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' } });
      const r = await (keepalive && body !== undefined ? keepaliveSend(body, () => this.d.fetch(url, init)) : this.d.fetch(url, init));
      let json: unknown = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { status: r.status, body: isObj(json) ? json : null };
    } catch {
      return { status: 0, body: null };
    }
  }
}

/** 页面上有没有登录提示 cookie（不带 HttpOnly，页面读得到；__Host-sid 读不到，也不需要读）：没有就是没登录，不调接口 */
export function hasLoginHint(): boolean {
  return typeof document !== 'undefined' && /(?:^|;\s*)__Host-arcade_li=1(?:;|$)/.test(document.cookie);
}

const SAVE_KEY = 'yexun.save';

/** 局外成长存档这一槽：读写的就是 save.ts 的 `yexun.save`（用传进来的存储，测试里是内存假的） */
export const profileSlot: SlotDef<Save> = {
  name: 'profile',
  read(store) {
    try {
      const raw = store?.getItem(SAVE_KEY);
      return raw ? reviveSave(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  write(store, v) {
    try {
      store?.setItem(SAVE_KEY, JSON.stringify(v));
    } catch {
      /* 写不进去，write() 读回来对不上会按存储满了处理 */
    }
  },
  revive: reviveSave,
  merge: mergeSave,
  payload: savePayload,
  empty: fresh,
};

/** 浏览器里的默认依赖。 */
export function browserDeps(hooks: Pick<CloudDeps, 'onChange' | 'onApplied'> = {}): CloudDeps {
  return {
    store: defaultStore(),
    fetch: (url, init) => globalThis.fetch(url, init),
    slots: [profileSlot as SlotDef],
    hasLoginHint,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...hooks,
  };
}

/**
 * 启动云存档并接好页面事件：切后台补传、切回前台重新确认、别的标签页改了元数据（storage 事件）。
 * 返回的 Cloud 由 main 在每次存档写入后调 `cloud.touch('profile')`；点"大厅"离开前调 `cloud.hidden(true)`。
 */
export function startCloud(hooks: Pick<CloudDeps, 'onChange' | 'onApplied'> = {}): Cloud {
  const cloud = new Cloud(browserDeps(hooks));
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? cloud.hidden() : cloud.visible()));
    addEventListener('pagehide', () => cloud.hidden(true));
  }
  if (typeof addEventListener === 'function') addEventListener('storage', (e) => (e.key === META_KEY || e.key === null) && cloud.absorb());
  void cloud.start();
  return cloud;
}
