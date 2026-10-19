/**
 * 锦标赛模拟：node scripts/tour-sim.ts <场数> [--every N]
 * 电脑打全部 6 个座位（0 号当真人，用电脑的操作代打），量平均手数，按每手耗时假设折算分钟，再数各座位拿到各名次的次数（应近似均匀）。
 * 耗时假设见 src/tour/rules.ts 的 BOT_ACT_SEC、HUMAN_ACT_SEC、HAND_GAP_SEC。
 */
import { stream } from 'arcade-kit/rng';
import { isFail } from '../src/core/table.ts';
import { BLINDS, BOT_ACT_SEC, HAND_GAP_SEC, HANDS_PER_LEVEL, HUMAN_ACT_SEC, newTour, tourAi, tourApply, type TourState } from '../src/tour/rules.ts';

const args = process.argv.slice(2);
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const ei = args.indexOf('--every');
const every = ei >= 0 ? Number(args[ei + 1]) : HANDS_PER_LEVEL;

const mins: number[] = [];
const hands: number[] = [];
const bySeat = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
const maxLevel: number[] = [];
for (let g = 0; g < games; g++) {
  const e = stream([0x7406, g, 1, 2, 3, 4, 5, 6], 'seed');
  const seed = Array.from({ length: 8 }, () => e.below(0x100000000));
  let s: TourState = newTour({ humans: [true, false, false, false, false, false], every }, seed);
  let sec = 0;
  while (!s.over) {
    const seat = s.table.toAct!;
    const was = s.table.handNo;
    const m = tourAi({ ...s, auto: s.auto.map(() => true) });
    if (!m) throw new Error('no actor');
    const r = tourApply(s, seat, m.action);
    if (isFail(r)) throw new Error(r.error);
    sec += seat === 0 ? HUMAN_ACT_SEC : BOT_ACT_SEC;
    if (r.table.handNo !== was || r.over) sec += HAND_GAP_SEC;
    s = r;
  }
  hands.push(s.table.handNo);
  mins.push(sec / 60);
  maxLevel.push(s.level);
  s.places.forEach((p, i) => bySeat[i]![p! - 1]!++);
}
const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)]!;
console.log(`场数 ${games}，每 ${every} 手涨一级，盲注表 ${BLINDS.map((b) => b.join('/')).join(' ')}`);
console.log(`平均手数 ${avg(hands).toFixed(1)}（中位 ${q(hands, 0.5)}，P10 ${q(hands, 0.1)}，P90 ${q(hands, 0.9)}）`);
console.log(`折算 ${avg(mins).toFixed(1)} 分钟（中位 ${q(mins, 0.5).toFixed(1)}，P10 ${q(mins, 0.1).toFixed(1)}，P90 ${q(mins, 0.9).toFixed(1)}）`);
console.log(`打到的最高级别：平均 ${(avg(maxLevel) + 1).toFixed(1)} / ${BLINDS.length}`);
console.log('各座位拿到第 1–6 名的次数：');
bySeat.forEach((row, i) => console.log(`  座位 ${i}: ${row.join(' ')}`));
