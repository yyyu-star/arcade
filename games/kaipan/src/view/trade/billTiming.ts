/**
 * 0.17.0 月底账单舞台的节拍（毫秒，1 倍速；单独一个文件，测试不用加载 Phaser）：
 * 纸从桌面滑上来 → 各行依次出现（一共不超过 rows，每行不超过 rowMax）→ 总数滚动砸下 → 盖章 → 停 hold。
 * 每个月自动停一共 ≤ 2 秒（art-v3 第 8 节；tests/bill-timing.test.ts 锁住），点一下全部跳过。
 * quick：设置里「月底账单：简短」，账单和章直接出来，停这么久。
 */
export const BILL_MS = { slide: 320, rows: 350, rowMax: 70, count: 300, stamp: 240, hold: 700, quick: 900 } as const;

/** 舞台最长自动停多久（各段加起来） */
export function billStageMs(): number {
  return BILL_MS.slide + BILL_MS.rows + BILL_MS.count + BILL_MS.stamp + BILL_MS.hold;
}

/** 0.16.0 以前的账单：从右边滑入 420 + 停 250 + 盖章 240 + 停 1300 */
export const OLD_BILL_MS = 420 + 250 + 240 + 1300;
/** 0.17.0 结束页出场前的过场（通关烟花、出局下雨），一局一次 */
export const END_CUTSCENE_MS = 1200;
