/**
 * 界面小组件：文字、按钮、图标按钮、面板、弹窗、气泡、提示条。
 * 底板全用 Graphics 画（矢量，相机 zoom 后依然锐利），尺寸随用随定，不需要预烘焙贴图。
 */
import Phaser from 'phaser';
import { BUTTON, COLOR, FONT, FONT_NUM, FONT_TITLE, GAME_HEIGHT, RADIUS, RENDER_SCALE, SHADOW, TYPE, css, minHit } from '../theme.ts';
import { audio } from '../audio.ts';
import { focusable, pushLayer } from './focus.ts';

/**
 * 改点按区域（世界坐标，以对象中心为中心）：按钮、图标按钮、区域都能用。
 * 区域（Zone）的原点不一定在中心，按它自己的原点算。
 */
export function setHit(obj: Phaser.GameObjects.Container | Phaser.GameObjects.Zone, w: number, h: number): void {
  const cx = obj.x;
  const cy = obj.y;
  if (obj instanceof Phaser.GameObjects.Zone && (obj.originX !== 0.5 || obj.originY !== 0.5)) {
    const left = cx + obj.width * (0.5 - obj.originX) - w / 2;
    const top = cy + obj.height * (0.5 - obj.originY) - h / 2;
    obj.setOrigin(0, 0).setPosition(left, top);
  }
  obj.setSize(w, h);
  if (obj.input) obj.input.hitArea.setTo(0, 0, w, h);
  else obj.setInteractive({ useHandCursor: true });
}

export function worldW(scene: Phaser.Scene): number {
  return Math.round(scene.scale.gameSize.width / RENDER_SCALE);
}
export const worldH = GAME_HEIGHT;

export interface TextOpts {
  size?: number;
  color?: number;
  bold?: boolean;
  font?: 'body' | 'title' | 'num';
  align?: 'left' | 'center' | 'right';
  ox?: number;
  oy?: number;
  stroke?: number;
  strokeWidth?: number;
  /** 自动换行宽度（按字符断行） */
  wrap?: number;
  lineSpacing?: number;
  shadow?: boolean;
}

/** 中文按字符断行，行首避开标点。 */
function cjkWrap(text: string, obj: Phaser.GameObjects.Text, width: number): string[] {
  const ctx = obj.context;
  const out: string[] = [];
  const noStart = '，。、；：？！）》」%,.;:?!)';
  for (const para of text.split('\n')) {
    const atoms = para.match(/[A-Za-z0-9.+\-×%]+|./gu) ?? [];
    let line = '';
    for (const a of atoms) {
      if (line && ctx.measureText(line + a).width > width && !noStart.includes(a)) {
        out.push(line);
        line = a.trim() ? a : '';
      } else line += a;
    }
    out.push(line);
  }
  return out;
}

export function text(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOpts = {}): Phaser.GameObjects.Text {
  const family = o.font === 'title' ? FONT_TITLE : o.font === 'num' ? FONT_NUM : FONT;
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: family,
    fontSize: `${o.size ?? TYPE.body}px`,
    fontStyle: o.bold ? 'bold' : 'normal',
    color: css(o.color ?? COLOR.ink),
    align: o.align ?? 'center',
    resolution: RENDER_SCALE,
    lineSpacing: o.lineSpacing ?? 4,
  };
  if (o.stroke !== undefined) {
    style.stroke = css(o.stroke);
    style.strokeThickness = o.strokeWidth ?? 4;
  }
  if (o.shadow) style.shadow = { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.55)', blur: 4, fill: true, stroke: true };
  const w = o.wrap;
  if (w !== undefined) style.wordWrap = { callback: (t: string, obj: Phaser.GameObjects.Text) => cjkWrap(t, obj, w) };
  return scene.add.text(x, y, str, style).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5);
}

/** 按比例调亮调暗（×f），和美术那边按 [-1,1] 往黑白拉的 shade 不同 */
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export type ButtonStyle = Exclude<keyof typeof BUTTON, 'off'>;

/**
 * 圆角按钮底板：漆面（0.10.0）。不用渐变填充（Canvas 渲染不支持），用几层叠出来：上半亮、下沿暗、顶上一道高光，金边外加一圈细亮线。
 * 按下时面板下沉 2、投影跟着收。
 */
function drawPlate(g: Phaser.GameObjects.Graphics, w: number, h: number, fill: number, rim: number, r: number = RADIUS.lg, pressed = false): void {
  g.clear();
  const dy = pressed ? 2 : 0;
  const top = -h / 2 + dy;
  const fh = h - 4;
  g.fillStyle(0x000000, SHADOW.alpha);
  g.fillRoundedRect(-w / 2, -h / 2 + SHADOW.dy + 1, w, h, r);
  g.fillStyle(shade(fill, 0.55), 1);
  g.fillRoundedRect(-w / 2, -h / 2 + 3 + dy, w, h - 3, r);
  g.fillStyle(shade(fill, 0.82), 1);
  g.fillRoundedRect(-w / 2, top, w, fh, r);
  g.fillStyle(fill, 1);
  g.fillRoundedRect(-w / 2, top, w, fh * 0.78, r);
  g.fillStyle(shade(fill, 1.14), 1);
  g.fillRoundedRect(-w / 2 + 2, top + 2, w - 4, fh * 0.46, { tl: r - 2, tr: r - 2, bl: 8, br: 8 });
  g.fillStyle(0xffffff, 0.22);
  g.fillRoundedRect(-w / 2 + 6, top + 4, w - 12, fh * 0.2, { tl: r - 5, tr: r - 5, bl: 4, br: 4 });
  g.lineStyle(2.5, rim, 0.95);
  g.strokeRoundedRect(-w / 2 + 1, top + 1, w - 2, fh - 2, r - 1);
  g.lineStyle(1, 0xffffff, 0.18);
  g.strokeRoundedRect(-w / 2 + 4, top + 4, w - 8, fh - 8, Math.max(2, r - 4));
}

/**
 * 按钮：常态、悬停（亮一点、放大一点）、按下（下沉、缩一点）、禁用（灰）、键盘焦点（focus.ts 画框）、加载中（转圈，点了没反应）。
 * 点按区域至少 minHit() 见方（画出来的可以小），挨得近的调用方用 setHit 收窄；按下和抬起都在它上面才算点了一下。
 */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  private icon: Phaser.GameObjects.Image | null = null;
  private spinner: Phaser.GameObjects.Graphics | null = null;
  private enabledFlag = true;
  private loadingFlag = false;
  private hover = false;
  private down = false;
  private styleName: ButtonStyle;
  readonly bw: number;
  readonly bh: number;
  onClick: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, style: ButtonStyle, onClick: () => void, iconKey?: string) {
    super(scene, x, y);
    this.bw = w;
    this.bh = h;
    this.styleName = style;
    this.onClick = onClick;
    this.bg = scene.add.graphics();
    this.add(this.bg);
    const st = BUTTON[style];
    const size = h >= 56 ? TYPE.title : TYPE.body;
    if (iconKey && scene.textures.exists(`icon:${iconKey}`)) {
      const isz = Math.round(h * 0.5);
      this.icon = scene.add.image(0, -2, `icon:${iconKey}`).setDisplaySize(isz, isz).setTint(st.text);
      this.add(this.icon);
    }
    this.label = text(scene, 0, -2, label, { size, color: st.text, bold: true, stroke: shade(st.fill, 0.5), strokeWidth: 3 });
    this.add(this.label);
    this.layoutContent();
    this.redraw();
    this.setHit(Math.max(w, minHit()), Math.max(h, minHit()));
    this.on('pointerover', () => {
      this.hover = true;
      this.redraw();
    });
    this.on('pointerout', () => {
      this.hover = false;
      this.down = false;
      this.redraw();
    });
    this.on('pointerdown', () => {
      if (!this.usable) return;
      this.down = true;
      this.redraw();
    });
    this.on('pointerup', () => {
      const was = this.down;
      this.down = false;
      this.redraw();
      if (was) this.press();
    });
    focusable(this, w, h, () => this.press(), () => this.usable);
    scene.add.existing(this);
  }

  /** 点按区域（世界坐标，以按钮中心为中心）；默认至少 minHit() 见方，挨得近的调用方按间距收窄 */
  setHit(w: number, h: number): this {
    setHit(this, w, h);
    return this;
  }

  private get usable(): boolean {
    return this.enabledFlag && !this.loadingFlag;
  }

  private press(): void {
    if (!this.usable) return;
    audio.sfx('click');
    this.onClick();
  }

  private layoutContent(): void {
    if (this.icon && this.label.text) {
      const iw = this.icon.displayWidth;
      const total = iw + 8 + this.label.width;
      this.icon.x = -total / 2 + iw / 2;
      this.label.x = this.icon.x + iw / 2 + 8 + this.label.width / 2;
    } else if (this.icon) {
      this.icon.x = 0;
    }
  }

  private redraw(): void {
    const on = this.enabledFlag;
    const pressed = on && this.down;
    const st = on ? BUTTON[this.styleName] : BUTTON.off;
    const fill = on && this.hover && !pressed ? shade(st.fill, 1.1) : st.fill;
    drawPlate(this.bg, this.bw, this.bh, fill, st.rim, RADIUS.lg, pressed);
    const dy = pressed ? 2 : 0;
    this.label.y = -2 + dy;
    if (this.icon) this.icon.y = -2 + dy;
    if (this.spinner) this.spinner.y = -2 + dy;
    this.setScale(!this.usable ? 1 : pressed ? 0.97 : this.hover ? 1.03 : 1);
  }

  setText(s: string): this {
    this.label.setText(s);
    this.layoutContent();
    return this;
  }

  setEnabled(on: boolean): this {
    if (on === this.enabledFlag) return this;
    this.enabledFlag = on;
    const st = on ? BUTTON[this.styleName] : BUTTON.off;
    this.label.setColor(css(st.text));
    this.label.setStroke(css(on ? shade(st.fill, 0.5) : 0x3a302a), 3);
    this.icon?.setTint(st.text);
    if (!on) this.down = false;
    this.redraw();
    return this;
  }

  /** 加载中：字和图标淡下去，中间转圈；这期间点了不算（等钱包、开房这类要等回话的） */
  setLoading(on: boolean): this {
    if (on === this.loadingFlag) return this;
    this.loadingFlag = on;
    this.label.setAlpha(on ? 0.25 : 1);
    this.icon?.setAlpha(on ? 0.25 : 1);
    if (on) {
      const r = Math.min(14, this.bh * 0.24);
      const g = this.scene.add.graphics();
      g.lineStyle(4, BUTTON[this.styleName].text, 0.35).strokeCircle(0, 0, r);
      g.lineStyle(4, BUTTON[this.styleName].text, 1).beginPath().arc(0, 0, r, -Math.PI / 2, 0).strokePath();
      g.y = -2;
      this.add(g);
      this.spinner = g;
      this.scene.tweens.add({ targets: g, angle: 360, duration: 800, repeat: -1 });
    } else if (this.spinner) {
      this.scene.tweens.killTweensOf(this.spinner);
      this.spinner.destroy();
      this.spinner = null;
    }
    this.down = false;
    this.redraw();
    return this;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get loading(): boolean {
    return this.loadingFlag;
  }
}

/** 圆形木质图标按钮（顶栏用）。点按区域默认至少 minHit() 见方，挨得近的调用方用 setHit 收窄到间距。 */
export function iconButton(scene: Phaser.Scene, x: number, y: number, icon: string, onClick: () => void, size = 48): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  const paint = (lit: boolean): void => {
    g.clear();
    g.fillStyle(0x000000, SHADOW.alpha * 0.85).fillCircle(0, 3, r);
    g.fillStyle(0x4a2a14, 1).fillCircle(0, 0, r);
    g.fillStyle(lit ? 0x82502a : 0x6b3f20, 1).fillCircle(0, -1, r - 3);
    g.lineStyle(2, lit ? COLOR.goldLight : COLOR.gold, lit ? 1 : 0.85).strokeCircle(0, -1, r - 3);
  };
  paint(false);
  c.add(g);
  const img = scene.add.image(0, -1, `icon:${icon}`).setDisplaySize(size * 0.56, size * 0.56).setTint(0xffe9c2);
  c.add(img);
  const hit = Math.max(size + 8, minHit());
  setHit(c, hit, hit);
  let down = false;
  const press = (): void => {
    audio.sfx('click');
    onClick();
  };
  c.on('pointerover', () => {
    paint(true);
    c.setScale(1.06);
  });
  c.on('pointerout', () => {
    down = false;
    paint(false);
    c.setScale(1);
  });
  c.on('pointerdown', () => {
    down = true;
    c.setScale(0.94);
  });
  c.on('pointerup', () => {
    c.setScale(1);
    if (!down) return;
    down = false;
    press();
  });
  focusable(c, size, size, press);
  c.setData('icon', img);
  return c;
}

/** 纸面面板：木框 + 金线 + 象牙底，可带红色标题飘带。原点在面板中心。 */
export function panel(scene: Phaser.Scene, w: number, h: number, title?: string): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.4).fillRoundedRect(-w / 2 + 2, -h / 2 + 10, w, h, 22);
  g.fillStyle(0x4a2814, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 22);
  g.fillStyle(0x7a4a26, 1).fillRoundedRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 18);
  g.fillStyle(COLOR.paper, 1).fillRoundedRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 12);
  g.lineStyle(2, COLOR.gold, 1).strokeRoundedRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 15);
  g.lineStyle(1.5, 0xe2c99a, 1).strokeRoundedRect(-w / 2 + 20, -h / 2 + 20, w - 40, h - 40, 9);
  c.add(g);
  if (title) {
    const tw = Math.max(220, title.length * 34 + 90);
    const rg = scene.add.graphics();
    const ty = -h / 2 + 4;
    rg.fillStyle(0x000000, 0.3).fillRoundedRect(-tw / 2, ty - 22 + 4, tw, 50, 12);
    rg.fillStyle(COLOR.redDark, 1).fillTriangle(-tw / 2 - 26, ty - 10, -tw / 2 + 6, ty - 18, -tw / 2 + 6, ty + 22);
    rg.fillTriangle(tw / 2 + 26, ty - 10, tw / 2 - 6, ty - 18, tw / 2 - 6, ty + 22);
    rg.fillStyle(COLOR.red, 1).fillRoundedRect(-tw / 2, ty - 22, tw, 48, 12);
    rg.lineStyle(2, COLOR.gold, 1).strokeRoundedRect(-tw / 2 + 4, ty - 18, tw - 8, 40, 9);
    c.add(rg);
    c.add(text(scene, 0, ty + 1, title, { size: TYPE.title, color: COLOR.goldLight, bold: true, font: 'title', stroke: COLOR.redDark, strokeWidth: 3 }));
  }
  return c;
}

export interface Modal {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  close: () => void;
}

/** 弹窗：半透明遮罩挡住下面的点击 + 居中面板；返回 close。 */
export function modal(scene: Phaser.Scene, w: number, h: number, title?: string, opts: { closeBtn?: boolean; onClose?: () => void; depth?: number } = {}): Modal {
  const W = worldW(scene);
  const root = scene.add.container(0, 0).setDepth(opts.depth ?? 5000);
  const dim = scene.add.graphics();
  dim.fillStyle(COLOR.overlay, 0.62).fillRect(0, 0, W, worldH);
  // 遮罩挡住下面的点击
  const block = scene.add.zone(0, 0, W, worldH).setOrigin(0, 0).setInteractive();
  root.add([dim, block]);
  const body = panel(scene, w, h, title);
  body.setPosition(W / 2, worldH / 2 + (title ? 10 : 0));
  root.add(body);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    // 淡出期间整屏遮罩和里面的按钮立刻不接点击：机器一卡，120 毫秒的淡出会拖很久，这时点别的按钮会被看不见的遮罩吞掉
    //（手机冒烟"点大厅出确认框"偶发超时的根因）
    const off = (o: Phaser.GameObjects.GameObject): void => {
      if (o.input) o.disableInteractive();
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(off);
    };
    off(root);
    scene.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => root.destroy() });
    opts.onClose?.();
  };
  if (opts.closeBtn !== false) {
    const cb = iconButton(scene, w / 2 - 6, -h / 2 + 6, 'close', close, 46);
    body.add(cb);
  }
  // 键盘只在弹窗里走；能关的弹窗 Esc 关掉
  pushLayer(root, opts.closeBtn !== false ? close : undefined);
  root.setAlpha(0);
  body.setScale(0.92);
  scene.tweens.add({ targets: root, alpha: 1, duration: 140 });
  scene.tweens.add({ targets: body, scale: 1, duration: 200, ease: 'Back.easeOut' });
  return { root, body, close };
}

/** 一句话短提示：在 (x,y) 浮出、停留、淡出。同一位置的旧提示先移除。 */
let lastToast: Phaser.GameObjects.Container | null = null;
export function toast(scene: Phaser.Scene, msg: string, x: number, y: number, color: number = COLOR.ink): void {
  if (lastToast?.scene) lastToast.destroy();
  const c = scene.add.container(x, y).setDepth(4000);
  const t = text(scene, 0, 0, msg, { size: TYPE.body, color: 0xfff6e0, bold: true });
  const w = t.width + 40;
  const g = scene.add.graphics();
  g.fillStyle(color === COLOR.ink ? 0x2a1a10 : color, 0.9).fillRoundedRect(-w / 2, -22, w, 44, 22);
  g.lineStyle(2, COLOR.gold, 0.8).strokeRoundedRect(-w / 2, -22, w, 44, 22);
  c.add([g, t]);
  c.setAlpha(0);
  lastToast = c;
  scene.tweens.add({ targets: c, alpha: 1, y: y - 8, duration: 160 });
  scene.tweens.add({ targets: c, alpha: 0, delay: 1500, duration: 300, onComplete: () => c.destroy() });
}

/** 对话气泡。dir 表示尾巴指向（说话人在哪边）。 */
/** 气泡的样子：plain 是平常说话；spicy 是嘲讽（0.6.0，红边、淡红底，一眼看出是在逗人） */
export type BubbleTone = 'plain' | 'spicy';
const BUBBLE: Record<BubbleTone, { fill: number; line: number; ink: number }> = {
  plain: { fill: 0xfffaf0, line: 0x5a3a20, ink: COLOR.ink },
  spicy: { fill: 0xffe4d8, line: 0xc8202a, ink: COLOR.redDark },
};

export function bubble(scene: Phaser.Scene, x: number, y: number, msg: string, dir: 'left' | 'right' | 'up' | 'down', tone: BubbleTone = 'plain'): Phaser.GameObjects.Container {
  const k = BUBBLE[tone];
  const c = scene.add.container(x, y).setDepth(3000);
  const t = text(scene, 0, 0, msg, { size: TYPE.label, color: k.ink, bold: true, wrap: 220 });
  const w = Math.max(56, t.width + 28);
  const h = t.height + 20;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2, -h / 2 + 3, w, h, 14);
  g.fillStyle(k.fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
  g.lineStyle(2.5, k.line, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
  g.fillStyle(k.fill, 1);
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
    g.fillTriangle(ax, ay, bx, by, cx, cy);
    g.lineStyle(2.5, k.line, 1).lineBetween(ax, ay, cx, cy).lineBetween(bx, by, cx, cy);
  };
  if (dir === 'left') tri(-w / 2 + 1, -8, -w / 2 + 1, 8, -w / 2 - 14, 4);
  else if (dir === 'right') tri(w / 2 - 1, -8, w / 2 - 1, 8, w / 2 + 14, 4);
  else if (dir === 'up') tri(-10, -h / 2 + 1, 10, -h / 2 + 1, -4, -h / 2 - 14);
  else tri(-10, h / 2 - 1, 10, h / 2 - 1, -4, h / 2 + 14);
  c.add([g, t]);
  // 记下大小：调用方按边对齐要用（不开输入，不影响点击）
  c.setSize(w, h);
  c.setScale(0.6).setAlpha(0);
  scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 180, ease: 'Back.easeOut' });
  return c;
}

/** 开关/选项按钮组：一行若干个选项，当前项高亮。 */
export function segmented(
  scene: Phaser.Scene,
  x: number,
  y: number,
  items: { label: string; value: string }[],
  current: string,
  onPick: (v: string) => void,
  itemW = 104,
  hitH = 60,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const btns: { g: Phaser.GameObjects.Graphics; t: Phaser.GameObjects.Text; v: string; hover: boolean; down: boolean }[] = [];
  const h = 44;
  let cur = current;
  const paint = (): void => {
    for (const b of btns) {
      const on = b.v === cur;
      const base = on ? COLOR.red : 0xeadbc0;
      const fill = b.down ? shade(base, 0.9) : b.hover && !on ? 0xf4e8d0 : base;
      const dy = b.down ? 2 : 0;
      b.g.clear();
      b.g.fillStyle(fill, 1).fillRoundedRect(-itemW / 2 + 3, -h / 2 + dy, itemW - 6, h, RADIUS.md);
      b.g.lineStyle(2, on ? COLOR.gold : b.hover ? COLOR.goldDark : 0xc9b48e, 1).strokeRoundedRect(-itemW / 2 + 3, -h / 2 + dy, itemW - 6, h, RADIUS.md);
      b.t.setColor(css(on ? COLOR.goldLight : COLOR.ink));
      b.t.y = dy;
    }
  };
  items.forEach((it, i) => {
    const bx = i * itemW;
    const g = scene.add.graphics().setPosition(bx, 0);
    const t = text(scene, bx, 0, it.label, { size: TYPE.label, bold: true });
    // 点按区域：宽到和邻居相接，高到行距（设置面板一行 60），比画出来的 44 高
    const hit = scene.add.zone(bx, 0, itemW, Math.max(h, hitH)).setInteractive({ useHandCursor: true });
    const b = { g, t, v: it.value, hover: false, down: false };
    const pick = (): void => {
      audio.sfx('click');
      cur = it.value;
      paint();
      onPick(it.value);
    };
    hit.on('pointerover', () => ((b.hover = true), paint()));
    hit.on('pointerout', () => ((b.hover = false), (b.down = false), paint()));
    hit.on('pointerdown', () => ((b.down = true), paint()));
    hit.on('pointerup', () => {
      const was = b.down;
      b.down = false;
      if (was) pick();
      else paint();
    });
    focusable(hit, itemW - 6, h, pick);
    btns.push(b);
    c.add([g, t, hit]);
  });
  paint();
  return c;
}
