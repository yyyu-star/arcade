import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRUSH_CHARS } from '../src/view/ui/brushChars.ts';

// 毛笔字体是子集：横幅里用到的字不在子集里就会退回后备字体，画风一下就破了
describe('毛笔字子集', () => {
  it('HUD 里用毛笔字写的字都在子集里', () => {
    for (const ch of '0123456789连斩!') expect(BRUSH_CHARS).toContain(ch);
  });
  it('子集字体文件存在且不大', () => {
    const url = new URL('../public/fonts/brush.woff2', import.meta.url);
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(url).length).toBeLessThan(120 * 1024);
  });
});
