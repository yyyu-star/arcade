/**
 * 毛笔字体子集化：node tools/subset-font.ts <MaShanZheng-Regular.ttf 的路径>
 * 字体原件不进仓库（5.8 MB），从 Google Fonts 的仓库下载（ofl/mashanzheng），许可证 SIL OFL 1.1，见 ASSETS.md。
 * 只留 src/view/ui/brushChars.ts 里的字，输出 public/fonts/brush.woff2。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import subsetFont from 'subset-font';
import { BRUSH_CHARS } from '../src/view/ui/brushChars.ts';

const src = process.argv[2];
if (!src) {
  console.error('用法：node tools/subset-font.ts <MaShanZheng-Regular.ttf>');
  process.exit(1);
}
const chars = [...new Set(BRUSH_CHARS)].join('');
const out = await subsetFont(readFileSync(src), chars, { targetFormat: 'woff2' });
const dest = new URL('../public/fonts/brush.woff2', import.meta.url);
writeFileSync(dest, out);
console.log(`brush.woff2：${chars.length} 个字，${(out.length / 1024).toFixed(1)} KB`);
