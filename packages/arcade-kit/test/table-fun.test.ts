/**
 * 牌桌互动组件（table-fun）的存储 key（0.13.1）：storageKey 只认游戏 id 的写法，kit 拼出来的 key 一定带 `<游戏id>.` 前缀；不合格构造前就抛错。
 * 组件本身要 DOM，在 demo/table-fun.html 里看；这里只测纯函数（import 时不碰 DOM，Node 里能直接引）
 */
import { describe, expect, it } from 'vitest';
import { checkStorageKey } from '../src/table-fun.ts';

describe('checkStorageKey', () => {
  it('游戏 id 的写法：小写字母、数字、连字符，最多 32 位', () => {
    for (const k of ['cards', 'toy2', 'my-game', '2048', 'a'.repeat(32)]) expect(checkStorageKey(k)).toBe(k);
  });

  it('带点、大写、空串、空格、开头是连字符、超长、平台的 arcade、不是字符串：抛错，信息里有收到的值', () => {
    for (const k of ['cards.', 'cards.fun', 'Cards', '', ' cards', '-cards', 'a'.repeat(33), 'arcade', 'a/b', undefined, 3]) {
      expect(() => checkStorageKey(k), String(k)).toThrow(/storageKey/);
    }
    expect(() => checkStorageKey('cards.')).toThrow('"cards."');
  });
});
