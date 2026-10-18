/**
 * 无头浏览器冒烟：node tools/smoke.ts
 *
 * 仓库硬规范要求每个游戏都有的一份：主流程控制台零报错，加上手机平板（尤其 iOS）的四个坑——
 * 省内存设备（?lowmem）、双指放大、WebGL 上下文丢失 / 恢复、对局中点"回大厅"先确认、手机竖屏菜单点"回大厅"。
 * 自己起 vite（临时端口，不占 5178/4178），浏览器启动参数同 shot.ts；任一项失败就打印原因并退出码 1。
 * 机器上有别的模拟在占 CPU 时慢一点没关系，等待都放得比较宽。
 */
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const problems: string[] = [];
const fail = (m: string): void => {
  problems.push(m);
  console.error(`失败：${m}`);
};
const ok = (m: string): void => console.log(`通过：${m}`);

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await server.listen();
const addr = server.httpServer?.address();
if (!addr || typeof addr === 'string') throw new Error('vite 没有监听端口');
const ORIGIN = `http://127.0.0.1:${addr.port}`;

/** --only 5,6：只跑这几段（本机验一个 PR 时用，整套交给 CI） */
const ONLY_ARG = process.argv.indexOf('--only');
const ONLY = ONLY_ARG >= 0 ? (process.argv[ONLY_ARG + 1] ?? '').split(',').map(Number) : null;
const want = (n: number): boolean => !ONLY || ONLY.includes(n);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });

/** 开一个页面（手机横屏，触屏），控制台报错和未捕获异常记进 errs */
async function open(query: string, errs: string[], viewport = { width: 844, height: 390 }, init?: () => void): Promise<Page> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => {
    // SwiftShader 截图时的 GPU 驱动提示不是页面的问题
    if (m.type() === 'error' && !/GL Driver Message/.test(m.text())) errs.push(`控制台报错：${m.text()}`);
  });
  page.on('pageerror', (e) => errs.push(`未捕获异常：${e.message}`));
  await page.goto(`${ORIGIN}/?${query}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as { __yx?: unknown }).__yx, null, { timeout: 90_000 });
  return page;
}
/** 点开始并等到场上出怪 */
async function startRun(page: Page): Promise<void> {
  // 带 ?auto 时直接开打、没有菜单；没带就走菜单点"开始"
  const btn = page.locator('[data-a="start"]').first();
  if (await btn.isVisible().catch(() => false)) await btn.click();
  await page.waitForFunction(() => {
    const w = (window as unknown as { __yx: { world: { eAlive: Uint8Array } | null } }).__yx.world;
    return !!w && w.eAlive.some((x) => x === 1);
  });
}
const report = (name: string, errs: string[]): void => (errs.length ? errs.forEach((e) => fail(`${name} ${e}`)) : ok(`${name} 零报错`));
const canvasBox = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, x: Math.round(r.x), y: Math.round(r.y), cw: Math.round(r.width), ch: Math.round(r.height), app: getComputedStyle(document.documentElement).getPropertyValue('--app-h') };
  });

try {
  // 1) 主流程：菜单 → 开打（机器人代打）→ 跑几秒
  if (want(1)) {
    const errs: string[] = [];
    const page = await open('', errs);
    await startRun(page);
    await page.waitForTimeout(5000);
    report('主流程', errs);
    await page.context().close();
  }
  // 2) 省内存设备
  if (want(2)) {
    const errs: string[] = [];
    const page = await open('lowmem&auto', errs);
    const low = await page.evaluate(() => (window as unknown as { __yx: { lowmem: boolean } }).__yx.lowmem);
    if (!low) fail('?lowmem 没有生效');
    await startRun(page);
    await page.waitForTimeout(4000);
    report('lowmem', errs);
    await page.context().close();
  }
  // 3) 双指放大：布局不动，缩回后正常
  if (want(3)) {
    const errs: string[] = [];
    const page = await open('auto', errs);
    await startRun(page);
    await page.waitForTimeout(1500);
    const before = await canvasBox(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForTimeout(800);
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(800);
    const zoomedBox = await canvasBox(page);
    if (scale < 1.5) fail(`双指放大没有模拟成功（visualViewport.scale=${scale}）`);
    else if (JSON.stringify(before) !== JSON.stringify(zoomedBox)) fail(`放大时画布或布局变了：${JSON.stringify(before)} → ${JSON.stringify(zoomedBox)}`);
    else ok('双指放大时画布和布局不变');
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(800);
    const back = await canvasBox(page);
    if (back.cw <= 0 || back.ch <= 0) fail('缩回 1 倍后画布消失');
    await page.waitForTimeout(1500);
    report('双指放大', errs);
    await page.context().close();
  }
  // 4) WebGL 上下文丢失 / 恢复
  if (want(4)) {
    const errs: string[] = [];
    const page = await open('auto', errs);
    await startRun(page);
    const tips = (): Promise<number> => page.locator('.yx-glitch').count();
    const lose = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null;
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      (window as unknown as { __ext: unknown }).__ext = ext;
      return true;
    });
    if (!lose) fail('拿不到 WEBGL_lose_context，没法模拟上下文丢失');
    else {
      await page.waitForTimeout(1500);
      if ((await tips()) !== 0) fail('上下文刚丢就弹了提示（应该先等几秒）');
      await page.waitForTimeout(3500);
      const n = await tips();
      if (n !== 1) fail(`上下文丢了超过 3 秒，提示应该正好 1 条，实际 ${n}`);
      else ok('上下文丢失超过 3 秒出现 1 条提示');
      // 再丢一次也不能叠出第二条
      await page.evaluate(() => (window as unknown as { __ext: { restoreContext(): void } }).__ext.restoreContext());
      await page.waitForTimeout(2000);
      if ((await tips()) !== 0) fail('上下文恢复后提示没有收起');
      else ok('上下文恢复后提示收起');
    }
    // 恢复后的页面可能带出来 Phaser 的报错，也算
    report('上下文丢失/恢复', errs);
    await page.context().close();
  }
  // 5) 对局中点回大厅：先确认，确认后去 /
  if (want(5)) {
    const errs: string[] = [];
    const page = await open('', errs);
    const homeUrl = (u: URL): boolean => u.pathname === '/' && u.search === '';
    await page.route(homeUrl, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>大厅</title>' }));
    await startRun(page);
    await page.waitForTimeout(1500);
    const label = await page.locator('.yx-hud .yx-home').innerText();
    if (!label.includes('大厅')) fail(`对局里的回大厅按钮看不到「大厅」二字：${JSON.stringify(label)}`);
    await page.locator('.yx-hud .yx-home').click();
    const confirmBox = page.locator('.yx-confirm');
    await confirmBox.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => fail('点回大厅后没有出现确认弹层'));
    if (page.url().endsWith('/') && !page.url().includes('?')) fail('没确认就离开了');
    await Promise.all([page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 }).catch(() => fail('确认后没有导航到 /')), page.locator('.yx-confirm [data-a="yes"]').click()]);
    if (page.url() === `${ORIGIN}/`) ok('对局中点回大厅：先确认，确认后去了 /');
    report('回大厅', errs);
    await page.context().close();
  }
  // 6) 手机竖屏的完整菜单（玩过一局）点回大厅：模式卡曾经叠在按钮上把点击截走
  if (want(6)) {
    const errs: string[] = [];
    const page = await open('', errs, { width: 390, height: 844 }, () => localStorage.setItem('yexun.save', JSON.stringify({ v: 1, runs: 1 })));
    await page.route((u: URL) => u.pathname === '/' && u.search === '', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>大厅</title>' }));
    await page.locator('.yx-homescreen .yx-quick').waitFor({ state: 'visible' }).catch(() => fail('竖屏没有出现完整主页'));
    // 不用 force：按钮被别的元素盖住时 playwright 会超时，正好就是要抓的问题
    await Promise.all([page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 }).catch(() => fail('竖屏主页点回大厅没有去 /')), page.locator('.yx-homescreen .yx-home').click({ timeout: 10_000 }).catch(() => fail('竖屏菜单的回大厅点不到（被盖住）'))]);
    if (page.url() === `${ORIGIN}/`) ok('竖屏主页点回大厅：去了 /');
    report('竖屏菜单回大厅', errs);
    await page.context().close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(`冒烟失败 ${problems.length} 项`);
  process.exit(1);
}
console.log('冒烟全部通过');
