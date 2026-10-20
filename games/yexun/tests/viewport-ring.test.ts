import { describe, expect, it } from 'vitest';
import { RING, createWorld, step } from '../src/core/step.ts';
import { worldZoom } from '../src/view/viewport.ts';

// 怪从刷怪圈上出生：看得见的半宽、半高必须在圈里面，不然怪会在屏幕里凭空冒出来（10-20 竖屏放大视野时主线要求）
const SIZES: [number, number][] = [
  [360, 780], [390, 844], [430, 932], [393, 873], [820, 1180], // 手机、平板竖屏
  [844, 390], [932, 430], [1280, 720], [1920, 911], [2560, 1080], // 手机横屏、电脑
];

describe('缩放和刷怪圈', () => {
  for (const [w, h] of SIZES) {
    for (const tall of [h > w, h <= w]) {
      it(`${w}×${h}${tall === h > w ? '' : '（开局后转屏）'}：看得见的范围在刷怪圈里`, () => {
        const z = worldZoom(w, h, tall);
        const [rx, ry] = tall ? [RING.short, RING.long] : [RING.long, RING.short];
        expect(w / z / 2).toBeLessThanOrEqual(rx + 1e-9);
        expect(h / z / 2).toBeLessThanOrEqual(ry + 1e-9);
      });
    }
  }

  it('竖屏看得见的世界不再只有 260 宽：至少横屏视野面积的八成', () => {
    const land = (844 / worldZoom(844, 390, false)) * (390 / worldZoom(844, 390, false));
    const port = (390 / worldZoom(390, 844, true)) * (844 / worldZoom(390, 844, true));
    expect(port).toBeGreaterThan(land * 0.8);
  });

  it('竖屏开的局：怪生在纵向远、横向近的圈上', () => {
    const wd = createWorld({ seed: 7, mode: 'vigil', danger: 0, tall: true });
    let far = 0;
    for (let t = 0; t < 30 * 20; t++) {
      step(wd, -1);
      for (let i = 0; i < wd.eCount; i++) far = Math.max(far, Math.abs(wd.eY[i]! - wd.y));
    }
    expect(far).toBeGreaterThan(RING.short + 50);
  });
});
