import Phaser from 'phaser';
import { getSettings, onSettingsChange, updateSettings, type AnimSpeed, type ColorScheme, type Settings } from '../../platform/settings.ts';
import { COLOR } from '../theme.ts';
import { Button } from './button.ts';
import { Dialog } from './dialog.ts';
import { Slider } from './slider.ts';
import { addText } from './text.ts';
import { loadTutorial, setTutorialOn, tutorialActive } from '../tutorial.ts';
import { HINT_AUTO_RUNS, hintsOn, loadViewPrefs, saveViewPrefs } from '../meta/prefs.ts';
import { phoneLayout } from '../viewport.ts';

interface SettingsPanelOpts {
  /** 游戏内打开时提供「返回主菜单」 */
  onMenu?: () => void;
  /** 游戏内打开时提供「回大厅」（0.5.8：对局中回平台首页，齿轮 → 回大厅两步）；点了关闭时 onClosed 的 lobby 为 true */
  lobby?: boolean;
  /** URL 参数指定了动画速度（自动化），设置里的选择暂不生效 */
  animLocked: boolean;
  /** 关闭时回调；schemeChanged 表示涨跌配色变了，需要重建画面；lobby 表示是点「回大厅」关的 */
  onClosed?: (schemeChanged: boolean, lobby: boolean) => void;
  /** 档案里玩过几局（新手提示「自动」时按它判断） */
  runs?: number;
  /** 0.6.0 实盘局里多一个「提前收手」（点了关掉设置再调它，由它去问一次） */
  onQuitLive?: () => void;
}

const W = 1000;
const H = 560;
/** 两栏：左边声音和画面，右边帮助类开关 */
const COLS = [
  { label: 32, ctrl: 160 },
  { label: 524, ctrl: 664 },
];
const ROW = 50;

/**
 * 手机横屏（960×444）：两栏叠不下说明小字，改成两个页签（声音画面 / 提示节奏），每页一栏，
 * 说明小字放在同一行按钮的右边。
 */
const PHONE_UI = { w: 940, h: 430, label: 32, ctrl: 150, row: [46, 52], note: [520, 386] } as const;

const SPEEDS: [AnimSpeed, string][] = [
  [0, '关闭'],
  [1, '1×'],
  [2, '2×'],
  [4, '4×'],
];
const SCHEMES: [ColorScheme, string][] = [
  ['cn', '红涨绿跌'],
  ['intl', '绿涨红跌'],
];

/**
 * 设置面板（两栏）：左边音量、静音、动画速度、涨跌配色；右边减少动态效果、新手教程、新手提示、收盘小结。修改即时保存。
 */
export class SettingsPanel extends Dialog {
  private readonly groups: { refresh: (s: Settings) => void }[] = [];
  /** 控件加到哪里：电脑上是 inner；手机上是当前页签的容器 */
  private box: Phaser.GameObjects.Container;
  private readonly phone: boolean;

  constructor(scene: Phaser.Scene, opts: SettingsPanelOpts) {
    const startScheme = getSettings().colorScheme;
    const phone = phoneLayout(scene);
    let toLobby = false;
    super(scene, phone ? PHONE_UI.w : W, phone ? PHONE_UI.h : H, '设置', () => opts.onClosed?.(getSettings().colorScheme !== startScheme, toLobby));
    this.phone = phone;
    this.box = this.inner;
    const pages = phone ? [scene.add.container(0, 0), scene.add.container(0, 0)] : [];
    if (phone) {
      this.inner.add(pages);
      this.box = pages[0]!;
      this.tabs(pages);
    }
    let col: { label: number; ctrl: number } = phone ? PHONE_UI : COLS[0]!;
    let page = 0;
    // 0.18.1 手机第一页有七行（0.17.0 加了「月底账单」），对局里底下还有「回到主菜单」「回大厅」：从 88 起、音量三行收到 38，最后一行的按钮底边 359，不再压到底下按钮（顶边 370）
    let y = phone ? 88 : 96;
    let lastAt = y;
    const row = (label: string, pitch?: number): number => {
      this.box.add(addText(scene, col.label, y, label, { size: 15, color: COLOR.muted, originY: 0.5 }));
      const at = y;
      lastAt = at;
      y += pitch ?? (phone ? PHONE_UI.row[page]! : ROW);
      return at;
    };
    const note = (text: string): Phaser.GameObjects.Text => {
      if (phone) {
        // 手机：写在上一行按钮的右边，不另占一行
        const nx = PHONE_UI.note[page]!;
        const t = addText(scene, nx, lastAt, text, { size: 13, color: COLOR.muted, wrap: PHONE_UI.w - nx - 32, originY: 0.5, lineSpacing: 2 });
        this.box.add(t);
        return t;
      }
      const t = addText(scene, col.ctrl, y - 24, text, { size: 12, color: COLOR.muted, wrap: W / 2 - (col.ctrl - col.label) - 48 });
      this.box.add(t);
      y += Math.max(16, t.height) - 4;
      return t;
    };

    const volume = (label: string, field: 'masterVolume' | 'sfxVolume' | 'musicVolume'): void => {
      const at = row(label, phone ? 38 : undefined);
      const pct = addText(scene, col.ctrl + 300, at, '', { size: 15, num: true, originY: 0.5 });
      const slider = new Slider(scene, col.ctrl, at, 280, getSettings()[field], (v) => updateSettings({ [field]: v }));
      this.box.add([slider, pct]);
      this.groups.push({ refresh: (s) => pct.setText(`${Math.round(s[field] * 100)}%`) });
    };
    volume('主音量', 'masterVolume');
    volume('音效', 'sfxVolume');
    volume('音乐', 'musicVolume');

    this.choice(col.ctrl, row('静音'), [[true, '开启'], [false, '关闭']], (s) => s.muted, (v) => updateSettings({ muted: v }));

    this.choice(col.ctrl, row('动画速度'), SPEEDS, (s) => s.animSpeed, (v) => updateSettings({ animSpeed: v }));
    if (opts.animLocked) note('现在由网址里的 anim / speed 控制，正常打开游戏时这里的设置才生效');
    this.choice(col.ctrl, row('涨跌配色'), SCHEMES, (s) => s.colorScheme, (v) => updateSettings({ colorScheme: v }));
    // 0.17.0 月底账单：舞台（每月不到 2 秒，点一下跳过）/ 简短（直接出账单和章）
    const billAt = row('月底账单');
    const bb = (
      [
        ['stage', '完整'],
        ['quick', '简短'],
      ] as const
    ).map(([mode, label], i) => {
      const b = new Button(scene, col.ctrl + i * 108, billAt - this.btnH / 2, { width: 100, height: this.btnH, label, fontSize: 14, sound: 'select' });
      b.setHandler(() => {
        saveViewPrefs({ bill: mode });
        for (const x of bb) x.b.setSelected(x.mode === mode);
      });
      this.box.add(b);
      this.named[`settings:bill-${mode}`] = b;
      return { mode, b };
    });
    for (const x of bb) x.b.setSelected(x.mode === loadViewPrefs().bill);
    note('月底账单一张张算给你看（每月不到 2 秒，点一下就跳过）；简短就直接出结果');

    col = phone ? PHONE_UI : COLS[1]!;
    y = 96;
    if (phone) {
      page = 1;
      this.box = pages[1]!;
    }
    this.choice(col.ctrl, row('减少动态效果'), [[true, '开启'], [false, '关闭']], (s) => s.reduceMotion, (v) => updateSettings({ reduceMotion: v }));
    note('打开后不震屏、不闪电、不放烟花，小人也不再摇来摇去');
    y += 10;

    // 新手教程：开启 = 从头再看一遍；关闭 = 不再出现（进度记在本地）
    const tButtons = this.pair(col.ctrl, row('新手教程'), 'tutorial', (on) => {
      setTutorialOn(on);
      refreshHelp();
    });
    const tNote = note('');
    y += 10;

    // 新手提示：开盘前猫说一句（前 3 局默认打开）
    const hButtons = this.pair(col.ctrl, row('新手提示'), 'hints', (on) => {
      saveViewPrefs({ hints: on ? 'on' : 'off' });
      refreshHelp();
    });
    const hNote = note('');
    y += 10;

    // 收盘小结：完整 / 只看总账
    const recapAt = row('收盘小结');
    const rb = (
      [
        ['full', '完整'],
        ['brief', '只看总账'],
      ] as const
    ).map(([mode, label], i) => {
      const b = new Button(scene, col.ctrl + i * 108, recapAt - this.btnH / 2, { width: 100, height: this.btnH, label, fontSize: 14, sound: 'select' });
      b.setHandler(() => {
        saveViewPrefs({ recap: mode });
        refreshHelp();
      });
      this.box.add(b);
      this.named[`settings:recap-${mode}`] = b;
      return { mode, b };
    });
    note('每天收盘后讲讲今天赚亏从哪来；也可以只看一句总账');
    y += 6;

    // 0.5：没什么事的日子自动快进
    const qAt = row('平淡日');
    const qb = (
      [
        [true, '自动快进'],
        [false, '手动'],
      ] as const
    ).map(([on, label], i) => {
      const b = new Button(scene, col.ctrl + i * 108, qAt - this.btnH / 2, { width: 100, height: this.btnH, label, fontSize: 14, sound: 'select' });
      b.setHandler(() => {
        saveViewPrefs({ autoQuiet: on });
        refreshHelp();
      });
      this.box.add(b);
      this.named[`settings:quiet-${on ? 'auto' : 'manual'}`] = b;
      return { on, b };
    });
    note('没什么事的日子自动翻过去，碰到大涨大跌、事件、目标变化就停下（手动时按 F 快进）');

    const runs = opts.runs ?? 0;
    const refreshHelp = (): void => {
      const p = loadTutorial();
      const active = tutorialActive(p);
      for (const { on, b } of tButtons) b.setSelected(on === active);
      tNote.setText(active ? (p.done.length > 0 ? `已经看过 ${p.done.length} 步，剩下的到时候会冒出来` : '第一局里会一步步冒出来') : '点「开启」可以从头再看一遍');
      const vp = loadViewPrefs();
      const hon = hintsOn(vp, runs);
      for (const { on, b } of hButtons) b.setSelected(on === hon);
      hNote.setText(vp.hints === 'auto' ? `开盘前，猫会根据看板说一句建议（前 ${HINT_AUTO_RUNS} 局自动打开）` : '开盘前，猫会根据看板说一句建议（它也是猜的）');
      for (const { mode, b } of rb) b.setSelected(mode === vp.recap);
      for (const { on, b } of qb) b.setSelected(on === vp.autoQuiet);
    };
    refreshHelp();

    const close = new Button(scene, this.dw - 32 - 130, this.dh - 64, { width: 130, height: 44, label: '完成', variant: 'primary', fontSize: 16 });
    close.setHandler(() => this.close());
    this.inner.add(close);
    this.named['settings:done'] = close;
    if (opts.onMenu) {
      const onMenu = opts.onMenu;
      const menu = new Button(scene, COLS[0]!.label, this.dh - 60, { width: 150, height: 40, label: '回到主菜单', fontSize: 15 });
      menu.setHandler(() => {
        this.close();
        onMenu();
      });
      this.inner.add(menu);
      this.named['settings:menu'] = menu;
    }
    if (opts.lobby) {
      const lobby = new Button(scene, COLS[0]!.label + (opts.onMenu ? 162 : 0), this.dh - 60, { width: 120, height: 40, label: '回大厅', icon: 'house', fontSize: 15 });
      lobby.setHandler(() => {
        toLobby = true;
        this.close();
      });
      this.inner.add(lobby);
      this.named['settings:lobby'] = lobby;
    }
    if (opts.onQuitLive) {
      const onQuit = opts.onQuitLive;
      const quit = new Button(scene, COLS[0]!.label + (opts.onMenu ? 162 : 0) + (opts.lobby ? 132 : 0), this.dh - 60, { width: 120, height: 40, label: '提前收手', fontSize: 15 });
      // 先告诉调用方是收手关的，再关：关的时候 onClosed 是同步调的，要能认出来不去重建画面
      quit.setHandler(() => {
        onQuit();
        this.close();
      });
      this.inner.add(quit);
      this.named['settings:quit-live'] = quit;
    }

    const refresh = (s: Settings): void => {
      for (const g of this.groups) g.refresh(s);
    };
    refresh(getSettings());
    // 设置变化时刷新（包括本面板自己的修改）
    const off = onSettingsChange(refresh);
    this.once(Phaser.GameObjects.Events.DESTROY, () => off());
  }

  /** 选项按钮的高：手机上抬到 38，手指点得到 */
  private get btnH(): number {
    return this.phone ? 38 : 34;
  }

  /** 手机：标题右边两个页签，切换两页（命名 settings:tab-0 / settings:tab-1）。 */
  private tabs(pages: Phaser.GameObjects.Container[]): void {
    const labels = ['声音画面', '提示节奏'];
    const buttons = labels.map((label, i) => {
      const b = new Button(this.scene, 112 + i * 128, 16, { width: 120, height: 40, label, fontSize: 15, sound: 'select' });
      b.setHandler(() => show(i));
      this.inner.add(b);
      this.named[`settings:tab-${i}`] = b;
      return b;
    });
    const show = (i: number): void => {
      pages.forEach((p, k) => p.setVisible(k === i));
      buttons.forEach((b, k) => b.setSelected(k === i));
    };
    show(0);
  }

  /** 手机上另一页签里的按钮看不见、点不到：不交给自动化（先点 settings:tab-N 换页）。 */
  override controls(): Record<string, { x: number; y: number }> {
    const out = super.controls();
    for (const [k, b] of Object.entries(this.named)) {
      const parent = (b as unknown as Phaser.GameObjects.Container).parentContainer;
      if (parent && parent !== this.inner && !parent.visible) delete out[k];
    }
    return out;
  }

  /** 开启 / 关闭一对按钮（命名 settings:<name>-on / -off）。 */
  private pair(x: number, y: number, name: string, set: (on: boolean) => void): { on: boolean; b: Button }[] {
    return (
      [
        [true, '开启'],
        [false, '关闭'],
      ] as const
    ).map(([on, label], i) => {
      const b = new Button(this.scene, x + i * 88, y - this.btnH / 2, { width: 80, height: this.btnH, label, fontSize: 14, sound: 'toggle' });
      b.setHandler(() => set(on));
      this.box.add(b);
      this.named[`settings:${name}-${on ? 'on' : 'off'}`] = b;
      return { on, b };
    });
  }

  /** 一组单选按钮。 */
  private choice<T>(x: number, y: number, options: [T, string][], get: (s: Settings) => T, set: (v: T) => void): void {
    const bw = 80;
    const buttons = options.map(([value, label], i) => {
      const b = new Button(this.scene, x + i * (bw + 8), y - this.btnH / 2, { width: bw, height: this.btnH, label, fontSize: 14, sound: 'select' });
      b.setHandler(() => set(value));
      this.box.add(b);
      return { value, b };
    });
    this.groups.push({ refresh: (s) => buttons.forEach(({ value, b }) => b.setSelected(value === get(s))) });
  }
}
