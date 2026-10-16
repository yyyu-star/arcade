/** 电脑的互动（0.6.0，DESIGN.md 13.5）：被招惹时按性格回、冷却、催人、一手打完主动来一下；嘲讽只用短语表里的（只说牌局） */
import { PROPS, STICKERS } from 'arcade-kit/fun';
import { describe, expect, it } from 'vitest';
import { Banter, emoteOf, pokeOf, PROP_ORDER, SEAT_GAP_MS, STICKER_ORDER, TABLE_GAP_MS, type Out } from '../src/fun/banter.ts';
import { TAUNTS } from '../src/fun/taunts.ts';
import type { HandResult, LogEntry } from '../src/core/table.ts';
import { EMOTE_COUNT, PROP_BASE, STICKER_BASE } from '../src/room/rules.ts';

/** 带种子的伪随机（测试里换掉 Math.random，可复现） */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** 时间每问一次往后走 step 毫秒 */
const clock = (step: number): (() => number) => {
  let t = 0;
  return () => (t += step);
};

const ABIAO = 1;
const MANMAN = 3;
const HUZI = 6;
const LAOYING = 7;

const valid = (o: Out): void => {
  if ('taunt' in o) expect(TAUNTS[o.taunt]).toBeTruthy();
  if ('sticker' in o) expect(STICKERS).toContain(o.sticker);
  if ('prop' in o) expect(PROPS).toContain(o.prop);
  if ('say' in o) expect([...o.say].length).toBeLessThanOrEqual(12);
};

/** 每种性格被扔番茄 n 次：回怼（扔回来、点名嘲讽）、认怂、不理各占多少 */
function temper(persona: number, n = 3000): { back: number; meek: number; quiet: number } {
  const b = new Banter(lcg(persona + 1), clock(SEAT_GAP_MS));
  const c = { back: 0, meek: 0, quiet: 0 };
  for (let i = 0; i < n; i++) {
    const o = b.react({ seat: 2, persona }, 0, { prop: 'tomato' });
    if (!o) c.quiet++;
    else {
      valid(o);
      if ('prop' in o || 'taunt' in o) {
        expect(o.to).toBe(0);
        c.back++;
      } else if ('sticker' in o && (o.sticker === 'sweat' || o.sticker === 'cry')) c.meek++;
      else if ('say' in o && o.say.endsWith('…')) c.meek++;
      else c.quiet++;
    }
  }
  return c;
}

describe('电脑的互动', () => {
  it('表情、道具的顺序和 kit 的一样（房间的代码不能引 kit/fun，抄了一份）；换成的编号都在房间的表里', () => {
    expect(STICKER_ORDER).toEqual(STICKERS);
    expect(PROP_ORDER).toEqual(PROPS);
    expect(emoteOf({ sticker: 'cool' })).toEqual({ id: STICKER_BASE + STICKERS.indexOf('cool') });
    expect(emoteOf({ prop: 'cheers', to: 2 })).toEqual({ id: PROP_BASE + PROPS.indexOf('cheers'), to: 2 });
    expect(emoteOf({ taunt: 3 })).toEqual({ id: 3 });
    expect(PROP_BASE + PROPS.length).toBe(EMOTE_COUNT);
  });

  it('房间转发的编号换回真人做了什么（和 emoteOf 对得上）；房间里的电脑不说自己的话，回的都能发成编号', () => {
    for (let id = 0; id < EMOTE_COUNT; id++) {
      const p = pokeOf(id)!;
      expect(p).not.toBeNull();
      expect(emoteOf('prop' in p ? { prop: p.prop, to: 0 } : p).id).toBe(id);
    }
    expect(pokeOf(EMOTE_COUNT)).toBeNull();
    expect(pokeOf(-1)).toBeNull();
    for (const persona of [0, 2, 3, 7, 9]) {
      const b = new Banter(lcg(persona), clock(SEAT_GAP_MS), false);
      for (let i = 0; i < 400; i++) {
        const o = b.react({ seat: 1, persona }, 0, i % 3 ? { prop: 'egg' } : { prop: 'rose' });
        if (o) expect('say' in o).toBe(false);
      }
    }
  });

  it('一手打完（只看公开的操作记录和结果）：电脑赢了真人 ≥ 20 个大盲，偶尔点名这个真人；小池子不来', () => {
    // 0 号真人、1 号电脑：0 号加到 600、1 号跟，翻牌后 1 号下 1,000、0 号跟，1 号赢 3,200（盲注 10/20）
    const seats = [
      { owner: 'player', persona: 0 },
      { owner: 'house', persona: 8 },
    ];
    const log: LogEntry[] = [
      { seat: 0, act: 'sb', amount: 10 },
      { seat: 1, act: 'bb', amount: 20 },
      { seat: 0, act: 'raise', amount: 600 },
      { seat: 1, act: 'call', amount: 580 },
      { seat: -1, act: 'flop', amount: 0 },
      { seat: 1, act: 'bet', amount: 1000 },
      { seat: 0, act: 'call', amount: 1000 },
    ];
    const r = { handNo: 1, board: [], shown: [], pots: [{ amount: 3200, winners: [{ seat: 1, won: 3200 }] }], uncalled: null, byFold: false } as unknown as HandResult;
    let n = 0;
    for (let k = 0; k < 200; k++) {
      const b = new Banter(lcg(k), clock(SEAT_GAP_MS));
      const a = b.afterHand(seats, 20, r, log);
      if (!a) continue;
      n++;
      expect(a.seat).toBe(1);
      valid(a.out);
      if ('to' in a.out && a.out.to !== undefined) expect(a.out.to).toBe(0);
    }
    expect(n).toBeGreaterThan(40);
    // 只输了盲注：不来
    const small = { ...r, pots: [{ amount: 30, winners: [{ seat: 1, won: 30 }] }] } as unknown as HandResult;
    for (let k = 0; k < 50; k++) expect(new Banter(lcg(k), clock(SEAT_GAP_MS)).afterHand(seats, 20, small, log.slice(0, 2))).toBeNull();
  });

  it('被扔东西按性格回：虎子、阿飙爱扔回来，慢慢多认怂，老鹰多不理；回的都在表情、短语、道具表里', () => {
    const huzi = temper(HUZI);
    const abiao = temper(ABIAO);
    const manman = temper(MANMAN);
    const laoying = temper(LAOYING);
    console.log(`回怼 / 认怂 / 不理：虎子 ${JSON.stringify(huzi)}、阿飙 ${JSON.stringify(abiao)}、慢慢 ${JSON.stringify(manman)}、老鹰 ${JSON.stringify(laoying)}`);
    expect(huzi.back).toBeGreaterThan(manman.back * 4);
    expect(abiao.back).toBeGreaterThan(laoying.back * 1.5);
    expect(manman.meek).toBeGreaterThan(huzi.meek * 2);
    expect(laoying.quiet).toBeGreaterThan(huzi.quiet);
  });

  it('同一个电脑不连着回：冷却里不回，过了冷却才可能回', () => {
    let t = 0;
    const b = new Banter(() => 0, () => t);
    expect(b.react({ seat: 3, persona: HUZI }, 0, { prop: 'egg' })).not.toBeNull();
    t += SEAT_GAP_MS - 1;
    expect(b.react({ seat: 3, persona: HUZI }, 0, { prop: 'egg' })).toBeNull();
    // 别的电脑不受影响
    expect(b.react({ seat: 4, persona: HUZI }, 0, { prop: 'egg' })).not.toBeNull();
    t += 1;
    expect(b.react({ seat: 3, persona: HUZI }, 0, { prop: 'egg' })).not.toBeNull();
  });

  it('送花、点赞、"好牌，服了"回的是谢（不回怼）', () => {
    const b = new Banter(lcg(7), clock(SEAT_GAP_MS));
    for (let i = 0; i < 500; i++) {
      const o = b.react({ seat: 1, persona: HUZI }, 0, i % 2 ? { prop: 'rose' } : { taunt: TAUNTS.indexOf('好牌，服了') });
      if (!o) continue;
      valid(o);
      if ('prop' in o) expect(o.prop).toBe('cheers');
      expect('taunt' in o).toBe(false);
    }
  });

  it('催人：挑桌上的电脑（不挑被催的），整桌有冷却；话多性子急的催得多', () => {
    let t = 0;
    const b = new Banter(lcg(3), () => t);
    const house = [
      { seat: 1, persona: MANMAN },
      { seat: 2, persona: HUZI },
      { seat: 3, persona: LAOYING },
    ];
    const by = new Map<number, number>();
    for (let i = 0; i < 600; i++) {
      t += Math.max(SEAT_GAP_MS, TABLE_GAP_MS);
      const u = b.urge(0, house);
      expect(u).not.toBeNull();
      valid(u!.out);
      expect(u!.out).toMatchObject({ to: 0 });
      by.set(u!.from, (by.get(u!.from) ?? 0) + 1);
    }
    // 慢慢从来不催
    expect(by.get(1) ?? 0).toBe(0);
    expect(by.get(2)!).toBeGreaterThan(by.get(3)! * 3);
    expect(b.urge(0, house)).toBeNull();
  });

  it('一手打完：赢了点名输家、输了点名赢家；整桌有冷却', () => {
    let t = 0;
    const b = new Banter(lcg(11), () => t);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      t += SEAT_GAP_MS;
      const o = b.after({ seat: 2, persona: 8 }, i % 2 === 0, 0);
      if (!o) continue;
      valid(o);
      if ('taunt' in o || 'prop' in o) expect(o.to).toBe(0);
      n++;
      expect(b.after({ seat: 4, persona: 8 }, true, 0)).toBeNull();
    }
    expect(n).toBeGreaterThan(100);
  });

  it('输多了：爱赌的更冲，胆小的更怂（这一场的情绪）', () => {
    const run = (persona: number, lose: boolean): number => {
      const b = new Banter(lcg(5), clock(SEAT_GAP_MS));
      if (lose) for (let i = 0; i < 5; i++) b.result(2, -40);
      let back = 0;
      for (let i = 0; i < 3000; i++) {
        const o = b.react({ seat: 2, persona }, 0, { prop: 'egg' });
        if (o && ('prop' in o || 'taunt' in o)) back++;
      }
      return back;
    };
    expect(run(HUZI, true)).toBeGreaterThan(run(HUZI, false));
    expect(run(MANMAN, true)).toBeLessThanOrEqual(run(MANMAN, false));
  });
});
