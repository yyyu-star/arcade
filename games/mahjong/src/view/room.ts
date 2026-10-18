/**
 * 好友房的等人页和牌桌上的小条（DESIGN.md 6、7）：房间号、规则、四个座位（点空位坐下）、叫朋友来、房主开打；
 * 开打后牌桌顶上一条：等筹码到账、带入被拒（再带一次）、电脑先替你打；没入座的是"旁观中"（docs/social.md 1.4）。
 */
import type { RoomInfo, You } from 'arcade-kit/protocol';
import type { XzOpts } from '../core/variants/sichuan-xuezhan/index.ts';
import { stakesOf } from '../game/stakes.ts';
import { MIN_HUMANS, type RoomOpts, type RoomView } from '../room/rules.ts';
import { avatarSvg } from './avatar.ts';
import { button, el } from './dom.ts';
import { num, STAKES_NAME, VARIANT_NAME, walletError } from './text.ts';

export interface WaitingProps {
  /** 快速匹配排到的桌（0.21.0）：人已经坐好，到齐（或等满 20 秒）自动开打；不摆房间号、叫朋友、选座、开打 */
  match?: boolean;
  code: string;
  room: RoomInfo;
  you: You | null;
  opts: RoomOpts | null;
  /** 我是房主（我开的，或者坐在 0 号位：房主进房就坐 0 号） */
  host: boolean;
  /** 跟着"再来一场"过来、还没坐下：上一场我坐的那边（亮一下） */
  suggest: number | null;
  onSit(seat: number): void;
  onStart(): void;
  onShare(): void;
  onLeave(): void;
}

/** 开房时定下的规则，一行字 */
function rulesLine(o: RoomOpts | null): string {
  if (!o) return '';
  const st = stakesOf(o.stakes);
  const r = o.rules as XzOpts;
  const stake = st?.wallet ? `实盘${STAKES_NAME[o.stakes]}档（一份 ${num(st.share)}）` : '娱乐';
  return [VARIANT_NAME[o.variant] ?? o.variant, stake, `${r.rounds} 局`, `封顶 ${r.cap} 番`, r.swap ? '换三张' : '不换', r.zimo === 'fan' ? '自摸加番' : '自摸加底', r.transfer ? '呼叫转移' : ''].filter(Boolean).join(' · ');
}

export function renderWaiting(box: HTMLElement, p: WaitingProps): void {
  box.replaceChildren();
  if (p.match) return matchWaiting(box, p);
  const head = el('div', 'room-head', box);
  el('div', 'room-label', head, '房间号');
  el('div', 'room-code', head, p.code);
  el('div', 'room-rules', head, rulesLine(p.opts));
  button('act go big share', box, '叫朋友来', p.onShare);
  const seats = el('div', 'room-seats', box);
  p.room.seats.forEach((s, i) => {
    const mine = p.you?.seat === i;
    const card = el('div', `room-seat${mine ? ' me' : ''}${s.kind === 'empty' ? ' empty' : ''}${p.suggest === i && s.kind === 'empty' ? ' spot' : ''}`, seats);
    if (s.kind === 'empty') {
      el('div', 'avatar ghost', card, '＋');
      el('div', 'name', card, '空位');
      button('act soft', card, p.you?.seat === null || p.you?.seat === undefined ? '坐这里' : '换到这里', () => p.onSit(i));
    } else {
      el('div', 'avatar', card).innerHTML = avatarSvg(s.name ?? '电脑', s.kind === 'ai');
      el('div', 'name', card, `${s.name ?? '电脑'}${mine ? '（我）' : ''}${i === 0 ? ' · 房主' : ''}`);
      if (s.away) el('div', 'tag', card, '掉线了');
    }
  });
  const watchingFull = (p.you?.seat === null || p.you?.seat === undefined) && !p.room.seats.some((s) => s.kind === 'empty');
  if (watchingFull) el('p', 'room-hint watch', box, '旁观中：座位满了，开打后你能看桌面和出牌，看不到手牌；有人离开就能坐下。');
  else el('p', 'room-hint', box, '空着的座位开打时由电脑补上；开打以后朋友也能进来接管电脑的座位。');
  const wallet = !!stakesOf(p.opts?.stakes)?.wallet;
  // 实盘至少两个真人：好友房是来和朋友打的，电脑座位的钱归庄家（房间那边也拦，这里先说清楚）
  const few = wallet && p.room.seats.filter((s) => s.kind === 'human').length < MIN_HUMANS;
  if (wallet) el('p', 'room-hint', box, '实盘：坐下的人在房主开打时各从钱包带一份；不想带就别坐，看着也行。电脑都是最强的。');
  if (few) el('p', 'room-hint warn', box, '实盘好友房至少要两个人；一个人想玩实盘，去单机。');
  const row = el('div', 'go-row', box);
  button('act soft', row, '离开房间', p.onLeave);
  if (p.host) button('act go big', row, '开打', p.onStart).disabled = few;
  else el('span', 'room-wait', row, few ? '等朋友坐下' : '等房主开打');
}

/** 匹配桌等人进来：只看谁到了，到齐或等满就开打 */
function matchWaiting(box: HTMLElement, p: WaitingProps): void {
  const head = el('div', 'room-head', box);
  el('div', 'room-label', head, '快速匹配');
  el('div', 'room-rules', head, rulesLine(p.opts));
  const seats = el('div', 'room-seats', box);
  p.room.seats.forEach((s, i) => {
    const mine = p.you?.seat === i;
    const card = el('div', `room-seat${mine ? ' me' : ''}${s.kind === 'empty' ? ' empty' : ''}`, seats);
    const name = s.kind === 'human' ? (s.name ?? '玩家') : '电脑';
    el('div', 'avatar', card).innerHTML = avatarSvg(name, s.kind !== 'human');
    el('div', 'name', card, `${name}${mine ? '（我）' : ''}`);
    if (s.kind === 'human' && s.away) el('div', 'tag', card, '还没进来');
  });
  el('p', 'room-hint', box, '凑好一桌了：人到齐就开打，没进来的先由电脑替他打，进来了交还给他。');
  const row = el('div', 'go-row', box);
  button('act soft', row, '离开', p.onLeave);
  el('span', 'room-wait', row, '马上开打');
}

/** 没入座时能坐哪：自己坐过的座位（离座了也还是他的），或者没绑人的电脑座位（kit 的座位绑人规则） */
export interface Watching {
  back: number | null;
  free: { seat: number; name: string }[];
  /** 实盘房间只看：旁观的人不带入（docs/social.md 1.4） */
  wallet: boolean;
  onSit(seat: number): void;
}

/** 开打以后牌桌顶上的一条（没有要说的返回 null）；watch 只在没入座时给 */
export function roomNotice(v: RoomView, seat: number | null, onRebuy: () => void, watch: Watching | null = null): HTMLElement | null {
  if (seat === null) return watch ? watching(watch) : null;
  if (v.unrated && !v.done) return note('实盘只有一个人，这一场不计输赢、不动钱包');
  if (v.opening) return note('等大家的筹码到账……');
  if (v.own[seat]) return null;
  if (v.buying[seat]) return note('筹码正在到账，这个座位先由电脑替你打');
  if (v.refused) {
    const n = note(`${walletError(v.refused).text}。这个座位先由电脑替你打。`);
    if (v.canRebuy) button('act go', n, '再带一次', onRebuy);
    return n;
  }
  return null;
}

/** 旁观：看得到桌面、出牌、分数和互动，看不到手牌，不能扔东西；有能坐的座位就给"坐下" */
function watching(w: Watching): HTMLElement {
  const n = document.createElement('div');
  n.className = 'room-note watch';
  el('b', 'watch-tag', n, '旁观中');
  if (w.back !== null) {
    button('act go', n, '回到我的座位', () => w.onSit(w.back!));
    return n;
  }
  if (w.wallet) {
    el('span', '', n, '实盘房间只能看');
    return n;
  }
  for (const f of w.free.slice(0, 2)) button('act go', n, w.free.length > 1 ? `坐下（替${f.name}）` : '坐下', () => w.onSit(f.seat));
  if (!w.free.length) el('span', '', n, '看不到手牌，也不能扔东西');
  return n;
}

function note(text: string): HTMLElement {
  const n = document.createElement('div');
  n.className = 'room-note';
  el('span', '', n, text);
  return n;
}
