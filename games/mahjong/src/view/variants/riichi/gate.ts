/**
 * 立直入口的开关（docs/riichi.md 第 6 节）：0.25.3 统一验收后放开，选桌页（单机和好友房）都有"玩法"选项。
 * 线上出了大问题要先收起来时改回 true（一处），之后只有地址带 ?rc=1 才显示。
 */
export const RIICHI_GATED = false;

/** 页面上现在能不能选立直 */
export function riichiOpen(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return !RIICHI_GATED || new URLSearchParams(search).get('rc') === '1';
}
