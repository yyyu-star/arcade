/**
 * 好友房双浏览器冒烟（AGENTS.md 第 4 节）：真的 Worker + 页面跑在本机 wrangler dev 里，平台和平台钱包换成 test/arcade.dev.ts
 * （认 cookie __Host-sid，钱包用 arcade-kit/testing 的假钱包）。A 横屏 1280×720，B 竖屏 390×844，两个人用不同的 sid。
 *
 *   npm run build:cf && npm run smoke:room [-- --rounds 2] [--shots 目录]
 *
 * 内容：
 * 1. 娱乐房：A 开房（局数 4）、B 凭 ?room= 进等人页坐下、A 开打，两边自动打满 N 局（换三张、定缺、能胡就胡、不然过、打最右边那张），
 *    B 离开并确认，A 继续打、牌桌还在动；
 * 2. 实盘小档房：A、B 进房开打，检查假钱包各扣 2,000、stakes 里各有 mahjong 的 server 模式一份；B 中途离开，那一份马上没了、余额加回结回的数。
 * 两边控制台零报错。端口由系统分配（不占 5176 / 4176）。截图放在 shots/（--shots 可改）。
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
const ROUNDS = Number(opt('rounds', '2'));
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = opt('shots', join(ROOT, 'shots'));
mkdirSync(SHOTS, { recursive: true });

const errors: string[] = [];
const failures: string[] = [];
const t0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[smoke-room ${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
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
  await ctx.addInitScript(() => localStorage.setItem('mahjong.guide', '1'));
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

interface Player {
  page: Page;
  tag: string;
  /** 打到的最大局序号（第 N/M 局的 N）和打出去的牌数 */
  round: number;
  discards: number;
}

/** 自动操作一步；返回是否点了什么 */
async function step(p: Player): Promise<void> {
  const page = p.page;
  const T = { timeout: 1_000 };
  const r = await page.$eval('.round', (e) => e.textContent ?? '').catch(() => '');
  const m = /第\s*(\d+)\//.exec(r);
  if (m) p.round = Math.max(p.round, Number(m[1]));
  if (await page.$('text=和房间断开了')) throw new Error(`${p.tag}: 页面显示"和房间断开了"（回合 ${p.round}）`);
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
      // 第一下选牌，第二下打出；打出去后那张牌会被换掉，第二下点不到就当没打
      if (await t.click(T).then(() => true, () => false)) p.discards++;
      await t.click(T).catch(() => {});
    }
  }
}

/** 一直打，直到 done() 为真或超时 */
async function playUntil(players: Player[], done: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`${what}: 超时（${ms / 1000} 秒），回合 ${players.map((p) => `${p.tag}=${p.round}`).join(' ')}`);
    await Promise.all(players.map((p) => step(p)));
    // kit 每个连接每秒只补 5 个令牌（攒 10 个），点太快会被 1008 断开，真人不会点这么快
    await sleep(300);
  }
}

/** 选桌页开房，返回房间号 */
async function openRoom(page: Page, base: string, stake: '娱乐' | '小档'): Promise<string> {
  await page.goto(`${base}/games/mahjong/`);
  await page.waitForSelector('.lobby-head');
  await page.click(`.stakes .stake:has-text("${stake}")`);
  await page.click('.rules-opts summary');
  await page.click('.rules-opts .chip:has-text("4 局")');
  await page.click('text=开房间叫朋友');
  await page.waitForSelector('.room-code');
  const code = ((await page.textContent('.room-code')) ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`房间号不对：${code}`);
  return code;
}

async function joinAndStart(a: Page, b: Page, base: string, code: string): Promise<void> {
  await b.goto(`${base}/games/mahjong/?room=${code}`);
  await b.waitForSelector('.room-code');
  check(((await b.textContent('.room-code')) ?? '').trim() === code, `B 凭 ?room= 直接进等人页，房间号 ${code}`);
  await b.click('.room-seat.empty .act');
  await b.waitForSelector('.room-seat.me');
  // A 这边要看到 B 坐下（两个真人）
  await a.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length >= 2);
  await a.click('button:text-is("开打")');
  await Promise.all([a.waitForSelector('.my-hand .tile', { timeout: 20_000 }), b.waitForSelector('.my-hand .tile', { timeout: 20_000 })]);
}

/** 点"离开"并确认，回到选桌页；再等一会儿，旧房间还在路上的帧不能把牌桌画回来（0.2.0 冒烟抓到过，online.ts 的 closed） */
async function leaveRoom(page: Page, tag: string): Promise<void> {
  await page.click('.pill.leave');
  await page.click('.mask.confirm .act.go');
  await page.waitForSelector('.lobby-head', { timeout: 5_000 });
  await sleep(2_500);
  if (!(await page.$('.lobby-head'))) {
    await page.screenshot({ path: join(SHOTS, `fail-leave-${tag}.png`) });
    throw new Error(`${tag} 离开后选桌页被旧房间的牌桌盖掉`);
  }
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
  const ctxA = await newContext(browser, base, 'smokeA0001', { width: 1280, height: 720 });
  const ctxB = await newContext(browser, base, 'smokeB0002', { width: 390, height: 844 });
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  pages.push(pa, pb);
  watch(pa, 'A');
  watch(pb, 'B');
  const A: Player = { page: pa, tag: 'A', round: 0, discards: 0 };
  const B: Player = { page: pb, tag: 'B', round: 0, discards: 0 };

  // ---------- 娱乐房 ----------
  let t = Date.now();
  let code = await openRoom(pa, base, '娱乐');
  log('A 开娱乐房', code);
  // 等人页"离开房间"先离座（自审 C4）：B 坐下再离开，A 这边那个座位要空出来（只断开的话 kit 只记掉线、座位还占着）
  await pb.goto(`${base}/games/mahjong/?room=${code}`);
  await pb.waitForSelector('.room-code');
  await pb.click('.room-seat.empty .act');
  await pa.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length >= 2);
  await pb.click('button:text-is("离开房间")');
  await pb.waitForSelector('.lobby-head');
  const freed = await pa.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length === 1, null, { timeout: 5_000 }).then(() => true, () => false);
  check(freed, 'B 在等人页点"离开房间"，A 这边他的座位空出来');
  await joinAndStart(pa, pb, base, code);
  check(true, `娱乐房开打，两边进牌桌（${Math.round((Date.now() - t) / 1000)} 秒）`);
  // 开局换三张时操作条最宽：截一张看"聊"按钮、自己的头像牌有没有压住它
  await pa.screenshot({ path: join(SHOTS, 'room-start-a.png') });
  await pb.screenshot({ path: join(SHOTS, 'room-start-b.png') });

  // 交流（0.3.0）：A 说一句、发一张表情、冲 B 扔一个道具，B 那边看得到
  await pa.click('.comms-btn');
  await pa.click('.comms-body .phrase:has-text("雄起！")');
  check(!!(await pb.waitForSelector('.bubble:has-text("雄起！")', { timeout: 4_000 }).catch(() => null)), 'A 说的短语 B 看得到');
  await pa.click('.comms-btn');
  await pa.click('.comms-tabs .chip:has-text("表情")');
  await pa.click('.comms-body .pic >> nth=0');
  check(!!(await pb.waitForSelector('.arcade-fun > *', { timeout: 4_000 }).catch(() => null)), 'A 发的表情 B 看得到');
  await sleep(2_500);
  await pa.click('.comms-btn');
  await pa.click('.comms-tabs .chip:has-text("道具")');
  await pa.click('.comms-body .pic >> nth=0');
  await pa.click('.comms-body .act:has-text("smokeB")');
  check(!!(await pb.waitForSelector('.arcade-fun > *', { timeout: 4_000 }).catch(() => null)), 'A 冲 B 扔的道具 B 看得到');
  await pa.screenshot({ path: join(SHOTS, 'room-comms-a.png') });
  await playUntil([A, B], () => A.round > ROUNDS && B.round > ROUNDS, 6 * 60_000, '娱乐房打局');
  check(true, `娱乐房打满 ${ROUNDS} 局（A 打出 ${A.discards} 张，B 打出 ${B.discards} 张，${Math.round((Date.now() - t) / 1000)} 秒）`);
  await pa.screenshot({ path: join(SHOTS, 'room-a.png') });
  await pb.screenshot({ path: join(SHOTS, 'room-b.png') });
  await leaveRoom(pb, 'B');
  check(true, 'B 对局中点离开并确认，回到选桌页');
  const before = A.discards;
  const rBefore = A.round;
  await playUntil([A], () => A.discards >= before + 3 || A.round > rBefore, 90_000, 'B 走后 A 继续打');
  check(true, `B 走后 A 还能动（又打出 ${A.discards - before} 张，回合 ${rBefore}→${A.round}）`);
  await pa.screenshot({ path: join(SHOTS, 'room-a-after-leave.png') });

  // ---------- 实盘小档房 ----------
  await leaveRoom(pa, 'A');
  t = Date.now();
  const w0 = { a: await wallet(pa), b: await wallet(pb) };
  log('开房前钱包', w0.a.balance, w0.b.balance);
  code = await openRoom(pa, base, '小档');
  log('A 开实盘小档房', code);
  await joinAndStart(pa, pb, base, code);
  // 带入是房间开打后异步办的，等两边到账
  let w1 = { a: await wallet(pa), b: await wallet(pb) };
  for (let i = 0; i < 50 && (w1.a.stakes.length === 0 || w1.b.stakes.length === 0); i++) {
    await sleep(200);
    w1 = { a: await wallet(pa), b: await wallet(pb) };
  }
  log('开打后钱包', w1.a.balance, w1.b.balance, JSON.stringify(w1.a.stakes));
  check(w0.a.balance - w1.a.balance === 2_000, `A 余额 ${w0.a.balance} → ${w1.a.balance}，少 2,000`);
  check(w0.b.balance - w1.b.balance === 2_000, `B 余额 ${w0.b.balance} → ${w1.b.balance}，少 2,000`);
  for (const [n, w] of [['A', w1.a], ['B', w1.b]] as const) {
    const s = w.stakes.filter((x) => x.game === 'mahjong' && x.mode === 'server');
    check(s.length === 1 && s[0]!.amount === 2_000, `${n} 的 stakes 里有一份 mahjong/server/2000（${JSON.stringify(w.stakes)}）`);
  }
  // 先打一会儿（半局以上），再让 B 走
  const d0 = B.discards;
  await playUntil([A, B], () => B.discards >= d0 + 3, 120_000, '实盘房先打几张');
  await pa.screenshot({ path: join(SHOTS, 'room-stake-a.png') });
  await leaveRoom(pb, 'B');
  let w2 = await wallet(pb);
  for (let i = 0; i < 25 && w2.stakes.length > 0; i++) {
    await sleep(200);
    w2 = await wallet(pb);
  }
  log('B 离开后钱包', w2.balance, JSON.stringify(w2.stakes));
  check(w2.stakes.length === 0, 'B 离开后那一份马上没了');
  check(w2.balance > w1.b.balance, `B 余额加回结回的数：${w1.b.balance} → ${w2.balance}（结回 ${w2.balance - w1.b.balance}）`);
  const wa = await wallet(pa);
  check(wa.stakes.length === 1, `B 走后 A 的那一份还在（余额 ${wa.balance}）`);
  await pb.screenshot({ path: join(SHOTS, 'room-stake-b.png') });
  await leaveRoom(pa, 'A');
  let wa2 = await wallet(pa);
  for (let i = 0; i < 25 && wa2.stakes.length > 0; i++) {
    await sleep(200);
    wa2 = await wallet(pa);
  }
  log('A 离开后钱包', wa2.balance, JSON.stringify(wa2.stakes));

  // ---------- 再来一场（0.3.6）：娱乐房打完一整场，A 点"再来一场"，B 看到提示、自动跟进新房间，坐回和上一场一样的相对位置 ----------
  t = Date.now();
  code = await openRoom(pa, base, '娱乐');
  log('A 开娱乐房（打一整场）', code);
  await joinAndStart(pa, pb, base, code);
  const atEnd = async (pg: Page): Promise<boolean> => !!(await pg.$('.mask.end .rematch'));
  const deadline = Date.now() + 10 * 60_000;
  while (!((await atEnd(pa)) && (await atEnd(pb)))) {
    if (Date.now() > deadline) throw new Error('一整场没打完');
    await Promise.all([step(A), step(B)]);
    await sleep(300);
  }
  check(true, `一整场打完，两边结算上都有"再来一场"（${Math.round((Date.now() - t) / 1000)} 秒）`);
  await pa.click('.mask.end .rematch');
  await pa.waitForFunction((old) => /^\d{6}$/.test(document.querySelector('.room-code')?.textContent?.trim() ?? '') && document.querySelector('.room-code')?.textContent?.trim() !== old, code);
  const code2 = ((await pa.textContent('.room-code')) ?? '').trim();
  check(!!(await pb.waitForSelector('.mask.end .end-acts:has-text("现在过去")', { timeout: 5_000 }).catch(() => null)), `B 的结算上写着 A 开了新房间 ${code2}、有"现在过去"`);
  check(!(await pb.$('.mask.end .rematch')), 'B 的"再来一场"收起来了');
  await pb.screenshot({ path: join(SHOTS, 'room-rematch-b.png') });
  await pb.waitForFunction((c) => document.querySelector('.room-code')?.textContent?.trim() === c, code2, { timeout: 15_000 });
  await pb.waitForSelector('.room-seat.me', { timeout: 5_000 });
  const seatB = await pb.$$eval('.room-seats .room-seat', (cs) => cs.findIndex((c) => c.classList.contains('me')));
  check(seatB === 1, `B 自动跟进新房间 ${code2}，坐回 1 号位（${seatB}）`);
  await pa.waitForFunction(() => document.querySelectorAll('.room-seat:not(.empty)').length >= 2);
  await pa.screenshot({ path: join(SHOTS, 'room-rematch-a.png') });

  if (errors.length) {
    console.log(`控制台报错 ${errors.length} 条：\n${[...new Set(errors)].join('\n')}`);
    failures.push('控制台有报错');
  } else log('ok   两边控制台零报错');
} catch (e) {
  console.log(String((e as Error).stack ?? e));
  for (const [i, pg] of pages.entries()) await pg.screenshot({ path: join(SHOTS, `fail-${i ? 'b' : 'a'}.png`) }).catch(() => {});
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
