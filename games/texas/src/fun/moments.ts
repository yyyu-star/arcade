/**
 * 德州自己的那部分互动（0.13.0 起整套互动换成 kit 的 arcade-kit/table-fun，docs/table-fun.md 第 0 节；DESIGN.md 13.7）：
 * 电脑人物的互动性格、话多不多，和"这一手算不算名场面"。菜单、面板、冷却、连击回敬、电脑怎么反应都在 kit 里。
 * 单机的页面和好友房的房间共用；只看公开的事（操作记录、摊牌亮出来的牌），电脑的出牌决定（src/ai）不引用这里（test/arch.test.ts 查）。
 */
import type { FunTemper, MomentKind } from 'arcade-kit/fun-logic';
import { categoryOf } from '../core/eval.ts';
import { bluffer, riverTurnaround } from '../core/fame.ts';
import type { HandResult, LogEntry } from '../core/table.ts';

/** 每种性格多爱说话（‰），顺序同 PERSONAS：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白。电脑说话（view/talk.ts）按它 */
export const CHATTY = [150, 450, 350, 200, 150, 300, 550, 150, 900, 450];

/**
 * 互动性格（docs/table-fun.md 第 4 节），顺序同 PERSONAS：爱闹的回应、名场面出手的概率 ×1.5，高冷的 ×0.3（kit 的 TEMPER_MULT）。
 * 和 CHATTY（多爱说话）分开：话多不等于爱扔东西
 */
export const FUN_TEMPER: readonly FunTemper[] = ['normal', 'rowdy', 'normal', 'cool', 'cool', 'normal', 'rowdy', 'cool', 'rowdy', 'normal'];
export const temperOf = (persona: number): FunTemper => FUN_TEMPER[persona] ?? 'normal';

/**
 * 这一手是不是名场面（docs/table-fun.md 第 4 节，德州：诈唬被抓、河牌反超、全下赢），只看摊牌亮出来的牌和操作记录。
 * 主池只有一个赢家才算（平分了没有"赢家"可冲）；losers 是亮了牌、没赢主池的。几样都占时按这个顺序报一个
 */
export function momentOf(r: HandResult, log: readonly LogEntry[]): { moment: MomentKind; winner: number; losers: number[] } | null {
  if (r.byFold || r.shown.length < 2) return null;
  const main = r.pots[0]?.winners ?? [];
  if (main.length !== 1) return null;
  const winner = main[0]!.seat;
  const losers = r.shown.map((x) => x.seat).filter((x) => x !== winner);
  if (r.shown.some((x) => x.seat !== winner && bluffer(log, x.seat, categoryOf(x.value)))) return { moment: 'bluff-caught', winner, losers };
  if (riverTurnaround(r) === winner) return { moment: 'comeback', winner, losers };
  if (r.shown.some((x) => log.some((e) => e.seat === x.seat && e.allin && e.act !== 'sb' && e.act !== 'bb'))) return { moment: 'big-win', winner, losers };
  return null;
}
