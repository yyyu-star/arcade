import { describe, expect, test } from 'vitest';
import type { Meld } from '../src/core/table/index.ts';
import { kindOf, tileOf, type Tile } from '../src/core/tiles/index.ts';
import {
  ALL_KINDS,
  basePoints,
  doraOf,
  isAgari,
  isKokushi,
  liability,
  payments,
  RED,
  scoreWin,
  waitsOf,
  YAKU_NAME,
  type WinContext,
  type YakuId,
} from '../src/core/variants/riichi/score.ts';
import { counts, kinds } from './helpers.ts';

// ---------- 写法：'234m567p' 之类 ----------

/** 实物牌：同种牌依次用第 1、2、3、0 张，免得 5 无意中拿到赤牌（第 0 张） */
function T(s: string): Tile[] {
  const used = new Map<number, number>();
  return kinds(s).map((k) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return tileOf(k, (n + 1) % 4);
  });
}

/** 'pon:5z' 'chi:234m' 'kan:2m'(大明杠) 'ankan:2m' 'addkan:2m' → 副露；from 默认 1 */
function M(...xs: string[]): Meld[] {
  return xs.map((x) => {
    const [type, what] = x.split(':') as [string, string];
    const [name, from] = type.split('@');
    const src = from === undefined ? 1 : Number(from);
    const ks = kinds(what);
    if (name === 'chi') return { kind: 'chi', tiles: ks.map((k) => tileOf(k, 1)), from: 2 };
    const k = ks[0]!;
    if (name === 'pon') return { kind: 'pon', tiles: [1, 2, 3].map((c) => tileOf(k, c)), from: src };
    const four = [0, 1, 2, 3].map((c) => tileOf(k, c));
    if (name === 'ankan') return { kind: 'kan', tiles: four, from: null, kan: 'concealed' };
    return { kind: 'kan', tiles: four, from: src, kan: name === 'addkan' ? 'added' : 'direct' };
  });
}

const BASE: Omit<WinContext, 'win'> = {
  tsumo: false,
  seatWind: 1,
  roundWind: 0,
  riichi: 0,
  ippatsu: false,
  rinshan: false,
  chankan: false,
  haitei: false,
  houtei: false,
  tenhou: false,
  chiihou: false,
  dora: [],
  ura: [],
};

interface Opt extends Partial<Omit<WinContext, 'win'>> {
  melds?: string[];
  /** 手里的牌里把某一张换成指定实物牌（放赤牌用） */
  swap?: [Tile, Tile];
}

/** hand = 手里的牌（含和的那张）；win = 和的牌种如 '8s'，取手里最后一张该种牌 */
function sc(hand: string, win: string, o: Opt = {}) {
  const { melds, swap, ...ctx } = o;
  const ts = T(hand);
  if (swap) ts[ts.indexOf(swap[0])] = swap[1];
  const wk = kinds(win)[0]!;
  let wt = -1;
  ts.forEach((t) => {
    if (kindOf(t) === wk) wt = t;
  });
  if (wt < 0) throw new Error(`和的牌 ${win} 不在手里`);
  return scoreWin(ts, M(...(melds ?? [])), { ...BASE, ...ctx, win: wt });
}
const must = (r: ReturnType<typeof sc>) => {
  if (!r) throw new Error('应该和得出，却没有役');
  return r;
};
const ids = (r: ReturnType<typeof sc>): YakuId[] => must(r).yaku.map((x) => x.id).sort();
const han = (r: ReturnType<typeof sc>, id: YakuId): number => must(r).yaku.find((x) => x.id === id)?.han ?? 0;

// 常用手牌（都不含赤牌、不含意外的役）
const H1 = '234m567p345s678s55p'; // 平和 + 断幺，赢 8s 是两面
const H2 = '234m234m567p678s55p'; // 再加一杯口，赢 4m 是两面

describe('牌形判断', () => {
  test('国士：十三种幺九加一对', () => {
    expect(isKokushi(counts('119m19p19s1234567z'))).toBe(true);
    expect(isKokushi(counts('19m19p19s1234567z'))).toBe(false); // 13 张
    expect(isKokushi(counts('119m19p19s123456z2z'))).toBe(false); // 缺 7z
    expect(isKokushi(counts('119m19p19s123456z1z'))).toBe(false); // 两张 1z，缺 7z
  });

  test('isAgari：一般型、七对、国士', () => {
    expect(isAgari(counts('234m567p345s678s55p'), 0)).toBe(true);
    expect(isAgari(counts('1133m5588p2244s77z'), 0)).toBe(true); // 七对
    expect(isAgari(counts('119m19p19s1234567z'), 0)).toBe(true); // 国士
    expect(isAgari(counts('234m567p345s678s56p'), 0)).toBe(false);
    expect(isAgari(counts('567p345s678s55p'), 1)).toBe(true); // 一组副露
    expect(isAgari(counts('567p345s678s55p'), 0)).toBe(false); // 张数对不上
  });

  test('四张一样不算七对（也不能当两对）', () => {
    // 1111m 2222p 3333s 44z：既不是七对（四张不算两对）也拆不成一般型
    expect(isAgari(counts('1111m2222p3333s44z'), 0)).toBe(false);
    expect(isAgari(counts('11m22m33m44m55m66m77m'), 0)).toBe(true);
  });

  test('waitsOf：十三面国士', () => {
    const w = waitsOf(counts('19m19p19s1234567z'), 0);
    expect(w).toEqual([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
  });

  test('waitsOf：国士一般听、七对单骑、九莲', () => {
    expect(waitsOf(counts('99m19p19s1234567z'), 0)).toEqual([0]); // 缺 1m
    expect(waitsOf(counts('1133m5588p2244s7z'), 0)).toEqual([33]); // 七对单骑 7z
    expect(waitsOf(counts('1112345678999m'), 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('waitsOf：不看牌还剩几张，手里已有 4 张的那种也照算；返回后计数不变', () => {
    // 1111m 里 111 + 单骑 1m：手里已经 4 张，第 5 张摸不到，但形状上算听；要不要滤掉由规则层决定
    const c = counts('1111m567p345s789s');
    const before = c.slice();
    expect(waitsOf(c, 0)).toEqual([0]);
    expect(c).toEqual(before);
  });

  test('waitsOf：副露后的听牌', () => {
    expect(waitsOf(counts('567p345s678s5p'), 1)).toEqual([13, 16]); // 5p 单骑，或 55p 对子 + 678p
  });

  test('ALL_KINDS 是 0..33', () => {
    expect(ALL_KINDS).toHaveLength(34);
    expect(ALL_KINDS[0]).toBe(0);
    expect(ALL_KINDS[33]).toBe(33);
  });
});

describe('宝牌指示牌', () => {
  test('数牌按门环绕：9 回到 1', () => {
    expect(doraOf(0)).toBe(1); // 1m → 2m
    expect(doraOf(8)).toBe(0); // 9m → 1m
    expect(doraOf(17)).toBe(9); // 9p → 1p
    expect(doraOf(26)).toBe(18); // 9s → 1s
    expect(doraOf(12)).toBe(13);
  });
  test('风牌东南西北东，三元白发中白', () => {
    expect(doraOf(27)).toBe(28);
    expect(doraOf(29)).toBe(30);
    expect(doraOf(30)).toBe(27); // 北 → 东
    expect(doraOf(31)).toBe(32);
    expect(doraOf(32)).toBe(33);
    expect(doraOf(33)).toBe(31); // 中 → 白
  });
});

describe('役名表', () => {
  test('每个役都有中文名', () => {
    for (const [id, name] of Object.entries(YAKU_NAME)) expect(name.length, id).toBeGreaterThan(0);
    expect(YAKU_NAME.riichi).toBe('立直');
    expect(YAKU_NAME.pinfu).toBe('平和');
  });
});

// ---------- 一番、二番的役 ----------

describe('时机类的役', () => {
  test('立直、一发、双立直', () => {
    expect(ids(sc(H1, '8s', { riichi: 1 }))).toEqual(['pinfu', 'riichi', 'tanyao']);
    const ip = sc(H1, '8s', { riichi: 1, ippatsu: true });
    expect(ids(ip)).toEqual(['ippatsu', 'pinfu', 'riichi', 'tanyao']);
    const dr = sc(H1, '8s', { riichi: 2 });
    expect(ids(dr)).toEqual(['double_riichi', 'pinfu', 'tanyao']);
    expect(han(dr, 'double_riichi')).toBe(2);
    expect(must(dr).han).toBe(4);
  });

  test('门前清自摸：门清自摸才有，荣和、副露都没有', () => {
    expect(ids(sc(H1, '8s', { tsumo: true }))).toEqual(['pinfu', 'tanyao', 'tsumo']);
    expect(ids(sc(H1, '8s'))).not.toContain('tsumo');
    // 副露（吃 234m）后自摸没有门清自摸，只剩断幺
    expect(ids(sc('567p345s678s55p', '8s', { melds: ['chi:234m'], tsumo: true }))).toEqual(['tanyao']);
    // 暗杠不破门清
    expect(ids(sc('567p345s678s55p', '8s', { melds: ['ankan:2m'], tsumo: true }))).toEqual(['tanyao', 'tsumo']);
  });

  test('岭上、抢杠、海底、河底各 1 番', () => {
    for (const [flag, id] of [
      ['rinshan', 'rinshan'],
      ['chankan', 'chankan'],
      ['haitei', 'haitei'],
      ['houtei', 'houtei'],
    ] as const) {
      const r = sc(H1, '8s', { [flag]: true });
      expect(ids(r)).toContain(id);
      expect(han(r, id)).toBe(1);
      expect(ids(sc(H1, '8s'))).not.toContain(id);
    }
  });

  test('只有宝牌没有役：返回 null', () => {
    const h = '123m456p789s234s55p';
    expect(sc(h, '3m')).toBeNull();
    expect(sc(h, '3m', { dora: [13] })).toBeNull();
    expect(sc(h, '3m', { riichi: 1, dora: [13] })).not.toBeNull();
  });
});

describe('平和、断幺九、一杯口', () => {
  test('平和：两面听、门清、雀头无役；荣和 30 符，自摸 20 符', () => {
    const ron = must(sc(H1, '8s'));
    expect(ids(sc(H1, '8s'))).toEqual(['pinfu', 'tanyao']);
    expect(ron.fu).toBe(30);
    expect(must(sc(H1, '8s', { tsumo: true })).fu).toBe(20);
  });

  test('平和反例：坎张、边张、役牌雀头、有刻子、副露', () => {
    expect(ids(sc(H1, '7s', { riichi: 1 }))).toEqual(['riichi', 'tanyao']); // 678s 赢 7s 是坎张
    expect(ids(sc('123m567p345s678s55p', '3m', { riichi: 1 }))).toEqual(['riichi']); // 边张
    expect(ids(sc('234m567p345s678s55z', '8s', { riichi: 1 }))).toEqual(['riichi']); // 白雀头
    expect(ids(sc('234m567p345s888s55p', '4m', { riichi: 1 }))).toEqual(['riichi', 'tanyao']); // 有刻子
    expect(ids(sc('567p345s678s55p', '8s', { melds: ['chi:234m'] }))).toEqual(['tanyao']); // 副露
    // 自风、场风雀头也不行
    expect(ids(sc('234m567p345s678s22z', '8s', { riichi: 1 }))).toEqual(['riichi']);
    expect(ids(sc('234m567p345s678s11z', '8s', { riichi: 1 }))).toEqual(['riichi']);
    // 西风不是役牌，可以平和
    expect(ids(sc('234m567p345s678s33z', '8s', { riichi: 1 }))).toEqual(['pinfu', 'riichi']);
  });

  test('断幺九：食断也算；有幺九或字牌不算', () => {
    expect(ids(sc(H1, '8s'))).toContain('tanyao');
    expect(ids(sc('567p345s678s55p', '8s', { melds: ['chi:234m'] }))).toEqual(['tanyao']);
    expect(ids(sc('234m567p345s789s55p', '9s', { riichi: 1 }))).not.toContain('tanyao');
    expect(ids(sc('234m567p345s678s55z', '8s', { riichi: 1 }))).not.toContain('tanyao');
  });

  test('一杯口：门清才有，副露后同样的两个顺子不算', () => {
    const r = sc(H2, '4m');
    expect(ids(r)).toEqual(['iipeikou', 'pinfu', 'tanyao']);
    expect(han(r, 'iipeikou')).toBe(1);
    expect(ids(sc('234m567p678s55p', '4m', { melds: ['chi:234m'] }))).toEqual(['tanyao']);
  });

  test('二杯口 3 番，不与一杯口同计', () => {
    const r = sc('223344m556677p88s', '4m', { riichi: 1 });
    expect(ids(r)).toEqual(['pinfu', 'riichi', 'ryanpeikou', 'tanyao']);
    expect(han(r, 'ryanpeikou')).toBe(3);
    expect(ids(r)).not.toContain('iipeikou');
  });
});

describe('役牌', () => {
  test('白发中各 1 番（暗刻、明刻、杠都算）', () => {
    expect(ids(sc('234m567p345s555z22p', '4m'))).toEqual(['haku']);
    expect(ids(sc('234m567p345s666z22p', '4m'))).toEqual(['hatsu']);
    expect(ids(sc('234m567p345s777z22p', '4m'))).toEqual(['chun']);
    expect(ids(sc('567p345s22p', '5p', { melds: ['chi:234m', 'pon:6z'] }))).toEqual(['hatsu']);
    expect(ids(sc('567p345s22p', '5p', { melds: ['chi:234m', 'ankan:7z'] }))).toEqual(['chun']);
    expect(ids(sc('567p345s22p', '5p', { melds: ['chi:234m', 'kan:5z'] }))).toEqual(['haku']);
  });

  test('场风、自风；连风牌算两个役；别的风牌没有', () => {
    // 场风东、自风南
    expect(ids(sc('234m567p345s111z22p', '4m'))).toEqual(['yakuhai_round']);
    expect(ids(sc('234m567p345s222z22p', '4m'))).toEqual(['yakuhai_seat']);
    expect(sc('234m567p345s333z22p', '4m')).toBeNull(); // 西不是役牌
    // 自风也是东：连风
    const r = sc('234m567p345s111z22p', '4m', { seatWind: 0 });
    expect(ids(r)).toEqual(['yakuhai_round', 'yakuhai_seat']);
    expect(must(r).han).toBe(2);
    // 场风南、自风北
    expect(ids(sc('234m567p345s222z22p', '4m', { roundWind: 1, seatWind: 3 }))).toEqual(['yakuhai_round']);
    expect(ids(sc('234m567p345s444z22p', '4m', { roundWind: 1, seatWind: 3 }))).toEqual(['yakuhai_seat']);
  });
});

describe('七对子', () => {
  test('七对 2 番 25 符；荣和 1600，自摸 800/1600', () => {
    const h = '1133m5588p2244s77z';
    const r = must(sc(h, '7z'));
    expect(ids(sc(h, '7z'))).toEqual(['chiitoi']);
    expect(r.fu).toBe(25);
    expect(r.han).toBe(2);
    expect(r.base).toBe(400);
    expect(payments(r.base, false, false)).toEqual({ ron: 1600 });
    const t = must(sc(h, '7z', { tsumo: true }));
    expect(ids(sc(h, '7z', { tsumo: true }))).toEqual(['chiitoi', 'tsumo']);
    expect(payments(t.base, false, true)).toEqual({ dealer: 1600, other: 800 });
  });

  test('七对可以加断幺、混一色、混老头，不会拆成一般型', () => {
    expect(ids(sc('2233m4455p6677s88p', '8p', { riichi: 1 }))).toEqual(['chiitoi', 'riichi', 'tanyao']);
    expect(ids(sc('1122m3399m4488m77z', '7z'))).toContain('honitsu');
    expect(ids(sc('1199m1199p1199s77z', '7z'))).toEqual(expect.arrayContaining(['chiitoi', 'honroutou']));
  });

  test('二杯口形同时是七对：取二杯口（高点法）', () => {
    const r = must(sc('223344m556677p88s', '4m', { riichi: 1 }));
    // 二杯口 + 平和 + 断幺 + 立直 = 6 番 30 符 跳满；七对只有 4 番 25 符
    expect(r.han).toBe(6);
    expect(r.fu).toBe(30);
    expect(r.limit).toBe('haneman');
  });
});

describe('三色、一气、带幺九', () => {
  test('三色同顺：门清 2，副露 1', () => {
    const h = '234m234p234s567p55m';
    expect(ids(sc(h, '4m'))).toEqual(['pinfu', 'sanshoku', 'tanyao']);
    expect(han(sc(h, '4m'), 'sanshoku')).toBe(2);
    const open = sc('234m234p567p55m', '5p', { melds: ['chi:234s'] });
    expect(ids(open)).toEqual(['sanshoku', 'tanyao']);
    expect(han(open, 'sanshoku')).toBe(1);
    expect(ids(sc('234m234p345s567p55m', '4m', { riichi: 1 }))).not.toContain('sanshoku');
  });

  test('一气通贯：门清 2，副露 1', () => {
    const h = '123456789m234p55p';
    expect(ids(sc(h, '4p'))).toEqual(['ittsu', 'pinfu']);
    expect(han(sc(h, '4p'), 'ittsu')).toBe(2);
    const open = sc('456m789m234p55p', '4p', { melds: ['chi:123m'] });
    expect(ids(open)).toEqual(['ittsu']);
    expect(han(open, 'ittsu')).toBe(1);
    expect(ids(sc('123456789s234p55p', '4p'))).toContain('ittsu'); // 别的门也行
    expect(ids(sc('123456m789p234s55p', '4s', { riichi: 1 }))).not.toContain('ittsu');
  });

  test('混全带幺九：门清 2，副露 1；有字牌有顺子', () => {
    const h = '123m789p123s777z11m';
    expect(ids(sc(h, '9p'))).toEqual(['chanta', 'chun']);
    expect(han(sc(h, '9p'), 'chanta')).toBe(2);
    const open = sc('789p123s777z11m', '9p', { melds: ['chi:123m'] });
    expect(han(open, 'chanta')).toBe(1);
    expect(ids(open)).toEqual(['chanta', 'chun']);
  });

  test('纯全带幺九：门清 3，副露 2；不与混全同计', () => {
    const h = '123m789p123s789s11p';
    const r = sc(h, '9s');
    expect(ids(r)).toEqual(['junchan', 'pinfu']);
    expect(han(r, 'junchan')).toBe(3);
    const open = sc('789p123s789s11p', '9s', { melds: ['chi:123m'] });
    expect(ids(open)).toEqual(['junchan']);
    expect(han(open, 'junchan')).toBe(2);
  });

  test('带幺九反例：有一组没有幺九', () => {
    expect(ids(sc('123m789p234s789s11p', '9s', { riichi: 1 }))).not.toContain('junchan');
    expect(ids(sc('123m789p234s999s11z', '9s', { riichi: 1 }))).not.toContain('chanta');
  });
});

describe('刻子系的役', () => {
  test('对对和 2 番（门清副露都有）', () => {
    const open = sc('777z11z', '1z', { melds: ['pon:1m', 'pon:9p', 'pon:1s'] });
    expect(ids(open)).toEqual(expect.arrayContaining(['toitoi']));
    expect(han(open, 'toitoi')).toBe(2);
    // 荣和完成的刻子是明刻：222m555p888s999s 加 33z，荣 9s → 对对 + 三暗刻
    expect(ids(sc('222m555p888s999s33z', '9s'))).toEqual(['sanankou', 'toitoi']);
    expect(ids(sc('222m555p888s234s33z', '4s'))).not.toContain('toitoi');
  });

  test('三暗刻 2 番：荣和完成的刻子不算暗刻', () => {
    const h = '222m555p888s234s33z';
    const r = sc(h, '4s');
    expect(ids(r)).toEqual(['sanankou']);
    expect(han(r, 'sanankou')).toBe(2);
    expect(sc(h, '2m')).toBeNull(); // 荣 2m 完成 222m：只剩两个暗刻，没有役
    expect(ids(sc(h, '2m', { tsumo: true }))).toEqual(['sanankou', 'tsumo']);
    // 副露的碰不是暗刻
    expect(sc('555p888s234s33z', '4s', { melds: ['pon:2m'] })).toBeNull();
  });

  test('三色同刻 2 番', () => {
    const h = '222m222p222s567p11z';
    expect(ids(sc(h, '7p'))).toEqual(['sanankou', 'sanshoku_pon']);
    const open = sc('567p11z', '7p', { melds: ['pon:2m', 'pon:2p', 'pon:2s'] });
    expect(ids(open)).toEqual(['sanshoku_pon']);
    expect(han(open, 'sanshoku_pon')).toBe(2);
    expect(sc('567p11z', '7p', { melds: ['pon:2m', 'pon:2p', 'pon:3s'] })).toBeNull();
  });

  test('三杠子 2 番', () => {
    const r = sc('567p11z', '7p', { melds: ['ankan:2m', 'ankan:5p', 'kan:8s'] });
    expect(ids(r)).toEqual(['sankantsu']);
    expect(han(r, 'sankantsu')).toBe(2);
    expect(sc('567p11z', '7p', { melds: ['ankan:2m', 'ankan:5p', 'pon:8s'] })).toBeNull();
  });

  test('小三元 2 番（加两组三元牌的役牌）', () => {
    const r = sc('555z666z77z234m567p', '7p');
    expect(ids(r)).toEqual(['haku', 'hatsu', 'shousangen']);
    expect(han(r, 'shousangen')).toBe(2);
    expect(must(r).han).toBe(4);
    expect(ids(sc('555z666z234m567p11p', '7p'))).not.toContain('shousangen'); // 只有两组三元刻、没有三元雀头
  });

  test('混老头 2 番，不与混全/纯全同计', () => {
    const r = sc('777z11z', '1z', { melds: ['pon:1m', 'pon:9p', 'pon:1s'] });
    expect(ids(r)).toEqual(['chun', 'honroutou', 'toitoi']);
    expect(han(r, 'honroutou')).toBe(2);
    expect(ids(r)).not.toContain('chanta');
    expect(ids(r)).not.toContain('junchan');
    expect(must(r).han).toBe(5);
  });
});

describe('染手', () => {
  test('混一色：门清 3，副露 2', () => {
    const r = sc('234m567m999m123m33z', '2m');
    expect(ids(r)).toEqual(['honitsu']);
    expect(han(r, 'honitsu')).toBe(3);
    const open = sc('567m999m123m33z', '1m', { melds: ['chi:234m'] });
    expect(ids(open)).toEqual(['honitsu']);
    expect(han(open, 'honitsu')).toBe(2);
    expect(ids(sc('234m567p999m123m33z', '2m', { riichi: 1 }))).not.toContain('honitsu');
  });

  test('清一色：门清 6，副露 5；不与混一色同计', () => {
    const r = sc('234m567m678m123m44m', '1m');
    expect(ids(r)).toEqual(['chinitsu', 'pinfu']);
    expect(han(r, 'chinitsu')).toBe(6);
    expect(ids(r)).not.toContain('honitsu');
    const open = sc('567m999m123m44m', '1m', { melds: ['chi:234m'] });
    expect(ids(open)).toEqual(['chinitsu']);
    expect(han(open, 'chinitsu')).toBe(5);
  });
});

// ---------- 役满 ----------

describe('役满', () => {
  const one = (r: ReturnType<typeof sc>, id: YakuId, n = 1) => {
    const x = must(r);
    expect(x.yaku.map((y) => y.id)).toContain(id);
    expect(x.yakuman).toBe(n);
    expect(x.limit).toBe('yakuman');
    expect(x.kazoe).toBe(false);
    expect(x.han).toBe(0);
    expect(x.base).toBe(8000 * n);
    return x;
  };

  test('国士无双（含十三面），一倍', () => {
    const r = sc('119m19p19s1234567z', '1m');
    expect(ids(r)).toEqual(['kokushi']);
    one(r, 'kokushi');
    one(sc('119m19p19s1234567z', '7z', { tsumo: true }), 'kokushi');
  });

  test('四暗刻：自摸、荣和单骑算；荣和完成刻子（双碰）不算', () => {
    const h = '222m555p888s999s33z';
    expect(ids(sc(h, '9s', { tsumo: true }))).toEqual(['suuankou']);
    expect(ids(sc(h, '3z'))).toEqual(['suuankou']); // 单骑荣和
    expect(ids(sc(h, '9s'))).toEqual(['sanankou', 'toitoi']); // 双碰荣和
    one(sc(h, '3z'), 'suuankou');
    // 副露的碰、门清破了都不行
    expect(ids(sc('555p888s999s33z', '3z', { melds: ['pon:2m'] }))).toEqual(['sanankou', 'toitoi']);
  });

  test('大三元', () => {
    one(sc('555z666z777z234m11p', '4m'), 'daisangen');
    expect(ids(sc('555z666z77z234m567p', '7p'))).not.toContain('daisangen');
  });

  test('小四喜、大四喜（单骑荣和同时四暗刻，两倍）', () => {
    one(sc('111z222z333z44z234m', '4m'), 'shousuushii');
    expect(ids(sc('111z222z333z44z234m', '4m'))).toEqual(['shousuushii']);
    const d = sc('111z222z333z444z55m', '1z');
    expect(ids(d)).toEqual(['daisuushii']); // 荣和双碰：只有大四喜
    one(d, 'daisuushii');
    const dd = sc('111z222z333z444z55m', '5m');
    expect(ids(dd)).toEqual(['daisuushii', 'suuankou']);
    one(dd, 'daisuushii', 2);
  });

  test('字一色（含七对形）', () => {
    one(sc('111z222z555z666z77z', '1z'), 'tsuuiisou');
    one(sc('11223344556677z', '7z'), 'tsuuiisou');
    expect(ids(sc('11223344556677z', '7z'))).toEqual(['tsuuiisou']);
  });

  test('绿一色：有发没发都算；混进别的牌不算', () => {
    one(sc('234s234s666s888s66z', '4s'), 'ryuuiisou');
    one(sc('234s234s666s888s44s', '4s'), 'ryuuiisou');
    expect(ids(sc('234s345s666s888s44s', '4s'))).not.toContain('ryuuiisou'); // 有 5s
  });

  test('清老头', () => {
    one(sc('999p11s', '1s', { melds: ['pon:1m', 'pon:9m', 'pon:1p'] }), 'chinroutou');
    expect(ids(sc('999p11s', '1s', { melds: ['pon:1m', 'pon:9m', 'pon:1p'] }))).toEqual(['chinroutou']);
  });

  test('九莲宝灯', () => {
    one(sc('11123455678999m', '5m'), 'chuuren');
    one(sc('11123456789995m'.replace('5m', '9m'), '9m'), 'chuuren'); // 纯正（9 面）
    expect(ids(sc('11123455678999m', '5m'))).toEqual(['chuuren']);
    // 副露破了门清就没有
    expect(ids(sc('234m567m123m44m', '1m', { melds: ['pon:9m'] }))).not.toContain('chuuren');
  });

  test('四杠子', () => {
    one(sc('11z', '1z', { melds: ['kan:2m', 'ankan:5p', 'kan:8s', 'ankan:3z'] }), 'suukantsu');
  });

  test('天和、地和', () => {
    one(sc(H1, '8s', { tsumo: true, tenhou: true }), 'tenhou');
    one(sc(H1, '8s', { tsumo: true, chiihou: true }), 'chiihou');
    // 与别的役满相加
    const r = one(sc('555z666z777z111z22z', '5z', { tenhou: true, tsumo: true }), 'tenhou', 4);
    expect(r.yaku.map((y) => y.id).sort()).toEqual(['daisangen', 'suuankou', 'tenhou', 'tsuuiisou']);
  });

  test('复合役满相加：大三元 + 字一色 = 两倍 = 64000', () => {
    const r = one(sc('555z666z777z111z22z', '5z'), 'daisangen', 2);
    expect(r.yaku.map((y) => y.id).sort()).toEqual(['daisangen', 'tsuuiisou']);
    expect(payments(r.base, false, false)).toEqual({ ron: 64000 });
    expect(payments(r.base, true, false)).toEqual({ ron: 96000 });
  });

  test('役满只列役满，不带别的役', () => {
    const r = sc('119m19p19s1234567z', '1m', { riichi: 1, tsumo: true });
    expect(ids(r)).toEqual(['kokushi']);
  });
});

describe('累计役满与跳满阶梯（H2 = 6 番）', () => {
  // H2 赢 4m 自摸立直一发：立直 一发 自摸 平和 断幺 一杯口 = 6 番；5p 有 3 张，6p 有 1 张
  const o: Opt = { tsumo: true, riichi: 1, ippatsu: true };
  const at = (dora: number[]) => must(sc(H2, '4m', { ...o, dora }));

  test.each([
    [[], 6, 'haneman', 3000],
    [[14], 7, 'haneman', 3000],
    [[13], 9, 'baiman', 4000],
    [[13, 14], 10, 'baiman', 4000],
    [[13, 14, 14], 11, 'sanbaiman', 6000],
    [[13, 13], 12, 'sanbaiman', 6000],
  ] as const)('宝牌 %j → %i 番 %s', (dora, h, limit, base) => {
    const r = at([...dora]);
    expect(r.han).toBe(h);
    expect(r.limit).toBe(limit);
    expect(r.base).toBe(base);
    expect(r.yakuman).toBe(0);
    expect(r.kazoe).toBe(false);
  });

  test('13 番起算累计役满，役表保留原役', () => {
    const r = at([13, 13, 14]);
    expect(r.han).toBe(13);
    expect(r.kazoe).toBe(true);
    expect(r.yakuman).toBe(1);
    expect(r.limit).toBe('yakuman');
    expect(r.base).toBe(8000);
    expect(r.yaku.map((y) => y.id)).toContain('riichi');
    expect(at([13, 13, 13]).kazoe).toBe(true);
  });

  test('真役满不标累计', () => {
    const r = must(sc('555z666z777z234m11p', '4m', { dora: [0] }));
    expect(r.kazoe).toBe(false);
  });
});

// ---------- 宝牌 ----------

describe('宝牌、赤宝牌、里宝牌', () => {
  test('手牌里每张宝牌种 +1，指示牌重复就重复算', () => {
    const r = must(sc(H1, '8s', { riichi: 1, dora: [13] })); // 5p 手里 2 张... H1 有 55p 和 567p：3 张
    expect(r.dora).toBe(3);
    expect(r.han).toBe(3 + 3);
    expect(must(sc(H1, '8s', { riichi: 1, dora: [13, 13] })).dora).toBe(6);
    expect(must(sc(H1, '8s', { riichi: 1, dora: [0] })).dora).toBe(0);
  });

  test('杠子四张都算；副露里的牌也算', () => {
    const r = must(sc('567p345s678s55p', '8s', { melds: ['ankan:2m'], riichi: 1, dora: [1] }));
    expect(r.dora).toBe(4);
    const p = must(sc('567p345s678s55p', '8s', { melds: ['pon:2m'], dora: [1], tsumo: false }));
    expect(p.dora).toBe(3);
  });

  test('赤宝牌：手牌、副露里的红 5 各 +1；不是宝牌种也算', () => {
    const red = RED[1]!; // 5p 第 0 张
    const r = must(sc(H1, '8s', { riichi: 1, swap: [tileOf(13, 1), red] }));
    expect(r.aka).toBe(1);
    expect(r.dora).toBe(0);
    expect(r.han).toBe(4);
    const m = must(scoreWin(T('234m345s678s55p'), [{ kind: 'pon', tiles: [RED[0]!, tileOf(4, 1), tileOf(4, 2)], from: 1 }], { ...BASE, win: T('8s')[0]!, riichi: 0 }));
    expect(m.aka).toBe(1);
    expect(RED).toEqual([16, 52, 88]);
  });

  test('里宝牌同宝牌一样数', () => {
    const r = must(sc(H1, '8s', { riichi: 1, ura: [13] }));
    expect(r.ura).toBe(3);
    expect(r.dora).toBe(0);
    expect(r.han).toBe(3 + 3);
  });

  test('宝牌、赤、里宝都不算役，只有它们时返回 null', () => {
    const red = RED[1]!;
    expect(sc('123m456p789s234s55p', '3m', { swap: [tileOf(13, 1), red], dora: [13], ura: [13] })).toBeNull();
  });
});

// ---------- 符 ----------

describe('符', () => {
  const fu = (h: string, w: string, o: Opt = {}) => must(sc(h, w, { riichi: 1, ...o })).fu;

  test('门清荣和 30（平和形），自摸平和 20，门清自摸非平和 +2', () => {
    expect(fu('234m567p345s789s33z', '4m')).toBe(30);
    expect(fu('234m567p345s789s33z', '4m', { riichi: 0, tsumo: true })).toBe(20);
    // 坎张自摸：20 + 2 + 2 = 24 → 30
    expect(fu('234m567p345s789s33z', '3m', { tsumo: true })).toBe(30);
  });

  test('听牌形：坎张、边张、单骑各 +2；两面、双碰不加', () => {
    expect(fu('234m567p345s789s33z', '3m')).toBe(40); // 32 → 40
    expect(fu('123m567p345s789s33z', '3m')).toBe(40);
    expect(fu('789m567p345s234s33z', '7m')).toBe(40); // 789 赢 7 是边张
    expect(fu('234m567p345s789s33z', '3z')).toBe(40); // 单骑
    expect(fu('234m567p345s789s33z', '4m')).toBe(30); // 两面
  });

  test('雀头：三元 +2，场风 +2，自风 +2，连风 +4', () => {
    expect(fu('234m567p345s789s55z', '4m')).toBe(40); // 32 → 40
    // 二暗刻（各 4）把基数垫到 30，好区分进位：20+10+8 = 38
    const pungs = '222m555p345s789s';
    expect(fu(pungs + '11z', '3s')).toBe(40); // 38 + 2(场风) = 40
    expect(fu(pungs + '22z', '3s')).toBe(40); // 自风
    expect(fu(pungs + '33z', '3s')).toBe(40); // 西：38 → 40
    expect(fu(pungs + '11z', '3s', { seatWind: 0 })).toBe(50); // 连风 +4：42 → 50
    expect(fu(pungs + '77z', '3s')).toBe(40);
  });

  test('刻子：明中张 2、明幺九 4、暗中张 4、暗幺九 8', () => {
    // 荣和完成的刻子按明刻：111m 双碰荣 1m → 20+10+4(明幺九)+4(暗 555p) = 38 → 40；若误当暗刻是 42 → 50
    expect(fu('111m555p234s789s33z', '1m')).toBe(40);
    // 自摸则是暗刻：20+2+8+4 = 34 → 40
    expect(fu('111m555p234s789s33z', '1m', { riichi: 0, tsumo: true, haitei: true })).toBe(40);
    // 111m 暗、555p 暗、999s 暗，赢 4s（两面）：20+10+8+4+8 = 50
    expect(fu('111m555p999s234s33z', '4s')).toBe(50);
    // 三个暗刻里一个靠荣和完成，按明刻：999s 荣 → 20+10+8+4+4 = 46 → 50
    expect(fu('111m555p999s234s33z', '9s')).toBe(50);
    // 荣和的中张明刻：555p 荣 → 20+10+8(111m)+2 = 40 → 40
    expect(fu('111m555p234s789s33z', '5p')).toBe(40);
  });

  test('杠：明杠 中张 8 / 幺九 16，暗杠 16 / 32', () => {
    // 副露是暗杠 2m（16），门清荣和：20+10+16+4(555p) = 50
    expect(fu('555p345s789s33z', '3s', { melds: ['ankan:2m'] })).toBe(50);
    // 暗杠幺九 1m：32 → 20+10+32+4 = 66 → 70
    expect(fu('555p345s789s33z', '3s', { melds: ['ankan:1m'] })).toBe(70);
    // 副露的明杠 白（幺九 16）：20+16+4 = 40（荣和，副露没有 +10）
    expect(fu('555p345s789s33z', '3s', { melds: ['kan:5z'], riichi: 0 })).toBe(40);
    // 明杠中张 2m（8）+ 碰发（明幺九 4）：20+8+4 = 32 → 40；若杠只按 4 符算则是 26 → 30
    expect(fu('345s789s55p', '3s', { melds: ['kan:2m', 'pon:6z'], riichi: 0 })).toBe(40);
  });

  test('副露：明刻符；荣和碰 白 4 符', () => {
    // 白碰 4 + 暗 555p（赢 3s 两面）4 = 20+4+4 = 28 → 30
    expect(fu('555p345s789s33z', '3s', { melds: ['pon:5z'], riichi: 0 })).toBe(30);
  });

  test('副露的平和形荣和算 30，自摸 22 进位也是 30', () => {
    const h = '567p345s678s55p';
    expect(must(sc(h, '8s', { melds: ['chi:234m'] })).fu).toBe(30);
    expect(must(sc(h, '8s', { melds: ['chi:234m'], tsumo: true })).fu).toBe(30);
    expect(basePoints(1, 30).base).toBe(240);
  });

  test('七对 25 符不进位', () => {
    expect(fu('1133m5588p2244s77z', '7z')).toBe(25);
    expect(fu('1133m5588p2244s77z', '7z', { tsumo: true })).toBe(25);
  });

  test('进位到 10：32 → 40，34 → 40，42 → 50', () => {
    expect(fu('234m567p345s789s33z', '3m')).toBe(40);
    expect(fu('222m555p345s789s11z', '3s', { seatWind: 0 })).toBe(50);
  });

  test('听牌形有歧义时取符高的：22234m 的 2m 是单骑还是两面', () => {
    // 自摸，非平和（有 555p 888s 暗刻）。两面解 20+2+4+4 = 30；单骑解 32 → 40
    const r = must(sc('22234m555p888s345s', '2m', { tsumo: true }));
    expect(r.fu).toBe(40);
    expect(r.base).toBe(640);
  });
});

describe('高点法：多种拆法取最高', () => {
  test('111222333m 当三个刻子（三暗刻）还是一杯口 + 顺子，取高', () => {
    const r = must(sc('111222333m567p55p', '3m', { tsumo: true }));
    // 刻子解：门清自摸 + 三暗刻 = 3 番，40 符 → 基本点 1280；顺子解：门清自摸 + 一杯口 = 2 番 30 符 → 480
    expect(r.yaku.map((y) => y.id).sort()).toEqual(['sanankou', 'tsumo']);
    expect(r.han).toBe(3);
    expect(r.base).toBe(1280);
  });

  test('同一组牌形，荣和与自摸可以取不同的解', () => {
    // 荣和：3m 完成 333m 算明刻，只有两个暗刻 → 取顺子解
    const r = must(sc('111222333m567p55p', '3m'));
    expect(r.yaku.map((y) => y.id)).toEqual(['iipeikou']);
  });

  test('二杯口 vs 七对', () => {
    const r = must(sc('223344m556677p88s', '4m'));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(['pinfu', 'ryanpeikou', 'tanyao']);
    expect(r.han).toBe(5);
  });

  test('含 4 张一样的七对形不会误判成七对', () => {
    // 2222m 3333m 4444m 55p：四张不算两对，不是七对；是一般型四个 234m
    const r = sc('2222m3333m4444m55p', '2m', { riichi: 1 });
    expect(ids(r)).not.toContain('chiitoi');
    expect(ids(r)).toContain('ryanpeikou');
  });
});

// ---------- 点数 ----------

describe('点数表（标准表写死）', () => {
  // [符, 番, 子荣, 庄荣, 子自摸庄付, 子自摸子付, 庄自摸每家]
  const TABLE: [number, number, number, number, number, number, number][] = [
    [20, 2, 0, 0, 700, 400, 700],
    [20, 3, 0, 0, 1300, 700, 1300],
    [20, 4, 0, 0, 2600, 1300, 2600],
    [25, 2, 1600, 2400, 0, 0, 0],
    [25, 3, 3200, 4800, 1600, 800, 1600],
    [25, 4, 6400, 9600, 3200, 1600, 3200],
    [30, 1, 1000, 1500, 500, 300, 500],
    [30, 2, 2000, 2900, 1000, 500, 1000],
    [30, 3, 3900, 5800, 2000, 1000, 2000],
    [30, 4, 7700, 11600, 3900, 2000, 3900],
    [40, 1, 1300, 2000, 700, 400, 700],
    [40, 2, 2600, 3900, 1300, 700, 1300],
    [40, 3, 5200, 7700, 2600, 1300, 2600],
    [40, 4, 8000, 12000, 4000, 2000, 4000],
    [50, 1, 1600, 2400, 800, 400, 800],
    [50, 2, 3200, 4800, 1600, 800, 1600],
    [50, 3, 6400, 9600, 3200, 1600, 3200],
    [60, 1, 2000, 2900, 1000, 500, 1000],
    [60, 2, 3900, 5800, 2000, 1000, 2000],
    [60, 3, 7700, 11600, 3900, 2000, 3900],
    [70, 1, 2300, 3400, 1200, 600, 1200],
    [70, 2, 4500, 6800, 2300, 1200, 2300],
    [70, 3, 8000, 12000, 4000, 2000, 4000],
    [80, 1, 2600, 3900, 1300, 700, 1300],
    [80, 2, 5200, 7700, 2600, 1300, 2600],
    [90, 1, 2900, 4400, 1500, 800, 1500],
    [90, 2, 5800, 8700, 2900, 1500, 2900],
    [100, 1, 3200, 4800, 1600, 800, 1600],
    [100, 2, 6400, 9600, 3200, 1600, 3200],
    [110, 1, 3600, 5300, 1800, 900, 1800],
    [110, 2, 7100, 10600, 3600, 1800, 3600],
  ];

  test.each(TABLE)('%i 符 %i 番', (fu, h, ron, dRon, tsD, tsO, dTs) => {
    const { base } = basePoints(h, fu);
    if (ron) {
      expect(payments(base, false, false)).toEqual({ ron });
      expect(payments(base, true, false)).toEqual({ ron: dRon });
    }
    if (tsD) {
      expect(payments(base, false, true)).toEqual({ dealer: tsD, other: tsO });
      expect(payments(base, true, true)).toEqual({ dealer: dTs, other: dTs });
    }
  });

  test('满贯以上：不切上满贯（4 番 30 符 7700），5 番起封顶', () => {
    expect(basePoints(4, 30)).toEqual({ base: 1920, limit: 'none' });
    expect(basePoints(4, 40)).toEqual({ base: 2000, limit: 'mangan' });
    expect(basePoints(3, 70)).toEqual({ base: 2000, limit: 'mangan' });
    expect(basePoints(5, 20)).toEqual({ base: 2000, limit: 'mangan' });
    expect(basePoints(6, 30).limit).toBe('haneman');
    expect(basePoints(8, 30).limit).toBe('baiman');
    expect(basePoints(11, 30).limit).toBe('sanbaiman');
    expect(basePoints(12, 30).base).toBe(6000);
  });

  test.each([
    ['mangan', 2000, 8000, 12000, 4000, 2000],
    ['haneman', 3000, 12000, 18000, 6000, 3000],
    ['baiman', 4000, 16000, 24000, 8000, 4000],
    ['sanbaiman', 6000, 24000, 36000, 12000, 6000],
    ['yakuman', 8000, 32000, 48000, 16000, 8000],
  ])('%s 档', (_n, base, ron, dRon, tsD, tsO) => {
    expect(payments(base, false, false)).toEqual({ ron });
    expect(payments(base, true, false)).toEqual({ ron: dRon });
    expect(payments(base, false, true)).toEqual({ dealer: tsD, other: tsO });
    expect(payments(base, true, true)).toEqual({ dealer: tsD, other: tsD });
  });

  test('scoreWin 的基本点和点数表对得上', () => {
    // 副露断幺 30 符 1 番：荣 1000
    const r = must(sc('567p345s678s55p', '8s', { melds: ['chi:234m'] }));
    expect(r.limit).toBe('none');
    expect(payments(r.base, false, false)).toEqual({ ron: 1000 });
    expect(payments(r.base, false, true)).toEqual({ dealer: 500, other: 300 });
    // 门清平和断幺自摸（20 符 3 番）：700/1300 的 一半… 自摸 + 平和 + 断幺 = 3 番 20 符
    const t = must(sc(H1, '8s', { tsumo: true }));
    expect([t.han, t.fu]).toEqual([3, 20]);
    expect(payments(t.base, false, true)).toEqual({ dealer: 1300, other: 700 });
    // 立直一发自摸平和断幺 5 番 → 满贯
    const m = must(sc(H1, '8s', { tsumo: true, riichi: 1, ippatsu: true }));
    expect(m.limit).toBe('mangan');
    expect(m.base).toBe(2000);
  });
});

// ---------- 包牌 ----------

describe('包牌', () => {
  test('鸣出第 3 组三元牌的人负责（大三元）', () => {
    const ms = M('pon@1:5z', 'pon@2:6z', 'pon@3:7z');
    expect(liability(ms)).toEqual({ seat: 3, yaku: 'daisangen' });
    // 杠也算（大明杠）
    expect(liability(M('pon@1:5z', 'pon@2:6z', 'kan@0:7z'))).toEqual({ seat: 0, yaku: 'daisangen' });
  });

  test('暗杠不算鸣出，但前两组可以是暗杠', () => {
    expect(liability(M('pon@1:5z', 'pon@2:6z', 'ankan:7z'))).toBeNull();
    expect(liability(M('ankan:5z', 'pon@1:6z', 'pon@2:7z'))).toEqual({ seat: 2, yaku: 'daisangen' });
  });

  test('只有两组、或第 3 组不是三元：没有包牌；吃牌不计', () => {
    expect(liability(M('pon@1:5z', 'pon@2:6z'))).toBeNull();
    expect(liability(M('pon@1:5z', 'pon@2:6z', 'pon@3:1m'))).toBeNull();
    expect(liability(M('pon@1:5z', 'chi:234m', 'pon@2:6z', 'pon@3:7z'))).toEqual({ seat: 3, yaku: 'daisangen' });
    expect(liability([])).toBeNull();
  });

  test('鸣出第 4 组风牌的人负责（大四喜）', () => {
    expect(liability(M('pon@1:1z', 'pon@2:2z', 'pon@3:3z', 'pon@2:4z'))).toEqual({ seat: 2, yaku: 'daisuushii' });
    expect(liability(M('pon@1:1z', 'pon@2:2z', 'pon@3:3z'))).toBeNull();
    expect(liability(M('pon@1:1z', 'pon@2:2z', 'pon@3:3z', 'ankan:4z'))).toBeNull();
  });
});
