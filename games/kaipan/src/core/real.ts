/**
 * 0.4 重做：真实行情驱动 0.3 的风口、大盘和个股（state.real 不为 null 时生效）。
 *
 * - 风口热度：每天的热度变化 = heatGain × 行业相对所有行业平均的超额收益（按 smooth 均摊、按这一段的日波动归一）
 *   − heatPull × (热度 − heatBase)。行业跑赢别的行业热度就涨，跑输就跌，没人炒慢慢凉。
 * - 风口阶段：按热度和当天热度变化，用一个只能按 冷 → 冒头 → 发酵 → 主升 → 高潮 → 退潮 → 冷 走的状态机判定
 *   （冒头可以夭折回冷门，发酵可以证伪直接退潮），所以 0.3 的生命周期、拐点、群聊里的"启动、见顶、退潮"都还在，
 *   只是什么时候发生由真实行业的强弱决定。
 * - 大盘：涨跌 = ampMarket × 老三十当天的真实涨跌；天气按最近几天的平均定。
 * - 个股：涨跌 = 绑定的真实股票当天的总收益，拆成大盘、行业超额、个股自身三块分别放大，再加 0.3 的游戏规则（连板惯性、炸板、妖股消息、ST 消息、
 *   龙头带小弟、涨跌停）。
 *
 * 确定性：只用加减乘除和比较（没有 exp/log/pow/sin），同一个行情段 + 种子 + 操作一定得到同一个结果。
 */
import { BALANCE } from './balance.ts';
import type { MarketRules } from './hooks.ts';
import type { RealMarket } from './segment.ts';
import type { Mood, Stage, ThemeId, ThemeState } from './types.ts';

/** 第 day 个交易日（0 起）在行情段里的下标。 */
export function tapeIndex(real: Readonly<RealMarket>, day: number): number {
  const i = real.warm + day;
  return i < real.market.length ? i : real.market.length - 1;
}

/** 大盘当天真实涨跌（pp，未放大）。 */
export function realMarketPct(real: Readonly<RealMarket>, i: number): number {
  return (real.market[i] ?? 0) / 100;
}

/**
 * 风口当天的涨跌（pp，不含加成）：行业超额收益按这一段的典型幅度归一后乘 themeK（再乘 0.3 的题材振幅），
 * 所以不管哪一年、哪个行业，风口的起落幅度都和 0.3 差不多；方向、节奏、相对大小都是真实的。
 */
export function realThemeRet(real: Readonly<RealMarket>, t: Readonly<ThemeState>, i: number, vol: number): number {
  const R = BALANCE.real;
  const th = real.themes[t.id];
  if (!th) return 0;
  return (vol * R.themeK * BALANCE.themes[t.id].amp * (th.ex[i] ?? 0)) / th.scale;
}

/** 行业当天真实涨跌（pp，未放大）。 */
export function realSectorPct(real: Readonly<RealMarket>, theme: ThemeId, i: number): number {
  return (real.themes[theme]?.r[i] ?? real.market[i] ?? 0) / 100;
}

/** 股票当天真实涨跌（pp，未放大，含拆股分红）。 */
export function realStockPct(real: Readonly<RealMarket>, stockId: string, i: number): number {
  return (real.stocks[stockId]?.r[i] ?? 0) / 100;
}

/** 真实行情给出的热度变化（未取整，不含日历、直播间等加成）。 */
export function realDH(real: Readonly<RealMarket>, t: Readonly<ThemeState>, i: number): number {
  const R = BALANCE.real;
  const th = real.themes[t.id];
  if (!th) return 0;
  return (R.heatGain * (th.ex[i] ?? 0)) / th.scale - R.heatPull * (t.heat - R.heatBase);
}

/** 大盘天气：最近 moodDays 天（含今天）放大后的平均涨跌。 */
export function realMood(real: Readonly<RealMarket>, i: number, mr: Readonly<MarketRules>): Mood {
  const R = BALANCE.real;
  let sum = 0;
  let n = 0;
  for (let k = 0; k < R.moodDays && i - k >= 0; k++) {
    sum += realMarketPct(real, i - k);
    n += 1;
  }
  const avg = (R.ampMarket * mr.vol * sum) / Math.max(1, n);
  return avg >= R.moodBull ? 'bull' : avg <= -R.moodBull ? 'bear' : 'flat';
}

/** 按今天的热度变化判定今天的阶段（只能按生命周期的顺序走）。 */
export function realNextStage(t: Readonly<ThemeState>, dH: number): Stage {
  const S = BALANCE.real.stage;
  const h = Math.min(BALANCE.heat.max, Math.max(0, t.heat + dH));
  const age = t.age ?? 0;
  switch (t.stage) {
    case 'cold':
      return dH >= S.sproutDH && h >= S.sproutHeat ? 'sprout' : 'cold';
    case 'sprout':
      if (!t.sure && (dH <= -S.fizzleDH || (age >= S.sproutMax && dH < S.sproutDH))) return 'cold';
      return h >= S.fermentHeat ? 'ferment' : 'sprout';
    case 'ferment':
      if (!t.sure && (dH <= -S.failDH || (age >= S.fermentMax && dH <= 0))) return 'ebb';
      return h >= S.rallyHeat && dH > 0 ? 'rally' : 'ferment';
    case 'rally':
      return h >= S.climaxHeat || dH <= -S.topDH ? 'climax' : 'rally';
    case 'climax':
      return dH <= -S.ebbDH || age >= S.climaxMax ? 'ebb' : 'climax';
    case 'ebb':
      return h <= S.coldHeat || (age >= S.ebbMin && dH >= 0) ? 'cold' : 'ebb';
  }
}

/** 进入（或停留在）某个阶段：更新天数；离开冒头时清掉"不会夭折"；被股灾打下来的风口回到冷门时开始报复性反弹。 */
export function realEnter(t: ThemeState, stage: Stage): void {
  if (stage === t.stage) {
    t.age = (t.age ?? 0) + 1;
    return;
  }
  if (t.stage === 'sprout') t.sure = false;
  if (stage === 'cold' && t.rebound) {
    const R = BALANCE.real.rebound;
    t.boost = { dH: R.dH, days: R.days };
    t.rebound = false;
  }
  t.stage = stage;
  t.age = 1;
}

/** 开局前预热：从冷门、基准热度出发，用行情段开局前的 warm 天真实行情把风口推到自然的状态。 */
export function warmUpReal(real: Readonly<RealMarket>, id: ThemeId): ThemeState {
  const base = BALANCE.real.heatBase;
  const t: ThemeState = { id, heat: base, history: [base], stage: 'cold', lastStage: 'cold', left: 0, sure: false, boost: null, age: 1 };
  for (let i = 1; i < real.warm; i++) {
    const dH = Math.round(realDH(real, t, i)) || 0;
    t.lastStage = t.stage;
    realEnter(t, realNextStage(t, dH));
    t.heat = Math.min(BALANCE.heat.max, Math.max(0, t.heat + dH));
    t.history.push(t.heat);
    while (t.history.length > BALANCE.historyDays) t.history.shift();
  }
  t.lastStage = t.stage;
  return t;
}

/** 0.5.1（画面用，只读）：和 warmUpReal 同样的预热过程，但把开局前每一天的热度都留下来（旧 → 新，最后一项是开局时的热度）。 */
export function warmHeatSeries(real: Readonly<RealMarket>, id: ThemeId): number[] {
  const base = BALANCE.real.heatBase;
  const t: ThemeState = { id, heat: base, history: [base], stage: 'cold', lastStage: 'cold', left: 0, sure: false, boost: null, age: 1 };
  const out = [base];
  for (let i = 1; i < real.warm; i++) {
    const dH = Math.round(realDH(real, t, i)) || 0;
    t.lastStage = t.stage;
    realEnter(t, realNextStage(t, dH));
    t.heat = Math.min(BALANCE.heat.max, Math.max(0, t.heat + dH));
    t.history.push(t.heat);
    while (t.history.length > BALANCE.historyDays) t.history.shift();
    out.push(t.heat);
  }
  return out;
}

// ================================================================ 0.5：个股照搬真实走势

/** 0.5 的真实行情（个股照搬真实走势、情报从真实未来推算）。0.4 的旧存档没有 track，照 0.4 的映射走。 */
export function isTrack(real: Readonly<RealMarket> | null | undefined): boolean {
  return !!real && real.track === true;
}

/** 放大后的大盘当天涨跌（pp）。 */
export function trackMarketRet(real: Readonly<RealMarket>, i: number): number {
  return BALANCE.track.amp * realMarketPct(real, i);
}

/** 放大后的行业（风口）当天涨跌（pp）。 */
export function trackThemeRet(real: Readonly<RealMarket>, theme: ThemeId, i: number): number {
  return BALANCE.track.amp * realSectorPct(real, theme, i);
}

/**
 * 从第 day 个交易日起 days 天（含当天）的累计涨跌（放大后，pp，逐日相加）。超出行情段末尾的天数不算。
 * kind 'theme' 用行业等权收益，'stock' 用绑定的股票。情报（群聊消息、推荐、猫、新闻预告）都按它判断"说中没有"。
 */
export function forwardRet(real: Readonly<RealMarket>, kind: 'theme' | 'stock', id: string, day: number, days: number): number {
  let sum = 0;
  const end = real.market.length;
  for (let k = 0; k < days; k++) {
    const i = real.warm + day + k;
    if (i >= end) break;
    sum += kind === 'theme' ? realSectorPct(real, id as ThemeId, i) : realStockPct(real, id, i);
  }
  return BALANCE.track.amp * sum;
}

/** 按横盘带宽把累计涨跌换成方向。 */
export function bandDir(x: number, band: number): 'up' | 'flat' | 'down' {
  return x >= band ? 'up' : x <= -band ? 'down' : 'flat';
}

/** 大盘天气（0.5）：最近 moodDays 天放大后的平均涨跌。 */
export function trackMood(real: Readonly<RealMarket>, i: number): Mood {
  let sum = 0;
  let n = 0;
  for (let k = 0; k < BALANCE.real.moodDays && i - k >= 0; k++) {
    sum += trackMarketRet(real, i - k);
    n += 1;
  }
  const avg = sum / Math.max(1, n);
  const b = BALANCE.track.moodBull;
  return avg >= b ? 'bull' : avg <= -b ? 'bear' : 'flat';
}

export type RoleName = 'leader' | 'follower' | 'bluechip' | 'meme' | 'st';

/** 一只真实股票这一段的"性格指标"（整段：开局前 + 一局）。 */
export interface StockTraits {
  /** 日涨跌平均绝对值（pp） */
  vol: number;
  /** 相对行业的日残差平均绝对值（pp） */
  resid: number;
  /** 对行业的 β（协方差 / 行业方差） */
  beta: number;
  /** 整段累计涨跌（pp，逐日相加） */
  total: number;
}

export function stockTraits(r: readonly number[], sector: readonly number[]): StockTraits {
  const n = Math.max(1, r.length);
  let vol = 0;
  let resid = 0;
  let total = 0;
  let ms = 0;
  let mx = 0;
  for (let i = 0; i < r.length; i++) {
    const a = (r[i] ?? 0) / 100;
    const b = (sector[i] ?? 0) / 100;
    vol += a < 0 ? -a : a;
    resid += a - b < 0 ? b - a : a - b;
    total += a;
    ms += b;
    mx += a;
  }
  ms /= n;
  mx /= n;
  let cov = 0;
  let v = 0;
  for (let i = 0; i < r.length; i++) {
    const a = (r[i] ?? 0) / 100 - mx;
    const b = (sector[i] ?? 0) / 100 - ms;
    cov += a * b;
    v += b * b;
  }
  return { vol: vol / n, resid: resid / n, beta: v > 0 ? cov / v : 1, total };
}

/**
 * 0.5：开局按真实股票这一段的表现校正性格（只决定显示和情报口吻，不改走势）。在每个风口内把绑定的真实序列重新分给游戏股票：
 * 过山车 ← 相对行业残差波动最大；危险股 ← 整段跌得最多；带头大哥 ← 对行业 β 最大；老实股 ← 波动最小；其余当小弟（按 β 从大到小）。
 * 数据工具切段时已经按差不多的规则分过（tools/data/segments.ts 的 assign），这里在一局的窗口上再核一遍，大多数段不变。
 */
export function fitRoles(real: RealMarket, themeIds: readonly ThemeId[], slotsOf: (theme: ThemeId) => readonly { id: string; role: RoleName }[]): void {
  for (const theme of themeIds) {
    const sector = real.themes[theme]?.r;
    if (!sector) continue;
    const slots = slotsOf(theme).filter((d) => real.stocks[d.id]);
    if (slots.length < 2) continue;
    const pool = slots.map((d) => ({ data: real.stocks[d.id] as RealMarket['stocks'][string], t: stockTraits((real.stocks[d.id] as RealMarket['stocks'][string]).r, sector) }));
    const take = (score: (t: StockTraits) => number): RealMarket['stocks'][string] => {
      let best = 0;
      for (let k = 1; k < pool.length; k++) if (score((pool[k] as (typeof pool)[number]).t) > score((pool[best] as (typeof pool)[number]).t)) best = k;
      return (pool.splice(best, 1)[0] as (typeof pool)[number]).data;
    };
    const order: RoleName[] = ['meme', 'st', 'leader', 'bluechip', 'follower'];
    const next: Record<string, RealMarket['stocks'][string]> = {};
    for (const role of order) {
      for (const d of slots) {
        if (d.role !== role) continue;
        next[d.id] =
          role === 'meme' ? take((t) => t.resid) : role === 'st' ? take((t) => -t.total) : role === 'leader' ? take((t) => t.beta) : role === 'bluechip' ? take((t) => -t.vol) : take((t) => t.beta);
      }
    }
    for (const d of slots) if (next[d.id]) real.stocks[d.id] = next[d.id] as RealMarket['stocks'][string];
  }
}
