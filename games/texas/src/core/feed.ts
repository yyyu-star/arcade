/**
 * 好友动态的名场面（0.16.0，总仓库 docs/platform-backend.md 15.17 第 2 条）：一手打完，这个座位有没有值得给好友看的事。
 * 只看公开信息（摊牌亮出来的牌、分池结果、操作记录），只认赢了的（不拿输的给好友看）。
 * 纯函数：判定在这里，报不报、报几条由画面层管（规则核心不碰网络）。编号和 public/moments.json 的模板一一对应。
 */
import { categoryOf, QUADS, STRAIGHT_FLUSH } from './eval.ts';
import { riverTurnaround } from './fame.ts';
import type { HandResult, LogEntry } from './table.ts';

export type FeedMoment = 'royal_flush' | 'straight_flush' | 'quads' | 'allin_comeback' | 'big_pot';

/** 按这个顺序取一手里最值得说的那一个 */
export const FEED_MOMENTS: readonly FeedMoment[] = ['royal_flush', 'straight_flush', 'quads', 'allin_comeback', 'big_pot'];

/** 一手赢下的（各个池加起来）到多少个大盲算"大锅"：一份满买入就是 100 个大盲，赢下这么多等于把一整份赢过来 */
export const BIG_POT_BB = 100;

/**
 * 这一手 seat 有没有名场面：n 是这一手赢下的筹码（各个池加起来）。没赢、没有就是 null。
 * 皇家同花顺、同花顺、四条要摊牌亮出来、赢了；全下翻盘是自己全下（盲注被迫全下的不算）、转牌落后河牌逆转赢了主池
 */
export function feedMoment(r: HandResult, log: readonly LogEntry[], seat: number, bb: number): { moment: FeedMoment; n: number } | null {
  const won = r.pots.reduce((a, p) => a + (p.winners.find((w) => w.seat === seat)?.won ?? 0), 0);
  if (won <= 0) return null;
  const mine = r.byFold ? undefined : r.shown.find((s) => s.seat === seat);
  if (mine) {
    const cat = categoryOf(mine.value);
    // 牌力值的最低 4 位是顺子最高张 + 1：A 高是 13
    if (cat === STRAIGHT_FLUSH) return { moment: (mine.value & 15) === 13 ? 'royal_flush' : 'straight_flush', n: won };
    if (cat === QUADS) return { moment: 'quads', n: won };
    const allin = log.some((e) => e.seat === seat && e.allin && e.act !== 'sb' && e.act !== 'bb');
    if (allin && riverTurnaround(r) === seat) return { moment: 'allin_comeback', n: won };
  }
  return won >= BIG_POT_BB * bb ? { moment: 'big_pot', n: won } : null;
}

/** 一局（坐上一桌到离开，进一个房间到离开）最多报几条：别刷好友的屏，平台每人每天也只收 10 条 */
export const FEED_PER_GAME = 2;

/** 这一条报不报：同一种一局只报一次，一局最多 FEED_PER_GAME 条 */
export const shouldReport = (sent: ReadonlySet<FeedMoment>, moment: FeedMoment): boolean => !sent.has(moment) && sent.size < FEED_PER_GAME;
