// 顶栏的手机几何（不依赖 Phaser，单元测试直接用）。

/**
 * 0.19.0 手机顶栏按世界宽度排（718–960，见 theme.ts 的 phoneWorld）。960 宽时和以前一样；窄了以后，
 * 右边的设置、怎么玩、银行贴着右边，中间按这个顺序让出宽度：道具栏（让到 120）→ 要还的钱那一块（最多 60）→ 账户（最多 38）→ 日期（最多 16），
 * 还不够就是道具栏再变窄（放不下的收进「+N」）。
 */
export function phoneTopBar(W: number) {
  let need = Math.max(0, 960 - W);
  const take = (max: number): number => {
    const v = Math.min(max, need);
    need -= v;
    return v;
  };
  // 道具栏先让到 120（它常常是空的「月底挑道具」），再让要还的钱那一块
  take(94);
  const a = take(60);
  const d1 = take(38);
  const d0 = take(16);
  const s0 = d0;
  const s1 = d0 + d1;
  const s2 = d0 + d1 + a;
  const R = W - 4;
  const help = { x: R - 88, y: 7, w: 42, h: 38 };
  const bank = { x: R - 154, y: 6, w: 60, h: 40 };
  const itemsX = 646 - s2;
  return {
    lobby: { x: 4, y: 6, w: 40, h: 40, iconDy: 13, iconS: 18 },
    calIcon: { x: 66, y: 18, s: 22 }, day: { x: 82, y: 6, size: 16 }, calPill: { x: 54, y: 29, h: 18 }, calTextX: 62, row2Y: 38,
    calHit: { x: 50, y: 4, w: 136 - s0, h: 44 }, flagsRight: 182 - s0, flagY: 29,
    accLabel: { x: 216 - s0, y: 38 }, wallet: { x: 200 - s0, y: 18, s: 24 }, account: { x: 216 - s0, y: 3, size: 22 }, accHit: { x: 186 - s0, y: 4, w: 202 - d1, h: 44 }, accWideW: 222 - d1,
    goalX: 392 - s1, billLeft: 416 - s1, billRight: 640 - s2, billBox: { y: 6, h: 40 }, hourglass: { x: 604 - s2, y: 18, s: 18 }, daysLeft: { x: 616 - s2, y: 18 },
    billY: 6, billNoteY: 38, goalIconY: 18, goalWordY: 38, goalBarY: 34, goalBarW: 90 - Math.min(20, a / 2), houseY: 38, houseNoGoalY: 18, billTitleSize: 17,
    itemsX, itemsY: 4, itemsW: help.x - 6 - itemsX, itemsWExt: Math.max(30, bank.x - 6 - itemsX), rowIconY: 23, rowChipY: 23, row2Y0: 11, row2H: 23, row2Icon: 21,
    bank, bankIconDy: 14, bankIconS: 20,
    help, settings: { x: R - 40, y: 7, w: 40, h: 38 }, gear: { x: R - 20, y: 26, r: 10 }, rollY: 48,
  };
}
