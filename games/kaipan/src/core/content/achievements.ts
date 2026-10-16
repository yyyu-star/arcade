import { isDailyRun } from '../daily.ts';
import type { AchievementCtx, AchievementDef } from '../hooks.ts';
import { SURPRISE_BILLS } from './calendar.ts';
import { ITEMS } from './items.ts';
import { personaAccount } from './personas.ts';
import { STOCKS } from './stocks.ts';

const roleOf = new Map(STOCKS.map((d) => [d.id, d.role]));

/** 道具名（带引号），跟着道具表走。 */
function it(id: string): string {
  return `"${ITEMS.find((d) => d.id === id)?.name ?? id}"`;
}

function wonWith(c: AchievementCtx, items: readonly string[]): boolean {
  return c.won && items.every((id) => c.state.items.includes(id));
}

/**
 * 成就（0.3.0：30 个，id 固定）：铜（轻松）10、银（需要构筑）12、金（硬核）8。
 * 只在一局结束（won / lost）后按局内统计判定，确定性、可测试（achievementsOf）。
 * 判定可以用隐藏信息（例如买入时的真实阶段），因为结束后才揭晓。
 * unlocks：达成后解锁的人设（档案层处理）。文案全部虚构。
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ---------------------------------------------------------------- 铜：轻松
  {
    id: 'daily_checkin',
    name: '每日打卡',
    desc: '打完一局每日挑战（输赢都算）',
    tier: 'bronze',
    icon: 'star',
    check: (c) => isDailyRun(c.state.setup?.daily, c.state.seed, c.state.persona, c.state.difficulty),
  },
  {
    id: 'first_limitup',
    name: '涨停初体验',
    desc: '手里的股票第一次涨停',
    tier: 'bronze',
    icon: 'rocket',
    check: (c) => c.state.stats.limitUpDays >= 1,
    progress: (c) => [c.state.stats.limitUpDays, 1],
  },
  {
    id: 'leader_chain',
    name: '大哥带我飞',
    desc: '手里的小弟被大哥带着涨了一次（带头大哥涨停，同一个风口的小弟跟着多涨）',
    tier: 'bronze',
    icon: 'crown',
    check: (c) => c.state.stats.chains >= 1,
    progress: (c) => [c.state.stats.chains, 1],
  },
  {
    id: 'limit_down',
    name: '关灯吃面',
    desc: '手里的股票吃到一个跌停',
    tier: 'bronze',
    icon: 'chart_down',
    check: (c) => c.state.stats.limitDownDays >= 1,
  },
  {
    id: 'bust',
    name: '韭菜的自我修养',
    desc: '第一次没还上钱，游戏结束',
    tier: 'bronze',
    icon: 'skull',
    check: (c) => c.state.phase === 'lost',
  },
  {
    id: 'cat_rich',
    name: '猫比我有钱',
    desc: `被"${SURPRISE_BILLS.find((b) => b.id === 'vet')?.name ?? '猫'}"那笔突发账单扣过钱`,
    tier: 'bronze',
    icon: 'cat',
    check: (c) => c.state.stats.surprisesPaid.includes('vet'),
  },
  {
    id: 'half_year',
    name: '熬过半年',
    desc: '还清前 6 个月要还的钱',
    tier: 'bronze',
    icon: 'bill',
    check: (c) => c.state.stats.billsPaid >= 6,
    progress: (c) => [c.state.stats.billsPaid, 6],
  },
  {
    id: 'qunzhu_tuition',
    name: '交学费',
    desc: '买了韭菜收割机推荐的股票，最后亏着卖掉',
    tier: 'bronze',
    icon: 'megaphone',
    check: (c) => c.trades.some((t) => t.recBy === 'qunzhu' && t.ret < 0 && t.reason !== 'end'),
  },
  {
    id: 'stand_guard',
    name: '站岗专业户',
    desc: '在风口最火的时候买进，一直拿到它降温',
    tier: 'bronze',
    icon: 'ice',
    check: (c) => c.trades.some((t) => t.guard),
  },
  {
    id: 'first_win',
    name: '上岸',
    desc: '通关一次（任何人设、任何难度）',
    tier: 'bronze',
    icon: 'trophy',
    check: (c) => c.won,
  },
  // ---------------------------------------------------------------- 银：需要构筑
  {
    id: 'lianban_5',
    name: '涨停狂魔',
    desc: '手里有一只股票连续涨停 5 天',
    tier: 'silver',
    icon: 'fire',
    check: (c) => c.state.stats.maxBoards >= 5,
    progress: (c) => [c.state.stats.maxBoards, 5],
  },
  {
    id: 'school_theme',
    name: '跟大哥流',
    desc: `带着${it('longtou')}和${it('genfeng')}通关`,
    tier: 'silver',
    icon: 'crown',
    check: (c) => wonWith(c, ['longtou', 'genfeng']),
  },
  {
    id: 'school_board',
    name: '追涨停流',
    desc: `带着${it('yaogu')}和${it('lianban')}通关`,
    tier: 'silver',
    icon: 'rocket',
    check: (c) => wonWith(c, ['yaogu', 'lianban']),
  },
  {
    id: 'school_steady',
    name: '稳中求进流',
    desc: `带着${it('baima')}、${it('margin')}和${it('ipo')}通关`,
    tier: 'silver',
    icon: 'shield',
    check: (c) => wonWith(c, ['baima', 'margin', 'ipo']),
  },
  {
    id: 'school_dip',
    name: '抄底流',
    desc: `带着${it('dixi')}、${it('mood_meter')}和${it('zhiying')}通关`,
    tier: 'silver',
    icon: 'chart_up',
    check: (c) => wonWith(c, ['dixi', 'mood_meter', 'zhiying']),
  },
  {
    id: 'school_news',
    name: '消息流',
    desc: `带着${it('paid_group')}和${it('notebook')}通关`,
    tier: 'silver',
    icon: 'chat',
    check: (c) => wonWith(c, ['paid_group', 'notebook']),
  },
  {
    id: 'contrarian',
    name: '反向大师',
    desc: '专挑韭菜收割机说要跌的风口买，一局里累计赚到 20%',
    tier: 'silver',
    icon: 'megaphone',
    check: (c) => c.trades.filter((t) => t.contra).reduce((a, t) => a + t.ret, 0) >= 20,
  },
  {
    id: 'data_driven',
    name: '数据驱动',
    desc: `带着${it('mood_meter')}或${it('night_review')}通关`,
    tier: 'silver',
    icon: 'chart_up',
    unlocks: 'coder',
    check: (c) => c.won && (c.state.items.includes('mood_meter') || c.state.items.includes('night_review')),
  },
  {
    id: 'diversified',
    name: '雨露均沾',
    desc: '手里的股票同时分在 4 个不同的风口',
    tier: 'silver',
    icon: 'clover',
    check: (c) => c.state.stats.maxThemes >= 4,
    progress: (c) => [c.state.stats.maxThemes, 4],
  },
  {
    id: 'one_basket',
    name: '一个篮子',
    desc: '同一个风口同时拿 4 只股票',
    tier: 'silver',
    icon: 'coin',
    check: (c) => c.state.stats.maxSameTheme >= 4,
    progress: (c) => [c.state.stats.maxSameTheme, 4],
  },
  {
    id: 'big_day',
    name: '一日暴富',
    desc: '一天之内账户涨 8% 以上',
    tier: 'silver',
    icon: 'chart_up',
    check: (c) => c.state.stats.maxDayRet >= 8,
    progress: (c) => [Math.floor(c.state.stats.maxDayRet), 8],
  },
  {
    id: 'credit_win',
    name: '刷卡续命',
    desc: '靠信用卡垫过一次钱，最后还通关了',
    tier: 'silver',
    icon: 'bill',
    check: (c) => c.won && c.state.stats.creditUsed > 0,
  },
  // ---------------------------------------------------------------- 金：硬核
  {
    id: 'stock_god',
    name: '股神',
    desc: '在第 8 级"末日"通关',
    tier: 'gold',
    icon: 'trophy',
    check: (c) => c.won && c.state.difficulty >= 8,
  },
  {
    id: 'veteran',
    name: '老股民',
    desc: '在第 5 级"强监管"或更高难度通关',
    tier: 'gold',
    icon: 'shield',
    check: (c) => c.won && c.state.difficulty >= 5,
  },
  {
    id: 'millionaire',
    name: '百万散户',
    desc: '账户达到 100 万',
    tier: 'gold',
    icon: 'crown',
    check: (c) => c.state.stats.peakAccount >= 1_000_000,
  },
  {
    id: 'value_investor',
    name: '价值投资',
    desc: '只买过老实股（奖励、事件进来的也算），还清前 9 个月要还的钱',
    tier: 'gold',
    icon: 'clover',
    // 只买白马几乎不可能通关（实测连 oracle 都不到 1%），所以要求撑过 9 月，见 docs/design-0.3.md 第 14.1 节
    check: (c) =>
      c.state.stats.billsPaid >= 9 && c.state.stats.acquired.length > 0 && c.state.stats.acquired.every((id) => roleOf.get(id) === 'bluechip'),
  },
  {
    id: 'limitup_crew',
    name: '涨停敢死队',
    desc: '一局里有 20 天手里有股票涨停',
    tier: 'gold',
    icon: 'fire',
    unlocks: 'youzi',
    check: (c) => c.state.stats.limitUpDays >= 20,
    progress: (c) => [c.state.stats.limitUpDays, 20],
  },
  {
    id: 'naked',
    name: '裸考',
    desc: '一个道具都不拿（人设自带的不算），在第 3 级"高手"或更高难度通关',
    tier: 'gold',
    icon: 'star',
    check: (c) => c.won && c.state.difficulty >= 3 && c.state.stats.itemsTaken.length === 0,
  },
  {
    id: 'crash_survivor',
    name: '股灾幸存者',
    desc: '股灾那个月，账户不跌反涨，还按时还上了钱',
    tier: 'gold',
    icon: 'ice',
    check: (c) => (c.state.stats.crashRet ?? 0) > 0,
  },
  {
    id: 'steady_dog',
    name: '稳如老狗',
    desc: '通关，并且 12 个月每个月都赚钱（从月初算到月底还钱之前）',
    tier: 'gold',
    icon: 'shield',
    check: (c) => c.won && c.state.stats.monthRets.length >= 12 && c.state.stats.monthRets.every((r) => r > 0),
  },
  // ---------------------------------------------------------------- 0.4 C：仓位、押跌、抵押
  {
    id: 'all_in',
    name: '一把梭',
    desc: '重仓过 3 次，还通关了',
    tier: 'silver',
    icon: 'rocket',
    check: (c) => c.won && (c.state.ext?.log.heavy ?? 0) >= 3,
  },
  {
    id: 'mouth_hard',
    name: '嘴硬王',
    desc: '押跌的股票连着涨停 2 天，你还没认输',
    tier: 'silver',
    icon: 'megaphone',
    check: (c) => (c.state.ext?.log.stubborn ?? 0) >= 2,
    progress: (c) => [c.state.ext?.log.stubborn ?? 0, 2],
  },
  {
    id: 'air_force',
    name: '空军司令',
    desc: '一局里靠押跌一共赚了 5 万',
    tier: 'gold',
    icon: 'chart_down',
    check: (c) => (c.state.ext?.log.shortPnl ?? 0) >= 50_000,
  },
  {
    id: 'pawned',
    name: '东西没了',
    desc: '押给银行的东西被收走了',
    tier: 'bronze',
    icon: 'skull',
    check: (c) => (c.state.ext?.log.seized.length ?? 0) > 0,
  },
  {
    id: 'redeemed',
    name: '赎身',
    desc: '自己把押出去的东西赎了回来',
    tier: 'bronze',
    icon: 'shield',
    check: (c) => (c.state.ext?.log.redeemed.length ?? 0) > 0,
  },
  {
    id: 'house_back',
    name: '房子保卫战',
    desc: '押了房子、赎了回来，还通关了',
    tier: 'gold',
    icon: 'crown',
    check: (c) => c.won && !!c.state.ext?.log.redeemed.includes('house'),
  },

  // ---------------------------------------------------------------- 0.6.4：打法和隐藏结局（只用来看，不发筹码）
  {
    id: 'zen_watch',
    name: '佛系股民',
    desc: '一只股票都没买，也还上了 2 个月的钱',
    tier: 'bronze',
    icon: 'clover',
    check: (c) => c.state.stats.buys === 0 && c.state.stats.billsPaid >= 2,
  },
  {
    id: 'so_close',
    name: '差一口气',
    desc: '撑到了最后一个月才没还上钱',
    tier: 'bronze',
    icon: 'bill',
    check: (c) => c.state.phase === 'lost' && c.state.month >= (c.state.setup?.live?.months ?? 12) && c.state.month > 1,
  },
  {
    id: 'chat_fan',
    name: '群聊信徒',
    desc: '通关，买过的每一只都是群友推荐的（至少 10 笔）',
    tier: 'bronze',
    icon: 'chat',
    check: (c) => c.won && c.trades.length >= 10 && c.trades.every((t) => t.recBy !== null),
  },
  {
    id: 'loner',
    name: '我自己拿主意',
    desc: '通关，一只群友推荐的都没买（至少 10 笔）',
    tier: 'silver',
    icon: 'trophy',
    check: (c) => c.won && c.trades.length >= 10 && c.trades.every((t) => t.recBy === null),
  },
  {
    id: 'every_day',
    name: '全勤奖',
    desc: '通关，每个交易日都动过手（买、卖都算）',
    tier: 'silver',
    icon: 'star',
    check: (c) => c.won && c.state.stats.days > 0 && c.state.stats.activeDays >= c.state.stats.days,
  },
  {
    id: 'lucky_88',
    name: '发发发',
    desc: '一局结束时，账户的整数部分以 88 结尾',
    tier: 'bronze',
    icon: 'coin',
    hidden: true,
    check: (c) => Math.floor(c.state.account) % 100 === 88,
  },
  {
    id: 'busy_nothing',
    name: '白忙一场',
    desc: '通关，可炒了这么久，炒股净赚不到本钱的 1%（亏的也算）',
    tier: 'silver',
    icon: 'ice',
    hidden: true,
    check: (c) => {
      const start = c.state.setup?.account ?? personaAccount(c.state.persona);
      const m = c.state.stats.tradeMoney;
      return c.won && c.state.stats.buys > 0 && m !== undefined && Math.abs(m) < start * 0.01;
    },
  },
  {
    id: 'nail',
    name: '钉子户',
    desc: '通关，一次都没卖过（换股、减仓也算卖）',
    tier: 'silver',
    icon: 'shield',
    hidden: true,
    check: (c) => c.won && c.state.stats.buys > 0 && c.state.stats.sells === 0,
  },
  {
    id: 'phoenix',
    name: '死里逃生',
    desc: '有一个月账户跌掉四成以上，最后还通关了',
    tier: 'gold',
    icon: 'crown',
    hidden: true,
    check: (c) => c.won && c.state.stats.monthRets.some((r) => r <= -40 && r > -100),
  },
];
