import Phaser from 'phaser';
import {
  BALANCE,
  SIZE_LABEL,
  bankView,
  buyOptions,
  chatView,
  formatMoney,
  formatPoints,
  knowledgeCard,
  positionsView,
  unitsWord,
  validate,
  type Action,
  type BuySize,
  type GameState,
} from '../../core/index.ts';
import type { Animator } from '../fx/anim.ts';
import { addBackdrop, floatText, shake } from '../fx/effects.ts';
import { confetti, sparkles } from '../fx/particles.ts';
import { avatarKey, type Glyph } from '../assets.ts';
import { COLOR, TYPE, arrowOf, signColor } from '../theme.ts';
import { addGlyph, addImage, addPaper } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { Dialog, actionButtons, iconChip, moneyShort } from '../ui/dialog.ts';
import { addText } from '../ui/text.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import { phoneLayout, viewOf } from '../viewport.ts';

/**
 * 0.4 C 的画面：买多少（试一口 / 半仓 / 重仓 / 押跌）、手里这只怎么办（加仓 / 减一半 / 清仓）、银行（押东西借钱）、
 * 以及被轧、银行来电、东西被收走、赎回、点亮小知识的表现。数都从规则层的查询拿，这里只管画。
 */

const SIZES: readonly BuySize[] = ['taste', 'half', 'heavy'];
const SIZE_TIP: Record<BuySize, string> = { taste: '先少买一点', half: '买一半', heavy: '剩下的全压上' };
/** 押跌的颜色：深蓝紫（和普通卡的暖色反过来） */
export const SHORT_COLOR = 0x2e3558;

/** 一排金币（份数）：整份一枚、半份一枚小的；(cx, cy) 为中心。 */
function coins(scene: Phaser.Scene, cx: number, cy: number, units: number, size = 18): Phaser.GameObjects.Container {
  const whole = Math.floor(units + 1e-9);
  const half = units - whole > 0.01;
  const n = whole + (half ? 1 : 0);
  const step = size * 0.78;
  const c = scene.add.container(cx - ((n - 1) * step) / 2, cy);
  for (let i = 0; i < n; i++) c.add(addImage(scene, i * step, 0, 'fx:coin', i === whole ? size * 0.66 : size));
  return c;
}

/** 行首的大箭头标签（押涨 / 押跌）：带悬停说明。 */
function rowHead(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, up: boolean, label: string, tip: TipContent): void {
  const g = addGlyph(scene, x + 20, y + 22, up ? 'arrow_up' : 'arrow_down', 36, up ? COLOR.up : COLOR.down);
  const t = addText(scene, x + 20, y + 52, label, { size: TYPE.label + 1, bold: true, color: up ? COLOR.up : COLOR.down, originX: 0.5 });
  const hit = scene.add.rectangle(x - 4, y - 4, 52, 76, 0xffffff, 0.001).setOrigin(0, 0);
  parent.add([g, t, hit]);
  bindTooltip(hit, () => {
    const m = hit.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty, w: 52, h: 76 };
  }, () => tip);
}

/** 买第 rec 条推荐：三个大按钮（1/2/4 份金币）×「押涨 / 押跌」两行。点一个按钮就买（两步完成）；说明在悬停。 */
export class BuyDialog extends Dialog {
  constructor(scene: Phaser.Scene, s: GameState, rec: number, slot: number | undefined, preferShort: boolean, onPick: (a: Action) => void) {
    const r = chatView(s).recs[rec];
    const opts = buyOptions(s, rec, slot);
    const showShort = opts.short.unlocked;
    const W = 560;
    const H = showShort ? 380 : 240;
    super(scene, W, H, `买「${r?.stock.name ?? ''}」`);
    const pv = positionsView(s);
    const back = slot !== undefined ? (pv.slots[slot]?.units ?? 0) : 0;
    const cash = Math.round((pv.cash + back) * 100) / 100;
    // 右上角：钱包 + 手里还有几份现金（金币）
    const wx = W - 210;
    this.inner.add(addGlyph(scene, wx, 38, 'wallet', 30));
    this.inner.add(coins(scene, wx + 22 + (Math.ceil(cash) * 14) / 2, 38, cash, 18));
    // 0.5.1：金币后面写「剩 N/M 份」，不用悬停也知道
    this.inner.add(addText(scene, wx + 30 + Math.ceil(cash) * 14, 38, `${cash}/${pv.total}`, { size: TYPE.label, bold: true, num: true, color: COLOR.muted, originY: 0.5 }));
    const walletHit = scene.add.rectangle(wx - 18, 20, 130, 36, 0xffffff, 0.001).setOrigin(0, 0);
    this.inner.add(walletHit);
    bindTooltip(walletHit, () => {
      const m = walletHit.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty, w: 130, h: 36 };
    }, () => ({ title: '现金', body: `钱分成 ${pv.total} 份，现在手里还有 ${unitsWord(cash)}现金${slot !== undefined ? '（换掉的那只卖了也算进来）' : ''}` }));
    const row = (y: number, short: boolean, glow: boolean): void => {
      if (glow) this.inner.add(scene.add.rectangle(18, y - 8, W - 36, 120, 0xfff1c4).setOrigin(0, 0).setRounded(14).setStrokeStyle(3, COLOR.gold, 1));
      rowHead(
        scene,
        this.inner,
        30,
        y + 6,
        !short,
        short ? '押跌' : '押涨',
        short
          ? { title: '押跌', body: `它跌你赚，它涨你亏；涨停那天会被轧，亏得最狠${opts.short.hint ? `\n${r?.friend?.name ?? '群友'}说这只要跌，建议押跌` : ''}` }
          : { title: '押涨', body: '普通买入：它涨你赚。试一口不多花钱；一次买得越多，价格被自己抬得越高' },
      );
      SIZES.forEach((size, i) => {
        const o = opts.sizes.find((x) => x.size === size);
        const err = short ? validate(s, { type: 'buy', rec, slot, size, short: true }) : (o?.error ?? null);
        const units = o?.units ?? 0;
        const bw = 140;
        const b = new Button(scene, 94 + i * (bw + 14), y, {
          width: bw,
          height: 80,
          label: SIZE_LABEL[size],
          variant: short ? 'danger' : size === 'heavy' ? 'primary' : 'buy',
          fontSize: TYPE.title + 2,
          hotkey: short ? undefined : `${i + 1}`,
          sound: null,
          onClick: () => {
            this.close();
            onPick({ type: 'buy', rec, slot, size, short: short || undefined });
          },
        });
        // 文字往上挪，下面放金币
        b.list.forEach((ch) => {
          if (ch instanceof Phaser.GameObjects.Text && ch.text === SIZE_LABEL[size]) ch.setY(26);
        });
        if (units > 0) b.add(coins(scene, bw / 2, 56, units, 20));
        b.setEnabled(err === null);
        b.onDenied(() => err);
        const note = o?.note ?? null;
        b.tooltip(() => ({ title: `${short ? '押跌 · ' : ''}${SIZE_LABEL[size]}`, body: `${SIZE_TIP[size]} · ${unitsWord(units)}${note ? `\n${note}` : ''}` }));
        this.inner.add(b);
        this.named[`${short ? 'short' : 'size'}:${size}`] = b;
      });
      // 行下一句短话（0.5 只在悬停里，0.5.1 放回来）
      const tip = short ? (opts.short.hint ? `${r?.friend?.name ?? '群友'}说它要跌 · 涨停那天会被轧` : '它跌你赚，它涨你亏 · 涨停那天会被轧') : '试一口不多花钱 · 买越多，自己把价抬越高';
      this.inner.add(addGlyph(scene, 104, y + 98, short ? 'bear' : 'magnifier', 18));
      this.inner.add(addText(scene, 118, y + 98, tip, { size: TYPE.label - 1, color: short ? SHORT_COLOR : COLOR.muted, originY: 0.5 }));
    };
    row(86, false, false);
    if (showShort) {
      row(232, true, opts.short.hint || preferShort);
      // 群友建议押跌：头像挂在行尾
      if (opts.short.hint && r?.friend) this.inner.add(addImage(scene, 74, 232 + 6, avatarKey(r.friend.id), 30));
    }
    const keys = (e: KeyboardEvent): void => {
      const m = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
      if (m) (this.named[`size:${SIZES[Number(m[1]) - 1]}`] as Button | undefined)?.press();
    };
    scene.input.keyboard?.on('keydown', keys);
    this.once('destroy', () => scene.input.keyboard?.off('keydown', keys));
  }
}

/** 点手里的一只：加仓 / 减一半 / 清仓。 */
export class HoldingMenu extends Dialog {
  constructor(scene: Phaser.Scene, s: GameState, slot: number, onAct: (a: Action) => void) {
    const pv = positionsView(s).slots[slot];
    const W = 560;
    const H = 262;
    super(scene, W, H, pv?.name ?? '');
    if (!pv) return;
    const pct = Math.round(pv.weight * 100);
    // 右上：押跌标记、金币份数、买入以来的箭头数字（说明在悬停）
    let hx = W - 70;
    const ret = addText(scene, hx, 38, `${arrowOf(pv.holdRet)}${formatPoints(Math.abs(pv.holdRet), 1, false)}`, { size: TYPE.title + 2, bold: true, num: true, color: signColor(pv.holdRet), originX: 1, originY: 0.5 });
    this.inner.add(ret);
    hx -= ret.width + 16;
    this.inner.add(coins(scene, hx - (Math.ceil(pv.units) * 14) / 2, 38, pv.units, 18));
    if (pv.short) this.inner.add(addGlyph(scene, hx - Math.ceil(pv.units) * 14 - 30, 38, 'bear', 30));
    const infoHit = scene.add.rectangle(hx - 140, 20, W - 70 - (hx - 140), 36, 0xffffff, 0.001).setOrigin(0, 0);
    this.inner.add(infoHit);
    bindTooltip(infoHit, () => {
      const m = infoHit.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty, w: infoHit.width, h: 36 };
    }, () => ({ title: pv.name, body: `现在压了 ${pv.unitsWord}（约占账户的 ${pct}%），${pv.short ? '押它跌，' : ''}买入以来 ${formatPoints(pv.holdRet)}\n押得越多，赚亏都越大。今天买的明天才能卖。` }));
    const items: [string, string, string, string | null, Action][] = [
      ['add', '加仓', '再买 1 份', pv.addError, { type: 'add', slot }],
      ['trim', '减一半', '先卖一半落袋', pv.trimError, { type: 'trim', slot }],
      ['sell', '清仓', '全部卖掉', pv.sellError, { type: 'sell', slot }],
    ];
    items.forEach(([key, label, sub, err, action], i) => {
      const b = new Button(scene, 30 + i * 172, 90, {
        width: 158,
        height: 64,
        label,
        variant: key === 'add' ? 'buy' : key === 'sell' ? 'danger' : 'default',
        fontSize: TYPE.title + 2,
        hotkey: `${i + 1}`,
        sound: null,
        onClick: () => {
          this.close();
          onAct(action);
        },
      });
      b.setEnabled(err === null);
      b.onDenied(() => err);
      b.tooltip(() => ({ title: label, body: sub }));
      this.inner.add(b);
      // 按钮下写一句它干什么（0.5.1 找回）
      this.inner.add(addText(scene, 30 + i * 172 + 79, 162, err ?? sub, { size: TYPE.label - 1, color: err ? COLOR.dim : COLOR.muted, originX: 0.5 }));
      this.named[`hold:${key}`] = b;
    });
    // 占账户多少：一条小比例条 + 百分数（0.5 只在悬停）
    const barW = W - 60 - 140;
    this.inner.add(addText(scene, 30, 196, `占账户 ${pct}%`, { size: TYPE.label, bold: true, color: COLOR.ink, originY: 0.5 }));
    this.inner.add(scene.add.rectangle(140, 190, barW, 12, COLOR.paperLo).setOrigin(0, 0).setRounded(6).setStrokeStyle(1.5, COLOR.edge, 1));
    this.inner.add(scene.add.rectangle(140, 190, Math.max(6, (barW * Math.min(100, pct)) / 100), 12, pv.short ? SHORT_COLOR : COLOR.accent).setOrigin(0, 0).setRounded(6));
    const keys = (e: KeyboardEvent): void => {
      const m = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
      if (m) (this.named[`hold:${items[Number(m[1]) - 1]?.[0]}`] as Button | undefined)?.press();
    };
    scene.input.keyboard?.on('keydown', keys);
    this.once('destroy', () => scene.input.keyboard?.off('keydown', keys));
  }
}

/** 抵押物的小图标。 */
const COLLATERAL_GLYPH: Record<string, Glyph> = { bracelet: 'gift', car: 'bag', house: 'house', pension: 'wallet' };

/** 银行：押东西借钱、还钱赎回。四个数字格只留标签，规则在「?」提示里。 */
export class BankPanel extends Dialog {
  constructor(scene: Phaser.Scene, s: GameState, onAct: (a: Action) => void) {
    const b = bankView(s);
    const ph = phoneLayout(scene);
    // 手机（0.5.5）摆成两栏：左栏账本、规则、安全线；右栏可以押 / 已押出。一栏竖排放不进 444 高
    // 0.19.0 手机世界变小（718–960×404）：窄了两栏都收窄、利息挪进按钮的悬停；矮了行距收紧
    const V = viewOf(scene);
    const narrow = ph && V.w < 900;
    const short = ph && V.h < 420;
    const W = ph ? Math.min(940, V.w - 16) : 720;
    const L0 = 24;
    const LW = ph ? (narrow ? 316 : 400) : W - 48;
    const R0 = ph ? (narrow ? 352 : 450) : 24;
    const RW = W - 24 - R0;
    const step = ph ? (short ? 42 : 48) : 54;
    const lineH = ph ? (short ? 36 : 42) : 46;
    const rows = b.open ? Math.max(1, b.offers.length) + Math.max(1, b.loans.length) : 0;
    // 0.5.1：账本下加一条「安全线」小图（欠钱时）或「没欠钱」签，再加一条规则小纸条；押东西两段各有小标题
    const H = ph
      ? Math.max(76 + 92 + 44 + (b.callAt !== null ? 90 : 44) + (b.open ? 0 : 100), b.open ? 76 + 48 + rows * step : 0) + 64
      : (b.open ? 236 + rows * 54 + 48 : 300) + (b.callAt !== null ? 64 : 44) + 44;
    super(scene, W, ph ? Math.min(H, V.h - 12) : H, '银行');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.inner.add(o);
      return o;
    };
    // 标题旁：银行图标 + 「?」规则
    add(addGlyph(scene, 100, 38, 'bank', 34));
    const q = add(scene.add.circle(140, 38, 13, COLOR.info).setStrokeStyle(2, COLOR.ink, 1));
    add(addText(scene, 140, 38, '?', { size: TYPE.label + 2, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 }));
    q.setInteractive({ useHandCursor: true });
    bindTooltip(q, () => {
      const m = q.getWorldTransformMatrix();
      return { x: m.tx - 13, y: m.ty - 13, w: 26, h: 26 };
    }, () => ({ title: '押东西借钱', body: b.rule }));
    // 账本：四个数字格
    const boxY = 76;
    add(scene.add.rectangle(L0, boxY, LW, 76, b.called ? 0xffe2dc : COLOR.paperLo).setOrigin(0, 0).setRounded(12).setStrokeStyle(2, b.called ? COLOR.danger : COLOR.edge, 1));
    const cells: [string, string, number][] = [
      ['账户', moneyShort(b.account), COLOR.ink],
      ['欠银行', moneyShort(b.debt), b.debt > 0 ? COLOR.danger : COLOR.ink],
      ['自己的钱', moneyShort(b.net), b.net >= 0 ? COLOR.ink : COLOR.danger],
      ['月息', moneyShort(b.monthlyInterest), b.monthlyInterest > 0 ? COLOR.danger : COLOR.ink],
    ];
    const cw = LW / 4;
    cells.forEach(([k, v, c], i) => {
      const x = L0 + i * cw + cw / 2;
      add(addText(scene, x, boxY + 12, k, { size: TYPE.label, color: COLOR.muted, originX: 0.5 }));
      add(addText(scene, x, boxY + 32, v, { size: narrow ? TYPE.title : TYPE.big - 4, bold: true, num: true, color: c, originX: 0.5 }));
    });
    let y = boxY + 92;
    // 规则小纸条（0.5 只在「?」里，0.5.1 放回卡面，一行图标 + 两句）
    add(scene.add.rectangle(L0, y, LW, 36, 0xfff6dc).setOrigin(0, 0).setRounded(10).setStrokeStyle(1.5, COLOR.edge, 1));
    add(addGlyph(scene, 44, y + 18, 'book', 22));
    add(addText(scene, 62, y + 18, '押东西借钱，赚亏都放大；月底另付利息', { size: TYPE.label, color: COLOR.ink, originY: 0.5 }));
    y += 44;
    // 欠钱时：来电线 / 收走线（图标 + 数字）+ 安全线小图：账户离来电、收走还有多远
    if (b.callAt !== null && b.seizeAt !== null) {
      // 手机上安全线另起一行，放在两枚胶囊下面
      const bx = ph ? L0 + 10 : 300;
      const bw = ph ? LW - 20 : W - 24 - bx - 8;
      const cy = y;
      if (ph) y += 40;
      const top = Math.max(b.account, b.callAt) * 1.15;
      const px = (v: number): number => bx + Math.max(0, Math.min(1, v / top)) * bw;
      const g = add(scene.add.graphics());
      g.fillStyle(COLOR.paperLo, 1).fillRoundedRect(bx, y + 14, bw, 12, 6);
      g.fillStyle(COLOR.danger, 0.35).fillRoundedRect(bx, y + 14, px(b.seizeAt) - bx, 12, 6);
      g.fillStyle(0xf3a54a, 0.35).fillRect(px(b.seizeAt), y + 14, px(b.callAt) - px(b.seizeAt), 12);
      g.lineStyle(2, COLOR.ink, 1).strokeRoundedRect(bx, y + 14, bw, 12, 6);
      const mark = add(addGlyph(scene, px(b.account), y + 8, 'wallet', 22));
      add(addText(scene, px(b.account), y + 30, moneyShort(b.account), { size: 11, bold: true, num: true, color: b.called ? COLOR.danger : COLOR.ink, originX: 0.5 }));
      if (b.called) scene.tweens.add({ targets: mark, y: y + 4, duration: 300, yoyo: true, repeat: -1 });
      const call = iconChip(scene, L0, cy, 'horn', `${moneyShort(b.callAt)} 来电`, { color: b.called ? COLOR.danger : COLOR.ink, fill: b.called ? 0xffe2dc : COLOR.paperHi, tip: { title: '银行打电话', body: `账户跌到 ${formatMoney(b.callAt)}，银行会打电话${b.called ? '（已经打过了！）' : ''}` } });
      const seize = iconChip(scene, L0 + call.w + 10, cy, 'hourglass', `${moneyShort(b.seizeAt)} 收走`, { color: COLOR.danger, tip: { title: '收走东西', body: `账户跌到 ${formatMoney(b.seizeAt)}，押的东西就被收走` } });
      add(call.node);
      add(seize.node);
      y += 50;
    } else {
      // 没欠钱：一枚安心签
      const calm = iconChip(scene, 24, y, 'face_calm', '没欠钱，不怕来电', { color: COLOR.ink, fill: COLOR.paperHi, tip: { title: '银行打电话', body: '欠了钱、账户又跌得太多时，银行会打电话；再跌就收走押的东西' } });
      add(calm.node);
      y += 44;
    }
    if (!b.open) {
      add(addGlyph(scene, L0 + LW / 2 - 70, y + 50, 'hourglass', 40));
      add(addText(scene, L0 + LW / 2 - 42, y + 50, `${b.openMonth}月开门`, { size: TYPE.big, bold: true, color: COLOR.muted, originY: 0.5 }));
    }
    if (b.open) {
      if (ph) y = boxY;
      const mid = lineH / 2;
      // 一行里各段的横坐标：名字、金额、利息、按钮（手机栏窄，借款月份只放在悬停里）
      // 金额那一列跟着最长的名字走（「老婆的金镯子」在手机的窄栏里会压到金额）
      const nameW = Math.max(0, ...[...b.offers, ...b.loans].map((o) => {
        const t = addText(scene, 0, 0, o.name, { size: TYPE.title - 2, bold: true });
        const w = t.width;
        t.destroy();
        return w;
      }));
      const amtX = ph ? Math.max(R0 + 112, R0 + 48 + nameW + 12) : 300;
      const intX = ph ? amtX + 74 : 400;
      // 窄屏上不写「息…/月」（按钮的悬停里有）
      const showInt = !narrow;
      const btnW = ph ? 108 : 120;
      const btnX = R0 + RW - 16 - btnW;
      const btnY = (lineH - 34) / 2;
      const line = (yy: number, fill: number, stroke: number, glyph: Glyph, name: string, dim: boolean): void => {
        add(scene.add.rectangle(R0, yy, RW, lineH, fill).setOrigin(0, 0).setRounded(12).setStrokeStyle(1.5, stroke, 1));
        add(addGlyph(scene, R0 + 24, yy + mid, glyph, 30)).setAlpha(dim ? 0.4 : 1);
        add(addText(scene, R0 + 48, yy + mid, name, { size: TYPE.title - 2, bold: true, color: dim ? COLOR.dim : COLOR.ink, originY: 0.5 }));
      };
      const section = (yy: number, glyph: Glyph, label: string): void => {
        add(addGlyph(scene, R0 + 12, yy + 10, glyph, 18));
        add(addText(scene, R0 + 26, yy + 10, label, { size: TYPE.label, bold: true, color: COLOR.muted, originY: 0.5 }));
      };
      section(y, 'bag', '可以押');
      y += 24;
      for (const o of b.offers) {
        line(y, COLOR.paperHi, COLOR.edge, COLLATERAL_GLYPH[o.id] ?? 'bag', o.name, o.lost);
        add(addText(scene, amtX, y + mid, moneyShort(o.amount, true), { size: TYPE.title + 2, bold: true, num: true, color: o.lost ? COLOR.dim : COLOR.up, originY: 0.5 }));
        if (showInt) add(addText(scene, intX, y + mid, `息${moneyShort(o.interest)}/月`, { size: TYPE.label + 1, num: true, color: COLOR.muted, originY: 0.5 }));
        if (o.error) add(addText(scene, R0 + RW - 16, y + mid, o.lost ? '被收走了' : o.error, { size: TYPE.label, color: COLOR.dim, originX: 1, originY: 0.5, wrap: ph ? RW - ((showInt ? intX : amtX + 60) - R0) - 20 : 180 }));
        else {
          const btn = new Button(scene, btnX, y + btnY, { width: btnW, height: 34, label: '押给银行', variant: 'primary', fontSize: TYPE.label + 2, sound: null, onClick: () => (this.close(), onAct({ type: 'borrow', id: o.id })) });
          btn.tooltip(() => ({ title: o.name, body: `借 ${formatMoney(o.amount)} · 每月利息 ${formatMoney(o.interest)}` }));
          add(btn);
          this.named[`bank:borrow:${o.id}`] = btn;
        }
        y += step;
      }
      if (b.offers.length === 0) y += step;
      section(y, 'bank', '已押出');
      y += 24;
      for (const l of b.loans) {
        line(y, 0xfff1c4, COLOR.gold, COLLATERAL_GLYPH[l.id] ?? 'bag', l.name, false);
        add(addText(scene, amtX, y + mid, moneyShort(-l.amount), { size: TYPE.title + 2, bold: true, num: true, color: COLOR.down, originY: 0.5 }));
        if (showInt) add(addText(scene, intX, y + mid, `息${moneyShort(l.interest)}/月`, { size: TYPE.label + 1, num: true, color: COLOR.muted, originY: 0.5 }));
        if (!ph) {
          add(addGlyph(scene, 494, y + 23, 'calendar', 18));
          add(addText(scene, 506, y + 23, `${l.month}月借`, { size: TYPE.label, color: COLOR.muted, originY: 0.5 }));
        }
        const btn = new Button(scene, btnX, y + btnY, { width: btnW, height: 34, label: '还钱赎回', variant: 'buy', fontSize: TYPE.label + 2, sound: null, onClick: () => (this.close(), onAct({ type: 'repay', id: l.id })) });
        btn.setEnabled(l.repayError === null);
        btn.onDenied(() => l.repayError);
        btn.tooltip(() => ({ title: l.name, body: `借了 ${formatMoney(l.amount)}（${l.month}月借的）· 每月利息 ${formatMoney(l.interest)}` }));
        add(btn);
        this.named[`bank:repay:${l.id}`] = btn;
        y += step;
      }
      if (b.loans.length === 0) {
        // 空位：虚线框 + 淡淡的包 + 一句
        const g = add(scene.add.graphics());
        g.lineStyle(2, COLOR.edge, 1);
        for (let dx = R0; dx < R0 + RW; dx += 14) g.lineBetween(dx, y, Math.min(dx + 7, R0 + RW), y).lineBetween(dx, y + lineH, Math.min(dx + 7, R0 + RW), y + lineH);
        add(addGlyph(scene, R0 + RW / 2 - 60, y + mid, 'bag', 26)).setAlpha(0.4);
        add(addText(scene, R0 + RW / 2 - 40, y + mid, '还没押东西', { size: TYPE.label + 1, color: COLOR.dim, originY: 0.5 }));
      }
    }
    this.actions(null, { label: '关闭', hotkey: 'Esc', name: 'bank:close', onClick: () => this.close() });
  }
}

/** 手机图标（程序画）：圆角机身、屏幕、上面写"银行"。 */
function phoneIcon(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(COLOR.ink, 1).fillRoundedRect(-30, -52, 60, 104, 12);
  g.fillStyle(0xbfe3ff, 1).fillRoundedRect(-24, -40, 48, 72, 6);
  g.fillStyle(COLOR.white, 1).fillCircle(0, 42, 5);
  const t = addText(scene, 0, -8, '银行', { size: 16, bold: true, color: COLOR.danger, originX: 0.5, originY: 0.5 });
  const t2 = addText(scene, 0, 14, '来电', { size: 12, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5 });
  // 震动波纹
  const w = scene.add.graphics();
  w.lineStyle(4, COLOR.danger, 1);
  for (const r of [44, 58]) {
    w.beginPath().arc(0, 0, r, -0.6, 0.6).strokePath();
    w.beginPath().arc(0, 0, r, Math.PI - 0.6, Math.PI + 0.6).strokePath();
  }
  return scene.add.container(x, y, [w, g, t, t2]);
}

/** 弹出的大卡片（银行来电、东西被收走）：遮罩 + 纸卡 + 大标题 + 大数字 + 一行 + 一个按钮；返回容器和按钮。 */
function bigCard(scene: Phaser.Scene, title: string, big: string, line: string, color: number, btnLabel: string, onOk: () => void, tip?: TipContent): { root: Phaser.GameObjects.Container; button: Button; card: Rect2 } {
  const W = 520;
  const H = 280;
  const V = viewOf(scene);
  const x = (V.w - W) / 2;
  const y = (V.h - H) / 2 - (phoneLayout(scene) ? 0 : 20);
  const back = addBackdrop(scene, 0.45);
  const paper = addPaper(scene, x, y, W, H);
  const band = scene.add.rectangle(x + 6, y + 6, W - 12, 8, color).setOrigin(0, 0).setRounded(4);
  const head = addText(scene, x + 170, y + 36, title, { size: TYPE.big, bold: true, color });
  const num = addText(scene, x + 170, y + 84, big, { size: TYPE.big + 8, bold: true, num: true, color: COLOR.ink });
  const t = addText(scene, x + 170, y + 140, line, { size: TYPE.label + 2, color: COLOR.muted, wrap: W - 200, lineSpacing: 4 });
  const root = scene.add.container(0, 0, [back, paper, band, head, num, t]).setDepth(250);
  if (tip) {
    const hit = scene.add.rectangle(x + 160, y + 30, W - 180, 150, 0xffffff, 0.001).setOrigin(0, 0);
    root.add(hit);
    bindTooltip(hit, () => ({ x: x + 160, y: y + 30, w: W - 180, h: 150 }), () => tip);
  }
  const btns = scene.add.container(x, y);
  root.add(btns);
  const button = actionButtons(scene, btns, W - 28, H - 22, { label: btnLabel, hotkey: '空格', onClick: onOk }).primary as Button;
  return { root, button, card: { x, y, w: W, h: H } };
}

interface Rect2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 银行来电：手机晃个不停 + 欠款大数字 + 一句，点"知道了"继续。 */
export function bankCallCard(scene: Phaser.Scene, anim: Animator, debt: number, onOk: () => void): { root: Phaser.GameObjects.Container; button: Button } {
  const c = bigCard(scene, '银行来电！', `欠${moneyShort(debt)}`, '再亏，押的东西就要收走', COLOR.danger, '知道了', onOk, {
    title: '银行来电',
    body: `"您好，您的账户快不够还欠我们的 ${formatMoney(debt)} 了。再亏下去，押在我们这儿的东西就要收走了哦。"\n可以卖掉一些，或者去银行还钱。`,
  });
  const phone = phoneIcon(scene, c.card.x + 86, c.card.y + 130);
  c.root.add(phone);
  if (!anim.calm) scene.tweens.add({ targets: phone, angle: { from: -12, to: 12 }, duration: 70, yoyo: true, repeat: -1 });
  shake(scene, anim, 260, 0.005);
  return c;
}

/** 收东西的原因（0.5.4）：付完账单 / 当天亏完，账户剩多少，跌破了哪条线。 */
interface SeizeWhy {
  cause: 'trade' | 'bill';
  /** 收之前的账户 */
  account: number;
  line: number;
  debt: number;
}

/**
 * 东西被收走：大字 + 银行拿回多少 + 为什么被收（试玩反馈：持仓涨了，一付账单车就没了，看不出因果）。
 * 收走那件的台词放进悬停说明。
 */
export function seizedCard(scene: Phaser.Scene, anim: Animator, name: string, flavor: string, amount: number, penalty: number, why: SeizeWhy | null, onOk: () => void): { root: Phaser.GameObjects.Container; button: Button } {
  const reason = why ? `${why.cause === 'bill' ? '付完月底账单' : '今天亏完'}，账户只剩 ${moneyShort(why.account)}，跌破了收东西的线 ${moneyShort(why.line)}` : flavor;
  const c = bigCard(scene, `${name}没了！`, moneyShort(-(amount + penalty)), reason, COLOR.danger, '知道了', onOk, {
    title: `${name}被收走了`,
    body: `${why ? `收东西的线 = 欠银行的 ${formatMoney(why.debt)} × ${BALANCE.ext.seizeLine}。${why.cause === 'bill' ? '股票赚的钱付账单用掉了，' : ''}账户跌到这条线以下，银行就收走借得最多的那件。\n` : ''}银行拿回借的 ${formatMoney(amount)}${penalty > 0 ? `，另外罚了 ${formatMoney(penalty)}` : ''}。\n${flavor}`,
  });
  // 左边一个大大的红色"收"字印章
  const stamp = scene.add.container(c.card.x + 86, c.card.y + 140).setAngle(-12);
  const ring = scene.add.graphics().lineStyle(6, COLOR.danger, 1).strokeCircle(0, 0, 56).lineStyle(2, COLOR.danger, 1).strokeCircle(0, 0, 46);
  stamp.add([ring, addText(scene, 0, 0, '收', { size: 52, bold: true, color: COLOR.danger, originX: 0.5, originY: 0.5 })]);
  c.root.add(stamp);
  if (!anim.calm) {
    stamp.setScale(2.2).setAlpha(0);
    anim.fx({ targets: stamp, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
  }
  shake(scene, anim, 360, 0.01);
  return c;
}

/** 被轧：屏幕抖 + 红色闪几下 + 大字"被轧了！"。 */
export function squeezeFx(scene: Phaser.Scene, anim: Animator, x: number, y: number, name: string): void {
  shake(scene, anim, 480, 0.014);
  if (anim.instant) return;
  const V = viewOf(scene);
  const ph = phoneLayout(scene);
  const red = scene.add.rectangle(0, 0, V.w, V.h, COLOR.danger, 0).setOrigin(0, 0).setDepth(175);
  anim.fx({ targets: red, fillAlpha: { from: 0, to: 0.32 }, duration: 140, yoyo: true, repeat: 2 }, () => red.destroy());
  const big = addText(scene, V.w / 2, ph ? 130 : 196, '被轧了！', { size: 64, bold: true, color: COLOR.danger, originX: 0.5, originY: 0.5, stroke: 0xffffff, strokeWidth: 10 }).setDepth(180);
  const sub = addText(scene, V.w / 2, ph ? 184 : 252, `${name}涨停，押跌亏大了`, { size: 20, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5, stroke: 0xffffff, strokeWidth: 6 }).setDepth(180);
  big.setScale(0.3);
  anim.fx({ targets: big, scale: 1, duration: 220, ease: 'Back.easeOut' });
  anim.fx({ targets: [big, sub], alpha: 0, delay: 1500, duration: 300 }, () => {
    big.destroy();
    sub.destroy();
  });
  floatText(scene, anim, x, y, '它涨停了…', COLOR.danger, { size: 16, pop: true, hold: 700, depth: 162 });
}

/** 赎回来了：彩带 + 大字。 */
export function redeemFx(scene: Phaser.Scene, anim: Animator, name: string): void {
  confetti(scene, anim);
  const V = viewOf(scene);
  const ph = phoneLayout(scene);
  sparkles(scene, anim, V.w / 2, ph ? 150 : 230, 16);
  floatText(scene, anim, V.w / 2, ph ? 166 : 250, `${name}赎回来了！`, COLOR.accentDark, { size: 34, pop: true, hold: 1200, depth: 180 });
}

/**
 * 点亮小知识：顶栏下面滑出一张小卡"点亮小知识：xxx"，几秒后自己收起（关掉动画时一直留到下一次操作）。
 * 返回卡片（画面重建时销毁）。
 */
export function knowledgeToast(scene: Phaser.Scene, anim: Animator, ids: readonly string[]): Phaser.GameObjects.Container | null {
  if (ids.length === 0) return null;
  const names = ids.map((id) => knowledgeCard(id).name).join('、');
  const first = knowledgeCard(ids[0] as string);
  const t1 = addText(scene, 0, 0, `点亮：${names}`, { size: TYPE.title, bold: true, color: COLOR.ink });
  // 0.5：小知识正文留在图鉴里，这里只写一句（短的才写）
  const t2 = addText(scene, 0, 0, first.text.length <= 18 ? first.text : '', { size: TYPE.label, color: COLOR.muted, wrap: 380 });
  const w = Math.max(t1.width, t2.width) + 86;
  const h = t1.height + (t2.text ? t2.height + 4 : 0) + 24;
  // 手机上居中会压住账单卡的标题：贴到右上角
  const ph = phoneLayout(scene);
  const x = ph ? viewOf(scene).w - w - 12 : viewOf(scene).w / 2 - w / 2;
  const y = ph ? 8 : 72;
  const bg = scene.add.rectangle(x, y, w, h, 0xfffbe8).setOrigin(0, 0).setRounded(14).setStrokeStyle(3, COLOR.gold, 1);
  // 小灯泡
  const bulb = scene.add.graphics();
  bulb.fillStyle(COLOR.gold, 1).fillCircle(x + 34, y + h / 2 - 4, 15);
  bulb.fillStyle(COLOR.muted, 1).fillRoundedRect(x + 27, y + h / 2 + 9, 14, 8, 2);
  bulb.lineStyle(2.5, COLOR.ink, 1).strokeCircle(x + 34, y + h / 2 - 4, 15);
  t1.setPosition(x + 62, y + 12);
  t2.setPosition(x + 62, y + 16 + t1.height);
  const root = scene.add.container(0, 0, [bg, bulb, t1, t2]).setDepth(240);
  if (!anim.instant) {
    root.setAlpha(0).setY(-20);
    anim.fx({ targets: root, alpha: 1, y: 0, duration: 260, ease: 'Back.easeOut' });
    scene.time.delayedCall(3400, () => {
      if (!root.active) return;
      scene.tweens.add({ targets: root, alpha: 0, duration: 300, onComplete: () => root.destroy() });
    });
  }
  return root;
}

/** 押跌小人头上的墨镜（程序画，墨镜盖在头顶下方一点）。 */
export function sunglasses(scene: Phaser.Scene, x: number, y: number, w: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const lw = w * 0.36;
  const lh = w * 0.2;
  g.fillStyle(0x15161c, 1);
  g.fillRoundedRect(-w / 2, -lh / 2, lw, lh, lh * 0.4);
  g.fillRoundedRect(w / 2 - lw, -lh / 2, lw, lh, lh * 0.4);
  g.fillRect(-w / 2 + lw - 2, -lh * 0.2, w - lw * 2 + 4, lh * 0.22);
  g.fillStyle(0xffffff, 0.55).fillRect(-w / 2 + lw * 0.2, -lh * 0.25, lw * 0.25, lh * 0.18);
  g.fillRect(w / 2 - lw * 0.8, -lh * 0.25, lw * 0.25, lh * 0.18);
  return g;
}

/** 份数的小方块（持仓卡、顶上"现金还剩几份"用）：实心是这一格压的份数。 */
export function unitPips(scene: Phaser.Scene, x: number, y: number, units: number, total: number, fill: number, size = 9): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  for (let i = 0; i < total; i++) {
    const v = Math.max(0, Math.min(1, units - i));
    const px = i * (size + 3);
    g.fillStyle(0xffffff, 0.9).fillRoundedRect(px, 0, size, size, 2);
    if (v > 0) g.fillStyle(fill, 1).fillRoundedRect(px, 0, size * v, size, 2);
    g.lineStyle(1.5, COLOR.ink, 0.8).strokeRoundedRect(px, 0, size, size, 2);
  }
  return g;
}

/** 一枚筹码的样子（持仓卡左下的筹码堆）。 */
export function chipStack(scene: Phaser.Scene, x: number, bottom: number, units: number, fill: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y: bottom });
  const n = Math.ceil(units * 2 - 1e-9) / 2;
  const whole = Math.floor(n + 1e-9);
  const half = n - whole > 0.01;
  const ch = 7;
  let k = 0;
  const chip = (w: number): void => {
    const y = -(k + 1) * (ch + 1);
    g.fillStyle(fill, 1).fillRoundedRect(-w / 2, y, w, ch, 3);
    g.lineStyle(1.5, COLOR.ink, 1).strokeRoundedRect(-w / 2, y, w, ch, 3);
    g.fillStyle(0xffffff, 0.7).fillRect(-w / 2 + 4, y + 2, 4, 3);
    k += 1;
  };
  for (let i = 0; i < whole; i++) chip(22);
  if (half) chip(12);
  return g;
}
