/**
 * 结束颁奖（0.14.0，仓库根 docs/social.md 第 2 节）：好友房一场打完，按房间攒的公开记录（名次、炸弹，`MatchLog`）评 2–3 个奖，
 * 结算页大字展示、可以放进分享卡。只用公开信息（谁第几个出完、谁出了炸弹），不看手牌；话从模板拼，不挂筹码。纯函数（tests/awards.test.ts）。
 * 座位是谁给的记录就按谁算：房间的记录是真实座位，页面拿到的是转过的画面座位。
 */
import type { MatchLog } from '../stake/titles.ts';

export const AWARD_NAME = {
  mvp: '本场 MVP',
  unlucky: '最惨的人',
  bomb_king: '炸弹王',
} as const;
export type AwardId = keyof typeof AWARD_NAME;

export interface Award {
  id: AwardId;
  seat: number;
  /** 一句模板话（不带名字，名字由画面按座位配） */
  line: string;
}

/** 炸弹王至少要炸几次（和整局称号"炸弹狂魔"的 3 次分开：颁奖每场都有，门槛低一点） */
export const BOMB_KING_MIN = 2;

/**
 * 这一场的奖。winner 是赢下整局的队（实盘提前结束、没人过 A 时按赢的副数多的队，打平是 -1）。
 * MVP 每场都有：名次分（头游 3、二游 2、三游 1、末游 0）×2 加炸弹数最高的；并列先看是不是赢的那队、再看头游多、炸弹多，最后按座位。
 * 最惨的人：MVP 以外、拿过末游的人里名次分最低的（并列看末游多、再按座位）。炸弹王：炸弹最多且独一份、至少 BOMB_KING_MIN 次，可以和 MVP 是同一个人
 */
export function matchAwards(m: MatchLog, winner: number): Award[] {
  if (m.deals < 1) return [];
  const places = m.places ?? m.firsts.map((f) => f * 3);
  const score = [0, 1, 2, 3].map((i) => places[i]! * 2 + m.bombs[i]!);
  const won = (i: number): number => (winner >= 0 && i % 2 === winner ? 1 : 0);
  const best = [0, 1, 2, 3].sort((a, b) => score[b]! - score[a]! || won(b) - won(a) || m.firsts[b]! - m.firsts[a]! || m.bombs[b]! - m.bombs[a]! || a - b)[0]!;
  const out: Award[] = [{ id: 'mvp', seat: best, line: mvpLine(m.firsts[best]!, m.bombs[best]!) }];
  const sad = [0, 1, 2, 3]
    .filter((i) => i !== best && m.lasts[i]! > 0)
    .sort((a, b) => places[a]! - places[b]! || m.lasts[b]! - m.lasts[a]! || a - b)[0];
  if (sad !== undefined) out.push({ id: 'unlucky', seat: sad, line: `末游 ${m.lasts[sad]} 次，下场翻身` });
  const top = Math.max(...m.bombs);
  const kings = [0, 1, 2, 3].filter((i) => m.bombs[i] === top);
  if (top >= BOMB_KING_MIN && kings.length === 1) out.push({ id: 'bomb_king', seat: kings[0]!, line: `一共炸了 ${top} 次` });
  return out;
}

function mvpLine(firsts: number, bombs: number): string {
  const parts = [firsts > 0 ? `头游 ${firsts} 次` : '', bombs > 0 ? `炸了 ${bombs} 次` : ''].filter(Boolean);
  return parts.length ? `${parts.join('、')}，头号功臣` : '名次最稳，头号功臣';
}

/** 赢的队：过了 A 的队；没人过 A（实盘打满几副、提前结束）按赢的副数，打平 -1 */
export function winnerOf(m: MatchLog, gameWinner: number): number {
  if (gameWinner >= 0) return gameWinner;
  return m.wins[0]! === m.wins[1]! ? -1 : m.wins[0]! > m.wins[1]! ? 0 : 1;
}
