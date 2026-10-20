/** 主页（标题页）：分层主视觉 + 面板（主按钮、模式卡、战绩），art-v3 PR ①。 */

import Phaser from 'phaser';
import { showA2hs } from '../a2hs.ts';
import { app } from '../app.ts';
import { audio } from '../audio.ts';
import { levelName } from '../labels.ts';
import { Session, randomSeed } from '../session.ts';
import { SOLO_DEALS, type TierId } from '../../variants/guandan/stake/index.ts';
import { LENGTH_CARD, LEVEL_CARD, STAKE_ERROR, TIER_NAME, signed, stakeError } from '../stake-text.ts';
import { StakeSession, buyinStake, clearStake, loadStake, stakeExpired, stakeLeft } from '../stake.ts';
import { getSettings, getStats, loadSave, updateSettings } from '../store.ts';
import { COLOR, RADIUS, TYPE, minHit } from '../theme.ts';
import { FIGURE_SIZE, LANTERN_SIZE, homeLayout } from '../home-layout.ts';
import { LOW_MEMORY } from '../device.ts';
import { anim } from '../anim.ts';
import { goLobby } from '../lobby.ts';
import { join, openMatch, openOnline } from '../online.ts';
import { currentUserId, myRoom } from '../net.ts';
import { cloudButton } from '../ui/cloud.ts';
import { Button, ModeCard, iconButton, setHit, text, toast, worldH, worldW, type ButtonStyle, type Modal } from '../ui/kit.ts';
import { confirm, openRules, openSettings, openStats } from '../ui/panels.ts';
import { openLevelPicker, openTierPicker } from '../ui/stake.ts';
import { standalone } from '../platform.ts';

/** 一句玩法：不会掼蛋的人也知道这是什么 */
const PITCH = '两两搭档，先出完牌、先打过 A 的一队赢';

/** screen= 只在打开页面后的第一次主页生效，回到主页不再弹 */
let screenOpened = false;

export class TitleScene extends Phaser.Scene {
  private buttons: Record<string, Phaser.GameObjects.Container> = {};
  private cloudBtn: Phaser.GameObjects.Container | null = null;
  private lobbyBtn: Button | null = null;
  /** 本机记着这个账号的房间时才有 */
  private backBtn: Button | null = null;
  overlay: Modal | null = null;

  constructor() {
    super('title');
  }

  /**
   * 主页（art-v3 PR ①，docs/art-v3.md 第 4 节）：左边分层主视觉（背景、能摆的灯笼、四个人），右边一块面板：
   * 标题、一句玩法、主按钮（接着打实盘 / 继续上局 / 快速开始）、模式卡（娱乐 / 实盘 / 好友房）、战绩小条。
   * 规则、设置、战绩、云存档是右上角的图标。控件名：resumeStake、continue、quick、fun、stake、online、back、lobby、rules、settings、stats、cloud
   */
  create(): void {
    this.cameras.main.setOrigin(0, 0).setZoom(this.scale.gameSize.height / worldH);
    const W = worldW(this);
    const L = homeLayout(W);
    const P = L.panel;
    // 灯笼晃、人物呼吸、火星：省内存设备和关了动画（anim=0、截图）时不开
    const lively = LOW_MEMORY === 0 && !anim.instant;
    this.buttons = {};
    this.overlay = null;
    this.add.image(0, 0, `title:${W}`).setOrigin(0, 0).setDisplaySize(W, worldH);

    // 灯笼轻摆、四个人轻轻起伏（错开节奏）；省内存模式只摆静图
    for (const [i, l] of L.lanterns.entries()) {
      const img = this.add.image(l.x, l.y, 'home:lantern').setOrigin(0.5, LANTERN_SIZE.pivotY / LANTERN_SIZE.h).setDisplaySize(LANTERN_SIZE.w * l.s, LANTERN_SIZE.h * l.s).setDepth(2);
      if (lively) {
        img.setAngle(-2.5);
        this.tweens.add({ targets: img, angle: 2.5, duration: 2600 + i * 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 700 });
      }
    }
    for (const [i, fg] of L.figures.entries()) {
      const w = FIGURE_SIZE.w * fg.s;
      const h = FIGURE_SIZE.h * fg.s;
      const img = this.add.image(fg.x, fg.y, `home:fig:${fg.id}`).setOrigin(0.5, FIGURE_SIZE.footY / FIGURE_SIZE.h).setDisplaySize(w, h).setAngle(fg.tilt).setDepth(3 + i);
      if (lively) this.tweens.add({ targets: img, y: fg.y - 4, scaleY: img.scaleY * 1.012, duration: 1700 + i * 230, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 420 });
    }
    if (lively) {
      // 飘落的金粉，灯下的热闹
      this.add.particles(0, -10, 'particle:spark', {
        x: { min: 0, max: L.artW },
        speedY: { min: 18, max: 50 },
        speedX: { min: -12, max: 12 },
        lifespan: 14000,
        scale: { min: 0.25, max: 0.6 },
        alpha: { start: 0.8, end: 0 },
        frequency: 520,
      }).setDepth(8);
    }

    // 右边的面板：深漆底、金边
    const g = this.add.graphics().setDepth(10);
    // 卡通风格（0.27.0；0.27.1 补质感）：柔和投影、深墨下沿、暖棕面板上亮下暗、深墨描边，里面一圈金线
    g.fillStyle(0x000000, 0.25).fillRoundedRect(P.x - 6, P.y + 14, P.w + 12, P.h + 4, RADIUS.xl + 4);
    g.fillStyle(0x2b1d14, 1).fillRoundedRect(P.x, P.y + 8, P.w, P.h, RADIUS.xl);
    g.fillStyle(0x2a160c, 0.96).fillRoundedRect(P.x, P.y, P.w, P.h, RADIUS.xl);
    g.fillStyle(0x4a2a16, 0.9).fillRoundedRect(P.x, P.y, P.w, P.h * 0.35, { tl: RADIUS.xl, tr: RADIUS.xl, bl: 0, br: 0 });
    g.lineStyle(3, 0x2b1d14, 1).strokeRoundedRect(P.x, P.y, P.w, P.h, RADIUS.xl);
    g.lineStyle(2, COLOR.gold, 0.8).strokeRoundedRect(P.x + 8, P.y + 8, P.w - 16, P.h - 16, RADIUS.xl - 6);
    const cx = P.x + P.w / 2;
    const inner = P.w - 48;

    const logo = this.add.image(cx, P.y + 92, 'logo').setDisplaySize(380, 161).setDepth(20);
    if (lively) {
      logo.setAlpha(0).setScale(logo.scaleX * 1.2);
      this.tweens.add({ targets: logo, alpha: 1, scale: logo.scaleX / 1.2, duration: 520, ease: 'Back.easeOut' });
    }
    text(this, cx, P.y + 186, PITCH, { size: TYPE.label, color: 0xf6e4c0 }).setDepth(20);

    const save = loadSave();
    // 单机实盘的存档（只在这台设备上）：过了 24 小时钱包已经原样退回，删掉说一句；没过就把主按钮换成"接着打实盘"
    // 单独部署（0.8.0）没有钱包：不摆实盘（本来也不会有实盘存档，存档跟着站点走）
    let stake = standalone() ? null : loadStake();
    if (stake && stakeExpired(stake)) {
      clearStake(stake.ref);
      stake = null;
      this.time.delayedCall(600, () => toast(this, STAKE_ERROR['expired']!, W / 2, worldH - 60));
    }
    const saved = save && save.state.phase !== 'gameOver' ? `第 ${save.state.dealNo} 副 · 我方 ${levelName(save.state.levels[0])} · 对方 ${levelName(save.state.levels[1])}` : null;
    const by = P.y + 256;
    const primary = (key: string, label: string, sub: string, fn: () => void): { btn: Button; line: Phaser.GameObjects.Text } => {
      const btn = new Button(this, cx, by, inner, 72, label, 'red', fn, 'play').setDepth(20);
      this.buttons[key] = btn;
      const line = text(this, cx, by + 52, sub, { size: TYPE.small, color: 0xf6e4c0 }).setDepth(20);
      return { btn, line };
    };
    if (stake) {
      const left = stakeLeft(stake);
      const { btn, line } = primary('resumeStake', stake.settle ? '结算上次的实盘' : '接着打实盘', `${TIER_NAME[stake.tier]} · 打完 ${left.dealsDone}/${SOLO_DEALS} 副 · ${signed(left.points)} 分`, () => this.resumeStake());
      // 换了账号的人看不到上一个人的实盘（存档留着，那一份到期退回给原来的账号），主按钮换回"快速开始"
      const ref = stake.ref;
      const owner = stake.userId;
      void currentUserId().then((uid) => {
        if (uid === owner || !this.sys.isActive() || loadStake()?.ref !== ref) return;
        btn.destroy();
        line.destroy();
        delete this.buttons['resumeStake'];
        this.addQuick(primary, saved);
      });
    } else this.addQuick(primary, saved);

    // 模式卡：娱乐（选难度）、实盘（选档）、好友房；单独部署没有实盘
    const modes: [string, string, string, ButtonStyle, string, () => void][] = [
      ['fun', '娱乐', '随便玩', 'green', 'robot', () => this.pickFun(saved)],
      ...(standalone() ? [] : [['stake', '实盘', '带一份筹码', 'gold', 'crown', () => this.pickStake()] as [string, string, string, ButtonStyle, string, () => void]]),
      ['online', '好友房', '叫朋友来', 'blue', 'cards', () => openOnline()],
    ];
    const gap = 16;
    const cw = (inner - gap * (modes.length - 1)) / modes.length;
    const cy = P.y + 402;
    modes.forEach(([key, name, desc, style, icon, fn], i) => {
      const card = new ModeCard(this, P.x + 24 + cw / 2 + i * (cw + gap), cy, cw, 150, name, desc, style, icon, fn).setDepth(20);
      this.buttons[key] = card;
      if (lively) {
        card.setAlpha(0);
        this.tweens.add({ targets: card, alpha: 1, y: { from: cy + 24, to: cy }, duration: 320, delay: 200 + i * 80, ease: 'Cubic.easeOut' });
      }
    });

    // 战绩小条：点了打开战绩；新账号给一句空状态
    const st = getStats();
    const sy = P.y + P.h - 62;
    const strip = this.add.graphics().setDepth(19);
    strip.fillStyle(0xffffff, 0.06).fillRoundedRect(P.x + 24, sy - 30, inner, 60, RADIUS.lg);
    const line = st.games > 0
      ? `胜率 ${Math.round((st.wins / st.games) * 100)}%  ·  最高连胜 ${st.bestStreak}  ·  头游 ${st.firsts} 次`
      : '打完第一局，这里会记下你的战绩';
    text(this, cx, sy, line, { size: TYPE.label, color: st.games > 0 ? COLOR.goldLight : 0xd8c6a6 }).setDepth(20);
    // 条只有 60 高，手机横屏缩下来不到 44 CSS 像素：点按区按 minHit() 往上下扩（上面的模式卡底边离得够远）
    const statsH = Math.max(60, minHit());
    const statsHit = this.add.zone(cx, sy, inner, statsH).setDepth(21);
    setHit(statsHit, inner, statsH);
    statsHit.on('pointerup', () => (this.overlay = openStats(this)));

    // 右上角：规则、设置、战绩、云存档（图标），左上角：回大厅、回到房间
    const icons: [string, string, () => void][] = [
      ['rules', 'rules', () => (this.overlay = openRules(this))],
      ['settings', 'settings', () => (this.overlay = openSettings(this))],
      ['stats', 'stats', () => (this.overlay = openStats(this))],
    ];
    const step = Math.max(64, minHit() + 4);
    let ix = W - 44;
    this.cloudBtn = cloudButton(this, ix, 44, 52).setDepth(20);
    if (standalone()) this.cloudBtn.setVisible(false);
    else ix -= step;
    for (const [key, icon, fn] of icons) {
      this.buttons[key] = iconButton(this, ix, 44, icon, fn, 52).setDepth(20);
      ix -= step;
    }
    // URL 的 screen=rules|settings|stats（截图用，params.ts）：主页起来后直接打开那个弹窗，整个页面只开一次
    const want = icons.find(([key]) => key === app.params?.screen);
    if (want && !screenOpened) {
      screenOpened = true;
      want[2]();
    }
    // 回大厅（平台首页）：主页不在对局中，直接走。单独部署没有账号和大厅：主页就是游戏首页
    this.lobbyBtn = new Button(this, 74, 40, 120, 52, '大厅', 'wood', () => goLobby(), 'home').setDepth(20);
    if (standalone()) this.lobbyBtn.setVisible(false).disableInteractive();
    // 本机记着这个账号刚才的房间（回大厅、关了页面）时左上角给"回到房间"，先问平台现在是谁，换了账号的人看不到上一个人的房间
    const bx = standalone() ? 108 : 244;
    this.backBtn = null;
    void myRoom().then((back) => {
      if (!back || !this.sys.isActive() || this.backBtn) return;
      this.backBtn = new Button(this, bx, 40, 180, 52, '回到房间', 'red', () => join(back.code, back.host), 'cards').setDepth(20);
    });

    text(this, W - 16, worldH - 10, `v${__APP_VERSION__}`, { size: TYPE.small, color: 0xb8a690, ox: 1, oy: 1 }).setDepth(20).setAlpha(0.7);
    audio.music('title');
    showA2hs(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => showA2hs(false));
  }

  /** 主按钮：有娱乐存档时"继续上局"，没有就"快速开始"（按上次选的难度直接开一局娱乐） */
  private addQuick(primary: (key: string, label: string, sub: string, fn: () => void) => unknown, saved: string | null): void {
    if (saved) primary('continue', '继续上局', saved, () => this.continueGame());
    else {
      const s = getSettings();
      primary('quick', '快速开始', `娱乐 · ${LEVEL_CARD[s.difficulty].name} · ${LENGTH_CARD[s.length].name}`, () => this.newGame());
    }
  }

  /** 弹层（规则、设置、战绩）开着时不重建画面；关掉后 root 已销毁，scene 为空 */
  canRebuild(): boolean {
    return !this.overlay?.root.scene;
  }

  continueGame(): void {
    const ses = Session.restore();
    if (!ses) {
      this.newGame();
      return;
    }
    app.session = ses;
    this.scene.start('table');
  }

  newGame(seed = randomSeed()): void {
    app.session = Session.fresh(seed);
    this.scene.start('table');
  }

  /** 娱乐：先选难度（docs/balance.md 第 3 节：新手 / 普通 / 高手），有存档时再确认一次 */
  pickFun(saved: string | null): void {
    const s = getSettings();
    const fresh = (): void => {
      if (saved) this.overlay = confirm(this, '重新开一局？现在这局的进度会丢掉', '开新局', () => this.newGame());
      else this.newGame();
    };
    this.overlay = openLevelPicker(
      this,
      s.difficulty,
      s.length,
      (difficulty, length) => {
        updateSettings({ difficulty, length });
        fresh();
      },
      // 快速匹配（0.26.0）：排不到就按现在的难度、局长开一局单机
      () => openMatch(null, () => this.scene.isActive() && fresh()),
    );
  }

  /** 实盘：选档位（docs/stake.md 2.1）；快速匹配排不到就转这一档的单机（照常带入一份） */
  pickStake(): void {
    this.overlay = openTierPicker(
      this,
      (ses) => this.startStake(ses),
      (tier) => openMatch(tier, () => void this.soloStake(tier)),
    );
  }

  private async soloStake(tier: TierId): Promise<void> {
    if (!this.scene.isActive()) return;
    const r = await buyinStake(tier);
    if (!this.scene.isActive()) return;
    if (r.ok) this.startStake(r.ses);
    else toast(this, stakeError(r.error), worldW(this) / 2, worldH - 60);
  }

  startStake(ses: StakeSession): void {
    app.session = ses;
    this.scene.start('table');
  }

  resumeStake(): void {
    const s = loadStake();
    if (!s) {
      this.scene.restart();
      return;
    }
    this.startStake(new StakeSession(s));
  }

  controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, b] of Object.entries(this.buttons)) out[k] = { x: b.x, y: b.y };
    if (this.cloudBtn?.visible) out['cloud'] = { x: this.cloudBtn.x, y: this.cloudBtn.y };
    if (this.lobbyBtn?.visible) out['lobby'] = { x: this.lobbyBtn.x, y: this.lobbyBtn.y };
    if (this.backBtn) out['back'] = { x: this.backBtn.x, y: this.backBtn.y };
    // 弹层里的按钮（选模式、选档位）：坐标是弹层里的，加上弹层的位置
    const body = this.overlay?.root.scene ? this.overlay.body : null;
    for (const [k, v] of Object.entries((body?.data?.getAll() ?? {}) as Record<string, unknown>)) {
      // 选项组（局长、和电脑 / 快速匹配）：每一项叫 <名字>:<第几项>
      if (k.startsWith('seg:') && v instanceof Phaser.GameObjects.Container) {
        v.list.filter((o) => o instanceof Phaser.GameObjects.Zone).forEach((z, i) => {
          const zone = z as Phaser.GameObjects.Zone;
          out[`${k.slice(4)}:${i}`] = { x: body!.x + v.x + zone.x, y: body!.y + v.y + zone.y };
        });
        continue;
      }
      if (!k.startsWith('btn:') || !(v instanceof Button) || !v.scene || !v.enabled) continue;
      out[k.slice(4)] = { x: body!.x + v.x, y: body!.y + v.y };
    }
    return out;
  }
}

