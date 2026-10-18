/**
 * 单独部署冒烟（README "单独部署这个游戏"）：用模块根目录的 wrangler.jsonc 原样起 wrangler dev（没有平台、没有钱包），两个浏览器都是游客。
 * 检查：站点根转到 /games/mahjong/；选桌页只有娱乐、没有钱包、"大厅"变成"首页"；单机打一局；A 填昵称开好友房、B 填昵称凭链接进来、开打、
 * 对电脑扔个道具、打几手；两边控制台零报错。端口由系统分配。截图放 shots/（--shots 可改）。
 *
 *   npm run build:cf && node scripts/smoke-standalone.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const args = process.argv.slice(2);
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1]! : join(ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const errors: string[] = [];
const failures: string[] = [];
const t0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[standalone ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const check = (ok: boolean, what: string): void => {
  log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures.push(what);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
    s.on('error', fail);
  });
}

async function startWorker(port: number, state: string): Promise<ChildProcess> {
  const p = spawn('npx', ['wrangler', 'dev', '-c', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  p.stdout!.on('data', (d) => (out += d));
  p.stderr!.on('data', (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/games/mahjong/`)).ok) return p;
    } catch {
      // 还没起来
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not start:\n${out.slice(-2000)}`);
}

async function guest(browser: Browser, tag: string, viewport: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('mahjong.guide', '1'));
  // CSP 违规（cf/_headers）打成控制台报错，和别的报错一起算进"零报错"
  await ctx.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) => console.error(`csp ${e.disposition}: ${e.effectiveDirective} ${e.blockedURI || '(inline)'} ${e.sourceFile}:${e.lineNumber}`)),
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // 没有平台：/api/me、/api/wallet 不存在，detectPlatform 问的那一下 404 是预期的
    if ((m.type() === 'error' || m.type() === 'warning') && !/404/.test(m.text())) errors.push(`[${tag}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return page;
}

/** 打一步：换三张、定缺照推荐，能胡就胡，不然过，轮到打牌打最右边那张 */
async function step(page: Page): Promise<void> {
  const T = { timeout: 1_000 };
  if (await page.$('.mask')) return;
  if (await page.$('text=帮我选')) {
    await page.click('text=帮我选', T).catch(() => {});
    await page.click('button:has-text("换出")', T).catch(() => {});
  } else if (await page.$('.act.que.best')) await page.click('.act.que.best', T).catch(() => {});
  else if (await page.$('.bar .act.ron')) await page.click('.bar .act.ron', T).catch(() => {});
  else if (await page.$('.bar .act.pass')) await page.click('.bar .act.pass', T).catch(() => {});
  else {
    const t = (await page.$$('.my-hand .tile:not(.off)')).at(-1);
    if (t) {
      await t.click(T).catch(() => {});
      await t.click(T).catch(() => {});
    }
  }
}

async function nickname(page: Page, name: string): Promise<void> {
  await page.fill('.nick input', name);
  await page.press('.nick input', 'Tab');
}

let proc: ChildProcess | null = null;
let browser: Browser | null = null;
const state = mkdtempSync(join(tmpdir(), 'mahjong-standalone-'));
try {
  const port = await freePort();
  proc = await startWorker(port, state);
  const base = `http://localhost:${port}`;
  log('wrangler dev（独立配置）起来了', base);
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  check(root.status === 302 && new URL(root.headers.get('location')!, base).pathname === '/games/mahjong/', '站点根转到 /games/mahjong/');
  const stake = await fetch(`${base}/games/mahjong/api/stake/buyin`, { method: 'POST', headers: { origin: base, 'x-arcade': '1' }, body: '{}' });
  check(stake.status === 409, `单机实盘接口拒绝（${stake.status}）`);

  browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
  const a = await guest(browser, 'A', { width: 1280, height: 720 });
  const b = await guest(browser, 'B', { width: 390, height: 844 });

  // 选桌页：只有娱乐，没有钱包，"首页"
  await a.goto(`${base}/?turbo`);
  await a.waitForSelector('.home-main');
  check(new URL(a.url()).pathname === '/games/mahjong/', '打开站点根落到游戏首页');
  check(!(await a.$('.mode.real')), '主页没有实盘卡');
  await a.click('.mode.fun');
  await a.waitForSelector('.lobby-head');
  const labels = await a.$$eval('.stakes-label', (xs) => xs.map((x) => x.textContent ?? ''));
  const stakes = await a.$$eval('.stakes .stake', (xs) => xs.length);
  check(labels.length === 1 && /娱乐/.test(labels[0] ?? '') && stakes === 3, `选桌页只有娱乐的三个难度（${labels.join(' / ')}，${stakes} 张卡）`);
  check(((await a.textContent('.wallet-chip')) ?? '') === '', '顶栏没有钱包');
  check((await a.getAttribute('.home', 'href')) === './' && /首页/.test((await a.textContent('.home')) ?? ''), '"大厅"变成回游戏首页');
  await a.screenshot({ path: join(SHOTS, 'standalone-lobby.png') });

  // 单机：打到第一局结束
  await a.click('text=单机开打');
  await a.waitForSelector('.my-hand .tile');
  for (let i = 0; i < 3_000 && !(await a.$('text=下一局')); i++) {
    await step(a);
    await a.waitForTimeout(40);
  }
  check(!!(await a.$('text=下一局')), '单机打完第一局');
  // 回首页（本地存档留着，选桌页会有"接着打上一场"）
  await a.goto(`${base}/games/mahjong/`);
  await a.waitForSelector('.home-main');
  await a.click('.mode.room');
  await a.waitForSelector('.lobby-head');

  // 好友房：两个游客，各填昵称
  await nickname(a, '阿花');
  await a.click('text=开房间叫朋友');
  await a.waitForSelector('.room-code', { timeout: 15_000 });
  const code = ((await a.textContent('.room-code')) ?? '').trim();
  check(/^\d{6}$/.test(code), `游客开好友房 ${code}`);
  await b.goto(`${base}/games/mahjong/`);
  await b.waitForSelector('.home-main');
  await b.click('.mode.room');
  await b.waitForSelector('.lobby-head');
  await nickname(b, '小王');
  await b.goto(`${base}/games/mahjong/?room=${code}`);
  await b.waitForSelector('.room-code');
  await b.click('.room-seat.empty .act');
  await b.waitForSelector('.room-seat.me');
  await a.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length >= 2);
  const names = await a.$$eval('.room-seat:not(.empty)', (xs) => xs.map((x) => x.textContent ?? ''));
  check(names.some((x) => x.includes('阿花')) && names.some((x) => x.includes('小王')), `两个游客的昵称都在（${names.join(' / ')}）`);
  await a.click('button:text-is("开打")');
  await Promise.all([a.waitForSelector('.my-hand .tile', { timeout: 20_000 }), b.waitForSelector('.my-hand .tile', { timeout: 20_000 })]);
  check(true, '游客好友房开打');
  // A 冲一个电脑（座位 2）扔个道具：点头像，菜单里第一个道具（kit 的 table-fun）
  await a.click('.atf-hot[data-seat="2"]');
  await a.click('[data-key="fun:prop0"]');
  check(!!(await b.waitForSelector('.arcade-fun > *', { timeout: 4_000 }).catch(() => null)), 'A 扔的道具 B 看得到');
  for (let i = 0; i < 60; i++) {
    await Promise.all([step(a), step(b)]);
    await sleep(300);
  }
  await a.screenshot({ path: join(SHOTS, 'standalone-room-a.png') });
  await b.screenshot({ path: join(SHOTS, 'standalone-room-b.png') });
  check(!(await a.$('text=和房间断开了')) && !(await b.$('text=和房间断开了')), '打了一阵，两边都没断');
  check(errors.length === 0, '两边控制台零报错');
} catch (e) {
  failures.push(String(e));
  log('FAIL', e instanceof Error ? e.message : e);
} finally {
  await browser?.close().catch(() => {});
  if (proc?.pid) {
    try {
      process.kill(-proc.pid);
    } catch {
      // 已经退了
    }
  }
  rmSync(state, { recursive: true, force: true });
}
if (errors.length) console.log(errors.join('\n'));
log(failures.length ? `失败 ${failures.length} 项` : '全部通过');
process.exit(failures.length ? 1 : 0);
