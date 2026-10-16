/**
 * 牌面、牌背、级牌 / 逢人配覆盖层。viewBox 统一 0 0 200 280。
 *
 * 可读性约束：牌被压住时只露出左上 x∈[0,110]、y∈[0,84]，所以左上索引（点数 + 花色）全部画在 x<108、y<80 以内，
 * 点数字高约 44（字号 60）、花色约 34，粗体高对比。右下不画索引：手牌被屏幕底边裁掉，半截的小索引只会显得脏。
 */
import { C, CARD_H, CARD_R, CARD_W, SANS, SERIF, cloudPath, f, huiwenRow, svg, suitColor, suitShape } from './common.ts';
import { SUIT_PALETTES, jackFigure, kingFigure, lionHead, queenFigure } from './figures.ts';

const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function label(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

/** 金色渐变描边的定义：牌面人物框、王牌框共用，id 带牌面前缀避免内联后撞名 */
function goldDefs(id: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e4a2"/><stop offset=".45" stop-color="${C.gold}"/><stop offset=".7" stop-color="${C.goldDeep}"/><stop offset="1" stop-color="#e9c874"/></linearGradient>`;
}

/** 插画区的金框：渐变粗线 + 外侧细线 + 四角菱形小饰，不碰框内插画 */
function goldFrame(g: string, x: number, y: number, w: number, h: number, r: number): string {
  const d = (cx: number, cy: number) => `M${cx} ${cy - 4.5}L${cx + 4.5} ${cy}L${cx} ${cy + 4.5}L${cx - 4.5} ${cy}Z`;
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const;
  return `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="${r + 3}" fill="none" stroke="url(#${g})" stroke-width="1" opacity=".85"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="url(#${g})" stroke-width="3"/>` +
    `<path d="${pts.map(([cx, cy]) => d(cx, cy)).join('')}" fill="url(#${g})" stroke="${C.goldDeep}" stroke-width=".8"/>`;
}

/** 象牙底牌身：纸张渐变 + 高光 + 极淡的纸纹噪点（feTurbulence，低透明度，不影响索引可读）+ 暖色内细框 */
function cardBase(id: string, top: string = C.ivory, bottom: string = C.ivoryDeep): string {
  const body = `x="1" y="1" width="${CARD_W - 2}" height="${CARD_H - 2}" rx="${CARD_R}"`;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>` +
    `<radialGradient id="${id}s" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .45 0 0 0 0 .33 0 0 0 0 .15 0 0 0 .5 -.16"/></filter></defs>` +
    `<rect ${body} fill="url(#${id})" stroke="#b9a77c" stroke-width="2"/>` +
    `<rect ${body} fill="url(#${id}s)"/>` +
    `<rect ${body} filter="url(#${id}n)" opacity=".55"/>` +
    `<rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="${CARD_R - 5}" fill="none" stroke="#cdb27a" stroke-width="1" opacity=".75"/>`;
}

/** 左上索引（点数 + 花色），坐标落在 x<108、y<80 */
function cornerIndex(rank: number, suit: number): string {
  const col = suitColor(suit);
  const ten = rank === 10;
  const txt = label(rank);
  const tl = ten ? 66 : 46;
  const cx = ten ? 42 : 33;
  const rankSvg = `<text x="${cx}" y="66" font-family='${SANS}' font-weight="900" font-size="${ten ? 58 : 62}" fill="${col}" text-anchor="middle" textLength="${tl}" lengthAdjust="spacingAndGlyphs">${txt}</text>`;
  const sx = ten ? 92 : 78;
  const ss = ten ? 28 : 34;
  return rankSvg + suitShape(suit, sx, 44, ss, col);
}

/** 点阵（2–10）的花色坐标：[x, y, 是否倒置] */
function pipLayout(rank: number): Array<[number, number, boolean]> {
  const L = 62, M = 100, R = 138;
  const T = rank >= 9 ? 96 : 100, B = rank >= 9 ? 196 : 192, Y = 146;
  const out: Array<[number, number, boolean]> = [];
  const add = (x: number, y: number) => out.push([x, y, y > Y + 1]);
  if (rank === 2) { add(M, T); add(M, B); }
  if (rank === 3) { add(M, T); add(M, Y); add(M, B); }
  if (rank >= 4 && rank <= 8) { add(L, T); add(R, T); add(L, B); add(R, B); }
  if (rank === 5) add(M, Y);
  if (rank >= 6 && rank <= 8) { add(L, Y); add(R, Y); }
  if (rank >= 7 && rank <= 8) add(M, (T + Y) / 2);
  if (rank === 8) add(M, (B + Y) / 2);
  if (rank >= 9) {
    const step = (B - T) / 3;
    for (let i = 0; i < 4; i++) { add(L, T + step * i); add(R, T + step * i); }
    if (rank === 9) add(M, Y);
    else { add(M, T + step / 2); add(M, B - step / 2); }
  }
  return out;
}

/** 王牌 */
function jokerFace(big: boolean): string {
  const main = big ? C.red : '#2a2a33';
  const ray = big ? '#f0c86a' : '#c5c8cf';
  let rays = '';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const a2 = a + Math.PI / 48;
    rays += `M100 150L${f(100 + Math.cos(a) * 120)} ${f(150 + Math.sin(a) * 120)}L${f(100 + Math.cos(a2) * 120)} ${f(150 + Math.sin(a2) * 120)}Z`;
  }
  const word = big ? '大王' : '小王';
  const idx = `<text x="12" y="58" font-family='${SERIF}' font-weight="900" font-size="46" fill="${main}" textLength="90" lengthAdjust="spacingAndGlyphs" stroke="${big ? C.goldDeep : '#000'}" stroke-width="${big ? 1.2 : 0.6}" paint-order="stroke">${word}</text>` +
    `<text x="57" y="79" font-family='${SANS}' font-weight="900" font-size="15" fill="${big ? C.goldDeep : '#5b5d66'}" text-anchor="middle" letter-spacing="3">JOKER</text>`;
  return svg(CARD_W, CARD_H,
    cardBase('jb', big ? '#fff8e8' : '#f7f6f2', big ? '#f5e3bc' : '#e3e2dd') +
    `<defs>${goldDefs('jf')}<clipPath id="jc"><rect x="20" y="88" width="160" height="150" rx="10"/></clipPath>` +
    `<radialGradient id="jg" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="${big ? '#fff3cf' : '#ffffff'}"/><stop offset="1" stop-color="${big ? '#f6d892' : '#d9dadf'}"/></radialGradient></defs>` +
    `<rect x="20" y="88" width="160" height="150" rx="10" fill="url(#jg)"/>` +
    `<g clip-path="url(#jc)"><path d="${rays}" fill="${ray}" opacity=".45"/>` +
    `<path d="${cloudPath(48, 222, 70)}" fill="${big ? '#fff3d6' : '#fff'}" stroke="${big ? C.gold : '#9a9ea8'}" stroke-width="2"/>` +
    `<path d="${cloudPath(150, 226, 64)}" fill="${big ? '#fff3d6' : '#fff'}" stroke="${big ? C.gold : '#9a9ea8'}" stroke-width="2"/></g>` +
    `<g transform="translate(36 90) scale(1.0)">${lionHead(big)}</g>` +
    goldFrame('jf', 20, 88, 160, 150, 10) + idx);
}

/** 牌面：rank 2..14（11 J、12 Q、13 K、14 A），16 小王、17 大王；suit 0♠ 1♥ 2♣ 3♦ */
export function cardFaceSvg(rank: number, suit: number): string {
  if (rank === 16 || rank === 17) return jokerFace(rank === 17);
  const s = ((suit % 4) + 4) % 4;
  const col = suitColor(s);
  const idx = cornerIndex(rank, s);
  let center = '';
  if (rank >= 2 && rank <= 10) {
    const size = rank >= 9 ? 27 : 31;
    center = pipLayout(rank).map(([x, y, flip]) => suitShape(s, x, y, size, col, flip)).join('');
  } else if (rank === 14) {
    // A：大花色 + 金色细环；黑桃 A 内嵌金线祥云
    const ring = `<circle cx="100" cy="150" r="64" fill="none" stroke="${C.gold}" stroke-width="2"/><circle cx="100" cy="150" r="58" fill="none" stroke="${C.gold}" stroke-width="1" stroke-dasharray="2 4"/>`;
    let deco = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      deco += `<circle cx="${f(100 + Math.cos(a) * 64)}" cy="${f(150 + Math.sin(a) * 64)}" r="3" fill="${C.gold}"/>`;
    }
    const big = suitShape(s, 100, 150, s === 0 ? 92 : 84, col, false, `stroke="${s === 0 ? C.goldDeep : 'none'}" stroke-width="${s === 0 ? 1.2 : 0}"`);
    const inlay = s === 0
      ? `<path d="${cloudPath(100, 146, 46)}" fill="none" stroke="${C.gold}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="100" cy="122" r="5" fill="${C.gold}"/>`
      : `<path d="${s === 1 ? 'M84 128q-8 6-4 16' : 'M88 132q-6 6-2 14'}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".45"/>`;
    center = ring + deco + big + inlay;
  } else {
    // J / Q / K 人物画框
    const pal = SUIT_PALETTES[s] ?? SUIT_PALETTES[0]!;
    const fig = rank === 11 ? jackFigure(pal) : rank === 12 ? queenFigure(pal) : kingFigure(pal);
    center = `<defs>${goldDefs('ff')}<clipPath id="fc"><rect x="30" y="84" width="140" height="132" rx="10"/></clipPath>` +
      `<linearGradient id="fbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdf3dc"/><stop offset="1" stop-color="#f1dcae"/></linearGradient></defs>` +
      `<rect x="30" y="84" width="140" height="132" rx="10" fill="url(#fbg)"/>` +
      `<g clip-path="url(#fc)"><path d="${cloudPath(48, 104, 44)}" fill="none" stroke="${C.gold}" stroke-width="1.6" opacity=".6"/><path d="${cloudPath(156, 120, 40)}" fill="none" stroke="${C.gold}" stroke-width="1.6" opacity=".6"/>` +
      `<g transform="translate(36 86)">${fig}</g></g>` +
      goldFrame('ff', 30, 84, 140, 132, 10) +
      `<rect x="34" y="88" width="132" height="124" rx="7" fill="none" stroke="${pal.main}" stroke-width="1" opacity=".5"/>` +
      // 画框下沿小花色
      `<circle cx="100" cy="216" r="11" fill="${C.ivory}" stroke="${C.gold}" stroke-width="2"/>` + suitShape(s, 100, 216, 13, col);
  }
  return svg(CARD_W, CARD_H, cardBase('cb') + center + idx);
}

/** 牌背：0 红漆、1 墨绿漆。深漆底 + 金边内框 + 祥云线纹满铺 + 中央椭圆漆印"掼" */
export function cardBackSvg(variant: 0 | 1): string {
  const red = variant === 0;
  const a = red ? '#a81f27' : '#1f5a43';
  const b = red ? '#5c0b11' : '#0a261b';
  const hw = huiwenRow(22, 20, 12, 13) + huiwenRow(22, 248, 12, 13);
  const cl = (x: number, y: number) => cloudPath(x, y, 30);
  return svg(CARD_W, CARD_H,
    `<defs><radialGradient id="bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>` +
    `<pattern id="xy" width="36" height="28" patternUnits="userSpaceOnUse"><path d="${cl(9, 8)}${cl(27, 22)}" fill="none" stroke="${C.gold}" stroke-width=".9" opacity=".3"/></pattern>` +
    `<linearGradient id="bk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e4a2"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient>` +
    `<radialGradient id="sl" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="${red ? '#9a1620' : '#17503a'}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>` +
    `<rect x="1" y="1" width="198" height="278" rx="${CARD_R}" fill="${C.ivory}" stroke="#b9a77c" stroke-width="2"/>` +
    `<rect x="8" y="8" width="184" height="264" rx="9" fill="url(#bg)"/>` +
    `<rect x="8" y="8" width="184" height="264" rx="9" fill="url(#xy)"/>` +
    `<rect x="14" y="14" width="172" height="252" rx="6" fill="none" stroke="url(#bk)" stroke-width="2.4"/>` +
    `<rect x="19" y="19" width="162" height="242" rx="4" fill="none" stroke="${C.gold}" stroke-width=".8" opacity=".8"/>` +
    `<path d="${hw}" fill="none" stroke="${C.gold}" stroke-width="1.4" stroke-linecap="square" opacity=".7"/>` +
    `<ellipse cx="100" cy="140" rx="44" ry="58" fill="url(#sl)" stroke="url(#bk)" stroke-width="3.5"/>` +
    `<ellipse cx="100" cy="140" rx="37" ry="51" fill="none" stroke="${C.gold}" stroke-width="1" stroke-dasharray="3 3" opacity=".9"/>` +
    `<text x="100" y="159" font-family='${SERIF}' font-weight="900" font-size="56" fill="url(#bk)" text-anchor="middle">掼</text>`);
}

/** 级牌标识（透明覆盖层）：左、上金色细光边 + 索引右侧金色方印"级"（x≈115–159，列横向重叠时仍露出） */
export function levelMarkSvg(): string {
  const edge = `M4 ${CARD_H - 30}V${CARD_R + 4}Q4 4 ${CARD_R + 4} 4H${CARD_W - 30}`;
  return svg(CARD_W, CARD_H,
    `<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".6" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7dd8e"/><stop offset="1" stop-color="#c4912f"/></linearGradient></defs>` +
    `<path d="${edge}" fill="none" stroke="url(#lg)" stroke-width="12" stroke-linecap="round" opacity=".35"/>` +
    `<path d="${edge}" fill="none" stroke="url(#lg)" stroke-width="5" stroke-linecap="round"/>` +
    `<g transform="rotate(-6 137 36)"><rect x="115" y="14" width="44" height="44" rx="6" fill="url(#sg)" stroke="${C.goldDeep}" stroke-width="2.5"/>` +
    `<rect x="119" y="18" width="36" height="36" rx="3.5" fill="none" stroke="${C.redDeep}" stroke-width="1.5" opacity=".7"/>` +
    `<text x="137" y="47" font-family='${SERIF}' font-weight="900" font-size="28" fill="${C.redDeep}" text-anchor="middle">级</text></g>`);
}

/** 逢人配标识（透明覆盖层）：整圈金红发光描边 + 索引右侧红底金字圆印"配"（同上） */
export function wildMarkSvg(): string {
  const r = `x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="${CARD_R - 2}"`;
  return svg(CARD_W, CARD_H,
    `<defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".35" stop-color="${C.gold}"/><stop offset=".7" stop-color="#e2343c"/><stop offset="1" stop-color="${C.gold}"/></linearGradient>` +
    `<radialGradient id="wr" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#e3424a"/><stop offset="1" stop-color="${C.redDeep}"/></radialGradient></defs>` +
    `<rect ${r} fill="none" stroke="#ff9a3c" stroke-width="20" opacity=".3"/>` +
    `<rect ${r} fill="none" stroke="url(#wg)" stroke-width="8"/>` +
    `<rect x="11" y="11" width="${CARD_W - 22}" height="${CARD_H - 22}" rx="${CARD_R - 6}" fill="none" stroke="${C.goldLight}" stroke-width="1.5" opacity=".9"/>` +
    `<circle cx="137" cy="37" r="22.5" fill="url(#wr)" stroke="${C.gold}" stroke-width="3"/>` +
    `<circle cx="137" cy="37" r="17.5" fill="none" stroke="${C.goldLight}" stroke-width="1.2" stroke-dasharray="2 2.5"/>` +
    `<text x="137" y="47" font-family='${SERIF}' font-weight="900" font-size="26" fill="${C.goldLight}" text-anchor="middle">配</text>`);
}
