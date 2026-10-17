/** Worker 测试共用：发请求、看假平台钱包、假时间。 */
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import type { FakeBank } from 'arcade-kit/testing';

export const SITE = 'https://game.example.com';
export const BASE = `${SITE}/games/texas`;

/**
 * 假时间放在将来（同 kit 的测试）：设在过去的闹钟会被 workerd 马上真的跑掉。
 * 2030-01-15 12:00 UTC = 北京时间 20:00。
 */
export const FIXED_NOW = Date.UTC(2030, 0, 15, 12, 0);

export function freezeClock(at = FIXED_NOW): void {
  vi.useFakeTimers({ toFake: ['Date'], now: at });
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

const cookie = (sid: string | null): Record<string, string> => (sid ? { cookie: `__Host-sid=${sid}` } : {});

export function get(path: string, sid: string | null): Promise<Response> {
  return exports.default.fetch(`${BASE}${path}`, { headers: cookie(sid), redirect: 'manual' });
}

/** 单机的带入、结回，默认带齐 CSRF 头 */
export function post(path: string, sid: string | null, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-arcade': '1', origin: SITE, ...cookie(sid), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const bankOf = (userId: string) => env.FAKE_BANK.get(env.FAKE_BANK.idFromName(userId));

/** 这个人的钱包（假平台），不算一次调用 */
export async function walletOf(userId: string) {
  return runInDurableObject(bankOf(userId), async (b: FakeBank) => {
    const v = await b.look(Date.now());
    b.calls--;
    return v;
  });
}

/** 假平台被调了几次、写了几次（数 RPC 和写入用） */
export const usage = (userId: string) => runInDurableObject(bankOf(userId), (b: FakeBank) => ({ calls: b.calls, writes: b.writes }));

/** 这个人结回时带上来的小结（平台 0.10.0 settle.stats） */
export const statsOf = (userId: string) => runInDurableObject(bankOf(userId), (b: FakeBank) => b.stats);

/** 报到这个人头上的搭子战绩（0.17.0，平台 15.19 together） */
export const togetherOf = (userId: string) => runInDurableObject(bankOf(userId), (b: FakeBank) => b.together);

let n = 0;
/** 不重复的操作 id（平台要 8–64 位） */
export const op = (): string => `op-${(n++).toString().padStart(6, '0')}`;
