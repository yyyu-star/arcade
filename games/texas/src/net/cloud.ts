/**
 * 云存档（platform-backend.md 5.5 推荐做法 1–11、15.3）：只同步一个槽 stats（战绩 + 新手提示），打到一半的牌局不同步。
 * 平台只存不透明的 JSON 和 rev，合并在这里：计数、最大值取大，布尔取或。所以合并可以反复做、顺序无关，冲突时不用问人。
 *
 * 换号不合并、不问人：旧号的本地数据备份到 pre-switch.<旧号>，本地清空再拉新号；登录回旧号时把备份并回，上传成功后改名 .restored。
 * 存储写不进去时宁可暂停同步，也不清本地（第 5 条）。依赖都从 deps 进来，测试用假的 fetch、存储和定时器。
 */
import { KEYS } from '../store.ts';

export interface Stats {
  v: 1;
  /** 打了几手（发到牌的） */
  hands: number;
  /** 赢了几手（拿到过池子） */
  won: number;
  /** 赢过最大的一池 */
  biggestPot: number;
  /** 摊牌时最好的牌力值（evalCards 的返回值，越大越好；0 是没有） */
  best: number;
  showdowns: number;
  showdownWins: number;
  /** 新手提示看过了 */
  tips: boolean;
}

/** 未登录 / 已同步 / 同步中 / 待上传 / 已合并 / 本次打开暂停 */
export type CloudState = 'anon' | 'synced' | 'syncing' | 'pending' | 'merged' | 'paused';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CloudDeps {
  fetch: typeof fetch;
  storage: KV;
  now: () => number;
  /** 有没有 __Host-arcade_li 提示 cookie（页面里读 document.cookie） */
  loggedInHint: () => boolean;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface Cloud {
  start(): Promise<void>;
  stats(): Stats;
  update(fn: (s: Stats) => Stats): void;
  state(): CloudState;
  /** 小红点的说明，没有是 null */
  note(): string | null;
  /** /api/me 认出来的人（钱包和本机牌局按它分账号） */
  userId(): string | null;
  onChange(cb: () => void): () => void;
  /** 切后台（visibilitychange hidden、pagehide）时补传 */
  flush(): void;
  /** 回到前台、拿到焦点 */
  recheck(): Promise<void>;
  /** 页面在 storage 事件里调（多个标签页，第 10 条） */
  onStorage(e: { key: string | null; newValue: string | null }): void;
}

const SAVES = '/api/saves/texas';
const SLOT = 'stats';
const DEBOUNCE = 10_000;
/** 同一槽两次上传至少隔这么久：每局都改战绩，只按防抖算会碰到每天 100 次 PUT */
const GAP = 5 * 60_000;
/** 切后台补传时，离上次上传比这近就不补，留到下次打开 */
const FLUSH_GAP = 3 * 60_000;
const RECHECK = 60_000;
/** keepalive 整个请求体上限 64 KB，留点余量 */
const KEEPALIVE_MAX = 60 * 1024;
/** 429 没说等多久时 */
const RETRY_DEFAULT = 60;

const NOTE = {
  full: '本机存储满了，战绩没法同步。清理空间后刷新页面',
  offline: '连不上服务器，战绩先存在本机，下次再传',
  busy: '云存档暂时停了，战绩先存在本机，下次打开再传',
  tooLarge: '战绩太大，传不上去',
  quota: '云存档的空间满了，战绩先存在本机',
  bad: '战绩这次没传上去，先存在本机',
  daily: '今天同步的次数用完了，战绩先存在本机，晚点再传',
  switched: '账号换过了，刷新一下页面',
} as const;

export const emptyStats = (): Stats => ({ v: 1, hands: 0, won: 0, biggestPot: 0, best: 0, showdowns: 0, showdownWins: 0, tips: false });

const COUNTS = ['hands', 'won', 'biggestPot', 'best', 'showdowns', 'showdownWins'] as const;
const isCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const obj = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/** 不合格（缺字段、类型不对、负数、非整数）返回 null，调用方按空档处理 */
export function parseStats(x: unknown): Stats | null {
  const o = obj(x);
  if (!o || o.v !== 1 || typeof o.tips !== 'boolean') return null;
  const s = emptyStats();
  for (const k of COUNTS) {
    if (!isCount(o[k])) return null;
    s[k] = o[k];
  }
  s.tips = o.tips;
  return s;
}

export function mergeStats(a: Stats, b: Stats): Stats {
  const s = emptyStats();
  for (const k of COUNTS) s[k] = Math.max(a[k], b[k]);
  s.tips = a.tips || b.tips;
  return s;
}

const same = (a: Stats, b: Stats): boolean => COUNTS.every((k) => a[k] === b[k]) && a.tips === b.tips;
const isEmpty = (s: Stats): boolean => same(s, emptyStats());

function parseJSON(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface Meta {
  /** 本地数据属于谁；null = 这台设备还没登录过，或刚收到 wrong_user 还不知道新号是谁 */
  userId: string | null;
  rev: number;
  dirty: boolean;
  /** 上次发起上传的时间（不论成败）：两次上传的间隔按它算，跨页面打开也算 */
  lastPut: number;
}

const freshMeta = (userId: string | null): Meta => ({ userId, rev: 0, dirty: false, lastPut: 0 });

function parseMeta(raw: string | null): Meta {
  const o = obj(parseJSON(raw));
  if (!o) return freshMeta(null);
  const userId = typeof o.userId === 'string' && o.userId !== '' ? o.userId : null;
  return {
    userId,
    rev: isCount(o.rev) ? o.rev : 0,
    dirty: o.dirty === true,
    lastPut: isCount(o.lastPut) ? o.lastPut : 0,
  };
}

/** null = 连不上，或回来的不是 JSON（网关出错页、vite 首页），都按"连不上"处理（15.1） */
type Reply = { status: number; body: Record<string, unknown>; retryAfter: number | null } | null;

export function createCloud(deps: CloudDeps): Cloud {
  const kv = deps.storage;
  const now = deps.now;
  const readStats = (): Stats => parseStats(parseJSON(kv.getItem(KEYS.stats))) ?? emptyStats();

  let meta = parseMeta(kv.getItem(KEYS.meta));
  let cur = readStats();
  let me: string | null = null;
  /** 拉取过 me 的云端数据才上传，baseRev 才有依据 */
  let pulled = false;
  let st: CloudState = 'anon';
  let why: string | null = null;
  /** 本次打开不再同步：503、存档暂停、存储满、400、413 */
  let halted = false;
  /** 同一时间只有一个操作在途（问身份、拉取、上传），切后台补传也不和它重叠 */
  let busy = false;
  let timer: unknown = null;
  let blockedUntil = 0;
  let lastMeAt = -Infinity;
  let merged = false;
  /** 这次拉取并回了 pre-switch.<它>，上传成功后改名 */
  let restoring: string | null = null;
  /** 一次操作里 wrong_user 后重问身份的次数：服务端来回变时不打转 */
  let hops = 0;
  const subs = new Set<() => void>();

  const emit = (): void => {
    for (const cb of subs) cb();
  };
  const set = (s: CloudState, note: string | null): void => {
    st = s;
    why = note;
    emit();
  };

  /** 写完读回核对：有的浏览器存满了不抛错 */
  function put(key: string, value: string): boolean {
    try {
      kv.setItem(key, value);
      return kv.getItem(key) === value;
    } catch {
      return false;
    }
  }
  const saveStats = (): boolean => put(KEYS.stats, JSON.stringify(cur));
  const saveMeta = (): boolean => put(KEYS.meta, JSON.stringify(meta));

  function stopTimer(): void {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  }

  function pause(note: string): void {
    halted = true;
    stopTimer();
    set('paused', note);
  }
  const full = (): void => pause(NOTE.full);
  const offline = (): void => set('pending', NOTE.offline);
  function loggedOut(): void {
    me = null;
    pulled = false;
    stopTimer();
    set('anon', null);
  }

  function schedule(): void {
    stopTimer();
    if (!me || !pulled || halted || !meta.dirty) return;
    const t = now();
    const at = Math.max(t + DEBOUNCE, meta.lastPut + GAP, blockedUntil);
    timer = deps.setTimeout(() => {
      timer = null;
      if (busy) schedule();
      else void run(() => upload(false, false));
    }, at - t);
  }

  /** 一次操作结束后的落点 */
  function settle(): void {
    if (halted || !me) return;
    if (meta.dirty) {
      schedule();
      set('pending', why);
    } else set(merged ? 'merged' : 'synced', why);
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    hops = 0;
    try {
      await fn();
    } finally {
      busy = false;
    }
  }

  async function call(method: 'GET' | 'PUT', path: string, body?: string, keepalive = false): Promise<Reply> {
    const init: RequestInit = { method, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers = { 'X-Arcade': '1', 'content-type': 'application/json' };
      init.body = body;
    }
    if (keepalive) init.keepalive = true;
    let res: Response;
    let parsed: unknown;
    try {
      res = await deps.fetch(path, init);
      parsed = await res.json();
    } catch {
      return null;
    }
    const o = obj(parsed);
    if (!o) return null;
    const h = Number(res.headers.get('retry-after'));
    const retryAfter = isCount(o.retryAfter) ? o.retryAfter : Number.isFinite(h) && h >= 0 && res.headers.has('retry-after') ? h : null;
    return { status: res.status, body: o, retryAfter };
  }

  /** 别的标签页已经换过号：只跟上，不重复备份（免得把新号的数据备份成旧号的） */
  function adopt(): void {
    const s = parseMeta(kv.getItem(KEYS.meta));
    if (s.userId === meta.userId) return;
    meta = s;
    cur = readStats();
    pulled = false;
    merged = false;
    restoring = null;
    stopTimer();
  }

  /** 第 4 条：备份旧号的本地数据、本地清空、元数据换成新号并立即存盘。备份没存上就什么都不动 */
  function switchAccount(next: string | null): boolean {
    const old = meta.userId;
    if (old === null) return true;
    stopTimer();
    const key = KEYS.preSwitch(old);
    const prev = parseStats(parseJSON(kv.getItem(key)));
    const keep = prev ? mergeStats(prev, cur) : cur;
    if (!isEmpty(keep) && !put(key, JSON.stringify(keep))) {
      full();
      return false;
    }
    cur = emptyStats();
    meta = freshMeta(next);
    pulled = false;
    merged = false;
    restoring = null;
    blockedUntil = 0;
    // 先清数据再换元数据：中途失败时元数据还是旧号，但数据已经是空档，下次打开不会把旧号的传给新号
    if (!saveStats() || !saveMeta()) {
      full();
      return false;
    }
    emit();
    return true;
  }

  function finishRestore(): void {
    const uid = restoring;
    restoring = null;
    if (uid === null) return;
    const key = KEYS.preSwitch(uid);
    const back = parseStats(parseJSON(kv.getItem(key)));
    if (!back) {
      kv.removeItem(key);
      return;
    }
    const old = parseStats(parseJSON(kv.getItem(`${key}.restored`)));
    // 改名失败就留着原名，下次再并一次也只是取大，不丢
    if (put(`${key}.restored`, JSON.stringify(old ? mergeStats(old, back) : back))) kv.removeItem(key);
  }

  async function checkMe(alwaysPull: boolean): Promise<void> {
    lastMeAt = now();
    const r = await call('GET', '/api/me');
    if (!r) return offline();
    if (r.status === 401) return loggedOut();
    if (r.body.error === 'busy') return pause(NOTE.busy);
    if (r.status !== 200) return offline();
    const user = obj(r.body.user);
    const uid = user && typeof user.id === 'string' && user.id !== '' ? user.id : null;
    if (uid === null) return loggedOut();

    adopt();
    if (meta.userId !== uid) {
      if (meta.userId === null) {
        // 第 6 条：这台设备第一次登录（或 wrong_user 后），本机数据就是这个人的，拉取时合并
        meta.userId = uid;
        if (!saveMeta()) return full();
      } else if (!switchAccount(uid)) return;
    }
    const changed = me !== uid;
    me = uid;
    if (changed) pulled = false;
    if (r.body.saves === 'paused') return pause(NOTE.busy);
    if (halted) return emit();
    if (alwaysPull || !pulled) await pull();
    else settle();
  }

  async function wrongUser(): Promise<void> {
    adopt();
    if (meta.userId !== null && meta.userId === me && !switchAccount(null)) return;
    me = null;
    pulled = false;
    if (hops++ > 0) return set('pending', NOTE.switched);
    await checkMe(true);
  }

  async function pull(): Promise<void> {
    const uid = me;
    if (uid === null) return;
    set('syncing', why);
    const r = await call('GET', `${SAVES}?userId=${encodeURIComponent(uid)}`);
    if (!r) return offline();
    if (r.status === 409 && r.body.error === 'wrong_user') return wrongUser();
    if (r.status === 401) return loggedOut();
    if (r.body.error === 'busy') return pause(NOTE.busy);
    if (r.status >= 500) return offline();
    if (r.status !== 200 || !Array.isArray(r.body.saves)) return pause(NOTE.bad);

    const row = (r.body.saves as unknown[]).map(obj).find((s) => s?.slot === SLOT) ?? null;
    const rev = row && isCount(row.rev) ? row.rev : 0;
    // 云端的坏数据当空档：合并取大，本地的好数据会把它盖掉
    const cloud = (row && parseStats(row.data)) ?? emptyStats();
    let local = cur;
    const back = parseStats(parseJSON(kv.getItem(KEYS.preSwitch(uid))));
    if (back) {
      local = mergeStats(local, back);
      restoring = uid;
    }
    if (!isEmpty(cur) && !same(cur, cloud) && !put(KEYS.preSync, JSON.stringify(cur))) return full();
    const next = mergeStats(cloud, local);
    const dirty = !same(next, cloud);
    merged = dirty && !isEmpty(cloud);
    cur = next;
    meta.rev = rev;
    meta.dirty = dirty;
    if (!saveStats() || !saveMeta()) return full();
    pulled = true;
    if (!dirty) finishRestore();
    why = null;
    settle();
  }

  async function upload(keepalive: boolean, again: boolean): Promise<void> {
    const uid = me;
    if (uid === null) return;
    const sent = cur;
    const body = JSON.stringify({ baseRev: meta.rev, data: sent, userId: uid });
    if (keepalive && new TextEncoder().encode(body).length > KEEPALIVE_MAX) return;
    meta.lastPut = now();
    if (!saveMeta()) return full();
    set('syncing', why);
    const r = await call('PUT', `${SAVES}/${SLOT}`, body, keepalive);
    if (!r) return offline();
    const err = r.body.error;

    if (r.status === 200 && isCount(r.body.rev)) {
      meta.rev = r.body.rev;
      // 在途时又改了的，留给下一次
      meta.dirty = !same(cur, sent);
      if (!saveMeta()) return full();
      if (restoring === uid) finishRestore();
      why = null;
      return settle();
    }
    if (r.status === 409 && err === 'wrong_user') return wrongUser();
    if (r.status === 409 && err === 'conflict') {
      const c = obj(r.body.current);
      const cloud = (c && parseStats(c.data)) ?? emptyStats();
      if (!isEmpty(cur) && !put(KEYS.preSync, JSON.stringify(cur))) return full();
      const next = mergeStats(cloud, cur);
      if (!isEmpty(cloud) && !same(next, cloud)) merged = true;
      cur = next;
      // current 为 null：云端被清过，按新建重交
      meta.rev = c && isCount(c.rev) ? c.rev : 0;
      meta.dirty = !same(next, cloud);
      if (!saveStats() || !saveMeta()) return full();
      emit();
      if (!meta.dirty) {
        if (restoring === uid) finishRestore();
        why = null;
        return settle();
      }
      // 只重交一次：来回冲突会把每天 100 次用光，剩下的按正常节奏
      if (again) return settle();
      return upload(false, true);
    }
    if (r.status === 429) {
      blockedUntil = now() + (r.retryAfter ?? RETRY_DEFAULT) * 1000;
      why = err === 'rate_limited' ? NOTE.daily : null;
      return settle();
    }
    if (r.status === 401) return loggedOut();
    if (err === 'busy') return pause(NOTE.busy);
    if (r.status === 413) return pause(err === 'quota_exceeded' ? NOTE.quota : NOTE.tooLarge);
    if (r.status >= 500) return offline();
    return pause(NOTE.bad);
  }

  return {
    async start() {
      if (!deps.loggedInHint()) return set('anon', null);
      set('syncing', null);
      await run(() => checkMe(true));
    },

    stats: () => ({ ...cur }),

    update(fn) {
      cur = parseStats(fn({ ...cur })) ?? cur;
      if (!saveStats()) return full();
      meta.dirty = true;
      merged = false;
      if (!saveMeta()) return full();
      if (busy || !me || halted) return emit();
      settle();
    },

    state: () => st,
    note: () => why,
    userId: () => me,

    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },

    flush() {
      if (busy || !me || !pulled || halted || !meta.dirty) return;
      const t = now();
      if (t < blockedUntil || t - meta.lastPut < FLUSH_GAP) return;
      stopTimer();
      void run(() => upload(true, false));
    },

    async recheck() {
      if (!deps.loggedInHint()) {
        if (me !== null || st !== 'anon') loggedOut();
        return;
      }
      if (busy || now() - lastMeAt < RECHECK) return;
      await run(() => checkMe(false));
    },

    onStorage(e) {
      if (e.key === KEYS.stats) {
        cur = parseStats(parseJSON(e.newValue)) ?? emptyStats();
        return emit();
      }
      if (e.key !== KEYS.meta || e.newValue === null) return;
      const other = parseMeta(e.newValue);
      if (other.userId !== meta.userId) {
        // 那边换了号：跟着换，数据以存盘的为准；下次回到前台再确认身份
        meta = other;
        cur = readStats();
        me = other.userId;
        pulled = false;
        merged = false;
        restoring = null;
        lastMeAt = -Infinity;
        stopTimer();
        if (me !== null && !busy && !halted) void run(pull);
        else if (!halted) set(me === null ? 'pending' : st, why);
        return;
      }
      meta.rev = Math.max(meta.rev, other.rev);
      meta.dirty = meta.dirty || other.dirty;
      meta.lastPut = Math.max(meta.lastPut, other.lastPut);
      if (!busy) settle();
    },
  };
}
