/**
 * 立直麻将的模拟器（docs/riichi.md 第 2、7 节）：四个电脑照线上的场地表挑性格、配状态，打 N 场，量一场的长短、各种率和一场结束得分的分布，
 * 再按"一份换多少点"（SHARE_POINTS）算输掉整份、赢满 3 份封顶的比例，定换筹码的 K。
 * 用法：node scripts/sim-riichi.ts [场数，默认 200] [hanchan|tonpuu，默认 hanchan] [场地，默认 solo:mid；room:big 是四个火锅婆婆]
 */
import { stream } from 'arcade-kit/rng';
import { AIS } from '../src/ai/index.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { seatPlan, VENUES } from '../src/ai/venues.ts';
import { riichi as RC, SHARE_POINTS, type RcState, type RcView } from '../src/core/variants/riichi/index.ts';
import type { VariantAi } from '../src/core/variants/types.ts';
import { baseOf } from '../src/game/stakes.ts';
import { pct } from './play.ts';

const N = Number(process.argv[2] ?? 200);
const LENGTH = (process.argv[3] ?? 'hanchan') as 'hanchan' | 'tonpuu';
const VENUE = process.argv[4] ?? 'solo:mid';
if (!VENUES[VENUE]) throw new Error(`没有这个场地：${VENUE}`);
if (LENGTH !== 'hanchan' && LENGTH !== 'tonpuu') throw new Error('第二个参数是 hanchan 或 tonpuu');
const SHARE = 2_000;
const ai = AIS[RC.id]! as VariantAi<RcView, ReturnType<typeof RC.auto>>;

const scores: number[] = [];
const hands: number[] = [];
const steps: number[] = [];
const decideMs: number[] = [];
let wins = 0;
let tsumo = 0;
let dealIn = 0;
let riichi = 0;
let draws = 0;
let rounds = 0;
let winPts = 0;
let yakuman = 0;
const ends = new Map<string, number>();
/** 每个性格：坐了几个座位、名次总和、和了、放铳、立直、局数 */
const by = new Map<number, { n: number; rank: number; win: number; deal: number; riichi: number; rounds: number }>();

for (let i = 0; i < N; i++) {
  const key = [i, 2026, 10, 20, 7, 7, 7, 7];
  const plan = seatPlan(stream(key, 'persona'), VENUE, 4);
  let s = RC.begin(key, { length: LENGTH }, ['ai', 'ai', 'ai', 'ai'], { share: SHARE, base: baseOf(SHARE), personas: plan.personas, tunes: plan.tunes }) as RcState;
  let n = 0;
  for (; n < 200_000 && !RC.over(s); n++) {
    const act = RC.actors(s);
    if (!act || !act.seats.length) {
      s = RC.resume(s);
      continue;
    }
    const seat = act.seats[0]!;
    const t0 = performance.now();
    const a = RC.auto(s, seat, ai);
    decideMs.push(performance.now() - t0);
    const next = RC.apply(s, seat, a);
    if ('error' in next) throw new Error(`move rejected: ${next.error} ${JSON.stringify(a)}`);
    s = next;
  }
  if (!RC.over(s)) throw new Error('一场没打完');
  steps.push(n);
  hands.push(s.history.length);
  scores.push(...s.final!.score);
  for (const h of s.history) {
    rounds++;
    ends.set(h.end, (ends.get(h.end) ?? 0) + 1);
    if (h.wins.length) {
      wins += h.wins.length;
      for (const w of h.wins) {
        winPts += w.gain;
        if (w.score.yakuman > 0) yakuman++;
        if (w.from === null) tsumo++;
        else dealIn++;
      }
    } else if (h.end === 'draw' || h.end === 'nagashi') draws++;
  }
  riichi += s.stats.reduce((a, x) => a + x.riichi, 0);
  s.personas.forEach((p, seat) => {
    const b = by.get(p) ?? { n: 0, rank: 0, win: 0, deal: 0, riichi: 0, rounds: 0 };
    const st = s.stats[seat]!;
    b.n++;
    b.rank += s.final!.rank.indexOf(seat) + 1;
    b.win += st.wins;
    b.deal += st.dealIn;
    b.riichi += st.riichi;
    b.rounds += s.history.length;
    by.set(p, b);
  });
}

const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
const abs = scores.map(Math.abs);
const frac = (pred: (x: number) => boolean): string => ((scores.filter(pred).length / scores.length) * 100).toFixed(1) + '%';
const decisions = decideMs.length;
console.log(`${LENGTH} ${VENUE}，${N} 场，每场座位 ${scores.length / N} 个`);
console.log(`每场 ${mean(hands).toFixed(1)} 局、${mean(steps).toFixed(0)} 步（p50 ${pct(hands, 50)} 局）`);
console.log(
  `每局：和了 ${((wins / rounds) * 100).toFixed(1)}%（自摸 ${((tsumo / Math.max(1, wins)) * 100).toFixed(0)}%）  放铳 ${((dealIn / rounds) * 100).toFixed(1)}%  ` +
    `立直 ${((riichi / rounds) * 100).toFixed(1)}%（每家 ${((riichi / rounds / 4) * 100).toFixed(1)}%）  流局 ${((draws / rounds) * 100).toFixed(1)}%  役满 ${yakuman} 次`,
);
console.log(`结局：${[...ends].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('，')}`);
console.log(`平均打点 ${(winPts / Math.max(1, wins)).toFixed(0)}（每次和了，含本场供托）`);
console.log(`决定 ${decisions} 次，平均 ${(mean(decideMs)).toFixed(2)} 毫秒，p99 ${pct(decideMs, 99).toFixed(1)} 毫秒`);
console.log(
  `一场结束得分：均值 ${mean(scores).toFixed(0)}  |得分| P50 ${pct(abs, 50)}  P90 ${pct(abs, 90)}  P99 ${pct(abs, 99)}  ` +
    `超过 ±50,000 ${frac((x) => Math.abs(x) > 50_000)}  ±100,000 ${frac((x) => Math.abs(x) > 100_000)}  ±150,000 ${frac((x) => Math.abs(x) > 150_000)}`,
);
console.log(`\n每份换多少点（现行 SHARE_POINTS = ${SHARE_POINTS[LENGTH].toLocaleString('en')}）：输掉整份 = 得分 ≤ −份；赢满 3 份封顶 = 得分 ≥ 3 × 份`);
for (const k of [30_000, 40_000, 50_000, 60_000, 80_000, 100_000]) {
  console.log(
    `  ${String(k).padStart(7)}：输掉整份 ${frac((x) => x <= -k).padStart(6)}  赢满 3 份 ${frac((x) => x >= 3 * k).padStart(6)}  赢超过 1 份 ${frac((x) => x >= k).padStart(6)}`,
  );
}

console.log('\n性格（座位数、平均名次、每局和了 / 放铳 / 立直）');
for (const [p, b] of [...by].sort((a, b) => a[0] - b[0])) {
  const r = (x: number): string => ((x / b.rounds) * 100).toFixed(1) + '%';
  console.log(`  ${PERSONAS[p]!.name.padEnd(4, '　')} ${String(b.n).padStart(4)} 座  名次 ${(b.rank / b.n).toFixed(2)}  和了 ${r(b.win)}  放铳 ${r(b.deal)}  立直 ${r(b.riichi)}`);
}
