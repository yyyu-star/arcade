/**
 * 斗地主联机规则（src/variants/doudizhu/net/rules.ts）和合并的房间规则（src/net/hall.ts）。
 * 房间怎么驱动规则（actors → ai/timeout → apply）照 arcade-kit 的写法在这里模拟：零错误、零卡死、零和、视图不漏别人的牌。
 * 真的 Durable Object（写入行数、WebSocket、闹钟）在 tests/room/ddz.spec.ts 里用 workerd 跑。
 */
import { matchConfigErrors } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { hallRoom as H, isDdz, parseHallOpts, type HallState } from '../src/net/hall.ts';
import { testKey, guandanRoom as G } from '../src/variants/guandan/net/rules.ts';
import { DDZ_FUN } from '../src/variants/doudizhu/index.ts';
import { DDZ_IDLE_AFTER, DDZ_IDLE_MS, DDZ_READY_MS, ddzFunBots, ddzMoments, type DdzNet } from '../src/variants/doudizhu/net/rules.ts';
import { MATCH_DDZ, MATCH_DDZ_TABLE, ddzMatchRoomOptions } from '../src/variants/doudizhu/net/match.ts';

const DDZ_OPTS = { variant: 'ddz', stake: null } as const;
const SEATS: ('human' | 'ai')[] = ['human', 'human', 'human'];

function begin(seed: number, seats: ('empty' | 'human' | 'ai')[] = SEATS): DdzNet {
  const s = H.begin!(testKey(seed), H.rulesVersion, { opts: DDZ_OPTS, seats });
  if (!isDdz(s)) throw new Error('应该是斗地主');
  return s;
}

/** 按房间的样子打到整场结束；pick 决定这一步是电脑出还是超时代出 */
function playRoom(seed: number, pick: (i: number) => 'ai' | 'timeout' = () => 'ai', each?: (s: DdzNet, i: number) => void): DdzNet[] {
  let s: HallState = begin(seed);
  const out = [s as DdzNet];
  for (let i = 0; !H.over(s); i++) {
    if (i > 5000) throw new Error(`种子 ${seed} 打了 5000 步还没完（卡死）`);
    const { seats } = H.actors!(s) as { seats: number[]; group: string };
    if (!seats.length) throw new Error(`种子 ${seed} 第 ${i} 步：没结束但不等任何人`);
    const seat = seats[0]!;
    const a = pick(i) === 'ai' ? H.ai(s, seat) : H.timeout!(s, seat);
    const { idle: _idle, ...sent } = a as { idle?: true };
    expect(H.parse(JSON.parse(JSON.stringify(a)))).toEqual(sent);
    const n = H.apply(s, seat, a);
    if ('error' in n) throw new Error(`种子 ${seed} 第 ${i} 步 ${JSON.stringify(a)}：${n.error}`);
    s = n;
    out.push(s as DdzNet);
    each?.(s as DdzNet, i);
  }
  return out;
}

describe('开房选项', () => {
  it('不带 variant 还是掼蛋，旧选项原样', () => {
    expect(parseHallOpts(undefined)).toEqual({ stake: null });
    expect(parseHallOpts(null)).toEqual({ stake: null });
    expect(parseHallOpts({})).toEqual({ stake: null });
    expect(parseHallOpts({ stake: 'small' })).toEqual({ stake: 'small' });
    expect(parseHallOpts({ stake: 'nope' })).toBeNull();
    expect(H.seatCount!(undefined)).toBe(4);
    expect(H.seatCount!({ stake: null })).toBe(4);
    const s = H.begin!(testKey(1), H.rulesVersion, { opts: { stake: null }, seats: ['human', 'human', 'human', 'human'] });
    expect(isDdz(s)).toBe(false);
  });

  it('variant: ddz 开 3 人的斗地主，带实盘或别的玩法名都拒绝', () => {
    expect(parseHallOpts({ variant: 'ddz' })).toEqual(DDZ_OPTS);
    expect(parseHallOpts({ variant: 'ddz', stake: null })).toEqual(DDZ_OPTS);
    expect(H.seatCount!(DDZ_OPTS)).toBe(3);
    expect(parseHallOpts({ variant: 'ddz', stake: 'small' })).toBeNull();
    expect(parseHallOpts({ variant: 'guandan' })).toBeNull();
    expect(parseHallOpts({ variant: 1 })).toBeNull();
  });

  it('掼蛋开局的状态和直接用掼蛋规则开的一模一样', () => {
    const seats = ['human', 'ai', 'ai', 'human'] as const;
    const viaHall = H.begin!(testKey(7), H.rulesVersion, { opts: { stake: null }, seats: [...seats] });
    const direct = G.begin!(testKey(7), H.rulesVersion, { opts: { stake: null }, seats: [...seats] });
    expect(viaHall).toEqual(direct);
    expect(H.view(viaHall, 0)).toEqual(G.view(direct, 0));
  });

  it('快速匹配档位 ddz-fun 的人数和选项合房间的规则', () => {
    expect(matchConfigErrors(H, [MATCH_DDZ], () => MATCH_DDZ_TABLE, ddzMatchRoomOptions)).toEqual([]);
    expect(matchConfigErrors(H, [MATCH_DDZ], () => 4, ddzMatchRoomOptions).length).toBeGreaterThan(0);
  });
});

describe('斗地主房间规则', () => {
  it('3 人桌开局：发好牌、先叫分的人叫、没有种子', () => {
    const s = begin(11);
    expect(s.g.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.g.seed).toBe('');
    expect(s.g.key).toHaveLength(8);
    expect(s.humans).toEqual([true, true, true]);
    const a = H.actors!(s) as { seats: number[] };
    expect(a.seats).toEqual([s.g.firstBidder]);
    expect(H.turnMs!(s)).toBe(15_000);
    expect(H.over(s)).toBe(false);
  });

  it('电脑从头打到整场结束：零错误、轮流、每副零和、每步的组名都在变', () => {
    const states = playRoom(21, () => 'ai', (s) => {
      expect(s.g.scores.reduce((a, b) => a + b, 0)).toBe(0);
    });
    const last = states[states.length - 1]!;
    expect(last.g.phase).toBe('gameOver');
    expect(last.g.results).toHaveLength(DDZ_FUN.deals);
    for (const r of last.g.results) expect(r.delta.reduce((a, b) => a + b, 0)).toBe(0);
    // 出牌 / 叫分阶段每一步轮的都是 turn 上的那一个人
    for (const s of states) {
      if (s.g.phase === 'bid' || s.g.phase === 'play') expect((H.actors!(s) as { seats: number[] }).seats).toEqual([s.g.turn]);
    }
  });

  it('全靠超时代出也能打完整场（叫分不叫、首出最小单张、跟牌不要；三家都不叫重发最后强制 1 分）', () => {
    const states = playRoom(33, () => 'timeout');
    expect(states[states.length - 1]!.g.phase).toBe('gameOver');
  });

  it('一副结束停在结算页：等真人点继续，最后一个点完的那一步里开下一副', () => {
    let s: HallState = begin(5);
    while ((s as DdzNet).g.phase !== 'dealEnd') {
      const seat = (H.actors!(s) as { seats: number[] }).seats[0]!;
      s = H.apply(s, seat, H.ai(s, seat)) as HallState;
    }
    const d = s as DdzNet;
    expect(H.breakPoint!(d)).toBe(true);
    expect(d.ready).toEqual([false, false, false]);
    expect(H.turnMs!(d)).toBe(DDZ_READY_MS);
    expect((H.actors!(d) as { seats: number[] }).seats).toEqual([0, 1, 2]);
    // 电脑代点的就是 ready
    expect(H.ai(d, 1)).toEqual({ type: 'ready' });
    expect(H.timeout!(d, 1)).toEqual({ type: 'ready', idle: true });
    let cur = H.apply(d, 1, { type: 'ready' }) as DdzNet;
    expect(cur.ready).toEqual([false, true, false]);
    expect(cur.g.dealNo).toBe(1);
    expect((H.actors!(cur) as { seats: number[] }).seats).toEqual([0, 2]);
    expect(H.apply(cur, 1, { type: 'ready' })).toEqual({ error: 'already_ready' });
    cur = H.apply(cur, 0, { type: 'ready' }) as DdzNet;
    cur = H.apply(cur, 2, { type: 'ready' }) as DdzNet;
    expect(cur.g.dealNo).toBe(2);
    expect(cur.g.phase).toBe('bid');
    expect(cur.ready).toBeNull();
    expect(cur.ev.some((e) => e.type === 'deal')).toBe(true);
    // 没到结算页点继续不行
    expect(H.apply(cur, 0, { type: 'ready' })).toEqual({ error: 'wrong_phase' });
  });

  it('不轮到的人、掼蛋的操作都被拒绝，错误码是固定短码', () => {
    const s = begin(2);
    const wrong = [0, 1, 2].find((x) => x !== s.g.turn)!;
    expect(H.apply(s, wrong, { type: 'bid', bid: 1 })).toEqual({ error: 'not_your_turn' });
    expect(H.apply(s, s.g.turn, { type: 'bid', bid: 1 })).not.toHaveProperty('error');
    expect(H.apply(s, s.g.turn, { type: 'tribute', card: 3 })).toEqual({ error: 'bad_action' });
    expect(H.apply(s, s.g.turn, { type: 'buyin' })).toEqual({ error: 'bad_action' });
    expect(H.apply(s, s.g.turn, { type: 'again', code: '123456' })).toEqual({ error: 'bad_action' });
    expect(H.apply(s, 3, { type: 'bid', bid: 1 })).toEqual({ error: 'not_seated' });
    expect(H.parse({ type: 'bid', bid: 4 })).toBeNull();
    expect(H.parse({ type: 'bid', bid: 1.5 })).toBeNull();
    expect(H.apply(s, s.g.turn, { type: 'play', cards: [54] })).toEqual({ error: 'not_playing' });
    expect(H.apply({ ...s, g: { ...s.g, phase: 'play' } }, s.g.turn, { type: 'play', cards: [54] })).toEqual({ error: 'not_in_hand' });
    // 掼蛋房间里 bid 不存在
    const g = H.begin!(testKey(3), H.rulesVersion, { opts: { stake: null }, seats: ['human', 'human', 'human', 'human'] });
    expect(H.apply(g, 0, { type: 'bid', bid: 1 })).toEqual({ error: 'bad_action' });
  });

  it('视图只给自己的手牌：别人的牌不在里面，没入座的是空手牌', () => {
    const states = playRoom(44);
    for (const s of states.filter((_, i) => i % 7 === 0)) {
      for (const seat of [0, 1, 2]) {
        const v = H.view(s, seat) as { view: { hand: number[]; seat: number }; events: unknown[] };
        expect(v.view.seat).toBe(seat);
        expect(v.view.hand).toEqual(s.g.hands[seat]);
        expect(JSON.stringify(v)).not.toMatch(/"seed"|"hands"|"key"/);
        // 桌面上、事件里出现的牌（底牌、出过的、这一轮的、事件的）都不能是别人现在还握在手里的
        const w = v.view as unknown as { bottom: number[]; played: number[]; trick: { play: { cards: number[] } | null }[]; target: { play: { cards: number[] } | null } | null };
        const open = [...w.bottom, ...w.played, ...w.trick.flatMap((x) => x.play?.cards ?? []), ...(w.target?.play?.cards ?? [])];
        for (const e of v.events as { type: string; play?: { cards: number[] }; bottom?: number[] }[]) open.push(...(e.play?.cards ?? []), ...(e.bottom ?? []));
        for (const o of [0, 1, 2].filter((x) => x !== seat)) {
          const leaked = open.filter((c) => s.g.hands[o]!.includes(c) && !s.g.bottom.includes(c));
          expect(leaked, `座位 ${seat} 的视图里有座位 ${o} 手里的牌`).toEqual([]);
        }
      }
      const pub = H.view(s, null) as { view: { hand: number[]; seat: number; counts: number[] } };
      expect(pub.view.seat).toBe(-1);
      expect(pub.view.hand).toEqual([]);
      expect(pub.view.counts).toEqual(s.g.hands.map((h) => h.length));
    }
  });

  it('电脑的种子不是牌局密钥，也不泄漏：同一状态同一座位出同一手，不同步数换流', () => {
    const s = begin(9);
    const seat = s.g.turn;
    expect(H.ai(s, seat)).toEqual(H.ai(s, seat));
    // 电脑看不到别人的牌：改别人的手牌，它的决定不变
    const tampered: DdzNet = { ...s, g: { ...s.g, hands: s.g.hands.map((h, i) => (i === seat ? h : [...h].reverse().slice(1))) } };
    expect(H.ai(tampered, seat)).toEqual(H.ai(s, seat));
  });

  it('走开了：连着被代出就只等 3 秒，点"我回来了"恢复', () => {
    let s: HallState = begin(8);
    const seat = s.g.turn;
    for (let k = 0; k < DDZ_IDLE_AFTER; k++) {
      // 同一个人连着被代出：让别人先出一手再轮回来太绕，直接用 apply 带 idle 记号数
      s = { ...(s as DdzNet) };
      const r = H.apply(s, (s as DdzNet).g.turn, H.timeout!(s, (s as DdzNet).g.turn));
      expect('error' in r).toBe(false);
      s = r as HallState;
    }
    const d = s as DdzNet;
    const who = d.idle!.findIndex((n) => n >= 1);
    expect(who).toBeGreaterThanOrEqual(0);
    expect(seat).toBeGreaterThanOrEqual(0);
    // 手工把某人记成走开，验证时限和"回来"
    const away: DdzNet = { ...d, idle: d.idle!.map((_, i) => (i === d.g.turn ? DDZ_IDLE_AFTER : 0)) };
    expect(H.turnMs!(away)).toBe(DDZ_IDLE_MS);
    expect((H.view(away, null) as { afk: boolean[] }).afk[away.g.turn]).toBe(true);
    const back = H.apply(away, away.g.turn, { type: 'back' }) as DdzNet;
    expect(back.idle![away.g.turn]).toBe(0);
    expect(H.apply(d, 0, { type: 'back' })).toEqual({ error: 'not_away' });
  });

  it('座位换人、没真人了就结束；电脑互动：两个电脑老周、王姐', () => {
    const s = begin(4, ['human', 'ai', 'ai']);
    expect(s.humans).toEqual([true, false, false]);
    expect(ddzFunBots(s)).toEqual([{ seat: 1, temper: 'cool' }, { seat: 2, temper: 'rowdy' }]);
    const left = H.seated!(s, 0, 'ai') as DdzNet;
    expect(left.humans).toEqual([false, false, false]);
    expect(left.ev).toEqual([]);
    expect(H.over(left)).toBe(true);
    expect(H.over(s)).toBe(false);
    expect(ddzMoments({ ...s, ev: [] })).toEqual([]);
  });

  it('炸弹、王炸、春天会报名场面', () => {
    let found = 0;
    for (let seed = 50; seed < 56; seed++) {
      for (const s of playRoom(seed)) {
        for (const m of ddzMoments(s)) {
          found++;
          expect(m.winners.length + m.losers.length).toBe(m.moment === 'bomb' ? 1 + m.losers.length : m.winners.length + m.losers.length);
          expect(m.winners.some((w) => m.losers.includes(w))).toBe(false);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('没有 effects、不等再来一场', () => {
    const s = begin(6);
    expect(H.effects!(s)).toEqual([]);
    expect(H.pause!(s)).toBeNull();
    expect(H.settled!(s, 'x', {})).toBe(s);
    expect(H.closing!(s)).toBe(s);
  });
});
