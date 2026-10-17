/** 新手引导和规则（DESIGN.md 第 7 节）：第一次打开弹三屏，番型表随时能在"规则"里看 */
import { button, el } from './dom.ts';
import { closeDialog, dialog } from './dialog.ts';
import { FAN_TABLE, FAN_NAME } from './text.ts';

export const GUIDE_KEY = 'mahjong.guide';

const PAGES: [string, string[]][] = [
  ['怎么胡', ['手里 14 张凑成 4 组（三张顺子或三张一样）加 1 对，就胡了。', '七个对子也能胡。', '别人打的牌能"碰"（你有一对）、"杠"（你有三张），不能吃。']],
  ['换三张、定缺', ['开局先挑三张同一门的牌换给别人。', '再定一门"缺"：这门牌一张都不要，先打干净才能胡。', '万、筒、条，只留两门。']],
  ['血战到底', ['有人胡了不算完，剩下的人接着打，直到三家胡了或者牌摸完。', '杠当场收钱：刮风（明杠）、下雨（暗杠）。', '牌摸完了还没胡：手里还有缺门的（花猪）、没听牌的要赔钱。']],
];

export function showGuide(parent: HTMLElement, page = 0, onDone?: () => void): void {
  dialog(parent, 'guide', (box) => {
    const [title, lines] = PAGES[page]!;
    el('div', 'step', box, `${page + 1} / ${PAGES.length}`);
    el('h2', '', box, title);
    for (const l of lines) el('p', '', box, l);
    const row = el('div', 'row', box);
    if (page < PAGES.length - 1) button('act go', row, '下一页', () => showGuide(parent, page + 1, onDone));
    else
      button('act go', row, '开打', () => {
        closeDialog();
        try {
          localStorage.setItem(GUIDE_KEY, '1');
        } catch {
          // 存不上下次再看一遍
        }
        onDone?.();
      });
  });
}

export function showRules(parent: HTMLElement): void {
  dialog(parent, 'rules', (box) => {
    // 电脑不看牌（DESIGN.md 5.4 的测试）玩家看不见，写在最上面；一局结束的结算里亮出所有人的牌，自己能对
    el('h2', '', box, '电脑公平吗');
    el('p', '', box, '电脑和你一样看不到别人的牌：它只知道自己的手牌和桌上打出来、碰杠亮出来的牌，牌墙也不知道。每局打完，结算里亮出所有人的牌，可以对一对。');
    el('p', '', box, '牌河里变暗的牌，是被人碰走、杠走或者胡走的。');
    el('h2', '', box, '番型表');
    el('p', 'note', box, '一把 = 底分 × 2 的番数次方，番数相加，到封顶为止。自摸每家多付一个底分。');
    const t = el('table', '', box);
    for (const [id, fan, desc] of FAN_TABLE) {
      const tr = el('tr', '', t);
      el('td', 'n', tr, FAN_NAME[id]);
      el('td', 'f', tr, fan);
      el('td', 'd', tr, desc);
    }
    el('h2', '', box, '刮风下雨');
    el('p', '', box, '直杠：点杠的人付 2 倍底分；补杠：没胡的每家付 1 倍；暗杠：没胡的每家付 2 倍。杠完打出去被胡（杠上炮），杠钱转给胡的人（呼叫转移）。');
    el('h2', '', box, '牌摸完了');
    el('p', '', box, '花猪（手里还有缺门）赔每家封顶；没听牌的赔听牌的人他能胡的最大番；没听牌的人杠钱退回（退税）。');
    button('act soft', box, '再看一遍新手说明', () => showGuide(parent));
  });
}

/** 竖屏第一次进牌桌：提示一句"横过来玩更舒服"（竖屏手牌每张只有二十几像素），3 秒自己消失，只出一次 */
export const ROTATE_KEY = 'mahjong.hint.rotate';
const ROTATE_MS = 3_000;

export function rotateTip(stage: HTMLElement): void {
  if (stage.dataset.orient !== 'port') return;
  try {
    if (localStorage.getItem(ROTATE_KEY)) return;
    localStorage.setItem(ROTATE_KEY, '1');
  } catch {
    return;
  }
  const tip = el('div', 'rotate-tip', stage);
  tip.setAttribute('role', 'status');
  // 一部手机从竖着转到横着，旁边一道弧形箭头
  tip.innerHTML =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="16" y="6" width="16" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M10 30a16 16 0 0 0 20 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M27 37l4 5-6 2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el('span', '', tip, '横过来玩更舒服');
  window.setTimeout(() => tip.remove(), ROTATE_MS);
}
