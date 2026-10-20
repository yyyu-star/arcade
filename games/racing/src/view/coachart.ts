/**
 * 新手教程的教练阿驰的头像（DESIGN.md 8.1）：程序画的 SVG，和地图板同一套规矩（mapkit.ts 的色板、三档墨线、平涂）。
 * 形象：红色的老式半盔、推到额头上的铜框风镜、一副八字胡、大鼻头，脖子上一条金色围巾；圆形的徽章框（金圈加墨线）。
 *
 * 手机上头像只有 36–44 像素（viewBox 64，缩到六成多），所以分两层：
 * - 一眼就要看见的：红盔、两只风镜、肤色的脸、深色的胡子、眼睛和嘴的形状——表情只靠这几样变，都画得大、墨线用主体那一档；
 * - 放大才看得出的：盔上的白条、镜片的反光、腮红、围巾的褶——用装饰那一档的细线，缩小了糊掉也不影响认人。
 */
import { C, LW } from './mapkit.ts';

/** 平时讲解、得意大笑、哎哟（打滑、熄火） */
export type Mood = 'talk' | 'grin' | 'oops';

const SKIN = '#ecb98f';
const SKIN_DARK = '#d9946a';
const HAIR = '#5a4334';
const HAIR_GREY = '#9a8b7c';
const MOUTH = '#7a2a22';
const TONGUE = '#e0705a';
const SUIT = '#2f4a3c';
const SKY = '#cfe6ea';
const RED_DARK = '#9c2f22';

const M = LW.major;
const N = LW.minor;
const D = LW.decor;
const ink = `stroke="${C.ink}" stroke-linejoin="round" stroke-linecap="round"`;

/** 不随表情变的部分：底、肩膀和围巾、盔、脸、鼻子、风镜 */
const BASE = [
  // 肩膀：深绿的赛车服，金色围巾在脖子上打个结，一角往右飘
  `<path d="M3 64C5 53 17 49 32 49.5C47 49 59 53 61 64Z" fill="${SUIT}" ${ink} stroke-width="${N}"/>`,
  `<path d="M22 50.5C27 54.5 37 54.5 42 50.5L40.5 56C36 58.5 28 58.5 23.5 56Z" fill="${C.gold}" ${ink} stroke-width="${N}"/>`,
  `<path d="M38 55.5C44 57 50 55.5 55 51.5C53 57.5 47 61 39.5 60Z" fill="${C.gold}" ${ink} stroke-width="${N}"/>`,
  `<path d="M41 57.8C45 58.2 48.5 57 51.5 55" fill="none" ${ink} stroke-width="${D}"/>`,
  // 半盔：整块红，脸从中间的开口露出来
  `<path d="M12.5 46C8.5 28 15 8 32 7.5C49 8 55.5 28 51.5 46C47 50 17 50 12.5 46Z" fill="${C.red}" ${ink} stroke-width="${M}"/>`,
  `<path d="M29.2 7.8C29 12 29.2 16 29.6 20H34.4C34.8 16 35 12 34.8 7.8" fill="${C.paper}" ${ink} stroke-width="${D}"/>`,
  `<path d="M14.5 40C13 31 14.5 22 18.5 16" fill="none" stroke="${RED_DARK}" stroke-width="${N}" stroke-linecap="round"/>`,
  // 盔沿的软垫（米色一圈）和脸
  `<ellipse cx="32" cy="36.5" rx="15.2" ry="16.6" fill="${C.paper}" ${ink} stroke-width="${N}"/>`,
  `<ellipse cx="32" cy="37" rx="12.8" ry="14.6" fill="${SKIN}" ${ink} stroke-width="${N}"/>`,
  // 腮红（放大才看得出）
  `<ellipse cx="23" cy="40" rx="3" ry="1.8" fill="${C.red}" opacity=".22"/><ellipse cx="41" cy="40" rx="3" ry="1.8" fill="${C.red}" opacity=".22"/>`,
].join('');

/** 风镜推在额头上：两只铜框圆镜、一条带子（这是阿驰的招牌，缩小了也认得出两个圆） */
const GOGGLES = [
  `<path d="M13 23Q32 13 51 23" fill="none" stroke="${C.ink}" stroke-width="3.6" stroke-linecap="round"/>`,
  `<path d="M13 23Q32 13 51 23" fill="none" stroke="#6b5440" stroke-width="2" stroke-linecap="round"/>`,
  `<rect x="29.6" y="18" width="4.8" height="2.6" rx="1" fill="${C.gold}" ${ink} stroke-width="${D}"/>`,
  ...[24.5, 39.5].map(
    (x) =>
      `<circle cx="${x}" cy="19.5" r="6" fill="${C.gold}" ${ink} stroke-width="${M}"/>` +
      `<circle cx="${x}" cy="19.5" r="3.7" fill="${C.water}" ${ink} stroke-width="${D}"/>` +
      `<path d="M${x - 2.2} 18.3A2.5 2.5 0 0 1 ${x - 0.4} 16.6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`,
  ),
].join('');

const NOSE = `<path d="M29 37.5C28.5 33.5 30 31.5 32 31.5C34 31.5 35.5 33.5 35 37.5C34.2 39.2 29.8 39.2 29 37.5Z" fill="${SKIN_DARK}" ${ink} stroke-width="${N}"/>`;

/** 八字胡：tip 是两头往上翘（负）还是往下耷拉（正） */
function mustache(tip: number): string {
  const y = 40 + tip;
  return (
    `<path d="M32 39C28.5 37.2 24 37.6 21 40.2C18.6 42.2 16 ${y} 14.8 ${y - 2.4}C16.2 ${y + 2.6} 21 ${45.5 + tip / 2} 25.5 44.6C28.5 44 30.6 42.8 32 42.2` +
    `C33.4 42.8 35.5 44 38.5 44.6C43 ${45.5 + tip / 2} 47.8 ${y + 2.6} 49.2 ${y - 2.4}C48 ${y} 45.4 42.2 43 40.2C40 37.6 35.5 37.2 32 39Z" fill="${HAIR}" ${ink} stroke-width="${N}"/>` +
    // 胡子里一缕花白（放大才看得出）
    `<path d="M24 41C26.5 40 28.6 40.2 30.4 41" fill="none" stroke="${HAIR_GREY}" stroke-width="${D}" stroke-linecap="round"/>` +
    `<path d="M40 41C37.5 40 35.4 40.2 33.6 41" fill="none" stroke="${HAIR_GREY}" stroke-width="${D}" stroke-linecap="round"/>`
  );
}

const brow = (d: string): string => `<path d="${d}" fill="none" stroke="${HAIR}" stroke-width="2.6" stroke-linecap="round"/>`;

const FACES: Record<Mood, string> = {
  // 平时：睁着眼、左眉挑起来（有点得意），胡子底下露一点笑
  talk: [
    brow('M22.5 27.2Q25.5 24.6 28.6 26.4'),
    brow('M35.6 27Q38.6 26 41.6 27.4'),
    `<ellipse cx="25.8" cy="31" rx="1.9" ry="2.4" fill="${C.ink}"/><ellipse cx="38.2" cy="31" rx="1.9" ry="2.4" fill="${C.ink}"/>`,
    `<circle cx="26.4" cy="30.2" r=".7" fill="#fff"/><circle cx="38.8" cy="30.2" r=".7" fill="#fff"/>`,
    `<path d="M28 44.6Q32 49.6 36 44.6Z" fill="${MOUTH}" ${ink} stroke-width="${N}"/>`,
    NOSE,
    mustache(-1.5),
  ].join(''),
  // 得意大笑：眯成两道弯、眉毛扬起来、张大嘴（露牙和舌头），胡子两头翘上天
  grin: [
    brow('M22 25.6Q25.4 22.8 28.8 24.8'),
    brow('M35.2 24.8Q38.6 22.8 42 25.6'),
    `<path d="M23 31.6Q25.8 28 28.6 31.6" fill="none" ${ink} stroke-width="2.2"/><path d="M35.4 31.6Q38.2 28 41 31.6" fill="none" ${ink} stroke-width="2.2"/>`,
    `<path d="M25.6 44Q32 44.8 38.4 44Q37.6 52.4 32 52.6Q26.4 52.4 25.6 44Z" fill="${MOUTH}" ${ink} stroke-width="${N}"/>`,
    `<path d="M27 50.4Q32 47.6 37 50.4Q34.8 52.4 32 52.4Q29.2 52.4 27 50.4Z" fill="${TONGUE}"/>`,
    `<path d="M26.2 44.2Q32 45.2 37.8 44.2L37.4 46.2Q32 47 26.6 46.2Z" fill="#fff" ${ink} stroke-width="${D}"/>`,
    NOSE,
    mustache(-4),
  ].join(''),
  // 哎哟：眼睛瞪圆、眉头皱成八字、嘴撇成一道波浪，胡子耷拉，盔边一滴汗
  oops: [
    brow('M22.5 25.8Q25.6 26 28.6 27.6'),
    brow('M35.4 27.6Q38.4 26 41.5 25.8'),
    `<circle cx="25.8" cy="31.2" r="3" fill="#fff" ${ink} stroke-width="${N}"/><circle cx="38.2" cy="31.2" r="3" fill="#fff" ${ink} stroke-width="${N}"/>`,
    `<circle cx="25.8" cy="31.6" r="1.3" fill="${C.ink}"/><circle cx="38.2" cy="31.6" r="1.3" fill="${C.ink}"/>`,
    `<path d="M27.2 47.4Q29 45.2 30.6 47Q32 48.6 33.4 47Q35 45.2 36.8 47.4" fill="none" ${ink} stroke-width="${N}"/>`,
    NOSE,
    mustache(2.5),
    `<path d="M50.5 24C48.4 27.6 47.6 29.4 47.6 30.8A2.9 2.9 0 0 0 53.4 30.8C53.4 29.4 52.6 27.6 50.5 24Z" fill="${C.water}" ${ink} stroke-width="${N}"/>`,
  ].join(''),
};

const cache = new Map<Mood, string>();

/** 阿驰的头像（整个 SVG 字符串；每种表情只拼一次）。clip 的 id 带表情名，同一页里几张头像不打架 */
export function coachFaceSvg(mood: Mood): string {
  let s = cache.get(mood);
  if (!s) {
    const id = `rc-coach-${mood}`;
    s =
      `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="32" cy="32" r="29"/></clipPath></defs>` +
      // 人整个放大一成（以脸为中心）：手机上脸多占几个像素，盔顶和肩膀被圆框裁掉一点没关系
      `<g clip-path="url(#${id})"><circle cx="32" cy="32" r="29" fill="${SKY}"/><g transform="translate(32 37) scale(1.1) translate(-32 -37)">${BASE}${GOGGLES}${FACES[mood]}</g></g>` +
      // 徽章框：金圈，里外两道墨线
      `<circle cx="32" cy="32" r="29.6" fill="none" stroke="${C.gold}" stroke-width="3"/>` +
      `<circle cx="32" cy="32" r="31.1" fill="none" stroke="${C.ink}" stroke-width="${N}"/>` +
      `<circle cx="32" cy="32" r="28.1" fill="none" stroke="${C.ink}" stroke-width="${D}"/></svg>`;
    cache.set(mood, s);
  }
  return s;
}
