/**
 * 平台接口的最小计量与熔断（docs/platform-backend.md 6.6）。
 *
 * 每个 isolate 在内存里攒增量，攒够了或隔久了用一条 UPSERT 合进 meter_hourly，再读回当天合计算档位。
 * isolate 被回收会丢掉没上报的部分，所以合计偏低，阈值按"偏低"留了余量；任何一项用到 80% 后，有真实写入时提前上报（见 shouldFlush）。
 * 上报失败或超过 meterFlushTimeoutMs 没回来，就进停服档（fail-closed），之后每隔 meterRetryMs 重试一次。
 */
import type { Env } from '../env';
import type { Limits } from './config';

export const CATEGORIES = ['reg', 'auth', 'save', 'social', 'acct', 'board', 'wallet', 'live', 'mon', 'sys'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Tier = 'normal' | 'noGrowth' | 'readonly' | 'off';

interface Counts {
  requests: number;
  rowsRead: number;
  rows: Record<Category, number>;
}

function zero(): Counts {
  return { requests: 0, rowsRead: 0, rows: { reg: 0, auth: 0, save: 0, social: 0, acct: 0, board: 0, wallet: 0, live: 0, mon: 0, sys: 0 } };
}

function sumRows(c: Counts): number {
  return CATEGORIES.reduce((s, k) => s + c.rows[k], 0);
}

export interface D1MetaLike {
  rows_written?: number;
  rows_read?: number;
  size_after?: number;
}

export const hourKey = (now: number) => new Date(now).toISOString().slice(0, 13);
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

class Meter {
  private pending = zero();
  private pendingAnon = { login: 0, recover: 0 };
  /** 上次上报时读回的当天合计（含那次之前所有 isolate 的上报）。 */
  private day: { key: string; counts: Counts } | null = null;
  private hour = { key: '', login: 0, recover: 0 };
  private dbSize = 0;
  private lastFlushAt = 0;
  private failedAt = 0;
  private flushing: Promise<void> | null = null;
  /** 每次上报一个编号；超时后编号加一，卡住的那次回来时发现编号不对，就不再改档位。 */
  private gen = 0;

  countCall(): void {
    this.pending.requests++;
  }

  countAnon(kind: 'login' | 'recover'): void {
    this.pendingAnon[kind]++;
  }

  /** 库大小取最近一次调用的 size_after：每次 D1 调用都带整库大小（实测），最新的就是准的。 */
  addD1(cat: Category, meta: D1MetaLike | undefined): void {
    if (!meta) return;
    this.pending.rows[cat] += meta.rows_written ?? 0;
    this.pending.rowsRead += meta.rows_read ?? 0;
    if (meta.size_after) this.dbSize = meta.size_after;
  }

  /** 当天合计：库里读回的 + 本 isolate 还没上报的。 */
  private totals(now: number): Counts {
    const base = this.day && this.day.key === dayKey(now) ? this.day.counts : zero();
    const t = zero();
    t.requests = base.requests + this.pending.requests;
    t.rowsRead = base.rowsRead + this.pending.rowsRead;
    for (const k of CATEGORIES) t.rows[k] = base.rows[k] + this.pending.rows[k];
    return t;
  }

  /** 这个小时全站的登录或找回尝试数（给 5.4 的全站每小时上限）。 */
  anonThisHour(kind: 'login' | 'recover', now: number): number {
    return (this.hour.key === hourKey(now) ? this.hour[kind] : 0) + this.pendingAnon[kind];
  }

  /** 读不到全站计量（D1 一时出错）：tier() 这时按停服算，但玩家该看到的是"过几秒再试"，不是"明早恢复" */
  unreachable(): boolean {
    return this.failedAt > 0 || !this.day;
  }

  tier(limits: Limits, now: number): Tier {
    if (this.failedAt || !this.day) return 'off';
    const t = this.totals(now);
    const rows = sumRows(t);
    const { off, readonly } = limits;
    if (t.requests >= off.calls || rows >= off.rowsWritten || t.rowsRead >= off.rowsRead) return 'off';
    if (
      t.requests >= readonly.calls ||
      rows >= readonly.rowsWritten ||
      t.rowsRead >= readonly.rowsRead ||
      this.dbSize >= readonly.dbBytes
    ) {
      return 'readonly';
    }
    return this.dbSize >= limits.noGrowthDbBytes ? 'noGrowth' : 'normal';
  }

  /** 当天用量占停服线的百分比：调用数、写入行、读取行里最高的那项（监控用，第 16 节）。还没读到全站计量时回 null */
  usagePct(limits: Limits, now: number): number | null {
    if (!this.day) return null;
    const t = this.totals(now);
    const { off } = limits;
    return Math.round(100 * Math.max(t.requests / off.calls, sumRows(t) / off.rowsWritten, t.rowsRead / off.rowsRead));
  }

  /** 这一类当天的写入预算是否用完。 */
  exhausted(cat: Category, limits: Limits, now: number): boolean {
    return this.totals(now).rows[cat] >= limits.budget[cat];
  }

  /** 账号安全类超出预算后的封顶是否也用完（6.6）。 */
  acctOverflowExhausted(limits: Limits, now: number): boolean {
    return this.totals(now).rows.acct >= limits.budget.acct + limits.acctOverflow;
  }

  /** 任何一项到了 meterEagerRatio：之后有真实写入就提前上报，减少滞后。 */
  private nearLimit(limits: Limits, now: number): boolean {
    const r = limits.meterEagerRatio;
    const t = this.totals(now);
    if (t.requests >= r * limits.readonly.calls || sumRows(t) >= r * limits.readonly.rowsWritten) return true;
    if (t.rowsRead >= r * limits.readonly.rowsRead) return true;
    if (CATEGORIES.some((k) => t.rows[k] >= r * limits.budget[k])) return true;
    return (
      this.anonThisHour('login', now) >= r * limits.loginAllHour ||
      this.anonThisHour('recover', now) >= r * limits.recoverAllHour
    );
  }

  /**
   * 本 isolate 还没报的里面有没有"真用量"：业务写入或匿名尝试。只有调用次数时不值得为它多写一行。
   * 不算系统类：上报自己写的那 1 行记在系统类，算进来就会一次上报引出下一次，接近阈值时每秒自转。
   */
  private hasPendingUsage(): boolean {
    return (
      CATEGORIES.some((k) => k !== 'sys' && this.pending.rows[k] > 0) ||
      this.pendingAnon.login + this.pendingAnon.recover > 0
    );
  }

  /**
   * 还没拿到过档位、上报失败后到了重试时间、或跨了 UTC 天：要先同步上报一次。
   * 已经有一次上报在进行（冷启动时并发进来的请求），就等它，免得因为还没档位被误判停服。
   */
  async ensureFresh(db: D1Database, limits: Limits, now: number): Promise<void> {
    if (this.flushing && (!this.day || this.failedAt)) {
      await this.flushing;
      return;
    }
    const stale = this.failedAt ? now - this.failedAt >= limits.meterRetryMs : !this.day || this.day.key !== dayKey(now);
    if (stale) await this.flush(db, limits, now);
  }

  /**
   * 请求结束后要不要在 waitUntil 里上报。tier 是这次请求生效的档位。
   * - 停服档（算出来的或 API_MODE 设的）只按 meterFlushMs 的节奏报，不 eager：这时候每多报一次就多写一行。
   * - eager 有最小间隔（meterEagerMinMs），而且本 isolate 得有真用量（写入或匿名尝试）才报；
   *   只有 404、403、匿名 GET /api/me 这类调用时不报，免得攻击者靠刷便宜请求放大写入。
   */
  shouldFlush(limits: Limits, now: number, tier: Tier): boolean {
    if (this.flushing || this.failedAt) return false;
    const since = now - this.lastFlushAt;
    if (since >= limits.meterFlushMs) return true;
    if (tier === 'off') return false;
    if (
      this.pending.requests >= limits.meterFlushCalls ||
      this.pendingAnon.login + this.pendingAnon.recover >= limits.meterFlushAnonAttempts
    ) {
      return true;
    }
    return since >= limits.meterEagerMinMs && this.hasPendingUsage() && this.nearLimit(limits, now);
  }

  /**
   * 同一时间只有一次上报，并发调用拿到同一个 Promise。
   * 超过 meterFlushTimeoutMs 没回来就当失败：进停服档、放开 flushing，等着它的请求立刻拿到 503，
   * 不会因为 D1 挂住把整个 isolate 的请求都挂住。卡住的那次以后回来，只处理它自己的计数，不再改档位。
   */
  flush(db: D1Database, limits: Limits, now: number): Promise<void> {
    if (this.flushing) return this.flushing;
    const gen = ++this.gen;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (this.gen === gen) {
          this.gen++;
          this.failedAt = now;
          this.flushing = null;
          console.error('meter flush timed out');
        }
        resolve();
      }, limits.meterFlushTimeoutMs);
    });
    const run = this.doFlush(db, now, gen).finally(() => {
      clearTimeout(timer);
      if (this.gen === gen) this.flushing = null;
    });
    this.flushing = Promise.race([run, timedOut]);
    return this.flushing;
  }

  private async doFlush(db: D1Database, now: number, gen: number): Promise<void> {
    const sent = this.pending;
    const sentAnon = this.pendingAnon;
    const size = this.dbSize;
    this.pending = zero();
    this.pendingAnon = { login: 0, recover: 0 };
    const hk = hourKey(now);
    const dk = dayKey(now);
    try {
      const [up, day, hour] = await db.batch([
        db
          .prepare(
            `INSERT INTO meter_hourly (hour, requests, rows_read, rows_reg, rows_auth, rows_save, rows_social, rows_acct, rows_board, rows_sys,
               login_attempts, recover_attempts, db_size, updated_at, rows_wallet, rows_live, rows_mon)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT (hour) DO UPDATE SET
               requests = requests + excluded.requests, rows_read = rows_read + excluded.rows_read,
               rows_reg = rows_reg + excluded.rows_reg, rows_auth = rows_auth + excluded.rows_auth,
               rows_save = rows_save + excluded.rows_save, rows_social = rows_social + excluded.rows_social,
               rows_acct = rows_acct + excluded.rows_acct, rows_board = rows_board + excluded.rows_board, rows_sys = rows_sys + excluded.rows_sys,
               rows_wallet = rows_wallet + excluded.rows_wallet, rows_live = rows_live + excluded.rows_live, rows_mon = rows_mon + excluded.rows_mon,
               login_attempts = login_attempts + excluded.login_attempts,
               recover_attempts = recover_attempts + excluded.recover_attempts,
               db_size = CASE WHEN excluded.db_size > 0 THEN excluded.db_size ELSE db_size END,
               updated_at = excluded.updated_at`,
          )
          .bind(
            hk, sent.requests, sent.rowsRead, sent.rows.reg, sent.rows.auth, sent.rows.save, sent.rows.social,
            sent.rows.acct, sent.rows.board, sent.rows.sys, sentAnon.login, sentAnon.recover, size, now, sent.rows.wallet, sent.rows.live, sent.rows.mon,
          ),
        db
          .prepare(
            `SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(rows_read), 0) AS rows_read,
               COALESCE(SUM(rows_reg), 0) AS reg, COALESCE(SUM(rows_auth), 0) AS auth, COALESCE(SUM(rows_save), 0) AS save,
               COALESCE(SUM(rows_social), 0) AS social, COALESCE(SUM(rows_acct), 0) AS acct, COALESCE(SUM(rows_board), 0) AS board,
               COALESCE(SUM(rows_wallet), 0) AS wallet, COALESCE(SUM(rows_live), 0) AS live, COALESCE(SUM(rows_mon), 0) AS mon, COALESCE(SUM(rows_sys), 0) AS sys
             FROM meter_hourly WHERE hour >= ?1 AND hour <= ?2`,
          )
          .bind(`${dk}T00`, `${dk}T23`),
        db.prepare('SELECT login_attempts, recover_attempts FROM meter_hourly WHERE hour = ?1').bind(hk),
      ]);
      // 上报自己的写入记在系统类，下次一起报
      for (const r of [up, day, hour]) this.addD1('sys', r?.meta);
      // 已经超时作废：计数确实写进去了，但档位按超时那一刻的停服处理，等重试时再读
      if (gen !== this.gen) return;
      const d = (day!.results[0] ?? {}) as Record<string, number>;
      const h = (hour!.results[0] ?? {}) as Record<string, number>;
      const counts = zero();
      counts.requests = d.requests ?? 0;
      counts.rowsRead = d.rows_read ?? 0;
      for (const k of CATEGORIES) counts.rows[k] = d[k] ?? 0;
      this.day = { key: dk, counts };
      this.hour = { key: hk, login: h.login_attempts ?? 0, recover: h.recover_attempts ?? 0 };
      this.lastFlushAt = now;
      this.failedAt = 0;
    } catch (e) {
      // 没报上去的加回来，下次重试时一起报
      this.pending.requests += sent.requests;
      this.pending.rowsRead += sent.rowsRead;
      for (const k of CATEGORIES) this.pending.rows[k] += sent.rows[k];
      this.pendingAnon.login += sentAnon.login;
      this.pendingAnon.recover += sentAnon.recover;
      if (gen === this.gen) this.failedAt = now;
      console.error('meter flush failed', e instanceof Error ? e.name : 'unknown');
    }
  }
}

/** 每个 isolate 一份。 */
export let meter = new Meter();

/** 只给测试用：清空本 isolate 的计量状态。 */
export function resetMeterForTests(): void {
  meter = new Meter();
}

let warnedMode = false;

/**
 * API_MODE 开关：不分大小写、去掉首尾空白。设了但认不出的值按 off 处理（fail-closed）——
 * 出事时手忙脚乱写错一个字母，宁可停也不要以为停了其实没停。
 */
function apiMode(env: Env): Tier {
  const raw = env.API_MODE?.trim().toLowerCase();
  if (!raw || raw === 'normal') return 'normal';
  if (raw === 'readonly' || raw === 'off') return raw;
  if (!warnedMode) {
    warnedMode = true;
    console.error('unknown API_MODE, treated as off');
  }
  return 'off';
}

/** 实际档位：计量算出来的和 API_MODE 开关里更严的那个（钱包 RPC 也用它，所以放在这里而不是路由里） */
export function effectiveTier(env: Env, computed: Tier): Tier {
  const order: Tier[] = ['normal', 'noGrowth', 'readonly', 'off'];
  return order[Math.max(order.indexOf(computed), order.indexOf(apiMode(env)))]!;
}
