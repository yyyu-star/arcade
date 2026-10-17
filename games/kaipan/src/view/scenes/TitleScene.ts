import Phaser from 'phaser';
import { BALANCE, THEME_IDS, dailyBoardId, dailySetup, difficultyView, formatMoney, liveSetup, personaView, stocksOf, type GameState, type LiveTier, type PersonaId } from '../../core/index.ts';
import { emptyProfile, isDifficultyUnlocked, isPersonaUnlocked, loadProfile, type Profile } from '../../platform/profile.ts';
import { hasSave } from '../../platform/storage.ts';
import { APP_VERSION } from '../../platform/version.ts';
import { TITLE_ART, TITLE_BUBBLES, ensureMetaArt, hasArt, metaArtReady, personaKey, settleLazy, stockKey, titleArtReady, type Glyph } from '../assets.ts';
import { dailyBadgeView, dailyDate, dailyText, profileLine, setupLine } from '../labels.ts';
import { CodexPanel, codexProgress } from '../meta/codexPanel.ts';
import { BoardPanel } from '../meta/boardPanel.ts';
import { DailyPanel } from '../meta/dailyPanel.ts';
import { funSetup, loadLastSetup, saveLastSetup, type CodexGroup, type LastSetup } from '../meta/prefs.ts';
import { SetupPanel, type LiveAside } from '../meta/setupPanel.ts';
import type { Outcome, WalletView } from '../../platform/live.ts';
import { randomSeed } from '../session.ts';
import { addBackdrop } from '../fx/effects.ts';
import type { Session } from '../session.ts';
import { sound } from '../sound.ts';
import { COLOR, GAME_WIDTH, LOW_MEMORY, PHONE } from '../theme.ts';
import { addGlyph, addImage, addPill } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText, fitWidth } from '../ui/text.ts';
import { CloudBadge } from '../ui/cloudBadge.ts';
import { WALLET_URL, goLobby } from '../lobby.ts';
import { loadBoard } from '../dailyBoard.ts';
import { live, livePlaying, onLiveChange } from '../live.ts';
import { LIVE_GUARD, LIVE_MINUTES, buyinFailText, chips, liveEndText, liveNoticeTitle } from '../liveText.ts';
import { hasLoginHint } from '../../platform/cloud.ts';
import { standalone } from '../../platform/mode.ts';
import { showBanner } from '../segments.ts';
import { ChoiceDialog } from '../ui/noticeDialog.ts';
import { acceptInvite, onChallengeChange, takeInvite } from '../challenge.ts';
import { ChallengeInviteDialog, ChallengePanel } from '../meta/challengePanel.ts';
import type { ChallengeFail, ChallengeView } from '../../platform/challenge.ts';
import { hideHomeTip, showHomeTip } from '../../platform/viewportFit.ts';
import { Room } from '../trade/room.ts';
import { bleedOf, coverOf, phoneLayout, viewOf } from '../viewport.ts';
import { BaseScene } from './BaseScene.ts';

/**
 * 0.14.0（art-v3 ①）开始菜单改成主页：上面 Logo 和一句玩法，中间一张大卡（继续上局 / 快速开始 / 开始第一局）和几张模式卡
 * （每日挑战、实盘、新一局），右上角一排小入口（怎么玩、图鉴、成就、设置、关于），左上角「大厅」。
 * 背后是分层的主视觉：天空（画面直接画）、远处城市、山坡、小屋、前排会眨眼会跳的股票小人、依次弹出的群聊气泡、慢慢飘的云；
 * 电脑上随鼠标有一点视差。窗口不是 16:9 时城市和山坡往两边铺满（EXPAND，见 viewport.ts）。
 * 「减少动态效果」、关动画、省内存设备上不飘、不跳、不视差。
 */

/** 电脑布局（1280×720 安全区） */
const DESK = {
  logoY: 70,
  tagY: 130,
  hero: { x: 380, y: 160, w: 520, h: 112 },
  /** 模式卡一排，居中 */
  card: { y: 292, w: 196, h: 128, gap: 16 },
  /** 右上角小入口：右对齐到这里 */
  tools: { right: 1266, y: 10, h: 40, gap: 8, font: 15 },
  cloud: { x: 770, y: 78 },
} as const;

/** 手机横屏（960×444）：左边大卡和一句玩法，右边模式卡竖排 */
const PHONE_UI = {
  logoY: 34,
  hero: { x: 24, y: 70, w: 444, h: 104 },
  tagY: 190,
  card: { x: 492, y: 70, w: 444, h: 76, gap: 10 },
  tools: { right: 948, y: 8, h: 40, gap: 6, font: 14 },
  cloud: { x: 160, y: 30 },
} as const;

/** 主视觉在手机上整体缩到 0.75、往左下挪（右边是模式卡） */
const PHONE_ART = { k: 0.75, ox: -100, oy: -81 };

/** 前排小人（电脑世界坐标，脚踩的位置和高度）：两边各一群，房前两只小的；窗口变宽时两边再各露出一只 */
const CROWD: readonly [number, number, number][] = [
  [72, 698, 142], [208, 708, 136], [348, 702, 128], [478, 706, 90], [806, 708, 104], [930, 702, 136], [1070, 708, 132], [1196, 698, 140], [-96, 700, 128], [1376, 700, 128],
];
/** 云：位置和大小（相对 160×72 那一朵） */
const CLOUDS: readonly [number, number, number][] = [[192, 376, 1], [1104, 336, 0.86], [448, 448, 0.64], [896, 472, 0.72], [-170, 320, 0.8], [1460, 390, 0.86]];

type Item = { key: string; label: string; fn: () => void };

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
  /** 视差的几层：容器和它跟鼠标走的幅度 */
  private parallax: { layer: Phaser.GameObjects.Container; amp: number }[] = [];

  constructor(session: Session) {
    super('title', session);
  }

  protected override build(): void {
    this.buttons = {};
    this.busy = null;
    this.guys = [];
    this.room = null;
    this.parallax = [];
    this.profile = loadProfile().profile;
    const ph = phoneLayout(this);
    const art = titleArtReady(this.textures);
    if (art) this.buildArt(ph);
    else this.buildRoom(ph);
    const L = ph ? PHONE_UI : DESK;
    const logo = addText(this, viewOf(this).w / 2, L.logoY, '开盘', { size: ph ? 46 : 80, bold: true, color: COLOR.accent, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: ph ? 9 : 12 });
    if (this.lively) this.tweens.add({ targets: logo, scale: { from: 1, to: 1.04 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const tag = '看群聊、追风口，每个月还上账';
    if (ph) addText(this, PHONE_UI.hero.x + PHONE_UI.hero.w / 2, PHONE_UI.tagY, tag, { size: 15, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5, stroke: COLOR.paper, strokeWidth: 5 });
    else addText(this, GAME_WIDTH / 2, DESK.tagY, tag, { size: 18, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5, stroke: COLOR.paper, strokeWidth: 6 });
    this.hero(ph);
    this.modeCards(ph);
    this.tools(ph);
    // 单独部署没有平台，也就没有云存档和登录，不放云朵
    this.cloud = standalone() ? null : new CloudBadge(this, L.cloud.x, L.cloud.y, this.lively);
    // iOS Safari：开始菜单底下提示「添加到主屏幕玩更大」（可关），离开开始菜单就收起
    showHomeTip();
    this.events.off('shutdown', hideHomeTip);
    this.events.once('shutdown', hideHomeTip);
    // 回大厅（平台首页）：常驻左上角，开始菜单不在一局里，点了直接走。单独部署没有大厅，开始菜单本身就是首页，不放
    if (!standalone()) this.buttons.lobby = new Button(this, ph ? 12 : 14, ph ? 8 : 10, { width: 104, height: 42, label: '大厅', icon: 'house', fontSize: 16, onClick: () => goLobby() });
    // 实盘的结果在局外说一次（提前收手、离开结束页之后才结完、放太久作废）；之后结完了也说。
    // 挂在 build 里：云同步等会重画开始菜单（不走 enter），监听要跟着新画面；读档、档案的提示先说，空出来再说这个
    const off = onLiveChange(() => this.time.delayedCall(1, () => this.liveNotice()));
    this.events.once('shutdown', off);
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.liveNotice() });
    // 0.13.0 打开好友挑战的链接：读到了弹一张卡（同样等前面的提示说完、空出来再弹）
    const offC = onChallengeChange(() => this.time.delayedCall(1, () => this.challengeNotice()));
    this.events.once('shutdown', offC);
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.challengeNotice() });
    const V = viewOf(this);
    addText(this, V.w - 12, V.h - 8, `v${APP_VERSION}`, { size: 12, color: COLOR.ink, originX: 1, originY: 1, stroke: 0xfff6e6, strokeWidth: 4 }).setDepth(5);
  }

  // ---------------------------------------------------------------- 主视觉

  /** 电脑坐标换到当前布局（手机上整体缩小、挪开） */
  private at(x: number, y: number): { x: number; y: number; k: number } {
    if (!phoneLayout(this)) return { x, y, k: 1 };
    return { x: x * PHONE_ART.k + PHONE_ART.ox, y: y * PHONE_ART.k + PHONE_ART.oy, k: PHONE_ART.k };
  }

  /** 一层视差：电脑上有鼠标、开着动画、不是省内存设备时跟着鼠标偏一点 */
  private layer(amp: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    this.parallax.push({ layer: c, amp });
    return c;
  }

  private buildArt(ph: boolean): void {
    this.sky();
    const city = this.layer(4);
    const a = this.at(640, 480);
    city.add(addImage(this, a.x, a.y, TITLE_ART.city.key, TITLE_ART.city.w * a.k, TITLE_ART.city.h * a.k));
    const clouds = this.layer(2);
    for (const [x, y, s] of CLOUDS) {
      const c = this.at(x, y);
      const img = addImage(this, c.x, c.y, TITLE_ART.cloud.key, TITLE_ART.cloud.w * s * c.k, TITLE_ART.cloud.h * s * c.k);
      clouds.add(img);
      if (this.lively) this.tweens.add({ targets: img, x: c.x + (40 + s * 50) * c.k, duration: 26000 + s * 18000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const hills = this.layer(8);
    const h = this.at(640, 664);
    hills.add(addImage(this, h.x, h.y, TITLE_ART.hills.key, TITLE_ART.hills.w * h.k, TITLE_ART.hills.h * h.k));
    const house = this.layer(10);
    const hs = this.at(696, 571);
    house.add(addImage(this, hs.x, hs.y, TITLE_ART.house.key, TITLE_ART.house.w * hs.k, TITLE_ART.house.h * hs.k));
    this.crowd(this.layer(14), ph);
    if (!ph) this.bubbles(this.layer(3));
    this.sparkles();
    this.followPointer();
  }

  /** 天空：竖向渐变 + 一圈慢慢摆的光带 + 中间一团柔光。画在很大的范围里，窗口怎么变都盖得住 */
  private sky(): void {
    const cv = coverOf(this);
    const y = (v: number): number => this.at(0, v).y;
    const g = this.add.graphics();
    const top = 0xffc98f;
    const mid = 0xffe2b8;
    const low = 0xfff3dc;
    g.fillStyle(top, 1).fillRect(cv.x, cv.y, cv.w, y(0) - cv.y);
    g.fillGradientStyle(top, top, mid, mid, 1).fillRect(cv.x, y(0), cv.w, y(274) - y(0));
    g.fillGradientStyle(mid, mid, low, low, 1).fillRect(cv.x, y(274), cv.w, y(608) - y(274));
    g.fillStyle(low, 1).fillRect(cv.x, y(608), cv.w, cv.y + cv.h - y(608));
    const o = this.at(640, 512);
    const rays = this.add.graphics({ x: o.x, y: o.y });
    const R = 1400 * o.k;
    for (let i = 0; i < 14; i++) {
      const a0 = Phaser.Math.DegToRad(-180 + i * (180 / 14));
      const a1 = a0 + Phaser.Math.DegToRad(180 / 14 / 2);
      rays.fillStyle(0xffffff, 0.13).fillTriangle(0, 0, Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R);
    }
    if (this.lively) this.tweens.add({ targets: rays, angle: { from: -4, to: 4 }, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const glow = this.at(640, 250);
    this.add.circle(glow.x, glow.y, 380 * glow.k, 0xfffaf0, 0.28);
    this.add.circle(glow.x, glow.y, 230 * glow.k, 0xfffaf0, 0.3);
  }

  /** 前排小人：用这局登场题材里已经加载的股票，会眨眼，轮流开心地跳一下 */
  private crowd(layer: Phaser.GameObjects.Container, ph: boolean): void {
    const themes = this.session.state.themeIds.length > 0 ? this.session.state.themeIds : THEME_IDS.slice(0, 6);
    const ids = themes.flatMap((t) => stocksOf(t).map((s) => s.id)).filter((x) => hasArt(this.textures, stockKey(x, 'calm')));
    if (ids.length === 0) return;
    CROWD.forEach(([x, y, size], i) => {
      const id = ids[(i * 5) % ids.length]!;
      const p = this.at(x, y);
      // 手机上小人再小一点（右边是模式卡，太大显得挤）
      const g = new StockGuy(this, p.x, p.y, id, i % 3 === 0 ? 'happy' : 'calm', size * p.k * (ph ? 0.85 : 1), { idle: this.lively });
      // 右边那群面朝左（朝着小屋）
      if (x > 640) g.setScale(-1, 1);
      layer.add(g);
      this.guys.push(g);
    });
    this.cheer();
  }

  /** 每隔一会儿挑一个小人涨停、跳一下 */
  private cheer(): void {
    if (!this.lively || this.guys.length === 0) return;
    let k = 0;
    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => {
        const g = this.guys[(k * 3) % this.guys.length];
        k += 1;
        if (!g?.active) return;
        g.setFace('limitup');
        g.bounce(this.anim, 0.8);
        this.time.delayedCall(900, () => g.active && g.setFace('happy'));
      },
    });
  }

  /**
   * 群聊气泡：左右各三个，进场时依次弹出，之后轻轻浮动。
   * 宽屏时贴着看得见的左右边往外挪（最多 160），给中间的卡片让出地方。
   */
  private bubbles(layer: Phaser.GameObjects.Container): void {
    const ys = [168, 248, 328];
    const B = bleedOf(this);
    const out = Phaser.Math.Clamp(-B.x, 0, 160);
    TITLE_BUBBLES.forEach((b, i) => {
      const x = b.right ? 1256 + out - b.w / 2 : 24 - out + b.w / 2;
      const y = ys[i % 3]! + b.h / 2;
      const img = addImage(this, x, y, b.key, b.w, b.h);
      layer.add(img);
      if (!this.lively) return;
      // 显示尺寸是按缩放设的（纹理按渲染倍数光栅化）：先记下来再从 0 弹到这里
      const sx = img.scaleX;
      const sy = img.scaleY;
      img.setScale(0);
      this.tweens.add({ targets: img, scaleX: sx, scaleY: sy, delay: 300 + i * 220, duration: 320, ease: 'Back.easeOut' });
      this.tweens.add({ targets: img, y: y - 4, delay: 1200 + i * 300, duration: 2200 + i * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });
  }

  /** 天上偶尔冒一颗小星星，往上飘着淡掉 */
  private sparkles(): void {
    if (!this.lively || LOW_MEMORY) return;
    const V = viewOf(this);
    this.time.addEvent({
      delay: 900,
      loop: true,
      callback: () => {
        const x = Phaser.Math.Between(0, V.w);
        const y = Phaser.Math.Between(Math.round(V.h * 0.45), Math.round(V.h * 0.8));
        const s = addImage(this, x, y, 'fx:sparkle', 14, 14).setAlpha(0);
        this.tweens.add({ targets: s, y: y - 50, alpha: { from: 0.9, to: 0 }, duration: 2400, ease: 'Sine.easeOut', onComplete: () => s.destroy() });
      },
    });
  }

  /** 电脑上随鼠标的一点视差（每层幅度不同，近的动得多） */
  private followPointer(): void {
    if (!this.lively || LOW_MEMORY || PHONE) return;
    const V = viewOf(this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const dx = Phaser.Math.Clamp((p.worldX - V.w / 2) / (V.w / 2), -1, 1);
      const dy = Phaser.Math.Clamp((p.worldY - V.h / 2) / (V.h / 2), -1, 1);
      for (const { layer, amp } of this.parallax) layer.setPosition(-dx * amp, -dy * amp * 0.4);
    });
  }

  /** 没有主视觉时：小屋背景 + 淡淡一层遮罩，本局龙头小人在桌上列队 */
  private buildRoom(ph: boolean): void {
    this.room = new Room(this, 'bull', { ambient: this.lively });
    addBackdrop(this, 0.18).disableInteractive();
    const themes = this.session.state.themeIds.length > 0 ? this.session.state.themeIds : THEME_IDS.slice(0, 6);
    const ids = themes.map((t) => stocksOf(t)[0]?.id).filter((x): x is string => !!x && hasArt(this.textures, stockKey(x, 'calm')));
    const xs = [150, 300, 980, 1130, 450, 830];
    const sc = ph ? PHONE_ART.k : 1;
    ids.slice(0, 6).forEach((id, i) => {
      this.guys.push(new StockGuy(this, (xs[i] ?? 640) * sc, viewOf(this).h - 20 * sc, id, i % 3 === 0 ? 'happy' : 'calm', 96 * sc, { idle: this.lively }));
    });
    this.cheer();
  }

  // ---------------------------------------------------------------- 卡片和入口

  /**
   * 大卡：有没打完的局时是「继续」（人设、第几月、账户），否则是「快速开始」（上次的人设和难度），
   * 第一次玩写「开始第一局」。人设立绘在 meta 图集里，到了再补上（先放一个图标）。
   */
  private hero(ph: boolean): void {
    const H = ph ? PHONE_UI.hero : DESK.hero;
    const s: GameState = this.session.state;
    const can = this.canContinue();
    const quick = this.quickSetup();
    const first = !can && this.profile.runs === 0;
    const key = can ? 'continue' : 'quick';
    const fn = can ? () => this.session.enterGame() : () => this.guardNew(() => this.startSetup(quick.persona, quick.difficulty, quick.short));
    const b = new Button(this, H.x, H.y, { width: H.w, height: H.h, label: '', variant: 'primary', onClick: fn });
    this.buttons[key] = b;
    const persona = can ? s.persona : quick.persona;
    const qd = difficultyView(quick.difficulty);
    const len = quick.short ? `短局 ${BALANCE.short.months} 个月` : '完整一年';
    const title = can ? '继续' : first ? '开始第一局' : '快速开始';
    const sub = can ? `${personaView(s.persona).name} · ${s.month}月${livePlaying(s) ? ' · 实盘' : ''}` : `${personaView(quick.persona).name} · ${qd.name} · ${len}`;
    const pw = H.h - 16;
    const tx = 16 + pw + 14;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const icon = addGlyph(this, 16 + pw / 2, H.h / 2, can ? 'calendar' : 'rocket', pw * 0.62);
    parts.push(icon);
    parts.push(addText(this, tx, ph ? 14 : 16, title, { size: ph ? 28 : 32, bold: true, color: COLOR.white, stroke: COLOR.accentDark, strokeWidth: 4 }));
    const subT = addText(this, tx, ph ? 60 : 66, sub, { size: ph ? 15 : 17, bold: true, color: COLOR.white });
    parts.push(subT);
    if (can) {
      const money = addText(this, H.w - 20, ph ? 20 : 22, formatMoney(s.account), { size: ph ? 24 : 28, bold: true, num: true, color: COLOR.white, originX: 1, stroke: COLOR.accentDark, strokeWidth: 4 });
      parts.push(money);
    }
    // 右下角留给「回车」
    fitWidth(subT, H.w - tx - (PHONE ? 20 : 56));
    if (!PHONE) parts.push(addText(this, H.w - 16, H.h - 12, '回车', { size: 12, bold: true, color: COLOR.white, originX: 1, originY: 1 }).setAlpha(0.8));
    b.addContent(...parts);
    // 人设立绘到了就换掉图标（meta 图集按需加载，开始菜单先触发一次）
    void ensureMetaArt(this.textures)
      .then(() => {
        if (!b.active || !hasArt(this.textures, personaKey(persona))) return;
        icon.destroy();
        const img = addImage(this, 16 + pw / 2, H.h / 2 + 4, personaKey(persona), pw * 0.8, pw);
        b.addContent(img);
      })
      .catch(() => undefined);
    b.tooltip(() => (can ? { title: '继续', body: `${sub}\n这局存在这台设备上` } : { title: title, body: sub }));
  }

  /** 模式卡：每日挑战、实盘（单独部署没有）、新一局；电脑上横排，手机上竖排 */
  private modeCards(ph: boolean): void {
    const date = dailyDate();
    const d = dailySetup(date);
    const items: { key: string; glyph: Glyph; title: string; sub: string; fn: () => void }[] = [
      { key: 'daily', glyph: 'calendar', title: '每日挑战', sub: `${personaView(d.setup.persona).name} · ${difficultyView(d.setup.difficulty).name}`, fn: () => this.openDaily() },
    ];
    if (!standalone()) items.push({ key: 'live', glyph: 'moneybag', title: '实盘', sub: this.liveWhy() ?? `带筹码打 ${BALANCE.live.months} 个月`, fn: () => this.openLive() });
    items.push({ key: 'new', glyph: 'star', title: '新一局', sub: '自己挑人设和难度', fn: () => this.openSetup() });
    const C = ph ? PHONE_UI.card : DESK.card;
    const total = items.length * C.w + (items.length - 1) * C.gap;
    items.forEach((it, i) => {
      const x = ph ? PHONE_UI.card.x : GAME_WIDTH / 2 - total / 2 + i * (C.w + C.gap);
      const y = ph ? PHONE_UI.card.y + i * (C.h + C.gap) : DESK.card.y;
      const b = new Button(this, x, y, { width: C.w, height: C.h, label: '', onClick: it.fn });
      this.buttons[it.key] = b;
      const g = ph ? 40 : 44;
      const parts: Phaser.GameObjects.GameObject[] = [addGlyph(this, ph ? 36 : 38, ph ? C.h / 2 : 36, it.glyph, g)];
      const tx = ph ? 70 : 70;
      parts.push(addText(this, tx, ph ? 10 : 18, it.title, { size: ph ? 19 : 20, bold: true, color: COLOR.ink }));
      const sub = addText(this, ph ? tx : 18, ph ? 42 : 66, it.sub, { size: ph ? 14 : 15, color: COLOR.muted, wrap: ph ? undefined : C.w - 32 });
      if (ph) fitWidth(sub, C.w - tx - (it.key === 'new' && this.canContinue() ? 120 : 20));
      parts.push(sub);
      b.addContent(...parts);
    });
    // 「实盘」：调试会话、没登录时变灰，悬停说原因
    const lb = this.buttons.live;
    if (lb) {
      lb.setEnabled(this.liveWhy() === null).onDenied(() => this.liveWhy());
      lb.tooltip(() => ({ title: '实盘', body: this.liveWhy() ?? `带一份筹码进场打 ${BALANCE.live.months} 个月（约 ${LIVE_MINUTES} 分钟），按最后的资产结回。筹码只是游戏里的分数，无任何现金价值。` }));
    }
    this.dailyBadge();
    // 「新一局」：有没打完的局时，大卡是「继续」，快速开始放在这张卡里
    const nb = this.buttons.new;
    if (nb) {
      const prog = codexProgress(this.profile);
      const line = profileLine(this.profile, prog.seen, prog.total, prog.ach, prog.achTotal);
      nb.tooltip(() => ({ title: '新一局', body: this.profile.runs > 0 ? line.split(' · ').join('\n') : '挑一个人设和难度开局' }));
      // 有快速开始的小按钮时这行让给它（档案进度在悬停里）
      if (this.profile.runs > 0 && !ph && !this.canContinue()) nb.addContent(addText(this, 18, C.h - 16, `通关 ${this.profile.wins}/${this.profile.runs} · 难度到 ${this.profile.maxDifficulty}`, { size: 13, color: COLOR.dim, originY: 1 }));
      if (this.canContinue()) {
        const q = this.quickSetup();
        const r = nb.rect();
        const qw = ph ? 104 : 96;
        const qh = ph ? 40 : 30;
        const qb = new Button(this, r.x + r.w - qw - (ph ? 12 : 10), ph ? r.y + (r.h - qh) / 2 : r.y + r.h - qh - 10, { width: qw, height: qh, label: '快速开始', fontSize: ph ? 15 : 13, variant: 'ghost', onClick: () => this.guardNew(() => this.startSetup(q.persona, q.difficulty, q.short)) });
        qb.setDepth(nb.depth + 1);
        const qp = personaView(q.persona);
        const qd = difficultyView(q.difficulty);
        qb.tooltip(() => ({ title: '快速开始', body: `${setupLine(qp.name, qd.level, qd.name)} · ${q.short ? `短局 ${BALANCE.short.months} 个月` : '完整一年'}` }));
        this.buttons.quick = qb;
      }
    }
  }

  /** 右上角一排小入口；图鉴、成就带着收集进度 */
  private tools(ph: boolean): void {
    const T = ph ? PHONE_UI.tools : DESK.tools;
    const prog = codexProgress(this.profile);
    const seen = this.profile.runs > 0 && !ph;
    const items: Item[] = [
      { key: 'help', label: '怎么玩', fn: () => this.openHelp() },
      { key: 'codex', label: seen ? `图鉴 ${prog.seen}/${prog.total}` : '图鉴', fn: () => this.openCodex('stocks') },
      { key: 'achievements', label: seen ? `成就 ${prog.ach}/${prog.achTotal}` : '成就', fn: () => this.openCodex('achievements') },
      { key: 'settings', label: '设置', fn: () => this.openSettings(false) },
      { key: 'about', label: '关于', fn: () => this.openAbout() },
    ];
    const pad = ph ? 20 : 26;
    const widths = items.map((it) => {
      const t = addText(this, 0, 0, it.label, { size: T.font, bold: true });
      const w = t.width;
      t.destroy();
      return Math.max(ph ? 56 : 64, Math.round(w + pad));
    });
    let x = T.right - widths.reduce((a, b) => a + b, 0) - T.gap * (items.length - 1);
    items.forEach((it, i) => {
      const w = widths[i]!;
      this.buttons[it.key] = new Button(this, x, T.y, { width: w, height: T.h, label: it.label, fontSize: T.font, onClick: it.fn });
      x += w + T.gap;
    });
  }

  /** 实盘为什么点不了（能点时为 null） */
  private liveWhy(): string | null {
    if (this.session.debugSession || !this.session.persist) return '调试的时候不能玩实盘';
    if (!hasLoginHint()) return '登录以后才能玩实盘';
    return null;
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
      short: last.short,
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

  private startSetup(persona: PersonaId, difficulty: number, short: boolean): void {
    saveLastSetup({ persona, difficulty, short });
    this.session.newRun(randomSeed(), funSetup({ persona, difficulty, short }));
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
          onStart: (p, difficulty, short) => this.guardNew(() => this.startSetup(p, difficulty, short)),
          live: mode === 'live' && wallet ? { wallet: wallet.wallet, blocked: wallet.blocked, aside: wallet.aside ?? null, tier: 'small', onStart: (p, tier, gear) => this.guardNew(() => this.startLive(p, tier, gear)) } : undefined,
          // 调试会话、没登录时没有开关（实盘按钮也是灰的）
          onMode: can ? (m, p) => this.time.delayedCall(1, () => (m === 'live' ? this.openLive(p) : this.openSetup('fun', undefined, p))) : undefined,
        }),
      );
    });
  }

  /** 点「实盘」：实盘没打完就问继续还是收手；否则先看一眼钱包，再打开实盘的开局面板 */
  private openLive(persona?: PersonaId): void {
    if (this.canContinue() && livePlaying(this.session.state)) return this.guardNew(() => undefined);
    if (this.dialogOpen || this.opening) return;
    this.opening = true;
    // 0.9.0 等钱包回话时实盘按钮自己转圈（以前是顶上一条「正在看钱包」）
    const btn = this.buttons.live;
    btn?.setLoading(true);
    void Promise.all([live.retry().then(() => live.wallet()), ensureMetaArt(this.textures).catch(() => undefined)]).then(([w]) => {
      if (btn?.scene) btn.setLoading(false);
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
  private startLive(persona: PersonaId, tier: LiveTier, gear = 1): void {
    if (this.busy) return;
    const close = showBanner('正在带入……');
    // 带入到开局（还要挑行情）之间挡住开始菜单：这时点别的会盖掉或抢在这局实盘前面
    const cv = coverOf(this);
    this.busy = this.add.rectangle(cv.x, cv.y, cv.w, cv.h, 0xffffff, 0.001).setOrigin(0, 0).setDepth(1000).setInteractive();
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
          this.session.newRun(seed, liveSetup(tier, persona, gear));
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
      // 像贴纸一样骑在卡片右上角的边上，不压标题
      tag = this.add.container(r.right - 8, r.top + 2, [addPill(this, -w, -10, w, 20, v.fresh ? COLOR.accent : COLOR.info), t]).setDepth(b.depth + 1);
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

  /**
   * 好友挑战的卡（打开链接时）：还没打过就问接不接，交过了直接看成绩，打不开说一句。
   * 接受后用发起人那一局的种子、设置和那一段行情开局；段下载失败不退回模拟行情（那就不是同一局了）。
   */
  private challengeNotice(): void {
    if (this.dialogOpen || this.busy || !this.sys.isActive()) return;
    const inv = takeInvite();
    if (!inv) return;
    if ('fail' in inv) {
      const t = CHALLENGE_FAIL[inv.fail];
      this.openNotice(t.title, t.body);
      return;
    }
    const v = inv.view;
    if (v.me) {
      this.trackDialog(new ChallengePanel(this, v));
      return;
    }
    this.trackDialog(new ChallengeInviteDialog(this, v, () => this.acceptChallenge(v)));
  }

  private acceptChallenge(v: ChallengeView): void {
    this.guardNew(() => {
      const c = acceptInvite(v);
      this.session.newRun(c.seed, c.setup, {
        segment: c.segment,
        onFail: () => this.openNotice('行情没下载下来', '这个挑战要用发起人那一段行情，现在没下载下来。过一会儿再点一次链接试试。'),
      });
    });
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

/** 好友挑战打不开时说什么（过期和不存在平台回同一个 404，开盘也说同一句） */
const CHALLENGE_FAIL: Record<ChallengeFail, { title: string; body: string }> = {
  gone: { title: '这个挑战打不开了', body: '挑战 30 天内有效，可能已经过期了，或者链接不完整。' },
  out: { title: '登录后才能接挑战', body: '先登录，再点一次链接。' },
  full: { title: '这个挑战已经满了', body: '每个挑战最多 100 个人交成绩，这个已经满了。' },
  limit: { title: '这个挑战暂时打不开', body: '服务器今天有点忙，过一会儿再点一次链接试试。' },
  busy: { title: '这个挑战暂时打不开', body: '服务器今天有点忙，过一会儿再点一次链接试试。' },
  offline: { title: '没连上', body: '挑战没读到，联网后再点一次链接试试。' },
  bug: { title: '这个挑战打不开了', body: '链接看不懂，可能不完整。' },
};
