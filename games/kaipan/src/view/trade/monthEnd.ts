import Phaser from 'phaser';
import { formatMoney, fx, itemView, rewardView, validate, type CalendarView, type EventView, type GameState, type RewardView } from '../../core/index.ts';
import { avatarKey, hasArt, itemKey } from '../assets.ts';
import type { Animator } from '../fx/anim.ts';
import { addBackdrop, shake } from '../fx/effects.ts';
import { sparkles } from '../fx/particles.ts';
import { EVENT_ORDER, eventOptionForKey, shortItemName } from '../labels.ts';
import { isTouch } from '../input.ts';
import { sound } from '../sound.ts';
import { ROLE_WORD } from '../glossary.ts';
import { COLOR, ITEM_KIND_COLOR, RARITY_COLOR, THEME_COLOR, TYPE, signColor, textOn } from '../theme.ts';
import { addGlyph, addImage, addPaper, addPill } from '../ui/art.ts';
import { actionButtons, iconChip, moneyShort } from '../ui/dialog.ts';
import { extraChip } from './tempoFx.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { Button } from '../ui/button.ts';
import { StockGuy } from '../ui/stockGuy.ts';
import { addText } from '../ui/text.ts';
import { phoneLayout, viewOf } from '../viewport.ts';

const DEPTH = 200;

/** 浮层：遮罩 + 内容，统一深度，销毁时一起走。 */
function overlay(scene: Phaser.Scene, dim = 0.45): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(DEPTH);
  c.add(addBackdrop(scene, dim));
  return c;
}

interface BillInfo {
  month: number;
  name: string;
  amount: number;
  before: number;
  after: number;
  paid: boolean;
  credit: boolean;
  /** 突发账单明细（总额已含在 amount 里） */
  extras: { name: string; amount: number }[];
  /** 0.4 C：月供之外另付给银行的利息（没借钱为缺省） */
  interest?: number;
}

/**
 * 月底账单：账单卡滑入，盖「已还清」或「逾期」章；信用卡代还单独提示。
 * 返回浮层，由调用方决定停留多久后销毁。
 */
export async function playBill(scene: Phaser.Scene, anim: Animator, b: BillInfo): Promise<Phaser.GameObjects.Container> {
  const c = overlay(scene);
  const W = 320;
  const H = 400;
  const V = viewOf(scene);
  const ph = phoneLayout(scene);
  // 手机上高度只够放下账单本身：卡片往左挪一点，印章和信用卡提示放在右边
  const x = Math.round(V.w / 2 - W / 2 - (ph ? 90 : 0));
  const y = ph ? Math.round((V.h - H) / 2) : 150;
  const card = scene.add.container(x, y);
  card.add(addImage(scene, W / 2, H / 2, 'ui:bill_card', W, H));
  card.add(addText(scene, 190, 42, `${b.month}月账单`, { size: 24, bold: true, originX: 0.5, originY: 0.5 }));
  const row = (ty: number, k: string, v: string, color: number = COLOR.ink): void => {
    const value = addText(scene, W - 30, ty, v, { size: 16, bold: true, color, originX: 1 });
    // 突发账单的名目可能很长：在金额左边折行，字号也小一号
    const room = W - 30 - value.width - 34 - 12;
    const label = addText(scene, 34, ty, k, { size: 15, color: COLOR.muted });
    if (label.width > room) {
      label.destroy();
      card.add(addText(scene, 34, ty - 2, k, { size: 13, color: COLOR.muted, wrap: room, lineSpacing: 1 }));
    } else card.add(label);
    card.add(value);
  };
  const extra = b.extras.reduce((n, e) => n + e.amount, 0);
  const rows: [string, string, number?][] = [[b.name, formatMoney(b.amount - extra)]];
  for (const e of b.extras.slice(0, 3)) rows.push([e.name, formatMoney(e.amount), COLOR.danger]);
  if (b.extras.length > 0) rows.push(['一共要还', formatMoney(b.amount)]);
  if (b.interest && b.interest > 0) rows.push(['利息', formatMoney(b.interest), COLOR.danger]);
  rows.push(['还前账户', formatMoney(b.before), COLOR.muted]);
  // 这笔账单吃掉账户的几成：保守打法被账单慢慢放血时一眼看得出来（也补上收据中间那行空线）
  if (b.before > 0 && rows.length < 4) rows.push(['占账户', `${Math.min(999, Math.round((b.amount / b.before) * 100))}%`, b.amount > b.before ? COLOR.danger : COLOR.muted]);
  const step = rows.length <= 3 ? 44 : Math.floor(170 / rows.length);
  rows.forEach(([k, v, color], i) => row(98 + i * step, k, v, color));
  const totalLabel = b.paid ? (b.credit ? `${itemView('credit').name}垫上了` : '剩下') : '还差';
  const totalValue = b.paid ? formatMoney(b.after) : formatMoney(b.amount - b.before);
  card.add(addText(scene, 40, 308, totalLabel, { size: 15, color: COLOR.muted, originY: 0.5 }));
  card.add(addText(scene, W - 40, 308, totalValue, { size: 24, bold: true, color: b.paid ? COLOR.ink : COLOR.danger, originX: 1, originY: 0.5 }));
  c.add(card);
  sound.cue({ type: 'bill' });
  if (!anim.instant) {
    card.x = V.w + 20;
    await anim.count(V.w + 20, x, 420, (v) => card.setX(v), 'Back.easeOut');
  }
  await anim.wait(250);
  // 印章
  // 印章盖在账单右边（压一点卡边，不压数字）
  const stamp = scene.add.container(x + W + (b.paid ? 64 : 100), y + 150).setAngle(-14);
  if (b.paid) {
    stamp.add(addImage(scene, 0, 0, 'ui:stamp_paid', 160));
    stamp.add(addText(scene, 0, -5, '还上了', { size: 30, bold: true, color: 0xd8342c, originX: 0.5, originY: 0.5 }));
  } else {
    stamp.add(addImage(scene, 0, 0, 'ui:stamp_overdue', 220, 110));
    stamp.add(addText(scene, 0, 0, '没还上', { size: 44, bold: true, color: 0x5a2a6a, originX: 0.5, originY: 0.5 }));
  }
  c.add(stamp);
  sound.cue({ type: 'stamp', paid: b.paid, credit: b.credit });
  if (!anim.instant) {
    stamp.setScale(anim.calm ? 1.15 : 2.4).setAlpha(0);
    await anim.count(0, 1, anim.calm ? 160 : 240, (t) => stamp.setScale((anim.calm ? 1.15 : 2.4) - t * (anim.calm ? 0.15 : 1.4)).setAlpha(t), 'Cubic.easeIn');
    shake(scene, anim, 180, 0.006);
  }
  stamp.setScale(1).setAlpha(1);
  if (b.credit) {
    const nx = ph ? x + W + 150 : V.w / 2;
    const ny = ph ? y + 300 : y + H + 26;
    const note = addText(scene, nx, ny, `${itemView('credit').name}垫上了 · 下月账单×${fx('credit', 'nextBillMult')}`, { size: 16, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 });
    if (ph) note.setWordWrapWidth(220, true).setAlign('center');
    const pill = ph
      ? addPill(scene, nx - note.width / 2 - 16, ny - note.height / 2 - 8, note.width + 32, note.height + 16, COLOR.info)
      : addPill(scene, nx - note.width / 2 - 16, y + H + 10, note.width + 32, 32, COLOR.info);
    c.add([pill, note]);
  }
  return c;
}

/** 稀有度：几颗星（常见 1、少见 2、稀有 3）。 */
const RARITY_STARS: Record<string, number> = { common: 1, uncommon: 2, rare: 3 };

/** 奖励卡卡面上各行的纵坐标（相对卡顶）：手机上卡矮 42，图标小一号、各行往上收 */
const CARD_LAYOUT = {
  desktop: { icon: 98, iconS: 96, name: 160, big: 208 },
  phone: { icon: 84, iconS: 80, name: 136, big: 180 },
} as const;

/** 三选一奖励卡（phase = reward 时常驻，直到选择）：稀有度色框 + 大图标 + 名字 + 大数字 + 一行；详情悬停。 */
export class RewardPanel {
  readonly root: Phaser.GameObjects.Container;
  private readonly buttons: Button[] = [];
  private readonly skip: Button;
  private readonly box: { x: number; y: number; w: number; h: number };

  constructor(scene: Phaser.Scene, s: GameState, anim: Animator, idle: boolean, onPick: (index: number) => void, onSkip: () => void) {
    this.root = overlay(scene, 0.5);
    const cards = rewardView(s);
    const V = viewOf(scene);
    const ph = phoneLayout(scene);
    // 手机上标题贴顶、卡片矮一截（卡面排布见 CARD_LAYOUT），「都不要」和电脑一样放在卡片下方居中（0.9.2：以前在右上角，盖住顶栏的道具栏、贴着 ? 和设置）
    const ty = ph ? 30 : 104;
    const title = addText(scene, V.w / 2 + 22, ty, '挑一样', { size: TYPE.big + 6, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5, stroke: COLOR.ink, strokeWidth: 7 });
    this.root.add([addGlyph(scene, V.w / 2 - title.width / 2 - 14, ty, 'gift', ph ? 44 : 52), title]);
    const gap = ph ? 20 : 30;
    const CW = Math.min(236, Math.floor((V.w - 24 - gap * (cards.length - 1)) / cards.length));
    const CH = ph ? 308 : 350;
    const top = ph ? 58 : 146;
    const x0 = V.w / 2 - (CW * cards.length + gap * (cards.length - 1)) / 2;
    cards.forEach((r, i) => {
      const x = x0 + i * (CW + gap);
      const node = this.card(scene, r, x, top, CW, CH, idle, s);
      const b = new Button(scene, x + 28, top + CH - 62, { width: CW - 56, height: 46, label: '就要它', variant: 'primary', fontSize: TYPE.title, hotkey: `${i + 1}`, sound: null, onClick: () => onPick(i) });
      node.add(b);
      this.root.add(node);
      this.buttons.push(b);
      // 只做淡入和轻微缩放，位置不动（自动化读到的按钮坐标始终有效）
      if (!anim.instant && !anim.calm) {
        node.setAlpha(0);
        anim.fx({ targets: node, alpha: 1, duration: 240, delay: i * 90, ease: 'Quad.easeOut' }, () => node.setAlpha(1));
      }
    });
    const skipY = top + CH + (ph ? 10 : 18);
    const skipX = V.w / 2 - 60;
    this.box = { x: x0 - 6, y: top - 6, w: CW * cards.length + gap * (cards.length - 1) + 12, h: skipY + 42 - top + 12 };
    this.skip = new Button(scene, skipX, skipY, { width: 120, height: 42, label: '都不要', variant: 'default', fontSize: TYPE.title - 2, hotkey: '0', sound: null, onClick: onSkip });
    this.root.add(this.skip);
    sound.cue({ type: 'rewardShow' });
  }

  private card(scene: Phaser.Scene, r: RewardView, x: number, y: number, w: number, h: number, idle: boolean, s: GameState): Phaser.GameObjects.Container {
    const c = scene.add.container(0, 0);
    c.add(addPaper(scene, x, y, w, h));
    const rc = RARITY_COLOR[r.rarity];
    // 稀有度色框 + 顶上一条色带和星星
    c.add(scene.add.rectangle(x + 5, y + 5, w - 10, h - 10).setOrigin(0, 0).setRounded(14).setStrokeStyle(5, rc, 1));
    c.add(scene.add.rectangle(x + 5, y + 5, w - 10, 34, rc, 0.18).setOrigin(0, 0).setRounded(12));
    const stars = RARITY_STARS[r.rarity] ?? 1;
    for (let k = 0; k < stars; k++) c.add(addGlyph(scene, x + w / 2 + (k - (stars - 1) / 2) * 26, y + 22, 'star', 24));
    const ax = x + w / 2;
    const L = phoneLayout(scene) ? CARD_LAYOUT.phone : CARD_LAYOUT.desktop;
    const iy = y + L.icon;
    if (r.item) {
      const color = ITEM_KIND_COLOR[r.item.kind] ?? COLOR.accent;
      if (hasArt(scene.textures, itemKey(r.id))) {
        // 彩色道具图标；美术还没交时退回两字徽章
        c.add(addImage(scene, ax, iy, itemKey(r.id), L.iconS));
      } else {
        c.add(scene.add.circle(ax, iy, 42, color).setStrokeStyle(3, COLOR.ink, 1));
        c.add(addText(scene, ax, iy, shortItemName(r.item.name), { size: 22, bold: true, color: textOn(color), originX: 0.5, originY: 0.5 }));
      }
    } else if (r.friend) {
      c.add(addImage(scene, ax, iy, avatarKey(r.id, 'smug'), L.iconS - 4));
    } else if (r.stock) {
      c.add(new StockGuy(scene, ax, iy + L.iconS / 2 - 4, r.stock.id, 'happy', L.iconS - 4, { idle }));
      // 风口小图标（右上角）
      c.add(addImage(scene, ax + 50, iy - 30, `theme:${r.stock.theme}`, 34));
    }
    c.add(addText(scene, ax, y + L.name, r.name, { size: TYPE.title + 2, bold: true, originX: 0.5 }));
    const big = r.brief.big;
    if (r.stock) {
      // 股票卡：风口 · 角色的色签放在大数字的位置
      const tc = THEME_COLOR[r.stock.theme];
      const t = addText(scene, ax, y + L.big, `${r.stock.themeName} · ${ROLE_WORD[r.stock.role]}`, { size: TYPE.label + 1, bold: true, color: textOn(tc), originX: 0.5, originY: 0.5 });
      c.add(addPill(scene, ax - t.width / 2 - 12, y + L.big - 14, t.width + 24, 28, tc));
      c.add(t);
    }
    if (big) c.add(addText(scene, ax, y + L.big, big, { size: TYPE.big, bold: true, num: true, color: COLOR.accentDark, originX: 0.5, originY: 0.5 }));
    // 0.5.1：说明短（≤34 字）就整句写出来，长的用短句；分类标签放在顶部色带左边
    const descShort = r.desc && [...r.desc].length <= 34 ? r.desc : r.brief.line;
    const desc = addText(scene, ax, big || r.stock ? y + L.big + 26 : y + L.big + 4, descShort, { size: TYPE.label, color: COLOR.muted, originX: 0.5, align: 'center', wrap: w - 28, lineSpacing: 2 });
    c.add(desc);
    if (r.tag) {
      const tg = addText(scene, x + 16, y + 22, r.tag, { size: 11, bold: true, color: textOn(rc), originY: 0.5 });
      // 标签放在星星左边，不压星星（手机上字大一号，按星星实际占的宽度算）
      if (x + 22 + tg.width < ax - (stars - 1) * 13 - 18) c.add([addPill(scene, x + 10, y + 12, tg.width + 12, 20, rc, false), tg.setX(x + 16)]);
      else tg.destroy();
    }
    // 道具的一句俏皮话（0.5 只在悬停里，0.5.1 放回卡面底部，放不下就不放）
    if (r.item?.flavor && !(r.stock && s.slots.every((x2) => x2 !== null))) {
      const fy = desc.y + desc.height + 6;
      const fl = addText(scene, ax, fy, `「${r.item.flavor}」`, { size: 11, color: COLOR.dim, originX: 0.5, align: 'center', wrap: w - 36 });
      if (fy + fl.height > y + h - 70) fl.destroy();
      else c.add(fl);
    }
    // 稀有股票：满仓时提示会替换
    if (r.stock && s.slots.every((x2) => x2 !== null)) {
      c.add(addText(scene, ax, y + h - 78, '格子满了，要换掉一只', { size: TYPE.label - 1, color: COLOR.danger, originX: 0.5 }));
    }
    // 详情：悬停整张卡
    const hit = scene.add.rectangle(x, y, w, h - 70, 0xffffff, 0.001).setOrigin(0, 0);
    c.add(hit);
    const tip = { title: `${r.name} · ${r.tag}`, body: r.item ? `${r.desc}\n${r.item.flavor}` : r.desc, color: rc };
    bindTooltip(hit, () => ({ x, y: y + 40, w, h: h - 110 }), () => tip);
    return c;
  }

  press(i: number): boolean {
    return this.buttons[i]?.press() ?? false;
  }

  /** 三张卡和「都不要」所在的区域（教程用）。 */
  area(): { x: number; y: number; w: number; h: number } {
    return this.box;
  }

  buttonRects(): { x: number; y: number; w: number; h: number }[] {
    return [...this.buttons, this.skip].map((b) => b.rect());
  }

  pressSkip(): boolean {
    return this.skip.press();
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
  }

  controls(): Record<string, { x: number; y: number }> {
    if (!this.root.visible) return {};
    const out: Record<string, { x: number; y: number }> = {};
    this.buttons.forEach((b, i) => (out[`reward:${i}`] = b.center()));
    out['reward:skip'] = this.skip.center();
    return out;
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** 一张稀有股票奖励卡能放进哪些格子（满仓时替换）。 */
export function rewardSlots(s: GameState, index: number): number[] {
  return s.slots.map((_, i) => i).filter((i) => validate(s, { type: 'pickReward', index, slot: i }) === null);
}

/** 事件二选一（0.5 卡牌式）：闪电图标 + 名字 + 一行情景；两个选项各一个大数字（代价 / 收益）+ 短按钮。原文在悬停。 */
export class EventPanel {
  readonly root: Phaser.GameObjects.Container;
  private readonly buttons: Button[] = [];

  constructor(scene: Phaser.Scene, ev: EventView, onChoose: (option: number) => void) {
    this.root = overlay(scene, 0.5);
    const V = viewOf(scene);
    const ph = phoneLayout(scene);
    // 手机（0.5.5）：卡片放宽、头部和选项都收紧，情景原文最多两行（全文在悬停里），整张卡才放得进 444 高
    const L = ph
      ? { W: 720, headH: 104, storyY: 100, storyMax: 44, storyPad: 20, bottom: 16, bigY: 44, textY: 72, btnH: 46, btnUp: 58, optMin: 170, optBase: 138 }
      : { W: 560, headH: 124, storyY: 118, storyMax: 66, storyPad: 26, bottom: 32, bigY: 52, textY: 84, btnH: 54, btnUp: 70, optMin: 196, optBase: 166 };
    const W = L.W;
    // 0.5.1：情景原文放回卡面（一个引号框），选项下写原句；高度按内容算
    const story = ev.text && ev.text !== ev.brief ? addText(scene, 0, 0, ev.text, { size: TYPE.label, color: COLOR.ink, wrap: W - 120, lineSpacing: 3 }) : null;
    const storyH = story ? Math.min(L.storyMax, story.height) + L.storyPad : 0;
    // 选项原句不截断：先量出两边原句的高度，选项卡按长的那边长高（以前两行放不下就打省略号，关键后果被截掉）
    const cw = (W - 40 * 2 - 24) / 2;
    const optText = [0, 1].map((i) => {
      const full0 = ev.options[i] ?? '';
      const label = (ev.picks[i] ?? { label: full0 }).label;
      return full0 && full0 !== label ? addText(scene, 0, 0, full0, { size: TYPE.label - 1, color: COLOR.muted, wrap: cw - 24, align: 'center', originX: 0.5, lineSpacing: 2 }) : null;
    });
    const textH = Math.max(36, ...optText.map((t) => t?.height ?? 0));
    const optH = Math.max(L.optMin, L.optBase + textH);
    const H = L.headH + storyH + optH + L.bottom;
    const x = V.w / 2 - W / 2;
    const y = ph ? Math.max(4, Math.round((V.h - H) / 2)) : Math.max(70, Math.round(360 - H / 2));
    this.root.add(addPaper(scene, x, y, W, H));
    // 背景纹样：右上角淡淡的大闪电
    this.root.add(addGlyph(scene, x + W - 70, y + 70, 'bolt', 120).setAlpha(0.07));
    // 头：闪电徽章 + 名字 + 一行情景（悬停看原文）
    const hc = ph ? 52 : 62;
    const hx = ph ? 96 : 114;
    this.root.add(scene.add.circle(x + hc, y + hc, ph ? 30 : 36, 0xffe7a8).setStrokeStyle(3, COLOR.ink, 1));
    this.root.add(addGlyph(scene, x + hc, y + hc, 'bolt', ph ? 44 : 54));
    this.root.add(addText(scene, x + hx, y + (ph ? 20 : 32), ev.name, { size: TYPE.title + 4, bold: true }));
    const brief = addText(scene, x + hx, y + (ph ? 54 : 70), ev.brief, { size: TYPE.label + 2, color: COLOR.muted, wrap: W - hx - 26 });
    this.root.add(brief);
    const head = scene.add.rectangle(x + 20, y + 20, W - 40, ph ? 76 : 90, 0xffffff, 0.001).setOrigin(0, 0);
    this.root.add(head);
    bindTooltip(head, () => ({ x: x + 20, y: y + 20, w: W - 40, h: ph ? 76 : 90 }), () => ({ title: ev.name, body: ev.text }));
    if (story) {
      const sy = y + L.storyY;
      const box = scene.add.rectangle(x + 40, sy, W - 80, storyH - 6, 0xffffff, 0.75).setOrigin(0, 0).setRounded(12).setStrokeStyle(1.5, COLOR.edge, 1);
      this.root.add([box, addGlyph(scene, x + 60, sy + 18, 'horn', 22)]);
      // 太长就截到三行
      let cut = Array.from(story.text);
      while (story.height > L.storyMax && cut.length > 10) {
        cut = cut.slice(0, -4);
        story.setText(`${cut.join('')}…`);
      }
      story.setPosition(x + 78, sy + 8);
      this.root.add(story);
    }
    // 两个选项：次选项（不做）白色在左，主选项（做）橙色在右；快捷键按位置从左往右 1、2（以前是左 2 右 1，看着像标反了）
    const order = EVENT_ORDER;
    order.forEach((i, col) => {
      const pick = ev.picks[i] ?? { label: ev.options[i] ?? '' };
      const cx = x + 40 + col * (cw + 24);
      const cy = y + L.headH + storyH;
      const ch = optH;
      const bg = scene.add.rectangle(cx, cy, cw, ch, i === 0 ? 0xfff1c4 : COLOR.paperLo).setOrigin(0, 0).setRounded(16).setStrokeStyle(2, i === 0 ? COLOR.gold : COLOR.edge, 1);
      this.root.add(bg);
      const tone = pick.tone ?? 'plain';
      const color = tone === 'gain' ? COLOR.up : tone === 'cost' ? COLOR.down : COLOR.accentDark;
      if (pick.big) {
        const t = addText(scene, cx + cw / 2, cy + L.bigY, pick.big, { size: TYPE.big + 4, bold: true, num: true, color, originX: 0.5, originY: 0.5 });
        if (t.width > cw - 16) t.setScale((cw - 16) / t.width);
        this.root.add(t);
      } else {
        this.root.add(addText(scene, cx + cw / 2, cy + L.bigY, '¥0', { size: TYPE.big + 4, bold: true, num: true, color: COLOR.dim, originX: 0.5, originY: 0.5 }));
      }
      // 选项原句（小字，两行内）：花多少、得到什么
      const ot = optText[i];
      if (ot) {
        ot.setPosition(cx + cw / 2, cy + L.textY);
        this.root.add(ot);
      }
      // 选项角上的小图标：花钱 / 赚钱 / 不动
      this.root.add(addGlyph(scene, cx + 22, cy + 22, tone === 'gain' ? 'moneybag' : tone === 'cost' ? 'wallet' : 'hourglass', 26));
      const b = new Button(scene, cx + 14, cy + ch - L.btnUp, {
        width: cw - 28,
        height: L.btnH,
        label: pick.label,
        variant: i === 0 ? 'primary' : 'default',
        fontSize: TYPE.title + 2,
        hotkey: `${col + 1}`,
        sound: null,
        onClick: () => onChoose(i),
      });
      const full = ev.options[i] ?? '';
      b.tooltip(() => ({ title: pick.label, body: full }));
      bg.setInteractive();
      bindTooltip(bg, () => ({ x: cx, y: cy, w: cw, h: ch }), () => ({ title: pick.label, body: full }));
      this.root.add(b);
      this.buttons[i] = b;
    });
    sound.cue({ type: 'event' });
  }

  press(i: number): boolean {
    return this.buttons[i]?.press() ?? false;
  }

  /** 数字键 n（1 起）：按屏幕上从左往右的位置选。 */
  pressKey(n: number): boolean {
    const i = eventOptionForKey(n);
    return i === null ? false : this.press(i);
  }

  controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    this.buttons.forEach((b, i) => (out[`event:${i}`] = b.center()));
    return out;
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** 事件结果：大数字（账户变化）+ 一行 + 「继续」。 */
export function eventResult(scene: Phaser.Scene, anim: Animator, name: string, text: string, delta: number, onContinue: () => void): { root: Phaser.GameObjects.Container; button: Button } {
  const root = overlay(scene, 0.5);
  const W = 480;
  const H = 270;
  const V = viewOf(scene);
  const x = V.w / 2 - W / 2;
  const y = phoneLayout(scene) ? Math.round((V.h - H) / 2) : 200;
  root.add(addPaper(scene, x, y, W, H));
  root.add(addGlyph(scene, x + W - 70, y + H - 90, delta > 0.5 ? 'moneybag' : delta < -0.5 ? 'cry' : 'melon', 110).setAlpha(0.1));
  root.add(addGlyph(scene, x + 44, y + 42, 'bolt', 36));
  // 0.5.1：右上角一张表情脸，赚了笑、亏了愁、没动吃瓜
  const face = addGlyph(scene, x + W - 46, y + 42, delta > 0.5 ? 'face_happy' : delta < -0.5 ? 'face_sad' : 'face_calm', 44);
  root.add(face);
  if (!anim.instant && !anim.calm) anim.fx({ targets: face, angle: { from: -18, to: 0 }, duration: 360, ease: 'Back.easeOut' }, () => face.setAngle(0));
  root.add(addText(scene, x + 70, y + 42, name, { size: TYPE.title, bold: true, color: COLOR.muted, originY: 0.5 }));
  const has = Math.abs(delta) >= 0.5;
  if (has) {
    const big = addText(scene, W / 2 + x, y + 104, formatMoney(delta, { sign: true }), { size: TYPE.big + 16, bold: true, num: true, color: signColor(delta), originX: 0.5, originY: 0.5 });
    root.add(addImage(scene, x + W / 2 - big.width / 2 - 30, y + 104, 'fx:coin', 36));
    root.add(big);
    if (delta > 0) sparkles(scene, anim, x + W / 2, y + 104, 12);
    if (!anim.instant && !anim.calm) {
      big.setScale(0.4);
      anim.fx({ targets: big, scale: 1, duration: 260, ease: 'Back.easeOut' }, () => big.setScale(1));
    }
  }
  const body = addText(scene, x + W / 2, has ? y + 158 : y + 120, text, { size: TYPE.label + 2, color: COLOR.ink, wrap: W - 64, align: 'center', originX: 0.5, originY: 0.5, lineSpacing: 4 });
  root.add(body);
  const btns = new Phaser.GameObjects.Container(scene, x, y);
  root.add(btns);
  const button = actionButtons(scene, btns, W - 26, H - 20, { label: '继续', hotkey: '空格', onClick: onContinue }).primary as Button;
  sound.cue({ type: 'eventResult', delta });
  return { root, button };
}

/** 新月份开场（没有月度主题时）：大字月份 + 日历名，交易日和要还的钱是图标胶囊；附加说明每条一行，原句悬停。 */
export function monthIntro(scene: Phaser.Scene, cal: CalendarView, bill: { name: string; amount: number }, extras: string[]): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0).setDepth(DEPTH);
  root.add(addBackdrop(scene, 0.3));
  const W = 480;
  const shown = extras.slice(0, 5);
  const H = 196 + shown.length * 38;
  const V = viewOf(scene);
  const x = V.w / 2 - W / 2;
  const y = Math.max(4, Math.round(V.h / 2 - H / 2));
  root.add(addPaper(scene, x, y, W, H));
  root.add(addGlyph(scene, x + 58, y + 58, 'calendar', 64));
  root.add(addText(scene, x + 104, y + 24, `${cal.month}月`, { size: TYPE.big + 6, bold: true, color: COLOR.accentDark }));
  const name = addText(scene, x + 104, y + 66, cal.name, { size: TYPE.title, bold: true, color: COLOR.ink });
  root.add(name);
  const nameHit = scene.add.rectangle(x + 104, y + 62, Math.max(80, name.width), 28, 0xffffff, 0.001).setOrigin(0, 0);
  root.add(nameHit);
  bindTooltip(nameHit, () => ({ x: x + 104, y: y + 62, w: name.width, h: 28 }), () => ({ title: cal.name, body: cal.desc }));
  let cx = x + 30;
  const cy = y + 120;
  for (const c of [
    iconChip(scene, 0, 0, 'calendar', `${cal.days}天`, { tip: { title: '交易日', body: `这个月有 ${cal.days} 个交易日` } }),
    iconChip(scene, 0, 0, 'house', moneyShort(bill.amount), { color: COLOR.danger, tip: { title: '月底要还', body: `${bill.name} ${formatMoney(bill.amount)}，最后一天收盘后扣` } }),
  ]) {
    c.node.setPosition(cx, cy);
    root.add(c.node);
    cx += c.w + 10;
  }
  let ly = cy + 46;
  for (const e of shown) {
    const { head, money } = extraChip(e);
    const rowBg = scene.add.rectangle(x + 30, ly, W - 60, 32, COLOR.paperLo).setOrigin(0, 0).setRounded(10);
    root.add([rowBg, addGlyph(scene, x + 48, ly + 16, 'bolt', 22), addText(scene, x + 66, ly + 16, head, { size: TYPE.label + 1, bold: true, originY: 0.5 })]);
    if (money) root.add(addText(scene, x + W - 42, ly + 16, money, { size: TYPE.title, bold: true, num: true, color: money.startsWith('+') ? COLOR.up : money.startsWith('-') || head.includes('花') ? COLOR.down : COLOR.ink, originX: 1, originY: 0.5 }));
    rowBg.setInteractive();
    const ry = ly;
    bindTooltip(rowBg, () => ({ x: x + 30, y: ry, w: W - 60, h: 32 }), () => ({ title: head.replace(/…$/, ''), body: e }));
    ly += 38;
  }
  root.add(addText(scene, x + W - 18, y + H - 10, isTouch() ? '点一下' : '空格', { size: TYPE.label - 1, color: COLOR.dim, originX: 1, originY: 1 }));
  sound.cue({ type: 'monthStart' });
  return root;
}
