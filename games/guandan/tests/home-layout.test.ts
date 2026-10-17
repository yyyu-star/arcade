/** 主页排版（art-v3 PR ①）：各种世界宽度下面板在屏内、人物不压到面板、宽屏多出的宽度给主视觉 */
import { describe, expect, it } from 'vitest';
import { FIGURE_SIZE, homeLayout, panelWidth } from '../src/view/home-layout.ts';

describe('主页排版', () => {
  for (const W of [1280, 1404, 1556, 1720]) {
    it(`宽 ${W}：面板在屏内，右边留 32；人物右边缘不过面板左边`, () => {
      const L = homeLayout(W);
      expect(L.panel.x + L.panel.w).toBe(W - 32);
      expect(L.panel.y + L.panel.h).toBeLessThanOrEqual(720 - 24);
      for (const f of L.figures) expect(f.x + (FIGURE_SIZE.w * f.s) * 0.45).toBeLessThanOrEqual(L.panel.x + 8);
      // 四个人从左到右排，不重叠成一团
      const xs = L.figures.map((f) => f.x);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(150);
      expect(L.window.x - L.window.r).toBeGreaterThan(0);
    });
  }

  it('面板随宽度略增、封顶 560；主视觉拿走大部分多出的宽度', () => {
    expect(panelWidth(1280)).toBe(500);
    expect(panelWidth(1720)).toBe(560);
    expect(homeLayout(1720).artW - homeLayout(1280).artW).toBeGreaterThan(350);
  });
});
