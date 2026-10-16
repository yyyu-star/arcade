/**
 * 冒烟（AGENTS.md 第 4 节"每个游戏一个无头浏览器冒烟"）：起 vite 开发服务器（系统分配端口），单机打完一整场（?turbo 电脑不停顿），
 * 横屏、竖屏各一遍；检查控制台零报错（开发时平台接口没起，/api 的 502 不算）、结算出来、对局中点"大厅"先确认。
 * 用法：npm run smoke。截图在 shots/smoke-*.png。
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}shots`, { recursive: true });
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
let failed = false;

async function play(page: Page, name: string): Promise<boolean> {
  // 我这一家：换三张、定缺照推荐；能胡就胡，有碰杠的选择就过；轮到打牌打最右边能打的那张
  // 第一次出现"听"的标记：点一下那张，操作条上要摆出听哪些牌，截一张图
  let ting = false;
  // 第一次轮到打牌：按住最右边那张往上拖出去，河里要多一张
  let dragged = false;
  // 胡牌亮牌：第一次出现截一张（要有番型和合计）
  let hu = false;
  for (let i = 0; i < 3_000; i++) {
    if (!hu && (await page.$('.hu-card .total'))) {
      hu = true;
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${root}shots/smoke-${name}-hu.png` });
    }
    if (await page.$('text=再来一场')) {
      // 能不能碰上"打了能听"看这一场的牌（自己这家只会打最右边那张，早早有人打光就散场），碰不上只提示；听牌的算法有单测
      if (!ting) console.log(`${name}: 这一场没碰上能听牌的时候，听牌提示没点到（看运气，不算错）`);
      return hu;
    }
    if (await page.$('text=下一局')) await page.click('text=下一局');
    else if (await page.$('text=帮我选')) {
      await page.click('text=帮我选');
      await page.click('button:has-text("换出")');
    } else if (await page.$('.act.que.best')) await page.click('.act.que.best');
    else if (await page.$('.bar .act.ron')) await page.click('.bar .act.ron');
    else if (await page.$('.bar .act.pass')) await page.click('.bar .act.pass');
    else if (!ting && (await page.$('.my-hand .tile.ting'))) {
      ting = true;
      await page.click('.my-hand .tile.ting');
      await page.waitForSelector('.bar .ting .k');
      await page.screenshot({ path: `${root}shots/smoke-${name}-ting.png` });
    } else if (!dragged && (await page.$('.bar .hint:has-text("往上拖")'))) {
      dragged = true;
      const before = (await page.$$('.river.r0 .tile')).length;
      const box = (await (await page.$$('.my-hand .tile:not(.off)')).at(-1)!.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 4 });
      await page.mouse.move(box.x + box.width / 2, box.y - 70, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction((n) => document.querySelectorAll('.river.r0 .tile').length > n, before);
    } else {
      const t = (await page.$$('.my-hand .tile:not(.off)')).at(-1);
      if (t) {
        await t.click().catch(() => {});
        await t.click().catch(() => {});
      }
    }
    await page.waitForTimeout(40);
  }
  throw new Error(`${name}: match did not finish`);
}

// 平台大厅的"好友房"按钮带 ?online=1：开房、进房那一块亮起来，参数用完从地址栏去掉
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => localStorage.setItem('mahjong.guide', '1'));
  await page.goto(`http://127.0.0.1:${port}/games/mahjong/?online=1`);
  const ok = !!(await page.waitForSelector('.join.spot', { timeout: 5_000 }).catch(() => null)) && !page.url().includes('online');
  failed ||= !ok;
  console.log(`online=1: ${ok ? 'ok，好友房入口亮起、地址栏去掉参数' : '没有亮起或参数没去掉'}`);
  await page.close();
}

for (const [name, viewport] of [
  ['land', { width: 1280, height: 720 }],
  ['port', { width: 390, height: 844 }],
] as const) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && !/502|Bad Gateway/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('mahjong.guide', '1'));
  await page.goto(`http://127.0.0.1:${port}/games/mahjong/?turbo`);
  await page.waitForSelector('.lobby-head');
  await page.click('text=单机开打');
  await page.waitForSelector('.my-hand .tile');
  // 对局中点"大厅"：先问一次，点"接着打"留在牌桌
  await page.click('.home');
  await page.waitForSelector('text=接着打');
  await page.click('text=接着打');
  if (!(await play(page, name))) errors.push('一场里没出现过胡牌亮牌');
  await page.screenshot({ path: `${root}shots/smoke-${name}.png` });
  // 回选桌，再看一眼规则表
  await page.click('text=回选桌');
  await page.click('text=规则和番型表');
  await page.waitForSelector('.rules table');
  const ok = errors.length === 0;
  failed ||= !ok;
  console.log(`${name}: ${ok ? 'ok，控制台零报错' : `控制台报错：\n${errors.join('\n')}`}`);
  await page.close();
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
