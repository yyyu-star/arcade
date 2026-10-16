/**
 * 配色、字体、世界尺寸与渲染倍数。
 *
 * 世界坐标高度固定 720，宽度随屏幕宽高比在 1280..1720 之间变（手机横屏更宽，不留黑边，手牌能排得更开）。
 * 宽高比按实际可见区域算（device.ts 的 appBox，不用 screen 和 100vh）。
 * 画布按 RENDER_SCALE 倍的物理像素绘制，相机同倍数 zoom，文字和贴图按实际像素栅格化，FIT 缩放时只缩小不放大，字就不糊。
 */
import { appBox, pickRenderScale } from './device.ts';

export const COLOR = {
  felt: 0x1f5a43,
  feltDark: 0x123a2b,
  wood: 0x6b3b1f,
  woodDark: 0x3e2110,
  red: 0xb3202a,
  redDark: 0x7d121a,
  gold: 0xe0b45a,
  goldLight: 0xffe3a0,
  goldDark: 0x9a7330,
  ivory: 0xfff7e6,
  paper: 0xfbf1dc,
  ink: 0x2b1d14,
  muted: 0x7a6555,
  dim: 0xb8a690,
  green: 0x2f9e5b,
  blue: 0x3a78c8,
  teamUs: 0xd9443a,
  teamThem: 0x3a78c8,
  overlay: 0x0b0806,
  grey: 0x8c8378,
  white: 0xffffff,
} as const;

export const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Droid Sans Fallback", sans-serif';
/** 标题和大字：优先游戏自带的宋体子集（fonts.ts，缺字时逐字回退），再系统宋体，没有就退回黑体 */
export const FONT_TITLE = '"GD Title", "Noto Serif SC", "Songti SC", "STSong", "SimSun", "Noto Sans CJK SC", "Microsoft YaHei", serif';
export const FONT_NUM = '"Arial Black", "Helvetica Neue", Arial, "DejaVu Sans", "Noto Sans CJK SC", sans-serif';

export function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export const GAME_HEIGHT = 720;
export const MIN_WIDTH = 1280;
export const MAX_WIDTH = 1720;

/** 按窗口宽高比算世界宽度：16:9 及更窄时 1280（上下留边），更宽时加宽到最多 1720。 */
export function worldWidthFor(w: number, h: number): number {
  if (!(w > 0 && h > 0)) return MIN_WIDTH;
  const want = Math.round((GAME_HEIGHT * w) / h / 4) * 4;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, want));
}

/** 渲染倍数（1..3）：按实际可见区域 × DPR，iOS 封顶 2，省内存模式 1；算法见 device.ts。 */
export const RENDER_SCALE = pickRenderScale();

/** 字号只用几级，保证手机横屏上最小字也有约 10 CSS 像素（720 高缩到 390 时 ×0.54）。 */
export const TYPE = { huge: 68, big: 40, title: 28, body: 23, label: 20, small: 18 } as const;

/** 间距刻度（世界坐标，4 的倍数）：留白、间隔只用这几级，不再到处写死数字 */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** 圆角刻度：小件（标签、小按钮）、按钮、面板内框、面板外框；胶囊形写高度的一半 */
export const RADIUS = { sm: 8, md: 12, lg: 14, xl: 22 } as const;
/** 投影：一律往下偏、同一个浓度，光从正上方来 */
export const SHADOW = { dy: 4, alpha: 0.35 } as const;

/**
 * 点按区域的下限：44 CSS 像素合多少世界坐标。电脑上 1280×720 是 1:1，就是 44；手机横屏 844×390 缩到 ×0.54，要 82。
 * 画出来的按钮可以比它小，点按区域往外扩（kit.ts 的 setHit）；挨得近的（顶栏图标、竖排按钮）调用方按间距收窄，不互相压着。
 * 窗口变了画面会重建（转屏、电脑上宽度变化大），重建时重新算。
 */
export function minHit(): number {
  if (typeof window === 'undefined') return 44;
  const b = appBox();
  return hitFor(b.w, b.h);
}

/** 可见区域 w×h CSS 像素时，44 CSS 像素合多少世界坐标（画布按 FIT 缩放，取宽、高两个方向小的那个比例） */
export function hitFor(w: number, h: number): number {
  const k = Math.min(w / worldWidthFor(w, h), h / GAME_HEIGHT);
  return Math.max(44, Math.min(96, Math.ceil(44 / k)));
}

/** 按钮的几种配色：主按钮红、要紧的金、确认绿、次要木色、联机蓝。按下、悬停、禁用由 kit.ts 按同一套规则算 */
export const BUTTON = {
  red: { fill: 0xc0282f, text: 0xfff3d6, rim: 0xf0c66e },
  gold: { fill: 0xe6b450, text: 0x4a2a0c, rim: 0xfff0c0 },
  green: { fill: 0x2f8a55, text: 0xf2fff4, rim: 0xb8e6c4 },
  wood: { fill: 0x7a4a26, text: 0xffeccb, rim: 0xd7a55b },
  blue: { fill: 0x2f68b0, text: 0xeef6ff, rim: 0xa8cdf5 },
  off: { fill: 0x5d5049, text: 0xb5aaa0, rim: 0x8a7d70 },
} as const;
/** 键盘焦点框的颜色：金色在红、木、绿底上都看得见 */
export const FOCUS_RING = 0xffd54a;

/**
 * DOM 部分（好友房面板、转屏提示、出错面板、添加到主屏幕）用的同一套刻度和配色，写成 CSS 变量。
 * 变量带 `--gd-` 前缀：和平台同域，但变量只在掼蛋自己的页面里，前缀只为一眼看出是谁的。
 */
export const THEME_CSS = `
:root {
  --gd-s1: 4px; --gd-s2: 8px; --gd-s3: 12px; --gd-s4: 16px; --gd-s6: 24px; --gd-s8: 32px;
  --gd-r-sm: 8px; --gd-r-md: 12px; --gd-r-lg: 18px; --gd-r-pill: 999px;
  --gd-font: ${FONT};
  --gd-font-num: ${FONT_NUM};
  --gd-red: ${css(COLOR.red)}; --gd-red-dark: ${css(COLOR.redDark)}; --gd-gold: ${css(COLOR.gold)}; --gd-gold-light: ${css(COLOR.goldLight)};
  --gd-wood: ${css(COLOR.wood)}; --gd-paper: ${css(COLOR.paper)}; --gd-ink: ${css(COLOR.ink)}; --gd-muted: ${css(COLOR.muted)};
  --gd-green: ${css(BUTTON.green.fill)}; --gd-felt: ${css(COLOR.felt)}; --gd-felt-dark: ${css(COLOR.feltDark)}; --gd-focus: ${css(FOCUS_RING)};
  --gd-shadow: 0 4px 0 rgba(0, 0, 0, 0.35);
  --gd-hit: 44px;
}
/* 统一的按钮：常态、悬停、按下（下沉）、禁用、键盘焦点、加载中 */
.gd-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--gd-s2); min-height: var(--gd-hit); padding: 0 var(--gd-s4);
  border: 2px solid rgba(255, 240, 192, 0.55); border-radius: var(--gd-r-md); background: var(--gd-red); color: #fff3d6;
  font: bold 16px/1 var(--gd-font); box-shadow: var(--gd-shadow); cursor: pointer; position: relative;
  transition: transform 80ms ease-out, filter 120ms, box-shadow 80ms; -webkit-tap-highlight-color: transparent; }
.gd-btn:hover:not(:disabled) { filter: brightness(1.08); }
.gd-btn:active:not(:disabled) { transform: translateY(2px) scale(0.97); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35); }
.gd-btn:disabled { background: #5d5049; color: #b5aaa0; border-color: #8a7d70; cursor: default; box-shadow: none; }
.gd-btn:focus-visible { outline: 3px solid var(--gd-focus); outline-offset: 2px; }
.gd-btn.is-loading { color: transparent; pointer-events: none; }
.gd-btn.is-loading::after { content: ""; position: absolute; width: 18px; height: 18px; border-radius: 50%;
  border: 3px solid rgba(255, 243, 214, 0.35); border-top-color: #fff3d6; animation: gd-spin 0.8s linear infinite; }
.gd-btn.gd-2 { background: #7a6555; }
.gd-btn.gd-big { min-height: 56px; font-size: 22px; background: var(--gd-green); }
@keyframes gd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .gd-btn { transition: none; } .gd-btn.is-loading::after { animation-duration: 2.4s; } }
`;

/** 把 THEME_CSS 挂进页面（只挂一次）；各个 DOM 部件挂自己的样式前先调它 */
export function mountThemeCss(): void {
  if (typeof document === 'undefined' || document.getElementById('gd-theme')) return;
  const st = document.createElement('style');
  st.id = 'gd-theme';
  st.textContent = THEME_CSS;
  document.head.appendChild(st);
}
