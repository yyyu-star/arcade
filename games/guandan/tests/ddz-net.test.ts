/**
 * 斗地主联机会话（src/view/ddz-net.ts）：不连真房间，换一个假的 RoomClient，直接喂房间消息。
 * 看视角有没有转对（3 人：(s − 我 + 3) % 3）、帧怎么排队、出手怎么锁、结算页的"继续"发 ready、旁观没手牌、玩法不对的房间不转视图。
 */
import type { RoomClient } from 'arcade-kit/client';
import type { RoomInfo, StateMsg, WelcomeMsg } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import { hallRoom as H, isDdz, type HallState } from '../src/net/hall.ts';
import { testKey } from '../src/variants/guandan/net/rules.ts';
import type { DdzNet, DdzNetAction, DdzNetView } from '../src/variants/doudizhu/net/rules.ts';
import { DdzNetSession, rotateDdzNetView } from '../src/view/ddz-net.ts';
import { NetSession, autoSeat, errorText, roomVariant, seatCountOf } from '../src/view/net.ts';
import { seatIdentity, seatName } from '../src/view/labels.ts';

class FakeClient {
  sent: { t: string; action?: DdzNetAction; seat?: number }[] = [];
  private n = 0;
  act(action: DdzNetAction): string {
    this.sent.push({ t: 'act', action });
    return `m${++this.n}`;
  }
  sit(seat: number): void {
    this.sent.push({ t: 'sit', seat });
  }
  start(): void {}
  leave(): void {}
  close(): void {}
  retry(): void {}
}

const OPTS = { variant: 'ddz', stake: null } as const;

function make(): { ses: DdzNetSession; fake: FakeClient } {
  const fake = new FakeClient();
  return { ses: new DdzNetSession('123456', true, { client: fake as unknown as RoomClient<DdzNetAction, DdzNetView> }), fake };
}

const room = (s: DdzNet, kinds: ('human' | 'ai')[] = ['human', 'human', 'human'], opts: unknown = OPTS): RoomInfo => ({
  code: '123456',
  status: 'playing',
  // kit 的 RoomInfo.seats 永远是 4 个：斗地主用前 3 个，第 4 个一直空着
  seats: [
    ...kinds.map((k, i) =>
      k === 'human' ? ({ kind: 'human', name: ['阿一', '小二', '三三'][i]!, away: false, auto: false } as const) : ({ kind: 'ai', name: null, away: false, auto: false } as const),
    ),
    { kind: 'empty', name: null, away: false, auto: false },
  ],
  turn: { seat: (H.actors!(s) as { seats: number[] }).seats[0] ?? 0, deadline: Date.now() + 30_000 },
  opts,
});

const asDdz = (s: HallState): DdzNet => {
  if (!isDdz(s)) throw new Error('应该是斗地主');
  return s;
};

function welcome(s: DdzNet, seat: number | null, info = room(s)): WelcomeMsg<DdzNetView> {
  return { t: 'welcome', v: 1, minClientVersion: 1, seq: 5, you: { seat }, room: info, view: H.view(s, seat) as DdzNetView };
}

function stateMsg(states: DdzNet[], seat: number, seq: number, ack?: string): StateMsg<DdzNetView> {
  return { t: 'state', seq, you: { seat }, room: room(states[states.length - 1]!), frames: states.map((x, i) => ({ view: H.view(x, seat) as DdzNetView, delay: i ? 900 : 0 })), ...(ack ? { ack } : {}) };
}

/** 房间的样子往后走几步（电脑出），到 stop 为止 */
function walk(n: number, stop?: (s: DdzNet) => boolean): DdzNet[] {
  let s = asDdz(H.begin!(testKey(7), H.rulesVersion, { opts: OPTS, seats: ['human', 'human', 'human'] }));
  const out = [s];
  for (let i = 0; i < n || (stop && !stop(s)); i++) {
    if (i > 3000) throw new Error('没走到');
    const seat = (H.actors!(s) as { seats: number[] }).seats[0]!;
    const r = H.apply(s, seat, H.ai(s, seat));
    if ('error' in r) throw new Error(r.error);
    s = asDdz(r);
    out.push(s);
  }
  return out;
}

describe('斗地主联机会话', () => {
  it('进房快照：坐在 2 号位的人看到自己在 0；别人的手牌不在视图里；座位上的人按画面位置记好', () => {
    const { ses } = make();
    const st = walk(6);
    ses.handle(welcome(st[6]!, 2));
    const g = st[6]!.g;
    const v = ses.view();
    expect(v.seat).toBe(0);
    expect(v.hand).toEqual(g.hands[2]);
    expect(v.counts).toEqual([g.hands[2]!.length, g.hands[0]!.length, g.hands[1]!.length]);
    // 画面 1 号（下家）= 真实 0 号，画面 2 号 = 真实 1 号
    expect(seatIdentity[1]?.name).toBe('阿一');
    expect(seatName(2)).toBe('小二');
    expect(seatName(0)).toBe('你');
    ses.close();
  });

  it('旋转：每个座位的人看自己都在 0，轮到谁、地主、叫分、事件里的座位都跟着转', () => {
    const st = walk(40, (s) => s.g.landlord >= 0 && s.g.phase === 'play');
    const s = st[st.length - 1]!;
    for (let me = 0; me < 3; me++) {
      const raw = H.view(s, me) as DdzNetView;
      const r = rotateDdzNetView(raw, me);
      const f = (x: number): number => (x < 0 ? x : (x - me + 3) % 3);
      expect(r.view.seat).toBe(0);
      expect(r.view.landlord).toBe(f(s.g.landlord));
      expect(r.view.turn).toBe(f(s.g.turn));
      expect(r.view.hand).toEqual(raw.view.hand);
      expect(r.view.counts[0]).toBe(s.g.hands[me]!.length);
      expect(r.view.bids[0]).toBe(raw.view.bids[me]);
      expect(r.view.scores[f(1)]).toBe(raw.view.scores[1]);
    }
    // 事件：一步叫分
    const bidStep = st.find((x) => x.ev.some((e) => e.type === 'bid'))!;
    const e = rotateDdzNetView(H.view(bidStep, 1) as DdzNetView, 1).events.find((x) => x.type === 'bid')!;
    const raw = bidStep.ev.find((x) => x.type === 'bid')!;
    expect(e.type === 'bid' && raw.type === 'bid' && e.seat === (raw.seat - 1 + 3) % 3).toBe(true);
  });

  it('帧排队、一帧帧取；出手发出去以后锁住，收到 ack 才解锁', () => {
    const { ses, fake } = make();
    const st = walk(60, (s) => s.g.phase === 'play');
    const i = st.findIndex((x) => x.g.phase === 'play' && x.g.turn === 0);
    expect(i).toBeGreaterThanOrEqual(0);
    ses.handle(welcome(st[i]!, 0));
    expect(ses.canAct()).toBe(false); // 还没 open
    ses.status = 'open';
    expect(ses.canAct()).toBe(true);
    const lead = !ses.view().target || ses.view().target!.seat === 0;
    const r = lead ? ses.apply({ type: 'play', seat: 0, cards: [ses.view().hand[0]!] }) : ses.apply({ type: 'pass', seat: 0 });
    expect(r.sent).toBe(true);
    expect(fake.sent.at(-1)?.action?.type).toBe(lead ? 'play' : 'pass');
    expect(ses.canAct()).toBe(false);
    expect(ses.apply({ type: 'pass', seat: 0 }).sent).toBe(false);
    ses.handle(stateMsg([st[i + 1]!, st[i + 2]!], 0, 6, 'm1'));
    expect(ses.pending).toBeNull();
    expect(ses.queue.length).toBe(2);
    expect(ses.take()?.nv.view.step).toBe(st[i + 1]!.g.step);
    expect(ses.shown?.view.step).toBe(st[i + 1]!.g.step);
    ses.close();
  });

  it('被拒的操作解锁并记下原因；错误码有大白话', () => {
    const { ses } = make();
    const st = walk(3);
    ses.handle(welcome(st[3]!, 1));
    ses.status = 'open';
    ses.apply({ type: 'bid', seat: 0, bid: 1 });
    ses.handle({ t: 'error', code: 'bad_bid', moveId: 'm1' });
    expect(ses.pending).toBeNull();
    expect(ses.lastError).toBe('bad_bid');
    for (const c of ['bad_bid', 'not_bidding', 'too_small', 'not_in_hand', 'not_deal_end']) expect(errorText(c)).not.toBe('这手牌出不了');
    ses.close();
  });

  it('结算页：点"继续"发 ready；点过以后不能再点；旁观的人没有继续', () => {
    const { ses, fake } = make();
    const st = walk(0, (s) => s.g.phase === 'dealEnd');
    const end = st[st.length - 1]!;
    ses.handle(welcome(end, 1));
    ses.status = 'open';
    expect(ses.canReady()).toBe(true);
    expect(ses.readyWait()?.waiting).toEqual([0, 1, 2]);
    ses.apply({ type: 'next' });
    expect(fake.sent.at(-1)).toEqual({ t: 'act', action: { type: 'ready' } });
    expect(ses.canReady()).toBe(false);
    ses.close();

    const w = make();
    w.ses.handle(welcome(end, null));
    w.ses.status = 'open';
    expect(w.ses.canReady()).toBe(false);
    w.ses.close();
  });

  it('旁观：没有手牌，不能出手，也不能点继续', () => {
    const { ses, fake } = make();
    const st = walk(5);
    ses.handle(welcome(st[5]!, null));
    ses.status = 'open';
    expect(ses.watching).toBe(true);
    expect(ses.view().seat).toBe(-1);
    expect(ses.view().hand).toEqual([]);
    expect(ses.canAct()).toBe(false);
    expect(ses.apply({ type: 'pass', seat: 0 }).sent).toBe(false);
    expect(fake.sent.some((x) => x.t === 'act')).toBe(false);
    // 画面 0 号是真实 0 号座位上的人，不叫"你"
    expect(seatName(0)).toBe('阿一');
    ses.close();
  });

  it('电脑座位按先后依次是老周、王姐；掉线接管的座位显示主人的名字', () => {
    const { ses } = make();
    const st = walk(2);
    ses.handle(welcome(st[2]!, 0, room(st[2]!, ['human', 'ai', 'ai'])));
    expect(seatName(1)).toBe('老周');
    expect(seatName(2)).toBe('王姐');
    ses.close();
  });

  it('玩法不对的房间：斗地主会话不转掼蛋房间的视图，掼蛋会话也不转斗地主的；大厅据此换会话', () => {
    const st = walk(2);
    const g = make();
    g.ses.handle(welcome(st[2]!, 0, room(st[2]!, ['human', 'human', 'human'], null)));
    expect(g.ses.wrongVariant).toBe(true);
    expect(g.ses.shown).toBeNull();
    expect(g.ses.canEnterTable).toBe(false);
    g.ses.close();

    const net = new NetSession('123456', false, { client: new FakeClient() as unknown as RoomClient<never, never> });
    net.handle(welcome(st[2]!, 0) as never);
    expect(roomVariant(net.room)).toBe('ddz');
    expect(net.wrongVariant).toBe(true);
    expect(net.shown).toBeNull();
    expect(net.canEnterTable).toBe(false);
    net.close();
  });

  it('座位数按玩法算：斗地主 3 个（第 4 个是 kit 凑的空位，不能坐）；自动入座不会坐到它', () => {
    const st = walk(1);
    const full = { ...room(st[1]!), status: 'waiting' as const };
    expect(seatCountOf(full)).toBe(3);
    expect(seatCountOf({ ...full, opts: null })).toBe(4);
    expect(autoSeat(full, { seat: null })).toBeNull();
    const one = { ...full, seats: [{ kind: 'human' as const, name: '阿一', away: false, auto: false }, ...[1, 2, 3].map(() => ({ kind: 'empty' as const, name: null, away: false, auto: false }))] };
    expect(autoSeat(one, { seat: null })).toBe(1);
  });

  it('换了座位（接管电脑）：清掉排队的帧，按新座位整桌重画', () => {
    const { ses } = make();
    const st = walk(6);
    ses.handle(welcome(st[2]!, 0));
    const seen: string[] = [];
    ses.on((k) => seen.push(k));
    ses.handle(stateMsg([st[3]!, st[4]!], 2, 7));
    expect(seen).toEqual(['reset']);
    expect(ses.mySeat).toBe(2);
    expect(ses.queue.length).toBe(0);
    expect(ses.view().hand).toEqual(st[4]!.g.hands[2]);
    ses.close();
  });
});
