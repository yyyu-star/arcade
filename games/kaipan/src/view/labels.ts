import {
  BALANCE,
  baseBill,
  dailyScoreView,
  formatMoney,
  formatPoints,
  totalDays,
  itemById,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  type BillView,
  type Dir,
  type RunSummary,
  type StockCard,
  type TopBar,
  type TurnTalk,
} from '../core/index.ts';
import type { RunBoard } from './dailyBoard.ts';
import { FEEL_CYCLE, TURN_WORD } from './glossary.ts';
import { ellipsize } from '../core/format.ts';

/**
 * 界面文案与纯计算（不依赖 Phaser，可单测）。涉及规则的数字一律从 core 取。
 */

/** 顶栏日期：「3月 · 第 2/5 天」。 */
export function dayLabel(t: Pick<TopBar, 'month' | 'day' | 'daysInMonth'>): string {
  return `${t.month}月 ${t.day}/${t.daysInMonth}`;
}

/** 顶栏还款：「这个月要还 ¥15,600 · 还剩 4 天」。 */
export function billLine(b: Pick<BillView, 'amount' | 'daysLeft'>): string {
  return `这个月要还 ${formatMoney(b.amount)} · 还剩 ${b.daysLeft} 天`;
}

type BillStatus = 'ok' | 'tight' | 'short' | 'credit';

/**
 * 还款状态：short 余额不够（有信用卡时为 credit）；tight 够还但余量不到两成；ok 宽裕。
 * text 为提示语（ok 时为空串）。
 */
export function billStatus(b: Pick<BillView, 'amount' | 'account' | 'credit'>): { status: BillStatus; text: string } {
  if (b.account < b.amount) {
    const gap = formatMoney(b.amount - b.account);
    return b.credit ? { status: 'credit', text: `还差 ${gap}，${itemById('credit').name}能帮你还这一次` } : { status: 'short', text: `还差 ${gap}，月底还不上，游戏就结束` };
  }
  if (b.account < b.amount * 1.2) return { status: 'tight', text: `还完只剩 ${formatMoney(b.account - b.amount)}，小心点` };
  return { status: 'ok', text: '' };
}

/** 道具栏里的短名：取前两个字（「借钱炒股」→「借钱」）。 */
export function shortItemName(name: string): string {
  return Array.from(name).slice(0, 2).join('');
}

/** 「要变天了」消息的小标签（MessageView.turn，只由公开信息决定）。 */
export const TURN_LABEL: Record<TurnTalk, string> = TURN_WORD;

/** 消息方向：涨 +1、不动 0、跌 -1（决定配色）。 */
export function claimSign(d: Dir): number {
  return d === 'up' ? 1 : d === 'down' ? -1 : 0;
}

/** 群友战绩：没记录时「新来的」，有记录时「说对 3/3」（规则层已给好，这里只兜底旧格式）。 */
export function recordText(record: string): string {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(record);
  if (!m) return record || '新来的';
  return m[2] === '0' ? '新来的' : `说对 ${m[1]}/${m[2]}`;
}

/**
 * 持仓卡上最近一个交易日的涨跌：开盘前说「昨天 +2.1%」，收盘动画里说「今天 +2.1%」。
 * 今天刚买入显示「新买」；开局持仓一般用开局前历史的最后一天，连那也没有时显示「等开盘」。
 */
export function todayText(ret: number | null, boughtToday = true, _when: '今天' | '昨天' = '今天'): string {
  if (ret === null) return boughtToday ? '新买' : '等开盘';
  return pctArrow(ret);
}

/** 0.5 涨跌一律「箭头 + 数字」：↑5.2% / ↓3.0% / 0.0%（颜色由画面按 signColor 上）。ret 为百分点。 */
export function pctArrow(ret: number, digits = 1): string {
  if (Math.abs(ret) < 0.05) return formatPoints(0, digits, false);
  return `${ret > 0 ? '↑' : '↓'}${formatPoints(Math.abs(ret), digits, false)}`;
}

/** 买入以来的收益。 */
export function holdText(ret: number): string {
  return `累计 ${pctArrow(ret)}`;
}

/** 连续涨停：0 时为空串。 */
export function boardsText(n: number): string {
  return n >= 2 ? `涨停×${n}` : n === 1 ? '涨停' : '';
}

/** 危险股提示：退市警告次数或翻身后还要涨停几天；没有时为空串。 */
export function stText(c: Pick<StockCard, 'role' | 'warnings' | 'uncap' | 'delisted'>): string {
  if (c.delisted) return '已退市';
  if (c.uncap > 0) return `翻身了！还会涨停 ${c.uncap} 天`;
  if (c.warnings > 0) return `退市警告 ${c.warnings}/${BALANCE.st.warnings}`;
  return '';
}

/** 快捷键提示文字。 */
export function buyKey(i: number): string {
  return `${i + 1}`;
}
export function sellKey(i: number): string {
  return `Shift+${i + 1}`;
}

/** 0.18.1 炒股合计按正负叫「净赚」或「净亏」（以前亏了也写「炒股净赚 −¥325万」，和副标题的「炒股净亏」对不上） */
export function tradeWord(tradeMoney: number): string {
  return tradeMoney >= 0 ? '炒股净赚' : '炒股净亏';
}

/**
 * 0.5.4：一本加得起来的账——本钱 + 炒股净赚 − 账单 + 其他 (+ 没还的借款) = 最后剩。
 * 旧存档没有炒股和账单合计：只列本钱和最后剩。
 */
export function ledgerRows(s: RunSummary): [string, string][] {
  const rows: [string, string][] = [['本钱', formatMoney(s.startAccount)]];
  if (s.tradeMoney !== null && s.billMoney !== null && s.otherMoney !== null) {
    rows.push([tradeWord(s.tradeMoney), formatMoney(s.tradeMoney, { sign: true })]);
    rows.push(['还掉的账单', formatMoney(-s.billMoney, { sign: true })]);
    rows.push(['其他（奖励、利息、罚款）', formatMoney(s.otherMoney, { sign: true })]);
    if (s.debtLeft > 0) rows.push(['借来还没还', formatMoney(s.debtLeft, { sign: true })]);
  }
  rows.push(['最后剩', formatMoney(s.account)]);
  return rows;
}

/** 结束页小结的行：[标题, 数值]。 */
export function summaryRows(s: RunSummary): [string, string][] {
  return [
    ['撑到', s.won ? `${s.live?.months ?? 12} 个月的钱全还上了` : `${s.month} 月（还上了 ${s.billsPaid} 个月）`],
    ...ledgerRows(s),
    ['最高账户', formatMoney(s.peakAccount)],
    ['涨停天数', `${s.limitUpDays} 天`],
    ['最长连续涨停', s.maxBoards > 1 ? `${s.maxBoards} 天` : '没有'],
    ['大哥带小弟', `${s.chains} 次`],
    [s.bestTrade && s.bestTrade.ret < 0 ? '亏得最少的一笔' : '最赚的一笔', s.bestTrade ? `${s.bestTrade.name} ${formatPoints(s.bestTrade.ret)}` : '没有交易'],
  ];
}

/**
 * 结束页副标题：讲清三件事——还了多少账单、炒股净赚多少、最后剩多少（0.5.4）。
 * 旧存档没有账单和炒股合计时退回旧说法。
 */
export function endSubtitle(s: RunSummary): string {
  const trade = s.tradeMoney === null ? '' : `${tradeWord(s.tradeMoney)} ${formatMoney(Math.abs(s.tradeMoney))}`;
  const bills = s.billMoney === null ? '' : `还了 ${formatMoney(s.billMoney)} 账单`;
  if (s.won) {
    if (!trade || !bills) return `12 个月的钱全还上了，带着 ${formatMoney(s.account)} 上岸`;
    return `${trade}，${bills}，带着 ${formatMoney(s.account)} 上岸`;
  }
  return trade ? `${s.month} 月要还的钱没还上：${trade}${bills && s.billMoney ? `，${bills}` : ''}` : `${s.month} 月要还的钱没还上，游戏结束`;
}

/** 关于面板里的玩法简介（数字来自 core）。 */
export function aboutRules(): string[] {
  return [
    `你是刚开始炒股的普通人。开局账户 ${formatMoney(BALANCE.startAccount)}，能同时拿 ${BALANCE.slots} 只股票。一局 12 个月，一个月只有大约 ${Math.round(totalDays() / 12)} 个交易日。`,
    `风口会轮流火：${FEEL_CYCLE}。热度涨，这个风口的股票就涨；热度跌，就跌。`,
    '每天开盘前看看群聊和推荐，买一只放进空格，或者卖掉手里的（今天买的明天才能卖）。然后点「开盘」，看今天涨还是跌。',
    `每个月底要从账户里还一笔钱（1 月 ${formatMoney(baseBill(1))}，越往后越多），还不上，游戏就结束。还上了可以挑一样奖励：道具、新群友或稀有股票。`,
  ];
}

export const ABOUT_CONTROLS: [string, string][] = [
  ['1–3（有道具时到 4）', '买对应的推荐（格子满了会让你选换掉哪只）'],
  ['Shift + 1 – 5', '卖掉第 1–5 格'],
  ['空格 / 回车', '开盘；动画播放时跳过；月底继续'],
  ['Esc', '关掉对话框、取消换股'],
];

export const ABOUT_TOUCH_CONTROLS: [string, string][] = [
  ['买入', '点推荐卡上的「买入」'],
  ['卖出', '点持仓卡下面的「卖出」'],
  ['开盘', '点底部的大按钮'],
  ['跳过动画', '点屏幕任意处'],
];

/** 赚亏一句话：「赚了 ¥5,890」「亏了 ¥1,200」「没赚没亏」。 */
export function moneyWord(delta: number): string {
  const v = Math.round(delta);
  if (v === 0) return '没赚没亏';
  return v > 0 ? `赚了 ${formatMoney(v)}` : `亏了 ${formatMoney(-v)}`;
}

// ================================================================ 0.3.0 长线：人设、难度、每日挑战、图鉴、成就、档案

/**
 * 每日挑战的日期 YYYY-MM-DD：按北京时间（0.5.10 起，排行榜按北京日期分榜；之前是玩家本地日期，国内一样）。
 * 本机时区不对也没关系，大家同一时刻看到的是同一天。
 */
export function dailyDate(d: Date = new Date()): string {
  const b = new Date(d.getTime() + 8 * 3600_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}`;
}

/** 难度在几级里的位置：「最简单」「最难」「难度 3/8」。 */
export function levelHint(level: number): string {
  if (level <= MIN_DIFFICULTY) return '最简单';
  if (level >= MAX_DIFFICULTY) return '最难';
  return `难度 ${level}/${MAX_DIFFICULTY}`;
}

/** 「第 1 级·新手（最简单）」 */
export function levelLabel(level: number, name: string): string {
  return `第 ${level} 级·${name}（${levelHint(level)}）`;
}

/** 未解锁人设的解锁条件。 */
export function personaLockText(unlockBy: { name: string; desc: string } | null): string {
  return unlockBy ? `完成成就「${unlockBy.name}」解锁：${unlockBy.desc}` : '';
}

/** 未解锁难度的说明。 */
export function difficultyLockText(level: number): string {
  return `在第 ${level - 1} 级通关一次解锁`;
}

/** 开局按钮旁的一句：人设 + 难度。 */
export function setupLine(personaName: string, level: number, levelName: string): string {
  return `${personaName} · ${levelLabel(level, levelName)}`;
}

export const CODEX_TABS: { key: 'stocks' | 'friends' | 'items' | 'events' | 'achievements' | 'segments' | 'words' | 'knowledge'; label: string }[] = [
  { key: 'stocks', label: '股票' },
  { key: 'friends', label: '群友' },
  { key: 'items', label: '道具' },
  { key: 'events', label: '事件' },
  { key: 'achievements', label: '成就' },
  { key: 'segments', label: '行情段' },
  { key: 'words', label: '词典' },
  { key: 'knowledge', label: '小知识' },
];

/** 成就档位名 */
export const TIER_NAME: Record<'bronze' | 'silver' | 'gold', string> = { bronze: '铜', silver: '银', gold: '金' };

/** 某个人设 × 难度的最好成绩。 */
export function bestText(b: { runs: number; wins: number; bestAccount: number; bestMonths: number } | undefined): string {
  if (!b || b.runs === 0) return '还没玩过';
  const won = b.wins > 0 ? `通关 ${b.wins} 次，最高 ${formatMoney(b.bestAccount)}` : `最多还清 ${b.bestMonths} 个月`;
  return `${won}（共 ${b.runs} 局）`;
}

/** 今日每日挑战纪录。 */
export function dailyText(d: { attempts: number; won: boolean; bestAccount: number; bestMonths: number } | undefined): string {
  if (!d || d.attempts === 0) return '今天还没挑战过';
  return d.won ? `今日最好：通关，${formatMoney(d.bestAccount)}（挑战 ${d.attempts} 次）` : `今日最好：还清 ${d.bestMonths} 个月（挑战 ${d.attempts} 次）`;
}

/**
 * 开始菜单「每日挑战」按钮角上的小牌子（0.6.9）：今天没打过写「新题」，打过写今天全站第几名（读不到名次写「已打」）。
 * 排行榜上线后没人打完过每日挑战（入口只是第二排的小按钮），牌子让它被看见；只说今天的题和名次，不催。
 */
export function dailyBadgeView(rec: { attempts: number } | undefined, rank?: number | null): { text: string; fresh: boolean } {
  if (!rec || rec.attempts === 0) return { text: '新题', fresh: true };
  return { text: rank ? `第${rank}名` : '已打', fresh: false };
}

/** 排行榜上的一个成绩：「通关 ¥5,468.71万」「还清 7 个月」（和每日挑战的"今日最好"一个说法）。 */
export function boardScoreText(score: number): string {
  const v = dailyScoreView(score);
  return v.won ? `通关 ${formatMoney(v.account)}` : `还清 ${v.months} 个月`;
}

/** 结束页上排行榜的一行（null = 不提排行榜）；retry 表示可以给「重试」。 */
export function boardLine(b: RunBoard): { text: string; good: boolean; retry: boolean } | null {
  const plain = (text: string, retry = false): { text: string; good: boolean; retry: boolean } => ({ text, good: false, retry });
  if (b.state === 'none') return null;
  if (b.state === 'skip') return plain(b.why === 'synthetic' ? '这局用的是模拟行情，不计入排行' : '日期过了，这局不计入排行');
  if (b.state === 'sending') return plain('正在交成绩……');
  const r = b.result;
  if (r.kind === 'ok') {
    const rank = b.rank === undefined ? '' : b.rank === null ? '今日 1 万名以后' : `今日第 ${b.rank} 名`;
    if (r.improved) return { text: rank ? `新纪录！${rank}` : '新纪录！成绩交上了', good: true, retry: false };
    return plain(`${rank ? `${rank} · ` : ''}榜上最好：${boardScoreText(r.best)}`);
  }
  // 0.6.5 照平台的错误码对照表（15.10）说清怎么办
  if (r.kind === 'limit') return plain(`交成绩太频繁了，歇一会儿再试${r.retryAfter ? `（${Math.max(1, Math.ceil(r.retryAfter / 60))} 分钟后）` : ''}`);
  if (r.kind === 'busy') return plain('服务器今天有点忙，成绩先交不上，明早恢复');
  // 刷新后这一局已经结算过、不会再交：要上榜得换好账号再打一局
  if (r.kind === 'wrong_user') return plain('账号换过了，刷新后再打一局才能上榜');
  if (r.kind === 'offline') return plain('没连上，成绩没记上', true);
  if (r.kind === 'odd') return plain('成绩交了，点「排行榜」看看');
  if (r.kind === 'out') return plain('登录后才能上排行');
  return plain('成绩没交上（游戏出了点错）');
}

/** 标题页的档案一行。 */
export function profileLine(p: { runs: number; wins: number; maxDifficulty: number }, seen: number, seenTotal: number, ach: number, achTotal: number): string {
  if (p.runs === 0) return '第一次来？点「快速开始」，新手教程会在路上一步步冒出来';
  return `通关 ${p.wins}/${p.runs} 局 · 已解锁第 ${p.maxDifficulty} 级 · 图鉴 ${seen}/${seenTotal} · 成就 ${ach}/${achTotal}`;
}

/** 每日挑战局在画面上的标记。 */
export function dailyTag(date: string): string {
  return `每日挑战 ${date.slice(5).replace('-', '/')}`;
}

/**
 * 开盘结算时持仓卡先揭晓的数字（龙头带动、道具之后再跳）：做多的是股票本身的涨跌（不含带动）；
 * 押跌的直接是这一格自己的收益（它涨你亏，含被轧）——不然被轧那天会先闪一下股票的 +10% 再变成亏损。
 */
export function revealShown(e: { short?: boolean; ret: number; move: number; steps: readonly { value: number }[]; stock: { chain: number } }): number {
  return e.short ? e.ret : (e.steps[0]?.value ?? e.move) - e.stock.chain;
}

/** 气泡里的短话：取第一句；还长就取第一个逗号前；再长截到 16 字。 */
export function shortHint(text: string): string {
  const first = (text.split(/[。！？\n]/)[0] ?? text).trim();
  const clause = Array.from(first).length > 16 ? (first.split('，')[0] ?? first) : first;
  return ellipsize(clause, 16);
}


/**
 * 盘前"还能买几只"的说法：次数用完说「今天买够了」；有仓位玩法、现金一份都不剩时说「没现金了」
 * （以前现金 ¥0 也写「今天还能买 2 只」，点了又买不了）。
 */
export function buysText(buysLeft: number, cashUnits: number | null): { text: string; can: boolean } {
  if (buysLeft <= 0) return { text: '今天买够了', can: false };
  if (cashUnits !== null && cashUnits <= 0) return { text: '没现金了', can: false };
  return { text: `今天还能买 ${buysLeft} 只`, can: true };
}

/** 事件两个选项从左往右的摆法：左边是"不做"（选项 1），右边是"做"（选项 0，金边）。快捷键按位置数：左 1、右 2。 */
export const EVENT_ORDER: readonly number[] = [1, 0];

/** 按了数字键 n，选的是事件的第几个选项；不是 1、2 返回 null。 */
export function eventOptionForKey(n: number): number | null {
  return EVENT_ORDER[n - 1] ?? null;
}
