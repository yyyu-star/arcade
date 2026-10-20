#!/usr/bin/env node
/**
 * SQLite → PG 迁移后的核对：SQLite 档的平台库导出（backup.sh 的 d1-arcade-DB.sql）恢复进 PG 档以后，两边逐表逐行比。
 * 导入（/d1/<库>/import）自己核对了行数和数字列的总和；这里再比每一行的每一列，外加钱包的筹码合计
 * （余额 + 桌上的，在 state 的 JSON 里，数字列总和管不到）。迁移完、开站之前跑一次。
 *
 * 用法（仓库根，packages/arcade-host 里先 npm ci）：
 *   node tools/selfhost/pg/verify-import.mjs <导出的 .sql> --pg postgres://…
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const HOST = join(import.meta.dirname, '..', '..', '..', 'packages', 'arcade-host');
const { values: args, positionals } = parseArgs({ options: { pg: { type: 'string' } }, allowPositionals: true });
if (!positionals[0] || !args.pg) {
  console.error('用法：node tools/selfhost/pg/verify-import.mjs <导出的 .sql> --pg postgres://…');
  process.exit(1);
}

const lite = new DatabaseSync(':memory:');
lite.exec(readFileSync(positionals[0], 'utf8'));
const tables = lite
  .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT IN ('d1_migrations', 'sqlite_sequence') AND name NOT LIKE '_cf_%' ORDER BY name")
  .all()
  .map((r) => r.name);

const { default: postgres } = await import(join(HOST, 'node_modules', 'postgres', 'src', 'index.js'));
const pg = postgres(args.pg, { max: 1, onnotice: () => {}, types: { int8: { to: 20, from: [20], serialize: String, parse: Number } } });
const canon = (rows) =>
  rows.map((r) => JSON.stringify(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v]))).sort();

const bad = [];
let total = 0;
try {
  for (const t of tables) {
    const want = canon(lite.prepare(`SELECT * FROM "${t}"`).all());
    const got = canon(await pg.unsafe(`SELECT * FROM "${t}"`));
    total += want.length;
    if (!isDeepStrictEqual(got, want)) {
      const missing = want.filter((x) => !got.includes(x)).length;
      const extra = got.filter((x) => !want.includes(x)).length;
      bad.push(`${t}：SQLite ${want.length} 行，PG ${got.length} 行；PG 缺 ${missing} 行、多 ${extra} 行（含内容不同的）`);
    }
  }
  const chips = (rows) => {
    let sum = 0;
    for (const { state } of rows) {
      const s = JSON.parse(state);
      sum += s.balance + Object.values(s.stakes ?? {}).reduce((a, x) => a + x.amount, 0);
    }
    return sum;
  };
  const a = chips(lite.prepare('SELECT state FROM wallets').all());
  const b = chips(await pg.unsafe('SELECT state FROM wallets'));
  if (a !== b) bad.push(`钱包筹码合计：SQLite ${a}，PG ${b}`);
  console.log(`verify-import：${tables.length} 张表 ${total} 行；钱包筹码合计 SQLite ${a}，PG ${b}`);
} finally {
  await pg.end();
}
if (bad.length) {
  console.error(`verify-import：不一致\n- ${bad.join('\n- ')}`);
  process.exit(1);
}
console.log('verify-import：一致');
