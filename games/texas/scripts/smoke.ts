/**
 * 冒烟（AGENTS.md 第 4 节）：真的 Worker（页面 + 登录闸门 + 钱包）跑在本地 wrangler dev 里，平台换成 test/arcade.dev.ts；
 * 浏览器里平台的 /api/me、/api/saves 由这里代答。跑一遍主流程，控制台和页面报错一律算失败。
 *
 *   npm run build:cf && npm run smoke [-- --hands 30] [--shots 目录]
 *
 * 内容：标题页 → 新手提示（看完才发第一手）→ 坐下（钱包扣买入）→ 自动点着打满 N 手（一手打完不点"下一手"就不发、自动下一手有倒计时）
 * → 补码 → 离桌（结算页，结回钱包）→ 回大厅确认；
 * 手机横屏（像素比 3、触屏）、省内存设备（CPU 降速 4 倍）、双指放大不重排、竖屏提示；
 * 好友房：房主从平台大厅的"好友房"（?online=1）进来开房，三个人（一部手机）同桌打满 10 手（两手之间房间停一会儿、大家看同一个倒计时）、
 * 手机刷新后不自动进房、点标题页的"回到房间"回到座位，第四个人接管电脑座位，都离开后房间结束、房主再点"开房间"开出新的（不 409）、
 * 都离开后结算页、结回钱包（--only room 只跑这段）。
 * 桌面那一段开"快"动画（0.55 倍）省时间；默认速度的节奏用 scripts/capture.ts 连拍看。
 * 单独部署（--only standalone，不带 --only 时也跑）：原样的 wrangler.jsonc 另起一个 wrangler dev，不接假平台：站点根跳到游戏首页，
 * 没有钱包、云存档、实盘，"大厅"回游戏首页；单机娱乐打两手、离桌；两个游客（一个带昵称）开好友房打两手、离开（DESIGN.md 10.1）。
 * 端口一律由系统分配（不占 5175 / 4175）。截图放在 --shots（默认系统临时目录下的 texas-shots）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { opt } from './args.ts';

const HANDS = Number(opt('hands', '30'));
const SHOTS = opt('shots', join(tmpdir(), 'texas-shots'));
mkdirSync(SHOTS, { recursive: true });

const ROOT = new URL('..', import.meta.url).pathname;
const errors: string[] = [];
/** 开房的 409（has_room）按页面记数：0.2.4 起不该再有，最后核对是 0 */
const allowed409: Record<string, number> = {};
const log = (...a: unknown[]): void => console.log('[smoke]', ...a);

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

/** 平台模式用测试配置加假平台；单独部署用原样的 wrangler.jsonc（入口多导出了东西、配置写错，这里就起不来） */
const PLATFORM_CONFIG = ['-c', 'test/wrangler.smoke.jsonc', '-c', 'test/arcade.dev.jsonc'];
const STANDALONE_CONFIG = ['-c', 'wrangler.jsonc'];

async function startWorker(port: number, state: string, config: string[]): Promise<ChildProcess> {
  const origin = `http://localhost:${port}`;
  const p = spawn('npx', ['wrangler', 'dev', ...config, '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--var', `SITE_ORIGIN:${origin}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  p.stdout!.on('data', (d) => (out += d));
  p.stderr!.on('data', (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    try {
      // 平台模式没登录 302 到登录页，单独部署直接回页面
      const r = await fetch(`${origin}/games/texas/`, { redirect: 'manual' });
      if (r.status === 302 || r.status === 200) return p;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not start:\n${out.slice(-2000)}`);
}

/** 平台的接口：/api/me 认 cookie 里的人，云存档存在内存里 */
async function fakePlatform(ctx: BrowserContext, userId: string): Promise<void> {
  let rev = 0;
  let data: unknown = null;
  // 回大厅跳到的平台首页
  await ctx.route((u) => u.pathname === '/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>大厅</title>大厅' }));
  await ctx.route(/\/api\/(me|saves)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.startsWith('/games/')) return route.continue();
    if (url.pathname === '/api/me') return route.fulfill({ json: { user: { id: userId, displayName: '冒烟测试', username: 'smoke' }, saves: 'on' } });
    if (url.pathname === '/api/saves/texas' && req.method() === 'GET') return route.fulfill({ json: { saves: rev ? [{ slot: 'stats', rev, updatedAt: Date.now(), data }] : [] } });
    if (url.pathname === '/api/saves/texas/stats' && req.method() === 'PUT') {
      const b = req.postDataJSON() as { baseRev: number; data: unknown };
      if (b.baseRev !== rev) return route.fulfill({ status: 409, json: { error: 'conflict', current: rev ? { rev, data, updatedAt: Date.now() } : null } });
      rev++;
      data = b.data;
      return route.fulfill({ json: { rev, updatedAt: Date.now() } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}

async function newContext(browser: Browser, base: string, userId: string, device: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...device });
  // 平台的两个 cookie（__Host- 的不能带 Domain；CDP 这里要写 domain，浏览器照样当 host-only，localhost 算安全来源）
  const host = new URL(base).hostname;
  await ctx.addCookies([
    { name: '__Host-sid', value: userId, domain: host, path: '/', secure: true },
    { name: '__Host-arcade_li', value: '1', domain: host, path: '/', secure: true },
  ]);
  await fakePlatform(ctx, userId);
  return ctx;
}

function watch(page: Page, tag: string, allow409 = false): void {
  let rooms409 = 0;
  page.on('response', (r) => {
    if (r.status() === 409 && new URL(r.url()).pathname.endsWith('/rooms')) allowed409[tag] = ++rooms409;
  });
  page.on('console', (m) => {
    // 浏览器把 409 记成一条"Failed to load resource"：这个页面本该有一次（另一台设备开房），多了、少了最后核对
    if (allow409 && m.type() === 'error' && /409/.test(m.text()) && rooms409 <= 1) return;
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}

const shot = async (page: Page, name: string): Promise<void> => {
  // 弹窗、加注面板有 0.2 秒的淡入
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  log('shot', name);
};

async function balance(page: Page): Promise<number> {
  const t = (await page.locator('.w-balance').textContent()) ?? '';
  return Number(t.replace(/,/g, ''));
}

/** 跳过新手提示 */
async function skipTips(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const d = page.locator('.dialog');
    if (!(await d.isVisible().catch(() => false))) {
      await page.waitForTimeout(300);
      if (!(await d.isVisible().catch(() => false))) return;
    }
    await page.locator('.d-btn.primary').click();
  }
}

const handText = async (page: Page): Promise<number> => Number(((await page.locator('.hand-no').textContent()) ?? '').replace(/\D/g, '')) || 0;

/** 一手打完停着（0.1.1）：结果条亮着、"下一手"在，等 5 秒不点也不发 */
async function assertHeld(page: Page, tag: string): Promise<void> {
  const no = await handText(page);
  if (!(await page.locator('.result.on').isVisible())) throw new Error(`[${tag}] no result bar after hand ${no}`);
  await shot(page, `${tag}-hand-end`);
  await page.waitForTimeout(5_000);
  const phase = await page.locator('.stage').getAttribute('data-phase');
  if ((await handText(page)) !== no || phase !== 'idle') throw new Error(`[${tag}] dealt hand ${await handText(page)} (${phase}) without "下一手"`);
  if (!(await page.locator('.next-hand').isVisible()) || !(await page.locator('.result.on').isVisible())) throw new Error(`[${tag}] result or "下一手" went away`);
  log(tag, `hand ${no} held 5s until "下一手"`);
}

/** 自动下一手：打开后有倒计时圈，不点也会发（下一次停下时由 playUntil 关掉） */
async function assertAutoNext(page: Page): Promise<void> {
  await page.locator('.auto-next').click();
  if (!(await page.locator('.auto-next.sel').isVisible()) || !(await page.locator('.next-ring:not(.hidden)').isVisible())) throw new Error('auto next: no countdown ring');
  await shot(page, 'auto-next');
  const no = await handText(page);
  const t0 = Date.now();
  while ((await handText(page)) === no) {
    if (Date.now() - t0 > 10_000) throw new Error('auto next did not deal');
    await page.waitForTimeout(100);
  }
  log(`auto next dealt hand ${no + 1} after ${Date.now() - t0} ms`);
}

/** 自动打到第 n 手打完；大多跟注过牌，偶尔加注、弃牌，让各条路都走到。一手打完点"下一手"（第一次先核对不点不发、再试一次自动下一手） */
/** 加注面板盖住了几个座位的头像或名牌（单机打磨时加的检查）；只留名牌的座位（.tucked，0.9.0）头像藏着，不算 */
const coveredSeats = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const r = document.querySelector('.raise-panel')!.getBoundingClientRect();
    return [...document.querySelectorAll('.seat:not(.empty)')].filter((seat) =>
      [...seat.querySelectorAll(seat.classList.contains('tucked') ? '.plate' : '.avatar, .plate')].some((e) => {
        const b = e.getBoundingClientRect();
        return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
      }),
    ).length;
  });

/** 座位之间互相压着的对数（头像、名牌；0.9.0：原来挪开的座位会压到别的座位上，上面那个检查看不出来） */
const seatOverlaps = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.seat:not(.empty)')].map((seat) =>
      [...seat.querySelectorAll(seat.classList.contains('tucked') ? '.plate' : '.avatar, .plate')].map((e) => e.getBoundingClientRect()),
    );
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (boxes[i]!.some((a) => boxes[j]!.some((b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom))) n++;
    return n;
  });

async function playUntil(page: Page, hands: number, shotAt: Set<number>, checks = false): Promise<void> {
  let k = 0;
  let held = !checks;
  let auto = !checks;
  // 电脑按"像人"的节奏想，动画正常速度：6 人桌一手常要二三十秒
  const deadline = Date.now() + hands * 40_000;
  for (;;) {
    if (Date.now() > deadline) {
      await shot(page, 'too-long');
      throw new Error(`playing took too long (hand ${await handText(page)})`);
    }
    const no = await handText(page);
    if (no > hands) return;
    if (await page.locator('.next-hand').isVisible()) {
      if (no === hands) return;
      if (!held) {
        held = true;
        await assertHeld(page, 'desk');
      } else if (!auto && no >= 2) {
        auto = true;
        await assertAutoNext(page);
        continue;
      } else if (await page.locator('.auto-next.sel').isVisible()) {
        await page.locator('.auto-next').click();
        if (await page.locator('.next-ring:not(.hidden)').isVisible()) throw new Error('auto next: ring still shown after turning off');
      }
      await page.locator('.next-hand').click().catch(() => {});
      continue;
    }
    if (await page.locator('.dialog').isVisible()) {
      // 输光了：补上
      const title = await page.locator('.d-title').textContent();
      log('dialog:', title);
      await page.locator('.d-btn.primary').click();
      continue;
    }
    if (await page.locator('.actions.on').isVisible()) {
      if (shotAt.has(no)) {
        shotAt.delete(no);
        await shot(page, `table-turn-${no}`);
      }
      const r = k++ % 11;
      if (r === 3 && (await page.locator('.act.raise:not(.hidden)').isVisible())) {
        await page.locator('.act.raise').click();
        // 加注面板不能盖住任何座位：被盖住的座位要挪到面板上方（挪的动画 0.18 秒）
        // 机器忙时挪座位的动画会拖：最多等 1.5 秒挪完，还盖着才算失败（截一张留证）
        let covered = 0;
        for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(250);
          covered = await coveredSeats(page);
          if (!covered) break;
        }
        if (covered) {
          await shot(page, `raise-covers-${no}`);
          throw new Error(`raise panel covers ${covered} seat(s)`);
        }
        const stacked = await seatOverlaps(page);
        if (stacked) {
          await shot(page, `raise-stacks-${no}`);
          throw new Error(`moving seats out of the raise panel stacked ${stacked} pair(s) of seats`);
        }
        if (shotAt.has(-1)) {
          shotAt.delete(-1);
          await shot(page, 'raise-panel');
        }
        await page.locator('.preset').nth(2).click();
        await page.locator('.act.raise').click();
      } else if (
        !(await page.locator('.act.fold.soft').isVisible()) &&
        (r === 7 || (Number(((await page.locator('.act.call').textContent()) ?? '').replace(/\D/g, '')) > 100 && r % 3 !== 0))
      ) {
        // 要跟的多（5 个大盲以上）时多数弃牌：一直跟注 30 手会输光好几次，把钱包补空，后面就开不了桌
        await page.locator('.act.fold').click();
      } else {
        await page.locator('.act.call').click();
      }
      continue;
    }
    await page.waitForTimeout(120);
  }
}

async function desktop(browser: Browser, base: string): Promise<void> {
  const ctx = await newContext(browser, base, 'smoke-desk');
  await ctx.addInitScript(() => localStorage.setItem('texas.settings', JSON.stringify({ fast: true })));
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(`${base}/games/texas/`);
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor();
  const before = await balance(page);
  if (before !== 10_000) throw new Error(`new wallet should have 10,000, got ${before}`);
  await shot(page, 'lobby');
  await page.locator('.lobby .start').click();
  await page.locator('.dialog').waitFor({ timeout: 10_000 }).catch(async (e: unknown) => {
    await shot(page, 'debug-start');
    throw new Error(`no tips after start; note: ${await page.locator('.note').textContent()}; ${String(e)}`);
  });
  await shot(page, 'tips');
  // 先看完提示再发第一手
  await page.waitForTimeout(1_500);
  if ((await handText(page)) !== 0 || (await page.locator('.seat.me .card.up').count())) throw new Error('dealt before the tips were closed');
  await skipTips(page);
  await page.locator('.seat.me .card.up').first().waitFor();
  // 单机也有嘲讽面板（0.6.0）：点 1 号电脑的头像扔一个番茄，面板里点名发一句；屏蔽全桌、再全放开
  await page.locator('.seat[data-seat="1"] .avatar').click();
  await page.locator('.read-card .rc-icon').first().click();
  await page.locator('.arcade-fun > *').first().waitFor({ timeout: 5_000 });
  await page.locator('.fun-btn').click();
  await page.locator('.fp-say').first().click();
  await page.locator('.speech', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await shot(page, 'solo-fun');
  await page.locator('.fun-btn').click();
  await page.locator('.fp-mute-all', { hasText: '屏蔽全桌' }).click();
  await page.locator('.fp-mute-all', { hasText: '全部取消屏蔽' }).click();
  await page.locator('.fp-mute-all', { hasText: '屏蔽全桌' }).waitFor();
  await page.locator('.fun-btn').click();
  log('solo fun: prop, taunt, mute all');
  await playUntil(page, HANDS, new Set([1, 5, -1]), true);
  await shot(page, 'after-hands');
  // 补码：先歇一手，这一手打完牌桌停下，再补码、回来
  const rest = page.locator('.hud .pill', { hasText: '歇一手' });
  if (await rest.isVisible()) await rest.click();
  let busted = false;
  for (let i = 0; i < 200 && (await page.locator('.stage').getAttribute('data-phase')) !== 'idle'; i++) {
    // 这一手正好输光了：弹出"筹码输光了"，在里面补码
    if (await page.locator('.dialog').isVisible()) {
      log('dialog:', await page.locator('.d-title').textContent());
      await shot(page, 'topup');
      await page.locator('.d-btn.primary').click();
      busted = true;
      break;
    }
    if (await page.locator('.actions.on').isVisible()) await page.locator('.act.call').click();
    await page.waitForTimeout(200);
  }
  // 牌桌停下以后"筹码输光了"才弹出来（输光的那一手正好打完）：同样在里面补码
  await page.waitForTimeout(600);
  if (!busted && (await page.locator('.dialog').isVisible())) {
    log('dialog:', await page.locator('.d-title').textContent());
    await shot(page, 'topup');
    await page.locator('.d-btn.primary').click();
    busted = true;
  }
  const topUp = page.locator('.hud .pill', { hasText: '补码' });
  if (busted) {
    log('topped up (busted)');
  } else if (await topUp.isVisible()) {
    await topUp.click();
    await page.locator('.dialog').waitFor();
    await shot(page, 'topup');
    await page.locator('.d-btn.primary').click();
    log('topped up');
  } else if (await page.locator('.hud .pill', { hasText: '回来' }).isVisible()) {
    // 筹码是满的，不用补
    await page.locator('.hud .pill', { hasText: '回来' }).click();
  }
  await page.waitForTimeout(800);
  // 离桌：确认 → 结算页（带上桌、结回、这一场、打了几手）→ 回标题
  await page.locator('.leave').click();
  await page.locator('.dialog').waitFor();
  await page.locator('.d-btn.primary').click();
  const net = await summary(page, 'summary');
  await page.locator('.lobby').waitFor();
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor();
  await page.waitForTimeout(400);
  const after = await balance(page);
  log('wallet', before, '→', after, 'summary', net);
  // 结算页写的"这一场"就是钱包的变化（小桌到不了每日上限）
  if (!Number.isFinite(net) || after !== before + net) throw new Error(`wallet ${before} → ${after} but summary says ${net}`);
  await shot(page, 'lobby-after');
  // 娱乐：不碰钱包（平台那边没有德州的一份）；再在桌上点回大厅（确认后走）
  await page.locator('.lobby .mode', { hasText: '娱乐' }).click();
  await shot(page, 'lobby-fun');
  await page.locator('.lobby .start').click();
  await skipTips(page);
  await page.locator('.seat.me .card.up').first().waitFor();
  const stakes = await page.evaluate(async () => ((await (await fetch('/api/wallet')).json()) as { wallet: { stakes: unknown[] } }).wallet.stakes);
  if (stakes.length) throw new Error(`fun mode touched the wallet: ${JSON.stringify(stakes)}`);
  await page.locator('.home').click();
  await page.locator('.dialog').waitFor();
  await shot(page, 'home-confirm');
  await page.locator('.d-btn.primary').click();
  await page.locator('.summary').waitFor();
  await Promise.all([page.waitForURL((u) => u.pathname === '/'), page.locator('.d-btn.primary').click()]);
  log('back to lobby ok');
  await ctx.close();
}

/** 一场打完的结算页：只有一个"回标题"，不放"再来一场"。回这一场的输赢 */
async function summary(page: Page, name: string): Promise<number> {
  await page.locator('.summary').waitFor({ timeout: 20_000 });
  const text = (await page.locator('.dialog').textContent()) ?? '';
  for (const w of ['带上桌', '这一场']) if (!text.includes(w)) throw new Error(`summary lacks ${w}: ${text}`);
  const buttons = await page.locator('.dialog .d-btn').allTextContents();
  if (buttons.join() !== '回标题') throw new Error(`summary buttons: ${buttons.join()}`);
  const net = ((await page.locator('.sum-v').nth(2).textContent()) ?? '').replace(/,/g, '');
  await shot(page, name);
  await page.locator('.d-btn.primary').click();
  return net.startsWith('±') ? 0 : Number(net.replace('−', '-'));
}

async function mobile(browser: Browser, base: string): Promise<void> {
  const ctx = await newContext(browser, base, 'smoke-phone', {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  watch(page, 'mobile');
  // 省内存设备：CPU 降速 4 倍
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${base}/games/texas/`);
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor();
  await shot(page, 'phone-lobby');
  await page.locator('.lobby .start').tap();
  await skipTips(page);
  await page.locator('.seat.me .card.up').first().waitFor();
  await playUntil(page, 3, new Set([2]));
  await shot(page, 'phone-table');
  // 双指放大：visualViewport.scale 变成 2 时舞台不能跟着重排（CDP 设页面缩放 = 手指捏开的结果），缩回 1 倍后照常
  const stageStyle = () => page.locator('.stage').evaluate((e) => (e as HTMLElement).style.cssText);
  const before = await stageStyle();
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(600);
  const zoomed = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await shot(page, 'phone-pinch');
  if (zoomed < 1.5) throw new Error(`page did not zoom (scale ${zoomed})`);
  if ((await stageStyle()) !== before) throw new Error('stage relaid out while zoomed');
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(600);
  log('pinch scale', zoomed, 'stage kept');
  // 竖屏（0.10.0）：换竖的牌桌，座位、操作区都在舞台里、互不压
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  if (!(await page.locator('.stage.tall').count())) throw new Error('portrait layout not used');
  const out = await page.evaluate(() => {
    const st = document.querySelector('.stage')!.getBoundingClientRect();
    return [...document.querySelectorAll('.seat:not(.empty) .plate, .act, .qbet')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.left < st.left - 1 || r.right > st.right + 1 || r.top < st.top - 1 || r.bottom > st.bottom + 1);
    }).length;
  });
  if (out) throw new Error(`portrait: ${out} element(s) outside the stage`);
  if (await seatOverlaps(page)) throw new Error('portrait: seats overlap');
  await shot(page, 'phone-portrait');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await page.locator('.leave').tap();
  await page.locator('.d-btn.primary').tap();
  await summary(page, 'phone-summary');
  await page.locator('.lobby').waitFor();
  await ctx.close();
}

const PHONE = {
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const handNo = async (page: Page): Promise<number> =>
  (await page.locator('.stage').evaluate((e) => e.classList.contains('at-table')))
    ? Number(((await page.locator('.hand-no').textContent()) ?? '').replace(/\D/g, '')) || 0
    : 0;

/** 好友房两手之间停了多久（看到倒计时 → 下一手发出来），按页面记 */
const roomPauses: Record<string, number[]> = {};

/** 好友房里自动打到第 n 手：轮到就跟注过牌（偶尔弃牌），输光了补码；两手之间看到倒计时就量一下停了多久 */
async function playRoom(page: Page, hands: number, tag: string, shotAt: Set<number> = new Set()): Promise<void> {
  let k = 0;
  let paused: { no: number; at: number } | null = null;
  const deadline = Date.now() + hands * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`[${tag}] room playing took too long`);
    const no = await handNo(page);
    if (paused && no > paused.no) {
      (roomPauses[tag] ??= []).push(Date.now() - paused.at);
      paused = null;
    }
    if (no > hands) return;
    if (!paused && (await page.locator('.room-pause').isVisible())) {
      if (await page.locator('.next-hand').isVisible()) throw new Error(`[${tag}] room shows "下一手"`);
      if (!(roomPauses[tag]?.length)) await shot(page, `room-${tag}-pause`);
      paused = { no, at: Date.now() };
    }
    if (await page.locator('.dialog').isVisible()) {
      log(tag, 'dialog:', await page.locator('.d-title').textContent());
      await page.locator('.d-btn.primary').click();
      continue;
    }
    // 0.3.0 起桌上不满一份就能补：按钮常亮着，只在输光了才补（像真人一样），按钮刚好收起了就不等
    const topUp = page.locator('.hud .pill', { hasText: '补码' });
    if ((await topUp.isVisible()) && (await page.locator('.seat.me .stack').textContent())?.trim() === '0') {
      await topUp.click({ timeout: 2_000 }).catch(() => {});
      continue;
    }
    if (await page.locator('.actions.on').isVisible()) {
      if (shotAt.has(no)) {
        shotAt.delete(no);
        await shot(page, `room-${tag}-${no}`);
      }
      if (k++ % 9 === 4 && !(await page.locator('.act.fold.soft').isVisible())) await page.locator('.act.fold').click();
      else await page.locator('.act.call').click();
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(150);
  }
}

/** 钱包里那一桌好友房结回来了（大厅不再提示"好友房里还有一桌"） */
async function settled(page: Page, tag: string): Promise<number> {
  for (let i = 0; i < 60; i++) {
    await page.goto(page.url().split('?')[0]!);
    await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor();
    await page.waitForTimeout(300);
    const note = (await page.locator('.note').isVisible()) ? await page.locator('.note').textContent() : '';
    if (!note?.includes('好友房里还有一桌')) return balance(page);
    await page.waitForTimeout(2_000);
  }
  throw new Error(`[${tag}] room seat never settled back to the wallet`);
}

/**
 * 好友房：三个人（两台电脑、一部手机）进同一个房间打 N 手；中途手机刷新（断线重连回到座位），
 * 后来的第四个人看着、接管电脑的座位；最后都离开，筹码结回钱包。
 */
async function room(browser: Browser, base: string): Promise<void> {
  const pages: [Page, string][] = [];
  try {
    await roomFlow(browser, base, pages);
  } catch (e) {
    // 出错时四个人各拍一张，看卡在哪
    for (const [p, tag] of pages) await shot(p, `debug-room-${tag}`).catch(() => {});
    throw e;
  }
}

async function roomFlow(browser: Browser, base: string, pages: [Page, string][]): Promise<void> {
  const hands = Math.min(HANDS, 10);
  const host = await newContext(browser, base, 'smoke-host');
  const a = await newContext(browser, base, 'smoke-a');
  const b = await newContext(browser, base, 'smoke-b', PHONE);
  const d = await newContext(browser, base, 'smoke-d');
  const [hp, ap, bp, dp] = await Promise.all([host.newPage(), a.newPage(), b.newPage(), d.newPage()]);
  pages.push([hp, 'host'], [ap, 'a'], [bp, 'phone'], [dp, 'late']);
  watch(hp, 'room-host');
  watch(ap, 'room-a');
  watch(bp, 'room-phone');
  watch(dp, 'room-d');
  // 房主从平台大厅的"好友房"按钮进来（?online=1）：参数读完就去掉，好友房那一行亮起来、光标在房间码里
  await hp.goto(`${base}/games/texas/?online=1`);
  await hp.locator('.friends.spot').waitFor();
  if (new URL(hp.url()).search !== '') throw new Error(`?online=1 not stripped: ${hp.url()}`);
  if (!(await hp.locator('.code-in').evaluate((e) => e === document.activeElement))) throw new Error('?online=1 should focus the room code');
  await shot(hp, 'online-entry');
  for (const p of [hp, ap, bp, dp]) {
    if (p !== hp) await p.goto(`${base}/games/texas/`);
    await p.locator('.w-balance').filter({ hasText: /\d/ }).waitFor();
  }

  // 房主选 4 人桌开房：自己坐 1 号
  await hp.locator('.size', { hasText: /^4$/ }).click();
  await hp.locator('.friends .pill', { hasText: '开房间' }).click();
  await hp.locator('.room-wait').waitFor();
  await hp.locator('.rw-seat.me').waitFor();
  const code = ((await hp.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw new Error(`bad room code ${code}`);
  log('room', code);

  // 一个点邀请链接进来，一个（手机）在大厅输码
  await ap.goto(`${base}/games/texas/?room=${code}`);
  await ap.locator('.room-wait').waitFor();
  if (new URL(ap.url()).search) throw new Error('invite link query not stripped');
  await bp.locator('.code-in').fill(code);
  await bp.locator('.friends .pill', { hasText: '进房间' }).tap();
  await bp.locator('.room-wait').waitFor();
  await ap.locator('.rw-seat').nth(1).locator('.rw-sit').click();
  await ap.locator('.rw-seat.me').waitFor();
  await bp.locator('.rw-seat').nth(2).locator('.rw-sit').tap();
  await bp.locator('.rw-seat.me').waitFor();
  // 输码进来的也知道档位和人数（开房时定的）：要带多少写着，用不到的座位不显示
  if (!((await bp.locator('.rw-info').textContent()) ?? '').includes('2,000')) throw new Error('room info should show the buy-in');
  if ((await bp.locator('.rw-seat:not(.hidden)').count()) !== 4) throw new Error('only the 4 seats in use should show');
  await hp.locator('.rw-seat.taken').nth(2).waitFor();
  await shot(hp, 'room-wait-host');
  await shot(bp, 'room-wait-phone');
  // 坐着的人都有"开打"（0.3.5）：不是房主的点了，房间回 not_host，冒一句，还在等
  await ap.locator('.rw-go .start').click();
  await ap.locator('.toast.on', { hasText: '只有开房的人能开打' }).waitFor({ timeout: 5_000 });
  if (!(await ap.locator('.rw-seat.me').isVisible())) throw new Error('guest should still be waiting after not_host');

  await hp.locator('.rw-go .start').click();
  for (const p of [hp, ap, bp]) await p.locator('.seat.me .card.up').first().waitFor({ timeout: 20_000 });
  log('room started');

  // 好友房的乐子（0.3.0）：房主点手机的头像扔一个番茄，1 号从面板发一句嘲讽；手机上看得到道具飞过来、嘲讽的气泡，两边截图
  await hp.locator('.seat[data-seat="2"] .avatar').click();
  await hp.locator('.read-card .rc-icon').first().click();
  await bp.locator('.arcade-fun > *').first().waitFor({ timeout: 5_000 });
  await shot(bp, 'fun-prop-phone');
  await ap.locator('.fun-btn').click();
  await ap.locator('.fp-say').first().click();
  await bp.locator('.speech', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await hp.locator('.speech', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await shot(bp, 'fun-taunt-phone');
  await shot(hp, 'fun-taunt-host');
  log('fun: prop and taunt seen on the other screens');

  // 打到一半手机刷新：不自动进房（0.2.3），标题页有"回到房间"，点了回到原来的座位
  // 带着房间记录启动页面不能报错（0.3.7：原来先画大厅、后建云存档，这里一刷新就是 pageerror、大厅画不出来；结尾的零报错核对会抓到）
  const half = Math.max(2, Math.floor(hands / 2));
  const phone = (async () => {
    await playRoom(bp, half - 1, 'phone', new Set([1]));
    await bp.reload();
    await bp.locator('.banner.room .go', { hasText: code }).waitFor();
    if (await bp.locator('.in-room').count()) throw new Error('reload should not drop the phone back into the room');
    await shot(bp, 'room-reload-lobby');
    await bp.locator('.banner.room .go').tap();
    await bp.locator('.seat.me .card.up').first().waitFor({ timeout: 30_000 });
    log('phone rejoined at hand', await handNo(bp));
    await playRoom(bp, hands, 'phone', new Set([half + 1]));
  })();
  // 第四个人后来进房（第 3 手起）：看着，点亮着的电脑座位（4 号）接管
  const late = (async () => {
    while ((await handNo(hp)) < 3) await hp.waitForTimeout(500);
    await dp.goto(`${base}/games/texas/?room=${code}`);
    await dp.locator('.seat.takeable .avatar').first().waitFor({ timeout: 30_000 });
    await shot(dp, 'room-spectate');
    await dp.locator('.seat.takeable .avatar').first().click();
    await dp.locator('.dialog').waitFor();
    await dp.locator('.d-btn.primary').click();
    await dp.locator('.seat.me .card.up').first().waitFor({ timeout: 120_000 });
    log('late player took a seat at hand', await handNo(dp));
    await playRoom(dp, hands, 'late', new Set([(await handNo(dp)) + 1]));
  })();
  await Promise.all([phone, late, playRoom(hp, hands, 'host', new Set([4])), playRoom(ap, hands, 'a', new Set([3]))]);
  await shot(hp, 'room-after');
  // 两手之间房间停着（HAND_PAUSE_MS），大家看同一个倒计时：看到倒计时以后至少过了几秒才发
  for (const tag of ['host', 'a']) {
    const ms = roomPauses[tag] ?? [];
    log(tag, 'room pauses (ms)', ms.join(', '));
    if (!ms.length) throw new Error(`[${tag}] never saw the pause between hands`);
    if (Math.max(...ms) < 3_000) throw new Error(`[${tag}] pause between hands too short: ${ms.join(', ')}`);
  }

  // 都离开：这一手弃牌，打完筹码结回钱包；房主最后走，房间关掉
  for (const [p, tag] of [[bp, 'phone'], [ap, 'a'], [dp, 'late'], [hp, 'host']] as const) {
    await p.locator('.leave').click();
    await p.locator('.dialog').waitFor();
    if (tag === 'phone') await shot(p, 'room-leave-confirm');
    await p.locator('.d-btn.primary').click();
    // 坐着离开的：每个人这一场的输赢
    await p.locator('.summary').waitFor({ timeout: 5_000 });
    if (tag === 'phone') await shot(p, 'room-summary');
    await p.locator('.d-btn.primary').click();
    await p.locator('.lobby').waitFor();
    log(tag, 'left, wallet', await settled(p, tag));
  }
  // 都离开了：房间没有真人就结束（0.2.4），标题页不给"回到房间"；房主再点"开房间"开出一个新的，不会 409、不会回到原来的房间
  if (await hp.locator('.banner.room').isVisible()) throw new Error('left the room: no "back to room" banner');
  await hp.locator('.friends .pill', { hasText: '开房间' }).click();
  await hp.locator('.room-wait').waitFor({ timeout: 20_000 });
  const code2 = ((await hp.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  if (code2 === code || !/^\d{6}$/.test(code2)) throw new Error(`open again: expected a new room, got ${code2}`);
  if (allowed409['room-host']) throw new Error('open again: no 409 expected');
  log('open again: new room', code2);
  await Promise.all([host.close(), a.close(), b.close(), d.close()]);
}

/** 起一个 wrangler dev，跑完关掉、删掉它的本地存储 */
async function withWorker(config: string[], run: (base: string) => Promise<void>): Promise<void> {
  const port = await freePort();
  const state = mkdtempSync(join(tmpdir(), 'texas-smoke-'));
  const worker = await startWorker(port, state, config);
  try {
    await run(`http://localhost:${port}`);
  } finally {
    if (worker.pid) process.kill(-worker.pid, 'SIGTERM');
    rmSync(state, { recursive: true, force: true });
  }
}

/** 单独部署：见文件头 */
async function standalone(browser: Browser, base: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('texas.settings')) localStorage.setItem('texas.settings', JSON.stringify({ fast: true, nick: '小明' }));
  });
  const page = await ctx.newPage();
  watch(page, 'alone');
  await page.goto(`${base}/`);
  if (new URL(page.url()).pathname !== '/games/texas/') throw new Error(`standalone: / should go to /games/texas/, got ${page.url()}`);
  await page.locator('.nick-row').waitFor();
  for (const sel of ['.lobby .wallet', '.lobby .mode', '.topbar .cloud']) if (await page.locator(sel).first().isVisible()) throw new Error(`standalone: ${sel} should be hidden`);
  const home = await page.locator('.home').evaluate((a) => (a as HTMLAnchorElement).href);
  if (home !== `${base}/games/texas/`) throw new Error(`standalone: "大厅" should go to the game, got ${home}`);
  if (!(await page.locator('.friends .pill', { hasText: '开房间' }).isEnabled())) throw new Error('standalone: 开房间 should work without a wallet');
  await shot(page, 'alone-lobby');

  // 单机：只有娱乐
  await page.locator('.tile', { hasText: '小桌' }).click();
  await page.locator('.size', { hasText: /^4$/ }).click();
  await page.locator('.lobby .start').click();
  await skipTips(page);
  await playUntil(page, 2, new Set()).catch(async (e: unknown) => {
    await shot(page, 'debug-alone-solo');
    throw e;
  });
  await shot(page, 'alone-solo');
  await page.locator('.leave').click();
  if (await page.locator('.dialog').isVisible({ timeout: 2_000 }).catch(() => false)) await page.locator('.d-btn.primary').click();
  await summary(page, 'alone-solo-summary');

  // 好友房：房主带昵称"小明"开房，手机点邀请链接进来（没填昵称，是"游客1234"）
  await page.locator('.size', { hasText: /^4$/ }).click();
  await page.locator('.friends .pill', { hasText: '开房间' }).click();
  await page.locator('.rw-seat.me').waitFor({ timeout: 20_000 });
  const code = ((await page.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  const phone = await browser.newContext(PHONE);
  const pp = await phone.newPage();
  watch(pp, 'alone-phone');
  await pp.goto(`${base}/games/texas/?room=${code}`);
  await pp.locator('.room-wait').waitFor();
  await pp.locator('.rw-seat').nth(1).locator('.rw-sit').tap();
  await pp.locator('.rw-seat.me').waitFor();
  await page.locator('.rw-seat.taken').nth(1).waitFor();
  const names = (await page.locator('.rw-name').allTextContents()).join('|');
  if (!names.includes('小明') || !/游客\d{4}/.test(names)) throw new Error(`standalone room names: ${names}`);
  if (!((await pp.locator('.rw-info').textContent()) ?? '').includes('筹码不算数')) throw new Error('standalone room info should say chips do not count');
  await shot(page, 'alone-room-wait');
  await page.locator('.rw-go .start').click();
  await Promise.all([playRoom(page, 2, 'alone-host', new Set([2])), playRoom(pp, 2, 'alone-phone')]);
  for (const p of [pp, page]) {
    await p.locator('.leave').click();
    if (await p.locator('.dialog').isVisible({ timeout: 2_000 }).catch(() => false)) await p.locator('.d-btn.primary').click();
    await p.locator('.lobby').waitFor();
  }
  log('standalone: solo, guest room ok');
  await Promise.all([ctx.close(), phone.close()]);
}

async function main(): Promise<void> {
  // 有的沙箱环境里 zygote 拉不起 GPU 子进程，浏览器会直接退出；不用 zygote 就好（CI 上加不加都一样）
  const browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
  try {
    const only = opt('only', '');
    if (only !== 'standalone')
      await withWorker(PLATFORM_CONFIG, async (base) => {
        if (!only || only === 'desktop') await desktop(browser, base);
        if (!only || only === 'mobile') await mobile(browser, base);
        if (!only || only === 'room') await room(browser, base);
      });
    if (!only || only === 'standalone') await withWorker(STANDALONE_CONFIG, (base) => standalone(browser, base));
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    throw new Error(`${errors.length} console errors`);
  }
  log(`ok, screenshots in ${SHOTS}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
