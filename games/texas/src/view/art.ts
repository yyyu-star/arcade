/**
 * 美术全部用代码画（DESIGN.md 8.1）：花色是自己画的路径，牌面、牌背、筹码靠 SVG 和 CSS，头像按性格拼出来。
 * 没有图片文件，任何像素比下都是矢量。来源写在 README 的"素材"一节。
 */
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import { pipFace } from './pips.ts';
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

/**
 * 牌面（0.10.0）：左上角点数和花色；人头牌右下是半身像的画框，数字牌和 A 是中心花色（pips.ts）。
 * 小牌（别人亮的牌、看对手卡）地方小，只看角标和右下一个大花色（.c-big，style.css 按尺寸切换）
 */
export function cardFace(c: Card): string {
  const r = rankOf(c);
  const s = suitOf(c);
  return `<span class="c-corner"><b>${rankText(r)}</b>${suitSvg(s, 'c-pip')}</span>${suitSvg(s, 'c-big')}${r >= 9 && r <= 11 ? courtArt(r, s) : pipFace(r, s)}`;
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
  name: string;
  bg: string;
  shirt: string;
  skin: string;
  hair: string;
  /** 头发（或帽子）的形状 */
  top: string;
  /** 眼睛那一层：眼镜、墨镜 */
  eyes: string;
  mouth: string;
  /** 光头：头顶画一块反光，不给头发描高光 */
  bald?: boolean;
  hat?: boolean;
}

const EYES = '<circle cx="27" cy="31" r="1.7"/><circle cx="37" cy="31" r="1.7"/>';
const SMILE = '<path d="M28 38 Q32 41 36 38" fill="none" stroke-width="1.6" stroke-linecap="round"/>';
/** 10 种性格各一张脸，和 src/ai/personas.ts 的顺序一致；最后一张是"我"。name 只为对照方便 */
const LOOKS: Look[] = [
  { name: '稳哥', bg: '#3f6fb0', shirt: '#22344f', skin: '#f0c9a0', hair: '#2b2118', top: '<path d="M19 29 C17 15 25 10 32 10 C40 10 48 15 45 29 C43 21 38 18 32 18 C26 18 21 21 19 29 Z"/>', eyes: EYES, mouth: '<path d="M28 39 H36" stroke-width="1.6" stroke-linecap="round"/>' },
  { name: '阿飙', bg: '#c0483b', shirt: '#1d1d1d', skin: '#e8b98f', hair: '#1a1a1a', top: '<path d="M18 28 L19 13 L25 19 L27 8 L32 16 L37 7 L39 17 L45 11 L46 28 C42 20 22 20 18 28 Z"/>', eyes: '<path d="M21 28 H43 V31 C43 35 40 36 37 36 C34 36 33 33 32 31 C31 33 30 36 27 36 C24 36 21 35 21 31 Z" fill="#111"/><path d="M23.5 29.5 L27 29.5" stroke="#fff" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"/><path d="M34.5 29.5 L38 29.5" stroke="#fff" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"/>', mouth: '<path d="M28 39 Q33 40 37 37" fill="none" stroke-width="1.6" stroke-linecap="round"/>' },
  { name: '老好', bg: '#d39a35', shirt: '#6b4a1f', skin: '#f3cfa8', hair: '#8a8a8a', top: '<path d="M18 30 C18 24 19 21 21 20 L21 31 Z M46 30 C46 24 45 21 43 20 L43 31 Z"/>', eyes: '<path d="M25 31 Q27 29 29 31 M35 31 Q37 29 39 31" fill="none" stroke-width="1.6" stroke-linecap="round"/>', mouth: '<path d="M27 37 Q32 43 37 37" fill="none" stroke-width="1.8" stroke-linecap="round"/>', bald: true },
  { name: '慢慢', bg: '#7f6bb8', shirt: '#3a3166', skin: '#f6d3b3', hair: '#4a2c1c', top: '<path d="M16 36 C14 16 23 9 32 9 C41 9 50 16 48 36 L44 36 C45 25 41 19 32 19 C25 19 20 23 20 36 Z"/>', eyes: EYES, mouth: '<circle cx="32" cy="39" r="1.8" fill="none" stroke-width="1.4"/>' },
  { name: '算盘', bg: '#3c9a8a', shirt: '#1f4d46', skin: '#efc6a0', hair: '#222', top: '<path d="M19 28 C18 14 26 10 33 10 C41 10 47 15 45 28 C44 22 40 18 35 17 L31 22 L30 18 C24 19 21 23 19 28 Z"/>', eyes: `${EYES}<circle cx="27" cy="31" r="4.4" fill="#fff" fill-opacity=".12" stroke-width="1.3"/><circle cx="37" cy="31" r="4.4" fill="#fff" fill-opacity=".12" stroke-width="1.3"/><path d="M31.4 31 H32.6" stroke-width="1.3"/>`, mouth: '<path d="M29 38.5 Q32 39.5 35 38.5" fill="none" stroke-width="1.5" stroke-linecap="round"/>' },
  { name: '江湖', bg: '#5b5b66', shirt: '#2a2a30', skin: '#e2b088', hair: '#1c1c22', top: '<path d="M12 22 Q32 15 52 22 Q46 24 44 22 L42 9 Q32 5 22 9 L20 22 Q18 24 12 22 Z"/><path d="M21 19 Q32 16 43 19 L43 21 Q32 18 21 21 Z" fill="#8b2d2d"/>', eyes: EYES, mouth: '<path d="M26 37 Q29 35 32 37 Q35 35 38 37 Q35 39 32 38 Q29 39 26 37 Z"/>', hat: true },
  { name: '虎子', bg: '#d4622a', shirt: '#3b2414', skin: '#e6b48a', hair: '#2a1a10', top: '<path d="M19 26 C19 14 25 12 32 12 C39 12 45 14 45 26 C44 20 40 18 32 18 C24 18 20 20 19 26 Z"/><path d="M19 32 C20 43 26 46 32 46 C38 46 44 43 45 32 C43 39 40 41 37 40 C35 38 29 38 27 40 C24 41 21 39 19 32 Z"/>', eyes: `${EYES}<path d="M24 27.5 L30 27 M34 25 L40 27" fill="none" stroke-width="1.6" stroke-linecap="round"/>`, mouth: '<path d="M27 36 Q32 40 37 34.5 Q32 37.5 27 36 Z" stroke-width="1" stroke-linejoin="round"/>' },
  { name: '老鹰', bg: '#2e5a46', shirt: '#14231b', skin: '#e8bf98', hair: '#c4c4c4', top: '<path d="M19 27 C18 15 25 11 32 11 C40 11 46 15 45 27 C44 21 42 18 39 17 C35 16 30 16 26 17 C22 18 20 22 19 27 Z"/>', eyes: '<path d="M25 31 H29.5 M34.5 31 H39" stroke-width="1.8" stroke-linecap="round"/><path d="M23.5 27.5 L30 29 M40.5 27.5 L34 29" stroke-width="1.8" stroke-linecap="round"/>', mouth: '<path d="M28.5 39 Q32 38 35.5 39" fill="none" stroke-width="1.5" stroke-linecap="round"/>' },
  { name: '叨叨', bg: '#d9739a', shirt: '#6e2a48', skin: '#f3cba6', hair: '#6b3a1f', top: '<circle cx="21" cy="21" r="5"/><circle cx="27" cy="16" r="5.5"/><circle cx="34" cy="15" r="5.5"/><circle cx="41" cy="18" r="5"/><circle cx="45" cy="25" r="4"/><circle cx="19" cy="27" r="4"/>', eyes: `${EYES}<path d="M24.5 27 Q27 25 29.5 27 M34.5 27 Q37 25 39.5 27" fill="none" stroke-width="1.4" stroke-linecap="round"/>`, mouth: '<path d="M27.5 37 Q32 36 36.5 37 Q36 42 32 42 Q28 42 27.5 37 Z"/><path d="M29.5 40.3 Q32 39 34.5 40.3" fill="none" stroke="#d9606a" stroke-width="1.4"/>' },
  { name: '小白', bg: '#6fb3d9', shirt: '#2d5d80', skin: '#f6d6b8', hair: '#e9a23b', top: '<path d="M18 25 C18 13 25 9 32 9 C39 9 46 13 46 25 Z"/><path d="M30 24 Q42 21 53 25 Q42 27 30 26 Z"/><circle cx="32" cy="10" r="1.6"/>', eyes: '<circle cx="27" cy="31" r="2.6"/><circle cx="37" cy="31" r="2.6"/><circle cx="27.9" cy="30.1" r="0.9" fill="#fff" stroke="none"/><circle cx="37.9" cy="30.1" r="0.9" fill="#fff" stroke="none"/>', mouth: '<path d="M29 38 Q32 40.5 35 38" fill="none" stroke-width="1.5" stroke-linecap="round"/><g fill="#c98a5e" stroke="none"><circle cx="23" cy="35" r=".7"/><circle cx="25" cy="36" r=".7"/><circle cx="39" cy="36" r=".7"/><circle cx="41" cy="35" r=".7"/></g>', hat: true },
  { name: '我', bg: '#d8a93f', shirt: '#7a1f2b', skin: '#f2cba5', hair: '#2a1b12', top: '<path d="M18 30 C16 14 25 9 33 9 C42 9 49 16 46 30 C44 21 41 19 38 19 C33 21 27 21 22 19 C20 22 19 25 18 30 Z"/>', eyes: EYES, mouth: SMILE },
];

export const ME_LOOK = LOOKS.length - 1;

/** 好友房里别的真人：和我一样的脸，按座位换底色，一眼分得开（9 个座位 9 种） */
export const HUMAN_BG = ['#c0603a', '#3a7fc0', '#7a4fb0', '#2f9a7a', '#b0457a', '#8a8f2f', '#4f62c8', '#b8862c', '#2f8c9c'];

/** 颜色提亮 / 压暗（k > 0 提亮，< 0 压暗） */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** 渐变 id 每张唯一：同一页面上同一张脸会出现好几次 */
let uid = 0;
/** 头像 v2：渐变 id 每次唯一（同一页面上同一张脸会出现好几次） */
export function avatarSvg(look: number, bg?: string): string {
  const l = LOOKS[look] ?? LOOKS[0]!;
  const b = bg ?? l.bg;
  const u = `a${(uid++).toString(36)}`;
  return (
    `<svg class="face" viewBox="0 0 64 64" aria-hidden="true"><defs>` +
    `<radialGradient id="${u}b" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="${shade(b, 0.28)}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${shade(b, -0.45)}"/></radialGradient>` +
    `<radialGradient id="${u}f" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${shade(l.skin, 0.25)}"/><stop offset=".7" stop-color="${l.skin}"/><stop offset="1" stop-color="${shade(l.skin, -0.22)}"/></radialGradient>` +
    `<linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(l.shirt, 0.18)}"/><stop offset="1" stop-color="${shade(l.shirt, -0.35)}"/></linearGradient>` +
    `<clipPath id="${u}c"><circle cx="32" cy="32" r="32"/></clipPath></defs>` +
    `<g clip-path="url(#${u}c)">` +
    `<circle cx="32" cy="32" r="32" fill="url(#${u}b)"/>` +
    // 背后一圈淡淡的光，把人和底色分开
    `<circle cx="32" cy="34" r="22" fill="#fff" opacity=".1"/>` +
    // 衣服、领口
    `<path d="M7 64 C9 50 20 45 32 45 C44 45 55 50 57 64 Z" fill="url(#${u}s)"/>` +
    `<path d="M25 46 L32 54 L39 46" fill="none" stroke="${shade(l.shirt, 0.35)}" stroke-width="1.6" stroke-linejoin="round"/>` +
    // 脖子和下巴的影子
    `<rect x="27.5" y="39" width="9" height="9" rx="3" fill="${shade(l.skin, -0.12)}"/>` +
    `<path d="M27.5 43 Q32 46 36.5 43 V45 Q32 48 27.5 45 Z" fill="#000" opacity=".12"/>` +
    // 耳朵
    `<ellipse cx="19.2" cy="32" rx="2.6" ry="3.6" fill="${shade(l.skin, -0.08)}"/><ellipse cx="44.8" cy="32" rx="2.6" ry="3.6" fill="${shade(l.skin, -0.08)}"/>` +
    // 脸：明暗渐变 + 腮红
    `<ellipse cx="32" cy="30" rx="13" ry="15" fill="url(#${u}f)"/>` +
    `<ellipse cx="24.5" cy="36" rx="2.8" ry="1.7" fill="#e5735f" opacity=".22"/><ellipse cx="39.5" cy="36" rx="2.8" ry="1.7" fill="#e5735f" opacity=".22"/>` +
    // 鼻子：一笔阴影
    `<path d="M32.6 32.5 Q34 35 32 35.6" fill="none" stroke="${shade(l.skin, -0.3)}" stroke-width="1.1" stroke-linecap="round"/>` +
    `<g fill="${l.hair}">${l.top}</g>` +
    // 头发 / 帽子的高光：同一个形状往右下错一点，只留左上一条亮边
    (l.bald ? `<ellipse cx="27" cy="20" rx="5" ry="2.4" fill="#fff" opacity=".35"/>` : `<g fill="#fff" opacity=".16" transform="translate(-0.8 -0.8)" clip-path="url(#${u}c)">${l.top}</g><g fill="${l.hair}" transform="translate(0.6 0.9)">${l.top}</g>`) +
    `<g fill="#2a1f1a" stroke="#2a1f1a">${l.eyes}${l.mouth}</g>` +
    // 眼睛里的高光
    `<circle cx="27.6" cy="30.4" r=".55" fill="#fff" opacity=".9"/><circle cx="37.6" cy="30.4" r=".55" fill="#fff" opacity=".9"/>` +
    `</g>` +
    // 外圈：上亮下暗的轮廓光
    `<circle cx="32" cy="32" r="31" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.4" stroke-dasharray="60 200" transform="rotate(200 32 32)"/>` +
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

// ---------- 人头牌 ----------
// 牌面 58 × 82：左上角照旧是点数和花色；右下 36 × 50 的框里画一个半身像（K 戴王冠、Q 戴花冠、J 戴羽毛帽），
// 上下镜像（真扑克的双头），衣服上是这张牌的花色纹样，红牌红金、黑牌蓝金。

const pip = (suit: number, x: number, y: number, s: number, fill: string): string => `<g transform="translate(${x - s / 2} ${y - s / 2}) scale(${s / 100})" fill="${fill}">${SUIT_SVG[suit]}</g>`;

/** 半身像（上半张，36 × 25 的坐标）：rank 9 J、10 Q、11 K */
function bust(rank: number, suit: number, red: boolean): string {
  const robe = red ? '#c8372d' : '#2f4f9e';
  const robe2 = red ? '#8e1f1a' : '#1d3270';
  const gold = '#e2b04a';
  const skin = '#f3d2ae';
  const hair = rank === 10 ? '#d9a441' : rank === 11 ? '#7a4a20' : '#3a2516';
  // 头饰
  const crown =
    rank === 11
      ? `<path d="M11.5 7.5 L12.5 2 L15 5 L18 1 L21 5 L23.5 2 L24.5 7.5 Z" fill="${gold}" stroke="#8a5a12" stroke-width=".5"/><circle cx="18" cy="4.2" r=".9" fill="${robe}"/>`
      : rank === 10
        ? `<path d="M12 7.5 Q18 3 24 7.5" fill="none" stroke="${gold}" stroke-width="1.4"/><circle cx="14" cy="6" r="1.1" fill="${robe}"/><circle cx="18" cy="4.6" r="1.3" fill="${gold}"/><circle cx="22" cy="6" r="1.1" fill="${robe}"/>`
        : `<path d="M11 8 Q18 2.5 25 8 Z" fill="${robe2}"/><path d="M23 6 Q28 1 31 2.5 Q27 4 24.5 7.5" fill="${gold}"/>`;
  // 胡子 / 头发
  const face =
    rank === 11
      ? `<path d="M14.5 13.5 Q18 19 21.5 13.5 Q21 17.5 18 18.5 Q15 17.5 14.5 13.5 Z" fill="${hair}"/>`
      : rank === 10
        ? `<path d="M12.6 9 Q11.5 15 13 19 L14 12 Z M23.4 9 Q24.5 15 23 19 L22 12 Z" fill="${hair}"/>`
        : `<path d="M13 9.5 Q12.6 13 13.6 15 L14.2 10.5 Z M23 9.5 Q23.4 13 22.4 15 L21.8 10.5 Z" fill="${hair}"/>`;
  return (
    // 肩和袍子
    `<path d="M3 25 C4 19 10 17 18 17 C26 17 32 19 33 25 Z" fill="${robe}"/>` +
    `<path d="M18 17 L14 25 M18 17 L22 25" stroke="${gold}" stroke-width="1.2"/>` +
    `<path d="M3 25 C4 21 7 19.5 10 19 L11 25 Z M33 25 C32 21 29 19.5 26 19 L25 25 Z" fill="${robe2}"/>` +
    pip(suit, 18, 22, 4.5, gold) +
    // 头
    `<ellipse cx="18" cy="11.5" rx="5.2" ry="6" fill="${skin}"/>` +
    `<circle cx="16.2" cy="11" r=".6" fill="#2a1f1a"/><circle cx="19.8" cy="11" r=".6" fill="#2a1f1a"/>` +
    `<path d="M16.8 14.2 Q18 15 19.2 14.2" fill="none" stroke="#a5523e" stroke-width=".6" stroke-linecap="round"/>` +
    face +
    crown +
    // 权杖 / 花 / 剑：区分 K Q J 的小物件
    (rank === 11
      ? `<path d="M30 7 V24" stroke="${gold}" stroke-width="1.2"/><circle cx="30" cy="6.5" r="1.6" fill="${gold}"/>`
      : rank === 10
        ? `<path d="M6 12 V24" stroke="#3f7d3a" stroke-width=".9"/><circle cx="6" cy="11" r="2.2" fill="${robe}"/><circle cx="6" cy="11" r=".9" fill="${gold}"/>`
        : `<path d="M30.5 5 V23" stroke="#c9ced6" stroke-width="1.2"/><path d="M28.5 18 H32.5" stroke="${gold}" stroke-width="1.2"/>`)
  );
}

/** 人头牌右下角的画框（36 × 50，上下镜像） */
export function courtArt(rank: number, suit: number): string {
  const red = suit === 1 || suit === 2;
  const frame = '#b8892e';
  const half = bust(rank, suit, red);
  return (
    `<svg class="c-court" viewBox="0 0 36 50" aria-hidden="true">` +
    `<rect x=".6" y=".6" width="34.8" height="48.8" rx="2.5" fill="#fbf4e3" stroke="${frame}" stroke-width="1.2"/>` +
    `<clipPath id="cc${rank}${suit}"><rect x="1.5" y="1.5" width="33" height="47" rx="2"/></clipPath>` +
    `<g clip-path="url(#cc${rank}${suit})"><g>${half}</g><g transform="rotate(180 18 25)">${half}</g>` +
    `<path d="M2 25 H34" stroke="${frame}" stroke-width=".7" opacity=".8"/></g>` +
    `</svg>`
  );
}
