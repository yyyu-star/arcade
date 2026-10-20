/**
 * 顺手提示（0.6.0）：公开事件发生时，在"互动"按钮旁冒 1–2 句合适的嘲讽（`table/nudge.ts` 画），一点就发。
 * 只看公开信息（这一手是谁出的、压了谁、谁出完了），不看任何人的手牌；画面座位，我 = 0、对家 = 2。
 */
import { isBomb, type GameEvent } from '../variants/guandan/core/index.ts';
import { taunt } from '../net/emotes.ts';

const ME = 0;
const team = (s: number): number => s % 2;

/** 返回要冒的嘲讽编号（0–2 个）。victim 是这一手压下去的那手牌是谁出的（-1：领出） */
export function suggestFor(e: GameEvent, victim: number): number[] {
  if (e.type === 'play' && isBomb(e.play) && victim >= 0) {
    if (e.seat === ME && team(victim) !== team(ME)) return [taunt('就这？'), taunt('炸弹准备好了')];
    if (team(e.seat) !== team(ME) && team(victim) === team(ME)) return [taunt('手气而已，别骄傲'), taunt('等着瞧')];
    if (e.seat === 2 && team(victim) !== team(ME)) return [taunt('稳住，我们能赢')];
  }
  if (e.type === 'finish' && e.place === 1) {
    if (e.seat === ME) return [taunt('谢谢送分'), taunt('这把你们没戏')];
    if (e.seat === 2) return [taunt('对家靠你了'), taunt('这把你们没戏')];
    return [taunt('等着瞧')];
  }
  return [];
}
