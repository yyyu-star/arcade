/**
 * 开始菜单（主页）的主视觉。坐标系沿用原来那张 1600×900 的整图（世界坐标 = 这里 × 0.8）。
 *
 * 0.14.0（art-v3 ①）拆成几层，分别加载、在画面里叠起来，才能做视差、待机动作，并且铺满不是 16:9 的窗口：
 * - 天空在画面里用渐变和光带直接画（不占图片）；
 * - scene/title_city.svg：远处的 K 线城市，比原图左右各宽 400（窗口变宽时露出来）；
 * - scene/title_hills.svg：山坡和后排的小人，同样加宽，往下画到 1040；
 * - scene/title_house.svg：炒股小屋（窗里亮着显示器、烟变成 K 线）；
 * - scene/title_bubble_<0..5>.svg：六个群聊气泡（头像 + 图形，没有字），画面里依次弹出；
 * - scene/title_cloud.svg：一朵云，画面里慢慢飘。
 * 前排的股票小人不烤进图里，由画面用 StockGuy 摆（会眨眼、会跳）。
 *
 * 小人和头像直接复用生成器输出，嵌入前把每份 SVG 的 id 按出现顺序重编号，保证结果确定、互不冲突。
 */
import { readFileSync } from 'node:fs';
import { avatarSvg } from './avatars.ts';
import { INK, WHITE, darken, ellipseD, frag, grained, hiArc, lighten, merge, rng, rrectD, shape, smoothClosed, starD, svgDoc } from './lib/svg.ts';
import { buildStock, type StockSpec } from './stocks.ts';

const W = 1600;

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

let embedNo = 0;
/** 每份输出文档开始前调用，保证嵌入的 id 编号确定 */
export function resetEmbeds(): void {
  embedNo = 0;
}
/** 把一份完整 SVG 嵌成子 <svg>，id 统一重编号 */
export function embed(doc: string, x: number, y: number, w: number, h: number, flip = false): string {
  const k = ++embedNo;
  const vb = /viewBox="([^"]+)"/.exec(doc)![1]!;
  let inner = doc.slice(doc.indexOf('>', doc.indexOf('<svg')) + 1, doc.lastIndexOf('</svg>'));
  const ids: string[] = [];
  inner.replace(/\bid="([^"]+)"/g, (_m, id: string) => {
    if (!ids.includes(id)) ids.push(id);
    return '';
  });
  const map = new Map(ids.map((id, i) => [id, `e${k}_${i}`]));
  inner = inner.replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${map.get(id)}"`).replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${map.get(id) ?? id})`);
  const [, , vw] = vb.split(' ').map(Number);
  const body = flip ? `<g transform="translate(${vw} 0) scale(-1 1)">${inner}</g>` : inner;
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb}" overflow="visible">${body}</svg>`;
}

export function stockSpecs(): Map<string, StockSpec> {
  const src = JSON.parse(readFileSync(new URL('./stocks.json', import.meta.url).pathname, 'utf8')) as { stocks: StockSpec[] };
  return new Map(src.stocks.map((s) => [s.id, s]));
}

/** 站在地面 (gx, gy) 上、显示尺寸 size 的小人 */
export function stock(specs: Map<string, StockSpec>, id: string, expr: string, gx: number, gy: number, size: number, flip = false): string {
  const spec = specs.get(id);
  if (!spec) throw new Error(`no stock ${id}`);
  const out = buildStock(spec);
  const doc = out.files.get(`${id}/${expr}.svg`)!;
  const top = gy - (116 / 128) * size;
  return embed(doc, gx - size / 2, top, size, size, flip);
}

function city(x0 = -20, x1 = W + 20): string {
  // 远处的 K 线城市：一排红绿方楼（淡紫雾里）
  const r = rng(77);
  let s = '';
  let x = x0;
  while (x < x1) {
    const w = 40 + Math.floor(r() * 50);
    const h = 90 + Math.floor(r() * 170);
    const up = r() > 0.42;
    const col = up ? '#f4a0a0' : '#9fd6b0';
    s += `<rect x="${x}" y="${700 - h}" width="${w}" height="${h + 40}" rx="4" fill="${col}"/>`;
    s += `<rect x="${x + w / 2 - 2}" y="${700 - h - 26}" width="4" height="26" fill="${col}"/>`;
    for (let wy = 700 - h + 16; wy < 680; wy += 26) for (let wx = x + 9; wx < x + w - 12; wx += 16) if (r() > 0.45) s += `<rect x="${wx}" y="${wy}" width="7" height="9" rx="1.5" fill="#fff6e0" fill-opacity="0.8"/>`;
    x += w + 6 + Math.floor(r() * 18);
  }
  return `<g opacity="0.55">${s}</g><rect x="${x0}" y="560" width="${x1 - x0}" height="200" fill="#ffe8cc" fill-opacity="0.45"/>`;
}

function house(): string {
  const cx = 800;
  const base = 840;
  const wall = shape(`M${cx - 170} ${base}V${base - 190}H${cx + 170}V${base}Z`, {
    fill: '#fff1d6',
    shade: '#f0d8b0',
    shadeOffset: [-14, -10],
    sw: 6,
    extra:
      line(`M${cx - 170} ${base - 150}H${cx + 170}M${cx - 170} ${base - 70}H${cx + 170}`, '#e8c99a', 4) +
      // 大窗：亮着的显示器和台灯
      `<rect x="${cx - 140}" y="${base - 160}" width="170" height="120" rx="12" fill="#ffe28a" stroke="${INK}" stroke-width="6"/>` +
      `<rect x="${cx - 112}" y="${base - 138}" width="90" height="60" rx="6" fill="#3a3448" stroke="${INK}" stroke-width="4"/><rect x="${cx - 104}" y="${base - 130}" width="74" height="44" rx="3" fill="#bfefff"/>` +
      line(`M${cx - 98} ${base - 94}l14 -14 10 8 22 -22`, '#ff4d4d', 5) + `<rect x="${cx - 74}" y="${base - 78}" width="14" height="14" fill="#3a3448"/>` +
      line(`M${cx - 55} ${base - 160}V${base - 40}M${cx - 140} ${base - 100}H${cx + 30}`, INK, 5) +
      // 窗台上睡觉的猫
      `<path d="M${cx - 18} ${base - 40}Q${cx - 16} ${base - 70} ${cx + 12} ${base - 66}Q${cx + 36} ${base - 64} ${cx + 34} ${base - 40}Z" fill="#ffb066" stroke="${INK}" stroke-width="4"/>` +
      `<path d="M${cx - 10} ${base - 62}l-2 -12 10 8zM${cx + 6} ${base - 66}l4 -11 6 10z" fill="#ffb066" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>` +
      line(`M${cx - 6} ${base - 52}q4 3 8 0M${cx + 8} ${base - 52}q4 3 8 0`, INK, 3) +
      `<rect x="${cx - 150}" y="${base - 44}" width="190" height="12" rx="4" fill="#c98a4a" stroke="${INK}" stroke-width="4"/>` +
      // 门
      `<path d="M${cx + 70} ${base}V${base - 120}Q${cx + 70} ${base - 150} ${cx + 105} ${base - 150}Q${cx + 140} ${base - 150} ${cx + 140} ${base - 120}V${base}Z" fill="#c9773f" stroke="${INK}" stroke-width="6"/>` +
      `<circle cx="${cx + 126}" cy="${base - 66}" r="6" fill="#ffd23f" stroke="${INK}" stroke-width="3"/>` + line(`M${cx + 82} ${base - 110}h46M${cx + 82} ${base - 80}h46`, '#a85a2a', 4) +
      hiArc(`M${cx - 156} ${base - 176}h60`, 6, 0.6),
  });
  const roofD = `M${cx - 210} ${base - 180}L${cx} ${base - 300}L${cx + 210} ${base - 180}Z`;
  const roof = shape(roofD, {
    fill: '#e8704a',
    shade: '#c8502e',
    shadeOffset: [-10, -10],
    sw: 6,
    extra: [0, 1, 2, 3].map((i) => line(`M${cx - 180 + i * 18} ${base - 186 - i * 10}L${cx + 180 - i * 18} ${base - 186 - i * 10}`, '#d65e3a', 4)).join('') + hiArc(`M${cx - 150} ${base - 200}L${cx - 40} ${base - 264}`, 6, 0.5),
  });
  // 烟囱和变成 K 线的烟
  const chimney = `<rect x="${cx + 90}" y="${base - 300}" width="44" height="90" fill="#b85a3a" stroke="${INK}" stroke-width="6"/><rect x="${cx + 82}" y="${base - 312}" width="60" height="18" rx="4" fill="#9a4a2e" stroke="${INK}" stroke-width="5"/>`;
  const smoke = [[cx + 128, base - 326, 16], [cx + 176, base - 340, 20], [cx + 232, base - 344, 22]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity="0.85" stroke="${INK}" stroke-width="3" stroke-opacity="0.35"/>`).join('') +
    line(`M${cx + 262} ${base - 298}L${cx + 290} ${base - 320}L${cx + 314} ${base - 310}L${cx + 340} ${base - 338}`, '#ff5a4a', 7) + `<path d="M${cx + 326} ${base - 344}L${cx + 350} ${base - 348}L${cx + 346} ${base - 324}Z" fill="#ff5a4a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
  const steps = `<rect x="${cx + 58}" y="${base - 6}" width="94" height="14" rx="4" fill="#cfc3b0" stroke="${INK}" stroke-width="4"/>`;
  const plant = `<path d="M${cx - 230} ${base}L${cx - 236} ${base - 40}H${cx - 184}L${cx - 190} ${base}Z" fill="#e9875a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    [[-20, -70], [0, -84], [20, -66]].map(([dx, dy]) => `<path d="M${cx - 210} ${base - 40}Q${cx - 210 + dx! - 6} ${base - 40 + dy! / 2} ${cx - 210 + dx!} ${base - 40 + dy!}Q${cx - 210 + dx! + 8} ${base - 40 + dy! / 2} ${cx - 204} ${base - 40}Z" fill="#62c95a" stroke="${INK}" stroke-width="3.4"/>`).join('');
  return frag(chimney + smoke).content + merge(roof, wall).content + steps + plant;
}

/** 群聊气泡：头像 + 气泡，气泡里是图形（没有文字） */
function chatBubble(avatar: string, face: 'normal' | 'smug' | 'awkward', x: number, y: number, w: number, inner: (bx: number, by: number) => string, right = false): string {
  const av = embed(avatarSvg(avatar, face), right ? x + w + 10 : x, y, 76, 76);
  const bx = right ? x : x + 88;
  const bw = w;
  const bubble = shape(rrectD(bx, y + 6, bw, 74, 24), { fill: right ? '#fff1a8' : WHITE, shade: right ? '#f0dc80' : '#ece4f0', shadeOffset: [-5, -5], sw: 5 });
  const tail = right
    ? `<path d="M${bx + bw - 6} ${y + 28}L${bx + bw + 14} ${y + 34}L${bx + bw - 6} ${y + 46}Z" fill="#fff1a8" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M${bx + bw - 8} ${y + 30}V${y + 44}" stroke="#fff1a8" stroke-width="6"/>`
    : `<path d="M${bx + 6} ${y + 28}L${bx - 14} ${y + 34}L${bx + 6} ${y + 46}Z" fill="${WHITE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M${bx + 8} ${y + 30}V${y + 44}" stroke="${WHITE}" stroke-width="6"/>`;
  return `<g>${tail}${merge(bubble).content}${av}${inner(bx, y + 6)}</g>`;
}

const upArrow = (x: number, y: number, c = '#ff4d4d') => `<path transform="translate(${x} ${y})" d="M0 -22L18 0H8V20H-8V0H-18Z" fill="${c}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const downArrow = (x: number, y: number) => `<path transform="translate(${x} ${y})" d="M0 22L18 0H8V-20H-8V0H-18Z" fill="#2fbf6a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const flame = (x: number, y: number) => `<path transform="translate(${x} ${y})" d="M0 -24Q14 -10 12 4Q10 18 0 20Q-12 18 -12 4Q-12 -6 -4 -12Q-4 -2 2 0Q4 -12 0 -24Z" fill="#ff7a33" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const rocket = (x: number, y: number) =>
  `<g transform="translate(${x} ${y}) rotate(40)"><path d="M0 -26Q12 -12 10 12H-10Q-12 -12 0 -26Z" fill="#eef2f8" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cx="0" cy="-6" r="5" fill="#5ec8ff" stroke="${INK}" stroke-width="3"/><path d="M-6 12L0 26L6 12Z" fill="#ffb347" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></g>`;
const dots = (x: number, y: number) => [0, 1, 2].map((i) => `<circle cx="${x + i * 22}" cy="${y}" r="7" fill="#b8a6c8"/>`).join('');
const coin = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="17" fill="#ffd23f" stroke="${INK}" stroke-width="4"/><path d="${starD(x, y + 1, 8)}" fill="#f0a020"/>`;
const question = (x: number, y: number) => line(`M${x - 9} ${y - 8}Q${x - 9} ${y - 20} ${x + 1} ${y - 20}Q${x + 12} ${y - 20} ${x + 12} ${y - 10}Q${x + 12} ${y - 3} ${x + 2} ${y + 1}V${y + 7}`, '#7a5ad8', 7) + `<circle cx="${x + 2}" cy="${y + 18}" r="4.5" fill="#7a5ad8"/>`;

/** 加宽后的范围（原图坐标）：左右各多 400，窗口到 21:9 也铺得满 */
const BX0 = -400;
const BX1 = W + 400;

/** 把原图坐标里 (x0, y0) 起、w×h 的一块单独存成一张图 */
function layerDoc(x0: number, y0: number, w: number, h: number, f: ReturnType<typeof frag>): string {
  return svgDoc(w, h, { defs: f.defs, content: `<g transform="translate(${-x0} ${-y0})">${f.content}</g>` });
}

export const CITY_BOX = { x: BX0, y: 420, w: BX1 - BX0, h: 360 } as const;
export const HILLS_BOX = { x: BX0, y: 620, w: BX1 - BX0, h: 420 } as const;
export const HOUSE_BOX = { x: 560, y: 470, w: 640, h: 400 } as const;

function cityLayer(): string {
  const B = CITY_BOX;
  return layerDoc(B.x, B.y, B.w, B.h, frag(city(BX0 - 20, BX1 + 20)));
}

/** 山坡加宽、往下画到 1040；后排小人烤进来（前排由画面摆） */
function hillsLayer(): string {
  embedNo = 0;
  const specs = stockSpecs();
  const B = HILLS_BOX;
  const bottom = B.y + B.h;
  const ground =
    `<path d="M${BX0} 730Q${BX0 + 200} 660 0 720Q300 640 620 700Q800 730 980 700Q1300 640 1600 710Q1800 650 ${BX1} 720V${bottom}H${BX0}Z" fill="#b8dc8a" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M${BX0} 810Q0 760 400 790Q800 840 1200 800Q1600 760 ${BX1} 800V${bottom}H${BX0}Z" fill="#9fcf72"/>` +
    `<path d="M${BX0} 870Q300 830 800 866Q1300 900 ${BX1} 856V${bottom}H${BX0}Z" fill="#88c060"/>` +
    [-260, -90, 120, 330, 1270, 1480, 1690, 1880, 640, 960].map((x, i) => line(`M${x} ${820 + (i % 3) * 18}l6 -14l6 14M${x + 16} ${826 + (i % 3) * 18}l5 -11l5 11`, '#6aa84a', 4)).join('');
  // 后排小人（小、站在坡上）：原图的六个加上加宽部分各两个
  const back: [string, string, number, number, number, boolean?][] = [
    ['la_leader', 'calm', -280, 748, 118], ['fin_follower', 'happy', -120, 756, 124],
    ['ne_follower2', 'happy', 150, 760, 130], ['con_follower2', 'calm', 290, 744, 130], ['gm_follower2', 'happy', 420, 752, 126],
    ['ai_follower2', 'happy', 1180, 752, 126, true], ['ph_follower', 'worried', 1310, 744, 128, true], ['la_follower', 'happy', 1450, 760, 130, true],
    ['gm_leader', 'happy', 1700, 756, 124, true], ['ph_leader', 'calm', 1860, 748, 118, true],
  ];
  const people = back.map(([id, e, x, y, sz, f]) => stock(specs, id, e, x, y, sz, f)).join('');
  return layerDoc(B.x, B.y, B.w, B.h, merge(grained(frag(ground), 0.06, [BX0, 600, BX1 - BX0, 440]), frag(people)));
}

function houseLayer(): string {
  const B = HOUSE_BOX;
  const shadow = `<ellipse cx="800" cy="846" rx="260" ry="18" fill="${INK}" fill-opacity="0.15"/>`;
  return layerDoc(B.x, B.y, B.w, B.h, frag(shadow + house()));
}

/** 六个群聊气泡：左边三个（白底）、右边三个（黄底），每个单独一张（画面里依次弹出） */
export const BUBBLES: { avatar: string; face: 'normal' | 'smug' | 'awkward'; w: number; right: boolean; inner: (bx: number, by: number) => string }[] = [
  { avatar: 'qunzhu', face: 'smug', w: 210, right: false, inner: (bx, by) => upArrow(bx + 46, by + 38) + flame(bx + 100, by + 40) + rocket(bx + 160, by + 38) },
  { avatar: 'laowang', face: 'normal', w: 170, right: false, inner: (bx, by) => coin(bx + 48, by + 38) + dots(bx + 86, by + 38) },
  { avatar: 'xiaoli', face: 'awkward', w: 150, right: false, inner: (bx, by) => downArrow(bx + 44, by + 38) + question(bx + 100, by + 38) },
  { avatar: 'dav', face: 'smug', w: 190, right: true, inner: (bx, by) => upArrow(bx + 42, by + 38) + upArrow(bx + 92, by + 38) + upArrow(bx + 142, by + 38) },
  {
    avatar: 'zhangjie',
    face: 'normal',
    w: 150,
    right: true,
    inner: (bx, by) =>
      `<path d="M${bx + 52} ${by + 54}C${bx + 26} ${by + 36} ${bx + 30} ${by + 18} ${bx + 42} ${by + 18}C${bx + 48} ${by + 18} ${bx + 52} ${by + 24} ${bx + 52} ${by + 26}C${bx + 52} ${by + 24} ${bx + 56} ${by + 18} ${bx + 62} ${by + 18}C${bx + 74} ${by + 18} ${bx + 78} ${by + 36} ${bx + 52} ${by + 54}Z" fill="#ff7a9a" stroke="${INK}" stroke-width="4"/>` +
      dots(bx + 88, by + 38),
  },
  {
    avatar: 'neimu',
    face: 'smug',
    w: 230,
    right: true,
    inner: (bx, by) =>
      dots(bx + 40, by + 38) + `<rect x="${bx + 116}" y="${by + 20}" width="34" height="30" rx="6" fill="#ffd23f" stroke="${INK}" stroke-width="4"/><path d="M${bx + 122} ${by + 20}v-8q11 -12 22 0v8" fill="none" stroke="${INK}" stroke-width="5"/>` + flame(bx + 186, by + 40),
  },
];
/** 一个气泡图的尺寸（原图单位）：头像 76 + 间隔 + 气泡宽 + 尾巴，上下留出描边 */
export function bubbleSize(i: number): { w: number; h: number } {
  return { w: BUBBLES[i]!.w + 104, h: 92 };
}

function bubbleLayer(i: number): string {
  embedNo = 0;
  const b = BUBBLES[i]!;
  const { w, h } = bubbleSize(i);
  // 气泡画在 (8, 6) 起：左边的头像在左、右边的头像在右
  return layerDoc(-8, -6, w, h, frag(chatBubble(b.avatar, b.face, 0, 0, b.w, b.inner, b.right)));
}

function cloudLayer(): string {
  const pts: [number, number][] = [[-60, 18], [-70, -2], [-40, -26], [-6, -34], [30, -26], [62, -8], [60, 18]];
  const d = smoothClosed(pts.map(([x, y]) => [100 + x * 1.4, 56 + y * 1.4] as [number, number]), 1);
  return svgDoc(200, 90, frag(`<path d="${d}" fill="#ffffff" fill-opacity="0.8"/>`));
}

/**
 * 拼好的一整张（1600×900，和画面里的摆法一样）：游戏不加载，给 README 的配图和平台大厅的封面用
 * （封面怎么出见 public/assets/art/README.md）。前排小人在这里烤进去（画面里是活的）。
 */
function compositeDoc(): string {
  const specs = stockSpecs();
  const at = (doc: string, x: number, y: number, w: number, h: number): string => embed(doc, x, y, w, h);
  const sky =
    `<defs><linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="760"><stop offset="0" stop-color="#ffc98f"/><stop offset="0.45" stop-color="#ffe2b8"/><stop offset="1" stop-color="#fff3dc"/></linearGradient></defs>` +
    `<rect width="${W}" height="900" fill="url(#sky)"/>`;
  // 各层生成时会把嵌入编号清零：先都生成好，再从一个大编号开始嵌，id 不会撞
  const docs = { city: cityLayer(), hills: hillsLayer(), house: houseLayer(), bubbles: BUBBLES.map((_, i) => bubbleLayer(i)) };
  embedNo = 1000;
  const city = at(docs.city, CITY_BOX.x, CITY_BOX.y, CITY_BOX.w, CITY_BOX.h);
  const hills = at(docs.hills, HILLS_BOX.x, HILLS_BOX.y, HILLS_BOX.w, HILLS_BOX.h);
  // 画面里小屋按原图 0.7 倍、中心在 800，脚下 862（世界 690 ÷ 0.8）
  const k = 0.7 / 0.8;
  const house = at(docs.house, 800 - 240 * k, 862 - 370 * k, HOUSE_BOX.w * k, HOUSE_BOX.h * k);
  const front: [string, string, number, number, number, boolean?][] = [
    ['ai_leader', 'happy', 90, 872, 178], ['con_blue', 'calm', 260, 885, 170], ['fin_blue', 'calm', 435, 878, 160], ['st_ghost', 'worried', 598, 882, 112],
    ['fin_leader', 'happy', 1008, 885, 130, true], ['pig_leader', 'limitup', 1162, 878, 170, true], ['ai_meme', 'happy', 1338, 885, 165, true], ['ne_meme', 'happy', 1495, 872, 175, true],
  ];
  const people = front.map(([id, e, x, y, sz, f]) => stock(specs, id, e, x, y, sz, f)).join('');
  const ys = [210, 310, 410];
  const bubbles = BUBBLES.map((b, i) => {
    const { w, h } = bubbleSize(i);
    const sc = 0.72 / 0.8;
    return at(docs.bubbles[i]!, b.right ? 1570 - w * sc : 30, ys[i % 3]!, w * sc, h * sc);
  }).join('');
  return svgDoc(W, 900, frag(sky + city + hills + house + people + bubbles));
}

export function build(write: (rel: string, data: string) => void): number {
  write('scene/title_city.svg', cityLayer());
  write('scene/title_hills.svg', hillsLayer());
  write('scene/title_house.svg', houseLayer());
  BUBBLES.forEach((_, i) => write(`scene/title_bubble_${i}.svg`, bubbleLayer(i)));
  write('scene/title_cloud.svg', cloudLayer());
  write('scene/title_keyart.svg', compositeDoc());
  return 5 + BUBBLES.length;
}

export { darken, ellipseD, lighten };
