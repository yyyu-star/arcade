/**
 * 0.3.1「让画面说话」：收盘新闻、股票小人台词。
 * 都在结果揭晓之后才抽，用各自独立的随机流（rngFor 的标签不同），不影响任何数值，同种子同操作的结果和 0.3.0 逐位相同。
 * 只用当天已经揭晓的数（热度变化、大环境、个股涨跌），不含真实阶段。
 */
import { BALANCE } from './balance.ts';
import { stockById, themeById } from './content/index.ts';
import { AHEAD_NEWS, MARKET_NEWS, THEME_NEWS } from './content/news.ts';
import { bandDir, forwardRet } from './real.ts';
import { MOOD_QUIPS, ROLE_QUIPS, STOCK_QUIPS } from './content/quips.ts';
import { rngFor, type Rng } from './rng.ts';
import type { DayReport, GameState, Mood, NewsItem, QuipMoment, StockQuip } from './types.ts';

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function pick(rng: Rng, lines: readonly string[]): string {
  return lines.length === 0 ? '' : (lines[rng.int(lines.length)] as string);
}

/**
 * 收盘新闻：热度变化最大的风口一条（有变化就有），第二大的变化够大（BALANCE.news.minDH）再来一条；
 * 今天大环境涨跌超过 BALANCE.news.market 时，再加一条全场新闻（放在最前）。
 */
export function makeNews(s: Readonly<GameState>, report: Readonly<DayReport>): NewsItem[] {
  const rng = rngFor(s.seed, 'news', report.day);
  const out: NewsItem[] = [];
  const m = report.market.ret;
  const N = BALANCE.news;
  if (Math.abs(m) >= N.market) out.push({ theme: null, dir: m > 0 ? 'up' : 'down', value: m, text: pick(rng, m > 0 ? MARKET_NEWS.up : MARKET_NEWS.down) });
  const movers = report.themes
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.dH !== 0)
    .sort((a, b) => Math.abs(b.t.dH) - Math.abs(a.t.dH) || a.i - b.i)
    .map(({ t }) => t);
  movers.slice(0, N.themes).forEach((t, k) => {
    if (k > 0 && Math.abs(t.dH) < N.minDH) return;
    const dir = t.dH > 0 ? 'up' : 'down';
    out.push({ theme: t.id, dir, value: t.dH, text: fill(pick(rng, THEME_NEWS[t.id][dir]), { theme: themeById(t.id).name }) });
  });
  // 0.5（真实行情）：一条预告——某个风口接下来 1–3 天（从明天起）会涨还是跌，按 BALANCE.intel.news 说中
  const real = s.real;
  if (real?.track && report.day + 1 < real.days && s.themeIds.length > 0) {
    const r = rngFor(s.seed, 'newsAhead', report.day);
    const theme = s.themeIds[r.int(s.themeIds.length)] as (typeof s.themeIds)[number];
    const n = Math.min(1 + r.int(3), real.days - report.day - 1);
    const x = forwardRet(real, 'theme', theme, report.day + 1, n);
    const truth = bandDir(x, 0) === 'down' ? 'down' : 'up';
    const dir = r.next() < BALANCE.intel.news ? truth : truth === 'up' ? 'down' : 'up';
    out.push({ theme, dir, value: 0, ahead: n, text: fill(pick(r, AHEAD_NEWS[dir]), { theme: themeById(theme).name, n: String(n) }) });
  }
  return out;
}

/** 某只股票在某个时机的台词池：它自己的台词 + 它角色的通用台词 + 牛市、熊市时按大盘多几句。 */
export function quipLines(stockId: string, moment: QuipMoment, mood: Mood = 'flat'): readonly string[] {
  const def = stockById(stockId);
  const byMood = mood === 'flat' ? [] : (MOOD_QUIPS[mood][moment] ?? []);
  return [...(STOCK_QUIPS[stockId]?.[moment] ?? []), ...ROLE_QUIPS[def.role][moment], ...byMood];
}

/**
 * 0.7.0 轮着说：台词池按种子打乱，按第几次（买入、卖出的序号，收盘时按交易日和格子）轮着用。
 * 打乱按角色而不是按股票：同一个角色的通用台词几只股票共用，按股票各抽各的，几只大哥就会说同一句。
 * 原来是每次随机抽，一局里同一句能冒七八次；台词只是事件，不影响局面。
 */
function cycleLine(seed: string, stockId: string, moment: QuipMoment, lines: readonly string[], k: number): string {
  const rng = rngFor(seed, 'quip', stockById(stockId).role, moment, lines.length);
  const order = lines.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return lines[order[Math.abs(k) % lines.length] as number] ?? '';
}

/**
 * 股票小人的一句台词。key 用来区分同一天同一只股票的多次（买入、卖出时是第几次买卖），同样的输入总是同一句。
 * 没有合适的台词时返回 null。
 */
export function stockQuip(s: Readonly<GameState>, stockId: string, moment: QuipMoment, key: number | string = 0): string | null {
  const lines = quipLines(stockId, moment, s.mood);
  if (lines.length === 0) return null;
  const st = s.stocks[stockId];
  const k = typeof key === 'number' ? key : s.today.day;
  return fill(cycleLine(s.seed, stockId, moment, lines, k), { stock: stockById(stockId).name, n: String(st?.boards ?? 0) });
}

/** 收盘时持仓小人的台词：退市 > 连续涨停 > 涨停 > 跌停 > 被自动卖出（止损、止盈），每只最多一句。 */
export function dayQuips(s: Readonly<GameState>, report: Readonly<DayReport>): StockQuip[] {
  const out: StockQuip[] = [];
  for (const h of report.holdings) {
    const m = report.stocks.find((x) => x.id === h.stockId);
    if (!m) continue;
    let moment: QuipMoment | null = null;
    if (m.st === 'delisted') moment = 'delisted';
    else if (m.limitUp && m.boards >= 2) moment = 'streak';
    else if (m.limitUp) moment = 'limitUp';
    else if (m.limitDown) moment = 'limitDown';
    else if (h.sold === 'stop' || h.sold === 'take') moment = 'sold';
    if (!moment) continue;
    const lines = quipLines(h.stockId, moment, s.mood);
    if (lines.length === 0) continue;
    const text = fill(cycleLine(s.seed, h.stockId, moment, lines, report.day * 5 + h.slot), { stock: stockById(h.stockId).name, n: String(m.boards) });
    out.push({ stockId: h.stockId, slot: h.slot, moment, text });
  }
  return out;
}
