/**
 * 第六批精灵：义庄地图的墙、棺材和点缀（DESIGN.md 3.6）。
 * 墙段要无缝拼接：横墙左右、竖墙上下都不画收口，描边和砖缝的周期都能整除段长，
 * 横向/纵向的色块都画到画布外一点（画布会裁掉，所以接口处没有竖/横向描边）。
 */
import type { SpriteDef } from './sprites.ts';
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

const BRICK = '#7d8896';
const BRICK_D = '#5d6674';
const BRICK_L = '#97a2b0';
const ROOF = '#2e3038';
const ROOF_D = '#1f2027';
const SNOW = '#f6f9fd';
const SNOW_D = '#cdd8e6';

/** 横墙：砖身 + 瓦檐 + 雪。周期 80：砖缝每 20 一格，瓦楞每 10 一条，雪沿 40 一个周期 */
function wallH(c: Ctx): void {
  // 墙身（x 超出画布）
  blob(c, (k) => k.rect(-4, 24, 88, 36), BRICK, BRICK_D, 2.4, 2.4);
  // 砖缝：两行错开
  const mortar = 'rgba(30,34,44,0.55)';
  for (const [y0, off] of [[32, 0], [41, 10], [50, 0]] as const) {
    stroke(c, (k) => { k.moveTo(-2, y0); k.lineTo(82, y0); }, 1.1, mortar);
    for (let x = 10 + off; x < 80; x += 20) {
      if (x <= 0) continue;
      stroke(c, (k) => { k.moveTo(x, y0 - 8.5); k.lineTo(x, y0); }, 1.1, mortar);
    }
  }
  // 墙脚少许积雪
  dab(c, ellipse(40, 59, 50, 2.6), SNOW, 0.9);
  // 砖面零星亮砖
  const rng = artRng(61);
  for (let i = 0; i < 7; i++) dab(c, rrect(4 + Math.floor(rng() * 7) * 11, 26 + Math.floor(rng() * 3) * 9, 8, 4.5, 1), BRICK_L, 0.55);
  // 瓦檐：深灰黑，下沿一道檐
  blob(c, (k) => k.rect(-4, 10, 88, 14), ROOF, ROOF_D, 2.4, 2.2);
  for (let x = 5; x < 80; x += 10) stroke(c, (k) => { k.moveTo(x, 12); k.lineTo(x, 22.5); }, 1.2, 'rgba(10,10,16,0.75)');
  dab(c, (k) => k.rect(-2, 11.5, 84, 1.6), '#4a4e5a', 0.8);
  // 雪盖：上缘起伏（周期 40），下缘垂几条小雪舌
  blob(c, (k) => {
    k.moveTo(-4, 14);
    k.lineTo(-4, 5);
    for (let x = -4; x <= 84; x += 2) k.lineTo(x, 4.2 - Math.sin(((x + 4) / 40) * Math.PI * 2) * 1.3);
    k.lineTo(84, 14);
    for (let x = 84; x >= -4; x -= 2) k.lineTo(x, 13 + Math.max(0, Math.sin((x / 20) * Math.PI * 2)) * 3.2);
  }, SNOW, SNOW_D, 2, 1.4);
  dab(c, ellipse(20, 6.3, 7, 1), '#ffffff', 0.9);
  dab(c, ellipse(60, 6.3, 7, 1), '#ffffff', 0.9);
}

/** 竖墙：俯视只看到墙顶——两侧露砖，中间一条瓦脊，雪盖在脊上。周期 40 */
function wallV(c: Ctx): void {
  blob(c, (k) => k.rect(2, -4, 32, 88), BRICK, BRICK_D, 2.4, 2.2);
  const mortar = 'rgba(30,34,44,0.55)';
  for (let y = 4; y < 80; y += 10) {
    stroke(c, (k) => { k.moveTo(3, y); k.lineTo(8, y); }, 1, mortar);
    stroke(c, (k) => { k.moveTo(28, y + 5); k.lineTo(33, y + 5); }, 1, mortar);
  }
  // 瓦脊
  blob(c, (k) => k.rect(7, -4, 22, 88), ROOF, ROOF_D, 2.2, 2);
  for (let y = 4; y < 80; y += 8) stroke(c, (k) => { k.moveTo(8, y); k.lineTo(28, y); }, 1.1, 'rgba(10,10,16,0.7)');
  // 雪：脊上一条不规则的白带（周期 40）
  blob(c, (k) => {
    k.moveTo(13, -4);
    for (let y = -4; y <= 84; y += 2) k.lineTo(13 - Math.sin(((y + 4) / 40) * Math.PI * 2) * 1.2, y);
    k.lineTo(24, 84);
    for (let y = 84; y >= -4; y -= 2) k.lineTo(23.5 + Math.sin((y / 20) * Math.PI * 2) * 1.3, y);
  }, SNOW, SNOW_D, 1.8, 1.4);
  dab(c, (k) => k.rect(16, -4, 2, 88), '#ffffff', 0.8);
}

/** 棺材：侧视，头高尾低，红褐木，黄符，盖上薄雪，底下两条长凳 */
function coffin(c: Ctx): void {
  const wood = '#6e2f26';
  const woodD = '#4a1f1a';
  // 长凳
  for (const x of [14, 54]) {
    blob(c, rrect(x, 36, 9, 10, 1.5), '#5b4a3d', '#3d3029', 2, 1);
  }
  blob(c, rrect(8, 33, 62, 5, 1.5), '#6b5748', '#46372c', 2, 1.2);
  // 棺身：头（左，高）→ 尾（右，低）
  blob(c, poly(4, 8, 14, 3, 66, 12, 72, 16, 70, 34, 6, 34), wood, woodD, 2.6, 2.6);
  // 盖板与身的分缝
  stroke(c, (k) => { k.moveTo(5, 21); k.lineTo(71, 24); }, 1.8, INK);
  dab(c, poly(8, 6.5, 14, 4.8, 60, 11.5, 56, 13, 14, 8.5), '#9a4a3b', 0.8);
  // 棺头挡板（大端）
  blob(c, poly(4, 8, 13, 3, 13, 34, 6, 34), '#5a2620', '#3e1814', 2.2, 1.4);
  dab(c, circle(8.5, 14, 1.3), '#e2b94a');
  // 钉
  for (const x of [26, 40, 54]) dab(c, circle(x, 28.5 + (x - 26) * 0.07, 1.2), '#c9a24a');
  // 黄符
  blob(c, rrect(31, 8, 10, 15, 1), '#f1d46a', '#c9a93e', 1.6, 1);
  stroke(c, (k) => { k.moveTo(36, 10); k.lineTo(36, 21); }, 1.2, '#b3262a');
  stroke(c, (k) => { k.moveTo(33.2, 13.5); k.lineTo(38.8, 13.5); }, 1, '#b3262a');
  stroke(c, (k) => { k.moveTo(33.2, 17.5); k.lineTo(38.8, 17.5); }, 1, '#b3262a');
  // 盖上薄雪
  blob(c, (k) => {
    k.moveTo(15, 3.5);
    k.lineTo(66, 12);
    k.quadraticCurveTo(68, 13.5, 62, 14);
    k.quadraticCurveTo(52, 11.5, 46, 12.5);
    k.quadraticCurveTo(26, 6.5, 17, 7);
    k.quadraticCurveTo(12, 8, 11, 6);
    k.closePath();
  }, SNOW, SNOW_D, 1.6, 1);
  dab(c, ellipse(8, 8.5, 3.5, 1.5, -0.3), SNOW);
}

/** 义庄正堂门面：两层黑瓦覆雪，木柱，匾（金线），两盏白灯笼，门半掩 */
function hall(c: Ctx): void {
  const wood = '#6a2e25';
  const woodD = '#47201a';
  // 台阶
  blob(c, rrect(24, 150, 172, 16, 2), '#8e939d', '#686d78', 2.4, 1.8);
  dab(c, ellipse(110, 150.5, 80, 2.2), SNOW);
  // 墙身 + 柱
  blob(c, (k) => k.rect(32, 88, 156, 63), '#8a8f9a', '#646a76', 2.4, 2.4);
  // 门洞，半掩露黑
  blob(c, rrect(84, 98, 52, 53, 2), '#0c0b10', null, 2.6);
  blob(c, (k) => k.rect(84, 98, 20, 53), '#7a3328', '#4f211b', 2.2, 1.6);
  stroke(c, (k) => { k.moveTo(94, 100); k.lineTo(94, 150); }, 1, 'rgba(10,6,6,0.7)');
  dab(c, circle(100, 126, 1.6), '#e2b94a');
  // 门框
  blob(c, rrect(80, 94, 6, 57, 1), wood, woodD, 2, 1.2);
  blob(c, rrect(134, 94, 6, 57, 1), wood, woodD, 2, 1.2);
  blob(c, rrect(80, 92, 60, 7, 1.5), wood, woodD, 2, 1.2);
  // 木柱
  for (const x of [34, 66, 146, 176]) blob(c, rrect(x, 88, 10, 63, 1.5), wood, woodD, 2.2, 1.4);
  // 匾：金线代替字
  blob(c, rrect(88, 74, 44, 17, 2), '#2a1c18', null, 2.4);
  stroke(c, (k) => k.rect(90.5, 76.5, 39, 12), 1.1, '#e2b94a');
  stroke(c, (k) => { k.moveTo(96, 80.5); k.lineTo(124, 80.5); }, 1.5, '#f0c850');
  stroke(c, (k) => { k.moveTo(100, 84.5); k.lineTo(120, 84.5); }, 1.5, '#f0c850');
  // 下层瓦顶
  blob(c, poly(14, 90, 36, 68, 184, 68, 206, 90), ROOF, ROOF_D, 2.6, 2.4);
  for (let x = 34; x < 190; x += 10) stroke(c, (k) => { k.moveTo(x - (x - 110) * 0.05 - 2, 71); k.lineTo(x - (x - 110) * 0.14 - 2, 88); }, 1.1, 'rgba(10,10,16,0.7)');
  blob(c, rrect(12, 88, 196, 5, 1.5), '#3a3d48', ROOF_D, 2.2, 1);
  // 下层雪（只盖上半，露出黑瓦）
  blob(c, (k) => {
    k.moveTo(26, 79); k.lineTo(37, 70); k.lineTo(183, 70); k.lineTo(194, 79);
    k.quadraticCurveTo(180, 82, 170, 78); k.quadraticCurveTo(150, 81, 135, 77);
    k.quadraticCurveTo(110, 81, 90, 77); k.quadraticCurveTo(65, 81, 50, 77); k.quadraticCurveTo(38, 81, 26, 79);
  }, SNOW, SNOW_D, 1.8, 1.4);
// 上层
  blob(c, rrect(66, 40, 88, 30, 2), '#74808f', '#556070', 2.4, 2);
  blob(c, rrect(100, 48, 20, 16, 2), '#0c0b10', null, 2.2);
  stroke(c, (k) => { k.moveTo(110, 48); k.lineTo(110, 64); }, 1.2, wood);
  blob(c, poly(46, 44, 74, 14, 146, 14, 174, 44), ROOF, ROOF_D, 2.6, 2.4);
  for (let x = 62; x < 160; x += 10) stroke(c, (k) => { k.moveTo(x - (x - 110) * 0.03, 17); k.lineTo(x - (x - 110) * 0.1, 41); }, 1.1, 'rgba(10,10,16,0.7)');
  blob(c, rrect(44, 41, 132, 5, 1.5), '#3a3d48', ROOF_D, 2.2, 1);
  // 屋脊 + 翘角
  blob(c, rrect(64, 9, 92, 7, 2), '#3a3d48', ROOF_D, 2.2, 1.2);
  blob(c, poly(64, 12, 58, 4, 68, 9), '#3a3d48', null, 2);
  blob(c, poly(156, 12, 162, 4, 152, 9), '#3a3d48', null, 2);
  // 上层雪
  blob(c, (k) => {
    k.moveTo(62, 32); k.lineTo(77, 16); k.lineTo(143, 16); k.lineTo(158, 32);
    k.quadraticCurveTo(140, 36, 125, 31); k.quadraticCurveTo(105, 36, 90, 31); k.quadraticCurveTo(75, 35, 62, 32);
  }, SNOW, SNOW_D, 1.8, 1.4);
  dab(c, ellipse(110, 8.5, 38, 3.2), SNOW);
  stroke(c, (k) => { k.moveTo(72, 8); k.lineTo(148, 8); }, 1, SNOW_D);
  // 门口两盏白灯笼
  for (const x of [58, 162]) {
    stroke(c, (k) => { k.moveTo(x, 90); k.lineTo(x, 99); }, 1.8, INK);
    const g = c.createRadialGradient(x, 114, 3, x, 114, 22);
    g.addColorStop(0, 'rgba(255,220,150,0.5)');
    g.addColorStop(1, 'rgba(255,220,150,0)');
    c.fillStyle = g;
    c.fillRect(x - 24, 92, 48, 46);
    blob(c, ellipse(x, 113, 9, 12), '#f4efe2', '#cfc7b3', 2.2, 1.8);
    for (const dy of [-5, 0, 5]) stroke(c, (k) => { k.moveTo(x - 8.4 + Math.abs(dy) * 0.18, 113 + dy); k.lineTo(x + 8.4 - Math.abs(dy) * 0.18, 113 + dy); }, 0.7, 'rgba(120,110,90,0.5)');
    blob(c, rrect(x - 5, 99, 10, 3.5, 1), INK, null, 1);
    blob(c, rrect(x - 5, 124, 10, 3.5, 1), INK, null, 1);
    dab(c, circle(x, 113, 2.6), 'rgba(30,24,30,0.85)');
    stroke(c, (k) => { k.moveTo(x, 128); k.lineTo(x, 134); }, 1.4, '#d9cfa8');
  }
}

/** 白灯笼：短竿上挂一盏白纸灯笼，墨点，微暖光晕 */
function whiteLantern(c: Ctx): void {
  const g = c.createRadialGradient(13, 18, 3, 13, 18, 18);
  g.addColorStop(0, 'rgba(255,224,160,0.55)');
  g.addColorStop(1, 'rgba(255,224,160,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 26, 38);
  // 竿
  blob(c, rrect(11.5, 4, 3, 40, 1), '#5b4a3d', '#3d3029', 1.8, 0.8);
  blob(c, rrect(4, 2, 18, 3.5, 1.2), '#5b4a3d', null, 1.8);
  stroke(c, (k) => { k.moveTo(13, 5); k.lineTo(13, 9); }, 1.2, INK);
  blob(c, rrect(8, 8.5, 10, 3, 1), INK, null, 1);
  blob(c, ellipse(13, 19, 8, 9.5), '#f4efe2', '#cfc7b3', 2.2, 1.8);
  for (const dy of [-4, 0, 4]) stroke(c, (k) => { k.moveTo(6.4, 19 + dy); k.lineTo(19.6, 19 + dy); }, 0.6, 'rgba(120,110,90,0.5)');
  blob(c, rrect(8, 27.5, 10, 3, 1), INK, null, 1);
  dab(c, circle(13, 19, 2.4), 'rgba(30,24,30,0.85)');
  stroke(c, (k) => { k.moveTo(13, 30.5); k.lineTo(13, 35); }, 1.2, '#d9cfa8');
  dab(c, ellipse(10, 15, 1.6, 2.4, -0.4), '#ffffff', 0.7);
}

/** 稻草堆 + 草席 */
function straw(c: Ctx): void {
  // 草席：压扁的菱形，席纹
  blob(c, poly(4, 20, 28, 12, 52, 19, 30, 28), '#a98b55', '#7f6638', 2.2, 1.6);
  for (let i = 1; i < 5; i++) stroke(c, (k) => { k.moveTo(4 + i * 6.5, 20 - i * 1.6 + 1); k.lineTo(30 + i * 5, 28 - i * 1.8); }, 0.7, 'rgba(70,50,25,0.55)');
  // 稻草堆
  blob(c, (k) => {
    k.moveTo(24, 26); k.quadraticCurveTo(26, 8, 40, 5); k.quadraticCurveTo(54, 6, 58, 26);
    k.quadraticCurveTo(42, 29, 24, 26);
  }, '#d4b45e', '#a8883a', 2.4, 2.2);
  const rng = artRng(77);
  for (let i = 0; i < 12; i++) {
    const x = 28 + rng() * 26;
    const y = 10 + rng() * 14;
    const a = -0.9 + rng() * 1.8;
    stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x + Math.sin(a) * 6, y - Math.cos(a) * 6); }, 0.9, i % 3 ? '#f0d684' : '#9a7a30');
  }
  // 散草与薄雪
  for (const [x, y, a] of [[10, 25, 0.9], [18, 27, -0.5], [56, 24, 0.6], [49, 27, 1.1]] as const) {
    stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 2); }, 1, '#c9a84e');
  }
  dab(c, ellipse(37, 7.5, 7, 1.6, -0.1), SNOW, 0.9);
}

export const SPRITES6: SpriteDef[] = [
  { key: 'wall_h', w: 80, h: 60, ox: 0.5, oy: 1, draw: wallH },
  { key: 'wall_v', w: 36, h: 80, ox: 0.5, oy: 1, draw: wallV },
  { key: 'coffin', w: 76, h: 48, ox: 0.5, oy: 0.9, draw: coffin },
  { key: 'hall', w: 220, h: 170, ox: 0.5, oy: 1, draw: hall },
  { key: 'white_lantern', w: 26, h: 44, ox: 0.5, oy: 1, draw: whiteLantern },
  { key: 'straw', w: 60, h: 30, ox: 0.5, oy: 0.8, draw: straw },
];
