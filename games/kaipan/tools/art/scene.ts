/**
 * 炒股小屋：1280×720 分层背景。
 *
 * 层序（下→上）：sky_<bull|flat|bear> → city → haze_bear（仅熊）→ rain（仅熊）→ lightning / lightning_2 / lightning_3（仅熊，随机闪一个）→ wall → desk → steam →
 *              cat → cat_tail → cat_zzz → ambient_<bull|flat|bear> → lamp_light → monitor_glow
 * 窗洞：x 420–860，y 56–336。天色、城市、雨只在窗洞里可见，但都画满全画布，方便做视差平移。
 */
import {
  INK, type Frag, ellipseD, frag, grained, merge, rng, rrectD, shape, smoothClosed, svgDoc,
} from './lib/svg.ts';

const W = 1280;
const H = 720;
const FULL: [number, number, number, number] = [0, 0, W, H];
const WIN = { x: 420, y: 56, w: 440, h: 280, r: 18 };

function doc(f: Frag): string {
  return svgDoc(W, H, f);
}

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

function cloud(cx: number, cy: number, s: number, fill: string, shade: string, sw = 4): Frag {
  const pts: [number, number][] = [
    [-60, 10], [-56, -8], [-38, -18], [-20, -34], [6, -36], [26, -22], [46, -26], [62, -10], [64, 10],
  ];
  const d = smoothClosed(pts.map(([x, y]) => [cx + x * s, cy + y * s] as [number, number]), 0.9);
  return shape(d, { fill, shade, shadeOffset: [0, -7 * s], sw });
}

// ---------------------------------------------------------------- 天色

function sky(state: 'bull' | 'flat' | 'bear'): Frag {
  const f = frag();
  const stops =
    state === 'bull'
      ? ['#4fb4ff', '#9fd8ff', '#ffe7bf']
      : state === 'flat'
        ? ['#8597b0', '#b2bdcc', '#d9dbe0']
        : ['#1d2140', '#2f3358', '#4a4a72'];
  f.defs.set(
    'sky',
    `<linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="360"><stop offset="0" stop-color="${stops[0]}"/><stop offset="0.6" stop-color="${stops[1]}"/><stop offset="1" stop-color="${stops[2]}"/></linearGradient>`,
  );
  let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  const parts: Frag[] = [frag(s, f.defs)];
  if (state === 'bull') {
    f.defs.set('sunglow', `<radialGradient id="sunglow" gradientUnits="userSpaceOnUse" cx="770" cy="122" r="150"><stop offset="0" stop-color="#fff6c8" stop-opacity="0.9"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient>`);
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      rays += `<path d="M${(770 + Math.cos(a) * 54).toFixed(1)} ${(122 + Math.sin(a) * 54).toFixed(1)}L${(770 + Math.cos(a) * 74).toFixed(1)} ${(122 + Math.sin(a) * 74).toFixed(1)}" stroke="#ffc93a" stroke-width="7" stroke-linecap="round"/>`;
    }
    parts.push(frag(`<circle cx="770" cy="122" r="150" fill="url(#sunglow)"/>${rays}`, f.defs));
    parts.push(shape(ellipseD(770, 122, 42, 42), { fill: '#ffd84a', shade: '#ffb627', shadeOffset: [-6, -6] }));
    parts.push(frag(`<circle cx="758" cy="118" r="4" fill="${INK}"/><circle cx="782" cy="118" r="4" fill="${INK}"/><path d="M760 132q10 8 20 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><ellipse cx="748" cy="130" rx="6" ry="3.5" fill="#ff8fa3" fill-opacity="0.7"/><ellipse cx="792" cy="130" rx="6" ry="3.5" fill="#ff8fa3" fill-opacity="0.7"/>`));
    parts.push(cloud(520, 130, 0.9, '#ffffff', '#dceeff'));
    parts.push(cloud(660, 250, 0.7, '#ffffff', '#dceeff'));
    parts.push(cloud(220, 150, 1, '#ffffff', '#dceeff'));
    parts.push(cloud(1080, 200, 0.9, '#ffffff', '#dceeff'));
    // 飞鸟
    parts.push(frag(line('M580 200q6 -6 12 0q6 -6 12 0M612 176q5 -5 10 0q5 -5 10 0', INK, 3)));
  } else if (state === 'flat') {
    parts.push(cloud(470, 110, 1.2, '#e6e9ef', '#c4cad6'));
    parts.push(cloud(640, 90, 1.4, '#dfe3ea', '#bfc6d2'));
    parts.push(cloud(820, 130, 1.1, '#e6e9ef', '#c4cad6'));
    parts.push(cloud(560, 210, 0.9, '#d6dbe4', '#b6bdca'));
    parts.push(cloud(760, 240, 0.8, '#d6dbe4', '#b6bdca'));
    parts.push(cloud(200, 150, 1.2, '#dfe3ea', '#bfc6d2'));
    parts.push(cloud(1090, 160, 1.2, '#dfe3ea', '#bfc6d2'));
  } else {
    parts.push(cloud(470, 100, 1.4, '#4a4b70', '#36375a'));
    parts.push(cloud(660, 70, 1.6, '#55557c', '#3b3c60'));
    parts.push(cloud(840, 110, 1.3, '#4a4b70', '#36375a'));
    parts.push(cloud(560, 190, 1, '#3e3f63', '#2e2f50'));
    parts.push(cloud(780, 200, 1, '#3e3f63', '#2e2f50'));
    parts.push(cloud(200, 140, 1.4, '#4a4b70', '#36375a'));
    parts.push(cloud(1080, 140, 1.4, '#4a4b70', '#36375a'));
  }
  return merge(...parts);
}

function city(): Frag {
  const r = rng(11);
  let back = '';
  let front = '';
  let lights = '';
  let x = -20;
  while (x < W + 20) {
    const w = 36 + Math.floor(r() * 50);
    const h = 40 + Math.floor(r() * 90);
    back += `<rect x="${x}" y="${330 - h - 24}" width="${w}" height="${h + 40}" fill="#9aa6d4"/>`;
    x += w + 4;
  }
  x = -10;
  while (x < W + 20) {
    const w = 44 + Math.floor(r() * 56);
    const h = 30 + Math.floor(r() * 70);
    const top = 336 - h;
    const roof = r();
    const d =
      roof < 0.3
        ? `M${x} 360V${top + 10}L${x + w / 2} ${top - 8}L${x + w} ${top + 10}V360Z`
        : roof < 0.55
          ? `M${x} 360V${top}H${x + w}V360Z M${x + w / 2 - 2} ${top}v-16h4v16z`
          : `M${x} 360V${top + 6}Q${x} ${top} ${x + 6} ${top}H${x + w - 6}Q${x + w} ${top} ${x + w} ${top + 6}V360Z`;
    front += `<path d="${d}" fill="#6c78ad" stroke="#4b5488" stroke-width="3" stroke-linejoin="round"/>`;
    for (let wy = top + 14; wy < 330; wy += 14) {
      for (let wx = x + 8; wx < x + w - 10; wx += 13) {
        if (r() < 0.45) lights += `<rect x="${wx}" y="${wy}" width="6" height="7" rx="1.2" fill="#ffe08a"/>`;
      }
    }
    x += w + 2;
  }
  return frag(`<g>${back}</g><g>${front}</g><g opacity="0.95">${lights}</g>`);
}

function rain(): Frag {
  // 竖直方向无缝平铺：每条雨丝在 y 和 y±720 各画一份
  const r = rng(5);
  let s = '';
  for (let i = 0; i < 560; i++) {
    const x = Math.floor(r() * (W + 200)) - 100;
    const y = Math.floor(r() * H);
    const len = 18 + r() * 20;
    for (const oy of [-H, 0]) {
      s += `M${x} ${y + oy}l${(-len * 0.25).toFixed(1)} ${len.toFixed(1)}`;
    }
  }
  return frag(`<path d="${s}" stroke="#c4d8ff" stroke-opacity="0.8" stroke-width="2.6" stroke-linecap="round" fill="none"/>`);
}

/** 闪电：3 个位置变体（中间、左窗格分叉、右窗格双闪），熊市随机挑一个闪 */
function lightning(v: 1 | 2 | 3): Frag {
  const paths: Record<number, string[]> = {
    1: ['M700 40L664 140L690 140L650 250L718 120L690 120L722 40Z'],
    2: ['M520 50L490 130L512 130L478 220L540 112L516 112L542 50Z', 'M494 160L462 196L470 200L452 236L486 190L476 186L500 160Z'],
    3: ['M800 60L782 120L796 120L774 190L818 108L802 108L816 60Z', 'M748 44L736 88L746 88L732 136L762 82L752 82L760 44Z'],
  };
  let out = '';
  for (const d of paths[v]!) {
    out += `<path d="${d}" fill="#fff6a8" stroke="#ffe14a" stroke-width="10" stroke-linejoin="round" stroke-opacity="0.5"/>` + `<path d="${d}" fill="#fffbe0" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
  }
  return frag(out);
}

/** 熊市窗外的暗色雾气：压暗城市灯光（画在墙下面，只在窗洞里可见） */
function hazeBear(): Frag {
  return frag(`<rect width="${W}" height="${H}" fill="#14173a" fill-opacity="0.5"/>`);
}

// ---------------------------------------------------------------- 墙

function wall(): Frag {
  const parts: Frag[] = [];
  const winD = rrectD(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  // 墙面（挖掉窗洞）+ 竖条纹
  let stripes = '';
  for (let x = 0; x < W; x += 48) stripes += `<rect x="${x}" y="0" width="20" height="${H}" fill="#f0cfa3" fill-opacity="0.55"/>`;
  let dots = '';
  for (let x = 34; x < W; x += 48) for (let y = 30; y < H; y += 60) dots += `<circle cx="${x}" cy="${y + ((x / 48) % 2) * 30}" r="2.6" fill="#ecc38f"/>`;
  parts.push(
    grained(
      frag(
        `<clipPath id="wallclip"><path d="M0 0H${W}V${H}H0Z${winD}" clip-rule="evenodd"/></clipPath>` +
          `<g clip-path="url(#wallclip)"><rect width="${W}" height="${H}" fill="#f8deb6"/>${stripes}${dots}` +
          // 踢脚线以上的护墙板
          `<rect x="0" y="470" width="${W}" height="250" fill="#e9b98a"/><path d="M0 470H${W}" stroke="#c98f5f" stroke-width="8"/>` +
          Array.from({ length: 27 }, (_, i) => `<path d="M${i * 50 + 10} 480V720" stroke="#d9a678" stroke-width="3"/>`).join('') +
          `</g>`,
      ),
      0.05,
      FULL,
    ),
  );
  // 窗框
  const frameOuter = rrectD(WIN.x - 18, WIN.y - 18, WIN.w + 36, WIN.h + 36, WIN.r + 14);
  parts.push(
    frag(
      `<path d="${frameOuter}${winD}" fill="#fff4e4" fill-rule="evenodd" stroke="${INK}" stroke-width="5"/>` +
        `<path d="${winD}" fill="none" stroke="${INK}" stroke-width="5"/>` +
        `<path d="M${WIN.x + WIN.w / 2} ${WIN.y}V${WIN.y + WIN.h}M${WIN.x} ${WIN.y + 140}H${WIN.x + WIN.w}" stroke="${INK}" stroke-width="16"/>` +
        `<path d="M${WIN.x + WIN.w / 2} ${WIN.y}V${WIN.y + WIN.h}M${WIN.x} ${WIN.y + 140}H${WIN.x + WIN.w}" stroke="#fff4e4" stroke-width="8"/>` +
        // 玻璃反光
        line(`M${WIN.x + 30} ${WIN.y + 110}L${WIN.x + 90} ${WIN.y + 30}M${WIN.x + 50} ${WIN.y + 120}L${WIN.x + 110} ${WIN.y + 40}`, '#ffffff', 6, ' stroke-opacity="0.35"') +
        line(`M${WIN.x + 250} ${WIN.y + 260}L${WIN.x + 320} ${WIN.y + 160}`, '#ffffff', 6, ' stroke-opacity="0.3"'),
    ),
  );
  // 窗台
  parts.push(shape(rrectD(WIN.x - 36, WIN.y + WIN.h + 14, WIN.w + 72, 22, 6), { fill: '#fff4e4', shade: '#e8d2b8', shadeOffset: [0, -6] }));
  // 窗帘与窗帘杆
  const curtain = (side: 1 | -1) => {
    const x0 = side < 0 ? 372 : 908;
    const x1 = side < 0 ? 470 : 810;
    const d =
      side < 0
        ? `M${x0} 40H${x1}Q${x1 - 20} 180 ${x1 - 40} 262Q${x1 - 14} 330 ${x1 - 10} 392H${x0}Z`
        : `M${x0} 40H${x1}Q${x1 + 20} 180 ${x1 + 40} 262Q${x1 + 14} 330 ${x1 + 10} 392H${x0}Z`;
    const folds =
      side < 0
        ? line('M392 50V390M414 50Q418 200 404 262M436 50Q440 180 420 262', '#e46a6a', 3, ' stroke-opacity="0.6"')
        : line('M888 50V390M866 50Q862 200 876 262M844 50Q840 180 860 262', '#e46a6a', 3, ' stroke-opacity="0.6"');
    const tie = side < 0 ? `<rect x="${x0 - 2}" y="252" width="${x1 - 40 - x0 + 8}" height="16" rx="8" fill="#ffd36b" stroke="${INK}" stroke-width="4"/>` : `<rect x="${x1 + 34}" y="252" width="${x0 - x1 - 32}" height="16" rx="8" fill="#ffd36b" stroke="${INK}" stroke-width="4"/>`;
    return merge(shape(d, { fill: '#ff8f84', shade: '#ef6f6a', shadeOffset: [side * 8, 0], extra: folds }), frag(tie));
  };
  parts.push(curtain(-1), curtain(1));
  parts.push(frag(`<rect x="352" y="32" width="576" height="12" rx="6" fill="#b8773a" stroke="${INK}" stroke-width="4"/><circle cx="352" cy="38" r="11" fill="#ffd36b" stroke="${INK}" stroke-width="4"/><circle cx="928" cy="38" r="11" fill="#ffd36b" stroke="${INK}" stroke-width="4"/>`));

  // 左墙海报：一路上涨的蜡烛图 + 小火箭（无文字）
  parts.push(frag(`<g transform="rotate(-3 255 195)">`));
  parts.push(shape(rrectD(170, 88, 170, 210, 6), { fill: '#fffaf0', shade: '#efe2cc', shadeOffset: [-6, -6] }));
  let candles = '';
  const r = rng(3);
  let y = 250;
  for (let i = 0; i < 8; i++) {
    const up = i !== 3 && i !== 6;
    const h = 14 + r() * 16;
    const x = 188 + i * 17;
    const top = up ? y - h : y;
    candles += `<path d="M${x + 5} ${top - 8}V${top + h + 8}" stroke="${INK}" stroke-width="2.5"/><rect x="${x}" y="${top}" width="10" height="${h}" rx="2" fill="${up ? '#ff5d5d' : '#3fbf7f'}" stroke="${INK}" stroke-width="2.5"/>`;
    y = up ? y - h * 0.7 : y + h * 0.5;
  }
  parts.push(frag(candles + line('M186 270Q240 250 320 120', '#ffb020', 5) + `<path d="M310 112l16 2-6 15z" fill="#ffb020" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` + `<rect x="186" y="104" width="80" height="10" rx="5" fill="#ffd36b"/><rect x="186" y="122" width="50" height="7" rx="3.5" fill="#f0d7b0"/>`));
  parts.push(frag(`<rect x="232" y="78" width="50" height="18" fill="#9fd8ff" fill-opacity="0.8" transform="rotate(4 257 87)"/>`));
  parts.push(frag(`</g>`));

  // 左墙搁板：书、元宝、仙人掌
  parts.push(shape(rrectD(24, 386, 300, 16, 4), { fill: '#c98a54', shadeOffset: [0, -5] }));
  parts.push(frag(line('M60 402l-10 22M290 402l10 22', INK, 5)));
  const books: [number, number, number, string][] = [
    [40, 32, 70, '#5a67e8'], [74, 26, 62, '#ff8a3d'], [102, 30, 76, '#2fc4a2'], [134, 24, 58, '#b65cf0'],
  ];
  for (const [bx, bw, bh, col] of books) {
    parts.push(shape(rrectD(bx, 386 - bh, bw, bh, 3), { fill: col, shadeOffset: [-4, 0], sw: 3.5 }));
    parts.push(frag(`<rect x="${bx + 5}" y="${386 - bh + 10}" width="${bw - 10}" height="5" rx="2" fill="#ffffff" fill-opacity="0.7"/>`));
  }
  parts.push(frag(`<g transform="rotate(-12 178 350)">`));
  parts.push(shape(rrectD(164, 312, 28, 74, 3), { fill: '#ffd36b', shadeOffset: [-4, 0], sw: 3.5 }));
  parts.push(frag(`</g>`));
  // 元宝
  parts.push(shape('M206 386Q196 366 214 362Q224 372 244 372Q264 372 274 362Q292 366 282 386Z', { fill: '#ffd23f', shade: '#e8a020' }));
  parts.push(shape(ellipseD(244, 362, 16, 12), { fill: '#ffe680', shade: '#f0b830' }));
  // 仙人掌
  parts.push(shape('M292 386L288 366H316L312 386Z', { fill: '#e9875a', sw: 3.5 }));
  parts.push(shape('M296 366V340Q296 330 302 330Q308 330 308 340V366Z', { fill: '#7ccf6a', sw: 3.5 }));
  parts.push(frag(line('M298 346h-6v-8M306 352h6v-8', INK, 3.5)));

  // 串灯
  let lights = '';
  const wire = (x0: number, x1: number, sag: number) => {
    const d = `M${x0} 14Q${(x0 + x1) / 2} ${14 + sag} ${x1} 14`;
    lights += line(d, '#6b4a3a', 3);
    for (let t = 0.08; t < 1; t += 0.12) {
      const bx = x0 + (x1 - x0) * t;
      const by = 14 + sag * 2 * t * (1 - t);
      const col = ['#ffd36b', '#ff8fa3', '#9fd8ff', '#b6f08a'][Math.round(t * 10) % 4]!;
      lights += `<circle cx="${bx.toFixed(1)}" cy="${(by + 10).toFixed(1)}" r="15" fill="${col}" fill-opacity="0.22"/><path d="M${bx.toFixed(1)} ${by.toFixed(1)}v5" stroke="#6b4a3a" stroke-width="3"/><ellipse cx="${bx.toFixed(1)}" cy="${(by + 12).toFixed(1)}" rx="5.5" ry="7.5" fill="${col}" stroke="${INK}" stroke-width="2.5"/>`;
    }
  };
  wire(-10, 340, 60);
  wire(940, 1290, 60);
  parts.push(frag(lights));

  // 右墙：挂钟、月供日历（红圈）
  parts.push(shape(ellipseD(1010, 150, 52, 52), { fill: '#fffaf0', shade: '#e8dcc8' }));
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ticks += `<path d="M${(1010 + Math.cos(a) * 38).toFixed(1)} ${(150 + Math.sin(a) * 38).toFixed(1)}L${(1010 + Math.cos(a) * (i % 3 === 0 ? 30 : 34)).toFixed(1)} ${(150 + Math.sin(a) * (i % 3 === 0 ? 30 : 34)).toFixed(1)}" stroke="${INK}" stroke-width="${i % 3 === 0 ? 4 : 2.5}" stroke-linecap="round"/>`;
  }
  parts.push(frag(ticks + line('M1010 150L1010 122M1010 150L1030 160', INK, 5) + `<circle cx="1010" cy="150" r="5" fill="#ff6b6b" stroke="${INK}" stroke-width="2.5"/>` + `<circle cx="1010" cy="150" r="46" fill="none" stroke="#ff8f84" stroke-width="5"/>`));
  parts.push(frag(`<g transform="rotate(4 1150 300)">`));
  parts.push(shape(rrectD(1090, 230, 130, 150, 8), { fill: '#fffaf0', shade: '#eadfcc' }));
  parts.push(frag(`<rect x="1090" y="230" width="130" height="34" rx="8" fill="#ff6b6b" stroke="${INK}" stroke-width="4"/><rect x="1090" y="252" width="130" height="12" fill="#ff6b6b"/><path d="M1090 264H1220" stroke="${INK}" stroke-width="4"/>`));
  let grid = '';
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 5; gx++) grid += `<rect x="${1100 + gx * 23}" y="${274 + gy * 24}" width="16" height="16" rx="3" fill="#f1e4cc"/>`;
  parts.push(frag(grid + `<circle cx="${1100 + 3 * 23 + 8}" cy="${274 + 2 * 24 + 8}" r="15" fill="none" stroke="#e8352e" stroke-width="4"/>` + `<path d="M1100 ${274 + 3 * 24 + 8}l10 -4M1123 ${274 + 3 * 24 + 8}l10 -4" stroke="#8b7a99" stroke-width="3" stroke-linecap="round"/>`));
  parts.push(frag(`<circle cx="1120" cy="232" r="6" fill="#fffaf0" stroke="${INK}" stroke-width="3"/><circle cx="1190" cy="232" r="6" fill="#fffaf0" stroke="${INK}" stroke-width="3"/></g>`));
  return merge(...parts);
}

// ---------------------------------------------------------------- 书桌

function desk(): Frag {
  const parts: Frag[] = [];
  // 桌面与桌身
  parts.push(grained(merge(
    shape('M-20 560H1300V610H-20Z', { fill: '#d99a62', shade: '#c4844e', shadeOffset: [0, -8] }),
    frag(line('M60 574h120M300 590h160M820 576h140M1060 592h120', '#b8773a', 3, ' stroke-opacity="0.6"')),
    shape(`M-20 610H1300V740H-20Z`, { fill: '#b8773a', shade: '#a2682f', shadeOffset: [0, -10] }),
    shape(rrectD(60, 630, 260, 70, 10), { fill: '#c98a54' }),
    shape(rrectD(960, 630, 260, 70, 10), { fill: '#c98a54' }),
    frag(`<rect x="160" y="656" width="60" height="12" rx="6" fill="#ffd36b" stroke="${INK}" stroke-width="3.5"/><rect x="1060" y="656" width="60" height="12" rx="6" fill="#ffd36b" stroke="${INK}" stroke-width="3.5"/>`),
  ), 0.06, FULL));

  // 台灯（左）
  parts.push(shape(ellipseD(236, 568, 46, 12), { fill: '#5a67e8' }));
  parts.push(frag(line('M236 562L206 470L290 410', INK, 14) + line('M236 562L206 470L290 410', '#7c88ff', 7) + `<circle cx="206" cy="470" r="9" fill="#ffd36b" stroke="${INK}" stroke-width="4"/>`));
  parts.push(shape('M262 384L340 404L326 446Q294 456 262 430Z', { fill: '#7c88ff', shade: '#5a67e8', shadeOffset: [6, -6] }));
  parts.push(frag(`<ellipse cx="300" cy="440" rx="22" ry="9" fill="#fff6c8" stroke="${INK}" stroke-width="3" transform="rotate(30 300 440)"/>`));

  // 马克杯与便签
  parts.push(shape('M372 520H424V566Q424 574 416 574H380Q372 574 372 566Z', { fill: '#ffffff', shade: '#e3e3ee', extra: `<path d="M380 536q10 -6 20 0t20 0" stroke="#ff8f84" stroke-width="5" fill="none"/>` }));
  parts.push(frag(`<path d="M424 532q18 0 18 14t-18 14" fill="none" stroke="${INK}" stroke-width="10"/><path d="M424 532q18 0 18 14t-18 14" fill="none" stroke="#ffffff" stroke-width="4"/>`));
  parts.push(frag(`<g transform="rotate(-8 330 590)"><rect x="300" y="574" width="54" height="34" rx="3" fill="#ffe680" stroke="${INK}" stroke-width="3.5"/><path d="M308 586h36M308 596h24" stroke="#c9a640" stroke-width="3" stroke-linecap="round"/></g>`));

  // 显示器
  parts.push(shape('M610 548H670L676 572H604Z', { fill: '#4a4460' }));
  parts.push(shape(ellipseD(640, 574, 66, 9), { fill: '#4a4460' }));
  parts.push(shape(rrectD(456, 346, 368, 212, 18), { fill: '#3a3448', shade: '#2b2638' }));
  parts.push(frag(`<rect x="472" y="362" width="336" height="180" rx="8" fill="#1d2738"/>`));
  let screen = '';
  for (let gx = 0; gx < 7; gx++) screen += `<path d="M${490 + gx * 48} 372V532" stroke="#2c3a52" stroke-width="2"/>`;
  for (let gy = 0; gy < 4; gy++) screen += `<path d="M482 ${390 + gy * 40}H798" stroke="#2c3a52" stroke-width="2"/>`;
  const r = rng(9);
  let cy = 470;
  for (let i = 0; i < 18; i++) {
    const up = r() < 0.62;
    const h = 8 + r() * 22;
    const x = 486 + i * 17.5;
    const top = up ? cy - h : cy;
    const col = up ? '#ff6b6b' : '#45d68f';
    screen += `<path d="M${x + 4.5} ${top - 6}V${top + h + 6}" stroke="${col}" stroke-width="2"/><rect x="${x}" y="${top}" width="9" height="${h}" rx="1.5" fill="${col}"/>`;
    cy = Math.max(400, Math.min(510, up ? cy - h * 0.6 : cy + h * 0.6));
  }
  screen += line('M486 500Q560 470 620 480T800 420', '#ffd36b', 3, ' stroke-opacity="0.9"');
  screen += `<path d="M482 372l40 0l-40 40z" fill="#ffffff" fill-opacity="0.08"/>`;
  parts.push(frag(screen));
  parts.push(frag(`<circle cx="640" cy="551" r="3" fill="#45d68f"/>`));
  // 显示器边上的便利贴
  parts.push(frag(`<g transform="rotate(8 806 372)"><rect x="782" y="346" width="46" height="44" rx="3" fill="#ff8fa3" stroke="${INK}" stroke-width="3.5"/><path d="M790 362h28M790 372h18" stroke="#d65f7a" stroke-width="3" stroke-linecap="round"/></g>`));
  parts.push(frag(`<g transform="rotate(-6 470 380)"><rect x="440" y="360" width="40" height="38" rx="3" fill="#9fd8ff" stroke="${INK}" stroke-width="3.5"/><path d="M448 374l6 6 12 -12" stroke="#3d7fb8" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`));

  // 显示器顶上的小火箭、桌上的多肉（原来放在窗台上，被窗帘和显示器挡住了）
  parts.push(
    frag(
      `<g transform="translate(560 346) scale(0.85)"><path d="M-10 0V-34Q-10 -52 0 -60Q10 -52 10 -34V0Z" fill="#ffffff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
        `<path d="M-10 -10L-20 4V-16L-10 -24ZM10 -10L20 4V-16L10 -24Z" fill="#ff6b6b" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
        `<circle cx="0" cy="-34" r="5" fill="#5ec8ff" stroke="${INK}" stroke-width="3"/><path d="M-6 2Q0 12 6 2Z" fill="#ffc93a" stroke="${INK}" stroke-width="3"/></g>`,
    ),
  );
  parts.push(frag(`<g transform="translate(380 186)">`));
  parts.push(shape('M440 362Q436 384 452 388H476Q492 384 488 362Z', { fill: '#e9875a' }));
  parts.push(
    frag(
      `<path d="M452 362Q446 340 458 332Q462 348 464 362ZM464 362Q462 330 474 322Q480 340 474 362ZM472 362Q480 340 492 342Q488 356 482 362Z" fill="#7ccf6a" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
    ),
  );
  parts.push(frag(`</g>`));

  // 键盘、鼠标
  parts.push(shape('M532 584H748L758 610H522Z', { fill: '#f2ecf7', shade: '#d8d0e4' }));
  let keys = '';
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 13; k++) {
      const x = 538 + row * -4 + k * 16.4;
      keys += `<rect x="${x}" y="${589 + row * 10}" width="13" height="7" rx="2" fill="#d1c8e0"/>`;
    }
  }
  parts.push(frag(keys));
  parts.push(shape(ellipseD(796, 598, 14, 10), { fill: '#f2ecf7', shade: '#d8d0e4', extra: line('M796 590v6', INK, 2.5) }));

  // 右侧：账单夹与绿植
  parts.push(frag(`<g transform="rotate(5 1150 548)">`));
  parts.push(shape(rrectD(1104, 520, 96, 44, 4), { fill: '#fffaf0', shade: '#eadfcc' }));
  parts.push(frag(`<path d="M1114 532h50M1114 542h70M1114 552h40" stroke="#c9b9a0" stroke-width="3.5" stroke-linecap="round"/><rect x="1172" y="530" width="20" height="10" rx="2" fill="#ff6b6b"/></g>`));
  parts.push(shape('M1214 564L1206 520H1262L1254 564Z', { fill: '#e9875a' }));
  parts.push(frag(
    `<path d="M1234 520Q1210 480 1192 470Q1220 470 1236 506Q1240 460 1260 440Q1262 480 1240 518Q1270 486 1290 490Q1270 510 1244 522Z" fill="#7ccf6a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
      line('M1236 518Q1222 494 1206 478M1240 514Q1248 480 1258 452', '#5aa84c', 3),
  ));
  return merge(...parts);
}

function steam(): Frag {
  return frag(line('M388 508q-8 -12 0 -24t0 -24M404 504q-8 -12 0 -24t0 -24', '#ffffff', 5, ' stroke-opacity="0.7"'));
}

// ---------------------------------------------------------------- 猫

function catBody(): Frag {
  const fur = '#ffb766';
  const parts: Frag[] = [];
  parts.push(shape(ellipseD(985, 574, 104, 18), { fill: '#b9a6ff', shade: '#9a86f0', shadeOffset: [0, -6] }));
  // 身体（面包状）
  const bodyD = smoothClosed([[920, 572], [912, 540], [950, 510], [1010, 504], [1060, 516], [1078, 546], [1068, 572]], 0.9);
  parts.push(shape(bodyD, {
    fill: fur,
    extra:
      line('M990 508q-4 14 4 22M1016 506q-4 14 4 24M1040 512q-4 12 4 22', '#e8893a', 6) +
      `<ellipse cx="1000" cy="560" rx="40" ry="10" fill="#fff1d6" fill-opacity="0.8"/>`,
  }));
  // 头
  const earL = 'M896 512L898 484L920 500Z';
  const earR = 'M944 498L962 480L962 508Z';
  parts.push(shape(earL, { fill: fur, sw: 4 }), shape(earR, { fill: fur, sw: 4 }));
  parts.push(frag(`<path d="M901 506L902 492L913 501Z" fill="#ffb3c0"/><path d="M950 500L958 490L958 504Z" fill="#ffb3c0"/>`));
  parts.push(shape(ellipseD(930, 534, 40, 32), {
    fill: fur,
    extra: line('M920 504q2 8 0 12M932 503q2 8 0 12', '#e8893a', 4),
  }));
  // 前爪
  parts.push(shape(ellipseD(908, 564, 16, 9), { fill: '#fff1d6', shade: '#f0d8b4', sw: 3.5 }));
  parts.push(shape(ellipseD(944, 566, 16, 9), { fill: '#fff1d6', shade: '#f0d8b4', sw: 3.5 }));
  // 睡脸
  parts.push(frag(
    line('M906 536q7 6 14 0M934 536q7 6 14 0', INK, 4) +
      `<path d="M924 544l3 3 3 -3z" fill="#ff8fa3" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
      line('M927 548q-3 4 -7 2M927 548q3 4 7 2', INK, 2.5) +
      `<ellipse cx="903" cy="546" rx="7" ry="4" fill="#ff8fa3" fill-opacity="0.6"/><ellipse cx="954" cy="546" rx="7" ry="4" fill="#ff8fa3" fill-opacity="0.6"/>` +
      line('M890 542h-14M890 548l-12 3M966 542h14M966 548l12 3', INK, 2, ' stroke-opacity="0.7"'),
  ));
  return grained(merge(...parts), 0.06, FULL);
}

/** 猫尾巴：绕到身体前面，轴心在 (1066, 556)，可做轻微摆动 */
function catTail(): Frag {
  return merge(
    frag(line('M1066 556Q1100 560 1090 580Q1070 596 1010 590', INK, 22) + line('M1066 556Q1100 560 1090 580Q1070 596 1010 590', '#ffb766', 13)),
    frag(line('M1082 584l6 -6M1060 591l3 -8M1036 592l2 -8', '#e8893a', 4)),
    frag(`<circle cx="1010" cy="590" r="7" fill="#fff1d6" stroke="${INK}" stroke-width="4"/>`),
  );
}

function catZzz(): Frag {
  const z = (x: number, y: number, s: number) => `<path d="M${x} ${y}h${s}l${-s} ${s}h${s}" fill="none" stroke="${INK}" stroke-width="${s * 0.28 + 1.5}" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x} ${y}h${s}l${-s} ${s}h${s}" fill="none" stroke="#ffffff" stroke-width="${s * 0.12 + 0.6}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return frag(z(880, 482, 12) + z(864, 454, 16) + z(842, 418, 22));
}

// ---------------------------------------------------------------- 光照与氛围

function ambient(state: 'bull' | 'flat' | 'bear'): Frag {
  if (state === 'bull') {
    const f = frag();
    f.defs.set('beam', `<linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="640" y1="200" x2="560" y2="620"><stop offset="0" stop-color="#fff3c0" stop-opacity="0.3"/><stop offset="1" stop-color="#fff3c0" stop-opacity="0"/></linearGradient>`);
    f.content = `<path d="M440 330L860 330L1000 720L340 720Z" fill="url(#beam)"/>`;
    return f;
  }
  if (state === 'flat') return frag(`<rect width="${W}" height="${H}" fill="#6a7690" fill-opacity="0.12"/>`);
  return frag(`<rect width="${W}" height="${H}" fill="#1c1f45" fill-opacity="0.34"/>`);
}

function lampLight(): Frag {
  const f = frag();
  f.defs.set('lamp', `<radialGradient id="lamp" gradientUnits="userSpaceOnUse" cx="320" cy="560" r="220"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>`);
  f.content = `<path d="M286 440L330 420L520 600L150 600Z" fill="url(#lamp)"/><ellipse cx="330" cy="584" rx="190" ry="32" fill="url(#lamp)"/>`;
  return f;
}

function monitorGlow(): Frag {
  const f = frag();
  f.defs.set('mglow', `<radialGradient id="mglow" gradientUnits="userSpaceOnUse" cx="640" cy="452" r="360"><stop offset="0" stop-color="#8fd3ff" stop-opacity="0.3"/><stop offset="0.45" stop-color="#8fd3ff" stop-opacity="0.12"/><stop offset="1" stop-color="#8fd3ff" stop-opacity="0"/></radialGradient>`);
  f.content = `<ellipse cx="640" cy="470" rx="420" ry="300" fill="url(#mglow)"/>`;
  return f;
}

export function build(write: (rel: string, data: string) => void): number {
  const files: [string, Frag][] = [
    ['sky_bull', sky('bull')],
    ['sky_flat', sky('flat')],
    ['sky_bear', sky('bear')],
    ['city', city()],
    ['rain', rain()],
    ['haze_bear', hazeBear()],
    ['lightning', lightning(1)],
    ['lightning_2', lightning(2)],
    ['lightning_3', lightning(3)],
    ['wall', wall()],
    ['desk', desk()],
    ['steam', steam()],
    ['cat', catBody()],
    ['cat_tail', catTail()],
    ['cat_zzz', catZzz()],
    ['ambient_bull', ambient('bull')],
    ['ambient_flat', ambient('flat')],
    ['ambient_bear', ambient('bear')],
    ['lamp_light', lampLight()],
    ['monitor_glow', monitorGlow()],
  ];
  for (const [name, f] of files) write(`scene/${name}.svg`, doc(f));
  return files.length;
}
