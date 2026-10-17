/**
 * 出牌手感量一量（DESIGN.md 第 7 节"出牌手感"）：起一个 vite 开发服务器（系统分配端口），无头浏览器开单机，轮到我打牌时真的用鼠标点，
 * 量三个数（毫秒，浏览器里 performance.now() 记）：
 * - 抬起：点第一下到那张牌抬起来（画出 .up）；
 * - 动起来：打出那一下（第二下、双击、回车）到牌河里出现这张牌、开始飞；
 * - 落下：到飞进牌河的动画放完。
 * 用法：node scripts/feel.ts [land|port] [次数] [keys]。带 keys 时用键盘打（← 选牌、回车打出），量的是同样三个数。只是本地自查，不进 CI；改出牌手感前后各跑一次贴进 PR。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const SIZES = { land: { width: 1280, height: 720 }, port: { width: 390, height: 844 } } as const;
const orient = (process.argv[2] ?? 'land') in SIZES ? (process.argv[2] as keyof typeof SIZES) : 'land';
const times = Number(process.argv[3] ?? 8);
const keys = process.argv[4] === 'keys';
const root = new URL('..', import.meta.url).pathname;

const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
const page = await browser.newPage({ viewport: SIZES[orient] });
await page.addInitScript(() => {
  localStorage.setItem('mahjong.guide', '1');
  localStorage.setItem('mahjong.prefs', JSON.stringify({ fast: true }));
  // 牌河里新出现的牌：记下出现的时刻和它飞进来的动画多长
  const w = window as unknown as { __feel: { down: number; river: number; land: number } | null; __arm(): void };
  w.__feel = null;
  w.__arm = () => {
    const box = document.querySelector('.river.r0');
    if (!box) return;
    const rec = { down: performance.now(), river: 0, land: 0 };
    w.__feel = rec;
    const mo = new MutationObserver(() => {
      const t = box.lastElementChild as HTMLElement | null;
      if (!t || rec.river) return;
      rec.river = performance.now();
      // 只看脚本起的飞行动画（table.ts 的 fly），不看 CSS 的"刚打出"高亮
      const a = t.getAnimations().find((x) => !(x instanceof CSSAnimation) && !(x instanceof CSSTransition));
      const d = a ? Number(a.effect?.getComputedTiming().duration ?? 0) : 0;
      rec.land = rec.river + d;
      mo.disconnect();
    });
    mo.observe(box, { childList: true });
  };
});
await page.goto(`http://127.0.0.1:${port}/games/mahjong/`);
await page.waitForSelector('.lobby-head');
await page.click('text=单机开打');

const lift: number[] = [];
const move: number[] = [];
const land: number[] = [];
const deadline = Date.now() + 240_000;
while (move.length < times && Date.now() < deadline) {
  await page.waitForTimeout(150);
  if (await page.$('.mask.end')) {
    if (await page.$('text=下一局')) await page.click('text=下一局');
    else break;
    continue;
  }
  if (await page.$('text=帮我选')) {
    await page.click('text=帮我选');
    await page.click('button:has-text("换出")');
    continue;
  }
  if (await page.$('.act.que.best')) {
    await page.click('.act.que.best');
    continue;
  }
  if (await page.$('.act.pass')) {
    await page.click('.act.pass');
    continue;
  }
  const tiles = await page.$$('.my-hand .tile:not(.off)');
  const t = tiles.at(-1);
  if (!t || !(await page.$('.my-hand .tile.drawn:not(.ghost)'))) continue;
  const box = await t.boundingBox();
  if (!box) continue;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // 第一下：抬起来
  const t0 = await page.evaluate(() => performance.now());
  if (keys) await page.keyboard.press('ArrowLeft');
  else await page.mouse.click(x, y);
  const up = await page
    .waitForFunction(() => document.querySelector('.my-hand .tile.up') && performance.now(), null, { timeout: 2_000, polling: 'raf' })
    .then((h) => h.jsonValue() as Promise<number>)
    .catch(() => 0);
  if (up) lift.push(up - t0);
  // 第二下：打出去（点的位置是抬起前量的，抬起只往上挪几像素，点得到）
  await page.evaluate(() => (window as unknown as { __arm(): void }).__arm());
  if (keys) await page.keyboard.press('Enter');
  else await page.mouse.click(x, y - 6);
  const r = await page
    .waitForFunction(() => {
      const f = (window as unknown as { __feel: { down: number; river: number; land: number } | null }).__feel;
      return f && f.river ? f : null;
    }, null, { timeout: 2_000, polling: 'raf' })
    .then((h) => h.jsonValue() as Promise<{ down: number; river: number; land: number }>)
    .catch(() => null);
  if (r) {
    move.push(r.river - r.down);
    land.push(r.land - r.down);
  }
}

const stat = (xs: number[]): string => {
  if (!xs.length) return '没量到';
  const s = [...xs].sort((a, b) => a - b);
  return `中位 ${Math.round(s[Math.floor(s.length / 2)]!)}，最大 ${Math.round(s.at(-1)!)}（${s.length} 次）`;
};
console.log(`[${orient}] 抬起 ${stat(lift)}`);
console.log(`[${orient}] 动起来 ${stat(move)}`);
console.log(`[${orient}] 落下 ${stat(land)}`);
await browser.close();
await server.close();
