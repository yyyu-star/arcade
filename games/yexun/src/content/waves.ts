/**
 * 守夜的刷怪节奏（DESIGN.md 2.2）和难度。每分钟一档：场上至少保持多少只、每秒补多少只、各种怪的比例；
 * 加上几个定点事件（开场正面一波、围圈、精英、群冲、纸人海、尸王）。
 */
import type { EnemyKind } from './enemies.ts';

export interface Minute {
  /** 场上保持的数量 */
  keep: number;
  /** 每秒补多少只（不到 keep 的一半时翻倍） */
  rate: number;
  mix: Partial<Record<EnemyKind, number>>;
}

export const MINUTES: readonly Minute[] = [
  { keep: 22, rate: 3, mix: { paper: 1 } },
  { keep: 40, rate: 4, mix: { paper: 0.7, wisp: 0.3 } },
  { keep: 60, rate: 5, mix: { paper: 0.5, wisp: 0.3, jiangshi: 0.2 } },
  { keep: 80, rate: 6, mix: { paper: 0.3, wisp: 0.2, jiangshi: 0.5 } },
  { keep: 100, rate: 7, mix: { paper: 0.3, wisp: 0.2, jiangshi: 0.5 } },
  { keep: 115, rate: 7.5, mix: { paper: 0.3, wisp: 0.1, jiangshi: 0.4, lantern: 0.2 } },
  { keep: 130, rate: 8, mix: { paper: 0.35, jiangshi: 0.4, lantern: 0.25 } },
  { keep: 150, rate: 9, mix: { paper: 0.3, jiangshi: 0.4, fox: 0.3 } },
  { keep: 170, rate: 10, mix: { wisp: 0.15, jiangshi: 0.4, lantern: 0.15, fox: 0.3 } },
  { keep: 190, rate: 11, mix: { paper: 0.25, jiangshi: 0.35, lantern: 0.15, fox: 0.25 } },
  { keep: 210, rate: 12, mix: { paper: 0.2, wisp: 0.1, jiangshi: 0.35, lantern: 0.1, fox: 0.25 } },
  { keep: 230, rate: 13, mix: { paper: 0.25, jiangshi: 0.4, lantern: 0.1, fox: 0.25 } },
  { keep: 250, rate: 14, mix: { paper: 0.2, wisp: 0.15, jiangshi: 0.4, fox: 0.25 } },
  { keep: 265, rate: 15, mix: { paper: 0.2, jiangshi: 0.45, lantern: 0.1, fox: 0.25 } },
  { keep: 240, rate: 13, mix: { paper: 0.3, jiangshi: 0.45, fox: 0.25 } },
];

export type WaveEvent =
  | { at: number; kind: 'front'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'ring'; enemy: EnemyKind; count: number; radius: number }
  | { at: number; kind: 'line'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'elite'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'boss' };

const S = 30;
/** 定点事件，at 是拍数 */
export const EVENTS: readonly WaveEvent[] = [
  // 开场 2 秒：正面近处来一小群纸人，保证 10 秒内第一次升级（验收 ①）
  { at: 2 * S, kind: 'front', enemy: 'paper', count: 12 },
  { at: 150 * S, kind: 'ring', enemy: 'paper', count: 56, radius: 400 },
  { at: 300 * S, kind: 'elite', enemy: 'shishi', count: 1 },
  { at: 450 * S, kind: 'line', enemy: 'wisp', count: 30 },
  { at: 540 * S, kind: 'elite', enemy: 'shishi', count: 1 },
  { at: 600 * S, kind: 'elite', enemy: 'general', count: 2 },
  { at: 750 * S, kind: 'ring', enemy: 'paper', count: 90, radius: 430 },
  { at: 780 * S, kind: 'elite', enemy: 'general', count: 1 },
  { at: 840 * S, kind: 'boss' },
];

/** 一局多长：15 分钟天亮 */
export const DAWN_TICK = 15 * 60 * S;

/** 怪随时间变硬：血量 × (1 + 每分钟 hpPerMin)，伤害 × (1 + 每分钟 dmgPerMin) */
export const SCALE = { hpPerMin: 0.22, dmgPerMin: 0.08 };

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  /** 选档卡上的星（电脑多强，balance.md 第 5 节） */
  stars: number;
  hpMul: number;
  dmgMul: number;
  /** 刷怪量 */
  countMul: number;
  /** 一句话 */
  blurb: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: { id: 'easy', name: '新手', stars: 1, hpMul: 0.72, dmgMul: 0.6, countMul: 0.85, blurb: '第一次玩选这个' },
  normal: { id: 'normal', name: '普通', stars: 2, hpMul: 1, dmgMul: 1, countMul: 1, blurb: '会躲会选就能撑到天亮' },
  hard: { id: 'hard', name: '高手', stars: 3, hpMul: 1.4, dmgMul: 1.35, countMul: 1.15, blurb: '怪更多更硬' },
};
