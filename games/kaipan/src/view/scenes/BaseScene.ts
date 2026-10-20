import Phaser from 'phaser';
import { liveValue, type GameEvent, type GameState } from '../../core/index.ts';
import { Animator } from '../fx/anim.ts';
import type { Rect } from '../rect.ts';
import { randomSeed, type Presenter, type SceneKey, type Session } from '../session.ts';
import { applyCamera, type PhoneReady } from '../viewport.ts';
import { AboutPanel } from '../ui/aboutPanel.ts';
import { OVERLAY_FLAG, type Dialog } from '../ui/dialog.ts';
import { ConfirmDialog, NoticeDialog } from '../ui/noticeDialog.ts';
import { SettingsPanel } from '../ui/settingsPanel.ts';
import { HelpPanel } from '../meta/helpPanel.ts';
import { ensureMetaArt, metaArtReady } from '../assets.ts';
import { loadViewPrefs } from '../meta/prefs.ts';
import { standalone } from '../../platform/mode.ts';
import { loadProfile } from '../../platform/profile.ts';
import { goLobby } from '../lobby.ts';
import { lobbyConfirm, live, livePlaying } from '../live.ts';
import { quitConfirm } from '../liveText.ts';

/** 场景切换的淡入淡出时长 */
const FADE_MS = 180;

/**
 * 按渲染倍数设置相机，画布按实际像素绘制。
 * 手机上世界尺寸见 theme.ts 的 phoneWorld（高 404，宽 718–960）：适配过手机的场景（phoneReady）直接按这个尺寸布局；
 * 还按 1280×720 布局的场景整体缩小、居中放进来（和以前在手机上看到的一样大）。
 */
export function setupCamera(scene: Phaser.Scene, phoneReady: PhoneReady = false): void {
  applyCamera(scene, phoneReady);
}

/** 场景的公共部分：相机、动画节拍器、键盘、与 Session 的对接、继续等待、点击跳过。 */
export abstract class BaseScene extends Phaser.Scene implements Presenter {
  readonly viewKey: SceneKey;
  /** 这个场景有没有手机横屏的布局（没有时整体缩小放进手机的世界里） */
  protected readonly phoneReady: PhoneReady = false;
  protected readonly session: Session;
  protected anim!: Animator;
  private resume: (() => void) | null = null;
  private dialog: Dialog | null = null;

  constructor(key: SceneKey, session: Session) {
    super(key);
    this.viewKey = key;
    this.session = session;
  }

  /** 环境小动画是否开启（减少动态效果或关闭动画时关掉）。 */
  protected get lively(): boolean {
    return this.session.opts.anim && !this.session.opts.reduceMotion;
  }

  create(): void {
    setupCamera(this, this.phoneReady);
    this.anim = new Animator(this, this.session.opts);
    this.resume = null;
    this.dialog = null;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.anim.dispose();
      this.teardown();
    });
    this.data.set(OVERLAY_FLAG, false);
    this.data.set('calm', !this.lively);
    this.build();
    this.render(this.session.state);
    this.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (e: KeyboardEvent) => {
      if (e.repeat || this.data.get(OVERLAY_FLAG)) return;
      if (this.onKey(e)) e.preventDefault();
    });
    // 点击画面任意处跳过正在播放的动画（点在按钮上的由按钮自己处理）
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!this.data.get(OVERLAY_FLAG) && this.anim.playing) this.anim.hurry();
    });
    if (this.session.opts.anim) this.cameras.main.fadeIn(FADE_MS, 243, 226, 199);
    this.session.attach(this);
  }

  /** 创建静态界面元素。 */
  protected abstract build(): void;
  /** 按状态刷新整个画面（无动画）。 */
  protected abstract render(s: GameState): void;
  /** 场景关闭时的收尾（计时器等）。 */
  protected teardown(): void {}

  /** 键盘：返回 true 表示已处理。 */
  protected onKey(_e: KeyboardEvent): boolean {
    return false;
  }

  present(_prev: GameState, next: GameState, _events: GameEvent[]): Promise<void> {
    this.render(next);
    return Promise.resolve();
  }

  enter(_events: GameEvent[]): Promise<void> {
    return Promise.resolve();
  }

  leave(): Promise<void> {
    if (!this.session.opts.anim) return Promise.resolve();
    return new Promise((resolve) => {
      const cam = this.cameras.main;
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => resolve());
      cam.fadeOut(FADE_MS, 243, 226, 199);
    });
  }

  abort(): void {
    this.anim.abort();
  }

  skip(): boolean {
    if (!this.anim.playing) return false;
    this.anim.hurry();
    return true;
  }

  awaitingInput(): boolean {
    return this.resume !== null;
  }

  continueInput(): boolean {
    const fn = this.resume;
    if (!fn) return false;
    fn();
    return true;
  }

  controls(): Record<string, { x: number; y: number }> {
    return {};
  }

  regions(): Record<string, Rect> {
    return {};
  }

  /** 等玩家点继续（不会自动继续）。 */
  protected async waitContinue(): Promise<void> {
    const w = this.anim.waitInput();
    this.resume = w.trigger;
    this.session.notify();
    try {
      await w.promise;
    } finally {
      this.resume = null;
    }
  }

  protected startNewRun(): void {
    this.session.newRun(randomSeed());
  }

  /** 打开设置；游戏内额外提供「返回主菜单」。切换涨跌配色、动画设置后关闭时重建画面。 */
  protected openSettings(inGame: boolean): void {
    if (this.data.get(OVERLAY_FLAG)) return;
    const before = JSON.stringify(this.session.opts);
    const prefsBefore = JSON.stringify(loadViewPrefs());
    let quitting = false;
    this.dialog = new SettingsPanel(this, {
      animLocked: this.session.animLocked,
      runs: loadProfile().profile.runs,
      onMenu: inGame ? () => this.session.toTitle() : undefined,
      // 单独部署没有大厅，回首页就是「回到主菜单」，不重复放一个
      lobby: inGame && !standalone(),
      onQuitLive: inGame && this.session.liveOk && livePlaying(this.session.state) ? () => {
        quitting = true;
        // 设置框关掉后下一帧才放开对话框标记，确认框等它放开再开
        this.whenFree(() => this.askQuitLive());
      } : undefined,
      onClosed: (schemeChanged, lobby) => {
        if (quitting) return;
        const prefsChanged = JSON.stringify(loadViewPrefs()) !== prefsBefore;
        const redraw = schemeChanged || prefsChanged || JSON.stringify(this.session.opts) !== before;
        if (!lobby) {
          if (redraw) this.session.redraw();
          return;
        }
        // 一局里回大厅先确认一次。改过设置要重建画面的，等取消了再重建：先重建的话场景换了，排在旧场景上的确认框就丢了。
        // 设置框关掉后下一帧才放开对话框标记，确认框等它放开再开
        const c = lobbyConfirm(this.session.state);
        this.time.delayedCall(1, () =>
          this.openConfirm(c.title, c.body, c.ok, () => goLobby(), () => {
            if (redraw) this.session.redraw();
          }),
        );
      },
    });
  }

  /** 0.9.2 对局里左上角的「大厅」：先确认一次（和设置里「回大厅」同一个确认框），确认了才走 */
  protected askLobby(): void {
    if (this.dialogOpen) return;
    const c = lobbyConfirm(this.session.state);
    this.openConfirm(c.title, c.body, c.ok, () => goLobby());
  }

  /** 等前一个对话框的标记放开（关掉后下一帧才放）再做，最多等 20 次（约 0.3 秒） */
  protected whenFree(fn: () => void, tries = 20): void {
    this.time.delayedCall(16, () => {
      if (!this.sys.isActive()) return;
      if (this.dialogOpen && tries > 0) this.whenFree(fn, tries - 1);
      else fn();
    });
  }

  /** 实盘「提前收手」：先确认一次（还没开盘是原样退回，开盘以后按现在的资产结），确认了就结、回开始菜单。 */
  protected askQuitLive(): void {
    const s = this.session.state;
    const r = live.record;
    if (!r || !this.session.liveOk || !livePlaying(s)) return;
    const c = quitConfirm(s.dayIndex === 0, r.stake, liveValue(s) ?? 0);
    this.openConfirm(c.title, c.body, c.ok, () => void this.session.quitLive());
  }

  /** 登记一个已经打开的对话框（自动化通过 dialogControls 找它的按钮）。 */
  protected trackDialog(d: Dialog): void {
    this.dialog = d;
  }

  /** 当前是否有对话框开着。 */
  protected get dialogOpen(): boolean {
    return !!this.data.get(OVERLAY_FLAG);
  }

  protected openNotice(title: string, body: string): void {
    if (!this.data.get(OVERLAY_FLAG)) this.dialog = new NoticeDialog(this, title, body);
  }

  protected openConfirm(title: string, body: string, ok: string, onOk: () => void, onCancel?: () => void): void {
    if (!this.data.get(OVERLAY_FLAG)) this.dialog = new ConfirmDialog(this, title, body, ok, onOk, onCancel);
  }

  /** 「怎么玩」说明书。插图在 meta 图集里：没好就先等它（最多 1.5 秒），等不到也照样打开（用示意图）。 */
  protected openHelp(onClosed?: () => void): void {
    if (this.data.get(OVERLAY_FLAG) || this.helpOpening) return;
    const open = (): void => {
      this.helpOpening = false;
      if (!this.sys.isActive() || this.data.get(OVERLAY_FLAG)) return;
      this.dialog = new HelpPanel(this, onClosed);
    };
    if (metaArtReady(this.textures)) return open();
    this.helpOpening = true;
    void Promise.race([ensureMetaArt(this.textures), new Promise<void>((r) => setTimeout(r, 1500))]).then(open);
  }

  private helpOpening = false;

  protected openAbout(): void {
    if (!this.data.get(OVERLAY_FLAG)) this.dialog = new AboutPanel(this);
  }

  /** 打开着的对话框的控件；没有对话框时返回 null。 */
  dialogControls(): Record<string, { x: number; y: number }> | null {
    return this.dialog && !this.dialog.isClosed ? this.dialog.controls() : null;
  }
}
