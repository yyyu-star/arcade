/** 搭子战绩（0.19.0，docs/platform-backend.md 15.19）的文字和"最佳搭档"怎么挑：好友页和战绩页共用。 */
import type { Together } from './api.ts';

/** "一起打了 23 场 · 你赢 12 · 他赢 9"；做过搭档的加上"搭档 8 场赢 6" */
export function togetherText(t: Together): string {
  const parts = [`一起打了 ${t.n} 场`, `你赢 ${t.wins}`, `TA 赢 ${t.theirWins}`];
  if (t.teamN > 0) parts.push(`搭档 ${t.teamN} 场赢 ${t.teamWins}`);
  return parts.join(' · ');
}

/** 做搭档至少几场才评"最佳搭档"：一两场看不出来 */
export const BEST_MIN_TEAM = 3;

/** teamN ≥ 3 里 teamWins 最多的，平了取 teamN 多的；一个都不够就没有 */
export function bestPartner<T extends { userId: string; together?: Together }>(friends: T[]): string | null {
  let best: T | null = null;
  for (const f of friends) {
    const t = f.together;
    if (!t || t.teamN < BEST_MIN_TEAM) continue;
    const b = best?.together;
    if (!b || t.teamWins > b.teamWins || (t.teamWins === b.teamWins && t.teamN > b.teamN)) best = f;
  }
  return best?.userId ?? null;
}
