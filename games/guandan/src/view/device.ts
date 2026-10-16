/**
 * 设备与可见区域：iOS 识别、实际能看到的区域、渲染倍数、省内存模式。
 *
 * iOS Safari 的 100vh 和 screen 尺寸是工具栏收起时的最大高度，比真能看到的高，按它们排版顶栏会被地址栏盖住，
 * 按它们算渲染倍数还会偏大；所以布局和倍数一律按 visualViewport / innerHeight 量出来的可见区域，再扣掉安全区。
 *
 * 省内存模式：老 iPhone 内存不够时 WebKit 直接杀掉页面（"网页已崩溃"），JS 来不及做任何事。
 * 所以页面在前台时本地记一笔"开着"，切到后台或正常离开（pagehide）就清掉；下次打开还看到这笔记录，
 * 说明上次是开着的时候被杀掉的，这次降一档：先 1 倍渲染，再不行换 Canvas 渲染。只在 iOS 上记。
 * 换版本后重新试正常模式（新版本可能已经修好了）。
 */
import { KEYS, rawStore } from './store.ts';

// 和 theme.ts 一致；theme.ts 引用本文件，反过来引用会循环
const GAME_HEIGHT = 720;
const MIN_WIDTH = 1280;

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13 起 UA 冒充 Mac，靠触屏点数区分
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** iOS 上的 Safari 本体（别的浏览器、微信等内置浏览器没有"添加到主屏幕"） */
export function isIOSSafari(): boolean {
  return isIOS() && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|MicroMessenger|QQ\/|Weibo|DingTalk|AlipayClient/.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * 实际可见区域（CSS 像素，相对布局视口的左上角）：Safari 工具栏盖住页面顶上一截时，visualViewport 的 offsetTop 会大于 0。
 * 双指放大中返回 null：这时 visualViewport 只是放大镜的取景框，大小和偏移跟着手指走，iOS 上也没法可靠地还原成没放大的尺寸，
 * 调用方沿用上次的区域，不跟着动。
 */
function visibleBox(): Box | null {
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) return null;
  let x = 0;
  let y = 0;
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (vv && vv.width > 0 && vv.height > 0) {
    w = Math.min(w || Infinity, vv.width);
    h = Math.min(h || Infinity, vv.height);
    x = Math.max(0, vv.offsetLeft);
    y = Math.max(0, vv.offsetTop);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

let probe: HTMLElement | null = null;
/** 安全区（刘海、圆角、Home 条）；没有 env() 的浏览器全是 0 */
function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string): number => Math.max(0, parseFloat(v) || 0);
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

/** 画面容器能用的区域：可见区域扣掉安全区；双指放大中为 null */
function measureAppBox(): Box | null {
  const v = visibleBox();
  if (!v) return null;
  const s = safeInsets();
  return { x: v.x + s.left, y: v.y + s.top, w: Math.max(1, v.w - s.left - s.right), h: Math.max(1, v.h - s.top - s.bottom) };
}

let fitted: Box | null = null;

/**
 * 把 #app 钉到可见区域（CSS 里的 100vh/100dvh 只是 JS 跑起来之前的兜底）。
 * 返回这次是不是真的改了尺寸：没变、或者正在双指放大时不写，调用方也就不用让 Phaser 重新缩放（visualViewport 的
 * scroll/resize 来得很密，每次都写会让画面抖）。
 */
export function fitAppToViewport(el: HTMLElement): boolean {
  const b = measureAppBox();
  if (!b || (fitted && sameBox(fitted, b))) return false;
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
  fitted = b;
  return true;
}

/** #app 现在的区域（上次钉上去的；还没钉过就现量，放大中再退回整个窗口） */
export function appBox(): Box {
  return fitted ?? measureAppBox() ?? { x: 0, y: 0, w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) };
}

interface BootMark {
  v: 1;
  /** 1 = 页面开着（前台）；被系统杀掉时来不及清，下次打开还看到 1 */
  pending: 0 | 1;
  /** 省内存档位：0 正常，1 一倍渲染，2 再加 Canvas 渲染 */
  low: 0 | 1 | 2;
  ver: string;
}

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
/** 只在 iOS 上记：桌面浏览器崩溃、断电不该把画质永久降下去 */
const TRACK = typeof window !== 'undefined' && isIOS();

function readMark(): BootMark {
  const m = rawStore.read<Partial<BootMark>>(KEYS.boot);
  if (!m || m.v !== 1 || m.ver !== VERSION) return { v: 1, pending: 0, low: 0, ver: VERSION };
  return { v: 1, pending: m.pending === 1 ? 1 : 0, low: m.low === 2 ? 2 : m.low === 1 ? 1 : 0, ver: VERSION };
}

/** 本次启动用的省内存档位（模块加载时定下来，之后不变） */
export const LOW_MEMORY: 0 | 1 | 2 = (() => {
  if (!TRACK) return 0;
  const m = readMark();
  const low = (m.pending ? Math.min(2, m.low + 1) : m.low) as 0 | 1 | 2;
  rawStore.write(KEYS.boot, { ...m, pending: 1, low } satisfies BootMark);
  return low;
})();

/** 页面切到后台或正常离开：这段时间没被杀，清掉标记；回到前台再记上 */
export function markForeground(on: boolean): void {
  if (!TRACK) return;
  const m = readMark();
  if (m.pending !== (on ? 1 : 0)) rawStore.write(KEYS.boot, { ...m, pending: on ? 1 : 0 } satisfies BootMark);
}

/** 画面被系统收回（WebGL 上下文丢了）：下次直接降一档 */
export function markRenderLost(): void {
  if (!TRACK) return;
  const m = readMark();
  rawStore.write(KEYS.boot, { ...m, pending: 0, low: Math.min(2, Math.max(LOW_MEMORY, m.low) + 1) as 0 | 1 | 2 } satisfies BootMark);
}

/**
 * 渲染倍数：可见区域 × DPR 取整（1..3）。iOS 封顶 2（老 iPhone 内存小，WebKit 超了直接杀页面）；省内存模式固定 1。
 * URL 参数 scale=N 强制倍数（清晰度对比、排查用），优先于以上全部。
 */
export function pickRenderScale(): number {
  if (typeof window === 'undefined') return 1;
  const forced = Number(new URLSearchParams(window.location.search).get('scale'));
  if (forced >= 1 && forced <= 3) return Math.round(forced);
  if (LOW_MEMORY > 0) return 1;
  const dpr = window.devicePixelRatio || 1;
  const v = visibleBox() ?? { w: window.innerWidth, h: window.innerHeight };
  // 竖屏打开时宽高是反的，长边对长边
  const long = Math.max(v.w, v.h) * dpr;
  const short = Math.min(v.w, v.h) * dpr;
  const s = Math.min(3, Math.max(1, Math.ceil(Math.min(long / MIN_WIDTH, short / GAME_HEIGHT) - 0.05)));
  return isIOS() ? Math.min(2, s) : s;
}

/** 启动前先试一下能不能拿到 WebGL：拿不到（或省内存第 2 档）就用 Canvas 渲染 */
export function webglUsable(): boolean {
  if (LOW_MEMORY >= 2) return false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // 试完马上还掉，老 iPhone 同时能开的 WebGL 上下文很少
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
