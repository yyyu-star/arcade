/**
 * 界面改版①（0.9.0）：点按区域的下限、长昵称截短、DOM 按钮统一样式。画面本身由冒烟（tools/shot.ts 的 checkHits、键盘那一段）管。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NAME_MAX, fullSeatName, seatName, setSeatIdentities } from '../src/view/labels.ts';
import { THEME_CSS, hitFor } from '../src/view/theme.ts';

const viewSources = import.meta.glob(['../src/view/**/*.ts', '../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('点按区域至少 44 CSS 像素', () => {
  it('电脑上 1:1 就是 44；手机横屏缩小了，世界坐标要放大', () => {
    expect(hitFor(1280, 720)).toBe(44);
    expect(hitFor(1920, 1080)).toBe(44);
    // 844×390：世界 1558×720，缩 0.54
    expect(hitFor(844, 390)).toBe(82);
    // 667×375（16:9 小屏）：世界 1280×720，按宽缩 0.52
    expect(hitFor(667, 375)).toBe(85);
    // 再小也封顶，免得按钮的点按区域盖满半屏
    expect(hitFor(320, 160)).toBe(96);
  });
});

describe('长昵称', () => {
  afterEach(() => setSeatIdentities([null, null, null, null]));
  it(`画面上最多 ${NAME_MAX} 个字，多了截短加"…"；认人用的全名不变`, () => {
    const long = '一个特别特别长的平台昵称啊';
    setSeatIdentities([null, { human: true, name: long, away: false, auto: false }, null, null]);
    expect([...seatName(1)].length).toBe(NAME_MAX);
    expect(seatName(1).endsWith('…')).toBe(true);
    expect(fullSeatName(1)).toBe(long);
    setSeatIdentities([null, { human: true, name: '阿花', away: false, auto: false }, null, null]);
    expect(seatName(1)).toBe('阿花');
  });
});

describe('DOM 按钮', () => {
  it('都用 THEME_CSS 的 .gd-btn（同一套常态、悬停、按下、禁用、焦点、加载中）', () => {
    for (const st of ['.gd-btn:hover', '.gd-btn:active', '.gd-btn:disabled', '.gd-btn:focus-visible', '.gd-btn.is-loading']) expect(THEME_CSS).toContain(st);
    for (const [path, src] of Object.entries(viewSources)) {
      for (const m of src.matchAll(/<button[^>]*>/g)) expect(m[0], path).toMatch(/class="gd-btn/);
      for (const m of src.matchAll(/el\('button', \{[^}]*\}/g)) expect(m[0], path).toContain('gd-btn');
      expect(/createElement\('button'\)/.test(src), path).toBe(false);
    }
  });
});
