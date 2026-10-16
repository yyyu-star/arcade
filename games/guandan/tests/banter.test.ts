import { PROPS, STICKERS } from 'arcade-kit/fun';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, interpret, parseCards, type DealResult, type GameEvent, type PlayRecord } from '../src/core/index.ts';
import { COOLDOWN_MS, GAP_MS, banterOnDeal, banterOnEmote, banterOnEvent, banterOnSlow, newBanter, victimOf, type BanterBot, type BanterOut } from '../src/net/banter.ts';
import { banterBots, guandanRoom, testKey } from '../src/net/rules.ts';
import { EMOTE_COUNT, PROP_BASE, STICKER_BASE, TAUNT_BASE, emoteOf, taunt } from '../src/net/emotes.ts';
import { QUICK_PLAYS, bombOnBomb, dealHighlights, highlightText } from '../src/view/highlights.ts';

const play = (s: string) => interpret(parseCards(s), 2, DEFAULT_OPTIONS)[0]!;
const BOMB = play('S9 H9 D9 C9');
const BIG = play('S5 H5 D5 C5 S5');
const BOTS: BanterBot[] = [
  { seat: 1, persona: 'laozhang', form: 0, tilt: 0 },
  { seat: 2, persona: 'xiaomei', form: 0, tilt: 0 },
  { seat: 3, persona: 'aqiang', form: 0, tilt: 0 },
];
/** 可复现的随机数：线性同余 */
const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const always = () => 0;

/** 一条输出是不是合法：编号在表里，道具一定有对象，不对自己 */
function valid(o: BanterOut): void {
  expect(Number.isInteger(o.id) && o.id >= 0 && o.id < EMOTE_COUNT).toBe(true);
  if (o.id >= PROP_BASE) expect(o.to).toBeDefined();
  if (o.to !== undefined) expect(o.to).not.toBe(o.from);
  if (o.id < TAUNT_BASE || (o.id >= STICKER_BASE && o.id < PROP_BASE)) expect(o.to).toBeUndefined();
  expect(o.delay).toBeGreaterThan(0);
}

describe('电脑的互动（net/banter.ts）', () => {
  it('编号和 kit 的表情、道具列表同一个顺序（banter 自己抄了一份，不引 kit/fun）', () => {
    expect(emoteOf(STICKER_BASE + STICKERS.indexOf('angry'))).toEqual({ kind: 'sticker', index: STICKERS.indexOf('angry') });
    const st = newBanter();
    const out = banterOnEmote(st, 0, PROP_BASE + PROPS.indexOf('rose'), 2, BOTS, 0, always);
    expect(out).toHaveLength(1);
    expect(STICKERS[out[0]!.id - STICKER_BASE]).toBe('love');
  });

  it('电脑炸了别人：显摆，点名被炸的人；冷却期内同一个电脑不再发，别的电脑也要隔一会儿', () => {
    const st = newBanter();
    const e: GameEvent = { type: 'play', seat: 1, play: BOMB, left: 10 };
    const a = banterOnEvent(st, e, 0, BOTS, [0], 1000, always);
    expect(a).toHaveLength(1);
    expect(a[0]!.from).toBe(1);
    valid(a[0]!);
    expect(banterOnEvent(st, e, 0, BOTS, [0], 1000 + COOLDOWN_MS - 1, always)).toEqual([]);
    // 阿强（3 号）没发过，但离上一条不到 GAP_MS
    expect(banterOnEvent(st, { type: 'play', seat: 3, play: BIG, left: 9 }, 0, BOTS, [0], 1000 + GAP_MS - 1, always)).toEqual([]);
    expect(banterOnEvent(st, { type: 'play', seat: 3, play: BIG, left: 9 }, 0, BOTS, [0], 1000 + GAP_MS, always)).toHaveLength(1);
  });

  it('真人头游：电脑搭档捧一下；不是炸弹、不是头游的事件不说话', () => {
    const out = banterOnEvent(newBanter(), { type: 'finish', seat: 0, place: 1 }, -1, BOTS, [0], 0, always);
    expect(out[0]?.from).toBe(2);
    valid(out[0]!);
    expect(banterOnEvent(newBanter(), { type: 'play', seat: 1, play: play('S3'), left: 20 }, 0, BOTS, [0], 0, always)).toEqual([]);
    expect(banterOnEvent(newBanter(), { type: 'finish', seat: 1, place: 2 }, -1, BOTS, [0], 0, always)).toEqual([]);
  });

  it('被扔东西：阿强多半扔回去或回怼，小美多半装没看见；送花回客气的', () => {
    const rate = (seat: number, persona: BanterBot['persona']) => {
      const rand = lcg(seat * 7 + 1);
      let back = 0;
      let none = 0;
      for (let i = 0; i < 400; i++) {
        const out = banterOnEmote(newBanter(), 0, PROP_BASE + PROPS.indexOf('tomato'), seat, [{ seat, persona, form: 0, tilt: 0 }], 0, rand);
        if (out.length === 0) none++;
        else {
          valid(out[0]!);
          if (out[0]!.to === 0) back++;
        }
      }
      return { back: back / 400, none: none / 400 };
    };
    const aq = rate(3, 'aqiang');
    const xm = rate(2, 'xiaomei');
    expect(aq.back).toBeGreaterThan(0.55);
    expect(xm.none).toBeGreaterThan(0.45);
    expect(aq.back).toBeGreaterThan(xm.back + 0.3);
    // 不是冲电脑来的（没对象）不回
    expect(banterOnEmote(newBanter(), 0, taunt('就这？'), undefined, BOTS, 0, always)).toEqual([]);
  });

  it('真人想太久：最没耐心的阿强先催（对手催得冲），每一手只催一次；不到时间不催', () => {
    const st = newBanter();
    expect(banterOnSlow(st, 0, 5000, 'k1', BOTS, 0, always)).toEqual([]);
    const out = banterOnSlow(st, 0, 12000, 'k1', BOTS, 0, always);
    expect(out).toHaveLength(1);
    expect(out[0]!.from).toBe(3);
    expect(out[0]!.to).toBe(0);
    valid(out[0]!);
    expect(banterOnSlow(st, 0, 60000, 'k1', BOTS, 99999, always)).toEqual([]);
    // 只有队友小美在：客气地催，不点名
    const mate = banterOnSlow(newBanter(), 0, 30000, 'k2', [BOTS[1]!], 0, always);
    expect(mate[0]!.from).toBe(2);
    expect(emoteOf(mate[0]!.id)?.kind).toBe('phrase');
  });

  it('双下：一方庆祝或另一方认怂，最多一条；随便怎么随机，输出都合法', () => {
    const r = { dealNo: 1, order: [1, 3, 0, 2], winnerTeam: 1, up: 3, doubleDown: true, levelsBefore: [2, 2], levelsAfter: [2, 5], aFailed: -1 } as unknown as DealResult;
    for (let k = 0; k < 50; k++) {
      const out = banterOnDeal(newBanter(), r, BOTS, 0, lcg(k));
      expect(out.length).toBeLessThanOrEqual(1);
      out.forEach(valid);
    }
    expect(banterOnDeal(newBanter(), { ...r, doubleDown: false }, BOTS, 0, always)).toEqual([]);
  });

  it('电脑出牌（src/ai）不引互动、短语的任何东西：决策绝不读真人表情', () => {
    const files = import.meta.glob('../src/ai/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(3);
    for (const [f, src] of Object.entries(files)) expect(src, f).not.toMatch(/banter|emotes|taunt/);
  });
});

describe('好友房里的电脑互动（worker/room.ts 的 onStep / onEmote 用）', () => {
  it('只算真电脑的座位（真人和替掉线真人代打的不算），性格按真实座位；0.6.0 以前的局没有 humans，不互动', () => {
    const s = guandanRoom.begin(testKey(7), guandanRoom.rulesVersion, { opts: undefined, seats: ['human', 'ai', 'human', 'ai'] });
    expect(banterBots(s).map((b) => [b.seat, b.persona])).toEqual([
      [1, 'laozhang'],
      [3, 'aqiang'],
    ]);
    for (const b of banterBots(s)) expect(Math.abs(b.form)).toBeLessThanOrEqual(1);
    expect(banterBots({ ...s, humans: undefined })).toEqual([]);
  });

  it('victimOf：这一手之前最近一手有牌的是谁（"不要"跳过）', () => {
    const h = (seat: number, p: boolean) => ({ seat, play: p ? {} : null });
    expect(victimOf([h(1, true), h(2, false), h(3, false), h(0, true)])).toBe(1);
    expect(victimOf([h(0, true)])).toBe(-1);
  });
});

describe('名场面（view/highlights.ts）', () => {
  const rec = (seat: number, p: string | null): PlayRecord => ({ seat, play: p === null ? null : play(p) });

  it('炸上炸：上一手是对方的炸弹；自己人、普通牌、隔了一墩的领出都不算', () => {
    expect(bombOnBomb([rec(1, 'S9 H9 D9 C9'), rec(2, null)], 3, BIG)).toBe(false);
    expect(bombOnBomb([rec(1, 'S9 H9 D9 C9'), rec(2, null)], 2, BIG)).toBe(true);
    expect(bombOnBomb([rec(1, 'S3')], 2, BIG)).toBe(false);
    expect(bombOnBomb([rec(1, 'S9 H9 D9 C9')], 2, play('SK'))).toBe(false);
  });

  it('一副结束：落后 3 级打出双下最精彩；还有天王炸、一副三炸、几手出完', () => {
    const history = [rec(0, 'S3'), rec(1, 'S9 H9 D9 C9'), rec(2, 'S5 H5 D5 C5 S5'), rec(0, 'S7 H7 D7 C7'), rec(0, 'S8 H8 D8 C8'), rec(0, 'SQ HQ DQ CQ'), rec(2, 'SJ SJ BJ BJ')];
    const r = { dealNo: 3, order: [0, 2, 1, 3], winnerTeam: 0, up: 3, doubleDown: true, levelsBefore: [2, 6], levelsAfter: [5, 6], aFailed: -1 } as unknown as DealResult;
    const hl = dealHighlights(r, history);
    expect(hl[0]).toEqual({ kind: 'comeback', seat: 0, n: 4 });
    expect(hl.map((h) => h.kind)).toContain('bombOnBomb');
    expect(hl.find((h) => h.kind === 'bombs3')).toEqual({ kind: 'bombs3', seat: 0, n: 3 });
    expect(hl.map((h) => h.kind)).not.toContain('doubleDown');
    expect(hl.find((h) => h.kind === 'quick')!.n).toBeLessThanOrEqual(QUICK_PLAYS);
    expect(highlightText(hl[0]!, (s) => ['你', '老张', '小美', '阿强'][s]!)).toBe('落后 4 级，你 这边打出双下');
  });
});
