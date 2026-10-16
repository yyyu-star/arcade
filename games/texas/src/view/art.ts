/**
 * 美术全部用代码画（DESIGN.md 8.1）：花色是自己画的路径，牌面、牌背、筹码靠 SVG 和 CSS，头像按性格拼出来。
 * 没有图片文件，任何像素比下都是矢量。来源写在 README 的"素材"一节。
 */
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import { rankText } from './text.ts';

/** 花色（100 × 100）：c 梅花 d 方块 h 红心 s 黑桃，和 cards.ts 的 0–3 对应 */
const SUIT_SVG = [
  // 梅花：三个圆加一根梗
  '<circle cx="50" cy="27" r="21"/><circle cx="26" cy="58" r="21"/><circle cx="74" cy="58" r="21"/><path d="M46 56 C45 75 40 87 30 96 H70 C60 87 55 75 54 56 Z"/>',
  '<path d="M50 2 Q68 28 92 50 Q68 72 50 98 Q32 72 8 50 Q32 28 50 2 Z"/>',
  '<path d="M50 92 C22 68 4 50 4 30 C4 14 16 4 29 4 C39 4 46 10 50 19 C54 10 61 4 71 4 C84 4 96 14 96 30 C96 50 78 68 50 92 Z"/>',
  '<path d="M50 3 C62 22 96 40 96 63 C96 77 85 85 73 85 C64 85 57 81 53 74 C54 84 59 91 68 97 H32 C41 91 46 84 47 74 C43 81 36 85 27 85 C15 85 4 77 4 63 C4 40 38 22 50 3 Z"/>',
];

export const isRed = (c: Card): boolean => suitOf(c) === 1 || suitOf(c) === 2;

export function suitSvg(suit: number, cls = 'suit'): string {
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${SUIT_SVG[suit]}</svg>`;
}

const SUIT_NAMES = ['梅花', '方块', '红心', '黑桃'];

/** 牌面：左上角点数和花色，中间一个大花色（小屏上看得清比好看的满版花色要紧） */
export function cardFace(c: Card): string {
  return `<span class="c-corner"><b>${rankText(rankOf(c))}</b>${suitSvg(suitOf(c), 'c-pip')}</span>${suitSvg(suitOf(c), 'c-big')}`;
}

export const cardLabel = (c: Card): string => `${SUIT_NAMES[suitOf(c)]}${rankText(rankOf(c))}`;

/** 一张牌的节点：正反两面，翻牌用 rotateY。face 为 null 是只有牌背（别人的牌） */
export function makeCard(cls = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = `card ${cls}`;
  d.innerHTML = '<div class="c-face"></div><div class="c-back"></div>';
  return d;
}

/** 把牌设成某一张（null 是背面朝上） */
export function setCard(d: HTMLElement, c: Card | null): void {
  const key = c === null ? '' : String(c);
  if (d.dataset.card === key) return;
  d.dataset.card = key;
  d.classList.toggle('up', c !== null);
  d.classList.toggle('red', c !== null && isRed(c));
  const face = d.firstElementChild as HTMLElement;
  face.innerHTML = c === null ? '' : cardFace(c);
  d.setAttribute('aria-label', c === null ? '一张牌' : cardLabel(c));
}

// ---------- 头像 ----------

interface Look {
  bg: string;
  shirt: string;
  skin: string;
  hair: string;
  /** 头发（或帽子）的形状 */
  top: string;
  /** 眼睛那一层：眼镜、墨镜 */
  eyes: string;
  mouth: string;
}

const EYES = '<circle cx="27" cy="31" r="1.7"/><circle cx="37" cy="31" r="1.7"/>';
const SMILE = '<path d="M28 38 Q32 41 36 38" fill="none" stroke-width="1.6" stroke-linecap="round"/>';

/** 10 种性格各一张脸，和 src/ai/personas.ts 的顺序一致；最后一张是"我" */
const LOOKS: Look[] = [
  // 稳哥：短发、正经
  { bg: '#3f6fb0', shirt: '#22344f', skin: '#f0c9a0', hair: '#2b2118', top: '<path d="M19 29 C17 15 25 10 32 10 C40 10 48 15 45 29 C43 21 38 18 32 18 C26 18 21 21 19 29 Z"/>', eyes: EYES, mouth: '<path d="M28 39 H36" stroke-width="1.6" stroke-linecap="round"/>' },
  // 阿飙：刺头、墨镜
  { bg: '#c0483b', shirt: '#1d1d1d', skin: '#e8b98f', hair: '#1a1a1a', top: '<path d="M18 28 L19 13 L25 19 L27 8 L32 16 L37 7 L39 17 L45 11 L46 28 C42 20 22 20 18 28 Z"/>', eyes: '<path d="M21 28 H43 V31 C43 35 40 36 37 36 C34 36 33 33 32 31 C31 33 30 36 27 36 C24 36 21 35 21 31 Z" fill="#111"/>', mouth: '<path d="M28 39 Q33 40 37 37" fill="none" stroke-width="1.6" stroke-linecap="round"/>' },
  // 老好：光头两鬓、笑眯眯
  { bg: '#d39a35', shirt: '#6b4a1f', skin: '#f3cfa8', hair: '#8a8a8a', top: '<path d="M18 30 C18 24 19 21 21 20 L21 31 Z M46 30 C46 24 45 21 43 20 L43 31 Z"/>', eyes: '<path d="M25 31 Q27 29 29 31 M35 31 Q37 29 39 31" fill="none" stroke-width="1.6" stroke-linecap="round"/>', mouth: '<path d="M27 37 Q32 43 37 37" fill="none" stroke-width="1.8" stroke-linecap="round"/>' },
  // 慢慢：齐耳短发、有点紧张
  { bg: '#7f6bb8', shirt: '#3a3166', skin: '#f6d3b3', hair: '#4a2c1c', top: '<path d="M16 36 C14 16 23 9 32 9 C41 9 50 16 48 36 L44 36 C45 25 41 19 32 19 C25 19 20 23 20 36 Z"/>', eyes: EYES, mouth: '<circle cx="32" cy="39" r="1.8" fill="none" stroke-width="1.4"/>' },
  // 算盘：分头、眼镜
  { bg: '#3c9a8a', shirt: '#1f4d46', skin: '#efc6a0', hair: '#222', top: '<path d="M19 28 C18 14 26 10 33 10 C41 10 47 15 45 28 C44 22 40 18 35 17 L31 22 L30 18 C24 19 21 23 19 28 Z"/>', eyes: `${EYES}<circle cx="27" cy="31" r="4.4" fill="none" stroke-width="1.3"/><circle cx="37" cy="31" r="4.4" fill="none" stroke-width="1.3"/><path d="M31.4 31 H32.6" stroke-width="1.3"/>`, mouth: '<path d="M29 38.5 Q32 39.5 35 38.5" fill="none" stroke-width="1.5" stroke-linecap="round"/>' },
  // 江湖：礼帽、八字胡
  { bg: '#5b5b66', shirt: '#2a2a30', skin: '#e2b088', hair: '#1c1c22', top: '<path d="M12 22 Q32 15 52 22 Q46 24 44 22 L42 9 Q32 5 22 9 L20 22 Q18 24 12 22 Z"/><path d="M21 19 Q32 16 43 19 L43 21 Q32 18 21 21 Z" fill="#8b2d2d"/>', eyes: EYES, mouth: '<path d="M26 37 Q29 35 32 37 Q35 35 38 37 Q35 39 32 38 Q29 39 26 37 Z"/>' },
  // 虎子：寸头、络腮胡、挑一边眉、坏笑
  { bg: '#d4622a', shirt: '#3b2414', skin: '#e6b48a', hair: '#2a1a10', top: '<path d="M19 26 C19 14 25 12 32 12 C39 12 45 14 45 26 C44 20 40 18 32 18 C24 18 20 20 19 26 Z"/><path d="M19 32 C20 43 26 46 32 46 C38 46 44 43 45 32 C43 39 40 41 37 40 C35 38 29 38 27 40 C24 41 21 39 19 32 Z"/>', eyes: `${EYES}<path d="M24 27.5 L30 27 M34 25 L40 27" fill="none" stroke-width="1.6" stroke-linecap="round"/>`, mouth: '<path d="M27 36 Q32 40 37 34.5 Q32 37.5 27 36 Z" stroke-width="1" stroke-linejoin="round"/>' },
  // 老鹰：银白背头、眯眼、眉头往下压
  { bg: '#2e5a46', shirt: '#14231b', skin: '#e8bf98', hair: '#c4c4c4', top: '<path d="M19 27 C18 15 25 11 32 11 C40 11 46 15 45 27 C44 21 42 18 39 17 C35 16 30 16 26 17 C22 18 20 22 19 27 Z"/>', eyes: '<path d="M25 31 H29.5 M34.5 31 H39" stroke-width="1.8" stroke-linecap="round"/><path d="M23.5 27.5 L30 29 M40.5 27.5 L34 29" stroke-width="1.8" stroke-linecap="round"/>', mouth: '<path d="M28.5 39 Q32 38 35.5 39" fill="none" stroke-width="1.5" stroke-linecap="round"/>' },
  // 叨叨：一头卷发、眉毛扬着、嘴没停过
  { bg: '#d9739a', shirt: '#6e2a48', skin: '#f3cba6', hair: '#6b3a1f', top: '<circle cx="21" cy="21" r="5"/><circle cx="27" cy="16" r="5.5"/><circle cx="34" cy="15" r="5.5"/><circle cx="41" cy="18" r="5"/><circle cx="45" cy="25" r="4"/><circle cx="19" cy="27" r="4"/>', eyes: `${EYES}<path d="M24.5 27 Q27 25 29.5 27 M34.5 27 Q37 25 39.5 27" fill="none" stroke-width="1.4" stroke-linecap="round"/>`, mouth: '<path d="M27.5 37 Q32 36 36.5 37 Q36 42 32 42 Q28 42 27.5 37 Z"/><path d="M29.5 40.3 Q32 39 34.5 40.3" fill="none" stroke="#d9606a" stroke-width="1.4"/>' },
  // 小白：鸭舌帽、圆眼睛、雀斑
  { bg: '#6fb3d9', shirt: '#2d5d80', skin: '#f6d6b8', hair: '#e9a23b', top: '<path d="M18 25 C18 13 25 9 32 9 C39 9 46 13 46 25 Z"/><path d="M30 24 Q42 21 53 25 Q42 27 30 26 Z"/><circle cx="32" cy="10" r="1.6"/>', eyes: '<circle cx="27" cy="31" r="2.6"/><circle cx="37" cy="31" r="2.6"/><circle cx="27.9" cy="30.1" r="0.9" fill="#fff" stroke="none"/><circle cx="37.9" cy="30.1" r="0.9" fill="#fff" stroke="none"/>', mouth: '<path d="M29 38 Q32 40.5 35 38" fill="none" stroke-width="1.5" stroke-linecap="round"/><g fill="#c98a5e" stroke="none"><circle cx="23" cy="35" r=".7"/><circle cx="25" cy="36" r=".7"/><circle cx="39" cy="36" r=".7"/><circle cx="41" cy="35" r=".7"/></g>' },
  // 我
  { bg: '#d8a93f', shirt: '#7a1f2b', skin: '#f2cba5', hair: '#2a1b12', top: '<path d="M18 30 C16 14 25 9 33 9 C42 9 49 16 46 30 C44 21 41 19 38 19 C33 21 27 21 22 19 C20 22 19 25 18 30 Z"/>', eyes: EYES, mouth: SMILE },
];

export const ME_LOOK = LOOKS.length - 1;

/** 好友房里别的真人：和我一样的脸，按座位换底色，一眼分得开（9 个座位 9 种） */
export const HUMAN_BG = ['#c0603a', '#3a7fc0', '#7a4fb0', '#2f9a7a', '#b0457a', '#8a8f2f', '#4f62c8', '#b8862c', '#2f8c9c'];

export function avatarSvg(look: number, bg?: string): string {
  const l = LOOKS[look] ?? LOOKS[0]!;
  return (
    `<svg class="face" viewBox="0 0 64 64" aria-hidden="true">` +
    `<circle cx="32" cy="32" r="32" fill="${bg ?? l.bg}"/>` +
    `<path d="M9 64 C11 51 21 46 32 46 C43 46 53 51 55 64 Z" fill="${l.shirt}"/>` +
    `<rect x="28" y="40" width="8" height="8" rx="3" fill="${l.skin}"/>` +
    `<ellipse cx="32" cy="30" rx="13" ry="15" fill="${l.skin}"/>` +
    `<g fill="${l.hair}">${l.top}</g>` +
    `<g fill="#2a1f1a" stroke="#2a1f1a">${l.eyes}${l.mouth}</g>` +
    `</svg>`
  );
}

// ---------- 筹码 ----------

/**
 * 筹码的面额和颜色（0.1.1）：一种面额一种颜色，按真牌桌的习惯（白 1、红 5、绿 25、黑 100、紫 500、黄 1千、橙 5千、蓝 2.5万、粉 10万）。
 * 下注、池子都拆成这些面额一摞摞摆（从大到小，最多 4 摞、每摞最多 8 枚），颜色和高度一眼能看出大概多少，旁边再写准数
 */
const DENOMS: readonly [number, string][] = [
  [100_000, 'pk'],
  [25_000, 'bl'],
  [5_000, 'or'],
  [1_000, 'yl'],
  [500, 'pu'],
  [100, 'k'],
  [25, 'g'],
  [5, 'r'],
  [1, 'w'],
];
const MAX_COLS = 4;
const MAX_PER_COL = 8;

/** 拆成几摞：[颜色, 枚数]，大面额在前 */
export function chipCols(amount: number): [string, number][] {
  const cols: [string, number][] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const [v, c] of DENOMS) {
    if (cols.length >= MAX_COLS) break;
    const n = Math.floor(left / v);
    if (!n) continue;
    cols.push([c, Math.min(MAX_PER_COL, n)]);
    left -= n * v;
  }
  return cols;
}

/** 一堆筹码的 HTML：几摞并排，每摞从下往上叠 */
export function chipPile(amount: number): string {
  return chipCols(amount)
    .map(([c, n]) => `<span class="col" style="--n:${n}">${Array.from({ length: n }, (_, i) => `<i class="chip c-${c}" style="--i:${i}"></i>`).join('')}</span>`)
    .join('');
}
