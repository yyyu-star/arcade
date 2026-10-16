/**
 * 听牌提示：打掉某张（或现在这手）听哪些牌、每种还剩几张。
 * "还剩"只按这个座位看得见的算：4 - 自己手里的 - 桌上亮出来的（弃牌、副露、胡了亮的牌），
 * 不看别人手里和牌墙的真实情况（视图里也没有），所以联机时浏览器自己算、服务端不用多给什么。
 */
import { visibleCounts } from '../../../ai/xuezhan.ts';
import { waits } from '../../../core/hand/index.ts';
import { countsOf, kindOf, suitOf, type Tile } from '../../../core/tiles/index.ts';
import { SHAPE, SUITED_KINDS, type XzView } from '../../../core/variants/sichuan-xuezhan/index.ts';

export interface Wait {
  kind: number;
  left: number;
}

/** discard 为 null 是"现在这手"（13 张时）；听不了返回 null */
export function tingOf(v: XzView, discard: Tile | null): Wait[] | null {
  const me = v.me;
  if (!me || (v.phase !== 'turn' && v.phase !== 'claim')) return null;
  const s = v.seats[me.seat]!;
  if (s.won) return null;
  const hand = discard === null ? me.hand : me.hand.filter((t) => t !== discard);
  if (hand.length % 3 !== 1) return null;
  const q = s.que;
  if (q >= 0 && hand.some((t) => suitOf(kindOf(t)) === q)) return null;
  // 四张都在自己手里和碰杠里的那种不算听（胡不了的叫不算叫）。和规则的 tenpaiKinds 一样按打之后的手算：打掉的那张进了河，不算"自己的"
  const own = countsOf([...hand, ...s.melds.flatMap((m) => m.tiles)]);
  const ks = waits(countsOf(hand), s.melds.length, SHAPE, SUITED_KINDS.filter((k) => suitOf(k) !== q && own[k]! < 4));
  if (!ks.length) return null;
  // 打出去的那张也算自己的（落到河里就看得见了），所以用打之前的整手
  const mine = countsOf(me.hand);
  const seen = visibleCounts(v);
  return ks.map((kind) => ({ kind, left: Math.max(0, 4 - mine[kind]! - seen[kind]!) }));
}
