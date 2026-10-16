/**
 * 长线系统的界面素材：难度徽记、成就框与成就图标、图鉴小件。
 *
 *   difficulty/<1..8>.svg          96×96，市场环境徽记，由温和到凶险，带数字（数字是路径，不用 <text>）
 *   achievements/frame_<bronze|silver|gold|locked>.svg   96×96 成就章框，中间留 64×64 的图标窗口
 *   achievements/icon_<name>.svg   64×64 成就图标（透明底），画面层把它居中叠在框上（偏移 16,16）
 *   ui/codex_*.svg                 图鉴界面元素，见 README
 */
import { INK, WHITE, type Frag, darken, ellipseD, frag, grained, hiArc, lighten, merge, rrectD, shape, smoothClosed, sparkleD, starD, svgDoc } from './lib/svg.ts';

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}
function rod(d: string, color: string, w: number): string {
  return line(d, INK, w + 3.6) + line(d, color, w);
}

// ---------------------------------------------------------------- 数字（描边路径字形，12×17 格）

const DIGITS: Record<string, string> = {
  '0': 'M6 1Q1.5 1 1.5 8.5Q1.5 16 6 16Q10.5 16 10.5 8.5Q10.5 1 6 1Z',
  '1': 'M3 4.5L6.8 1.5V16',
  '2': 'M1.8 5Q2.2 1 6 1Q10 1 10 5Q10 8 6.5 11L1.8 16H10.6',
  '3': 'M2 2.6Q3.8 1 6 1Q10 1 10 4.6Q10 8 6 8.2Q10.6 8.4 10.6 12.1Q10.6 16 6 16Q3 16 1.6 14.2',
  '4': 'M8.2 16V1.4L1.2 11.6H11',
  '5': 'M10 1.4H3.2L2.2 7.8Q4 6.6 6 6.6Q10.6 6.6 10.6 11.3Q10.6 16 6 16Q3 16 1.6 14.2',
  '6': 'M9.6 2.2Q8 1 6 1Q1.6 1 1.6 9Q1.6 16 6 16Q10.6 16 10.6 11.6Q10.6 7.2 6 7.2Q3.2 7.2 1.7 9.6',
  '7': 'M1.6 1.4H10.6L4.6 16',
  '8': 'M6 8.2Q2 8.2 2 4.6Q2 1 6 1Q10 1 10 4.6Q10 8.2 6 8.2Q1.6 8.2 1.6 12.1Q1.6 16 6 16Q10.4 16 10.4 12.1Q10.4 8.2 6 8.2Z',
  '9': 'M2.4 14.8Q4 16 6 16Q10.4 16 10.4 8Q10.4 1 6 1Q1.4 1 1.4 5.4Q1.4 9.8 6 9.8Q8.8 9.8 10.3 7.4',
};

/** 画一个数字：中心 (cx, cy)，字高约 17*s；外描深色、内填 color */
export function digit(ch: string, cx: number, cy: number, s: number, color: string, ink = INK): string {
  const d = DIGITS[ch];
  if (!d) throw new Error(`no glyph ${ch}`);
  const t = `translate(${cx - 6 * s} ${cy - 8.5 * s}) scale(${s})`;
  return `<g transform="${t}"><path d="${d}" fill="none" stroke="${ink}" stroke-width="${(5.6).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// ---------------------------------------------------------------- 难度徽记

export const DIFFICULTY_NAMES = ['慢牛', '震荡', '熊出没', '消息失真', '强监管', '股灾', '通胀', '末日'];

interface Diff {
  bg: string;
  rim: string;
  emblem: () => string;
}

const bullHead = (): string =>
  // 慢牛：憨憨的小牛脸 + 一根缓缓向上的线
  line('M22 28Q14 22 18 14M74 28Q82 22 78 14', INK, 7) + line('M22 28Q14 22 18 14M74 28Q82 22 78 14', '#fffaf0', 3.4) +
  `<ellipse cx="25" cy="34" rx="7" ry="4.5" fill="#c98a4a" stroke="${INK}" stroke-width="2.6" transform="rotate(-20 25 34)"/><ellipse cx="71" cy="34" rx="7" ry="4.5" fill="#c98a4a" stroke="${INK}" stroke-width="2.6" transform="rotate(20 71 34)"/>` +
  `<path d="${ellipseD(48, 38, 20, 18)}" fill="#e0a868" stroke="${INK}" stroke-width="3"/>` +
  `<ellipse cx="48" cy="48" rx="13" ry="8" fill="#ffd2b0" stroke="${INK}" stroke-width="2.6"/><ellipse cx="43.5" cy="47.5" rx="1.8" ry="2.4" fill="${INK}"/><ellipse cx="52.5" cy="47.5" rx="1.8" ry="2.4" fill="${INK}"/>` +
  `<circle cx="41" cy="35" r="2.6" fill="${INK}"/><circle cx="55" cy="35" r="2.6" fill="${INK}"/><circle cx="40.2" cy="34.2" r="0.9" fill="${WHITE}"/><circle cx="54.2" cy="34.2" r="0.9" fill="${WHITE}"/>` +
  `<path d="M42 21q6 5 12 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;

const bearHead = (): string =>
  `<circle cx="31" cy="24" r="8" fill="#8a5a3a" stroke="${INK}" stroke-width="3"/><circle cx="65" cy="24" r="8" fill="#8a5a3a" stroke="${INK}" stroke-width="3"/><circle cx="31" cy="24" r="3.6" fill="#d9a07a"/><circle cx="65" cy="24" r="3.6" fill="#d9a07a"/>` +
  `<path d="${ellipseD(48, 40, 21, 19)}" fill="#8a5a3a" stroke="${INK}" stroke-width="3"/>` +
  `<ellipse cx="48" cy="48" rx="10" ry="7.5" fill="#e8c49a" stroke="${INK}" stroke-width="2.4"/><ellipse cx="48" cy="45.5" rx="4" ry="2.8" fill="${INK}"/>` +
  line('M48 48v3M44 52q4 2 8 0', INK, 2) +
  // 不怀好意的眼神
  line('M36 31l7 3M60 31l-7 3', INK, 2.8) + `<circle cx="40" cy="37" r="2.6" fill="${INK}"/><circle cx="56" cy="37" r="2.6" fill="${INK}"/>`;

const DIFFS: Diff[] = [
  { bg: '#9ad86a', rim: '#5aa83a', emblem: () => bullHead() + rod('M62 54L72 46L80 48', '#ff5a4a', 2.6) },
  {
    bg: '#5ccdd0', rim: '#2f9aa0',
    emblem: () => rod('M14 40L24 26L34 50L44 22L54 52L64 26L74 46L82 34', WHITE, 4) +
      `<path d="M14 58h68" stroke="${WHITE}" stroke-opacity="0.6" stroke-width="2.4" stroke-dasharray="3 4" stroke-linecap="round"/>`,
  },
  { bg: '#f2a548', rim: '#c0702a', emblem: () => bearHead() + rod('M70 50L78 58L80 50', '#3cbf6a', 2.4) },
  {
    bg: '#a68ae6', rim: '#6f55b8',
    emblem: () => {
      const b = 'M24 18H72Q80 18 80 26V44Q80 52 72 52H42L30 62L32 52H24Q16 52 16 44V26Q16 18 24 18Z';
      return `<path d="${b}" transform="translate(-4 2)" fill="none" stroke="#5ee0ff" stroke-width="3" stroke-opacity="0.9"/>` +
        `<path d="${b}" transform="translate(4 -2)" fill="none" stroke="#ff7ad9" stroke-width="3" stroke-opacity="0.9"/>` +
        `<path d="${b}" fill="${WHITE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
        `<rect x="22" y="26" width="22" height="5" fill="#cfc6e8"/><rect x="34" y="34" width="34" height="5" fill="#cfc6e8"/><rect x="26" y="42" width="16" height="5" fill="#cfc6e8"/>` +
        `<rect x="50" y="25" width="16" height="7" fill="#ff7ad9" fill-opacity="0.7"/><rect x="18" y="38" width="12" height="4" fill="#5ee0ff" fill-opacity="0.8"/>` +
        line('M58 42q2 -4 6 -4q4 0 4 3.5q0 2.5 -4 3.5v2', INK, 2.6) + `<circle cx="64" cy="51" r="0.1" stroke="${INK}" stroke-width="3.4"/>`;
    },
  },
  {
    bg: '#5c7fe0', rim: '#3450a8',
    emblem: () =>
      // 放大镜盯着 K 线 + 警示哨
      `<rect x="20" y="28" width="7" height="18" fill="#ff5a4a" stroke="${INK}" stroke-width="2"/><rect x="30" y="22" width="7" height="22" fill="#3cbf6a" stroke="${INK}" stroke-width="2"/><rect x="40" y="30" width="7" height="14" fill="#ff5a4a" stroke="${INK}" stroke-width="2"/>` +
      line('M23.5 24v4M33.5 18v4M43.5 26v4', INK, 1.8) +
      rod('M58 44L74 60', '#8a5a3a', 6) + `<circle cx="48" cy="34" r="17" fill="#dff4ff" fill-opacity="0.45" stroke="${INK}" stroke-width="4"/><circle cx="48" cy="34" r="17" fill="none" stroke="#ffd23f" stroke-width="1.8"/>` +
      hiArc('M37 28q3 -7 10 -8', 2.6, 0.9) +
      `<path d="M66 16l10 -4 2 6 -10 4z" fill="#ffd23f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` + line('M80 10l4 -2M81 16l4 1', WHITE, 2),
  },
  {
    bg: '#ef6a4a', rim: '#b8382a',
    emblem: () =>
      // 一头栽下来的绿箭头，砸出裂缝
      `<path d="M16 16L34 22L44 36L56 40L70 58" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M16 16L34 22L44 36L56 40L70 58" fill="none" stroke="#3cd47a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M62 62L78 66L74 50Z" fill="#3cd47a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
      line('M60 64l-8 2-4 -4M76 66l4 4M70 68l-2 4', '#5a1a1a', 2.4) + `<path d="${sparkleD(24, 50, 5)}" fill="#ffe14a" stroke="${INK}" stroke-width="1.6"/>`,
  },
  {
    bg: '#e0442e', rim: '#982818',
    emblem: () =>
      // 越吹越大的价签气球 + 缩水的钱包
      line('M58 54Q60 62 56 70', INK, 2.4) +
      `<path d="M48 12Q74 12 74 34Q74 52 52 56L50 60L46 56Q24 52 24 34Q24 12 48 12Z" fill="#ffd23f" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
      hiArc('M32 28q4 -10 14 -12', 3.4, 0.8) + rod('M40 42V24M34 30L40 23L46 30M54 42V28M49 33L54 27L59 33', '#ff5a4a', 2.4) +
      `<rect x="14" y="52" width="16" height="11" rx="2.5" fill="#8a5a3a" stroke="${INK}" stroke-width="2.4"/>` + line('M18 52v-2M26 52v-2', INK, 1.6),
  },
  {
    bg: '#3a2634', rim: '#1a1018',
    emblem: () =>
      `<path d="M72 8L60 22" stroke="#ff7a33" stroke-width="7" stroke-linecap="round" stroke-opacity="0.5"/><circle cx="58" cy="24" r="5" fill="#ffb347" stroke="${INK}" stroke-width="2.2"/>` +
      `<path d="M48 14Q72 14 72 36Q72 46 64 50V58H32V50Q24 46 24 36Q24 14 48 14Z" fill="#f2ece4" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
      `<path d="M30 36Q30 28 38 28Q44 30 42 38Q40 44 34 42Q30 40 30 36Z" fill="#c8203a" stroke="${INK}" stroke-width="2.2"/><path d="M66 36Q66 28 58 28Q52 30 54 38Q56 44 62 42Q66 40 66 36Z" fill="#c8203a" stroke="${INK}" stroke-width="2.2"/>` +
      `<path d="M48 42L44 50H52Z" fill="${INK}"/>` + line('M38 52V58M44 52V58M52 52V58M58 52V58', INK, 2) + line('M52 16l-3 8 4 4', '#8a7a70', 1.8),
  },
];

function badgeShape(level: number): string {
  // 1–2 圆章，3–4 盾形，5–6 带铆钉的盾，7–8 带尖角的盾
  if (level <= 2) return ellipseD(48, 46, 40, 40);
  if (level <= 4) return 'M48 4Q70 10 86 10Q88 56 48 92Q8 56 10 10Q26 10 48 4Z';
  if (level <= 6) return 'M48 4L60 10Q74 12 86 8Q90 58 48 92Q6 58 10 8Q22 12 36 10Z';
  return 'M48 2L58 10L72 4L76 14L90 12Q90 60 48 94Q6 60 6 12L20 14L24 4L38 10Z';
}

function difficultySvg(level: number): string {
  const d = DIFFS[level - 1]!;
  const outer = badgeShape(level);
  const out = frag();
  // 6 级起身后出现警示斜纹，8 级加火焰
  if (level >= 8) {
    const fl = smoothClosed([[48, -2], [60, 8], [74, -1], [80, 14], [96, 12], [92, 32], [96, 54], [80, 68], [70, 94], [48, 96], [26, 94], [16, 68], [0, 54], [4, 32], [0, 12], [16, 14], [22, -1], [36, 8]], 0.8);
    out.content += `<path d="${fl}" fill="#ff7a33" stroke="${INK}" stroke-width="3"/><path d="${fl}" transform="translate(48 48) scale(0.86) translate(-48 -48)" fill="#ffc93a"/>`;
  }
  const body = shape(outer, {
    fill: d.bg,
    shade: darken(d.bg, 0.15),
    shadeOffset: [-6, -6],
    sw: 4,
    extra:
      (level >= 6 ? `<clipPath id="bclip"><path d="${outer}"/></clipPath><g clip-path="url(#bclip)"><path d="M0 74L22 52M0 88L36 52M70 52L96 78M84 52L96 64" stroke="${INK}" stroke-opacity="0.18" stroke-width="6"/></g>` : '') +
      (level >= 5 && level <= 6 ? [[20, 16], [76, 16], [16, 44], [80, 44]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${lighten(d.rim, 0.4)}" stroke="${INK}" stroke-width="1.6"/>`).join('') : '') +
      hiArc(level <= 2 ? 'M16 34q6 -18 22 -24' : 'M18 18q8 -4 16 -4', 3.4, 0.55),
  });
  const inner = `<path d="${outer}" transform="translate(48 46) scale(0.84) translate(-48 -46)" fill="none" stroke="${lighten(d.bg, 0.45)}" stroke-width="2.4" stroke-dasharray="${level <= 4 ? '2 6' : '8 4'}" stroke-linecap="round"/>`;
  // 数字牌：底部的小圆章，颜色随难度加深
  const tabFill = level >= 7 ? '#2b1a24' : WHITE;
  const tabInk = level >= 7 ? '#ffd23f' : d.rim;
  const tab = `<circle cx="48" cy="${level <= 2 ? 78 : 74}" r="14" fill="${tabFill}" stroke="${INK}" stroke-width="3.4"/>` + digit(String(level), 48, level <= 2 ? 78 : 74, 1.12, tabInk);
  // 徽记图案缩放进上半部分
  const emb = `<g transform="translate(48 ${level <= 2 ? 38 : 35}) scale(0.72) translate(-48 -36)">${d.emblem()}</g>`;
  return svgDoc(96, 96, merge(out, grained(merge(body, frag(inner)), 0.07, [0, 0, 96, 96]), frag(emb + tab)));
}

// ---------------------------------------------------------------- 成就框

export const ACHIEVEMENT_ICONS = ['chart_up', 'chart_down', 'fire', 'ice', 'rocket', 'crown', 'bill', 'cat', 'chat', 'megaphone', 'shield', 'skull', 'star', 'clover', 'coin', 'trophy'] as const;

const TIERS = {
  bronze: { rim: '#d08a52', dark: '#9a5a2e', light: '#f2c194', disc: '#fbe7d4' },
  silver: { rim: '#c4ccda', dark: '#8a94a8', light: '#eef2f8', disc: '#f4f7fc' },
  gold: { rim: '#ffcf3a', dark: '#d89a12', light: '#fff1a8', disc: '#fff8dc' },
  locked: { rim: '#9a90a0', dark: '#6a6070', light: '#c8c0cc', disc: '#4a3d58' },
} as const;
type Tier = keyof typeof TIERS;

function frameSvg(tier: Tier): string {
  const t = TIERS[tier];
  let scallop = '';
  const n = 20;
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 45 : 41.5;
    pts.push([48 + Math.cos(a) * r, 48 + Math.sin(a) * r]);
  }
  scallop = smoothClosed(pts, 0.6);
  const parts: (Frag | string)[] = [];
  // 金：月桂枝 + 顶上的星；银：两颗小星；铜：素面
  let back = '';
  if (tier === 'gold') {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const a = ((110 + i * 18) * Math.PI) / 180;
        const x = 48 + sx * Math.cos(a) * -46;
        const y = 50 + Math.sin(a) * 46;
        back += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="8" ry="4" fill="#7ccf6a" stroke="${INK}" stroke-width="2" transform="rotate(${(sx * (i * 18 + 20)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      }
    }
  }
  const body = shape(scallop, {
    fill: t.rim,
    shade: t.dark,
    shadeOffset: [-4, -5],
    sw: 3.6,
    extra:
      `<circle cx="48" cy="48" r="35" fill="${t.light}" stroke="${INK}" stroke-width="2.4"/>` +
      `<circle cx="48" cy="48" r="31" fill="${t.disc}" stroke="${t.dark}" stroke-width="2"/>` +
      (tier === 'locked' ? `<circle cx="48" cy="48" r="31" fill="none" stroke="#2b1f33" stroke-width="5" stroke-opacity="0.4"/>` : `<path d="M24 34q8 -14 24 -16" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3.4" stroke-linecap="round"/>`) +
      hiArc('M14 36q4 -14 16 -22', 3, 0.7),
  });
  parts.push(frag(back), grained(body, 0.06, [0, 0, 96, 96]));
  let top = '';
  if (tier === 'gold') top += `<path d="${starD(48, 7, 8)}" fill="#fff1a8" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  if (tier === 'silver') top += `<path d="${starD(20, 14, 5)}" fill="${WHITE}" stroke="${INK}" stroke-width="1.8"/><path d="${starD(76, 14, 5)}" fill="${WHITE}" stroke="${INK}" stroke-width="1.8"/>`;
  if (tier === 'bronze') top += `<circle cx="48" cy="6" r="4" fill="${t.light}" stroke="${INK}" stroke-width="2.2"/>`;
  if (tier === 'locked') {
    top += `<g transform="translate(74 74)"><path d="M-7 -4V-9Q-7 -16 0 -16Q7 -16 7 -9V-4" fill="none" stroke="${INK}" stroke-width="6"/><path d="M-7 -4V-9Q-7 -16 0 -16Q7 -16 7 -9V-4" fill="none" stroke="#cfd8e6" stroke-width="2.6"/>` +
      `<rect x="-11" y="-5" width="22" height="17" rx="4" fill="#ffd23f" stroke="${INK}" stroke-width="2.8"/><circle cx="0" cy="2" r="2.4" fill="${INK}"/><path d="M0 3v4" stroke="${INK}" stroke-width="2"/></g>`;
  }
  return svgDoc(96, 96, merge(...parts.map((p) => (typeof p === 'string' ? frag(p) : p)), frag(top)));
}

// ---------------------------------------------------------------- 成就图标（64×64，透明底）

const AICONS: Record<string, () => string> = {
  chart_up: () =>
    `<rect x="10" y="44" width="9" height="12" fill="#ff8a7a" stroke="${INK}" stroke-width="2.4"/><rect x="23" y="36" width="9" height="20" fill="#ff8a7a" stroke="${INK}" stroke-width="2.4"/><rect x="36" y="28" width="9" height="28" fill="#ff8a7a" stroke="${INK}" stroke-width="2.4"/>` +
    rod('M8 38L22 28L32 32L52 12', '#ff3b30', 4) + `<path d="M44 10L56 8L54 20Z" fill="#ff3b30" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`,
  chart_down: () =>
    `<rect x="10" y="28" width="9" height="28" fill="#7fdba0" stroke="${INK}" stroke-width="2.4"/><rect x="23" y="36" width="9" height="20" fill="#7fdba0" stroke="${INK}" stroke-width="2.4"/><rect x="36" y="44" width="9" height="12" fill="#7fdba0" stroke="${INK}" stroke-width="2.4"/>` +
    rod('M8 12L24 26L34 22L52 44', '#1fae5a', 4) + `<path d="M44 46L56 48L54 36Z" fill="#1fae5a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`,
  fire: () => {
    const outer = smoothClosed([[32, 4], [42, 16], [50, 14], [54, 32], [48, 52], [32, 60], [16, 52], [10, 34], [16, 20], [22, 26]], 0.9);
    const inner = smoothClosed([[32, 24], [40, 34], [42, 46], [32, 54], [22, 46], [24, 36]], 0.9);
    return `<path d="${outer}" fill="#ff6a3a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="${inner}" fill="#ffd23f"/>` + hiArc('M18 34q2 -8 6 -10', 2.6, 0.6);
  },
  ice: () => {
    let s = '';
    for (let i = 0; i < 3; i++) s += `<g transform="rotate(${i * 60} 32 32)">${rod('M32 6V58', '#bfeeff', 4)}${line('M26 12l6 6 6 -6M26 52l6 -6 6 6', INK, 5.4)}${line('M26 12l6 6 6 -6M26 52l6 -6 6 6', '#bfeeff', 2.4)}</g>`;
    return s + `<circle cx="32" cy="32" r="6" fill="#ffffff" stroke="${INK}" stroke-width="2.6"/>`;
  },
  rocket: () =>
    `<path d="M22 46Q14 50 12 60Q22 58 26 50Z" fill="#ffb347" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path d="M20 36L10 38L16 28L26 26ZM28 44L26 54L36 48L38 38Z" fill="#ff5a4a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="M20 44Q22 20 54 10Q46 40 22 46Z" fill="#eef2f8" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="38" cy="26" r="5.5" fill="#5ec8ff" stroke="${INK}" stroke-width="2.6"/>` + hiArc('M26 36q4 -10 12 -16', 2.4, 0.8),
  crown: () =>
    `<path d="M10 46L8 18L22 32L32 12L42 32L56 18L54 46Z" fill="#ffd23f" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
    `<rect x="10" y="44" width="44" height="10" rx="3" fill="#f0a020" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="32" cy="12" r="4" fill="#ff5d7a" stroke="${INK}" stroke-width="2.2"/><circle cx="8" cy="18" r="3.4" fill="#5ee0ff" stroke="${INK}" stroke-width="2"/><circle cx="56" cy="18" r="3.4" fill="#5ee0ff" stroke="${INK}" stroke-width="2"/>` +
    `<circle cx="22" cy="49" r="2.4" fill="#ff5d7a"/><circle cx="32" cy="49" r="2.4" fill="#5ee0ff"/><circle cx="42" cy="49" r="2.4" fill="#ff5d7a"/>`,
  bill: () => {
    let z = 'M14 6H50V54';
    for (let x = 50, i = 0; x > 14; x -= 6, i++) z += `L${Math.max(14, x - 3)} ${i % 2 ? 54 : 59}`;
    z += 'L14 54Z';
    return `<path d="${z}" fill="#fffaf0" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><rect x="14" y="6" width="36" height="11" fill="#ff8f84" stroke="${INK}" stroke-width="2.6"/>` +
      line('M20 26h24M20 33h18M20 40h22', '#d9c4a2', 2.6) + `<circle cx="44" cy="46" r="9" fill="none" stroke="#e23b2e" stroke-width="2.6"/>` + line('M40 46l3 3 5 -6', '#e23b2e', 2.6);
  },
  cat: () =>
    `<path d="M12 30L14 8L28 20ZM52 30L50 8L36 20Z" fill="#ffb066" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M16 22L17 13L23 19ZM48 22L47 13L41 19Z" fill="#ff9aa8"/>` +
    `<path d="${ellipseD(32, 36, 22, 19)}" fill="#ffb066" stroke="${INK}" stroke-width="3"/>` +
    line('M28 20l1 6M36 20l-1 6M32 18v7', '#e0852e', 2.4) +
    `<ellipse cx="24" cy="36" rx="2.6" ry="3.4" fill="${INK}"/><ellipse cx="40" cy="36" rx="2.6" ry="3.4" fill="${INK}"/>` +
    `<path d="M30 42h4l-2 2.4z" fill="#ff7a8a"/>` + line('M27 46q2.5 2 5 0q2.5 2 5 0', INK, 2) + line('M8 40l10 1M8 46l10 -2M56 40l-10 1M56 46l-10 -2', INK, 1.6),
  chat: () =>
    `<path d="M14 10H50Q58 10 58 18V36Q58 44 50 44H28L16 54L18 44H14Q6 44 6 36V18Q6 10 14 10Z" fill="#7ad86a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    [20, 32, 44].map((x) => `<circle cx="${x}" cy="27" r="3.6" fill="${WHITE}"/>`).join('') + hiArc('M12 18q2 -4 6 -4', 2.4, 0.6),
  megaphone: () =>
    `<rect x="18" y="38" width="9" height="16" rx="3" fill="#5a6070" stroke="${INK}" stroke-width="2.4" transform="rotate(-10 22 46)"/>` +
    `<path d="M8 30L10 22H18L44 8V54L18 40H10Z" fill="#ff8a3d" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><ellipse cx="45" cy="31" rx="5" ry="23" fill="#ffc29a" stroke="${INK}" stroke-width="2.8"/>` +
    line('M54 18l6 -4M56 31h7M54 44l6 4', INK, 2.6),
  shield: () =>
    `<path d="M32 4Q46 10 56 10Q58 40 32 60Q6 40 8 10Q18 10 32 4Z" fill="#4f7cff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M32 4V60Q6 40 8 10Q18 10 32 4Z" fill="#7fa0ff"/>` + `<path d="M32 4Q46 10 56 10Q58 40 32 60Q6 40 8 10Q18 10 32 4Z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    line('M22 32l7 7 13 -14', WHITE, 4.4),
  skull: () =>
    `<path d="M32 6Q56 6 56 28Q56 38 48 42V52H16V42Q8 38 8 28Q8 6 32 6Z" fill="#f2ece4" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="22" cy="28" rx="6.5" ry="7" fill="${INK}"/><ellipse cx="42" cy="28" rx="6.5" ry="7" fill="${INK}"/><path d="M32 34L28 42H36Z" fill="${INK}"/>` +
    line('M24 46V52M30 46V52M36 46V52M42 46V52', INK, 2) + hiArc('M16 20q4 -8 10 -10', 2.4, 0.8),
  star: () => `<path d="${starD(32, 33, 27, 0.48)}" fill="#ffd23f" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` + `<path d="${starD(32, 33, 13, 0.48)}" fill="#fff1a8"/>`,
  clover: () => {
    let s = rod('M32 34Q36 50 30 60', '#3ca85a', 3);
    for (let i = 0; i < 4; i++) {
      s += `<g transform="rotate(${i * 90 + 45} 32 30)"><path d="M32 30C22 26 20 12 28 10C31 9 32 12 32 14C32 12 33 9 36 10C44 12 42 26 32 30Z" fill="#62c95a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/></g>`;
    }
    return s + `<circle cx="32" cy="30" r="3" fill="#3ca85a"/>`;
  },
  coin: () =>
    `<ellipse cx="32" cy="36" rx="24" ry="24" fill="#f0a020" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="32" r="24" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="32" cy="32" r="17" fill="none" stroke="#e0a020" stroke-width="2.4"/><path d="${starD(32, 33, 9)}" fill="#f0a020"/>` + hiArc('M16 26q4 -10 14 -12', 3, 0.8),
  trophy: () =>
    line('M16 14Q4 14 6 24Q8 32 18 32M48 14Q60 14 58 24Q56 32 46 32', INK, 7) + line('M16 14Q4 14 6 24Q8 32 18 32M48 14Q60 14 58 24Q56 32 46 32', '#ffd23f', 3) +
    `<path d="M14 8H50V22Q50 40 32 42Q14 40 14 22Z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<rect x="28" y="42" width="8" height="8" fill="#f0a020" stroke="${INK}" stroke-width="2.4"/><rect x="18" y="50" width="28" height="9" rx="2.5" fill="#b8773a" stroke="${INK}" stroke-width="2.8"/>` +
    `<path d="${starD(32, 22, 7)}" fill="#fff1a8" stroke="${INK}" stroke-width="1.6"/>` + hiArc('M20 14v10', 2.6, 0.8),
};

// ---------------------------------------------------------------- 图鉴小件

/** 页签：上圆下方，九宫格 [24,24,18,10]；选中态更亮并带小星 */
function codexTab(active: boolean): string {
  const fill = active ? '#ffd56b' : '#efe0c6';
  const d = 'M4 44V16Q4 4 16 4H104Q116 4 116 16V44Z';
  return svgDoc(120, 48, frag(
    `<path d="${d}" fill="${darken(fill, 0.12)}"/><path d="${d}" transform="translate(0 -3)" fill="${fill}"/>` +
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
      `<path d="M14 12H106" stroke="#ffffff" stroke-opacity="0.7" stroke-width="2.6" stroke-linecap="round"/>` +
      (active ? `<path d="${sparkleD(104, 18, 5)}" fill="#ffffff" stroke="${INK}" stroke-width="1.6"/>` : ''),
  ));
}

/** 图鉴卡：纸面卡框，九宫格 [24,24,24,24]，上方留一块彩色题头（高 30） */
function codexCard(): string {
  return svgDoc(120, 160, frag(
    `<rect x="7" y="9" width="108" height="146" rx="16" fill="${INK}" fill-opacity="0.2"/>` +
      `<rect x="4" y="4" width="108" height="146" rx="16" fill="#fffaf0" stroke="${INK}" stroke-width="3.2"/>` +
      `<path d="M4 34V20Q4 4 20 4H96Q112 4 112 20V34Z" fill="#ffe0a8"/><path d="M4 34H112" stroke="${INK}" stroke-width="2.4"/>` +
      `<rect x="12" y="42" width="92" height="98" rx="10" fill="none" stroke="#ead9bf" stroke-width="2.4" stroke-dasharray="2 6" stroke-linecap="round"/>` +
      `<rect x="4" y="4" width="108" height="146" rx="16" fill="none" stroke="${INK}" stroke-width="3.2"/>`,
  ));
}

/** 新解锁角标：红色爆炸贴 + 白色感叹号 */
function codexNew(): string {
  const d = starD(16, 16, 15, 0.72, 10, -90);
  return svgDoc(32, 32, frag(`<path d="${d}" fill="#ff4d5e" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` + line('M16 9v8', WHITE, 3.6) + `<circle cx="16" cy="22.5" r="2.2" fill="${WHITE}"/>`));
}

/** 小锁：未解锁的人设 / 难度上用 */
function codexLock(): string {
  return svgDoc(32, 32, frag(
    `<path d="M9 15V10Q9 3 16 3Q23 3 23 10V15" fill="none" stroke="${INK}" stroke-width="6.5"/><path d="M9 15V10Q9 3 16 3Q23 3 23 10V15" fill="none" stroke="#cfd8e6" stroke-width="2.8"/>` +
      `<rect x="5" y="14" width="22" height="16" rx="4" fill="#ffd23f" stroke="${INK}" stroke-width="2.8"/><circle cx="16" cy="21" r="2.6" fill="${INK}"/><path d="M16 22v4" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
      hiArc('M9 18v4', 2, 0.7),
  ));
}

/** 收集进度条：底槽与填充，九宫格 [12,12,0,0] */
function progressTrack(): string {
  return svgDoc(64, 20, frag(`<rect x="2" y="2" width="60" height="16" rx="8" fill="#e8d8bf" stroke="${INK}" stroke-width="2.6"/><path d="M8 7H56" stroke="${INK}" stroke-opacity="0.12" stroke-width="3" stroke-linecap="round"/>`));
}
function progressFill(): string {
  return svgDoc(64, 20, frag(`<rect x="2" y="2" width="60" height="16" rx="8" fill="#ffb347" stroke="${INK}" stroke-width="2.6"/><path d="M9 7H55" stroke="#ffffff" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round"/>`));
}

/** 横屏提示：手机从竖转横 */
function rotatePhone(): string {
  return svgDoc(96, 96, frag(
    `<rect x="12" y="20" width="28" height="48" rx="6" fill="#d8d0e0" stroke="${INK}" stroke-width="3" stroke-dasharray="5 4" opacity="0.8"/>` +
      `<g transform="rotate(-90 58 60)"><rect x="40" y="36" width="36" height="62" rx="8" fill="#3a3448" stroke="${INK}" stroke-width="3.4"/><rect x="45" y="44" width="26" height="46" rx="3" fill="#bfefff"/>` +
      `<path d="M50 80l6 -8 5 4 6 -10" fill="none" stroke="#ff5a4a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<path d="M30 14Q60 6 74 30" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M30 14Q60 6 74 30" fill="none" stroke="#ffb347" stroke-width="3.4" stroke-linecap="round"/>` +
      `<path d="M66 28L78 36L80 22Z" fill="#ffb347" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`,
  ));
}

export const CODEX_UI: Record<string, () => string> = {
  codex_tab: () => codexTab(false),
  codex_tab_active: () => codexTab(true),
  codex_card: codexCard,
  codex_new: codexNew,
  codex_lock: codexLock,
  progress_track: progressTrack,
  progress_fill: progressFill,
  rotate_phone: rotatePhone,
};

export function achievementIconSvg(name: string): string {
  const f = AICONS[name];
  if (!f) throw new Error(`unknown achievement icon ${name}`);
  return svgDoc(64, 64, frag(f()));
}

export function build(write: (rel: string, data: string) => void): number {
  let n = 0;
  for (let lv = 1; lv <= 8; lv++, n++) write(`difficulty/${lv}.svg`, difficultySvg(lv));
  for (const t of Object.keys(TIERS) as Tier[]) {
    write(`achievements/frame_${t}.svg`, frameSvg(t));
    n++;
  }
  for (const name of ACHIEVEMENT_ICONS) {
    write(`achievements/icon_${name}.svg`, achievementIconSvg(name));
    n++;
  }
  for (const [k, f] of Object.entries(CODEX_UI)) {
    write(`ui/${k}.svg`, f());
    n++;
  }
  return n;
}

export { rrectD };
