/**
 * v3 美术的公共工具：调色板、颜色运算、SVG 片段拼装、纸张颗粒滤镜。
 *
 * 约定（与 0.2 相同）：不用 <text>；渐变一律 gradientUnits="userSpaceOnUse"；
 * 每个文件自带 defs，id 只要求在单个文件内唯一。
 */

/** 描边色：深梅子棕，不用纯黑 */
export const INK = '#3a2634';
/** 描边粗细（128 画布上 4px，缩到 96px 约 3px） */
export const SW = 4;
export const WHITE = '#fffdf7';
export const BLUSH = '#ff8fa3';
export const TEAR = '#7fd3ff';

/** 题材主色（设计稿 2.1 节的 8 个题材） */
export const THEME_COLORS: Record<string, { main: string; name: string }> = {
  ai: { main: '#1fbfe8', name: 'AI' },
  newenergy: { main: '#9ad13c', name: '新能源' },
  consumer: { main: '#ff7a33', name: '大消费' },
  pharma: { main: '#2fc49a', name: '医药' },
  finance: { main: '#f6c02f', name: '金融' },
  lowalt: { main: '#4f7cff', name: '低空经济' },
  gaming: { main: '#cc4fe0', name: '游戏传媒' },
  pig: { main: '#ff9cc8', name: '养猪' },
};

// ---------- 颜色 ----------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
export const darken = (c: string, t: number) => mix(c, '#2a1a2a', t);

/** 退市用的灰：按亮度去色，再略偏冷 */
export function grayOf(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const v = 70 + l * 0.62;
  return rgbToHex(v - 4, v, v + 8);
}

/** 把整段 SVG 里的 #rrggbb 全部换成灰色（退市态） */
export function grayscaleSvg(s: string): string {
  return s.replace(/#[0-9a-fA-F]{6}\b/g, (m) => grayOf(m));
}

// ---------- 片段 ----------

/** 一个可拼装的 SVG 片段：defs 按 id 去重，content 按顺序叠加 */
export interface Frag {
  defs: Map<string, string>;
  content: string;
}

export function frag(content = '', defs?: Map<string, string>): Frag {
  return { defs: defs ?? new Map(), content };
}

export function merge(...fs: (Frag | undefined | null | false)[]): Frag {
  const out = frag();
  for (const f of fs) {
    if (!f) continue;
    for (const [k, v] of f.defs) out.defs.set(k, v);
    out.content += f.content;
  }
  return out;
}

export function svgDoc(w: number, h: number, f: Frag): string {
  const defs = f.defs.size ? `<defs>${[...f.defs.values()].join('')}</defs>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${defs}${f.content}\n</svg>\n`;
}

let uid = 0;
/** 每个生成分组开始前归零，使各组输出与运行顺序无关（build.ts 调用） */
export function resetIds(): void {
  uid = 0;
}
/** 生成文件内唯一的 id */
export function nid(prefix: string): string {
  uid += 1;
  return `${prefix}${uid.toString(36)}`;
}

// ---------- 常用滤镜与图形 ----------

/** 纸张颗粒：在图形自身的不透明区域内叠一层细噪点 */
export function grainDef(strength = 0.16, freq = 0.85, id = 'grain', region: [number, number, number, number] = [-8, -8, 144, 144]): [string, string] {
  // 滤镜区域用 userSpaceOnUse：默认的 objectBoundingBox 不含描边，会把外描边裁掉
  const [rx, ry, rw, rh] = region;
  return [
    id,
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="${rx}" y="${ry}" width="${rw}" height="${rh}" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="7" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0 0.2  ${(strength * 3).toFixed(3)} 0 0 0 ${(-strength * 1.1).toFixed(3)}" result="nc"/>` +
      `<feComposite in="nc" in2="SourceAlpha" operator="in" result="ng"/>` +
      `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ng"/></feMerge></filter>`,
  ];
}

/** 用颗粒滤镜包住一个片段 */
export function grained(f: Frag, strength = 0.07, region?: [number, number, number, number]): Frag {
  const tag = region ? `r${region.join('_').replace(/-/g, 'm')}` : '';
  const [id, def] = grainDef(strength, 0.85, `grain${Math.round(strength * 100)}${tag}`, region);
  const out = frag(`<g filter="url(#${id})">${f.content}</g>`, new Map(f.defs));
  out.defs.set(id, def);
  return out;
}

export interface ShapeOpts {
  fill: string;
  /** 暗部颜色；不给则按 fill 自动加深 */
  shade?: string | false;
  /** 暗部偏移（光从左上来） */
  shadeOffset?: [number, number];
  stroke?: string;
  sw?: number;
  /** 左上角高光弧线 */
  hi?: string | false;
  extra?: string;
}

/**
 * 卡通实心形状：底色 + 右下暗部月牙 + 描边。暗部用 clipPath 把同形状平移后挖出来。
 */
export function shape(d: string, o: ShapeOpts): Frag {
  const f = frag();
  const sw = o.sw ?? SW;
  const stroke = o.stroke ?? INK;
  let body = `<path d="${d}" fill="${o.shade === false ? o.fill : (o.shade ?? darken(o.fill, 0.22))}"/>`;
  if (o.shade !== false) {
    const cid = nid('c');
    const [dx, dy] = o.shadeOffset ?? [-5, -6];
    f.defs.set(cid, `<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
    body += `<g clip-path="url(#${cid})"><path d="${d}" transform="translate(${dx} ${dy})" fill="${o.fill}"/></g>`;
  }
  if (o.extra) body += o.extra;
  body += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  f.content = body;
  return f;
}

/** 椭圆转路径，方便统一走 shape() */
export function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0z`;
}

export function rrectD(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr} ${y}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}h${-(w - 2 * rr)}a${rr} ${rr} 0 0 1 ${-rr} ${-rr}v${-(h - 2 * rr)}a${rr} ${rr} 0 0 1 ${rr} ${-rr}z`;
}

/** 高光：一段白色圆头弧线 */
export function hiArc(d: string, w = 3.5, op = 0.7): string {
  return `<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** 平滑闭合曲线（Catmull-Rom → 三次贝塞尔），用于果冻、云、火苗等有机形状 */
export function smoothClosed(pts: [number, number][], tension = 1): string {
  const n = pts.length;
  const p = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${p(0)[0].toFixed(2)} ${p(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}

/** 简单确定性随机数（mulberry32），保证每次生成结果一致 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 五角星路径 */
export function starD(cx: number, cy: number, r: number, inner = 0.45, n = 5, rot = -90): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    d += `${i === 0 ? 'M' : 'L'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}

/** 四角闪光 */
export function sparkleD(cx: number, cy: number, r: number): string {
  const k = r * 0.22;
  return `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
}
