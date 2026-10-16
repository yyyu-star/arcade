/**
 * 特效贴图（粒子与光效）。全部原点在左上角，画面层自己设 origin。
 *
 *   flame 32×48、flame_small 20×28    热度条火苗（底部中点为根）
 *   ice 32×32、ice_shard 16×16       退潮冰晶
 *   firework_burst 128×128           涨停烟花整朵（缩放 + 淡出即可）
 *   firework_star 24×24、firework_dot 12×12（白色，运行时着色）、firework_trail 8×40
 *   raincloud 128×80、raindrop 10×16 跌停雨云（带愁眉）
 *   link_beam 128×24（横向三段拉伸：两端各 16px 不拉伸）、link_spark 32×32 龙头带动连线
 *   coin 32×32、sparkle 16×16
 *   tide 256×48（横向无缝平铺，退潮的潮水）
 */
import { INK, TEAR, WHITE, type Frag, ellipseD, frag, hiArc, merge, rng, shape, smoothClosed, sparkleD, starD, svgDoc } from './lib/svg.ts';

function line(d: string, color: string, w: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

function flame(w: number, h: number): Frag {
  const k = w / 32;
  const sc = (d: string) => `<g transform="scale(${k} ${h / 48})">${d}</g>`;
  const outer = 'M16 46C6 46 2 38 4 30C6 22 12 20 12 12C16 16 18 20 18 24C20 20 22 14 20 4C28 12 30 22 29 32C28 40 24 46 16 46Z';
  const mid = 'M16 44C10 44 8 39 9 34C10 30 14 28 14 24C17 27 19 30 19 33C21 31 22 28 22 26C25 30 25 36 24 39C22 43 19 44 16 44Z';
  const core = 'M16 43C13 43 12 40 12.5 38C13 36 15 35 15.5 33C17 35 19 37 19 39C19 42 18 43 16 43Z';
  return frag(
    sc(
      `<path d="${outer}" fill="#ff6a2c" stroke="${INK}" stroke-width="${2.6 / k}" stroke-linejoin="round"/>` +
        `<path d="${mid}" fill="#ffb020"/><path d="${core}" fill="#fff4b0"/>` +
        hiArc('M8 30q0 -4 3 -7', 1.6 / k, 0.6),
    ),
  );
}

function ice(): Frag {
  const d = 'M16 2L22 9L29 12L25 20L27 29L18 27L10 30L8 21L3 14L11 9Z';
  return merge(
    shape(d, { fill: '#cfefff', shade: '#8fd3ff', shadeOffset: [-3, -3], sw: 2.4 }),
    frag(line('M16 2L16 16L27 29M16 16L3 14M16 16L10 30M16 16L29 12', '#ffffff', 1.4, ' stroke-opacity="0.85"') + hiArc('M12 8l3 -3', 1.8, 0.95)),
  );
}

function iceShard(): Frag {
  return merge(shape('M8 1L13 6L11 15L4 13L2 6Z', { fill: '#dff6ff', shade: '#9fdcff', shadeOffset: [-2, -2], sw: 1.8 }), frag(line('M8 1L8 9L11 15M8 9L2 6', '#ffffff', 1)));
}

function fireworkBurst(): Frag {
  const r = rng(42);
  const cols = ['#ffd23f', '#ff5d7a', '#5ee0ff', '#b6f08a', '#ff8a3d', '#b9a6ff'];
  let s = '';
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.1;
    const r0 = 14;
    const r1 = 44 + r() * 10;
    const c = cols[i % cols.length]!;
    const x0 = 64 + Math.cos(a) * r0;
    const y0 = 64 + Math.sin(a) * r0;
    const x1 = 64 + Math.cos(a) * r1;
    const y1 = 64 + Math.sin(a) * r1;
    s += line(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`, INK, 6) + line(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`, c, 3);
    const tx = 64 + Math.cos(a) * (r1 + 8);
    const ty = 64 + Math.sin(a) * (r1 + 8);
    s += i % 2 === 0
      ? `<path d="${starD(tx, ty, 5.5)}" fill="${c}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`
      : `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3.2" fill="${c}" stroke="${INK}" stroke-width="1.6"/>`;
  }
  s += `<path d="${sparkleD(64, 64, 14)}" fill="#fff6b0" stroke="${INK}" stroke-width="2.2"/>`;
  return frag(s);
}

function raincloud(): Frag {
  const pts: [number, number][] = [[10, 58], [8, 44], [22, 34], [30, 18], [52, 10], [72, 16], [84, 10], [104, 20], [110, 34], [122, 44], [118, 60], [100, 66], [64, 68], [28, 66]];
  const d = smoothClosed(pts, 0.9);
  return merge(
    shape(d, { fill: '#8e97b8', shade: '#6f789c', shadeOffset: [0, -8] }),
    frag(
      `<path d="M49 41l9 -4M79 41l-9 -4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
        `<circle cx="54" cy="46" r="3" fill="${INK}"/><circle cx="74" cy="46" r="3" fill="${INK}"/>` +
        line('M58 58q6 -5 12 0', INK, 3) +
        `<path d="M48 50q-3 6 0 8q3 -2 0 -8z" fill="${TEAR}" stroke="${INK}" stroke-width="1.4"/>` +
        hiArc('M28 30q6 -10 18 -12', 3, 0.5) +
        // 云下挂着的几滴雨
        [[30, 72], [52, 76], [80, 74], [100, 72]].map(([x, y]) => `<path d="M${x} ${y! - 6}q-3.5 5 -3.5 7a3.5 3.5 0 0 0 7 0q0 -2 -3.5 -7z" fill="${TEAR}" stroke="${INK}" stroke-width="1.6"/>`).join(''),
    ),
  );
}

function raindrop(): Frag {
  return frag(`<path d="M5 1q-4 7 -4 10a4 4 0 0 0 8 0q0 -3 -4 -10z" fill="${TEAR}" stroke="${INK}" stroke-width="1.4"/><path d="M3.5 10q0 1.6 1.4 2" stroke="#ffffff" stroke-width="1.2" fill="none" stroke-linecap="round"/>`);
}

function linkBeam(): Frag {
  const f = frag();
  f.defs.set('lb', `<linearGradient id="lb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="24"><stop offset="0" stop-color="#ffd23f" stop-opacity="0"/><stop offset="0.3" stop-color="#ffd23f" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fffbe0"/><stop offset="0.7" stop-color="#ffd23f" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></linearGradient>`);
  f.content = `<rect x="4" y="0" width="120" height="24" rx="12" fill="url(#lb)"/><rect x="8" y="10" width="112" height="4" rx="2" fill="#ffffff"/>`;
  return f;
}

function linkSpark(): Frag {
  return frag(
    `<circle cx="16" cy="16" r="14" fill="#ffd23f" fill-opacity="0.35"/>` +
      `<path d="${sparkleD(16, 16, 13)}" fill="#fff6b0" stroke="${INK}" stroke-width="2"/>` +
      `<circle cx="16" cy="16" r="3" fill="#ffffff"/>`,
  );
}

function coin(): Frag {
  return merge(
    shape(ellipseD(16, 16, 14, 14), { fill: '#ffd23f', shade: '#e8a020', shadeOffset: [-3, -3], sw: 2.6 }),
    frag(
      `<circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff1a0" stroke-width="1.6"/>` +
        `<path d="${starD(16, 16.5, 6)}" fill="#f0a020" stroke="#c07a10" stroke-width="1" stroke-linejoin="round"/>` +
        hiArc('M8 12q2 -5 7 -6', 2, 0.85),
    ),
  );
}

function sparkle(): Frag {
  return frag(`<path d="${sparkleD(8, 8, 7)}" fill="#ffffff"/>`);
}

function tide(): Frag {
  // 波长 32px，整张 256px 横向无缝
  const wave = (y: number, amp: number) => {
    let d = `M0 ${y}`;
    for (let x = 0; x < 256; x += 32) d += `q16 ${-amp} 32 0`;
    return d;
  };
  return frag(
    `<path d="${wave(14, 12)}V48H0Z" fill="#7fc8ff" fill-opacity="0.85"/>` +
      `<path d="${wave(22, 10)}V48H0Z" fill="#4aa3e8" fill-opacity="0.9"/>` +
      line(wave(14, 12), '#ffffff', 3, ' stroke-opacity="0.85"') +
      `<circle cx="40" cy="30" r="2.4" fill="#ffffff" fill-opacity="0.7"/><circle cx="170" cy="34" r="2" fill="#ffffff" fill-opacity="0.7"/>`,
  );
}

export function build(write: (rel: string, data: string) => void): number {
  const list: [string, number, number, Frag][] = [
    ['flame', 32, 48, flame(32, 48)],
    ['flame_small', 20, 28, flame(20, 28)],
    ['ice', 32, 32, ice()],
    ['ice_shard', 16, 16, iceShard()],
    ['firework_burst', 128, 128, fireworkBurst()],
    ['firework_star', 24, 24, frag(`<path d="${starD(12, 12.5, 10.5)}" fill="#ffd23f" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`)],
    ['firework_dot', 12, 12, frag(`<circle cx="6" cy="6" r="5" fill="${WHITE}"/>`)],
    ['firework_trail', 8, 40, frag(`<defs><linearGradient id="tr" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="40"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><path d="M4 0L7 36A3 3 0 0 1 1 36Z" fill="url(#tr)"/>`)],
    ['raincloud', 128, 80, raincloud()],
    ['raindrop', 10, 16, raindrop()],
    ['link_beam', 128, 24, linkBeam()],
    ['link_spark', 32, 32, linkSpark()],
    ['coin', 32, 32, coin()],
    ['sparkle', 16, 16, sparkle()],
    ['tide', 256, 48, tide()],
  ];
  for (const [name, w, h, f] of list) write(`fx/${name}.svg`, svgDoc(w, h, f));
  return list.length;
}
