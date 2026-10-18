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
import { ROOM_DEALS, SOLO_DEALS, dealPoints, payout, pointValue } from '../../stake/index.ts';
import type { StakeView } from '../../net/stake.ts';
import type { Again } from '../../net/rules.ts';
import { flashTitle, stopFlash, vibrate } from '../attention.ts';
import { countLeft } from '../counter.ts';
import { ROOM_STAKE_TEXT, STAKE_ERROR, STAKE_TEXT, TIER_NAME, fmtChips, roomLeaveText, roomWhy, settleNowText, signed, stakeError } from '../stake-text.ts';
import { StakeSession, buyinStake, refundStake, settleStake, type SettleOutcome } from '../stake.ts';
import { dealRecap } from '../recap.ts';
import { suggestFor } from '../suggest.ts';
import { TITLE_INFO, dealTitles, emptyMatchLog, logDeal, matchTitles, type MatchLog, type Title } from '../../stake/titles.ts';
import { AWARD_NAME, matchAwards, winnerOf, type Award } from '../../net/awards.ts';
import { getSettings, getStats, tutorialDone, updateSettings } from '../store.ts';
import { COLOR, TYPE, css, minHit, phoneType } from '../theme.ts';
import { goLobby, inGame, inOnlineGame, leaveText } from '../lobby.ts';
import { join } from '../online.ts';
import { cloudButton } from '../ui/cloud.ts';
import { Button, fitWidth, iconButton, setHit, modal, text, toast, worldH, worldW, type Modal } from '../ui/kit.ts';
import { applyAudio, confirm, openRules, openSettings } from '../ui/panels.ts';
import { runTutorial } from '../tutorial.ts';
import { CardView } from '../table/card.ts';
import { banner, bigWord, burst, flash, rain, rays, shake } from '../table/fx.ts';
import { HandView } from '../table/hand.ts';
import { BUTTON_Y, TOPBAR_H, seatAnchors } from '../table/layout.ts';
import { SeatView } from '../table/seats.ts';
import { Nudges } from '../table/nudge.ts';
import { TableFun, funItem, type FunSeat } from 'arcade-kit/table-fun';
import { MOOD_LINES, PHRASES, TEMPER, dealMoment, momentOf } from '../../net/fun-moments.ts';
import { taunt } from '../../net/emotes.ts';
import { hasLayer } from '../ui/focus.ts';
import { bombDrama, bombOnBomb, dealHighlights, highlightText } from '../highlights.ts';
import { feedPick } from '../feed.ts';
import { postFeed } from '../social.ts';
import { TrickView } from '../table/trick.ts';
import { lobbyName, platformInfo, standalone } from '../platform.ts';
import { openInvitePanel, presenceNow } from '../social.ts';
import { prepareResult, shareCardOf, type ShareKind } from '../share-card.ts';

type Overlay = 'settle' | 'gameOver' | 'stake' | 'choose' | 'menu' | 'tutorial' | null;


/** 记牌器的纸签（art-v3）：米黄纸、深褐字 */
const PAPER = 0xf3e4c4;
const PAPER_INK = 0x3a2414;

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
  /** 旁观时的"坐下"（0.13.0） */
  private btnSit: Button | undefined;
  /** 记牌器（或收起后的小签）的中心，冒烟点它 */
  private counterAt: { x: number; y: number } | null = null;
  /** 牌桌互动（arcade-kit/table-fun，0.12.0）：头像菜单、面板、表情、道具、电脑反应；单机和好友房同一套 */
  private fun: TableFun | null = null;
  /** 互动的 DOM 层现在显示着没有（弹窗开着时藏起来；只在变了时写） */
  private funShown = true;
  /** 掼蛋自己多的：顺手提示、催促炸弹 */
  private nudges: Nudges | null = null;
  /** 读秒嘀嗒：上一声对应的格子（同一格不重复响） */
  private tickSlot = -1;
  /** 好友房轮到我（标题闪、振动只在刚轮到时来一次） */
  private myNetTurn = false;
  /** 好友房：电脑发的、等出牌画面播完再放的（画面座位） */
  private botEmotes: { from: number; id: number; to: number | undefined }[] = [];
  /** 整局称号用：攒到第几副了（场景重开不清，新的一局从第 1 副重新攒） */
  private matchLog = emptyMatchLog();
  /** 这一局已经报到好友动态的名场面编号（0.15.0，feed.ts）：一局最多两条、同一种一次 */
  private feedPosted: string[] = [];
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
  /** 单机实盘那条的中心（冒烟点它） */
  private stakeStrip: { x: number; y: number } | null = null;
  /** 结算弹窗上叠着的"回大厅"确认框（冒烟要找它的按钮） */
  private settleConfirm: Modal | null = null;
  /** 好友房实盘：带入被拒以后的"重新带入"（冒烟点它） */
  private rebuyBtn: Button | undefined;
  /** 画面建了几次（冒烟核对地址栏收放时没有重建） */
  builds = 0;
  /** 顶栏右边四个图标（冒烟检查它们在可见区内） */
  private topIcons: Phaser.GameObjects.Container[] = [];
  /** 顶栏右边图标点按区域的左边（记牌条避开它） */
  private iconsLeft = Infinity;
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
    this.fun = null;
    this.funShown = true;
    this.nudges = null;
    this.botEmotes = [];
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
    } else {
      // 单机：标签页切到后台时正轮到我，标题闪
      const onHide = (): void => {
        if (document.hidden && this.mySoloTurn()) flashTitle();
      };
      document.addEventListener('visibilitychange', onHide);
      this.events.once('shutdown', () => {
        document.removeEventListener('visibilitychange', onHide);
        stopFlash();
      });
    }
    const W = worldW(this);
    this.add.image(0, 0, `table:${W}`).setOrigin(0, 0).setDisplaySize(W, worldH);

    // 顶栏左边只有"大厅"（右边 126）和好友房的邀请按钮（minHit 宽）；对家头像不压着它们（49 是头像半径加空隙）
    const anchors = seatAnchors(W, this.net ? 126 + minHit() + 49 : 0);
    for (let s = 0; s < 4; s++) this.seats.push(new SeatView(this, s, anchors[s]!));
    this.trick = new TrickView(this, anchors);
    this.hand = new HandView(this);
    this.hand.onChange = () => this.refreshButtons();
    this.buildButtons(W);
    this.buildTopBar(W);
    this.buildFun();
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
    // 16:9 的小手机上往右让一点：左边要放下我的头像和"互动"按钮，两个都要 minHit() 宽（buildFun 按"理牌"的左边排互动按钮）
    const mh = minHit();
    const sortX = Math.max(cx - 410, 60 + Math.max(72, mh) / 2 + Math.max(56, mh) + Math.max(138, mh) / 2);
    this.btnSort = new Button(this, sortX, BUTTON_Y + 4, 138, 52, '理牌', 'green', () => this.onSort(), 'sort');
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
    // 旁观（0.13.0，docs/social.md 1.4）：有能坐的座位时出"坐下"，坐下后会话换座位、牌桌整个重画
    this.btnSit = net
      ? new Button(this, cx, BUTTON_Y, 240, 60, '坐下', 'red', () => {
          const seat = net.freeSeat();
          if (seat !== null) net.sit(seat);
        }).setDepth(401).setVisible(false)
      : undefined;
    this.statusBg = this.add.graphics().setDepth(399);
    this.status = text(this, cx, BUTTON_Y - 50, '', { size: TYPE.label, color: 0xfff3d6, bold: true }).setDepth(400);
  }

  /**
   * 牌桌互动接 arcade-kit/table-fun（0.12.0，docs/table-fun.md 第 0 节）：菜单、面板、提示、冷却、电脑反应都在 kit 的 DOM 层里，
   * 这里只给头像的屏幕矩形、名字、谁是电脑、性格、不能盖的地方（操作按钮和手牌）和发送通道。
   * 好友房经房间转发（电脑在房间里按同一份 botReact 反应）；单机在本地播，电脑由 kit 按性格反应
   */
  private buildFun(): void {
    const net = this.net;
    const W = worldW(this);
    const mh = minHit();
    // "互动"按钮夹在我的头像（中心 x 60）和"理牌"之间
    const left = 60 + Math.max(72, mh) / 2;
    const bw = Math.max(48, Math.min(Math.max(56, mh), this.btnSort.x - this.btnSort.width / 2 - left));
    const bh = Math.max(64, mh);
    const free = (): boolean => this.overlay === null && !hasLayer(this);
    const seated = (): boolean => !net || net.mySeat !== null;
    const send = (id: number, to?: number): void => {
      if (net) net.emote(id, to);
      else this.funIn(ME, id, to);
    };
    this.fun = new TableFun({
      storageKey: 'guandan',
      phrases: PHRASES,
      named: [taunt('就这？'), taunt('等着瞧'), taunt('等得花都谢了')],
      seats: () => this.seats.map((sv, v): FunSeat => {
        const id = net ? seatIdentity[v] : null;
        const persona = net ? id?.persona : this.ses.botStyle(v)?.persona;
        return { rect: this.screenRect(sv.a), name: seatName(v), me: this.isMe(v), bot: net ? !!id && !id.human : v !== ME, temper: persona ? TEMPER[persona] : 'normal' };
      }),
      avoid: () => [this.worldRect(0, BUTTON_Y - 40, W, worldH - BUTTON_Y + 40)],
      button: () => (seated() ? this.worldRect(left, 390 - bh / 2, bw, bh) : null),
      send,
      canSend: () => seated() && free(),
      // 首次提示"点头像扔道具"冒在右家或左家头像旁，气泡朝桌心伸，那家刚出的牌还在就会被盖住：等它的出牌区空了再冒
      hintSeat: () => [1, 3].find((v) => !this.isMe(v) && !this.trick.occupied(v)) ?? null,
      enabled: () => getSettings().taunts,
      // 好友房聊天（0.22.0）：只在好友房给，单机没有聊天页
      ...(net ? { chat: (t: string) => net.chat(t), chatEnabled: () => getSettings().chat } : {}),
      scope: () => net?.code ?? 'solo',
      localBots: !net,
      moodLines: MOOD_LINES,
      sound: (p, phase) => audio.fun(p, phase),
      onHit: (seat) => this.seats[seat]?.hit(),
      log: (line) => this.fxLog.push(line),
    });
    this.nudges = new Nudges({
      scene: this,
      seats: this.seats,
      canSend: () => seated() && free(),
      send,
      botThrow: (from, id, to) => this.funIn(from, id, to),
      tipAt: { x: left + bw + 20, y: 340 },
    });
    // 单机：我想太久，爱闹的电脑扔个催促炸弹（nudge.ts，每手最多一次）
    if (!net) this.time.addEvent({ delay: 500, loop: true, callback: () => this.tickSoloUrge() });
    // 弹窗（结算、设置、确认框……）开着时互动层整个藏起来：DOM 层在画布上面，不藏会挡住弹窗上的按钮
    this.time.addEvent({ delay: 200, loop: true, callback: () => this.syncFunShown() });
    if (net) {
      net.chatSink = (seat, t, masked) => {
        if (seat === ME || (getSettings().chat && !this.fun?.isBlocked(seat))) audio.sfx('taunt');
        this.fun?.chat(seat, t, masked);
      };
      net.chatErrorSink = (code) => this.fun?.chatError(code);
    }
    this.events.once('shutdown', () => {
      if (net) net.chatSink = net.chatErrorSink = null;
      this.fun?.destroy();
      this.fun = null;
      stopFlash();
    });
  }

  private syncFunShown(): void {
    const want = this.overlay === null && !hasLayer(this);
    if (want === this.funShown || !this.fun) return;
    this.funShown = want;
    if (want) this.fun.show();
    else this.fun.hide();
  }

  /** 收到的（房间转发的、单机自己的）交给 kit 播；短语、表情配上掼蛋自己的提示音 */
  private funIn(from: number, id: number, to?: number): void {
    const it = funItem(id, PHRASES.length);
    if (it && it.kind !== 'prop' && (from === ME || (getSettings().taunts && !this.fun?.isBlocked(from)))) audio.sfx(it.kind === 'sticker' ? 'sticker' : 'taunt');
    this.fun?.receive(from, id, to);
  }

  /** 名场面交给 kit：单机里电脑按性格起哄（好友房的在房间里算） */
  private funMoment(m: ReturnType<typeof dealMoment>): void {
    if (m) this.fun?.moment(m);
  }

  private tickSoloUrge(): void {
    const v = this.ses.view();
    const bots = [1, 2, 3].flatMap((s) => {
      const p = this.ses.botStyle(s)?.persona;
      return p ? [{ seat: s, temper: TEMPER[p] }] : [];
    });
    this.nudges?.tickSolo(this.mySoloTurn() ? `${v.dealNo}:${v.step}` : null, bots);
  }

  private mySoloTurn(): boolean {
    if (this.net || this.ses.autoplay) return false;
    const v = this.ses.view();
    return v.phase === 'play' && v.turn === ME;
  }

  /** 世界坐标的矩形 → 屏幕（CSS 像素）：画布的 CSS 矩形 × 世界到 CSS 的比例（相机 zoom 后画布高 = worldH） */
  private worldRect(x: number, y: number, w: number, h: number): { left: number; top: number; width: number; height: number } {
    const r = this.game.canvas.getBoundingClientRect();
    const f = r.height / worldH;
    return { left: r.left + x * f, top: r.top + y * f, width: w * f, height: h * f };
  }

  /** 头像（世界坐标）在屏幕上的矩形：画布的 CSS 矩形 × 世界到 CSS 的比例（相机 zoom 后画布高 = worldH） */
  private screenRect(a: { ax: number; ay: number; size: number }): { left: number; top: number; width: number; height: number } {
    return this.worldRect(a.ax - a.size / 2, a.ay - a.size / 2, a.size, a.size);
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
    // 黑漆顶栏：上亮下暗三层叠出漆面（Canvas 渲染也能画，不用渐变填充），底下双金线
    g.fillStyle(0x24130a, 0.94).fillRect(0, 0, W, TOPBAR_H);
    g.fillStyle(0x3a2214, 0.55).fillRect(0, 0, W, TOPBAR_H * 0.45);
    g.fillStyle(0xffffff, 0.05).fillRect(0, 2, W, TOPBAR_H * 0.2);
    g.lineStyle(2, COLOR.gold, 0.9).lineBetween(0, TOPBAR_H, W, TOPBAR_H);
    g.lineStyle(1, COLOR.goldLight, 0.35).lineBetween(0, TOPBAR_H - 4, W, TOPBAR_H - 4);
    c.add(g);
    const v = this.ses.view();
    // 三组（art-v3）：左"大厅"（好友房加邀请）；中 我方的级 · 本副打几 · 第几副 · 对方的级；右 图标。名次不另摆，头像上盖着印章
    const phone = phoneType();
    const team = (x: number, label: string, lv: number, color: number, active: boolean, fails: number): void => {
      const tg = this.add.graphics();
      tg.fillStyle(color, active ? 1 : 0.55).fillRoundedRect(x, 8, 132, 40, 20);
      if (active) tg.lineStyle(2.5, COLOR.goldLight, 1).strokeRoundedRect(x, 8, 132, 40, 20);
      c.add(tg);
      c.add(text(this, x + 16, 28, label, { size: TYPE.label, color: 0xffffff, bold: true, ox: 0 }));
      c.add(text(this, x + 106, 28, levelName(lv), { size: TYPE.title, color: COLOR.goldLight, bold: true, font: 'num', stroke: 0x2b1d14, strokeWidth: 3 }));
      // 手机上字托底到 12 像素以后角标会压着级数，删掉（结算页照样说哪队打 A 没过）
      if (fails > 0 && !phone) c.add(text(this, x + 132, 9, `A×${fails}`, { size: 14, color: 0xffd0c0, bold: true, ox: 1, oy: 0 }));
    };
    // 最左：回大厅（平台首页），所有游戏统一放左上角；单独部署叫"首页"、回游戏首页（platform.ts）
    this.lobbyBtn = new Button(this, 70, 28, 112, 46, lobbyName(), 'wood', () => this.onLobby(), 'home');
    // 顶栏贴着屏幕上沿，点按区域往下伸到离上沿 minHit()（手机上 44 CSS 像素）
    const deep = Math.max(54, 2 * (minHit() - 28));
    this.lobbyBtn.setHit(112, deep);
    c.add(this.lobbyBtn);
    // 好友房开打以后也能叫朋友（0.6.1）：紧挨"大厅"，中途进来的人接管电脑的座位
    const net = this.net;
    const lp = Math.max(56, minHit());
    this.inviteBtn = net ? iconButton(this, 126 + lp / 2 + 8, 28, 'invite', () => void openInvitePanel(net.code), 46) : null;
    if (this.inviteBtn) {
      setHit(this.inviteBtn, lp, deep);
      c.add(this.inviteBtn);
    }

    // 中：两队的级夹着"本副打几"（级牌放大成一张小牌），坐庄的一队描金边
    const mx = W / 2;
    team(mx - 238, this.side(0), v.levels[0], COLOR.teamUs, v.declarer === 0, v.aFails[0]);
    team(mx + 106, this.side(1), v.levels[1], COLOR.teamThem, v.declarer === 1, v.aFails[1]);
    // 手机上两队的胶囊和级牌之间只剩 70 多，放不下"本副打"和"第 N 副"两段：删掉"本副打"（级牌本身就是），"第N副"挪到左边
    if (!phone) c.add(text(this, mx - 34, 28, '本副打', { size: TYPE.label, color: 0xf0dfc0, ox: 1 }));
    const badge = this.add.graphics();
    badge.fillStyle(COLOR.ivory, 1).fillRoundedRect(mx - 26, 4, 52, 48, 8);
    badge.lineStyle(3, COLOR.gold, 1).strokeRoundedRect(mx - 26, 4, 52, 48, 8);
    c.add(badge);
    c.add(text(this, mx, 29, levelName(v.level), { size: TYPE.big - 4, color: COLOR.red, bold: true, font: 'num' }));
    if (phone) c.add(text(this, mx - 32, 28, `第${v.dealNo}副`, { size: TYPE.small, color: 0xd8c6a6, ox: 1 }));
    else c.add(text(this, mx + 36, 28, `第 ${v.dealNo} 副`, { size: TYPE.small, color: 0xd8c6a6, ox: 0 }));

    // 右：规则、设置、音量、返回，加云存档（它的红点提示没同步上，收进设置就看不见了，所以留在顶栏）
    const icons: [string, () => void][] = [
      // 回掼蛋自己的首页用箭头；小房子留给"回大厅"
      ['back', () => this.onHome()],
      [getSettings().muted ? 'mute' : 'sound', () => this.toggleMute()],
      ['settings', () => this.openOverlay('menu', openSettings(this, { onTutorial: () => this.startTutorial(), onClose: () => this.closeOverlay() }))],
      ['rules', () => this.openOverlay('menu', openRules(this, () => this.closeOverlay(), this.ses.view().level))],
    ];
    const cloudOn = !standalone();
    // 间距：有地方就拉到 44 CSS 像素（minHit），最少 56；最左一个的点按区域不越过中间那组（右边 mx + 238）
    const n = icons.length + (cloudOn ? 1 : 0);
    const room = (W - 34 - (mx + 238 + 8)) / (n - 0.5);
    const pitch = Math.max(56, Math.min(minHit(), room));
    icons.forEach(([icon, fn], i) => {
      const b = iconButton(this, W - 34 - i * pitch, 28, icon, fn, 46);
      setHit(b, pitch, deep);
      c.add(b);
      this.topIcons[i] = b;
      if (icon === 'mute' || icon === 'sound') this.soundIcon = b;
    });
    this.cloudBtn = cloudButton(this, W - 34 - icons.length * pitch, 28, 46);
    setHit(this.cloudBtn, pitch, deep);
    // 单独部署没有账号，不摆云存档
    this.cloudBtn.setVisible(cloudOn);
    c.add(this.cloudBtn);
    this.iconsLeft = W - 34 - (n - 0.5) * pitch;

    // 实盘：顶栏下面靠右一条（左边是搭档的头像），本场到目前的分和筹码一直显示着
    const st = this.stake;
    const ns = this.netStake;
    let label = '';
    if (st) label = `实盘 · ${TIER_NAME[st.tier]} · 打完 ${st.stake.match.deals.length}/${SOLO_DEALS} 副 · 本场 ${signed(st.points)} 分（${signed(st.points * pointValue(st.tier))}）`;
    else if (ns) {
      // 好友房：我（视角里总是 0 号）这个座位的账
      const me = ns.seats[0]!;
      const tail = this.watching
        ? '旁观'
        : me.paid === 'yes'
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
      // 单机实盘：条子能点，弹和"大厅"一样的结算确认框；右边加个"结算"小字，让人知道能点（所有者 10-16 找不到中途结算）
      if (st && !st.over) {
        const tag = text(this, W - t.width - 46, TOPBAR_H + 22, '结算 ›', { size: TYPE.small, bold: true, color: 0xffe08a, ox: 1 });
        const tg = this.add.graphics();
        tg.fillStyle(0x8a1a20, 0.92).fillRoundedRect(tag.x - tag.width - 12, TOPBAR_H + 8, tag.width + 22, 28, 14);
        c.add([tg, tag]);
        const zx = tag.x - tag.width - 14;
        const zw = W - 8 - zx;
        const z = this.add.zone(zx + zw / 2, TOPBAR_H + 22, zw, 32).setInteractive({ useHandCursor: true });
        setHit(z, zw, Math.max(32, minHit()));
        z.on('pointerup', () => this.stakeStripTap());
        // 放在顶栏最底层：手机上点按区域往上会碰到顶栏图标往下伸的那块、往下碰到记牌器，重叠处让它们先接；左头的"结算"小签不在图标下面，照样好点
        c.addAt(z, 0);
        this.stakeStrip = { x: zx + 30, y: TOPBAR_H + 22 };
      } else this.stakeStrip = null;
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
    // 横向：在对家剩余张数（头像中心右边约 95）之后。纵向：和顶栏图标的点按区域（往下伸到 minHit()）横向重叠时，挪到它下面
    const pa = this.seats[2]!.a;
    const x0 = Math.max(W / 2 - 140, pa.ax + 104);
    const cells = countLeft(v.hand, v.history);
    // 手机上点数、张数托底到 12、14 像素，格子跟着放宽加高，不然"10""9"挤成一串
    const phone = phoneType();
    const cw = phone ? 38 : 32;
    const h = phone ? 60 : 50;
    if (x0 + cells.length * cw + 16 > this.iconsLeft) y0 = Math.max(y0, minHit() + 4);
    // 点按区域只往下扩到够 44 CSS 像素：往上会压着顶栏
    const hitDown = (z: Phaser.GameObjects.Zone, w: number, h: number): void => {
      setHit(z, w, Math.max(h, minHit()));
      z.setPosition(x0, y0);
    };
    const toggle = (): void => {
      updateSettings({ counter: !getSettings().counter });
      this.buildTopBar(worldW(this));
    };
    if (!getSettings().counter) {
      const t = text(this, x0 + 14, y0 + 17, '记牌', { size: TYPE.small, bold: true, color: PAPER_INK, ox: 0 });
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.3).fillRoundedRect(x0 + 2, y0 + 5, t.width + 28, 30, 6);
      g.fillStyle(PAPER, 0.96).fillRoundedRect(x0, y0 + 2, t.width + 28, 30, 6);
      g.lineStyle(1.5, COLOR.goldDark, 0.8).strokeRoundedRect(x0, y0 + 2, t.width + 28, 30, 6);
      const z = this.add.zone(x0, y0, t.width + 28, 34).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      hitDown(z, Math.max(t.width + 28, minHit()), 34);
      z.on('pointerdown', toggle);
      c.add([g, t, z]);
      this.counterAt = { x: x0 + (t.width + 28) / 2, y: y0 + 17 };
      return;
    }
    const w = cells.length * cw + 16;
    const g = this.add.graphics();
    // 纸签（art-v3）：米黄纸、深褐字，压在绒布上带一点投影
    g.fillStyle(0x000000, 0.3).fillRoundedRect(x0 + 3, y0 + 4, w, h, 6);
    g.fillStyle(PAPER, 0.96).fillRoundedRect(x0, y0, w, h, 6);
    g.lineStyle(1.5, COLOR.goldDark, 0.8).strokeRoundedRect(x0, y0, w, h, 6);
    c.add(g);
    cells.forEach((cell, i) => {
      const x = x0 + 8 + cw * i + cw / 2;
      const lv = cell.rank === v.level;
      if (lv) g.fillStyle(COLOR.red, 0.16).fillRoundedRect(x - cw / 2 + 2, y0 + 4, cw - 4, h - 8, 5);
      const name = cell.rank === 17 ? '大' : cell.rank === 16 ? '小' : levelName(cell.rank);
      const a = cell.left === 0 ? 0.3 : 1;
      // 点数 16、张数 19：iPad 横屏（缩到 ×0.92）都到 14 CSS 像素；手机上更小的由手机字号档管
      c.add(text(this, x, y0 + (phone ? 17 : 14), name, { size: 16, bold: true, color: lv || cell.rank >= 16 ? COLOR.red : 0x6a4a2a }).setAlpha(a));
      c.add(text(this, x, y0 + (phone ? 43 : 34), String(cell.left), { size: 19, bold: true, font: 'num', color: lv ? COLOR.red : PAPER_INK }).setAlpha(a));
    });
    const z = this.add.zone(x0, y0, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    hitDown(z, w, h);
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
      this.openOverlay('menu', confirm(this, leaveText(), `回${lobbyName()}`, () => goLobby(), () => this.closeOverlay()));
      return;
    }
    const st = this.stake;
    if (st && !st.over) return this.leaveStake(st, 'lobby');
    if (!inGame()) return goLobby();
    this.openOverlay('menu', confirm(this, leaveText(), `回${lobbyName()}`, () => goLobby(), () => this.closeOverlay()));
  }

  private stakeStripTap(): void {
    const st = this.stake;
    if (!st || st.over || this.overlay !== null || this.isBusy) return;
    this.leaveStake(st, 'lobby');
  }

  /** 结算弹窗里的"回大厅"：和顶栏的一样先确认一次（确认框叠在结算上，点"算了"回到结算） */
  private lobbyFromSettle(): void {
    if (this.net ? !inOnlineGame() : !inGame()) return goLobby();
    const m = confirm(this, leaveText(), `回${lobbyName()}`, () => goLobby(), () => (this.settleConfirm = null));
    this.settleConfirm = m;
  }

  private onHome(): void {
    const st = this.stake;
    if (st && !st.over) return this.leaveStake(st, 'title');
    const net = this.net;
    // 旁观的人没有座位，直接走
    if (this.watching) return this.leaveRoom();
    if (net && net.room?.status === 'playing') {
      // 好友房：离开就把座位交给电脑（不判输），先问一句
      // 我是最后一个真人：房间就此结束（0.6.0），说清楚
      const others = net.room.seats.some((s, i) => s.kind === 'human' && i !== net.mySeat);
      const ns = this.netStake;
      const me = ns?.seats[0];
      const ph = net.view().phase;
      const mid = ph === 'play' || ph === 'tribute' || ph === 'return';
      const msg = ns && !ns.over ? (me?.paid === 'yes' ? roomLeaveText(me.points, me.points * pointValue(ns.tier), payout(ns.tier, me.points), mid) : ROOM_STAKE_TEXT.leave) : others ? '离开这个房间？你的座位交给电脑接着打' : '离开这个房间？没有别人在了，这一局就结束';
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
    presenceNow();
    this.scene.start('title');
  }

  private get net(): NetSession | null {
    return this.ses instanceof NetSession ? this.ses : null;
  }

  /** 旁观：好友房开打了、我没坐下（画面座位 0 是真实的 0 号座位上的人） */
  private get watching(): boolean {
    return !!this.net?.watching;
  }

  /** 画面座位 seat 是不是我自己（旁观时谁都不是） */
  private isMe(seat: number): boolean {
    return seat === ME && !this.watching;
  }

  /** 两队的叫法：我方 / 对方；旁观时没有"我"，叫一队（下、上两家）、二队 */
  private side(team: number): string {
    if (this.watching) return team === 0 ? '一队' : '二队';
    return team === 0 ? '我方' : '对方';
  }

  private get stake(): StakeSession | null {
    return this.ses instanceof StakeSession ? this.ses : null;
  }

  /** 好友房实盘：现在显示的这一帧里每个座位的账（娱乐房间为 null） */
  private get netStake(): StakeView | null {
    return this.net?.shown?.stake ?? null;
  }

  /**
   * 实盘中途离开（2.2）：第一副还没打完就原样退回；打了几副就给三个选择——现在结算、先存着、接着打，默认先存着，不强迫人结束。
   * 左上"大厅"、实盘条（0.11.2，所有者找不到中途结算）去大厅；右上"←"回标题。结算写明按现在的分结回多少。
   */
  private leaveStake(st: StakeSession, to: 'lobby' | 'title'): void {
    const go = (): void => {
      this.cancelBot();
      if (to === 'lobby') goLobby();
      else this.scene.start('title');
    };
    if (st.stake.match.deals.length === 0) {
      this.openOverlay('menu', confirm(this, STAKE_TEXT.refundAsk, '退出', () => void this.refundAndLeave(st, to), () => this.closeOverlay()));
      return;
    }
    const where = to === 'lobby' ? `，回${lobbyName()}` : '';
    const m = modal(this, 680, 380, undefined, { closeBtn: false });
    this.openOverlay('menu', m);
    m.body.add(text(this, 0, -126, `这场实盘打了 ${st.stake.match.deals.length} 副，本场 ${signed(st.points)} 分`, { size: TYPE.title, bold: true, wrap: 600 }));
    m.body.add(text(this, 0, -76, settleNowText(st.points, st.points * pointValue(st.tier), payout(st.tier, st.points)), { size: TYPE.label, bold: true, color: COLOR.redDark, wrap: 600 }));
    m.body.add(text(this, 0, -40, '先存着：24 小时内回来接着打', { size: TYPE.label, color: COLOR.muted, wrap: 600 }));
    const now = new Button(this, -160, 36, 290, 60, `现在结算${where}`, 'red', () => {
      m.close();
      this.overlay = null;
      this.overlayModal = null;
      st.finish();
      this.showStakeResult(to === 'lobby');
    });
    const keep = new Button(this, 160, 36, 290, 60, `先存着${where}`, 'wood', () => {
      m.close();
      go();
    });
    const cancel = new Button(this, 0, 122, 200, 52, '接着打', 'wood', () => {
      m.close();
      this.closeOverlay();
    });
    m.body.add([now, keep, cancel]);
    m.body.setData('ok', keep);
    m.body.setData('settleNow', now);
    m.body.setData('cancel', cancel);
  }

  private async refundAndLeave(st: StakeSession, to: 'lobby' | 'title'): Promise<void> {
    this.cancelBot();
    const r = await refundStake(st.stake);
    if (!this.alive) return;
    // 去大厅：退成了才走；没退成存档留着（标题页能接着打、到期钱包原样退回），照样走
    if (to === 'lobby') return goLobby();
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
      // 房间转发的（含我自己发的）："说话人:编号:对象:电脑"，画面座位
      const [vs, id, to, bot] = (detail ?? '').split(':');
      const e = { from: Number(vs), id: Number(id), to: to ? Number(to) : undefined };
      if (!Number.isInteger(e.from) || !Number.isInteger(e.id)) return;
      // 电脑的是房间看了这一步当场发的，比出牌的画面早到：排到手头这几帧播完再放，免得炸弹还没出来电脑就先显摆
      if (bot === '1' && (this.busy || (this.net?.queue.length ?? 0) > 0)) this.botEmotes.push(e);
      else this.funIn(e.from, e.id, e.to);
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
    // 电脑的互动：画面追上了再放（每 250 毫秒看一次，一次放一条）
    if (this.botEmotes.length && !this.busy && (this.net?.queue.length ?? 0) === 0) {
      const e = this.botEmotes.shift()!;
      this.funIn(e.from, e.id, e.to);
    }
    this.nudges?.tickTurn(this.overlay === null && t ? t.seat : null, t ? `${t.seat}:${t.deadline}` : '');
    // 我的最后 5 秒：每秒"嗒"一声，最后 2 秒每半秒一声、升调
    const left = t && this.isMe(t.seat) && t.deadline !== null ? t.deadline - now : -1;
    if (left > 0 && left <= 5000) {
      const slot = left > 2000 ? Math.ceil(left / 1000) : 10 + Math.ceil(left / 500);
      if (slot !== this.tickSlot) audio.sfx('tick', { pitch: left > 2000 ? 0 : 5 });
      this.tickSlot = slot;
    } else this.tickSlot = -1;
  }

  /** 好友房刚轮到我：后台时标题闪，前台时手机振一下（叮的一声在播到"轮到"那一步时响）；不轮到我了就停闪 */
  private noticeNetTurn(): void {
    const t0 = this.net?.turnInfo();
    const mine = !!t0 && this.isMe(t0.seat);
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
    this.fun?.closeAll();
    this.nudges?.clearTip();
    this.syncFunShown();
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
    if (this.net) {
      // 旁观：没有手牌、不能出手；顶上那条写"旁观中"，有能坐的座位出"坐下"
      const watch = this.watching;
      const sit = watch ? this.net.freeSeat() : null;
      this.btnSit?.setVisible(watch && sit !== null && this.overlay === null);
      if (watch) {
        for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear]) b.setVisible(false);
        this.hand.enabled = false;
        this.setStatus(sit === null ? '旁观中 · 看不到任何人的手牌' : '旁观中 · 看不到任何人的手牌，点"坐下"一起打');
        return;
      }
    }

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
          this.feedPosted = [];
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
        this.dealToOthers(W / 2, 250);
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
        if (this.isMe(e.seat) && !this.ses.autoplay) {
          audio.sfx('turn');
          // 单机也振一下（好友房在收到房间消息时就振了，见 noticeNetTurn）
          if (!this.net) vibrate();
        }
        if (e.seat !== ME && !this.net) stopFlash();
        break;
      case 'play': {
        const victim = this.trick.topSeat();
        // 名场面：炸上炸（出牌记录里这一手已经在最后了）
        const hist = this.ses.view().history;
        const bob = bombOnBomb(hist.slice(0, -1), e.seat, e.play);
        await this.animatePlay(e.seat, e.play, e.left);
        if (bob) {
          this.fxLog.push('名场面 炸上炸');
          toast(this, `名场面！${seatName(e.seat)} 炸上炸`, worldW(this) / 2, 300, COLOR.goldLight);
        }
        this.nudges?.suggest(suggestFor(e, victim));
        this.funMoment(momentOf(e, victim, this.ses.view().dealNo));
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
          if (this.isMe(e.seat)) await bigWord(this, '头游！', { color: COLOR.goldLight, hold: 700 });
          else {
            this.talk(partnerOf(e.seat), 'partnerFirst');
            await banner(this, `${seatName(e.seat)} 头游`);
          }
        }
        // 末游的电脑嘟囔一句（双下时两个人都说也不奇怪）
        if (e.place === 4) this.talk(e.seat, 'last');
        await this.seats[e.seat]!.setPlace(e.place, true);
        this.nudges?.suggest(suggestFor(e, -1));
        this.funMoment(momentOf(e, -1, this.ses.view().dealNo));
        break;
      }
      case 'dealEnd':
        this.funMoment(dealMoment(e.result));
        this.feedDeal(e.result);
        // 最后一手和名次章留在桌上看清楚，再弹结算
        await wait(this, 1500);
        break;
      case 'gameOver':
        break;
    }
  }

  private async animatePlay(seat: number, play: Play, left: number): Promise<void> {
    const from = this.seats[seat]!.center;
    const views = this.isMe(seat) ? this.hand.take(play.cards) : null;
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
    else if (!this.isMe(seat)) {
      const last = this.ses.view().history;
      // 压过别人时才说"压一手"之类；领出时偶尔说一句
      const prev = last.length >= 2 ? last[last.length - 2] : null;
      this.talk(seat, prev && prev.play ? 'beat' : 'lead');
    }
    // 报牌：别家的张数刚跨过 10 张、3 张时弹一下
    const before = left + play.cards.length;
    if (!this.isMe(seat) && left > 0 && ((before > 10 && left <= 10) || (before > 3 && left <= 3))) {
      this.seats[seat]!.callCount(left);
      audio.sfx('call', { pitch: left <= 3 ? 4 : 0 });
    }
    if (left > 0 && left <= 6 && !this.isMe(seat)) {
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
      // 三档（bombDrama）：四炸、五六炸、同花顺和七炸以上；越大闪得越亮、震得越久，三档加光圈和纸屑
      const tier = bombDrama(play);
      flash(this, 0xffffff, [0.35, 0.5, 0.65][tier - 1]!);
      shake(this, [300, 420, 560][tier - 1]!, [0.008, 0.013, 0.018][tier - 1]!);
      burst(this, a.px, a.py, 'spark', [28, 44, 64][tier - 1]!, { speed: [160, 480 + tier * 60] });
      burst(this, a.px, a.py, 'smoke', 8, { speed: [40, 120], life: 900, gravity: -40, scale: [1.4, 2.4] });
      if (tier === 3) {
        rays(this, a.px, a.py, 0xffb040);
        burst(this, a.px, a.py, 'confetti', 36, { speed: [220, 560], life: 1400, gravity: 420 });
      }
      // 垫在出牌下面（出牌区 depth 200+）：大字一闪，刚炸出来的牌不被挡住
      await bigWord(this, label, { size: [68, 80, 92][tier - 1]!, color: 0xfff0c8, stroke: COLOR.red, hold: 650 + tier * 100, depth: 190 });
    }
  }

  /**
   * 发牌时另外三家也"收到牌"（art-v3）：从桌心往三家头像各飞 6 张牌背，和我的手牌同一个节奏，到了就消失。
   * 纯画面，不等它（我的手牌发完就往下走）；关了动画不飞
   */
  private dealToOthers(x: number, y: number): void {
    if (dur(1) === 0) return;
    const key = `back:${getSettings().back}`;
    const step = dur(26) * 4;
    for (let k = 0; k < 6; k++) {
      this.seats.forEach((sv) => {
        if (this.isMe(sv.seat)) return;
        const to = sv.center;
        const img = this.add.image(x, y, key).setDisplaySize(46, 64).setAngle(-12).setDepth(180);
        this.tweens.add({
          targets: img,
          x: to.x,
          y: to.y,
          angle: sv.seat === 1 ? 20 : sv.seat === 3 ? -20 : 0,
          scale: img.scale * 0.7,
          delay: k * step + sv.seat * dur(20),
          duration: dur(300),
          ease: 'Cubic.easeOut',
          onComplete: () => img.destroy(),
        });
      });
    }
  }

  /** 贡牌飞过去（别人之间的还贡只看到牌背）。 */
  private async flyTribute(from: number, to: number, card: Card | null, label: string): Promise<void> {
    audio.sfx('tribute');
    this.fxLog.push(label);
    const a = this.seats[from]!.center;
    const b = this.seats[to]!.center;
    let v: CardView;
    if (this.isMe(from) && card !== null) {
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
    if (this.isMe(to)) {
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
    // 左下的复盘和称号行数不定：弹窗按最后一行往下留出边距，免得最后一行贴着下边被截（试玩评测 0.11.1）
    const history = this.ses.view().history;
    const rc = dealRecap(r, history);
    const recap = [
      `炸弹 ${this.side(0)} ${rc.bombs[0]} · ${this.side(1)} ${rc.bombs[1]}${this.dealJiefeng ? ` · 接风 ${this.dealJiefeng} 次` : ''}`,
      rc.top ? `最大一炸 ${seatName(rc.top.seat)}：${playDetail(rc.top.play)}` : `头游 ${seatName(r.order[0]!)} ${rc.firstPlays} 手出完`,
    ];
    // 名场面（0.7.1）：最精彩的两条。手机上字托底到 12 像素，框里一行只放得下十来个字：名场面、称号各留一条，再长的截断
    const phone = phoneType();
    const hl = dealHighlights(r, history).slice(0, phone ? 1 : 2);
    if (hl.length) recap.push(`名场面：${hl.map((h) => highlightText(h, seatName)).join('；')}`);
    const titles = dealTitles(r, history).slice(0, phone ? 1 : undefined);
    // 左下分两框（art-v3）：上面是数据（炸弹、最大一炸），下面是故事（名场面、称号），不再红黑混排一长串
    // 数据框从名次第四行下面留出一点开始（第四行下沿 96），行距 28
    const dataY = 124;
    const row = phone ? 32 : 28;
    const storyY = dataY + row + 16 + 12 + 16;
    const story = recap.length - 2 + titles.length;
    const lastY = story > 0 ? storyY + (story - 1) * row : dataY + row;
    const m = modal(this, 820, Math.max(560, 2 * (lastY + 16 + 30)), `第 ${r.dealNo} 副 结束`, { closeBtn: false });
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
      b.add(text(this, -26, y, this.side(teamOf(seat)), { size: TYPE.small, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem, bold: true, ox: 1 }));
    });
    // 右：升级
    const rx = 190;
    const before = r.levelsBefore[r.winnerTeam]!;
    const after = r.levelsAfter[r.winnerTeam]!;
    b.add(text(this, rx, -176, `${this.side(r.winnerTeam)}赢了这副`, { size: TYPE.title, bold: true, color: mine ? COLOR.red : COLOR.teamThem, font: 'title' }));
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
    if (r.aFailedTeam >= 0) notes.push(`${this.side(r.aFailedTeam)}打 A 没过`);
    if (r.aResetTeam >= 0) notes.push(`${this.side(r.aResetTeam)}退回打 2`);
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
    const boxes = this.add.graphics();
    boxes.fillStyle(0xf3e6c9, 1).fillRoundedRect(-378, dataY - 16, 368, row + 32, 10);
    if (story > 0) boxes.fillStyle(0xfbe3d8, 1).fillRoundedRect(-378, storyY - 16, 368, (story - 1) * row + 32, 10);
    b.add(boxes);
    recap.slice(0, 2).forEach((line, i) => b.add(fitWidth(text(this, -366, dataY + i * row, line, { size: TYPE.small, color: COLOR.ink, ox: 0 }), 344)));
    const storyLines = [...recap.slice(2), ...titles.map((t) => this.titleLine(t, true))];
    storyLines.forEach((line, i) => b.add(fitWidth(text(this, -366, storyY + i * row, line, { size: TYPE.small, bold: true, color: COLOR.redDark, ox: 0 }), 344)));
    // 主按钮右挪，左边放"回大厅"：结算弹窗盖着顶栏的大厅按钮，任何界面两步内要能回大厅（仓库 AGENTS 第 2 节）
    const by = stakeLine ? 200 : 190;
    const lobby = new Button(this, rx - 126, by, 132, 56, lobbyName(), 'wood', () => this.lobbyFromSettle(), 'home');
    b.add(lobby);
    b.setData('lobby', lobby);
    const btn = new Button(this, rx + 70, by, 210, 64, matchOver ? '结算' : net ? '继续' : '下一副', 'red', () => {
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
    const watch = this.watching;
    const win = v.winner === 0;
    audio.music('off');
    audio.sfx(win || watch ? 'win' : 'lose');
    const W = worldW(this);
    const stop = win ? rain(this, 'confetti', 4900) : rain(this, 'smoke', 4900);
    if (win) {
      rays(this, W / 2, 200);
      burst(this, W / 2, 200, 'coin', 40, { speed: [200, 600], life: 1600, gravity: 600 });
    }
    const m = modal(this, 760, 540, watch ? '整局结束' : win ? '胜利！' : '惜败', { closeBtn: false, depth: 5000 });
    this.openOverlay('gameOver', m);
    m.root.once('destroy', stop);
    const b = m.body;
    // 好友房一场打完（0.14.0）：颁奖代替四个头像那一排和称号那一行；0.14.0 以前开的房间没有记录，照旧
    const awards = this.roomAwards(v.winner);
    if (awards) this.addAwards(b, -95, awards);
    // 两队四人
    if (!awards) [0, 2, 1, 3].forEach((seat, i) => {
      const x = -255 + i * 170;
      const mood: Mood = teamOf(seat) === v.winner ? 'happy' : 'sad';
      const img = this.add.image(x, -120, `avatar:${seatPerson(seat)}:${mood}`).setDisplaySize(110, 110);
      b.add(img);
      if (teamOf(seat) === v.winner) this.tweens.add({ targets: img, y: -134, duration: dur(420), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      b.add(text(this, x, -48, seatName(seat), { size: TYPE.label, bold: true, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
    });
    b.add(text(this, 0, 18, watch ? `${this.side(v.winner)}先过 A，赢下整局` : win ? '我方先过 A，赢下整局！' : '对方先过了 A，下局再来', { size: TYPE.title, bold: true, color: win ? COLOR.red : COLOR.muted, font: 'title' }));
    // 整局的称号：一行排开，按钮上方
    this.logMatch();
    const titles = matchTitles(this.matchLog);
    // 分享（art-v3）：按钮行正中带字的"晒战绩"，不再是右上角一个小图标
    if (!watch) this.addShare(b, 0, 170, { kind: 'game', win, room: this.net?.code ?? null }, awards, 200);
    if (titles.length && !awards) b.add(text(this, 0, 114, titles.map((t) => this.titleLine(t, false)).join('    '), { size: TYPE.small, bold: true, color: COLOR.redDark }));
    if (this.net && watch) {
      // 旁观的人：看完结果回首页（"再来一场"是这一桌的人一起换房间，不带旁观的）
      b.add(new Button(this, 0, 170, 240, 64, '回首页', 'red', () => this.leaveRoom(), 'back'));
      return;
    }
    if (this.net) {
      // 好友房不计战绩。再来一场（0.6.2）：开个新房间，这一桌的人自动跟过去、坐回原来的座位
      const tip = text(this, 0, 74, '好友房不计战绩 · 点"再来一场"，这一桌一起换到新房间', { size: TYPE.label, color: COLOR.ink });
      b.add(tip);
      b.setData('againTip', tip);
      const home = new Button(this, -230, 170, 200, 64, '回首页', 'wood', () => this.leaveRoom(), 'back');
      const again = new Button(this, 230, 170, 200, 64, '再来一场', 'red', () => void this.again(again), 'restart');
      b.add([home, again]);
      b.setData('again', again);
      b.setData('home', home);
      // 结束页出来之前已经有人开了新房间：让大家先看一眼结果再走
      const a = this.net.againInfo;
      if (a) this.followAgain(a);
      return;
    }
    // 战绩一行只在真有战绩时写（URL 开的局、实盘不计战绩，新账号写"0/0 胜率 0%"没意思）
    const st = getStats();
    if (st.games > 0) {
      const rate = Math.round((st.wins / st.games) * 100);
      b.add(text(this, 0, 74, `战绩 ${st.wins}/${st.games}  胜率 ${rate}%  连胜 ${st.streak}（最高 ${st.bestStreak}）`, { size: TYPE.label, color: COLOR.ink }));
    }
    b.add(new Button(this, -230, 170, 200, 64, '回首页', 'wood', () => this.scene.start('title'), 'back'));
    b.add(new Button(this, 230, 170, 200, 64, '再来一局', 'red', () => this.newGame(), 'restart'));
  }

  /**
   * 结算页右上角的"分享"（0.13.0，docs/social.md 1.1）：画一张战绩图，手机上调系统分享，不支持的出预览。只用公开的结果，不画手牌
   */
  private addShare(b: Phaser.GameObjects.Container, x: number, y: number, k: ShareKind, awards: readonly Award[] | null = null, labelW = 0): void {
    this.logMatch();
    // 好友房用房间攒的记录（中途进来、刷新过的人本地记的不全），颁奖写进卡里
    const log = (awards && this.net?.matchLog) || this.matchLog;
    const card = shareCardOf(k, log, matchTitles(log), this.myShareName(), awards ? { awards, name: seatName } : undefined);
    // 结算页一出来就先画好卡，点的时候在同一个点击里调系统分享（iOS 要这样）
    const share = prepareResult(card, k.room);
    // labelW > 0：按钮行里带字的"晒战绩"（整局结束页）；否则角上一个图标（实盘结算）
    const btn = labelW > 0 ? new Button(this, x, y, labelW, 64, '晒战绩', 'gold', share, 'share') : iconButton(this, x, y, 'share', share, 56);
    b.add(btn);
    b.setData('share', btn);
  }

  /** 卡上写的名字：好友房用房间里的昵称，单机有平台时用账号的昵称，单独部署不写 */
  private myShareName(): string | null {
    const me = this.net ? seatIdentity[0] : null;
    if (me?.human) return me.name;
    const u = platformInfo().platform === true ? (platformInfo() as { user: unknown }).user : null;
    const n = (u as { displayName?: unknown } | null)?.displayName;
    return typeof n === 'string' && n ? n : null;
  }

  /**
   * 一副打完：挑一条和我有关的名场面报到好友动态（0.15.0，src/view/feed.ts）。只报娱乐（实盘结回时平台自己会生成），旁观、调试代打不报；
   * 没平台、没登录时 postFeed 什么都不发
   */
  private feedDeal(r: DealResult): void {
    if (this.stake || this.netStake || this.watching || this.ses.autoplay) return;
    const m = feedPick(dealHighlights(r, this.ses.view().history), this.feedPosted);
    if (!m) return;
    this.feedPosted.push(m.moment);
    postFeed(m);
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

  /**
   * 好友房这一场的奖（0.14.0，src/net/awards.ts）：按房间下发的公开记录算，画面座位。单机、0.14.0 以前开的房间、一副都没打完时是 null。
   * gameWinner 是过了 A 的队，没人过 A 时是 -1（按赢的副数算）
   */
  private roomAwards(gameWinner: number): Award[] | null {
    const log = this.net?.matchLog;
    if (!log) return null;
    const a = matchAwards(log, winnerOf(log, gameWinner));
    return a.length ? a : null;
  }

  /** 颁奖那一排：每个奖一张卡（奖名大字、头像和名字、一句话），居中排开 */
  private addAwards(b: Phaser.GameObjects.Container, y: number, awards: readonly Award[]): void {
    const w = 220;
    const gap = 16;
    awards.forEach((a, i) => {
      const x = (i - (awards.length - 1) / 2) * (w + gap);
      const g = this.add.graphics();
      g.fillStyle(COLOR.paper, 1).fillRoundedRect(x - w / 2, y - 74, w, 148, 14);
      g.lineStyle(3, a.id === 'unlucky' ? COLOR.wood : COLOR.gold, 1).strokeRoundedRect(x - w / 2, y - 74, w, 148, 14);
      b.add(g);
      b.add(text(this, x, y - 46, AWARD_NAME[a.id], { size: TYPE.title, bold: true, color: a.id === 'unlucky' ? COLOR.wood : COLOR.redDark }));
      b.add(this.add.image(x - 70, y - 2, `avatar:${seatPerson(a.seat)}:${a.id === 'unlucky' ? 'sad' : 'happy'}`).setDisplaySize(48, 48));
      b.add(text(this, x + 20, y - 2, seatName(a.seat), { size: TYPE.label, bold: true, color: teamOf(a.seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
      b.add(text(this, x, y + 40, a.line, { size: TYPE.small, color: COLOR.ink, wrap: w - 20 }));
    });
    b.setData('awards', awards);
  }

  newGame(seed = randomSeed()): void {
    app.session = Session.fresh(seed);
    this.scene.restart();
  }

  /**
   * 实盘一场的结算（2.1 第 5、6 步）：先显示这一场的分和筹码，同时去结回钱包；结回成功后写钱包还有多少，到顶了另写一句。
   * 两个按钮一样大、一样颜色，不自动开下一场，没有倒计时（第 5 节）。输了不放失败音效。
   */
  /** toLobby：中途"现在结算，回大厅"——结回了（或者记进存档等下次结）就去大厅，出错就停在这页让人看清 */
  private showStakeResult(toLobby = false): void {
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
    this.addShare(b, 340, -200, { kind: 'stake', tier: save.tier, points: done.points, chips: done.points * pv, deals: done.deals, room: null });
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
        return;
      }
      if (toLobby) {
        status.setText(`${status.text}，正在回${lobbyName()}…`);
        this.time.delayedCall(1200, () => goLobby());
      }
    });
  }

  /**
   * 好友房实盘一场的结算（3.2）：我的分和筹码、每个人的输赢；结回由房间去钱包办，办完这一行字跟着房间的帧变成"已经结回钱包"。
   * 再打要重新开房（和娱乐房间打完一样）。
   */
  private showNetStakeResult(): void {
    const ns = this.netStake!;
    const watch = this.watching;
    const me = ns.seats[0]!;
    const pv = pointValue(ns.tier);
    const v = this.ses.view();
    audio.music('off');
    audio.sfx(me.paid === 'yes' && me.points > 0 ? 'levelUp' : 'pass');
    // 颁奖（0.14.0）：有奖时弹窗加高，奖那一排插在"为什么结束"和每个人的分之间，下面整体往下挪
    const awards = this.roomAwards(v.phase === 'gameOver' ? v.winner : -1);
    const dy = awards ? 170 : 0;
    const top = awards ? -80 : 0;
    const m = modal(this, 780, 520 + dy, undefined, { closeBtn: false, depth: 5000 });
    this.openOverlay('stake', m);
    const b = m.body;
    if (awards) this.addAwards(b, -72, awards);
    b.add(text(this, 0, top - 196, `好友房实盘 · ${TIER_NAME[ns.tier]}`, { size: TYPE.label, bold: true, color: COLOR.muted }));
    // 没带上的人（不计输赢）没有可分享的
    if (!watch && me.paid === 'yes') this.addShare(b, 340, top - 210, { kind: 'stake', tier: ns.tier, points: me.points, chips: me.points * pv, deals: ns.deals, room: this.net?.code ?? null }, awards);
    const head = watch ? '这一场打完了' : me.paid !== 'yes' ? '这一场不计输赢' : me.points === 0 ? '这场打平，0 分' : `这场 ${signed(me.points)} 分，${signed(me.points * pv)}`;
    b.add(text(this, 0, top - 148, head, { size: TYPE.big, bold: true, color: me.paid === 'yes' && me.points > 0 ? COLOR.red : COLOR.ink }));
    const why = v.phase === 'gameOver' ? `${this.side(v.winner)}先过了 A，这一场提前结束` : ns.deals >= ROOM_DEALS ? `打满 ${ROOM_DEALS} 副` : '这一场提前结束';
    b.add(text(this, 0, top - 96, why, { size: TYPE.label, color: COLOR.ink }));
    // 每个人：到账的写分，别的写"不计输赢"（电脑是庄家的）
    [0, 1, 2, 3].forEach((seat, i) => {
      const s = ns.seats[seat]!;
      const x = -270 + i * 180;
      b.add(this.add.image(x, top + dy - 30, `avatar:${seatPerson(seat)}:normal`).setDisplaySize(64, 64));
      b.add(text(this, x, top + dy + 16, seatName(seat), { size: TYPE.small, bold: true, color: teamOf(seat) === 0 ? COLOR.teamUs : COLOR.teamThem }));
      // 从没带入过的是开局时的电脑座位（庄家的）
      const line = s.paid === 'yes' ? `${signed(s.points)} 分` : s.paid === 'left' ? `${signed(s.points)} 分（中途走了）` : s.paid === 'no' ? '电脑' : '不计输赢';
      b.add(text(this, x, top + dy + 44, line, { size: TYPE.small, color: COLOR.ink }));
    });
    this.netStakeStatus = text(this, 0, top + dy + 96, '', { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 700 });
    b.add(this.netStakeStatus);
    this.refreshNetStake();
    b.add(new Button(this, 0, top + dy + 168, 260, 64, '回首页', 'red', () => this.leaveRoom(), 'back'));
    b.add(text(this, 0, top + dy + 228, STAKE_TEXT.noCash, { size: TYPE.small, color: COLOR.muted }));
  }

  /** 结算页那行字：看最新收到的一帧（结算页开着时帧不往下播，直接看队尾） */
  private refreshNetStake(): void {
    const t = this.netStakeStatus;
    const net = this.net;
    if (!t?.scene || !net) return;
    const ns = net.queue[net.queue.length - 1]?.nv.stake ?? net.shown?.stake;
    const me = ns?.seats[0];
    // 旁观的人没有自己的账
    if (!ns || !me || this.watching) return;
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
    put('sit', this.btnSit);
    if (this.counterAt) out['counter'] = { ...this.counterAt, enabled: true, visible: true };
    // 互动（kit 的 DOM）：屏幕坐标换回世界坐标，冒烟和别的控件一样点
    const cr = this.game.canvas.getBoundingClientRect();
    const f = worldH / cr.height;
    for (const [k, c] of Object.entries(this.fun?.controls() ?? {})) out[k] = { x: (c.x - cr.left) * f, y: (c.y - cr.top) * f, enabled: true, visible: true };
    this.nudges?.controls(out);
    if (this.inviteBtn) out['invite'] = { x: this.inviteBtn.x, y: this.inviteBtn.y, enabled: true, visible: true };
    if (this.cloudBtn?.visible) out['cloud'] = { x: this.cloudBtn.x, y: this.cloudBtn.y, enabled: true, visible: true };
    put('lobby', this.lobbyBtn);
    if (this.stakeStrip) out['stakeStrip'] = { ...this.stakeStrip, enabled: true, visible: true };
    put('rebuy', this.rebuyBtn);
    this.topIcons.forEach((b, i) => (out[`top${i}`] = { x: b.x, y: b.y, enabled: true, visible: b.visible }));
    const top = this.settleConfirm ?? this.overlayModal;
    for (const k of ['ok', 'cancel']) {
      const b = top?.body.getData(k) as Button | undefined;
      if (b) out[k] = { x: b.x + top!.body.x, y: b.y + top!.body.y, enabled: true, visible: true };
    }
    for (const k of ['again', 'home', 'settleNow', 'share']) {
      const b = this.overlayModal?.body.getData(k) as Button | undefined;
      if (b?.scene) out[k] = { x: b.x + this.overlayModal!.body.x, y: b.y + this.overlayModal!.body.y, enabled: b.enabled ?? true, visible: true };
    }
    const next = this.overlayModal?.body.getData('next') as Button | undefined;
    if (next && this.overlay === 'settle') out['next'] = { x: next.x + this.overlayModal!.body.x, y: next.y + this.overlayModal!.body.y, enabled: true, visible: true };
    const lb = this.overlayModal?.body.getData('lobby') as Button | undefined;
    if (lb && this.overlay === 'settle') out['settleLobby'] = { x: lb.x + this.overlayModal!.body.x, y: lb.y + this.overlayModal!.body.y, enabled: true, visible: true };
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
