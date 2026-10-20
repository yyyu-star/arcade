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
  // 奖金按真人之间的名次分：大字写真人里第几，全桌名次（含电脑）放小字，免得"第 5 名拿全部奖池"看着像算错
  const mine = i.rows.findIndex((r) => r.me);
  if (i.place === null || mine < 0) el('div', 'tour-place', body, `冠军 ${i.champion}`);
  else {
    el('div', 'tour-place', body, i.rows.length > 1 ? `真人第 ${mine + 1} 名` : `第 ${i.place} 名`);
    if (i.rows.length > 1) el('div', 'sum-note', body, `全桌第 ${i.place} 名（含电脑）`);
  }
  if (i.played) el('div', 'tour-prize', body, i.fun ? '娱乐赛：筹码不算数' : `结回钱包 ${chips(i.prize ?? 0)}`);
  const list = el('ol', 'tour-top', body);
  for (const [k, r] of i.rows.entries()) {
    const li = el('li', r.me ? 'me' : '', list);
    el('b', '', li, `第 ${k + 1} 名`);
    el('span', '', li, r.me ? `${r.name}（你）` : r.name);
    if (r.prize !== null) el('span', 'tour-row-prize', li, `奖金 ${chips(r.prize)}`);
  }
  // 娱乐赛没有奖池，这句只给实盘（0.25.2）
  if (!i.fun) el('div', 'sum-note', body, '奖池只在真人之间按名次分，电脑不拿奖');
  return body;
}

/** 我被淘汰了（打完前）：名次已经定了，问看到结束还是现在离开 */
export function tourOutBody(place: number, fun: boolean): HTMLElement {
  const body = el('div', 'tour-out');
  el('p', 'tour-out-place', body, `你出局了：全桌第 ${place} 名`);
  el('p', '', body, fun ? '娱乐赛，筹码不算数。' : '打完按名次结奖金，直接结回钱包，不用你在线。');
  el('p', 'sum-note', body, '看到结束：留在房间看谁拿冠军。现在离开：直接回大厅，名次和奖金不变。');
  return body;
}
