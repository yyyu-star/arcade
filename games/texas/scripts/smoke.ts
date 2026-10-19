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
 * 快速匹配（--only match，0.20.0）：两个人点小桌的"快速匹配"，等满 15 秒排到同一张 6 人桌（没有房间码、叫人），关了陌生人聊天的那个连接不带 chat=1，
 * 打两手、离开结回钱包；娱乐档两人排到娱乐桌打一手、钱包不动（0.21.0）；排队时点"取消"回选桌；只有一个人排时转成同一档的单机。
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
/** 电脑的窗口大小（art v3：改前改后在 1280、1920 各截一套），--desk 1920x1080 */
const [DESK_W, DESK_H] = opt('desk', '1280x720').split('x').map(Number) as [number, number];
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
  // 报位置、收邀请、叫人、报名场面（kit 的 social，docs/social.md 1.2、1.3，平台 15.17）：位置、名场面收下，邀请一条都没有，好友一个、叫他就成
  await ctx.route(/\/api\/(presence|invites|friends|feed)/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/games/')) return route.continue();
    if (path === '/api/friends') return route.fulfill({ json: { friends: [{ userId: 'u-pal', displayName: '老王', online: true }] } });
    if (req.method() === 'GET') return route.fulfill({ json: { invites: [] } });
    return path === '/api/invites' ? route.fulfill({ json: { id: 'inv-1' } }) : route.fulfill({ status: 204 });
  });
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
  const ctx = await browser.newContext({ viewport: { width: DESK_W, height: DESK_H }, ...device });
  await cspWatch(ctx);
  // 平台的两个 cookie（__Host- 的不能带 Domain；CDP 这里要写 domain，浏览器照样当 host-only，localhost 算安全来源）
  const host = new URL(base).hostname;
  await ctx.addCookies([
    { name: '__Host-sid', value: userId, domain: host, path: '/', secure: true },
    { name: '__Host-arcade_li', value: '1', domain: host, path: '/', secure: true },
  ]);
  await fakePlatform(ctx, userId);
  return ctx;
}

/** 页面的 CSP（0.17.1）：违规（拦了的、只报不拦的）都在控制台记一条错误，冒烟按零报错查 */
async function cspWatch(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) => console.error(`csp ${e.disposition}: ${e.effectiveDirective} ${e.blockedURI}`)),
  );
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
    // 0.18.3 起连动作签一起算：挪开的座位的签原来压在上一家的名牌上
    const boxes = [...document.querySelectorAll('.seat:not(.empty)')].map((seat) =>
      [...seat.querySelectorAll(seat.classList.contains('tucked') ? '.plate' : '.avatar, .plate, .bubble.on')].map((e) => e.getBoundingClientRect()),
    );
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (boxes[i]!.some((a) => boxes[j]!.some((b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom))) n++;
    return n;
  });

/** 单机亮过牌没有（一场只试一次） */
let soloShowed = false;

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
      // 主动亮牌（0.19.0，单机）：第一次有亮牌那一块就点"都亮"，我的两张翻开、那一块收起
      if (checks && !soloShowed && (await page.locator('.show-cards').isVisible())) {
        soloShowed = true;
        await page.locator('.show-cards .sc-both').click();
        await page.waitForFunction(() => document.querySelectorAll('.seat.me .card.up').length === 2, null, { timeout: 5_000 });
        if (await page.locator('.show-cards').isVisible()) throw new Error('solo show: bar should hide after showing both');
        await shot(page, 'solo-show');
        log('solo: showed both cards at hand', no);
      }
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
        // 0.18.2：面板矮了一行，电脑上 6 人桌右下角的座位不用再挤成只剩名牌
        if ((page.viewportSize()?.width ?? 0) >= 1280 && (await page.locator('.seat:not(.empty)').count()) === 6 && (await page.locator('.seat.tucked').count())) {
          await shot(page, `raise-tucked-${no}`);
          throw new Error('raise panel still tucks a seat at a 6-seat desktop table');
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

/** 0.18.0 起标题页先是主页：在主页就点模式卡，已经在选桌就点上面的玩法按钮 */
async function enter(page: Page, mode: '娱乐' | '实盘' | '好友房', tap = false): Promise<void> {
  const id = { 娱乐: 'fun', 实盘: 'real', 好友房: 'room' }[mode];
  const card = page.locator(`.mcard[data-mode="${id}"]`);
  const target = (await card.isVisible()) ? card : page.locator('.lobby .mode', { hasText: mode });
  await (tap ? target.tap() : target.click());
}

async function desktop(browser: Browser, base: string): Promise<void> {
  const ctx = await newContext(browser, base, 'smoke-desk');
  await ctx.addInitScript(() => localStorage.setItem('texas.settings', JSON.stringify({ fast: true })));
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(`${base}/games/texas/`);
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  const before = await balance(page);
  if (before !== 10_000) throw new Error(`new wallet should have 10,000, got ${before}`);
  // 0.18.0：一进来是主页，不摆选项（所有者："一进去就直接选游戏方式"）；快速开始第一次是娱乐·新手·6 人，背景是分层的
  if ((await page.locator('.tile:visible').count()) !== 0) throw new Error('home should not show the stakes cards');
  const quick = (await page.locator('.qstart').textContent()) ?? '';
  if (!quick.includes('快速开始') || !quick.includes('娱乐 · 新手 · 6 人')) throw new Error(`first visit quick start: ${quick}`);
  if ((await page.locator('.scene .sc-bokeh i').count()) < 8) throw new Error('layered background missing');
  await shot(page, 'home');
  // 选桌：娱乐默认新手，三张难度卡；切到实盘才是四张档位卡
  await enter(page, '娱乐');
  if ((await page.locator('.tile.diff:visible').count()) !== 3 || (await page.locator('.tile.diff.sel', { hasText: '新手' }).count()) !== 1)
    throw new Error('first visit should default to 娱乐 · 新手 with three difficulty cards');
  await shot(page, 'lobby');
  await page.locator('.p-back').click();
  await enter(page, '实盘');
  if ((await page.locator('.tile:not(.diff):visible').count()) !== 4) throw new Error('real mode should show four stakes cards');
  await shot(page, 'lobby-real');
  // 主题房（0.18.1）：选中哪一档，背景和舞台就换成那一间；选回小桌回到默认
  await page.locator('.tile', { hasText: '黑金' }).click();
  if ((await page.locator('.stage[data-room="lux"]').count()) !== 1 || (await page.locator('.scene[data-room="lux"]').count()) !== 1) throw new Error('picking 豪华桌 should switch to the 黑金 room');
  await shot(page, 'lobby-lux');
  await page.locator('.tile', { hasText: '街角牌室' }).click();
  if ((await page.locator('[data-room]').count()) !== 3) throw new Error('back to 小桌: only the three other stakes cards keep data-room');
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
  // 荷官（0.18.3）：电脑上 6 人桌站在桌子顶边
  if ((await page.locator('.dealer-guy:not(.hidden)').count()) !== 1) throw new Error('desktop 6-seat table should show the dealer');
  // 互动（docs/table-fun.md，0.13.0 起是 kit 的 TableFun）：点 1 号电脑的头像扔一个道具，点自己的头像发一个表情；
  // "互动"面板里发一句；全部屏蔽、再全部恢复；点名牌看对手
  await page.locator('.atf-hot[data-seat="1"]').click();
  await page.locator('.atf-box [data-key="fun:prop0"]').click();
  await page.locator('.arcade-fun > *').first().waitFor({ timeout: 5_000 });
  const meSeat = await page.locator('.seat.me').getAttribute('data-seat');
  await page.locator(`.atf-hot[data-seat="${meSeat}"]`).click();
  await page.locator('.atf-box [data-key="fun:sticker0"]').click();
  await page.locator('.atf-box').waitFor({ state: 'detached' });
  await shot(page, 'solo-fun-sticker');
  // 表情和短语共用 1 秒冷却
  await page.waitForTimeout(1_100);
  await page.locator('.atf-btn').click();
  await page.locator('.atf-box [data-key="fun:phrase0"]').click();
  await page.locator('.atf-bubble', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await shot(page, 'solo-fun');
  await page.locator('.atf-btn').click();
  await page.locator('.atf-box [data-key="fun:blockAll"]', { hasText: '全部屏蔽' }).click();
  await page.locator('.atf-btn').click();
  await page.locator('.atf-box [data-key="fun:blockAll"]', { hasText: '全部恢复' }).click();
  // 电脑版聊天框（kit 0.19，0.19.4）：放得下就常驻、不压下注按钮；1280×720 的 6 人桌放不下，第一次进桌收成"聊天"小按钮
  const dock = page.locator('[data-key="chat:dock"], [data-key="chat:open"]').first();
  await dock.waitFor({ timeout: 5_000 });
  const db = (await dock.boundingBox())!;
  if (db.x + db.width > DESK_W / 2 && db.y + db.height > DESK_H * 0.7) throw new Error(`desktop chat dock sits on the bet buttons ${JSON.stringify(db)}`);
  // 单机聊天（0.19.3，kit 的 localChat）：顶栏有聊天开关，聊天页说一句，冒在我自己头上；链接不让发
  if (!(await page.locator('.chat-toggle').isVisible())) throw new Error('solo: chat toggle should show');
  await page.locator('.atf-btn').click();
  await page.locator('.atf-box [data-key="fun:tab:chat"]').click();
  await page.locator('[data-key="fun:chatInput"]').fill('这把稳了');
  await page.locator('[data-key="fun:chatSend"]').click();
  await page.locator('.atf-say', { hasText: '这把稳了' }).waitFor({ timeout: 5_000 });
  await shot(page, 'solo-chat');
  await page.locator('[data-key="fun:chatInput"]').fill('看 example.com');
  await page.locator('[data-key="fun:chatSend"]').click();
  await page.locator('.atf-note', { hasText: '链接' }).waitFor({ timeout: 5_000 });
  await page.locator('.atf-away').dispatchEvent('pointerdown');
  await page.locator('.seat[data-seat="1"] .plate').click();
  await page.locator('.read-card .rc-tag').waitFor({ timeout: 5_000 });
  log('solo fun: prop, own sticker, phrase, block all, read card');
  await playUntil(page, HANDS, new Set([1, 5, -1]), true);
  if (!soloShowed) throw new Error('solo: never got the show-cards bar');
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
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  await page.waitForTimeout(400);
  const after = await balance(page);
  log('wallet', before, '→', after, 'summary', net);
  // 结算页写的"这一场"就是钱包的变化（小桌到不了每日上限）
  if (!Number.isFinite(net) || after !== before + net) throw new Error(`wallet ${before} → ${after} but summary says ${net}`);
  // 离桌回来是主页，快速开始记着上次的实盘
  if (!((await page.locator('.qstart').textContent()) ?? '').includes('实盘')) throw new Error('quick start should remember 实盘');
  await shot(page, 'lobby-after');
  // 娱乐：不碰钱包（平台那边没有德州的一份）；再在桌上点回大厅（确认后走）
  await enter(page, '娱乐');
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
  if ((await page.locator('.sum-hero').count()) !== 1) throw new Error('summary should lead with the big +/− line');
  const buttons = await page.locator('.dialog .d-btn').allTextContents();
  if (buttons.join() !== '回标题') throw new Error(`summary buttons: ${buttons.join()}`);
  // 0.18.4 起这一场的 +/− 是最上面的大字
  const net = ((await page.locator('.sum-hero .sum-net').textContent()) ?? '').replace(/,/g, '');
  await shot(page, name);
  // 分享卡（docs/social.md 1.1，kit 的 share）：无头浏览器不能带文件分享，出预览层；看一眼再关，结算页还在
  if (await page.locator('.sum-share').isVisible()) {
    await page.locator('.sum-share').click();
    await page.locator('[data-key="share:close"]').waitFor({ timeout: 10_000 });
    await shot(page, `${name}-share`);
    await page.locator('[data-key="share:close"]').click();
    await page.locator('.summary').waitFor();
  }
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
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  await shot(page, 'phone-lobby');
  // 快速开始：第一次来是娱乐·新手·6 人
  await page.locator('.qstart').tap();
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
/** 房主亮过牌没有（一场只试一次） */
let roomShowed = false;

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
    // 主动亮牌（0.19.0）：房主第一次看到亮牌那一块就亮一张，自己座位上那张翻过来（经房间转一圈回来的视图）
    if (tag === 'host' && !roomShowed && (await page.locator('.show-cards').isVisible())) {
      roomShowed = true;
      await page.locator('.show-cards .sc-card').first().click();
      await page.locator('.seat.me .card.up').first().waitFor({ timeout: 5_000 });
      await shot(page, 'room-show');
      log('host showed a card at hand', no);
    }
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
    await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
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
  if (!(await hp.locator('.code-in:not(.nick-in)').evaluate((e) => e === document.activeElement))) throw new Error('?online=1 should focus the room code');
  await shot(hp, 'online-entry');
  for (const p of [hp, ap, bp, dp]) {
    if (p !== hp) await p.goto(`${base}/games/texas/`);
    await p.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  }

  // 房主选 4 人桌开房：自己坐 1 号
  await hp.locator('.size', { hasText: /^4$/ }).click();
  await hp.locator('.friends .pill', { hasText: '开房间' }).click();
  await hp.locator('.room-wait').waitFor();
  await hp.locator('.rw-seat.me').waitFor();
  const code = ((await hp.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw new Error(`bad room code ${code}`);
  log('room', code);
  // 叫朋友来（kit 的面板）：好友列出来、叫一下变"已叫"，关掉
  await hp.locator('.rw-invite').click();
  const call = hp.locator('[data-key="invite:call:u-pal"]');
  await call.waitFor();
  await call.click();
  await hp.waitForFunction(() => (document.querySelector('[data-key="invite:call:u-pal"]') as HTMLButtonElement | null)?.disabled === true);
  await shot(hp, 'room-invite');
  await hp.locator('[data-key="invite:close"]').click();
  await hp.locator('#arcade-invite-panel').waitFor({ state: 'detached' });

  // 一个点邀请链接进来，一个（手机）在大厅输码
  await ap.goto(`${base}/games/texas/?room=${code}`);
  await ap.locator('.room-wait').waitFor();
  if (new URL(ap.url()).search) throw new Error('invite link query not stripped');
  // 好友房卡在主页第一屏（0.17.4 起第一屏就看得见，0.18.0 换成模式卡），点了才出开房、输码
  const tab = await bp.locator('.mcard[data-mode="room"]').boundingBox();
  if (!tab || tab.y + tab.height > PHONE.viewport.height) throw new Error(`phone: 好友房 should be on the first screen, got ${JSON.stringify(tab)}`);
  if (await bp.locator('.friends.join').isVisible()) throw new Error('phone: friends row should wait for the 好友房 card');
  await enter(bp, '好友房', true);
  await shot(bp, 'phone-friends-tab');
  await bp.locator('.code-in:not(.nick-in)').fill(code);
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
  // 等人页画成桌子（0.18.4）：竖屏也得把椅子都放在桌子那块里、不压到下面的按钮
  await bp.setViewportSize({ width: 390, height: 844 });
  await bp.waitForTimeout(400);
  await shot(bp, 'room-wait-portrait');
  const box = await bp.locator('.rw-seats').boundingBox();
  const go = await bp.locator('.rw-go').boundingBox();
  for (const s of await bp.locator('.rw-seat:not(.hidden)').all()) {
    const r = await s.boundingBox();
    if (!box || !go || !r || r.x < 0 || r.x + r.width > 390 || r.y + r.height > go.y) throw new Error(`portrait waiting room: seat out of place ${JSON.stringify(r)}`);
  }
  await bp.setViewportSize(PHONE.viewport);
  // 坐着的人都有"开打"（0.3.5）：不是房主的点了，房间回 not_host，冒一句，还在等
  await ap.locator('.rw-go .start').click();
  await ap.locator('.toast.on', { hasText: '只有开房的人能开打' }).waitFor({ timeout: 5_000 });
  if (!(await ap.locator('.rw-seat.me').isVisible())) throw new Error('guest should still be waiting after not_host');

  await hp.locator('.rw-go .start').click();
  for (const p of [hp, ap, bp]) await p.locator('.seat.me .card.up').first().waitFor({ timeout: 20_000 });
  log('room started');

  // 好友房的乐子（0.3.0）：房主点手机的头像扔一个番茄，1 号从面板发一句嘲讽；手机上看得到道具飞过来、嘲讽的气泡，两边截图
  await hp.locator('.atf-hot[data-seat="2"]').click();
  await hp.locator('.atf-box [data-key="fun:prop0"]').click();
  await bp.locator('.arcade-fun > *').first().waitFor({ timeout: 5_000 });
  await shot(bp, 'fun-prop-phone');
  await ap.locator('.atf-btn').click();
  await ap.locator('.atf-box [data-key="fun:phrase0"]').click();
  await bp.locator('.atf-bubble', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await hp.locator('.atf-bubble', { hasText: '就这？' }).waitFor({ timeout: 5_000 });
  await shot(bp, 'fun-taunt-phone');
  await shot(hp, 'fun-taunt-host');
  log('fun: prop and taunt seen on the other screens');
  // 好友房聊天（0.19.0，kit 0.18）：1 号从互动面板的聊天页说一句，房主和手机上都冒气泡；顶栏有聊天开关
  if (!(await hp.locator('.chat-toggle').isVisible())) throw new Error('room: chat toggle should show');
  await ap.locator('.atf-btn').click();
  await ap.locator('.atf-box [data-key="fun:tab:chat"]').click();
  await ap.locator('[data-key="fun:chatInput"]').fill('这把我跟到底');
  await ap.locator('[data-key="fun:chatSend"]').click();
  for (const p of [hp, bp]) await p.locator('.atf-say', { hasText: '这把我跟到底' }).waitFor({ timeout: 5_000 });
  await shot(hp, 'chat-host');
  await ap.locator('.atf-away').dispatchEvent('pointerdown');
  // kit 0.19 的聊天（0.19.4）：手机竖屏"聊天"按钮挨着"互动"，不压任何座位的头像和名牌
  await bp.setViewportSize({ width: 390, height: 844 });
  await bp.waitForTimeout(500);
  const cb = await bp.locator('[data-key="chat:button"]').boundingBox();
  if (!cb) throw new Error('portrait: no chat button');
  for (const e of await bp.locator('.seat:not(.empty) :is(.avatar, .plate)').all()) {
    const r = await e.boundingBox();
    if (r && r.x < cb.x + cb.width && cb.x < r.x + r.width && r.y < cb.y + cb.height && cb.y < r.y + r.height) throw new Error(`portrait: chat button covers a seat ${JSON.stringify(r)}`);
  }
  await shot(bp, 'chat-phone-portrait');
  await bp.setViewportSize(PHONE.viewport);
  // 房主把弹幕关了：1 号再说一句，房主那边只冒气泡、不飘弹幕（电脑版聊天框收起时先点开）
  if (await hp.locator('[data-key="chat:open"]').isVisible()) await hp.locator('[data-key="chat:open"]').click();
  await hp.locator('[data-key="chat:danmaku"]').click();
  await ap.waitForTimeout(3_100);
  await ap.locator('.atf-btn').click();
  await ap.locator('.atf-box [data-key="fun:tab:chat"]').click();
  await ap.locator('[data-key="fun:chatInput"]').fill('弹幕关了也看得到');
  await ap.locator('[data-key="fun:chatSend"]').click();
  await hp.locator('.atf-say', { hasText: '弹幕关了也看得到' }).waitFor({ timeout: 5_000 });
  if (await hp.locator('.atc-dms', { hasText: '弹幕关了也看得到' }).count()) throw new Error('host turned danmaku off but still sees it');
  await shot(hp, 'chat-host-danmaku-off');
  await ap.locator('.atf-away').dispatchEvent('pointerdown');
  log('chat: seen on the other screens, portrait button clear, danmaku off works');

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
    // 旁观（docs/social.md 1.4）：顶上写旁观中、有"坐下"、看不到任何人的底牌、不能扔东西（没有互动按钮）
    await dp.locator('.where.watching', { hasText: '旁观中' }).waitFor({ timeout: 10_000 });
    await dp.locator('.hud .pill', { hasText: /^坐下$/ }).waitFor();
    // 一手打完摊牌亮出来的是公开的，下一手发牌前才收；所以连着看两眼都在打牌、都有亮着的底牌才算看到了不该看的
    const leaked = async (): Promise<boolean> => (await dp.locator('.stage').getAttribute('data-phase')) !== 'idle' && (await dp.locator('.seat .card.up').count()) > 0;
    if ((await leaked()) && (await dp.waitForTimeout(2_000), await leaked())) throw new Error('spectator sees face-up hole cards during a hand');
    if (await dp.locator('.atf-btn').isVisible()) throw new Error('spectator should not get the fun button');
    await dp.locator('.seat.takeable .avatar').first().click();
    await dp.locator('.dialog').waitFor();
    await dp.locator('.d-btn.primary').click();
    await dp.locator('.seat.me .card.up').first().waitFor({ timeout: 120_000 });
    log('late player took a seat at hand', await handNo(dp));
    await playRoom(dp, hands, 'late', new Set([(await handNo(dp)) + 1]));
  })();
  await Promise.all([phone, late, playRoom(hp, hands, 'host', new Set([4])), playRoom(ap, hands, 'a', new Set([3]))]);
  await shot(hp, 'room-after');
  if (!roomShowed) throw new Error('host never got the show-cards bar');
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
    // 颁奖（0.15.0）：打了好几手，真人里总有人输赢（电脑不进这张表，可能全是输的），至少一个奖；第一个走的点一下分享，卡能出来
    if ((await p.locator('.sum-award').count()) < 1) throw new Error(`[${tag}] room summary: expected awards`);
    if (tag === 'phone') {
      await p.locator('.sum-share').tap();
      await p.locator('[data-key="share:close"]').waitFor();
      await shot(p, 'room-share');
      await p.locator('[data-key="share:close"]').tap();
    }
    await p.locator('.d-btn.primary').click();
    await p.locator('.lobby').waitFor();
    log(tag, 'left, wallet', await settled(p, tag));
  }
  // 都离开了：房间没有真人就结束（0.2.4），标题页不给"回到房间"；房主再点"开房间"开出一个新的，不会 409、不会回到原来的房间
  if (await hp.locator('.banner.room').isVisible()) throw new Error('left the room: no "back to room" banner');
  await enter(hp, '好友房');
  await hp.locator('.friends .pill', { hasText: '开房间' }).click();
  await hp.locator('.room-wait').waitFor({ timeout: 20_000 });
  const code2 = ((await hp.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  if (code2 === code || !/^\d{6}$/.test(code2)) throw new Error(`open again: expected a new room, got ${code2}`);
  if (allowed409['room-host']) throw new Error('open again: no 409 expected');
  log('open again: new room', code2);
  await Promise.all([host.close(), a.close(), b.close(), d.close()]);
}

/** 快速匹配：见文件头 */
async function match(browser: Browser, base: string): Promise<void> {
  const one = await newContext(browser, base, 'smoke-m1');
  const two = await newContext(browser, base, 'smoke-m2');
  // 第二个人关了陌生人聊天（顶栏聊天开关的中间一档）
  await two.addInitScript(() => localStorage.setItem('texas.settings', JSON.stringify({ fast: true, strangerChat: false })));
  await one.addInitScript(() => localStorage.setItem('texas.settings', JSON.stringify({ fast: true })));
  const [p1, p2] = await Promise.all([one.newPage(), two.newPage()]);
  const sockets = new Map<Page, string[]>([[p1, []], [p2, []]]);
  for (const [p, tag] of [[p1, 'm1'], [p2, 'm2']] as const) {
    watch(p, `match-${tag}`);
    p.on('websocket', (ws) => sockets.get(p)!.push(ws.url()));
    await p.goto(`${base}/games/texas/`);
    await p.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
    await enter(p, '实盘');
    await p.locator('.lobby .pill.match').waitFor();
  }
  // 取消：卡片关掉，还在选桌
  await p1.locator('.lobby .pill.match').click();
  // 等连上排队（卡上有"已有 n 人"）再点：连接还没建好就关，浏览器会记一条 WebSocket 警告
  await p1.locator('.match-card .mc-wait', { hasText: '已有' }).waitFor({ timeout: 10_000 });
  await p1.locator('.d-btn.primary', { hasText: '取消' }).click();
  await p1.locator('.match-card').waitFor({ state: 'detached' });
  await p1.waitForTimeout(1_500);
  if (await p1.locator('.stage.at-table').count()) throw new Error('match: cancel should stay in the lobby');

  const before = await balance(p1);
  await Promise.all([p1, p2].map((p) => p.locator('.lobby .pill.match').click()));
  await p1.locator('.match-card .mc-wait', { hasText: '已有 2/6 人' }).waitFor({ timeout: 10_000 });
  await shot(p1, 'match-waiting');
  // 排队等满 15 秒，人齐（排进来的两个都进了房间）自动开打
  for (const p of [p1, p2]) await p.locator('.stage.in-room.at-table').waitFor({ timeout: 45_000 });
  for (const [p, tag] of [[p1, 'm1'], [p2, 'm2']] as const) {
    if (await p.locator('.invite-btn').isVisible()) throw new Error(`[${tag}] match table: no invite button`);
    const where = (await p.locator('.topbar .where').textContent()) ?? '';
    if (!where.startsWith('快速匹配') || /\d{6}/.test(where)) throw new Error(`[${tag}] match table title: ${where}`);
  }
  const roomWs = (p: Page): string => sockets.get(p)!.find((u) => /\/rooms\/\d{6}/.test(u)) ?? '';
  if (!roomWs(p1).includes('chat=1')) throw new Error(`match: chat on should connect with chat=1: ${roomWs(p1)}`);
  if (!roomWs(p2) || roomWs(p2).includes('chat=1')) throw new Error(`match: stranger chat off should connect without chat=1: ${roomWs(p2)}`);
  // 1280×720 的 6 人桌放不下聊天框：第一次进桌（座位都坐上人以后才判断）先收成"聊天"小按钮
  if (DESK_W <= 1280) await p1.locator('.atc-pill').waitFor({ timeout: 15_000 });
  // 1920 放得下：聊天框展开着（kit 0.20.1 的 chatFolded 曾让 1920 也默认收起，0.20.2 修了）
  if (DESK_W >= 1600) {
    await p1.waitForTimeout(1_500);
    if (!(await p1.locator('[data-key="chat:dock"]').isVisible())) throw new Error('match table at 1920: chat dock should be open');
  }
  await shot(p1, 'match-table');
  await Promise.all([playRoom(p1, 2, 'm1'), playRoom(p2, 2, 'm2')]);
  for (const [p, tag] of [[p2, 'm2'], [p1, 'm1']] as const) {
    await p.locator('.leave').click();
    await p.locator('.dialog').waitFor();
    await p.locator('.d-btn.primary').click();
    await p.locator('.summary').waitFor({ timeout: 5_000 });
    await p.locator('.d-btn.primary').click();
    await p.locator('.lobby').waitFor();
    log(tag, 'left the match table, wallet', await settled(p, tag));
  }
  log('match wallet', before, '->', await balance(p1));

  // 娱乐档（0.21.0）：两个人排到同一张娱乐桌，标题写"娱乐"，打一手离开，钱包一分不动
  const funBefore = await Promise.all([p1, p2].map((p) => balance(p)));
  for (const p of [p1, p2]) await enter(p, '娱乐');
  await Promise.all([p1, p2].map((p) => p.locator('.lobby .pill.match').click()));
  if (!((await p1.locator('.match-card .mc-tier').textContent()) ?? '').startsWith('娱乐')) throw new Error('fun match card should say 娱乐');
  for (const p of [p1, p2]) await p.locator('.stage.in-room.at-table').waitFor({ timeout: 45_000 });
  if (!((await p1.locator('.topbar .where').textContent()) ?? '').includes('娱乐')) throw new Error('fun match table title should say 娱乐');
  await shot(p1, 'match-fun');
  await Promise.all([playRoom(p1, 1, 'f1'), playRoom(p2, 1, 'f2')]);
  for (const p of [p2, p1]) {
    await p.locator('.leave').click();
    await p.locator('.dialog').waitFor();
    if ((await p.locator('.d-body').textContent())?.includes('钱包')) throw new Error('fun room leave should not mention the wallet');
    await p.locator('.d-btn.primary').click();
    await p.locator('.summary').waitFor({ timeout: 5_000 });
    await p.locator('.d-btn.primary').click();
    await p.locator('.lobby').waitFor();
  }
  const funAfter = await Promise.all([p1, p2].map((p) => settled(p, 'fun')));
  if (funAfter.join() !== funBefore.join()) throw new Error(`fun match should not touch the wallet: ${funBefore} -> ${funAfter}`);

  // 只有一个人排：15 秒后说一句，转成同一档的单机
  await enter(p1, '实盘');
  await p1.locator('.lobby .pill.match').click();
  await p1.locator('.stage.at-table').waitFor({ timeout: 45_000 });
  const said = await p1.evaluate(() => (window as { __said?: string[] }).__said ?? []);
  if (!said.some((t) => t.includes('现在没人在排'))) throw new Error(`match alone: expected the solo note, said ${said.join(' | ')}`);
  if (await p1.locator('.stage.in-room').count()) throw new Error('match alone: should be a solo table');
  await skipTips(p1);
  await shot(p1, 'match-solo');
  await Promise.all([one.close(), two.close()]);
}

/**
 * 竖屏打磨（--only tall，0.21.3）：五档竖屏（SE 375×667、安卓 360×780、390×844、414×896、430×932）各截单机 6 人桌、打开聊天条、发一句冒气泡、点头像出互动菜单；
 * SE 再截一张好友房（两个人坐下开打，顶上那一排不换行）。看谁压了谁用，控制台零报错照样算
 */
const TALL: [string, number, number][] = [
  ['se', 375, 667],
  ['360', 360, 780],
  ['390', 390, 844],
  ['414', 414, 896],
  ['430', 430, 932],
];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const tallDevice = (width: number, height: number) => ({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });

async function tall(browser: Browser, base: string): Promise<void> {
  for (const [tag, width, height] of TALL) {
    const ctx = await newContext(browser, base, `smoke-tall-${tag}`, tallDevice(width, height));
    await ctx.addInitScript(() => localStorage.setItem('texas.settings', JSON.stringify({ fast: true })));
    const page = await ctx.newPage();
    watch(page, `tall-${tag}`);
    await page.goto(`${base}/games/texas/`);
    await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
    await page.locator('.qstart').tap();
    await skipTips(page);
    if (!(await page.locator('.stage.tall').count())) throw new Error(`${tag}: portrait layout not used`);
    // 轮到我、操作按钮亮着的时候截：手牌、公共牌、按钮都在
    await page.locator('.actions.on').waitFor({ timeout: 60_000 });
    await shot(page, `tall-${tag}-table`);
    // 跟到翻牌：公共牌摆出来再截一张（看公共牌有没有被筹码、座位挡住）
    for (let i = 0; i < 300 && (await page.locator('.card.board.up').count()) < 3; i++) {
      if (await page.locator('.actions.on').isVisible()) await page.locator('.act.call').tap().catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.locator('.actions.on').waitFor({ timeout: 30_000 }).catch(() => {});
    await shot(page, `tall-${tag}-board`);
    await page.locator('[data-key="chat:button"]').tap();
    await page.locator('.atc-input').waitFor();
    await shot(page, `tall-${tag}-chat`);
    await page.locator('.atc-input').fill('这把我跟了');
    await page.locator('.atc-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('[data-key="chat:close"]').tap().catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, `tall-${tag}-bubble`);
    // 头像上盖着 kit 的热区（atf-hot），点一下是扔道具
    await page.locator('.atf-hot[data-seat="2"]').tap();
    await page.waitForTimeout(400);
    await shot(page, `tall-${tag}-throw`);
    // 加注面板展开（竖屏操作区最高的时候）：不压我的名牌和底牌
    if (await page.locator('.actions.on .act.raise').isVisible()) {
      await page.locator('.act.raise').evaluate((e) => (e as HTMLElement).click());
      await page.waitForTimeout(400);
      await shot(page, `tall-${tag}-raise`);
      const [plate, panel] = await Promise.all([page.locator('.seat.me .plate').boundingBox(), page.locator('.raise-panel').boundingBox()]);
      if (plate && panel && panel.height > 0 && panel.y < plate.y + plate.height) throw new Error(`${tag}: raise panel covers my plate`);
    }
    // 互动面板（左上"互动"按钮），最后截：面板开着会挡住别的点击
    await page.locator('.atf-ui .atf-btn:not([data-key])').evaluate((e) => (e as HTMLElement).click());
    await page.waitForTimeout(400);
    await shot(page, `tall-${tag}-menu`);
    await ctx.close();
  }
  // 好友房：最窄的 SE 上的房主开 6 人房（顶上那一排最挤：互动、聊天、第几手、歇一手、叫朋友来），电脑上的朋友进来坐下，开打
  const host = await newContext(browser, base, 'smoke-tall-host', tallDevice(375, 667));
  const pal = await newContext(browser, base, 'smoke-tall-pal');
  const [hp, pp] = await Promise.all([host.newPage(), pal.newPage()]);
  watch(hp, 'tall-room-host');
  watch(pp, 'tall-room-pal');
  for (const p of [hp, pp]) {
    await p.goto(`${base}/games/texas/`);
    await p.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  }
  await enter(hp, '好友房', true);
  await hp.locator('.friends .pill', { hasText: '开房间' }).tap();
  await hp.locator('.rw-seat.me').waitFor();
  const code = ((await hp.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  await pp.goto(`${base}/games/texas/?room=${code}`);
  await pp.locator('.rw-seat').nth(1).locator('.rw-sit').click();
  await pp.locator('.rw-seat.me').waitFor();
  await hp.locator('.rw-go .start').tap();
  await hp.locator('.stage.at-table').waitFor({ timeout: 30_000 });
  await hp.locator('.seat.me .card.up').first().waitFor({ timeout: 30_000 });
  await skipTips(hp);
  await shot(hp, 'tall-se-room');
  // 换行了的话第二行的中线比第一行低一大截
  const mids = await hp.locator('.hud > :not(.hidden)').evaluateAll((es) =>
    es.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.top + r.height / 2),
  );
  if (Math.max(...mids) - Math.min(...mids) > 30) throw new Error(`tall room: the top row wrapped ${mids.map(Math.round).join(',')}`);
  await Promise.all([host.close(), pal.close()]);
}

/**
 * 止盈（--only tp，0.22.0）：实盘小桌把止盈设成"赢 1"，一直跟注，赢到的那一手打完就自动离桌：
 * 不问"离桌吗"、出结算页、钱包比坐下前多。大厅"带上桌"下面那一行显示同一个设置
 */
async function takeProfitFlow(browser: Browser, base: string): Promise<void> {
  const ctx = await newContext(browser, base, 'smoke-tp');
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('texas.settings')) localStorage.setItem('texas.settings', JSON.stringify({ fast: true, takeProfit: { kind: 'amount', amount: 1 } }));
  });
  const page = await ctx.newPage();
  watch(page, 'tp');
  const toasts: string[] = [];
  await page.goto(`${base}/games/texas/`);
  await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
  const before = await balance(page);
  await enter(page, '实盘');
  const row = ((await page.locator('.lobby .tp-pick-btn').textContent()) ?? '').replace(/\s/g, '');
  if (!row.includes('赢1')) throw new Error(`lobby take-profit button: ${row}`);
  // 选桌多了止盈按钮也要整个放得下（1280×720 的"坐下开打"不出屏）
  const go = await page.locator('.lobby .start').boundingBox();
  if (!go || go.y + go.height > DESK_H) throw new Error(`lobby: 坐下开打 off screen ${JSON.stringify(go)}`);
  await shot(page, 'tp-lobby');
  await page.locator('.lobby .start').click();
  await skipTips(page);
  const deadline = Date.now() + 420_000;
  while (!(await page.locator('.summary').isVisible())) {
    if (Date.now() > deadline) {
      await shot(page, 'debug-tp');
      throw new Error('take profit never fired');
    }
    // 止盈自动走不问"离桌吗"；别的框（补码、输光了）点主按钮接着打
    if (await page.locator('.d-title', { hasText: '离桌' }).isVisible()) throw new Error('take profit should not ask before leaving');
    if (await page.locator('.dialog').isVisible()) {
      await page.locator('.d-btn.primary').click().catch(() => {});
      continue;
    }
    if (await page.locator('.actions.on').isVisible()) await page.locator('.act.call').click().catch(() => {});
    // 顶上那条提示是同一个元素换字，边打边记
    const t = (await page.locator('.toast').first().textContent()) ?? '';
    if (t.includes('止盈了')) toasts.push(t);
    await page.waitForTimeout(150);
  }
  await shot(page, 'tp-summary');
  // 提示是同一个元素，淡出后字还在
  toasts.push((await page.locator('.toast').first().textContent()) ?? '');
  if (!toasts.some((t) => t.includes('止盈了 +'))) throw new Error(`take profit toast missing: ${toasts.join(' | ')}`);
  await page.locator('.d-btn.primary').click();
  await page.locator('.lobby').waitFor();
  const after = await settled(page, 'tp');
  if (after <= before) throw new Error(`take profit: wallet should grow, ${before} -> ${after}`);
  log('take profit', before, '->', after, toasts[0]);
  await ctx.close();
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
  const ctx = await browser.newContext({ viewport: { width: DESK_W, height: DESK_H } });
  await cspWatch(ctx);
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('texas.settings')) localStorage.setItem('texas.settings', JSON.stringify({ fast: true, nick: '小明' }));
  });
  const page = await ctx.newPage();
  watch(page, 'alone');
  await page.goto(`${base}/`);
  if (new URL(page.url()).pathname !== '/games/texas/') throw new Error(`standalone: / should go to /games/texas/, got ${page.url()}`);
  await page.locator('.mcard[data-mode="room"]').waitFor();
  for (const sel of ['.lobby .wallet', '.lobby .disclaimer', '.topbar .cloud']) if (await page.locator(sel).first().isVisible()) throw new Error(`standalone: ${sel} should be hidden`);
  if (await page.locator('.mcard[data-mode="real"]').isVisible()) throw new Error('standalone: 实盘 should be hidden');
  await shot(page, 'alone-home');
  // 好友房：昵称框和开房间在这一栏里
  await enter(page, '好友房');
  if (await page.locator('.lobby .mode', { hasText: '实盘' }).isVisible()) throw new Error('standalone: 实盘 should be hidden');
  await page.locator('.nick-row').waitFor();
  const home = await page.locator('.home').evaluate((a) => (a as HTMLAnchorElement).href);
  if (home !== `${base}/games/texas/`) throw new Error(`standalone: "大厅" should go to the game, got ${home}`);
  if (!(await page.locator('.friends .pill', { hasText: '开房间' }).isEnabled())) throw new Error('standalone: 开房间 should work without a wallet');
  await shot(page, 'alone-lobby');

  // 单机：只有娱乐
  await enter(page, '娱乐');
  await page.locator('.tile', { hasText: '新手' }).click();
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
  await enter(page, '好友房');
  await page.locator('.size', { hasText: /^4$/ }).click();
  await page.locator('.friends .pill', { hasText: '开房间' }).click();
  await page.locator('.rw-seat.me').waitFor({ timeout: 20_000 });
  const code = ((await page.locator('.rw-code').textContent()) ?? '').replace(/\D/g, '');
  const phone = await browser.newContext(PHONE);
  await cspWatch(phone);
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

/**
 * 竖着拿的手机看标题页（0.17.4，所有者：手机上找不到好友房）：iPhone SE 和常见的 390 宽，快速开始和"好友房"卡在第一屏，
 * 点了以后输码进房那一行也在第一屏（开房间在选完档位的下面，和"坐下开打"一个位置）
 */
async function portraitLobby(browser: Browser, base: string): Promise<void> {
  // 0.18.0 加上手机横屏和电脑：主页的快速开始、三张模式卡都在第一屏（手机横屏的标题页最挤）
  for (const [tag, width, height, phone] of [
    ['se', 375, 667, true],
    ['portrait', 390, 844, true],
    ['landscape', 844, 390, true],
    ['desk', DESK_W, DESK_H, false],
  ] as const) {
    const ctx = await newContext(browser, base, `smoke-${tag}`, { viewport: { width, height }, ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage();
    watch(page, tag);
    await page.goto(`${base}/games/texas/`);
    await page.locator('.w-balance').filter({ hasText: /\d/ }).waitFor({ state: 'attached' });
    const onScreen = async (sel: string, what: string): Promise<void> => {
      const b = await page.locator(sel).first().boundingBox();
      if (!b || b.y < 0 || b.y + b.height > height) {
        await shot(page, `debug-${tag}`);
        throw new Error(`${tag}: ${what} should be on the first screen, got ${JSON.stringify(b)}`);
      }
    };
    await onScreen('.qstart', '快速开始');
    for (const m of ['fun', 'real', 'room']) await onScreen(`.mcard[data-mode="${m}"]`, `mode card ${m}`);
    await onScreen('.mystats', 'stats');
    await shot(page, `${tag}-lobby`);
    await enter(page, '好友房', phone);
    await onScreen('.friends.join .code-in', 'room code');
    if (!(await page.locator('.friends.open .pill', { hasText: '开房间' }).isVisible())) throw new Error(`${tag}: 开房间 missing`);
    await shot(page, `${tag}-friends`);
    // 快速匹配（0.20.0）挨着"坐下开打"，最窄的屏也整个看得见
    await enter(page, '实盘', phone);
    const m = await page.locator('.lobby .pill.match').boundingBox();
    if (!m || m.x < 0 || m.x + m.width > width) throw new Error(`${tag}: 快速匹配 should fit the width, got ${JSON.stringify(m)}`);
    await shot(page, `${tag}-real`);
    await ctx.close();
  }
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
        if (!only || only === 'mobile' || only === 'portrait') await portraitLobby(browser, base);
        if (!only || only === 'room') await room(browser, base);
        if (!only || only === 'match') await match(browser, base);
        if (only === 'tall') await tall(browser, base);
        if (only === 'tp') await takeProfitFlow(browser, base);
      });
    if (!only || only === 'standalone') await withWorker(STANDALONE_CONFIG, (base) => standalone(browser, base));
  } catch (e) {
    // 半路失败时也把攒下的控制台错误打出来：卡住的原因常在这里（比如 CSP 拦了什么）
    if (errors.length) console.error(errors.join('\n'));
    throw e;
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
