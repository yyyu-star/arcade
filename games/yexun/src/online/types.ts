/**
 * 联网部分（排行、每日、分享、social）和录像共用的类型。
 * 核心的 Setup 以后会加 danger / curses / endless / character（第 8 步接线时统一），这里先按同样的字段名声明一份，
 * 接线时把 OnlineSetup 换成核心的 Setup 即可；字段名不变，录像和每日挑战就不用改。
 */
import type { Setup } from '../core/state.ts';

/** 咒印：每日挑战从里面按日期挑 1–2 条（怪更快、少回血、禁用刷新、怪更多、精英更多、夜更黑） */
export const CURSE_IDS = ['fast', 'noheal', 'noreroll', 'more', 'elites', 'dark'] as const;
export type CurseId = (typeof CURSE_IDS)[number];

export const CURSE_NAMES: Record<CurseId, string> = {
  fast: '怪更快',
  noheal: '少回血',
  noreroll: '禁用刷新',
  more: '怪更多',
  elites: '精英更多',
  dark: '夜更黑',
};

/** 模式：守夜 vigil、夜探 raid（无尽是守夜的一种玩法，用 endless 标记） */
export type RunMode = 'vigil' | 'raid';

/** 危险档 0–5 */
export type Danger = 0 | 1 | 2 | 3 | 4 | 5;

/** 开一局的设置快照（录像里存的就是它）。现在核心的 Setup 只认前面几项，多出来的字段先被忽略 */
/** 开局设置就是核心的 Setup（录像、每日挑战、交分都按它） */
export type OnlineSetup = Setup;

/** 一局打完的小结（结算页、交分、分享卡、录像都从它来） */
export interface RunSummary {
  /** 这一局的唯一 id，防止同一局交两次分 */
  runId: string;
  setup: OnlineSetup;
  /** 赢了 = 守夜撑到天亮；夜探成功撤出 */
  won: boolean;
  /** 认输 / 中途退出 */
  quit: boolean;
  bossKilled: boolean;
  /** 撑了多少秒（拍数 / 30 取整） */
  seconds: number;
  kills: number;
  level: number;
  /** 铜钱（守夜）；夜探是带出的宝物价值，用 loot */
  coins: number;
  /** 夜探：成功撤出带出的宝物价值（铜钱）；没撤出为 0 */
  loot: number;
  /** 实盘局：不交分 */
  live: boolean;
  /** 开了"降低伤害"（新手保护）：不交总榜 */
  reducedDamage: boolean;
  /** 每日挑战的日期（北京时间 YYYY-MM-DD）；不是每日挑战为 null */
  daily: string | null;
  /** 分享卡用：build 摘要、角色名 */
  build?: string[];
}
