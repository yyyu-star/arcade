/**
 * 立直的颁奖、名场面、好友动态、电脑起哄（川麻那一套见 banter.ts、feed.ts、awards.ts，规矩和频率照它们）：只判定、不碰网络和画面。
 * 只读公开的事：和了的人、放铳的人、役和番（和牌时本来就亮给全桌看）、杠；不读任何人的手牌。电脑出牌（src/ai）不读这里（test/arch.test.ts）。
 * 名场面（一个和只记最响的一个）：役满 > 三倍满以上（含累计役满） > 岭上开花 > 抢杠 > 海底摸月 / 河底捞鱼 > 立直一发；一炮双响记在放铳的人头上。
 */
import type { FunEvent } from 'arcade-kit/fun-logic';
import type { HandScore, RcEvent, RcWin, YakuId } from '../core/variants/riichi/index.ts';
import type { PublicTally } from './awards.ts';
import type { Highlight } from './banter.ts';
import type { FeedMoment } from './feed.ts';

export type RcHighlightId = 'rc_multi2' | 'rc_yakuman' | 'rc_sanbaiman' | 'rc_rinshan' | 'rc_chankan' | 'rc_haitei' | 'rc_houtei' | 'rc_ippatsu';

/** 一个和：谁和的、谁放的铳（自摸 null）、这手的役和点 */
export interface RcWinMoment {
  seat: number;
  from: number | null;
  score: HandScore;
}

const has = (s: HandScore, id: YakuId): boolean => s.yaku.some((y) => y.id === id);
const big = (s: HandScore): boolean => s.yakuman > 0 || s.limit === 'sanbaiman';

/** 这一手最响的名场面；普通的和没有 */
function highlightOf(s: HandScore): Exclude<RcHighlightId, 'rc_multi2'> | null {
  if (s.yakuman > 0 && !s.kazoe) return 'rc_yakuman';
  if (big(s)) return 'rc_sanbaiman';
  if (has(s, 'rinshan')) return 'rc_rinshan';
  if (has(s, 'chankan')) return 'rc_chankan';
  if (has(s, 'haitei')) return 'rc_haitei';
  if (has(s, 'houtei')) return 'rc_houtei';
  if (has(s, 'ippatsu')) return 'rc_ippatsu';
  return null;
}

/** 这一步事件里的和 */
export function rcWinsOf(events: readonly RcEvent[]): RcWinMoment[] {
  return events.flatMap((e) => (e.e === 'win' ? [{ seat: e.seat, from: e.from, score: e.score }] : []));
}

/** 这一步里的名场面（seat 是和的人，一炮双响是放铳的人） */
export function rcHighlightsOf(wins: readonly RcWinMoment[], round: number): Highlight[] {
  const out: Highlight[] = [];
  const from = wins[0]?.from;
  if (wins.length >= 2 && from !== null && from !== undefined) out.push({ id: 'rc_multi2', seat: from, round });
  for (const w of wins) {
    const id = highlightOf(w.score);
    if (id) out.push({ id, seat: w.seat, round });
  }
  return out;
}

type FunMoment = Extract<FunEvent, { kind: 'moment' }>;

/**
 * 电脑起哄（docs/table-fun.md 第 4 节，照川麻的频率）：开杠、岭上开花、跳满以上的大牌、自摸；别人放铳的普通小和不算。
 * 赢的是和、杠的人；输的是放铳的人，自摸和杠是其余三家。kans 是这一步开了杠的座位；hand 是第几局（kit 按它数"每手电脑主动最多 2 次"）。
 */
export function rcFunMoments(wins: readonly RcWinMoment[], kans: readonly number[], hand: number): FunMoment[] {
  const others = (seat: number): number[] => [0, 1, 2, 3].filter((i) => i !== seat);
  const out: FunMoment[] = kans.map((seat) => ({ kind: 'moment', moment: 'kong', winners: [seat], losers: others(seat), hand }));
  for (const w of wins) {
    const s = w.score;
    const moment = has(s, 'rinshan') ? 'gang-flower' : s.yakuman > 0 || ['haneman', 'baiman', 'sanbaiman'].includes(s.limit) ? 'big-win' : w.from === null ? 'self-draw' : null;
    if (moment) out.push({ kind: 'moment', moment, winners: [w.seat], losers: w.from === null ? others(w.seat) : [w.from], hand });
  }
  return out;
}

/** 这一步事件里开了杠的座位 */
export const rcKansOf = (events: readonly RcEvent[]): number[] => events.flatMap((e) => (e.e === 'kan' ? [e.seat] : []));

/** 好友动态里的娱乐名场面（照 feed.ts：只报自己和的、一把只取最响的一个）；数是这一把的番，役满是几倍 */
export function rcFeedMomentsOf(events: readonly RcEvent[], me: number): FeedMoment[] {
  const out: FeedMoment[] = [];
  for (const w of rcWinsOf(events)) {
    if (w.seat !== me) continue;
    const id = highlightOf(w.score);
    if (id) out.push({ moment: id, n: w.score.yakuman > 0 && !w.score.kazoe ? w.score.yakuman : w.score.han });
  }
  return out;
}

/** 颁奖用的公开小计：和了几局、自摸几次（结算里本来就公开）。立直的小计没有杠数，不评杠王 */
export function rcTally(stats: readonly { wins: number; tsumo: number }[]): PublicTally[] {
  return stats.map((x) => ({ wins: x.wins, zimo: x.tsumo, gangs: 0 }));
}

/** 一局结完的小结里的和（房间里电脑起哄用：一批推好几步时只看得到最后一步的事件，按小结补） */
export function rcSummaryWins(wins: readonly RcWin[]): RcWinMoment[] {
  return wins.map((w) => ({ seat: w.seat, from: w.from, score: w.score }));
}
