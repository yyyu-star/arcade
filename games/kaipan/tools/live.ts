/**
 * 0.6.0 实盘模式的量测（docs/design-live.md 第 3 节）：某一档、某个机器人打 runs 局实盘，结回倍数的分布。
 * 真实行情，段按局号均匀覆盖（第 i 局用第 i % 段数 段），仓位 / 押跌 / 抵押都开（正式游戏都开）。
 * `npm run sim -- --live` 和 tests/live-sim.test.ts 共用。
 */
import { liveSetup, runSummary, type Action, type GameState, type LiveTier, type PersonaId } from '../src/core/index.ts';
import { botByName, playRun, useExt, useMarket, type Bot } from './bots.ts';
import { loadSegment, segmentIndex } from './segments-disk.ts';

/**
 * 真人打一局要多久（秒）：按机器人这局做了什么，一步一步加。
 * 动画和点按的下限来自自动试玩（docs/design-live.md 3.2：1 倍速、动画全开、每步不思考，一年 58 个交易日、41 个弹窗用了 780 秒，
 * 拆成每个交易日 11 秒、每个弹窗 3.5 秒）；思考的部分是推断：每个交易日看群聊和推荐 15 秒、每次买卖 3 秒、每个弹窗读 4 秒、
 * 月底三选一多想 10 秒，开局和结算各 15 秒。
 */
export const STEP_SECONDS = { day: 11 + 15, trade: 3, popup: 3.5 + 4, reward: 10, frame: 30 } as const;

const TRADES = new Set<Action['type']>(['buy', 'sell', 'add', 'trim', 'borrow', 'repay']);

/** 包一层：记下机器人做了几次什么，按 STEP_SECONDS 估时 */
export function timed(inner: Bot): { bot: Bot; seconds: () => number; reset: () => void } {
  let days = 0;
  let trades = 0;
  let popups = 0;
  let rewards = 0;
  let months = 0;
  let lastMonth = 0;
  return {
    bot: {
      name: inner.name,
      act(s: GameState, rng) {
        const a = inner.act(s, rng);
        if (s.month !== lastMonth) {
          lastMonth = s.month;
          months++;
        }
        if (a.type === 'open') days++;
        else if (TRADES.has(a.type)) trades++;
        else if (a.type === 'choose') popups++;
        else if (a.type === 'pickReward' || a.type === 'skipReward') rewards++;
        return a;
      },
    },
    // 每个月月初的账单、月底的小结各算一个弹窗；三选一另算
    seconds: () => STEP_SECONDS.frame + days * STEP_SECONDS.day + trades * STEP_SECONDS.trade + (popups + months * 2) * STEP_SECONDS.popup + rewards * STEP_SECONDS.reward,
    reset: () => {
      days = trades = popups = rewards = months = lastMonth = 0;
    },
  };
}

export interface LiveStats {
  tier: LiveTier;
  bot: string;
  runs: number;
  /** 平均结回（份，1 = 不赚不亏） */
  mean: number;
  /** 标准误 */
  se: number;
  sd: number;
  /** 赚了的局（结回 > 1 份）占比 */
  up: number;
  /** 结回 0 的局（破产或赔光）占比 */
  zero: number;
  /** 结回在 0–2 份之间（输赢 ±1 份以内）的局占比 */
  within: number;
  /** 碰到 3 倍封顶的局占比 */
  capped: number;
  p10: number;
  p50: number;
  p90: number;
  /** 真人打一局约几分钟（按 STEP_SECONDS 估） */
  minutes: number;
}

/** 段按局号均匀覆盖；同一前缀、同一局号在各档、各机器人之间用同一段，比较高低时误差更小 */
export function useLiveMarket(prefix: string): void {
  const segs = segmentIndex().segments;
  const cache = new Map<string, ReturnType<typeof loadSegment>>();
  useMarket((seed) => {
    const i = Number(seed.slice(prefix.length + 1));
    const id = (segs[(Number.isInteger(i) ? i : 0) % segs.length] as { id: string }).id;
    if (!cache.has(id)) cache.set(id, loadSegment(id));
    return cache.get(id) ?? null;
  });
  useExt(true);
}

export function liveStats(tier: LiveTier, bot: string, runs: number, prefix = 'live', persona: PersonaId = 'newbie'): LiveStats {
  useLiveMarket(prefix);
  const ms: number[] = [];
  const t = timed(botByName(bot)());
  let sec = 0;
  for (let i = 0; i < runs; i++) {
    t.reset();
    const end = playRun(`${prefix}-${i}`, t.bot, liveSetup(tier, persona));
    sec += t.seconds();
    if (end.phase !== 'won' && end.phase !== 'lost') throw new Error(`${bot} 在 ${prefix}-${i} 没打完`);
    ms.push((runSummary(end).live?.bp ?? 0) / 10_000);
  }
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / runs;
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, runs - 1));
  const share = (f: (m: number) => boolean): number => ms.filter(f).length / runs;
  const q = (p: number): number => ms[Math.min(runs - 1, Math.floor(p * runs))] ?? 0;
  return {
    tier,
    bot,
    runs,
    mean,
    se: sd / Math.sqrt(runs),
    sd,
    up: share((m) => m > 1),
    zero: share((m) => m === 0),
    within: share((m) => m <= 2),
    capped: share((m) => m >= 3),
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    minutes: sec / runs / 60,
  };
}
