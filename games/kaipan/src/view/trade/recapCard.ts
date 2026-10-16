import Phaser from 'phaser';
import { formatMoney, formatPoints, type HoldingMove } from '../../core/index.ts';
import { CAT_HINT_KEY, NEWS_KEY, hasArt, stockKey } from '../assets.ts';
import type { Animator } from '../fx/anim.ts';
import type { Rect } from '../rect.ts';
import { breakdownOf, moveWord, shortPart, shortWord, type DayWord, type Recap } from '../recap.ts';
import { pctArrow } from '../labels.ts';
import { COLOR, TYPE, signColor } from '../theme.ts';
import { addGlyph, addImage, addPill, addSlice } from '../ui/art.ts';
import { addText, fitWidth } from '../ui/text.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { moneyShort } from '../ui/dialog.ts';
import { extraChip } from './tempoFx.ts';
import { RECAP_AREA } from './layout.ts';

/** 句子里的「+7.94%」「-3.1%」换成「↑7.94%」「↓3.1%」。 */
function arrowize(t: string): string {
  return t.replace(/\+(\d[\d.,]*%)/g, '↑$1').replace(/(^|[^\d¥])-(\d[\d.,]*%)/g, '$1↓$2');
}

/** 小结里小人的表情：涨停 / 涨 / 平 / 跌 / 跌停。 */
function faceOf(ret: number): 'limitup' | 'happy' | 'calm' | 'worried' | 'limitdown' {
  return ret >= 9.5 ? 'limitup' : ret > 0.05 ? 'happy' : ret <= -9.5 ? 'limitdown' : ret < -0.05 ? 'worried' : 'calm';
}

/** 窗户那块（顶栏和持仓卡之间）：放收盘小结卡和拆解条，不挡任何按钮。 */
const RECAP_RECT: Rect = RECAP_AREA;
const PAD = 18;

/**
 * 收盘小结卡（F1）：第一句总账，下面每只持仓一行大白话；点 × 关掉，明天开盘时自动收起。
 * 点持仓卡时同一个位置换成那一格的拆解条（各项涨跌和说明），再点 × 回到小结。
 * 纸张用 ui/recap_paper（九宫格 24），没有时退回圆角矩形。
 */
export class RecapCard {
  private readonly scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container | null = null;
  private recap: Recap | null = null;
  private brief = false;
  private when: DayWord = '昨天';
  /** 展开看全部（默认只有总账和赚最多 / 亏最多的那只） */
  private expanded = false;
  private mode: 'recap' | 'breakdown' | null = null;
  private inspected = -1;
  /** 0.5.5 手机：小结和猫的提示共用左下角。猫有话等着时卡上挂一只小猫，点它收起小结、换猫说 */
  private catBadge = false;
  private catBtn: Phaser.GameObjects.GameObject | null = null;
  /** 卡片出现、换内容、收起时通知场景（手机上据此决定猫的提示露不露出来） */
  onChange: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setCatBadge(on: boolean): void {
    if (this.catBadge === on) return;
    this.catBadge = on;
    if (this.root && this.mode === 'recap') this.drawRecap();
  }

  /** 小猫的位置（自动化点击用；没挂时为 null）。 */
  catCenter(): { x: number; y: number } | null {
    return this.catBtn?.active && this.root ? { x: RECAP_RECT.x + RECAP_RECT.w - 92, y: RECAP_RECT.y + 22 } : null;
  }

  get showing(): 'recap' | 'breakdown' | null {
    return this.root ? this.mode : null;
  }

  rect(): Rect | null {
    return this.root ? { ...RECAP_RECT } : null;
  }

  /** 收盘后：显示小结（brief = 只显示总账一句）。 */
  showRecap(r: Recap, brief: boolean, anim: Animator | null, when: DayWord = '昨天'): void {
    this.recap = r;
    this.brief = brief;
    this.when = when;
    this.drawRecap();
    if (anim && !anim.calm && this.root) {
      this.root.setAlpha(0).setY(-12);
      const r = this.root;
      anim.fx({ targets: r, alpha: 1, y: 0, duration: 260, ease: 'Back.easeOut' }, () => r.setAlpha(1).setY(0));
    }
    this.onChange?.();
  }

  /** 点持仓卡：这一格今天的拆解条；h 为空表示今天刚买（还没有收盘结果）。 */
  showBreakdown(slot: number, name: string, h: HoldingMove | null): void {
    if (this.mode === 'breakdown' && this.inspected === slot && this.root) {
      // 再点一次同一格：收起
      this.back();
      return;
    }
    this.inspected = slot;
    this.mode = 'breakdown';
    const rows = h ? breakdownOf(h) : [];
    const { root, x, y, w } = this.frame(h ? Math.min(RECAP_RECT.h, 56 + Math.min(4, rows.length) * 26) : 80);
    const s = this.scene;
    if (!h) {
      root.add(addText(s, x + PAD, y + 16, `${name} · 新买`, { size: 16, bold: true }));
      root.add(addText(s, x + PAD, y + 44, '明天收盘后看涨跌原因', { size: 13, color: COLOR.muted }));
      this.onChange?.();
      return;
    }
    // 0.5：标题只写「名字 ↑7.9% +¥1,990」，每一项短标签 + 小条 + 数字，整句在悬停提示里
    const head = addText(s, x + PAD, y + 12, `${name}  ${pctArrow(h.ret)}  ${formatMoney(h.amount, { sign: true })}`, { size: 15, bold: true, color: signColor(h.short ? -h.ret : h.ret) });
    root.add(head);
    void shortWord;
    void moveWord;
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    // 两栏，每栏最多 4 行：说明 + 小条 + 数值
    const colW = (w - PAD * 2 - 16) / 2;
    const BAR = 70;
    rows.slice(0, 8).forEach((r, i) => {
      const cx = x + PAD + (i >= 4 ? colW + 16 : 0);
      const cy = y + 46 + (i % 4) * 26;
      const label = addText(s, cx, cy, shortPart(r.label), { size: 12, color: COLOR.ink });
      const hit = s.add.rectangle(cx, cy - 2, colW, 22, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
      bindTooltip(hit, () => ({ x: cx, y: cy - 2, w: colW, h: 22 }), () => ({ title: shortPart(r.label), body: r.label }));
      root.add(hit);
      fitWidth(label, colW - BAR - 54);
      const bw = Math.max(2, (BAR * Math.abs(r.value)) / max);
      const bx = cx + colW - 50 - BAR;
      root.add(s.add.rectangle(bx, cy + 3, BAR, 10, 0xeadcc8).setOrigin(0, 0).setRounded(5));
      root.add(s.add.rectangle(bx, cy + 3, bw, 10, signColor(r.value)).setOrigin(0, 0).setRounded(5));
      root.add(label);
      root.add(addText(s, cx + colW, cy, r.text, { size: 12, bold: true, num: true, color: signColor(r.value), originX: 1 }));
    });
    if (rows.length > 8) root.add(addText(s, x + w - PAD, y + 14, `还有 ${rows.length - 8} 项`, { size: 11, color: COLOR.muted, originX: 1 }));
    this.onChange?.();
  }

  /** 从拆解条回到小结（没有小结就收起）。 */
  back(): void {
    this.inspected = -1;
    if (this.recap) {
      this.drawRecap();
      this.onChange?.();
    } else this.hide();
  }

  /** 开盘时收起，并忘掉昨天的小结。 */
  clear(): void {
    this.recap = null;
    this.expanded = false;
    this.hide();
  }

  hide(): void {
    const had = this.root !== null;
    this.root?.destroy();
    this.root = null;
    this.mode = null;
    this.inspected = -1;
    this.catBtn = null;
    if (had) this.onChange?.();
  }

  /**
   * 0.5 小结：收起时一行大字结论（钱 + 箭头百分比，最精彩的一件事配星星），下面一排「小人头像 + 箭头数字」；
   * 点「详情」展开成原来的整句（总账、每只一行、账户层效果）。
   */
  private drawRecap(): void {
    const r = this.recap;
    if (!r) return this.hide();
    this.mode = 'recap';
    const s = this.scene;
    const W0 = RECAP_RECT.w - PAD * 2;
    const all = [...r.lines.map((l) => `${l.head} ${l.money}：${l.why}`), ...r.effects];
    const canExpand = all.length > 0 || r.headline !== '';
    const chips = this.brief || this.expanded ? [] : r.lines.slice(0, 4);
    const texts = this.expanded ? [r.headline, ...all.slice(0, 4)].map((t, i) => addText(s, 0, 0, t, { size: i === 0 ? 14 : 12, bold: i === 0, color: COLOR.ink, wrap: W0, lineSpacing: 2 })) : [];
    const bodyH = texts.reduce((n, t) => n + Math.min(t.height, 34) + 3, 0);
    // 账户层效果（借钱、押跌利息……）：收起时变成「图标 + 金额」小签（0.5.1 找回）
    const fx = this.brief || this.expanded ? [] : r.effects.slice(0, RECAP_RECT.w < 600 ? 2 : 3);
    // 手机上展开的正文往下让 10，不压左边的「今天 / 昨天」小签
    const bodyTop = RECAP_RECT.w < 600 ? 62 : 52;
    const h = Math.min(RECAP_RECT.h, this.expanded ? bodyTop + 4 + bodyH + 6 : chips.length > 0 ? 122 + (fx.length > 0 ? 28 : 0) : 58 + (fx.length > 0 ? 28 : 0));
    const { root, x, y } = this.frame(h);
    const iconX = x + PAD;
    if (hasArt(s.textures, NEWS_KEY)) root.add(addImage(s, iconX + 14, y + 26, NEWS_KEY, 28));
    // 「今天 / 昨天」小签：这张小结说的是哪一天（0.5 删了标题，0.5.1 用小签找回）
    root.add(addText(s, iconX + 14, y + 42, this.when, { size: 12, bold: true, color: COLOR.accentDark, originX: 0.5 }));
    // 一行大字：+¥1,990  ↑1.99%
    const tint = signColor(r.total);
    const money = addText(s, iconX + 36, y + 12, Math.round(r.total) === 0 ? '¥0' : formatMoney(r.total, { sign: true }), { size: TYPE.big, bold: true, num: true, color: tint });
    const pct = addText(s, money.x + money.width + 10, y + 22, pctArrow(r.ret, 2), { size: 15, bold: true, num: true, color: tint });
    root.add([money, pct]);
    // 最精彩的一件事：星星 + 一句（放不下就截短，整句在详情里）
    if (r.star) {
      const sx = pct.x + pct.width + 22;
      root.add(addGlyph(s, sx, y + 30, 'star', 22));
      const room = x + RECAP_RECT.w - PAD - 60 - (sx + 16) - (this.catBtn ? 32 : 0);
      const st = addText(s, sx + 16, y + 21, arrowize(r.star.replace(/^(今天|昨天)最精彩：/, '')), { size: 14, bold: true, color: COLOR.accentDark });
      fitWidth(st, room, 4);
      root.add(st);
    }
    // 每只一枚：小人头像 + 箭头数字 + 钱 + 最大原因（短签）+ 贡献小条（0.5.1 找回原因与占比）
    const chipW = Math.min(220, (W0 + 8) / Math.max(1, chips.length));
    const maxAmt = Math.max(1, ...chips.map((l) => Math.abs(l.amount)));
    chips.forEach((l, i) => {
      const cx = x + PAD + i * chipW;
      const cy = y + 56;
      const c = signColor(l.short ? -l.ret : l.ret);
      const cw = chipW - 8;
      root.add(s.add.rectangle(cx, cy, cw, 56, 0xffffff, 0.7).setOrigin(0, 0).setRounded(10).setStrokeStyle(2, COLOR.edge, 1));
      // 手机横屏一张只有百来宽：头像缩小，只写涨跌和钱，原因放进悬停；「说对了」放在卡里底下那条的位置
      if (cw < 140) {
        root.add(addImage(s, cx + 17, cy + 26, stockKey(l.stockId, faceOf(l.ret)), 30));
        if (l.short) root.add(addGlyph(s, cx + 28, cy + 10, 'bear', 14));
        root.add(addText(s, cx + 34, cy + 2, pctArrow(l.ret), { size: 15, bold: true, num: true, color: c }));
        const mt = addText(s, cx + 34, cy + 20, l.money, { size: 13, bold: true, num: true, color: c });
        if (mt.width > cw - 38) mt.setText(moneyShort(l.amount, true));
        root.add(mt);
        if (l.called) {
          const ct = addText(s, 0, cy + 46, `${l.called}说对了`, { size: 13, bold: true, color: COLOR.white, originY: 0.5 });
          if (ct.width > cw - 46) ct.setText(`${l.called}对了`);
          if (ct.width > cw - 46) ct.setText('说对了');
          const pw = Math.min(cw - 36, ct.width + 10);
          root.add(addPill(s, cx + 32, cy + 37, pw, 18, COLOR.accentDark));
          ct.setX(cx + 37);
          root.add(ct);
        } else {
          const bw = Math.max(4, Math.round(((cw - 42) * Math.abs(l.amount)) / maxAmt));
          root.add(s.add.rectangle(cx + 34, cy + 42, cw - 42, 6, COLOR.paperLo).setOrigin(0, 0).setRounded(3));
          root.add(s.add.rectangle(cx + 34, cy + 42, bw, 6, c).setOrigin(0, 0).setRounded(3));
        }
        const hit = s.add.rectangle(cx, cy, cw, 56, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
        bindTooltip(hit, () => ({ x: cx, y: cy, w: cw, h: 56 }), () => ({ title: l.head, body: `${l.money}：${l.why}${l.called ? `\n${l.called}之前在群里说对了这个风口的方向` : ''}` }));
        root.add(hit);
        return;
      }
      const face = addImage(s, cx + 22, cy + 24, stockKey(l.stockId, faceOf(l.ret)), 38);
      root.add(face);
      if (l.short) root.add(addGlyph(s, cx + 36, cy + 10, 'bear', 16));
      const pt = addText(s, cx + 44, cy + 4, pctArrow(l.ret), { size: 15, bold: true, num: true, color: c });
      root.add(pt);
      root.add(addText(s, pt.x + pt.width + 6, cy + 7, l.money, { size: 11, bold: true, num: true, color: c }));
      // 按卡宽截（下面量宽度），不再统一砍到 8 个字：「大消费热度涨了 9」这种一眼要看完的不打省略号
      const why = shortPart(l.why.split('；')[0] ?? l.why, 16);
      const wt = addText(s, cx + 44, cy + 24, why, { size: 11, color: COLOR.muted });
      fitWidth(wt, cw - 50, 3);
      root.add(wt);
      // 谁说对了：单独一枚小签骑在卡片上沿右边（以前接在原因后面，窄卡里被截成"老王说…"）
      if (l.called) {
        const ct = addText(s, 0, cy - 5, `${l.called}说对了`, { size: 11, bold: true, color: COLOR.white, originY: 0.5 });
        const pw = ct.width + 12;
        const px = cx + cw - pw - 6;
        root.add(addPill(s, px, cy - 14, pw, 18, COLOR.accentDark));
        ct.setX(px + 6);
        root.add(ct);
      }
      // 贡献小条：这只赚亏占今天最大那只的多少
      const bw = Math.max(4, Math.round(((cw - 52) * Math.abs(l.amount)) / maxAmt));
      root.add(s.add.rectangle(cx + 44, cy + 43, cw - 52, 6, COLOR.paperLo).setOrigin(0, 0).setRounded(3));
      const bar = s.add.rectangle(cx + 44, cy + 43, bw, 6, c).setOrigin(0, 0).setRounded(3);
      root.add(bar);
      const hit = s.add.rectangle(cx, cy, cw, 56, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
      bindTooltip(hit, () => ({ x: cx, y: cy, w: cw, h: 56 }), () => ({ title: l.head, body: `${l.money}：${l.why}${l.called ? `\n${l.called}之前在群里说对了这个风口的方向` : ''}` }));
      root.add(hit);
      // 小条从 0 长出来（不阻塞流程；点哪都不用等）
      if (!(s.data.get('calm') as boolean)) {
        bar.width = 0;
        s.tweens.add({ targets: bar, width: bw, duration: 360, delay: 60 * i, ease: 'Quad.easeOut' });
      }
    });
    fx.forEach((e, i) => {
      const fy = y + (chips.length > 0 ? 118 : 52);
      const { head, money } = extraChip(e);
      const t = addText(s, 0, 0, `${head}${money ? ` ${money}` : ''}`, { size: 12, bold: true, color: money?.startsWith('-') ? COLOR.down : COLOR.ink });
      const fw = t.width + 36;
      const fxX = x + PAD + i * (RECAP_RECT.w < 600 ? 206 : 210);
      root.add(s.add.rectangle(fxX, fy, Math.min(fw, 200), 24, COLOR.paperHi).setOrigin(0, 0).setRounded(12).setStrokeStyle(1.5, COLOR.edge, 1));
      root.add(addGlyph(s, fxX + 14, fy + 12, e.includes('押') ? 'bear' : e.includes('借') || e.includes('银行') ? 'bank' : 'bolt', 18));
      t.setPosition(fxX + 26, fy + 12 - t.height / 2);
      root.add(t);
    });
    let ty = y + bodyTop;
    for (const t of texts) {
      // 一条最多两行，超出的写省略号
      if (t.height > 34) {
        let cut = Array.from(t.text);
        while (t.height > 34 && cut.length > 6) {
          cut = cut.slice(0, -2);
          t.setText(`${cut.join('')}…`);
        }
      }
      // 手机上卡片矮：放不下的后几条不画，不让字溢出卡片（每只股票的原因点持仓卡的拆解条也能看）
      if (RECAP_RECT.w < 600 && ty + t.height > y + h - 4) {
        t.destroy();
        continue;
      }
      t.setPosition(x + PAD, ty);
      root.add(t);
      ty += t.height + 3;
    }
    if (canExpand) {
      const label = this.expanded ? '收起' : '详情';
      const btn = addText(s, x + RECAP_RECT.w - PAD - 26, y + 12, label, { size: 12, bold: true, color: COLOR.info, originX: 1 }).setInteractive({ useHandCursor: true });
      btn.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.expanded = !this.expanded;
        this.drawRecap();
      });
      root.add(btn);
      this.expandBtn = btn;
    } else this.expandBtn = null;
  }

  private expandBtn: Phaser.GameObjects.Text | null = null;

  /** 「展开 / 收起」的位置（自动化点击用；没有时为 null）。 */
  expandCenter(): { x: number; y: number } | null {
    const b = this.expandBtn;
    if (!b || !b.active || !this.root) return null;
    return { x: b.x - b.width / 2, y: b.y + b.height / 2 };
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  /** 纸张、关闭按钮；返回容器和内容区左上角。 */
  private frame(h: number): { root: Phaser.GameObjects.Container; x: number; y: number; w: number } {
    this.root?.destroy();
    const s = this.scene;
    const { x, y, w } = RECAP_RECT;
    const root = s.add.container(0, 0).setDepth(30);
    root.add(s.add.rectangle(x + 3, y + 5, w, h, COLOR.ink, 0.16).setOrigin(0, 0).setRounded(14));
    root.add(addSlice(s, x, y, w, h, 'recap_paper'));
    // 吞掉点击，不让点穿到下面的房间
    root.add(s.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive());
    const close = addText(s, x + w - 12, y + 6, '×', { size: 22, color: COLOR.muted, originX: 1 }).setInteractive({ useHandCursor: true });
    close.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      if (this.mode === 'breakdown' && this.recap) this.back();
      else this.hide();
    });
    root.add(close);
    this.catBtn = null;
    if (this.catBadge && this.mode === 'recap') {
      const cx = x + w - 92;
      const cy = y + 22;
      const cat = hasArt(s.textures, CAT_HINT_KEY)
        ? addImage(s, cx, cy, CAT_HINT_KEY, 30)
        : s.add.circle(cx, cy, 13, 0xf3a54a).setStrokeStyle(2, COLOR.ink, 1);
      const dot = s.add.circle(cx + 11, cy - 10, 5, COLOR.danger).setStrokeStyle(1.5, 0xffffff, 1);
      const hit = s.add.circle(cx, cy, 20, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on(Phaser.Input.Events.POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.hide();
      });
      bindTooltip(hit, () => ({ x: cx - 20, y: cy - 20, w: 40, h: 40 }), () => ({ title: '猫有话说', body: '点一下收起小结，看猫今天的建议' }));
      root.add([cat, dot, hit]);
      this.catBtn = hit;
    }
    this.root = root;
    return { root, x, y, w };
  }
}
