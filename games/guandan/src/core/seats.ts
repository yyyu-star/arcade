/**
 * n 人座位环（牌馆通用层，docs/doudizhu.md 第 1 节）：座位 0..n-1 按出牌顺序轮，s 的下家是 (s + 1) % n。
 * 按队的东西（掼蛋的对家、斗地主的地主 / 农民）不在这里，各玩法自己定。
 */
export type Seat = number;

export function nextOf(s: Seat, n: number): Seat {
  return (s + 1) % n;
}

/** 0..n-1 */
export function seatRing(n: number): Seat[] {
  return Array.from({ length: n }, (_, i) => i);
}
