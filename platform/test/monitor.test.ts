/**
 * 监控（docs/platform-backend.md 第 16 节）：/api/health、浏览器报错上报（只认 Origin、限流、去重、写入行数、截断和去掉查询串）、
 * 每 5 分钟的巡检（游戏健康、10 分钟报错数、新签名、只在变了时写）和公开的 /api/monitor（不带用户信息）。
 * 游戏的 /health 由 vitest.config.ts 的 outboundService 假装：德州正常、夜巡 500、其余 404（还没接）。
 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Arcade from '../worker/index';
import { runMonitor } from '../worker/api/monitor';
import { advance, call, count, env, flushMeter, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

const beacon = (body: unknown, o: { ip?: string; origin?: string } = {}) =>
  exports.default.fetch('https://game.test/api/client-error', {
    method: 'POST',
    // sendBeacon 带不了 X-Arcade，只有 Origin
    headers: { origin: o.origin ?? 'https://game.test', 'cf-connecting-ip': o.ip ?? '203.0.113.9', 'content-type': 'text/plain' },
    body: JSON.stringify(body),
  });
const report = (msg: string, o: { game?: string; ver?: string; ip?: string } = {}) => beacon({ game: o.game ?? 'texas', ver: o.ver ?? '1.0.0', msg }, o);
const status = async () => (await (await call('/api/monitor')).json()) as { checks: { id: string; ok: boolean; n?: number; pct?: number; skip?: boolean }[]; at: number | null };
const check = async (id: string) => (await status()).checks.find((c) => c.id === id);

describe('健康检查', () => {
  it('GET /api/health：版本和数据库都好，0 行写入', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; db: boolean };
    expect(body).toMatchObject({ ok: true, db: true });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rowsWritten()).toBe(0);
  });
});

describe('浏览器报错上报', () => {
  it('只认 Origin（不要 X-Arcade）；记 1 行（监控类）、写一行日志；同一签名 5 分钟内不再记，过了再记', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await report('TypeError: x is undefined')).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('mon')).toBe(1);
    expect(log.mock.calls.filter((c) => String(c[0]).includes('client-error'))).toHaveLength(1);
    expect((await report('TypeError: x is undefined')).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    advance(300_000);
    expect((await report('TypeError: x is undefined')).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect(await count("SELECT n AS n FROM monitor_counts WHERE game = 'texas'")).toBe(2);
    expect((await beacon({ game: 'texas', msg: 'a' }, { origin: 'https://evil.example' })).status).toBe(403);
    log.mockRestore();
  });

  it('日志里报错截到 200 字、堆栈截到 1,000 字，路径去掉查询串和 #；库里只存签名不存原文', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await beacon({ game: 'yexun', ver: '0.3.9', msg: 'm'.repeat(500), stack: 's'.repeat(3_000), path: '/games/yexun/?room=123456#x' });
    const line = JSON.parse(String(log.mock.calls.find((c) => String(c[0]).includes('client-error'))![0])) as Record<string, string>;
    expect(line.msg).toHaveLength(200);
    expect(line.stack).toHaveLength(1_000);
    expect(line.path).toBe('/games/yexun/');
    const row = await env.DB.prepare('SELECT * FROM monitor_counts').first<Record<string, unknown>>();
    expect(row).toMatchObject({ game: 'yexun', kind: 'error', n: 1, first_ver: '0.3.9', ver: '0.3.9' });
    expect(JSON.stringify(row)).not.toContain('mmm');
    log.mockRestore();
  });

  it('游戏不在目录里、没有报错内容：400，写 0 行；每个 IP 每分钟最多 10 条', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await beacon({ game: 'nope', msg: 'x' })).status).toBe(400);
    expect((await beacon({ game: 'texas' })).status).toBe(400);
    expect(rowsWritten()).toBe(0);
    for (let i = 0; i < 10; i++) expect((await report(`e${i}`, { ip: '198.51.100.1' })).status).toBe(204);
    const res = await report('e10', { ip: '198.51.100.1' });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    expect((await report('e10', { ip: '198.51.100.2' })).status).toBe(204);
    vi.restoreAllMocks();
  });

  it('监控类预算用完：静默 204，不写', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await resetAll.limits({ budget: { mon: 1 } });
    await report('one');
    await flushMeter();
    expect((await report('two')).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('巡检和 /api/monitor', () => {
  it('游戏健康：正常的 ok、500 的不 ok、没接的跳过；额度和巡检本身也在列；不带用户信息', async () => {
    await runMonitor(env, Date.now(), { wallet: true });
    const s = await status();
    expect(s.checks.find((c) => c.id === 'health:texas')).toEqual({ id: 'health:texas', ok: true });
    expect(s.checks.find((c) => c.id === 'health:yexun')).toEqual({ id: 'health:yexun', ok: false });
    expect(s.checks.find((c) => c.id === 'health:kaipan')).toEqual({ id: 'health:kaipan', ok: true, skip: true });
    expect(s.checks.find((c) => c.id === 'wallet')).toEqual({ id: 'wallet', ok: true });
    expect(s.checks.find((c) => c.id === 'cron')?.ok).toBe(true);
    expect(s.checks.find((c) => c.id === 'quota')?.ok).toBe(true);
    expect(s.at).toBe(Date.now());
    expect(rowsWritten()).toBe(0);
  });

  it('10 分钟内一个游戏报错 ≥ 20 条告警，过了 10 分钟恢复；结果没变不写', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runMonitor(env, Date.now(), { wallet: false });
    // 20 个不同签名、不同 IP（每 IP 每分钟 10 条）
    for (let i = 0; i < 20; i++) await report(`boom ${i}`, { ip: `198.51.100.${i}` });
    advance(300_000);
    await runMonitor(env, Date.now(), { wallet: false });
    expect(await check('errors:texas')).toEqual({ id: 'errors:texas', ok: false, n: 20 });
    expect((await check('errors:kaipan'))?.ok).toBe(true);
    const at = (await status()).at;
    advance(300_000);
    await runMonitor(env, Date.now(), { wallet: false });
    expect((await status()).at).toBe(at);
    advance(300_000);
    await runMonitor(env, Date.now(), { wallet: false });
    expect(await check('errors:texas')).toEqual({ id: 'errors:texas', ok: true });
    vi.restoreAllMocks();
  });

  it('当前版本才出现的新签名报到 5 次就告警（老版本就有的不算）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      await report('new in 2.0', { ver: '2.0.0' });
      advance(300_000);
    }
    await runMonitor(env, Date.now(), { wallet: false });
    expect(await check('errors:texas')).toMatchObject({ ok: false });
    vi.restoreAllMocks();
  });

  it('钱包有负余额：wallet 不 ok，带个数；每 5 分钟那次沿用每天那次的结果', async () => {
    await env.DB.prepare("INSERT INTO wallets VALUES ('u1', 1, ?1, 0)").bind(JSON.stringify({ balance: -5, stakes: [] })).run();
    await runMonitor(env, Date.now(), { wallet: true });
    expect(await check('wallet')).toEqual({ id: 'wallet', ok: false, n: 1 });
    advance(300_000);
    await runMonitor(env, Date.now(), { wallet: false });
    expect(await check('wallet')).toEqual({ id: 'wallet', ok: false, n: 1 });
  });

  it('巡检 30 分钟没更新：cron 不 ok；从没跑过也不 ok', async () => {
    expect((await check('cron'))?.ok).toBe(false);
    await runMonitor(env, Date.now(), { wallet: false });
    advance(1_800_000);
    expect((await check('cron'))?.ok).toBe(false);
  });

  it('每 5 分钟的 Cron 只巡检，每天那次清理后巡检并查钱包', async () => {
    await env.DB.prepare("INSERT INTO wallets VALUES ('u1', 1, ?1, 0)").bind(JSON.stringify({ balance: -5, stakes: [] })).run();
    let ctx = createExecutionContext();
    await new Arcade(ctx, env).scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '*/5 * * * *' }));
    await waitOnExecutionContext(ctx);
    expect(await check('wallet')).toBeUndefined();
    ctx = createExecutionContext();
    await new Arcade(ctx, env).scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 19 * * *' }));
    await waitOnExecutionContext(ctx);
    expect((await check('wallet'))?.ok).toBe(false);
  });
});
