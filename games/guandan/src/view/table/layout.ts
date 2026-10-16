/** 牌桌各座位的锚点（世界坐标）。座位 0 我在下，1 下家在右，2 对家在上，3 上家在左（逆时针出牌）。 */
export interface SeatAnchor {
  /** 头像中心 */
  ax: number;
  ay: number;
  /** 头像直径 */
  size: number;
  /** 出牌区锚点：align 决定牌从这里向哪边排 */
  px: number;
  py: number;
  align: 'left' | 'center' | 'right';
  /** 气泡位置与尾巴方向 */
  bx: number;
  by: number;
  bdir: 'left' | 'right' | 'up' | 'down';
}

export const TOPBAR_H = 58;
export const BUTTON_Y = 412;

/**
 * partnerMinX：对家头像中心最少在哪（手机上顶栏左边的云朵、邀请按钮要 44 CSS 像素宽，头像得让开，0.10.0）。
 * 对家的气泡放在头像左边（尾巴朝右）：右边是剩余张数和记牌条，放右边会把记牌条最左几列盖住。
 * 头像让开以后离桌心近了，名牌会压住居中摆的出牌，这时出牌改成从头像右边往右排。
 */
export function seatAnchors(W: number, partnerMinX = 0): SeatAnchor[] {
  const p = Math.max(W / 2 - 250, partnerMinX);
  const shifted = p > W / 2 - 250;
  return [
    { ax: 60, ay: 396, size: 72, px: W / 2, py: 294, align: 'center', bx: 132, by: 330, bdir: 'down' },
    { ax: W - 86, ay: 262, size: 96, px: W - 200, py: 262, align: 'right', bx: W - 150, by: 176, bdir: 'down' },
    { ax: p, ay: 112, size: 90, px: shifted ? p + 64 : W / 2, py: 196, align: shifted ? 'left' : 'center', bx: p - 64, by: 104, bdir: 'right' },
    { ax: 86, ay: 262, size: 96, px: 200, py: 262, align: 'left', bx: 150, by: 176, bdir: 'down' },
  ];
}
