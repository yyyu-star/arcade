/**
 * PG 模式（db: pg）：D1 后端经 postgres.js 连真的 PostgreSQL 协议。默认用 PGlite（编成 WASM 的 PostgreSQL）+ pglite-socket 在本进程起一个；
 * 设了 ARCADE_TEST_PG_URL 就连那个真的 PostgreSQL（pkg-arcade-host.yml 的 test-pg 作业用 postgres 容器，测试开头会清空 public 模式）。
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureSite, freePort, startSite, type Running } from './harness.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;

let pg: PGlite;
let server: PGLiteSocketServer;
let url: string;

beforeAll(async () => {
  if (process.env.ARCADE_TEST_PG_URL) {
    url = process.env.ARCADE_TEST_PG_URL;
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { onnotice: () => {} });
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await sql.end();
    return;
  }
  pg = await PGlite.create();
  const port = await freePort();
  server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1', maxConnections: 16 } as ConstructorParameters<typeof PGLiteSocketServer>[0]);
  await server.start();
  url = `postgres://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
});
afterAll(async () => {
  await server?.stop();
  // workerd 的连接是 stop 之后才陆续断开的：等它们断完再关库，不然 pglite-socket 在已关的库上清理事务会抛错
  await sleep(500);
  await pg?.close();
});

describe('PG 模式：D1 后端', () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSite(fixtureSite(), { db: 'pg' }, { PROBE_SECRET: 'x', ARCADE_PG_URL: url });
  });
  afterAll(async () => s?.cleanup());
  const p = (path: string, init?: RequestInit) => fetch(`${s.base}/games/probe${path}`, init);
  const d1 = (op: string) => json(p('/d1', { method: 'POST', body: JSON.stringify({ op }) }));

  it('PG 版迁移跑过，写入、raw、BLOB、exec 多行', async () => {
    const r = await d1('insert');
    if (r.error) throw new Error(`${r.error}\n${s.log()}`);
    // PG 没有 last_insert_rowid；rows_written 只算改了的行（不像 SQLite 连索引一起算）
    expect(r).toEqual({ changes: 1, last: 0, written: 1 });
    expect(await d1('raw')).toEqual([['id', 'name'], [1, 'a']]);
    expect(await d1('blob')).toEqual({ data: [1, 2, 255] });
    expect((await d1('exec')).count).toBe(2);
    expect(await d1('count')).toEqual({ n: 4 });
  });

  it('batch 一条出错整体回滚，错误原文还原成 SQLite 的说法', async () => {
    const before = (await d1('count')).n;
    expect((await d1('batch-fail')).error).toMatch(/^D1_ERROR: no such table: nope/);
    expect((await d1('count')).n).toBe(before);
    expect((await d1('unique')).error).toMatch(/UNIQUE constraint failed: items\.name/);
  });

  it('定时任务照常（写进 PG）', async () => {
    const r = await json(fetch(`${s.admin}/cron/run?worker=probe&cron=${encodeURIComponent('17 19 * * *')}`, { method: 'POST' }));
    expect(r).toEqual({ outcome: 'ok' });
    expect(await d1('ticks')).toEqual([{ cron: '17 19 * * *' }]);
  });

  it('SQLite 格式的备份导进 PG：清空重写、核对行数和数字列总和、序列推到最大值之后', async () => {
    const dump = [
      'PRAGMA defer_foreign_keys=TRUE;',
      'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  name TEXT NOT NULL UNIQUE, data BLOB);',
      `INSERT INTO "items" ("id","name","data") VALUES(7,'it''s'||char(10)||'two lines',X'00ff');`,
      `INSERT INTO "items" ("id","name","data") VALUES(9,'plain',NULL);`,
      `INSERT INTO "ticks" ("cron","at") VALUES('* * * * *',1760000000000);`,
      `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_items.sql','2026-10-20 00:00:00');`,
      `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('items',9);`,
    ].join('\n');
    const r = await json(fetch(`${s.admin}/d1/d1-probe-DB/import`, { method: 'POST', body: dump }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.tables.items).toEqual({ rows: 2, sums: { id: 16 } });
    expect(r.tables.ticks).toEqual({ rows: 1, sums: { at: 1760000000000 } });
    expect(await d1('raw')).toEqual([['id', 'name'], [7, "it's\ntwo lines"], [9, 'plain']]);
    // 新插的行不撞号
    expect((await d1('add')).changes).toBe(1);
    expect((await d1('raw')).at(-1)[0]).toBe(10);
    // 坏的备份整体不动
    const bad = await json(fetch(`${s.admin}/d1/d1-probe-DB/import`, { method: 'POST', body: `INSERT INTO "nope" ("a") VALUES(1);` }));
    expect(bad.ok).toBe(false);
    expect((await d1('count')).n).toBe(3);
  });

  it('重启后数据在（在 PG 里），迁移不重跑', async () => {
    const n = (await d1('count')).n;
    await s.restart();
    expect((await d1('count')).n).toBe(n);
    expect(s.log().split('d1pg migration applied').length - 1).toBe(2);
  });
});

describe('PG 模式：KIT_STORE 和重启唤醒（db: pg + storage: memory，什么都不落盘）', () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSite(fixtureSite(), { db: 'pg', storage: 'memory' }, { PROBE_SECRET: 'x', ARCADE_PG_URL: url });
  });
  afterAll(async () => s?.cleanup());
  const kit = (op: string, ...args: unknown[]) => json(fetch(`${s.base}/games/probe/kit`, { method: 'POST', body: JSON.stringify({ op, args }) }));

  it('load / commit / wipe：一个事务、整行覆盖闹钟、按游戏隔开', async () => {
    expect(await kit('load', 'room', '123456')).toEqual({ rows: [], alarmAt: null });
    expect(await kit('commit', 'room', '123456', [['kit_room', '1', '{"a":1}']], [], 2_000_000_000_000)).toEqual({ ok: true });
    expect(await kit('commit', 'room', '123456', [['kit_room', '1', '{"a":2}'], ['kit_room', '2', 'x']], [], null)).toEqual({ ok: true });
    expect(await kit('commit', 'room', '123456', [], [['kit_room', '2']], null)).toEqual({ ok: true });
    expect((await kit('commit', 'room', '123456', [['kit_room', '3', 'x']], [['kit_room', '3']], null)).error).toMatch(/又写又删/);
    expect(await kit('load', 'room', '123456')).toEqual({ rows: [['kit_room', '1', '{"a":2}']], alarmAt: null });
    expect((await kit('load', 'bogus', '1')).error).toMatch(/ns 只许/);
    expect(await kit('wipe', 'room', '123456')).toEqual({ ok: true });
    expect(await kit('load', 'room', '123456')).toEqual({ rows: [], alarmAt: null });
  });

  it('重启后唤醒存了闹钟的对象（kitWake(name)，过期的也唤醒）', async () => {
    await kit('commit', 'room', 'w1', [['kit_room', '1', '{}']], [], Date.now() - 1000);
    await s.restart();
    // 第一次请求触发唤醒（waitUntil 里做），等一下再看
    await fetch(`${s.base}/__health`);
    let v = null;
    for (let i = 0; i < 30 && v === null; i++) {
      await sleep(200);
      v = (await json(fetch(`${s.base}/games/probe/do/w1/kv`))).v;
    }
    expect(v).toBe('woke:w1');
    await kit('wipe', 'room', 'w1');
  });
});
