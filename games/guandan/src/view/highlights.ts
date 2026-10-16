/**
 * 名场面（0.7.1）：一副里值得说一嘴的时刻，打的时候冒一下，结算页的复盘里记一行。
 * 只用公开信息（出牌记录、名次、两队级数），不看任何人的手牌；画面座位和真实座位都行（只比队伍和座位是不是同一个）。
 */
import { isBomb, type DealResult, type Play, type PlayRecord } from '../core/index.ts';

export type HighlightKind = 'jokerBomb' | 'bombOnBomb' | 'bombs3' | 'comeback' | 'doubleDown' | 'quick';

export interface Highlight {
  kind: HighlightKind;
  seat: number;
  /** 炸了几次、落后几级、几手出完 */
  n?: number;
}

const team = (s: number): number => s % 2;

/** 几手以内出完算"秒走"（一个人 27 张，平常要十几手） */
export const QUICK_PLAYS = 7;

/**
 * 这一手是不是"炸上炸"：用炸弹压住了对方的炸弹。history 里还没有这一手。
 * 上一手有牌的是对方的炸弹，就一定是同一墩：一墩结束后只有赢的人（或接风的队友）能领出，不会是对方
 */
export function bombOnBomb(history: readonly PlayRecord[], seat: number, play: Play): boolean {
  if (!isBomb(play)) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (!h.play) continue;
    return isBomb(h.play) && team(h.seat) !== team(seat);
  }
  return false;
}

/** 一副结束时的名场面，按精彩程度排（最多给几条由调用方取） */
export function dealHighlights(r: DealResult, history: readonly PlayRecord[]): Highlight[] {
  const out: Highlight[] = [];
  const bombs = new Map<number, number>();
  let jokerBy = -1;
  let bob: Highlight | null = null;
  for (let i = 0; i < history.length; i++) {
    const h = history[i]!;
    if (!h.play || !isBomb(h.play)) continue;
    bombs.set(h.seat, (bombs.get(h.seat) ?? 0) + 1);
    if (h.play.type === 'jokerBomb') jokerBy = h.seat;
    if (!bob && bombOnBomb(history.slice(0, i), h.seat, h.play)) bob = { kind: 'bombOnBomb', seat: h.seat };
  }
  const head = r.order[0]!;
  const behind = r.levelsBefore[1 - r.winnerTeam]! - r.levelsBefore[r.winnerTeam]!;
  if (r.doubleDown && behind >= 3) out.push({ kind: 'comeback', seat: head, n: behind });
  if (jokerBy >= 0) out.push({ kind: 'jokerBomb', seat: jokerBy });
  if (bob) out.push(bob);
  const most = [...bombs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (most && most[1] >= 3) out.push({ kind: 'bombs3', seat: most[0], n: most[1] });
  if (r.doubleDown && behind < 3) out.push({ kind: 'doubleDown', seat: head });
  const plays = history.filter((h) => h.seat === head && h.play).length;
  if (plays <= QUICK_PLAYS) out.push({ kind: 'quick', seat: head, n: plays });
  return out;
}

/** 给人看的一句（name 把座位换成名字） */
export function highlightText(h: Highlight, name: (seat: number) => string): string {
  const who = name(h.seat);
  switch (h.kind) {
    case 'jokerBomb':
      return `${who} 的天王炸`;
    case 'bombOnBomb':
      return `${who} 炸上炸`;
    case 'bombs3':
      return `${who} 一副炸了 ${h.n} 次`;
    case 'comeback':
      return `落后 ${h.n} 级，${who} 这边打出双下`;
    case 'doubleDown':
      return `${who} 这边双下`;
    case 'quick':
      return `${who} ${h.n} 手出完`;
  }
}
