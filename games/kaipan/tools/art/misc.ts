/**
 * 其他界面贴图：账单卡、印章、持仓卡框、纸面板、按钮、标签、角色小徽章。
 * 印章和账单上不写字，文字由画面层叠加（见 README 的文字区域约定）。
 */
import { INK, WHITE, type Frag, darken, frag, grained, hiArc, merge, rrectD, shape, starD, svgDoc } from './lib/svg.ts';

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

// ---------------------------------------------------------------- 账单卡 320×400

function billCard(): Frag {
  let zig = 'M10 14Q10 8 16 8H304Q310 8 310 14V372';
  for (let x = 310, i = 0; x > 10; x -= 12, i++) zig += `L${Math.max(10, x - 6)} ${i % 2 === 0 ? 384 : 372}`;
  zig += 'L10 372Z';
  const shadow = frag(`<path d="${zig}" transform="translate(5 7)" fill="${INK}" fill-opacity="0.22"/>`);
  const paper = shape(zig, {
    fill: '#fffaf0',
    shade: '#f1e6d2',
    shadeOffset: [-6, -6],
    sw: 3.5,
    extra:
      `<path d="M10 14Q10 8 16 8H304Q310 8 310 14V74H10Z" fill="#ff8f84"/>` +
      `<path d="M10 74H310" stroke="${INK}" stroke-width="3"/>` +
      // 头部的小房子（房贷 / 月供）
      `<g transform="translate(46 41)"><path d="M-18 2L0 -15L18 2" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M-13 0V15H13V0L0 -11Z" fill="${WHITE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><rect x="-4" y="5" width="8" height="10" rx="1.5" fill="#ffd23f" stroke="${INK}" stroke-width="2"/><rect x="8" y="-13" width="5" height="8" fill="${WHITE}" stroke="${INK}" stroke-width="2"/></g>` +
      // 打孔线与明细占位
      `<path d="M24 94H296" stroke="#e8d8bf" stroke-width="2.4" stroke-dasharray="2 6" stroke-linecap="round"/>` +
      [126, 170, 214].map((y) => `<path d="M30 ${y}H290" stroke="#ead9bf" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>`).join('') +
      `<path d="M24 252H296M24 258H296" stroke="#d9c4a2" stroke-width="2"/>` +
      `<rect x="24" y="276" width="272" height="64" rx="10" fill="#fff1b8" stroke="#e8c870" stroke-width="2.4"/>` +
      hiArc('M20 90v40', 3, 0.5),
  });
  // 回形针
  const clip = frag(
    `<path d="M262 -2V40Q262 50 272 50Q282 50 282 40V6Q282 0 276 0Q270 0 270 6V36" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M262 -2V40Q262 50 272 50Q282 50 282 40V6Q282 0 276 0Q270 0 270 6V36" fill="none" stroke="#cfd8e6" stroke-width="2.6" stroke-linecap="round"/>`,
  );
  return merge(shadow, grained(paper, 0.09, [0, 0, 330, 410]), frag(`<g transform="translate(0 6)">${clip.content}</g>`));
}

// ---------------------------------------------------------------- 印章

function stampRough(id: string, w: number, h: number): [string, string] {
  return [
    id,
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="warp"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="wob"/>` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="9" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -6.1" result="holes"/>` +
      `<feComposite in="wob" in2="holes" operator="out"/></filter>`,
  ];
}

/** 已还清：圆形双圈红章，中间留空给文字 */
function stampPaid(): Frag {
  const c = '#e23b2e';
  const f = frag();
  const [id, def] = stampRough('rough', 160, 160);
  f.defs.set(id, def);
  let s = `<circle cx="80" cy="80" r="70" fill="none" stroke="${c}" stroke-width="7"/>`;
  s += `<circle cx="80" cy="80" r="59" fill="none" stroke="${c}" stroke-width="2.6"/>`;
  s += `<path d="${starD(80, 33, 9)}" fill="${c}"/>`;
  s += `<path d="${starD(36, 82, 5)}" fill="${c}"/><path d="${starD(124, 82, 5)}" fill="${c}"/>`;
  s += `<path d="M46 112H114" stroke="${c}" stroke-width="3"/><path d="M58 122H102" stroke="${c}" stroke-width="3"/>`;
  f.content = `<g filter="url(#rough)" opacity="0.92">${s}</g>`;
  return f;
}

/** 逾期：长方形双框章，四角缺口，两端警示斜纹，中间留空给文字 */
function stampOverdue(): Frag {
  const c = '#4b3a7a';
  const f = frag();
  const [id, def] = stampRough('rough', 220, 110);
  f.defs.set(id, def);
  const notch = (x: number, y: number, w: number, h: number, r: number) =>
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 0 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 0 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 0 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 0 ${x + r} ${y}Z`;
  let s = `<path d="${notch(8, 8, 204, 94, 12)}" fill="none" stroke="${c}" stroke-width="7"/>`;
  s += `<path d="${notch(20, 20, 180, 70, 6)}" fill="none" stroke="${c}" stroke-width="2.6"/>`;
  s += `<clipPath id="ends"><rect x="20" y="20" width="26" height="70"/><rect x="174" y="20" width="26" height="70"/></clipPath>`;
  let stripes = '';
  for (let x = -60; x < 240; x += 12) stripes += `<path d="M${x} 100L${x + 50} 10" stroke="${c}" stroke-width="5"/>`;
  s += `<g clip-path="url(#ends)">${stripes}</g>`;
  s += `<path d="M46 20V90M174 20V90" stroke="${c}" stroke-width="2.6"/>`;
  f.content = `<g filter="url(#rough)" opacity="0.92">${s}</g>`;
  return f;
}

// ---------------------------------------------------------------- 九宫格

/** 持仓卡框：64×64，九宫格四角 18px。米色纸 + 深色描边 + 底部厚边 */
function cardHolding(): Frag {
  return merge(
    frag(`<rect x="3" y="6" width="58" height="56" rx="14" fill="${darken('#f3e2c4', 0.2)}" stroke="${INK}" stroke-width="3"/>`),
    shape(rrectD(3, 2, 58, 54, 14), { fill: '#fffaf0', shade: '#f3e6d0', shadeOffset: [-4, -4], sw: 3 }),
    frag(`<rect x="9" y="8" width="46" height="42" rx="9" fill="none" stroke="#ead9bf" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>`),
  );
}

/** 纸面板：64×64，九宫格四角 20px（题材看板、弹窗） */
function panelPaper(): Frag {
  return merge(
    frag(`<rect x="4" y="6" width="56" height="54" rx="16" fill="${INK}" fill-opacity="0.18"/>`),
    shape(rrectD(2, 2, 58, 56, 16), { fill: '#fff4e2', shade: '#f2e0c4', shadeOffset: [-4, -4], sw: 3 }),
  );
}

/** 大按钮：96×48，九宫格左右各 24px、上下各 16px。糖果橙 + 底部厚边 + 高光 */
function buttonBig(color: string): Frag {
  return merge(
    frag(`<rect x="3" y="8" width="90" height="37" rx="18" fill="${darken(color, 0.3)}" stroke="${INK}" stroke-width="3"/>`),
    shape(rrectD(3, 3, 90, 36, 18), { fill: color, shade: darken(color, 0.12), shadeOffset: [0, -5], sw: 3 }),
    frag(hiArc('M18 12H78', 4, 0.55) + `<circle cx="14" cy="14" r="2" fill="#ffffff" fill-opacity="0.8"/>`),
  );
}

/** 标签胶囊：40×20，九宫格左右各 10px；白底，运行时着色 */
function tagPill(): Frag {
  return frag(`<rect x="1.5" y="1.5" width="37" height="17" rx="8.5" fill="${WHITE}" stroke="${INK}" stroke-width="2.4"/>`);
}

/**
 * 纸纹平铺 128×128：透明底上的细颗粒（stitchTiles 保证无缝），叠在九宫格面板上增加纸张质感。
 * 九宫格本身不带颗粒，否则拉伸后颗粒会被拉成条纹。
 */
function paperTile(): Frag {
  return frag(
    `<filter id="pt" filterUnits="userSpaceOnUse" x="0" y="0" width="128" height="128" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0 0.2  0.3 0 0 0 -0.12"/></filter>` +
      `<rect width="128" height="128" filter="url(#pt)"/>`,
  );
}

// ---------------------------------------------------------------- 角色小徽章 24×24

const ROLE_ICONS: Record<string, () => Frag> = {
  leader: () =>
    shape('M3 18L2 7L8 12L12 4L16 12L22 7L21 18Z', {
      fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-2, -2], sw: 2,
      extra: `<circle cx="12" cy="4" r="1.6" fill="#ff5d7a"/>`,
    }),
  follower: () => frag(line('M6 22V3', INK, 3.6) + line('M6 22V3', '#c98a4a', 1.4) + `<path d="M6.5 3.5Q13 2 21 7Q13 10 6.5 12Z" fill="#ffcf3a" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
  bluechip: () =>
    frag(`<path d="M5 3L12 7L19 3L18 8L12 9L6 8Z" fill="${WHITE}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 7.5H14.5L13.5 10.5H10.5Z" fill="#4a64d0" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.5 10.5L13.5 10.5L15.5 18L12 22L8.5 18Z" fill="#3047a8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 15l4 -1.5" stroke="#9fb0ff" stroke-width="1.2"/>`),
  meme: () => frag(`<path d="M14 1L5 13H11L8 23L19 9H13L16 1Z" fill="#ffe14a" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
  st: () =>
    frag(
      `<g transform="rotate(-40 12 12)"><rect x="1.5" y="8" width="21" height="8" rx="4" fill="#ffe0bd" stroke="${INK}" stroke-width="1.8"/><rect x="9" y="9.3" width="6" height="5.4" rx="1" fill="#f2bf8c"/></g>`,
    ),
};

export function build(write: (rel: string, data: string) => void): number {
  const list: [string, number, number, Frag][] = [
    ['bill_card', 320, 400, billCard()],
    ['stamp_paid', 160, 160, stampPaid()],
    ['stamp_overdue', 220, 110, stampOverdue()],
    ['card_holding', 64, 64, cardHolding()],
    ['panel_paper', 64, 64, panelPaper()],
    ['button_big', 96, 48, buttonBig('#ff7a3d')],
    ['button_buy', 96, 48, buttonBig('#5a8dff')],
    ['tag_pill', 40, 20, tagPill()],
    ['paper_tile', 128, 128, paperTile()],
  ];
  for (const [role, fn] of Object.entries(ROLE_ICONS)) list.push([`role_${role}`, 24, 24, fn()]);
  for (const [name, w, h, f] of list) write(`ui/${name}.svg`, svgDoc(w, h, f));
  return list.length;
}
