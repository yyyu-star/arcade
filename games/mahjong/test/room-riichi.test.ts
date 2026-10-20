/**
 * 好友房的立直（src/room/rules.ts 接 src/core/variants/riichi）：开房选项、实盘打完一场的结回、一局打到一半离座的结算、
 * 隐藏信息和快照大小、声明窗口里真人答了不露人。房间这一层不认识玩法，这里只验证立直接上以后这些规矩照样成立。
 */
import { snapshotBytes } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { describe, expect, test } from 'vitest';
import { riichi as RC, type RcState, type RcView } from '../src/core/variants/riichi/index.ts';
import { mahjongRoom as G, type RoomAction, type RoomState, type WalletEffect } from '../src/room/rules.ts';
import { RoomTalk } from '../src/room/talk.ts';
import { KEY } from './helpers.ts';

const SHARE = 2_000;
const OK = { ok: true };

function begin(seats: SeatKind[], stakes = 'small', rules: unknown = { length: 'tonpuu' }): RoomState {
  const opts = G.options!({ variant: 'riichi', stakes, rules })!;
  return G.begin!(KEY, 1, { opts, seats });
}

function must(x: RoomState | { error: string }): RoomState {
  if ('error' in x && typeof x.error === 'string') throw new Error(`unexpected error ${x.error}`);
  return x as RoomState;
}

const act = (s: RoomState, seat: number, a: RoomAction) => must(G.apply(s, seat, a));
const fx = (s: RoomState) => G.effects!(s);
const g = (s: RoomState, seat: number | null) => G.view(s, seat).g as RcView;
const seatsOf = (s: RoomState) => {
  const a = G.actors!(s);
  return Array.isArray(a) ? a : a.seats;
};

function settleAll(s0: RoomState): RoomState {
  let s = s0;
  for (let k = 0; k < 20 && fx(s).length; k++) for (const e of fx(s)) s = G.settled!(s, e.id, OK);
  return s;
}

/** 像房间一样推：电脑座位用 ai，真人用 timeout（当他一直没点），停着的就 resume */
function drive(s0: RoomState, steps = 100_000, stop?: (s: RoomState) => boolean): RoomState {
  let s = s0;
  for (let k = 0; k < steps && !G.over(s); k++) {
    if (stop?.(s)) return s;
    const seats = seatsOf(s);
    if (!seats.length) {
      s = G.resume!(s);
      continue;
    }
    const seat = seats[0]!;
    s = act(s, seat, s.kinds[seat] === 'ai' ? G.ai(s, seat) : G.timeout!(s, seat));
  }
  return s;
}

describe('开房选项', () => {
  test('立直的房间：半庄、东风战都能开，娱乐和实盘都行；不合格的规则被拒', () => {
    expect(G.options!({ variant: 'riichi', stakes: 'fun', rules: { length: 'hanchan' } })).toEqual({ variant: 'riichi', stakes: 'fun', rules: { length: 'hanchan' } });
    expect(G.options!({ variant: 'riichi', stakes: 'mid' })).toEqual({ variant: 'riichi', stakes: 'mid', rules: RC.defaults });
    expect(G.options!({ variant: 'riichi', stakes: 'fun', rules: { length: 'west' } })).toBeNull();
    const s = begin(['human', 'human', 'ai', 'ai'], 'fun');
    expect(g(s, 0).variant).toBe('riichi');
  });

  test('页面带玩法 id 发动作：按它解析（立直的出牌和川麻长得一样，不带就会被认成川麻）；不认得的玩法 id 被拒；不带的旧页面按川麻', () => {
    const discard = { t: 'discard', tile: 5 };
    expect(G.parse({ t: 'play', v: 'riichi', a: discard })).toEqual({ t: 'play', v: 'riichi', a: discard });
    expect(G.parse({ t: 'play', v: 'riichi', a: { t: 'discard', tile: 130, riichi: true } })).toEqual({ t: 'play', v: 'riichi', a: { t: 'discard', tile: 130, riichi: true } });
    expect(G.parse({ t: 'play', v: 'nope', a: discard })).toBeNull();
    expect(G.parse({ t: 'play', v: 'riichi', a: { t: 'swap', tiles: [1, 2, 3] } })).toBeNull();
    expect(G.parse({ t: 'play', a: discard })).toEqual({ t: 'play', v: 'sichuan-xuezhan', a: discard });
    // 认成了别的玩法的动作，这一桌不收
    const s = begin(['human', 'human', 'ai', 'ai'], 'fun');
    expect(G.apply(s, s.g ? (s.g as RcState).turn : 0, G.parse({ t: 'play', a: discard })!)).toMatchObject({ error: expect.any(String) });
  });
});

describe('实盘', () => {
  test('东风战打完：每个真人各结回一笔（按"最多赢 3 份"截过、带 rc_ 小结），四家筹码按得分换', () => {
    let s = settleAll(begin(['human', 'human', 'ai', 'ai']));
    s = drive(s);
    expect(G.over(s)).toBe(true);
    const c = fx(s);
    expect(c.map((e) => e.seat).sort()).toEqual([0, 1]);
    const res = RC.result(s.g as RcState);
    for (const e of c as WalletEffect[]) {
      expect(e.kind).toBe('credit');
      expect(e.amount).toBe(Math.max(0, res.seats[e.seat]!.chips));
      expect(e.amount).toBeLessThanOrEqual(4 * SHARE);
      expect(e.stats?.max).toHaveProperty('rc_han');
      expect(JSON.stringify(e.stats).length).toBeLessThanOrEqual(256);
    }
    expect((s.g as RcState).final!.score.reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('一局打到一半离座：电脑替他打完这一局再结回，按那一刻"没打完"算（只算点数差，不是原样退回）', () => {
    let s = settleAll(begin(['human', 'human', 'human', 'ai']));
    // 打到有人输了点数、而且正在一局中间
    s = drive(s, 20_000, (x) => {
      const v = g(x, null);
      return v.phase === 'turn' && v.history.length > 0 && v.seats[0]!.points < 25_000;
    });
    expect(g(s, null).seats[0]!.points).toBeLessThan(25_000);
    s = G.seated!(s, 0, 'ai');
    s = drive(s, 5_000, (x) => fx(x).length > 0);
    expect(g(s, null).phase === 'end' || g(s, null).phase === 'over').toBe(true);
    const c = fx(s).find((e) => e.seat === 0)!;
    expect(c.kind).toBe('credit');
    // 结回的数 = 结算那一刻按没打完算的结果（他点数低于起始，拿回的少于一份）
    expect(c.amount).toBe(RC.result(s.g as RcState).seats[0]!.chips);
    // 一局结束时（不是整场打完）按没打完算：只看点数差
    const st = s.g as RcState;
    if (st.phase === 'end') expect(c.amount).toBe(SHARE - Math.floor(((25_000 - st.points[0]!) * SHARE) / 40_000));
  });
});

describe('隐藏信息和公平', () => {
  test('视图里没有密钥、王牌区，看不到别人的手牌；快照不大', () => {
    let s = settleAll(begin(['human', 'human', 'ai', 'ai'], 'small', { length: 'hanchan' }));
    // 打完一局、下一局打到一半：看小结（和了的人亮出的手牌在 history 里是公开的）也看对局中的隐藏
    s = drive(s, 20_000, (x) => g(x, null).history.length >= 1 && g(x, null).phase === 'turn');
    expect(g(s, null).phase).toBe('turn');
    for (const seat of [null, 0, 1, 2, 3]) {
      const v = G.view(s, seat);
      const json = JSON.stringify(v);
      expect(json).not.toMatch(/"key"|"dead"/);
      (v.g as RcView).seats.forEach((x, i) => {
        if (i !== seat) expect(x.hand, `${seat} 看 ${i}，${(v.g as RcView).phase}`).toBeNull();
      });
    }
    // 立直每局的小结比川麻长（役种表、亮出来的手牌）：半庄打满 11 局实测约 8 KB，西入加连庄按 20 多局留余量
    const end = drive(s);
    expect(snapshotBytes(G, end)).toBeLessThan(24_000);
  });

  test('声明窗口里真人答了、窗口没结束：别人的视图一点不变、步数不加', () => {
    // 四个真人的娱乐房，推到出现一个有两个以上真人有选择的窗口
    let s = begin(['human', 'human', 'human', 'human'], 'fun');
    let found = false;
    for (let k = 0; k < 20_000 && !G.over(s); k++) {
      const st = s.g as RcState;
      const c = st.phase === 'claim' ? st.claim! : null;
      const open = c ? c.opts.map((o, i) => (o.length && c.ans[i] === null ? i : -1)).filter((i) => i >= 0) : [];
      if (open.length >= 2) {
        const seat = open[0]!;
        const others = [null, 0, 1, 2, 3].filter((x) => x !== seat);
        const before = others.map((x) => JSON.stringify(G.view(s, x)));
        const next = act(s, seat, G.parse({ t: 'play', v: 'riichi', a: { t: 'claim', w: c!.id, c: 'pass' } })!);
        expect(others.map((x) => JSON.stringify(G.view(next, x)))).toEqual(before);
        expect(next.n).toBe(s.n);
        found = true;
        break;
      }
      const seats = seatsOf(s);
      if (!seats.length) {
        s = G.resume!(s);
        continue;
      }
      s = act(s, seats[0]!, G.timeout!(s, seats[0]!));
    }
    expect(found).toBe(true);
  });
});

describe('立直房里电脑起哄', () => {
  test('一批推好几步也不漏：每次自摸、跳满以上的和都认得出；只有电脑座位发；同一步再看一次是空的', () => {
    const eye = new RoomTalk(9);
    const talk = new RoomTalk(10);
    let s = begin(['human', 'ai', 'ai', 'ai'], 'fun');
    let seen = 0;
    let now = 0;
    for (let k = 0; !G.over(s) && k < 100_000; k++) {
      s = drive(s, 5);
      now += 10_000;
      seen += eye.watchRc(s).filter((m) => m.kind === 'moment' && m.moment !== 'kong').length;
      for (const a of talk.step(s, now)) expect(s.kinds[a.seat]).toBe('ai');
    }
    const loud = (s.g as RcState).history.flatMap((h) => h.wins).filter((w) => w.from === null || w.score.yakuman > 0 || ['haneman', 'baiman', 'sanbaiman'].includes(w.score.limit) || w.score.yaku.some((y) => y.id === 'rinshan'));
    expect(loud.length).toBeGreaterThan(0);
    expect(seen).toBe(loud.length);
    expect(eye.watchRc(s)).toEqual([]);
  });

  test('同一局先开杠再和：两个名场面算同一手（kit 的"每手电脑主动最多 2 次"按它数）', () => {
    const talk = new RoomTalk(9);
    let s = begin(['human', 'ai', 'ai', 'ai'], 'fun');
    s = drive(s, 1);
    expect(talk.watchRc(s)).toEqual([]);
    const rc = structuredClone(s.g as RcState);
    const hand = rc.history.length;
    rc.players[1]!.melds.push({ kind: 'kan', tiles: [0, 1, 2, 3], from: null, kan: 'concealed' });
    s = { ...s, n: s.n + 1, g: rc };
    const kan = talk.watchRc(s);
    const won = structuredClone(rc);
    const score = { yaku: [{ id: 'tsumo' as const, han: 1 }], yakuman: 0, kazoe: false, han: 1, fu: 30, dora: 0, aka: 0, ura: 0, base: 240, limit: 'none' as const };
    won.history.push({ wind: 0, hand: 0, honba: 0, dealer: 0, end: 'tsumo', delta: [0, 0, 0, 0], wins: [{ seat: 1, from: null, tile: 4, score, hand: [], melds: [], gain: 0, pao: null }], tenpai: null, dora: [], ura: [] });
    s = { ...s, n: s.n + 1, g: won };
    const tsumo = talk.watchRc(s);
    expect(kan.map((m) => m.kind === 'moment' && [m.moment, m.hand])).toEqual([['kong', hand]]);
    expect(tsumo.map((m) => m.kind === 'moment' && [m.moment, m.hand])).toEqual([['self-draw', hand]]);
  });
});
