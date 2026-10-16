/** 电脑的互动（game/banter.ts，DESIGN.md 第 6 节）：只发合法的编号和对象、按性格回、有冷却、同一个种子同一个结果；名场面认得对 */
import { describe, expect, test } from 'vitest';
import { PERSONAS } from '../src/ai/personas.ts';
import { Banter, COOL_MS, highlightsOf, propId, stickerId, type Act, type Cast, type Moment } from '../src/game/banter.ts';
import { EMOTES, PHRASE_COUNT } from '../src/game/emotes.ts';
import type { XzEvent } from '../src/core/variants/sichuan-xuezhan/rules.ts';

const P = (name: string) => PERSONAS.find((p) => p.name === name)!;
/** 0 号真人，另外三个电脑 */
const cast = (a: string, b: string, c: string): Cast => [null, P(a), P(b), P(c)];

function many(seed: number, c: Cast): Act[] {
  const b = new Banter(seed);
  const out: Act[] = [];
  let now = 0;
  const ms: Moment[] = [
    { k: 'hu', seat: 1, from: 0, fan: 3 },
    { k: 'hu', seat: 0, from: 2, fan: 2 },
    { k: 'kan', seat: 3 },
    { k: 'pon', seat: 1 },
    { k: 'round', net: [-500, 900, -300, -100], chips: [100, 4_000, 2_000, 2_000], share: 2_000 },
  ];
  for (let i = 0; i < 400; i++) {
    now += 3_000;
    out.push(...b.moments(c, [ms[i % ms.length]!], now));
    const r = b.reply(c, 0, [propId('tomato'), propId('rose'), 3, stickerId('doge')][i % 4]!, 1 + (i % 3), now);
    if (r) out.push(r);
    const u = b.urge(c, 0, now);
    if (u) out.push(u);
  }
  return out;
}

describe('电脑的互动', () => {
  test('只有电脑发，编号、对象都合法', () => {
    const acts = many(7, cast('幺妹儿', '兔头哥', '板凳儿'));
    expect(acts.length).toBeGreaterThan(50);
    for (const a of acts) {
      expect([1, 2, 3]).toContain(a.seat);
      expect(Number.isInteger(a.id) && a.id >= 0 && a.id < EMOTES).toBe(true);
      if (a.to !== undefined) expect(a.to !== a.seat && a.to >= 0 && a.to < 4).toBe(true);
      // 口吻只挂在短语上
      if (a.voice) expect(a.id).toBeLessThan(PHRASE_COUNT);
    }
  });

  test('同一个种子同一个结果，换种子不一样', () => {
    const c = cast('熊猫哥', '盖碗儿', '火锅婆婆');
    expect(many(1, c)).toEqual(many(1, c));
    expect(many(1, c)).not.toEqual(many(2, c));
  });

  test('每个电脑有冷却', () => {
    const c = cast('幺妹儿', '熊猫哥', '兔头哥');
    const b = new Banter(3);
    const at = new Map<number, number>();
    let now = 0;
    for (let i = 0; i < 300; i++) {
      now += 1_000;
      for (const a of b.moments(c, [{ k: 'hu', seat: 1 + (i % 3), from: 0, fan: 2 }, { k: 'kan', seat: 1 + ((i + 1) % 3) }], now)) {
        const t = at.get(a.seat);
        if (t !== undefined) expect(now - t).toBeGreaterThanOrEqual(COOL_MS);
        at.set(a.seat, now);
      }
    }
    expect(at.size).toBe(3);
  });

  test('被扔番茄：脾气大的扔回来，新手认怂，话少的常装没看见；对大家说的不回', () => {
    const tally = (name: string) => {
      const out = { back: 0, meek: 0, none: 0 };
      for (let seed = 0; seed < 300; seed++) {
        const r = new Banter(seed).reply([null, P(name), null, null], 0, propId('tomato'), 1, 0);
        if (!r) out.none++;
        else if (r.id === propId('tomato') && r.to === 0) out.back++;
        else if (r.id === stickerId('cry') || r.id === stickerId('sweat')) out.meek++;
      }
      return out;
    };
    expect(tally('兔头哥').back).toBeGreaterThan(200);
    expect(tally('板凳儿').meek).toBeGreaterThan(150);
    expect(tally('盖碗儿').none).toBeGreaterThan(tally('兔头哥').none);
    expect(new Banter(1).reply(cast('兔头哥', '兔头哥', '兔头哥'), 0, propId('tomato'), undefined, 0)).toBeNull();
    // 电脑发的不再招电脑回
    expect(new Banter(1).reply(cast('兔头哥', '兔头哥', '兔头哥'), 2, propId('tomato'), 1, 0)).toBeNull();
  });

  test('单机催人：冲着在想的真人，急性子扔炸弹', () => {
    const a = new Banter(5).urge(cast('盖碗儿', '兔头哥', '板凳儿'), 0, 0)!;
    expect(a.to).toBe(0);
    expect([2, 3]).toContain(a.seat);
    expect([7, propId('bomb')]).toContain(a.id);
  });
});

describe('名场面', () => {
  const hu = (seat: number, from: number | null, ids: string[], fan = 2): XzEvent =>
    ({ e: 'hu', seat, from, tile: 0, fan, items: ids.map((id) => ({ id, fan: 1 })), rob: false }) as unknown as XzEvent;

  test('一炮多响、杠上开花、封顶', () => {
    expect(highlightsOf([hu(1, 0, ['ping']), hu(2, 0, ['ping'])], 3, 4).map((h) => [h.id, h.seat, h.round])).toEqual([['multi2', 0, 3]]);
    expect(highlightsOf([hu(1, 0, ['ping']), hu(2, 0, ['ping']), hu(3, 0, ['qing'])], 0, 4).map((h) => h.id)).toEqual(['multi3', 'qing']);
    expect(highlightsOf([hu(2, null, ['gangkai', 'qing'])], 0, 4).map((h) => h.id)).toEqual(['gangkai']);
    expect(highlightsOf([hu(2, 1, ['pengpeng'], 4)], 0, 4).map((h) => h.id)).toEqual(['capped']);
    expect(highlightsOf([hu(2, 1, ['ping'], 0)], 0, 4)).toEqual([]);
  });
});
