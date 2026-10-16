/** 电脑的互动（game/banter.ts，DESIGN.md 第 6 节）：只发合法的编号和对象、按性格回、有冷却、同一个种子同一个结果；名场面认得对 */
import { describe, expect, test } from 'vitest';
import { PERSONAS } from '../src/ai/personas.ts';
import { Banter, COOL_MS, FunTally, highlightsOf, momentsOf, propId, stickerId, type Act, type Cast, type Moment } from '../src/game/banter.ts';
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
      // 每 6 次算一局结完（每手最多两次主动互动，不清零的话后面都不发）
      const ms: Moment[] = [{ k: 'hu', seat: 1 + (i % 3), from: 0, fan: 2 }, { k: 'kan', seat: 1 + ((i + 1) % 3) }];
      if (i % 6 === 5) ms.push({ k: 'round', net: [0, 0, 0, 0], chips: [1, 1, 1, 1], share: 1 });
      for (const a of b.moments(c, ms, now)) {
        const t = at.get(a.seat);
        if (t !== undefined) expect(now - t).toBeGreaterThanOrEqual(COOL_MS);
        at.set(a.seat, now);
      }
    }
    expect(at.size).toBe(3);
  });

  test('被扔番茄：爱闹的常回敬同类，新手认怂，高冷的多半不理；对大家说的不回；都在 0.8–2 秒后', () => {
    const tally = (name: string, id = propId('tomato')) => {
      const out = { back: 0, meek: 0, none: 0, late: 0 };
      for (let seed = 0; seed < 300; seed++) {
        const r = new Banter(seed).reply([null, P(name), null, null], 0, id, 1, 0);
        if (!r) out.none++;
        else {
          if (r.after! < 800 || r.after! > 2_000) out.late++;
          if (r.id === id && r.to === 0) out.back++;
          else if (r.id === stickerId('cry') || r.id === stickerId('sweat')) out.meek++;
        }
      }
      return out;
    };
    // 兔头哥爱闹：60%×1.5=90% 回应，其中 25%×1.5≈38% 回敬
    const lively = tally('兔头哥');
    expect(lively.back).toBeGreaterThan(70);
    expect(lively.back).toBeLessThan(160);
    expect(lively.none).toBeLessThan(60);
    expect(tally('板凳儿').meek).toBeGreaterThan(100);
    // 盖碗儿高冷 ×0.3：18% 回应
    expect(tally('盖碗儿').none).toBeGreaterThan(200);
    expect(lively.late + tally('板凳儿').late).toBe(0);
    // 鸡蛋还拖鞋
    const backs = Array.from({ length: 200 }, (_, i) => new Banter(i).reply([null, P('兔头哥'), null, null], 0, propId('egg'), 1, 0)).filter((r) => r?.to === 0 && r.id >= propId('tomato'));
    expect(backs.length).toBeGreaterThan(0);
    expect(backs.every((r) => r!.id === propId('slipper'))).toBe(true);
    expect(new Banter(1).reply(cast('兔头哥', '兔头哥', '兔头哥'), 0, propId('tomato'), undefined, 0)).toBeNull();
  });

  test('玫瑰：回比心；善意的不回敬', () => {
    const rs = Array.from({ length: 200 }, (_, i) => new Banter(i).reply([null, P('熊猫哥'), null, null], 0, propId('rose'), 1, 0)).filter(Boolean);
    expect(rs.length).toBeGreaterThan(80);
    expect(rs.every((r) => r!.id === stickerId('love') && r!.to === undefined)).toBe(true);
  });

  test('回敬每个电脑 20 秒内最多 2 次；电脑扔的也有人回', () => {
    const c: Cast = [null, P('兔头哥'), P('幺妹儿'), null];
    const b = new Banter(9);
    let backs = 0;
    for (let i = 0; i < 400; i++) {
      const r = b.reply(c, i % 2 ? 0 : 2, propId('tomato'), 1, i * 3_000);
      if (r && r.id === propId('tomato') && r.to !== undefined) backs++;
    }
    // 400 次、每次隔 3 秒：每 20 秒窗口至多 2 次回敬（约 7 次扔一个窗口）
    expect(backs).toBeLessThanOrEqual(Math.ceil((400 * 3) / 20) * 2);
    expect(backs).toBeGreaterThan(20);
  });

  test('名场面：输家常冲赢家扔，赢家得意；每手最多两次主动互动，局终清零', () => {
    const c = cast('兔头哥', '幺妹儿', '板凳儿');
    let toWinner = 0;
    let winner = 0;
    for (let seed = 0; seed < 300; seed++) {
      const acts = new Banter(seed).moments(c, [{ k: 'hu', seat: 0, from: null, fan: 1, scene: true }], 0);
      expect(acts.length).toBeLessThanOrEqual(2);
      toWinner += acts.filter((a) => a.to === 0 || a.id >= 14).length > 0 ? 1 : 0;
    }
    expect(toWinner).toBeGreaterThan(50);
    for (let seed = 0; seed < 300; seed++) if (new Banter(seed).moments(c, [{ k: 'kan', seat: 1 }], 0).some((a) => a.seat === 1)) winner++;
    expect(winner).toBeGreaterThan(30);
    // 一手里发过两次，再来名场面不发；round 之后又能发
    const b = new Banter(4);
    let got = 0;
    for (let i = 0; i < 40; i++) got += b.moments(c, [{ k: 'kan', seat: 1 + (i % 3) }], i * 10_000).length;
    expect(got).toBeLessThanOrEqual(2);
    b.moments(c, [{ k: 'round', net: [0, 0, 0, 0], chips: [1, 1, 1, 1], share: 1 }], 1_000_000);
    let more = 0;
    for (let i = 0; i < 40; i++) more += b.moments(c, [{ k: 'kan', seat: 1 + (i % 3) }], 2_000_000 + i * 10_000).length;
    expect(more).toBeGreaterThan(0);
  });

  test('点炮不算名场面，自摸、杠上花、清一色算', () => {
    const hu = (from: number | null, ids: string[]): XzEvent => ({ e: 'hu', seat: 1, from, tile: 0, fan: 2, items: ids.map((id) => ({ id, fan: 1 })), rob: false }) as unknown as XzEvent;
    expect(momentsOf([hu(0, ['ping'])])).toMatchObject([{ k: 'hu', scene: false }]);
    expect(momentsOf([hu(null, ['ping'])])).toMatchObject([{ scene: true }]);
    expect(momentsOf([hu(0, ['qing'])])).toMatchObject([{ scene: true }]);
    expect(momentsOf([hu(0, ['gangkai'])])).toMatchObject([{ scene: true }]);
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

describe('扔道具的画面账', () => {
  test('目标保护：10 秒内最多被打中 6 次，过了窗口又能打', () => {
    const t = new FunTally();
    const r = Array.from({ length: 8 }, (_, i) => t.hit(1 + (i % 2), 0, i * 500));
    expect(r.map((x) => x.shield)).toEqual([false, false, false, false, false, false, true, true]);
    expect(t.hit(1, 0, 10_100).shield).toBe(false);
    // 别的目标不受影响
    expect(t.hit(1, 2, 5_000).shield).toBe(false);
  });

  test('连击：同一个人 3 秒内对同一个目标，第 2 次起数 ×2 ×3；隔久了重数；换目标不算', () => {
    const t = new FunTally();
    expect(t.hit(0, 1, 0).combo).toBe(1);
    expect(t.hit(0, 1, 2_000).combo).toBe(2);
    expect(t.hit(0, 1, 4_500).combo).toBe(3);
    expect(t.hit(0, 2, 5_000).combo).toBe(1);
    expect(t.hit(0, 1, 9_000).combo).toBe(1);
    expect(t.hit(3, 1, 9_100).combo).toBe(1);
  });

  test('回敬：被扔后 3 秒内扔回给对方', () => {
    const t = new FunTally();
    expect(t.hit(1, 0, 0).revenge).toBe(false);
    expect(t.hit(0, 1, 2_000).revenge).toBe(true);
    expect(t.hit(0, 1, 2_500).revenge).toBe(true);
    const u = new FunTally();
    u.hit(1, 0, 0);
    expect(u.hit(0, 1, 3_500).revenge).toBe(false);
    expect(u.hit(0, 2, 3_600).revenge).toBe(false);
  });
});

describe('被扔后的回应（docs/table-fun.md 第 4 节）', () => {
  /** 单机里冲一个电脑扔 20 次番茄（每次隔 1.6 秒，道具冷却 1.5 秒），数它回应、回敬了几次 */
  function throw20(seed: number, name: string): { react: number; revenge: number } {
    const b = new Banter(seed);
    const c = cast(name, '熊猫哥', '板凳儿');
    let react = 0;
    let revenge = 0;
    for (let i = 0; i < 20; i++) {
      const r = b.reply(c, 0, propId('tomato'), 1, 10_000 + i * 1_600);
      if (!r) continue;
      react++;
      if (r.id >= propId('tomato') && r.to === 0) revenge++;
      expect(r.after).toBeGreaterThanOrEqual(800);
      expect(r.after).toBeLessThanOrEqual(2_000);
    }
    return { react, revenge };
  }
  const avg = (name: string, f: 'react' | 'revenge'): number => {
    let sum = 0;
    for (let s = 1; s <= 200; s++) sum += throw20(s, name)[f];
    return sum / 200;
  };

  test('普通性格：20 次里平均回应约 12 次（60%），单次一场在合理区间', () => {
    expect(avg('熊猫哥', 'react')).toBeGreaterThan(10.8);
    expect(avg('熊猫哥', 'react')).toBeLessThan(13.2);
    for (let s = 1; s <= 50; s++) {
      const n = throw20(s, '熊猫哥').react;
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(19);
    }
  });

  test('互动性格乘上去：爱闹 ×1.5（90%）、高冷 ×0.3（18%）', () => {
    expect(avg('幺妹儿', 'react')).toBeGreaterThan(16.5);
    expect(avg('盖碗儿', 'react')).toBeGreaterThan(2.4);
    expect(avg('盖碗儿', 'react')).toBeLessThan(4.8);
  });

  test('回敬：回应里约 25%，但 20 秒里最多 2 次（20 次扔 32 秒，最多 4 次）', () => {
    for (let s = 1; s <= 50; s++) expect(throw20(s, '熊猫哥').revenge).toBeLessThanOrEqual(4);
    expect(avg('熊猫哥', 'revenge')).toBeGreaterThan(1.5);
  });
});
