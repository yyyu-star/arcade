/**
 * 斗地主的快速匹配档位（牌馆 ⑤⑥）：娱乐 ddz-fun，实盘每档一个 ddz-real-<档位>（好友房实盘的规则，6 副），一桌最多 3 个真人，空位电脑补。
 * 还是同一个排队类（worker/match.ts 的 Queue，每个档位一个实例）：按档位给一桌几个人、开桌选项，所以不用新的 Durable Object。
 * 没有钱包（单独部署）只开娱乐，实盘的排不了（worker/gate.ts）。
 */
import { TIER_IDS, isTier, type TierId } from '../stake/index.ts';

export const MATCH_DDZ = 'ddz-fun';
export const MATCH_DDZ_TABLE = 3;

export type DdzMatchTier = typeof MATCH_DDZ | `ddz-real-${TierId}`;

/** 实盘的档位：每个实盘档位一个 */
export const MATCH_DDZ_REAL: readonly DdzMatchTier[] = TIER_IDS.map((t): DdzMatchTier => `ddz-real-${t}`);

/** 全部斗地主档位 */
export const MATCH_DDZ_TIERS: readonly DdzMatchTier[] = [MATCH_DDZ, ...MATCH_DDZ_REAL];

/** 这个排队的档位是不是斗地主的 */
export const isDdzMatchTier = (tier: string): boolean => (MATCH_DDZ_TIERS as readonly string[]).includes(tier);

/** 实盘档位 → 排队的档位；null 是娱乐 */
export function ddzMatchTierOf(stake: TierId | null): DdzMatchTier {
  return stake === null ? MATCH_DDZ : `ddz-real-${stake}`;
}

/** 排队的档位 → 实盘档位（娱乐是 null）；认不得的是 undefined */
export function ddzStakeOfTier(tier: string): TierId | null | undefined {
  if (tier === MATCH_DDZ) return null;
  const t = /^ddz-real-(.+)$/.exec(tier)?.[1];
  return isTier(t) ? t : undefined;
}

/** 开桌带的选项：和好友房开斗地主房一样（娱乐 { variant }，实盘多 stake），房间的 options 校验 */
export function ddzMatchRoomOptions(tier: string): { variant: 'ddz'; stake?: TierId } | undefined {
  const s = ddzStakeOfTier(tier);
  if (s === undefined) return undefined;
  return s === null ? { variant: 'ddz' } : { variant: 'ddz', stake: s };
}
