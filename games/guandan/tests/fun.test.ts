import { STICKERS, PROPS, funItem } from 'arcade-kit/table-fun';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, interpret, parseCards, type DealResult, type PlayRecord } from '../src/variants/guandan/core/index.ts';
import { EMOTES, EMOTE_COUNT, PROP_BASE, PROP_COUNT, STICKER_BASE, STICKER_COUNT, TAUNTS, emoteOf, taunt } from '../src/net/emotes.ts';
import { suggestFor } from '../src/view/suggest.ts';
import { dealTitles, emptyMatchLog, logDeal, matchTitles } from '../src/variants/guandan/stake/titles.ts';
import { MOOD_LINES, PHRASES, URGE_AFTER_MS, URGE_P, dealMoment, momentOf, slowUrge, victimOf } from '../src/variants/guandan/net/fun-moments.ts';
import { funBots, guandanRoom, testKey } from '../src/variants/guandan/net/rules.ts';

const play = (s: string) => interpret(parseCards(s), 2, DEFAULT_OPTIONS)[0]!;

describe('互动编号、顺手提示、称号', () => {
  it('编号表：短语 0–7 不动，嘲讽、表情、道具依次往后；表情、道具对得上 kit 的列表', () => {
    expect(EMOTES).toHaveLength(8);
    expect(emoteOf(0)).toEqual({ kind: 'phrase', text: '好牌！' });
    expect(emoteOf(8)).toEqual({ kind: 'taunt', text: TAUNTS[0] });
    expect(emoteOf(STICKER_BASE)).toEqual({ kind: 'sticker', index: 0 });
    expect(emoteOf(PROP_BASE + 4)).toEqual({ kind: 'prop', index: 4 });
    expect(emoteOf(EMOTE_COUNT)).toBeNull();
    expect(STICKERS.length).toBeGreaterThanOrEqual(STICKER_COUNT);
    expect(PROPS.length).toBeGreaterThanOrEqual(PROP_COUNT);
    expect(TAUNTS.length).toBeGreaterThanOrEqual(10);
    // 只说牌局：不带"你妈""丑""胖"之类，也不提地域、性别
    for (const t of TAUNTS) expect(t).not.toMatch(/妈|爹|丑|胖|蠢|傻|笨|男|女|省|人/);
  });

  it('顺手提示只看公开出牌：我炸了对手冒"就这？"，对手炸了我方冒"等着瞧"一类，我头游冒"谢谢送分"', () => {
    const bomb = play('♠9 ♥9 ♣9 ♦9');
    expect(suggestFor({ type: 'play', seat: 0, play: bomb, left: 10 }, 1)).toContain(taunt('就这？'));
    expect(suggestFor({ type: 'play', seat: 3, play: bomb, left: 10 }, 0)).toContain(taunt('等着瞧'));
    // 领出的炸弹没压到谁；普通出牌不冒
    expect(suggestFor({ type: 'play', seat: 0, play: bomb, left: 10 }, -1)).toEqual([]);
    expect(suggestFor({ type: 'play', seat: 1, play: play('♠K'), left: 10 }, 0)).toEqual([]);
    expect(suggestFor({ type: 'finish', seat: 0, place: 1 }, -1)).toContain(taunt('谢谢送分'));
  });

  it('称号：炸弹最多的炸弹狂魔、双下的最佳搭档、输的那边末游背锅；整局按次数算', () => {
    const r: DealResult = { dealNo: 1, order: [0, 2, 1, 3], winnerTeam: 0, up: 3, doubleDown: true, levelsBefore: [2, 2], levelsAfter: [5, 2], aFailedTeam: -1, aResetTeam: -1 };
    const b = play('♠9 ♥9 ♣9 ♦9');
    const hist: PlayRecord[] = [{ seat: 1, play: b }, { seat: 1, play: b }, { seat: 0, play: b }];
    expect(dealTitles(r, hist).map((t) => [t.id, t.seat])).toEqual([['bomb_maniac', 1], ['best_partner', 0], ['scapegoat', 3]]);
    let m = emptyMatchLog();
    m = logDeal(m, r, hist);
    m = logDeal(m, { ...r, order: [0, 1, 2, 3], doubleDown: false }, hist);
    expect(matchTitles(m).map((t) => t.id)).toEqual(['first_king', 'bomb_maniac', 'scapegoat']);
  });
});

describe('接 kit 的牌桌互动（0.12.0）', () => {
  it('短语表接 kit 的编号：客气话、嘲讽之后正好是表情、道具', () => {
    expect(PHRASES).toHaveLength(STICKER_BASE);
    expect(funItem(taunt('就这？'), PHRASES.length)).toEqual({ kind: 'phrase', index: taunt('就这？') });
    expect(funItem(STICKER_BASE + 3, PHRASES.length)).toEqual({ kind: 'sticker', index: 3 });
    expect(funItem(PROP_BASE + 4, PHRASES.length)).toEqual({ kind: 'prop', index: 4 });
    expect(funItem(EMOTE_COUNT, PHRASES.length)).toBeNull();
  });

  it('名场面：炸了对方、头游、双下；炸自己人、领出的炸弹、普通出牌不算', () => {
    const bomb = play('♠9 ♥9 ♣9 ♦9');
    expect(momentOf({ type: 'play', seat: 1, play: bomb, left: 10 }, 0, 3)).toEqual({ kind: 'moment', moment: 'bomb', winners: [1, 3], losers: [0], hand: 3 });
    expect(momentOf({ type: 'play', seat: 1, play: bomb, left: 10 }, 3, 3)).toBeNull();
    expect(momentOf({ type: 'play', seat: 1, play: bomb, left: 10 }, -1, 3)).toBeNull();
    expect(momentOf({ type: 'play', seat: 1, play: play('♠K'), left: 10 }, 0, 3)).toBeNull();
    expect(momentOf({ type: 'finish', seat: 2, place: 1 }, -1, 3)).toEqual({ kind: 'moment', moment: 'first-out', winners: [2, 0], losers: [3, 1], hand: 3 });
    expect(momentOf({ type: 'finish', seat: 2, place: 2 }, -1, 3)).toBeNull();
    const r: DealResult = { dealNo: 4, order: [2, 0, 1, 3], winnerTeam: 0, up: 3, doubleDown: true, levelsBefore: [2, 2], levelsAfter: [5, 2], aFailedTeam: -1, aResetTeam: -1 };
    expect(dealMoment(r)).toEqual({ kind: 'moment', moment: 'double-down', winners: [2, 0], losers: [1, 3], hand: 4 });
    expect(dealMoment({ ...r, doubleDown: false })).toBeNull();
  });

  it('压了谁：这一手之前最近一手有牌的', () => {
    const b = play('♠9 ♥9 ♣9 ♦9');
    expect(victimOf([{ seat: 3, play: b }, { seat: 0, play: null }, { seat: 1, play: b }])).toBe(3);
    expect(victimOf([{ seat: 1, play: b }])).toBe(-1);
  });

  it('房间里的电脑：只算真电脑座位，带上性格；真人座位不算', () => {
    const s = guandanRoom.begin(testKey(1), guandanRoom.rulesVersion, { opts: undefined, seats: ['human', 'ai', 'human', 'ai'] });
    const bots = funBots(s);
    expect(bots.map((b) => b.seat)).toEqual([1, 3]);
    for (const b of bots) expect(['rowdy', 'normal', 'cool']).toContain(b.temper);
  });

  it('电脑的台词是掼蛋的说法：六种情绪都有，只说牌局', () => {
    for (const lines of Object.values(MOOD_LINES)) {
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const t of lines) expect(t).not.toMatch(/妈|爹|丑|胖|蠢|傻|笨|男|女|省/);
    }
    expect(Object.values(MOOD_LINES).flat().some((t) => /炸|头游|贡|接风|双下/.test(t))).toBe(true);
  });

  it('单机催人：想够 8 秒、有爱闹的电脑才扔，一手最多判一次', () => {
    const bots = [{ seat: 1, temper: 'normal' as const }, { seat: 3, temper: 'rowdy' as const }];
    const st = { key: '' };
    expect(slowUrge(st, '1:5', URGE_AFTER_MS - 1, bots, () => 0)).toBeNull();
    expect(slowUrge(st, '1:5', URGE_AFTER_MS, bots, () => 0)).toBe(3);
    expect(slowUrge(st, '1:5', URGE_AFTER_MS * 3, bots, () => 0)).toBeNull();
    // 这一手没抽中也算判过
    expect(slowUrge(st, '1:6', URGE_AFTER_MS, bots, () => URGE_P)).toBeNull();
    expect(slowUrge(st, '1:6', URGE_AFTER_MS * 2, bots, () => 0)).toBeNull();
    // 没有爱闹的电脑不催
    expect(slowUrge({ key: '' }, '1:7', URGE_AFTER_MS, [{ seat: 2, temper: 'cool' }], () => 0)).toBeNull();
  });
});
