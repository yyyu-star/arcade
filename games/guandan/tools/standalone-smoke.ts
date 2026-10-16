/**
 * 单独部署冒烟（0.8.0）：用模块的 wrangler.jsonc 原样起 wrangler dev（没有平台、GATE、SITE_ORIGIN，kit 的独立模式），检查：
 * - 站点根转到 /games/guandan/；单机实盘接口和实盘房间都回 409 no_wallet；
 * - 标题页没有云存档、没有"大厅"，"开始"直接开局（不选娱乐 / 实盘）；牌桌左上角是"首页"，点了回游戏首页 ./；单机托管打完一副；
 * - 好友房：两个游客各填昵称，一个开房（没有"开实盘房间"），另一个凭链接进房自动坐下、名字对；开打、扔道具；
 * - 所有页面控制台零报错。
 *
 * 用法：node tools/standalone-smoke.ts [--out <截图目录>] [--no-build]
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startOnlineStack } from './online-dev.ts';

const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : `${process.cwd()}/shots/standalone`;
})();
const errors: string[] = [];
const notes: string[] = [];

function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}

async function open(browser: Browser, name: string, url: string, nick?: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // 新手引导看过了；好友房的昵称预先填好（凭链接进房的人不经过大厅的昵称框）
  await ctx.addInitScript((n) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('guandan.tutorial', JSON.stringify({ v: 1, done: true }));
    if (n) localStorage.setItem('guandan.nick', JSON.stringify(n));
  }, nick ?? '');
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket connection|Failed to load resource/.test(m.text())) errors.push(`[${name}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url, { timeout: 90_000 });
  return page;
}

const until = (p: Page, cond: string, timeout = 60_000): Promise<unknown> =>
  p.waitForFunction(`(() => { const g = window.__game; return !!g && (${cond}); })()`, null, { timeout, polling: 100 });
const ctl = async (p: Page): Promise<Record<string, { x: number; y: number }>> => p.evaluate(() => window.__game!.controls());
async function click(p: Page, key: string): Promise<void> {
  await until(p, `!!g.controls()[${JSON.stringify(key)}]`, 20_000);
  const c = (await ctl(p))[key]!;
  await p.mouse.click(c.x, c.y);
}
const shot = async (p: Page, file: string): Promise<void> => {
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${file}.png` });
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const stack = await startOnlineStack({ standalone: true, build: !process.argv.includes('--no-build') });
  const { origin } = stack;
  notes.push(`wrangler dev 原样用 wrangler.jsonc：${origin}`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  try {
    // ① Worker：站点根、实盘接口
    // /api/me 由 kit 接住（0.10.2）：页面问有没有平台时不再落到静态资源的 404
    const me = await fetch(`${origin}/api/me`);
    assert(me.status === 200 && ((await me.json()) as { standalone?: boolean }).standalone === true, `/api/me 应当 200 { standalone: true }（${me.status}）`);
    const root = await fetch(`${origin}/`, { redirect: 'manual' });
    assert(root.status === 302 && new URL(root.headers.get('location')!, origin).pathname === '/games/guandan/', `站点根应当 302 到 /games/guandan/（${root.status}）`);
    const body = JSON.stringify({ tier: 'small' });
    const stake = await fetch(`${origin}/games/guandan/api/stake/buyin`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'content-length': String(body.length) }, body });
    assert(stake.status === 409 && ((await stake.json()) as { error?: string }).error === 'no_wallet', `单机实盘应当 409 no_wallet（${stake.status}）`);
    const room = await fetch(`${origin}/games/guandan/room/rooms`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ stake: 'small' }) });
    assert(room.status === 409, `实盘房间应当 409（${room.status}）`);
    notes.push('/api/me 回 { standalone: true }；站点根转到 /games/guandan/；单机实盘、实盘房间都回 409 no_wallet');

    // ② 单机：标题页、开局、"首页"
    const solo = await open(browser, '单机', `${origin}/games/guandan/?debug=1&anim=0&autoplay=1`);
    await until(solo, "g.ready && g.scene === 'title'");
    const t = await ctl(solo);
    assert(!t['cloud'] && !t['lobby'] && t['online'], `标题页不该有云存档和大厅，要有好友房（${Object.keys(t).join(',')}）`);
    await shot(solo, 's1-title');
    await click(solo, 'new');
    await until(solo, "g.scene === 'table' && g.view()?.dealNo >= 1", 30_000);
    assert(!(await ctl(solo))['cloud'], '牌桌上不该有云存档');
    await shot(solo, 's2-solo-table');
    notes.push('标题页没有云存档和大厅；"开始"直接开局（不选娱乐 / 实盘）');
    await click(solo, 'lobby');
    await until(solo, "!!g.controls()['ok']", 10_000);
    await shot(solo, 's3-leave-confirm');
    await click(solo, 'ok');
    // 回到的是不带 debug=1 的首页，没有调试桥：看地址就够了
    await solo.waitForURL((u) => u.pathname === '/games/guandan/' && u.search === '', { timeout: 10_000 });
    notes.push('牌桌左上角"首页"：确认后回到游戏首页 ./');
    // 单机打完一副：URL 开局才托管（标题页开的局不托管）
    await solo.goto(`${origin}/games/guandan/?seed=standalone&debug=1&anim=0&autoplay=1`);
    await until(solo, "g.view()?.phase === 'dealEnd' || g.view()?.dealNo >= 2", 300_000);
    await shot(solo, 's3b-solo-deal');
    notes.push('单机托管打完一副');
    await solo.context().close();

    // ③ 好友房：两个游客
    const host = await open(browser, '房主', `${origin}/games/guandan/?online=1&debug=1&anim=0&autoplay=1`);
    await host.waitForSelector('#ol-nick', { timeout: 60_000 });
    assert((await host.$('#ol-create-stake')) === null, '单独部署不该有"开实盘房间"');
    await host.fill('#ol-nick', '阿花');
    await host.click('#ol-create');
    await host.waitForSelector('#ol-room-code', { timeout: 30_000 });
    const code = (await host.textContent('#ol-room-code'))!.trim();
    assert(/^\d{6}$/.test(code), `房间码格式不对：${code}`);
    const guest = await open(browser, '朋友', `${origin}/games/guandan/?room=${code}&debug=1&anim=0&autoplay=1`, '小明');
    await until(guest, 'g.net()?.seat === 1', 30_000);
    await host.waitForFunction(() => /阿花（你）/.test(document.querySelector('#online')?.textContent ?? '') && /小明/.test(document.querySelector('#online')?.textContent ?? ''), null, { timeout: 15_000 });
    await shot(host, 's4-room-lobby');
    notes.push(`好友房 ${code}：房主"阿花"、朋友"小明"凭链接进房坐 1 号，名字都对`);
    await host.click('#ol-start');
    for (const p of [host, guest]) await until(p, "g.scene === 'table' && g.view()?.dealNo >= 1", 30_000);
    // 朋友点房主的头像（朋友画面上房主在左手边，画面座位 3）扔番茄
    await click(guest, 'avatar3');
    await click(guest, 'menu:prop0');
    await until(host, "g.fxLog.includes('道具 1>0:tomato')", 15_000);
    await host.waitForTimeout(6_000);
    await shot(host, 's5-room-table');
    notes.push('开打，朋友冲房主扔番茄，房主看到了');
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
  } else console.log('单独部署冒烟通过：控制台零报错');
}

await main();
