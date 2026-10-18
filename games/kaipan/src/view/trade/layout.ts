import type { Rect } from '../rect.ts';
import { PHONE, VIEW } from '../theme.ts';

/**
 * 交易主场景的布局，见设计稿第 10 节。电脑是 1280×720 的世界；
 * 手机横屏（0.5.5 起）：持仓在左上、收盘小结在左下、开盘键在右下角旁边，
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

/**
 * 手机（0.19.0）：世界宽 718–960、高 404（见 theme.ts 的 phoneWorld），各块按宽度算。
 * 右边群聊 / 风口一块占宽度的三分之一多（256–338），左边是持仓、下面是小结和开盘键。
 */
export function mobileLayout(W: number, H: number): typeof DESKTOP {
  const panelW = Math.max(256, Math.min(338, Math.round(W * 0.355)));
  const px = W - 6 - panelW;
  const leftW = px - 16;
  const slotsY = 54;
  const slotsH = 214;
  const lowY = slotsY + slotsH + 6;
  const lowH = H - 4 - lowY;
  const openW = 140;
  const ox = 8 + leftW - openW;
  const recap = { x: 8, y: lowY, w: leftW - openW - 8, h: lowH };
  return {
    TOP: { x: 4, y: 4, w: W - 8, h: 46 },
    BOARD: { x: px, y: 100, w: panelW, h: H - 104 },
    PHONE: { x: px, y: 100, w: panelW, h: H - 104 },
    SLOTS: { x: 8, y: slotsY, w: leftW, h: slotsH },
    MONITOR: { x: ox, y: lowY, w: openW, h: 46 },
    OPEN: { x: ox, y: lowY + 50, w: openW, h: lowH - 50 },
    RECAP: recap,
    HINT: recap,
    // 标签页是手机上点得最多的地方：高 46（SE 上约 43px），下沿再往下撑一点点击区见 tabs.ts
    TABS: { x: px, y: 52, w: panelW, h: 46 },
  };
}

const L = PHONE ? mobileLayout(VIEW.w, VIEW.h) : DESKTOP;

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
