/**
 * 手机群聊：手机外框、刘海、标题栏、聊天背景平铺、消息气泡、推荐卡片。
 * 需要拉伸的都按九宫格设计，切片尺寸见各函数注释与 README。
 */
import { INK, WHITE, type Frag, darken, frag, hiArc, merge, rrectD, shape, sparkleD, starD, svgDoc } from './lib/svg.ts';

/** 手机外框 360×720，九宫格四边各 48px。屏幕区域内缩 14px，底色米白。 */
function phoneFrame(): Frag {
  const outer = rrectD(4, 4, 352, 712, 46);
  const screen = rrectD(18, 18, 324, 684, 34);
  return merge(
    frag(`<path d="${rrectD(8, 10, 352, 710, 46)}" fill="${INK}" fill-opacity="0.25"/>`),
    shape(outer, { fill: '#4a4460', shade: '#3a3448', shadeOffset: [-5, -5], sw: 4 }),
    frag(hiArc('M52 11H120', 3, 0.35)),
    frag(`<path d="${screen}" fill="#fff4e2" stroke="${INK}" stroke-width="3"/>`),
  );
}

/** 刘海（灵动岛）120×28，放在外框顶部居中 y=24 处 */
function phoneNotch(): Frag {
  return frag(`<rect x="10" y="4" width="100" height="20" rx="10" fill="#2b2638"/><circle cx="92" cy="14" r="4" fill="#3d4a6a"/><circle cx="91" cy="13" r="1.4" fill="#8fb0d6"/>`);
}

/** 群聊标题栏 128×64，九宫格：左右 36、上 34、下 12。顶部圆角与屏幕一致。 */
function chatHeader(): Frag {
  const d = 'M0 34Q0 0 34 0H94Q128 0 128 34V60H0Z';
  return merge(
    frag(`<path d="${d}" fill="#ffd36b"/>`),
    frag(`<path d="M0 58H128" stroke="${INK}" stroke-width="3"/><path d="M0 62H128" stroke="${darken('#ffd36b', 0.2)}" stroke-width="3"/>`),
    frag(hiArc('M20 20Q30 10 50 10', 3, 0.5)),
  );
}

/** 聊天背景平铺 96×96：淡淡的小涂鸦（金币、星星、韭菜、箭头），透明底 */
function chatBgTile(): Frag {
  const c = '#f1e1c6';
  return frag(
    `<g fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
      `<circle cx="18" cy="18" r="8"/><path d="M15 18h6M18 15v6"/>` +
      `<path d="${starD(70, 22, 7)}"/>` +
      `<path d="M58 70q-4 -12 2 -20M64 70q0 -12 6 -18M70 70q4 -10 12 -12"/>` +
      `<path d="M14 80l10 -10 6 6 12 -12M36 64h6v6"/>` +
      `<path d="${sparkleD(46, 44, 5)}"/>` +
      `</g>`,
  );
}

/**
 * 消息气泡 64×48：群友（左，白色，尾巴在左上）/ 自己或系统（右，暖黄，尾巴在右上）。
 * 九宫格：尾巴一侧 20px，另一侧 16px，上 22px，下 16px。内容区内边距建议 左右 18 / 上下 10。
 */
function bubble(side: 'left' | 'right', fill: string): Frag {
  const d = 'M8 14Q8 4 18 4H50Q60 4 60 14V34Q60 44 50 44H18Q8 44 8 34V22L1 12Q5 13 8 14Z';
  const body = merge(
    frag(`<path d="${d}" transform="translate(1.5 3)" fill="${INK}" fill-opacity="0.18"/>`),
    shape(d, { fill, shade: darken(fill, 0.06), shadeOffset: [-2, -3], sw: 2.8 }),
    frag(hiArc('M16 9H30', 2.4, 0.7)),
  );
  if (side === 'left') return body;
  return frag(`<g transform="translate(64 0) scale(-1 1)">${body.content}</g>`, body.defs);
}

/**
 * 推荐卡片 96×96：白卡 + 题材色顶条（顶条为白色，运行时可着色成题材色；或直接用默认橙）。
 * 九宫格四角 24px。建议布局：左侧 64px 放股票小人，右侧写名字、推荐理由，底部放买入按钮。
 */
function bubbleCard(): Frag {
  const d = rrectD(3, 3, 90, 88, 16);
  return merge(
    frag(`<path d="${d}" transform="translate(2 4)" fill="${INK}" fill-opacity="0.2"/>`),
    shape(d, {
      fill: '#fffdf7',
      shade: '#f3ebdc',
      shadeOffset: [-3, -3],
      sw: 3,
      extra: `<path d="M3 19Q3 3 19 3H77Q93 3 93 19V20H3Z" fill="#ff9a5a"/><path d="M3 20H93" stroke="${INK}" stroke-width="2.6"/>` +
        `<rect x="10" y="28" width="76" height="56" rx="10" fill="none" stroke="#efe2cc" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`,
    }),
    frag(`<circle cx="14" cy="11.5" r="3" fill="${WHITE}"/><circle cx="24" cy="11.5" r="3" fill="${WHITE}" fill-opacity="0.7"/><circle cx="34" cy="11.5" r="3" fill="${WHITE}" fill-opacity="0.45"/>`),
  );
}

/** 系统提示条 96×28（"老王 撤回了一条消息"之类），九宫格左右 14px */
function systemPill(): Frag {
  return frag(`<rect x="1" y="1" width="94" height="26" rx="13" fill="#e9d9bf" fill-opacity="0.9"/>`);
}

export function build(write: (rel: string, data: string) => void): number {
  const list: [string, number, number, Frag][] = [
    ['phone_frame', 360, 720, phoneFrame()],
    ['phone_notch', 120, 28, phoneNotch()],
    ['chat_header', 128, 64, chatHeader()],
    ['chat_bg_tile', 96, 96, chatBgTile()],
    ['bubble_left', 64, 48, bubble('left', '#fffdf7')],
    ['bubble_right', 64, 48, bubble('right', '#ffe28a')],
    ['bubble_card', 96, 96, bubbleCard()],
    ['system_pill', 96, 28, systemPill()],
  ];
  for (const [name, w, h, f] of list) write(`chat/${name}.svg`, svgDoc(w, h, f));
  return list.length;
}
