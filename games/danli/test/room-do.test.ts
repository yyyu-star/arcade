/**
 * 好友房在真的 kit 房间里走一遍（test/room-harness.ts：Node 里顶替 Workers 运行时）：
 * 开房 → 房主开局（kit 层面）→ 朋友进房坐下 → 房主改对阵、加电脑 → 准备、开打 → 真人出手、超时弃权、电脑由闹钟一个一个出 →
 * 驱逐重建、掉线托管、重连拿全量快照 → 打完 → 再来一局。每一步写入不超过 2 行（docs/platform-backend.md 4.2，开房那一步另算）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planLite } from '../src/ai/online.ts';
import type { State } from '../src/core/types.ts';
import { startOf, stepRec } from '../src/net/replay.ts';
import { CLIENT_VERSION, turnAct, type NetAction, type RoomView } from '../src/net/rules.ts';
import { clock, Harness, roomClass, type Peer } from './room-harness.ts';

beforeEach(() => clock.install());
afterEach(() => {
  clock.restore();
  vi.restoreAllMocks();
});

/**
 * kit 开房、开局的种子用 crypto.getRandomValues：整局跑完的那条要走到"驱逐、掉线托管、超时弃权"每一步，
 * 随机种子偶尔一局结束得太早（0.3.0 不推人以后更常见），所以换成写死种子的序列，每次都是同一局。
 */
function fixedCrypto(seed: number): void {
  let x = seed >>> 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
    const a = arr as unknown as Uint8Array | Uint32Array;
    for (let i = 0; i < a.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      a[i] = x;
    }
    return arr;
  });
}

/** 页面的做法：按视图重放出局面（没有种子） */
function replayView(v: RoomView): State {
  const g = v.game!;
  let s = startOf(g);
  for (const r of g.log) {
    const out = stepRec(s, r, r.w);
    if ('error' in out) throw new Error(out.error);
    s = out.state;
  }
  return s;
}

/** 轮到这个页面时出的那一手：本机按视图重放，联机档电脑替他想 */
function myTurn(v: RoomView): NetAction {
  const p = planLite(replayView(v));
  return turnAct(p.moves, p.angle, p.power, p.facing, p.loadout);
}

async function setup(): Promise<{ h: Harness; a: Peer; b: Peer }> {
  const h = new Harness(await roomClass());
  await h.create('userA');
  const a = await h.join('userA', '小A');
  // 房主一进房就让 kit 开局：房间从此一直"在打"，准备、对局、结算都在游戏的状态里
  await h.send(a, { t: 'start' });
  expect(a.room!.status).toBe('playing');
  expect(a.view!.phase).toBe('lobby');
  const b = await h.join('userB', '小B');
  expect(h.steps.at(-1)).toBe(0);
  await h.send(b, { t: 'sit', seat: 1 });
  a.pump();
  return { h, a, b };
}

describe('好友房（真的 kit 房间）', () => {
  it('从开房到打完、再来一局，每一步写入不超过 2 行', async () => {
    fixedCrypto(1);
    const { h, a, b } = await setup();
    // 朋友坐下就进了黄队 1 号位；房主改 2v2、加一个电脑（蓝队 2 号），朋友准备，开打（2 对 1）
    expect(a.view!.slots[3]).toMatchObject({ k: 'human', seat: 1 });
    await h.act(a, { t: 'format', n: 2 });
    await h.act(a, { t: 'addbot', slot: 1 });
    await h.act(b, { t: 'look', look: 'rabbit' });
    await h.act(b, { t: 'weapon', weapon: 'rocket' });
    expect((await h.act(a, { t: 'start' })).some((m) => m.t === 'error' && m.code === 'not_ready')).toBe(true);
    await h.act(b, { t: 'ready', on: true });
    await h.act(a, { t: 'start' });
    b.pump();
    expect(b.view!.phase).toBe('play');
    expect(b.view!.game!.setup.players).toHaveLength(3);
    // 开局先停一会儿（大家换到对局页），闹钟响了才轮到第一个人
    expect(a.room!.pause?.until).toBeGreaterThan(clock.now);

    let turns = 0;
    let timeouts = 0;
    let evicted = false;
    let dropped = false;
    let tookOver = 0;
    while (a.view!.phase === 'play') {
      if (++turns > 400) throw new Error('打不完');
      a.pump();
      b.pump();
      if (a.view!.phase !== 'play') break;
      const room = a.room!;
      if (room.pause || !room.turn) {
        await h.alarm();
        continue;
      }
      const seat = room.turn.seat;
      const who = seat === a.seat ? a : seat === b.seat ? b : null;
      if (!who) {
        // 电脑的回合 kit 马上就出了，不会停在这里
        throw new Error(`停在了没人的座位 ${seat}`);
      }
      const log = who.view!.game!.log.length;
      if (who === b && log % 5 === 2) {
        // 朋友这一手不出：30 秒到了按超时弃权
        await h.alarm();
        a.pump();
        expect(a.view!.game!.log.at(-1)).toMatchObject({ pass: true });
        timeouts++;
        continue;
      }
      if (who === b && !evicted && log > 6) {
        // 房间被驱逐（内存全丢），下一个入口从存储重建，接着打
        h.evict();
        evicted = true;
      }
      if (who === a && !dropped && log > 10) {
        // 房主掉线：60 秒后电脑托管、替他出这一手；回来以后拿到全量快照，和一直在线的朋友看到的一样
        dropped = true;
        await h.drop(a);
        b.pump();
        expect(b.room!.seats[a.seat!]!.away).toBe(true);
        // 这一手 30 秒到了先按超时弃权；掉线满 60 秒转电脑托管，下一次轮到他时电脑替他出
        const mine = (v: RoomView): number => v.game!.owners.indexOf(a.seat!);
        let autoTurns = 0;
        for (let k = 0; k < 60 && b.view!.phase === 'play' && autoTurns === 0; k++) {
          const r = b.room!;
          if (!r.pause && r.turn?.seat === b.seat) await h.act(b, myTurn(b.view!));
          else {
            const before = replayView(b.view!).actor;
            const wasAuto = r.seats[a.seat!]!.auto;
            await h.alarm();
            b.pump();
            if (wasAuto && before === mine(b.view!) && b.view!.game!.log.at(-1)!.a !== undefined) autoTurns++;
          }
          b.pump();
        }
        expect(b.room!.seats[a.seat!]!.auto || b.view!.phase !== 'play').toBe(true);
        tookOver = autoTurns;
        const back = await h.join('userA', '小A');
        b.pump();
        expect(back.view).toEqual(b.view);
        expect(JSON.stringify(replayView(back.view!).chars)).toBe(JSON.stringify(replayView(b.view!).chars));
        Object.assign(a, { ws: back.ws });
        a.seq = back.seq;
        a.view = back.view;
        a.room = back.room;
        a.seat = back.seat;
        (a as unknown as { read: number }).read = back.ws.sent.length;
        continue;
      }
      // 不该他的时候发：回固定短码
      const other = who === a ? b : a;
      const before = other.errors.length;
      await h.act(other, { t: 'pass' });
      expect(other.errors.slice(before)).toEqual(['not_your_turn']);
      await h.act(who, myTurn(who.view!));
      expect(who.errors.slice(-1)[0] ?? '').not.toMatch(/bad|illegal|rule/);
    }
    a.pump();
    b.pump();
    expect(a.view!.phase).toBe('result');
    expect(timeouts).toBeGreaterThan(0);
    expect(evicted && dropped).toBe(true);
    expect(tookOver).toBe(1);
    // 结算：打完的局还在视图里（结算页要用），页面重放和服务端一致
    const end = replayView(a.view!);
    expect(end.phase).toBe('over');
    // 再来一局：大家回到同一个房间，位子和选择都还在
    await h.act(b, { t: 'again' });
    expect(b.errors.at(-1)).toBe('not_host');
    await h.act(a, { t: 'again' });
    b.pump();
    expect(b.view!.phase).toBe('lobby');
    expect(b.view!.slots.find((x) => x?.k === 'human' && x.seat === b.seat)).toMatchObject({ look: 'rabbit', weapon: 'rocket', ready: false });
    console.log(`打了 ${turns} 步，超时弃权 ${timeouts} 次，写入：最多一步 ${h.maxWrites} 行、一共 ${h.steps.reduce((x, y) => x + y, 0)} 行`);
    expect(h.maxWrites).toBeLessThanOrEqual(2);
  });

  it('旧页面（clientVersion 低于现在的）进房被拒（4005，提示刷新），现在的版本能进', async () => {
    expect(CLIENT_VERSION).toBe(3);
    const h = new Harness(await roomClass());
    await h.create('userA');
    const old = await h.join('userA', '小A', 1);
    expect(old.ws.closed?.code).toBe(4005);
    const a = await h.join('userA', '小A', CLIENT_VERSION);
    expect(a.ws.closed).toBeNull();
    await h.send(a, { t: 'start' });
    expect(a.room!.status).toBe('playing');
    const b = await h.join('userB', '小B', CLIENT_VERSION - 1);
    expect(b.ws.closed?.code).toBe(4005);
    const b2 = await h.join('userB', '小B');
    expect(b2.ws.closed).toBeNull();
    expect(b2.view!.phase).toBe('lobby');
  });

  it('旧操作（baseSeq 过时）回 stale，不套到新的一手上', async () => {
    const { h, a, b } = await setup();
    await h.act(b, { t: 'ready', on: true });
    await h.act(a, { t: 'start' });
    a.pump();
    b.pump();
    await h.alarm();
    a.pump();
    b.pump();
    const p = a.room!.turn!.seat === a.seat ? a : b;
    const old = p.seq;
    await h.act(p, myTurn(p.view!));
    await h.alarm();
    p.pump();
    if (p.room!.turn?.seat === p.seat) return;
    const q = p === a ? b : a;
    q.pump();
    await h.send(q, { t: 'act', moveId: 'old-1', baseSeq: old, action: { t: 'pass' } });
    expect(q.errors.at(-1)).toBe('stale');
    expect(h.maxWrites).toBeLessThanOrEqual(2);
  });

  it('朋友离座：准备阶段他的位子空出来；房主离座，房主交给还在的人', async () => {
    const { h, a, b } = await setup();
    await h.send(b, { t: 'leave' });
    a.pump();
    expect(a.view!.slots.some((x) => x?.k === 'human' && x.seat === 1)).toBe(false);
    const c = await h.join('userC', '小C');
    await h.send(c, { t: 'sit', seat: 2 });
    await h.send(a, { t: 'leave' });
    c.pump();
    expect(c.view!.host).toBe(2);
    await h.act(c, { t: 'format', n: 3 });
    expect(c.view!.format).toBe(3);
    expect(h.maxWrites).toBeLessThanOrEqual(2);
  });

  it('准备阶段房主掉线满 60 秒：房主交给 B；A 回来不收回；都掉线了不会一直响闹钟', async () => {
    const { h, a, b } = await setup();
    expect(b.view!.host).toBe(0);
    await h.drop(a);
    b.pump();
    expect(b.room!.seats[0]!.away).toBe(true);
    // 掉线宽限（60 秒）到了才交：下一个闹钟就是那时候
    expect(b.view!.host).toBe(0);
    await h.alarm();
    b.pump();
    expect(b.view!.host).toBe(1);
    expect(clock.now - 1_800_000_000_000).toBeGreaterThanOrEqual(60_000);
    // A 回来：不收回
    const back = await h.join('userA', '小A');
    expect(back.view!.host).toBe(1);
    // 新房主 B 能改对阵，A 不能
    await h.act(back, { t: 'format', n: 2 });
    expect(back.errors.at(-1)).toBe('not_host');
    await h.act(b, { t: 'format', n: 2 });
    b.pump();
    expect(b.view!.format).toBe(2);
    // 两个都掉线：B 交不出去（A 刚才做过事，可以接）→ 交给 A；A 也掉线 → 交不出去就停，不会一直响
    await h.drop(back);
    await h.drop(b);
    let alarms = 0;
    while (h.ctx.storage.alarm !== null && alarms < 20) {
      await h.alarm();
      alarms++;
    }
    expect(alarms).toBeLessThan(10);
    expect(h.maxWrites).toBeLessThanOrEqual(2);
  });
});
