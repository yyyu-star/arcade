// 数据管线公用：默认路径、命令行参数、CSV 行解析。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 原始数据（WIKI Prices 全量，4 GB 多）放哪儿：环境变量 KAIPAN_WIKI_PRICES 优先，没设就是模块里的 .data/wiki-prices（被 .gitignore，不进仓库）。
 * 不往家目录或模块外面放东西；几个检出共用一份时，把 .data/wiki-prices 做成指过去的软链，或者设环境变量，不要每份检出复制一遍。
 * 各工具的 --src、--cache、--packs 参数照样能改。
 */
export const DATA_DIR = process.env['KAIPAN_WIKI_PRICES'] || fileURLToPath(new URL('../../.data/wiki-prices', import.meta.url));
export const DEFAULT_SRC = join(DATA_DIR, 'WIKI_PRICES_989367082a7cf822fd35dbe3c8f4969b.csv');
export const DEFAULT_CACHE = join(DATA_DIR, 'slices');
export const OUT_DIR = 'public/data/years';

export function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : def;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** 一行原始数据（未复权）。缺失字段为 NaN。 */
export interface RawRow {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  div: number;
  split: number;
  adjClose: number;
}

function num(s: string | undefined): number {
  if (s === undefined || s === '') return NaN;
  return Number(s);
}

/** 列：ticker,date,open,high,low,close,volume,ex-dividend,split_ratio,adj_open,adj_high,adj_low,adj_close,adj_volume */
export function parseRow(line: string): RawRow | null {
  const f = line.split(',');
  if (f.length < 13) return null;
  return {
    ticker: f[0] as string,
    date: f[1] as string,
    open: num(f[2]),
    high: num(f[3]),
    low: num(f[4]),
    close: num(f[5]),
    volume: num(f[6]),
    div: num(f[7]),
    split: num(f[8]),
    adjClose: num(f[12]),
  };
}

export function round(x: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(x * m) / m;
}

export function pct(x: number, digits = 1): string {
  const s = (x * 100).toFixed(digits);
  return `${x >= 0 ? '+' : ''}${s}%`;
}
