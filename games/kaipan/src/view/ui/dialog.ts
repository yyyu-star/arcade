import Phaser from 'phaser';
import { addBackdrop } from '../fx/effects.ts';
import { sound } from '../sound.ts';
import { COLOR, TYPE } from '../theme.ts';
import { Button, HIT_MIN } from './button.ts';
import type { Glyph } from '../assets.ts';
import { addGlyph, addPaper } from './art.ts';
import { bindTooltip, type TipContent } from './tooltip.ts';
import { addText } from './text.ts';
import { viewOf } from '../viewport.ts';

/** 场景数据里的标记：有对话框打开时，场景的快捷键暂停响应。 */
export const OVERLAY_FLAG = 'overlayOpen';

/**
 * 居中对话框（设置、关于、确认等）：遮罩拦截点击，Esc 或右上角关闭。
 * 内容加到 inner（原点为面板左上角）。
 */
export class Dialog extends Phaser.GameObjects.Container {
  readonly inner: Phaser.GameObjects.Container;
  readonly dw: number;
  readonly dh: number;
  private readonly onClosed: (() => void) | undefined;
  private closed = false;
  private readonly keyHandler: (e: KeyboardEvent) => void;
  /** 自动化用：命名按钮 */
  protected readonly named: Record<string, { center(): { x: number; y: number } }> = {};

  constructor(scene: Phaser.Scene, w: number, h: number, title: string, onClosed?: () => void) {
    super(scene, 0, 0);
    this.dw = w;
    this.dh = h;
    this.onClosed = onClosed;
    const V = viewOf(scene);
    const x = Math.round((V.w - w) / 2);
    const y = Math.round((V.h - h) / 2);
    const backdrop = addBackdrop(scene, 0.5);
    const panel = addPaper(scene, x, y, w, h);
    const hitPanel = scene.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0, 0).setInteractive();
    const head = addText(scene, x + 28, y + 24, title, { size: TYPE.title + 2, bold: true, color: COLOR.ink });
    const underline = scene.add.rectangle(x + 28, y + 54, Math.min(w - 56, head.width + 24), 4, COLOR.accent).setOrigin(0, 0).setRounded(2);
    const close = addText(scene, x + w - 24, y + 14, '×', { size: 30, color: COLOR.muted, originX: 1 }).setInteractive({ useHandCursor: true });
    close.on(Phaser.Input.Events.POINTER_UP, () => this.close());
    // 只有 × 字形能点时手指很难点中：垫一块透明点击区，至少 44，触屏上和按钮一样按 HIT_MIN 撑（手机 44 的世界单位只有约 39px）
    const closeSide = Math.max(44, HIT_MIN);
    const closeHit = scene.add.rectangle(x + w - 24 - close.width / 2, y + 14 + close.height / 2, closeSide, closeSide, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    closeHit.on(Phaser.Input.Events.POINTER_UP, () => this.close());
    this.inner = scene.add.container(x, y);
    this.add([backdrop, panel, hitPanel, head, underline, closeHit, close, this.inner]);
    this.setDepth(300);
    scene.add.existing(this);
    scene.data.set(OVERLAY_FLAG, true);
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') this.close();
    };
    scene.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.keyHandler);
    sound.ui('open');
  }

  /**
   * 0.5 统一弹窗按钮：主按钮橙色在右、次按钮白色在左，贴在面板右下角。
   * spec.name 给自动化脚本用（写进 named）。返回两个按钮（没给的为 null）。
   */
  protected actions(primary: ActionSpec | null, secondary?: ActionSpec | null): { primary: Button | null; secondary: Button | null } {
    const r = actionButtons(this.scene, this.inner, this.dw - 28, this.dh - 22, primary, secondary);
    if (primary?.name && r.primary) this.named[primary.name] = r.primary;
    if (secondary?.name && r.secondary) this.named[secondary.name] = r.secondary;
    return r;
  }

  controls(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, b] of Object.entries(this.named)) out[k] = b.center();
    return out;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.input.keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.keyHandler);
    // 同一次按键里，场景的快捷键处理在本处理之后执行：下一帧再放开
    const scene = this.scene;
    scene.time.delayedCall(0, () => scene.data.set(OVERLAY_FLAG, false));
    sound.ui('close');
    const done = this.onClosed;
    this.destroy();
    done?.();
  }
}

/** 弹窗按钮：文字 ≤ 4 个字；hotkey 是快捷键角标。 */
interface ActionSpec {
  label: string;
  onClick: () => void;
  hotkey?: string;
  /** 自动化用的控件名（Dialog.actions 写进 named） */
  name?: string;
  /** 点击音效；null 不发声 */
  sound?: null;
}

/** 主按钮、次按钮的尺寸（所有弹窗一致）。 */
const ACTION_SIZE = { primary: { w: 136, h: 46 }, secondary: { w: 112, h: 46 }, gap: 14 } as const;

/**
 * 0.5 统一弹窗按钮（Dialog 之外的浮层也用）：主按钮橙色在右、次按钮白色在左。
 * (right, bottom) 为按钮区右下角，坐标相对 parent。
 */
export function actionButtons(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  right: number,
  bottom: number,
  primary: ActionSpec | null,
  secondary?: ActionSpec | null,
): { primary: Button | null; secondary: Button | null } {
  const P = ACTION_SIZE.primary;
  const S = ACTION_SIZE.secondary;
  let x = right;
  let p: Button | null = null;
  let s2: Button | null = null;
  if (primary) {
    x -= P.w;
    p = new Button(scene, x, bottom - P.h, { width: P.w, height: P.h, label: primary.label, variant: 'primary', fontSize: TYPE.title, hotkey: primary.hotkey, onClick: primary.onClick, ...(primary.sound === null ? { sound: null } : {}) });
    parent.add(p);
    x -= ACTION_SIZE.gap;
  }
  if (secondary) {
    x -= S.w;
    s2 = new Button(scene, x, bottom - S.h, { width: S.w, height: S.h, label: secondary.label, variant: 'default', fontSize: TYPE.title - 2, hotkey: secondary.hotkey, onClick: secondary.onClick, ...(secondary.sound === null ? { sound: null } : {}) });
    parent.add(s2);
  }
  return { primary: p, secondary: s2 };
}

/** 短金额：¥7,900、¥2万、¥2.5万、¥1.2亿（卡片上的大数字用；精确值放悬停）。sign 为 true 时正数带 +。 */
export function moneyShort(v: number, sign = false): string {
  const a = Math.abs(v);
  const s = Math.round(a) === 0 ? '' : v < 0 ? '-' : sign ? '+' : '';
  const trim = (x: number): string => String(Math.round(x * 10) / 10);
  if (a >= 1e8) return `${s}¥${trim(a / 1e8)}亿`;
  if (a >= 1e4) return `${s}¥${trim(a / 1e4)}万`;
  return `${s}¥${Math.round(a).toLocaleString('en-US')}`;
}

/**
 * 小图标 + 短标签的胶囊（看点卡的规则 / 要还的钱、银行的可押物等）。(x, y) 为左上角，高 32。
 * tip 给了就绑悬停说明。返回容器和宽度。
 */
export function iconChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  glyph: Glyph,
  label: string,
  opts: { color?: number; fill?: number; bold?: boolean; tip?: TipContent; tint?: number } = {},
): { node: Phaser.GameObjects.Container; w: number } {
  const H = 32;
  const t = addText(scene, 34, H / 2, label, { size: TYPE.label + 1, bold: opts.bold ?? true, color: opts.color ?? COLOR.ink, originY: 0.5 });
  const w = Math.round(t.width + 46);
  const bg = scene.add.rectangle(0, 0, w, H, opts.fill ?? COLOR.paperHi).setOrigin(0, 0).setRounded(H / 2).setStrokeStyle(2, COLOR.edge, 1);
  const g = addGlyph(scene, 18, H / 2, glyph, 24, opts.tint);
  const node = scene.add.container(x, y, [bg, g, t]);
  const tip = opts.tip;
  if (tip) {
    bg.setInteractive();
    bindTooltip(bg, () => {
      const m = bg.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty, w, h: H };
    }, () => tip);
  }
  return { node, w };
}
