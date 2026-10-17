/**
 * 六个角色的对局精灵和头像（DESIGN.md 3.7）。小道士沿用 sprites.ts 的 `hero`，其余五个在这里画：
 * 配色、帽子 / 发型、手里拿的东西各不一样，缩到对局里的大小也一眼认得出是谁。
 * 单独一张小图集（buildHeroAtlas），不挤主图集的 2,048 上限；键名见 heroKey / faceKey。
 */
import type { CharacterId } from '../../content/meta.ts';
import type { SpriteDef } from './sprites.ts';
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

const SKIN = '#f7dcc3';
const SKIN_SH = '#e6b999';
const SHOE = '#2a2530';

/** 对局里主角的图名：小道士还是主图集里的 hero */
export const heroKey = (c: CharacterId): string => (c === 'xiaodao' ? 'hero' : `hero_${c}`);
/** HUD 头像框 / 角色卡头像的图名 */
export const faceKey = (c: CharacterId): string => (c === 'xiaodao' ? 'face' : `face_${c}`);

function feet(c: Ctx): void {
  blob(c, ellipse(23, 64, 5.5, 3.2), SHOE, null, 2);
  blob(c, ellipse(37, 64, 5.5, 3.2), SHOE, null, 2);
}

function robe(c: Ctx, fill: string, shade: string, hem: string, w = 0): void {
  blob(
    c,
    (k) => {
      k.moveTo(18 - w * 0.4, 37);
      k.quadraticCurveTo(15 - w, 52, 12 - w, 62);
      k.quadraticCurveTo(30, 67, 48 + w, 62);
      k.quadraticCurveTo(45 + w, 52, 42 + w * 0.4, 37);
    },
    fill,
    shade,
  );
  blob(
    c,
    (k) => {
      k.moveTo(13.2 - w, 58.5);
      k.quadraticCurveTo(30, 63, 46.8 + w, 58.5);
      k.lineTo(48 + w, 62);
      k.quadraticCurveTo(30, 67, 12 - w, 62);
    },
    hem,
    null,
    1.6,
  );
}

function sleeves(c: Ctx, fill: string, shade: string): void {
  blob(c, ellipse(15.5, 46, 5.5, 8, 0.35), fill, shade);
  blob(c, ellipse(44.5, 46, 5.5, 8, -0.35), fill, shade);
}

function head(c: Ctx, r = 17): void {
  blob(c, circle(30, 22, r), SKIN, SKIN_SH, 2.6, 3);
}

/** 眼睛 + 腮红 + 嘴；sharp = 剑侠那种细一点的眼，happy = 胖师叔的笑眼 */
function faceParts(c: Ctx, o: { sharp?: boolean; happy?: boolean; blush?: number } = {}): void {
  if (o.happy) {
    stroke(c, (k) => { k.moveTo(20.5, 25.5); k.quadraticCurveTo(23.5, 21.5, 26.5, 25.5); }, 1.8);
    stroke(c, (k) => { k.moveTo(33.5, 25.5); k.quadraticCurveTo(36.5, 21.5, 39.5, 25.5); }, 1.8);
  } else {
    const ry = o.sharp ? 2.7 : 3.6;
    blob(c, ellipse(23.5, 25, 2.7, ry), INK, null, 0);
    blob(c, ellipse(36.5, 25, 2.7, ry), INK, null, 0);
    dab(c, circle(24.4, 24, 1), '#ffffff');
    dab(c, circle(37.4, 24, 1), '#ffffff');
  }
  const b = o.blush ?? 0.75;
  dab(c, ellipse(19.5, 30.5, 3.2, 1.7), '#f08c8c', b);
  dab(c, ellipse(40.5, 30.5, 3.2, 1.7), '#f08c8c', b);
  if (o.happy) stroke(c, (k) => { k.moveTo(26, 30.5); k.quadraticCurveTo(30, 36, 34, 30.5); }, 1.5);
  else stroke(c, (k) => { k.moveTo(28, 31.5); k.quadraticCurveTo(30, 33.5, 32, 31.5); }, 1.4);
}

function hand(c: Ctx, x: number, y: number): void {
  blob(c, circle(x, y, 3.4), SKIN, null, 1.8);
}

// ───────────────────────── 符师：紫袍、高冠、黄符 ─────────────────────────

function talismanCard(c: Ctx, x: number, y: number, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  blob(c, rrect(-4, -9, 8, 18, 0.8), '#f2d14a', '#d8b232', 1.5, 1);
  stroke(c, (k) => { k.moveTo(-1.5, -5); k.lineTo(1.5, -5); k.moveTo(0, -5); k.lineTo(0, 5); k.moveTo(-1.5, 1); k.lineTo(1.5, 1); }, 1, '#c8402f');
  c.restore();
}

function fushi(c: Ctx): void {
  feet(c);
  robe(c, '#7a52b0', '#563a82', '#f2c94c');
  blob(c, poly(23.5, 37, 30, 46, 36.5, 37, 33.5, 37, 30, 42, 26.5, 37), '#f3efe6', null, 1.6);
  blob(c, rrect(18.5, 46, 23, 4, 1.5), '#f2c94c', null, 1.6);
  // 腰上挂两条黄符
  blob(c, rrect(21, 50, 5, 11, 0.8), '#f2d14a', '#d8b232', 1.4, 1);
  blob(c, rrect(34, 50, 5, 11, 0.8), '#f2d14a', '#d8b232', 1.4, 1);
  sleeves(c, '#7a52b0', '#563a82');
  hand(c, 13.5, 53);
  talismanCard(c, 49, 47, 0.3);
  hand(c, 46.5, 54);
  head(c);
  // 头发盖在脸两侧，上面一顶高冠
  blob(c, (k) => { k.moveTo(12.6, 25); k.quadraticCurveTo(11, 8, 30, 7); k.quadraticCurveTo(49, 8, 47.4, 25); k.quadraticCurveTo(45, 17, 40, 15.5); k.lineTo(20, 15.5); k.quadraticCurveTo(15, 17, 12.6, 25); }, '#2a2632', '#17141d', 2.6, 2);
  blob(c, (k) => { k.moveTo(19, 14); k.lineTo(21, -2); k.lineTo(39, -2); k.lineTo(41, 14); }, '#2f2840', '#1c1828', 2.4, 2);
  blob(c, rrect(18.5, 10, 23, 4.5, 1.5), '#f2c94c', null, 1.8);
  blob(c, circle(30, 3, 2.8), '#c8402f', null, 1.4);
  faceParts(c);
  // 细眉和一小撮山羊须
  stroke(c, (k) => { k.moveTo(20, 19.5); k.lineTo(26, 20.2); }, 1.4);
  stroke(c, (k) => { k.moveTo(40, 19.5); k.lineTo(34, 20.2); }, 1.4);
  blob(c, poly(27.5, 33.5, 32.5, 33.5, 30, 40), '#2a2632', null, 1.2);
}

// ───────────────────────── 剑侠：青黑劲装、红围巾、高马尾、背剑 ─────────────────────────

function jianxia(c: Ctx): void {
  // 背后的长剑：剑柄从右肩后探出来
  c.save();
  c.translate(40, 40);
  c.rotate(0.55);
  blob(c, rrect(-2.2, -34, 4.4, 36, 1.5), '#8b97a8', '#6b7788', 1.6, 1);
  blob(c, rrect(-5.5, -36, 11, 3.2, 1.2), '#c9a24a', null, 1.4);
  blob(c, rrect(-1.8, -45, 3.6, 9.5, 1.2), '#7a2e2a', null, 1.4);
  blob(c, circle(0, -46.5, 2.2), '#d0362e', null, 1.2);
  c.restore();
  // 高马尾（在头后面）
  blob(c, (k) => { k.moveTo(40, 8); k.quadraticCurveTo(58, 2, 55, 24); k.quadraticCurveTo(50, 14, 40, 14); }, '#2a2632', '#17141d', 2.2, 1.6);
  feet(c);
  robe(c, '#2f4f5e', '#1f3643', '#d8d2c0');
  // 腰封：宽白带，打结
  blob(c, rrect(17.5, 45, 25, 6, 2), '#e8e2d2', null, 1.6);
  blob(c, circle(36, 48, 3), '#d0362e', null, 1.4);
  blob(c, poly(36, 50, 39, 58, 35, 57), '#d0362e', null, 1.3);
  sleeves(c, '#2f4f5e', '#1f3643');
  // 护腕
  blob(c, rrect(10.5, 48, 6, 4, 1), '#d8d2c0', null, 1.3);
  hand(c, 13.5, 54);
  hand(c, 46.5, 54);
  // 红围巾
  blob(c, (k) => { k.moveTo(19, 37); k.quadraticCurveTo(30, 44, 41, 37); k.lineTo(40, 41.5); k.quadraticCurveTo(30, 48, 20, 41.5); }, '#d0362e', '#a32619', 1.8, 1.2);
  blob(c, poly(22, 41, 27, 44, 20, 54, 16, 51), '#d0362e', '#a32619', 1.6, 1);
  head(c);
  // 额前碎发 + 红发带
  blob(c, (k) => { k.moveTo(12.8, 24); k.quadraticCurveTo(11, 4.5, 30, 4.5); k.quadraticCurveTo(49, 4.5, 47.2, 24); k.quadraticCurveTo(45, 15, 38, 14); k.lineTo(34, 21); k.lineTo(29, 14.5); k.lineTo(24, 20); k.lineTo(21, 14.5); k.quadraticCurveTo(15, 16, 12.8, 24); }, '#2a2632', '#17141d', 2.6, 2);
  blob(c, rrect(12, 11, 36, 3.2, 1.4), '#d0362e', null, 1.5);
  blob(c, circle(41, 8, 2.4), '#d0362e', null, 1.2);
  faceParts(c, { sharp: true, blush: 0.35 });
  // 剑眉：上挑
  stroke(c, (k) => { k.moveTo(19.5, 21.5); k.lineTo(26.5, 19.5); }, 2);
  stroke(c, (k) => { k.moveTo(40.5, 21.5); k.lineTo(33.5, 19.5); }, 2);
}

// ───────────────────────── 胖师叔：橙黄僧道袍、圆滚滚、念珠、小铃 ─────────────────────────

function pang(c: Ctx): void {
  c.save();
  // 身子往两边胖一圈，头不动
  feet(c);
  blob(c, ellipse(19, 64, 6.5, 3.4), SHOE, null, 2);
  blob(c, ellipse(41, 64, 6.5, 3.4), SHOE, null, 2);
  robe(c, '#e48a2c', '#b8651a', '#8a3a2a', 8);
  // 大肚皮
  dab(c, ellipse(30, 55, 13, 9), '#f0a94a', 0.6);
  blob(c, rrect(15, 47, 30, 4, 1.5), '#8a3a2a', null, 1.6);
  blob(c, poly(22.5, 37, 30, 47, 37.5, 37, 34, 37, 30, 42, 26, 37), '#f3efe6', null, 1.6);
  // 一串念珠
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    blob(c, circle(19 + t * 22, 40 + 9 * (1 - (2 * t - 1) * (2 * t - 1)), 2), '#6b3a1c', null, 1.1);
  }
  blob(c, ellipse(12, 47, 6, 8, 0.3), '#e48a2c', '#b8651a');
  blob(c, ellipse(48, 47, 6, 8, -0.3), '#e48a2c', '#b8651a');
  hand(c, 9.5, 54);
  // 手里一只小铃铛
  blob(c, (k) => { k.moveTo(48, 61); k.quadraticCurveTo(49, 50, 55, 50); k.quadraticCurveTo(61, 50, 62, 61); }, '#e2b54a', '#b88a2a', 1.6, 1.2);
  blob(c, circle(55, 62.5, 1.8), '#7a4a20', null, 1);
  hand(c, 51, 56);
  c.restore();
  // 大圆脸、光头、一对大耳朵
  blob(c, ellipse(10.5, 24, 3.4, 5), SKIN, SKIN_SH, 1.8, 1);
  blob(c, ellipse(49.5, 24, 3.4, 5), SKIN, SKIN_SH, 1.8, 1);
  blob(c, ellipse(30, 22.5, 19.5, 17.5), SKIN, SKIN_SH, 2.6, 3);
  dab(c, ellipse(24, 8, 7, 2.2, -0.3), '#ffffff', 0.45);
  // 头顶一个小发髻
  blob(c, circle(30, 4.5, 4), '#2a2632', null, 2);
  faceParts(c, { happy: true, blush: 0.9 });
  stroke(c, (k) => { k.moveTo(20, 19); k.quadraticCurveTo(23, 17, 26, 19); }, 1.4);
  stroke(c, (k) => { k.moveTo(40, 19); k.quadraticCurveTo(37, 17, 34, 19); }, 1.4);
}

// ───────────────────────── 更夫：灰袄、毡帽、提铜锣和灯笼 ─────────────────────────

function gengfu(c: Ctx): void {
  feet(c);
  robe(c, '#626a7a', '#454c5a', '#3a3f4c');
  // 棉坎肩
  blob(c, (k) => { k.moveTo(19, 37); k.lineTo(26, 38); k.lineTo(26, 58); k.lineTo(17, 58); k.quadraticCurveTo(16, 46, 19, 37); }, '#8a5a3a', '#6a4028', 1.8, 1.4);
  blob(c, (k) => { k.moveTo(41, 37); k.lineTo(34, 38); k.lineTo(34, 58); k.lineTo(43, 58); k.quadraticCurveTo(44, 46, 41, 37); }, '#8a5a3a', '#6a4028', 1.8, 1.4);
  blob(c, rrect(18.5, 47, 23, 4, 1.5), '#c9a24a', null, 1.6);
  sleeves(c, '#626a7a', '#454c5a');
  // 左手提铜锣（挂在身侧）
  blob(c, circle(10, 55, 9.5), '#e2b54a', '#b88a2a', 2, 2);
  blob(c, circle(10, 55, 4), '#f4cd62', null, 1.4);
  stroke(c, (k) => { k.moveTo(10, 45.5); k.lineTo(14, 40); }, 1.4, '#7a4a20');
  hand(c, 15, 49);
  // 右手提着灯笼
  stroke(c, (k) => { k.moveTo(47, 50); k.lineTo(52, 40); }, 1.8, '#7a4a20');
  blob(c, ellipse(54, 31, 6.5, 8, 0), '#e8582f', '#b83a1c', 1.8, 1.4);
  blob(c, rrect(49.5, 22, 9, 3, 1), '#3a2a20', null, 1.3);
  blob(c, rrect(49.5, 37.5, 9, 3, 1), '#3a2a20', null, 1.3);
  dab(c, ellipse(54, 31, 3, 4.5), '#ffd979', 0.9);
  hand(c, 46.5, 53);
  head(c);
  // 毡帽：圆顶，帽沿卷起
  blob(c, (k) => { k.moveTo(12.5, 17); k.quadraticCurveTo(12, -1, 30, -1); k.quadraticCurveTo(48, -1, 47.5, 17); }, '#2f2c36', '#1c1a22', 2.6, 2);
  blob(c, rrect(10.5, 13, 39, 6.5, 3), '#3d3946', '#26232d', 2.2, 1.4);
  blob(c, circle(30, -1.5, 2.6), '#c8402f', null, 1.4);
  faceParts(c, { blush: 0.5 });
  // 困倦的眼皮 + 胡茬
  stroke(c, (k) => { k.moveTo(20.5, 22.5); k.lineTo(26.5, 22.5); }, 1.6);
  stroke(c, (k) => { k.moveTo(33.5, 22.5); k.lineTo(39.5, 22.5); }, 1.6);
  for (const [x, y] of [[24, 34], [28, 36], [32, 36], [36, 34]] as const) dab(c, circle(x, y, 0.8), '#5a4a42', 0.8);
}

// ───────────────────────── 采药女：青绿裙、双髻簪花、背药篓、握草药 ─────────────────────────

function caiyao(c: Ctx): void {
  // 药篓在背后：露出一圈篓口和草
  blob(c, rrect(36, 26, 22, 28, 4), '#b08a4a', '#8a6a32', 2, 2);
  for (let i = 0; i < 4; i++) stroke(c, (k) => { k.moveTo(38, 32 + i * 6); k.lineTo(56, 32 + i * 6); }, 0.9, '#6a4a22');
  blob(c, (k) => { k.moveTo(40, 27); k.quadraticCurveTo(38, 12, 44, 8); k.quadraticCurveTo(46, 18, 46, 27); }, '#58a868', '#3d7e4c', 1.6, 1.2);
  blob(c, (k) => { k.moveTo(47, 27); k.quadraticCurveTo(50, 10, 57, 11); k.quadraticCurveTo(54, 20, 52, 27); }, '#7cc07a', '#4f9a5a', 1.6, 1.2);
  blob(c, circle(44, 8.5, 2.2), '#f08cb0', null, 1.1);
  feet(c);
  robe(c, '#58a868', '#3d7e4c', '#f3efe6');
  // 白围裙
  blob(c, (k) => { k.moveTo(22, 44); k.lineTo(38, 44); k.lineTo(40, 61); k.quadraticCurveTo(30, 64, 20, 61); }, '#f6f2e8', '#dcd4c2', 1.6, 1.4);
  blob(c, rrect(18.5, 44, 23, 3.4, 1.4), '#d0362e', null, 1.5);
  blob(c, poly(23.5, 37, 30, 46, 36.5, 37, 33.5, 37, 30, 42, 26.5, 37), '#f3efe6', null, 1.6);
  // 篓带
  stroke(c, (k) => { k.moveTo(40, 38); k.lineTo(31, 52); }, 2, '#8a6a32');
  sleeves(c, '#58a868', '#3d7e4c');
  hand(c, 13.5, 54);
  // 右手一枝带花的草药
  stroke(c, (k) => { k.moveTo(46.5, 54); k.quadraticCurveTo(52, 44, 49, 34); }, 1.8, '#3d7e4c');
  blob(c, ellipse(52.5, 42, 3.4, 1.7, -0.6), '#7cc07a', '#4f9a5a', 1.3, 0.8);
  blob(c, ellipse(46, 39, 3.4, 1.7, 0.6), '#7cc07a', '#4f9a5a', 1.3, 0.8);
  blob(c, circle(49, 33, 3), '#f08cb0', null, 1.3);
  dab(c, circle(49, 33, 1), '#ffe08a');
  hand(c, 46.5, 54);
  // 头发：两个丸子髻 + 簪花
  blob(c, circle(15, 8, 6), '#2a2632', '#17141d', 2.2, 1.4);
  blob(c, circle(45, 8, 6), '#2a2632', '#17141d', 2.2, 1.4);
  head(c);
  blob(c, (k) => { k.moveTo(12.8, 24); k.quadraticCurveTo(11, 5, 30, 4.5); k.quadraticCurveTo(49, 5, 47.2, 24); k.quadraticCurveTo(45, 16, 40, 14.5); k.quadraticCurveTo(36, 18, 31, 14.5); k.quadraticCurveTo(26, 18, 21, 14.5); k.quadraticCurveTo(15, 16, 12.8, 24); }, '#2a2632', '#17141d', 2.6, 2);
  blob(c, circle(15, 8, 2.8), '#f08cb0', null, 1.2);
  blob(c, circle(45, 8, 2.8), '#f08cb0', null, 1.2);
  dab(c, circle(15, 8, 1), '#ffe08a');
  dab(c, circle(45, 8, 1), '#ffe08a');
  faceParts(c, { blush: 0.95 });
  stroke(c, (k) => { k.moveTo(20.5, 20); k.quadraticCurveTo(23.5, 18.4, 26.5, 20); }, 1.4);
  stroke(c, (k) => { k.moveTo(39.5, 20); k.quadraticCurveTo(36.5, 18.4, 33.5, 20); }, 1.4);
}

const DRAW: Partial<Record<CharacterId, (c: Ctx) => void>> = { fushi, jianxia, pang, gengfu, caiyao };

/** 头像框里用的版本：整身往下挪一点，露出头和上半身 */
const face = (draw: (c: Ctx) => void) => (c: Ctx): void => {
  c.save();
  c.translate(-5, 3);
  draw(c);
  c.restore();
};

export const HERO_SPRITES: SpriteDef[] = (Object.keys(DRAW) as CharacterId[]).flatMap((id) => [
  { key: heroKey(id), w: 66, h: 70, ox: 0.5, oy: 0.95, draw: (c: Ctx) => { c.translate(3, 0); DRAW[id]!(c); } },
  { key: faceKey(id), w: 50, h: 44, ox: 0.5, oy: 0.5, draw: face(DRAW[id]!) },
]);
