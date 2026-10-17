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

/**
 * 世界缩放：一屏大约看到多大的世界。按高度定（横屏），手机上看到的世界稍大一点，免得怪贴脸了才看见；
 * 宽屏也不让看到的宽超过 1,400 单位（太宽了刷怪圈露馅）。
 */
export function worldZoom(cssW: number, cssH: number): number {
  const byH = cssH / (cssH < 500 ? 500 : 560);
  return Math.max(byH, cssW / 1400);
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
