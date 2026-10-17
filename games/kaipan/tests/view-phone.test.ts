import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { Rect } from '../src/view/rect.ts';
import { GAME_HEIGHT, GAME_WIDTH, pickPhoneLayout } from '../src/view/theme.ts';
import { cameraFor } from '../src/view/viewport.ts';

/** 0.5.5 手机布局：判定、相机兜底、viewOf、交易画面各区域。 */

describe('什么时候用手机布局', () => {
  const pick = (w: number, h: number, coarse = true, search = ''): boolean => pickPhoneLayout({ w, h, coarse, search });

  it('手机横屏用手机布局', () => {
    expect(pick(844, 390)).toBe(true);
    expect(pick(667, 375)).toBe(true);
  });

  it('手机竖屏打开也用手机布局（微信默认竖屏，转过来后铺满的应是手机版）', () => {
    expect(pick(390, 844, true)).toBe(true);
  });

  it('又窄又高的电脑窗口（不是触屏）不算手机', () => {
    expect(pick(390, 844, false)).toBe(false);
  });

  it('电脑屏幕、平板不用手机布局', () => {
    expect(pick(1280, 720, false)).toBe(false);
    expect(pick(1024, 768, true)).toBe(false);
    expect(pick(768, 1024, true)).toBe(false);
  });

  it('网址参数可以强制', () => {
    expect(pick(1920, 1080, false, '?layout=phone')).toBe(true);
    expect(pick(844, 390, true, '?seed=1&layout=desktop')).toBe(false);
  });
});

describe('相机', () => {
  it('电脑上、手机上适配过的场景：1:1 按渲染倍数显示', () => {
    expect(cameraFor(false, false, 2)).toEqual({ zoom: 2, scrollX: 0, scrollY: 0, phoneLayout: false });
    expect(cameraFor(true, true, 2)).toEqual({ zoom: 2, scrollX: 0, scrollY: 0, phoneLayout: true });
  });

  it('0.14.0 EXPAND：窗口比 16:9 宽或高时画布变长，1280×720 的世界居中、多出来的边左右（上下）平分', () => {
    // 1920×960 的窗口：画布高 720、宽 1440，世界左右各多出 80
    expect(cameraFor(false, false, 1, { w: 1440, h: 720 })).toEqual({ zoom: 1, scrollX: -80, scrollY: 0, phoneLayout: false });
    // 1440×900（16:10）：画布宽 1280、高 800，上下各多出 40；渲染倍数 2 时画布像素翻倍，世界不变
    expect(cameraFor(false, false, 2, { w: 2560, h: 1600 })).toEqual({ zoom: 2, scrollX: 0, scrollY: -40, phoneLayout: false });
    // 手机适配过的场景按 960×444 居中
    expect(cameraFor(true, true, 1, { w: 1000, h: 444 })).toEqual({ zoom: 1, scrollX: -20, scrollY: 0, phoneLayout: true });
  });

  it('手机上还没适配的场景：整个 1280×720 缩小后居中放进 960×444，不裁掉任何一边', () => {
    const scale = 2;
    const c = cameraFor(false, true, scale);
    expect(c.phoneLayout).toBe(false);
    // 世界坐标 → 画布像素（相机原点在左上角）
    const px = (x: number): number => (x - c.scrollX) * c.zoom;
    const py = (y: number): number => (y - c.scrollY) * c.zoom;
    const W = 960 * scale;
    const H = 444 * scale;
    expect(px(0)).toBeGreaterThanOrEqual(-1e-6);
    expect(py(0)).toBeGreaterThanOrEqual(-1e-6);
    expect(px(GAME_WIDTH)).toBeLessThanOrEqual(W + 1e-6);
    expect(py(GAME_HEIGHT)).toBeLessThanOrEqual(H + 1e-6);
    // 居中：左右（上下）留白一样
    expect(px(0)).toBeCloseTo(W - px(GAME_WIDTH), 6);
    expect(py(0)).toBeCloseTo(H - py(GAME_HEIGHT), 6);
    // 高度是贴满的那一边
    expect(py(GAME_HEIGHT) - py(0)).toBeCloseTo(H, 6);
  });
});

/** 在 node 里装成一台 844×390 的手机，重新加载模块（PHONE 是加载时算的）。 */
async function asPhone(): Promise<{ viewport: typeof import('../src/view/viewport.ts'); layout: typeof import('../src/view/trade/layout.ts'); theme: typeof import('../src/view/theme.ts') }> {
  vi.resetModules();
  vi.stubGlobal('window', {
    innerWidth: 844,
    innerHeight: 390,
    devicePixelRatio: 2,
    screen: { width: 390, height: 844 },
    location: { search: '' },
    matchMedia: () => ({ matches: true }),
  });
  return {
    viewport: await import('../src/view/viewport.ts'),
    layout: await import('../src/view/trade/layout.ts'),
    theme: await import('../src/view/theme.ts'),
  };
}

function fakeScene(): Phaser.Scene {
  const cam = { setOrigin: () => cam, setSize: () => cam, setZoom: () => cam, setScroll: () => cam };
  // 0.14.0 applyCamera 读画布尺寸、挂窗口缩放的监听
  return {
    cameras: { main: cam },
    scale: { gameSize: { width: 960, height: 444 }, on: () => undefined, off: () => undefined },
    events: { once: () => undefined },
    sys: { isActive: () => true },
  } as unknown as Phaser.Scene;
}

describe('手机上（844×390）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('世界是 960×444，渲染倍数取整（画布宽是 960 的整数倍）', async () => {
    const { theme } = await asPhone();
    expect(theme.PHONE).toBe(true);
    expect(theme.VIEW).toEqual({ w: 960, h: 444 });
    expect(Number.isInteger(theme.RENDER_SCALE)).toBe(true);
  });

  it('viewOf 按 setupCamera 登记的结果，不靠猜相机缩放', async () => {
    const { viewport } = await asPhone();
    const ready = fakeScene();
    const legacy = fakeScene();
    const unknown = fakeScene();
    viewport.applyCamera(ready, true);
    viewport.applyCamera(legacy, false);
    expect(viewport.viewOf(ready)).toEqual({ w: 960, h: 444 });
    expect(viewport.phoneLayout(ready)).toBe(true);
    expect(viewport.viewOf(legacy)).toEqual({ w: GAME_WIDTH, h: GAME_HEIGHT });
    expect(viewport.phoneLayout(legacy)).toBe(false);
    expect(viewport.viewOf(unknown)).toEqual({ w: GAME_WIDTH, h: GAME_HEIGHT });
    // 同一个场景重新按兜底方式搭：登记跟着改
    viewport.applyCamera(ready, false);
    expect(viewport.phoneLayout(ready)).toBe(false);
  });

  it('交易画面的各区域都在 960×444 里，互不重叠', async () => {
    const { layout } = await asPhone();
    const inside = (r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= 960 && r.y + r.h <= 444;
    const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const tabs = layout.TABS;
    expect(tabs).not.toBeNull();
    const regions: Record<string, Rect> = {
      top: layout.TOP,
      slots: layout.SLOTS,
      recap: layout.RECAP_AREA,
      monitor: layout.MONITOR,
      open: layout.OPEN,
      tabs: tabs as Rect,
      panel: layout.PHONE_RECT,
    };
    for (const [k, r] of Object.entries(regions)) expect(inside(r), k).toBe(true);
    // 群聊和风口共用右边一块（标签页切换）；小结和猫的提示共用左下角（一次露一个）
    expect(layout.BOARD).toEqual(layout.PHONE_RECT);
    expect(layout.HINT_AREA).toEqual(layout.RECAP_AREA);
    const names = Object.keys(regions);
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) expect(overlap(regions[names[i]!]!, regions[names[j]!]!), `${names[i]} × ${names[j]}`).toBe(false);
    // 标签页点击区（按钮高 + 往下多出的 4）凑够 50，约 44px
    expect((tabs as Rect).h + 4).toBeGreaterThanOrEqual(50);
  });

  it('1～5 格持仓都排在持仓区里，不重叠', async () => {
    const { layout } = await asPhone();
    for (let n = 1; n <= 5; n++) {
      const rs = layout.slotRects(n);
      expect(rs).toHaveLength(n);
      rs.forEach((r, i) => {
        expect(r.x).toBeGreaterThanOrEqual(layout.SLOTS.x);
        expect(r.x + r.w).toBeLessThanOrEqual(layout.SLOTS.x + layout.SLOTS.w);
        if (i > 0) expect(r.x).toBeGreaterThan(rs[i - 1]!.x + rs[i - 1]!.w);
      });
    }
  });
});

describe('电脑上不受影响', () => {
  it('node 里没有 window 时按电脑：世界 1280×720，没有标签页', async () => {
    vi.resetModules();
    const theme = await import('../src/view/theme.ts');
    const layout = await import('../src/view/trade/layout.ts');
    expect(theme.PHONE).toBe(false);
    expect(theme.VIEW).toEqual({ w: 1280, h: 720 });
    expect(layout.TABS).toBeNull();
  });
});
