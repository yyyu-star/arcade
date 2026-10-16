/**
 * 电脑再训练（0.5.0，DESIGN.md 4.7）：场地 → 强弱档、这一场的状态、公开的打法统计。
 * 期望（各场地普通玩家每百手）用模拟器量，写在 DESIGN；这里锁住结构和"不读牌、同种子同结果"
 */
import { stream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { SKILL } from '../src/ai/personas.ts';
import { parseCards } from '../src/core/cards.ts';
import { categoryOf, evalCards, HIGH_CARD } from '../src/core/eval.ts';
import { addChips, apply, deal, FORM_SWING, isFail, levelOf, newTable, seatHouse, seatPlayer, type Table } from '../src/core/table.ts';
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

describe('0.8.0：新手不连开三枪、大桌以上记住上一手亮的牌（DESIGN.md 4.9）', () => {
  it('新参数只在该有的档：新手档价值注小、会放过第三枪，记住上一手只在大桌以上', () => {
    expect(SKILL[0]!.value).toBeLessThan(1000);
    expect(SKILL[0]!.third).toBeGreaterThan(0);
    for (const k of SKILL.slice(1)) {
      expect(k.value).toBe(1000);
      expect(k.third).toBe(0);
    }
    SKILL.forEach((k, i) => (i >= 3 ? expect(k.memory).toBeGreaterThan(0) : expect(k.memory).toBe(0)));
  });

  it('翻牌、转牌都是我下的注，河牌拿着大牌：新手档多半只过牌，第 1 档照常下注', () => {
    // 两人桌：0 号是按钮（小盲），1 号先说话；1 号拿 AA，公共牌又来两张 A
    let t = rig(setup([2000, 2000], 1), { 0: '3c 4d', 1: 'As Ah' }, 'Ad Ac 7s 2h 9d');
    const go = (seat: number, a: Parameters<typeof apply>[2]) => (t = must(apply(t, seat, a)));
    go(0, { t: 'call' });
    go(1, { t: 'check' });
    for (let street = 0; street < 2; street++) {
      go(1, { t: 'raise', to: 40 });
      go(0, { t: 'call' });
    }
    expect(t.board.length).toBe(5);
    expect(t.toAct).toBe(1);
    const bets = (level: number): number => {
      const v = view({ ...t, level }, 1);
      let n = 0;
      for (let i = 0; i < 300; i++) if (decide(v, stream(SEED, 'third', i)).t !== 'check') n++;
      return n;
    };
    const novice = bets(0);
    const level1 = bets(1);
    expect(novice).toBeLessThan(level1 * 0.3);
    expect(level1).toBeGreaterThan(200);
  });

  it('下注的人上一手亮的是空气：大桌以上弃得不比原来多、整体少一些；中桌照旧（只用亮出来的牌）', () => {
    // 上一手亮出来的一手高牌（2 3 4 7 9 J K 不成顺、不成同花）
    const air = evalCards(parseCards('2c 3h 4d 7s 9c Jd Kh'));
    expect(categoryOf(air)).toBe(HIGH_CARD);
    const folds = { 2: [0, 0], 3: [0, 0], 4: [0, 0] } as Record<number, [number, number]>;
    let spots = 0;
    for (const level of [2, 3, 4]) {
      for (let g = 0; g < 30; g++) {
        let t = newTable('big', 2 + (g % 4), [g, level, 3, 4, 5, 6, 7, 8], { level });
        t = ok(seatPlayer(t, 0, 20_000, false));
        for (let i = 1; i < t.seats.length; i++) t = ok(seatHouse(t, i, false));
        t = deal(t);
        for (let k = 0; k < 600 && t.handNo <= 6; k++) {
          if (t.toAct === null) {
            if (t.seats[0]!.stack === 0) t = ok(addChips(t, 0, 20_000));
            else t = deal(t);
            if (t.toAct === null) break;
            continue;
          }
          const seat = t.toAct;
          const v = view(t, seat);
          const start = v.log.findLastIndex((e) => e.seat < 0) + 1;
          const aggr = v.log.slice(start).findLast((e) => e.act === 'bet' || e.act === 'raise')?.seat;
          if (v.board.length >= 3 && start > 0 && aggr !== undefined && v.legal!.call > 0) {
            spots++;
            const shown: View = { ...v, lastHand: { handNo: v.handNo - 1, board: [], shown: [{ seat: aggr, hole: [], value: air }], pots: [], uncalled: null, byFold: false } };
            const none: View = { ...v, lastHand: null };
            const a = decide(shown, stream(SEED, 'mem', k)).t === 'fold' ? 1 : 0;
            const b = decide(none, stream(SEED, 'mem', k)).t === 'fold' ? 1 : 0;
            // 同一条随机流：折扣小了胜率只会高，不会多弃
            expect(a).toBeLessThanOrEqual(b);
            folds[level]![0] += a;
            folds[level]![1] += b;
          }
          t = ok(apply(t, seat, decide(v, stream(t.seed, 'play', k))));
        }
      }
    }
    expect(spots).toBeGreaterThan(300);
    expect(folds[2]![0]).toBe(folds[2]![1]);
    for (const level of [3, 4]) expect(folds[level]![0]).toBeLessThan(folds[level]![1]);
  });
});
