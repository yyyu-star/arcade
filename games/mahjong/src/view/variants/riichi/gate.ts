/**
 * 立直入口的开关（docs/riichi.md 第 6 节）：好友房（第 ④ 步）接好以前，选桌页的"玩法"选项先藏起来，
 * 只有地址带 ?rc=1 才显示。最后一步放开：把 RIICHI_GATED 改成 false（一处）。
 */
export const RIICHI_GATED = true;

/** 页面上现在能不能选立直 */
export function riichiOpen(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return !RIICHI_GATED || new URLSearchParams(search).get('rc') === '1';
}
