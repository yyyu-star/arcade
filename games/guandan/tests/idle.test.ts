/**
 * 闲着时降帧（0.10.1）：什么时候降、什么时候放开。真降没降由性能脚本量（空闲时的帧率）。
 */
import { describe, expect, it, vi } from 'vitest';
import { SETTLE_SLACK_MS, settle } from '../src/view/anim.ts';
import { IDLE_AFTER_MS, IDLE_FPS, frameLimit } from '../src/view/idle.ts';

const tween = (isInfinite: boolean, playing = true) => ({ isInfinite, isPlaying: () => playing });
const LONG = IDLE_AFTER_MS + 1;

describe('闲着时降帧', () => {
  it('刚点过、按过：不限', () => {
    expect(frameLimit(IDLE_AFTER_MS - 1, false, [])).toBe(0);
  });
  it('一会儿没操作、没东西在动：降到 IDLE_FPS', () => {
    expect(frameLimit(LONG, false, [])).toBe(IDLE_FPS);
  });
  it('牌桌在播事件或电脑在想：不限（降了会拖慢要等的计时）', () => {
    expect(frameLimit(LONG, true, [])).toBe(0);
  });
  it('只有无限循环的装饰补间在播：照样降', () => {
    expect(frameLimit(LONG, false, [tween(true), tween(true)])).toBe(IDLE_FPS);
  });
  it('有一次性补间在播（弹窗进出、气泡淡出）：不限', () => {
    expect(frameLimit(LONG, false, [tween(true), tween(false)])).toBe(0);
  });
  it('一次性补间已经停了：不算在动', () => {
    expect(frameLimit(LONG, false, [tween(false, false)])).toBe(IDLE_FPS);
  });
  it('上限 31：60Hz 屏幕上稳定两帧一走', () => {
    expect(1000 / IDLE_FPS).toBeLessThan(2 * (1000 / 60));
  });
});

describe('动画 Promise 兜底（0.10.1）', () => {
  it('永远不来的 onComplete：时长 + 500 毫秒后照样往下走', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void settle(new Promise<void>(() => {}), 200).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(200 + SETTLE_SLACK_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('正常播完的不多等', async () => {
    await expect(settle(Promise.resolve(), 10_000)).resolves.toBeUndefined();
  });
});
