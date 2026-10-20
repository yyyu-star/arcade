/**
 * 牌馆的房间规则（牌馆 ⑤，docs/doudizhu.md 第 1 节）：一个房间类（worker/room.ts）同时开掼蛋和斗地主，这里把两套规则合成一个 kit 的 RoomGame。
 * 开房选项里多一个 variant: 'ddz'（没有就是掼蛋，旧房间、旧页面不受影响）；之后每个调用按状态里有没有 variant: 'ddz' 转给对应玩法。
 * 掼蛋的状态、视图、操作的形状一点没动：线上正在打的掼蛋房间部署后照常打完。
 */
import type { RoomGame } from 'arcade-kit/game';
import type { Entropy } from 'arcade-kit/rng';
import { guandanRoom, type NetAction, type NetState, type NetView } from '../variants/guandan/net/rules.ts';
import { parseRoomOpts, type RoomOpts, type StakeEffect } from '../variants/guandan/net/stake.ts';
import {
  ddzActors,
  ddzAi,
  ddzApply,
  ddzBegin,
  ddzOver,
  ddzSeated,
  ddzTimeout,
  ddzTurnMs,
  ddzView,
  parseDdzAction,
  type DdzNet,
  type DdzNetAction,
  type DdzNetView,
} from '../variants/doudizhu/net/rules.ts';
import { DDZ_SEATS } from '../variants/doudizhu/index.ts';
import { EMOTE_COUNT } from './emotes.ts';

/** 斗地主房间的开房选项（娱乐；实盘以后再接，现在带 stake 的直接拒绝） */
export interface DdzOpts {
  variant: 'ddz';
  stake: null;
}

export type HallOpts = RoomOpts | DdzOpts;
export type HallState = NetState | DdzNet;
export type HallAction = NetAction | DdzNetAction;
export type HallView = NetView | DdzNetView;

export const isDdz = (s: HallState): s is DdzNet => 'variant' in s && s.variant === 'ddz';
export const isDdzOpts = (o: HallOpts | undefined): o is DdzOpts => !!o && 'variant' in o && o.variant === 'ddz';
export const isDdzView = (v: HallView): v is DdzNetView => 'variant' in v && v.variant === 'ddz';

/** 开房 / 排队开桌带的选项：variant 只认 'ddz'（别的值拒绝）；斗地主带实盘档位拒绝；其余交给掼蛋原来的校验 */
export function parseHallOpts(raw: unknown): HallOpts | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { variant?: unknown }).variant !== undefined) {
    const o = raw as { variant: unknown; stake?: unknown };
    if (o.variant !== 'ddz') return null;
    return o.stake === undefined || o.stake === null ? { variant: 'ddz', stake: null } : null;
  }
  return parseRoomOpts(raw);
}

export const hallRoom: RoomGame<HallState, HallAction, HallView, HallOpts, StakeEffect> = {
  seats: 4,
  rulesVersion: guandanRoom.rulesVersion,
  options: parseHallOpts,
  seatCount: (opts) => (isDdzOpts(opts) ? DDZ_SEATS : 4),
  emotes: EMOTE_COUNT,
  chat: true,
  begin: (entropy: Entropy, rv, setup) => {
    if (isDdzOpts(setup?.opts)) return ddzBegin(entropy, setup);
    return guandanRoom.begin!(entropy, rv, setup as Parameters<NonNullable<typeof guandanRoom.begin>>[2]);
  },
  start: () => {
    throw new Error('online games start with begin(entropy)');
  },
  breakPoint: (s) => (isDdz(s) ? s.g.phase === 'dealEnd' : guandanRoom.breakPoint!(s)),
  // 先认斗地主独有的 bid；其余（play / pass / ready / back）两边形状一样，按掼蛋的解析，斗地主收到时再核对
  parse: (raw) => {
    if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'bid') return parseDdzAction(raw);
    return guandanRoom.parse(raw);
  },
  free: (a) => a.type === 'buyin' || a.type === 'again' || a.type === 'back',
  apply: (s, seat, a) => {
    if (isDdz(s)) {
      // 掼蛋的进贡、还贡、带入、再来一场在斗地主里都不存在；play 的 as 字段斗地主不用
      switch (a.type) {
        case 'bid':
        case 'pass':
        case 'ready':
        case 'back':
          return ddzApply(s, seat, a);
        case 'play':
          return ddzApply(s, seat, { type: 'play', cards: a.cards });
        default:
          return { error: 'bad_action' };
      }
    }
    if (a.type === 'bid') return { error: 'bad_action' };
    return guandanRoom.apply(s, seat, a);
  },
  // 写了 actors 的房间不看 turn；留着是 RoomGame 必填，和 actors 的第一个座位一致
  turn: (s) => (isDdz(s) ? ddzActors(s) : guandanRoom.actors(s)).seats[0] ?? null,
  actors: (s) => (isDdz(s) ? ddzActors(s) : guandanRoom.actors(s)),
  turnMs: (s) => (isDdz(s) ? ddzTurnMs(s) : guandanRoom.turnMs(s)),
  view: (s, seat) => (isDdz(s) ? ddzView(s, seat) : guandanRoom.view(s, seat)),
  ai: (s, seat) => (isDdz(s) ? ddzAi(s, seat) : guandanRoom.ai(s, seat)),
  timeout: (s, seat) => (isDdz(s) ? ddzTimeout(s, seat) : guandanRoom.timeout(s, seat)),
  over: (s) => (isDdz(s) ? ddzOver(s) : guandanRoom.over(s)),
  pause: (s) => (isDdz(s) ? null : guandanRoom.pause!(s)),
  resume: (s) => (isDdz(s) ? s : guandanRoom.resume!(s)),
  seated: (s, seat, kind) => (isDdz(s) ? ddzSeated(s, seat, kind) : guandanRoom.seated!(s, seat, kind)),
  effects: (s) => (isDdz(s) ? [] : guandanRoom.effects!(s)),
  settled: (s, id, result) => (isDdz(s) ? s : guandanRoom.settled!(s, id, result)),
  closing: (s) => (isDdz(s) ? s : guandanRoom.closing!(s)),
};
