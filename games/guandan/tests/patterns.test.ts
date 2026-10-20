import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  beats,
  cardValue,
  chooseInterpretation,
  enumeratePlays,
  fullDeck,
  interpret,
  playsBeating,
  resolveOptions,
  rngFor,
  type Play,
} from '../src/variants/guandan/core/index.ts';
import { C, shape } from './helpers.ts';

const O = DEFAULT_OPTIONS;
/** 识别出的全部解释（形如 "straight:7"）。级数默认打 2。 */
const kinds = (cards: string, level = 2, opts = O) => interpret(C(cards), level, opts).map(shape).sort();
const one = (cards: string, level = 2): Play => {
  const list = interpret(C(cards), level, O);
  if (list.length !== 1) throw new Error(`${cards} 有 ${list.length} 种解释：${list.map(shape).join(',')}`);
  return list[0]!;
};

describe('牌序', () => {
  it('大王 > 小王 > 级牌 > A > K > … > 2（打 7 时）', () => {
    const order = C('S3 S6 S8 SK SA S7 SJ BJ').map((c) => cardValue(c, 7));
    expect(order).toEqual([3, 6, 8, 13, 14, 15, 16, 17]);
  });
  it('级牌单张压 A，打 2 时 2 压 A', () => {
    expect(beats(one('D2'), one('SA'))).toBe(true);
    expect(beats(one('SA'), one('SK'))).toBe(true);
    expect(beats(one('BJ'), one('SJ'))).toBe(true);
    expect(beats(one('SJ'), one('H2'))).toBe(true);
  });
});

describe('基本牌型', () => {
  it('单张、对子、三同张', () => {
    expect(kinds('S5')).toEqual(['single:5']);
    expect(kinds('S5 D5')).toEqual(['pair:5']);
    expect(kinds('S5 D5 C5')).toEqual(['triple:5']);
    expect(kinds('S5 D6')).toEqual([]);
  });
  it('王：两张小王或两张大王是对子，大小王不成对，三张王不成牌', () => {
    expect(kinds('SJ SJ')).toEqual(['pair:16']);
    expect(kinds('BJ BJ')).toEqual(['pair:17']);
    expect(kinds('SJ BJ')).toEqual([]);
    expect(kinds('SJ SJ BJ')).toEqual([]);
  });
  it('三带二：按三张比大小；默认可以带王对（可配置）', () => {
    expect(kinds('S5 D5 C5 S9 D9')).toEqual(['fullHouse:5:9']);
    expect(beats(one('S6 D6 C6 S3 D3'), one('S5 D5 C5 SA DA'))).toBe(true);
    expect(kinds('S5 D5 C5 SJ SJ')).toEqual(['fullHouse:5:16']);
    expect(kinds('S5 D5 C5 SJ SJ', 2, resolveOptions({ fullHouseJokerPair: false }))).toEqual([]);
    expect(kinds('S5 D5 C5 SJ BJ')).toEqual([]);
    expect(kinds('S5 D5 C5 S9 D8')).toEqual([]);
  });
  it('顺子：只能 5 张，A 可作 1 或 14，不能绕圈', () => {
    expect(kinds('S3 D4 C5 S6 D7')).toEqual(['straight:7']);
    expect(kinds('SA D2 C3 S4 D5')).toEqual(['straight:5']);
    expect(kinds('S10 DJ CQ SK DA')).toEqual(['straight:14']);
    expect(kinds('SQ DK CA S2 D3')).toEqual([]);
    expect(kinds('S3 D4 C5 S6 D7 S8')).toEqual([]);
    expect(beats(one('S2 D3 C4 S5 D6'), one('SA D2 C3 S4 D5'))).toBe(true);
  });
  it('顺子里的级牌按本位（打 7 时 34567 仍是 7 大的顺子）', () => {
    expect(kinds('S3 D4 C5 S6 D7', 7)).toEqual(['straight:7']);
    expect(beats(one('S4 D5 C6 S7 D8', 7), one('S3 D4 C5 S6 D7', 7))).toBe(true);
  });
  it('三连对：只能 3 对，AA2233 到 QQKKAA', () => {
    expect(kinds('S3 D3 S4 D4 S5 D5')).toEqual(['tube:5']);
    expect(kinds('SA DA S2 D2 S3 D3')).toEqual(['tube:3']);
    expect(kinds('SQ DQ SK DK SA DA')).toEqual(['tube:14']);
    expect(kinds('SK DK SA DA S2 D2')).toEqual([]);
    expect(kinds('S3 D3 S4 D4 S5 D5 S6 D6')).toEqual([]);
  });
  it('钢板：两个连续的三张，AAA222 到 KKKAAA', () => {
    expect(kinds('S5 D5 C5 S6 D6 C6')).toEqual(['plate:6']);
    expect(kinds('SA DA CA S2 D2 C2')).toEqual(['plate:2']);
    expect(kinds('SK DK CK SA DA CA')).toEqual(['plate:14']);
    expect(kinds('S5 D5 C5 S7 D7 C7')).toEqual([]);
  });
  it('炸弹：4 到 10 张同点（两副牌 8 张 + 两张逢人配）', () => {
    expect(kinds('S9 D9 C9 H9')).toEqual(['bomb:9']);
    expect(kinds('S9 D9 C9 H9 S9 D9 C9 H9')).toEqual(['bomb:9']);
    expect(kinds('S9 D9 C9 H9 S9 D9 C9 H9 H2 H2')).toEqual(['bomb:9']);
    expect(interpret(C('S9 D9 C9 H9 S9 D9 C9 H9 H2 H2'), 2, O)[0]!.cards).toHaveLength(10);
  });
  it('同花顺：5 张同花连续；也能当普通顺子出', () => {
    expect(kinds('S3 S4 S5 S6 S7')).toEqual(['straight:7', 'straightFlush:7:0']);
    expect(kinds('HA H2 H3 H4 H5', 9)).toEqual(['straight:5', 'straightFlush:5:1']);
    // 领出时自动挑最强的解释（同花顺），跟顺子时自动挑能压过的里面最小的
    const sf = interpret(C('S3 S4 S5 S6 S7'), 2, O);
    expect(chooseInterpretation(sf, null)!.type).toBe('straightFlush');
    expect(chooseInterpretation(sf, one('SA D2 C3 S4 D5'))!.type).toBe('straight');
  });
  it('天王炸：四张王', () => {
    expect(kinds('SJ SJ BJ BJ')).toEqual(['jokerBomb:17']);
  });
});

describe('逢人配（红桃级牌）', () => {
  it('可以当除王以外的任意牌', () => {
    expect(kinds('S5 H2')).toEqual(['pair:5']);
    expect(kinds('S5 D5 H2')).toEqual(['triple:5']);
    expect(kinds('S9 D9 C9 H2')).toEqual(['bomb:9']);
    expect(kinds('SJ H2')).toEqual([]);
    expect(kinds('BJ BJ BJ H2'.replace('BJ BJ BJ', 'SJ SJ BJ'))).toEqual([]);
  });
  it('不是逢人配的级牌（如黑桃级牌）只是普通级牌', () => {
    expect(kinds('S5 S2')).toEqual([]);
  });
  it('单出逢人配就是级牌；两张逢人配是一对级牌', () => {
    expect(kinds('H2')).toEqual(['single:2']);
    expect(kinds('H2 H2')).toEqual(['pair:2']);
    expect(one('H7', 7).value).toBe(15);
  });
  it('补顺子缺口，可能有多种解释', () => {
    expect(kinds('S3 D4 C5 S6 H2')).toEqual(['straight:6', 'straight:7']);
    expect(kinds('S3 D4 S6 C7 H2')).toEqual(['straight:7']);
  });
  it('三带二可能有两种解释', () => {
    expect(kinds('S5 D5 S6 D6 H2')).toEqual(['fullHouse:5:6', 'fullHouse:6:5']);
  });
  it('能补同花顺，包括补自己那一点的红桃', () => {
    expect(kinds('S3 S4 S5 S6 H2')).toEqual(['straight:6', 'straight:7', 'straightFlush:6:0', 'straightFlush:7:0']);
    // 打 5 时红桃 5 是逢人配；红桃 34 67 + 逢人配 = 红桃同花顺
    expect(kinds('H3 H4 H5 H6 H7', 5)).toContain('straightFlush:7:1');
  });
  it('补三连对、钢板、炸弹加张', () => {
    expect(kinds('S3 D3 S4 S5 D5 H2')).toEqual(['tube:5']);
    expect(kinds('S5 D5 C5 S6 D6 H2')).toEqual(['plate:6']);
    expect(kinds('S9 D9 C9 H9 H2')).toEqual(['bomb:9']);
    expect(kinds('S9 D9 H2 H2')).toEqual(['bomb:9']);
  });
});

describe('比大小与炸弹排位', () => {
  const b4 = one('S9 D9 C9 H9');
  const b4small = one('S3 D3 C3 H3');
  const b5 = one('S4 D4 C4 H4 S4');
  const sf = interpret(C('S3 S4 S5 S6 S7'), 2, O).find((p) => p.type === 'straightFlush')!;
  const sfBig = interpret(C('D10 DJ DQ DK DA'), 2, O).find((p) => p.type === 'straightFlush')!;
  const b6 = one('S3 D3 C3 H3 S3 D3');
  const b10 = one('S9 D9 C9 H9 S9 D9 C9 H9 H2 H2');
  const king = one('SJ SJ BJ BJ');

  it('4 张 < 5 张 < 同花顺 < 6 张 < … < 10 张 < 天王炸', () => {
    const ladder = [b4small, b4, b5, sf, sfBig, b6, b10, king];
    for (let i = 0; i < ladder.length; i++) {
      for (let j = 0; j < ladder.length; j++) {
        expect(beats(ladder[i]!, ladder[j]!), `${shape(ladder[i]!)} vs ${shape(ladder[j]!)}`).toBe(i > j);
      }
    }
  });
  it('同张数炸弹比点数，级牌炸弹压 A 炸弹', () => {
    expect(beats(one('S2 D2 C2 S2'), one('SA DA CA HA'))).toBe(true);
  });
  it('炸弹压一切非炸弹；非炸弹之间要同牌型才能比', () => {
    expect(beats(b4small, one('SJ'))).toBe(true);
    expect(beats(b4small, one('S10 DJ CQ SK DA'))).toBe(true);
    expect(beats(one('SA'), one('S3 D3'))).toBe(false);
    expect(beats(one('S5 D5 C5'), one('S3 D3 C3 S4 D4'))).toBe(false);
  });
});

describe('枚举出法', () => {
  it('列出的每一手都能被识别成同样的解释', () => {
    for (let i = 0; i < 200; i++) {
      const rng = rngFor('enum', i);
      const level = 2 + rng.int(13);
      const hand = rng.shuffle(fullDeck()).slice(0, 27);
      for (const p of enumeratePlays(hand, level, O)) {
        expect(p.cards.every((c) => hand.includes(c))).toBe(true);
        expect(interpret(p.cards, level, O).map(shape)).toContain(shape(p));
      }
    }
  });

  it('任何能压过的牌组，枚举里都有同样解释的出法（随机抽查）', () => {
    for (let i = 0; i < 300; i++) {
      const rng = rngFor('cover', i);
      const level = 2 + rng.int(13);
      const deck = rng.shuffle(fullDeck());
      const hand = deck.slice(0, 27);
      const shapes = new Set(enumeratePlays(hand, level, O).map(shape));
      // 从手里随机抽 1–8 张，凡是能识别的，枚举里都要有
      for (let k = 0; k < 60; k++) {
        const n = 1 + rng.int(8);
        const pick = rng.shuffle([...hand]).slice(0, n);
        for (const p of interpret(pick, level, O)) expect(shapes.has(shape(p)), `${shape(p)} 漏掉了`).toBe(true);
      }
    }
  });

  it('27 张加两张逢人配也很快（每次 < 5 ms）', () => {
    const hand = C('H2 H2 S3 D3 C3 S4 D4 S5 D5 C5 S6 D6 S7 S8 D8 S9 D9 C9 S10 SJ DJ SQ SK DK SA SJ BJ'.replace('SJ BJ', 'SJ BJ'));
    const t = performance.now();
    let n = 0;
    for (let i = 0; i < 100; i++) n += playsBeating(hand, null, 2, O).length;
    const per = (performance.now() - t) / 100;
    expect(n).toBeGreaterThan(100);
    expect(per).toBeLessThan(5);
  });

  it('只返回能压过上家的出法', () => {
    const hand = C('S3 D3 S9 D9 SK SA H2 SJ');
    // 一张逢人配：K、A 各配成一对，9 是天然对子；3 太小
    const pairs = playsBeating(hand, one('S8 D8'), 2, O).map(shape).sort();
    expect(pairs).toEqual(['pair:13', 'pair:14', 'pair:9']);
    // 跟单张时炸弹也算（这里没有炸弹），小王 > 级牌
    const singles = playsBeating(hand, one('SA'), 2, O).map(shape).sort();
    expect(singles).toEqual(['single:16', 'single:2']);
  });
});
