/**
 * 好友房锦标赛的规则（src/room/tour.ts），不经房间：座位对应、隐藏信息、报名和结回的钱包事、占了名的座位。
 * 房间里整场的流程在 test/worker/tour-room.test.ts。
 */
import type { SeatKind } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import { stakesOf } from '../src/core/stakes.ts';
import { SEATS, texasRoom, type RoomOpts } from '../src/room/rules.ts';
import { tourRoom, type TourRoomState } from '../src/room/tour.ts';
import { texasGame } from '../src/room/game.ts';

const MAX = stakesOf('small').max;
const E = [1, 2, 3, 4, 5, 6, 7, 8];
const kinds = (humans: number[], ai: number[] = []): SeatKind[] => Array.from({ length: SEATS }, (_, i) => (humans.includes(i) ? 'human' : ai.includes(i) ? 'ai' : 'empty'));
const opts = (o: Partial<RoomOpts> = {}): RoomOpts => ({ stakes: 'small', size: 6, tour: true, fill: true, ...o });
const begin = (humans: number[], o: Partial<RoomOpts> = {}, bots = [0, 1, 2, 3, 4, 5].filter((i) => !humans.includes(i))): TourRoomState => {
  const op = opts(o);
  return tourRoom.begin!(E, 1, { opts: op, seats: kinds(humans, op.fill ? bots : []) });
};
const ok = (s: TourRoomState, id: string): TourRoomState => tourRoom.settled!(s, id, { ok: true });

describe('好友房锦标赛的规则', () => {
  it('开房选项：只有锦标赛带 tour / fill，固定 6 人，档位合格', () => {
    expect(texasRoom.options!({ stakes: 'mid', size: 6, tour: true, fill: true })).toEqual({ stakes: 'mid', size: 6, tour: true, fill: true });
    expect(texasRoom.options!({ size: 6, fun: true, tour: true })).toEqual({ stakes: 'small', size: 6, fun: true, tour: true, fill: false });
    for (const bad of [{ stakes: 'mid', size: 5, tour: true }, { stakes: 'mid', size: 6, fill: true }, { stakes: 'x', size: 6, tour: true }, { stakes: 'mid', size: 6, tour: 1 }]) expect(texasRoom.options!(bad)).toBeNull();
    // 现金桌的选项原样不变
    expect(texasRoom.options!({ stakes: 'mid', size: 3 })).toEqual({ stakes: 'mid', size: 3 });
  });

  it('实盘开赛：每个真人一笔报名，一人一个 ref，op 不重复；扣完才开赛，开赛前底牌不下发', () => {
    let s = begin([0, 2]);
    const fx = tourRoom.effects!(s);
    expect(fx.map((e) => [e.seat, e.kind, e.amount, e.ref])).toEqual([
      [0, 'debit', MAX, `${s.ref}s0n1`],
      [2, 'debit', MAX, `${s.ref}s2n1`],
    ]);
    expect(new Set(fx.map((e) => e.id)).size).toBe(2);
    expect(s.phase).toBe('opening');
    expect(tourRoom.view(s, 0).hole).toEqual([]);
    s = ok(s, fx[0]!.id);
    expect(s.phase).toBe('opening');
    s = ok(s, fx[1]!.id);
    expect(s.phase).toBe('play');
    expect(s.entropy).toBeUndefined();
    expect(tourRoom.view(s, 0).hole.length).toBe(2);
  });

  it('座位对应：没开电脑补就按实际人数开赛，视图里没入局的座位是空座；牌桌座位号换成房间座位号', () => {
    const s = begin([1, 4], { fill: false, fun: true });
    expect(s.seats).toEqual([1, 4]);
    expect(s.st!.table.seats.length).toBe(2);
    const v = tourRoom.view(s, 4);
    expect(v.seats.map((x) => x.owner)).toEqual(['none', 'player', 'none', 'none', 'player', 'none']);
    expect(v.me).toBe(4);
    // 锦标赛自己的字段只放在 tour 里：next、level 和现金桌视图里的同名字段不能被盖掉（next 是"下一手上桌"的座位表）
    expect(v.next).toBeUndefined();
    expect(v.level).toBe(s.st!.table.level);
    expect(v.tour).toMatchObject({ in: true, fun: true, buyIn: 0, phase: 'play' });
    expect([1, 4]).toContain(v.button);
    expect([1, 4]).toContain(v.toAct);
    // 只给自己的底牌
    expect(tourRoom.view(s, 4).hole.length).toBe(2);
    const spec = tourRoom.view(s, 3);
    expect(spec.hole).toEqual([]);
    expect(spec.me).toBeNull();
    expect(JSON.stringify(spec)).not.toContain('"seed"');
    // 开了电脑补：6 个座位都在
    expect(begin([0, 1]).seats).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('不到两个真人：不开赛、不扣报名费；报名后不够两个：扣到的退回', () => {
    const solo = begin([0]);
    expect(solo.phase).toBe('done');
    expect(solo.aborted).toBe(true);
    expect(tourRoom.effects!(solo)).toEqual([]);
    expect(tourRoom.over(solo)).toBe(true);
    let s = begin([0, 1, 2]);
    const [a, b, c] = tourRoom.effects!(s);
    s = ok(s, a!.id);
    s = tourRoom.settled!(s, b!.id, { ok: false, error: 'no_funds' });
    expect(s.refused[1]).toBe('no_funds');
    expect(s.phase).toBe('opening');
    s = tourRoom.settled!(s, c!.id, { ok: false, error: 'no_funds' });
    // 只剩 0 号一个报上名：退回
    expect(s.aborted).toBe(true);
    expect(tourRoom.effects!(s).map((e) => [e.seat, e.kind, e.amount])).toEqual([[0, 'credit', MAX]]);
  });

  it('等报名等太久：超时就不等了；那一笔后来扣成了，原样退回', () => {
    let s = begin([0, 1, 2]);
    const fx = tourRoom.effects!(s);
    s = ok(s, fx[0]!.id);
    s = ok(s, fx[1]!.id);
    expect(tourRoom.turn(s)).toBe(2);
    const r = tourRoom.apply(s, 2, { t: 'timeout' });
    expect('error' in r).toBe(false);
    s = r as TourRoomState;
    expect(s.phase).toBe('play');
    expect(s.seats).toEqual([0, 1, 3, 4, 5]);
    // 2 号那笔还在 fx 里让房间办完
    const late = s.fx.find((e) => e.seat === 2)!;
    expect(late.kind).toBe('debit');
    s = ok(s, late.id);
    expect(tourRoom.effects!(s).map((e) => [e.seat, e.kind, e.amount])).toEqual([[2, 'credit', MAX]]);
  });

  it('开赛后坐下的真人（占了个电脑座位）出不了手：只有房间代出的 timeout 会换成电脑的一步', () => {
    let s = begin([0, 1], { fun: true });
    s = tourRoom.seated!(s, 3, 'human');
    expect(s.kinds[3]).toBe('human');
    expect(tourRoom.view(s, 3).tour!.in).toBe(false);
    expect(tourRoom.view(s, 3).hole).toEqual([]);
    expect(tourRoom.apply(s, 3, { t: 'fold' })).toEqual({ error: 'not_seated' });
    // 轮到他的计时很短，不拖牌局
    const toAct = s.st!.table.toAct;
    s = { ...s, st: { ...s.st!, table: { ...s.st!.table, toAct: 3 } } };
    expect(toAct).not.toBeNull();
    expect(tourRoom.turnMs!(s)).toBeLessThan(5_000);
    const r = tourRoom.apply(s, 3, { t: 'timeout' });
    expect('error' in r).toBe(false);
  });

  it('真人选手离座：座位交给电脑，不再算他本人在打；一个真人都不剩就一次打完并结回', () => {
    let s = begin([0, 1], { fun: true });
    s = tourRoom.seated!(s, 0, 'ai');
    expect(s.st!.auto[0]).toBe(true);
    expect(s.phase).toBe('play');
    expect(tourRoom.view(s, 0).tour!.in).toBe(false);
    s = tourRoom.seated!(s, 1, 'ai');
    expect(s.phase).toBe('done');
    expect(s.st!.over).toBe(true);
    expect(tourRoom.over(s)).toBe(true);
  });

  it('实盘打完：奖池只在真人之间分，每个真人结回一笔，总额 = 真人数 × 报名费；娱乐不产生钱包的事', () => {
    let s = begin([0, 1, 2]);
    for (const e of tourRoom.effects!(s)) s = ok(s, e.id);
    for (const e of tourRoom.effects!(s)) s = ok(s, e.id);
    s = tourRoom.seated!(s, 0, 'ai');
    s = tourRoom.seated!(s, 1, 'ai');
    s = tourRoom.seated!(s, 2, 'ai');
    expect(s.phase).toBe('done');
    const fx = tourRoom.effects!(s);
    expect(fx.map((e) => e.kind)).toEqual(['credit', 'credit', 'credit']);
    expect(fx.reduce((a, e) => a + e.amount, 0)).toBe(3 * MAX);
    expect(fx.map((e) => e.ref).sort()).toEqual([0, 1, 2].map((k) => `${s.ref}s${k}n1`));
    expect(new Set(fx.map((e) => e.id)).size).toBe(3);
    const fun = tourRoom.seated!(tourRoom.seated!(begin([0, 1], { fun: true }), 0, 'ai'), 1, 'ai');
    expect(fun.phase).toBe('done');
    expect(tourRoom.effects!(fun)).toEqual([]);
  });

  it('总规则按选项分：锦标赛走 tour，现金桌走原来的', () => {
    const t = texasGame.begin!(E, 1, { opts: opts({ fun: true }), seats: kinds([0, 1], [2, 3, 4, 5]) });
    expect('tour' in t).toBe(true);
    const c = texasGame.begin!(E, 1, { opts: { stakes: 'small', size: 3 }, seats: kinds([0, 1], [2]) });
    expect('tour' in c).toBe(false);
  });
});
