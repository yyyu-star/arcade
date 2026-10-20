/**
 * 每副结束的复盘（0.6.1）：结算页上两三行，说这一副是在哪儿赢的、输的——两队各炸了几次、接风几次、最大的一炸是谁的，
 * 没人炸的话说头游几手出完。只用公开信息（出牌记录、名次、画面上播过的接风），不看任何人的手牌。画面座位：我 = 0，我方 = 0、2。
 */
import { beats, isBomb, type DealResult, type Play, type PlayRecord } from '../variants/guandan/core/index.ts';

export interface Recap {
  /** 两队各炸了几次（画面队伍：0 我方、1 对方） */
  bombs: [number, number];
  /** 最大的一炸（没人炸为 null） */
  top: { seat: number; play: Play } | null;
  /** 头游出了几手（不算"不要"） */
  firstPlays: number;
}

export function dealRecap(r: DealResult, history: readonly PlayRecord[]): Recap {
  const bombs: [number, number] = [0, 0];
  let top: Recap['top'] = null;
  for (const h of history) {
    if (!h.play || !isBomb(h.play)) continue;
    bombs[h.seat % 2]!++;
    if (!top || beats(h.play, top.play)) top = { seat: h.seat, play: h.play };
  }
  const head = r.order[0]!;
  const firstPlays = history.filter((h) => h.seat === head && h.play).length;
  return { bombs, top, firstPlays };
}
