/**
 * 听牌提示（沿用川麻的做法）：打掉某张（或现在这手）听哪些牌、每种还剩几张。
 * "还剩"只按这个座位看得见的算：4 − 自己手里的 − 桌上亮出来的（河里没被拿走的、所有副露、宝牌指示牌），
 * 不看别人手里和牌墙的真实情况（视图里也没有）。
 */
import { countsOf, kindOf, type Tile } from '../../../core/tiles/index.ts';
import { waitsOf, type RcView } from '../../../core/variants/riichi/index.ts';

export interface Wait {
  kind: number;
  left: number;
}

/** 桌上亮出来的牌：被拿走的河牌已经算在副露、和牌里了 */
export function visibleCounts(v: RcView): number[] {
  const c = new Array<number>(34).fill(0);
  for (const s of v.seats) {
    for (const r of s.river) if (!r.taken) c[kindOf(r.tile)]!++;
    for (const m of s.melds) for (const t of m.tiles) c[kindOf(t)]!++;
  }
  for (const t of v.dora) c[kindOf(t)]!++;
  return c;
}

/** discard 为 null 是"现在这手"（13 张时）；听不了返回 null */
export function tingOf(v: RcView, discard: Tile | null): Wait[] | null {
  const me = v.me;
  if (!me || (v.phase !== 'turn' && v.phase !== 'claim')) return null;
  const s = v.seats[me.seat]!;
  const hand = discard === null ? me.hand : me.hand.filter((t) => t !== discard);
  if (hand.length % 3 !== 1) return null;
  // 四张都在自己手里和副露里的那种不算听（和规则的 tenpaiKinds 一样）
  const own = countsOf([...hand, ...s.melds.flatMap((m) => m.tiles)]);
  const ks = waitsOf(countsOf(hand), s.melds.length).filter((k) => own[k]! < 4);
  if (!ks.length) return null;
  // 打出去的那张也算自己的（落到河里就看得见了），所以用打之前的整手
  const mine = countsOf(me.hand);
  const seen = visibleCounts(v);
  return ks.map((kind) => ({ kind, left: Math.max(0, 4 - mine[kind]! - seen[kind]!) }));
}
