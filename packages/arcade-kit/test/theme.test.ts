/**
 * DOM 组件的主题（0.16.0）：纯函数 themeVars 的映射和防注入；再加一条"默认值不变"的守卫，
 * 扫四个 DOM 组件的源码，每个 `var(--ak-` 都必须带逗号后的默认值（不传主题的游戏外观才和以前完全一样）。
 */
import { describe, expect, it } from 'vitest';
import { themeVars, safeThemeValue, type KitTheme } from '../src/theme.ts';
import funSrc from '../src/fun.ts?raw';
import shareSrc from '../src/share.ts?raw';
import socialSrc from '../src/social.ts?raw';
import tableChatSrc from '../src/table-chat.ts?raw';
import tableFunSrc from '../src/table-fun.ts?raw';
import themeSrc from '../src/theme.ts?raw';

describe('themeVars', () => {
  it('空对象、空值、不是对象：空列表', () => {
    expect(themeVars({})).toEqual([]);
    expect(themeVars(undefined)).toEqual([]);
    expect(themeVars(null)).toEqual([]);
    expect(themeVars('x' as unknown as KitTheme)).toEqual([]);
    expect(themeVars({ bg: '', fg: '   ' })).toEqual([]);
  });

  it('字段映射到 --ak- 变量，顺序固定，不认识的字段忽略', () => {
    const t: KitTheme = {
      bg: '#102030', fg: '#fff', accent: '#d4a64a', accentFg: '#222', border: 'rgba(1,2,3,.5)',
      radius: '6px', radiusBtn: '4px', font: '"Noto Serif SC",serif', overlay: 'rgba(0,0,0,.8)', soft: '#333', title: 'gold',
    };
    expect(themeVars({ ...t, extra: 'x' } as KitTheme)).toEqual([
      ['--ak-bg', '#102030'], ['--ak-fg', '#fff'], ['--ak-accent', '#d4a64a'], ['--ak-accent-fg', '#222'],
      ['--ak-border', 'rgba(1,2,3,.5)'], ['--ak-radius', '6px'], ['--ak-radius-btn', '4px'],
      ['--ak-font', '"Noto Serif SC",serif'], ['--ak-overlay', 'rgba(0,0,0,.8)'], ['--ak-soft', '#333'], ['--ak-title', 'gold'],
    ]);
  });

  it('只给几个字段就只出几项，值两端空白去掉', () => {
    expect(themeVars({ accent: '  #f00 ' })).toEqual([['--ak-accent', '#f00']]);
  });

  it('拒绝能注入 CSS 的值，其他字段照常', () => {
    const bad = [
      'red;background:url(x)', 'red;color:blue', 'red;', 'red}body{color:red', '{', '<style>', 'url(http://x/a.png)', 'URL (x)', 'expression(alert(1))',
      'red /* x */', 'u\\72l(x)', '@import "x"', 'javascript:alert(1)', 'a'.repeat(201),
    ];
    for (const v of bad) {
      expect(themeVars({ bg: v, fg: '#fff' }), v).toEqual([['--ak-fg', '#fff']]);
      expect(safeThemeValue(v), v).toBe(false);
    }
    expect(themeVars({ bg: 5 as unknown as string })).toEqual([]);
  });
});

describe('默认值不变的守卫', () => {
  /** 找出每个 `var(--ak-xxx` 后面的第一层括号，里面必须有逗号和非空默认值 */
  const check = (src: string): { total: number; bad: string[] } => {
    let total = 0;
    const bad: string[] = [];
    for (const m of src.matchAll(/var\(--ak-[a-z-]+/g)) {
      total++;
      const rest = src.slice(m.index! + m[0].length);
      if (!/^,\s*[^)\s]/.test(rest)) bad.push(src.slice(m.index!, m.index! + 40));
    }
    return { total, bad };
  };

  it.each([
    ['share.ts', shareSrc, 8],
    ['social.ts', socialSrc, 20],
    ['table-fun.ts', tableFunSrc, 20],
    ['table-chat.ts', tableChatSrc, 10],
  ])('%s：每个 var(--ak- 都带默认值', (_n, src, min) => {
    const r = check(src);
    expect(r.total).toBeGreaterThanOrEqual(min);
    expect(r.bad).toEqual([]);
  });

  it('fun.ts 目前不用主题变量；用了也得带默认值', () => {
    expect(check(funSrc).bad).toEqual([]);
  });

  it('只用 theme.ts 里列的变量名', () => {
    const known = new Set([...themeSrc.matchAll(/'(--ak-[a-z-]+)'/g)].map((m) => m[1]));
    expect(known.size).toBe(11);
    for (const src of [shareSrc, socialSrc, tableFunSrc, tableChatSrc, funSrc]) {
      for (const m of src.matchAll(/var\((--ak-[a-z-]+)/g)) expect(known.has(m[1]!), m[1]).toBe(true);
    }
  });

  it('applyTheme 写在根节点的 cssText 之后（cssText 赋值会清掉先写的变量）', () => {
    let calls = 0;
    for (const src of [shareSrc, socialSrc, tableFunSrc]) {
      for (const m of src.matchAll(/applyTheme\((\w+(?:\.\w+)*),/g)) {
        calls++;
        const after = src.slice(m.index! + m[0].length);
        const fn = after.slice(0, after.search(/\n {0,2}\}\n/) + 1 || undefined);
        expect(fn.includes(`${m[1]}.style.cssText =`), `${m[1]} 的 cssText 在 applyTheme 之后又被改写`).toBe(false);
      }
    }
    expect(calls).toBe(4);
  });

  it('theme.ts import 时不碰 DOM、不引别的文件', () => {
    expect(themeSrc).not.toMatch(/^import /m);
  });
});
