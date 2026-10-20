/** 立直麻将的牌局流程（docs/riichi.md 第 1、2 节）。役、符、点数本身在 riichi-score.test.ts */
import { describe, expect, test } from 'vitest';
import { newWall } from '../src/core/table/index.ts';
import { allTiles, kindOf, tileOf, type Tile } from '../src/core/tiles/index.ts';
import {
  canKyuushu,
  chiOptions,
  discardOptions,
  finishMatch,
  furiten,
  kanOptions,
  parse,
  riichi as RC,
  riichiOptions,
  tenpaiKinds,
  TILESET,
  view,
  type RcAction,
  type RcState,
  type RcView,
} from '../src/core/variants/riichi/index.ts';
import { kinds } from './helpers.ts';

const KEY = [7, 7, 7, 7, 1, 2, 3, 4];
const SETUP = { share: 2_000, base: 80, personas: [0, 1, 2, 3] };

function act(s: RcState, seat: number, a: RcAction): RcState {
  const r = RC.apply(s, seat, a);
  if ('error' in r) throw new Error(`${seat} ${JSON.stringify(a)}: ${r.error}`);
  return r;
}

/**
 * 摆一个局面：四家手牌（turn 那家 14 张，排序后最后一张当作刚摸的）、牌墙接下来的牌、王牌区（不写就用剩下的字牌）。
 * 同种牌先用第 3 张、最后才用第 0 张，所以没写满四张时手里没有赤五（点数好算）。
 * 手牌里写 '*' 的，用散牌补到 13 张（turn 那家 14 张）：同一家里没有对子、没有相隔 2 以内的同门牌，碰、吃、和都凑不上。
 */
function table(hands: string[], turn: number, wall = '', opts: { dealer?: number; dead?: string; river?: string[]; pons?: { seat: number; k: string; from: number }[] } = {}): RcState {
  const used = new Map<number, number>();
  const take = (str: string): Tile[] =>
    kinds(str).map((k) => {
      const n = used.get(k) ?? 0;
      if (n >= 4) throw new Error(`too many ${k}`);
      used.set(k, n + 1);
      return tileOf(k, 3 - n);
    });
  const s = RC.begin(KEY, RC.defaults, ['human', 'human', 'human', 'human'], SETUP);
  const explicit = hands.map((h) => take(h.replace('*', '')));
  const w = take(wall);
  const dead = take(opts.dead ?? '');
  const rivers = [0, 1, 2, 3].map((i) => take(opts.river?.[i] ?? ''));
  const pons = (opts.pons ?? []).map((x) => ({ ...x, tiles: take(x.k + x.k + x.k) }));
  const ORDER = [0, 3, 6, 10, 13, 16, 20, 23, 26, 27, 28, 29, 30, 31, 32, 33, 1, 4, 7, 9, 12, 15, 18, 21, 24, 2, 5, 8, 11, 14, 17, 19, 22, 25];
  const hand = explicit.map((ts, i) => {
    if (!hands[i]!.includes('*')) return ts;
    const want = i === turn ? 14 : 13;
    for (const k of ORDER) {
      if (ts.length >= want) break;
      const near = ts.some((t) => kindOf(t) === k || (k < 27 && kindOf(t) < 27 && Math.floor(kindOf(t) / 9) === Math.floor(k / 9) && Math.abs(kindOf(t) - k) <= 2));
      if (!near && (used.get(k) ?? 0) < 4) ts.push(...take(String(k < 27 ? (k % 9) + 1 : k - 26) + 'mpsz'[Math.floor(k / 9)]!));
    }
    return ts;
  });
  s.players = hand.map((h, i) => ({ hand: h.sort((a, b) => a - b), melds: [], river: rivers[i]!.map((tile) => ({ tile })), riichi: 0, riichiAt: -1, ippatsu: false, passed: false, locked: false, banned: [], draws: 2 }));
  for (const x of pons) s.players[x.seat]!.melds.push({ kind: 'pon', tiles: x.tiles, from: x.from });
  const taken = new Set([...hand.flat(), ...w, ...dead, ...rivers.flat(), ...pons.flatMap((x) => x.tiles)]);
  const rest = allTiles(TILESET).filter((t) => !taken.has(t)).reverse();
  while (dead.length < 14) dead.push(rest.shift()!);
  s.dead = dead;
  s.doraOpen = 1;
  s.wall = newWall(w, 0);
  s.phase = 'turn';
  s.turn = turn;
  s.dealer = opts.dealer ?? turn;
  s.first = s.dealer;
  s.drawn = s.players[turn]!.hand.at(-1)!;
  s.canTsumo = true;
  s.noCalls = false;
  s.discards = 8;
  s.start = s.points.slice();
  s.events = [];
  return s;
}

const tileIn = (s: RcState, seat: number, k: string): Tile => s.players[seat]!.hand.find((t) => kindOf(t) === kinds(k)[0])!;
const discard = (s: RcState, seat: number, k: string, riichi = false): RcState => act(s, seat, { t: 'discard', tile: tileIn(s, seat, k), ...(riichi ? { riichi: true as const } : {}) });
const discardDrawn = (s: RcState): RcState => act(s, s.turn, { t: 'discard', tile: s.drawn! });
const claim = (s: RcState, seat: number, c: 'ron' | 'pon' | 'chi' | 'kan' | 'pass', low?: number): RcState => act(s, seat, { t: 'claim', w: s.claim!.id, c, ...(low === undefined ? {} : { low }) });
const total = (s: RcState): number => s.points.reduce((a, b) => a + b, 0) + s.sticks * 1000;

/** 平和断幺两面听 36s：荣和 2 番 30 符（子家 2,000），自摸 3 番 20 符（子家和：庄 1,300、子 700） */
const TANYAO = '234m567m234p66p45s';

// ---------- 随机打完整场 ----------

/** 一个不动脑的玩家：能和就和，能立直就立直，否则打摸到的牌；声明窗口轮着选（只测流程，不测打法） */
const BOT = {
  decide(v: RcView): RcAction {
    const p = v.prompt!;
    if (p.claim) return { t: 'claim', w: p.claim.w, c: p.claim.opts.includes('ron') ? 'ron' : p.claim.opts[(p.claim.w + v.me!.seat) % p.claim.opts.length]! };
    if (p.tsumo) return { t: 'tsumo' };
    if (p.riichi) return { t: 'discard', tile: p.riichi.at(-1)!, riichi: true };
    if (p.kan && v.history.length % 2) return { t: 'kan', tile: p.kan[0]! };
    const d = p.discard!;
    return { t: 'discard', tile: v.me!.drawn !== null && d.includes(v.me!.drawn) ? v.me!.drawn : d[0]! };
  },
};

function playOut(key: number[], length: 'hanchan' | 'tonpuu'): RcState {
  let s = RC.begin(key, { length }, ['ai', 'ai', 'ai', 'ai'], SETUP);
  let steps = 0;
  while (s.phase !== 'over') {
    if (s.phase === 'end') s = RC.resume(s);
    else {
      const seat = RC.actors(s)!.seats[0]!;
      s = act(s, seat, RC.auto(s, seat, BOT));
    }
    expect(total(s)).toBe(100_000);
    if (++steps > 20_000) throw new Error('stuck');
  }
  return s;
}

describe('整场', () => {
  test('随机打完一场：点数守恒、能结束、筹码守恒、得分合计 0', () => {
    const ends = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const s = playOut([i, 9, 8, 7, 6, 5, 4, 3], i % 2 ? 'tonpuu' : 'hanchan');
      expect(s.final!.score.reduce((a, b) => a + b, 0)).toBe(0);
      expect(s.chips.reduce((a, b) => a + b, 0)).toBe(8_000);
      expect(s.chips.every((c) => c >= 0)).toBe(true);
      for (const h of s.history) ends.add(h.end);
    }
    expect(ends.has('ron') || ends.has('tsumo')).toBe(true);
    expect(ends.has('draw')).toBe(true);
  });

  test('同一个种子、同一串动作，结果完全一样', () => {
    expect(JSON.stringify(playOut(KEY, 'hanchan'))).toBe(JSON.stringify(playOut(KEY, 'hanchan')));
  });

  test('开局：王牌区 14 张、翻一张宝牌、庄家摸第一张（牌墙剩 69）、赤宝牌 3 张', () => {
    const s = RC.begin(KEY, RC.defaults, ['ai', 'ai', 'ai', 'ai'], SETUP);
    expect(s.dead.length).toBe(14);
    expect(s.doraOpen).toBe(1);
    expect(s.players[s.dealer]!.hand.length).toBe(14);
    expect(view(s, 0).wall).toBe(69);
    expect(allTiles(TILESET).length).toBe(136);
    expect(TILESET.red.map(kindOf)).toEqual(kinds('5m5p5s'));
  });
});

// ---------- 和牌收点 ----------

describe('和牌收点', () => {
  test('荣和：放铳者付，本场 300 一本，供托归和的人；子家和了换庄、本场清零', () => {
    let s = table(['*6s', TANYAO, '*', '*'], 0, '1z');
    s.honba = 2;
    s.sticks = 1;
    s.points = [24_000, 25_000, 25_000, 25_000];
    s.start = s.points.slice();
    s = discard(s, 0, '6s');
    // 45s 也能吃 6s：和、吃都给
    expect(view(s, 1).prompt!.claim!.opts).toEqual(['ron', 'chi']);
    s = claim(s, 1, 'ron');
    expect(s.points[1]).toBe(25_000 + 2_000 + 600 + 1_000);
    expect(s.points[0]).toBe(24_000 - 2_600);
    expect(s.sticks).toBe(0);
    expect(s.honba).toBe(0);
    expect(s.dealer).toBe(1);
    expect(s.history.at(-1)!.end).toBe('ron');
    expect(s.history.at(-1)!.wins[0]!.score.yaku.map((y) => y.id).sort()).toEqual(['pinfu', 'tanyao']);
  });

  test('双响：两家都收，本场和供托只给离放铳者近的那家；三家和流局', () => {
    const three = (): RcState => table(['*6s', TANYAO, '234m567m234p77p45s', '345m678m345p88p45s'], 0, '1z');
    let s = three();
    s.honba = 1;
    s.sticks = 1;
    s = discard(s, 0, '6s');
    s = claim(s, 1, 'ron');
    s = claim(s, 2, 'ron');
    s = claim(s, 3, 'pass');
    const w = s.history.at(-1)!.wins;
    expect(w.map((x) => x.seat)).toEqual([1, 2]);
    expect(w[0]!.gain).toBe(2_000 + 300 + 1_000);
    expect(w[1]!.gain).toBe(2_000);
    expect(s.points[0]).toBe(25_000 - 4_300);

    let t = three();
    t = discard(t, 0, '6s');
    for (const i of [1, 2, 3]) t = claim(t, i, 'ron');
    expect(t.history.at(-1)!.end).toBe('three_ron');
    expect(t.dealer).toBe(0);
    expect(t.honba).toBe(1);
    expect(t.points).toEqual([25_000, 25_000, 25_000, 25_000]);
  });

  test('自摸：庄家付两份；本场每家 100', () => {
    let s = table(['*', TANYAO + '6s', '*', '*'], 1, '1z', { dealer: 0 });
    s.honba = 1;
    s = act(s, 1, { t: 'tsumo' });
    expect(s.points[0]).toBe(25_000 - 1_300 - 100);
    expect(s.points[2]).toBe(25_000 - 700 - 100);
    expect(s.points[1]).toBe(25_000 + 1_300 + 700 * 2 + 300);
  });

  test('包牌：大三元第三组是谁打的，自摸时他全付；荣和时他和放铳者各付一半', () => {
    // 1 号碰了白（2 号打的）、发（2 号）、中（3 号打的，第三组：3 号负责），手里 东东 23m 听 14m
    const pons = [
      { seat: 1, k: '5z', from: 2 },
      { seat: 1, k: '6z', from: 2 },
      { seat: 1, k: '7z', from: 3 },
    ];
    let s = table(['*', '1z1z23m4m', '*', '*'], 1, '9p', { dealer: 0, pons });
    s.honba = 1;
    s = act(s, 1, { t: 'tsumo' });
    expect(s.history.at(-1)!.wins[0]!.pao).toBe(3);
    expect(s.points).toEqual([25_000, 25_000 + 32_000 + 300, 25_000, 25_000 - 32_000 - 300]);

    let t = table(['*4m', '1z1z23m', '*', '*'], 0, '9p', { dealer: 0, pons });
    t = discard(t, 0, '4m');
    t = claim(t, 1, 'ron');
    expect(t.points).toEqual([25_000 - 16_000, 25_000 + 32_000, 25_000, 25_000 - 16_000]);

    // 放铳的就是责任者：他一个人付
    let u = table(['*', '1z1z23m', '*', '*4m'], 3, '9p', { dealer: 0, pons });
    u = discard(u, 3, '4m');
    u = claim(u, 1, 'ron');
    expect(u.points).toEqual([25_000, 25_000 + 32_000, 25_000, 25_000 - 32_000]);
  });
});

// ---------- 立直、一发、振听 ----------

describe('立直', () => {
  test('立直后打出的牌没人和才放棒，一发开始；立直后只能打摸到的牌', () => {
    let s = table([TANYAO + '9m', '*', '*', '*'], 0, '1z2z3z4z5z');
    expect(riichiOptions(s, 0).map(kindOf)).toEqual(kinds('9m'));
    s = discard(s, 0, '9m', true);
    expect(s.players[0]!.riichi).toBe(1);
    expect(s.players[0]!.riichiAt).toBe(0);
    expect(s.points[0]).toBe(24_000);
    expect(s.sticks).toBe(1);
    expect(s.players[0]!.ippatsu).toBe(true);
    for (let i = 1; i < 4; i++) s = discardDrawn(s);
    expect(discardOptions(s, 0)).toEqual([s.drawn]);
    expect(RC.apply(s, 0, { t: 'discard', tile: tileIn(s, 0, '2m') })).toEqual({ error: 'riichi_locked' });
    s = discardDrawn(s);
    expect(s.players[0]!.ippatsu).toBe(false);
  });

  test('立直宣告牌被荣和：立直不成立，不扣棒', () => {
    let s = table(['1z1z1z2z2z2z3z3z3z4z4z5z5z6s', TANYAO, '*', '*'], 0, '6z6z6z7z');
    s = discard(s, 0, '6s', true);
    s = claim(s, 1, 'ron');
    expect(s.points[0]).toBe(25_000 - 2_000);
    expect(s.sticks).toBe(0);
    expect(s.players[0]!.riichi).toBe(0);
  });

  test('条件：副露了、点数不到 1,000、牌墙不到 4 张都不能立直', () => {
    const base = (): RcState => table([TANYAO + '9m', '*', '*', '*'], 0, '1z2z3z4z');
    expect(riichiOptions(base(), 0).length).toBe(1);
    const a = base();
    a.points[0] = 900;
    expect(riichiOptions(a, 0)).toEqual([]);
    const b = base();
    b.wall.head++;
    expect(riichiOptions(b, 0)).toEqual([]);
    const c = base();
    c.players[0]!.melds.push({ kind: 'pon', tiles: [tileOf(27, 0), tileOf(27, 1), tileOf(27, 2)], from: 1 });
    expect(riichiOptions(c, 0)).toEqual([]);
    expect(RC.apply(c, 0, { t: 'discard', tile: tileIn(c, 0, '9m'), riichi: true })).toEqual({ error: 'cannot_riichi' });
  });

  test('一发：有人鸣牌就没了', () => {
    let s = table([TANYAO + '9m', '*7z', '7z7z*', '*'], 0, '1z2z3z4z');
    s = discard(s, 0, '9m', true);
    s = discard(s, 1, '7z');
    expect(s.claim!.opts[2]).toContain('pon');
    s = claim(s, 2, 'pon');
    expect(s.players[0]!.ippatsu).toBe(false);
  });

  test('一发自摸：立直后下一次摸牌就和', () => {
    let s = table([TANYAO + '9m', '*', '*', '*'], 0, '1z2z3z6s', { dealer: 1 });
    s = discard(s, 0, '9m', true);
    for (let i = 1; i < 4; i++) s = discardDrawn(s);
    s = act(s, 0, { t: 'tsumo' });
    const ids = s.history.at(-1)!.wins[0]!.score.yaku.map((y) => y.id);
    expect(ids).toEqual(expect.arrayContaining(['riichi', 'ippatsu', 'tsumo', 'pinfu', 'tanyao']));
  });
});

describe('振听', () => {
  test('舍张振听：自己打过和牌张就不能荣和，但能自摸', () => {
    let s = table(['*6s', TANYAO, '*', '*'], 0, '6s1z', { river: ['', '3s'] });
    expect(furiten(s.players[1]!)).toBe('river');
    s = discard(s, 0, '6s');
    expect(s.claim!.opts[1]).toEqual(['chi']);
    s = claim(s, 1, 'pass');
    expect(view(s, 1).prompt!.tsumo).toBe(true);
  });

  test('同巡振听：放过和牌张以后、自己摸牌前别家再打也不能和；自己摸牌后解除', () => {
    let s = table(['*3s', TANYAO, '*', '*6s'], 3, '7z1z');
    s = discard(s, 3, '6s');
    s = claim(s, 1, 'pass');
    expect(furiten(s.players[1]!)).toBe('passed');
    expect(s.turn).toBe(0);
    s = discard(s, 0, '3s');
    expect(s.claim!.opts[1]).toEqual(['chi']);
    s = claim(s, 1, 'pass');
    expect(s.turn).toBe(1);
    expect(furiten(s.players[1]!)).toBeNull();
  });

  test('立直后振听：放过一次，这一局一直振听', () => {
    let s = table(['*6s', TANYAO + '9m', '*', '*'], 1, '1z2z3z4z5z6z');
    s = discard(s, 1, '9m', true);
    s = discardDrawn(s);
    s = discardDrawn(s);
    s = discard(s, 0, '6s');
    s = claim(s, 1, 'pass');
    expect(s.players[1]!.locked).toBe(true);
    s = discardDrawn(s);
    expect(furiten(s.players[1]!)).toBe('riichi');
  });
});

// ---------- 吃碰杠 ----------

describe('吃碰杠', () => {
  test('吃只能吃上家；几种吃法都给；食替：吃 4 用 56 以后不能打 4 和 7', () => {
    const s = table(['*4m', '23m56m77m123p456p', '*', '*'], 0, '1z');
    expect(chiOptions(s.players[1]!.hand, tileIn(s, 0, '4m'))).toEqual(kinds('2m3m4m'));
    let n = discard(s, 0, '4m');
    expect(n.claim!.opts[1]).toEqual(['chi']);
    expect(n.claim!.opts[3]).toEqual([]);
    n = claim(n, 1, 'chi', kinds('4m')[0]);
    expect(n.players[1]!.melds[0]!.tiles.map(kindOf)).toEqual(kinds('456m'));
    expect(discardOptions(n, 1).map(kindOf)).not.toContain(kinds('7m')[0]);
    expect(RC.apply(n, 1, { t: 'discard', tile: tileIn(n, 1, '7m') })).toEqual({ error: 'kuikae' });
    expect(act(n, 1, { t: 'discard', tile: tileIn(n, 1, '2m') }).turn).toBe(2);
  });

  test('碰比吃优先；不是自己能吃的吃法不收', () => {
    let s = table(['*4m', '23m56m77m123p456p', '*', '4m4m*'], 0, '1z');
    s = discard(s, 0, '4m');
    expect(RC.apply(s, 1, { t: 'claim', w: s.claim!.id, c: 'chi', low: kinds('7m')[0] })).toEqual({ error: 'cannot_claim' });
    s = claim(s, 1, 'chi');
    s = claim(s, 3, 'pon');
    expect(s.turn).toBe(3);
    expect(s.players[3]!.melds[0]!.kind).toBe('pon');
    expect(s.players[1]!.melds).toEqual([]);
    expect(s.players[0]!.river[0]!.taken).toBe(true);
  });

  test('暗杠当场翻杠宝；大明杠打出下一张才翻；岭上摸牌后海底往前缩一张', () => {
    let s = table(['1z1z1z1z*', '*', '*', '*'], 0, '1m2m3m4m');
    expect(kanOptions(s, 0).map(kindOf)).toEqual([27]);
    const left = view(s, 0).wall;
    s = act(s, 0, { t: 'kan', tile: kanOptions(s, 0)[0]! });
    expect(s.doraOpen).toBe(2);
    expect(view(s, 0).wall).toBe(left - 1);
    expect(s.rinshan).toBe(true);
    expect(s.drawn).toBe(s.dead[10]);

    let t = table(['*6z', '6z6z6z*', '*', '*'], 0, '1m2m3m4m');
    t = discard(t, 0, '6z');
    expect(t.claim!.opts[1]).toEqual(['kan', 'pon']);
    t = claim(t, 1, 'kan');
    expect(t.doraOpen).toBe(1);
    expect(t.pendingDora).toBe(1);
    t = discardDrawn(t);
    expect(t.doraOpen).toBe(2);
  });

  test('抢杠：加杠的那张能荣和（抢杠 1 番）；暗杠的那张不给抢（不是国士）', () => {
    let s = table(['6s6s6s6s*', TANYAO, '*', '*'], 0, '1z');
    const p = s.players[0]!;
    const pon = p.hand.filter((t) => kindOf(t) === kinds('6s')[0]).slice(0, 3);
    p.hand = p.hand.filter((t) => !pon.includes(t));
    p.melds.push({ kind: 'pon', tiles: pon, from: 2 });
    p.hand.splice(0, 0);
    s = act(s, 0, { t: 'kan', tile: tileIn(s, 0, '6s') });
    expect(s.claim!.opts[1]).toEqual(['ron']);
    s = claim(s, 1, 'ron');
    const w = s.history.at(-1)!.wins[0]!;
    expect(w.score.yaku.map((y) => y.id)).toContain('chankan');
    expect(w.gain).toBe(3_900);

    let t = table(['6s6s6s6s*', TANYAO, '*', '*'], 0, '1z');
    t = act(t, 0, { t: 'kan', tile: tileIn(t, 0, '6s') });
    expect(t.claim).toBeNull();
    expect(t.turn).toBe(0);
    expect(t.players[0]!.melds[0]!.kan).toBe('concealed');
  });

  test('四杠散了：两人以上合计四杠，打出下一张没人和就流局；四杠以后不能再杠', () => {
    let s = table(['1z1z1z1z*', '*', '*', '*'], 0, '1m2m3m4m5m6m');
    s.kans = 3;
    s.kanBy = [1, 2, 3];
    s = act(s, 0, { t: 'kan', tile: kanOptions(s, 0)[0]! });
    expect(kanOptions(s, 0)).toEqual([]);
    s = discardDrawn(s);
    expect(s.history.at(-1)!.end).toBe('four_kans');
  });
});

// ---------- 流局 ----------

describe('流局', () => {
  test('荒牌：一家听拿 3,000；庄家没听换庄，本场 +1', () => {
    // 打 8s（不是幺九，免得成了流局满贯）
    let s = table(['*8s', TANYAO, '*', '*'], 0, '');
    s = discard(s, 0, '8s');
    expect(s.history.at(-1)!.end).toBe('draw');
    expect(s.history.at(-1)!.tenpai).toEqual([false, true, false, false]);
    expect(s.points).toEqual([24_000, 28_000, 24_000, 24_000]);
    expect(s.dealer).toBe(1);
    expect(s.honba).toBe(1);
  });

  test('荒牌：两家听各拿 1,500；庄家听牌连庄', () => {
    let t = table(['1z1z1z2z2z2z3z3z3z4z4z5z5z8s', TANYAO, '*', '*'], 0, '');
    t = discard(t, 0, '8s');
    expect(t.history.at(-1)!.tenpai).toEqual([true, true, false, false]);
    expect(t.points).toEqual([26_500, 26_500, 23_500, 23_500]);
    expect(t.dealer).toBe(0);
    expect(t.honba).toBe(1);
  });

  test('流局满贯：河里全是幺九、没被鸣走，按满贯自摸收，不付听牌费', () => {
    let s = table(['*', TANYAO, '*', '*'], 0, '', { river: ['1m9p'] });
    s = discardDrawn(s);
    expect(s.history.at(-1)!.end).toBe('nagashi');
    expect(s.points).toEqual([37_000, 21_000, 21_000, 21_000]);
  });

  test('九种九牌：第一次摸牌、没人鸣过才能宣告；庄家不变、本场 +1', () => {
    let s = table(['19m19p19s1234567z1m', '*', '*', '*'], 0, '1z');
    expect(canKyuushu(s, 0)).toBe(false);
    s.players[0]!.draws = 1;
    s.noCalls = true;
    expect(canKyuushu(s, 0)).toBe(true);
    s = act(s, 0, { t: 'kyuushu' });
    expect(s.history.at(-1)!.end).toBe('nine_terminals');
    expect(s.honba).toBe(1);
    expect(s.dealer).toBe(0);
  });

  test('四风连打', () => {
    let s = table(['1z*', '1z*', '1z*', '1z*'], 0, '1m9m1p9p');
    s.noCalls = true;
    s.discards = 0;
    for (let i = 0; i < 4; i++) s = discard(s, i, '1z');
    expect(s.history.at(-1)!.end).toBe('four_winds');
  });

  test('四家立直：第四家的立直成立后流局，立直棒留在桌上', () => {
    let s = table([TANYAO + '9m', '*', '*', '*'], 0, '1z2z3z4z5z');
    for (const p of [1, 2, 3]) s.players[p]!.riichi = 1;
    s.sticks = 3;
    s = discard(s, 0, '9m', true);
    expect(s.history.at(-1)!.end).toBe('four_riichi');
    expect(s.sticks).toBe(4);
  });
});

// ---------- 一场的结束和筹码 ----------

describe('一场结束', () => {
  test('供托给第一名；得分 = 点数差 + 马 + 头名奖，合计 0', () => {
    const s = table(['*', '*', '*', '*'], 0, '1z');
    s.points = [-100, 45_100, 30_000, 24_000];
    s.sticks = 1;
    finishMatch(s);
    expect(s.points[1]).toBe(46_100);
    expect(s.final!.rank).toEqual([1, 2, 3, 0]);
    expect(s.final!.score).toEqual([-30_100 - 20_000, 16_100 + 20_000 + 20_000, 10_000, -6_000 - 10_000]);
    expect(s.chips.reduce((a, b) => a + b, 0)).toBe(8_000);
    // 小档：每 50,000 分一份 2,000
    expect(s.chips[2]).toBeLessThanOrEqual(2_000 + 400);
  });

  test('同分按起家顺序排名', () => {
    const s = table(['*', '*', '*', '*'], 0, '1z');
    s.first = 2;
    s.points = [25_000, 25_000, 25_000, 25_000];
    finishMatch(s);
    expect(s.final!.rank).toEqual([2, 3, 0, 1]);
  });

  test('输的最多输掉带进来的：赢家按比例分（守恒）', () => {
    const s = table(['*', '*', '*', '*'], 0, '1z');
    s.points = [-30_000, 70_000, 35_000, 25_000];
    s.chips = [500, 2_000, 2_000, 2_000];
    finishMatch(s);
    expect(s.chips[0]).toBe(0);
    expect(s.chips.reduce((a, b) => a + b, 0)).toBe(6_500);
  });

  test('飞了当场结束', () => {
    let s = table(['*6s', TANYAO, '*', '*'], 0, '1z', { dealer: 3 });
    s.points = [1_000, 25_000, 25_000, 49_000];
    s.start = s.points.slice();
    s = discard(s, 0, '6s');
    s = claim(s, 1, 'ron');
    expect(s.points[0]).toBe(-1_000);
    expect(s.phase).toBe('over');
  });

  const last = (dealer: number, first: number, points: number[]): RcState => {
    const s = table(['*', TANYAO + '6s', '*', '*'], 1, '1z', { dealer });
    s.first = first;
    s.wind = 1;
    s.hand = 3;
    s.points = points;
    s.start = points.slice();
    return s;
  };

  test('最后一局庄家和了、已是第一且 30,000 以上：结束（和了止め）；不是第一：连庄', () => {
    expect(act(last(1, 2, [20_000, 31_000, 25_000, 24_000]), 1, { t: 'tsumo' }).phase).toBe('over');
    expect(act(last(1, 2, [40_000, 15_000, 25_000, 20_000]), 1, { t: 'tsumo' }).phase).toBe('end');
  });

  test('最后一局换庄时谁都不到 30,000：西入；到了就结束', () => {
    let d = act(last(0, 1, [25_000, 25_000, 25_000, 25_000]), 1, { t: 'tsumo' });
    expect(d.phase).toBe('end');
    expect(d.wind).toBe(2);
    expect(d.hand).toBe(0);
    d = RC.resume(d);
    expect(d.phase).toBe('turn');
    expect(act(last(0, 1, [25_000, 28_000, 25_000, 22_000]), 1, { t: 'tsumo' }).phase).toBe('over');
  });

  test('东风战打完东四局结束；西入最多打到西四局', () => {
    const s = last(0, 1, [25_000, 25_000, 25_000, 25_000]);
    s.wind = 2;
    expect(act(s, 1, { t: 'tsumo' }).phase).toBe('over');
    const t = last(0, 1, [25_000, 25_000, 25_000, 25_000]);
    t.opts = { length: 'tonpuu' };
    t.wind = 0;
    expect(act(t, 1, { t: 'tsumo' }).wind).toBe(1);
  });
});

// ---------- 视图、解析 ----------

describe('视图和动作校验', () => {
  test('别人的手牌、摸到的牌、王牌区、密钥不下发', () => {
    const s = RC.begin(KEY, RC.defaults, ['human', 'ai', 'ai', 'ai'], SETUP);
    const v = view(s, (s.dealer + 1) % 4);
    expect(v.seats[s.dealer]!.hand).toBeNull();
    expect(v.events.find((e) => e.e === 'draw')).toMatchObject({ tile: -1 });
    const json = JSON.stringify(v);
    expect(json).not.toContain('"key"');
    expect(json).not.toContain('"dead"');
    expect(v.dora.length).toBe(1);
  });

  test('解析：只收真人能发的', () => {
    expect(parse({ t: 'discard', tile: 3, riichi: true })).toEqual({ t: 'discard', tile: 3, riichi: true });
    expect(parse({ t: 'discard', tile: 136 })).toBeNull();
    expect(parse({ t: 'claim', w: 1, c: 'chi', low: 3 })).toEqual({ t: 'claim', w: 1, c: 'chi', low: 3 });
    expect(parse({ t: 'claim', w: 1, c: 'pon', low: 3 })).toBeNull();
    expect(parse({ t: 'claim', w: 1, c: 'pass', bot: true })).toBeNull();
    expect(parse({ t: 'expire', w: 1 })).toBeNull();
    expect(RC.options({ length: 'tonpuu' })).toEqual({ length: 'tonpuu' });
    expect(RC.options({ length: 'x' })).toBeNull();
  });

  test('听牌提示：听的牌；自己四张都在的不算', () => {
    const s = table(['*', TANYAO, '*', '*'], 0, '1z');
    expect(tenpaiKinds(s.players[1]!)).toEqual(kinds('3s6s'));
    const t = table(['*', '1z1z1z2z2z2z3z3z3z5z5z5z4z', '*', '*'], 0, '1z');
    expect(tenpaiKinds(t.players[1]!)).toEqual([30]);
  });
});
