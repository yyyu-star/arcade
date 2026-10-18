import Phaser from 'phaser';
import type { Glyph } from '../assets.ts';
import { COLOR, TYPE } from '../theme.ts';
import { addGlyph } from '../ui/art.ts';
import type { Button } from '../ui/button.ts';
import { addText } from '../ui/text.ts';
import { bindTooltip, type TipContent } from '../ui/tooltip.ts';
import type { Rect } from '../rect.ts';

/**
 * 0.5 去文字化：长线界面（开局、结束页、图鉴、怎么玩……）共用的小零件。
 */

/** 「¥10万」「¥9.4万」「¥30万」：本钱、账户的短写法（一位小数，去掉 .0）。 */
export function wanShort(v: number): string {
  const w = Math.round(v / 1000) / 10;
  return `¥${w}万`;
}

/** 给按钮绑悬停说明（按钮自己的点击区域照常响应点击）。 */
export function tipOnButton(btn: Button, rect: () => Rect, content: () => TipContent | null): void {
  const hit = [...btn.list].reverse().find((o): o is Phaser.GameObjects.Rectangle => o instanceof Phaser.GameObjects.Rectangle && !!o.input);
  if (hit) bindTooltip(hit, rect, content);
}

/**
 * 图标数字格：图标在左，大数字在右上，短标签在右下。(x, y) 为左上角，返回整体容器与宽度。
 * 用在结束页战绩、标题页档案这类「一眼看数」的地方。
 */
export function statTile(
  scene: Phaser.Scene,
  x: number,
  y: number,
  g: Glyph,
  value: string,
  label: string,
  opts: { color?: number; w?: number; icon?: number; size?: number; bg?: boolean; tint?: number; stacked?: boolean } = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const icon = opts.icon ?? 40;
  const w = opts.w ?? 180;
  const h = opts.stacked ? 54 : icon + 16;
  if (opts.bg !== false) c.add(scene.add.rectangle(0, 0, w, h, COLOR.paperHi, 0.9).setOrigin(0, 0).setRounded(14).setStrokeStyle(2, COLOR.edge, 1));
  // 窄格（手机结束页一格约 110 宽）：小图标和标签在上面一行，数字单独一行（金额由调用方写成短的，数字不截）
  if (opts.stacked) {
    c.add(addGlyph(scene, 8 + icon / 2, 6 + icon / 2, g, icon, opts.tint));
    if (label) c.add(addText(scene, 14 + icon, 6 + icon / 2, label, { size: TYPE.label, color: COLOR.muted, originY: 0.5 }));
    c.add(addText(scene, 10, h - 5, value, { size: opts.size ?? TYPE.title, bold: true, num: true, color: opts.color ?? COLOR.ink, originY: 1 }));
    c.setSize(w, h);
    return c;
  }
  c.add(addGlyph(scene, 8 + icon / 2, h / 2, g, icon, opts.tint));
  const tx = 16 + icon;
  // 没有标签时数字垂直居中
  c.add(addText(scene, tx, label ? h / 2 + 1 : h / 2, value, { size: opts.size ?? TYPE.title + 4, bold: true, num: true, color: opts.color ?? COLOR.ink, originY: label ? 1 : 0.5 }));
  if (label) c.add(addText(scene, tx, h / 2 + 3, label, { size: TYPE.label, color: COLOR.muted }));
  c.setSize(w, h);
  return c;
}

/**
 * 一行带「数字色块」的短句：句子里的百分比、¥ 金额、「N 回 / N 次 / N 个月」等数字高亮成色块。
 * 返回容器（左上角原点）和实际高度；超出 wrap 宽度时按色块和文字片段折行。
 */
export function chipLine(scene: Phaser.Scene, text: string, wrap: number, opts: { size?: number; color?: number; chip?: number } = {}): { box: Phaser.GameObjects.Container; height: number } {
  const size = opts.size ?? 16;
  const box = scene.add.container(0, 0);
  const re = /([+-]?¥?\d[\d,.]*\s?(?:%|万|回|次|天|个月|倍)?)/g;
  const parts: { t: string; num: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ t: text.slice(last, i), num: false });
    parts.push({ t: (m[0] as string).replace(/\s/g, ''), num: true });
    last = i + (m[0] as string).length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), num: false });
  const lineH = size + 14;
  let x = 0;
  let y = 0;
  const place = (chip: Phaser.GameObjects.Container, w: number): void => {
    if (x > 0 && x + w > wrap) {
      x = 0;
      y += lineH;
    }
    chip.setPosition(x, y);
    box.add(chip);
    x += w;
  };
  for (const p of parts) {
    if (p.num) {
      const t = addText(scene, 0, 0, p.t, { size, bold: true, num: true, color: COLOR.white });
      const pad = 7;
      const chip = scene.add.container(0, 0);
      chip.add(scene.add.rectangle(-1, 1, t.width + pad * 2, size + 10, opts.chip ?? COLOR.accent).setOrigin(0, 0).setRounded(8).setStrokeStyle(1.5, COLOR.ink, 1));
      t.setPosition(pad - 1, 5);
      chip.add(t);
      place(chip, t.width + pad * 2 + 4);
      continue;
    }
    // 普通文字：逐字放，放不下就换行（中文按字断）
    let buf = '';
    const flush = (): void => {
      if (!buf) return;
      const t = addText(scene, 0, 0, buf, { size, color: opts.color ?? COLOR.ink });
      t.setPosition(x, y + 5);
      box.add(t);
      x += t.width;
      buf = '';
    };
    const measure = addText(scene, -9999, -9999, '', { size });
    for (const ch of Array.from(p.t)) {
      measure.setText(buf + ch);
      if (x + measure.width > wrap && buf.length > 0 && !'，。、；：？！）」'.includes(ch)) {
        flush();
        x = 0;
        y += lineH;
      }
      buf += ch;
    }
    measure.destroy();
    flush();
  }
  return { box, height: y + lineH };
}
