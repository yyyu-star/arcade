/**
 * 场地 → 电脑（DESIGN.md 第 5 节）：在哪儿打（单机、好友房）、哪一档，决定挑哪些性格、手软多少。
 * 新手场（娱乐、小档）电脑偏弱偏宽容，普通玩家能赢；档位越高越强，豪华档接近最强。
 * 好友房实盘至少两个真人，电脑一律最强（火锅婆婆）：真人之间可以互通配合，最强更稳；
 * scripts/stake-room.ts 量过两个普通真人对它们的期望（DESIGN.md 4.1），作佐证。
 * 每个座位再给这一场的状态（Tune.mood，带种子的随机数），同一个性格不同场次打法不一样。
 */
import type { RandomStream } from 'arcade-kit/rng';
import type { Tune } from '../core/variants/types.ts';
import type { StakesId } from '../game/stakes.ts';
import { pickPersonas } from './personas.ts';

export type Place = 'solo' | 'room';

export interface Venue {
  /** PERSONAS 每个性格的权重（幺妹儿、熊猫哥、盖碗儿、兔头哥、火锅婆婆、板凳儿），0 不出场 */
  weights: readonly number[];
  /** 手软（0–1000）：越大越常打错、越不防守，偶尔放过真人打的小胡 */
  soft: number;
}

//                                幺妹儿 熊猫哥 盖碗儿 兔头哥 火锅 板凳儿
export const VENUES: Readonly<Record<string, Venue>> = {
  'solo:fun': { weights: [3, 2, 1, 3, 0, 6], soft: 500 },
  'solo:small': { weights: [3, 3, 1, 3, 0, 5], soft: 420 },
  'solo:mid': { weights: [4, 3, 3, 4, 1, 1], soft: 100 },
  'solo:big': { weights: [2, 3, 3, 2, 4, 0], soft: 0 },
  'solo:lux': { weights: [0, 3, 0, 1, 8, 0], soft: 0 },
  'room:fun': { weights: [4, 4, 2, 4, 1, 3], soft: 200 },
  // 好友房实盘：一律最强（只有火锅婆婆，几个座位都是她，名字在页面上按座位编号）；每个座位的状态照样各自浮动
  'room:small': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:mid': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:big': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
  'room:lux': { weights: [0, 0, 0, 0, 1, 0], soft: 0 },
};

/** 这一桌是哪个场地：好友房不计输赢的实盘档（只有一个真人）按娱乐算 */
export function venueOf(place: Place, stakes: StakesId, rated = true): string {
  return place === 'room' && (stakes === 'fun' || !rated) ? 'room:fun' : `${place}:${stakes}`;
}

/** 给 n 个座位挑不同的性格，各配一个这一场的状态 */
export function seatPlan(rng: RandomStream, venue: string, n: number): { personas: number[]; tunes: Tune[] } {
  const v = VENUES[venue] ?? VENUES['solo:fun']!;
  const personas = pickPersonas(rng, v.weights, n);
  // mood 不能是 0（0 是"不浮动"）
  const tunes = personas.map(() => ({ mood: rng.u32() | 1, soft: v.soft }));
  return { personas, tunes };
}
