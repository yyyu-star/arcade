/**
 * 一张桌的机器人对打驱动（tests/room 里的批量对打和断线测试共用）：
 * 每个真人座位一条真的 WebSocket，轮到自己时只看自己收到的视图、用电脑的出牌逻辑在本地算一手、按 act 发出（带 baseSeq）；
 * 每一步之后读房间里的真实状态，核对：所有连接都收到了这个 seq、每条下行消息不漏别人的牌、最后一帧就是 view(真实状态, 自己的座位)。
 *
 * 时间是假的（只假 Date）：每次真人出手前把时钟往前拨"想一会儿"（加上电脑出牌的播放时间），闹钟到点了就用 runDurableObjectAlarm 跑，
 * 这样闹钟次数和真打时差不多（每一手 30 秒、掉线宽限 60 秒都按房间自己的规矩到期）。
 */
import { expect } from 'vitest';
import { guandanRoom as R, type NetAction, type NetState } from '../../src/variants/guandan/net/rules.ts';
import { Conn, type Truth, advance, botAction, checkDown, fireDueAlarms, handTruth, join, openRoom, truth } from './helpers.ts';

/** 字符串 → [0,1) 的确定性随机（决定哪一手故意不出） */
function unit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

export interface TableOptions {
  /** 几个真人（其余座位开局时由电脑补上，在房间里批量出） */
  humans: 1 | 2 | 3 | 4;
  /** 局的名字（userId、机器人随机流都从它来） */
  tag: string;
  /** 轮到真人时故意不出、等房间 30 秒超时代出的比例 */
  idleRate?: number;
  /** 再连一个没入座的旁观连接，检查公开视图也不漏 */
  spectator?: boolean;
  /** 真人每手想多久（毫秒，默认 2000） */
  thinkMs?: number;
  /** 实盘房间的档位（不写是娱乐房间） */
  stake?: string;
  /** 打完一整场时第一个真人点"再来一场"（0.6.2）；不写就等房间停够了自己结束 */
  again?: boolean;
}

export interface TableStats {
  code: string;
  steps: number;
  deals: number;
  /** 所有连接一共发了几条（入座、开局、出手） */
  inbound: number;
  /** 其中出手（act） */
  acts: number;
  /** 每条入座连接收到的下行条数、字节数 */
  down: number[];
  downBytes: number[];
  /** 房间实例一共写了几行（含开房那 4 行）、开房那步、其余每步最多 */
  writes: number;
  createWrites: number;
  maxStepWrites: number;
  /** 跑了几次闹钟、其中故意不出导致的超时代出几次 */
  alarms: number;
  idleTimeouts: number;
  /** 第一条连接收到的电脑互动（bot: true 的表情、短语、道具，0.7.1）条数 */
  botEmotes: number;
  /** 房间被硬限制（入站总数、寿命）关掉了：没打完 */
  closedEarly: { inbound: number; steps: number } | null;
  /** 假时钟上这一局用了多久（毫秒） */
  fakeMs: number;
  problems: string[];
}

export class Table {
  readonly opts: TableOptions;
  code = '';
  /** 座位号 → 连接（只有真人座位） */
  readonly seats = new Map<number, Conn>();
  spectator: Conn | null = null;
  t: Truth | null = null;
  private checked = new Map<Conn, number>();
  readonly problems: string[] = [];
  alarms = 0;
  idleTimeouts = 0;
  createWrites = 0;
  /** 开局时的 seq：之后每个入座的连接看到的 state seq 序列必须一样 */
  startSeq = 0;

  constructor(opts: TableOptions) {
    this.opts = opts;
  }

  user(seat: number): string {
    return `${this.opts.tag}-s${seat}`;
  }

  conns(): Conn[] {
    return [...this.seats.values(), ...(this.spectator ? [this.spectator] : [])];
  }

  /** 开房、真人入座、开局 */
  async open(): Promise<void> {
    this.code = await openRoom(this.user(0), this.opts.stake);
    this.createWrites = (await truth(this.code)).last;
    const host = await join(this.code, this.user(0));
    expect(host.welcome.you.seat).toBe(0);
    this.seats.set(0, host.conn);
    for (let k = 1; k < this.opts.humans; k++) {
      const { conn, welcome } = await join(this.code, this.user(k));
      expect(welcome.you.seat).toBeNull();
      const before = conn.latestSeq();
      conn.send({ t: 'sit', seat: k });
      await conn.waitFor(() => conn.latestSeq() > before, 'sit');
      this.seats.set(k, conn);
    }
    if (this.opts.spectator) this.spectator = (await join(this.code, `${this.opts.tag}-watch`)).conn;
    await this.settle();
    const before = this.t!.row!.seq;
    host.conn.send({ t: 'start' });
    await host.conn.waitFor(() => host.conn.latestSeq() > before, 'start');
    this.startSeq = before + 1;
    await this.settle();
    expect(this.t!.row!.status).toBe('playing');
  }

  /** 读真实状态，等所有连接都收到这个 seq，再核对它们收到的新消息 */
  async settle(): Promise<Truth> {
    const t = await truth(this.code);
    this.t = t;
    if (!t.row) return t;
    for (const c of this.conns()) if (!c.closed) await c.atLeast(t.row.seq);
    const game = t.row.game;
    const hands = handTruth(game);
    for (const c of this.conns()) {
      for (let i = this.checked.get(c) ?? 0; i < c.msgs.length; i++) {
        const m = c.msgs[i]!;
        const exact = m.t !== 'error' && m.seq === t.row.seq ? game : null;
        const bad = checkDown(c.raw[i]!, m, hands, exact);
        if (bad) this.problems.push(bad);
        // 电脑互动只能从真电脑的座位发（真人座位托管代打时也不替真人说话）
        const e = m as unknown as { t: string; seat: number; bot?: boolean };
        if (e.t === 'emote' && e.bot && game?.humans?.[e.seat] !== false) this.problems.push(`座位 ${e.seat} 不是电脑，却发了电脑互动`);
      }
      this.checked.set(c, c.msgs.length);
    }
    return t;
  }

  /** 轮到谁、是不是这桌的真人在出（没掉线托管） */
  private humanToAct(row: NonNullable<Truth['row']>): { seat: number; conn: Conn } | null {
    const seat = R.turn(row.game!);
    if (seat === null) return null;
    const s = row.seats[seat]!;
    const conn = this.seats.get(seat);
    if (!conn || conn.closed || s.kind !== 'human' || s.auto) return null;
    return { seat, conn };
  }

  /** 拨到下一个闹钟并跑掉（电脑一批没算完、超时、宽限到期） */
  async runNextAlarm(): Promise<boolean> {
    const t = await truth(this.code);
    if (t.alarm === null) return false;
    if (t.alarm > Date.now()) advance(t.alarm - Date.now());
    this.alarms += await fireDueAlarms(this.code, t);
    await this.settle();
    return true;
  }

  /** 真人这一手：先想一会儿（到点的闹钟照跑），然后出手；按比例故意不出、等超时代出 */
  async humanTurn(seat: number, conn: Conn): Promise<void> {
    const last = conn.latest();
    const playback = last && last.t === 'state' ? (last.frames.length - 1) * 1300 : 0;
    advance(playback + (this.opts.thinkMs ?? 2000));
    const fired = await fireDueAlarms(this.code);
    if (fired) {
      this.alarms += fired;
      await this.settle();
      return;
    }
    const row = this.t!.row!;
    const game = row.game!;
    if (unit(`${this.opts.tag}|idle|${row.seq}`) < (this.opts.idleRate ?? 0)) {
      // 不出：拨到这一手的截止时间，房间按 timeout 代出（能不要就不要）
      const deadline = conn.latestRoom()?.turn?.deadline;
      expect(deadline).toBeTypeOf('number');
      advance(deadline! + 1 - Date.now());
      this.alarms += await fireDueAlarms(this.code);
      const t = await this.settle();
      // 到点时这一组里还没出的人（结算页上没点继续的、双下两个进贡的）都由房间按 timeout 代出
      let expected = game;
      for (const who of R.actors(game).seats) {
        const r = R.apply(expected, who, R.timeout(expected, who));
        expect('error' in r ? r.error : null).toBeNull();
        expected = r as NetState;
      }
      // 4 真人：代出之后不再有电脑接着出，真实状态正好是代出的结果；有电脑时看帧里有没有代出后的局面
      const frames = conn.latest()?.t === 'state' ? (conn.latest() as { frames: { view: unknown }[] }).frames : [];
      if (t.row && this.opts.humans === 4) expect(t.row.game).toEqual(expected);
      else expect(frames.map((f) => f.view)).toContainEqual(R.view(expected, seat));
      this.idleTimeouts++;
      return;
    }
    const view = conn.latestView();
    if (!view) throw new Error('no view');
    const action: NetAction = botAction(view, `${this.opts.tag}|bot|${seat}`);
    const moveId = conn.act(action);
    const res = await conn.result(moveId);
    if (res.t === 'error') this.problems.push(`座位 ${seat} 出 ${JSON.stringify(action)} 被拒：${res.code}`);
    await this.settle();
  }

  private lastSeq = -1;
  private still = 0;

  /**
   * 往前走一步：轮到这桌的真人就出（或故意不出等超时），否则拨到下一个闹钟（电脑一批没算完、掉线的人超时、宽限到期）。
   * 打完、房间被关掉、卡死时返回 false。
   */
  async step(): Promise<boolean> {
    const row = this.t?.row;
    if (!row || row.status !== 'playing') return false;
    if (row.seq === this.lastSeq) {
      if (++this.still > 30) {
        this.problems.push(`卡死：seq ${row.seq} 30 轮没动`);
        return false;
      }
    } else this.still = 0;
    this.lastSeq = row.seq;
    const who = this.humanToAct(row);
    try {
      if (this.opts.again && row.game?.g.phase === 'gameOver' && !this.opts.stake) {
        await this.again();
        return false;
      }
      if (who) await this.humanTurn(who.seat, who.conn);
      else if (!(await this.runNextAlarm())) {
        this.problems.push(`卡死：轮到 ${R.turn(row.game!)}，没有闹钟`);
        return false;
      }
    } catch (e) {
      // 房间被关掉（入站总数、寿命用完）时连接 4000 断开，读真实状态确认
      await this.settle().catch(() => undefined);
      if (this.t?.row === null) return false;
      throw e;
    }
    return true;
  }

  /** 一个真人点"再来一场"：房间收下（不轮流）、新房间码发给每个连接，房间就此结束 */
  private async again(): Promise<void> {
    const [seat, conn] = [...this.seats.entries()][0]!;
    const res = await conn.result(conn.act({ type: 'again', code: '765432' }));
    if (res.t === 'error') this.problems.push(`再来一场被拒：${res.code}`);
    const t = await this.settle();
    if (t.row?.status !== 'over') this.problems.push(`再来一场以后房间还在 ${t.row?.status}`);
    for (const c of this.conns()) {
      const v = c.latestView();
      if (v?.again?.code !== '765432') this.problems.push(`有连接没收到新房间码：${JSON.stringify(v?.again)}`);
    }
    if (t.row?.game?.again?.by !== seat) this.problems.push(`再来一场记错了人：${JSON.stringify(t.row?.game?.again)}`);
  }

  /** 一直打到结束（或被房间硬限制关掉） */
  async playToEnd(): Promise<TableStats> {
    const start = Date.now();
    while (await this.step());
    return this.stats(Date.now() - start);
  }

  /** 这个座位的人掉线（客户端关连接），等房间记下他掉线了 */
  async drop(seat: number): Promise<void> {
    const conn = this.seats.get(seat)!;
    this.seats.delete(seat);
    conn.ws.close(1000, 'bye');
    for (let i = 0; i < 100; i++) {
      const t = await truth(this.code);
      if (t.row?.seats[seat]?.awaySince != null) break;
      await new Promise((ok) => setTimeout(ok, 10));
    }
    await this.settle();
  }

  /** 这个座位的人连回来 */
  async rejoin(seat: number): Promise<{ conn: Conn; welcome: Awaited<ReturnType<typeof join>>['welcome'] }> {
    const out = await join(this.code, this.user(seat));
    this.seats.set(seat, out.conn);
    await this.settle();
    return out;
  }

  private stats(fakeMs: number): TableStats {
    const t = this.t!;
    const conns = [...this.seats.values()];
    const sent = this.conns().reduce((n, c) => n + c.sent, 0);
    const game = t.row?.game ?? null;
    const closedEarly = t.row === null || t.row.status !== 'over' ? { inbound: sent, steps: 0 } : null;
    // 所有入座的连接从开局起看到的 state seq 序列一样，最后都停在同一个 seq
    const seqLists = conns.map((c) =>
      c.msgs.filter((m) => m.t === 'state' && m.seq >= this.startSeq).map((m) => (m as { seq: number }).seq),
    );
    for (const l of seqLists) {
      if (JSON.stringify(l) !== JSON.stringify(seqLists[0])) {
        this.problems.push(`各连接看到的 seq 不一致`);
        break;
      }
    }
    return {
      code: this.code,
      steps: game?.g.step ?? 0,
      deals: game?.g.dealNo ?? 0,
      inbound: sent,
      acts: conns.reduce((n, c) => n + c.msgs.filter((m) => m.t === 'state' && m.ack).length, 0),
      down: conns.map((c) => c.msgs.length),
      downBytes: conns.map((c) => c.bytes),
      writes: t.total,
      createWrites: this.createWrites,
      maxStepWrites: t.max,
      alarms: this.alarms,
      idleTimeouts: this.idleTimeouts,
      botEmotes: (conns[0]?.msgs ?? []).filter((m) => (m as unknown as { t: string; bot?: boolean }).t === 'emote' && (m as unknown as { bot?: boolean }).bot).length,
      closedEarly,
      fakeMs,
      problems: this.problems,
    };
  }

  close(): void {
    for (const c of this.conns()) {
      try {
        c.ws.close(1000, 'bye');
      } catch {
        // 已经关了
      }
    }
  }
}
