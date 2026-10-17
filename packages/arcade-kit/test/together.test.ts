/**
 * 搭子战绩上报（0.13.0，平台 15.19）：reportTogether 什么时候跳过、正常调用、异常吞掉；假钱包的 together 照平台的形状检查、按 op 去重；
 * GameRoom.reportMatch 按开打后绑的人认座位、电脑座位不报，op 带房间码和开房时刻。
 */
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roomStub } from '../src/internal.ts';
import type { StateMsg } from '../src/protocol.ts';
import { reportTogether, togetherOp, type TogetherPlayer } from '../src/room.ts';
import type { FakeBank } from '../src/testing.ts';
import { freezeClock, join, openRoom, resetMeter } from './helpers.ts';
import type { ChattyRoom, ToyView } from './worker.ts';

const two: TogetherPlayer[] = [
  { userId: 'u1', team: 0, win: true },
  { userId: 'u2', team: 1, win: false },
];

/** 假的钱包绑定：记下每次调用，回给定的结果或者抛错 */
function wallet(reply: unknown | Error) {
  const calls: unknown[] = [];
  return {
    calls,
    env: {
      WALLET: {
        together: async (req: unknown) => {
          calls.push(req);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
}

const OP = 'room123-abc-1';

describe('reportTogether', () => {
  it('没有 WALLET（单独部署）、WALLET 没有 together（平台还没上）：跳过，不报错', async () => {
    expect(await reportTogether({}, OP, two)).toBeNull();
    expect(await reportTogether(undefined, OP, two)).toBeNull();
    expect(await reportTogether({ WALLET: { view: () => null } }, OP, two)).toBeNull();
  });

  it('去重后不到 2 个真人、超过 8 个、op 不合格：跳过，不调平台', async () => {
    const w = wallet({ ok: true, pairs: 1 });
    expect(await reportTogether(w.env, OP, [two[0]!])).toBeNull();
    expect(await reportTogether(w.env, OP, [two[0]!, { ...two[0]!, win: false }])).toBeNull();
    expect(await reportTogether(w.env, OP, Array.from({ length: 9 }, (_, i) => ({ userId: `u${i}`, win: true })))).toBeNull();
    expect(await reportTogether(w.env, 'short', two)).toBeNull();
    expect(await reportTogether(w.env, 'bad op!x', two)).toBeNull();
    expect(w.calls).toHaveLength(0);
  });

  it('正常：整桌一次报上去，同一个人只留第一个，回话原样返回', async () => {
    const w = wallet({ ok: true, pairs: 1 });
    expect(await reportTogether(w.env, OP, [...two, { userId: 'u1', team: 1, win: false }, { userId: 'u3', win: true }])).toEqual({ ok: true, pairs: 1 });
    expect(w.calls).toEqual([{ op: OP, players: [...two, { userId: 'u3', win: true }] }]);
    const busy = wallet({ ok: false, error: 'busy' });
    expect(await reportTogether(busy.env, OP, two)).toEqual({ ok: false, error: 'busy' });
    // 不重试
    expect(busy.calls).toHaveLength(1);
  });

  it('RPC 抛错：吞掉回 null，只记错误类型，日志里没有 userId；不重试', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = wallet(new TypeError('boom u1'));
    expect(await reportTogether(w.env, OP, two)).toBeNull();
    expect(w.calls).toHaveLength(1);
    expect(log).toHaveBeenCalledWith('together failed', 'TypeError');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/u1|u2/);
    log.mockRestore();
  });

  it('togetherOp：房间码 + 开房时刻 + 第几场，只用平台认的字符，8–64 位', () => {
    expect(togetherOp('123456', 1_700_000_000_000, 3)).toBe(`123456-${(1_700_000_000_000).toString(36)}-3`);
    expect(togetherOp('ab', 1, 'x y')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(togetherOp('a'.repeat(80), 1, 1)).toHaveLength(64);
    expect(togetherOp('123456', 1, 1)).not.toBe(togetherOp('123456', 2, 1));
  });
});

const bankOf = (userId: string) => env.FAKE_BANK.get(env.FAKE_BANK.idFromName(userId));
const tog = (userId: string) => runInDurableObject(bankOf(userId), (b: FakeBank) => b.together);
let n = 0;
const uid = (p: string) => `${p}${(n++).toString().padStart(5, '0')}`;

describe('假钱包的 together（arcade-kit/testing）', () => {
  it('形状不对 bad_request（照平台的 parseTogether）；没绑游戏 bad_game', async () => {
    const [a, b] = [uid('t'), uid('t')];
    const ok = { op: uid('op-'), players: [{ userId: a, team: 0, win: true }, { userId: b, team: 1, win: false }] };
    for (const bad of [
      null,
      { ...ok, op: 'short' },
      { ...ok, players: ok.players.slice(0, 1) },
      { ...ok, players: Array.from({ length: 9 }, (_, i) => ({ userId: `x${i}`, win: true })) },
      { ...ok, players: [ok.players[0], ok.players[0]] },
      { ...ok, players: [ok.players[0], { userId: b, team: 4, win: true }] },
      { ...ok, players: [ok.players[0], { userId: b, team: 1.5, win: true }] },
      { ...ok, players: [ok.players[0], { userId: b, win: 'yes' }] },
      { ...ok, players: [ok.players[0], { userId: '', win: true }] },
    ]) {
      expect(await env.WALLET.together(bad)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(await env.WALLET_BARE.together(ok)).toEqual({ ok: false, error: 'bad_game' });
    expect(await tog(a)).toEqual([]);
  });

  it('记到每个人头上、两两算一对；同一个 op 重报不加', async () => {
    const [a, b, c] = [uid('t'), uid('t'), uid('t')];
    const req = { op: uid('op-'), players: [{ userId: a, team: 0, win: true }, { userId: b, team: 0, win: true }, { userId: c, team: 1, win: false }] };
    expect(await env.WALLET.together(req)).toEqual({ ok: true, pairs: 3 });
    expect(await env.WALLET.together(req)).toEqual({ ok: true, pairs: 0 });
    for (const u of [a, b, c]) expect(await tog(u)).toEqual([{ game: 'toy', op: req.op, players: req.players }]);
  });
});

describe('GameRoom.reportMatch', () => {
  beforeEach(async () => {
    freezeClock();
    await resetMeter();
  });
  afterEach(() => vi.useRealTimers());

  const chatty = (code: string) => roomStub(env.CHATTY_ROOM, code) as DurableObjectStub<ChattyRoom>;
  const P = '/chatty';

  it('按开打后绑的人认座位：电脑座位不报；op 带房间码；报到 WALLET 的 together', async () => {
    const [u1, u2] = [uid('r'), uid('r')];
    const code = await openRoom(u1, P);
    const a = (await join(code, u1, P)).conn;
    const b = (await join(code, u2, P)).conn;
    b.send({ t: 'sit', seat: 1 });
    await b.until((m) => m.t === 'state' && m.you.seat === 1);
    a.send({ t: 'start' });
    await a.until((m) => m.t === 'state' && (m as StateMsg<ToyView>).room.status === 'playing');
    const players = [0, 1, 2, 3].map((seat) => ({ seat, team: seat % 2, win: seat % 2 === 0 }));
    expect(await runInDurableObject(chatty(code), (r: ChattyRoom) => r.tryReportMatch(players, 1))).toBe(2);
    // 交给 waitUntil 去办：等它落到假钱包里
    let got: Awaited<ReturnType<typeof tog>> = [];
    for (let i = 0; i < 50 && got.length === 0; i++) {
      got = await tog(u1);
      if (!got.length) await new Promise((ok) => setTimeout(ok, 10));
    }
    expect(got).toHaveLength(1);
    expect(got[0]!.op.startsWith(`${code}-`)).toBe(true);
    expect(got[0]!.players).toEqual([
      { userId: u1, team: 0, win: true },
      { userId: u2, team: 1, win: false },
    ]);
    // 同一场再报：平台（假钱包）按 op 去重
    await runInDurableObject(chatty(code), (r: ChattyRoom) => r.tryReportMatch(players, 1));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(await tog(u2)).toHaveLength(1);
    // 只剩 1 个真人：不报
    expect(await runInDurableObject(chatty(code), (r: ChattyRoom) => r.tryReportMatch(players.slice(0, 1), 2))).toBe(0);
  });
});
