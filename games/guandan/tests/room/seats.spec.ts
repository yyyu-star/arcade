/**
 * 开打以后座位绑人（arcade-kit 0.1.1）和结算页等人（docs 9.1），用真的 Durable Object 和闹钟。
 * 回归：旧仓库 PR 50 的独立审阅发现离座后去接管对手的电脑座位能看到对手的手牌——坐过的人只能回自己的座位，新人接管后也固定下来。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { READY_MS, guandanRoom as R } from '../../src/net/rules.ts';
import { advance, fireDueAlarms, freezeClock, join, type Conn } from './helpers.ts';
import { Table } from './table.ts';

beforeEach(() => freezeClock());

/** 发一条入座/离座，等房间回音（新的状态，或者一条错误）；返回错误码，成功为 null */
async function send(conn: Conn, msg: { t: 'sit'; seat: number } | { t: 'leave' }): Promise<string | null> {
  const n = conn.msgs.length;
  conn.send(msg);
  await conn.waitFor(() => conn.msgs.length > n, msg.t);
  const m = conn.msgs.slice(n).find((x) => x.t === 'error');
  return m && m.t === 'error' ? m.code : null;
}

describe('开打以后座位绑人', () => {
  it('坐过的人离座后不能换到别的座位（not_your_seat），只能回自己的；新人接管没绑人的电脑座位后也不能再换', async () => {
    // 2 个真人坐 0、1，开局时 2、3 由电脑补（没绑人）
    const t = new Table({ humans: 2, tag: 'bind' });
    await t.open();
    for (let i = 0; i < 20; i++) expect(await t.step()).toBe(true);
    const c0 = t.seats.get(0)!;
    expect(await send(c0, { t: 'leave' })).toBeNull();
    await t.settle();
    const room = c0.latestRoom()!;
    // 离座的座位由电脑代打、还绑着他：显示原主人的昵称，别人接管不了
    expect(room.seats[0]).toMatchObject({ kind: 'ai', reserved: true });
    expect(room.seats[0]!.name).toEqual(expect.any(String));
    expect(room.seats[3]).toMatchObject({ kind: 'ai', reserved: false, name: null });
    expect(c0.latest()!.you).toEqual({ seat: null, bound: 0 });
    // 换到对手（3 号位，没绑人的电脑）：不行
    expect(await send(c0, { t: 'sit', seat: 3 })).toBe('not_your_seat');
    expect(await send(c0, { t: 'sit', seat: 2 })).toBe('not_your_seat');
    // 回自己的座位：可以，看到的是自己的手牌
    expect(await send(c0, { t: 'sit', seat: 0 })).toBeNull();
    await t.settle();
    expect(c0.latest()!.you.seat).toBe(0);
    expect(c0.latestView()!.view.hand).toEqual(t.t!.row!.game!.g.hands[0]);

    // 新人：接管别人坐过的座位不行（seat_reserved），接管没绑人的电脑座位可以，之后不能再换
    expect(await send(c0, { t: 'leave' })).toBeNull();
    const { conn: nu, welcome } = await join(t.code, 'bind-new');
    expect(welcome.you).toEqual({ seat: null, bound: null });
    expect(await send(nu, { t: 'sit', seat: 0 })).toBe('seat_reserved');
    expect(await send(nu, { t: 'sit', seat: 3 })).toBeNull();
    await t.settle();
    expect(nu.latest()!.you).toEqual({ seat: 3, bound: 3 });
    expect(await send(nu, { t: 'leave' })).toBeNull();
    expect(await send(nu, { t: 'sit', seat: 2 })).toBe('not_your_seat');
    expect(await send(nu, { t: 'sit', seat: 3 })).toBeNull();
    // 整个过程每条下行都按真实状态查过泄漏（Table.settle）
    await t.settle();
    expect(t.problems).toEqual([]);
    nu.ws.close();
    t.close();
  });
});

describe('结算页等人', () => {
  it('1 真人 + 3 电脑、电脑拿头游：结算停住等真人；他点继续就开下一副；不点则 20 秒到点由房间开', async () => {
    const t = new Table({ humans: 1, tag: 'settle' });
    await t.open();
    const row = () => t.t!.row!;
    const atAiHeadSettle = () => row().game!.g.phase === 'dealEnd' && row().game!.g.lastDeal!.order[0] !== 0;
    const c0 = t.seats.get(0)!;

    for (const how of ['ready', 'timeout'] as const) {
      for (let i = 0; i < 4000 && !atAiHeadSettle(); i++) expect(await t.step()).toBe(true);
      expect(atAiHeadSettle()).toBe(true);
      // 电脑一次最多连出 3 手：最后几手和电脑点继续可能排在后面的闹钟里
      for (let i = 0; i < 10 && R.actors(row().game!).seats.some((x) => x !== 0); i++) expect(await t.runNextAlarm()).toBe(true);
      const game = row().game!;
      // 电脑都点了，只差真人；房间告诉大家还在等谁、到几点
      expect(game.ready).toEqual([false, true, true, true]);
      const turn = c0.latestRoom()!.turn!;
      expect(turn.seats).toEqual([0]);
      // 时限按 20 秒算（从进入结算起，加上前面电脑出牌的播放时间）
      expect(turn.deadline! - Date.now()).toBeGreaterThan(READY_MS - 10_000);
      expect(turn.deadline! - Date.now()).toBeLessThanOrEqual(READY_MS + 10 * 1300);
      // 到点前 1 秒：还停在结算（电脑拿了头游也不会自己开）
      advance(turn.deadline! - 1000 - Date.now());
      await fireDueAlarms(t.code);
      await t.settle();
      expect(row().game!.g.phase).toBe('dealEnd');
      expect(row().game!.g.dealNo).toBe(game.g.dealNo);
      if (how === 'ready') {
        const res = await c0.result(c0.act({ type: 'ready' }));
        expect(res.t).toBe('state');
      } else {
        advance(2000);
        await fireDueAlarms(t.code);
      }
      await t.settle();
      expect(row().game!.g.dealNo).toBe(game.g.dealNo + 1);
      expect(R.actors(row().game!).group).not.toBe(`settle-${game.g.dealNo}`);
    }
    expect(t.problems).toEqual([]);
    t.close();
  });
});
