/**
 * 第 1 步：按年切片。流式读取 WIKI Prices 全量 CSV（约 1.8GB），只保留所需年份的行，写到仓库外的缓存目录。
 *
 *   node tools/data/slice.ts --years 1999,2000,2008
 *   node tools/data/slice.ts --years 1999 --src <csv> --cache <目录>
 *
 * 每个年份 Y 的切片包含 (Y-1)-08-01 到 Y-12-31 的行：前一年下半年的数据用作开局前的历史（β 估计、K 线回看）。
 * 同时写 tickers.json：全量数据里每个代码的首日、末日、行数（用于核对化名表和改写代码重名）。
 * 原始数据和切片都不进仓库（默认缓存在 .data/wiki-prices/slices/）。
 */
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DEFAULT_CACHE, DEFAULT_SRC, arg } from './common.ts';

const src = arg('src', DEFAULT_SRC);
const cache = arg('cache', DEFAULT_CACHE);
const years = arg('years', '1999,2000,2008')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((y) => y >= 1996 && y <= 2018);
if (years.length === 0) {
  console.error('没有有效年份（1996–2018）');
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`找不到原始数据：${src}`);
  process.exit(1);
}
mkdirSync(cache, { recursive: true });

interface Out { year: number; from: string; to: string; fd: number; buf: string[]; rows: number }
const outs: Out[] = years.map((year) => ({
  year,
  from: `${year - 1}-08-01`,
  to: `${year}-12-31`,
  fd: openSync(`${cache}/slice-${year}.csv`, 'w'),
  buf: [],
  rows: 0,
}));

const tickers: Record<string, [string, string, number]> = {};
let header = '';
let total = 0;
const t0 = Date.now();
const rl = createInterface({ input: createReadStream(src, { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
for await (const line of rl) {
  if (header === '') {
    header = line;
    for (const o of outs) writeSync(o.fd, line + '\n');
    continue;
  }
  if (line.length === 0) continue;
  total++;
  const c1 = line.indexOf(',');
  const ticker = line.slice(0, c1);
  const date = line.slice(c1 + 1, c1 + 11);
  const t = tickers[ticker];
  if (t === undefined) tickers[ticker] = [date, date, 1];
  else {
    if (date < t[0]) t[0] = date;
    if (date > t[1]) t[1] = date;
    t[2]++;
  }
  for (const o of outs) {
    if (date >= o.from && date <= o.to) {
      o.buf.push(line);
      o.rows++;
      if (o.buf.length >= 20000) {
        writeSync(o.fd, o.buf.join('\n') + '\n');
        o.buf = [];
      }
    }
  }
  if (total % 2_000_000 === 0) console.log(`  已读 ${(total / 1e6).toFixed(0)}M 行，${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
for (const o of outs) {
  if (o.buf.length > 0) writeSync(o.fd, o.buf.join('\n') + '\n');
  closeSync(o.fd);
  console.log(`slice-${o.year}.csv：${o.rows} 行（${o.from} ~ ${o.to}）`);
}
writeFileSync(`${cache}/tickers.json`, JSON.stringify({ header, total, tickers }));
console.log(`全量 ${total} 行，${Object.keys(tickers).length} 个代码，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
