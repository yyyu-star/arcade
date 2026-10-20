/**
 * 新手教程（DESIGN.md 8.1）：写死的密钥是挑过的，规则或电脑一改，这里先报出来（再按 game/tutorial.ts 的注释重新挑一把）。
 * 我这一侧按教程走：第一回合挂 2 挡出两张大的，之后由电脑替我开（预设一律"问我"，好让提问都出现）。
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/index.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { HEAT, STRESS } from '../src/core/cards.ts';
import { apply, current, pending } from '../src/core/rules.ts';
import type { Action, Ask, State } from '../src/core/types.ts';
import { view } from '../src/core/view.ts';
import { COACH_NAME, GRAD, LINES, TIPS, TUTORIAL_KEY, TUTORIAL_OPTS, TUTORIAL_STORE } from '../src/game/tutorial.ts';
import { ME, newSolo } from '../src/solo.ts';
import { getTrack } from '../src/track/index.ts';

/** 教程赛道的第一条弯道线 */
const TUTORIAL_FIRST_CORNER = getTrack(TUTORIAL_OPTS.track)!.corners[0]!.at;

function start(): State {
  return newSolo(TUTORIAL_OPTS, '我', [...TUTORIAL_KEY]).state;
}

/** 按教程跑完一场，记下每回合问了我什么 */
function play(boostFirst: boolean): { asks: { round: number; ask: Ask }[]; s: State } {
  let s = start();
  const asks: { round: number; ask: Ask }[] = [];
  for (let i = 0; i < 5_000 && s.phase !== 'over'; i++) {
    const who = s.phase === 'plan' ? pending(s) : [current(s)].filter((x): x is number => x !== null);
    const seat = who.includes(ME) ? ME : who[0]!;
    const v = view(s, seat);
    let a: Action;
    if (seat !== ME) a = decide(v, seat);
    else if (s.phase === 'plan') {
      // 和 src/tutor.ts 的 plan 一样：弃牌问过一次以后按"不弃"跳过
      const ask = { boost: 'ask', adren: 'ask', slip: 'ask', discard: asks.some((x) => x.ask === 'discard') ? [] : 'ask' } as const;
      if (s.round === 1) {
        const big = v.me!.hand.filter((h) => h.kind !== HEAT && h.kind !== STRESS).sort((x, y) => y.kind - x.kind);
        a = { t: 'plan', gear: 2, cards: big.slice(0, 2).map((h) => h.id), ...ask };
      } else a = { ...(decide(v, ME) as Action & { t: 'plan' }), ...ask };
    } else {
      asks.push({ round: s.round, ask: s.ask! });
      a = s.round === 1 && s.ask === 'boost' ? { t: 'boost', yes: boostFirst } : decide(v, ME);
    }
    const r = apply(s, seat, a);
    if ('error' in r) throw new Error(`${seat} ${JSON.stringify(a)}: ${r.error}`);
    s = r;
  }
  return { asks, s };
}

describe('新手教程', () => {
  it('环湖 1 圈 3 辆车：我加两个新手电脑', () => {
    const s = start();
    expect(s.opts).toEqual({ track: 'lakeside', laps: 1, cars: 3, level: 'easy' });
    expect(s.kinds).toEqual(['human', 'ai', 'ai']);
    for (const p of s.personas.slice(1)) expect(PERSONAS[p]!.level).toBe(0);
  });

  it('同一把密钥每次开局一样；第一回合手里至少两张 3 或 4，还有一张手抖牌（第 1 课要讲）', () => {
    const a = start();
    expect(start()).toEqual(a);
    const hand = a.cars[ME]!.hand.map((id) => a.cars[ME]!.kinds[id]!);
    expect(hand.filter((k) => k === 3 || k === 4).length).toBeGreaterThanOrEqual(2);
    expect(hand).toContain(STRESS);
    // 第一段是直道：从发车格挂 2 挡出最大的两张（手抖按 4 算）也到不了第一条弯道线
    const two = hand.map((k) => (k === STRESS ? 4 : k === HEAT ? 0 : k)).sort((x, y) => y - x);
    expect(a.cars[ME]!.pos + two[0]! + two[1]!).toBeLessThan(TUTORIAL_FIRST_CORNER);
  });

  it('照着教程开：不管第一回合冲不冲，前三回合都会问到冲刺和尾流，弃牌只在第 1 回合问一次，一场跑得完', () => {
    for (const boost of [false, true]) {
      const { asks, s } = play(boost);
      expect(asks.find((x) => x.ask === 'boost')!.round).toBeLessThanOrEqual(3);
      expect(asks.find((x) => x.ask === 'slip')!.round).toBeLessThanOrEqual(3);
      // 弃牌只问一次，就在第 1 回合
      expect(asks.filter((x) => x.ask === 'discard')).toEqual([{ round: 1, ask: 'discard' }]);
      expect(s.phase).toBe('over');
      expect(s.round).toBeLessThan(15);
    }
  });

  it('文案齐全，存储的键带 racing. 前缀', () => {
    expect(TUTORIAL_STORE).toBe('racing.tutorial');
    expect(COACH_NAME).toBe('阿驰');
    for (const t of [...Object.values(LINES), ...Object.values(TIPS), ...Object.values(GRAD)]) expect(t.length).toBeGreaterThan(1);
  });
});
