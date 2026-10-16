/** 架构约束（DESIGN.md 3、10）：规则核心和电脑是纯的、确定的；玩法之间不互相引用；电脑只拿视图 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = new URL('../src/', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** 去掉注释，免得注释里提到的词被当成代码 */
const code = (p: string): string =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const PURE = [...files(join(ROOT, 'core')), ...files(join(ROOT, 'ai'))];

describe('规则核心和电脑', () => {
  test('不用 Math.random、Date.now、new Date 和结果依赖平台的数学函数', () => {
    const banned = /Math\.(random|exp|log|log2|log10|pow|sin|cos|tan|atan|atan2|sqrt|cbrt|hypot|expm1|log1p|sinh|cosh|tanh|asin|acos)\b|Date\.now|new Date|performance\.now/;
    for (const f of PURE) expect(banned.test(code(f)), relative(ROOT, f)).toBe(false);
  });

  test('不碰 DOM、网络、存储', () => {
    const banned = /\b(document|window|localStorage|sessionStorage|fetch|WebSocket|navigator)\b/;
    for (const f of PURE) expect(banned.test(code(f)), relative(ROOT, f)).toBe(false);
  });

  test('玩法之间不互相 import，只依赖通用层', () => {
    const dir = join(ROOT, 'core/variants');
    const variants = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
    for (const v of variants) {
      for (const f of files(join(dir, v))) {
        const imports = [...code(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
        for (const i of imports) {
          for (const other of variants) if (other !== v) expect(i.includes(`/${other}/`) || i.endsWith(`/${other}`), `${relative(ROOT, f)} → ${i}`).toBe(false);
        }
      }
    }
  });

  test('通用层不 import 任何玩法', () => {
    for (const layer of ['tiles', 'hand', 'table', 'match']) {
      for (const f of files(join(ROOT, 'core', layer))) expect(code(f).includes('variants/'), relative(ROOT, f)).toBe(false);
    }
  });

  test('规则和电脑出牌不碰交流：不 import 互动、短语表情、画面（电脑的决策读不到任何人发的东西）', () => {
    for (const f of PURE) {
      const imports = [...code(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const i of imports) expect(/\/(game\/(banter|emotes)|view\/)|^arcade-kit\/fun/.test(i), `${relative(ROOT, f)} → ${i}`).toBe(false);
    }
  });

  test('电脑只拿视图：不出现状态类型、不调规则的 apply', () => {
    for (const f of files(join(ROOT, 'ai'))) {
      const c = code(f);
      expect(/\bXzState\b|\bapplyMut\b|\bapply\(/.test(c), relative(ROOT, f)).toBe(false);
      // 只用规则的类型和纯函数（算番、牌型），不碰 rules.ts（状态和推进都在那里）
      expect(/from\s+'[^']*\/rules(\.ts)?'/.test(c), relative(ROOT, f)).toBe(false);
    }
  });
});
