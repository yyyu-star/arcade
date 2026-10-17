/**
 * 生成大厅封面：node tools/cover.ts [--out public/cover.webp]
 * 起一个临时端口的 vite，用无头 Chromium 打开 tools/cover.html，页面自己画好导出 webp，这里写成文件。
 * 平台把它放到 platform/public/covers/yexun.webp（平台的 ASSETS.md 记来源）。改了标题页的画或字，重新跑一次。
 */
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const i = argv.indexOf('--out');
const OUT = i >= 0 ? argv[i + 1]! : 'public/cover.webp';

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await server.listen();
const addr = server.httpServer?.address();
if (!addr || typeof addr === 'string') throw new Error('vite 没有监听端口');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${addr.port}/tools/cover.html`);
  await page.waitForFunction(() => (window as unknown as { __cover?: unknown }).__cover !== undefined);
  const url = await page.evaluate(() => (window as unknown as { __cover: Promise<string> }).__cover);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!url.startsWith('data:image/webp')) throw new Error('浏览器没导出 webp');
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  writeFileSync(OUT, buf);
  console.log(`封面写到 ${OUT}（${Math.round(buf.length / 1024)} KB，800×450）`);
} finally {
  await browser.close();
  await server.close();
}
