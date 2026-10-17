/**
 * 把 docs/platform-backend.md 7.2 依赖的 D1 行为写成测试（本地 miniflare 实测，2026-10-13）。
 * 线上 D1 和本地的计数口径如有不同（暗上线后用 wrangler tail 或 GraphQL 对账核对），改这里和文档。
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAll } from './helpers';

const run = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).run();

describe('D1 写入行数（7.2 的依据）', () => {
  beforeEach(() => resetAll());

  it('WITHOUT ROWID：表本身 1 行，每个受影响的索引再 1 行', async () => {
    expect((await run("INSERT INTO users (id, username, display_name, friend_code, avatar_json, catchphrase_id, created_at, last_seen_at, role) VALUES ('u1','alice','甲','FC1',NULL,NULL,1,1,'user')")).meta.rows_written).toBe(3);
    expect((await run("INSERT INTO sessions VALUES ('h1','u1',1,1,9)")).meta.rows_written).toBe(2);
    expect((await run("INSERT INTO credentials VALUES ('u1','password','x',1)")).meta.rows_written).toBe(1);
    expect((await run("INSERT INTO friendships VALUES ('a','b','pending','a',1)")).meta.rows_written).toBe(2);
    expect((await run("INSERT INTO saves VALUES ('u1','kaipan','profile',1,'{}',2,1)")).meta.rows_written).toBe(1);
  });

  it('0002 加的 role 列（带默认值和 CHECK，没建索引）不改变插入行数：users 仍是 3 行', async () => {
    expect((await run("INSERT INTO users (id, username, display_name, friend_code, created_at, last_seen_at) VALUES ('u2','bob','乙','FC9',1,1)")).meta.rows_written).toBe(3);
    expect((await env.DB.prepare("SELECT role FROM users WHERE id = 'u2'").first<{ role: string }>())?.role).toBe('user');
    await expect(run("INSERT INTO users (id, username, display_name, friend_code, avatar_json, catchphrase_id, created_at, last_seen_at, role) VALUES ('u3','carol','丙','FC8',NULL,NULL,1,1,'root')")).rejects.toThrow(/CHECK/);
  });

  it('0005 钱包：插入、带 rev 条件的更新都是 1 行；rev 对不上 0 行；删一行 1 行', async () => {
    expect((await run("INSERT INTO wallets VALUES ('u1', 1, '{}', 1)")).meta.rows_written).toBe(1);
    expect((await run("UPDATE wallets SET state = '{\"a\":1}', rev = 2, updated_at = 2 WHERE user_id = 'u1' AND rev = 1")).meta.rows_written).toBe(1);
    expect((await run("UPDATE wallets SET state = '{}', rev = 3, updated_at = 3 WHERE user_id = 'u1' AND rev = 1")).meta.rows_written).toBe(0);
    expect((await run("INSERT INTO wallets VALUES ('u1', 1, '{}', 1) ON CONFLICT (user_id) DO NOTHING")).meta.rows_written).toBe(0);
    expect((await run("INSERT INTO wallet_stats VALUES ('2026-10-15', '{}', 1)")).meta.rows_written).toBe(1);
    expect((await run("DELETE FROM wallets WHERE user_id = 'u1'")).meta.rows_written).toBe(1);
    expect((await env.DB.prepare('SELECT rows_wallet FROM meter_hourly LIMIT 0').all()).success).toBe(true);
  });

  it('对照：TEXT 主键的普通表多一个自动索引，插入 2 行', async () => {
    await run('CREATE TABLE t_rowid (k TEXT PRIMARY KEY, v INTEGER)');
    expect((await run("INSERT INTO t_rowid VALUES ('a', 1)")).meta.rows_written).toBe(2);
    await run('DROP TABLE t_rowid');
  });

  it('更新：不碰索引列 1 行，改了唯一索引列 2 行；没改到 0 行', async () => {
    await run("INSERT INTO users (id, username, display_name, friend_code, avatar_json, catchphrase_id, created_at, last_seen_at, role) VALUES ('u1','alice','甲','FC1',NULL,NULL,1,1,'user')");
    expect((await run("UPDATE users SET last_seen_at = 2 WHERE id = 'u1'")).meta.rows_written).toBe(1);
    expect((await run("UPDATE users SET friend_code = 'FC2' WHERE id = 'u1'")).meta.rows_written).toBe(2);
    await run("INSERT INTO friendships VALUES ('a','b','pending','a',1)");
    expect((await run("UPDATE friendships SET status = 'accepted' WHERE user_a = 'a'")).meta.rows_written).toBe(1);
    expect((await run("UPDATE users SET last_seen_at = 3 WHERE id = 'nobody'")).meta.rows_written).toBe(0);
  });

  it('删除：带索引的表删一行也只算 1 行（文档原先按 2 行估）；删不存在的行 0 行', async () => {
    await run("INSERT INTO sessions VALUES ('h1','u1',1,1,9)");
    expect((await run("DELETE FROM sessions WHERE token_hash = 'h1'")).meta.rows_written).toBe(1);
    await run("INSERT INTO friendships VALUES ('a','b','pending','a',1)");
    expect((await run("DELETE FROM friendships WHERE user_a = 'a'")).meta.rows_written).toBe(1);
    expect((await run("DELETE FROM rate_counters WHERE key = 'none'")).meta.rows_written).toBe(0);
  });

  it('带条件的 UPSERT：超限时 0 行写入、不返回行（5.4）', async () => {
    const up = () =>
      env.DB.prepare(
        `INSERT INTO rate_counters (key, window_start, count) VALUES ('k', 0, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < 2 RETURNING count`,
      ).all();
    const a = await up();
    const b = await up();
    const c = await up();
    expect([a.meta.rows_written, b.meta.rows_written, c.meta.rows_written]).toEqual([1, 1, 0]);
    expect(c.results).toEqual([]);
  });

  it('每次调用的 meta 都带 size_after（整库字节数，6.6 的存储档位用它）', async () => {
    const r = await env.DB.prepare('SELECT 1').all();
    expect(r.meta.size_after).toBeGreaterThan(0);
    const b = await env.DB.batch([env.DB.prepare('SELECT 1'), env.DB.prepare("DELETE FROM users WHERE id = 'x'")]);
    for (const x of b) expect(x.meta.size_after).toBeGreaterThan(0);
  });
});
