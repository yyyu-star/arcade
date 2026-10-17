import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRUSH_CHARS } from '../src/view/ui/brushChars.ts';

// 毛笔字体是子集：横幅里用到的字不在子集里就会退回后备字体，画风一下就破了
describe('毛笔字子集', () => {
  it('HUD 里用毛笔字写的字都在子集里', () => {
    for (const ch of '0123456789连斩!') expect(BRUSH_CHARS).toContain(ch);
  });
  it('界面标题和横幅里的毛笔字都在子集里', () => {
    // 暂停、结算标题，模式卡，升级卡片，出场预警（banner.ts、screens.ts、cards.ts、GameScene.ts 里用 YxBrush 的文案）
    for (const s of ['暂停', '天亮了', '尸王伏诛', '倒下了', '收工', '夜巡', '守夜', '夜探', '升到级', '尸王来了', '石狮怪', '跳尸将军', '白狐', '纸轿', '+30', '封']) {
      for (const ch of s) expect(BRUSH_CHARS, s).toContain(ch);
    }
  });
  it('子集字体文件存在且不大', () => {
    const url = new URL('../public/fonts/brush.woff2', import.meta.url);
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(url).length).toBeLessThan(120 * 1024);
  });
});
