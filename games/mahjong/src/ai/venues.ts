/**
 * 场地 → 电脑（DESIGN.md 第 5 节）：在哪儿打（单机、好友房）、哪一档，决定挑哪些性格、手软和手紧多少。
 * 0.10.0 按 docs/balance.md 配平（scripts/balance.ts 拿"小白""普通"两个代理玩家量，结果在 DESIGN.md 4.1）：
 * 单机娱乐分新手、普通、高手三个难度，实盘四档逐档变强。新手档、小档手软大（少防守、少做大牌、多打错、偶尔放过真人的小胡），
 * 豪华档和娱乐高手再加手紧（功力、读牌）、火锅婆婆最常见。
 * 好友房实盘至少两个真人，电脑一律最强（火锅婆婆）：真人之间可以互通配合，最强更稳；
 * scripts/stake-room.ts 量过两个普通真人对它们的期望（DESIGN.md 4.1），作佐证。
 * 每个座位再给这一场的状态（Tune.mood，带种子的随机数），同一个性格不同场次打法不一样。
 */
import type { RandomStream } from 'arcade-kit/rng';
import type { Tune } from '../core/variants/types.ts';
import type { StakesId } from '../game/stakes.ts';
import { pickPersonas } from './personas.ts';

export type Place = 'solo' | 'room';
/** 单机娱乐的难度（docs/balance.md 第 3 节）：新手、普通、高手；第一次玩默认新手 */
export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];

export interface Venue {
  /** PERSONAS 每个性格的权重（幺妹儿、熊猫哥、盖碗儿、兔头哥、火锅婆婆、板凳儿），0 不出场 */
  weights: readonly number[];
  /** 手软（0–1000）：越大越常打错、越不防守，偶尔放过真人打的小胡 */
  soft: number;
  /** 手紧（0–1000）：越大牌效、读牌越细，越少打错（大档、豪华档） */
  sharp?: number;
}

//                                幺妹儿 熊猫哥 盖碗儿 兔头哥 火锅 板凳儿
export const VENUES: Readonly<Record<string, Venue>> = {
  // 娱乐的三个难度（docs/balance.md 第 3 节）：新手 / 普通 / 高手
  'solo:fun:easy': { weights: [3, 2, 1, 3, 0, 6], soft: 1_400 },
  'solo:fun:normal': { weights: [3, 3, 1, 3, 0, 5], soft: 300 },
  'solo:fun:hard': { weights: [0, 2, 0, 1, 9, 0], soft: 0, sharp: 450 },
  // 实盘四档（第 2 节）
  'solo:small': { weights: [3, 2, 1, 3, 0, 6], soft: 650 },
  'solo:mid': { weights: [3, 3, 1, 3, 0, 5], soft: 300 },
  'solo:big': { weights: [4, 3, 3, 4, 1, 1], soft: 0 },
  'solo:lux': { weights: [0, 3, 0, 1, 8, 0], soft: 120, sharp: 330 },
  'room:fun': { weights: [4, 4, 2, 4, 1, 3], soft: 200 },
  // 好友房实盘：一律最强（只有火锅婆婆，几个座位都是她，名字在页面上按座位编号）；每个座位的状态照样各自浮动
  'room:small': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:mid': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:big': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:lux': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
};

/** 这一桌是哪个场地：好友房不计输赢的实盘档（只有一个真人）按娱乐算 */
export function venueOf(place: Place, stakes: StakesId, rated = true, level: Level = 'easy'): string {
  if (place === 'room') return stakes === 'fun' || !rated ? 'room:fun' : `room:${stakes}`;
  return stakes === 'fun' ? `solo:fun:${level}` : `solo:${stakes}`;
}

/** 给 n 个座位挑不同的性格，各配一个这一场的状态 */
export function seatPlan(rng: RandomStream, venue: string, n: number): { personas: number[]; tunes: Tune[] } {
  const v = VENUES[venue] ?? VENUES['solo:fun:easy']!;
  const personas = pickPersonas(rng, v.weights, n);
  // mood 不能是 0（0 是"不浮动"）
  const tunes = personas.map(() => ({ mood: rng.u32() | 1, soft: v.soft, ...(v.sharp ? { sharp: v.sharp } : {}) }));
  return { personas, tunes };
}
