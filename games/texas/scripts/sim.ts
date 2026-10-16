/**
 * 机器人模拟和性能实测（DESIGN.md 4.3、4.4）：
 * - npm run sim [手数] [档位] [--size=人数]：性格混在 6 人桌（--size 改成 2–9 人；每场从 10 种里洗出几种、换座位）打很多手，看每种性格每百手赢多少大盲：不能有一种碾压或白送（多线程，见 vs.ts）；
 *   再单线程打 6,000 手测电脑单次决策和一批、规则每步的耗时，以及牌力评估、蒙特卡洛。数字写进 PR 描述。
 * - npm run sim -- --vs [每格场数] [档位,...] [策略,...] [--size=人数]：每档 × 每种策略（test/strategies.ts）一个玩家对（人数 − 1）个电脑，
 *   一场 100 手，打印每百手大盲（± 一个标准误）和赢的场次比例。
 * - npm run sim -- --balance [每格场数]：配平（0.12.0）：小白、普通对单机各档、娱乐各难度，每场输赢（份）和赢的场次，见 balance.ts。--humans=<玩家数>（0.4.0）：几个玩家合起来对电脑；--level=0–5（0.5.0）指定电脑的强弱档，--room 按好友房的档（DESIGN.md 4.7、6.5）。
 */
import { stream } from 'arcade-kit/rng';
import { equity } from '../src/ai/equity.ts';
import { mcIters } from '../src/ai/decide.ts';
import { parseCards } from '../src/core/cards.ts';
import type { StakesId } from '../src/core/stakes.ts';
import { evalMasks } from '../src/core/eval.ts';
import { runBots } from '../test/bots.ts';
import { mixMain, sizeArg, vsMain } from './vs.ts';

if (process.argv.includes('--balance')) {
  const { balanceMain } = await import('./balance.ts');
  await balanceMain(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  process.exit(0);
}
if (process.argv.includes('--vs')) {
  await vsMain(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  process.exit(0);
}

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const HANDS = Number(pos[0] ?? 20_000);
const STAKES_ID = (pos[1] ?? 'small') as StakesId;
const SIZE = sizeArg();
const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const fmt = (x: number): string => x.toFixed(3);

// 1. 性格对打
await mixMain(HANDS, STAKES_ID, SIZE);
if (process.argv.includes('--mix-only')) process.exit(0);

// 2. CPU：单线程（多线程同时跑会互相拖慢）
{
  const st = runBots({ seed: [1, 2, 3, 4, 5, 6, 7, 8], size: SIZE, hands: 6_000, stakes: STAKES_ID, chaos: false, timing: true });
  const { decideMs: decide, applyMs: applied, batchMs: batch } = st;
  console.log(`\nCPU（单线程 ${st.hands} 手）`);
  console.log(`电脑决策 ${decide.length} 次：p50 ${fmt(q(decide, 0.5))} / p99 ${fmt(q(decide, 0.99))} / 最大 ${fmt(q(decide, 1))} ms`);
  console.log(`规则每步（apply）${applied.length} 次：p50 ${fmt(q(applied, 0.5))} / p99 ${fmt(q(applied, 0.99))} ms`);
  console.log(`一批（真人两次说话之间）${batch.length} 次：p50 ${fmt(q(batch, 0.5))} / p99 ${fmt(q(batch, 0.99))} / 最大 ${fmt(q(batch, 1))} ms`);
}

// 3. 牌力评估：随机 7 张（不是增量更新掩码，比全量测试保守）
{
  const r = stream([9, 9, 9, 9, 9, 9, 9, 9], 'bench');
  const N = 2_000_000;
  const hands = new Int32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const used = new Set<number>();
    while (used.size < 7) used.add(r.below(52));
    for (const c of used) hands[i * 4 + (c & 3)]! |= 1 << (c >> 2);
  }
  let x = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) x ^= evalMasks(hands[i * 4]!, hands[i * 4 + 1]!, hands[i * 4 + 2]!, hands[i * 4 + 3]!);
  const ms = performance.now() - t0;
  console.log(`\n牌力评估（随机 7 张，预先拆好掩码）：${N} 手 ${ms.toFixed(0)} ms，约 ${Math.round(N / ms / 1000)} 百万手/秒（${x & 1}）`);
}

// 4. 蒙特卡洛（翻牌后）
console.log('\n蒙特卡洛（KQ，次数按 mcIters）：');
for (const [opp, bl] of [[1, 3], [1, 5], [3, 3], [5, 3], [5, 5]] as const) {
  const hole = parseCards('Ks Qd');
  const board = parseCards('2c 7h Jd 3s 9c').slice(0, bl);
  const ts: number[] = [];
  for (let i = 0; i < 2500; i++) {
    const t0 = performance.now();
    equity(hole, board, opp, mcIters(opp), stream([1, 2, 3, 4, 5, 6, 7, 8], 'mc', i));
    ts.push(performance.now() - t0);
  }
  ts.splice(0, 500);
  console.log(`  ${opp} 个对手、公共牌 ${bl} 张、${mcIters(opp)} 次：p50 ${fmt(q(ts, 0.5))} / p99 ${fmt(q(ts, 0.99))} ms`);
}
