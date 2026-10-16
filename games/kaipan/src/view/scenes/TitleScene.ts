import Phaser from 'phaser';
import { MAX_DIFFICULTY, THEME_IDS, dailyBoardId, difficultyView, liveSetup, personaView, stocksOf, type GameState, type LiveTier, type PersonaId } from '../../core/index.ts';
import { emptyProfile, isDifficultyUnlocked, isPersonaUnlocked, loadProfile, type Profile } from '../../platform/profile.ts';
import { hasSave } from '../../platform/storage.ts';
import { APP_VERSION } from '../../platform/version.ts';
import { KEYART_KEY, ensureMetaArt, hasArt, metaArtReady, settleLazy, stockKey } from '../assets.ts';
import { dailyBadgeView, dailyDate, dailyText, profileLine, setupLine } from '../labels.ts';
import { statTile, tipOnButton } from '../meta/bits.ts';
import { addBadge } from '../meta/setupPanel.ts';
import { CodexPanel, codexProgress } from '../meta/codexPanel.ts';
import { BoardPanel } from '../meta/boardPanel.ts';
import { DailyPanel } from '../meta/dailyPanel.ts';
import { loadLastSetup, saveLastSetup, type CodexGroup, type LastSetup } from '../meta/prefs.ts';
import { SetupPanel, type LiveAside } from '../meta/setupPanel.ts';
import type { Outcome, WalletView } from '../../platform/live.ts';
import { randomSeed } from '../session.ts';
import { addBackdrop } from '../fx/effects.ts';
import type { Session } from '../session.ts';
import { sound } from '../sound.ts';
import { COLOR, GAME_HEIGHT, GAME_WIDTH, PHONE, TYPE } from '../theme.ts';
import { addImage, addPaper, addPill } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { CloudBadge } from '../ui/cloudBadge.ts';
import { WALLET_URL, goLobby } from '../lobby.ts';
import { loadBoard } from '../dailyBoard.ts';
import { live, livePlaying, onLiveChange } from '../live.ts';
import { LIVE_GUARD, buyinFailText, chips, liveEndText, liveNoticeTitle } from '../liveText.ts';
import { hasLoginHint } from '../../platform/cloud.ts';
import { standalone } from '../../platform/mode.ts';
import { showBanner } from '../segments.ts';
import { ChoiceDialog } from '../ui/noticeDialog.ts';
import { hideHomeTip, showHomeTip } from '../../platform/viewportFit.ts';
import { Room } from '../trade/room.ts';
import { phoneLayout, viewOf } from '../viewport.ts';
import { BaseScene } from './BaseScene.ts';

const PW = 440;
const PH = 540;
/** 手机横屏（960×444）：主视觉缩到 0.75 铺满宽度、上移一截，按钮放在 Logo 下面的留白里 */
const PHONE_ART_K = 0.75;
const PHONE_ART_OY = -40;

type Item = [string, string, () => void, 'primary' | 'default'];

/**
 * 开始菜单：继续 / 快速开始 / 新游戏（选人设和市场环境）/ 实盘、每日挑战、图鉴、成就、设置、关于，左上角常驻「大厅」；
 * 下面一行是档案里的通关、解锁和收集进度。
 */
export class TitleScene extends BaseScene {
  protected override readonly phoneReady = PHONE;
  private buttons: Record<string, Button> = {};
  private room: Room | null = null;
  private profile: Profile = emptyProfile();
  /** 正在等 meta 图集（防止连点开两个面板） */
  private opening = false;
  private guys: StockGuy[] = [];
  private cloud: CloudBadge | null = null;
  /** 实盘带入中的挡板（挡住开始菜单的点击） */
  private busy: Phaser.GameObjects.Rectangle | null = null;

  constructor(session: Session) {
    super('title', session);
  }

  protected override build(): void {
    this.buttons = {};
    this.busy = null;
    this.guys = [];
    this.room = null;
    this.profile = loadProfile().profile;
    const can = this.canContinue();
    const quick = this.quickSetup();
    const main: Item[] = [];
    if (can) main.push(['continue', `继续 · ${livePlaying(this.session.state) ? '实盘 ' : ''}${this.session.state.month}月`, () => this.session.enterGame(), 'primary']);
    main.push(['quick', '快速开始', () => this.guardNew(() => this.startSetup(quick.persona, quick.difficulty)), can ? 'default' : 'primary']);
    main.push(['new', '新游戏', () => this.openSetup(), 'default']);
    // 0.6.0 实盘：带一份筹码进场打半年（设计稿第 4 节）。0.8.0 单独部署没有平台钱包，不放这个按钮
    if (!standalone()) main.push(['live', '实盘', () => this.openLive(), 'default']);
    const more: Item[] = [
      ['help', '怎么玩', () => this.openHelp(), 'default'],
      ['daily', '每日挑战', () => this.openDaily(), 'default'],
      ['codex', '图鉴', () => this.openCodex('stocks'), 'default'],
      ['achievements', '成就', () => this.openCodex('achievements'), 'default'],
      ['settings', '设置', () => this.openSettings(false), 'default'],
      ['about', '关于', () => this.openAbout(), 'default'],
    ];
    const prog = codexProgress(this.profile);
    const line = profileLine(this.profile, prog.seen, prog.total, prog.ach, prog.achTotal);
    const qp = personaView(quick.persona);
    const qd = difficultyView(quick.difficulty);
    const hint = `快速开始：${setupLine(qp.name, qd.level, qd.name)}`;
    const keyart = hasArt(this.textures, KEYART_KEY);
    if (keyart) this.buildKeyart(main, more, line);
    else this.buildRoom(main, more, line);
    // 云存档的云朵放在 Logo 右边（两边的群友气泡、四个角都占着）
    const at = phoneLayout(this) ? { x: 612, y: 46 } : keyart ? { x: 800, y: 84 } : { x: 790, y: 140 };
    // 单独部署没有平台，也就没有云存档和登录，不放云朵
    this.cloud = standalone() ? null : new CloudBadge(this, at.x, at.y, this.lively);
    // iOS Safari：开始菜单底下提示「添加到主屏幕玩更大」（可关），离开开始菜单就收起
    showHomeTip();
    this.events.off('shutdown', hideHomeTip);
    this.events.once('shutdown', hideHomeTip);
    // 回大厅（平台首页）：常驻左上角，开始菜单不在一局里，点了直接走。
    // 手机上主视觉缩小上移，最左上角是画里的第一条群友气泡（到 x≈205），挪到它和 Logo 之间的留白
    // 单独部署没有大厅，开始菜单本身就是首页，不放
    const lobbyAt = phoneLayout(this) ? { x: 224, y: 12 } : { x: 14, y: 10 };
    if (!standalone()) this.buttons.lobby = new Button(this, lobbyAt.x, lobbyAt.y, { width: 104, height: 42, label: '大厅', icon: 'house', fontSize: 16, onClick: () => goLobby() });
    this.liveButton();
    this.dailyBadge();
    // 实盘的结果在局外说一次（提前收手、离开结束页之后才结完、放太久作废）；之后结完了也说。
    // 挂在 build 里：云同步等会重画开始菜单（不走 enter），监听要跟着新画面；读档、档案的提示先说，空出来再说这个
    const off = onLiveChange(() => this.time.delayedCall(1, () => this.liveNotice()));
    this.events.once('shutdown', off);
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.liveNotice() });
    // 「快速开始」的组合、档案说明都收进悬停
    const quickBtn = this.buttons.quick;
    if (quickBtn) {
      const qb = quickBtn.getBounds();
      tipOnButton(quickBtn, () => ({ x: qb.x, y: qb.y, w: qb.width, h: qb.height }), () => ({ title: '快速开始', body: hint }));
    }
    // 主视觉右下角是小人，版本号挪到右上角
    const V = viewOf(this);
    // 手机上右上角是群友头像，版本号放右下角（压在小人上，靠描边看清）
    if (keyart && !phoneLayout(this)) addText(this, V.w - 16, 10, `v${APP_VERSION}`, { size: 12, color: COLOR.ink, originX: 1, stroke: 0xfff6e6, strokeWidth: 4 });
    else addText(this, V.w - 16, V.h - 12, `v${APP_VERSION}`, { size: 12, color: COLOR.ink, originX: 1, originY: 1, stroke: 0xfff6e6, strokeWidth: 4 });
  }

  /**
   * 档案一排图标数字：奖杯（通关/局数）、难度徽章（已解锁到第几级）、图鉴、成就；完整说法在悬停。
   * 还没玩过时不画（「快速开始」的悬停里有新手说明）。
   */
  private stats(cy: number, line: string, w = 116): void {
    const p = this.profile;
    if (p.runs === 0) return;
    const prog = codexProgress(p);
    const gap = 10;
    const x0 = viewOf(this).w / 2 - (w * 4 + gap * 3) / 2;
    const tile = (i: number, make: (x: number) => Phaser.GameObjects.Container): void => {
      const x = x0 + i * (w + gap);
      make(x);
      const hit = this.add.rectangle(x, cy - 24, w, 48, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x, y: cy - 24, w, h: 48 }), () => ({ title: '我的档案', body: line.split(' · ').join('\n') }));
    };
    tile(0, (x) => statTile(this, x, cy - 24, 'trophy', `${p.wins}/${p.runs}`, '', { w, icon: 32, size: TYPE.title }));
    tile(1, (x) => {
      const c = statTile(this, x, cy - 24, 'star', `${p.maxDifficulty}/${MAX_DIFFICULTY}`, '', { w, icon: 32, size: TYPE.title });
      // 星星换成难度徽章
      const star = c.list[1] as Phaser.GameObjects.Image;
      star.setVisible(false);
      c.add(addBadge(this, 8 + 16, 24, p.maxDifficulty, 36));
      return c;
    });
    tile(2, (x) => statTile(this, x, cy - 24, 'book', `${prog.seen}/${prog.total}`, '', { w, icon: 32, size: TYPE.title }));
    tile(3, (x) => statTile(this, x, cy - 24, 'star', `${prog.ach}/${prog.achTotal}`, '', { w, icon: 32, size: TYPE.title }));
  }

  /**
   * 标题主视觉（美术交付后）：整幅插画铺底，Logo 和按钮放在中上部的留白里（世界坐标 x 304–976、y 32–352）。
   * 第一排是开局（继续 / 快速开始 / 新游戏），第二排是每日挑战、图鉴、成就、设置、关于。
   */
  private buildKeyart(main: Item[], more: Item[], line: string): void {
    if (phoneLayout(this)) {
      // 手机：整幅画缩到 0.75（960×540）、上移 40，Logo 和按钮落在原图上方的留白里，底下的小人露出上半身
      addImage(this, (GAME_WIDTH / 2) * PHONE_ART_K, (GAME_HEIGHT / 2) * PHONE_ART_K + PHONE_ART_OY, KEYART_KEY, GAME_WIDTH * PHONE_ART_K, GAME_HEIGHT * PHONE_ART_K);
      this.phoneMenu(main, more, line);
      return;
    }
    addImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, KEYART_KEY, GAME_WIDTH, GAME_HEIGHT);
    const logo = addText(this, GAME_WIDTH / 2, 92, '开盘', { size: 84, bold: true, color: COLOR.accent, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: 12 });
    // 四个开局按钮要收在主视觉中上部的留白里（x 304–976），比三个时窄一点
    this.row(main, 160, 52, 18, (v) => (v === 'primary' ? (main.length > 3 ? 210 : 228) : main.length > 3 ? 132 : 150), main.length > 3 ? 14 : 12);
    this.row(more, 226, 40, 15, () => 100);
    this.stats(310, line);
    if (this.lively) this.tweens.add({ targets: logo, scale: { from: 1, to: 1.04 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /**
   * 手机横屏的菜单：Logo、开局一排（主按钮高 46）、其余入口一排（高 40）、档案四格，都在 960×444 的上半截。
   * 和电脑版同样的两排结构，只是收紧了尺寸。
   */
  private phoneMenu(main: Item[], more: Item[], line: string): void {
    const logo = addText(this, viewOf(this).w / 2, 54, '开盘', { size: 60, bold: true, color: COLOR.accent, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: 10 });
    this.row(main, 100, 46, 18, (v) => (v === 'primary' ? (main.length > 3 ? 172 : 200) : main.length > 3 ? 108 : 140), 10);
    // 右边第三个群友气泡从 x≈750 开始，这一排要收在 724 以内
    this.row(more, 158, 40, 15, () => 76, 6);
    this.stats(238, line, 104);
    if (this.lively) this.tweens.add({ targets: logo, scale: { from: 1, to: 1.04 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** 横排一行按钮，居中。 */
  private row(items: Item[], y: number, h: number, fontSize: number, width: (v: Item[3]) => number, gap = 12): void {
    const widths = items.map(([, , , v]) => width(v));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = viewOf(this).w / 2 - total / 2;
    items.forEach(([key, label, fn, variant], i) => {
      const w = widths[i] ?? 120;
      this.buttons[key] = new Button(this, x, y, { width: w, height: h, label, variant, fontSize, onClick: fn });
      x += w + gap;
    });
  }

  /** 没有主视觉时：小屋背景 + 纸面板，本局龙头小人在桌上列队。 */
  private buildRoom(main: Item[], more: Item[], line: string): void {
    this.room = new Room(this, 'bull', { ambient: this.lively });
    addBackdrop(this, 0.18).disableInteractive();
    if (phoneLayout(this)) {
      // 手机：纸面板放在上半截，按和主视觉版一样的两排排法
      addPaper(this, 190, 8, 580, 290);
      this.phoneMenu(main, more, line);
      this.parade();
      return;
    }
    const x = GAME_WIDTH / 2 - PW / 2;
    const y = 90;
    addPaper(this, x, y, PW, PH);
    addText(this, GAME_WIDTH / 2, y + 58, '开盘', { size: 68, bold: true, color: COLOR.accent, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: 10 });
    const bw = 320;
    let top = y + 120;
    for (const [key, label, fn, variant] of main) {
      this.buttons[key] = new Button(this, GAME_WIDTH / 2 - bw / 2, top, { width: bw, height: 46, label, variant, fontSize: 18, onClick: fn });
      top += 56;
    }
    top += 8;
    // 次要入口两列
    const cw = (bw - 10) / 2;
    more.forEach(([key, label, fn, variant], i) => {
      const bx = GAME_WIDTH / 2 - bw / 2 + (i % 2) * (cw + 10);
      this.buttons[key] = new Button(this, bx, top + Math.floor(i / 2) * 46, { width: cw, height: 38, label, variant, fontSize: 15, onClick: fn });
    });
    this.stats(y + PH - 56, line, 100);
    this.parade();
  }

  /** 桌上列队的小人：本局登场题材的龙头（素材已加载），轮流开心地跳一下。 */
  private parade(): void {
    const themes = this.session.state.themeIds.length > 0 ? this.session.state.themeIds : THEME_IDS.slice(0, 6);
    const ids = themes.map((t) => stocksOf(t)[0]?.id).filter((x): x is string => !!x && hasArt(this.textures, stockKey(x, 'calm')));
    const xs = [150, 300, 980, 1130, 450, 830];
    // 手机上按 0.75 收进 960 宽（和房间画同样的缩放）
    const sc = phoneLayout(this) ? PHONE_ART_K : 1;
    ids.slice(0, 6).forEach((id, i) => {
      const g = new StockGuy(this, (xs[i] ?? 640) * sc, viewOf(this).h - 20 * sc, id, i % 3 === 0 ? 'happy' : 'calm', 96 * sc, { idle: this.lively });
      this.guys.push(g);
    });
    if (!this.lively || this.guys.length === 0) return;
    let k = 0;
    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => {
        const g = this.guys[k % this.guys.length];
        k += 1;
        if (!g?.active) return;
        g.setFace('limitup');
        g.bounce(this.anim, 0.8);
        this.time.delayedCall(900, () => g.active && g.setFace('happy'));
      },
    });
  }

  private canContinue(): boolean {
    const s: GameState = this.session.state;
    return hasSave() && s.phase !== 'won' && s.phase !== 'lost';
  }

  /** 「快速开始」的组合：上次开局的（仍解锁时），第一次玩是新手 + 第 1 级。 */
  private quickSetup(): LastSetup {
    const last = loadLastSetup();
    return {
      persona: isPersonaUnlocked(this.profile, last.persona) ? last.persona : 'newbie',
      difficulty: isDifficultyUnlocked(this.profile, last.difficulty) ? last.difficulty : 1,
    };
  }

  /** 当前有进行中的局时先确认覆盖；实盘没打完时先问"继续这局 / 提前收手"，不会悄悄盖掉（设计稿 2.4）。 */
  private guardNew(go: () => void): void {
    // 多半是从开局面板、每日挑战面板关掉后马上调的：对话框标记下一帧才放开，晚一帧再问
    this.whenFree(() => this.guardNow(go));
  }

  private guardNow(go: () => void): void {
    if (this.canContinue() && livePlaying(this.session.state) && this.session.liveOk) {
      this.trackDialog(
        new ChoiceDialog(this, LIVE_GUARD.title, LIVE_GUARD.body, { label: LIVE_GUARD.ok, name: 'live:continue', onClick: () => this.session.enterGame() }, {
          label: LIVE_GUARD.quit,
          name: 'live:quit',
          onClick: () => this.whenFree(() => this.askQuitLive()),
        }),
      );
      return;
    }
    if (this.canContinue() && this.session.state.dayIndex > 0) {
      this.openConfirm('开一局新的？', '现在这局的进度会被新的一局盖掉。', '开新局', go);
      return;
    }
    go();
  }

  private startSetup(persona: PersonaId, difficulty: number): void {
    saveLastSetup({ persona, difficulty });
    this.session.newRun(randomSeed(), { persona, difficulty });
  }

  /** 长线界面要用 meta 图集：没好就先显示「载入中」，好了再开（失败时各控件有自己的回退画法）。 */
  private withMeta(open: () => void): void {
    if (this.dialogOpen || this.opening) return;
    if (metaArtReady(this.textures)) return open();
    this.opening = true;
    const V = viewOf(this);
    const tip = addText(this, V.w / 2, V.h - 40, '载入中…', { size: 16, bold: true, color: COLOR.ink, originX: 0.5, stroke: 0xfff6e6, strokeWidth: 5 }).setDepth(400);
    void ensureMetaArt(this.textures).finally(() => {
      this.opening = false;
      if (!this.sys.isActive()) return;
      tip.destroy();
      if (!this.dialogOpen) open();
    });
  }

  private openSetup(mode: 'fun' | 'live' = 'fun', wallet?: { wallet: WalletView | null; blocked: string | null; aside?: LiveAside | null }, persona?: PersonaId): void {
    this.withMeta(() => {
      const initial = { ...this.quickSetup(), ...(persona ? { persona } : {}) };
      const can = !this.session.debugSession && this.session.persist && hasLoginHint() && !standalone();
      this.trackDialog(
        new SetupPanel(this, {
          profile: this.profile,
          initial,
          anim: this.anim,
          real: this.session.market !== 'synthetic',
          onStart: (p, difficulty) => this.guardNew(() => this.startSetup(p, difficulty)),
          live: mode === 'live' && wallet ? { wallet: wallet.wallet, blocked: wallet.blocked, aside: wallet.aside ?? null, tier: 'small', onStart: (p, tier) => this.guardNew(() => this.startLive(p, tier)) } : undefined,
          // 调试会话、没登录时没有开关（实盘按钮也是灰的）
          onMode: can ? (m, p) => this.time.delayedCall(1, () => (m === 'live' ? this.openLive(p) : this.openSetup('fun', undefined, p))) : undefined,
        }),
      );
    });
  }

  /** 「实盘」按钮：调试会话、没登录时变灰，悬停说原因（娱乐照常） */
  private liveButton(): void {
    const b = this.buttons.live;
    if (!b) return;
    const why = (): string | null =>
      this.session.debugSession || !this.session.persist ? '调试的时候不能玩实盘' : !hasLoginHint() ? '登录以后才能玩实盘' : null;
    b.setEnabled(why() === null).onDenied(why);
    b.tooltip(() => ({ title: '实盘', body: why() ?? '带一份筹码进场打半年，按最后的资产结回。筹码只是游戏里的分数，无任何现金价值。' }));
  }

  /** 点「实盘」：实盘没打完就问继续还是收手；否则先看一眼钱包，再打开实盘的开局面板 */
  private openLive(persona?: PersonaId): void {
    if (this.canContinue() && livePlaying(this.session.state)) return this.guardNew(() => undefined);
    if (this.dialogOpen || this.opening) return;
    this.opening = true;
    const close = showBanner('正在看钱包……');
    void Promise.all([live.retry().then(() => live.wallet()), ensureMetaArt(this.textures).catch(() => undefined)]).then(([w]) => {
      close();
      this.opening = false;
      if (!this.sys.isActive() || this.dialogOpen) return;
      const wallet = w === 'login' ? null : w;
      const r = live.record;
      let blocked: string | null = null;
      if (w === 'login') blocked = '登录以后才能玩实盘';
      else if (r && (r.step === 'settling' || r.step === 'buying')) blocked = '上一局实盘还没结完，联网后会自动结回';
      // 0.6.8 桌上别处的几份（另一台设备上开的、本机记录丢了的）不拦开新局（平台 0.9.5 起同一游戏可以有好几份）：
      // 开局面板提示一句，给「回去接着打」「原样退回」。本机正在结的那份由上面的 blocked 管
      const others = (wallet?.stakes ?? []).filter((x) => !(r && x.ref === r.ref && (r.step === 'settling' || r.step === 'buying')));
      const aside: LiveAside | null =
        others.length > 0
          ? {
              amount: others.reduce((n, x) => n + x.amount, 0),
              count: others.length,
              here: others.every((x) => x.ref === r?.ref),
              onResume: () => this.whenFree(() => this.openNotice('回那台设备接着打', '那局实盘在另一台设备上：回那台设备打开开盘，点「继续」接着打。\n放着不管一天后会原样退回钱包。')),
              onRefund: () => this.whenFree(() => this.refundOthers(others.map((x) => x.ref), others.reduce((n, x) => n + x.amount, 0), persona)),
            }
          : null;
      this.openSetup('live', { wallet, blocked, aside }, persona);
    });
  }

  /** 0.6.8 把桌上别处的几份原样退回：先确认，退完重开实盘面板（余额跟着变）；退不成说原因，那一份没动 */
  private refundOthers(refs: readonly string[], amount: number, persona?: PersonaId): void {
    const n = refs.length;
    this.openConfirm('原样退回？', `${n > 1 ? `这 ${n} 局` : '那一局'}的 ${chips(amount)} 筹码原样退回钱包，${n > 1 ? '它们' : '那局'}就不再算筹码了。`, '退回', () => {
      const close = showBanner('正在退回……');
      void (async () => {
        let fail: Outcome | null = null;
        for (const ref of refs) {
          const o = await live.refundStake(ref);
          if (o.kind !== 'ok' && !(o.kind === 'reject' && (o.error === 'no_stake' || o.error === 'expired'))) fail ??= o;
        }
        close();
        if (!this.sys.isActive()) return;
        if (!fail) return this.openLive(persona);
        if (fail.kind === 'bug') console.error('实盘退回别处那一份出错：', fail.error);
        const t = fail.kind === 'retry' && fail.why === 'login' ? { title: '还没登录', body: '登录以后才能退回。那一份没动，放着不管一天后也会原样退回。' } : fail.kind === 'retry' ? { title: '暂时退不回去', body: '钱包暂时连不上，那一份没动；过一会儿再试，放着不管一天后也会原样退回。' } : { title: '出了点问题', body: '出了点问题，那一份没动，刷新一下再试。' };
        this.openNotice(t.title, t.body);
      })();
    });
  }

  /** 实盘开局：先带入（钱包扣一份），成了再开局；没成就说原因，筹码没动 */
  private startLive(persona: PersonaId, tier: LiveTier): void {
    if (this.busy) return;
    const close = showBanner('正在带入……');
    // 带入到开局（还要挑行情）之间挡住开始菜单：这时点别的会盖掉或抢在这局实盘前面
    this.busy = this.add.rectangle(0, 0, viewOf(this).w, viewOf(this).h, 0xffffff, 0.001).setOrigin(0, 0).setDepth(1000).setInteractive();
    const unblock = (): void => {
      close();
      this.busy?.destroy();
      this.busy = null;
    };
    const seed = randomSeed();
    void live
      .buyin(tier, seed)
      .then((r) => {
        if (r.ok) {
          close();
          // 挡板留着，开局换场景时跟着走
          this.session.newRun(seed, liveSetup(tier, persona));
          return;
        }
        unblock();
        const o = r.outcome;
        const t = buyinFailText(o.kind === 'retry' ? 'retry' : o.error, o.kind === 'retry' ? o.why : undefined, o.kind === 'retry' ? o.code : undefined);
        if (o.kind === 'reject' && o.error === 'at_table') console.error('实盘带入：同一个 ref 换了档（at_table）');
        if (!this.sys.isActive()) return;
        if (t.wallet) this.trackDialog(new ChoiceDialog(this, t.title, t.body, { label: '去领补给', name: 'live:wallet', onClick: () => void goLobby(WALLET_URL) }, { label: '知道了', name: 'live:ok', onClick: () => {} }));
        else this.openNotice(t.title, t.body);
      })
      .catch((err: unknown) => {
        unblock();
        console.error('实盘带入出错：', err);
        if (this.sys.isActive()) this.openNotice('出了点问题', '出了点问题，这一份筹码没动，刷新一下再试。可以先玩娱乐模式。');
      });
  }

  /**
   * 「每日挑战」右上角的小牌子：今天的题打没打、打了排第几（0.6.9）。
   * 名次读全站榜（45 秒缓存，来回进出开始菜单不打平台）；没登录、调试局、读不到时就写「已打」。
   */
  private dailyBadge(): void {
    const b = this.buttons.daily;
    if (!b) return;
    const date = dailyDate();
    const rec = this.profile.daily[date];
    let tag: Phaser.GameObjects.Container | null = null;
    let rank: number | null | undefined;
    const draw = (): void => {
      tag?.destroy();
      const v = dailyBadgeView(rec, rank);
      const r = b.getBounds();
      const t = addText(this, 0, 0, v.text, { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const w = Math.ceil(t.width) + 14;
      t.setPosition(-w / 2, 0);
      tag = this.add.container(r.right + 6, r.top + 1, [addPill(this, -w, -10, w, 20, v.fresh ? COLOR.accent : COLOR.info), t]).setDepth(b.depth + 1);
    };
    draw();
    b.tooltip(() => ({
      title: '每日挑战',
      body: `${dailyText(rec)}${rank ? `\n今天全站第 ${rank} 名` : ''}\n今天所有人玩的都是同一局${standalone() ? '。' : '，打完上排行榜。'}`,
    }));
    if (!rec || rec.attempts === 0 || this.session.debugSession || !hasLoginHint() || standalone()) return;
    void loadBoard(dailyBoardId(date), 'all').then((res) => {
      // 读回来时开始菜单可能已经重画（云同步）或离开了：按钮没了就不画
      if (res.kind !== 'ok' || !res.me?.rank || !b.active) return;
      rank = res.me.rank;
      draw();
    });
  }

  private openDaily(): void {
    this.withMeta(() => {
      this.trackDialog(
        new DailyPanel(
          this,
          this.profile,
          (seed, setup) => this.guardNew(() => this.session.newRun(seed, setup)),
          // 排行榜关掉后回到每日挑战面板（两个弹窗不叠着开：关掉一个时会放开场景快捷键）；单独部署没有排行榜
          standalone() ? null : (date) => this.trackDialog(new BoardPanel(this, date, dailyBoardId(date), () => this.openDaily())),
        ),
      );
    });
  }

  private openCodex(tab: CodexGroup): void {
    this.withMeta(() => {
      this.trackDialog(new CodexPanel(this, this.profile, tab));
    });
  }

  protected override render(_s: GameState): void {
    sound.mood('title');
  }

  override async enter(): Promise<void> {
    const n = this.session.notice;
    if (n) {
      this.session.notice = null;
      if (n === 'legacy') this.openNotice('版本大更新', '上次那局是很早的版本存的，现在接不上了，从新的一局开始吧。');
      else this.openNotice('存档坏了', '这台设备上的存档读不出来，已经备份并清掉。开一局新的吧。');
    } else if (this.session.profileNotice) {
      this.session.profileNotice = false;
      this.openNotice('收藏记录坏了', '你的图鉴、成就和解锁记录读不出来，已经备份好，并重新建了一份新的。');
    }
  }

  /** 实盘记录有没说过的结果：弹一次 */
  private liveNotice(): void {
    const r = live.record;
    if (!r || r.told || r.step === 'playing' || r.step === 'buying' || !this.session.liveOk || this.dialogOpen || this.busy || !this.sys.isActive()) return;
    const t = liveEndText(r, false);
    live.markTold();
    this.openNotice(liveNoticeTitle(r), `${t.head}\n${t.body}`);
  }

  /** 离开前等后台预取的雷雨天图层（最多 1.5 秒），交易场景就不用再显示载入。 */
  override async leave(): Promise<void> {
    await settleLazy(1500);
    return super.leave();
  }

  protected override teardown(): void {
    this.room?.destroy();
  }

  protected override onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Enter' || e.code === 'Space') {
      return (this.buttons.continue ?? this.buttons.quick)?.press() ?? false;
    }
    return false;
  }

  override controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, b] of Object.entries(this.buttons)) out[k] = b.center();
    if (this.cloud?.active) out.cloud = { x: this.cloud.x, y: this.cloud.y };
    return out;
  }
}
