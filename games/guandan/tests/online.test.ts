/**
 * 联机要用的规则核心接口（P1 第 ① 步）：规则版本、玩家动作和牌桌动作分开、超时代出、下一副预告、状态体积。
 * 房间和浏览器共用这些纯函数，这里只测核心本身。
 */
import { describe, expect, it } from 'vitest';
import {
  RULES_VERSION,
  SEEDED_RULES_VERSION,
  canPass,
  createKeyedGame,
  cardValue,
  createGame,
  dispatch,
  isSeatAction,
  isWild,
  legalPlays,
  previewNext,
  rulesOf,
  rulesSupported,
  seatsToAct,
  timeoutAction,
  viewFor,
  type Action,
  type GameState,
} from '../src/variants/guandan/core/index.ts';
import { decide } from '../src/variants/guandan/ai/index.ts';
import { C, act, playState } from './helpers.ts';

/** 按 pick 选每一步（一副结束时由"牌桌"开下一副），返回经过的全部状态 */
function run(seed: string, pick: (state: GameState, seat: number, i: number) => Action, maxActions = 20000): GameState[] {
  let { state } = createGame(seed);
  const states = [state];
  for (let i = 0; state.phase !== 'gameOver' && i < maxActions; i++) {
    const a: Action = state.phase === 'dealEnd' ? { type: 'nextDeal' } : pick(state, seatsToAct(state)[0]!, i);
    const r = dispatch(state, a);
    if (r.error) throw new Error(`${seed} 第 ${i} 步 ${JSON.stringify(a)}：${r.error}`);
    state = r.state;
    states.push(state);
  }
  return states;
}

const ai = (seed: string) => (state: GameState, seat: number): Action => decide(viewFor(state, seat), { seed, difficulty: 'normal' })!;

describe('规则版本', () => {
  it('开局记下规则版本，视角里也看得到：按种子发牌的是 1，按密钥发牌（联机）的是 2，两个都接着打', () => {
    const { state } = createGame('rv');
    expect(state.rules).toBe(SEEDED_RULES_VERSION);
    expect(viewFor(state, 2).rules).toBe(SEEDED_RULES_VERSION);
    const keyed = createKeyedGame([1, 2, 3, 4, 5, 6, 7, 8]).state;
    expect(keyed.rules).toBe(RULES_VERSION);
    expect(viewFor(keyed, 2).rules).toBe(RULES_VERSION);
    expect(rulesSupported(SEEDED_RULES_VERSION)).toBe(true);
    expect(rulesSupported(RULES_VERSION)).toBe(true);
  });

  it('单机同种子同结果不变：种子发牌的路径和以前一样，没有密钥字段', () => {
    const a = createGame('same').state;
    expect(createGame('same').state).toEqual(a);
    expect('key' in a).toBe(false);
    expect(a.seed).toBe('same');
  });

  it('密钥必须是 8 个 u32', () => {
    expect(() => createKeyedGame([1, 2, 3])).toThrow();
  });

  it('别的规则版本开的牌局不接着打，状态原样返回', () => {
    const { state } = createGame('rv');
    const future = { ...state, rules: RULES_VERSION + 1 };
    const seat = seatsToAct(future)[0]!;
    const a = decide(viewFor(state, seat), { seed: 'rv', difficulty: 'normal' })!;
    const r = dispatch(future, a);
    expect(r.error).toMatch(/版本/);
    expect(r.state).toBe(future);
    expect(r.events).toEqual([]);
  });

  it('旧存档没有规则版本字段：按第 1 版接着打，下一步的状态补上字段', () => {
    const { state } = createGame('old-save');
    const old = JSON.parse(JSON.stringify(state)) as Partial<GameState>;
    delete old.rules;
    expect(rulesOf(old as GameState)).toBe(1);
    const seat = seatsToAct(state)[0]!;
    const a = decide(viewFor(state, seat), { seed: 'old-save', difficulty: 'normal' })!;
    const r = dispatch(old as GameState, a);
    expect(r.error).toBeUndefined();
    expect(r.state.rules).toBe(1);
    expect(r.state).toEqual(dispatch(state, a).state);
  });
});

describe('玩家动作和牌桌动作', () => {
  it('出牌、不要、进贡、还贡是玩家动作；开下一副不是', () => {
    expect(isSeatAction({ type: 'play', seat: 0, cards: [1] })).toBe(true);
    expect(isSeatAction({ type: 'pass', seat: 1 })).toBe(true);
    expect(isSeatAction({ type: 'tribute', seat: 2, card: 3 })).toBe(true);
    expect(isSeatAction({ type: 'return', seat: 3, card: 4 })).toBe(true);
    expect(isSeatAction({ type: 'nextDeal' })).toBe(false);
  });
});

describe('超时代出 timeoutAction', () => {
  it('跟牌时一律不要（队友的牌也不接）', () => {
    let s = playState(['S5 S9', 'S4 S6', 'S7 S8', 'D4 D6']);
    s = act(s, { type: 'play', seat: 0, cards: [s.hands[0]!.find((c) => c % 54 === C('S5')[0]! % 54)!] }).state;
    expect(timeoutAction(viewFor(s, 1))).toEqual({ type: 'pass', seat: 1 });
    s = act(s, { type: 'pass', seat: 1 }).state;
    // 座位 2 是出牌人的对家，能压也不要
    expect(legalPlays(viewFor(s, 2)).length).toBeGreaterThan(0);
    expect(timeoutAction(viewFor(s, 2))).toEqual({ type: 'pass', seat: 2 });
  });

  it('必须领出时出一张最小的单牌；一样小的先出不是逢人配的', () => {
    // 打 2：H2 是逢人配，单张算级牌（比 A 大）；最小的是 S3
    const s = playState(['H2 SK S3 D3', 'S4', 'S5', 'S6'], { level: 2 });
    const a = timeoutAction(viewFor(s, 0));
    expect(a).toMatchObject({ type: 'play', seat: 0 });
    const card = (a as { cards: number[] }).cards;
    expect(card.length).toBe(1);
    expect(card[0]! % 54).toBe(C('S3')[0]! % 54);
    // 一样小（都是级牌）时不出逢人配：H2 和 D2 都算级牌，出 D2，留着 H2 配牌
    const tie = playState(['H2 D2', 'S4', 'S5', 'S6'], { level: 2 });
    const at = timeoutAction(viewFor(tie, 0)) as { cards: number[] };
    expect(at.cards.map((c) => c % 54)).toEqual([C('D2')[0]! % 54]);
    // 手里只剩逢人配也能领出
    const w = playState(['H2', 'S4', 'S5', 'S6'], { level: 2 });
    const aw = timeoutAction(viewFor(w, 0))!;
    expect(dispatch(w, aw).error).toBeUndefined();
  });

  it('没轮到、一副结束等开下一副时返回 null', () => {
    const s = playState(['S5', 'S4', 'S7', 'D4']);
    expect(timeoutAction(viewFor(s, 1))).toBeNull();
    const end = run('timeout-end', ai('timeout-end')).find((x) => x.phase === 'dealEnd')!;
    for (let seat = 0; seat < 4; seat++) expect(timeoutAction(viewFor(end, seat))).toBeNull();
  });

  it('进贡交允许的牌里最小的，还贡还允许的牌里最小的', () => {
    let checked = 0;
    for (let i = 0; i < 6 && checked < 6; i++) {
      for (const s of run(`timeout-trib-${i}`, ai(`timeout-trib-${i}`))) {
        if (s.phase !== 'tribute' && s.phase !== 'return') continue;
        for (const seat of seatsToAct(s)) {
          const v = viewFor(s, seat);
          const a = timeoutAction(v)!;
          expect(a.type).toBe(v.myTribute!.kind);
          const card = (a as { card: number }).card;
          expect(v.myTribute!.allowed).toContain(card);
          const min = Math.min(...v.myTribute!.allowed.map((c) => cardValue(c, v.level)));
          expect(cardValue(card, v.level)).toBe(min);
          expect(dispatch(s, a).error).toBeUndefined();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('混着电脑随机穿插代出，每一步都合法；能不要时一定是不要，领出时是手里最小的一张', () => {
    for (let g = 0; g < 8; g++) {
      const seed = `timeout-mix-${g}`;
      const decideFor = ai(seed);
      run(seed, (state, seat, i) => {
        // 约三分之一的步数换成代出（按步号挑，结果确定）
        if ((i * 7 + g) % 3 !== 0) return decideFor(state, seat);
        const v = viewFor(state, seat);
        const a = timeoutAction(v)!;
        expect(a).not.toBeNull();
        if (v.phase === 'play' && canPass(v)) expect(a).toEqual({ type: 'pass', seat });
        if (v.phase === 'play' && !canPass(v)) {
          const c = (a as { cards: number[] }).cards;
          expect(c.length).toBe(1);
          const min = Math.min(...v.hand.map((x) => cardValue(x, v.level)));
          expect(cardValue(c[0]!, v.level)).toBe(min);
          if (v.hand.some((x) => cardValue(x, v.level) === min && !isWild(x, v.level))) expect(isWild(c[0]!, v.level)).toBe(false);
        }
        return a;
      });
    }
  }, 60_000);

  it('四家全部掉线也能把整局打完（不卡死）', () => {
    const states = run('all-afk', (state, seat) => timeoutAction(viewFor(state, seat))!, 60000);
    expect(states[states.length - 1]!.phase).toBe('gameOver');
  }, 60_000);

  it('只看自己的视角：别人手里的牌换了，代出结果不变', () => {
    for (const s of run('timeout-blind', ai('timeout-blind')).filter((x) => x.phase === 'play').slice(0, 300)) {
      const seat = s.turn;
      const other = (seat + 1) % 4;
      const third = (seat + 3) % 4;
      if (s.hands[other]!.length !== s.hands[third]!.length) continue;
      const swapped: GameState = { ...s, hands: s.hands.map((h, i) => (i === other ? s.hands[third]! : i === third ? s.hands[other]! : h)) };
      expect(timeoutAction(viewFor(swapped, seat))).toEqual(timeoutAction(viewFor(s, seat)));
    }
  });
});

describe('下一副预告 previewNext', () => {
  it('和真的开下一副一致：谁进贡、给谁、抗不抗；不改传入的状态', () => {
    const seen = { single: 0, double: 0, anti: 0 };
    for (let g = 0; g < 12; g++) {
      for (const s of run(`preview-${g}`, ai(`preview-${g}`))) {
        if (s.phase !== 'dealEnd') {
          expect(previewNext(s)).toBeNull();
          continue;
        }
        const before = JSON.stringify(s);
        const p = previewNext(s)!;
        expect(JSON.stringify(s)).toBe(before);
        const r = act(s, { type: 'nextDeal' });
        const anti = r.events.find((e) => e.type === 'antiTribute');
        expect(p.anti).toBe(!!anti);
        if (anti?.type === 'antiTribute') {
          expect(p.payers).toEqual(anti.seats);
          seen.anti++;
        } else {
          expect([...p.payers].sort()).toEqual(seatsToAct(r.state).sort());
          for (const e of r.state.tribute!.entries) expect(e.to).toBe(p.to);
          if (p.payers.length === 2) seen.double++;
          else seen.single++;
        }
        expect(p.to).toBe(p.payers.length === 2 ? -1 : s.lastDeal!.order[0]);
      }
    }
    expect(seen.single).toBeGreaterThan(0);
    expect(seen.double).toBeGreaterThan(0);
  }, 30_000); // 打 12 整局：机器忙时 5 秒默认时限会偶发超时

  it('整局结束后没有下一副', () => {
    const states = run('preview-end', ai('preview-end'));
    const last = states[states.length - 1]!;
    expect(last.phase).toBe('gameOver');
    expect(previewNext(last)).toBeNull();
  });
});

describe('状态体积（房间每步整份存一次，要小）', () => {
  it('整局里最大的一份状态 JSON 不超过 8 KB（实测约 6 KB）', () => {
    let max = 0;
    for (let g = 0; g < 4; g++) {
      for (const s of run(`size-${g}`, ai(`size-${g}`))) max = Math.max(max, new TextEncoder().encode(JSON.stringify(s)).length);
    }
    expect(max).toBeLessThan(8 * 1024);
  });
});
