/**
 * 斗地主的快速匹配档位（牌馆 ⑤）：只有娱乐一档 ddz-fun，一桌最多 3 个真人，空位电脑补。
 * 还是同一个排队类（worker/match.ts 的 Queue，每个档位一个实例）：按档位给一桌几个人、开桌选项，所以不用新的 Durable Object。
 */
export const MATCH_DDZ = 'ddz-fun';
export const MATCH_DDZ_TABLE = 3;

/** 开桌带的选项：和好友房开斗地主房一样，房间的 options 校验 */
export function ddzMatchRoomOptions(tier: string): { variant: 'ddz' } | undefined {
  return tier === MATCH_DDZ ? { variant: 'ddz' } : undefined;
}
