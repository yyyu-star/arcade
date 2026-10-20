/**
 * 单机实盘冒烟（0.4.0，docs/stake.md 第 2 节）：本地联机栈（tools/online-dev.ts：真的掼蛋 Worker + 假平台的钱包 RPC），无头浏览器从标题页走：
 * ① "开始"先选娱乐 / 实盘，实盘选档位：钱包不够的档灰掉；
 * ② 进小档，第一副没打完就回标题：确认后原样退回，存档删掉；
 * ③ 再进一场，把存档换成"已经打了 7 副"的局（Node 里用规则核心推出来），回标题点"接着打实盘"，电脑代打完最后一副，
 *    结算页点"结算"，结回钱包（这个号今天已经赢满了，看到"到顶了"）；结算页"再来一场"直接开下一场；
 * ④ 打了几副后回标题选"现在结算"；再开一场打两副，点实盘条选"现在结算，回大厅"，结回后到大厅；
 * ⑤ 钱包说余额不够（no_funds）：进不了场、留在标题页；钱包里有一份不在本机的单机实盘：不挡开新的（平台 0.9.5 起能同时有好几份），给"原样退回那一份"。
 * ⑥ 好友房实盘（0.5.0，docs/stake.md 第 3 节）：开实盘房间选小档，大厅写着档位；一个人时开局灰掉；第二个人坐下后开局，两边都到账，
 *    电脑代打（autoplay）打完 5 副，结算页写"已经结回钱包"，两人的分正好相反。约几分钟；--no-room 跳过。
 * 控制台零报错。浏览器的 /api/me、/api/wallet 用 Playwright 拦下来答（本地栈的掼蛋 Worker 不管 /api）。
 *
 * ⑦ 斗地主好友房实盘（牌馆 ⑥）：--ddz-room 单独跑，从斗地主面板开实盘房间选小档，两个人 + 一个电脑代打打完一场，两人的分相加为 0、都结回；
 *    不带 --ddz-room 的完整跑也会在最后接上。
 *
 * 用法：node tools/stake-smoke.ts [--out <截图目录>] [--no-build] [--no-room] [--ddz-only] [--ddz-room]
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { decide } from '../src/variants/guandan/ai/index.ts';
import { createGame, dispatch, seatsToAct, viewFor, type GameState } from '../src/variants/guandan/core/index.ts';
import { soloAddDeal, soloOver, type SoloMatch } from '../src/variants/guandan/stake/index.ts';
import { startOnlineStack, type OnlineStack } from './online-dev.ts';

const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : `${process.cwd()}/shots/stake`;
})();

const errors: string[] = [];
const notes: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

interface Wallet {
  balance: number;
  stakes: { game: string; ref: string; tier: string; mode: string }[];
}

async function openPage(browser: Browser, stack: OnlineStack, user: string, wallet: Wallet, viewport = { width: 1280, height: 720 }, query = ''): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: '__Host-sid', value: user, domain: new URL(stack.origin).hostname, path: '/', secure: true }]);
  await context.route('**/api/me', (r) => r.fulfill({ json: { user: { id: user, displayName: `玩家${user}` } } }));
  await context.route('**/api/wallet', (r) => r.fulfill({ json: { wallet: { ...wallet, canRelief: false, writesLeft: 200, caps: {}, fresh: false }, tiers: {}, reliefTo: 2000 } }));
  // 社交（kit 的 mountSocial）登录后会报位置、问邀请；假平台照样答，不然控制台有 404
  await context.route('**/api/presence', (r) => r.fulfill({ status: 204 }));
  await context.route('**/api/invites', (r) => r.fulfill({ json: { invites: [] } }));
  await context.addInitScript(() => localStorage.setItem('guandan.tutorial', JSON.stringify({ v: 1, done: true })));
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${user}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${user}] pageerror: ${e.message}`));
  await page.goto(`${stack.origin}/games/guandan/?debug=1&anim=0${query}`);
  await page.waitForFunction(() => !!window.__game?.ready && window.__game.scene === 'title', null, { timeout: 60_000 });
  return page;
}

async function until(page: Page, what: string, fn: string, timeout = 30_000): Promise<void> {
  try {
    await page.waitForFunction(`(() => { const g = window.__game; return !!g && (${fn}); })()`, null, { timeout, polling: 100 });
  } catch {
    const now = await page.evaluate(() => ({ scene: window.__game?.scene, overlay: window.__game?.overlay, stake: window.__game?.stake(), controls: Object.keys(window.__game?.controls() ?? {}) })).catch(() => null);
    throw new Error(`${what}：等不到 ${fn}（现在 ${JSON.stringify(now)}）`);
  }
}

async function click(page: Page, key: string): Promise<void> {
  // 弹层有 200 毫秒的出场动画
  await page.waitForTimeout(250);
  const c = await page.evaluate((k) => window.__game!.controls()[k] ?? null, key);
  if (!c) throw new Error(`找不到控件 ${key}（现在有 ${await page.evaluate(() => Object.keys(window.__game!.controls()).join(','))}）`);
  await page.mouse.click(c.x, c.y);
}

async function shot(page: Page, file: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${file}.png` });
}

async function enterTier(page: Page, tier: string): Promise<string> {
  // 标题页的按钮有一段滑进来的动画
  await page.waitForTimeout(800);
  // 主页上直接点"实盘"模式卡（art-v3 起没有选模式那一层）
  await until(page, '主页', "'stake' in g.controls()");
  await click(page, 'stake');
  await until(page, '选档位', `'tier:${tier}' in g.controls()`);
  await click(page, `tier:${tier}`);
  await until(page, '进场', "g.scene === 'table' && !!g.stake()?.save");
  return (await page.evaluate(() => window.__game!.stake()!.save!.ref))!;
}

/** 规则核心推一局：电脑打到第 n 副结束（停在结算页，一场还没结束） */
function stateAfter(n: number): { state: GameState; deals: number } {
  for (let k = 0; k < 50; k++) {
    let s = createGame(`stake-smoke-${k}`).state;
    let m: SoloMatch = { tier: 'small', deals: [] };
    for (let guard = 0; guard < 50_000; guard++) {
      if (s.phase === 'gameOver') break;
      if (s.phase === 'dealEnd') {
        m = soloAddDeal(m, s.lastDeal!);
        if (soloOver(m)) break;
        if (m.deals.length === n) return { state: s, deals: n };
        s = dispatch(s, { type: 'nextDeal' }).state;
        continue;
      }
      const seat = seatsToAct(s)[0]!;
      s = dispatch(s, decide(viewFor(s, seat), { seed: `smoke|${seat}`, difficulty: 'easy' })!).state;
    }
  }
  throw new Error(`推不出打完 ${n} 副的局`);
}

/** 把本机实盘存档换成打了 n 副的局（ref、档位、到期时间不变），回标题 */
async function inject(page: Page, n: number, deals: number[]): Promise<void> {
  const { state } = stateAfter(n);
  await page.evaluate(
    ({ state, deals }) => {
      const s = JSON.parse(localStorage.getItem('guandan.stake')!);
      s.state = state;
      s.match = { tier: s.tier, deals };
      localStorage.setItem('guandan.stake', JSON.stringify(s));
      window.__game!.toTitle();
    },
    { state, deals },
  );
  await until(page, '回到标题页', "g.scene === 'title' && 'resumeStake' in g.controls()");
  await page.waitForTimeout(800);
}

/** ⑥ 好友房实盘：两个人 + 两个电脑，电脑代打打完一场 */
async function friendRoom(browser: Browser, stack: OnlineStack): Promise<void> {
  const wallet = { balance: 10_000, stakes: [] };
  const host = await openPage(browser, stack, 'room-a', wallet, undefined, '&online=1&autoplay=1');
  await host.waitForSelector('#ol-create-stake', { timeout: 30_000 });
  await host.click('#ol-create-stake');
  await host.waitForSelector('#ol-tier-small:not([disabled])', { timeout: 10_000 });
  await host.click('#ol-tier-small');
  await host.waitForSelector('#ol-room-code', { timeout: 30_000 });
  const code = (await host.textContent('#ol-room-code'))!.trim();
  await host.waitForSelector('#ol-stake', { timeout: 10_000 });
  assert((await host.textContent('#ol-stake'))!.includes('实盘 · 小档'), '大厅写着实盘的档位');
  await host.waitForSelector('#ol-start', { timeout: 10_000 });
  assert(await host.$eval('#ol-start', (b) => (b as HTMLButtonElement).disabled), '一个人时实盘房间开局灰掉');
  await shot(host, '60-room-alone');

  const guest = await openPage(browser, stack, 'room-b', wallet, undefined, '&online=1&autoplay=1');
  await guest.waitForSelector('#ol-code', { timeout: 30_000 });
  await guest.fill('#ol-code', code);
  await guest.click('#ol-join');
  await guest.waitForSelector('#ol-stake', { timeout: 30_000 });
  await guest.click('#ol-sit-1');
  await host.waitForFunction(() => !(document.getElementById('ol-start') as HTMLButtonElement | null)?.disabled, null, { timeout: 15_000 });
  await shot(host, '61-room-two');
  await host.click('#ol-start');
  for (const p of [host, guest]) await until(p, '两边都到账', "g.net()?.stake?.seats[0]?.paid === 'yes'", 60_000);
  await until(host, '牌桌上', "g.scene === 'table'", 30_000);
  await host.waitForTimeout(1500);
  await shot(host, '62-room-table');
  notes.push(`好友房实盘：开房选档，一个人时开局灰掉；两个人开局都到账（房间 ${code}）`);

  for (const p of [host, guest]) await until(p, '打完一场、结回', "g.overlay === 'stake' && g.net()?.stake?.over === true && g.net()?.stake?.seats[0]?.out === true", 900_000);
  await shot(host, '63-room-result');
  const pts = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.net()!.stake!.seats[0]!.points)));
  assert(pts[0]! + pts[1]! === 0, `0、1 号是对手，分正好相反：${pts}`);
  notes.push(`好友房实盘打完一场：两人 ${pts.join(' / ')} 分，结算页写"已经结回钱包"`);
}

/** ⑦ 斗地主好友房实盘：两个人 + 一个电脑，电脑代打打完一场 */
async function ddzFriendRoom(browser: Browser, stack: OnlineStack): Promise<void> {
  const wallet = { balance: 10_000, stakes: [] };
  const host = await openPage(browser, stack, 'droom-a', wallet, undefined, '&ddz=1&autoplay=1');
  await click(host, 'variant:ddz');
  await until(host, '斗地主面板', "'online' in g.controls()");
  await click(host, 'online');
  await host.waitForSelector('#ol-create-stake', { timeout: 30_000 });
  await host.click('#ol-create-stake');
  await host.waitForSelector('#ol-tier-small:not([disabled])', { timeout: 10_000 });
  await host.click('#ol-tier-small');
  await host.waitForSelector('#ol-room-code', { timeout: 30_000 });
  const code = (await host.textContent('#ol-room-code'))!.trim();
  await host.waitForSelector('#ol-stake', { timeout: 10_000 });
  assert((await host.textContent('#ol-stake'))!.includes('实盘 · 小档'), '大厅写着实盘的档位');
  assert((await host.textContent('#ol-stake'))!.includes('打 6 副'), '斗地主一场 6 副');
  await host.waitForSelector('#ol-start', { timeout: 10_000 });
  assert(await host.$eval('#ol-start', (b) => (b as HTMLButtonElement).disabled), '一个人时实盘房间开局灰掉');
  await shot(host, '80-ddz-room-alone');

  const guest = await openPage(browser, stack, 'droom-b', wallet, undefined, '&ddz=1&autoplay=1');
  await guest.waitForSelector('#ol-code', { timeout: 30_000 }).catch(async () => {
    await click(guest, 'variant:ddz');
    await until(guest, '斗地主面板', "'online' in g.controls()");
    await click(guest, 'online');
    await guest.waitForSelector('#ol-code', { timeout: 30_000 });
  });
  await guest.fill('#ol-code', code);
  await guest.click('#ol-join');
  await guest.waitForSelector('#ol-stake', { timeout: 30_000 });
  await guest.click('#ol-sit-1');
  await host.waitForFunction(() => !(document.getElementById('ol-start') as HTMLButtonElement | null)?.disabled, null, { timeout: 15_000 });
  await host.click('#ol-start');
  for (const p of [host, guest]) await until(p, '两边都到账', "g.net()?.stake?.seats[0]?.paid === 'yes'", 60_000);
  await until(host, '牌桌上', "g.scene === 'ddz'", 30_000);
  await host.waitForTimeout(1500);
  await shot(host, '81-ddz-room-table');
  notes.push(`斗地主好友房实盘：开房选档，一个人时开局灰掉；两个人开局都到账（房间 ${code}）`);
  for (const p of [host, guest]) await p.evaluate(() => window.__game!.setAutoplay(true));
  for (const p of [host, guest]) await until(p, '打完一场、结回', "g.overlay === 'gameOver' && g.net()?.stake?.over === true && g.net()?.stake?.seats[0]?.out === true", 900_000);
  await shot(host, '82-ddz-room-result');
  const pts = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__game!.net()!.stake!.seats[0]!.points)));
  const house = await host.evaluate(() => window.__game!.net()!.stake!.seats.map((s) => s.points));
  assert(Math.abs(pts[0]! + pts[1]!) <= 40, `两个真人的分合计不超过一份（电脑那家是对头）：${pts}`);
  assert(house.length === 3, '斗地主 3 个座位');
  notes.push(`斗地主好友房实盘打完一场：两人 ${pts.join(' / ')} 分，结算页写"已经结回钱包"`);
  await host.context().close();
  await guest.context().close();
}

/** 斗地主单机实盘（牌馆）：主页切到斗地主 → 实盘卡 → 小档进场 → 电脑代打到一场结束 → 结回钱包、存档删掉 */
async function ddzSolo(browser: Browser, stack: OnlineStack): Promise<void> {
  const page = await openPage(browser, stack, 'ddz-a', { balance: 10_000, stakes: [] }, undefined, '&ddz=1&autoplay=1');
  await click(page, 'variant:ddz');
  await until(page, '斗地主面板的实盘卡', "'stake' in g.controls() && 'daily' in g.controls()");
  await click(page, 'stake');
  await until(page, '选档位', "'tier:small' in g.controls()");
  await shot(page, '70-ddz-tiers');
  await click(page, 'tier:small');
  await until(page, '斗地主牌桌', "g.scene === 'ddz'");
  const ref = await page.evaluate(() => JSON.parse(localStorage.getItem('guandan.ddz.stake') ?? 'null')?.ref as string | undefined);
  assert(ref?.startsWith('solo-ddz-small-'), `斗地主实盘的 ref：${ref}`);
  // URL 的 autoplay 只管调试开局（?seed=），从主页进的实盘局在这里开代打
  await page.evaluate(() => window.__game!.setAutoplay(true));
  await until(page, '一场打完、结回', "g.overlay === 'gameOver' && g.texts().some((t) => t.s.includes('结回钱包'))", 240_000);
  await shot(page, '71-ddz-settled');
  assert((await page.evaluate(() => localStorage.getItem('guandan.ddz.stake'))) === null, '结回后删掉斗地主实盘存档');
  assert((await page.evaluate(() => localStorage.getItem('guandan.ddz.stats'))) === null, '实盘不记战绩');
  notes.push('斗地主单机实盘：小档进场、代打一场、结回钱包、存档删掉、不记战绩');
  await page.context().close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const stack = await startOnlineStack({ build: !process.argv.includes('--no-build') });
  console.log(`本地联机栈：${stack.origin}`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  try {
    if (process.argv.includes('--ddz-room')) await ddzFriendRoom(browser, stack);
    else if (process.argv.includes('--ddz-only')) await ddzSolo(browser, stack);
    else await guandanParts(browser, stack);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
    await stack.stop();
  }
  for (const n of notes) console.log(`· ${n}`);
  console.log(`截图 → ${OUT}`);
  if (errors.length) {
    console.log(`失败 ${errors.length} 项：`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    process.exitCode = 1;
  } else if (process.argv.includes('--ddz-room')) console.log('斗地主好友房实盘冒烟通过，控制台零报错');
  else if (process.argv.includes('--ddz-only')) console.log('斗地主实盘冒烟通过，控制台零报错');
  else console.log('实盘冒烟通过：选档、退回、接着打、结算、到顶、再来一场、现在结算、被拒，控制台零报错');
}

/** 掼蛋的各段，最后接斗地主单机和好友房实盘 */
async function guandanParts(browser: Browser, stack: OnlineStack): Promise<void> {
  {
    // ① 选模式、选档位：钱包 10,000，大档、豪华档灰掉
    // "capped" 开头的号：假钱包当它今天已经赢满了
    const page = await openPage(browser, stack, 'capped-main', { balance: 10_000, stakes: [] });
    await page.waitForTimeout(800);
    await until(page, '主页的模式卡', "'fun' in g.controls() && 'stake' in g.controls()");
    await shot(page, '10-mode');
    await click(page, 'stake');
    await until(page, '选档位', "'tier:small' in g.controls()");
    const ctl = await page.evaluate(() => Object.keys(window.__game!.controls()));
    assert(ctl.includes('tier:mid') && !ctl.includes('tier:big') && !ctl.includes('tier:lux'), `钱包 10,000：小、中能进，大、豪华灰掉（${ctl}）`);
    await shot(page, '11-tiers');
    notes.push('开始 → 娱乐 / 实盘 → 选档位：钱包不够的档灰掉');

    // ② 进小档，马上回标题：原样退回
    await click(page, 'tier:small');
    await until(page, '进场', "g.scene === 'table' && !!g.stake()?.save");
    const ref1 = await page.evaluate(() => window.__game!.stake()!.save!.ref);
    assert(/^solo-(small|mid|big|lux)-[0-9a-f]{32}$/.test(ref1), `ref 的样子：${ref1}`);
    await until(page, '牌发好', 'g.idle');
    await shot(page, '20-table');
    await click(page, 'top0');
    await until(page, '退回确认', "'ok' in g.controls()");
    await shot(page, '21-refund-ask');
    await click(page, 'ok');
    await until(page, '退回后回标题', "g.scene === 'title' && g.stake()?.save === null");
    assert(!(await page.evaluate(() => 'resumeStake' in window.__game!.controls())), '退回后标题页不该再有"接着打实盘"');
    notes.push('第一副没打完回标题：确认后原样退回，存档删掉');

    // ③ 再进一场，换成打了 7 副的局，接着打完最后一副、结算
    const ref2 = await enterTier(page, 'small');
    assert(ref2 !== ref1, '每场一个新 ref');
    await inject(page, 7, [3, 2, 1, 3, -1, 2, 1]);
    await shot(page, '30-title-resume');
    await click(page, 'resumeStake');
    await until(page, '接着打：第 7 副的结算页', "g.scene === 'table' && g.overlay === 'settle'");
    await shot(page, '31-deal7');
    await page.evaluate(() => window.__game!.setAutoplay(true));
    await until(page, '打完一场、结回', "g.overlay === 'stake' && g.stake()?.outcome !== null", 180_000);
    const out = await page.evaluate(() => window.__game!.stake());
    const o = out!.outcome as { kind: string; capped: number; credited: number };
    assert(o.kind === 'done', `结回：${JSON.stringify(o)}`);
    assert(o.capped > 0 && o.credited === 2000, `今天赢满了：只退回带入的 2,000，其余到顶（${JSON.stringify(o)}）`);
    assert(out!.save === null, '结回后存档删掉');
    await shot(page, '32-result');
    notes.push(`接着打实盘：第 8 副打完自动结算，结回 ${o.credited}、到顶 ${o.capped}，存档删掉`);

    // 结算页"再来一场"：还是小档
    await until(page, '"再来一场"可点', "g.controls().again?.enabled === true");
    await click(page, 'again');
    await until(page, '再来一场', "g.scene === 'table' && !!g.stake()?.save && g.overlay === null");
    const ref3 = await page.evaluate(() => window.__game!.stake()!.save!.ref);
    assert(ref3 !== ref2, '再来一场是新的 ref');
    notes.push('结算页"再来一场"：同一档直接开下一场');

    // ④ 打了 3 副后回标题："现在结算"
    await inject(page, 3, [2, -1, 1]);
    await click(page, 'resumeStake');
    await until(page, '接着打', "g.scene === 'table' && g.overlay === 'settle'");
    // 开第 4 副，打着打着回标题
    await click(page, 'next');
    await until(page, '第 4 副', "g.overlay === null && g.view().dealNo === 4");
    await click(page, 'top0');
    await until(page, '离开的两个选项', "'settleNow' in g.controls() && 'ok' in g.controls()");
    await shot(page, '40-leave-ask');
    await click(page, 'settleNow');
    await until(page, '现在结算', "g.overlay === 'stake' && g.stake()?.outcome !== null", 30_000);
    const o4 = (await page.evaluate(() => window.__game!.stake()!.outcome)) as { kind: string; points: number };
    assert(o4.kind === 'done' && o4.points === 2, `现在结算：按 +2 分结（${JSON.stringify(o4)}）`);
    await shot(page, '41-settle-now');
    await click(page, 'home');
    await until(page, '回标题', "g.scene === 'title'");
    notes.push('打了几副回标题："先存着 / 现在结算"，现在结算按目前的分结');

    // ④b 打了几副，点右上那条"实盘 · …"（和左上"大厅"同一个框，0.11.2）："现在结算，回大厅"写明结回多少，结回后去大厅
    await enterTier(page, 'small');
    await inject(page, 2, [3, 3]);
    await click(page, 'resumeStake');
    await until(page, '接着打（2 副）', "g.scene === 'table' && g.overlay === 'settle'");
    await click(page, 'next');
    await until(page, '第 3 副', "g.overlay === null && g.view().dealNo === 3 && g.idle");
    await click(page, 'stakeStrip');
    await until(page, '实盘条弹出结算框', "'settleNow' in g.controls() && 'ok' in g.controls()");
    await shot(page, '42-strip-settle-ask');
    // 大厅是平台的页面，这里没有平台：给个空页接住，免得 404 记成控制台报错
    await page.route((u) => u.pathname === '/', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>大厅</title>' }));
    const toLobby = page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
    await click(page, 'settleNow');
    await toLobby;
    notes.push('点实盘条：现在结算（写明结回多少）、先存着、接着打；现在结算结回后去大厅');

    // ⑤ 钱包说不够：进不了场（手机横屏的尺寸，顺便看选档页排得下）
    const poor = await openPage(browser, stack, 'nofunds-1', { balance: 10_000, stakes: [] }, { width: 844, height: 390 });
    await poor.waitForTimeout(800);
    await until(poor, '主页', "'stake' in g.controls()");
    await click(poor, 'stake');
    await until(poor, '选档位', "'tier:small' in g.controls()");
    await click(poor, 'tier:small');
    await poor.waitForTimeout(1500);
    assert((await poor.evaluate(() => window.__game!.scene)) === 'title' && (await poor.evaluate(() => window.__game!.stake()!.save)) === null, '钱包不够：留在标题页、没有存档');
    await shot(poor, '50-no-funds');
    notes.push('钱包回 no_funds：留在选档页，说清楚');

    // 钱包里有一份本机没有的单机实盘：照样能开新的，另给"原样退回那一份"
    const stray = await openPage(browser, stack, 'stray-1', { balance: 10_000, stakes: [{ game: 'guandan', ref: `solo-${'e'.repeat(32)}`, tier: 'small', mode: 'client' }] });
    await stray.waitForTimeout(800);
    await until(stray, '主页', "'stake' in g.controls()");
    await click(stray, 'stake');
    await until(stray, '原样退回那一份', "'stray' in g.controls()");
    assert(await stray.evaluate(() => Object.keys(window.__game!.controls()).includes('tier:small')), '有一份不在本机时照样能开新的');
    await shot(stray, '51-stray');
    notes.push('钱包里有一份不在本机的单机实盘：照样能开新的，也可以原样退回');

    await ddzSolo(browser, stack);
    if (!process.argv.includes('--no-room')) {
      await friendRoom(browser, stack);
      await ddzFriendRoom(browser, stack);
    }
  }
}

await main();
