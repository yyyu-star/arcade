import Phaser from 'phaser';
import { COLOR, FONT, FONT_NUM, PHONE, RENDER_SCALE, css } from '../theme.ts';
import { phoneLayout } from '../viewport.ts';

interface TextOpts {
  size?: number;
  color?: number;
  bold?: boolean;
  /** 使用数字字体 */
  num?: boolean;
  align?: 'left' | 'center' | 'right';
  /** 自动换行宽度（按字符断行，适合中文） */
  wrap?: number;
  lineSpacing?: number;
  originX?: number;
  originY?: number;
  /** 描边色与粗细（压在图片上的文字用） */
  stroke?: number;
  strokeWidth?: number;
}


/** 不能出现在行首的标点。 */
const NO_LINE_START = new Set('，。、；：？！）》」』%,.;:?!)'.split(''));
/** 不能留在行尾的标点。 */
const NO_LINE_END = new Set('（《「『('.split(''));

/**
 * 按字符断行：中文没有空格，Phaser 自带的按单词换行不适用。
 * 英文/数字连续片段尽量不拆开，行首避开标点。
 */
function cjkWrap(text: string, obj: Phaser.GameObjects.Text, width: number): string[] {
  const ctx = obj.context;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    // 切成「原子」：连续的 ASCII 字母数字作为一个整体，其余逐字符
    const atoms = para.match(/[A-Za-z0-9.¥+\-×%]+|./gu) ?? [];
    let line: string[] = [];
    for (const atom of atoms) {
      if (line.length > 0 && ctx.measureText(line.join('') + atom).width > width) {
        if (NO_LINE_START.has(atom) && line.length > 1) {
          // 把前面的片段带到下一行，避免标点开头（连续标点一起带走）
          const carry = [atom];
          do carry.unshift(line.pop() as string);
          while (line.length > 1 && NO_LINE_START.has(carry[0] as string));
          while (line.length > 1 && NO_LINE_END.has(line[line.length - 1] as string)) carry.unshift(line.pop() as string);
          out.push(line.join(''));
          line = carry;
        } else {
          const carry: string[] = [];
          while (line.length > 1 && NO_LINE_END.has(line[line.length - 1] as string)) carry.unshift(line.pop() as string);
          out.push(line.join('').trimEnd());
          line = atom.trim() === '' ? carry : [...carry, atom];
        }
      } else {
        line.push(atom);
      }
    }
    out.push(line.join(''));
  }
  return out;
}

/**
 * 最小字号：再小在手机和 1 倍屏上就糊成一团（0.5.2 统一抬到 11）。
 * 手机横屏（0.5.5）：960×444 的世界在 844×390 的屏幕上约 0.88 倍，13 号字显示出来约 11.4 像素，和电脑上的 11 号相当。
 */
export const MIN_TEXT_SIZE = PHONE ? 13 : 11;
/**
 * 0.19.0 手机上数字的最小字号：清单要数字 ≥ 14 像素，新手机世界在最小的 SE 上是 0.928 倍，16 号约 14.8px。
 */
export const MIN_NUM_SIZE_PHONE = 16;
/** 只有数字、金额、涨跌符号的文字（没标 num 的也按数字算最小字号） */
const NUMERIC = /^[\s¥+\-−↑↓%.,0-9万亿×/:]*[0-9][\s¥+\-−↑↓%.,0-9万亿×/:]*$/;

export function addText(scene: Phaser.Scene, x: number, y: number, content: string, opts: TextOpts = {}): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: opts.num ? FONT_NUM : FONT,
    fontSize: `${Math.max((opts.num || NUMERIC.test(content)) && phoneLayout(scene) ? MIN_NUM_SIZE_PHONE : MIN_TEXT_SIZE, opts.size ?? 14)}px`,
    fontStyle: opts.bold ? 'bold' : 'normal',
    color: css(opts.color ?? COLOR.ink),
    align: opts.align ?? 'left',
    // 与相机 zoom 一致，文字纹理按实际像素栅格化
    resolution: RENDER_SCALE,
    lineSpacing: opts.lineSpacing ?? 4,
  };
  const wrapWidth = opts.wrap;
  if (wrapWidth !== undefined) {
    style.wordWrap = { callback: (t: string, obj: Phaser.GameObjects.Text) => cjkWrap(t, obj, wrapWidth) };
  }
  if (opts.stroke !== undefined) {
    style.stroke = css(opts.stroke);
    style.strokeThickness = opts.strokeWidth ?? 4;
  }
  const t = scene.add.text(x, y, content, style);
  t.setOrigin(opts.originX ?? 0, opts.originY ?? 0);
  return t;
}

/** 给已有文字加上按字符断行（中文）。 */
export function setWrap(t: Phaser.GameObjects.Text, width: number): Phaser.GameObjects.Text {
  return t.setWordWrapCallback((s: string, obj: Phaser.GameObjects.Text) => cjkWrap(s, obj, width));
}

/** 单行文字比 room 宽时从尾巴上截字、补省略号（至少留 min 个字）；没截就原样返回。 */
export function fitWidth(t: Phaser.GameObjects.Text, room: number, min = 2): Phaser.GameObjects.Text {
  let cut = Array.from(t.text);
  while (t.width > room && cut.length > min) {
    cut = cut.slice(0, -1);
    t.setText(`${cut.join('')}…`);
  }
  return t;
}

export function setColor(t: Phaser.GameObjects.Text, color: number): Phaser.GameObjects.Text {
  return t.setColor(css(color));
}
