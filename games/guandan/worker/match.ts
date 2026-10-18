/**
 * 快速匹配的排队（0.26.0）：kit 0.20.0 的 MatchQueue，每个档位一个实例（Durable Object，wrangler.jsonc 的 MATCH）。
 * 排队本身 0 行存储、一个闹钟；凑满 4 个或等满 15 秒（≥ 2 人）开一张匹配桌（还是 worker/room.ts 的 Room），只剩自己的转单机。
 * 档位和开桌选项在 src/net/match.ts，tests/match.test.ts 用 kit 的 matchConfigErrors 核对它们对得上房间的规则
 */
import { MatchQueue, type MatchEnv } from 'arcade-kit/match';
import { MATCH_TABLE, matchRoomOptions } from '../src/net/match.ts';

export class Queue extends MatchQueue<MatchEnv> {
  protected readonly seats = MATCH_TABLE;

  protected override roomOptions(tier: string): unknown {
    return matchRoomOptions(tier);
  }
}
