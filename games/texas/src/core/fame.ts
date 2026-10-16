/**
 * 战绩小结和称号（0.3.0；平台 0.10.0 的 settle.stats，docs/platform-backend.md 5.10）：每一份（钱包里"桌上那一份"）打了几手、赢了几手、
 * 最大一把净赢多少、拿到哪些称号，结回时一起报给平台。
 * 只用公开信息：操作记录、摊牌亮出来的牌、分池结果。没亮的底牌一概不用（好友房里别人的也一样，单机的电脑也一样）。
 * 纯函数：规则（好友房）、单机、画面共用。
 */
import { categoryOf, evalCards, QUADS } from './eval.ts';
import type { Card } from './cards.ts';
import type { HandResult, LogEntry } from './table.ts';

/** 摊牌时这个人是不是在诈唬：翻牌以后最后一次下注或加注是他，亮出来只有高牌 */
export function bluffer(log: readonly LogEntry[], seat: number, category: number): boolean {
  if (category !== 0) return false;
  let post = false;
  let who = -1;
  for (const e of log) {
    if (e.seat < 0) post = true;
    else if (post && (e.act === 'bet' || e.act === 'raise')) who = e.seat;
  }
  return who === seat;
}

/** 摊牌亮出来的两家：转牌时谁大（四张公共牌 + 两张底牌） */
const onTurn = (hole: readonly Card[], board: readonly Card[]): number => evalCards([...hole, ...board.slice(0, 4)]);

/** 河牌逆转的那个人：一个人赢了主池，可转牌时亮出来的另一家比他大。没有就是 null */
export function riverTurnaround(r: HandResult): number | null {
  if (r.byFold || r.board.length < 5 || r.shown.length < 2) return null;
  const main = r.pots[0]?.winners ?? [];
  if (main.length !== 1) return null;
  const w = r.shown.find((s) => s.seat === main[0]!.seat);
  if (!w) return null;
  const mine = onTurn(w.hole, r.board);
  return r.shown.some((s) => s.seat !== w.seat && onTurn(s.hole, r.board) > mine) ? w.seat : null;
}

/**
 * 这个人这一手一共投了多少（按操作记录算）：每一轮里下注、加注记的是"加到多少"，跟注是"跟了多少"，盲注是交了多少；
 * 没人跟的那部分退回来的减掉
 */
export function invested(log: readonly LogEntry[], seat: number, r: HandResult): number {
  let total = 0;
  let street = 0;
  for (const e of log) {
    if (e.seat < 0) {
      total += street;
      street = 0;
    } else if (e.seat === seat) {
      if (e.act === 'sb' || e.act === 'bb' || e.act === 'bet' || e.act === 'raise') street = e.amount;
      else if (e.act === 'call') street += e.amount;
    }
  }
  return total + street - (r.uncalled?.seat === seat ? r.uncalled.amount : 0);
}

/** 一份里攒的数（存在单机的存档、好友房的房间状态里） */
export interface Fame {
  /** 发到牌的手数、拿到池子的手数 */
  hands: number;
  wins: number;
  /** 最大一把净赢（赢回的 − 这一手投的），没赢过是 0 */
  best: number;
  /** 摊牌亮出来的诈唬、河牌逆转、亮出四条以上、跟注次数 */
  bluffs: number;
  rivers: number;
  quads: number;
  calls: number;
}

export const NO_FAME: Fame = { hands: 0, wins: 0, best: 0, bluffs: 0, rivers: 0, quads: 0, calls: 0 };

/** 一手打完：这个座位这一手的数加进去（log 是这一手完整的记录；这一手没他就原样返回） */
export function noteHand(f: Fame, r: HandResult, log: readonly LogEntry[], seat: number): Fame {
  if (!log.some((e) => e.seat === seat)) return f;
  const won = r.pots.reduce((a, p) => a + (p.winners.find((w) => w.seat === seat)?.won ?? 0), 0);
  const shown = r.byFold ? undefined : r.shown.find((s) => s.seat === seat);
  return {
    hands: f.hands + 1,
    wins: f.wins + (won > 0 ? 1 : 0),
    best: Math.max(f.best, won - invested(log, seat, r)),
    bluffs: f.bluffs + (shown && bluffer(log, seat, categoryOf(shown.value)) ? 1 : 0),
    rivers: f.rivers + (riverTurnaround(r) === seat ? 1 : 0),
    quads: f.quads + (shown && categoryOf(shown.value) >= QUADS ? 1 : 0),
    calls: f.calls + log.filter((e) => e.seat === seat && e.act === 'call').length,
  };
}

/** 平台 settle 的 stats（5.10）：JSON 后 ≤ 256 字节；不合格平台整份忽略、钱照常结 */
export interface SettleStats {
  rounds: number;
  wins: number;
  best: number;
  titles?: string[];
  sum?: Record<string, number>;
}

/**
 * 称号（id 和 public/titles.json 对上；一份里拿到的，最多 5 个）。net 是这一份结回的 − 带上桌的，max 是这一档的一份。
 * 加新称号只往后加 id，名字写进 public/titles.json（平台的称号墙读它）
 */
export const TITLES = {
  bluff_king: (f: Fame) => f.bluffs >= 1,
  river_god: (f: Fame) => f.rivers >= 1,
  quads: (f: Fame) => f.quads >= 1,
  call_station: (f: Fame) => f.calls >= 30,
  iron_man: (f: Fame) => f.hands >= 300,
  big_winner: (f: Fame, net: number, max: number) => net >= max,
  money_boy: (f: Fame, net: number, max: number) => net <= -max,
} as const satisfies Record<string, (f: Fame, net: number, max: number) => boolean>;

export function settleStats(f: Fame, net: number, max: number): SettleStats {
  const titles = Object.entries(TITLES)
    .filter(([, ok]) => ok(f, net, max))
    .map(([id]) => id)
    .slice(0, 5);
  const sum: Record<string, number> = {};
  if (f.bluffs) sum.bluffs = f.bluffs;
  if (f.rivers) sum.rivers = f.rivers;
  return {
    rounds: f.hands,
    wins: f.wins,
    best: Math.max(0, f.best),
    ...(titles.length ? { titles } : {}),
    ...(Object.keys(sum).length ? { sum } : {}),
  };
}

/**
 * 这一手每个座位投进去多少（从操作记录累加：盲注、bet/raise 是"这条街加到多少"，取代本街原值；call 是"本次跟了多少"，累加；公共牌分街）。
 * 一手打完时座位上的 total 不一定还是本手的投入（筹码已分完），所以从记录算
 */
export function putIn(log: readonly LogEntry[]): Map<number, number> {
  const put = new Map<number, number>();
  let street = new Map<number, number>();
  const settle = (): void => {
    for (const [s, v] of street) put.set(s, (put.get(s) ?? 0) + v);
    street = new Map();
  };
  for (const e of log) {
    if (e.seat < 0) settle();
    else if (e.act === 'sb' || e.act === 'bb' || e.act === 'bet' || e.act === 'raise') street.set(e.seat, e.amount);
    else if (e.act === 'call') street.set(e.seat, (street.get(e.seat) ?? 0) + e.amount);
  }
  settle();
  return put;
}
