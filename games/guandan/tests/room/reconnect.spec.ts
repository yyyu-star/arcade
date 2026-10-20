/**
 * 断线重连（验收 b，服务端）：掉线 10 秒回来、掉线超过 60 秒宽限由电脑托管再交还、掉线时轮到他 30 秒超时代出、同一账号再连旧连接 4001。
 * 都是 4 个真人的桌，用真的 Durable Object 和闹钟；每一步照样核对写入、seq、隐藏信息（Table.settle）。
 */
import { CLOSE } from 'arcade-kit/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { canPass, viewFor } from '../../src/variants/guandan/core/index.ts';
import { guandanRoom as R } from '../../src/variants/guandan/net/rules.ts';
import { advance, fireDueAlarms, freezeClock, join, truth } from './helpers.ts';
import { Table } from './table.ts';

beforeEach(() => freezeClock());

const row = (t: Table) => t.t!.row!;

/** 打到条件成立（最多 n 步） */
async function playUntil(t: Table, pred: () => boolean, n = 400): Promise<void> {
  for (let i = 0; i < n && !pred(); i++) expect(await t.step()).toBe(true);
  expect(pred()).toBe(true);
}

async function newTable(tag: string): Promise<Table> {
  const t = new Table({ humans: 4, tag });
  await t.open();
  return t;
}

describe('断线重连', () => {
  it('掉线 10 秒回来：座位还在，看到的是最新的牌局，接着打', async () => {
    const t = await newTable('re10');
    await playUntil(t, () => row(t).seq > t.startSeq + 20);
    await t.drop(1);
    expect(row(t).seats[1]).toMatchObject({ kind: 'human', userId: t.user(1), auto: false });
    expect(row(t).seats[1]!.awaySince).toBe(Date.now());
    // 别人看到他掉线了
    expect(t.seats.get(0)!.latestRoom()!.seats[1]).toMatchObject({ away: true, auto: false });
    const before = row(t).seq;
    // 他不在的这 10 秒里别人照样出（轮到他时桌上等他）
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000 && R.turn(row(t).game!) !== 1) expect(await t.step()).toBe(true);
    advance(Math.max(0, t0 + 10_000 - Date.now()));
    expect(await fireDueAlarms(t.code)).toBeLessThanOrEqual(1);
    await t.settle();
    expect(row(t).seats[1]!.auto).toBe(false);

    const { welcome } = await t.rejoin(1);
    expect(welcome.you.seat).toBe(1);
    expect(welcome.seq).toBe(row(t).seq);
    expect(welcome.seq).toBeGreaterThan(before);
    expect(welcome.room.seats[1]).toMatchObject({ kind: 'human', away: false, auto: false });
    expect(welcome.view!.view.hand).toEqual(row(t).game!.g.hands[1]);
    expect((await truth(t.code)).last).toBeLessThanOrEqual(2);
    // 回来以后他自己出牌
    const acksBefore = t.seats.get(1)!.msgs.filter((m) => m.t === 'state' && m.ack).length;
    await playUntil(t, () => t.seats.get(1)!.msgs.filter((m) => m.t === 'state' && m.ack).length >= acksBefore + 3);
    expect(t.problems).toEqual([]);
    expect((await truth(t.code)).max).toBeLessThanOrEqual(2);
    t.close();
  });

  it('掉线 70 秒：超过 60 秒宽限由电脑托管（不再停在他身上等），回来交还', async () => {
    const t = await newTable('re70');
    await playUntil(t, () => row(t).seq > t.startSeq + 10);
    const t0 = Date.now();
    await t.drop(2);
    let autoAt: number | null = null;
    let autoTurns = 0;
    while (Date.now() - t0 < 70_000) {
      expect(await t.step()).toBe(true);
      const r = row(t);
      if (autoAt === null && r.seats[2]!.auto) {
        autoAt = Date.now();
        // 宽限到点的那个闹钟把他改成托管；别人看到"电脑在代打"
        expect(autoAt - t0).toBeGreaterThanOrEqual(60_000);
        expect(t.seats.get(0)!.latestRoom()!.seats[2]).toMatchObject({ away: true, auto: true });
      }
      if (autoAt !== null) {
        // 托管期间轮到他电脑马上出：静下来的时候不会停在他身上
        expect(R.turn(r.game!)).not.toBe(2);
        const hist = r.game!.g.history;
        if (hist.length && hist[hist.length - 1]!.seat === 2) autoTurns++;
      }
    }
    expect(autoAt).not.toBeNull();
    expect(autoTurns).toBeGreaterThan(0);
    const { welcome } = await t.rejoin(2);
    expect(welcome.you.seat).toBe(2);
    expect(welcome.room.seats[2]).toMatchObject({ kind: 'human', away: false, auto: false });
    expect(row(t).seats[2]).toMatchObject({ auto: false, awaySince: null });
    // 交还了：再轮到他时桌上等他出，有 30 秒的截止时间
    await playUntil(t, () => R.turn(row(t).game!) === 2);
    expect(t.seats.get(2)!.latestRoom()!.turn).toMatchObject({ seat: 2 });
    expect(t.seats.get(2)!.latestRoom()!.turn!.deadline).toBeTypeOf('number');
    const acks = () => t.seats.get(2)!.msgs.filter((m) => m.t === 'state' && m.ack).length;
    await playUntil(t, () => acks() >= 2);
    expect(t.problems).toEqual([]);
    expect((await truth(t.code)).max).toBeLessThanOrEqual(2);
    t.close();
  });

  it('掉线时轮到他：30 秒到了按 timeout 代出——跟牌时能不要就不要，领出时出一手；重连不重置这 30 秒', async () => {
    const t = await newTable('reto');
    // 跟牌（能不要）时轮到 3 号
    await playUntil(t, () => {
      const g = row(t).game!.g;
      return g.phase === 'play' && g.turn === 3 && canPass(viewFor(g, 3));
    });
    const deadline = t.seats.get(0)!.latestRoom()!.turn!.deadline!;
    const prev = row(t).game!;
    await t.drop(3);
    // 掉线 10 秒又回来：截止时间不变（不然隔 29 秒重连一次就能一直拖着）
    advance(10_000);
    const { welcome } = await t.rejoin(3);
    expect(welcome.room.turn).toEqual({ seat: 3, deadline, seats: [3] });
    await t.drop(3);
    advance(deadline + 1 - Date.now());
    expect(await fireDueAlarms(t.code)).toBeGreaterThanOrEqual(1);
    await t.settle();
    // 到点代出带 idle 记号（0.6.3：数他连着几手没自己出）
    expect(R.timeout!(prev, 3)).toEqual({ type: 'pass', idle: true });
    expect(row(t).game).toEqual(R.apply(prev, 3, { type: 'pass', idle: true }));
    expect(row(t).game!.g.history.at(-1)).toEqual({ seat: 3, play: null });

    // 领出时（不能不要）轮到他：代出 timeout 给的那一手
    await t.rejoin(3);
    await playUntil(t, () => {
      const g = row(t).game!.g;
      return g.phase === 'play' && g.turn === 3 && !canPass(viewFor(g, 3));
    });
    const prev2 = row(t).game!;
    await t.drop(3);
    advance(t.seats.get(0)!.latestRoom()!.turn!.deadline! + 1 - Date.now());
    expect(await fireDueAlarms(t.code)).toBeGreaterThanOrEqual(1);
    await t.settle();
    const forced = R.timeout!(prev2, 3);
    expect(forced.type).toBe('play');
    expect(row(t).game).toEqual(R.apply(prev2, 3, forced));
    expect(t.problems).toEqual([]);
    expect((await truth(t.code)).max).toBeLessThanOrEqual(2);
    t.close();
  });

  it('同一账号再连一次：旧连接收到 4001，新连接接着用这个座位；不写库', async () => {
    const t = await newTable('dup');
    await playUntil(t, () => row(t).seq > t.startSeq + 5);
    const old = t.seats.get(1)!;
    const seq = row(t).seq;
    const { conn, welcome } = await join(t.code, t.user(1));
    expect(await old.closedWith()).toBe(CLOSE.replaced);
    expect(welcome.you.seat).toBe(1);
    expect(welcome.seq).toBe(seq);
    const after = await truth(t.code);
    expect(after.last).toBe(0);
    expect(after.row!.seq).toBe(seq);
    t.seats.set(1, conn);
    await playUntil(t, () => conn.msgs.filter((m) => m.t === 'state' && m.ack).length >= 2);
    expect(t.problems).toEqual([]);
    t.close();
  });
});
