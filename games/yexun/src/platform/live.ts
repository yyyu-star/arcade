/**
 * 夜巡实盘的浏览器端（DESIGN.md 4、5.5，照开盘 0.11.2 的 src/platform/live.ts 精简）：
 * 带入、结回、放弃都经夜巡自己的 Worker（同域 POST api/live/*）转给平台钱包；浏览器只在本机记一条 `yexun.live`，管"这一份筹码走到哪一步了"。
 *
 * - 带入前先把记录写成 buying：回话丢了也知道那个 ref 可能已经带入，下次 resume() 先 refund 收回（没带入则钱包回 no_stake，清掉）。
 * - 结回、放弃先写成 settling 再发，连不上就停在 settling，之后每次打开、回到前台、联网时重发；操作 id 按 ref 固定，重发钱包只算一次。
 * - 中途离开（局没打完就关页面、刷新、崩溃）算输：夜巡不存打到一半的局，没法接着打，所以重开页面时 resume() 把 playing 的那一份按
 *   "最后一次 progress 记下的拍数" 结回（vigilBp(tier, ticks, false, false)：撑过 3:00 才有钱，没记过拍数就是 0）。
 *   这样关页面既不能躲掉损失，也不会比留在局里多拿：main.ts 打局时每隔约 10 秒调一次 progress。
 * - 带入时记下账号（Worker 回的 user）：结回、放弃时带上，换了账号 Worker 回 409 wrong_user，不动钱包，等换回去再发。
 * - 501（单独部署，没有钱包）：unavailable 为 true，实盘入口藏起来；带入返回 { ok:false, outcome:{kind:'unavailable'} }。
 * - 400 / 403 / 404 和钱包的未知错误码是夜巡自己的 bug：记 error、控制台留证据，不自动重试。
 * 不依赖 DOM：fetch、时钟、存储从外面传进来。
 */
import { LIVE_MAX_BP, LIVE_TIERS, isLiveTier, liveReturn, vigilBp, type LiveTier } from '../content/live.ts';
import type { Setup } from '../core/state.ts';
import type { KeyValueStore } from './cloud.ts';

export const LIVE_KEY = 'yexun.live';
const LIVE_TTL_MS = 24 * 3_600_000;
/** 相对路径：线上是 /games/yexun/api/live/…（游戏挂在子路径下） */
const API = 'api/live/';
const LIVE_FETCH_MS = 10_000;

/** 实盘的开局配置（DESIGN 4.1）：危险档由档位定，固定小道士，不带咒印、永久加成（perks 空对象），不开降低伤害 */
export function liveSetup(tier: LiveTier, seed: number): Setup {
  return { seed, mode: 'vigil', danger: LIVE_TIERS[tier].danger, character: 'xiaodao', perks: {}, assist: false };
}

export type LiveStep = 'buying' | 'playing' | 'settling' | 'done' | 'void' | 'error';

export interface LiveRecord {
  ref: string;
  tier: LiveTier;
  stake: number;
  /** 这局的种子 */
  seed: number;
  at: number;
  until: number;
  step: LiveStep;
  /** 最近一次 progress 记下的撑到的拍数（中途离开按它算） */
  ticks?: number;
  kind?: 'settle' | 'refund';
  /** 结回倍数（万分之几） */
  bp?: number;
  /** 战绩小结（平台 5.10）：结束时记下，重发时原样再带 */
  stats?: unknown;
  credited?: number;
  capped?: number;
  error?: string;
  wait?: 'offline' | 'login';
  told?: boolean;
  /** 带入的账号 */
  user?: string;
}

export type Outcome =
  | { kind: 'ok'; credited: number; capped: number }
  | { kind: 'retry'; why: 'offline' | 'login'; code?: string }
  | { kind: 'reject'; error: string }
  /** 501：单独部署，没有钱包 */
  | { kind: 'unavailable' }
  | { kind: 'bug'; error: string };

export interface LiveDeps {
  store: KeyValueStore | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now(): number;
  onChange?(): void;
}

const RETRY_ERRORS = new Set(['busy', 'internal']);
const REJECT_ERRORS = new Set(['no_funds', 'at_table', 'limit', 'expired', 'no_stake']);
const STEPS: readonly LiveStep[] = ['buying', 'playing', 'settling', 'done', 'void', 'error'];
const UNSETTLED: readonly LiveStep[] = ['buying', 'playing', 'settling'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function timeoutSignal(): { signal?: AbortSignal } {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(LIVE_FETCH_MS) } : {};
}

/** 读回本机的记录；格式不对当作没有 */
export function reviveLive(raw: unknown): LiveRecord | null {
  if (!isObj(raw)) return null;
  const { ref, tier, stake, seed, at, until, step } = raw;
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{8,57}$/.test(ref) || !isLiveTier(tier) || !isNum(stake) || !isNum(seed) || !isNum(at) || !isNum(until)) return null;
  if (!STEPS.includes(step as LiveStep)) return null;
  const r: LiveRecord = { ref, tier, stake, seed, at, until, step: step as LiveStep };
  if (raw.kind === 'settle' || raw.kind === 'refund') r.kind = raw.kind;
  if (isNum(raw.ticks)) r.ticks = raw.ticks;
  if (isNum(raw.bp)) r.bp = raw.bp;
  if (raw.stats !== undefined && raw.stats !== null) r.stats = raw.stats;
  if (isNum(raw.credited)) r.credited = raw.credited;
  if (isNum(raw.capped)) r.capped = raw.capped;
  if (typeof raw.error === 'string') r.error = raw.error;
  if (raw.wait === 'offline' || raw.wait === 'login') r.wait = raw.wait;
  if (raw.told === true) r.told = true;
  if (typeof raw.user === 'string' && raw.user) r.user = raw.user;
  if (r.step === 'settling' && (!r.kind || (r.kind === 'settle' && r.bp === undefined))) return { ...r, step: 'error', error: 'bad_record' };
  return r;
}

function loadLive(store: KeyValueStore | null): LiveRecord | null {
  try {
    const raw = store?.getItem(LIVE_KEY);
    return raw ? reviveLive(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** ref = yexun- + UUID（43 位），加上最长的后缀 -refund 也在钱包的 64 位以内 */
function newRef(): string {
  return `yexun-${crypto.randomUUID()}`;
}

/** Worker 的回话 → 该怎么办（status 0 = 连不上） */
export function classify(status: number, body: unknown): Outcome {
  if (status === 501) return { kind: 'unavailable' };
  if (status === 401 || (status === 409 && isObj(body) && body.error === 'wrong_user')) return { kind: 'retry', why: 'login' };
  if (status === 0 || status >= 500 || (status === 200 && !isObj(body))) return { kind: 'retry', why: 'offline' };
  if (status !== 200 || !isObj(body)) return { kind: 'bug', error: isObj(body) && typeof body.error === 'string' ? body.error : `http_${status}` };
  if (body.ok === true) return { kind: 'ok', credited: isNum(body.credited) ? body.credited : 0, capped: isNum(body.capped) ? body.capped : 0 };
  const error = typeof body.error === 'string' ? body.error : 'bad_reply';
  if (RETRY_ERRORS.has(error)) return { kind: 'retry', why: 'offline', code: error };
  if (error === 'no_user') return { kind: 'retry', why: 'login' };
  if (REJECT_ERRORS.has(error)) return { kind: 'reject', error };
  return { kind: 'bug', error };
}

export type BuyinResult = { ok: true; record: LiveRecord } | { ok: false; outcome: Exclude<Outcome, { kind: 'ok' }> };

export class LiveClient {
  private rec: LiveRecord | null;
  private inflight: Promise<void> | null = null;
  private off = false;
  private readonly d: LiveDeps;

  constructor(d: LiveDeps) {
    this.d = d;
    this.rec = loadLive(d.store);
  }

  /** 收到过 501：这里没有钱包，实盘入口该藏起来 */
  get unavailable(): boolean {
    return this.off;
  }

  private refresh(): LiveRecord | null {
    if (this.d.store) this.rec = loadLive(this.d.store);
    return this.rec;
  }

  get record(): Readonly<LiveRecord> | null {
    return this.refresh();
  }

  /** 有一份还没结完（不能开新的） */
  get busy(): boolean {
    const r = this.refresh();
    return !!r && UNSETTLED.includes(r.step);
  }

  /**
   * 带入一份开局。成功后记录是 playing，调用方再用 liveSetup(tier, seed) 开局。
   * 连不上时记录留在 buying，下次 resume() 用 refund 收回。
   */
  async buyin(tier: LiveTier, seed: number): Promise<BuyinResult> {
    // 只收回上次没等到回话的 buying；playing 的不动（同一页里还在打，中途离开归 resume 管）
    await this.retry();
    if (this.off) return { ok: false, outcome: { kind: 'unavailable' } };
    if (this.inflight || this.busy) return { ok: false, outcome: { kind: 'reject', error: 'pending' } };
    const now = this.d.now();
    const rec: LiveRecord = { ref: newRef(), tier, stake: LIVE_TIERS[tier].stake, seed, at: now, until: now + LIVE_TTL_MS, step: 'buying' };
    if (!this.save(rec, rec.ref)) return { ok: false, outcome: { kind: 'reject', error: 'pending' } };
    let o!: Outcome;
    let user: string | null = null;
    this.inflight = this.post('buyin', { ref: rec.ref, tier }).then((x) => {
      o = x.outcome;
      user = x.user;
    });
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    if (o.kind === 'ok') {
      const playing: LiveRecord = { ...rec, step: 'playing', ...(user ? { user } : {}) };
      this.save(playing, rec.ref);
      return { ok: true, record: playing };
    }
    // 连不上说不准有没有扣：留着 buying 下次收回
    if (o.kind === 'retry' && o.why === 'offline') return { ok: false, outcome: o };
    // 501、401、业务拒绝：动钱包之前就挡下或明确没带入，清掉
    if (o.kind === 'bug') console.error('实盘带入出错：', o.error);
    this.save(null, rec.ref);
    return { ok: false, outcome: o };
  }

  /** 打局时每隔约 10 秒报一次撑到的拍数；中途离开按它结回 */
  progress(seed: number, ticks: number): void {
    const r = this.refresh();
    if (!r || r.step !== 'playing' || r.seed !== seed) return;
    const t = Math.max(0, Math.floor(ticks));
    if (t > (r.ticks ?? 0)) this.save({ ...r, ticks: t }, r.ref);
  }

  /** 局打完了（倒下、天亮、尸王）：按 vigilBp 算倍数，记成 settling 再发。对不上这局（种子不同）或已在结，什么都不做 */
  finish(seed: number, res: { ticks: number; won: boolean; bossKilled: boolean }, stats?: unknown): Promise<void> {
    const r = this.refresh();
    if (!r || r.step !== 'playing' || r.seed !== seed) return this.inflight ?? Promise.resolve();
    const bp = Math.max(0, Math.min(LIVE_MAX_BP, vigilBp(r.tier, res.ticks, res.won, res.bossKilled)));
    this.save({ ...r, step: 'settling', kind: 'settle', bp, ...(stats === undefined ? {} : { stats }) }, r.ref);
    return this.retry();
  }

  /** 放弃：局还没开始打（开局失败、选档后反悔）原样退回 */
  abandon(seed: number): Promise<void> {
    const r = this.refresh();
    if (!r || r.step !== 'playing' || r.seed !== seed) return this.inflight ?? Promise.resolve();
    this.save({ ...r, step: 'settling', kind: 'refund' }, r.ref);
    return this.retry();
  }

  /**
   * 启动、回到前台、联网时调：
   * playing（页面重开，局没了）→ 过期的作废，没过期的按中途离开结回；settling 重发；buying 收回。
   * 返回时已发完（或停在等重试）。
   */
  async resume(): Promise<void> {
    const r = this.refresh();
    if (!r) return;
    if (r.step === 'playing' && !this.inflight) {
      if (this.d.now() > r.until) this.save({ ...r, step: 'void', error: 'expired' }, r.ref);
      else this.save({ ...r, step: 'settling', kind: 'settle', bp: vigilBp(r.tier, r.ticks ?? 0, false, false) }, r.ref);
    }
    await this.retry();
  }

  retry(): Promise<void> {
    if (this.inflight) return this.inflight;
    const r = this.refresh();
    if (!r || (r.step !== 'settling' && r.step !== 'buying') || this.off) return Promise.resolve();
    this.inflight = (r.step === 'buying' ? this.refundBuying(r) : this.settle(r)).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** 结果说过了（结算页提示每份只说一次） */
  markTold(): void {
    const r = this.refresh();
    if (r && !r.told && r.step !== 'playing' && r.step !== 'buying') this.save({ ...r, told: true }, r.ref);
  }

  /** 已经结完的记录（done / void / error）清掉，让位给下一份 */
  clearFinished(): void {
    const r = this.refresh();
    if (r && !UNSETTLED.includes(r.step)) this.save(null, r.ref);
  }

  private async refundBuying(r: LiveRecord): Promise<void> {
    const { outcome: o } = await this.post('refund', { ref: r.ref });
    const cur = this.refresh();
    if (cur?.ref !== r.ref || cur.step !== 'buying') return;
    if (o.kind === 'ok' || (o.kind === 'reject' && (o.error === 'no_stake' || o.error === 'expired'))) this.save(null, r.ref);
    else if (o.kind === 'unavailable') this.save(null, r.ref);
    else if (o.kind === 'bug') {
      console.error('实盘收回没开成的那一份出错：', o.error);
      this.save({ ...cur, step: 'error', error: o.error }, r.ref);
    }
  }

  private async settle(r: LiveRecord): Promise<void> {
    const who = r.user ? { user: r.user } : {};
    const body = r.kind === 'refund' ? { ref: r.ref, ...who } : { ref: r.ref, tier: r.tier, bp: r.bp, ...who, ...(r.stats === undefined ? {} : { stats: r.stats }) };
    const { outcome: o } = await this.post(r.kind === 'refund' ? 'refund' : 'settle', body);
    const cur = this.refresh();
    if (cur?.ref !== r.ref || cur.step !== 'settling') return;
    if (o.kind === 'ok') {
      this.save({ ...cur, step: 'done', credited: o.credited, capped: o.capped, wait: undefined, told: false }, r.ref);
    } else if (o.kind === 'retry' || (o.kind === 'reject' && o.error === 'limit')) {
      const why = o.kind === 'retry' ? o.why : 'offline';
      if (cur.wait !== why) this.save({ ...cur, wait: why }, r.ref);
    } else if (o.kind === 'unavailable') {
      this.save({ ...cur, wait: 'offline' }, r.ref);
    } else if (o.kind === 'reject' && (o.error === 'expired' || o.error === 'no_stake')) {
      this.save({ ...cur, step: 'void', error: o.error, wait: undefined, told: false }, r.ref);
    } else {
      const error = o.kind === 'bug' || o.kind === 'reject' ? o.error : 'bad_reply';
      console.error('实盘结算出错：', error);
      this.save({ ...cur, step: 'error', error, wait: undefined, told: false }, r.ref);
    }
  }

  private async post(action: 'buyin' | 'settle' | 'refund', body: unknown): Promise<{ outcome: Outcome; user: string | null }> {
    let status = 0;
    let json: unknown = null;
    try {
      const res = await this.d.fetch(`${API}${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' },
        body: JSON.stringify(body),
        ...timeoutSignal(),
      });
      status = res.status;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    } catch {
      status = 0;
    }
    const outcome = classify(status, json);
    if (outcome.kind === 'unavailable') this.off = true;
    return { outcome, user: isObj(json) && typeof json.user === 'string' ? json.user : null };
  }

  /** 写记录（null 是清掉）；存储里已经是另一份没结完的（别的标签页开的）时不写，返回 false */
  private save(rec: LiveRecord | null, ref: string): boolean {
    const stored = this.d.store ? loadLive(this.d.store) : null;
    if (stored && stored.ref !== ref && UNSETTLED.includes(stored.step)) {
      this.rec = stored;
      this.d.onChange?.();
      return false;
    }
    if (!rec && stored && stored.ref !== ref) {
      this.rec = stored;
      return true;
    }
    this.rec = rec;
    try {
      if (rec) this.d.store?.setItem(LIVE_KEY, JSON.stringify(rec));
      else this.d.store?.removeItem(LIVE_KEY);
    } catch {
      // 存储满了：内存里照样有
    }
    this.d.onChange?.();
    return true;
  }
}

/** 默认接线：浏览器里用 */
export function createLive(over: Partial<LiveDeps> = {}): LiveClient {
  let store: KeyValueStore | null = null;
  try {
    store = globalThis.localStorage ?? null;
  } catch {
    store = null;
  }
  return new LiveClient({ store, fetch: (u, i) => globalThis.fetch(u, i), now: () => Date.now(), ...over });
}

/** 结回多少（给结算页预告用，和 Worker 算法一致；真正进账以钱包回话为准） */
export const previewReturn = liveReturn;
