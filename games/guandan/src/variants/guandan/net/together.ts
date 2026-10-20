/**
 * 搭子战绩（0.16.0，平台 15.19，设计 docs/design.md 4.3）：好友房一场打完的那一步，房间（worker/room.ts 的 onStep）经 kit 的 reportMatch 报一次同桌真人和输赢。
 * 这里只认"这一步是不是一场刚结束、哪一队赢"，纯函数（tests/together.test.ts）；谁是真人由 kit 按开打后绑在座位上的人认，电脑座位不报。
 *
 * 一场：娱乐房间是打到有一队过 A（gameOver）；实盘房间是这一场结束（打满 5 副、过 A，同一步记下结回）。中途没人了、关房收场不算一场，不报。
 * win：娱乐是先过 A 的那队；实盘是这一场分多的那队（每副按 dealPoints 加起来，打平两队都不算赢）。
 */
import type { NetState } from './rules.ts';

export interface MatchSeat {
  seat: number;
  team: number;
  win: boolean;
}

/** 这一步刚打完一场就给出四个座位的队和输赢，不然 null */
export function matchEnd(s: NetState): MatchSeat[] | null {
  let winner: number;
  if (s.stake) {
    // 实盘：记下结回的那一步（一副打完、over 刚变成真）；过 A 也在这一步
    if (!s.stake.over || !s.ev.some((e) => e.type === 'dealEnd')) return null;
    const sc = s.log?.score;
    winner = !sc || sc[0] === sc[1] ? -1 : sc[0]! > sc[1]! ? 0 : 1;
  } else {
    if (!s.ev.some((e) => e.type === 'gameOver')) return null;
    winner = s.g.winner;
  }
  return [0, 1, 2, 3].map((seat) => ({ seat, team: seat % 2, win: seat % 2 === winner }));
}
