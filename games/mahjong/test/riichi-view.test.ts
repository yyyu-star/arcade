/** 立直的界面层：牌桌视图的换算、听牌提示、结算的役种表、玩法入口的开关、字牌和赤五的牌面 */
import { describe, expect, test } from 'vitest';
import { kindOf, tileOf, type Tile } from '../src/core/tiles/index.ts';
import { riichi as RC, scoreWin, view, type HandScore, type RcState, type WinContext } from '../src/core/variants/riichi/index.ts';
import { hasRed, tileName, tileUrl } from '../src/view/tiles.ts';
import { riichiOpen, RIICHI_GATED } from '../src/view/variants/riichi/gate.ts';
import { handValue, scoreHead, yakuLines } from '../src/view/variants/riichi/summary.ts';
import { roundName, scoreText, yakumanName } from '../src/view/variants/riichi/text.ts';
import { tingOf } from '../src/view/variants/riichi/ting.ts';
import { tableView, windOf } from '../src/view/variants/riichi/view.ts';
import { kinds } from './helpers.ts';

const SETUP = { share: 2_000, base: 80, personas: [0, 1, 2, 3] };

/** 实物牌：同种牌依次用第 1、2、3、0 张，免得 5 无意中拿到赤牌 */
function T(s: string): Tile[] {
  const used = new Map<number, number>();
  return kinds(s).map((k) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return tileOf(k, (n + 1) % 4);
  });
}

const BASE: Omit<WinContext, 'win'> = { tsumo: false, seatWind: 1, roundWind: 0, riichi: 0, ippatsu: false, rinshan: false, chankan: false, haitei: false, houtei: false, tenhou: false, chiihou: false, dora: [], ura: [] };
function score(hand: string, win: string, o: Partial<WinContext> = {}): HandScore {
  const ts = T(hand);
  const wk = kinds(win)[0]!;
  const r = scoreWin(ts, [], { ...BASE, ...o, win: ts.findLast((t) => kindOf(t) === wk)! });
  if (!r) throw new Error('应该和得出');
  return r;
}

/** 平和断幺 36s 两面听，13 张在 0 号手里，轮到 1 号 */
function waiting(): RcState {
  const s = RC.begin([7, 7, 7, 7, 1, 2, 3, 4], RC.defaults, ['human', 'ai', 'ai', 'ai'], SETUP) as RcState;
  s.players[0]!.hand = T('234m567m234p66p45s');
  s.turn = 1;
  s.phase = 'turn';
  s.claim = null;
  return s;
}

describe('牌桌视图的换算', () => {
  test('结算停着时还算刚打完的那一局（round 不跳），和了的人带 won', () => {
    const s = RC.begin([1, 2, 3, 4, 5, 6, 7, 8], RC.defaults, ['human', 'ai', 'ai', 'ai'], SETUP) as RcState;
    expect(tableView(view(s, 0)).round).toBe(0);
    s.history.push({ wind: 0, hand: 0, honba: 0, dealer: 0, end: 'tsumo', delta: [0, 0, 0, 0], wins: [{ seat: 2, from: null, tile: 5, score: score('234m567p345s678s55p', '8s'), hand: [], melds: [], gain: 0, pao: null }], tenpai: null, dora: [], ura: [] });
    s.phase = 'end';
    const t = tableView(view(s, 0));
    expect(t.round).toBe(0);
    expect(t.seats[2]!.won).toMatchObject({ from: null, tile: 5 });
    expect(t.seats[0]!.won).toBeNull();
    s.phase = 'turn';
    expect(tableView(view(s, 0)).round).toBe(1);
  });

  test('结算停着时名牌的庄和自风按刚打完的这一局摆，和结算列表的风（windOf）一样；开了下一局再换', () => {
    // 东三局 2 号坐庄、子家和了：规则核心已经换到下一局（3 号坐庄），结算列表还按 2 号坐庄写风
    const s = RC.begin([1, 2, 3, 4, 5, 6, 7, 8], RC.defaults, ['human', 'ai', 'ai', 'ai'], SETUP) as RcState;
    s.first = 0;
    s.hand = 3;
    s.dealer = 3;
    s.history.push({ wind: 0, hand: 2, honba: 2, dealer: 2, end: 'ron', delta: [0, 8_600, 0, -8_600], wins: [{ seat: 1, from: 3, tile: 5, score: score('234m567p345s678s55p', '8s'), hand: [], melds: [], gain: 8_600, pao: null }], tenpai: null, dora: [], ura: [] });
    s.phase = 'end';
    const v = view(s, 0);
    expect(v.seats.map((x) => x.wind)).toEqual([1, 2, 3, 0]);
    const t = tableView(v);
    expect(t.dealer).toBe(2);
    expect(t.seats.map((x) => x.wind)).toEqual([0, 1, 2, 3].map((i) => windOf(2, i)));
    expect(t.seats.map((x) => x.wind)).toEqual([2, 3, 0, 1]);
    s.phase = 'turn';
    const next = tableView(view(s, 0));
    expect(next.dealer).toBe(3);
    expect(next.seats.map((x) => x.wind)).toEqual([1, 2, 3, 0]);
  });
});

describe('听牌提示', () => {
  test('现在这手：听哪些、各剩几张；桌上亮出来的（河、宝牌指示）才减，别人手里的不算', () => {
    const s = waiting();
    const k = (x: string): number => kinds(x)[0]!;
    expect(tingOf(view(s, 0), null)).toEqual([
      { kind: k('3s'), left: 4 },
      { kind: k('6s'), left: 4 },
    ]);
    // 1 号手里藏着 3s，看不见，不减；河里打出一张 3s、宝牌指示牌是 6s，各减一张
    s.players[1]!.hand = [...T('3s'), ...s.players[1]!.hand.slice(1)];
    s.players[2]!.river.push({ tile: tileOf(k('3s'), 0), n: 1 });
    s.dead[0] = tileOf(k('6s'), 0);
    s.doraOpen = 1;
    expect(tingOf(view(s, 0), null)).toEqual([
      { kind: k('3s'), left: 3 },
      { kind: k('6s'), left: 3 },
    ]);
  });

  test('14 张时没有"现在这手"；没人看的座位没有', () => {
    const s = waiting();
    expect(tingOf(view(s, null), null)).toBeNull();
    s.players[0]!.hand = [...s.players[0]!.hand, ...T('9z')];
    expect(tingOf(view(s, 0), null)).toBeNull();
  });
});

describe('役种表', () => {
  test('每个役一行，宝牌、赤宝牌、里宝牌分开写', () => {
    // 手里三张 5p：宝牌、里宝牌各 3 番
    const sc = score('234m567p345s678s55p', '8s', { riichi: 1, dora: [kinds('5p')[0]!], ura: [kinds('5p')[0]!] });
    const lines = yakuLines(sc);
    expect(lines.map((l) => l.name)).toEqual(expect.arrayContaining(['立直', '平和', '断幺九']));
    expect(lines.filter((l) => l.dora).map((l) => `${l.name}${l.han}`)).toEqual(['宝牌3 番', '里宝牌3 番']);
    // 立直、平和、断幺 3 番 + 宝牌 3 + 里宝 3 = 9 番：倍满，不写符
    expect(sc.han).toBe(9);
    expect(scoreHead(sc)).toBe('9 番 · 倍满');
    expect(scoreHead(score('234m567p345s678s55p', '8s', { riichi: 1 }))).toBe(`30 符 3 番`);
  });

  test('役满只列役满的名字，写倍数；累计役满写原来的役和"累计役满"', () => {
    const big = score('555z666z777z234m11p', '4m');
    expect(yakuLines(big)).toEqual([{ name: '大三元', han: '役满' }]);
    expect(scoreHead(big)).toBe('役满');
    expect(yakumanName(2)).toBe('双倍役满');
    const kazoe = score('234m567p345s678s55p', '8s', { riichi: 1, dora: Array<number>(8).fill(kinds('5p')[0]!) });
    expect(kazoe.kazoe).toBe(true);
    expect(yakuLines(kazoe).map((l) => l.name)).toContain('立直');
    expect(scoreHead(kazoe)).toContain('累计役满');
  });

  test('一把值多少点：从点数流水里加（不含本场和供托）', () => {
    const w = { seat: 1, from: 0, tile: 0, score: score('234m567p345s678s55p', '8s'), hand: [], melds: [], gain: 0, pao: null };
    const ledger = [
      { kind: 'ron', from: 0, to: 1, amount: 2_000 },
      { kind: 'honba', from: 0, to: 1, amount: 300 },
      { kind: 'stick', from: -1, to: 1, amount: 1_000 },
      { kind: 'ron', from: 3, to: 2, amount: 7_700 },
    ];
    expect(handValue(ledger, w)).toBe(2_000);
  });

  test('局名、得分的写法', () => {
    expect(roundName(0, 0)).toBe('东一局');
    expect(roundName(1, 2)).toBe('南三局');
    expect(scoreText(52_300)).toBe('+52.3');
    expect(scoreText(-18_400)).toBe('−18.4');
    expect(scoreText(0)).toBe('0.0');
  });
});

describe('入口的开关', () => {
  test('地址带 ?rc=1 才开；放开时把 RIICHI_GATED 改成 false', () => {
    expect(RIICHI_GATED).toBe(true);
    expect(riichiOpen('')).toBe(false);
    expect(riichiOpen('?rc=0')).toBe(false);
    expect(riichiOpen('?room=123456')).toBe(false);
    expect(riichiOpen('?rc=1')).toBe(true);
    expect(riichiOpen('?turbo&rc=1')).toBe(true);
  });
});

describe('牌面', () => {
  test('字牌七种、赤五三种各有自己的牌面，和普通牌、牌背都不一样', () => {
    const faces = new Set<string>();
    for (let k = 0; k <= 33; k++) faces.add(tileUrl(k));
    expect(faces.size).toBe(34);
    for (const k of [4, 13, 22]) {
      expect(hasRed(k)).toBe(true);
      expect(tileUrl(k, true)).not.toBe(tileUrl(k));
    }
    // 不是 5 的牌，red 不起作用
    expect(tileUrl(3, true)).toBe(tileUrl(3));
    expect(tileUrl(30)).not.toBe(tileUrl(-1));
    expect(tileName(27)).toBe('东');
    expect(tileName(31)).toBe('白');
    expect(tileName(4, true)).toBe('赤五万');
    expect(tileName(4)).toBe('五万');
  });

  test('每张牌面的体积不大（data URL 一张最多 8 KB）', () => {
    for (let k = 0; k <= 33; k++) expect(tileUrl(k).length, `${k}`).toBeLessThan(8_000);
    for (const k of [4, 13, 22]) expect(tileUrl(k, true).length).toBeLessThan(8_000);
  });
});
