import type { Rect } from '../rect.ts';
import { PHONE } from '../theme.ts';

/**
 * 交易主场景的布局，见设计稿第 10 节。电脑是 1280×720 的世界；
 * 手机横屏（0.5.5）是 960×444：持仓在左上、收盘小结在左下、开盘键在右下角旁边，
 * 右边一块用标签页在「群聊」和「风口」之间切换（三块都摆开字就小得看不清）。
 */
const DESKTOP = {
  TOP: { x: 8, y: 8, w: 1264, h: 56 },
  /** 左栏题材看板 */
  BOARD: { x: 10, y: 70, w: 246, h: 644 },
  /** 右栏手机群聊 */
  PHONE: { x: 966, y: 66, w: 306, h: 650 },
  /** 中间持仓区（卡片顶到底） */
  SLOTS: { x: 266, y: 232, w: 692, h: 222 },
  /** 显示器上的状态条 */
  MONITOR: { x: 478, y: 466, w: 324, h: 64 },
  /** 开盘按钮 */
  OPEN: { x: 476, y: 604, w: 270, h: 84 },
  /** 收盘小结 */
  RECAP: { x: 278, y: 68, w: 668, h: 160 },
  /** 猫的提示气泡 */
  HINT: { x: 262, y: 448, w: 214, h: 164 },
  /** 群聊 / 风口的标签页（电脑上没有） */
  TABS: null as Rect | null,
} satisfies Record<string, Rect | null>;

const MOBILE: typeof DESKTOP = {
  TOP: { x: 4, y: 4, w: 952, h: 46 },
  BOARD: { x: 616, y: 102, w: 338, h: 338 },
  PHONE: { x: 616, y: 102, w: 338, h: 338 },
  SLOTS: { x: 8, y: 56, w: 600, h: 222 },
  MONITOR: { x: 462, y: 284, w: 146, h: 58 },
  OPEN: { x: 462, y: 350, w: 146, h: 86 },
  RECAP: { x: 8, y: 284, w: 448, h: 154 },
  HINT: { x: 8, y: 284, w: 448, h: 154 },
  // 标签页是手机上点得最多的地方：高 46（844×390 上约 40px），下沿再往下撑一点点击区见 tabs.ts
  TABS: { x: 616, y: 52, w: 338, h: 46 },
};

const L = PHONE ? MOBILE : DESKTOP;

export const TOP: Rect = L.TOP;
export const BOARD: Rect = L.BOARD;
export const PHONE_RECT: Rect = L.PHONE;
export const SLOTS: Rect = L.SLOTS;
export const MONITOR: Rect = L.MONITOR;
export const OPEN: Rect = L.OPEN;
export const RECAP_AREA: Rect = L.RECAP;
export const HINT_AREA: Rect = L.HINT;
export const TABS: Rect | null = L.TABS;

/** n 格持仓时每张卡的位置（居中排开）。 */
export function slotRects(n: number): Rect[] {
  const gap = PHONE ? (n <= 4 ? 8 : 6) : n <= 4 ? 16 : 10;
  const w = Math.min(160, Math.floor((SLOTS.w - gap * (n - 1)) / n));
  const total = w * n + gap * (n - 1);
  const x0 = SLOTS.x + Math.round((SLOTS.w - total) / 2);
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), y: SLOTS.y, w, h: SLOTS.h }));
}
