/**
 * 牌桌：播放核心给出的事件（发牌、进贡、出牌、炸弹、接风、名次、结算），并把玩家的操作交给核心。
 *
 * 节奏：dispatch → 拿到事件 → 逐个 await 播放 → 用 viewFor 刷新静态画面（sync）→ pump 决定下一步
 * （轮到电脑就"想一会儿"再出；轮到我就打开按钮；一副结束弹结算）。画面不自己算规则：
 * 能不能出、怎么解释一手牌、提示，全部来自 src/core 和 src/ai。
 */
import Phaser from 'phaser';
import { hintList } from '../../ai/index.ts';
import {
  beats,
  canPass,
  hint,
  interpret,
  isBomb,
  partnerOf,
  samePlayShape,
  teamOf,
  type Action,
  type Card,
  type DealResult,
  type GameEvent,
  type Play,
  type PlayerView,
} from '../../core/index.ts';
import type { Mood } from '../art/index.ts';
import { app } from '../app.ts';
import { audio } from '../audio.ts';
import { dur, tweenP, wait } from '../anim.ts';
import { PLACE_NAMES, levelName, playDetail, playLabel, seatIdentity, seatName, seatPerson } from '../labels.ts';
import { NetSession, closeText, createRoom, errorText, type NetEvent } from '../net.ts';
import { lineFor, talkChance, thinkTime, type Situation } from '../personas.ts';
import { ME, Session, randomSeed, type TableSession } from '../session.ts';
import { ROOM_DEALS, SOLO_DEALS, dealPoints, pointValue } from '../../stake/index.ts';
import type { StakeView } from '../../net/stake.ts';
import type { Again } from '../../net/rules.ts';
import { flashTitle, stopFlash, vibrate } from '../attention.ts';
import { countLeft } from '../counter.ts';
import { ROOM_STAKE_TEXT, STAKE_ERROR, STAKE_TEXT, TIER_NAME, fmtChips, roomWhy, signed, stakeError } from '../stake-text.ts';
import { StakeSession, buyinStake, refundStake, settleStake, type SettleOutcome } from '../stake.ts';
import { dealRecap } from '../recap.ts';
import { suggestFor } from '../suggest.ts';
import { TITLE_INFO, dealTitles, emptyMatchLog, logDeal, matchTitles, type Title } from '../../stake/titles.ts';
import { getSettings, getStats, tutorialDone, updateSettings } from '../store.ts';
import { COLOR, TYPE, css } from '../theme.ts';
import { goLobby, inGame, inOnlineGame, leaveText } from '../lobby.ts';
import { join, shareRoom } from '../online.ts';
import { cloudButton } from '../ui/cloud.ts';
import { Button, iconButton, modal, text, toast, worldH, worldW, type Modal } from '../ui/kit.ts';
import { applyAudio, confirm, openRules, openSettings } from '../ui/panels.ts';
import { runTutorial } from '../tutorial.ts';
import { CardView } from '../table/card.ts';
import { banner, bigWord, burst, flash, rain, rays, shake } from '../table/fx.ts';
import { HandView } from '../table/hand.ts';
import { BUTTON_Y, TOPBAR_H, seatAnchors } from '../table/layout.ts';
import { SeatView } from '../table/seats.ts';
import { Taunts } from '../table/taunt.ts';
import { TrickView } from '../table/trick.ts';

type Overlay = 'settle' | 'gameOver' | 'stake' | 'choose' | 'menu' | 'tutorial' | null;


export class TableScene extends Phaser.Scene {
  private ses!: TableSession;
  private hand!: HandView;
  private seats: SeatView[] = [];
  private trick!: TrickView;
  private btnPlay!: Button;
  private btnPass!: Button;
  private btnHint!: Button;
  private btnSort!: Button;
  private btnClear!: Button;
  private btnPrev!: Button;
  /** 好友房里我走开了、房间在快速替我出时的"我回来了"（0.6.3） */
  private btnBack: Button | undefined;
  /** 记牌器（或收起后的小签）的中心，冒烟点它 */
  private counterAt: { x: number; y: number } | null = null;
  /** 好友房的嘲讽、表情、道具（只在联机时有） */
  private taunts: Taunts | null = null;
  /** 读秒嘀嗒：上一声对应的格子（同一格不重复响） */
  private tickSlot = -1;
  /** 好友房轮到我（标题闪、振动只在刚轮到时来一次） */
  private myNetTurn = false;
  /** 整局称号用：攒到第几副了（场景重开不清，新的一局从第 1 副重新攒） */
  private matchLog = emptyMatchLog();
  /** 这一副播过几次接风（结算页的复盘用；重连后只算之后看到的） */
  private dealJiefeng = 0;
  private loggedDeal = 0;
  private status!: Phaser.GameObjects.Text;
  private statusBg!: Phaser.GameObjects.Graphics;
  private top!: Phaser.GameObjects.Container;
  private busy = false;
  private botTimer: Phaser.Time.TimerEvent | null = null;
  private botSeat = -1;
  /** 提示轮换的列表；null 表示"建议不要"（高手判断该让，比如队友的牌已经够大） */
  private hints: (Play | null)[] = [];
  private hintIdx = 0;
  private hintStep = -1;
  overlay: Overlay = null;
  private overlayModal: Modal | null = null;
  /** 好友房结算页上"还在等谁"那行字 */
  private settleWait: Phaser.GameObjects.Text | null = null;
  private soundIcon: Phaser.GameObjects.Container | null = null;
  private cloudBtn: Phaser.GameObjects.Container | null = null;
  private inviteBtn: Phaser.GameObjects.Container | null = null;
  /** 再来一场：正在去新房间（只去一次）。我开的新房间的码记在会话上（NetSession.againCode），场景重开（重连）也不丢 */
  private following = false;
  private lobbyBtn: Button | undefined;
  /** 好友房实盘：带入被拒以后的"重新带入"（冒烟点它） */
  private rebuyBtn: Button | undefined;
  /** 画面建了几次（冒烟核对地址栏收放时没有重建） */
  builds = 0;
  /** 顶栏右边四个图标（冒烟检查它们在可见区内） */
  private topIcons: Phaser.GameObjects.Container[] = [];
  private alive = true;
  /** 调试/冒烟：最近一次 dispatch 的错误 */
  lastError: string | null = null;
  /** 实盘：这一场结算的结果（冒烟看） */
  stakeOutcome: SettleOutcome | null = null;
  /** 实盘：最后一副的结算页看过了（之后直接弹这一场的结算） */
  private stakeDealSeen = false;
  /** 好友房实盘的结算页上"结回了没有"那行字（房间办完结回后刷新） */
  private netStakeStatus: Phaser.GameObjects.Text | null = null;
  /** 调试：已播放的大字特效（冒烟断言用） */
  readonly fxLog: string[] = [];

  constructor() {
    super('table');
  }

  create(): void {
    this.builds++;
    this.alive = true;
    this.busy = false;
    this.overlay = null;
    this.overlayModal = null;
    // 场景重开（重连的全量快照）时旧的按钮、面板已经随场景销毁
    this.taunts = null;
    this.following = false;
    this.botTimer = null;
    this.seats = [];
    this.stakeOutcome = null;
    this.stakeDealSeen = false;
    this.netStakeStatus = null;
    this.cameras.main.setOrigin(0, 0).setZoom(app.game ? app.game.scale.gameSize.height / worldH : 1);
    this.events.once('shutdown', () => {
      this.alive = false;
      this.hand?.destroy();
    });
    this.ses = app.net ?? app.session!;
    const net = this.net;
    if (net) {
      net.begin();
      const off = net.on((kind, detail) => this.onNet(kind, detail));
      this.events.once('shutdown', off);
      // 这一手的倒计时（房间给的截止时间）
      this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateClocks() });
    }
    const W = worldW(this);
    this.add.image(0, 0, `table:${W}`).setOrigin(0, 0).setDisplaySize(W, worldH);

    const anchors = seatAnchors(W);
    for (let s = 0; s < 4; s++) this.seats.push(new SeatView(this, s, anchors[s]!));
    this.trick = new TrickView(this, anchors);
    this.hand = new HandView(this);
    this.hand.onChange = () => this.refreshButtons();
    this.buildButtons(W);
    this.buildTopBar(W);
    if (net) this.buildTaunts();
    audio.music('table');

    const evs = this.ses.lastEvents;
    this.ses.lastEvents = [];
    if (evs.some((e) => e.type === 'dealStart')) {
      // 新开的局（或跳转）：从事件播放发牌
      this.sync(false, true);
      void this.playEvents(evs);
    } else {
      this.sync(false);
      this.restoreTrick();
      this.pump();
    }
  }

  // ───────────────────────── 搭建 ─────────────────────────

  private buildButtons(W: number): void {
    const cx = W / 2;
    this.btnPass = new Button(this, cx - 200, BUTTON_Y, 168, 60, '不要', 'wood', () => this.onPass(), 'pass');
    this.btnHint = new Button(this, cx, BUTTON_Y, 168, 60, '提示', 'gold', () => this.onHint(), 'hint');
    this.btnPlay = new Button(this, cx + 200, BUTTON_Y, 168, 60, '出牌', 'red', () => this.onPlay(), 'play');
    this.btnSort = new Button(this, cx - 410, BUTTON_Y + 4, 138, 52, '理牌', 'green', () => this.onSort(), 'sort');
    this.btnClear = new Button(this, cx + 410, BUTTON_Y + 4, 138, 52, '重选', 'blue', () => this.onClear(), 'undo');
    this.btnPrev = new Button(this, cx + 548, BUTTON_Y + 4, 112, 52, '上一墩', 'wood', () => this.showPrevTrick());
    for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear, this.btnPrev]) b.setDepth(400);
    // 连着两手没自己出，房间每手几秒就替我出（0.6.3）：点一下恢复 30 秒；自己出一手也一样
    const net = this.net;
    this.btnBack = net
      ? new Button(this, cx, BUTTON_Y - 104, 240, 60, '我回来了', 'red', () => {
          net.back();
          this.btnBack?.setVisible(false);
        }).setDepth(401).setVisible(false)
      : undefined;
    this.statusBg = this.add.graphics().setDepth(399);
    this.status = text(this, cx, BUTTON_Y - 50, '', { size: TYPE.label, color: 0xfff3d6, bold: true }).setDepth(400);
  }

  /** 好友房的嘲讽系统（table/taunt.ts）：聊天按钮、点头像、催促炸弹；动画在 kit 的 DOM 图层上，弹窗开着时藏起来 */
  private buildTaunts(): void {
    const t = new Taunts({
      scene: this,
      net: this.net!,
      seats: this.seats,
      avatarRect: (seat) => this.screenRect(this.seats[seat]!.a),
      busy: () => this.overlay !== null,
      log: (line) => this.fxLog.push(line),
    });
    this.taunts = t;
    this.events.once('shutdown', () => stopFlash());
  }

  /** 头像（世界坐标）在屏幕上的矩形：画布的 CSS 矩形 × 世界到 CSS 的比例（相机 zoom 后画布高 = worldH） */
  private screenRect(a: { ax: number; ay: number; size: number }): { left: number; top: number; width: number; height: number } {
    const r = this.game.canvas.getBoundingClientRect();
    const f = r.height / worldH;
    return { left: r.left + (a.ax - a.size / 2) * f, top: r.top + (a.ay - a.size / 2) * f, width: a.size * f, height: a.size * f };
  }

  private setStatus(msg: string, warn = false): void {
    this.status.setText(msg);
    this.statusBg.clear();
    if (!msg) return;
    const w = this.status.width + 32;
    this.statusBg.fillStyle(warn ? 0x8a1a20 : 0x1a120c, warn ? 0.92 : 0.7).fillRoundedRect(this.status.x - w / 2, this.status.y - 16, w, 32, 16);
    this.statusBg.lineStyle(1.5, warn ? 0xffb0a0 : COLOR.gold, 0.7).strokeRoundedRect(this.status.x - w / 2, this.status.y - 16, w, 32, 16);
  }

  /** 按钮跳两下，指给玩家看"该点这个"。 */
  private pulse(b: Button): void {
    this.tweens.killTweensOf(b);
    b.setScale(1);
    this.tweens.add({ targets: b, scale: 1.12, duration: dur(160), yoyo: true, repeat: 1, ease: 'Sine.easeInOut', onComplete: () => b.setScale(1) });
  }

  private buildTopBar(W: number): void {
    this.top?.destroy();
    const c = this.add.container(0, 0).setDepth(900);
    this.top = c;
    this.counterAt = null;
    const g = this.add.graphics();
    g.fillStyle(0x1a0e07, 0.78).fillRect(0, 0, W, TOPBAR_H);
    g.lineStyle(2, COLOR.gold, 0.7).lineBetween(0, TOPBAR_H, W, TOPBAR_H);
    g.lineStyle(1, COLOR.gold, 0.3).lineBetween(0, TOPBAR_H - 4, W, TOPBAR_H - 4);
    c.add(g);
    const v = this.ses.view();
    // 左：两队级数
    const team = (x: number, label: string, lv: number, color: number, active: boolean, fails: number): void => {
      const tg = this.add.graphics();
      tg.fillStyle(color, active ? 1 : 0.55).fillRoundedRect(x, 9, 132, 40, 20);
      if (active) tg.lineStyle(2.5, COLOR.goldLight, 1).strokeRoundedRect(x, 9, 132, 40, 20);
      c.add(tg);
      c.add(text(this, x + 16, 29, label, { size: TYPE.label, color: 0xffffff, bold: true, ox: 0 }));
      c.add(text(this, x + 106, 29, levelName(lv), { size: TYPE.title, color: COLOR.goldLight, bold: true, font: 'num', stroke: 0x2b1d14, strokeWidth: 3 }));
      if (fails > 0) c.add(text(this, x + 132, 10, `A×${fails}`, { size: 14, color: 0xffd0c0, bold: true, ox: 1, oy: 0 }));
    };
    // 最左：回大厅（平台首页），所有游戏统一放左上角
    this.lobbyBtn = new Button(this, 70, 29, 112, 46, '大厅', 'wood', () => this.onLobby(), 'home');
    c.add(this.lobbyBtn);
    team(138, '我方', v.levels[0], COLOR.teamUs, v.declarer === 0, v.aFails[0]);
    team(280, '对方', v.levels[1], COLOR.teamThem, v.declarer === 1, v.aFails[1]);
    // 云存档：放左边（右边四个按钮已经挤满）
    this.cloudBtn = cloudButton(this, 446, 29, 46);
    c.add(this.cloudBtn);
    // 好友房开打以后也能叫朋友（0.6.1）：云朵右边，中途进来的人接管电脑的座位。右边的图标和名次条已经排满了
    const net = this.net;
    this.inviteBtn = net ? iconButton(this, 502, 29, 'invite', () => void this.invite(net.code), 46) : null;
    if (this.inviteBtn) c.add(this.inviteBtn);

    // 中：本副打几（级牌放大成一张小牌）
    const mx = W / 2;
    c.add(text(this, mx - 46, 29, '本副打', { size: TYPE.label, color: 0xf0dfc0, ox: 1 }));
    const badge = this.add.graphics();
    badge.fillStyle(COLOR.ivory, 1).fillRoundedRect(mx - 26, 5, 52, 48, 8);
    badge.lineStyle(3, COLOR.gold, 1).strokeRoundedRect(mx - 26, 5, 52, 48, 8);
    c.add(badge);
    c.add(text(this, mx, 30, levelName(v.level), { size: TYPE.big - 4, color: COLOR.red, bold: true, font: 'num' }));
    const who = v.declarer < 0 ? '双方' : v.declarer === 0 ? '我方' : '对方';
    c.add(text(this, mx + 36, 29, `${who}的级 · 第 ${v.dealNo} 副`, { size: TYPE.small, color: 0xd8c6a6, ox: 0 }));

    // 名次条：四个小格，出完的人依次填进去
    const px = mx + 250;
    for (let i = 0; i < 4; i++) {
      const seat = v.finished[i];
      const x = px + i * 48;
      const pg = this.add.graphics();
      pg.fillStyle(0x000000, 0.35).fillRoundedRect(x - 21, 8, 42, 42, 10);
      pg.lineStyle(1.5, i === 0 ? COLOR.gold : 0x8a7050, 0.9).strokeRoundedRect(x - 21, 8, 42, 42, 10);
      c.add(pg);
      if (seat !== undefined) {
        c.add(this.add.image(x, 27, `avatar:${seatPerson(seat)}:normal`).setDisplaySize(36, 36));
        c.add(text(this, x, 45, PLACE_NAMES[i]!, { size: 12, color: i === 0 ? COLOR.goldLight : 0xe0d0b0, bold: true, stroke: 0x1a0e07, strokeWidth: 3 }));
      } else {
        c.add(text(this, x, 29, String(i + 1), { size: TYPE.label, color: 0x8a7050, bold: true, font: 'num' }));
      }
    }

    // 右：规则、设置、音量、返回
    const icons: [string, () => void][] = [
      // 回掼蛋自己的首页用箭头；小房子留给"回大厅"
      ['back', () => this.onHome()],
      [getSettings().muted ? 'mute' : 'sound', () => this.toggleMute()],
      ['settings', () => this.openOverlay('menu', openSettings(this, { onTutorial: () => this.startTutorial(), onClose: () => this.closeOverlay() }))],
      ['rules', () => this.openOverlay('menu', openRules(this, () => this.closeOverlay(), this.ses.view().level))],
    ];
    icons.forEach(([icon, fn], i) => {
      const b = iconButton(this, W - 34 - i * 56, 29, icon, fn, 46);
      c.add(b);
      this.topIcons[i] = b;
      if (icon === 'mute' || icon === 'sound') this.soundIcon = b;
    });

    // 实盘：顶栏下面靠右一条（左边是搭档的头像），本场到目前的分和筹码一直显示着
    const st = this.stake;
    const ns = this.netStake;
    let label = '';
    if (st) label = `实盘 · ${TIER_NAME[st.tier]} · 打完 ${st.stake.match.deals.length}/${SOLO_DEALS} 副 · 本场 ${signed(st.points)} 分（${signed(st.points * pointValue(st.tier))}）`;
    else if (ns) {
      // 好友房：我（视角里总是 0 号）这个座位的账
      const me = ns.seats[0]!;
      const tail =
        me.paid === 'yes'
          ? `本场 ${signed(me.points)} 分（${signed(me.points * pointValue(ns.tier))}）`
          : me.paid === 'pending'
            ? ROOM_STAKE_TEXT.pending
            : roomWhy(ns.why ?? '');
      label = `实盘 · ${TIER_NAME[ns.tier]} · 打完 ${ns.deals}/${ROOM_DEALS} 副 · ${tail}`;
    }
    if (label) {
      const t = text(this, W - 22, TOPBAR_H + 22, label, { size: TYPE.small, bold: true, color: COLOR.goldLight, ox: 1 });
      const pg = this.add.graphics();
      pg.fillStyle(0x1a0e07, 0.7).fillRoundedRect(W - t.width - 36, TOPBAR_H + 6, t.width + 28, 32, 16);
      pg.lineStyle(1.5, COLOR.gold, 0.7).strokeRoundedRect(W - t.width - 36, TOPBAR_H + 6, t.width + 28, 32, 16);
      c.add([pg, t]);
      // 好友房带入被拒（或者走了又回来、再带入被拒）：条子左边一个"重新带入"（0.6.0）
      const me = ns?.seats[0];
      if (ns && me && !ns.over && (me.paid === 'refused' || me.paid === 'left') && ns.why !== 'need_two') {
        this.rebuyBtn = new Button(this, W - t.width - 120, TOPBAR_H + 22, 150, 34, '重新带入', 'red', () => this.net?.rebuy(), 'restart');
        c.add(this.rebuyBtn);
      } else this.rebuyBtn = undefined;
    }
    this.buildCounter(c, W, v, label ? TOPBAR_H + 44 : TOPBAR_H + 6);
  }

  /**
   * 记牌器：顶栏下面一排，大王、小王、A……2 每种还有几张没露面（级牌标红，出完的变淡）。
   * 放在搭档头像右边，实盘时让到实盘条下面。点一下收起成小签，再点展开（记进设置）。
   */
  private buildCounter(c: Phaser.GameObjects.Container, W: number, v: PlayerView, y0: number): void {
    if (v.phase !== 'play' && v.phase !== 'tribute' && v.phase !== 'return') return;
    const x0 = W / 2 - 140;
    const toggle = (): void => {
      updateSettings({ counter: !getSettings().counter });
      this.buildTopBar(worldW(this));
    };
    if (!getSettings().counter) {
      const t = text(this, x0 + 14, y0 + 17, '记牌', { size: TYPE.small, bold: true, color: COLOR.goldLight, ox: 0 });
      const g = this.add.graphics();
      g.fillStyle(0x1a0e07, 0.6).fillRoundedRect(x0, y0 + 2, t.width + 28, 30, 15);
      g.lineStyle(1.5, COLOR.gold, 0.6).strokeRoundedRect(x0, y0 + 2, t.width + 28, 30, 15);
      const z = this.add.zone(x0, y0, t.width + 28, 34).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      z.on('pointerdown', toggle);
      c.add([g, t, z]);
      this.counterAt = { x: x0 + (t.width + 28) / 2, y: y0 + 17 };
      return;
    }
    const cells = countLeft(v.hand, v.history);
    const cw = 32;
    const w = cells.length * cw + 16;
    const h = 50;
    const g = this.add.graphics();
    g.fillStyle(0x1a0e07, 0.62).fillRoundedRect(x0, y0, w, h, 12);
    g.lineStyle(1.5, COLOR.gold, 0.55).strokeRoundedRect(x0, y0, w, h, 12);
    c.add(g);
    cells.forEach((cell, i) => {
      const x = x0 + 8 + cw * i + cw / 2;
      const lv = cell.rank === v.level;
      if (lv) g.fillStyle(COLOR.red, 0.55).fillRoundedRect(x - cw / 2 + 2, y0 + 4, cw - 4, h - 8, 7);
      const name = cell.rank === 17 ? '大' : cell.rank === 16 ? '小' : levelName(cell.rank);
      const a = cell.left === 0 ? 0.32 : 1;
      c.add(text(this, x, y0 + 14, name, { size: 14, bold: true, color: lv || cell.rank >= 16 ? COLOR.goldLight : 0xe8d8b8 }).setAlpha(a));
      c.add(text(this, x, y0 + 34, String(cell.left), { size: 19, bold: true, font: 'num', color: 0xffffff }).setAlpha(a));
    });
    const z = this.add.zone(x0, y0, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    z.on('pointerdown', toggle);
    c.add(z);
    this.counterAt = { x: x0 + w / 2, y: y0 + h / 2 };
  }

  private toggleMute(): void {
    const muted = !getSettings().muted;
    applyAudio(updateSettings({ muted }));
    const img = this.soundIcon?.getData('icon') as Phaser.GameObjects.Image | undefined;
    img?.setTexture(muted ? 'icon:mute' : 'icon:sound');
  }

  /** 打到一半：先确认（说清这局会怎样）；打完了就直接走 */
  private onLobby(): void {
    if (this.net) {
      // 好友房回大厅不算离开房间：座位留着（掉线宽限过了电脑先替他打），房间码也留着，回来点"回到刚才的房间"接着打
      if (!inOnlineGame()) return goLobby();
      this.openOverlay('menu', confirm(this, leaveText(), '回大厅', () => goLobby(), () => this.closeOverlay()));
      return;
    }
    if (!inGame()) return goLobby();
    this.openOverlay('menu', confirm(this, leaveText(), '回大厅', () => goLobby(), () => this.closeOverlay()));
  }

  private onHome(): void {
    const st = this.stake;
    if (st && !st.over) return this.leaveStake(st);
    const net = this.net;
    if (net && net.room?.status === 'playing') {
      // 好友房：离开就把座位交给电脑（不判输），先问一句
      // 我是最后一个真人：房间就此结束（0.6.0），说清楚
      const others = net.room.seats.some((s, i) => s.kind === 'human' && i !== net.mySeat);
      const msg = this.netStake && !this.netStake.over ? ROOM_STAKE_TEXT.leave : others ? '离开这个房间？你的座位交给电脑接着打' : '离开这个房间？没有别人在了，这一局就结束';
      this.openOverlay('menu', confirm(this, msg, '离开', () => this.leaveRoom(), () => this.closeOverlay()));
      return;
    }
    if (net) return this.leaveRoom();
    this.cancelBot();
    this.scene.start('title');
  }

  /**
   * 好友房打完一整场，点"再来一场"（0.6.2）：我来开新房间，再告诉这个房间新房间的码，大家看到了一起过去（followAgain）。
   * 这个房间已经不等了（停够了、关了），就自己先过去，进了再叫朋友
   */
  private async again(btn: Button): Promise<void> {
    const net = this.net;
    if (!net || net.againInfo) return;
    btn.setEnabled(false);
    const r = await createRoom(fetch, null);
    if (!this.alive) return;
    if (!('code' in r)) {
      btn.setEnabled(true);
      toast(this, r.error, worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
      return;
    }
    // 等的这一会儿别人先开了：跟他的（followAgain 已经在路上），我开的这间没人进，房间到点自己关
    if (net.againInfo) return;
    net.againCode = r.code;
    if (net.againInfo === null || net.status !== 'open') this.followAgain({ code: r.code, by: 0 });
    else net.again(r.code);
  }

  /**
   * 有人开好了新房间（画面座位 by 点的）：说一声，离开这个房间，进新房间。开房的人房间直接让他坐 0 号（kit 开房），
   * 所以别人按"和他的相对位置"坐（我在画面 0 号，他在 by 号 → 我坐 (4 - by) % 4）：队友、上下家都和上一场一样
   */
  private followAgain(a: Again): void {
    const net = this.net;
    if (!net || this.following) return;
    this.following = true;
    const mine = a.code === net.againCode;
    const prefer = (4 - a.by) % 4;
    const msg = mine ? '新房间开好了，正在过去…' : `${seatName(a.by)} 开了新房间，一起过去…`;
    // 结束页上的那行字换成这句（toast 在弹窗下面一层，会被挡住）
    const tip = this.overlayModal?.body.getData('againTip') as ReturnType<typeof text> | undefined;
    if (tip?.scene) tip.setText(msg).setColor(css(COLOR.redDark));
    else toast(this, msg, worldW(this) / 2, BUTTON_Y - 92);
    for (const k of ['again', 'home']) (this.overlayModal?.body.getData(k) as Button | undefined)?.setEnabled(false);
    this.time.delayedCall(mine ? 400 : 2500, () => {
      if (!this.alive) return;
      this.cancelBot();
      net.leave();
      app.net = null;
      this.scene.start('title');
      join(a.code, mine, prefer);
    });
  }

  private leaveRoom(): void {
    this.cancelBot();
    this.net?.leave();
    app.net = null;
    this.scene.start('title');
  }

  private get net(): NetSession | null {
    return this.ses instanceof NetSession ? this.ses : null;
  }

  private get stake(): StakeSession | null {
    return this.ses instanceof StakeSession ? this.ses : null;
  }

  /** 好友房实盘：现在显示的这一帧里每个座位的账（娱乐房间为 null） */
  private get netStake(): StakeView | null {
    return this.net?.shown?.stake ?? null;
  }

  /**
   * 实盘中途回标题（2.2）：第一副还没打完就原样退回；打了几副就问"先存着"还是"现在结算"，默认先存着，不强迫人结束。
   */
  private leaveStake(st: StakeSession): void {
    if (st.stake.match.deals.length === 0) {
      this.openOverlay('menu', confirm(this, STAKE_TEXT.refundAsk, '退出', () => void this.refundAndLeave(st), () => this.closeOverlay()));
      return;
    }
    const m = modal(this, 640, 330, undefined, { closeBtn: false });
    this.openOverlay('menu', m);
    m.body.add(text(this, 0, -96, `这场实盘打了 ${st.stake.match.deals.length} 副，本场 ${signed(st.points)} 分`, { size: TYPE.title, bold: true, wrap: 560 }));
    m.body.add(text(this, 0, -46, '先存着，24 小时内回来接着打；或者按现在的分结算', { size: TYPE.label, color: COLOR.muted, wrap: 560 }));
    const keep = new Button(this, -150, 30, 260, 60, '先存着', 'red', () => {
      m.close();
      this.cancelBot();
      this.scene.start('title');
    });
    const now = new Button(this, 150, 30, 260, 60, '现在结算', 'wood', () => {
      m.close();
      this.overlay = null;
      this.overlayModal = null;
      st.finish();
      this.showStakeResult();
    });
    const cancel = new Button(this, 0, 110, 200, 52, '接着打', 'wood', () => {
      m.close();
      this.closeOverlay();
    });
    m.body.add([keep, now, cancel]);
    m.body.setData('ok', keep);
    m.body.setData('settleNow', now);
    m.body.setData('cancel', cancel);
  }

  private async refundAndLeave(st: StakeSession): Promise<void> {
    this.cancelBot();
    const r = await refundStake(st.stake);
    if (!this.alive) return;
    this.scene.start('title');
    if (r.kind === 'later' || r.kind === 'failed') {
      // 没退成：存档留着，标题页还能"接着打"；到期钱包也会原样退回
      const title = this.scene.get('title');
      title.events.once('create', () => toast(title, r.kind === 'later' ? STAKE_ERROR['unavailable']! : stakeError(r.error), worldW(title) / 2, worldH - 60));
    }
  }

  /** 联机：房间来了新消息 */
  private onNet(kind: NetEvent, detail?: string): void {
    if (!this.alive) return;
    if (kind === 'reset') {
      // 进房、重连的全量快照、换了座位：整桌重画
      this.cancelBot();
      this.scene.restart();
      return;
    }
    for (const sv of this.seats) sv.refreshIdentity();
    const net = this.net!;
    // 再来一场（0.6.2）：有人开好了新房间。我这边结束页已经出来了就一起过去；还在播最后一副的，等结束页出来再走（openGameOver 里）
    const again = net.againInfo;
    if (again && this.overlay === 'gameOver') {
      this.followAgain(again);
      return;
    }
    // 我开好了新房间、这个房间却不等了（停够了、打完关了）：自己先过去
    if (net.againCode && kind === 'error' && (detail === 'cannot_again' || detail === 'room_over')) {
      this.followAgain({ code: net.againCode, by: 0 });
      return;
    }
    if (this.overlay === 'stake') this.refreshNetStake();
    if (kind === 'status' && net.status === 'closed' && this.overlay !== 'gameOver' && this.overlay !== 'stake') {
      // 房间散了、在别处登录被顶掉……：说清楚原因，只能回首页
      this.overlayModal?.close();
      // 不用标题栏：标题字体是子集，"房间断开"这几个字不在里面
      const m = modal(this, 640, 300, undefined, { closeBtn: false, depth: 5200 });
      m.body.add(text(this, 0, -60, '房间断开了', { size: TYPE.title, bold: true, color: COLOR.redDark }));
      m.body.add(text(this, 0, -10, closeText(net.closeCode), { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 560 }));
      m.body.add(new Button(this, 0, 80, 240, 64, '回首页', 'red', () => this.leaveRoom(), 'back'));
      this.openOverlay('menu', m);
      return;
    }
    if (kind === 'emote') {
      // 房间转发的（含我自己发的）："说话人:编号[:对象]"，画面座位
      const [vs, id, to] = (detail ?? '').split(':').map(Number);
      if (vs !== undefined && id !== undefined) this.taunts?.receive(vs, id, to === undefined || Number.isNaN(to) ? undefined : to);
      return;
    }
    this.noticeNetTurn();
    if (kind === 'error') {
      this.lastError = detail ?? 'illegal_move';
      audio.sfx('error');
      toast(this, errorText(detail ?? ''), worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
    }
    // 结算页开着时，别人点"继续"只是同一个局面（step 不变）：收下来刷新"还在等谁"，不然会堵住后面开下一副的那一帧
    if (this.overlay === 'settle') {
      while (net.queue[0] && net.shown && net.queue[0].nv.view.step === net.shown.view.step) net.take();
      this.refreshSettleWait();
    }
    // 人齐了、房间开了下一副：结算页自己收起来，接着播
    const next = this.net?.queue[0];
    if (this.overlay === 'settle' && next && next.nv.view.phase !== 'dealEnd') {
      this.overlayModal?.close();
      this.closeOverlay();
    }
    this.refreshButtons();
    this.pump();
  }

  /** 好友房结算页：我点没点"继续"、还在等谁、几秒后自动开下一副 */
  private refreshSettleWait(): void {
    const net = this.net;
    const t = this.settleWait;
    if (!net || !t || !t.active || this.overlay !== 'settle') return;
    const btn = this.overlayModal?.body.getData('next') as Button | undefined;
    const can = net.canReady();
    btn?.setVisible(can);
    const w = net.readyWait();
    const sec = w?.deadline ? Math.max(0, Math.ceil((w.deadline - Date.now()) / 1000)) : null;
    const left = sec === null ? '' : `${sec} 秒后自动开始`;
    const others = (w?.waiting ?? []).filter((s) => s !== 0);
    t.setY(can ? 250 : 190);
    if (can) t.setText(left);
    else if (others.length) t.setText(`等 ${others.map(seatName).join('、')} 点继续${left ? ` · ${left}` : ''}`);
    else t.setText('马上开下一副…');
  }

  private updateClocks(): void {
    if (this.overlay === 'settle') this.refreshSettleWait();
    const t = this.net?.turnInfo();
    const now = Date.now();
    this.seats.forEach((sv, i) => sv.setClock(t && t.seat === i && t.deadline !== null ? Math.max(0, Math.ceil((t.deadline - now) / 1000)) : null));
    // 弹窗关掉的路子很多（有的直接把 overlay 置空），图层的显隐在这里跟上；打开时 openOverlay 立刻藏
    if (this.overlay === null) this.taunts?.layer.show();
    else this.taunts?.layer.hide();
    this.taunts?.tickTurn(this.overlay === null && t ? t.seat : null, t ? `${t.seat}:${t.deadline}` : '');
    // 我的最后 5 秒：每秒"嗒"一声，最后 2 秒每半秒一声、升调
    const left = t && t.seat === ME && t.deadline !== null ? t.deadline - now : -1;
    if (left > 0 && left <= 5000) {
      const slot = left > 2000 ? Math.ceil(left / 1000) : 10 + Math.ceil(left / 500);
      if (slot !== this.tickSlot) audio.sfx('tick', { pitch: left > 2000 ? 0 : 5 });
      this.tickSlot = slot;
    } else this.tickSlot = -1;
  }

  /** 好友房刚轮到我：后台时标题闪，前台时手机振一下（叮的一声在播到"轮到"那一步时响）；不轮到我了就停闪 */
  private noticeNetTurn(): void {
    const mine = this.net?.turnInfo()?.seat === ME;
    if (mine && !this.myNetTurn) {
      if (document.hidden) flashTitle();
      else vibrate();
    } else if (!mine && this.myNetTurn) stopFlash();
    this.myNetTurn = mine;
  }

  /** 联机：按顺序播放房间发来的帧。返回 true 表示这次在播（或等着播），pump 先别往下走。 */
  private pumpNet(): boolean {
    const net = this.net;
    if (!net) return false;
    const f = net.queue[0];
    if (!f) return false;
    if (this.overlay !== null) return true;
    const before = net.shown?.view.step ?? -1;
    const lead = !net.shown?.view.trick.last;
    net.take();
    if (f.nv.view.step <= before) {
      // 同一个牌局状态（有人入座、掉线……）：只刷新画面
      this.sync(true);
      this.time.delayedCall(0, () => this.pump());
      return true;
    }
    const play = (): void => void this.playEvents(f.nv.events);
    // 电脑连着出：和单机一样按出法给思考时间（房间给的间隔只说明这一帧是电脑出的；播得比房间慢一点，到我出牌时队列总会播完）
    if (f.delay > 0) {
      const e = f.nv.events.find((x) => x.type === 'play' || x.type === 'pass');
      const think = !e ? f.delay : this.botThink(e.seat, e.type === 'pass' ? 'pass' : isBomb(e.play) ? 'bomb' : 'play', lead);
      this.botTimer = this.time.delayedCall(dur(think), () => {
        this.botTimer = null;
        play();
      });
    } else play();
    return true;
  }

  private openOverlay(kind: Overlay, m: Modal): void {
    this.overlay = kind;
    this.overlayModal = m;
    // 道具、表情在 DOM 图层上，会盖住 Phaser 画的弹窗：弹窗开着时藏起来
    this.taunts?.closeAll();
    this.taunts?.layer.hide();
    this.cancelBot();
    this.refreshButtons();
  }

  private closeOverlay(): void {
    this.overlay = null;
    this.overlayModal = null;
    this.time.delayedCall(10, () => this.pump());
  }

  // ───────────────────────── 静态刷新 ─────────────────────────

  /** 按当前状态刷新所有静态元素。animateHand=false 时手牌直接就位。 */
  private sync(animateHand = true, beforeDeal = false): void {
    if (!this.alive) return;
    const v = this.ses.view();
    this.trick.setLevel(v.level);
    if (!beforeDeal) this.hand.setHand(v.hand, v.level, { animate: animateHand });
    for (let s = 0; s < 4; s++) {
      const seat = this.seats[s]!;
      seat.setCount(beforeDeal ? 27 : v.counts[s]!, v.finished.includes(s));
      seat.setTurn(v.phase === 'play' && v.turn === s);
      const place = v.finished.indexOf(s);
      if (place < 0) void seat.setPlace(null, false);
    }
    this.buildTopBar(worldW(this));
    this.refreshButtons();
  }

  private restoreTrick(): void {
    const v = this.ses.view();
    v.finished.forEach((s, i) => void this.seats[s]!.setPlace(i + 1, false));
    if (v.phase !== 'play') return;
    const last = v.trick.last;
    if (last) this.trick.restore(last.seat, last.play);
    v.trick.passed.forEach((p, s) => {
      if (p) this.trick.restore(s, null);
    });
  }

  private myTurn(v: PlayerView): boolean {
    return !this.busy && this.overlay === null && !this.ses.autoplay && v.toAct.includes(ME) && this.ses.canAct();
  }

  /** 按钮状态和一句话原因。 */
  private refreshButtons(): void {
    if (!this.alive) return;
    const v = this.ses.view();
    const mine = this.myTurn(v);
    const sel = this.hand.selected();
    this.hand.enabled = mine;
    const showMain = v.phase === 'play' || v.phase === 'tribute' || v.phase === 'return';
    for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear]) b.setVisible(showMain);
    this.btnClear.setEnabled(sel.length > 0);
    this.btnPrev.setVisible(v.phase === 'play').setEnabled(this.trick.prev.length > 0 && this.overlay === null);
    this.btnSort.setText(this.hand.mode === 'rank' ? '按牌型' : '按点数');
    this.btnBack?.setVisible(!!this.net?.afk && this.overlay === null);

    if (v.myTribute && mine) {
      // 进贡 / 还贡
      const t = v.myTribute;
      this.hand.setAllowed(t.allowed);
      this.btnPass.setVisible(false);
      this.btnHint.setVisible(false);
      const verb = t.kind === 'tribute' ? '进贡' : '还贡';
      this.btnPlay.setText(verb).setEnabled(sel.length === 1);
      const to = t.to >= 0 ? seatName(t.to) : '头游';
      this.setStatus(t.kind === 'tribute' ? `选最大的一张 ${verb}给 ${to}` : `选一张 ${verb}给 ${to}（10 以下）`);
      return;
    }
    this.hand.setAllowed(null);
    this.btnPlay.setText('出牌');
    this.btnHint.setVisible(showMain && v.phase === 'play');
    this.btnPass.setVisible(showMain && v.phase === 'play');
    if (!mine) {
      this.btnPlay.setEnabled(false);
      this.btnPass.setEnabled(false);
      this.btnHint.setEnabled(false);
      if (v.phase === 'play' && v.turn >= 0 && v.turn !== ME) this.setStatus(`等 ${seatName(v.turn)} 出牌`);
      // 发牌、"要进贡"横幅这些动画放完之前不提进贡的事，免得牌还没发完就先看到提示
      else if (this.busy && (v.phase === 'tribute' || v.phase === 'return')) this.setStatus('');
      else if ((v.phase === 'tribute' || v.phase === 'return') && !v.toAct.includes(ME)) this.setStatus(v.phase === 'tribute' ? '等对方进贡' : '等对方还贡');
      else if (this.ses.autoplay) this.setStatus('托管中');
      else this.setStatus('');
      return;
    }
    if (v.phase !== 'play') return;
    const pass = canPass(v);
    this.btnPass.setEnabled(pass);
    this.btnHint.setEnabled(true);
    const r = this.judge(v, sel);
    this.btnPlay.setEnabled(r.ok);
    if (sel.length === 0) {
      const hints = this.ensureHints(v);
      if (hints.length === 0) this.setStatus('要不起，点 不要', true);
      else this.setStatus(v.trick.last ? '轮到你：压过它，或者不要' : '轮到你出牌');
    } else this.setStatus(r.ok ? r.label : r.reason, !r.ok);
  }

  /** 选中的牌能不能出：返回可用的解释（可能多个）或一句原因。只调用核心的 interpret / beats。 */
  private judge(v: PlayerView, sel: Card[]): { ok: boolean; plays: Play[]; reason: string; label: string } {
    if (sel.length === 0) return { ok: false, plays: [], reason: '', label: '' };
    const all = interpret(sel, v.level, v.options);
    if (all.length === 0) return { ok: false, plays: [], reason: '不成牌型', label: '' };
    const target = v.trick.last?.play ?? null;
    const ok = target ? all.filter((p) => beats(p, target)) : all;
    if (ok.length === 0) {
      const sameType = all.some((p) => p.type === target!.type && p.cards.length === target!.cards.length);
      return { ok: false, plays: [], reason: sameType || isBomb(target!) ? '压不过' : `要出${playLabel(target!)}`, label: '' };
    }
    // 同一种牌型/点数的解释只算一种
    const uniq: Play[] = [];
    for (const p of ok) if (!uniq.some((q) => samePlayShape(p, q))) uniq.push(p);
    const label = uniq.length === 1 ? playDetail(uniq[0]!) : `有 ${uniq.length} 种出法`;
    return { ok: true, plays: uniq, reason: '', label };
  }

  private ensureHints(v: PlayerView): (Play | null)[] {
    if (this.hintStep === v.step) return this.hints;
    this.hintStep = v.step;
    this.hintIdx = 0;
    this.hints = hintList(v, this.ses.hintSeed());
    return this.hints;
  }

  // ───────────────────────── 玩家操作 ─────────────────────────

  private onHint(): void {
    const v = this.ses.view();
    if (!this.myTurn(v) || v.phase !== 'play') return;
    const list = this.ensureHints(v);
    if (list.length === 0) {
      toast(this, '没有能压过的牌', worldW(this) / 2, BUTTON_Y - 92);
      return;
    }
    const p = list[this.hintIdx % list.length]!;
    this.hintIdx++;
    if (p === null) {
      this.hand.setSelected([]);
      this.refreshButtons();
      const partner = v.trick.last && v.trick.last.seat === partnerOf(ME);
      toast(this, partner ? '队友的牌够大，建议不要' : '建议不要，留着好牌', worldW(this) / 2, BUTTON_Y - 92);
      this.setStatus('提示：这手建议 不要（再点提示看能压的牌）');
      this.fxLog.push('建议不要');
      this.pulse(this.btnPass);
      return;
    }
    this.hand.setSelected(p.cards);
    this.refreshButtons();
  }

  private onSort(): void {
    this.hand.setMode(this.hand.mode === 'rank' ? 'type' : 'rank');
    this.refreshButtons();
  }

  private onClear(): void {
    this.hand.setSelected([]);
    this.refreshButtons();
  }

  private onPass(): void {
    const v = this.ses.view();
    if (!this.myTurn(v) || !canPass(v)) return;
    this.hand.setSelected([]);
    this.act({ type: 'pass', seat: ME });
  }

  private onPlay(): void {
    const v = this.ses.view();
    if (!this.myTurn(v)) return;
    const sel = this.hand.selected();
    if (v.myTribute) {
      if (sel.length !== 1) return;
      this.act(v.myTribute.kind === 'tribute' ? { type: 'tribute', seat: ME, card: sel[0]! } : { type: 'return', seat: ME, card: sel[0]! });
      return;
    }
    const r = this.judge(v, sel);
    if (!r.ok) {
      audio.sfx('error');
      if (r.reason) toast(this, r.reason, worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
      return;
    }
    if (r.plays.length === 1) {
      const p = r.plays[0]!;
      this.act({ type: 'play', seat: ME, cards: sel, as: { type: p.type, rank: p.rank, extra: p.extra } });
      return;
    }
    this.chooseInterpretation(sel, r.plays);
  }

  /** 逢人配让一手牌有多种解释：列出来让玩家挑。 */
  private chooseInterpretation(sel: Card[], plays: Play[]): void {
    const h = 180 + plays.length * 70;
    const m = modal(this, 560, h, '当作哪一手？', { onClose: () => this.closeOverlay() });
    this.openOverlay('choose', m);
    plays.forEach((p, i) => {
      const b = new Button(this, 0, -h / 2 + 110 + i * 70, 400, 58, playDetail(p), isBomb(p) ? 'red' : 'gold', () => {
        m.close();
        this.act({ type: 'play', seat: ME, cards: sel, as: { type: p.type, rank: p.rank, extra: p.extra } });
      });
      m.body.add(b);
    });
  }

  private act(a: Action): void {
    const r = this.ses.apply(a);
    if (r.sent) {
      // 联机：等房间回下一帧，按钮先锁上
      this.lastError = null;
      this.refreshButtons();
      return;
    }
    if (r.error) {
      this.lastError = r.error;
      audio.sfx('error');
      toast(this, r.error, worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
      return;
    }
    this.lastError = null;
    void this.playEvents(r.events);
  }

  /** 调试桥：按玩家同样的路径推进（带动画）。 */
  debugDispatch(a: Action): string | null {
    if (this.busy) return '正在播放动画';
    this.cancelBot();
    const r = this.ses.apply(a);
    if (r.error) return r.error;
    void this.playEvents(r.events);
    return null;
  }

  // ───────────────────────── 电脑 ─────────────────────────

  private cancelBot(): void {
    this.botTimer?.remove();
    this.botTimer = null;
    if (this.botSeat >= 0) this.seats[this.botSeat]?.setThinking(false);
    this.botSeat = -1;
  }

  /** 决定下一步：电脑行动、等玩家、或弹结算。 */
  private pump(): void {
    if (!this.alive || this.busy || this.botTimer) return;
    if (this.pumpNet()) return;
    if (this.overlay !== null) return;
    const v = this.ses.view();
    const st = this.stake;
    if (st?.over && (v.phase !== 'dealEnd' || this.stakeDealSeen || st.stake.settle!.deals !== v.lastDeal?.dealNo)) {
      this.showStakeResult();
      return;
    }
    // 好友房实盘一场打完：先看最后一副的结算页，点"结算"再看这一场
    if (this.netStake?.over && (v.phase !== 'dealEnd' || this.stakeDealSeen)) {
      this.showNetStakeResult();
      return;
    }
    if (v.phase === 'dealEnd') {
      // 好友房里点了"下一副"、房间还没回：别再弹一次结算
      if (this.net?.pending) return;
      this.showSettle(v.lastDeal!);
      return;
    }
    if (v.phase === 'gameOver') {
      this.showGameOver();
      return;
    }
    const bots = this.ses.online && !this.ses.canAct() ? [] : v.toAct.filter((s) => this.ses.isBot(s));
    this.refreshButtons();
    if (bots.length === 0) return;
    const seat = bots[0]!;
    // 先想好出什么（电脑的决定只看牌局和种子，早算晚算一样），再按出法给思考时间
    const planned = this.ses.botAction(seat);
    if (seat !== ME) this.seats[seat]!.setThinking(true);
    this.botSeat = seat;
    const kind = planned?.type !== 'play' ? 'pass' : isBomb(planned.as ?? interpret(planned.cards, v.level, v.options)[0] ?? { type: 'single' }) ? 'bomb' : 'play';
    this.botTimer = this.time.delayedCall(dur(v.phase === 'play' ? this.botThink(seat, kind, !v.trick.last) : 900), () => {
      this.botTimer = null;
      this.botSeat = -1;
      this.seats[seat]!.setThinking(false);
      if (!this.alive || this.busy || this.overlay !== null) return;
      let a = planned;
      if (!a) return;
      let r = this.ses.apply(a);
      if (r.sent) return;
      if (r.error) {
        // 电脑出错（理论上不会）：退回到"不要"或第一种合法出法，保证不卡住
        console.warn(`电脑 ${seat} 动作非法：${r.error}`);
        const view = this.ses.view(seat);
        a = canPass(view) ? { type: 'pass', seat } : { type: 'play', seat, cards: hint(view)[0]!.cards };
        r = this.ses.apply(a);
        if (r.error) return;
      }
      void this.playEvents(r.events);
    });
  }

  // ───────────────────────── 事件播放 ─────────────────────────

  private async playEvents(evs: GameEvent[]): Promise<void> {
    this.busy = true;
    this.refreshButtons();
    try {
      for (const e of evs) {
        if (!this.alive) return;
        await this.playEvent(e);
      }
    } finally {
      this.busy = false;
    }
    if (!this.alive) return;
    this.sync(true);
    this.pump();
  }

  /**
   * 电脑的思考时间（毫秒，再经 dur 换算）：按性格、状态和上头程度（personas.ts 的 thinkTime）；对手快走完时多想一会儿。
   * 太快了看不清谁出了什么，也没有"在博弈"的感觉（德州试玩时的反馈，掼蛋按同一标准自查）。
   */
  private botThink(seat: number, kind: 'pass' | 'play' | 'bomb', lead: boolean): number {
    const style = this.ses.botStyle(seat);
    const v = this.ses.view();
    const tense = [1, 3].some((d) => {
      const opp = (seat + d) % 4;
      return !v.finished.includes(opp) && v.counts[opp]! <= 4;
    });
    return thinkTime({ kind, lead, tense, ...(style ?? {}) });
  }

  private talk(seat: number, sit: Situation, force = false): void {
    // 联机的真人自己说话，不替他编台词
    if (seat === ME || seatIdentity[seat]?.human) return;
    const id = seatPerson(seat);
    const style = this.ses.botStyle(seat);
    if (!force && Math.random() > talkChance(id, style?.form ?? 0, style?.tilt ?? 0)) return;
    const line = lineFor(id, sit);
    if (line) this.seats[seat]!.say(line);
  }

  /** 一副开始时电脑说的话：第一副看状态（手热、手冷），之后看局面（上一副输了上头、级数差得多） */
  private dealTalk(dealNo: number): void {
    for (let s = 1; s < 4; s++) {
      const style = this.ses.botStyle(s);
      if (dealNo === 1) {
        this.talk(s, style && style.form > 0.25 ? 'hot' : style && style.form < -0.25 ? 'cold' : 'start');
        continue;
      }
      if (!style) continue;
      const v = this.ses.view();
      const mine = teamOf(s);
      const lead = v.levels[mine]! - v.levels[1 - mine]!;
      if (style.tilt >= 0.5) this.talk(s, 'tilt');
      else if (lead <= -3) this.talk(s, 'behind');
      else if (lead >= 3) this.talk(s, 'ahead');
    }
  }

  private mood(seat: number, m: Mood, ms = 2200): void {
    this.seats[seat]?.setMood(m, ms);
  }

  private async playEvent(e: GameEvent): Promise<void> {
    const W = worldW(this);
    switch (e.type) {
      case 'dealStart': {
        this.cancelBot();
        this.dealJiefeng = 0;
        if (e.dealNo === 1) {
          this.matchLog = emptyMatchLog();
          this.loggedDeal = 0;
        }
        await this.trick.clearAll();
        this.trick.forget();
        for (const s of this.seats) {
          void s.setPlace(null, false);
          s.setCount(27, false);
        }
        this.hand.setHand([], e.level, { animate: false });
        this.buildTopBar(W);
        audio.sfx('deal');
        await bigWord(this, `第 ${e.dealNo} 副`, { sub: `打 ${levelName(e.level)}${e.level === 14 ? ' · 过 A 就赢' : ''}`, size: TYPE.huge, hold: 500 });
        const v = this.ses.view();
        this.hand.setHand(v.hand, v.level, { animate: false });
        await this.hand.dealIn(W / 2, 250);
        this.dealTalk(e.dealNo);
        if (!tutorialDone() && !this.ses.autoplay && !this.ses.online && app.params?.seed === null) {
          // 第一次玩：发完牌后出新手引导（URL 调试开局不弹）
          await this.startTutorialAsync();
        }
        break;
      }
      case 'antiTribute': {
        audio.sfx('jokerBomb');
        this.fxLog.push('抗贡');
        await bigWord(this, '抗贡！', { sub: `${e.seats.map(seatName).join('、')} 有两张大王，不用进贡`, color: COLOR.goldLight });
        e.seats.forEach((s) => this.mood(s, 'smug'));
        break;
      }
      case 'tributeAsked': {
        this.fxLog.push('进贡');
        await banner(this, e.payers.length === 2 ? '双下！两人都要进贡' : `${seatName(e.payers[0]!)} 要进贡`);
        e.payers.forEach((s) => this.mood(s, 'sad', 3000));
        break;
      }
      case 'tribute':
        await this.flyTribute(e.from, e.to, e.card, '进贡');
        this.talk(e.from, 'tribute');
        this.talk(e.to, 'getTribute');
        break;
      case 'returnCard':
        await this.flyTribute(e.from, e.to, e.card, '还贡');
        break;
      case 'lead':
        break;
      case 'turn':
        for (let s = 0; s < 4; s++) this.seats[s]!.setTurn(s === e.seat);
        if (e.seat === ME && !this.ses.autoplay) audio.sfx('turn');
        break;
      case 'play': {
        const victim = this.trick.topSeat();
        await this.animatePlay(e.seat, e.play, e.left);
        this.taunts?.suggest(suggestFor(e, victim));
        break;
      }
      case 'pass':
        this.trick.showPass(e.seat);
        audio.sfx('pass');
        this.talk(e.seat, 'pass');
        await wait(this, 220);
        break;
      case 'trickWon': {
        // 一墩打完：停一下让人看清是谁的牌收了这一墩，再清桌
        await wait(this, 950);
        audio.sfx('collect');
        await this.trick.clearAll();
        if (e.jiefeng) {
          this.dealJiefeng++;
          audio.sfx('jiefeng');
          this.fxLog.push('接风');
          const a = this.seats[e.leader]!.a;
          this.talk(e.leader, 'jiefeng', true);
          await bigWord(this, '接风', { size: TYPE.huge - 8, y: a.ay, color: COLOR.goldLight, hold: 300 });
        }
        break;
      }
      case 'finish': {
        this.fxLog.push(PLACE_NAMES[e.place - 1]!);
        this.seats[e.seat]!.setCount(0, true);
        if (e.place === 1) {
          audio.sfx('gong');
          const a = this.seats[e.seat]!.a;
          burst(this, a.ax, a.ay, 'star', 26, { gravity: 120 });
          this.mood(e.seat, 'happy', 4000);
          this.talk(e.seat, 'first', true);
          if (e.seat === ME) await bigWord(this, '头游！', { color: COLOR.goldLight, hold: 700 });
          else {
            this.talk(partnerOf(e.seat), 'partnerFirst');
            await banner(this, `${seatName(e.seat)} 头游`);
          }
        }
        // 末游的电脑嘟囔一句（双下时两个人都说也不奇怪）
        if (e.place === 4) this.talk(e.seat, 'last');
        await this.seats[e.seat]!.setPlace(e.place, true);
        this.taunts?.suggest(suggestFor(e, -1));
        break;
      }
      case 'dealEnd':
        // 最后一手和名次章留在桌上看清楚，再弹结算
        await wait(this, 1500);
        break;
      case 'gameOver':
        break;
    }
  }

  private async animatePlay(seat: number, play: Play, left: number): Promise<void> {
    const from = this.seats[seat]!.center;
    const views = seat === ME ? this.hand.take(play.cards) : null;
    const bomb = isBomb(play);
    const big = !bomb && (play.type === 'plate' || play.type === 'tube' || play.cards.length >= 5);
    const p = this.trick.showPlay(seat, play, views, from);
    // 出牌声每手音高略浮动，四家连着出不会像同一个声音敲四下；同花顺比普通炸弹高一点
    audio.sfx(bomb ? (play.type === 'jokerBomb' ? 'jokerBomb' : 'bomb') : big ? 'playBig' : 'play', {
      pitch: play.type === 'straightFlush' ? 3 : bomb ? 0 : (Math.random() - 0.5) * 2.4,
    });
    this.seats[seat]!.setCount(left, left === 0);
    await p;
    if (bomb) await this.bombFx(seat, play);
    else if (seat !== ME) {
      const last = this.ses.view().history;
      // 压过别人时才说"压一手"之类；领出时偶尔说一句
      const prev = last.length >= 2 ? last[last.length - 2] : null;
      this.talk(seat, prev && prev.play ? 'beat' : 'lead');
    }
    // 报牌：别家的张数刚跨过 10 张、3 张时弹一下
    const before = left + play.cards.length;
    if (seat !== ME && left > 0 && ((before > 10 && left <= 10) || (before > 3 && left <= 3))) {
      this.seats[seat]!.callCount(left);
      audio.sfx('call', { pitch: left <= 3 ? 4 : 0 });
    }
    if (left > 0 && left <= 6 && seat !== ME) {
      if (left <= 3) this.talk(seat, 'fewCards');
      audio.music('tense');
    }
  }

  private async bombFx(seat: number, play: Play): Promise<void> {
    const W = worldW(this);
    const a = this.seats[seat]!.a;
    const king = play.type === 'jokerBomb';
    const label = playLabel(play);
    this.fxLog.push(label);
    // 老张炸得开心，别人炸得得意
    this.mood(seat, seatPerson(seat) === 'laozhang' ? 'happy' : 'smug', 2600);
    // 被炸的人（上一手的主人）郁闷一下
    const hist = this.ses.view().history;
    for (let i = hist.length - 2; i >= 0; i--) {
      const h = hist[i]!;
      if (h.play) {
        if (teamOf(h.seat) !== teamOf(seat)) {
          this.mood(h.seat, 'sad', 2400);
          this.talk(h.seat, 'bombed');
        }
        break;
      }
    }
    this.talk(seat, king ? 'jokerBomb' : 'bomb', seatPerson(seat) === 'laozhang' || king);
    if (king) {
      flash(this, 0xffe7a0, 0.75);
      rays(this, W / 2, 330);
      shake(this, 600, 0.018);
      burst(this, a.px, a.py, 'spark', 60, { speed: [200, 620], life: 1200 });
      burst(this, W / 2, 330, 'coin', 30, { speed: [200, 520], life: 1400, gravity: 500 });
      await bigWord(this, '天王炸！', { size: 96, color: COLOR.goldLight, stroke: COLOR.redDark, hold: 1100, depth: 190 });
    } else {
      flash(this, 0xffffff, play.cards.length >= 6 || play.type === 'straightFlush' ? 0.55 : 0.4);
      shake(this, 360, play.cards.length >= 6 ? 0.014 : 0.009);
      burst(this, a.px, a.py, 'spark', 36, { speed: [160, 480] });
      burst(this, a.px, a.py, 'smoke', 8, { speed: [40, 120], life: 900, gravity: -40, scale: [1.4, 2.4] });
      // 垫在出牌下面（出牌区 depth 200+）：大字一闪，刚炸出来的牌不被挡住
      await bigWord(this, label, { size: play.cards.length >= 6 || play.type === 'straightFlush' ? 84 : 72, color: 0xfff0c8, stroke: COLOR.red, hold: 750, depth: 190 });
    }
  }

  /** 贡牌飞过去（别人之间的还贡只看到牌背）。 */
  private async flyTribute(from: number, to: number, card: Card | null, label: string): Promise<void> {
    audio.sfx('tribute');
    this.fxLog.push(label);
    const a = this.seats[from]!.center;
    const b = this.seats[to]!.center;
    let v: CardView;
    if (from === ME && card !== null) {
      v = this.hand.take([card])[0] ?? new CardView(this, a.x, a.y, card, this.ses.view().level);
    } else {
      v = new CardView(this, a.x, a.y, card ?? 0, this.ses.view().level, 92, card !== null);
      v.setScale(0.5);
    }
    v.setDepth(2500);
    const mid = { x: worldW(this) / 2, y: 280 };
    const tag = text(this, mid.x, mid.y - 112, `${seatName(from)} ${label}给 ${seatName(to)}`, { size: TYPE.body, bold: true, color: COLOR.goldLight, stroke: 0x2b1d14, strokeWidth: 5 }).setDepth(2501).setAlpha(0);
    await tweenP(this, { targets: v, x: mid.x, y: mid.y, scale: 1.5, angle: 0, duration: 420, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: tag, alpha: 1, duration: dur(120) });
    // 贡的是哪张、谁给谁：在桌子中间停够一秒多看清
    await wait(this, 1200);
    this.tweens.add({ targets: tag, alpha: 0, duration: dur(160), onComplete: () => tag.destroy() });
    await tweenP(this, { targets: v, x: b.x, y: b.y, scale: 0.4, alpha: 0.2, duration: 360, ease: 'Cubic.easeIn' });
    v.destroy();
    if (to === ME) {
      const view = this.ses.view();
      this.hand.setHand(view.hand, view.level, { animate: true, from: b });
    }
  }

  /** 回看上一墩：按出牌顺序一行一个人（记牌、想想对面还剩什么，是"在博弈"的一部分）。电脑等看完再出。 */
  private showPrevTrick(): void {
    const list = this.trick.prev;
    if (list.length === 0 || this.overlay !== null) return;
    const rowH = Math.min(68, Math.floor(400 / list.length));
    const cw = Math.min(46, Math.floor((rowH - 6) / 1.4));
    const h = 210 + rowH * list.length;
    const m = modal(this, 640, h, '上一墩', { onClose: () => this.closeOverlay() });
    const ok = new Button(this, 0, h / 2 - 56, 180, 56, '看好了', 'red', () => m.close());
    m.body.add(ok);
    m.body.setData('ok', ok);
    const level = this.ses.view().level;
    list.forEach((r, i) => {
      const y = -h / 2 + 70 + rowH * i + rowH / 2;
      m.body.add(text(this, -280, y, seatName(r.seat), { size: TYPE.body, bold: true, ox: 0, color: teamOf(r.seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
      if (!r.play) {
        m.body.add(text(this, -150, y, '不要', { size: TYPE.body, bold: true, ox: 0, color: COLOR.muted }));
        return;
      }
      r.play.cards.forEach((card, j) => m.body.add(new CardView(this, -150 + cw / 2 + j * Math.round(cw * 0.52), y, card, level, cw)));
      const last = i === list.length - 1 || list.slice(i + 1).every((x) => !x.play);
      const bomb = isBomb(r.play);
      m.body.add(text(this, 280, y, last ? `${playLabel(r.play)} · 收了` : playLabel(r.play), { size: TYPE.small, bold: true, ox: 1, color: bomb ? COLOR.red : last ? COLOR.redDark : COLOR.ink }));
    });
    this.openOverlay('menu', m);
  }

  // ───────────────────────── 结算 / 胜负 ─────────────────────────

  private showSettle(r: DealResult): void {
    const W = worldW(this);
    void W;
    audio.music('table');
    const m = modal(this, 820, 560, `第 ${r.dealNo} 副 结束`, { closeBtn: false });
    this.openOverlay('settle', m);
    const b = m.body;
    const mine = r.winnerTeam === 0;
    if (mine) {
      audio.sfx('levelUp');
      burst(this, W / 2, 180, 'petal', 30, { gravity: 200, speed: [120, 360], life: 1600 });
    } else audio.sfx('pass');
    // 左：名次
    r.order.forEach((seat, i) => {
      const y = -170 + i * 78;
      const g = this.add.graphics();
      g.fillStyle(teamOf(seat) === 0 ? 0xf8e0d8 : 0xdde8f4, 1).fillRoundedRect(-370, y - 32, 360, 64, 12);
      b.add(g);
      b.add(this.add.image(-330, y, `stamp:${PLACE_NAMES[i]}`).setDisplaySize(56, 56).setAngle(-10));
      b.add(this.add.image(-262, y, `avatar:${seatPerson(seat)}:${teamOf(seat) === r.winnerTeam ? 'happy' : 'sad'}`).setDisplaySize(54, 54));
      b.add(text(this, -222, y, seatName(seat), { size: TYPE.body, bold: true, ox: 0 }));
      b.add(text(this, -26, y, teamOf(seat) === 0 ? '我方' : '对方', { size: TYPE.small, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem, bold: true, ox: 1 }));
    });
    // 右：升级
    const rx = 190;
    const before = r.levelsBefore[r.winnerTeam]!;
    const after = r.levelsAfter[r.winnerTeam]!;
    b.add(text(this, rx, -176, mine ? '我方赢了这副' : '对方赢了这副', { size: TYPE.title, bold: true, color: mine ? COLOR.red : COLOR.teamThem, font: 'title' }));
    const lvText = text(this, rx - 70, -86, levelName(before), { size: 66, bold: true, font: 'num', color: COLOR.muted });
    b.add(lvText);
    b.add(text(this, rx, -86, '→', { size: 46, bold: true, color: COLOR.muted }));
    const lvAfter = text(this, rx + 76, -86, levelName(before), { size: 66, bold: true, font: 'num', color: mine ? COLOR.red : COLOR.teamThem });
    b.add(lvAfter);
    const upTag = r.up > 0 ? `升 ${r.up} 级` : r.aResetTeam >= 0 ? '' : r.aFailedTeam >= 0 ? '' : '';
    if (upTag) {
      const t = text(this, rx, -18, upTag, { size: TYPE.title, bold: true, color: 0xffffff });
      const w = t.width + 36;
      const g = this.add.graphics();
      g.fillStyle(mine ? COLOR.red : COLOR.teamThem, 1).fillRoundedRect(rx - w / 2, -38, w, 40, 20);
      b.add([g, t]);
    }
    // 数字滚动到新级数
    if (after !== before) {
      let cur = before;
      const step = (): void => {
        if (!lvAfter.scene) return;
        cur++;
        lvAfter.setText(levelName(cur));
        lvAfter.setScale(1.3);
        this.tweens.add({ targets: lvAfter, scale: 1, duration: dur(160) });
        if (cur < after) this.time.delayedCall(Math.max(60, dur(260)), step);
      };
      this.time.delayedCall(Math.max(60, dur(400)), step);
    } else lvAfter.setText(levelName(after));
    // 打 A 的情况
    const notes: string[] = [];
    if (r.aFailedTeam >= 0) notes.push(`${r.aFailedTeam === 0 ? '我方' : '对方'}打 A 没过`);
    if (r.aResetTeam >= 0) notes.push(`${r.aResetTeam === 0 ? '我方' : '对方'}退回打 2`);
    if (r.doubleDown) notes.push('双下！');
    b.add(text(this, rx, 40, notes.join(' · '), { size: TYPE.label, bold: true, color: COLOR.redDark }));
    // 下一副的进贡：核心推演下一副开头（联机时由房间算好随结算下发）
    const next = this.ses.preview();
    let tribLine = '';
    if (next?.anti) tribLine = '下副：抗贡！不用进贡';
    else if (next && next.payers.length === 2) tribLine = `下副：${next.payers.map(seatName).join('、')} 进贡`;
    else if (next && next.payers.length === 1) tribLine = `下副：${seatName(next.payers[0]!)} 进贡给 ${seatName(next.to)}`;
    const st = this.stake;
    const ns = this.netStake;
    // 实盘：这一副的分和本场合计（好友房只在我到账了时写）；一场结束了就不预告下一副的进贡
    const stakeLine = st ? { tier: st.tier, total: st.points } : ns?.seats[0]!.paid === 'yes' ? { tier: ns.tier, total: ns.seats[0]!.points } : null;
    if (stakeLine) {
      const d = dealPoints(r, 0);
      const pv = pointValue(stakeLine.tier);
      // 筹码是实盘最关心的数：大字写这一副赢输多少，分和本场合计放小字
      b.add(text(this, rx, 114, `这一副 ${signed(d * pv)} 筹码`, { size: TYPE.title, bold: true, color: d >= 0 ? COLOR.red : COLOR.teamThem }));
      b.add(text(this, rx, 146, `${signed(d)} 分 · 本场 ${signed(stakeLine.total)} 分（${signed(stakeLine.total * pv)}）`, { size: TYPE.small, bold: true, color: COLOR.muted }));
    }
    const matchOver = !!st?.over || !!ns?.over;
    if (matchOver) tribLine = '这一场打完了';
    b.add(text(this, rx, stakeLine ? 78 : 90, tribLine, { size: TYPE.body, bold: true, color: COLOR.ink }));
    const net = this.net;
    // 左下：这一副的复盘和称号（0.6.1，只看公开的出牌、名次和播过的接风）
    this.logMatch();
    const history = this.ses.view().history;
    const rc = dealRecap(r, history);
    const recap = [
      `炸弹 我方 ${rc.bombs[0]} · 对方 ${rc.bombs[1]}${this.dealJiefeng ? ` · 接风 ${this.dealJiefeng} 次` : ''}`,
      rc.top ? `最大一炸 ${seatName(rc.top.seat)}：${playDetail(rc.top.play)}` : `头游 ${seatName(r.order[0]!)} ${rc.firstPlays} 手出完`,
    ];
    recap.forEach((line, i) => b.add(text(this, -370, 116 + i * 30, line, { size: TYPE.small, color: COLOR.ink, ox: 0 })));
    dealTitles(r, history).forEach((t, i) => {
      b.add(text(this, -370, 182 + i * 30, this.titleLine(t, true), { size: TYPE.small, bold: true, color: COLOR.redDark, ox: 0 }));
    });
    const btn = new Button(this, rx, stakeLine ? 200 : 190, 240, 64, matchOver ? '结算' : net ? '继续' : '下一副', 'red', () => {
      if (matchOver) {
        m.close();
        this.overlay = null;
        this.overlayModal = null;
        this.stakeDealSeen = true;
        if (st) this.showStakeResult();
        else this.showNetStakeResult();
        return;
      }
      if (net) {
        // 好友房：点了只是"我准备好了"，结算页留着，等人齐了或到点房间开下一副
        this.act({ type: 'nextDeal' });
        this.refreshSettleWait();
        return;
      }
      m.close();
      this.overlay = null;
      this.overlayModal = null;
      this.act({ type: 'nextDeal' });
    }, 'play');
    b.add(btn);
    b.setData('next', btn);
    if (net && !matchOver) {
      this.settleWait = text(this, rx, 250, '', { size: TYPE.label, bold: true, color: COLOR.muted });
      b.add(this.settleWait);
      this.refreshSettleWait();
    }
    // 托管（调试代打）时自动进下一副
    if (this.ses.autoplay) {
      this.time.delayedCall(Math.max(600, dur(1200)), () => {
        if (this.ses.autoplay && this.overlay === 'settle' && this.overlayModal === m && btn.visible) btn.onClick();
      });
    }
  }

  private showGameOver(): void {
    const v = this.ses.view();
    const win = v.winner === 0;
    audio.music('off');
    audio.sfx(win ? 'win' : 'lose');
    const W = worldW(this);
    const stop = win ? rain(this, 'confetti', 4900) : rain(this, 'smoke', 4900);
    if (win) {
      rays(this, W / 2, 200);
      burst(this, W / 2, 200, 'coin', 40, { speed: [200, 600], life: 1600, gravity: 600 });
    }
    const m = modal(this, 760, 540, win ? '胜利！' : '惜败', { closeBtn: false, depth: 5000 });
    this.openOverlay('gameOver', m);
    m.root.once('destroy', stop);
    const b = m.body;
    // 两队四人
    [0, 2, 1, 3].forEach((seat, i) => {
      const x = -255 + i * 170;
      const mood: Mood = teamOf(seat) === v.winner ? 'happy' : 'sad';
      const img = this.add.image(x, -120, `avatar:${seatPerson(seat)}:${mood}`).setDisplaySize(110, 110);
      b.add(img);
      if (teamOf(seat) === v.winner) this.tweens.add({ targets: img, y: -134, duration: dur(420), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      b.add(text(this, x, -48, seatName(seat), { size: TYPE.label, bold: true, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
    });
    b.add(text(this, 0, 18, win ? '我方先过 A，赢下整局！' : '对方先过了 A，下局再来', { size: TYPE.title, bold: true, color: win ? COLOR.red : COLOR.muted, font: 'title' }));
    // 整局的称号：一行排开，按钮上方
    this.logMatch();
    const titles = matchTitles(this.matchLog);
    if (titles.length) b.add(text(this, 0, 114, titles.map((t) => this.titleLine(t, false)).join('    '), { size: TYPE.small, bold: true, color: COLOR.redDark }));
    if (this.net) {
      // 好友房不计战绩。再来一场（0.6.2）：开个新房间，这一桌的人自动跟过去、坐回原来的座位
      const tip = text(this, 0, 74, '好友房不计战绩 · 点"再来一场"，这一桌一起换到新房间', { size: TYPE.label, color: COLOR.ink });
      b.add(tip);
      b.setData('againTip', tip);
      const home = new Button(this, -140, 170, 220, 64, '回首页', 'wood', () => this.leaveRoom(), 'back');
      const again = new Button(this, 140, 170, 220, 64, '再来一场', 'red', () => void this.again(again), 'restart');
      b.add([home, again]);
      b.setData('again', again);
      b.setData('home', home);
      // 结束页出来之前已经有人开了新房间：让大家先看一眼结果再走
      const a = this.net.againInfo;
      if (a) this.followAgain(a);
      return;
    }
    const st = getStats();
    const rate = st.games > 0 ? Math.round((st.wins / st.games) * 100) : 0;
    b.add(text(this, 0, 74, `战绩 ${st.wins}/${st.games}  胜率 ${rate}%  连胜 ${st.streak}（最高 ${st.bestStreak}）`, { size: TYPE.label, color: COLOR.ink }));
    b.add(new Button(this, -140, 170, 220, 64, '回首页', 'wood', () => this.scene.start('title'), 'back'));
    b.add(new Button(this, 140, 170, 220, 64, '再来一局', 'red', () => this.newGame(), 'restart'));
  }

  /** 把最近一副记进整局的称号统计（同一副只记一次） */
  private logMatch(): void {
    const v = this.ses.view();
    const r = v.lastDeal;
    if (!r || r.dealNo <= this.loggedDeal) return;
    this.matchLog = logDeal(this.matchLog, r, v.history);
    this.loggedDeal = r.dealNo;
  }

  /** "炸弹狂魔 老张 · 炸了 3 次"；最佳搭档写一队两个人 */
  private titleLine(t: Title, why: boolean): string {
    const who = t.pair ? `${seatName(t.seat)}、${seatName((t.seat + 2) % 4)}` : seatName(t.seat);
    return `${TITLE_INFO[t.id].name} ${who}${why ? ` · ${t.why}` : ''}`;
  }

  private async invite(code: string): Promise<void> {
    const note = await shareRoom(code);
    if (!note || !this.alive) return;
    toast(this, note, worldW(this) / 2, BUTTON_Y - 92);
  }

  newGame(seed = randomSeed()): void {
    app.session = Session.fresh(seed);
    this.scene.restart();
  }

  /**
   * 实盘一场的结算（2.1 第 5、6 步）：先显示这一场的分和筹码，同时去结回钱包；结回成功后写钱包还有多少，到顶了另写一句。
   * 两个按钮一样大、一样颜色，不自动开下一场，没有倒计时（第 5 节）。输了不放失败音效。
   */
  private showStakeResult(): void {
    const st = this.stake!;
    const save = st.stake;
    const done = save.settle!;
    const pv = pointValue(save.tier);
    const v = this.ses.view();
    audio.music('off');
    audio.sfx(done.points > 0 ? 'levelUp' : 'pass');
    const m = modal(this, 780, 500, undefined, { closeBtn: false, depth: 5000 });
    this.openOverlay('stake', m);
    const b = m.body;
    const head = done.points === 0 ? '这场打平，0 分' : `这场 ${signed(done.points)} 分，${signed(done.points * pv)}`;
    b.add(text(this, 0, -170, `实盘 · ${TIER_NAME[save.tier]}`, { size: TYPE.label, bold: true, color: COLOR.muted }));
    b.add(text(this, 0, -122, head, { size: TYPE.big, bold: true, color: done.points > 0 ? COLOR.red : COLOR.ink }));
    const why =
      v.phase === 'gameOver'
        ? `${v.winner === 0 ? '我方' : '对方'}先过了 A，这一场提前结束`
        : Math.abs(done.points) >= 20
          ? '碰到封顶，这一场提前结束'
          : done.deals < SOLO_DEALS
            ? `打了 ${done.deals} 副，按现在的分结算`
            : `打满 ${SOLO_DEALS} 副`;
    b.add(text(this, 0, -66, why, { size: TYPE.label, color: COLOR.ink }));
    const status = text(this, 0, -14, '正在结算…', { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 700 });
    b.add(status);
    const capLine = text(this, 0, 32, '', { size: TYPE.label, bold: true, color: COLOR.redDark, wrap: 700 });
    b.add(capLine);
    b.add(text(this, 0, 210, STAKE_TEXT.noCash, { size: TYPE.small, color: COLOR.muted }));
    const again = new Button(this, -140, 120, 240, 64, '再来一场', 'wood', () => void this.stakeAgain(save.tier, status, again), 'restart');
    const home = new Button(this, 140, 120, 240, 64, '回标题', 'wood', () => this.scene.start('title'), 'back');
    again.setEnabled(false);
    home.setEnabled(false);
    b.add([again, home]);
    b.setData('again', again);
    b.setData('home', home);
    void settleStake(save).then((r) => {
      this.stakeOutcome = r;
      if (!this.alive || !status.scene) return;
      home.setEnabled(true);
      if (r.kind === 'done') {
        status.setText(r.balance === null ? '已经结回钱包' : `已经结回钱包，钱包还有 ${fmtChips(r.balance)}`);
        if (r.capped > 0) capLine.setText(STAKE_TEXT.capped(r.capped));
        again.setEnabled(true);
      } else if (r.kind === 'gone') {
        status.setText(STAKE_TEXT.gone);
        again.setEnabled(true);
      } else if (r.kind === 'expired') {
        status.setText(STAKE_ERROR['expired']!);
        again.setEnabled(true);
      } else if (r.kind === 'later') {
        status.setText(STAKE_TEXT.settleLater);
      } else {
        status.setText(stakeError(r.error));
      }
    });
  }

  /**
   * 好友房实盘一场的结算（3.2）：我的分和筹码、每个人的输赢；结回由房间去钱包办，办完这一行字跟着房间的帧变成"已经结回钱包"。
   * 再打要重新开房（和娱乐房间打完一样）。
   */
  private showNetStakeResult(): void {
    const ns = this.netStake!;
    const me = ns.seats[0]!;
    const pv = pointValue(ns.tier);
    const v = this.ses.view();
    audio.music('off');
    audio.sfx(me.paid === 'yes' && me.points > 0 ? 'levelUp' : 'pass');
    const m = modal(this, 780, 520, undefined, { closeBtn: false, depth: 5000 });
    this.openOverlay('stake', m);
    const b = m.body;
    b.add(text(this, 0, -196, `好友房实盘 · ${TIER_NAME[ns.tier]}`, { size: TYPE.label, bold: true, color: COLOR.muted }));
    const head = me.paid !== 'yes' ? '这一场不计输赢' : me.points === 0 ? '这场打平，0 分' : `这场 ${signed(me.points)} 分，${signed(me.points * pv)}`;
    b.add(text(this, 0, -148, head, { size: TYPE.big, bold: true, color: me.paid === 'yes' && me.points > 0 ? COLOR.red : COLOR.ink }));
    const why = v.phase === 'gameOver' ? `${v.winner === 0 ? '我方' : '对方'}先过了 A，这一场提前结束` : ns.deals >= ROOM_DEALS ? `打满 ${ROOM_DEALS} 副` : '这一场提前结束';
    b.add(text(this, 0, -96, why, { size: TYPE.label, color: COLOR.ink }));
    // 每个人：到账的写分，别的写"不计输赢"（电脑是庄家的）
    [0, 1, 2, 3].forEach((seat, i) => {
      const s = ns.seats[seat]!;
      const x = -270 + i * 180;
      b.add(this.add.image(x, -30, `avatar:${seatPerson(seat)}:normal`).setDisplaySize(64, 64));
      b.add(text(this, x, 16, seatName(seat), { size: TYPE.small, bold: true, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
      // 从没带入过的是开局时的电脑座位（庄家的）
      const line = s.paid === 'yes' ? `${signed(s.points)} 分` : s.paid === 'left' ? `${signed(s.points)} 分（中途走了）` : s.paid === 'no' ? '电脑' : '不计输赢';
      b.add(text(this, x, 44, line, { size: TYPE.small, color: COLOR.ink }));
    });
    this.netStakeStatus = text(this, 0, 96, '', { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 700 });
    b.add(this.netStakeStatus);
    this.refreshNetStake();
    b.add(new Button(this, 0, 168, 260, 64, '回首页', 'red', () => this.leaveRoom(), 'back'));
    b.add(text(this, 0, 228, STAKE_TEXT.noCash, { size: TYPE.small, color: COLOR.muted }));
  }

  /** 结算页那行字：看最新收到的一帧（结算页开着时帧不往下播，直接看队尾） */
  private refreshNetStake(): void {
    const t = this.netStakeStatus;
    const net = this.net;
    if (!t?.scene || !net) return;
    const ns = net.queue[net.queue.length - 1]?.nv.stake ?? net.shown?.stake;
    const me = ns?.seats[0];
    if (!ns || !me) return;
    if (me.paid === 'yes') t.setText(me.out ? '已经结回钱包' : '正在结回钱包…');
    else if (me.paid === 'pending') t.setText('带入还没到账，到账后原样结回一份');
    else t.setText(roomWhy(ns.why ?? ''));
  }

  /** 结算页的"再来一场"：还是这一档，重新带入 */
  private async stakeAgain(tier: StakeSession['tier'], status: Phaser.GameObjects.Text, btn: Button): Promise<void> {
    btn.setEnabled(false);
    status.setText('正在进场…');
    const r = await buyinStake(tier);
    if (!this.alive) return;
    if (r.ok) {
      app.session = r.ses;
      this.scene.restart();
      return;
    }
    status.setText(stakeError(r.error));
    btn.setEnabled(r.error !== 'no_funds' && r.error !== 'at_table');
  }

  // ───────────────────────── 引导 ─────────────────────────

  private startTutorial(): void {
    void this.startTutorialAsync();
  }

  private async startTutorialAsync(): Promise<void> {
    this.cancelBot();
    this.overlay = 'tutorial';
    this.refreshButtons();
    await runTutorial(this, { play: this.btnPlay, hint: this.btnHint, pass: this.btnPass, sort: this.btnSort }, this.ses.view().level);
    this.overlay = null;
    if (!this.busy) this.pump();
  }

  // ───────────────────────── 调试桥 ─────────────────────────

  get isBusy(): boolean {
    return this.busy || this.botTimer !== null;
  }

  /** 现在重建画面会不会丢东西：动画、电脑在想、弹层（含教程、确认框）、选着牌，都要等 */
  canRebuild(): boolean {
    return !this.isBusy && this.overlay === null && this.hand.selected().length === 0;
  }

  /** 主要控件的世界坐标（冒烟用真实鼠标点）。 */
  controls(): Record<string, { x: number; y: number; enabled: boolean; visible: boolean }> {
    const out: Record<string, { x: number; y: number; enabled: boolean; visible: boolean }> = {};
    const put = (name: string, b: Button | undefined): void => {
      if (!b) return;
      out[name] = { x: b.x, y: b.y, enabled: b.enabled, visible: b.visible };
    };
    put('play', this.btnPlay);
    put('pass', this.btnPass);
    put('hint', this.btnHint);
    put('sort', this.btnSort);
    put('clear', this.btnClear);
    put('prev', this.btnPrev);
    put('imback', this.btnBack);
    if (this.counterAt) out['counter'] = { ...this.counterAt, enabled: true, visible: true };
    this.taunts?.controls(out);
    if (this.inviteBtn) out['invite'] = { x: this.inviteBtn.x, y: this.inviteBtn.y, enabled: true, visible: true };
    if (this.cloudBtn) out['cloud'] = { x: this.cloudBtn.x, y: this.cloudBtn.y, enabled: true, visible: true };
    put('lobby', this.lobbyBtn);
    put('rebuy', this.rebuyBtn);
    this.topIcons.forEach((b, i) => (out[`top${i}`] = { x: b.x, y: b.y, enabled: true, visible: b.visible }));
    for (const k of ['ok', 'cancel']) {
      const b = this.overlayModal?.body.getData(k) as Button | undefined;
      if (b) out[k] = { x: b.x + this.overlayModal!.body.x, y: b.y + this.overlayModal!.body.y, enabled: true, visible: true };
    }
    for (const k of ['again', 'home', 'settleNow']) {
      const b = this.overlayModal?.body.getData(k) as Button | undefined;
      if (b?.scene) out[k] = { x: b.x + this.overlayModal!.body.x, y: b.y + this.overlayModal!.body.y, enabled: b.enabled, visible: true };
    }
    const next = this.overlayModal?.body.getData('next') as Button | undefined;
    if (next && this.overlay === 'settle') out['next'] = { x: next.x + this.overlayModal!.body.x, y: next.y + this.overlayModal!.body.y, enabled: true, visible: true };
    return out;
  }

  cardPoint(c: Card): { x: number; y: number } | null {
    return this.hand.tapPoint(c);
  }

  handSelected(): Card[] {
    return this.hand.selected();
  }

  debugHint(): void {
    this.onHint();
  }

  /** 调试：打开设置 / 规则 / 战绩之类的弹窗（截图用）。 */
  debugOpen(kind: 'settings' | 'rules'): void {
    if (kind === 'settings') this.openOverlay('menu', openSettings(this, { onClose: () => this.closeOverlay() }));
    else this.openOverlay('menu', openRules(this, () => this.closeOverlay(), this.ses.view().level));
  }

  debugCloseOverlay(): void {
    this.overlayModal?.close();
    this.overlay = null;
    this.overlayModal = null;
    this.pump();
  }

}
