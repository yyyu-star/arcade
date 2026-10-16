import type { SettleStats } from '../core/career.ts';
import { LIVE_MAX_BP, isLiveTier, liveTierById, type LiveTier } from '../core/liveTiers.ts';
import type { KeyValueStore } from './settings.ts';

/**
 * 0.6.0 实盘的账（docs/design-live.md 第 2.4、6 节）：带入、结回、放弃都经开盘自己的 Worker（同域 POST api/live/*）转给平台钱包，
 * 浏览器这边只在本机记一条 `kaipan.live`，管"这局实盘的筹码走到哪一步了"。一局的进度照旧在 kaipan.save 里。
 *
 * - 带入前先把记录写成 buying：回话丢了（断网、关页面）也知道那个 ref 可能已经带入了，下次打开先用 refund 收回来（没带入的话钱包回 no_stake，直接清掉）。
 *   不收回的话钱包里那一份放到 24 小时到期原样退回；期间照样能开新的一局，开局面板提示还有一份没结（0.6.8）。
 * - 结回、放弃先写成 settling 再发：连不上、钱包忙（busy）、平台内部出错（internal）、没认出人，都停在 settling，之后每次打开、回到前台、联网时重发。
 *   操作 id 按 ref 固定（Worker 拼 `${ref}-out` / `${ref}-refund`），重发钱包只算一次。
 * - 钱包说这一份已经到期退回（expired）或没有这一份（no_stake）：这局改成不算筹码（void），接着玩不影响。
 * - `bad_*`、`bad_request`、`unknown_game` 和 Worker 的 400 / 403 / 404 是开盘自己的 bug：记 error、控制台留证据，不自动重试。
 * 不依赖 DOM：fetch、时钟、存储从外面传进来，测试里换成假的。
 */

export const LIVE_KEY = 'kaipan.live';
/** 钱包允许的最长期限：带入时间 + 24 小时（Worker 按自己的时钟定，这里按本机时钟估一个，只用来判断"放太久了"） */
const LIVE_TTL_MS = 24 * 3_600_000;
/** 相对路径：线上是 /games/kaipan/api/live/…（游戏挂在子路径下，资源一律相对路径） */
const API = 'api/live/';
const WALLET_API = '/api/wallet';
/** 一次请求最多等这么久（Worker 那边问平台 3 秒、钱包 5 秒）；超时按连不上算，之后重发 */
const LIVE_FETCH_MS = 10_000;

/** 给请求加个超时（老浏览器没有 AbortSignal.timeout 就不加，靠浏览器自己的超时） */
function timeoutSignal(): { signal?: AbortSignal } {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(LIVE_FETCH_MS) } : {};
}

export type LiveStep = 'buying' | 'playing' | 'settling' | 'done' | 'void' | 'error';

export interface LiveRecord {
  ref: string;
  tier: LiveTier;
  /** 一份（带入的数） */
  stake: number;
  /** 这局的种子：和 kaipan.save 里的局对上才是同一局 */
  seed: string;
  /** 带入时间、到期时间（本机时钟，毫秒） */
  at: number;
  until: number;
  step: LiveStep;
  /** settling 之后：结回（settle）还是放弃（refund，只在第一个交易日开盘前） */
  kind?: 'settle' | 'refund';
  /** 结回倍数（万分之几），settle 才有 */
  bp?: number;
  /** 0.6.5 战绩小结（平台 5.10）：结束时算好记下，重发时原样再带；旧记录没有就不带 */
  stats?: SettleStats;
  /** done：进了钱包多少、到顶没进多少 */
  credited?: number;
  capped?: number;
  /** void / error 的原因（钱包或 Worker 的错误码） */
  error?: string;
  /** settling 时最近一次没发成的原因：'offline'（连不上、钱包忙）或 'login'（没认出人） */
  wait?: 'offline' | 'login';
  /** 结果已经告诉过玩家（结束页或开始菜单说过一次） */
  told?: boolean;
  /** 带入的账号（Worker 带入成功时回的 user）：结回、放弃时带上，换了账号 Worker 回 wrong_user，不拿新账号去结 */
  user?: string;
}

/** 浏览器看到的钱包（GET /api/wallet 里开盘用得到的几样） */
export interface WalletView {
  balance: number;
  /**
   * 开盘桌上的几份（平台 0.9.5 起同一个游戏可以同时有好几份）：ref 和本机记录不同的，是在另一台设备上开的、
   * 或者本机记录丢了的。0.6.8 起不因为这些拦着开新的一局，开局面板提示一句，给"回去接着打 / 原样退回"
   */
  stakes: { ref: string; tier: string; amount: number; until: number }[];
}

/** 一次调用的结果，按"该怎么办"分好类 */
export type Outcome =
  | { kind: 'ok'; credited: number; capped: number; wallet: WalletView | null }
  /** code：钱包回的错误码（busy、internal），连不上时没有；带入失败时按它给玩家说法（平台 15.10） */
  | { kind: 'retry'; why: 'offline' | 'login'; code?: string }
  | { kind: 'reject'; error: string; wallet: WalletView | null }
  | { kind: 'bug'; error: string };

interface LiveDeps {
  store: KeyValueStore | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now(): number;
  onChange?(): void;
}

/** 钱包回了这些就停在 settling、之后重试（internal 是平台那边接住的任何异常，大多是暂时的） */
const RETRY_ERRORS = new Set(['busy', 'internal']);
/** 正常的业务拒绝，按设计稿第 6 节的表各自处理；其余错误码都当成开盘自己的 bug */
const REJECT_ERRORS = new Set(['no_funds', 'at_table', 'limit', 'expired', 'no_stake']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const STEPS: readonly LiveStep[] = ['buying', 'playing', 'settling', 'done', 'void', 'error'];
/** 还没结完的几步：这时候不能开新的一局，别的标签页也不能盖掉它 */
const UNSETTLED: readonly LiveStep[] = ['buying', 'playing', 'settling'];

/** 读回本机的记录；格式不对当作没有（坏记录留着只会挡住新开实盘） */
export function reviveLive(raw: unknown): LiveRecord | null {
  if (!isObj(raw)) return null;
  const { ref, tier, stake, seed, at, until, step } = raw;
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{8,57}$/.test(ref) || !isLiveTier(tier) || !isNum(stake) || typeof seed !== 'string' || !isNum(at) || !isNum(until)) return null;
  if (!STEPS.includes(step as LiveStep)) return null;
  const r: LiveRecord = { ref, tier, stake, seed, at, until, step: step as LiveStep };
  if (raw.kind === 'settle' || raw.kind === 'refund') r.kind = raw.kind;
  if (isNum(raw.bp)) r.bp = raw.bp;
  if (isObj(raw.stats)) r.stats = raw.stats as unknown as SettleStats;
  if (isNum(raw.credited)) r.credited = raw.credited;
  if (isNum(raw.capped)) r.capped = raw.capped;
  if (typeof raw.error === 'string') r.error = raw.error;
  if (raw.wait === 'offline' || raw.wait === 'login') r.wait = raw.wait;
  if (raw.told === true) r.told = true;
  if (typeof raw.user === 'string' && raw.user) r.user = raw.user;
  // settling 必须知道发什么，否则改成 error 留着排查
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

/** ref = kaipan- + UUID（43 位），加上最长的后缀 -refund 也在钱包的 64 位以内 */
function newRef(): string {
  return `kaipan-${crypto.randomUUID()}`;
}

/** GET /api/wallet 的回话 → WalletView；读不懂为 null */
export function walletView(raw: unknown): WalletView | null {
  if (!isObj(raw) || !isNum(raw.balance)) return null;
  const stakes = Array.isArray(raw.stakes) ? raw.stakes : [];
  const mine = stakes.filter((x): x is Record<string, unknown> => isObj(x) && x.game === 'kaipan' && typeof x.ref === 'string');
  return { balance: raw.balance, stakes: mine.map((k) => ({ ref: k.ref as string, tier: String(k.tier), amount: isNum(k.amount) ? k.amount : 0, until: isNum(k.until) ? k.until : 0 })) };
}

/** Worker 的回话 → 该怎么办（status 0 = 连不上） */
export function classify(status: number, body: unknown): Outcome {
  // 没登录，或者现在登录的不是带入的那个账号：等登录对了再发
  if (status === 401 || (status === 409 && isObj(body) && body.error === 'wrong_user')) return { kind: 'retry', why: 'login' };
  if (status === 0 || status >= 500 || (status === 200 && !isObj(body))) return { kind: 'retry', why: 'offline' };
  if (status !== 200 || !isObj(body)) return { kind: 'bug', error: isObj(body) && typeof body.error === 'string' ? body.error : `http_${status}` };
  const wallet = walletView(body.wallet);
  if (body.ok === true) return { kind: 'ok', credited: isNum(body.credited) ? body.credited : 0, capped: isNum(body.capped) ? body.capped : 0, wallet };
  const error = typeof body.error === 'string' ? body.error : 'bad_reply';
  if (RETRY_ERRORS.has(error)) return { kind: 'retry', why: 'offline', code: error };
  if (error === 'no_user') return { kind: 'retry', why: 'login' };
  if (REJECT_ERRORS.has(error)) return { kind: 'reject', error, wallet };
  return { kind: 'bug', error };
}

type BuyinResult = { ok: true; record: LiveRecord } | { ok: false; outcome: Exclude<Outcome, { kind: 'ok' }> | { kind: 'reject'; error: 'pending'; wallet: null } };

export class LiveClient {
  private rec: LiveRecord | null;
  /** 正在发的那一次（同一时间只发一个，重试的触发很多：打开、回到前台、联网） */
  private inflight: Promise<void> | null = null;

  private readonly d: LiveDeps;

  constructor(d: LiveDeps) {
    this.d = d;
    this.rec = loadLive(d.store);
  }

  /**
   * 几个标签页共用 localStorage：每次看、每次改之前都按存储里的为准（别的页可能已经结完这局、开了下一局）。
   * 存储用不了时只有内存里这一份。
   */
  private refresh(): LiveRecord | null {
    if (this.d.store) this.rec = loadLive(this.d.store);
    return this.rec;
  }

  get record(): Readonly<LiveRecord> | null {
    return this.refresh();
  }

  /** 这局（按种子）是不是正在打的实盘：打着的、还没结的 */
  pendingFor(seed: string): boolean {
    const r = this.refresh();
    return !!r && r.seed === seed && (r.step === 'playing' || r.step === 'settling');
  }

  /** 有一局实盘还在打（playing）：开新局前要先问 */
  get playing(): boolean {
    return this.refresh()?.step === 'playing';
  }

  /**
   * 带入一份开局。成功后记录是 playing，调用方再用 seed 开局。
   * 连不上时记录留在 buying，下次 cleanup() 用 refund 收回（回话丢了的话那一份可能已经扣了）。
   * 等回话的这段时间占着 inflight：期间回到前台、联网触发的重试不会把这个 ref 拿去收回。
   */
  /**
   * 0.6.8 把桌上别处的一份原样退回（开局面板上"你还有一局实盘没结"的「原样退回」）。那一份在别的设备上、或者本机记录丢了，
   * 这台设备接不着打；放着不管一天后钱包也会原样退回（设计稿 2.5 接受的缺口），这里只是提前。
   * 本机记录正是这一份（作废、出错留着的）时，退回后清掉记录。
   */
  async refundStake(ref: string): Promise<Outcome> {
    const cur = this.refresh();
    if (cur?.ref === ref && UNSETTLED.includes(cur.step)) return { kind: 'reject', error: 'pending', wallet: null };
    const { outcome: o } = await this.post('refund', { ref });
    const gone = o.kind === 'ok' || (o.kind === 'reject' && (o.error === 'no_stake' || o.error === 'expired'));
    const now = this.refresh();
    if (gone && now?.ref === ref && !UNSETTLED.includes(now.step)) this.save(null, ref);
    return o;
  }

  async buyin(tier: LiveTier, seed: string): Promise<BuyinResult> {
    await this.cleanup();
    if (this.inflight) return { ok: false, outcome: { kind: 'reject', error: 'pending', wallet: null } };
    const cur = this.refresh();
    if (cur && UNSETTLED.includes(cur.step)) return { ok: false, outcome: { kind: 'reject', error: 'pending', wallet: null } };
    const now = this.d.now();
    const rec: LiveRecord = { ref: newRef(), tier, stake: liveTierById(tier).stake, seed, at: now, until: now + LIVE_TTL_MS, step: 'buying' };
    if (!this.save(rec, rec.ref)) return { ok: false, outcome: { kind: 'reject', error: 'pending', wallet: null } };
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
      // 记下是谁带入的：换了账号以后不拿新账号去结这一份（Worker 对不上回 wrong_user）
      this.save({ ...rec, step: 'playing', ...(user ? { user } : {}) }, rec.ref);
      return { ok: true, record: rec };
    }
    // 没认出人（Worker 的 401、钱包的 no_user）是在动钱包之前就挡下的，肯定没带入；别的"连不上"说不准，留着下次收回
    if (o.kind === 'retry' && o.why === 'offline') return { ok: false, outcome: o };
    // 明确没带入：清掉，不留尾巴
    if (o.kind === 'bug') console.error('实盘带入出错：', o.error);
    this.save(null, rec.ref);
    return { ok: false, outcome: o };
  }

  /**
   * 这局结束了（打完半年、破产，或提前收手）：记成 settling 再发。kind = refund 只用在第一个交易日开盘前（设计稿 2.3）。
   * 记录对不上这局（种子不同）或者已经在结了，什么都不做。
   */
  finish(seed: string, kind: 'settle' | 'refund', bp: number, stats?: (bp: number, stake: number) => SettleStats): Promise<void> {
    const r = this.refresh();
    if (!r || r.step !== 'playing' || r.seed !== seed) return this.inflight ?? Promise.resolve();
    const next: LiveRecord = { ...r, step: 'settling', kind };
    if (kind === 'settle') {
      next.bp = Math.max(0, Math.min(LIVE_MAX_BP, Math.floor(bp)));
      if (stats) next.stats = stats(next.bp, r.stake);
    }
    this.save(next, r.ref);
    return this.retry();
  }

  /** settling 的重发一次（同时只发一个）；buying 的收尾也在这里 */
  retry(): Promise<void> {
    if (this.inflight) return this.inflight;
    const r = this.refresh();
    if (!r || (r.step !== 'settling' && r.step !== 'buying')) return Promise.resolve();
    this.inflight = (r.step === 'buying' ? this.refundBuying(r) : this.settle(r)).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** 上次带入没等到回话：先收回 */
  cleanup(): Promise<void> {
    return this.refresh()?.step === 'buying' ? this.retry() : (this.inflight ?? Promise.resolve());
  }

  /**
   * 打开游戏时：记录是 playing 但已经过了期限 → 钱包已经（或马上会）把那一份原样退回，这局不再算筹码。
   * 返回是否刚改成 void（开始菜单说一句）。
   */
  expire(): boolean {
    const r = this.refresh();
    if (!r || r.step !== 'playing' || this.d.now() <= r.until) return false;
    return this.save({ ...r, step: 'void', error: 'expired' }, r.ref);
  }

  /** 结果说过了（结束页、开始菜单的提示每局只说一次；待结的也只说一次，结完换了结果会再说） */
  markTold(): void {
    const r = this.refresh();
    if (r && !r.told && r.step !== 'playing' && r.step !== 'buying') this.save({ ...r, told: true }, r.ref);
  }

  /** 看钱包（开局面板的余额、换设备的提示）。没登录 'login'，连不上 null */
  async wallet(): Promise<WalletView | 'login' | null> {
    try {
      const r = await this.d.fetch(WALLET_API, { method: 'GET', credentials: 'same-origin', cache: 'no-store', ...timeoutSignal() });
      if (r.status === 401) return 'login';
      if (r.status !== 200) return null;
      const body: unknown = await r.json();
      return isObj(body) ? walletView(body.wallet) : null;
    } catch {
      return null;
    }
  }

  private async refundBuying(r: LiveRecord): Promise<void> {
    const { outcome: o } = await this.post('refund', { ref: r.ref });
    const cur = this.refresh();
    if (cur?.ref !== r.ref || cur.step !== 'buying') return;
    // 退回来了，或者钱包里本来就没有（no_stake / expired）：这条记录到此为止
    if (o.kind === 'ok' || (o.kind === 'reject' && (o.error === 'no_stake' || o.error === 'expired'))) this.save(null, r.ref);
    else if (o.kind === 'bug') {
      // 开盘自己的 bug：留着排查（设计稿第 6 节），不再自动重发
      console.error('实盘收回没开成的那一份出错：', o.error);
      this.save({ ...cur, step: 'error', error: o.error }, r.ref);
    }
    // 连不上、忙、今天写满（limit）……：留在 buying，下次再收
  }

  private async settle(r: LiveRecord): Promise<void> {
    const who = r.user ? { user: r.user } : {};
    const body = r.kind === 'refund' ? { ref: r.ref, ...who } : { ref: r.ref, tier: r.tier, bp: r.bp, ...who, ...(r.stats ? { stats: r.stats } : {}) };
    const { outcome: o } = await this.post(r.kind === 'refund' ? 'refund' : 'settle', body);
    // 发的这段时间里记录可能被改过（标了"说过了"、别的页结完了）：在最新的上面改
    const cur = this.refresh();
    if (cur?.ref !== r.ref || cur.step !== 'settling') return;
    if (o.kind === 'ok') {
      // 放弃：原样退回，credited 就是那一份
      this.save({ ...cur, step: 'done', credited: o.credited, capped: o.capped, wait: undefined, told: false }, r.ref);
    } else if (o.kind === 'retry' || (o.kind === 'reject' && o.error === 'limit')) {
      // limit：钱包的每日写入上限，明天还能结，按重试处理
      const why = o.kind === 'retry' ? o.why : 'offline';
      if (cur.wait !== why) this.save({ ...cur, wait: why }, r.ref);
    } else if (o.kind === 'reject' && (o.error === 'expired' || o.error === 'no_stake')) {
      this.save({ ...cur, step: 'void', error: o.error, wait: undefined, told: false }, r.ref);
    } else {
      console.error('实盘结算出错：', o.error);
      this.save({ ...cur, step: 'error', error: o.error, wait: undefined, told: false }, r.ref);
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
    return { outcome: classify(status, json), user: isObj(json) && typeof json.user === 'string' ? json.user : null };
  }

  /**
   * 写记录（rec 为 null 是清掉）；ref 是这次改的是哪一局。存储里已经是另一局、还没结完（别的标签页开的）时不写，
   * 内存换成存储里的那一份，返回 false。
   */
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
      // 存储满了：内存里照样有，这次打开期间照常工作
    }
    this.d.onChange?.();
    return true;
  }
}
