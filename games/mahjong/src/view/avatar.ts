/**
 * 头像：全程序生成的 SVG（素材来源见 ASSETS.md）。
 * 电脑六个性格各一张手绘风格的插画，金边；真人按名字哈希挑渐变底和花纹，中间写首字，白边。
 * 两边一眼分得清：电脑是画、真人是字，边框颜色也不同。
 */

/** 真人底色：每组 [亮, 暗]，径向渐变从左上亮到右下暗，看着像个鼓起来的小球；不用绿和青，免得融进绿呢牌桌 */
const HUES: readonly (readonly [string, string])[] = [
  ['#f4a68c', '#c4553a'],
  ['#8cc4f4', '#2f6fb8'],
  ['#a9b8f0', '#4257a8'],
  ['#f6d58e', '#c08a2a'],
  ['#d3b0e6', '#7a4a9e'],
  ['#f4b8c4', '#b9506a'],
  ['#ffc29a', '#d9702e'],
  ['#e8c39e', '#9a6a3c'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h;
}

/**
 * 同一页上同时有好几张头像（牌桌四家、房间里的座位），SVG 的 id 是整页共享的：
 * 写死的 id 会互相串，藏起来（display:none）的那张还会让别的头像的渐变失效。每次生成换一个前缀。
 */
let seq = 0;

const lg = (id: string, a: string, b: string, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

/** 外壳：圆底 + 裁剪 + 边框；画放在裁剪里，身子、锅这些到圆边自然截掉 */
function frame(p: string, bg: readonly [string, string], defs: string, body: string, ring: string): string {
  return (
    `<svg viewBox="0 0 64 64" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs>` +
    `<radialGradient id="${p}g" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>` +
    `<clipPath id="${p}c"><circle cx="32" cy="32" r="29"/></clipPath>${defs}</defs>` +
    `<circle cx="32" cy="32" r="29" fill="url(#${p}g)"/><g clip-path="url(#${p}c)">${body}</g>${ring}</svg>`
  );
}

// 电脑的金边外面再压一圈深色细线，在绿呢和深色面板上都不糊
const BOT_RING =
  '<circle cx="32" cy="32" r="30" fill="none" stroke="#3a2a10" stroke-width="1"/><circle cx="32" cy="32" r="29.2" fill="none" stroke="#f3c86b" stroke-width="2.6"/>';
const HUMAN_RING = '<circle cx="32" cy="32" r="29.5" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="2.2"/>';

// 共用的笔画：线条统一圆头，像手画的
const INK = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
const blush = (x1: number, x2: number, y: number) =>
  `<ellipse cx="${x1}" cy="${y}" rx="3" ry="1.8" fill="#ff7b7b" opacity=".55"/><ellipse cx="${x2}" cy="${y}" rx="3" ry="1.8" fill="#ff7b7b" opacity=".55"/>`;

type Art = (p: string) => string;

/** 幺妹儿：麻利的川妹子，双丫髻扎红绳、笑眯眼、红褂子 */
const yaomei: Art = (p) =>
  frame(
    p,
    ['#ffe0c4', '#ee7d5e'],
    lg(`${p}s`, '#ffeadb', '#f3c09c'),
    `<path d="M9 64q2-14 23-14t23 14z" fill="#d93a3a"/><path d="M25 50l7 6 7-6" ${INK} stroke="#fff" stroke-width="2.2"/>` +
      `<circle cx="18" cy="17" r="7" fill="#2a1a14"/><circle cx="46" cy="17" r="7" fill="#2a1a14"/>` +
      `<circle cx="22.5" cy="22" r="2.6" fill="#e63946"/><circle cx="41.5" cy="22" r="2.6" fill="#e63946"/>` +
      `<circle cx="32" cy="32" r="16" fill="#2a1a14"/><ellipse cx="32" cy="36" rx="13" ry="13.5" fill="url(#${p}s)"/>` +
      `<path d="M19 33q0-15 13-15t13 15q-4-6-9-7l-2 4-3-4q-7 1-12 7z" fill="#2a1a14"/>` +
      `<path d="M15 14q2-3 5-3M43 12q3-1 5 1M26 21q3-2 7-2" ${INK} stroke="#fff" stroke-opacity=".35" stroke-width="1.6"/>` +
      `<path d="M23.5 37q2.5-3 5 0M35.5 37q2.5-3 5 0" ${INK} stroke="#2a1a14" stroke-width="2"/>` +
      blush(23, 41, 41.5) +
      `<path d="M28.5 43q3.5 3.5 7 0z" fill="#c0392b" stroke="#a52a2a" stroke-width="1" stroke-linejoin="round"/>`,
    BOT_RING,
  );

/** 熊猫哥：贪吃的熊猫，嘴边叼着一枝竹子 */
const panda: Art = (p) =>
  frame(
    p,
    ['#e2f5c8', '#5f9f4c'],
    lg(`${p}w`, '#ffffff', '#d5dbe0'),
    `<circle cx="15.5" cy="18" r="7.5" fill="#1d1d22"/><circle cx="48.5" cy="18" r="7.5" fill="#1d1d22"/>` +
      `<path d="M7 64q4-16 25-16t25 16z" fill="#1d1d22"/><ellipse cx="32" cy="63" rx="12" ry="8" fill="#eef0f2"/>` +
      `<ellipse cx="32" cy="34" rx="19.5" ry="17" fill="url(#${p}w)"/>` +
      `<ellipse cx="24" cy="33" rx="5" ry="6.6" transform="rotate(28 24 33)" fill="#1d1d22"/><ellipse cx="40" cy="33" rx="5" ry="6.6" transform="rotate(-28 40 33)" fill="#1d1d22"/>` +
      `<circle cx="25" cy="32" r="2" fill="#fff"/><circle cx="39" cy="32" r="2" fill="#fff"/>` +
      `<ellipse cx="32" cy="40" rx="3.2" ry="2.1" fill="#1d1d22"/><path d="M28.5 43q3.5 3 7 0" ${INK} stroke="#1d1d22" stroke-width="1.6"/>` +
      `<path d="M36 44l15 7" ${INK} stroke="#3f8a33" stroke-width="2.6"/><path d="M45 48l1.5-1M41 46l1.5-1" ${INK} stroke="#2d6a25" stroke-width="1.4"/>` +
      `<path d="M50 50q4-9 11-8-3 8-11 8zM49 51q8-3 12 2-7 3-12-2z" fill="#6cc04a"/>` +
      `<path d="M20 22q5-4 11-4" ${INK} stroke="#fff" stroke-width="2"/>`,
    BOT_RING,
  );

/** 盖碗儿：一盏盖碗茶，青花带子、闭眼微笑，稳 */
const gaiwan: Art = (p) =>
  frame(
    p,
    ['#dff3ee', '#4a9488'],
    lg(`${p}q`, '#ffffff', '#c3d5e2', 1, 0),
    `<path d="M26 16q-3-4 0-7.5M33 15q-3-4 0-7.5M40 16q-3-4 0-7.5" ${INK} stroke="#fff" stroke-opacity=".75" stroke-width="2"/>` +
      `<ellipse cx="32" cy="54" rx="24" ry="6.5" fill="url(#${p}q)" stroke="#8fa8ba" stroke-width="1"/>` +
      `<path d="M12 34h40q-2 18-20 18t-20-18z" fill="url(#${p}q)" stroke="#8fa8ba" stroke-width="1"/>` +
      `<path d="M14 38.5h36" stroke="#2f5d9a" stroke-width="2"/><path d="M17 41h30" stroke="#2f5d9a" stroke-width=".8"/>` +
      `<path d="M14 34q2-12 18-12t18 12z" fill="url(#${p}q)" stroke="#8fa8ba" stroke-width="1"/>` +
      `<path d="M20 30q3-4 8-5" ${INK} stroke="#2f5d9a" stroke-width="1.2"/><circle cx="40" cy="28" r="1.4" fill="#2f5d9a"/><circle cx="44" cy="30.5" r="1" fill="#2f5d9a"/>` +
      `<ellipse cx="32" cy="22" rx="4.2" ry="2.6" fill="#2f5d9a"/><path d="M12 34h40" stroke="#8fa8ba" stroke-width="1.6"/>` +
      `<path d="M23.5 44q2.5 2 5 0M35.5 44q2.5 2 5 0" ${INK} stroke="#38485a" stroke-width="1.8"/>` +
      blush(22, 42, 47) +
      `<path d="M30 47.5q2 1.6 4 0" ${INK} stroke="#38485a" stroke-width="1.5"/>`,
    BOT_RING,
  );

/** 兔头哥：爱杠、容易上头的兔子，绑红头带、眉毛竖着 */
const rabbit: Art = (p) =>
  frame(
    p,
    ['#ece2ff', '#8466cc'],
    lg(`${p}w`, '#ffffff', '#dcd8ea'),
    `<ellipse cx="23" cy="15" rx="5.5" ry="14" transform="rotate(-14 23 15)" fill="url(#${p}w)"/><ellipse cx="41" cy="15" rx="5.5" ry="14" transform="rotate(14 41 15)" fill="url(#${p}w)"/>` +
      `<ellipse cx="23" cy="16" rx="2.4" ry="10" transform="rotate(-14 23 16)" fill="#f5a9c0"/><ellipse cx="41" cy="16" rx="2.4" ry="10" transform="rotate(14 41 16)" fill="#f5a9c0"/>` +
      `<path d="M10 64q4-14 22-14t22 14z" fill="#f08c3a"/><path d="M26 51q6 5 12 0" ${INK} stroke="#c25f15" stroke-width="2"/>` +
      `<ellipse cx="32" cy="38" rx="17" ry="15" fill="url(#${p}w)"/>` +
      `<path d="M15.5 33q16.5-9 33 0" ${INK} stroke="#e63946" stroke-width="4.2"/><path d="M48 32l8-4M48 32l7 4" ${INK} stroke="#e63946" stroke-width="3"/>` +
      `<path d="M22 35l6 2.2M42 35l-6 2.2" ${INK} stroke="#2a2030" stroke-width="1.9"/>` +
      `<circle cx="25.5" cy="40" r="2.3" fill="#2a2030"/><circle cx="38.5" cy="40" r="2.3" fill="#2a2030"/><circle cx="26.2" cy="39.2" r=".8" fill="#fff"/><circle cx="39.2" cy="39.2" r=".8" fill="#fff"/>` +
      blush(21, 43, 45) +
      `<path d="M30.3 44h3.4L32 45.8z" fill="#f08aa8"/><path d="M32 45.8v1.6M28.8 47.4q3.2 2 6.4 0" ${INK} stroke="#2a2030" stroke-width="1.3"/>` +
      `<rect x="30.4" y="47.6" width="3.2" height="3.2" rx=".7" fill="#fff" stroke="#b8b4c8" stroke-width=".6"/>`,
    BOT_RING,
  );

/** 火锅婆婆：灰发挽髻、戴圆眼镜、系围裙的婆婆，背后一口翻着红油的锅 */
const hotpot: Art = (p) =>
  frame(
    p,
    ['#ffd98a', '#c0412a'],
    lg(`${p}s`, '#ffeadb', '#efbd98') + lg(`${p}r`, '#ff6a3a', '#b3150f'),
    `<path d="M10 28q-3-5 1-9M54 28q3-5-1-9M5 33q-2-4 1-7" ${INK} stroke="#fff" stroke-opacity=".7" stroke-width="2"/>` +
      `<path d="M2 40q2 22 30 24t30-24z" fill="#5a1d12"/><ellipse cx="32" cy="40" rx="30" ry="9" fill="#2e2320"/>` +
      `<ellipse cx="32" cy="40" rx="27" ry="6.8" fill="url(#${p}r)"/>` +
      `<path d="M8 39l4-1M53 41l4-2" ${INK} stroke="#ffd166" stroke-width="2"/><circle cx="14" cy="42" r="1.3" fill="#ffe08a"/><circle cx="50" cy="38" r="1.3" fill="#ffe08a"/>` +
      `<path d="M12 64q3-14 20-14t20 14z" fill="#7a5c99"/><path d="M23 54h18l1 10H22z" fill="#fff"/><path d="M24 54l-3-5M40 54l3-5" ${INK} stroke="#fff" stroke-width="2.4"/>` +
      `<rect x="28.5" y="57" width="7" height="4" rx="1" fill="#e9483a"/>` +
      `<circle cx="32" cy="18" r="6.2" fill="#b9b9c2"/><path d="M25 15l14 4" ${INK} stroke="#d63a2a" stroke-width="1.6"/>` +
      `<ellipse cx="32" cy="31" rx="14.5" ry="13" fill="#c9c9d2"/><ellipse cx="32" cy="36" rx="12" ry="12" fill="url(#${p}s)"/>` +
      `<path d="M20 33q1-11 12-11t12 11q-5-6-12-6.5-7 .5-12 6.5z" fill="#dcdce3"/>` +
      `<g ${INK} stroke="#5a3a2a" stroke-width="1.4"><circle cx="27" cy="36" r="3.7" fill="#fff" fill-opacity=".3"/><circle cx="37" cy="36" r="3.7" fill="#fff" fill-opacity=".3"/><path d="M30.7 36h2.6"/></g>` +
      `<path d="M25.5 36.6q1.5-1.6 3 0M35.5 36.6q1.5-1.6 3 0" ${INK} stroke="#3a2414" stroke-width="1.4"/>` +
      blush(23.5, 40.5, 41.5) +
      `<path d="M28.5 42q3.5 3 7 0" ${INK} stroke="#8a3a2a" stroke-width="1.6"/>`,
    BOT_RING,
  );

/** 板凳儿：憨憨的小板凳，头顶冒一棵新芽（新手），旁边一滴汗 */
const stool: Art = (p) =>
  frame(
    p,
    ['#dbefff', '#5b98d0'],
    lg(`${p}m`, '#e3a86a', '#a8693a'),
    `<path d="M18 40l-5 22M46 40l5 22" ${INK} stroke="#8a5a32" stroke-width="5"/><path d="M24 40l-2 18M40 40l2 18" ${INK} stroke="#6e4524" stroke-width="4"/>` +
      `<path d="M16 52h32" stroke="#7a4c28" stroke-width="3"/>` +
      `<path d="M32 25v-6" ${INK} stroke="#3f8a33" stroke-width="2"/><path d="M32 20q-7-6-10 0 5 4 10 0zM32 19q6-7 10-2-4 5-10 2z" fill="#6cc04a"/>` +
      `<rect x="8" y="24" width="48" height="17" rx="5.5" fill="url(#${p}m)" stroke="#7a4c28" stroke-width="1.2"/><rect x="10" y="25.2" width="44" height="4.4" rx="2.2" fill="#fff" opacity=".28"/>` +
      `<path d="M13 37q5-1.5 9 0M44 32q4-1 7 .5" ${INK} stroke="#7a4c28" stroke-opacity=".45" stroke-width="1"/>` +
      `<circle cx="24.5" cy="32" r="2.3" fill="#3a2414"/><circle cx="39.5" cy="32" r="2.3" fill="#3a2414"/><circle cx="25.2" cy="31.2" r=".8" fill="#fff"/><circle cx="40.2" cy="31.2" r=".8" fill="#fff"/>` +
      blush(19.5, 44.5, 35.5) +
      `<path d="M27 35q5 5.5 10 0z" fill="#7a2a1a"/><path d="M30 37.6q2-1.4 4 0" fill="#ff8a8a"/>` +
      `<path d="M52 13q-3.5 4.5 0 6.2 3.5-1.7 0-6.2z" fill="#a8dcff" stroke="#fff" stroke-width="1"/>`,
    BOT_RING,
  );

/** 不认识的电脑（比如房间里还没坐人的"电脑"）：一个圆头小机器人，带天线 */
const robot: Art = (p) =>
  frame(
    p,
    ['#d9e4ee', '#5d7488'],
    lg(`${p}m`, '#f4f7fa', '#b8c6d2'),
    `<path d="M32 16V9" ${INK} stroke="#3a4a5a" stroke-width="2.4"/><circle cx="32" cy="8" r="3" fill="#f3c86b"/>` +
      `<path d="M12 64q3-12 20-12t20 12z" fill="#7d93a8"/>` +
      `<rect x="14" y="16" width="36" height="32" rx="10" fill="url(#${p}m)" stroke="#5d7488" stroke-width="1.2"/>` +
      `<rect x="19" y="24" width="26" height="14" rx="7" fill="#24384c"/><circle cx="26" cy="31" r="3" fill="#7ee0ff"/><circle cx="38" cy="31" r="3" fill="#7ee0ff"/>` +
      `<path d="M27 43h10" ${INK} stroke="#5d7488" stroke-width="2"/>`,
    BOT_RING,
  );

/** 按名字前缀认性格：好友房实盘里同一个性格会坐好几家，名字后面带编号（火锅婆婆2） */
const PERSONA_ART: readonly (readonly [string, Art])[] = [
  ['幺妹儿', yaomei],
  ['熊猫哥', panda],
  ['盖碗儿', gaiwan],
  ['兔头哥', rabbit],
  ['火锅婆婆', hotpot],
  ['板凳儿', stool],
];

/** 真人的底纹：淡淡的白色，只是让同色的两个人也有点区别，不抢首字 */
const PATTERNS: readonly string[] = [
  '',
  '<path d="M-4 20L20-4M-4 36L36-4M-4 52L52-4M-4 68L68-4" stroke="#fff" stroke-opacity=".12" stroke-width="5"/>',
  '<g fill="#fff" fill-opacity=".16"><circle cx="12" cy="14" r="3"/><circle cx="52" cy="14" r="3"/><circle cx="10" cy="40" r="2.4"/><circle cx="54" cy="40" r="2.4"/><circle cx="32" cy="58" r="2.6"/></g>',
  '<circle cx="54" cy="56" r="20" fill="#fff" fill-opacity=".12"/><circle cx="54" cy="56" r="11" fill="#fff" fill-opacity=".1"/>',
  '<path d="M0 50q16-8 32 0t32 0V64H0z" fill="#fff" fill-opacity=".14"/>',
];

function humanSvg(name: string, p: string): string {
  const h = hash(name);
  const hue = HUES[h % HUES.length]!;
  const pattern = PATTERNS[(h >>> 8) % PATTERNS.length]!;
  // 好友房里是别人起的昵称：只取第一个字，而且只认文字和数字（天然排除 < > & " ' 和 emoji），再保险过滤一遍
  const first = [...name.trim()][0] ?? '';
  const ch = /^[\p{L}\p{N}]$/u.test(first) ? first.toUpperCase().replace(/[<>&"']/g, '') : '';
  const mark = ch
    ? `<text x="32" y="43" text-anchor="middle" font-size="${/[⺀-鿿가-힯]/.test(ch) ? 29 : 31}" font-weight="700" fill="#fff" stroke="${hue[1]}" stroke-width="3" stroke-linejoin="round" paint-order="stroke" font-family="'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Microsoft YaHei',sans-serif">${ch}</text>`
    : // 名字开头是 emoji 或符号：系统字体画 emoji 各家不一样，统一画一个小人剪影
      `<g fill="#fff" fill-opacity=".9"><circle cx="32" cy="25" r="9"/><path d="M14 52q2-15 18-15t18 15z"/></g>`;
  return frame(
    p,
    hue,
    '',
    pattern + `<ellipse cx="23" cy="16" rx="14" ry="7" transform="rotate(-28 23 16)" fill="#fff" opacity=".22"/>` + mark,
    HUMAN_RING,
  );
}

export function avatarSvg(name: string, bot: boolean): string {
  const p = `mjav${(seq++).toString(36)}`;
  if (!bot) return humanSvg(name, p);
  const art = PERSONA_ART.find(([n]) => name.startsWith(n))?.[1] ?? robot;
  return art(p);
}
