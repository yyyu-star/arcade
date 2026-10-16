/**
 * 内容钩子：道具、日历、事件、难度都是数据 + 几个可选钩子，引擎在固定的时点调用。
 * 规则表（Rules / MarketRules）只有几行，每个道具只改其中一格。
 */
import type { Rng } from './rng.ts';
import type {
  AchievementIcon,
  AchievementTier,
  AutoSellReason,
  CollateralId,
  EventState,
  GameState,
  Holding,
  ItemKind,
  PersonaId,
  Rarity,
  Role,
  Stage,
  StockDef,
  StockMove,
  ThemeId,
  TradeLog,
} from './types.ts';

/** 玩家这边的规则表：基础值经难度、道具依次修改。 */
export interface Rules {
  /** 持仓格数 */
  slots: number;
  /** 每天能买几只 */
  buysPerDay: number;
  /** 账户日收益倍数（两融账户：赚亏都 ×1.3） */
  leverage: number;
  /** 持仓股票的连板动量倍数 */
  momentumMult: number;
  /** 持仓股票的炸板率倍数 */
  blowMult: number;
  /** 题材看板显示真实阶段 */
  revealStages: boolean;
  /** 群友可信度覆盖，键为群友 id（老王的小本本） */
  credOverride: Record<string, number>;
  /** 可信度整体加减（难度用） */
  credDelta: number;
  /** 消息失真：群聊消息里瞎传的比例（可信度 c 变成 c × (1 − msgNoise) + msgNoise / 3；推荐不受影响） */
  msgNoise: number;
  /** 靠谱群友在拐点上的可信度加成（BALANCE.chat.turnCred）的倍数（难度"消息失真"为 0） */
  turnCredMult: number;
  /** 某个群友的可信度加减，键为群友 id（人设用） */
  credBonus: Record<string, number>;
  /** 某个群友说话、推荐的权重倍数，键为群友 id（人设用：群主更爱找游资大佬喊单） */
  friendWeight: Record<string, number>;
  /** 常规月供倍数（难度、人设、众筹炒股） */
  billMult: number;
  /** 突发账单倍数（难度、人设） */
  surpriseMult: number;
  /** 每天买入次数的上限（人设"程序员小码"为 1，不受手快影响）；null 为不限 */
  buysCap: number | null;
  /** 月度奖励给几张卡 */
  rewardCards: number;
  /** 事件里的坏结果倍数（花费、损失、坏结果概率） */
  eventBadMult: number;
  /** 群友每天多推荐几只（FOMO 体质） */
  extraRecs: number;
  /** 群聊每天多几条消息（小道消息） */
  extraMessages: number;
  /** 取消 T+1：当天买的当天能卖（FOMO 体质） */
  noT1: boolean;
  /** 群主的消息按反方向读（反着信群主） */
  reverseQunzhu: boolean;
  /** 每天收盘后揭示一个题材的真实阶段（熬夜复盘） */
  reviewOne: boolean;
  /** 0.4 C：能押跌（押跌许可证、人设、难度） */
  canShort: boolean;
  /** 0.4 C：被轧时亏损的倍数（墨镜让它小一点） */
  squeezeMult: number;
  /** 0.4 C：借款利息倍数（银行熟人） */
  interestMult: number;
  /** 0.4 C：加仓不占当天的买入次数（金字塔） */
  freeAdd: boolean;
  /** 0.5（真实行情）：每次买入的手续费（pp，按这一笔的金额算） */
  buyFee: number;
  /** 0.5（真实行情）：涨跌停宽度倍数（所有股票；月度主题"涨跌停放宽"） */
  limitMult: number;
  /** 0.5（真实行情）：涨停那一头再乘的倍数（强监管：涨停收窄、跌停不变） */
  limitUpMult: number;
  /** 0.5：本月只能买这些角色（考试月只能买老实股）；null = 不限 */
  onlyRoles: Role[] | null;
  /** 0.5：群友推荐时某些角色的权重倍数（妖股月） */
  recRoleBoost: Partial<Record<Role, number>>;
  /** 0.5（真实行情）：每天额外的重磅情报条数（准确率 BALANCE.intel.headline） */
  headlines: number;
  /** 0.5：连击小奖励的倍数 */
  comboMult: number;
}

/** 市场这边的规则表：每天按当月日历和难度修改。 */
export interface MarketRules {
  /** 大盘每天额外转为牛 / 熊的概率 */
  bullBias: number;
  bearBias: number;
  /** 大盘当日涨幅加成（pp） */
  marketAdd: number;
  /** 冷门题材每天额外进入萌芽的概率 */
  sprout: number;
  /** 指定题材每天额外进入萌芽的概率（叠加在 sprout 上） */
  sproutTheme: Partial<Record<ThemeId, number>>;
  /** 指定题材每天热度额外变化 */
  themeDH: Partial<Record<ThemeId, number>>;
  /** 退潮期 ΔH 倍数（退潮更快） */
  ebbMult: number;
  /** 角色题材系数倍数 */
  beta: Partial<Record<Role, number>>;
  /** 角色噪声倍数 */
  noise: Partial<Record<Role, number>>;
  /** 全体噪声倍数（年底排名） */
  vol: number;
  /** 妖股跳空向下的概率（默认 0.5） */
  memeDown: number;
  /** ST 退市警告概率倍数 */
  stWarnMult: number;
  /** 全体股票的炸板率倍数（强监管） */
  blowMult: number;
  /** 萌芽假启动、发酵证伪的概率倍数（震荡） */
  failMult: number;
  /** 题材每天热度变化额外的来回拉扯（均匀 ±dHNoise，震荡） */
  dHNoise: number;
}

// ================================================================ 道具

export interface HoldingCtx {
  readonly state: Readonly<GameState>;
  readonly slot: number;
  readonly holding: Readonly<Holding>;
  readonly stock: StockDef;
  readonly move: Readonly<StockMove>;
  /** 隐藏：题材今天的真实阶段（道具逻辑可用，画面不显示） */
  readonly stage: Stage;
  /** 今天买入（T+1：今天不能卖，止损单也不例外） */
  readonly boughtToday: boolean;
  /** 今天有持仓龙头涨停的题材 */
  readonly leaderUp: ReadonlySet<ThemeId>;
  /** 这一格当前的收益（pp），钩子直接修改 */
  ret: number;
  /** 设为非空表示收盘后自动卖出 */
  sell: AutoSellReason | null;
  /** 记录一次道具触发（画面闪图标、写明改动） */
  trigger(text: string): void;
}

export interface AccountCtx {
  readonly state: Readonly<GameState>;
  /** 账户加减（元），会记一次道具触发 */
  addAccount(amount: number, text: string): void;
}

export interface GainCtx {
  readonly state: Readonly<GameState>;
  addFriend(id: string): void;
}

/** 账户这一层的结算（分散投资）：ret 是两融之后的账户收益（pp），钩子直接修改。 */
export interface AccountRetCtx {
  readonly state: Readonly<GameState>;
  /** 结算时持仓覆盖的不同题材数 */
  readonly themes: number;
  ret: number;
  trigger(text: string): void;
}

/** 月底（最后一个交易日收盘后、还月供前）：给某一格持仓加收益（pp），账户按这一格的权重同步增加。 */
export interface MonthEndCtx {
  readonly state: Readonly<GameState>;
  addToHolding(slot: number, pct: number, text: string): void;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  /** 规则说明（数值从 BALANCE.fx 取） */
  desc(): string;
  /** 一句俏皮话 */
  flavor: string;
  /** 改规则表的一格 */
  rules?(r: Rules): void;
  /** 结算一格持仓：修改收益（按道具获得顺序调用） */
  onHolding?(ctx: HoldingCtx): void;
  /** 结算一格持仓：所有修改之后，决定是否自动卖出 */
  onExit?(ctx: HoldingCtx): void;
  onMonthStart?(ctx: AccountCtx): void;
  /** 账户日收益（两融之后）的修正 */
  onAccount?(ctx: AccountRetCtx): void;
  /** 月底还月供之前 */
  onMonthEnd?(ctx: MonthEndCtx): void;
  /** 获得时（付费群：内幕哥加群） */
  onGain?(ctx: GainCtx): void;
  /** 有这个道具时不再提供这些群友卡 */
  excludesFriend?: string;
  /** 0.4 C 新道具：只在有新机制的局（state.ext）里出现 */
  ext?: boolean;
}

// ================================================================ 日历、事件、难度

export interface CalendarDef {
  id: string;
  month: number;
  name: string;
  desc: string;
  market?(r: MarketRules): void;
  /** 0.5：真实行情下的说法（日历改走势的那部分在真实行情下不生效） */
  realDesc?: string;
}

export interface EventCtx {
  readonly state: Readonly<GameState>;
  readonly event: Readonly<EventState>;
  readonly rng: Rng;
  /** 坏结果倍数（第 8 级 >1）：addAccount 的负数已自动乘上，概率类的坏结果由事件自己用它放大 */
  readonly badMult: number;
  /** 账户加减（元）；负数自动 × badMult（exact 为 true 时不乘，例如借出去的本金）。返回实际变化 */
  addAccount(amount: number, exact?: boolean): number;
  /** 获得道具；untilMonth 给出时为临时道具，到那个月月底失效 */
  gainItem(id: string, untilMonth?: number): void;
  /** 把股票放进第 slot 格（原来的持仓卖出） */
  placeStock(stockId: string, slot: number): void;
  boostTheme(theme: ThemeId, dH: number, days: number): void;
  /** 下个月常规月供再乘 mult（大于 1 的部分 × badMult） */
  scaleNextBill(mult: number): void;
  /** 记一笔延后结算：month 月月初按事件的 settle 结算 */
  addPending(amount: number, month: number): void;
  /** 下一个交易日没空看盘（不能买卖） */
  skipNextDay(): void;
  /** 0.4 C：押东西借钱（利息 × rateMult，不受"开盘前"限制）；借不了返回 false */
  takeLoan(id: CollateralId, rateMult: number): boolean;
  /** 0.4 C：改一笔借款的月利息 */
  setLoanRate(id: CollateralId, rate: number): void;
}

export interface EventPrepCtx {
  readonly state: Readonly<GameState>;
  readonly rng: Rng;
  /** 刚还完月供的月份 */
  readonly month: number;
}

export interface EventDef {
  id: string;
  name: string;
  /** 事件正文（按准备好的数据填空） */
  text(e: Readonly<EventState>, s: Readonly<GameState>): string;
  /** 两个选项的文字 */
  options(e: Readonly<EventState>, s: Readonly<GameState>): [string, string];
  /** 能否出现；返回 null 表示不出现，否则返回事件数据 */
  prepare(ctx: EventPrepCtx): Omit<EventState, 'id' | 'month'> | null;
  /** 执行选项，返回结果文字 */
  resolve(ctx: EventCtx, option: number): string;
  /** 有延后结算（PendingEffect）时，到期那个月月初结算：返回账户变化（元，正负都行）和文案 */
  settle?(ctx: PendingCtx, amount: number): { delta: number; text: string };
}

export interface PendingCtx {
  readonly state: Readonly<GameState>;
  readonly rng: Rng;
  readonly badMult: number;
}

/** 难度（市场环境）：1..8 级，高等级包含低等级的全部约束。 */
export interface DifficultyDef {
  id: string;
  name: string;
  level: number;
  /** 这一级新增的约束：一句体感，不带数字 */
  desc: string;
  /** 具体数字（可选，画面悬停时显示） */
  detail?: string;
  rules?(r: Rules): void;
  market?(r: MarketRules, month: number): void;
  /** 0.5：真实行情（个股照搬真实走势）下这一级改成的规则（market 那些改走势的参数在真实行情下不生效） */
  realRules?(r: Rules, short: boolean): void;
  /** 0.5：真实行情下的 detail（缺省用 detail） */
  realDetail?: string;
  realDesc?: string;
  /** 0.5 去文字化：选难度时常驻的一句短话（≤12 字）；长说明仍是 desc / detail（悬停） */
  short?: string;
  /** 0.5：真实行情下的短话（缺省用 short） */
  realShort?: string;
  /** 0.10.0 适合谁（选难度时那一行；高手之后的几级没有） */
  who?: string;
}

/** 人设（0.3.0）。数值在 BALANCE.fx[id]。 */
export interface PersonaDef {
  id: PersonaId;
  name: string;
  /** 身份 */
  title: string;
  /** 开局条件（一句话，从数值生成） */
  desc(): string;
  flavor: string;
  /** 0.5 去文字化：选人设时常驻的一句短话（≤12 字）；长说明仍是 desc / flavor（悬停） */
  short?: string;
  /** 开局自带的道具 */
  items: readonly string[];
  /** 必定登场的题材 */
  themes: readonly ThemeId[];
  /** 开局可选；或者由某个成就解锁（成就 id） */
  unlock: 'start' | { achievement: string };
  /** 不会出现在奖励里的道具（对这个人设没用） */
  bannedItems?: readonly string[];
  rules?(r: Rules): void;
}

/** 成就判定的上下文：只在一局结束（won / lost）后判定。 */
export interface AchievementCtx {
  readonly state: Readonly<GameState>;
  readonly won: boolean;
  /** 全部交易：已了结的 + 结束时还拿着的（reason 为 'end'） */
  readonly trades: readonly TradeLog[];
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  tier: AchievementTier;
  icon: AchievementIcon;
  /** 达成后解锁的人设 */
  unlocks?: PersonaId;
  /** 0.6.4 隐藏结局：没达成前图鉴里只显示"？？？"，达成时结束页单独亮出来 */
  hidden?: boolean;
  /**
   * 0.6.8 计数型成就的进度 [这局做到多少, 要多少]（结束页"下次可以试试"用；只看这局，不跨局累计）。
   * 只给"一个数到了就算"的成就写；还要通关、要带某些道具的不写。
   */
  progress?(ctx: AchievementCtx): readonly [number, number];
  check(ctx: AchievementCtx): boolean;
}
