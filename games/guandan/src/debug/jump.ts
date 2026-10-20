/**
 * 调试跳转：用电脑把局面推进到指定阶段（全部走核心的 dispatch，打 A 的跳转除外——见下）。
 */
import { decide } from '../variants/guandan/ai/index.ts';
import { createGame, dispatch, hashSeed, seatsToAct, viewFor, type GameEvent, type GameState, type Options } from '../variants/guandan/core/index.ts';

function botStep(s: GameState): GameState {
  const seat = seatsToAct(s)[0]!;
  // 和单机电脑一样不直接给牌局种子（session.ts 的 soloSeeds）
  const a = decide(viewFor(s, seat), { seed: hashSeed(s.seed, 'jump'), difficulty: 'normal' });
  if (!a) throw new Error('jump: 电脑没有动作');
  const r = dispatch(s, a);
  if (r.error) throw new Error(`jump: ${r.error}`);
  return r.state;
}

/** 打完当前这一副（停在 dealEnd 或 gameOver）。 */
export function finishDeal(s: GameState): GameState {
  let guard = 0;
  while (s.phase !== 'dealEnd' && s.phase !== 'gameOver' && guard++ < 5000) s = botStep(s);
  return s;
}

/** 第二副的进贡阶段（抗贡的种子换一个再试）。 */
export function jumpToTribute(seed: string, options?: Partial<Options>): { state: GameState; events: GameEvent[] } {
  for (let i = 0; i < 30; i++) {
    const sd = i === 0 ? seed : `${seed}~${i}`;
    let s = finishDeal(createGame(sd, options).state);
    const r = dispatch(s, { type: 'nextDeal' });
    s = r.state;
    if (s.phase === 'tribute') return { state: s, events: r.events };
  }
  throw new Error('jump: 找不到进贡的局面');
}

/**
 * 打 A：先打完第一副，再把两队级数直接改成 A / K（调试专用的捷径，正式流程不会这样改状态），然后开下一副。
 */
export function jumpToAce(seed: string, options?: Partial<Options>): { state: GameState; events: GameEvent[] } {
  const s = finishDeal(createGame(seed, options).state);
  const w = s.lastDeal!.winnerTeam;
  const hacked: GameState = { ...s, levels: w === 0 ? [14, 13] : [13, 14] };
  const r = dispatch(hacked, { type: 'nextDeal' });
  return { state: r.state, events: r.events };
}
