/**
 * 云存档（docs/platform-backend.md 5.5、15.1–15.3）：只同步战绩（stats）和教程标记（tutorial），打到一半的牌局、设置不同步。
 * 平台只存不透明 JSON + 版本号 rev，合并在这里做：计数取较大、布尔取"或"、数组取并集；合并改了本地数据前先备份到 guandan.<slot>.pre-sync。
 *
 * - 只有带着提示 cookie __Host-arcade_li 才发请求；启动先调 /api/me（存档接口不续 last_seen，靠它续，否则只玩掼蛋的人会被当成一年没登录清掉）。
 * - 换了账号（user.id 和 guandan.cloud 里记的不同）：本机数据属于上一个账号，绝不上传。识别到的当下就备份到
 *   guandan.<slot>.pre-switch.<旧 userId>、把本地清成空档、元数据换成新账号并存盘，然后才去拉取——拉取失败、暂停、页面被关都不会留下"旧数据 + 新账号"。
 *   没记过账号（这台机器第一次登录）时，本机数据就是这个人登录前玩的，合并进他的账号。
 * - 上传 10 秒防抖，同一个槽两次上传至少隔 5 分钟（每副牌都会改战绩，每人每天只有 100 次 PUT）；
 *   切到后台时用 keepalive 补传一个槽，但离这个槽上次上传不到 3 分钟就不补（手机上一副两三分钟、每副都切出去的人，一小时也不超过 20 次；
 *   没补的留在 dirty 里，下次打开再传）。
 * - 409 合并后用云端 rev 重交（current 为 null 时用 baseRev 0）；429 按 retryAfter 等（之后的改动也不提前）；413 这个槽不再传；
 *   503 busy 或 saves=paused 本次打开不再同步；连不上就等下一次改动、切后台或下次打开；401 当作已退出。
 * - 连不上或停服时登录状态不明：图标不显示"未登录"、也不引人去登录（15.1、5.7），只用小红点说明。
 * - 平台按 cookie 记账：页面开着时别的标签页可能退出、换了账号。每次上传都带上 /api/me 给的 userId（平台 0.7.1 起），
 *   和当前会话不是同一个人时平台回 409 wrong_user、一行不写——这时不合并、不重试，按"账号换过了"处理：备份到 pre-switch、清本地，再问 /api/me。
 *   回到前台 / 拿到焦点时也问一次 /api/me（按上次"尝试"的时间限 1 分钟一次，连不上时不会每次切回来都问）。
 */
import type { SyncSlot } from './store.ts';

export type CloudStatus = 'loggedOut' | 'synced' | 'syncing' | 'pending' | 'merged';
/** 图标上的小红点：点开时解释 */
export type CloudNote = null | 'paused' | 'offline' | 'tooLarge' | 'noSpace' | 'rejected';
export interface CloudMeta {
  v: 1;
  userId: string | null;
  rev: Partial<Record<SyncSlot, number>>;
  dirty: SyncSlot[];
}
export interface CloudDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  hasLoginHint: () => boolean;
  /** 本地槽数据（已带默认值）、写回本地、空存档 */
  read: (slot: SyncSlot) => unknown;
  write: (slot: SyncSlot, data: unknown) => void;
  /** 备份（tag：pre-sync 或 pre-switch.<旧 userId>），写完读回核对，存储满了等原因没存上返回 false */
  backup: (slot: SyncSlot, tag: string, data: unknown) => boolean;
  readBackup: (slot: SyncSlot, tag: string) => unknown;
  dropBackup: (slot: SyncSlot, tag: string) => void;
  empty: (slot: SyncSlot) => unknown;
  loadMeta: () => CloudMeta | null;
  saveMeta: (m: CloudMeta) => void;
  /** 退出、换了账号：忘掉本机记着的好友房（guandan.room 是上一个账号的，不能给新账号"回到房间"） */
  forgetRoom?: () => void;
}

/** 排在前面的更该保（切后台只补传一个） */
const SLOT_ORDER: SyncSlot[] = ['stats', 'tutorial'];
export const DEBOUNCE_MS = 10_000;
export const MIN_GAP_MS = 5 * 60_000;
export const HIDE_GAP_MS = 3 * 60_000;
/** 回到前台时复查身份的最小间隔（按上次尝试的时间算，连不上也算一次） */
export const VERIFY_MS = 60_000;
const KEEPALIVE_MAX = 60 * 1024;

/** 点云朵：有说明（连不上、停服、太大）就说明——这时登录状态不明，不能叫人去登录（15.1、5.7）；确实没登录才去登录页 */
export function tapAction(status: CloudStatus, note: CloudNote): 'login' | 'explain' {
  return note === null && status === 'loggedOut' ? 'login' : 'explain';
}

/** 合并两份存档：计数取较大，布尔取"或"，数组取并集，对象逐字段合并，其余以本地为准。 */
export function merge(local: unknown, remote: unknown): unknown {
  if (typeof local === 'number' && typeof remote === 'number') return Math.max(local, remote);
  if (typeof local === 'boolean' && typeof remote === 'boolean') return local || remote;
  if (Array.isArray(local) && Array.isArray(remote)) {
    const seen = new Set(local.map(canon));
    return [...local, ...remote.filter((x) => !seen.has(canon(x)))];
  }
  if (isObj(local) && isObj(remote)) {
    const out: Record<string, unknown> = { ...remote, ...local };
    for (const k of Object.keys(local)) if (k in remote) out[k] = merge(local[k], remote[k]);
    return out;
  }
  return local ?? remote;
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const canon = (x: unknown): string =>
  isObj(x) ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}` : Array.isArray(x) ? `[${x.map(canon).join(',')}]` : JSON.stringify(x);
/** 与键顺序无关的比较 */
export const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const validMeta = (m: CloudMeta | null): m is CloudMeta => !!m && m.v === 1 && isObj(m.rev) && Array.isArray(m.dirty);

type Reply = { status: number; body: Record<string, unknown>; retryAfter: number } | null;

export class CloudSync {
  status: CloudStatus = 'loggedOut';
  note: CloudNote = null;
  private meta: CloudMeta;
  private userId: string | null = null;
  /** 带着登录提示 cookie：/api/me 没问到之前（连不上、停服）登录状态不明，不算"未登录" */
  private hinted = false;
  private pulled = false;
  private paused = false;
  private merged = false;
  /** 上次问 /api/me 的时间（不管问没问到） */
  private checkedAt = -Infinity;
  /** 本页自己改过、还没传上去的槽（别的标签页传完时，只有这些不能跟着清掉） */
  private touched = new Set<SyncSlot>();
  /** 并回了 pre-switch 备份、等这次上传成功后把备份改名成"已并回"的槽 → 账号 */
  private restoring = new Map<SyncSlot, string>();
  private busy = new Set<SyncSlot | 'me'>();
  private blocked = new Set<SyncSlot>();
  private lastPut = new Map<SyncSlot, number>();
  private retryAt = new Map<SyncSlot, number>();
  private timers = new Map<SyncSlot, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private d: CloudDeps;

  constructor(d: CloudDeps) {
    this.d = d;
    const m = d.loadMeta();
    this.meta = validMeta(m) ? m : { v: 1, userId: null, rev: {}, dirty: [] };
  }

  /** 状态或小红点变了时通知（图标用） */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 启动：问 /api/me（顺带续 last_seen），再拉云端、合并、补传 */
  async start(): Promise<void> {
    this.hinted = this.d.hasLoginHint();
    if (!this.hinted) return;
    await this.recheck();
    this.refresh();
  }

  /** 回到前台、窗口拿到焦点：离上次问 /api/me 超过 1 分钟就再问一次（别的标签页可能退出或换了账号；启动时没问到的也补上） */
  async resume(): Promise<void> {
    if (this.paused || this.busy.has('me') || Date.now() - this.checkedAt < VERIFY_MS) return;
    if (!this.d.hasLoginHint()) {
      if (this.userId !== null || this.hinted) this.setUser(null);
      this.refresh();
      return;
    }
    this.hinted = true;
    await this.recheck();
    this.refresh();
  }

  /** 玩家改了某个槽（store.onSyncedChange）。没登录时也记着，登录同一个账号后补传。 */
  markDirty(slot: SyncSlot): void {
    this.touched.add(slot);
    this.addDirty(slot);
    this.merged = false;
    this.schedule(slot);
    this.refresh();
  }

  /**
   * 切到后台、关页面：补传最该保的一个槽（keepalive 的 64 KB 是整页共用的，只发一个）。带着 userId，换了账号平台会拒收。
   * leaving：玩家点了"回大厅"，这一走多半不会马上回来，不受 3 分钟间隔限制（封了槽、在等 429、没登录照样不传）。
   */
  flushOnHide(leaving = false): void {
    if (!this.active()) return;
    const now = Date.now();
    const slot = SLOT_ORDER.find((s) =>
      this.meta.dirty.includes(s) && !this.busy.has(s) && !this.blocked.has(s) &&
      now >= (this.retryAt.get(s) ?? 0) && (leaving || now - (this.lastPut.get(s) ?? -Infinity) >= HIDE_GAP_MS));
    if (!slot) return;
    this.clear(slot);
    void this.upload(slot, true);
  }

  /** 别的标签页改了元数据（storage 事件）：同一个账号 rev 取大、待上传取并集；那边换了账号就跟着换 */
  onExternalMeta(): void {
    const m = this.d.loadMeta();
    if (!validMeta(m)) return;
    if (m.userId !== this.meta.userId) {
      this.meta = m;
      if (this.userId !== null) this.userId = m.userId;
      // 包括"等上传成功后给备份改名"的记录：那边换号后可能又写了新的 pre-switch 备份，本页不能替它改名
      this.forgetAccount();
    } else {
      for (const s of SLOT_ORDER) {
        const r = m.rev[s];
        const newer = typeof r === 'number' && r > (this.meta.rev[s] ?? -1);
        if (newer) this.meta.rev[s] = r;
        // 那边已经传完（rev 更大、也不再待上传），本页自己又没改过：本页的待上传跟着作废，免得多传
        if (newer && !m.dirty.includes(s) && !this.touched.has(s)) {
          this.meta.dirty = this.meta.dirty.filter((x) => x !== s);
          this.clear(s);
        }
        if (m.dirty.includes(s) && !this.meta.dirty.includes(s)) this.meta.dirty.push(s);
      }
    }
    this.refresh(true);
  }

  // ───────────── 内部 ─────────────

  private active(): boolean {
    return this.userId !== null && this.pulled && !this.paused;
  }

  /**
   * 问 /api/me 确认现在是谁。问到了返回 true：同一个人照旧（没拉取过就补拉）；换了账号走换账号流程并重新拉取；
   * 没登录当作退出。问不到（连不上、停服）返回 false，状态不动。
   */
  private async recheck(): Promise<boolean> {
    this.checkedAt = Date.now();
    this.busy.add('me');
    this.refresh();
    const me = await this.call('GET', '/api/me');
    this.busy.delete('me');
    const user = me?.body.user as { id?: unknown } | null | undefined;
    if (!me) {
      this.setNote('offline');
      return false;
    }
    if (me.status === 503) {
      this.pause();
      return false;
    }
    if (me.status !== 200 || !user || typeof user.id !== 'string') {
      this.setUser(null);
      return true;
    }
    if (this.note === 'offline') this.setNote(null);
    if (user.id !== this.userId) {
      for (const s of SLOT_ORDER) this.clear(s);
      this.pulled = false;
      this.merged = false;
      this.setUser(user.id);
    }
    if (me.body.saves === 'paused') this.pause();
    // 暂停时（比如换号的备份没存上）不拉：拉下来会和还没清掉的旧账号数据合在一起
    else if (!this.pulled && !this.paused) await this.pull();
    return true;
  }

  private setUser(id: string | null): void {
    this.userId = id;
    if (id === null) {
      // 平台明确说没登录（401 / user 为 null、提示 cookie 没了）：真的是退出了，不再挂"连不上"之类的说明，也不再传
      this.d.forgetRoom?.();
      this.hinted = false;
      this.note = null;
      for (const s of SLOT_ORDER) this.clear(s);
      return;
    }
    // 别的标签页可能已经处理过换号（存盘的元数据比内存新）：以存盘的为准，免得再备份一次已经清空的数据
    this.adoptStored();
    const old = this.meta.userId;
    if (old !== null && old !== id) {
      this.d.forgetRoom?.();
      // 换了账号：当下就备份、清空、存盘，之后无论拉取成不成功，本机都不再有旧账号的数据可传
      if (!this.stashAndWipe(old)) {
        // 本地还是旧账号的数据：内存也不能记成新账号（不记账号，暂停着）
        this.userId = null;
        return;
      }
      this.meta = { v: 1, userId: id, rev: {}, dirty: [] };
    } else this.meta.userId = id;
    this.d.saveMeta(this.meta);
  }

  /** 存盘的元数据换了账号（别的标签页处理过换号）：内存跟上，丢掉本页按旧账号记的东西 */
  private adoptStored(): void {
    const m = this.d.loadMeta();
    if (!validMeta(m) || m.userId === this.meta.userId) return;
    this.meta = m;
    this.forgetAccount();
  }

  /** 换账号时清掉跟着旧账号的状态：本页改过的槽、413 封槽、429 等待、上次上传时间、定时器 */
  private forgetAccount(): void {
    this.touched.clear();
    this.blocked.clear();
    this.retryAt.clear();
    this.lastPut.clear();
    this.restoring.clear();
    for (const s of SLOT_ORDER) this.clear(s);
  }

  /**
   * 换号前把本机两个槽备份到 pre-switch.<old>，全部确认存上了才清空本地。
   * 备份和已有的同名备份合并后再写（同一个 key 只会变多、不会被更少的数据盖掉）。
   * 有一个没存上（存储满了）就什么都不清，暂停云同步并提示——宁可不同步，也不丢旧账号的数据；下次打开再试。
   */
  private stashAndWipe(old: string): boolean {
    const tag = `pre-switch.${old}`;
    for (const slot of SLOT_ORDER) {
      const prev = this.d.readBackup(slot, tag);
      const data = this.d.read(slot);
      if (!this.d.backup(slot, tag, prev === null || prev === undefined ? data : merge(data, prev))) {
        this.paused = true;
        this.forgetAccount();
        this.setNote('noSpace');
        return false;
      }
    }
    for (const slot of SLOT_ORDER) this.d.write(slot, this.d.empty(slot));
    this.forgetAccount();
    return true;
  }

  private async pull(): Promise<void> {
    // 拉的是谁的：GET 回来时账号变了（别的回应先处理了换号）就丢掉这次结果
    const who = this.userId!;
    for (const s of SLOT_ORDER) this.busy.add(s);
    this.refresh();
    // userId：平台核对是不是当前会话的账号（0.7.3），不是就 409 wrong_user、不给数据——cookie 在问 /api/me 和拉取之间换了时，不会把别人的存档拉进来
    const r = await this.call('GET', `/api/saves/guandan?userId=${encodeURIComponent(who)}`);
    for (const s of SLOT_ORDER) this.busy.delete(s);
    if (this.userId !== who) return this.refresh();
    if (r?.status === 409 && r.body.error === 'wrong_user') return this.switchedAway(who);
    if (!this.ok(r, null)) return;
    const list = Array.isArray(r!.body.saves) ? (r!.body.saves as unknown[]).filter(isObj) : [];
    for (const slot of SLOT_ORDER) {
      const remote = list.find((x) => x.slot === slot && typeof x.rev === 'number');
      if (remote) this.absorb(slot, remote.rev as number, remote.data);
      else {
        // 云端没有这个槽：第一次同步且本地不是空档就新建（本机的改动本来就在 dirty 里）
        const first = this.meta.rev[slot] === undefined;
        this.meta.rev[slot] = 0;
        if (first && !same(this.d.read(slot), this.d.empty(slot))) this.addDirty(slot);
      }
    }
    this.restoreStash(who);
    this.pulled = true;
    this.d.saveMeta(this.meta);
    for (const slot of [...this.meta.dirty]) this.schedule(slot, 0);
  }

  /**
   * 换走又换回来（wrong_user 后问到的还是原账号，或者 u1→u2→u1）：pre-switch.<当前账号> 里可能有当时没传上去的增量。
   * 按合并规则并回本地、标成待上传；合并只会变多，云端已有的不会被盖掉。
   * 只并一次：这次上传成功后把备份改名成 pre-switch.<账号>.restored（留着当安全副本），以后不再并——
   * 否则像"当前连胜"这种会归零的数，每次打开都会被备份里的旧值抬回去、再多传一次。
   */
  private restoreStash(who: string): void {
    for (const slot of SLOT_ORDER) {
      const saved = this.d.readBackup(slot, `pre-switch.${who}`);
      if (saved === null || saved === undefined) continue;
      const local = this.d.read(slot);
      const out = merge(local, saved);
      if (!same(out, local)) {
        this.d.write(slot, out);
        this.touched.add(slot);
        this.addDirty(slot);
      }
      // 本地已经包含备份、也没有待上传的：现在就算并回了
      if (this.meta.dirty.includes(slot)) this.restoring.set(slot, who);
      else this.retireStash(slot, who);
    }
  }

  /** 备份已经并回并传上去了：改名成 .restored，以后不再并 */
  private retireStash(slot: SyncSlot, who: string): void {
    const tag = `pre-switch.${who}`;
    const saved = this.d.readBackup(slot, tag);
    this.restoring.delete(slot);
    if (saved === null || saved === undefined) return;
    // 安全副本没存上（存储满了）就先不删原备份；下次打开会再并一次，但不会丢
    if (this.d.backup(slot, `${tag}.restored`, saved)) this.d.dropBackup(slot, tag);
  }

  /** 收下云端版本：和本地合并，本地变了先备份（本地是空档就直接收下，不算合并）；合并结果和云端不同就要上传 */
  private absorb(slot: SyncSlot, rev: number, data: unknown): void {
    const local = this.d.read(slot);
    const out = merge(local, data);
    if (!same(out, local)) {
      if (!same(local, this.d.empty(slot))) {
        this.d.backup(slot, 'pre-sync', local);
        this.merged = true;
      }
      this.d.write(slot, out);
    }
    this.meta.rev[slot] = rev;
    if (same(out, data)) this.undirty(slot);
    else this.addDirty(slot);
  }

  private undirty(slot: SyncSlot): void {
    this.meta.dirty = this.meta.dirty.filter((s) => s !== slot);
    this.touched.delete(slot);
  }

  private addDirty(slot: SyncSlot): void {
    if (!this.meta.dirty.includes(slot)) this.meta.dirty.push(slot);
    this.d.saveMeta(this.meta);
  }

  /** 排一次上传：默认 10 秒防抖，离上次上传不少于 MIN_GAP_MS，也不早于 429 给的时间 */
  private schedule(slot: SyncSlot, ms = DEBOUNCE_MS): void {
    if (!this.active() || this.blocked.has(slot)) return;
    const now = Date.now();
    const last = this.lastPut.get(slot);
    const wait = Math.max(ms, last === undefined ? 0 : last + MIN_GAP_MS - now, (this.retryAt.get(slot) ?? 0) - now);
    this.clear(slot);
    this.timers.set(slot, setTimeout(() => {
      this.timers.delete(slot);
      void this.upload(slot, false);
    }, wait));
  }
  private clear(slot: SyncSlot): void {
    clearTimeout(this.timers.get(slot));
    this.timers.delete(slot);
  }

  private async upload(slot: SyncSlot, keepalive: boolean, retried = false): Promise<void> {
    if (this.busy.has(slot) || !this.active() || !this.meta.dirty.includes(slot)) return;
    // 别的标签页退出了（提示 cookie 没了）：不传
    if (!this.d.hasLoginHint()) {
      this.setUser(null);
      this.refresh();
      return;
    }
    const who = this.userId!;
    const data = this.d.read(slot);
    // userId：平台核对是不是当前会话的账号，不是就 409 wrong_user、一行不写（别的标签页换了账号时不会串号）
    const body = JSON.stringify({ baseRev: this.meta.rev[slot] ?? 0, data, userId: who });
    this.busy.add(slot);
    this.refresh();
    const r = await this.call('PUT', `/api/saves/guandan/${slot}`, body, keepalive && body.length <= KEEPALIVE_MAX);
    this.busy.delete(slot);
    // 等回应的时候换了账号：这次的结果不算
    if (this.userId !== who) return this.refresh();
    if (r?.status === 409 && r.body.error === 'wrong_user') return this.switchedAway(who);
    if (r?.status === 409 && r.body.error === 'conflict' && !retried) {
      // 带了 userId，平台先核对账号再比 rev：能回 conflict 就还是同一个人，不用再问 /api/me
      // 别的设备先传了：合并后用云端的 rev 重交；云端那份没了（current 为 null）就当新建
      const cur = r.body.current;
      if (isObj(cur) && typeof cur.rev === 'number') this.absorb(slot, cur.rev, cur.data);
      else this.meta.rev[slot] = 0;
      this.d.saveMeta(this.meta);
      if (this.meta.dirty.includes(slot)) return this.upload(slot, keepalive, true);
      // 合并后和云端一样、不用重交：并回的备份已经在云端了
      if (this.restoring.get(slot) === who) this.retireStash(slot, who);
    } else if (this.ok(r, slot)) {
      this.lastPut.set(slot, Date.now());
      this.meta.rev[slot] = Number(r!.body.rev);
      // 上传期间玩家又改了：留着脏标记，下一轮再传
      if (same(this.d.read(slot), data)) this.undirty(slot);
      else this.schedule(slot);
      this.d.saveMeta(this.meta);
      if (this.restoring.get(slot) === who) this.retireStash(slot, who);
      this.setNote(null);
    }
    this.refresh();
  }

  /**
   * 平台说当前会话已经不是 old 了（409 wrong_user）：账号换过了。还不知道换成了谁，先按换账号把本机数据备份到 pre-switch、
   * 清空、存盘（元数据不记账号，之后按首次同步处理，本地是空档就什么都不传），再问 /api/me 拉新账号的数据。不合并、不重试。
   */
  private async switchedAway(old: string): Promise<void> {
    this.d.forgetRoom?.();
    this.adoptStored();
    // 存盘的元数据已经不是 old：别的标签页先发现了换号、备份过也清空过，这里只跟上内存状态，不能再备份（会把清空后的数据写进 pre-switch.<old>）
    if (this.meta.userId === old) {
      if (!this.stashAndWipe(old)) return this.refresh();
      this.meta = { v: 1, userId: null, rev: {}, dirty: [] };
      this.d.saveMeta(this.meta);
    }
    this.userId = null;
    this.pulled = false;
    this.merged = false;
    await this.recheck();
    this.refresh();
  }

  /** 2xx 返回 true；其余按错误码处理 */
  private ok(r: Reply, slot: SyncSlot | null): boolean {
    if (r && r.status >= 200 && r.status < 300) return true;
    if (!r) this.setNote('offline');
    else if (r.status === 401) this.setUser(null);
    else if (r.status === 503) this.pause();
    // 400：请求本身不合格（我们这边的问题），重试也没用；这个槽本次打开不再传，给个说明，但不算"连不上"
    else if (r.status === 400) {
      if (slot) this.blocked.add(slot);
      this.setNote('rejected');
    } else if (r.status === 413 && slot) {
      this.blocked.add(slot);
      this.setNote('tooLarge');
    } else if (r.status === 429 && slot) {
      this.retryAt.set(slot, Date.now() + Math.max(1, r.retryAfter) * 1000 + 500);
      this.schedule(slot, 0);
    } else this.setNote('offline');
    return false;
  }

  private pause(): void {
    this.paused = true;
    for (const s of SLOT_ORDER) this.clear(s);
    this.setNote('paused');
  }
  private setNote(n: CloudNote): void {
    this.note = n;
    this.refresh(true);
  }

  private async call(method: 'GET' | 'PUT', path: string, body?: string, keepalive = false): Promise<Reply> {
    try {
      const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
      if (method === 'PUT') Object.assign(init, { body, keepalive, headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' } });
      const res = await this.d.fetch(path, init);
      const json: unknown = await res.json().catch(() => null);
      // 不是平台的 JSON（代理、网关的错误页）算连不上
      if (!isObj(json)) return null;
      const ra = Number(json.retryAfter ?? res.headers.get('Retry-After') ?? 10);
      return { status: res.status, body: json, retryAfter: Number.isFinite(ra) ? ra : 10 };
    } catch {
      return null;
    }
  }

  private refresh(force = false): void {
    const prev = this.status;
    if (this.userId === null && !this.hinted) this.status = 'loggedOut';
    else if (this.busy.size > 0) this.status = 'syncing';
    // 登录状态不明（连不上、停服）时也是"待上传"：数据先存在本机
    // 存储满了换不了号时也不能显示"已同步"
    else if (this.meta.dirty.length > 0 || this.userId === null || this.note === 'noSpace') this.status = 'pending';
    else if (this.merged) this.status = 'merged';
    else this.status = 'synced';
    if (force || this.status !== prev) for (const fn of this.listeners) fn();
  }
}
