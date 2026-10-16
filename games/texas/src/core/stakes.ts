/** 桌子的四档（DESIGN.md 5.3），单机和好友房用同一套 */
export interface Stakes {
  id: StakesId;
  name: string;
  sb: number;
  bb: number;
  /** 买入下限和上限 */
  min: number;
  max: number;
  /**
   * 补位时各性格的权重（顺序同 src/ai/personas.ts）：小桌多来爱跟注、胆小、新手、话多的，豪华桌多来紧凶、会算、爱诈唬的（DESIGN.md 4.3）。
   * 补位仍从桌上没有的性格里挑（10 种），9 人桌 8 个电脑只差两个，人少的桌差别才大；主要的难度在电脑的功力（personas.ts 的 SKILL）
   */
  house: readonly number[];
}

export type StakesId = 'small' | 'mid' | 'big' | 'lux';

export const STAKES: readonly Stakes[] = [
  // 性格：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白
  { id: 'small', name: '小桌', sb: 10, bb: 20, min: 400, max: 2_000, house: [1, 2, 4, 4, 1, 2, 1, 1, 4, 4] },
  { id: 'mid', name: '中桌', sb: 50, bb: 100, min: 2_000, max: 10_000, house: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
  { id: 'big', name: '大桌', sb: 250, bb: 500, min: 10_000, max: 50_000, house: [3, 2, 1, 1, 3, 2, 3, 3, 1, 1] },
  { id: 'lux', name: '豪华桌', sb: 1_000, bb: 2_000, min: 40_000, max: 200_000, house: [4, 3, 1, 1, 4, 2, 3, 4, 1, 1] },
];

export function stakesOf(id: StakesId): Stakes {
  const s = STAKES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown stakes ${id}`);
  return s;
}

/**
 * 好友房（0.4.0）补位的性格顺序，最强的在前：桌上还没有的里挑排最前的（一桌不重复，9 人桌最多 8 个电脑，所以列全 10 种）。
 * 顺序按实测（scripts/sim.ts --vs --humans=2 --strong --persona=<编号>：两个简单打法对一整桌同一种性格，每百手输得最多的排前面）：
 * 阿飙、稳哥、老鹰、算盘、虎子、江湖、叨叨、慢慢、老好、小白；功力按豪华桌时排最后的小白也让他们输，见 DESIGN.md 6.5
 */
export const STRONG: readonly number[] = [1, 0, 7, 4, 6, 5, 8, 3, 2, 9];

/** 电脑带上桌的筹码：60–100 个大盲 */
export const HOUSE_MIN_BB = 60;
export const HOUSE_MAX_BB = 100;
