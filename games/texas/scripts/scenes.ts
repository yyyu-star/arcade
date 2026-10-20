/**
 * 冒烟 `--only scenes` 用的牌局：用规则核心直接摆出要看的局面（有人全下、一个或两个边池、摊牌），写成单机的本机存档，
 * 页面"继续上局"就停在这里，查牌桌上的元素互相压没压（DESIGN.md 8.2）。只在冒烟里用，不进页面。
 */
import { apply, deal, isFail, legal, newTable, seatHouse, seatPlayer, type Action, type Table } from '../src/core/table.ts';

export type SceneKind = 'side' | 'showdown';

const ok = (x: Table | { error: string }): Table => {
  if (isFail(x)) throw new Error(x.error);
  return x;
};

/**
 * size 人桌，sides 个短码电脑全下（筹码 60、180……各不相同）、一个电脑加到 300，其余跟注、我（0 号）跟注：收池后一个主池加 sides 个边池；
 * side：翻牌后轮到我时停下（操作区、赔率、牌型提示都在）；showdown：我一路过牌、跟到摊牌，一手打完停着
 */
export function scene(size: number, sides: number, kind: SceneKind, seed: number): Table {
  let t = newTable('small', size, [seed, 7, 3, 5, 11, 13, 17, 19], { holdHands: true, level: 2 });
  for (let i = 1; i < size; i++) t = ok(seatHouse(t, i, false));
  t = ok(seatPlayer(t, 0, 2_000, false));
  // 短码：直接改筹码，bank 跟着改（Σ筹码 + Σ投入 = bank）
  const short = Array.from({ length: Math.min(sides, size - 1) }, (_, k) => size - 1 - k);
  short.forEach((s, k) => {
    const seat = t.seats[s]!;
    t.bank += 60 + 120 * k - seat.stack;
    seat.stack = 60 + 120 * k;
  });
  t = deal(t);
  // 翻牌前第一个不是短码、不是我的电脑加到 300（比短码都多），收池时才分得出边池
  let raised = false;
  for (let guard = 0; guard < 400; guard++) {
    if (t.phase === 'idle' || t.toAct === null) break;
    const s = t.toAct;
    if (s === 0 && kind === 'side' && t.phase !== 'preflop') break;
    const l = legal(t, s)!;
    const raise = !raised && s !== 0 && !short.includes(s) && t.phase === 'preflop' && l.raise && l.minTo <= 300;
    if (raise) raised = true;
    const a: Action = short.includes(s) ? { t: 'allin' } : raise ? { t: 'raise', to: 300 } : l.check ? { t: 'check' } : { t: 'call' };
    t = ok(apply(t, s, a));
  }
  return t;
}

/** 单机存档（src/solo.ts 的 Session），练习桌、不碰钱包 */
export function sceneSave(t: Table, userId: string): string {
  return JSON.stringify({ v: 1, id: `scene-${t.seed[0]}`, userId, practice: true, table: t, pending: null, stats: { buyin: 2_000, hands: 0, won: 0, best: null } });
}
