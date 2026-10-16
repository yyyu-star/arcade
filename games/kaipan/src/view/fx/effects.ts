import Phaser from 'phaser';
import { COLOR, RADIUS } from '../theme.ts';
import { addText } from '../ui/text.ts';
import type { Animator } from './anim.ts';
import { viewOf } from '../viewport.ts';

/**
 * 飘字：在 (x, y) 处弹出一段文字（白色描边，压在任何底色上都清楚），上浮后淡出销毁。
 * pop 为 true 时先放大弹出。动画关闭或快进时不显示。
 */
export function floatText(
  scene: Phaser.Scene,
  anim: Animator,
  x: number,
  y: number,
  content: string,
  color: number,
  opts: { size?: number; rise?: number; hold?: number; pop?: boolean; depth?: number } = {},
): void {
  if (anim.instant) return;
  const label = addText(scene, x, y, content, { size: opts.size ?? 16, color, bold: true, originX: 0.5, originY: 1, stroke: 0xffffff, strokeWidth: 5 });
  label.setDepth(opts.depth ?? 150);
  const half = label.width / 2;
  label.x = Math.max(half + 4, Math.min(viewOf(scene).w - half - 4, x));
  label.y = Math.max(label.height + 4, y);
  const rise = anim.calm ? 0 : (opts.rise ?? 30);
  if (opts.pop && !anim.calm) {
    label.setScale(0.3);
    anim.fx({ targets: label, scale: 1, duration: 180, ease: 'Back.easeOut' });
  }
  anim.fx(
    { targets: label, y: label.y - rise, alpha: { from: 1, to: 0 }, duration: 900, delay: opts.pop ? 180 : 0, hold: opts.hold ?? 300, ease: 'Cubic.easeIn' },
    () => label.destroy(),
  );
}

/** 文字或容器轻微放大回弹，用于数字跳动时的强调。 */
export function pop(anim: Animator, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, scale = 1.25): void {
  if (anim.instant) return;
  anim.fx({ targets: target, scale: { from: anim.calm ? 1 + (scale - 1) / 3 : scale, to: 1 }, duration: 260, ease: 'Back.easeOut' }, () => target.setScale(1));
}

/** 抖一下：放大 + 左右摆动后回正；「减少动态效果」时只做轻微放大。 */
export function jiggle(anim: Animator, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, strength = 1): void {
  if (anim.instant) return;
  if (anim.calm) {
    anim.fx({ targets: target, scale: { from: 1 + 0.06 * strength, to: 1 }, duration: 220, ease: 'Quad.easeOut' }, () => target.setScale(1));
    return;
  }
  anim.fx(
    { targets: target, scale: { from: 1 + 0.18 * strength, to: 1 }, angle: { from: -7 * strength, to: 0 }, duration: 320, ease: 'Back.easeOut' },
    () => target.setScale(1).setAngle(0),
  );
}

/** 全屏半透明遮罩，吞掉下层点击。 */
export function addBackdrop(scene: Phaser.Scene, alpha = 0.45): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, '__WHITE').setOrigin(0, 0).setDisplaySize(viewOf(scene).w, viewOf(scene).h).setTint(COLOR.overlay).setAlpha(alpha).setInteractive();
}

/** 震屏（减少动态效果、快进时不震）。 */
export function shake(scene: Phaser.Scene, anim: Animator, ms = 160, intensity = 0.004): void {
  if (!anim.calm) scene.cameras.main.shake(ms, intensity);
}

/** 短暂的白色描边高光（道具触发、龙头涨停）：在 rect 处闪一下后销毁。 */
export function flashBox(scene: Phaser.Scene, anim: Animator, x: number, y: number, w: number, h: number, color: number = COLOR.gold, depth = 140): void {
  if (anim.instant) return;
  const r = scene.add.rectangle(x, y, w, h, color, 0.25).setOrigin(0, 0).setRounded(RADIUS.md).setStrokeStyle(4, color, 1).setDepth(depth);
  anim.fx({ targets: r, alpha: { from: 1, to: 0 }, duration: 600, ease: 'Quad.easeOut' }, () => r.destroy());
}
