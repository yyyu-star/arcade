/**
 * 排行榜的分数公式和"这一局该交哪几个榜"（DESIGN.md 5.7）。越大越好，平台只收 |分数| ≤ 1e12 的安全整数。
 *
 * | 榜 | 分数 |
 * | vigil 守夜总榜 | 危险档 × 1e10 + 秒数 × 1e4 + 击杀（击杀 < 1e4）；打倒尸王算撑满 900 秒再加 100 秒 |
 * | raid 夜探总榜 | 单局撤出的宝物价值（铜钱） |
 * | endless 无尽 | 秒数 × 1e4 + 击杀 |
 * | 每日守夜 | 撑到天亮：1e6 + 击杀；没撑到：撑了多少秒（所以"天亮"都排在没撑到的前面，daily.json 能直接写成文字） |
 * | 每日夜探 | 单局撤出的宝物价值 |
 */
import { dailyBoardId, dailyDateOpen } from './daily.ts';
import type { RunSummary } from './types.ts';

export const VIGIL_FULL_SECONDS = 900;
export const BOSS_BONUS_SECONDS = 100;
export const DAILY_WIN_BASE = 1_000_000;
const KILL_CAP = 9_999;
const ENDLESS_SECOND_CAP = 99_999;

const nat = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.trunc(x)) : 0);

/** 守夜总榜 */
export function vigilScore(o: { danger: number; seconds: number; kills: number; bossKilled: boolean }): number {
  const danger = Math.min(5, nat(o.danger));
  const secs = o.bossKilled ? VIGIL_FULL_SECONDS + BOSS_BONUS_SECONDS : Math.min(VIGIL_FULL_SECONDS, nat(o.seconds));
  return danger * 1e10 + secs * 1e4 + Math.min(KILL_CAP, nat(o.kills));
}

export function decodeVigil(score: number): { danger: number; seconds: number; kills: number } {
  const s = nat(score);
  return { danger: Math.floor(s / 1e10), seconds: Math.floor((s % 1e10) / 1e4), kills: s % 1e4 };
}

/** 无尽榜 */
export function endlessScore(o: { seconds: number; kills: number }): number {
  return Math.min(ENDLESS_SECOND_CAP, nat(o.seconds)) * 1e4 + Math.min(KILL_CAP, nat(o.kills));
}

export function decodeEndless(score: number): { seconds: number; kills: number } {
  const s = nat(score);
  return { seconds: Math.floor(s / 1e4), kills: s % 1e4 };
}

/** 夜探：带出的宝物价值 */
export function raidScore(loot: number): number {
  return Math.min(999_999_999, nat(loot));
}

/** 每日守夜 */
export function dailyVigilScore(o: { won: boolean; seconds: number; kills: number }): number {
  return o.won ? DAILY_WIN_BASE + Math.min(DAILY_WIN_BASE - 1, nat(o.kills)) : Math.min(DAILY_WIN_BASE - 1, nat(o.seconds));
}

/** 分数在榜上怎么显示（每日榜平台自己按 daily.json 写，这里管总榜） */
export function formatScore(board: BoardKind, score: number): string {
  const n = (x: number): string => x.toLocaleString('zh-CN');
  const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  switch (board) {
    case 'vigil': {
      const d = decodeVigil(score);
      return `危险${d.danger} · ${mmss(d.seconds)} · 斩${n(d.kills)}`;
    }
    case 'endless': {
      const d = decodeEndless(score);
      return `${mmss(d.seconds)} · 斩${n(d.kills)}`;
    }
    case 'raid':
      return `${n(score)} 铜钱`;
    case 'daily-vigil':
      return score >= DAILY_WIN_BASE ? `天亮 · 斩${n(score - DAILY_WIN_BASE)}` : `撑了 ${mmss(score)}`;
    case 'daily-raid':
      return `${n(score)} 铜钱`;
  }
}

export type BoardKind = 'vigil' | 'raid' | 'endless' | 'daily-vigil' | 'daily-raid';

export interface Submission {
  board: BoardKind;
  boardId: string;
  score: number;
}

/**
 * 这一局该往哪几个榜交什么分（空数组 = 不交）：
 * - 实盘不交；认输的不交（没打完不算成绩；无尽本来就是打到不想打为止，认输照交）；
 * - 每日挑战只交当天的每日榜（不进总榜：咒印让它和普通局不可比）；日期过了平台收的范围（昨天到明天）也不交；
 * - 开了"降低伤害"的普通局不交总榜（每日挑战是对谁都一样的固定局，没有这个开关，开了也不交）；
 * - 守夜普通局：vigil；开了无尽的：endless；夜探：raid（没撤出的 loot 为 0，不交）。
 */
export function submissionsFor(r: RunSummary, today: string): Submission[] {
  if (r.live || r.reducedDamage || (r.quit && !r.setup.endless)) return [];
  const s = r.setup;
  if (r.daily) {
    if (!dailyDateOpen(r.daily, today)) return [];
    if (s.mode === 'vigil') return [{ board: 'daily-vigil', boardId: dailyBoardId(r.daily, 'vigil'), score: dailyVigilScore(r) }];
    return r.loot > 0 ? [{ board: 'daily-raid', boardId: dailyBoardId(r.daily, 'raid'), score: raidScore(r.loot) }] : [];
  }
  if (s.mode === 'raid') return r.loot > 0 ? [{ board: 'raid', boardId: 'raid', score: raidScore(r.loot) }] : [];
  if (s.endless) return [{ board: 'endless', boardId: 'endless', score: endlessScore(r) }];
  return [{ board: 'vigil', boardId: 'vigil', score: vigilScore({ danger: s.danger, seconds: r.seconds, kills: r.kills, bossKilled: r.bossKilled }) }];
}

/** 榜名 → 分数（录像的"每榜最好一局"用它比；不上榜的局是空对象） */
export function scoresOfRun(r: RunSummary, today: string): Record<string, number> {
  return Object.fromEntries(submissionsFor(r, today).map((s) => [s.boardId, s.score]));
}
