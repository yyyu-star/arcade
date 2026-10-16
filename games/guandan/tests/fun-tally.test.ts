/**
 * 扔道具的手感（0.11.0，docs/table-fun.md 第 2、3 节）：护盾、连击、回敬。
 */
import { describe, expect, it } from 'vitest';
import { COMBO_MS, FunTally, SHIELD_MAX, SHIELD_WINDOW_MS } from '../src/view/fun-tally.ts';

describe('护盾：同一个人 10 秒内最多被扔 6 次', () => {
  it('第 7 下亮护盾，不算命中', () => {
    const t = new FunTally();
    for (let i = 0; i < SHIELD_MAX; i++) expect(t.hit(i % 3 + 1, 0, i * 100).shield).toBe(false);
    expect(t.hit(1, 0, 700).shield).toBe(true);
  });
  it('窗口滑过去就又能扔；别人不受影响', () => {
    const t = new FunTally();
    for (let i = 0; i < SHIELD_MAX; i++) t.hit(1, 0, i);
    expect(t.hit(1, 2, 10).shield).toBe(false);
    expect(t.hit(1, 0, SHIELD_WINDOW_MS + 1).shield).toBe(false);
  });
});

describe('连击：同一个人 3 秒内连着扔同一个人', () => {
  it('第 2 下起 ×2、×3', () => {
    const t = new FunTally();
    expect(t.hit(0, 1, 0).combo).toBe(1);
    expect(t.hit(0, 1, 1000).combo).toBe(2);
    expect(t.hit(0, 1, 2500).combo).toBe(3);
  });
  it('隔太久、换了人都从 1 算', () => {
    const t = new FunTally();
    t.hit(0, 1, 0);
    expect(t.hit(0, 1, COMBO_MS + 1).combo).toBe(1);
    expect(t.hit(0, 2, COMBO_MS + 2).combo).toBe(1);
  });
});

describe('回敬：被扔后 3 秒内扔回给扔你的人', () => {
  it('扔回去算回敬，扔别人不算，太晚不算', () => {
    const t = new FunTally();
    t.hit(3, 0, 0);
    expect(t.hit(0, 1, 500).revenge).toBe(false);
    expect(t.hit(0, 3, 1000).revenge).toBe(true);
    t.hit(2, 1, 5000);
    expect(t.hit(1, 2, 5000 + COMBO_MS + 1).revenge).toBe(false);
  });
});
