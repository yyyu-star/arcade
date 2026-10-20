/**
 * 快速匹配冒烟（0.21.0，kit 0.20.0）：真的 Worker + 排队 + 房间跑在本地 wrangler dev 里，平台和钱包换成 test/arcade.dev.ts。
 * A 横屏 1280×720、B 竖屏 390×844，两个人用不同的 sid。
 *
 *   npm run build:cf && npm run smoke:match [-- --shots 目录]
 *
 * 内容：
 * 1. 娱乐：A、B 都点"快速匹配"，排到同一张匹配桌（地址栏同一个房间号、带 match=1），不摆房间号、"叫朋友"；人到齐自动开打。
 *    A 选了"聊天：不和陌生人"：A 的房间连接不带 chat=1、牌桌上没有聊天；B 带 chat=1，B 说一句，自己的气泡不压自己的手牌。两人离开回娱乐选桌页；
 * 2. 实盘小档：A、B 排到一桌，开打时各从假钱包带一份（2,000）；
 * 3. 取消：排队卡点"取消"，留在选桌页、地址栏没有房间；
 * 4. 一个人排：15 秒后排队卡说"现在没人在排"，转娱乐单机；
 * 5. 立直（0.25.4，只有娱乐一档）：A、B 在娱乐选桌页选"立直"再点"快速匹配"，排到同一张立直匹配桌（.table.rc）；实盘选桌页选着立直时没有"快速匹配"。
 * 排队卡说过的每句话记在 window.__said，失败时打出来。两边控制台零报错。端口由系统分配。截图放在 shots/（--shots 可改）。
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
const log = (...a: unknown[]): void => console.log(`[smoke-match ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
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

async function newContext(browser: Browser, base: string, sid: string, viewport: { width: number; height: number }, chat: string | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const host = new URL(base).hostname;
  await ctx.addCookies([
    { name: '__Host-sid', value: sid, domain: host, path: '/', secure: true },
    { name: '__Host-arcade_li', value: '1', domain: host, path: '/', secure: true },
  ]);
  await ctx.addInitScript((c) => {
    localStorage.setItem('mahjong.guide', '1');
    if (c) localStorage.setItem('mahjong.chatOff', c);
  }, chat);
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
const said = (page: Page): Promise<string[]> => page.evaluate(() => (window as { __said?: string[] }).__said ?? []);
const roomOf = (page: Page): { room: string | null; match: string | null } => {
  const u = new URL(page.url());
  return { room: u.searchParams.get('room'), match: u.searchParams.get('match') };
};

/** 从主页点模式卡进选桌页（rc：先选立直），点"快速匹配" */
async function queue(page: Page, base: string, mode: 'fun' | 'real', rc = false): Promise<void> {
  await page.goto(`${base}/games/mahjong/`);
  await page.waitForSelector('.home-main');
  await page.click(`.mode.${mode}`);
  await page.waitForSelector('.lobby-head');
  if (rc) await page.click('.lobby-variants .chip:has-text("立直")');
  await page.click('.go-row .match');
  await page.waitForSelector('.mask.match .match-wait');
}

/** 排到桌、开打（手牌亮出来） */
async function matched(page: Page, tag: string): Promise<string> {
  await page.waitForSelector('.my-hand .tile', { timeout: 45_000 }).catch(async (e) => {
    throw new Error(`${tag} 没排进匹配桌：${JSON.stringify(await said(page))} ${String(e)}`);
  });
  return roomOf(page).room ?? '';
}

async function leaveRoom(page: Page): Promise<void> {
  await page.click('.pill.leave');
  await page.click('.mask.confirm .act.go');
  await page.waitForSelector('.lobby-head', { timeout: 5_000 });
}

const overlap = (a: DOMRectLike, b: DOMRectLike): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

let proc: ChildProcess | null = null;
const pages: Page[] = [];
let browser: Browser | null = null;
const state = mkdtempSync(join(tmpdir(), 'mahjong-smoke-'));
try {
  const port = await freePort();
  proc = await startWorker(port, state);
  const base = `http://localhost:${port}`;
  log('wrangler dev 起来了', base);
  browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
  // A 选"不和陌生人"，B 默认开
  const ctxA = await newContext(browser, base, 'matchA0001', { width: 1280, height: 720 }, 'stranger');
  const ctxB = await newContext(browser, base, 'matchB0002', { width: 390, height: 844 }, null);
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  pages.push(pa, pb);
  watch(pa, 'A');
  watch(pb, 'B');
  const sockets = new Map<Page, string[]>([
    [pa, []],
    [pb, []],
  ]);
  for (const [pg, list] of sockets) pg.on('websocket', (ws) => list.push(ws.url()));
  const roomSocket = (pg: Page, code: string): string | undefined => sockets.get(pg)!.find((u) => u.includes(`/rooms/${code}/ws`));

  // ---------- 1. 娱乐 ----------
  let t = Date.now();
  await queue(pa, base, 'fun');
  await pa.screenshot({ path: join(SHOTS, 'match-queue-a.png') });
  await queue(pb, base, 'fun');
  await pb.screenshot({ path: join(SHOTS, 'match-queue-b.png') });
  const [ca, cb] = await Promise.all([matched(pa, 'A'), matched(pb, 'B')]);
  check(/^\d{6}$/.test(ca) && ca === cb, `A、B 排到同一张娱乐匹配桌 ${ca}（${Math.round((Date.now() - t) / 1000)} 秒）`);
  check(roomOf(pa).match === '1' && roomOf(pb).match === '1', '地址栏带 match=1（刷新也知道是匹配桌）');
  const titleA = (await pa.textContent('.topbar .title')) ?? '';
  check(titleA.includes('快速匹配') && !titleA.includes(ca), `顶栏写"快速匹配"、不摆房间号（${titleA}）`);
  check(!(await pa.isVisible('.pill.share')) && !(await pb.isVisible('.pill.share')), '匹配桌没有"叫朋友"');
  const wa = roomSocket(pa, ca) ?? '';
  const wb = roomSocket(pb, cb) ?? '';
  check(!!wa && !wa.includes('chat=1'), `A（不和陌生人）的房间连接不带 chat=1（${wa.replace(/^.*\/rooms\//, '')}）`);
  check(wb.includes('chat=1'), `B 的房间连接带 chat=1（${wb.replace(/^.*\/rooms\//, '')}）`);
  // 匹配桌上不开代打，真实画面
  await pa.screenshot({ path: join(SHOTS, 'match-table-a.png') });
  // B 说一句（手机版：先点"聊天"按钮），自己的气泡不压自己的手牌
  await pb.click('.atf-btn');
  await pb.click('[data-key="fun:tab:chat"]');
  await pb.fill('[data-key="fun:chatInput"]', '幸会幸会');
  await pb.click('[data-key="fun:chatSend"]');
  const bubble = await pb.waitForSelector('.atf-say:has-text("幸会幸会")', { timeout: 4_000 }).catch(() => null);
  const away = await pb.$('.atf-away');
  if (away) await away.click({ position: { x: 5, y: 5 } }).catch(() => {});
  if (bubble) {
    await sleep(200);
    const [br, hr] = [await bubble.boundingBox(), await (await pb.$('.my-hand'))!.boundingBox()];
    check(!!br && !!hr && overlap(br, hr) === 0, `B 自己的气泡不压自己的手牌（气泡 ${JSON.stringify(br)}，手牌 ${JSON.stringify(hr)}）`);
  } else check(false, 'B 说的话自己看得到');
  await pb.screenshot({ path: join(SHOTS, 'match-table-b-chat.png') });
  await sleep(500);
  check(!(await pa.$('.atf-say:has-text("幸会幸会")')), 'A（不和陌生人）看不到 B 说的话');
  // 电脑版有聊天时牌桌一角常驻聊天框（kit 的 chat:dock）
  check(!(await pa.$('[data-key="chat:dock"]')), 'A 的牌桌没有聊天框');
  await leaveRoom(pa);
  await leaveRoom(pb);
  check((await pa.textContent('.lobby-head h1')) === '娱乐', '离开匹配桌回娱乐选桌页');

  // ---------- 2. 实盘小档 ----------
  t = Date.now();
  const before = [(await wallet(pa)).balance, (await wallet(pb)).balance];
  await queue(pa, base, 'real');
  await queue(pb, base, 'real');
  const [ra, rb] = await Promise.all([matched(pa, 'A'), matched(pb, 'B')]);
  check(ra === rb && ra !== ca, `A、B 排到同一张实盘匹配桌 ${ra}（${Math.round((Date.now() - t) / 1000)} 秒）`);
  let ws: Wallet[] = [];
  for (let i = 0; i < 40; i++) {
    ws = [await wallet(pa), await wallet(pb)];
    if (ws.every((w) => w.stakes.some((s) => s.game === 'mahjong' && s.mode === 'server'))) break;
    await sleep(250);
  }
  check(
    ws.every((w, i) => w.balance === before[i]! - 2_000 && w.stakes.some((s) => s.game === 'mahjong' && s.mode === 'server' && s.amount === 2_000 && s.tier === 'small')),
    `开打时各从钱包带一份 2,000（余额 ${ws.map((w) => w.balance).join(' / ')}）`,
  );
  await pb.screenshot({ path: join(SHOTS, 'match-real-b.png') });
  await leaveRoom(pa);
  await leaveRoom(pb);

  // ---------- 3. 取消 ----------
  await queue(pa, base, 'fun');
  // 连上、收到第一条人数再点（连接还没建立就关，浏览器会在控制台记一条警告）
  await pa.waitForSelector('.mask.match .match-wait:has-text("已有")');
  await pa.click('.mask.match .match-cancel');
  await sleep(500);
  check(!(await pa.$('.mask.match')) && !!(await pa.$('.lobby-head')) && roomOf(pa).room === null, '排队卡点"取消"：留在选桌页、没有房间');

  // ---------- 4. 一个人排 ----------
  t = Date.now();
  await queue(pa, base, 'fun');
  await pa.waitForSelector('.my-hand .tile', { timeout: 40_000 });
  const lines = await said(pa);
  check(roomOf(pa).room === null && lines.some((l) => l.includes('现在没人在排')), `一个人排：${Math.round((Date.now() - t) / 1000)} 秒后说"现在没人在排"，转单机`);
  check(lines.some((l) => /已有 1\/4 人 · 还剩 \d+ 秒/.test(l)), '排队卡写着"已有 1/4 人 · 还剩几秒"');

  // ---------- 5. 立直 ----------
  t = Date.now();
  await queue(pa, base, 'fun', true);
  const tier = (await pa.textContent('.mask.match .match-tier')) ?? '';
  await queue(pb, base, 'fun', true);
  const [qa, qb] = await Promise.all([matched(pa, 'A'), matched(pb, 'B')]);
  const rcTables = await Promise.all([pa, pb].map((pg) => pg.$('.table.rc')));
  check(qa === qb && qa !== '' && rcTables.every(Boolean), `立直：A、B 排到同一张立直匹配桌 ${qa}（${Math.round((Date.now() - t) / 1000)} 秒，排队卡写"${tier}"）`);
  await pa.screenshot({ path: join(SHOTS, 'match-rc-a.png') });
  await pb.screenshot({ path: join(SHOTS, 'match-rc-b.png') });
  await leaveRoom(pa);
  await leaveRoom(pb);
  // 选桌页记住了立直：实盘页不给快速匹配
  await pa.goto(`${base}/games/mahjong/`);
  await pa.waitForSelector('.home-main');
  await pa.click('.mode.real');
  await pa.waitForSelector('.lobby-head');
  check(!!(await pa.$('.lobby-variants .chip.on:has-text("立直")')) && !(await pa.$('.go-row .match')), '实盘选桌页选着立直时没有"快速匹配"');

  if (errors.length) {
    console.log(`控制台报错 ${errors.length} 条：\n${[...new Set(errors)].join('\n')}`);
    failures.push('控制台有报错');
  } else log('ok   两边控制台零报错');
} catch (e) {
  console.log(String((e as Error).stack ?? e));
  for (const [i, pg] of pages.entries()) {
    await pg.screenshot({ path: join(SHOTS, `fail-match-${i ? 'b' : 'a'}.png`) }).catch(() => {});
    console.log(`__said ${i ? 'B' : 'A'}:`, JSON.stringify(await said(pg).catch(() => [])));
  }
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
