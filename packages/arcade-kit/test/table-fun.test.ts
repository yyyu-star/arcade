/**
 * 牌桌互动组件（table-fun）的存储 key（0.13.1）：storageKey 只认游戏 id 的写法，kit 拼出来的 key 一定带 `<游戏id>.` 前缀；不合格构造前就抛错。
 * 组件本身要 DOM，在 demo/table-fun.html 里看；这里只测纯函数（import 时不碰 DOM，Node 里能直接引）
 */
import { describe, expect, it } from 'vitest';
import { checkPrefsKey, checkStorageKey, hintSeatFor, type FunSeat } from '../src/table-fun.ts';

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

describe('hintSeatFor（首次提示冒在哪个座位，0.17.0）', () => {
  const r = { left: 0, top: 0, width: 10, height: 10 };
  const me: FunSeat = { rect: r, name: '我', me: true };
  const bot: FunSeat = { rect: r, name: '电脑', bot: true };
  const man: FunSeat = { rect: r, name: '真人' };

  it('不给 pick：第一个电脑，没电脑第一个别人，只有自己或没人时 null', () => {
    expect(hintSeatFor([me, man, bot, man])).toBe(2);
    expect(hintSeatFor([me, null, man])).toBe(2);
    expect(hintSeatFor([me, null])).toBe(null);
    expect(hintSeatFor([])).toBe(null);
  });

  it('给了 pick 就听它的：返回 null 是"现在不行"，空座位、不存在、不是整数也当 null', () => {
    const seats = [me, bot, null, bot];
    expect(hintSeatFor(seats, () => 3)).toBe(3);
    expect(hintSeatFor(seats, () => 0)).toBe(0);
    expect(hintSeatFor(seats, () => null)).toBe(null);
    expect(hintSeatFor(seats, () => 2)).toBe(null);
    expect(hintSeatFor(seats, () => 9)).toBe(null);
    expect(hintSeatFor(seats, () => 1.5)).toBe(null);
  });
});

describe('checkPrefsKey（聊天设置的存储 key，0.19.0）', () => {
  it('只认 <游戏id>.<名字>：带游戏前缀，小写字母、数字、连字符', () => {
    for (const k of ['texas.chat', 'mahjong.chat-prefs', 'my-game.ui.chat']) expect(checkPrefsKey(k, k.split('.')[0]!)).toBe(k);
  });
  it('别的游戏的前缀、没有点、大写、空格、平台前缀、超长、不是字符串：抛错', () => {
    for (const k of ['guandan.chat', 'texas', 'texas.', 'texas.Chat', 'texas. chat', 'arcade.chat', `texas.${'a'.repeat(60)}`, 3, undefined]) {
      expect(() => checkPrefsKey(k, 'texas'), String(k)).toThrow(/prefsKey/);
    }
  });
});
