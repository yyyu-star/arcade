/**
 * 电脑（DESIGN.md 第 5 节）：场地映射、这一场的状态和局面调整、确定性、出手的耗时。
 * 不读牌（多局面的反事实测试和阳性对照）在 fairness.test.ts，视图字段白名单在 match.test.ts，电脑能 import 什么在 arch.test.ts（DESIGN.md 5.4）。
 * 强弱和打法拉没拉开靠模拟器（scripts/sim.ts、stake-room.ts、strength.ts），结果在 DESIGN.md 4.1。
 */
import { stream } from 'arcade-kit/rng';
import { describe, expect, test } from 'vitest';
import { PERSONAS, STRONGEST } from '../src/ai/personas.ts';
import { moodStyle, styleOf } from '../src/ai/style.ts';
import { seatPlan, venueOf, VENUES } from '../src/ai/venues.ts';
import { decide } from '../src/ai/xuezhan.ts';
import { sichuanXuezhan as XZ, view, type XzState, type XzView } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { NEUTRAL_TUNE } from '../src/core/variants/types.ts';
import { AIS } from '../src/ai/index.ts';
import { KEY } from './helpers.ts';

const BANDENG = PERSONAS.findIndex((p) => p.name === '板凳儿');
const KINDS = ['ai', 'ai', 'ai', 'ai'] as const;

function start(personas = [0, 1, 2, 3], tunes = personas.map((_, i) => ({ mood: 1_000 + i, soft: 0 }))): XzState {
  return XZ.begin(KEY, XZ.defaults, KINDS, { share: 2_000, base: 80, personas, tunes }) as XzState;
}

/** 推到第一个出牌的时候 */
function toTurn(s0: XzState): XzState {
  let s = s0;
  for (let k = 0; k < 200 && s.phase !== 'turn'; k++) {
    const act = XZ.actors(s)!;
    s = XZ.apply(s, act.seats[0]!, XZ.auto(s, act.seats[0]!, AIS[XZ.id]!)) as XzState;
  }
  return s;
}

describe('场地', () => {
  test('每个场地都有表；好友房不计输赢的实盘档按娱乐', () => {
    for (const st of ['fun', 'small', 'mid', 'big', 'lux'] as const) {
      expect(VENUES[venueOf('solo', st)]).toBeDefined();
      expect(VENUES[venueOf('room', st)]).toBeDefined();
    }
    expect(venueOf('room', 'big', false)).toBe('room:fun');
    expect(venueOf('room', 'fun')).toBe('room:fun');
  });

  test('新手场偏弱：娱乐、小档手软、没有火锅婆婆；档位越高越强，豪华档火锅婆婆最常见、没有新手', () => {
    for (const v of ['solo:fun', 'solo:small', 'room:fun']) {
      expect(VENUES[v]!.soft).toBeGreaterThan(0);
      expect(VENUES[v]!.weights[STRONGEST]).toBeLessThanOrEqual(1);
    }
    const order = ['solo:fun', 'solo:small', 'solo:mid', 'solo:big', 'solo:lux'].map((v) => VENUES[v]!);
    for (let i = 1; i < order.length; i++) expect(order[i]!.soft).toBeLessThanOrEqual(order[i - 1]!.soft);
    const lux = VENUES['solo:lux']!.weights;
    expect(lux[STRONGEST]).toBe(Math.max(...lux));
    expect(lux[BANDENG]).toBe(0);
    // 好友房实盘一律最强、不手软
    for (const st of ['small', 'mid', 'big', 'lux']) {
      expect(VENUES[`room:${st}`]!.weights.filter((w) => w > 0)).toHaveLength(1);
      expect(VENUES[`room:${st}`]!.weights[STRONGEST]).toBeGreaterThan(0);
      expect(VENUES[`room:${st}`]!.soft).toBe(0);
    }
  });

  test('挑出来的性格不重复，每人一个这一场的状态（不是 0），手软跟场地；同一个种子同一个结果', () => {
    const a = seatPlan(stream(KEY, 'persona'), 'solo:mid', 3);
    expect(new Set(a.personas).size).toBe(3);
    expect(a.tunes.every((t) => t.mood !== 0 && t.soft === VENUES['solo:mid']!.soft)).toBe(true);
    expect(seatPlan(stream(KEY, 'persona'), 'solo:mid', 3)).toEqual(a);
    const moods = new Set(Array.from({ length: 20 }, (_, i) => seatPlan(stream([i, 1, 2, 3, 4, 5, 6, 7], 'persona'), 'solo:mid', 3).tunes[0]!.mood));
    expect(moods.size).toBe(20);
  });
});

describe('这一场的状态和局面', () => {
  test('不浮动（mood 0）就是性格本身；浮动在 swing 的范围里，不同场次不一样', () => {
    for (const p of PERSONAS) {
      expect(moodStyle(p, NEUTRAL_TUNE)).toMatchObject({ defense: p.defense, greed: p.greed, kanLove: p.kanLove, pon: p.pon, slip: p.slip, reads: p.reads });
      const seen = new Set<number>();
      for (let m = 1; m < 200; m += 7) {
        const s = moodStyle(p, { mood: m * 2_654_435_761, soft: 0 });
        expect(Math.abs(s.greed - p.greed)).toBeLessThanOrEqual(Math.ceil((220 * p.swing) / 1_000) + 1);
        seen.add(s.greed);
      }
      if (p.swing >= 200 && p.greed > 100 && p.greed < 900) expect(seen.size).toBeGreaterThan(5);
    }
  });

  test('手软：多打错、少防守、读牌粗', () => {
    const p = PERSONAS[STRONGEST]!;
    const hard = moodStyle(p, { mood: 0, soft: 0 });
    const soft = moodStyle(p, { mood: 0, soft: 300 });
    expect(soft.slip).toBeGreaterThan(hard.slip);
    expect(soft.defense).toBeLessThan(hard.defense);
    expect(soft.reads).toBeLessThan(hard.reads);
  });

  test('手紧（大档、豪华档）：少打错、读牌准、功力高；旧存档没有 sharp 按 0', () => {
    const p = PERSONAS[1]!;
    const plain = moodStyle(p, { mood: 0, soft: 0 });
    expect(moodStyle(p, { mood: 0, soft: 0, sharp: 0 })).toEqual(plain);
    const sharp = moodStyle(p, { mood: 0, soft: 0, sharp: VENUES['solo:lux']!.sharp! });
    expect(sharp.slip).toBeLessThan(plain.slip);
    expect(sharp.reads).toBeGreaterThan(plain.reads);
    expect(sharp.skill).toBeGreaterThan(plain.skill);
    expect(moodStyle(PERSONAS[STRONGEST]!, NEUTRAL_TUNE).skill).toBe(1_000);
    // 只有大档、豪华档手紧，豪华更紧；新手场、好友房都没有
    expect(VENUES['solo:lux']!.sharp!).toBeGreaterThan(VENUES['solo:big']!.sharp!);
    for (const [id, v] of Object.entries(VENUES)) if (id !== 'solo:big' && id !== 'solo:lux') expect(v.sharp ?? 0).toBe(0);
    expect(seatPlan(stream(KEY, 'persona'), 'solo:lux', 3).tunes.every((t) => t.sharp === VENUES['solo:lux']!.sharp)).toBe(true);
    expect(seatPlan(stream(KEY, 'persona'), 'solo:mid', 3).tunes.every((t) => !('sharp' in t))).toBe(true);
  });

  test('局面：落后了贪、领先了稳、快输光了保命；刚点炮输了一大把会上头', () => {
    const p = PERSONAS[3]!;
    const s = toTurn(start([3, 3, 3, 3], [NEUTRAL_TUNE, NEUTRAL_TUNE, NEUTRAL_TUNE, NEUTRAL_TUNE]));
    const v = view(s, 0);
    const at = (chips: number, history: XzView['history'] = []): XzView => ({ ...v, seats: v.seats.map((x, i) => (i === 0 ? { ...x, chips } : x)), history });
    const even = styleOf(at(2_000), p);
    expect(styleOf(at(1_000), p).greed).toBeGreaterThan(even.greed);
    expect(styleOf(at(4_000), p).defense).toBeGreaterThan(even.defense);
    expect(styleOf(at(400), p).defense).toBeGreaterThan(even.defense);
    const tilt = styleOf(at(2_000, [{ round: 0, dealer: 0, net: [-800, 800, 0, 0], wins: [{ seat: 1, from: 0, fan: 2, items: [] }], end: 'three' }]), p);
    expect(tilt.slip).toBeGreaterThan(even.slip);
    expect(tilt.defense).toBeLessThan(even.defense);
  });
});

describe('出手', () => {
  test('同一个视图同一个决定（没有随机数）', () => {
    const s = toTurn(start());
    const v = view(s, s.turn);
    expect(decide(v)).toEqual(decide(structuredClone(v)));
  });

  test('出手不慢：一整场里电脑每一次决定 p99 不到 20 毫秒', () => {
    let s = start([0, 1, 2, 4]);
    const ms: number[] = [];
    for (let n = 0; n < 5_000 && !XZ.over(s); n++) {
      const act = XZ.actors(s);
      if (!act || !act.seats.length) {
        s = XZ.resume(s);
        continue;
      }
      const seat = act.seats[0]!;
      const t0 = performance.now();
      const a = XZ.auto(s, seat, AIS[XZ.id]!);
      ms.push(performance.now() - t0);
      s = XZ.apply(s, seat, a) as XzState;
    }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length * 0.99)]!).toBeLessThan(20);
  });
});
