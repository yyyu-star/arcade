import { createGame, parseCards, sortHand, type Card, type GameState, type Play, type Options, dispatch, type Action, type GameEvent } from '../src/variants/guandan/core/index.ts';

export const C = parseCards;

/** 造一个出牌阶段的局面：四家手牌用 parseCards 的写法给出（两副牌里同一张最多出现两次）。 */
export function playState(hands: string[], opts: { level?: number; turn?: number; options?: Partial<Options>; declarer?: number; levels?: [number, number] } = {}): GameState {
  const { state } = createGame('test', opts.options);
  const level = opts.level ?? 2;
  // 跨座位去重：parseCards 每次独立解析，这里统一分配副号，保证 108 张里没有重复 id
  const used = new Set<Card>();
  const parsed = hands.map((h) =>
    C(h).map((c) => {
      let x = c;
      if (used.has(x)) x = (x + 54) % 108;
      if (used.has(x)) throw new Error('同一张牌超过两张');
      used.add(x);
      return x;
    }),
  );
  state.level = level;
  state.hands = parsed.map((h) => sortHand(h, level));
  state.phase = 'play';
  state.turn = opts.turn ?? 0;
  state.trick = { leader: state.turn, last: null, passed: [false, false, false, false] };
  state.history = [];
  state.finished = [];
  state.declarer = opts.declarer ?? -1;
  if (opts.levels) state.levels = opts.levels;
  return state;
}

export function act(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const r = dispatch(state, action);
  if (r.error) throw new Error(`${JSON.stringify(action)}: ${r.error}`);
  return r;
}

export function play(state: GameState, seat: number, cards: string): GameState {
  const hand = state.hands[seat]!;
  const want = C(cards);
  // 按牌面在手里找对应的牌（不管副号）
  const picked: Card[] = [];
  for (const w of want) {
    const c = hand.find((x) => (x % 54) === (w % 54) && !picked.includes(x));
    if (c === undefined) throw new Error(`座位 ${seat} 手里没有 ${cards}`);
    picked.push(c);
  }
  return act(state, { type: 'play', seat, cards: picked }).state;
}

export function pass(state: GameState, seat: number): GameState {
  return act(state, { type: 'pass', seat }).state;
}

export const shape = (p: Play) => `${p.type}:${p.rank}${p.extra >= 0 ? ':' + p.extra : ''}`;
