/**
 * 0.5 去文字化的小图标（48×48）：替代界面上的说明文字。Q 版纸张卡通风：梅子棕粗描边、平涂加一层暗面、左上高光。
 * 箭头为白底，画面层按涨跌色着色（setTint），所以红涨绿跌 / 绿涨红跌切换后不用重画。
 *
 *   node tools/art/build.ts glyphs
 */
import { INK, WHITE, type Frag, ellipseD, frag, hiArc, merge, rrectD, shape, starD, svgDoc } from './lib/svg.ts';

const S = 3;

function line(d: string, color: string, w: number): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function circle(cx: number, cy: number, r: number, fill: string, sw = S): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
}

/** 靶心：月度目标 */
function target(): Frag {
  return merge(
    frag(circle(22, 26, 18, '#ff6b5a') + circle(22, 26, 12, WHITE) + circle(22, 26, 6, '#ff6b5a')),
    frag(line('M22 26L40 8', INK, 3.4) + `<path d="M36 6L43 5L42 12Z" fill="#ffd23f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`),
    frag(hiArc('M10 18Q13 12 19 10', 3, 0.6)),
  );
}

/** 银行：屋顶 + 三根柱子 */
function bank(): Frag {
  return merge(
    shape('M4 18L24 6L44 18Z', { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [0, -2], sw: S }),
    frag(`<rect x="7" y="38" width="34" height="6" rx="2" fill="#c9b8d8" stroke="${INK}" stroke-width="${S}"/>`),
    frag([11, 21, 31].map((x) => `<rect x="${x}" y="20" width="6" height="18" rx="1.5" fill="${WHITE}" stroke="${INK}" stroke-width="2.6"/>`).join('')),
    frag(circle(24, 13.5, 3, '#fff3b0', 2)),
  );
}

/** 房子：月供 / 房租 */
function house(): Frag {
  return merge(
    shape(rrectD(9, 20, 30, 24, 4), { fill: '#ffe2b8', shade: '#f2c48a', shadeOffset: [-3, -3], sw: S }),
    shape('M4 23L24 6L44 23Z', { fill: '#ff7a5a', shade: '#e0553c', shadeOffset: [0, -3], sw: S }),
    frag(`<rect x="20" y="30" width="9" height="14" rx="2" fill="#8a5a44" stroke="${INK}" stroke-width="2.4"/>`),
  );
}

/** 钱包：账户 */
function wallet(): Frag {
  return merge(
    frag(`<rect x="8" y="8" width="26" height="14" rx="3" fill="#7ed39a" stroke="${INK}" stroke-width="2.4" transform="rotate(-10 21 15)"/>`),
    shape(rrectD(4, 16, 38, 26, 7), { fill: '#b06a3c', shade: '#8a4f2a', shadeOffset: [-3, -3], sw: S }),
    frag(`<rect x="30" y="24" width="14" height="10" rx="4" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/>` + circle(36, 29, 2, INK, 0)),
  );
}

/** 背包：道具 */
function bag(): Frag {
  return merge(
    frag(line('M17 14Q17 5 24 5Q31 5 31 14', INK, 3)),
    shape(rrectD(8, 12, 32, 32, 9), { fill: '#5a8dff', shade: '#3f6fe0', shadeOffset: [-3, -3], sw: S }),
    frag(`<rect x="15" y="26" width="18" height="11" rx="3" fill="#9ec0ff" stroke="${INK}" stroke-width="2.4"/>` + line('M15 30H33', INK, 2)),
  );
}

/** 日历：第几天 */
function calendar(): Frag {
  return merge(
    shape(rrectD(5, 9, 38, 34, 6), { fill: WHITE, shade: '#efe2d0', shadeOffset: [-3, -3], sw: S }),
    frag(`<path d="M5 15a6 6 0 0 1 6 -6h26a6 6 0 0 1 6 6v5H5Z" fill="#ff6b5a" stroke="${INK}" stroke-width="${S}" stroke-linejoin="round"/>`),
    frag(line('M15 5V13', INK, 3.4) + line('M33 5V13', INK, 3.4)),
    frag([0, 1, 2].map((i) => `<rect x="${12 + i * 9}" y="27" width="6" height="5" rx="1.5" fill="#f2c48a"/>`).join('') + `<rect x="12" y="35" width="6" height="5" rx="1.5" fill="#ff9a3c"/>`),
  );
}

/** 沙漏：还剩几天 */
function hourglass(): Frag {
  return merge(
    frag(`<rect x="9" y="4" width="30" height="6" rx="3" fill="#b06a3c" stroke="${INK}" stroke-width="2.6"/><rect x="9" y="38" width="30" height="6" rx="3" fill="#b06a3c" stroke="${INK}" stroke-width="2.6"/>`),
    shape('M13 10H35Q35 20 24 24Q35 28 35 38H13Q13 28 24 24Q13 20 13 10Z', { fill: '#dff3ff', shade: '#bfe2f5', shadeOffset: [-2, 0], sw: S }),
    frag(`<path d="M17 36Q24 29 31 36Z" fill="#ffd23f"/><path d="M19 14H29Q27 19 24 20Q21 19 19 14Z" fill="#ffd23f"/>`),
  );
}

/** 礼物：奖励 */
function gift(): Frag {
  return merge(
    shape(rrectD(7, 20, 34, 24, 4), { fill: '#ff7aa8', shade: '#e0558a', shadeOffset: [-3, -3], sw: S }),
    frag(`<rect x="4" y="14" width="40" height="9" rx="3" fill="#ff9cc0" stroke="${INK}" stroke-width="${S}"/>`),
    frag(`<rect x="20.5" y="14" width="7" height="30" fill="#ffd23f" stroke="${INK}" stroke-width="2.4"/>`),
    frag(`<path d="M24 14Q14 2 11 9Q10 14 24 14Q38 14 37 9Q34 2 24 14Z" fill="#ffd23f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`),
  );
}

/** 闪电：突发事件 */
function bolt(): Frag {
  return merge(shape('M28 3L9 27H22L17 45L39 18H26L31 3Z', { fill: '#ffe14a', shade: '#f0b020', shadeOffset: [-3, -2], sw: S }), frag(hiArc('M27 8L20 18', 2.6, 0.7)));
}

/** 奖杯：成就 / 战绩 */
function trophy(): Frag {
  return merge(
    frag(line('M12 12Q3 12 5 20Q7 26 14 25', INK, 3) + line('M36 12Q45 12 43 20Q41 26 34 25', INK, 3)),
    shape('M11 6H37V16Q37 30 24 31Q11 30 11 16Z', { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-3, -3], sw: S }),
    frag(`<rect x="20" y="30" width="8" height="7" fill="#f0a020" stroke="${INK}" stroke-width="2.4"/><rect x="13" y="37" width="22" height="7" rx="2.5" fill="#b06a3c" stroke="${INK}" stroke-width="${S}"/>`),
    frag(`<path d="${starD(24, 17, 6)}" fill="${WHITE}" fill-opacity="0.85"/>`),
  );
}

/** 小书：故事 / 说明 */
function book(): Frag {
  return merge(
    shape('M6 10Q15 6 24 11V42Q15 37 6 41Z', { fill: '#7ed3c0', shade: '#4fb8a0', shadeOffset: [2, 0], sw: S }),
    shape('M42 10Q33 6 24 11V42Q33 37 42 41Z', { fill: '#9ae6d6', shade: '#7ed3c0', shadeOffset: [-2, 0], sw: S }),
    frag(line('M11 17Q15 16 19 18', INK, 2) + line('M11 23Q15 22 19 24', INK, 2) + line('M29 18Q33 16 37 17', INK, 2)),
  );
}

/** 星：高光 */
function star(): Frag {
  return merge(shape(starD(24, 25, 20, 0.48), { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-3, -3], sw: S }), frag(hiArc('M17 18L22 12', 2.6, 0.7)));
}

/** 白色粗箭头（运行时着涨跌色） */
function arrow(up: boolean): Frag {
  const d = up ? 'M24 4L43 24H32V44H16V24H5Z' : 'M24 44L43 24H32V4H16V24H5Z';
  return merge(shape(d, { fill: WHITE, shade: '#e6e6e6', shadeOffset: [-3, 0], sw: S }));
}

/** 喇叭：群友喊话 */
function horn(): Frag {
  return merge(
    shape('M6 18H14L34 6V42L14 30H6Z', { fill: '#ff9a3c', shade: '#e07a20', shadeOffset: [0, -3], sw: S }),
    frag(`<rect x="10" y="30" width="7" height="12" rx="2" fill="#b06a3c" stroke="${INK}" stroke-width="2.4"/>`),
    frag(line('M39 17Q43 24 39 31', INK, 3)),
  );
}

/** 盾牌：押跌 / 防守 */
function bear(): Frag {
  return merge(
    frag(circle(12, 12, 6, '#a8724a') + circle(36, 12, 6, '#a8724a')),
    shape('M6 26Q6 9 24 9Q42 9 42 26Q42 43 24 43Q6 43 6 26Z', { fill: '#c08a5a', shade: '#a8724a', shadeOffset: [-3, -3], sw: S }),
    frag(`<ellipse cx="24" cy="32" rx="9" ry="7" fill="#f3d9b8" stroke="${INK}" stroke-width="2.4"/>` + circle(17, 23, 2.4, INK, 0) + circle(31, 23, 2.4, INK, 0) + circle(24, 30, 2.6, INK, 0)),
  );
}

// ---------------------------------------------------------------- 0.5.1 丰满化：天气、贴纸、情绪脸

/** 云朵路径（底边平） */
function cloudD(x: number, y: number, w: number): string {
  const k = w / 36;
  const X = (v: number): number => Math.round((x + v * k) * 10) / 10;
  const Y = (v: number): number => Math.round((y + v * k) * 10) / 10;
  return `M${X(4)} ${Y(20)}Q${X(0)} ${Y(20)} ${X(0)} ${Y(15)}Q${X(0)} ${Y(9)} ${X(7)} ${Y(9)}Q${X(9)} ${Y(1)} ${X(17)} ${Y(2)}Q${X(25)} ${Y(1)} ${X(27)} ${Y(8)}Q${X(36)} ${Y(8)} ${X(36)} ${Y(14.5)}Q${X(36)} ${Y(20)} ${X(31)} ${Y(20)}Z`;
}

/** 太阳：晴天 / 牛 */
function sun(): Frag {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r: number): string => `${(24 + Math.cos(a) * r).toFixed(1)} ${(24 + Math.sin(a) * r).toFixed(1)}`;
    return line(`M${p(15)}L${p(21)}`, '#f0a020', 4);
  }).join('');
  return merge(frag(rays), shape(ellipseD(24, 24, 11, 11), { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-3, -3], sw: S }), frag(circle(20, 23, 1.6, INK, 0) + circle(28, 23, 1.6, INK, 0) + line('M20 28Q24 31 28 28', INK, 2)));
}

/** 灰云：阴 */
function cloud(): Frag {
  return merge(shape(cloudD(5, 12, 38), { fill: '#c9c3d6', shade: '#a59fb6', shadeOffset: [-3, -3], sw: S }), frag(hiArc('M12 22Q14 17 19 16', 2.6, 0.6)));
}

/** 雨：云 + 雨点 */
function rain(): Frag {
  const drops = [12, 22, 32].map((x, i) => `<path d="M${x} ${33 + (i % 2) * 3}q-2 4 0 6q2 -2 0 -6Z" fill="#5ab4ff" stroke="${INK}" stroke-width="1.8"/>`).join('');
  return merge(shape(cloudD(5, 6, 38), { fill: '#b8c4d8', shade: '#8f9db8', shadeOffset: [-3, -3], sw: S }), frag(drops));
}

/** 雷：乌云 + 闪电 */
function storm(): Frag {
  return merge(
    shape(cloudD(4, 4, 40), { fill: '#7d7a92', shade: '#5f5c74', shadeOffset: [-3, -3], sw: S }),
    shape('M25 24L16 36H23L19 46L31 31H24L28 24Z', { fill: '#ffe14a', shade: '#f0b020', shadeOffset: [-2, -1], sw: 2.4 }),
  );
}

/** 彩虹：大涨日 */
function rainbow(): Frag {
  const arcs = [
    ['#ff6b5a', 19],
    ['#ffb23f', 15],
    ['#ffe14a', 11],
    ['#7ed39a', 7],
  ]
    .map(([c, r]) => `<path d="M${24 - Number(r)} 36A${r} ${r} 0 0 1 ${24 + Number(r)} 36" fill="none" stroke="${c}" stroke-width="4.4"/>`)
    .join('');
  return merge(
    frag(`<path d="M3 36A21 21 0 0 1 45 36" fill="none" stroke="${INK}" stroke-width="2"/>${arcs}`),
    shape(cloudD(1, 30, 16), { fill: WHITE, shade: '#e8e2f0', shadeOffset: [-2, -2], sw: 2.4 }),
    shape(cloudD(31, 30, 16), { fill: WHITE, shade: '#e8e2f0', shadeOffset: [-2, -2], sw: 2.4 }),
  );
}

/** 火箭：贴纸「起飞」 */
function rocket(): Frag {
  return merge(
    shape('M15 33Q9 39 7 44Q12 43 18 36Z', { fill: '#ff9a3c', shade: '#ff6b5a', shadeOffset: [1, -1], sw: 2.4 }),
    shape('M14 26L8 28L12 36Z', { fill: '#ff6b5a', sw: 2.4, shade: false }),
    shape('M22 34L20 40L12 36Z', { fill: '#ff6b5a', sw: 2.4, shade: false }),
    shape('M40 4Q44 8 40 18L24 34L14 24L30 8Q36 4 40 4Z', { fill: WHITE, shade: '#d8d4e4', shadeOffset: [-3, -3], sw: S }),
    frag(circle(30, 18, 4.5, '#5ab4ff', 2.6)),
  );
}

/** 哭脸：贴纸「亏麻了」 */
function cry(): Frag {
  return merge(
    shape(ellipseD(24, 25, 19, 19), { fill: '#ffd23f', shade: '#f0a020', shadeOffset: [-3, -3], sw: S }),
    frag(line('M13 20Q17 17 21 20', INK, 2.6) + line('M27 20Q31 17 35 20', INK, 2.6) + `<path d="M17 36Q24 28 31 36" fill="#8a3a3a" stroke="${INK}" stroke-width="2.4"/>`),
    frag(`<path d="M15 22Q12 32 15 40" fill="none" stroke="#5ab4ff" stroke-width="4" stroke-linecap="round"/><path d="M33 22Q36 32 33 40" fill="none" stroke="#5ab4ff" stroke-width="4" stroke-linecap="round"/>`),
  );
}

/** 钱袋：贴纸「赚麻了」 */
function moneybag(): Frag {
  return merge(
    shape('M17 13Q12 6 18 5Q24 8 30 5Q36 6 31 13Z', { fill: '#c08a5a', shade: '#a8724a', shadeOffset: [0, -2], sw: 2.6 }),
    shape('M17 13Q5 22 6 33Q8 44 24 44Q40 44 42 33Q43 22 31 13Z', { fill: '#d9a066', shade: '#b07a44', shadeOffset: [-3, -3], sw: S }),
    frag(line('M17 22L24 30L31 22', '#ffd23f', 5) + line('M24 30V40', '#ffd23f', 5) + line('M18 31H30', '#ffd23f', 4) + line('M18 36H30', '#ffd23f', 4)),
    frag(line('M17 22L24 30L31 22', INK, 1.4) + line('M24 30V40', INK, 1.2)),
  );
}

/** 韭菜：贴纸「又被割了」 */
function leek(): Frag {
  return merge(
    shape('M14 44Q12 26 6 8Q16 22 20 44Z', { fill: '#7ed39a', shade: '#4fb070', shadeOffset: [2, 0], sw: 2.6 }),
    shape('M20 44Q22 22 24 4Q28 22 28 44Z', { fill: '#9ae6a8', shade: '#5ec47a', shadeOffset: [2, 0], sw: 2.6 }),
    shape('M28 44Q32 26 42 10Q38 28 34 44Z', { fill: '#7ed39a', shade: '#4fb070', shadeOffset: [-2, 0], sw: 2.6 }),
    frag(`<rect x="11" y="36" width="26" height="8" rx="3" fill="${WHITE}" stroke="${INK}" stroke-width="2.4"/>`),
  );
}

/** 西瓜：贴纸「吃瓜」 */
function melon(): Frag {
  return merge(
    shape('M4 18Q24 50 44 18Z', { fill: '#5ec47a', shade: '#3f9f5a', shadeOffset: [0, -3], sw: S }),
    frag(`<path d="M8 19Q24 42 40 19Z" fill="#ff6b5a"/>`),
    frag([14, 21, 28, 34].map((x, i) => `<ellipse cx="${x}" cy="${24 + (i % 2) * 4}" rx="1.4" ry="2.2" fill="${INK}"/>`).join('')),
  );
}

/** 锤子：贴纸「锤了」 */
function hammer(): Frag {
  return merge(
    frag(`<rect x="21" y="18" width="7" height="28" rx="3" fill="#c08a5a" stroke="${INK}" stroke-width="${S}" transform="rotate(30 24 30)"/>`),
    shape(rrectD(6, 6, 30, 14, 4), { fill: '#9aa4b8', shade: '#7a8498', shadeOffset: [-3, -3], sw: S, extra: '' }),
  );
}

/** 情绪脸（风口的心情）：底色 + 五官 */
function face(fill: string, shade: string, kind: 'hot' | 'happy' | 'calm' | 'sad' | 'cold'): Frag {
  const eyes =
    kind === 'hot'
      ? `<path d="${starD(17, 21, 4.4)}" fill="${WHITE}" stroke="${INK}" stroke-width="1.6"/><path d="${starD(31, 21, 4.4)}" fill="${WHITE}" stroke="${INK}" stroke-width="1.6"/>`
      : kind === 'happy'
        ? line('M13 22Q17 17 21 22', INK, 2.6) + line('M27 22Q31 17 35 22', INK, 2.6)
        : kind === 'sad'
          ? line('M13 19L20 22', INK, 2.6) + line('M35 19L28 22', INK, 2.6)
          : circle(17, 21, 2.2, INK, 0) + circle(31, 21, 2.2, INK, 0);
  const mouth =
    kind === 'hot'
      ? `<path d="M15 29Q24 41 33 29Z" fill="#8a3a3a" stroke="${INK}" stroke-width="2.4"/>`
      : kind === 'happy'
        ? line('M16 30Q24 37 32 30', INK, 2.6)
        : kind === 'calm'
          ? line('M18 32H30', INK, 2.6)
          : kind === 'sad'
            ? line('M16 35Q24 28 32 35', INK, 2.6)
            : line('M16 32L19 30L22 32L25 30L28 32L31 30', INK, 2.2);
  const extra =
    kind === 'hot'
      ? `<path d="M24 1Q30 6 27 10Q25 6 24 1Z" fill="#ff6b5a" stroke="${INK}" stroke-width="1.6"/>`
      : kind === 'cold'
        ? `<path d="M36 6l2 4l4 0l-3 3l1 4l-4 -2l-4 2l1 -4l-3 -3l4 0Z" fill="#d9f0ff" stroke="${INK}" stroke-width="1.4"/>`
        : kind === 'sad'
          ? `<path d="M37 14q-3 5 0 7q3 -2 0 -7Z" fill="#5ab4ff" stroke="${INK}" stroke-width="1.4"/>`
          : '';
  return merge(shape(ellipseD(24, 25, 19, 19), { fill, shade, shadeOffset: [-3, -3], sw: S }), frag(eyes + mouth + extra));
}

/** 放大镜：看详情 */
function magnifier(): Frag {
  return merge(
    frag(`<rect x="28" y="28" width="7" height="18" rx="3" fill="#b06a3c" stroke="${INK}" stroke-width="${S}" transform="rotate(-45 31 37)"/>`),
    shape(ellipseD(20, 20, 14, 14), { fill: '#d9f0ff', shade: '#a8d4f0', shadeOffset: [-3, -3], sw: S }),
    frag(hiArc('M12 18Q13 12 18 11', 2.6, 0.8)),
  );
}

export const GLYPHS: Record<string, () => Frag> = {
  target,
  bank,
  house,
  wallet,
  bag,
  calendar,
  hourglass,
  gift,
  bolt,
  trophy,
  book,
  star,
  arrow_up: () => arrow(true),
  arrow_down: () => arrow(false),
  horn,
  bear,
  sun,
  cloud,
  rain,
  storm,
  rainbow,
  rocket,
  cry,
  moneybag,
  leek,
  melon,
  hammer,
  face_hot: () => face('#ff7a5a', '#e0553c', 'hot'),
  face_happy: () => face('#ffd23f', '#f0a020', 'happy'),
  face_calm: () => face('#ffe9b0', '#f2cf80', 'calm'),
  face_sad: () => face('#b8c4e8', '#8f9dc8', 'sad'),
  face_cold: () => face('#c8ecff', '#94cde8', 'cold'),
  magnifier,
};

export function build(write: (rel: string, data: string) => void): number {
  for (const [name, fn] of Object.entries(GLYPHS)) write(`ui/gl_${name}.svg`, svgDoc(48, 48, fn()));
  return Object.keys(GLYPHS).length;
}
