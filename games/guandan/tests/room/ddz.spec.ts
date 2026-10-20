/**
 * 斗地主房间（牌馆 ⑤）在真的 Durable Object 里：开房选项 variant: 'ddz' 开 3 座的斗地主桌，3 个机器人客户端各一条 WebSocket 打完整场；
 * 再来一个 1 真人 + 2 电脑（电脑在房间里批量出）。断言：零规则错误、零卡死、每步写入 ≤ 2 行（开房那步 4 行）、
 * 所有连接的 seq 一致、下行消息不漏别人的牌、没入座的旁观者视图没有手牌；另外：不带 variant 开的还是掼蛋，斗地主带实盘档位被拒。
 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { decideDdz } from '../../src/variants/doudizhu/ai/index.ts';
import { DDZ_FUN } from '../../src/variants/doudizhu/index.ts';
import { ROOMS, SITE, advance, cookie, fireDueAlarms, freezeClock, join, truth, type Conn } from './helpers.ts';

beforeEach(() => freezeClock());

// helpers 的连接类型是掼蛋的视图；斗地主的视图形状另算，这里只在本文件里按斗地主读
interface DView {
  variant: 'ddz';
  view: { seat: number; phase: string; hand: number[]; turn: number; dealNo: number; step: number; scores: number[]; [k: string]: unknown };
  events: unknown[];
  ready: boolean[] | null;
}
const viewOf = (c: Conn): DView | null => c.latestView() as unknown as DView | null;

async function openDdz(userId: string, body: unknown): Promise<Response> {
  return exports.default.fetch(ROOMS, {
    method: 'POST',
    headers: { origin: SITE, cookie: cookie(userId), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface Row {
  seq: number;
  status: string;
  seats: { kind: string; auto: boolean }[];
  game: { variant?: string; g: { phase: string; hands: number[][]; dealNo: number; turn: number; key?: number[]; seed?: string }; ready: boolean[] | null; humans?: boolean[] } | null;
}

async function play(tag: string, humans: 1 | 3, watch: boolean): Promise<{ problems: string[]; maxWrites: number; deals: number; createWrites: number }> {
  const problems: string[] = [];
  const res = await openDdz(`${tag}-s0`, { variant: 'ddz' });
  expect(res.status).toBe(201);
  const code = ((await res.json()) as { code: string }).code;
  const createWrites = (await truth(code)).last;
  const seats = new Map<number, Conn>();
  const host = await join(code, `${tag}-s0`);
  expect(host.welcome.you.seat).toBe(0);
  seats.set(0, host.conn);
  for (let k = 1; k < humans; k++) {
    const { conn } = await join(code, `${tag}-s${k}`);
    const before = conn.latestSeq();
    conn.send({ t: 'sit', seat: k });
    await conn.waitFor(() => conn.latestSeq() > before, 'sit');
    seats.set(k, conn);
  }
  const watcher = watch ? (await join(code, `${tag}-watch`)).conn : null;
  const all = (): Conn[] => [...seats.values(), ...(watcher ? [watcher] : [])];
  const t0 = await truth(code);
  host.conn.send({ t: 'start' });
  await host.conn.waitFor(() => host.conn.latestSeq() > t0.row!.seq, 'start');

  const checked = new Map<Conn, number>();
  const settle = async (): Promise<Row> => {
    const t = await truth(code);
    const row = t.row as unknown as Row;
    for (const c of all()) if (!c.closed) await c.atLeast(row.seq);
    for (const c of all()) {
      for (let i = checked.get(c) ?? 0; i < c.msgs.length; i++) {
        const m = c.msgs[i]!;
        const raw = c.raw[i]!;
        if (/"seed"|"hands"|"key"/.test(raw)) problems.push(`下行消息里有 seed / hands / key：${raw.slice(0, 80)}`);
        for (const w of row.game?.g.key ?? []) if (w >= 1_000_000 && raw.includes(String(w))) problems.push(`下行消息里出现了发牌密钥的数 ${w}`);
        if (m.t !== 'state' && m.t !== 'welcome') continue;
        const views = m.t === 'welcome' ? [m.view] : m.frames.map((f) => f.view);
        for (const v0 of views) {
          if (!v0) continue;
          const v = v0 as unknown as DView;
          if (v.view.dealNo !== row.game?.g.dealNo) continue;
          const me = m.you.seat;
          if (me === null && v.view.hand.length) problems.push('旁观者视图里有手牌');
          for (const o of [0, 1, 2]) {
            if (o === me) continue;
            const mine = new Set(v.view.hand);
            const rest = row.game!.g.hands[o]!;
            // 手牌字段里不能有别人（这一步之后）还握着的牌
            if (me !== null && rest.some((c) => mine.has(c) && !row.game!.g.hands[me]!.includes(c))) problems.push(`座位 ${me} 的手牌里有座位 ${o} 的牌`);
          }
        }
      }
      checked.set(c, c.msgs.length);
    }
    return row;
  };

  let row = await settle();
  expect(row.game?.variant).toBe('ddz');
  let still = 0;
  let last = -1;
  for (let i = 0; i < 4000; i++) {
    const cur = (await truth(code)).row as unknown as Row | null;
    if (!cur || cur.status !== 'playing') break;
    row = cur;
    if (cur.seq === last) {
      if (++still > 30) {
        problems.push(`卡死：seq ${cur.seq}`);
        break;
      }
    } else still = 0;
    last = cur.seq;
    const g = cur.game!;
    // 现在谁能出手的真人：结算页是没点继续的真人，其余是轮到的那一个
    const who = g.g.phase === 'dealEnd' ? [0, 1, 2].filter((s) => !g.ready![s]) : [g.g.turn];
    const humanSeat = who.find((s) => seats.has(s) && cur.seats[s]!.kind === 'human' && !cur.seats[s]!.auto);
    if (humanSeat !== undefined) {
      const conn = seats.get(humanSeat)!;
      advance(2000);
      if (await fireDueAlarms(code)) {
        await settle();
        continue;
      }
      const v = viewOf(conn)!;
      const action =
        v.view.phase === 'dealEnd'
          ? { type: 'ready' }
          : (() => {
              const a = decideDdz(v.view as never, 'normal', `${tag}|${humanSeat}`);
              if (!a) return { type: 'pass' };
              return a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', cards: a.cards } : { type: 'pass' };
            })();
      const res2 = await conn.result(conn.act(action as never));
      if (res2.t === 'error') problems.push(`座位 ${humanSeat} 出 ${JSON.stringify(action)} 被拒：${res2.code}`);
    } else {
      const t = await truth(code);
      if (t.alarm === null) {
        problems.push('卡死：没有真人该出，也没有闹钟');
        break;
      }
      if (t.alarm > Date.now()) advance(t.alarm - Date.now());
      await fireDueAlarms(code, t);
    }
    row = await settle();
  }
  const fin = await truth(code);
  const final = fin.row as unknown as Row;
  if (final.status !== 'over') problems.push(`没打完：${final.status}`);
  const gg = final.game as unknown as { g: { results: unknown[]; scores: number[] } };
  if (gg.g.scores.reduce((a, b) => a + b, 0) !== 0) problems.push('整场不零和');
  const seqLists = [...seats.values()].map((c) => c.msgs.filter((m) => m.t === 'state' && m.seq > t0.row!.seq).map((m) => (m as { seq: number }).seq));
  for (const l of seqLists) if (JSON.stringify(l) !== JSON.stringify(seqLists[0])) problems.push('各连接看到的 seq 不一致');
  for (const c of all()) c.ws.close(1000, 'bye');
  return { problems, maxWrites: fin.max, deals: gg.g.results.length, createWrites };
}

describe('斗地主房间（真的 Durable Object）', () => {
  it('3 个机器人客户端打完一整场：零错误、每步写入 ≤ 2 行、不漏别人的牌', { timeout: 120_000 }, async () => {
    const r = await play('ddz3', 3, true);
    expect(r.problems).toEqual([]);
    expect(r.createWrites).toBe(4);
    expect(r.maxWrites).toBeLessThanOrEqual(2);
    expect(r.deals).toBe(DDZ_FUN.deals);
  });

  it('1 真人 + 2 电脑：电脑在房间里批量出，整场打完', { timeout: 120_000 }, async () => {
    const r = await play('ddz1', 1, false);
    expect(r.problems).toEqual([]);
    expect(r.maxWrites).toBeLessThanOrEqual(2);
    expect(r.deals).toBe(DDZ_FUN.deals);
  });

  it('斗地主只有 3 个座位：第 4 个人坐不进去；开房选项不认的被拒', async () => {
    const res = await openDdz('ddz-seat-s0', { variant: 'ddz' });
    const code = ((await res.json()) as { code: string }).code;
    const host = await join(code, 'ddz-seat-s0');
    const c = (await join(code, 'ddz-seat-s3')).conn;
    c.send({ t: 'sit', seat: 3 });
    await c.waitFor(() => c.msgs.some((m) => m.t === 'error'), 'seat error');
    expect(c.msgs.find((m) => m.t === 'error')).toMatchObject({ t: 'error' });
    host.conn.ws.close(1000, 'bye');
    c.ws.close(1000, 'bye');
    expect((await openDdz('ddz-bad', { variant: 'ddz', stake: 'small' })).status).toBe(400);
    expect((await openDdz('ddz-bad', { variant: 'mahjong' })).status).toBe(400);
  });

  it('不带 variant 开的还是掼蛋（4 座、掼蛋的状态）', async () => {
    const res = await openDdz('gd-plain-s0', { stake: null });
    expect(res.status).toBe(201);
    const code = ((await res.json()) as { code: string }).code;
    const h = await join(code, 'gd-plain-s0');
    expect((h.welcome.room as { seatCount?: number; seats: unknown[] }).seats.length).toBe(4);
    h.conn.send({ t: 'start' });
    await h.conn.waitFor(() => h.conn.latestSeq() > h.welcome.seq, 'start');
    const row = (await truth(code)).row as unknown as Row;
    expect(row.game?.variant).toBeUndefined();
    expect(row.game?.g.hands).toHaveLength(4);
    h.conn.ws.close(1000, 'bye');
  });
});
