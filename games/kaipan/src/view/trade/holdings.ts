import Phaser from 'phaser';
import { BALANCE, faceOf, formatPoints, holdingCards, isBusy, topBar, unitsWord, type Face, type GameState, type HoldingCard } from '../../core/index.ts';

/**
 * 读「冷时买的」（HoldingCard.lowBuy）的道具：核对过规则层 items.ts，目前只有抄底大师（dixi，onHolding 里看 holding.lowBuy）；
 * buyStage 只用在成就和档案里，不影响道具。
 */
const LOWBUY_ITEMS: readonly string[] = ['dixi'];
import type { Animator } from '../fx/anim.ts';
import { flashBox, floatText, pop, shake } from '../fx/effects.ts';
import { flameBurst, iceBurst } from '../fx/particles.ts';
import { stamp, type FlipTone } from './tempoFx.ts';
import { boardsText, buysText, holdText, sellKey, stText, todayText } from '../labels.ts';
import type { Rect } from '../rect.ts';
import { COLOR, PHONE, THEME_COLOR, TYPE, signColor, textOn } from '../theme.ts';
import { addImage, addPill, addSlice } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText, setColor, fitWidth } from '../ui/text.ts';
import { pctArrow } from '../labels.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { ROLE_TERM, ROLE_WORD, term, termTip } from '../glossary.ts';
import { SLOTS, slotRects } from './layout.ts';
import { SHORT_COLOR, chipStack, sunglasses, unitPips } from './ext.ts';
import { positionsView, chatView, formatMoney, freeUnits, type RecView } from '../../core/index.ts';
import { recAction } from './chat.ts';
import { addGlyph } from '../ui/art.ts';
import { addSpark, type Spark } from '../ui/spark.ts';
import { openStockDetail } from './detail.ts';
import { preCount, stockMoves, streakOf, vsMarket, vsWord } from './tape.ts';
const SLOTS_TOP = SLOTS.y;

/** 0.4 C：这一局有仓位玩法时，卡上要的信息（总份数、剩下的现金份数） */
interface SlotExt {
  total: number;
  cash: number;
}


/** 0.5.1 空格的样子：invite = 邀请位（推荐小人招手，点了直接买）；cash = 并进"现金"块 */
interface EmptyLook {
  kind: 'invite' | 'cash';
  rec: RecView | null;
  onBuy: (rec: number) => void;
  idle: boolean;
}

/** 虚线圆角框 */
function dashedBox(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0xfff8ec, 0.78).fillRoundedRect(x, y, w, h, 14);
  g.lineStyle(3, color, 1);
  const dash = 10;
  const gap = 7;
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.lineBetween(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len, x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
    }
  };
  const r = 14;
  seg(x + r, y, x + w - r, y);
  seg(x + r, y + h, x + w - r, y + h);
  seg(x, y + r, x, y + h - r);
  seg(x + w, y + r, x + w, y + h - r);
  g.beginPath().arc(x + r, y + r, r, Math.PI, Math.PI * 1.5).strokePath();
  g.beginPath().arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 2).strokePath();
  g.beginPath().arc(x + w - r, y + h - r, r, 0, Math.PI * 0.5).strokePath();
  g.beginPath().arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI).strokePath();
  return g;
}

/** 每格的选择模式（满仓替换、稀有股票放哪一格） */
export interface PickMode {
  label: (slot: number, card: HoldingCard | null) => string | null;
  onPick: (slot: number) => void;
}

/** 一张持仓卡：股票小人卡或「现金」空格。 */
class SlotCard {
  readonly slot: number;
  readonly rect: Rect;
  readonly root: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  stockId: string | null;
  /** 0.5.1：放大镜（看详情）的位置 */
  magCenter: { x: number; y: number } | null = null;
  /** 0.5.1：空格里的邀请位 */
  isInvite = false;
  guy: StockGuy | null = null;
  private today: Phaser.GameObjects.Text | null = null;
  private hold: Phaser.GameObjects.Text | null = null;
  private boards: Phaser.GameObjects.Container | null = null;
  private st: Phaser.GameObjects.Container | null = null;
  sell: Button | null = null;
  pick: Button | null = null;
  shownToday = 0;

  /** 0.4 C 仓位玩法（null = 0.3 的玩法） */
  private readonly ext: SlotExt | null;
  /** 押跌（卡片反色、小人倒着站） */
  readonly short: boolean;
  private units: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene, slot: number, rect: Rect, card: HoldingCard | null, idle: boolean, onSell: (slot: number) => void, busy = false, onInspect?: (slot: number) => void, ext: SlotExt | null = null, empty: EmptyLook | null = null, state: GameState | null = null) {
    this.state = state;
    this.ext = ext;
    this.short = !!card?.short;
    this.scene = scene;
    this.slot = slot;
    this.rect = rect;
    this.stockId = card?.id ?? null;
    const { x, y, w, h } = rect;
    this.root = scene.add.container(0, 0);
    if (!card) {
      // 0.5.1：空格不再画一模一样的现金卡——第一个空格是"邀请位"（虚线框 + ＋ + 今天推荐的小人招手，点它直接买），
      // 其余空格由 HoldingsView 合并成一块"现金 · 空几格"（这里只留点击区，选格子模式照样能点）
      const hit = scene.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0, 0);
      if (empty?.kind === 'invite' && !empty.rec) hit.setInteractive();
      if (!empty?.rec) bindTooltip(hit, () => rect, () => ({ title: '空格 = 现金', body: ext ? `空格是现金，不涨不跌。手里还有 ${ext.cash} 份现金，可以从右边的推荐里买一只。` : '空格是现金，不涨不跌，可以从右边的推荐里买一只。' }));
      this.root.add(hit);
      if (empty?.kind === 'invite') {
        this.isInvite = true;
        this.buildInvite(empty, hit);
      }
      return;
    }
    const small = w < 150;
    const frame = addSlice(scene, x, y, w, h, 'card_holding');
    // 押跌：卡片翻成冷色（和普通卡的暖色反过来）
    const flip = this.short ? scene.add.rectangle(x + 5, y + 5, w - 10, h - 10, 0xcdd5f3).setOrigin(0, 0).setRounded(10) : null;
    const tc = THEME_COLOR[card.theme];
    // 第一行：风口签（风口色）+ 角色图标和名字
    const tagText = addText(scene, 0, y + 20, card.themeName, { size: small ? 11 : 12, bold: true, color: textOn(tc), originX: 0.5, originY: 0.5 });
    const tagW = tagText.width + 16;
    const tag = addPill(scene, x + 10, y + 10, tagW, 20, tc);
    tagText.setX(x + 10 + tagW / 2);
    const role = addImage(scene, x + w - 20, y + 20, `role:${card.role}`, 22);
    role.setInteractive();
    bindTooltip(role, () => ({ x: x + w - 32, y: y + 8, w: 26, h: 26 }), () => termTip(ROLE_TERM[card.role]));
    const roomForRole = w - 10 - tagW - 10 - 30;
    const roleWord = addText(scene, x + w - 33, y + 20, ROLE_WORD[card.role], { size: 11, bold: true, color: card.role === 'st' ? COLOR.danger : COLOR.muted, originX: 1, originY: 0.5 });
    if (roleWord.width > roomForRole) roleWord.setVisible(false);
    tag.setInteractive();
    bindTooltip(tag, () => ({ x: x + 10, y: y + 10, w: tagW, h: 20 }), () => termTip('theme', `这只属于「${card.themeName}」这个风口。`));
    // 第二行左：风口热度（数字 + 小条）；ST / 低吸时换成提示签（setPills）
    this.heatNode = scene.add.container(0, 0);
    // 小人（偏左）+ 右边的迷你走势框
    // 仓位玩法：左边有一摞筹码，小人缩一点、往右挪，不和筹码挤
    const size = ext ? 60 : small ? 60 : 72;
    const gx = x + (ext ? 72 : small ? 46 : 54);
    this.guy = new StockGuy(scene, gx, this.short ? y + 60 : y + 124, card.id, card.face, size, { idle });
    if (this.short) this.guy.setScale(1, -1);
    const bx = x + w - (ext ? 56 : small ? 50 : 62);
    const bw = ext ? 50 : small ? 44 : 56;
    // 0.5.2：框里不再写"近10天"（小字把半个框占了、柱子挤得看不清；卡身的悬停说明里有最近几天）；柱高按这只自己的涨跌幅缩放
    const chartBg = scene.add.rectangle(bx, y + 56, bw, 46, COLOR.screen, 0.9).setOrigin(0, 0).setRounded(7);
    this.spark = addSpark(scene, bx + 5, y + 61, bw - 10, 36, [], { kind: 'bars', capMin: 3, axis: true });
    this.vs = addText(scene, bx + bw / 2, y + 112, '', { size: 12, bold: true, originX: 0.5, originY: 0.5 });
    this.vs.setInteractive();
    bindTooltip(this.vs, () => ({ x: bx, y: y + 104, w: bw, h: 16 }), () => ({ title: '和大环境比', body: '同样这几天，这只的涨跌减去大环境的涨跌：跑赢是比大环境强，跑输是比大环境弱，差不到 1% 算持平。' }));
    const body = scene.add.rectangle(x + 4, y + 52, w - 8, h - 92, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(body, () => ({ x, y: y + 52, w, h: h - 92 }), () => this.tip(card));
    // 点小人：在窗户那块看今天的拆解条
    body.setInteractive({ useHandCursor: true });
    body.on(Phaser.Input.Events.POINTER_UP, () => onInspect?.(slot));
    // 放大镜：股票详情卡（大走势图、连涨连跌、风口热度、比大环境）
    const mag = addGlyph(scene, bx + bw - 1, y + 57, 'magnifier', 20).setInteractive({ useHandCursor: true });
    this.magCenter = { x: bx + bw - 1, y: y + 57 };
    mag.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.state) openStockDetail(scene, this.state, card.id);
    });
    bindTooltip(mag, () => ({ x: bx + bw - 14, y: y + 46, w: 24, h: 24 }), () => ({ title: '看详情', body: '走势图、连涨连跌、风口热度、比大环境强还是弱。' }));
    const name = addText(scene, x + w / 2, y + 126, card.name, { size: small ? 13 : 15, bold: true, color: this.short ? SHORT_COLOR : COLOR.ink, originX: 0.5 });
    this.today = addText(scene, x + w / 2, y + 143, '', { size: small ? 19 : 22, bold: true, num: true, originX: 0.5 });
    // 持有盈亏色块
    // 手机：卖出键加高到 34，累计条往上挪 4、矮 2，两者不叠；卖出的点击区只往下撑（往上会盖住卡片，点卡片看拆解时误卖）
    const holdY = PHONE ? y + 166 : y + 170;
    const holdH = PHONE ? 16 : 18;
    this.holdBg = scene.add.rectangle(x + 10, holdY, w - 20, holdH, COLOR.muted, 0.16).setOrigin(0, 0).setRounded(holdH / 2);
    this.hold = addText(scene, x + w / 2, holdY + holdH / 2, '', { size: 12, bold: true, num: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
    const sellH = PHONE ? 34 : 26;
    this.sell = new Button(scene, x + 10, y + h - sellH - 5, { width: w - 20, height: sellH, label: '卖出', fontSize: 14, hotkey: ext ? undefined : sellKey(slot), hitPad: { top: 0, bottom: 14 }, onClick: () => onSell(slot) });
    this.sell.tooltip(() =>
      this.sell?.isEnabled() === false && this.sellBlocked === 'busy'
        ? { title: '今天在加班', body: '顾不上炒股，今天不能买也不能卖，只能直接开盘。' }
        : this.sell?.isEnabled() === false && this.sellBlocked === 't1'
          ? termTip('t1')
          : null,
    );
    this.sell.onDenied(() => (this.sellBlocked === 'busy' ? '今天在加班，顾不上炒股，不能买也不能卖' : this.sellBlocked === 't1' ? '今天买的，明天才能卖' : null));
    this.root.add([frame, ...(flip ? [flip] : []), tag, tagText, roleWord, role, this.heatNode, chartBg, this.spark.g, this.vs, body, this.guy, mag, name, this.today, this.holdBg, this.hold, this.sell]);
    if (ext) this.sell.tooltip(() => ({ title: '加仓 / 减一半 / 清仓', body: '点一下，选再买一点、卖掉一半还是全部卖掉。' }));
    this.update(card, true, busy);
    this.spark.play(500, !idle);
  }

  /** 邀请位：虚线框 + ＋ + 今天推荐的小人半透明招手，点它直接买。 */
  private buildInvite(e: EmptyLook, hit: Phaser.GameObjects.Rectangle): void {
    const sc = this.scene;
    const { x, y, w, h } = this.rect;
    const cx = x + w / 2;
    const box = dashedBox(sc, x + 3, y + 3, w - 6, h - 6, COLOR.accent);
    const plusBg = sc.add.circle(cx, y + 34, 19, COLOR.accent).setStrokeStyle(3, COLOR.ink, 1);
    const plus = addText(sc, cx, y + 33, '+', { size: 30, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
    this.root.add([box, plusBg, plus]);
    const r = e.rec;
    if (!r) {
      const t = addText(sc, cx, y + 120, '空位', { size: TYPE.title, bold: true, color: COLOR.muted, originX: 0.5 });
      const t2 = addText(sc, cx, y + 146, '等推荐', { size: 12, color: COLOR.muted, originX: 0.5 });
      this.root.add([t, t2]);
      return;
    }
    const tc = THEME_COLOR[r.stock.theme];
    const guy = new StockGuy(sc, cx, y + 140, r.stock.id, r.stock.face, 80, { idle: e.idle });
    guy.setAlpha(0.6);
    const name = addText(sc, cx, y + 144, r.stock.name, { size: 14, bold: true, color: COLOR.ink, originX: 0.5 });
    const btnW = w - 40;
    const btn = addPill(sc, cx - btnW / 2, y + 170, btnW, 26, COLOR.accent);
    const bt = addText(sc, cx, y + 183, '点我买', { size: 13, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
    const dot = sc.add.circle(cx + btnW / 2 - 12, y + 183, 5, tc).setStrokeStyle(1.5, COLOR.ink, 1);
    const who = r.friend ? `${r.friend.name}荐` : '软件荐';
    const whoT = addText(sc, cx, y + 64, who, { size: 11, bold: true, color: COLOR.accentDark, originX: 0.5 });
    this.root.add([guy, name, btn, bt, dot, whoT]);
    if (e.idle) {
      // 招手：左右轻晃 + 上下浮一点
      sc.tweens.add({ targets: guy, angle: { from: -7, to: 7 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      sc.tweens.add({ targets: [plusBg, plus], scale: { from: 1, to: 1.12 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    hit.setInteractive({ useHandCursor: true });
    hit.on(Phaser.Input.Events.POINTER_UP, () => e.onBuy(r.index));
    bindTooltip(hit, () => this.rect, () => ({ title: `空位 · 买「${r.stock.name}」？`, body: `${r.stock.themeName} · ${ROLE_WORD[r.stock.role]}。${r.friend ? `${r.friend.name}推荐：` : ''}${r.text}\n点一下直接买。` }));
  }

  private state: GameState | null;
  private spark: Spark | null = null;
  private vs: Phaser.GameObjects.Text | null = null;
  private holdBg: Phaser.GameObjects.Rectangle | null = null;
  private heatNode: Phaser.GameObjects.Container | null = null;
  private streak: Phaser.GameObjects.Container | null = null;

  /** 第二行：左边风口热度（数字 + 小条），右边连涨 / 连跌签。 */
  private setRow2(c: HoldingCard, hideHeat: boolean): void {
    const { x, y, w } = this.rect;
    const sc = this.scene;
    this.heatNode?.removeAll(true);
    this.streak?.destroy();
    this.streak = null;
    // 先放右边的连涨 / 连跌签，热度小条再用剩下的宽度（窄卡上两者不再叠在一起）
    let right = x + w - 10;
    const moves = this.state ? stockMoves(this.state, c.id, 10) : c.history;
    const n = streakOf(moves);
    if (c.boards <= 0 && Math.abs(n) >= 2) {
      const t = addText(sc, 0, 0, n > 0 ? `连涨${n}天` : `连跌${-n}天`, { size: 11, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const pw = t.width + 12;
      const pill = addPill(sc, -pw / 2, -10, pw, 20, signColor(n), false);
      this.streak = sc.add.container(x + w - 10 - pw / 2, y + 44, [pill, t]);
      this.root.add(this.streak);
      right -= pw + 6;
    }
    if (this.heatNode && !hideHeat && this.state) {
      const heat = Math.round(this.state.themes[c.theme]?.heat ?? 0);
      const t = addText(sc, x + 12, y + 44, `热${heat}`, { size: 12, bold: true, color: COLOR.ink, originY: 0.5 });
      const bx = t.x + t.width + 4;
      const bw = Math.min(40, right - bx);
      if (bw >= 12) {
        const bg = sc.add.rectangle(bx, y + 41, bw, 7, 0xeadcc8).setOrigin(0, 0).setRounded(3);
        const fg = sc.add.rectangle(bx, y + 41, Math.max(3, (bw * Math.min(100, heat)) / 100), 7, THEME_COLOR[c.theme]).setOrigin(0, 0).setRounded(3);
        this.heatNode.add([t, bg, fg]);
      } else this.heatNode.add(t);
    }
  }

  /** 迷你走势 + 比大环境。 */
  private setSpark(c: HoldingCard): void {
    if (!this.spark || !this.state) return;
    const moves = stockMoves(this.state, c.id, 10);
    this.spark.setPre(preCount(this.state, moves.length)).set(moves);
    const vs = vsWord(vsMarket(this.state, c.id, Math.min(5, moves.length)));
    if (this.vs) {
      // 押跌的卡：股票弱于大环境对你是好事，颜色跟着"对你是赚是亏"走
      const word = vs ? (vs.sign > 0 ? '跑赢' : vs.sign < 0 ? '跑输' : '持平') : '';
      this.vs.setText(word);
      setColor(this.vs, vs ? (vs.sign === 0 ? COLOR.muted : signColor(c.short ? -vs.sign : vs.sign)) : COLOR.muted);
    }
  }

  /** 卖出按钮为什么不能点：T+1（今天买的）或加班日 */
  private sellBlocked: 't1' | 'busy' | null = null;

  get todayLabel(): Phaser.GameObjects.Text | null {
    return this.today;
  }

  private tip(c: HoldingCard): { title: string; body: string } {
    // 和走势框同一个来源（含开局前历史），第 1 天也有
    const hist = (this.state ? stockMoves(this.state, c.id, 5) : c.history).map((v) => formatPoints(v)).join(' ');
    const extra = stText(c);
    return {
      title: `${c.name}（${c.themeName} · ${ROLE_WORD[c.role]}）`,
      body: `${ROLE_WORD[c.role]}。占账户的 ${Math.round(c.weight * 100)}%，买入以来 ${formatPoints(c.holdRet)}${c.boards > 1 ? `，已经连续涨停 ${c.boards} 天` : ''}\n最近 5 天：${hist || '—'}${c.lowBuy ? `\n${term('lowbuy').word}：${term('lowbuy').explain}` : ''}${extra ? `\n${extra}` : ''}\n点一下，看今天的涨跌是怎么来的`,
    };
  }

  /** 刷新数字与按钮（同一只股票原地更新）。 */
  update(c: HoldingCard, premarket: boolean, busy = false, s: GameState | null = null): void {
    if (s) this.state = s;
    if (!this.today || !this.hold) return;
    this.dayWord = premarket ? '昨天' : '今天';
    // 今天刚买的：还没开过盘、而且（不是因为加班）还不能卖；开局就在手里的持仓没开过盘但能卖
    const boughtToday = c.todayRet === null && !c.canSell && !busy;
    // 开局就在手里、还没开过盘：和其他日子开盘前一样显示"昨天"的涨跌（开局前历史的最后一天），不写"未开盘"
    const pre = c.todayRet === null && !boughtToday && this.state ? (stockMoves(this.state, c.id, 1).at(-1) ?? null) : null;
    this.setToday(c.todayRet ?? pre, boughtToday && premarket);
    this.hold.setText(holdText(c.holdRet));
    setColor(this.hold, signColor(c.holdRet));
    this.holdBg?.setFillStyle(Math.abs(c.holdRet) < 0.05 ? COLOR.muted : signColor(c.holdRet), 0.16);
    this.guy?.setFace(c.face);
    this.setPills(c.boards, stText(c), c.lowBuy);
    this.setRow2(c, !!stText(c) || c.lowBuy);
    this.setSpark(c);
    this.setUnits(c);
    // 加班日：不管能不能卖都禁用（规则层的 canSell 也会算进加班，这里先按顶栏的 busy 判断）
    // 仓位玩法：按钮打开"加仓 / 减一半 / 清仓"（今天买的也能加仓），只有加班日不能点
    const can = this.ext ? !busy : c.canSell && !busy;
    this.sellBlocked = !premarket || can ? null : busy ? 'busy' : 't1';
    if (this.sell) {
      this.sell.setVisible(premarket);
      this.sell.setEnabled(can);
      this.sell.setLabel(can ? (this.ext ? '加 / 卖' : '卖出') : this.sellBlocked === 'busy' ? '加班中' : '明天卖');
    }
  }

  /** 仓位：左边一摞筹码（越高压得越多）+ "N 份"；押跌再挂一个戴墨镜的"押跌"牌子。 */
  private setUnits(c: HoldingCard): void {
    this.units?.destroy();
    this.units = null;
    if (!this.ext) return;
    const { x, y } = this.rect;
    const fill = this.short ? SHORT_COLOR : COLOR.gold;
    const parts: Phaser.GameObjects.GameObject[] = [chipStack(this.scene, x + 22, y + 104, c.units, fill)];
    const label = addText(this.scene, x + 22, y + 106, unitsWord(c.units), { size: 11, bold: true, color: this.short ? SHORT_COLOR : COLOR.accentDark, originX: 0.5 });
    parts.push(label);
    if (this.short) {
      // 卡片顶边上挂一条"押跌"的牌子（戴墨镜），不压小人和角标
      const px = x + this.rect.w / 2 - 34;
      const py = y - 12;
      const pill = addPill(this.scene, px, py, 68, 22, SHORT_COLOR);
      const g = sunglasses(this.scene, px + 17, py + 11, 22);
      const t = addText(this.scene, px + 32, py + 11, '押跌', { size: 12, bold: true, color: COLOR.white, originY: 0.5 });
      pill.setInteractive();
      const r = { x: px, y: py, w: 68, h: 22 };
      bindTooltip(pill, () => r, () => ({ title: '押跌', body: '押它跌：它跌你赚，它涨你亏。它涨停那天会被轧，亏得最狠。' }));
      parts.push(pill, g, t);
    }
    const hit = this.scene.add.rectangle(x + 6, y + 60, 34, 60, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
    bindTooltip(hit, () => ({ x: x + 6, y: y + 60, w: 34, h: 60 }), () => ({ title: `压了 ${unitsWord(c.units)}`, body: `钱一共分成 ${this.ext?.total ?? 4} 份，这只压了 ${unitsWord(c.units)}，约占账户的 ${Math.round(c.weight * 100)}%。压得越多，赚亏都越大。` }));
    parts.unshift(hit);
    this.units = this.scene.add.container(0, 0, parts);
    this.root.add(this.units);
  }

  /** 卡上涨跌前面的「昨天 / 今天」：开盘前是昨天，收盘动画里是今天。 */
  dayWord: '今天' | '昨天' = '昨天';

  setToday(v: number | null, boughtToday = false): void {
    if (!this.today) return;
    this.shownToday = v ?? 0;
    this.today.setText(todayText(v, boughtToday, this.dayWord));
    setColor(this.today, v === null ? COLOR.muted : signColor(v));
  }

  /** 角标：连板（右）、ST 提示或低吸（左）。 */
  setPills(boards: number, st: string, lowBuy: boolean): void {
    const { x, y, w } = this.rect;
    this.boards?.destroy();
    this.boards = null;
    this.st?.destroy();
    this.st = null;
    const bt = boardsText(boards);
    if (bt) {
      const t = addText(this.scene, 0, 0, bt, { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const pw = t.width + 14;
      const pill = addPill(this.scene, -pw / 2, -10, pw, 20, COLOR.up);
      this.boards = this.scene.add.container(x + w - 10 - pw / 2, y + 44, [pill, t]);
      pill.setInteractive();
      bindTooltip(pill, () => ({ x: x + w - 10 - pw, y: y + 34, w: pw, h: 20 }), () => termTip(boards > 1 ? 'boards' : 'limit'));
      this.root.add(this.boards);
    }
    const left = st || (lowBuy ? term('lowbuy').word : '');
    if (left) {
      const warn = st !== '' && !st.startsWith('翻身');
      const fill = warn ? 0xffd9d2 : st ? 0xffe7a8 : 0xd9f0ff;
      const t = addText(this.scene, 0, 0, left, { size: 11, bold: true, color: warn ? COLOR.danger : COLOR.ink, originX: 0, originY: 0.5 });
      const pw = Math.min(w * 0.55, t.width + 12);
      const pill = addPill(this.scene, 0, -10, pw, 20, fill);
      t.setX(6);
      this.st = this.scene.add.container(x + 10, y + 44, [pill, t]);
      pill.setInteractive();
      bindTooltip(pill, () => ({ x: x + 10, y: y + 34, w: pw, h: 20 }), () => (st ? termTip('st', st) : termTip('lowbuy')));
      this.root.add(this.st);
    }
  }

  setLocked(locked: boolean): void {
    this.sell?.setLocked(locked);
  }

  setPick(mode: PickMode | null, card: HoldingCard | null): void {
    this.pick?.destroy();
    this.pick = null;
    this.sell?.setAlpha(mode ? 0 : 1);
    if (!mode) return;
    const label = mode.label(this.slot, card);
    if (!label) return;
    const { x, y, w, h } = this.rect;
    // 只占卖出按钮那一条（以前 42 高，把「累计」那行盖住了）
    this.pick = new Button(this.scene, x + 8, y + h - 33, { width: w - 16, height: 30, label, variant: 'primary', fontSize: 14, hotkey: `${this.slot + 1}`, onClick: () => mode.onPick(this.slot) });
    this.root.add(this.pick);
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** 中间持仓格：4–5 张股票小人卡，空格显示「现金」。 */
export class HoldingsView {
  private readonly scene: Phaser.Scene;
  private cards: SlotCard[] = [];
  private readonly idle: boolean;
  private readonly onSell: (slot: number) => void;
  private pickMode: PickMode | null = null;
  private highlight: Phaser.GameObjects.Graphics;
  private state: GameState;

  /** 点了某格的小人（看拆解条） */
  onInspect: ((slot: number) => void) | null = null;

  constructor(scene: Phaser.Scene, s: GameState, idle: boolean, onSell: (slot: number) => void) {
    this.scene = scene;
    this.idle = idle;
    this.onSell = onSell;
    this.state = s;
    this.highlight = scene.add.graphics().setDepth(5);
    this.render(s);
  }

  /** 收盘动画开始：卡上改口说「今天」。 */
  setDayWord(w: '今天' | '昨天'): void {
    for (const c of this.cards) if (c) c.dayWord = w;
  }

  /** 按状态刷新：换了股票的格子重建，同一只原地更新。 */
  render(s: GameState): void {
    this.state = s;
    // 「冷时买的」只在手里有在意这一点的道具时才标，否则只是噪音
    const careLow = topBar(s).items.some((it) => LOWBUY_ITEMS.includes(it.id));
    const hc = holdingCards(s).map((c) => (c && c.lowBuy && !careLow ? { ...c, lowBuy: false } : c));
    const busy = isBusy(s);
    const rects = slotRects(hc.length);
    const pv = s.ext ? positionsView(s) : null;
    const ext: SlotExt | null = pv ? { total: pv.total, cash: pv.cash } : null;
    this.drawCash(pv);
    if (this.cards.length !== hc.length) {
      for (const c of this.cards) c.destroy();
      this.cards = [];
    }
    // 0.5.1：空格每次都重画（邀请位跟着今天的推荐变，现金块跟着账户变）
    const pre = s.phase === 'premarket';
    const invite = pre && !busy ? this.bestRec(s) : null;
    // 没有能直接买的推荐时不放邀请位，空格全部并进现金块
    let invited = false;
    hc.forEach((card, i) => {
      const old = this.cards[i];
      const rect = rects[i] as Rect;
      if (!card) {
        old?.destroy();
        const kind = !invited && invite ? 'invite' : 'cash';
        if (kind === 'invite') invited = true;
        const look: EmptyLook = { kind, rec: kind === 'invite' ? invite : null, onBuy: (r) => this.onBuyRec?.(r), idle: this.idle };
        this.cards[i] = new SlotCard(this.scene, i, rect, null, this.idle, this.onSell, busy, (sl) => this.onInspect?.(sl), ext, look, s);
      } else if (!old || old.stockId !== card.id || old.short !== !!card.short) {
        old?.destroy();
        this.cards[i] = new SlotCard(this.scene, i, rect, card, this.idle, this.onSell, busy, (sl) => this.onInspect?.(sl), ext, null, s);
      } else {
        old.update(card, pre, busy, s);
      }
      this.cards[i]?.setPick(this.pickMode, card);
    });
    this.drawPurse(s, hc, rects, invite);
    this.drawHighlight();
  }

  /** 点了邀请位 / 现金块里的候选小人：买推荐 rec */
  onBuyRec: ((rec: number) => void) | null = null;
  private purse: Phaser.GameObjects.Container | null = null;
  /** 现金块里候选小人的点击区（教程气泡要躲开，第一天的「买它」被盖过） */
  private purseHits: Rect[] = [];

  /** 邀请位上放哪只：能直接买的推荐里，推荐人战绩最好的那只。 */
  private bestRec(s: GameState): RecView | null {
    const recs = chatView(s).recs.filter((r) => recAction(s, r).action === 'buy');
    if (recs.length === 0) return null;
    const rate = (r: RecView): number => (r.friend && r.friend.total > 0 ? r.friend.hits / r.friend.total : 0.5);
    return [...recs].sort((a, b) => rate(b) - rate(a))[0] ?? null;
  }

  /**
   * 0.16.0 空格是桌上的「位子」（art-v3：纸垫）：每个空格一块纸垫、里面一圈虚线座位；第一块左上角是缩小的钱袋和现金数，
   * 今天还能买时纸垫外圈发金光（代替以前的「还能买 N 只」大字）；有别的推荐时一块纸垫上放一只半透明小人，点了直接买。
   */
  private drawPurse(s: GameState, hc: readonly (HoldingCard | null)[], rects: readonly Rect[], invite: RecView | null): void {
    this.purse?.destroy();
    const sc = this.scene;
    const root = sc.add.container(0, 0).setDepth(1);
    this.purse = root;
    this.purseHits = [];
    const cashIdx = this.cards.map((c, i) => (c && !c.stockId && !c.isInvite ? i : -1)).filter((i) => i >= 0);
    if (cashIdx.length === 0) return;
    const weights = hc.reduce((n, c) => n + (c ? c.weight : 0), 0);
    const cash = Math.max(0, s.account * (1 - weights));
    const pre = s.phase === 'premarket';
    const buys = pre ? buysText(s.today.buysLeft, s.ext ? freeUnits(s) : null) : null;
    const glow = !!buys?.can && !isBusy(s);
    const others = pre ? chatView(s).recs.filter((r) => r.stock.id !== invite?.stock.id && recAction(s, r).action === 'buy') : [];
    cashIdx.forEach((i, k) => {
      const { x, y, w, h } = rects[i] as Rect;
      const pad = sc.add.graphics();
      pad.fillStyle(0x6b4a3a, 0.12).fillRoundedRect(x + 2, y + 6, w - 4, h - 6, 16);
      pad.fillStyle(0xfff6e6, 0.94).fillRoundedRect(x + 2, y + 2, w - 4, h - 6, 16);
      pad.lineStyle(2, 0xd8c3a8, 1).strokeRoundedRect(x + 2, y + 2, w - 4, h - 6, 16);
      root.add(pad);
      if (glow) {
        const ring = sc.add.graphics();
        ring.lineStyle(4, COLOR.gold, 0.9).strokeRoundedRect(x - 1, y - 1, w + 2, h, 18);
        root.add(ring);
        if (this.idle) sc.tweens.add({ targets: ring, alpha: { from: 1, to: 0.35 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      root.add(dashedBox(sc, x + 14, y + 52, w - 28, h - 70, 0xd8c3a8));
      if (k === 0) {
        // 缩小的钱袋 + 现金数（左上角）
        const bag = addGlyph(sc, x + 28, y + 28, 'moneybag', 34);
        const lbl = addText(sc, x + 50, y + 12, '现金', { size: 11, bold: true, color: COLOR.muted });
        const amt = addText(sc, x + 50, y + 26, formatMoney(cash), { size: 16, bold: true, num: true, color: COLOR.accentDark });
        fitWidth(amt, w - 58);
        root.add([bag, lbl, amt]);
        if (this.cashRect === null) this.cashRect = { x, y, w, h: 44 };
      }
      const r = others[k];
      const cx = x + w / 2;
      if (r) {
        const ghost = new StockGuy(sc, cx, y + 140, r.stock.id, r.stock.face, 70, { idle: this.idle }).setAlpha(0.55);
        const nm = addText(sc, cx, y + 144, r.stock.name, { size: 12, bold: true, color: COLOR.ink, originX: 0.5 });
        fitWidth(nm, w - 24);
        const tag = addText(sc, cx, y + 162, r.stock.themeName, { size: 10, bold: true, color: THEME_COLOR[r.stock.theme], originX: 0.5 });
        const buy = addPill(sc, cx - 30, y + 180, 60, 22, COLOR.accent);
        const bt = addText(sc, cx, y + 191, '买它', { size: 12, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
        const hr = { x: x + 8, y: y + 56, w: w - 16, h: h - 64 };
        const hit = sc.add.rectangle(hr.x, hr.y, hr.w, hr.h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        hit.on(Phaser.Input.Events.POINTER_UP, () => this.onBuyRec?.(r.index));
        this.purseHits.push(hr);
        bindTooltip(hit, () => hr, () => ({ title: `买「${r.stock.name}」？`, body: `${r.stock.themeName} · ${ROLE_WORD[r.stock.role]}。${r.friend ? `${r.friend.name}推荐：` : ''}${r.text}` }));
        root.add([ghost, nm, tag, buy, bt, hit]);
        if (this.idle) sc.tweens.add({ targets: ghost, y: ghost.y - 4, duration: 1100 + k * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        const t = addText(sc, cx, y + 112, '空位', { size: TYPE.title, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 });
        root.add(t);
        // 今天买不了了：写原因（买够了、在加班……），能买时纸垫在发光就够了
        if (buys && !glow) root.add(addText(sc, cx, y + 140, buys.text.replace(/ /g, ''), { size: 11, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 }));
      }
    });
    // 选格子模式时现金块退到后面，格子上的选择按钮照样露出来
    root.setDepth(0);
    for (const c of this.cards) if (c && !c.stockId) c.root.setDepth(1);
  }

  private cashNode: Phaser.GameObjects.Container | null = null;
  private cashRect: Rect | null = null;

  /** 持仓区右上角："现金还剩 N 份" + 小方块。 */
  private drawCash(pv: ReturnType<typeof positionsView> | null): void {
    this.cashNode?.destroy();
    this.cashNode = null;
    this.cashRect = null;
    // 手机横屏：持仓顶着顶栏，上面没地方放这条；还剩几份在空格的悬停和「买多少」里都看得到
    if (!pv || PHONE) return;
    const rects = slotRects(pv.total);
    const last = rects[rects.length - 1] as Rect;
    const right = last.x + last.w;
    const t = addText(this.scene, 0, 0, '现金', { size: 13, bold: true, color: COLOR.ink, originY: 0.5 });
    const pipsW = pv.total * 12 - 3;
    const w = t.width + pipsW + 30;
    const x = right - w;
    const y = SLOTS_TOP - 36;
    const bg = this.scene.add.rectangle(x, y, w, 24, COLOR.paperHi, 0.94).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, COLOR.ink, 1);
    t.setPosition(x + 10, y + 12);
    const pips = unitPips(this.scene, x + 20 + t.width, y + 7, pv.cash, pv.total, COLOR.gold, 9);
    const hit = this.scene.add.rectangle(x, y, w, 24, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
    bindTooltip(hit, () => ({ x, y, w, h: 24 }), () => ({ title: '还剩几份钱', body: `钱一共分成 ${pv.total} 份（1 份约是账户的四分之一）。买的时候选"试一口"用 1 份、"半仓"用 2 份、"重仓"把剩下的全压上。` }));
    this.cashNode = this.scene.add.container(0, 0, [bg, t, pips, hit]).setDepth(6);
    this.cashRect = { x, y, w, h: 24 };
  }

  /** "现金还剩几份"那块的位置（截图、检查遮挡用）。 */
  cashArea(): Rect | null {
    return this.cashRect;
  }

  /** 进入 / 退出选格子模式（满仓替换、放稀有股票）。 */
  setPicking(mode: PickMode | null): void {
    this.pickMode = mode;
    const hc = holdingCards(this.state);
    this.cards.forEach((c, i) => c.setPick(mode, hc[i] ?? null));
    this.drawHighlight();
  }

  get picking(): boolean {
    return this.pickMode !== null;
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    if (!this.pickMode) return;
    for (const c of this.cards) {
      if (!c.pick) continue;
      g.lineStyle(4, COLOR.accent, 1).strokeRoundedRect(c.rect.x - 4, c.rect.y - 4, c.rect.w + 8, c.rect.h + 8, 14);
    }
  }

  setLocked(locked: boolean): void {
    for (const c of this.cards) c.setLocked(locked);
  }

  card(slot: number): SlotCard | null {
    return this.cards[slot] ?? null;
  }

  rect(slot: number): Rect | null {
    return this.cards[slot]?.rect ?? null;
  }

  count(): number {
    return this.cards.length;
  }

  /** 卡片中心（世界坐标）。 */
  center(slot: number): { x: number; y: number } | null {
    const r = this.rect(slot);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  }

  /** 小人头顶（世界坐标）。 */
  head(slot: number): { x: number; y: number } | null {
    const c = this.cards[slot];
    if (!c) return null;
    if (c.guy) return c.guy.headWorld();
    return { x: c.rect.x + c.rect.w / 2, y: c.rect.y + 30 };
  }

  /** 找持仓里某只股票在哪一格。 */
  slotOf(stockId: string): number {
    return this.cards.findIndex((c) => c.stockId === stockId);
  }

  /**
   * ② 揭晓一格：小人弹跳或发抖、换表情、头顶弹出涨跌幅、「今日」数字滚到 shown。
   * role 用来取涨跌停幅度（ST 只有 ±5%）。
   */
  reveal(anim: Animator, slot: number, move: number, shown: number, role: keyof typeof BALANCE.roles, flags: { short?: boolean; limitUp: boolean; limitDown: boolean; blown: boolean; jump: number }): void {
    const c = this.cards[slot];
    if (!c) return;
    const face: Face = faceOf(move, BALANCE.roles[role].limit);
    c.guy?.setFace(face);
    if (move > 0.05) c.guy?.bounce(anim, Math.min(1, move / 10));
    else if (move < -0.05) c.guy?.shake(anim, Math.min(1, -move / 10));
    const head = this.head(slot);
    if (head) {
      // 涨跌幅弹在卡片上沿之上（窗外天空的位置），不压住卡上的标签；手机上卡片顶着顶栏，就弹在卡片上半截
      head.y = PHONE ? c.rect.y + 44 : Math.min(head.y, c.rect.y + 2);
      // 浮字和卡上滚到的数字一致（都是这一格这一步的收益）
      // 押跌：股票涨停就是被轧，浮字写"被轧"（数字是这一格的亏损，不是股票的 +10%）
      const label = flags.limitUp ? `${flags.short ? '被轧' : '涨停'} ${pctArrow(shown)}` : flags.limitDown ? `跌停 ${pctArrow(shown)}` : pctArrow(shown);
      floatText(this.scene, anim, head.x, head.y - 4, label, signColor(shown), { size: flags.limitUp || flags.limitDown ? 20 : 18, pop: true, rise: 24, hold: 600, depth: 160 });
      if (flags.blown) floatText(this.scene, anim, head.x, head.y - 26, '没封住！', COLOR.down, { size: 14, pop: true, hold: 500, depth: 161 });
      else if (flags.jump !== 0) floatText(this.scene, anim, head.x, head.y - 26, flags.jump > 0 ? '突然暴涨' : '突然暴跌', signColor(flags.jump), { size: 14, pop: true, hold: 500, depth: 161 });
    }
    void this.rollToday(anim, slot, shown, 360);
  }

  /** 0.5 开盘翻牌：盖着的牌背（按格子） */
  private covers = new Map<number, Phaser.GameObjects.Container>();

  /** 开盘：手里每只股票先盖上牌背（揭晓时一张张翻开）；关掉动画时不盖。 */
  coverAll(anim: Animator): void {
    this.clearCovers();
    if (anim.instant) return;
    for (const c of this.cards) {
      if (!c?.stockId) continue;
      const { x, y, w, h } = c.rect;
      const back = this.scene.add.rectangle(0, 0, w, h, c.short ? 0x3f4a7a : COLOR.accent).setRounded(12).setStrokeStyle(3, COLOR.ink, 1);
      const inner = this.scene.add.rectangle(0, 0, w - 16, h - 16, 0xffffff, 0).setRounded(9).setStrokeStyle(2, 0xffffff, 0.8);
      const q = addText(this.scene, 0, -6, '?', { size: 56, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const sub = addText(this.scene, 0, 44, c.short ? '押跌' : '开盘', { size: 14, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
      const node = this.scene.add.container(x + w / 2, y + h / 2, [back, inner, q, sub]).setDepth(40);
      this.covers.set(c.slot, node);
    }
  }

  clearCovers(): void {
    for (const n of this.covers.values()) n.destroy();
    this.covers.clear();
  }

  /**
   * 翻开一格：牌背横向收窄翻走，按档位放特效——大涨冒火、大跌结冰、涨停 / 跌停 / 押对了盖章并震一下。
   * 档位按"这一格对你是赚是亏"分，押跌的格子颜色和特效都反过来。
   */
  flip(anim: Animator, slot: number, tone: FlipTone): void {
    const node = this.covers.get(slot);
    this.covers.delete(slot);
    if (node) {
      if (anim.instant) node.destroy();
      else anim.fx({ targets: node, scaleX: 0, duration: 120, ease: 'Quad.easeIn' }, () => node.destroy());
    }
    const c = this.cards[slot];
    if (!c || anim.instant) return;
    const { x, y, w, h } = c.rect;
    const cx = x + w / 2;
    switch (tone) {
      case 'limitUp':
      case 'shortWin':
        flashBox(this.scene, anim, x - 4, y - 4, w + 8, h + 8, COLOR.gold, 45);
        stamp(this.scene, anim, cx, y + 92, tone === 'limitUp' ? '涨停' : '押对了', true, 900);
        flameBurst(this.scene, anim, cx, y + 120, 12);
        shake(this.scene, anim, 140, 0.004);
        break;
      case 'bigUp':
        flashBox(this.scene, anim, x - 3, y - 3, w + 6, h + 6, COLOR.up, 45);
        flameBurst(this.scene, anim, cx, y + 120, 8);
        break;
      case 'bigDown':
        flashBox(this.scene, anim, x - 3, y - 3, w + 6, h + 6, COLOR.down, 45);
        iceBurst(this.scene, anim, cx, y + 110, 8);
        break;
      case 'limitDown':
      case 'squeezed':
        flashBox(this.scene, anim, x - 4, y - 4, w + 8, h + 8, COLOR.down, 45);
        stamp(this.scene, anim, cx, y + 92, tone === 'limitDown' ? '跌停' : '被轧', false, 900);
        iceBurst(this.scene, anim, cx, y + 110, 12);
        shake(this.scene, anim, 180, 0.006);
        break;
      default:
        break;
    }
  }

  /** 「今日」数字滚到 to（数字再跳一下）。 */
  async rollToday(anim: Animator, slot: number, to: number, ms: number): Promise<void> {
    const c = this.cards[slot];
    if (!c) return;
    const from = c.shownToday;
    await anim.count(from, to, ms, (v) => c.setToday(v));
    if (c.todayLabel) pop(anim, c.todayLabel, 1.3);
  }

  controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    this.cards.forEach((c, i) => {
      out[`card:${i}`] = { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h / 2 };
      if (c.sell?.visible && c.sell.isEnabled()) out[`sell:${i}`] = c.sell.center();
      if (c.pick) out[`slot:${i}`] = c.pick.center();
      if (c.magCenter) out[`detail:${i}`] = c.magCenter;
    });
    return out;
  }

  /** 某格卖出按钮的区域（教程用）；按钮不在时用整张卡。 */
  sellRect(slot: number): Rect | null {
    const c = this.cards[slot];
    if (!c) return null;
    return c.sell?.visible ? c.sell.rect() : c.rect;
  }

  /** 此刻能点的按钮区域。 */
  buttonRects(): Rect[] {
    const out: Rect[] = [];
    for (const c of this.cards) {
      if (c.sell?.visible && c.sell.isEnabled()) out.push(c.sell.rect());
      if (c.pick) out.push(c.pick.rect());
    }
    return [...out, ...this.purseHits];
  }

  /** 按 slot 触发卖出按钮（键盘快捷键）。 */
  pressSell(slot: number): boolean {
    return this.cards[slot]?.sell?.press() ?? false;
  }

  pressPick(slot: number): boolean {
    return this.cards[slot]?.pick?.press() ?? false;
  }

  /** 整个持仓区的范围（引导用）。 */
  area(): Rect {
    const first = this.cards[0]?.rect;
    const last = this.cards[this.cards.length - 1]?.rect;
    if (!first || !last) return { x: 266, y: 232, w: 692, h: 222 };
    return { x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h };
  }
}
