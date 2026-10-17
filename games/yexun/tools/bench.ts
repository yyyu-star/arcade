/**
 * 核心耗时：node tools/bench.ts [种子] [难度]
 * 用一个会绕圈走、升级选第一个的简单输入跑完整一局，报每拍耗时（平均、最慢）、场上怪和子弹的峰值、结局（DESIGN.md 第 6 节的预算：电脑 ≤ 0.5 ms）。
 */
import { createWorld, step } from '../src/core/index.ts';
import type { Difficulty } from '../src/content/waves.ts';

const seed = Number(process.argv[2] ?? 1);
const diff = (process.argv[3] ?? 'normal') as Difficulty;
const w = createWorld({ seed, mode: 'vigil', difficulty: diff });
let worst = 0;
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
    if (dt > worst) worst = dt;
  }
  if (w.eCount > peakE) peakE = w.eCount;
  if (w.sCount > peakS) peakS = w.sCount;
}
console.log(
  `结局 ${w.won ? (w.bossKilled ? '打倒尸王' : '天亮') : '倒下'}，${(w.tick / 30 / 60).toFixed(2)} 分钟，等级 ${w.level}，击杀 ${w.kills}；` +
    `每拍平均 ${(total / ticks).toFixed(3)} ms，最慢 ${worst.toFixed(2)} ms；怪峰值 ${peakE}，子弹峰值 ${peakS}；总 ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
console.log('法器', w.weapons.map((o) => `${o.id}${o.level}${o.evolved ? '★' : ''}`).join(' '), '被动', JSON.stringify(w.passives));
