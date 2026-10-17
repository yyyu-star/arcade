/**
 * 冒烟（AGENTS.md 第 4 节"每个游戏一个无头浏览器冒烟"）：起 vite 开发服务器（系统分配端口），单机打完一整场（?turbo 电脑不停顿），
 * 横屏、竖屏各一遍；检查控制台零报错（开发时平台接口没起，/api 的 502 不算）、结算出来、对局中点"大厅"先确认。
 * 用法：npm run smoke。截图在 shots/smoke-*.png。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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

/**
 * 单机的互动（kit 的 table-fun，开发服务器上 main.ts 把组件挂在 window.__fun、流水在 window.__funLog）：
 * 点一个电脑的头像，菜单里 8 个道具 + 3 句点名 + 屏蔽他，扔第二个道具（菜单收起）；点自己的头像，12 个表情里发一个；
 * "互动"按钮的面板里点名说一句。按控件的屏幕中心点（kit 的 controls()），流水里要有扔道具、表情、短语三行。
 * 截一张头像菜单开着的图（shots/smoke-<land/port>-menu.png 和 -panel.png），面板要整个在屏幕里
 */
async function soloFun(page: Page, name: string): Promise<void> {
  type Box = { x: number; y: number; w: number; h: number };
  const controls = (): Promise<Record<string, Box>> => page.evaluate(() => (window as unknown as { __fun: { controls(): Record<string, Box> } }).__fun.controls());
  const tap = async (key: string): Promise<void> => {
    const c = (await controls())[key];
    if (!c) throw new Error(`没有控件 ${key}`);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(150);
  };
  const log = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __funLog?: string[] }).__funLog ?? []);
  await page.waitForFunction(() => !!(window as unknown as { __fun?: unknown }).__fun);
  await tap('fun:seat1');
  const menu = Object.keys(await controls());
  const props = menu.filter((k) => /^fun:prop\d/.test(k)).length;
  const named = menu.filter((k) => /^fun:named\d/.test(k)).length;
  if (props !== 8 || named !== 3 || !menu.includes('fun:block')) throw new Error(`头像菜单不是 8 个道具 + 3 句点名 + 屏蔽他：${props}、${named}`);
  await page.screenshot({ path: `${root}shots/smoke-${name}-menu.png` });
  await tap('fun:prop1');
  await page.waitForTimeout(1_700);
  await tap('fun:seat0');
  const mine = Object.keys(await controls()).filter((k) => /^fun:sticker\d/.test(k)).length;
  if (mine !== 12) throw new Error(`自己的表情菜单不是 12 个：${mine}`);
  await tap('fun:sticker2');
  await page.waitForTimeout(1_200);
  await tap('fun:button');
  // 面板整个在屏幕里（kit 0.11.2 起窄屏自己收窄，这里守着别回退）
  const out = await page.evaluate(() => [...document.querySelectorAll('.atf-box')].some((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; }));
  if (out) throw new Error('互动面板伸出屏幕');
  await page.screenshot({ path: `${root}shots/smoke-${name}-panel.png` });
  await tap('fun:tab:phrase');
  await tap('fun:phrase0');
  await page.waitForTimeout(300);
  const lines = await log();
  for (const [what, re] of [['扔道具', /^道具 0>1/], ['发表情', /^表情 0/], ['说短语', /^短语 0/]] as const) {
    if (!lines.some((l) => re.test(l))) throw new Error(`互动流水里没有${what}：${lines.join(' | ')}`);
  }
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
  // 主页（0.17.0）→ 娱乐卡 → 选桌页 → 单机开打
  await page.waitForSelector('.home-main');
  await page.click('.mode.fun');
  await page.waitForSelector('.lobby-head');
  await page.click('text=单机开打');
  await page.waitForSelector('.my-hand .tile');
  // 对局中点"大厅"：先问一次，点"接着打"留在牌桌
  await page.click('.home');
  await page.waitForSelector('text=接着打');
  await page.click('text=接着打');
  await soloFun(page, name);
  if (!(await play(page, name))) errors.push('一场里没出现过胡牌亮牌');
  await page.screenshot({ path: `${root}shots/smoke-${name}.png` });
  // 结算页的"分享"（docs/social.md 1.1）：无头浏览器没有带文件的系统分享，出 kit 的预览层（存图、复制链接、关闭）
  await page.click('.share-card');
  await page.waitForSelector('[data-key="share:close"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${root}shots/smoke-${name}-share.png` });
  // 卡片原图另存一份（kit 0.15.0 起右下角有二维码，人工看一眼）
  const card = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('img[alt="战绩图"]');
    if (!img) return null;
    const b = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  });
  if (card) writeFileSync(`${root}shots/smoke-${name}-card.png`, Buffer.from(card, 'base64'));
  else errors.push('分享预览里没有卡片图');
  await page.click('[data-key="share:close"]');
  const shared = await page.evaluate(() => (window as unknown as { __shareLog?: string[] }).__shareLog ?? []);
  if (!shared.includes('分享 预览')) errors.push(`分享没出预览：${shared.join(' | ')}`);
  // 回选桌、再回主页，看一眼规则表
  await page.click('text=回选桌');
  await page.click('.pill.back');
  await page.waitForSelector('.home-main');
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
