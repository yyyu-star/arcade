/**
 * 好友动态里的名场面（0.15.0，仓库根 docs/social.md 第 2 节、docs/platform-backend.md 15.17）：一副打完时从已有的名场面（highlights.ts，只用公开信息）里挑和我有关的，
 * 经 kit 的 `postMoment` 报给平台；平台按 `public/moments.json` 的模板拼成"老王炸上炸，压住了对面的炸弹"给好友看。
 * 只报编号和数字（不报名字以外的任何东西，名字平台按账号填）；一局（打到 A 或者一场好友房）最多报 FEED_MAX 条、同一种只报一次。
 * 挑哪条是纯函数（tests/feed.test.ts）；发不发（有平台、已登录、娱乐、不是旁观）由调用方管。
 */
import type { Highlight } from './highlights.ts';

/** 一局最多报几条：平台每人每天 10 条是所有游戏合计，掼蛋一局不占太多 */
export const FEED_MAX = 2;

/** 名场面 → 动态编号（public/moments.json 的键；只往后加、不改）。按"是不是我的"分两种：我本人做到的，和我这一队做到的 */
const MINE: Partial<Record<Highlight['kind'], string>> = { jokerBomb: 'joker_bomb', bombOnBomb: 'bomb_on_bomb', bombs3: 'bombs', quick: 'quick' };
const OURS: Partial<Record<Highlight['kind'], string>> = { comeback: 'comeback', doubleDown: 'double_down' };

export interface FeedMoment {
  moment: string;
  n?: number;
}

/**
 * 这一副报哪条：按 highlights 的精彩程度挑第一条和我（画面座位 0）或我这一队有关、这一局还没报过的；一副最多一条，这一局报够了就不报
 */
export function feedPick(hl: readonly Highlight[], posted: readonly string[]): FeedMoment | null {
  if (posted.length >= FEED_MAX) return null;
  for (const h of hl) {
    const id = h.seat === 0 ? (MINE[h.kind] ?? OURS[h.kind]) : h.seat % 2 === 0 ? OURS[h.kind] : undefined;
    if (!id || posted.includes(id)) continue;
    return h.n === undefined ? { moment: id } : { moment: id, n: h.n };
  }
  return null;
}
