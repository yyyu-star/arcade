import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 规则核心和内容表的架构约束（模块 AGENTS.md 第 3 节）：扫源码 */
function files(dir: string): string[] {
  const root = new URL(`../${dir}/`, import.meta.url).pathname;
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push(p);
    }
  };
  walk(root);
  return out;
}

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/performance\./, 'performance'],
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sqrt|hypot|exp|expm1|log|log2|log10|log1p|pow|cbrt|sinh|cosh|tanh)\b/, '引擎可以近似实现的数学函数'],
  [/\*\*/, '乘方运算符（结果可能依赖 Math.pow）'],
  [/from ['"](phaser|arcade-kit)/, '画面库、共用包'],
  [/from ['"]\.\.\/(view|platform)\//, '画面层、平台代码'],
  [/\b(window|document|localStorage|fetch)\b/, '浏览器接口'],
];

describe('架构', () => {
  for (const dir of ['src/core', 'src/content']) {
    it(`${dir} 不用随机、时间、平台数学函数和浏览器接口`, () => {
      for (const f of files(dir)) {
        // 去掉注释再查：注释里会提到这些词
        const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const [re, what] of FORBIDDEN) expect(re.test(src), `${f} 用了 ${what}`).toBe(false);
      }
    });
  }
});
