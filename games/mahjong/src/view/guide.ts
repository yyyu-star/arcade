/**
 * 新手引导和规则（DESIGN.md 第 7 节）：第一次打开弹三屏，番型表随时能在"规则"里看。
 * 0.17.5（docs/art-v3.md 第 7 节 ⑤b）：规则是一本宣纸小册子，分四页签（怎么胡 / 番型 / 血战规矩 / 电脑公平吗），番型带一手牌例；引导每屏配一排示意的牌
 */
import { button, el } from './dom.ts';
import { closeDialog, dialog } from './dialog.ts';
import { tileName, tileUrl } from './tiles.ts';
import { FAN_TABLE, FAN_NAME } from './text.ts';
import type { FanId } from '../core/variants/sichuan-xuezhan/index.ts';

export const GUIDE_KEY = 'mahjong.guide';

/** 牌的种类：0–8 一到九万，9–17 一到九筒，18–26 一到九条。一手牌写成几组，组和组之间空开 */
type Groups = number[][];
const W = (...n: number[]): number[] => n.map((x) => x - 1);
const T = (...n: number[]): number[] => n.map((x) => x + 8);
const S = (...n: number[]): number[] => n.map((x) => x + 17);

/** 一排小牌（示意用，和结算里的小牌一样大），组与组之间留空 */
function tilesRow(parent: HTMLElement, groups: Groups, cls = ''): void {
  const row = el('div', `ex ${cls}`, parent);
  for (const g of groups) {
    const box = el('span', 'group', row);
    for (const k of g) {
      const t = el('span', 'mini', box);
      t.style.backgroundImage = `url("${tileUrl(k)}")`;
      t.title = tileName(k);
    }
  }
}

const PAGES: [string, string[], Groups][] = [
  ['怎么胡', ['手里 14 张凑成 4 组（三张顺子或三张一样）加 1 对，就胡了。', '七个对子也能胡。', '别人打的牌能"碰"（你有一对）、"杠"（你有三张），不能吃。'], [W(1, 2, 3), W(4, 5, 6), T(7, 8, 9), T(2, 3, 4), S(5, 5)]],
  ['换三张、定缺', ['开局先挑三张同一门的牌换给别人。', '再定一门"缺"：这门牌一张都不要，先打干净才能胡。', '万、筒、条，只留两门。'], [S(2, 5, 9)]],
  ['血战到底', ['有人胡了不算完，剩下的人接着打，直到三家胡了或者牌摸完。', '杠当场收钱：刮风（明杠）、下雨（暗杠）。', '牌摸完了还没胡：手里还有缺门的（花猪）、没听牌的要赔钱。'], [T(5, 5, 5, 5)]],
];

export function showGuide(parent: HTMLElement, page = 0, onDone?: () => void): void {
  dialog(parent, 'guide', (box) => {
    const [title, lines, ex] = PAGES[page]!;
    el('div', 'step', box, `${page + 1} / ${PAGES.length}`);
    el('h2', '', box, title);
    tilesRow(box, ex, page === 1 ? 'swap' : '');
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

/** 番型的一手牌例；按时机算的番（杠上开花、海底这些）没有牌例 */
const FAN_EXAMPLE: Partial<Record<FanId, Groups>> = {
  ping: [W(1, 2, 3), W(4, 5, 6), T(7, 8, 9), T(2, 3, 4), S(5, 5)],
  pengpeng: [W(1, 1, 1), W(5, 5, 5), T(3, 3, 3), T(7, 7, 7), S(2, 2)],
  qing: [W(1, 2, 3), W(3, 4, 5), W(6, 7, 8), W(9, 9, 9), W(5, 5)],
  qidui: [W(1, 1), W(3, 3), W(6, 6), T(2, 2), T(5, 5), T(8, 8), T(9, 9)],
  longqidui: [W(1, 1, 1, 1), W(3, 3), W(6, 6), T(2, 2), T(5, 5), T(8, 8)],
  jiangdui: [W(2, 2, 2), W(5, 5, 5), T(2, 2, 2), T(5, 5, 5), T(8, 8)],
  yaojiu: [W(1, 2, 3), W(7, 8, 9), T(1, 2, 3), T(7, 8, 9), W(9, 9)],
  jingou: [W(1, 1, 1), W(5, 5, 5), T(3, 3, 3), T(7, 7, 7), S(2)],
  gen: [W(6, 6, 6, 6)],
};

type Tab = '怎么胡' | '番型' | '血战规矩' | '电脑公平吗';
const TABS: Tab[] = ['怎么胡', '番型', '血战规矩', '电脑公平吗'];

export function showRules(parent: HTMLElement, tab: Tab = '番型'): void {
  dialog(parent, 'rules', (box) => {
    const tabs = el('div', 'tabs', box);
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = button(`tab${t === tab ? ' on' : ''}`, tabs, t, () => showRules(parent, t));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === tab));
    }
    const page = el('div', 'page', box);
    if (tab === '怎么胡') {
      el('h2', '', page, '怎么胡');
      tilesRow(page, PAGES[0]![2]);
      for (const l of PAGES[0]![1]) el('p', '', page, l);
      el('h2', '', page, '换三张、定缺');
      for (const l of PAGES[1]![1]) el('p', '', page, l);
    } else if (tab === '番型') {
      el('p', 'note', page, '一把 = 底分 × 2 的番数次方，番数相加，到封顶为止。自摸每家多付一个底分。');
      const table = el('table', '', page);
      for (const [id, fan, desc] of FAN_TABLE) {
        const tr = el('tr', '', table);
        el('td', 'n', tr, FAN_NAME[id]);
        el('td', 'f', tr, fan === '封顶' || fan.startsWith('+') ? fan : `${fan} 番`);
        const d = el('td', 'd', tr, desc);
        const ex = FAN_EXAMPLE[id];
        if (ex) tilesRow(d, ex);
      }
    } else if (tab === '血战规矩') {
      el('h2', '', page, '血战到底');
      for (const l of PAGES[2]![1]) el('p', '', page, l);
      el('h2', '', page, '刮风下雨');
      el('p', '', page, '直杠：点杠的人付 2 倍底分；补杠：没胡的每家付 1 倍；暗杠：没胡的每家付 2 倍。杠完打出去被胡（杠上炮），杠钱转给胡的人（呼叫转移）。');
      el('h2', '', page, '牌摸完了');
      el('p', '', page, '花猪（手里还有缺门）赔每家封顶；没听牌的赔听牌的人他能胡的最大番；没听牌的人杠钱退回（退税）。');
    } else {
      // 电脑不看牌（DESIGN.md 5.4 的测试）玩家看不见，单独一页写明；一局结束的结算里亮出所有人的牌，自己能对
      el('h2', '', page, '电脑公平吗');
      el('p', '', page, '电脑和你一样看不到别人的牌：它只知道自己的手牌和桌上打出来、碰杠亮出来的牌，牌墙也不知道。每局打完，结算里亮出所有人的牌，可以对一对。');
      el('p', '', page, '牌河里变暗的牌，是被人碰走、杠走或者胡走的。');
    }
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
