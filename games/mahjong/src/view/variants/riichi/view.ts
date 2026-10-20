/**
 * 立直的视图接到公共牌桌上（view/table.ts 的 TableView）：牌桌要 round、opts.rounds、每家的 won，日麻的视图里没有，这里补。
 * 只是换个形状，不算任何规则。
 * 一局结束停着的时候，规则核心已经换到下一局的庄家和自风了；名牌上的"庄"和自风要和结算列表一样，按刚打完的这一局摆。
 */
import type { RcView, SeatView } from '../../../core/variants/riichi/index.ts';
import type { Tile } from '../../../core/tiles/index.ts';

type Won = { fan: number; from: number | null; tile: Tile; order: number };

export interface RcTable extends RcView {
  /** 第几局（牌桌靠它认出新的一局、清掉河里的动画记录）：结算停着的时候还算刚打完的那一局，不跳 */
  round: number;
  opts: RcView['opts'] & { rounds: number };
  seats: (SeatView & { won: Won | null })[];
}

/** 庄家是 dealer 时 seat 的自风（0–3 东南西北）：名牌和结算列表都用它，两边对得上 */
export const windOf = (dealer: number, seat: number): number => (seat - dealer + 4) % 4;

/** 一局结束（结算停着，或一场结束）时，视图里最后一条小结就是刚打完的这一局 */
export const ended = (v: RcView): boolean => v.phase === 'end' || v.phase === 'over';

export function tableView(v: RcView): RcTable {
  const last = ended(v) ? v.history.at(-1) : undefined;
  const round = v.history.length - (last ? 1 : 0);
  const seats = v.seats.map((s, i) => {
    const w = last?.wins.findIndex((x) => x.seat === i) ?? -1;
    const win = w >= 0 ? last!.wins[w]! : null;
    const wind = last ? windOf(last.dealer, i) : s.wind;
    return { ...s, wind, won: win ? { fan: win.score.yakuman ? 13 : win.score.han, from: win.from, tile: win.tile, order: w } : null };
  });
  return { ...v, round, dealer: last ? last.dealer : v.dealer, opts: { ...v.opts, rounds: v.opts.length === 'hanchan' ? 8 : 4 }, seats };
}
