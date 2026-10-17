/**
 * 第八批精灵：夜探（DESIGN.md 2.3、3.6、3.8）——巡夜将、镇门石兽、夜探的房子和摊子、三档宝箱（关/开）、撤离门（关/开）、
 * 宝物图标（40 种图标名，按类别画底图再换材质色，不是每件一张）、守卫发现主角的"!"。
 * 房子、台阶墙和 sprites6 的墙一样按段拼接：横向的周期 80，竖向的周期 80，画到画布外一点，接缝处没有描边。
 */
import { TREASURES } from '../../content/treasures.ts';
import type { SpriteDef } from './sprites.ts';
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

const SNOW = '#f6f9fd';
const SNOW_D = '#cdd8e6';

// ───────────────────────── 巡夜将 ─────────────────────────

/** 巡夜将：黑甲、红缨盔、苍白的脸，一手提刀一手挑一盏红灯笼（半径 26，画 72 × 92） */
function patrol(c: Ctx): void {
  const arm = '#343a4a';
  const armD = '#1f232e';
  const trim = '#d9b04a';
  // 灯笼竿 + 灯笼（左手）
  blob(c, rrect(8.5, 36, 3, 46, 1), '#5b4a3d', '#3d3029', 1.8, 0.8);
  stroke(c, (k) => { k.moveTo(10, 38); k.lineTo(10, 43); }, 1.4);
  const g = c.createRadialGradient(10, 52, 2, 10, 52, 22);
  g.addColorStop(0, 'rgba(255,190,110,0.55)');
  g.addColorStop(1, 'rgba(255,190,110,0)');
  c.fillStyle = g;
  c.fillRect(-12, 30, 44, 44);
  blob(c, ellipse(10, 53, 8, 10), '#e2452f', '#b8301f', 2.2, 1.8);
  dab(c, ellipse(10, 53, 3.5, 6), '#ffd57a', 0.6);
  blob(c, rrect(5, 42, 10, 3, 1), INK, null, 1);
  blob(c, rrect(5, 62, 10, 3, 1), INK, null, 1);
  // 脚
  blob(c, ellipse(27, 88, 7, 3.4), '#15131a', null, 2);
  blob(c, ellipse(46, 88, 7, 3.4), '#15131a', null, 2);
  // 甲裙
  blob(c, poly(21, 56, 53, 56, 59, 86, 15, 86), arm, armD, 2.6, 2.4);
  for (const x of [25, 31, 37, 43, 49]) stroke(c, (k) => { k.moveTo(x, 60); k.lineTo(x + (x - 37) * 0.2, 85); }, 1, '#12141b');
  stroke(c, (k) => { k.moveTo(17, 78); k.lineTo(57, 78); }, 1.2, '#12141b');
  blob(c, rrect(15, 83, 44, 4, 1.4), trim, null, 1.6);
  // 胸甲 + 护心镜
  blob(c, rrect(22, 38, 30, 24, 6), '#3f4659', armD, 2.6, 2.2);
  stroke(c, (k) => { k.moveTo(24, 50); k.lineTo(50, 50); }, 1.1, '#12141b');
  blob(c, circle(37, 46, 6), trim, '#a98428', 1.8, 1.4);
  dab(c, circle(35.3, 44.3, 1.6), '#fff2bb', 0.9);
  blob(c, rrect(22, 59, 30, 5, 1.5), '#8a2a22', null, 1.6);
  // 持刀的手臂 + 刀
  blob(c, rrect(48, 44, 19, 8, 3.5), arm, armD, 2.2, 1.4);
  blob(c, rrect(64.5, 8, 5.5, 50, 1.5), '#dfe5ee', '#9ea8b8', 2, 1);
  blob(c, poly(64.5, 9, 67.3, 1, 70, 9), '#dfe5ee', null, 1.8);
  blob(c, rrect(60.5, 54, 13.5, 4.5, 2), trim, null, 1.6);
  blob(c, rrect(65, 58, 4.5, 10, 2), '#6a2e25', null, 1.6);
  // 肩甲
  blob(c, ellipse(20, 40, 9.5, 6.4, -0.3), arm, armD, 2.4, 1.6);
  blob(c, ellipse(54, 40, 9.5, 6.4, 0.3), arm, armD, 2.4, 1.6);
  stroke(c, (k) => { k.moveTo(12, 43); k.quadraticCurveTo(20, 47, 27, 43.5); }, 1.8, trim);
  stroke(c, (k) => { k.moveTo(47, 43.5); k.quadraticCurveTo(54, 47, 62, 43); }, 1.8, trim);
  // 左臂（提灯笼）
  blob(c, rrect(9, 41, 12, 7, 3), arm, armD, 2.2, 1.4);
  blob(c, circle(11, 44.5, 3.2), '#c3cdbd', null, 1.6);
  // 头：苍白发青的脸，红眼
  blob(c, circle(37, 27, 12.5), '#cfdccb', '#9fb39e', 2.6, 2.6);
  blob(c, poly(25, 25, 30, 33, 28, 38, 24, 31), '#2b2f3a', null, 1.8);
  blob(c, poly(49, 25, 44, 33, 46, 38, 50, 31), '#2b2f3a', null, 1.8);
  dab(c, ellipse(31.5, 28.6, 2.6, 3.2), '#e0322e');
  dab(c, ellipse(42.5, 28.6, 2.6, 3.2), '#e0322e');
  dab(c, circle(31.8, 28.6, 1.1), INK);
  dab(c, circle(42.2, 28.6, 1.1), INK);
  stroke(c, (k) => { k.moveTo(27.5, 23.6); k.lineTo(34.5, 25.2); }, 2);
  stroke(c, (k) => { k.moveTo(46.5, 23.6); k.lineTo(39.5, 25.2); }, 2);
  stroke(c, (k) => { k.moveTo(33, 35.5); k.lineTo(41, 35.5); }, 1.6);
  // 盔 + 红缨
  blob(c, (k) => { k.moveTo(24, 22); k.quadraticCurveTo(24, 6, 37, 5); k.quadraticCurveTo(50, 6, 50, 22); k.quadraticCurveTo(37, 17, 24, 22); }, arm, armD, 2.6, 2);
  blob(c, rrect(22, 19.5, 30, 4.5, 2), trim, null, 1.6);
  blob(c, rrect(35, 1.5, 4, 8, 1.5), trim, null, 1.6);
  blob(c, (k) => { k.moveTo(37, 2); k.quadraticCurveTo(30, -3, 25, 3); k.quadraticCurveTo(31, 3, 37, 6); }, '#d0362e', '#9c2420', 1.8, 1);
  blob(c, (k) => { k.moveTo(37, 2); k.quadraticCurveTo(44, -3, 49, 3); k.quadraticCurveTo(43, 3, 37, 6); }, '#d0362e', '#9c2420', 1.8, 1);
  dab(c, ellipse(30, 11, 3, 1.4, -0.4), '#7a82a0', 0.7);
  // 肩头残雪
  dab(c, ellipse(19, 36.5, 7, 2.2, -0.2), SNOW);
  dab(c, ellipse(55, 36.5, 7, 2.2, 0.2), SNOW);
}

// ───────────────────────── 镇门石兽 ─────────────────────────

/** 镇门石兽：青黑色的大石兽蹲在石台上，独角、鬃毛成刺、胸口和肩上有琥珀色的镇符，眼睛发光（半径 46，画 130 × 118） */
function beast(c: Ctx): void {
  const s = '#7f8da0';
  const sd = '#56627a';
  const dark = '#3a4358';
  const amber = '#f0b030';
  // 石台
  blob(c, rrect(6, 98, 118, 18, 4), '#6f7889', '#4b5465', 2.6, 2.2);
  dab(c, rrect(10, 100, 110, 3, 1.4), '#a7b0c0');
  stroke(c, (k) => { k.moveTo(36, 99); k.lineTo(34, 106); k.lineTo(38, 113); }, 1.2, '#3a4150');
  stroke(c, (k) => { k.moveTo(96, 100); k.lineTo(99, 108); }, 1.2, '#3a4150');
  // 尾巴：粗而卷
  blob(c, (k) => { k.moveTo(24, 82); k.quadraticCurveTo(2, 78, 8, 54); k.quadraticCurveTo(14, 40, 26, 46); k.quadraticCurveTo(16, 56, 22, 68); k.quadraticCurveTo(30, 74, 34, 78); }, s, sd, 2.6, 2);
  blob(c, circle(18, 47, 8), '#8f9cae', sd, 2.2, 1.6);
  stroke(c, (k) => { k.arc(18, 47, 3.4, 0.4, 4.8); }, 1.1, dark);
  // 身体和后腿
  blob(c, ellipse(54, 76, 36, 22), s, sd, 2.8, 3.2);
  blob(c, rrect(24, 80, 26, 20, 7), s, sd, 2.6, 2);
  blob(c, rrect(62, 82, 22, 18, 6), s, sd, 2.6, 2);
  // 前腿和爪
  blob(c, rrect(84, 70, 20, 32, 8), s, sd, 2.6, 2);
  blob(c, rrect(98, 86, 22, 15, 6), '#8f9cae', sd, 2.4, 1.6);
  for (const x of [104, 110, 116]) stroke(c, (k) => { k.moveTo(x, 93); k.lineTo(x, 100); }, 1.3, dark);
  // 背上的积雪和脊刺
  for (const [x, y] of [[40, 56], [52, 52], [64, 53], [76, 58]] as const) blob(c, poly(x - 6, y + 6, x, y - 8, x + 6, y + 6), dark, null, 2);
  blob(c, (k) => { k.moveTo(32, 58); k.quadraticCurveTo(54, 48, 82, 60); k.quadraticCurveTo(64, 58, 56, 60); k.quadraticCurveTo(44, 56, 32, 58); }, SNOW, SNOW_D, 1.8, 1.2);
  // 鬃毛：一圈尖刺
  const spikes: Array<[number, number, number, number]> = [[84, 18, 78, 4], [96, 14, 98, -1], [108, 20, 118, 8], [114, 32, 126, 28], [114, 46, 126, 50], [76, 28, 62, 22], [74, 42, 60, 44]];
  for (const [x, y, tx, ty] of spikes) {
    const nx = -(ty - y) * 0.45;
    const ny = (tx - x) * 0.45;
    blob(c, poly(x - nx, y - ny, tx, ty, x + nx, y + ny), '#6a7890', sd, 2.2, 1.4);
  }
  // 脸
  blob(c, ellipse(96, 38, 24, 22), s, sd, 2.8, 3);
  // 独角
  blob(c, poly(90, 18, 96, -2, 102, 18), '#c9d0d8', '#8f98a6', 2.2, 1.4);
  stroke(c, (k) => { k.moveTo(94, 12); k.lineTo(98, 11); k.moveTo(93, 7); k.lineTo(97, 6); }, 1, '#586070');
  // 眉骨
  blob(c, (k) => { k.moveTo(78, 28); k.quadraticCurveTo(86, 20, 95, 28); k.quadraticCurveTo(87, 27, 78, 28); }, dark, null, 1.8);
  blob(c, (k) => { k.moveTo(98, 28); k.quadraticCurveTo(107, 20, 114, 28); k.quadraticCurveTo(106, 27, 98, 28); }, dark, null, 1.8);
  // 发光的眼睛
  const eg = c.createRadialGradient(87, 35, 1, 87, 35, 11);
  eg.addColorStop(0, 'rgba(255,200,80,0.6)');
  eg.addColorStop(1, 'rgba(255,200,80,0)');
  c.fillStyle = eg;
  c.fillRect(74, 22, 26, 26);
  const eg2 = c.createRadialGradient(106, 35, 1, 106, 35, 11);
  eg2.addColorStop(0, 'rgba(255,200,80,0.6)');
  eg2.addColorStop(1, 'rgba(255,200,80,0)');
  c.fillStyle = eg2;
  c.fillRect(93, 22, 26, 26);
  blob(c, circle(87, 35, 5.4), '#fff1c4', null, 2.2);
  blob(c, circle(106, 35, 5.4), '#fff1c4', null, 2.2);
  dab(c, circle(88, 35.4, 3), '#f08a20');
  dab(c, circle(107, 35.4, 3), '#f08a20');
  dab(c, circle(88, 35.4, 1.4), INK);
  dab(c, circle(107, 35.4, 1.4), INK);
  // 鼻、嘴、獠牙
  blob(c, ellipse(96, 44, 4.6, 3), dark, null, 1.8);
  blob(c, (k) => { k.moveTo(80, 50); k.quadraticCurveTo(96, 66, 114, 50); k.quadraticCurveTo(96, 55, 80, 50); }, '#2a2230', null, 2);
  blob(c, poly(84, 52, 87.5, 52, 86, 60), '#f4efe0', null, 1.4);
  blob(c, poly(104, 52, 108, 52, 106.5, 60), '#f4efe0', null, 1.4);
  // 镇符：胸口和肩上的琥珀色符文
  const rune = (x: number, y: number, k: number): void => {
    stroke(c, (p) => { p.moveTo(x - 6 * k, y - 7 * k); p.lineTo(x + 6 * k, y - 7 * k); p.moveTo(x, y - 7 * k); p.lineTo(x, y + 7 * k); p.moveTo(x - 5 * k, y); p.lineTo(x + 5 * k, y); p.moveTo(x - 4 * k, y + 6 * k); p.lineTo(x + 4 * k, y + 6 * k); }, 2.6, '#7a4a10');
    stroke(c, (p) => { p.moveTo(x - 6 * k, y - 7 * k); p.lineTo(x + 6 * k, y - 7 * k); p.moveTo(x, y - 7 * k); p.lineTo(x, y + 7 * k); p.moveTo(x - 5 * k, y); p.lineTo(x + 5 * k, y); p.moveTo(x - 4 * k, y + 6 * k); p.lineTo(x + 4 * k, y + 6 * k); }, 1.3, amber);
  };
  rune(72, 76, 1);
  rune(44, 70, 0.8);
  // 裂纹
  stroke(c, (k) => { k.moveTo(34, 64); k.lineTo(38, 72); k.lineTo(34, 78); k.lineTo(37, 86); }, 1.3, '#2e3544');
  stroke(c, (k) => { k.moveTo(62, 90); k.lineTo(60, 96); }, 1.2, '#2e3544');
  stroke(c, (k) => { k.moveTo(108, 24); k.lineTo(106, 30); }, 1.1, '#2e3544');
  dab(c, ellipse(100, 20, 6, 2, -0.2), SNOW, 0.9);
}

// ───────────────────────── 宝箱 ─────────────────────────

type ChestLook = { body: string; bodyD: string; band: string; lid: string; lidD: string };
const CHEST_LOOK: Record<'wood' | 'copper' | 'gold', ChestLook> = {
  wood: { body: '#94623a', bodyD: '#664125', band: '#4a4350', lid: '#a8703f', lidD: '#744a2a' },
  copper: { body: '#c27c3c', bodyD: '#8e5220', band: '#f0c070', lid: '#d28c46', lidD: '#9e5e28' },
  gold: { body: '#e8c04c', bodyD: '#b8903a', band: '#c8402f', lid: '#f4d060', lidD: '#c49a30' },
};

/** 宝箱（48 × 44，锚点在箱底）：关着是拱盖加锁，开着是盖子掀到后面、箱口一团暖光 */
function chest(c: Ctx, tier: 'wood' | 'copper' | 'gold', open: boolean): void {
  const L = CHEST_LOOK[tier];
  const gold = tier === 'gold';
  if (open) {
    const g = c.createRadialGradient(24, 20, 2, 24, 18, 26);
    g.addColorStop(0, 'rgba(255,230,140,0.85)');
    g.addColorStop(1, 'rgba(255,230,140,0)');
    c.fillStyle = g;
    c.fillRect(-2, -6, 52, 46);
    // 后掀的盖子（只看到内侧和一道边）
    blob(c, rrect(7, 2, 34, 13, 3), L.lidD, null, 2.4);
    dab(c, rrect(10, 4.5, 28, 7, 2), '#3a2a22', 0.65);
    blob(c, rrect(5, 22, 38, 19, 3), L.body, L.bodyD, 2.6, 2.2);
    // 箱口
    blob(c, ellipse(24, 22, 18, 4.6), '#2a1a14', null, 2.2);
    dab(c, ellipse(24, 21.4, 14, 2.6), '#ffd978', 0.85);
    for (const [x, y] of [[17, 19.5], [24, 18.8], [31, 19.8]] as const) dab(c, circle(x, y, 1.5), '#fff6c8');
  } else {
    blob(c, rrect(5, 21, 38, 20, 3), L.body, L.bodyD, 2.6, 2.2);
    blob(c, (k) => { k.moveTo(4, 24); k.lineTo(4, 17); k.quadraticCurveTo(4, 4, 24, 4); k.quadraticCurveTo(44, 4, 44, 17); k.lineTo(44, 24); }, L.lid, L.lidD, 2.6, 2.4);
    dab(c, ellipse(17, 10, 8, 2.4, -0.3), '#ffffff', 0.35);
  }
  // 铁箍 / 铜箍 / 红漆金边
  for (const x of [11, 33]) {
    blob(c, rrect(x - 2.6, open ? 22 : 5, 5.2, open ? 19 : 36, 1.2), L.band, null, 1.6);
    if (!open) stroke(c, (k) => { k.moveTo(x - 2.6, 20); k.lineTo(x + 2.6, 20); }, 1, 'rgba(23,19,28,0.6)');
  }
  // 锁扣
  if (!open) {
    blob(c, rrect(19.5, 18.5, 9, 10, 2), gold ? '#c8402f' : '#d9b04a', null, 2);
    dab(c, circle(24, 22.6, 1.5), INK);
    dab(c, rrect(23.3, 22.8, 1.5, 3, 0.6), INK);
    if (gold) dab(c, circle(24, 12, 2.6), '#7fe0ff');
  } else if (gold) dab(c, circle(24, 33, 2.6), '#7fe0ff');
  // 箱脚的雪
  dab(c, ellipse(24, 41.2, 19, 1.6), SNOW, 0.85);
  if (tier === 'copper') {
    dab(c, ellipse(36, 30, 3, 2), '#6aa890', 0.6);
    dab(c, ellipse(14, 34, 2.4, 1.6), '#6aa890', 0.55);
  }
}

// ───────────────────────── 撤离门 ─────────────────────────

/** 镇门（136 × 120，锚点在门脚）：两根朱红柱、飞檐覆雪的门楼；关着是两扇红门加横闩，开着是门敞开、里面一团白金的光 */
function gate(c: Ctx, open: boolean): void {
  const red = '#b8372b';
  const redD: string = '#842419';
  const roof = '#2e3038';
  const roofD = '#1f2027';
  // 地上的光（开着的门：门里的光漫到地上）
  if (open) {
    const g = c.createRadialGradient(68, 100, 6, 68, 100, 62);
    g.addColorStop(0, 'rgba(255,236,170,0.8)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    c.fillStyle = g;
    c.fillRect(0, 56, 136, 64);
  }
  // 台阶
  blob(c, rrect(18, 106, 100, 12, 2), '#8e939d', '#686d78', 2.4, 1.6);
  dab(c, ellipse(68, 106.5, 46, 2), SNOW);
  // 门洞
  blob(c, rrect(32, 52, 72, 56, 2), open ? '#fff2c0' : '#14111a', null, 2.6);
  if (open) {
    const g = c.createLinearGradient(0, 52, 0, 108);
    g.addColorStop(0, '#fff6d4');
    g.addColorStop(1, '#ffd87a');
    c.fillStyle = g;
    c.fillRect(34, 54, 68, 52);
    // 光柱
    for (const x of [48, 60, 76, 88]) dab(c, poly(x - 3, 56, x + 3, 56, x + 9 * (x < 68 ? -1 : 1), 106, x + 3 * (x < 68 ? -1 : 1) - 6, 106), '#ffffff', 0.25);
    // 敞开的门扇（贴着两边，只剩窄窄的一条）
    blob(c, poly(32, 54, 42, 58, 42, 106, 32, 108), red, redD, 2.2, 1.6);
    blob(c, poly(104, 54, 94, 58, 94, 106, 104, 108), red, redD, 2.2, 1.6);
    for (const y of [68, 82, 96]) {
      dab(c, circle(37, y, 1.5), '#e2b94a');
      dab(c, circle(99, y, 1.5), '#e2b94a');
    }
  } else {
    blob(c, rrect(34, 54, 34, 52, 1.5), red, redD, 2.2, 1.8);
    blob(c, rrect(68, 54, 34, 52, 1.5), red, redD, 2.2, 1.8);
    for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) {
      dab(c, circle(42 + q * 9, 64 + r * 11, 1.5), '#e2b94a');
      dab(c, circle(76 + q * 9, 64 + r * 11, 1.5), '#e2b94a');
    }
    // 横闩 + 锁链
    blob(c, rrect(30, 78, 76, 7, 2), '#3a2a22', null, 2.2);
    blob(c, circle(68, 81.5, 5), '#8d9099', '#656872', 1.8, 1.2);
    dab(c, circle(68, 81.5, 1.6), INK);
    stroke(c, (k) => { k.moveTo(68, 52); k.lineTo(68, 108); }, 1.4, INK);
  }
  // 柱
  for (const x of [20, 106]) {
    blob(c, rrect(x, 46, 12, 64, 2), red, redD, 2.6, 1.8);
    blob(c, rrect(x - 3, 104, 18, 7, 2), '#8e939d', '#686d78', 2.2, 1.2);
    blob(c, rrect(x - 2, 46, 16, 5, 1.5), '#e2b94a', null, 1.6);
  }
  // 横梁 + 匾
  blob(c, rrect(16, 38, 104, 10, 2), red, redD, 2.6, 1.6);
  blob(c, rrect(52, 20, 32, 18, 2), '#2a1c18', null, 2.4);
  stroke(c, (k) => k.rect(54.5, 22.5, 27, 13), 1, '#e2b94a');
  stroke(c, (k) => { k.moveTo(60, 27); k.lineTo(76, 27); k.moveTo(62, 32); k.lineTo(74, 32); }, 1.5, '#f0c850');
  // 屋檐：两层，翘角
  blob(c, poly(2, 22, 18, 8, 118, 8, 134, 22, 124, 26, 12, 26), roof, roofD, 2.6, 2.4);
  for (let x = 14; x < 124; x += 9) stroke(c, (k) => { k.moveTo(x, 11); k.lineTo(x - (x - 68) * 0.1, 24); }, 1.1, 'rgba(10,10,16,0.7)');
  blob(c, (k) => { k.moveTo(2, 22); k.quadraticCurveTo(-3, 22, -1, 14); k.quadraticCurveTo(4, 20, 8, 22); }, roof, null, 2);
  blob(c, (k) => { k.moveTo(134, 22); k.quadraticCurveTo(139, 22, 137, 14); k.quadraticCurveTo(132, 20, 128, 22); }, roof, null, 2);
  blob(c, (k) => {
    k.moveTo(14, 15); k.lineTo(24, 8); k.lineTo(112, 8); k.lineTo(122, 15);
    k.quadraticCurveTo(108, 19, 96, 15); k.quadraticCurveTo(80, 19, 68, 15); k.quadraticCurveTo(54, 19, 40, 15); k.quadraticCurveTo(28, 19, 14, 15);
  }, SNOW, SNOW_D, 1.8, 1.2);
  blob(c, rrect(44, 2, 48, 7, 2), '#3a3d48', roofD, 2.2, 1.2);
  dab(c, ellipse(68, 3.6, 18, 2), SNOW);
  // 两盏灯笼
  for (const x of [28, 108]) {
    stroke(c, (k) => { k.moveTo(x, 26); k.lineTo(x, 32); }, 1.6);
    blob(c, ellipse(x, 38, 6, 7.5), open ? '#ffd57a' : '#e2452f', open ? '#e2a23a' : '#b8301f', 2, 1.4);
    dab(c, ellipse(x, 38, 2.4, 4), '#fff2c0', 0.6);
  }
}

// ───────────────────────── 房子、摊子、台阶墙 ─────────────────────────

/** 一段横向房子（80 宽，画 128 高，锚点在房脚）：下面是粉墙加窗，上面是覆雪的瓦顶。周期 80：窗在正中，瓦楞每 10 一条 */
function houseH(c: Ctx, hall: boolean): void {
  const wall = hall ? '#a8372b' : '#d4d1c8';
  const wallD = hall ? '#7e2519' : '#aaa8a2';
  const roof = hall ? '#2c4a48' : '#4a4f5c';
  const roofD = hall ? '#1c312f' : '#33373f';
  const wood = hall ? '#e2b94a' : '#6a4a38';
  // 墙身
  blob(c, (k) => k.rect(-4, 78, 88, 50), wall, wallD, 2.4, 2.2);
  blob(c, (k) => k.rect(-4, 118, 88, 10), '#8a8f99', '#646a76', 2.2, 1.4);
  for (const x of [-3, 77]) blob(c, rrect(x, 78, 6, 40, 1.4), hall ? '#7e2519' : '#6a4a38', null, 1.8);
  // 窗：格子窗，里面透出暖光
  blob(c, rrect(26, 88, 28, 24, 2), hall ? '#7e2519' : '#4a3328', null, 2.2);
  // 夜里这是镇子上最显眼的暖光：窗外的光晕洒到墙上，窗纸里亮黄、中心偏白
  const wg = c.createRadialGradient(40, 100, 4, 40, 100, 34);
  wg.addColorStop(0, 'rgba(255,200,110,0.5)');
  wg.addColorStop(1, 'rgba(255,200,110,0)');
  c.fillStyle = wg;
  c.fillRect(0, 78, 80, 40);
  dab(c, rrect(29, 91, 22, 18, 1), '#ffd36e', 1);
  dab(c, rrect(33, 94, 14, 12, 1), '#fff1b8', 0.7);
  for (const x of [34.5, 40, 45.5]) stroke(c, (k) => { k.moveTo(x, 91); k.lineTo(x, 109); }, 1.2, wood);
  stroke(c, (k) => { k.moveTo(29, 100); k.lineTo(51, 100); }, 1.2, wood);
  // 瓦顶
  blob(c, (k) => k.rect(-4, 10, 88, 66), roof, roofD, 2.6, 2.6);
  for (let x = 5; x < 80; x += 10) stroke(c, (k) => { k.moveTo(x, 14); k.lineTo(x, 74); }, 1.1, 'rgba(10,10,16,0.55)');
  for (let y = 22; y < 74; y += 11) stroke(c, (k) => { k.moveTo(-2, y); k.lineTo(82, y); }, 1, 'rgba(10,10,16,0.3)');
  // 屋檐一道
  blob(c, (k) => k.rect(-4, 70, 88, 9), hall ? '#1c312f' : '#2e3038', null, 2.2);
  dab(c, (k) => k.rect(-2, 71.5, 84, 1.6), hall ? '#d4a93a' : '#5a5e6a', 0.9);
  // 屋脊
  blob(c, (k) => k.rect(-4, 4, 88, 9), hall ? '#d4a93a' : '#3a3d48', hall ? '#a98428' : roofD, 2.2, 1.2);
  // 雪：盖住屋顶的大半，下沿起伏（周期 40）
  blob(c, (k) => {
    k.moveTo(-4, 6);
    for (let x = -4; x <= 84; x += 2) k.lineTo(x, 5 - Math.sin(((x + 4) / 40) * Math.PI * 2) * 1.2);
    k.lineTo(84, 46);
    for (let x = 84; x >= -4; x -= 2) k.lineTo(x, 44 + Math.sin((x / 40) * Math.PI * 2) * 4 + Math.max(0, Math.sin((x / 20) * Math.PI * 2)) * 3);
  }, SNOW, SNOW_D, 1.8, 1.6);
  dab(c, ellipse(20, 8, 8, 1.1), '#ffffff', 0.9);
  dab(c, ellipse(60, 8, 8, 1.1), '#ffffff', 0.9);
}

/** 一段竖向房子（110 宽，高 80 一段，锚点在段底）：俯视的瓦顶，中间一道覆雪的脊。周期 80 */
function houseV(c: Ctx, hall: boolean): void {
  const roof = hall ? '#2c4a48' : '#4a4f5c';
  const roofD = hall ? '#1c312f' : '#33373f';
  blob(c, (k) => k.rect(3, -4, 104, 88), roof, roofD, 2.6, 2.6);
  for (let y = 4; y < 80; y += 10) stroke(c, (k) => { k.moveTo(5, y); k.lineTo(105, y); }, 1, 'rgba(10,10,16,0.45)');
  for (let x = 17; x < 100; x += 11) if (Math.abs(x - 55) > 8) stroke(c, (k) => { k.moveTo(x, -2); k.lineTo(x, 82); }, 1, 'rgba(10,10,16,0.25)');
  // 两边屋檐
  blob(c, (k) => k.rect(3, -4, 8, 88), hall ? '#1c312f' : '#2e3038', null, 2);
  blob(c, (k) => k.rect(99, -4, 8, 88), hall ? '#1c312f' : '#2e3038', null, 2);
  // 脊
  blob(c, (k) => k.rect(48, -4, 14, 88), hall ? '#d4a93a' : '#3a3d48', null, 2);
  blob(c, (k) => {
    k.moveTo(44, -4);
    for (let y = -4; y <= 84; y += 2) k.lineTo(44 - Math.sin(((y + 4) / 40) * Math.PI * 2) * 1.5, y);
    k.lineTo(66, 84);
    for (let y = 84; y >= -4; y -= 2) k.lineTo(66 + Math.sin((y / 20) * Math.PI * 2) * 1.6, y);
  }, SNOW, SNOW_D, 1.8, 1.4);
  // 坡上的雪块（周期 80）
  const rng = artRng(hall ? 91 : 81);
  for (let i = 0; i < 5; i++) {
    const x = rng() < 0.5 ? 14 + rng() * 22 : 74 + rng() * 22;
    const y = 4 + Math.floor(rng() * 7) * 11;
    dab(c, ellipse(x, y, 7 + rng() * 5, 2.4), SNOW, 0.9);
  }
}

/** 摊子（96 × 80，锚点在脚）：红白条的遮阳棚，下面一张摆货的桌子，两只筐 */
function stall(c: Ctx): void {
  // 柱
  for (const x of [16, 78]) blob(c, rrect(x, 30, 4, 46, 1.4), '#5b4a3d', '#3d3029', 2, 1);
  // 桌
  blob(c, rrect(10, 50, 76, 22, 2), '#8a5c38', '#5e3b20', 2.4, 2);
  blob(c, rrect(8, 46, 80, 8, 2), '#a8703f', '#744a2a', 2.2, 1.4);
  // 货：筐、布匹、罐
  blob(c, ellipse(26, 45, 11, 5), '#c9a24a', '#8e6e2a', 2, 1.4);
  for (const [x, col] of [[24, '#7fb04a'], [29, '#e2452f'], [33, '#e8c04c']] as const) dab(c, circle(x, 41, 3), col);
  blob(c, rrect(44, 38, 20, 10, 2), '#d24a3a', '#9c2f26', 2, 1.4);
  blob(c, rrect(46, 34, 16, 6, 2), '#f1ead6', '#cfc3a2', 2, 1);
  blob(c, ellipse(76, 42, 6, 6), '#b9743e', '#865228', 2, 1.4);
  blob(c, rrect(72, 34, 8, 4, 1.5), '#865228', null, 1.6);
  // 遮阳棚：红白条
  blob(c, poly(4, 36, 14, 12, 82, 12, 92, 36), '#f4efe2', '#d3cbb6', 2.6, 2);
  for (let i = 0; i < 6; i += 2) {
    const x0 = 4 + i * 14.7;
    const x1 = x0 + 14.7;
    dab(c, poly(14 + (x0 - 4) * (68 / 88), 12, 14 + (x1 - 4) * (68 / 88), 12, x1, 36, x0, 36), '#d0362e');
  }
  stroke(c, (k) => { k.moveTo(4, 36); k.lineTo(92, 36); }, 2, INK);
  blob(c, (k) => {
    k.moveTo(12, 16); k.lineTo(16, 12); k.lineTo(80, 12); k.lineTo(84, 16);
    k.quadraticCurveTo(70, 19, 58, 15); k.quadraticCurveTo(40, 19, 26, 15); k.quadraticCurveTo(18, 18, 12, 16);
  }, SNOW, SNOW_D, 1.6, 1.2);
  for (let x = 8; x < 92; x += 11) blob(c, (k) => { k.moveTo(x, 36); k.quadraticCurveTo(x + 5.5, 43, x + 11, 36); }, x % 22 < 11 ? '#d0362e' : '#f4efe2', null, 1.6);
}

/** 山寺的台阶墙一段（80 宽，画 56 高，锚点在脚；墙厚 26）：石砌的挡墙，上面一道覆雪的压顶，墙面上石缝 */
function terrace(c: Ctx): void {
  const st = '#8b95a3';
  const stD = '#626c7a';
  blob(c, (k) => k.rect(-4, 20, 88, 36), st, stD, 2.4, 2.4);
  const mortar = 'rgba(30,34,44,0.5)';
  for (const [y0, off] of [[30, 0], [40, 14], [50, 0]] as const) {
    stroke(c, (k) => { k.moveTo(-2, y0); k.lineTo(82, y0); }, 1.1, mortar);
    for (let x = 14 + off; x < 80; x += 28) stroke(c, (k) => { k.moveTo(x, y0 - 10); k.lineTo(x, y0); }, 1.1, mortar);
  }
  const rng = artRng(33);
  for (let i = 0; i < 6; i++) dab(c, rrect(4 + Math.floor(rng() * 6) * 13, 22 + Math.floor(rng() * 3) * 10, 10, 6, 1.5), '#b0bac8', 0.5);
  // 压顶石 + 雪
  blob(c, (k) => k.rect(-4, 12, 88, 12), '#a0aab8', stD, 2.4, 1.6);
  blob(c, (k) => {
    k.moveTo(-4, 14);
    k.lineTo(-4, 4);
    for (let x = -4; x <= 84; x += 2) k.lineTo(x, 3.6 - Math.sin(((x + 4) / 40) * Math.PI * 2) * 1.3);
    k.lineTo(84, 14);
    for (let x = 84; x >= -4; x -= 2) k.lineTo(x, 13 + Math.max(0, Math.sin((x / 20) * Math.PI * 2)) * 3);
  }, SNOW, SNOW_D, 1.8, 1.4);
  dab(c, ellipse(40, 55, 50, 2.2), SNOW, 0.9);
}

// ───────────────────────── 守卫发现主角的"!" ─────────────────────────

/** 头上的红色"!"气泡（28 × 36，锚点在中心） */
function alertMark(c: Ctx): void {
  blob(c, (k) => { k.moveTo(14, 34); k.lineTo(9, 24); k.lineTo(19, 24); }, '#e0322e', null, 2.2);
  blob(c, circle(14, 14, 12), '#e0322e', '#a81f22', 2.8, 2);
  blob(c, rrect(11.6, 6.4, 4.8, 10.5, 2.2), '#ffffff', null, 0);
  dab(c, circle(14, 20.6, 2.6), '#ffffff');
  dab(c, ellipse(9, 9, 3, 1.6, -0.6), '#ffffff', 0.5);
}

// ───────────────────────── 宝物图标 ─────────────────────────

interface Mat { f: string; s: string }
/** 材质色：每个图标名一种 */
const MAT: Record<string, Mat> = {
  jade: { f: '#86cfa0', s: '#4f9a72' }, ivory: { f: '#f1ead6', s: '#cfc3a2' }, porcelain: { f: '#f4f6fa', s: '#b9c3d6' },
  wood: { f: '#b5835a', s: '#7d5535' }, bronze: { f: '#cfa24e', s: '#94692a' }, red: { f: '#d9503e', s: '#9c2f26' },
  green: { f: '#86b84e', s: '#568030' }, clay: { f: '#bf7a42', s: '#865228' }, bamboo: { f: '#d4c870', s: '#9c9040' },
  orange: { f: '#eb9640', s: '#b36420' }, silver: { f: '#dde2ea', s: '#9aa3b4' }, iron: { f: '#8f94a0', s: '#5d626d' },
  celadon: { f: '#a4d4c4', s: '#6ea594' }, lacquer: { f: '#46302e', s: '#241818' }, purple: { f: '#92607e', s: '#5f3a52' },
  gold: { f: '#f4cc52', s: '#c19a2c' }, parchment: { f: '#eadcac', s: '#c0aa72' }, amber: { f: '#eaac3c', s: '#b87a1c' },
  blue: { f: '#6a9ae0', s: '#3a64a8' }, white: { f: '#eef4ef', s: '#b5c7bd' }, pearl: { f: '#e8f6ff', s: '#a8cce0' },
};

const ICON_MAT: Record<string, string> = {
  ring: 'jade', bead: 'ivory', bowl: 'porcelain', comb: 'wood', lock: 'bronze', lamp: 'bronze', candle: 'red', cricket: 'green',
  pouch: 'red', jar: 'clay', coins: 'bronze', propeller: 'bamboo', tiger: 'orange', flask: 'silver', shears: 'iron',
  vase: 'celadon', pin: 'silver', stove: 'bronze', fan: 'wood', shoe: 'red', box: 'lacquer', tiles: 'ivory', bottle: 'blue',
  puppet: 'orange', teapot: 'purple', mirror: 'bronze', pearl: 'pearl', bangle: 'jade', zither: 'wood', coral: 'red',
  qilin: 'white', sachet: 'gold', scroll: 'parchment', amber: 'amber', seal: 'jade', plate: 'bronze', toad: 'gold',
  ginseng: 'ivory', crown: 'gold', furnace: 'bronze',
};

/** 每个图标名画成 32 × 32 的小图：先按类别起底图，再用这个图标的材质色上色 */
const ICON_DRAW: Record<string, (c: Ctx, m: Mat) => void> = {
  // 圈：戒指、手镯
  ring: (c, m) => {
    const donut = (cx: number, cy: number, rx: number, ri: number) => (k: Ctx): void => { k.arc(cx, cy, rx, 0, Math.PI * 2); k.moveTo(cx + ri, cy); k.arc(cx, cy, ri, 0, Math.PI * 2, true); };
    blob(c, donut(16, 17, 11, 6), m.f, m.s, 2.2, 1.8);
    dab(c, ellipse(10.5, 11.5, 3, 1.4, -0.6), '#ffffff', 0.6);
    blob(c, circle(16, 6.4, 2.6), '#e2452f', null, 1.6);
  },
  bangle: (c, m) => {
    const donut = (cx: number, cy: number, rx: number, ri: number) => (k: Ctx): void => { k.arc(cx, cy, rx, 0, Math.PI * 2); k.moveTo(cx + ri, cy); k.arc(cx, cy, ri, 0, Math.PI * 2, true); };
    blob(c, donut(16, 16, 13, 8), m.f, m.s, 2.4, 2.2);
    dab(c, ellipse(9, 10, 4, 1.4, -0.7), '#ffffff', 0.7);
    stroke(c, (k) => { k.arc(16, 16, 10.5, 0.3, 1.3); }, 1.2, m.s);
  },
  // 珠：算盘珠、夜明珠、琥珀蝉
  bead: (c, m) => {
    blob(c, ellipse(16, 17, 12, 9), m.f, m.s, 2.4, 2.2);
    dab(c, circle(16, 17, 2.8), INK);
    dab(c, ellipse(10, 13, 3, 1.4, -0.5), '#ffffff', 0.7);
  },
  pearl: (c, m) => {
    const g = c.createRadialGradient(16, 16, 4, 16, 16, 16);
    g.addColorStop(0, 'rgba(190,240,255,0.9)');
    g.addColorStop(1, 'rgba(190,240,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    blob(c, circle(16, 16, 9.5), m.f, m.s, 2.4, 2);
    dab(c, ellipse(12.5, 12, 3, 2, -0.6), '#ffffff', 0.95);
  },
  amber: (c, m) => {
    blob(c, (k) => { k.moveTo(16, 3); k.quadraticCurveTo(28, 14, 25, 21); k.quadraticCurveTo(22, 29, 16, 29); k.quadraticCurveTo(8, 29, 6, 21); k.quadraticCurveTo(5, 14, 16, 3); }, m.f, m.s, 2.4, 2.2);
    blob(c, ellipse(16, 17, 3, 6.5), '#4a2f14', null, 1.2);
    blob(c, ellipse(12, 16, 3.8, 2, -0.8), 'rgba(90,60,25,0.75)', null, 0.8);
    blob(c, ellipse(20, 16, 3.8, 2, 0.8), 'rgba(90,60,25,0.75)', null, 0.8);
    dab(c, ellipse(11, 9, 2.4, 1.4, -0.7), '#ffffff', 0.7);
  },
  // 器皿
  bowl: (c, m) => {
    blob(c, (k) => { k.moveTo(3, 12); k.lineTo(29, 12); k.quadraticCurveTo(28, 26, 16, 27); k.quadraticCurveTo(4, 26, 3, 12); }, m.f, m.s, 2.4, 2.2);
    blob(c, ellipse(16, 12, 13, 3.2), '#dfe5ee', null, 1.8);
    blob(c, rrect(10, 26, 12, 3, 1), m.s, null, 1.6);
    stroke(c, (k) => { k.moveTo(6, 17); k.quadraticCurveTo(16, 21, 26, 17); }, 1.4, '#4a7fd0');
    blob(c, poly(22, 8.5, 26, 11.5, 24, 12.4, 21, 10), '#17131c', null, 0);
  },
  jar: (c, m) => {
    blob(c, ellipse(16, 20, 11, 9.5), m.f, m.s, 2.4, 2.2);
    blob(c, rrect(10, 8, 12, 5, 1.5), m.s, null, 1.8);
    blob(c, rrect(8, 5, 16, 4, 1.5), m.f, m.s, 1.8, 1);
    stroke(c, (k) => { k.moveTo(7, 19); k.quadraticCurveTo(16, 24, 25, 19); }, 1.3, 'rgba(23,19,28,0.5)');
    dab(c, ellipse(11, 17, 2.4, 1.4, -0.6), '#ffffff', 0.45);
  },
  vase: (c, m) => {
    blob(c, (k) => { k.moveTo(12, 4); k.lineTo(20, 4); k.lineTo(19, 11); k.quadraticCurveTo(28, 15, 25, 23); k.quadraticCurveTo(23, 29, 16, 29); k.quadraticCurveTo(9, 29, 7, 23); k.quadraticCurveTo(4, 15, 13, 11); }, m.f, m.s, 2.4, 2.2);
    blob(c, rrect(10.5, 2.5, 11, 3.4, 1.4), m.s, null, 1.6);
    stroke(c, (k) => { k.moveTo(11, 18); k.quadraticCurveTo(16, 22, 21, 18); }, 1.3, '#3f8470');
    dab(c, ellipse(10, 17, 1.8, 3.6, 0.3), '#ffffff', 0.5);
  },
  bottle: (c, m) => {
    blob(c, (k) => { k.moveTo(13, 8); k.lineTo(19, 8); k.lineTo(19, 12); k.quadraticCurveTo(27, 15, 26, 22); k.quadraticCurveTo(25, 29, 16, 29); k.quadraticCurveTo(7, 29, 6, 22); k.quadraticCurveTo(5, 15, 13, 12); }, '#eef2f8', '#b9c3d6', 2.4, 2);
    blob(c, circle(16, 5.6, 3.2), '#e0452f', '#a81f22', 1.8, 1);
    dab(c, ellipse(16, 21, 6, 5), m.f, 0.9);
    dab(c, ellipse(14, 20, 2.2, 2.6), '#ffffff', 0.6);
  },
  flask: (c, m) => {
    blob(c, rrect(8, 8, 16, 21, 5), m.f, m.s, 2.4, 2.2);
    blob(c, rrect(12, 3, 8, 6, 1.5), m.s, null, 1.8);
    blob(c, rrect(9, 15, 14, 7, 1), '#b8902e', null, 1.2);
    dab(c, rrect(10.5, 10, 2.6, 17, 1.2), '#ffffff', 0.55);
  },
  teapot: (c, m) => {
    blob(c, (k) => { k.moveTo(23, 14); k.quadraticCurveTo(31, 9, 29, 4); k.quadraticCurveTo(27, 8, 22, 11); }, m.f, m.s, 2, 1);
    blob(c, (k) => { k.moveTo(8, 12); k.quadraticCurveTo(0, 12, 1, 20); k.quadraticCurveTo(3, 25, 8, 23); k.lineTo(8, 20); k.quadraticCurveTo(5, 20, 5, 17); k.quadraticCurveTo(5, 15, 8, 15); }, m.f, m.s, 2, 1);
    blob(c, ellipse(15, 19, 9.5, 8.5), m.f, m.s, 2.4, 2);
    blob(c, ellipse(15, 11, 6, 2.4), m.s, null, 1.8);
    blob(c, circle(15, 8.6, 2), m.f, m.s, 1.6, 0.8);
    dab(c, ellipse(11, 16, 2.4, 1.6, -0.5), '#ffffff', 0.4);
  },
  stove: (c, m) => {
    stroke(c, (k) => { k.arc(16, 11, 8, Math.PI, 0); }, 3.6, INK);
    stroke(c, (k) => { k.arc(16, 11, 8, Math.PI, 0); }, 1.8, m.f);
    blob(c, ellipse(16, 20, 12, 9), m.f, m.s, 2.4, 2.2);
    blob(c, ellipse(16, 13.5, 8.5, 3), m.s, null, 1.8);
    for (const x of [11, 16, 21]) dab(c, circle(x, 13.5, 1.1), INK);
    dab(c, ellipse(10, 20, 2.4, 3.2, 0.2), '#ffffff', 0.4);
  },
  furnace: (c, m) => {
    // 炉里的一缕烟
    stroke(c, (k) => { k.moveTo(16, 11); k.quadraticCurveTo(12, 7, 16, 4); k.quadraticCurveTo(20, 1, 17, -1); }, 1.6, 'rgba(120,120,140,0.7)');
    for (const x of [8, 24]) blob(c, rrect(x - 1.5, 21, 3.4, 8, 1.4), m.s, null, 1.8);
    blob(c, rrect(15, 22, 3, 7, 1.4), m.s, null, 1.8);
    blob(c, ellipse(16, 18, 11, 8.5), m.f, m.s, 2.4, 2);
    blob(c, rrect(3.4, 9, 4.6, 7.4, 2), m.f, m.s, 1.8, 1);
    blob(c, rrect(24, 9, 4.6, 7.4, 2), m.f, m.s, 1.8, 1);
    blob(c, ellipse(16, 11.6, 8.5, 2.8), m.s, null, 1.8);
    dab(c, ellipse(16, 11.4, 4.8, 1.4), '#ff9a3a', 0.9);
    stroke(c, (k) => { k.moveTo(8, 18); k.lineTo(24, 18); }, 1.1, 'rgba(23,19,28,0.45)');
  },
  // 盒、袋、锁
  box: (c, m) => {
    blob(c, rrect(4, 14, 24, 14, 2.4), m.f, m.s, 2.4, 2);
    blob(c, rrect(4, 7, 24, 9, 2.4), '#5a3a3a', m.s, 2.4, 1.6);
    stroke(c, (k) => { k.moveTo(5, 16); k.lineTo(27, 16); }, 1.6, '#e2b94a');
    blob(c, rrect(13.5, 13, 5, 6, 1.4), '#e2b94a', null, 1.6);
    dab(c, rrect(7, 18, 18, 1.6, 0.8), '#c8402f', 0.9);
    dab(c, circle(9, 10.4, 1.4), '#e2b94a');
    dab(c, circle(23, 10.4, 1.4), '#e2b94a');
  },
  pouch: (c, m) => {
    blob(c, (k) => { k.moveTo(11, 9); k.quadraticCurveTo(2, 18, 5, 25); k.quadraticCurveTo(16, 31, 27, 25); k.quadraticCurveTo(30, 18, 21, 9); }, m.f, m.s, 2.4, 2.2);
    blob(c, (k) => { k.moveTo(9, 9); k.quadraticCurveTo(16, 13, 23, 9); k.lineTo(21, 5); k.quadraticCurveTo(16, 8, 11, 5); }, m.s, null, 2);
    stroke(c, (k) => { k.moveTo(11, 8); k.quadraticCurveTo(4, 4, 6, 1); k.moveTo(21, 8); k.quadraticCurveTo(28, 4, 26, 1); }, 1.5, '#e2b94a');
    for (let i = 0; i < 5; i++) dab(c, ellipse(16 + Math.cos((i / 5) * 6.28) * 3.4, 20 + Math.sin((i / 5) * 6.28) * 3.4, 2, 1.6, (i / 5) * 6.28), '#ffe08a');
    dab(c, circle(16, 20, 1.3), '#c8402f');
  },
  sachet: (c, m) => {
    stroke(c, (k) => { k.arc(16, 6, 5, Math.PI, 0); }, 2.6, INK);
    stroke(c, (k) => { k.arc(16, 6, 5, Math.PI, 0); }, 1.2, m.f);
    blob(c, circle(16, 18, 10), m.f, m.s, 2.4, 2);
    stroke(c, (k) => { k.moveTo(6, 18); k.lineTo(26, 18); k.moveTo(16, 8); k.lineTo(16, 28); }, 1.3, 'rgba(23,19,28,0.55)');
    for (const [x, y] of [[11, 13], [21, 13], [11, 23], [21, 23]] as const) dab(c, circle(x, y, 1.7), '#3a2a1c');
    dab(c, ellipse(11.5, 12, 2.4, 1.2, -0.6), '#ffffff', 0.7);
  },
  lock: (c, m) => {
    stroke(c, (k) => { k.arc(16, 12, 6.4, Math.PI, 0); k.lineTo(22.4, 15); k.moveTo(9.6, 12); k.lineTo(9.6, 15); }, 4, INK);
    stroke(c, (k) => { k.arc(16, 12, 6.4, Math.PI, 0); k.lineTo(22.4, 15); k.moveTo(9.6, 12); k.lineTo(9.6, 15); }, 2, m.s);
    blob(c, rrect(6, 14, 20, 15, 3.4), m.f, m.s, 2.4, 2);
    dab(c, circle(16, 20.4, 2.4), INK);
    dab(c, rrect(15.2, 21, 1.8, 4.4, 0.8), INK);
    dab(c, ellipse(9.5, 17, 1.6, 1, -0.5), '#ffffff', 0.6);
  },
  // 光：灯、烛
  lamp: (c, m) => {
    const g = c.createRadialGradient(18, 10, 1, 18, 10, 12);
    g.addColorStop(0, 'rgba(255,220,120,0.7)');
    g.addColorStop(1, 'rgba(255,220,120,0)');
    c.fillStyle = g;
    c.fillRect(4, 0, 28, 24);
    blob(c, (k) => { k.moveTo(3, 21); k.quadraticCurveTo(10, 28, 22, 26); k.quadraticCurveTo(29, 24, 29, 20); k.lineTo(22, 19); k.lineTo(8, 19); }, m.f, m.s, 2.4, 2);
    blob(c, (k) => { k.moveTo(3, 21); k.lineTo(0, 18); k.lineTo(8, 19); }, m.f, null, 1.8);
    blob(c, (k) => { k.moveTo(18, 18); k.quadraticCurveTo(12, 11, 18, 3); k.quadraticCurveTo(24, 11, 18, 18); }, '#f08a20', null, 1.8);
    dab(c, ellipse(18, 12.5, 2, 3.6), '#ffe9a0');
  },
  candle: (c, m) => {
    blob(c, ellipse(16, 28, 9, 2.6), '#8a8f99', '#646a76', 1.8, 1);
    blob(c, (k) => { k.moveTo(11, 13); k.lineTo(21, 13); k.lineTo(21, 27); k.lineTo(11, 27); }, m.f, m.s, 2.2, 1.8);
    dab(c, (k) => { k.moveTo(11, 13); k.lineTo(21, 13); k.lineTo(21, 15); k.quadraticCurveTo(18, 18, 16, 16); k.quadraticCurveTo(13, 19, 11, 16); }, '#f7d5c8', 0.9);
    stroke(c, (k) => { k.moveTo(16, 13); k.lineTo(16, 10); }, 1.4);
    blob(c, (k) => { k.moveTo(16, 10); k.quadraticCurveTo(11, 5, 16, -1); k.quadraticCurveTo(21, 5, 16, 10); }, '#f08a20', null, 1.8);
    dab(c, ellipse(16, 5.6, 1.7, 3), '#ffe9a0');
  },
  // 圆盘：镜、盘、钱串、骨牌
  mirror: (c, m) => {
    blob(c, rrect(13.5, 22, 5, 9, 2), '#6a4a38', null, 1.8);
    blob(c, circle(16, 13, 11.5), m.f, m.s, 2.4, 2.2);
    blob(c, circle(16, 13, 8.2), '#dfe8ee', null, 1.6);
    dab(c, ellipse(12.4, 9.6, 4, 1.8, -0.7), '#ffffff', 0.85);
    stroke(c, (k) => { k.arc(16, 13, 10, 0.4, 2.4); }, 1, m.s);
  },
  plate: (c, m) => {
    blob(c, circle(16, 16, 13.5), m.f, m.s, 2.6, 2.4);
    blob(c, circle(16, 16, 9), m.s, null, 1.6);
    blob(c, circle(16, 16, 3.6), m.f, null, 1.6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 - 1.2;
      dab(c, circle(16 + Math.cos(a) * 11.4, 16 + Math.sin(a) * 11.4, 1.3), '#fff0b0');
    }
    stroke(c, (k) => { k.moveTo(16, 7); k.lineTo(16, 25); k.moveTo(7, 16); k.lineTo(25, 16); }, 1, m.f);
    dab(c, ellipse(9.5, 9, 3.6, 1.4, -0.7), '#ffffff', 0.5);
  },
  coins: (c, m) => {
    stroke(c, (k) => { k.moveTo(16, 3); k.quadraticCurveTo(15, 12, 16, 16); }, 1.8, '#9c2f26');
    for (const [x, y] of [[9, 22], [22, 22], [15.5, 14]] as const) {
      blob(c, circle(x, y, 7.4), m.f, m.s, 2.2, 1.6);
      blob(c, (k) => k.rect(x - 2.2, y - 2.2, 4.4, 4.4), '#2a1c18', null, 1.2);
      dab(c, ellipse(x - 3, y - 3.4, 2, 1, -0.6), '#ffffff', 0.5);
    }
  },
  tiles: (c) => {
    for (const [x, y, r] of [[3, 12, -0.12], [16, 9, 0.1]] as const) {
      c.save();
      c.translate(x + 6.5, y + 9);
      c.rotate(r);
      blob(c, rrect(-6.5, -9, 13, 18, 2.2), '#f6f1e2', '#cfc3a2', 2.2, 1.6);
      stroke(c, (k) => { k.moveTo(-6, 0); k.lineTo(6, 0); }, 1.2);
      for (const [dx, dy] of [[-2.6, -5.5], [2.6, -5.5], [-2.6, -2.5], [2.6, -2.5]] as const) dab(c, circle(dx, dy, 1.1), '#c8402f');
      for (const [dx, dy] of [[0, 4], [-2.6, 6.5], [2.6, 6.5], [0, 7]] as const) if (dy !== 7) dab(c, circle(dx, dy, 1.1), INK);
      c.restore();
    }
  },
  // 长条：梳、簪、剪、竹蜻蜓、扇
  comb: (c, m) => {
    blob(c, rrect(3, 5, 26, 11, 4), m.f, m.s, 2.4, 1.8);
    for (let i = 0; i < 9; i++) if (i !== 3 && i !== 7) stroke(c, (k) => { k.moveTo(6 + i * 2.5, 15); k.lineTo(6 + i * 2.5, 27); }, 1.6, INK);
    for (let i = 0; i < 9; i++) if (i !== 3 && i !== 7) stroke(c, (k) => { k.moveTo(6 + i * 2.5, 15); k.lineTo(6 + i * 2.5, 26); }, 0.8, m.f);
    dab(c, ellipse(11, 8, 4, 1.2), '#ffffff', 0.45);
  },
  pin: (c, m) => {
    stroke(c, (k) => { k.moveTo(5, 28); k.lineTo(22, 11); }, 4.4, INK);
    stroke(c, (k) => { k.moveTo(5, 28); k.lineTo(22, 11); }, 2.4, m.f);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - 1.2;
      blob(c, circle(24 + Math.cos(a) * 4.4, 8 + Math.sin(a) * 4.4, 3.2), '#ffd0dc', '#e08ca4', 1.8, 0.8);
    }
    blob(c, circle(24, 8, 2.4), '#f4cc52', null, 1.4);
  },
  shears: (c, m) => {
    stroke(c, (k) => { k.moveTo(9, 25); k.lineTo(24, 4); k.moveTo(23, 25); k.lineTo(8, 4); }, 5, INK);
    stroke(c, (k) => { k.moveTo(9, 25); k.lineTo(24, 4); k.moveTo(23, 25); k.lineTo(8, 4); }, 3, m.f);
    blob(c, circle(8, 27, 3.6), 'rgba(0,0,0,0)', null, 2.4);
    blob(c, circle(24, 27, 3.6), 'rgba(0,0,0,0)', null, 2.4);
    stroke(c, (k) => { k.arc(8, 27, 3.6, 0, 6.3); k.moveTo(27.6, 27); k.arc(24, 27, 3.6, 0, 6.3); }, 1.6, m.s);
    dab(c, circle(16, 15, 1.6), INK);
  },
  propeller: (c, m) => {
    blob(c, rrect(14.4, 12, 3.2, 17, 1.4), '#8a5c38', null, 1.8);
    c.save();
    c.translate(16, 10);
    c.rotate(-0.28);
    blob(c, rrect(-13, -2.6, 26, 5.2, 2.4), m.f, m.s, 2.2, 1.2);
    c.restore();
    blob(c, circle(16, 10, 2.2), '#c8402f', null, 1.4);
  },
  fan: (c, m) => {
    blob(c, (k) => { k.moveTo(16, 28); k.lineTo(2, 11); k.quadraticCurveTo(16, 0, 30, 11); }, m.f, m.s, 2.4, 2);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + 0.62 + (i / 6) * (Math.PI - 1.24);
      stroke(c, (k) => { k.moveTo(16, 28); k.lineTo(16 + Math.cos(a) * 17, 28 + Math.sin(a) * 17); }, 1, 'rgba(23,19,28,0.55)');
    }
    stroke(c, (k) => { k.moveTo(3, 12); k.quadraticCurveTo(16, 1, 29, 12); }, 1.6, '#e2b94a');
    blob(c, circle(16, 28, 2.2), '#c8402f', null, 1.4);
  },
  // 卷：画卷、琴
  scroll: (c, m) => {
    c.save();
    c.translate(16, 16);
    c.rotate(-0.5);
    blob(c, rrect(-13, -6.5, 26, 13, 1.5), m.f, m.s, 2.2, 1.6);
    blob(c, rrect(-15, -8.5, 5, 17, 2.4), '#8a5c38', '#5e3b20', 2, 1);
    blob(c, rrect(10, -8.5, 5, 17, 2.4), '#8a5c38', '#5e3b20', 2, 1);
    stroke(c, (k) => { k.moveTo(-6, 2); k.lineTo(-2, -3); k.lineTo(2, 1); k.lineTo(6, -4); }, 1.4, '#4a6a5a');
    dab(c, circle(7, 3, 1.6), '#c8402f');
    c.restore();
  },
  zither: (c, m) => {
    c.save();
    c.translate(16, 16);
    c.rotate(-0.35);
    blob(c, (k) => { k.moveTo(-15, -4); k.lineTo(13, -6); k.quadraticCurveTo(16, 0, 13, 6); k.lineTo(-15, 4); k.quadraticCurveTo(-17, 0, -15, -4); }, m.f, m.s, 2.4, 1.8);
    for (let i = 0; i < 5; i++) stroke(c, (k) => { k.moveTo(-14, -2.5 + i * 1.3); k.lineTo(12, -3.4 + i * 1.7); }, 0.8, i === 2 ? 'rgba(0,0,0,0)' : '#f4efe2');
    for (let i = 0; i < 5; i++) dab(c, circle(-11 + i * 0.4, -2.6 + i * 1.3, 0.8), '#e2b94a');
    c.restore();
  },
  // 动物、人物
  cricket: (c, m) => {
    for (const [x, y, tx, ty] of [[10, 17, 3, 26], [14, 18, 9, 28], [19, 18, 22, 28]] as const) stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x - 1, y - 6); k.lineTo(tx, ty); }, 1.8, m.s);
    blob(c, ellipse(14, 17, 11, 4.6, -0.12), m.f, m.s, 2.2, 1.4);
    blob(c, circle(25, 14, 4), m.f, m.s, 2, 1);
    dab(c, circle(26.4, 13, 1.2), INK);
    stroke(c, (k) => { k.moveTo(27, 11); k.quadraticCurveTo(30, 6, 31, 3); }, 1, m.s);
    stroke(c, (k) => { k.moveTo(4, 17); k.lineTo(1, 20); }, 1.4, m.s);
  },
  tiger: (c, m) => {
    for (const x of [8, 24]) blob(c, circle(x, 8, 4.2), m.f, m.s, 2, 1);
    blob(c, circle(16, 17, 12.5), m.f, m.s, 2.6, 2.2);
    blob(c, ellipse(16, 22, 7, 5), '#fff6e0', null, 1.6);
    for (const x of [-1, 1]) {
      dab(c, rrect(16 + x * 9 - 1.3, 9, 2.6, 5, 1), INK);
      blob(c, circle(16 + x * 5.4, 16, 2.4), '#ffffff', null, 1.4);
      dab(c, circle(16 + x * 5.4 + (x > 0 ? -0.4 : 0.4), 16.4, 1.2), INK);
    }
    dab(c, rrect(14.7, 7, 2.6, 5, 1), INK);
    blob(c, ellipse(16, 20.4, 2, 1.4), INK, null, 0);
    stroke(c, (k) => { k.moveTo(16, 21.5); k.lineTo(16, 24); k.moveTo(12.6, 24.4); k.quadraticCurveTo(16, 27, 19.4, 24.4); }, 1.3);
  },
  puppet: (c, m) => {
    stroke(c, (k) => { k.moveTo(16, 1); k.lineTo(16, 29); k.moveTo(25, 14); k.lineTo(31, 4); }, 1.4, '#8a5c38');
    blob(c, circle(16, 7, 4.4), m.f, m.s, 2, 1);
    blob(c, poly(9, 13, 23, 13, 25, 29, 7, 29), m.f, m.s, 2.2, 1.6);
    blob(c, (k) => { k.moveTo(22, 14); k.lineTo(27, 13); k.lineTo(27, 16); k.lineTo(22, 18); }, m.f, m.s, 1.8, 1);
    for (const [x, y] of [[13, 20], [19, 20], [16, 25]] as const) dab(c, circle(x, y, 1.4), '#f6e8b0', 0.9);
    dab(c, rrect(12, 5, 8, 1.2, 0.6), '#c8402f');
  },
  toad: (c, m) => {
    blob(c, ellipse(16, 21, 12.5, 8), m.f, m.s, 2.6, 2.2);
    blob(c, ellipse(5.5, 25.5, 4, 3), m.f, m.s, 2, 1);
    blob(c, ellipse(26.5, 25.5, 4, 3), m.f, m.s, 2, 1);
    blob(c, ellipse(16, 12, 9, 6.6), m.f, m.s, 2.4, 1.8);
    for (const x of [10.5, 21.5]) {
      blob(c, circle(x, 6.6, 3.6), m.f, m.s, 2, 1);
      dab(c, circle(x, 6.6, 2), '#fff1c4');
      dab(c, circle(x, 6.8, 1), INK);
    }
    stroke(c, (k) => { k.moveTo(8, 14); k.quadraticCurveTo(16, 18, 24, 14); }, 1.4);
    blob(c, circle(16, 17.4, 3.4), m.f, m.s, 1.6, 0.8);
    blob(c, (k) => k.rect(14.8, 16.2, 2.4, 2.4), '#2a1c18', null, 0);
    for (const [x, y] of [[9, 20], [14, 23], [20, 21], [23, 24]] as const) dab(c, circle(x, y, 1.1), m.s);
  },
  qilin: (c, m) => {
    stroke(c, (k) => { k.moveTo(5, 21); k.quadraticCurveTo(0, 14, 5, 10); }, 4, INK);
    stroke(c, (k) => { k.moveTo(5, 21); k.quadraticCurveTo(0, 14, 5, 10); }, 2, m.f);
    blob(c, ellipse(14, 21, 11, 6.5), m.f, m.s, 2.4, 2);
    blob(c, rrect(6, 22, 5, 7, 2), m.f, m.s, 1.8, 1);
    blob(c, rrect(20, 22, 5, 7, 2), m.f, m.s, 1.8, 1);
    blob(c, ellipse(22, 11.6, 7, 6.4), m.f, m.s, 2.4, 1.8);
    blob(c, poly(20, 6, 22.5, -1, 25, 6), '#f4cc52', null, 1.6);
    for (const [x, y] of [[16, 9], [15, 14], [17, 18]] as const) blob(c, circle(x, y, 2.6), m.s, null, 1.4);
    dab(c, circle(24, 11, 1.5), INK);
    stroke(c, (k) => { k.moveTo(25, 15); k.quadraticCurveTo(27, 14, 29, 15); }, 1.2);
  },
  shoe: (c, m) => {
    blob(c, (k) => { k.moveTo(4, 14); k.quadraticCurveTo(4, 9, 9, 9); k.lineTo(14, 9); k.quadraticCurveTo(14, 17, 22, 18); k.quadraticCurveTo(29, 19, 29, 25); k.lineTo(4, 25); }, m.f, m.s, 2.4, 2);
    blob(c, (k) => { k.moveTo(29, 25); k.quadraticCurveTo(31, 22, 29, 19); k.quadraticCurveTo(26, 14, 27, 11); k.quadraticCurveTo(31, 14, 31, 21); k.quadraticCurveTo(32, 24, 29, 25); }, m.f, m.s, 1.8, 0.8);
    blob(c, rrect(3, 24, 27, 4, 1.6), '#f1ead6', '#cfc3a2', 1.8, 0.8);
    for (let i = 0; i < 5; i++) dab(c, ellipse(10 + Math.cos((i / 5) * 6.28) * 2.6, 16.5 + Math.sin((i / 5) * 6.28) * 2.6, 1.7, 1.3, (i / 5) * 6.28), '#ffe08a');
  },
  ginseng: (c, m) => {
    for (const [x, tx] of [[10, 5], [16, 16], [22, 27]] as const) stroke(c, (k) => { k.moveTo(x, 20); k.quadraticCurveTo((x + tx) / 2, 26, tx, 31); }, 1.3, m.s);
    for (const x of [4, 8, 25, 28]) stroke(c, (k) => { k.moveTo(16, 24); k.lineTo(x, 30); }, 0.9, m.s);
    blob(c, (k) => { k.moveTo(16, 8); k.quadraticCurveTo(24, 12, 22, 20); k.quadraticCurveTo(20, 26, 16, 27); k.quadraticCurveTo(12, 26, 10, 20); k.quadraticCurveTo(8, 12, 16, 8); }, m.f, m.s, 2.4, 2);
    for (const y of [14, 18, 22]) stroke(c, (k) => { k.moveTo(11, y); k.lineTo(21, y); }, 0.9, m.s);
    stroke(c, (k) => { k.moveTo(16, 8); k.lineTo(16, 4); }, 1.6, '#4a7a3a');
    for (const [x, y, r] of [[11, 3, -0.5], [21, 3, 0.5], [16, 0.5, 0]] as const) {
      c.save();
      c.translate(x, y);
      c.rotate(r);
      blob(c, ellipse(0, 0, 2.2, 4.4), '#6aa84a', '#4a7a3a', 1.6, 0.8);
      c.restore();
    }
  },
  // 冠、印、珊瑚
  crown: (c, m) => {
    blob(c, rrect(4, 20, 24, 7, 2.4), m.f, m.s, 2.4, 1.6);
    blob(c, poly(4, 21, 4, 8, 10, 15, 16, 3, 22, 15, 28, 8, 28, 21), m.f, m.s, 2.4, 2);
    for (const [x, y] of [[4, 8], [16, 3], [28, 8]] as const) blob(c, circle(x, y, 2.6), '#e8f6ff', '#a8cce0', 1.6, 0.8);
    for (const x of [9, 16, 23]) dab(c, circle(x, 23.5, 1.7), x === 16 ? '#e0322e' : '#4a8fe0');
    dab(c, circle(16, 14, 2.2), '#e0322e');
    stroke(c, (k) => { k.moveTo(9, 28); k.lineTo(7, 31); k.moveTo(23, 28); k.lineTo(25, 31); }, 1.6, '#4a8fe0');
  },
  seal: (c, m) => {
    blob(c, rrect(6, 16, 20, 13, 2.4), m.f, m.s, 2.4, 1.8);
    blob(c, ellipse(16, 11, 7.6, 5.4), m.f, m.s, 2.2, 1.6);
    blob(c, (k) => { k.moveTo(10, 11); k.quadraticCurveTo(10, 3, 17, 4); k.quadraticCurveTo(22, 5, 21, 9); }, m.s, null, 1.6);
    dab(c, circle(20.4, 7.6, 1.2), INK);
    dab(c, rrect(9, 21, 14, 1.6, 0.8), '#c8402f', 0.9);
    dab(c, rrect(9, 24.5, 14, 1.6, 0.8), '#c8402f', 0.9);
    dab(c, ellipse(9.5, 19, 1.6, 1, -0.5), '#ffffff', 0.5);
  },
  coral: (c, m) => {
    const arm = (k: Ctx, pts: number[]): void => { k.moveTo(pts[0]!, pts[1]!); for (let i = 2; i < pts.length; i += 2) k.lineTo(pts[i]!, pts[i + 1]!); };
    const A = [[16, 30, 16, 20, 10, 12, 8, 4], [16, 20, 22, 13, 25, 5], [12, 16, 5, 13, 3, 8], [20, 16, 27, 15, 30, 11]];
    for (const p of A) stroke(c, (k) => arm(k, p), 6, INK);
    for (const p of A) stroke(c, (k) => arm(k, p), 3.6, m.f);
    for (const p of A) stroke(c, (k) => arm(k, p.map((v, i) => (i % 2 ? v : v - 0.8))), 1, '#ffb0a0');
    blob(c, ellipse(16, 30, 7, 2), '#8e939d', null, 1.6);
  },
};

function iconDefs(): SpriteDef[] {
  const names = [...new Set(TREASURES.map((t) => t.icon))];
  return names.map((name) => ({
    key: `t_${name}`,
    w: 32,
    h: 32,
    ox: 0.5,
    oy: 0.5,
    draw: (c: Ctx): void => {
      const draw = ICON_DRAW[name];
      const m = MAT[ICON_MAT[name] ?? 'bronze']!;
      if (draw) draw(c, m);
      else blob(c, circle(16, 16, 10), m.f, m.s);
    },
  }));
}

/** 宝物 → 图集帧名（藏宝阁、拾取飘字都用这个） */
export function treasureIconKey(icon: string): string {
  return `t_${icon}`;
}

export const SPRITES8: SpriteDef[] = [
  { key: 'patrol', w: 72, h: 92, ox: 0.5, oy: 0.95, draw: patrol },
  { key: 'beast', w: 130, h: 118, ox: 0.5, oy: 0.95, draw: beast },
  { key: 'chest_wood', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'wood', false) },
  { key: 'chest_wood_open', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'wood', true) },
  { key: 'chest_copper', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'copper', false) },
  { key: 'chest_copper_open', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'copper', true) },
  { key: 'chest_gold', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'gold', false) },
  { key: 'chest_gold_open', w: 48, h: 44, ox: 0.5, oy: 0.93, draw: (c) => chest(c, 'gold', true) },
  { key: 'gate_closed', w: 136, h: 120, ox: 0.5, oy: 0.95, draw: (c) => gate(c, false) },
  { key: 'gate_open', w: 136, h: 120, ox: 0.5, oy: 0.95, draw: (c) => gate(c, true) },
  { key: 'house_h', w: 80, h: 128, ox: 0.5, oy: 1, draw: (c) => houseH(c, false) },
  { key: 'house_v', w: 110, h: 80, ox: 0.5, oy: 1, draw: (c) => houseV(c, false) },
  { key: 'hall_h', w: 80, h: 128, ox: 0.5, oy: 1, draw: (c) => houseH(c, true) },
  { key: 'hall_v', w: 110, h: 80, ox: 0.5, oy: 1, draw: (c) => houseV(c, true) },
  { key: 'stall', w: 96, h: 80, ox: 0.5, oy: 0.96, draw: stall },
  { key: 'terrace_h', w: 80, h: 56, ox: 0.5, oy: 1, draw: terrace },
  { key: 'alert', w: 28, h: 36, ox: 0.5, oy: 0.5, draw: alertMark },
  ...iconDefs(),
];
