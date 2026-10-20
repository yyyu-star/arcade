/** 测试共用：发请求、取 cookie、清库、重置本 isolate 的状态。 */
import { env, exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import { limitsOf, setLimitsForTests, type LimitsOverride } from '../worker/api/config';
import { meter, resetMeterForTests } from '../worker/api/meter';
import { resetRateLimitCacheForTests } from '../worker/api/ratelimit';
import { resetMonitorForTests } from '../worker/api/monitor';
import { lastStats } from '../worker/api/router';
import { resetSettingsCacheForTests } from '../worker/api/settings';
import { resetLeaderboardCacheForTests } from '../worker/api/leaderboard';
import { resetWalletRulesCacheForTests } from '../worker/api/wallet-store';
import { resetInviteRulesCacheForTests } from '../worker/api/invite-codes';

export const ORIGIN = 'https://game.test';
const TABLES = ['users', 'sessions', 'credentials', 'friendships', 'blocks', 'saves', 'rate_counters', 'meter_hourly', 'boards', 'settings', 'wallets', 'wallet_stats', 'invites', 'feed', 'feed_reactions', 'challenges', 'challenge_results', 'mates', 'invite_codes', 'monitor_counts'];

/** 测试用的上限：PBKDF2 迭代降到 1,000 省时间；计量只在显式调用或本 isolate 第一次时上报，结果可预期。 */
export const TEST_LIMITS: LimitsOverride = {
  pbkdf2Iterations: 1_000,
  meterFlushCalls: 1e9,
  meterFlushAnonAttempts: 1e9,
  meterFlushMs: 1e12,
  meterEagerRatio: 1e9,
};

/**
 * 测试里的"现在"：固定在某天 UTC 06:30，离整点和 UTC 0 点都远。
 * 接口和测试在同一个 isolate 里，假的 Date 两边都生效。只假 Date，setTimeout 照常走（等 waitUntil、超时测试要用）。
 * 时间不会自己往前走：要"过一会儿"就用 advance()。这样不会有"两次调用落在同一毫秒"或"跑到一半跨了整点、跨了天"的偶发失败。
 */
export const FIXED_NOW = Date.UTC(2026, 9, 14, 6, 30);

export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
}

/** 把假时钟往前拨 ms 毫秒。 */
export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

export async function resetAll(limits: LimitsOverride = {}): Promise<void> {
  freezeClock();
  await env.DB.batch([
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    // 大多数用例要注册普通用户：开关默认打开（"没设过按关"在 admin.test.ts 的"注册开关"里单独测）
    env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('registration', 'open', 0)"),
  ]);
  resetSettingsCacheForTests();
  resetLeaderboardCacheForTests();
  resetWalletRulesCacheForTests();
  resetInviteRulesCacheForTests();
  resetMeterForTests();
  resetRateLimitCacheForTests();
  resetMonitorForTests();
  setLimitsForTests({ ...TEST_LIMITS, ...limits });
}

/** 只改上限，库和计量状态不动。 */
resetAll.limits = async (limits: LimitsOverride): Promise<void> => {
  setLimitsForTests({ ...TEST_LIMITS, ...limits });
};

/** 只清本 isolate 的限流缓存（模拟换了一个 isolate），库不动。 */
resetAll.cacheOnly = async (): Promise<void> => {
  resetRateLimitCacheForTests();
};

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** 原样作为请求体（测试坏 JSON、超大请求体）。 */
  rawBody?: string;
  cookie?: string | null;
  ip?: string;
  /** 默认带对的 X-Arcade 和 Origin；传 false 不带。 */
  csrf?: boolean;
  origin?: string;
  host?: string;
  /** 原样作为 Authorization 头（管理接口的 Bearer 令牌）。 */
  authorization?: string;
}

export async function call(path: string, o: CallOptions = {}): Promise<Response> {
  const method = o.method ?? (o.body !== undefined || o.rawBody !== undefined ? 'POST' : 'GET');
  const headers = new Headers({ 'cf-connecting-ip': o.ip ?? '203.0.113.7' });
  if (method !== 'GET' && o.csrf !== false) {
    headers.set('x-arcade', '1');
    headers.set('origin', o.origin ?? ORIGIN);
  }
  if (o.cookie) headers.set('cookie', `__Host-sid=${o.cookie}`);
  if (o.authorization !== undefined) headers.set('authorization', o.authorization);
  let body: string | undefined = o.rawBody;
  if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers.set('content-type', 'application/json');
  }
  return exports.default.fetch(`https://${o.host ?? 'game.test'}${path}`, { method, headers, body });
}

/** 上一个请求写了几行（按 db.ts 的统计）。 */
export function rowsWritten(): number {
  return lastStats.rowsWritten;
}

export function rowsRead(): number {
  return lastStats.rowsRead;
}

export function rowsBy(cat: keyof typeof lastStats.byCategory): number {
  return lastStats.byCategory[cat];
}

/** 从响应里取 __Host-sid 的值（清 cookie 时为空串）。 */
export function sidOf(res: Response): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = /^__Host-sid=([^;]*)/.exec(c);
    if (m) return m[1]!;
  }
  return null;
}

let seq = 0;
export function uniqueName(prefix = 'user'): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

export const GOOD_PASSWORD = 'Correct-Horse-9';

export async function registerUser(username = uniqueName(), password = GOOD_PASSWORD, ip?: string) {
  const res = await call('/api/auth/register', { body: { username, password, displayName: '玩家' + (seq % 100) }, ip });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { user: { id: string; friendCode: string }; recoveryCode: string };
  return { username, password, cookie: sidOf(res)!, user: data.user, recoveryCode: data.recoveryCode };
}

export async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

export async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const r = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return r?.n ?? 0;
}

export { env, meter };

/** 让本 isolate 立刻上报一次计量。 */
export function flushMeter(): Promise<void> {
  return meter.flush(env.DB, limitsOf(env), Date.now());
}
