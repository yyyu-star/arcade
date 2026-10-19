/**
 * 好友房的总规则（DESIGN.md 14.3）：房间 DO 只认这一个 RoomGame，按开房选项分给现金桌（rules.ts）或锦标赛（tour.ts）。
 * 状态里有 `tour` 的是锦标赛；两边的操作形状、视图类型相同，kit 的 parse 不带状态，所以共用现金桌的。
 */
import type { RoomGame } from 'arcade-kit/game';
import { RULES_VERSION } from '../core/table.ts';
import { SEATS, texasRoom, type RoomAction, type RoomOpts, type RoomState, type RoomView, type WalletEffect } from './rules.ts';
import { isTourState, tourRoom, type TourRoomState } from './tour.ts';

export type TexasState = RoomState | TourRoomState;

export const texasGame: RoomGame<TexasState, RoomAction, RoomView, RoomOpts, WalletEffect> = {
  seats: SEATS,
  rulesVersion: RULES_VERSION,
  options: (raw) => texasRoom.options!(raw),
  seatCount: (opts) => texasRoom.seatCount!(opts),
  begin: (entropy, rv, setup) => (setup?.opts?.tour ? tourRoom.begin!(entropy, rv, setup) : texasRoom.begin!(entropy, rv, setup)),
  start: () => {
    throw new Error('texas rooms use begin');
  },
  parse: (raw) => texasRoom.parse(raw),
  free: (a) => texasRoom.free!(a),
  chat: true,
  emotes: texasRoom.emotes!,

  apply: (s, seat, a) => (isTourState(s) ? tourRoom.apply(s, seat, a) : texasRoom.apply(s, seat, a)),
  turn: (s) => (isTourState(s) ? tourRoom.turn(s) : texasRoom.turn(s)),
  turnMs: (s) => (isTourState(s) ? tourRoom.turnMs!(s) : texasRoom.turnMs!(s)),
  view: (s, seat) => (isTourState(s) ? tourRoom.view(s, seat) : texasRoom.view(s, seat)),
  ai: (s, seat) => (isTourState(s) ? tourRoom.ai(s, seat) : texasRoom.ai(s, seat)),
  timeout: (s, seat) => (isTourState(s) ? tourRoom.timeout!(s, seat) : texasRoom.timeout!(s, seat)),
  over: (s) => (isTourState(s) ? tourRoom.over(s) : texasRoom.over(s)),
  breakPoint: (s) => (isTourState(s) ? tourRoom.breakPoint!(s) : texasRoom.breakPoint!(s)),
  pause: (s) => (isTourState(s) ? tourRoom.pause!(s) : texasRoom.pause!(s)),
  resume: (s) => (isTourState(s) ? tourRoom.resume!(s) : texasRoom.resume!(s)),
  waiting: (s) => (isTourState(s) ? tourRoom.waiting!(s) : texasRoom.waiting!(s)),
  seated: (s, seat, kind) => (isTourState(s) ? tourRoom.seated!(s, seat, kind) : texasRoom.seated!(s, seat, kind)),
  effects: (s) => (isTourState(s) ? tourRoom.effects!(s) : texasRoom.effects!(s)),
  settled: (s, id, result) => (isTourState(s) ? tourRoom.settled!(s, id, result) : texasRoom.settled!(s, id, result)),
  closing: (s) => (isTourState(s) ? tourRoom.closing!(s) : texasRoom.closing!(s)),
};
