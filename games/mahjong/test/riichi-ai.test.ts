/**
 * 立直麻将的电脑（docs/riichi.md 第 3 节）：和牌、立直、押引、鸣牌要有役、九种九牌、只出 prompt 里允许的动作。
 * 不读牌的反事实测试在 fairness.test.ts，电脑能 import 什么在 arch.test.ts，强弱和换筹码的 K 靠 scripts/sim-riichi.ts。
 */
import { stream } from 'arcade-kit/rng';
import { describe, expect, test } from 'vitest';
import { AIS } from '../src/ai/index.ts';
import { decide, styleOf } from '../src/ai/riichi.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { seatPlan, VENUES } from '../src/ai/venues.ts';
import { waitsOf } from '../src/core/variants/riichi/index.ts';
import { newWall } from '../src/core/table/index.ts';
import { allTiles, countsOf, kindOf, tileOf, type Tile } from '../src/core/tiles/index.ts';
import { riichi as RC, TILESET, view, type RcAction, type RcState, type RcView } from '../src/core/variants/riichi/index.ts';
import { NEUTRAL_TUNE, type VariantAi } from '../src/core/variants/types.ts';
import { kinds } from './helpers.ts';

const KEY = [3, 1, 4, 1, 5, 9, 2, 6];
const SETUP = { share: 2_000, base: 80, personas: [4, 4, 4, 4] };
const AI = AIS[RC.id]! as VariantAi<RcView, RcAction>;

interface Spec {
  /** 四家的手牌，写不满的家用没人要的牌补到 13 张（出牌的那家 14 张，最后一张是刚摸的） */
  hands: string[];
  turn?: number;
  dealer?: number;
  /** 场风 0 东 1 南 */
  wind?: number;
  river?: string[];
  /** 谁立直了：座位 → 立直宣告的牌在河里的位置 */
  riichi?: Record<number, number>;
  /** 宝牌指示牌 */
  dora?: string;
  /** 第一巡（九种九牌）：出牌的这家是第一次摸牌，河里没有牌 */
  first?: boolean;
  personas?: number[];
}

/** 摆一个局面：同种牌从第 3 张往下用（没有赤五），剩下的牌进牌墙和王牌区 */
function table(spec: Spec): RcState {
  const used = new Map<number, number>();
  const take = (str: string): Tile[] =>
    kinds(str).map((k) => {
      const n = used.get(k) ?? 0;
      if (n >= 4) throw new Error(`too many ${k}`);
      used.set(k, n + 1);
      return tileOf(k, 3 - n);
    });
  const turn = spec.turn ?? 0;
  const s = RC.begin(KEY, RC.defaults, ['ai', 'ai', 'ai', 'ai'], { ...SETUP, personas: spec.personas ?? SETUP.personas }) as RcState;
  const hands = [0, 1, 2, 3].map((i) => take(spec.hands[i] ?? ''));
  const rivers = [0, 1, 2, 3].map((i) => take(spec.river?.[i] ?? ''));
  const dora = take(spec.dora ?? '9s');
  const hasRoom = (k: number): boolean => (used.get(k) ?? 0) < 4;
  // 没写满的家，用互不相邻的牌补
  const filler = [0, 3, 6, 10, 13, 16, 20, 23, 26, 28, 29, 30, 1, 4, 7, 9, 12, 15, 18, 21, 24, 27, 2, 5, 8, 11, 14, 17, 19, 22, 25, 31, 32, 33];
  hands.forEach((h, i) => {
    const want = i === turn ? 14 : 13;
    for (const k of filler) {
      if (h.length >= want) break;
      if (!hasRoom(k)) continue;
      used.set(k, (used.get(k) ?? 0) + 1);
      h.push(tileOf(k, 4 - (used.get(k) ?? 1)));
    }
  });
  const drawn = hands[turn]!.at(-1)!;
  s.players = hands.map((h, i) => ({
    hand: h.slice().sort((a, b) => a - b),
    melds: [],
    // 河里第几张：按座位轮着打（0 号先），立直以后谁打了什么由它决定
    river: rivers[i]!.map((tile, j) => ({ tile, n: j * 4 + i + 1 })),
    riichi: spec.riichi?.[i] !== undefined ? 1 : 0,
    riichiAt: spec.riichi?.[i] ?? -1,
    ippatsu: false,
    passed: false,
    locked: false,
    banned: [],
    draws: spec.first ? 1 : 2,
  }));
  const taken = new Set<Tile>([...hands.flat(), ...rivers.flat(), ...dora]);
  const rest = allTiles(TILESET).filter((t) => !taken.has(t));
  s.dead = [...dora, ...rest.splice(0, 13)];
  s.doraOpen = 1;
  s.wall = newWall(rest, 0);
  s.phase = 'turn';
  s.turn = turn;
  s.dealer = spec.dealer ?? turn;
  s.first = s.dealer;
  s.wind = spec.wind ?? 0;
  s.drawn = drawn;
  s.canTsumo = true;
  s.noCalls = !!spec.first;
  s.discards = spec.first ? 0 : 8;
  s.start = s.points.slice();
  s.events = [];
  return s;
}

const decideAt = (s: RcState, seat: number): RcAction => AI.decide(view(s, seat));
const kindOfAction = (a: RcAction): number => {
  if (a.t !== 'discard') throw new Error(`不是打牌：${JSON.stringify(a)}`);
  return kindOf(a.tile);
};
const k1 = (str: string): number => kinds(str)[0]!;

/** seat 打出一张牌，推到声明窗口 */
function discardTo(s: RcState, seat: number, k: string): RcState {
  const t = s.players[seat]!.hand.find((x) => kindOf(x) === k1(k))!;
  const r = RC.apply(s, seat, { t: 'discard', tile: t });
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('和牌', () => {
  test('能自摸就自摸', () => {
    // 门清断幺自摸：234m 567m 234p 66p 456s
    const s = table({ hands: ['234567m234p66p45s6s'] });
    expect(view(s, 0).prompt!.tsumo).toBe(true);
    expect(decideAt(s, 0)).toEqual({ t: 'tsumo' });
  });

  test('能荣和就荣和', () => {
    // 座位 0 听 3、6 索（断幺平和），座位 3 打出 6 索
    const s = discardTo(table({ hands: ['234567m234p66p45s', '', '', '6s'], turn: 3, dealer: 3 }), 3, '6s');
    const p = view(s, 0).prompt!;
    expect(p.claim?.opts).toContain('ron');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'ron' });
  });
});

describe('立直', () => {
  // 234m 55m 6m 567p 789s 99p 五张万子里挑：打 5 万等 1、4、7 万最宽
  const WIDE = '234556m567p789s99p';

  test('门清听牌默认立直；宣告牌挑听得最多的那张', () => {
    const s = table({ hands: [WIDE] });
    const pr = view(s, 0).prompt!;
    expect(new Set(pr.riichi!.map(kindOf)).size).toBeGreaterThan(1);
    const a = decideAt(s, 0);
    expect(a).toMatchObject({ t: 'discard', riichi: true });
    // 参照：每个能立直的打法，数一数还能和几张（自己手里的、看得见的都算掉）
    const v = view(s, 0);
    const left = (tile: Tile): number => {
      const c = countsOf(v.me!.hand.filter((t) => t !== tile));
      const own = countsOf(v.me!.hand.filter((t) => t !== tile));
      return waitsOf(c, 0).reduce((n, k) => n + 4 - own[k]! - (v.dora.some((d) => kindOf(d) === k) ? 1 : 0), 0);
    };
    const best = Math.max(...pr.riichi!.map(left));
    expect(left((a as { tile: Tile }).tile)).toBe(best);
    expect(pr.riichi).toContain((a as { tile: Tile }).tile);
  });

  test('默听就满贯以上而且等得多：不立直，打掉没用的那张', () => {
    // 三色同顺加断幺加平和，宝牌 2 索一张：五番；等 4、7 筒共 7 张
    const s = table({ hands: ['234m234p234s56p88s7z'], dora: '1s' });
    const a = decideAt(s, 0);
    expect(a).toMatchObject({ t: 'discard' });
    expect((a as { riichi?: true }).riichi).toBeUndefined();
    expect(kindOfAction(a)).toBe(k1('7z'));
  });

  test('便宜的手、等得多：照常立直', () => {
    const s = table({ hands: ['234m456p678s67p22s7z'] });
    expect(decideAt(s, 0)).toMatchObject({ t: 'discard', riichi: true });
  });

  test('没有役的门清听牌只能靠立直', () => {
    // 123m 456m 789p 99p 12s 3s... 听 3 索，默听没有役
    const s = table({ hands: ['123m456m789p99p12s7z'] });
    expect(decideAt(s, 0)).toMatchObject({ t: 'discard', riichi: true });
    expect(kindOfAction(decideAt(s, 0))).toBe(k1('7z'));
  });
});

describe('押引', () => {
  // 一手乱牌（五向听以上），5 筒是座位 1 的现物；字牌都没出过
  const MESS = '147m258p369s1234z6z';

  test('没人立直：照常打，不会特地留着中张', () => {
    const s = table({ hands: [MESS] });
    expect(kindOfAction(decideAt(s, 0))).not.toBe(k1('5p'));
  });

  test('有人立直，手里有他的现物：打现物', () => {
    const s = table({ hands: [MESS], river: ['', '5p9m3z', '', ''], riichi: { 1: 2 } });
    expect(kindOfAction(decideAt(s, 0))).toBe(k1('5p'));
  });

  test('立直的人不止一个：选两家共同的现物', () => {
    // 5 筒只在座位 1 的河里；3 字（西）两家的河里都有
    const s = table({ hands: [MESS], river: ['', '5p9m3z', '8p9m3z', ''], riichi: { 1: 2, 2: 2 } });
    expect(kindOfAction(decideAt(s, 0))).toBe(k1('3z'));
  });

  test('立直之后别家打的牌也是他的现物', () => {
    // 座位 1 的第 2 张宣告立直（全桌第 6 张）；座位 2 的第 1 张 1 筒在那之前，第 2 张 4 万（全桌第 7 张）在那之后，他放过了
    const s = table({ hands: [MESS], dealer: 0, river: ['', '9m9p5s', '1p4m', ''], riichi: { 1: 1 } });
    expect(kindOfAction(decideAt(s, 0))).toBe(k1('4m'));
  });

  test('新手（不防守）照打，不为了躲而改主意', () => {
    const s = table({ hands: [MESS], river: ['', '5p9m3z', '', ''], riichi: { 1: 2 }, personas: [5, 5, 5, 5] });
    s.tunes = [{ mood: 0, soft: 1_500 }, NEUTRAL_TUNE, NEUTRAL_TUNE, NEUTRAL_TUNE];
    expect(kindOfAction(decideAt(s, 0))).not.toBe(k1('5p'));
  });

  test('已经听牌了：不为了躲而拆掉听牌，照打', () => {
    // 234m 567p 789s 99p 45s 听 3、6 索，摸到 1 万；座位 1 立直
    const s = table({ hands: ['234m567p789s99p45s1m'], river: ['', '5p9m3z', '', ''], riichi: { 1: 2 } });
    expect(kindOfAction(decideAt(s, 0))).toBe(k1('1m'));
  });
});

describe('鸣牌要有役', () => {
  // 十三张乱牌里一对 z：别家打出 z，碰了向听数就少一
  const PAIR = (z: string): string => `147m2578p3469s${z}${z}`;

  test('役牌（三元）的对子：碰', () => {
    const s = discardTo(table({ hands: [PAIR('7z'), '', '', '7z'], turn: 3, dealer: 3 }), 3, '7z');
    expect(view(s, 0).prompt!.claim?.opts).toContain('pon');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'pon' });
  });

  test('客风的对子：碰了也没有役，不碰', () => {
    // 东场，座位 0 是南家（庄家是 3），北不是役牌
    const s = discardTo(table({ hands: [PAIR('4z'), '', '', '4z'], turn: 3, dealer: 3 }), 3, '4z');
    expect(view(s, 0).prompt!.claim?.opts).toContain('pon');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'pass' });
  });

  test('场风的对子：碰', () => {
    const s = discardTo(table({ hands: [PAIR('1z'), '', '', '1z'], turn: 3, dealer: 3 }), 3, '1z');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'pon' });
  });

  test('手里幺九一大堆、没有役的路：能吃也不吃', () => {
    // 1、2、9 万，1、9 筒，1、9 索，东南西北白发：上家打 3 万，能吃，但是没有役
    const s = discardTo(table({ hands: ['129m19p19s123456z', '', '', '3m'], turn: 3, dealer: 3, personas: [0, 0, 0, 0] }), 3, '3m');
    expect(view(s, 0).prompt!.claim?.opts).toContain('chi');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'pass' });
  });

  test('断幺九的路：手里没有幺九，吃了能听牌，爱鸣的就吃', () => {
    // 234m 567p 345s 6s 8s 45p：上家打 6 筒，吃 4、5、6 筒，再打 8 索，听 6 索，断幺九
    const s = discardTo(table({ hands: ['234m567p345s68s45p', '', '', '6p'], turn: 3, dealer: 3, personas: [0, 0, 0, 0] }), 3, '6p');
    expect(decideAt(s, 0)).toEqual({ t: 'claim', w: s.claim!.id, c: 'chi', low: k1('4p') });
  });

  test('守门清的性格，一向听不为一点速度吃', () => {
    const s = discardTo(table({ hands: ['234m567p345s68s45p', '', '', '6p'], turn: 3, dealer: 3, personas: [2, 2, 2, 2] }), 3, '6p');
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'pass' });
  });

  test('听牌了就守着，不鸣', () => {
    const s = discardTo(table({ hands: ['234m567p345s66s45p', '', '', '3p'], turn: 3, dealer: 3, personas: [0, 0, 0, 0] }), 3, '3p');
    // 3 筒能荣和（3、6 筒），荣
    expect(decideAt(s, 0)).toMatchObject({ t: 'claim', c: 'ron' });
  });
});

describe('杠', () => {
  test('立直后摸到第四张：不改听牌的暗杠，杠', () => {
    const s = table({ hands: ['111m456p789p234s5s1m'], riichi: { 0: 0 } });
    expect(view(s, 0).prompt!.kan).toBeDefined();
    expect(decideAt(s, 0)).toMatchObject({ t: 'kan' });
  });

  test('别人立直了，没立直的我不开新杠', () => {
    const s = table({ hands: ['1111m369p258s147z'], river: ['', '5p', '', ''], riichi: { 1: 0 } });
    expect(view(s, 0).prompt!.kan).toBeDefined();
    expect(decideAt(s, 0).t).toBe('discard');
  });

  test('没人立直、不破坏手牌：暗杠', () => {
    // 1111m 加三组顺子和一对，杠了还听牌
    const s = table({ hands: ['1111m456p79p2345s2z'] });
    expect(view(s, 0).prompt!.kan).toBeDefined();
    expect(decideAt(s, 0)).toMatchObject({ t: 'kan' });
  });
});

describe('九种九牌', () => {
  test('幺九牌九种、手也不好：宣告流局', () => {
    const s = table({ hands: ['1489m179p1469s123z'], first: true });
    expect(view(s, 0).prompt!.kyuushu).toBe(true);
    expect(decideAt(s, 0)).toEqual({ t: 'kyuushu' });
  });

  test('十一种以上：国士还有指望，不宣告', () => {
    const s = table({ hands: ['19m19p19s12345z46p4s'], first: true });
    expect(view(s, 0).prompt!.kyuushu).toBe(true);
    expect(decideAt(s, 0).t).toBe('discard');
  });
});

describe('出手', () => {
  test('同一个视图同一个决定（没有随机数）', () => {
    const s = table({ hands: ['234556m567p789s99p'] });
    const v = view(s, 0);
    expect(AI.decide(v)).toEqual(AI.decide(structuredClone(v)));
  });

  test('性格的参数在范围里，场地手软的更不防守、更爱立直', () => {
    const s = table({ hands: ['234556m567p789s99p'], riichi: { 1: 0 } });
    const mk = (persona: number, soft: number): RcView => {
      const g = structuredClone(s);
      g.personas[0] = persona;
      g.tunes = [{ mood: 0, soft }, NEUTRAL_TUNE, NEUTRAL_TUNE, NEUTRAL_TUNE];
      return view(g, 0);
    };
    for (let p = 0; p < PERSONAS.length; p++) {
      const st = styleOf(mk(p, 0));
      for (const x of [st.defense, st.greed, st.pon, st.kanLove, st.slip, st.reads]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1_000);
      }
    }
    expect(styleOf(mk(2, 0)).defense).toBeGreaterThan(styleOf(mk(5, 0)).defense);
    expect(styleOf(mk(2, 1_000)).defense).toBeLessThan(styleOf(mk(2, 0)).defense);
  });
});

describe('整场：只出 prompt 里允许的动作', () => {
  /** 一个动作是不是 prompt 允许的（超时代出之外，电脑只该出这些） */
  function allowed(v: RcView, a: RcAction): boolean {
    const p = v.prompt!;
    switch (a.t) {
      case 'tsumo':
        return !!p.tsumo;
      case 'kyuushu':
        return !!p.kyuushu;
      case 'kan':
        return !!p.kan?.includes(a.tile);
      case 'discard':
        return a.riichi ? !!p.riichi?.includes(a.tile) : !!p.discard?.includes(a.tile);
      case 'claim': {
        const c = p.claim;
        if (!c || a.w !== c.w) return false;
        if (a.c === 'pass') return true;
        if (!c.opts.includes(a.c)) return false;
        return a.c === 'chi' ? a.low !== undefined && c.chi.includes(a.low) : a.low === undefined;
      }
      default:
        return false;
    }
  }

  test('各种性格、各种场地的电脑打完几场：每一步都合法，点数守恒，动作五花八门', () => {
    const seen = new Set<string>();
    let decisions = 0;
    const venues = Object.keys(VENUES);
    for (let i = 0; i < 6; i++) {
      const plan = seatPlan(stream(KEY, 'persona', i), venues[(i * 5) % venues.length]!, 4);
      let s = RC.begin([i, 7, 7, 7, 7, 7, 7, 7], { length: i % 2 ? 'tonpuu' : 'hanchan' }, ['ai', 'ai', 'ai', 'ai'], { share: 2_000, base: 80, personas: plan.personas, tunes: plan.tunes }) as RcState;
      for (let n = 0; n < 50_000 && !RC.over(s); n++) {
        const act = RC.actors(s);
        if (!act || !act.seats.length) {
          s = RC.resume(s);
          continue;
        }
        const seat = act.seats[0]!;
        const v = view(s, seat);
        if (v.prompt) {
          const a = AI.decide(v);
          expect(allowed(v, a), `${JSON.stringify(a)} ← ${JSON.stringify(v.prompt)}`).toBe(true);
          seen.add(a.t === 'claim' ? `claim:${a.c}` : a.t === 'discard' && a.riichi ? 'riichi' : a.t);
          decisions++;
        }
        const next = RC.apply(s, seat, RC.auto(s, seat, AI));
        if ('error' in next) throw new Error(next.error);
        s = next;
        expect(s.points.reduce((a, b) => a + b, 0) + s.sticks * 1_000).toBe(100_000);
      }
      expect(RC.over(s)).toBe(true);
    }
    expect(decisions).toBeGreaterThan(2_500);
    for (const k of ['discard', 'riichi', 'tsumo', 'claim:ron', 'claim:pon', 'claim:chi']) expect(seen.has(k), `${k}：${[...seen]}`).toBe(true);
  });

  test('出手不慢：一整场里电脑每一次决定 p99 不到 20 毫秒，平均几毫秒以内', () => {
    let s = RC.begin(KEY, RC.defaults, ['ai', 'ai', 'ai', 'ai'], { ...SETUP, personas: [0, 1, 2, 4] }) as RcState;
    const ms: number[] = [];
    for (let n = 0; n < 20_000 && !RC.over(s); n++) {
      const act = RC.actors(s);
      if (!act || !act.seats.length) {
        s = RC.resume(s);
        continue;
      }
      const seat = act.seats[0]!;
      const t0 = performance.now();
      const a = RC.auto(s, seat, AI);
      ms.push(performance.now() - t0);
      s = RC.apply(s, seat, a) as RcState;
    }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length * 0.99)]!).toBeLessThan(20);
    expect(ms.reduce((a, b) => a + b, 0) / ms.length).toBeLessThan(5);
  });
});
