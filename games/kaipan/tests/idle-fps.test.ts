import { describe, expect, it } from 'vitest';
import { IDLE_AFTER_MS, IDLE_FPS, fpsLimitFor } from '../src/view/idleFps.ts';

/** 0.9.1 闲着时降帧：没动画且几秒没输入才降，否则不限帧。 */
describe('闲着时降帧', () => {
  it('没动画、过了 IDLE_AFTER_MS 没输入才降到 IDLE_FPS', () => {
    expect(fpsLimitFor({ sinceInput: IDLE_AFTER_MS, idle: true })).toBe(IDLE_FPS);
    expect(fpsLimitFor({ sinceInput: IDLE_AFTER_MS - 1, idle: true })).toBe(0);
    expect(fpsLimitFor({ sinceInput: 60_000, idle: false })).toBe(0);
  });
  it('60Hz 屏幕上稳定两帧一走：两帧间隔（33.2ms）够得上限帧间隔', () => {
    expect(2 * (1000 / 60.2) >= 1000 / IDLE_FPS).toBe(true);
  });
});
