/**
 * 牌桌互动接 arcade-kit/table-fun（0.12.0，仓库根 docs/table-fun.md 第 0 节）：掼蛋只管三件事——短语表、电脑的互动性格、
 * 把自己的公开事件认成 kit 的名场面。电脑怎么反应（概率、冷却、回扔）全在 kit 的 botReact，页面（单机）和房间（好友房）共用这一份。
 *
 * 只看公开事件（谁出了什么、压了谁、谁出完了、是不是双下）；电脑的出牌决策（src/ai）完全不读这里。
 * 座位用调用方的编号（单机是画面座位，我 = 0；房间里是真实座位），同一次调用里一致就行。
 */
import type { FunEvent, FunTemper } from 'arcade-kit/fun-logic';
import { isBomb, type DealResult, type GameEvent } from '../core/index.ts';
import type { PersonaId } from '../ai/index.ts';
import { EMOTES, TAUNTS } from './emotes.ts';

/** kit 的短语表：客气话在前、嘲讽在后，编号和房间转发的 emote 一致（表情从 20 起、道具从 32 起，emotes.ts） */
export const PHRASES: readonly string[] = [...EMOTES, ...TAUNTS];

/** 互动性格：阿强爱闹、老张普通、小美高冷（概率的倍数在 kit：×1.5 / ×1 / ×0.3） */
export const TEMPER: Record<PersonaId, FunTemper> = { laozhang: 'normal', xiaomei: 'cool', aqiang: 'rowdy' };

type Moment = Extract<FunEvent, { kind: 'moment' }>;

const team = (s: number): number => s % 2;
/** 一队的两个座位，先放 first（炸的人、头游） */
const teamOf = (first: number): number[] => [first, (first + 2) % 4];
const others = (s: number): number[] => [(s + 1) % 4, (s + 3) % 4];

/**
 * 这一手压下去的是谁的牌：出牌记录里这一手之前最近一手有牌的（领出时是上一墩的，算不上"压"，
 * 但那手一定是自己人或自己出的，炸弹只看压了对方，所以不会误认）。history 里最后一条是这一手本身
 */
export function victimOf(history: readonly { seat: number; play: unknown }[]): number {
  for (let i = history.length - 2; i >= 0; i--) if (history[i]!.play) return history[i]!.seat;
  return -1;
}

/**
 * 一手牌、一个名次之后的名场面：炸弹压了对方（被炸的是输家）、头游（对方两家是输家）。hand 是第几副（kit 按它算每手的上限）。
 * 不是名场面回 null
 */
export function momentOf(e: GameEvent, victim: number, hand: number): Moment | null {
  if (e.type === 'play' && isBomb(e.play) && victim >= 0 && team(victim) !== team(e.seat)) {
    return { kind: 'moment', moment: 'bomb', winners: teamOf(e.seat), losers: [victim], hand };
  }
  if (e.type === 'finish' && e.place === 1) return { kind: 'moment', moment: 'first-out', winners: teamOf(e.seat), losers: others(e.seat), hand };
  return null;
}

/** 一副结束：双下是名场面（赢的一队按出完的先后排） */
export function dealMoment(r: DealResult): Moment | null {
  if (!r.doubleDown) return null;
  const winners = r.order.filter((s) => team(s) === r.winnerTeam);
  const losers = [0, 1, 2, 3].filter((s) => team(s) !== r.winnerTeam);
  return { kind: 'moment', moment: 'double-down', winners, losers, hand: r.dealNo };
}
