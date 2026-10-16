/**
 * 头像：四个 Q 版人物 × 五种表情。viewBox 0 0 160 160。
 * bustSvg 只画人物头肩（无边框，标题图复用）；avatarSvg 加圆形木框金边徽章。
 */
import { C, SANS, svg } from './common.ts';

export type AvatarId = 'me' | 'laozhang' | 'xiaomei' | 'aqiang';
export type Mood = 'normal' | 'happy' | 'sad' | 'think' | 'smug';

/** 三位电脑对手的名字与代表色（名牌底色） */
export const PERSONAS: Record<Exclude<AvatarId, 'me'>, { name: string; color: number }> = {
  laozhang: { name: '老张', color: 0xb5552b },
  xiaomei: { name: '小美', color: 0x6f4a9e },
  aqiang: { name: '阿强', color: 0x2f8a5c },
};

/** 头像内底色 [中心, 边缘] */
const BG: Record<AvatarId, [string, string]> = {
  me: ['#6f9fd0', '#2f5a8c'],
  laozhang: ['#e3a15f', '#a4512a'],
  xiaomei: ['#b195d6', '#5f3f8e'],
  aqiang: ['#6cc49a', '#257450'],
};

const INK = C.ink;
const L3 = `stroke="${INK}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"`;
const L2 = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

interface Look {
  skin: string;
  skinSh: string;
  brow: string;
  browW: number;
  browY: number;
  lash: boolean;
  calm: boolean;
}

const LOOK: Record<AvatarId, Look> = {
  me: { skin: '#fbdcc0', skinSh: '#eeb994', brow: '#5a3a26', browW: 4, browY: 74, lash: false, calm: false },
  laozhang: { skin: '#f2c99e', skinSh: '#dea173', brow: '#3a3330', browW: 6.5, browY: 71, lash: false, calm: false },
  xiaomei: { skin: '#fde2cc', skinSh: '#f0bfa0', brow: '#2b1f1f', browW: 3.2, browY: 72, lash: true, calm: true },
  aqiang: { skin: '#f6cfa6', skinSh: '#e2a676', brow: '#2b1d14', browW: 5.5, browY: 72, lash: false, calm: false },
};

const EX = [66, 94] as const; // 两眼 x
const EY = 85;

/** 五官（随表情） */
function features(mood: Mood, k: Look): [string, string] {
  const [a, b] = EX;
  let eyes = '';
  let brows = '';
  let mouth = '';
  let extra = '';
  let hand = '';
  const bw = `stroke="${k.brow}" stroke-width="${k.browW}" stroke-linecap="round" fill="none"`;
  const by = k.browY;
  const round = (x: number, y: number, r: number, dx = 0, dy = 0) =>
    `<ellipse cx="${x}" cy="${y}" rx="${r * 0.85}" ry="${r * 1.12}" fill="${INK}"/><circle cx="${x + r * 0.32 + dx}" cy="${y - r * 0.42 + dy}" r="${r * 0.36}" fill="#fff"/>`;
  const lash = (x: number, side: number) => (k.lash ? `<path d="M${x + side * 5} ${EY - 4}l${side * 4} -3" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` : '');
  switch (mood) {
    case 'normal':
      eyes = round(a, EY, 5.2) + round(b, EY, 5.2) + lash(a, -1) + lash(b, 1);
      if (k.calm) eyes += `<path d="M${a - 7.5} ${EY - 3}Q${a} ${EY - 7.5} ${a + 7.5} ${EY - 3}M${b - 7.5} ${EY - 3}Q${b} ${EY - 7.5} ${b + 7.5} ${EY - 3}" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      brows = `<path d="M${a - 9} ${by}Q${a} ${by - 4} ${a + 8} ${by}M${b - 8} ${by}Q${b} ${by - 4} ${b + 9} ${by}" ${bw}/>`;
      mouth = k.calm ? `<path d="M74 101Q80 104 86 101" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>` : `<path d="M71 99Q80 107 89 99" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      break;
    case 'happy':
      eyes = `<path d="M${a - 7} ${EY + 2}Q${a} ${EY - 7} ${a + 7} ${EY + 2}M${b - 7} ${EY + 2}Q${b} ${EY - 7} ${b + 7} ${EY + 2}" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>` + lash(a, -1) + lash(b, 1);
      brows = `<path d="M${a - 9} ${by - 4}Q${a} ${by - 9} ${a + 8} ${by - 4}M${b - 8} ${by - 4}Q${b} ${by - 9} ${b + 9} ${by - 4}" ${bw}/>`;
      mouth = `<path d="M68 97Q80 99 92 97Q90 113 80 113Q70 113 68 97Z" fill="#8f2a24" ${L2}/><path d="M73 107Q80 103 87 107Q84 112 80 112Q76 112 73 107Z" fill="#ef7f7a"/>`;
      extra = `<path d="M126 34l2.6 6 6 2.6-6 2.6-2.6 6-2.6-6-6-2.6 6-2.6z" fill="${C.goldLight}" stroke="${INK}" stroke-width="1.6"/><path d="M34 46l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill="#fff"/>`;
      break;
    case 'sad':
      eyes = round(a, EY + 2, 4.6, 0, 1) + round(b, EY + 2, 4.6, 0, 1) + lash(a, -1) + lash(b, 1);
      brows = `<path d="M${a - 9} ${by + 3}L${a + 7} ${by - 4}M${b - 7} ${by - 4}L${b + 9} ${by + 3}" ${bw}/>`;
      mouth = `<path d="M71 106Q80 98 89 106" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M${a - 3} ${EY + 10}C${a - 9} ${EY + 18} ${a - 9} ${EY + 24} ${a - 3} ${EY + 24}C${a + 3} ${EY + 24} ${a + 3} ${EY + 18} ${a - 3} ${EY + 10}Z" fill="#7fc4ef" stroke="#2f6f9e" stroke-width="1.6"/>` +
        `<path d="M118 30v14M126 36v10M134 30v12" stroke="#7fa8cf" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`;
      break;
    case 'think':
      eyes = round(a, EY, 5, 1.6, -1.2) + round(b, EY, 5, 1.6, -1.2) + lash(a, -1) + lash(b, 1);
      brows = `<path d="M${a - 9} ${by + 1}L${a + 8} ${by + 1}M${b - 8} ${by - 2}Q${b} ${by - 9} ${b + 9} ${by - 4}" ${bw}/>`;
      mouth = `<path d="M75 103L86 100" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      // 托腮的手 + 问号 + 汗滴
      hand = `<path d="M92 128C88 118 92 108 100 106C106 104 112 108 112 116C112 124 106 132 98 134Z" fill="${k.skin}" ${L2}/>` +
        `<path d="M100 108Q96 112 99 116M106 108Q102 112 105 117" fill="none" stroke="${k.skinSh}" stroke-width="2" stroke-linecap="round"/>`;
      extra = `<text x="134" y="44" font-family='${SANS}' font-weight="900" font-size="34" fill="${C.goldLight}" stroke="${INK}" stroke-width="3" paint-order="stroke" text-anchor="middle">?</text>` +
        `<path d="M116 62C112 68 112 72 116 72C120 72 120 68 116 62Z" fill="#9fd6f5" stroke="#2f6f9e" stroke-width="1.4"/>`;
      break;
    case 'smug':
      eyes = `<path d="M${a - 7} ${EY}A7 6 0 0 0 ${a + 7} ${EY}Z" fill="${INK}"/><path d="M${b - 7} ${EY}A7 6 0 0 0 ${b + 7} ${EY}Z" fill="${INK}"/>` +
        `<path d="M${a - 8} ${EY}H${a + 8}M${b - 8} ${EY}H${b + 8}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
        `<circle cx="${a + 2}" cy="${EY + 2.4}" r="1.6" fill="#fff"/><circle cx="${b + 2}" cy="${EY + 2.4}" r="1.6" fill="#fff"/>` + lash(a, -1) + lash(b, 1);
      brows = `<path d="M${a - 9} ${by + 3}L${a + 8} ${by + 4}M${b - 8} ${by - 1}Q${b} ${by - 10} ${b + 10} ${by - 5}" ${bw}/>`;
      mouth = `<path d="M70 101Q82 106 91 95" stroke="${INK}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M88 99l4 1" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
      extra = `<path d="M30 40q6-8 12 0q-6 8-12 0z" fill="${C.goldLight}" opacity=".9"/>`;
      break;
  }
  const blush = mood === 'happy' ? 0.9 : mood === 'sad' ? 0.35 : 0.6;
  return [`<ellipse cx="54" cy="97" rx="7.5" ry="4.4" fill="#f2857c" opacity="${blush}"/><ellipse cx="106" cy="97" rx="7.5" ry="4.4" fill="#f2857c" opacity="${blush}"/>` +
    brows + eyes + mouth + hand, extra];
}

/** 头 + 脖子 + 肩（不含发型、衣服花样） */
function headBase(k: Look, clothes: string, clothesDark: string): string {
  return `<path d="M18 164C20 134 46 122 80 122C114 122 140 134 142 164Z" fill="${clothes}" ${L3}/>` +
    `<path d="M26 164C30 146 40 136 56 130L62 164Z" fill="${clothesDark}" opacity=".5"/>` +
    `<path d="M70 106H90V126Q80 132 70 126Z" fill="${k.skinSh}" ${L2}/>` +
    `<ellipse cx="44" cy="88" rx="7" ry="9" fill="${k.skin}" ${L3}/><ellipse cx="116" cy="88" rx="7" ry="9" fill="${k.skin}" ${L3}/>` +
    `<ellipse cx="80" cy="82" rx="37" ry="35" fill="${k.skin}" ${L3}/>` +
    `<path d="M46 92C50 110 64 116 80 116C96 116 110 110 114 92C108 106 96 112 80 112C64 112 52 106 46 92Z" fill="${k.skinSh}" opacity=".6"/>`;
}

/** 表情附加符号（问号、汗滴、泪痕、闪光），画在头像圆框之上，不被裁切 */
function moodExtraSvg(id: AvatarId, mood: Mood): string {
  return features(mood, LOOK[id])[1];
}

/** 人物头肩（160×160 坐标，无框；不含表情附加符号） */
export function bustSvgBody(id: AvatarId, mood: Mood): string {
  const k = LOOK[id];
  const face = features(mood, k)[0];
  switch (id) {
    case 'me': {
      const hair = '#5a3a26';
      const back = `<path d="M42 84C40 64 52 52 80 52C108 52 120 64 118 84L112 78L48 78Z" fill="${hair}" ${L3}/>`;
      const body = headBase(k, '#3f8f7a', '#245c4d') +
        `<path d="M58 124Q80 140 102 124" fill="none" stroke="#2c6e5d" stroke-width="7" stroke-linecap="round"/>` +
        `<path d="M70 134V150M90 134V150" stroke="#f3e6c8" stroke-width="3" stroke-linecap="round"/><circle cx="70" cy="152" r="3" fill="#f3e6c8"/><circle cx="90" cy="152" r="3" fill="#f3e6c8"/>`;
      const front = `<path d="M44 76C46 84 50 88 54 86C52 80 52 76 54 72ZM116 76C114 84 110 88 106 86C108 80 108 76 106 72Z" fill="${hair}" ${L2}/>` +
        // 鸭舌帽
        `<path d="M44 70C44 44 60 34 80 34C100 34 116 44 116 70Z" fill="#c8323a" ${L3}/>` +
        `<path d="M60 40C66 37 72 36 78 36" stroke="#e86a6f" stroke-width="3" stroke-linecap="round" fill="none"/>` +
        `<path d="M80 35V68" stroke="#8e1d24" stroke-width="2" opacity=".6"/>` +
        `<path d="M40 70Q80 58 120 70Q126 78 114 77Q80 68 46 77Q34 78 40 70Z" fill="#8e1d24" ${L2}/>` +
        `<circle cx="80" cy="34" r="4" fill="${C.gold}" ${L2}/>` +
        `<path d="M96 48l2 4.4 4.6.6-3.4 3.2.9 4.6-4.1-2.3-4.1 2.3.9-4.6-3.4-3.2 4.6-.6z" fill="${C.goldLight}"/>`;
      return back + body + face + front;
    }
    case 'laozhang': {
      const grey = '#cfcac4';
      const body = headBase(k, '#7a4a2a', '#4e2c16') +
        `<path d="M62 124L80 146L98 124" fill="#f4efe6" ${L2}/>` +
        `<path d="M62 124L72 150M98 124L88 150" stroke="#5a3218" stroke-width="3" stroke-linecap="round"/>`;
      // 地中海：两侧花白 + 头顶几缕
      const hair = `<path d="M43 82C40 66 46 56 56 54C52 62 51 72 53 84Z" fill="${grey}" ${L2}/><path d="M117 82C120 66 114 56 104 54C108 62 109 72 107 84Z" fill="${grey}" ${L2}/>` +
        `<path d="M66 50Q76 44 88 48M70 54Q80 48 92 52" fill="none" stroke="#8d8781" stroke-width="2" stroke-linecap="round"/>` +
        `<ellipse cx="68" cy="58" rx="10" ry="5" fill="#fff" opacity=".45" transform="rotate(-20 68 58)"/>` +
        `<path d="M68 63Q80 60 92 63M70 67Q80 65 90 67" fill="none" stroke="${k.skinSh}" stroke-width="1.8" stroke-linecap="round"/>`;
      const stache = mood === 'happy' ? '' : `<path d="M68 96Q74 92 80 95Q86 92 92 96Q86 99 80 97Q74 99 68 96Z" fill="#7a726b" stroke="${INK}" stroke-width="1.2"/>`;
      // 老花镜
      const glasses = `<g fill="#fff" fill-opacity=".18" stroke="#6b3c1a" stroke-width="3"><circle cx="${EX[0]}" cy="${EY + 1}" r="11.5"/><circle cx="${EX[1]}" cy="${EY + 1}" r="11.5"/></g>` +
        `<path d="M${EX[0] + 11.5} ${EY}Q80 ${EY - 4} ${EX[1] - 11.5} ${EY}M${EX[0] - 11.5} ${EY - 1}L45 ${EY - 4}M${EX[1] + 11.5} ${EY - 1}L115 ${EY - 4}" fill="none" stroke="#6b3c1a" stroke-width="2.6"/>` +
        `<path d="M${EX[0] - 6} ${EY - 6}l4 -3M${EX[1] - 6} ${EY - 6}l4 -3" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
      // 保温杯
      const cup = `<g transform="rotate(-6 126 140)"><rect x="114" y="116" width="24" height="46" rx="5" fill="#c9d1d9" ${L2}/><rect x="114" y="130" width="24" height="8" fill="#b8322c"/><rect x="112" y="108" width="28" height="13" rx="4" fill="#b8322c" ${L2}/><path d="M116 112H136" stroke="#e86a6f" stroke-width="2" stroke-linecap="round"/>` +
        `<rect x="118" y="126" width="4" height="30" rx="2" fill="#fff" opacity=".35"/>` +
        `<ellipse cx="114" cy="140" rx="9" ry="11" fill="${k.skin}" ${L2}/></g>`;
      return body + hair + face + stache + glasses + cup;
    }
    case 'xiaomei': {
      const hair = '#241a1f';
      const back = `<ellipse cx="80" cy="34" rx="18" ry="16" fill="${hair}" ${L3}/>` +
        `<path d="M66 30Q80 22 94 30" stroke="#4d3a48" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
        `<path d="M64 46Q80 52 96 46" stroke="#c0405a" stroke-width="6" stroke-linecap="round" fill="none"/>` +
        `<path d="M38 90C34 60 52 44 80 44C108 44 126 60 122 90C124 108 118 120 110 124L50 124C42 120 36 108 38 90Z" fill="${hair}" ${L3}/>`;
      const body = headBase(k, '#6f4a9e', '#4a2e72') +
        // 立领 + 盘扣
        `<path d="M66 120Q80 126 94 120L95 128Q80 134 65 128Z" fill="#8b66bc" ${L2}/>` +
        `<path d="M80 131V160" stroke="#4a2e72" stroke-width="2"/><path d="M74 140H86M74 150H86" stroke="${C.gold}" stroke-width="3" stroke-linecap="round"/><circle cx="80" cy="140" r="2.4" fill="${C.goldLight}"/><circle cx="80" cy="150" r="2.4" fill="${C.goldLight}"/>`;
      const front = `<path d="M43 82C42 58 58 47 80 47C102 47 118 58 117 82C112 74 106 70 100 73C95 66 88 67 82 72C76 66 68 66 62 72C56 68 48 72 43 82Z" fill="${hair}" ${L2}/>` +
        `<path d="M58 54Q66 50 74 51" stroke="#55424f" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
        `<path d="M104 60l12-6" stroke="${C.gold}" stroke-width="4" stroke-linecap="round"/><circle cx="117" cy="53.5" r="3.4" fill="#e8708a" stroke="${INK}" stroke-width="1.2"/>`;
      return back + body + face + front;
    }
    case 'aqiang': {
      const hair = '#2b1d14';
      // 刺猬头：一圈尖刺
      let spikes = 'M42 84';
      const pts: Array<[number, number]> = [[34, 66], [46, 60], [36, 44], [54, 46], [50, 26], [66, 38], [74, 16], [84, 36], [98, 20], [100, 40], [118, 30], [112, 50], [128, 50], [116, 64], [126, 76], [118, 84]];
      for (const [x, y] of pts) spikes += `L${x} ${y}`;
      spikes += 'Z';
      const back = `<path d="${spikes}" fill="${hair}" ${L3}/>`;
      const body = headBase(k, '#f0a830', '#b8761a') +
        `<path d="M62 124Q80 142 98 124" fill="#fff6e3" ${L2}/>` +
        `<path d="M34 146L48 134M126 146L112 134" stroke="#fff6e3" stroke-width="5" stroke-linecap="round"/>`;
      const front = `<path d="M44 74L50 56L58 66L64 50L72 62L80 48L86 62L94 50L100 64L108 54L116 74Q80 60 44 74Z" fill="${hair}" ${L2}/>` +
        // 红发带 + 飘带
        `<path d="M43 74Q80 58 117 74L118 82Q80 66 42 82Z" fill="#d6302c" ${L2}/>` +
        `<path d="M117 76L136 68L132 78L140 86L118 82Z" fill="#d6302c" ${L2}/>` +
        `<path d="M64 70Q72 67 80 66" stroke="#ff7a6a" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
        // 创可贴
        `<g transform="rotate(-20 106 102)"><rect x="98" y="99" width="16" height="7" rx="3" fill="#f3d2a4" stroke="#b07a46" stroke-width="1.2"/><path d="M104 101v3M108 101v3" stroke="#b07a46" stroke-width="1"/></g>`;
      return back + body + face + front;
    }
  }
}

/** 头像徽章：红木外圈（带细木纹）+ 渐变漆金环 + 深漆内圈 + 顶部高光，内底色，头肩像随表情变化 */
export function avatarSvg(id: AvatarId, mood: Mood): string {
  const [c0, c1] = BG[id];
  return svg(160, 160,
    `<defs><linearGradient id="wd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a3a22"/><stop offset=".5" stop-color="#5a1f12"/><stop offset="1" stop-color="#2e0f08"/></linearGradient>` +
    // 金环用斜向多段渐变，亮暗交替才像抛光的金属而不是一块黄
    `<linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".3" stop-color="${C.gold}"/><stop offset=".55" stop-color="#f6e29a"/><stop offset=".8" stop-color="${C.goldDeep}"/><stop offset="1" stop-color="#8a5e18"/></linearGradient>` +
    // 木纹：纵向拉长的噪声，只着色到外圈
    `<filter id="wg" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".02 .22" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 .1  0 0 0 0 .02  0 0 0 0 0  0 0 0 .9 -.25"/></filter>` +
    `<radialGradient id="bgc" cx=".5" cy=".38" r=".65"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></radialGradient>` +
    `<clipPath id="wc"><circle cx="80" cy="80" r="78"/></clipPath>` +
    `<clipPath id="cc"><circle cx="80" cy="80" r="67"/></clipPath></defs>` +
    `<circle cx="80" cy="80" r="78" fill="url(#wd)"/>` +
    `<rect width="160" height="160" filter="url(#wg)" clip-path="url(#wc)" opacity=".7"/>` +
    `<circle cx="80" cy="80" r="77.2" fill="none" stroke="#000" stroke-width="1.6" opacity=".55"/>` +
    `<circle cx="80" cy="80" r="75" fill="none" stroke="url(#gr)" stroke-width="2.4"/>` +
    `<circle cx="80" cy="80" r="70" fill="url(#gr)"/>` +
    `<circle cx="80" cy="80" r="70" fill="none" stroke="${C.goldDeep}" stroke-width="1" opacity=".7"/>` +
    `<circle cx="80" cy="80" r="67" fill="url(#bgc)"/>` +
    `<g clip-path="url(#cc)"><circle cx="80" cy="80" r="52" fill="#fff" opacity=".08"/>${bustSvgBody(id, mood)}</g>` +
    `<circle cx="80" cy="80" r="66.2" fill="none" stroke="#1c0a05" stroke-width="2.4" opacity=".9"/>` +
    `<path d="M24 52A62 62 0 0 1 60 18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".25"/>` +
    `<path d="M30 40A54 54 0 0 1 70 14" fill="none" stroke="#fff6d0" stroke-width="2" stroke-linecap="round" opacity=".5"/>` +
    moodExtraSvg(id, mood));
}
