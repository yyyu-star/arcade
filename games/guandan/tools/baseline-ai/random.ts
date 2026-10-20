/**
 * 随机出牌机器人：模拟器里当基准对手。只要合法，什么都可能出；跟牌时"不要"和各种压法等概率。
 */
import { canPass, legalPlays, rngFor, type Action, type PlayerView } from '../../src/variants/guandan/core/index.ts';

export function randomAction(view: PlayerView, seed: string | number): Action | null {
  const rng = rngFor(seed, 'random-bot', view.seat, view.step);
  if (view.myTribute) {
    const card = rng.pick(view.myTribute.allowed);
    return view.myTribute.kind === 'tribute' ? { type: 'tribute', seat: view.seat, card } : { type: 'return', seat: view.seat, card };
  }
  if (view.phase !== 'play' || view.turn !== view.seat) return null;
  const plays = legalPlays(view);
  const pass = canPass(view);
  const n = plays.length + (pass ? 1 : 0);
  const i = rng.int(n);
  if (i >= plays.length) return { type: 'pass', seat: view.seat };
  const p = plays[i]!;
  return { type: 'play', seat: view.seat, cards: p.cards, as: { type: p.type, rank: p.rank, extra: p.extra } };
}
