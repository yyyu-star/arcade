import { describe, expect, it } from 'vitest';
import { createGame, dispatch, seatsToAct, viewFor, type GameState } from '../src/core/index.ts';
import { DIFFICULTIES, PERSONAS, PERSONA_IDS, SEAT_PERSONA, TUNING, decide, formOf, tuningFor, type Difficulty } from '../src/ai/index.ts';
import { ROOM_FUN_BOT, ROOM_STAKE_BOT, SOLO_BOTS, SOLO_FUN_BOTS, SOLO_LEVELS, botFor } from '../src/ai/venue.ts';
import { TIER_IDS } from '../src/stake/index.ts';
import { lineFor, thinkTime } from '../src/view/personas.ts';
import { playState } from './helpers.ts';

const rank = (d: Difficulty) => DIFFICULTIES.indexOf(d);

/** 从开局按普通电脑走 n 步，得到一个打到一半的局面 */
function midGame(seed: string, steps: number): GameState {
  let s = createGame(seed).state;
  for (let i = 0; i < steps && s.phase !== 'dealEnd' && s.phase !== 'gameOver'; i++) {
    const seat = seatsToAct(s)[0]!;
    s = dispatch(s, decide(viewFor(s, seat), { seed: `${seed}|${seat}` })!).state;
  }
  return s;
}

describe('场地 → 电脑（docs/ai.md）', () => {
  it('单机娱乐：默认"普通"是新手场，对手偏弱；简单再弱（会手软）；困难全是最强', () => {
    expect(SOLO_FUN_BOTS).toEqual({
      easy: { mate: 'normal', opp: 'novice' },
      normal: { mate: 'normal', opp: 'easy' },
      hard: { mate: 'hard', opp: 'hard' },
    });
    expect(TUNING.novice.soft).toBeGreaterThan(0);
    for (const d of DIFFICULTIES) if (d !== 'novice') expect(TUNING[d].soft).toBe(0);
  });

  it('单机实盘越往上越难（docs/stake.md 1.3）：对手不变弱，豪华档换成简单搭档', () => {
    expect(SOLO_BOTS).toEqual({
      small: { mate: 'normal', opp: 'easy' },
      mid: { mate: 'normal', opp: 'good' },
      big: { mate: 'normal', opp: 'hard' },
      lux: { mate: 'easy', opp: 'hard' },
    });
    for (let i = 1; i < TIER_IDS.length; i++) expect(rank(SOLO_BOTS[TIER_IDS[i]!].opp)).toBeGreaterThanOrEqual(rank(SOLO_BOTS[TIER_IDS[i - 1]!].opp));
    // 新手场（娱乐默认、实盘小档）不比"普通"难
    expect(rank(SOLO_FUN_BOTS.normal.opp)).toBeLessThan(rank('normal'));
    expect(rank(SOLO_BOTS.small.opp)).toBeLessThan(rank('normal'));
  });

  it('好友房：娱乐普通；实盘一律最强（docs/stake.md 3.1）', () => {
    expect(ROOM_FUN_BOT).toBe('normal');
    expect(ROOM_STAKE_BOT).toBe('hard');
  });

  it('座位 → 人物：单机 1、2、3 号是老张、小美、阿强；botFor 按场地给强弱', () => {
    expect([1, 2, 3].map((s) => SEAT_PERSONA[s])).toEqual(['laozhang', 'xiaomei', 'aqiang']);
    for (const l of SOLO_LEVELS) {
      expect(botFor({ kind: 'solo', level: l }, 2)).toEqual({ difficulty: SOLO_FUN_BOTS[l].mate, persona: 'xiaomei' });
      expect(botFor({ kind: 'solo', level: l }, 1)).toEqual({ difficulty: SOLO_FUN_BOTS[l].opp, persona: 'laozhang' });
    }
    for (const t of TIER_IDS) {
      expect(botFor({ kind: 'soloStake', tier: t }, 3)).toEqual({ difficulty: SOLO_BOTS[t].opp, persona: 'aqiang' });
      expect(botFor({ kind: 'roomStake', tier: t }, 0).difficulty).toBe('hard');
    }
    expect(botFor({ kind: 'room' }, 2)).toEqual({ difficulty: 'normal', persona: 'xiaomei' });
  });
});

describe('性格、状态、局面（src/ai/persona.ts）', () => {
  const v = viewFor(midGame('venue-mid', 30), 1);

  it('没给性格就是难度预设本身（聪明提示、代打、模拟里的"真人"都靠这个不变）', () => {
    for (const d of DIFFICULTIES) expect(tuningFor(v, d)).toBe(TUNING[d]);
  });

  it('同样的种子、同样的局面，带性格的决定也完全一样；换一场（match）状态就不同', () => {
    const s = midGame('venue-det', 25);
    const seat = seatsToAct(s)[0]!;
    for (const persona of PERSONA_IDS) {
      for (const difficulty of DIFFICULTIES) {
        const cfg = { seed: 'x', match: 'm1', persona, difficulty };
        expect(decide(viewFor(s, seat), cfg)).toEqual(decide(viewFor(s, seat), cfg));
      }
    }
    const forms = Array.from({ length: 40 }, (_, i) => formOf(`m${i}`, 1, 1, 'aqiang'));
    expect(new Set(forms.map((f) => f.toFixed(3))).size).toBeGreaterThan(30);
    for (const p of PERSONA_IDS) for (const f of Array.from({ length: 40 }, (_, i) => formOf(`m${i}`, 2, 3, p))) expect(Math.abs(f)).toBeLessThanOrEqual(PERSONAS[p].swing + 1e-9);
  });

  it('不看别人的牌：两个对手之间换几张牌（张数不变），电脑的决定不变', () => {
    for (let k = 0; k < 6; k++) {
      const s = midGame(`venue-peek-${k}`, 20 + k * 7);
      if (s.phase !== 'play') continue;
      const seat = s.turn;
      const [a, b] = [(seat + 1) % 4, (seat + 3) % 4];
      if (!s.hands[a]!.length || !s.hands[b]!.length) continue;
      const t: GameState = structuredClone(s);
      const x = t.hands[a]![0]!;
      t.hands[a]![0] = t.hands[b]![0]!;
      t.hands[b]![0] = x;
      for (const persona of PERSONA_IDS) {
        for (const difficulty of DIFFICULTIES) {
          const cfg = { seed: `p${k}`, match: 'peek', persona, difficulty };
          expect(decide(viewFor(t, seat), cfg)).toEqual(decide(viewFor(s, seat), cfg));
        }
      }
    }
  });

  it('局面：级数落后 3 级以上更拼（抢牌、爱炸都上去）；上一副输了，爱上头的阿强更粗心，小美不受影响', () => {
    const even = viewFor(playState(['S3 S5', 'H3 H5', 'D3 D5', 'C3 C5'], { levels: [5, 5] }), 1);
    const behind = viewFor(playState(['S3 S5', 'H3 H5', 'D3 D5', 'C3 C5'], { levels: [9, 5] }), 1);
    for (const p of PERSONA_IDS) {
      const a = tuningFor(even, 'normal', p, 'm');
      const b = tuningFor(behind, 'normal', p, 'm');
      expect(b.chase).toBeGreaterThan(a.chase);
      expect(b.bombLove).toBeGreaterThan(a.bombLove);
    }
    expect(tuningFor(behind, 'normal', 'aqiang', 'm').slip).toBeGreaterThan(tuningFor(even, 'normal', 'aqiang', 'm').slip);
    expect(tuningFor(behind, 'normal', 'xiaomei', 'm').slip).toBeCloseTo(tuningFor(even, 'normal', 'xiaomei', 'm').slip);
  });

  it('性格拉开：老张爱炸、小美捂炸弹、阿强抢牌最凶；越强的电脑性格露得越少', () => {
    const t = (p: (typeof PERSONA_IDS)[number], d: Difficulty = 'normal') => tuningFor(v, d, p, 'same');
    expect(PERSONAS.laozhang.bombLove).toBeGreaterThanOrEqual(1);
    expect(PERSONAS.xiaomei.bombLove).toBeLessThanOrEqual(-1);
    expect(PERSONAS.aqiang.chase).toBeGreaterThan(PERSONAS.laozhang.chase);
    expect(PERSONAS.aqiang.chase).toBeGreaterThan(PERSONAS.xiaomei.chase);
    expect(Math.abs(t('laozhang', 'hard').bombLove)).toBeLessThan(Math.abs(t('laozhang').bombLove));
  });

  it('单次决策够快：困难带性格打一场，p99 在 80 毫秒内（本机约 16 毫秒，和没性格一样，见 docs/ai.md 第 6 节；只防数量级的回退）', () => {
    let s = createGame('venue-time').state;
    const times: number[] = [];
    for (let i = 0; i < 400 && s.phase !== 'gameOver'; i++) {
      if (s.phase === 'dealEnd') {
        s = dispatch(s, { type: 'nextDeal' }).state;
        continue;
      }
      const seat = seatsToAct(s)[0]!;
      const t0 = performance.now();
      const a = decide(viewFor(s, seat), { seed: `t${seat}`, match: 'venue-time', difficulty: 'hard', persona: SEAT_PERSONA[seat]! })!;
      times.push(performance.now() - t0);
      s = dispatch(s, a).state;
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.99)]!).toBeLessThan(80);
  });
});

describe('口吻和节奏（src/view/personas.ts）', () => {
  it('同一个电脑不连着说同一句', () => {
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const line = lineFor('aqiang', 'beat', () => 0)!;
      expect(line).not.toBe(prev);
      prev = line;
    }
  });

  it('思考时间封在 450–2600 毫秒；小美比阿强想得久，上头的阿强更快；要紧的一手多想一会儿', () => {
    const mid = () => 0.5;
    for (const kind of ['pass', 'play', 'bomb'] as const) {
      for (const r of [0, 0.99]) {
        for (const persona of [...PERSONA_IDS, undefined]) {
          const ms = thinkTime({ kind, lead: true, tense: true, persona, form: -1, tilt: 1 }, () => r);
          expect(ms).toBeGreaterThanOrEqual(450);
          expect(ms).toBeLessThanOrEqual(2600);
        }
      }
    }
    expect(thinkTime({ kind: 'play', lead: false, persona: 'xiaomei' }, mid)).toBeGreaterThan(thinkTime({ kind: 'play', lead: false, persona: 'aqiang' }, mid));
    expect(thinkTime({ kind: 'play', lead: false, persona: 'aqiang', tilt: 1 }, mid)).toBeLessThan(thinkTime({ kind: 'play', lead: false, persona: 'aqiang' }, mid));
    expect(thinkTime({ kind: 'play', lead: false, tense: true }, mid)).toBeGreaterThan(thinkTime({ kind: 'play', lead: false }, mid));
  });
});
