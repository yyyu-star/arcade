/**
 * 闲着时降帧（0.10.1）：Phaser 每一帧都整屏重画，画面不动也照画。标题页、等人出牌时手机一直满帧跑，费电发热。
 * 做法：几秒没有点按、按键，牌桌也没在播事件、电脑也没在想，又没有一次性的补间在播，就把帧率上限降到 IDLE_FPS；
 * 一有操作马上放开。无限循环的装饰补间（标题浮动、轮到我的光圈）不算"在动"。
 *
 * 一秒看一次，不在游戏循环里看：最早每帧（poststep）看、动画一来一走就切一次上限，机器忙时（冒烟并行跑）场景时钟几乎停住，
 * 电脑的计时器 60 秒只走了 0.36 秒，牌局卡死。只在牌局不动的时候降，降了也不会拖慢任何要等的东西。
 *
 * 上限写 31 不写 30：Phaser 攒够 1000/上限 毫秒才走一帧，60Hz 屏幕两帧 33.2 毫秒不到 30 帧要的 33.3，会变成三帧一走。
 */
import type Phaser from 'phaser';

export const IDLE_FPS = 31;
/** 最后一次操作后多久算闲着 */
export const IDLE_AFTER_MS = 4000;

interface TweenLike {
  isInfinite: boolean;
  isPlaying(): boolean;
}

/** 该用的帧率上限：0 = 不限。busy：牌桌在播事件或电脑在想 */
export function frameLimit(sinceInput: number, busy: boolean, tweens: readonly TweenLike[]): number {
  if (sinceInput < IDLE_AFTER_MS || busy) return 0;
  return tweens.some((t) => !t.isInfinite && t.isPlaying()) ? 0 : IDLE_FPS;
}

export function installIdleLimiter(game: Phaser.Game): void {
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
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const) window.addEventListener(ev, wake, { passive: true, capture: true });
  setInterval(() => {
    const scenes = game.scene.getScenes(true);
    const busy = scenes.some((s) => (s as unknown as { isBusy?: boolean }).isBusy === true);
    const tweens = scenes.flatMap((s) => s.tweens.getTweens());
    apply(frameLimit(performance.now() - last, busy, tweens));
  }, 1000);
}
