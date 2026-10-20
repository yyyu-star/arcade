/**
 * 画面上"提示"按钮轮换的列表：首条是高手（困难电脑）的出法，后面接核心 hint 的全部合法出法（去重）。
 * 高手判断该让时（比如队友的牌已经够大），首条是 null = "建议不要"，绝不能让炸队友的牌排在最前面。
 */
import { canPass, hint, samePlayShape, type Play, type PlayerView } from '../core/index.ts';
import { suggest } from './bot.ts';

export function hintList(view: PlayerView, seed: string | number): (Play | null)[] {
  const plays = hint(view);
  if (plays.length === 0) return [];
  const smart = suggest(view, seed);
  const list: (Play | null)[] = [];
  if (smart) list.push(smart);
  else if (canPass(view)) list.push(null);
  for (const p of plays) {
    const dup = list.some((q) => q !== null && q.cards.length === p.cards.length && samePlayShape(p, q) && q.cards.every((c) => p.cards.includes(c)));
    if (!dup) list.push(p);
  }
  return list;
}
