/**
 * 好友房立直的双浏览器冒烟（docs/riichi.md 第 5 节）：真的 Worker + 页面跑在本地 wrangler dev 里，平台和钱包换成 test/arcade.dev.ts，
 * 和 scripts/smoke-room.ts 同一套环境。A 横屏 1280×720，B 竖屏 390×844。
 *
 *   npm run build:cf && node scripts/smoke-room-riichi.ts [--shots 目录]
 *
 * 1. 娱乐房：A 在好友房选桌页选"立直"开房，等人页写着立直的规则；B 凭 ?room= 进来坐下，A 开打；
 *    两边都是立直牌桌，自动打到一局结算出来（能和就和、不然过、打最右边那张），再打到下一局开始；
 * 2. 实盘小档房：A、B 开打，假钱包各扣 2,000；打完第一局后两个人都离开：房间按"没打完"结回，两边的那一份都结掉、余额加回结回的数。
 * 两边控制台零报错。端口由系统分配。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = opt('shots', join(ROOT, 'shots'));
mkdirSync(SHOTS, { recursive: true });

const errors: string[] = [];
const failures: string[] = [];
const t0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[smoke-room-rc ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
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
  const origin = `http://localhost:${port}`;
  const p = spawn('npx', ['wrangler', 'dev', '-c', 'test/wrangler.smoke.jsonc', '-c', 'test/arcade.dev.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--var', `SITE_ORIGIN:${origin}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  p.stdout!.on('data', (d) => (out += d));
  p.stderr!.on('data', (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${origin}/games/mahjong/`, { redirect: 'manual' });
      if (r.status === 302) return p;
    } catch {
      // 还没起来
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not start:\n${out.slice(-2000)}`);
}

async function newContext(browser: Browser, base: string, sid: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const host = new URL(base).hostname;
  await ctx.addCookies([
    { name: '__Host-sid', value: sid, domain: host, path: '/', secure: true },
    { name: '__Host-arcade_li', value: '1', domain: host, path: '/', secure: true },
  ]);
  await ctx.addInitScript(() => {
    localStorage.setItem('mahjong.guide', '1');
    localStorage.setItem('mahjong.guide.rc', '1');
  });
  return ctx;
}

function watch(page: Page, tag: string): void {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}

interface Wallet {
  balance: number;
  stakes: { game: string; mode: string; amount: number; tier: string }[];
}
const wallet = (page: Page): Promise<Wallet> => page.evaluate(async () => ((await (await fetch('/api/wallet')).json()) as { wallet: Wallet }).wallet);

/** 自动操作一步：能和就和，有吃碰杠的选择就过，不然打最右边那张（点两下：选、打） */
async function step(page: Page, tag: string): Promise<void> {
  const T = { timeout: 1_000 };
  if (await page.$('text=和房间断开了')) throw new Error(`${tag}: 页面显示"和房间断开了"`);
  if (await page.$('.mask')) return;
  if (await page.$('.bar .act.ron')) await page.click('.bar .act.ron', T).catch(() => {});
  else if (await page.$('.bar .act.pass')) await page.click('.bar .act.pass', T).catch(() => {});
  else {
    const t = (await page.$$('.my-hand .tile:not(.off)')).at(-1);
    if (t) {
      await t.click(T).catch(() => {});
      await t.click(T).catch(() => {});
    }
  }
}

async function playUntil(pages: [Page, string][], done: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error(`${what}: 超时（${ms / 1000} 秒）`);
    await Promise.all(pages.map(([p, t]) => step(p, t)));
    // kit 每个连接每秒只补 5 个令牌，点太快会被断开
    await sleep(300);
  }
}

/** 好友房选桌页选立直开房，返回房间号 */
async function openRoom(page: Page, base: string, stake: '娱乐' | '小档'): Promise<string> {
  await page.goto(`${base}/games/mahjong/`);
  await page.waitForSelector('.home-main');
  await page.click('.mode.room');
  await page.waitForSelector('.lobby-variants');
  await page.click('.lobby-variants .chip:has-text("立直")');
  await page.click(`.stakes .stake:has-text("${stake === '娱乐' ? '新手' : stake}")`);
  await page.click('.rules-opts summary');
  await page.click('.rules-opts .chip:has-text("东风战")');
  await page.click('text=开房间叫朋友');
  await page.waitForSelector('.room-code');
  const code = ((await page.textContent('.room-code')) ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`房间号不对：${code}`);
  return code;
}

async function joinAndStart(a: Page, b: Page, base: string, code: string): Promise<void> {
  await b.goto(`${base}/games/mahjong/?room=${code}`);
  await b.waitForSelector('.room-code');
  await b.click('.room-seat.empty .act');
  await b.waitForSelector('.room-seat.me');
  await a.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length >= 2);
  await a.click('button:text-is("开打")');
  await Promise.all([a.waitForSelector('.table.rc .my-hand .tile', { timeout: 20_000 }), b.waitForSelector('.table.rc .my-hand .tile', { timeout: 20_000 })]);
}

async function leaveRoom(page: Page): Promise<void> {
  await page.click('.pill.leave');
  await page.click('.mask.confirm .act.go');
  await page.waitForSelector('.lobby-head', { timeout: 5_000 });
}

let proc: ChildProcess | null = null;
let browser: Browser | null = null;
const pages: Page[] = [];
const state = mkdtempSync(join(tmpdir(), 'mahjong-smoke-rc-'));
try {
  const port = await freePort();
  proc = await startWorker(port, state);
  const base = `http://localhost:${port}`;
  log('wrangler dev 起来了', base);
  browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
  const pa = await (await newContext(browser, base, 'smokeA0001', { width: 1280, height: 720 })).newPage();
  const pb = await (await newContext(browser, base, 'smokeB0002', { width: 390, height: 844 })).newPage();
  pages.push(pa, pb);
  watch(pa, 'A');
  watch(pb, 'B');
  const both: [Page, string][] = [
    [pa, 'A'],
    [pb, 'B'],
  ];

  // ---------- 娱乐房 ----------
  let code = await openRoom(pa, base, '娱乐');
  const rules = (await pa.textContent('.room-rules')) ?? '';
  check(/立直麻将/.test(rules) && /东风战/.test(rules), `A 在好友房选桌页选立直开房 ${code}，等人页写着"${rules}"`);
  await joinAndStart(pa, pb, base, code);
  check(true, 'A、B 都是立直牌桌（.table.rc）');
  await playUntil(both, async () => !!(await pa.$('.mask.end')), 240_000, '打到第一局结算');
  await pa.screenshot({ path: join(SHOTS, 'room-rc-summary-a.png') });
  await pb.screenshot({ path: join(SHOTS, 'room-rc-summary-b.png') });
  check(!!(await pa.$('.mask.end .rc-summary')), 'A 看到立直的一局结算');
  // 结算停一会儿自己进下一局
  await pa.waitForSelector('.mask.end', { state: 'detached', timeout: 30_000 });
  await playUntil(both, async () => ((await pa.$$('.river .tile')).length > 0), 60_000, '下一局开打');
  await pa.screenshot({ path: join(SHOTS, 'room-rc-turn-a.png') });
  await pb.screenshot({ path: join(SHOTS, 'room-rc-turn-b.png') });
  check(true, '第二局开打，两边照常出牌');
  await leaveRoom(pb);
  await leaveRoom(pa);

  // ---------- 实盘小档房 ----------
  const w0 = { a: await wallet(pa), b: await wallet(pb) };
  code = await openRoom(pa, base, '小档');
  await joinAndStart(pa, pb, base, code);
  let w1 = { a: await wallet(pa), b: await wallet(pb) };
  for (let i = 0; i < 50 && (w1.a.stakes.length === 0 || w1.b.stakes.length === 0); i++) {
    await sleep(200);
    w1 = { a: await wallet(pa), b: await wallet(pb) };
  }
  check(w0.a.balance - w1.a.balance === 2_000 && w0.b.balance - w1.b.balance === 2_000, `实盘立直房开打：A、B 各扣 2,000（${w0.a.balance}→${w1.a.balance}、${w0.b.balance}→${w1.b.balance}）`);
  await playUntil(both, async () => !!(await pa.$('.mask.end')), 240_000, '实盘打到第一局结算');
  await pa.waitForSelector('.mask.end', { state: 'detached', timeout: 30_000 });
  await leaveRoom(pb);
  await leaveRoom(pa);
  let w2 = { a: await wallet(pa), b: await wallet(pb) };
  for (let i = 0; i < 150 && (w2.a.stakes.some((x) => x.game === 'mahjong') || w2.b.stakes.some((x) => x.game === 'mahjong')); i++) {
    await sleep(200);
    w2 = { a: await wallet(pa), b: await wallet(pb) };
  }
  const settled = !w2.a.stakes.some((x) => x.game === 'mahjong') && !w2.b.stakes.some((x) => x.game === 'mahjong');
  check(settled, `两人都离开后实盘结回：A ${w1.a.balance}→${w2.a.balance}，B ${w1.b.balance}→${w2.b.balance}`);
  check(w2.a.balance + w2.b.balance <= w0.a.balance + w0.b.balance + 4 * 2_000, '结回的数在"最多赢 3 份"以内');

  if (errors.length) {
    console.log(`控制台报错 ${errors.length} 条：\n${[...new Set(errors)].join('\n')}`);
    failures.push('控制台有报错');
  } else log('ok   两边控制台零报错');
} catch (e) {
  console.log(String((e as Error).stack ?? e));
  for (const [i, pg] of pages.entries()) await pg.screenshot({ path: join(SHOTS, `fail-rc-${i ? 'b' : 'a'}.png`) }).catch(() => {});
  if (errors.length) console.log(`（出错时控制台报错：\n${[...new Set(errors)].join('\n')}）`);
  failures.push(String(e));
} finally {
  await browser?.close().catch(() => {});
  if (proc?.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // 已经退了
    }
  }
  rmSync(state, { recursive: true, force: true });
}
log(failures.length ? `失败 ${failures.length} 项` : '全部通过', `总耗时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
process.exit(failures.length ? 1 : 0);
