/**
 * 第九批精灵：夜探镇子的陈设（古镇的灯笼杆、井、水缸、牌坊；渡口的船、亭、芦苇；山寺的山门、香炉、经幢、古松）。
 * 都是不挡路的点缀（规则层的墙和房子是 sprites8 的）；位置由 view/game/town.ts 按地图种子确定性地摆。
 * 画法同 sprites8：粗墨边、平涂、一道阴影；灯笼亮的部分单独画高光，夜里再由暗幕上的光圈提亮。
 */
import type { SpriteDef } from './sprites.ts';
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

const SNOW = '#f6f9fd';
const RED = '#b8372b';
const RED_D = '#842419';

/** 红灯笼（以 x, y 为顶端挂点） */
function redLantern(c: Ctx, x: number, y: number, s = 1): void {
  stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x, y + 4 * s); }, 1.6);
  blob(c, rrect(x - 4 * s, y + 3 * s, 8 * s, 3 * s, 1), '#3a2a22', null, 1.4);
  blob(c, ellipse(x, y + 12 * s, 7.5 * s, 8.5 * s), '#e2452f', '#b8301f', 2, 1.4);
  dab(c, ellipse(x, y + 12 * s, 3 * s, 5.5 * s), '#ffd57a', 0.75);
  blob(c, rrect(x - 4 * s, y + 19 * s, 8 * s, 3 * s, 1), '#3a2a22', null, 1.4);
  stroke(c, (k) => { k.moveTo(x, y + 22 * s); k.lineTo(x, y + 27 * s); }, 1.4, '#e2b94a');
}

/** 灯笼杆（36 × 100，脚在底）：木杆挑出一臂，挂一盏红灯笼，杆脚一圈压雪的石墩 */
function lampPole(c: Ctx): void {
  blob(c, ellipse(18, 94, 13, 4.5), '#8e939d', '#686d78', 2, 1.2);
  dab(c, ellipse(18, 91.5, 9, 2), SNOW);
  blob(c, rrect(15, 16, 6, 78, 1.6), '#6a4a38', '#4a3328', 2.2, 1.4);
  blob(c, rrect(15, 14, 24, 5, 1.6), '#6a4a38', '#4a3328', 2, 1);
  stroke(c, (k) => { k.moveTo(18, 30); k.lineTo(30, 18); }, 2.2, '#4a3328');
  redLantern(c, 33, 18, 1.15);
  dab(c, ellipse(17, 14, 5, 1.6), SNOW);
}

/** 井（64 × 60）：石砌的井圈、木架和辘轳，井口盖一圈雪 */
function well(c: Ctx): void {
  blob(c, ellipse(32, 52, 28, 7), 'rgba(40,50,80,0.28)', null, 0);
  for (const x of [11, 50]) blob(c, rrect(x, 10, 4, 36, 1.2), '#6a4a38', '#4a3328', 2, 1);
  blob(c, rrect(8, 8, 48, 5, 1.6), '#6a4a38', '#4a3328', 2, 1);
  blob(c, poly(4, 11, 14, 1, 50, 1, 60, 11), '#4a4f5c', '#33373f', 2.2, 1.6);
  dab(c, poly(8, 8, 15, 3, 49, 3, 56, 8), SNOW, 0.95);
  stroke(c, (k) => { k.moveTo(32, 13); k.lineTo(32, 30); }, 1.4);
  blob(c, rrect(28, 28, 8, 7, 1.6), '#8a5c38', '#5e3b20', 1.8, 1);
  blob(c, (k) => { k.moveTo(6, 38); k.lineTo(58, 38); k.lineTo(55, 54); k.quadraticCurveTo(32, 60, 9, 54); }, '#8e939d', '#686d78', 2.4, 2.2);
  blob(c, ellipse(32, 38, 26, 6.5), '#171c2a', null, 2.2);
  dab(c, ellipse(32, 38.6, 20, 4), '#2f4a78');
  dab(c, ellipse(26, 37.4, 6, 1.2), '#8cc0e0', 0.7);
  stroke(c, (k) => { k.moveTo(12, 46); k.lineTo(52, 46); k.moveTo(24, 38); k.lineTo(22, 54); k.moveTo(42, 38); k.lineTo(44, 54); }, 1, 'rgba(23,19,28,0.45)');
  dab(c, ellipse(14, 37, 8, 2), SNOW);
  dab(c, ellipse(52, 37, 6, 2), SNOW);
}

/** 水缸（34 × 36）：粗陶缸，盖着木盖和雪 */
function vat(c: Ctx): void {
  blob(c, ellipse(17, 32, 14, 3.4), 'rgba(40,50,80,0.28)', null, 0);
  blob(c, (k) => { k.moveTo(5, 10); k.quadraticCurveTo(0, 22, 7, 30); k.lineTo(27, 30); k.quadraticCurveTo(34, 22, 29, 10); }, '#8a6a48', '#5e4630', 2.4, 2.2);
  blob(c, ellipse(17, 10, 12.5, 3.6), '#4a3a2c', null, 2);
  stroke(c, (k) => { k.moveTo(4, 17); k.quadraticCurveTo(17, 22, 30, 17); }, 1.2, 'rgba(23,19,28,0.5)');
  dab(c, ellipse(17, 9, 10, 2.6), SNOW);
  dab(c, ellipse(11, 20, 2, 4, 0.2), '#ffffff', 0.3);
}

/** 牌坊（240 × 170，脚在底）：两根朱红柱夹一道石碑坊，三层覆雪的小檐，正中匾额；柱距 196，正好跨一条街（街宽 220） */
function paifang(c: Ctx): void {
  for (const x of [28, 212]) {
    blob(c, rrect(x - 13, 142, 26, 12, 2), '#8e939d', '#686d78', 2.4, 1.4);
    blob(c, rrect(x - 8, 36, 16, 110, 2), RED, RED_D, 2.6, 2);
    dab(c, rrect(x - 5, 42, 3, 96, 1.2), '#ffffff', 0.18);
  }
  // 下横枋、上横枋
  blob(c, rrect(18, 72, 204, 12, 2), RED, RED_D, 2.4, 1.6);
  blob(c, rrect(18, 50, 204, 10, 2), RED, RED_D, 2.4, 1.6);
  for (let x = 40; x < 210; x += 22) dab(c, rrect(x, 74, 10, 6, 1.2), '#e2b94a', 0.9);
  // 正中匾额
  blob(c, rrect(92, 52, 56, 40, 3), '#2a1c18', null, 2.6);
  stroke(c, (k) => k.rect(95.5, 55.5, 49, 33), 1.2, '#e2b94a');
  stroke(c, (k) => { k.moveTo(104, 66); k.lineTo(136, 66); k.moveTo(108, 76); k.lineTo(132, 76); k.moveTo(120, 60); k.lineTo(120, 86); }, 1.8, '#f0c850');
  // 三层屋檐：中间高两边低
  const eave = (x0: number, x1: number, y: number, h: number): void => {
    blob(c, poly(x0 - 8, y + h, x0 + 4, y, x1 - 4, y, x1 + 8, y + h, x1, y + h + 4, x0, y + h + 4), '#3a3d48', '#262831', 2.4, 2);
    for (let x = x0 + 6; x < x1; x += 9) stroke(c, (k) => { k.moveTo(x, y + 2); k.lineTo(x, y + h); }, 1, 'rgba(10,10,16,0.55)');
    dab(c, poly(x0 + 2, y + 2, x0 + 8, y - 3, x1 - 8, y - 3, x1 - 2, y + 2, x1 - 16, y + 7, x0 + 16, y + 7), SNOW, 0.96);
  };
  eave(14, 58, 26, 14);
  eave(182, 226, 26, 14);
  eave(76, 164, 8, 18);
  blob(c, rrect(116, 0, 8, 12, 2), '#d4a93a', '#a98428', 2, 1);
  // 檐下挂的灯笼
  redLantern(c, 60, 62, 0.8);
  redLantern(c, 180, 62, 0.8);
}

/** 船（150 × 64，脚在水线）：乌篷船，船头翘起，篷顶压雪，船头一盏灯 */
function boat(c: Ctx): void {
  blob(c, ellipse(75, 52, 68, 8), 'rgba(20,40,70,0.35)', null, 0);
  blob(c, (k) => { k.moveTo(4, 36); k.quadraticCurveTo(10, 52, 36, 54); k.lineTo(116, 54); k.quadraticCurveTo(140, 52, 148, 30); k.quadraticCurveTo(140, 40, 128, 40); k.lineTo(14, 40); k.quadraticCurveTo(8, 40, 4, 36); }, '#7a5236', '#4e3320', 2.6, 2.4);
  stroke(c, (k) => { k.moveTo(14, 46); k.lineTo(130, 46); }, 1.2, 'rgba(23,19,28,0.4)');
  // 乌篷
  blob(c, (k) => { k.moveTo(36, 40); k.quadraticCurveTo(38, 14, 76, 12); k.quadraticCurveTo(114, 14, 116, 40); }, '#3a3d48', '#262831', 2.6, 2.2);
  for (let x = 50; x < 110; x += 12) stroke(c, (k) => { k.moveTo(x, 18); k.lineTo(x - 2, 40); }, 1, 'rgba(10,10,16,0.55)');
  dab(c, (k) => { k.moveTo(44, 26); k.quadraticCurveTo(52, 12, 76, 11); k.quadraticCurveTo(100, 12, 108, 26); k.quadraticCurveTo(76, 20, 44, 26); }, SNOW, 0.96);
  blob(c, rrect(66, 28, 20, 12, 2), '#171c2a', null, 1.8);
  dab(c, rrect(69, 30, 14, 8, 1), '#f6d58a', 0.85);
  // 船头灯 + 橹
  stroke(c, (k) => { k.moveTo(138, 36); k.lineTo(138, 20); }, 2.2, '#4a3328');
  redLantern(c, 138, 18, 0.7);
  stroke(c, (k) => { k.moveTo(24, 40); k.lineTo(6, 62); }, 3, '#4a3328');
}

/** 渡口亭（120 × 130，脚在底）：四柱歇山顶的小亭，一盏灯，檐下挂风铃 */
function pavilion(c: Ctx): void {
  blob(c, ellipse(60, 124, 50, 6), 'rgba(40,50,80,0.28)', null, 0);
  blob(c, rrect(10, 108, 100, 16, 2), '#8e939d', '#686d78', 2.4, 1.6);
  dab(c, ellipse(60, 108.5, 46, 2), SNOW);
  blob(c, rrect(16, 48, 88, 62, 2), '#1c2030', null, 2.2);
  dab(c, rrect(20, 52, 80, 54, 1), '#f2c870', 0.28);
  for (const x of [16, 52, 90]) blob(c, rrect(x, 46, 14, 64, 2), RED, RED_D, 2.4, 1.8);
  blob(c, rrect(14, 76, 92, 6, 1.6), '#6a4a38', '#4a3328', 2, 1);
  redLantern(c, 60, 52, 0.9);
  blob(c, poly(0, 46, 30, 12, 90, 12, 120, 46, 108, 50, 12, 50), '#3a3d48', '#262831', 2.6, 2.4);
  for (let x = 14; x < 110; x += 10) stroke(c, (k) => { k.moveTo(x, 16); k.lineTo(x - (x - 60) * 0.2, 46); }, 1.1, 'rgba(10,10,16,0.55)');
  blob(c, (k) => { k.moveTo(0, 46); k.quadraticCurveTo(-5, 46, -3, 38); k.quadraticCurveTo(2, 44, 8, 47); }, '#3a3d48', null, 2);
  blob(c, (k) => { k.moveTo(120, 46); k.quadraticCurveTo(125, 46, 123, 38); k.quadraticCurveTo(118, 44, 112, 47); }, '#3a3d48', null, 2);
  dab(c, poly(30, 14, 36, 8, 84, 8, 90, 14, 80, 24, 40, 24), SNOW, 0.96);
  blob(c, rrect(50, 2, 20, 10, 3), '#d4a93a', '#a98428', 2, 1);
}

/** 芦苇丛（48 × 64）：几十根枯黄的苇秆，顶着毛茸茸的穗，压着雪 */
function reeds(c: Ctx): void {
  const r = artRng(17);
  for (let i = 0; i < 11; i++) {
    const x = 6 + r() * 36;
    const h = 34 + r() * 24;
    const lean = (r() - 0.5) * 14;
    stroke(c, (k) => { k.moveTo(x, 62); k.quadraticCurveTo(x + lean * 0.2, 62 - h * 0.6, x + lean, 62 - h); }, 3.6, INK);
    stroke(c, (k) => { k.moveTo(x, 62); k.quadraticCurveTo(x + lean * 0.2, 62 - h * 0.6, x + lean, 62 - h); }, 1.8, '#c8a85a');
    blob(c, ellipse(x + lean, 62 - h - 4, 2.8, 7, lean * 0.03), '#d9c690', '#a88f56', 1.8, 0.8);
    dab(c, ellipse(x + lean - 0.8, 62 - h - 6, 1, 3), '#ffffff', 0.7);
  }
  dab(c, ellipse(24, 61, 20, 2.4), SNOW);
}

/** 香炉（56 × 70）：三足铜炉，两耳，炉口一缕青烟，炉脚堆雪 */
function burner(c: Ctx): void {
  blob(c, ellipse(28, 64, 24, 5), 'rgba(40,50,80,0.28)', null, 0);
  stroke(c, (k) => { k.moveTo(28, 14); k.quadraticCurveTo(20, 8, 28, 2); k.quadraticCurveTo(34, -2, 30, -6); }, 1.8, 'rgba(120,130,150,0.8)');
  for (const x of [14, 38]) blob(c, rrect(x, 46, 6, 16, 2), '#6a5230', '#4a3820', 2, 1);
  blob(c, rrect(24, 50, 8, 12, 2), '#6a5230', '#4a3820', 2, 1);
  stroke(c, (k) => { k.arc(7, 30, 6, Math.PI * 0.5, Math.PI * 1.5); k.moveTo(49, 24); k.arc(49, 30, 6, -Math.PI * 0.5, Math.PI * 0.5); }, 4, INK);
  stroke(c, (k) => { k.arc(7, 30, 6, Math.PI * 0.5, Math.PI * 1.5); k.moveTo(49, 24); k.arc(49, 30, 6, -Math.PI * 0.5, Math.PI * 0.5); }, 1.8, '#b8923a');
  blob(c, (k) => { k.moveTo(6, 22); k.lineTo(50, 22); k.quadraticCurveTo(52, 44, 28, 50); k.quadraticCurveTo(4, 44, 6, 22); }, '#b8923a', '#7e621f', 2.6, 2.2);
  blob(c, ellipse(28, 22, 22, 5), '#3a2a18', null, 2.2);
  dab(c, ellipse(28, 21, 16, 3), '#ff9a3a', 0.9);
  for (const x of [20, 28, 36]) stroke(c, (k) => { k.moveTo(x, 20); k.lineTo(x + 1, 12); }, 1.8, '#9c2f26');
  dab(c, rrect(16, 32, 24, 3, 1), '#e8c860', 0.8);
  dab(c, ellipse(14, 28, 3, 1.6, -0.5), '#ffffff', 0.5);
}

/** 经幢（36 × 100）：八角石柱，刻着经文，顶上宝盖和莲花座，覆雪 */
function jingchuang(c: Ctx): void {
  blob(c, ellipse(18, 94, 15, 4, 0), 'rgba(40,50,80,0.28)', null, 0);
  blob(c, rrect(4, 82, 28, 12, 2), '#9aa3b2', '#6e7888', 2.4, 1.6);
  blob(c, rrect(8, 70, 20, 14, 2), '#aab3c2', '#7d8797', 2.2, 1.4);
  blob(c, rrect(10, 34, 16, 38, 1.6), '#b4bdca', '#848e9e', 2.4, 1.8);
  for (let y = 40; y < 70; y += 6) stroke(c, (k) => { k.moveTo(14, y); k.lineTo(22, y); }, 1.1, 'rgba(23,19,28,0.5)');
  blob(c, rrect(6, 26, 24, 9, 2), '#9aa3b2', '#6e7888', 2.2, 1.4);
  blob(c, poly(2, 28, 10, 14, 26, 14, 34, 28), '#8b95a3', '#626c7a', 2.4, 1.6);
  dab(c, poly(5, 26, 11, 16, 25, 16, 31, 26, 18, 22), SNOW, 0.96);
  blob(c, circle(18, 9, 5.5), '#b8923a', '#7e621f', 2, 1);
  dab(c, ellipse(18, 4, 4, 1.6), SNOW, 0.95);
}

/** 古松（110 × 172，脚在底）：虬曲的主干，三四层覆雪的松针团；比守夜的枯树高、绿 */
function pine(c: Ctx): void {
  blob(c, ellipse(55, 164, 30, 6), 'rgba(40,50,80,0.3)', null, 0);
  blob(c, (k) => { k.moveTo(46, 166); k.quadraticCurveTo(48, 130, 44, 100); k.quadraticCurveTo(50, 70, 52, 40); k.lineTo(62, 40); k.quadraticCurveTo(60, 76, 58, 104); k.quadraticCurveTo(66, 134, 66, 166); }, '#5b4636', '#3d2f24', 2.6, 2.2);
  stroke(c, (k) => { k.moveTo(50, 150); k.lineTo(50, 112); k.moveTo(56, 130); k.lineTo(56, 80); }, 1.1, 'rgba(23,19,28,0.4)');
  const tier = (cx: number, cy: number, w: number, h: number): void => {
    blob(c, (k) => { k.moveTo(cx - w, cy + h * 0.4); k.quadraticCurveTo(cx - w * 0.9, cy - h * 0.1, cx - w * 0.3, cy - h * 0.5); k.quadraticCurveTo(cx, cy - h * 0.8, cx + w * 0.3, cy - h * 0.5); k.quadraticCurveTo(cx + w * 0.9, cy - h * 0.1, cx + w, cy + h * 0.4); k.quadraticCurveTo(cx, cy + h * 0.7, cx - w, cy + h * 0.4); }, '#2f5a46', '#1e3d2e', 2.6, 2.4);
    for (let i = -2; i <= 2; i++) stroke(c, (k) => { k.moveTo(cx + i * w * 0.34, cy + h * 0.45); k.lineTo(cx + i * w * 0.26, cy + h * 0.1); }, 1.1, 'rgba(10,30,20,0.55)');
    dab(c, (k) => { k.moveTo(cx - w * 0.8, cy + h * 0.1); k.quadraticCurveTo(cx - w * 0.6, cy - h * 0.2, cx - w * 0.2, cy - h * 0.46); k.quadraticCurveTo(cx, cy - h * 0.7, cx + w * 0.2, cy - h * 0.46); k.quadraticCurveTo(cx + w * 0.7, cy - h * 0.2, cx + w * 0.85, cy + h * 0.12); k.quadraticCurveTo(cx + w * 0.3, cy - h * 0.1, cx, cy - h * 0.12); k.quadraticCurveTo(cx - w * 0.3, cy - h * 0.1, cx - w * 0.8, cy + h * 0.1); }, SNOW, 0.96);
  };
  tier(55, 104, 46, 40);
  tier(50, 74, 38, 34);
  tier(58, 46, 32, 30);
  tier(54, 22, 22, 24);
}

/** 山门（170 × 150，脚在底）：红墙灰瓦的门楼，立在台阶缺口上；两根门柱净距 110（缺口宽 110） */
function shanmen(c: Ctx): void {
  blob(c, ellipse(85, 144, 76, 6), 'rgba(40,50,80,0.28)', null, 0);
  // 门洞里黑
  blob(c, rrect(28, 70, 114, 74, 2), '#14111a', null, 2.4);
  for (const x of [14, 144]) {
    blob(c, rrect(x - 4, 134, 24, 10, 2), '#8e939d', '#686d78', 2.2, 1.2);
    blob(c, rrect(x, 62, 18, 76, 2), RED, RED_D, 2.6, 2);
    dab(c, rrect(x + 3, 68, 3, 64, 1.2), '#ffffff', 0.18);
  }
  blob(c, rrect(10, 56, 150, 14, 2), RED, RED_D, 2.6, 1.8);
  blob(c, rrect(62, 36, 46, 22, 2), '#2a1c18', null, 2.4);
  stroke(c, (k) => k.rect(64.5, 38.5, 41, 17), 1, '#e2b94a');
  stroke(c, (k) => { k.moveTo(72, 44); k.lineTo(98, 44); k.moveTo(76, 51); k.lineTo(94, 51); }, 1.6, '#f0c850');
  // 檐
  blob(c, poly(0, 40, 20, 14, 150, 14, 170, 40, 158, 46, 12, 46), '#3a3d48', '#262831', 2.6, 2.4);
  for (let x = 16; x < 156; x += 10) stroke(c, (k) => { k.moveTo(x, 18); k.lineTo(x - (x - 85) * 0.1, 44); }, 1.1, 'rgba(10,10,16,0.55)');
  blob(c, (k) => { k.moveTo(0, 40); k.quadraticCurveTo(-6, 40, -4, 30); k.quadraticCurveTo(2, 38, 10, 42); }, '#3a3d48', null, 2);
  blob(c, (k) => { k.moveTo(170, 40); k.quadraticCurveTo(176, 40, 174, 30); k.quadraticCurveTo(168, 38, 160, 42); }, '#3a3d48', null, 2);
  dab(c, poly(18, 16, 28, 11, 142, 11, 152, 16, 140, 26, 30, 26), SNOW, 0.96);
  blob(c, rrect(70, 4, 30, 12, 3), '#d4a93a', '#a98428', 2, 1);
  redLantern(c, 30, 64, 0.8);
  redLantern(c, 140, 64, 0.8);
}

export const SPRITES9: SpriteDef[] = [
  { key: 'lamp_pole', w: 48, h: 100, ox: 0.375, oy: 0.96, draw: lampPole },
  { key: 'well', w: 64, h: 62, ox: 0.5, oy: 0.9, draw: well },
  { key: 'vat', w: 34, h: 36, ox: 0.5, oy: 0.9, draw: vat },
  { key: 'paifang', w: 240, h: 170, ox: 0.5, oy: 0.92, draw: paifang },
  { key: 'boat', w: 150, h: 66, ox: 0.5, oy: 0.8, draw: boat },
  { key: 'pavilion', w: 124, h: 132, ox: 0.5, oy: 0.94, draw: pavilion },
  { key: 'reeds', w: 48, h: 66, ox: 0.5, oy: 0.95, draw: reeds },
  { key: 'burner', w: 56, h: 70, ox: 0.5, oy: 0.92, draw: burner },
  { key: 'jingchuang', w: 36, h: 100, ox: 0.5, oy: 0.94, draw: jingchuang },
  { key: 'pine', w: 110, h: 172, ox: 0.5, oy: 0.96, draw: pine },
  { key: 'shanmen', w: 172, h: 150, ox: 0.5, oy: 0.95, draw: shanmen },
];
