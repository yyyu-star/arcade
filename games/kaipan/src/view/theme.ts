import type { Feel, Rarity, ThemeId } from '../core/index.ts';
import type { ColorScheme } from '../platform/settings.ts';

/**
 * 配色与字体集中在这里（0.3 纸张卡通风）。颜色按 A 股习惯：红涨绿跌；设置里可切换为绿涨红跌
 * （applyColorScheme，已创建的界面需重建后生效）。
 * 承载信息的文字（ink / muted / 涨跌色）对纸面底色（paper）的对比度都 ≥ 4.5:1；
 * dim 只用于装饰性的小字（快捷键提示）。
 */
export const COLOR: Record<
  | 'bg' | 'paper' | 'paperHi' | 'paperLo' | 'edge' | 'ink' | 'muted' | 'dim' | 'up' | 'down' | 'flat'
  | 'accent' | 'accentDark' | 'info' | 'gold' | 'danger' | 'overlay' | 'white' | 'screen' | 'screenText',
  number
> = {
  bg: 0xf3e2c7,
  paper: 0xfff6e6,
  paperHi: 0xffffff,
  paperLo: 0xf6e7cf,
  edge: 0xe2cdb0,
  /** 描边与正文：深梅子棕（与美术描边同色） */
  ink: 0x3a2634,
  muted: 0x6e5966,
  dim: 0x9c8892,
  up: 0xd8342c,
  down: 0x137a42,
  flat: 0x6e5966,
  accent: 0xff7a33,
  accentDark: 0xc4501a,
  info: 0x3f6fe0,
  gold: 0xf6c02f,
  danger: 0xd8342c,
  overlay: 0x2a1a24,
  white: 0xffffff,
  /** 显示器屏幕上的状态条 */
  screen: 0x22303f,
  screenText: 0xe8f4ff,
};

const RED = 0xd8342c;
const GREEN = 0x137a42;

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x8d7b84,
  uncommon: 0x3f7fe0,
  rare: 0xa24fd0,
};

/** 题材主色（与 tools/art/lib/svg.ts 的 THEME_COLORS 一致）。 */
export const THEME_COLOR: Record<ThemeId, number> = {
  ai: 0x1fbfe8,
  newenergy: 0x9ad13c,
  consumer: 0xff7a33,
  pharma: 0x2fc49a,
  finance: 0xf6c02f,
  lowalt: 0x4f7cff,
  gaming: 0xcc4fe0,
  pig: 0xff9cc8,
};

/** 体感标签底色：冷门灰蓝、升温橙、火热红、过热紫红、降温冰蓝。 */
export const FEEL_COLOR: Record<Feel, number> = {
  cold: 0x8fa3b8,
  warming: 0xff9a3c,
  hot: 0xf2553c,
  overheated: 0xc2307a,
  cooling: 0x58b6e0,
};

/** 道具分类色：战法橙、工具蓝、人脉绿。 */
export const ITEM_KIND_COLOR: Record<string, number> = {
  tactic: 0xff8a3d,
  tool: 0x4f8bff,
  network: 0x35b36e,
};

export const FONT =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Droid Sans Fallback", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
/**
 * 数字用等宽数字（滚动时不抖），回退到中文字体。0.16.0 起排第一的是自带的圆体数字 Kaipan Num（只有数字和几个符号，
 * 万、亿、箭头这些逐字回退到后面的字体），见 numFont.ts。
 */
export const FONT_NUM = '"Kaipan Num", "Consolas", "Menlo", "DejaVu Sans Mono", "Microsoft YaHei", "Droid Sans Fallback", monospace';

/** 切换涨跌配色：cn 红涨绿跌，intl 绿涨红跌。 */
export function applyColorScheme(next: ColorScheme): void {
  COLOR.up = next === 'cn' ? RED : GREEN;
  COLOR.down = next === 'cn' ? GREEN : RED;
}

/** 0xRRGGBB → '#rrggbb'（Phaser Text 需要 CSS 颜色字符串）。 */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** 按正负取涨/跌/平色。 */
export function signColor(v: number): number {
  return v > 0.004 ? COLOR.up : v < -0.004 ? COLOR.down : COLOR.flat;
}

/** 浅色底上用深字，深色底上用白字（按相对亮度）。 */
export function textOn(fill: number): number {
  const r = ((fill >> 16) & 255) / 255;
  const g = ((fill >> 8) & 255) / 255;
  const b = (fill & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? COLOR.ink : COLOR.white;
}

/** 电脑版的世界坐标（布局）尺寸；实际画布按 RENDER_SCALE 放大渲染。 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * 0.5.5 手机：短边不超过 500（CSS 像素）就用 960×444 的世界（844×390 的屏幕上约 0.88 倍，
 * 1280×720 时只有 0.54 倍，字小得看不清）。URL 参数 layout=phone / layout=desktop 可以强制。
 * 竖屏打开也要算进来（微信里点开链接默认是竖屏，先看到「横过来」提示，转过来后铺满的应该是手机版）；
 * 竖屏时再要求是触屏，免得把又窄又高的电脑窗口判成手机。
 * 开局时定下来，中途改窗口大小不切换（布局是开局时搭的；转屏只是同一块画布换个方向铺满）。
 */
export function pickPhoneLayout(o: { w: number; h: number; search: string; coarse: boolean }): boolean {
  const forced = new URLSearchParams(o.search).get('layout');
  if (forced === 'phone') return true;
  if (forced === 'desktop') return false;
  if (Math.min(o.w, o.h) > 500) return false;
  return o.w > o.h || o.coarse;
}

export const PHONE = ((): boolean => {
  if (typeof window === 'undefined') return false;
  return pickPhoneLayout({
    w: window.innerWidth,
    h: window.innerHeight,
    search: window.location.search,
    coarse: !!window.matchMedia?.('(pointer: coarse)').matches,
  });
})();

/** 实际的世界尺寸：电脑 1280×720，手机横屏 960×444。适配过手机的界面按它布局。 */
export const VIEW = PHONE ? { w: 960, h: 444 } : { w: GAME_WIDTH, h: GAME_HEIGHT };

/**
 * 0.5.9 省内存的设备：iOS（含报成 Mac 的 iPad）和触屏手机平板。iOS Safari 的网页进程内存超了会直接"网页已崩溃"，
 * 2GB 内存的老 iPhone（iOS 15）上开盘、掼蛋都打不开。这类设备渲染倍数封顶 2（图集是 2 倍烘焙的，超过 2 就不用图集、
 * 几百张 SVG 各自光栅化，实测纹理从约 380 MB 涨到 830 MB），整屏的场景背景按 1 倍光栅化（背景是柔和的插画，
 * 每张 2 倍要 15 MB、十几张就两百多 MB）。
 */
export const LOW_MEMORY = ((): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios || !!window.matchMedia?.('(pointer: coarse)').matches;
})();

/**
 * 渲染倍数：按屏幕物理像素取整（1..3；省内存的设备最多 2），画布尺寸 = 世界尺寸 × 倍数，
 * 各场景相机 zoom 同样倍数。这样 FIT 缩放时浏览器基本只做缩小，文字不再发虚。
 */
export const RENDER_SCALE = ((): number => {
  // 单元测试（node）里没有 window
  if (typeof window === 'undefined') return 1;
  // 调试：URL 参数 scale=N 强制渲染倍数（用于清晰度对比）
  const forced = Number(new URLSearchParams(window.location.search).get('scale'));
  if (forced >= 1 && forced <= 3) return Math.round(forced);
  const dpr = window.devicePixelRatio || 1;
  // 手机横屏时屏幕的长边对应世界的宽。真正的手机平板（省内存的设备、窗口长边接近屏幕长边）按看得见的区域算
  // （iOS 的 screen 是竖着的整屏、不扣地址栏）；电脑和开了小窗的二合一按显示器算：窗口开小了之后再拉大，画面也不发虚
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const scw = window.screen?.width || VIEW.w;
  const sch = window.screen?.height || VIEW.h;
  const visible = LOW_MEMORY && Math.max(iw, ih) >= 0.9 * Math.max(scw, sch);
  const sw = (visible ? iw : scw) || VIEW.w;
  const sh = (visible ? ih : sch) || VIEW.h;
  const w = (PHONE ? Math.max(sw, sh) : sw) * dpr;
  const h = (PHONE ? Math.min(sw, sh) : sh) * dpr;
  return Math.min(LOW_MEMORY ? 2 : 3, Math.max(1, Math.ceil(Math.min(w / VIEW.w, h / VIEW.h))));
})();

/**
 * 0.5 字号只用三级：大数字（账户、涨跌幅、效果数字）、标题（卡名、弹窗标题、结论）、标签（其余所有常驻文字）。
 * 字重：大数字与标题加粗，标签常规；强调只靠颜色（涨跌色 / accent），不再叠加粗与下划线。
 * 详情文字（悬停提示、展开的详情、怎么玩）也用 label 级。
 */
export const TYPE = { big: 28, title: 18, label: 13 } as const;

/**
 * 0.9.0 间距和圆角刻度（4 的倍数）：共用组件（按钮、弹窗、提示、高亮框）从这里取，新写和改动的布局也从这里取，不再写零散数字。
 * 圆角：小标签和行高亮 sm、按钮和卡片 md、浮层 lg；九宫格素材自带圆角，不受这里管。
 */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16 } as const;

/** 涨跌箭头（↑ / ↓ / 平），配合 signColor 用。 */
export function arrowOf(v: number): string {
  return v > 0.004 ? '↑' : v < -0.004 ? '↓' : '–';
}
