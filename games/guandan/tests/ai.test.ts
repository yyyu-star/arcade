import { describe, expect, it } from 'vitest';
import {
  BIG_JOKER,
  SMALL_JOKER,
  createGame,
  dispatch,
  hashSeed,
  hint,
  isWild,
  makeCard,
  partnerOf,
  playsBeating,
  rankOf,
  rngFor,
  seatsToAct,
  sortHand,
  viewFor,
  type Action,
  type Card,
  type GameState,
  type Play,
} from '../src/variants/guandan/core/index.ts';
import { decide, hintList, planHand, suggest } from '../src/variants/guandan/ai/index.ts';
import type { Venue } from '../src/variants/guandan/ai/venue.ts';
import { guandanRoom, testKey } from '../src/variants/guandan/net/rules.ts';
import { Session } from '../src/view/session.ts';
import { beatableByOthers, bombPossible, buildMemory, isTop } from '../src/variants/guandan/ai/memory.ts';
import { C, act, pass, play, playState } from './helpers.ts';

// 三家"牌还多"的对手/队友手牌，彼此不重复（parseCards 里 SJ 是小王，J 用其他花色写）
const L1 = 'H3 D4 C5 H6 D7 C8 H9 D10 CJ HQ DK CA';
const L2 = 'D3 C4 H5 D6 C7 H8 D9 C10 HJ DQ CK HA';
const L3 = 'C3 H4 D5 C6 H7 D8 C9 H10 DJ CQ HK DA';
const bot = (s: GameState, seat: number): Action => decide(viewFor(s, seat), { seed: 't', difficulty: 'hard' })!;
const ranks = (a: Action) => (a.type === 'play' ? a.cards.map(rankOf).sort((x, y) => x - y) : a.type);

describe('电脑对手', () => {
  it('领出先出最小的一手，留着王和级牌', () => {
    const s = playState(['S3 S9 D9 SK SA DA BJ', L1, L2, L3]);
    expect(ranks(bot(s, 0))).toEqual([3]);
  });

  it('领出时优先把顺子、三带二这类多张的牌型走掉', () => {
    const s = playState(['S3 D4 C5 S6 D7 SK DK CK S9 D9 BJ', L1, L2, L3]);
    const a = bot(s, 0);
    expect(a.type === 'play' && a.cards.length).toBe(5);
  });

  it('跟对手的牌：用最小、不拆对子的牌压', () => {
    let s = playState(['D7 S9 D9 SK DA', L1, L2, 'S5 ' + L3], { turn: 3 });
    s = play(s, 3, 'S5');
    expect(ranks(bot(s, 0))).toEqual([7]);
  });

  it('队友出的牌不压', () => {
    let s = playState(['D7 S9 D9 SK DA', L1, 'S5 ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'S5');
    s = act(s, { type: 'pass', seat: 3 }).state;
    expect(bot(s, 0)).toEqual({ type: 'pass', seat: 0 });
  });

  it('队友出的牌，能一把出完就压', () => {
    let s = playState(['D9', L1, 'S5 ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'S5');
    s = act(s, { type: 'pass', seat: 3 }).state;
    expect(ranks(bot(s, 0))).toEqual([9]);
  });

  it('对手牌还多时，不拿炸弹炸小单张', () => {
    let s = playState(['S7 D7 C7 H7 S3 D4 S6 S9 DJ SQ', L1, L2, 'SA ' + L3], { turn: 3 });
    s = play(s, 3, 'SA');
    expect(bot(s, 0)).toEqual({ type: 'pass', seat: 0 });
  });

  it('对手快出完（≤ 6 张）时用炸弹', () => {
    let s = playState(['S7 D7 C7 H7 S3 D4 S9 DJ', L1, L2, 'SA S4 S5 S6'], { turn: 3 });
    s = play(s, 3, 'SA');
    expect(ranks(bot(s, 0))).toEqual([7, 7, 7, 7]);
  });

  it('对手只剩 1 张时，领出不出单张', () => {
    const s = playState(['S3 S8 D8 SK DQ', 'S4', L1, 'S5']);
    const a = bot(s, 0);
    expect(a.type === 'play' && a.cards.length).toBeGreaterThan(1);
  });

  it('队友只剩 1 张时喂小单张', () => {
    const s = playState(['S3 S8 D8 SK DK', L1, 'S5', L2]);
    expect(ranks(bot(s, 0))).toEqual([3]);
  });

  it('进贡交最大的牌，还贡还最没用的 10 以下的牌', () => {
    const s = playState(['S3 D9 C9 S9 S10 DJ DQ DK', 'S4', 'S5', 'BJ S6 S7'], { turn: 0 });
    s.lastDeal = { dealNo: 1, order: [0, 1, 2, 3], winnerTeam: 0, up: 1, doubleDown: false, levelsBefore: [2, 2], levelsAfter: [2, 2], aFailedTeam: -1, aResetTeam: -1 };
    s.phase = 'tribute';
    s.tribute = { kind: 'single', entries: [{ from: 3, to: 0, card: null, back: null }], leader: -1 };
    const t = bot(s, 3);
    expect(t.type === 'tribute' && rankOf(t.card)).toBe(17);
    const s2 = act(s, t).state;
    const r = bot(s2, 0);
    // 9 是三张、10JQK 能连顺子，最没用的是单张 3
    expect(r.type === 'return' && rankOf(r.card)).toBe(3);
  });

  it('理牌：手数尽量少', () => {
    const plan = planHand(C('S3 D4 C5 S6 D7 S9 D9 C9 SK DK S8 D8 C8 H8'), 2);
    const types = plan.groups.map((g) => g.type).sort();
    expect(types).toEqual(['bomb', 'fullHouse', 'straight']);
  });

  it('同样的种子和局面，决定完全一样；不同难度都能给出合法动作', () => {
    const s = playState(['S3 S9 D9 SK SA DA BJ', L1, L2, L3]);
    expect(decide(viewFor(s, 0), { seed: 'x' })).toEqual(decide(viewFor(s, 0), { seed: 'x' }));
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < 20; i++) {
        const a = decide(viewFor(s, 0), { seed: `d${i}`, difficulty: d })!;
        expect(a.type).toBe('play');
      }
    }
    expect(decide(viewFor(s, 1), { seed: 'x' })).toBeNull();
  });

});

/** 把一组牌记成别人（座位 1）已经一张张出过（只给记牌用，不放进任何人手里）。 */
function withHistory(s: GameState, cards: Card[]): GameState {
  s.history = cards.map((c) => ({ seat: 1, play: { type: 'single', rank: rankOf(c), value: rankOf(c), extra: -1, cards: [c] } }));
  return s;
}
/** 4 张王 + 8 张 2（含两张逢人配）：打 2 时比 A 大的单张全部出完了 */
const ABOVE_ACE: Card[] = [SMALL_JOKER, BIG_JOKER].flatMap((r) => [makeCard(r, 0, 0), makeCard(r, 0, 1)]).concat(
  [0, 1, 2, 3].flatMap((suit) => [makeCard(2, suit, 0), makeCard(2, suit, 1)]),
);
const wildsIn = (cards: readonly Card[], level = 2) => cards.filter((c) => isWild(c, level)).length;
const ranksOf = (p: Play | null) => (p ? p.cards.map(rankOf).sort((x, y) => x - y) : null);

describe('电脑对手：像人一样出牌', () => {
  it('跟牌时有不用逢人配的压法就不用逢人配（电脑、聪明提示、提示列表第一条都一样）', () => {
    // 打 2：H2 是逢人配。对手出对 7，能压的有 8+逢人配、K+逢人配、天然对 A
    let s = playState(['H2 S8 SK SA DA S3 D4', L1, L2, 'S7 D7 ' + L3], { turn: 3 });
    s = play(s, 3, 'S7 D7');
    const v = viewFor(s, 0);
    for (const d of ['normal', 'hard'] as const) {
      const a = decide(v, { seed: 't', difficulty: d })!;
      expect(a.type === 'play' && wildsIn(a.cards)).toBe(0);
      expect(ranks(a)).toEqual([14, 14]);
    }
    expect(ranksOf(suggest(v))).toEqual([14, 14]);
    expect(wildsIn(hint(v)[0]!.cards)).toBe(0);
    expect(ranksOf(hint(v)[0]!)).toEqual([14, 14]);
  });

  it('领出时不拿逢人配去配小牌', () => {
    const s = playState(['H2 S3 S9 D9 SQ DQ SK', L1, L2, L3]);
    const a = bot(s, 0);
    expect(a.type === 'play' && wildsIn(a.cards)).toBe(0);
  });

  it('理牌：逢人配用来把三张凑成炸弹', () => {
    const plan = planHand(C('H2 S9 D9 C9 SK DK S4'), 2);
    const bomb = plan.groups.find((g) => g.type === 'bomb');
    expect(bomb && bomb.rank).toBe(9);
    expect(bomb && wildsIn(bomb.cards)).toBe(1);
  });

  it('跟牌不拆炸弹：用 K 压，不拆 4 张 Q（提示第一条也是 K）', () => {
    let s = playState(['CQ DQ SQ HQ SK S3 D5 S8', L1, L2, 'S10 ' + L3], { turn: 3 });
    s = play(s, 3, 'S10');
    const v = viewFor(s, 0);
    expect(ranks(bot(s, 0))).toEqual([13]);
    expect(ranksOf(suggest(v))).toEqual([13]);
    expect(ranksOf(hint(v)[0]!)).toEqual([13]);
  });

  it('跟牌不拆对子：单张先用落单的牌', () => {
    let s = playState(['S6 D6 S7 S9 SK S3 D4 C8', L1, L2, 'S5 ' + L3], { turn: 3 });
    s = play(s, 3, 'S5');
    expect(ranksOf(hint(viewFor(s, 0))[0]!)).toEqual([7]);
  });

  it('跟牌不拆同花顺里的牌：同点有别的花色时换一张', () => {
    // ♠3-♠7 同花顺，另有 ♦6；对手出单 5，压的 6 应该用 ♦6
    let s = playState(['S3 S4 S5 S6 S7 D6 SK DK CK S9 D9', L1, L2, 'C5 ' + L3], { turn: 3 });
    s = play(s, 3, 'C5');
    const a = bot(s, 0);
    expect(a.type === 'play' && a.cards.length === 1 && a.cards[0]! % 54).toBe(makeCard(6, 3) % 54);
  });

  it('队友出的小牌不压，即使手里有大牌', () => {
    let s = playState(['SA DA S3 D4 C9 SK DK', L1, 'S6 ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'S6');
    s = pass(s, 3);
    expect(bot(s, 0)).toEqual({ type: 'pass', seat: 0 });
    expect(decide(viewFor(s, 0), { seed: 't', difficulty: 'normal' })).toEqual({ type: 'pass', seat: 0 });
  });

  it('队友出不完、下家对手只剩 1 张：替队友顶一张大的', () => {
    // 队友出单 6（还有 12 张），下家只剩 1 张：不顶的话下家可能直接走
    let s = playState(['SA S3 D4 C9 SK DK', 'D8', 'S6 ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'S6');
    s = pass(s, 3);
    const a = bot(s, 0);
    expect(a.type).toBe('play');
    expect(ranks(a)).toEqual([14]);
  });

  it('队友出的牌，压过后剩下的牌已经最大：借此一把出完', () => {
    // 王和 2 都出完了；我压队友的单 6 用 A（别人压不过），再出一对 A 就走
    let s = playState(['S9 SA DA CA', 'S5 S8 D8 C8 S10', 'S6 ' + L2, L3], { turn: 2 });
    s = withHistory(s, ABOVE_ACE);
    s = play(s, 2, 'S6');
    s = pass(s, 3);
    const a = bot(s, 0);
    expect(a.type).toBe('play');
  });

  it('对手只剩 2 张出对子，没有对子能压：用炸弹', () => {
    let s = playState(['S7 D7 C7 H7 S3 D5 S9 DJ SQ SK D10 C4', L1, L2, 'SA DA S4 S6'], { turn: 3 });
    s = play(s, 3, 'SA DA');
    expect(ranks(bot(s, 0))).toEqual([7, 7, 7, 7]);
  });

  it('对手只剩 1 张时跟单张：出最大的顶住，而不是最小的', () => {
    let s = playState(['S6 S9 SK SA D3 D5 C8 CJ', L1, L2, 'S4 S5'], { turn: 3 });
    s = play(s, 3, 'S4');
    expect(ranks(bot(s, 0))).toEqual([14]);
  });

  it('对手快走完时领出避开他一把能走的张数', () => {
    // 对手剩 2 张：不领对子
    const s = playState(['S3 D3 S9 D9 SK DK CK S6 D7 C8 S10 CJ', 'S4 D4', L1, 'S5 D5']);
    const a = bot(s, 0);
    expect(a.type === 'play' && a.cards.length).not.toBe(2);
  });

  it('队友剩 4 张：领出送他接得住的小对子，不出自己的顺子', () => {
    const plan = 'S3 D4 C5 S6 D7 S8 D8 SQ SA DA';
    const normalLead = bot(playState([plan, L1, L2, L3]), 0);
    expect(normalLead.type === 'play' && normalLead.cards.length).toBe(5);
    const s = playState([plan, L1, 'S5 D5 C9 S10', L3]);
    expect(ranks(bot(s, 0))).toEqual([8, 8]);
  });

  it('记牌：王和级牌都出完后，A 已经最大，领出先出 A 拿住出牌权，最后出 3', () => {
    const fresh = playState(['SA S3', L1, L2, L3]);
    // 不知道王和级牌的下落时：先出小的
    expect(ranks(bot(fresh, 0))).toEqual([3]);
    const s = withHistory(playState(['SA S3', L1, L2, L3]), ABOVE_ACE);
    expect(ranks(bot(s, 0))).toEqual([14]);
    // 聪明提示同样
    expect(ranksOf(suggest(viewFor(s, 0)))).toEqual([14]);
  });

  it('记牌：已经最大的牌，跟牌时不留着，压上去拿回出牌权', () => {
    let s = withHistory(playState(['SA S3 D4', L1, L2, 'S9 ' + L3], { turn: 3 }), ABOVE_ACE);
    s = play(s, 3, 'S9');
    expect(ranks(bot(s, 0))).toEqual([14]);
  });

  it('记牌只用公开出牌记录：算出每个点数还剩几张、别人还可能有什么', () => {
    const s = withHistory(playState(['SA S3 H2', L1, L2, L3]), ABOVE_ACE.filter((c) => !isWild(c, 2)));
    const m = buildMemory(viewFor(s, 0));
    expect(m.unseen[SMALL_JOKER]).toBe(0);
    expect(m.unseen[BIG_JOKER]).toBe(0);
    expect(m.unseen[2]).toBe(0);
    expect(m.unseenWild).toBe(1); // 一张在我手里，另一张还没出现
    expect(m.unseen[14]).toBe(7);
    const single = (r: number): Play => ({ type: 'single', rank: r, value: r, extra: -1, cards: [makeCard(r, 0)] });
    // 还有一张逢人配在外面，可以当级牌单张压 A
    expect(isTop(m, single(14))).toBe(false);
    expect(beatableByOthers(m, single(13))).toBe(true);
    // 别人手里还可能凑出炸弹
    expect(bombPossible(m, null)).toBe(true);
    // 记性差（不记牌）时，不知道王已经出完
    expect(buildMemory(viewFor(s, 0), 'none').unseen[BIG_JOKER]).toBe(2);
  });

  it('三档难度都只给合法动作，困难和聪明提示没有随机失误', () => {
    let s = playState(['S6 S9 SK SA D3 D5 C8 CJ', L1, L2, 'S4 ' + L3], { turn: 3 });
    s = play(s, 3, 'S4');
    const v = viewFor(s, 0);
    const first = decide(v, { seed: 'a', difficulty: 'hard' });
    for (let i = 0; i < 30; i++) expect(decide(v, { seed: `s${i}`, difficulty: 'hard' })).toEqual(first);
    for (let i = 0; i < 30; i++) expect(suggest(v, `s${i}`)).toEqual(suggest(v));
  });
});

describe('电脑对手：会抢出牌权', () => {
  // 顺子 3-7 + 三张 10 + 对 Q：压单张、对子都得拆点东西，但代价不大
  const H = 'S3 D4 C5 S6 D7 S10 D10 C10 SQ DQ';
  for (const d of ['normal', 'hard'] as const) {
    it(`面对单张，有便宜的压法就压（${d}）`, () => {
      let s = playState([H, L1, L2, 'S8 ' + L3], { turn: 3 });
      s = play(s, 3, 'S8');
      const a = decide(viewFor(s, 0), { seed: 'c', difficulty: d })!;
      expect(a.type).toBe('play');
      expect(a.type === 'play' && a.cards.length).toBe(1);
    });
    it(`面对对子，拆三张也压（${d}）`, () => {
      let s = playState([H, L1, L2, 'S8 D8 ' + L3], { turn: 3 });
      s = play(s, 3, 'S8 D8');
      const a = decide(viewFor(s, 0), { seed: 'c', difficulty: d })!;
      expect(a.type).toBe('play');
      expect(a.type === 'play' && a.cards.length).toBe(2);
    });
  }

  it('牌还多也敢用级牌压回出牌权（手里还有王）', () => {
    let s = playState(['S2 BJ S3 D3 C3 S4 D4 C4 S6 D6 C6 S7 D7', L1, L2, 'S9 ' + L3], { turn: 3 });
    s = play(s, 3, 'S9');
    expect(ranks(bot(s, 0))).toEqual([2]);
  });

  it('明显浪费才不压：牌还多时不拿大王压 10', () => {
    let s = playState(['BJ S3 D3 C3 S4 D4 C4 S6 D6 C6 S7 D7 C7', L1, L2, 'S10 ' + L3], { turn: 3 });
    s = play(s, 3, 'S10');
    expect(bot(s, 0)).toEqual({ type: 'pass', seat: 0 });
  });

  it('上家对手出的牌，下家（我）先顶；队友已经压过的不再压', () => {
    // 对手 3 出单 6，我是他的下家：压
    let s = playState([H, L1, L2, 'S6 ' + L3], { turn: 3 });
    s = play(s, 3, 'S6');
    expect(bot(s, 0).type).toBe('play');
    // 对手 1 出单 6，我的队友 2 压了 9，对手 3 不要：轮到我，不再压队友
    let t = playState([H, 'S6 ' + L1, 'S9 ' + L2, L3], { turn: 1 });
    t = play(t, 1, 'S6');
    t = play(t, 2, 'S9');
    t = pass(t, 3);
    expect(bot(t, 0)).toEqual({ type: 'pass', seat: 0 });
  });
});

// 2026-10-13 线上试玩 0.1.2 发现的问题（试玩日志复盘：tools/replay-log.ts）
describe('试玩回归：提示和电脑不犯低级错', () => {
  const isBombPlay = (p: Play | null | undefined) => !!p && ['bomb', 'straightFlush', 'jokerBomb'].includes(p.type);

  it('队友出大王：提示首条是"建议不要"，不是炸队友', () => {
    let s = playState(['S6 H6 D6 C6 S3 D4 C9 SK', L1, 'BJ ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'BJ');
    s = pass(s, 3);
    const list = hintList(viewFor(s, 0), 'h');
    expect(list[0]).toBeNull();
    expect(list.slice(1).some(isBombPlay)).toBe(true); // 炸弹还在列表里，只是不排第一
  });

  it('队友剩 2 张出炸弹：提示首条不是同花顺', () => {
    let s = playState(['H8 H9 H10 HJ HQ D4 C7 HK', L1, 'S3 H3 C3 D3 S9 D9', L3], { turn: 2 });
    s = play(s, 2, 'S3 H3 C3 D3');
    s = pass(s, 3);
    const list = hintList(viewFor(s, 0), 'h');
    expect(list[0]).toBeNull();
    expect(bot(s, 0)).toEqual({ type: 'pass', seat: 0 });
  });

  it('对手出三带二：有现成的三带二就用，不拿逢人配凑的炸弹去炸（试玩手机第 2 副原局面）', () => {
    // 打 3：♥3 是逢人配，888+♥3 能凑炸弹，还有 ♠9-♠K 同花顺；但 888KK 正好压 222+77
    let s = playState(
      [
        '♠2 ♠9 ♠10 ♠J ♠Q ♠K ♥3 ♥5 ♥9 ♥K ♥K ♣4 ♣8 ♣9 ♦3 ♦3 ♦4 ♦6 ♦8 ♦8 ♦9 ♦A',
        '♠4 ♠4 ♠10 ♠J ♠Q ♠K ♠A ♥4 ♥6 ♥6 ♥9 ♥10 ♥J ♥Q ♣6 ♣Q ♦4 ♦10 ♦Q ♦K ♦A 小王',
        '♠2 ♠3 ♥2 ♥7 ♥8 ♥8 ♥10 ♥A ♣2 ♣3 ♣7 ♣9 ♣10 ♣J ♣Q ♣K ♣K ♣A ♦2 ♦9 ♦Q 小王',
        '♦2 ♣2 ♥2 ♣7 ♠7 ♠5 ♠5 ♠9 ♥3 ♥Q ♣5 ♣8 ♣10 ♣J ♦5 ♦5 ♦6 ♦7 ♦10 ♦K 大王 大王',
      ],
      { turn: 3, level: 3 },
    );
    s = play(s, 3, '♦2 ♣2 ♥2 ♣7 ♠7');
    const first = hintList(viewFor(s, 0), 'h')[0]!;
    expect(first.type).toBe('fullHouse');
    expect(first.rank).toBe(8);
    expect(wildsIn(first.cards, 3)).toBe(0);
  });

  it('提示列表认得同花顺：压单张不拆同花顺里的牌', () => {
    let s = playState(['H8 H9 H10 HJ HQ D3 CK', L1, L2, 'S9 ' + L3], { turn: 3 });
    s = play(s, 3, 'S9');
    expect(ranksOf(hint(viewFor(s, 0))[0]!)).toEqual([13]);
  });

  it('对手只剩 1 张时，普通电脑领出从不出单张（不会"失误"送走对手）', () => {
    // 打 3：手里有对 7、对 8、对 9、对 3（级牌）、小王和几张单牌
    const s = playState(['H7 C7 H8 S8 D9 C9 S3 C3 H10 HA DQ SJ', 'SK', L2, L3], { turn: 0, level: 3 });
    for (let i = 0; i < 40; i++) {
      const a = decide(viewFor(s, 0), { seed: `slip${i}`, difficulty: 'normal' })!;
      expect(a.type === 'play' && a.cards.length).not.toBe(1);
    }
  });

  it('对手出完最后一手炸弹、没人压就由他对家接风：手里有同花顺就炸回来', () => {
    // 打 3。阿强（座位 3）用 55555 出完；他对家（座位 1）还剩 7 张带炸弹
    let s = playState(
      [
        'S2 S3 H2 H7 H8 H8 H10 HA C2 C3 C7 C9 C10 CJ CQ CK CK CA D2 D9 DQ SJ',
        'S4 S4 DJ SK H4 D4 SJ',
        'S2 S9 H3 H5 H9 C4 C9 D3 D3 D4 D6 D9',
        'S5 S5 C5 D5 D5',
      ],
      { turn: 3, level: 3 },
    );
    s = play(s, 3, 'S5 S5 C5 D5 D5');
    const a = decide(viewFor(s, 0), { seed: 't', difficulty: 'normal' })!;
    expect(a.type === 'play' && a.as?.type).toBe('straightFlush');
  });

  it('普通电脑的"新手错"不拆炸弹、不压队友（试玩复盘：拆 9999 出 ♠9 压队友的 ♦8）', () => {
    const hand = 'S9 D9 C9 H9 SK DK CK HK S3 D5 C7 CJ';
    // 队友出 ♦8、上家不要：怎么失误都不压队友
    let s = playState([hand, L1, 'D8 ' + L2, L3], { turn: 2 });
    s = play(s, 2, 'D8');
    s = act(s, { type: 'pass', seat: 3 }).state;
    // 对手出 ♦8：失误时随手压最小的，也只用落单的 J，不拆 9999
    let t = playState([hand, L1, L2, 'D8 ' + L3], { turn: 3 });
    t = play(t, 3, 'D8');
    for (let i = 0; i < 20; i++) {
      const cfg = { seed: `slip${i}`, difficulty: 'normal' as const, tuning: { slip: 1 } };
      expect(decide(viewFor(s, 0), cfg)).toEqual({ type: 'pass', seat: 0 });
      expect(ranks(decide(viewFor(t, 0), cfg)!)).toEqual([11]);
    }
  });

  it('对手只剩 1 张、手里有同花顺：直接炸，不拆同花顺出最大的 K 顶（试玩复盘 p-0 第 5 副）', () => {
    // 王、2、A 都出完了：单张 K 已经最大，以前会拆 9 到 K 的同花顺出 ♠K
    const aces = [0, 1, 2, 3].flatMap((suit) => [makeCard(14, suit, 0), makeCard(14, suit, 1)]);
    let s = withHistory(playState(['♠3 ♥3 ♠9 ♠10 ♠J ♠Q ♠K', L1, L2, 'HQ S5'], { turn: 3 }), [...ABOVE_ACE, ...aces]);
    s = play(s, 3, 'HQ');
    const a = bot(s, 0);
    expect(a.type === 'play' && a.as?.type).toBe('straightFlush');
  });

  it('开局（双方 20 多张）不拿炸弹炸最小的三连对（试玩电脑第 4 副原局面）', () => {
    // 打 7：小美领出 223344；阿强 27 张，有 6666 和 55555
    let s = playState(
      [
        '♠2 ♠2 ♠10 ♠J ♠Q ♥3 ♥6 ♥7 ♥8 ♥8 ♥10 ♥J ♣2 ♣4 ♣8 ♣8 ♣9 ♣9 ♣10 ♣J ♣Q ♦5 ♦8 ♦Q ♦K ♦A 小王',
        '♠3 ♠4 ♠6 ♠8 ♠9 ♠10 ♠Q ♠K ♥2 ♥3 ♥4 ♥Q ♥A ♣6 ♣7 ♣7 ♣K ♣A ♦3 ♦10 ♦10 ♦J ♦Q ♦A 小王 大王 大王',
        '♦2 ♣2 ♣3 ♣3 ♦4 ♠4 ♠3 ♠5 ♠7 ♠8 ♠9 ♠A ♠A ♥J ♥Q ♥K ♥A ♣10 ♣J ♣A ♦5 ♦6 ♦7 ♦9 ♦9 ♦J ♦K',
        '♠5 ♠6 ♠7 ♠J ♠K ♥2 ♥4 ♥5 ♥5 ♥6 ♥7 ♥9 ♥9 ♥10 ♥K ♣4 ♣5 ♣5 ♣6 ♣Q ♣K ♦2 ♦3 ♦4 ♦6 ♦7 ♦8',
      ],
      { turn: 2, level: 7 },
    );
    s = play(s, 2, '♦2 ♣2 ♣3 ♣3 ♦4 ♠4');
    for (const d of ['normal', 'hard'] as const) expect(decide(viewFor(s, 3), { seed: 't', difficulty: d })).toEqual({ type: 'pass', seat: 3 });
  });
});

/**
 * 电脑不看别人的牌（反事实，0.8.1 AI 公平审计）：在电脑要做决定的每一刻，保持这个座位看得到的一切不变
 * （自己的手牌、公开的出牌、每人几张、贡牌、自己参与的还贡牌），把另外三家没亮出来的牌重新分一遍（每人张数不变），再让电脑决定。
 * 只看自己能看到的电脑，两边的决定必须一模一样；会偷看的电脑（阳性对照）同样的方法能抓出来。
 * 走的是游戏里真正调用的函数：单机 Session.botAction（娱乐三档、实盘一档），好友房 guandanRoom.ai（房间里的电脑和替掉线真人代打）。
 * 种子固定，每次跑的结果一样；想跑更多局把 DEALS 调大。为什么这样就能说明"不透"，见 README"电脑不看牌"一节。
 */
describe('电脑不看别人的牌（反事实）', () => {
  /** 这个座位确切知道在谁手里的牌（自己的手牌之外）：交出后公开的贡牌、自己参与的还贡牌 */
  function known(s: GameState, seat: number): Map<Card, number> {
    const m = new Map<Card, number>();
    for (const e of s.tribute?.entries ?? []) {
      if (e.card !== null && e.to >= 0 && s.hands[e.to]!.includes(e.card)) m.set(e.card, e.to);
      if (e.back !== null && (seat === e.from || seat === e.to) && s.hands[e.from]!.includes(e.back)) m.set(e.back, e.from);
    }
    return m;
  }

  /** 平行世界：另外三家没亮出来的牌洗一洗重新分；返回新状态和"真的换了牌没有" */
  function parallel(s: GameState, seat: number, salt: string): { alt: GameState; changed: boolean } {
    const others = [0, 1, 2, 3].filter((x) => x !== seat);
    const k = known(s, seat);
    const pool: Card[] = [];
    const keep: Card[][] = [[], [], [], []];
    for (const o of others) for (const c of s.hands[o]!) (k.get(c) === o ? keep[o]! : pool).push(c);
    rngFor('parallel', salt).shuffle(pool);
    const hands = s.hands.map((h) => [...h]);
    let at = 0;
    for (const o of others) {
      const need = s.hands[o]!.length - keep[o]!.length;
      hands[o] = sortHand([...keep[o]!, ...pool.slice(at, at + need)], s.level);
      at += need;
    }
    return { alt: { ...s, hands }, changed: others.some((o) => hands[o]!.join() !== s.hands[o]!.join()) };
  }

  interface Tally {
    points: number;
    changed: number;
    mismatch: number;
  }
  /** 一个决策点：真实世界和平行世界各决定一次，比较 */
  function compare(t: Tally, s: GameState, seat: number, salt: string, decideIn: (st: GameState) => unknown): void {
    const { alt, changed } = parallel(s, seat, salt);
    // 平行世界对这个座位来说和原局一模一样（不然比较就没意义）
    expect(JSON.stringify(viewFor(alt, seat))).toBe(JSON.stringify(viewFor(s, seat)));
    t.points++;
    if (changed) t.changed++;
    if (JSON.stringify(decideIn(alt)) !== JSON.stringify(decideIn(s))) t.mismatch++;
  }

  /** 单机实盘的电脑：和 StakeSession 一样只换场地 */
  class StakeLike extends Session {
    constructor(st: GameState) {
      super(st, [], 'normal');
      this.persist = false;
      this.scored = false;
    }
    protected override venue(): Venue {
      return { kind: 'soloStake', tier: 'lux' };
    }
  }
  const solo = (level: 'novice' | 'normal' | 'pro') => (st: GameState) => {
    const x = new Session(st, [], level);
    x.persist = false;
    x.scored = false;
    return x;
  };

  /** 单机一局按真实的 Session 打 DEALS 副，每个决策点都比较一次（座位 0 是代打的我） */
  function walkSolo(make: (st: GameState) => Session, seed: string, t: Tally, extra?: (s: GameState, seat: number) => void): void {
    let { state } = createGame(seed);
    const ses = make(state);
    while (state.phase !== 'gameOver' && state.dealNo <= DEALS) {
      if (state.phase === 'dealEnd') {
        state = dispatch(state, { type: 'nextDeal' }).state;
        continue;
      }
      const seat = seatsToAct(state)[0]!;
      compare(t, state, seat, `${seed}|${state.step}|${seat}`, (st) => {
        ses.state = st;
        return ses.botAction(seat);
      });
      extra?.(state, seat);
      ses.state = state;
      const r = dispatch(state, ses.botAction(seat)!);
      if (r.error) throw new Error(r.error);
      state = r.state;
    }
  }

  const DEALS = 2;
  const fresh = (): Tally => ({ points: 0, changed: 0, mismatch: 0 });

  it('单机（娱乐三档、实盘豪华档）：几百个决策点，换掉别人的牌，电脑的决定一次都不变', () => {
    const t = fresh();
    walkSolo(solo('novice'), 'cf-novice', t);
    walkSolo(solo('pro'), 'cf-pro', t);
    walkSolo((st) => new StakeLike(st), 'cf-lux', t);
    expect(t.points).toBeGreaterThan(300);
    // 平行世界真的换了牌（只剩几张、全被看见时才会一样）
    expect(t.changed / t.points).toBeGreaterThan(0.9);
    expect(t.mismatch).toBe(0);
  });

  it('好友房（guandanRoom.ai：房间里的电脑带性格，替掉线真人代打的不带）：同样一次都不变', () => {
    const t = fresh();
    for (const [name, opts, seats] of [
      ['cf-room', undefined, ['human', 'ai', 'ai', 'ai']],
      ['cf-room-stake', { stake: 'small' }, ['human', 'ai', 'human', 'ai']],
    ] as const) {
      let s = guandanRoom.begin(testKey(name), guandanRoom.rulesVersion, { opts: guandanRoom.options!(opts)!, seats: [...seats] });
      while (!guandanRoom.over(s) && s.g.dealNo <= DEALS) {
        const seat = guandanRoom.actors(s).seats[0];
        if (seat === undefined) break;
        if (s.g.phase !== 'dealEnd') compare(t, s.g, seat, `${name}|${s.g.step}|${seat}`, (st) => guandanRoom.ai({ ...s, g: st }, seat));
        const r = guandanRoom.apply(s, seat, guandanRoom.ai(s, seat));
        if ('error' in r) throw new Error(r.error);
        s = r;
      }
    }
    expect(t.points).toBeGreaterThan(300);
    expect(t.changed / t.points).toBeGreaterThan(0.9);
    expect(t.mismatch).toBe(0);
  });

  it('阳性对照：会偷看的电脑，同样的方法抓得出来', () => {
    // 偷看搭档：跟对手的牌时，搭档（还没不要）手里压得过就让给他
    const peekPartner = (s: GameState, seat: number): Action | null => {
      const v = viewFor(s, seat);
      const a = decide(v, { seed: 'peek', difficulty: 'hard' });
      const last = v.trick.last;
      const p = partnerOf(seat);
      if (!a || a.type !== 'play' || !last || last.seat % 2 === seat % 2 || s.finished.includes(p) || v.trick.passed[p]) return a;
      return playsBeating(s.hands[p]!, last.play, s.level, s.options).length > 0 ? { type: 'pass', seat } : a;
    };
    // 随机流混进了全桌的牌（比如拿整个状态做种子）：用会犯错、换着出的新手阿强，随机数才看得出来
    const peekRng = (s: GameState, seat: number): Action | null =>
      decide(viewFor(s, seat), { seed: hashSeed(s.hands.flat().join(',')), difficulty: 'novice', persona: 'aqiang' });
    const caught = { partner: fresh(), rng: fresh() };
    walkSolo(solo('normal'), 'cf-control', fresh(), (s, seat) => {
      if (s.phase !== 'play') return;
      compare(caught.partner, s, seat, `ctl|${s.step}|${seat}`, (st) => peekPartner(st, seat));
      compare(caught.rng, s, seat, `ctl|${s.step}|${seat}`, (st) => peekRng(st, seat));
    });
    // 偷看搭档只在"搭档压得过、平行世界里又压不过"时露馅，所以抓到的少（固定种子下 177 个点里 3 个），有就说明方法灵；
    // 随机流混进全桌的牌，几乎每个要抽随机数的点都会变（177 个点里 32 个）
    expect(caught.partner.mismatch).toBeGreaterThan(0);
    expect(caught.rng.mismatch).toBeGreaterThan(caught.rng.points / 10);
  });
});
