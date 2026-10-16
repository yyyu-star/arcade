/**
 * 扔道具的手感（0.11.0，docs/table-fun.md 第 2、3 节）：护盾、连击、回敬怎么算。纯函数，时间由调用方给，单测直接测。
 * 座位用画面座位（我 = 0）；好友房、单机、电脑扔的都过这里，所以三种来源算法一样。
 */

/** 同一个人 SHIELD_WINDOW_MS 里最多被扔 SHIELD_MAX 次，多的亮"护盾"不播（防刷屏） */
export const SHIELD_MAX = 6;
export const SHIELD_WINDOW_MS = 10_000;
/** 连击、回敬都按 3 秒算 */
export const COMBO_MS = 3000;

export interface HitResult {
  /** 被扔太多了：这一下不播，头像上亮护盾 */
  shield: boolean;
  /** 同一个人连着扔同一个人的第几下（1 = 不算连击） */
  combo: number;
  /** 被 to 扔过以后 3 秒内扔回去 */
  revenge: boolean;
}

export class FunTally {
  private readonly hits = new Map<number, number[]>();
  private readonly chain = new Map<string, { t: number; n: number }>();
  /** 谁最近扔过这个人 */
  private readonly lastBy = new Map<number, { from: number; t: number }>();

  hit(from: number, to: number, now: number): HitResult {
    const recent = (this.hits.get(to) ?? []).filter((t) => now - t < SHIELD_WINDOW_MS);
    if (recent.length >= SHIELD_MAX) {
      this.hits.set(to, recent);
      return { shield: true, combo: 1, revenge: false };
    }
    recent.push(now);
    this.hits.set(to, recent);
    const key = `${from}>${to}`;
    const prev = this.chain.get(key);
    const combo = prev && now - prev.t <= COMBO_MS ? prev.n + 1 : 1;
    this.chain.set(key, { t: now, n: combo });
    const by = this.lastBy.get(from);
    const revenge = !!by && by.from === to && now - by.t <= COMBO_MS;
    this.lastBy.set(to, { from, t: now });
    return { shield: false, combo, revenge };
  }
}
