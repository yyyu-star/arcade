/**
 * 宝箱里出什么（DESIGN.md 2.3）：木箱 1 件、铜箱 2 件、金箱 3 件；按档的权重先抽档、再在档里均匀抽一件。
 * 越深（离镇中心越近）越往高档挪：深处的宝箱更值钱。抽签用"宝箱"那条随机流（地图生成时一次抽好，和开箱的先后无关）。
 */
import { CHEST, type ChestTier } from '../content/explore.ts';
import { TIERS, TREASURES, TREASURES_BY_TIER } from '../content/treasures.ts';
import type { Rng } from '../core/rng.ts';

/** 这一档宝箱在这个深度（0 镇边 – 1 镇中心）的四档权重（凡、良、珍、绝），和为 1 */
export function tierWeights(tier: ChestTier, depth: number): [number, number, number, number] {
  const c = CHEST[tier];
  const d = depth < 0 ? 0 : depth > 1 ? 1 : depth;
  const [f, l, z, j] = c.weights;
  const move = f * c.deep * d;
  const rest = l + z + j;
  return [f - move, l + (move * l) / rest, z + (move * z) / rest, j + (move * j) / rest];
}

/** 抽一箱（宝物编号，几件按宝箱档位） */
export function rollChest(rng: Rng, tier: ChestTier, depth: number): number[] {
  const w = tierWeights(tier, depth);
  const out: number[] = [];
  for (let k = 0; k < CHEST[tier].items; k++) {
    let r = rng.next();
    let t = 0;
    while (t < 3 && r >= w[t]!) {
      r -= w[t]!;
      t++;
    }
    const pool = TREASURES_BY_TIER[TIERS[t]!];
    out.push(pool[rng.int(pool.length)]!);
  }
  return out;
}

/** 每档宝物的平均价值 */
const TIER_MEAN = TIERS.map((t) => {
  const pool = TREASURES_BY_TIER[t];
  return pool.reduce((s, i) => s + TREASURES[i]!.value, 0) / pool.length;
});

/** 一箱的期望价值（定基准价值、测试用） */
export function expectedChestValue(tier: ChestTier, depth: number): number {
  const w = tierWeights(tier, depth);
  let v = 0;
  for (let t = 0; t < 4; t++) v += w[t]! * TIER_MEAN[t]!;
  return v * CHEST[tier].items;
}

/** 背包总价值 */
export function bagValue(bag: readonly number[]): number {
  let v = 0;
  for (const i of bag) v += TREASURES[i]!.value;
  return v;
}
