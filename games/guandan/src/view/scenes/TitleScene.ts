/** 标题页：主视觉 + 标题字 + 开始（先选娱乐 / 实盘）/ 继续 / 接着打实盘 / 规则 / 设置 / 战绩。 */
import Phaser from 'phaser';
import { showA2hs } from '../a2hs.ts';
import { app } from '../app.ts';
import { audio } from '../audio.ts';
import { levelName } from '../labels.ts';
import { Session, randomSeed } from '../session.ts';
import { SOLO_DEALS } from '../../stake/index.ts';
import { STAKE_ERROR, TIER_NAME, signed } from '../stake-text.ts';
import { StakeSession, clearStake, loadStake, stakeExpired, stakeLeft } from '../stake.ts';
import { loadSave } from '../store.ts';
import { TYPE, minHit } from '../theme.ts';
import { goLobby } from '../lobby.ts';
import { join, openOnline } from '../online.ts';
import { currentUserId, myRoom } from '../net.ts';
import { cloudButton } from '../ui/cloud.ts';
import { Button, text, toast, worldH, worldW, type Modal } from '../ui/kit.ts';
import { confirm, openRules, openSettings, openStats } from '../ui/panels.ts';
import { openModePicker, openTierPicker } from '../ui/stake.ts';
import { standalone } from '../platform.ts';

export class TitleScene extends Phaser.Scene {
  private buttons: Record<string, Button> = {};
  private cloudBtn: Phaser.GameObjects.Container | null = null;
  private lobbyBtn: Button | null = null;
  private onlineBtn: Button | null = null;
  /** 本机记着这个账号的房间时才有 */
  private backBtn: Button | null = null;
  overlay: Modal | null = null;

  constructor() {
    super('title');
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0).setZoom(this.scale.gameSize.height / worldH);
    const W = worldW(this);
    this.buttons = {};
    this.overlay = null;
    this.add.image(0, 0, `title:${W}`).setOrigin(0, 0).setDisplaySize(W, worldH);
    // 按钮和标题字放在主视觉右侧留空的区域
    const rx = W - 300;
    // 飘落的金粉，让静态主视觉动起来
    this.add.particles(0, -10, 'particle:spark', {
      x: { min: 0, max: W },
      speedY: { min: 18, max: 50 },
      speedX: { min: -12, max: 12 },
      lifespan: 14000,
      scale: { min: 0.25, max: 0.6 },
      alpha: { start: 0.8, end: 0 },
      frequency: 420,
    }).setDepth(5);

    const logo = this.add.image(rx, 150, 'logo').setDisplaySize(440, 186).setDepth(10);
    logo.setAlpha(0).setScale(logo.scaleX * 1.25);
    this.tweens.add({ targets: logo, alpha: 1, scale: logo.scaleX / 1.25, duration: 520, ease: 'Back.easeOut' });
    this.tweens.add({ targets: logo, y: 158, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 600 });

    const save = loadSave();
    // 单机实盘的存档（只在这台设备上）：过了 24 小时钱包已经原样退回，删掉说一句；没过就在最上面给"接着打实盘"
    // 单独部署（0.8.0）没有钱包：不摆实盘（本来也不会有实盘存档，存档跟着站点走）
    let stake = standalone() ? null : loadStake();
    if (stake && stakeExpired(stake)) {
      clearStake(stake.ref);
      stake = null;
      this.time.delayedCall(600, () => toast(this, STAKE_ERROR['expired']!, W / 2, worldH - 60));
    }
    // 竖排按钮的间隔：手机横屏拉开到小按钮 + 间隔够 44 CSS 像素（minHit），电脑上 14；最多的一种（实盘或存档 + 五个按钮）底边约 690
    const gap = Math.max(14, Math.min(26, minHit() - 56));
    let y = 300;
    const add = (key: string, label: string, style: 'red' | 'gold' | 'wood', icon: string, fn: () => void, h = 64): void => {
      // 点按区域到间隔的中线为止，不互相压着
      const b = new Button(this, rx, y, 300, h, label, style, fn, icon).setDepth(20).setHit(300, h + gap);
      this.buttons[key] = b;
      b.setAlpha(0);
      b.x += 40;
      this.tweens.add({ targets: b, alpha: 1, x: rx, duration: 320, delay: 200 + Object.keys(this.buttons).length * 70, ease: 'Cubic.easeOut' });
      y += h + gap;
    };
    const saved = save && save.state.phase !== 'gameOver' ? `第 ${save.state.dealNo} 副 · 我方 ${levelName(save.state.levels[0])} · 对方 ${levelName(save.state.levels[1])}` : null;
    // 夹在上一个按钮的底边（y - gap - 32）和下一个按钮的顶边（y + 18 - 32）正中
    const subLine = (s: string): Phaser.GameObjects.Text => {
      const t = text(this, rx, y - 23 - gap / 2, s, { size: TYPE.small, color: 0xf6e4c0, stroke: 0x1a0e07, strokeWidth: 4 }).setDepth(20);
      y += 18;
      return t;
    };
    if (stake) {
      // 娱乐的"继续"挪进"开始"的弹层里（标题页竖着放不下两个"继续"）
      const left = stakeLeft(stake);
      add('stake', stake.settle ? '结算上次的实盘' : '接着打实盘', 'red', 'play', () => this.resumeStake());
      const line = subLine(`${TIER_NAME[stake.tier]} · 打完 ${left.dealsDone}/${SOLO_DEALS} 副 · ${signed(left.points)} 分`);
      add('new', '开始', 'gold', 'restart', () => this.pickMode(saved));
      // 换了账号的人看不到上一个人的实盘（存档留着，那一份到期退回给原来的账号）
      const ref = stake.ref;
      const owner = stake.userId;
      void currentUserId().then((uid) => {
        if (uid === owner || !this.sys.isActive() || loadStake()?.ref !== ref) return;
        this.buttons['stake']?.setVisible(false).disableInteractive();
        line.setVisible(false);
      });
    } else if (saved) {
      add('continue', '继续', 'red', 'play', () => this.continueGame());
      subLine(saved);
      add('new', '开始新局', 'gold', 'restart', () => this.pickMode(saved));
    } else {
      add('new', '开始', 'red', 'play', () => this.pickMode(null));
    }
    const small = (key: string, label: string, icon: string, fn: () => void): void => add(key, label, 'wood', icon, fn, 56);
    small('rules', '规则', 'rules', () => (this.overlay = openRules(this)));
    small('settings', '设置', 'settings', () => (this.overlay = openSettings(this)));
    small('stats', '战绩', 'stats', () => (this.overlay = openStats(this)));

    this.cloudBtn = cloudButton(this, W - 44, 44, 52).setDepth(20);
    // 回大厅（平台首页）：标题页不在对局中，直接走（打到一半的局本来就存着）。
    // 单独部署没有账号和大厅：不摆云存档；标题页就是游戏首页，"首页"按钮只在牌桌上有
    this.lobbyBtn = new Button(this, 74, 40, 120, 52, '大厅', 'wood', () => goLobby(), 'home').setDepth(20);
    if (standalone()) {
      this.cloudBtn.setVisible(false);
      this.lobbyBtn.setVisible(false).disableInteractive();
    }
    // 好友房（联机，0.3.0 起一直露出）。本机记着这个账号刚才的房间（回大厅、关了页面）时旁边再给一个"回到房间"，一下就回去；
    // 先问平台现在是谁，换了账号的人看不到上一个人的房间。"好友房"里也有"回到刚才的房间"
    // 单独部署没有"大厅"：好友房、回到房间往左挪到它的位置
    const dx = standalone() ? -130 : 0;
    this.onlineBtn = new Button(this, 226 + dx, 40, 160, 52, '好友房', 'red', () => openOnline(), 'cards').setDepth(20);
    this.backBtn = null;
    void myRoom().then((back) => {
      if (!back || !this.sys.isActive() || this.backBtn) return;
      this.backBtn = new Button(this, 408 + dx, 40, 180, 52, '回到房间', 'wood', () => join(back.code, back.host), 'cards').setDepth(20);
    });

    text(this, W - 16, worldH - 14, `v${__APP_VERSION__}`, { size: 14, color: 0xd8c6a6, ox: 1, oy: 1 }).setDepth(20);
    audio.music('title');
    showA2hs(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => showA2hs(false));
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

  /** 先选娱乐 / 实盘（docs/stake.md 2.1）。娱乐照旧：有存档时"开新局"先确认 */
  pickMode(saved: string | null): void {
    const onNew = (): void => {
      if (saved) this.overlay = confirm(this, '重新开一局？现在这局的进度会丢掉', '开新局', () => this.newGame());
      else this.newGame();
    };
    // 单独部署没有实盘：不用选娱乐 / 实盘，直接开（"继续"在标题页上另有按钮）
    if (standalone()) return onNew();
    this.overlay = openModePicker(this, {
      saved,
      onContinue: () => this.continueGame(),
      onNew,
      onStake: () => (this.overlay = openTierPicker(this, (ses) => this.startStake(ses))),
    });
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
    if (this.onlineBtn) out['online'] = { x: this.onlineBtn.x, y: this.onlineBtn.y };
    if (this.backBtn) out['back'] = { x: this.backBtn.x, y: this.backBtn.y };
    // 弹层里的按钮（选模式、选档位）：坐标是弹层里的，加上弹层的位置
    const body = this.overlay?.root.scene ? this.overlay.body : null;
    for (const [k, v] of Object.entries((body?.data?.getAll() ?? {}) as Record<string, unknown>)) {
      if (!k.startsWith('btn:') || !(v instanceof Button) || !v.scene || !v.enabled) continue;
      out[k.slice(4)] = { x: body!.x + v.x, y: body!.y + v.y };
    }
    return out;
  }
}

