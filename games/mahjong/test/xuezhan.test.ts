import { describe, expect, test } from 'vitest';
import { payMany } from '../src/core/match/index.ts';
import { newWall } from '../src/core/table/index.ts';
import { kindOf, tileOf, type Tile } from '../src/core/tiles/index.ts';
import {
  NO_CONTEXT,
  parse,
  result,
  scoreHand,
  sichuanXuezhan as XZ,
  view,
  type WinContext,
  type XzAction,
  type XzState,
} from '../src/core/variants/sichuan-xuezhan/index.ts';
import type { Meld } from '../src/core/table/index.ts';
import { xuezhanAi } from '../src/ai/xuezhan.ts';
import { tenpaiKinds } from '../src/core/variants/sichuan-xuezhan/rules.ts';
import { counts, kinds } from './helpers.ts';
import { act, RON, table, tileIn } from './xz-table.ts';

// ---------- 番 ----------

/** 把 'pon:5p' 'kan:7s' 这样的写法变成副露 */
function melds(...xs: string[]): Meld[] {
  return xs.map((x) => {
    const [kind, what] = x.split(':') as ['pon' | 'kan' | 'ankan', string];
    const k = kinds(what)[0]!;
    const n = kind === 'pon' ? 3 : 4;
    const tiles = Array.from({ length: n }, (_, i) => tileOf(k, i));
    return kind === 'pon' ? { kind: 'pon', tiles, from: 1 } : { kind: 'kan', tiles, from: kind === 'kan' ? 1 : null, kan: kind === 'kan' ? 'direct' : 'concealed' };
  });
}

const fan = (hand: string, m: Meld[] = [], ctx: Partial<WinContext> = {}, cap = 5) => scoreHand(counts(hand), m, { ...NO_CONTEXT, ...ctx }, cap);
const ids = (r: ReturnType<typeof fan>) => r.items.map((x) => (x.n ? `${x.id}${x.n}` : x.id)).sort();

describe('番型（DESIGN.md 2.7）', () => {
  test('平胡 0 番', () => {
    const r = fan('123m456m789p234s55s');
    expect(r.fan).toBe(0);
    expect(ids(r)).toEqual(['ping']);
  });

  test('对对胡 1、清一色 2、清对 3', () => {
    expect(fan('111m555p999s222s88s').fan).toBe(1);
    expect(fan('123m456m789m234m55m').fan).toBe(2);
    expect(ids(fan('111m333m555m777m99m'))).toEqual(['pengpeng', 'qing']);
    expect(fan('111m333m555m777m99m').fan).toBe(3);
  });

  test('七对 2、龙七对 3（含 1 根）、双龙 4、清七对 4、清龙七对 5', () => {
    expect(fan('11m22m33p44p55s66s77s').fan).toBe(2);
    expect(ids(fan('1111m33p44p55s66s77s'))).toEqual(['longqidui']);
    expect(fan('1111m33p44p55s66s77s').fan).toBe(3);
    expect(fan('1111m3333p55s66s77s').fan).toBe(4);
    expect(fan('11223355778899m').fan).toBe(4);
    expect(fan('11112233557799m').fan).toBe(5);
  });

  test('将对：全是 2、5、8 的对对胡', () => {
    const r = fan('222m555m555p888s22s');
    expect(ids(r)).toEqual(['jiangdui']);
    expect(r.fan).toBe(3);
  });

  test('带幺九 2：每组和将都带 1 或 9', () => {
    const r = fan('123m789m123p999s11s');
    expect(ids(r)).toEqual(['yaojiu']);
    expect(r.fan).toBe(2);
    // 有一组不带幺九就不算
    expect(fan('123m456m123p999s11s').fan).toBe(0);
  });

  test('金钩钓：碰杠四组，单钓胡（另算对对胡）', () => {
    const r = fan('55s', melds('pon:1m', 'pon:3p', 'pon:6p', 'pon:9s'));
    expect(ids(r)).toEqual(['jingou', 'pengpeng']);
    expect(r.fan).toBe(2);
  });

  test('根：手里四张一样、碰了再手里一张、杠了的都算', () => {
    // 1111m 拆成 111 + 123 里的 1：四张都在自己手里，算 1 根
    expect(ids(fan('11112m3m456p789s55s'))).toEqual(['gen1']);
    // 碰了 5p，手里还有一张 5p 用在顺子里
    expect(ids(fan('123m345p789s99s', melds('pon:5p')))).toEqual(['gen1']);
    // 杠
    expect(ids(fan('123m456p789s99s', melds('kan:7m')))).toEqual(['gen1']);
    // 两根
    expect(fan('123m456p99s', melds('kan:7m', 'ankan:2s')).fan).toBe(2);
  });

  test('杠上开花、杠上炮、抢杠、海底各 +1', () => {
    expect(ids(fan('123m456m789p234s55s', [], { zimo: true, gangKai: true }))).toEqual(['gangkai']);
    expect(ids(fan('123m456m789p234s55s', [], { gangPao: true }))).toEqual(['gangpao']);
    expect(ids(fan('123m456m789p234s55s', [], { rob: true }))).toEqual(['qianggang']);
    expect(ids(fan('123m456m789p234s55s', [], { zimo: true, haidi: true }))).toEqual(['haidi']);
    expect(ids(fan('123m456m789p234s55s', [], { haidi: true }))).toEqual(['haidipao']);
  });

  test('自摸加番 +1（房间选加番时）', () => {
    expect(fan('123m456m789p234s55s', [], { zimo: true, zimoFan: true }).fan).toBe(1);
    expect(fan('123m456m789p234s55s', [], { zimo: true }).fan).toBe(0);
  });

  test('天胡、地胡直接封顶', () => {
    const r = fan('123m456m789p234s55s', [], { zimo: true, tian: true }, 4);
    expect(r.fan).toBe(4);
    expect(ids(r)).toEqual(['tianhu']);
    expect(fan('123m456m789p234s55s', [], { zimo: true, di: true }, 3).fan).toBe(3);
  });

  test('封顶', () => {
    const r = fan('11112233557799m', [], {}, 4);
    expect(r.raw).toBe(5);
    expect(r.fan).toBe(4);
    expect(r.capped).toBe(true);
  });

  test('好几种拆法取最大', () => {
    // 七对（2）+ 清一色（2）> 一般型清一色（2）
    expect(fan('11223344556677m').fan).toBe(4);
  });
});

// ---------- 付钱 ----------

describe('付钱', () => {
  test('付不起：有多少付多少，按比例分，零头按顺序补', () => {
    const chips = [100, 0, 0, 0];
    const pays = payMany(chips, 0, [
      { to: 1, amount: 160 },
      { to: 2, amount: 160 },
      { to: 3, amount: 160 },
    ], 'pig');
    expect(pays.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(chips).toEqual([0, 34, 33, 33]);
  });
});

// ---------- 局面 ----------

describe('一局里的动作', () => {
  test('有缺先打缺', () => {
    const s = table(['123m456m789m1p2p33s4s', '5p', '6s', '7s'], [1, 2, 0, 0], 0, '9m');
    const r = XZ.apply(s, 0, { t: 'discard', tile: tileIn(s, 0, '1m') });
    expect(r).toEqual({ error: 'que_first' });
    expect('error' in XZ.apply(s, 0, { t: 'discard', tile: tileIn(s, 0, '1p') })).toBe(false);
  });

  test('自摸（加底）：每个还没胡的别家付一把 + 底分', () => {
    const s = table(['123m456m789m234p55p', '1s', '2s', '3s'], [2, 0, 0, 0], 0);
    const r = act(s, 0, { t: 'zimo' });
    expect(r.players[0]!.won?.fan).toBe(0);
    expect(r.chips).toEqual([2_000 + 3 * 20, 1_980, 1_980, 1_980]);
    // 下一家接着摸
    expect(r.turn).toBe(1);
    expect(r.phase).toBe('turn');
  });


  test('点炮、一炮多响：点炮的人分别付，下一局他坐庄；接着从最远的胡家的下家摸', () => {
    const s = RON();
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    expect(r.phase).toBe('claim');
    // 名单是所有还没胡的别家，看不出谁能动作
    expect(XZ.actors(r)).toEqual({ seats: [1, 2, 3], group: `claim-${r.claim!.id}` });
    // 没有选择的 3 号发"过"会被拒（不用他发，页面也不出按钮）
    expect(XZ.apply(r, 3, { t: 'claim', w: r.claim!.id, c: 'pass' })).toEqual({ error: 'no_claim' });
    expect(view(r, 3).prompt).toBeNull();
    expect(view(r, 1).prompt).toEqual({ claim: { w: r.claim!.id, opts: ['ron'] } });
    // 1 号答"胡"：不轮流的操作，名单不变
    expect(XZ.free({ t: 'claim', w: r.claim!.id, c: 'ron' })).toBe(true);
    const r1 = act(r, 1, { t: 'claim', w: r.claim!.id, c: 'ron' });
    expect(XZ.actors(r1)).toEqual(XZ.actors(r));
    expect(r1.phase).toBe('claim');
    // 2 号也胡：窗口结束
    const r2 = act(r1, 2, { t: 'claim', w: r.claim!.id, c: 'ron' });
    expect(r2.players[1]!.won?.from).toBe(0);
    expect(r2.players[2]!.won?.from).toBe(0);
    expect(r2.chips).toEqual([1_980, 2_010, 2_010, 2_000]);
    expect(r2.nextDealer).toBe(0);
    // 最远的胡家是 2，下家 3 摸牌
    expect(r2.turn).toBe(3);
    // 旧窗口的回答晚到：对不上
    expect(XZ.apply(r2, 3, { t: 'claim', w: r.claim!.id, c: 'pass' })).toEqual({ error: 'stale_claim' });
  });

  test('电脑、托管的回答（bot）离开名单；到点收掉整个窗口：能胡就胡', () => {
    const s = RON();
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    const w = r.claim!.id;
    expect(XZ.free({ t: 'claim', w, c: 'pass', bot: true })).toBe(false);
    const r3 = act(r, 3, { t: 'claim', w, c: 'pass', bot: true });
    expect(XZ.actors(r3)!.seats).toEqual([1, 2]);
    const done = act(r3, 1, { t: 'expire', w });
    expect(done.players[1]!.won).not.toBeNull();
    expect(done.players[2]!.won).not.toBeNull();
  });

  test('碰：拿走那张，轮到他打，不能自摸', () => {
    const s = table(['123m456m789m55p9p3p7p', '9p9p1m', '7s', '8s'], [2, 2, 0, 0], 0);
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '9p') });
    expect(r.claim!.opts[1]).toEqual(['pon']);
    const p = act(r, 1, { t: 'claim', w: r.claim!.id, c: 'pon' });
    expect(p.turn).toBe(1);
    expect(p.players[1]!.melds[0]!.kind).toBe('pon');
    expect(p.players[0]!.river.at(-1)!.taken).toBe(true);
    expect(p.canZimo).toBe(false);
    expect(view(p, 1).prompt!.zimo).toBeUndefined();
  });

  test('暗杠下雨：每个还没胡的别家付 2 倍底分；杠后补牌自摸是杠上开花', () => {
    // 0 号 1111m 暗杠，补到的牌（牌墙尾）是 5s，正好和
    const s = table(['1111m234m567m888s5s', '1p', '2p', '3p'], [1, 0, 0, 0], 0, '9m9m9m5s');
    const r = act(s, 0, { t: 'kan', tile: tileIn(s, 0, '1m') });
    expect(r.chips).toEqual([2_060, 1_980, 1_980, 1_980]);
    expect(r.afterKan).not.toBeNull();
    // 别人看不到暗杠的是什么牌
    expect(view(r, 1).seats[0]!.melds[0]!.tiles).toEqual([-1, -1, -1, -1]);
    const z = act(r, 0, { t: 'zimo' });
    expect(z.players[0]!.won!.items.map((x) => x.id)).toEqual(expect.arrayContaining(['gangkai', 'gen']));
  });

  test('杠上炮、呼叫转移：杠钱转给胡的人', () => {
    // 1 号打 7m，0 号直杠（1 号付 2 倍底分），补到牌墙尾的 5s 打出去，2 号（46s 嵌张）胡
    const s = table(['777m234m56m88m9s11s', '7m8p', '123m456m999m11s46s', '9p'], [1, 2, 1, 0], 1, '9s9s5s');
    const r = act(s, 1, { t: 'discard', tile: tileIn(s, 1, '7m') });
    expect(r.claim!.opts[0]).toEqual(['kan', 'pon']);
    const k = act(r, 0, { t: 'claim', w: r.claim!.id, c: 'kan' });
    expect(k.chips).toEqual([2_020, 1_980, 2_000, 2_000]);
    expect(k.turn).toBe(0);
    expect(kindOf(k.drawn!)).toBe(kinds('5s')[0]);
    const d = act(k, 0, { t: 'discard', tile: k.drawn! });
    expect(d.claim!.opts[2]).toEqual(['ron']);
    const w = act(d, 2, { t: 'claim', w: d.claim!.id, c: 'ron' });
    expect(w.players[2]!.won!.items.map((x) => x.id)).toContain('gangpao');
    expect(w.ledger.filter((x) => x.kind === 'move')).toEqual([{ kind: 'move', from: 0, to: 2, amount: 20, ref: k.kanSeq }]);
    // 关掉呼叫转移就不转
    const off = { ...s, opts: { ...s.opts, transfer: false } };
    const r2 = act(off, 1, { t: 'discard', tile: tileIn(s, 1, '7m') });
    const k2 = act(r2, 0, { t: 'claim', w: r2.claim!.id, c: 'kan' });
    const d2 = act(k2, 0, { t: 'discard', tile: k2.drawn! });
    expect(act(d2, 2, { t: 'claim', w: d2.claim!.id, c: 'ron' }).ledger.filter((x) => x.kind === 'move')).toEqual([]);
  });

  test('补杠可以被抢：抢杠胡 +1，这一杠作废不收钱', () => {
    // 0 号碰过 4s、手里又摸到 4s；1 号听 1s / 4s
    const s = table(['234m567m888m4s9s', '123m456m789m11s23s', '1p', '2p'], [1, 1, 0, 0], 0, '9m9m9m');
    s.players[0]!.melds = [{ kind: 'pon', tiles: [1, 2, 3].map((c) => tileOf(kinds('4s')[0]!, c)), from: 2 }];
    // 4s 一共四张：0 号碰的三张 + 手里一张，1 号的 23s 等的就是它
    const r = act(s, 0, { t: 'kan', tile: tileIn(s, 0, '4s') });
    expect(r.phase).toBe('claim');
    expect(r.claim!.rob).toBe(true);
    expect(r.claim!.opts[1]).toEqual(['ron']);
    const w = act(r, 1, { t: 'claim', w: r.claim!.id, c: 'ron' });
    expect(w.players[1]!.won!.items.map((x) => x.id)).toContain('qianggang');
    expect(w.players[0]!.melds[0]!.kind).toBe('pon');
    expect(w.ledger.filter((x) => x.kind === 'kan')).toEqual([]);
    // 没人抢就补杠成功：刮风，每家 1 倍底分
    const pass = act(r, 1, { t: 'claim', w: r.claim!.id, c: 'pass' });
    expect(pass.players[0]!.melds[0]!.kan).toBe('added');
    expect(pass.chips).toEqual([2_030, 1_990, 1_990, 1_990]);
  });

  test('流局：退税、查花猪、查大叫', () => {
    // 牌墙空了：0 号打出 9p 没人要，流局
    // 0 号听牌（11p + 23p，听 1p/4p）；1 号定缺条手里还有 5s、9s，是花猪；2 号定缺万手里还有 1m，是花猪；3 号没听，还收过 0 号的杠钱
    const s = table(['123m456m789m11p23p9p', '123p456p789p11m5s9s', '1m2s', '5p8s'], [2, 2, 0, 0], 0, '');
    s.ledger = [{ kind: 'kan', from: 0, to: 3, amount: 20, ref: 1 }];
    s.chips = [1_980, 2_000, 2_000, 2_020];
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '9p') });
    expect(r.phase).toBe('end');
    expect(r.ledger.filter((x) => x.kind === 'tax')).toEqual([{ kind: 'tax', from: 3, to: 0, amount: 20, ref: 1 }]);
    // 花猪赔给每个还没胡、不是花猪的人封顶（4 番 = 16 × 10）
    expect(r.ledger.filter((x) => x.kind === 'pig')).toEqual([
      { kind: 'pig', from: 1, to: 0, amount: 160 },
      { kind: 'pig', from: 1, to: 3, amount: 160 },
      { kind: 'pig', from: 2, to: 0, amount: 160 },
      { kind: 'pig', from: 2, to: 3, amount: 160 },
    ]);
    // 没听牌的 3 号赔给听牌的 0 号：按 0 号能胡的最大番（平胡 0 番 = 10）
    expect(r.ledger.filter((x) => x.kind === 'cha')).toEqual([{ kind: 'cha', from: 3, to: 0, amount: 10 }]);
    expect(r.chips.reduce((a, b) => a + b, 0)).toBe(8_000);
    expect(r.history.at(-1)!.end).toBe('wall');
  });
});

/** 推到这一局结束：轮到谁就用超时代出（真人一直不点），声明窗口到点收掉 */
function toEnd(s0: XzState): XzState {
  let s = s0;
  for (let k = 0; k < 500 && s.phase !== 'end' && s.phase !== 'over'; k++) {
    const seat = s.phase === 'claim' ? XZ.actors(s)!.seats[0]! : s.turn;
    s = act(s, seat, XZ.timeout(s, seat, xuezhanAi));
  }
  return s;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('一局的流程（#130 审阅补）', () => {
  test('杠 → 杠上炮转给胡的人 → 流局时杠的人没听牌：转走的不再退（不赔两遍）', () => {
    const s = table(['777m234m56m88m9s11s', '7m8p', '123m456m999m11s46s', '9p'], [1, 2, 1, 0], 1, '9s9s5s');
    const r = act(s, 1, { t: 'discard', tile: tileIn(s, 1, '7m') });
    const k = act(r, 0, { t: 'claim', w: r.claim!.id, c: 'kan' });
    const d = act(k, 0, { t: 'discard', tile: k.drawn! });
    const w = act(d, 2, { t: 'claim', w: d.claim!.id, c: 'ron' });
    expect(w.ledger.filter((x) => x.kind === 'move')).toHaveLength(1);
    const e = toEnd(w);
    expect(e.phase).toBe('end');
    expect(e.history.at(-1)!.end).toBe('wall');
    // 0 号没听牌：杠钱 20 已经整笔转给 2 号，不再退给 1 号
    expect(e.ledger.filter((x) => x.kind === 'tax')).toEqual([]);
    expect(sum(e.chips)).toBe(8_000);
  });

  test('一杠收了两家、转走一部分：只退没转走的', () => {
    const s = table(['123m456m789m11p23p9p', '123p456p789p11m5s9s', '1m2s', '5p8s'], [2, 2, 0, 0], 0, '');
    // 3 号补杠收了 0、1 号各 20，杠上炮转走 20 给胡了的人（这里记成 2 号）；3 号流局没听牌
    s.ledger = [
      { kind: 'kan', from: 0, to: 3, amount: 20, ref: 1 },
      { kind: 'kan', from: 1, to: 3, amount: 20, ref: 1 },
      { kind: 'move', from: 3, to: 2, amount: 20, ref: 1 },
    ];
    s.chips = [1_980, 1_980, 2_020, 2_020];
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '9p') });
    expect(r.ledger.filter((x) => x.kind === 'tax')).toEqual([{ kind: 'tax', from: 3, to: 1, amount: 20, ref: 1 }]);
    expect(sum(r.chips)).toBe(8_000);
  });

  test('换三张：四家选好一起换，按方向给到；之后定缺', () => {
    let s = XZ.begin([3, 1, 4, 1, 5, 9, 2, 6], XZ.defaults, ['human', 'human', 'human', 'human'], { share: 2_000, base: 10, personas: [0, 1, 2, 3] }) as XzState;
    expect(s.phase).toBe('swap');
    const outs: Tile[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = XZ.timeout(s, i, xuezhanAi);
      expect(a.t).toBe('swap');
      outs[i] = (a as { tiles: Tile[] }).tiles;
      // 换出去的三张同一门
      expect(new Set(outs[i]!.map((t) => Math.floor(kindOf(t) / 9))).size).toBe(1);
      s = act(s, i, a);
      if (i < 3) expect(s.phase).toBe('swap');
    }
    expect(s.phase).toBe('que');
    const give = s.swapDir! + 1;
    for (let i = 0; i < 4; i++) {
      const to = (i + give) % 4;
      expect(s.players[to]!.swapIn!.slice().sort((x, y) => x - y)).toEqual(outs[i]!.slice().sort((x, y) => x - y));
      for (const t of outs[i]!) expect(s.players[to]!.hand).toContain(t);
      expect(s.players[i]!.hand.length).toBe(i === s.dealer ? 14 : 13);
    }
  });

  test('手里还有缺门：别人打出能胡的那张也不能胡', () => {
    // 1 号定缺条、手里还有 123s，单钓 4p
    const s = table(['111s222s333p44s4p7p8p', '123m456m789m123s4p', '1p', '2p'], [0, 2, 2, 2], 0, '9m9m');
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '4p') });
    expect(r.phase === 'claim' ? r.claim!.opts[1] : []).not.toContain('ron');
  });

  test('三家都胡（一炮三响）：这一局马上结束', () => {
    const s = table(['111s222s333s44s5p7p8p', '123m456m789m11p46p', '123m456m789m11p67p', '123m456m789m22p34p'], [0, 2, 2, 2], 0, '9s9s9s');
    // 3 号的 34p 等 2p/5p，2p 已经有一对：5p 能胡
    let r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    for (const i of [1, 2, 3]) r = act(r, i, { t: 'claim', w: r.claim!.id, c: 'ron' });
    expect(r.phase).toBe('end');
    expect(r.history.at(-1)!.end).toBe('three');
    expect(sum(r.chips)).toBe(8_000);
  });

  test('胡了的人跳过：不摸牌、不在名单里', () => {
    const s = RON();
    let r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    r = act(act(r, 1, { t: 'claim', w: r.claim!.id, c: 'ron' }), 2, { t: 'claim', w: r.claim!.id, c: 'ron' });
    expect(r.turn).toBe(3);
    r = act(r, 3, { t: 'discard', tile: r.drawn! });
    if (r.phase === 'claim') expect(XZ.actors(r)!.seats).not.toContain(1);
    // 3 号打完下一个摸的是 0 号（1、2 号胡了）；有人能碰就先当他没要
    const after = r.phase === 'claim' ? act(r, 0, XZ.timeout(r, 0, xuezhanAi)) : r;
    expect(after.turn).toBe(0);
  });

  test('天胡：记庄家起手的第 14 张；地胡；海底捞月', () => {
    // 天胡：庄家 0 号起手就是和牌，还没摸过、没人打过
    const s = table(['123m456m789m234p55p', '1s', '2s', '3s'], [2, 0, 0, 0], 0);
    const first = s.players[0]!.hand.find((t) => kindOf(t) === kinds('9m')[0])!;
    s.wall.tiles = Array.from({ length: 60 }, (_, i) => (i === 52 ? first : s.wall.tiles[0]!));
    s.discards = 0;
    s.players[0]!.draws = 0;
    s.drawn = null;
    const t = act(s, 0, { t: 'zimo' });
    expect(t.players[0]!.won!.items.map((x) => x.id)).toEqual(['tianhu']);
    expect(t.players[0]!.won!.tile).toBe(first);
    // 地胡：闲家第一次摸牌就自摸、前面没人碰杠
    const d0 = table(['111s222s333s444s8p9p', '123m456m789m23p55p', '1s', '2s'], [0, 2, 0, 0], 0, '1p');
    d0.noCalls = true;
    d0.discards = 0;
    d0.players[1]!.draws = 0;
    const d1 = act(d0, 0, { t: 'discard', tile: tileIn(d0, 0, '9p') });
    expect(d1.turn).toBe(1);
    expect(act(d1, 1, { t: 'zimo' }).players[1]!.won!.items.map((x) => x.id)).toEqual(['dihu']);
    // 海底：摸到最后一张自摸
    d0.noCalls = false;
    const h1 = act(d0, 0, { t: 'discard', tile: tileIn(d0, 0, '9p') });
    expect(h1.wall.head > h1.wall.tail).toBe(true);
    expect(act(h1, 1, { t: 'zimo' }).players[1]!.won!.items.map((x) => x.id)).toContain('haidi');
  });
});

describe('校验', () => {
  test('parse 只收合格的形状', () => {
    expect(parse({ t: 'discard', tile: 5 })).toEqual({ t: 'discard', tile: 5 });
    expect(parse({ t: 'discard', tile: 200 })).toBeNull();
    expect(parse({ t: 'swap', tiles: [1, 2] })).toBeNull();
    expect(parse({ t: 'claim', w: 3, c: 'chi' })).toBeNull();
    expect(parse({ t: 'que', suit: 3 })).toBeNull();
    expect(parse('x')).toBeNull();
    expect(parse({ t: 'claim', w: 3, c: 'pon' })).toEqual({ t: 'claim', w: 3, c: 'pon' });
  });

  test('客户端发 expire、bot 被拒：只有服务端的超时、电脑能收掉窗口、离开名单（#130 审阅）', () => {
    expect(parse({ t: 'expire', w: 3 })).toBeNull();
    expect(parse({ t: 'claim', w: 3, c: 'pass', bot: true })).toBeNull();
    expect(parse({ t: 'claim', w: 3, c: 'pon', bot: 1 })).toBeNull();
    // 服务端自己造的照常能用
    const s = RON();
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    expect(XZ.timeout(r, 3, xuezhanAi)).toEqual({ t: 'expire', w: r.claim!.id });
    expect(XZ.auto(r, 3, xuezhanAi)).toEqual({ t: 'claim', w: r.claim!.id, c: 'pass', bot: true });
  });

  test('选项', () => {
    expect(XZ.options(undefined)).toEqual(XZ.defaults);
    expect(XZ.options({ rounds: 16, cap: 5 })).toMatchObject({ rounds: 16, cap: 5 });
    expect(XZ.options({ rounds: 7 })).toBeNull();
    expect(XZ.options({ zimo: 'x' })).toBeNull();
  });

  test('给钱包的小结不超过 256 字节', () => {
    const s = table(['123m456m789m234p55p', '1s', '2s', '3s'], [2, 0, 0, 0], 0);
    s.phase = 'over';
    for (const st of s.stats) {
      st.flags = ['xz_heaven', 'xz_earth', 'xz_dragon', 'xz_golden_hook', 'xz_rob_gang', 'xz_sea_moon', 'xz_gang_flower'];
      st.rounds = 16;
      st.gangs = 99;
      st.zimo = 99;
      st.maxFan = 5;
      st.best = 1_000_000;
    }
    for (const x of result(s).seats) {
      expect(new TextEncoder().encode(JSON.stringify(x.stats)).byteLength).toBeLessThanOrEqual(256);
      expect(x.stats.titles!.length).toBe(5);
    }
  });

  test('一场最多赢 3 份', () => {
    const s = table(['123m456m789m234p55p', '1s', '2s', '3s'], [2, 0, 0, 0], 0);
    s.chips = [9_000, 0, 0, 0];
    s.share = 2_000;
    expect(result(s).seats[0]!.chips).toBe(8_000);
  });

  test('定缺阶段看不到别人定了什么', () => {
    const s = XZ.begin([5, 5, 5, 5, 5, 5, 5, 5], { ...XZ.defaults, swap: false }, ['human', 'ai', 'ai', 'ai'], { share: 2_000, base: 10, personas: [0, 1, 2, 3] }) as XzState;
    const r = act(s, 1, { t: 'que', suit: 2 });
    expect(view(r, 0).seats[1]!.que).toBe(-1);
    expect(view(r, 0).seats[1]!.ready).toBe(true);
    expect(view(r, 1).seats[1]!.que).toBe(2);
  });
});

describe('自审 C5–C7', () => {
  // 流局的局面（和上面"退税"那个一样）：3 号没听，收过 0 号 20 的杠钱
  const wallEnd = () => {
    const s = table(['123m456m789m11p23p9p', '123p456p789p11m5s9s', '1m2s', '5p8s'], [2, 2, 0, 0], 0, '');
    s.ledger = [{ kind: 'kan', from: 0, to: 3, amount: 20, ref: 1 }];
    s.chips = [1_980, 2_000, 2_000, 2_020];
    return s;
  };
  const taxOf = (s: XzState) => act(s, 0, { t: 'discard', tile: tileIn(s, 0, '9p') }).ledger.filter((x) => x.kind === 'tax');

  test('C5 换人以后：换人前收的杠钱不让新人退，换人前付的也不退给新人；换人后的照退', () => {
    expect(taxOf(wallEnd())).toHaveLength(1);
    // 3 号（收钱的）中途换了人：那 20 是前一个人收的，新人不退
    expect(taxOf(XZ.restake(wallEnd(), 3, 2_000) as XzState)).toEqual([]);
    // 0 号（付钱的）中途换了人：不退给新人
    expect(taxOf(XZ.restake(wallEnd(), 0, 2_000) as XzState)).toEqual([]);
    // 换人以后才收的杠钱照退
    const s = XZ.restake(wallEnd(), 3, 2_000) as XzState;
    s.ledger.push({ kind: 'kan', from: 1, to: 3, amount: 20, ref: 2 });
    expect(taxOf(s)).toEqual([{ kind: 'tax', from: 3, to: 1, amount: 20, ref: 2 }]);
  });

  test('C6 一炮多响点炮的人付不起：按应收的比例分，不是先胡的先拿', () => {
    const s = RON();
    s.chips[0] = 5;
    const r = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    const r1 = act(r, 1, { t: 'claim', w: r.claim!.id, c: 'ron' });
    const r2 = act(r1, 2, { t: 'claim', w: r.claim!.id, c: 'ron' });
    // 两家各应收 10（平胡 0 番、底分 10），只有 5：3 / 2（零头按座位顺序给）
    expect(r2.ledger.filter((x) => x.kind === 'hu')).toEqual([
      { kind: 'hu', from: 0, to: 1, amount: 3 },
      { kind: 'hu', from: 0, to: 2, amount: 2 },
    ]);
  });

  test('C7 四张都在自己手里和碰杠里的那种不算听：查大叫按没听算', () => {
    const t = (k: string, copy: number): Tile => tileOf(kinds(k)[0]!, copy);
    const pon = (k: string): Meld => ({ kind: 'pon', tiles: [t(k, 0), t(k, 1), t(k, 2)], from: 1 });
    const hand = [...['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p'].map((k) => t(k, 0)), t('5m', 3)];
    const base = { river: [], que: 2 as const, swapOut: null, swapIn: null, won: null, draws: 1 };
    // 碰了 5 万、手里单钓第 4 张 5 万：不算听
    expect(tenpaiKinds({ ...base, hand, melds: [pon('5m')] })).toEqual([]);
    // 碰的是别的：单钓 5 万照算听
    expect(tenpaiKinds({ ...base, hand, melds: [pon('6m')] })).toEqual(kinds('5m'));
  });
});
