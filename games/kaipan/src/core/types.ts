/**
 * 《开盘》0.3 规则层的数据结构。
 *
 * 单位约定：
 * - 涨跌幅、收益一律用「百分点」（pp）：5.2 表示 +5.2%。
 * - 账户、月供用元（保留 2 位小数）。
 * - 热度 0..100。
 *
 * 标了「隐藏」的字段是画面不能显示的信息（题材真实阶段、今天预先掷好的行情等），
 * 详见 docs/core-api.md。
 */
import type { LiveTier } from './liveTiers.ts';
import type { RealMarket } from './segment.ts';

export type ThemeId = 'ai' | 'newenergy' | 'consumer' | 'pharma' | 'finance' | 'lowalt' | 'gaming' | 'pig';
/** 题材生命周期的真实阶段（隐藏）：冷门、萌芽、发酵、主升、高潮、退潮。 */
export type Stage = 'cold' | 'sprout' | 'ferment' | 'rally' | 'climax' | 'ebb';
/** 体感标签（公开，只由热度和走势算出）：冷门、升温、火热、过热、降温。 */
export type Feel = 'cold' | 'warming' | 'hot' | 'overheated' | 'cooling';
/** 股票角色：龙头、跟风、白马、妖股、ST。 */
export type Role = 'leader' | 'follower' | 'bluechip' | 'meme' | 'st';
/** 大盘：牛、平、熊（画面用窗外天气表示）。 */
export type Mood = 'bull' | 'flat' | 'bear';
/** 群聊消息说的方向：涨、横、跌。 */
export type Dir = 'up' | 'flat' | 'down';
/**
 * 消息用了哪种"拐点"说法（0.3 第二轮新增）：start 要起飞了、top 差不多到顶了、ebb 该跑了。
 * 只由消息的方向和公开的体感决定（说的方向和眼下走势相反时用拐点说法），不泄露真实阶段。
 */
export type TurnTalk = 'start' | 'top' | 'ebb';
export type Rarity = 'common' | 'uncommon' | 'rare';
/** 道具分类：战法、工具、人脉。 */
export type ItemKind = 'tactic' | 'tool' | 'network';
/** premarket：盘前（买卖、开盘）；reward：月度三选一；event：事件二选一；won/lost：本局结束。 */
export type Phase = 'premarket' | 'reward' | 'event' | 'won' | 'lost';
/** bankrupt：账单交不上；margin（0.11.0）：实盘加了杠杆，资产跌破爆仓线被强制平仓 */
export type EndReason = 'bankrupt' | 'margin';
/** 人设（0.3.0）：开局可选 newbie / retiree / mom，coder、youzi 由成就解锁。 */
export type PersonaId = 'newbie' | 'retiree' | 'mom' | 'coder' | 'youzi';
/** 成就档位：铜（轻松）、银（需要构筑）、金（硬核）。 */
export type AchievementTier = 'bronze' | 'silver' | 'gold';
/** 成就图标（美术按这 16 个出图）。 */
export type AchievementIcon =
  | 'chart_up'
  | 'chart_down'
  | 'fire'
  | 'ice'
  | 'rocket'
  | 'crown'
  | 'bill'
  | 'cat'
  | 'chat'
  | 'megaphone'
  | 'shield'
  | 'skull'
  | 'star'
  | 'clover'
  | 'coin'
  | 'trophy';
export type RewardKind = 'item' | 'friend' | 'stock';
/** 股票小人的表情（查询函数按当日涨跌给出）。 */
export type Face = 'calm' | 'happy' | 'limitup' | 'worried' | 'limitdown' | 'delisted';
/** 持仓被自动卖出的原因：止损单、止盈单、退市。 */
export type AutoSellReason = 'stop' | 'take' | 'delist';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** 一句话性格（公开） */
  desc: string;
}

export interface StockDef {
  id: string;
  name: string;
  theme: ThemeId;
  role: Role;
}

/** 群友擅长的题材：固定列表、全部、当前最热、入群时随机两个。 */
export type FriendTopics = readonly ThemeId[] | 'all' | 'hottest' | 'random2';

export interface FriendDef {
  id: string;
  name: string;
  /** 身份（大学生、退休教师……） */
  title: string;
  topics: FriendTopics;
  /** 推荐股票时也偏向妖股（老赵） */
  memes?: boolean;
  /** 一句话性格（公开） */
  desc: string;
  /** 开局就在群里 */
  founding: boolean;
}

// ================================================================ 状态

export interface ThemeState {
  id: ThemeId;
  /** 热度 0..100（公开） */
  heat: number;
  /** 最近几天的收盘热度，旧 → 新，最后一项等于 heat（公开） */
  history: number[];
  /** 隐藏：今天的真实阶段（盘前已推进到今天） */
  stage: Stage;
  /** 上一个交易日的真实阶段（情绪指标显示这个；没有情绪指标时隐藏） */
  lastStage: Stage;
  /** 隐藏：当前阶段还剩几天（含今天） */
  left: number;
  /** 隐藏：这一轮萌芽不会夭折（稀有股票奖励拉起的萌芽） */
  sure: boolean;
  /** 0.4 重做（真实行情）：当前阶段已经持续了几天（含今天）；合成行情不用 */
  age?: number;
  /** 隐藏：股灾里被打下来的题材：这一轮退潮之后冷门很短，接着的萌芽不会夭折（报复性反弹） */
  rebound?: boolean;
  /** 大V直播间跟单：接下来 days 天热度额外 +dH（玩家自己选的，公开） */
  boost: { dH: number; days: number } | null;
}

export interface StockState {
  id: string;
  /** 展示用价格（元） */
  price: number;
  /** 上一个交易日的涨跌（pp） */
  move: number;
  /** 连板数（公开） */
  boards: number;
  /** 最近 5 天的涨跌（pp），旧 → 新 */
  history: number[];
  /** ST：已收到的退市警告次数（公开） */
  warnings: number;
  /** ST：摘帽后还要连续涨停几天（公开） */
  uncap: number;
  /** 已退市：不再被推荐，也不能持有 */
  delisted: boolean;
}

export interface Holding {
  stockId: string;
  /** 买入的交易日；dayIndex > boughtDay 时才能卖（T+1） */
  boughtDay: number;
  /** 买入以来的净值倍数（1 = 不赚不亏） */
  value: number;
  /** 上一个交易日这一格的收益（pp，含道具修正）；刚买入还没开盘为 null */
  todayRet: number | null;
  /** 低吸：买入时题材体感是冷门或降温（低吸大师用） */
  lowBuy: boolean;
  /** 买入时的体感 */
  buyFeel: Feel;
  /** 隐藏：买入当天题材的真实阶段（复盘与模拟用） */
  buyStage: Stage;
  /** 从哪来：推荐、奖励、事件、开局设置 */
  source: 'rec' | 'reward' | 'event' | 'setup';
  /** 推荐人（群友 id；行情软件为空串）；不是买推荐来的为 null */
  recBy: string | null;
  /** 当天第一只买入的（游资席位用） */
  firstBuy: boolean;
  /** 买入当天群主在唱空这个题材（反向大师用，公开） */
  contra: boolean;
  /** 隐藏：持有期间题材进入过退潮（站岗专业户用，结束页才判定） */
  sawEbb: boolean;
  /**
   * 0.4 C 仓位：这一格占几份钱（1 份 = 账户的 1/4；缺省 1，也就是 0.3 的一格）。
   * 试一口 1 份、半仓 2 份、重仓 = 剩下的全部现金；加仓 +1 份，减一半砍掉一半。
   */
  units?: number;
  /** 0.4 C 押跌：它跌你赚、它涨你亏（缺省 false） */
  short?: boolean;
  /** 0.4 C：押跌期间它连续涨停了几天（嘴硬王用） */
  squeezed?: number;
}

/** 0.4 C 买入时选的仓位：试一口、半仓、重仓。 */
export type BuySize = 'taste' | 'half' | 'heavy';
/** 0.4 C 抵押物。 */
export type CollateralId = 'bracelet' | 'car' | 'house' | 'pension';

/** 0.4 C 一笔抵押借款。 */
export interface Loan {
  id: CollateralId;
  /** 借了多少（元） */
  amount: number;
  /** 每月利息（比例，0.02 = 2%） */
  rate: number;
  /** 哪个月借的 */
  month: number;
}

/** 0.4 C 本局的仓位、押跌、抵押经历（结局故事、成就、图鉴用）。 */
export interface ExtLog {
  /** 重仓买入次数 */
  heavy: number;
  /** 最重的一次（份）和那只股票 */
  maxUnits: number;
  maxStock: string | null;
  adds: number;
  trims: number;
  /** 押跌开仓次数 */
  shorts: number;
  /** 押跌累计赚亏（元） */
  shortPnl: number;
  /** 押跌最赚的一只（元） */
  shortBest: { stockId: string; amount: number } | null;
  /** 被轧（押跌的股票涨停）次数 */
  squeezes: number;
  /** 押跌时同一只连续涨停最多几天还没认输 */
  stubborn: number;
  /** 借过的抵押物（按顺序，不重复） */
  borrowed: CollateralId[];
  /** 银行打过几次电话 */
  calls: number;
  /** 被收走的抵押物 */
  seized: CollateralId[];
  /** 自己赎回来的抵押物 */
  redeemed: CollateralId[];
  /** 付过的利息（元） */
  interest: number;
}

/** 0.4 C 新机制的状态；缺省（0.3 存档、replay-030、合成行情回放）时新机制全部不出现。 */
export interface ExtState {
  loans: Loan[];
  /** 银行正在打电话（账户跌破警戒线） */
  called: boolean;
  /** 本局第一次触发的小知识（按顺序） */
  learned: string[];
  log: ExtLog;
}

export interface Message {
  friendId: string;
  theme: ThemeId;
  /** 说的是今天该题材热度的变化方向 */
  claim: Dir;
  text: string;
  /** 用了拐点说法时给出（可选，画面可以据此换气泡样式） */
  turn?: TurnTalk;
  /** 反着信群主（道具）：这条是群主说的，对你来说按反方向读（公开） */
  reverse?: boolean;
  /**
   * 0.5（真实行情）：说的是接下来几个交易日（含今天，1–3）这个风口的累计涨跌方向；缺省 1。
   * days > 1 的消息不在当天揭晓，到第 days 天收盘时在 report.intel 里揭晓。
   */
  days?: number;
  /** 0.5：重磅情报（月度主题制造的高光、"提前看一天"），画面可以加大气泡 */
  big?: boolean;
}

export interface Rec {
  stockId: string;
  /** 推荐人；关闭群聊（模拟用）时为空串，表示行情软件推荐 */
  friendId: string;
  text: string;
  /** 今天已经买过这条推荐 */
  taken: boolean;
  /** 0.4 C：唱空的群友建议押它跌 */
  short?: boolean;
  /** 0.5（真实行情）：推荐人说的是接下来几个交易日（含今天）会涨（押跌推荐是会跌）；缺省 1 */
  days?: number;
  /** 0.5：重磅推荐（月度主题制造的高光） */
  big?: boolean;
}

/** 隐藏：今天开盘前就掷好的行情（开盘时按它结算，群聊消息按它的方向生成）。 */
export interface DayPlan {
  mood: Mood;
  /** 大盘当日涨幅（pp） */
  marketRet: number;
  /** 各题材今天的热度变化（未截断到 0..100） */
  dH: Partial<Record<ThemeId, number>>;
  /**
   * 0.4 重做（真实行情）：其中来自真实行情的部分（大盘涨跌 pp、各题材热度变化）；其余是日历、难度、道具、事件的加成。
   * 合成行情没有这一项。
   */
  base?: { market: number; dH: Partial<Record<ThemeId, number>> };
}

export interface TodayState {
  /** 全局交易日编号（0 起） */
  day: number;
  messages: Message[];
  recs: Rec[];
  /** 今天还能买几只 */
  buysLeft: number;
  /** 今天已经买卖了几次 */
  ops: number;
  /** 今天已经买了几只 */
  buys: number;
  /** 隐藏 */
  plan: DayPlan;
  /**
   * 0.5：盘前是不是"平淡日"（没有重磅情报、没有新群友的消息要看、不是月初、没有传闻）——画面可以自动快进。
   * 收盘后另看 report.tempo.quiet。
   */
  quiet?: boolean;
}

export interface FriendState {
  id: string;
  /** 本局说中次数 */
  hits: number;
  /** 本局发过的（已揭晓的）题材消息数 */
  total: number;
  /** 实际擅长的题材（内幕哥入群时随机两个；大V为空，表示当前最热） */
  topics: ThemeId[];
}

/** 突发账单（0.3 第二轮新增）：某个月月初和月供一起公布。 */
export interface BillExtra {
  /** 内容 id（美术按 id 出图） */
  id: string;
  name: string;
  amount: number;
}

export interface BillState {
  month: number;
  name: string;
  /** 本月要还的总额（含突发账单） */
  amount: number;
  /** 本月的突发账单明细（没有时缺省或为空）；常规月供 = amount − Σ extras.amount */
  extras?: BillExtra[];
}

export interface RewardCard {
  kind: RewardKind;
  /** 道具 id、群友 id 或股票 id */
  id: string;
  rarity: Rarity;
}

export interface RewardState {
  month: number;
  cards: RewardCard[];
}

export interface EventState {
  id: string;
  /** 刚还完月供的月份 */
  month: number;
  /** 表哥荐股：那只妖股 */
  stockId?: string;
  /** 表哥荐股：买入会放进的格子（空格优先，否则换掉持有收益最低的一只） */
  slot?: number;
  /** 大V直播间：推荐的题材 */
  theme?: ThemeId;
  /** 年会抽奖、年终奖：金额（元）；群主卖课、买彩票、盲盒、借钱、摆摊、理财：花费或本金（元） */
  amount?: number;
  /** 0.4 C：银行经理、丈母娘：说的是哪件抵押物 */
  collateral?: CollateralId;
}

/** 事件留下的延后结算（0.3.0）：某个月月初到账或扣款。玩家自己选的，公开；结果在到账时才掷。 */
export interface PendingEffect {
  /** 来源事件 id */
  id: string;
  /** 哪个月月初结算 */
  month: number;
  /** 本金或费用（元） */
  amount: number;
}

/** 熬夜复盘（道具）：上一个交易日收盘后揭示的一个题材的真实阶段（公开，只在第二天盘前有效）。 */
export interface ThemeReview {
  theme: ThemeId;
  stage: Stage;
  /** 揭示的是哪个交易日（收盘时的阶段） */
  day: number;
}

/** 市场传闻（第 6 级"股灾"）：月初公布，本月某个交易日起所有题材提前退潮。 */
export interface MarketNotice {
  id: 'crash';
  month: number;
  name: string;
  text: string;
}

// ================================================================ 结算明细

export interface ThemeMove {
  id: ThemeId;
  heatBefore: number;
  heat: number;
  /** 实际热度变化（截断到 0..100 之后） */
  dH: number;
  /** 题材当日涨幅（pp） */
  ret: number;
  feelBefore: Feel;
  feel: Feel;
  /** 隐藏：当天的真实阶段 */
  stage: Stage;
}

export interface StockMove {
  id: string;
  /** 当日涨跌（pp，含龙头带动，已按涨跌停截断） */
  move: number;
  limitUp: boolean;
  limitDown: boolean;
  /** 收盘后的连板数 */
  boards: number;
  /** 炸板 */
  blown: boolean;
  /** 妖股跳空（pp），没有为 0 */
  jump: number;
  /** 龙头涨停带来的跟涨（pp），没有为 0 */
  chain: number;
  /** ST：今天摘帽 / 收到退市警告 / 退市 */
  st: 'uncap' | 'warning' | 'delisted' | null;
  /** 0.5（真实行情）：识别出的妖股异动（过山车股单日暴涨暴跌）；真实行情下 jump 恒为 0 */
  wild?: boolean;
  /** 0.5（真实行情）：大哥涨停、这只小弟也跟着大涨（识别出来的，不额外加涨幅；chain 恒为 0） */
  follow?: boolean;
}

/** 结算明细里一格持仓的收益拆解。 */
export interface HoldingStep {
  /** 'move' 个股涨跌，或道具 id */
  source: string;
  label: string;
  /** 这一步之后这格的收益（pp） */
  value: number;
}

/**
 * 0.3.1 归因：一只持仓当天涨跌的一项来源（pp）。各项之和等于 HoldingMove.ret（误差 ≤ 0.01）。
 * 只用当天已经揭晓的数（风口热度变化、大环境、个股消息等），不含真实阶段。
 * - theme：风口热度变化带来的涨跌（风口本身的涨跌，附 theme、dH）
 * - role：角色放大（带头大哥、过山车更猛，老实股、危险股更钝；可正可负）
 * - market：今天大环境
 * - momentum：连续涨停的惯性
 * - chain：大哥涨停带小弟
 * - jump：过山车突然跳空
 * - news：个股消息（危险股摘帽、退市）
 * - blown：涨停没封住，被砸下来
 * - limit：涨跌停截断（一天最多涨 / 跌 10%，危险股 5%）
 * - item：道具（附 itemId）
 * - noise：随机波动（余项，含四舍五入）
 */
export type RetPartKind = 'theme' | 'role' | 'market' | 'momentum' | 'chain' | 'jump' | 'news' | 'blown' | 'limit' | 'item' | 'noise' | 'short' | 'squeeze';

export interface RetPart {
  kind: RetPartKind;
  /** 这一项的涨跌（pp，两位小数） */
  value: number;
  /** 大白话说明，如"AI 风口热度 +15" */
  label: string;
  theme?: ThemeId;
  /** theme：这个风口当天的热度变化 */
  dH?: number;
  /** item：道具 id */
  itemId?: string;
}

/** 0.3.1：账户层的效果（不属于某一格持仓），金额为元。 */
export interface AccountEffect {
  /** 'leverage'（借钱炒股的放大）或道具 id（如分散投资） */
  source: string;
  label: string;
  /** 元，两位小数 */
  amount: number;
}

/** 0.3.1 收盘新闻：只解释已经发生的热度变化。theme 为 null 是全场性的新闻。 */
export interface NewsItem {
  theme: ThemeId | null;
  dir: 'up' | 'down';
  /** 风口新闻为当天热度变化；全场新闻为今天大环境的涨跌（pp） */
  value: number;
  text: string;
  /**
   * 0.5（真实行情）：预告类新闻——说的是这个风口接下来 ahead 个交易日（从明天起）的方向，dir 是新闻的说法，
   * 按 BALANCE.intel.news 的概率说中（说错时反着说）。value 为 0。
   */
  ahead?: number;
}

/** 0.3.1 股票小人台词的时机。 */
export type QuipMoment = 'limitUp' | 'limitDown' | 'streak' | 'delisted' | 'bought' | 'sold';

export interface StockQuip {
  stockId: string;
  /** 持仓格；收盘时被自动卖出的、已经不在持仓里的也给原来的格 */
  slot: number | null;
  moment: QuipMoment;
  text: string;
}

export interface HoldingMove {
  slot: number;
  stockId: string;
  /** 个股当日涨跌（pp） */
  move: number;
  /** 这一格最终收益（pp，含道具修正） */
  ret: number;
  /** 0.3.1：ret 的归因，各项之和等于 ret（顺序固定，见 RetPartKind） */
  parts: RetPart[];
  /** 0.3.1：影响最大的一项（|value| 最大），画面挑"主要原因"用；0.3.0 的旧存档里为 null */
  lead: RetPart | null;
  /** 0.3.1：这一格今天给账户带来的盈亏（元，不含账户层效果）；所有格加上 account.effects 等于账户当天的变化 */
  amount: number;
  steps: HoldingStep[];
  /** 结算后的持有收益（pp） */
  holdRet: number;
  /** 收盘后被自动卖出 */
  sold: AutoSellReason | null;
  /** 0.4 C：这一格占几份（缺省 1） */
  units?: number;
  /** 0.4 C：押跌 */
  short?: boolean;
  /** 0.4 C：押跌的股票涨停了（被轧） */
  squeeze?: boolean;
}

export interface ChainLink {
  /** 涨停的龙头 */
  leader: string;
  /** 被带动的同题材跟风股 */
  followers: string[];
  /** 其中在持仓里的 */
  held: string[];
  /** 龙头本身在持仓里 */
  leaderHeld: boolean;
}

export interface ItemTrigger {
  itemId: string;
  slot: number | null;
  stockId: string | null;
  text: string;
  /** 这一下改动的数值（pp；账户类为元） */
  delta: number;
}

export interface MessageJudge {
  /** 当天消息的下标；隔天揭晓的（report.intel）是发出那天的下标 */
  index: number;
  /** 0.5：发出那天（隔天揭晓的才有） */
  day?: number;
  /** 0.5：说的天数（缺省 1） */
  days?: number;
  friendId: string;
  theme: ThemeId;
  claim: Dir;
  truth: Dir;
  hit: boolean;
}

export interface Comment {
  friendId: string;
  text: string;
  /** 得意 / 尴尬 / 普通（对应头像表情） */
  mood: 'smug' | 'awkward' | 'normal';
}

/** 一天的结算明细，按设计稿第 5 节的播放顺序组织。 */
export interface DayReport {
  day: number;
  month: number;
  /** 本月第几天（0 起） */
  dayInMonth: number;
  market: { moodBefore: Mood; mood: Mood; ret: number };
  themes: ThemeMove[];
  /** 当天所有在场股票的涨跌 */
  stocks: StockMove[];
  holdings: HoldingMove[];
  chains: ChainLink[];
  triggers: ItemTrigger[];
  account: {
    before: number;
    /** 各格加权收益之和（pp，两融之前） */
    gross: number;
    /** 最终账户收益（pp） */
    ret: number;
    after: number;
    /** 0.3.1：账户层效果（借钱炒股、分散投资等），金额为元 */
    effects: AccountEffect[];
  };
  autoSold: { slot: number; stockId: string; reason: AutoSellReason }[];
  messages: MessageJudge[];
  comments: Comment[];
  /** 持仓里有涨停（放烟花） */
  fireworks: boolean;
  /** 持仓里有跌停（下雨云） */
  rain: boolean;
  /** 今天股灾来了（第 6 级：所有题材提前退潮的那天，收盘后才揭晓） */
  crash: boolean;
  /** 0.3.1：收盘新闻（热度变化最大的 1–2 个风口，以及全场大涨 / 大跌） */
  news: NewsItem[];
  /** 0.5：今天揭晓的、前几天发的多日消息（说的是 2–3 天的累计方向） */
  intel?: MessageJudge[];
  /** 0.5：节奏与反馈（月度目标进度、高光、连击、平淡日）；没有月度主题的局没有这一项 */
  tempo?: DayTempo;
  /** 0.3.1：持仓股票小人的台词（涨停、连续涨停、跌停、退市、被自动卖出） */
  quips: StockQuip[];
  /** 0.4 C：银行这一天的动作（打电话、收走抵押物）；没有为缺省 */
  bank?: { called: boolean; seized: CollateralId[] };
}

// ================================================================ 统计

/** 一笔已了结的交易（结束页复盘与模拟用；stage 是隐藏信息）。 */
export interface TradeLog {
  stockId: string;
  buyDay: number;
  sellDay: number;
  /** 隐藏：买入当天题材的真实阶段 */
  stage: Stage;
  /** 买入时的体感 */
  feel: Feel;
  /** 持有收益（pp） */
  ret: number;
  reason: 'sell' | 'replace' | AutoSellReason | 'end';
  /** 推荐人（不是买推荐来的为 null） */
  recBy: string | null;
  /** 买入当天群主在唱空这个题材 */
  contra: boolean;
  /** 隐藏：高潮期买入，并一直拿到了退潮 */
  guard: boolean;
  /** 0.4 C：押跌的一笔（ret 已经按押跌算：它跌你赚） */
  short?: boolean;
  /** 0.4 C：了结时占几份 */
  units?: number;
}

export interface RunStats {
  /** 已结算的交易日 */
  days: number;
  buys: number;
  sells: number;
  /** 有买或卖的交易日数 */
  activeDays: number;
  /** 持仓里有涨停的交易日数 */
  limitUpDays: number;
  /** 持仓股票达到过的最高连板 */
  maxBoards: number;
  /** 持仓触发龙头带动的次数 */
  chains: number;
  peakAccount: number;
  billsPaid: number;
  /** 0.5.4：账户实际付掉的账单合计（信用卡垫的不算；旧存档没有） */
  billMoney?: number;
  /** 0.5.4：炒股本身累计赚亏（每天收盘结算的账户变化之和，不含账单、利息、奖励、银行；旧存档没有） */
  tradeMoney?: number;
  trades: TradeLog[];
  /** 选过的奖励 id */
  picked: string[];
  events: string[];
  /** 持仓里有跌停的交易日数 */
  limitDownDays: number;
  /** 单日账户最大涨幅（pp） */
  maxDayRet: number;
  /** 还过（或信用卡代还过）的突发账单 id */
  surprisesPaid: string[];
  /** 信用卡代还的次数 */
  creditUsed: number;
  /** 结算时持仓同时覆盖的最多题材数 */
  maxThemes: number;
  /** 结算时同一题材的最多持仓只数 */
  maxSameTheme: number;
  /** 每个月交易日的账户涨跌（pp，月初效果之后、还月供之前） */
  monthRets: number[];
  /** 本月月初（月初效果之后）的账户，用来算 monthRets */
  monthOpen: number;
  /** 股灾那个月的账户涨跌（pp）；没有股灾为 null */
  crashRet: number | null;
  /** 进过持仓的股票（任何来源，按顺序，不重复） */
  acquired: string[];
  /** 开局之后拿到的道具（奖励、事件；人设自带的不算） */
  itemsTaken: string[];
  /** 见过的道具（持有过或出现在奖励卡上，图鉴用） */
  seenItems: string[];
  /** 见过的群友（入群或出现在奖励卡上，图鉴用） */
  seenFriends: string[];
}

// ================================================================ 局面

/**
 * 开局设置。正常开局只用 persona / difficulty / daily（缺省为 newbie、第 1 级）；
 * 其余字段只给调试、测试、模拟用，带了这些字段的局不计入档案（见 isRankedSetup）。
 */
export interface RunSetup {
  /** 人设（缺省 newbie） */
  persona?: PersonaId;
  /** 每日挑战的日期 YYYY-MM-DD（由 dailySetup 给出） */
  daily?: string;
  /** 开局账户（元） */
  account?: number;
  /** 开局道具 */
  items?: string[];
  /** 开局额外群友 */
  friends?: string[];
  /** 指定登场题材（6 个） */
  themes?: ThemeId[];
  /** 开局持仓（股票 id） */
  holdings?: string[];
  /** 难度等级 1..8（缺省 1；0.3.0-alpha.1 的 0 按 1 处理） */
  difficulty?: number;
  /** 关闭群聊消息（模拟"消息有用"用；推荐照常） */
  noChat?: boolean;
  /** 0.6.0 实盘模式：打几个月、账单倍数（开局时从 BALANCE.live 抄进来，存档自带）；娱乐局没有 */
  live?: LiveRules;
  /** 0.10.0 娱乐短局：打几个月、账单倍数（开局时从 BALANCE.short 抄进来，存档自带）；完整一年的局、实盘、每日挑战没有 */
  short?: ShortRules;
}

/** 0.10.0 娱乐短局这一局的规则。 */
export interface ShortRules {
  months: number;
  billMult: number;
  /** 最后一个月月底多交一笔"首付"：开局资产的几成（短局的最终目标，按难度定） */
  goal: number;
}

/** 0.6.0 实盘这一局的规则。 */
export interface LiveRules {
  months: number;
  billMult: number;
  /** 0.10.0：资产涨跌算进筹码的倍数；更早开的局没有，按 1 算 */
  lev?: number;
  /** 0.10.0：档位；更早开的局没有，按难度认（那时一档一个难度） */
  tier?: LiveTier;
  /** 0.11.0：玩家选的杠杆（开局时从 BALANCE.live.gears 抄进来）；稳健 1× 和更早开的局没有 */
  gear?: LiveGear;
}

/** 0.11.0 实盘杠杆：结回再按 x 放大、封顶 cap 份，每月扣利息（让结回少 interest），放大后的结回倍数跌到清零线 call 就按 0 结。 */
export interface LiveGear {
  x: number;
  cap: number;
  interest: number;
  call: number;
}

export interface GameState {
  version: 4;
  seed: string;
  setup: RunSetup | null;
  /** 人设 */
  persona: PersonaId;
  /** 难度等级 1..8 */
  difficulty: number;
  phase: Phase;
  /** 账户余额（元）：唯一的分数和货币 */
  account: number;
  /** 当前月份 1..12 */
  month: number;
  /** 本月第几个交易日（0 起） */
  dayInMonth: number;
  /** 全局交易日编号（0 起）；也是已结算的交易日数 */
  dayIndex: number;
  /** 本局登场的题材（6 个，看板按这个顺序） */
  themeIds: ThemeId[];
  themes: Partial<Record<ThemeId, ThemeState>>;
  /** 在场股票的行情，键为股票 id */
  stocks: Record<string, StockState>;
  /** 大盘：上一个交易日的状态（公开，窗外天气） */
  mood: Mood;
  /** 持仓格；null 为空格（现金） */
  slots: (Holding | null)[];
  friends: FriendState[];
  /** 持有的道具 id（按获得顺序） */
  items: string[];
  bill: BillState;
  /** 下个月月供的倍数（信用卡代还后 1.2） */
  nextBillMult: number;
  today: TodayState;
  reward: RewardState | null;
  event: EventState | null;
  lastDay: DayReport | null;
  endReason: EndReason | null;
  /** 熬夜复盘：上一个交易日收盘后揭示的题材阶段（公开；review.day === dayIndex − 1 时有效） */
  review: ThemeReview | null;
  /** 本月的市场传闻（第 6 级股灾，月初公布，公开） */
  notice: MarketNotice | null;
  /** 事件留下的延后结算（公开） */
  pending: PendingEffect[];
  /** 临时道具：到 month 月底失效（量化软件试用） */
  expiring: { id: string; month: number }[];
  /** 这一个交易日（dayIndex）没空看盘，不能买卖（加班事件） */
  busyDay: number | null;
  stats: RunStats;
  /** 本局全部操作，配合 seed 与 setup 可完整回放 */
  actions: Action[];
  /**
   * 0.4 重做：这一局用的真实行情段（只含登场风口用到的部分，读档、回放不用再下载）。
   * null 或缺省 = 0.3 的合成行情（离线、数据加载失败时的兜底，也是 0.3 存档的样子）。
   */
  real?: RealMarket | null;
  /** 0.4 C：仓位、押跌、抵押（缺省 = 0.3 的玩法） */
  ext?: ExtState | null;
  /** 0.5：月度主题、中场、高光、连击（缺省 = 没有；真实行情开局默认打开） */
  tempo?: TempoState | null;
  /** 0.5：还没揭晓的多日消息（隐藏真相，只存说法） */
  watch?: WatchedIntel[];
}

/** 0.5：还没揭晓的多日消息。 */
export interface WatchedIntel {
  day: number;
  index: number;
  friendId: string;
  theme: ThemeId;
  claim: Dir;
  days: number;
}

/** 0.5：月度目标的种类（都能按局面判定）。 */
export type GoalKind =
  /** 本月账户涨 ≥ target%（月底还钱之前算） */
  | 'gain'
  /** 本月任何一天收盘账户都不低于月初的 (100 − target)% */
  | 'keep'
  /** 持仓涨停 target 次 */
  | 'limitUp'
  /** 押跌那格当天赚钱 target 次 */
  | 'shortWin'
  /** 连续 target 天收盘赚钱 */
  | 'streak'
  /** 某天收盘同时拿着 target 个不同风口的股票 */
  | 'themes'
  /** 本月收益比大盘本月涨跌多 ≥ target 个百分点 */
  | 'beat'
  /** 当天买、当天收盘就赚的次数 ≥ target */
  | 'quickWin'
  /** 持仓单日涨 ≥ target% 一次 */
  | 'bigDay';

export interface MonthReward {
  /** 现金（元） */
  cash: number;
  /** 道具碎片 */
  shards: number;
  /** boss 月：另给一个道具（月底领取时按种子挑，null = 没有） */
  item: boolean;
}

/** 0.5：本月主题和目标（公开）。 */
export interface MonthGoalState {
  month: number;
  /** 主题 id（src/core/content/monthThemes.ts） */
  id: string;
  boss: boolean;
  kind: GoalKind;
  target: number;
  /** 当前进度（gain / beat 为 pp，keep 为本月最大回撤 pp，其余为次数或天数） */
  progress: number;
  done: boolean;
  /** 保底类目标（keep）中途破线；或月底没达成 */
  failed: boolean;
  reward: MonthReward;
  /** 月初账户、本月大盘累计（pp） */
  open: number;
  market: number;
  /** 本月的高光次数（主题会在月末前一天补一个） */
  highlights: number;
}

export interface TempoState {
  /** 12 个月的主题 id（开局按种子、行情、难度抽好；画面只该显示已经到了的月份） */
  plan: string[];
  cur: MonthGoalState | null;
  /** 连续收盘赚钱的天数（有持仓才算） */
  streak: number;
  bestStreak: number;
  /** 道具碎片（集满 BALANCE.tempo.shards 换一个道具） */
  shards: number;
  /** 各月结果 */
  results: { month: number; id: string; done: boolean }[];
  /** 小奖励、月度奖励累计发的钱（元） */
  bonus: number;
}

/** 0.5：一次高光。 */
export interface Highlight {
  kind: 'limitUp' | 'limitDown' | 'bigWin' | 'bigLoss' | 'boards' | 'blown' | 'wild' | 'combo' | 'goal' | 'crash' | 'shortWin' | 'headline';
  text: string;
  stockId?: string;
}

/** 0.5：小奖励（连击、押对跌、抓到涨停）。 */
export interface ComboReward {
  kind: 'streak' | 'shortWin' | 'limitUp' | 'shards';
  /** 连续天数、次数 */
  count: number;
  cash: number;
  shards: number;
  /** 碎片集满换到的道具 */
  itemId?: string;
  text: string;
}

/** 0.5：收盘时的节奏信息。 */
export interface DayTempo {
  /** 平淡日：持仓波动小、账户几乎没动、没有事件、没有高光——画面可以快速翻过 */
  quiet: boolean;
  highlights: Highlight[];
  combos: ComboReward[];
  /** 本月目标（收盘后的进度） */
  goal: MonthGoalState | null;
  streak: number;
}

export type Action =
  /** 买入第 rec 条推荐；slot 为空格或要替换的持仓（缺省放进第一个空格） */
  | { type: 'buy'; rec: number; slot?: number; size?: BuySize; short?: boolean }
  /** 0.4 C：第 slot 格加仓 1 份（算一次买入） */
  | { type: 'add'; slot: number }
  /** 0.4 C：第 slot 格减掉一半（T+1 同卖出） */
  | { type: 'trim'; slot: number }
  /** 0.4 C：拿抵押物去银行借钱 */
  | { type: 'borrow'; id: CollateralId }
  /** 0.4 C：还钱赎回抵押物 */
  | { type: 'repay'; id: CollateralId }
  /** 卖出第 slot 格的持仓（当天买入的不能卖） */
  | { type: 'sell'; slot: number }
  /** 开盘：结算今天 */
  | { type: 'open' }
  /** 月度奖励：选第 index 张；股票卡要放进的格子 slot（缺省第一个空格） */
  | { type: 'pickReward'; index: number; slot?: number }
  /** 月度奖励：都不要 */
  | { type: 'skipReward' }
  /** 事件：选第 option 个选项（0 或 1） */
  | { type: 'choose'; option: number };

export type GameEvent =
  | { type: 'monthStarted'; month: number; days: number; bill: BillState; calendar: string }
  | { type: 'dayStarted'; day: number; month: number; dayInMonth: number }
  | { type: 'chat'; messages: Message[]; recs: Rec[] }
  | { type: 'bought'; rec: number; slot: number; stockId: string; replaced: string | null; units?: number; short?: boolean; cost?: number }
  | { type: 'added'; slot: number; stockId: string; units: number }
  | { type: 'trimmed'; slot: number; stockId: string; units: number; holdRet: number }
  | { type: 'borrowed'; loan: Loan; account: number }
  | { type: 'repaid'; loan: Loan; account: number }
  | { type: 'interestPaid'; amount: number; before: number; after: number }
  | { type: 'bankCalled'; account: number; debt: number }
  | { type: 'seized'; id: CollateralId; amount: number; penalty: number; before: number; after: number; /** 0.5.4：收之前的欠款、收东西的线（欠款 × seizeLine）、起因（当天亏的 / 月底付完账单） */ debt?: number; line?: number; cause?: 'trade' | 'bill' }
  | { type: 'squeezed'; slot: number; stockId: string; ret: number }
  | { type: 'learned'; id: string }
  | { type: 'sold'; slot: number; stockId: string; holdRet: number }
  | { type: 'opened'; day: number }
  | { type: 'marketMoved'; moodBefore: Mood; mood: Mood; ret: number }
  | ({ type: 'themeMoved' } & ThemeMove)
  | ({ type: 'stockMoved'; slot: number } & HoldingMove & { stock: StockMove })
  | ({ type: 'chain' } & ChainLink)
  | ({ type: 'itemTriggered' } & ItemTrigger)
  | { type: 'stockNews'; stockId: string; news: 'uncap' | 'warning' | 'delisted'; warnings: number; held: boolean }
  | { type: 'autoSold'; slot: number; stockId: string; reason: AutoSellReason; holdRet: number }
  | { type: 'accountChanged'; before: number; after: number; ret: number }
  | ({ type: 'messageJudged' } & MessageJudge)
  | ({ type: 'comment' } & Comment)
  | ({ type: 'news' } & NewsItem)
  | ({ type: 'quip' } & StockQuip)
  | { type: 'dayClosed'; report: DayReport }
  | { type: 'billPaid'; month: number; amount: number; before: number; after: number; credit: boolean }
  | { type: 'bankrupt'; month: number; amount: number; account: number }
  | { type: 'rewardOffered'; month: number; cards: RewardCard[] }
  | { type: 'rewardPicked'; card: RewardCard; slot: number | null; replaced: string | null }
  | { type: 'rewardSkipped' }
  | { type: 'friendJoined'; friendId: string; topics: ThemeId[] }
  | { type: 'eventStarted'; event: EventState }
  | { type: 'eventResolved'; id: string; option: number; text: string; delta: number }
  | { type: 'runWon'; account: number }
  | { type: 'marketNotice'; notice: MarketNotice }
  | { type: 'crashHit'; day: number; month: number }
  | ({ type: 'themeReviewed' } & ThemeReview)
  | { type: 'pendingSettled'; id: string; amount: number; delta: number; text: string }
  | { type: 'itemExpired'; itemId: string }
  | { type: 'runLost'; reason: EndReason; month: number; account: number; bill: number }
  /** 0.11.0 实盘杠杆爆仓：levered 是放大后的结回倍数（跌到了爆仓线） */
  | { type: 'gearWiped'; month: number; account: number; levered: number }
  /** 0.5：月初公布本月主题（"本月看点"卡），紧跟在 monthStarted 之后 */
  | { type: 'monthTheme'; goal: MonthGoalState; name: string; intro: string; rule: string; goalText: string; rewardText: string; roast: { friendId: string; text: string } }
  /** 0.5：月度目标进度变化 / 达成 / 失败 */
  | { type: 'goalProgress'; goal: MonthGoalState }
  | { type: 'goalDone'; goal: MonthGoalState; cash: number; shards: number; itemId: string | null }
  | { type: 'goalFailed'; goal: MonthGoalState }
  /** 0.5：高光时刻、连击 / 小奖励 */
  | ({ type: 'highlight' } & Highlight)
  | ({ type: 'combo' } & ComboReward)
  /** 0.5：从真实走势里识别出的连板（≥ 2）、炸板、妖股异动（只播报，不改涨跌） */
  | { type: 'spotted'; kind: 'boards' | 'blown' | 'wild'; stockId: string; move: number; boards: number; held: boolean }
  /** 0.5：多日消息揭晓 */
  | ({ type: 'intelJudged' } & MessageJudge);
