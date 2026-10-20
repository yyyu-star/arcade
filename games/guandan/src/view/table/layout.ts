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

export const TOPBAR_H = 56;

/** 世界比 1280 宽时桌子两边各让出多少（art-v3：露出远景的暗室）；背景和左右两家的座位共用 */
export function tableSide(W: number): number {
  return Math.max(0, Math.round((W - 1280) * 0.3));
}
export const BUTTON_Y = 412;

/**
 * partnerMinX：对家头像中心最少在哪（手机上顶栏左边的云朵、邀请按钮要 44 CSS 像素宽，头像得让开，0.10.0）。
 * 对家的气泡放在头像左边（尾巴朝右）：右边是剩余张数和记牌条，放右边会把记牌条最左几列盖住。
 * 头像让开以后离桌心近了，名牌会压住居中摆的出牌，这时出牌改成从头像右边往右排。
 */
export function seatAnchors(W: number, partnerMinX = 0): SeatAnchor[] {
  const p = Math.max(W / 2 - 250, partnerMinX);
  // 左右两家坐在桌沿以内（宽屏时桌子往里让了）
  const d = tableSide(W);
  const shifted = p > W / 2 - 250;
  return [
    { ax: 60, ay: 396, size: 72, px: W / 2, py: 294, align: 'center', bx: 132, by: 330, bdir: 'down' },
    { ax: W - d - 86, ay: 262, size: 96, px: W - d - 200, py: 262, align: 'right', bx: W - d - 150, by: 176, bdir: 'down' },
    { ax: p, ay: 112, size: 90, px: shifted ? p + 64 : W / 2, py: 196, align: shifted ? 'left' : 'center', bx: p - 64, by: 104, bdir: 'right' },
    { ax: d + 86, ay: 262, size: 96, px: d + 200, py: 262, align: 'left', bx: d + 150, by: 176, bdir: 'down' },
  ];
}

/** 三人桌左右两家比四人桌往上挪多少：上方没有对家，挪上去给我头像上的"地主"牌和气泡让地方 */
const SIDE_LIFT_3 = 48;

/**
 * 三人桌（斗地主）：座位 0 我在下，1 下家在右，2 上家在左；左右两家取四人桌的位置再往上挪，桌子上方空出来放底牌和倍数
 */
export function seatAnchors3(W: number): SeatAnchor[] {
  const a = seatAnchors(W);
  const lift = (s: SeatAnchor): SeatAnchor => ({ ...s, ay: s.ay - SIDE_LIFT_3, py: s.py - SIDE_LIFT_3, by: s.by - SIDE_LIFT_3 });
  return [a[0]!, lift(a[1]!), lift(a[3]!)];
}
