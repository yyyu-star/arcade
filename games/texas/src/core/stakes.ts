/** 桌子的四档（DESIGN.md 5.3），单机和好友房用同一套 */
export interface Stakes {
  id: StakesId;
  name: string;
  sb: number;
  bb: number;
  /** 买入下限和上限 */
  min: number;
  max: number;
}

export type StakesId = 'small' | 'mid' | 'big' | 'lux';

export const STAKES: readonly Stakes[] = [
  { id: 'small', name: '小桌', sb: 10, bb: 20, min: 400, max: 2_000 },
  { id: 'mid', name: '中桌', sb: 50, bb: 100, min: 2_000, max: 10_000 },
  { id: 'big', name: '大桌', sb: 250, bb: 500, min: 10_000, max: 50_000 },
  { id: 'lux', name: '豪华桌', sb: 1_000, bb: 2_000, min: 40_000, max: 200_000 },
];

export function stakesOf(id: StakesId): Stakes {
  const s = STAKES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown stakes ${id}`);
  return s;
}

/**
 * 电脑的强弱档（0.5.0，DESIGN.md 4.7；0.12.0 按配平重调，4.10）：0 新手、1 小桌、2 中桌、3 大桌、4 豪华桌、5 最强（好友房）。
 * 功力（看人、诈唬、松紧、低档的"手软"）在 src/ai/personas.ts 的 SKILL；补位挑性格的权重在这里（顺序同 PERSONAS），5 按 STRONG 的顺序挑。
 * 档位定的是"这一档该多强"，场地（单机、好友房）再按档位挑强弱档：SOLO_LEVEL、ROOM_LEVEL
 */
export const LEVELS = 6;
// 性格：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白
export const LEVEL_HOUSE: readonly (readonly number[])[] = [
  [1, 1, 4, 3, 1, 2, 1, 1, 4, 5],
  [1, 2, 4, 4, 1, 2, 1, 1, 4, 4],
  [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [3, 2, 1, 1, 3, 2, 3, 3, 1, 1],
  [4, 3, 1, 1, 4, 2, 3, 4, 1, 1],
  [4, 3, 1, 1, 4, 2, 3, 4, 1, 1],
];

/**
 * 最强档（5）补位的性格顺序，最强的在前：桌上还没有的里挑排最前的（一桌不重复，9 人桌最多 8 个电脑，所以列全 10 种）。
 * 顺序按实测（scripts/sim.ts --vs --humans=2 --level=5 --persona=<编号>：两个简单打法对一整桌同一种性格，每百手输得最多的排前面）：
 * 阿飙、稳哥、老鹰、算盘、虎子、江湖、叨叨、慢慢、老好、小白，见 DESIGN.md 6.5
 */
export const STRONG: readonly number[] = [1, 0, 7, 4, 6, 5, 8, 3, 2, 9];

/**
 * 单机实盘按档位用哪一档电脑（0.12.0 配平，DESIGN.md 4.10；0.5.0–0.11 是 0、2、3、4，娱乐也按它）：小桌 1、中桌 2、大桌 3、豪华桌 4。
 * 0 档只给娱乐的新手（FUN_LEVEL）。0.12.0 以前开的娱乐桌没记 level，也按这张表
 */
export const SOLO_LEVEL: Readonly<Record<StakesId, number>> = { small: 1, mid: 2, big: 3, lux: 4 };

/**
 * 好友房（都是实盘）按档位用哪一档电脑（0.5.0）：四档都是最强（5），和 0.4.0 一样，是维护者定的：
 * 真人之间能互通、配合，最强档最稳。模拟里第 4 档已经让两个普通玩家期望 ≤ 0（3 在 9 人桌还能小赢），只作对照，见 DESIGN.md 6.5
 */
export const ROOM_LEVEL: Readonly<Record<StakesId, number>> = { small: 5, mid: 5, big: 5, lux: 5 };

/**
 * 娱乐的难度（0.12.0，docs/balance.md 第 3 节）：新手、普通、高手。娱乐不碰钱包，盲注按小桌的数；难度只管用哪一档电脑
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const FUN_STAKES: StakesId = 'small';
export const FUN_LEVEL: Readonly<Record<Difficulty, number>> = { easy: 0, normal: 2, hard: 4 };
export const DIFFICULTY_NAME: Readonly<Record<Difficulty, string>> = { easy: '新手', normal: '普通', hard: '高手' };
/** 牌桌记着的强弱档是哪个娱乐难度（0.12.0 以前开的娱乐桌没记，回 null） */
export const difficultyOf = (level: number | undefined): Difficulty | null => DIFFICULTIES.find((d) => FUN_LEVEL[d] === level) ?? null;

/** 配平和选档页按"一场"算（docs/balance.md 第 2、3 节）：打这么多手，真人速度约 15–25 分钟（DESIGN.md 4.10） */
export const SESSION_HANDS = 40;

/** 电脑带上桌的筹码：60–100 个大盲 */
export const HOUSE_MIN_BB = 60;
export const HOUSE_MAX_BB = 100;
