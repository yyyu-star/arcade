/**
 * PR 用的截图（CONTRIBUTING.md 的模板：电脑 1280×720、手机横屏）：选桌页、挂挡、出牌预览、亮牌后的问题、结算，存到 shots/pr-*.png。
 * 我这辆车挂得越高越好、能冲就冲，好让画面里出现热量、打滑这些。用法：node scripts/shots.ts
 *
 * node scripts/shots.ts tut：新手教程和 0.1.4 那三条反馈的截图（电脑 1280×720、手机竖屏 390×844，正常速度），存到 shots/tut-*.png：
 * 选桌页的气泡、讲解、操作步的高亮、讲限速牌、情景提示、毕业；冲线那一刻（结算还没弹）、结算的"大厅"、收起以后、电脑冒话不压名字。
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

async function run(page: Page, name: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/games/racing/?turbo`);
  await page.waitForSelector('.track-card');
  await page.screenshot({ path: `${root}shots/pr-${name}-lobby.png` });
  await page.click('.track-card[data-id="hillcity"]');
  await page.click('.seg[data-laps="1"]');
  await page.click('text=单机开跑');
  await page.waitForSelector('.gearbox');
  await page.screenshot({ path: `${root}shots/pr-${name}-gear.png` });
  // 第一回合手动走：挂 2 挡 → 挂好了 → 放两张牌进出牌区，截出牌这一步（预览、虚影车、预设）
  await page.click('.gate-btn[aria-label="2 挡"]');
  await page.click('.dash-action .act.go:has-text("挂好了")');
  for (let k = 0; k < 2; k++) await page.click('.hand.live .card:not(:disabled) >> nth=-1');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${root}shots/pr-${name}-plan.png` });
  let plan = true;
  let ask = false;
  for (let i = 0; i < 3_000; i++) {
    if (await page.$('.mask.end')) break;
    if (!ask && (await page.$('.ask'))) {
      ask = true;
      await page.screenshot({ path: `${root}shots/pr-${name}-ask.png` });
    }
    if (!plan && i > 8 && (await page.$('.dash-action .preview .speed'))) {
      plan = true;
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${root}shots/pr-${name}-plan.png` });
    }
    // 我这辆车挂得越高越好、能冲就冲
    if (!(await drive(page, [4, 3, 2, 1], true))) await page.waitForTimeout(25);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${root}shots/pr-${name}-end.png` });
}

/** 新手教程：气泡出来、镜头飞到位以后截 */
async function tutorial(page: Page, name: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/games/racing/`);
  await page.waitForSelector('.lobby-head .tut-hint');
  await page.screenshot({ path: `${root}shots/tut-${name}-lobby.png` });
  await page.click('.lobby-head .tut-btn');
  const want: [string, string][] = [
    ['看底下这排牌', 'explain'],
    ['挂到 2 挡', 'op'],
    ['挑两张大的', 'op-cards'],
    ['虚线小车', 'ghost'],
    ['前面有弯了', 'limit'],
    ['3、2、1 的小牌', 'brake'],
    ['冲刺！花 1 张热量', 'tip'],
  ];
  const seen = new Set<string>();
  // 弃牌只问第一次：第一回合问弃牌那一下截一张；第二回合我回答完最后一个问题、没再问弃牌时再截一张
  let r2asked = false;
  let quiet = 0;
  for (let i = 0; i < 6_000; i++) {
    const ask = await page.$('.dash-action .ask .act-title');
    const title = (await ask?.textContent()) ?? '';
    const round = (await (await page.$('.side-head span'))?.textContent()) ?? '';
    if (title.includes('弃牌') && !seen.has('discard1') && !(await page.$('.coach:not([hidden]) .coach-bubble'))) {
      seen.add('discard1');
      await page.screenshot({ path: `${root}shots/tut-${name}-discard1.png` });
    }
    if (round.includes('第 2 回合') && ask) r2asked = true;
    quiet = r2asked && !ask && !seen.has('discard2') ? quiet + 1 : 0;
    if (quiet >= 15) {
      seen.add('discard2');
      await page.screenshot({ path: `${root}shots/tut-${name}-discard2.png` });
    }
    const b = await page.$('.coach:not([hidden]) .coach-bubble');
    const text = (await b?.textContent()) ?? '';
    const hit = want.find(([k, n]) => text.includes(k) && !seen.has(n));
    if (hit) {
      seen.add(hit[1]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${root}shots/tut-${name}-${hit[1]}.png` });
    }
    const r = await driveTutorial(page);
    if (r === 'grad') break;
    if (!r) await page.waitForTimeout(40);
  }
  await page.waitForSelector('.mask.end');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}shots/tut-${name}-grad.png` });
}

/** 三条反馈：电脑冒话不压名字、冲线那一刻、结算的"大厅"、收起看赛道 */
async function feedback(page: Page, name: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/games/racing/`);
  await page.waitForSelector('.track-card');
  await page.click('.seg[data-laps="1"]');
  await page.click('.seg[data-cars="4"]');
  await page.click('text=单机开跑');
  await page.waitForSelector('.dash-action .act.go');
  // 点名一辆电脑说一句，它会回（短语或者表情）
  for (const k of [2, 3]) {
    await page.click('.comms-btn');
    await page.click(`.comms-who .chip:nth-of-type(${k})`);
    await page.click('.comms-body .phrase >> nth=5');
    await page.waitForTimeout(1_150);
    await page.screenshot({ path: `${root}shots/tut-fix-${name}-talk${k - 1}.png` });
  }
  let finished = false;
  for (let i = 0; i < 6_000; i++) {
    if (await page.$('.mask.end')) break;
    if (!finished && (await page.$('.standings .row.me .st:has-text("第")'))) {
      finished = true;
      await page.screenshot({ path: `${root}shots/tut-fix-${name}-finish.png` });
    }
    if (!(await drive(page, [3, 2, 4, 1], true))) await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${root}shots/tut-fix-${name}-end.png` });
  await page.click('.mask.end .end-fold');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${root}shots/tut-fix-${name}-folded.png` });
}

if (process.argv[2] === 'tut') {
  for (const [name, o] of [
    ['pc', { viewport: { width: 1280, height: 720 } }],
    ['port', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ] as const) {
    const page = await browser.newPage(o);
    await tutorial(page, name);
    await feedback(page, name);
    await page.close();
  }
} else {
  for (const [name, viewport] of [
    ['pc', { width: 1280, height: 720 }],
    ['phone', { width: 844, height: 390 }],
  ] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: name === 'phone' ? 2 : 1 });
    await run(page, name);
    await page.close();
  }
}
await browser.close();
await server.close();
