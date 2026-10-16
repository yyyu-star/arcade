/**
 * 电脑再训练（0.5.0，DESIGN.md 4.7）：场地 → 强弱档、这一场的状态、公开的打法统计。
 * 期望（各场地普通玩家每百手）用模拟器量，写在 DESIGN；这里锁住结构和"不读牌、同种子同结果"
 */
import { stream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { SKILL } from '../src/ai/personas.ts';
import { apply, FORM_SWING, isFail, levelOf, newTable, seatHouse, type Table } from '../src/core/table.ts';
import { LEVELS, ROOM_LEVEL, SOLO_LEVEL, STAKES, STRONG } from '../src/core/stakes.ts';
import { view, type View } from '../src/core/view.ts';
import { runBots } from './bots.ts';
import { must, rig, SEED, setup } from './helpers.ts';

const ok = (t: Table | { error: string }): Table => {
  if (isFail(t)) throw new Error(t.error);
  return t;
};

describe('场地 → 强弱档', () => {
  it('单机小桌是新手档（会手软、不看人、不按筹码深浅打），往上逐档不弱；好友房各档不比单机同档弱，往上也不弱', () => {
    expect(SOLO_LEVEL.small).toBe(0);
    expect(SKILL[0]!.slip).toBeGreaterThan(0);
    expect(SKILL[0]!.adapt).toBe(0);
    expect(SKILL[0]!.depth).toBe(false);
    for (let i = 1; i < STAKES.length; i++) {
      expect(SOLO_LEVEL[STAKES[i]!.id]).toBeGreaterThanOrEqual(SOLO_LEVEL[STAKES[i - 1]!.id]);
      expect(ROOM_LEVEL[STAKES[i]!.id]).toBeGreaterThanOrEqual(ROOM_LEVEL[STAKES[i - 1]!.id]);
    }
    for (const st of STAKES) expect(ROOM_LEVEL[st.id]).toBeGreaterThanOrEqual(SOLO_LEVEL[st.id]);
    expect(SKILL.length).toBe(LEVELS);
    // 新手以外都不手软
    for (const k of SKILL.slice(1)) expect(k.slip).toBe(0);
  });

  it('单机的牌桌不写 level，按档位取；写了就按写的；0.4.0 好友房的 strong 是最强档；视图带着它', () => {
    for (const st of STAKES) expect(levelOf(newTable(st.id, 6, SEED))).toBe(SOLO_LEVEL[st.id]);
    expect(levelOf(newTable('small', 6, SEED, { level: 3 }))).toBe(3);
    expect(levelOf({ stakes: 'small', strong: true })).toBe(5);
    expect(view(newTable('big', 6, SEED, { level: 4 }), null).level).toBe(4);
  });

  it('最强档按 STRONG 的顺序补位、一桌不重复；别的档按权重挑，同一个种子挑得一样', () => {
    let t = newTable('small', 9, SEED, { level: 5 });
    for (let i = 0; i < 8; i++) t = ok(seatHouse(t, i, false));
    expect(t.seats.slice(0, 8).map((s) => s.persona)).toEqual(STRONG.slice(0, 8));
    const pick = (): number[] => {
      let u = newTable('small', 9, SEED, { level: 0 });
      for (let i = 0; i < 8; i++) u = ok(seatHouse(u, i, false));
      return u.seats.slice(0, 8).map((s) => s.persona);
    };
    expect(pick()).toEqual(pick());
    expect(new Set(pick()).size).toBe(8);
  });
});

describe('同种子同结果', () => {
  it('每一档都一样：同一个种子打两遍，每一步的牌桌完全相同；换一档打法就变', () => {
    const trace = (level: number): string[] => {
      const out: string[] = [];
      runBots({ seed: SEED, size: 6, hands: 60, level, onStep: (t) => void out.push(JSON.stringify(t)) });
      return out;
    };
    const runs = Array.from({ length: LEVELS }, (_, lv) => trace(lv));
    for (let lv = 0; lv < LEVELS; lv++) expect(trace(lv)).toEqual(runs[lv]);
    expect(runs[0]).not.toEqual(runs[4]);
  });
});

describe('这一场的状态（form）', () => {
  it('电脑坐下时按种子抽：在范围里、同种子一样、换种子不一样；只在自己的视图里，别人的看不到', () => {
    const forms: string[] = [];
    for (let k = 0; k < 60; k++) {
      const t = ok(seatHouse(newTable('mid', 2, [k, ...SEED.slice(1)]), 1, false));
      const f = t.seats[1]!.form!;
      expect(f[0]!).toBeGreaterThanOrEqual(-FORM_SWING);
      expect(f[0]!).toBeLessThanOrEqual(FORM_SWING);
      expect(f[1]!).toBeGreaterThanOrEqual(-FORM_SWING);
      expect(f[1]!).toBeLessThanOrEqual(FORM_SWING);
      expect(f[2]!).toBeGreaterThanOrEqual(700);
      expect(f[2]!).toBeLessThanOrEqual(1300);
      expect(f[3]!).toBeGreaterThanOrEqual(800);
      expect(f[3]!).toBeLessThanOrEqual(1250);
      expect(t.seats[1]!.start).toBe(t.seats[1]!.stack);
      forms.push(JSON.stringify(f));
      // 自己的视图有，别人（和没入座的）看不到；座位的公开信息里也没有
      expect(view(t, 1).form).toEqual(f);
      expect(view(t, 0).form).toBeUndefined();
      expect(view(t, null).form).toBeUndefined();
      expect(JSON.stringify(view(t, 0).seats)).not.toContain('form');
    }
    expect(new Set(forms).size).toBeGreaterThan(50);
    const again = ok(seatHouse(newTable('mid', 2, [7, ...SEED.slice(1)]), 1, false)).seats[1]!.form;
    expect(JSON.stringify(again)).toBe(forms[7]);
  });

  it('同样的局面，状态紧的这一场弃得多、松的跟得多（性格一样）', () => {
    const spots: View[] = [];
    runBots({
      seed: SEED,
      size: 6,
      hands: 600,
      chaos: false,
      onStep: (t) => {
        const s = t.toAct;
        if (s !== null && t.board.length === 0 && spots.length < 600) spots.push(view(t, s));
      },
    });
    const play = (tight: number): number =>
      spots.filter((v, i) => decide({ ...v, level: 2, form: [tight, 0, 1000, 1000] }, stream(SEED, 'form', i)).t !== 'fold').length;
    const loose = play(-FORM_SWING);
    const tight = play(FORM_SWING);
    console.log(`翻牌前 ${spots.length} 个局面：状态松的进 ${loose} 次，紧的 ${tight} 次`);
    expect(loose).toBeGreaterThan(tight * 1.1);
  });
});

describe('公开的打法统计（seen）', () => {
  it('只按出手记：发到牌 ≥ 入池 ≥ 翻牌前加注；人人的视图里一样，电脑据此看对手（不碰底牌）', () => {
    let checked = 0;
    runBots({
      seed: SEED,
      size: 6,
      hands: 300,
      onStep: (t) => {
        for (const s of t.seats) {
          if (!s.seen) continue;
          const [h, vpip, pfr] = s.seen;
          expect(vpip!).toBeLessThanOrEqual(h!);
          expect(pfr!).toBeLessThanOrEqual(vpip!);
          checked++;
        }
        if (t.toAct !== null) expect(view(t, t.toAct).seats.map((x) => x.seen)).toEqual(view(t, null).seats.map((x) => x.seen));
      },
    });
    expect(checked).toBeGreaterThan(1000);
  });

  it('换了一副底牌、出手一样，统计就一样（只看出手）', () => {
    // 同一桌、同一串出手，两边的底牌和公共牌不同：每个座位的 seen 只由出手决定
    const t0 = setup([2000, 2000, 2000], 0);
    const a0 = rig(t0, { 0: 'As Ad', 1: '7c 2d', 2: 'Kh Qh' }, 'Ac 7h 2s 9d 3c');
    const b0 = rig(t0, { 0: '8s 3d', 1: 'Js Jd', 2: '5c 4c' }, 'Th 9h 8c 2c Kd');
    const run = (t: Table): Table => {
      // 先说话的加注，其余跟；翻牌后第一个下注、其余跟到河牌
      for (let k = 0; k < 40 && t.toAct !== null; k++) {
        const v = view(t, t.toAct);
        const lg = v.legal!;
        const first = t.log.filter((e) => e.seat >= 0 && e.act !== 'sb' && e.act !== 'bb').length === 0 || (lg.check && lg.raise);
        t = must(apply(t, t.toAct, first && lg.raise ? { t: 'raise', to: lg.minTo } : lg.check ? { t: 'check' } : { t: 'call' }));
      }
      return t;
    };
    const a = run(a0);
    const b = run(b0);
    expect(a.seats.map((s) => s.seen)).toEqual(b.seats.map((s) => s.seen));
    expect(a.seats.map((s) => s.stack)).not.toEqual(b.seats.map((s) => s.stack));
  });
});
