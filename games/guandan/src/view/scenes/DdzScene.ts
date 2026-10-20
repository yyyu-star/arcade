/**
 * 斗地主牌桌（牌馆 0.28.0，docs/doudizhu.md 第 4 节）：单机，我 + 老周（下家，右）+ 王姐（上家，左）。
 * 画面部件和掼蛋共用（手牌 HandView、出牌区 TrickView、座位 SeatView、按钮、弹窗、特效、kit 的牌桌互动），按斗地主的理牌、牌型名注入；
 * 这里只管斗地主的流程：叫分 → 地主拿底牌 → 出牌 → 每副结算 → 一局打完。推进只走 DdzSession.apply（规则核心 dispatchDdz），画面不算规则。
 */
import Phaser from 'phaser';
import { TableFun, funItem, type FunSeat } from 'arcade-kit/table-fun';
import { localChat } from 'arcade-kit/chat';
import {
  chooseDdz, currentMult, interpretDdz, isBombish, hintDdz, sortDdz,
  type DdzEvent, type DdzPlay, type DdzResult, type DdzView,
} from '../../variants/doudizhu/index.ts';
import { MOOD_LINES, PHRASES } from '../../variants/guandan/net/fun-moments.ts';
import { taunt } from '../../net/emotes.ts';
import { app } from '../app.ts';
import { audio } from '../audio.ts';
import { dur, wait } from '../anim.ts';
import { DDZ_ME, DdzSession, type DdzTableSession } from '../ddz-session.ts';
import { DdzNetSession } from '../ddz-net.ts';
import { DdzStakeSession, settleDdzStake } from '../ddz-stake.ts';
import { closeText, errorText, type NetEvent } from '../net.ts';
import { flashTitle, stopFlash, vibrate } from '../attention.ts';
import { presenceNow } from '../social.ts';
import { STAKE_ERROR, STAKE_TEXT, TIER_NAME, fmtChips, signed, stakeError } from '../stake-text.ts';
import { POINTS_PER_SHARE as DDZ_POINTS_PER_SHARE, SOLO_DEALS as DDZ_SOLO_DEALS, pointValue as ddzPointValue } from '../../variants/doudizhu/stake/index.ts';
import { dailySubmitText, ddzDailySeed, submitDdzDaily } from '../ddz-daily.ts';
import { randomSeed } from '../session.ts';
import { DDZ_ORDER, ddzDescribe, ddzPlayDetail, ddzPlayLabel } from '../ddz-view.ts';
import { LOW_MEMORY } from '../device.ts';
import { DDZ_SEAT_PERSON, seatIdentity, seatName, seatPerson, setTablePersons } from '../labels.ts';
import { goLobby, inOnlineGame, leaveText } from '../lobby.ts';
import { lineFor, thinkTime, type Situation } from '../personas.ts';
import { lobbyName } from '../platform.ts';
import { getSettings, updateSettings } from '../store.ts';
import { COLOR, TYPE, minHit } from '../theme.ts';
import { CardView } from '../table/card.ts';
import { banner, bigWord, burst, flash, rays, shake } from '../table/fx.ts';
import { HandView } from '../table/hand.ts';
import { BUTTON_Y, TOPBAR_H, seatAnchors3 } from '../table/layout.ts';
import { SeatView } from '../table/seats.ts';
import { TrickView } from '../table/trick.ts';
import { hasLayer } from '../ui/focus.ts';
import { Button, iconButton, modal, setHit, text, toast, worldH, worldW, type Modal } from '../ui/kit.ts';
import { applyAudio, confirm } from '../ui/panels.ts';

type Overlay = 'settle' | 'gameOver' | 'menu' | null;

/** 叫分按钮：0 = 不叫 */
const BIDS = [0, 1, 2, 3] as const;

/** 电脑的性格对应 kit 的互动脾气：老周稳、王姐闹 */
const TEMPER_DDZ = { laozhou: 'cool', wangjie: 'rowdy' } as const;

export class DdzScene extends Phaser.Scene {
  private ses!: DdzTableSession;
  private btnBack: Button | null = null;
  private btnSit: Button | null = null;
  /** 联机结算页上"等谁点继续"的那行字 */
  private settleWait: Phaser.GameObjects.Text | null = null;
  private myNetTurn = false;
  private hand!: HandView;
  private seats: SeatView[] = [];
  private trick!: TrickView<DdzPlay>;
  private btnPlay!: Button;
  private btnPass!: Button;
  private btnHint!: Button;
  private btnSort!: Button;
  private btnClear!: Button;
  private bidBtns: Button[] = [];
  private status!: Phaser.GameObjects.Text;
  private statusBg!: Phaser.GameObjects.Graphics;
  private top!: Phaser.GameObjects.Container;
  /** 地主帽（地主定下以后挂在地主头像上） */
  private hat: Phaser.GameObjects.Container | null = null;
  private soundIcon: Phaser.GameObjects.Container | null = null;
  private fun: TableFun | null = null;
  private funShown = true;
  private busy = false;
  private botTimer: Phaser.Time.TimerEvent | null = null;
  private botSeat = -1;
  private hints: DdzPlay[] = [];
  private hintIdx = 0;
  private hintStep = -1;
  overlay: Overlay = null;
  private overlayModal: Modal | null = null;
  /** 最后一副的结算页看过了（一局打完先看这一副，再看总分） */
  private lastSettleSeen = false;
  private alive = true;
  builds = 0;
  lastError: string | null = null;
  readonly fxLog: string[] = [];
  /** 冒烟点按用：控件名 → 世界坐标 */
  private ctl = new Map<string, { x: number; y: number; obj: Phaser.GameObjects.Container }>();

  constructor() {
    super('ddz');
  }

  private get net(): DdzNetSession | null {
    return this.ses instanceof DdzNetSession ? this.ses : null;
  }

  private get solo(): DdzSession | null {
    return this.ses instanceof DdzSession ? this.ses : null;
  }

  /** 旁观：好友房开打了、我没坐下（画面座位 0 是真实的 0 号座位上的人） */
  private get watching(): boolean {
    return !!this.net?.watching;
  }

  /** 画面座位 seat 是不是我自己（旁观时谁都不是） */
  private isMe(seat: number): boolean {
    return seat === DDZ_ME && !this.watching;
  }

  get isBusy(): boolean {
    return this.busy || this.botTimer !== null;
  }

  create(): void {
    this.builds++;
    this.alive = true;
    this.busy = false;
    this.overlay = null;
    this.overlayModal = null;
    this.fun = null;
    this.funShown = true;
    this.botTimer = null;
    this.botSeat = -1;
    this.seats = [];
    this.bidBtns = [];
    this.hat = null;
    this.ctl.clear();
    this.lastSettleSeen = false;
    // 座位上的人物换成斗地主的两个（labels.ts），离开时换回掼蛋的
    setTablePersons(DDZ_SEAT_PERSON);
    this.cameras.main.setOrigin(0, 0).setZoom(app.game ? app.game.scale.gameSize.height / worldH : 1);
    this.events.once('shutdown', () => {
      this.alive = false;
      this.cancelBot();
      this.hand?.destroy();
      stopFlash();
      const n = this.net;
      if (n) n.chatSink = n.chatErrorSink = null;
      this.fun?.destroy();
      this.fun = null;
      setTablePersons(null);
    });
    this.ses = app.ddzNet ?? app.ddz!;
    this.btnBack = this.btnSit = this.settleWait = null;
    this.myNetTurn = false;
    const net = this.net;
    if (net) {
      net.begin();
      const off = net.on((kind, detail) => this.onNet(kind, detail));
      this.events.once('shutdown', off);
      // 这一手的倒计时（房间给的截止时间）、结算页等人
      this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateClocks() });
    }
    const W = worldW(this);
    this.add.image(0, 0, `table:${W}`).setOrigin(0, 0).setDisplaySize(W, worldH);
    const anchors = seatAnchors3(W);
    for (let s = 0; s < 3; s++) this.seats.push(new SeatView(this, s, anchors[s]!));
    this.trick = new TrickView<DdzPlay>(this, anchors, ddzDescribe);
    this.hand = new HandView(this, DDZ_ORDER);
    this.hand.onChange = () => this.refreshButtons();
    this.buildButtons(W);
    this.buildTopBar(W);
    this.buildFun(W);
    audio.music('table');

    const evs = this.ses.lastEvents;
    this.ses.lastEvents = [];
    if (evs.some((e) => e.type === 'deal')) {
      this.sync(false, true);
      void this.playEvents(evs);
    } else {
      this.sync(false);
      this.restoreTable();
      this.pump();
    }
  }

  // ───────────────────────── 搭建 ─────────────────────────

  private reg(name: string, obj: Phaser.GameObjects.Container): void {
    this.ctl.set(name, { x: obj.x, y: obj.y, obj });
  }

  private buildButtons(W: number): void {
    const cx = W / 2;
    this.btnPass = new Button(this, cx - 200, BUTTON_Y, 168, 60, '不要', 'wood', () => this.onPass(), 'pass');
    this.btnHint = new Button(this, cx, BUTTON_Y, 168, 60, '提示', 'gold', () => this.onHint(), 'hint');
    this.btnPlay = new Button(this, cx + 200, BUTTON_Y, 168, 60, '出牌', 'red', () => this.onPlay(), 'play');
    const mh = minHit();
    const sortX = Math.max(cx - 410, 60 + Math.max(72, mh) / 2 + Math.max(56, mh) + Math.max(138, mh) / 2);
    this.btnSort = new Button(this, sortX, BUTTON_Y + 4, 138, 52, '理牌', 'green', () => this.onSort(), 'sort');
    this.btnClear = new Button(this, cx + 410, BUTTON_Y + 4, 138, 52, '重选', 'blue', () => this.onClear(), 'undo');
    // 叫分：四个按钮一排，比当前分低的灰掉；叫分时也能理牌，整排让开"理牌"
    const bid0 = Math.max(cx - 1.5 * 176, sortX + 138 / 2 + 24 + 160 / 2);
    BIDS.forEach((b, i) => {
      const btn = new Button(this, bid0 + i * 176, BUTTON_Y, 160, 60, b === 0 ? '不叫' : `${b} 分`, b === 0 ? 'wood' : b === 3 ? 'red' : 'gold', () => this.act({ type: 'bid', seat: DDZ_ME, bid: b }));
      this.bidBtns.push(btn);
      this.reg(`bid:${b}`, btn);
    });
    for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear, ...this.bidBtns]) b.setDepth(400);
    this.reg('pass', this.btnPass);
    this.reg('hint', this.btnHint);
    this.reg('play', this.btnPlay);
    this.reg('sort', this.btnSort);
    this.reg('clear', this.btnClear);
    // 连着两手没自己出，房间每手几秒就替我出：点一下恢复；旁观的有座位可坐时出"坐下"（坐下后会话换座位、牌桌整个重画）
    const net = this.net;
    if (net) {
      this.btnBack = new Button(this, cx, BUTTON_Y - 104, 240, 60, '我回来了', 'red', () => {
        net.back();
        this.btnBack?.setVisible(false);
      }).setDepth(401).setVisible(false);
      this.btnSit = new Button(this, cx, BUTTON_Y, 240, 60, '坐下', 'red', () => {
        const seat = net.freeSeat();
        if (seat !== null) net.sit(seat);
      }).setDepth(401).setVisible(false);
      this.reg('back', this.btnBack);
      this.reg('sit', this.btnSit);
    }
    this.statusBg = this.add.graphics().setDepth(399);
    this.status = text(this, cx, BUTTON_Y - 50, '', { size: TYPE.label, color: 0xfff3d6, bold: true }).setDepth(400);
  }

  private buildTopBar(W: number): void {
    this.top?.destroy();
    const c = this.add.container(0, 0).setDepth(900);
    this.top = c;
    const g = this.add.graphics();
    g.fillStyle(0x24130a, 0.94).fillRect(0, 0, W, TOPBAR_H);
    g.fillStyle(0x3a2214, 0.55).fillRect(0, 0, W, TOPBAR_H * 0.45);
    g.fillStyle(0xffffff, 0.05).fillRect(0, 2, W, TOPBAR_H * 0.2);
    g.lineStyle(2, COLOR.gold, 0.9).lineBetween(0, TOPBAR_H, W, TOPBAR_H);
    g.lineStyle(1, COLOR.goldLight, 0.35).lineBetween(0, TOPBAR_H - 4, W, TOPBAR_H - 4);
    c.add(g);
    const deep = Math.max(54, minHit(), 2 * (minHit() - 28));
    const lobby = new Button(this, 70, 28, 112, 46, lobbyName(), 'wood', () => this.onLobby(), 'home');
    lobby.setHit(112, deep);
    c.add(lobby);
    this.reg('lobby', lobby);
    // 中间：底分 × 倍数，和底牌（叫完才翻开）
    const v = this.ses.view();
    const mx = W / 2;
    const mult = currentMult(v);
    const bid = v.landlord >= 0 ? v.bid : Math.max(0, ...v.bids.map((b) => b ?? 0));
    const label = bid > 0 ? `${bid} 分 × ${mult} 倍` : mult > 1 ? `× ${mult} 倍` : '叫分中';
    c.add(text(this, mx - 110, 28, label, { size: TYPE.label, bold: true, color: COLOR.goldLight, ox: 1 }));
    const bottom = v.bottom.length ? sortDdz(v.bottom) : [-1, -1, -1];
    bottom.forEach((card, i) => {
      const x = mx - 60 + i * 44;
      if (card >= 0) c.add(new CardView(this, x, 28, card, 0, 38));
      else c.add(this.add.image(x, 28, `back:${getSettings().back}`).setDisplaySize(38, 52));
    });
    c.add(text(this, mx + 90, 28, `${this.ses instanceof DdzStakeSession ? `实盘 · ${TIER_NAME[this.ses.tier]} · ` : this.ses.daily ? '每日 · ' : ''}第 ${v.dealNo}/${v.deals} 副`, { size: TYPE.small, color: 0xd8c6a6, ox: 0 }));
    // 右边：回首页、声音、规则
    const icons: [string, string, () => void][] = [
      ['back', 'home', () => this.onHome()],
      [getSettings().muted ? 'mute' : 'sound', 'sound', () => this.toggleMute()],
      ['rules', 'rules', () => this.openRules()],
    ];
    const pitch = Math.max(56, minHit());
    icons.forEach(([icon, name, fn], i) => {
      const b = iconButton(this, W - 34 - i * pitch, 28, icon, fn, 46);
      setHit(b, pitch, deep);
      c.add(b);
      this.reg(name, b);
      if (name === 'sound') this.soundIcon = b;
    });
  }

  /** 牌桌互动（kit 的 table-fun）：和掼蛋同一套，三个座位；单机在本地播，电脑按性格反应 */
  private buildFun(W: number): void {
    const net = this.net;
    const mh = minHit();
    const left = 60 + Math.max(72, mh) / 2;
    const bw = Math.max(48, Math.min(Math.max(56, mh), this.btnSort.x - this.btnSort.width / 2 - left));
    const bh = Math.max(64, mh);
    const free = (): boolean => this.overlay === null && !hasLayer(this);
    this.fun = new TableFun({
      storageKey: 'guandan',
      phrases: PHRASES,
      named: [taunt('就这？'), taunt('等着瞧'), taunt('等得花都谢了')],
      seats: () =>
        this.seats.map((sv, s): FunSeat => {
          const p = sv.plateBox();
          const who = seatPerson(s);
          return {
            rect: this.screenRect(sv.a),
            ...(p ? { plate: this.worldRect(p.x, p.y, p.w, p.h) } : {}),
            name: seatName(s),
            me: this.isMe(s),
            bot: net ? !!seatIdentity[s] && !seatIdentity[s]!.human : s !== DDZ_ME,
            temper: who === 'laozhou' || who === 'wangjie' ? TEMPER_DDZ[who] : 'normal',
          };
        }),
      avoid: () => [this.worldRect(0, BUTTON_Y - 40, W, worldH - BUTTON_Y + 40)],
      center: () => this.trick.boxes().map((b) => this.worldRect(b.x, b.y, b.w, b.h)),
      button: () => this.worldRect(left, 390 - bh / 2, bw, bh),
      buttonStyle: () => ({ scale: this.worldRect(0, 0, 100, 100).width / 100 }),
      chatButton: () => this.worldRect(126 + 12, 4, Math.max(56, mh), Math.max(48, mh)),
      // 弹幕在左右两家之间、顶栏下沿到"轮到你"那行上面
      danmakuArea: () => {
        const [l, r] = [this.seats[2]!, this.seats[1]!];
        const x0 = l.a.ax + l.a.size / 2 + 40;
        const x1 = r.a.ax - r.a.size / 2 - 40;
        const y0 = TOPBAR_H + 40;
        return this.worldRect(x0, y0, x1 - x0, BUTTON_Y - 72 - y0);
      },
      lite: () => LOW_MEMORY > 0,
      send: (id, to) => (net ? net.emote(id, to) : this.funIn(DDZ_ME, id, to)),
      canSend: () => free() && (!net || net.mySeat !== null),
      hintSeat: () => [1, 2].find((s) => !this.trick.occupied(s)) ?? null,
      enabled: () => getSettings().taunts,
      // 好友房聊天走房间；单机用 kit 的 localChat，只在自己头像旁冒、不发不存
      chat: net
        ? (t: string) => net.chat(t)
        : localChat((t, masked) => {
          audio.sfx('taunt');
          this.fun?.chat(DDZ_ME, t, masked);
        }),
      // 陌生人桌（快速匹配）设置"聊天"选了"不和陌生人"的：这条连接没带 chat=1，聊天页整个不给
      chatEnabled: () => getSettings().chat && (net?.chatOn ?? true),
      scope: () => net?.code ?? 'ddz-solo',
      localBots: !net,
      moodLines: MOOD_LINES,
      sound: (p, phase) => audio.fun(p, phase),
      onHit: (seat) => this.seats[seat]?.hit(),
      log: (line) => this.fxLog.push(line),
    });
    if (net) {
      net.chatSink = (seat, t, masked) => {
        if (this.isMe(seat) || (getSettings().chat && !this.fun?.isBlocked(seat))) audio.sfx('taunt');
        this.fun?.chat(seat, t, masked);
      };
      net.chatErrorSink = (code) => this.fun?.chatError(code);
    }
    this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        const want = this.overlay === null && !hasLayer(this);
        if (want === this.funShown || !this.fun) return;
        this.funShown = want;
        if (want) this.fun.show();
        else this.fun.hide();
      },
    });
  }

  private funIn(from: number, id: number, to?: number): void {
    const it = funItem(id, PHRASES.length);
    if (it && it.kind !== 'prop' && (this.isMe(from) || (getSettings().taunts && !this.fun?.isBlocked(from)))) audio.sfx(it.kind === 'sticker' ? 'sticker' : 'taunt');
    this.fun?.receive(from, id, to);
  }

  private worldRect(x: number, y: number, w: number, h: number): { left: number; top: number; width: number; height: number } {
    const r = this.game.canvas.getBoundingClientRect();
    const f = r.height / worldH;
    return { left: r.left + x * f, top: r.top + y * f, width: w * f, height: h * f };
  }

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

  // ───────────────────────── 顶栏动作 ─────────────────────────

  private toggleMute(): void {
    const muted = !getSettings().muted;
    applyAudio(updateSettings({ muted }));
    const img = this.soundIcon?.getData('icon') as Phaser.GameObjects.Image | undefined;
    img?.setTexture(muted ? 'icon:mute' : 'icon:sound');
  }

  private inGame(): boolean {
    return this.ses.view().phase !== 'gameOver';
  }

  /** 打到一半先确认一次：单机这局存着，回来点"继续"接着打；好友房座位留着（回大厅不算离开房间） */
  private onLobby(): void {
    if (this.net ? !inOnlineGame() : !this.inGame()) return goLobby();
    this.openOverlay('menu', confirm(this, this.net ? leaveText() : `回${lobbyName()}？这局会存着，回来接着打`, `回${lobbyName()}`, () => goLobby(), () => this.closeOverlay()));
  }

  private onHome(): void {
    const net = this.net;
    if (net) {
      // 旁观的人没有座位，直接走；打到一半离开要先问一句
      if (!this.watching && net.room?.status === 'playing') {
        const others = net.room.seats.some((s, i) => s.kind === 'human' && i !== net.mySeat);
        const msg = others ? '离开这个房间？你的座位交给电脑接着打' : '离开这个房间？没有别人在了，这一局就结束';
        // 从结算页点的：确认框叠在结算上，点"算了"要回到结算页，不能让 pump 再弹一份
        const prev = this.overlay === 'settle' ? this.overlayModal : null;
        this.openOverlay('menu', confirm(this, msg, '离开', () => this.leaveRoom(), () => {
          if (!prev) return this.closeOverlay();
          this.overlay = 'settle';
          this.overlayModal = prev;
          this.refreshSettleWait();
        }));
        return;
      }
      return this.leaveRoom();
    }
    this.cancelBot();
    this.scene.start('title');
  }

  private leaveRoom(): void {
    this.cancelBot();
    this.net?.leave();
    app.ddzNet = null;
    presenceNow();
    this.scene.start('title');
  }

  private openRules(): void {
    const m = modal(this, 900, 600, '斗地主怎么玩', { onClose: () => this.closeOverlay() });
    this.openOverlay('menu', m);
    const lines = [
      '一副 54 张，三人各 17 张，留 3 张底牌。轮流叫 1 分、2 分、3 分（只能比前面的高），叫得最高的当地主，拿走底牌先出。都不叫就重发；连着三次都不叫，第四次发完直接由先叫的人按 1 分当地主。',
      '地主一个人对两个农民：谁先出完谁那边赢。',
      '牌从小到大：3 4 5 … K A 2 小王 大王。同样的牌型、张数一样才能压，点数大的压小的。',
      '牌型：单张、对子、三张、三带一、三带一对、顺子（5 张起）、连对（3 对起）、飞机（可带同样多的单张或对子）、四带二、四带两对、炸弹、王炸。顺子、连对、飞机里不能有 2 和王。',
      '炸弹压一切别的牌型，王炸最大。每出一个炸弹或王炸翻一倍；春天（农民一张没出）、反春（地主只出了一手）也翻一倍。',
      '每副的分 = 叫分 × 倍数：地主赢拿两份，两个农民各输一份；农民赢反过来。三家加起来总是 0。',
    ];
    // 一条可能折成两行：按实际高度往下排
    let y = -224;
    for (const l of lines) {
      const t = text(this, -400, y, l, { size: TYPE.body, color: COLOR.ink, ox: 0, oy: 0, wrap: 800, align: 'left' });
      m.body.add(t);
      y += t.height + 14;
    }
  }

  private openOverlay(kind: Overlay, m: Modal): void {
    this.cancelBot();
    this.overlay = kind;
    this.overlayModal = m;
    this.refreshButtons();
  }

  private closeOverlay(): void {
    this.overlay = null;
    this.overlayModal = null;
    this.refreshButtons();
    this.pump();
  }

  // ───────────────────────── 状态 → 画面 ─────────────────────────

  private sync(animateHand = true, beforeDeal = false): void {
    if (!this.alive) return;
    const v = this.ses.view();
    if (!beforeDeal) this.hand.setHand(v.hand, 0, { animate: animateHand });
    for (let s = 0; s < 3; s++) {
      const sv = this.seats[s]!;
      sv.setCount(beforeDeal ? 17 : v.counts[s]!, false);
      sv.setTurn((v.phase === 'play' || v.phase === 'bid') && v.turn === s);
    }
    this.placeHat(v.landlord);
    this.buildTopBar(worldW(this));
    this.refreshButtons();
  }

  /** 刷新、读档后：把这一轮桌上的出牌摆回去 */
  private restoreTable(): void {
    const v = this.ses.view();
    if (v.phase !== 'play') return;
    for (const t of v.trick) this.trick.restore(t.seat, t.play);
  }

  /** 地主帽：一块红底金字的"地主"挂在地主头像上沿 */
  private placeHat(seat: number): void {
    this.hat?.destroy();
    this.hat = null;
    if (seat < 0) return;
    const a = this.seats[seat]!.a;
    const c = this.add.container(a.ax, a.ay - a.size / 2 - 6).setDepth(320);
    const t = text(this, 0, 0, '地主', { size: TYPE.small, bold: true, color: COLOR.goldLight, font: 'title' });
    const g = this.add.graphics();
    g.fillStyle(COLOR.redDark, 0.95).fillRoundedRect(-t.width / 2 - 12, -15, t.width + 24, 30, 15);
    g.lineStyle(2, COLOR.gold, 1).strokeRoundedRect(-t.width / 2 - 12, -15, t.width + 24, 30, 15);
    c.add([g, t]);
    this.hat = c;
  }

  private myTurn(v: DdzView): boolean {
    const net = this.net;
    // 联机：旁观的人不能出手；上一手发出去还没回音、连接断了时也锁着
    if (net && (net.mySeat === null || net.pending !== null || net.status !== 'open')) return false;
    return !this.busy && this.overlay === null && !this.ses.autoplay && v.turn === DDZ_ME && (v.phase === 'bid' || v.phase === 'play');
  }

  private refreshButtons(): void {
    if (!this.alive) return;
    const v = this.ses.view();
    const mine = this.myTurn(v);
    const sel = this.hand.selected();
    const bidding = v.phase === 'bid';
    const playing = v.phase === 'play';
    this.hand.enabled = mine && playing;
    for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear]) b.setVisible(playing);
    this.btnSort.setVisible(playing || bidding);
    const net = this.net;
    this.btnBack?.setVisible(!!net?.afk && this.overlay === null);
    if (net && this.watching) {
      // 旁观：没有手牌、不能出手；有能坐的座位出"坐下"
      const sit = net.freeSeat();
      this.btnSit?.setVisible(sit !== null && this.overlay === null);
      for (const b of [this.btnPass, this.btnHint, this.btnPlay, this.btnSort, this.btnClear, ...this.bidBtns]) b.setVisible(false);
      this.hand.enabled = false;
      this.setStatus(sit === null ? '旁观中 · 看不到任何人的手牌' : '旁观中 · 看不到任何人的手牌，点"坐下"一起打');
      return;
    }
    this.btnSit?.setVisible(false);
    this.btnSort.setText(this.hand.mode === 'rank' ? '按牌型' : '按点数');
    this.btnClear.setEnabled(sel.length > 0);
    const top = Math.max(0, ...v.bids.map((b) => b ?? 0));
    BIDS.forEach((b, i) => {
      this.bidBtns[i]!.setVisible(bidding && mine).setEnabled(b === 0 || b > top);
    });
    if (!mine) {
      for (const b of [this.btnPass, this.btnHint, this.btnPlay]) b.setEnabled(false);
      if (this.ses.autoplay) this.setStatus('托管中');
      else if (bidding && v.turn >= 0 && !this.busy) this.setStatus(`等 ${seatName(v.turn)} 叫分`);
      else if (playing && v.turn >= 0 && v.turn !== DDZ_ME && !this.busy) this.setStatus(`等 ${seatName(v.turn)} 出牌`);
      else this.setStatus('');
      return;
    }
    if (bidding) {
      this.setStatus(top > 0 ? `现在 ${top} 分：叫更高的抢地主，或者不叫` : '叫分抢地主：分越高，输赢越大');
      return;
    }
    const lead = !v.target || v.target.seat === DDZ_ME;
    this.btnPass.setEnabled(!lead);
    this.btnHint.setEnabled(true);
    const r = this.judge(v, sel);
    this.btnPlay.setEnabled(r.ok);
    if (sel.length === 0) {
      const hints = this.ensureHints(v);
      if (!lead && hints.length === 0) this.setStatus('要不起，点 不要', true);
      else this.setStatus(lead ? (v.landlord === DDZ_ME && v.trick.length === 0 ? '你是地主，先出牌' : '轮到你出牌') : '轮到你：压过它，或者不要');
    } else this.setStatus(r.ok ? r.label : r.reason, !r.ok);
  }

  /** 选中的牌能不能出：只调规则核心的 interpretDdz / chooseDdz */
  private judge(v: DdzView, sel: number[]): { ok: boolean; play: DdzPlay | null; reason: string; label: string } {
    if (sel.length === 0) return { ok: false, play: null, reason: '', label: '' };
    const all = interpretDdz(sel);
    if (all.length === 0) return { ok: false, play: null, reason: '不成牌型', label: '' };
    const lead = !v.target || v.target.seat === DDZ_ME;
    const target = lead ? null : v.target!.play;
    const p = chooseDdz(all, target);
    if (!p) {
      const sameType = all.some((x) => x.type === target!.type && x.cards.length === target!.cards.length);
      return { ok: false, play: null, reason: sameType || isBombish(target!) ? '压不过' : `要出${ddzPlayLabel(target!)}`, label: '' };
    }
    return { ok: true, play: p, reason: '', label: ddzPlayDetail(p) };
  }

  private ensureHints(v: DdzView): DdzPlay[] {
    if (this.hintStep === v.step) return this.hints;
    this.hintStep = v.step;
    this.hints = hintDdz(v);
    this.hintIdx = 0;
    return this.hints;
  }

  // ───────────────────────── 玩家操作 ─────────────────────────

  private onHint(): void {
    const v = this.ses.view();
    if (!this.myTurn(v) || v.phase !== 'play') return;
    const hints = this.ensureHints(v);
    if (hints.length === 0) {
      this.setStatus('要不起，点 不要', true);
      return;
    }
    const p = hints[this.hintIdx % hints.length]!;
    this.hintIdx++;
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
    if (!this.myTurn(v) || v.phase !== 'play' || !v.target || v.target.seat === DDZ_ME) return;
    this.hand.setSelected([]);
    this.act({ type: 'pass', seat: DDZ_ME });
  }

  private onPlay(): void {
    const v = this.ses.view();
    if (!this.myTurn(v) || v.phase !== 'play') return;
    const sel = this.hand.selected();
    const r = this.judge(v, sel);
    if (!r.ok) {
      audio.sfx('error');
      if (r.reason) toast(this, r.reason, worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
      return;
    }
    this.act({ type: 'play', seat: DDZ_ME, cards: sel });
  }

  private act(a: Parameters<DdzSession['apply']>[0]): void {
    if (a.type !== 'next' && !this.myTurn(this.ses.view())) return;
    const r = this.ses.apply(a);
    if (r.error) {
      this.lastError = r.error;
      audio.sfx('error');
      toast(this, r.error, worldW(this) / 2, BUTTON_Y - 92, COLOR.redDark);
      return;
    }
    this.lastError = null;
    // 联机：只是发出去了，结果随房间的下一帧到（onNet 里播）；按钮这时锁着
    if (r.sent) {
      this.refreshButtons();
      return;
    }
    void this.playEvents(r.events);
  }

  // ───────────────────────── 电脑 ─────────────────────────

  private cancelBot(): void {
    this.botTimer?.remove();
    this.botTimer = null;
    if (this.botSeat >= 0) this.seats[this.botSeat]?.setThinking(false);
    this.botSeat = -1;
  }

  /** 决定下一步：电脑行动、等我、或者弹结算 */
  private pump(): void {
    if (!this.alive || this.busy || this.botTimer || this.overlay !== null) return;
    if (this.pumpNet()) return;
    const v = this.ses.view();
    if (v.phase === 'dealEnd' || (v.phase === 'gameOver' && !this.lastSettleSeen)) {
      this.showSettle(v.results[v.results.length - 1]!);
      return;
    }
    if (v.phase === 'gameOver') {
      this.showGameOver();
      return;
    }
    this.refreshButtons();
    const seat = v.turn;
    if (seat < 0 || !this.ses.isBot(seat)) return;
    // 联机只有调试托管会走到这里：等上一手有了回音、轮到我再出
    if (this.net && !this.net.canAct()) return;
    const planned = this.ses.botAction(seat);
    if (!planned) return;
    if (seat !== DDZ_ME) this.seats[seat]!.setThinking(true);
    this.botSeat = seat;
    const lead = !v.target || v.target.seat === seat;
    const kind = planned.type === 'play' ? (isBombish(interpretDdz(planned.cards)[0] ?? { type: 'single' }) ? 'bomb' : 'play') : 'pass';
    const ms = v.phase === 'bid' ? 800 : thinkTime({ kind, lead, tense: v.counts.some((n, s) => s !== seat && n <= 2) });
    this.botTimer = this.time.delayedCall(dur(ms), () => {
      this.botTimer = null;
      this.botSeat = -1;
      this.seats[seat]?.setThinking(false);
      if (!this.alive || this.busy || this.overlay !== null) return;
      const r = this.ses.apply(planned);
      if (r.sent) return;
      if (r.error) {
        // 电脑出错（理论上不会）：退回到"不要"或最小的单张，保证不卡住
        console.warn(`斗地主电脑 ${seat} 动作非法：${r.error}`);
        const view = this.ses.view();
        const canPass = view.phase === 'play' && !!view.target && view.target.seat !== seat;
        const fb = view.phase === 'bid' ? { type: 'bid' as const, seat, bid: 0 } : canPass ? { type: 'pass' as const, seat } : { type: 'play' as const, seat, cards: [sortDdz(view.hand)[0]!] };
        const r2 = this.ses.apply(fb);
        if (r2.error) return;
        void this.playEvents(r2.events);
        return;
      }
      void this.playEvents(r.events);
    });
  }

  /** 联机：按顺序播放房间发来的帧。返回 true 表示这次在播（或等着播），pump 先别往下走 */
  private pumpNet(): boolean {
    const net = this.net;
    if (!net) return false;
    const f = net.queue[0];
    if (!f) return false;
    const before = net.shown?.view.step ?? -1;
    net.take();
    if (f.nv.view.step <= before) {
      // 同一个牌局状态（有人入座、掉线、点了继续……）：只刷新画面
      this.sync(true);
      this.time.delayedCall(0, () => this.pump());
      return true;
    }
    const play = (): void => void this.playEvents(f.nv.events);
    // 电脑连着出：和单机一样给点思考时间（房间给的间隔只说明这一帧是电脑出的）
    if (f.delay > 0) {
      const e = f.nv.events.find((x) => x.type === 'play' || x.type === 'pass' || x.type === 'bid');
      const v = f.nv.view;
      const kind = e?.type === 'play' ? (isBombish(e.play) ? 'bomb' : 'play') : 'pass';
      const ms = !e || e.type === 'bid' ? 800 : thinkTime({ kind, lead: v.trick.length <= 1, tense: v.counts.some((n) => n <= 2) });
      this.botTimer = this.time.delayedCall(dur(ms), () => {
        this.botTimer = null;
        play();
      });
    } else play();
    return true;
  }

  /** 房间来了新消息（联机） */
  private onNet(kind: NetEvent, detail?: string): void {
    if (!this.alive) return;
    const net = this.net!;
    if (kind === 'reset') {
      // 进房、重连的全量快照、换了座位：整桌重画
      this.cancelBot();
      this.scene.restart();
      return;
    }
    for (const sv of this.seats) sv.refreshIdentity();
    if (kind === 'status' && net.status === 'closed' && this.overlay !== 'gameOver') {
      // 房间散了、在别处登录被顶掉……：说清楚原因，只能回首页
      this.overlayModal?.close();
      const m = modal(this, 640, 300, undefined, { closeBtn: false, depth: 5200 });
      m.body.add(text(this, 0, -60, '房间断开了', { size: TYPE.title, bold: true, color: COLOR.redDark }));
      m.body.add(text(this, 0, -10, closeText(net.closeCode), { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 560 }));
      m.body.add(new Button(this, 0, 80, 240, 64, '回首页', 'red', () => this.leaveRoom(), 'back'));
      this.openOverlay('menu', m);
      return;
    }
    if (kind === 'emote') {
      // 房间转发的（含我自己发的）："说话人:编号:对象:电脑"，画面座位
      const [vs, id, to] = (detail ?? '').split(':');
      const from = Number(vs);
      if (!Number.isInteger(from) || !Number.isInteger(Number(id))) return;
      this.funIn(from, Number(id), to ? Number(to) : undefined);
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
      // 人齐了、房间开了下一副：结算页自己收起来，接着播
      const next = net.queue[0];
      if (next && next.nv.view.phase !== 'dealEnd') {
        this.overlayModal?.close();
        this.closeOverlay();
        return;
      }
    }
    this.refreshButtons();
    this.pump();
  }

  /** 好友房刚轮到我：后台时标题闪，前台时手机振一下；不轮到我了就停闪 */
  private noticeNetTurn(): void {
    const t = this.net?.turnInfo();
    const mine = !!t && this.isMe(t.seat);
    if (mine && !this.myNetTurn) {
      if (document.hidden) flashTitle();
      else vibrate();
    } else if (!mine && this.myNetTurn) stopFlash();
    this.myNetTurn = mine;
  }

  /** 倒计时：谁在出手就在谁的头像上数秒；结算页刷新"等谁"。每 250 毫秒一次 */
  private updateClocks(): void {
    const net = this.net;
    if (!net) return;
    if (this.overlay === 'settle') this.refreshSettleWait();
    const t = net.turnInfo();
    const now = Date.now();
    this.seats.forEach((sv, i) => sv.setClock(t && t.seat === i && t.deadline !== null ? Math.max(0, Math.ceil((t.deadline - now) / 1000)) : null));
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
    const others = (w?.waiting ?? []).filter((x) => x !== 0 || this.watching);
    // 跟着按钮走：能点时在按钮下面，不能点时占按钮的位置
    const by = btn?.y ?? 200;
    t.setY(can ? by + 56 : by);
    if (can) t.setText(left);
    else if (others.length) t.setText(`等 ${others.map(seatName).join('、')} 点继续${left ? ` · ${left}` : ''}`);
    else t.setText('马上开下一副…');
  }

  private talk(seat: number, sit: Situation, force = false): void {
    // 联机时电脑的嘴在房间里（互动），不在本地随机冒话
    if (seat === DDZ_ME || this.net) return;
    if (!force && Math.random() > 0.45) return;
    const line = lineFor(seatPerson(seat), sit);
    if (line) this.seats[seat]!.say(line);
  }

  // ───────────────────────── 事件播放 ─────────────────────────

  private async playEvents(evs: DdzEvent[]): Promise<void> {
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

  private async playEvent(e: DdzEvent): Promise<void> {
    const W = worldW(this);
    switch (e.type) {
      case 'deal': {
        this.cancelBot();
        if (e.dealNo === 1 && e.redeal === 0) this.lastSettleSeen = false;
        await this.trick.clearAll();
        this.trick.forget();
        this.placeHat(-1);
        for (const s of this.seats) s.setCount(17, false);
        this.hand.setHand([], 0, { animate: false });
        this.buildTopBar(W);
        audio.sfx('deal');
        const v = this.ses.view();
        await bigWord(this, e.redeal > 0 ? '重新发牌' : `第 ${e.dealNo} 副`, { sub: `共 ${v.deals} 副 · ${seatName(e.firstBidder)} 先叫`, size: TYPE.huge, hold: 450 });
        this.hand.setHand(v.hand, 0, { animate: false });
        this.dealToOthers(W / 2, 250);
        await this.hand.dealIn(W / 2, 250);
        break;
      }
      case 'bid': {
        this.fxLog.push(`叫${e.bid}`);
        audio.sfx(e.bid === 0 ? 'pass' : 'click');
        this.seats[e.seat]!.say(e.bid === 0 ? '不叫' : `${e.bid} 分`, 1400, e.bid === 3 ? 'spicy' : 'plain');
        if (e.bid === 3) this.talk(e.seat, 'grab', true);
        else if (e.bid === 0) this.talk(e.seat, 'noBid');
        this.buildTopBar(W);
        await wait(this, 450);
        break;
      }
      case 'redeal':
        this.fxLog.push('重发');
        await banner(this, '都不叫，重新发牌');
        break;
      case 'landlord': {
        this.fxLog.push(`地主${e.seat}`);
        audio.sfx('gong');
        this.placeHat(e.seat);
        this.buildTopBar(W);
        this.seats[e.seat]!.setCount(20, false);
        this.talk(e.seat, 'landlord', true);
        await banner(this, this.isMe(e.seat) ? `你当地主 · ${e.bid} 分` : `${seatName(e.seat)} 当地主 · ${e.bid} 分`);
        if (this.isMe(e.seat)) {
          // 底牌从顶栏飞进我的手牌
          const v = this.ses.view();
          this.hand.setHand(v.hand, 0, { animate: true, from: { x: W / 2, y: 28 } });
          this.hand.setSelected(e.bottom);
          await wait(this, 500);
          this.hand.setSelected([]);
        }
        break;
      }
      case 'play':
        await this.animatePlay(e.seat, e.play, e.left);
        break;
      case 'pass':
        audio.sfx('pass');
        this.trick.showPass(e.seat);
            if (Math.random() < 0.25) this.talk(e.seat, 'pass');
        await wait(this, 200);
        break;
      case 'newTrick':
        await wait(this, 650);
        audio.sfx('collect');
        await this.trick.clearAll();
        break;
      case 'dealEnd': {
        const r = e.result;
        if (r.spring) {
          this.fxLog.push(r.spring === 'spring' ? '春天' : '反春');
          audio.sfx('gong');
          await bigWord(this, r.spring === 'spring' ? '春天！' : '反春！', { color: COLOR.goldLight, hold: 700 });
        }
        const winners = [0, 1, 2].filter((s) => r.delta[s]! > 0);
        for (const s of winners) this.talk(s, r.spring ? 'spring' : 'win', !!r.spring);
        for (const s of [0, 1, 2].filter((x) => r.delta[x]! < 0)) this.talk(s, 'lose');
        await wait(this, 1100);
        break;
      }
      case 'gameOver':
        break;
    }
  }

  private async animatePlay(seat: number, play: DdzPlay, left: number): Promise<void> {
    const from = this.seats[seat]!.center;
    const views = this.isMe(seat) ? this.hand.take(play.cards) : null;
    const bomb = isBombish(play);
    const big = !bomb && play.cards.length >= 5;
    const p = this.trick.showPlay(seat, play, views, from);
    audio.sfx(bomb ? (play.type === 'rocket' ? 'jokerBomb' : 'bomb') : big ? 'playBig' : 'play', { pitch: bomb ? 0 : (Math.random() - 0.5) * 2.4 });
    this.seats[seat]!.setCount(left, false);
    await p;
    if (bomb) await this.bombFx(seat, play);
    else if (seat !== DDZ_ME && !this.net && Math.random() < 0.3) this.talk(seat, this.ses.view().trick.length > 1 ? 'beat' : 'lead');
    // 报牌：剩 2 张、1 张时（斗地主的"报双""报单"）
    if (left > 0 && left <= 2) {
      this.seats[seat]!.callCount(left);
      audio.sfx('call', { pitch: left === 1 ? 4 : 0 });
      if (seat !== DDZ_ME) this.talk(seat, 'fewCards', true);
      audio.music('tense');
    }
    this.buildTopBar(worldW(this));
  }

  private async bombFx(seat: number, play: DdzPlay): Promise<void> {
    const W = worldW(this);
    const a = this.seats[seat]!.a;
    const rocket = play.type === 'rocket';
    this.fxLog.push(ddzPlayLabel(play));
    this.seats[seat]!.setMood('smug', 2600);
    this.talk(seat, rocket ? 'jokerBomb' : 'bomb', true);
    if (rocket) {
      flash(this, 0xffe7a0, 0.75);
      rays(this, W / 2, 330);
      shake(this, 600, 0.018);
      burst(this, a.px, a.py, 'spark', 60, { speed: [200, 620], life: 1200 });
      await bigWord(this, '王炸！', { size: 96, color: COLOR.goldLight, stroke: COLOR.redDark, hold: 1000, depth: 190 });
    } else {
      flash(this, 0xffffff, 0.45);
      shake(this, 380, 0.012);
      burst(this, a.px, a.py, 'spark', 40, { speed: [160, 540] });
      burst(this, a.px, a.py, 'smoke', 8, { speed: [40, 120], life: 900, gravity: -40, scale: [1.4, 2.4] });
      await bigWord(this, '炸弹', { size: 76, color: 0xfff0c8, stroke: COLOR.red, hold: 750, depth: 190 });
    }
    await wait(this, 100);
    // 倍数翻了：顶栏马上跟着变
    this.buildTopBar(W);
  }

  /** 发牌时另外两家也"收到牌"：从桌心往两家头像各飞几张牌背 */
  private dealToOthers(x: number, y: number): void {
    if (dur(1) === 0) return;
    const key = `back:${getSettings().back}`;
    const step = dur(26) * 4;
    for (let k = 0; k < 5; k++) {
      for (const sv of this.seats) {
        if (sv.seat === DDZ_ME) continue;
        const to = sv.center;
        const img = this.add.image(x, y, key).setDisplaySize(46, 64).setAngle(-12).setDepth(180);
        this.tweens.add({
          targets: img,
          x: to.x,
          y: to.y,
          angle: sv.seat === 1 ? 20 : -20,
          scale: img.scale * 0.7,
          delay: k * step + sv.seat * dur(20),
          duration: dur(300),
          ease: 'Cubic.easeOut',
          onComplete: () => img.destroy(),
        });
      }
    }
  }

  // ───────────────────────── 结算 ─────────────────────────

  private showSettle(r: DdzResult): void {
    const v = this.ses.view();
    const last = v.phase === 'gameOver';
    const meWon = r.delta[DDZ_ME]! > 0;
    const watch = this.watching;
    const m = modal(this, 820, 560, watch ? '这一副结束了' : meWon ? '这副你赢了' : '这副你输了', { closeBtn: false });
    this.openOverlay('settle', m);
    const b = m.body;
    const side = r.landlordWon ? '地主赢' : '农民赢';
    const extras = [`${r.bid} 分`, r.bombs ? `炸弹 ${r.bombs} 个` : '', r.spring === 'spring' ? '春天' : r.spring === 'anti' ? '反春' : '', `× ${r.mult} 倍`].filter(Boolean).join(' · ');
    b.add(text(this, 0, -190, `${side} · ${extras}`, { size: TYPE.title, bold: true, color: r.landlordWon ? COLOR.redDark : COLOR.ink }));
    b.add(text(this, 0, -146, `这副 ${r.s} 分：地主${r.landlordWon ? '赢' : '输'}两份，农民各${r.landlordWon ? '输' : '赢'}一份`, { size: TYPE.small, color: COLOR.muted }));
    const cols = [-300, -40, 120, 280];
    ['', '这副', '累计', ''].forEach((h, i) => h && b.add(text(this, cols[i]!, -96, h, { size: TYPE.small, bold: true, color: COLOR.muted })));
    [0, 1, 2].forEach((s, i) => {
      const y = -46 + i * 62;
      const role = s === r.landlord ? '地主' : '农民';
      b.add(text(this, cols[0]!, y, `${seatName(s)}（${role}）`, { size: TYPE.body, bold: this.isMe(s), color: COLOR.ink }));
      const d = r.delta[s]!;
      b.add(text(this, cols[1]!, y, d > 0 ? `+${d}` : `${d}`, { size: TYPE.title, bold: true, font: 'num', color: d > 0 ? COLOR.redDark : 0x3a6a2a }));
      const t = v.scores[s]!;
      b.add(text(this, cols[2]!, y, t > 0 ? `+${t}` : `${t}`, { size: TYPE.body, font: 'num', color: COLOR.ink }));
    });
    const net = this.net;
    const next = new Button(this, 160, 200, 240, 64, last ? '看总分' : net ? '继续' : '下一副', 'red', () => {
      // 联机的"继续"：发出去，弹窗留着等人齐（refreshSettleWait 写在等谁）；房间开了下一副才收起来
      if (net && !last) {
        this.act({ type: 'next' });
        this.refreshSettleWait();
        return;
      }
      m.close();
      this.overlay = null;
      this.overlayModal = null;
      if (last) {
        this.lastSettleSeen = true;
        this.pump();
      } else this.act({ type: 'next' });
    }, last ? 'crown' : 'play');
    const home = new Button(this, -160, 200, 240, 64, '回首页', 'wood', () => this.onHome(), 'back');
    b.add([next, home]);
    b.setData('next', next);
    if (net && !last) {
      this.settleWait = text(this, 160, 256, '', { size: TYPE.label, color: COLOR.ink });
      b.add(this.settleWait);
      this.refreshSettleWait();
    }
    this.reg('settle:next', next);
    this.reg('settle:home', home);
    // 托管（调试代打）时自动进下一副，和掼蛋一样
    if (this.ses.autoplay) {
      this.time.delayedCall(Math.max(600, dur(1200)), () => {
        if (this.ses.autoplay && this.overlay === 'settle' && this.overlayModal === m && next.visible) next.onClick();
      });
    }
  }

  private showGameOver(): void {
    if (this.ses instanceof DdzStakeSession) return this.showStakeResult(this.ses);
    const v = this.ses.view();
    const me = v.scores[DDZ_ME]!;
    const watch = this.watching;
    const m = modal(this, 820, 560, watch ? '这局结束了' : me > 0 ? '这局你赢了！' : me === 0 ? '这局打平' : '这局输了', { closeBtn: false });
    this.openOverlay('gameOver', m);
    const b = m.body;
    if (me > 0 && !watch) {
      audio.sfx('win');
      burst(this, worldW(this) / 2, 200, 'confetti', 40, { speed: [200, 560], life: 1400, gravity: 420 });
    }
    b.add(text(this, 0, -180, `打了 ${v.results.length} 副 · 你当了 ${v.results.filter((r) => r.landlord === DDZ_ME).length} 次地主`, { size: TYPE.body, color: COLOR.muted }));
    const order = [0, 1, 2].sort((x, y) => v.scores[y]! - v.scores[x]!);
    order.forEach((s, i) => {
      const y = -110 + i * 70;
      const t = v.scores[s]!;
      b.add(text(this, -200, y, `${i + 1}. ${seatName(s)}`, { size: TYPE.title, bold: this.isMe(s), color: COLOR.ink, ox: 0 }));
      b.add(text(this, 220, y, t > 0 ? `+${t}` : `${t}`, { size: TYPE.title, bold: true, font: 'num', color: t > 0 ? COLOR.redDark : 0x3a6a2a, ox: 1 }));
    });
    // 每日挑战：打完交一次分（重建画面再弹一次也不重交），结果写在这一行
    const daily = this.ses.daily;
    if (daily) {
      const line = text(this, 0, 110, '正在交到今天的榜…', { size: TYPE.body, color: COLOR.muted });
      b.add(line);
      if (!this.ses.dailySent) {
        this.ses.dailySent = true;
        this.ses.dailyResult = submitDdzDaily(daily, me);
      }
      void this.ses.dailyResult?.then((r) => {
        if (line.active) line.setText(dailySubmitText(r, me));
      });
    }
    // 好友房整场打完房间就结束，没有"再来一局"：只有回首页
    const solo = this.solo;
    if (!solo) {
      b.add(text(this, 0, 120, '房间到这里就结束了，想再打就开个新房间', { size: TYPE.small, color: COLOR.muted }));
      const home = new Button(this, 0, 200, 240, 64, '回首页', 'red', () => this.leaveRoom(), 'back');
      b.add(home);
      this.reg('over:home', home);
      return;
    }
    const again = new Button(this, 160, 200, 240, 64, daily ? '再打一次' : '再来一局', 'red', () => {
      m.close();
      if (daily) {
        app.ddz = DdzSession.fresh(ddzDailySeed(daily), solo.level, undefined, false);
        app.ddz.daily = daily;
      } else app.ddz = DdzSession.fresh(randomSeed(), solo.level);
      this.scene.restart();
    }, 'restart');
    const home = new Button(this, -160, 200, 240, 64, '回首页', 'wood', () => this.onHome(), 'back');
    b.add([again, home]);
    this.reg('over:again', again);
    this.reg('over:home', home);
  }

  /** 单机实盘一场打完（8 副或有人到 ±40 分）：我的分和筹码，去钱包结回；结回的重试和存档在 ddz-stake.ts */
  private showStakeResult(ses: DdzStakeSession): void {
    const save = ses.stake;
    const done = save.settle ?? { points: ses.points, deals: ses.dealsDone };
    const pv = ddzPointValue(save.tier);
    audio.sfx(done.points > 0 ? 'win' : 'pass');
    const m = modal(this, 780, 500, undefined, { closeBtn: false });
    this.openOverlay('gameOver', m);
    const b = m.body;
    b.add(text(this, 0, -170, `斗地主实盘 · ${TIER_NAME[save.tier]}`, { size: TYPE.label, bold: true, color: COLOR.muted }));
    const head = done.points === 0 ? '这场打平，0 分' : `这场 ${signed(done.points)} 分，${signed(done.points * pv)}`;
    b.add(text(this, 0, -122, head, { size: TYPE.big, bold: true, color: done.points > 0 ? COLOR.red : COLOR.ink }));
    // 没打满就结束只有一种：有一家的累计到了 ±一份（核心按 cap 截）
    const why = done.deals < DDZ_SOLO_DEALS ? `有人输赢到了一份（${DDZ_POINTS_PER_SHARE} 分），这一场提前结束` : `打满 ${DDZ_SOLO_DEALS} 副`;
    b.add(text(this, 0, -66, why, { size: TYPE.label, color: COLOR.ink }));
    const status = text(this, 0, -14, '正在结算…', { size: TYPE.body, bold: true, color: COLOR.ink, wrap: 700 });
    b.add(status);
    const capLine = text(this, 0, 32, '', { size: TYPE.label, bold: true, color: COLOR.redDark, wrap: 700 });
    b.add(capLine);
    b.add(text(this, 0, 210, STAKE_TEXT.noCash, { size: TYPE.small, color: COLOR.muted }));
    const home = new Button(this, 0, 120, 260, 64, '回首页', 'wood', () => this.scene.start('title'), 'back');
    home.setEnabled(false);
    b.add(home);
    this.reg('over:home', home);
    void settleDdzStake(save).then((r) => {
      if (!this.alive || !status.scene) return;
      home.setEnabled(true);
      if (r.kind === 'done') {
        status.setText(r.balance === null ? '已经结回钱包' : `已经结回钱包，钱包还有 ${fmtChips(r.balance)}`);
        if (r.capped > 0) capLine.setText(STAKE_TEXT.capped(r.capped));
      } else if (r.kind === 'gone') status.setText(STAKE_TEXT.gone);
      else if (r.kind === 'expired') status.setText(STAKE_ERROR['expired']!);
      else if (r.kind === 'later') status.setText(STAKE_TEXT.settleLater);
      else status.setText(stakeError(r.error));
    });
  }

  // ───────────────────────── 调试、重建 ─────────────────────────

  /** 牌桌忙、开着弹层、选着牌时不重建画面（main.ts 换宽度时问） */
  canRebuild(): boolean {
    return !this.isBusy && this.overlay === null && this.hand.selected().length === 0;
  }

  /** 冒烟用：控件名 → 世界坐标、能不能点、看不看得见 */
  controls(): Record<string, { x: number; y: number; enabled?: boolean; visible?: boolean }> {
    const out: Record<string, { x: number; y: number; enabled?: boolean; visible?: boolean }> = {};
    for (const [k, c] of this.ctl) {
      if (!c.obj.active) continue;
      const m = c.obj.getWorldTransformMatrix();
      const b = c.obj as unknown as { enabled?: boolean; visible: boolean };
      out[k] = { x: m.tx / this.cameras.main.zoom, y: m.ty / this.cameras.main.zoom, ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}), visible: c.obj.visible };
    }
    // 互动（kit 的 DOM）：屏幕坐标换回世界坐标，冒烟和别的控件一样点
    const cr = this.game.canvas.getBoundingClientRect();
    const f = worldH / cr.height;
    for (const [k, c] of Object.entries(this.fun?.controls() ?? {})) out[k] = { x: (c.x - cr.left) * f, y: (c.y - cr.top) * f, enabled: true, visible: true };
    // 手牌每张的点按点（冒烟逐张点）
    for (const c of this.ses.view().hand) {
      const p = this.hand.tapPoint(c);
      if (p) out[`card:${c}`] = p;
    }
    return out;
  }

  /** 调试桥：电脑代打我（冒烟快速推进）；正等我出手时马上接着走 */
  debugAutoplay(on: boolean): void {
    this.ses.autoplay = on;
    this.refreshButtons();
    this.pump();
  }

  handSelected(): number[] {
    return this.hand.selected();
  }
}

