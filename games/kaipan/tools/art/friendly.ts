/**
 * 0.3.1「看得懂、说人话」的素材：
 *   guide/rotation.svg、guide/buy.svg、guide/sell.svg   说明书 3 张插图，520×300。上方 0–226 是画，
 *                                                        下方 y 232–296 留一条空白纸面给文字（内边距 20）。
 *   ui/stage_<cold|warm|hot|overheat|cooling>.svg      风口五种状态小图标，32×32，颜色从冷到热（降温回到冷色）
 *   ui/news.svg                                         收盘新闻图标：一份小报纸，40×40
 *   ui/recap_paper.svg                                  收盘小结卡纸张，96×96，九宫格 [24,24,24,24]，不带颗粒
 *   avatars/cat_hint.svg                                新手提示用的猫头像（小屋里那只橘猫醒着的样子），96×96
 */
import { readFileSync } from 'node:fs';
import { embed, resetEmbeds, stock, stockSpecs } from './keyart.ts';
import { INK, WHITE, darken, ellipseD, frag, grained, hiArc, lighten, merge, rrectD, shape, smoothClosed, sparkleD, starD, svgDoc } from './lib/svg.ts';

const V3 = new URL('../../public/assets/art/v3/', import.meta.url).pathname;

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

// ---------------------------------------------------------------- 风口状态图标（32×32）

export const STAGES = ['cold', 'warm', 'hot', 'overheat', 'cooling'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_NAMES: Record<Stage, string> = { cold: '没人理', warm: '开始火', hot: '正火', overheat: '太火了', cooling: '在降温' };
export const STAGE_COLORS: Record<Stage, string> = { cold: '#6fb6ff', warm: '#ffcf3a', hot: '#ff8a3d', overheat: '#e8352e', cooling: '#5fd0d6' };

const flameD = (cx: number, by: number, s: number) =>
  `M${cx} ${by - 22 * s}Q${cx + 11 * s} ${by - 12 * s} ${cx + 10 * s} ${by - 3 * s}Q${cx + 9 * s} ${by + 1 * s} ${cx} ${by + 1 * s}Q${cx - 9 * s} ${by + 1 * s} ${cx - 10 * s} ${by - 4 * s}Q${cx - 11 * s} ${by - 10 * s} ${cx - 5 * s} ${by - 14 * s}Q${cx - 4 * s} ${by - 8 * s} ${cx - 1 * s} ${by - 8 * s}Q${cx + 2 * s} ${by - 14 * s} ${cx} ${by - 22 * s}Z`;

function stageInner(st: Stage): string {
  switch (st) {
    case 'cold':
      // 雪花 + 一个"Z"（没人理，睡着了）
      return [0, 60, 120].map((r) => `<g transform="rotate(${r} 15 17)">${line('M15 8.5V25.5', WHITE, 2.6)}${line('M12.5 10.5l2.5 2.4 2.5 -2.4M12.5 23.5l2.5 -2.4 2.5 2.4', WHITE, 1.8)}</g>`).join('') +
        `<path d="M21 5h5l-5 5h5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'warm':
      // 一小簇火苗 + 向上的小箭头
      return `<path d="${flameD(14, 24, 0.62)}" fill="#ff8a3d" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="${flameD(14, 24, 0.32)}" fill="#fff1a8"/>` +
        `<path d="M23 9L27 14H24.6V19H21.4V14H19Z" fill="#ff4d4d" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
    case 'hot':
      return `<path d="${flameD(16, 26, 0.95)}" fill="#ff5a2a" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="${flameD(16, 26, 0.5)}" fill="#ffd23f"/>`;
    case 'overheat':
      // 大火 + 感叹号：太火了，危险
      return `<path d="${flameD(13, 27, 0.92)}" fill="#ffb347" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="${flameD(13, 27, 0.48)}" fill="#fff1a8"/>` +
        `<rect x="22.4" y="6" width="4.2" height="12" rx="2.1" fill="${WHITE}" stroke="${INK}" stroke-width="1.6"/><circle cx="24.5" cy="22.8" r="2.4" fill="${WHITE}" stroke="${INK}" stroke-width="1.6"/>`;
    case 'cooling':
      // 向下的箭头 + 冰晶
      return `<path d="M12 25L19.5 15.5H15V7H9V15.5H4.5Z" fill="#7ad0ff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` +
        `<path d="M23 8L27 14L23 26L19 14Z" fill="#eafcff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>${line('M23 11V22', '#9fe4f0', 1.4)}`;
  }
}

export function stageSvg(st: Stage): string {
  const c = STAGE_COLORS[st];
  const disc = `<circle cx="16" cy="16.6" r="14.6" fill="${darken(c, 0.25)}"/><circle cx="16" cy="16" r="14.6" fill="${c}" stroke="${INK}" stroke-width="2.2"/>` +
    `<path d="M7 10q3 -5 9 -6" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/>`;
  return svgDoc(32, 32, frag(disc + stageInner(st)));
}

// ---------------------------------------------------------------- 收盘新闻、小结卡、猫头像

export function newsSvg(): string {
  // 折起来的小报纸：报头色条 + 大标题 + 一张小图 + 几行字
  const back = `<path d="M8 8H34Q37 8 37 11V31Q37 35 33 35H9Z" fill="#e6dccb" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  const page = shape('M3 6H30V31Q30 35 34 35H7Q3 35 3 31Z', {
    fill: '#fffaf0',
    shade: '#efe4d0',
    shadeOffset: [-2, -2],
    sw: 2.6,
    extra:
      `<rect x="6" y="9" width="21" height="4.5" rx="1" fill="#e8553e"/>` +
      line('M6 17H27', INK, 2.2) +
      `<rect x="6" y="20.5" width="9" height="8" rx="1" fill="#7fc8ff" stroke="${INK}" stroke-width="1.2"/>` +
      line('M18 21.5H27M18 25H27M18 28.5H24M6 31.5H22', '#a89a8a', 1.6),
  });
  return svgDoc(40, 40, merge(frag(back), page, frag(`<path d="${sparkleD(35, 6, 4)}" fill="#fff1a8" stroke="${INK}" stroke-width="1.2"/>`)));
}

export function recapPaperSvg(): string {
  // 九宫格纸张：四角 24px 内放装饰（左上胶带、右下折角阴影），边和中间都是纯色，拉伸不会出条纹
  return svgDoc(96, 96, frag(
    `<rect x="6" y="8" width="88" height="86" rx="14" fill="${INK}" fill-opacity="0.18"/>` +
      `<rect x="3" y="4" width="88" height="86" rx="14" fill="#fffaf0" stroke="${INK}" stroke-width="3"/>` +
      `<g transform="rotate(-32 14 12)"><rect x="2" y="7" width="24" height="10" rx="1.5" fill="#ffd56b" fill-opacity="0.85" stroke="${INK}" stroke-width="1.4" stroke-opacity="0.5"/></g>` +
      `<path d="M91 70V76Q91 90 77 90H71Q84 86 91 70Z" fill="#efe4d0"/>`,
  ));
}

export function catHintSvg(): string {
  const fur = '#ffb766';
  const stripe = '#e8893a';
  const bg = frag(
    `<clipPath id="av"><circle cx="48" cy="48" r="44.5"/></clipPath>` +
      `<circle cx="48" cy="48" r="45" fill="#b9a6ff"/>` +
      `<circle cx="48" cy="48" r="45" fill="none" stroke="${lighten('#b9a6ff', 0.35)}" stroke-width="5" stroke-dasharray="2 7" stroke-linecap="round"/>`,
  );
  const ears =
    `<path d="M20 44L22 14L44 30Z" fill="${fur}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/><path d="M76 44L74 14L52 30Z" fill="${fur}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
    `<path d="M25 36L26 22L37 31Z" fill="#ffb3c0"/><path d="M71 36L70 22L59 31Z" fill="#ffb3c0"/>`;
  const body = shape('M14 100Q16 78 30 74H66Q80 78 82 100Z', { fill: fur, sw: 3.2, extra: `<ellipse cx="48" cy="92" rx="18" ry="12" fill="#fff1d6"/>` });
  const head = shape(ellipseD(48, 54, 32, 27), {
    fill: fur,
    shade: darken(fur, 0.1),
    shadeOffset: [-3, -4],
    sw: 3.2,
    extra: line('M40 28q2 6 0 10M48 27v10M56 28q-2 6 0 10', stripe, 3) + `<ellipse cx="48" cy="66" rx="13" ry="9" fill="#fff1d6"/>` + hiArc('M22 50q2 -12 12 -18', 3, 0.5),
  });
  const face =
    `<ellipse cx="36" cy="54" rx="3.6" ry="4.6" fill="${INK}"/><ellipse cx="60" cy="54" rx="3.6" ry="4.6" fill="${INK}"/>` +
    `<circle cx="34.8" cy="52.4" r="1.4" fill="${WHITE}"/><circle cx="58.8" cy="52.4" r="1.4" fill="${WHITE}"/>` +
    `<path d="M45.5 61l2.5 2.6 2.5 -2.6z" fill="#ff8fa3" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    line('M48 63.6q-2.6 4 -6 2.2M48 63.6q2.6 4 6 2.2', INK, 2.2) +
    `<ellipse cx="27" cy="62" rx="5.5" ry="3.2" fill="#ff8fa3" fill-opacity="0.6"/><ellipse cx="69" cy="62" rx="5.5" ry="3.2" fill="#ff8fa3" fill-opacity="0.6"/>` +
    line('M22 60h-11M22 65l-10 3M74 60h11M74 65l10 3', INK, 1.6, ' stroke-opacity="0.7"');
  // 举起一只爪子，像在提醒
  const paw = `<ellipse cx="78" cy="78" rx="9" ry="8" fill="#fff1d6" stroke="${INK}" stroke-width="2.8"/>` + line('M75 73v4M79 72v4M83 74v3', stripe, 1.6);
  const bulb = `<path d="${sparkleD(80, 22, 6)}" fill="#fff6b0" stroke="${INK}" stroke-width="1.6"/>`;
  const inner = merge(frag(ears), body, head, frag(face + paw));
  const clipped = frag(`<g clip-path="url(#av)">${inner.content}</g>`, inner.defs);
  return svgDoc(96, 96, merge(bg, grained(clipped, 0.05, [0, 0, 96, 96]), frag(`<circle cx="48" cy="48" r="45" fill="none" stroke="${INK}" stroke-width="3.2"/>` + bulb)));
}

// ---------------------------------------------------------------- 说明书插图（520×300）

const GW = 520;
const GH = 300;
const ART_H = 226;

function card(skyTop: string, skyBot: string, art: string, gid: string): string {
  const frame = rrectD(4, 4, GW - 8, GH - 8, 20);
  return (
    `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="${ART_H}"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBot}"/></linearGradient>` +
    `<clipPath id="${gid}c"><path d="${frame}"/></clipPath></defs>` +
    `<path d="${frame}" fill="#fffaf0"/>` +
    `<g clip-path="url(#${gid}c)"><rect x="0" y="0" width="${GW}" height="${ART_H}" fill="url(#${gid})"/>${art}` +
    `<path d="M0 ${ART_H}H${GW}" stroke="${INK}" stroke-width="3"/></g>` +
    `<path d="${frame}" fill="none" stroke="${INK}" stroke-width="3.4"/>`
  );
}

function stageIcon(st: Stage, cx: number, cy: number, size = 34): string {
  return embed(stageSvg(st), cx - size / 2, cy - size / 2, size, size);
}

function zzz(x: number, y: number): string {
  const z = (x0: number, y0: number, s: number) => `<path d="M${x0} ${y0}h${s}l${-s} ${s}h${s}" fill="none" stroke="${INK}" stroke-width="${s * 0.3 + 1.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x0} ${y0}h${s}l${-s} ${s}h${s}" fill="none" stroke="#ffffff" stroke-width="${s * 0.12 + 0.6}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return z(x, y, 7) + z(x + 9, y - 13, 9) + z(x + 20, y - 30, 11);
}

const flame = (x: number, y: number, s: number) => `<path d="${flameD(x, y, s)}" fill="#ff7a33" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="${flameD(x, y, s * 0.5)}" fill="#ffd23f"/>`;
const shard = (x: number, y: number, s: number, r = 0) => `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="M0 -10L5 0L0 10L-5 0Z" fill="#eafcff" stroke="${INK}" stroke-width="${(2 / s).toFixed(2)}" stroke-linejoin="round"/>`;

/** ① 风口会轮流火：一条从冷到热再到冷的曲线，同一只小人在五个点上 */
function guideRotation(): string {
  resetEmbeds();
  const specs = stockSpecs();
  const xs = [62, 162, 262, 362, 462];
  const ys = [196, 150, 104, 86, 176];
  const pts = xs.map((x, i) => [x, ys[i]!] as [number, number]);
  const curve = `M22 210C${xs[0]} 206 ${xs[0]! + 40} 186 ${xs[1]} ${ys[1]}S${xs[2]! - 40} ${ys[2]! + 4} ${xs[2]} ${ys[2]}S${xs[3]! - 30} ${ys[3]} ${xs[3]} ${ys[3]}S${xs[4]! - 40} ${ys[4]! - 20} ${xs[4]} ${ys[4]}S510 214 520 220`;
  const grad =
    `<linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="490" y2="0">` +
    STAGES.map((s, i) => `<stop offset="${(i / 4).toFixed(2)}" stop-color="${STAGE_COLORS[s]}"/>`).join('') +
    `</linearGradient>`;
  let art = `<defs>${grad}</defs>` +
    `<path d="M0 ${ART_H}V214C120 214 200 200 260 200S420 206 520 222V${ART_H}Z" fill="#e8dcc6"/>` +
    `<path d="${curve}" fill="none" stroke="${INK}" stroke-width="17" stroke-linecap="round"/><path d="${curve}" fill="none" stroke="url(#heat)" stroke-width="11" stroke-linecap="round"/>`;
  // 箭头表示时间方向
  art += `<path d="M498 206l16 10 -18 6z" fill="${STAGE_COLORS.cooling}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`;
  const exprs = ['blink', 'happy', 'limitup', 'worried', 'limitdown'];
  STAGES.forEach((st, i) => {
    const [x, y] = pts[i]!;
    if (st === 'overheat') art += flame(x - 26, y - 16, 1.15) + flame(x + 28, y - 18, 0.95);
    if (st === 'hot') art += flame(x + 30, y - 22, 0.7);
    art += stock(specs, 'ai_leader', exprs[i]!, x, y - 16, 74);
    art += stageIcon(st, x, y, 34);
    if (st === 'cold') art += zzz(x + 22, y - 62);
    if (st === 'cooling') art += shard(x - 30, y - 50, 1.1, -20) + shard(x + 32, y - 40, 0.9, 25) + shard(x + 24, y - 72, 0.7, 10);
  });
  return svgDoc(GW, GH, frag(card('#d9ecff', '#fff3e0', art, 'g1')));
}

function cart(cx: number, cy: number, rot: number, color: string): string {
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})">` +
    `<path d="M-40 -14H40L34 12Q33 16 28 16H-28Q-33 16 -34 12Z" fill="${color}" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>` +
    `<path d="M-36 -6H36" stroke="${lighten(color, 0.4)}" stroke-width="3"/>` +
    `<circle cx="-22" cy="20" r="8" fill="#3a3448" stroke="${INK}" stroke-width="3"/><circle cx="22" cy="20" r="8" fill="#3a3448" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="-22" cy="20" r="3" fill="#cfd8e6"/><circle cx="22" cy="20" r="3" fill="#cfd8e6"/></g>`;
}

/** 账户小卡：柱子越来越高、金币往上冒 */
function accountCard(x: number, y: number): string {
  const w = 132;
  const h = 150;
  let bars = '';
  [26, 38, 52, 70, 92].forEach((bh, i) => {
    bars += `<rect x="${x + 16 + i * 21}" y="${y + h - 18 - bh}" width="15" height="${bh}" rx="3" fill="#ff6a5a" stroke="${INK}" stroke-width="2.4"/>`;
  });
  return `<rect x="${x + 4}" y="${y + 6}" width="${w}" height="${h}" rx="14" fill="${INK}" fill-opacity="0.18"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fffaf0" stroke="${INK}" stroke-width="3.2"/>` +
    `<path d="M${x} ${y + 30}V${y + 14}Q${x} ${y} ${x + 14} ${y}H${x + w - 14}Q${x + w} ${y} ${x + w} ${y + 14}V${y + 30}Z" fill="#ffe0a8"/>` +
    `<path d="M${x} ${y + 30}H${x + w}" stroke="${INK}" stroke-width="2.4"/>` +
    `<circle cx="${x + 18}" cy="${y + 15}" r="7" fill="#ffd23f" stroke="${INK}" stroke-width="2"/><path d="${starD(x + 18, y + 15.5, 3.4)}" fill="#f0a020"/>` +
    line(`M${x + 32} ${y + 15}H${x + 74}`, '#d9c4a2', 4) + bars +
    `<path d="M${x + w - 26} ${y + 46}L${x + w - 14} ${y + 60}H${x + w - 21}V${y + 72}H${x + w - 31}V${y + 60}H${x + w - 38}Z" fill="#ff4d4d" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
    [[x + w - 6, y + 40, 9], [x + w + 6, y + 64, 7]].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/><path d="${starD(cx!, cy! + 0.5, r! * 0.45)}" fill="#f0a020"/>`).join('');
}

/** ② 开始火的时候买：热度箭头往上，小人跳上车，账户在涨 */
function guideBuy(): string {
  resetEmbeds();
  const specs = stockSpecs();
  let art =
    // 热度箭头
    `<path d="M20 214L300 52" stroke="${INK}" stroke-width="30" stroke-linecap="round"/><path d="M20 214L300 52" stroke="#ff7a4a" stroke-width="22" stroke-linecap="round"/>` +
    `<path d="M282 30L336 34L310 82Z" fill="#ff7a4a" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>` +
    [0.15, 0.4, 0.65].map((t) => `<path d="M${20 + 280 * t - 8} ${214 - 162 * t + 6}l10 -16 6 12" fill="none" stroke="#ffd0b8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  art += stageIcon('warm', 50, 160, 36) + stageIcon('hot', 250, 40, 30);
  art += cart(140, 134, -30, '#5ab0ff');
  // 小人正往车里跳
  art += stock(specs, 'ai_leader', 'happy', 150, 110, 84);
  art += line('M96 70q-10 4 -14 12M104 54q-12 2 -18 8', INK, 3, ' stroke-opacity="0.4"');
  art += `<path d="${sparkleD(200, 60, 7)}" fill="#fff6b0" stroke="${INK}" stroke-width="1.8"/>`;
  art += accountCard(360, 48);
  return svgDoc(GW, GH, frag(card('#fff0d0', '#ffe6c8', art, 'g2')));
}

/** ③ 太火了就卖，月底要还钱：小人抱着钱袋跳下车，车后面的轨道结冰；旁边月底账单盖着"已还清" */
function guideSell(): string {
  resetEmbeds();
  const specs = stockSpecs();
  const up = 'M18 200Q90 170 150 70';
  const down = 'M150 70Q200 150 300 206';
  let art =
    `<path d="${up}" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/><path d="${up}" fill="none" stroke="#ff6a4a" stroke-width="16" stroke-linecap="round"/>` +
    `<path d="${down}" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/><path d="${down}" fill="none" stroke="#bfefff" stroke-width="16" stroke-linecap="round"/>` +
    line('M170 104l6 6M196 142l7 4M232 172l7 3M262 188l6 2', '#ffffff', 3);
  // 冰柱
  for (const [x, y] of [[178, 116], [206, 150], [240, 178], [272, 194]] as const) art += `<path d="M${x - 5} ${y}L${x} ${y + 16}L${x + 5} ${y}Z" fill="#eafcff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
  art += shard(282, 150, 1.1, 20) + shard(240, 132, 0.8, -15);
  art += cart(236, 160, 30, '#9aa6c0');
  art += stageIcon('overheat', 160, 34, 34) + stageIcon('cooling', 300, 168, 34);
  art += flame(132, 62, 0.9);
  // 小人抱着钱袋跳下车（往左）
  art += line('M118 70q12 -4 18 6M112 88q14 -2 20 8', INK, 3, ' stroke-opacity="0.4"');
  art += stock(specs, 'ai_leader', 'happy', 76, 112, 80, true);
  art += `<g transform="translate(40 96)"><path d="M-9 -2Q-15 14 0 15Q15 14 9 -2Z" fill="#f6c02f" stroke="${INK}" stroke-width="2.4"/><path d="M-6 -3L-9 -10L-3 -7L0 -11L3 -7L9 -10L6 -3Z" fill="#f6c02f" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="${starD(0, 7, 4)}" fill="#e0a020"/></g>`;
  // 月底账单 + 已还清章
  const bill = readFileSync(`${V3}ui/bill_card.svg`, 'utf8');
  const stamp = readFileSync(`${V3}ui/stamp_paid.svg`, 'utf8');
  art += `<g transform="rotate(5 430 112)">${embed(bill, 366, 22, 128, 160)}</g>`;
  art += `<g transform="rotate(-14 440 132)">${embed(stamp, 398, 90, 86, 86)}${line('M424 134l11 11 20 -24', '#e23b2e', 6, ' stroke-opacity="0.9"')}</g>`;
  return svgDoc(GW, GH, frag(card('#e4f4ff', '#f4f8ff', art, 'g3')));
}

export const GUIDES: Record<string, () => string> = { rotation: guideRotation, buy: guideBuy, sell: guideSell };

export function build(write: (rel: string, data: string) => void): number {
  let n = 0;
  for (const st of STAGES) {
    write(`ui/stage_${st}.svg`, stageSvg(st));
    n++;
  }
  write('ui/news.svg', newsSvg());
  write('ui/recap_paper.svg', recapPaperSvg());
  write('avatars/cat_hint.svg', catHintSvg());
  n += 3;
  for (const [k, f] of Object.entries(GUIDES)) {
    write(`guide/${k}.svg`, f());
    n++;
  }
  return n;
}

export { smoothClosed };
