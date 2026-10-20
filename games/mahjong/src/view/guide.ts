/**
 * 新手引导和规则（DESIGN.md 第 7 节）：第一次打开弹三屏，番型表随时能在"规则"里看。
 * 0.17.5（docs/art-v3.md 第 7 节 ⑤b）：规则是一本宣纸小册子，分四页签（怎么胡 / 番型 / 血战规矩 / 电脑公平吗），番型带一手牌例；引导每屏配一排示意的牌
 */
import { button, el } from './dom.ts';
import { closeDialog, dialog } from './dialog.ts';
import { tileName, tileUrl } from './tiles.ts';
import { FAN_TABLE, FAN_NAME } from './text.ts';
import { DEFAULT_VARIANT } from '../core/variants/index.ts';
import { YAKU_NAME, type YakuId } from '../core/variants/riichi/index.ts';
import type { FanId } from '../core/variants/sichuan-xuezhan/index.ts';

export const GUIDE_KEY = 'mahjong.guide';
const RC = 'riichi';

/** 新手引导看过没有的记号：每个玩法一个（川麻的沿用原来的键） */
export const guideKey = (variant: string): string => (variant === RC ? `${GUIDE_KEY}.rc` : GUIDE_KEY);

/**
 * 牌的种类：0–8 一到九万，9–17 一到九筒，18–26 一到九条，27–33 东南西北白发中；加 100 是赤五。
 * 一手牌写成几组，组和组之间空开
 */
type Groups = number[][];
const W = (...n: number[]): number[] => n.map((x) => x - 1);
const T = (...n: number[]): number[] => n.map((x) => x + 8);
const S = (...n: number[]): number[] => n.map((x) => x + 17);
/** 字牌：1 东 2 南 3 西 4 北 5 白 6 发 7 中 */
const Z = (...n: number[]): number[] => n.map((x) => x + 26);
const RED5 = (suit: 'w' | 't' | 's'): number => (suit === 'w' ? 4 : suit === 't' ? 13 : 22) + 100;

/** 一排小牌（示意用，和结算里的小牌一样大），组与组之间留空 */
function tilesRow(parent: HTMLElement, groups: Groups, cls = ''): void {
  const row = el('div', `ex ${cls}`, parent);
  for (const g of groups) {
    const box = el('span', 'group', row);
    for (const k of g) {
      const red = k >= 100;
      const kind = red ? k - 100 : k;
      const t = el('span', 'mini', box);
      t.style.backgroundImage = `url("${tileUrl(kind, red)}")`;
      t.title = tileName(kind, red);
    }
  }
}

const PAGES: [string, string[], Groups][] = [
  ['怎么胡', ['手里 14 张凑成 4 组（三张顺子或三张一样）加 1 对，就胡了。', '七个对子也能胡。', '别人打的牌能"碰"（你有一对）、"杠"（你有三张），不能吃。'], [W(1, 2, 3), W(4, 5, 6), T(7, 8, 9), T(2, 3, 4), S(5, 5)]],
  ['换三张、定缺', ['开局先挑三张同一门的牌换给别人。', '再定一门"缺"：这门牌一张都不要，先打干净才能胡。', '万、筒、条，只留两门。'], [S(2, 5, 9)]],
  ['血战到底', ['有人胡了不算完，剩下的人接着打，直到三家胡了或者牌摸完。', '杠当场收钱：刮风（明杠）、下雨（暗杠）。', '牌摸完了还没胡：手里还有缺门的（花猪）、没听牌的要赔钱。'], [T(5, 5, 5, 5)]],
];

/** 立直的引导：怎么和、立直、必须有役、振听 */
const RC_PAGES: [string, string[], Groups][] = [
  ['怎么和', ['手里 14 张凑成 4 组（三张顺子或三张一样）加 1 对，就和了。七个对子、十三种幺九牌也能和。', '别人打的牌：只能吃上家的，碰、杠谁都行；点数不用算，打完一局会列清楚。'], [W(1, 2, 3), T(4, 5, 6), S(7, 8, 9), W(2, 3, 4), Z(1, 1)]],
  ['立直', ['没吃碰的时候，手里 13 张只差一张就和了，可以喊"立直"：放 1,000 点的棒，之后只能摸什么打什么。', '立直本身 1 番，和牌后还会翻开"里宝牌"，多赚几番。'], [W(1, 2, 3), W(4, 5, 6), T(7, 8, 9), S(2, 3), Z(1, 1)]],
  ['必须有役', ['光凑齐了不能和，还要有至少一个"役"：立直、断幺九（没有 1、9 和字牌）、役牌（白发中、自己的风）……', '宝牌只加番，不算役；赤宝牌（红五）也一样。'], [W(2, 3, 4), T(3, 4, 5), S(6, 7, 8), T(5, 5), [RED5('w'), RED5('t'), RED5('s')]]],
  ['振听', ['自己打过的牌里有你要和的牌，就不能荣和（和别人打的牌），只能自摸。', '放过一次可以和的牌，到你下次摸牌前也不能荣和；立直以后放过，这一局都不能。提示条会写"振听：只能自摸"。'], [W(1, 2, 3), T(4, 5, 6), S(7, 8, 9), Z(5, 5), W(4, 7)]],
];

export function showGuide(parent: HTMLElement, page = 0, onDone?: () => void, variant: string = DEFAULT_VARIANT): void {
  const pages = variant === RC ? RC_PAGES : PAGES;
  dialog(parent, `guide${variant === RC ? ' rc-guide' : ''}`, (box) => {
    const [title, lines, ex] = pages[page]!;
    el('div', 'step', box, `${page + 1} / ${pages.length}`);
    el('h2', '', box, title);
    tilesRow(box, ex, page === 1 ? 'swap' : '');
    for (const l of lines) el('p', '', box, l);
    const row = el('div', 'row', box);
    if (page < pages.length - 1) button('act go', row, '下一页', () => showGuide(parent, page + 1, onDone, variant));
    else
      button('act go', row, '开打', () => {
        closeDialog();
        try {
          localStorage.setItem(guideKey(variant), '1');
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

type Tab = '怎么胡' | '番型' | '血战规矩' | '电脑公平吗' | '怎么和' | '役种' | '立直和振听';
const TABS: Tab[] = ['怎么胡', '番型', '血战规矩', '电脑公平吗'];
const RC_TABS: Tab[] = ['怎么和', '役种', '立直和振听', '电脑公平吗'];

export function showRules(parent: HTMLElement, tab?: Tab, variant: string = DEFAULT_VARIANT): void {
  const rc = variant === RC;
  const tabsOf = rc ? RC_TABS : TABS;
  const at: Tab = tab && tabsOf.includes(tab) ? tab : tabsOf[1]!;
  dialog(parent, `rules${rc ? ' rc-guide' : ''}`, (box) => {
    const tabs = el('div', 'tabs', box);
    tabs.setAttribute('role', 'tablist');
    for (const t of tabsOf) {
      const b = button(`tab${t === at ? ' on' : ''}`, tabs, t, () => showRules(parent, t, variant));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === at));
    }
    const page = el('div', 'page', box);
    if (rc) rcPage(page, at);
    else if (at === '怎么胡') {
      el('h2', '', page, '怎么胡');
      tilesRow(page, PAGES[0]![2]);
      for (const l of PAGES[0]![1]) el('p', '', page, l);
      el('h2', '', page, '换三张、定缺');
      for (const l of PAGES[1]![1]) el('p', '', page, l);
    } else if (at === '番型') {
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
    } else if (at === '血战规矩') {
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
    button('act soft', box, '再看一遍新手说明', () => showGuide(parent, 0, undefined, variant));
  });
}

/** 立直的役种表：名字、番数（副露减番的写在括号里）、一句话；有的配一手牌例。只写字和程序画的牌面 */
const RC_YAKU: [YakuId | string, string, string, Groups?][] = [
  ['riichi', '1', '没吃碰、听牌时宣告，放 1,000 点棒'],
  ['ippatsu', '1', '立直后一巡内和牌'],
  ['tsumo', '1', '没吃碰，自己摸到和牌'],
  ['pinfu', '1', '四组全是顺子、对子不是役牌、两头听', [W(2, 3, 4), W(5, 6, 7), T(2, 3, 4), S(6, 7, 8), T(9, 9)]],
  ['tanyao', '1', '全是 2 到 8 的数牌，吃碰也行', [W(2, 3, 4), T(3, 4, 5), S(6, 7, 8), S(4, 5, 6), W(5, 5)]],
  ['iipeikou', '1', '没吃碰，有两组一模一样的顺子', [W(2, 3, 4), W(2, 3, 4), T(5, 6, 7)]],
  ['yakuhai', '1', '白、发、中，或者场风、自风的三张一样', [Z(5, 5, 5), Z(6, 6, 6), Z(7, 7, 7)]],
  ['rinshan', '1', '杠完补的牌正好自摸'],
  ['chankan', '1', '别人加杠的那张，你正好和'],
  ['haitei', '1', '摸最后一张自摸；和最后一张打出的牌也是 1 番'],
  ['double_riichi', '2', '第一巡就立直'],
  ['chiitoi', '2', '七个不同的对子', [W(1, 1), W(3, 3), T(5, 5), T(8, 8), S(2, 2), Z(1, 1), Z(7, 7)]],
  ['sanshoku', '2（吃碰 1）', '万筒索各有一组同样数字的顺子', [W(3, 4, 5), T(3, 4, 5), S(3, 4, 5)]],
  ['ittsu', '2（吃碰 1）', '同一门里 123、456、789 三组', [W(1, 2, 3), W(4, 5, 6), W(7, 8, 9)]],
  ['chanta', '2（吃碰 1）', '每组和对子都带 1、9 或字牌，有顺子', [W(1, 2, 3), T(7, 8, 9), Z(1, 1, 1), S(1, 1)]],
  ['toitoi', '2', '四组全是三张一样的', [W(2, 2, 2), T(5, 5, 5), S(8, 8, 8), Z(3, 3, 3), W(9, 9)]],
  ['sanankou', '2', '三组没吃碰、自己摸齐的三张一样'],
  ['sanshoku_pon', '2', '万筒索各有一组同样数字的三张一样'],
  ['sankantsu', '2', '开了三个杠'],
  ['shousangen', '2', '白发中里两组三张一样、一组对子'],
  ['honroutou', '2', '全是 1、9 和字牌'],
  ['ryanpeikou', '3', '没吃碰，有两对一模一样的顺子', [W(2, 3, 4), W(2, 3, 4), T(5, 6, 7), T(5, 6, 7), S(9, 9)]],
  ['junchan', '3（吃碰 2）', '每组和对子都带 1 或 9，没有字牌', [W(1, 2, 3), T(7, 8, 9), S(1, 2, 3), W(9, 9, 9), T(1, 1)]],
  ['honitsu', '3（吃碰 2）', '只有一门数牌加字牌', [W(1, 2, 3), W(5, 6, 7), W(9, 9, 9), Z(7, 7, 7), Z(1, 1)]],
  ['chinitsu', '6（吃碰 5）', '全是同一门数牌', [W(1, 1, 1), W(2, 3, 4), W(5, 6, 7), W(8, 8, 8), W(9, 9)]],
];
const RC_YAKUMAN: [YakuId, string, Groups?][] = [
  ['kokushi', '十三种幺九牌各一张，再加其中一张当对子', [W(1, 9), T(1, 9), S(1, 9), Z(1, 2, 3, 4, 5, 6, 7), W(1)]],
  ['daisangen', '白、发、中各一组三张一样', [Z(5, 5, 5), Z(6, 6, 6), Z(7, 7, 7)]],
  ['suuankou', '四组没吃碰、自己摸齐的三张一样'],
  ['shousuushii', '风牌里三组三张一样、一组对子'],
  ['daisuushii', '东南西北四组三张一样'],
  ['tsuuiisou', '全是字牌', [Z(1, 1, 1), Z(3, 3, 3), Z(5, 5, 5), Z(7, 7, 7), Z(2, 2)]],
  ['ryuuiisou', '全是绿色的牌（2、3、4、6、8 条和发）'],
  ['chinroutou', '全是 1、9 的数牌'],
  ['chuuren', '一门里 1112345678999 再加一张'],
  ['suukantsu', '开了四个杠'],
  ['tenhou', '庄家起手就和'],
  ['chiihou', '子家第一次摸牌就自摸'],
];

function rcPage(page: HTMLElement, tab: Tab): void {
  if (tab === '怎么和') {
    el('h2', '', page, '怎么和');
    tilesRow(page, RC_PAGES[0]![2]);
    for (const l of RC_PAGES[0]![1]) el('p', '', page, l);
    el('h2', '', page, '一场怎么打');
    el('p', '', page, '每人 25,000 点起，打东风局和南风局（东风战只打东风局）。庄家连着和牌或流局时听牌，就连庄、本场加一。有人点数低于 0 就提前结束。');
    el('p', '', page, '打完按点数排名：加上顺位马（+20、+10、−10、−20），第一名再拿头名奖，和 30,000 点比出"得分"，换成筹码。');
    el('h2', '', page, '宝牌');
    tilesRow(page, [[RED5('w'), RED5('t'), RED5('s')]]);
    el('p', '', page, '宝牌指示牌翻开的那张，下一个数的牌就是宝牌；赤宝牌是三张红五（5 万、5 筒、5 条各一张）；立直和牌后翻开里宝牌。每张宝牌 1 番，但不算役。');
  } else if (tab === '役种') {
    el('p', 'note', page, '番数越多点数越高：5 番起是满贯，6–7 番跳满，8–10 番倍满，11–12 番三倍满，13 番起算役满。括号里是吃碰过的番数。');
    const table = el('table', '', page);
    for (const [id, han, desc, ex] of RC_YAKU) {
      const tr = el('tr', '', table);
      el('td', 'n', tr, id === 'yakuhai' ? '役牌' : YAKU_NAME[id as YakuId]);
      el('td', 'f', tr, `${han} 番`);
      const d = el('td', 'd', tr, desc);
      if (ex) tilesRow(d, ex);
    }
    el('h2', '', page, '役满');
    const big = el('table', '', page);
    for (const [id, desc, ex] of RC_YAKUMAN) {
      const tr = el('tr', '', big);
      el('td', 'n', tr, YAKU_NAME[id]);
      el('td', 'f', tr, '役满');
      const d = el('td', 'd', tr, desc);
      if (ex) tilesRow(d, ex);
    }
  } else if (tab === '立直和振听') {
    el('h2', '', page, '立直');
    tilesRow(page, RC_PAGES[1]![2]);
    for (const l of RC_PAGES[1]![1]) el('p', '', page, l);
    el('p', '', page, '立直的条件：没吃碰（暗杠可以）、听牌、手里至少 1,000 点、牌墙还剩 4 张以上。喊立直打出的那张横放；要是正好被人和了，立直不成立，不扣棒。');
    el('h2', '', page, '必须有役');
    for (const l of RC_PAGES[2]![1]) el('p', '', page, l);
    el('h2', '', page, '振听');
    tilesRow(page, RC_PAGES[3]![2]);
    for (const l of RC_PAGES[3]![1]) el('p', '', page, l);
    el('p', '', page, '三种原因：舍张（自己打过要和的牌）、同巡（放过一张要和的牌）、立直后（立直后放过）。');
  } else {
    el('h2', '', page, '电脑公平吗');
    el('p', '', page, '电脑和你一样看不到别人的牌：它只知道自己的手牌和桌上打出来、鸣出来的牌，牌墙也不知道。每局打完，和了、听牌的人把牌亮出来，可以对一对。');
    el('p', '', page, '牌河里变暗的牌，是被人吃、碰、杠走或者和走的。');
  }
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
