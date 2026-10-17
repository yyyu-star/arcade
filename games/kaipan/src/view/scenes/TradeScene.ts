import Phaser from 'phaser';
import {
  BALANCE,
  buyError,
  chatView,
  currentCalendar,
  eventView,
  faceOf,
  formatMoney,
  formatPoints,
  friendView,
  holdingCards,
  isQuietDay,
  itemView,
  monthThemeView,
  rewardView,
  stockById,
  topBar,
  type Action,
  type GameEvent,
  type GameState,
  type HoldingMove,
  type StockMove,
  type StockQuip,
} from '../../core/index.ts';
import { hasArt, loadOptionalArt, queueLazy, queueStockArt, stocksForThemes } from '../assets.ts';
import { floatText, pop, shake } from '../fx/effects.ts';
import { fireworks, rainCloud, sparkles } from '../fx/particles.ts';
import { isTouch } from '../input.ts';
import type { Rect } from '../rect.ts';
import type { Session } from '../session.ts';
import { sound } from '../sound.ts';
import { COLOR, PHONE as PHONE_MODE, VIEW, signColor } from '../theme.ts';
import { pctArrow } from '../labels.ts';
import { addGlyph, addImage, addPaper } from '../ui/art.ts';
import type { Glyph } from '../assets.ts';
import { Button, DENIED_EVENT } from '../ui/button.ts';
import { addText, setColor } from '../ui/text.ts';
import { hideTooltip } from '../ui/tooltip.ts';
import { ChatView3, recAction } from '../trade/chat.ts';
import { Guide } from '../trade/guide.ts';
import { HoldingsView, type PickMode } from '../trade/holdings.ts';
import { MarketScreen } from '../trade/marketScreen.ts';
import type { Dialog } from '../ui/dialog.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { DETAIL_EVENT } from '../trade/detail.ts';
import { recordTape } from '../trade/tape.ts';
import { MONITOR, OPEN, PHONE_RECT as PHONE, SLOTS, TABS } from '../trade/layout.ts';
import { PanelTabs, type PanelTab } from '../trade/tabs.ts';
import { EventPanel, RewardPanel, eventResult, monthIntro, playBill, rewardSlots } from '../trade/monthEnd.ts';
import { BILL_MS } from '../trade/billTiming.ts';
import { Room } from '../trade/room.ts';
import { ThemeBoardView } from '../trade/themeBoard.ts';
import { coverOf } from '../viewport.ts';
import { TopBarView } from '../trade/topBar.ts';
import { onTutorialChange } from '../tutorial.ts';
import { BaseScene, setupCamera } from './BaseScene.ts';
import { buysText, revealShown } from '../labels.ts';
import { HintBubble } from '../trade/hintBubble.ts';
import { RecapCard } from '../trade/recapCard.ts';
import { quipBubble } from '../trade/quip.ts';
import type { Animator } from '../fx/anim.ts';
import { recapOf } from '../recap.ts';
import { newbieHint } from '../hints.ts';
import { isLiveRun, marginWarn } from '../live.ts';
import { hintsOn, loadViewPrefs } from '../meta/prefs.ts';
import { BankPanel, BuyDialog, HoldingMenu, bankCallCard, knowledgeToast, redeemFx, seizedCard, squeezeFx } from '../trade/ext.ts';
import { loadSeenTips, markTipSeen, nextExtTip, type ExtTipId } from '../extTips.ts';
import { bankRisk, collateralById, freeUnits, unitsWord } from '../../core/index.ts';
import { OVERLAY_FLAG, moneyShort } from '../ui/dialog.ts';
import { loadProfile } from '../../platform/profile.ts';
import { flipTone, monthCard, shout, shoutOf, spamLines, spottedText, HIGHLIGHT_RANK, type FlipTone } from '../trade/tempoFx.ts';

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

function pick<T extends GameEvent['type']>(events: GameEvent[], type: T): Ev<T>[] {
  return events.filter((e): e is Ev<T> => e.type === type);
}

function first<T extends GameEvent['type']>(events: GameEvent[], type: T): Ev<T> | undefined {
  return events.find((e): e is Ev<T> => e.type === type);
}

/** 节拍（毫秒，1 倍速）：一天的结算约 6 秒 */
/** 轻提示的位置：显示器和开盘按钮之间，猫气泡右边、群聊左边。 */
// 手机上开盘键旁边没地方：提示条压在持仓区下沿（一闪而过，不挡小结卡）
const TOAST = PHONE_MODE ? { x: SLOTS.x + SLOTS.w / 2, y: SLOTS.y + SLOTS.h - 18, w: 440 } : { x: 720, y: 576, w: 460 };
/** 屏幕中部大字的位置：电脑在持仓区上方，手机上持仓顶着顶栏，就压在持仓区中间 */
const SHOUT_AT = PHONE_MODE ? { x: SLOTS.x + SLOTS.w / 2, y: SLOTS.y + 70 } : { x: 612, y: 150 };
const T = {
  open: 240,
  themes: 700,
  reveal: 340,
  afterReveal: 240,
  chain: 460,
  item: 400,
  account: 650,
  judge: 80,
  comment: 220,
  hold: 300,
  chatGap: 120,
  monthIntro: 1900,
  /** 0.5 本月看点卡停留（boss 月多一点；点一下或空格跳过） */
  monthCard: 4600,
  bossCard: 5600,
  /** 屏幕中部大字每条 */
  shout: 950,
};
/** 0.5 快进（平淡日）时结算节拍的倍数 */
const FAST = 0.22;
/** 自动快进前留给玩家停下的时间（毫秒） */
const AUTO_DELAY = 900;

/**
 * 交易主场景：小屋背景、顶栏、题材看板、持仓格、手机群聊、开盘按钮；
 * 开盘后按 core 的事件顺序播放一天的结算（设计稿第 5 节），月底账单、三选一、事件也在这里。
 */
export class TradeScene extends BaseScene {
  private room!: Room;
  private top!: TopBarView;
  private board!: ThemeBoardView;
  private holdings!: HoldingsView;
  private chat!: ChatView3;
  private openBtn!: Button;
  private monitor!: Phaser.GameObjects.Text;
  /** 0.5.1 今日大盘屏 */
  private screen!: MarketScreen;
  private reward: RewardPanel | null = null;
  private event: EventPanel | null = null;
  private banner: Phaser.GameObjects.Container | null = null;
  private bannerCancel: Button | null = null;
  private continueBtn: Button | null = null;
  private guide: Guide | null = null;
  private offTutorial: (() => void) | null = null;
  /** 正在播放结算（锁住按钮） */
  private busy = false;
  /** 0.5：平淡日的"快进"按钮（F） */
  private quietBtn!: Button;
  /** 下一次开盘按快进播放 */
  private fastNext = false;
  /** 自动快进的计时器 */
  private autoTimer: Phaser.Time.TimerEvent | null = null;
  /** 上一天碰到了高光 / 事件 / 目标变化：这一天停下来等玩家（不自动快进） */
  private stopHere = true;
  /** 玩家在这一天点过"停下"（按交易日编号） */
  private autoCancelDay = -1;

  protected override readonly phoneReady = PHONE_MODE;

  constructor(session: Session) {
    super('trade', session);
  }

  /** 只补加载本局登场题材的股票合成图。 */
  preload(): void {
    setupCamera(this, this.phoneReady);
    const ids = stocksForThemes(this.session.state.themeIds);
    const n = queueStockArt(this.load, this.textures, ids) + queueLazy(this.load, this.textures);
    // 眨眼图是可选素材：后台补，到了就开始眨
    void loadOptionalArt(this.textures, { stocks: ids });
    if (n > 0) {
      this.add.rectangle(0, 0, VIEW.w, VIEW.h, COLOR.bg).setOrigin(0, 0);
      addText(this, VIEW.w / 2, VIEW.h / 2, '正在载入…', { size: 16, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    }
  }

  protected override build(): void {
    // 点了禁用的按钮（加班、T+1、资金不够……）：说明原因
    const onDenied = (msg: string): void => this.toast(msg);
    this.events.on(DENIED_EVENT, onDenied);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(DENIED_EVENT, onDenied));
    const s = this.session.state;
    this.reward = null;
    this.event = null;
    this.banner = null;
    this.continueBtn = null;
    this.guide = null;
    this.busy = false;
    this.children.removeAll(true);
    this.room = new Room(this, s.mood, { ambient: this.lively });
    // 盘前是清晨；停在月底账单后的奖励、事件上时接着是夜里、傍晚
    this.room.setTime(s.phase === 'premarket' ? 'morning' : s.phase === 'event' ? 'dusk' : 'night', null);
    this.chat = new ChatView3(this, s, this.lively, (i) => this.onBuy(i));
    this.chat.onShort = (i) => this.onBuy(i, true);
    this.board = new ThemeBoardView(this, s, !this.lively);
    this.holdings = new HoldingsView(this, s, this.lively, (slot) => this.onSell(slot));
    this.holdings.onInspect = (slot) => this.inspect(slot);
    this.holdings.onBuyRec = (i) => this.onBuy(i);
    // 0.5.1：显示器换成「今日大盘屏」（大盘走势、风口榜、跑马灯、昨天盈亏）
    recordTape(s);
    this.screen = new MarketScreen(this, this.lively);
    this.monitor = this.screen.big;
    // 详情卡（股票 / 风口 / 群友）打开时登记成当前对话框
    const onDetail = (d: Dialog): void => this.trackDialog(d);
    this.events.on(DETAIL_EVENT, onDetail);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(DETAIL_EVENT, onDetail));
    this.openBtn = new Button(this, OPEN.x, OPEN.y, {
      width: OPEN.w,
      height: OPEN.h,
      label: '开 盘',
      subLabel: '',
      variant: 'primary',
      fontSize: 30,
      hotkey: '空格',
      sound: null,
      onClick: () => this.onOpen(),
    });
    // 手机上开盘键右边是群聊那一块，快进键放到开盘键上面（大盘小屏的位置，平静日才出现）
    const quietAt = PHONE_MODE ? { x: MONITOR.x, y: MONITOR.y, w: MONITOR.w, h: MONITOR.h } : { x: OPEN.x + OPEN.w + 14, y: OPEN.y + 12, w: 196, h: 60 };
    this.quietBtn = new Button(this, quietAt.x, quietAt.y, {
      width: quietAt.w,
      height: quietAt.h,
      label: '快进',
      subLabel: '平静日',
      fontSize: 20,
      hotkey: 'F',
      sound: null,
      onClick: () => this.onFast(),
    });
    this.quietBtn.setVisible(false);
    this.fastNext = false;
    this.autoTimer = null;
    this.stopHere = true;
    // 自动快进倒计时里，点画面任意处就停下
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => this.cancelAuto());
    this.top = new TopBarView(this, s, () => this.openSettings(true), () => this.openHelp(), () => this.openBank(), () => this.askLobby());
    // 手机横屏：右边一块用标签页在群聊 / 推荐 / 风口之间切换（重建画面时停在原来那一页）
    this.tabs = TABS ? new PanelTabs(this, TABS, this.tab, (t) => this.applyTab(t)) : null;
    this.applyTab(this.tab);
    this.extTipNow = null;
    this.knowNode = null;
    this.hint = new HintBubble(this);
    this.recapCard = new RecapCard(this);
    this.recapCard.onChange = () => this.syncCorner();
    // 重建画面（读档、换设置）时，开盘前把昨天的小结补上（静态，不弹动画）
    const last = s.lastDay;
    if (s.phase === 'premarket' && last && last.holdings.some((h) => (h.parts?.length ?? 0) > 0)) this.recapCard.showRecap(recapOf(last), loadViewPrefs().recap === 'brief', null);
    this.hintsEnabled = hintsOn(loadViewPrefs(), loadProfile().profile.runs);
    this.guide = new Guide(this, {
      state: () => this.session.state,
      target: (hit) => this.guideTarget(hit.step, hit.stockId),
      avoid: () => this.clickableRects(),
      changed: () => {
        this.updateHint();
        this.session.notify();
      },
    });
    // 设置里重新打开 / 关闭教程：立刻按当前局面刷新
    this.offTutorial = onTutorialChange(() => this.syncGuide());
    // 重建画面（改设置、切换输入方式）时不会再走 enter：下一帧按当前局面补出教程气泡（动画中会被跳过）
    this.time.delayedCall(0, () => this.syncGuide());
  }

  protected override teardown(): void {
    this.clearAuto();
    this.room?.destroy();
    this.guide?.destroy();
    this.guide = null;
    this.offTutorial?.();
    this.offTutorial = null;
  }

  protected override render(s: GameState): void {
    hideTooltip(this);
    this.clearPick();
    this.top.render(s);
    this.board.render(s);
    this.holdings.render(s);
    this.chat.render(s, this.chatNotes(s));
    if (this.tabs) {
      this.applyTab(this.tab);
      this.tabs.setBadge('recs', s.phase === 'premarket' ? this.chat.recCount : 0);
    }
    this.room.setMood(s.mood, null);
    this.room.setRainbow(!!s.lastDay && s.lastDay.market.ret >= 1.5);
    // 0.11.0 开了杠杆、离清零线不远：每天盘前提醒一句（顶栏的账户同时变红闪）
    const warn = isLiveRun(s) ? marginWarn(s) : null;
    if (warn !== null && this.warnedDay !== s.dayIndex) {
      this.warnedDay = s.dayIndex;
      this.toast(`离清零线不远了：结回只剩约 ${warn.toFixed(1)} 份，再跌一点这局就按 0 结`, 3200);
    }
    this.renderMonitor(s);
    const pre = s.phase === 'premarket';
    this.openBtn.setEnabled(pre).setLocked(this.busy);
    this.openBtn.setSubLabel(pre ? `${s.month}月 · 第${s.dayInMonth + 1}天` : '算账中');
    const quiet = pre && this.quietToday(s);
    this.quietBtn.setVisible(quiet).setEnabled(quiet).setLocked(this.busy);
    this.holdings.setLocked(this.busy);
    this.chat.setLocked(this.busy);
    sound.mood(pre ? s.mood : s.phase === 'reward' || s.phase === 'event' ? 'payday' : 'silent');
    // 月底面板（按 phase 常驻）
    if (s.phase === 'reward' && !this.reward) {
      // 0.5：三选一 / 事件弹出时收起小结卡，一屏只留一个焦点
      this.recapCard?.clear();
      this.reward = new RewardPanel(this, s, this.anim, this.lively, (i) => this.onPickReward(i), () => this.onSkipReward());
    } else if (s.phase !== 'reward' && this.reward) {
      this.reward.destroy();
      this.reward = null;
    }
    const ev = eventView(s);
    if (s.phase === 'event' && ev && !this.event) {
      this.recapCard?.clear();
      this.event = new EventPanel(this, ev, (o) => this.onChoose(o));
    } else if (s.phase !== 'event' && this.event) {
      this.event.destroy();
      this.event = null;
    }
    this.session.notify();
  }

  /** 手机横屏的标签页（电脑上为 null）和当前在哪一页 */
  private tabs: PanelTabs | null = null;
  private tab: PanelTab = 'msgs';

  /** 切到某一页：群聊 / 推荐是同一块群聊的两页，风口是看板。电脑上什么都不做。 */
  private applyTab(t: PanelTab): void {
    if (!this.tabs) return;
    this.tab = t;
    this.tabs.set(t);
    this.chat.setPhoneView(t === 'board' ? null : t);
    this.board.setShown(t === 'board');
    hideTooltip(this);
    this.session.notify();
  }

  /** 教程、提示要指着某一页上的东西时，先切过去。 */
  private showTab(t: PanelTab): void {
    if (this.tabs && this.tab !== t) this.applyTab(t);
  }

  /** 群聊里额外的系统提示（新群友入群），到下一次开盘为止。 */
  private notes: string[] = [];

  private chatNotes(s: GameState): string[] {
    return s.phase === 'premarket' ? this.notes : [];
  }

  private renderMonitor(s: GameState): void {
    // 0.5：屏幕上一行大数字（昨天的钱 + 箭头百分比），下面一个短标签
    recordTape(s);
    this.screen.render(s);
    const last = s.lastDay;
    if (last) this.setMonitorMoney(last.account.after - last.account.before, last.account.ret, '昨天');
    else this.setMonitorLine(`本钱 ${formatMoney(s.account)}`);
    if (s.phase === 'premarket') {
      const left = s.today.buysLeft;
      const go = isTouch() ? '点「开盘」' : '空格开盘';
      if (this.quietToday(s)) this.screen.setSub(isTouch() ? '平静日 · 可快进' : '平静日 · F 快进');
      else if (topBar(s).busy) this.screen.setSub(`加班中 · 不能买卖 · ${go}`);
      else this.screen.setSub(`${buysText(left, s.ext ? freeUnits(s) : null).text} · ${go}`);
    } else {
      this.screen.setSub('月底算账');
    }
  }

  /** 屏幕大字：「+¥1,990  ↑1.99%」，按涨跌着亮色。 */
  private setMonitorMoney(delta: number, ret: number, when: '昨天' | '今天' = '今天'): void {
    const v = Math.round(delta);
    this.monitor.setText(v === 0 ? `${when} ¥0 ${pctArrow(0, 2)}` : `${when} ${formatMoney(delta, { sign: true })} ${pctArrow(ret, 2)}`);
    // 手机上的小屏只有一百多宽：只写钱（涨跌百分比在小结卡里），还放不下就写成「万」
    if (PHONE_MODE && this.monitor.width > MONITOR.w - 12) this.monitor.setText(v === 0 ? '¥0' : formatMoney(delta, { sign: true }));
    if (PHONE_MODE && this.monitor.width > MONITOR.w - 12) this.monitor.setText(moneyShort(delta, true));
    setColor(this.monitor, v === 0 ? COLOR.screenText : mixColor(signColor(delta), 0xffffff, 0.45));
  }

  private setMonitorLine(text: string): void {
    this.monitor.setText(text);
    setColor(this.monitor, COLOR.screenText);
  }

  // ---------------------------------------------------------------- 操作

  private onBuy(rec: number, short = false): void {
    const s = this.session.state;
    if (this.busy || s.phase !== 'premarket') return;
    const r = chatView(s).recs[rec];
    if (!r) return;
    const act = recAction(s, r);
    if (act.action === 'buy') {
      // 0.4 C：选买多少（试一口 / 半仓 / 重仓），押跌解锁后还能选押跌
      if (s.ext) this.openBuy(rec, undefined, short);
      else this.act({ type: 'buy', rec });
      return;
    }
    if (act.action !== 'replace') {
      sound.ui('denied');
      return;
    }
    // 满仓：选一格替换（原持仓卖出），再确认
    sound.ui('select');
    const cards = holdingCards(s);
    this.setPick(`把「${r.stock.name}」换进哪一格？原来那只会被卖掉`, {
      label: (slot) => (buyError(s, rec, slot) === null ? '换掉这只' : null),
      onPick: (slot) => {
        const old = cards[slot];
        if (s.ext) {
          this.clearPick();
          this.openBuy(rec, slot, short);
          return;
        }
        this.openConfirm(
          '确定换掉',
          `卖掉「${old?.name ?? ''}」（买入以来 ${formatPoints(old?.holdRet ?? 0)}），换成「${r.stock.name}」？`,
          '确定换掉',
          () => {
            this.clearPick();
            this.act({ type: 'buy', rec, slot });
          },
        );
      },
    });
  }

  /** 0.4 C：买多少的弹窗（点一个按钮就买）。 */
  private openBuy(rec: number, slot: number | undefined, short: boolean): void {
    if (this.data.get(OVERLAY_FLAG)) return;
    sound.ui('select');
    hideTooltip(this);
    this.trackDialog(new BuyDialog(this, this.session.state, rec, slot, short, (a) => this.act(a)));
    this.session.notify();
  }

  /** 0.4 C：手里这只怎么办（加仓 / 减一半 / 清仓）。 */
  private openHolding(slot: number): void {
    const s = this.session.state;
    if (this.busy || s.phase !== 'premarket' || !s.slots[slot] || this.data.get(OVERLAY_FLAG) || this.banner) return;
    sound.ui('select');
    hideTooltip(this);
    this.trackDialog(new HoldingMenu(this, s, slot, (a) => this.act(a)));
    this.session.notify();
  }

  /** 0.4 C：银行面板。 */
  private openBank(): void {
    const s = this.session.state;
    if (this.busy || s.phase !== 'premarket' || this.data.get(OVERLAY_FLAG) || this.banner) return;
    hideTooltip(this);
    this.trackDialog(new BankPanel(this, s, (a) => this.act(a)));
    this.session.notify();
  }

  /** 交给会话执行；被规则拒绝（加班、T+1、资金不够等）时给一个轻提示，不能毫无反应。 */
  private act(action: Action): void {
    const r = this.session.dispatch(action);
    if (r.error) this.toast(r.error);
  }

  /** 0.11.0 今天已经提醒过离清零线不远（一天只说一次） */
  private warnedDay = -1;

  /** 0.11.0 开了杠杆、跌到清零线：一张卡说清楚这局按 0 结，等玩家点了再去结束页 */
  private async playMarginCall(): Promise<void> {
    sound.cue({ type: 'runLost' });
    const layer = this.add.container(0, 0).setDepth(300);
    const cv = coverOf(this);
    layer.add(this.add.rectangle(cv.x, cv.y, cv.w, cv.h, COLOR.ink, 0.45).setOrigin(0, 0).setInteractive());
    const cw = PHONE_MODE ? 520 : 560;
    const cy = PHONE_MODE ? 190 : 330;
    const x = this.session.state.setup?.live?.gear?.x ?? 1;
    const body = addText(this, VIEW.w / 2, cy + 6, `开了杠杆 ×${x}，资产跌到了清零线，这局按 0 结。\n杠杆越高，赢得越多，也越容易一下清零。`, {
      size: 16,
      color: COLOR.ink,
      originX: 0.5,
      originY: 0.5,
      wrap: cw - 60,
      align: 'center',
      lineSpacing: 4,
    });
    const ch = body.height + 110;
    const panel = this.add.rectangle(VIEW.w / 2, cy, cw, ch, COLOR.paper).setRounded(18).setStrokeStyle(4, COLOR.danger);
    const title = addText(this, VIEW.w / 2, cy - ch / 2 + 34, '清零了', { size: 30, bold: true, color: COLOR.danger, originX: 0.5, originY: 0.5 });
    layer.add([panel, title, body]);
    this.showContinue(layer, '看看这一局怎么样');
    this.setBusy(false);
    await this.waitContinue();
    this.continueBtn = null;
  }

  private toastNode: Phaser.GameObjects.Container | null = null;
  private hint: HintBubble | null = null;
  private recapCard: RecapCard | null = null;
  private quips: { root: Phaser.GameObjects.Container; rect: Rect }[] = [];
  /** 盘前群友评论的气泡（开盘时收掉） */
  private commentQuips: Phaser.GameObjects.Container[] = [];
  private hintsEnabled = false;
  private toastTimer: Phaser.Time.TimerEvent | null = null;

  /** 开盘按钮上方的一条轻提示（不压小结卡、猫和群聊），1.8 秒后消失（关掉动画时也显示）。 */
  private toast(msg: string, ms = 1800, denied = true): void {
    if (denied) sound.ui('denied');
    this.toastNode?.destroy();
    this.toastTimer?.remove();
    const t = addText(this, 0, 0, msg, { size: 15, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5, wrap: TOAST.w - 36, align: 'center' });
    const w = Math.min(TOAST.w, t.width + 36);
    const h = t.height + 16;
    const bg = this.add.rectangle(0, 0, w, h, COLOR.ink, 0.88).setRounded(h / 2);
    const c = this.add.container(TOAST.x, TOAST.y, [bg, t]).setDepth(260);
    this.toastRect = { x: TOAST.x - w / 2, y: TOAST.y - h / 2, w, h };
    this.toastNode = c;
    this.lastToast = msg;
    this.toastTimer = this.time.delayedCall(ms, () => {
      if (this.toastNode === c) this.toastNode = null;
      c.destroy();
    });
  }

  private toastRect: Rect | null = null;

  /** 最近一条拒绝提示（自动化检查用）。 */
  lastToast = '';

  private onSell(slot: number): void {
    if (this.busy || this.session.state.phase !== 'premarket') return;
    if (this.session.state.ext) {
      this.openHolding(slot);
      return;
    }
    this.act({ type: 'sell', slot });
  }

  private onOpen(): void {
    const s = this.session.state;
    if (this.busy || s.phase !== 'premarket' || this.holdings.picking) return;
    this.clearAuto();
    this.act({ type: 'open' });
  }

  /** 0.5：平淡日快进（按钮或 F）：这一天的结算快速翻过，只看账户跳动。 */
  private onFast(): void {
    const s = this.session.state;
    if (this.busy || s.phase !== 'premarket' || this.holdings.picking || this.banner || this.data.get(OVERLAY_FLAG)) return;
    this.clearAuto();
    this.fastNext = true;
    sound.ui('click');
    this.act({ type: 'open' });
  }

  /** 盘前是不是"没什么事"的日子（规则层的平淡日；加班日本来就只能开盘，也算）。 */
  private quietToday(s: GameState): boolean {
    return s.phase === 'premarket' && !!s.tempo && isQuietDay(s);
  }

  private clearAuto(): void {
    this.autoTimer?.remove(false);
    this.autoTimer = null;
    if (this.session.autoPending) {
      this.session.autoPending = false;
      this.session.notify();
    }
  }

  /** 自动快进倒计时里玩家点了画面或按了键：这一天停下，等他自己开盘。 */
  private cancelAuto(): void {
    if (!this.autoTimer) return;
    this.clearAuto();
    this.autoCancelDay = this.session.state.dayIndex;
    this.screen.setSub(isTouch() ? '停下了' : '停下了 · F 快进');
  }

  /**
   * 0.5 自动快进：设置里打开（默认开）、今天没什么事、上一天没有碰到高光 / 事件 / 目标变化时，
   * 停一小会儿（显示器上写着，点一下就停下）后自动快进开盘。教程在说话、对话框开着时不自动。
   */
  private maybeAuto(): void {
    this.clearAuto();
    const s = this.session.state;
    if (!loadViewPrefs().autoQuiet || !this.quietToday(s) || this.stopHere || this.busy || this.banner) return;
    if (this.autoCancelDay === s.dayIndex || this.guide?.box() || this.data.get(OVERLAY_FLAG)) return;
    this.screen.setSub('自动快进… · 点一下停');
    this.session.autoPending = true;
    this.session.notify();
    this.autoTimer = this.time.delayedCall(AUTO_DELAY, () => {
      this.autoTimer = null;
      this.session.autoPending = false;
      const now = this.session.state;
      if (now.dayIndex !== s.dayIndex || !this.quietToday(now) || this.busy || this.data.get(OVERLAY_FLAG)) {
        this.session.notify();
        return;
      }
      this.fastNext = true;
      this.act({ type: 'open' });
    });
  }

  private onPickReward(index: number): void {
    const s = this.session.state;
    const card = rewardView(s)[index];
    if (!card || this.busy) return;
    if (card.kind !== 'stock') {
      sound.cue({ type: 'reward', kind: card.kind });
      this.act({ type: 'pickReward', index });
      return;
    }
    // 稀有股票：选放进哪一格
    this.guide?.acted('bill');
    sound.ui('select');
    const ok = new Set(rewardSlots(s, index));
    this.reward?.setVisible(false);
    this.setPick(
      `把「${card.name}」放进哪一格？${s.slots.every((x) => x) ? '原来那只会被卖掉' : ''}`,
      {
        label: (slot, c) => (ok.has(slot) ? (c ? '换掉这只' : '放这里') : null),
        onPick: (slot) => {
          this.clearPick();
          sound.cue({ type: 'reward', kind: 'stock' });
          this.act({ type: 'pickReward', index, slot });
        },
      },
      () => this.reward?.setVisible(true),
    );
  }

  private onSkipReward(): void {
    if (this.busy) return;
    sound.cue({ type: 'reward', kind: null });
    this.act({ type: 'skipReward' });
  }

  private onChoose(option: number): void {
    if (this.busy) return;
    sound.ui('click');
    this.act({ type: 'choose', option });
  }

  // ---------------------------------------------------------------- 选格子模式

  private setPick(text: string, mode: PickMode, onCancel?: () => void): void {
    this.clearPick();
    this.holdings.setPicking(mode);
    const t = addText(this, 0, 0, text, { size: 16, bold: true, originY: 0.5 });
    const w = t.width + 150;
    const x = SLOTS.x + SLOTS.w / 2 - w / 2;
    const y = SLOTS.y - 58;
    const paper = addPaper(this, x, y, w, 46, false);
    t.setPosition(x + 20, y + 23);
    this.bannerCancel = new Button(this, x + w - 104, y + 8, {
      width: 90,
      height: 30,
      label: '取消',
      fontSize: 14,
      hotkey: 'Esc',
      onClick: () => {
        this.clearPick();
        onCancel?.();
      },
    });
    this.banner = this.add.container(0, 0, [paper, t, this.bannerCancel]).setDepth(30);
    this.openBtn.setLocked(true);
    this.guide?.suspend();
    this.session.notify();
  }

  private clearPick(): void {
    const had = this.banner !== null;
    if (this.holdings?.picking) this.holdings.setPicking(null);
    this.banner?.destroy();
    this.banner = null;
    this.bannerCancel = null;
    this.openBtn?.setLocked(this.busy);
    if (had && !this.busy) {
      this.guide?.resume(this.session.state);
    }
  }

  // ---------------------------------------------------------------- 表现

  override async enter(events: GameEvent[]): Promise<void> {
    const s = this.session.state;
    if (first(events, 'monthStarted') && s.phase === 'premarket') {
      this.anim.begin();
      this.setBusy(true);
      await this.playMonthIntro(events);
      this.setBusy(false);
      await this.chat.intro(this.anim, T.chatGap);
    }
    this.syncGuide();
    this.stopHere = true;
  }

  override async present(prev: GameState, next: GameState, events: GameEvent[]): Promise<void> {
    this.anim.begin();
    this.clearAuto();
    if (first(events, 'opened')) {
      const fast = this.fastNext;
      this.fastNext = false;
      this.notes = [];
      this.guide?.acted('open');
      this.guide?.suspend();
      this.hint?.hide();
      this.board.setHighlight([], []);
      this.recapCard?.clear();
      await this.playDay(prev, next, events, fast);
      this.guide?.resume(this.session.state);
      this.maybeAuto();
      return;
    }
    if (first(events, 'rewardPicked') || first(events, 'rewardSkipped')) {
      this.guide?.acted('bill');
      this.guide?.suspend();
      await this.playAfterReward(next, events);
      this.guide?.resume(this.session.state);
      return;
    }
    if (first(events, 'eventResolved')) {
      this.guide?.suspend();
      await this.playAfterEvent(prev, next, events);
      this.guide?.resume(this.session.state);
      return;
    }
    // 盘前买卖
    const bought = first(events, 'bought');
    const sold = pick(events, 'sold');
    // 0.5.1：买入的小人从推荐卡飞进格子；卖出的格子吐金币飞回顶栏钱包（先记下飞出前的位置）
    const recFrom = bought ? this.chat.recRect(bought.rec) : null;
    const soldFrom = sold.map((e) => this.holdings.center(e.slot));
    this.render(next);
    if (bought && recFrom && !this.anim.instant) this.flyIn(bought.slot, bought.stockId, { x: recFrom.x + 34, y: recFrom.y + recFrom.h / 2 });
    soldFrom.forEach((c, i) => {
      const e = sold[i];
      if (c && e && !this.anim.instant) this.coinsHome(c, e.holdRet);
    });
    if (bought) {
      sound.cue({ type: 'buy' });
      if (bought.replaced) sound.cue({ type: 'sell' });
      const c = this.holdings.center(bought.slot);
      if (c) sparkles(this, this.anim, c.x, c.y - 30, 12);
      const head = this.holdings.rect(bought.slot) ?? null;
      const u = bought.units ?? 1;
      const word = bought.short ? `押跌 ${unitsWord(u)}！` : next.ext && u >= 3 ? `重仓 ${unitsWord(u)}！` : next.ext ? `买入 ${unitsWord(u)}！` : '买入！';
      if (head) this.glyphPop(bought.short ? 'bear' : 'rocket', head.x + 22, head.y - 6, 30);
      if (head) floatText(this, this.anim, head.x + head.w / 2, head.y + 4, word, bought.short ? 0x2e3558 : COLOR.info, { size: bought.short || u >= 3 ? 20 : 16, pop: true });
      this.guide?.acted('rec');
    }
    for (const e of pick(events, 'added')) {
      sound.cue({ type: 'buy' });
      const r = this.holdings.rect(e.slot);
      if (r) {
        sparkles(this, this.anim, r.x + 22, r.y + 90, 10);
        floatText(this, this.anim, r.x + r.w / 2, r.y + 4, `加仓！现在 ${unitsWord(e.units)}`, COLOR.info, { size: 16, pop: true });
      }
      this.guide?.acted('sell');
    }
    for (const e of pick(events, 'trimmed')) {
      sound.cue({ type: 'sell' });
      const r = this.holdings.rect(e.slot);
      if (r) floatText(this, this.anim, r.x + r.w / 2, r.y + 4, `卖一半 ${pctArrow(e.holdRet)}`, signColor(e.holdRet), { size: 16, pop: true });
      this.guide?.acted('sell');
    }
    const borrowed = first(events, 'borrowed');
    if (borrowed) {
      sound.cue({ type: 'buy' });
      void this.top.rollAccount(this.anim, prev.account, next.account, 500);
      const name = collateralById(borrowed.loan.id).name;
      this.toast(`${collateralById(borrowed.loan.id).pledge}借到 ${formatMoney(borrowed.loan.amount)}`, 3600, false);
      floatText(this, this.anim, 420, 70, `押了${name}，+${formatMoney(borrowed.loan.amount)}`, COLOR.accentDark, { size: 20, pop: true, hold: 900, depth: 170 });
    }
    const repaid = first(events, 'repaid');
    if (repaid) {
      void this.top.rollAccount(this.anim, prev.account, next.account, 500);
      sound.cue({ type: 'rewardShow' });
      redeemFx(this, this.anim, collateralById(repaid.loan.id).name);
      this.toast(collateralById(repaid.loan.id).back, 3600, false);
    }
    this.showComments(pick(events, 'comment'));
    this.showQuips(this.anim, pick(events, 'quip'));
    for (const e of sold) {
      sound.cue({ type: 'sell' });
      const c = this.holdings.center(e.slot);
      if (c) this.glyphPop(e.holdRet > 0 ? 'moneybag' : 'cry', c.x, c.y - 44, 40);
      if (c) floatText(this, this.anim, c.x, c.y, `卖出 ${pctArrow(e.holdRet)}`, signColor(e.holdRet), { size: 18, pop: true });
      this.guide?.acted('sell');
    }
    this.showLearned(events);
    this.syncGuide();
  }

  /** 0.5.1：飘字旁边配一个图标（弹出、停一下、淡出）；动画关闭时不放。 */
  private glyphPop(g: Glyph, x: number, y: number, size = 34, hold = 700): void {
    if (this.anim.instant) return;
    const img = addGlyph(this, x, y, g, size).setDepth(171).setScale(0);
    const sc = (size / Math.max(1, img.width)) || 1;
    this.tweens.add({ targets: img, scale: { from: 0, to: sc }, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: img, alpha: 0, y: y - 24, delay: 200 + hold, duration: 300, onComplete: () => img.destroy() });
  }

  /** 买入：一个小人从推荐卡飞进格子，格子里的小人落地时弹一下。 */
  private flyIn(slot: number, stockId: string, from: { x: number; y: number }): void {
    const card = this.holdings.card(slot);
    const to = this.holdings.head(slot);
    if (!card?.guy || !to) return;
    const guy = card.guy;
    guy.setAlpha(0);
    const ghost = new StockGuy(this, from.x, from.y + 20, stockId, guy.faceNow, 48, { idle: false }).setDepth(150);
    const midX = (from.x + to.x) / 2;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 420,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 1;
        const bx = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
        const by = (1 - t) * (1 - t) * (from.y + 20) + 2 * (1 - t) * t * (Math.min(from.y, to.y) - 120) + t * t * (to.y + guy.size);
        ghost.setPosition(bx, by).setScale(1 + t * (guy.size / 48 - 1));
      },
      onComplete: () => {
        ghost.destroy();
        if (guy.active) {
          guy.setAlpha(1);
          this.tweens.add({ targets: guy, scaleY: { from: 0.8, to: 1 }, duration: 220, ease: 'Back.easeOut' });
        }
      },
    });
  }

  /** 卖出：几枚金币从格子飞回顶栏的钱包（亏了也飞，只是少几枚、颜色灰一点）。 */
  private coinsHome(from: { x: number; y: number }, holdRet: number): void {
    const to = this.top.walletAt();
    const n = holdRet > 0 ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const c = addImage(this, from.x + (Math.random() - 0.5) * 50, from.y + (Math.random() - 0.5) * 30, 'fx:coin', 22).setDepth(160);
      if (holdRet <= 0) c.setTint(0xc8c0b8);
      this.tweens.add({
        targets: c,
        x: to.x,
        y: to.y,
        scale: c.scale * 0.6,
        delay: i * 60,
        duration: 520,
        ease: 'Cubic.easeIn',
        onComplete: () => c.destroy(),
      });
    }
    this.time.delayedCall(n * 60 + 520, () => {
      if (this.sys.isActive()) this.top.pulseAccount();
    });
  }

  /** 群友对买入、借钱、赎回的反应：手机下方冒一句。 */
  private showComments(list: readonly Ev<'comment'>[]): void {
    // 冒在推荐卡上方（叠着往上摞），不盖住推荐卡；今天没有推荐卡时在手机下方
    const recs = this.chat.recsRect();
    let anchor = recs ? recs.y - 4 : PHONE.y + PHONE.h - 150;
    list.slice(0, 2).forEach((c) => {
      const name = this.session.state.friends.some((f) => f.id === c.friendId) ? friendView(this.session.state, c.friendId).name : '群友';
      const q = quipBubble(this, this.anim, PHONE.x + PHONE.w / 2, anchor, `${name}：${c.text}`, 3200);
      this.quips.push(q);
      this.commentQuips.push(q.root);
      anchor = q.rect.y - 4;
    });
  }

  private knowNode: Phaser.GameObjects.Container | null = null;

  /** 第一次触发新机制：顶上滑出"点亮小知识"。 */
  private showLearned(events: GameEvent[]): void {
    const ids = pick(events, 'learned').map((e) => e.id);
    if (ids.length === 0) return;
    this.knowNode?.destroy();
    this.knowNode = knowledgeToast(this, this.anim, ids);
    if (this.knowNode && this.anim.instant) {
      // 关掉动画时多留一会儿再收起
      const node = this.knowNode;
      this.time.delayedCall(4000, () => node.active && node.destroy());
    }
  }

  /** 弹一张要点"知道了"的大卡（银行来电、东西被收走），等玩家点了再往下播。 */
  private async popup(make: (onOk: () => void) => { root: Phaser.GameObjects.Container; button: Button }): Promise<void> {
    const c = make(() => this.continueInput());
    this.continueBtn = c.button;
    this.session.notify();
    // 0.5：不用点也会在几秒后自己收起（少打断一次）；点"知道了"可以马上收
    const timer = this.time.delayedCall(3200, () => this.continueInput());
    await this.waitContinue();
    timer.remove(false);
    this.continueBtn = null;
    c.root.destroy();
  }

  /** 银行这一天的动作：打电话、收走东西（开盘结算或月底）。 */
  private async playBank(events: GameEvent[]): Promise<void> {
    const a = this.anim;
    for (const e of events) {
      if (e.type === 'bankCalled') {
        sound.cue({ type: 'news', kind: 'warning' });
        await this.popup((ok) => bankCallCard(this, a, e.debt, ok));
      } else if (e.type === 'seized') {
        sound.cue({ type: 'news', kind: 'delisted' });
        const d = collateralById(e.id);
        void this.top.rollAccount(a, e.before, e.after, 400);
        const why = e.line !== undefined && e.debt !== undefined ? { cause: e.cause ?? 'trade', account: e.before, line: e.line, debt: e.debt } : null;
        await this.popup((ok) => seizedCard(this, a, d.name, d.lost, e.amount, e.penalty, why, ok));
      }
    }
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.openBtn.setLocked(b);
    this.holdings.setLocked(b);
    this.chat.setLocked(b);
    this.session.notify();
  }

  /**
   * 一天的结算：开盘翻牌（持仓卡一张张翻开，大涨大跌涨停跌停各有特效）→ 龙头带动 → 道具 → 账户跳动；
   * 然后高光 / 连击大字、目标进度、消息揭晓、播报和吐槽、收盘小结；月底账单或下一天。
   * fast（平淡日快进）：节拍压到约五分之一，只看翻牌和账户跳动；碰到高光、目标变化照常播。
   */
  private async playDay(prev: GameState, next: GameState, events: GameEvent[], fast = false): Promise<void> {
    const a = this.anim;
    const k = fast ? FAST : 1;
    this.setBusy(true);
    // 盘前群友对买入 / 借钱的那句评论到开盘就收掉：开盘后群聊换成新一天的推荐，留着会盖住新的推荐卡
    for (const r of this.commentQuips) {
      if (!r.active) continue;
      this.tweens.killTweensOf(r);
      r.destroy();
    }
    this.commentQuips = [];
    this.clearPick();
    this.quietBtn.setVisible(false);
    this.holdings.setDayWord('今天');
    hideTooltip(this);
    sound.cue({ type: 'marketOpen' });
    pop(a, this.openBtn, 0.92);
    this.setMonitorLine(fast ? '快进中…' : '开盘！');
    // 快进时一天一两秒，色调来回换会闪：停在清晨，只有月底算账才入夜
    if (!fast) {
      this.room.setTime('day', a);
      this.room.flashLights(a);
    }
    this.screen.setSub(isTouch() ? '点屏幕跳过' : '空格跳过');
    // 节拍按同一个起点累计（waitUntil），低帧率时不会每段都晚一帧、越拖越长
    const t0 = a.now();
    let off = 0;
    const beat = (ms: number): Promise<void> => {
      off += ms * k;
      return a.waitUntil(t0, off);
    };
    const sms = pick(events, 'stockMoved');
    // 开盘翻牌：手里的股票先盖上牌背（快进时不盖）
    if (!fast && sms.length > 0) this.holdings.coverAll(a);
    await beat(T.open * 0.6);

    // ① 大盘天气与题材热度
    const mm = first(events, 'marketMoved');
    if (mm && mm.mood !== this.room.currentMood) {
      this.room.setMood(mm.mood, a);
      sound.cue({ type: 'weather', to: mm.mood });
    }
    if (mm) sound.mood(mm.mood);
    const tms = pick(events, 'themeMoved');
    const up = tms.filter((t) => t.dH >= 2).length;
    const down = tms.filter((t) => t.dH <= -2).length;
    if (!fast) sound.cue({ type: 'heat', up, down, max: Math.max(0, ...tms.map((t) => Math.abs(t.dH))) });
    const themeMs = Math.round(T.themes * 0.6 * k);
    await this.board.animate(a, tms, themeMs);
    // 热度动完：看板的数字、走势、状态一起换成收盘后的（不然同屏的新闻、账单和看板对不上）
    this.board.render(next);
    off += themeMs;

    // ② 开盘翻牌：持仓一张张翻开（龙头带动的跟涨先不算，③ 再跳）
    const steps = new Map<number, HoldingMove & { stock: StockMove }>();
    const tones: FlipTone[] = [];
    for (const [i, e] of sms.entries()) {
      steps.set(e.slot, e);
      const pre = e.stock.move - e.stock.chain;
      const role = stockById(e.stockId).role;
      const shown = revealShown(e);
      const flags = { short: e.short === true, limitUp: e.stock.limitUp && e.stock.chain === 0, limitDown: e.stock.limitDown };
      const tone = flipTone(shown, flags);
      tones.push(tone);
      this.holdings.flip(a, e.slot, fast ? 'flat' : tone);
      // 押跌的格子直接揭晓自己的收益（它涨你亏，含被轧）；不然会先闪一下股票本身的 +10% 再变成亏损
      this.holdings.reveal(a, e.slot, pre, shown, role, { ...flags, blown: e.stock.blown, jump: e.stock.jump });
      sound.cue({ type: 'reveal', move: pre, limit: flags.limitUp ? 'up' : flags.limitDown ? 'down' : null, index: i });
      if (!fast && (tone === 'bigUp' || tone === 'bigDown')) sound.cue({ type: 'settle', ret: tone === 'bigUp' ? 6 : -6 });
      await beat(T.reveal * 0.75);
    }
    this.holdings.clearCovers();
    if (sms.length > 0) await beat(T.afterReveal * 0.5);
    // 涨停、押对时群友刷屏一两句
    if (!fast && !a.instant) {
      const spam = tones.some((t) => t === 'shortWin') ? 'short' : tones.some((t) => t === 'limitUp') ? 'up' : tones.filter((t) => t === 'bigUp').length >= 2 ? 'big' : null;
      if (spam) this.spam(spamLines(next, spam, next.dayIndex));
    }
    // 押跌的股票涨停：被轧（屏幕抖、红闪、大字）
    for (const e of pick(events, 'squeezed')) {
      const r = this.holdings.rect(e.slot);
      sound.cue({ type: 'thunder' });
      squeezeFx(this, a, r ? r.x + r.w / 2 : VIEW.w / 2, r ? r.y + (PHONE_MODE ? 70 : 4) : SHOUT_AT.y + 90, stockById(e.stockId).name);
      await beat(1000);
    }

    // ③ 龙头带动：从龙头（不在持仓时从题材徽记）连线到持仓里的跟风股，跟风数字再跳一下
    let chainIdx = 0;
    for (const c of pick(events, 'chain')) {
      if (c.held.length === 0) continue;
      const leaderSlot = this.holdings.slotOf(c.leader);
      const from = c.leaderHeld && leaderSlot >= 0 ? this.holdings.head(leaderSlot) : this.board.badgeCenter(stockById(c.leader).theme);
      if (!from) continue;
      for (const f of c.held) {
        const slot = this.holdings.slotOf(f);
        const e = steps.get(slot);
        const to = this.holdings.head(slot);
        if (!e || !to) continue;
        if (!fast) this.beam(from, to);
        sound.cue({ type: 'chain', index: chainIdx++ });
        const limit = BALANCE.roles[stockById(f).role].limit;
        this.holdings.card(slot)?.guy?.setFace(faceOf(e.stock.move, limit));
        this.holdings.card(slot)?.guy?.bounce(a, 0.6);
        floatText(this, a, to.x, to.y + 26, `带飞 ${pctArrow(e.stock.chain)}`, COLOR.accentDark, { size: 14, pop: true });
        void this.holdings.rollToday(a, slot, revealShown({ ...e, stock: { chain: 0 } }), 300);
      }
      await beat(T.chain * 0.7);
    }

    // ④ 道具触发：图标闪一下，写明改动，该格数字跳到这一步之后的值
    const stepIndex = new Map<number, number>();
    const acc = first(events, 'accountChanged');
    const accIdx = acc ? events.indexOf(acc) : events.length;
    for (const [i, e] of events.entries()) {
      if (i > accIdx) break;
      if (e.type === 'itemTriggered') {
        this.top.flashItem(a, e.itemId);
        sound.cue({ type: 'item', id: e.itemId, delta: e.delta });
        const name = itemView(e.itemId).name;
        const at = e.slot !== null ? this.holdings.head(e.slot) : this.top.itemCenter(e.itemId);
        // 落在某一格的道具只写「道具名 +x%」（卡片已经说明是哪只），账户级的写全文
        const label = e.slot !== null ? `${name} ${pctArrow(e.delta)}` : `${name}：${e.text}`;
        if (at) floatText(this, a, at.x, at.y + (e.slot !== null ? 26 : 50), label, COLOR.accentDark, { size: 14, pop: true, hold: 600 });
        if (e.slot !== null) {
          const h = steps.get(e.slot);
          if (h) {
            const k2 = h.steps.findIndex((st, j) => j > (stepIndex.get(e.slot as number) ?? 0) && st.source === e.itemId);
            const st = k2 >= 0 ? h.steps[k2] : undefined;
            if (st && k2 >= 0) {
              stepIndex.set(e.slot, k2);
              void this.holdings.rollToday(a, e.slot, st.value, 300);
            }
          }
        }
        await beat(T.item * 0.75);
      } else if (e.type === 'stockNews' && e.held) {
        const slot = this.holdings.slotOf(e.stockId);
        const at = slot >= 0 ? this.holdings.head(slot) : null;
        const label = e.news === 'uncap' ? '翻身了！' : e.news === 'warning' ? `退市警告 ${e.warnings}/${BALANCE.st.warnings}` : '退市了…';
        sound.cue({ type: 'news', kind: e.news });
        if (at) floatText(this, a, at.x, at.y + 30, label, e.news === 'uncap' ? COLOR.up : COLOR.danger, { size: 15, pop: true, hold: 600 });
        await beat(T.item * 0.75);
      } else if (e.type === 'autoSold') {
        const at = this.holdings.center(e.slot);
        const label = e.reason === 'stop' ? '跌太多，自动卖了' : e.reason === 'take' ? '赚够了，自动卖了' : '退市了，移出';
        sound.cue({ type: 'autoSold', reason: e.reason });
        if (at) floatText(this, a, at.x, at.y + 40, `${label} ${formatPoints(e.holdRet)}`, signColor(e.holdRet), { size: 15, pop: true, hold: 600 });
        this.holdings.card(e.slot)?.root.setAlpha(0.55);
        await beat(T.item * 0.75);
      }
    }
    // 收尾：每格数字落到最终收益
    for (const [slot, h] of steps) void this.holdings.rollToday(a, slot, h.ret, 200);

    // ⑤ 账户滚动；涨停放烟花、跌停飘雨云
    const report = first(events, 'dayClosed')?.report ?? null;
    if (acc) {
      sound.cue({ type: 'settle', ret: acc.ret });
      const rolling = this.top.rollAccount(a, acc.before, acc.after, Math.round(T.account * (fast ? 0.5 : 0.8)));
      let fw = 0;
      for (const [slot, h] of steps) {
        const head = this.holdings.head(slot);
        const rect = this.holdings.rect(slot);
        if (!head || !rect) continue;
        // 烟花、雨云放在卡片上沿之上，不挡住小人和数字
        head.y = Math.min(head.y, rect.y + 10);
        if (h.stock.limitUp) {
          this.time.delayedCall(fw * 160, () => fireworks(this, a, head.x, head.y - 34, h.stock.boards >= 3));
          if (fw === 0) sound.cue({ type: 'limitUp' });
          fw += 1;
        } else if (h.stock.limitDown) {
          rainCloud(this, a, head.x, head.y - 30);
          sound.cue({ type: 'limitDown' });
        }
      }
      this.showQuips(a, pick(events, 'quip'));
      await rolling;
    }
    if (report) {
      this.setMonitorMoney(report.account.after - report.account.before, report.account.ret);
      this.screen.setSub('收盘');
      if (!fast) {
        this.room.setTime('dusk', a);
        // 0.17.0 收盘：总账数字砸一下，赚了的话金币从显示器飞进钱包（都不占节拍）
        pop(a, this.monitor, 1.25);
        if (report.account.after - report.account.before >= 1) this.coinsHome({ x: this.monitor.x, y: this.monitor.y }, report.account.ret);
      }
      // 0.5.1：房间跟着今天的结果——赚了掉金币、亏了飘乌云，大盘大涨挂彩虹
      this.room.celebrate(a, report.account.ret);
      this.room.setRainbow(report.market.ret >= 1.5);
    }
    // ⑥ 高光、连击：屏幕中部大字（快进时也照常播，最多两条）；连击的红包让账户再跳一下；目标进度、达成、没达成
    const stopped = await this.playTempo(prev, next, events, report);
    // 消息揭晓（当天的、前几天的多日消息），然后播报、吐槽和新闻
    await this.chat.judge(a, pick(events, 'messageJudged'), T.judge * k, next);
    await this.chat.judgeIntel(a, pick(events, 'intelJudged'), T.judge * k);
    const ticker = pick(events, 'spotted').sort((x, y) => Number(y.held) - Number(x.held)).map((e) => spottedText(e));
    await this.chat.afterClose(a, pick(events, 'comment'), report?.news ?? [], T.comment * k, ticker);
    // 股灾：收盘后才揭晓，所有题材提前退潮
    if (first(events, 'crashHit')) {
      sound.cue({ type: 'weather', to: 'bear' });
      shake(this, a, 320, 0.008);
      this.glyphPop('storm', VIEW.w / 2, SHOUT_AT.y + 102, 64, 1100);
      floatText(this, a, VIEW.w / 2, SHOUT_AT.y + 150, '股灾！风口全部↓', COLOR.down, { size: 26, pop: true, hold: 1200, depth: 170 });
      this.setMonitorLine('股灾！');
      this.screen.setSub('全部降温');
      await a.wait(1200);
    }
    // 熬夜复盘：揭示一个题材今天收盘时的阶段（看板上标到明天盘前）
    const rv = first(events, 'themeReviewed');
    if (rv) {
      const c = this.board.badgeCenter(rv.theme);
      if (c) floatText(this, a, c.x + 90, c.y, itemView('night_review').name, COLOR.info, { size: 14, pop: true, hold: 500 });
    }
    // 收盘小结：今天最精彩的事 + 总账一句 + 每只一行（设置里可以改成只看总账）
    if (report) this.recapCard?.showRecap(recapOf(report, '今天'), loadViewPrefs().recap === 'brief', a, '今天');
    await a.wait(T.hold * k);
    // 银行：打电话、收走东西（卡片自己几秒后收起，不用点）；付完月底账单才跌破线的，等账单收据出来再说
    const billBank = events.some((e) => e.type === 'seized' && e.cause === 'bill');
    if ((first(events, 'bankCalled') || first(events, 'seized')) && !billBank) {
      await this.playBank(events);
    }
    this.showLearned(events);
    // 下一天要不要停下来等玩家：今天有高光 / 连击 / 目标变化 / 事件 / 银行 / 新月份，或者今天本身不平淡
    this.stopHere =
      stopped ||
      report?.tempo?.quiet === false ||
      !report?.tempo ||
      events.some((e) => e.type === 'eventStarted' || e.type === 'monthStarted' || e.type === 'bankCalled' || e.type === 'seized' || e.type === 'crashHit' || e.type === 'autoSold' || e.type === 'stockNews');

    // 0.11.0 开了杠杆、收盘后跌到清零线：一张卡说清楚，点了去结束页（月底还完账单后跌到的在账单卡后面说）
    const called = first(events, 'gearWiped');
    if (called && !first(events, 'billPaid')) {
      await this.playMarginCall();
      return;
    }

    // 月底
    const paid = first(events, 'billPaid');
    const broke = first(events, 'bankrupt');
    if (paid || broke) {
      sound.mood('payday');
      // 突发账单明细（总额已含在 amount 里）
      const extras = (prev.bill.extras ?? []).map((e) => ({ name: e.name, amount: e.amount }));
      const info = paid
        ? { month: paid.month, name: prev.bill.name, amount: paid.amount, before: paid.before, after: paid.after, paid: true, credit: paid.credit, extras, interest: pick(events, 'interestPaid').reduce((n, e) => n + e.amount, 0) }
        : { month: broke?.month ?? prev.month, name: prev.bill.name, amount: broke?.amount ?? 0, before: broke?.account ?? 0, after: broke?.account ?? 0, paid: false, credit: false, extras };
      // 本月目标写在账单上
      const mt = monthThemeView(prev);
      const goal = mt ? { name: mt.name, done: mt.goal.done || !!first(events, 'goalDone') } : undefined;
      const quick = loadViewPrefs().bill === 'quick';
      a.relax();
      this.room.setTime('night', a);
      const bill = await playBill(this, a, { ...info, goal }, quick);
      if (paid) this.top.setAccount(paid.after);
      if (billBank) await this.playBank(events);
      if (called) {
        bill.destroy();
        await this.playMarginCall();
        return;
      }
      if (broke || first(events, 'runWon')) {
        this.showContinue(bill, broke ? '看看这一局怎么样' : '通关了！看看这一局');
        this.setBusy(false);
        await this.waitContinue();
        this.continueBtn = null;
        return; // Session 随后切到结束页
      }
      await a.wait(quick ? BILL_MS.quick : BILL_MS.hold);
      bill.destroy();
    }
    this.setBusy(false);
    this.render(next);
    // 到了第二天开盘前：小结改口说「昨天」
    if (report && this.recapCard?.showing === 'recap') this.recapCard.showRecap(recapOf(report, '昨天'), loadViewPrefs().recap === 'brief', null, '昨天');
    if (next.phase === 'premarket') {
      a.relax();
      this.room.setTime('morning', a);
      if (first(events, 'monthStarted')) await this.playMonthIntro(events);
      await this.chat.intro(a, T.chatGap * (fast && !first(events, 'monthStarted') ? 0.5 : 1));
      // 新的一天：教程和猫的提示按新局面重新说
      this.syncGuide();
    }
  }

  /**
   * 0.5 收盘的节奏反馈：高光 / 连击大字（按精彩程度挑两条）、连击红包让账户跳一下、顶栏目标进度跳动或盖章。
   * 返回今天有没有值得停下来看的事（自动快进碰到就停）。
   */
  private async playTempo(prev: GameState, next: GameState, events: GameEvent[], report: { tempo?: { streak: number } } | null): Promise<boolean> {
    const a = this.anim;
    const hs = pick(events, 'highlight').filter((h) => h.kind !== 'headline');
    const combos = pick(events, 'combo');
    const goalEv = events.filter((e) => e.type === 'goalProgress' || e.type === 'goalDone' || e.type === 'goalFailed');
    if (hs.length === 0 && combos.length === 0 && goalEv.length === 0) return false;
    a.relax();
    // 连击红包、目标奖励的钱：账户再跳一下（收盘结算之后才加的）
    const acc = first(events, 'accountChanged');
    const settled = acc ? acc.after : prev.account;
    const bonus = combos.reduce((n, c) => n + c.cash, 0) + pick(events, 'goalDone').reduce((n, g) => n + g.cash, 0);
    const streak = report?.tempo?.streak ?? 0;
    const list = [...hs].sort((x, y) => HIGHLIGHT_RANK[y.kind] - HIGHLIGHT_RANK[x.kind]);
    const top = list.slice(0, 2);
    // 只有连击没有别的高光时，也喊一句
    if (top.length === 0 && combos[0]) top.push({ type: 'highlight', kind: 'combo', text: combos[0].text });
    for (const h of top) {
      const sh = shoutOf(h, streak);
      if (!sh) continue;
      sound.cue(sh.good ? { type: 'rewardShow' } : { type: 'news', kind: 'warning' });
      shout(this, a, sh.title, sh.sub, sh.good, SHOUT_AT.x, SHOUT_AT.y);
      await a.wait(T.shout);
    }
    if (Math.abs(bonus) >= 0.5 && Math.abs(next.account - settled) >= 0.5) {
      sound.cue({ type: 'reward', kind: 'item' });
      void this.top.rollAccount(a, settled, next.account, 400);
    }
    // 碎片：在道具栏旁边飘一句
    combos
      .filter((x) => x.kind !== 'streak')
      .forEach((c, i) => {
        const at = this.top.billRect();
        floatText(this, a, at.x + at.w / 2, at.y + at.h + 28 + i * 26, c.text, COLOR.accentDark, { size: 15, pop: true, hold: 1100, depth: 170 });
      });
    // 目标：进度变了跳一下；达成 / 没达成盖章
    const done = first(events, 'goalDone');
    const failed = first(events, 'goalFailed');
    if (done || failed) {
      this.top.goalChanged(a, next, done ? 'done' : 'failed');
      // 0.17.0 月底那天出结果的：账单上会写，不再单独飘一行字、多停 0.9 秒
      const billDay = events.some((e) => e.type === 'billPaid' || e.type === 'bankrupt');
      if (failed && !done && !billDay) this.glyphPop('target', SHOUT_AT.x - 150, SHOUT_AT.y, 34, 800);
      if (failed && !done && !billDay) floatText(this, a, SHOUT_AT.x, SHOUT_AT.y, `本月目标没达成：${monthThemeView(prev)?.name ?? ''}`, COLOR.muted, { size: 20, pop: true, hold: 900, depth: 170 });
      if (!billDay) await a.wait(900);
    } else if (first(events, 'goalProgress')) {
      this.top.goalChanged(a, next, 'progress');
    }
    // 只有目标进度变化（没有高光、连击、达成）不算"停下来"的理由：每天都可能动一点
    return top.length > 0 || !!done || !!failed;
  }

  /** 涨停、押对时群友刷屏：手机下半截冒一两句（不挡推荐卡，收盘时推荐卡已经收起）。 */
  private spam(lines: { name: string; text: string }[]): void {
    let y = PHONE.y + PHONE.h - 60;
    lines.forEach((l, i) => {
      this.time.delayedCall(i * 220, () => {
        const q = quipBubble(this, this.anim, PHONE.x + PHONE.w / 2 + (i % 2 === 0 ? -30 : 30), y, `${l.name}：${l.text}`, 1700, VIEW.w - 10);
        this.quips.push(q);
        y = q.rect.y - 6;
      });
    });
  }

  /** 选完奖励：新群友入群提示 →（事件）或新月份开场 → 下一天。 */
  private async playAfterReward(next: GameState, events: GameEvent[]): Promise<void> {
    const joined = pick(events, 'friendJoined');
    for (const j of joined) {
      const name = next.friends.some((f) => f.id === j.friendId) ? friendView(next, j.friendId).name : j.friendId;
      this.notes.push(`${name} 加入了群聊`);
    }
    this.render(next);
    if (joined.length > 0) {
      sound.cue({ type: 'friendJoin' });
      this.glyphPop('horn', PHONE.x + 40, PHONE.y + 140, 30, 600);
      floatText(this, this.anim, PHONE.x + PHONE.w / 2, PHONE.y + 140, '新群友进群了！', COLOR.accentDark, { size: 18, pop: true, hold: 600 });
    }
    if (next.phase === 'premarket') {
      this.room.setTime('morning', this.anim);
      this.setBusy(true);
      await this.playMonthIntro(events);
      this.setBusy(false);
      await this.chat.intro(this.anim, T.chatGap);
    }
  }

  /** 事件结果文案 → 新月份开场 → 下一天。 */
  private async playAfterEvent(prev: GameState, next: GameState, events: GameEvent[]): Promise<void> {
    const r = first(events, 'eventResolved');
    this.event?.destroy();
    this.event = null;
    // 0.5：接着就是新月份的看点卡时，事件结果写进看点卡里（少点一次"继续"）
    if (r && next.phase === 'premarket' && first(events, 'monthStarted') && monthThemeView(next)) {
      const name = eventView(prev)?.name ?? '事件';
      sound.cue({ type: 'eventResult', delta: r.delta });
      if (Math.abs(r.delta) >= 0.5) void this.top.rollAccount(this.anim, prev.account, next.account, 500);
      this.render(next);
      this.room.setTime('morning', this.anim);
      this.setBusy(true);
      await this.playMonthIntro(events, [`${name} · 后来呢：${r.text}${Math.abs(r.delta) >= 0.5 ? `（${formatMoney(r.delta, { sign: true })}）` : ''}`]);
      this.setBusy(false);
      await this.chat.intro(this.anim, T.chatGap);
      return;
    }
    if (r) {
      const name = eventView(prev)?.name ?? '事件';
      const res = eventResult(this, this.anim, `${name} · 后来呢`, r.text, r.delta, () => this.continueInput());
      if (Math.abs(r.delta) >= 0.5) void this.top.rollAccount(this.anim, prev.account, next.account, 500);
      this.continueBtn = res.button;
      this.session.notify();
      await this.waitContinue();
      this.continueBtn = null;
      res.root.destroy();
    }
    this.render(next);
    if (next.phase === 'premarket') {
      this.room.setTime('morning', this.anim);
      this.setBusy(true);
      await this.playMonthIntro(events);
      this.setBusy(false);
      await this.chat.intro(this.anim, T.chatGap);
    }
  }

  private async playMonthIntro(events: GameEvent[], lead: string[] = []): Promise<void> {
    const ms = first(events, 'monthStarted');
    if (!ms) return;
    const s = this.session.state;
    const surprise = (s.bill.extras ?? []).map((e) => `突然要花钱：${e.name} ${formatMoney(e.amount)}（已经算进这个月要还的钱里）`);
    const extras = [
      // 市场传闻（股灾预告）、到期的临时道具、事件的延后结算，再是打新
      ...pick(events, 'marketNotice').map((e) => `${e.notice.name}：${e.notice.text}`),
      ...pick(events, 'itemExpired').map((e) => `${itemView(e.itemId).name}到期了，不再起作用`),
      ...pick(events, 'pendingSettled').map((e) => `${e.text}${e.delta ? `（${formatMoney(e.delta, { sign: true })}）` : ''}`),
      ...pick(events, 'itemTriggered')
        .filter((e) => events.indexOf(e) > events.indexOf(ms))
        .map((e) => `${itemView(e.itemId).name}：${e.text}${e.delta ? `（${formatMoney(e.delta, { sign: true })}）` : ''}`),
    ];
    if (!this.anim.instant) this.chat.hideAll();
    const all = [...lead, ...surprise, ...extras];
    // 0.5：有月度主题时弹"本月看点"卡（主题、目标、奖励、开场白、群友吐槽 + 这个月要还的钱），没有时照旧
    const mt = monthThemeView(s);
    const ev = first(events, 'monthTheme');
    let box: Phaser.GameObjects.Container;
    let ms2 = T.monthIntro + Math.min(3, all.length) * 600;
    if (mt) {
      const cal = currentCalendar(s);
      const card = monthCard(
        this,
        this.anim,
        s,
        { month: s.month, name: mt.name, intro: mt.intro, rule: mt.rule, goalText: mt.goalText, rewardText: mt.rewardText, boss: mt.goal.boss, roast: ev?.roast ?? null },
        cal,
        s.bill,
        all,
      );
      box = card.root;
      this.cardRect = card.rect;
      ms2 = (mt.goal.boss ? T.bossCard : T.monthCard) + Math.min(3, all.length) * 500;
      this.top.render(s);
    } else box = monthIntro(this, currentCalendar(s), s.bill, all);
    sound.mood('payday');
    this.session.notify();
    // 附加说明多时多留一会儿读（点击或空格可以跳过）
    await this.anim.wait(ms2);
    box.destroy();
    this.cardRect = null;
    sound.mood(s.mood);
    this.anim.relax();
  }

  /** 正在显示的本月看点卡（截图、自动化用） */
  private cardRect: Rect | null = null;

  /** 账单之后的「继续」按钮（爆仓 / 通关）。 */
  private showContinue(layer: Phaser.GameObjects.Container, label: string): void {
    // 手机上账单卡偏左、高度占满，按钮放到右边印章下面
    const b = new Button(this, PHONE_MODE ? 590 : VIEW.w / 2 - 110, PHONE_MODE ? 372 : 600, { width: 220, height: 52, label, variant: 'primary', fontSize: 18, hotkey: '空格', onClick: () => this.continueInput() });
    layer.add(b);
    this.continueBtn = b;
  }

  /** 龙头带动的连线光效：光带从 from 伸到 to，光点沿线跑过去。 */
  private beam(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const a = this.anim;
    if (a.instant || !hasArt(this.textures, 'fx:link_beam')) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const img = addImage(this, from.x, from.y, 'fx:link_beam', 1, 22).setOrigin(0, 0.5).setRotation(ang).setDepth(145);
    a.fx({ targets: img, displayWidth: len, duration: 220, ease: 'Quad.easeOut' });
    a.fx({ targets: img, alpha: 0, delay: 520, duration: 260 }, () => img.destroy());
    if (!a.calm && hasArt(this.textures, 'fx:link_spark')) {
      const spark = addImage(this, from.x, from.y, 'fx:link_spark', 30).setDepth(146).setBlendMode(Phaser.BlendModes.ADD);
      a.fx({ targets: spark, x: to.x, y: to.y, duration: 320, ease: 'Sine.easeInOut' }, () => {
        spark.destroy();
        sparkles(this, a, to.x, to.y, 8);
      });
    }
  }

  // ---------------------------------------------------------------- 教程

  /** 按当前局面刷新教程气泡（动画中、选格子时不出）。 */
  private syncGuide(): void {
    if (this.guide && !this.busy && !this.banner) this.guide.sync(this.session.state);
    this.updateHint();
  }

  /** 股票小人冒台词（收盘时的涨停、跌停、连续涨停、退市、自动卖出；盘前的买入、卖出）。 */
  private showQuips(a: Animator, list: readonly StockQuip[]): void {
    for (const q of list) {
      if (q.slot === null) continue;
      const head = this.holdings.head(q.slot) ?? this.holdings.center(q.slot);
      const rect = this.holdings.rect(q.slot);
      if (!head || !rect) continue;
      this.quips.push(quipBubble(this, a, head.x, Math.min(head.y, rect.y + 70) - 30, q.text, 2200, PHONE.x - 4));
    }
  }

  /** 点持仓卡：窗户那块换成这一格今天的拆解条（今天刚买的写明明天才有）。 */
  private inspect(slot: number): void {
    if (this.busy || !this.recapCard) return;
    const s = this.session.state;
    const h = s.slots[slot];
    if (!h) return;
    const last = s.lastDay;
    const hm = last?.holdings.find((x) => x.slot === slot && x.stockId === h.stockId && (x.parts?.length ?? 0) > 0) ?? null;
    sound.ui('select');
    this.recapCard.showBreakdown(slot, stockById(h.stockId).name, hm);
    this.session.notify();
    // 0.4 C：点手里的股票，顺手弹出"加仓 / 减一半 / 清仓"
    if (s.ext) this.openHolding(slot);
  }

  /** 新手提示：开盘前、没在播放动画时，猫根据公开信息说一句。 */
  private updateHint(): void {
    this.refreshHint();
    this.syncCorner();
  }

  /** 0.5.5 手机：小结卡和猫的提示共用左下角，一次只露一个——小结优先，猫有话时卡上挂一只小猫，点它收起小结换猫说。 */
  private syncCorner(): void {
    if (!PHONE_MODE || !this.hint || !this.recapCard) return;
    const recap = this.recapCard.showing !== null;
    this.hint.setSuppressed(recap);
    this.recapCard.setCatBadge(recap && this.hint.visible);
  }

  private refreshHint(): void {
    const st = this.session.state;
    if (!this.hint) return;
    // 教程气泡在说话时，猫先不说（别两个气泡一起说）；加班日什么都做不了，也不说
    // 0.5.4：月底那天付完账单会跌破银行的线——不受"新手提示"开关影响，盘前就讲清楚（试玩反馈：车没了才知道）；排在新玩法提示前面，免得被当天留着的提示压住
    if (!this.busy && !this.banner && st.phase === 'premarket' && !this.guide?.box()) {
      const r = bankRisk(st);
      if (r) {
        const text =
          r.kind === 'seize'
            ? `月底付完账单大概只剩 ${moneyShort(r.after)}，跌破收东西的线 ${moneyShort(r.line)}，${r.first}会被收走！${st.slots.some((h) => h) ? '先卖点股票去银行还钱' : '去银行还钱能保住它（还完要够付账单）'}`
            : `月底付完账单大概只剩 ${moneyShort(r.after)}，低于银行的警戒线 ${moneyShort(r.line)}，银行会打电话`;
        this.hint.show(text, st.dayIndex, this.anim, undefined, '银行提醒 · 今天付账单', true);
        this.board.setHighlight([], []);
        return;
      }
    }
    // 0.4 C 新机制的第一次提示：每条只说一次，不受"新手提示"开关影响（当天一直留着）
    if (!this.busy && !this.banner && st.phase === 'premarket' && !this.guide?.box() && st.ext) {
      if (!this.extTipNow || this.extTipNow.day !== st.dayIndex) {
        const tip = nextExtTip(st, loadSeenTips());
        if (tip) {
          markTipSeen(tip.id);
          this.extTipNow = { ...tip, day: st.dayIndex };
        } else if (this.extTipNow && this.extTipNow.day !== st.dayIndex) this.extTipNow = null;
      }
      if (this.extTipNow) {
        this.hint.show(this.extTipNow.text, st.dayIndex, this.anim, undefined, '新玩法 · 第一次见', true);
        this.board.setHighlight([], []);
        return;
      }
    }
    if (!this.hintsEnabled || this.busy || this.banner || st.phase !== 'premarket' || this.guide?.box() || topBar(st).busy) {
      this.hint.hide();
      this.board.setHighlight([], []);
      return;
    }
    const h = newbieHint(st);
    if (h) this.hint.show(h.text, st.dayIndex, this.anim);
    else this.hint.hide();
    // 看板只高亮和猫的提示、今天推荐有关的风口
    const recThemes = chatView(st).recs.filter((r) => !r.taken).map((r) => r.stock.theme);
    this.board.setHighlight(h?.theme ? [h.theme] : [], recThemes);
  }

  /** 正在显示的新机制提示（当天留着） */
  private extTipNow: { id: ExtTipId; text: string; day: number } | null = null;

  /** 教程每一步指向的区域。 */
  private guideTarget(step: string, stockId: string | null): Rect | null {
    switch (step) {
      case 'chat':
        this.showTab('msgs');
        return this.chat.messagesRect();
      case 'rec':
        this.showTab('recs');
        return this.chat.recsRect();
      case 'open':
        return this.openBtn.isEnabled() ? { ...OPEN } : null;
      case 'goal':
        return this.top.billRect();
      case 'colors':
        return this.holdings.area();
      case 'heat':
        this.showTab('board');
        return this.board.rect();
      case 'chain':
      case 'boards': {
        const slot = stockId ? this.holdings.slotOf(stockId) : -1;
        return slot >= 0 ? this.holdings.rect(slot) : null;
      }
      case 'sell': {
        const slot = stockId ? this.holdings.slotOf(stockId) : -1;
        return slot >= 0 ? this.holdings.sellRect(slot) : null;
      }
      case 'bill':
        return this.reward?.area() ?? null;
      default:
        return null;
    }
  }

  /** 此刻能点的控件（教程气泡尽量不盖住）。 */
  private clickableRects(): Rect[] {
    // 群聊整块也算：教程气泡盖住群聊会挡住正要讲的消息（试玩反馈）
    const out: Rect[] = [this.top.settings.rect(), this.top.help.rect(), { ...PHONE }, ...(this.tabs ? [this.tabs.area()] : [])];
    const hr = this.hint?.rect();
    if (hr) out.push(hr);
    const rc = this.recapCard?.rect();
    if (rc) out.push(rc);
    if (this.reward?.root.visible) return [...out, ...this.reward.buttonRects()];
    if (this.openBtn.isEnabled()) out.push({ ...OPEN });
    return [...out, ...this.holdings.buttonRects(), ...this.chat.buttonRects()];
  }

  // ---------------------------------------------------------------- 键盘与自动化

  protected override onKey(e: KeyboardEvent): boolean {
    const s = this.session.state;
    const code = e.code;
    if (code === 'KeyF') {
      this.cancelAuto();
      if (this.busy || this.banner || s.phase !== 'premarket') return false;
      this.onFast();
      return true;
    }
    if (this.autoTimer && code !== 'Space' && code !== 'Enter' && code !== 'NumpadEnter') {
      this.cancelAuto();
      return true;
    }
    if (code === 'Escape') {
      if (this.banner) {
        this.bannerCancel?.press();
        return true;
      }
      return false;
    }
    if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
      if (this.anim.playing) {
        this.anim.hurry();
        return true;
      }
      if (this.continueBtn) return this.continueBtn.press();
      if (this.awaitingInput()) return this.continueInput();
      if (this.busy || this.banner) return false;
      if (s.phase === 'premarket') {
        this.openBtn.press();
        return true;
      }
      return false;
    }
    const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (!m) return false;
    const n = Number(m[1]);
    if (this.busy) return false;
    if (e.shiftKey) return n >= 1 && s.phase === 'premarket' && !this.banner ? this.holdings.pressSell(n - 1) : false;
    if (this.banner) return n >= 1 ? this.holdings.pressPick(n - 1) : false;
    if (s.phase === 'reward' && this.reward) return n === 0 ? this.reward.pressSkip() : this.reward.press(n - 1);
    if (s.phase === 'event' && this.event) return n >= 1 ? this.event.pressKey(n) : false;
    if (s.phase === 'premarket' && n >= 1 && n <= chatView(s).recs.length) {
      // 手机上推荐卡在「推荐」页：按数字键先切过去
      this.showTab('recs');
      return this.chat.pressBuy(n - 1);
    }
    return false;
  }

  override controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = { settings: this.top.settings.center(), help: this.top.help.center(), lobby: this.top.lobby.center() };
    const ex = this.recapCard?.expandCenter();
    if (ex) out['recap:expand'] = ex;
    const cat = this.recapCard?.catCenter();
    if (cat) out['recap:cat'] = cat;
    const news = this.chat.newsCenter();
    if (news && !this.busy) out['news:toggle'] = news;
    if (this.continueBtn) return { ...out, continue: this.continueBtn.center() };
    if (this.guide) Object.assign(out, this.guide.controls());
    if (this.reward && this.reward.root.visible) return { ...out, ...this.reward.controls() };
    if (this.event) return { ...out, ...this.event.controls() };
    Object.assign(out, this.holdings.controls());
    if (this.top.bank?.isEnabled()) out.bank = this.top.bank.center();
    if (this.banner && this.bannerCancel) {
      out['pick:cancel'] = this.bannerCancel.center();
      return out;
    }
    Object.assign(out, this.chat.controls());
    if (this.tabs && !this.busy) Object.assign(out, this.tabs.controls());
    if (this.openBtn.isEnabled()) out.open = this.openBtn.center();
    if (this.quietBtn.visible && this.quietBtn.isEnabled() && !this.busy) out.fast = this.quietBtn.center();
    return out;
  }

  override regions(): Record<string, Rect> {
    const out: Record<string, Rect> = { chat: { ...PHONE }, board: this.board.rect(), slots: this.holdings.area(), open: { ...OPEN }, bill: this.top.billRect(), account: this.top.accountRect() };
    // 正在显示的教程步骤：guide:<步骤>（自动化与截图用）
    // 手机上群聊页没打开时，消息和新闻都不在屏幕上
    const msgsShown = this.chat.phoneView === 'msgs';
    if (msgsShown) for (const [i, r] of Object.entries(this.chat.messageRects())) out[`msg:${i}`] = r;
    if (this.toastNode?.active && this.toastRect) out.toast = this.toastRect;
    if (this.cardRect) out.monthCard = this.cardRect;
    const hr = this.hint?.rect();
    if (hr) out.hint = hr;
    const rc = this.recapCard?.rect();
    if (rc) out[`recap:${this.recapCard?.showing ?? ''}`] = rc;
    this.quips = this.quips.filter((q) => q.root.active);
    this.quips.forEach((q, i) => (out[`quip:${i}`] = q.rect));
    if (msgsShown && this.chat.newsRect) out.news = this.chat.newsRect;
    if (this.chat.newsExpanded && this.chat.newsOpenRect) out['news:open'] = this.chat.newsOpenRect;
    const f = this.top.flagsRect();
    if (f) out.flags = f;
    const g = this.guide?.box();
    if (g) out[`guide:${g.step}`] = g.rect;
    const cash = this.holdings.cashArea();
    if (cash) out.cash = cash;
    if (this.top.bank) out.bankBtn = this.top.bank.rect();
    if (this.knowNode?.active) out.knowledge = this.knowNode.getBounds() as unknown as Rect;
    if (this.extTipNow) out[`tip:${this.extTipNow.id}`] = this.hint?.rect() ?? { x: 0, y: 0, w: 0, h: 0 };
    return out;
  }
}

/** 两色按比例混合（屏幕深底上的涨跌色调亮一点）。 */
function mixColor(a: number, b: number, t: number): number {
  const ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) << sh;
  return ch(16) | ch(8) | ch(0);
}
