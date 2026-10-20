// 程序生成的麻将牌面：不用图片和网络字体，每种牌只生成一次。
// kind：0–8 万，9–17 筒，18–26 条，27–33 东南西北白发中（日麻）；-1 为牌背。赤五（日麻的红宝牌）是 5 万、5 筒、5 条的另一种画法，见 tileUrl 的 red。
//
// 光影只用渐变和半透明叠层，不用 filter：feGaussianBlur 一类在手机上每张牌都要单独光栅化，一桌上百张会掉帧。
// 重复的图形（饼、竹子）放进 <defs> 用 <use> 引用，每张牌只带自己用到的那几个，data URL 控制在 4 KB 内。
// 牌最小画到 22×31 像素（约 0.37 倍），细节只做到"缩小后糊成一团也不影响认牌"的程度：
// 认牌靠颜色块、个数和排布，花纹和高光是给大尺寸看的。

const FONT = `'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',sans-serif`;
const RED = '#c4232b';

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUITS = ['万', '筒', '条'];

type Color = 'b' | 'g' | 'r';
// 每种颜色三档：亮面、本色、暗面。渐变从左上亮到右下暗，像光从左上打下来
const TONES: Record<Color, [string, string, string]> = {
  b: ['#5b9be0', '#1d5aa6', '#0d3466'],
  g: ['#4fb67a', '#1a8048', '#0b4f2b'],
  r: ['#f0646a', '#c4232b', '#7d1117'],
};

// 牌身用到的渐变：象牙白正面、绿色厚度、倒角描边、左上高光
const BODY_DEFS =
  `<linearGradient id='iv' x1='0' y1='0' x2='.35' y2='1'><stop offset='0' stop-color='#fffef9'/>` +
  `<stop offset='.55' stop-color='#f7f0dc'/><stop offset='1' stop-color='#e4d7b4'/></linearGradient>` +
  `<linearGradient id='th' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2e9a6e'/>` +
  `<stop offset='.5' stop-color='#17694d'/><stop offset='1' stop-color='#0a3a2b'/></linearGradient>` +
  `<linearGradient id='bv' x1='0' y1='0' x2='.2' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.95'/>` +
  `<stop offset='.5' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#7a6334' stop-opacity='.45'/></linearGradient>` +
  `<radialGradient id='hl' cx='.25' cy='.12' r='.7'><stop offset='0' stop-color='#fff' stop-opacity='.75'/>` +
  `<stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient>`;

// 牌身：外面一整块绿（露出底部那截就是"厚度"），中间一道象牙白夹层，再盖正面；
// 正面四周一圈渐变描边当倒角（上亮下暗），绿色厚度上一道浅线当它的棱
const BODY =
  `<rect x='.7' y='.7' width='58.6' height='82.6' rx='6.6' fill='url(#th)' stroke='#06281d' stroke-width='1'/>` +
  `<path d='M5 79.6H55' stroke='#8fe0bb' stroke-opacity='.35' stroke-width='1' stroke-linecap='round'/>` +
  `<rect x='1.4' y='1.4' width='57.2' height='75.6' rx='5.9' fill='#d9cba3'/>` +
  `<rect x='1.6' y='1.4' width='56.8' height='74' rx='5.7' fill='url(#iv)'/>` +
  `<rect x='2.3' y='2.1' width='55.4' height='72.6' rx='5' fill='url(#hl)' stroke='url(#bv)' stroke-width='1.4'/>`;

// 饼：单位半径 10，用时按 translate + scale 摆放。
// 先画一个往右下偏的淡影子让饼"浮"在牌面上，外圈本色渐变、象牙白环、细色环、中心点，再加一抹高光
function pipGrad(c: Color): string {
  return (
    `<radialGradient id='q${c}' cx='.35' cy='.3' r='.8'><stop offset='0' stop-color='${TONES[c][0]}'/>` +
    `<stop offset='.55' stop-color='${TONES[c][1]}'/><stop offset='1' stop-color='${TONES[c][2]}'/></radialGradient>`
  );
}

function pipDef(c: Color): string {
  return (
    pipGrad(c) +
    `<g id='p${c}'><circle cx='.7' cy='1' r='10' fill='#4a3a18' fill-opacity='.2'/>` +
    `<circle r='10' fill='url(#q${c})'/><circle r='6.8' fill='#fffaee'/>` +
    `<circle r='5' fill='none' stroke='${TONES[c][1]}' stroke-width='1.1'/>` +
    `<circle r='2.9' fill='url(#q${c})'/>` +
    `<ellipse cx='-4.6' cy='-6.6' rx='2.6' ry='1.2' transform='rotate(-35 -4.6 -6.6)' fill='#fff' fill-opacity='.6'/></g>`
  );
}

// 竹子：横向渐变（按颜色只定义一次，objectBoundingBox 随各种尺寸伸缩）做出圆柱的明暗，两端圆头，中间一道竹节（加宽的深色箍 + 下面一道亮线），
// 上下两截各有一道淡竹纹。按"颜色 + 高 + 宽"各定义一次
function stickDef(id: string, c: Color, h: number, w: number): string {
  const x = -w / 2;
  const y = -h / 2;
  const [hi, , lo] = TONES[c];
  return (
    `<g id='${id}'><rect x='${x + 0.6}' y='${y + 0.8}' width='${w}' height='${h}' rx='${w * 0.45}' fill='#4a3a18' fill-opacity='.18'/>` +
    `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${w * 0.45}' fill='url(#s${c})' stroke='${lo}' stroke-width='.7'/>` +
    `<path d='M${x + 2.2} ${y + h * 0.25}h${w - 4.4}M${x + 2.2} ${y + h * 0.75}h${w - 4.4}' stroke='${lo}' stroke-opacity='.45' stroke-width='.8' stroke-linecap='round'/>` +
    `<rect x='${x - 0.8}' y='-1.4' width='${w + 1.6}' height='2.8' rx='1.4' fill='${lo}'/>` +
    `<path d='M${x + 1} 1.9h${w - 2}' stroke='${hi}' stroke-width='.8' stroke-linecap='round'/>` +
    `<rect x='${x + 1.5}' y='${y + 2}' width='1.4' height='${h - 4}' rx='.7' fill='#fff' fill-opacity='.45'/></g>`
  );
}

function stickGrad(c: Color): string {
  const [hi, mid, lo] = TONES[c];
  return (
    `<linearGradient id='s${c}'><stop offset='0' stop-color='${lo}'/><stop offset='.32' stop-color='${hi}'/>` +
    `<stop offset='.6' stop-color='${mid}'/><stop offset='1' stop-color='${lo}'/></linearGradient>`
  );
}

/** 一张牌面：defs 里只放这张用到的饼、竹子，正文是若干 <use> */
class Face {
  defs = '';
  body = '';
  private seen = new Set<string>();

  need(key: string, make: () => string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.defs += make();
  }

  pip(x: number, y: number, r: number, c: Color): this {
    this.need('p' + c, () => pipDef(c));
    this.body += `<use href='#p${c}' transform='translate(${x} ${y}) scale(${+(r / 10).toFixed(3)})'/>`;
    return this;
  }

  stick(x: number, y: number, h: number, c: Color, w = 9): this {
    const id = `t${c}${h}${String(w).replace('.', '')}`;
    this.need('s' + c, () => stickGrad(c));
    this.need(id, () => stickDef(id, c, h, w));
    this.body += `<use href='#${id}' x='${x}' y='${y}'/>`;
    return this;
  }
}

// 一个居中的大字：字下面先压一层往右下偏的白字，像刻进牌面里的字口反光；描一道同色细边让小尺寸时笔画不发虚
function glyph(ch: string, y: number, size: number, fill: string): string {
  return (
    `<text x='30.7' y='${y + 0.8}' font-size='${size}' font-weight='700' text-anchor='middle' font-family="${FONT}" fill='#fff' fill-opacity='.9'>${ch}</text>` +
    `<text x='30' y='${y}' font-size='${size}' font-weight='700' text-anchor='middle' font-family="${FONT}" fill='${fill}' stroke='${fill}' stroke-width='1' stroke-linejoin='round'>${ch}</text>`
  );
}

// 赤五右上角的小红点：缩小后字和饼都挤在一起，靠它一眼认出是红宝牌
const RED_DOT = `<circle cx='8.5' cy='9' r='3.4' fill='${RED}' stroke='#7d1117' stroke-width='.7'/>`;

function wan(n: number, red: boolean): string {
  return glyph(NUMS[n] ?? '', 37, 34, red ? RED : '#14213d') + glyph('萬', 70, 33, RED) + (red ? RED_DOT : '');
}

// 字牌（日麻）：风牌深蓝黑字，中红字、發绿字，白板是一圈蓝框。认牌靠颜色和字形，和数牌一样不画花纹
const HONOR_WIND = ['东', '南', '西', '北'];
function honor(n: number): string {
  if (n < 4) return glyph(HONOR_WIND[n]!, 58, 50, '#14213d');
  if (n === 4) {
    return (
      `<rect x='11' y='15' width='38' height='48' rx='3.4' fill='none' stroke='#1d5aa6' stroke-width='3.2'/>` +
      `<rect x='15.5' y='19.5' width='29' height='39' rx='1.6' fill='none' stroke='#5b9be0' stroke-width='1' stroke-opacity='.8'/>`
    );
  }
  return n === 5 ? glyph('發', 58, 48, '#1a8048') : glyph('中', 58, 52, RED);
}

// 一筒（大饼）：多层同心圆加一圈花瓣，比普通的饼多两层，缩小后仍是"一个大圆"
function bigPip(f: Face): string {
  // 大饼只借三种颜色的渐变，不带整只小饼
  f.defs = pipGrad('b') + pipGrad('g') + pipGrad('r');
  let s =
    `<circle cx='30.8' cy='39.2' r='22' fill='#4a3a18' fill-opacity='.2'/>` +
    `<circle cx='30' cy='38' r='22' fill='url(#qb)'/><circle cx='30' cy='38' r='18' fill='#fffaee'/>` +
    `<circle cx='30' cy='38' r='16.6' fill='none' stroke='#1d5aa6' stroke-width='.8' stroke-dasharray='1.6 1.6'/>` +
    `<circle cx='30' cy='38' r='14.2' fill='url(#qg)'/><circle cx='30' cy='38' r='9.6' fill='#fffaee'/>`;
  // 花瓣：绿环上一圈象牙白小点。用"长度 0 的虚线 + 圆头"一笔画出 12 个点，比 12 个 circle 省一半字节
  s += `<circle cx='30' cy='38' r='11.9' fill='none' stroke='#fffaee' stroke-width='2.6' stroke-linecap='round' stroke-dasharray='0 6.231'/>`;
  s +=
    `<circle cx='30' cy='38' r='6.4' fill='url(#qr)'/><circle cx='30' cy='38' r='2.4' fill='#fffaee'/>` +
    `<ellipse cx='19' cy='24' rx='6' ry='2.2' transform='rotate(-38 19 24)' fill='#fff' fill-opacity='.55'/>`;
  return s;
}

function tong(n: number, f: Face, red: boolean): void {
  switch (n) {
    case 0: f.body = bigPip(f); return;
    case 1: f.pip(30, 21, 13.5, 'g').pip(30, 55, 13.5, 'b'); return;
    case 2: f.pip(16.5, 17.5, 12, 'b').pip(30, 38, 12, 'r').pip(43.5, 58.5, 12, 'g'); return;
    case 3: f.pip(18, 22, 11, 'b').pip(42, 22, 11, 'g').pip(18, 54, 11, 'g').pip(42, 54, 11, 'b'); return;
    case 4:
      if (red) {
        // 赤五筒：五个饼全红
        for (const [x, y] of [[17, 20], [43, 20], [17, 56], [43, 56], [30, 38]] as const) f.pip(x, y, 10, 'r');
        f.body += RED_DOT;
        return;
      }
      f.pip(17, 20, 10, 'b').pip(43, 20, 10, 'g').pip(17, 56, 10, 'g').pip(43, 56, 10, 'b').pip(30, 38, 10, 'r');
      return;
    case 5:
      for (const x of [18, 42]) f.pip(x, 15, 9.5, 'g');
      for (const y of [40, 61]) for (const x of [18, 42]) f.pip(x, y, 9.5, 'r');
      return;
    case 6:
      f.pip(13, 13, 8.5, 'g').pip(30, 20, 8.5, 'g').pip(47, 27, 8.5, 'g');
      for (const y of [45, 62]) for (const x of [18, 42]) f.pip(x, y, 8.5, 'r');
      return;
    case 7:
      for (const y of [13, 29, 45, 61]) for (const x of [20, 40]) f.pip(x, y, 8.2, y < 38 ? 'b' : 'g');
      return;
    default:
      (['b', 'r', 'g'] as const).forEach((c, i) => {
        for (const y of [17, 38, 59]) f.pip(15 + i * 15, y, 8.5, c);
      });
  }
}

// 一条：侧身站在一截竹枝上的小鸟。认它靠"绿身子 + 红尾巴 + 黄嘴"三大块，羽毛线条只是锦上添花
function bird(): string {
  return (
    `<defs><linearGradient id='bd' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#4fb67a'/>` +
    `<stop offset='1' stop-color='#0b4f2b'/></linearGradient></defs>` +
    // 尾羽三片，扇形往右下展开
    `<path d='M37 50Q53 54 57 66Q48 62 36 57Z' fill='#1a8048' stroke='#0b4f2b' stroke-width='.7'/>` +
    `<path d='M36 53Q51 63 52 76Q43 68 34 58Z' fill='${RED}' stroke='#7d1117' stroke-width='.7'/>` +
    `<path d='M34 56Q41 69 38 78Q33 69 31 59Z' fill='#e8a317' stroke='#8a5a00' stroke-width='.7'/>` +
    // 竹枝
    `<rect x='9' y='63' width='34' height='4.4' rx='2.2' fill='#1a8048' stroke='#0b4f2b' stroke-width='.7'/>` +
    `<path d='M24 63.4v3.6' stroke='#0b4f2b' stroke-width='1.2'/><path d='M14 61Q10 56 13 52Q16 57 14 61Z' fill='#4fb67a'/>` +
    // 腿
    `<path d='M25 57l-1.5 7M30 58l.5 6' stroke='#a8740c' stroke-width='1.4' stroke-linecap='round'/>` +
    // 身子：头朝左的水滴形，红胸
    `<path d='M24 28C13 31 12 47 20 55C27 61 39 58 40 49C41 40 34 30 24 28Z' fill='url(#bd)' stroke='#0b4f2b' stroke-width='.9'/>` +
    `<path d='M17 34C12 42 15 52 22 56C20 48 20 40 17 34Z' fill='${RED}'/>` +
    // 翅膀和两道羽线
    `<path d='M26 36C36 35 43 43 40 53C33 53 27 47 26 36Z' fill='#0e5c33' stroke='#06331b' stroke-width='.7'/>` +
    `<path d='M29 41Q35 43 37 49M28 46Q32 48 34 52' stroke='#4fb67a' stroke-width='.8' fill='none' stroke-linecap='round'/>` +
    // 头、冠、嘴、眼
    `<circle cx='22' cy='22' r='8' fill='url(#bd)' stroke='#0b4f2b' stroke-width='.9'/>` +
    `<path d='M18 15L19 7L22.5 13L26 7.5L25.5 15Z' fill='${RED}' stroke='#7d1117' stroke-width='.6' stroke-linejoin='round'/>` +
    `<path d='M14.6 20.5L7.5 23.2L14.6 26Z' fill='#f2b42a' stroke='#8a5a00' stroke-width='.6' stroke-linejoin='round'/>` +
    `<circle cx='19.6' cy='20.6' r='2.4' fill='#fff'/><circle cx='19.1' cy='20.6' r='1.2' fill='#111'/>` +
    `<ellipse cx='25' cy='17' rx='2.4' ry='1.1' transform='rotate(-30 25 17)' fill='#fff' fill-opacity='.45'/>`
  );
}

function tiao(n: number, f: Face, red: boolean): void {
  switch (n) {
    case 0: f.body = bird(); return;
    case 1: f.stick(30, 21, 28, 'g').stick(30, 55, 28, 'g'); return;
    case 2: f.stick(30, 21, 28, 'g').stick(19, 55, 28, 'g').stick(41, 55, 28, 'g'); return;
    case 3: f.stick(19, 21, 28, 'g').stick(41, 21, 28, 'g').stick(19, 55, 28, 'g').stick(41, 55, 28, 'g'); return;
    case 4:
      // 赤五条：五根竹子全红
      for (const [x, y] of [[17, 21], [43, 21], [17, 55], [43, 55], [30, 38]] as const) f.stick(x, y, 28, red || (x === 30) ? 'r' : 'g');
      if (red) f.body += RED_DOT;
      return;
    case 5:
      for (const y of [21, 55]) for (const x of [14, 30, 46]) f.stick(x, y, 28, 'g');
      return;
    case 6:
      f.stick(30, 15, 18, 'r');
      for (const y of [38, 60]) for (const x of [14, 30, 46]) f.stick(x, y, 20, 'g');
      return;
    case 7:
      // 8 条传统是 M/W 形，这里取清楚优先：四列两行
      for (const y of [21, 55]) for (const x of [12, 24, 36, 48]) f.stick(x, y, 28, 'g', 8.5);
      return;
    default:
      [14, 30, 46].forEach((x, i) => {
        for (const y of [17, 38, 59]) f.stick(x, y, 19, i === 1 ? 'r' : 'g');
      });
  }
}

// 牌背：墨绿底，同样的倒角高光；一圈细金边框，框里淡淡的菱格纹，中间一枚八角徽记（两个错开 45° 的方块 + 圆心），
// 纯几何、不是任何真实商标。缩小后只剩"深绿 + 中间一个浅色徽"
// 牌背和牌墙共用的一套渐变和菱格：grid 是菱格的边长（按各自 viewBox 的单位），让缩到屏幕上的格子疏密差不多
function backDefs(grid: number): string {
  return (
    `<defs><linearGradient id='bk' x1='0' y1='0' x2='.4' y2='1'><stop offset='0' stop-color='#2a8a66'/>` +
    `<stop offset='.5' stop-color='#17614a'/><stop offset='1' stop-color='#0b3a2c'/></linearGradient>` +
    `<linearGradient id='au' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f3dc9a'/><stop offset='1' stop-color='#b48a3c'/></linearGradient>` +
    `<pattern id='lt' width='${grid}' height='${grid}' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>` +
    `<path d='M0 0H${grid}M0 0V${grid}' stroke='#7fd3ad' stroke-opacity='.28' stroke-width='${grid / 8}' fill='none'/></pattern>` +
    `<radialGradient id='hl' cx='.25' cy='.12' r='.7'><stop offset='0' stop-color='#fff' stop-opacity='.35'/>` +
    `<stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient>` +
    `<linearGradient id='sd' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fbf5e4'/><stop offset='1' stop-color='#cdbd92'/></linearGradient></defs>`
  );
}

const BACK =
  backDefs(7) +
  `<rect x='.7' y='.7' width='58.6' height='82.6' rx='6.6' fill='url(#bk)' stroke='#06281d' stroke-width='1'/>` +
  `<rect x='2' y='2' width='56' height='80' rx='5.4' fill='url(#hl)' stroke='#fff' stroke-opacity='.22' stroke-width='1'/>` +
  `<rect x='6.5' y='6.5' width='47' height='71' rx='4' fill='url(#lt)' stroke='url(#au)' stroke-width='1.3'/>` +
  `<rect x='9' y='9' width='42' height='66' rx='2.6' fill='none' stroke='#e7cf8a' stroke-opacity='.45' stroke-width='.6'/>` +
  `<circle cx='30' cy='42' r='15' fill='#0e4a37' stroke='url(#au)' stroke-width='1.4'/>` +
  `<rect x='21' y='33' width='18' height='18' fill='none' stroke='url(#au)' stroke-width='1.6'/>` +
  `<rect x='21' y='33' width='18' height='18' transform='rotate(45 30 42)' fill='none' stroke='url(#au)' stroke-width='1.6'/>` +
  `<circle cx='30' cy='42' r='5' fill='url(#au)'/><circle cx='30' cy='42' r='1.8' fill='#0e4a37'/>`;

/** 赤五：5 万、5 筒、5 条的牌种 */
const RED_KINDS: readonly number[] = [4, 13, 22];

function face(kind: number, red: boolean): string {
  const n = kind % 9;
  if (kind < 9) return wan(n, red);
  if (kind >= 27) return honor(kind - 27);
  const f = new Face();
  if (kind < 18) tong(n, f, red);
  else tiao(n, f, red);
  return (f.defs ? `<defs>${f.defs}</defs>` : '') + f.body;
}

/** 这个牌种有没有赤五的画法（5 万、5 筒、5 条） */
export const hasRed = (kind: number): boolean => RED_KINDS.includes(kind);

/** 一张牌的完整 SVG 字符串（含牌身），viewBox="0 0 60 84"；kind = -1 画成牌背；red 是赤五（不是 5 万 5 筒 5 条时当普通牌） */
export function tileSvg(kind: number, red = false): string {
  const inner = kind < 0 || kind > 33 || !Number.isInteger(kind) ? BACK : `<defs>${BODY_DEFS}</defs>${BODY}${face(kind, red && hasRed(kind))}`;
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 84'>${inner}</svg>`;
}

const cache = new Map<number, string>();

// 只转义 data URL 里真正有歧义的字符（引号、%、#、尖括号和非 ASCII），
// 比 encodeURIComponent 整串转义小一半多；属性一律单引号，放进 CSS 的 url("…") 里不冲突
function svgUrl(svg: string): string {
  return 'data:image/svg+xml,' + svg.replace(/["%#<>\u0080-\uffff]/g, encodeURIComponent);
}

/** 同上但做成 data URI，模块内缓存，每种只生成一次；赤五的缓存键是牌种 + 100 */
export function tileUrl(kind: number, red = false): string {
  const ok = kind >= 0 && kind <= 33 && Number.isInteger(kind);
  const isRed = ok && red && hasRed(kind);
  const key = !ok ? -1 : isRed ? kind + 100 : kind;
  let u = cache.get(key);
  if (!u) {
    u = svgUrl(tileSvg(key > 100 ? key - 100 : key, isRed));
    cache.set(key, u);
  }
  return u;
}

/** 牌背 */
export function backUrl(): string {
  return tileUrl(-1);
}

// 牌墙里的一张：比手里的牌小得多（对家一张约 16×24、左右两家约 24×12 像素），只留"墨绿背 + 金边 + 中间一个小菱徽"，
// 底下露一截象牙白的牌身厚度：一张挨一张排起来，厚度连成一条浅色的边，看得出是一墩墩立着的牌。
// 金边离边缘留了空，相邻两张之间自然有一道深缝，不用另画分隔线
const WALL = {
  // 对家：竖着立的牌，viewBox 32×48（屏幕上 16×24 的两倍，方便写坐标）
  h:
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 48'>${backDefs(4)}` +
    `<rect x='.5' y='.5' width='31' height='47' rx='3.2' fill='url(#sd)' stroke='#06281d' stroke-width='1'/>` +
    `<path d='M3 44.6H29' stroke='#fff' stroke-opacity='.7' stroke-width='.8' stroke-linecap='round'/>` +
    `<rect x='.5' y='.5' width='31' height='39' rx='3.2' fill='url(#bk)' stroke='#06281d' stroke-width='1'/>` +
    `<rect x='1.4' y='1.4' width='29.2' height='37.2' rx='2.5' fill='url(#hl)' stroke='#fff' stroke-opacity='.2' stroke-width='.7'/>` +
    `<rect x='4' y='4' width='24' height='32' rx='1.8' fill='url(#lt)' stroke='url(#au)' stroke-width='1'/>` +
    `<path d='M16 13.5L22.5 20L16 26.5L9.5 20Z' fill='#0e4a37' stroke='url(#au)' stroke-width='1.1'/>` +
    `<circle cx='16' cy='20' r='2.2' fill='url(#au)'/></svg>`,
  // 左右两家：侧着看的牌，viewBox 48×24（屏幕上 24×12 的两倍），厚度同样露在下沿
  v:
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 24'>${backDefs(4)}` +
    `<rect x='.5' y='.5' width='47' height='23' rx='2.6' fill='url(#sd)' stroke='#06281d' stroke-width='1'/>` +
    `<path d='M3 21.2H45' stroke='#fff' stroke-opacity='.7' stroke-width='.7' stroke-linecap='round'/>` +
    `<rect x='.5' y='.5' width='47' height='17' rx='2.6' fill='url(#bk)' stroke='#06281d' stroke-width='1'/>` +
    `<rect x='1.3' y='1.3' width='45.4' height='15.4' rx='2' fill='url(#hl)' stroke='#fff' stroke-opacity='.2' stroke-width='.6'/>` +
    `<rect x='3.5' y='3.2' width='41' height='11.6' rx='1.4' fill='url(#lt)' stroke='url(#au)' stroke-width='.9'/>` +
    `<path d='M24 5L28 9L24 13L20 9Z' fill='#0e4a37' stroke='url(#au)' stroke-width='.9'/>` +
    `<circle cx='24' cy='9' r='1.3' fill='url(#au)'/></svg>`,
};
const wallCache: Partial<Record<'h' | 'v', string>> = {};

/** 牌墙里的一张立体牌背：'h' 对家（宽:高 = 16:24），'v' 左右两家（24:12）；每种只生成一次 */
export function wallUrl(side: 'h' | 'v'): string {
  return (wallCache[side] ??= svgUrl(WALL[side]));
}

const HONOR_NAME = ['东', '南', '西', '北', '白', '发', '中'] as const;

/** 中文名：'一万' '五筒' '七条' '东' '白'；赤五前面加"赤" */
export function tileName(kind: number, red = false): string {
  if (!Number.isInteger(kind) || kind < 0 || kind > 33) return '';
  if (kind >= 27) return HONOR_NAME[kind - 27]!;
  return (red && hasRed(kind) ? '赤' : '') + (NUMS[kind % 9] ?? '') + (SUITS[Math.floor(kind / 9)] ?? '');
}
