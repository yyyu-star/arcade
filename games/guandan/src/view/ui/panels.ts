/** 设置、战绩、规则、确认框：标题页和牌桌共用的弹窗。 */
import Phaser from 'phaser';
import { DEFAULT_OPTIONS, makeCard } from '../../core/index.ts';
import { app } from '../app.ts';
import { levelName } from '../labels.ts';
import { audio } from '../audio.ts';
import { getSettings, getStats, setTutorialDone, updateSettings, type Settings } from '../store.ts';
import { COLOR, TYPE, css } from '../theme.ts';
import { Button, modal, segmented, text, type Modal } from './kit.ts';
import { PATTERNS, miniCards, patternTile } from './patterns.ts';

export function applyAudio(s: Settings = getSettings()): void {
  audio.apply({ volume: s.volume, music: s.music, muted: s.muted });
}

export function openSettings(scene: Phaser.Scene, opts: { onTutorial?: () => void; onClose?: () => void } = {}): Modal {
  const m = modal(scene, 860, 660, '设置', { onClose: opts.onClose });
  const b = m.body;
  const s = getSettings();
  const rowX = -360;
  let y = -220;
  const row = (label: string): void => {
    b.add(text(scene, rowX, y, label, { size: TYPE.body, bold: true, ox: 0 }));
  };
  const segX = -120;
  const vol = s.muted ? '0' : s.volume <= 0.4 ? '0.35' : s.volume <= 0.7 ? '0.65' : '1';
  row('音量');
  b.add(segmented(scene, segX, y, [
    { label: '静音', value: '0' }, { label: '小', value: '0.35' }, { label: '中', value: '0.65' }, { label: '大', value: '1' },
  ], vol, (v) => {
    const n = Number(v);
    applyAudio(updateSettings(n === 0 ? { muted: true } : { muted: false, volume: n }));
    if (n > 0) audio.sfx('play');
  }));
  y += 60;
  row('背景音');
  b.add(segmented(scene, segX, y, [{ label: '开', value: '1' }, { label: '关', value: '0' }], s.music ? '1' : '0', (v) => applyAudio(updateSettings({ music: v === '1' }))));
  y += 60;
  row('动画速度');
  b.add(segmented(scene, segX, y, [{ label: '慢', value: 'slow' }, { label: '中', value: 'normal' }, { label: '快', value: 'fast' }], s.speed, (v) => updateSettings({ speed: v as Settings['speed'] })));
  y += 60;
  row('电脑难度');
  b.add(segmented(scene, segX, y, [{ label: '简单', value: 'easy' }, { label: '普通', value: 'normal' }, { label: '较强', value: 'good' }, { label: '困难', value: 'hard' }], s.difficulty, (v) => {
    updateSettings({ difficulty: v as Settings['difficulty'] });
    if (app.session) app.session.difficulty = v as Settings['difficulty'];
  }));
  y += 60;
  row('牌背');
  b.add(segmented(scene, segX, y, [{ label: '红', value: '0' }, { label: '绿', value: '1' }], String(s.back), (v) => updateSettings({ back: Number(v) as 0 | 1 })));
  y += 60;
  // 别人（好友房的人、单机的电脑）的嘲讽、表情、道具：关掉就不看也不听，单机的电脑也不发（自己照样能发）
  row('嘲讽和道具');
  b.add(segmented(scene, segX, y, [{ label: '看', value: '1' }, { label: '不看', value: '0' }], s.taunts ? '1' : '0', (v) => updateSettings({ taunts: v === '1' })));
  y += 66;
  // 地方规则：下一局生效
  b.add(text(scene, rowX, y, '地方规则', { size: TYPE.body, bold: true, ox: 0, color: COLOR.red }));
  b.add(text(scene, rowX + 110, y, '新开一局时生效', { size: TYPE.small, color: COLOR.muted, ox: 0 }));
  y += 48;
  const rules = { ...DEFAULT_OPTIONS, ...s.rules };
  const setRule = (patch: Partial<Settings['rules']>): void => {
    updateSettings({ rules: { ...getSettings().rules, ...patch } });
  };
  b.add(text(scene, rowX, y, '三带二能带一对王', { size: TYPE.label, ox: 0 }));
  b.add(segmented(scene, 130, y, [{ label: '能', value: '1' }, { label: '不能', value: '0' }], rules.fullHouseJokerPair ? '1' : '0', (v) => setRule({ fullHouseJokerPair: v === '1' }), 92));
  y += 52;
  b.add(text(scene, rowX, y, '打 A 没过几次退回打 2', { size: TYPE.label, ox: 0 }));
  b.add(segmented(scene, 130, y, [{ label: '3 次', value: '3' }, { label: '不退', value: '0' }], String(rules.aFailLimit === 0 ? 0 : 3), (v) => setRule({ aFailLimit: Number(v) }), 92));
  y += 52;
  b.add(text(scene, rowX, y, '双下两人合计两张大王抗贡', { size: TYPE.label, ox: 0 }));
  b.add(segmented(scene, 130, y, [{ label: '算', value: '1' }, { label: '不算', value: '0' }], rules.antiTributeCombined ? '1' : '0', (v) => setRule({ antiTributeCombined: v === '1' }), 92));
  // 右下：重看引导
  const tb = new Button(scene, 280, 20, 180, 50, '重看引导', 'wood', () => {
    setTutorialDone(false);
    m.close();
    opts.onTutorial?.();
  }, 'restart');
  b.add(tb);
  return m;
}

export function openStats(scene: Phaser.Scene): Modal {
  const m = modal(scene, 640, 440, '战绩');
  const st = getStats();
  const rate = st.games > 0 ? Math.round((st.wins / st.games) * 100) : 0;
  const cells: [string, string, number][] = [
    ['局数', String(st.games), COLOR.ink],
    ['胜率', st.games > 0 ? `${rate}%` : '—', COLOR.red],
    ['最高连胜', String(st.bestStreak), COLOR.goldDark],
    ['当前连胜', String(st.streak), COLOR.ink],
    ['打过副数', String(st.deals), COLOR.ink],
    ['拿头游', String(st.firsts), COLOR.red],
  ];
  cells.forEach(([label, val, color], i) => {
    const x = -190 + (i % 3) * 190;
    const y = -70 + Math.floor(i / 3) * 150;
    const g = scene.add.graphics();
    g.fillStyle(0xf3e6c9, 1).fillRoundedRect(x - 80, y - 58, 160, 120, 14);
    g.lineStyle(2, 0xd8c39a, 1).strokeRoundedRect(x - 80, y - 58, 160, 120, 14);
    m.body.add(g);
    m.body.add(text(scene, x, y - 12, val, { size: TYPE.big + 4, bold: true, color, font: 'num' }));
    m.body.add(text(scene, x, y + 38, label, { size: TYPE.label, color: COLOR.muted }));
  });
  return m;
}

/** onClose：不管点哪个按钮，关掉时都会调（牌桌靠它把 overlay 清掉，不然人和电脑都不再出牌） */
export function confirm(scene: Phaser.Scene, msg: string, okLabel: string, onOk: () => void, onClose?: () => void): Modal {
  const m = modal(scene, 560, 280, undefined, { closeBtn: false, onClose });
  m.body.add(text(scene, 0, -50, msg, { size: TYPE.title, bold: true, wrap: 460 }));
  const cancel = new Button(scene, -120, 70, 180, 58, '算了', 'wood', () => m.close());
  m.body.add(cancel);
  m.body.setData('cancel', cancel);
  const ok = new Button(scene, 120, 70, 180, 58, okLabel, 'red', () => {
    m.close();
    onOk();
  });
  m.body.add(ok);
  // 调试桥 / 冒烟按这个找"确定"
  m.body.setData('ok', ok);
  return m;
}

/** 规则页：三页（牌型 / 大小 / 怎么打），全部用图示，文字只做标注。level：牌桌上打开时传本副级数，例子跟着变；标题页没有牌局，用 7 举例。 */
export function openRules(scene: Phaser.Scene, onClose?: () => void, level?: number): Modal {
  const m = modal(scene, 1200, 640, '规则', { onClose });
  const b = m.body;
  const page = scene.add.container(0, 0);
  b.add(page);
  const tabs = ['牌型', '谁大', '怎么打'];
  let cur = 0;
  const tabBtns: Button[] = [];
  const show = (i: number): void => {
    cur = i;
    page.removeAll(true);
    tabBtns.forEach((t, j) => t.setAlpha(j === cur ? 1 : 0.62));
    if (i === 0) pagePatterns(scene, page, level);
    else if (i === 1) pageOrder(scene, page, level);
    else pageFlow(scene, page);
  };
  tabs.forEach((t, i) => {
    const btn = new Button(scene, -170 + i * 170, -248, 150, 48, t, i === 0 ? 'red' : 'red', () => show(i));
    tabBtns.push(btn);
    b.add(btn);
  });
  show(0);
  return m;
}

/** 举例用的级数和说法："本副打 J" 或 "比如打 7 时" */
function levelExample(level: number | undefined): { lv: number; when: string } {
  if (level === undefined) return { lv: 7, when: '比如打 7 时' };
  return { lv: level, when: `本副打 ${levelName(level)}` };
}

function pagePatterns(scene: Phaser.Scene, page: Phaser.GameObjects.Container, level?: number): void {
  const { lv, when } = levelExample(level);
  PATTERNS.forEach((p, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = -405 + col * 270;
    const y = -130 + row * 128;
    page.add(patternTile(scene, x, y, p, 254));
  });
  // 第三行剩两格：逢人配说明
  const wx = 135 + 135;
  const g = scene.add.graphics();
  g.fillStyle(0xfff0d0, 1).fillRoundedRect(wx - 262, 68, 524, 116, 12);
  g.lineStyle(2.5, COLOR.gold, 1).strokeRoundedRect(wx - 262, 68, 524, 116, 12);
  page.add(g);
  page.add(miniCards(scene, wx - 210, 126, [makeCard(lv, 1)], 52, 0, lv));
  page.add(text(scene, wx - 160, 98, '逢人配：红桃级牌', { size: TYPE.body, bold: true, color: COLOR.red, ox: 0 }));
  page.add(text(scene, wx - 160, 144, `万能牌，能当除王以外的任何牌\n（${when}，就是红桃 ${levelName(lv)}）`, { size: TYPE.small, color: COLOR.ink, ox: 0, align: 'left' }));
}

function pageOrder(scene: Phaser.Scene, page: Phaser.GameObjects.Container, level?: number): void {
  const { lv, when } = levelExample(level);
  // 单张大小：大王 > 小王 > 级牌 > A > K … > 2（级牌从原位置拿掉，例子里不重复出现）
  page.add(text(scene, -520, -180, '单张大小', { size: TYPE.title, bold: true, ox: 0, color: COLOR.red }));
  page.add(text(scene, -520, -146, when, { size: TYPE.small, color: COLOR.muted, ox: 0 }));
  const rest = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].filter((r) => r !== lv);
  const picks = [rest[0]!, rest[1]!, rest[2]!, rest[4]!, rest[rest.length - 4]!, rest[rest.length - 1]!];
  const order = [makeCard(17, 0), makeCard(16, 0), makeCard(lv, 0), ...picks.map((r, i) => makeCard(r, [2, 3, 0, 1, 2, 3][i]!))];
  order.forEach((c, i) => {
    page.add(miniCards(scene, -330 + i * 92, -150, [c], 56, 0, lv));
    if (i < order.length - 1) page.add(text(scene, -330 + i * 92 + 46, -150, i === 6 ? '…' : '>', { size: TYPE.title, bold: true, color: COLOR.muted }));
  });
  page.add(text(scene, -330 + 2 * 92, -92, '级牌', { size: TYPE.small, bold: true, color: COLOR.goldDark }));

  // 炸弹梯子
  page.add(text(scene, -520, -30, '炸弹谁大', { size: TYPE.title, bold: true, ox: 0, color: COLOR.red }));
  page.add(text(scene, -520, 4, '炸弹能压任何普通牌型', { size: TYPE.small, color: COLOR.muted, ox: 0 }));
  const ladder = ['4 张', '5 张', '同花顺', '6 张', '7 张', '8 张', '9 张', '10 张', '天王炸'];
  ladder.forEach((l, i) => {
    const x = -330 + i * 104;
    const h = 30 + i * 13;
    const g = scene.add.graphics();
    const col = i === ladder.length - 1 ? COLOR.gold : i === 2 ? 0xd2603a : COLOR.red;
    g.fillStyle(col, 1).fillRoundedRect(x - 42, 110 - h, 84, h, 8);
    page.add(g);
    page.add(text(scene, x, 110 - h - 18, l, { size: TYPE.label, bold: true, color: i === ladder.length - 1 ? COLOR.goldDark : COLOR.ink }));
  });
  page.add(text(scene, -40, 150, '小  →  大', { size: TYPE.body, bold: true, color: COLOR.muted }));

  page.add(text(scene, -520, 200, '其他牌型：同牌型、同张数才能比，比点数', { size: TYPE.label, color: COLOR.ink, ox: 0 }));
  page.add(text(scene, -520, 232, '顺子里 A 可当 1 也可当 14，级牌按本来的位置', { size: TYPE.label, color: COLOR.ink, ox: 0 }));
}

function pageFlow(scene: Phaser.Scene, page: Phaser.GameObjects.Container): void {
  const items: [string, string, string][] = [
    ['组队', '你和对面的小美一队', 'cards'],
    ['出牌', '压过上家，或者不要；都不要时最后出牌的人再出', 'play'],
    ['接风', '有人出完了，大家都不要时由他的队友接着出', 'restart'],
    ['名次', '先出完的是头游，然后二游、三游、末游', 'crown'],
    ['升级', '头游那队升级：队友二游 +3，三游 +2，末游 +1', 'stats'],
    ['进贡', '末游把最大的牌给头游，头游还一张 10 以下的；两张大王可以抗贡', 'back'],
    ['打 A', '打 A 时拿头游、队友不是末游才算过 A，整局获胜', 'check'],
  ];
  items.forEach(([t, d, icon], i) => {
    const y = -170 + i * 64;
    const g = scene.add.graphics();
    g.fillStyle(i % 2 ? 0xf6ebd3 : 0xefe0c0, 1).fillRoundedRect(-540, y - 28, 1080, 56, 10);
    page.add(g);
    const ic = scene.add.image(-505, y, `icon:${icon}`).setDisplaySize(34, 34).setTint(COLOR.red);
    page.add(ic);
    page.add(text(scene, -470, y, t, { size: TYPE.body, bold: true, color: COLOR.red, ox: 0 }));
    page.add(text(scene, -360, y, d, { size: TYPE.label, color: COLOR.ink, ox: 0 }));
  });
}

export { css };
