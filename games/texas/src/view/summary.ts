/**
 * 一场打完的结算页（0.1.1，试玩反馈："离桌直接回到标题页，只看到余额变了"）：单机离桌、好友房离开或房间关了时弹出。
 * 写清带上桌多少、结回多少、这一场 +/−，打了几手、赢了几手、最大的一手；到顶、输光各一句温和的话。
 * 只有一个"回标题"按钮，不放"再来一场"（快乐为主、不诱导，docs/economy.md 第 0 节）。
 * 0.18.4（美术 v3 第 5 步）：最上面一块大字写这一场 +/−，赢了金色带光、输了一句宽心话，不再和别的行长得一样。
 */
import { dialog } from './dialog.ts';
import { el } from './dom.ts';
import type { Award } from './titles.ts';
import { chips, handName } from './text.ts';

export interface SoloSummary {
  practice: boolean;
  buyin: number;
  /** 结回钱包的（娱乐桌是剩下的筹码）；还没结回去（钱包连不上、登录过期）或者钱包拒了时为 null */
  out: number | null;
  /** 还没结回去时括号里说什么，默认"连上后自动结回" */
  pending?: string;
  /** 钱包拒了这一笔结回（0.3.3）：按平台 15.10 说清楚，比如放太久已经原样退回 */
  refused?: string;
  /** 牌桌上剩下、本该结回的（到顶时 out 比它少） */
  left: number;
  hands: number;
  won: number;
  best: { won: number; value: number | null } | null;
  /** 今天德州进账到顶、没进钱包的 */
  capped: number;
  busted: boolean;
  /** 这一场的称号（0.3.0 实打后单机也给；算法和好友房一样） */
  titles?: Title[];
  /** "分享"按钮（0.14.0，kit 的分享卡）：不给就不出（单独部署、还没打完一手） */
  share?: () => void;
}

export interface Title {
  title: string;
  name: string;
  why: string;
}

export interface RoomSummaryRow {
  name: string;
  net: number;
  me: boolean;
}

/** 单机：离桌以后的这一场 */
export function soloSummary(parent: HTMLElement, s: SoloSummary): Promise<unknown> {
  const body = el('div', 'summary');
  const net = s.left - s.buyin;
  hero(body, net, s.hands > 0);
  const grid = el('div', 'sum-grid', body);
  row(grid, '带上桌', chips(s.buyin));
  row(grid, s.practice ? '剩下' : '结回钱包', s.refused ? '没结上' : s.out === null ? `${chips(s.left)}（${s.pending ?? '连上后自动结回'}）` : chips(s.practice ? s.left : s.out));
  row(grid, '打了', s.hands ? `${s.hands} 手，赢了 ${s.won} 手` : '还没打完一手');
  if (s.best) row(grid, '最大的一手', `${s.best.value === null ? '别人都弃牌' : handName(s.best.value)}，赢 ${chips(s.best.won)}`);
  const notes: string[] = [];
  if (s.refused) notes.push(s.refused);
  if (s.practice) notes.push('娱乐桌的筹码不算数，不进钱包。');
  if (s.capped > 0) notes.push(`今天单机实盘赢够了，多出的 ${chips(s.capped)} 没进钱包；好友房不限，娱乐模式照常玩。`);
  if (s.busted) notes.push(s.practice ? '这一桌的筹码打完了，想玩随时再开一桌。' : '这一桌打完了。歇一会儿吧：钱包快空了的话每天能领一次补给，娱乐模式随时能玩。');
  titleBox(body, s.titles ?? []);
  for (const n of notes) el('p', 'sum-note', body, n);
  shareButton(body, s.share);
  return dialog(parent, s.practice ? '这一场（娱乐）' : '这一场', body, [{ label: '回标题', value: 'ok', primary: true }]);
}

/** 好友房：先颁奖，再列这一场每个人的输赢（我排第一） */
export function roomSummary(
  parent: HTMLElement,
  title: string,
  note: string | null,
  rows: RoomSummaryRow[],
  awards: Award[] = [],
  share?: () => void,
): Promise<unknown> {
  const body = el('div', 'summary');
  if (note) el('p', 'sum-note', body, note);
  const me = rows.find((r) => r.me);
  if (me) hero(body, me.net, true);
  awardBox(body, awards);
  const grid = el('div', 'sum-grid', body);
  const sorted = [...rows].sort((a, b) => Number(b.me) - Number(a.me) || b.net - a.net);
  for (const r of sorted) row(grid, r.me ? `${r.name}（你）` : r.name, signed(r.net), r.net > 0 ? 'plus' : r.net < 0 ? 'minus' : '');
  if (!rows.length) el('p', 'sum-note', body, '这一场没人带筹码上桌。');
  shareButton(body, share);
  return dialog(parent, title, body, [{ label: '回标题', value: 'ok', primary: true }]);
}

/** 分享（docs/social.md 1.1）：放在结算页里面，点了不关结算页；kit 出系统分享或预览 */
function shareButton(body: HTMLElement, share: (() => void) | undefined): void {
  if (!share) return;
  const b = el('button', 'pill sum-share', body, '分享这一场');
  b.type = 'button';
  b.addEventListener('click', share);
}

/** 称号（0.3.0）：这一场公开发生的事算的，图个乐 */
function titleBox(body: HTMLElement, titles: Title[]): void {
  if (!titles.length) return;
  const box = el('div', 'sum-titles', body);
  for (const t of titles) {
    const tag = el('div', 'sum-title', box);
    el('b', '', tag, t.title);
    el('span', '', tag, `${t.name} · ${t.why}`);
  }
}

/** 颁奖（0.15.0）：好友房一场结束，放在最上面、大字 */
function awardBox(body: HTMLElement, awards: Award[]): void {
  if (!awards.length) return;
  const box = el('div', 'sum-awards', body);
  for (const a of awards) {
    const card = el('div', `sum-award ${a.kind}`, box);
    el('div', 'sum-award-t', card, a.title);
    el('div', 'sum-award-n', card, a.name);
    el('div', 'sum-award-l', card, a.line);
  }
}

/** 这一场的大字：赢了金色、输了柔和的红，各配一句（不嘲讽、不催着再来） */
function hero(body: HTMLElement, net: number, played: boolean): void {
  const mood = net > 0 ? 'win' : net < 0 ? 'lose' : 'even';
  const box = el('div', `sum-hero ${mood}`, body);
  el('b', 'sum-net', box, signed(net));
  el('span', 'sum-mood', box, !played ? '还没打完一手' : mood === 'win' ? '这一场赢了！' : mood === 'lose' ? '牌有起落，下次手气就来了' : '不输不赢，打了个平手');
}

function row(grid: HTMLElement, label: string, value: string, cls = ''): void {
  el('span', 'sum-k', grid, label);
  el('span', `sum-v ${cls}`, grid, value);
}

const signed = (n: number): string => (n > 0 ? `+${chips(n)}` : n < 0 ? `−${chips(-n)}` : '±0');
