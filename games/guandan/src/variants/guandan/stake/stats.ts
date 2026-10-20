/**
 * 实盘结回时带给平台的战绩小结（平台 0.10.0，docs/platform-backend.md 5.10）：这一份打了几副、赢了几副、最大一把赢多少、拿了哪些称号，
 * 外加掼蛋自己的两个累计数（炸弹、头游）。净赢、本周净赢平台按钱算，这里不报。
 * 单机（页面攒、经 /api/stake/settle 原样转发）和好友房（房间按座位攒、随结回的 effect 走 RPC）用同一份。纯函数。
 */
import { teamOf, type DealResult, type PlayRecord } from '../core/index.ts';
import { dealPoints, pointValue, type TierId } from './index.ts';
import { bombsBy, dealTitles, type TitleId } from './titles.ts';

/** 平台的类型（照抄 5.10，游戏不能 import 平台的代码）。JSON 后 ≤ 256 字节，不合格整份忽略、钱照常结 */
export interface SettleStats {
  rounds: number;
  wins: number;
  best: number;
  titles?: string[];
  max?: Record<string, number>;
  sum?: Record<string, number>;
}

/** 平台每份最多收 5 个称号 */
const MAX_TITLES = 5;

/** 一份（一个座位带进去的那一份）到现在攒下的 */
export interface Tally {
  /** 记过的副数 */
  rounds: number;
  /** 本队赢的副数（这一副本队得分 = 本队升级） */
  wins: number;
  /** 最大的一副赢了多少筹码 */
  best: number;
  bombs: number;
  firsts: number;
  titles: TitleId[];
}

export const emptyTally = (): Tally => ({ rounds: 0, wins: 0, best: 0, bombs: 0, firsts: 0, titles: [] });

/** 记一副（seat 是这一份的座位，单机是 0）。history 是这一副的出牌记录（一副结束时还在状态里） */
export function tallyDeal(t: Tally, r: DealResult, history: readonly PlayRecord[], seat: number, tier: TierId): Tally {
  const d = dealPoints(r, teamOf(seat));
  const got = dealTitles(r, history)
    .filter((x) => x.seat === seat || (x.pair && teamOf(x.seat) === teamOf(seat)))
    .map((x) => x.id);
  const titles = [...t.titles];
  for (const id of got) if (!titles.includes(id)) titles.push(id);
  const firsts = t.firsts + (r.order[0] === seat ? 1 : 0);
  // 一局里两次头游（和整局结束页的"头游王"同一条线）
  if (firsts >= 2 && !titles.includes('first_king')) titles.push('first_king');
  return {
    rounds: t.rounds + 1,
    wins: t.wins + (d > 0 ? 1 : 0),
    best: Math.max(t.best, d * pointValue(tier)),
    bombs: t.bombs + bombsBy(history)[seat]!,
    firsts,
    titles,
  };
}

export function statsOf(t: Tally): SettleStats {
  const out: SettleStats = { rounds: t.rounds, wins: t.wins, best: t.best, sum: { bombs: t.bombs, firsts: t.firsts } };
  if (t.titles.length) out.titles = t.titles.slice(0, MAX_TITLES);
  return out;
}
