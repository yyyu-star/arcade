/**
 * D1 的 PostgreSQL 后端（PG 模式，v2.1：部署时和 SQLite 二选一，不留 SQLite 文件）。和 d1.ts 同一个协议（workerd 自带的 D1 客户端原样用），
 * 平台的代码一行不改：SQL 经 sql-translate.ts 机械翻译或查覆盖表（由站点给，平台模块外的数据），PG 的报错还原成 SQLite 的原文
 * （平台按 "UNIQUE" 认重复），结果里的 int8/numeric 回数字、布尔回 0/1（SQLite 没有布尔）。
 *
 * 为什么是 Durable Object：workerd 不许把一个请求里开的连接拿到别的请求里用，连接池只能常驻在一个对象里；
 * 一个库一个对象，所有查询经它出去，也和 D1 的单写者一样。PG 驱动是 postgres.js（workerd 版走 cloudflare:sockets 出站 TCP）。
 *
 * 迁移：PG 版的迁移文件由站点给（MIGRATIONS，和 SQLite 版一一对应，CI 查漏写），和 wrangler 一样记在 d1_migrations 表。
 * 导入：/__import 收 d1.ts 导出的 SQLite 格式备份（SQLite → PG 的数据迁移就是它），逐行解析 INSERT、按参数写入，一个事务；
 * 写完逐表核对行数和每个数字列的总和（钱包余额就在里面），对不上整体回滚。PG 自己的备份用 pg_dump，不走这里的导出。
 */
import { DurableObject } from 'cloudflare:workers';
import postgres from 'postgres';
import { normalize, translate } from './sql-translate';

export interface D1PgEnv {
  DB_OBJECT: DurableObjectNamespace<D1Pg>;
  /** 连接串，运行时从环境变量取（ARCADE_PG_URL），不进配置文件 */
  PG_URL: string | null;
  /** [[文件名, PG 版 SQL], ...]，按文件名排好 */
  MIGRATIONS?: [string, string][];
  /** 规范化后的 SQLite 语句 → PG 版 */
  OVERRIDES?: Record<string, string>;
}

type Value = number | string | null | number[];
interface Query {
  sql: string;
  params?: Value[] | null;
}
type Format = 'ARRAY_OF_OBJECTS' | 'ROWS_AND_COLUMNS' | 'NONE';

const OBJECT_NAME = 'db';

export default {
  fetch(request: Request, env: D1PgEnv): Promise<Response> {
    return env.DB_OBJECT.get(env.DB_OBJECT.idFromName(OBJECT_NAME)).fetch(request);
  },
};

export class D1Pg extends DurableObject<D1PgEnv> {
  private pg: postgres.Sql;
  private ready: Promise<void>;
  private cache = new Map<string, string>();

  constructor(ctx: DurableObjectState, env: D1PgEnv) {
    super(ctx, env);
    if (!env.PG_URL) throw new Error('PG 模式要设 ARCADE_PG_URL');
    this.pg = postgres(env.PG_URL, {
      max: 4,
      idle_timeout: 60,
      // 和 SQLite 回的类型对齐：int8（count、bigint 列）、numeric（SUM）回数字，布尔回 0/1
      types: {
        int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
        numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
        bool: { to: 16, from: [16], serialize: (x: unknown) => (x ? 't' : 'f'), parse: (x: string) => (x === 't' ? 1 : 0) },
      },
      onnotice: () => {},
    });
    this.ready = this.migrate(env.MIGRATIONS ?? []);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    try {
      await this.ready;
    } catch (e) {
      // 迁移失败（库连不上、迁移写错）：下一个请求再试
      this.ready = this.migrate(this.env.MIGRATIONS ?? []);
      return fail(e);
    }
    if (url.pathname === '/query' || url.pathname === '/execute') return this.query(request, url);
    if (url.pathname === '/__import') return this.import(await request.text());
    if (url.pathname === '/__export') return new Response('PG 模式的备份用 pg_dump\n', { status: 501 });
    return new Response('not found', { status: 404 });
  }

  private pgSql(sql: string): string {
    let hit = this.cache.get(sql);
    if (hit === undefined) {
      hit = translate(sql, this.env.OVERRIDES ?? {});
      this.cache.set(sql, hit);
    }
    return hit;
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
    const format = url.searchParams.get('resultsFormat') === 'ROWS_AND_COLUMNS' ? 'ROWS_AND_COLUMNS' : 'ARRAY_OF_OBJECTS';
    try {
      const translated = queries.map((q) => ({ sql: this.pgSql(q.sql), params: (q.params ?? []).map(param) }));
      const run = async (tx: postgres.TransactionSql | postgres.Sql) => {
        const out = [];
        for (const q of translated) out.push(shape(await tx.unsafe(q.sql, q.params as postgres.ParameterOrJSON<never>[]).values(), format));
        return out;
      };
      // 一个请求一个事务（batch 的原子性）；只有一条语句时 PG 本身就是一个事务
      const results = translated.length === 1 ? await run(this.pg) : await this.pg.begin(run);
      return Response.json(results, { headers: { 'x-cf-d1-session-commit-token': String(Date.now()) } });
    } catch (e) {
      return fail(e);
    }
  }

  private async migrate(files: [string, string][]): Promise<void> {
    await this.pg.unsafe(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id SERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMPTZ DEFAULT now() NOT NULL)',
    );
    const done = new Set((await this.pg.unsafe<{ name: string }[]>('SELECT name FROM d1_migrations')).map((r) => r.name));
    for (const [name, text] of files) {
      if (done.has(name)) continue;
      await this.pg.begin(async (tx) => {
        await tx.unsafe(text);
        await tx.unsafe('INSERT INTO d1_migrations (name) VALUES ($1)', [name]);
      });
      console.log(JSON.stringify({ msg: 'd1pg migration applied', name }));
    }
  }

  /**
   * SQLite 格式的备份（d1.ts 的导出）整库导进 PG：清空所有表（d1_migrations 除外，PG 有自己的迁移记录）再写，
   * 写完核对每张表的行数和每个数字列的总和，对不上就回滚。自增列的序列推到最大值之后。
   */
  private async import(dump: string): Promise<Response> {
    let rows: ParsedInsert[];
    try {
      rows = dump
        .split('\n')
        .filter((l) => l.startsWith('INSERT INTO '))
        .map(parseInsert)
        .filter((r) => r.table !== 'd1_migrations' && r.table !== 'sqlite_sequence');
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    const want = summarize(rows);
    try {
      const report = await this.pg.begin(async (tx) => {
        const tables = (
          await tx.unsafe<{ t: string }[]>(
            "SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'd1_migrations'",
          )
        ).map((r) => r.t);
        if (tables.length) await tx.unsafe(`TRUNCATE ${tables.map(quoteId).join(', ')} RESTART IDENTITY CASCADE`);
        for (const r of rows) {
          await tx.unsafe(
            `INSERT INTO ${quoteId(r.table)} (${r.columns.map(quoteId).join(', ')}) VALUES (${r.values.map((_, i) => `$${i + 1}`).join(', ')})`,
            r.values as postgres.ParameterOrJSON<never>[],
          );
        }
        // 核对：行数、数字列的总和
        const got: Record<string, { rows: number; sums: Record<string, number> }> = {};
        for (const [table, s] of Object.entries(want)) {
          const cols = Object.keys(s.sums);
          const sel = [`count(*) AS "#"`, ...cols.map((c) => `COALESCE(SUM(${quoteId(c)}), 0) AS ${quoteId(c)}`)].join(', ');
          const [row] = await tx.unsafe<Record<string, number>[]>(`SELECT ${sel} FROM ${quoteId(table)}`);
          got[table] = { rows: Number(row!['#']), sums: Object.fromEntries(cols.map((c) => [c, Number(row![c])])) };
          if (got[table].rows !== s.rows || cols.some((c) => got[table]!.sums[c] !== s.sums[c])) {
            throw new Error(`导入后 ${table} 对不上：备份 ${JSON.stringify(s)}，PG ${JSON.stringify(got[table])}`);
          }
        }
        // SERIAL / IDENTITY 列的序列推到当前最大值之后，之后新插的行不撞号
        const seqs = await tx.unsafe<{ t: string; c: string; s: string }[]>(
          `SELECT c.table_name AS t, c.column_name AS c, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) AS s
             FROM information_schema.columns c WHERE c.table_schema = current_schema() AND pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) IS NOT NULL`,
        );
        for (const q of seqs) {
          if (q.t === 'd1_migrations') continue;
          await tx.unsafe(`SELECT setval($1, COALESCE((SELECT MAX(${quoteId(q.c)}) FROM ${quoteId(q.t)}), 0) + 1, false)`, [q.s]);
        }
        return got;
      });
      console.log(JSON.stringify({ msg: 'd1pg import', tables: Object.keys(report).length, rows: rows.length }));
      return Response.json({ ok: true, tables: report });
    } catch (e) {
      return Response.json({ ok: false, error: sqliteMessage(e) }, { status: 400 });
    }
  }
}

function param(v: Value): unknown {
  return Array.isArray(v) ? new Uint8Array(v) : v;
}

function shape(res: postgres.RowList<unknown[][]> | unknown[][], format: Format) {
  const list = res as unknown as unknown[][] & { columns?: { name: string }[]; count?: number; command?: string };
  const columns = (list.columns ?? []).map((c) => c.name);
  const rows = Array.from(list, (row) => row.map((v) => (v instanceof Uint8Array ? Array.from(v) : v)));
  const write = list.command === 'INSERT' || list.command === 'UPDATE' || list.command === 'DELETE';
  const changes = write ? (list.count ?? 0) : 0;
  return {
    success: true,
    results: format === 'ROWS_AND_COLUMNS' ? { columns, rows } : rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
    meta: {
      served_by: 'arcade-host.d1pg',
      duration: 0,
      changes,
      // PG 没有 last_insert_rowid；平台不用它，要用的语句写 RETURNING
      last_row_id: 0,
      changed_db: changes > 0,
      size_after: 0,
      // 和 SQLite 的算法不同（SQLite 连索引一起算）：只算改了的行和回来的行，平台的计量和预算在 PG 模式下只是近似
      rows_read: rows.length,
      rows_written: changes,
    },
  };
}

function fail(e: unknown): Response {
  return Response.json({ success: false, error: sqliteMessage(e) });
}

/**
 * PG 的报错还原成 SQLite / D1 的原文：平台按 "UNIQUE" 认重复（friends.ts），d1Trouble 按 "Network connection lost" 认可重试的写。
 * 认不出来的保留 PG 原文，加上错误码方便查。
 */
export function sqliteMessage(e: unknown): string {
  const err = e as { code?: string; message?: string; table_name?: string; column_name?: string; constraint_name?: string; detail?: string };
  const msg = err?.message ?? String(e);
  switch (err?.code) {
    case '23505': {
      const cols = /^Key \((.+?)\)=/.exec(err.detail ?? '')?.[1]?.split(/,\s*/) ?? [err.constraint_name ?? '?'];
      return `UNIQUE constraint failed: ${cols.map((c) => `${err.table_name ?? '?'}.${c}`).join(', ')}: SQLITE_CONSTRAINT`;
    }
    case '23502':
      return `NOT NULL constraint failed: ${err.table_name ?? '?'}.${err.column_name ?? '?'}: SQLITE_CONSTRAINT`;
    case '23503':
      return 'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT';
    case '23514':
      return `CHECK constraint failed: ${err.constraint_name ?? '?'}: SQLITE_CONSTRAINT`;
    case '42P01':
      return `no such table: ${/relation "(.+?)" does not exist/.exec(msg)?.[1] ?? '?'}: SQLITE_ERROR`;
    case undefined:
      // 连不上、断线：和 D1 的"可以重试"那一类同样的说法
      if (/ECONNREFUSED|ECONNRESET|CONNECTION_|connect|socket|closed/i.test(msg)) return `Network connection lost (pg: ${msg})`;
      return msg;
    default:
      return `${msg} (pg ${err.code})`;
  }
}

function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

// ---- 解析 d1.ts 导出的 INSERT 行（格式是自己写的：一行一条，值只有 NULL、数字、'字符串'（'' 转义、char(n) 用 || 拼）、X'十六进制'） ----

interface ParsedInsert {
  table: string;
  columns: string[];
  values: (number | string | null | Uint8Array)[];
}

export function parseInsert(line: string): ParsedInsert {
  const m = /^INSERT INTO "((?:[^"]|"")+)" \(((?:"(?:[^"]|"")*",?)*)\) VALUES\((.*)\);$/.exec(line);
  if (!m) throw new Error(`看不懂这行备份：${line.slice(0, 120)}`);
  const columns = Array.from(m[2]!.matchAll(/"((?:[^"]|"")*)"/g), (c) => c[1]!.replace(/""/g, '"'));
  const values: ParsedInsert['values'] = [];
  const src = m[3]!;
  let i = 0;
  const err = () => new Error(`看不懂这行备份的值（第 ${i} 个字符）：${line.slice(0, 120)}`);
  while (i < src.length) {
    if (src.startsWith('NULL', i)) {
      values.push(null);
      i += 4;
    } else if (src[i] === 'X' && src[i + 1] === "'") {
      const end = src.indexOf("'", i + 2);
      const hex = src.slice(i + 2, end);
      values.push(new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []));
      i = end + 1;
    } else if (src[i] === "'" || src.startsWith('char(', i)) {
      let s = '';
      for (;;) {
        if (src[i] === "'") {
          let j = i + 1;
          for (;;) {
            if (j >= src.length) throw err();
            if (src[j] === "'") {
              if (src[j + 1] === "'") {
                s += "'";
                j += 2;
              } else break;
            } else s += src[j++];
          }
          i = j + 1;
        } else if (src.startsWith('char(', i)) {
          const end = src.indexOf(')', i);
          s += String.fromCharCode(Number(src.slice(i + 5, end)));
          i = end + 1;
        } else throw err();
        if (src.startsWith('||', i)) i += 2;
        else break;
      }
      values.push(s);
    } else {
      const n = /^-?(\d+(\.\d*)?([eE][+-]?\d+)?)/.exec(src.slice(i));
      if (!n) throw err();
      const t = n[0];
      values.push(t === '9e999' ? Infinity : t === '-9e999' ? -Infinity : Number(t));
      i += t.length;
    }
    if (src[i] === ',') i++;
    else if (i < src.length) throw err();
  }
  if (values.length !== columns.length) throw err();
  return { table: m[1]!.replace(/""/g, '"'), columns, values };
}

/** 每张表的行数、每个"全是数字"的列的总和（备份这边算的，导入后和 PG 比） */
function summarize(rows: ParsedInsert[]): Record<string, { rows: number; sums: Record<string, number> }> {
  const out: Record<string, { rows: number; sums: Record<string, number>; text: Set<string> }> = {};
  for (const r of rows) {
    const t = (out[r.table] ??= { rows: 0, sums: {}, text: new Set() });
    t.rows++;
    r.columns.forEach((c, i) => {
      const v = r.values[i];
      if (typeof v === 'number') t.sums[c] = (t.sums[c] ?? 0) + v;
      else if (v !== null) t.text.add(c);
    });
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, { rows: v.rows, sums: Object.fromEntries(Object.entries(v.sums).filter(([c]) => !v.text.has(c))) }]),
  );
}

export { normalize };
