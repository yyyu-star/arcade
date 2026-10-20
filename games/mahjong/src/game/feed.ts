/**
 * 好友动态里的娱乐名场面（docs/platform-backend.md 15.17 第 2 条，DESIGN.md 第 6 节）：只判定、不碰网络，画面层读事件后经 kit 的 postMoment 报。
 * 只报自己胡的、真正值得炫的（一把只取最响的那个），数是这一把的番；文字模板在 public/moments.json（平台按编号拼，这里只给编号和数）。
 * 一炮多响记在点炮的人头上，不报；实盘的由平台在结回时自己生成，这里只管娱乐局。
 */
import type { FanId, XzEvent } from '../core/variants/sichuan-xuezhan/index.ts';
import type { RcHighlightId } from './riichi-fun.ts';

/** 川麻的六个，加上立直的（game/riichi-fun.ts，一炮双响不进动态） */
export type FeedMomentId = 'tiandi' | 'longqidui' | 'qing' | 'gangkai' | 'haidi' | 'qidui' | Exclude<RcHighlightId, 'rc_multi2'>;

export interface FeedMoment {
  moment: FeedMomentId;
  /** 这一把的番 */
  n: number;
}

/** 番型 → 名场面编号，越靠前越响（一把只取一个） */
const ORDER: [readonly FanId[], FeedMomentId][] = [
  [['tianhu', 'dihu'], 'tiandi'],
  [['longqidui'], 'longqidui'],
  [['qing'], 'qing'],
  [['gangkai'], 'gangkai'],
  [['haidi'], 'haidi'],
  [['qidui'], 'qidui'],
];

/** 一场里最多报几条：别刷屏（平台每人每天也只收 10 条） */
export const FEED_PER_MATCH = 2;

/** 这一步的事件里，me 自己胡出来的名场面 */
export function feedMomentsOf(events: readonly XzEvent[], me: number): FeedMoment[] {
  const out: FeedMoment[] = [];
  for (const e of events) {
    if (e.e !== 'hu' || e.seat !== me) continue;
    const hit = ORDER.find(([fans]) => e.items.some((x) => fans.includes(x.id)));
    if (hit) out.push({ moment: hit[1], n: e.fan });
  }
  return out;
}

/** 这一场要报哪些：同一个名场面只报第一次，一场最多 FEED_PER_MATCH 条。sent 是这一场已经报过的编号 */
export function toReport(found: readonly FeedMoment[], sent: readonly FeedMomentId[]): FeedMoment[] {
  const out: FeedMoment[] = [];
  const seen = new Set(sent);
  for (const f of found) {
    if (seen.size >= FEED_PER_MATCH) break;
    if (seen.has(f.moment)) continue;
    seen.add(f.moment);
    out.push(f);
  }
  return out;
}
