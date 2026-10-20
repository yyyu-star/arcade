/**
 * 牌桌互动组件（table-fun）的存储 key（0.13.1）：storageKey 只认游戏 id 的写法，kit 拼出来的 key 一定带 `<游戏id>.` 前缀；不合格构造前就抛错。
 * 组件本身要 DOM，在 demo/table-fun.html 里看；这里只测纯函数（import 时不碰 DOM，Node 里能直接引）
 */
import { describe, expect, it } from 'vitest';
import { placeBubble } from '../src/fun-logic.ts';
import { CHAT_CSS } from '../src/table-chat.ts';
import { bubbleZones, checkPrefsKey, checkStorageKey, hintSeatFor, styleButton, type FunSeat } from '../src/table-fun.ts';

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

describe('头像旁的气泡避开哪里（bubbleZones，0.20.1）', () => {
  const view = { width: 844, height: 390 };
  // 对家在上：头像 + 右边的名牌（名字、筹码）；左边是桌上出的牌
  const top: FunSeat = { rect: { left: 392, top: 20, width: 60, height: 60 }, plate: { left: 458, top: 14, width: 120, height: 34 }, name: '小美', bot: true };
  const me: FunSeat = { rect: { left: 20, top: 300, width: 60, height: 60 }, plate: { left: 20, top: 362, width: 60, height: 20 }, name: '我', me: true };
  const trick = { left: 280, top: 14, width: 106, height: 34 };

  it('各家的名牌是硬禁区：首次提示宁可擦一点桌上的牌，也不盖对家的名字和筹码（所有者 10-18）', () => {
    const z = bubbleZones([me, top], 1, { avoid: [trick], over: [] });
    expect(z.hard).toEqual([me.plate, top.plate]);
    expect(z.avoid).toEqual([trick, me.rect]);
    const at = placeBubble(top.rect, 150, 30, view, z.avoid, z.hard);
    const hit = (b: { left: number; top: number; width: number; height: number }): boolean =>
      at.left < b.left + b.width && b.left < at.left + 150 && at.top < b.top + b.height && b.top < at.top + 30;
    expect(hit(top.plate!)).toBe(false);
    // 反证：名牌当软的（0.18.2 的做法）就会压上去
    const old = placeBubble(top.rect, 150, 30, view, [...z.avoid, ...z.hard], []);
    expect(old.left < top.plate!.left + top.plate!.width && top.plate!.left < old.left + 150).toBe(true);
  });

  it('头像旁的标签（marks，麻将的缺门签）也是硬的：首次提示换一侧，不压住右上家的缺门（麻将体检）', () => {
    // 右上家：头像左边挂着缺门签，提示原来朝屏幕中心（左边）冒、正好压住它
    const tr: FunSeat = { rect: { left: 700, top: 40, width: 60, height: 60 }, marks: [{ left: 650, top: 40, width: 44, height: 28 }], name: '东家', bot: true };
    const z = bubbleZones([me, tr], 1, { avoid: [], over: [] });
    expect(z.hard).toEqual([me.plate, ...tr.marks!]);
    const at = placeBubble(tr.rect, 150, 30, view, z.avoid, z.hard);
    const m = tr.marks![0]!;
    expect(at.left < m.left + m.width && m.left < at.left + 150 && at.top < m.top + m.height && m.top < at.top + 30).toBe(false);
    // 反证：不给 marks 就压上去
    const bare = placeBubble(tr.rect, 150, 30, view, z.avoid, [me.plate!]);
    expect(bare.left < m.left + m.width && m.left < bare.left + 150 && bare.top < m.top + m.height && m.top < bare.top + 30).toBe(true);
  });

  it('竖屏自己的气泡：叠在上面的"互动"按钮照样是硬的（0.19.1 已修，这里守住接线）', () => {
    const port = { width: 390, height: 844 };
    const self: FunSeat = { rect: { left: 20, top: 700, width: 60, height: 60 }, name: '我', me: true };
    const btn = { left: 86, top: 694, width: 60, height: 60 };
    const z = bubbleZones([self], 0, { avoid: [], over: [btn] });
    expect(z.hard).toEqual([btn]);
    expect(z.avoid).toEqual([]);
    const at = placeBubble(self.rect, 120, 30, port, z.avoid, z.hard);
    expect(at.left + 120 <= btn.left || at.top + 30 <= btn.top).toBe(true);
  });
});

describe('styleButton（"互动"按钮的大小参数）', () => {
  const fake = (): { style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void } } => {
    const style = {
      setProperty(k: string, v: string) {
        (style as Record<string, unknown>)[k] = v;
      },
      removeProperty(k: string) {
        delete (style as Record<string, unknown>)[k];
      },
    } as Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void };
    return { style };
  };
  it('没给：不写行内样式（游戏自己的 CSS 还管用）', () => {
    const b = fake();
    styleButton(b as unknown as HTMLElement, undefined);
    expect(b.style['fontSize']).toBe('');
    expect(b.style['--atf-icon']).toBeUndefined();
  });
  it('scale 按 13 / 22 放大；fontSize、icon（0.20.1）直接给像素，优先于 scale，有下限', () => {
    const a = fake();
    styleButton(a as unknown as HTMLElement, { scale: 1.5, row: true });
    expect([a.style['fontSize'], a.style['--atf-icon'], a.style['flexDirection']]).toEqual(['19.5px', '33px', 'row']);
    const b = fake();
    styleButton(b as unknown as HTMLElement, { scale: 2, fontSize: 18, icon: 24 });
    expect([b.style['fontSize'], b.style['--atf-icon'], b.style['flexDirection']]).toEqual(['18px', '24px', '']);
    const c = fake();
    styleButton(c as unknown as HTMLElement, { fontSize: 4, icon: Number.NaN });
    expect([c.style['fontSize'], c.style['--atf-icon']]).toEqual(['12px', '22px']);
  });
});

describe('电脑版聊天框的快捷短语（0.20.2）', () => {
  it('最多两行、多出的框内滚动，按钮压到 32 像素：框不比 0.20.0 高，大屏不会因为换行被判放不下而默认收起', () => {
    const rule = /\.atc-dock \.atc-quick\{([^}]*)\}/.exec(CHAT_CSS)?.[1] ?? '';
    expect(rule).toContain('flex-wrap:wrap');
    expect(rule).toContain('overflow-y:auto');
    const max = Number(/max-height:(\d+)px/.exec(rule)?.[1]);
    const chip = Number(/\.atc-dock \.atc-quick \.atf-chip\{[^}]*min-height:(\d+)px/.exec(CHAT_CSS)?.[1]);
    // 两行按钮加一个行距放得下，三行放不下（0.21.2 行距 6 → 12，留给上下扩的点按区）
    const gap = Number(/row-gap:(\d+)px/.exec(rule)?.[1] ?? 6);
    expect(max).toBeGreaterThanOrEqual(2 * chip + gap);
    expect(max).toBeLessThan(3 * chip + 2 * gap);
    // 手机输入条那排不受影响：还是一行横着滑
    expect(/\.atc-quick\{[^}]*overflow-x:auto/.test(CHAT_CSS)).toBe(true);
  });
});

describe('聊天坞的芯片点按区（0.21.2）', () => {
  // 画出来比 44 矮的芯片，要有 ::before 往上下各扩出去，凑够 44 CSS 像素；相邻两行之间的行距够两边各扩一半，不互相压
  const rules = [...CHAT_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  it('每个比 44 矮的 .atf-chip 都扩到 ≥ 44', () => {
    const short = rules.filter((r) => /\.atf-chip$/.test(r.sel) && /min-height:(\d+)px/.test(r.body) && Number(/min-height:(\d+)px/.exec(r.body)![1]) < 44);
    expect(short.length).toBeGreaterThan(0);
    for (const r of short) {
      const h = Number(/min-height:(\d+)px/.exec(r.body)![1]);
      const pad = rules.find((x) => x.sel === `${r.sel}::before`);
      expect(pad, r.sel).toBeTruthy();
      const ext = -Number(/inset:(-?\d+)px/.exec(pad!.body)![1]);
      // ::before 从内边框算起：芯片自带 1 像素边框（table-fun.ts 的 .atf-chip），上下各扣 1（0.21.2 实测 42 的教训）
      expect(h - 2 + 2 * ext, r.sel).toBeGreaterThanOrEqual(44);
      // ::before 按芯片定位
      expect(rules.some((x) => x.sel.split(',').includes(r.sel) && /position:relative/.test(x.body)), r.sel).toBe(true);
    }
  });
  it('电脑版常用语换行时行距 ≥ 两边扩出去的和，滚动框上下留出扩的那截', () => {
    const q = rules.find((r) => r.sel === '.atc-dock .atc-quick')!.body;
    const ext = -Number(/inset:(-?\d+)px/.exec(rules.find((r) => r.sel === '.atc-dock .atc-quick .atf-chip::before')!.body)![1]);
    expect(Number(/row-gap:(\d+)px/.exec(q)![1])).toBeGreaterThanOrEqual(2 * ext);
    expect(q).toContain(`padding:${ext}px 0`);
  });
});
