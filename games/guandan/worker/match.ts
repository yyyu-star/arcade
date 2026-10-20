/**
 * 快速匹配的排队（0.26.0）：kit 0.20.0 的 MatchQueue，每个档位一个实例（Durable Object，wrangler.jsonc 的 MATCH）。
 * 排队本身 0 行存储、一个闹钟；凑满 4 个或等满 15 秒（≥ 2 人）开一张匹配桌（还是 worker/room.ts 的 Room），只剩自己的转单机。
 * 档位和开桌选项在 src/net/match.ts，tests/match.test.ts 用 kit 的 matchConfigErrors 核对它们对得上房间的规则
 */
import { MatchQueue, type MatchEnv } from 'arcade-kit/match';
import { MATCH_TABLE, matchRoomOptions } from '../src/variants/guandan/net/match.ts';
import { MATCH_DDZ, MATCH_DDZ_TABLE, ddzMatchRoomOptions } from '../src/variants/doudizhu/net/match.ts';

export class Queue extends MatchQueue<MatchEnv> {
  protected readonly seats = MATCH_TABLE;

  // 档位 ddz-fun（斗地主娱乐）一桌 3 人、开斗地主桌；其余档位原样。同一个排队类，每个档位本来就是一个实例
  protected override tableSize(tier: string): number {
    return tier === MATCH_DDZ ? MATCH_DDZ_TABLE : this.seats;
  }

  protected override roomOptions(tier: string): unknown {
    return tier === MATCH_DDZ ? ddzMatchRoomOptions(tier) : matchRoomOptions(tier);
  }
}
