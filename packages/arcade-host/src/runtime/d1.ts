/**
 * D1 的 SQLite 后端：workerd 自带 D1 的客户端（内部模块 cloudflare-internal:d1-api，绑定写成 wrapped），
 * 客户端把每次 prepare/batch/exec 变成 HTTP 请求发给它的 fetcher，这里就是那个 fetcher。
 * 协议照 miniflare 的 D1DatabaseObject（同一版 workerd 的客户端只认这个形状）：
 *   POST /query 或 /execute，请求体 {sql, params} 或它的数组，?resultsFormat=ARRAY_OF_OBJECTS|ROWS_AND_COLUMNS|NONE；
 *   成功回结果数组（每条 {success, results, meta}），失败回 {success:false, error}，客户端按 error 抛 "D1_ERROR: …"。
 * 一次请求里的所有语句在一个事务里（batch 的原子性），出错整体回滚，和 D1 一样。
 *
 * 为什么用 Durable Object 而不是直接开 SQLite 文件：workerd 里 JS 只能经 DO 的 ctx.storage.sql 碰 SQLite，
 * 而且一个库一个对象，天然串行，正好就是 D1 的语义（单写者）。数据在 localDisk 目录里的 <uniqueKey>/<id>.sqlite。
 *
 * 迁移：对象第一次起来时在 blockConcurrencyWhile 里按文件名顺序跑完没跑过的（和 wrangler 同一张 d1_migrations 表、同样的列），
 * 每个文件一个事务。迁移文件由生成器从模块的 migrations_dir 读出来，作为 JSON 绑定 MIGRATIONS 放进配置。
 */
import { DurableObject } from 'cloudflare:workers';

export interface D1Env {
  DB_OBJECT: DurableObjectNamespace<D1Sqlite>;
  /** [[文件名, SQL], ...]，按文件名排好 */
  MIGRATIONS?: [string, string][];
}

type Value = number | string | null | number[];
interface Query {
  sql: string;
  params?: Value[] | null;
}
type Format = 'ARRAY_OF_OBJECTS' | 'ROWS_AND_COLUMNS' | 'NONE';

/** 只有一个库：对象名固定，换名字等于换库 */
const OBJECT_NAME = 'db';
const MIGRATIONS_TABLE = 'd1_migrations';

/** 绑定入口：D1 客户端的 fetcher 指向这个 Worker，原样转给唯一的那个对象 */
export default {
  fetch(request: Request, env: D1Env): Promise<Response> {
    return env.DB_OBJECT.get(env.DB_OBJECT.idFromName(OBJECT_NAME)).fetch(request);
  },
};

export class D1Sqlite extends DurableObject<D1Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: D1Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(async () => this.migrate(env.MIGRATIONS ?? []));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (url.pathname === '/query' || url.pathname === '/execute') return this.query(request, url);
    if (url.pathname === '/__export') return this.export(url);
    if (url.pathname === '/__import') return this.import(await request.text());
    return new Response('not found', { status: 404 });
  }

  private async query(request: Request, url: URL): Promise<Response> {
    let queries: Query[];
    try {
      const body = (await request.json()) as Query | Query[];
      queries = (Array.isArray(body) ? body : [body]).filter((q) => q.sql.replace(/^\s+--.*/gm, '').trim().length > 0);
    } catch (e) {
      return fail(e);
    }
    if (queries.length === 0) return fail(new Error('No SQL statements detected.'));
    const format = parseFormat(url.searchParams.get('resultsFormat'));
    try {
      const results = this.ctx.storage.transactionSync(() => queries.map((q) => this.run(q, format)));
      return Response.json(results, { headers: { 'x-cf-d1-session-commit-token': String(Date.now()) } });
    } catch (e) {
      return fail(e);
    }
  }

  private run(q: Query, format: Format) {
    const before = this.changes();
    const sizeBefore = this.sql.databaseSize;
    const cursor = this.sql.exec(q.sql, ...(q.params ?? []).map((p) => (Array.isArray(p) ? new Uint8Array(p).buffer : p)));
    const columns = cursor.columnNames;
    const rows = Array.from(cursor.raw(), (row) => row.map((v) => (v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : v)));
    const after = this.changes();
    const sizeAfter = this.sql.databaseSize;
    const changes = after.total - before.total;
    return {
      success: true,
      results:
        format === 'ROWS_AND_COLUMNS' ? { columns, rows } : rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
      meta: {
        served_by: 'arcade-host.d1',
        duration: 0,
        changes,
        last_row_id: after.lastRowId,
        changed_db: changes !== 0 || after.lastRowId !== before.lastRowId || sizeAfter !== sizeBefore,
        size_after: sizeAfter,
        rows_read: cursor.rowsRead,
        rows_written: cursor.rowsWritten,
      },
    };
  }

  private changes(): { total: number; lastRowId: number } {
    const row = this.sql.exec<{ t: number; r: number }>('SELECT total_changes() AS t, last_insert_rowid() AS r').one();
    return { total: row.t, lastRowId: row.r };
  }

  private migrate(files: [string, string][]): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
    );
    const done = new Set(this.sql.exec<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`).toArray().map((r) => r.name));
    for (const [name, text] of files) {
      if (done.has(name)) continue;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(text);
        this.sql.exec(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`, name);
      });
      console.log(JSON.stringify({ msg: 'd1 migration applied', name }));
    }
  }

  /**
   * 恢复：整库换成导出文件里的内容。一个事务里先删掉现有的表、索引、视图、触发器，再逐行执行（导出的格式一行一条语句）；
   * 中途出错整体回滚，库保持原样。导出里带着 d1_migrations，恢复后迁移记录也是备份时的样子，之后的新迁移下次起来时照常补跑。
   */
  private import(dump: string): Response {
    const lines = dump.split('\n').filter((l) => l.trim());
    try {
      let n = 0;
      this.ctx.storage.transactionSync(() => {
        // 外键检查推到提交时：删表和导入的先后顺序就不用管父子关系
        this.sql.exec('PRAGMA defer_foreign_keys = ON');
        const objects = this.sql
          .exec<{ type: string; name: string }>(
            "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table', 'view', 'trigger')",
          )
          .toArray();
        for (const o of objects.filter((o) => o.type !== 'table')) this.sql.exec(`DROP ${o.type.toUpperCase()} IF EXISTS ${quoteId(o.name)}`);
        for (const o of objects.filter((o) => o.type === 'table')) this.sql.exec(`DROP TABLE IF EXISTS ${quoteId(o.name)}`);
        for (const line of lines) {
          this.sql.exec(line);
          n++;
        }
      });
      console.log(JSON.stringify({ msg: 'd1 import', statements: n }));
      return Response.json({ ok: true, statements: n });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }

  /**
   * 逻辑备份：整库导出成 SQL 文本（建表 + INSERT），恢复就是在空库上按顺序执行。只经内部的管理入口调（不在站点路由上）。
   * 一次读完整库：这个站的库是 MB 级，不做流式。
   */
  private export(url: URL): Response {
    const tables = url.searchParams.getAll('table');
    return new Response(Array.from(dumpSql(this.sql, new Set(tables))).join('\n') + '\n', {
      headers: { 'content-type': 'application/sql; charset=utf-8' },
    });
  }
}

function parseFormat(v: string | null): Format {
  return v === 'ROWS_AND_COLUMNS' || v === 'NONE' ? v : 'ARRAY_OF_OBJECTS';
}

function fail(e: unknown): Response {
  const error = e instanceof Error ? e.message : String(e);
  return Response.json({ success: false, error });
}

/** 和 wrangler d1 export 同样的格式（miniflare 的 dumpSql）：先表和数据，再索引、触发器、视图 */
export function* dumpSql(sql: SqlStorage, only: Set<string>): Generator<string> {
  yield 'PRAGMA defer_foreign_keys=TRUE;';
  const tables = sql
    .exec<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND sql NOT NULL ORDER BY tbl_name = 'sqlite_sequence', rowid",
    )
    .toArray();
  for (const { name, sql: ddl } of tables) {
    if (only.size && !only.has(name)) continue;
    if (name === 'sqlite_sequence') {
      yield 'DELETE FROM sqlite_sequence;';
    } else if (name.startsWith('_cf_') || name.startsWith('sqlite_')) {
      continue;
    } else {
      yield /^CREATE TABLE ['"]/.test(ddl) ? `CREATE TABLE IF NOT EXISTS ${ddl.substring(13)};` : `${ddl};`;
    }
    const cols = sql.exec<{ name: string }>(`PRAGMA table_info=${quoteId(name)}`).toArray().map((c) => quoteId(c.name));
    const list = cols.join(',');
    for (const row of sql.exec(`SELECT ${cols.join(', ')} FROM ${quoteId(name)}`).raw()) {
      yield `INSERT INTO ${quoteId(name)} (${list}) VALUES(${row.map(literal).join(',')});`;
    }
  }
  for (const { name, sql: ddl } of sql.exec<{ name: string; sql: string }>(
    "SELECT name, sql FROM sqlite_schema WHERE sql NOT NULL AND type IN ('index', 'trigger', 'view') ORDER BY type COLLATE NOCASE",
  )) {
    if (!only.size || only.has(name)) yield `${ddl};`;
  }
}

function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function literal(v: SqlStorageValue): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '9e999' : '-9e999';
  if (typeof v === 'string') {
    // 换行、回车拼成 char()，导出文件一行一条语句。不学 wrangler 写成 replace('…\n…')：原文里本来就有反斜杠 n 的会被恢复错
    return v
      .split(/(\r|\n)/)
      .map((part) => (part === '\r' ? 'char(13)' : part === '\n' ? 'char(10)' : `'${part.replace(/'/g, "''")}'`))
      .filter((part, i, all) => part !== "''" || all.length === 1)
      .join('||');
  }
  return `X'${Array.from(new Uint8Array(v), (b) => b.toString(16).padStart(2, '0')).join('')}'`;
}
