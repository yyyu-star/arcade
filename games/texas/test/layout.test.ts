/** 牌桌的摆位（DESIGN.md 8.2）：下注的筹码离座位远近一致、不压公共牌（0.18.2，美术 v3 第 3 步） */
import { describe, expect, it } from 'vitest';
import { betPos, boardPos, dealerSpots, felt, seatPos, STAGE_MAX_W, STAGE_MIN_W, type Geo } from '../src/view/layout.ts';

/** 公共牌一张 58 × 82（按中心摆） */
const CARD_W = 58;
const CARD_H = 82;

describe('横屏下注位置', () => {
  for (const w of [STAGE_MIN_W, 960, STAGE_MAX_W]) {
    const g: Geo = { w, h: 540, tall: false };
    for (let size = 2; size <= 9; size++) {
      it(`宽 ${w}、${size} 人：别人的下注离座位 90–130，不压公共牌`, () => {
        const f = felt(g);
        const left = boardPos(g, 0).x - CARD_W / 2;
        const right = boardPos(g, 4).x + CARD_W / 2;
        const top = boardPos(g, 0).y - CARD_H / 2;
        const bottom = boardPos(g, 0).y + CARD_H / 2;
        for (let seat = 1; seat < size; seat++) {
          const p = seatPos(seat, 0, size, g);
          const b = betPos(p, g, false);
          const d = Math.hypot(b.x - p.x, b.y - 6 - p.y);
          expect(d).toBeGreaterThanOrEqual(90 - 1e-9);
          expect(d).toBeLessThanOrEqual(130 + 1e-9);
          // 筹码那一摞连数字约 70 × 30（中心往左右各 35、上下各 15）
          const hits = b.x + 35 > left && b.x - 35 < right && b.y + 15 > top && b.y - 15 < bottom;
          expect(hits, `座位 ${seat} 的下注 (${b.x.toFixed(0)}, ${b.y.toFixed(0)}) 压到公共牌`).toBe(false);
          // 在桌子里面（椭圆内）
          expect(((b.x - f.cx) / f.rx) ** 2 + ((b.y - f.cy) / f.ry) ** 2).toBeLessThan(1);
        }
      });
    }
  }
});

describe('荷官能站的地方', () => {
  it('竖屏没有', () => {
    expect(dealerSpots({ w: 540, h: 960, tall: true }, 6)).toEqual([]);
  });
  for (const w of [STAGE_MIN_W, 960, STAGE_MAX_W]) {
    const g: Geo = { w, h: 540, tall: false };
    for (let size = 2; size <= 9; size++) {
      it(`宽 ${w}、${size} 人：都在桌子顶边上，离顶上的座位至少 150`, () => {
        const spots = dealerSpots(g, size);
        if (size <= 6) expect(spots.length, '2–6 人桌至少有一个地方').toBeGreaterThan(0);
        const f = felt(g);
        for (const d of spots) {
          expect(((d.x - f.cx) / f.rx) ** 2 + ((d.y - f.cy) / f.ry) ** 2).toBeCloseTo(1, 6);
          expect(d.y).toBeLessThan(f.cy);
          for (let seat = 0; seat < size; seat++) {
            const p = seatPos(seat, 0, size, g);
            if (p.y < 200) expect(Math.abs(p.x - d.x)).toBeGreaterThanOrEqual(150);
          }
        }
      });
    }
  }
});
