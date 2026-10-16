/**
 * 连拍（DESIGN.md 0.2 体验第 5 条）：看节奏不能只看静态截图。本机起页面（vite，端口由系统分配），单机娱乐桌自动打，
 * 每隔固定毫秒截一张，再拼成带时间的大图（一张 4×4），逐帧看一手从发牌、下注、翻牌到结束、下一手的全过程。
 *
 *   node scripts/capture.ts [--out 目录] [--every 300] [--secs 40] [--device desk|phone|both] [--auto] [--size 6] [--peek] [--read] [--journal] [--mix]
 *
 * 平台的 /api/me、/api/saves、/api/wallet 由这里代答（娱乐桌不碰钱包）。--auto 打开"自动下一手"，不开时一手结束后过 3 秒替人点"下一手"。
 * 输出：<out>/<device>/f0001.png…，<out>/<device>-sheet-01.png…（拼好的大图）。不部署，不进 CI。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import sharp from 'sharp';
import { PERSONAS } from '../src/ai/personas.ts';
import type { Card } from '../src/core/cards.ts';
import { CATEGORY_NAMES, categoryOf } from '../src/core/eval.ts';
import type { Table } from '../src/core/table.ts';
import { args, opt } from './args.ts';

const OUT = opt('out', join(tmpdir(), 'texas-capture'));
const EVERY = Number(opt('every', '300'));
const SECS = Number(opt('secs', '40'));
const DEVICE = opt('device', 'both');
const AUTO = args.includes('--auto');
const SIZE = Number(opt('size', '6'));
/** 轮到我时先单独截一张（<out>/<device>/turn-N.png）再点，看操作区 */
const PEEK = args.includes('--peek');
/** 打完以后点每个电脑的头像各截一张（<out>/<device>/read-N.png），看"看对手"的小卡 */
const READ = args.includes('--read');
/** 每手打完把这一手打印出来（每个人的底牌、每一步、谁赢了多少），在浏览器里真打时挑电脑的怪动作 */
const JOURNAL = args.includes('--journal');
/** 我不再一直跟：每 5 次轮到我有一次弃牌（能过牌时不弃）、每 7 次有一次下半池，看电脑碰到会下注、会弃牌的人怎么打 */
const MIX = args.includes('--mix');

const card = (c: Card): string => '23456789TJQKA'[c >> 2]! + 'cdhs'[c & 3]!;

/** 本机存档里停着的这一手（规则的完整状态；底牌打完就清了，用这一手打着时记下的 hole）。只在本机看 */
function journal(t: Table, hole: Card[][]): string {
  const r = t.lastHand!;
  const who = (i: number): string => (t.seats[i]!.owner === 'house' ? PERSONAS[t.seats[i]!.persona]!.name : '我');
  const out = [`#${r.handNo} ${t.stakes} 公共牌 ${r.board.map(card).join(' ') || '-'}`];
  out.push(`  ${hole.flatMap((h, i) => (h.length ? [`${who(i)} ${h.map(card).join('')}`] : [])).join('，')}`);
  out.push(`  ${t.log.map((e) => (e.seat < 0 ? `| ${e.act}` : `${who(e.seat)} ${e.act}${e.amount ? ` ${e.amount}` : ''}${e.allin ? ' 全下' : ''}`)).join('，')}`);
  const shown = r.shown.map((x) => `${who(x.seat)} ${CATEGORY_NAMES[categoryOf(x.value)]}`).join('、');
  out.push(`  ${r.byFold ? '没摊牌' : `摊牌：${shown}`}；${r.pots.map((p) => `${p.amount} → ${p.winners.map((w) => who(w.seat)).join('、')}`).join('；')}`);
  return out.join('\n');
}

const DEVICES = {
  desk: { viewport: { width: 1280, height: 720 } },
  phone: {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
} as const;

async function startVite(): Promise<{ url: string; stop: () => void }> {
  // 单独一个进程组：npx 底下的 vite 要连着一起关，不然脚本退不出来
  const p = spawn('npx', ['vite', '--port', '0', '--strictPort', 'false', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stop = (): void => {
    try {
      process.kill(-p.pid!, 'SIGTERM');
    } catch {
      // 已经退了
    }
  };
  let out = '';
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`vite did not start:\n${out}`)), 30_000);
    const on = (b: Buffer) => {
      out += b.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(t);
        ok({ url: `http://127.0.0.1:${m[1]}/games/texas/`, stop });
      }
    };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
  });
}

async function fakePlatform(page: Page): Promise<void> {
  const wallet = { balance: 10_000, stakes: [], canRelief: false, writesLeft: 200, caps: {}, fresh: false };
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/games/')) return route.continue();
    if (u.pathname === '/api/me') return route.fulfill({ json: { user: { id: 'cap', displayName: '我', username: 'cap' }, saves: 'on' } });
    if (u.pathname === '/api/wallet') return route.fulfill({ json: { wallet, tiers: {}, reliefTo: 2000 } });
    if (u.pathname.startsWith('/api/saves')) return route.fulfill({ json: u.pathname.endsWith('/stats') ? { rev: 1, updatedAt: Date.now() } : { saves: [] } });
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}

/** 自动打：能过就过、能跟就跟（多打到摊牌）；结果出来了替人点"下一手"（--auto 时等它自己发） */
async function autoplay(page: Page, until: number, shoot: () => Promise<void>, dir: string): Promise<void> {
  let endedAt = 0;
  let turns = 0;
  while (Date.now() < until) {
    const t0 = Date.now();
    await shoot();
    const call = page.locator('.actions.on .act.call');
    if (PEEK && (await call.isVisible().catch(() => false))) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, `turn-${turns + 1}.png`), scale: 'css' });
    }
    if (await call.isVisible().catch(() => false)) {
      const n = turns++;
      const fold = page.locator('.actions.on .act.fold:not(.soft)');
      const bet = page.locator('.actions.on .qbet:not(.hidden)').first();
      const pick = MIX && n % 5 === 4 && (await fold.isVisible().catch(() => false)) ? fold : MIX && n % 7 === 6 && (await bet.isVisible().catch(() => false)) ? bet : call;
      await pick.click({ timeout: 500 }).catch((e: Error) => console.log('click', e.message.split('\n')[0]));
    }
    const next = page.locator('.next-hand:not(.hidden)');
    if (!AUTO && (await next.isVisible().catch(() => false))) {
      endedAt ||= Date.now();
      if (Date.now() - endedAt > 3_000) {
        await next.click({ timeout: 500 }).catch(() => {});
        endedAt = 0;
      }
    } else endedAt = 0;
    const d = page.locator('.dialog .d-btn.primary');
    if (await d.isVisible().catch(() => false)) await d.click({ timeout: 500 }).catch(() => {});
    await page.waitForTimeout(Math.max(0, EVERY - (Date.now() - t0)));
  }
}

async function sheets(dir: string, files: { path: string; ms: number }[], name: string, w: number, h: number): Promise<void> {
  const cols = 4;
  const rows = 4;
  const tw = 480;
  const th = Math.round((tw * h) / w);
  for (let s = 0; s * cols * rows < files.length; s++) {
    const part = files.slice(s * cols * rows, (s + 1) * cols * rows);
    const tiles = await Promise.all(
      part.map(async (f, i) => {
        const img = await sharp(f.path).resize(tw, th).toBuffer();
        const label = Buffer.from(
          `<svg width="${tw}" height="28"><rect width="${tw}" height="28" fill="black" opacity=".7"/><text x="8" y="20" font-size="18" fill="#ffd36b" font-family="sans-serif">${(f.ms / 1000).toFixed(1)}s</text></svg>`,
        );
        const tile = await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer();
        return { input: tile, top: Math.floor(i / cols) * (th + 4), left: (i % cols) * (tw + 4) };
      }),
    );
    await sharp({ create: { width: cols * (tw + 4), height: rows * (th + 4), channels: 3, background: '#222' } })
      .composite(tiles)
      .png()
      .toFile(join(dir, `${name}-sheet-${String(s + 1).padStart(2, '0')}.png`));
  }
}

async function run(browser: Browser, url: string, name: keyof typeof DEVICES): Promise<void> {
  const ctx = await browser.newContext({ ...DEVICES[name] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error`, e.message));
  await fakePlatform(page);
  await page.addInitScript(([auto, size]) => localStorage.setItem('texas.settings', JSON.stringify({ autoNext: auto, mode: 'fun', size })), [AUTO, SIZE] as const);
  await page.goto(url);
  await page.locator('.lobby .start').waitFor();
  const fun = page.locator('.lobby .mode', { hasText: '娱乐' });
  if (await fun.isVisible().catch(() => false)) await fun.click();
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const files: { path: string; ms: number }[] = [];
  let logged = -1;
  let loggedAt = 0;
  const holes = new Map<number, Card[][]>();
  const shoot = async () => {
    const path = join(dir, `f${String(files.length + 1).padStart(4, '0')}.png`);
    await page.screenshot({ path, scale: 'css' });
    files.push({ path, ms: Date.now() - t0 });
    // 电脑说话、亮诈唬是随机的：拍到了报一声，好挑出来看
    const said = await page.locator('.speech').allTextContents();
    const bluff = await page.locator('.seat .hand', { hasText: '诈唬' }).count();
    if (said.length || bluff) console.log(`[${name}] ${path}: ${said.join(' / ')}${bluff ? ' 诈唬' : ''}`);
    if (JOURNAL) {
      const t = (JSON.parse((await page.evaluate(() => localStorage.getItem('texas.session'))) ?? 'null') as { table: Table } | null)?.table;
      if (t && !t.hold && t.seats.some((x) => x.hole.length)) holes.set(t.handNo, t.seats.map((x) => x.hole));
      if (t?.hold && t.lastHand && t.lastHand.handNo !== logged) {
        logged = t.lastHand.handNo;
        // 两手之间隔了多久（含发牌、电脑想、动画、自动下一手的倒计时）：看节奏
        const now = Date.now();
        console.log(`${journal(t, holes.get(logged) ?? [])}\n  用时 ${loggedAt ? ((now - loggedAt) / 1000).toFixed(1) : '-'} 秒`);
        loggedAt = now;
      }
    }
  };
  await page.locator('.lobby .start').click();
  // 新手提示：拍一张再关，看第一手是不是关了提示才发
  for (let i = 0; i < 6; i++) {
    await shoot();
    const d = page.locator('.dialog .d-btn.primary');
    if (await d.isVisible().catch(() => false)) await d.click();
    await page.waitForTimeout(EVERY);
  }
  await autoplay(page, t0 + SECS * 1000, shoot, dir);
  if (READ) {
    const seats = page.locator('.seat.house .avatar');
    for (let i = 0; i < (await seats.count()); i++) {
      await seats.nth(i).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, `read-${i}.png`), scale: 'css' });
    }
  }
  const vp = DEVICES[name].viewport;
  await sheets(OUT, files, name, vp.width, vp.height);
  console.log(`[${name}] ${files.length} frames → ${dir}`);
  await ctx.close();
}

const vite = await startVite();
const browser = await chromium.launch({ args: ['--no-zygote', '--disable-gpu'] });
try {
  for (const d of DEVICE === 'both' ? (['desk', 'phone'] as const) : [DEVICE as keyof typeof DEVICES]) await run(browser, vite.url, d);
} finally {
  await browser.close();
  vite.stop();
}
console.log(`sheets in ${OUT}`);
