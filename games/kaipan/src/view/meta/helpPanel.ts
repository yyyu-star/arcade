import Phaser from 'phaser';
import { GUIDE_PAGES, guideKey, hasArt, stageIconKey } from '../assets.ts';
import { FEEL_CYCLE, FEEL_WORD } from '../glossary.ts';
import { sound } from '../sound.ts';
import type { Glyph } from '../assets.ts';
import { COLOR, FEEL_COLOR, TYPE, textOn } from '../theme.ts';
import { addGlyph, addImage, addPill } from '../ui/art.ts';
import { bindTooltip } from '../ui/tooltip.ts';
import { Button } from '../ui/button.ts';
import { Dialog, iconChip } from '../ui/dialog.ts';
import { addText } from '../ui/text.ts';
import { phoneLayout, viewOf } from '../viewport.ts';

const W = 760;
const H = 560;
const PIC_W = 520;
const PIC_H = 300;
const PIC_X = (W - PIC_W) / 2;
const PIC_Y = 70;
/** 插图里画的部分到这里为止，下面是写标题的纸条 */
const STRIP_TOP = 226;
/**
 * 手机横屏（960×444）：插图原尺寸放左边，标题以外的一句话、要点签、翻页都挪到右栏；
 * 插图不缩小（图上纸条里的标题字也就不会变小）。
 */
const PHONE_UI = { w: 940, h: 400, picX: 24, picY: 66, rx: 568 } as const;

/**
 * 说明书四页：标题写在插图下方的纸条上，图下面一句短话（short，≤30 字）；完整说明（body）在插图的悬停里。
 * 第 4 页三张卡：图标 + 名字 + 一句短话，完整说明同样在悬停里。
 */
const HELP_PAGES: { id: (typeof GUIDE_PAGES)[number] | 'ext'; title: string; short: string; body: string }[] = [
  {
    id: 'rotation',
    title: '风口会轮流火',
    short: '',
    body: `每个风口都会经历：${FEEL_CYCLE}，然后轮到下一个风口。左边的风口看板会告诉你，每个风口现在大概在哪一档。`,
  },
  {
    id: 'buy',
    title: `${FEEL_WORD.warming}的时候买`,
    short: `${FEEL_WORD.warming}就买：热度涨，股票跟着涨`,
    body: '风口"要火"的时候，买它的股票。热度往上涨，股票就跟着涨，你的账户也跟着涨。群友和推荐会给你线索，但他们不一定对。',
  },
  {
    id: 'sell',
    title: `${FEEL_WORD.overheated}就卖，月底要还钱`,
    short: `${FEEL_WORD.overheated}就卖；月底还不上就结束`,
    body: `${FEEL_WORD.warming}：买。${FEEL_WORD.hot}：拿着。${FEEL_WORD.overheated}：卖掉，别等。一降温，股票就会跌。另外每个月底要还一笔钱，还不上游戏就结束。`,
  },
  {
    id: 'ext',
    title: '买多少、押跌、银行',
    short: ['bag|买得越多，赚亏越大', 'bear|它跌你赚，它涨你亏', 'bank|押东西借钱，每月付利息'].join('\n'),
    body: [
      '买多少|买的时候选「试一口 / 半仓 / 重仓」；手里的股票点一下，可以再买一点、卖掉一半、全部卖掉。买得多赚得多，亏得也多。',
      '押跌|解锁后，推荐里会多一个「押跌」：它跌你赚、它涨你亏，涨停还会被轧，亏得更狠。',
      '银行|第 2 个月起开门：押东西借钱，赚亏都放大，每月付利息。亏太多银行会打电话催，再亏就把东西收走；还钱能赎回。',
    ].join('\n'),
  },
];

/** 每页三枚要点签：[图标, 短字, 着色]。 */
const HELP_POINTS: Partial<Record<(typeof HELP_PAGES)[number]['id'], [Glyph, string, ('up' | 'down' | null)?][]>> = {
  rotation: [
    ['face_happy', `${FEEL_WORD.warming}：买`, 'up'],
    ['face_hot', `${FEEL_WORD.hot}：拿着`],
    ['face_cold', `${FEEL_WORD.overheated}：快跑`, 'down'],
  ],
  buy: [
    ['arrow_up', '热度涨', 'up'],
    ['rocket', '股价跟着涨', 'up'],
    ['horn', '群友给线索，不一定对'],
  ],
  sell: [
    ['hammer', `${FEEL_WORD.overheated}别等`],
    ['house', '每月底还钱'],
    ['cry', '还不上就结束', 'down'],
  ],
};

/**
 * 「怎么玩」说明书：四页图文。插图在 guide/*.svg（meta 图集），没到时画一张示意图代替。
 * 开始菜单和顶栏都能打开。←/→ 翻页，回车下一页。
 */
export class HelpPanel extends Dialog {
  private page = 0;
  private readonly pageBox: Phaser.GameObjects.Container;
  private readonly prevBtn: Button;
  private readonly nextBtn: Button;
  private readonly dots: Phaser.GameObjects.Arc[] = [];
  private readonly phone: boolean;
  /** 插图左上角（电脑上居中，手机上靠左） */
  private readonly picX: number;
  private readonly picY: number;
  /** 0.19.0 手机世界窄了以后插图按比例缩小（SE 上约 0.79），右栏跟着插图右边走 */
  private readonly picK: number;
  private readonly rx: number;

  constructor(scene: Phaser.Scene, onClosed?: () => void) {
    const phone = phoneLayout(scene);
    const V = viewOf(scene);
    const pw = Math.min(PHONE_UI.w, V.w - 16);
    const phH = Math.min(PHONE_UI.h, V.h - 12);
    super(scene, phone ? pw : W, phone ? phH : H, '怎么玩', onClosed);
    this.phone = phone;
    this.picX = phone ? PHONE_UI.picX : PIC_X;
    this.picY = phone ? PHONE_UI.picY : PIC_Y;
    this.picK = phone ? Math.min(1, (pw - PHONE_UI.picX - 268) / PIC_W, (phH - PHONE_UI.picY - 16) / PIC_H) : 1;
    this.rx = phone ? Math.round(this.picX + PIC_W * this.picK + 24) : PHONE_UI.rx;
    const w = this.dw;
    const h = this.dh;
    const narrow = phone && w < 900;
    this.pageBox = scene.add.container(0, 0);
    this.inner.add(this.pageBox);
    // 手机：两个翻页按钮都在右栏底部，页码圆点在它们上面
    this.prevBtn = new Button(scene, phone ? this.rx : 32, phone ? h - 64 : H - 64, { width: narrow ? 96 : 120, height: phone ? 44 : 42, label: '上一页', fontSize: 15, hotkey: '←' });
    this.prevBtn.setHandler(() => this.go(this.page - 1));
    this.nextBtn = new Button(scene, w - (phone ? 24 : 32) - (narrow ? 110 : 150), h - 66, { width: narrow ? 110 : 150, height: 46, label: '下一页', variant: 'primary', fontSize: 16, hotkey: '回车' });
    this.nextBtn.setHandler(() => (this.page + 1 < HELP_PAGES.length ? this.go(this.page + 1) : this.close()));
    this.inner.add([this.prevBtn, this.nextBtn]);
    const dotsX = phone ? (this.rx + w - 24) / 2 : W / 2;
    const dotsY = phone ? h - 84 : H - 43;
    HELP_PAGES.forEach((_, i) => {
      const d = scene.add.circle(dotsX - (phone ? 36 : 24) + i * 24, dotsY, 6, COLOR.edge).setStrokeStyle(2, COLOR.ink, 1);
      this.dots.push(d);
      this.inner.add(d);
    });
    this.named['help:prev'] = this.prevBtn;
    this.named['help:next'] = this.nextBtn;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'ArrowLeft') this.prevBtn.press();
      else if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'NumpadEnter') this.nextBtn.press();
    };
    scene.input.keyboard?.on('keydown', onKey);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.keyboard?.off('keydown', onKey));
    this.go(0, true);
  }

  /** 当前第几页（0 起，自动化用）。 */
  get current(): number {
    return this.page;
  }

  private go(i: number, first = false): void {
    if (i < 0 || i >= HELP_PAGES.length) return;
    if (!first) sound.ui('select');
    this.page = i;
    const p = HELP_PAGES[i]!;
    const s = this.scene;
    this.pageBox.removeAll(true);
    if (p.id === 'ext') {
      this.extPage(p.short, p.body);
      this.prevBtn.setEnabled(i > 0);
      this.nextBtn.setLabel(i + 1 < HELP_PAGES.length ? '下一页' : '知道了');
      this.dots.forEach((d, k) => d.setFillStyle(k === i ? COLOR.accent : COLOR.edge));
      return;
    }
    const key = guideKey(p.id as (typeof GUIDE_PAGES)[number]);
    const px0 = this.picX;
    const py0 = this.picY;
    // 插图（连同纸条上的标题）画在自己的容器里，手机世界窄时整体缩小
    const pic = s.add.container(px0, py0).setScale(this.picK);
    if (hasArt(s.textures, key)) pic.add(addImage(s, PIC_W / 2, PIC_H / 2, key, PIC_W, PIC_H));
    else pic.add(this.sketch(p.id));
    // 标题写在插图下方留白的纸条上，上下居中（0–226 是画）
    pic.add(addText(s, 24, (STRIP_TOP + PIC_H) / 2, p.title, { size: 20, bold: true, color: COLOR.accentDark, originY: 0.5 }));
    this.pageBox.add(pic);
    // 手机：一句话、要点签竖着放在插图右边一栏
    const colW = this.dw - 24 - this.rx;
    const colX = this.rx + colW / 2;
    let chipY = PIC_Y + PIC_H + 70;
    if (this.phone) {
      const top = py0 + 10;
      const made = p.short
        ? addText(s, colX, top, p.short, { size: TYPE.title, bold: true, color: COLOR.ink, originX: 0.5, align: 'center', wrap: colW, lineSpacing: 4 })
        : this.cycle(top + 14, colX, colW);
      this.pageBox.add(made);
      chipY = top + (made instanceof Phaser.GameObjects.Text ? made.height : (made.getData('h') as number)) + 22;
    } else if (p.short) this.pageBox.add(addText(s, W / 2, PIC_Y + PIC_H + 40, p.short, { size: TYPE.title, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5 }));
    else this.pageBox.add(this.cycle(PIC_Y + PIC_H + 40));
    // 0.5.1：三枚要点签（图标 + 两三个字），把悬停里的完整说明拆成能一眼看到的几点
    const pts = HELP_POINTS[p.id] ?? [];
    const made = pts.map(([g, t, c]) => iconChip(s, 0, 0, g, t, { color: c === 'up' ? COLOR.up : c === 'down' ? COLOR.danger : COLOR.ink }));
    if (this.phone) {
      // 一枚一行，左边对齐、整组在右栏里居中
      const widest = made.reduce((n, m) => Math.max(n, m.w), 0);
      for (const m of made) {
        m.node.setPosition(colX - widest / 2, chipY);
        this.pageBox.add(m.node);
        chipY += 42;
      }
    } else {
      const total = made.reduce((n, m) => n + m.w, 0) + Math.max(0, made.length - 1) * 12;
      let px = W / 2 - total / 2;
      for (const m of made) {
        m.node.setPosition(px, chipY);
        this.pageBox.add(m.node);
        px += m.w + 12;
      }
    }
    // 完整说明在插图的悬停里
    const pw = PIC_W * this.picK;
    const phh = PIC_H * this.picK;
    const hit = s.add.rectangle(px0, py0, pw, phh, 0xffffff, 0.001).setOrigin(0, 0);
    bindTooltip(hit, () => ({ x: this.inner.x + px0, y: this.inner.y + py0, w: pw, h: phh }), () => ({ title: p.title, body: p.body }));
    this.pageBox.add(hit);
    this.prevBtn.setEnabled(i > 0);
    this.nextBtn.setLabel(i + 1 < HELP_PAGES.length ? '下一页' : '知道了');
    this.dots.forEach((d, k) => d.setFillStyle(k === i ? COLOR.accent : COLOR.edge));
  }

  /**
   * 风口五档排成一排（第一页的「一句话」）：彩色小签 + 箭头。
   * 给了 maxW（手机右栏）时放不下就折行，每行居中在 cx；容器的 data 'h' 是总高。
   */
  private cycle(cy: number, cx = W / 2, maxW = Infinity): Phaser.GameObjects.Container {
    const s = this.scene;
    const c = s.add.container(0, 0);
    const feels = ['cold', 'warming', 'hot', 'overheated', 'cooling'] as const;
    const parts: { w: number; draw: (x: number) => void; arrow?: boolean }[] = [];
    feels.forEach((f, i) => {
      const label = addText(s, 0, cy, FEEL_WORD[f], { size: TYPE.label + 1, bold: true, color: textOn(FEEL_COLOR[f]), originX: 0.5, originY: 0.5 });
      const w = label.width + 20;
      parts.push({
        w,
        draw: (x) => {
          c.add(addPill(s, x, cy - 14, w, 28, FEEL_COLOR[f]));
          label.setX(x + w / 2);
          c.add(label);
        },
      });
      if (i < feels.length - 1) parts.push({ w: 22, arrow: true, draw: (x) => c.add(addText(s, x + 11, cy, '→', { size: TYPE.label + 2, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 })) });
    });
    if (maxW === Infinity) {
      const total = parts.reduce((a, p) => a + p.w + 4, -4);
      let x = cx - total / 2;
      for (const p of parts) {
        p.draw(x);
        x += p.w + 4;
      }
      return c.setData('h', 28);
    }
    // 折行：按宽度分行，再逐行居中；画在 cy 上的内容整行下移
    const rows: (typeof parts)[] = [[]];
    let used = 0;
    for (const p of parts) {
      const row = rows[rows.length - 1]!;
      if (row.length > 0 && used + 4 + p.w > maxW) {
        rows.push([p]);
        used = p.w;
      } else {
        row.push(p);
        used += (row.length > 1 ? 4 : 0) + p.w;
      }
    }
    // 箭头不留在行尾：挪到下一行开头（「→ 太火 → 降温」）
    for (let r = 0; r + 1 < rows.length; r++) {
      const row = rows[r]!;
      if (row[row.length - 1]?.arrow) rows[r + 1]!.unshift(row.pop()!);
    }
    rows.forEach((row, r) => {
      const total = row.reduce((a, p) => a + p.w + 4, -4);
      let x = cx - total / 2;
      const before = c.list.length;
      for (const p of row) {
        p.draw(x);
        x += p.w + 4;
      }
      for (const o of c.list.slice(before)) (o as unknown as Phaser.GameObjects.Components.Transform).y += r * 38;
    });
    return c.setData('h', rows.length * 38 - 10);
  }

  /** 新玩法页：三张卡（买多少 / 押跌 / 银行）：大图标 + 名字 + 一句短话，完整说明在悬停里。 */
  private extPage(short: string, body: string): void {
    const s = this.scene;
    const longs = new Map(body.split('\n').map((l) => l.split('|') as [string, string]));
    const heads = [...longs.keys()];
    const lines = short.split('\n');
    const gap = 16;
    // 手机：三张卡矮一些（翻页按钮在卡片下面），图标、字的位置跟着收紧
    const ph = this.phone;
    const side = ph ? 24 : 32;
    const cw = (this.dw - side * 2 - gap * 2) / 3;
    const y = ph ? 66 : 90;
    const ch = ph ? 210 : 330;
    const k = ph ? { cy: 62, r: 48, g: 76, head: 122, text: 164 } : { cy: 100, r: 66, g: 104, head: 200, text: 250 };
    lines.forEach((line, i) => {
      const [g, text] = line.split('|') as [Glyph, string];
      const head = heads[i] ?? '';
      const x = side + i * (cw + gap);
      this.pageBox.add(s.add.rectangle(x, y, cw, ch, COLOR.paperHi).setOrigin(0, 0).setRounded(18).setStrokeStyle(3, COLOR.edge, 1));
      this.pageBox.add(s.add.circle(x + cw / 2, y + k.cy, k.r, COLOR.paperLo).setStrokeStyle(2, COLOR.edge, 1));
      this.pageBox.add(addGlyph(s, x + cw / 2, y + k.cy, g, k.g));
      this.pageBox.add(addText(s, x + cw / 2, y + k.head, head, { size: TYPE.big - 4, bold: true, color: COLOR.accentDark, originX: 0.5 }));
      this.pageBox.add(addText(s, x + cw / 2, y + k.text, text, { size: TYPE.label + 2, color: COLOR.ink, originX: 0.5, align: 'center', wrap: cw - 36, lineSpacing: 4 }));
      const hit = s.add.rectangle(x, y, cw, ch, 0xffffff, 0.001).setOrigin(0, 0);
      bindTooltip(hit, () => ({ x: this.inner.x + x, y: this.inner.y + y, w: cw, h: ch }), () => ({ title: head, body: longs.get(head) ?? '' }));
      this.pageBox.add(hit);
    });
  }

  /** 没有插图时的示意图（同样的构图：上方画，下方留纸条）。 */
  private sketch(id: (typeof GUIDE_PAGES)[number] | 'ext'): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    // 画在插图容器里（原点是插图左上角）
    const PIC_X = 0;
    const PIC_Y = 0;
    const out: Phaser.GameObjects.GameObject[] = [];
    out.push(s.add.rectangle(PIC_X, PIC_Y, PIC_W, PIC_H, 0xfff6e3).setOrigin(0, 0).setRounded(16).setStrokeStyle(3, COLOR.ink, 1));
    out.push(s.add.rectangle(PIC_X + 3, PIC_Y + 3, PIC_W - 6, 223, id === 'sell' ? 0xe9eef7 : 0xfde9c9).setOrigin(0, 0).setRounded(14));
    const feels = ['cold', 'warming', 'hot', 'overheated', 'cooling'] as const;
    const chip = (x: number, y: number, f: (typeof feels)[number], big = false): void => {
      const label = addText(s, 0, y, FEEL_WORD[f], { size: big ? 16 : 14, bold: true, color: textOn(FEEL_COLOR[f]), originX: 0.5, originY: 0.5 });
      const icon = hasArt(s.textures, stageIconKey(f));
      const w = label.width + 22 + (icon ? 22 : 0);
      out.push(addPill(s, x - w / 2, y - 15, w, 30, FEEL_COLOR[f]));
      if (icon) out.push(addImage(s, x - w / 2 + 18, y, stageIconKey(f), 20));
      label.setX(x + (icon ? 11 : 0));
      out.push(label);
    };
    const cy = PIC_Y + 113;
    if (id === 'rotation') {
      // 五档围成一圈
      const r = 82;
      feels.forEach((f, i) => {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / feels.length;
        chip(PIC_X + PIC_W / 2 + Math.cos(a) * r * 1.9, cy + Math.sin(a) * r, f);
      });
      out.push(addText(s, PIC_X + PIC_W / 2, cy, '轮流', { size: 22, bold: true, color: COLOR.muted, originX: 0.5, originY: 0.5 }));
    } else if (id === 'buy') {
      chip(PIC_X + 110, cy - 40, 'warming', true);
      out.push(addText(s, PIC_X + 110, cy + 10, '热度 ↑', { size: 28, bold: true, color: COLOR.up, originX: 0.5, originY: 0.5 }));
      out.push(addText(s, PIC_X + 260, cy, '→', { size: 40, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5 }));
      out.push(addText(s, PIC_X + 400, cy - 30, '股票 ↑', { size: 28, bold: true, color: COLOR.up, originX: 0.5, originY: 0.5 }));
      out.push(addText(s, PIC_X + 400, cy + 20, '账户 ↑', { size: 24, bold: true, color: COLOR.up, originX: 0.5, originY: 0.5 }));
    } else {
      chip(PIC_X + 110, cy - 50, 'overheated', true);
      out.push(addText(s, PIC_X + 110, cy, '↓', { size: 30, bold: true, color: COLOR.ink, originX: 0.5, originY: 0.5 }));
      chip(PIC_X + 110, cy + 50, 'cooling', true);
      out.push(addText(s, PIC_X + 210, cy, '先卖', { size: 22, bold: true, color: COLOR.accentDark, originX: 0.5, originY: 0.5 }));
      out.push(s.add.rectangle(PIC_X + 300, cy - 60, 170, 120, 0xffffff).setOrigin(0, 0).setRounded(10).setStrokeStyle(3, COLOR.ink, 1));
      out.push(addText(s, PIC_X + 385, cy - 30, '月底还钱', { size: 20, bold: true, originX: 0.5, originY: 0.5 }));
      out.push(addText(s, PIC_X + 385, cy + 10, '还不上 = 游戏结束', { size: 14, color: COLOR.danger, originX: 0.5, originY: 0.5 }));
    }
    return out;
  }
}
