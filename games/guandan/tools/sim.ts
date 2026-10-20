/**
 * 机器人对打：检查不死锁、不出非法牌、整局都能打完，并比较电脑对手和随机出牌机器人的胜率。
 *
 *   node tools/sim.ts                              默认：电脑 vs 随机，打满 5000 副（整局为单位，最后一局打完为止）
 *   node tools/sim.ts --deals 2000 --mode ai       电脑 vs 电脑（同难度），只看稳定性
 *   node tools/sim.ts --mode greedy                电脑 vs 贪心机器人（能压就压最小的）
 *   node tools/sim.ts --mode easy-vs-hard          两种难度对打（格式 <甲>-vs-<乙>，甲乙可以是 easy|normal|hard|old|prev|random|greedy）
 *   node tools/sim.ts --mode normal-vs-old         新普通对旧普通（old = tools/baseline-ai 里 0.1.0 的电脑，只做基准）
 *   node tools/sim.ts --mode normal-vs-prev        新普通对 0.1.2 普通（prev = tools/baseline-ai-0.1.2）
 *   --seed 前缀（默认 sim）  --difficulty normal|easy|hard（电脑一方的难度，默认 normal）
 *
 * 每局交换座位：偶数局电脑坐 0/2，奇数局坐 1/3，消除首出等座位偏差。
 * 任何非法动作、死锁（一副超过 3000 步）或单局超过 300 副都计入问题并让退出码为 1。
 */
import { performance } from 'node:perf_hooks';
import { createGame, dispatch, hint, seatsToAct, teamOf, viewFor, type Action, type GameState, type PlayerView } from '../src/variants/guandan/core/index.ts';
import { decide, randomAction, type Difficulty } from '../src/variants/guandan/ai/index.ts';
import { decide as decideOld } from './baseline-ai/bot.ts';
import { decide as decidePrev } from './baseline-ai-0.1.2/bot.ts';

type Agent = (view: PlayerView, seed: string) => Action | null;

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

const targetDeals = Number(arg('deals', '5000'));
const seedPrefix = arg('seed', 'sim');
const mode = arg('mode', 'random');
const difficulty = arg('difficulty', 'normal') as Difficulty;

const ai = (d: Difficulty): Agent => (view, seed) => decide(view, { seed, difficulty: d });
const rnd: Agent = (view, seed) => randomAction(view, seed);
/** 贪心基准：能压就用最小的压（不分敌友、不留炸弹），领出出最小的一手。比随机强得多，用来衡量电脑的真实水平。 */
const greedy: Agent = (view, seed) => {
  if (view.myTribute || view.phase !== 'play' || view.turn !== view.seat) return randomAction(view, seed);
  const list = hint(view);
  const p = list[0];
  if (!p) return { type: 'pass', seat: view.seat };
  return { type: 'play', seat: view.seat, cards: p.cards, as: { type: p.type, rank: p.rank, extra: p.extra } };
};

function agentFor(name: string): Agent {
  if (name === 'random') return rnd;
  if (name === 'greedy') return greedy;
  if (name === 'old') return (view, seed) => decideOld(view, { seed, difficulty: 'normal' });
  if (name === 'prev') return (view, seed) => decidePrev(view, { seed, difficulty: 'normal' });
  if (name === 'easy' || name === 'normal' || name === 'hard') return ai(name);
  throw new Error(`不认识的机器人 ${name}`);
}
const labelOf = (name: string) =>
  name === 'random' ? '随机' : name === 'greedy' ? '贪心' : name === 'old' ? '旧电脑(normal)' : name === 'prev' ? '0.1.2电脑(normal)' : `电脑(${name})`;

let agentA: Agent;
let agentB: Agent;
let labelA: string;
let labelB: string;
if (mode === 'random' || mode === 'greedy') {
  agentA = ai(difficulty);
  agentB = agentFor(mode);
  labelA = labelOf(difficulty);
  labelB = labelOf(mode);
} else if (mode === 'ai') {
  agentA = ai(difficulty);
  agentB = ai(difficulty);
  labelA = `电脑(${difficulty})A`;
  labelB = `电脑(${difficulty})B`;
} else {
  const m = /^(\w+)-vs-(\w+)$/.exec(mode);
  if (!m) throw new Error(`不认识的 --mode ${mode}`);
  agentA = agentFor(m[1]!);
  agentB = agentFor(m[2]!);
  labelA = labelOf(m[1]!);
  labelB = labelOf(m[2]!);
}
/** 只统计"电脑"（新 AI）的决策耗时，随机/贪心/旧电脑不算 */
const timedA = !/^(random|greedy|old|prev)-vs-/.test(mode);
const timedB = mode === 'ai' || /-vs-(easy|normal|hard)$/.test(mode);

const problems: string[] = [];
let deals = 0;
let games = 0;
let finishedGames = 0;
let winsA = 0;
let headA = 0;
let upA = 0;
let upB = 0;
let doubleDownA = 0;
let doubleDownB = 0;
let anti = 0;
let aResets = 0;
let actions = 0;
let decideMs = 0;
let maxDecideMs = 0;
const times: number[] = [];
let maxDealsInGame = 0;
const t0 = performance.now();

function checkConservation(s: GameState, where: string): void {
  if (s.phase !== 'play') return;
  const seen = new Set<number>();
  let n = 0;
  for (const h of s.hands) for (const c of h) { seen.add(c); n++; }
  for (const r of s.history) if (r.play) for (const c of r.play.cards) { seen.add(c); n++; }
  if (n !== 108 || seen.size !== 108) problems.push(`${where}: 牌数不守恒（${n} 张，${seen.size} 种）`);
}

while (deals < targetDeals) {
  const g = games++;
  const aTeam = g % 2; // 电脑 A 坐的队
  const seed = `${seedPrefix}-${g}`;
  let { state } = createGame(seed);
  let dealSteps = 0;
  let dealsHere = 0;
  for (;;) {
    if (state.phase === 'gameOver') break;
    if (state.phase === 'dealEnd') {
      state = dispatch(state, { type: 'nextDeal' }).state;
      dealSteps = 0;
      if (state.antiTribute) anti++;
      continue;
    }
    const seat = seatsToAct(state)[0];
    if (seat === undefined) {
      problems.push(`${seed} 第 ${state.dealNo} 副：没人能行动（${state.phase}）`);
      break;
    }
    const isA = teamOf(seat) === aTeam;
    const agent = isA ? agentA : agentB;
    const t = performance.now();
    const action = agent(viewFor(state, seat), seed);
    const dt = performance.now() - t;
    decideMs += dt;
    if (dt > maxDecideMs) maxDecideMs = dt;
    if (state.phase === 'play' && (isA ? timedA : timedB)) times.push(dt);
    if (!action) {
      problems.push(`${seed} 第 ${state.dealNo} 副：座位 ${seat} 该行动却没给动作`);
      break;
    }
    const r = dispatch(state, action);
    if (r.error) {
      problems.push(`${seed} 第 ${state.dealNo} 副：座位 ${seat} 非法动作（${r.error}）${JSON.stringify(action)}`);
      break;
    }
    state = r.state;
    actions++;
    dealSteps++;
    if (dealSteps % 50 === 0) checkConservation(state, `${seed} 第 ${state.dealNo} 副`);
    if (dealSteps > 3000) {
      problems.push(`${seed} 第 ${state.dealNo} 副：超过 3000 步，疑似死锁`);
      break;
    }
    for (const e of r.events) {
      if (e.type !== 'dealEnd') continue;
      deals++;
      dealsHere++;
      const res = e.result;
      if (res.winnerTeam === aTeam) {
        headA++;
        upA += res.up;
        if (res.doubleDown) doubleDownA++;
      } else {
        upB += res.up;
        if (res.doubleDown) doubleDownB++;
      }
      if (res.aResetTeam >= 0) aResets++;
    }
    if (dealsHere > 300) {
      problems.push(`${seed}：一局超过 300 副还没打完`);
      break;
    }
  }
  maxDealsInGame = Math.max(maxDealsInGame, dealsHere);
  if (state.phase === 'gameOver') {
    finishedGames++;
    if (state.winner === aTeam) winsA++;
  }
  if (problems.length > 20) break;
}

const secs = (performance.now() - t0) / 1000;
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
console.log(`对局：${labelA} vs ${labelB}，种子前缀 ${seedPrefix}`);
console.log(`整局 ${games}（打完 ${finishedGames}），共 ${deals} 副，${actions} 个动作，用时 ${secs.toFixed(1)} 秒`);
console.log(`整局胜率：${labelA} ${pct(winsA, finishedGames)}，${labelB} ${pct(finishedGames - winsA, finishedGames)}`);
console.log(`头游率：${labelA} ${pct(headA, deals)}；双下对手：${labelA} ${doubleDownA} 次，${labelB} ${doubleDownB} 次`);
console.log(`累计升级：${labelA} ${upA}，${labelB} ${upB}；抗贡 ${anti} 次；打 A 失败退回 ${aResets} 次；单局最多 ${maxDealsInGame} 副`);
console.log(`决策耗时（全部）：平均 ${(decideMs / Math.max(1, actions)).toFixed(3)} ms，最慢 ${maxDecideMs.toFixed(1)} ms`);
if (times.length) {
  times.sort((a, b) => a - b);
  const q = (x: number) => times[Math.min(times.length - 1, Math.floor(times.length * x))]!.toFixed(2);
  console.log(`电脑出牌决策：${times.length} 次，p50 ${q(0.5)} ms，p99 ${q(0.99)} ms，p99.9 ${q(0.999)} ms，最慢 ${times[times.length - 1]!.toFixed(1)} ms`);
}
if (problems.length) {
  console.log(`问题 ${problems.length} 个：`);
  for (const p of problems.slice(0, 20)) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log('问题：无（无非法动作、无死锁、整局全部打完）');
}
