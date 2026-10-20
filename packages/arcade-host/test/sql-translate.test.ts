import { describe, expect, it } from 'vitest';
import { NeedsOverride, normalize, translate } from '../src/runtime/sql-translate.ts';

describe('SQLite → PG 机械翻译', () => {
  it('参数：?N → $N，裸 ? 接着最大号编', () => {
    expect(translate('SELECT * FROM t WHERE a = ?1 AND b = ?2')).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
    expect(translate('INSERT INTO t (a, b) VALUES (?, ?)')).toBe('INSERT INTO t (a, b) VALUES ($1, $2)');
    expect(translate('SELECT ?2, ?')).toBe('SELECT $2, $3');
  });
  it('字符串、双引号标识符、注释里的不动', () => {
    expect(translate(`SELECT '?1 MIN(a,b) IS x' AS "MAX(1,2)" -- ?3 IS y\nFROM t WHERE a = ?1`)).toBe(
      `SELECT '?1 MIN(a,b) IS x' AS "MAX(1,2)" -- ?3 IS y\nFROM t WHERE a = $1`,
    );
  });
  it('标量 MIN/MAX → LEAST/GREATEST，聚合的不动', () => {
    expect(translate('UPDATE t SET n = MIN(n + ?1, ?2), m = MAX(0, m - 1)')).toBe('UPDATE t SET n = LEAST(n + $1, $2), m = GREATEST(0, m - 1)');
    expect(translate('SELECT MIN(a), MAX(COALESCE(b, 0)) FROM t')).toBe('SELECT MIN(a), MAX(COALESCE(b, 0)) FROM t');
    expect(translate('SELECT MAX(MIN(a, b), c) FROM t')).toBe('SELECT GREATEST(LEAST(a, b), c) FROM t');
  });
  it('IS / IS NOT 一个值 → IS [NOT] DISTINCT FROM；IS NULL 不动', () => {
    expect(translate('SELECT 1 FROM t WHERE a IS ?1 AND b IS NOT ?2 AND c IS NULL AND d IS NOT NULL')).toBe(
      'SELECT 1 FROM t WHERE a IS NOT DISTINCT FROM $1 AND b IS DISTINCT FROM $2 AND c IS NULL AND d IS NOT NULL',
    );
  });
  it('WITHOUT ROWID 去掉；ON CONFLICT / excluded / RETURNING 原样', () => {
    expect(translate('CREATE TABLE t (k TEXT PRIMARY KEY) WITHOUT ROWID').trim()).toBe('CREATE TABLE t (k TEXT PRIMARY KEY)');
    const up = 'INSERT INTO t (k, n) VALUES ($1, 1) ON CONFLICT (k) DO UPDATE SET n = t.n + excluded.n RETURNING n';
    expect(translate('INSERT INTO t (k, n) VALUES (?1, 1) ON CONFLICT (k) DO UPDATE SET n = t.n + excluded.n RETURNING n')).toBe(up);
  });
  it('翻不了的抛 NeedsOverride，覆盖表按规范化后的原文命中', () => {
    const sql = `SELECT json_extract(state, '$.a') AS a\n  FROM wallets WHERE user_id = ?1`;
    expect(() => translate(sql)).toThrow(NeedsOverride);
    for (const bad of ['SELECT random()', 'INSERT OR IGNORE INTO t VALUES (1)', "SELECT strftime('%s')", 'PRAGMA foo', 'SELECT * FROM sqlite_master', "SELECT 1 WHERE a LIKE 'x%'"]) {
      expect(() => translate(bad), bad).toThrow(NeedsOverride);
    }
    const pg = `SELECT (state::jsonb ->> 'a') AS a FROM wallets WHERE user_id = $1`;
    expect(translate(sql, { [normalize(sql)]: pg })).toBe(pg);
  });
});
