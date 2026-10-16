import type { AutoSellReason, Dir, EndReason, Feel, ItemKind, Mood, Rarity, RewardKind, Role, Stage } from './types.ts';

/** 风口的真实状态（只有"风口温度计"、"熬夜复盘"、结束页复盘能显示）。 */
export const STAGE_LABEL: Record<Stage, string> = {
  cold: '冷清',
  sprout: '要火',
  ferment: '快正火',
  rally: '正火',
  climax: '太火',
  ebb: '降温',
};

/** 体感标签（公开）。 */
export const FEEL_LABEL: Record<Feel, string> = {
  cold: '冷清',
  warming: '要火',
  hot: '正火',
  overheated: '太火',
  cooling: '降温',
};

export const ROLE_LABEL: Record<Role, string> = {
  leader: '带头大哥',
  follower: '小弟',
  bluechip: '老实股',
  meme: '过山车',
  st: '危险股',
};

/** 今天大环境（原来的"大盘"）。 */
export const MOOD_LABEL: Record<Mood, string> = {
  bull: '好',
  flat: '一般',
  bear: '差',
};

/** 大环境对应的窗外天气（只是图，文字用 MOOD_LABEL）。 */
export const WEATHER_LABEL: Record<Mood, string> = {
  bull: '晴',
  flat: '多云',
  bear: '阴雨',
};

/** 群聊消息方向。 */
export const DIR_LABEL: Record<Dir, string> = {
  up: '涨',
  flat: '不动',
  down: '跌',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '常见',
  uncommon: '稀有',
  rare: '传奇',
};

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  tactic: '打法',
  tool: '工具',
  network: '人脉',
};

export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  item: '道具',
  friend: '新群友',
  stock: '股票',
};

export const AUTO_SELL_LABEL: Record<AutoSellReason, string> = {
  stop: '跌多了自动卖',
  take: '赚够了自动卖',
  delist: '退市',
};

export const END_REASON_LABEL: Record<EndReason, string> = {
  bankrupt: '没还上钱，游戏结束',
  margin: '开了杠杆，跌到清零线，这局按 0 结',
};
