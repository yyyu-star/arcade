/**
 * 数字牌（A、2–10）的中间花色排布：标准扑克的点位，下半部分的花色转 180 度。
 * 返回内联 SVG（viewBox 40×58），放在牌面 left 9 / top 12 / 40×58 的位置；
 * 左上角和右下角留给角标。J/Q/K 不在这里画。
 * 花色路径抄自 art.ts 的 SUIT_SVG（100×100），art.ts 在别处改，这里不引用。
 */

const GOLD = '#c9973a';

// 梅花、方块、红心、黑桃
const SUIT_PATH = [
  '<circle cx="50" cy="27" r="21"/><circle cx="26" cy="58" r="21"/><circle cx="74" cy="58" r="21"/><path d="M46 56 C45 75 40 87 30 96 H70 C60 87 55 75 54 56 Z"/>',
  '<path d="M50 2 Q68 28 92 50 Q68 72 50 98 Q32 72 8 50 Q32 28 50 2 Z"/>',
  '<path d="M50 92 C22 68 4 50 4 30 C4 14 16 4 29 4 C39 4 46 10 50 19 C54 10 61 4 71 4 C84 4 96 14 96 30 C96 50 78 68 50 92 Z"/>',
  '<path d="M50 3 C62 22 96 40 96 63 C96 77 85 85 73 85 C64 85 57 81 53 74 C54 84 59 91 68 97 H32 C41 91 46 84 47 74 C43 81 36 85 27 85 C15 85 4 77 4 63 C4 40 38 22 50 3 Z"/>',
];

const L = 12.5;
const C = 20;
const R = 27.5;
const T = 8;
const M = 29;
const B = 50;

// 点位 [x, y]，y 大于中线的自动倒置；索引 = 点数（A 单画）
const SIDE4 = [T, 22, 36, B];
const LAYOUT: Record<number, [number, number][]> = {
  2: [[C, T], [C, B]],
  3: [[C, T], [C, M], [C, B]],
  4: [[L, T], [R, T], [L, B], [R, B]],
  5: [[L, T], [R, T], [C, M], [L, B], [R, B]],
  6: [[L, T], [R, T], [L, M], [R, M], [L, B], [R, B]],
  7: [[L, T], [R, T], [C, 18.5], [L, M], [R, M], [L, B], [R, B]],
  8: [[L, T], [R, T], [C, 18.5], [L, M], [R, M], [C, 39.5], [L, B], [R, B]],
  9: [...SIDE4.flatMap((y): [number, number][] => [[L, y], [R, y]]), [C, M]],
  10: [...SIDE4.flatMap((y): [number, number][] => [[L, y], [R, y]]), [C, 16], [C, 42]],
};

const f = (n: number): string => String(Math.round(n * 100) / 100);

function pip(suit: number, x: number, y: number, s: number): string {
  const k = s / 100;
  // 下半部分绕自己中心转 180 度：负缩放等价于旋转，一条 transform 搞定
  const t = y > M + 0.5 ? `translate(${f(x + s / 2)} ${f(y + s / 2)}) scale(${f(-k)})` : `translate(${f(x - s / 2)} ${f(y - s / 2)}) scale(${f(k)})`;
  return `<g transform="${t}">${SUIT_PATH[suit]}</g>`;
}

/** rank 0..12 对应 2..A（8 是 10，12 是 A）；suit 0 梅花 1 方块 2 红心 3 黑桃；J/Q/K（9–11）不画，返回空串 */
export function pipFace(rank: number, suit: number): string {
  let body: string;
  if (rank === 12) {
    // A：大花色 + 细金双圈，四个方位点缀小菱形
    const dia = (x: number, y: number): string => `<path d="M${x} ${y - 1.6}L${x + 1.2} ${y}L${x} ${y + 1.6}L${x - 1.2} ${y}Z"/>`;
    body =
      `<g fill="none" stroke="${GOLD}"><circle cx="20" cy="29" r="16" stroke-width=".7" stroke-dasharray="1.4 1.6"/><circle cx="20" cy="29" r="14" stroke-width=".5" stroke-opacity=".7"/></g>` +
      `<g fill="${GOLD}">${dia(20, 13)}${dia(20, 45)}${dia(4, 29)}${dia(36, 29)}</g>` +
      `<g transform="translate(7.5 16.5) scale(.25)">${SUIT_PATH[suit]}</g>`;
  } else if (rank >= 0 && rank <= 8) {
    const n = rank + 2;
    const s = n <= 6 ? 11.5 : n <= 8 ? 10.5 : 9.5;
    body = (LAYOUT[n] ?? []).map(([x, y]) => pip(suit, x, y, s)).join('');
  } else {
    return '';
  }
  return `<svg class="c-pips" viewBox="0 0 40 58" aria-hidden="true"><g fill="currentColor">${body}</g></svg>`;
}
