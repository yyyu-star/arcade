/**
 * 掼蛋金样（牌馆重构 ①a，docs/doudizhu.md 第 2 节）。场景在 tests/golden-scenarios.ts，哈希存 tests/golden/guandan.json，tests/golden.test.ts 比对。
 *   node tools/golden.ts                 重算并打印每个场景的哈希、条数、耗时（不写文件）
 *   node tools/golden.ts --write         重写 tests/golden/guandan.json（只在有意改了掼蛋行为时用，PR 说明里写为什么）
 *   node tools/golden.ts --dump <名字> <文件>   把一个场景逐项写成文本（重构前后各导一份 diff，找第一个不同的地方）
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runScenario, scenarios } from '../tests/golden-scenarios.ts';

const args = process.argv.slice(2);
const file = fileURLToPath(new URL('../tests/golden/guandan.json', import.meta.url));
if (args[0] === '--dump') {
  const sc = scenarios().find((x) => x.name === args[1]);
  if (!sc || !args[2]) throw new Error('用法：--dump <场景名> <输出文件>');
  const lines: string[] = [];
  runScenario(sc, (l) => lines.push(l));
  writeFileSync(args[2], lines.join('\n') + '\n');
  console.log(`${sc.name}: ${lines.length} 项 → ${args[2]}`);
} else {
  const out: Record<string, { hash: string; items: number }> = {};
  const seen: Record<string, number> = {};
  for (const sc of scenarios()) {
    const t = performance.now();
    const o = runScenario(sc);
    out[sc.name] = { hash: o.hash, items: o.items };
    for (const [k, n] of Object.entries(o.seen)) seen[k] = (seen[k] ?? 0) + n;
    console.log(`${sc.name.padEnd(22)} ${o.items} 项 ${Math.round(performance.now() - t)} ms`);
  }
  console.log('覆盖', JSON.stringify(seen));
  if (args[0] === '--write') {
    writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    console.log('已写 tests/golden/guandan.json');
  }
}
