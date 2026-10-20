import { RING } from '../core/step.ts';

/**
 * 手机和平板（尤其 iOS）的几条规矩（仓库根 AGENTS.md 第 4 节，做法照开盘 0.5.9）：
 * 省内存设备渲染倍数封顶 2；高度按看得见的区域算；双指放大时不改尺寸。
 */

/** iOS（含报成 Mac 的 iPad）和触屏手机平板：渲染倍数封顶 2、关粒子；?lowmem 强制（冒烟用） */
export const LOW_MEMORY = ((): boolean => {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('lowmem')) return true;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios || !!window.matchMedia?.('(pointer: coarse)').matches;
})();

/** 触屏（显示虚拟摇杆、不显示键盘提示） */
export const TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** 画布的渲染倍数：按 devicePixelRatio，省内存设备最多 2、别的最多 3 */
export function renderScale(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.min(LOW_MEMORY ? 2 : 3, dpr));
}

/** 竖屏按屏宽定缩放：一屏宽看到这么多世界单位（10-20 三档对比后定，见 CHANGELOG 0.3.15） */
export const TALL_BASE = 460;

/**
 * 世界缩放：一屏大约看到多大的世界。横屏按高度定，手机上看到的世界稍大一点，免得怪贴脸了才看见；
 * 竖屏按宽度定（原来也按高度，竖屏只看得见 260 宽，主角和怪大得挤满屏）。
 * 不管哪种，看得见的半宽、半高都不超过这局的刷怪圈（core 的 RING，tall 是竖屏开的局、圈转 90°），怪不会在屏里凭空冒出来；
 * 横屏局转成竖屏（或反过来）时靠这一条收紧视野。
 */
export function worldZoom(cssW: number, cssH: number, tall: boolean): number {
  const base = cssH > cssW ? cssW / TALL_BASE : cssH / (cssH < 500 ? 500 : 560);
  const [rx, ry] = tall ? [RING.short, RING.long] : [RING.long, RING.short];
  return Math.max(base, cssW / (2 * rx), cssH / (2 * ry));
}

/** 双指放大着（visualViewport.scale 明显不是 1） */
export function zoomed(scale: number | undefined): boolean {
  return scale !== undefined && Math.abs(scale - 1) > 0.02;
}

/** 写 --app-h（看得见的高度），尺寸变化时通知；转屏后稍等再补算一次。返回取消监听的函数 */
export function fitViewport(onFit: () => void): () => void {
  const root = document.documentElement;
  let last = '';
  const apply = (): void => {
    if (zoomed(window.visualViewport?.scale)) return;
    const vv = window.visualViewport;
    const w = Math.round(vv?.width ?? window.innerWidth);
    const h = Math.round(vv?.height ?? window.innerHeight);
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    const size = `${w}x${h}`;
    if (size === last) return;
    last = size;
    root.style.setProperty('--app-h', `${h}px`);
    onFit();
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = (): void => {
    apply();
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, 300);
  };
  apply();
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.visualViewport?.addEventListener('resize', later);
  return () => {
    window.removeEventListener('resize', later);
    window.removeEventListener('orientationchange', later);
    window.visualViewport?.removeEventListener('resize', later);
    if (timer) clearTimeout(timer);
  };
}
