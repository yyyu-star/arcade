import { describe, expect, it } from 'vitest';
import { focusOrder, handleKey, registerFocusable, step, unregisterFocusable, type Focusable } from '../src/view/ui/focus.ts';

/** 0.9.0 键盘焦点：只在最上面那层里按阅读顺序走；框亮着时回车按下去，框下被弹窗盖住的不按。 */

interface Fake extends Focusable {
  name: string;
  on: boolean;
  presses: number;
  ok: boolean;
  depth: number;
}

function fake(name: string, x: number, y: number, depth = 0): Fake {
  const b: Fake = {
    name,
    on: false,
    presses: 0,
    ok: true,
    depth,
    focusable: () => b.ok,
    layer: () => b.depth,
    rect: () => ({ x, y, w: 80, h: 40 }),
    setFocused: (v) => {
      b.on = v;
    },
    press: () => {
      b.presses += 1;
      return true;
    },
  };
  return b;
}

const key = (k: string, shift = false) => ({ key: k, shiftKey: shift, altKey: false, ctrlKey: false, metaKey: false });

describe('焦点顺序', () => {
  it('先上后下，同一行（上沿差不到 12）从左到右；不能点的跳过', () => {
    const a = fake('a', 300, 100);
    const b = fake('b', 100, 105);
    const c = fake('c', 100, 200);
    const d = fake('d', 50, 50);
    d.ok = false;
    expect(focusOrder([a, b, c, d]).map((x) => (x as Fake).name)).toEqual(['b', 'a', 'c']);
  });

  it('有弹窗时只在最上面那层里走', () => {
    const under = fake('under', 0, 0, 0);
    const ok = fake('ok', 500, 400, 300);
    const cancel = fake('cancel', 300, 400, 300);
    expect(focusOrder([under, ok, cancel]).map((x) => (x as Fake).name)).toEqual(['cancel', 'ok']);
  });

  it('往前往后走，到头绕回来；当前的不在里面时从头或从尾开始', () => {
    const [a, b, c] = [fake('a', 0, 0), fake('b', 100, 0), fake('c', 200, 0)];
    const order = [a, b, c];
    expect(step(order, null, 1)).toBe(a);
    expect(step(order, null, -1)).toBe(c);
    expect(step(order, c, 1)).toBe(a);
    expect(step(order, a, -1)).toBe(c);
    expect(step([], a, 1)).toBeNull();
  });
});

describe('按键', () => {
  it('Tab 亮框、回车按下去；框下的按钮被弹窗盖住后回车不按，交给别人处理', () => {
    const a = fake('a', 0, 0);
    const b = fake('b', 100, 0);
    registerFocusable(a);
    registerFocusable(b);
    try {
      expect(handleKey(key('Enter'))).toBe(false); // 框没亮：回车照旧是场景的快捷键
      expect(handleKey(key('Tab'))).toBe(true);
      expect(a.on).toBe(true);
      expect(handleKey(key('Tab'))).toBe(true);
      expect([a.on, b.on]).toEqual([false, true]);
      expect(handleKey(key('Tab', true))).toBe(true);
      expect(a.on).toBe(true);
      expect(handleKey(key(' '))).toBe(true);
      expect(a.presses).toBe(1);

      const dlg = fake('dlg', 400, 300, 300);
      registerFocusable(dlg);
      expect(handleKey(key('Enter'))).toBe(false);
      expect(a.presses).toBe(1);
      expect(a.on).toBe(false);
      // 再按 Tab 就走进弹窗里
      expect(handleKey(key('Tab'))).toBe(true);
      expect(dlg.on).toBe(true);
      unregisterFocusable(dlg);
      // 带修饰键的不管（Ctrl+Tab 是浏览器切标签页）
      expect(handleKey({ ...key('Tab'), ctrlKey: true })).toBe(false);
    } finally {
      unregisterFocusable(a);
      unregisterFocusable(b);
    }
  });

  it('没有能点的按钮时 Tab 不拦，交给浏览器', () => {
    expect(handleKey(key('Tab'))).toBe(false);
  });
});
