/**
 * SQLite 方言 → PostgreSQL 的机械翻译（PG 模式的 D1 后端用）。只做两边语义确定一致的改写，其余一律交给覆盖表：
 *   - 参数：?N → $N，裸 ? 按 SQLite 的规矩编号（已出现的最大号 + 1）；
 *   - 标量 MIN(a, b, …) / MAX(a, b, …)（两个以上参数）→ LEAST / GREATEST（一个参数的是聚合，不动）；
 *   - a IS b / a IS NOT b（b 不是 NULL、TRUE、FALSE）→ IS NOT DISTINCT FROM / IS DISTINCT FROM（SQLite 的 IS 是不认 NULL 的等于）；
 *   - 去掉 WITHOUT ROWID。
 * 碰到翻不了的写法（json_*、日期函数、INSERT OR …、PRAGMA、sqlite_ 系统表……）抛 NeedsOverride：这条语句必须在覆盖表里有 PG 版，
 * 宁可报错也不猜。字符串字面量、双引号标识符、注释里的内容不动。
 */
export class NeedsOverride extends Error {
  readonly sql: string;
  constructor(sql: string, reason: string) {
    super(`PG 模式没有这条语句的覆盖（${reason}）：${normalize(sql).slice(0, 200)}`);
    this.sql = sql;
  }
}

/** 覆盖表的键：压掉空白（换行、缩进不算差别） */
export function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const UNSUPPORTED: [RegExp, string][] = [
  [/\bjson(_[a-z_]+)?\s*\(/i, 'JSON 函数'],
  [/\b(strftime|julianday|unixepoch|datetime|date|time)\s*\(/i, '日期函数'],
  [/\bINSERT\s+OR\b/i, 'INSERT OR …'],
  [/\bREPLACE\s+INTO\b/i, 'REPLACE INTO'],
  [/\bPRAGMA\b/i, 'PRAGMA'],
  [/\bsqlite_[a-z_]+/i, 'SQLite 系统表'],
  [/\b(GLOB|REGEXP)\b/i, 'GLOB/REGEXP'],
  [/\b(typeof|iif|printf|instr|group_concat|total|randomblob|hex|unhex|zeroblob|last_insert_rowid|changes)\s*\(/i, 'SQLite 专有函数'],
  [/\brandom\s*\(/i, 'random()（SQLite 回整数，PG 回小数）'],
  [/\bLIKE\b/i, 'LIKE（SQLite 不分大小写）'],
  [/\bAUTOINCREMENT\b/i, 'AUTOINCREMENT'],
  [/\b(?<!WITHOUT\s+)rowid\b/i, 'rowid'],
];

type Seg = { code: boolean; text: string };

/** 按字符串字面量、双引号标识符、注释切开：只改 code 段 */
function segments(sql: string): Seg[] {
  const out: Seg[] = [];
  let buf = '';
  let i = 0;
  const flush = (code: boolean) => {
    if (buf) out.push({ code, text: buf });
    buf = '';
  };
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      flush(true);
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out.push({ code: false, text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      flush(true);
      const j = sql.indexOf('\n', i);
      const end = j < 0 ? sql.length : j;
      out.push({ code: false, text: sql.slice(i, end) });
      i = end;
    } else if (c === '/' && sql[i + 1] === '*') {
      flush(true);
      const j = sql.indexOf('*/', i + 2);
      const end = j < 0 ? sql.length : j + 2;
      out.push({ code: false, text: sql.slice(i, end) });
      i = end;
    } else {
      buf += c;
      i++;
    }
  }
  flush(true);
  return out;
}

export function translate(sql: string, overrides: Record<string, string> = {}): string {
  const hit = overrides[normalize(sql)];
  if (hit !== undefined) return hit;
  // 字符串、双引号标识符、注释先换成占位符（\u0000序号\u0000），改写完再换回去：改写只碰代码
  const kept: string[] = [];
  const masked = segments(sql)
    .map((seg) => (seg.code ? seg.text : `\u0000${kept.push(seg.text) - 1}\u0000`))
    .join('');
  for (const [re, why] of UNSUPPORTED) if (re.test(masked)) throw new NeedsOverride(sql, why);
  // 参数编号要看整条语句（裸 ? 接着已出现的最大号往下编）
  let max = 0;
  for (const m of masked.matchAll(/\?(\d+)/g)) max = Math.max(max, Number(m[1]));
  const out = scalarMinMax(
    masked
      .replace(/\?(\d+)|\?/g, (_all, n: string | undefined) => (n ? `$${n}` : `$${++max}`))
      .replace(/\s*\bWITHOUT\s+ROWID\b/gi, '')
      .replace(/\bIS\s+NOT\s+(?!NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi, 'IS DISTINCT FROM ')
      .replace(/\bIS\s+(?!NOT\b|NULL\b|TRUE\b|FALSE\b|DISTINCT\b)/gi, 'IS NOT DISTINCT FROM '),
  );
  return out.replace(/\u0000(\d+)\u0000/g, (_all, i: string) => kept[Number(i)]!);
}

/** MIN(a, b) → LEAST(a, b)：数顶层逗号（括号里的不算；字符串已经换成占位符了） */
function scalarMinMax(sql: string): string {
  let out = '';
  let i = 0;
  const re = /\b(MIN|MAX)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let commas = 0;
    for (let j = open; j < sql.length; j++) {
      const c = sql[j]!;
      if (c === '(') depth++;
      else if (c === ')') {
        if (--depth === 0) break;
      } else if (c === ',' && depth === 1) commas++;
    }
    if (commas > 0) {
      out += sql.slice(i, m.index) + (m[1]!.toUpperCase() === 'MIN' ? 'LEAST' : 'GREATEST') + '(';
      i = open + 1;
    }
  }
  return out + sql.slice(i);
}
