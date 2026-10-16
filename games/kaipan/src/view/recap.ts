import { formatMoney, formatPoints, friendById, stockById, themeById, type DayReport, type HoldingMove, type RetPart } from '../core/index.ts';
import { bestHighlight } from './tempoText.ts';
import { moneyWord } from './labels.ts';
import { ellipsize } from '../core/format.ts';

/**
 * 收盘小结（F1）的文字：只用当天已经揭晓的 DayReport（归因 parts / amount、账户层效果），不碰真实阶段。纯函数，可单测。
 * 每一项的说明（RetPart.label、AccountEffect.label）是规则层给的大白话（按百分比、按方向措辞），这里只负责挑重点、拼句子：
 * - 每只只讲 1–2 个影响最大的原因（按 |pp| 排序，运气也算，最大的那一项一定在）；
 * - 总账有赚有亏时两头都说；只有一只股票时按这只说；
 * - when：开盘前说「昨天」，收盘动画里说「今天」。
 */

export type DayWord = '今天' | '昨天';

export interface RecapLine {
  stockId: string;
  slot: number;
  /** 「韭菜芯片 涨 10.0%（涨停）」 */
  head: string;
  /** 「+¥2,100」 */
  money: string;
  /** 1–2 个最大原因 */
  why: string;
  /** 0.5.3：当天揭晓、说对了这只所在风口方向的群友（「老王」），没有为空串——让人看到"信谁"和涨跌的因果 */
  called: string;
  amount: number;
  /** 0.5：这一只当天的涨跌（百分点，押跌时为自己的赚亏方向）与是否押跌，画「头像 + 箭头数字」用 */
  ret: number;
  short: boolean;
}

export interface Recap {
  /** 0.5：今天最精彩的事（有高光时放在最前面；没有为空串） */
  star: string;
  /** 总账一句 */
  headline: string;
  /** 第二句：赚最多（或亏最多）的那只 */
  highlight: string;
  /** 全部持仓，按金额大小排 */
  lines: RecapLine[];
  /** 账户层效果：「借钱炒股：多赚了 ¥361」 */
  effects: string[];
  total: number;
  /** 0.5：账户当天涨跌（百分点） */
  ret: number;
}

/** 影响最大的 1–2 项（按 |pp|，运气也算），没有可说的返回空数组。 */
function topParts(parts: readonly RetPart[], max = 2): RetPart[] {
  return [...parts]
    .filter((p) => Math.abs(p.value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, max);
}

/** 一只股票的原因：1–2 个影响最大的项，用规则层的说法；第二项太小（不到第一项的四分之一）就不提。 */
export function reasonOf(parts: readonly RetPart[], max = 2): string {
  const top = topParts(parts, max);
  const first = top[0];
  if (!first) return '几乎没动';
  const keep = top.filter((p, i) => i === 0 || Math.abs(p.value) >= Math.abs(first.value) / 4);
  return keep.map((p) => p.label).join('；');
}

/** 「涨 10.0%」「跌 2.1%」「没动」 */
export function moveWord(ret: number): string {
  if (Math.abs(ret) < 0.05) return '没动';
  return ret > 0 ? `涨 ${formatPoints(ret, 1, false)}` : `跌 ${formatPoints(-ret, 1, false)}`;
}

/** 押跌那一格说自己的赚亏（它涨你亏），不说「跌 14.8%」——不然和后面的「涨停」打架 */
export function shortWord(ret: number): string {
  if (Math.abs(ret) < 0.05) return '押跌没赚没亏';
  return ret > 0 ? `押跌赚了 ${formatPoints(ret, 1, false)}` : `押跌亏了 ${formatPoints(-ret, 1, false)}`;
}

/** 当天揭晓、方向和这只的涨跌一致、说对了的群友（先看当天的消息，再看隔天揭晓的）。押跌、没动的不算。 */
export function calledBy(r: DayReport, h: HoldingMove): string {
  if (h.short || Math.abs(h.move) < 0.05) return '';
  const theme = stockById(h.stockId).theme;
  const dir = h.move > 0 ? 'up' : 'down';
  const j = [...r.messages, ...(r.intel ?? [])].find((m) => m.hit && m.theme === theme && m.claim === dir);
  return j ? friendById(j.friendId).name : '';
}

function limitTag(r: DayReport, h: HoldingMove): string {
  const st = r.stocks.find((x) => x.id === h.stockId);
  if (!st) return '';
  if (st.limitUp && h.short) return st.boards >= 2 ? `（连续涨停 ${st.boards} 天，被轧）` : '（涨停，被轧）';
  if (st.limitUp) return st.boards >= 2 ? `（连续涨停 ${st.boards} 天）` : '（涨停）';
  if (st.limitDown) return '（跌停）';
  if (st.blown) return '（涨停没封住）';
  return '';
}

export function recapOf(r: DayReport, when: DayWord = '昨天'): Recap {
  const total = Math.round((r.account.after - r.account.before) * 100) / 100;
  const holds = r.holdings.filter((h) => h.stockId);
  const lines: RecapLine[] = holds.map((h) => ({
    stockId: h.stockId,
    slot: h.slot,
    head: `${stockById(h.stockId).name} ${h.short ? shortWord(h.ret) : moveWord(h.ret)}${limitTag(r, h)}`,
    money: formatMoney(h.amount, { sign: true }),
    why: reasonOf(h.parts),
    called: calledBy(r, h),
    amount: h.amount,
    ret: h.ret,
    short: !!h.short,
  }));
  lines.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const effects = (r.account.effects ?? []).filter((e) => Math.round(e.amount) !== 0).map((e) => `${e.label}（${formatMoney(e.amount, { sign: true })}）`);
  const top = lines[0];
  const highlight = top && lines.length > 1 ? `${top.amount >= 0 ? '赚最多' : '亏最多'}的是${top.head}（${top.money}）：${top.why}` : '';
  const best = bestHighlight(r.tempo?.highlights ?? []);
  const star = best ? `${when}最精彩：${best.text}` : '';
  return { star, headline: headlineOf(r, total, when), highlight, lines, effects, total, ret: r.account.ret };
}

/**
 * 总账一句：
 * - 一只股票：「昨天亏了 ¥580，都在熬夜救星药业上：今天大环境差，大家都在跌」；
 * - 有赚有亏：「昨天净赚 ¥659：AI 赚了 ¥2,387，养猪亏了 ¥1,433」；
 * - 全是赚（或全是亏）：「昨天赚了 ¥770，主要靠大消费（+¥710）」。
 */
export function headlineOf(r: DayReport, total = r.account.after - r.account.before, when: DayWord = '昨天'): string {
  const holds = r.holdings.filter((h) => h.stockId);
  if (holds.length === 0) return Math.round(total) === 0 ? `${when}手里没有股票，账户没动` : `${when}${moneyWord(total)}`;
  if (holds.length === 1) {
    const h = holds[0]!;
    const name = stockById(h.stockId).name;
    if (Math.round(total) === 0) return `${when}没赚没亏：${name}${h.short ? shortWord(h.ret) : moveWord(h.ret)}`;
    return `${when}${moneyWord(total)}，都在${name}上：${reasonOf(h.parts, 1)}`;
  }
  // 按风口把各格的盈亏加起来
  const byTheme = new Map<string, number>();
  for (const h of holds) {
    const t = stockById(h.stockId).theme;
    byTheme.set(t, (byTheme.get(t) ?? 0) + h.amount);
  }
  const name = (id: string): string => themeById(id as never).name;
  const ups = [...byTheme.entries()].filter(([, v]) => Math.round(v) > 0).sort((a, b) => b[1] - a[1]);
  const downs = [...byTheme.entries()].filter(([, v]) => Math.round(v) < 0).sort((a, b) => a[1] - b[1]);
  if (ups.length > 0 && downs.length > 0) {
    const net = Math.round(total) === 0 ? `${when}没赚没亏` : total > 0 ? `${when}净赚 ${formatMoney(total)}` : `${when}净亏 ${formatMoney(-total)}`;
    const up = ups[0]!;
    const down = downs[0]!;
    // 其余风口合起来说一句（不说「小赚小亏」：可能并不小）
    const rest = Math.round([...byTheme.values()].reduce((n, v) => n + v, 0) - up[1] - down[1]);
    const more = ups.length + downs.length > 2 ? (rest === 0 ? '，其他基本没动' : `，其他加起来${rest > 0 ? '赚' : '亏'}了 ${formatMoney(Math.abs(rest))}`) : '';
    return `${net}：${name(up[0])}赚了 ${formatMoney(up[1])}，${name(down[0])}亏了 ${formatMoney(-down[1])}${more}`;
  }
  const head = `${when}${moneyWord(total)}`;
  const top = (total >= 0 ? ups : downs)[0];
  if (!top || Math.round(total) === 0) return head;
  const all = byTheme.size === 1;
  return `${head}，${total > 0 ? (all ? '全靠' : '主要靠') : all ? '全亏在' : '主要亏在'}${name(top[0])}（${formatMoney(top[1], { sign: true })}）`;
}

/** 拆解条的短标签：规则层说明的第一个词组（「运气（每天都有的小起伏）让它涨了 5.1%」→「运气」），整句放悬停提示。 */
export function shortPart(label: string, max = 8): string {
  const head = (label.split(/[（(：:，,；;]/)[0] ?? label).trim();
  return ellipsize(head, max) || label;
}

/** 拆解条：每一项一行（说明 + 数值），按影响大小排，值为 0 的不列。 */
export function breakdownOf(h: Pick<HoldingMove, 'parts' | 'ret' | 'amount'>): { label: string; value: number; text: string }[] {
  return [...h.parts]
    .filter((p) => Math.abs(p.value) >= 0.005)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((p) => ({ label: p.label, value: p.value, text: formatPoints(p.value, 1) }));
}
