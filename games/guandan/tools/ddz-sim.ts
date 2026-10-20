/**
 * 斗地主电脑的模拟（docs/ai.md「斗地主」一节的表从这里来）：
 *
 *   node tools/ddz-sim.ts [--deals 2000]
 *
 * - 梯度：每一档（新手、普通、高手）坐 0 号位，对手是下一档低的两家（新手的对手是随机）；一副一局，
 *   0 号位当地主时的胜率、当农民时（他这一边）的胜率、平均每副的分。同档对打的地主胜率作参照；
 * - 决策耗时：三档各自的单次决策（叫分、出牌）p50 / p99 / 最大，毫秒；
 * - 公平性自检：每一副都检查没有非法动作、三家分数和为 0。
 * 随机机器人：叫分和出牌每步从合法动作里随机挑（出牌从 enumerate 的结果和"不要"里挑）。
 */
import { performance } from 'node:perf_hooks';
import { createDdz, dispatchDdz, enumerateDdz, playsBeatingDdz, sortDdz, viewDdz, type DdzAction, type DdzView } from '../src/variants/doudizhu/core/index.ts';
import { decideDdz, type DdzLevel } from '../src/variants/doudizhu/ai/index.ts';
import { rngFor } from '../src/core/rng.ts';

type Bot = 'random' | DdzLevel;

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

function randomAction(v: DdzView, seed: string): DdzAction {
  const rng = rngFor(seed, 'random-bot', v.dealNo, v.seat, v.step);
  if (v.phase === 'bid') {
    const ok = [0, 1, 2, 3].filter((b) => b === 0 || b > v.bid);
    return { type: 'bid', seat: v.seat, bid: rng.pick(ok) };
  }
  const opts = v.target ? playsBeatingDdz(v.hand, v.target.play) : enumerateDdz(v.hand);
  const all: (DdzAction)[] = opts.map((p) => ({ type: 'play', seat: v.seat, cards: p.cards }));
  if (v.target) all.push({ type: 'pass', seat: v.seat });
  return rng.pick(all);
}

interface Timing {
  samples: number[];
}
const timing: Record<string, Timing> = { novice: { samples: [] }, normal: { samples: [] }, pro: { samples: [] } };

function act(bot: Bot, v: DdzView, seed: string): DdzAction {
  if (bot === 'random') return randomAction(v, seed);
  const t0 = performance.now();
  const a = decideDdz(v, bot, seed);
  timing[bot]!.samples.push(performance.now() - t0);
  if (!a) throw new Error('电脑没给动作');
  return a;
}

/** 打一副（一副一局），返回 0 号位的情况 */
function playDeal(bots: readonly [Bot, Bot, Bot], seed: string, forceLandlord = -1): { landlord: number; delta: number[]; landlordWon: boolean } {
  let s = createDdz(seed, { deals: 1 }).state;
  if (forceLandlord >= 0) {
    // 跳过叫分：指定的座位当 1 分地主，拿底牌先出（只比打牌，不含叫分的高低）
    const hands = s.hands.map((h) => h.slice());
    hands[forceLandlord] = sortDdz([...hands[forceLandlord]!, ...s.bottom]);
    s = { ...s, phase: 'play', landlord: forceLandlord, bid: 1, turn: forceLandlord, hands, bids: [null, null, null] };
  }
  for (let guard = 0; guard < 5000 && s.phase !== 'gameOver'; guard++) {
    const seat = s.turn;
    const a = act(bots[seat]!, viewDdz(s, seat), `${seed}/ai${seat}`);
    const r = dispatchDdz(s, a);
    if (r.error) throw new Error(`非法动作 ${r.error}：${JSON.stringify(a)}（${seed}）`);
    s = r.state;
  }
  if (s.phase !== 'gameOver') throw new Error(`死锁（${seed}）`);
  const res = s.results[0]!;
  if (res.delta.reduce((x, y) => x + y, 0) !== 0) throw new Error(`不零和（${seed}）`);
  return { landlord: res.landlord, delta: res.delta, landlordWon: res.landlordWon };
}

/** 0 号位当地主（跳过叫分），打满 n 副；wins 数的是"被测这一边赢了"：被测当地主（seats = [X, L, L]）数地主赢，被测当农民（seats = [L, X, X]）数农民赢 */
function stat(seats: readonly [Bot, Bot, Bot], xIsLandlord: boolean, n: number, tag: string): { n: number; wins: number } {
  const st = { n: 0, wins: 0 };
  for (let i = 0; i < n; i++) {
    const r = playDeal(seats, `ddz-sim-${tag}-${i}`, 0);
    st.n++;
    if (r.landlordWon === xIsLandlord) st.wins++;
  }
  return st;
}

/** 被测一席（0 号位）对两家对手打 n 副（座位靠首叫的人随机轮到），不挑谁当地主，给平均每副分和标准误 */
function overall(x: Bot, l: Bot, n: number, tag: string): { mean: number; se: number } {
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = playDeal([x, l, l], `ddz-sim-${tag}-${i}`).delta[0]!;
    sum += d;
    sq += d * d;
  }
  const mean = sum / n;
  return { mean, se: Math.sqrt(Math.max(0, sq / n - mean * mean) / n) };
}

const pct = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const names: Record<Bot, string> = { random: '随机', novice: '新手', normal: '普通', pro: '高手' };

/** 稳定性检查：随机机器人 2 万副（每步从合法动作里随机挑）、三档混打 1,000 副，任何非法动作、死锁、不零和都会抛错 */
function stability(): void {
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) {
    let s = createDdz(`ddz-sim-rand-${i}`, { deals: 1 }).state;
    for (let guard = 0; s.phase !== 'gameOver'; guard++) {
      if (guard > 5000) throw new Error(`死锁（随机 ${i}）`);
      const r = dispatchDdz(s, randomAction(viewDdz(s, s.turn), `rand-${i}`));
      if (r.error) throw new Error(`非法动作 ${r.error}（随机 ${i}）`);
      s = r.state;
    }
    if (s.results[0]!.delta.reduce((x, y) => x + y, 0) !== 0) throw new Error(`不零和（随机 ${i}）`);
  }
  const lv: Bot[] = ['novice', 'normal', 'pro'];
  for (let i = 0; i < 1000; i++) playDeal([lv[i % 3]!, lv[(i + 1 + (i % 2)) % 3]!, lv[(i + 2 - (i % 2)) % 3]!], `ddz-sim-mix-${i}`);
  console.log(`稳定性：随机机器人 20,000 副 + 三档混打 1,000 副，没有非法动作、没有死锁、每副三家分数和为 0（${((performance.now() - t0) / 1000).toFixed(0)} 秒）\n`);
}

function main(): void {
  const deals = Number(arg('deals', '2000'));
  stability();
  console.log(`每格 ${deals} 副（一副一局）。打牌两列：跳过叫分，0 号位固定当 1 分地主（或另两家当地主），同样的牌力下只比怎么打；最后一列带叫分，被测占 0 号位对两家对手。\n`);
  console.log('| 被测 | 对手 | 打牌：被测当地主，胜率 | 打牌：被测的两家当农民，胜率 | 对照：对手同档互打，地主胜率 | 含叫分：被测一席对两家对手，平均每副分 ± 标准误 |');
  console.log('|---|---|---|---|---|---|');
  const pairs: [Bot, Bot][] = [['novice', 'random'], ['normal', 'novice'], ['pro', 'normal'], ['normal', 'random'], ['pro', 'random'], ['pro', 'novice']];
  const base = new Map<Bot, string>();
  for (const [x, l] of pairs) {
    const t0 = performance.now();
    if (!base.has(l)) {
      const b = stat([l, l, l], true, deals, `base-${l}`);
      base.set(l, pct(b.wins, b.n));
    }
    const land = stat([x, l, l], true, deals, `${x}-${l}-L`);
    const farm = stat([l, x, x], false, deals, `${x}-${l}-F`);
    const all = overall(x, l, deals, `${x}-${l}-A`);
    console.log(`| ${names[x]} | ${names[l]}（两家） | ${pct(land.wins, land.n)} | ${pct(farm.wins, farm.n)} | ${base.get(l)} | ${all.mean.toFixed(2)} ± ${all.se.toFixed(2)} |`);
    process.stderr.write(`  ${names[x]} vs ${names[l]} 用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒\n`);
  }
  console.log('\n单次决策耗时（毫秒）：\n');
  console.log('| 档位 | 次数 | p50 | p99 | 最大 |');
  console.log('|---|---|---|---|---|');
  for (const lv of ['novice', 'normal', 'pro'] as const) {
    const xs = timing[lv]!.samples.sort((x, y) => x - y);
    if (!xs.length) continue;
    const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!.toFixed(2);
    console.log(`| ${names[lv]} | ${xs.length} | ${q(0.5)} | ${q(0.99)} | ${xs[xs.length - 1]!.toFixed(1)} |`);
  }
}

main();
