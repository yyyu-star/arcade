import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEYS } from '../src/store.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('架构约束', () => {
  const pure = [...files('src/core'), ...files('src/ai'), ...files('src/room'), 'src/bot.ts'];

  it('规则核心和电脑里没有 Math.random、时间、平台相关的数学函数、DOM 和网络', () => {
    const banned = /Math\.(random|exp|log|log2|log10|pow|sqrt|sin|cos|tan|atan2|hypot|cbrt)\b|\bDate\b|performance\.|crypto\.|\bwindow\b|\bdocument\b|\bfetch\(|localStorage|setTimeout|setInterval|\*\*|from 'node:/;
    for (const f of pure) expect(read(f).match(banned)?.[0], f).toBeUndefined();
  });

  it('电脑只拿视图：src/ai 不引用完整状态，只用类型引用规则', () => {
    for (const f of files('src/ai')) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bTable\b|\bSeatState\b|\.deck\b|\.seed\b/);
      for (const m of src.matchAll(/^import (.*) from '(.*)';$/gm))
        if (m[2]!.includes('core/table') || m[2]!.includes('core/view')) expect(m[1], f).toMatch(/^type /);
    }
  });

  it('规则核心不引用电脑和页面；好友房的规则不引用页面（房间和页面共用）', () => {
    for (const f of files('src/core')) expect(read(f), f).not.toMatch(/from '\.\.\/(ai|view|net|room)\//);
    for (const f of files('src/room')) expect(read(f), f).not.toMatch(/from '\.\.\/(view|net)\/|from '\.\.\/(main|solo)\.ts'/);
  });

  it('页面启动先建云存档再画大厅（0.3.7）：画大厅要按 cloud.userId() 读记着的房间，反过来在好友房里刷新一打开就报错', () => {
    const main = read('src/main.ts');
    const boot = main.slice(main.indexOf('async function boot('));
    const created = boot.indexOf('cloud = createCloud(');
    expect(created).toBeGreaterThan(0);
    for (const call of ['showLobby()', 'drawLobby()', 'savedRoom()', 'lastRoom()', 'cloud.']) {
      const at = boot.indexOf(call);
      if (at >= 0) expect(at, call).toBeGreaterThan(created);
    }
  });

  it('浏览器存储的键都在 store.ts 里，且以 texas. 开头（和平台、别的游戏同域，前缀是唯一的隔离）', () => {
    const keys = Object.values(KEYS).map((k) => (typeof k === 'function' ? k('u1') : k));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) expect(k).toMatch(/^texas\./);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('只有 store.ts 直接碰 localStorage / sessionStorage；别处的键名都从 store.ts 拿，不再写 texas. 字面量', () => {
    for (const f of files('src').filter((f) => f !== 'src/store.ts')) {
      const src = read(f);
      // 注入点：main.ts 把 localStorage 整个交给 solo / cloud / fun（它们经注入读写，便于测试），只传不调
      const bare = src.replace(/\blocalStorage(?=[,)])/g, '').replace(/\bsessionStorage(?=[,)])/g, '');
      expect(bare.match(/\b(localStorage|sessionStorage)\b/)?.[0], f).toBeUndefined();
      expect(src.match(/['"`]texas\.[^'"`]*['"`]/)?.[0], f).toBeUndefined();
    }
  });
});
