import type { Mood, Rarity, RewardKind, Role, Stage, ThemeId } from './types.ts';

/** 题材生命周期一个阶段的参数。 */
export interface StageParams {
  /** 持续天数 [最少, 最多]（按题材速度缩放前） */
  days: readonly [number, number];
  /** 每天热度变化 ΔH 的范围（按题材振幅缩放前） */
  dH: readonly [number, number];
  /** 失败岔路的概率：萌芽 → 冷门（假启动），发酵 → 退潮（证伪）；其余阶段为 0 */
  fail: number;
}

/** 题材性格：速度（阶段天数 ÷ speed）、振幅（ΔH × amp）、噪声（题材噪声 × noise）。 */
export interface ThemeParams {
  speed: number;
  amp: number;
  noise: number;
  /** 冷门阶段天数额外倍数（养猪：冷门很久） */
  coldMult: number;
  /** 萌芽假启动概率的倍数（低空经济：容易夭折） */
  failMult: number;
}

/** 股票角色参数。 */
export interface RoleParams {
  /** 题材系数 */
  beta: number;
  /** 大盘系数 */
  market: number;
  /** 个股噪声（标准差，pp） */
  noise: number;
  /** 涨跌停（pp） */
  limit: number;
  /** 妖股：每天跳空概率 */
  jumpProb: number;
  /** 妖股：跳空幅度范围（pp） */
  jump: readonly [number, number];
  /** 开局价格区间（元，展示用） */
  price: readonly [number, number];
}

export interface Balance {
  startAccount: number;
  /** 每月交易日（1..12 月） */
  monthDays: readonly number[];
  slots: number;
  buysPerDay: number;
  /** 每天推荐几只 */
  recs: number;
  /** 0.3.1 收盘新闻（只影响文案）：最多几个风口；第二条起热度变化至少多少；全场新闻要求大环境涨跌至少多少（pp） */
  news: { themes: number; minDH: number; market: number };
  /** 0.3.1 收盘吐槽（只影响文案）：账户当天涨跌超过多少算大赚 / 大亏（pp）；风口热度涨多少而你没持有算踩空 */
  talk: { bigWin: number; bigLoss: number; missDH: number };
  /** 每天群聊消息条数 [最少, 最多] */
  messages: readonly [number, number];
  /** 每局登场题材数 */
  activeThemes: number;
  /** 开局前预跑的天数（让各题材处在自然的阶段，并有近 5 日走势） */
  warmupDays: number;
  /** 热度走势保留天数 */
  historyDays: number;
  heat: {
    max: number;
    /** 题材当日涨幅 = coef × ΔH + 噪声（pp） */
    coef: number;
    /** 题材噪声半宽（pp，均匀分布） */
    noise: number;
    /** 消息方向的阈值：ΔH ≥ t 为涨，≤ −t 为跌，其余为横 */
    dirThreshold: number;
    /** 冷门期热度慢慢回落：每天额外 −round(coldPull × (热度 − coldBase))（热度高于 coldBase 时） */
    coldPull: number;
    coldBase: number;
  };
  stages: Record<Stage, StageParams>;
  themes: Record<ThemeId, ThemeParams>;
  market: {
    /** 大盘状态保持的概率 */
    persist: number;
    ret: Record<Mood, number>;
    /** 大盘噪声（标准差，pp） */
    noise: number;
  };
  roles: Record<Role, RoleParams>;
  boards: {
    /** 连板数 c 的第二天期望涨幅 +momentum × c（pp） */
    momentum: number;
    /** 炸板概率 = blow × c */
    blow: number;
    /** 炸板当天按此计（pp） */
    blowMove: number;
  };
  /** 龙头涨停时，同题材跟风股 +chain（pp） */
  chain: number;
  st: {
    /** 每天摘帽概率 */
    uncap: number;
    /** 摘帽后连续涨停天数 [最少, 最多] */
    uncapDays: readonly [number, number];
    /** 每天收到退市警告的概率 */
    warn: number;
    /** 几次警告退市 */
    warnings: number;
    /** 退市当天按此计（pp） */
    delistMove: number;
  };
  bills: {
    /** 月 m 的月供 = (base + step × (m−1)) × growth^(m−1)（取整到百元） */
    base: number;
    step: number;
    growth: number;
  };
  /**
   * 突发账单：一局 count 次，月初和月供一起公布。第 k 次落在 windows[k] 范围内的某个月
   * （窗口互不重叠，压力分散到全年）
   */
  surprise: {
    count: readonly [number, number];
    windows: readonly (readonly [number, number])[];
    /** 各名目的金额范围（元，取整到百元），键为内容 id */
    amounts: Record<string, readonly [number, number]>;
  };
  /** 消息可信度：擅长 / 其他，键为群友 id */
  cred: Record<string, readonly [number, number]>;
  chat: {
    /** 群友谈擅长题材的概率（其余随机挑一个题材） */
    focus: number;
    /** 挑题材时按 热度 + heatBias 加权（越热越多人聊） */
    heatBias: number;
    /** 说话的权重 */
    talk: Record<string, number>;
    /** 推荐的权重 */
    rec: Record<string, number>;
    /** 群友推荐时挑角色的权重 */
    roleWeights: Record<Role, number>;
    /** 行情软件（关闭群聊时）挑角色的权重 */
    screenerWeights: Record<Role, number>;
    /** 群主喊单时挑题材的权重（按题材真实阶段：他专挑高位出货） */
    shill: Record<Stage, number>;
    /** 群主喊单时妖股的权重倍数 */
    shillMeme: number;
    /** 群友推荐时真的去判断今天方向的概率（其余凭印象按热度挑，推荐不带今天的信息） */
    recInsight: number;
    /**
     * 拐点（隐藏）：题材今天刚启动（start）、刚进入高潮（top）、刚退潮（ebb）、萌芽夭折（fizzle）时，
     * 被聊到的权重倍数
     */
    turn: Record<'start' | 'top' | 'ebb' | 'fizzle', number>;
    /** 擅长题材今天是拐点的群友，说话权重的倍数 */
    turnSpeak: number;
    /** 靠谱的群友（擅长题材可信度 ≥ reliable）在拐点上对擅长题材的可信度加成 */
    turnCred: number;
    reliable: number;
    /** 开局群友里靠谱的（擅长题材可信度 ≥ reliable）聊擅长的题材时，消息可信度的加成（推荐不加） */
    expertMsg: number;
    /** 可信度上限（所有加成之后）：只有道具指定的可信度（credOverride，老王的小本本）能到 1，也就是"必中" */
    credMax: number;
    /**
     * 0.7.0 每局状态：每个群友这一局的可信度在 ±cred 里浮动、说话权重乘 1 ± talk（按种子均匀抽，均值不变）。
     * 同一个人这局可能比平时准、也可能更不靠谱，玩家得看本局战绩，不能背表
     */
    form: { cred: number; talk: number };
  };
  reward: {
    cards: number;
    kindWeights: Record<RewardKind, number>;
    rarityWeights: Record<Rarity, number>;
  };
  events: {
    /** 每月领完奖励后触发事件的概率 */
    chance: number;
  };
  /** 第 6 级"股灾"：一局里哪些月份可能出事（随机一个），以及出事的是那个月的第几个交易日（0 起，[最早, 最晚]） */
  crash: {
    months: readonly number[];
    day: readonly [number, number];
    /** 被股灾打下来的题材，退潮之后冷门只持续这么几天（报复性反弹） */
    rebound: readonly [number, number];
    /** 股灾当天退潮的热度下跌倍数 */
    plunge: number;
    /** 股灾那个月大盘每天额外直接转熊的概率 */
    bear: number;
    /** 股灾当天大盘额外跌多少（pp） */
    marketHit: number;
    /** 反弹的那一轮萌芽一定不会夭折 */
    sureRebound: boolean;
    /** 股灾那个月多一笔突发账单（爆仓的亲戚借钱），按当月常规月供的比例 */
    bill: number;
  };
  /** 道具、日历、事件、难度的效果数值，键为内容 id。描述文字从这里取数，改数值不用改文案 */
  fx: Record<string, Record<string, number>>;
  /** 0.4 重做：真实行情驱动（state.real 不为 null 时生效），见 docs/core-api-0.4-redo.md 第 3 节 */
  real: RealParams;
  /** 0.4 C：仓位、押跌、抵押（state.ext 不为 null 时生效），见 docs/core-api-0.4-redo.md 第 7 节 */
  ext: ExtParams;
  /** 0.5：个股照搬真实走势（state.real.track 为 true 时生效），见 docs/core-api-0.5.md */
  track: TrackParams;
  /** 0.5：情报从真实未来推算（真实行情 0.5 模式） */
  intel: IntelParams;
  /** 0.5：月度主题、中场、高光、连击（state.tempo 不为 null 时生效） */
  tempo: TempoParams;
  /** 0.6.0 实盘模式（docs/design-live.md）：开局时写进这局的设置（RunSetup.live），之后改这里不影响已经开了的局 */
  live: LiveParams;
  /** 0.10.0 娱乐短局（docs/design-balance.md）：开局时写进这局的设置（RunSetup.short） */
  short: {
    months: number;
    billMult: number;
    /** 最后一个月月底的"首付"占开局资产的比例，按难度 1..8（缺的按最后一个） */
    goal: readonly number[];
  };
}

/** 0.6.0 实盘模式的默认规则。 */
export interface LiveParams {
  /** 打几个月（从 1 月起） */
  months: number;
  /** 结回倍数的上限（economy.md：最多 3 倍） */
  cap: number;
  /**
   * 0.10.0 各档：billMult 是常规月供和突发账单的倍数（越往上生活费越高），
   * lev 是资产涨跌算进筹码的倍数（资产涨 10%、lev 3 → 结回多 30%）。一局只有几个月，资产的起伏本来就小，
   * 不放大的话会玩和不会玩的只差零点几成，赚也赚不到哪去（docs/design-live.md 第 3 节）。
   */
  tiers: Record<'small' | 'mid' | 'big' | 'lux', { billMult: number; lev: number; gearRate: number }>;
  /**
   * 0.11.0 玩家自己选的杠杆（稳健 1× / 进取 2× / 疯狂 3×）：结回再按 x 放大一次，封顶 cap 份；
   * interest 是每月的利息（按结回倍数算：每月让结回少这么多，和账单一起扣），call 是清零线（放大后的结回倍数跌到这里就强制结束、按 0 结）。
   */
  gears: readonly { x: number; cap: number; interest: number; call: number }[];
  /** 放大后的结回倍数离清零线不到这么多份时，顶栏的账户变红闪、提醒一句（只是画面，不影响规则） */
  warnGap: number;
}

/** 0.5：个股照搬真实走势。 */
export interface TrackParams {
  /** 统一的游戏放大系数：个股、风口（行业）、大盘当天涨跌 = amp × 真实涨跌（之后按涨跌停截断） */
  amp: number;
  /** 大盘天气：最近 moodDays 天放大后大盘平均 ≥ moodBull 为晴 */
  moodBull: number;
  /** 真实行情下每月要还的钱的倍数（个股照搬真实走势后，赚钱靠情报，节奏比合成行情慢） */
  billMult: number;
  /**
   * 按行情段市况再乘的月供倍数（牛市物价也涨）：个股照搬真实走势后，牛市、泡沫里拿着不动也会涨，
   * 用它让"牛市躺赢"不成立、熊市和崩盘也有通关路径。市况本身不公开（局末才揭晓）。
   */
  regimeBill: Record<'bull' | 'bear' | 'bubble' | 'crash' | 'flat', number>;
  /** 识别：前一天涨停、今天跌 ≤ blown（pp）算炸板 */
  blown: number;
  /** 识别：过山车股单日 |涨跌| ≥ wild（pp）算妖股异动 */
  wild: number;
  /** 识别：大哥涨停时同风口小弟涨 ≥ follow（pp）算跟涨 */
  follow: number;
}

/** 0.5：情报准确率（说中 = 说的方向等于接下来 days 天真实累计涨跌的方向）。 */
export interface IntelParams {
  /** 风口消息：累计涨跌（放大后，pp）在 ±flat[days−1] 以内算"横" */
  flat: readonly number[];
  /** 个股推荐：累计涨跌超过 ±stockFlat[days−1] 才算涨 / 跌 */
  stockFlat: readonly number[];
  /** 消息说几天（1、2、3）的权重 */
  days: readonly number[];
  /**
   * 群友的准确率 [聊擅长的风口, 聊别的]（真实行情 0.5 用这张表，合成行情仍用 BALANCE.cred，replay-030 不变）。
   * 消息再叠加 0.3 的加成和难度（开局靠谱群友聊擅长的 +expertMsg、拐点 +turnCred、消息失真、−diffStep × (难度 − 1)）。
   */
  cred: Record<string, readonly [number, number]>;
  /** 难度每高一级，所有群友的准确率 −diffStep（第 1 级不减） */
  diffStep: number;
  /** 群主说错时直接反着说的概率（其余随机挑另一个方向） */
  qunzhuFlip: number;
  /** 猫踩键盘：挑中接下来 2 天涨得最多的小弟的概率（其余随机） */
  cat: number;
  /** 新闻预告（"某风口有消息面利好"）说中的概率；每天最多 1 条 */
  news: number;
  /** 主题制造的重磅情报 / "提前看一天"的准确率 */
  headline: number;
}

/** 0.5：节奏与反馈。 */
export interface TempoParams {
  /** 中场 boss 的月份 */
  bossMonths: readonly number[];
  /** 月度目标奖励（按当月常规月供的比例）：普通月 cash、boss 月 bossCash */
  cash: number;
  bossCash: number;
  /** 难度每高一级，目标数值 × (1 + goalStep)（整数目标向上取整） */
  goalStep: number;
  /** 连续赚钱 streak 天起每天给 streakCash（按当月月供的比例）；押对跌、抓到涨停给 1 片碎片 */
  streak: number;
  streakCash: number;
  /** 集满 shards 片碎片换一个道具 */
  shards: number;
  /** 平淡日：持仓单日 |涨跌| < quietMove 且账户 |涨跌| < quietAcc（pp） */
  quietMove: number;
  quietAcc: number;
  /** 高光：持仓单日 |涨跌| ≥ bigMove，或账户 |涨跌| ≥ bigAcc（pp） */
  bigMove: number;
  bigAcc: number;
}

/** 0.4 C 的数值。 */
export interface ExtParams {
  /** 试一口、半仓的份数（1 份 = 账户的 1/4）；重仓 = 剩下的全部 */
  taste: number;
  half: number;
  /** 加仓一次加几份 */
  add: number;
  /** 最小一份 */
  minUnit: number;
  /** 一次买进超过 1 份时，多出来的每份让这一笔多花这么多（pp，按这一笔的金额算）：大单把价格自己抬高了 */
  impact: number;
  /** 押跌的股票涨停（被轧）时，亏损再乘这么多 */
  squeeze: number;
  /** 押跌顺风逆风：晴天（大环境好）押跌每天多亏这么多（pp），雨天多赚这么多 */
  shortWeather: number;
  /** 押跌每天的手续费（pp，借股票要给钱） */
  shortFee: number;
  /** 从第几个月起银行愿意借钱 */
  bankMonth: number;
  /** 借完之后账户至少是欠款的 borrowLine 倍才肯借；跌破 callLine 倍银行打电话；跌破 seizeLine 倍收走抵押物 */
  borrowLine: number;
  callLine: number;
  seizeLine: number;
  /** 被收走时另扣借款的这个比例（违约金） */
  penalty: number;
  /** 难度每高一级：借款额 +amountStep、利息 +rateStep（比例） */
  amountStep: number;
  rateStep: number;
  /** 抵押物：借多少（元）、每月利息、第几级难度起可以押 */
  collateral: Record<string, { amount: number; rate: number; level: number }>;
  /** 第几级难度起开局就能押跌 */
  shortLevel: number;
}

/** 真实行情怎么映射成 0.3 的风口、大盘和个股。 */
export interface RealParams {
  /** 大盘：游戏里的大盘涨跌 = ampMarket × 老三十当天的真实涨跌 */
  ampMarket: number;
  /** 个股相对行业那块：按这只股票这一段的平均幅度归一后乘 ownK × 0.3 的角色噪声（白马 0.6、妖股 4……） */
  ownK: number;
  /** 行业超额收益的均摊系数（1 = 不均摊；0.35 = 当天只体现 35%，其余摊到之后几天）：让风口有惯性，热度和群聊说法也跟着顺 */
  smooth: number;
  /** 风口涨跌：行业相对所有行业平均的超额收益（均摊后）按这一段的日波动归一后乘 themeK，再乘 0.3 的题材振幅（pp） */
  themeK: number;
  /** 行业一个"平常日子"的超额收益（相对大盘，按这一段的平均绝对值归一）带来的热度变化 */
  heatGain: number;
  /** 热度每天向 heatBase 回落的比例（没人炒的风口慢慢凉） */
  heatPull: number;
  heatBase: number;
  /** 大盘天气：最近 moodDays 天大盘涨跌（放大后，pp）的平均 ≥ moodBull 为晴，≤ −moodBull 为雨 */
  moodDays: number;
  moodBull: number;
  /** 风口阶段的判定（热度、当天热度变化） */
  stage: {
    /** 冷门 → 冒头：当天热度涨 ≥ sproutDH 且收盘热度 ≥ sproutHeat */
    sproutDH: number;
    sproutHeat: number;
    /** 冒头 → 发酵：热度 ≥ fermentHeat；冒头夭折：一天跌 ≥ fizzleDH，或冒头 sproutMax 天还没站上发酵线 */
    fermentHeat: number;
    fizzleDH: number;
    sproutMax: number;
    /** 发酵 → 主升：热度 ≥ rallyHeat 且还在涨；发酵证伪：一天跌 ≥ failDH，或发酵 fermentMax 天没进主升且当天不涨 */
    rallyHeat: number;
    failDH: number;
    fermentMax: number;
    /** 主升 → 高潮：热度 ≥ climaxHeat，或主升里第一次一天跌 ≥ topDH */
    climaxHeat: number;
    topDH: number;
    /** 高潮 → 退潮：一天跌 ≥ ebbDH，或高潮满 climaxMax 天 */
    ebbDH: number;
    climaxMax: number;
    /** 退潮 → 冷门：热度 ≤ coldHeat，或退潮满 ebbMin 天后止跌 */
    coldHeat: number;
    ebbMin: number;
  };
  /** 日历"更容易火"：冷门风口当天被点燃时的热度加成 */
  igniteDH: number;
  /** 稀有股票奖励（必不夭折的冒头）：之后几天每天的热度加成 */
  sure: { dH: number; days: number };
  /** 股灾当天还没退潮的风口额外的热度下跌；被打下来的风口回到冷门后的报复性反弹（热度加成 × 天数） */
  crashDH: number;
  rebound: { dH: number; days: number };
  /** 股灾对齐真实大跌日：股灾月份里大盘真实跌幅最大的那天跌了至少这么多（基点，负数）才对齐，否则按种子 */
  crashReal: number;
}

/** 所有可调数值集中在这里，用 `node tools/sim.ts` 验证（--set 可以临时覆盖）。 */
export const BALANCE: Balance = {
  ext: {
    taste: 1,
    half: 2,
    add: 1,
    minUnit: 0.5,
    impact: 1.2,
    squeeze: 1.5,
    shortFee: 0.3,
    shortWeather: 2,
    bankMonth: 2,
    borrowLine: 1.6,
    callLine: 1.45,
    seizeLine: 1.25,
    penalty: 0.2,
    amountStep: 0.1,
    rateStep: 0.1,
    collateral: {
      bracelet: { amount: 20_000, rate: 0.08, level: 1 },
      car: { amount: 50_000, rate: 0.1, level: 1 },
      house: { amount: 120_000, rate: 0.09, level: 3 },
      pension: { amount: 80_000, rate: 0.06, level: 5 },
    },
    shortLevel: 99,
  },
  startAccount: 100_000,
  monthDays: [5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5],
  slots: 4,
  buysPerDay: 1,
  recs: 3,
  news: { themes: 2, minDH: 5, market: 1.2 },
  talk: { bigWin: 4, bigLoss: -4, missDH: 12 },
  messages: [2, 4],
  activeThemes: 6,
  warmupDays: 40,
  historyDays: 6,
  heat: { max: 100, coef: 0.45, noise: 0.5, dirThreshold: 3, coldPull: 0.1, coldBase: 15 },
  stages: {
    cold: { days: [8, 22], dH: [-2, 2], fail: 0 },
    sprout: { days: [2, 4], dH: [3, 8], fail: 0.25 },
    ferment: { days: [2, 4], dH: [5, 12], fail: 0.2 },
    rally: { days: [2, 5], dH: [8, 18], fail: 0 },
    climax: { days: [1, 3], dH: [-5, 10], fail: 0 },
    ebb: { days: [3, 6], dH: [-25, -8], fail: 0 },
  },
  themes: {
    ai: { speed: 1.3, amp: 1.25, noise: 1.2, coldMult: 1, failMult: 1 },
    newenergy: { speed: 1, amp: 1.15, noise: 1, coldMult: 1, failMult: 1 },
    consumer: { speed: 0.9, amp: 0.9, noise: 0.8, coldMult: 1, failMult: 0.8 },
    pharma: { speed: 1, amp: 1, noise: 1, coldMult: 1, failMult: 1 },
    finance: { speed: 0.75, amp: 0.8, noise: 0.7, coldMult: 1, failMult: 1 },
    lowalt: { speed: 1.1, amp: 1.1, noise: 1.1, coldMult: 0.7, failMult: 1.8 },
    gaming: { speed: 1.1, amp: 1.3, noise: 1.3, coldMult: 1, failMult: 1 },
    pig: { speed: 1, amp: 1.35, noise: 1, coldMult: 1.8, failMult: 0.6 },
  },
  market: { persist: 0.9, ret: { bull: 0.5, flat: 0, bear: -0.5 }, noise: 0.4 },
  roles: {
    leader: { beta: 1.5, market: 1, noise: 1, limit: 10, jumpProb: 0, jump: [0, 0], price: [15, 60] },
    follower: { beta: 0.8, market: 1, noise: 1.5, limit: 10, jumpProb: 0, jump: [0, 0], price: [6, 25] },
    bluechip: { beta: 0.5, market: 0.8, noise: 0.6, limit: 10, jumpProb: 0, jump: [0, 0], price: [30, 120] },
    meme: { beta: 1, market: 1, noise: 4, limit: 10, jumpProb: 0.08, jump: [6, 10], price: [3, 15] },
    st: { beta: 0.3, market: 0.5, noise: 2, limit: 5, jumpProb: 0, jump: [0, 0], price: [1, 4] },
  },
  boards: { momentum: 1.5, blow: 0.1, blowMove: -6 },
  chain: 2,
  st: { uncap: 0.012, uncapDays: [2, 4], warn: 0.015, warnings: 2, delistMove: -90 },
  bills: { base: 9000, step: 0, growth: 1.105 },
  surprise: {
    count: [2, 3],
    windows: [
      [2, 4],
      [5, 8],
      [9, 10],
    ],
    amounts: {
      vet: [2000, 12000],
      toilet_phone: [800, 3200],
      wedding: [800, 4800],
      wealth_class: [12000, 40000],
      wisdom_tooth: [1200, 4000],
      scratch_car: [4000, 20000],
      milk_tea_laptop: [1200, 4800],
      quantum_mattress: [8000, 32000],
    },
  },
  cred: {
    xiaoli: [0.75, 0.5],
    laowang: [0.85, 0.55],
    zhangjie: [0.75, 0.5],
    qunzhu: [0.3, 0.3],
    laozhao: [0.8, 0.5],
    dav: [0.55, 0.55],
    neimu: [0.9, 0.9],
    zhuchang: [0.9, 0.9],
    kongjun: [0.55, 0.55],
  },
  chat: {
    focus: 0.7,
    heatBias: 20,
    talk: { xiaoli: 3, laowang: 1.5, zhangjie: 2.5, qunzhu: 3, laozhao: 1.5, dav: 2, neimu: 3, zhuchang: 2.5, kongjun: 2 },
    rec: { xiaoli: 3, laowang: 1.5, zhangjie: 2, qunzhu: 3, laozhao: 2, dav: 2, neimu: 2, zhuchang: 2, kongjun: 2 },
    roleWeights: { leader: 3.2, follower: 1, bluechip: 0.8, meme: 1.2, st: 0.2 },
    screenerWeights: { leader: 1, follower: 1, bluechip: 1, meme: 1, st: 0.5 },
    shill: { cold: 0.1, sprout: 0.1, ferment: 0.2, rally: 0.5, climax: 4, ebb: 10 },
    shillMeme: 3,
    recInsight: 1,
    turn: { start: 12, top: 8, ebb: 12, fizzle: 4 },
    turnSpeak: 5,
    turnCred: 0.2,
    reliable: 0.75,
    expertMsg: 0.15,
    credMax: 0.95,
    form: { cred: 0.05, talk: 0.25 },
  },
  reward: {
    cards: 3,
    kindWeights: { item: 7, friend: 1.5, stock: 1.5 },
    rarityWeights: { common: 6, uncommon: 3, rare: 1 },
  },
  events: { chance: 0.4 },
  crash: { months: [4, 5, 6, 7, 8, 9, 11], day: [1, 4], rebound: [3, 6], plunge: 2.5, bear: 0.3, marketHit: -4, sureRebound: false, bill: 0.25 },
  fx: {
    // ---- 道具：战法
    longtou: { bonus: 3 },
    genfeng: { mult: 2 },
    baima: { lossMult: 0.5 },
    yaogu: { limitUpAs: 15 },
    lianban: { momentumMult: 2, blowMult: 1.5, realBonus: 4, realBlow: 3 },
    dixi: { bonus: 2 },
    zhisun: { stop: -4 },
    zhiying: { take: 25, bonus: 3 },
    // ---- 道具：工具
    extra_slot: { slots: 1, share: 0.5 },
    double_buy: { buys: 1 },
    margin: { mult: 1.08 },
    sunglasses: { squeezeMult: 0.5 },
    banker: { interestMult: 0.5 },
    bank_manager: { rateMult: 0.7 },
    mother_in_law: { pct: 3, billMult: 1.1 },
    bear_live: { months: 2 },
    ipo: { pct: 1 },
    credit: { nextBillMult: 1.2 },
    // ---- 道具：人脉
    notebook: { cred: 1 },
    // ---- 道具：0.3.0 新增
    hot_money: { bonus: 3 },
    value_eye: { bonus: 2 },
    fan_qunzhu: { acc: 0.7 },
    diversify: { themes: 4, lossMult: 0.7 },
    fomo: { recs: 1 },
    night_review: {},
    crowd_fund: { billMult: 0.92 },
    rumor_mill: { messages: 1 },
    // ---- 人设（account 开局账户；*Cred 群友可信度加减；billMult 常规月供倍数）
    newbie: { account: 100_000 },
    retiree: { account: 80_000, laowangCred: 0.05, billMult: 0.78 },
    mom: { account: 94_000, zhangjieCred: 0.1, billMult: 1 },
    coder: { account: 97_000, buysCap: 1, billMult: 1 },
    youzi: { account: 300_000, billMult: 3.25, surpriseMult: 3, qunzhuCred: -0.1, qunzhuWeight: 2 },
    // ---- 难度（逐级叠加）
    slow_bull: {},
    choppy: { billMult: 1.03, failMult: 1, dHNoise: 8, realBill: 1.1, realNoise: 0.5 },
    bear_market: { bearBias: 0.18, fee: 0.6, realBill: 1.04 },
    fake_news: { cred: 0, noise: 0.8, turnCred: 0 },
    regulation: { blowMult: 2, stWarnMult: 2, limitUp: 0.7 },
    market_crash: {},
    inflation: { billMult: 1.05, surpriseMult: 1 },
    doom: { rewardCards: 2, badMult: 2, surpriseMult: 1.2 },
    // ---- 日历
    newyear: { bullBias: 0.3, marketAdd: 0.2 },
    spring: { sprout: 0.25 },
    policy_spring: { dH: 3, sprout: 0.25 },
    annual: { memeDown: 0.85, stWarnMult: 3, blueNoise: 0.5 },
    wuqiong: { bearBias: 0.3, marketAdd: -0.2 },
    liujue: { bearBias: 0.3, marketAdd: -0.2, ebbMult: 1.3 },
    qifanshen: { bullBias: 0.3, marketAdd: 0.2 },
    interim: { leaderBeta: 1.2, followerBeta: 0.6 },
    jinjiu: { dH: 3, sprout: 0.25 },
    guoqing: { vol: 0.8 },
    double11: { dH: 3, sprout: 0.25 },
    yearend: { vol: 1.3 },
    // ---- 事件
    cousin: { acc: 0.3 },
    livestream: { dH: 3, days: 3, realBonus: 6 },
    lottery_party: { min: 1, max: 5 },
    course: { cost: 5 },
    lottery: { cost: 1, chance: 0.05, prize: 20 },
    bonus: { pct: 3 },
    landlord: { billMult: 1.1, moveCost: 2.5 },
    classmate_loan: { pct: 5, interest: 10, forget: 0.25 },
    side_hustle: { pct: 2, min: 0.5, max: 2.2 },
    cat_keyboard: {},
    red_packet: { win: 0.6, min: 0.2, max: 1.2, lose: 0.5 },
    quant_trial: { renew: 1 },
    blind_box: { cost: 3 },
    fund_manager: { pct: 10, ret: 3 },
    overtime: { pct: 2 },
  },
  real: {
    ampMarket: 0.6,
    ownK: 0.8,
    smooth: 0.35,
    themeK: 11,
    heatGain: 12,
    heatPull: 0.2,
    heatBase: 20,
    moodDays: 3,
    moodBull: 0.4,
    stage: {
      sproutDH: 4,
      sproutHeat: 24,
      fermentHeat: 42,
      fizzleDH: 7,
      sproutMax: 5,
      rallyHeat: 60,
      failDH: 9,
      fermentMax: 5,
      climaxHeat: 88,
      topDH: 6,
      ebbDH: 6,
      climaxMax: 3,
      coldHeat: 26,
      ebbMin: 3,
    },
    igniteDH: 6,
    sure: { dH: 5, days: 4 },
    crashDH: -30,
    rebound: { dH: 6, days: 4 },
    crashReal: -150,
  },
  track: { amp: 2, billMult: 0.5, regimeBill: { bull: 1.1, bubble: 1.25, flat: 0.95, bear: 0.9, crash: 0.95 }, moodBull: 1, blown: -5, wild: 7, follow: 3 },
  intel: {
    cred: {
      xiaoli: [0.7, 0.5],
      laowang: [0.85, 0.55],
      zhangjie: [0.75, 0.5],
      qunzhu: [0.3, 0.3],
      laozhao: [0.85, 0.5],
      dav: [0.55, 0.55],
      neimu: [0.9, 0.9],
      zhuchang: [0.9, 0.9],
      kongjun: [0.55, 0.55],
    },
    flat: [0.8, 1.2, 1.5],
    stockFlat: [1.5, 2, 2.5],
    days: [8, 3, 1],
    diffStep: 0.02, qunzhuFlip: 0.8, cat: 0.6, news: 0.65, headline: 0.85 },
  tempo: {
    bossMonths: [4, 8],
    cash: 0.2,
    bossCash: 0.5,
    goalStep: 0.08,
    streak: 3,
    streakCash: 0.015,
    shards: 3,
    quietMove: 3,
    quietAcc: 1,
    bigMove: 5,
    bigAcc: 3,
  },
  // 娱乐短局：5 个月、月供打折，最后交一笔首付（开局资产的几成，按难度）；0.10.0，实测见 docs/design-balance.md
  short: { months: 5, billMult: 0.25, goal: [0.95, 1.05, 1.12] },
  // 实盘：5 个月，各档的账单和涨跌倍数（0.10.0 配平，实测见 docs/design-live.md 第 3 节）
  live: {
    months: 5,
    cap: 3,
    tiers: {
      // gearRate（0.11.0）：开杠杆的利息在这一档打几折。大档、豪华档的涨跌倍数本来就大，再叠杠杆起伏已经很猛，利息照小档收就几乎必输
      small: { billMult: 0.17, lev: 2.8, gearRate: 1 },
      mid: { billMult: 0.18, lev: 3.5, gearRate: 0.5 },
      big: { billMult: 0.18, lev: 4, gearRate: 0.25 },
      lux: { billMult: 0.22, lev: 5, gearRate: 0.25 },
    },
    gears: [
      { x: 1, cap: 3, interest: 0, call: 0 },
      { x: 2, cap: 5, interest: 0.013, call: 0.2 },
      { x: 3, cap: 7, interest: 0.0224, call: 0.1 },
    ],
    warnGap: 0.3,
  },
};

/** 某个内容的效果数值（缺省 0）。 */
export function fx(id: string, key: string): number {
  return BALANCE.fx[id]?.[key] ?? 0;
}
