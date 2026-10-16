/**
 * 场景类美术：牌桌、标题主视觉、logo、favicon、印章、粒子、名牌底板。
 */
import { bustSvgBody as avatarSvgBodyScaled } from './avatars.ts';
import { cardBackSvg, cardFaceSvg } from './cards.ts';
import { C, SERIF, cloudPath, esc, f, hashStr, hex, huiwenRow, prng, shade, suitShape, svg } from './common.ts';

/** 把一段完整 SVG 去掉外壳、给 id 加前缀，便于嵌进另一张图（避免 id 冲突） */
function inlineSvg(src: string, prefix: string, x: number, y: number, w: number, h: number, extra = ''): string {
  const m = /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/.exec(src);
  if (!m) return '';
  const body = (m[2] ?? '').replace(/id="([^"]+)"/g, `id="${prefix}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`);
  return `<svg x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" viewBox="${m[1] ?? ''}" ${extra}>${body}</svg>`;
}

/** 牌桌背景：红木边框（拉长噪声做木纹）+ 渐变漆金嵌线 + 中心亮四周暗的墨绿绒面（细绒噪点）+ 极淡的墨印"掼"与金环。
 *  不再手画几十条木纹路径：一个 feTurbulence 滤镜就够，字符串小，手机按世界宽度栅格化一次也省。顶上约 58px 会被顶栏盖住，所以那里只放木色，不放细节 */
export function tableSvg(w: number, h: number): string {
  const B = 28;
  const cx = w / 2, cy = h / 2;
  const R = h * 0.3;
  const iw = w - 2 * B, ih = h - 2 * B;
  return svg(w, h,
    `<defs>` +
    `<linearGradient id="wdh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a2e1c"/><stop offset=".5" stop-color="#58210f"/><stop offset="1" stop-color="#34120a"/></linearGradient>` +
    // 木纹：横向很稀、纵向很密的噪声 = 沿边长方向的细长纹；着成褐色，alpha 由噪声决定
    `<filter id="wgr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".008 .18" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 .13  0 0 0 0 .04  0 0 0 0 .02  0 0 0 1.5 -.45"/></filter>` +
    `<linearGradient id="gil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".3" stop-color="${C.gold}"/><stop offset=".5" stop-color="#f6e29a"/><stop offset=".75" stop-color="${C.goldDeep}"/><stop offset="1" stop-color="${C.gold}"/></linearGradient>` +
    `<radialGradient id="fl" cx=".5" cy=".46" r=".72"><stop offset="0" stop-color="#35885f"/><stop offset=".5" stop-color="#206044"/><stop offset="1" stop-color="#082419"/></radialGradient>` +
    `<radialGradient id="lit" cx=".5" cy=".46" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<filter id="nz" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0"/></filter>` +
    `<clipPath id="fc"><rect x="${B}" y="${B}" width="${iw}" height="${ih}" rx="16"/></clipPath>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#wdh)"/>` +
    `<rect width="${w}" height="${h}" filter="url(#wgr)"/>` +
    // 漆面反光：边框上缘一道淡亮
    `<rect x="3" y="3" width="${w - 6}" height="${f(B * 0.5)}" rx="6" fill="#fff" opacity=".07"/>` +
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="none" stroke="#1c0a05" stroke-width="3" opacity=".7"/>` +
    // 漆金嵌线：外细内粗两道
    `<rect x="${B - 9}" y="${B - 9}" width="${iw + 18}" height="${ih + 18}" rx="22" fill="none" stroke="#1c0a05" stroke-width="4.2" opacity=".6"/>` +
    `<rect x="${B - 9}" y="${B - 9}" width="${iw + 18}" height="${ih + 18}" rx="22" fill="none" stroke="url(#gil)" stroke-width="2.4"/>` +
    `<rect x="${B}" y="${B}" width="${iw}" height="${ih}" rx="16" fill="url(#fl)"/>` +
    `<g clip-path="url(#fc)">` +
    `<rect width="${w}" height="${h}" fill="url(#lit)"/>` +
    `<rect width="${w}" height="${h}" filter="url(#nz)" opacity=".2"/>` +
    // 桌心的主装饰：回纹圆章（tableEmblem）
    tableEmblem(cx, cy, R) +
    // 内侧阴影（木沿投在绒面上）
    `<rect x="${B}" y="${B}" width="${iw}" height="${ih}" rx="16" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="14"/>` +
    `<rect x="${B}" y="${B}" width="${iw}" height="${ih}" rx="16" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="30"/>` +
    `</g>` +
    `<rect x="${B}" y="${B}" width="${iw}" height="${ih}" rx="16" fill="none" stroke="${C.goldDeep}" stroke-width="2"/>`);
}

/**
 * 桌心圆章：外圈回纹带、双金线，四方祥云、四角花色，正中一方凸起的"掼"字印。
 * 出牌区就在桌心，所以整枚都是"同色压花"：墨绿暗面 + 极淡金线，远看是绒布上的织纹，不抢牌面。
 */
function tableEmblem(cx: number, cy: number, R: number): string {
  const ink = '#04140c';
  const at = (deg: number, r: number): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  // 回纹带：40 个回字单元沿圆周排一圈，每个单元按自己的角度转正
  const u = 15;
  const n = 40;
  let band = '';
  for (let i = 0; i < n; i++) band += `<path transform="rotate(${f((360 / n) * i)} ${f(cx)} ${f(cy)})" d="${huiwenRow(cx - u / 2, cy - R - 31, u, 1)}"/>`;
  let clouds = '';
  for (const deg of [-90, 0, 90, 180]) {
    const [x, y] = at(deg, R - 44);
    clouds += `<path transform="rotate(${f(deg + 90)} ${f(x)} ${f(y)})" d="${cloudPath(x, y, 72)}"/>`;
  }
  let suits = '';
  [-45, 45, 135, 225].forEach((deg, i) => {
    const [x, y] = at(deg, R - 52);
    suits += suitShape([0, 1, 2, 3][i]!, x, y, 30, ink, false, 'opacity=".2"');
  });
  const S = R * 0.84;
  const sx = cx - S / 2;
  const sy = cy - S / 2;
  return `<g fill="none" stroke="${C.gold}" stroke-linecap="square">` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R + 38)}" stroke-width="1.5" opacity=".14"/>` +
    `<g stroke-width="2" opacity=".15">${band}</g>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" stroke-width="2.6" opacity=".17"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R - 9)}" stroke-width="1" opacity=".14"/>` +
    `<g stroke-width="2.4" opacity=".16" stroke-linecap="round">${clouds}</g></g>` +
    suits +
    // 正中的字印：暗面方章 + 金色双框；字用压花：先一层暗字，再往左上错 2 的极淡亮字，像从绒布里凸出来
    `<rect x="${f(sx)}" y="${f(sy)}" width="${f(S)}" height="${f(S)}" rx="18" fill="${ink}" opacity=".07"/>` +
    `<rect x="${f(sx)}" y="${f(sy)}" width="${f(S)}" height="${f(S)}" rx="18" fill="none" stroke="${C.gold}" stroke-width="2.4" opacity=".18"/>` +
    `<rect x="${f(sx + 9)}" y="${f(sy + 9)}" width="${f(S - 18)}" height="${f(S - 18)}" rx="11" fill="none" stroke="${C.gold}" stroke-width="1" opacity=".14"/>` +
    `<text x="${f(cx)}" y="${f(cy + S * 0.27)}" font-family='${SERIF}' font-weight="900" font-size="${f(S * 0.76)}" fill="${ink}" opacity=".13" text-anchor="middle">掼</text>` +
    `<text x="${f(cx - 2)}" y="${f(cy + S * 0.27 - 2)}" font-family='${SERIF}' font-weight="900" font-size="${f(S * 0.76)}" fill="#fff" opacity=".045" text-anchor="middle">掼</text>`;
}

/** 灯笼：中心 (x,y)，尺寸 s（1 = 宽 90） */
function lantern(x: number, y: number, s: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">` +
    `<circle r="120" fill="url(#lglow)"/>` +
    `<path d="M0 -140V-62" stroke="#2a140a" stroke-width="3"/>` +
    `<rect x="-24" y="-64" width="48" height="12" rx="3" fill="${C.gold}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<ellipse cx="0" cy="0" rx="52" ry="56" fill="url(#lred)" stroke="${C.ink}" stroke-width="3"/>` +
    `<path d="M0 -56C-24 -40 -24 40 0 56M0 -56C24 -40 24 40 0 56M-28 -46C-46 -20 -46 20 -28 46M28 -46C46 -20 46 20 28 46" fill="none" stroke="#7d1218" stroke-width="2.4" opacity=".75"/>` +
    `<text y="14" font-family='${SERIF}' font-weight="900" font-size="38" fill="${C.goldLight}" text-anchor="middle" opacity=".95">福</text>` +
    `<rect x="-24" y="52" width="48" height="12" rx="3" fill="${C.gold}" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="M-12 64V100M-4 64V106M4 64V106M12 64V100" stroke="#d6302c" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cy="66" r="5" fill="${C.goldLight}" stroke="${C.ink}" stroke-width="1.5"/></g>`;
}

/** 盖碗茶杯 */
function teacup(x: number, y: number, s: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">` +
    `<ellipse cx="0" cy="38" rx="44" ry="10" fill="#000" opacity=".3"/>` +
    `<ellipse cx="0" cy="32" rx="38" ry="9" fill="#e9e2d2" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="M-30 -4C-28 22 -14 32 0 32C14 32 28 22 30 -4Z" fill="#f7f2e6" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="M-22 10Q0 18 22 10" fill="none" stroke="#2f6fa8" stroke-width="2.5"/><path d="M-8 20q8-6 16 0" fill="none" stroke="#2f6fa8" stroke-width="2"/>` +
    `<ellipse cx="0" cy="-4" rx="32" ry="8" fill="#f7f2e6" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<path d="M-26 -8C-22 -22 22 -22 26 -8Z" fill="#fbf8f0" stroke="${C.ink}" stroke-width="2.5"/>` +
    `<circle cx="0" cy="-20" r="5" fill="#2f6fa8" stroke="${C.ink}" stroke-width="2"/>` +
    `<path d="M-6 -34C-12 -46 0 -52 -6 -64M8 -32C2 -44 14 -50 8 -62" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/></g>`;
}

/** 标题页主视觉：茶馆一角，月洞窗、灯笼、八仙桌、四位牌友；右侧 40% 偏暗留给按钮 */
export function titleArtSvg(w: number, h: number): string {
  const sx = h / 720; // 竖向基准缩放（布局按 720 高设计）
  const wx = Math.min(w * 0.3, 520 * sx);
  const wy = 300 * sx;
  const wr = 230 * sx;
  // 月洞窗格子（方格 + 斜向冰裂纹简化成菱格）
  let lattice = '';
  for (let i = -6; i <= 6; i++) {
    const o = i * 38 * sx;
    lattice += `M${f(wx + o)} ${f(wy - wr)}V${f(wy + wr)}M${f(wx - wr)} ${f(wy + o)}H${f(wx + wr)}`;
  }
  // 桌面四边形
  const tl = -60 * sx, tr = w * 0.6;
  const backY = 486 * sx, frontY = 640 * sx;
  const table = `<path d="M${f(tl + 40)} ${f(backY)}L${f(tr - 30)} ${f(backY)}L${f(tr + 40)} ${f(frontY)}L${f(tl)} ${f(frontY)}Z" fill="url(#tbl)" stroke="#2a1206" stroke-width="3"/>` +
    `<path d="M${f(tl + 40)} ${f(backY + 4)}L${f(tr - 30)} ${f(backY + 4)}" stroke="#d99a5a" stroke-width="2" opacity=".5"/>` +
    // 桌面中间铺一块墨绿牌毯
    `<path d="M${f(w * 0.08)} ${f(backY + 18 * sx)}L${f(w * 0.5)} ${f(backY + 18 * sx)}L${f(w * 0.54)} ${f(frontY - 22 * sx)}L${f(w * 0.04)} ${f(frontY - 22 * sx)}Z" fill="url(#mat)" stroke="${C.gold}" stroke-width="2"/>` +
    // 桌沿（牙板）带回纹
    `<path d="M${f(tl)} ${f(frontY)}L${f(tr + 40)} ${f(frontY)}L${f(tr + 40)} ${f(frontY + 46 * sx)}L${f(tl)} ${f(frontY + 46 * sx)}Z" fill="#4a1f0e" stroke="#2a1206" stroke-width="3"/>` +
    `<path d="${huiwenRow(0, frontY + 12 * sx, 22 * sx, Math.floor((tr + 40) / (22 * sx)))}" fill="none" stroke="${C.gold}" stroke-width="2" opacity=".75"/>` +
    `<rect x="${f(tl)}" y="${f(frontY + 46 * sx)}" width="${f(tr + 40 - tl)}" height="${f(h)}" fill="#2e1208"/>`;
  // 人物（头肩，放大），先画在桌后
  const people: Array<[string, number, number, number, number]> = [
    // [svg, 中心 x, 底 y, 缩放, 旋转]
    [avatarSvgBodyScaled('laozhang', 'smug'), w * 0.085, backY + 30 * sx, 1.75 * sx, -4],
    [avatarSvgBodyScaled('xiaomei', 'normal'), w * 0.235, backY + 20 * sx, 1.6 * sx, 2],
    [avatarSvgBodyScaled('aqiang', 'happy'), w * 0.385, backY + 26 * sx, 1.7 * sx, 5],
    [avatarSvgBodyScaled('me', 'happy'), w * 0.525, backY + 34 * sx, 1.65 * sx, -3],
  ];
  let ppl = '';
  for (const [body, x, by, s, r] of people) {
    ppl += `<g transform="translate(${f(x)} ${f(by)}) rotate(${r}) scale(${f(s)}) translate(-80 -160)">` +
      `<ellipse cx="80" cy="150" rx="70" ry="20" fill="#000" opacity=".25"/>${body}</g>`;
  }
  // 桌上散牌（嵌套 SVG，压扁一点表示平放）
  const cw = 88 * sx, ch = 123 * sx;
  const lay: Array<[string, number, number, number]> = [
    [cardFaceSvg(14, 0), w * 0.12, 520, -18],
    [cardFaceSvg(13, 1), w * 0.16, 512, -6],
    [cardFaceSvg(17, -1), w * 0.2, 508, 6],
    [cardFaceSvg(12, 3), w * 0.24, 512, 18],
    [cardBackSvg(0), w * 0.33, 520, -8],
    [cardBackSvg(0), w * 0.35, 516, 4],
    [cardFaceSvg(11, 2), w * 0.43, 524, 14],
    [cardFaceSvg(10, 1), w * 0.47, 530, 26],
  ];
  let cards = '';
  lay.forEach(([src, x, y, r], i) => {
    cards += `<g transform="translate(${f(x)} ${f(y * sx)}) scale(1 .62) rotate(${r})"><rect x="${f(-cw / 2 + 3)}" y="${f(-ch / 2 + 5)}" width="${f(cw)}" height="${f(ch)}" rx="${f(6 * sx)}" fill="#000" opacity=".35"/>${inlineSvg(src, `c${i}`, -cw / 2, -ch / 2, cw, ch)}</g>`;
  });
  // 筹码（铜钱）
  let coins = '';
  for (let i = 0; i < 4; i++) coins += `<g transform="translate(${f(w * 0.075 + i * 6)} ${f(600 * sx - i * 6 * sx)}) scale(${f(sx)} ${f(sx * 0.5)})"><circle r="20" fill="${C.gold}" stroke="${C.ink}" stroke-width="3"/><rect x="-6" y="-6" width="12" height="12" fill="#2e1208"/></g>`;
  return svg(w, h,
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a2a17"/><stop offset=".55" stop-color="#3c1a0f"/><stop offset="1" stop-color="#1c0c07"/></linearGradient>` +
    `<radialGradient id="warm" cx="${f(wx / w)}" cy="${f(wy / h)}" r=".7"><stop offset="0" stop-color="#ffb35c" stop-opacity=".45"/><stop offset=".6" stop-color="#ff8a3c" stop-opacity=".08"/><stop offset="1" stop-color="#ff8a3c" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="win" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#ffe3a8"/><stop offset=".6" stop-color="#f3a75a"/><stop offset="1" stop-color="#b8542a"/></radialGradient>` +
    `<radialGradient id="lglow"><stop offset="0" stop-color="#ffb04a" stop-opacity=".5"/><stop offset="1" stop-color="#ff8030" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="lred" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ff6a4a"/><stop offset=".55" stop-color="#d0262c"/><stop offset="1" stop-color="#7d1218"/></radialGradient>` +
    `<linearGradient id="tbl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4424"/><stop offset="1" stop-color="#5a2412"/></linearGradient>` +
    `<linearGradient id="mat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a6e4c"/><stop offset="1" stop-color="#174a32"/></linearGradient>` +
    `<linearGradient id="dark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>` +
    `<radialGradient id="vig" cx=".4" cy=".45" r=".85"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>` +
    `<clipPath id="wc"><circle cx="${f(wx)}" cy="${f(wy)}" r="${f(wr)}"/></clipPath>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#wall)"/>` +
    // 墙面竖向木板线
    `<g stroke="#000" stroke-opacity=".18" stroke-width="2">${Array.from({ length: Math.ceil(w / 90) }, (_, i) => `<path d="M${i * 90} 0V${h}"/>`).join('')}</g>` +
    // 月洞窗
    `<circle cx="${f(wx)}" cy="${f(wy)}" r="${f(wr + 18 * sx)}" fill="#2a1206"/>` +
    `<circle cx="${f(wx)}" cy="${f(wy)}" r="${f(wr)}" fill="url(#win)"/>` +
    `<g clip-path="url(#wc)">` +
    // 窗外：远山、竹影
    `<path d="M${f(wx - wr)} ${f(wy + 60 * sx)}Q${f(wx - 120 * sx)} ${f(wy - 30 * sx)} ${f(wx - 30 * sx)} ${f(wy + 40 * sx)}T${f(wx + wr)} ${f(wy + 20 * sx)}V${f(wy + wr)}H${f(wx - wr)}Z" fill="#c9773f" opacity=".55"/>` +
    `<g stroke="#7a3a1a" stroke-opacity=".35" stroke-width="${f(6 * sx)}" stroke-linecap="round"><path d="M${f(wx + 120 * sx)} ${f(wy + wr)}Q${f(wx + 110 * sx)} ${f(wy)} ${f(wx + 140 * sx)} ${f(wy - wr)}"/><path d="M${f(wx + 160 * sx)} ${f(wy + wr)}Q${f(wx + 170 * sx)} ${f(wy)} ${f(wx + 150 * sx)} ${f(wy - wr)}"/></g>` +
    `<path d="${lattice}" stroke="#3b1d0c" stroke-width="${f(7 * sx)}" opacity=".85"/>` +
    `</g>` +
    `<circle cx="${f(wx)}" cy="${f(wy)}" r="${f(wr)}" fill="none" stroke="#6b3a1e" stroke-width="${f(14 * sx)}"/>` +
    `<circle cx="${f(wx)}" cy="${f(wy)}" r="${f(wr + 9 * sx)}" fill="none" stroke="${C.gold}" stroke-width="${f(2 * sx)}" opacity=".7"/>` +
    `<rect width="${w}" height="${h}" fill="url(#warm)"/>` +
    lantern(w * 0.035 + 30 * sx, 150 * sx, 0.95 * sx) +
    lantern(w * 0.47, 120 * sx, 0.8 * sx) +
    ppl +
    table + cards + coins + teacup(w * 0.53, 560 * sx, 0.9 * sx) +
    `<rect width="${w}" height="${h}" fill="url(#dark)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#vig)"/>`);
}

/** 标题字"掼蛋"：金边红字，透明底。seal 为真时右边加一枚竖排小印"单机版"（0.3.0 起好友房一直露出，不再用）；为假时不画小印，字挪到正中 */
export function logoSvg(seal = true): string {
  const t = (extra: string) => `<text x="20" y="178" font-family='${SERIF}' font-weight="900" font-size="176" textLength="380" lengthAdjust="spacingAndGlyphs" ${extra}>掼蛋</text>`;
  const word =
    t(`fill="#000" opacity=".35" transform="translate(5 7)"`) +
    t(`fill="none" stroke="#2a1206" stroke-width="18" stroke-linejoin="round"`) +
    t(`fill="none" stroke="url(#gg)" stroke-width="9" stroke-linejoin="round"`) +
    t(`fill="url(#rg)"`);
  // 小印章
  const stamp =
    `<g transform="rotate(4 448 112)"><rect x="420" y="46" width="56" height="140" rx="6" fill="${C.red}" stroke="#2a1206" stroke-width="3"/>` +
    `<rect x="426" y="52" width="44" height="128" rx="3" fill="none" stroke="${C.goldLight}" stroke-width="2"/>` +
    ['单', '机', '版'].map((c, i) => `<text x="448" y="${90 + i * 38}" font-family='${SERIF}' font-weight="900" font-size="32" fill="${C.goldLight}" text-anchor="middle">${c}</text>`).join('') + `</g>`;
  return svg(520, 220,
    `<defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2434a"/><stop offset=".55" stop-color="${C.red}"/><stop offset="1" stop-color="#7d1218"/></linearGradient>` +
    `<linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#a0701f"/></linearGradient></defs>` +
    (seal ? word + stamp : `<g transform="translate(50 0)">${word}</g>`));
}

/** favicon：红色圆角方 + 金色"掼" */
export function faviconSvg(): string {
  return svg(64, 64,
    `<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d23a40"/><stop offset="1" stop-color="#8a141c"/></linearGradient></defs>` +
    `<rect x="2" y="2" width="60" height="60" rx="13" fill="url(#r)" stroke="${C.gold}" stroke-width="3"/>` +
    `<rect x="7" y="7" width="50" height="50" rx="9" fill="none" stroke="${C.goldLight}" stroke-width="1" opacity=".6"/>` +
    `<text x="32" y="47" font-family='${SERIF}' font-weight="900" font-size="42" fill="${C.goldLight}" text-anchor="middle">掼</text>`);
}

/** 印章：方章、双边框、磨损斑驳，透明底；text 1–2 个汉字 */
export function stampSvg(text: string, color: string): string {
  const r = prng(hashStr(text + color));
  let holes = '';
  for (let i = 0; i < 45; i++) {
    const x = 18 + r() * 164, y = 18 + r() * 164;
    holes += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.6 + r() * r() * 2.6)}"/>`;
  }
  // 边缘缺口
  for (let i = 0; i < 18; i++) {
    const side = Math.floor(r() * 4);
    const p = 24 + r() * 152;
    const [x, y] = side === 0 ? [p, 22] : side === 1 ? [178, p] : side === 2 ? [p, 178] : [22, p];
    holes += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(2 + r() * 5)}" ry="${f(1.5 + r() * 3)}" transform="rotate(${f(r() * 180)} ${f(x)} ${f(y)})"/>`;
  }
  const chars = [...text].slice(0, 2);
  const one = chars.length <= 1;
  const glyph = one
    ? `<text x="100" y="140" font-family='${SERIF}' font-weight="900" font-size="112" fill="${color}" text-anchor="middle">${esc(chars[0] ?? '')}</text>`
    : `<text x="100" y="128" font-family='${SERIF}' font-weight="900" font-size="76" fill="${color}" text-anchor="middle" textLength="134" lengthAdjust="spacingAndGlyphs">${esc(chars.join(''))}</text>`;
  return svg(200, 200,
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200"><rect width="200" height="200" fill="#fff"/><g fill="#000">${holes}</g>` +
    `<path d="M30 60L80 40M120 170L176 140" stroke="#000" stroke-width="2" opacity=".7"/></mask></defs>` +
    `<g transform="rotate(-8 100 100)" mask="url(#m)" opacity=".92">` +
    `<rect x="22" y="22" width="156" height="156" rx="16" fill="none" stroke="${color}" stroke-width="11"/>` +
    `<rect x="36" y="36" width="128" height="128" rx="8" fill="none" stroke="${color}" stroke-width="3"/>` +
    // 印泥边上一圈淡金，和牌桌漆金嵌线呼应
    `<rect x="17" y="17" width="166" height="166" rx="20" fill="none" stroke="${C.goldLight}" stroke-width="1.2" opacity=".5"/>` +
    glyph + `</g>`);
}

/** 粒子：32×32 */
export function particleSvg(kind: 'spark' | 'petal' | 'coin' | 'confetti' | 'star' | 'smoke'): string {
  switch (kind) {
    case 'spark':
      return svg(32, 32, `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#ffe08a"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="16" cy="16" r="15" fill="url(#g)"/><path d="M16 1L18 14L31 16L18 18L16 31L14 18L1 16L14 14Z" fill="#fff8d8"/>`);
    case 'petal':
      return svg(32, 32, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd3dc"/><stop offset="1" stop-color="#e8607a"/></linearGradient></defs>` +
        `<path d="M16 3C24 8 28 16 24 24C21 29 16 30 12 28C6 24 5 16 8 10C10 6 13 4 16 3Z" fill="url(#g)"/><path d="M15 7Q17 18 13 26" fill="none" stroke="#c9405a" stroke-width="1.2" opacity=".6"/>`);
    case 'coin':
      return svg(32, 32, `<defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff0b0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#8a5e18"/></radialGradient></defs>` +
        `<circle cx="16" cy="16" r="14" fill="url(#g)" stroke="#6b4510" stroke-width="1.6"/><circle cx="16" cy="16" r="10.5" fill="none" stroke="#8a5e18" stroke-width="1"/>` +
        `<rect x="12" y="12" width="8" height="8" fill="#5a3a0c" stroke="#fff0b0" stroke-width="1"/>`);
    case 'confetti':
      return svg(32, 32, `<rect x="9" y="4" width="14" height="24" rx="2" fill="${C.red}" transform="rotate(25 16 16)"/><rect x="9" y="4" width="7" height="24" rx="2" fill="#fff" opacity=".2" transform="rotate(25 16 16)"/><path d="M12 9L20 23" stroke="${C.goldLight}" stroke-width="2.4" transform="rotate(25 16 16)"/>`);
    case 'star':
      return svg(32, 32, `<path d="M16 2L20 11.5L30 12.4L22.4 19L24.7 29L16 23.8L7.3 29L9.6 19L2 12.4L12 11.5Z" fill="${C.goldLight}" stroke="${C.goldDeep}" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 7L18 13L13 12Z" fill="#fff" opacity=".7"/>`);
    case 'smoke':
      return svg(32, 32, `<defs><radialGradient id="g" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#d7d4d0" stop-opacity=".85"/><stop offset=".7" stop-color="#9a9590" stop-opacity=".45"/><stop offset="1" stop-color="#7a7570" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="13" cy="17" r="11" fill="url(#g)"/><circle cx="20" cy="13" r="10" fill="url(#g)"/><circle cx="19" cy="21" r="9" fill="url(#g)"/>`);
  }
}

/** 名牌底板：漆器质感 + 金边 + 两端祥云，viewBox 0 0 200 64 */
export function seatPlateSvg(color: number): string {
  const c = hex(color);
  return svg(200, 64,
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.18)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.4)}"/></linearGradient>` +
    `<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".45" stop-color="${C.gold}"/><stop offset=".7" stop-color="#f6e29a"/><stop offset="1" stop-color="${C.goldDeep}"/></linearGradient></defs>` +
    `<rect x="2" y="4" width="196" height="58" rx="14" fill="#000" opacity=".3"/>` +
    `<rect x="2" y="2" width="196" height="56" rx="14" fill="url(#p)" stroke="url(#pg)" stroke-width="2.8"/>` +
    // 漆面上半一层淡高光，下沿一道深线，像刷过几遍的大漆
    `<path d="M10 6H190Q196 6 196 14V26Q100 34 4 26V14Q4 6 10 6Z" fill="#fff" opacity=".1"/>` +
    `<rect x="4" y="4" width="192" height="52" rx="12" fill="none" stroke="#1c0a05" stroke-width="1" opacity=".5"/>` +
    `<rect x="7" y="7" width="186" height="46" rx="10" fill="none" stroke="${C.goldLight}" stroke-width="1" opacity=".55"/>` +
    `<path d="M16 8H184" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".14"/>` +
    `<path d="${cloudPath(22, 32, 22)}" fill="none" stroke="${C.goldLight}" stroke-width="1.4" opacity=".7"/>` +
    `<path d="${cloudPath(178, 32, 22)}" fill="none" stroke="${C.goldLight}" stroke-width="1.4" opacity=".7" transform="scale(-1 1) translate(-356 0)"/>`);
}
