/**
 * 股票小人：身体（精做配方 / 生成器形状）+ 角色配饰 + 名字梗道具，输出分层部件与合成图。
 *
 * 画布 128×128，地面 y=116，所有分层文件同尺寸同原点（叠放即对齐）。
 * 层序（下→上）：shadow, back, spin, body, mark, cheeks, eyes_*, mouth_*, acc, fx_*
 */
import { EXPRESSIONS, type Expr, type FaceStyle, cheeks, eyes, eyesBlink, faceFx, mouth } from './lib/face.ts';
import {
  INK, SW, THEME_COLORS, WHITE, type Frag, darken, ellipseD, frag, grained, grayscaleSvg, hiArc, lighten, merge,
  nid, rrectD, shape, smoothClosed, sparkleD, starD, svgDoc,
} from './lib/svg.ts';

export const CANVAS = 128;
export const GROUND = 116;

export interface StockSpec {
  id: string;
  name: string;
  theme: string;
  role: 'leader' | 'follower' | 'bluechip' | 'meme' | 'st';
  hero?: boolean;
  body?: string;
  shape?: string;
  motif?: string;
  colors?: { body?: string; accent?: string; trim?: string };
}

export interface Colors {
  body: string;
  accent: string;
  trim: string;
}

type Pt = [number, number];

export interface Built {
  back?: Frag;
  spin?: Frag;
  body: Frag;
  mark?: Frag;
  acc?: Frag;
  face: FaceStyle;
  shadowRx: number;
  shadowX?: number;
  anchors: { headTop: Pt; hand?: Pt; spin?: Pt };
}

// ---------------------------------------------------------------- 通用小部件

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

/** 粗短的小胳膊：描边线 + 填色线 + 手 */
function arm(x0: number, y0: number, x1: number, y1: number, color: string, hand = true): string {
  const d = `M${x0} ${y0}L${x1} ${y1}`;
  let s = line(d, INK, 12) + line(d, color, 5.5);
  if (hand) s += `<circle cx="${x1}" cy="${y1}" r="5" fill="${color}" stroke="${INK}" stroke-width="3"/>`;
  return s;
}

function feet(xs: number[], color: string, y = GROUND - 3): string {
  return xs.map((x) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="5" fill="${darken(color, 0.15)}" stroke="${INK}" stroke-width="3.2"/>`).join('');
}

function crown(cx: number, cy: number, s = 1, rot = 0): Frag {
  const d = 'M-14 7L-15 -7L-7 0L0 -12L7 0L15 -7L14 7Z';
  const f = shape(d, { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-3, -3], sw: 3.2 });
  const gems =
    `<circle cx="0" cy="-12" r="2.6" fill="#ff5d7a" stroke="${INK}" stroke-width="1.8"/>` +
    `<circle cx="-15" cy="-7" r="2.2" fill="#5ee0ff" stroke="${INK}" stroke-width="1.6"/>` +
    `<circle cx="15" cy="-7" r="2.2" fill="#5ee0ff" stroke="${INK}" stroke-width="1.6"/>` +
    `<path d="M-13 3.5h26" stroke="${INK}" stroke-width="2" stroke-opacity="0.5"/>` +
    hiArc('M-9 -1l3 3', 2, 0.8);
  return frag(`<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})">${f.content}${gems}</g>`, f.defs);
}

function tie(cx: number, cy: number, color: string, s = 1, rot = 0, collar = true): Frag {
  let c = '';
  if (collar) c += `<path d="M-12 -3l12 6 12 -6 -2 8 -10 2 -10 -2z" fill="${WHITE}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`;
  const blade = shape('M-4 3L4 3L7 22L0 30L-7 22Z', { fill: color, sw: 2.8, shadeOffset: [-2, -2] });
  const knot = `<path d="M-5.5 -2h11l-2 6h-7z" fill="${lighten(color, 0.15)}" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`;
  const stripes = `<path d="M-4 12l8 -3M-5 19l10 -4" stroke="${lighten(color, 0.55)}" stroke-width="2" stroke-linecap="round"/>`;
  return frag(
    `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})">${c}${blade.content}${stripes}${knot}</g>`,
    blade.defs,
  );
}

/** 妖股的闪电标记：画在额头正中（两条眉毛之间的上方），不压住眼睛 */
function boltMark(fs: FaceStyle): Frag {
  const k = fs.s * 0.8;
  const x = fs.x + (fs.markDx ?? 0) * fs.s;
  const y = fs.y + (fs.markDy ?? -19) * fs.s;
  const d = `M${x + 2 * k} ${y - 9 * k}L${x - 5 * k} ${y + 1 * k}L${x} ${y + 1 * k}L${x - 3 * k} ${y + 9 * k}L${x + 5 * k} ${y - 2 * k}L${x} ${y - 2 * k}L${x + 4 * k} ${y - 9 * k}Z`;
  return frag(`<path d="${d}" fill="#ffe14a" stroke="${INK}" stroke-width="${(2.4 * fs.s).toFixed(2)}" stroke-linejoin="round"/>`);
}

/** 跟风小旗。dir=1 旗面朝右，-1 朝左；stick=插在身上（没有手）；w 旗面宽 */
function flag(hx: number, hy: number, color: string, dir: 1 | -1 = 1, stick = false, w = 28): Frag {
  const top = hy - (stick ? 44 : 50);
  const px = hx + 3 * dir;
  const pd = `M${hx} ${hy + (stick ? 0 : 8)}L${px} ${top}`;
  const pole = line(pd, INK, 6) + line(pd, '#c98a4a', 2.5);
  const cloth = shape(`M${px} ${top + 2}Q${px + dir * w * 0.5} ${top - 2} ${px + dir * w} ${top + 8}Q${px + dir * w * 0.5} ${top + 13} ${px} ${top + 20}Z`, {
    fill: color,
    sw: 3,
    shadeOffset: [-3 * dir, -3],
  });
  const star = `<path d="${starD(px + dir * w * 0.42, top + 9, 4)}" fill="${WHITE}"/>`;
  const knob = `<circle cx="${px}" cy="${top - 1}" r="3.4" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/>`;
  const hand = stick ? '' : `<circle cx="${hx}" cy="${hy}" r="5.5" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>`;
  return frag(pole + cloth.content + star + knob + hand, cloth.defs);
}

function bandage(cx: number, cy: number): string {
  const one = (rot: number) =>
    `<g transform="translate(${cx} ${cy}) rotate(${rot})"><rect x="-14" y="-4.8" width="28" height="9.6" rx="4.8" fill="#ffe0bd" stroke="${INK}" stroke-width="2.6"/>` +
    `<rect x="-4.5" y="-3.2" width="9" height="6.4" rx="1.5" fill="#f2bf8c"/><circle cx="-9" cy="-1.5" r="0.9" fill="#d69a66"/><circle cx="-9" cy="1.8" r="0.9" fill="#d69a66"/><circle cx="9" cy="-1.5" r="0.9" fill="#d69a66"/><circle cx="9" cy="1.8" r="0.9" fill="#d69a66"/></g>`;
  return one(40) + one(-40);
}

function leaf(bx: number, by: number, tx: number, ty: number, w: number, bend: number): string {
  const mx = (bx + tx) / 2;
  const my = (by + ty) / 2;
  const len = Math.hypot(tx - bx, ty - by);
  const nx = -(ty - by) / len;
  const ny = (tx - bx) / len;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return `M${bx - w / 2} ${by}Q${(cx - w / 2).toFixed(1)} ${cy.toFixed(1)} ${tx} ${ty}Q${(cx + w / 2).toFixed(1)} ${cy.toFixed(1)} ${bx + w / 2} ${by}Z`;
}

function wing(side: 1 | -1, x: number, y: number, s = 1): Frag {
  const d = 'M0 0C-8 -10 -22 -20 -36 -16C-30 -12 -32 -8 -34 -4C-27 -4 -27 0 -30 4C-22 3 -18 6 -20 10C-12 8 -4 6 0 0Z';
  const f = shape(d, { fill: WHITE, shade: '#d9e4f5', shadeOffset: [3, -3], sw: 3 });
  const feathers = line('M-30 -4L-12 -2M-26 5L-10 2', '#b8c6dd', 2);
  return frag(`<g transform="translate(${x} ${y}) scale(${-side * s} ${s})">${f.content}${feathers}</g>`, f.defs);
}

// ---------------------------------------------------------------- 精做 6 只

const HERO_BODIES: Record<string, (c: Colors) => Built> = {
  /** 韭菜芯片：长着韭菜头发的芯片，龙头戴皇冠 */
  leekchip(c) {
    const gid = nid('leek');
    const leekGrad = `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="0" y2="30"><stop offset="0" stop-color="#f1fbe2"/><stop offset="0.35" stop-color="#bfe98f"/><stop offset="1" stop-color="${c.accent}"/></linearGradient>`;
    const blades: [number, number, number, number, number][] = [
      [47, 16, 26, 9, -8],
      [53, 30, 10, 9, -6],
      [60, 50, 3, 9, -3],
      [67, 74, 4, 9, 3],
      [74, 96, 12, 9, 6],
      [80, 112, 30, 9, 9],
      [57, 40, 20, 8, -2],
      [71, 86, 22, 8, 2],
    ];
    let leeks = '';
    for (const [bx, tx, ty, w, b] of blades) {
      const d = leaf(bx, 52, tx, ty, w, b);
      leeks += `<path d="${d}" fill="url(#${gid})" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
      leeks += `<path d="M${bx} 48L${(bx * 0.6 + tx * 0.4).toFixed(1)} ${(52 * 0.6 + ty * 0.4).toFixed(1)}" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4" stroke-linecap="round"/>`;
    }
    const pins = (() => {
      let s = '';
      for (const y of [62, 78, 94]) {
        s += `<rect x="18" y="${y - 3.5}" width="14" height="7" rx="2" fill="${c.trim}" stroke="${INK}" stroke-width="3"/>`;
        s += `<rect x="96" y="${y - 3.5}" width="14" height="7" rx="2" fill="${c.trim}" stroke="${INK}" stroke-width="3"/>`;
      }
      for (const x of [46, 64, 82]) s += `<rect x="${x - 4}" y="102" width="8" height="14" rx="2.5" fill="${c.trim}" stroke="${INK}" stroke-width="3"/>`;
      return s;
    })();
    const chipD = rrectD(28, 46, 72, 62, 12);
    const chip = shape(chipD, {
      fill: c.body,
      extra:
        `<rect x="39" y="57" width="50" height="41" rx="9" fill="#d8f4ff" stroke="${darken(c.body, 0.3)}" stroke-width="2.5"/>` +
        line('M33 54h5v5M95 54h-5v5M33 101h5v-5M95 101h-5v-5', c.trim, 2.2) +
        `<circle cx="33" cy="54" r="1.8" fill="${c.trim}"/><circle cx="95" cy="54" r="1.8" fill="${c.trim}"/>` +
        hiArc('M34 60q0 -8 8 -9', 3, 0.5),
    });
    const body = merge(frag(leeks, new Map([[gid, leekGrad]])), frag(pins), chip);
    return {
      body: grained(body),
      acc: crown(64, 44, 0.95, -6),
      face: { x: 64, y: 76, s: 1, gap: 13, mouthDy: 11, headTopY: 46 },
      shadowRx: 40,
      anchors: { headTop: [64, 6] },
    };
  },

  /** 躺平银行：趴在枕头上的金色存钱猪，大脑袋在左，身子躺平向右，领带松垮 */
  lazypiggy(c) {
    const pillow = shape('M4 104Q4 92 18 92H62Q74 92 74 104Q74 116 62 116H18Q4 116 4 104Z', { fill: '#cfe3ff', sw: 3.2 });
    const pillowLines = line('M14 100q6 3 12 0M50 110q6 3 12 0', '#9fbde8', 2);
    const legs =
      `<rect x="100" y="98" width="12" height="15" rx="5" fill="${darken(c.body, 0.12)}" stroke="${INK}" stroke-width="3.2" transform="rotate(-35 106 106)"/>` +
      `<rect x="84" y="102" width="12" height="13" rx="5" fill="${darken(c.body, 0.12)}" stroke="${INK}" stroke-width="3.2" transform="rotate(-12 90 108)"/>`;
    const tail = line('M117 82q8 -4 5 -10q-3 -4 -6 0q-2 4 4 6', INK, 6) + line('M117 82q8 -4 5 -10q-3 -4 -6 0q-2 4 4 6', c.body, 2.5);
    const bodyMain = shape(ellipseD(84, 90, 36, 22), {
      fill: c.body,
      extra: `<rect x="80" y="69" width="20" height="4.5" rx="2.25" fill="${INK}" transform="rotate(8 90 71)"/>` + hiArc('M104 76q6 2 8 6', 3, 0.45),
    });
    const coin = `<g transform="rotate(8 90 71)"><path d="M81 70.5a9 9 0 0 1 18 0z" fill="#fff0a0" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M90 64.5v4" stroke="#e0a020" stroke-width="2" stroke-linecap="round"/></g>`;
    const earL = shape('M22 62Q14 44 30 48Q36 52 34 60Z', { fill: c.body, sw: 3.2, shadeOffset: [2, -2] });
    const earR = shape('M62 60Q66 44 52 46Q46 50 48 58Z', { fill: c.body, sw: 3.2, shadeOffset: [-2, -2] });
    const head = shape(ellipseD(42, 80, 31, 28), { fill: c.body, extra: hiArc('M18 74q2 -12 12 -18', 4, 0.6) });
    const snout = `<ellipse cx="42" cy="91" rx="10.5" ry="7.5" fill="${c.accent}" stroke="${INK}" stroke-width="3"/><ellipse cx="38.3" cy="91" rx="2" ry="3" fill="${INK}"/><ellipse cx="45.7" cy="91" rx="2" ry="3" fill="${INK}"/>`;
    const body = merge(pillow, frag(pillowLines + legs + tail), bodyMain, frag(coin), earL, earR, head, frag(snout));
    return {
      body: grained(body),
      acc: tie(76, 96, c.trim, 0.8, -55, false),
      face: { x: 42, y: 76, s: 1.02, gap: 13, mouthDy: 25, eyeKind: 'sleepy', sweatSide: 1, headTopY: 52 },
      shadowRx: 52,
      anchors: { headTop: [42, 40] },
    };
  },

  /** 国民辣条：波浪边的红辣条，常戴墨镜，打领带 */
  latiao(c) {
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= 13; i++) {
      const y = 16 + i * 7.3;
      const bend = 5 * Math.sin(((y - 16) / 96) * Math.PI * 1.6);
      const ruff = i % 2 === 0 ? 0 : 2.6;
      left.push([41 + bend - ruff, y]);
      right.push([87 + bend + ruff, y]);
    }
    const pts: Pt[] = [[64, 11], ...right, [70, 114], [58, 114], ...left.reverse()];
    const d = smoothClosed(pts, 0.9);
    // 辣椒碎、芝麻、油光
    let deco = '';
    const flakes: Pt[] = [[50, 30], [76, 34], [52, 86], [80, 92], [60, 100], [47, 64], [82, 58]];
    for (const [x, y] of flakes) deco += `<path d="M${x} ${y}l3 -2 2 3 -3 2z" fill="#9e1f12"/>`;
    const seeds: Pt[] = [[70, 24], [56, 40], [78, 74], [50, 100], [72, 104]];
    for (const [x, y] of seeds) deco += `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.4" fill="#fff1c9" stroke="#b5651d" stroke-width="0.6" transform="rotate(${(x * 7) % 60 - 30} ${x} ${y})"/>`;
    deco += hiArc('M47 26q-2 10 0 18', 3.2, 0.6) + hiArc('M50 76q-2 8 -1 14', 2.6, 0.45);
    deco += `<path d="M58 20q6 30 2 80" stroke="${c.accent}" stroke-opacity="0.5" stroke-width="6" stroke-linecap="round" fill="none"/>`;
    const strip = shape(d, { fill: c.body, extra: deco });
    const limbs = arm(44, 78, 30, 90, c.body) + arm(84, 76, 99, 66, c.body) + feet([56, 74], c.body);
    return {
      body: grained(merge(frag(limbs), strip)),
      acc: tie(64, 73, c.trim, 0.85),
      face: { x: 64, y: 48, s: 1, gap: 12, mouthDy: 13, eyeKind: 'shades', headTopY: 12 },
      shadowRx: 30,
      anchors: { headTop: [64, 10] },
    };
  },

  /** 永动机能源：仓鼠跑轮。轮子单独成层（spin），可以绕轴转 */
  hamsterwheel(c) {
    const cx = 64;
    const cy = 58;
    const stand =
      line(`M${cx} ${cy}L36 ${GROUND - 2}M${cx} ${cy}L92 ${GROUND - 2}`, INK, 10) +
      line(`M${cx} ${cy}L36 ${GROUND - 2}M${cx} ${cy}L92 ${GROUND - 2}`, darken(c.accent, 0.25), 4.5) +
      `<rect x="26" y="${GROUND - 6}" width="76" height="7" rx="3.5" fill="${darken(c.accent, 0.3)}" stroke="${INK}" stroke-width="3"/>`;
    // 电源线和插头
    const cable =
      line(`M96 ${GROUND - 3}q14 -2 16 -14t8 -12`, INK, 5) + line(`M96 ${GROUND - 3}q14 -2 16 -14t8 -12`, '#5a5f73', 2) +
      `<rect x="114" y="80" width="10" height="9" rx="2" fill="#ffd23f" stroke="${INK}" stroke-width="2.4" transform="rotate(-30 119 84)"/>` +
      line('M117 78l-1 -5M122 81l1 -5', INK, 2.4);
    let wheel = '';
    const R = 47;
    const r = 40;
    wheel += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${INK}" stroke-width="${R - r + 4.5}"/>`;
    wheel += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${c.accent}" stroke-width="${R - r - 1}"/>`;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * (r + 1);
      const y1 = cy + Math.sin(a) * (r + 1);
      const x2 = cx + Math.cos(a) * (R - 1);
      const y2 = cy + Math.sin(a) * (R - 1);
      wheel += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${darken(c.accent, 0.35)}" stroke-width="2"/>`;
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      wheel += line(`M${cx} ${cy}L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`, INK, 5) +
        line(`M${cx} ${cy}L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`, '#e8eef7', 2);
    }
    // 轮辋上两枚闪电贴纸
    for (const a of [-0.9, 2.2]) {
      const x = cx + Math.cos(a) * ((R + r) / 2);
      const y = cy + Math.sin(a) * ((R + r) / 2);
      wheel += `<path d="M${x + 1} ${y - 6}l-4 6h3l-2 6 5 -7h-3l2 -5z" fill="#ffe14a" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
    }
    wheel += `<circle cx="${cx}" cy="${cy}" r="7" fill="#ffd23f" stroke="${INK}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="2" fill="${INK}"/>`;
    wheel += hiArc(`M${cx - 40} ${cy - 28}q14 -20 36 -22`, 2.6, 0.55);

    // 仓鼠
    const hx = 64;
    const hy = 75;
    const k = 1.32;
    const sc = (inner: string) => `<g transform="translate(${hx} ${hy}) scale(${k}) translate(${-hx} ${-hy})">${inner}</g>`;
    const ears =
      `<circle cx="${hx - 19}" cy="${hy - 18}" r="7.5" fill="${c.body}" stroke="${INK}" stroke-width="3.2"/><circle cx="${hx - 19}" cy="${hy - 18}" r="3.8" fill="#ffb3c0"/>` +
      `<circle cx="${hx + 19}" cy="${hy - 18}" r="7.5" fill="${c.body}" stroke="${INK}" stroke-width="3.2"/><circle cx="${hx + 19}" cy="${hy - 18}" r="3.8" fill="#ffb3c0"/>`;
    const legs =
      `<ellipse cx="${hx - 15}" cy="104" rx="7" ry="4.5" fill="#ffb3c0" stroke="${INK}" stroke-width="2.8" transform="rotate(-20 ${hx - 15} 104)"/>` +
      `<ellipse cx="${hx + 18}" cy="101" rx="7" ry="4.5" fill="#ffb3c0" stroke="${INK}" stroke-width="2.8" transform="rotate(25 ${hx + 18} 101)"/>`;
    const hamD = smoothClosed([
      [hx, hy - 22], [hx + 20, hy - 18], [hx + 28, hy - 2], [hx + 24, hy + 15], [hx, hy + 21], [hx - 24, hy + 15], [hx - 28, hy - 2], [hx - 20, hy - 18],
    ]);
    const ham = shape(hamD, {
      fill: c.body,
      extra:
        `<path d="M${hx - 16} ${hy + 4}q16 -12 32 0q2 14 -16 16q-18 -2 -16 -16z" fill="${c.trim}"/>` +
        `<path d="M${hx - 3} ${hy - 21}q3 6 6 0" fill="none" stroke="${darken(c.body, 0.2)}" stroke-width="2.4" stroke-linecap="round"/>` +
        hiArc(`M${hx - 20} ${hy - 8}q2 -8 9 -11`, 3, 0.6),
    });
    const paws = `<ellipse cx="${hx - 8}" cy="${hy + 10}" rx="4" ry="3" fill="#ffb3c0" stroke="${INK}" stroke-width="2.4"/><ellipse cx="${hx + 8}" cy="${hy + 10}" rx="4" ry="3" fill="#ffb3c0" stroke="${INK}" stroke-width="2.4"/>`;
    const face: FaceStyle = { x: hx, y: hy - 6 * k, s: 0.9 * k, gap: 12, mouthDy: 9, headTopY: 8, markDy: -15 };
    // 跑动的速度线
    const speed = line('M4 100h8M2 108h10M6 92h6', INK, 3, ' stroke-opacity="0.35"');
    return {
      back: grained(frag(stand + cable)),
      spin: grained(frag(wheel)),
      body: grained(merge(frag(sc(legs + ears)), frag(sc(ham.content), ham.defs), frag(sc(paws) + speed))),
      mark: boltMark(face),
      face,
      shadowRx: 46,
      anchors: { headTop: [64, 6], spin: [cx, cy] },
    };
  },

  /** 二师兄牧业：Q 版小猪，大耳朵，扛着小钉耙，龙头戴皇冠 */
  bajie(c) {
    const rake =
      line('M92 112L108 24', INK, 7) + line('M92 112L108 24', c.trim, 3.2) +
      `<g transform="rotate(10 108 22)"><rect x="93" y="16" width="30" height="8" rx="3" fill="#cfd8e6" stroke="${INK}" stroke-width="2.8"/>` +
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<path d="M${95 + i * 3.25} 24v6" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`).join('') +
      `</g>`;
    const earL = shape('M40 56C26 50 16 58 18 74C28 74 38 68 46 60Z', { fill: c.body, sw: 3.4, shadeOffset: [2, -3] });
    const earR = shape('M88 56C102 50 112 58 110 74C100 74 90 68 82 60Z', { fill: c.body, sw: 3.4, shadeOffset: [-2, -3] });
    const earIn = `<path d="M38 60C30 58 24 62 24 69C30 68 36 65 41 61Z" fill="${c.accent}" fill-opacity="0.55"/><path d="M90 60C98 58 104 62 104 69C98 68 92 65 87 61Z" fill="${c.accent}" fill-opacity="0.55"/>`;
    const bodyD = ellipseD(64, 80, 38, 34);
    const main = shape(bodyD, {
      fill: c.body,
      extra:
        `<ellipse cx="64" cy="103" rx="20" ry="9" fill="${lighten(c.body, 0.35)}"/>` +
        `<path d="M50 52q14 -6 28 0" fill="none" stroke="${darken(c.body, 0.15)}" stroke-width="2.4" stroke-linecap="round"/>` +
        hiArc('M34 72q2 -14 14 -20', 4, 0.6),
    });
    const snout =
      `<ellipse cx="64" cy="87" rx="12" ry="8.5" fill="${c.accent}" stroke="${INK}" stroke-width="3"/>` +
      `<ellipse cx="59.5" cy="87" rx="2.2" ry="3.2" fill="${INK}"/><ellipse cx="68.5" cy="87" rx="2.2" ry="3.2" fill="${INK}"/>` +
      hiArc('M57 82q4 -2 8 -1', 1.8, 0.6);
    return {
      back: frag(rake),
      body: grained(merge(earL, earR, frag(earIn + feet([48, 80], c.accent)), main, frag(snout + arm(94, 86, 101, 82, c.body)))),
      acc: crown(64, 44, 1, 4),
      face: { x: 64, y: 72, s: 1, gap: 16, mouthDy: 26, headTopY: 46 },
      shadowRx: 42,
      anchors: { headTop: [64, 26] },
    };
  },

  /** 量子波动：抖动的果冻原子，带色散残影与轨道 */
  quantumjelly(c) {
    const pts: Pt[] = [
      [64, 38], [84, 42], [97, 56], [101, 78], [103, 98], [95, 111], [64, 114], [33, 111], [25, 98], [27, 78], [31, 56], [44, 42],
    ];
    const d = smoothClosed(pts);
    const ghost =
      `<path d="${d}" transform="translate(-5 1)" fill="none" stroke="${c.accent}" stroke-width="3.5" stroke-opacity="0.85"/>` +
      `<path d="${d}" transform="translate(5 -1)" fill="none" stroke="${c.trim}" stroke-width="3.5" stroke-opacity="0.85"/>`;
    const waves = line('M8 64q3 -4 6 0t6 0M108 52q3 -4 6 0t6 0M112 70q3 -4 6 0', c.accent, 2.6);
    const ring = (rot: number, half: 'back' | 'front') => {
      const path = half === 'back' ? 'M-58 0A58 15 0 0 1 58 0' : 'M-58 0A58 15 0 0 0 58 0';
      return `<g transform="translate(64 88) rotate(${rot})">${line(path, INK, 6.5)}${line(path, half === 'back' ? darken(c.accent, 0.1) : c.accent, 3)}</g>`;
    };
    const electron = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="5" fill="${c.trim}" stroke="${INK}" stroke-width="2.6"/><circle cx="${x - 1.5}" cy="${y - 1.5}" r="1.5" fill="#ffffff"/>`;
    const gid = nid('jelly');
    const grad = `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="56" cy="62" r="56"><stop offset="0" stop-color="${lighten(c.body, 0.55)}"/><stop offset="0.6" stop-color="${c.body}"/><stop offset="1" stop-color="${darken(c.body, 0.15)}"/></radialGradient>`;
    const jelly = shape(d, {
      fill: `url(#${gid})`,
      shade: darken(c.body, 0.25),
      extra:
        `<circle cx="84" cy="96" r="4" fill="#ffffff" fill-opacity="0.35"/><circle cx="44" cy="100" r="2.6" fill="#ffffff" fill-opacity="0.35"/><circle cx="90" cy="70" r="2" fill="#ffffff" fill-opacity="0.4"/>` +
        hiArc('M38 60q4 -12 16 -16', 5, 0.75) + hiArc('M34 74l0 4', 4, 0.6),
    });
    jelly.defs.set(gid, grad);
    return {
      back: frag(ghost + waves + ring(16, 'back') + ring(-16, 'back') + electron(110, 74)),
      body: grained(jelly),
      mark: undefined,
      acc: frag(ring(16, 'front') + ring(-16, 'front') + electron(28, 110) + electron(104, 104)),
      face: { x: 64, y: 70, s: 1, gap: 14, mouthDy: 11, headTopY: 40 },
      shadowRx: 42,
      anchors: { headTop: [64, 34] },
    };
  },
};

// ---------------------------------------------------------------- 生成器：名字梗剪影

/**
 * 每个配方 = 一种和名字梗对应的剪影（身体用题材色），角色配饰按 role 统一加在配方给的位置上。
 * 精细度介于精做 6 只和最初的通用形状之间，保证互相不撞形。
 */
interface Recipe {
  back?: string;
  /** 可旋转层（风扇叶、螺旋桨），绕 spinAt 转 */
  spin?: string;
  spinAt?: Pt;
  /** 身体之前画的东西（腿、茎、蒸汽） */
  under?: string;
  body: Frag;
  /** 最上层的额外装饰（和配饰同层） */
  top?: string;
  face: FaceStyle;
  headTop: Pt;
  shadowRx: number;
  shadowX?: number;
  /** 小短手：[肩, 手]；右手如果举旗就用 flag.hand 覆盖 */
  armL?: [Pt, Pt];
  armR?: [Pt, Pt];
  feetX?: number[];
  /** 跟风小旗：hand=举在手里（从 armR 的肩膀伸过去）/ stick=插在身上 */
  flag?: { x: number; y: number; dir: 1 | -1; stick?: boolean; w?: number };
  crown?: [number, number, number, number?];
  /** 领带位置 [x, y, 缩放?]，缩放默认 0.85 */
  tie?: [number, number, number?];
  bandage?: Pt;
  /** 整体缩放（以地面中心 (64, 116) 为原点）：跟风股小一号 */
  scale?: number;
}

/** 一串顺时针的点之间用外凸圆弧相连：云朵、烟团。点的第三个值是弧的平缓度（≥0.5，越大越平） */
function bumpsD(pts: [number, number, number?][], k = 0.62): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * (a[2] ?? k);
    d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${b[0]} ${b[1]}`;
  }
  return d + 'Z';
}

function coinStack(x: number, y: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const yy = y - i * 5;
    s += `<path d="M${x - 10} ${yy}v3a10 4 0 0 0 20 0v-3" fill="#f0a020" stroke="${INK}" stroke-width="2.2"/><ellipse cx="${x}" cy="${yy}" rx="10" ry="4" fill="#ffd23f" stroke="${INK}" stroke-width="2.2"/>`;
  }
  return s;
}

const RECIPES: Record<string, (c: Colors) => Recipe> = {
  /** 算力搬砖：顶着散热风扇的砖块 */
  brickfan(c) {
    let blades = '';
    for (let i = 0; i < 4; i++) blades += `<path d="M0 0C5 -5 13 -10 3 -15C-3 -11 -4 -6 0 0Z" transform="translate(52 38) rotate(${i * 90})" fill="${lighten(c.accent, 0.5)}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
    blades += `<circle cx="52" cy="38" r="4" fill="${c.accent}" stroke="${INK}" stroke-width="2"/>`;
    const brick = shape(rrectD(20, 56, 88, 56, 9), {
      fill: c.body,
      extra: line('M20 76H32M96 76H108M20 96H28M100 96H108M44 56v8M84 104v8', lighten(c.body, 0.4), 2.6) + hiArc('M28 66q2 -5 8 -6', 3.5, 0.6),
    });
    return {
      back: `<rect x="44" y="50" width="16" height="10" fill="#5a6070" stroke="${INK}" stroke-width="2.6"/><circle cx="52" cy="38" r="20" fill="${darken(c.accent, 0.35)}" stroke="${INK}" stroke-width="3.4"/><circle cx="52" cy="38" r="16" fill="#1d2a3a"/>`,
      spin: blades,
      spinAt: [52, 38],
      body: brick,
      face: { x: 64, y: 86, s: 1, gap: 15, headTopY: 56 },
      headTop: [64, 16],
      shadowRx: 42,
      armL: [[26, 92], [14, 102]],
      armR: [[100, 92], [108, 76]],
      feetX: [44, 84],
      flag: { x: 108, y: 76, dir: -1 },
      scale: 0.86,
    };
  },
  /** 光伏追光：花瓣是光伏板的向日葵 */
  sunflower(c) {
    let petals = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 360;
      const r = (a * Math.PI) / 180;
      const x = 64 + Math.cos(r) * 35;
      const y = 54 + Math.sin(r) * 35;
      petals += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a + 90})"><rect x="-7.5" y="-12" width="15" height="24" rx="3" fill="#3d63d6" stroke="${INK}" stroke-width="2.8"/><path d="M-7.5 0H7.5M0 -12V12M-7.5 -6H7.5M-7.5 6H7.5" stroke="#a9c4ff" stroke-width="1.1"/></g>`;
    }
    const under =
      line('M64 80V106', INK, 9) + line('M64 80V106', '#5aa84c', 4.5) +
      `<path d="${leaf(64, 98, 40, 88, 10, -4)}" fill="#7ccf6a" stroke="${INK}" stroke-width="2.6"/><path d="${leaf(64, 102, 88, 92, 10, 4)}" fill="#7ccf6a" stroke="${INK}" stroke-width="2.6"/>`;
    const pot = shape('M48 102H80L76 116H52Z', { fill: '#e9875a', sw: 3.2 });
    const disc = shape(ellipseD(64, 54, 26, 26), { fill: c.body, extra: hiArc('M46 46q3 -8 10 -10', 3.5, 0.6) });
    return {
      under: under + petals,
      body: merge(pot, disc),
      face: { x: 64, y: 55, s: 0.92, gap: 12, headTopY: 28 },
      headTop: [64, 4],
      shadowRx: 22,
      crown: [64, 28, -6, 0.8],
    };
  },
  /** 充电五分钟：电池 */
  battery(c) {
    return {
      under: `<rect x="53" y="32" width="22" height="12" rx="3" fill="#cfd8e6" stroke="${INK}" stroke-width="3.2"/>` + line('M40 110Q24 112 20 100T14 86', INK, 5) + line('M40 110Q24 112 20 100T14 86', '#5a5f73', 2) + `<rect x="8" y="76" width="10" height="10" rx="2" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/>`,
      body: shape(rrectD(36, 40, 56, 74, 12), {
        fill: c.body,
        extra:
          `<rect x="42" y="88" width="44" height="20" rx="5" fill="${darken(c.body, 0.3)}"/>` +
          [0, 1, 2].map((i) => `<rect x="${45 + i * 13.3}" y="91" width="11" height="14" rx="2.5" fill="#eaff9e"/>`).join('') +
          `<path d="M66 44l-6 9h5l-3 8" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
          hiArc('M43 56q0 -8 7 -10', 3.5, 0.55),
      }),
      face: { x: 64, y: 68, s: 0.95, gap: 13, headTopY: 32 },
      headTop: [64, 22],
      shadowRx: 32,
      armL: [[38, 84], [28, 94]],
      armR: [[90, 86], [104, 74]],
      feetX: [50, 78],
      flag: { x: 104, y: 74, dir: -1 },
      scale: 0.86,
    };
  },
  /** 奶茶续命：插着吸管的奶茶杯 */
  cup(c) {
    const straw = line('M74 44L86 10', INK, 9) + line('M74 44L86 10', c.accent, 4.5) + line('M77.5 34l2 -6M81 24l2 -6', '#ffffff', 2.2);
    const lid = shape(rrectD(28, 38, 72, 14, 7), { fill: '#fff6ea', shade: '#e6d6c4', sw: 3.4 });
    const boba = [[46, 104], [56, 108], [68, 106], [80, 103], [62, 99], [50, 97]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2" fill="#5a3a2c"/><circle cx="${x! - 1.2}" cy="${y! - 1.4}" r="1.2" fill="#a07a66"/>`).join('');
    const cup = shape('M32 50H96L88 108Q87 114 80 114H48Q41 114 40 108Z', {
      fill: c.body,
      extra: `<path d="M34 64H94L92.4 76H35.6Z" fill="${c.accent}"/>` + boba + hiArc('M40 58l3 40', 3.5, 0.5),
    });
    return {
      under: straw,
      body: merge(cup, lid),
      face: { x: 64, y: 86, s: 0.92, gap: 13, mouthDy: 10, headTopY: 38 },
      headTop: [64, 8],
      shadowRx: 32,
      armL: [[38, 84], [26, 92]],
      armR: [[90, 84], [102, 92]],
      feetX: [52, 76],
      crown: [46, 32, -14, 0.85],
    };
  },
  /** 预制菜大王：微波炉饭盒 */
  bento(c) {
    const food =
      `<path d="M26 66Q28 48 46 48Q60 50 62 66Z" fill="#ffffff" stroke="${INK}" stroke-width="2"/>` +
      `<rect x="60" y="50" width="16" height="9" rx="4.5" fill="#e8553e" stroke="${INK}" stroke-width="2" transform="rotate(-12 68 54)"/>` +
      `<circle cx="84" cy="54" r="6" fill="#5fb84a" stroke="${INK}" stroke-width="2"/><circle cx="90" cy="58" r="5" fill="#5fb84a" stroke="${INK}" stroke-width="2"/><rect x="85" y="58" width="4" height="8" fill="#9ad66f"/>` +
      `<ellipse cx="100" cy="62" rx="7" ry="4.5" fill="#ffffff" stroke="${INK}" stroke-width="1.8"/><circle cx="100" cy="62" r="2.6" fill="#ffd23f"/>`;
    const lid = `<path d="M16 66Q16 38 64 34Q112 38 112 66Z" fill="#e8f6ff" fill-opacity="0.55" stroke="${INK}" stroke-width="3.4"/>` + hiArc('M28 54q8 -12 24 -14', 3, 0.85);
    const steam = line('M44 30q-5 -6 0 -11t0 -11M64 26q-5 -6 0 -11t0 -11M84 30q-5 -6 0 -11t0 -11', '#c8b6d6', 3.2);
    const box = shape(rrectD(14, 62, 100, 50, 10), {
      fill: c.body,
      extra: `<rect x="14" y="62" width="100" height="9" fill="${lighten(c.body, 0.3)}"/>` + line('M14 71H114', INK, 2.4) + hiArc('M22 80v10', 3, 0.5),
    });
    return {
      under: steam + food,
      body: merge(frag(lid), box),
      face: { x: 64, y: 89, s: 0.95, gap: 15, headTopY: 62, markDy: -14 },
      headTop: [64, 8],
      shadowRx: 48,
      armL: [[20, 92], [8, 100]],
      armR: [[108, 92], [120, 100]],
      feetX: [36, 92],
    };
  },
  /** 熬夜救星药业：额头上推着眼罩的药瓶 */
  pillbottle(c) {
    const cap = shape(rrectD(40, 30, 48, 18, 5), { fill: '#fffaf0', shade: '#e6dccb', sw: 3.2, extra: line('M48 32v14M56 32v14M64 32v14M72 32v14M80 32v14', '#d8cbb4', 1.6) });
    const bottle = shape('M40 48Q34 50 34 60V106Q34 114 42 114H86Q94 114 94 106V60Q94 50 88 48Z', {
      fill: c.body,
      extra:
        `<rect x="38" y="94" width="52" height="16" rx="4" fill="#ffffff" stroke="${darken(c.body, 0.3)}" stroke-width="1.8"/>` +
        `<path d="M47 98h4v-3h4v3h4v4h-4v3h-4v-3h-4z" fill="${c.body}"/>` + line('M64 100h20M64 105h14', '#cfd8e6', 2) +
        hiArc('M40 66v18', 3.5, 0.55),
    });
    const mask =
      line('M34 57H94', INK, 5) + line('M34 57H94', '#4a4a9a', 2.4) +
      `<path d="M40 52Q52 48 64 54Q76 48 88 52Q92 58 86 63Q76 65 64 60Q52 65 42 63Q36 58 40 52Z" fill="#5a5ab0" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
      line('M45 57q6 4 12 0M71 57q6 4 12 0', '#ffffff', 1.8) + line('M48 59l-1 2.5M54 59l1 2.5M74 59l-1 2.5M80 59l1 2.5', '#ffffff', 1.4);
    return {
      body: merge(cap, bottle, frag(mask)),
      face: { x: 64, y: 79, s: 0.95, gap: 13, headTopY: 30 },
      headTop: [64, 8],
      shadowRx: 34,
      armL: [[36, 84], [26, 94]],
      armR: [[92, 84], [102, 94]],
      feetX: [50, 78],
      crown: [64, 26, 8, 0.8],
    };
  },
  /** 板蓝根集团：冲剂袋 */
  packet(c) {
    const d = 'M30 48L34 44L38 48L42 44L46 48L50 44L54 48L58 44L62 48L66 44L70 48L74 44L78 48L82 44L86 48L90 44L94 48L98 44V112L94 116L90 112L86 116L82 112L78 116L74 112L70 116L66 112L62 116L58 112L54 116L50 112L46 116L42 112L38 116L34 112L30 116Z';
    return {
      body: shape(d, {
        fill: c.body,
        extra:
          `<rect x="30" y="52" width="68" height="7" fill="${darken(c.body, 0.18)}"/>` + hiArc('M36 66v20', 3.5, 0.5) +
          `<path d="${leaf(40, 106, 48, 88, 12, 0)}" fill="#5fb84a" stroke="${INK}" stroke-width="2.2"/>` + line('M41 104L46 92', '#d8f5c8', 1.4) +
          `<path d="M78 92q4 -6 8 0t-4 10q-8 -4 -4 -10z" fill="#ffffff" fill-opacity="0.8"/>`,
      }),
      face: { x: 64, y: 74, s: 1, gap: 13, headTopY: 44 },
      headTop: [64, 40],
      shadowRx: 36,
      armL: [[32, 90], [22, 100]],
      armR: [[96, 90], [106, 100]],
      feetX: [48, 80],
    };
  },
  /** 神药概念：冒泡的魔法药水瓶 */
  potion(c) {
    const cid = nid('liq');
    const bulbD = ellipseD(64, 82, 34, 32);
    const bubbles = [[72, 20, 5], [60, 10, 3.6], [80, 5, 2.6], [50, 22, 2.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${lighten(c.body, 0.5)}" stroke="${INK}" stroke-width="2"/>`).join('');
    const neck = shape(rrectD(52, 28, 24, 30, 5), { fill: '#eaf8ff', shade: '#cfe6f2', sw: 3 });
    const cork = shape(rrectD(54, 20, 20, 12, 3), { fill: '#c98a4a', sw: 2.8 });
    const bulb = shape(bulbD, {
      fill: c.body,
      extra:
        `<clipPath id="${cid}"><path d="${bulbD}"/></clipPath><g clip-path="url(#${cid})"><path d="M20 66Q42 58 64 66T110 64V40H20Z" fill="#eaf8ff" fill-opacity="0.92"/><path d="M20 66Q42 58 64 66T110 64" fill="none" stroke="${lighten(c.body, 0.4)}" stroke-width="3"/></g>` +
        `<circle cx="84" cy="98" r="4" fill="#ffffff" fill-opacity="0.45"/><circle cx="44" cy="102" r="2.6" fill="#ffffff" fill-opacity="0.45"/><circle cx="90" cy="80" r="2" fill="#ffffff" fill-opacity="0.5"/>` +
        hiArc('M38 72q2 -10 10 -14', 4, 0.7),
    });
    return {
      under: bubbles,
      body: merge(neck, cork, bulb),
      top: `<path d="${sparkleD(100, 50, 6)}" fill="#fff6b0" stroke="${INK}" stroke-width="1.8"/><path d="${sparkleD(26, 60, 4.5)}" fill="#fff6b0" stroke="${INK}" stroke-width="1.6"/>`,
      face: { x: 64, y: 84, s: 0.95, gap: 13, headTopY: 50, markDy: -20 },
      headTop: [64, 2],
      shadowRx: 30,
      feetX: [],
    };
  },
  /** 割韭菜证券：木柄当身体、头顶弯着一把带尖的镰刀刃，脚边一排被割的韭菜（v0.3 重画：旧版月牙太像月亮） */
  sickle(c) {
    const bladeD =
      'M46 62C36 44 42 22 70 14C96 6 120 22 118 50C117 63 112 74 106 86C108 70 106 52 98 42C90 32 74 28 64 34C56 39 54 50 58 62Z';
    const edge = 'M106 84C107 70 105 53 97.5 43.5C89.5 33.5 74.5 29.5 64.5 35.5';
    const cid = nid('blade');
    const blade = shape(bladeD, {
      fill: c.trim,
      shade: '#aab6ca',
      shadeOffset: [5, 4],
      extra:
        // 开了刃的内弧：一道亮白的刃口 + 细小的锯齿
        `<clipPath id="${cid}"><path d="${bladeD}"/></clipPath><g clip-path="url(#${cid})">` +
        line(edge, '#ffffff', 7) + line(edge, '#8e9bb4', 1.4, ' stroke-dasharray="2 3" transform="translate(2.2 -1)"') +
        `</g>` +
        hiArc('M48 46q2 -20 22 -28', 4, 0.85) + hiArc('M96 16q12 6 16 18', 3, 0.6),
    });
    const glint = `<path d="${sparkleD(112, 30, 7)}" fill="#ffffff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
    const wood = c.body;
    const handle = shape(rrectD(42, 64, 40, 48, 14), {
      fill: wood,
      extra:
        line('M50 74q2 8 0 14M74 76q-2 10 0 18', '#a8682e', 2, ' stroke-opacity="0.7"') +
        `<rect x="42" y="100" width="40" height="5" fill="#b8453a"/>` + line('M42 100H82M42 105H82', INK, 2) +
        hiArc('M47 76v8', 3, 0.5),
    });
    const collar = shape(rrectD(40, 57, 44, 12, 4), {
      fill: c.accent,
      shadeOffset: [-2, -3],
      sw: 3.2,
      extra: `<circle cx="48" cy="63" r="2" fill="${INK}"/><circle cx="76" cy="63" r="2" fill="${INK}"/>`,
    });
    // 被割的韭菜：地上一排茬 + 两截飞起来的叶尖
    const stalk = (x: number, h: number, tilt: number) =>
      `<path d="M${x - 3.5} 116V${116 - h + tilt}L${x + 3.5} ${116 - h - tilt}V116Z" fill="#56c45a" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>` +
      `<path d="M${x - 2.4} 115V108H${x + 2.4}V115Z" fill="#f4f8e8"/>` +
      `<path d="M${x - 2} ${116 - h + tilt + 1.5}L${x + 2} ${116 - h - tilt + 1.5}" stroke="#d8ffc0" stroke-width="2" stroke-linecap="round"/>`;
    const leeks =
      stalk(100, 16, 2) + stalk(110, 20, 2.5) + stalk(120, 15, 2) +
      `<path d="${leaf(112, 92, 124, 78, 7, -2)}" fill="#7ad86a" stroke="${INK}" stroke-width="2"/>` +
      `<path d="${leaf(100, 90, 92, 76, 6, 2)}" fill="#7ad86a" stroke="${INK}" stroke-width="2"/>` +
      line('M118 74l3 -3M88 82l-3 -2', INK, 1.8, ' stroke-opacity="0.5"');
    return {
      under: leeks,
      body: merge(handle, blade, collar, frag(glint)),
      face: { x: 62, y: 84, s: 0.86, gap: 12, mouthDy: 12, headTopY: 62 },
      headTop: [72, 4],
      shadowRx: 26,
      armL: [[44, 88], [30, 98]],
      armR: [[80, 88], [90, 98]],
      feetX: [52, 72],
      crown: [74, 14, 10, 0.68],
    };
  },
  /** 币圈信托：发光的硬币 */
  coin(c) {
    let ticks = '';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ticks += `<path d="M${(64 + Math.cos(a) * 34).toFixed(1)} ${(74 + Math.sin(a) * 34).toFixed(1)}L${(64 + Math.cos(a) * 37).toFixed(1)} ${(74 + Math.sin(a) * 37).toFixed(1)}" stroke="${darken(c.body, 0.3)}" stroke-width="1.6"/>`;
    }
    let rays = `<circle cx="64" cy="74" r="50" fill="#fff3b0" fill-opacity="0.55"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      rays += line(`M${(64 + Math.cos(a) * 46).toFixed(1)} ${(74 + Math.sin(a) * 46).toFixed(1)}L${(64 + Math.cos(a) * 58).toFixed(1)} ${(74 + Math.sin(a) * 58).toFixed(1)}`, '#ffc93a', 4.5);
    }
    return {
      back: rays,
      body: shape(ellipseD(64, 74, 38, 38), {
        fill: c.body,
        extra: ticks + `<circle cx="64" cy="74" r="29" fill="${lighten(c.body, 0.25)}" stroke="${darken(c.body, 0.25)}" stroke-width="2.5"/>` + `<path d="${starD(64, 99, 5)}" fill="${darken(c.body, 0.15)}"/>` + hiArc('M38 60q6 -16 22 -20', 4, 0.6),
      }),
      top: `<path d="${sparkleD(104, 36, 7)}" fill="#ffffff" stroke="${INK}" stroke-width="1.8"/><path d="${sparkleD(22, 104, 5)}" fill="#ffffff" stroke="${INK}" stroke-width="1.6"/>`,
      face: { x: 64, y: 76, s: 0.95, gap: 13, headTopY: 36 },
      headTop: [64, 18],
      shadowRx: 32,
      armL: [[30, 84], [20, 94]],
      armR: [[98, 84], [108, 94]],
      feetX: [52, 76],
    };
  },
  /** 飞天外卖：顶着螺旋桨的外卖箱 */
  propbox(c) {
    const rotor =
      line('M64 44V28', INK, 4) +
      `<ellipse cx="64" cy="26" rx="34" ry="5" fill="#e8eef7" stroke="${INK}" stroke-width="2.8"/>` +
      line('M36 24q8 -3 14 0M80 24q8 -3 14 0', '#ffffff', 2) +
      `<circle cx="64" cy="26" r="4" fill="#ffd23f" stroke="${INK}" stroke-width="2.2"/>`;
    const top = shape('M24 54L36 44H114L104 54Z', { fill: lighten(c.body, 0.35), shade: false, sw: 3.2 });
    const side = shape('M104 54L114 44V102L104 112Z', { fill: darken(c.body, 0.2), shade: false, sw: 3.2 });
    const front = shape(rrectD(22, 54, 82, 58, 7), {
      fill: c.body,
      extra: `<rect x="22" y="98" width="82" height="7" fill="#ffffff" fill-opacity="0.85"/>` + line('M28 60H98', darken(c.body, 0.25), 2, ' stroke-dasharray="3 3"') + hiArc('M28 70v14', 3.5, 0.55),
    });
    return {
      under: rotor,
      body: merge(top, side, front),
      face: { x: 63, y: 80, s: 1, gap: 14, headTopY: 44 },
      headTop: [64, 16],
      shadowRx: 46,
      armL: [[26, 88], [14, 98]],
      feetX: [42, 84],
      crown: [44, 40, -12, 0.75],
    };
  },
  /** 螺旋桨精工：螺旋桨本体，桨叶单独成层可以转（v0.3：桨毂放大，脸更大） */
  propeller(c) {
    let blades = '';
    for (const rot of [0, 180]) {
      blades += `<g transform="translate(64 62) rotate(${rot - 15})"><path d="M22 -9C34 -16 52 -12 61 0C52 9 34 14 22 9Z" fill="${c.body}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/><path d="M51 -8C55 -6 59 -3 61 0C59 3 55 6 51 8Z" fill="#ffd23f"/>${hiArc('M28 -8q12 -4 22 -2', 2.4, 0.6)}</g>`;
    }
    const stand = `<rect x="57" y="88" width="14" height="22" rx="3" fill="#9aa6c0" stroke="${INK}" stroke-width="3"/><ellipse cx="64" cy="112" rx="22" ry="5" fill="#5a6070" stroke="${INK}" stroke-width="3"/>`;
    const hub = shape(ellipseD(64, 62, 30, 30), { fill: lighten(c.body, 0.6), shade: lighten(c.body, 0.3), extra: hiArc('M43 54q3 -11 13 -14', 3.2, 0.7) });
    return {
      spin: blades,
      spinAt: [64, 62],
      under: stand,
      body: hub,
      face: { x: 64, y: 62, s: 1.02, gap: 13, mouthDy: 11, headTopY: 32 },
      headTop: [64, 6],
      shadowRx: 26,
      feetX: [],
      flag: { x: 41, y: 48, dir: -1, stick: true, w: 22 },
      scale: 0.86,
    };
  },
  /** 会飞的车：长翅膀的小车 */
  car(c) {
    const w1 = wing(-1, 30, 70, 0.78);
    const w2 = wing(1, 98, 70, 0.78);
    const wind = line('M2 46q10 -6 20 0t20 0M88 30q8 -5 16 0t16 0', '#ffffff', 2.6, ' stroke-opacity="0.9"');
    const wheels = [42, 88].map((x) => `<circle cx="${x}" cy="104" r="11" fill="#3a3448" stroke="${INK}" stroke-width="3.2"/><circle cx="${x}" cy="104" r="4.5" fill="#cfd8e6"/>`).join('');
    return {
      back: w1.content + w2.content + wind,
      body: merge(
        shape('M22 98Q20 80 32 78L42 56Q46 48 56 48H72Q82 48 86 56L96 78Q108 80 106 98Q106 104 100 104H28Q22 104 22 98Z', {
          fill: c.body,
          extra:
            `<path d="M42 78L48 58Q50 54 56 54H72Q78 54 80 58L86 78Z" fill="#dff4ff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
            `<circle cx="28" cy="88" r="4" fill="#fff6b0" stroke="${INK}" stroke-width="2"/><circle cx="100" cy="88" r="4" fill="#fff6b0" stroke="${INK}" stroke-width="2"/>` +
            hiArc('M30 84q2 -4 6 -5', 3, 0.6),
        }),
        frag(wheels),
      ),
      face: { x: 64, y: 67, s: 0.82, gap: 13, mouthDy: 10, headTopY: 48, noCheeks: true, markDy: -15 },
      headTop: [64, 40],
      shadowRx: 44,
      feetX: [],
    };
  },
  /** 氪金游戏：手柄 + 金币 */
  gamepad(c) {
    const pad = shape('M12 74Q10 50 32 48H96Q118 50 116 74Q118 104 102 106Q92 106 86 94H42Q36 106 26 106Q10 104 12 74Z', {
      fill: c.body,
      extra:
        `<path d="M24 64h6v-6h6v6h6v6h-6v6h-6v-6h-6z" fill="#ffffff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
        `<circle cx="100" cy="60" r="4" fill="#ff5d7a" stroke="${INK}" stroke-width="1.8"/><circle cx="108" cy="68" r="4" fill="#5ee0ff" stroke="${INK}" stroke-width="1.8"/><circle cx="92" cy="68" r="4" fill="#ffd23f" stroke="${INK}" stroke-width="1.8"/><circle cx="100" cy="76" r="4" fill="#7ccf6a" stroke="${INK}" stroke-width="1.8"/>` +
        hiArc('M22 58q4 -6 10 -7', 3, 0.6),
    });
    return {
      body: merge(pad, frag(coinStack(104, 112, 3) + coinStack(22, 112, 2))),
      top: `<g transform="translate(16 30)"><circle r="9" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/><path d="${starD(0, 0.5, 4.5)}" fill="#f0a020"/></g><path d="${sparkleD(30, 20, 4.5)}" fill="#ffffff" stroke="${INK}" stroke-width="1.6"/>`,
      face: { x: 64, y: 72, s: 0.9, gap: 12, headTopY: 48 },
      headTop: [64, 20],
      shadowRx: 48,
      feetX: [],
      crown: [64, 42, -6, 0.88],
    };
  },
  /** 电竞椅：发光的椅子 */
  gamingchair(c) {
    const glow =
      `<rect x="30" y="12" width="68" height="80" rx="22" fill="none" stroke="#5ee0ff" stroke-width="10" stroke-opacity="0.35"/>` +
      `<rect x="32" y="14" width="64" height="76" rx="20" fill="none" stroke="#ff7ad9" stroke-width="3.5" stroke-opacity="0.7"/>`;
    const base =
      line('M64 96V106M64 106L36 112M64 106L92 112M64 106V114', INK, 6) + line('M64 96V106M64 106L36 112M64 106L92 112M64 106V114', '#6b6585', 2.5) +
      [36, 92, 64].map((x) => `<circle cx="${x}" cy="${x === 64 ? 114 : 112}" r="3.6" fill="#3a3448" stroke="${INK}" stroke-width="2"/>`).join('');
    const seat = shape(rrectD(26, 82, 76, 16, 7), { fill: '#3a3354', sw: 3 });
    const arms = shape(rrectD(18, 64, 12, 24, 5), { fill: '#3a3354', sw: 3 });
    const arms2 = shape(rrectD(98, 64, 12, 24, 5), { fill: '#3a3354', sw: 3 });
    const back = shape(rrectD(36, 18, 56, 72, 18), {
      fill: c.body,
      extra:
        `<rect x="40" y="28" width="7" height="52" rx="3.5" fill="#3a3354"/><rect x="81" y="28" width="7" height="52" rx="3.5" fill="#3a3354"/>` +
        `<rect x="50" y="22" width="28" height="10" rx="5" fill="#3a3354" stroke="${INK}" stroke-width="2"/>` +
        `<rect x="41" y="23" width="46" height="62" rx="14" fill="none" stroke="#5ee0ff" stroke-width="2"/>` +
        hiArc('M54 40q3 -4 8 -4', 2.4, 0.5),
    });
    return {
      back: glow,
      under: base,
      body: merge(seat, arms, arms2, back),
      face: { x: 64, y: 58, s: 0.92, gap: 11, headTopY: 18 },
      headTop: [64, 4],
      shadowRx: 38,
      feetX: [],
      flag: { x: 104, y: 66, dir: 1, stick: true, w: 22 },
      scale: 0.86,
    };
  },
  /** 元宇宙：VR 头盔，脸显示在面罩屏幕上 */
  vrhead(c) {
    const gid = nid('vr');
    const screen = `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="48" x2="0" y2="88"><stop offset="0" stop-color="#f0e4ff"/><stop offset="1" stop-color="#bff1ff"/></linearGradient>`;
    const legs = `<rect x="44" y="90" width="11" height="20" rx="4" fill="#3a3354" stroke="${INK}" stroke-width="2.8"/><rect x="73" y="90" width="11" height="20" rx="4" fill="#3a3354" stroke="${INK}" stroke-width="2.8"/>` + feet([48, 80], c.body);
    const shell = shape(rrectD(10, 38, 108, 56, 22), {
      fill: '#3a3354',
      extra:
        `<rect x="20" y="47" width="88" height="40" rx="15" fill="url(#${gid})" stroke="${INK}" stroke-width="2.4"/>` +
        line('M26 60H102M26 70H102M26 80H102', '#ffffff', 1, ' stroke-opacity="0.5"') +
        `<circle cx="16" cy="66" r="3" fill="${c.body}"/><circle cx="112" cy="66" r="3" fill="${c.body}"/>` +
        hiArc('M26 52q4 -2 10 -2', 2.4, 0.9),
    });
    shell.defs.set(gid, screen);
    return {
      back: line('M18 62Q16 18 64 18Q112 18 110 62', INK, 13) + line('M18 62Q16 18 64 18Q112 18 110 62', c.body, 7.5),
      under: legs,
      body: shell,
      face: { x: 64, y: 66, s: 0.85, gap: 15, headTopY: 38, noCheeks: false, markDy: -21 },
      headTop: [64, 12],
      shadowRx: 34,
      feetX: [],
    };
  },
  /** 饲料大王：饲料袋 */
  sack(c) {
    return {
      body: shape('M50 50Q44 42 48 36Q56 42 64 40Q72 42 80 36Q84 42 78 50Q98 62 98 92Q98 114 64 114Q30 114 30 92Q30 62 50 50Z', {
        fill: c.body,
        extra:
          line('M49 51Q64 56 79 51', INK, 3) +
          `<rect x="46" y="90" width="36" height="17" rx="4" fill="${c.accent}" stroke="${INK}" stroke-width="2.4"/>` +
          line('M64 104v-11M64 97l-4 -3M64 97l4 -3M64 101l-4 -3M64 101l4 -3', '#ffffff', 1.8) +
          line('M36 72q2 4 0 8M92 70q-2 4 0 8', darken(c.body, 0.25), 1.6) +
          hiArc('M38 72q2 -12 10 -16', 4, 0.5),
      }),
      under: [[24, 112], [34, 114], [104, 113]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="1.8" fill="#e8c88a" stroke="${INK}" stroke-width="1.2"/>`).join(''),
      face: { x: 64, y: 72, s: 0.95, gap: 13, headTopY: 36 },
      headTop: [64, 22],
      shadowRx: 36,
      armL: [[34, 86], [24, 96]],
      armR: [[92, 86], [104, 78]],
      feetX: [50, 78],
      flag: { x: 104, y: 78, dir: -1 },
      scale: 0.86,
    };
  },
  /** 风口上的猪：被电风扇吹上天的小猪（v0.3：猪放大，脸更大，风扇缩小） */
  fanpig(c) {
    let blades = '';
    for (let i = 0; i < 3; i++) blades += `<path d="M0 0C5 -3.4 12 -10 3.4 -13.6C-1.7 -10 -2.6 -5 0 0Z" transform="translate(20 88) rotate(${i * 120})" fill="#ffffff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
    blades += `<circle cx="20" cy="88" r="3.2" fill="#9fd8ff" stroke="${INK}" stroke-width="1.8"/>`;
    const fanBack =
      `<ellipse cx="20" cy="112" rx="14" ry="4" fill="#9fd8ff" stroke="${INK}" stroke-width="2.6"/>` + line('M20 103V110', INK, 6) + line('M20 103V110', '#dff4ff', 2.4) +
      `<circle cx="20" cy="88" r="16" fill="#dff4ff" fill-opacity="0.7" stroke="${INK}" stroke-width="2.8"/>` +
      line('M40 82q8 -10 18 -9M40 96q10 -6 20 -4M36 68q6 -8 14 -9', '#7fc8ff', 3.2);
    const ears = `<path d="M58 36L52 14L74 28Z" fill="${c.body}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M98 36L104 14L82 28Z" fill="${c.body}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M58 30L55 19L67 27Z" fill="${darken(c.body, 0.12)}"/><path d="M98 30L101 19L89 27Z" fill="${darken(c.body, 0.12)}"/>`;
    const legs = [[60, 80], [70, 86], [86, 86], [96, 80]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="7.5" fill="${darken(c.body, 0.12)}" stroke="${INK}" stroke-width="2.8"/>`).join('');
    const tail = line('M110 54q9 -2 7 -9q-3 -4 -6 0q-2 4 4 6', INK, 5.5) + line('M110 54q9 -2 7 -9q-3 -4 -6 0q-2 4 4 6', c.body, 2.2);
    const pig = shape(ellipseD(78, 54, 34, 30), {
      fill: c.body,
      extra:
        `<ellipse cx="78" cy="65" rx="11" ry="7.5" fill="${darken(c.body, 0.12)}" stroke="${INK}" stroke-width="2.6"/><ellipse cx="74.3" cy="65" rx="2" ry="3" fill="${INK}"/><ellipse cx="81.7" cy="65" rx="2" ry="3" fill="${INK}"/>` +
        hiArc('M52 48q3 -12 14 -16', 3.8, 0.6),
    });
    return {
      back: fanBack,
      spin: blades,
      spinAt: [20, 88],
      under: ears + legs + tail,
      body: pig,
      face: { x: 78, y: 49, s: 1.04, gap: 14, mouthDy: 25, headTopY: 24 },
      headTop: [78, 12],
      shadowRx: 22,
      shadowX: 80,
      feetX: [],
    };
  },
  /** ST摆烂：瘫成一滩的小团子 */
  melt(c) {
    return {
      body: shape('M14 110Q10 100 24 98Q28 84 44 78Q52 70 64 70Q78 70 86 78Q102 84 104 96Q118 98 116 110Q116 116 108 116H22Q14 116 14 110Z', {
        fill: c.body,
        extra: `<path d="M28 106q-2 6 2 8M100 106q2 6 -2 8" fill="none" stroke="${darken(c.body, 0.25)}" stroke-width="2"/>` + hiArc('M44 86q6 -10 16 -12', 4, 0.55),
      }),
      under: `<ellipse cx="108" cy="113" rx="9" ry="3" fill="#7fd3ff" fill-opacity="0.7"/>`,
      face: { x: 64, y: 94, s: 0.92, gap: 13, mouthDy: 10, headTopY: 70 },
      headTop: [64, 62],
      shadowRx: 50,
      feetX: [],
      bandage: [36, 88],
    };
  },
  /** ST退退退：伸手推开、往后退的小人 */
  backpedal(c) {
    const palm = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${c.body}" stroke="${INK}" stroke-width="3"/>` + line(`M${x - 4} ${y - 5}l-2 -4M${x - 1} ${y - 6}l-1 -4M${x + 2} ${y - 6}l1 -4`, INK, 2.2);
    const body = shape(smoothClosed([[66, 50], [82, 56], [90, 78], [96, 104], [82, 114], [48, 114], [34, 104], [42, 78], [50, 56]]), {
      fill: c.body,
      extra: hiArc('M48 72q2 -10 10 -14', 4, 0.55),
    });
    const dust = [[22, 110, 6], [12, 104, 4.5], [30, 104, 3.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e8e0f0" stroke="${INK}" stroke-width="2"/>`).join('');
    return {
      under: dust,
      body: merge(body, frag(arm(42, 84, 18, 74, c.body, false) + arm(44, 96, 20, 98, c.body, false) + palm(16, 74) + palm(18, 98))),
      top:
        line('M86 30Q104 24 112 40', INK, 7) + line('M86 30Q104 24 112 40', '#ff7a7a', 3.5) +
        `<path d="M104 40L114 48L117 35Z" fill="#ff7a7a" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
        line('M100 70h10M102 80h12', INK, 3, ' stroke-opacity="0.35"'),
      face: { x: 66, y: 80, s: 0.95, gap: 13, sweatSide: -1, headTopY: 50 },
      headTop: [66, 40],
      shadowRx: 34,
      feetX: [52, 82],
    };
  },
  // ------------------------------------------------------------ 0.3.0 新增 14 只
  /** 稳稳算力云：一朵大白云坐在机柜上，白马打领带 */
  cloudrack(c) {
    const cloud = shape(
      bumpsD([[24, 88], [14, 66], [28, 44], [50, 30], [78, 28], [101, 40], [114, 64], [104, 88, 2.2]]),
      {
        fill: c.body,
        shade: lighten(c.accent, 0.62),
        shadeOffset: [-4, -6],
        extra: hiArc('M26 60q4 -12 16 -16', 4, 0.9) + hiArc('M58 36q8 -4 16 -2', 3, 0.8),
      },
    );
    const rack = shape(rrectD(32, 80, 64, 32, 6), {
      fill: c.accent,
      extra:
        line('M36 92H92M36 102H92', darken(c.accent, 0.4), 2.4) +
        [[84, 87], [90, 87], [84, 97], [90, 97], [84, 107]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.9" fill="${['#7dff8a', '#ffe14a', '#7dff8a', '#7dff8a', '#5ee0ff'][i]}"/>`).join('') +
        line('M40 87h12M40 97h12M40 107h12', lighten(c.accent, 0.5), 2),
    });
    const sparks = `<path d="${sparkleD(112, 22, 5.5)}" fill="#ffffff" stroke="${INK}" stroke-width="1.6"/><path d="${sparkleD(16, 30, 4)}" fill="#dff7ff" stroke="${INK}" stroke-width="1.5"/>`;
    return {
      body: merge(rack, cloud),
      top: sparks,
      face: { x: 64, y: 60, s: 1.02, gap: 15, headTopY: 30 },
      headTop: [64, 24],
      shadowRx: 42,
      armL: [[22, 74], [10, 86]],
      armR: [[106, 74], [118, 86]],
      feetX: [48, 80],
      tie: [64, 82, 0.8],
    };
  },
  /** 提示词工坊：对话气泡，肚子上是一行带光标的输入框 */
  promptbubble(c) {
    const d = 'M46 34H84Q104 34 104 54V78Q104 98 84 98H54L36 110L40 97Q24 94 24 78V54Q24 34 46 34Z';
    const bubble = shape(d, {
      fill: c.body,
      extra:
        `<rect x="34" y="76" width="60" height="16" rx="6" fill="#ffffff" stroke="${darken(c.body, 0.35)}" stroke-width="2.2"/>` +
        line('M39 80l4 4 -4 4', darken(c.body, 0.45), 2.4) + `<rect x="47" y="79" width="3" height="10" rx="1" fill="${INK}"/>` +
        line('M55 84h10M69 84h6M79 84h8', '#c8d6e6', 2.4) +
        hiArc('M30 54q2 -12 14 -14', 3.5, 0.6),
    });
    const legs = line('M56 98V110M74 98V110', INK, 11) + line('M56 98V110M74 98V110', c.body, 4.5);
    const dots = [44, 56, 68].map((x, i) => `<circle cx="${x}" cy="22" r="${3.4 - i * 0.4}" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`).join('');
    return {
      under: legs,
      body: bubble,
      top: dots + `<path d="${sparkleD(18, 30, 5)}" fill="#fff6b0" stroke="${INK}" stroke-width="1.6"/>`,
      face: { x: 64, y: 58, s: 0.95, gap: 13, mouthDy: 10, headTopY: 34 },
      headTop: [64, 16],
      shadowRx: 34,
      armL: [[28, 72], [16, 82]],
      armR: [[100, 70], [110, 70]],
      feetX: [56, 74],
      flag: { x: 110, y: 66, dir: -1, w: 24 },
      scale: 0.86,
    };
  },
  /** 老实电池：敦实的圆柱电池，正极帽 + 腰带上的加号和叶子，白马打领带 */
  cellbattery(c) {
    const cid = nid('cell');
    const bodyD = 'M32 36V104A32 9 0 0 0 96 104V36A32 9 0 0 1 32 36Z';
    const band = 'M32 82A32 9 0 0 0 96 82V104A32 9 0 0 1 32 104Z';
    const cell = shape(bodyD, {
      fill: c.body,
      extra:
        `<clipPath id="${cid}"><path d="${bodyD}"/></clipPath><g clip-path="url(#${cid})"><path d="${band}" fill="#fff4d6"/><path d="M32 104A32 9 0 0 0 96 104V116H32Z" fill="#e8d9b0"/></g>` +
        line('M32 82A32 9 0 0 0 96 82', INK, 2.6) +
        `<path d="M40 92h8M44 88v8" stroke="${darken(c.body, 0.35)}" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="${leaf(86, 100, 84, 86, 7, -3)}" fill="${c.body}" stroke="${INK}" stroke-width="1.8"/>` +
        hiArc('M39 46V74', 4, 0.55) + hiArc('M88 50v10', 3, 0.35),
    });
    const top = `<ellipse cx="64" cy="36" rx="32" ry="9" fill="${lighten(c.body, 0.3)}" stroke="${INK}" stroke-width="${SW}"/>` +
      `<path d="M54 36V27A10 3 0 0 1 74 27V36A10 3 0 0 1 54 36Z" fill="#dfe6f0" stroke="${INK}" stroke-width="3"/><ellipse cx="64" cy="27" rx="10" ry="3" fill="#ffffff" stroke="${INK}" stroke-width="2.6"/>`;
    return {
      body: merge(cell, frag(top)),
      face: { x: 64, y: 60, s: 1, gap: 14, headTopY: 30 },
      headTop: [64, 20],
      shadowRx: 36,
      armL: [[34, 70], [22, 82]],
      armR: [[94, 70], [106, 82]],
      feetX: [50, 78],
      tie: [64, 78, 0.8],
    };
  },
  /** 风车转转：头顶插着彩色纸风车的小豆子，风车单独成层会转 */
  pinwheel(c) {
    const cols = ['#ffd23f', '#ff7a9a', '#5ee0ff', '#ffffff'];
    let blades = '';
    for (let i = 0; i < 4; i++) {
      blades += `<g transform="translate(64 28) rotate(${i * 90})"><path d="M0 0L-3 -24Q12 -24 20 -9Z" fill="${cols[i]}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M0 0L13 -15" stroke="${INK}" stroke-opacity="0.25" stroke-width="1.6"/></g>`;
    }
    blades += `<circle cx="64" cy="28" r="4" fill="#ff5d7a" stroke="${INK}" stroke-width="2.2"/>`;
    const stick = line('M64 30V68', INK, 7) + line('M64 30V68', '#e8d2a8', 3);
    const bean = shape(smoothClosed([[64, 60], [86, 64], [96, 84], [92, 104], [64, 112], [36, 104], [32, 84], [42, 64]]), {
      fill: c.body,
      extra: hiArc('M42 78q2 -9 10 -12', 3.5, 0.6),
    });
    const breeze = line('M100 30q8 -4 14 0M104 40q6 -3 12 0', '#9fd8ff', 2.6);
    return {
      under: stick,
      spin: blades,
      spinAt: [64, 28],
      body: bean,
      top: breeze,
      face: { x: 64, y: 84, s: 0.95, gap: 13, headTopY: 60 },
      headTop: [64, 2],
      shadowRx: 30,
      armL: [[38, 90], [26, 100]],
      armR: [[90, 90], [104, 84]],
      feetX: [52, 76],
      flag: { x: 104, y: 84, dir: 1, w: 20 },
      scale: 0.86,
    };
  },
  /** 螺蛳粉工厂：一碗红油螺蛳粉，碗边竖着冒绿烟的小烟囱 */
  noodlebowl(c) {
    const fume = (x: number, y: number, r: number) =>
      `<path d="${bumpsD([[x - r, y + r * 0.5], [x - r * 0.6, y - r * 0.6], [x + r * 0.5, y - r * 0.7], [x + r, y + r * 0.4], [x, y + r * 0.9, 1.2]])}" fill="#c6e07a" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const chimney =
      `<rect x="88" y="30" width="16" height="40" fill="#c8553e" stroke="${INK}" stroke-width="3"/>` +
      line('M88 40h16M88 50h16M88 60h16M96 30v10M93 40v10M99 50v10M95 60v10', '#8a3226', 1.6) +
      `<rect x="85" y="26" width="22" height="7" rx="2" fill="#a8463a" stroke="${INK}" stroke-width="2.6"/>` +
      fume(98, 16, 7) + fume(112, 8, 6) + fume(86, 8, 4.5) +
      line('M110 22q2 3 0 6M118 18q2 3 0 6', '#7aa83a', 1.8);
    const soup = `<ellipse cx="64" cy="66" rx="48" ry="11" fill="#e8553e" stroke="${INK}" stroke-width="3.2"/>` +
      line('M28 66q6 -5 12 0t12 0M50 70q6 -5 12 0t12 0M72 64q6 -5 12 0t12 0', '#fff1c9', 3) +
      [[40, 62], [84, 70], [62, 61]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3.2" ry="2.2" fill="#e0a860" stroke="${INK}" stroke-width="1.3"/>`).join('') +
      `<rect x="70" y="58" width="9" height="4" rx="1" fill="#f6e08a" stroke="${INK}" stroke-width="1.2" transform="rotate(-15 74 60)"/>` +
      `<circle cx="32" cy="68" r="2.6" fill="#5fb84a" stroke="${INK}" stroke-width="1.2"/><circle cx="96" cy="64" r="2.6" fill="#5fb84a" stroke="${INK}" stroke-width="1.2"/>` +
      `<circle cx="52" cy="62" r="2.4" fill="none" stroke="#b81f12" stroke-width="1.6"/>`;
    const bowl = shape('M16 66A48 11 0 0 0 112 66Q112 102 74 108H54Q16 102 16 66Z', {
      fill: c.body,
      extra: [36, 50, 64, 78, 92].map((x) => `<circle cx="${x}" cy="${x === 36 || x === 92 ? 96 : 101}" r="2.2" fill="#ffffff" fill-opacity="0.8"/>`).join('') + hiArc('M24 80q4 12 12 18', 3.5, 0.5),
    });
    const foot = `<rect x="46" y="104" width="36" height="9" rx="3" fill="${darken(c.body, 0.25)}" stroke="${INK}" stroke-width="3"/>`;
    return {
      back: chimney,
      under: foot,
      body: merge(frag(soup), bowl),
      face: { x: 64, y: 86, s: 0.9, gap: 13, mouthDy: 10, headTopY: 56 },
      headTop: [64, 8],
      shadowRx: 42,
      armL: [[20, 82], [8, 92]],
      armR: [[108, 82], [120, 92]],
      feetX: [50, 78],
      flag: { x: 34, y: 64, dir: -1, stick: true, w: 22 },
      scale: 0.86,
    };
  },
  /** 云养猫：一朵猫形的云，猫耳 + 胡须 + 云尾巴，小旗插在头顶 */
  cloudcat(c) {
    const ears =
      `<path d="M36 52L40 26L60 44Z" fill="${c.body}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/><path d="M41 46L43 33L53 43Z" fill="${c.accent}"/>` +
      `<path d="M92 52L88 26L68 44Z" fill="${c.body}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/><path d="M87 46L85 33L75 43Z" fill="${c.accent}"/>`;
    const tail = line('M100 92Q122 92 118 70Q116 60 108 62', INK, 13) + line('M100 92Q122 92 118 70Q116 60 108 62', c.body, 7) +
      `<circle cx="108" cy="62" r="6" fill="${c.body}" stroke="${INK}" stroke-width="3"/>` + line('M117 78h-6M118 70h-6', c.accent, 2.4);
    const cloud = shape(bumpsD([[28, 98], [20, 76], [30, 54], [52, 42], [76, 42], [98, 54], [108, 76], [100, 98, 1.6]]), {
      fill: c.body,
      shade: '#e4dcef',
      shadeOffset: [-4, -6],
      extra:
        line('M58 50l2 6M64 48v7M70 50l-2 6', c.accent, 2.6) +
        line('M24 74l12 2M24 84l12 -1M104 74l-12 2M104 84l-12 -1', INK, 1.8, ' stroke-opacity="0.7"') +
        `<ellipse cx="52" cy="98" rx="7" ry="4.5" fill="#ffffff" stroke="${INK}" stroke-width="2.2"/><ellipse cx="76" cy="98" rx="7" ry="4.5" fill="#ffffff" stroke="${INK}" stroke-width="2.2"/>` +
        hiArc('M30 70q2 -12 14 -18', 4, 0.9),
    });
    const puffs = [[36, 110, 6], [62, 113, 7], [90, 110, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#eef6ff" stroke="${INK}" stroke-width="2" stroke-opacity="0.6"/>`).join('');
    const heart = `<path d="M20 32C14 27 14 23 17 22C18.6 21.4 19.6 22.4 20 23.4C20.4 22.4 21.4 21.4 23 22C26 23 26 27 20 32Z" fill="#ff7a9a" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
    return {
      under: puffs + tail + ears,
      body: cloud,
      top: heart,
      face: { x: 64, y: 74, s: 0.95, gap: 13, headTopY: 44 },
      headTop: [64, 22],
      shadowRx: 34,
      feetX: [],
      flag: { x: 66, y: 46, dir: 1, stick: true, w: 22 },
      scale: 0.86,
    };
  },
  /** 护发生发：亮闪闪的光头，头顶冒出三根新头发，滴管在上面滴生发水，披着理发围布 */
  baldsprout(c) {
    const head = shape(ellipseD(64, 80, 32, 31), {
      fill: c.body,
      shade: darken(c.body, 0.12),
      extra: hiArc('M40 66q4 -14 18 -18', 5, 0.95) + `<path d="${sparkleD(46, 56, 5)}" fill="#ffffff"/>`,
    });
    const hairs =
      line('M58 50Q52 40 58 32', INK, 3) + line('M64 49Q66 36 74 30', INK, 3) + line('M70 51Q76 44 84 44', INK, 3) +
      `<path d="${leaf(74, 30, 82, 22, 6, -2)}" fill="#7ad86a" stroke="${INK}" stroke-width="1.8"/>`;
    const dropper =
      `<g transform="translate(30 20) rotate(40)"><rect x="-6" y="-10" width="12" height="16" rx="3" fill="${c.accent}" stroke="${INK}" stroke-width="2.4"/>` +
      `<path d="M-4 -10V-15Q0 -21 4 -15V-10Z" fill="#ff7a9a" stroke="${INK}" stroke-width="2.2"/><path d="M-1.6 6V14H1.6V6Z" fill="#eaf8ff" stroke="${INK}" stroke-width="1.8"/></g>` +
      `<path d="M44 36q-3 4 -3 6a3 3 0 0 0 6 0q0 -2 -3 -6z" fill="${lighten(c.accent, 0.3)}" stroke="${INK}" stroke-width="1.6"/>`;
    const cape = shape('M32 96Q64 112 96 96L102 112Q64 120 26 112Z', { fill: c.accent, sw: 3.2, extra: line('M44 104l-2 8M64 108v6M84 104l2 8', lighten(c.accent, 0.45), 2) });
    return {
      body: merge(head, frag(hairs), cape),
      top: dropper,
      face: { x: 64, y: 80, s: 0.95, gap: 13, headTopY: 50 },
      headTop: [64, 20],
      shadowRx: 34,
      armL: [[34, 100], [22, 106]],
      armR: [[94, 100], [104, 90]],
      feetX: [50, 78],
      flag: { x: 104, y: 90, dir: 1, w: 20 },
      scale: 0.86,
    };
  },
  /** 理财小课堂：戴学士帽的金色小团子，左手教鞭指着身后的上涨曲线黑板 */
  classroom(c) {
    const board =
      `<path d="M14 62L8 84M60 62L66 84" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M14 62L8 84M60 62L66 84" stroke="#b8773a" stroke-width="2.6" stroke-linecap="round"/>` +
      `<rect x="4" y="14" width="66" height="50" rx="5" fill="#b8773a" stroke="${INK}" stroke-width="3.2"/>` +
      `<rect x="10" y="20" width="54" height="38" rx="2" fill="#2f5d4a"/>` +
      line('M15 50L26 42L35 46L48 30L58 25', '#ffffff', 2.6) + line('M51 24L58 25L56 32', '#ffffff', 2.6) +
      line('M14 54H60', '#ffffff', 1.2, ' stroke-opacity="0.5"') +
      `<circle cx="20" cy="27" r="2" fill="#ffd23f"/><circle cx="27" cy="27" r="2" fill="#ffd23f"/>`;
    const blob = shape(ellipseD(70, 88, 29, 25), { fill: c.body, extra: hiArc('M48 82q2 -10 10 -14', 3.5, 0.6) });
    const cap =
      `<rect x="57" y="58" width="26" height="9" rx="2" fill="#2f3b80" stroke="${INK}" stroke-width="2.6"/>` +
      `<path d="M48 58L70 49L92 58L70 66Z" fill="#3b4aa0" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>` +
      line('M70 58L88 61V72', '#ffd23f', 2.2) + `<circle cx="88" cy="73" r="2.6" fill="#ffd23f" stroke="${INK}" stroke-width="1.4"/>`;
    const pointer = line('M36 76L52 38', INK, 5) + line('M36 76L52 38', '#e8c48a', 2.2) + `<circle cx="52" cy="38" r="2.2" fill="#ffffff" stroke="${INK}" stroke-width="1.4"/>`;
    return {
      back: board,
      body: blob,
      top: cap + pointer,
      face: { x: 70, y: 88, s: 0.9, gap: 12, mouthDy: 10, headTopY: 62 },
      headTop: [70, 48],
      shadowRx: 30,
      shadowX: 70,
      armL: [[46, 90], [36, 78]],
      armR: [[96, 90], [108, 82]],
      feetX: [58, 82],
      flag: { x: 108, y: 82, dir: 1, w: 18 },
      scale: 0.86,
    };
  },
  /** 停机坪物业：楼顶画着 H 停机坪、竖着风向袋的小楼，白马打领带 */
  helipad(c) {
    const roof = `<path d="M18 46L30 26H98L110 46Z" fill="#7d849e" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
      `<ellipse cx="64" cy="36" rx="27" ry="7" fill="none" stroke="#ffd23f" stroke-width="3"/>` +
      line('M55.5 31.5L54 40.5M72.5 31.5L74 40.5M54.8 36H73.2', '#ffffff', 3.2) +
      `<circle cx="27" cy="31" r="3" fill="#ff5d5d" stroke="${INK}" stroke-width="1.8"/>`;
    const sock = line('M102 30V8', INK, 4.5) + line('M102 30V8', '#cfd8e6', 1.8) +
      `<path d="M103 9L122 13L121 19L103 17Z" fill="#ff8a3d" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M110 10.5V18.3M116 12V18.8" stroke="#ffffff" stroke-width="2.4"/>`;
    const win = (x: number, y: number, lit: boolean) => `<rect x="${x}" y="${y}" width="10" height="9" rx="1.5" fill="${lit ? '#ffe68a' : '#dff4ff'}" stroke="${darken(c.body, 0.4)}" stroke-width="1.6"/>`;
    let wins = '';
    for (const [i, y] of [52, 65, 78, 91].entries()) wins += win(31, y, i === 1) + win(87, y, i === 2);
    const front = shape(rrectD(26, 46, 76, 66, 5), {
      fill: c.body,
      extra: wins + `<rect x="26" y="46" width="76" height="5" fill="${lighten(c.body, 0.35)}"/>` + hiArc('M45 56v8', 3, 0.5),
    });
    return {
      back: sock,
      body: merge(front, frag(roof)),
      face: { x: 64, y: 68, s: 0.98, gap: 13, headTopY: 34 },
      headTop: [64, 14],
      shadowRx: 44,
      armL: [[28, 80], [16, 92]],
      armR: [[100, 80], [112, 92]],
      feetX: [46, 82],
      tie: [64, 86, 0.8],
    };
  },
  /** 像素老厂：像素风锯齿屋顶的老厂房，烟囱冒方块烟，白马打领带 */
  pixelfactory(c) {
    const st = (x0: number, x1: number) => {
      // 锯齿屋顶的一齿：竖直上去，再一阶一阶下来
      let d = `L${x0} 36`;
      const steps = 4;
      const dx = (x1 - x0) / steps;
      for (let i = 1; i <= steps; i++) d += `H${x0 + dx * i}V${36 + 4 * i}`;
      return d;
    };
    const d = `M22 112V52${st(22, 50)}${st(50, 78)}${st(78, 106)}V112Z`;
    const chimney = `<path d="M90 52V18H102V52" fill="#8a7a9a" stroke="${INK}" stroke-width="3" stroke-linejoin="miter"/>` + line('M90 26H102M90 34H102', '#5a4a6a', 2) +
      [[96, 8, 7], [106, 0, 6], [86, 2, 5]].map(([x, y, s]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#e2dcef" stroke="${INK}" stroke-width="2"/>`).join('');
    const pix = (x: number, y: number, col: string) => `<rect x="${x}" y="${y}" width="8" height="8" fill="${col}" stroke="${darken(c.body, 0.45)}" stroke-width="1.6"/>`;
    const factory = shape(d, {
      fill: c.body,
      extra:
        pix(30, 58, '#ffe68a') + pix(42, 58, '#ffe68a') + pix(78, 58, '#ffe68a') + pix(90, 58, '#bdefff') +
        `<rect x="22" y="104" width="12" height="8" fill="${darken(c.body, 0.25)}"/><rect x="94" y="100" width="12" height="12" fill="${darken(c.body, 0.25)}"/><rect x="34" y="108" width="6" height="4" fill="${darken(c.body, 0.25)}"/>` +
        `<rect x="26" y="52" width="4" height="8" fill="#ffffff" fill-opacity="0.5"/><rect x="26" y="64" width="4" height="4" fill="#ffffff" fill-opacity="0.5"/>`,
      sw: 4,
    });
    const heart = [[0, 0], [4, 0], [12, 0], [16, 0], [-4, 4], [0, 4], [4, 4], [8, 4], [12, 4], [16, 4], [0, 8], [4, 8], [8, 8], [12, 8], [4, 12], [8, 12], [8, 16]]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4"/>`).join('');
    return {
      back: chimney,
      body: factory,
      top: `<g transform="translate(14 14) scale(0.6)" fill="#ff5d7a" stroke="${INK}" stroke-width="1">${heart}</g>`,
      face: { x: 64, y: 80, s: 1, gap: 15, headTopY: 36 },
      headTop: [64, 24],
      shadowRx: 46,
      armL: [[24, 86], [12, 96]],
      armR: [[104, 86], [116, 96]],
      feetX: [44, 84],
      tie: [64, 95, 0.7],
    };
  },
  /** 主播经纪：带环形补光灯的直播麦克风，头顶亮着直播红点，飘着小爱心 */
  livemic(c) {
    const ring = `<circle cx="64" cy="56" r="45" fill="none" stroke="${INK}" stroke-width="13"/><circle cx="64" cy="56" r="45" fill="none" stroke="#fff6e0" stroke-width="8"/>` +
      `<circle cx="64" cy="56" r="45" fill="none" stroke="#ffd98a" stroke-width="2" stroke-dasharray="3 6"/>`;
    const stand = `<path d="M34 66Q34 98 64 98Q94 98 94 66" fill="none" stroke="${INK}" stroke-width="8"/><path d="M34 66Q34 98 64 98Q94 98 94 66" fill="none" stroke="#9aa6c0" stroke-width="3.5"/>` +
      `<rect x="59" y="96" width="10" height="14" fill="#9aa6c0" stroke="${INK}" stroke-width="2.8"/><ellipse cx="64" cy="112" rx="20" ry="4.5" fill="#5a6070" stroke="${INK}" stroke-width="3"/>`;
    const gid = nid('mesh');
    const capD = rrectD(38, 22, 52, 70, 26);
    const mesh = `<clipPath id="${gid}"><path d="M38 22H90V44H38Z"/></clipPath><g clip-path="url(#${gid})" stroke="${lighten(c.body, 0.55)}" stroke-width="1.6">` +
      Array.from({ length: 10 }, (_, i) => `<path d="M${30 + i * 7} 22l14 24M${44 + i * 7} 22l-14 24"/>`).join('') + `</g>`;
    const mic = shape(capD, {
      fill: c.body,
      extra: mesh + `<rect x="38" y="43" width="52" height="5" fill="${lighten(c.body, 0.3)}" stroke="${INK}" stroke-width="2"/>` + hiArc('M44 56v14', 3.5, 0.55),
    });
    const live = `<circle cx="24" cy="18" r="7" fill="#ff4d5e" stroke="${INK}" stroke-width="2.4"/><circle cx="24" cy="18" r="11" fill="none" stroke="#ff4d5e" stroke-width="2" stroke-opacity="0.5"/>`;
    const heart = (x: number, y: number, s: number) =>
      `<path transform="translate(${x} ${y}) scale(${s})" d="M0 6C-7 1 -7 -4 -3.5 -5C-1.6 -5.6 -0.4 -4.4 0 -3.2C0.4 -4.4 1.6 -5.6 3.5 -5C7 -4 7 1 0 6Z" fill="#ff7ad9" stroke="${INK}" stroke-width="${(1.8 / s).toFixed(2)}" stroke-linejoin="round"/>`;
    return {
      back: ring,
      under: stand,
      body: mic,
      top: live + heart(108, 22, 1.2) + heart(116, 40, 0.8),
      face: { x: 64, y: 64, s: 0.92, gap: 12, mouthDy: 10, headTopY: 22 },
      headTop: [64, 10],
      shadowRx: 26,
      armL: [[40, 74], [26, 84]],
      armR: [[88, 74], [104, 70]],
      feetX: [],
      flag: { x: 104, y: 70, dir: 1, w: 20 },
      scale: 0.86,
    };
  },
  /** 冷鲜肉铺：长着猪耳朵和猪鼻子的冷柜，玻璃门上挂霜，白马打领带 */
  fridgepig(c) {
    const ears =
      `<path d="M36 34L30 12L54 26Z" fill="${c.accent}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M38 28L35 18L47 25Z" fill="${darken(c.accent, 0.15)}"/>` +
      `<path d="M92 34L98 12L74 26Z" fill="${c.accent}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M90 28L93 18L81 25Z" fill="${darken(c.accent, 0.15)}"/>`;
    const glassD = rrectD(36, 38, 56, 54, 9);
    const frost = `<path d="M37 47Q42 44 45 39H37ZM91 47Q86 44 83 39H91Z" fill="#ffffff" fill-opacity="0.9"/>` +
      line('M40 88l5 -5M44 89l3 -3M84 88l5 -5', '#ffffff', 1.8, ' stroke-opacity="0.9"');
    const box = shape(rrectD(28, 28, 72, 84, 12), {
      fill: c.body,
      extra:
        `<path d="${glassD}" fill="#cfefff" stroke="${darken(c.body, 0.35)}" stroke-width="2.4"/>` + frost +
        `<rect x="93" y="48" width="4" height="26" rx="2" fill="#9aa6c0" stroke="${INK}" stroke-width="1.8"/>` +
        line('M36 30h8M52 30h4M70 30h6M84 30h6', '#ffffff', 2.2) +
        `<path d="M40 100l6 6M46 100l-6 6M43 98v10M38 103h10" stroke="#7fc8ff" stroke-width="1.8" stroke-linecap="round"/>` +
        hiArc('M33 46v20', 3, 0.6),
    });
    const icicles = [42, 56, 72, 86].map((x, i) => `<path d="M${x - 3} 28L${x} ${36 + (i % 2) * 4}L${x + 3} 28Z" fill="#eaf8ff" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
    const snout = `<ellipse cx="64" cy="74" rx="10" ry="7" fill="${c.accent}" stroke="${INK}" stroke-width="2.6"/><ellipse cx="60.6" cy="74" rx="1.9" ry="2.8" fill="${INK}"/><ellipse cx="67.4" cy="74" rx="1.9" ry="2.8" fill="${INK}"/>`;
    return {
      under: ears,
      body: merge(box, frag(icicles + snout)),
      face: { x: 64, y: 60, s: 0.98, gap: 15, mouthDy: 25, headTopY: 28 },
      headTop: [64, 10],
      shadowRx: 40,
      armL: [[30, 70], [18, 82]],
      armR: [[98, 70], [110, 82]],
      feetX: [46, 82],
      tie: [64, 92, 0.75],
    };
  },
  /** ST画大饼：一张旧大饼，手里的刷子在空中描一个更大的虚线饼 */
  pie(c) {
    const dl = (d: string, w = 2.4) => `<path d="${d}" fill="none" stroke="${INK}" stroke-opacity="0.5" stroke-width="${w}" stroke-dasharray="6 5" stroke-linecap="round"/>`;
    const dream = `<circle cx="66" cy="52" r="48" fill="#fff8e8" fill-opacity="0.45"/>` + dl(`M18 52a48 48 0 1 0 96 0a48 48 0 1 0 -96 0`, 2.8) +
      dl('M28 52a38 38 0 1 0 76 0a38 38 0 1 0 -76 0', 1.8) + dl('M66 52L66 4M66 52L108 76M66 52L24 78', 1.8) +
      `<path d="${sparkleD(20, 14, 6)}" fill="none" stroke="${INK}" stroke-opacity="0.5" stroke-width="1.8" stroke-dasharray="3 2"/>` +
      `<path d="${sparkleD(112, 14, 5)}" fill="none" stroke="${INK}" stroke-opacity="0.5" stroke-width="1.8" stroke-dasharray="3 2"/>`;
    const flat = shape(ellipseD(60, 88, 36, 24), {
      fill: c.body,
      extra:
        `<ellipse cx="60" cy="87" rx="28" ry="17" fill="${lighten(c.body, 0.3)}"/>` +
        [[36, 94, 4], [84, 82, 3.5], [70, 106, 3]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r! * 0.6}" fill="${darken(c.body, 0.2)}"/>`).join('') +
        [[46, 76], [60, 73], [76, 78], [42, 96], [58, 100], [80, 96]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="1.1" fill="#f4ecd8" stroke="${darken(c.body, 0.35)}" stroke-width="0.6"/>`).join('') +
        line('M90 80l-5 5 2 4 -4 4', darken(c.body, 0.45), 1.6) + hiArc('M30 82q4 -9 14 -12', 3.2, 0.4),
    });
    const brush = line('M98 84L114 52', INK, 6) + line('M98 84L114 52', '#a89478', 2.6) +
      `<path d="M111 52L117 55L121 44Q118 38 114 41Z" fill="#6a6470" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const dust = [[22, 108, 4], [104, 110, 3], [112, 104, 2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#d8d2c8" stroke="${INK}" stroke-width="1.6" stroke-opacity="0.6"/>`).join('');
    return {
      back: dream,
      under: dust,
      body: flat,
      top: brush,
      face: { x: 60, y: 84, s: 0.92, gap: 13, mouthDy: 10, headTopY: 60 },
      headTop: [60, 52],
      shadowRx: 34,
      shadowX: 62,
      armL: [[28, 92], [16, 100]],
      armR: [[92, 90], [100, 82]],
      feetX: [46, 74],
      bandage: [36, 68],
    };
  },
  /** ST失联中：没信号的旧手机，信号格全空打叉，角上结了蜘蛛网，头顶冒问号 */
  deadphone(c) {
    const screen = '#d8dce0';
    const bars = [0, 1, 2, 3].map((i) => `<rect x="${43 + i * 4.5}" y="${42 - i * 2.5}" width="3" height="${3 + i * 2.5}" fill="none" stroke="#6a6e76" stroke-width="1.3"/>`).join('');
    const phone = shape(rrectD(34, 18, 60, 94, 12), {
      fill: c.body,
      extra:
        `<rect x="40" y="28" width="48" height="66" rx="6" fill="${screen}" stroke="${darken(c.body, 0.4)}" stroke-width="2"/>` + bars +
        line('M62 34l5 5M67 34l-5 5', '#c86a6a', 2.2) +
        line('M80 30l-6 12 5 4 -8 12M74 42l-8 -2', '#9aa0a8', 1.4) +
        `<rect x="56" y="22" width="16" height="3" rx="1.5" fill="${darken(c.body, 0.35)}"/><circle cx="64" cy="103" r="4.5" fill="${lighten(c.body, 0.2)}" stroke="${darken(c.body, 0.4)}" stroke-width="1.8"/>` +
        hiArc('M38 32v12', 2.6, 0.5),
    });
    const web = `<g stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.2" fill="none" stroke-linecap="round">` +
      `<path d="M94 18L112 14M94 18L110 30M94 18L100 34"/><path d="M103 16Q104 22 106 24Q102 25 98 26M108 15Q109 24 109 28Q104 30 100 31"/></g>` +
      `<g stroke="${INK}" stroke-opacity="0.35" stroke-width="0.8" fill="none"><path d="M94 18L112 14M94 18L110 30M94 18L100 34"/></g>`;
    const q = `<circle cx="18" cy="28" r="11" fill="#f2f2f0" stroke="${INK}" stroke-width="2.4"/>` +
      line('M14 25Q14 20 18.5 20Q23 20 23 24.5Q23 27.5 18.5 29V31.5', INK, 2.6) + `<circle cx="18.5" cy="35.5" r="1.6" fill="${INK}"/>` +
      `<circle cx="26" cy="42" r="3" fill="#f2f2f0" stroke="${INK}" stroke-width="1.8"/>`;
    return {
      body: phone,
      top: web + q,
      face: { x: 64, y: 66, s: 0.88, gap: 12, mouthDy: 11, headTopY: 20 },
      headTop: [64, 12],
      shadowRx: 34,
      armL: [[36, 80], [24, 92]],
      armR: [[92, 80], [104, 92]],
      feetX: [52, 76],
      bandage: [44, 100],
    };
  },
};

function genBody(spec: StockSpec, c: Colors): Built {
  const fn = RECIPES[spec.shape ?? ''];
  if (!fn) throw new Error(`unknown shape ${spec.shape} (${spec.id})`);
  const r = fn(c);
  const role = spec.role;
  const face: FaceStyle = { ...r.face };
  if (role === 'st') face.sweatSide = -1;
  let arms = '';
  const fl = role === 'follower' ? r.flag : undefined;
  if (r.armL) arms += arm(r.armL[0][0], r.armL[0][1], r.armL[1][0], r.armL[1][1], c.body);
  if (r.armR) {
    if (fl && !fl.stick) arms += arm(r.armR[0][0], r.armR[0][1], fl.x, fl.y, c.body, false);
    else arms += arm(r.armR[0][0], r.armR[0][1], r.armR[1][0], r.armR[1][1], c.body);
  }
  const body = merge(frag(arms + feet(r.feetX ?? [50, 78], c.body) + (r.under ?? '')), r.body);

  let accF = frag(r.top ?? '');
  let headTop = r.headTop;
  let hand: Pt | undefined;
  switch (role) {
    case 'leader': {
      const [x, y, rot, s] = r.crown ?? [r.headTop[0], r.headTop[1] + 8, -8, 0.9];
      accF = merge(accF, crown(x, y, s ?? 0.9, rot));
      break;
    }
    case 'follower':
      if (!fl) throw new Error(`follower ${spec.id} needs flag`);
      accF = merge(accF, flag(fl.x, fl.y, '#ffcf3a', fl.dir, fl.stick, fl.w));
      hand = [fl.x, fl.y];
      headTop = [headTop[0], Math.min(headTop[1], fl.y - (fl.stick ? 46 : 54))];
      break;
    case 'bluechip': {
      const [tx, ty, ts] = r.tie ?? [face.x, face.y + 20 * face.s];
      accF = merge(accF, tie(tx, ty, '#3047a8', ts ?? 0.85));
      break;
    }
    case 'st': {
      const [bx, by] = r.bandage ?? [r.headTop[0] + 16, r.headTop[1] + 12];
      accF = merge(accF, frag(bandage(bx, by)));
      break;
    }
    case 'meme':
      break;
  }
  // 整体缩放：所有层包一层以地面中心为原点的变换，脸和锚点同步换算
  const k = r.scale ?? 1;
  const T = (f: Frag | undefined): Frag | undefined =>
    f && k !== 1 ? frag(`<g transform="matrix(${k} 0 0 ${k} ${r2(64 * (1 - k))} ${r2(GROUND * (1 - k))})">${f.content}</g>`, f.defs) : f;
  const P = (p: Pt): Pt => [r2(64 + (p[0] - 64) * k), r2(GROUND + (p[1] - GROUND) * k)];
  if (k !== 1) {
    const [fx, fy] = P([face.x, face.y]);
    face.x = fx;
    face.y = fy;
    face.s = r2(face.s * k, 1000);
    if (face.headTopY !== undefined) face.headTopY = P([0, face.headTopY])[1];
  }
  const spinAt = r.spinAt ? P(r.spinAt) : undefined;
  return {
    back: T(r.back ? grained(frag(r.back)) : undefined),
    spin: T(r.spin ? grained(frag(r.spin)) : undefined),
    body: T(grained(body))!,
    mark: role === 'meme' ? boltMark(face) : undefined,
    acc: accF.content ? T(accF) : undefined,
    face,
    shadowRx: r.shadowRx * k,
    shadowX: r.shadowX === undefined ? undefined : P([r.shadowX, 0])[0],
    anchors: { headTop: P(headTop), ...(hand ? { hand: P(hand) } : {}), ...(spinAt ? { spin: spinAt } : {}) },
  };
}

function r2(n: number, q = 100): number {
  return Math.round(n * q) / q;
}

// ---------------------------------------------------------------- 输出

export interface StockOut {
  id: string;
  files: Map<string, string>; // 相对 stocks/ 的路径 → SVG
  manifest: Record<string, unknown>;
}

function resolveColors(spec: StockSpec): Colors {
  const theme = THEME_COLORS[spec.theme];
  if (!theme) throw new Error(`unknown theme ${spec.theme}`);
  const body = spec.colors?.body ?? theme.main;
  return {
    body,
    accent: spec.colors?.accent ?? (spec.colors?.body ? theme.main : lighten(theme.main, 0.45)),
    trim: spec.colors?.trim ?? darken(theme.main, 0.35),
  };
}

function shadow(rx: number, x = 64): Frag {
  return frag(`<ellipse cx="${x}" cy="${GROUND}" rx="${rx}" ry="5.5" fill="${INK}" fill-opacity="0.2"/>`);
}

export function buildStock(spec: StockSpec): StockOut {
  const c = resolveColors(spec);
  let b: Built;
  if (spec.hero) {
    const fn = spec.body ? HERO_BODIES[spec.body] : undefined;
    if (!fn) throw new Error(`unknown hero body ${spec.body}`);
    b = fn(c);
    // 精做的配方按角色补上统一配饰（妖股的额头闪电）
    if (spec.role === 'meme' && !b.mark) b.mark = boltMark(b.face);
  } else {
    b = genBody(spec, c);
  }
  const fs = b.face;
  const files = new Map<string, string>();
  const doc = (f: Frag) => svgDoc(CANVAS, CANVAS, f);
  const P = `${spec.id}/parts/`;

  const layers: { name: string; file: string; z: number; when?: string }[] = [];
  let z = 0;
  const put = (name: string, f: Frag | undefined, opts: { gray?: boolean; when?: string } = {}) => {
    if (!f || !f.content) return;
    files.set(`${P}${name}.svg`, doc(f));
    if (opts.gray) files.set(`${P}${name}_gray.svg`, grayscaleSvg(doc(f)));
    layers.push({ name, file: `parts/${name}.svg`, z: z++, ...(opts.when ? { when: opts.when } : {}) });
  };
  put('shadow', shadow(b.shadowRx, b.shadowX));
  put('back', b.back, { gray: true });
  put('spin', b.spin, { gray: true });
  put('body', b.body, { gray: true });
  put('mark', b.mark, { gray: true });
  put('cheeks', cheeks(fs), { when: '除 delisted 外' });
  // 五官：每种表情一套；同一 z 位置互斥
  const eyeZ = z++;
  const mouthZ = z++;
  for (const e of EXPRESSIONS) {
    files.set(`${P}eyes_${e}.svg`, doc(eyes(e, fs)));
    files.set(`${P}mouth_${e}.svg`, doc(mouth(e, fs)));
  }
  files.set(`${P}eyes_blink.svg`, doc(eyesBlink(fs)));
  layers.push({ name: 'eyes', file: 'parts/eyes_<expr|blink>.svg', z: eyeZ });
  layers.push({ name: 'mouth', file: 'parts/mouth_<expr>.svg', z: mouthZ });
  put('acc', b.acc, { gray: true });
  const fxZ = z++;
  const fxExprs: Expr[] = [];
  for (const e of EXPRESSIONS) {
    const f = faceFx(e, fs);
    if (f.content) {
      files.set(`${P}fx_${e}.svg`, doc(f));
      fxExprs.push(e);
    }
  }
  layers.push({ name: 'fx', file: 'parts/fx_<expr>.svg', z: fxZ, when: fxExprs.join(' / ') });

  // 合成图
  for (const e of EXPRESSIONS) {
    const parts = merge(
      shadow(b.shadowRx, b.shadowX), b.back, b.spin, b.body, b.mark,
      e === 'delisted' ? undefined : cheeks(fs),
      eyes(e, fs), mouth(e, fs), b.acc, faceFx(e, fs),
    );
    let svg = doc(parts);
    if (e === 'delisted') svg = grayscaleSvg(svg);
    files.set(`${spec.id}/${e}.svg`, svg);
  }
  // 眨眼帧：与 calm 完全相同，只把眼睛换成闭眼（墨镜款是一道反光）
  files.set(
    `${spec.id}/blink.svg`,
    doc(merge(shadow(b.shadowRx, b.shadowX), b.back, b.spin, b.body, b.mark, cheeks(fs), eyesBlink(fs), mouth('calm', fs), b.acc)),
  );

  const g = fs.gap ?? 14;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const manifest = {
    id: spec.id,
    name: spec.name,
    theme: spec.theme,
    role: spec.role,
    hero: !!spec.hero,
    recipe: spec.hero ? { body: spec.body } : { shape: spec.shape ?? 'round', motif: spec.motif ?? null },
    colors: c,
    composite: { ...Object.fromEntries(EXPRESSIONS.map((e) => [e, `${spec.id}/${e}.svg`])), blink: `${spec.id}/blink.svg` },
    layers,
    anchors: {
      ground: [64, GROUND],
      face: [r1(fs.x), r1(fs.y)],
      eyes: [r1(fs.x), r1(fs.y)],
      eyeL: [r1(fs.x - g * fs.s), r1(fs.y)],
      eyeR: [r1(fs.x + g * fs.s), r1(fs.y)],
      mouth: [r1(fs.x), r1(fs.y + (fs.mouthDy ?? 11) * fs.s)],
      headTop: b.anchors.headTop,
      ...(b.anchors.hand ? { hand: b.anchors.hand } : {}),
      ...(b.anchors.spin ? { spin: b.anchors.spin } : {}),
    },
    faceScale: fs.s,
  };
  return { id: spec.id, files, manifest };
}

export { SW, sparkleD };
