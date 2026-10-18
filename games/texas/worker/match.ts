/**
 * 快速匹配的排队（kit 0.20.0 的 MatchQueue，DESIGN.md 6.11）：一个档位一个实例，0 行存储，凑满一桌或等满 15 秒、至少两个真人就开一张匹配桌。
 * 只填一桌几个人和开局选项，排队、凑桌、限速、平台屏蔽名单都是 kit 的；排队不碰牌局。
 */
import { MatchQueue, type MatchEnv } from 'arcade-kit/match';
import { MATCH_TABLE, matchRoomOptions } from '../src/room/match.ts';

export class Queue extends MatchQueue<MatchEnv> {
  protected readonly seats = MATCH_TABLE;
  protected override roomOptions(tier: string): unknown {
    return matchRoomOptions(tier);
  }
}
