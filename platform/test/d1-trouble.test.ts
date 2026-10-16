/**
 * D1 一时出错（0.12.0）：文档标了"重试即可"的错误，幂等写退避重试；过载、超时不重试；
 * 漏到接口外面的回 503 unavailable 加 Retry-After，和我们自己的 bug（500 internal）分开，错误形状照旧 { error, message }。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { d1Trouble, Db, newStats } from '../worker/api/db';
import { handleApi } from '../worker/api/router';
import { env, ORIGIN, resetAll } from './helpers';

const lost = () => new Error('D1_ERROR: Network connection lost.');
const overloaded = () => new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.');

/** 只够 Db.run 用的假语句：前 fails 次抛 err，之后成功 */
function flaky(fails: number, err: () => Error) {
  let calls = 0;
  const stmt = {
    run: async () => {
      calls++;
      if (calls <= fails) throw err();
      return { meta: { rows_written: 1, rows_read: 0, changes: 1 } };
    },
  } as unknown as D1PreparedStatement;
  return { stmt, calls: () => calls };
}

beforeEach(() => resetAll());

describe('D1 出错', () => {
  it('分得清：文档里的几种暂时性错误、过载和超时、别的', () => {
    expect(d1Trouble(lost())).toBe('transient');
    expect(d1Trouble(new Error('D1_ERROR: Internal error in D1 DB storage caused object to be reset.'))).toBe('transient');
    expect(d1Trouble(new Error('D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.'))).toBe('transient');
    expect(d1Trouble(overloaded())).toBe('overloaded');
    expect(d1Trouble(new Error('D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.'))).toBe('overloaded');
    expect(d1Trouble(new Error('D1_ERROR: UNIQUE constraint failed: users.username'))).toBeNull();
    expect(d1Trouble('not an error')).toBeNull();
  });

  it('幂等写遇到暂时性错误退避重试，最多 3 次；不幂等的、过载的不重试', async () => {
    const db = new Db(env.DB, newStats(), 'wallet');
    const ok = flaky(2, lost);
    expect((await db.run(ok.stmt, { idempotent: true })).changes).toBe(1);
    expect(ok.calls()).toBe(3);
    const tooMany = flaky(3, lost);
    await expect(db.run(tooMany.stmt, { idempotent: true })).rejects.toThrow('Network connection lost');
    expect(tooMany.calls()).toBe(3);
    const plain = flaky(1, lost);
    await expect(db.run(plain.stmt)).rejects.toThrow();
    expect(plain.calls()).toBe(1);
    const busy = flaky(1, overloaded);
    await expect(db.run(busy.stmt, { idempotent: true })).rejects.toThrow('overloaded');
    expect(busy.calls()).toBe(1);
  });

  it('漏到接口外面：503 unavailable 加 Retry-After（暂时性 2 秒、过载 5 秒），形状和别的错误一样', async () => {
    for (const [err, wait] of [[lost, 2], [overloaded, 5]] as const) {
      const broken = { prepare: () => { throw err(); }, batch: async () => { throw err(); } } as unknown as D1Database;
      const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
      // 先用真的库走一遍，让计量是新鲜的（计量读不到的情况见下一条），再拿坏的库去登录
      await handleApi(new Request(`${ORIGIN}/api/me`), env, ctx);
      const login = new Request(`${ORIGIN}/api/auth/login`, {
        method: 'POST',
        headers: { 'x-arcade': '1', origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'someone', password: 'password-123' }),
      });
      const res = await handleApi(login, { ...env, DB: broken }, ctx);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe(String(wait));
      expect(await res.json()).toEqual({ error: 'unavailable', message: '服务器一时连不上数据库，过几秒再试', retryAfter: wait });
    }
  });

  it('连全站计量都读不到：也是 unavailable（Retry-After 按计量重试间隔），不说"明早恢复"', async () => {
    const broken = { prepare: () => { throw lost(); }, batch: async () => { throw lost(); } } as unknown as D1Database;
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const res = await handleApi(new Request(`${ORIGIN}/api/me`), { ...env, DB: broken }, ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('10');
    expect((await res.json()) as object).toMatchObject({ error: 'unavailable' });
  });
});
