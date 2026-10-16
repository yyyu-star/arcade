/**
 * 第 3 步：生成核对报告 docs/history/data-check.md（先跑 slice.ts、build.ts）。
 *
 *   node tools/data/check.ts [--years 1999,2000,2008] [--out docs/history/data-check.md]
 *
 * 读：缓存里的切片和 report-<年>.json、tickers.json，docs/story-0.4.md 的化名表；不改时间线文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_CACHE, arg, pct } from './common.ts';
import { type Bar, type Series, type YearData, loadYear, periodReturn } from './clean.ts';
import { ALIASES } from './aliases.ts';
import { BACKFILL, type Query } from './backfill.ts';
import { FIXES, VOLUME_SCALE } from './fixes.ts';
import { REAL_INDEX } from './real-index.ts';
import { SECTORS } from './sectors.ts';
import { REAL_DD as REAL_DD_TEXT } from './dow.ts';

const cache = arg('cache', DEFAULT_CACHE);
const years = arg('years', '1999,2000,2008').split(',').map((s) => Number(s.trim()));
const outPath = arg('out', 'docs/history/data-check.md');

type Report = any;
const reports = new Map<number, Report>(years.map((y) => [y, JSON.parse(readFileSync(`${cache}/report-${y}.json`, 'utf8'))]));
const tickers = (JSON.parse(readFileSync(`${cache}/tickers.json`, 'utf8')) as { tickers: Record<string, [string, string, number]> }).tickers;
const data = new Map<number, YearData>(years.map((y) => [y, loadYear(y, cache)]));

const L: string[] = [];
const p = (s = ''): void => {
  L.push(s);
};
const f2 = (x: number): string => (Math.round(x * 100) / 100).toFixed(2);

// ---------- 回填计算 ----------
function idx(d: YearData, date: string): number {
  return d.dates.indexOf(date);
}
function prevBar(s: Series, day: number): [number, Bar] | null {
  for (let k = day - 1; k >= 0; k--) {
    const b = s.bars.get(k);
    if (b !== undefined) return [k, b];
  }
  return null;
}
/** 区间内的累计拆股比例（不含 from 当天） */
function splitBetween(s: Series, from: number, to: number): number {
  let r = 1;
  for (let k = from + 1; k <= to; k++) r *= s.bars.get(k)?.split ?? 1;
  return r;
}
function answer(year: number, q: Query): string {
  const d = data.get(year) as YearData;
  if (q.kind === 'sector') {
    const rep = reports.get(year) as Report;
    const members = (rep.pool as { ticker: string; sector: string }[]).filter((m) => m.sector === q.sector).map((m) => d.series.get(m.ticker) as Series);
    const day = idx(d, q.date);
    const rs = members.map((s) => {
      const b = s.bars.get(day);
      const pb = prevBar(s, day);
      return b === undefined || pb === null ? null : (b.c * b.split) / pb[1].c - 1;
    }).filter((x): x is number => x !== null);
    const sec = SECTORS.find((x) => x.id === q.sector)?.name ?? q.sector;
    return `${q.date} 股票池"${sec}"${rs.length} 只等权 ${pct(rs.reduce((a, b) => a + b, 0) / rs.length)}`;
  }
  const s = d.series.get(q.t);
  if (s === undefined) return `${q.t} 无数据`;
  if (q.kind === 'day') {
    const day = idx(d, q.date);
    const b = s.bars.get(day);
    const pb = prevBar(s, day);
    if (b === undefined || pb === null) return `${q.t} ${q.date} 无数据`;
    const r = (b.c * b.split) / pb[1].c - 1;
    return `${q.t} ${q.date.slice(5)} 收 ${b.c}（前收 ${pb[1].c}${b.split !== 1 ? `，拆股 ${b.split}` : ''}）${pct(r)}`;
  }
  if (q.kind === 'range') {
    const a = idx(d, q.from), z = idx(d, q.to);
    const r = periodReturn(s, a, z, false);
    if (r === null) return `${q.t} 区间无数据`;
    return `${q.t} ${q.from.slice(5)} 收 ${(s.bars.get(a) as Bar).c} → ${q.to.slice(5)} 收 ${(s.bars.get(z) as Bar).c}：${pct(r)}${splitBetween(s, a, z) !== 1 ? '（已按拆股调整）' : ''}`;
  }
  if (q.kind === 'year') {
    const a = d.yearStart - 1;
    const z = d.dates.length - 1;
    const r = periodReturn(s, a, z, false);
    const rt = periodReturn(s, a, z, true);
    if (r === null || rt === null) return `${q.t} 全年数据不全`;
    return `${q.t} 全年：${(s.bars.get(a) as Bar).c} → ${(s.bars.get(z) as Bar).c}，价格 ${pct(r)}${Math.abs(rt - r) > 0.0005 ? `（含分红 ${pct(rt)}）` : ''}${splitBetween(s, a, z) !== 1 ? '，已按拆股调整' : ''}`;
  }
  if (q.kind === 'minClose') {
    let best: [number, number] | null = null;
    for (let k = idx(d, q.from); k <= idx(d, q.to); k++) {
      const b = s.bars.get(k);
      if (b !== undefined && (best === null || b.c < best[1])) best = [k, b.c];
    }
    return best === null ? `${q.t} 无数据` : `${q.t} ${q.from.slice(5)}~${q.to.slice(5)} 最低收盘 ${best[1]}（${d.dates[best[0]]}）`;
  }
  if (q.kind === 'maxHigh') {
    const a = idx(d, q.base);
    let best: [number, number, number] | null = null;
    for (let k = idx(d, q.from); k <= idx(d, q.to); k++) {
      const b = s.bars.get(k);
      if (b !== undefined && (best === null || b.h > best[1])) best = [k, b.h, b.c];
    }
    if (best === null) return `${q.t} 无数据`;
    const base = (s.bars.get(a) as Bar).c / splitBetween(s, a, best[0]);
    return `${q.t} 以 ${q.base.slice(5)} 收盘折算 ${f2(base)} 为基准，${q.from.slice(5)}~${q.to.slice(5)} 最高价 ${best[1]}（${d.dates[best[0]]}）${pct(best[1] / base - 1)}`;
  }
  // first
  const b = s.bars.get(s.first) as Bar;
  return `${q.t} 数据首日 ${d.dates[s.first]}：开 ${b.o}、高 ${b.h}、低 ${b.l}、收 ${b.c}`;
}

// ---------- 化名表 ----------
const storyText = readFileSync('docs/story-0.4.md', 'utf8');
interface StoryRow { id: string; name: string; code: string; real: string; flag: string }
const story = new Map<string, StoryRow>();
for (const line of storyText.split('\n')) {
  if (!line.startsWith('| `s_')) continue;
  const cols = line.split('|').map((c) => c.trim());
  const id = (cols[1] as string).replace(/`/g, '');
  story.set(id, { id, name: cols[2] as string, code: cols[3] as string, real: cols[4] as string, flag: cols[5] as string });
}
const storyIssues: string[] = [];
for (const st of story.values()) {
  const a = ALIASES.find((x) => x.id === st.id);
  if (a === undefined) {
    storyIssues.push(`\`${st.id}\` 在故事稿里，aliases.ts 没有（需要补实查）`);
    continue;
  }
  if (a.code !== st.code) storyIssues.push(`\`${st.id}\` 改写代码不一致：故事稿 ${st.code}，aliases.ts ${a.code}`);
  if (st.flag.startsWith('在')) {
    if (a.data === null) storyIssues.push(`\`${st.id}\` 故事稿标"在"，但数据里没有（aliases.ts：${a.note}）`);
    const m = /数据代码 ([A-Z_]+)/.exec(st.flag);
    if (m !== null && a.data !== null && m[1] !== a.data) storyIssues.push(`\`${st.id}\` 故事稿写数据代码 ${m[1]}，aliases.ts 是 ${a.data}`);
    if (a.data !== null && tickers[a.data] === undefined) storyIssues.push(`\`${st.id}\` aliases.ts 的数据代码 ${a.data} 不在数据里`);
  } else if (st.flag.startsWith('缺')) {
    if (a.data !== null) storyIssues.push(`\`${st.id}\` 故事稿标"缺"，但数据里有（数据代码 ${a.data}）`);
  } else storyIssues.push(`\`${st.id}\` 故事稿"可交易"一栏既不是"在"也不是"缺"：${st.flag}`);
}
for (const a of ALIASES) if (!story.has(a.id)) storyIssues.push(`\`${a.id}\` 在 aliases.ts 里，故事稿化名表没有`);
const codeClashes: string[] = [];
for (const st of story.values()) {
  if (st.code === '—' || st.code === '') continue;
  const t = tickers[st.code];
  if (t !== undefined) codeClashes.push(`\`${st.id}\` 的改写代码 **${st.code}** 是数据里的真实代码（${t[0]} 至 ${t[1]}），需要换`);
}
const dupCodes = [...story.values()].map((x) => x.code).filter((c, i, arr) => c !== '—' && arr.indexOf(c) !== i);
for (const c of new Set(dupCodes)) codeClashes.push(`改写代码 **${c}** 在化名表里出现不止一次`);

function availability(a: (typeof ALIASES)[number], year: number): string {
  if (a.data === null) return '缺';
  if (a.dataYears !== undefined && !a.dataYears.includes(year)) return '—';
  const s = data.get(year)?.series.get(a.data);
  const d = data.get(year) as YearData;
  if (s === undefined || s.last < d.yearStart) return '缺';
  if (s.first > d.yearStart) return `在（${d.dates[s.first]} 起）`;
  if (s.last < d.dates.length - 1) return `在（到 ${d.dates[s.last]}）`;
  return '在';
}

// ---------- 人工撰写的段落 ----------
const JUMP_REVIEW = `人工判断（依据是当天的市场事件，按常识判断，没有逐条找到原始报道，标"待核对"）：
- MS 2008-10-13 +87%：三菱日联 90 亿美元入股在 10-13 完成，同日大盘 +11%，判断为真实行情（待核对）。
- GNW 2008-10-13 +81%、2008-11-24 +89%：两天分别是全市场暴涨日和花旗获救次日的金融股暴涨，判断为真实行情（待核对）。
- HIG 2008-12-05 +102%：判断为真实行情但没有找到对应新闻（待核对）。
- GGP 2008-11-24 +144%（0.41 → 1.00）：濒临破产的低价股在金融股暴涨日翻倍，判断为真实行情（待核对）。
- 以上都保留在包里。游戏里这类单日翻倍是真实发生过的，正好是"抄底王"剧情的素材。`;

const FORMAT_DOC = `### 1.1 文件

- \`public/data/years/index.json\`：可用年份列表（\`years[].year/file/stocks/days/warmDays/bytes/gzipBytes\`）、每年清洗统计、大盘口径（\`index\` 老三十、\`ref\` 科综，含缺失成分股和免责声明）、每年与真实指数的差距（\`years[].gapToReal\`）、来源声明（\`source\`）、幸存者偏差说明。
- \`public/data/years/<年>.json\`：一个年份一个文件，单个 JSON 对象（\`v = 2\`）。开局时只下载被抽中的那一年。
- 包里**没有真实代码**。化名 id ↔ 真实代码的对照只在 \`tools/data/aliases.ts\`（\`s_\` 开头）和报告第 5 节（\`tmp_\` 开头）。

### 1.2 顶层字段

| 字段 | 类型 | 含义 |
|---|---|---|
| \`v\` | number | 格式版本，现在是 2 |
| \`year\` | number | 年份 |
| \`source\` | string | 来源一句话（完整声明在 index.json） |
| \`dates\` | string[] | 交易日 \`YYYY-MM-DD\`，升序。长度 N（三年分别是 312、312、313）。**所有按天的数组都和它等长、同下标** |
| \`start\` | number | 开局那天的下标 = 当年第一个交易日（现在都是 60）。\`[0, start)\` 是上一年最后 60 个交易日，开局前已公开的历史（K 线回看、β 估计）。对应 \`MarketSource.start\`，\`MarketSource.length = N\` |
| \`sectors\` | {id, name}[] | 本年用到的行业，对应 \`MarketSource.sectors\` |
| \`stocks\` | Stock[] | 股票池，150–250 只 |
| \`index\` | Index | 主大盘"老三十"，对应 \`benchmark\` / \`benchmarkBar\`，参与归因 |
| \`ref\` | Index（可选） | 参考线"科综"。**只做参考，不参与归因**；适配器可以忽略，缺失时不要报错 |

### 1.3 Stock

| 字段 | 类型 | 含义 |
|---|---|---|
| \`id\` | string | 化名 id：故事稿里的 \`s_xxx\`，或补进来的占位 \`tmp_xxx\`。做 \`SecurityDef.symbol\` 用，全包唯一 |
| \`name\` / \`code\` | string \\| null | 化名和改写代码（故事稿第 1 节）；\`tmp_\` 股票为 null，等编剧起名 |
| \`sec\` | string \\| null | 行业 id（\`sectors\` 里的一个） |
| \`why\` | string | 入池原因：\`star\` 时间线明星股、\`pick\` 人工故事股、\`big\` 行业成交额前列、\`vola\` 行业高波动、\`fill\` 补齐。只给剧情和调试用 |
| \`o\` \`h\` \`l\` \`c\` | (number \\| null)[] | 当天未复权开高低收，美元，最多 4 位小数。保证 \`l ≤ min(o, c)\`、\`h ≥ max(o, c)\` |
| \`v\` | (number \\| null)[] | 当天成交量，股，整数；可能为 0（冷门股当天无成交） |
| \`div\` | [i, cash][] | 除息日下标和每股现金（美元） |
| \`split\` | [i, ratio][] | 除权日下标和拆股比例：新股数 = 旧股数 × ratio（2 = 一拆二，0.5 = 二合一，可以不是整数，如 1.555） |
| \`delist\` | [i, price] \\| null | 退市：第 i 天开盘前持仓按 price（最后一个交易日的收盘价）换成现金 |

**null**：o/h/l/c/v 五个数组总是同时为 null，表示这只股票当天没有行情，\`MarketSource.bar\` 返回 null。三种情况：
- 第一个非 null 之前：还没上市（例如 UPS 1999-11-10 起才有数据）；
- 两个非 null 之间：停牌，或清洗剔除的坏数据（第 3 节，三年股票池里很少）；不要插值，按停牌处理，下一个有行情的日子相对"最近一个非 null 收盘"计算涨跌；
- \`delist\` 的下标及以后：已退市。

**公司行动的时点和顺序**（都在第 i 天**开盘前**生效，i ≥ 1；下标 0 之前的已经反映在价格里，不再给出）：
1. 先拆股：持股 × ratio。第 i 天的 o/h/l/c 已经是拆股后的价格；
2. 再发分红：按**拆股之后**的持股，每股发 cash（这是 WIKI 的口径，同一天两件事都有的情况极少，三个年包里只有 2000 年的 \`s_f\`（2000-08-03）和 2008 年包开局前历史里的 \`tmp_rig\`（2007-11-27））；
3. 退市：持仓按 price 换成现金，当天及以后 bar 为 null。
- 零碎股的处理由引擎决定（core 现在是按前收盘价换现金；比例为非整数时会出现）。
- 分拆（spin-off）在数据里按价值记成现金分红（例如 MO 2008-03-31 分拆 PM，每股 50.48）；游戏照发现金。

**收益公式**（引擎的 \`dayReturn\`、归因都应该得到同样结果）：第 i 天总收益 = ratio_i × (c_i + cash_i) / c_prev − 1，其中 c_prev 是 i 之前最近一个非 null 收盘，当天没有拆股时 ratio = 1、没有分红时 cash = 0。前一天的"可比收盘" = c_prev / ratio_i。

### 1.4 Index：主大盘 \`index\` 与参考线 \`ref\`

两者结构相同：

| 字段 | 类型 | 含义 |
|---|---|---|
| \`id\` / \`name\` | string | \`index\`：\`x_dow\` / 老三十；\`ref\`：\`x_nasdaq\` / 科综 |
| \`role\` | string | 只有 \`ref\` 有，值为 \`reference\` |
| \`note\` | string | 一句说明（含"不是道琼斯 / 纳斯达克官方指数"） |
| \`method\` | string | 口径说明（第 4 节） |
| \`base\` | number | 1000：\`c[start − 1] = 1000\`（开局前一天收盘） |
| \`o\` \`h\` \`l\` \`c\` | number[] | 与 \`dates\` 等长，**没有 null**。\`o[0] = h[0] = l[0] = c[0]\`。高低价由成分股的开、高、低合成，是近似值，保证 \`l ≤ min(o, c)\`、\`h ≥ max(o, c)\` |
| \`members\` | number[] | 当天实际计入的成分股数（下标 0 为 0），只作参考。老三十满员是 30，缺失成分股时更少（1999 年 24–26，2000 年 26，2008 年 29） |

**\`index\`（老三十，\`x_dow\`）**：
- 价格加权：当年道指真实成分名单里 WIKI 有价格的公司，价格之和 ÷ 除数；换股在生效日开盘前完成；拆股、换股、某只当天缺数据、分拆时调整除数，指数不跳；普通分红不调。
- 这是游戏的 \`benchmark\`：\`benchmarkBar(i) = { open: o[i], high: h[i], low: l[i], close: c[i], volume: 0 }\`，\`benchmarkReturn\` 和归因里的"大盘"一项都用它。
- 不是道琼斯官方指数；缺失的成分股和与真实道指的差距写在 index.json。

**\`ref\`（科综，\`x_nasdaq\`，可选）**：
- 成交额加权、每月调权，成分是数据里当年在 Nasdaq 上市的股票。
- **只做参考，不参与归因**：可以在盘面画第二条线、在依据页展示；不要用在 \`benchmarkReturn\`、β、归因、账单校准里。
- 方向和真实纳指一致，幅度约为真实纳指的 1.1–1.4 倍。不是纳斯达克官方指数。

两条线都是价格指数，没有成交量、没有分红事件、不能交易。行业指数（\`sectorBar\`，可选）包里没有，需要的话由适配器用股票池按行业等权自行合成。

### 1.5 适配器要点

- \`benchmark = { symbol: index.id, name: index.name }\`；\`ref\` 不进 \`MarketSource\` 接口，需要画线时由界面直接读。
- \`date(i) = dates[i]\`；\`length = dates.length\`；\`start = start\`；\`securities = stocks.map(s => ({ symbol: s.id, name: s.name ?? s.id, sector: s.sec }))\`。
- \`actions(i)\`：收集所有股票 \`split\` 里下标为 i 的、\`div\` 里下标为 i 的、\`delist\` 下标为 i 的；**同一只股票按 split → dividend → delist 的顺序给出**。
- 价格是当年真实的未复权价，1999–2000 年有大量分数报价（如 43.9375）。`;

const INDEX_DISCUSSION = `解读（对照口径）：
- **幸存者偏差**：全数据集等权比标普高 4 个百分点（1999）、30 个百分点（2000）、6 个百分点（2008）。2008 年的 6 个百分点大致就是幸存者偏差的量级（雷曼、贝尔斯登、华互、美联、两房、全国房贷等不在数据里）；2000 年还叠加了等权效应（小盘、旧经济股涨，大科技股暴跌）。
- **成交额加权**：方向和真实大盘一致，但 1999 年偏高约 45 个百分点、2000 年偏低约 14 个百分点，因为高换手的科技股权重远高于市值权重。这是年包改用老三十的原因。
- **A 和 B**：A（只用股票池）三年都比 B 更极端，因为股票池本来就偏向明星股和高波动股。`;

const BACKFILL_NOTES = `- 不能回填的"待核对"（三份时间线共约 140 条中的大多数）：大盘涨跌和点位（数据里没有真实指数）、外国市场、利率、事件日期本身，以及公司不在数据里的（AOL 以外的 1999–2000 年退市网络股、朗讯、北电、世通、安然、贝尔斯登、雷曼、两房、华互、美联、全国房贷、老通用、Ambac 等）。
- 2008 年金融股的"幅度待核对"用股票池"银行"行业等权代替，不是官方行业指数。
- PCLN 1999-03-30 上市首日：数据从 3-31 开始，首日涨幅无法回填（时间线"首日 $16→$69"仍待核对）。`;

const OPEN_ITEMS = `1. **规则层适配**：按第 1 节写 WIKI 适配器（新增可选字段 \`ref\` 科综，只做参考，协调人会通知）；公司行动同一天的顺序是 拆股 → 分红（按拆后股数）→ 退市（协调人已决定，由协调人通知规则层）。
2. **故事稿**：一致性检查结果见第 2.2、2.3 节，另行处理。
3. **改写代码**：只对照了 WIKI 收录的代码；1996–2018 年已注销的代码需要另找代码历史表。
4. **tmp_ 股票**等编剧起化名。注意 \`tmp_<代码小写>\` 这个 id 本身就带着真实代码；上线前如果不想在包里暴露任何真实代码，需要把 tmp_ 换成化名 id。
5. **行业标注**是人工判断，未逐家核对 10-K；2008 年 TWX、MLNK、KTOS 按年覆盖。
6. **大额分红、分拆**：WIKI 把分拆按价值记成现金分红（MO→PM、CY→SPWR 等），游戏照发现金；如果剧情想表现"送了另一家公司的股票"，需要额外数据。
7. **人工判断的跳变**（第 3.4 节）和 STSA 分红 ÷100 都标了"待核对"。
8. **老三十缺成分股**：1999 年缺 6 只、2000 年缺 4 只、2008 年缺 1 只（第 4.1 节），1999 年比真实道指高 3.5 个百分点；依据页按 index.json 如实说明。科综只做参考线。
9. 其余年份（1996–2018）只要在 sectors.ts 补候选的行业、在 aliases.ts/picks.ts 补当年故事股，就能用同一条命令出包；扩年份时要在 dow.ts 补当年的道指成分和调整日期。`;

interface Alt {
  year: number;
  C: { price: number; maxDD: number; missing: string[]; minUsed: number; maxUsed: number };
  NQ: { price: number; maxDD: number; members: number; top: { ticker: string; w: number }[] };
  keyDays: { idx: string; date: string; real: number; model: number | null; src: string }[];
}
const te = (a: Alt, idx: string): string => {
  const xs = a.keyDays.filter((k) => k.idx === idx && k.model !== null).map((k) => Math.abs((k.model as number) - k.real));
  return xs.length > 0 ? `${(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(2)} 个百分点（${xs.length} 天）` : '—';
};
const ALT_DISCUSSION = `解读：
- **老三十很贴近真实道指**：全年涨跌差 0.1–3.5 个百分点，年内回撤和时间线推出的数字一致，关键日平均只差 0.05–0.26 个百分点。道指只有 30 只、按价格加权，缺的 1–6 只剔除后，其余成分的走势就决定了指数；成分名单按当年真实名单定，不是按"活到 2018 年"挑的，所以幸存者偏差对它影响很小。1999 年偏高 3.5 个百分点，主要是缺了当年拖后腿的旧通用、柯达、西尔斯等。
- **科综方向对、幅度偏大**：2000 年 −38%（真实 −39%）很接近；1999 年 +130%（真实 +86%）、2008 年 −45%（真实 −41%）偏极端，关键日约为真实纳指的 1.1–1.4 倍。原因是成交额加权让高换手龙头（雅虎、微软、高通、思科；2008 年谷歌、苹果）权重远高于市值权重，上市地也是按代码惯例近似判断的。所以只做参考线，不参与归因。
- **依据页要写**：老三十缺哪几只成分股、怎么处理（剔除后重算除数）、和真实道指差多少（index.json 的 \`years[].gapToReal\`）；科综"方向和真实纳指一致，幅度约为 1.1–1.4 倍"；两条都不是官方指数。`;

// ---------- 正文 ----------
const today = new Date().toISOString().slice(0, 10);
p('# 行情数据核对报告（1999、2000、2008）');
p();
p(`> 由 \`node tools/data/check.ts\` 生成（${today}），数据为 WIKI Prices（公有领域，2026-10-11 导出，内容截至 2018-03-27）。`);
p('> 内部研究稿，可写真名与代码。改了管线或数据后重跑 `slice.ts → build.ts → check.ts`，不要手改本文件。');
p();
p('## 0. 摘要');
p();
p('- 年包的主大盘是"老三十"（\`x_dow\`，当年道指真实成分股的价格加权，只用 WIKI 价格），参考线是"科综"（\`x_nasdaq\`，只做参考、不参与归因）。都不是官方指数（第 4 节）。');
for (const y of years) {
  const r = reports.get(y) as Report;
  const real = REAL_INDEX.find((x) => x.year === y);
  p(
    `- **${y}**：股票池 ${r.pool.length} 只，年度包 ${(r.rawBytes / 1024).toFixed(0)}KB（gzip ${(r.gzBytes / 1024).toFixed(0)}KB）。` +
      `老三十 ${pct(r.C.price)}（最大回撤 ${pct(r.C.maxDD)}），真实道指 ${real ? pct(real.dow) : '?'}；科综 ${pct(r.NQ.price)}，真实纳指 ${real ? pct(real.nasdaq) : '?'}。`,
  );
}
p(`- 化名表 ${ALIASES.length} 只里，数据中缺 ${ALIASES.filter((a) => a.data === null).length} 只；故事稿与数据的一致性检查见第 2.2、2.3 节（不一致 ${storyIssues.length} 处，改写代码重名 ${codeClashes.length} 处）。`);
p(`- 回填时间线"待核对"数字 ${BACKFILL.length} 条（第 6 节）。`);
p();

p('## 1. 管线与年度包格式');
p();
p('```');
p('node tools/data/slice.ts --years 1999,2000,2008   # 流式切片，约 15 秒；切片放 .data/wiki-prices/slices/（不进仓库）');
p('node tools/data/build.ts --years 1999,2000,2008   # 清洗、选池、合成大盘、写 public/data/years/（--index A|B|auto）');
p('node tools/data/check.ts                          # 生成本报告');
p('node tools/data/candidates.ts --year 2003 --missing  # 扩年份时列出缺行业标注的候选');
p('```');
p();
p(FORMAT_DOC);
p();

p('## 2. 化名表股票的可得性');
p();
p('### 2.1 逐只实查');
p();
p('"在（… 起）"表示当年年中才上市。`—` 表示这个代码那一年对应的是另一家公司。故事稿标注取自 docs/story-0.4.md 当前版本。');
p();
p(`| id | 化名 | 真实代码 | WIKI 代码 | 故事稿标注 | 1999 | 2000 | 2008 | 说明 |`);
p('|---|---|---|---|---|---|---|---|---|');
for (const a of ALIASES) {
  p(`| \`${a.id}\` | ${a.name} | ${a.real} | ${a.data ?? '—'} | ${story.get(a.id)?.flag ?? '（故事稿没有）'} | ${years.map((y) => availability(a, y)).join(' | ')} | ${a.note} |`);
}
p();
p('### 2.2 故事稿"可交易"一栏与数据的一致性');
p();
p('检查规则：故事稿标"在"的，aliases.ts 里必须有数据代码，且故事稿写的"数据代码 X"要和 aliases.ts 一致；标"缺"的，aliases.ts 里必须没有数据代码；两边的 id 和改写代码要一致。');
p();
if (storyIssues.length === 0) p('- **全部一致。**');
for (const s of storyIssues) p(`- ${s}`);
p();
p('标"缺"、但同样的真实代码在数据里出现的（代码被别的公司或别的年份占用，已逐一确认不是同一家公司在当年的价格）：');
p();
for (const a of ALIASES.filter((x) => x.data === null && x.real !== '' && tickers[x.real] !== undefined)) {
  const t = tickers[a.real] as [string, string, number];
  p(`- \`${a.id}\` ${a.real}：数据里的 ${a.real} 是 ${t[0]} 至 ${t[1]}。${a.note}`);
}
p();
p('剧情提示：`s_aol` 拨号在线可以交易而 `s_twx` 时代兄弟传媒不行；`s_jpm` 在 1999–2000 年的价格是收购方大通曼哈顿；`s_t` 老电话公司只能当新闻。');
p();
p('### 2.3 改写代码重名检查');
p();
p(`把 docs/story-0.4.md 化名表里全部 ${story.size} 个改写代码，对照数据里的全部 ${Object.keys(tickers).length} 个真实代码（WIKI 主要收录 2018 年前后仍在交易的公司；已注销的旧代码不在这份清单里，所以这只是必要条件）：`);
p();
if (codeClashes.length === 0) p('- **没有重名。**');
for (const c of codeClashes) p(`- ${c}`);
p('- 已退市公司的代码（1996–2018 年用过又注销的）需要另找代码历史表核对，本数据无法覆盖。');
p();

p('## 3. 清洗');
p();
p('### 3.1 规则');
p();
p('- 交易日历：当天有数据的代码数 ≥ 当期中位数的一半；不在日历上的行剔除（offCalendar）。');
p('- 剔除：重复行、开高低收缺失/零/负（badPrice）、最高 < 最低（highLow）、开盘或收盘越出 [最低, 最高] 0.5% 以上（outOfRange；0.5% 以内把高低价扩到包住开收）、成交量缺失（noVolume）。');
p('- 错价（spike）：单日总收益超过 ±80%、没有拆股记录、且次日回到前一天 ±30% 以内 → 剔除那一天。');
p('- 跳变（jump）：单日总收益超过 ±80% 但不是错价 → 数据保留、标"待复核"，该股不进合成大盘的对照宽指数，也不按行业规则进股票池；时间线明星股和故事股照常进池，在 3.4 节逐条人工判断。');
p('- 大额分红（> 前收 10%）：股价同步下跌 → 保留；分红 ≈ 前收 × (1 − 1/k) 且价格变成 1/k → 改成拆股 k；否则作废。另有人工修正（3.3 节）。');
p('- 拆股核对：拆股日的 前收/今开 偏离拆股比例超过 −35%/+50% 记为 splitMismatch（只报告，不改）。');
p('- 剔除的行在包里是 null（引擎当作停牌）。缺口 = 首末日之间日历上缺的天数。');
p('- 成交量为 0 的行保留（冷门股当天无成交，价格是前收），只计数。');
p('- 重复序列：两个代码在切片里每天收盘和成交量完全相同时，只保留一个（3.3 节）。');
p();
p('### 3.2 统计（每个切片含前一年 8–12 月）');
p();
const keys: [string, string][] = [
  ['rows', '原始行数'], ['tickers', '代码数'], ['offCalendar', '非交易日行'], ['duplicate', '重复行'], ['badPrice', '零/负/缺价'], ['highLow', '最高<最低'],
  ['outOfRange', '开收越界'], ['noVolume', '成交量缺失'], ['zeroVolume', '成交量为 0（保留）'], ['spike', '错价（剔除）'], ['jump', '跳变（待复核）'],
  ['jumpTickers', '有跳变的代码'], ['splitEvents', '拆股事件'], ['splitMismatch', '拆股与价格不符'], ['dividendEvents', '分红事件'],
  ['bigDividendKept', '大额分红保留'], ['bigDividendToSplit', '分红改拆股'], ['badDividend', '分红作废'], ['manualFix', '人工修正'], ['volumeScaled', '成交量换算行（BRK_A）'], ['duplicateSeries', '重复序列（删除）'], ['gapDays', '缺口天数'], ['gapTickers', '有缺口的代码'],
];
p(`| 项目 | ${years.join(' | ')} |`);
p(`|---|${years.map(() => '---').join('|')}|`);
for (const [k, name] of keys) p(`| ${name} | ${years.map((y) => String((reports.get(y) as Report).stats[k])).join(' | ')} |`);
p();
p('跳变按类型：');
p();
for (const y of years) {
  const r = reports.get(y) as Report;
  const kinds: Record<string, number> = {};
  for (const j of r.jumps as { kind: string }[]) kinds[j.kind] = (kinds[j.kind] ?? 0) + 1;
  p(`- ${y}（包内窗口）：${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join('；')}`);
}
p();
p('### 3.3 人工修正');
p();
for (const fx of FIXES) p(`- ${fx.ticker} ${fx.date}：${fx.why}`);
for (const [t, v] of Object.entries(VOLUME_SCALE)) p(`- ${t} 全部成交量 × ${v.scale}：${v.why}`);
p();
p('重复序列（WIKI 把改名前后的代码各存了一份，两份每天的收盘和成交量完全相同；保留全量数据里更早结束的那个代码，另一个删掉，否则全数据集大盘会重复计算）：');
p();
for (const y of years) p(`- ${y}：${((reports.get(y) as Report).duplicates as [string, string][]).map(([k, d]) => `保留 ${k}、删 ${d}`).join('；')}`);
p();
p('### 3.4 股票池里的特殊记录（逐条）');
p();
p('| 年 | 代码 | 日期 | 记录 |');
p('|---|---|---|---|');
for (const y of years) {
  const r = reports.get(y) as Report;
  for (const j of (r.jumps as { ticker: string; date: string; ret: number; prev: number; close: number; kind: string; inPool: boolean }[]).filter((x) => x.inPool))
    p(`| ${y} | ${j.ticker} | ${j.date} | 跳变 ${pct(j.ret)}（${j.prev} → ${j.close}），${j.kind}；保留，人工判断见下 |`);
  for (const n of r.notes as { ticker: string; note: string }[]) {
    const m = /^(\d{4}-\d{2}-\d{2}) (.*)$/.exec(n.note);
    p(`| ${y} | ${n.ticker} | ${m?.[1] ?? ''} | ${(m?.[2] ?? n.note).replace(/\|/g, '/')} |`);
  }
}
p();
p(JUMP_REVIEW);
p();

p('## 4. 合成大盘与真实指数');
p();
p('**年包里的大盘都不是官方指数**：主大盘"老三十"是用当年道指真实成分名单、取 WIKI 价格合成的价格加权指数，不是道琼斯官方指数；参考线"科综"不是纳斯达克官方指数。只用 WIKI 的价格和公开的成分股名单，不用道琼斯、纳斯达克、标普的任何指数数据。真实指数数字取自时间线第 1 节年度概览和各条事件。');
p();
const gp = (x: number, r: number | undefined): string => (r === undefined ? '?' : `${x - r >= 0 ? '+' : ''}${((x - r) * 100).toFixed(1)}`);
// ---- 4.1 候选（只算、未切换）----
const alts = new Map<number, Alt>();
for (const y of years) {
  try {
    alts.set(y, JSON.parse(readFileSync(`${cache}/alt-${y}.json`, 'utf8')) as Alt);
  } catch {
    /* 没跑 build.ts 新版 */
  }
}
if (alts.size === years.length) {
  p('### 4.1 年包里的两条线：老三十（主大盘）与科综（参考线）');
  p();
  p('由 `build.ts` 计算（算法见 `tools/data/index-calc.ts` 的 priceWeighted / dollarWeightedMonthly，成分名单和来源见 `tools/data/dow.ts`）。只用 WIKI 的价格和公开的成分股名单，不用道琼斯、纳斯达克的任何指数数据。');
  p();
  p('- **老三十（C，`x_dow`）**：当年道指真实成分股里 WIKI 有的那些，价格之和 ÷ 除数；拆股、换股、缺数据、分拆时调除数让指数不跳，普通分红不调。换股按生效日开盘：1999-11-01（加入微软、英特尔、SBC、家得宝，移出雪佛龙、固特异、西尔斯、联合碳化物），2008-02-19（美银、雪佛龙换奥驰亚、霍尼韦尔），2008-09-22（卡夫换 AIG）。');
  p('- **缺失成分股**：直接剔除，相当于剔除后重算除数，其余仍按价格加权。');
  p('- **科综（NQ，`x_nasdaq`，只做参考、不参与归因）**：B 口径（成交额加权、每月调权）只取 Nasdaq 上市股票。WIKI 没有交易所字段，用当年的代码惯例判断（Nasdaq 4–5 个字母，纽交所、美交所 1–3 个字母），并对已知的改名、转板大公司做了例外（dow.ts 的 EXCHANGE_OVERRIDE）。这是近似，没有逐家核对上市地。');
  p();
  p(`| 口径 | ${years.join(' | ')} |`);
  p(`|---|${years.map(() => '---').join('|')}|`);
  const arow = (name: string, fn: (a: Alt, r: Report, x: (typeof REAL_INDEX)[number] | undefined) => string): void => {
    p(`| ${name} | ${years.map((y) => fn(alts.get(y) as Alt, reports.get(y), REAL_INDEX.find((q) => q.year === y))).join(' | ')} |`);
  };
  arow('真实道指 全年', (_a, _r, x) => (x ? pct(x.dow) : '?'));
  arow('**C** 全年（价格）', (a) => pct(a.C.price));
  arow('C − 道指（百分点）', (a, _r, x) => gp(a.C.price, x?.dow));
  arow('C − 标普（百分点）', (a, _r, x) => gp(a.C.price, x?.sp500));
  arow('真实道指 年内最大回撤（时间线推算）', (a) => REAL_DD_TEXT[a.year]?.dow ?? '—');
  arow('C 最大回撤', (a) => pct(a.C.maxDD));
  arow('C 可用成分股数', (a) => `${a.C.minUsed === a.C.maxUsed ? a.C.minUsed : `${a.C.minUsed}–${a.C.maxUsed}`} / 30`);
  arow('C 缺失成分股', (a) => a.C.missing.join('、'));
  arow('C 关键日 平均绝对差', (a) => te(a, 'dow'));
  arow('真实纳指 全年', (_a, _r, x) => (x ? pct(x.nasdaq) : '?'));
  arow('**NQ** 全年（价格）', (a) => `${pct(a.NQ.price)}（${a.NQ.members} 只）`);
  arow('NQ − 纳指（百分点）', (a, _r, x) => gp(a.NQ.price, x?.nasdaq));
  arow('真实纳指 年内最大回撤（时间线推算）', (a) => REAL_DD_TEXT[a.year]?.nasdaq ?? '—');
  arow('NQ 最大回撤', (a) => pct(a.NQ.maxDD));
  arow('NQ 关键日 平均绝对差', (a) => te(a, 'nasdaq'));
  arow('NQ 年末权重前 5', (a) => a.NQ.top.slice(0, 5).map((t) => `${t.ticker} ${(t.w * 100).toFixed(1)}%`).join('、'));
  p();
  p('跟踪误差：拿不到可商用的真实道指、纳指日线，只能和时间线里写了涨跌幅的关键日对照（下表）。"关键日平均绝对差"= 这些天模型日涨跌与真实日涨跌之差的绝对值的平均。');
  p();
  p('| 指数 | 日期 | 真实 | 模型 | 差 | 出处 |');
  p('|---|---|---|---|---|---|');
  for (const y of years)
    for (const k of (alts.get(y) as Alt).keyDays)
      p(`| ${k.idx === 'dow' ? '道指 vs C' : '纳指 vs NQ'} | ${k.date} | ${k.real.toFixed(2)}% | ${k.model === null ? '—' : `${k.model.toFixed(2)}%`} | ${k.model === null ? '—' : (k.model - k.real).toFixed(2)} | ${k.src} |`);
  p();
  p(ALT_DISCUSSION);
  p();
}

p('### 4.2 对照：成交额加权 A、B 与等权（只在报告里，不进年包）');
p();
p('用来量化幸存者偏差和加权方式的影响。A、B 都是成交额加权（前 20 个交易日日均成交额，每月第一个交易日调权，只用过去的数据），价格指数。');
p();
p('- **A**：成分 = 当年游戏股票池。');
p('- **B**：成分 = 全数据集里调权日前一天有成交、前 20 天至少 10 天有数据的所有股票（清洗标"待复核"的股票除外，股票池里人工复核过的保留）。B 曾短暂作为年包大盘（feat(data) 提交），因为 1999 年比标普高 45 个百分点、和剧情里的"老三十"点位对不上，已换成老三十。');
p('- 对照：旧口径"等权每日再平衡"、买入持有等权，只用来说明偏差来源。真实指数数字取自时间线第 1 节年度概览。');
p();
p(`| 口径 | ${years.join(' | ')} |`);
p(`|---|${years.map(() => '---').join('|')}|`);
const row = (name: string, fn: (r: Report, real: (typeof REAL_INDEX)[number] | undefined) => string): void => {
  p(`| ${name} | ${years.map((y) => fn(reports.get(y), REAL_INDEX.find((x) => x.year === y))).join(' | ')} |`);
};
row('真实道指', (_r, x) => (x ? pct(x.dow) : '?'));
row('真实标普 500', (_r, x) => (x ? pct(x.sp500) + (x.caveat ? '（待核对）' : '') : '?'));
row('真实纳指', (_r, x) => (x ? pct(x.nasdaq) : '?'));
for (const m of ['A', 'B'] as const) {
  row(`**${m}** 全年涨跌（价格）`, (r) => `${pct(r[m].price)}（${r[m].members} 只）`);
  row(`${m} 最大回撤`, (r) => pct(r[m].maxDD));
  row(`${m} − 标普（百分点）`, (r, x) => gp(r[m].price, x?.sp500));
  row(`${m} − 纳指（百分点）`, (r, x) => gp(r[m].price, x?.nasdaq));
  row(`${m} 含分红`, (r) => pct(r[m].total));
}
row('对照：股票池等权每日再平衡（价格）', (r) => pct(r.ewPool.price));
row('对照：全数据集等权每日再平衡（价格）', (r) => `${pct(r.ewBroad.price)}（${r.ewBroad.members} 只）`);
row('对照：全数据集等权 − 标普（百分点）', (r, x) => gp(r.ewBroad.price, x?.sp500));
row('对照：股票池买入持有等权（含分红）', (r) => `${pct(r.buyHold.pool)}（${r.buyHold.poolN} 只）`);
row('对照：全数据集买入持有等权（含分红）', (r) => `${pct(r.buyHold.broad)}（${r.buyHold.broadN} 只）`);
p();
const maeOf = (m: 'A' | 'B'): number => {
  const xs = years.flatMap((y) => {
    const x = REAL_INDEX.find((q) => q.year === y);
    return x ? [Math.abs((reports.get(y) as Report)[m].price - x.sp500)] : [];
  });
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};
const chosenM = 'B' as const;
p(`与标普 500 全年涨跌的平均绝对差：A ${(maeOf('A') * 100).toFixed(1)} 个百分点，B ${(maeOf('B') * 100).toFixed(1)} 个百分点 。三年方向都和真实大盘一致，但幅度偏差大。`);
p();
p('B 年末（最后一次调权）权重最大的 10 只（看集中度）：');
p();
for (const y of years) {
  const r = reports.get(y) as Report;
  const top = r[chosenM].top as { ticker: string; w: number }[];
  p(`- ${y}：${top.map((t) => `${t.ticker} ${(t.w * 100).toFixed(1)}%`).join('、')}（合计 ${(top.reduce((a, t) => a + t.w, 0) * 100).toFixed(0)}%）`);
}
p();
p(INDEX_DISCUSSION);
p();

p('## 5. 股票池');
p();
p('选股规则（`tools/data/pool.ts`）：① 本年时间线明星股里数据中有的；② 本年人工故事股（`picks.ts`，附理由）；③ 每个行业按当年日均成交额取前 6 只（"市值大"的替身），再在日均成交额 ≥ 1,000 万美元的股票里取年化波动最高的 3 只；④ 不够 200 只按成交额补齐，上限 250。③④ 要求全年有数据（≥ 90% 交易日）、包内窗口没有待复核跳变、缺口 ≤ 5 天、年末价 ≥ 1 美元。');
p();
p('行业标注 `tools/data/sectors.ts`：WIKI 没有行业，按公开的公司业务描述（年报 10-K、交易所资料、维基百科）人工归类，口径近似 GICS，科技拆成互联网、软件、硬件、半导体、通信设备五类。是人工判断，没有逐家对照 10-K 原文；代码背后公司在某年业务不同的按年覆盖（如 TWX 在 2000 年前算互联网）。');
p();
for (const y of years) {
  const r = reports.get(y) as Report;
  const pool = r.pool as { ticker: string; id: string; sector: string; reason: string }[];
  const cnt = (k: string): number => pool.filter((x) => x.reason === k).length;
  p(`### ${y}（${pool.length} 只：明星 ${cnt('star')}、故事 ${cnt('pick')}、大盘 ${cnt('big')}、妖股 ${cnt('vola')}、补齐 ${cnt('fill')}）`);
  p();
  if ((r.dropped as string[]).length > 0) p(`超过 2MB 删掉：${(r.dropped as string[]).join(' ')}`);
  for (const sec of SECTORS) {
    const xs = pool.filter((x) => x.sector === sec.id);
    if (xs.length === 0) continue;
    p(`- ${sec.name}（${xs.length}）：${xs.map((x) => (x.id.startsWith('tmp_') ? x.ticker : `${x.ticker}=\`${x.id}\``)).join('、')}`);
  }
  p();
}

p('## 6. 回填时间线"待核对"的涨跌幅');
p();
p('只回填个股（和股票池行业等权）能从数据算出来的数字；大盘点位、外国市场、数据里没有的公司不填。不改时间线文件。');
p('口径：单日 = 当天收盘相对前一交易日收盘（已按拆股调整，不含分红）；全年 = 上年最后收盘到当年最后收盘。价格是未复权的当年价格。');
p();
p('| # | 时间线 | 行 | 原文（待核对的说法） | 数据回填 | 备注 |');
p('|---|---|---|---|---|---|');
BACKFILL.forEach((it, i) => {
  p(`| ${i + 1} | ${it.year} | L${it.line} | ${it.claim} | ${it.q.map((q) => answer(it.year, q)).join('；')} | ${it.note ?? ''} |`);
});
p();
p(BACKFILL_NOTES);
p();

p('## 7. 未决');
p();
p(OPEN_ITEMS);
p();
writeFileSync(outPath, L.join('\n'));
console.log(`写入 ${outPath}（${L.length} 行）`);

