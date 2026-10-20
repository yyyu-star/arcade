/**
 * 行情段库（0.4 重做，里程碑 B）：从年度包切出"一局用的一段真实行情"。
 *
 *   node tools/data/segments.ts                       从 public/data/years 的现有年包切段（默认；现在仓库里的 135 段是用 --packs .data/wiki-prices/packs --step 1 切的）
 *   node tools/data/segments.ts --gap 39 --step 3     两段的开局日至少隔 gap 个交易日（一局 58 天，gap 39 = 重叠不超过三分之一）；候选开局日每 step 天一个
 *   node tools/data/segments.ts --packs <目录> --out <目录> [--manifest <文件>]   指定年包目录、输出目录、id 对照表
 *   node tools/data/segments.ts --retitle             只改现有段文件的标题和大事的行业（不重切行情、不读年包）
 *   node tools/data/segments.ts --full                全量数据到位后一条命令：检查前置条件 → 切片 → 建 1996–2018 年包
 *                                                     （到 .data/wiki-prices/packs，不进仓库）→ 切 150–300 段
 *
 * 一段 = 开局前 WARM 天历史（风口热度预热）+ 一局的交易日数（BALANCE.monthDays 之和）。
 * 每段只放这一局要用的东西：8 个风口各自对应的真实行业（等权合成）、按 0.3 的股票池绑定的真实股票（每个风口 3–7 只）、大盘（老三十）。
 * 价格只存逐日总收益（基点，含拆股分红），不存真实价格，避免用价格反查年份。
 * 产物格式见 docs/core-api.md 第 7.3 节。
 *
 * 防泄漏（0.4.0）：段文件名和 id 是不透明的短哈希（seg_ + 10 位十六进制），文件和目录里不放年份、起止日期和大事原文，
 * 大事只留"一局里第几个交易日"和故事句（tools/data/beats.ts）。id 和真实年份、日期的对照写在
 * tools/data/segments-manifest.json（只给数据工具和测试用，不进画面包）。内部还是按"年-月-市况"的 key 排序、
 * 起标题，所以同一份年包重新生成，id、文件、标题和目录顺序都不变。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BALANCE } from '../../src/core/balance.ts';
import { STOCKS, THEME_IDS } from '../../src/core/content/stocks.ts';
import { assignTitles, dayOfDate, sectorsOf } from '../../src/core/reveal.ts';
import { REGIME_LABEL, THEME_REAL, type Regime, type Segment, type SegmentIndex, type SegmentStock, type SegmentTheme } from '../../src/core/segment.ts';
import type { Role, ThemeId } from '../../src/core/types.ts';
import { DATA_DIR, DEFAULT_CACHE, DEFAULT_SRC, arg, flag, pct } from './common.ts';
import { SEG_EVENTS } from './events.ts';
import { SECTOR_OF } from './sectors.ts';
import { dowMembers } from './dow.ts';
import { SENSITIVE_WORDS } from '../../src/core/content/tales.ts';
import { BEATS } from './beats.ts';
import { createHash } from 'node:crypto';

/** 开局前的历史天数（风口热度预热） */
export const WARM = 20;
/** 一局的交易日数 */
export const DAYS = BALANCE.monthDays.reduce((a, b) => a + b, 0);

interface PackStock {
  id: string;
  name: string | null;
  sec: string | null;
  c: (number | null)[];
  v?: (number | null)[];
  div: [number, number][];
  split: [number, number][];
  delist: [number, number] | null;
}
interface Pack {
  year: number;
  dates: string[];
  start: number;
  stocks: PackStock[];
  index: { c: number[] };
  ref?: { c: number[] };
}

// ---------------------------------------------------------------- 收益

/** 逐日总收益（比例）：ratio × (c + cash) / c_prev − 1；没有行情或算不出的为 null。 */
function totalReturns(s: PackStock, n: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: n }, () => null);
  const split = new Map(s.split);
  const div = new Map(s.div);
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    const c = s.c[i] ?? null;
    if (s.delist && i >= s.delist[0]) break;
    if (c === null) continue;
    if (prev !== null && prev > 0) out[i] = ((split.get(i) ?? 1) * (c + (div.get(i) ?? 0))) / prev - 1;
    prev = c;
  }
  return out;
}

function indexReturns(c: readonly number[]): number[] {
  return c.map((x, i) => (i === 0 ? 0 : x / (c[i - 1] as number) - 1));
}

const bp = (x: number): number => Math.round(x * 10000);

function stats(xs: readonly number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, xs.length - 1);
  return { mean, sd: Math.sqrt(v) };
}

function maxDD(rets: readonly number[]): number {
  let v = 1;
  let peak = 1;
  let dd = 0;
  for (const r of rets) {
    v *= 1 + r;
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return dd;
}

function compound(rets: readonly number[]): number {
  return rets.reduce((v, r) => v * (1 + r), 1) - 1;
}

// ---------------------------------------------------------------- 市况与标题

export function classify(ret: number, dd: number, ref: number, refDD: number): Regime {
  if (dd <= -0.14 || refDD <= -0.3) return 'crash';
  // 泡沫：科技股（科综）一局里猛涨、明显甩开老三十。0.4 全量：0.25 / 0.18 → 0.2 / 0.12，1996–2018 里除了 1999 年还有
  // 1998 年底、2003 年、2009 年这类科技股领涨的疯涨段（原阈值只有 8 段，不够一种市况）
  if (ref >= 0.2 && ref - ret >= 0.12) return 'bubble';
  if (ret >= 0.06) return 'bull';
  // 熊市：0.4 全量 −6% → −4.5%（1996–2018 里阴跌段不多，原阈值只有 13 段）
  if (ret <= -0.045 || ref <= -0.18) return 'bear';
  return 'flat';
}

/** 生成时的段内大事（真实日期和原文，只在数据工具里）。 */
export interface SourceEvent {
  date: string;
  text: string;
  quip: string;
  sectors?: string[];
}

/** 生成时的一段（内部 key 是"年-月-市况"，带真实起止日期）；写盘前用 publish() 换成不透明的段文件。 */
export type SourceSegment = Omit<Segment, 'events'> & { from: string; to: string; year: number; events: SourceEvent[] };

/** 段 id 和对照表里的一条。 */
export interface ManifestEntry {
  id: string;
  key: string;
  from: string;
  to: string;
  year: number;
  regime: Regime;
  title: string;
}

/** id 的盐：只在这里（不进画面包），免得有人按"年-月-市况"穷举出 id。改了它所有段的 id 都会变。 */
const ID_SALT = 'kaipan-0.4-segments';

export function opaqueId(key: string): string {
  return `seg_${createHash('sha256').update(new TextEncoder().encode(`${ID_SALT}:${key}`)).digest('hex').slice(0, 10)}`;
}

/** 内部的段 → 画面用的段文件（不透明 id，没有年份、日期和原文）和对照表里的一条。 */
export function publish(src: SourceSegment): { seg: Segment; entry: ManifestEntry } {
  const id = opaqueId(src.id);
  const events: Segment['events'] = [];
  for (const e of src.events) {
    const defs = BEATS[e.date];
    const def = defs ? (defs.find((d) => d.has !== undefined && e.text.includes(d.has)) ?? defs.find((d) => d.has === undefined) ?? defs[0]) : undefined;
    if (def?.skip) continue;
    events.push({
      day: dayOfDate(src.from, src.to, src.days, e.date),
      ...(def?.t !== undefined ? { t: def.t } : {}),
      ...(def?.alt !== undefined ? { alt: def.alt } : {}),
      sectors: e.sectors ? [...e.sectors] : sectorsOf(e.text),
    });
  }
  const seg: Segment = {
    v: 1,
    id,
    warm: src.warm,
    days: src.days,
    regime: src.regime,
    title: src.title,
    stats: { ...src.stats },
    events,
    market: src.market,
    themes: src.themes,
  };
  return { seg, entry: { id, key: src.id, from: src.from, to: src.to, year: src.year, regime: src.regime, title: src.title } };
}

const MANIFEST = 'tools/data/segments-manifest.json';

/** 写段文件、目录和对照表（目录顺序和内部顺序一致：开局按种子在目录里取第几个，顺序不变则同一种子抽到同一段）。 */
export function writeSegments(segs: readonly SourceSegment[], outDir: string, manifest = MANIFEST): { bytes: number; gz: number } {
  if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(`${outDir}/${f}`);
  mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  let gz = 0;
  const entries: ManifestEntry[] = [];
  for (const s of segs) {
    const { seg, entry } = publish(s);
    if (entries.some((x) => x.id === entry.id)) throw new Error(`段 id 撞了：${entry.id}（${entry.key}）`);
    entries.push(entry);
    const json = JSON.stringify(seg);
    bytes += json.length;
    gz += gzipSync(json).length;
    writeFileSync(`${outDir}/${seg.id}.json`, json);
  }
  const index: SegmentIndex = {
    v: 1,
    source: '公有领域的历史日线；只存相对涨跌（基点），不存价格、年份和公司。',
    segments: entries.map((e) => ({ id: e.id, file: `${e.id}.json` })),
  };
  writeFileSync(`${outDir}/index.json`, JSON.stringify(index, null, 1));
  writeFileSync(manifest, `${JSON.stringify(entries, null, 1)}\n`);
  return { bytes, gz };
}

/** 段内大事（最多 4 条，载入史册的优先），带上行业（局末小故事把大事对应到本局的风口）。 */
export function eventsOf(from: string, to: string): SourceEvent[] {
  // 伤亡、灾害、袭击、停市、选举类不进段文件（故事版标了 skip 的，或文字里有敏感词的）
  const banned = (e: (typeof SEG_EVENTS)[number]): boolean =>
    (BEATS[e.date] ?? []).some((d) => d.skip === true && (d.has === undefined || e.text.includes(d.has))) || SENSITIVE_WORDS.some((w) => e.text.includes(w) || e.quip.includes(w));
  return SEG_EVENTS.filter((e) => e.date >= from && e.date <= to && !banned(e))
    .sort((a, b) => b.weight - a.weight || a.date.localeCompare(b.date))
    .slice(0, 4)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date, text: e.text, quip: e.quip, ...(e.sectors ? { sectors: [...e.sectors] } : {}) }));
}

/** 段标题：游戏化的说法（不透露年代和公司），同一市况按 id 顺序依次取，见 src/core/content/tales.ts。 */
function retitleAll(segs: SourceSegment[]): void {
  const titles = assignTitles(segs);
  for (const s of segs) s.title = titles.get(s.id) ?? s.title;
}

// ---------------------------------------------------------------- 绑定股票

interface Cand {
  s: PackStock;
  r: number[];
  vol: number;
  beta: number;
  corr: number;
  resid: number;
  dd: number;
}

/** 0.3 股票池里每个风口要的角色（按 stocks.ts 的顺序）。 */
function slotsOf(theme: ThemeId): { id: string; role: Role }[] {
  return STOCKS.filter((d) => d.theme === theme).map((d) => ({ id: d.id, role: d.role }));
}

/**
 * 性格分配：按真实波动和与行业的相关性给 0.3 的角色挑真实股票。
 * 先挑妖股（自身波动最大，和行业最不同步），再挑龙头（对行业的 β 最大，有化名的优先），白马（波动最小），
 * ST（这段时间回撤最深），剩下的按和行业的相关性从高到低当小弟。
 */
function assign(theme: ThemeId, cands: Cand[], used: Set<string>): SegmentStock[] {
  const pool = cands.filter((c) => !used.has(c.s.id));
  // 有化名的股票优先：龙头、妖股、小弟按分数 × 1.4；白马、ST 在最合适的前 3 只里挑有化名的
  const named = (c: Cand): number => (c.s.name ? 1.4 : 1);
  const top3 = (score: (c: Cand) => number) => (c: Cand): number => {
    const rank = [...pool].sort((a, b) => score(b) - score(a)).indexOf(c);
    return rank < 3 && c.s.name ? 1e6 - rank : score(c);
  };
  const take = (score: (c: Cand) => number): Cand | null => {
    let best: Cand | null = null;
    let bs = -Infinity;
    for (const c of pool) {
      const v = score(c);
      if (v > bs) {
        bs = v;
        best = c;
      }
    }
    if (best) pool.splice(pool.indexOf(best), 1);
    return best;
  };
  const slots = slotsOf(theme);
  const order: Role[] = ['meme', 'leader', 'bluechip', 'st', 'follower'];
  const out = new Map<string, Cand>();
  for (const role of order) {
    for (const sl of slots.filter((x) => x.role === role)) {
      const c =
        role === 'meme'
          ? take((c) => c.resid * named(c))
          : role === 'leader'
            ? take((c) => c.beta * named(c))
            : role === 'bluechip'
              ? take(top3((c) => -c.vol))
              : role === 'st'
                ? take(top3((c) => -c.dd))
                : take((c) => (c.corr + 1) * named(c));
      if (!c) throw new Error(`风口 ${theme} 的候选股票不够（缺 ${sl.id}）`);
      out.set(sl.id, c);
    }
  }
  // 段文件里不放真实代码、化名：游戏里用的是小人的名字，局末故事也不提公司
  return slots.map((sl, k) => {
    const c = out.get(sl.id) as Cand;
    used.add(c.s.id);
    return { slot: sl.id, id: `${theme}_${k + 1}`, name: null, sec: c.s.sec ?? '', r: c.r.map(bp) };
  });
}

// ---------------------------------------------------------------- 切段

interface Window {
  pack: Pack;
  p: number;
  ret: number;
  dd: number;
  ref: number;
  refDD: number;
  regime: Regime;
}

function windowsOf(pack: Pack, step: number): Window[] {
  const n = pack.dates.length;
  const idx = indexReturns(pack.index.c);
  const ref = pack.ref ? indexReturns(pack.ref.c) : idx;
  const out: Window[] = [];
  for (let p = WARM + 1; p + DAYS <= n; p += step) {
    if ((pack.dates[p] as string) < FIRST_DAY) continue;
    const play = idx.slice(p, p + DAYS);
    const rplay = ref.slice(p, p + DAYS);
    const w = { pack, p, ret: compound(play), dd: maxDD(play), ref: compound(rplay), refDD: maxDD(rplay) };
    out.push({ ...w, regime: classify(w.ret, w.dd, w.ref, w.refDD) });
  }
  return out;
}

const RARITY: Record<Regime, number> = { crash: 5, bubble: 4, bear: 3, bull: 2, flat: 1 };
/** 最早的开局日（1996 年包里还带着 1995 年下半年的历史，只做预热） */
const FIRST_DAY = '1996-01-01';

/**
 * 挑互不雷同的段：任意两段的开局日至少隔 gap 个交易日（按全局交易日历算，跨年包也算；
 * gap = 39 时一局 58 天，相邻两段最多重叠 19 天，即三分之一）。
 * 用动态规划（带权区间调度）在这个约束下先让段数最多，再让稀有市况（崩盘 > 泡沫 > 熊市 > 牛市 > 横盘）、起伏大的行情尽量多：
 * 每段权重 = 100 + 市况稀有度 × 6 + 起伏（|涨跌| − 回撤，封顶 1）。
 */
function choose(ws: Window[], gap: number): Window[] {
  const dates = [...new Set(ws.flatMap((w) => w.pack.dates))].sort();
  const gi = new Map(dates.map((d, i) => [d, i]));
  const at = (w: Window): number => gi.get(w.pack.dates[w.p] as string) as number;
  // 同一个开局日只留一个（相邻两个年包的重叠部分）
  const uniq = new Map<number, Window>();
  for (const w of ws) if (!uniq.has(at(w))) uniq.set(at(w), w);
  const n = dates.length;
  const weight = (w: Window): number => 100 + RARITY[w.regime] * 6 + Math.min(1, Math.abs(w.ret) - w.dd);
  // best[i] = 开局日下标 < i 的窗口里能挑出的最大权重和
  const best = new Float64Array(n + 1);
  const take = new Uint8Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const w = uniq.get(i - 1);
    best[i] = best[i - 1] as number;
    if (w) {
      const v = weight(w) + (best[Math.max(0, i - gap)] as number);
      if (v > (best[i] as number)) {
        best[i] = v;
        take[i] = 1;
      }
    }
  }
  const out: Window[] = [];
  for (let i = n; i > 0; ) {
    if (take[i]) {
      out.push(uniq.get(i - 1) as Window);
      i = Math.max(0, i - gap);
    } else i--;
  }
  return out.sort((a, b) => at(a) - at(b));
}

/** 剔除统计（全量生成时汇报） */
export const DROPS = { jump: 0, volume: 0, zeroVol: 0, dupe: 0 };

/**
 * 全量年份额外检查（build.ts 的清洗之外）：段内（含预热）
 * - 价格跳变：任一天总收益超过 ±40%（真实暴涨暴跌也剔除——一只股票一天翻倍会把一局的风口带歪）；
 * - 成交量异常：成交量为 0 的天数 ≥ 3，或单日成交量超过段内中位数的 60 倍（多半是数据错位或单位错误）；
 * 有问题的股票不进行业平均、不进候选。
 */
function suspicious(s: PackStock, r: (number | null)[], lo: number, hi: number): 'jump' | 'volume' | 'zeroVol' | null {
  if (r.some((x) => x !== null && Math.abs(x) > 0.4)) return 'jump';
  const v = (s.v ?? []).slice(lo, hi).filter((x): x is number => x !== null);
  if (v.length > 0) {
    if (v.filter((x) => x === 0).length >= 3) return 'zeroVol';
    const med = [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] as number;
    if (med > 0 && Math.max(...v) > med * 60) return 'volume';
  }
  return null;
}

/** 同一公司的重复代码（A/B 股、改名前后两个代码）：逐日收益相关系数 ≥ 0.97 的两只只留成交额大的那只（候选按成交额排好序传进来）。 */
function dedupe(xs: { s: PackStock; r: (number | null)[] }[]): { s: PackStock; r: (number | null)[] }[] {
  const keep: { s: PackStock; r: (number | null)[] }[] = [];
  for (const x of xs) {
    const twin = keep.find((k) => {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let i = 0; i < x.r.length; i++) {
        const a = x.r[i], b = k.r[i];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
      }
      if (n < 20) return false;
      const cov = sab / n - (sa / n) * (sb / n);
      const va = saa / n - (sa / n) ** 2;
      const vb = sbb / n - (sb / n) ** 2;
      return va > 0 && vb > 0 && cov / Math.sqrt(va * vb) >= 0.97;
    });
    if (twin) DROPS.dupe++;
    else keep.push(x);
  }
  return keep;
}

function dollarVol(s: PackStock, lo: number, hi: number): number {
  let t = 0;
  for (let i = lo; i < hi; i++) t += (s.c[i] ?? 0) * (s.v?.[i] ?? 0);
  return t;
}

function buildSegment(w: Window): SourceSegment {
  const { pack, p } = w;
  const n = pack.dates.length;
  const lo = p - WARM;
  const hi = p + DAYS;
  const idx = indexReturns(pack.index.c).slice(lo, hi);
  const raw = pack.stocks
    .map((s) => ({ s, r: totalReturns(s, n).slice(lo, hi) }))
    .filter((x) => {
      const bad = suspicious(x.s, x.r, lo, hi);
      if (bad) DROPS[bad]++;
      return bad === null;
    })
    .sort((a, b) => dollarVol(b.s, lo, hi) - dollarVol(a.s, lo, hi));
  const all = dedupe(raw);
  const used = new Set<string>();
  const themes = {} as Record<ThemeId, SegmentTheme>;
  for (const theme of THEME_IDS) {
    const group = THEME_REAL[theme].sectors;
    const members = all.filter((x) => x.s.sec !== null && group.includes(x.s.sec));
    // 行业：组内所有当天有行情的股票等权
    const sec: number[] = idx.map((_, i) => {
      const xs = members.map((m) => m.r[i]).filter((v): v is number => v !== null && v !== undefined);
      return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : (idx[i] as number);
    });
    const full = members.filter((m) => m.r.every((v) => v !== null)) as { s: PackStock; r: number[] }[];
    const cands: Cand[] = full.map((m) => {
      const a = stats(m.r);
      const b = stats(sec);
      let cov = 0;
      for (let i = 0; i < sec.length; i++) cov += ((m.r[i] as number) - a.mean) * ((sec[i] as number) - b.mean);
      cov /= Math.max(1, sec.length - 1);
      const beta = b.sd > 0 ? cov / (b.sd * b.sd) : 1;
      const corr = a.sd > 0 && b.sd > 0 ? cov / (a.sd * b.sd) : 0;
      return { s: m.s, r: m.r, vol: a.sd, beta, corr, resid: a.sd * Math.sqrt(Math.max(0, 1 - corr * corr)), dd: maxDD(m.r.slice(WARM)) };
    });
    const primary = group.find((g) => full.some((m) => m.s.sec === g)) ?? (group[0] as string);
    themes[theme] = { sector: primary, name: THEME_REAL[theme].name, r: sec.map(bp), stocks: assign(theme, cands, used) };
  }
  const from = pack.dates[p] as string;
  const to = pack.dates[hi - 1] as string;
  const events = eventsOf(from, to);
  const id = `${from.slice(0, 7)}-${w.regime}`;
  return {
    v: 1,
    id,
    warm: WARM,
    days: DAYS,
    from,
    to,
    year: Number(from.slice(0, 4)),
    regime: w.regime,
    title: '',
    stats: { ret: Math.round(w.ret * 1000) / 1000, dd: Math.round(w.dd * 1000) / 1000, ref: Math.round(w.ref * 1000) / 1000 },
    events,
    market: idx.map(bp),
    themes,
  };
}

function loadPacks(dir: string): Pack[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Pack);
}

export function generate(packDir: string, outDir: string, gap: number, step: number, manifest = MANIFEST): SourceSegment[] {
  const packs = loadPacks(packDir);
  if (packs.length === 0) throw new Error(`${packDir} 里没有年包`);
  const ws = choose(packs.flatMap((p) => windowsOf(p, step)), gap);
  const segs = ws.map(buildSegment);
  // 同月同市况重名时加后缀
  const seen = new Map<string, number>();
  for (const s of segs) {
    const k = seen.get(s.id) ?? 0;
    seen.set(s.id, k + 1);
    if (k > 0) s.id = `${s.id}-${k + 1}`;
  }
  retitleAll(segs);
  const { bytes, gz } = writeSegments(segs, outDir, manifest);
  const by = new Map<Regime, number>();
  for (const s of segs) by.set(s.regime, (by.get(s.regime) ?? 0) + 1);
  console.log(`行情段 ${segs.length} 段 → ${outDir}（平均 ${Math.round(bytes / segs.length / 1024)}KB，gzip ${Math.round(gz / segs.length / 1024)}KB）`);
  console.log(`市况：${[...by.entries()].map(([k, v]) => `${REGIME_LABEL[k]} ${v}`).join('、')}`);
  console.log(`总体积 ${(bytes / 1024 / 1024).toFixed(2)}MB（gzip ${(gz / 1024 / 1024).toFixed(2)}MB）；剔除股票次数：跳变 ${DROPS.jump}、成交量异常 ${DROPS.volume}、零成交 ${DROPS.zeroVol}、同一公司重复 ${DROPS.dupe}（按段累计）`);
  for (const s of segs) {
    console.log(
      `  ${s.id.padEnd(20)}${s.from}–${s.to}  ${REGIME_LABEL[s.regime]}  大盘 ${pct(s.stats.ret)} 回撤 ${pct(s.stats.dd)} 科综 ${pct(s.stats.ref)}  ${s.title}  大事 ${s.events.length}`,
    );
  }
  return segs;
}

// ---------------------------------------------------------------- 全量

/**
 * 全量数据（1996–2018）到位后的一条命令。现在还缺的东西会逐条列出，缺了就停在那一步：
 * 1. 原始 CSV：.data/wiki-prices/WIKI_PRICES_*.csv（用户把 Nasdaq key 放进 ~/.config/nasdaq/nasdaq.env 后下载）；
 * 2. 行业标注：tools/data/sectors.ts 已按 candidates.ts --top 300 补到 1996–2018（2026-10-12）；换口径时再跑
 *    `node tools/data/candidates.ts --year <年> --missing` 列出缺行业的候选并补进 sectors.ts；
 * 3. 老三十成分：tools/data/dow.ts 只有 1998–2000、2007–2008 的道指成分和换股，1996–2018 其他年份要补成分名单和换股日；
 * 4. 大事：tools/data/events.ts 只有 1999、2000、2008 三年，其他年份的段没有大事时局末小故事只讲行情和玩家自己（不影响生成）；
 *    新增的大事要在 tools/data/beats.ts 的 BEATS 里写故事版，否则按大盘方向用通用句。
 */
function full(): void {
  const years = arg('years', '1996-2018');
  const [a, b] = years.split('-').map(Number) as [number, number];
  const list: number[] = [];
  for (let y = a; y <= (b ?? a); y++) list.push(y);
  const packs = arg('packs', join(DATA_DIR, 'packs'));
  const hard: string[] = [];
  if (!existsSync(arg('src', DEFAULT_SRC))) hard.push(`缺原始数据 ${arg('src', DEFAULT_SRC)}：等 ~/.config/nasdaq/nasdaq.env 就位后下载 WIKI Prices 全量`);
  const noDow = list.filter((y) => dowMembers(`${y}-03-01`).length !== 30);
  if (noDow.length > 0) hard.push(`tools/data/dow.ts 缺这些年份的老三十成分与换股：${noDow.join('、')}`);
  const noEvents = list.filter((y) => !SEG_EVENTS.some((e) => e.date.startsWith(String(y))));
  if (noEvents.length > 0) console.log(`提示：tools/data/events.ts 没有这些年份的大事（局末小故事只讲行情和玩家自己）：${noEvents.join('、')}`);
  if (hard.length > 0 || !flag('force')) {
    console.log('全量生成的前置条件：');
    for (const p of hard) console.log(`  ✗ ${p}`);
    console.log(`  ? tools/data/sectors.ts 现在标了 ${Object.keys(SECTOR_OF).length} 个代码（1996–2018 各年 candidates.ts --top 300 的候选）；换口径时先跑 candidates.ts --year <年> --missing 补齐`);
    console.log('补齐后重跑 `node tools/data/segments.ts --full --force`（--force 表示行业标注已经人工补过）。');
    process.exitCode = 1;
    return;
  }
  const run = (script: string, args: string[]): void => {
    console.log(`$ node ${script} ${args.join(' ')}`);
    const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${script} 失败`);
  };
  run('tools/data/slice.ts', ['--years', list.join(','), '--cache', arg('cache', DEFAULT_CACHE)]);
  // 一次建 23 年会爆内存（每年清洗后的数据都留在进程里），逐年建，index.json 每次合并
  for (const y of list) run('tools/data/build.ts', ['--years', String(y), '--cache', arg('cache', DEFAULT_CACHE), '--out', packs]);
  // 一局 58 天，gap 39 = 相邻段最多重叠三分之一；1996-01 到 2018-03 约 5,600 个交易日，最多约 140 段
  generate(packs, arg('out', 'public/data/segments'), Number(arg('gap', '39')), Number(arg('step', '1')));
}

/**
 * 只改现有段文件的标题和大事（不重切行情）：标题换成游戏化的说法，大事按 events.ts 补上行业。
 * 行情数字一个不动，用于文案调整后不想重跑整条管线的时候。
 */
function retitle(dir: string): void {
  const entries = JSON.parse(readFileSync(MANIFEST, 'utf8')) as ManifestEntry[];
  const segs: SourceSegment[] = entries.map((e) => {
    const seg = JSON.parse(readFileSync(`${dir}/${e.id}.json`, 'utf8')) as Segment;
    return { ...seg, id: e.key, from: e.from, to: e.to, year: e.year, events: eventsOf(e.from, e.to) };
  });
  retitleAll(segs);
  writeSegments(segs, dir);
  for (const s of segs) console.log(`  ${s.id.padEnd(20)}${REGIME_LABEL[s.regime]}  ${s.title}  大事 ${s.events.length}`);
}

function main(): void {
  if (flag('full')) return full();
  if (flag('retitle')) return retitle(arg('out', 'public/data/segments'));
  generate(arg('packs', 'public/data/years'), arg('out', 'public/data/segments'), Number(arg('gap', '39')), Number(arg('step', '3')), arg('manifest', MANIFEST));
}

if (process.argv[1]?.endsWith('segments.ts')) main();
