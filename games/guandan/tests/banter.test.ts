import { PROPS, STICKERS } from 'arcade-kit/fun';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, interpret, parseCards, type DealResult, type GameEvent, type PlayRecord } from '../src/core/index.ts';
import { COOLDOWN_MS, COUNTER_MAX, COUNTER_WINDOW_MS, GAP_MS, HAND_MAX, MIN_OUT_MS, banterOnDeal, banterOnEmote, banterOnEvent, banterOnSlow, counterOf, funMult, newBanter, victimOf, type BanterBot, type BanterOut } from '../src/net/banter.ts';
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
/** 可复现的随机数：mulberry32 */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const lcg = mulberry32;
const always = () => 0;
/** 按脚本给随机数，用完后一直给最后一个 */
const script = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)]!;
};
const stk = (s: string) => STICKER_BASE + STICKERS.indexOf(s as never);
const prp = (s: string) => PROP_BASE + PROPS.indexOf(s as never);
const N = 2000;
const one = (persona: BanterBot['persona'], seat = 1): BanterBot[] => [{ seat, persona, form: 0, tilt: 0 }];
const rate = (n: number, f: (i: number) => boolean) => Array.from({ length: n }, (_, i) => f(i)).filter(Boolean).length / n;

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
    // 脚本：回应(0)、不回扔(0.9)、延迟、挑选；送花回比心
    const out = banterOnEmote(newBanter(), 0, prp('rose'), 2, BOTS, 0, script(0, 0.9, 0.5, 0));
    expect(out).toHaveLength(1);
    expect(STICKERS[out[0]!.id - STICKER_BASE]).toBe('love');
  });

  it('炸弹压了对方：被炸的电脑冲炸的人去，炸的一方乐一下；冷却期内同一个电脑不再发，别的电脑也要隔一会儿', () => {
    const st = newBanter();
    const e: GameEvent = { type: 'play', seat: 1, play: BOMB, left: 10 };
    // 真人 0 被电脑 1 炸：1 号（老张）和队友 3 号（阿强）都是赢家，随机数恒 0 都会乐，最多两条
    const a = banterOnEvent(st, e, 0, BOTS, [0], 1000, always);
    expect(a.map((o) => o.from).sort()).toEqual([1, 3]);
    a.forEach(valid);
    expect(new Set(a.map((o) => o.delay)).size).toBe(a.length);
    expect(banterOnEvent(newBanter(), e, 0, BOTS, [0], 1000, always).length).toBeLessThanOrEqual(2);
    // 刚说过：9 秒内同一个电脑不再发
    expect(banterOnEvent(st, { type: 'dealStart', dealNo: 2, level: 2, declarer: 0, levels: [2, 2] }, -1, BOTS, [0], 1000, always)).toEqual([]);
    expect(banterOnEvent(st, e, 0, BOTS, [0], 1000 + COOLDOWN_MS - 1, always)).toEqual([]);
    // 小美（2 号）没发过，但离上一条不到 GAP_MS
    const e2: GameEvent = { type: 'play', seat: 2, play: BOMB, left: 9 };
    expect(banterOnEvent(st, e2, 1, BOTS, [0], 1000 + GAP_MS - 1, always)).toEqual([]);
  });

  it('真人头游：电脑搭档先捧一下；不是炸弹、不是头游的事件不说话', () => {
    const out = banterOnEvent(newBanter(), { type: 'finish', seat: 0, place: 1 }, -1, BOTS, [0], 0, always);
    expect(out[0]?.from).toBe(2);
    out.forEach(valid);
    expect(banterOnEvent(newBanter(), { type: 'play', seat: 1, play: play('S3'), left: 20 }, 0, BOTS, [0], 0, always)).toEqual([]);
    expect(banterOnEvent(newBanter(), { type: 'finish', seat: 1, place: 2 }, -1, BOTS, [0], 0, always)).toEqual([]);
  });

  it('性格倍数：爱闹 1.5、普通 1、高冷 0.3', () => {
    expect([funMult('aqiang'), funMult('laozhang'), funMult('xiaomei')]).toEqual([1.5, 1, 0.3]);
  });

  it('被扔东西：回应率 60%×性格（爱闹 90%、普通 60%、高冷 18%）', () => {
    const resp = (persona: BanterBot['persona']) => {
      const r = mulberry32(11);
      return rate(N, () => banterOnEmote(newBanter(), 0, prp('tomato'), 1, one(persona), 0, r).length > 0);
    };
    expect(Math.abs(resp('laozhang') - 0.6)).toBeLessThan(0.04);
    expect(Math.abs(resp('aqiang') - 0.9)).toBeLessThan(0.04);
    expect(Math.abs(resp('xiaomei') - 0.18)).toBeLessThan(0.04);
    // 没对象、对象不是电脑、不是冲电脑来的东西，都不回
    expect(banterOnEmote(newBanter(), 0, taunt('就这？'), undefined, BOTS, 0, always)).toEqual([]);
    expect(banterOnEmote(newBanter(), 0, prp('tomato'), 0, BOTS, 0, always)).toEqual([]);
    expect(banterOnEmote(newBanter(), 0, stk('lol'), 1, BOTS, 0, always)).toEqual([]);
  });

  it('回应里 25% 是回扔，其余是表情或一句话；回应的延迟在 0.8–2 秒', () => {
    const r = mulberry32(5);
    let n = 0;
    let c = 0;
    for (let i = 0; i < N * 2; i++) {
      const out = banterOnEmote(newBanter(), 0, prp('tomato'), 1, one('aqiang'), 0, r);
      if (!out.length) continue;
      valid(out[0]!);
      expect(out[0]!.delay).toBeGreaterThanOrEqual(800);
      expect(out[0]!.delay).toBeLessThanOrEqual(2000);
      n++;
      if (out[0]!.id >= PROP_BASE) {
        c++;
        expect(out[0]!.to).toBe(0);
      }
    }
    expect(Math.abs(c / n - 0.25)).toBeLessThan(0.03);
    // 回应是表情（生气/冒汗）或短语，送花回比心
    const sad = banterOnEmote(newBanter(), 0, prp('egg'), 1, one('laozhang'), 0, script(0, 0.9, 0.5, 0));
    expect([stk('angry'), stk('sweat')]).toContain(sad[0]!.id);
    expect(banterOnEmote(newBanter(), 0, taunt('就这？'), 1, one('laozhang'), 0, script(0, 0.9, 0.5, 0.4))[0]!.id).toBeGreaterThanOrEqual(0);
  });

  it('回扔对照表：番茄回番茄、鸡蛋回拖鞋、臭鸡蛋/拖鞋/炸弹回同类，送花回花，嘲讽回番茄', () => {
    const pairs: [string, string][] = [['tomato', 'tomato'], ['egg', 'slipper'], ['stinkyEgg', 'stinkyEgg'], ['slipper', 'slipper'], ['bomb', 'bomb'], ['rose', 'rose'], ['like', 'like'], ['cheers', 'cheers']];
    for (const [a, b] of pairs) {
      expect(counterOf(prp(a))).toBe(prp(b));
      // 回应(0)、延迟(0.5)、回扔(0.1<0.25)
      const out = banterOnEmote(newBanter(), 0, prp(a), 1, one('aqiang'), 0, script(0, 0.5, 0.1));
      expect(out[0]).toMatchObject({ from: 1, id: prp(b), to: 0 });
    }
    expect(banterOnEmote(newBanter(), 0, taunt('就这？'), 1, one('aqiang'), 0, script(0, 0.5, 0.1))[0]).toMatchObject({ id: prp('tomato'), to: 0 });
  });

  it('同一个电脑 20 秒内最多回扔 2 次，超了退回表情，窗口过了又能扔；每个电脑 1.5 秒内不连发', () => {
    const st = newBanter();
    const bots = one('aqiang');
    const go = (now: number) => banterOnEmote(st, 0, prp('tomato'), 1, bots, now, script(0, 0.5, 0.1));
    expect(go(0)[0]!.id).toBe(prp('tomato'));
    expect(go(MIN_OUT_MS)[0]!.id).toBe(prp('tomato'));
    expect(COUNTER_MAX).toBe(2);
    const third = go(2 * MIN_OUT_MS);
    expect(third[0]!.id).toBeGreaterThanOrEqual(STICKER_BASE);
    expect(third[0]!.id).toBeLessThan(PROP_BASE);
    // 第一次扔的时间滑出窗口
    expect(go(COUNTER_WINDOW_MS + 1)[0]!.id).toBe(prp('tomato'));
    // 1.5 秒最小间隔：刚输出过的不回
    expect(go(COUNTER_WINDOW_MS + 1 + MIN_OUT_MS - 1)).toEqual([]);
    // 别的电脑不受影响
    expect(banterOnEmote(st, 0, prp('tomato'), 3, [...bots, ...one('aqiang', 3)], COUNTER_WINDOW_MS + 2, always)).toHaveLength(1);
  });

  it('回敬不看 9 秒冷却，也不占主动互动的冷却和每副次数', () => {
    const st = newBanter();
    const bots = one('aqiang');
    expect(banterOnEmote(st, 0, prp('tomato'), 1, bots, 0, always)).toHaveLength(1);
    expect(banterOnEmote(st, 0, prp('tomato'), 1, bots, MIN_OUT_MS, always)).toHaveLength(1);
    expect(st.n).toBe(0);
    expect(st.lastAny).toBe(-Infinity);
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

  it('名场面·炸弹：被炸的电脑冲炸的人去 40%×性格，炸的一方乐一下 30%×性格', () => {
    const e: GameEvent = { type: 'play', seat: 0, play: BOMB, left: 10 };
    // 真人 0 炸了电脑 1（只留这一个电脑：被炸的一方）
    for (const [persona, p] of [['laozhang', 0.4], ['aqiang', 0.6], ['xiaomei', 0.12]] as const) {
      const r = mulberry32(21);
      let got = 0;
      let n = 0;
      for (let i = 0; i < N; i++) {
        const out = banterOnEvent(newBanter(), e, 1, one(persona, 1), [0], 0, r);
        if (out.length) {
          got++;
          n += out.length;
          valid(out[0]!);
          expect(out[0]!.from).toBe(1);
          if (out[0]!.id >= PROP_BASE) expect(out[0]!.to).toBe(0);
        }
      }
      expect(n).toBe(got);
      expect(Math.abs(got / N - p), persona).toBeLessThan(0.04);
    }
    // 电脑 1 炸了真人 0：1 号赢（乐，不指对象），按 30%×性格
    for (const [persona, p] of [['laozhang', 0.3], ['aqiang', 0.45], ['xiaomei', 0.09]] as const) {
      const r = mulberry32(22);
      let got = 0;
      for (let i = 0; i < N; i++) {
        const out = banterOnEvent(newBanter(), { type: 'play', seat: 1, play: BOMB, left: 9 }, 0, one(persona, 1), [0], 0, r);
        if (out.length) {
          got++;
          expect(out[0]!.to).toBeUndefined();
          expect([stk('smug'), stk('cool'), stk('lol')]).toContain(out[0]!.id);
        }
      }
      expect(Math.abs(got / N - p), persona).toBeLessThan(0.04);
    }
    // 自己人的炸弹、领出的不算
    expect(banterOnEvent(newBanter(), { type: 'play', seat: 0, play: BOMB, left: 10 }, 2, BOTS, [0], 0, always)).toEqual([]);
    expect(banterOnEvent(newBanter(), { type: 'play', seat: 0, play: BOMB, left: 10 }, -1, BOTS, [0], 0, always)).toEqual([]);
  });

  it('名场面·头游：对面电脑冲头游的真人去，头游一方的电脑乐一下', () => {
    // 真人 1... 这里 0 号真人头游：对手是电脑 1、3
    const out = banterOnEvent(newBanter(), { type: 'finish', seat: 0, place: 1 }, -1, [BOTS[0]!, BOTS[2]!], [0], 0, always);
    expect(out.map((o) => o.from).sort()).toEqual([1, 3]);
    out.forEach((o) => {
      valid(o);
      if (o.to !== undefined) expect(o.to).toBe(0);
    });
  });

  it('每一副电脑主动互动最多 2 次（dealStart 清零；banterOnDeal 收尾也清零）', () => {
    const st = newBanter();
    const all: BanterBot[] = [...BOTS, { seat: 0, persona: 'aqiang', form: 0, tilt: 0 }];
    banterOnEvent(st, { type: 'dealStart', dealNo: 1, level: 2, declarer: 0, levels: [2, 2] }, -1, all, [], 0, always);
    const a = banterOnEvent(st, { type: 'play', seat: 0, play: BOMB, left: 10 }, 1, all, [], 0, always);
    expect(a.length).toBe(HAND_MAX);
    expect(st.n).toBe(HAND_MAX);
    // 过了冷却也不再发
    expect(banterOnEvent(st, { type: 'finish', seat: 1, place: 1 }, -1, all, [], 20000, always)).toEqual([]);
    expect(banterOnSlow(st, 0, 60000, 'k', BOTS, 40000, always)).toEqual([]);
    // 新一副
    banterOnEvent(st, { type: 'dealStart', dealNo: 2, level: 2, declarer: 0, levels: [2, 2] }, -1, all, [], 60000, always);
    expect(st.n).toBe(0);
    expect(banterOnEvent(st, { type: 'finish', seat: 1, place: 1 }, -1, all, [], 60000, always).length).toBeGreaterThan(0);
  });

  it('催人也占这一副的次数；一次只催一手，高冷的多半不催', () => {
    const st = newBanter();
    st.n = HAND_MAX - 1;
    expect(banterOnSlow(st, 0, 30000, 'a', BOTS, 0, always)).toHaveLength(1);
    expect(st.n).toBe(HAND_MAX);
    expect(banterOnSlow(st, 0, 30000, 'b', BOTS, 99999, always)).toEqual([]);
    const r = mulberry32(3);
    const urged = rate(N, (i) => banterOnSlow(newBanter(), 0, 60000, 'k' + i, one('xiaomei'), 0, r).length > 0);
    expect(Math.abs(urged - 0.3)).toBeLessThan(0.04);
  });

  it('双下：被双下的电脑冲赢家去（有真人挑真人），赢的一方乐；最多两条；收尾清零', () => {
    const r = { dealNo: 1, order: [1, 3, 0, 2], winnerTeam: 1, up: 3, doubleDown: true, levelsBefore: [2, 2], levelsAfter: [2, 5], aFailed: -1 } as unknown as DealResult;
    for (let k = 0; k < 50; k++) {
      const st = newBanter();
      st.n = 1;
      const out = banterOnDeal(st, r, BOTS, 0, lcg(k));
      expect(out.length).toBeLessThanOrEqual(1);
      out.forEach(valid);
      expect(st.n).toBe(0);
    }
    // 真人 2 号在赢的一队...这里 0、2 号是输家（电脑 2 号小美），赢家 1、3；真人 3 优先
    const lose = banterOnDeal(newBanter(), r, [{ seat: 2, persona: 'aqiang', form: 0, tilt: 0 }], 0, script(0, 0.99, 0.99, 0.99, 0.99), [3]);
    expect(lose).toHaveLength(1);
    expect(lose[0]!.from).toBe(2);
    if (lose[0]!.id >= PROP_BASE) expect(lose[0]!.to).toBe(3);
    // 不指定真人时挑头游的 1 号
    const first = banterOnDeal(newBanter(), r, [{ seat: 2, persona: 'aqiang', form: 0, tilt: 0 }], 0, script(0, 0.1, 0.1, 0.1, 0.1))[0]!;
    expect(first.to).toBe(1);
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
