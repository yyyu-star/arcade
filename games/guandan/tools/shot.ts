/**
 * 无头浏览器冒烟 + 截图：起 vite（127.0.0.1，端口系统分配）→ Chromium → 逐个画面截图到 shots/（或 --out 指定的目录）。
 *
 *   node tools/shot.ts                 冒烟：标题页 → 开始 → 新手引导 → 真实鼠标出一手 → 电脑代打打完一副 → 结算 → 下一副进贡/还贡
 *                                      → 规则页三页 → 设置 → 战绩 → 打 A 直到整局结束（胜负页）→ 手机横屏 844×390 点牌 → 竖屏提示
 *                                      → 大屏 1920×1080；任何 console error / pageerror / 超时 / 断言失败都以非零码退出
 *   node tools/shot.ts --playtest      真实速度（动画开、1 倍速）、真实鼠标从标题页玩一副：每次轮到我先点"提示"再点"出牌"，
 *                                      压不过就点"不要"；进贡/还贡点牌再点按钮；报告用时和点击次数
 *   node tools/shot.ts --gallery      三种尺寸（1280×720、1920×1080、844×390）× 全部画面的图集，美术改版前后对比用；走不到的画面记进说明
 *   node tools/shot.ts --look "<query>" [宽x高] [名字]   只开一个页面截一张（调试画面用），例如 --look "seed=a&debug=1" 844x390
 *
 * 特定局面（我要进贡 / 我要还贡）先在 node 里用核心推演找到种子，再用 URL 参数 jump=tribute 交给画面。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContextOptions, type Page, type Route } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { createGame, dispatch, viewFor } from '../src/core/index.ts';
import { decide } from '../src/ai/index.ts';
import { jumpToTribute } from '../src/debug/jump.ts';

// 默认让系统分配端口（模块登记的 5174/4174 常年被 dev、preview 占着）；GD_SHOT_PORT 可以指定
const PORT = Number(process.env.GD_SHOT_PORT ?? 0);
let BASE = '';
const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  const dir = i > 0 ? process.argv[i + 1] : undefined;
  if (!dir) return `${process.cwd()}/shots`;
  return dir.startsWith('/') ? dir : `${process.cwd()}/${dir}`;
})();
const WAIT_MS = 90_000;

const errors: string[] = [];
const shots: string[] = [];
const notes: string[] = [];

interface Ctx {
  page: Page;
  name: string;
}

interface OpenOpts {
  w?: number;
  h?: number;
  dpr?: number;
  touch?: boolean;
  /** 新手引导：true = 没看过（会弹出）；默认已看过 */
  freshTutorial?: boolean;
  storage?: Record<string, string>;
  /** 竖屏页面不等 ready（画面被提示挡住也照样启动，只是不截牌桌） */
  noWait?: boolean;
  /** 浏览器自己打的"Failed to load resource"（故意让接口回 4xx/5xx 时）不算报错 */
  allowNetErrors?: boolean;
  /** 带上登录提示 cookie，/api 由这个假平台回答；不给就是没登录（这时发任何 /api 请求都算失败） */
  api?: FakeApi;
  /** screen 尺寸（默认同视口）；iOS Safari 的 screen 和 100vh 比真正看得到的区域大 */
  screen?: { width: number; height: number };
  userAgent?: string;
  /** 页面脚本之前跑的一段（模拟 iOS 工具栏盖住顶上一截等） */
  init?: () => void;
}

/** 假平台接口（形状照 docs/platform-backend.md 15.2、15.3），记下收到的请求 */
interface FakeApi {
  /** ok 正常；offline 回网关错误页（算连不上）；hang 一直不回（同步中）；putTooSoon 写请求一律 429 等 10 分钟（待上传） */
  mode: 'ok' | 'offline' | 'hang' | 'putTooSoon';
  saves: Map<string, { rev: number; data: unknown }>;
  log: { method: string; path: string; xArcade: string | null; type: string | null; body: { baseRev: number; data: unknown; userId?: unknown } | null }[];
}
const fakeApi = (saves: Record<string, { rev: number; data: unknown }> = {}, mode: FakeApi['mode'] = 'ok'): FakeApi => ({ mode, saves: new Map(Object.entries(saves)), log: [] });

async function serveApi(name: string, route: Route, api: FakeApi | undefined): Promise<void> {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const reply = (body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // 启动时问一次有没有平台（kit 的 detectPlatform，0.8.0）：没登录时平台照样回 200 { user: null }，这一个不算"没登录也发请求"
  if (!api && path === '/api/me' && req.method() === 'GET') return reply({ user: null });
  if (!api) {
    errors.push(`[${name}] 没登录也请求了 ${req.method()} ${path}`);
    return reply({ error: 'unauthorized', message: '' }, 401);
  }
  const h = req.headers();
  // 社交（0.13.0，kit 的 social）：登录了就每 2 分钟报位置、每 30 秒问邀请。不记进云存档的请求流水（那边核对先后顺序）
  if (path === '/api/presence' && req.method() === 'POST') {
    if (h['x-arcade'] !== '1') errors.push(`[${name}] 报位置没带 X-Arcade`);
    return route.fulfill({ status: 204 });
  }
  if (path === '/api/invites' && req.method() === 'GET') return reply({ invites: [] });
  // 好友动态的名场面（0.15.0）：一副打完可能报一条
  if (path === '/api/feed' && req.method() === 'POST') {
    if (h['x-arcade'] !== '1') errors.push(`[${name}] 报名场面没带 X-Arcade`);
    return route.fulfill({ status: 204 });
  }
  const body = req.method() === 'PUT' ? (JSON.parse(req.postData() ?? 'null') as { baseRev: number; data: unknown; userId?: unknown }) : null;
  api.log.push({ method: req.method(), path, xArcade: h['x-arcade'] ?? null, type: h['content-type'] ?? null, body });
  if (api.mode === 'hang') return;
  if (api.mode === 'offline') return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>502</html>' });
  if (api.mode === 'putTooSoon' && req.method() === 'PUT') return reply({ error: 'too_soon', message: '', retryAfter: 600 }, 429);
  if (path === '/api/me') return reply({ user: { id: 'u-shot', displayName: '测试' }, service: 'ok', saves: 'ok' });
  if (path === '/api/saves/guandan' && req.method() === 'GET') {
    // 平台 0.7.3：带了 ?userId= 就核对是不是当前会话的账号；游戏应当总是带上
    const want = new URL(req.url()).searchParams.get('userId');
    if (want !== 'u-shot') {
      errors.push(`[${name}] 拉取存档没带对 userId：${want}`);
      return reply({ error: 'wrong_user', message: '' }, 409);
    }
    return reply({ saves: [...api.saves].map(([slot, v]) => ({ slot, rev: v.rev, updatedAt: 1, data: v.data })) });
  }
  const m = /^\/api\/saves\/guandan\/(\w+)$/.exec(path);
  if (m && req.method() === 'PUT' && body) {
    if (h['x-arcade'] !== '1') return reply({ error: 'forbidden', message: '' }, 403);
    // 平台 0.7.1：带了 userId 就核对是不是当前会话的账号
    if ('userId' in body && body.userId !== 'u-shot') return reply({ error: 'wrong_user', message: '' }, 409);
    const cur = api.saves.get(m[1]!) ?? null;
    if ((cur?.rev ?? 0) !== body.baseRev) return reply({ error: 'conflict', message: '', current: cur && { ...cur, updatedAt: 1 } }, 409);
    const next = { rev: (cur?.rev ?? 0) + 1, data: body.data };
    api.saves.set(m[1]!, next);
    return reply({ rev: next.rev, updatedAt: 2 });
  }
  return reply({ error: 'not_found', message: '' }, 404);
}

async function open(browser: Browser, name: string, query: string, o: OpenOpts = {}): Promise<Ctx> {
  const w = o.w ?? 1280;
  const h = o.h ?? 720;
  const co: BrowserContextOptions = { viewport: { width: w, height: h }, screen: o.screen ?? { width: w, height: h }, deviceScaleFactor: o.dpr ?? 1 };
  if (o.touch) Object.assign(co, { hasTouch: true, isMobile: true });
  if (o.userAgent) co.userAgent = o.userAgent;
  const context = await browser.newContext(co);
  if (o.init) await context.addInitScript(o.init);
  const storage: Record<string, string> = { ...(o.storage ?? {}) };
  if (!o.freshTutorial) storage['guandan.tutorial'] = JSON.stringify({ v: 1, done: true });
  await context.addInitScript((kv) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, storage);
  // 平台的登录提示 cookie（脚本能读的那个）；localhost 下浏览器也收 Secure cookie
  if (o.api) await context.addInitScript(() => (document.cookie = '__Host-arcade_li=1; Path=/; Secure; SameSite=Lax'));
  await context.route('**/api/**', (r) => serveApi(name, r, o.api));
  // 平台首页（回大厅）：只看地址对不对，不加载平台页面。游戏自己总是带着 ?查询参数 打开，不会被这条拦到
  await context.route((u) => u.pathname === '/' && u.search === '', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>大厅</title>' }));
  await context.route('**/login?*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>登录</title>' }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !(o.allowNetErrors && msg.text().startsWith('Failed to load resource'))) errors.push(`[${name}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${name}] pageerror: ${err.message}`));
  await page.goto(`${BASE}?${query}`);
  const ctx = { page, name };
  if (!o.noWait) await until(ctx, '启动', 'g.ready');
  return ctx;
}

async function until(ctx: Ctx, what: string, cond: string, timeout = WAIT_MS): Promise<void> {
  try {
    await ctx.page.waitForFunction(`(() => { const g = window.__game; return !!g && (${cond}); })()`, null, { timeout, polling: 50 });
  } catch {
    const info = await ctx.page.evaluate(() => {
      const g = window.__game;
      return g ? { scene: g.scene, idle: g.idle, overlay: g.overlay, phase: g.state()?.phase, tut: g.tutorialStep, err: g.lastError, fx: g.fxLog.slice(-3) } : null;
    });
    // 超时时留一张当时的画面，查偶发的失败不用再复现
    await ctx.page.screenshot({ path: `${OUT}/fail-${ctx.name}.png` }).catch(() => {});
    throw new Error(`[${ctx.name}] 等待超时：${what}（${JSON.stringify(info)}）`);
  }
}

/** 等跳到平台首页 `/`（回大厅） */
async function toLobby(ctx: Ctx, what: string): Promise<void> {
  try {
    await ctx.page.waitForURL((u) => u.pathname === '/' && u.search === '', { timeout: 5000 });
  } catch {
    throw new Error(`[${ctx.name}] ${what}：没有跳到大厅（现在是 ${ctx.page.url()}）`);
  }
}

/**
 * 点按区域（0.9.0）：互相压着的一律算错；strict 时（电脑上）每个都要至少 44 CSS 像素见方。
 * 手机横屏有几处排不开（顶栏贴着上沿、16:9 的窄屏），只记数不算错，PR 和 CHANGELOG 里写明是哪几个。
 */
async function checkHits(ctx: Ctx, where: string, strict: boolean): Promise<void> {
  const hits = await ctx.page.evaluate(() => window.__game!.hits());
  const small = hits.filter((h) => h.w < 43.5 || h.h < 43.5);
  let over = 0;
  for (let i = 0; i < hits.length; i++)
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i]!;
      const b = hits[j]!;
      if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1) over++;
    }
  assert(over === 0, `[${ctx.name}] ${where}：点按区域互相压着 ${over} 处`);
  if (strict) assert(small.length === 0, `[${ctx.name}] ${where}：点按区域小于 44 CSS 像素 ${small.length} 个`);
  else if (small.length) notes.push(`${ctx.name} ${where}：点按区域小于 44 CSS 像素 ${small.length} 个（${small.map((h) => `${Math.round(h.w)}×${Math.round(h.h)}`).join('、')}）`);
}

async function shot(ctx: Ctx, file: string): Promise<void> {
  await ctx.page.waitForTimeout(250);
  const path = `${OUT}/${file}.png`;
  await ctx.page.screenshot({ path });
  shots.push(path);
  if (AUDIT) await auditShot(ctx, file);
}

/**
 * 手机审计（--audit，和 --gallery 一起用）：每张截图顺带量一遍，按页面 CSS 像素记下
 * 字 < 12px（纯数字 < 14px）、点按区域 < 44×44 的；画布里的读调试桥 texts()/hits()，DOM 的读计算样式。最后汇总进 audit.md
 */
const AUDIT = process.argv.includes('--audit');
const audits: string[] = [];
async function auditShot(ctx: Ctx, file: string): Promise<void> {
  const r = await ctx.page.evaluate(() => {
    const g = window.__game;
    const canvasTexts = g ? g.texts() : [];
    const canvasHits = g ? g.hits() : [];
    const domTexts: { s: string; px: number }[] = [];
    const domHits: { s: string; w: number; h: number }[] = [];
    const vis = (e: Element): boolean => {
      const st = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.05 && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight;
    };
    for (const e of Array.from(document.body.querySelectorAll('*'))) {
      if (e.closest('canvas, svg, script, style') || !vis(e)) continue;
      const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
      if (own) domTexts.push({ s: own.slice(0, 24), px: parseFloat(getComputedStyle(e).fontSize) });
      if (e.matches('button, a[href], input, [role=button]')) {
        const b = e.getBoundingClientRect();
        domHits.push({ s: (e.textContent ?? e.getAttribute('aria-label') ?? e.id).trim().slice(0, 16), w: Math.round(b.width), h: Math.round(b.height) });
      }
    }
    return { canvasTexts, canvasHits, domTexts, domHits };
  });
  const num = (t: string): boolean => /^[\d\s×+\-.:/%（）()]+$/.test(t);
  const small = [...r.canvasTexts, ...r.domTexts].filter((t) => t.px < (num(t.s) ? 14 : 12));
  const tiny = [
    ...r.canvasHits.map((h) => ({ s: h.kind, w: Math.round(h.w), h: Math.round(h.h) })),
    ...r.domHits,
  ].filter((h) => h.w < 44 || h.h < 44);
  const minText = Math.min(...[...r.canvasTexts, ...r.domTexts].map((t) => t.px), Infinity);
  const lines = [`### ${file}`, `- 最小字 ${minText === Infinity ? '—' : `${minText}px`}；字太小 ${small.length} 处；点按区域不到 44 的 ${tiny.length} 处`];
  // 同一句字只列一次（按字号最小的那次）
  const seen = new Map<string, number>();
  for (const t of small) seen.set(t.s, Math.min(seen.get(t.s) ?? Infinity, t.px));
  for (const [t, px] of [...seen].sort((a, b) => a[1] - b[1]).slice(0, 12)) lines.push(`  - 字 ${px}px：${t}`);
  for (const h of tiny.slice(0, 12)) lines.push(`  - 点按 ${h.w}×${h.h}：${h.s}`);
  audits.push(lines.join('\n'));
}

async function controls(ctx: Ctx): Promise<Record<string, { x: number; y: number; enabled?: boolean; visible?: boolean }>> {
  return ctx.page.evaluate(() => window.__game!.controls());
}

async function click(ctx: Ctx, key: string, touch = false): Promise<void> {
  const c = (await controls(ctx))[key];
  if (!c) throw new Error(`[${ctx.name}] 找不到控件 ${key}`);
  if (touch) await ctx.page.touchscreen.tap(c.x, c.y);
  else await ctx.page.mouse.click(c.x, c.y);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

/** 用核心推演找"第二副开局我要进贡 / 我要还贡"的种子。 */
function findSeed(kind: 'tribute' | 'return'): string {
  for (let i = 0; i < 200; i++) {
    const seed = `shot-${kind}-${i}`;
    let { state } = jumpToTribute(seed);
    if (state.seed !== seed) continue;
    if (kind === 'tribute') {
      if (viewFor(state, 0).myTribute?.kind === 'tribute') return seed;
      continue;
    }
    // 电脑先交完贡，看是不是轮到我还贡
    let guard = 0;
    while (state.phase === 'tribute' && guard++ < 4) {
      const seat = state.tribute!.entries.find((e) => e.card === null)!.from;
      if (seat === 0) break;
      const a = decide(viewFor(state, seat), { seed: 'x', difficulty: 'normal' })!;
      state = dispatch(state, a).state;
    }
    if (state.phase === 'return' && viewFor(state, 0).myTribute?.kind === 'return') return seed;
  }
  throw new Error(`找不到 ${kind} 种子`);
}

// ───────────────────────── 冒烟 ─────────────────────────

async function smokeDesktop(browser: Browser): Promise<void> {
  // 云端已有别的设备上的战绩：打开后要合并进本机
  const remoteStats = { v: 1, games: 3, wins: 2, streak: 1, bestStreak: 2, deals: 20, firsts: 6, dealWins: 11 };
  const api = fakeApi({ stats: { rev: 4, data: remoteStats } });
  // 本机登录前也玩过（副数比云端多）：两边各有大的，合并后都要保留
  const localStats = { v: 1, games: 1, wins: 0, streak: 0, bestStreak: 0, deals: 30, firsts: 2, dealWins: 4 };
  const ctx = await open(browser, '电脑', 'debug=1', { freshTutorial: true, api, storage: { 'guandan.stats': JSON.stringify(localStats) } });
  const { page } = ctx;
  await until(ctx, '标题页', "g.scene === 'title'");
  await until(ctx, '云存档合并完', "g.cloud()?.status === 'merged'", 10_000);
  const merged = JSON.parse((await page.evaluate(() => localStorage.getItem('guandan.stats'))) ?? 'null');
  assert(merged?.games === 3 && merged?.deals === 30 && merged?.firsts === 6, '云端战绩和本机的合并（每项取大）');
  assert(await page.evaluate(() => localStorage.getItem('guandan.stats.pre-sync') !== null), '合并前备份本机战绩');
  // 最前面可能多一个启动时问有没有平台的 /api/me（0.8.0）；拉存档之前紧挨着的一定是云存档自己问的 /api/me
  const pull = api.log.findIndex((l) => l.method === 'GET' && l.path === '/api/saves/guandan');
  assert(pull > 0 && api.log[pull - 1]!.path === '/api/me' && api.log.slice(0, pull).every((l) => l.path === '/api/me'), '先问 /api/me 再拉存档');
  await page.waitForTimeout(900);
  await shot(ctx, '01-title');
  await checkHits(ctx, '标题页', true);
  const ctl0 = await controls(ctx);
  // 主页的模式卡（art-v3）：娱乐、实盘、好友房都在主页上；新账号的战绩条是空状态那句
  assert(['quick', 'fun', 'stake', 'online', 'rules', 'settings', 'stats'].every((k) => k in (ctl0 ?? {})), '主页有快速开始、三张模式卡和右上角三个图标');
  await click(ctx, 'fun');
  // 娱乐再选难度（0.12.1：新手 / 普通 / 高手，第一次默认新手）
  await until(ctx, '选难度', "'level:novice' in g.controls() && 'level:pro' in g.controls()");
  await page.waitForTimeout(300);
  await shot(ctx, '01c-level');
  await click(ctx, 'level:novice');
  await until(ctx, '新手引导', "g.scene === 'table' && g.tutorialStep === 0");
  await page.waitForTimeout(400);
  await shot(ctx, '02-tutorial-patterns');
  for (let i = 1; i <= 3; i++) {
    await click(ctx, 'tutorial:next');
    await until(ctx, `引导第 ${i + 1} 步`, `g.tutorialStep === ${i}`);
    await page.waitForTimeout(300);
    await shot(ctx, `03-tutorial-${i}`);
  }
  await click(ctx, 'tutorial:next');
  await until(ctx, '引导结束', 'g.tutorialStep === -1');
  const done = await page.evaluate(() => localStorage.getItem('guandan.tutorial'));
  assert(done && JSON.parse(done).done === true, '引导看完要记下来');

  // 真实鼠标：等轮到我，点提示 → 出牌
  await until(ctx, '轮到我', "g.idle && g.view().toAct.includes(0) && g.overlay === null");
  await shot(ctx, '04-table-myturn');
  await click(ctx, 'hint');
  await page.waitForTimeout(300);
  let sel = await page.evaluate(() => window.__game!.selected().length);
  // 第一下提示可能是"建议不要"（不选牌）；那样再点一下才轮到能压的牌
  if (sel === 0) {
    const advised = await page.evaluate(() => window.__game!.fxLog.at(-1) === '建议不要');
    assert(advised, '点提示后要选中牌，或者提示建议不要');
    await click(ctx, 'hint');
    await page.waitForTimeout(300);
    sel = await page.evaluate(() => window.__game!.selected().length);
  }
  assert(sel > 0, '提示要能给出能出的牌');
  await shot(ctx, '05-table-hint');
  const before = await page.evaluate(() => window.__game!.view()!.hand.length);
  await click(ctx, 'play');
  await until(ctx, '出牌生效', `g.view().hand.length < ${before}`);
  await page.waitForTimeout(500);
  await shot(ctx, '06-table-played');

  // 单机互动（0.7.1；0.11.0 按 docs/table-fun.md）：点阿强的头像扔个番茄，看到播出来；电脑回不回、怎么回按性格（随机），只记下来
  await click(ctx, 'fun:seat3');
  await until(ctx, '头像菜单', "'fun:prop0' in g.controls()");
  await click(ctx, 'fun:prop0');
  await until(ctx, '番茄扔出去', "g.fxLog.includes('道具 0>3:tomato')");
  await page.waitForTimeout(1800);
  await shot(ctx, '06b-solo-fun');
  const reply = (await page.evaluate(() => window.__game!.fxLog)).filter((x) => /^(道具 3>|电脑 3:|表情 3:|短语 3:)/.test(x));
  notes.push(`单机互动：对阿强扔番茄，他${reply.length ? `回了 ${reply.join('、')}` : '装没看见'}`);
  // 点自己的头像发表情（0.11.0，docs/table-fun.md 第 1 节）
  await click(ctx, 'fun:seat0');
  await until(ctx, '表情面板', "'fun:sticker0' in g.controls()");
  await click(ctx, 'fun:sticker0');
  await until(ctx, '表情发出去', "g.fxLog.includes('表情 0:smug')");

  // 点一张牌再点一次：选中又取消
  await until(ctx, '再次轮到我', "g.idle && g.view().toAct.includes(0) && g.overlay === null");
  const card = await page.evaluate(() => window.__game!.view()!.hand[3]!);
  const pt = await page.evaluate((c) => window.__game!.cardPoint(c), card);
  assert(pt, '能拿到牌的位置');
  await page.mouse.click(pt!.x, pt!.y);
  assert((await page.evaluate(() => window.__game!.selected())).includes(card), '点牌后选中');
  // 选中的牌用 140 毫秒动画抬高 24 像素：等抬完再点抬高后的位置，不然偶尔点空（以前冒烟时有时失败就是这个原因）
  await page.waitForTimeout(400);
  await page.mouse.click(pt!.x, pt!.y - 24);
  assert(!(await page.evaluate(() => window.__game!.selected())).includes(card), '再点取消');
  // 上一墩：收过一墩才能点；看完点"看好了"回到牌桌
  if ((await controls(ctx))['prev']?.enabled) {
    await click(ctx, 'prev');
    await until(ctx, '上一墩', "g.overlay === 'menu'");
    await page.waitForTimeout(400);
    await shot(ctx, '06b-prev-trick');
    await click(ctx, 'ok');
    await until(ctx, '看完上一墩', 'g.overlay === null');
  }

  // 电脑代打打完这一副（关掉动画）
  await page.evaluate(() => {
    window.__game!.setInstant(true);
    window.__game!.setAutoplay(true);
  });
  await until(ctx, '一副结束', "g.overlay === 'settle' || g.state().phase === 'gameOver'");
  await page.evaluate(() => window.__game!.setAutoplay(false));
  // 托管会自动进下一副：截图前先关掉托管，等结算框停住
  await page.evaluate(() => window.__game!.setInstant(false));
  if ((await page.evaluate(() => window.__game!.state()!.phase)) === 'dealEnd') {
    await until(ctx, '结算框', "g.overlay === 'settle'");
    await page.waitForTimeout(1500);
    await shot(ctx, '07-settle');
    const fx = await page.evaluate(() => window.__game!.fxLog);
    assert(fx.includes('头游'), '一副里要有头游印章');
    // 结算框盖着顶栏的"大厅"：框里的"回大厅"先确认，点"算了"回到结算（0.11.1）
    await click(ctx, 'settleLobby');
    await until(ctx, '结算上的回大厅确认框', "'cancel' in g.controls()", 5000);
    await page.waitForTimeout(300);
    await click(ctx, 'cancel');
    await until(ctx, '点算了回到结算', "!('cancel' in g.controls()) && g.overlay === 'settle'", 5000);
    assert(new URL(page.url()).search !== '', '点算了不离开');
    await click(ctx, 'next');
    await until(ctx, '第二副开始', 'g.state().dealNo === 2');
    await page.waitForTimeout(1600);
    await shot(ctx, '08-deal2-start');
    await until(ctx, '第二副进贡/抗贡处理完', "g.idle && (g.state().phase === 'play' || g.view().toAct.includes(0))");
    const fx2 = await page.evaluate(() => window.__game!.fxLog);
    assert(fx2.includes('进贡') || fx2.includes('抗贡'), '第二副要有进贡或抗贡');
  }
  // 存档：刷新后能继续
  const saved = await page.evaluate(() => localStorage.getItem('guandan.save'));
  assert(saved && JSON.parse(saved).state.dealNo >= 1, '有存档');
  await page.reload();
  await until(ctx, '刷新后标题页', "g.ready && g.scene === 'title'");
  await page.waitForTimeout(900);
  assert((await controls(ctx))['continue'], '刷新后有"继续"');
  await click(ctx, 'continue');
  await until(ctx, '继续进牌桌', "g.scene === 'table' && g.idle");
  await page.waitForTimeout(500);
  await shot(ctx, '09-continued');

  // 设置、规则（三页）、战绩
  await checkHits(ctx, '牌桌', true);
  await page.evaluate(() => window.__game!.open('settings'));
  await page.waitForTimeout(500);
  await shot(ctx, '10-settings');
  await checkHits(ctx, '设置', true);
  await page.evaluate(() => window.__game!.closeOverlay());
  await page.evaluate(() => window.__game!.open('rules'));
  await page.waitForTimeout(500);
  await shot(ctx, '11-rules-patterns');
  for (const [i, n] of [[1, 'order'], [2, 'flow']] as const) {
    const p = await page.evaluate((k) => window.__game!.toScreen({ x: 1280 / 2 - 170 + k * 170, y: 360 + 10 - 248 }), i);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
    await shot(ctx, `12-rules-${n}`);
  }
  await page.evaluate(() => window.__game!.closeOverlay());
  await page.evaluate(() => window.__game!.toTitle());
  await until(ctx, '回标题页', "g.scene === 'title'");
  await page.waitForTimeout(700);
  await click(ctx, 'stats');
  await page.waitForTimeout(500);
  await shot(ctx, '13-stats');
  // 键盘（0.9.0）：Esc 关弹窗；Tab 走到"设置"、回车打开、Esc 再关上。弹窗开着时整屏遮罩在，hits() 只剩弹窗里的
  const titleHits = (await page.evaluate(() => window.__game!.hits())).length;
  await page.keyboard.press('Escape');
  await until(ctx, 'Esc 关掉战绩', `g.hits().length > ${titleHits}`, 5000);
  const target = (await controls(ctx))['settings']!;
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => window.__game!.focused());
    found = !!f && Math.abs(f.x - target.x) < 8 && Math.abs(f.y - target.y) < 8;
  }
  assert(found, 'Tab 能走到"设置"');
  await page.waitForTimeout(200);
  await shot(ctx, '13b-keyboard-focus');
  const onTitle = (await page.evaluate(() => window.__game!.hits())).length;
  await page.keyboard.press('Enter');
  await until(ctx, '回车打开设置', `g.hits().length > ${onTitle + 10}`, 5000);
  await page.keyboard.press('Escape');
  await until(ctx, 'Esc 关掉设置', `g.hits().length === ${onTitle}`, 5000);
  notes.push('键盘：Tab 走到"设置"、回车打开、Esc 关上');

  // 云存档：教程标记和打完一副后的战绩都传上去了，写请求带 X-Arcade
  await until(ctx, '云存档传完', "g.cloud()?.status === 'synced'", 30_000);
  const puts = api.log.filter((l) => l.method === 'PUT');
  assert(puts.length > 0 && puts.every((l) => l.xArcade === '1' && l.type === 'application/json' && l.body?.userId === 'u-shot'), '写请求带 X-Arcade: 1、JSON 类型和 /api/me 给的 userId');
  const up = api.saves.get('stats')?.data as { deals: number; games: number } | undefined;
  assert(up && up.deals > 30 && up.games >= 3, '打完一副后的战绩传到云端');
  assert((api.saves.get('tutorial')?.data as { done?: boolean } | undefined)?.done === true, '看完引导的标记传到云端');
  notes.push(`云存档：${api.log.map((l) => `${l.method} ${l.path.replace('/api/', '')}`).join('，')}`);

  // 标题页不在对局中：点"大厅"直接去平台首页
  // 重新进标题页，顺带关掉战绩面板
  await page.evaluate(() => window.__game!.toTitle());
  await until(ctx, '回标题页', "g.scene === 'title'");
  await page.waitForTimeout(700);
  await click(ctx, 'lobby');
  await toLobby(ctx, '标题页点大厅');
  await ctx.page.context().close();
}

async function smokeTribute(browser: Browser): Promise<void> {
  for (const kind of ['tribute', 'return'] as const) {
    const seed = findSeed(kind);
    notes.push(`${kind} 种子：${seed}`);
    const ctx = await open(browser, kind === 'tribute' ? '进贡' : '还贡', `seed=${seed}&jump=tribute&debug=1`);
    const { page } = ctx;
    await until(ctx, `轮到我${kind === 'tribute' ? '进贡' : '还贡'}`, `g.idle && g.overlay === null && g.view().myTribute && g.view().myTribute.kind === '${kind}'`);
    await page.waitForTimeout(400);
    const allowed = await page.evaluate(() => window.__game!.view()!.myTribute!.allowed);
    const pt = await page.evaluate((c) => window.__game!.cardPoint(c), allowed[0]!);
    await page.mouse.click(pt!.x, pt!.y);
    await page.waitForTimeout(250);
    await shot(ctx, kind === 'tribute' ? '14-tribute' : '15-return');
    const c = (await controls(ctx))['play']!;
    assert(c.enabled, '选了贡牌按钮可点');
    await page.mouse.click(c.x, c.y);
    // 截贡牌飞到桌心的一刻
    await page.waitForTimeout(700);
    await shot(ctx, kind === 'tribute' ? '14b-tribute-fly' : '15b-return-fly');
    await until(ctx, '进贡后', `g.view().myTribute === null || g.view().myTribute.kind !== '${kind}'`);
    await page.context().close();
  }
}

async function smokeGameOver(browser: Browser): Promise<void> {
  const ctx = await open(browser, '打A', 'seed=ace1&jump=ace&debug=1&anim=0&autoplay=1');
  await until(ctx, '整局结束', "g.overlay === 'gameOver'", 240_000);
  await ctx.page.evaluate(() => window.__game!.setInstant(false));
  await ctx.page.waitForTimeout(1200);
  await shot(ctx, '16-gameover');
  // 分享（kit 0.15.0 起卡的右下角带二维码）：无头浏览器没有系统分享，出预览层；预览里的那张卡原样存下来看码
  await click(ctx, 'share');
  const card = await ctx.page.waitForFunction(async () => {
    const img = document.querySelector<HTMLImageElement>('#arcade-share-preview img');
    if (!img?.complete || !img.naturalWidth) return null;
    const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    return { w: img.naturalWidth, h: img.naturalHeight, bytes: Array.from(bytes), tip: document.querySelector('#arcade-share-preview div')?.textContent ?? '' };
  }, undefined, { timeout: WAIT_MS });
  const got = (await card.jsonValue())!;
  assert(got.w === 1080 && got.h === 1350, `分享卡 1080×1350，实际 ${got.w}×${got.h}`);
  writeFileSync(`${OUT}/16b-share-card.png`, Uint8Array.from(got.bytes));
  shots.push(`${OUT}/16b-share-card.png`);
  await shot(ctx, '16c-share-preview');
  await ctx.page.locator('[data-key="share:close"]').click();
  const deals = await ctx.page.evaluate(() => window.__game!.state()!.dealNo);
  notes.push(`打 A 到整局结束用了 ${deals} 副`);
  await ctx.page.context().close();
}

async function smokeBomb(browser: Browser): Promise<void> {
  // 一副自动打下去，截第一次出现炸弹的瞬间
  const ctx = await open(browser, '炸弹', 'seed=bomb7&debug=1&autoplay=1&speed=1.5');
  const { page } = ctx;
  try {
    await until(ctx, '出现炸弹', "g.fxLog.some((x) => x.startsWith('炸弹') || x === '同花顺' || x === '天王炸')", 150_000);
    await page.waitForTimeout(250);
    await shot(ctx, '17-bomb');
  } catch {
    notes.push('炸弹：这一副没人出炸弹（不算失败）');
  }
  await page.context().close();
}

async function smokeMobile(browser: Browser): Promise<void> {
  const ctx = await open(browser, '手机横屏', 'seed=m1&debug=1', { w: 844, h: 390, dpr: 3, touch: true });
  const { page } = ctx;
  await until(ctx, '轮到我（手机）', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 120_000);
  await page.waitForTimeout(300);
  await shot(ctx, '20-mobile-table');
  await checkHits(ctx, '牌桌', false);
  // 逐张点手牌，确认每张都能点中（点中 = 选中集合里多了这张）
  const hand = await page.evaluate(() => window.__game!.view()!.hand);
  let hits = 0;
  for (const c of hand) {
    const pt = await page.evaluate((x) => window.__game!.cardPoint(x), c);
    if (!pt) continue;
    await page.touchscreen.tap(pt.x, pt.y);
    const on = (await page.evaluate(() => window.__game!.selected())).includes(c);
    if (on) hits++;
    await page.touchscreen.tap(pt.x, pt.y - 13 * (390 / 720));
  }
  notes.push(`手机横屏点牌命中 ${hits}/${hand.length}`);
  assert(hits === hand.length, `手机横屏每张牌都要点得中（${hits}/${hand.length}）`);
  await click(ctx, 'hint', true);
  await page.waitForTimeout(300);
  await shot(ctx, '21-mobile-hint');
  await page.evaluate(() => window.__game!.open('rules'));
  await page.waitForTimeout(500);
  await shot(ctx, '22-mobile-rules');
  await page.evaluate(() => window.__game!.closeOverlay());
  await page.waitForTimeout(300);
  // 打到一半点"大厅"再点"算了"：确认框关掉、牌桌照常（以前 overlay 停在 menu，人和电脑都不再出牌）
  await click(ctx, 'lobby', true);
  await until(ctx, '回大厅确认框', 'g.overlay === \'menu\'', 5000);
  await page.waitForTimeout(400);
  await click(ctx, 'cancel', true);
  await until(ctx, '点算了后关掉确认框', 'g.overlay === null', 5000);
  assert(new URL(page.url()).search !== '', '点算了不离开');
  await until(ctx, '算了之后还能轮到我', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 60_000);
  const left = await page.evaluate(() => window.__game!.view()!.hand.length);
  await click(ctx, 'hint', true);
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__game!.selected().length)) === 0) {
    await click(ctx, 'hint', true);
    await page.waitForTimeout(300);
  }
  await click(ctx, 'play', true);
  await until(ctx, '算了之后还能出牌', `g.view().hand.length < ${left}`, 10_000);
  // 再点"大厅"，这次确认离开
  await until(ctx, '出完牌后空闲', "g.idle && g.overlay === null", 60_000);
  await click(ctx, 'lobby', true);
  await until(ctx, '回大厅确认框', 'g.overlay === \'menu\'', 5000);
  await page.waitForTimeout(400);
  await shot(ctx, '22b-mobile-lobby-confirm');
  assert(new URL(page.url()).search !== '', '确认之前不能离开');
  await click(ctx, 'ok', true);
  await toLobby(ctx, '牌桌上确认回大厅');
  await page.context().close();

  const t = await open(browser, '手机标题', 'debug=1', { w: 844, h: 390, dpr: 3, touch: true });
  await until(t, '标题页', "g.scene === 'title'");
  await t.page.waitForTimeout(900);
  await shot(t, '23-mobile-title');
  // 没登录：云朵是"未登录"，手指点中就去登录页
  assert((await t.page.evaluate(() => window.__game!.cloud()?.status)) === 'loggedOut', '没登录时云朵显示未登录');
  const toLogin = t.page.waitForURL((u) => u.pathname === '/login' && u.searchParams.get('next')?.startsWith('/') === true, { timeout: 5000 });
  await click(t, 'cloud', true);
  await toLogin;
  await t.page.context().close();

  const p = await open(browser, '竖屏', 'debug=1', { w: 390, h: 844, dpr: 3, touch: true, noWait: true });
  await p.page.waitForTimeout(1200);
  const vis = await p.page.evaluate(() => getComputedStyle(document.getElementById('rotate-hint')!).display);
  assert(vis === 'flex', '竖屏要提示横过来');
  await shot(p, '24-portrait');
  // 竖屏时牌桌被盖住：提示层左上角的"大厅"也要能回平台首页（没有打到一半的存档：直接走）
  await p.page.tap('#rh-lobby');
  await toLobby(p, '竖屏点大厅');
  await p.page.context().close();

  // 有打到一半的存档：先用浏览器自带的确认框问一句；取消就留下，确定才走
  const save = { v: 1, state: createGame('portrait-save').state, difficulty: 'normal', counted: false, dealsCounted: 0 };
  const q = await open(browser, '竖屏有存档', 'debug=1', { w: 390, h: 844, dpr: 3, touch: true, noWait: true, storage: { 'guandan.save': JSON.stringify(save) } });
  await q.page.waitForTimeout(1200);
  const asked: string[] = [];
  let answer = false;
  q.page.on('dialog', (d) => {
    asked.push(d.message());
    void (answer ? d.accept() : d.dismiss());
  });
  await q.page.tap('#rh-lobby');
  await q.page.waitForTimeout(500);
  assert(asked.length === 1 && asked[0]!.includes('继续') && new URL(q.page.url()).search !== '', '竖屏有存档时先确认，取消就不走');
  answer = true;
  await q.page.tap('#rh-lobby');
  await toLobby(q, '竖屏有存档时确认后回大厅');
  await q.page.context().close();
}

/** 云朵五种状态 + 小红点各截一张（标题页右上角），并确认连不上时点云朵只给说明、不去登录页 */
async function smokeCloud(browser: Browser): Promise<void> {
  const played = JSON.stringify({ v: 1, games: 2, wins: 1, streak: 0, bestStreak: 1, deals: 9, firsts: 3, dealWins: 5 });
  const looks: [string, string, OpenOpts][] = [
    ['loggedOut', 'loggedOut', {}],
    ['synced', 'synced', { api: fakeApi() }],
    ['syncing', 'syncing', { api: fakeApi({}, 'hang') }],
    ['pending', 'pending', { api: fakeApi({}, 'putTooSoon'), storage: { 'guandan.stats': played }, allowNetErrors: true }],
    ['merged', 'merged', { api: fakeApi({ stats: { rev: 2, data: { v: 1, games: 5, wins: 4, streak: 2, bestStreak: 3, deals: 1, firsts: 0, dealWins: 0 } } }), storage: { 'guandan.stats': played } }],
    ['offline', 'pending', { api: fakeApi({}, 'offline'), allowNetErrors: true }],
  ];
  for (const [file, status, o] of looks) {
    const t = await open(browser, `云朵-${file}`, 'debug=1', o);
    await until(t, '标题页', "g.scene === 'title'");
    await until(t, `云朵 ${status}`, `g.cloud()?.status === '${status}'`, 10_000);
    await t.page.waitForTimeout(900);
    const c = (await controls(t))['cloud']!;
    const path = `${OUT}/40-cloud-${file}.png`;
    await t.page.screenshot({ path, clip: { x: c.x - 40, y: c.y - 40, width: 80, height: 80 } });
    shots.push(path);
    if (file === 'offline') {
      assert((await t.page.evaluate(() => window.__game!.cloud()?.note)) === 'offline', '连不上时有说明');
      const before = t.page.url();
      await click(t, 'cloud');
      await t.page.waitForTimeout(600);
      assert(t.page.url() === before, '连不上时点云朵不去登录页');
      await shot(t, '41-cloud-offline-tap');
    }
    await t.page.context().close();
  }
}

async function smokeLarge(browser: Browser): Promise<void> {
  const ctx = await open(browser, '大屏', 'seed=big2&debug=1', { w: 1920, h: 1080 });
  await until(ctx, '轮到我（大屏）', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 120_000);
  await ctx.page.evaluate(() => window.__game!.controls());
  await click(ctx, 'hint');
  await ctx.page.waitForTimeout(400);
  await shot(ctx, '30-large-table');
  await ctx.page.context().close();
  const t = await open(browser, '大屏标题', 'debug=1', { w: 1920, h: 1080 });
  await until(t, '标题页', "g.scene === 'title'");
  await t.page.waitForTimeout(900);
  await shot(t, '31-large-title');
  await t.page.context().close();
}

const IOS15 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const VERSION = (JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as { version: string }).version;

/** 页面上的可见矩形里放得下：顶栏按钮（大厅、云朵、右边四个图标）和整块画布 */
async function assertInside(ctx: Ctx, top: number, bottom: number, w: number): Promise<void> {
  const c = await controls(ctx);
  const keys = ['lobby', 'cloud', 'top0', 'top1', 'top2', 'top3'];
  for (const k of keys) {
    const p = c[k];
    assert(p, `[${ctx.name}] 找不到顶栏控件 ${k}`);
    // 按钮半高约 23 世界单位 ×（可见高 / 720）；中心离可见区上沿至少留 8px，才算整颗按钮露在外面
    assert(p!.y >= top + 8 && p!.y <= bottom && p!.x >= 0 && p!.x <= w, `[${ctx.name}] 顶栏控件 ${k} 在 (${p!.x}, ${p!.y})，不在可见区 y∈[${top}, ${bottom}] 内`);
  }
  const r = await ctx.page.evaluate(() => {
    const b = document.querySelector('#app canvas')!.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  });
  assert(r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && r.left >= -0.5 && r.right <= w + 0.5, `[${ctx.name}] 画布 ${JSON.stringify(r)} 超出可见区 y∈[${top}, ${bottom}]`);
}

async function smokeViewport(browser: Browser): Promise<void> {
  // ① 横屏，可见高度比 screen 少 80px（Safari 地址栏 + 标签栏）
  const a = await open(browser, '可见区', 'seed=v1&debug=1&anim=0', {
    w: 844, h: 310, dpr: 3, touch: true, screen: { width: 390, height: 844 }, userAgent: IOS15,
    // visualViewport 的几个读数可以临时改（window.__vv），模拟双指放大
    init: () => {
      const proto = Object.getPrototypeOf(window.visualViewport) as object;
      for (const k of ['scale', 'width', 'height', 'offsetLeft', 'offsetTop']) {
        const get = Object.getOwnPropertyDescriptor(proto, k)!.get!;
        Object.defineProperty(proto, k, {
          get(this: VisualViewport) {
            const o = (window as unknown as { __vv?: Record<string, number> }).__vv;
            return o && k in o ? o[k] : get.call(this);
          },
        });
      }
    },
  });
  await until(a, '牌桌（可见区）', "g.scene === 'table' && g.idle");
  await assertInside(a, 0, 310, 844);
  const scale = await a.page.evaluate(() => window.__game!.renderScale);
  assert(scale === 2, `可见 844×310 × DPR 3 应为 2 倍（实际 ${scale}）`);
  await shot(a, '40-ios-visible-table');
  // 双指放大（scale=2，取景框变小、跟着手指偏移）：不改 #app、不让 Phaser 重新缩放；visualViewport 事件来得再密，尺寸没变也不写
  const box = (): Promise<string> => a.page.evaluate(() => JSON.stringify([document.getElementById('app')!.getBoundingClientRect(), document.querySelector('#app canvas')!.getBoundingClientRect()]));
  const fits0 = await a.page.evaluate(() => window.__game!.fits);
  const box0 = await box();
  await a.page.evaluate(() => {
    (window as unknown as { __vv?: Record<string, number> }).__vv = { scale: 2, width: 422, height: 155, offsetLeft: 120, offsetTop: 60 };
    for (let i = 0; i < 10; i++) for (const t of ['resize', 'scroll']) window.visualViewport!.dispatchEvent(new Event(t));
  });
  await a.page.waitForTimeout(900);
  const zoomed = { fits: await a.page.evaluate(() => window.__game!.fits), box: await box() };
  assert(zoomed.fits === fits0 && zoomed.box === box0, `双指放大时不该改画面尺寸（fits ${fits0} → ${zoomed.fits}）`);
  await a.page.evaluate(() => {
    delete (window as unknown as { __vv?: Record<string, number> }).__vv;
    for (let i = 0; i < 10; i++) for (const t of ['resize', 'scroll']) window.visualViewport!.dispatchEvent(new Event(t));
  });
  await a.page.waitForTimeout(900);
  const back = { fits: await a.page.evaluate(() => window.__game!.fits), box: await box() };
  assert(back.fits === fits0 && back.box === box0, `缩回原样、尺寸没变时不该重写（fits ${fits0} → ${back.fits}）`);
  // WebGL 画面被收回又恢复（2 秒后才恢复）：提示出现后自己收起，不记降档，牌桌照常
  await a.page.evaluate(() => {
    const gl = (document.querySelector('#app canvas') as HTMLCanvasElement).getContext('webgl')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    window.setTimeout(() => ext.restoreContext(), 2600);
  });
  await a.page.waitForTimeout(2300);
  const lostPanel = await a.page.evaluate(() => !!document.getElementById('error-panel'));
  assert(lostPanel, '画面被收回 2 秒还没恢复时应提示');
  await a.page.waitForTimeout(1500);
  const restored = await a.page.evaluate(() => ({ panel: !!document.getElementById('error-panel'), mark: JSON.parse(localStorage.getItem('guandan.boot')!), sel: window.__game!.selected() }));
  assert(!restored.panel && restored.mark.low === 0, `画面恢复后应收起提示、不降档（${JSON.stringify(restored)}）`);
  await until(a, '恢复后还能操作', "g.scene === 'table' && g.idle");
  await a.page.waitForTimeout(400);
  await shot(a, '40c-ios-context-restored');
  // 防崩溃标记：iOS 上开着页面就记 pending=1，档位 0
  const mark = await a.page.evaluate(() => JSON.parse(localStorage.getItem('guandan.boot') ?? 'null'));
  assert(mark?.pending === 1 && mark.low === 0 && mark.ver === VERSION, `开着页面时应记 pending=1（实际 ${JSON.stringify(mark)}）`);
  // "添加到主屏幕"：iOS Safari 的标题页才有，点 ✕ 后记住
  await a.page.evaluate(() => window.__game!.toTitle());
  await until(a, '标题页（可见区）', "g.scene === 'title'");
  await a.page.waitForTimeout(700);
  const hint = await a.page.evaluate(() => {
    const el = document.getElementById('a2hs');
    const r = el?.getBoundingClientRect();
    return el && r ? { on: getComputedStyle(el).display !== 'none', bottom: r.bottom, right: r.right } : null;
  });
  assert(hint?.on && hint.bottom <= 310 && hint.right <= 844, `iOS Safari 标题页应显示"添加到主屏幕"且在可见区内（${JSON.stringify(hint)}）`);
  await shot(a, '41-ios-a2hs');
  await a.page.click('#a2hs button');
  const closed = await a.page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('a2hs')!).display !== 'none', saved: localStorage.getItem('guandan.a2hs') }));
  assert(!closed.shown && closed.saved === '1', `点 ✕ 后应隐藏并记住（${JSON.stringify(closed)}）`);
  await a.page.reload();
  await until(a, '重开后牌桌', "g.scene === 'table' && g.idle");
  await a.page.evaluate(() => window.__game!.toTitle());
  await until(a, '重开后标题页', "g.scene === 'title'");
  const again = await a.page.evaluate(() => {
    const el = document.getElementById('a2hs');
    return !!el && getComputedStyle(el).display !== 'none';
  });
  assert(!again, '关掉过的"添加到主屏幕"重开后不该再出现');
  // 正常离开页面（pagehide）后标记清掉
  const left = await a.page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return JSON.parse(localStorage.getItem('guandan.boot') ?? 'null');
  });
  assert(left?.pending === 0, `pagehide 后应清掉 pending（实际 ${JSON.stringify(left)}）`);
  await a.page.context().close();

  // ② 布局视口 390 高，但工具栏盖住顶上 80px（visualViewport 偏移 80、可见 310）：顶栏要挪到盖不住的地方
  const b = await open(browser, '工具栏遮挡', 'seed=v2&debug=1&anim=0', {
    w: 844, h: 390, dpr: 2, touch: true,
    init: () => {
      const vv = Object.getPrototypeOf(window.visualViewport) as object;
      Object.defineProperty(vv, 'offsetTop', { get: () => 80 });
      Object.defineProperty(vv, 'height', { get: () => 310 });
      Object.defineProperty(window, 'innerHeight', { get: () => 310 });
    },
  });
  await until(b, '牌桌（工具栏遮挡）', "g.scene === 'table' && g.idle");
  await assertInside(b, 80, 390, 844);
  await shot(b, '42-toolbar-covered-table');
  // 不是 iOS：没有"添加到主屏幕"，也不记防崩溃标记
  await b.page.evaluate(() => window.__game!.toTitle());
  await until(b, '标题页（工具栏遮挡）', "g.scene === 'title'");
  const desk = await b.page.evaluate(() => ({ a2hs: !!document.getElementById('a2hs'), boot: localStorage.getItem('guandan.boot') }));
  assert(!desk.a2hs && desk.boot === null, `非 iOS 不该有"添加到主屏幕"和防崩溃标记（${JSON.stringify(desk)}）`);
  await b.page.context().close();

  // 对局中选着一张牌，Safari 地址栏冒出来（iPhone 8 横屏，可见高度少 60px，世界宽度 1280 → 1524）：
  // 只留边缩放，不重建，选着的牌还在；放下牌、空下来也不重建（触屏上只有转屏才重排）
  const f = await open(browser, '地址栏收放', 'seed=v6&debug=1&anim=0', { w: 667, h: 375, dpr: 2, touch: true, screen: { width: 375, height: 667 }, userAgent: IOS15 });
  await until(f, '轮到我（地址栏）', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 120_000);
  const pick = await f.page.evaluate(() => window.__game!.view()!.hand[0]!);
  const pp = await f.page.evaluate((x) => window.__game!.cardPoint(x), pick);
  await f.page.touchscreen.tap(pp!.x, pp!.y);
  assert((await f.page.evaluate(() => window.__game!.selected())).includes(pick), '地址栏：点手牌应选中');
  const builds0 = await f.page.evaluate(() => window.__game!.builds);
  await f.page.setViewportSize({ width: 667, height: 315 });
  await f.page.waitForTimeout(1200);
  const mid = await f.page.evaluate(() => ({ sel: window.__game!.selected(), builds: window.__game!.builds, scene: window.__game!.scene }));
  assert(mid.scene === 'table' && mid.builds === builds0 && mid.sel.includes(pick), `地址栏收放不该重建牌桌、丢选中（${JSON.stringify(mid)}，原 builds ${builds0}）`);
  await assertInside(f, 0, 315, 667);
  await shot(f, '40b-ios-bar-shown');
  const pp2 = await f.page.evaluate((x) => window.__game!.cardPoint(x), pick);
  await f.page.touchscreen.tap(pp2!.x, pp2!.y);
  assert((await f.page.evaluate(() => window.__game!.selected())).length === 0, '地址栏：再点一次应取消选中');
  await f.page.setViewportSize({ width: 667, height: 375 });
  await f.page.waitForTimeout(400);
  await f.page.setViewportSize({ width: 667, height: 315 });
  await f.page.waitForTimeout(1200);
  const idle = await f.page.evaluate(() => ({ sel: window.__game!.selected(), builds: window.__game!.builds }));
  assert(idle.sel.length === 0 && idle.builds === builds0, `触屏上地址栏收放、没选牌时也不该重建（${JSON.stringify(idle)}，原 builds ${builds0}）`);
  // 转屏才重排（竖屏会盖提示层，转回横屏时宽高比变了）
  await f.page.setViewportSize({ width: 375, height: 667 });
  await f.page.waitForTimeout(1200);
  await f.page.setViewportSize({ width: 812, height: 375 });
  await until(f, '转屏后重排', `g.builds > ${builds0} && g.idle`, 10_000);
  await assertInside(f, 0, 375, 812);
  await f.page.context().close();

  // 电脑上调整窗口：选着牌时推迟重排，放下牌后再重排；宽度差不到 40 不重排
  const e = await open(browser, '窗口重排', 'seed=v5&debug=1&anim=0', { w: 1280, h: 720 });
  await until(e, '轮到我（窗口）', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 120_000);
  const ec = await e.page.evaluate(() => window.__game!.view()!.hand[0]!);
  const ep = await e.page.evaluate((x) => window.__game!.cardPoint(x), ec);
  await e.page.mouse.click(ep!.x, ep!.y);
  const eb0 = await e.page.evaluate(() => window.__game!.builds);
  await e.page.setViewportSize({ width: 1600, height: 720 });
  await e.page.waitForTimeout(1200);
  const held = await e.page.evaluate(() => ({ sel: window.__game!.selected(), builds: window.__game!.builds }));
  assert(held.sel.includes(ec) && held.builds === eb0, `选着牌时不该重排（${JSON.stringify(held)}，原 builds ${eb0}）`);
  const ep2 = await e.page.evaluate((x) => window.__game!.cardPoint(x), ec);
  await e.page.mouse.click(ep2!.x, ep2!.y);
  await until(e, '放下牌后重排', `g.builds > ${eb0} && g.idle`, 10_000);
  const eb1 = await e.page.evaluate(() => window.__game!.builds);
  await e.page.setViewportSize({ width: 1620, height: 720 });
  await e.page.waitForTimeout(1200);
  const small = await e.page.evaluate(() => window.__game!.builds);
  assert(small === eb1, `宽度差不到 40 不该重排（builds ${eb1} → ${small}）`);
  await e.page.context().close();

  // ③ 上次开着页面时被杀（pending=1）：这次降到 1 倍渲染
  const boot = (low: number): Record<string, string> => ({ 'guandan.boot': JSON.stringify({ v: 1, pending: 1, low, ver: VERSION }) });
  const c = await open(browser, '崩溃后降档', 'seed=v3&debug=1&anim=0', { w: 736, h: 370, dpr: 3, touch: true, userAgent: IOS15, storage: boot(0) });
  await until(c, '牌桌（降档）', "g.scene === 'table' && g.idle");
  const c1 = await c.page.evaluate(() => ({ scale: window.__game!.renderScale, webgl: window.__game!.memory().webgl, mark: JSON.parse(localStorage.getItem('guandan.boot')!) }));
  assert(c1.scale === 1 && c1.webgl && c1.mark.low === 1 && c1.mark.pending === 1, `崩溃一次后应 1 倍 WebGL、档位 1（${JSON.stringify(c1)}）`);
  await c.page.context().close();

  // ④ 1 倍还被杀：换 Canvas 渲染，照样能打
  const d = await open(browser, 'Canvas 兜底', 'seed=v4&debug=1', { w: 736, h: 370, dpr: 3, touch: true, userAgent: IOS15, storage: boot(1) });
  await until(d, '轮到我（Canvas）', "g.idle && g.view().toAct.includes(0) && g.overlay === null", 120_000);
  const d1 = await d.page.evaluate(() => ({ scale: window.__game!.renderScale, webgl: window.__game!.memory().webgl }));
  assert(d1.scale === 1 && !d1.webgl, `再崩一次应换 Canvas 渲染（${JSON.stringify(d1)}）`);
  // 点一张手牌能选中（Canvas 下点选判定照常）
  const first = await d.page.evaluate(() => window.__game!.view()!.hand[0]!);
  const fp = await d.page.evaluate((x) => window.__game!.cardPoint(x), first);
  await d.page.touchscreen.tap(fp!.x, fp!.y);
  assert((await d.page.evaluate(() => window.__game!.selected())).includes(first), 'Canvas 渲染下点手牌应能选中');
  await d.page.touchscreen.tap(fp!.x, fp!.y - 13 * (370 / 720));
  await d.page.waitForTimeout(400);
  // 接牌就点"不要"，领出就提示 + 出牌；轮转到下家才算这一步走通
  const canPass = (await controls(d))['pass']?.enabled;
  if (canPass) await click(d, 'pass', true);
  else {
    await click(d, 'hint', true);
    await d.page.waitForTimeout(300);
    await click(d, 'play', true);
  }
  await until(d, 'Canvas 下走一步', '!g.view().toAct.includes(0)', 10_000);
  await shot(d, '43-canvas-fallback');
  await d.page.context().close();
}

// ───────────────────────── 试玩（真实速度 + 真实鼠标） ─────────────────────────

async function playtest(browser: Browser): Promise<void> {
  const ctx = await open(browser, '试玩', 'debug=1', { freshTutorial: true });
  const { page } = ctx;
  const t0 = Date.now();
  let clicks = 0;
  const press = async (key: string): Promise<void> => {
    await click(ctx, key);
    clicks++;
  };
  await until(ctx, '标题页', "g.scene === 'title'");
  await page.waitForTimeout(800);
  await page.waitForTimeout(300);
  await press('fun');
  await until(ctx, '选难度', "'level:normal' in g.controls()");
  await press('level:normal');
  await until(ctx, '引导', 'g.tutorialStep === 0');
  await press('tutorial:skip');
  let turns = 0;
  for (let guard = 0; guard < 400; guard++) {
    await until(ctx, '等我操作或一副结束', "(g.idle && g.overlay === null && g.view().toAct.includes(0)) || g.overlay === 'settle' || g.overlay === 'gameOver'", 120_000);
    const st = await page.evaluate(() => ({ ov: window.__game!.overlay, my: window.__game!.view()!.myTribute }));
    if (st.ov === 'settle' || st.ov === 'gameOver') break;
    if (st.my) {
      const pt = await page.evaluate((c) => window.__game!.cardPoint(c), st.my.allowed[0]!);
      await page.mouse.click(pt!.x, pt!.y);
      clicks++;
      await press('play');
      continue;
    }
    turns++;
    await press('hint');
    await page.waitForTimeout(350);
    const c = await controls(ctx);
    if (c['play']?.enabled) await press('play');
    else await press('pass');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500);
  await shot(ctx, '40-playtest-settle');
  const secs = Math.round((Date.now() - t0) / 1000);
  notes.push(`试玩一副：${secs} 秒，我出手 ${turns} 次，点击 ${clicks} 次`);
  await page.context().close();
}

// ───────────────────────── 画面图集（美术改版前后对比） ─────────────────────────

interface GallerySize {
  prefix: string;
  w: number;
  h: number;
  dpr: number;
  touch: boolean;
}

/** 每个画面走不到就记一条说明、不卡住 */
async function step(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    notes.push(`图集走不到：${what}（${String(err instanceof Error ? err.message : err).slice(0, 160)}）`);
  }
}

async function gallerySize(browser: Browser, z: GallerySize): Promise<void> {
  const { prefix: p, touch } = z;
  const base = { w: z.w, h: z.h, dpr: z.dpr, touch };
  const ck = (c: Ctx, k: string): Promise<void> => click(c, k, touch);
  // 主流程：标题 → 娱乐卡 → 难度 → 牌桌 → 出牌 → 结算 → 设置 / 规则 / 战绩
  const ctx = await open(browser, `图集${p}`, 'debug=1', { ...base, api: fakeApi() });
  const { page } = ctx;
  await until(ctx, '标题页', "g.scene === 'title'");
  await page.waitForTimeout(1200);
  await shot(ctx, `${p}-01-title`);
  // art-v3 起没有"选模式"那一层：主页上直接点"娱乐"模式卡
  await step('点娱乐卡', async () => {
    await until(ctx, '模式卡', "'fun' in g.controls() && 'stake' in g.controls()", 8000);
    await ck(ctx, 'fun');
  });
  await step('选难度', async () => {
    await until(ctx, '选难度', "'level:novice' in g.controls()", 8000);
    await page.waitForTimeout(400);
    await shot(ctx, `${p}-03-level`);
    await ck(ctx, 'level:normal');
  });
  await step('牌桌', async () => {
    await until(ctx, '轮到我', 'g.scene === \'table\' && g.idle && g.view().toAct.includes(0) && g.overlay === null', 120_000);
    await page.waitForTimeout(500);
    await shot(ctx, `${p}-04-table-myturn`);
    await ck(ctx, 'hint');
    await page.waitForTimeout(300);
    if ((await page.evaluate(() => window.__game!.selected().length)) === 0) {
      await ck(ctx, 'hint');
      await page.waitForTimeout(300);
    }
    const before = await page.evaluate(() => window.__game!.view()!.hand.length);
    await ck(ctx, 'play');
    await until(ctx, '出牌生效', `g.view().hand.length < ${before}`, 10_000);
    await page.waitForTimeout(600);
    await shot(ctx, `${p}-05-table-played`);
  });
  await step('一副结算', async () => {
    await page.evaluate(() => {
      window.__game!.setInstant(true);
      window.__game!.setAutoplay(true);
    });
    await until(ctx, '一副结束', "g.overlay === 'settle' || g.state().phase === 'gameOver'", 240_000);
    await page.evaluate(() => window.__game!.setAutoplay(false));
    await page.evaluate(() => window.__game!.setInstant(false));
    await until(ctx, '结算框', "g.overlay === 'settle'", 10_000);
    await page.waitForTimeout(1500);
    await shot(ctx, `${p}-06-settle`);
  });
  await step('设置', async () => {
    await page.evaluate(() => window.__game!.toTitle());
    await until(ctx, '回标题', "g.scene === 'title'", 10_000);
    await page.waitForTimeout(800);
    // 标题页上 open() 不起作用，要点标题页自己的按钮
    await ck(ctx, 'settings');
    await page.waitForTimeout(600);
    await shot(ctx, `${p}-09-settings`);
    await page.keyboard.press('Escape');
    await until(ctx, '关掉弹窗', 'g.overlay === null && g.hits().length > 5', 5000);
    await page.waitForTimeout(500);
  });
  await step('规则', async () => {
    await ck(ctx, 'rules');
    await page.waitForTimeout(600);
    await shot(ctx, `${p}-10-rules`);
    await page.keyboard.press('Escape');
    await until(ctx, '关掉弹窗', 'g.overlay === null && g.hits().length > 5', 5000);
    await page.waitForTimeout(500);
  });
  await step('战绩', async () => {
    await page.waitForTimeout(300);
    await ck(ctx, 'stats');
    await page.waitForTimeout(500);
    await shot(ctx, `${p}-11-stats`);
  });
  await page.context().close();

  // 整局结束 + 分享预览
  const go = await open(browser, `图集打A${p}`, 'seed=ace1&jump=ace&debug=1&anim=0&autoplay=1', base);
  await step('整局结束', async () => {
    await until(go, '整局结束', "g.overlay === 'gameOver'", 400_000);
    await go.page.evaluate(() => window.__game!.setInstant(false));
    await go.page.waitForTimeout(1500);
    await shot(go, `${p}-07-gameover`);
    await ck(go, 'share');
    await go.page.waitForSelector('#arcade-share-preview img', { timeout: 20_000 });
    await go.page.waitForTimeout(800);
    await shot(go, `${p}-08-share-preview`);
  });
  await go.page.context().close();

  // 好友房面板
  const on = await open(browser, `图集好友房${p}`, 'online=1&debug=1', { ...base, api: fakeApi() });
  await step('好友房面板', async () => {
    await on.page.waitForSelector('#online', { timeout: 10_000 });
    await on.page.waitForTimeout(800);
    await shot(on, `${p}-12-online`);
  });
  await on.page.context().close();
}

async function gallery(browser: Browser): Promise<void> {
  // --sizes 667x375,844x390,1180x820：换一组尺寸（手机审计用）；宽 < 1400 的按触屏、2 倍
  const si = process.argv.indexOf('--sizes');
  const sizes: GallerySize[] = si > 0
    ? process.argv[si + 1]!.split(',').map((z: string): GallerySize => {
      const [w, h] = z.split('x').map(Number) as [number, number];
      return { prefix: String(w), w, h, dpr: w < 1400 ? 2 : 1, touch: w < 1400 };
    })
    : [
      { prefix: '1280', w: 1280, h: 720, dpr: 1, touch: false },
      { prefix: '1920', w: 1920, h: 1080, dpr: 1, touch: false },
      { prefix: '844', w: 844, h: 390, dpr: 2, touch: true },
    ];
  for (const z of sizes) {
    const t = Date.now();
    await gallerySize(browser, z);
    notes.push(`图集 ${z.prefix}：${Math.round((Date.now() - t) / 1000)} 秒`);
  }
  // 手机竖屏："请横过来"（审计时 SE、普通手机、iPad 竖着各看一张）
  const portraits = AUDIT ? [[375, 667], [390, 844], [820, 1180]] : [[390, 844]];
  for (const [w, h] of portraits) {
    const pt = await open(browser, `图集竖屏${w}`, 'debug=1', { w: w!, h: h!, dpr: 2, touch: true, noWait: true });
    await pt.page.waitForTimeout(1500);
    await shot(pt, `${w}-13-portrait`);
    await pt.page.context().close();
  }
  if (AUDIT) writeFileSync(`${OUT}/audit.md`, `# 手机审计（tools/shot.ts --gallery --audit）\n\n${audits.join('\n\n')}\n`);
}

async function look(browser: Browser): Promise<void> {
  const i = process.argv.indexOf('--look');
  const query = process.argv[i + 1] ?? 'debug=1';
  const size = (process.argv[i + 2] ?? '1280x720').split('x').map(Number);
  const name = process.argv[i + 3] ?? 'look';
  const ctx = await open(browser, 'look', query, { w: size[0], h: size[1], dpr: size[0]! < 1000 ? 3 : 1, touch: size[0]! < 1000 });
  await until(ctx, '空闲', "g.idle && (g.scene === 'title' || g.overlay !== null || g.view().toAct.includes(0))", 120_000);
  await ctx.page.waitForTimeout(1000);
  await shot(ctx, name);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  try {
    server = await createServer({ root: process.cwd(), logLevel: 'warn', server: { host: '127.0.0.1', port: PORT, strictPort: PORT !== 0, hmr: false } });
    await server.listen();
    const addr = server.httpServer?.address();
    BASE = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : PORT}/`;
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu', '--autoplay-policy=no-user-gesture-required'] });
    if (process.argv.includes('--look')) await look(browser);
    else if (process.argv.includes('--playtest')) await playtest(browser);
    else if (process.argv.includes('--gallery')) await gallery(browser);
    else {
      const only = process.argv.indexOf('--only');
      const parts: Record<string, (b: Browser) => Promise<void>> = {
        desktop: smokeDesktop,
        tribute: smokeTribute,
        bomb: smokeBomb,
        gameover: smokeGameOver,
        mobile: smokeMobile,
        cloud: smokeCloud,
        large: smokeLarge,
        viewport: smokeViewport,
      };
      const names = only > 0 ? process.argv[only + 1]!.split(',') : Object.keys(parts);
      for (const n of names) {
        const t = Date.now();
        await parts[n]!(browser);
        notes.push(`${n}：${Math.round((Date.now() - t) / 1000)} 秒`);
      }
    }
  } catch (err) {
    errors.push(String(err instanceof Error ? err.message : err));
  } finally {
    await browser?.close();
    await server?.close();
  }
  for (const n of notes) console.log(`· ${n}`);
  console.log(`截图 ${shots.length} 张 → ${OUT}`);
  if (errors.length) {
    console.log(`失败 ${errors.length} 项：`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    process.exitCode = 1;
  } else console.log('冒烟通过：控制台零报错');
}

await main();
