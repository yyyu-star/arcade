#!/usr/bin/env node
/**
 * PG 模式的语句覆盖检查：平台发给 D1 的每一条 SQL，在 PostgreSQL 上都要有能跑的版本。
 *   1. 从 platform/worker 的源码里静态抽出所有 stmt(…) / prepare(…) 的 SQL（拼进去的常量、三元、`?N` 占位符列表都展开成各个变体）；
 *   2. 每条：覆盖表里有就用覆盖表的，没有就走 arcade-host 的机械翻译（翻不了 = 缺覆盖，报文件和行号）；
 *   3. 在真的 PG 上按 PG 版迁移建好表，逐条 PREPARE（语法、表名列名、参数类型能不能推出来）；
 *   4. 覆盖表的每一条都带 samples：SQLite（平台原版迁移）和 PG 灌同一份数据（fixture.sql），按顺序跑同一组参数，结果要一样
 *      （JSON 文本按解析后比，布尔按 D1Pg 的规矩当 1/0）；写语句再带 after：跑完各查一次表，也要一样。
 * 还查：PG 版迁移和平台迁移文件名一一对应；覆盖表里没有已经不存在的语句（平台改了 SQL，旧覆盖要跟着改）。
 *
 * 用法（仓库根，packages/arcade-host 里先 npm ci）：
 *   node tools/selfhost/pg/check-sql.mjs [--pg postgres://…]
 * 不给 --pg 用 PGlite（arcade-host 的开发依赖，内存里的 PG）；CI 用 postgres 服务容器。给 --pg 时库里的 public schema 开始前、结束后都清空（只用测试库）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const HOST = join(ROOT, 'packages', 'arcade-host');
const PLATFORM = join(ROOT, 'platform');
const HERE = import.meta.dirname;
const { translate, normalize, NeedsOverride } = await import(join(HOST, 'src', 'runtime', 'sql-translate.ts'));
const { values: args } = parseArgs({ options: { pg: { type: 'string' } } });

const problems = [];

// ---- 1. 抽语句 ----

/** 读一个 JS 字符串或模板字面量（s[i] 是引号）：parts 里字符串是原文，{ expr } 是 ${…} 里的表达式 */
function readLit(s, i) {
  const q = s[i];
  const parts = [];
  let buf = '';
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      buf += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      j += 2;
    } else if (c === q) {
      parts.push(buf);
      return { parts, end: j + 1 };
    } else if (q === '`' && c === '$' && s[j + 1] === '{') {
      parts.push(buf);
      buf = '';
      let depth = 1;
      let k = j + 2;
      while (depth) {
        const ch = s[k];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === "'" || ch === '"' || ch === '`') k = readLit(s, k).end - 1;
        k++;
      }
      parts.push({ expr: s.slice(j + 2, k - 1).trim() });
      j = k;
    } else {
      buf += c;
      j++;
    }
  }
  throw new Error(`字符串没有结束（位置 ${i}）`);
}

/** 跳过空白和注释 */
function skip(s, i) {
  for (;;) {
    while (/\s/.test(s[i] ?? '')) i++;
    if (s.startsWith('//', i)) i = s.indexOf('\n', i);
    else if (s.startsWith('/*', i)) i = s.indexOf('*/', i) + 2;
    else return i;
  }
}

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk(join(PLATFORM, 'worker'));
const sources = files.map((f) => ({ file: f.slice(ROOT.length + 1), text: readFileSync(f, 'utf8') }));

/** const 名字 → 初始化表达式的原文：先找同一个文件里的，再找别的文件（拼 SQL 用的片段常量会跨文件 import）；别的文件里重名的不认，免得拿错 */
function constsOf(text) {
  const m = new Map();
  for (const x of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const at = x.index + x[0].length;
    const end = text.indexOf(';', /['"`]/.test(text[at]) ? readLit(text, at).end : at);
    if (!m.has(x[1])) m.set(x[1], text.slice(at, end).trim());
  }
  return m;
}
const globalConsts = new Map();
for (const { text } of sources) for (const [k, v] of constsOf(text)) globalConsts.set(k, globalConsts.has(k) ? null : v);
let consts = globalConsts;

/** 顶层（不在括号、字符串里）找字符 */
function topLevel(e, ch, from = 0) {
  let depth = 0;
  for (let i = from; i < e.length; i++) {
    const c = e[i];
    if (c === "'" || c === '"' || c === '`') i = readLit(e, i).end - 1;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === ch) return i;
  }
  return -1;
}

/**
 * 拼进 SQL 的表达式可能取哪些值。看得懂的：字符串、常量名、a ? '…' : '…'（可以连着写）、
 * xs.map((_, i) => `?${i + N}`).join(', ')（占位符列表，取 1 个和 3 个两种）。看不懂的返回 null，报出来让人加规则。
 */
function variants(e, seen = new Set()) {
  e = e.trim();
  if (/^['"`]/.test(e)) {
    const r = readLit(e, 0);
    if (r.end === e.length) return expand(r.parts, seen);
  }
  const q = topLevel(e, '?');
  if (q > 0 && e[q + 1] !== '?' && e[q + 1] !== '.') {
    // 条件 ? 甲 : 乙；乙里还可以再接三元
    let depth = 0;
    for (let i = q + 1; i < e.length; i++) {
      const c = e[i];
      if (c === "'" || c === '"' || c === '`') i = readLit(e, i).end - 1;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (depth === 0 && c === ':') {
        const a = variants(e.slice(q + 1, i), seen);
        const b = variants(e.slice(i + 1), seen);
        return a && b ? [...a, ...b] : null;
      }
    }
    return null;
  }
  const marks = /^[\w$.]+\.map\(\(_, i\) => `\?\$\{i \+ (\d+)\}`\)\.join\(', '\)$/.exec(e);
  if (marks) {
    const n = Number(marks[1]);
    return [`?${n}`, `?${n}, ?${n + 1}, ?${n + 2}`];
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e) && consts.get(e) && !seen.has(e)) return variants(consts.get(e), new Set([...seen, e]));
  return null;
}

function expand(parts, seen) {
  let out = [''];
  for (const p of parts) {
    if (typeof p === 'string') out = out.map((s) => s + p);
    else {
      const v = variants(p.expr, seen);
      if (!v) return null;
      out = out.flatMap((s) => v.map((x) => s + x));
    }
  }
  return out;
}

const statements = [];
for (const { file, text } of sources) {
  const local = constsOf(text);
  consts = { get: (k) => (local.has(k) ? local.get(k) : globalConsts.get(k)) };
  for (const m of text.matchAll(/\.(stmt|prepare)\(/g)) {
    const at = skip(text, m.index + m[0].length);
    const where = `${file}:${text.slice(0, at).split('\n').length}`;
    if (!/['"`]/.test(text[at])) {
      // db.ts 的包装 stmt(sql, …) 把调用方的 SQL 原样交给 prepare
      if (file.endsWith('api/db.ts') && text.startsWith('sql)', at)) continue;
      problems.push(`${where}：SQL 不是字面量（${text.slice(at, at + 40).split('\n')[0]}），检查不了；改成字面量或给本脚本加规则`);
      continue;
    }
    const sqls = expand(readLit(text, at).parts, new Set());
    if (!sqls) problems.push(`${where}：SQL 里拼了看不懂的表达式，检查不了；给本脚本的 variants() 加规则`);
    else for (const sql of new Set(sqls)) statements.push({ where, sql });
  }
}

// ---- 2. 翻译 ----

const overrideList = JSON.parse(readFileSync(join(HERE, 'overrides.json'), 'utf8'));
const overrides = {};
for (const o of overrideList) {
  if (o.sqlite !== normalize(o.sqlite)) problems.push(`覆盖表的 sqlite 要写成规范化的一行：${o.sqlite.slice(0, 80)}`);
  overrides[o.sqlite] = Array.isArray(o.pg) ? o.pg.join('\n') : o.pg;
}
const used = new Set();
const translated = [];
for (const st of statements) {
  const key = normalize(st.sql);
  if (key in overrides) used.add(key);
  try {
    translated.push({ ...st, pg: translate(st.sql, overrides) });
  } catch (e) {
    if (!(e instanceof NeedsOverride)) throw e;
    problems.push(`${st.where}：${e.message}`);
  }
}
for (const k of Object.keys(overrides)) if (!used.has(k)) problems.push(`覆盖表里这条平台已经不发了（改了 SQL 的话覆盖要跟着改）：${k.slice(0, 120)}`);

// ---- 3. PG 上建表、逐条 PREPARE ----

const sqliteDir = join(PLATFORM, 'migrations');
const pgDir = join(HERE, 'migrations');
const sqlFiles = (d) => readdirSync(d).filter((f) => f.endsWith('.sql')).sort();
const a = sqlFiles(sqliteDir);
const b = sqlFiles(pgDir);
if (a.join() !== b.join()) problems.push(`PG 版迁移和平台迁移对不上：平台 ${a.join(' ')}；PG 版 ${b.join(' ')}`);

/** PG 连接的最小接口：exec 跑多条语句；rows 跑一条带参数的，回对象数组 */
async function connect() {
  if (args.pg) {
    const { default: postgres } = await import(join(HOST, 'node_modules', 'postgres', 'src', 'index.js'));
    const num = (to) => ({ to, from: [to], serialize: String, parse: Number });
    const sql = postgres(args.pg, { max: 1, onnotice: () => {}, types: { int8: num(20), numeric: num(1700) } });
    const reset = 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public';
    await sql.unsafe(reset);
    return {
      exec: (q) => sql.unsafe(q),
      rows: async (q, p) => [...(await sql.unsafe(q, p))],
      close: async () => {
        await sql.unsafe(reset);
        await sql.end();
      },
    };
  }
  const { PGlite } = await import(join(HOST, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js'));
  const db = await PGlite.create();
  const num = (v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === 'bigint' ? Number(v) : v);
  return {
    exec: (q) => db.exec(q),
    rows: async (q, p) => (await db.query(q, p)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]))),
    close: () => db.close(),
  };
}

const pg = await connect();
let prepared = 0;
try {
  for (const f of b) await pg.exec(readFileSync(join(pgDir, f), 'utf8'));
  for (const t of translated) {
    try {
      await pg.exec(`PREPARE arcade_check AS ${t.pg}`);
      await pg.exec('DEALLOCATE arcade_check');
      prepared++;
    } catch (e) {
      problems.push(`${t.where}：PG 上 PREPARE 失败（${e.message}）\n    ${normalize(t.pg).slice(0, 300)}`);
    }
  }

  // ---- 4. 覆盖表的结果和 SQLite 对照 ----
  const lite = new DatabaseSync(':memory:');
  for (const f of a) lite.exec(readFileSync(join(sqliteDir, f), 'utf8'));
  const fixture = readFileSync(join(HERE, 'fixture.sql'), 'utf8');
  lite.exec(fixture);
  await pg.exec(fixture);
  const canon = (v) =>
    typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : typeof v === 'bigint' ? Number(v) : typeof v === 'boolean' ? Number(v) : v;
  const same = (sql, got, want) => isDeepStrictEqual(...(/\bORDER BY\b/i.test(sql) ? [got, want] : [sortRows(got), sortRows(want)]));
  const rowsOf = (rs) => rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, canon(v)])));
  let compared = 0;
  for (const o of overrideList) {
    for (const params of o.samples ?? []) {
      // SQLite 的 ?N 按编号绑；node:sqlite 的位置参数按 ?NNN 的号取
      const want = rowsOf(lite.prepare(o.sqlite).all(...params));
      let got;
      try {
        got = rowsOf(await pg.rows(overrides[o.sqlite], params));
      } catch (e) {
        problems.push(`覆盖表的对照：PG 上执行失败（${e.message}）：${o.sqlite.slice(0, 100)}`);
        continue;
      }
      if (!same(o.sqlite, got, want)) {
        problems.push(`覆盖表的对照：结果和 SQLite 不一样，参数 ${JSON.stringify(params)}：${o.sqlite.slice(0, 100)}\n    SQLite ${JSON.stringify(want)}\n    PG     ${JSON.stringify(got)}`);
      }
      if (o.after) {
        const a1 = rowsOf(lite.prepare(o.after).all());
        const a2 = rowsOf(await pg.rows(o.after, []));
        if (!same(o.after, a2, a1)) {
          problems.push(`覆盖表的对照：跑完后表里不一样，参数 ${JSON.stringify(params)}：${o.after}\n    SQLite ${JSON.stringify(a1)}\n    PG     ${JSON.stringify(a2)}`);
        }
      }
      compared++;
    }
    if (!o.samples?.length) problems.push(`覆盖表的这条没有 samples（对照用的参数）：${o.sqlite.slice(0, 100)}`);
  }
  console.log(`check-sql：${statements.length} 条语句（含变体），${Object.keys(overrides).length} 条走覆盖表，PG 上 PREPARE 过 ${prepared} 条，覆盖表对照 ${compared} 组`);
} finally {
  await pg.close();
}

function sortRows(rows) {
  return rows.map((r) => JSON.stringify(r)).sort();
}

if (problems.length) {
  console.error(`check-sql：${problems.length} 个问题\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
