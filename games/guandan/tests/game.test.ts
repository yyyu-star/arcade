import { describe, expect, it } from 'vitest';
import {
  ACE,
  BIG_JOKER,
  DEFAULT_OPTIONS,
  SHORT_END_LEVEL,
  endLevelOf,
  type Options,
  createGame,
  dispatch,
  eventsFor,
  legalPlays,
  rankOf,
  replay,
  seatsToAct,
  viewFor,
  canPass,
  hint,
  type Action,
  type GameState,
} from '../src/core/index.ts';
import { decide } from '../src/ai/index.ts';
import { C, act, pass, play, playState } from './helpers.ts';

describe('出牌流程', () => {
  it('领出不能不要；没轮到不能出；压不过不能出', () => {
    const s = playState(['S5 S9', 'S4 S6', 'S7 S8', 'D4 D6']);
    expect(dispatch(s, { type: 'pass', seat: 0 }).error).toMatch(/领出/);
    expect(dispatch(s, { type: 'play', seat: 1, cards: [s.hands[1]![0]!] }).error).toMatch(/轮到/);
    const s2 = play(s, 0, 'S5');
    expect(dispatch(s2, { type: 'play', seat: 1, cards: [s2.hands[1]!.find((c) => rankOf(c) === 4)!] }).error).toMatch(/压不过/);
    expect(dispatch(s2, { type: 'play', seat: 1, cards: C('S4 S6') }).error).toBeTruthy();
  });

  it('一轮里其他人都不要，最后出牌的人重新领出', () => {
    let s = playState(['S5 S9', 'S4 S6', 'S7 S8', 'D4 D6']);
    s = play(s, 0, 'S5');
    s = play(s, 1, 'S6');
    s = pass(s, 2);
    s = pass(s, 3);
    const r = act(s, { type: 'pass', seat: 0 });
    expect(r.events).toContainEqual({ type: 'trickWon', seat: 1, leader: 1, jiefeng: false });
    expect(r.state.turn).toBe(1);
    expect(r.state.trick.last).toBeNull();
  });

  it('接风：出完的人那一手没人要，由他的对家领出', () => {
    let s = playState(['S5', 'S4 S6', 'S7 S8 S9', 'D4 D6']);
    let r = act(s, { type: 'play', seat: 0, cards: s.hands[0]! });
    expect(r.events).toContainEqual({ type: 'finish', seat: 0, place: 1 });
    expect(r.state.turn).toBe(1);
    s = pass(r.state, 1);
    s = pass(s, 2);
    r = act(s, { type: 'pass', seat: 3 });
    expect(r.events).toContainEqual({ type: 'trickWon', seat: 0, leader: 2, jiefeng: true });
    expect(r.state.turn).toBe(2);
  });

  it('出完的人被压了，就照常由压的人继续', () => {
    let s = playState(['S5', 'S4 S6', 'S7 S8 S9', 'D4 D6']);
    s = play(s, 0, 'S5');
    s = play(s, 1, 'S6');
    s = pass(s, 2);
    const r = act(s, { type: 'pass', seat: 3 });
    expect(r.events).toContainEqual({ type: 'trickWon', seat: 1, leader: 1, jiefeng: false });
  });

  it('出完的人跳过，轮转只在没出完的人之间', () => {
    let s = playState(['S5', 'S4 S6', 'S7 S8 S9', 'D4 D6']);
    s = play(s, 0, 'S5');
    s = play(s, 1, 'S6');
    s = play(s, 2, 'S7');
    s = pass(s, 3);
    expect(s.turn).toBe(1);
  });

  it('指定解释：逢人配补的顺子可以选当 6 大还是 7 大', () => {
    const s = playState(['S3 D4 C5 S6 H2 SK', 'S4', 'S8', 'S9']);
    const cards = s.hands[0]!.filter((c) => rankOf(c) !== 13);
    const a = act(s, { type: 'play', seat: 0, cards, as: { type: 'straight', rank: 6 } });
    expect(a.state.trick.last!.play.rank).toBe(6);
    const b = act(s, { type: 'play', seat: 0, cards });
    expect(b.state.trick.last!.play.rank).toBe(7); // 领出时自动取最大的解释
    expect(dispatch(s, { type: 'play', seat: 0, cards, as: { type: 'straight', rank: 8 } }).error).toBeTruthy();
  });

  it('legalPlays / canPass / hint 只对轮到的座位有内容', () => {
    let s = playState(['S5 S9', 'S4 S6', 'S7 S8', 'D4 D6']);
    expect(legalPlays(viewFor(s, 1))).toEqual([]);
    expect(canPass(viewFor(s, 0))).toBe(false);
    s = play(s, 0, 'S5');
    const v = viewFor(s, 1);
    expect(canPass(v)).toBe(true);
    expect(hint(v).map((p) => p.rank)).toEqual([6]);
  });
});

/**
 * 直接构造"前几名已出完"的局面，再让决定名次的那个人出最后一张，触发结算。
 * （逐张打出来的流程由上面的出牌测试覆盖，这里只验名次与升级。）
 */
function finishInOrder(order: number[], opts: Parameters<typeof playState>[1] = {}): { state: GameState; events: ReturnType<typeof act>['events'] } {
  const doubleDown = order[0]! % 2 === order[1]! % 2;
  const done = doubleDown ? 1 : 2; // 已出完几人
  const hands = ['S6 S9', 'S6 S9', 'S6 S9', 'S6 S9'];
  for (let i = 0; i < done; i++) hands[order[i]!] = '';
  hands[order[done]!] = 'S5';
  const s = playState(hands, { ...opts, turn: order[done]! });
  s.finished = order.slice(0, done);
  return act(s, { type: 'play', seat: order[done]!, cards: [...s.hands[order[done]!]!] });
}

describe('名次与升级', () => {
  it('头游 + 二游（对手双下）升 3 级', () => {
    const { state } = finishInOrder([0, 2, 1, 3]);
    expect(state.phase).toBe('dealEnd');
    expect(state.lastDeal!.order.slice(0, 2)).toEqual([0, 2]);
    expect(state.lastDeal!.doubleDown).toBe(true);
    expect(state.lastDeal!.up).toBe(3);
    expect(state.levels).toEqual([5, 2]);
  });
  it('头游 + 三游升 2 级', () => {
    const { state } = finishInOrder([1, 0, 3, 2]);
    expect(state.lastDeal!.order).toEqual([1, 0, 3, 2]);
    expect(state.lastDeal!.up).toBe(2);
    expect(state.levels).toEqual([2, 4]);
  });
  it('头游 + 末游升 1 级', () => {
    const { state } = finishInOrder([2, 1, 3, 0]);
    expect(state.lastDeal!.order).toEqual([2, 1, 3, 0]);
    expect(state.lastDeal!.up).toBe(1);
    expect(state.levels).toEqual([3, 2]);
  });
  it('下一副打头游队的级；级数封顶在 A', () => {
    const { state } = finishInOrder([1, 3, 0, 2], { levels: [2, 13] });
    expect(state.levels).toEqual([2, 14]);
    const next = act(state, { type: 'nextDeal' }).state;
    expect(next.level).toBe(14);
    expect(next.declarer).toBe(1);
    expect(next.dealNo).toBe(state.dealNo + 1);
  });
});

describe('打 A', () => {
  const atA = { level: 14, declarer: 0, levels: [14, 9] as [number, number] };
  it('打 A 那副拿头游且对家是二游：过 A，赢下整局', () => {
    const { state, events } = finishInOrder([0, 2, 1, 3], atA);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBe(0);
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
    expect(dispatch(state, { type: 'nextDeal' }).error).toBeTruthy();
  });
  it('对家是三游也算过 A', () => {
    expect(finishInOrder([2, 1, 0, 3], atA).state.winner).toBe(0);
  });
  it('头游但对家末游：没过，记一次失败', () => {
    const { state } = finishInOrder([0, 1, 3, 2], atA);
    expect(state.phase).toBe('dealEnd');
    expect(state.aFails[0]).toBe(1);
    expect(state.levels[0]).toBe(14);
    expect(state.lastDeal!.aFailedTeam).toBe(0);
  });
  it('对手拿头游：没过，对手照常升级', () => {
    const { state } = finishInOrder([1, 3, 0, 2], atA);
    expect(state.aFails[0]).toBe(1);
    expect(state.levels).toEqual([14, 12]);
  });
  it('累计 3 次没过，退回打 2（次数可配置）', () => {
    const pre = playState(['S6 S9', '', 'S6 S9', 'S5'], { ...atA, turn: 3 });
    pre.finished = [1];
    pre.aFails = [2, 0];
    const x = act(pre, { type: 'play', seat: 3, cards: [...pre.hands[3]!] }).state;
    expect(x.lastDeal!.order.slice(0, 2)).toEqual([1, 3]);
    expect(x.lastDeal!.aResetTeam).toBe(0);
    expect(x.levels).toEqual([2, 12]);
    expect(x.aFails[0]).toBe(0);
    // aFailLimit = 0：永不退回
    const pre2 = playState(['S6 S9', '', 'S6 S9', 'S5'], { ...atA, turn: 3, options: { aFailLimit: 0 } });
    pre2.finished = [1];
    pre2.aFails = [9, 0];
    const y = act(pre2, { type: 'play', seat: 3, cards: [...pre2.hands[3]!] }).state;
    expect(y.levels[0]).toBe(14);
    expect(y.aFails[0]).toBe(10);
  });
  it('自己拿头游但对家末游、失败次数用完：退回打 2，这一副不再升级', () => {
    const pre = playState(['', 'S6 S9', 'S6 S9', 'S5'], { ...atA, turn: 3 });
    pre.finished = [0, 1];
    pre.aFails = [2, 0];
    const x = act(pre, { type: 'play', seat: 3, cards: [...pre.hands[3]!] }).state;
    expect(x.lastDeal!.order).toEqual([0, 1, 3, 2]);
    expect(x.levels).toEqual([2, 9]);
    expect(x.lastDeal!.up).toBe(0);
  });
  it('不是自己打 A 的那副，升到 A 不算过 A', () => {
    const { state } = finishInOrder([0, 2, 1, 3], { level: 9, declarer: 1, levels: [13, 9] });
    expect(state.phase).toBe('dealEnd');
    expect(state.levels[0]).toBe(14);
  });
});

/** 构造进贡阶段：上一副名次 order，四家手牌。 */
function tributeState(order: number[], hands: string[], level = 2): GameState {
  const s = playState(hands, { level });
  const doubleDown = order[1]! % 2 === order[0]! % 2;
  s.lastDeal = {
    dealNo: 1,
    order,
    winnerTeam: order[0]! % 2,
    up: 1,
    doubleDown,
    levelsBefore: [2, 2],
    levelsAfter: [2, 2],
    aFailedTeam: -1,
    aResetTeam: -1,
  };
  s.phase = 'tribute';
  s.turn = -1;
  const payers = doubleDown ? [order[2]!, order[3]!] : [order[3]!];
  s.tribute = {
    kind: doubleDown ? 'double' : 'single',
    entries: payers.map((p) => ({ from: p, to: doubleDown ? -1 : order[0]!, card: null, back: null })),
    leader: -1,
  };
  return s;
}

const cardOf = (s: GameState, seat: number, name: string) => {
  const w = C(name)[0]! % 54;
  const c = s.hands[seat]!.find((x) => x % 54 === w);
  if (c === undefined) throw new Error(`座位 ${seat} 没有 ${name}`);
  return c;
};

describe('进贡与还贡', () => {
  it('末游进贡最大的牌（红桃级牌除外），头游还 10 以下非级牌，进贡的人先出', () => {
    // 打 2：末游 3 有 H2（逢人配）、S2（级牌）、SA；最大的是 S2
    let s = tributeState([0, 1, 2, 3], ['S3 S10 DJ', 'S4', 'S5', 'H2 S2 SA S6']);
    expect(seatsToAct(s)).toEqual([3]);
    expect(viewFor(s, 3).myTribute!.allowed.map((c) => c % 54)).toEqual([C('S2')[0]! % 54]);
    expect(dispatch(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'SA') }).error).toMatch(/最大/);
    expect(dispatch(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'H2') }).error).toBeTruthy();
    let r = act(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'S2') });
    expect(r.events).toContainEqual({ type: 'tribute', from: 3, to: 0, card: cardOf(s, 3, 'S2') });
    s = r.state;
    expect(s.phase).toBe('return');
    expect(seatsToAct(s)).toEqual([0]);
    // 还贡不能还 J、不能还级牌 2
    expect(dispatch(s, { type: 'return', seat: 0, card: cardOf(s, 0, 'DJ') }).error).toBeTruthy();
    expect(dispatch(s, { type: 'return', seat: 0, card: cardOf(s, 0, 'S2') }).error).toBeTruthy();
    r = act(s, { type: 'return', seat: 0, card: cardOf(s, 0, 'S10') });
    s = r.state;
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(3);
    expect(s.hands[3]!.some((c) => rankOf(c) === 10)).toBe(true);
    expect(s.hands[0]!.some((c) => rankOf(c) === 2)).toBe(true);
    // 还贡的牌只有双方看得到
    expect(eventsFor(r.events, 1).find((e) => e.type === 'returnCard')).toMatchObject({ card: null });
    expect(eventsFor(r.events, 3).find((e) => e.type === 'returnCard')).toMatchObject({ card: cardOf(s, 3, 'S10') });
  });

  it('双下：两人都进贡，大的给头游、小的给二游，贡大的先出', () => {
    let s = tributeState([0, 2, 1, 3], ['S3', 'BJ S4', 'S5', 'SA S6']);
    expect(seatsToAct(s).sort()).toEqual([1, 3]);
    s = act(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'SA') }).state;
    expect(s.phase).toBe('tribute');
    // 双下未分配前，别人看不到已交的贡牌
    expect(viewFor(s, 0).tribute!.entries.find((e) => e.from === 3)!.card).toBeNull();
    const r = act(s, { type: 'tribute', seat: 1, card: cardOf(s, 1, 'BJ') });
    expect(r.events).toContainEqual({ type: 'tribute', from: 1, to: 0, card: cardOf(s, 1, 'BJ') });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'tribute', from: 3, to: 2 }));
    s = r.state;
    expect(seatsToAct(s).sort()).toEqual([0, 2]);
    s = act(s, { type: 'return', seat: 2, card: cardOf(s, 2, 'S5') }).state;
    s = act(s, { type: 'return', seat: 0, card: cardOf(s, 0, 'S3') }).state;
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
  });

  it('双下贡牌一样大：头游的下家进贡给头游，并先出', () => {
    let s = tributeState([2, 0, 3, 1], ['S3', 'SA S4', 'S5', 'DA S6']);
    s = act(s, { type: 'tribute', seat: 1, card: cardOf(s, 1, 'SA') }).state;
    const r = act(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'DA') });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'tribute', from: 3, to: 2 }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'tribute', from: 1, to: 0 }));
    expect(r.state.tribute!.leader).toBe(3);
  });

  it('还贡手里没有 10 以下的牌时，可以还任意非级牌', () => {
    // 注意 parseCards 里 SJ 是小王，J 用 DJ 表示
    let s = tributeState([0, 1, 2, 3], ['DJ DQ D2', 'S4', 'S5', 'SA S6']);
    s = act(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'SA') }).state;
    expect(viewFor(s, 0).myTribute!.allowed.map(rankOf).sort((a, b) => a - b)).toEqual([11, 12, 14]);
  });

  it('抗贡：进贡方有两张大王（双下时两人合计两张）就不进贡，头游先出', () => {
    let checked = { anti: 0, single: 0, double: 0 };
    for (let i = 0; i < 400; i++) {
      const doubleDown = i % 2 === 0;
      const order = doubleDown ? [0, 2, 1, 3] : [1, 0, 2, 3];
      const { state } = createGame(`anti-${i}`);
      state.phase = 'dealEnd';
      state.lastDeal = {
        dealNo: 1,
        order,
        winnerTeam: order[0]! % 2,
        up: doubleDown ? 3 : 1,
        doubleDown,
        levelsBefore: [2, 2],
        levelsAfter: [2, 2],
        aFailedTeam: -1,
        aResetTeam: -1,
      };
      const r = act(state, { type: 'nextDeal' });
      const payers = doubleDown ? [1, 3] : [3];
      const bj = payers.reduce((n, p) => n + r.state.hands[p]!.filter((c) => rankOf(c) === BIG_JOKER).length, 0);
      if (bj >= 2) {
        checked.anti++;
        expect(r.state.antiTribute).toBe(true);
        expect(r.events).toContainEqual({ type: 'antiTribute', seats: payers });
        expect(r.state.phase).toBe('play');
        expect(r.state.turn).toBe(order[0]);
      } else {
        expect(r.state.phase).toBe('tribute');
        expect(seatsToAct(r.state).sort()).toEqual(payers);
        if (doubleDown) checked.double++;
        else checked.single++;
      }
    }
    expect(checked.anti).toBeGreaterThan(10);
    expect(checked.single).toBeGreaterThan(10);
    expect(checked.double).toBeGreaterThan(10);
  });
});

/** 让四个电脑把一整局打完，记录全部动作。 */
function playWholeGame(seed: string, maxActions = 20000, options?: Partial<Options>): { actions: Action[]; states: GameState[] } {
  let { state } = createGame(seed, options);
  const actions: Action[] = [];
  const states: GameState[] = [state];
  while (state.phase !== 'gameOver' && actions.length < maxActions) {
    let a: Action;
    if (state.phase === 'dealEnd') a = { type: 'nextDeal' };
    else {
      const seat = seatsToAct(state)[0]!;
      a = decide(viewFor(state, seat), { seed, difficulty: 'normal' })!;
    }
    const r = dispatch(state, a);
    if (r.error) throw new Error(r.error);
    actions.push(a);
    state = r.state;
    states.push(state);
  }
  return { actions, states };
}

describe('短局（0.25.0，options.endLevel）', () => {
  it('升到 10 就赢下整局，不用打 A；默认还是要过 A', () => {
    for (const seed of ['short-1', 'short-2', 'short-3']) {
      const { states } = playWholeGame(seed, 20000, { endLevel: SHORT_END_LEVEL });
      const final = states[states.length - 1]!;
      expect(final.phase).toBe('gameOver');
      expect(final.levels[final.winner!]).toBeGreaterThanOrEqual(10);
      // 赢之前谁都没到 10
      const before = states[states.length - 2]!;
      expect(Math.max(...before.levels)).toBeLessThan(10);
      expect(states.every((x) => x.level < ACE)).toBe(true);
    }
    const full = playWholeGame('short-1').states;
    expect(full[full.length - 1]!.lastDeal!.levelsBefore[full[full.length - 1]!.winner!]).toBe(ACE);
  });

  it('旧存档没有 endLevel、配错的值，都按 A', () => {
    expect(endLevelOf({ options: { ...DEFAULT_OPTIONS } })).toBe(ACE);
    const old = { ...DEFAULT_OPTIONS } as Partial<Options>;
    delete old.endLevel;
    expect(endLevelOf({ options: old as Options })).toBe(ACE);
    expect(endLevelOf({ options: { ...DEFAULT_OPTIONS, endLevel: 99 } })).toBe(ACE);
    expect(endLevelOf({ options: { ...DEFAULT_OPTIONS, endLevel: 10 } })).toBe(10);
  });
});

describe('确定性、序列化与回放', () => {
  const { actions, states } = playWholeGame('replay-1');
  const final = states[states.length - 1]!;

  it('电脑能把整局打完', () => {
    expect(final.phase).toBe('gameOver');
    expect(final.winner === 0 || final.winner === 1).toBe(true);
  });

  it('同一种子 + 同一串动作 → 逐位相同的状态', () => {
    expect(JSON.stringify(replay('replay-1', undefined, actions))).toBe(JSON.stringify(final));
  });

  it('中途存档（JSON）再读回来继续，结果一致', () => {
    const mid = Math.floor(actions.length / 2);
    let s: GameState = JSON.parse(JSON.stringify(states[mid]));
    for (const a of actions.slice(mid)) s = dispatch(s, a).state;
    expect(JSON.stringify(s)).toBe(JSON.stringify(final));
  });

  it('同一种子的电脑决策也一样', () => {
    expect(playWholeGame('replay-1').actions).toEqual(actions);
  });

  it('dispatch 不修改传入的状态', () => {
    const s = states[10]!;
    const before = JSON.stringify(s);
    dispatch(s, actions[10]!);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('不同种子发的牌不同', () => {
    expect(createGame('a').state.hands).not.toEqual(createGame('b').state.hands);
  });
});

describe('玩家视角不泄露别人的手牌', () => {
  const { states } = playWholeGame('leak-1');
  it('任何时刻，视角里出现的牌只来自自己手牌和公开信息', () => {
    for (const s of states.filter((_, i) => i % 7 === 0)) {
      for (let seat = 0; seat < 4; seat++) {
        const v = viewFor(s, seat);
        const json = JSON.stringify(v);
        expect(json).not.toContain('"hands"');
        expect(v.hand.sort()).toEqual([...s.hands[seat]!].sort());
        // 别人手里的牌，只有交出过的贡牌（公开）和自己还给对方的牌能在视角里出现
        const allowed = new Set<number>();
        for (const e of v.tribute?.entries ?? []) {
          if (e.card !== null) allowed.add(e.card);
          if (e.back !== null) allowed.add(e.back);
        }
        const visible = new Set<number>([
          ...v.hand,
          ...v.history.flatMap((h) => h.play?.cards ?? []),
          ...(v.myTribute?.allowed ?? []),
          ...allowed,
        ]);
        for (let other = 0; other < 4; other++) {
          if (other === seat) continue;
          for (const c of s.hands[other]!) {
            if (visible.has(c)) expect(allowed.has(c), `座位 ${seat} 看到了座位 ${other} 的牌 ${c}`).toBe(true);
          }
        }
        // 视角里除了上面这些，不应再有别的牌字段
        expect(Object.keys(v)).not.toContain('hands');
      }
    }
  });

  it('第三方看不到还贡的牌', () => {
    const s = tributeState([0, 1, 2, 3], ['S3 S10 DJ', 'S4', 'S5', 'SA S6']);
    let x = act(s, { type: 'tribute', seat: 3, card: cardOf(s, 3, 'SA') }).state;
    x = act(x, { type: 'return', seat: 0, card: cardOf(x, 0, 'S3') }).state;
    expect(viewFor(x, 1).tribute!.entries[0]!.back).toBeNull();
    expect(viewFor(x, 2).tribute!.entries[0]!.back).toBeNull();
    expect(viewFor(x, 3).tribute!.entries[0]!.back).not.toBeNull();
    expect(viewFor(x, 1).tribute!.entries[0]!.card).not.toBeNull(); // 贡牌公开
  });
});
