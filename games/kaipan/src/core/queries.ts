/**
 * 画面用的查询函数：只返回玩家能看到的信息（隐藏字段只在规则允许时出现，例如情绪指标显示真实阶段）。
 * 画面不要直接读 GameState 里标了「隐藏」的字段，见 docs/core-api-0.3.md。
 */
import type { Regime } from './segment.ts';
import type { EventPick } from './content/index.ts';
import { storyView } from './reveal.ts';
import { BALANCE } from './balance.ts';
import { flipDir, topicsOf } from './chat.ts';
import {
  CALENDAR,
  EVENTS,
  EVENT_BRIEF,
  ITEM_BRIEF,
  calendarOf,
  difficultyDef,
  eventById,
  friendById,
  itemById,
  personaAccount,
  personaById,
  stockById,
  stocksOf,
  themeById,
} from './content/index.ts';
import { extRecap } from './extview.ts';
import { isCleanLiveSetup, liveAssets, liveMultipleBp, liveStart, liveTierOf, liveValue } from './live.ts';
import type { LiveTier } from './liveTiers.ts';
import { canSell, daysInMonth, daysLeftInMonth, debtOf, holdingBase, isBusy, isRankedSetup, totalDays, validate } from './engine.ts';
import { achievementsOf, runId, seenOf, type SeenSets } from './meta.ts';
import {
  AUTO_SELL_LABEL,
  DIR_LABEL,
  FEEL_LABEL,
  ITEM_KIND_LABEL,
  RARITY_LABEL,
  REWARD_KIND_LABEL,
  ROLE_LABEL,
  STAGE_LABEL,
  WEATHER_LABEL,
} from './labels.ts';
import { baseMarketRules, feelOf, marketReturn, MOODS, round2, rulesOf, warmUpTheme } from './market.ts';
import { rngFor } from './rng.ts';
import { isTrack, realStockPct, trackMarketRet, warmHeatSeries } from './real.ts';
import type {
  BillExtra,
  Dir,
  Face,
  Feel,
  GameState,
  ItemKind,
  MarketNotice,
  Mood,
  PersonaId,
  Rarity,
  RewardKind,
  Role,
  Stage,
  ThemeId,
  TurnTalk,
} from './types.ts';

// ================================================================ 题材看板

export interface ThemeCard {
  id: ThemeId;
  name: string;
  /** 一句话性格 */
  desc: string;
  heat: number;
  /** 近 5 日的热度变化（旧 → 新） */
  trend: number[];
  /** 最近一天的热度变化 */
  lastDelta: number;
  feel: Feel;
  feelLabel: string;
  /** 上一个交易日的真实阶段：持有情绪指标时每个题材都给，熬夜复盘时只给被揭示的那个，否则为 null */
  stage: Stage | null;
  stageLabel: string | null;
  /** 这一条阶段来自熬夜复盘（只标注到这个盘前） */
  reviewed: boolean;
  /** 大V直播间跟单的加成（还剩几天、每天 +几） */
  boost: { dH: number; days: number } | null;
  /** 本题材在场的股票 id（龙头在前） */
  stocks: string[];
}

export function themeBoard(s: Readonly<GameState>): ThemeCard[] {
  const reveal = rulesOf(s).revealStages;
  const review = s.review && s.review.day === s.dayIndex - 1 ? s.review : null;
  return s.themeIds.map((id) => {
    const t = s.themes[id];
    const history = t?.history ?? [];
    const trend: number[] = [];
    for (let i = Math.max(1, history.length - 5); i < history.length; i++) trend.push((history[i] ?? 0) - (history[i - 1] ?? 0));
    const feel = feelOf(history);
    const reviewed = review?.theme === id;
    const stage = reveal && t ? t.lastStage : reviewed && review ? review.stage : null;
    return {
      id,
      name: themeById(id).name,
      desc: themeById(id).desc,
      heat: t?.heat ?? 0,
      trend,
      lastDelta: trend[trend.length - 1] ?? 0,
      feel,
      feelLabel: FEEL_LABEL[feel],
      stage,
      stageLabel: stage ? STAGE_LABEL[stage] : null,
      reviewed: reviewed && !reveal,
      boost: t?.boost ? { ...t.boost } : null,
      stocks: stocksOf(id)
        .filter((d) => s.stocks[d.id] && !s.stocks[d.id]?.delisted)
        .map((d) => d.id),
    };
  });
}

// ================================================================ 股票与持仓卡

/** 股票小人的表情：按上一个交易日的涨跌。 */
export function faceOf(move: number, limit: number, delisted = false): Face {
  if (delisted) return 'delisted';
  if (move >= limit - 1e-9) return 'limitup';
  if (move <= -limit + 1e-9) return 'limitdown';
  if (move >= 1) return 'happy';
  if (move <= -1) return 'worried';
  return 'calm';
}

export interface StockCard {
  id: string;
  name: string;
  theme: ThemeId;
  themeName: string;
  role: Role;
  roleLabel: string;
  price: number;
  /** 上一个交易日涨跌（pp） */
  move: number;
  /** 近 5 日涨跌（pp） */
  history: number[];
  boards: number;
  face: Face;
  /** ST：退市警告次数 / 摘帽后还要涨停几天 */
  warnings: number;
  uncap: number;
  delisted: boolean;
}

export function stockCard(s: Readonly<GameState>, id: string): StockCard {
  const def = stockById(id);
  const st = s.stocks[id];
  const limit = BALANCE.roles[def.role].limit;
  return {
    id,
    name: def.name,
    theme: def.theme,
    themeName: themeById(def.theme).name,
    role: def.role,
    roleLabel: ROLE_LABEL[def.role],
    price: st?.price ?? 0,
    move: st?.move ?? 0,
    history: [...(st?.history ?? [])],
    boards: st?.boards ?? 0,
    face: faceOf(st?.move ?? 0, limit, st?.delisted ?? false),
    warnings: st?.warnings ?? 0,
    uncap: st?.uncap ?? 0,
    delisted: st?.delisted ?? false,
  };
}

export interface HoldingCard extends StockCard {
  slot: number;
  /** 这一格上一个交易日的收益（pp，含道具）；刚买入为 null */
  todayRet: number | null;
  /** 持有收益（pp） */
  holdRet: number;
  /** 今天能卖（T+1） */
  canSell: boolean;
  /** 买入时是冷门或降温（低吸大师） */
  lowBuy: boolean;
  /** 这一只占账户的比例（0..1）：1/4；多开一格且拿满 5 只时 1/(4 + fx(extra_slot, share))，0.3.0 为 1/4.5；0.4 C 再乘份数 */
  weight: number;
  /** 0.4 C：占几份（缺省 1）、押跌 */
  units: number;
  short: boolean;
}

/** 持仓格：每格一项，空格为 null。 */
export function holdingCards(s: Readonly<GameState>): (HoldingCard | null)[] {
  return s.slots.map((h, slot) => {
    if (!h) return null;
    return {
      ...stockCard(s, h.stockId),
      slot,
      todayRet: h.todayRet,
      holdRet: Math.round((h.value - 1) * 10000) / 100,
      canSell: s.phase === 'premarket' && !isBusy(s) && canSell(s, slot),
      lowBuy: h.lowBuy,
      weight: (h.units ?? 1) / holdingBase(s),
      units: h.units ?? 1,
      short: !!h.short,
    };
  });
}

// ================================================================ 群聊

export interface FriendView {
  id: string;
  name: string;
  title: string;
  desc: string;
  hits: number;
  total: number;
  /** 「说中 3/5」 */
  record: string;
  /** 擅长的题材名（大V为"当前最热"，群主为"全部"） */
  topics: string;
}

export function friendView(s: Readonly<GameState>, id: string): FriendView {
  const def = friendById(id);
  const f = s.friends.find((x) => x.id === id);
  const hits = f?.hits ?? 0;
  const total = f?.total ?? 0;
  let topics: string;
  if (def.topics === 'hottest') topics = '当前最热的风口';
  else if (def.topics === 'all') topics = '全部';
  else topics = (f ? topicsOf(s, f) : []).map((t) => themeById(t).name).join('、') || '（本局没有）';
  if (def.memes) topics += topics ? '、过山车股' : '过山车股';
  return { id, name: def.name, title: def.title, desc: def.desc, hits, total, record: total === 0 ? '新来的' : `说对 ${hits}/${total}`, topics };
}

export function friendsView(s: Readonly<GameState>): FriendView[] {
  return s.friends.map((f) => friendView(s, f.id));
}

export interface MessageView {
  index: number;
  friend: FriendView;
  theme: ThemeId;
  themeName: string;
  claim: Dir;
  claimLabel: string;
  text: string;
  /** 老王的小本本：这条必中 */
  certain: boolean;
  /** 拐点说法（要起飞了 / 差不多到顶了 / 该跑了），普通消息为 null */
  turn: TurnTalk | null;
  /** 反着信群主（道具）：这条按反方向读，readAs 是反过来的方向 */
  reverse: boolean;
  readAs: Dir | null;
  readAsLabel: string | null;
}

export interface RecView {
  index: number;
  /** 推荐人；关闭群聊（模拟用）时为 null */
  friend: FriendView | null;
  text: string;
  stock: StockCard;
  taken: boolean;
  /** 现在能不能买（放进第一个空格）；不能时给原因 */
  error: string | null;
  /** 0.4 C：唱空的群友建议押它跌 */
  short: boolean;
}

export interface ChatView {
  messages: MessageView[];
  recs: RecView[];
  buysLeft: number;
}

export function chatView(s: Readonly<GameState>): ChatView {
  const rules = rulesOf(s);
  return {
    messages: s.today.messages.map((m, index) => ({
      index,
      friend: friendView(s, m.friendId),
      theme: m.theme,
      themeName: themeById(m.theme).name,
      claim: m.claim,
      claimLabel: DIR_LABEL[m.claim],
      text: m.text,
      // 只有道具指定的"必中"（credOverride ≥ 1）才标；其余可信度都封顶在 BALANCE.chat.credMax
      certain: (rules.credOverride[m.friendId] ?? 0) >= 1,
      turn: m.turn ?? null,
      reverse: !!m.reverse,
      readAs: m.reverse ? flipDir(m.claim) : null,
      readAsLabel: m.reverse ? DIR_LABEL[flipDir(m.claim)] : null,
    })),
    recs: s.today.recs.map((r, index) => ({
      index,
      friend: r.friendId ? friendView(s, r.friendId) : null,
      text: r.text,
      stock: stockCard(s, r.stockId),
      taken: r.taken,
      error: validate(s, { type: 'buy', rec: index }),
      short: !!r.short,
    })),
    buysLeft: s.today.buysLeft,
  };
}

/** 买入第 rec 条推荐放进 / 替换第 slot 格是否可行（不可行时给原因）。 */
export function buyError(s: Readonly<GameState>, rec: number, slot?: number): string | null {
  return validate(s, slot === undefined ? { type: 'buy', rec } : { type: 'buy', rec, slot });
}

// ================================================================ 顶栏、月供、日历

export interface TopBar {
  month: number;
  /** 本月第几天（1 起） */
  day: number;
  daysInMonth: number;
  calendar: CalendarView;
  account: number;
  bill: number;
  billName: string;
  /** 本月还剩几个交易日（含今天） */
  daysLeft: number;
  mood: Mood;
  weather: string;
  items: ItemView[];
  slots: number;
  buysLeft: number;
  /** 人设 */
  persona: PersonaId;
  personaName: string;
  /** 难度等级与名字 */
  difficulty: number;
  difficultyName: string;
  /** 每日挑战的日期（不是每日挑战为 null） */
  daily: string | null;
  /** 本月的市场传闻（第 6 级股灾），没有为 null */
  notice: MarketNotice | null;
  /** 今天没空看盘（加班事件） */
  busy: boolean;
  /** 0.6.0 实盘：档位名、一份、按现在的资产能结回多少；娱乐局为 null */
  live: { tierName: string; stake: number; value: number } | null;
  /** 临时道具（id → 到几月底失效） */
  expiring: { id: string; month: number }[];
  /** 事件留下的延后结算（公开） */
  pending: { id: string; name: string; month: number; amount: number }[];
}

function topBarLive(s: Readonly<GameState>): TopBar['live'] {
  const t = liveTierOf(s);
  return t ? { tierName: t.name, stake: t.stake, value: liveValue(s) ?? 0 } : null;
}

export function topBar(s: Readonly<GameState>): TopBar {
  return {
    month: s.month,
    day: Math.min(s.dayInMonth + 1, daysInMonth(s.month)),
    daysInMonth: daysInMonth(s.month),
    calendar: calendarView(s)[s.month - 1] as CalendarView,
    account: s.account,
    bill: s.bill.amount,
    billName: s.bill.name,
    daysLeft: daysLeftInMonth(s),
    mood: s.mood,
    weather: WEATHER_LABEL[s.mood],
    items: s.items.map(itemView),
    slots: s.slots.length,
    buysLeft: s.today.buysLeft,
    persona: s.persona,
    personaName: personaById(s.persona).name,
    difficulty: s.difficulty,
    difficultyName: difficultyDef(s.difficulty).name,
    daily: s.setup?.daily ?? null,
    notice: s.notice ? { ...s.notice } : null,
    busy: isBusy(s),
    live: topBarLive(s),
    expiring: s.expiring.map((x) => ({ ...x })),
    pending: s.pending.map((p) => ({ id: p.id, name: eventById(p.id).name, month: p.month, amount: p.amount })),
  };
}

export interface BillView {
  month: number;
  name: string;
  /** 本月要还的总额（含突发账单） */
  amount: number;
  /** 常规月供（amount − 突发账单合计） */
  base: number;
  /** 本月的突发账单明细（没有时为空数组） */
  extras: BillExtra[];
  daysLeft: number;
  account: number;
  /** 账户够不够还（按当前余额） */
  enough: boolean;
  /** 有信用卡兜底 */
  credit: boolean;
}

export function billView(s: Readonly<GameState>): BillView {
  const extras = s.bill.extras ?? [];
  return {
    month: s.bill.month,
    name: s.bill.name,
    amount: s.bill.amount,
    base: s.bill.amount - extras.reduce((t, x) => t + x.amount, 0),
    extras: extras.map((x) => ({ ...x })),
    daysLeft: daysLeftInMonth(s),
    account: s.account,
    enough: s.account >= s.bill.amount,
    credit: s.items.includes('credit'),
  };
}

export interface CalendarView {
  month: number;
  id: string;
  name: string;
  desc: string;
  days: number;
  current: boolean;
  past: boolean;
}

/** A 股日历：12 个月，固定、提前可见。 */
export function calendarView(s: Readonly<GameState>): CalendarView[] {
  return CALENDAR.map((c) => ({
    month: c.month,
    id: c.id,
    name: c.name,
    desc: s.real?.track && c.realDesc ? c.realDesc : c.desc,
    days: daysInMonth(c.month),
    current: c.month === s.month,
    past: c.month < s.month,
  }));
}

/** 当月日历事件。 */
export function currentCalendar(s: Readonly<GameState>): CalendarView {
  const c = calendarOf(Math.max(1, s.month));
  return { month: c.month, id: c.id, name: c.name, desc: s.real?.track && c.realDesc ? c.realDesc : c.desc, days: daysInMonth(c.month), current: true, past: false };
}

// ================================================================ 道具、奖励、事件

export interface ItemView {
  id: string;
  name: string;
  kind: ItemKind;
  kindLabel: string;
  rarity: Rarity;
  rarityLabel: string;
  /** 0.3.1：一行的分类，如"道具（常见）"（kindLabel 的打法 / 工具 / 人脉只建议放在提示里） */
  tag: string;
  desc: string;
  flavor: string;
  /** 0.5 卡片短版：大数字（可缺）+ 一行（≤14 字）；desc 留在悬停详情 */
  brief: { big?: string; line: string };
}

export function itemView(id: string): ItemView {
  const d = itemById(id);
  return {
    id,
    name: d.name,
    kind: d.kind,
    kindLabel: ITEM_KIND_LABEL[d.kind],
    rarity: d.rarity,
    rarityLabel: RARITY_LABEL[d.rarity],
    tag: `${REWARD_KIND_LABEL.item}（${RARITY_LABEL[d.rarity]}）`,
    desc: d.desc(),
    flavor: d.flavor,
    brief: ITEM_BRIEF[id]?.() ?? { line: d.name },
  };
}

export interface RewardView {
  index: number;
  kind: RewardKind;
  kindLabel: string;
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  rarityLabel: string;
  /** 0.3.1：一行的分类，如"道具（常见）""新群友（稀有）""股票（传奇）" */
  tag: string;
  /** 道具卡 */
  item: ItemView | null;
  /** 群友卡 */
  friend: FriendView | null;
  /** 股票卡（所在风口这个月一定会要火） */
  stock: StockCard | null;
  /** 0.5 卡片短版：大数字（可缺）+ 一行（≤14 字）；desc 留在悬停详情 */
  brief: { big?: string; line: string };
}

export function rewardView(s: Readonly<GameState>): RewardView[] {
  if (!s.reward) return [];
  return s.reward.cards.map((c, index) => {
    const base = {
      index,
      kind: c.kind,
      kindLabel: REWARD_KIND_LABEL[c.kind],
      id: c.id,
      rarity: c.rarity,
      rarityLabel: RARITY_LABEL[c.rarity],
      tag: `${REWARD_KIND_LABEL[c.kind]}（${RARITY_LABEL[c.rarity]}）`,
    };
    if (c.kind === 'item') {
      const item = itemView(c.id);
      return { ...base, name: item.name, desc: item.desc, item, friend: null, stock: null, brief: item.brief };
    }
    if (c.kind === 'friend') {
      const def = friendById(c.id);
      const topics = def.topics === 'random2' ? '随机两个风口' : Array.isArray(def.topics) ? (def.topics as readonly ThemeId[]).map((t) => themeById(t).name).join('、') : '';
      const cred = BALANCE.cred[c.id]?.[0] ?? 0.5;
      const friend = friendView(s, c.id);
      return {
        ...base,
        name: def.name,
        desc: `${def.title}，专聊${topics}，消息很准（大约 ${Math.round(cred * 100)}% 说对）`,
        item: null,
        friend,
        stock: null,
        brief: { big: `${Math.round(cred * 100)}%准`, line: `专聊${topics}` },
      };
    }
    const stock = stockCard(s, c.id);
    return {
      ...base,
      name: stock.name,
      desc: s.real?.track
        ? `${stock.themeName}风口的${stock.roleLabel}。内部消息说它下个月走势偏强（消息大多靠谱，但不是百分百），可以直接放进手里`
        : `${stock.themeName}风口的${stock.roleLabel}。它所在的风口这个月一定会"要火"，可以直接放进手里`,
      item: null,
      friend: null,
      stock,
      brief: { line: s.real?.track ? '内部消息：下个月偏强' : '它的风口这个月准火' },
    };
  });
}

export interface EventView {
  id: string;
  name: string;
  text: string;
  options: [string, string];
  /** 0.5 卡片短版：一行情景（≤20 字）、两个选项（≤8 字 + 大数字）；text / options 原句留在悬停详情 */
  brief: string;
  picks: [EventPick, EventPick];
}

export function eventView(s: Readonly<GameState>): EventView | null {
  if (!s.event) return null;
  const d = eventById(s.event.id);
  const options = d.options(s.event, s);
  const b = EVENT_BRIEF[d.id];
  return {
    id: d.id,
    name: d.name,
    text: d.text(s.event, s),
    options,
    brief: b ? b.brief(s.event, s) : d.name,
    picks: b ? b.picks(s.event, s) : [{ label: options[0] }, { label: options[1] }],
  };
}

/** 全部事件的名字（图鉴、调试用）。 */
export function eventNames(): { id: string; name: string }[] {
  return EVENTS.map((d) => ({ id: d.id, name: d.name }));
}

// ================================================================ 结束页

export interface RunSummary {
  /** 本局已经结束（won / lost）；没结束时档案不记 */
  ended: boolean;
  won: boolean;
  account: number;
  peakAccount: number;
  /** 撑到第几个月（通关为 12） */
  month: number;
  billsPaid: number;
  days: number;
  totalDays: number;
  buys: number;
  limitUpDays: number;
  maxBoards: number;
  chains: number;
  /** 最赚的一笔（含未卖出的持仓） */
  bestTrade: { stockId: string; name: string; ret: number } | null;
  title: string;
  /** 0.6.3 按打法给的评语：一个标签和一句话（结束页称号下面） */
  style: PlayStyle;
  /** 0.5.4：开局本钱、账户实际付掉的账单合计、炒股本身累计赚亏（旧存档没有后两项时为 null） */
  startAccount: number;
  billMoney: number | null;
  tradeMoney: number | null;
  /**
   * 0.5.4：其他进出（红包、事件、月度奖励、借款利息、被收走的罚款……），让 本钱 + 炒股 − 账单 + 其他 + 没还的借款 = 最后剩。
   * 按差额算，保证几个数加得起来；旧存档为 null。
   */
  otherMoney: number | null;
  /** 0.5.4：结束时还欠着银行的钱（中途出局时借来的钱还在账户里） */
  debtLeft: number;
  autoSold: Record<string, number>;
  /** 0.3.0：档案用 */
  seed: string;
  /** 去重用的唯一标识 */
  runId: string;
  persona: PersonaId;
  personaName: string;
  difficulty: number;
  difficultyName: string;
  /** 每日挑战的日期；不是每日挑战为 null */
  daily: string | null;
  /** 正常开局（不是调试设置）：只有这样的局计入档案 */
  ranked: boolean;
  /** 0.10.0 娱乐短局（打几个月、最后交首付）；完整一年、实盘、每日挑战为 false */
  short: boolean;
  /**
   * 0.6.0 实盘：打几个月、开局资产、当前资产（账户 − 借款）、结回倍数（万分之几）、档位和一份、按倍数结回多少；
   * clean 是正常从界面开的实盘局（图鉴照记）。娱乐局为 null
   */
  live: { months: number; start: number; assets: number; bp: number; tier: LiveTier | null; stake: number; value: number; clean: boolean; /** 0.11.0 杠杆（1 / 2 / 3）和是不是跌到清零线结束的 */ gear: number; margin: boolean } | null;
  /** 本局达成的成就 id（结束后才判定） */
  achievements: string[];
  /** 本局见过的东西（图鉴） */
  seen: SeenSets;
  /** 0.4 重做：这局用的真实行情段（图鉴"见过的行情段"）；合成行情为 null */
  segment: SeenSegment | null;
  /** 0.4 C：本局点亮的小知识 id；没有新机制的局为空 */
  knowledge: string[];
  /** 0.4 C：本局的重仓、押跌、抵押经历（几句大白话） */
  recap: string[];
}

/** 图鉴里记的一段行情。 */
export interface SeenSegment {
  /** 段 id（不透明的短哈希；0.4 开发期的旧档案里是"年-月-市况"，照样能显示） */
  id: string;
  regime: Regime;
  /** 游戏化标题（不透露年代和公司） */
  title: string;
  /** 最近一局的"这段日子"小故事（图鉴里可以重看）；旧档案没有 */
  story?: string[];
  /** 最近一局的结局吐槽 */
  verdict?: string;
}

function seenSegment(s: Readonly<GameState>): SeenSegment | null {
  const r = s.real;
  const story = storyView(s);
  if (!r || !story) return null;
  return { id: r.segId, regime: r.regime, title: story.title, story: story.lines, verdict: story.verdict };
}

/** 结束页称号：爆仓按撑到的月份，通关按最终账户。 */
/**
 * 称号。通关的按"炒股本身赚了几倍本钱"评（0.5.4，试玩反馈：10 万剩 4.38 万也叫"惊险上岸"看不懂）：
 * 12 个月账单合计比本钱还多，通关时剩的钱普遍只有一两万，剩多少不说明打得好不好；炒股净赚才说明。
 * trade 缺省（旧存档）时退回按最后剩的钱评。
 */
export function titleFor(won: boolean, month: number, account: number, trade?: { money: number; start: number }): string {
  if (!won) return month <= 3 ? '新韭菜' : month <= 8 ? '老韭菜' : '差一点上岸的韭菜';
  if (trade && trade.start > 0) {
    // 只看炒股本身：剩多少钱受本钱和账单影响（自定义开局本钱可以很大），不算数。
    // 分档按机器人实测（真实行情各 120 局通关局的 炒股净赚/本钱）：smart 中位 0.5（p10 0.21、p90 1.5），oracle 中位约 4
    const x = trade.money / trade.start;
    if (x >= 3) return '百万韭菜王';
    if (x >= 1.2) return '大户新秀';
    if (x >= 0.3) return '上岸散户';
    return '惊险上岸';
  }
  if (account >= 1_000_000) return '百万韭菜王';
  if (account >= 300_000) return '大户新秀';
  if (account >= 100_000) return '上岸散户';
  return '惊险上岸';
}

export interface PlayStyle {
  id: string;
  tag: string;
  line: string;
}

/**
 * 0.6.3 按这一局的打法给评语：从最有特点的往下看，第一个对上的就是。只看本局统计，不看输赢（输赢在称号里）。
 * 文案只调侃打法，不调侃人；破产也不挖苦。
 */
export function playStyle(s: Readonly<GameState>): PlayStyle {
  const st = s.stats;
  const log = s.ext?.log;
  const days = Math.max(1, st.days);
  const recBuys = st.trades.filter((t) => t.recBy !== null).length;
  const followRate = st.trades.length > 0 ? recBuys / st.trades.length : 0;
  const style = (id: string, tag: string, line: string): PlayStyle => ({ id, tag, line });
  // 开局自带持仓（自定义开局）也算动过：有交易就不是观望
  if (st.buys === 0 && st.trades.length === 0 && s.slots.every((h) => !h)) return style('zen', '观望大师', '一整局手都没伸出去，看了个热闹，账单倒是一个没落。');
  if (log && log.borrowed.length > 0 && log.seized.length > 0) return style('allin_bank', '押上全部家当', '把东西押给银行借钱炒股，还真被收走过。下回让它们在家待着吧。');
  if (log && log.shorts >= 5) return style('bear', '反着来的人', `押跌 ${log.shorts} 回，别人追涨你看跌，群里都怕你开口。`);
  if (st.maxBoards >= 5) return style('rider', '连涨骑手', `骑着一只连涨 ${st.maxBoards} 天的小人，风大的时候也没被甩下来。`);
  if (st.activeDays / days >= 0.75 && st.buys >= 30) return style('busy', '手速选手', '几乎天天有进有出，手续费都认识你了。');
  if (followRate >= 0.7 && st.trades.length >= 8) return style('follower', '群聊信徒', '买的大半是群友推荐的，群里一说话你就动手。');
  if (st.maxSameTheme >= 3) return style('one_theme', '一根筋', '认准一个风口一次拿好几只，要么吃饱，要么一起饿。');
  if (st.creditUsed >= 2) return style('card', '信用卡战士', `月底钱不够，信用卡垫了 ${st.creditUsed} 回，硬是撑着打下去。`);
  if (st.limitUpDays >= 10) return style('limitup', '涨停收藏家', `持仓里出过 ${st.limitUpDays} 天涨停，看到满屏红色就开心。`);
  if (st.maxThemes >= 4) return style('spread', '雨露均沾', '几个风口都放一点，哪边起风都有份。');
  if (st.buys <= 6) return style('patient', '慢工细活', '一局只出手寥寥几次，买了就拿着，不急不躁。');
  return style('plain', '普通上班族', '该买买、该卖卖，跟群里大多数人差不多，也挺好。');
}

export function runSummary(s: Readonly<GameState>): RunSummary {
  const won = s.phase === 'won';
  const startAccount = s.setup?.account ?? personaAccount(s.persona);
  const debtLeft = s.ext ? debtOf(s) : 0;
  let best: RunSummary['bestTrade'] = null;
  const consider = (stockId: string, ret: number): void => {
    if (!best || ret > best.ret) best = { stockId, name: stockById(stockId).name, ret };
  };
  for (const t of s.stats.trades) consider(t.stockId, t.ret);
  for (const h of s.slots) if (h) consider(h.stockId, Math.round((h.value - 1) * 10000) / 100);
  const autoSold: Record<string, number> = {};
  for (const t of s.stats.trades) {
    if (t.reason === 'stop' || t.reason === 'take' || t.reason === 'delist') {
      const k = AUTO_SELL_LABEL[t.reason];
      autoSold[k] = (autoSold[k] ?? 0) + 1;
    }
  }
  return {
    ended: won || s.phase === 'lost',
    won,
    account: s.account,
    peakAccount: s.stats.peakAccount,
    month: s.month,
    billsPaid: s.stats.billsPaid,
    days: s.stats.days,
    totalDays: totalDays(),
    buys: s.stats.buys,
    limitUpDays: s.stats.limitUpDays,
    maxBoards: s.stats.maxBoards,
    chains: s.stats.chains,
    bestTrade: best,
    style: playStyle(s),
    title: titleFor(won, s.month, s.account, s.stats.tradeMoney === undefined ? undefined : { money: s.stats.tradeMoney, start: startAccount }),
    startAccount,
    billMoney: s.stats.billMoney ?? null,
    tradeMoney: s.stats.tradeMoney ?? null,
    otherMoney: s.stats.tradeMoney === undefined || s.stats.billMoney === undefined ? null : round2(s.account - startAccount - s.stats.tradeMoney + s.stats.billMoney - debtLeft),
    debtLeft,
    autoSold,
    seed: s.seed,
    runId: runId(s),
    persona: s.persona,
    personaName: personaById(s.persona).name,
    difficulty: s.difficulty,
    difficultyName: difficultyDef(s.difficulty).name,
    daily: s.setup?.daily ?? null,
    ranked: isRankedSetup(s.setup),
    short: !!s.setup?.short,
    live: s.setup?.live
      ? {
          months: s.setup.live.months,
          start: liveStart(s),
          assets: liveAssets(s),
          bp: liveMultipleBp(s),
          tier: liveTierOf(s)?.id ?? null,
          stake: liveTierOf(s)?.stake ?? 0,
          value: liveValue(s) ?? 0,
          clean: isCleanLiveSetup(s.setup),
          gear: s.setup.live.gear?.x ?? 1,
          margin: s.endReason === 'margin',
        }
      : null,
    achievements: achievementsOf(s),
    seen: seenOf(s),
    segment: seenSegment(s),
    knowledge: [...(s.ext?.learned ?? [])],
    recap: extRecap(s),
  };
}

/** 题材名（画面常用）。 */
export function themeName(id: ThemeId): string {
  return themeById(id).name;
}

// ================================================================ 0.5.1 开局前的真实历史（只读）

/** 开局前 warm 天的公开历史：大盘涨跌、个股涨跌（pp，旧 → 新）、风口热度（旧 → 新，最后一项是开局时的热度）。 */
export interface PreHistory {
  /** 天数（= 行情段的 warm）；第 k 项是第 k - days 个交易日 */
  days: number;
  market: number[];
  stocks: Record<string, number[]>;
  heat: Partial<Record<ThemeId, number[]>>;
}

const preCache = new WeakMap<object, PreHistory>();

/** 合成行情补的开局前天数（画面最多看 20 天）。 */
const SYNTH_PRE_DAYS = 20;

/**
 * 画面用：行情段里开局前 warm 天（开局之前，已经发生）的走势，按和交易日一样的放大、涨跌停截断算。
 * 只读这一段开局前的数据，不碰第 0 个交易日以后。0.4 旧档（不照搬个股）只给大盘和风口。
 * 合成行情（离线兜底）没有行情段，见 syntheticPreHistory。
 */
export function preHistory(s: Readonly<GameState>): PreHistory | null {
  const real = s.real;
  if (!real) return syntheticPreHistory(s);
  if (real.warm <= 0) return null;
  const hit = preCache.get(real);
  if (hit) return hit;
  const n = real.warm;
  const market: number[] = [];
  for (let i = 0; i < n; i++) market.push(Math.round(trackMarketRet(real, i) * 100) / 100);
  const stocks: Record<string, number[]> = {};
  if (isTrack(real)) {
    const rules = rulesOf(s);
    for (const id of Object.keys(s.stocks)) {
      if (!real.stocks[id]) continue;
      const def = stockById(id);
      const limit = BALANCE.roles[def.role].limit * rules.limitMult;
      const up = Math.round(limit * rules.limitUpMult * 100) / 100;
      const row: number[] = [];
      for (let i = 0; i < n; i++) {
        const raw = BALANCE.track.amp * realStockPct(real, id, i);
        row.push(Math.round(Math.min(up, Math.max(-limit, raw)) * 100) / 100);
      }
      stocks[id] = row;
    }
  }
  const heat: Partial<Record<ThemeId, number[]>> = {};
  for (const id of s.themeIds) heat[id] = warmHeatSeries(real, id);
  const out = { days: n, market, stocks, heat };
  preCache.set(real, out);
  return out;
}

const synthCache = new Map<string, PreHistory>();

/**
 * 合成行情的开局前走势：重放开局前的风口预跑（和开局时同一串随机数，热度接得上开局状态），
 * 大盘和个股按合成行情的公式另用 'pre*' 随机流补出来。只是给第 1 天的走势图垫底，
 * 不进 state、不消耗对局里的任何随机流，回放结果不变。
 */
function syntheticPreHistory(s: Readonly<GameState>): PreHistory | null {
  const key = `${s.seed}|${s.themeIds.join(',')}|${Object.keys(s.stocks).join(',')}`;
  const hit = synthCache.get(key);
  if (hit) return hit;
  const n = Math.min(SYNTH_PRE_DAYS, BALANCE.warmupDays);
  const at = (d: number): number => d + n;
  const themeRet: Partial<Record<ThemeId, number[]>> = {};
  const heat: Partial<Record<ThemeId, number[]>> = {};
  for (const id of s.themeIds) {
    const rets: number[] = new Array(n).fill(0);
    const heats: number[] = [];
    warmUpTheme(s.seed, id, (d, ret, h) => {
      if (at(d) < 0) return;
      rets[at(d)] = ret;
      heats.push(h);
    });
    themeRet[id] = rets;
    heat[id] = heats;
  }
  const mr = baseMarketRules();
  // 开局时的大盘情绪（和 engine 开局同一个随机流；不用 s.mood，读档时它已经变了）
  const mood = MOODS[rngFor(s.seed, 'mood0').int(MOODS.length)] ?? 'flat';
  const market: number[] = [];
  for (let d = -n; d < 0; d++) market.push(marketReturn(mood, mr, rngFor(s.seed, 'preMarket', d)));
  const rules = rulesOf(s);
  const stocks: Record<string, number[]> = {};
  for (const id of Object.keys(s.stocks)) {
    const def = stockById(id);
    const p = BALANCE.roles[def.role];
    const limit = p.limit * rules.limitMult;
    const up = Math.round(limit * rules.limitUpMult * 100) / 100;
    const tr = themeRet[def.theme];
    const row: number[] = [];
    for (let d = -n; d < 0; d++) {
      const z = rngFor(s.seed, 'preStock', id, d).normal();
      const x = p.beta * (tr?.[at(d)] ?? 0) + p.market * (market[at(d)] ?? 0) + p.noise * z;
      row.push(Math.round(Math.min(up, Math.max(-limit, x)) * 100) / 100);
    }
    stocks[id] = row;
  }
  const out = { days: n, market, stocks, heat };
  synthCache.set(key, out);
  return out;
}
