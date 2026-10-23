/**
 * 服务器 CPU 预算（DESIGN.md 5.6，硬约束）：好友房每一步（结算一发真人的 act、电脑想一步加结算）在开发机上 p99 ≤ 3 ms。
 * 量法在 test/cpu-bench.ts（真的 kit 房间，11 张图 × 3v3，典型和最坏局面）。这里用普通 Node 跑（不经 vitest 转译，和线上打成一个文件的 Worker 差不多快），
 * 把 kit 引的 'cloudflare:workers' 指到 test/fake-workers.ts。超了就以非 0 退出（npm test 的最后一步）。
 * 有环境变量 CI 时门槛放宽到 p99 ≤ 8 ms（GitHub 的共享机器偶尔慢），输出里写着用的是哪个门槛。
 * 用法：npm run cpu
 */
import { register } from 'node:module';

const fake = new URL('../test/fake-workers.ts', import.meta.url).href;
const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: ${JSON.stringify(fake)}, shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { BUDGET_MS, BUDGET_NOTE, measure, pct, REPEAT } = await import('../test/cpu-bench.ts');
console.log(`门槛：每一步 p99 ≤ ${BUDGET_MS} ms，${BUDGET_NOTE}`);
const r = await measure();
console.log(`每局原样打 ${REPEAT} 遍，每一步取最快的一遍`);
for (const l of r.lines) console.log(l);
let failed = false;
for (const [name, run] of Object.entries(r.runs)) {
  for (const [who, list] of [['真人出手', run.human], ['电脑一步', run.bot]] as const) {
    const p99 = pct(list, 0.99);
    if (p99 > BUDGET_MS) {
      failed = true;
      console.error(`超预算：${name}的${who} p99 ${p99.toFixed(2)} ms > ${BUDGET_MS} ms`);
    }
  }
}
console.log(failed ? 'CPU 预算：没过' : `CPU 预算：通过（每一步 p99 ≤ ${BUDGET_MS} ms）`);
process.exit(failed ? 1 : 0);
