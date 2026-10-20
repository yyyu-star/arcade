/**
 * 冒烟（AGENTS.md 第 4 节"每个游戏一个无头浏览器冒烟"）：起 vite 开发服务器（系统分配端口），单机跑完一整场（?turbo 动画和电脑不停顿），
 * 横屏、竖屏各一遍；检查控制台零报错、结算出来、比赛中点"大厅"先确认、"跟车"和"全图"能点。
 * 资源：开发时平台接口没起，只放过 /api/ 下的 502、504 和超时掐断；别的请求失败或 4xx、5xx（比如资源 404）都算失败。
 * 跑到一半点一次弃牌区（弹出用过的牌）和牌堆（还剩哪些）。
 * 横屏那一遍还点一遍"聊"：点名电脑说一句、冲它扔番茄、按人屏蔽、关掉再打开总开关。
 * 手机：竖屏那一遍按手机模拟（触屏、像素比 3、CPU 降速 4 倍当省内存设备）；横屏那一遍模拟一次双指放大（visualViewport.scale = 2 时舞台不能重排）。
 * 我这辆车照驾驶台的顺序开（scripts/drive.ts）：先挂 3 挡或 2 挡，再把手牌放进出牌区；问冲刺、拼劲、尾流一律"不了"，问弃牌"不弃"。
 * 结算：有"大厅"，"收起，看看赛道"收起再展开。
 * 新手教程（横竖各一遍）：先留一场没跑完的单机存档，从选桌页点"新手教程"，阿驰的讲解点"下一步"、操作步照着高亮点完，进自由驾驶，
 * 跑到冲线看到毕业气泡；查教程没动 racing.solo、racing.prefs，记下了 racing.tutorial，回选桌后"第一次来？"不再冒。
 * 用法：npm run smoke。截图在 shots/smoke-*.png。
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { launch } from './browser.ts';
import { drive, driveTutorial } from './drive.ts';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}shots`, { recursive: true });
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await launch();
let failed = false;

async function race(page: Page, name: string): Promise<boolean> {
  let shot = 0;
  let peeked = false;
  for (let i = 0; i < 4_000; i++) {
    if (await page.$('.mask.end')) {
      if (!peeked) throw new Error(`${name}: 一场跑完都没点到弃牌区`);
      return true;
    }
    if (shot < 2 && i > 20 * (shot + 1) && (await page.$('.dash-action .act.go'))) {
      shot++;
      await page.screenshot({ path: `${root}shots/smoke-${name}-${shot}.png` });
    }
    // 打了几回合以后点一次弃牌区：弹出这一场用过的牌，再点一次牌堆
    if (!peeked && i > 30 && (await page.$('.zone.discard:not(:disabled)')) && (await page.$('.dash-action .act.go'))) {
      // 电脑走的时候驾驶台会重画，点击可能落在刚换掉的按钮上：没弹出来就再点，几次都不行才算失败
      const open = async (zone: string, inside: string): Promise<void> => {
        for (let k = 0; k < 6; k++) {
          await page.click(zone).catch(() => {});
          if (await page.waitForSelector(inside, { timeout: 1_500 }).catch(() => null)) return;
        }
        throw new Error(`${name}: 点 ${zone} 没弹出来`);
      };
      await open('.zone.discard', '.mask.pile .pile-cards .mini');
      await page.screenshot({ path: `${root}shots/smoke-${name}-discard.png` });
      await page.click('.mask.pile .act.go');
      // 牌堆刚好抓空时弹窗里写"空的"、没有小牌，所以只等弹窗本身
      await open('.zone.deck', '.mask.pile .pile-counts');
      await page.click('.mask.pile .act.go');
      peeked = true;
    }
    // 我这辆车稳着开：3 挡或 2 挡，问什么都"不了"
    if (!(await drive(page, [3, 2, 1, 4], false))) await page.waitForTimeout(25);
  }
  if (!peeked) console.error(`${name}: 没点到弃牌区`);
  return false;
}

/** 新手教程走一遍（DESIGN.md 8.1）；返回发现的问题 */
async function tutorial(page: Page, name: string): Promise<string[]> {
  const bad: string[] = [];
  const store = (): Promise<Record<string, string | null>> =>
    page.evaluate(() => Object.fromEntries(['racing.solo', 'racing.prefs', 'racing.tutorial'].map((k) => [k, localStorage.getItem(k)])));
  await page.waitForSelector('.lobby-head .tut-btn');
  if (!(await page.$('.lobby-head .tut-hint'))) bad.push('没来过教程，选桌页没冒"第一次来？"');
  // 先留一场没跑完的单机：开跑、出一手牌、离开回选桌（存着下次接着跑）
  await page.click('text=单机开跑');
  await page.waitForSelector('.dash-action .act.go');
  for (let k = 0; k < 3; k++) await drive(page, [2], false);
  await page.click('.topbar .leave');
  await page.click('.mask.confirm button:has-text("回选桌")');
  await page.waitForSelector('.lobby-head .tut-btn');
  const before = await store();
  if (!before['racing.solo']) bad.push('没留下单机存档，测不了教程碰没碰它');
  await page.click('.lobby-head .tut-btn');
  await page.waitForSelector('.coach:not([hidden]) .coach-bubble');
  await page.screenshot({ path: `${root}shots/smoke-${name}-tut-intro.png` });
  let free = false;
  let opShot = false;
  let grad = false;
  // 弃牌只问第一次（之后按"不弃"跳过）：数一数问了几回
  let discardAsks = 0;
  let asking = false;
  for (let i = 0; i < 4_000 && !grad; i++) {
    const discard = !!(await page.$('.dash-action .ask .act-title:has-text("弃牌")'));
    if (discard && !asking) discardAsks++;
    asking = discard;
    // 没有气泡时不能用 page.textContent（它会一直等到气泡出来）
    const text = (await (await page.$('.coach:not([hidden]) .coach-bubble'))?.textContent()) ?? '';
    if (text.includes('剩下的路你自己开')) free = true;
    if (!opShot && text.includes('挂到 2 挡')) {
      opShot = true;
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${root}shots/smoke-${name}-tut-op.png` });
    }
    const r = await driveTutorial(page);
    if (r === 'grad') grad = true;
    else if (!r) await page.waitForTimeout(25);
  }
  if (!free) bad.push('教程没走到自由驾驶');
  if (!grad) bad.push('教程没跑到毕业');
  if (discardAsks !== 1) bad.push(`教程问了 ${discardAsks} 回弃牌（应该只问第一次）`);
  await page.screenshot({ path: `${root}shots/smoke-${name}-tut-grad.png` });
  const after = await store();
  if (after['racing.solo'] !== before['racing.solo']) bad.push('教程动了 racing.solo（玩家的续玩）');
  if (after['racing.prefs'] !== before['racing.prefs']) bad.push('教程动了 racing.prefs');
  if (!after['racing.tutorial']) bad.push('教程跑完没记 racing.tutorial');
  if (grad) {
    await page.click('.coach-bubble button:has-text("正式开跑")');
    await page.waitForSelector('.lobby-head .tut-btn');
    if (await page.$('.lobby-head .tut-hint')) bad.push('跑过教程，选桌页还在冒"第一次来？"');
    if (!(await page.$('.lobby-acts button:has-text("接着上一场")'))) bad.push('跑完教程，"接着上一场"没了');
  }
  return bad;
}

for (const [name, viewport] of [
  ['land', { width: 1000, height: 560 }],
  ['port', { width: 390, height: 780 }],
] as const) {
  const page = await browser.newPage(name === 'port' ? { viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport });
  const errors: string[] = [];
  const isApi = (url: string, status: number): boolean => new URL(url).pathname.startsWith('/api/') && (status === 502 || status === 504);
  page.on('response', (r) => {
    if (r.status() >= 400 && !isApi(r.url(), r.status())) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  // 平台的 /api/ 在本地没起：detectPlatform 等不到会自己掐断（ERR_ABORTED），和 502、504 一样放过；别的请求失败都算
  page.on('requestfailed', (r) => {
    if (!new URL(r.url()).pathname.startsWith('/api/')) errors.push(`请求失败 ${new URL(r.url()).pathname}：${r.failure()?.errorText ?? ''}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 加载失败的资源由上面的 response 逐条核对（浏览器这条消息不带地址），这里不重复记
    if (/^Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  if (name === 'port') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`http://127.0.0.1:${port}/games/racing/?turbo`);
  await page.waitForSelector('.track-card');
  await page.screenshot({ path: `${root}shots/smoke-${name}-lobby.png` });
  await page.click('.seg[data-laps="1"]');
  await page.click('.seg[data-cars="4"]');
  await page.click('text=单机开跑');
  await page.waitForSelector('.board-svg');
  await page.click('.board-tools button:has-text("跟车")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${root}shots/smoke-${name}-follow.png` });
  await page.click('.board-tools button:has-text("全图")');
  if (name === 'land') {
    // 双指放大：CDP 设页面缩放 = 手指捏开的结果；放大时舞台的尺寸和缩放不能跟着变，缩回 1 倍后照常
    const stageStyle = () => page.locator('.stage').evaluate((e) => (e as HTMLElement).style.cssText);
    const before = await stageStyle();
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(600);
    const zoomed = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await page.screenshot({ path: `${root}shots/smoke-${name}-pinch.png` });
    if (zoomed < 1.5) errors.push(`页面没放大（scale ${zoomed}）`);
    if ((await stageStyle()) !== before) errors.push('双指放大时舞台重排了');
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(600);
  }
  if (name === 'land') {
    // 单机的"聊"：点名一辆电脑说一句（气泡带 @名字）、冲它扔番茄、设置里屏蔽它、关掉再打开总开关
    await page.click('.comms-btn');
    await page.click('.comms-who .chip:nth-of-type(2)');
    await page.click('.comms-body .phrase >> nth=0');
    await page.waitForSelector('.race > .bubble:has-text("@")');
    await page.click('.comms-btn');
    await page.click('.comms-tabs .chip:has-text("道具")');
    await page.click('.comms-body .pic >> nth=0');
    await page.click('.comms-body .act >> nth=0');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${root}shots/smoke-${name}-comms.png` });
    await page.click('.comms-btn');
    await page.click('.comms-tabs .chip:has-text("设置")');
    await page.click('.comms-set >> nth=2 >> .chip');
    await page.click('.comms-set >> nth=0 >> .chip');
    if (!(await page.$('.comms.off'))) errors.push('关了总开关，"聊"按钮没变灰');
    await page.click('.comms-set >> nth=0 >> .chip');
    await page.click('.comms-btn');
  }
  // 比赛中点"大厅"：先问一次，点"接着跑"留下
  await page.click('.topbar .home');
  await page.waitForSelector('.mask.confirm');
  await page.click('.mask.confirm button:has-text("接着跑")');
  const ok = await race(page, name);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${root}shots/smoke-${name}-end.png` });
  if (!ok) {
    failed = true;
    console.error(`${name}: 没跑完`);
  } else {
    // 结算：有"大厅"（和顶栏的一样，这里不点：点了就离开页面了）；收起看赛道，再展开
    if (!(await page.$('.mask.end .end-home'))) errors.push('结算弹窗里没有"大厅"');
    await page.click('.mask.end .end-fold');
    await page.waitForSelector('.mask.end.folded');
    await page.screenshot({ path: `${root}shots/smoke-${name}-end-folded.png` });
    await page.click('.mask.end .end-fold');
    await page.click('.mask.end .end-acts button:has-text("回选桌")');
    errors.push(...(await tutorial(page, name)));
  }
  if (errors.length) {
    failed = true;
    console.error(`${name}: 控制台报错\n  ${errors.join('\n  ')}`);
  }
  console.log(`${name}: ${ok && !errors.length ? '通过' : '失败'}`);
  await page.close();
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
