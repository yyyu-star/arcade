import Phaser from 'phaser';
import type { Regime } from '../../core/index.ts';
import { avatarKey, hasArt, stockKey, type Glyph } from '../assets.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph, addImage, addPill } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { Dialog, phonePanel } from '../ui/dialog.ts';
import { addText } from '../ui/text.ts';
import { chipLine } from './bits.ts';
import { phoneLayout } from '../viewport.ts';

const W = 960;
const H = 640;
/**
 * 手机横屏（世界高 404、宽 718–960）：面板大小按 phonePanel（SE 702×392），标题小一号；故事一行一张纸条（矮一些），放不下时分页，
 * 标题行右边两个小按钮翻页（命名 reveal:prev / reveal:next）。
 */
const PHONE_UI = { top: 104, bottomGap: 78, rowMin: 40 } as const;

const REGIME_COLOR: Record<Regime, number> = {
  bull: 0xd8453b,
  bubble: 0xe08a1e,
  flat: 0x8a8f98,
  bear: 0x2f8f5b,
  crash: 0x5b3f9e,
};

/** 每句故事配图的类别（与规则层 reveal.ts 的 StoryKind 一致；画面只认这几种）。 */
interface Mark {
  kind: string;
  ref?: string;
}

interface StoryPanelData {
  title: string;
  regime: Regime;
  regimeWord: string;
  lines: readonly string[];
  verdict: string;
  /** 0.5：每句是哪一类（配图标 / 小人 / 群友头像）；缺省按位置猜 */
  marks?: readonly Mark[];
}

/** 0.18.0 这段日子的心情图：天气 + 一张脸（以前只有市况签上的小箭头，整块面板看不出是牛是熊） */
const REGIME_MOOD: Record<Regime, [Glyph, Glyph]> = {
  bull: ['sun', 'face_happy'],
  bubble: ['rocket', 'face_hot'],
  flat: ['cloud', 'face_calm'],
  bear: ['rain', 'face_sad'],
  crash: ['storm', 'face_cold'],
};

const UP_REGIME = new Set<Regime>(['bull', 'bubble']);
const DOWN_REGIME = new Set<Regime>(['bear', 'crash']);

/**
 * 0.4 重做、0.5 美化：局末"这段日子"（真实行情局）。不揭晓年份和真身，只讲一个用花名写的小故事。
 * 0.5：每句一张小纸条，左边配图（日历、闪电、赚钱的小人、群友头像……），句子里的数字高亮成色块；
 * 结尾一句大字吐槽和"知道了"。
 */
export class RevealPanel extends Dialog {
  constructor(scene: Phaser.Scene, v: StoryPanelData, onClosed?: () => void) {
    const phone = phoneLayout(scene);
    const pp = phone ? phonePanel(scene) : null;
    super(scene, pp ? pp.w : W, pp ? pp.h : H, '这段日子', onClosed);
    const s = scene;
    const L = 36;
    // 手机：标题和市况签上移、小一号，给故事多留一行
    const ty = phone ? 64 : 74;
    const title = addText(s, L, ty, `「${v.title}」`, { size: phone ? 20 : 24, bold: true, color: COLOR.accentDark });
    this.inner.add(title);
    const pill = addPill(s, L + title.width + 12, ty + (phone ? 0 : 2), 84, phone ? 28 : 30, REGIME_COLOR[v.regime]);
    this.inner.add(pill);
    const py = phone ? ty + 14 : 91;
    const rg: Glyph = UP_REGIME.has(v.regime) ? 'arrow_up' : DOWN_REGIME.has(v.regime) ? 'arrow_down' : 'hourglass';
    this.inner.add(addGlyph(s, pill.x + 18, py, rg, 22, rg === 'hourglass' ? undefined : COLOR.white));
    this.inner.add(addText(s, pill.x + 52, py, v.regimeWord, { size: TYPE.label + 2, bold: true, color: COLOR.white, originX: 0.5, originY: 0.5 }));
    // 电脑放右上角的空处，大一点；手机标题行右边有翻页键，放在市况签后面
    const [sky, face] = REGIME_MOOD[v.regime];
    const mx = phone ? pill.x + 84 + 30 : W - L - 70;
    const my = phone ? py : 84;
    const ms = phone ? 36 : 64;
    this.inner.add(s.add.circle(mx, my, ms * 0.62, REGIME_COLOR[v.regime], 0.16));
    this.inner.add(addGlyph(s, mx, my, sky, ms));
    this.inner.add(addGlyph(s, mx + ms * 0.42, my + ms * 0.3, face, ms * 0.5));
    const marks = v.lines.map((_, i) => v.marks?.[i] ?? this.guess(i, v.lines.length));
    if (phone) {
      this.phoneBody(v, marks);
      return;
    }

    // 故事：一句一张纸条；放不下就把字缩小一号
    const top = 122;
    const bottom = H - 104;
    const body = s.add.container(0, 0);
    this.inner.add(body);
    for (const size of [17, 16, 15, 14]) {
      body.removeAll(true);
      let y = top;
      const gap = size >= 16 ? 8 : 5;
      v.lines.forEach((line, i) => {
        const tx = L + 66;
        const { box, height } = chipLine(s, line, W - tx - L - 16, { size, chip: this.chipColor(marks[i]) });
        const rowH = Math.max(46, height + 8);
        const bg = s.add.rectangle(L, y, W - 2 * L, rowH, i % 2 === 0 ? COLOR.paperHi : COLOR.paperLo, 0.85).setOrigin(0, 0).setRounded(14);
        body.add(bg);
        body.add(this.icon(marks[i] as Mark, v, L + 30, y + rowH / 2));
        box.setPosition(tx, y + (rowH - height) / 2 + 2);
        body.add(box);
        y += rowH + gap;
      });
      if (y <= bottom) break;
    }

    // 底：结局一句大字、知道了
    this.inner.add(addGlyph(s, L + 18, H - 58, 'star', 34));
    this.inner.add(addText(s, L + 44, H - 58, v.verdict, { size: 22, bold: true, color: COLOR.accentDark, wrap: W - 2 * L - 220, originY: 0.5 }));
    const ok = new Button(s, W - L - 150, H - 82, { width: 150, height: 48, label: '知道了', variant: 'primary', fontSize: 17, hotkey: '空格' });
    ok.setHandler(() => this.close());
    this.inner.add(ok);
    this.named['reveal:close'] = ok;
  }

  /**
   * 手机：故事纸条矮一些（最矮 40）；16 → 14 号一页放得下就一页，否则按 14 号分页。
   * 底部是结局一句和「知道了」（命名 reveal:close，和电脑一样）。
   */
  private phoneBody(v: StoryPanelData, marks: Mark[]): void {
    const s = this.scene;
    const L = 28;
    const w = this.dw;
    const h = this.dh;
    const top = PHONE_UI.top;
    const bottom = h - PHONE_UI.bottomGap;
    const tx = L + 56;
    const wrap = w - tx - L - 16;
    const gap = 5;
    const heights = (size: number): number[] =>
      v.lines.map((line, i) => {
        const { box, height } = chipLine(s, line, wrap, { size, chip: this.chipColor(marks[i]) });
        box.destroy();
        return Math.max(PHONE_UI.rowMin, height + 6);
      });
    let size = 14;
    let hs = heights(14);
    for (const sz of [16, 15]) {
      const hh = heights(sz);
      if (top + hh.reduce((a, b) => a + b + gap, 0) <= bottom) {
        size = sz;
        hs = hh;
        break;
      }
    }
    const pages: number[][] = [[]];
    let used = 0;
    hs.forEach((rh, i) => {
      const cur = pages[pages.length - 1]!;
      if (cur.length > 0 && top + used + rh > bottom) {
        pages.push([i]);
        used = rh + gap;
      } else {
        cur.push(i);
        used += rh + gap;
      }
    });
    const body = s.add.container(0, 0);
    this.inner.add(body);
    const draw = (k: number): void => {
      body.removeAll(true);
      delete this.named['reveal:prev'];
      delete this.named['reveal:next'];
      let y = top;
      for (const i of pages[k] ?? []) {
        const rowH = hs[i]!;
        const { box, height } = chipLine(s, v.lines[i]!, wrap, { size, chip: this.chipColor(marks[i]) });
        body.add(s.add.rectangle(L, y, w - 2 * L, rowH, i % 2 === 0 ? COLOR.paperHi : COLOR.paperLo, 0.85).setOrigin(0, 0).setRounded(12));
        body.add(this.icon(marks[i] as Mark, v, L + 26, y + rowH / 2, 0.82));
        box.setPosition(tx, y + (rowH - height) / 2 + 2);
        body.add(box);
        y += rowH + gap;
      }
      if (pages.length <= 1) return;
      // 翻页：标题行右边（右上角的 × 左边）
      const right = w - 64;
      const prev = new Button(s, right - 96, 56, { width: 44, height: 38, label: '‹', fontSize: 20, sound: 'select' });
      const next = new Button(s, right - 46, 56, { width: 44, height: 38, label: '›', fontSize: 20, sound: 'select' });
      prev.setEnabled(k > 0);
      next.setEnabled(k < pages.length - 1);
      prev.setHandler(() => draw(k - 1));
      next.setHandler(() => draw(k + 1));
      body.add([prev, next, addText(s, right - 106, 75, `${k + 1}/${pages.length}`, { size: 14, bold: true, num: true, color: COLOR.muted, originX: 1, originY: 0.5 })]);
      this.named['reveal:prev'] = prev;
      this.named['reveal:next'] = next;
    };
    draw(0);
    // 底：结局一句、知道了
    this.inner.add(addGlyph(s, L + 18, h - 44, 'star', 30));
    this.inner.add(addText(s, L + 42, h - 44, v.verdict, { size: 20, bold: true, color: COLOR.accentDark, wrap: w - 2 * L - 220, originY: 0.5 }));
    const ok = new Button(s, w - L - 150, h - 68, { width: 150, height: 46, label: '知道了', variant: 'primary', fontSize: 17, hotkey: '空格' });
    ok.setHandler(() => this.close());
    this.inner.add(ok);
    this.named['reveal:close'] = ok;
  }

  /** 没有 marks（旧存档）时按位置猜：第一句开头、最后一句结局，其余算大事。 */
  private guess(i: number, n: number): Mark {
    return { kind: i === 0 ? 'open' : i === n - 1 ? 'end' : 'beat' };
  }

  private chipColor(m: Mark | undefined): number {
    if (m?.kind === 'worst') return COLOR.down;
    if (m?.kind === 'best') return COLOR.up;
    return COLOR.accent;
  }

  /** 每句左边的配图：小人、群友头像或小图标，放在一个圆形底座上。 */
  private icon(m: Mark, v: StoryPanelData, x: number, y: number, k = 1): Phaser.GameObjects.GameObject[] {
    const s = this.scene;
    // k：手机上纸条矮，配图整体小一点（只有图，没有字）
    const out: Phaser.GameObjects.GameObject[] = [s.add.circle(x, y, 21 * k, COLOR.paper).setStrokeStyle(2, COLOR.edge, 1)];
    const glyph = (g: Glyph, tint?: number): void => {
      out.push(addGlyph(s, x, y, g, 32 * k, tint));
    };
    switch (m.kind) {
      case 'open':
        glyph('calendar');
        break;
      case 'market':
        if (UP_REGIME.has(v.regime)) glyph('arrow_up', COLOR.up);
        else if (DOWN_REGIME.has(v.regime)) glyph('arrow_down', COLOR.down);
        else glyph('hourglass');
        break;
      case 'beat':
        glyph('bolt');
        break;
      case 'ext':
        glyph('bank');
        break;
      case 'best':
      case 'worst': {
        const key = m.ref ? stockKey(m.ref, m.kind === 'best' ? 'limitup' : 'limitdown') : '';
        if (key && hasArt(s.textures, key)) out.push(addImage(s, x, y, key, 44 * k));
        else if (m.kind === 'best') glyph('trophy');
        else glyph('arrow_down', COLOR.down);
        break;
      }
      case 'friend': {
        const key = m.ref ? avatarKey(m.ref, 'normal') : '';
        if (key && hasArt(s.textures, key)) out.push(addImage(s, x, y, key, 38 * k));
        else glyph('horn');
        break;
      }
      case 'idle':
        glyph('hourglass');
        break;
      case 'end':
        glyph(m.ref === 'won' ? 'trophy' : 'bear');
        break;
      default:
        glyph('book');
    }
    return out;
  }
}
