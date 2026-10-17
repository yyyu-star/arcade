/**
 * 无头浏览器冒烟 + 截图：node tools/shot.ts [--out <目录>] [--frames <张数>] [--video] [--lowmem]
 *
 * - 自己起一个 vite 开发服务（端口由系统分配，不占 5178/4178，见仓库根 AGENTS.md 第 3 节），用 playwright-core + chromium-headless-shell；
 * - 电脑横屏 1280×720 和手机横屏 844×390（3 倍屏、触屏）各截一张，--frames 再隔 100 ms 连截 N 张（动态的帧序列），--video 录一段 webm；
 * - 验收 ④⑤（DESIGN.md 第 1 节）：页面里所有按钮的点击区域 ≥ 44×44 CSS 像素、文字不溢出，控制台没有 error、页面没有未捕获的异常，不过就退出码 1；
 * - 没有 GPU 的环境 WebGL 走 SwiftShader（启动参数照开盘）。截图里要有中文字体，系统要装 Noto Sans CJK 之类。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const OUT = opt('--out') ?? join(tmpdir(), 'yexun-shots');
const FRAMES = Number(opt('--frames') ?? 0);
const VIDEO = argv.includes('--video');
const LOWMEM = argv.includes('--lowmem');
/** 附加的查询串，比如 auto&warp=9000（机器人代打并快进） */
const QUERY = opt('--query');
/** 截图文件名前缀 */
const TAG = opt('--tag') ?? '';
/** 走一遍界面：首次菜单 → 开打 → 暂停 → 认输确认 → 结算 → 换难度回菜单，每一屏截图并检查 */
const FLOW = argv.includes('--flow');
/** 开打后点暂停再截（看暂停页的构筑和套装） */
const PAUSE = argv.includes('--pause');
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'phone', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

/** 页面里检查：可点的东西 ≥ 44×44、文字没有溢出自己的框 */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 44 || r.height < 44) bad.push(`点击区域太小 ${Math.round(r.width)}×${Math.round(r.height)}：${el.getAttribute('aria-label') ?? el.textContent?.trim()}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('.yx-hud *')) {
      if (el.children.length > 0 || !el.textContent?.trim()) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') bad.push(`文字溢出：${el.textContent.trim()}`);
    }
    return bad;
  });
}

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await server.listen();
const addr = server.httpServer?.address();
if (!addr || typeof addr === 'string') throw new Error('vite 没有监听端口');
const BASE = `http://127.0.0.1:${addr.port}/?${[LOWMEM ? 'lowmem' : '', QUERY ?? ''].filter(Boolean).join('&')}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
const problems: string[] = [];
try {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ ...v, ...(VIDEO ? { recordVideo: { dir: OUT, size: v.viewport } } : {}) });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      // SwiftShader 截图时的 GPU 驱动提示（ReadPixels）不是页面的问题
      if (m.type() === 'error' && !/GL Driver Message/.test(m.text())) problems.push(`${v.name} 控制台报错：${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${v.name} 未捕获异常：${e.message}`));
    await page.goto(BASE);
    await page.waitForFunction(() => !!(window as unknown as { __yx?: unknown }).__yx, null, { timeout: 20_000 });
    if (FLOW) {
      const snap = async (name: string): Promise<void> => {
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${TAG}${v.name}-${name}.png`) });
        for (const p of await layoutProblems(page)) problems.push(`${v.name} ${name} ${p}`);
      };
      const click = async (sel: string): Promise<void> => {
        await page.locator(sel).first().click();
      };
      await snap('menu-first');
      const t0 = Date.now();
      await click('[data-a="start"]');
      await page.waitForFunction(() => {
        const w = (window as unknown as { __yx: { world: { eAlive: Uint8Array } | null } }).__yx.world;
        return !!w && w.eAlive.some((x) => x === 1);
      });
      console.log(`${v.name}：点开始到出怪 ${Date.now() - t0} ms`);
      await page.waitForTimeout(2500);
      await snap('play');
      await click('.yx-pause');
      await snap('pause');
      await click('[data-a="quit"]');
      await snap('confirm');
      await click('.yx-confirm [data-a="yes"]');
      await snap('result');
      await click('[data-a="menu"]');
      await snap('menu');
      await page.locator('.yx-gear').click();
      await snap('settings');
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(3500);
    if (PAUSE) {
      await page.locator('.yx-pause').first().click();
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: join(OUT, `${TAG}${v.name}.png`) });
    for (let i = 0; i < FRAMES; i++) {
      await page.screenshot({ path: join(OUT, `${TAG}${v.name}-${String(i).padStart(3, '0')}.png`) });
      await page.waitForTimeout(100);
    }
    // 帧率：数 3 秒里的 requestAnimationFrame，顺带记同屏怪数（无头 SwiftShader 是 CPU 软渲染，数字只能当下限看）
    const perf = await page.evaluate(
      () =>
        new Promise<{ fps: number; worst: number; mobs: number; cost: number }>((resolve) => {
          const yx = (window as unknown as { __yx: { world: { eAlive: Uint8Array } } }).__yx;
          let n = 0;
          let worst = 0;
          let last = performance.now();
          const t0 = last;
          const f = (): void => {
            const now = performance.now();
            worst = Math.max(worst, now - last);
            last = now;
            n++;
            if (now - t0 < 3000) requestAnimationFrame(f);
            else resolve({ fps: Math.round((n * 1000) / (now - t0)), worst: Math.round(worst), mobs: yx.world.eAlive.reduce((a, b) => a + b, 0), cost: Math.round(((window as unknown as { __yx: { game: { scene: { getScene: (k: string) => { cost: number } } } } }).__yx.game.scene.getScene('game').cost) * 10) / 10 });
          };
          requestAnimationFrame(f);
        }),
    );
    console.log(`${TAG}${v.name}：${perf.fps} 帧/秒，最长一帧 ${perf.worst} ms，同屏怪 ${perf.mobs}，场景脚本每帧 ${perf.cost} ms`);
    for (const p of await layoutProblems(page)) problems.push(`${v.name} ${p}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`截图在 ${OUT}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('控制台零报错，按钮和文字检查通过');
