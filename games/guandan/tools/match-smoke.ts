/**
 * 快速匹配冒烟（0.26.0，kit 0.20.0 的 MatchQueue / MatchClient）：本地联机栈（tools/online-dev.ts：真的掼蛋 Worker + 排队 + 房间 + 假平台）上开三个无头浏览器，
 * ① 两个人从选难度页点"快速匹配"排娱乐：排队卡写着人数和倒计时，15 秒到点两人排到同一桌，自动开打（没有房间码、没有"叫朋友来"、牌桌顶上没有邀请）；
 *    其中一人设置里"聊天"选了"不和陌生人"：他连匹配桌不带 chat=1、聊天页不给，另一人照常带；
 * ② 第三个人先排一次点"取消"（回到选档前的标题页），再在选档页切到"快速匹配"排实盘小档：只剩他一个，15 秒后说"现在没人在排"并转这一档的单机实盘（照常带入一份）。
 * 截图有不开代打的真实画面（排队卡、匹配桌开打）。控制台零报错。
 *
 * 用法：node tools/match-smoke.ts [--out <截图目录>] [--no-build]；环境变量 MATCH_DEBUG=1 打出每条 WebSocket 下行和页面控制台
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startOnlineStack, type OnlineStack } from './online-dev.ts';

const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : `${process.cwd()}/shots/match`;
})();

const errors: string[] = [];
const notes: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

interface Client {
  name: string;
  page: Page;
  /** 连过的 WebSocket 地址（看带没带 chat=1） */
  sockets: string[];
}

async function openClient(browser: Browser, stack: OnlineStack, name: string, user: string, viewport: { width: number; height: number }, storage: Record<string, string> = {}): Promise<Client> {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: '__Host-sid', value: user, domain: new URL(stack.origin).hostname, path: '/', secure: true }]);
  // 本地栈的掼蛋 Worker 不管 /api：页面问的"现在是谁"、钱包、社交都在这里答
  await context.route('**/api/me', (r) => r.fulfill({ json: { user: { id: user, displayName: `玩家${user}` } } }));
  await context.route('**/api/wallet', (r) => r.fulfill({ json: { wallet: { balance: 10_000, stakes: [], canRelief: false, writesLeft: 200, caps: {}, fresh: false }, tiers: {}, reliefTo: 2000 } }));
  await context.route('**/api/presence', (r) => r.fulfill({ status: 204 }));
  await context.route('**/api/invites', (r) => r.fulfill({ json: { invites: [] } }));
  // 排队卡说过的每句话记在 window.__said：转单机时卡片马上收起，失败现场要靠它看是哪种 solo（alone、unavailable……）
  await context.addInitScript(() => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    new MutationObserver(() => {
      const t = document.querySelector('#ol-match-wait')?.textContent;
      if (t && !/还剩/.test(t) && w.__said.at(-1) !== t) w.__said.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await context.addInitScript((kv) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, { 'guandan.tutorial': JSON.stringify({ v: 1, done: true }), ...storage });
  const page = await context.newPage();
  const c: Client = { name, page, sockets: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('websocket', (ws) => {
    c.sockets.push(ws.url());
    ws.on('framereceived', ({ payload }) => process.env.MATCH_DEBUG && console.log(`[${name}] ${ws.url().slice(-30)} <- ${String(payload).slice(0, 120)}`));
    ws.on('close', () => process.env.MATCH_DEBUG && console.log(`[${name}] ${ws.url().slice(-30)} closed`));
  });
  if (process.env.MATCH_DEBUG) page.on('console', (m) => console.log(`[${name}] console.${m.type()}: ${m.text()}`));
  await page.goto(`${stack.origin}/games/guandan/?debug=1&anim=0`, { timeout: 90_000 });
  await until(c, '标题页', "g.ready && g.scene === 'title'", 60_000);
  return c;
}

async function until(c: Client, what: string, cond: string, timeout = 30_000): Promise<void> {
  try {
    await c.page.waitForFunction(`(() => { const g = window.__game; return !!g && (${cond}); })()`, null, { timeout, polling: 100 });
  } catch {
    const now = await c.page
      .evaluate(() => ({
        scene: window.__game?.scene,
        net: window.__game?.net() ?? null,
        card: document.querySelector('#online')?.textContent?.slice(0, 160) ?? null,
        said: (window as unknown as { __said?: string[] }).__said ?? null,
      }))
      .catch(() => null);
    throw new Error(`[${c.name}] 等待超时：${what}（${JSON.stringify(now)}）`);
  }
}

async function click(c: Client, key: string): Promise<void> {
  // 弹层有 200 毫秒的出场动画
  await c.page.waitForTimeout(300);
  const p = await c.page.evaluate((k) => window.__game!.controls()[k] ?? null, key);
  if (!p) throw new Error(`[${c.name}] 找不到控件 ${key}（现在有 ${await c.page.evaluate(() => Object.keys(window.__game!.controls()).join(','))}）`);
  await c.page.mouse.click(p.x, p.y);
}

async function shot(c: Client, file: string): Promise<void> {
  await c.page.waitForTimeout(300);
  await c.page.screenshot({ path: `${OUT}/${file}.png` });
}

/** 标题页 → 娱乐 → 选难度页的"快速匹配" → 排队卡；pic：顺手截一张选难度页 */
async function queueFun(c: Client, pic = ''): Promise<void> {
  await c.page.waitForTimeout(800);
  await click(c, 'fun');
  await until(c, '选难度', "'match' in g.controls()");
  if (pic) await shot(c, pic);
  await click(c, 'match');
  await c.page.waitForSelector('#ol-match-wait', { timeout: 10_000 });
}

async function waitText(c: Client, sel: string, re: RegExp, what: string, timeout = 30_000): Promise<string> {
  try {
    await c.page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source] as const, { timeout, polling: 100 });
  } catch {
    throw new Error(`[${c.name}] 等待超时：${what}（${sel} 现在是 ${JSON.stringify(await c.page.textContent(sel).catch(() => null))}）`);
  }
  return (await c.page.textContent(sel))!;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const stack = await startOnlineStack({ build: !process.argv.includes('--no-build') });
  notes.push(`联机栈：${stack.origin}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  const clients: Client[] = [];
  try {
    // ① 两个人排娱乐。乙的"聊天"选了"不和陌生人"（guandan.settings 的 strangerChat: false）
    const a = await openClient(browser, stack, '甲', 'm-a', { width: 1280, height: 720 });
    const b = await openClient(browser, stack, '乙', 'm-b', { width: 1280, height: 720 }, { 'guandan.settings': JSON.stringify({ v: 1, strangerChat: false }) });
    clients.push(a, b);
    // 设置里"聊天"一行（乙选的是"不和陌生人"）
    await b.page.waitForTimeout(800);
    await click(b, 'settings');
    await b.page.waitForTimeout(400);
    await shot(b, '00-settings');
    await b.page.keyboard.press('Escape');
    await b.page.waitForTimeout(400);
    await queueFun(a, '00-level-picker');
    const one = await waitText(a, '#ol-match-wait', /已有 1\/4 人 · 还剩 \d+ 秒/, '甲排上（1 人）');
    await shot(a, '01-queue-alone');
    await queueFun(b);
    await waitText(a, '#ol-match-wait', /已有 2\/4 人/, '甲看到 2 人');
    const two = await waitText(b, '#ol-match-wait', /已有 2\/4 人 · 还剩 \d+ 秒/, '乙看到 2 人');
    await shot(b, '02-queue-two');
    notes.push(`排队卡：甲"${one}"，乙"${two}"`);
    const q0 = Date.now();
    // 15 秒到点两个人开一桌；排到的人都在，房间不等 20 秒直接开打
    for (const c of [a, b]) await until(c, '排到一桌、进牌桌', "g.scene === 'table' && g.net()?.match === true && g.net()?.room === 'playing'", 40_000);
    const [na, nb] = [await a.page.evaluate(() => window.__game!.net()!), await b.page.evaluate(() => window.__game!.net()!)];
    assert(na.code === nb.code, `两人不在同一桌：${na.code} / ${nb.code}`);
    assert(na.seat !== null && nb.seat !== null && na.seat !== nb.seat, `座位不对：${na.seat} / ${nb.seat}`);
    assert(na.seats.filter((s) => s.startsWith('human')).length === 2, `应该两个真人：${na.seats.join(',')}`);
    notes.push(`排到同一桌 ${na.code}（排队 ${Math.round((Date.now() - q0) / 1000)} 秒），座位 ${na.seat} / ${nb.seat}：${na.seats.join(',')}`);
    // 匹配桌不给邀请（牌桌顶上的 invite），地址栏里是房间码（刷新接得回来）
    for (const c of [a, b]) {
      const ctl = await c.page.evaluate(() => Object.keys(window.__game!.controls()));
      assert(!ctl.includes('invite'), `[${c.name}] 匹配桌不该有邀请按钮`);
    }
    // 陌生人聊天：甲带 chat=1、乙不带，乙这边没有聊天
    const roomWs = (c: Client): string => c.sockets.filter((u) => u.includes(`/rooms/${na.code}/ws`)).at(-1) ?? '';
    assert(roomWs(a).includes('chat=1'), `甲进匹配桌应带 chat=1：${roomWs(a)}`);
    assert(roomWs(b) && !roomWs(b).includes('chat=1'), `乙关了陌生人聊天，不该带 chat=1：${roomWs(b)}`);
    assert((await a.page.evaluate(() => window.__game!.net()!.chat)) && !(await b.page.evaluate(() => window.__game!.net()!.chat)), '会话的 chat 标记不对');
    notes.push('陌生人聊天：甲（开）带 chat=1，乙（关）不带');
    await shot(a, '03-match-table');
    await shot(b, '04-match-table-b');

    // ② 第三个人：先排一次再取消，回到标题页
    const c = await openClient(browser, stack, '丙', 'm-c', { width: 844, height: 390 });
    clients.push(c);
    // 手机横屏上的设置："聊天"一行三档（开 / 不和陌生人 / 不看）放得下
    await c.page.waitForTimeout(800);
    await click(c, 'settings');
    await c.page.waitForTimeout(400);
    await shot(c, '05a-settings-phone');
    await c.page.keyboard.press('Escape');
    await c.page.waitForTimeout(400);
    await queueFun(c);
    await waitText(c, '#ol-match-wait', /已有 1\/4 人/, '丙排上');
    await c.page.click('#ol-match-cancel');
    await c.page.waitForSelector('#online', { state: 'detached', timeout: 5_000 });
    assert((await c.page.evaluate(() => window.__game!.scene)) === 'title', '取消后应留在标题页');
    notes.push('取消：排队卡收起，留在标题页');
    // 再排实盘小档：选档页切到"快速匹配"，按钮变"匹配"
    await c.page.waitForTimeout(500);
    await click(c, 'stake');
    await until(c, '选档位', "'tier:small' in g.controls() && 'mode:1' in g.controls()");
    await click(c, 'mode:1');
    await shot(c, '05-tier-match-phone');
    await click(c, 'tier:small');
    await c.page.waitForSelector('#ol-match-wait', { timeout: 10_000 });
    const tier = await c.page.textContent('#ol-match-tier');
    assert(/实盘 · 小档/.test(tier ?? ''), `排队卡应写档位：${tier}`);
    await shot(c, '06-queue-stake-phone');
    const s0 = Date.now();
    const said = await waitText(c, '#ol-match-wait', /现在没人在排/, '只剩自己转单机', 40_000);
    await until(c, '转单机实盘', "g.scene === 'table' && !g.net() && !!g.stake()?.save", 30_000);
    const save = await c.page.evaluate(() => window.__game!.stake()!.save!);
    assert(save.tier === 'small', `单机实盘应是小档：${save.tier}`);
    notes.push(`只剩一人：${Math.round((Date.now() - s0) / 1000)} 秒后说"${said}"，转小档单机实盘（ref ${save.ref}）`);
    await shot(c, '07-solo-stake-phone');
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    for (const [i, c] of clients.entries()) await c.page.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => undefined);
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
  } else console.log('匹配冒烟通过：三个客户端控制台零报错');
}

await main();
