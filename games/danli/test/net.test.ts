/**
 * 好友房的规则（src/net/rules.ts，DESIGN.md 5.6）：只测纯函数（房间本身在 room-do.test.ts 里跑）。
 * act 的验证、超时弃权、电脑代出、视图不带种子、页面按视图重放和服务端一致、快照上限、准备阶段的座位和选项。
 */
import { snapshotBytes } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { planLite } from '../src/ai/online.ts';
import { vs } from './helpers.ts';
import { WEAPON_IDS } from '../src/core/weapons.ts';
import { apply, newGame } from '../src/core/rules.ts';
import { FLIGHT_EXTRA_MAX, FLIGHT_SLOW_PCT, flightMs, playMs, volleyPace } from '../src/net/anim.ts';
import { cloneTerrain } from '../src/core/terrain.ts';
import type { State } from '../src/core/types.ts';
import { replay } from '../src/core/rules.ts';
import { recActions, startOf, stepRec, type Rec } from '../src/net/replay.ts';
import { coreOf, newRoom, parseAction, ROOM_RULES as R, turnAct, type NetAction, type RoomState, type RoomView } from '../src/net/rules.ts';

const KEY = [0xdeadbeef, 0x01234567, 0x89abcdef, 0x0badf00d, 0x13579bdf, 0x2468ace0, 0x0f1e2d3c, 0x4b5a6978];
const CODE_RE = /^[a-z][a-z0-9_]{0,31}$/;

function ok(s: RoomState, seat: number, a: NetAction): RoomState {
  const r = R.apply(s, seat, a);
  if ('error' in r) throw new Error(`${seat} ${JSON.stringify(a)}：${r.error}`);
  return r;
}

function err(s: RoomState, seat: number, a: NetAction): string {
  const r = R.apply(s, seat, a);
  if (!('error' in r)) throw new Error(`应该被拒：${JSON.stringify(a)}`);
  expect(r.error).toMatch(CODE_RE);
  return r.error;
}

/** 该谁出手（kit 座位），在停（等动画）时是 null */
function actor(s: RoomState): number | null {
  const a = R.actors!(s);
  const seats = Array.isArray(a) ? a : a.seats;
  return seats[0] ?? null;
}

/** 两个真人（kit 座位 0、1）加电脑：0 号是房主 */
function lobby(format: 1 | 2 | 3 = 2, map: RoomState['map'] = 'kitchen'): RoomState {
  let s = newRoom(KEY, ['human', 'human', 'ai', 'ai', 'ai', 'ai']);
  s = ok(s, 0, { t: 'format', n: format });
  s = ok(s, 0, { t: 'map', map });
  for (let i = 0; i < 6; i++) if (s.slots[i] === null && i % 3 < format) s = ok(s, 0, { t: 'addbot', slot: i });
  return ok(s, 1, { t: 'ready', on: true });
}

/** 真人那一手：联机档电脑想好的，换成 turn（爬动序列 + 发射） */
function humanTurn(s: RoomState): NetAction {
  const p = planLite(coreOf(s.game!));
  return turnAct(p.moves, p.angle, p.power, p.facing, p.loadout);
}

/** 一直打到结算：真人按 humanTurn 出（timeouts 里的回合数改成超时弃权），电脑由 kit 调 ai */
function playOut(s: RoomState, timeouts = new Set<number>()): RoomState {
  let guard = 0;
  while (s.phase === 'play') {
    if (++guard > 500) throw new Error('打不完');
    if (R.pause!(s) !== null) {
      s = R.resume!(s);
      continue;
    }
    const seat = actor(s)!;
    const g = s.game!;
    const human = g.owners[g.lite.actor] !== null;
    if (!human) s = ok(s, seat, R.ai(s, seat));
    else if (timeouts.has(g.lite.turn)) s = ok(s, seat, R.timeout!(s, seat));
    else s = ok(s, seat, humanTurn(s));
  }
  return s;
}

/** 按视图从头重放（页面的做法：没有种子） */
function clientReplay(v: RoomView): State {
  const g = v.game!;
  let s = startOf(g);
  for (const r of g.log) {
    const out = stepRec(s, r, r.w);
    if ('error' in out) throw new Error(`重放第 ${s.turn} 手出错：${out.error}`);
    s = out.state;
  }
  return s;
}

describe('准备阶段', () => {
  it('开房：房主坐蓝队 1 号，1v1，厨房面团岛；第二个真人自动坐黄队', () => {
    const s = newRoom(KEY, ['human', 'human', 'ai', 'ai', 'ai', 'ai']);
    expect(s.host).toBe(0);
    expect(s.format).toBe(1);
    const v = R.view(s, null);
    expect(v.slots[0]).toMatchObject({ k: 'human', seat: 0 });
    expect(v.slots[3]).toMatchObject({ k: 'human', seat: 1 });
    expect(v.slots[0]!.look).not.toBe(v.slots[3]!.look);
    // 准备阶段只等房主（时限一天，在线的房主到不了；掉线满 60 秒 kit 托管、调 ai 交出房主）
    expect(R.actors!(s)).toEqual({ seats: [0], group: 'host-0' });
    expect(R.turnMs!(s)).toBe(24 * 3_600_000);
    expect(R.ai(s, 0)).toEqual({ t: 'handoff' });
  });

  it('只有房主能改对阵、地图、电脑，开打', () => {
    const s = newRoom(KEY, ['human', 'human', 'ai', 'ai', 'ai', 'ai']);
    for (const a of [{ t: 'format', n: 2 }, { t: 'map', map: 'bento' }, { t: 'addbot', slot: 1 }, { t: 'start' }] as NetAction[]) expect(err(s, 1, a)).toBe('not_host');
  });

  it('换位子、下场、空位才能坐、关着的位子不能坐', () => {
    let s = lobby(2);
    expect(err(s, 1, { t: 'sit', slot: 1 })).toBe('slot_taken');
    expect(err(s, 1, { t: 'sit', slot: 2 })).toBe('slot_closed');
    s = ok(s, 0, { t: 'delbot', slot: 1 });
    s = ok(s, 1, { t: 'sit', slot: 1 });
    expect(R.view(s, null).slots[1]).toMatchObject({ k: 'human', seat: 1 });
    expect(R.view(s, null).slots[3]).toBeNull();
    s = ok(s, 1, { t: 'bench' });
    expect(R.view(s, null).bench).toEqual([{ seat: 1, look: expect.any(String) }]);
  });

  it('小动物一局只上一次：真人撞了不行，撞电脑就和它对调', () => {
    let s = lobby(2);
    const v = R.view(s, null);
    const human1 = v.slots.find((x) => x?.k === 'human' && x.seat === 1)!;
    expect(err(s, 0, { t: 'look', look: human1.look })).toBe('look_taken');
    const bot = v.slots.find((x) => x?.k === 'bot')!;
    const mine = v.slots[0]!.look;
    s = ok(s, 0, { t: 'look', look: bot.look });
    const after = R.view(s, null).slots;
    expect(after[0]!.look).toBe(bot.look);
    expect(after.filter((x) => x?.look === mine)).toHaveLength(1);
    const looks = after.filter((x) => x).map((x) => x!.look);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it('开打：别的真人都准备了、两队都有人；房主不用准备', () => {
    let s = newRoom(KEY, ['human', 'human', 'ai', 'ai', 'ai', 'ai']);
    expect(err(s, 0, { t: 'start' })).toBe('not_ready');
    s = ok(s, 1, { t: 'ready', on: true });
    s = ok(s, 0, { t: 'start' });
    expect(s.phase).toBe('play');
    // 开局先停一会儿（大家的页面换到对局），停够了轮到先手
    expect(R.pause!(s)).toBeGreaterThan(0);
    expect(actor(s)).toBeNull();
    s = R.resume!(s);
    expect(actor(s)).not.toBeNull();
    // 开局以后准备都清掉了
    expect(R.view(s, null).slots[3]).toMatchObject({ ready: false });
    let t = newRoom(KEY, ['human', 'ai', 'ai', 'ai', 'ai', 'ai']);
    expect(err(t, 0, { t: 'start' })).toBe('empty_team');
    t = ok(t, 0, { t: 'addbot', slot: 3 });
    expect(ok(t, 0, { t: 'start' }).phase).toBe('play');
  });

  it('2v2 少一个人也能开（2 对 1）', () => {
    let s = lobby(2);
    s = ok(s, 0, { t: 'delbot', slot: 4 });
    s = ok(s, 0, { t: 'start' });
    expect(s.game!.setup.players.map((p) => p.team)).toEqual([0, 0, 1]);
  });

  it('换对阵：用不到的位子上的真人挪到空位，电脑撤掉', () => {
    let s = lobby(3);
    s = ok(s, 0, { t: 'delbot', slot: 4 });
    s = ok(s, 1, { t: 'sit', slot: 4 });
    s = ok(s, 0, { t: 'format', n: 1 });
    const v = R.view(s, null);
    expect(v.slots.filter((x) => x)).toHaveLength(2);
    expect(v.slots.some((x) => x?.k === 'human' && x.seat === 1)).toBe(true);
  });
});

describe('房主掉线：准备、结算阶段交给下一个人', () => {
  it('按座位顺序交给下一个坐着的真人；交出去的人回来不收回，做点什么就又能被选上', () => {
    let s = newRoom(KEY, ['human', 'ai', 'human', 'human', 'ai', 'ai']);
    expect(parseAction({ t: 'handoff' })).toBeNull();
    expect(err(s, 2, { t: 'handoff' })).toBe('not_host');
    s = ok(s, 0, R.ai(s, 0));
    expect(s.host).toBe(2);
    expect(R.actors!(s)).toEqual({ seats: [2], group: 'host-2' });
    // 新房主也掉线了：交给 3，不交回给还没回来的 0
    s = ok(s, 2, R.ai(s, 2));
    expect(s.host).toBe(3);
    s = ok(s, 3, R.timeout!(s, 3));
    // 都掉线了：不交（房主留在 3），谁也不等
    expect(s.host).toBe(3);
    expect(R.actors!(s)).toEqual([]);
    expect(R.waiting!(s)).toBe(true);
    // 0 回来了，点了一下：不收回房主，但又能被选上；3 回来做点什么又是在等的房主
    s = ok(s, 0, { t: 'ready', on: true });
    expect(s.host).toBe(3);
    expect(s.idle).not.toContain(0);
    s = ok(s, 3, { t: 'weapon', weapon: 'melon' });
    expect(R.actors!(s)).toEqual({ seats: [3], group: 'host-3' });
    expect(R.ai(s, 3)).toEqual({ t: 'handoff' });
    expect(ok(s, 3, R.ai(s, 3)).host).toBe(0);
  });

  it('对局中不交', () => {
    const s = R.resume!(ok(lobby(1), 0, { t: 'start' }));
    expect(err(s, 0, { t: 'handoff' })).toBe('playing');
  });

  it('结算阶段：又只等房主', () => {
    const s = playOut(R.resume!(ok(lobby(1), 0, { t: 'start' })));
    expect(s.phase).toBe('result');
    expect(R.actors!(s)).toEqual({ seats: [0], group: 'host-0' });
    expect(ok(s, 0, R.ai(s, 0)).host).toBe(1);
  });
});

describe('一回合一条 act', () => {
  const started = (): RoomState => R.resume!(ok(lobby(1), 0, { t: 'start' }));

  it('不合格的形状 parse 就拒', () => {
    const bad: unknown[] = [
      null,
      [],
      { t: 'turn', m: 'L'.repeat(51), a: 45, p: 50, f: 1 },
      { t: 'turn', m: 'LX', a: 45, p: 50, f: 1 },
      { t: 'turn', m: '', a: 91, p: 50, f: 1 },
      { t: 'turn', m: '', a: 45, p: 0, f: 1 },
      { t: 'turn', m: '', a: 45.5, p: 50, f: 1 },
      { t: 'turn', m: '', a: 45, p: 50, f: 0 },
      // 旧格式（0.3.0 还没上线，不兼容）、不认识的字段
      { t: 'turn', m: '', a: 45, p: 50, f: 1, mode: 'fork' },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, boost: 20 },
      // 计数：不是整数、负数、超过一回合上限（三岔、加力 50% 最多 1 个）
      { t: 'turn', m: '', a: 45, p: 50, f: 1, p1: 1.5 },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, p1: -1 },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, p1: 10 },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, fork: 2 },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, b50: 2 },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, b10: '2' },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, fork: true },
      { t: 'turn', m: '', a: 45, p: 50, f: 1, lid: 'yes' },
      { t: 'auto' },
      { t: 'look', look: 'dragon' },
      { t: 'addbot', slot: 6 },
      { t: 'map', map: 'moon' },
      { t: 'nope' },
    ];
    for (const b of bad) expect(parseAction(b), JSON.stringify(b)).toBeNull();
    expect(parseAction({ t: 'turn', m: 'LLR', a: 45, p: 50, f: -1, fork: 1, p1: 1, b20: 2, b10: 0, lid: true, plane: false })).toEqual({
      t: 'turn',
      m: 'LLR',
      a: 45,
      p: 50,
      f: -1,
      fork: 1,
      p1: 1,
      b20: 2,
      lid: true,
      plane: false,
    });
  });

  it('逐项验证：不该你、角度、体力、爬不过去、纸飞机不能叠，错误码都是固定短码', () => {
    const s = started();
    const me = actor(s)!;
    const other = me === 0 ? 1 : 0;
    const c = coreOf(s.game!).chars[s.game!.lite.actor]!;
    const w = { min: 20, max: 70 };
    expect(err(s, other, { t: 'turn', m: '', a: 45, p: 50, f: 1 })).toBe('not_your_turn');
    expect(err(s, other, { t: 'pass' })).toBe('not_your_turn');
    expect(err(s, me, { t: 'turn', m: '', a: w.max + 5, p: 50, f: c.facing })).toBe('angle');
    expect(err(s, me, { t: 'turn', m: '', a: 45, p: 50, f: 1, fork: 1, b50: 1 })).toBe('tired');
    expect(err(s, me, { t: 'turn', m: '', a: 45, p: 50, f: 1, p2: 4, p1: 2 })).toBe('volleys');
    expect(err(s, me, { t: 'turn', m: 'L'.repeat(40), a: 45, p: 50, f: 1, p2: 1 })).toMatch(/^(tired|edge|steep|cliff)$/);
    expect(err(s, me, { t: 'turn', m: '', a: 45, p: 50, f: 1, plane: true, b20: 1 })).toBe('plane_alone');
    // 准备阶段的操作在对局里不行
    expect(err(s, me, { t: 'format', n: 3 })).toBe('playing');
    // 局面没变
    expect(R.view(s, null).game!.log).toHaveLength(0);
  });

  it('合法的一回合：记一条 Rec（带下一回合的风），然后停一会儿等动画', () => {
    let s = started();
    const me = actor(s)!;
    s = ok(s, me, humanTurn(s));
    const g = R.view(s, null).game!;
    expect(g.log).toHaveLength(1);
    expect(g.log[0]!.w).toBe(s.game!.lite.wind);
    expect(g.anim).toBe(true);
    expect(actor(s)).toBeNull();
    expect(R.pause!(s)).toBeGreaterThan(1000);
    expect(err(s, me, { t: 'pass' })).toBe('not_your_turn');
  });

  it('超时算弃权：不爬不打，算出过手', () => {
    let s = started();
    const me = actor(s)!;
    expect(R.timeout!(s, me)).toEqual({ t: 'pass' });
    const before = s.game!.lite;
    s = ok(s, me, R.timeout!(s, me));
    const after = s.game!.lite;
    expect(R.view(s, null).game!.log[0]).toEqual({ pass: true, w: after.wind });
    expect(after.turn).toBe(before.turn + 1);
    expect(after.chars).toEqual(before.chars);
  });

  it('真人发不了电脑代出（auto 只由房间给），电脑的回合真人出不了', () => {
    let s = R.resume!(ok(lobby(1), 0, { t: 'start' }));
    expect(parseAction({ t: 'auto' })).toBeNull();
    // 打到轮到电脑
    let guard = 0;
    while (s.game!.owners[s.game!.lite.actor] !== null && ++guard < 10) {
      s = ok(s, actor(s)!, { t: 'pass' });
      s = R.resume!(s);
    }
    // 1v1 两个真人没有电脑；换一局有电脑的
    let t = newRoom(KEY, ['human', 'ai', 'ai', 'ai', 'ai', 'ai']);
    t = ok(t, 0, { t: 'addbot', slot: 3 });
    t = R.resume!(ok(t, 0, { t: 'start' }));
    while (t.game!.owners[t.game!.lite.actor] !== null) t = R.resume!(ok(t, actor(t)!, { t: 'pass' }));
    const seat = actor(t)!;
    // 电脑的回合交给一个没人坐的 kit 座位（kit 马上用 ai 代出）
    expect(t.humans[seat]).toBe(false);
    expect(R.ai(t, seat)).toEqual({ t: 'auto' });
    expect(err(t, 0, { t: 'pass' })).toBe('not_your_turn');
    const after = ok(t, seat, { t: 'auto' });
    expect(R.view(after, null).game!.log.at(-1)!.a).toBeTypeOf('number');
  });

  it('kit 座位全坐满真人时，电脑的回合借房主的座位，1 秒后按超时由电脑出', () => {
    let s = newRoom(KEY, ['human', 'human', 'human', 'human', 'human', 'human']);
    s = ok(s, 0, { t: 'format', n: 3 });
    for (const k of [1, 2, 3, 4, 5]) s = ok(s, k, { t: 'ready', on: true });
    // 腾一个位子给电脑：5 号下场
    s = ok(s, 5, { t: 'bench' });
    const free = s.slots.findIndex((x) => x === null);
    s = ok(s, 0, { t: 'addbot', slot: free });
    s = R.resume!(ok(s, 0, { t: 'start' }));
    while (s.game!.owners[s.game!.lite.actor] !== null) s = R.resume!(ok(s, actor(s)!, { t: 'pass' }));
    expect(actor(s)).toBe(0);
    expect(R.turnMs!(s)).toBe(1000);
    expect(R.timeout!(s, 0)).toEqual({ t: 'auto' });
    expect(err(s, 0, { t: 'turn', m: '', a: 45, p: 50, f: 1 })).toBe('not_your_turn');
  });

  it('掉线托管：kit 对真人的座位调 ai，电脑替他出这一手', () => {
    let s = started();
    const me = actor(s)!;
    s = ok(s, me, R.ai(s, me));
    expect(R.view(s, null).game!.log[0]!.a).toBeTypeOf('number');
  });
});

describe('视图和重放', () => {
  it('视图不带种子（房间的、这一局的），也不带服务端的局面', () => {
    const s = playOut(R.resume!(ok(lobby(2), 0, { t: 'start' })));
    const text = JSON.stringify([R.view(s, null), R.view(s, 0), R.view(s, 3)]);
    for (const k of [...KEY, ...s.game!.key]) expect(text).not.toContain(String(k));
    expect(text).not.toMatch(/"(key|lite|carves|terrain)"/);
  });

  it('页面按视图重放（没有种子）和服务端的局面一模一样：角色、地形、谁赢', () => {
    for (const map of ['kitchen', 'bento', 'breakfast'] as const) {
      const s = playOut(R.resume!(ok(lobby(3, map), 0, { t: 'start' })), new Set([3, 8]));
      expect(s.phase).toBe('result');
      const server = coreOf(s.game!);
      const client = clientReplay(R.view(s, null));
      expect(client.chars.map(({ name: _n, ...c }) => c)).toEqual(server.chars.map(({ name: _n, ...c }) => c));
      expect(client.terrain.cells).toEqual(server.terrain.cells);
      expect([client.phase, client.winner, client.endBy, client.round]).toEqual([server.phase, server.winner, server.endBy, server.round]);
    }
  });

  it('服务端从存储重建（被驱逐）和一直在内存里的结果一样', () => {
    let a = R.resume!(ok(lobby(2), 0, { t: 'start' }));
    for (let i = 0; i < 6 && a.phase === 'play'; i++) {
      const seat = actor(a)!;
      const act = a.game!.owners[a.game!.lite.actor] === null ? R.ai(a, seat) : humanTurn(a);
      const cold = JSON.parse(JSON.stringify(a)) as RoomState;
      const warm = ok(a, seat, act);
      const fromDisk = ok(cold, seat, act);
      expect(JSON.stringify(fromDisk)).toBe(JSON.stringify(warm));
      expect(cloneTerrain(coreOf(fromDisk.game!).terrain).cells).toEqual(coreOf(warm.game!).terrain.cells);
      a = R.resume!(warm);
    }
  });

  it('8 把武器的坑形（DESIGN.md 2.3.1）：每一步驱逐重建、打完页面重放，地形都和内存里的一样', () => {
    for (const ws of [WEAPON_IDS.slice(0, 6), WEAPON_IDS.slice(2, 8)]) {
      let s = lobby(3, 'bento');
      let k = 0;
      for (let i = 0; i < 6; i++) {
        const slot = s.slots[i];
        if (!slot) continue;
        const weapon = ws[k++]!;
        s = 'seat' in slot ? ok(s, slot.seat, { t: 'weapon', weapon }) : ok(s, 0, { t: 'setbot', slot: i, weapon });
      }
      s = R.resume!(ok(s, 0, { t: 'start' }));
      expect(new Set(s.game!.setup.players.map((p) => p.weapon))).toEqual(new Set(ws));
      let guard = 0;
      while (s.phase === 'play') {
        if (++guard > 500) throw new Error('打不完');
        if (R.pause!(s) !== null) {
          s = R.resume!(s);
          continue;
        }
        const seat = actor(s)!;
        const act = s.game!.owners[s.game!.lite.actor] === null ? R.ai(s, seat) : humanTurn(s);
        const warm = ok(s, seat, act);
        const cold = JSON.parse(JSON.stringify(warm)) as RoomState;
        // 逐字节比（toEqual 比十几万格的数组太慢）
        if (cold.game) expect(Buffer.from(coreOf(cold.game).terrain.cells).equals(Buffer.from(coreOf(warm.game!).terrain.cells))).toBe(true);
        s = warm;
      }
      const server = coreOf(s.game!);
      const client = clientReplay(R.view(s, null));
      expect(Buffer.from(client.terrain.cells).equals(Buffer.from(server.terrain.cells))).toBe(true);
      // 服务端存的坑每个四个数，武器都在表里
      const c = s.game!.carves;
      expect(c.length % 4).toBe(0);
      for (let i = 3; i < c.length; i += 4) expect(WEAPON_IDS[c[i]!]).toBeDefined();
    }
  });

  it('规则核心：同种子同操作结果不变（好友房的改动不碰单机）', () => {
    const s = playOut(R.resume!(ok(lobby(1), 0, { t: 'start' })));
    const g = s.game!;
    // 服务端的每一回合换成规则核心的一串操作，用种子从头重放，和房间算的一样
    const acts = g.log.flatMap((r) => recActions(r));
    const r = replay(g.key, g.setup, acts);
    expect(r.bad).toBeNull();
    expect(r.state.chars).toEqual(coreOf(g).chars);
    expect(apply(r.state, { t: 'pass' }).ok).toBe(false);
  });
});

describe('快照上限', () => {
  /** 定的上限：3v3 打满 15 轮（90 手），每手都是字段写满、计数到形状上限的 Rec（比体力买得起的还长）也放得下；用最宽的寿司长台（3600 宽，出生点坐标位数最多） */
  const LIMIT = 20 * 1024;

  it('寿司长台 3v3 打满 15 轮、每手都是最长的那种 Rec：不超过上限', () => {
    let s = R.resume!(ok(lobby(3, 'sushi'), 0, { t: 'start' }));
    expect(s.game!.setup.map).toBe('sushi');
    // 字段都写满、计数都到上限（不管合不合法，只量最长）
    const longest: Rec = { m: 'LR'.repeat(25), a: 88, p: 100, f: -1, p1: 9, p2: 4, fork: 1, b10: 10, b20: 10, b50: 1, lid: true, plane: true, w: -5 };
    s = { ...s, game: { ...s.game!, log: Array.from({ length: 90 }, () => longest), anim: 1 } };
    const bytes = snapshotBytes(R, s);
    console.log(`快照（寿司长台 3v3、90 手最长的 Rec）：${bytes} 字节，上限 ${LIMIT}`);
    expect(bytes).toBeLessThanOrEqual(LIMIT);
  });

  it('真打完的 3v3（结算页，还带着整局）远在上限以内：厨房面团岛、寿司长台', () => {
    for (const map of ['kitchen', 'sushi'] as const) {
      const s = playOut(R.resume!(ok(lobby(3, map), 0, { t: 'start' })));
      const bytes = snapshotBytes(R, s);
      console.log(`快照（真打完的 ${map} 3v3，${s.game!.log.length} 手）：${bytes} 字节`);
      expect(bytes).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('准备阶段的快照很小', () => {
    expect(snapshotBytes(R, lobby(3))).toBeLessThan(3000);
  });
});

describe('动画停顿（net/anim.ts）', () => {
  it('飞行放慢 1.6 倍（多出来的最多 1 秒），连发第 3 轮起翻倍着放快', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(volleyPace)).toEqual([1, 1, 3, 6, 12, 24, 48, 384]);
    // 96 步（典型的一发，规则 1.6 秒）：画面 2.56 秒
    expect(flightMs(96, 1)).toBe(2560);
    expect(flightMs(96, 1) / 1600).toBeCloseTo(FLIGHT_SLOW_PCT / 100);
    // 高抛 120 步（2 秒）：多出来的封顶 1 秒
    expect(flightMs(120, 1)).toBe(2000 + FLIGHT_EXTRA_MAX);
    expect(flightMs(120, 3)).toBe(1000);
  });

  it('最长的一手（三个 +2、三岔 + 连发 +1 + 连发 +2 满力往天上打）停顿不超过 20 秒', () => {
    let worst = 0;
    for (const map of ['kitchen', 'breakfast', 'bento'] as const) {
      for (const seed of [1, 2, 3]) {
        for (const facing of [1, -1] as const) {
          for (const [weapon, angle] of [['rocket', 88], ['rocket', 74], ['carrot', 75]] as const) {
            for (const l of [{ p2: 3 }, { fork: 1, p1: 1, p2: 1 }]) {
              const setup = vs(1, { map });
              const s = newGame([seed, 7, 7, 7, 7, 7, 7, 7], { ...setup, players: setup.players.map((p) => ({ ...p, weapon })) });
              s.actor = 0;
              const r = apply(s, { t: 'fire', angle, power: 100, facing, ...l });
              if (r.ok) worst = Math.max(worst, playMs(r.events, 100));
            }
          }
        }
      }
    }
    expect(worst).toBeGreaterThan(15_000);
    expect(worst).toBeLessThanOrEqual(20_000);
  });
});
