/**
 * 好友房锦标赛的结束页和淘汰提示的内容（0.24.0，DESIGN.md 14.3）：只摆文字，名次、奖金都是房间算好的（RoomView.tour）。
 * 样式在 tour.css（限定在 .dialog 下，和单机的结束页共用 tour-sum 那一套）。
 */
import { el } from './dom.ts';
import { chips } from './text.ts';

export interface TourRow {
  name: string;
  /** 整场 6 人里的名次 */
  place: number;
  /** 实盘的奖金；娱乐是 null */
  prize: number | null;
  me: boolean;
}

export interface TourEnd {
  /** 我的名次；旁观的人是 null */
  place: number | null;
  /** 我的奖金（实盘，我是选手）；娱乐、旁观是 null */
  prize: number | null;
  fun: boolean;
  /** 我是选手（要写奖金那一行） */
  played: boolean;
  /** 真人名次表，名次靠前的在前 */
  rows: TourRow[];
  champion: string;
}

export function tourEndBody(i: TourEnd): HTMLElement {
  const body = el('div', 'tour-sum');
  el('div', 'tour-place', body, i.place === null ? `冠军 ${i.champion}` : `第 ${i.place} 名`);
  if (i.played) el('div', 'tour-prize', body, i.fun ? '娱乐赛：筹码不算数' : `结回钱包 ${chips(i.prize ?? 0)}`);
  const list = el('ol', 'tour-top', body);
  for (const r of i.rows) {
    const li = el('li', r.me ? 'me' : '', list);
    el('b', '', li, `第 ${r.place} 名`);
    el('span', '', li, r.me ? `${r.name}（你）` : r.name);
    if (r.prize !== null) el('span', 'tour-row-prize', li, `奖金 ${chips(r.prize)}`);
  }
  el('div', 'sum-note', body, '真人名次表：奖池只在真人之间按名次分，电脑不拿奖');
  return body;
}

/** 我被淘汰了（打完前）：名次已经定了，问看到结束还是现在离开 */
export function tourOutBody(place: number, fun: boolean): HTMLElement {
  const body = el('div', 'tour-out');
  el('p', 'tour-out-place', body, `你拿了第 ${place} 名`);
  el('p', '', body, fun ? '娱乐赛，筹码不算数。' : '打完按名次结奖金，直接结回钱包，不用你在线。');
  el('p', 'sum-note', body, '看到结束：留在房间看谁拿冠军。现在离开：直接回大厅，名次和奖金不变。');
  return body;
}
