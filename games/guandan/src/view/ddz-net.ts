/**
 * 斗地主的联机会话（牌馆 ⑤，设计 docs/doudizhu.md 第 5 节）：连房间、排帧、出手锁到 ack 这些玩法无关的部分是 net.ts 的 RoomLink，
 * 这里只管斗地主的：把房间按真实座位发来的视图转成"我 = 0"（3 人：(s − 我 + 3) % 3；没入座是旁观，按 0 号转、座位仍是 -1）、
 * 座位上的人写进 labels.ts（电脑座位按先后依次是老周、王姐，和房间里电脑的互动性格同一个排法）、结算页的"继续"。
 * 电脑在房间里出，本地只在调试托管（autoplay）时替我出。
 */
import { decideDdz, type DdzAction, type DdzEvent, type DdzView } from '../variants/doudizhu/index.ts';
import type { DdzNetAction, DdzNetView } from '../variants/doudizhu/net/rules.ts';
import type { DdzTableSession } from './ddz-session.ts';
import type { DailySubmit } from './ddz-daily.ts';
import { RoomLink, type LinkDeps } from './net.ts';
import { setSeatIdentities, setWatching, type SeatIdentity } from './labels.ts';

const N = 3;

/** 真实座位 → 画面座位（座位 -1 原样） */
const seatOf = (me: number) => (s: number): number => (s < 0 ? s : (s - me + N) % N);

/** 房间按真实座位发来的斗地主视图 → 我 = 0。事件里的座位、各种按座位排的数组都转 */
export function rotateDdzNetView(nv: DdzNetView, me: number): DdzNetView {
  const r = seatOf(me);
  const by = <T>(arr: readonly T[]): T[] => {
    const out = new Array<T>(arr.length);
    arr.forEach((x, s) => (out[r(s)] = x));
    return out;
  };
  const v = nv.view;
  const result = (x: DdzView['results'][number]): DdzView['results'][number] => ({ ...x, landlord: r(x.landlord), delta: by(x.delta) });
  const event = (e: DdzEvent): DdzEvent => {
    switch (e.type) {
      case 'deal':
        return { ...e, firstBidder: r(e.firstBidder) };
      case 'bid':
      case 'landlord':
      case 'play':
      case 'pass':
      case 'newTrick':
        return { ...e, seat: r(e.seat) };
      case 'dealEnd':
        return { ...e, result: result(e.result) };
      case 'gameOver':
        return { ...e, scores: by(e.scores) };
      default:
        return e;
    }
  };
  return {
    ...nv,
    view: {
      ...v,
      seat: r(v.seat),
      counts: by(v.counts),
      landlord: r(v.landlord),
      firstBidder: r(v.firstBidder),
      bids: by(v.bids),
      turn: r(v.turn),
      trick: v.trick.map((t) => ({ ...t, seat: r(t.seat) })),
      target: v.target ? { ...v.target, seat: r(v.target.seat) } : null,
      scores: by(v.scores),
      results: v.results.map(result),
    },
    events: nv.events.map(event),
    ready: nv.ready ? by(nv.ready) : null,
    ...(nv.afk ? { afk: by(nv.afk) } : {}),
  };
}

/** 电脑座位的人物：房间按电脑座位的先后依次给老周、王姐（DDZ_BOTS） */
const BOT_PERSON = ['laozhou', 'wangjie'] as const;

export class DdzNetSession extends RoomLink<DdzNetAction, DdzNetView, DdzNetView> implements DdzTableSession {
  lastEvents: DdzEvent[] = [];
  readonly daily = null;
  readonly dailySent = false;
  readonly dailyResult: Promise<DailySubmit> | null = null;

  constructor(code: string, host: boolean, deps: LinkDeps<DdzNetAction, DdzNetView> = {}) {
    super('ddz', code, host, deps);
  }

  protected project(v: DdzNetView): DdzNetView {
    return rotateDdzNetView(v, this.mySeat ?? 0);
  }

  protected seatToView(real: number): number {
    return seatOf(this.mySeat ?? 0)(real);
  }

  protected seatToReal(view: number): number {
    return (view + (this.mySeat ?? 0)) % N;
  }

  protected override onFresh(): void {
    this.lastEvents = [];
  }

  protected identities(): void {
    const room = this.room;
    if (!room) return;
    setWatching(this.watching);
    const afk = (this.queue[this.queue.length - 1]?.nv ?? this.shown)?.afk;
    const list: (SeatIdentity | null)[] = [null, null, null, null];
    let bots = 0;
    room.seats.slice(0, N).forEach((s, real) => {
      const shown = this.seatToView(real);
      if (s.kind === 'empty') list[shown] = null;
      // 绑了人、主人离座的座位：显示主人的名字和"电脑代打"；没绑人的电脑座位 name 是 null
      else if (s.kind === 'ai') {
        list[shown] = s.name !== null ? { human: true, name: s.name, away: true, auto: true } : { human: false, name: '', away: false, auto: false, ddzPerson: BOT_PERSON[bots++ % BOT_PERSON.length]! };
      } else list[shown] = { human: true, name: s.name ?? '玩家', away: s.away, auto: s.auto, ...(afk?.[shown] ? { afk: true } : {}) };
    });
    setSeatIdentities(list);
  }

  /** 进牌桌时：还没显示过就拿第一帧，它的事件（发牌）当作进场动画 */
  begin(): void {
    if (this.shown) return;
    const f = this.take();
    this.lastEvents = f ? f.nv.events : [];
  }

  get afk(): boolean {
    return !!(this.queue[this.queue.length - 1]?.nv ?? this.shown)?.afk?.[0];
  }

  /** 结算页上我还能点"继续"（坐着、这副结束了、还没点过、上一手没在路上）。旁观的人没有 */
  canReady(): boolean {
    const nv = this.shown;
    return nv?.view.phase === 'dealEnd' && !!nv.ready && !nv.ready[0] && this.mySeat !== null && this.status === 'open' && this.pending === null;
  }

  /** 结算页上还在等谁（画面座位，不含已经点了"继续"的）和自动开下一副的时间 */
  readyWait(): { waiting: number[]; deadline: number | null } | null {
    const ready = this.shown?.view.phase === 'dealEnd' ? this.shown.ready : null;
    if (!ready) return null;
    return { waiting: [0, 1, 2].filter((s) => !ready[s]), deadline: this.room?.turn?.deadline ?? null };
  }

  // ───────────── DdzTableSession ─────────────

  view(): DdzView {
    if (!this.shown) throw new Error('还没收到牌局');
    return this.shown.view;
  }

  apply(a: DdzAction): { events: DdzEvent[]; error: string | null; sent?: boolean } {
    if (this.pending) return { events: [], error: '上一手还在路上，等一下', sent: false };
    if (this.mySeat === null) return { events: [], error: '先坐下再出牌', sent: false };
    let na: DdzNetAction;
    switch (a.type) {
      case 'bid':
        na = { type: 'bid', bid: a.bid };
        break;
      case 'play':
        na = { type: 'play', cards: a.cards };
        break;
      case 'pass':
        na = { type: 'pass' };
        break;
      default:
        // 单机的"下一副"在好友房里是"我准备好了"，人齐了（或到点）由房间开下一副
        na = { type: 'ready' };
    }
    this.pending = this.client.act(na);
    return { events: [], error: null, sent: true };
  }

  isBot(seat: number): boolean {
    return seat === 0 && this.autoplay && this.mySeat !== null;
  }

  /** 调试托管：只替我出，按最强；结算页替我点"继续" */
  botAction(seat: number): DdzAction | null {
    if (seat !== 0 || !this.shown || this.mySeat === null) return null;
    const v = this.shown.view;
    if (v.phase === 'dealEnd') return this.canReady() ? { type: 'next' } : null;
    return decideDdz(v, 'pro', `${this.code}|${v.dealNo}|${v.step}`);
  }

  /** 我现在能不能出手（轮到我、上一手的结果回来了、画面追上了） */
  canAct(): boolean {
    return this.status === 'open' && this.pending === null && this.queue.length === 0 && this.mySeat !== null && this.room?.turn?.seat === this.mySeat;
  }
}
