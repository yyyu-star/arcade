/** 每天的清理（7.3）。 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../worker/api/cron';
import worker from '../worker/index';
import { count, env, registerUser, resetAll } from './helpers';

const DAY = 86_400_000;

beforeEach(() => resetAll());

describe('Cron 清理', () => {
  it('删过期会话、过期限流计数、7 天前的计量行和 1 年没登录的账号；新的不动', async () => {
    const now = Date.now();
    const active = await registerUser();
    const idle = await registerUser();
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2').bind(now - 366 * DAY, idle.user.id),
      env.DB.prepare("INSERT INTO sessions VALUES ('old', ?1, 1, 1, 2)").bind(active.user.id),
      env.DB.prepare("INSERT INTO rate_counters VALUES ('login:ip:x', ?1, 3, 0)").bind(now - 3 * DAY),
      env.DB.prepare("INSERT INTO rate_counters VALUES ('login:fail:y', ?1, 9, ?2)").bind(now - 3 * DAY, now + DAY),
      env.DB.prepare("INSERT INTO rate_counters VALUES ('reg:ip:fresh', ?1, 3, 0)").bind(now),
      env.DB.prepare("INSERT INTO meter_hourly (hour, updated_at) VALUES (?1, 0)").bind(new Date(now - 8 * DAY).toISOString().slice(0, 13)),
      env.DB.prepare("INSERT INTO meter_hourly (hour, updated_at) VALUES (?1, 0)").bind(new Date(now - DAY).toISOString().slice(0, 13)),
    ]);

    const { rowsWritten } = await runCleanup(env, now);
    expect(rowsWritten).toBeGreaterThan(0);
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', idle.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?1', idle.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1', idle.user.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'old'")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1', active.user.id)).toBe(1);
    // 窗口早过了但还在锁着的不删
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key IN ('login:ip:x')")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key IN ('login:fail:y', 'reg:ip:fresh')")).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM meter_hourly WHERE hour < ?1', new Date(now - 7 * DAY).toISOString().slice(0, 13))).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM meter_hourly')).toBeGreaterThanOrEqual(1);
  });

  it('中间一段出错（0.19.2）：只跳过这一段，后面的照清', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rate_counters VALUES ('login:ip:x', ?1, 3, 0)").bind(now - 3 * DAY),
      env.DB.prepare("INSERT INTO meter_hourly (hour, updated_at) VALUES (?1, 0)").bind(new Date(now - 8 * DAY).toISOString().slice(0, 13)),
    ]);
    // 让第二段（过期会话）的 DELETE 抛错：表不在了
    await env.DB.prepare('ALTER TABLE sessions RENAME TO sessions_gone').run();
    try {
      await runCleanup(env, now);
    } finally {
      await env.DB.prepare('ALTER TABLE sessions_gone RENAME TO sessions').run();
    }
    // 原来抛错就整个跳出，这两样都还在
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key = 'login:ip:x'")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM meter_hourly WHERE hour < ?1', new Date(now - 7 * DAY).toISOString().slice(0, 13))).toBe(0);
  });

  it('每次最多删 cleanupMaxRows 行，剩下的留到第二天', async () => {
    await resetAll({ cleanupMaxRows: 4 });
    const stmts = Array.from({ length: 10 }, (_, i) => env.DB.prepare('INSERT INTO sessions VALUES (?1, ?2, 1, 1, 2)').bind(`s${i}`, 'u'));
    await env.DB.batch(stmts);
    const { rowsWritten } = await runCleanup(env, Date.now());
    expect(rowsWritten).toBe(4);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(6);
  });

  it('系统类预算用完：当天不清', async () => {
    await env.DB.prepare('INSERT INTO sessions VALUES (?1, ?2, 1, 1, 2)').bind('s', 'u').run();
    await env.DB.prepare('INSERT INTO meter_hourly (hour, rows_sys, updated_at) VALUES (?1, 3500, 0)').bind(new Date().toISOString().slice(0, 13)).run();
    expect((await runCleanup(env, Date.now())).rowsWritten).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
  });

  it('scheduled 入口会跑清理', async () => {
    await env.DB.prepare('INSERT INTO sessions VALUES (?1, ?2, 1, 1, 2)').bind('s', 'u').run();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 19 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });
});

describe('入口', () => {
  it('/games/* 落到平台：没有这个游戏 404（有的游戏由自己的路由接走）', async () => {
    const res = await exports.default.fetch('https://game.test/games/nope/');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('没有这个游戏');
  });
});
