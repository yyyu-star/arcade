/**
 * 核心耗时（DESIGN.md 第 6 节，只测规则核心，浏览器那一侧另测）：
 *   node tools/bench.ts [种子] [难度]                整局：会绕圈走、升级选第一个，报每拍耗时和峰值（预算：电脑 ≤ 0.5 ms）
 *   node tools/bench.ts --worst [--reps N] [--ticks T] [--seed S] [--json]
 *                                                    最坏拍：300 只怪始终满额 + 12 件法器全部 8 级进化，主角无敌绕圈走。
 *                                                    场景完全确定（带种子的小随机数），重复 N 轮（默认 5，每轮先预热同样的拍数），
 *                                                    每轮报平均、p50、p95、p99、最慢，最后报各轮中位数；轮与轮之间差得多就是机器在忙，别信。
 * 计时用 performance.now（工具里可以，核心里不行）。
 */
import { ENEMIES } from '../src/content/enemies.ts';
import { WEAPON_IDS } from '../src/content/weapons.ts';
import { DIFFICULTIES, type Difficulty } from '../src/content/waves.ts';
import { createWorld, grantWeapon, spawnNow, step, type World } from '../src/core/index.ts';

const flag = (name: string): boolean => process.argv.includes(name);
const opt = (name: string, def: number): number => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};

if (flag('--worst')) worst();
else full();

function full(): void {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const seed = Number(pos[0] ?? 1);
  const diff = (pos[1] ?? 'normal') as Difficulty;
  const w = createWorld({ seed, mode: 'vigil', danger: DIFFICULTIES[diff].danger });
  let worstMs = 0;
  let total = 0;
  let peakE = 0;
  let peakS = 0;
  let ticks = 0;
  const t0 = performance.now();
  while (w.phase !== 'over' && ticks < 30 * 60 * 16) {
    // 绕大圈走：每 3 秒换一个方向（32 向里转 4 格）
    const dir = 1 + ((Math.floor(w.tick / 90) * 4) % 32);
    const a = performance.now();
    step(w, dir, w.phase === 'choose' ? 0 : -1);
    const dt = performance.now() - a;
    if (w.phase === 'play') {
      ticks++;
      total += dt;
      if (dt > worstMs) worstMs = dt;
    }
    if (w.eCount > peakE) peakE = w.eCount;
    if (w.sCount > peakS) peakS = w.sCount;
  }
  console.log(
    `结局 ${w.won ? (w.bossKilled ? '打倒尸王' : '天亮') : '倒下'}，${(w.tick / 30 / 60).toFixed(2)} 分钟，等级 ${w.level}，击杀 ${w.kills}；` +
      `每拍平均 ${(total / ticks).toFixed(3)} ms，最慢 ${worstMs.toFixed(2)} ms；怪峰值 ${peakE}，子弹峰值 ${peakS}；总 ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  console.log('法器', w.weapons.map((o) => `${o.id}${o.level}${o.evolved ? '★' : ''}`).join(' '), '被动', JSON.stringify(w.passives));
}

/** 最坏拍场景：怪补满到 300，12 件法器 8 级进化，血量压满（不死），每 2 秒换一次方向 */
function stressWorld(seed: number): { w: World; refill: () => void; move: (t: number) => number } {
  const w = createWorld({ seed, mode: 'vigil', danger: 4 });
  for (const id of WEAPON_IDS) grantWeapon(w, id, 8, true);
  // 只补普通怪（精英和 Boss 有各自的技能，另测）
  const kinds = ENEMIES.filter((e) => !e.boss && !e.elite).map((e) => e.kind);
  // 简单的线性同余随机数：只用在场景里，和核心的随机无关
  let s = seed >>> 0;
  const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  return {
    w,
    /** 把怪补回 300（不计时） */
    refill(): void {
      w.hp = 1e9;
      for (let guard = 0; w.eCount < 300 && guard < 400; guard++) {
        const a = rnd() * 6.2831853;
        const d = 80 + rnd() * 420;
        const x = Math.min(Math.max(w.x + Math.cos(a) * d, 30), 2000);
        const y = Math.min(Math.max(w.y + Math.sin(a) * d, 30), 2000);
        spawnNow(w, kinds[Math.floor(rnd() * kinds.length)]!, x, y);
      }
    },
    /** 这一拍走的方向 */
    move: (t: number) => 1 + ((Math.floor(t / 60) * 4) % 32),
  };
}

function worst(): void {
  const reps = opt('--reps', 5);
  const ticks = opt('--ticks', 1500);
  const seed = opt('--seed', 1);
  const rounds: { mean: number; p50: number; p95: number; p99: number; max: number; eAvg: number; sPeak: number }[] = [];
  for (let r = 0; r < reps; r++) {
    const { w, refill, move } = stressWorld(seed);
    const one = (t: number): void => {
      refill();
      step(w, move(t), w.phase === 'choose' ? 0 : -1);
    };
    // 预热：让 JIT 编译完、法器的冷却错开
    for (let t = 0; t < ticks; t++) one(t);
    const dts = new Float64Array(ticks);
    let eSum = 0;
    let sPeak = 0;
    for (let t = 0; t < ticks; t++) {
      // 补怪不计时：只量 step 本身
      refill();
      const dir = move(ticks + t);
      const a = performance.now();
      step(w, dir, w.phase === 'choose' ? 0 : -1);
      dts[t] = performance.now() - a;
      eSum += w.eCount;
      if (w.sCount > sPeak) sPeak = w.sCount;
    }
    const sorted = Float64Array.from(dts).sort();
    const q = (p: number): number => sorted[Math.min(ticks - 1, Math.floor(p * ticks))]!;
    let sum = 0;
    for (const v of dts) sum += v;
    rounds.push({ mean: sum / ticks, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[ticks - 1]!, eAvg: eSum / ticks, sPeak });
  }
  const med = (k: 'mean' | 'p50' | 'p95' | 'p99' | 'max'): number => rounds.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(reps / 2)]!;
  if (flag('--json')) {
    console.log(JSON.stringify({ seed, ticks, reps, rounds, median: { mean: med('mean'), p50: med('p50'), p95: med('p95'), p99: med('p99'), max: med('max') } }));
    return;
  }
  console.log(`最坏拍场景（300 怪满额 + 12 法器 8 级进化），种子 ${seed}，每轮 ${ticks} 拍（另有同样多的预热），${reps} 轮`);
  rounds.forEach((x, i) =>
    console.log(`第 ${i + 1} 轮：平均 ${x.mean.toFixed(3)} ms，p50 ${x.p50.toFixed(3)}，p95 ${x.p95.toFixed(3)}，p99 ${x.p99.toFixed(3)}，最慢 ${x.max.toFixed(3)}；场上怪平均 ${x.eAvg.toFixed(0)}，子弹峰值 ${x.sPeak}`),
  );
  console.log(`中位数：平均 ${med('mean').toFixed(3)} ms，p50 ${med('p50').toFixed(3)}，p95 ${med('p95').toFixed(3)}，p99 ${med('p99').toFixed(3)}，最慢 ${med('max').toFixed(3)}（预算：电脑 ≤ 0.5 ms）`);
}
