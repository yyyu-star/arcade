import type Phaser from 'phaser';

/**
 * 0.9.1 闲着时降帧：没有动画在播、几秒没碰键盘鼠标手指时，画面只剩小人摇头晃脑这类环境动画，用不着满帧。
 * 降到约 30 帧，空闲时主线程和耗电少一半左右；一有输入或动画开始马上回满帧。
 *
 * 帧数上限写 31 而不是 30：Phaser 按"攒够 1000/上限 毫秒才走一帧"限帧，60Hz 屏幕两帧是 33.2ms，
 * 不到 30 帧要的 33.3ms，会变成三帧一走（20 帧）还忽快忽慢；31 帧（32.3ms）稳定两帧一走，120Hz 屏幕上是四帧一走。
 */
export const IDLE_FPS = 31;
/** 多久没输入算闲着（毫秒） */
export const IDLE_AFTER_MS = 4000;

/** 现在该用的帧数上限：0 表示不限（跟屏幕刷新）。导出给单测。 */
export function fpsLimitFor(o: { sinceInput: number; idle: boolean }): number {
  return o.idle && o.sinceInput >= IDLE_AFTER_MS ? IDLE_FPS : 0;
}

/** 启动时调用一次；session.idle 是「没有进行中的动画」，状态一变（开盘、跳过、换场景）subscribe 就通知，动画一开始马上回满帧。 */
export function throttleWhenIdle(game: Phaser.Game, session: { readonly idle: boolean; subscribe(fn: () => void): () => void }): void {
  let last = performance.now();
  let limit = 0;
  const apply = (next: number): void => {
    if (next === limit) return;
    limit = next;
    game.loop.setFPSLimit(next);
  };
  const wake = (): void => {
    last = performance.now();
    apply(0);
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, wake, { capture: true, passive: true });
  const check = (): void => apply(fpsLimitFor({ sinceInput: performance.now() - last, idle: session.idle }));
  session.subscribe(check);
  // 降帧一秒看一次就够，晚一秒没关系
  setInterval(check, 1000);
}
