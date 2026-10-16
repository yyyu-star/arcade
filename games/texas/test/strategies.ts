/**
 * 拿来量电脑的几种"玩家"（DESIGN.md 4.3）：都只看自己的视图，不用蒙特卡洛。
 * - simple：简单合理的打法，相当于认真但不精的新手——起手牌挑一挑，翻牌后看自己用上底牌的成牌，好牌下注、差牌弃；
 * - station：跟注站，什么都跟，从不加注；
 * - jammer：乱全下，随手推光。
 * - novice：小白（docs/balance.md 第 1 节，0.12.0）：见牌就跟、偶尔乱加，只在明显差的时候弃。
 * 电脑要做到：simple 在小桌常赢、越往上越难；station、jammer 每一档都明显输。配平（DESIGN.md 4.10）用 novice 当"小白"、simple 当"普通"。
 */
import type { RandomStream } from 'arcade-kit/rng';
import { rankOf, suitOf, type Card } from '../src/core/cards.ts';
import { categoryOf, evalCards, PAIR, TWO_PAIR } from '../src/core/eval.ts';
import type { Action } from '../src/core/table.ts';
import type { View } from '../src/core/view.ts';

export type Strategy = (v: View, r: RandomStream) => Action;

/** 跟注站：能过就过，不能过就跟 */
export const station: Strategy = (v) => (v.legal!.check ? { t: 'check' } : { t: 'call' });

/** 乱全下：每次说话三成推光，其余能过就过、不能过就一半跟一半弃 */
export const jammer: Strategy = (v, r) => {
  const lg = v.legal!;
  if (r.below(10) < 3 && lg.raise) return { t: 'allin' };
  if (lg.check) return { t: 'check' };
  return r.below(2) === 0 ? { t: 'call' } : { t: 'fold' };
};

/** 这一轮有过几次下注或加注 */
function raises(v: View): number {
  let n = 0;
  for (let i = v.log.length - 1; i >= 0 && v.log[i]!.seat >= 0; i--) if (v.log[i]!.act === 'bet' || v.log[i]!.act === 'raise') n++;
  return n;
}

/** 起手牌分三等：3 好（加注，被再加也跟）、2 能玩（便宜就进）、1 不玩 */
function preflopTier(a: Card, b: Card): number {
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const suited = suitOf(a) === suitOf(b);
  const T = 8, J = 9, Q = 10, K = 11, A = 12;
  if (hi === lo) return lo >= 7 ? 3 : 2; // 99+ 好，小对子能玩
  if (hi === A && lo >= Q) return 3; // AK、AQ
  if (hi === A && (lo >= T || suited)) return 2; // AJ、AT、同花 A
  if (hi === K && lo >= J) return suited || lo === Q ? 2 : 1; // KQ、KJs
  if (suited && hi - lo === 1 && lo >= 4) return 2; // 同花连张 65s+
  if (suited && hi >= J && lo >= T) return 2; // QJs、JTs 这类
  return 1;
}

/** 翻牌后：3 强（两对以上用上了底牌、超对、顶对好踢脚），2 中（用上底牌的一对），1 听同花，0 空气 */
function madeTier(hole: readonly Card[], board: readonly Card[]): number {
  const mine = categoryOf(evalCards([...hole, ...board]));
  const onBoard = board.length >= 5 ? categoryOf(evalCards(board)) : -1;
  const top = Math.max(...board.map(rankOf));
  const [h0, h1] = [rankOf(hole[0]!), rankOf(hole[1]!)];
  if (mine >= TWO_PAIR && mine > onBoard) {
    // 公共牌有对子时的"两对"只是一对，不算强
    const boardPair = new Set(board.map(rankOf)).size < board.length;
    if (!(mine === TWO_PAIR && boardPair && !board.some((c) => rankOf(c) === h0 || rankOf(c) === h1))) return 3;
    return 2;
  }
  if (mine === PAIR || (mine === TWO_PAIR && new Set(board.map(rankOf)).size < board.length)) {
    if (h0 === h1) return h0 > top ? 3 : 2;
    const hit = board.some((c) => rankOf(c) === h0) ? h0 : board.some((c) => rankOf(c) === h1) ? h1 : -1;
    if (hit < 0) return 0; // 对子在公共牌上
    const kicker = hit === h0 ? h1 : h0;
    return hit === top && kicker >= 9 ? 3 : 2;
  }
  if (board.length < 5) {
    for (let s = 0; s < 4; s++) {
      const n = [...hole, ...board].filter((c) => suitOf(c) === s).length;
      if (n === 4 && hole.some((c) => suitOf(c) === s)) return 1;
    }
  }
  return 0;
}

/** 加到池子的 frac‰（按小盲取整，夹在能加的范围里） */
function betPot(v: View, frac: number): Action {
  const lg = v.legal!;
  const to = Math.min(lg.maxTo, Math.max(lg.minTo, Math.floor((v.currentBet + ((v.pot + lg.call) * frac) / 1000) / v.sb) * v.sb));
  return to === lg.maxTo ? { t: 'allin' } : { t: 'raise', to };
}

export const simple: Strategy = (v) => {
  const lg = v.legal!;
  const hole = v.hole;
  const n = raises(v);
  const passive: Action = lg.check ? { t: 'check' } : { t: 'fold' };
  if (v.board.length === 0) {
    const tier = preflopTier(hole[0]!, hole[1]!);
    if (tier === 3) {
      if (n <= 1 && lg.raise) return { t: 'raise', to: Math.min(lg.maxTo, Math.max(lg.minTo, n === 0 ? 3 * v.bb : 3 * v.currentBet)) };
      return lg.check ? { t: 'check' } : { t: 'call' };
    }
    // 能玩的牌：没人加注就跟进（或过牌），有人加注只在跟得不多时跟
    if (tier === 2) return lg.check ? { t: 'check' } : n === 0 || lg.call <= 4 * v.bb ? { t: 'call' } : { t: 'fold' };
    return passive;
  }
  const tier = madeTier(hole, v.board);
  if (tier === 3) {
    if (lg.raise && n <= 1) return betPot(v, 700);
    return lg.check ? { t: 'check' } : { t: 'call' };
  }
  if (lg.check) return tier === 2 && v.board.length === 3 ? betPot(v, 500) : { t: 'check' };
  // 跟注：中等牌跟不超过大半池，听牌只跟小注且河牌前
  const half = lg.call * 1000 <= (v.pot + lg.call) * (tier === 2 ? 400 : 250);
  return (tier === 2 && half && n <= 1) || (tier === 1 && half) ? { t: 'call' } : { t: 'fold' };
};

/** 小白眼里"能玩"的起手牌：对子、带 A、两张都是 8 以上、同花、连张（6 人桌约六成的手） */
function looksPlayable(a: Card, b: Card): boolean {
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  return hi === lo || hi === 12 || lo >= 6 || suitOf(a) === suitOf(b) || hi - lo === 1;
}

/**
 * 小白：只会最直白的打法。翻牌前看着顺眼的牌（looksPlayable）都跟，明显的烂牌要花钱才弃；被加到 4 个大盲以上时烂牌（tier 1）一半弃、好牌三成加注；
 * 翻牌后两对以上（用上了底牌）什么都跟、偶尔下注；一对跟到一个池子那么大，再大一半弃；听牌跟到大半池；什么都没有的跟到三分之一池。
 * 能加注时 6% 乱加一次（最小加注）。随机只用传进来的流（带种子，可复现）
 */
export const novice: Strategy = (v, r) => {
  const lg = v.legal!;
  if (lg.raise && r.below(100) < 6) return lg.minTo >= lg.maxTo ? { t: 'allin' } : { t: 'raise', to: lg.minTo };
  if (v.board.length === 0) {
    const tier = preflopTier(v.hole[0]!, v.hole[1]!);
    if (tier === 3 && lg.raise && raises(v) <= 1 && r.below(10) < 3) return betPot(v, 1000);
    if (lg.check) return { t: 'check' };
    if (!looksPlayable(v.hole[0]!, v.hole[1]!)) return { t: 'fold' };
    if (tier === 1 && lg.call > 4 * v.bb && r.below(2) === 0) return { t: 'fold' };
    return { t: 'call' };
  }
  const tier = madeTier(v.hole, v.board);
  if (lg.check) return tier === 3 && lg.raise && r.below(10) < 4 ? betPot(v, 500) : { t: 'check' };
  // 要跟的占（池子 + 要跟的）的千分比：半池注 250、满池注 333、两倍池 400
  const share = Math.floor((lg.call * 1000) / (v.pot + lg.call));
  if (tier === 3) return { t: 'call' };
  if (tier === 2) return share <= 334 || r.below(2) === 0 ? { t: 'call' } : { t: 'fold' };
  if (tier === 1) return share <= 290 ? { t: 'call' } : { t: 'fold' };
  return share <= 200 ? { t: 'call' } : { t: 'fold' };
};

export const STRATEGIES: Record<string, Strategy> = { simple, station, jammer, novice };
