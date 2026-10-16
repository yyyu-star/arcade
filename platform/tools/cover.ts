/**
 * 德州扑克的大厅封面：程序画的 SVG（按 1280×720 画），用无头 Chromium 光栅化成 public/covers/texas.webp（输出 800×450，16:9；卡片最宽约 350 像素，手机 2 倍屏也够）。
 * 风格跟开盘、掼蛋的封面走：粗深色描边、平涂、腮红的卡通人物，暖色灯光，右边大字标题。
 * 人物是德州单机里的几个电脑（名字见 worker/api/validate.ts 的保留名单），不画真实的人和牌桌品牌。
 *
 *   npm run cover            # 重新生成
 *   npm run cover -- --svg   # 只输出 SVG（看细节、改图时用）
 *   npm run cover -- --shrink --id=kaipan --id=guandan  # 把别的游戏给的封面缩到同样的 800×450（只缩比它宽的，重复跑没事）；
 *     --id 可以写几次，不写就是开盘、掼蛋（最早给的两张）
 *   npm run cover -- --from=<SVG 路径> --id=<游戏 id>  # 把别的游戏给的 16:9 SVG 光栅化成 public/covers/<id>.webp（麻将，0.10.13）
 *     路径从命令行传进来，工具本身不引用模块外的文件；SVG 里的中文用运行环境装的字体（比如 Noto Sans CJK SC），换了环境字形可能略有不同
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const W = 1280;
const H = 720;
/** 输出尺寸：SVG 是矢量，直接按这个尺寸画，不糊 */
const OUT_W = 800;
const OUT_H = 450;
const INK = '#3a2422';
const SKIN = '#ffd9b8';
const BLUSH = '#ff9b8f';

/** 一张牌：rank、花色、是否红色；x、y 是左上角，r 是旋转角度 */
function card(x: number, y: number, r: number, rank: string, suit: string, red: boolean, back = false): string {
  const w = 92;
  const h = 128;
  const color = red ? '#d8343b' : '#2b2b3a';
  const face = back
    ? `<rect x="7" y="7" width="${w - 14}" height="${h - 14}" rx="8" fill="#b4232d"/>
       <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="5" fill="none" stroke="#f3c36b" stroke-width="3"/>
       <text x="${w / 2}" y="${h / 2 + 12}" text-anchor="middle" font-size="34" fill="#f3c36b" font-weight="900">♠</text>`
    : `<text x="12" y="34" font-size="28" font-weight="900" fill="${color}" font-family="Arial, sans-serif">${rank}</text>
       <text x="13" y="60" font-size="24" fill="${color}">${suit}</text>
       <text x="${w / 2 + 6}" y="${h / 2 + 30}" text-anchor="middle" font-size="58" fill="${color}">${suit}</text>`;
  return `<g transform="translate(${x} ${y}) rotate(${r} ${w / 2} ${h / 2})">
    <rect x="4" y="7" width="${w}" height="${h}" rx="12" fill="#000" opacity=".25"/>
    <rect width="${w}" height="${h}" rx="12" fill="#fffaf0" stroke="${INK}" stroke-width="4"/>
    ${face}
  </g>`;
}

/** 一摞筹码：从下往上 n 个 */
function chips(x: number, y: number, n: number, fill: string, edge: string): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const cy = y - i * 11;
    s += `<g transform="translate(${x} ${cy})">
      <ellipse cx="0" cy="6" rx="34" ry="13" fill="${edge}" stroke="${INK}" stroke-width="3.5"/>
      <ellipse cx="0" cy="0" rx="34" ry="13" fill="${fill}" stroke="${INK}" stroke-width="3.5"/>
      <ellipse cx="0" cy="0" rx="21" ry="7.5" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="7 6" opacity=".9"/>
    </g>`;
  }
  return s;
}

/** 脸的共用部分：圆脸、腮红、耳朵 */
function face(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx - r + 4}" cy="${cy + 6}" r="${r * 0.2}" fill="${SKIN}" stroke="${INK}" stroke-width="4"/>
    <circle cx="${cx + r - 4}" cy="${cy + 6}" r="${r * 0.2}" fill="${SKIN}" stroke="${INK}" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${SKIN}" stroke="${INK}" stroke-width="5"/>
    <ellipse cx="${cx - r * 0.55}" cy="${cy + r * 0.3}" rx="${r * 0.17}" ry="${r * 0.1}" fill="${BLUSH}" opacity=".75"/>
    <ellipse cx="${cx + r * 0.55}" cy="${cy + r * 0.3}" rx="${r * 0.17}" ry="${r * 0.1}" fill="${BLUSH}" opacity=".75"/>`;
}

/** 身体：肩膀一块圆角，被桌子挡住下半截 */
function body(cx: number, top: number, w: number, fill: string): string {
  return `<path d="M${cx - w / 2} ${top + 160} Q${cx - w / 2} ${top} ${cx} ${top} Q${cx + w / 2} ${top} ${cx + w / 2} ${top + 160} Z" fill="${fill}" stroke="${INK}" stroke-width="5"/>`;
}

// 稳哥：墨镜、背头，稳稳地笑
const wenge = (cx: number, cy: number) => `
  ${body(cx, cy + 62, 210, '#2f3b5c')}
  <path d="M${cx - 22} ${cy + 66} L${cx} ${cy + 110} L${cx + 22} ${cy + 66}" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <path d="M${cx - 9} ${cy + 76} L${cx} ${cy + 108} L${cx + 9} ${cy + 76} Z" fill="#d8343b" stroke="${INK}" stroke-width="3"/>
  ${face(cx, cy, 64)}
  <path d="M${cx - 64} ${cy - 6} Q${cx - 70} ${cy - 78} ${cx} ${cy - 74} Q${cx + 74} ${cy - 76} ${cx + 64} ${cy - 8} Q${cx + 40} ${cy - 46} ${cx - 10} ${cy - 40} Q${cx - 44} ${cy - 36} ${cx - 64} ${cy - 6} Z" fill="#2a2030" stroke="${INK}" stroke-width="5"/>
  <rect x="${cx - 52}" y="${cy - 14}" width="44" height="28" rx="10" fill="#1d1d28" stroke="${INK}" stroke-width="4"/>
  <rect x="${cx + 8}" y="${cy - 14}" width="44" height="28" rx="10" fill="#1d1d28" stroke="${INK}" stroke-width="4"/>
  <path d="M${cx - 8} ${cy - 4} L${cx + 8} ${cy - 4}" stroke="${INK}" stroke-width="4"/>
  <path d="M${cx - 44} ${cy - 8} L${cx - 32} ${cy - 8}" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
  <path d="M${cx + 16} ${cy - 8} L${cx + 28} ${cy - 8}" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
  <path d="M${cx - 18} ${cy + 34} Q${cx + 4} ${cy + 46} ${cx + 22} ${cy + 30}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;

// 阿飙：红发冲天，大笑，手里举着两张牌
const abiao = (cx: number, cy: number) => `
  ${body(cx, cy + 60, 200, '#f08a24')}
  <path d="M${cx - 30} ${cy + 64} L${cx} ${cy + 96} L${cx + 30} ${cy + 64}" fill="none" stroke="${INK}" stroke-width="4"/>
  ${face(cx, cy, 62)}
  <path d="M${cx - 62} ${cy - 10} L${cx - 70} ${cy - 60} L${cx - 40} ${cy - 44} L${cx - 34} ${cy - 96} L${cx - 8} ${cy - 56} L${cx + 10} ${cy - 104} L${cx + 24} ${cy - 54} L${cx + 52} ${cy - 88} L${cx + 46} ${cy - 40} L${cx + 76} ${cy - 50} L${cx + 62} ${cy - 10} Q${cx} ${cy - 44} ${cx - 62} ${cy - 10} Z" fill="#e8463c" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M${cx - 36} ${cy - 2} Q${cx - 24} ${cy - 16} ${cx - 12} ${cy - 2}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M${cx + 12} ${cy - 2} Q${cx + 24} ${cy - 16} ${cx + 36} ${cy - 2}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M${cx - 30} ${cy + 18} Q${cx} ${cy + 66} ${cx + 30} ${cy + 18} Z" fill="#8f2b2b" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M${cx - 16} ${cy + 40} Q${cx} ${cy + 52} ${cx + 16} ${cy + 40}" fill="#ff8a80"/>`;

// 老好：圆眼镜、白胡子，乐呵呵
const laohao = (cx: number, cy: number) => `
  ${body(cx, cy + 60, 200, '#6b8f4e')}
  ${face(cx, cy, 60)}
  <path d="M${cx - 58} ${cy - 14} Q${cx - 60} ${cy - 64} ${cx} ${cy - 62} Q${cx + 60} ${cy - 64} ${cx + 58} ${cy - 14} Q${cx + 46} ${cy - 40} ${cx + 30} ${cy - 40} Q${cx} ${cy - 50} ${cx - 30} ${cy - 40} Q${cx - 46} ${cy - 40} ${cx - 58} ${cy - 14} Z" fill="#e9e4dc" stroke="${INK}" stroke-width="5"/>
  <circle cx="${cx - 24}" cy="${cy - 2}" r="17" fill="#fff8" stroke="${INK}" stroke-width="4.5"/>
  <circle cx="${cx + 24}" cy="${cy - 2}" r="17" fill="#fff8" stroke="${INK}" stroke-width="4.5"/>
  <path d="M${cx - 7} ${cy - 4} L${cx + 7} ${cy - 4}" stroke="${INK}" stroke-width="4"/>
  <path d="M${cx - 31} ${cy} Q${cx - 24} ${cy - 8} ${cx - 17} ${cy}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M${cx + 17} ${cy} Q${cx + 24} ${cy - 8} ${cx + 31} ${cy}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M${cx - 34} ${cy + 26} Q${cx - 16} ${cy + 18} ${cx} ${cy + 26} Q${cx + 16} ${cy + 18} ${cx + 34} ${cy + 26} Q${cx + 20} ${cy + 44} ${cx} ${cy + 36} Q${cx - 20} ${cy + 44} ${cx - 34} ${cy + 26} Z" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <path d="M${cx - 10} ${cy + 44} Q${cx} ${cy + 52} ${cx + 10} ${cy + 44}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;

// 慢慢：齐刘海短发，托腮想事情，头上冒个问号
const manman = (cx: number, cy: number) => `
  ${body(cx, cy + 60, 196, '#8a5cc7')}
  <path d="M${cx - 70} ${cy + 50} Q${cx - 76} ${cy - 76} ${cx} ${cy - 74} Q${cx + 76} ${cy - 76} ${cx + 70} ${cy + 50} Z" fill="#3a2a3e" stroke="${INK}" stroke-width="5"/>
  ${face(cx, cy, 58)}
  <path d="M${cx - 60} ${cy - 4} Q${cx - 58} ${cy - 60} ${cx} ${cy - 62} Q${cx + 58} ${cy - 60} ${cx + 60} ${cy - 4} L${cx + 40} ${cy - 18} L${cx + 20} ${cy - 8} L${cx} ${cy - 20} L${cx - 20} ${cy - 8} L${cx - 40} ${cy - 18} Z" fill="#3a2a3e" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="${cx + 52}" cy="${cy - 44}" r="9" fill="#ffcf4a" stroke="${INK}" stroke-width="3.5"/>
  <ellipse cx="${cx - 20}" cy="${cy + 6}" rx="6" ry="8" fill="${INK}"/>
  <ellipse cx="${cx + 20}" cy="${cy + 6}" rx="6" ry="8" fill="${INK}"/>
  <circle cx="${cx - 18}" cy="${cy + 3}" r="2.2" fill="#fff"/>
  <circle cx="${cx + 22}" cy="${cy + 3}" r="2.2" fill="#fff"/>
  <ellipse cx="${cx + 4}" cy="${cy + 32}" rx="6" ry="7" fill="#8f2b2b" stroke="${INK}" stroke-width="3.5"/>
  <g transform="translate(${cx - 66} ${cy - 92})">
    <circle r="26" fill="#fff" stroke="${INK}" stroke-width="4"/>
    <text y="12" text-anchor="middle" font-size="34" font-weight="900" fill="#8a5cc7" font-family="Arial, sans-serif">?</text>
  </g>`;

/** 背景的小光点 */
function bokeh(): string {
  const dots = [
    [90, 80, 22], [210, 150, 12], [380, 60, 16], [520, 130, 10], [700, 70, 20], [860, 140, 12], [1010, 60, 14],
    [1180, 120, 24], [1230, 260, 10], [60, 260, 12], [640, 220, 8], [960, 250, 9],
  ];
  return dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffd27a" opacity=".16"/>`).join('');
}

function coverSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="38%" cy="30%" r="85%">
      <stop offset="0" stop-color="#8a3b3c"/>
      <stop offset=".55" stop-color="#4f1f2b"/>
      <stop offset="1" stop-color="#241020"/>
    </radialGradient>
    <radialGradient id="lamp" gradientUnits="userSpaceOnUse" cx="430" cy="110" r="560">
      <stop offset="0" stop-color="#ffe2a0" stop-opacity=".55"/>
      <stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="felt" cx="50%" cy="35%" r="70%">
      <stop offset="0" stop-color="#3fae6a"/>
      <stop offset="1" stop-color="#1d7445"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff1b0"/>
      <stop offset=".5" stop-color="#ffc83d"/>
      <stop offset="1" stop-color="#e58f12"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${bokeh()}
  <!-- 吊灯和光 -->
  <rect width="${W}" height="${H}" fill="url(#lamp)"/>
  <path d="M430 0 L430 52" stroke="${INK}" stroke-width="5"/>
  <path d="M352 104 Q356 52 430 52 Q504 52 508 104 Z" fill="#2f6b4a" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="430" cy="106" rx="80" ry="12" fill="#ffe9b0" stroke="${INK}" stroke-width="4"/>
  <!-- 人物（桌子后面） -->
  ${laohao(130, 330)}
  ${wenge(330, 300)}
  ${abiao(560, 300)}
  ${manman(800, 336)}
  <!-- 阿飙举着的两张底牌 -->
  ${card(592, 316, 12, 'A', '♥', true)}
  ${card(634, 330, 24, 'A', '♠', false)}
  <!-- 牌桌 -->
  <ellipse cx="470" cy="760" rx="700" ry="300" fill="#7a3f22" stroke="${INK}" stroke-width="6"/>
  <ellipse cx="470" cy="770" rx="640" ry="262" fill="url(#felt)" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="470" cy="790" rx="560" ry="210" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="14 12" opacity=".35"/>
  <!-- 公共牌 -->
  ${card(190, 560, -8, 'K', '♠', false)}
  ${card(296, 552, -3, 'Q', '♠', false)}
  ${card(402, 550, 2, 'J', '♠', false)}
  ${card(508, 554, 6, '', '', false, true)}
  ${card(614, 562, 10, '', '', false, true)}
  <!-- 筹码 -->
  ${chips(780, 650, 5, '#d8343b', '#9e1f26')}
  ${chips(850, 668, 3, '#2f6fd1', '#1f4c94')}
  ${chips(80, 680, 4, '#f3c33b', '#b8861a')}
  ${chips(746, 698, 2, '#2fa36a', '#1d7445')}
  <!-- 标题 -->
  <g transform="translate(1040 300) rotate(-4)" font-family="'Noto Sans CJK SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" font-weight="900" text-anchor="middle">
    <text y="0" font-size="150" fill="none" stroke="#3a1414" stroke-width="26" stroke-linejoin="round">德州</text>
    <text y="0" font-size="150" fill="url(#gold)" stroke="#a3191f" stroke-width="7" stroke-linejoin="round">德州</text>
    <text y="170" font-size="150" fill="none" stroke="#3a1414" stroke-width="26" stroke-linejoin="round">扑克</text>
    <text y="170" font-size="150" fill="url(#gold)" stroke="#a3191f" stroke-width="7" stroke-linejoin="round">扑克</text>
  </g>
  <g font-size="54" text-anchor="middle" font-family="Arial, sans-serif">
    <g transform="translate(920 140) rotate(-14)"><circle r="40" fill="#fffaf0" stroke="${INK}" stroke-width="5"/><text y="19" fill="#2b2b3a">♠</text></g>
    <g transform="translate(1188 120) rotate(12)"><circle r="40" fill="#fffaf0" stroke="${INK}" stroke-width="5"/><text y="19" fill="#d8343b">♥</text></g>
    <g transform="translate(1190 560) rotate(-10)"><circle r="40" fill="#fffaf0" stroke="${INK}" stroke-width="5"/><text y="19" fill="#2b2b3a">♣</text></g>
    <g transform="translate(940 560) rotate(8)"><circle r="40" fill="#fffaf0" stroke="${INK}" stroke-width="5"/><text y="19" fill="#d8343b">♦</text></g>
  </g>
</svg>`;
}

/** 把一张 webp 缩到 OUT_W×OUT_H（比它小的不动） */
async function shrink(page: import('playwright-core').Page, file: URL): Promise<void> {
  const src = `data:image/webp;base64,${readFileSync(file).toString('base64')}`;
  const out = await page.evaluate(
    async ({ src, w, h }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (img.naturalWidth <= w) return null;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.86);
    },
    { src, w: OUT_W, h: OUT_H },
  );
  if (!out) return console.log(`${file.pathname} 已经不比 ${OUT_W} 宽，不动`);
  writeFileSync(file, Buffer.from(out.slice(out.indexOf(',') + 1), 'base64'));
  console.log(`缩好了 ${file.pathname}`);
}

/** 把 SVG 按 OUT_W×OUT_H 画成 webp，写到 public/covers/<id>.webp */
async function rasterize(page: import('playwright-core').Page, svg: string, id: string): Promise<void> {
  // 先等字体加载完再画，标题的中文字形才对
  const dataUrl = await page.evaluate(
    async ({ svg, w, h }) => {
      await document.fonts.ready;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.86);
    },
    { svg, w: OUT_W, h: OUT_H },
  );
  if (!dataUrl.startsWith('data:image/webp')) throw new Error('浏览器没导出 webp');
  const out = new URL(`../public/covers/${id}.webp`, import.meta.url);
  writeFileSync(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  console.log(`写好了 ${out.pathname}`);
}

const args = (name: string) => process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const arg = (name: string) => args(name)[0];
const GAME_ID = /^[a-z][a-z0-9-]*$/;

async function main(): Promise<void> {
  const from = arg('from');
  const id = arg('id');
  if (from !== undefined && !(id && GAME_ID.test(id))) throw new Error('--from 要配 --id=<游戏 id>');
  const svg = from !== undefined ? readFileSync(from, 'utf8') : coverSvg();
  if (process.argv.includes('--svg')) {
    process.stdout.write(svg);
    return;
  }
  if (process.argv.includes('--shrink')) {
    const ids = args('id');
    if (!ids.every((x) => GAME_ID.test(x))) throw new Error('--id 要是游戏 id，比如 --id=kaipan');
    const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
    try {
      const page = await browser.newPage();
      for (const id of ids.length ? ids : ['kaipan', 'guandan']) await shrink(page, new URL(`../public/covers/${id}.webp`, import.meta.url));
    } finally {
      await browser.close();
    }
    return;
  }
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await rasterize(page, svg, id ?? 'texas');
  } finally {
    await browser.close();
  }
}

await main();
