/**
 * 0.4 重做：行情段（一局用的一段真实历史行情）。
 *
 * 行情段由 tools/data/segments.ts 从年度包切出来，放在 public/data/segments/。开局按种子抽一段（每日挑战大家同一段），
 * 把本局登场的 6 个风口用到的部分（大盘、行业、绑定的真实股票）存进存档的 state.real，之后整局只从存档取数，
 * 读档、回放都不需要再下载。价格只存相对涨跌（基点），不存真实价格。
 *
 * 文件格式见 docs/core-api.md 第 7.3 节。
 */
import type { ThemeId } from './types.ts';

/** 市况：按大盘（老三十）在这一段里的涨跌和回撤自动判定（tools/data/segments.ts）。 */
export type Regime = 'bull' | 'bear' | 'bubble' | 'crash' | 'flat';

export const REGIMES: readonly Regime[] = ['bull', 'bubble', 'flat', 'bear', 'crash'];

export const REGIME_LABEL: Record<Regime, string> = {
  bull: '牛市',
  bear: '熊市',
  bubble: '泡沫',
  crash: '崩盘',
  flat: '横盘',
};

/** 每个风口背后对应的真实行业（tools/data/sectors.ts 的行业 id，按优先级）。name 只留在数据里，画面上不显示。 */
export const THEME_REAL: Record<ThemeId, { sectors: readonly string[]; name: string }> = {
  ai: { sectors: ['semis', 'hardware', 'netequip'], name: '芯片和电脑' },
  newenergy: { sectors: ['energy', 'utility'], name: '石油和电力' },
  consumer: { sectors: ['retail', 'auto'], name: '商场和汽车' },
  pharma: { sectors: ['pharma', 'biotech', 'health'], name: '药厂和医疗' },
  finance: { sectors: ['bank', 'broker', 'finance', 'realestate'], name: '银行、券商和保险' },
  lowalt: { sectors: ['industrial', 'telecom'], name: '飞机、工厂和运输' },
  gaming: { sectors: ['internet', 'media', 'software'], name: '互联网和传媒' },
  pig: { sectors: ['consumer', 'materials'], name: '食品和原材料' },
};

export interface SegmentStock {
  /** 绑定的游戏股票 id（src/core/content/stocks.ts） */
  slot: string;
  /** 段内编号（<风口>_<n>）；全量段库不带真实代码（旧的 26 段是年包化名 id s_xxx / tmp_xxx） */
  id: string;
  /** 化名；全量段库恒为 null（游戏里用小人的名字，局末故事不提公司） */
  name: string | null;
  /** 真实行业 id */
  sec: string;
  /** 逐日总收益（基点，含拆股分红），和 market 等长 */
  r: number[];
}

export interface SegmentTheme {
  /** 主行业 id（THEME_REAL[风口].sectors 里的第一个有数据的） */
  sector: string;
  /** 行业名（大白话，只在数据里） */
  name: string;
  /** 行业等权逐日收益（基点），和 market 等长 */
  r: number[];
  stocks: SegmentStock[];
}

/**
 * 段内一件大事（生成时已经换成故事版，见 tools/data/beats.ts）。段文件里不带真实日期和原文，免得被人对出年份。
 * day：一局里的第几个交易日（0 起，按真实日期折算）；t / alt：故事句（t 里可以有 {股}{风口}，对不上本局的风口时用 alt）；
 * 没有 t 和 alt 的按大环境那几天的方向写一句通用的。
 * date / text / quip 是 0.4 开发期旧存档里的格式（真实日期、原文），只为读旧档保留。
 */
export interface SegmentEvent {
  day?: number;
  t?: string;
  alt?: string;
  /** 相关行业 id（'market' 为全市场）；局末小故事把大事对应到本局的风口用 */
  sectors?: string[];
  date?: string;
  text?: string;
  quip?: string;
}

export interface SegmentStats {
  /** 一局期间大盘（老三十）涨跌（比例） */
  ret: number;
  /** 一局期间大盘最大回撤（比例，≤ 0） */
  dd: number;
  /** 一局期间参考线（科综）涨跌（比例） */
  ref: number;
}

/**
 * 一个行情段文件（public/data/segments/<id>.json）。id 是不透明的短哈希，文件里没有年份、起止日期和大事原文；
 * id 和真实年份的对照只在 tools/data/segments-manifest.json（数据工具和测试用，不进画面包）。
 */
export interface Segment {
  v: 1;
  id: string;
  /** 开局前的历史天数（风口热度预热用）；第 warm 个下标是第一个交易日 */
  warm: number;
  /** 一局的交易日数 */
  days: number;
  regime: Regime;
  /** 段的游戏化标题（"心电图行情"），不透露年代和公司；见 SEGMENT_TITLES */
  title: string;
  stats: SegmentStats;
  /** 段内真实大事（最多 5 条，改写过的大白话；画面上不显示原文，局末小故事按日期换成故事版） */
  events: SegmentEvent[];
  /** 大盘逐日收益（基点），长度 warm + days */
  market: number[];
  themes: Record<ThemeId, SegmentTheme>;
}

/** 目录里只有 id 和文件名（市况、标题、年份都不放，开局下载抽中的那一段才知道）。 */
export interface SegmentIndexEntry {
  id: string;
  file: string;
}

/** public/data/segments/index.json */
export interface SegmentIndex {
  v: 1;
  source: string;
  segments: SegmentIndexEntry[];
}

/** 存档里的真实行情（只含本局登场的风口）。 */
export interface RealMarket {
  segId: string;
  /** 0.5：个股照搬真实走势、情报从真实未来推算（新开局为 true；0.4 的存档没有，照 0.4 的映射走） */
  track?: boolean;
  /** 0.4 开发期旧存档才有（真实起止日期、年份）；新存档不存 */
  from?: string;
  to?: string;
  year?: number;
  regime: Regime;
  title: string;
  stats: SegmentStats;
  events: SegmentEvent[];
  warm: number;
  days: number;
  market: number[];
  themes: Partial<
    Record<
      ThemeId,
      {
        sector: string;
        name: string;
        r: number[];
        /** 行业相对所有行业平均的超额收益按 smooth 均摊后的逐日值（pp，保留 4 位）：总和与真实超额相同，但有惯性 */
        ex: number[];
        /** 没均摊的日超额收益的平均绝对值（pp，> 0），风口涨跌和热度按它归一 */
        scale: number;
      }
    >
  >;
  /** 键为游戏股票 id；scale 是个股相对行业的日收益的平均绝对值（pp，> 0），个股自身那块按它归一 */
  stocks: Record<string, { id: string; name: string | null; sec: string; r: number[]; scale: number }>;
}

/** 按种子抽一段（同一种子同一份目录一定抽到同一段；每日挑战的种子按日期定，所以大家同一段）。 */
export function pickSegmentId(seed: string, ids: readonly string[], hash: (...p: (string | number)[]) => number): string | null {
  if (ids.length === 0) return null;
  return ids[hash(seed, 'segment') % ids.length] ?? null;
}

/** 校验一个行情段文件（下载来的数据先过这一关，不对就退回合成行情）。 */
export function checkSegment(raw: unknown, themeIds: readonly ThemeId[]): string | null {
  if (typeof raw !== 'object' || raw === null) return '不是对象';
  const s = raw as Partial<Segment>;
  if (s.v !== 1 || typeof s.id !== 'string') return '版本或 id 不对';
  if (!Number.isInteger(s.warm) || !Number.isInteger(s.days) || (s.days ?? 0) <= 0) return 'warm / days 不对';
  const n = (s.warm ?? 0) + (s.days ?? 0);
  const okArr = (a: unknown): boolean => Array.isArray(a) && a.length === n && a.every((x) => Number.isInteger(x));
  if (!okArr(s.market)) return 'market 长度不对';
  if (typeof s.themes !== 'object' || s.themes === null) return '缺 themes';
  for (const id of themeIds) {
    const t = (s.themes as Record<string, SegmentTheme | undefined>)[id];
    if (!t || !okArr(t.r) || !Array.isArray(t.stocks)) return `风口 ${id} 数据不全`;
    for (const st of t.stocks) if (typeof st.slot !== 'string' || !okArr(st.r)) return `风口 ${id} 的股票数据不全`;
  }
  return null;
}

/** 从行情段里取出本局要用的部分（登场的风口、绑定的股票），算好每个行业的超额收益尺度。 */
/**
 * 行业超额收益（pp）的指数均摊：ex[i] = smooth × e[i] + (1 − smooth) × ex[i − 1]。
 * 只是把每天的超额收益摊到之后几天（总和不变，末尾没摊完的部分除外），让风口像 0.3 一样有惯性。
 */
function smoothExcess(sector: readonly number[], market: readonly number[], smooth: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < sector.length; i++) {
    const e = ((sector[i] ?? 0) - (market[i] ?? 0)) / 100;
    prev = Math.round((smooth * e + (1 - smooth) * prev) * 10000) / 10000;
    out.push(prev);
  }
  return out;
}

export function realFromSegment(seg: Readonly<Segment>, themeIds: readonly ThemeId[], stockIds: readonly string[], smooth = 1): RealMarket {
  const themes: RealMarket['themes'] = {};
  const stocks: RealMarket['stocks'] = {};
  const want = new Set(stockIds);
  // 超额收益相对"所有行业的平均"算（不是相对老三十）：大盘那块已经单独算了，风口之间比谁强谁弱才是轮动；
  // 否则某一段里小盘股整体跑输老三十，所有风口都会天天跌
  const all = Object.values(seg.themes);
  const avg = seg.market.map((_, i) => {
    let sum = 0;
    for (const t of all) sum += t.r[i] ?? 0;
    return sum / Math.max(1, all.length);
  });
  for (const id of themeIds) {
    const t = seg.themes[id];
    if (!t) throw new Error(`行情段 ${seg.id} 缺少风口 ${id}`);
    const ex = smoothExcess(t.r, avg, smooth);
    // 尺度用"没均摊的"日超额收益的平均绝对值（≈ 波动），不受趋势影响：稳稳跑赢的行业就是稳稳地涨，不会被放大成暴涨
    let sum = 0;
    for (let i = 0; i < t.r.length; i++) {
      const e = ((t.r[i] ?? 0) - (avg[i] ?? 0)) / 100;
      sum += e < 0 ? -e : e;
    }
    themes[id] = { sector: t.sector, name: t.name, r: [...t.r], ex, scale: Math.max(0.01, sum / Math.max(1, ex.length)) };
    for (const st of t.stocks) {
      if (!want.has(st.slot)) continue;
      let own = 0;
      for (let i = 0; i < st.r.length; i++) {
        const d = ((st.r[i] ?? 0) - (t.r[i] ?? 0)) / 100;
        own += d < 0 ? -d : d;
      }
      stocks[st.slot] = { id: st.id, name: st.name, sec: st.sec, r: [...st.r], scale: Math.max(0.01, own / Math.max(1, st.r.length)) };
    }
  }
  for (const sid of stockIds) if (!stocks[sid]) throw new Error(`行情段 ${seg.id} 没有绑定股票 ${sid}`);
  return {
    segId: seg.id,
    regime: seg.regime,
    title: seg.title,
    stats: { ...seg.stats },
    events: seg.events.map((e) => ({ ...e })),
    warm: seg.warm,
    days: seg.days,
    market: [...seg.market],
    themes,
    stocks,
  };
}
