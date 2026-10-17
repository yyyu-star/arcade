/**
 * 画面的"茶馆"主题（DESIGN.md 第 7 节）：全部程序生成的 SVG，没有位图、外部字体、网络。
 *
 * 为什么用 CSS 变量而不是直接写在 art.css 里：纹理（呢子、木纹、竹帘）有很多重复的线条，用代码按固定种子生成比手写短得多，
 * 也方便以后调；installArt() 启动时调一次，把各张图写成 `--art-*` 变量，art.css 只引用变量。没调用时变量是空的，
 * art.css 里每处都带兜底，画面退回成纯渐变，不会坏。
 *
 * 性能：大背景都是几十像素见方的可平铺小图或渐变；不用 SVG 滤镜（feTurbulence 之类）和 CSS filter——手机上整屏滤镜每帧都要重算。
 * 图里的"随机"用固定种子的小 LCG：每次打开画面一样，截图对得上。
 */

type StakeIcon = 'fun' | 'small' | 'mid' | 'big' | 'lux' | 'room';

const NS = "xmlns='http://www.w3.org/2000/svg'";

/** SVG 字符串 → CSS 的 url(...)；encodeURIComponent 保证 #、引号、中文都安全 */
const url = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** 固定种子的伪随机（只用来摆纹理，和规则无关） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** 呢子的斜纹：6 像素一格，亮暗两道细线，平铺后像织出来的纹路 */
function felt(): string {
  return `<svg ${NS} width='6' height='6'><path d='M-1 7L7-1M-1 1L1-1M5 7L7 5' stroke='#fff' stroke-opacity='.05'/><path d='M-1 4L4-1M2 7L7 2' stroke='#000' stroke-opacity='.07'/></svg>`;
}

/** 呢子上的绒点：37 像素（质数）一格，和 6 像素的斜纹错开，平铺看不出重复 */
function speck(): string {
  const rnd = lcg(7);
  let d = '';
  for (let i = 0; i < 22; i++) {
    const x = r1(rnd() * 37);
    const y = r1(rnd() * 37);
    const light = rnd() > 0.5;
    d += `<circle cx='${x}' cy='${y}' r='${r1(0.4 + rnd() * 0.6)}' fill='${light ? '#fff' : '#000'}' fill-opacity='${light ? 0.05 : 0.08}'/>`;
  }
  return `<svg ${NS} width='37' height='37'>${d}</svg>`;
}

/** 木纹：横向的波浪纹，240×40 一格横向平铺（左右两头的纹路同一高度，接缝看不出） */
function wood(base: string, dark: string, light: string, seed: number): string {
  const rnd = lcg(seed);
  let lines = '';
  for (let i = 0; i < 9; i++) {
    const y = 2 + i * 4.3 + rnd() * 2;
    const a = 0.6 + rnd() * 1.6;
    const p = rnd() * 6.28;
    let d = `M0 ${r1(y + a * Math.sin(p))}`;
    for (let x = 20; x <= 240; x += 20) d += `L${x} ${r1(y + a * Math.sin(p + (x / 240) * 6.283 * 2))}`;
    const c = rnd() > 0.35 ? dark : light;
    lines += `<path d='${d}' fill='none' stroke='${c}' stroke-opacity='${r1(0.25 + rnd() * 0.4)}' stroke-width='${r1(0.6 + rnd() * 1.2)}'/>`;
  }
  // 两个木结：只画一圈椭圆纹，平铺时隔 240 才出现一次
  lines += `<ellipse cx='70' cy='22' rx='9' ry='3' fill='none' stroke='${dark}' stroke-opacity='.5'/><ellipse cx='70' cy='22' rx='4' ry='1.3' fill='${dark}' fill-opacity='.5'/>`;
  return `<svg ${NS} width='240' height='40'><rect width='240' height='40' fill='${base}'/>${lines}</svg>`;
}

/**
 * 茶馆的板壁：竖木板（两块 56 宽一组）。fade 时往下渐渐透明（叠在呢子上不留接缝）；
 * 不 fade 的上下都能接着平铺，选桌页、等候页整页铺它（0.16.1：以前上半木墙、下半呢子硬切成两截）
 */
function wall(fade = true): string {
  const rnd = lcg(11);
  let g = '';
  for (const x0 of [0, 56]) {
    for (let i = 0; i < 6; i++) {
      const x = x0 + 4 + i * 8 + rnd() * 4;
      const w = 0.6 + rnd();
      g += `<path d='M${r1(x)} 0Q${r1(x + (rnd() - 0.5) * 6)} 180 ${r1(x + (rnd() - 0.5) * 3)} 360' fill='none' stroke='#1c0b05' stroke-opacity='${r1(0.25 + rnd() * 0.3)}' stroke-width='${r1(w)}'/>`;
    }
  }
  return (
    `<svg ${NS} width='112' height='360'><defs>` +
    `<linearGradient id='f' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff'/><stop offset='.45' stop-color='#fff'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>` +
    `<mask id='m'><rect width='112' height='360' fill='${fade ? 'url(#f)' : '#fff'}'/></mask>` +
    `<linearGradient id='p' x1='0' x2='1'><stop offset='0' stop-color='#4a2414'/><stop offset='.5' stop-color='#5a2d18'/><stop offset='1' stop-color='#43200f'/></linearGradient>` +
    `</defs><g mask='url(#m)'><rect width='56' height='360' fill='url(#p)'/><rect x='56' width='56' height='360' fill='url(#p)'/>${g}` +
    `<rect x='55' width='2' height='360' fill='#1a0a04' fill-opacity='.7'/><rect x='57' width='1' height='360' fill='#fff' fill-opacity='.06'/>` +
    `<rect x='111' width='1' height='360' fill='#1a0a04' fill-opacity='.7'/></g></svg>`
  );
}

/** 卷起来的竹帘：细竹篾一条条横着，两根系绳，底下卷成一筒；24 宽一格横向平铺 */
function curtain(): string {
  let s = '';
  for (let y = 0; y < 16; y += 3) s += `<rect y='${y}' width='24' height='2' fill='#d9b46a' fill-opacity='${y % 6 ? 0.9 : 0.75}'/>`;
  return (
    `<svg ${NS} width='24' height='30'><defs><linearGradient id='r' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#8a6326'/><stop offset='.35' stop-color='#e8c983'/><stop offset='1' stop-color='#6f4c18'/></linearGradient>` +
    `<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#000' stop-opacity='.45'/><stop offset='1' stop-color='#000' stop-opacity='0'/></linearGradient></defs>` +
    `<rect width='24' height='16' fill='#7a5520'/>${s}` +
    `<rect x='5' width='1.4' height='24' fill='#7b1f16'/><rect x='17' width='1.4' height='24' fill='#7b1f16'/>` +
    `<rect y='15' width='24' height='9' fill='url(#r)'/><rect y='24' width='24' height='6' fill='url(#s)'/></svg>`
  );
}

/** 红灯笼：竹帘下挂着，胖椭圆加竖筋，金色顶盖和底座，下面一串穗子；字用系统字体 */
function lantern(char: string): string {
  return (
    `<svg ${NS} width='76' height='156' viewBox='0 0 76 156'><g><defs>` +
    `<radialGradient id='b' cx='.4' cy='.4' r='.7'><stop offset='0' stop-color='#ff8a5c'/><stop offset='.45' stop-color='#d8321f'/><stop offset='1' stop-color='#7a0f0a'/></radialGradient>` +
    `<linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#9a6a1c'/><stop offset='.5' stop-color='#f7d488'/><stop offset='1' stop-color='#8a5a12'/></linearGradient>` +
    `<radialGradient id='h' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='#ffb24d' stop-opacity='.35'/><stop offset='1' stop-color='#ffb24d' stop-opacity='0'/></radialGradient></defs>` +
    // 灯笼后面一圈暖光：是画死在图里的渐变，不是滤镜，没有运行时开销
    `<ellipse cx='38' cy='78' rx='38' ry='46' fill='url(#h)'/>` +
    `<rect x='37' y='0' width='2' height='34' fill='#2a1408'/>` +
    `<rect x='26' y='32' width='24' height='9' rx='2' fill='url(#g)'/>` +
    `<ellipse cx='38' cy='76' rx='31' ry='37' fill='url(#b)'/>` +
    `<g fill='none' stroke='#5a0a06' stroke-opacity='.55' stroke-width='1.2'><ellipse cx='38' cy='76' rx='20' ry='37'/><ellipse cx='38' cy='76' rx='9' ry='37'/><path d='M38 39V113'/></g>` +
    `<text x='38' y='86' text-anchor='middle' font-size='26' font-weight='700' fill='#ffe3a3' font-family='serif'>${char}</text>` +
    `<rect x='26' y='110' width='24' height='9' rx='2' fill='url(#g)'/>` +
    `<path d='M30 119h16l-2 6h-12z' fill='#f3c86b'/>` +
    `<g stroke='#c4281b' stroke-width='1.6'><path d='M33 125v26M36 125v29M38 125v30M40 125v29M43 125v26'/></g></g></svg>`
  );
}

/** 盖碗茶：茶托、碗、碗盖，冒两缕热气；白瓷描青花 */
function cup(steam = true): string {
  return (
    `<svg ${NS} width='128' height='120' viewBox='0 0 128 120'><g><defs>` +
    `<linearGradient id='p' x1='0' x2='1'><stop offset='0' stop-color='#cfd6d8'/><stop offset='.35' stop-color='#fbfbf6'/><stop offset='1' stop-color='#b9c2c6'/></linearGradient></defs>` +
    (steam ? `<g fill='none' stroke='#fff' stroke-opacity='.35' stroke-width='2.4' stroke-linecap='round'><path d='M54 26c-6-8 6-12 0-22'/><path d='M70 28c-6-8 6-12 0-22'/></g>` : '') +
    `<ellipse cx='64' cy='106' rx='54' ry='11' fill='#000' fill-opacity='.35'/>` +
    `<ellipse cx='64' cy='100' rx='54' ry='12' fill='url(#p)'/><ellipse cx='64' cy='100' rx='54' ry='12' fill='none' stroke='#2f5aa8' stroke-width='2'/>` +
    `<ellipse cx='64' cy='97' rx='32' ry='6' fill='#000' fill-opacity='.15'/>` +
    `<path d='M28 56h72c-2 22-14 38-36 40c-22-2-34-18-36-40z' fill='url(#p)'/>` +
    `<path d='M33 70h62' stroke='#2f5aa8' stroke-width='2.4'/><path d='M38 78c6-6 12 6 18 0s12 6 18 0s12 6 18 0' fill='none' stroke='#2f5aa8' stroke-width='1.6'/>` +
    `<ellipse cx='64' cy='56' rx='36' ry='7' fill='#e9ece6'/><ellipse cx='64' cy='56' rx='36' ry='7' fill='none' stroke='#2f5aa8' stroke-width='1.6'/>` +
    `<path d='M34 54c4-14 56-14 60 0z' fill='url(#p)'/><path d='M40 50c8-6 40-6 48 0' fill='none' stroke='#2f5aa8' stroke-width='1.4'/>` +
    `<ellipse cx='64' cy='42' rx='7' ry='3' fill='#e9ece6' stroke='#2f5aa8' stroke-width='1.2'/></g></svg>`
  );
}

/** 一张小牌：象牙面、绿背的厚度，牌面由 face 画（坐标是 0..34 × 0..46） */
function tile(face: string, x: number, y: number, rot: number): string {
  return (
    `<g transform='translate(${x} ${y}) rotate(${rot} 17 46)'>` +
    `<rect x='1' y='4' width='34' height='46' rx='5' fill='#1f7a5a'/><rect width='34' height='46' rx='5' fill='#fbf6e6' stroke='#d8cdb0'/>${face}</g>`
  );
}

/** 小牌的牌面（坐标 0..34 × 0..46）：一筒、二条、某萬 */
const dot = `<circle cx='17' cy='23' r='11' fill='none' stroke='#1f5fa8' stroke-width='3'/><circle cx='17' cy='23' r='6' fill='#c0262d'/><circle cx='17' cy='23' r='2.4' fill='#fbf6e6'/>`;
const bam = `<g fill='#1f8a4c'><rect x='9' y='7' width='5' height='32' rx='2.5'/><rect x='20' y='7' width='5' height='32' rx='2.5'/></g><g fill='#0f5a33'><rect x='8' y='22' width='7' height='2'/><rect x='19' y='22' width='7' height='2'/></g>`;
const wanOf = (n: string): string =>
  `<text x='17' y='20' text-anchor='middle' font-size='15' font-weight='700' fill='#1d2a24' font-family='serif'>${n}</text><text x='17' y='40' text-anchor='middle' font-size='17' font-weight='700' fill='#c0262d' font-family='serif'>萬</text>`;
const wan = wanOf('九');

/** 散在桌上的三张牌：一筒、二条、九萬（川麻只有这三门） */
function tiles(): string {
  return (
    `<svg ${NS} width='136' height='110' viewBox='0 0 136 110'>` +
    `<ellipse cx='68' cy='96' rx='60' ry='9' fill='#000' fill-opacity='.3'/>` +
    tile(dot, 18, 46, -14) +
    tile(bam, 51, 40, 0) +
    tile(wan, 84, 46, 14) +
    `</svg>`
  );
}

/** 窗棂纹：弹窗和好友房的底纹，一格 40，线很淡，只为有点"木格窗"的意思 */
function lattice(): string {
  return `<svg ${NS} width='40' height='40'><g fill='none' stroke='#f3c86b' stroke-opacity='.06' stroke-width='1.5'><path d='M0 20H12V8H28V20H40M20 0V8M20 32V40M12 20V32H28V20'/></g></svg>`;
}

/**
 * 内联进页面的 SVG 共用一个 id 命名空间：lantern()、cup() 里的渐变 id（b、g、h、p）放进主视觉前加前缀，免得和别的内联图撞名。
 * 当 CSS 背景用（data: URL）时各是各的文档，不用改
 */
const scoped = (svg: string, pre: string): string => svg.replace(/id='(\w+)'/g, `id='${pre}$1'`).replace(/url\(#(\w+)\)/g, `url(#${pre}$1)`);

/** 一只小麻雀（"雀馆"的雀）：圆身子、浅肚皮、短尾巴，朝左站着；原点在两脚中间 */
function sparrow(): string {
  return (
    `<path d='M14-16l14-6l-2 6z' fill='#5a3a22'/>` +
    `<ellipse cx='2' cy='-14' rx='15' ry='11' fill='#8a5a34'/>` +
    `<path d='M-10-10c4 8 18 8 22 0c-4 4-18 4-22 0z' fill='#f2e2c4'/>` +
    `<path d='M4-20c6-2 12 0 14 6c-6-2-10-2-14-6z' fill='#5a3a22'/>` +
    `<circle cx='-9' cy='-24' r='8' fill='#7a4a2a'/><path d='M-14-27c3-4 9-4 11 0z' fill='#4a2a16'/>` +
    `<circle cx='-11' cy='-25' r='1.8' fill='#1a0d05'/><circle cx='-11.6' cy='-25.6' r='.6' fill='#fff'/>` +
    `<path d='M-17-24l-6 2l6 1z' fill='#3a2a1a'/>` +
    `<path d='M-2-3v3M4-3v3' stroke='#3a2a1a' stroke-width='1.6' stroke-linecap='round'/>`
  );
}

/**
 * 游戏主页的主视觉（docs/art-v3.md 第 3 节）：茶馆的夜场，三层——远景木格窗外的夜色和远处灯火，中景挂着的两盏灯笼，
 * 近景桌角上的一手牌、站在牌上的小麻雀和一碗冒热气的盖碗茶。整张是一张内联 SVG（640×480，按容器裁边铺满），
 * 会动的几样各是一个 <g>，由 art.css 的 .sc-* 只动 transform / opacity；省内存和"减少动态效果"时不动（同牌桌的摆设）
 */
export function homeScene(): string {
  const rnd = lcg(23);
  let stars = '';
  for (let i = 0; i < 14; i++) stars += `<circle cx='${r1(170 + rnd() * 300)}' cy='${r1(92 + rnd() * 90)}' r='${r1(0.6 + rnd() * 0.9)}' fill='#fff' fill-opacity='${r1(0.3 + rnd() * 0.5)}'/>`;
  // 远处的屋顶和亮着的窗：几扇窗各自慢慢明暗（sc-lit 的延迟不同）
  let lit = '';
  const wins: [number, number][] = [[188, 268], [204, 268], [300, 262], [316, 276], [404, 270], [420, 270], [448, 282]];
  wins.forEach(([x, y], i) => (lit += `<rect class='sc-lit' style='animation-delay:${-i * 1.7}s' x='${x}' y='${y}' width='8' height='10' fill='#ffcf7a'/>`));
  const fan = [wanOf('一'), dot, bam, wanOf('五'), wan];
  let hand = '';
  fan.forEach((f, i) => (hand += tile(f, 200 + i * 32, 330, (i - 2) * 5)));
  return (
    `<svg class='scene' viewBox='0 0 640 480' preserveAspectRatio='xMidYMid slice' aria-hidden='true' ${NS}><defs>` +
    `<linearGradient id='sc-night' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0c1220'/><stop offset='1' stop-color='#26324c'/></linearGradient>` +
    `<radialGradient id='sc-moon' r='.5'><stop offset='0' stop-color='#fff6d8' stop-opacity='.55'/><stop offset='1' stop-color='#fff6d8' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='sc-lamp' cx='.5' cy='.35' r='.5'><stop offset='0' stop-color='#ffb24d' stop-opacity='.32'/><stop offset='1' stop-color='#ffb24d' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='sc-felt' cx='.5' cy='0' r='1'><stop offset='0' stop-color='#1a7a58'/><stop offset='1' stop-color='#0a3d2c'/></radialGradient>` +
    `<linearGradient id='sc-rim' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8a5030'/><stop offset='1' stop-color='#3a1a0c'/></linearGradient></defs>` +
    // 远景：木格窗里的夜色、月亮、星星、远处的屋顶和灯火
    `<rect x='150' y='70' width='340' height='252' rx='4' fill='#24100a'/>` +
    `<rect x='164' y='84' width='312' height='224' fill='url(#sc-night)'/>${stars}` +
    `<circle cx='420' cy='128' r='44' fill='url(#sc-moon)'/><circle cx='420' cy='128' r='16' fill='#f6efdc' fill-opacity='.92'/>` +
    `<path d='M164 308V262l22-14l22 14v-6l30-18l34 18v-8l26-20l30 20l26-12l34 16l18-10l28 14l22-10v62z' fill='#0a0e17'/>${lit}` +
    `<g stroke='#3a1a0c' stroke-width='7'><path d='M268 84V308M372 84V308M164 160H476M164 234H476'/></g>` +
    `<g fill='none' stroke='#5a2d18' stroke-width='2'><rect x='175' y='95' width='82' height='54'/><rect x='383' y='95' width='82' height='54'/><rect x='175' y='245' width='82' height='52'/><rect x='383' y='245' width='82' height='52'/></g>` +
    `<rect x='140' y='318' width='360' height='12' rx='2' fill='#5a2d18'/>` +
    // 中景：顶灯的一团暖光、两盏灯笼
    `<ellipse cx='320' cy='200' rx='330' ry='240' fill='url(#sc-lamp)'/>` +
    `<g class='sc-sway'><svg x='84' y='-6' width='84' height='172' viewBox='0 0 76 156'>${scoped(lantern('雀'), 'sc-l1')}</svg></g>` +
    `<g class='sc-sway sc-sway2'><svg x='472' y='-6' width='84' height='172' viewBox='0 0 76 156'>${scoped(lantern('茶'), 'sc-l2')}</svg></g>` +
    // 近景：桌沿和呢子、一手牌、牌上的麻雀、盖碗茶和热气
    `<path d='M24 388H616L640 480H0z' fill='url(#sc-felt)'/>` +
    `<path d='M18 380H622L628 392H12z' fill='url(#sc-rim)'/><path d='M18 380H622' stroke='#f3c86b' stroke-opacity='.35'/>` +
    `<ellipse cx='284' cy='420' rx='110' ry='10' fill='#000' fill-opacity='.3'/>` +
    `<g transform='translate(0 -6)'>${hand}</g>` +
    `<g class='sc-bird'><g transform='translate(282 334)'>${sparrow()}</g></g>` +
    `<svg x='426' y='312' width='118' height='110' viewBox='0 0 128 120'>${scoped(cup(false), 'sc-c')}</svg>` +
    `<g fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round'>` +
    `<path class='sc-steam' d='M478 338c-6-8 6-12 0-22'/><path class='sc-steam sc-steam2' d='M492 340c-6-8 6-12 0-22'/></g>` +
    `</svg>`
  );
}

/** 启动时调一次：把各张图写成 CSS 变量（默认写在 <html> 上，所有页面和弹窗都继承得到） */
export function installArt(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--art-felt': url(felt()),
    '--art-speck': url(speck()),
    '--art-wood': url(wood('#5b2e17', '#2a1006', '#a8683a', 3)),
    '--art-wood-dark': url(wood('#3d1d0d', '#1a0803', '#7a4524', 5)),
    '--art-wall': url(wall()),
    '--art-wall-full': url(wall(false)),
    '--art-curtain': url(curtain()),
    '--art-lantern': url(lantern('茶')),
    '--art-cup': url(cup()),
    '--art-tiles': url(tiles()),
    '--art-lattice': url(lattice()),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (isLite()) root.dataset.lite = '1';
}

/**
 * 省内存设备（iOS、触屏、内存 ≤ 4GB）和"减少动态效果"：不跑常驻的小动画。
 * 为什么不单看 CSS 媒体查询：iOS 和 deviceMemory 没有对应的媒体查询，要在这里判断后写个标记给 CSS 用。
 */
function isLite(): boolean {
  const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios || mq('(pointer: coarse)') || mq('(prefers-reduced-motion: reduce)') || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
}

/** 档位卡片上的小图标（32×32）：娱乐一碗茶 → 小档一枚铜钱 → 中档一摞铜钱 → 大档银元宝 → 豪华档金元宝 */
export function stakeIcon(id: StakeIcon): string {
  const coin = (x: number, y: number, s = 1): string =>
    `<g transform='translate(${x} ${y}) scale(${s})'><circle r='9' fill='#c98a3a' stroke='#7a4a14' stroke-width='1.4'/><circle r='6.6' fill='none' stroke='#f2c27a' stroke-opacity='.7'/><rect x='-2.6' y='-2.6' width='5.2' height='5.2' fill='#3a2008'/></g>`;
  const ingot = (g: string, hi: string, mid: string, lo: string): string =>
    `<defs><linearGradient id='${g}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${hi}'/><stop offset='.5' stop-color='${mid}'/><stop offset='1' stop-color='${lo}'/></linearGradient></defs>` +
    // 图标是内联进页面的 SVG，渐变 id 全页面共用一个命名空间，所以每种元宝各起一个名字
    `<path d='M3 15c4 1 6 3 8 3h10c2 0 4-2 8-3c0 7-5 12-13 12S3 22 3 15z' fill='url(#${g})' stroke='${lo}'/>` +
    `<ellipse cx='16' cy='16' rx='6' ry='5' fill='url(#${g})' stroke='${lo}'/><ellipse cx='14.5' cy='14.5' rx='2' ry='1.4' fill='#fff' fill-opacity='.6'/>`;
  const body: Record<StakeIcon, string> = {
    fun:
      `<path d='M13 3c-2 3 2 4 0 7M19 3c-2 3 2 4 0 7' fill='none' stroke='#fff' stroke-opacity='.5' stroke-width='1.4' stroke-linecap='round'/>` +
      `<ellipse cx='16' cy='27' rx='13' ry='3' fill='#e9ece6' stroke='#2f5aa8'/><path d='M6 15h20c-1 7-4 11-10 11s-9-4-10-11z' fill='#fbfbf6' stroke='#2f5aa8'/>` +
      `<path d='M7 14c2-5 16-5 18 0z' fill='#fbfbf6' stroke='#2f5aa8'/><circle cx='16' cy='10' r='1.8' fill='#2f5aa8'/>`,
    // 好友房：两碗茶挨着
    room:
      `<g transform='translate(-6 4) scale(.62)'><ellipse cx='16' cy='27' rx='13' ry='3' fill='#e9ece6' stroke='#2f5aa8'/><path d='M6 15h20c-1 7-4 11-10 11s-9-4-10-11z' fill='#fbfbf6' stroke='#2f5aa8'/><path d='M7 14c2-5 16-5 18 0z' fill='#fbfbf6' stroke='#2f5aa8'/></g>` +
      `<g transform='translate(14 4) scale(.62)'><ellipse cx='16' cy='27' rx='13' ry='3' fill='#e9ece6' stroke='#2f5aa8'/><path d='M6 15h20c-1 7-4 11-10 11s-9-4-10-11z' fill='#fbfbf6' stroke='#2f5aa8'/><path d='M7 14c2-5 16-5 18 0z' fill='#fbfbf6' stroke='#2f5aa8'/></g>` +
      `<path d='M16 4c-1.6-2.4-5-2-5 .8c0 2.4 5 5.2 5 5.2s5-2.8 5-5.2c0-2.8-3.4-3.2-5-.8z' fill='#e04848'/>`,
    small: coin(16, 16, 1.4),
    mid: coin(16, 22) + coin(16, 17) + coin(16, 12),
    big: ingot('art-silver', '#ffffff', '#c9d2d8', '#6d7a84'),
    lux: ingot('art-gold', '#fff2b8', '#f3c86b', '#a8701c') + `<path d='M27 3l1 3l3 1l-3 1l-1 3l-1-3l-3-1l3-1z' fill='#fff6d0'/>`,
  };
  return `<svg class='art-icon' viewBox='0 0 32 32' width='32' height='32' aria-hidden='true' ${NS}>${body[id]}</svg>`;
}
