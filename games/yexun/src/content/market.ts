/**
 * 守夜夜市（所有者 10-20，briefs/yexun-fun-1020.md 第 2 节）：5:00、10:00 各开一次，挑货郎在主角附近摆 3 个摊，开 20 秒，
 * 走过去站一会儿、身上铜钱够就买下；怪照常刷，不暂停。摊子的距离、站多久和夜探鬼市（content/explore.ts 的 RAID_LATE.market）一样。
 * 价格先按局内铜钱收入的初值摆，配平 PR 按"一次平均买得起 1–2 件"定。
 */
const S = 30;

export type MarketGood = 'heal' | 'reroll' | 'ban' | 'might' | 'speed' | 'vacuum' | 'upgrade';
export const MARKET_GOODS: readonly MarketGood[] = ['heal', 'reroll', 'ban', 'might', 'speed', 'vacuum', 'upgrade'];

export const NIGHT_MARKET = {
  /** 开市的拍数（开局后第 5、第 10 分钟） */
  at: [5 * 60 * S, 10 * 60 * S] as readonly number[],
  /** 开多久 */
  open: 20 * S,
  /** 开市前多久在顶栏预告 */
  warn: 5 * S,
  stalls: 3,
  /** 摊子离主角多远、三摊之间隔多远 */
  dist: 240,
  gap: 110,
  /** 站在摊前多近、站多久算买下（同鬼市） */
  r: 56,
  hold: 30,
  /** 第二次开市的价格倍数 */
  later: 1.5,
  /** 回血比例、临时增益多久和多少 */
  heal: 0.35,
  buffTicks: 60 * S,
  might: 0.15,
  speed: 0.15,
} as const;

/** 底价（第一次开市）。临时增益三选一随机上一样（伤害 / 移速 / 全屏吸珠）；法器 +1 级最贵 */
export const MARKET_PRICE: Record<MarketGood, number> = { heal: 60, reroll: 50, ban: 50, might: 70, speed: 70, vacuum: 70, upgrade: 120 };

/** 摊上的货名（画面层用） */
export const MARKET_NAME: Record<MarketGood, string> = { heal: '回血', reroll: '刷新 +1', ban: '封禁 +1', might: '伤害 +15%', speed: '移速 +15%', vacuum: '全屏吸珠', upgrade: '法器 +1 级' };
