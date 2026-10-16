/**
 * 好友房的乐子（0.3.0，DESIGN.md 13.4）：嘲讽短语、顺手提示、屏蔽。
 * 房间只转发短语编号（kit 的 emote），文字在这里；只说牌局和打法，不说人（不涉及长相、家人、地域、性别，不带脏字）。
 * 顺手提示只看公开事件（谁赢了、怎么赢的、亮出来的牌），不碰没亮的底牌。
 */
import { categoryOf } from '../core/eval.ts';
import type { HandResult, LogEntry } from '../core/table.ts';
import { KEYS } from '../store.ts';
import { bluffer } from './talk.ts';
import { riverTurnaround } from './titles.ts';
import { TAUNTS } from '../fun/taunts.ts';

export { TAUNTS };

const T = (s: (typeof TAUNTS)[number]): number => TAUNTS.indexOf(s);

/**
 * 一手打完、我坐在桌上：按这一手公开发生的事，给 1–2 句合适的嘲讽（编号），一点就发。没什么好说的回空
 */
export function suggest(r: HandResult, log: readonly LogEntry[], me: number): number[] {
  const won = r.pots.some((p) => p.winners.some((w) => w.seat === me));
  if (r.byFold) {
    const last = log.findLast((e) => e.act === 'bet' || e.act === 'raise');
    return won && last?.seat === me ? [T('就这？'), T('谢谢老板')] : [];
  }
  if (!r.shown.some((s) => s.seat === me)) return [];
  if (won) {
    // 别人亮出来是诈唬、被我抓了
    const caught = r.shown.some((s) => s.seat !== me && bluffer(log, s.seat, categoryOf(s.value)));
    if (caught) return [T('你在诈唬，我看出来了'), T('谢谢老板')];
    return riverTurnaround(r) === me ? [T('手气来了挡不住'), T('谢谢老板')] : [T('谢谢老板'), T('再来！')];
  }
  return riverTurnaround(r) !== null ? [T('运气而已，别骄傲'), T('再来！')] : [T('好牌，服了'), T('下一把轮到我了')];
}

const KEY = KEYS.fun;

export interface FunPrefs {
  /** 不看嘲讽和道具（总开关；电脑说话也一起收起） */
  off: boolean;
  /** 屏蔽了谁（好友房里的昵称） */
  muted: string[];
}

export function loadFun(store: Storage): FunPrefs {
  try {
    const p = JSON.parse(store.getItem(KEY) ?? 'null') as Partial<FunPrefs> | null;
    return { off: p?.off === true, muted: Array.isArray(p?.muted) ? p.muted.filter((x): x is string => typeof x === 'string').slice(0, 50) : [] };
  } catch {
    return { off: false, muted: [] };
  }
}

export function saveFun(store: Storage, p: FunPrefs): void {
  try {
    store.setItem(KEY, JSON.stringify(p));
  } catch {
    // 存不上：这一次还按改过的算，刷新后回到原样
  }
}
