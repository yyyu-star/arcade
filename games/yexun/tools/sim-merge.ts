/**
 * 把 tools/sim.ts --json 的几片结果拼成一张表：node tools/sim-merge.ts <目录或 json 文件>... [--json 合并后的文件]
 *
 * 第 7 步全量确认拆到 GitHub 公共 runner 上跑（每格 2,000 局拆 4 片 × 500 局，各片用 --from 错开种子），
 * 下载回来的 artifact 用它按格合并。同一格的片按种子起点排好再拼，重叠或缺口直接报错，免得重复算或漏算。
 * json 里只有每局的结局（赢没赢、打没打倒尸王、撑了几拍），所以这张表只出胜率、尸王、平均撑、实盘期望；节奏指标看各片的 txt。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tierOfDanger, vigilBp } from '../src/content/live.ts';

interface Part {
  diff: number;
  skill: string;
  build: string;
  map: string;
  from?: number;
  runs: [number, number, number][];
}

const args = process.argv.slice(2);
const oi = args.indexOf('--json');
const out = oi >= 0 ? args[oi + 1] : '';
const inputs = args.filter((_, i) => oi < 0 || (i !== oi && i !== oi + 1));
const files: string[] = [];
const walk = (p: string): void => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
  else if (p.endsWith('.json')) files.push(p);
};
for (const p of inputs) walk(p);
if (!files.length) throw new Error('没有找到 json');

const groups = new Map<string, Part[]>();
for (const f of files)
  for (const c of JSON.parse(readFileSync(f, 'utf8')) as Part[]) {
    const k = `${c.map}|${c.diff}|${c.skill}|${c.skill === 'novice' ? '-' : c.build}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const merged: Part[] = [];
const lines: string[] = [];
const order = [...groups.keys()].sort((a, b) => {
  const [ma, da, sa, ba] = a.split('|');
  const [mb, db, sb, bb] = b.split('|');
  return ma!.localeCompare(mb!) || Number(da) - Number(db) || (sa === sb ? 0 : sa === 'novice' ? -1 : 1) || ba!.localeCompare(bb!);
});
for (const k of order) {
  const parts = groups.get(k)!.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  let at = parts[0]!.from ?? 0;
  for (const p of parts) {
    if ((p.from ?? 0) !== at) throw new Error(`${k}：种子片不连续（期望从 ${at + 1} 起，实际 ${(p.from ?? 0) + 1}）`);
    at += p.runs.length;
  }
  const runs = parts.flatMap((p) => p.runs);
  const [map, diff, skill, build] = k.split('|');
  merged.push({ diff: Number(diff), skill: skill!, build: parts[0]!.build, map: map!, from: parts[0]!.from ?? 0, runs });
  const n = runs.length;
  const win = mean(runs.map((r) => r[0]));
  const tier = tierOfDanger(Number(diff));
  const xs = tier ? runs.map((r) => vigilBp(tier, r[2], r[0] === 1, r[1] === 1) / 10_000 - 1) : [];
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
  lines.push(
    [
      map === 'snow' ? '雪原' : '义庄',
      diff,
      skill,
      build,
      n,
      `${(win * 100).toFixed(0)}% ±${(200 * Math.sqrt((win * (1 - win)) / n)).toFixed(0)}`,
      `${(mean(runs.map((r) => r[1])) * 100).toFixed(0)}%`,
      `${(mean(runs.map((r) => r[2])) / 1800).toFixed(1)} 分`,
      tier ? `${m >= 0 ? '+' : ''}${m.toFixed(2)} ±${((2 * sd) / Math.sqrt(n)).toFixed(2)}` : '-',
    ].join(' | '),
  );
}
console.log('地图 | 危险 | 玩家 | 流派 | 局数 | 胜率 ±2SE | 打倒尸王 | 平均撑 | 实盘期望 ±2SE（份）');
for (const l of lines) console.log(l);
if (out) {
  writeFileSync(out, JSON.stringify(merged));
  console.log(`合并后的结局写到 ${out}`);
}
