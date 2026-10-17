import type Phaser from 'phaser';
import { createRun, dailySegmentId, dispatch, isDailyRun, liveMultipleBp, runSummary, type Action, type GameEvent, type GameState, type Phase, type RunSetup, type Segment } from '../core/index.ts';
import { segmentFor, showBanner } from './segments.ts';
import { challengeRecordFor, submitChallengeEnd } from './challenge.ts';
import { learnKnowledge, loadProfile, recordRun, saveProfile, type RecordResult } from '../platform/profile.ts';
import { clearSave, writeSave } from '../platform/storage.ts';
import { hasLoginHint } from '../platform/cloud.ts';
import { submitRun, warmBoardUser } from './dailyBoard.ts';
import { live, liveOnState, livePlaying, liveStatsOf } from './live.ts';
import { dailyDate } from './labels.ts';
import { isUnscored, markUnscored, unscoredResult } from './meta/prefs.ts';
import type { ViewOptions } from './options.ts';
import type { Rect } from './rect.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './theme.ts';

export type SceneKey = 'title' | 'trade' | 'end';

/** 盘前、月度奖励、事件都在交易主场景里；结束后进结束页。 */
function sceneFor(phase: Phase): Exclude<SceneKey, 'title'> {
  return phase === 'won' || phase === 'lost' ? 'end' : 'trade';
}

/** 场景实现的表现接口：Session 只通过它驱动画面。 */
export interface Presenter {
  readonly viewKey: SceneKey;
  /** 播放 prev → next 的过渡；若 next 仍属于本场景，结束时画面应停在 next。 */
  present(prev: GameState, next: GameState, events: GameEvent[]): Promise<void>;
  /** 切换进本场景后的开场表现。 */
  enter(events: GameEvent[]): Promise<void>;
  /** 离开前的淡出。 */
  leave(): Promise<void>;
  /** 放行当前表现的一切等待（含「等继续」）。 */
  abort(): void;
  awaitingInput(): boolean;
  /** 触发继续；没有在等待时返回 false。 */
  continueInput(): boolean;
  /** 主要控件的中心点（自动化点击用） */
  controls(): Record<string, { x: number; y: number }>;
  /** 命名区域（引导、截图用） */
  regions(): Record<string, Rect>;
  /** 跳过正在播放的动画（点击 / 空格同款）；没有动画时返回 false */
  skip(): boolean;
  /** 打开着的对话框（设置、关于）的控件；没有时为 null */
  dialogControls(): Record<string, { x: number; y: number }> | null;
}

export function randomSeed(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => n.toString(36)).join('').slice(0, 10);
}

/**
 * 一局游戏的会话：持有唯一的 GameState，所有操作（界面点击、键盘与自动化脚本）
 * 都经 dispatch 进入 core，再把事件交给当前场景按顺序播放。
 */
export class Session {
  readonly opts: ViewOptions;
  state: GameState;
  /** 最近一次 dispatch（或开局）产生的事件 */
  events: GameEvent[];
  /** 首屏完成 */
  ready = false;
  /** 启动时读档的提示（旧版本存档 / 存档损坏），开始菜单显示一次后清空 */
  notice: 'legacy' | 'corrupt' | null = null;
  /** ?debug=1：浮层显示隐藏信息，这个会话里的局都不计入档案 */
  debugSession = false;
  /** 启动时档案读坏了（已备份并重建），开始菜单提示一次 */
  profileNotice = false;
  /** 是否写存档（也决定结束时是否记档案） */
  persist = true;
  /** 能不能动实盘的账：调试会话（看得到隐藏信息）、不写存档的会话（URL 开局）都不碰真实的筹码 */
  get liveOk(): boolean {
    return this.persist && !this.debugSession;
  }
  /** 本局结束时记档案的结果，按 runId 缓存：重建结束页不会重复记，也不会丢掉「新纪录」标记 */
  private recorded: { runId: string; result: RecordResult | null } | null = null;
  private unlocksShown = '';
  /** URL 参数锁定了动画速度（设置面板里提示） */
  animLocked = false;
  /** 素材加载进度 0..1（加载场景更新） */
  bootProgress = 0;
  /** 启动耗时（毫秒，从页面开始加载到首屏可操作） */
  bootMs = 0;

  private game: Phaser.Game | null = null;
  private current: Presenter | null = null;
  private onAttach: ((p: Presenter) => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  /** 排队中（含正在播放）的表现数 */
  private running = 0;
  private readonly listeners = new Set<() => void>();

  constructor(initial: GameState, events: GameEvent[], opts: ViewOptions) {
    this.state = initial;
    this.events = events;
    this.opts = opts;
  }

  /** 素材加载完成后调用：进入开始菜单，或（调试参数）直接进入当前局面。 */
  boot(game: Phaser.Game, toTitle: boolean): void {
    this.game = game;
    // 读到的存档已经结束（上次停在最后的账单上就关了页面）：补记一次
    this.settle();
    this.warmBoard();
    this.enqueue(async () => {
      const p = await this.switchTo(toTitle ? 'title' : sceneFor(this.state.phase));
      this.ready = true;
      this.bootMs = Math.round(performance.now());
      await p.enter(this.events);
    });
  }

  /**
   * 本局结束时记进档案（每局只记一次，结果按 runId 缓存）：recordRun(loadProfile().profile, runSummary(state), 今天) → saveProfile。
   * 状态一进入 won / lost 就由 settle() 调用（不等结束页），启动时读到已结束的存档也补记一次（recordRun 自己会去重）。
   * 调试局（URL 开局参数、?debug=1、不写存档的会话）不计入，result.ignored 为 'debug'。
   */
  recordEnd(): RecordResult | null {
    const sum = runSummary(this.state);
    if (this.recorded?.runId === sum.runId) return this.recorded.result;
    let result: RecordResult;
    {
      const profile = loadProfile().profile;
      if (!this.persist || this.debugSession || isUnscored(this.state)) result = unscoredResult(profile);
      else {
        // 0.13.0 好友挑战的局照每日挑战的规矩记（人设、难度可以没解锁，不解锁、不记最好成绩）
        result = recordRun(profile, sum, dailyDate(), { challenge: challengeRecordFor(sum.seed) !== null });
        if (!result.ignored && !saveProfile(result.profile)) console.warn('档案写入失败（存储已满或不可用）');
      }
    }
    this.recorded = { runId: sum.runId, result };
    // 每日挑战交一次分（不能上榜的局只记个原因给结束页）
    submitRun(sum.runId, this.state, sum, result, dailyDate());
    // 好友挑战的局交成绩（计入了档案的才交：调试会话里开的不算）
    if (!result.ignored) submitChallengeEnd(this.state, sum);
    return result;
  }

  /** 第一次触发某个新机制（learned 事件）：立刻点亮图鉴里的小知识并写进档案（调试局不记）。 */
  private learn(events: readonly GameEvent[]): void {
    const ids = events.flatMap((e) => (e.type === 'learned' ? [e.id] : []));
    if (ids.length === 0 || !this.persist || this.debugSession || isUnscored(this.state)) return;
    const r = learnKnowledge(loadProfile().profile, ids);
    if (r.added.length > 0 && !saveProfile(r.profile)) console.warn('档案写入失败（存储已满或不可用）');
  }

  /** 局面一结束（won / lost）立即记档案、实盘局结回：玩家停在最后的账单上刷新、关页面或回主菜单都不会丢。 */
  private settle(): void {
    if (this.state.phase === 'won' || this.state.phase === 'lost') this.recordEnd();
    // 实盘局一结束就结回筹码（调试会话、不写存档的会话碰不到实盘）
    if (this.liveOk) liveOnState(this.state);
  }

  private revealShown = '';

  /** 结束页的行情揭晓每局自动弹一次（之后点按钮再看）。 */
  takeReveal(runId: string): boolean {
    if (this.revealShown === runId) return false;
    this.revealShown = runId;
    return true;
  }

  /** 结束页的达成 / 解锁弹窗每局只弹一次（重建结束页不再弹）。 */
  takeUnlocks<T>(runId: string, list: T[]): T[] {
    if (this.unlocksShown === runId) return [];
    this.unlocksShown = runId;
    return list;
  }

  /** 从开始菜单进入当前这局。 */
  enterGame(): void {
    this.enqueue(async () => {
      const p = await this.switchTo(sceneFor(this.state.phase));
      await p.enter([]);
    });
  }

  /**
   * 实盘「提前收手」（设计稿 2.3）：第一个交易日还没开盘就原样退回（refund），开盘以后按现在的资产结；
   * 结完（或连不上、记成待结）就清掉这局的存档、回开始菜单，开始菜单说一句结果。
   */
  async quitLive(): Promise<void> {
    const s = this.state;
    if (!this.liveOk || !livePlaying(s)) return;
    const close = showBanner('正在结算……');
    try {
      await live.finish(s.seed, s.dayIndex === 0 ? 'refund' : 'settle', liveMultipleBp(s), liveStatsOf(s, true));
    } finally {
      close();
    }
    if (this.persist) clearSave();
    this.toTitle();
  }

  /** 回到开始菜单（进度已自动保存）。 */
  toTitle(): void {
    if (this.running > 0) this.current?.abort();
    this.enqueue(async () => {
      const p = await this.switchTo('title');
      await p.enter([]);
    });
  }

  /** 重建当前场景（如切换涨跌配色后）；有表现在播放时排在其后。 */
  redraw(): void {
    this.enqueue(async () => {
      const key = this.current?.viewKey;
      if (key) await this.switchTo(key);
    });
  }

  /** 场景 create 完成后登记自己。 */
  attach(p: Presenter): void {
    this.current = p;
    const cb = this.onAttach;
    this.onAttach = null;
    cb?.(p);
  }

  /** 实际帧率（调试用） */
  get fps(): number {
    return this.game?.loop.actualFps ?? 0;
  }

  /** 调试：活动场景里的补间数、纹理数与显示对象数。 */
  stats(): { tweens: number; textures: number; objects: number } {
    const game = this.game;
    if (!game) return { tweens: 0, textures: 0, objects: 0 };
    let tweens = 0;
    let objects = 0;
    const count = (list: readonly Phaser.GameObjects.GameObject[]): number =>
      list.reduce((n, o) => n + 1 + ('list' in o && Array.isArray((o as Phaser.GameObjects.Container).list) ? count((o as Phaser.GameObjects.Container).list) : 0), 0);
    for (const s of game.scene.getScenes(true)) {
      tweens += s.tweens.getTweens().length;
      objects += count(s.children.list);
    }
    return { tweens, textures: game.textures.getTextureKeys().length, objects };
  }

  /**
   * 0.5.9 显存估算（iOS 上内存超限会让页面崩溃）：纹理管理器里所有纹理源的像素、各场景文字自带画布的像素、主画布的像素。
   * 每像素按 4 字节算；图片在内存里通常还另有一份解码后的位图，实际占用比这还多。
   */
  memory(): { textures: number; texturePx: number; texts: number; textPx: number; canvasPx: number; top: string[] } {
    const game = this.game;
    if (!game) return { textures: 0, texturePx: 0, texts: 0, textPx: 0, canvasPx: 0, top: [] };
    let texturePx = 0;
    const keys = game.textures.getTextureKeys();
    const sizes: [string, number, number][] = [];
    for (const k of keys) {
      for (const src of game.textures.get(k).source) {
        texturePx += src.width * src.height;
        sizes.push([k, src.width, src.height]);
      }
    }
    const top = sizes.sort((a, b) => b[1] * b[2] - a[1] * a[2]).slice(0, 8).map(([k, w, h]) => `${k} ${w}×${h}`);
    let texts = 0;
    let textPx = 0;
    const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
      for (const o of list) {
        // session 只按类型引用 Phaser（不在这里引入运行时），按 type 字段认
        if (o.type === 'Text') {
          const c = (o as Phaser.GameObjects.Text).canvas;
          texts += 1;
          textPx += c.width * c.height;
        }
        if (o.type === 'Container') walk((o as Phaser.GameObjects.Container).list);
      }
    };
    for (const sc of game.scene.getScenes(true)) walk(sc.children.list);
    return { textures: keys.length, texturePx, texts, textPx, canvasPx: game.canvas.width * game.canvas.height, top };
  }

  /** 调试：暂停 / 恢复当前场景的更新（画面照常绘制），截动画中途用。 */
  /** 画面是否被 freeze 冻结（调试/截图用） */
  frozen = false;

  freeze(on: boolean): void {
    const game = this.game;
    if (!game) return;
    this.frozen = on;
    for (const s of game.scene.getScenes(false)) {
      if (on && s.scene.isActive()) s.scene.pause();
      else if (!on && s.scene.isPaused()) s.scene.resume();
    }
  }

  /** 调试：活动场景里正在显示的图片里，纹理帧名或 key 含 needle 的个数（如 'blink' 统计正在眨眼的小人）。 */
  countFrames(needle: string): number {
    const game = this.game;
    if (!game) return 0;
    let n = 0;
    const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
      for (const o of list) {
        const img = o as Phaser.GameObjects.Image;
        if (img.type === 'Image' && img.visible && (String(img.frame?.name ?? '').includes(needle) || String(img.texture?.key ?? '').includes(needle))) n += 1;
        if ('list' in o && Array.isArray((o as Phaser.GameObjects.Container).list)) walk((o as Phaser.GameObjects.Container).list);
      }
    };
    for (const s of game.scene.getScenes(true)) walk(s.children.list);
    return n;
  }

  /**
   * 调试：当前场景顶层显示对象（类型:深度），排查叠放顺序用；
   * 之后附上画面上看得见的文字（`text:` 开头，含容器链的可见性、透明度和是否在画面内），统计可见字数用。
   */
  displayList(): string[] {
    const game = this.game;
    if (!game) return [];
    const out: string[] = [];
    const texts: string[] = [];
    type Obj = Phaser.GameObjects.GameObject & { visible?: boolean; alpha?: number; list?: Phaser.GameObjects.GameObject[]; text?: string };
    const walk = (list: readonly Phaser.GameObjects.GameObject[]): void => {
      for (const o of list as readonly Obj[]) {
        if (o.visible === false || (o.alpha !== undefined && o.alpha <= 0.05)) continue;
        if (o.type === 'Text' && typeof o.text === 'string' && o.text.trim()) {
          const b = (o as unknown as Phaser.GameObjects.Text).getBounds();
          if (b.right > 0 && b.left < GAME_WIDTH && b.bottom > 0 && b.top < GAME_HEIGHT) texts.push(`text:${o.text}`);
        }
        if (Array.isArray(o.list)) walk(o.list);
      }
    };
    for (const s of game.scene.getScenes(false)) {
      if (!s.sys.isVisible() || !(s.sys.isActive() || s.sys.isPaused())) continue;
      for (const o of s.children.list) out.push(`${s.scene.key}/${o.type}:${(o as unknown as { depth: number }).depth}`);
      walk(s.children.list);
    }
    return [...out, ...texts];
  }

  get sceneKey(): SceneKey | null {
    return this.current?.viewKey ?? null;
  }

  /** 没有进行中的动画（停在等待继续的画面也算），可以截图或操作。 */
  get idle(): boolean {
    if (!this.ready || this.loadingMarket || this.autoPending) return false;
    if (this.running === 0) return true;
    return this.running === 1 && this.awaiting;
  }

  get awaiting(): boolean {
    return this.current?.awaitingInput() ?? false;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch(action: Action): { error: string | null } {
    if (!this.ready) return { error: '游戏尚未就绪' };
    const prev = this.state;
    const r = dispatch(prev, action);
    if (r.error) return { error: r.error };
    this.state = r.state;
    this.events = r.events;
    if (this.persist) writeSave(r.state);
    this.learn(r.events);
    this.settle();
    // 上一段表现还没播完（例如停在结算面板上）就放行它
    if (this.running > 0) this.current?.abort();
    this.enqueue(async () => {
      const cur = this.current;
      if (cur) await cur.present(prev, r.state, r.events);
      const key = sceneFor(r.state.phase);
      if (!cur || cur.viewKey !== key) {
        const p = await this.switchTo(key);
        await p.enter(r.events);
      }
    });
    return { error: null };
  }

  /**
   * 开新局：先校验设置（不对就同步返回错误），再异步按种子抽一段真实行情（"正在挑选行情……"），
   * 抽到了用真实行情开局，下载失败就退回 0.3 的合成行情并提示一句。market 为 'synthetic' 时直接用合成行情。
   * 0.13.0 好友挑战：opts.segment 指定那一段（null 为合成行情），下载失败不退回合成行情（那就不是同一局了），调 onFail、不开局。
   */
  newRun(seed: string, setup: RunSetup | null = null, opts: { segment?: string | null; onFail?: () => void } = {}): { error: string | null } {
    try {
      createRun(seed, setup, { ext: true });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    if (this.running > 0) this.current?.abort();
    this.loadingMarket = true;
    this.enqueue(async () => {
      if (opts.segment !== undefined) return this.startFixed(seed, setup, opts.segment, opts.onFail);
      let seg: Segment | null = null;
      if (this.market !== 'synthetic') {
        const close = showBanner('正在挑选行情……');
        try {
          // 每日挑战（种子、人设、难度都对得上）用冻结段池里的那一段
          const daily = setup?.daily && setup.persona && setup.difficulty !== undefined && isDailyRun(setup.daily, seed, setup.persona, setup.difficulty) ? dailySegmentId(setup.daily) : null;
          seg = await segmentFor(seed, this.market === 'real' ? daily : this.market);
        } finally {
          close();
        }
      }
      let run: ReturnType<typeof createRun>;
      try {
        run = createRun(seed, setup, { segment: seg, ext: true });
      } catch (err) {
        console.warn('真实行情开局失败，退回模拟行情：', err);
        seg = null;
        run = createRun(seed, setup, { ext: true });
      }
      this.loadingMarket = false;
      if (!seg && this.market !== 'synthetic') showBanner('行情数据没拿到，这一局先用模拟行情（不影响计分）', 4200);
      // 正常从界面开的局计分；调试会话（?debug=1）里开的局都不计
      markUnscored(this.debugSession ? run.state : null);
      this.load(run.state, run.events);
    });
    return { error: null };
  }

  /** 用指定的那一段开局（好友挑战）：下载失败或开不了局都不退回，交给 onFail */
  private async startFixed(seed: string, setup: RunSetup | null, segment: string | null, onFail?: () => void): Promise<void> {
    let seg: Segment | null = null;
    if (segment !== null) {
      const close = showBanner('正在挑选行情……');
      try {
        seg = await segmentFor(seed, segment);
      } finally {
        close();
      }
    }
    let run: ReturnType<typeof createRun> | null = null;
    try {
      if (segment === null || seg) run = createRun(seed, setup, seg ? { segment: seg, ext: true } : { ext: true });
    } catch (err) {
      console.warn('挑战开局失败：', err);
    }
    this.loadingMarket = false;
    if (!run) return onFail?.();
    markUnscored(this.debugSession ? run.state : null);
    this.load(run.state, run.events);
  }

  /** 行情来源：'real' 按种子抽真实行情段（缺省）；'synthetic' 0.3 的合成行情；其余为指定的段 id（调试） */
  market = 'real';
  /** 正在下载行情段（开局还没完成） */
  loadingMarket = false;
  /** 0.5：平淡日自动快进的倒计时中（马上会自己开盘，自动化等它） */
  autoPending = false;

  /** 当前这局标为调试局（URL 开局参数开的局），刷新后也认得出来。 */
  markUnscored(): void {
    markUnscored(this.state);
  }

  /** 换成另一局（新开、教程或恢复存档）。 */
  load(state: GameState, events: GameEvent[] = []): void {
    this.state = state;
    this.events = events;
    if (this.persist) writeSave(state);
    this.settle();
    this.warmBoard();
    if (this.running > 0) this.current?.abort();
    this.enqueue(async () => {
      const p = await this.switchTo(sceneFor(state.phase));
      await p.enter(events);
    });
  }

  /** 打的是每日挑战、登录着：提前确认好交分要带的账号（dailyBoard.warmBoardUser） */
  private warmBoard(): void {
    if (this.persist && !this.debugSession && this.state.setup?.daily && this.state.phase !== 'won' && this.state.phase !== 'lost' && hasLoginHint()) warmBoardUser();
  }

  controls(): Record<string, { x: number; y: number }> {
    const dialog = this.current?.dialogControls() ?? null;
    if (dialog) return dialog;
    return this.current?.controls() ?? {};
  }

  regions(): Record<string, Rect> {
    return this.current?.regions() ?? {};
  }

  /**
   * 世界坐标 → 画布上的比例位置（0..1）。0.5.5 手机横屏时世界不再一律是 1280×720（适配过的场景 960×444，
   * 没适配的整体缩小居中），自动化按当前场景的相机换算才点得准。
   */
  toCanvas(x: number, y: number): { x: number; y: number } {
    const game = this.game;
    const key = this.current?.viewKey;
    const cam = game && key ? game.scene.getScene(key)?.cameras?.main : undefined;
    if (!game || !cam) return { x: x / 1280, y: y / 720 };
    return { x: ((x - cam.scrollX) * cam.zoom) / game.scale.width, y: ((y - cam.scrollY) * cam.zoom) / game.scale.height };
  }

  /** 触发「继续」（月底账单、事件结果等）。 */
  continue(): boolean {
    return this.current?.continueInput() ?? false;
  }

  /** 跳过正在播放的动画。 */
  skip(): boolean {
    return this.current?.skip() ?? false;
  }

  /** 界面内部的变化（引导步骤、替换模式）也通知订阅者。 */
  notify(): void {
    for (const fn of this.listeners) fn();
  }

  private enqueue(job: () => Promise<void>): void {
    this.running += 1;
    this.notify();
    this.chain = this.chain
      .then(job)
      .catch((err: unknown) => {
        console.error('画面表现出错：', err);
      })
      .finally(() => {
        this.running -= 1;
        this.notify();
      });
  }

  /** 淡出当前场景，启动目标场景（同名则重启），等它 create 完成。 */
  private async switchTo(key: SceneKey): Promise<Presenter> {
    const game = this.game;
    if (!game) throw new Error('Phaser 尚未启动');
    await this.current?.leave();
    return new Promise((resolve) => {
      this.onAttach = resolve;
      this.current = null;
      for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
      game.scene.start(key);
    });
  }
}
