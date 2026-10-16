/**
 * 冒烟测试 + 截图（0.3）：起 vite（127.0.0.1 上系统挑的空闲端口；KP_SHOT_PORT 可指定）→ 无头 Chromium（1280×720）→ 逐个画面截图到 shots/。
 * 浏览器类检查共享一把锁：需要和其他浏览器检查错开时，用 flock 加一把锁再运行 npm run shot
 *
 *   node tools/shot.ts              （或 npm run shot）截图 + 冒烟；--out <目录> 指定截图目录（默认 shots/）
 *   node tools/shot.ts --meta       只跑长线界面（开局选择、每日挑战、图鉴、成就、结束页解锁）
 *   node tools/shot.ts --friendly   只跑 0.3.1 的说明书、词典、新手提示、收盘小结、拆解条、新闻、台词
 *   node tools/shot.ts --story      只跑 0.4 重做的局末"这段日子"小故事（五种市况）和图鉴行情段重看故事；--segs a,b 只截这几段
 *   node tools/shot.ts --real       只跑 0.4 重做的真实行情：挑选行情、交易日、"这段日子"、结束页、图鉴行情段、加载失败退回合成行情
 *   node tools/shot.ts --cloud      只跑 0.5.7 云存档：云朵的未登录 / 已合并 / 待上传（假平台接口）
 *   node tools/shot.ts --board      只跑 0.5.10 每日排行榜（假平台接口）：每日挑战面板看榜、翻页、好友；一局每日挑战打完交分、名次、连不上重试；
 *                                   0.5.11 调试局只留入口、交分还在问账号时点「大厅」先等交分发出去
 *   node tools/shot.ts --live       只跑 0.6.0 实盘（假钱包）：带入 → 打完 → 结回、还没开盘就收手、刷新接着打、结回重试、过期、带入没回话、另一台设备
 *   node tools/shot.ts --lowmem     只跑 0.5.9 省内存设备（iPhone 8 Plus、iPad Pro 的触屏配置）：渲染倍数、图集、显存预算、截图
 *   node tools/shot.ts --lobby      只跑 0.5.8 回大厅：开始菜单、结束页直接走，对局里先确认（改过设置也一样），竖屏提示层（只断言跳到 /，不加载平台页面）
 *   node tools/shot.ts --ext        只跑 0.4 C：买多少、加仓 / 减一半、押跌与被轧、银行（借钱、打电话、收走、赎回）、图鉴小知识、带经历的结局
 *   node tools/shot.ts --v05 [--l1|--l3] [--until N] --out shots/v05   0.5 试玩：选难度开局、真实鼠标键盘打完整局（--until 打到第 N 个月），记时长、每月停几次、弹窗数
 *   node tools/shot.ts --main       只跑主流程那一段（不加参数时跑主流程 + --meta、--friendly、--real、--story）
 *   node tools/shot.ts --vis --out shots/vis-after   0.5 去文字化：主要画面截图，并统计每个画面可见汉字数（counts.json）
 *   node tools/shot.ts --phone [--ext|--meta|…] --out shots/phone   0.5.5 手机横屏：同一套冒烟改在 844×390（layout=phone）上跑，
 *                                   控件在没打开的标签页里时先点那一页；裁切截图改成整屏
 *   node tools/shot.ts --playtest   动画开启、1 倍速、真实鼠标与键盘从开始菜单玩起：前两个月正常看动画，
 *                                   之后每天用空格跳过动画，直到本局结束；报告每天耗时与点击次数
 *
 * 特定局面（龙头带动、涨停、跌停、月底、通关）先在 node 里用 core 推进找到，再用调试桥 loadState 交给画面。
 * 任何 console error / pageerror / 等待超时 / 断言失败都会以非零码退出。
 */
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContextOptions, type Page, type Route } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { SAVE_FORMAT } from '../src/platform/storage.ts';
import { BALANCE, bankRisk, bankView, baseBill, chatView, createRun, dailyScore, dailySegmentId, dailySetup, dispatch, isBusy, rngFor, runSummary, topBar, totalDays, type Action, type GameEvent, type GameState, type RunSetup, type Segment } from '../src/core/index.ts';
import { emptyProfile, recordRun } from '../src/platform/profile.ts';
import { presetProfile } from '../src/debug/profiles.ts';
import { botByName, playRun, useExt, useMarket } from './bots.ts';
import { loadSegment } from './segments-disk.ts';

// 不占任何模块登记的端口（仓库 AGENTS.md 第 3 节）：5180 是平台的，开盘的 5173 / 4173 常开着给人手动看，
// 默认让系统挑一个空闲端口，起来后再定 BASE
const PORT = Number(process.env.KP_SHOT_PORT ?? 0);
let BASE = '';
const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  const dir = i > 0 ? process.argv[i + 1] : undefined;
  if (!dir) return `${process.cwd()}/shots`;
  return dir.startsWith('/') ? dir : `${process.cwd()}/${dir}`;
})();
const WAIT_MS = 120_000;
/** 0.5.5：手机横屏模式（844×390、2 倍屏、layout=phone）。显式给了 screen 的检查（竖屏、高分屏）照旧 */
const PHONE = process.argv.includes('--phone');
const TUTORIAL_KEY = 'kaipan.tutorial.v3';
const TUTORIAL_STEPS = ['goal', 'chat', 'rec', 'open', 'colors', 'heat', 'chain', 'boards', 'sell', 'bill'];
/** 教程进度：只留 keep 这几步没看过（其余记为已看）；不传 keep 时关闭教程 */
function tutorialProgress(keep?: string[]): string {
  if (!keep) return JSON.stringify({ v: 1, off: true, done: [] });
  return JSON.stringify({ v: 1, off: false, done: TUTORIAL_STEPS.filter((x) => !keep.includes(x)) });
}

const errors: string[] = [];
const shots: string[] = [];
const notes: string[] = [];

interface Ctx {
  page: Page;
  name: string;
  /** 触屏上下文（手机横屏切标签页时用点按，不用鼠标） */
  touch?: boolean;
}

interface OpenOpts {
  screen?: { width: number; height: number; dpr: number };
  settings?: Record<string, unknown>;
  /** 触屏设备（pointer: coarse） */
  touch?: boolean;
  /** 打开前写入 localStorage 的键值 */
  storage?: Record<string, string>;
  /** 教程：true 为全新进度，字符串数组为只剩这几步没看过；默认关闭 */
  guide?: boolean | string[];
  /** 记录页面发出的网络请求（不含 blob: / data:） */
  requests?: string[];
  /** 打开前在浏览器里拦截的地址：返回内容或模拟「文件不存在」 */
  routes?: { pattern: string; body: string; type: string }[];
  /** 0.5.7 云存档：假平台接口（/api/**），和页面能读到的登录提示 cookie */
  api?: (route: Route) => Promise<void>;
  loginHint?: boolean;
  /** 0.5.9：看得见的区域比屏幕小（iOS Safari 的地址栏、标签栏占掉的），给了就按它设视口 */
  visible?: { width: number; height: number };
  /** 0.5.9：浏览器 UA（模拟 iOS Safari） */
  userAgent?: string;
  /** 0.5.10：这个场景故意让请求失败（模拟连不上），浏览器自己打的 "Failed to load resource" 不算报错 */
  netErrors?: boolean;
}

async function openPage(browser: Browser, name: string, query: string, opts: OpenOpts = {}): Promise<Ctx> {
  const screen = opts.screen ?? (PHONE ? { width: 844, height: 390, dpr: 2 } : { width: 1280, height: 720, dpr: 1 });
  // 每个场景用独立上下文，避免 localStorage 存档互相影响
  const co: BrowserContextOptions = {
    viewport: opts.visible ?? { width: screen.width, height: screen.height },
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    screen: { width: screen.width, height: screen.height },
    deviceScaleFactor: screen.dpr,
  };
  if (opts.touch) Object.assign(co, { hasTouch: true, isMobile: true });
  const context = await browser.newContext(co);
  const storage: Record<string, string> = { ...(opts.storage ?? {}) };
  storage[TUTORIAL_KEY] = opts.guide === true ? tutorialProgress(TUTORIAL_STEPS) : tutorialProgress(Array.isArray(opts.guide) ? opts.guide : undefined);
  if (opts.settings) storage['kaipan.settings'] = JSON.stringify({ version: 1, ...opts.settings });
  await context.addInitScript((kv) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, storage);
  for (const r of opts.routes ?? []) await context.route(r.pattern, (route) => route.fulfill({ status: 200, contentType: r.type, body: r.body }));
  if (opts.api) await context.route('**/api/**', opts.api);
  // __Host- cookie 只能在 https 下设，冒烟是 http：直接让页面读到提示 cookie
  if (opts.loginHint) await context.addInitScript(() => Object.defineProperty(Document.prototype, 'cookie', { configurable: true, get: () => '__Host-arcade_li=1', set: () => undefined }));
  const page = await context.newPage();
  const reqs = opts.requests;
  if (reqs) page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('blob:') && !u.startsWith('data:')) reqs.push(u);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !(opts.netErrors && msg.text().startsWith('Failed to load resource'))) errors.push(`[${name}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${name}] pageerror: ${err.message}`));
  await page.goto(`${BASE}?${PHONE && !opts.screen ? `${query}${query ? '&' : ''}layout=phone` : query}`);
  const ctx: Ctx = { page, name, touch: !!opts.touch };
  if (screen.width >= screen.height) {
    await waitIdle(ctx, '首屏');
    // 场景淡入（约 0.2 秒；软件渲染下帧率低，多等一会儿）
    await page.waitForTimeout(600);
  }
  return ctx;
}

async function waitIdle(ctx: Ctx, what: string, extra = 'true'): Promise<void> {
  try {
    await ctx.page.waitForFunction(`!!window.__game && window.__game.ready && window.__game.idle && (${extra})`, null, { timeout: WAIT_MS, polling: 50 });
  } catch {
    const info = await ctx.page.evaluate(() => {
      const g = window.__game;
      return g ? { ready: g.ready, idle: g.idle, awaiting: g.awaiting, scene: g.scene, phase: g.state().phase, controls: Object.keys(g.controls()) } : null;
    });
    throw new Error(`[${ctx.name}] 等待超时：${what}（${JSON.stringify(info)}）`);
  }
}

/** 等到页面里某个条件成立（不要求 idle，用于截动画中途）。 */
async function waitFor(ctx: Ctx, what: string, cond: string): Promise<void> {
  try {
    await ctx.page.waitForFunction(`(() => { const g = window.__game; return !!g && (${cond}); })()`, null, { timeout: WAIT_MS, polling: 20 });
  } catch {
    throw new Error(`[${ctx.name}] 等待超时：${what}`);
  }
}

/** 等到 since 之后出现某种 cue（动画播到这一步）。 */
async function waitCue(ctx: Ctx, type: string, since: number): Promise<void> {
  await waitFor(ctx, `cue ${type}`, `g.cues.some((c) => c.t >= ${since} && c.cue.type === '${type}')`);
}

async function dispatchNoWait(ctx: Ctx, action: Action): Promise<void> {
  const r = await ctx.page.evaluate((a) => window.__game?.dispatch(a) ?? { error: '__game 未挂载' }, action);
  if (r.error) throw new Error(`[${ctx.name}] dispatch ${JSON.stringify(action)} 失败：${r.error}`);
}

async function dispatch2(ctx: Ctx, action: Action): Promise<void> {
  await dispatchNoWait(ctx, action);
  await waitIdle(ctx, `dispatch ${action.type}`);
}

async function controls(ctx: Ctx): Promise<Record<string, { x: number; y: number }>> {
  return ctx.page.evaluate(() => window.__game?.controls() ?? {});
}

/** 世界坐标 → 页面坐标：按当前场景的相机换算（电脑上就是 1280×720 等比缩放；手机横屏的世界另算）。 */
async function toPage(ctx: Ctx, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await ctx.page.locator('canvas').boundingBox();
  if (!box) throw new Error(`[${ctx.name}] 找不到画布`);
  const f = await ctx.page.evaluate(([a, b]) => window.__game?.toCanvas(a, b) ?? { x: a / 1280, y: b / 720 }, [x, y] as const);
  return { x: box.x + f.x * box.width, y: box.y + f.y * box.height };
}

async function point(ctx: Ctx, key: string): Promise<{ x: number; y: number }> {
  let c = await controls(ctx);
  // 手机横屏：右边一块是标签页，控件在没打开的那页里时先点那一页（真人也是这么点的）
  if (!(key in c) && PHONE && !key.startsWith('tab:')) {
    for (const t of ['tab:recs', 'tab:msgs', 'tab:board']) {
      const tp = c[t];
      if (!tp) continue;
      const q = await toPage(ctx, tp.x, tp.y);
      if (ctx.touch) await ctx.page.touchscreen.tap(q.x, q.y);
      else await ctx.page.mouse.click(q.x, q.y);
      await ctx.page.waitForTimeout(150);
      c = await controls(ctx);
      if (key in c) break;
    }
  }
  const p = c[key];
  if (!p) throw new Error(`[${ctx.name}] 找不到控件 ${key}（可用：${Object.keys(c).join(', ')}）`);
  return toPage(ctx, p.x, p.y);
}

/** 手机横屏：切到右边的某一页（群聊 msgs / 推荐 recs / 风口 board）；电脑上什么都不做。 */
async function phoneTab(ctx: Ctx, tab: 'msgs' | 'recs' | 'board'): Promise<void> {
  if (!PHONE || !(`tab:${tab}` in (await controls(ctx)))) return;
  await click(ctx, `tab:${tab}`);
  await ctx.page.waitForTimeout(150);
}

/** 用真实鼠标点击某个控件（坐标来自 __game.controls()，按画布实际大小换算）。 */
async function click(ctx: Ctx, key: string): Promise<void> {
  const p = await point(ctx, key);
  await ctx.page.mouse.click(p.x, p.y);
}

/** 点推荐卡上的"买入"：0.4 C 的局会先弹"买多少"，这时选"试一口"（旧流程的买 1 份）。 */
async function buyVia(ctx: Ctx, key: string, touch = false): Promise<void> {
  if (touch) await tap(ctx, key);
  else await click(ctx, key);
  await ctx.page.waitForTimeout(150);
  const c = await controls(ctx);
  if ('size:taste' in c) {
    if (touch) await tap(ctx, 'size:taste');
    else await click(ctx, 'size:taste');
  }
}

async function hover(ctx: Ctx, x: number, y: number): Promise<void> {
  const p = await toPage(ctx, x, y);
  await ctx.page.mouse.move(p.x, p.y);
  await ctx.page.waitForTimeout(120);
}

/** 在世界坐标 (x, y) 处点一下鼠标。 */
async function clickAt(ctx: Ctx, x: number, y: number): Promise<void> {
  const p = await toPage(ctx, x, y);
  await ctx.page.mouse.click(p.x, p.y);
}

async function tap(ctx: Ctx, key: string): Promise<void> {
  const p = await point(ctx, key);
  await ctx.page.touchscreen.tap(p.x, p.y);
}

/** 触屏长按（Playwright 的 touchscreen 只有点按，长按走 CDP 直接发触摸事件）。 */
async function longPress(ctx: Ctx, key: string, ms = 700): Promise<void> {
  const p = await point(ctx, key);
  const cdp = await ctx.page.context().newCDPSession(ctx.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await ctx.page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await ctx.page.waitForTimeout(150);
}

async function shot(ctx: Ctx, file: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  const path = `${OUT}/${file}.png`;
  // 裁切框是按电脑 1280×720 写的；手机横屏一律截整屏
  await ctx.page.screenshot(clip && !PHONE ? { path, clip } : { path });
  shots.push(path);
}

/**
 * 动画中途截图：在 since 之后出现 type 这个 cue、再过 delay 毫秒时由页面自己冻结画面（暂停场景更新），截完再继续。
 * 冻结在页面内计时：软件渲染下一帧上百毫秒、自动化往返能到 1 秒，从外面轮询会错过账单这类停留不长的画面。
 * delay 额外加 150ms，与以前「等待 + 往返」的效果大致相当。
 */
async function cueShot(ctx: Ctx, type: string, since: number, delay: number, file: string): Promise<void> {
  await ctx.page.evaluate(([t, s, ms]) => window.__game?.freezeAfterCue(t, s, ms), [type, since, delay + 150] as const);
  await waitFor(ctx, `cue ${type} + ${delay + 150}ms 冻结`, 'g.frozen');
  await ctx.page.waitForTimeout(150);
  await shot(ctx, file);
  await ctx.page.evaluate(() => window.__game?.freeze(false));
}

/** 正在显示的教程步骤（没有为 null）。 */
async function guideStep(ctx: Ctx): Promise<string | null> {
  const r = await ctx.page.evaluate(() => Object.keys(window.__game?.regions() ?? {}).find((k) => k.startsWith('guide:')) ?? null);
  return r ? r.slice('guide:'.length) : null;
}

/** 教程气泡不能盖住要点的控件。 */
async function expectNotCovered(ctx: Ctx, key: string): Promise<void> {
  const info = await ctx.page.evaluate((k) => {
    const g = window.__game;
    if (!g) return null;
    const box = Object.entries(g.regions()).find(([n]) => n.startsWith('guide:'))?.[1];
    return { box, p: g.controls()[k] };
  }, key);
  if (!info?.box || !info.p) return;
  const { box, p } = info;
  softExpect(!(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h), `[${ctx.name}] 教程气泡盖住了 ${key}`);
}

async function press(ctx: Ctx, key: string): Promise<void> {
  await ctx.page.keyboard.press(key);
}

async function clock(ctx: Ctx): Promise<number> {
  return ctx.page.evaluate(() => Math.round(performance.now()));
}

async function state<T>(ctx: Ctx, expr: string): Promise<T> {
  return (await ctx.page.evaluate(`(() => { const s = window.__game.state(); return ${expr}; })()`)) as T;
}

function expect(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

function softExpect(ok: boolean, msg: string): void {
  if (!ok) errors.push(msg);
}

async function loadState(ctx: Ctx, s: GameState): Promise<void> {
  await ctx.page.evaluate((st) => window.__game?.loadState(st), s);
  await waitIdle(ctx, 'loadState');
}

// ---------------------------------------------------------------- 在 node 里找局面

/** 只开盘不操作地推进；月底奖励都不要、事件选第一个。 */
function step(s: GameState): { state: GameState; events: GameEvent[] } {
  const a: Action = s.phase === 'reward' ? { type: 'skipReward' } : s.phase === 'event' ? { type: 'choose', option: 0 } : { type: 'open' };
  const r = dispatch(s, a);
  if (r.error) throw new Error(`推进失败：${r.error}`);
  return r;
}

/** 找第一个「开盘后满足 pred」的交易日，返回开盘前的局面。 */
function findDay(setup: RunSetup, pred: (events: GameEvent[]) => boolean, prefix: string, maxDays = 40, ok: (s: GameState) => boolean = () => true): { seed: string; state: GameState } {
  for (let i = 0; i < 300; i++) {
    const seed = `${prefix}-${i}`;
    let s = createRun(seed, setup).state;
    for (let d = 0; d < maxDays && (s.phase === 'premarket' || s.phase === 'reward' || s.phase === 'event'); ) {
      const r = step(s);
      if (s.phase === 'premarket') {
        d += 1;
        if (ok(s) && pred(r.events)) return { seed, state: s };
      }
      s = r.state;
    }
  }
  throw new Error(`找不到局面：${prefix}`);
}

/** 推进到第 n 个交易日的盘前（0 起）。 */
function advanceTo(seed: string, setup: RunSetup, day: number): GameState {
  let s = createRun(seed, setup).state;
  while (!(s.phase === 'premarket' && s.dayIndex >= day)) {
    if (s.phase === 'won' || s.phase === 'lost') throw new Error(`推进到第 ${day} 天前本局结束`);
    s = step(s).state;
  }
  return s;
}

const THEMES6 = 'ai,newenergy,consumer,pharma,lowalt,pig';
const T6 = THEMES6.split(',') as RunSetup['themes'];
const CHAIN_SETUP: RunSetup = { themes: T6, holdings: ['ai_leader', 'ai_follower', 'la_leader', 'la_follower'], items: ['longtou', 'genfeng', 'margin'] };
const LIMIT_SETUP: RunSetup = { themes: T6, holdings: ['ai_meme', 'pig_meme', 'la_meme', 'ne_meme'] };
const BASIC_SETUP: RunSetup = { themes: T6, holdings: ['ai_leader', 'con_blue', 'pig_leader'] };

function setupQuery(setup: RunSetup): string {
  const q: string[] = [];
  if (setup.themes) q.push(`themes=${setup.themes.join(',')}`);
  if (setup.holdings) q.push(`holdings=${setup.holdings.join(',')}`);
  if (setup.items) q.push(`items=${setup.items.join(',')}`);
  if (setup.account !== undefined) q.push(`account=${setup.account}`);
  return q.join('&');
}

// ---------------------------------------------------------------- 截图与冒烟

async function run(browser: Browser): Promise<void> {
  // 1. 开始菜单、设置、关于
  {
    const ctx = await openPage(browser, 'title', '');
    expect((await ctx.page.evaluate(() => window.__game?.scene)) === 'title', '启动后应进入开始菜单');
    await shot(ctx, '01-title');
    await click(ctx, 'settings');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, '02-settings');
    await click(ctx, 'settings:done');
    await click(ctx, 'about');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, '03-about');
    await click(ctx, 'about:ok');
    notes.push(`启动耗时（开发服务器、软件渲染、首屏开始菜单）：${await ctx.page.evaluate(() => window.__game?.bootMs)} ms`);
    await ctx.page.context().close();
  }
  // 1b. 启动请求数（到开始菜单可操作为止）：有图集 / 模拟没有图集（入口返回开发服务器的 index.html 回退）
  {
    const isModule = (u: string): boolean => /\/src\/|\/node_modules\/|\/@vite|\/@fs\/|\/@id\//.test(u);
    const count = async (label: string, routes: OpenOpts['routes']): Promise<void> => {
      const reqs: string[] = [];
      const ctx = await openPage(browser, `requests-${label}`, '', { requests: reqs, routes });
      const assets = reqs.filter((u) => !isModule(u));
      const atlas = await ctx.page.evaluate(() => window.__game?.atlas());
      notes.push(`启动请求（${label}，到开始菜单）：资源 ${assets.length} 个（${[...new Set(assets.map((u) => u.split('?')[0]!.split('.').pop()))].map((ext) => `${ext} ${assets.filter((u) => u.split('?')[0]!.endsWith(`.${ext}`)).length}`).join('、')}），另有开发模式的 JS 模块 ${reqs.length - assets.length} 个；图集 ${JSON.stringify(atlas)}`);
      if (label === '有图集') softExpect(atlas?.game.status === 'used' && atlas.game.ready, `应使用 game 图集（${JSON.stringify(atlas)}）`);
      await ctx.page.context().close();
    };
    await count('有图集', []);
    await count('无图集', [{ pattern: '**/assets/art/v3/atlas/**', body: '<!doctype html><title>fallback</title>', type: 'text/html' }]);
  }
  // 1c. 没有标题主视觉时退回小屋 + 纸面板（模拟文件不存在：开发服务器回退成 index.html）
  {
    const ctx = await openPage(browser, 'title-no-keyart', '', { routes: [{ pattern: '**/scene/title_keyart.svg', body: '<!doctype html><title>fallback</title>', type: 'text/html' }] });
    await shot(ctx, '01b-title-no-keyart');
    expect('new' in (await controls(ctx)), '没有主视觉时标题页也应有「新游戏」');
    await ctx.page.context().close();
  }
  // 1d. 眨眼：待机的小人隔几秒眨一下，而且不会全体一起眨
  {
    const ctx = await openPage(browser, 'blink', `seed=pre-1&${setupQuery({ ...BASIC_SETUP })}`);
    let max = 0;
    let seen = 0;
    let shotDone = false;
    const guys = await ctx.page.evaluate(() => window.__game?.countFrames('/calm') ?? 0);
    for (let i = 0; i < 160; i++) {
      const n = await ctx.page.evaluate(() => window.__game?.countFrames('blink') ?? 0);
      if (n > 0) {
        seen += 1;
        max = Math.max(max, n);
        if (!shotDone) {
          await ctx.page.evaluate(() => window.__game?.freeze(true));
          await shot(ctx, '16b-blink', { x: 266, y: 232, width: 700, height: 230 });
          await ctx.page.evaluate(() => window.__game?.freeze(false));
          shotDone = true;
        }
      }
      await ctx.page.waitForTimeout(50);
    }
    const atlas = await ctx.page.evaluate(() => window.__game?.atlas());
    notes.push(`眨眼：约 8 秒内采样到 ${seen} 次闭眼，同时闭眼最多 ${max} 只（calm 小人 ${guys} 只）`);
    if (atlas?.blink) softExpect(seen > 0 && max < Math.max(2, guys), `应能看到眨眼且不同时眨（采样 ${seen}，最多 ${max}/${guys}）`);
    await ctx.page.context().close();
  }
  // 2. 旧版本存档提示
  {
    const legacy = JSON.stringify({ format: 3, appVersion: '0.2.0', savedAt: '2026-10-01T00:00:00Z', state: {} });
    const ctx = await openPage(browser, 'legacy', '', { storage: { 'kaipan.save': legacy, 'kaipan.save.v0.2': legacy, 'kaipan.terms.v04': '[]', 'kaipan.records': '{"version":2}' } });
    await ctx.page.waitForTimeout(200);
    await shot(ctx, '04-legacy-notice');
    expect('notice:ok' in (await controls(ctx)), '应弹出旧存档提示');
    // 0.6.15：旧存档清掉、不再备份；当年留下的备份 key 启动时清掉
    const left = await ctx.page.evaluate(() => ['kaipan.save', 'kaipan.save.v0.2', 'kaipan.terms.v04', 'kaipan.records'].filter((k) => localStorage.getItem(k) !== null));
    expect(left.length === 0, `旧存档和旧备份 key 应清掉（还剩 ${left.join('、')}）`);
    await click(ctx, 'notice:ok');
    await ctx.page.context().close();
  }
  // 3. 有存档：继续
  {
    let s = createRun('save-1').state;
    s = dispatch(s, { type: 'open' }).state;
    const save = JSON.stringify({ format: SAVE_FORMAT, appVersion: 'dev', savedAt: new Date().toISOString(), state: s });
    const ctx = await openPage(browser, 'continue', '', { storage: { 'kaipan.save': save } });
    await shot(ctx, '05-title-continue');
    await click(ctx, 'continue');
    await waitIdle(ctx, '继续', "window.__game.scene === 'trade'");
    expect((await state<number>(ctx, 's.dayIndex')) === 1, '继续应回到存档的第 2 天');
    await ctx.page.context().close();
  }
  // 4. 新游戏 + 分步教程（第 1 天：目标 → 群聊 → 推荐 → 开盘；第 2 天：红涨绿跌 → 题材热度 → 卖出）+ 鼠标买入、开盘
  {
    const ctx = await openPage(browser, 'newgame', '', { guide: true });
    await click(ctx, 'quick');
    await waitIdle(ctx, '新局', "window.__game.scene === 'trade' && 'guide:next' in window.__game.controls()");
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'goal', `第 1 天应先讲目标和办法（${await guideStep(ctx)}）`);
    expect(!('hint' in ((await ctx.page.evaluate(() => window.__game?.regions())) ?? {})), '教程期间猫的提示应先隐藏');
    await shot(ctx, '10a-tutorial-0-goal');
    await click(ctx, 'guide:next');
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'chat', `第二步应讲群聊（${await guideStep(ctx)}）`);
    await shot(ctx, '10-tutorial-1-chat');
    await click(ctx, 'guide:next');
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'rec', `第三步应讲推荐（${await guideStep(ctx)}）`);
    await expectNotCovered(ctx, 'buy:0');
    await shot(ctx, '11-tutorial-2-rec');
    const t0 = await clock(ctx);
    await buyVia(ctx, 'buy:0');
    await waitIdle(ctx, '买入');
    expect((await state<number>(ctx, 's.slots.filter(Boolean).length')) === 1, '点买入后应有 1 只持仓');
    await waitCue(ctx, 'buy', t0);
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'open', `买入后应讲开盘（${await guideStep(ctx)}）`);
    await expectNotCovered(ctx, 'open');
    await shot(ctx, '12-tutorial-3-open');
    // T+1：当天买入的不能卖。0.4 起持仓按钮是"加 / 卖"（当天可以加仓），所以按钮还在，改为检查规则层的状态
    expect(await state<boolean>(ctx, 's.slots[0] && s.slots[0].boughtDay >= s.today.day'), '当天买入的不能卖（规则层应记为今天买入）');
    await click(ctx, 'open');
    await waitIdle(ctx, '开盘', 'window.__game.state().dayIndex === 1');
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'colors', `第一天开盘后应讲红涨绿跌（${await guideStep(ctx)}）`);
    await shot(ctx, '12b-tutorial-colors');
    await click(ctx, 'guide:next');
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'heat', `第 2 天应讲题材热度（${await guideStep(ctx)}）`);
    await shot(ctx, '13-tutorial-4-heat');
    // 打断后恢复：重新载入页面，没看完的这一步还在
    await ctx.page.reload();
    await waitIdle(ctx, '重新载入', "window.__game.scene === 'title'");
    await click(ctx, 'continue');
    await waitIdle(ctx, '继续', "window.__game.scene === 'trade'");
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'heat', `刷新后应接着讲题材热度（${await guideStep(ctx)}）`);
    await click(ctx, 'guide:next');
    await ctx.page.waitForTimeout(400);
    expect((await guideStep(ctx)) === 'sell', `接着应讲 T+1 与卖出（${await guideStep(ctx)}）`);
    await expectNotCovered(ctx, 'sell:0');
    await expectNotCovered(ctx, 'open');
    await shot(ctx, '13b-tutorial-5-sell');
    expect('sell:0' in (await controls(ctx)), '第二天应能卖出');
    // 跳过全部
    await click(ctx, 'guide:close');
    await ctx.page.waitForTimeout(150);
    const prog = await ctx.page.evaluate(() => window.__game?.tutorial());
    expect(prog?.off === true, '「跳过教程」后应记为关闭');
    expect((await guideStep(ctx)) === null, '跳过后不应再有气泡');
    await ctx.page.context().close();
  }
  // 4b. 教程：连锁、连板 / 炸板、月底月供与奖励（只剩那一步没看过）
  {
    const chainDay = findDay(CHAIN_SETUP, (ev) => ev.some((e) => e.type === 'chain' && e.held.length > 0), 'tchain', 40, (s) => s.dayInMonth < 3);
    const after = dispatch(chainDay.state, { type: 'open' }).state;
    const ctx = await openPage(browser, 'tutorial-chain', `seed=${chainDay.seed}&anim=0&${setupQuery(CHAIN_SETUP)}`, { guide: ['chain'] });
    await loadState(ctx, after);
    await ctx.page.waitForTimeout(300);
    expect((await guideStep(ctx)) === 'chain', `龙头带动后应讲连锁（${await guideStep(ctx)}）`);
    await shot(ctx, '22-tutorial-chain');
    await ctx.page.context().close();
  }
  {
    const held = (ev: GameEvent[]): boolean => {
      const rep = ev.find((e): e is Extract<GameEvent, { type: 'dayClosed' }> => e.type === 'dayClosed')?.report;
      if (!rep) return false;
      const ids = new Set(rep.holdings.map((h) => h.stockId));
      return rep.stocks.some((st) => ids.has(st.id) && (st.boards >= 2 || st.blown));
    };
    const boardDay = findDay(LIMIT_SETUP, held, 'tboards', 40, (s) => s.dayInMonth < 3);
    const after = dispatch(boardDay.state, { type: 'open' }).state;
    const ctx = await openPage(browser, 'tutorial-boards', `seed=${boardDay.seed}&anim=0&${setupQuery(LIMIT_SETUP)}`, { guide: ['boards'] });
    await loadState(ctx, after);
    await ctx.page.waitForTimeout(300);
    if ((await guideStep(ctx)) === 'boards') await shot(ctx, '23-tutorial-boards');
    else softExpect(false, `连板 / 炸板后应讲连板（${await guideStep(ctx)}；可能那只已被自动卖出）`);
    await ctx.page.context().close();
  }
  {
    // 月底：找一个奖励里有道具卡的局面（顺便看道具图标）
    const setup: RunSetup = { themes: T6, holdings: ['ai_leader', 'con_blue'] };
    let reward: GameState | null = null;
    for (let i = 0; i < 100 && !reward; i++) {
      let s = createRun(`treward-${i}`, setup).state;
      while (s.phase === 'premarket') s = dispatch(s, { type: 'open' }).state;
      if (s.phase === 'reward' && s.reward?.cards.some((c) => c.kind === 'item')) reward = s;
    }
    expect(reward !== null, '找不到带道具卡的月底奖励');
    const r = reward as GameState;
    const ctx = await openPage(browser, 'tutorial-bill', `seed=${r.seed}&anim=0&${setupQuery(setup)}`, { guide: ['bill'] });
    await loadState(ctx, r);
    await ctx.page.waitForTimeout(300);
    expect((await guideStep(ctx)) === 'bill', `月底奖励时应讲月供与奖励（${await guideStep(ctx)}）`);
    for (const k of ['reward:0', 'reward:1', 'reward:2', 'reward:skip']) await expectNotCovered(ctx, k);
    await shot(ctx, '24-tutorial-bill-reward');
    await ctx.page.context().close();
  }
  // 5. 盘前全景（4 格）、悬停说明、5 格、满仓替换
  {
    const ctx = await openPage(browser, 'premarket', `seed=pre-1&anim=0&${setupQuery({ ...BASIC_SETUP, items: ['longtou', 'margin', 'mood_meter'] })}`);
    await shot(ctx, '14-premarket-4slots');
    // 手机横屏：风口在右边的「风口」页里，第一行在 (700, 128)；第一张持仓卡、第一个道具也各在别处
    if (PHONE) await click(ctx, 'tab:board');
    await (PHONE ? hover(ctx, 700, 128) : hover(ctx, 120, 160));
    await shot(ctx, '15-tooltip-theme');
    if (PHONE) {
      await click(ctx, 'tab:msgs');
      const c0 = (await controls(ctx))['card:0'];
      if (c0) await hover(ctx, c0.x, c0.y);
    } else await hover(ctx, 340, 300);
    await shot(ctx, '16-tooltip-stock');
    await shot(ctx, '17a-items-topbar', { x: 880, y: 0, width: 400, height: 70 });
    await (PHONE ? hover(ctx, 664, 27) : hover(ctx, 914, 33));
    await shot(ctx, '17-tooltip-item');
    await ctx.page.context().close();
  }
  // 道具攒多了：最多两排，多的收进「+N」，不盖住下面
  {
    const items = ['longtou', 'genfeng', 'baima', 'yaogu', 'lianban', 'dixi', 'zhisun', 'zhiying', 'margin', 'ipo', 'credit', 'paid_group', 'notebook', 'mood_meter', 'hot_money', 'value_eye', 'fan_qunzhu', 'diversify', 'fomo', 'night_review', 'crowd_fund', 'rumor_mill', 'sunglasses', 'banker', 'pyramid'];
    const ctx = await openPage(browser, 'premarket', `seed=pre-1&anim=0&${setupQuery({ ...BASIC_SETUP, items })}`);
    await shot(ctx, '17b-items-overflow');
    await shot(ctx, '17c-items-overflow-bar', { x: 880, y: 0, width: 400, height: 90 });
    expect(await ctx.page.evaluate(() => window.__game?.displayList().some((x) => /^text:\+\d+$/.test(x)) ?? false), '道具超过两排时应收进「+N」');
    await ctx.page.context().close();
  }
  {
    const setup: RunSetup = { themes: T6, items: ['extra_slot'], holdings: ['ai_leader', 'ai_follower', 'con_blue', 'pig_meme', 'ph_leader'] };
    const ctx = await openPage(browser, 'five', `seed=five-1&anim=0&${setupQuery(setup)}`);
    await shot(ctx, '18-five-slots-full');
    const recs = await state<number>(ctx, 's.today.recs.length');
    await phoneTab(ctx, 'recs');
    let i = 0;
    while (i < recs && !(`buy:${i}` in (await controls(ctx)))) i++;
    expect(i < recs, '满仓时推荐卡应提供「换仓」');
    await buyVia(ctx, `buy:${i}`);
    await ctx.page.waitForTimeout(150);
    await shot(ctx, '19-replace-pick');
    await click(ctx, 'slot:1');
    await ctx.page.waitForTimeout(150);
    await shot(ctx, '20-replace-confirm');
    await click(ctx, 'confirm:ok');
    await waitIdle(ctx, '换仓');
    expect((await state<number>(ctx, 's.today.ops')) === 1, '确认换仓后应完成一次操作');
    await shot(ctx, '21-replaced');
    await ctx.page.context().close();
  }
  // 6. 结算动画：热度、揭晓、龙头带动、道具
  {
    const found = findDay(CHAIN_SETUP, (ev) => ev.some((e) => e.type === 'chain' && e.held.length > 0), 'chain');
    const ctx = await openPage(browser, 'chain', `seed=${found.seed}&${setupQuery(CHAIN_SETUP)}`);
    await loadState(ctx, found.state);
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'heat', t0, 350, '30-settle-themes');
    await cueShot(ctx, 'reveal', t0, 200, '31-settle-reveal');
    await cueShot(ctx, 'chain', t0, 260, '32-settle-chain');
    const hasItem = await ctx.page.evaluate(() => window.__game?.events().some((e) => e.type === 'itemTriggered'));
    if (hasItem) {
      await cueShot(ctx, 'item', t0, 150, '33-settle-item');
    }
    await cueShot(ctx, 'settle', t0, 500, '34-settle-account');
    await waitIdle(ctx, '结算结束');
    await ctx.page.context().close();
  }
  // 7. 涨停烟花、跌停雨云
  {
    const up = findDay(LIMIT_SETUP, (ev) => ev.some((e) => e.type === 'dayClosed' && e.report.fireworks), 'limitup');
    const ctx = await openPage(browser, 'limitup', `seed=${up.seed}&${setupQuery(LIMIT_SETUP)}`);
    await loadState(ctx, up.state);
    let t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'limitUp', t0, 200, '35-limit-up');
    await waitIdle(ctx, '涨停日结束');
    const down = findDay(LIMIT_SETUP, (ev) => ev.some((e) => e.type === 'dayClosed' && e.report.rain), 'limitdown');
    await ctx.page.evaluate(() => window.__game?.newRun('x'));
    await waitIdle(ctx, '换局');
    await loadState(ctx, down.state);
    t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'limitDown', t0, 450, '36-limit-down');
    await waitIdle(ctx, '跌停日结束');
    await ctx.page.context().close();
  }
  // 8. 月底：账单、三选一（稀有股票放哪一格）、事件、新月份
  {
    const setup: RunSetup = { themes: T6, holdings: ['ai_leader', 'ai_follower', 'pig_leader', 'con_blue'] };
    let pickSeed = '';
    let stockIdx = -1;
    for (let i = 0; i < 300 && !pickSeed; i++) {
      let s = createRun(`month-${i}`, setup).state;
      while (s.phase === 'premarket') s = dispatch(s, { type: 'open' }).state;
      const si = s.reward?.cards.findIndex((c) => c.kind === 'stock') ?? -1;
      if (s.phase === 'reward' && si >= 0 && dispatch(s, { type: 'pickReward', index: si, slot: 0 }).state.phase === 'event') {
        pickSeed = `month-${i}`;
        stockIdx = si;
      }
    }
    expect(pickSeed !== '', '找不到「稀有股票 + 事件」的种子');
    const ctx = await openPage(browser, 'month', `seed=${pickSeed}&${setupQuery(setup)}`);
    await loadState(ctx, advanceTo(pickSeed, setup, 4));
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'stamp', t0, 450, '40-bill-paid');
    await waitIdle(ctx, '三选一', "window.__game.state().phase === 'reward'");
    await shot(ctx, '41-reward');
    await click(ctx, `reward:${stockIdx}`);
    await ctx.page.waitForTimeout(150);
    await shot(ctx, '42-reward-pick-slot');
    await click(ctx, 'slot:0');
    await waitIdle(ctx, '事件', "window.__game.state().phase === 'event'");
    await shot(ctx, '43-event');
    await click(ctx, 'event:0');
    await waitIdle(ctx, '事件结果', 'window.__game.awaiting');
    await shot(ctx, '44-event-result');
    const t1 = await clock(ctx);
    await click(ctx, 'continue');
    await cueShot(ctx, 'monthStart', t1, 400, '45-month-intro');
    await waitIdle(ctx, '下个月第一天', "window.__game.state().phase === 'premarket'");
    await shot(ctx, '46-month2-day1');
    await ctx.page.context().close();
  }
  // 8b. 突发账单、拐点消息
  {
    const setup: RunSetup = { themes: T6, account: 5_000_000 };
    let bill: GameState | null = null;
    let turn: GameState | null = null;
    for (let i = 0; i < 200 && (!bill || !turn); i++) {
      let s = createRun(`extra-${i}`, setup).state;
      for (let d = 0; d < 40 && s.phase !== 'won' && s.phase !== 'lost'; d++) {
        if (s.phase === 'premarket') {
          if (!turn && s.today.messages.some((m) => m.turn)) turn = s;
          if (!bill && (s.bill.extras?.length ?? 0) > 0 && s.dayInMonth === (s.month === 10 ? 2 : 4)) bill = s;
        }
        s = step(s).state;
      }
    }
    if (turn) {
      const ctx = await openPage(browser, 'turn', `seed=${turn.seed}&anim=0&${setupQuery(setup)}`);
      await loadState(ctx, turn);
      await shot(ctx, '48-chat-turn');
      await ctx.page.context().close();
    } else notes.push('没找到带拐点消息的局面，跳过 48-chat-turn');
    if (bill) {
      const ctx = await openPage(browser, 'surprise', `seed=${bill.seed}&${setupQuery(setup)}`);
      await loadState(ctx, bill);
      const t0 = await clock(ctx);
      await dispatchNoWait(ctx, { type: 'open' });
      await cueShot(ctx, 'stamp', t0, 300, '49-bill-surprise');
      await waitIdle(ctx, '突发账单之后');
      await ctx.page.context().close();
    } else notes.push('没找到带突发账单的局面，跳过 49-bill-surprise');
  }
  // 9. 爆仓（逾期）→ 结束页；通关 → 结束页
  {
    // 开局账户只有 1 月月供的一半：月底必然逾期
    const setup: RunSetup = { themes: T6, account: Math.round(baseBill(1) * 0.5) };
    const ctx = await openPage(browser, 'lost', `seed=lost-1&${setupQuery(setup)}`);
    await loadState(ctx, advanceTo('lost-1', setup, 4));
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'stamp', t0, 450, '47-bill-overdue');
    await waitIdle(ctx, '逾期继续', 'window.__game.awaiting');
    await click(ctx, 'continue');
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await ctx.page.waitForTimeout(300);
    await shot(ctx, '50-end-lost');
    // 同种子再来
    await click(ctx, 'retry');
    await waitIdle(ctx, '同种子再来', "window.__game.scene === 'trade'");
    expect((await state<string>(ctx, 's.seed')) === 'lost-1', '同种子再来应沿用种子');
    await ctx.page.context().close();
  }
  {
    const setup: RunSetup = { themes: T6, account: 50_000_000, holdings: ['con_blue', 'fin_blue'] };
    const setup2: RunSetup = { ...setup, themes: ['ai', 'newenergy', 'consumer', 'pharma', 'finance', 'pig'] };
    const last = advanceTo('won-1', setup2, totalDays() - 1);
    const ctx = await openPage(browser, 'won', `seed=won-1&${setupQuery(setup2)}`);
    await loadState(ctx, last);
    await dispatchNoWait(ctx, { type: 'open' });
    await waitIdle(ctx, '通关账单', 'window.__game.awaiting');
    await click(ctx, 'continue');
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await ctx.page.waitForTimeout(400);
    await shot(ctx, '51-end-won');
    // 0.6.5 结局海报：无头 Chromium 没有系统分享，走下载；存下来看一眼
    await waitFor(ctx, '海报画好', "window.__game.controls?.().poster !== undefined");
    await ctx.page.waitForTimeout(800);
    const dl = ctx.page.waitForEvent('download', { timeout: 15_000 });
    await click(ctx, 'poster');
    const file = await dl;
    expect(file.suggestedFilename() === 'kaipan-won-1.png', `海报文件名 ${file.suggestedFilename()}`);
    await file.saveAs(`${OUT}/51b-poster.png`);
    shots.push(`${OUT}/51b-poster.png`);
    await click(ctx, 'menu');
    await waitIdle(ctx, '回菜单', "window.__game.scene === 'title'");
    await shot(ctx, '52-title-records');
    await ctx.page.context().close();
  }
  // 10. 跳过、4 档速度、减少动态效果（挑一个不是月底的涨停日，免得账单和三选一混进计时）
  {
    const found = findDay(LIMIT_SETUP, (ev) => ev.some((e) => e.type === 'dayClosed' && e.report.fireworks), 'limitup', 40, (s) => s.dayInMonth < 3);
    const durations: Record<string, number> = {};
    for (const [label, q] of [
      ['1×', 'speed=1'],
      ['2×', 'speed=2'],
      ['4×', 'speed=4'],
      ['关闭', 'anim=0'],
    ] as const) {
      const ctx = await openPage(browser, `speed-${label}`, `seed=${found.seed}&${q}&${setupQuery(LIMIT_SETUP)}`);
      await loadState(ctx, found.state);
      // 等 Phaser 启动后的帧时间冷却期过去（见 src/view/game.ts 的 fps.panicMax），否则开头的动画会被拖慢
      await ctx.page.waitForTimeout(1500);
      const t0 = Date.now();
      await dispatch2(ctx, { type: 'open' });
      durations[label] = Date.now() - t0;
      await ctx.page.context().close();
    }
    notes.push(`一天（含动画）的耗时：${Object.entries(durations).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join('，')}`);
    // 软件渲染只有 7–10 帧，每段等待至少一帧，4× 会碰到这个下限：要求 1× 明显慢于 2×，4× 不慢于 2×（留 15% 抖动），且都比关闭慢
    const d = durations as Record<'1×' | '2×' | '4×' | '关闭', number>;
    softExpect(
      d['1×'] > d['2×'] * 1.2 && d['4×'] < d['2×'] * 1.15 && d['4×'] > d['关闭'],
      `动画速度应逐档变快：${JSON.stringify(durations)}`,
    );
    softExpect(durations['关闭']! < 1500, `关闭动画时一天应几乎瞬间完成：${durations['关闭']} ms`);
    // 跳过：开盘 0.4 秒后按空格
    const ctx = await openPage(browser, 'skip', `seed=${found.seed}&${setupQuery(LIMIT_SETUP)}`);
    await loadState(ctx, found.state);
    const t0 = Date.now();
    await dispatchNoWait(ctx, { type: 'open' });
    await ctx.page.waitForTimeout(400);
    await press(ctx, 'Space');
    await waitIdle(ctx, '跳过');
    const skipped = Date.now() - t0;
    notes.push(`开盘 0.4 秒后按空格跳过：${(skipped / 1000).toFixed(1)}s 回到盘前`);
    softExpect(skipped < durations['1×']! * 0.6, `空格跳过应明显缩短：${skipped} ms`);
    await ctx.page.context().close();
    // 减少动态效果：同一个涨停日，截中途
    const calm = await openPage(browser, 'reduce-motion', `seed=${found.seed}&${setupQuery(LIMIT_SETUP)}`, { settings: { reduceMotion: true } });
    await loadState(calm, found.state);
    const c0 = await clock(calm);
    await dispatchNoWait(calm, { type: 'open' });
    await cueShot(calm, 'limitUp', c0, 300, '53-reduce-motion');
    const tweens = await calm.page.evaluate(() => window.__game?.stats().tweens ?? -1);
    await waitIdle(calm, '减少动态效果结束');
    const idleTweens = await calm.page.evaluate(() => window.__game?.stats().tweens ?? -1);
    notes.push(`减少动态效果：结算中途补间 ${tweens} 个，盘前常驻补间 ${idleTweens} 个`);
    softExpect(idleTweens <= 2, `减少动态效果时不应有常驻的环境补间（${idleTweens}）`);
    await calm.page.context().close();
  }
  // 11. 触屏：不显示快捷键提示；点按完成一天
  {
    const ctx = await openPage(browser, 'touch', `seed=touch-1&anim=0&${setupQuery(BASIC_SETUP)}`, { touch: true });
    await shot(ctx, '60-touch');
    // 长按永远不算点击：长按买入按钮不买；长按持仓卡弹出说明、不打开详情。说明留在屏幕上，下一次点击只收起说明（不会点到下面的开盘）
    const held = 's.slots.filter((x) => x).length';
    const before = await state<number>(ctx, held);
    await longPress(ctx, 'buy:0');
    expect((await state<number>(ctx, held)) === before && !('size:taste' in (await controls(ctx))), '触屏长按买入按钮不应买入');
    await longPress(ctx, 'card:0');
    await shot(ctx, '60b-touch-longpress');
    await tap(ctx, 'open');
    await ctx.page.waitForTimeout(300);
    expect((await state<number>(ctx, 's.dayIndex')) === 0, '长按说明显示时，点一下只收起说明，不应点到下面的按钮');
    await buyVia(ctx, 'buy:0', true);
    await waitIdle(ctx, '触屏买入');
    await tap(ctx, 'open');
    await waitIdle(ctx, '触屏开盘', 'window.__game.state().dayIndex === 1');
    await ctx.page.context().close();
  }
  // 12. 竖屏提示
  {
    const ctx = await openPage(browser, 'portrait', 'seed=demo-1&anim=0', { touch: true, screen: { width: 390, height: 844, dpr: 2 } });
    await ctx.page.waitForTimeout(800);
    await shot(ctx, '61-portrait');
    await ctx.page.context().close();
  }
  // 12b. 竖屏打开、再横过来（微信里点开链接最常见的进法）：不带 layout 参数，靠自动判定也要拿到手机布局（0.5.5 审阅）
  {
    const ctx = await openPage(browser, 'rotate', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`, { touch: true, screen: { width: 390, height: 844, dpr: 2 } });
    await ctx.page.setViewportSize({ width: 844, height: 390 });
    await waitIdle(ctx, '横过来之后');
    await ctx.page.waitForTimeout(600);
    const cw = await ctx.page.evaluate(() => document.querySelector('canvas')?.width ?? 0);
    expect(cw > 0 && cw % 960 === 0, `竖屏打开再横过来应是手机布局（画布宽 ${cw}，应是 960 的整数倍）`);
    notes.push(`竖屏打开再横过来：画布宽 ${cw}`);
    await shot(ctx, '61b-portrait-then-landscape');
    await ctx.page.context().close();
  }
  // 13. 绿涨红跌配色
  {
    const ctx = await openPage(browser, 'intl', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`, { settings: { colorScheme: 'intl' } });
    await dispatch2(ctx, { type: 'open' });
    await shot(ctx, '62-intl');
    await ctx.page.context().close();
  }
  // 14. 高分屏：同一画面按实际渲染倍数（after）与强制 1 倍（before）各截一块
  const screens: [string, { width: number; height: number; dpr: number }][] = [
    ['1280x720@2', { width: 1280, height: 720, dpr: 2 }],
    ['1920x1080@1', { width: 1920, height: 1080, dpr: 1 }],
  ];
  for (const [label, screen] of screens) {
    for (const mode of ['before', 'after']) {
      const ctx = await openPage(browser, `hidpi-${label}-${mode}`, `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}${mode === 'before' ? '&scale=1' : ''}`, { screen });
      const scale = await ctx.page.evaluate(() => window.__game?.renderScale ?? 0);
      if (mode === 'after') notes.push(`渲染倍数 ${label}：${scale}`);
      const k = screen.width / 1280;
      await shot(ctx, `63-hidpi-${label}-${mode}`, { x: 260 * k, y: 220 * k, width: 520 * k, height: 260 * k });
      await ctx.page.context().close();
    }
  }
  await cloudShots(browser);
  await boardShots(browser);
  await lobbyShots(browser);
  if (!PHONE) await lowMemShots(browser);
}

// ---------------------------------------------------------------- 0.5.7 云存档

/**
 * 云朵的几种状态（假平台接口，不连真的平台）：
 * - 没有登录提示 cookie：一个 /api 请求都不发，云朵"未登录"，点一下去 /login?from=kaipan；
 * - 云端有别的设备的进度：合并后"已合并"，开始菜单按合并后的档案重画，交上去的请求带 X-Arcade、baseRev 是云端的 rev、不带 last；
 * - /api/me 说存档暂停：云朵"待上传"，悬停说明平台在歇口气。
 */
async function cloudShots(browser: Browser): Promise<void> {
  const local = presetProfile('partial').profile;
  const remote = { ...emptyProfile(), runs: local.runs + 40, maxDifficulty: 8 };
  const apiCalls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fake = (saves: 'ok' | 'paused', cloudSaves = [{ slot: 'profile', rev: 3, updatedAt: 1, data: remote as unknown }]) => async (route: Route): Promise<void> => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    apiCalls.push({ method: req.method(), path, body: req.postDataJSON() as unknown, headers: req.headers() });
    if (path === '/api/me') return route.fulfill({ json: { user: { id: 'smoke-user', username: 'smoke', displayName: '冒烟' }, service: 'ok', saves } });
    if (req.method() === 'GET' && path === '/api/saves/kaipan') return route.fulfill({ json: { saves: cloudSaves } });
    if (req.method() === 'PUT') return route.fulfill({ json: { rev: 4, updatedAt: 2 } });
    return route.fulfill({ status: 404, json: { error: 'not_found', message: '没有找到' } });
  };
  const cloudState = (ctx: Ctx): Promise<string> => ctx.page.evaluate(() => window.__game?.cloud().state ?? '');
  {
    const reqs: string[] = [];
    const ctx = await openPage(browser, 'cloud-out', '', { storage: profileStorage('partial'), requests: reqs, touch: PHONE });
    expect((await cloudState(ctx)) === 'out', '没登录时云朵应是"未登录"');
    expect(!reqs.some((u) => u.includes('/api/')), `没有登录提示 cookie 时不该调 /api：${reqs.filter((u) => u.includes('/api/')).join(', ')}`);
    await shot(ctx, 'c1-cloud-out');
    await ctx.page.route('**/login*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>login</title>' }));
    if (PHONE) await tap(ctx, 'cloud');
    else await click(ctx, 'cloud');
    await ctx.page.waitForURL('**/login?from=kaipan', { timeout: 5000 });
    await ctx.page.context().close();
  }
  {
    const ctx = await openPage(browser, 'cloud-merged', '', { storage: profileStorage('partial'), api: fake('ok'), loginHint: true, touch: PHONE });
    await waitFor(ctx, '云朵"已合并"', `window.__game?.cloud().state === 'merged'`);
    const me = apiCalls.findIndex((c) => c.path === '/api/me');
    const get = apiCalls.findIndex((c) => c.path === '/api/saves/kaipan');
    expect(me >= 0 && get > me, '应先调 /api/me 再取存档');
    const put = apiCalls.find((c) => c.method === 'PUT' && c.path === '/api/saves/kaipan/profile');
    expect(!!put, '合并后应把档案交上去');
    if (put) {
      const body = put.body as { baseRev: number; data: { runs: number; last: string; maxDifficulty: number } };
      expect(put.headers['x-arcade'] === '1', '写请求要带 X-Arcade: 1');
      expect(body.baseRev === 3, `baseRev 应是云端的 3，实际 ${body.baseRev}`);
      expect(body.data.runs === remote.runs && body.data.maxDifficulty === 8 && body.data.last === '', '交上去的应是合并后的档案、不带 last');
    }
    const runs = await ctx.page.evaluate(() => window.__game?.profile().runs ?? -1);
    expect(runs === remote.runs, `本地档案应换成合并后的（局数 ${remote.runs}），实际 ${runs}`);
    await ctx.page.waitForTimeout(400);
    await shot(ctx, 'c2-cloud-merged');
    const c = (await controls(ctx)).cloud;
    expect(!!c, '开始菜单上应有云朵');
    if (c) {
      if (PHONE) await longPress(ctx, 'cloud');
      else await hover(ctx, c.x, c.y);
      await shot(ctx, 'c2b-cloud-merged-tip');
    }
    await ctx.page.context().close();
  }
  {
    // 本机没有档案、云端有：直接用云端的，什么都不用传 → 已同步
    apiCalls.length = 0;
    const ctx = await openPage(browser, 'cloud-synced', '', { api: fake('ok'), loginHint: true, touch: PHONE });
    await waitFor(ctx, '云朵"已同步"', `window.__game?.cloud().state === 'synced'`);
    // 冒烟打开页面时总会写一份教程进度（关着），那一槽照常传；档案不该传
    expect(!apiCalls.some((c) => c.method === 'PUT' && c.path.endsWith('/profile')), '本机没有档案时不该上传档案');
    await ctx.page.waitForTimeout(400);
    await shot(ctx, 'c4-cloud-synced');
    await ctx.page.context().close();
  }
  {
    apiCalls.length = 0;
    const ctx = await openPage(browser, 'cloud-paused', '', { storage: profileStorage('partial'), api: fake('paused'), loginHint: true, touch: PHONE });
    await waitFor(ctx, '云朵"待上传"', `window.__game?.cloud().state === 'pending'`);
    expect(!apiCalls.some((c) => c.path.startsWith('/api/saves')), '存档暂停时不该再调存档接口');
    const c = (await controls(ctx)).cloud;
    if (c) {
      if (PHONE) await longPress(ctx, 'cloud');
      else await hover(ctx, c.x, c.y);
    }
    await shot(ctx, 'c3-cloud-paused-tip');
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.5.10 每日排行榜

/** 北京日期（和游戏里每日挑战的日期一个算法） */
function beijingToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 每日排行榜（假平台接口，不连真的平台）：
 * - 每日挑战面板 →「排行榜」：前 50 名分页、我不在前 50 时单独一行，切到好友；关掉回到每日挑战面板；
 * - 一局真实行情的每日挑战打完：结束页交一次分（带 gameId、榜单、分数、userId，keepalive），再读一次榜显示名次；
 * - 交分时连不上：显示「重试」，点了再交；
 * - 退回模拟行情的一局：不交分，说明不计入排行。
 */
async function boardShots(browser: Browser): Promise<void> {
  const today = beijingToday();
  const boardId = `daily-${today}`;
  const press = (ctx: Ctx, key: string): Promise<void> => (PHONE ? tap(ctx, key) : click(ctx, key));
  const names = ['老王', '张姐', '股市小诸葛', '韭菜收割机', '小李', '阿强', '老赵', '宝妈', '大V', '小白'];
  const entries = (n: number, meAt: number | null) =>
    Array.from({ length: n }, (_, i) => ({
      rank: i + 1,
      displayName: i + 1 === meAt ? '冒烟' : `${names[i % names.length]}${i >= names.length ? i : ''}`,
      avatar: null,
      score: i < n / 2 ? dailyScore(true, 9_000_000 - i * 120_000, 12) : dailyScore(false, 0, 11 - Math.floor((i - n / 2) / 3)),
      isMe: i + 1 === meAt,
    }));
  const calls: { method: string; path: string; search: string; body: unknown; headers: Record<string, string> }[] = [];
  let scoresDown = false;
  const fake = async (route: Route): Promise<void> => {
    const req = route.request();
    const u = new URL(req.url());
    calls.push({ method: req.method(), path: u.pathname, search: u.search, body: req.postDataJSON() as unknown, headers: req.headers() });
    if (u.pathname === '/api/me') return route.fulfill({ json: { user: { id: 'smoke-user', username: 'smoke', displayName: '冒烟' }, service: 'ok', saves: 'ok' } });
    if (u.pathname === '/api/saves/kaipan' && req.method() === 'GET') return route.fulfill({ json: { saves: [] } });
    if (req.method() === 'PUT') return route.fulfill({ json: { rev: 1, updatedAt: 2 } });
    if (u.pathname === '/api/scores') {
      if (scoresDown) return route.abort('failed');
      const body = req.postDataJSON() as { score: number };
      return route.fulfill({ json: { best: body.score, improved: true } });
    }
    if (u.pathname === `/api/boards/kaipan/${boardId}`) {
      const friends = u.searchParams.get('scope') === 'friends';
      return route.fulfill({ json: friends ? { entries: entries(3, 2), me: { rank: 2, score: entries(3, 2)[1]!.score } } : { entries: entries(50, null), me: { rank: 57, score: dailyScore(false, 0, 6) } } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  };
  {
    const ctx = await openPage(browser, 'board-panel', '', { storage: profileStorage('partial'), api: fake, loginHint: true, touch: PHONE });
    // 0.6.9 今天还没打：「每日挑战」角上写「新题」，不读榜
    await ctx.page.waitForTimeout(400);
    expect(!calls.some((c) => c.path.startsWith('/api/boards/')), '今天没打过，开始菜单不该读榜');
    await shot(ctx, 'b0-title-fresh');
    await press(ctx, 'daily');
    await dialogOpen(ctx, 'daily:board');
    await shot(ctx, 'b1-daily-panel');
    await press(ctx, 'daily:board');
    await dialogOpen(ctx, 'board:next');
    expect(calls.some((c) => c.path === `/api/boards/kaipan/${boardId}` && c.search === '?scope=all'), `应读今天的全站榜 ${boardId}`);
    await shot(ctx, 'b2-board-all');
    await press(ctx, 'board:next');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'b3-board-all-p2');
    await press(ctx, 'board:friends');
    await waitFor(ctx, '好友榜', "!('board:next' in g.controls())");
    await ctx.page.waitForTimeout(300);
    expect(calls.some((c) => c.search === '?scope=friends'), '切到好友应读好友榜');
    await shot(ctx, 'b4-board-friends');
    await ctx.page.keyboard.press('Escape');
    await dialogOpen(ctx, 'daily:start');
    await ctx.page.context().close();
  }
  {
    // 0.6.9 今天打过：开始菜单读一次全站榜，角上写名次（假榜里我排 57）
    calls.length = 0;
    const st = profileStorage('partial');
    const prof = JSON.parse(st['kaipan.profile']!) as { daily: Record<string, unknown> };
    prof.daily = { ...prof.daily, [today]: { persona: dailySetup(today).setup.persona, difficulty: dailySetup(today).setup.difficulty, attempts: 1, won: false, bestAccount: 0, bestMonths: 6 } };
    const ctx = await openPage(browser, 'board-badge', '', { storage: { ...st, 'kaipan.profile': JSON.stringify(prof) }, api: fake, loginHint: true, touch: PHONE });
    await ctx.page.waitForTimeout(800);
    expect(calls.some((c) => c.path === `/api/boards/kaipan/${boardId}` && c.search === '?scope=all'), '今天打过，开始菜单应读今天的全站榜拿名次');
    await shot(ctx, 'b0-title-rank');
    await ctx.page.context().close();
  }
  // 当天的每日挑战，用冻结段池里当天那一段真实行情，机器人打完
  const d = dailySetup(today);
  const seg = dailySegmentId(today)!;
  useMarket(() => loadSegment(seg));
  useExt(true);
  const ended = playRun(d.seed, botByName('smart'), d.setup);
  useMarket(null);
  useExt(false);
  expect(ended.real?.segId === seg, `每日挑战局应是当天那段真实行情（${ended.real?.segId} / ${seg}）`);
  // 真实行情局结束先弹"这段日子"，关掉后再一个个弹成就、解锁
  const closeUnlocks = async (ctx: Ctx): Promise<void> => {
    for (let k = 0; k < 10; k++) {
      try {
        await waitFor(ctx, '结束页弹窗', "'unlock:ok' in g.controls() || 'reveal:close' in g.controls()");
      } catch {
        break;
      }
      await ctx.page.waitForTimeout(300);
      await press(ctx, 'reveal:close' in (await controls(ctx)) ? 'reveal:close' : 'unlock:ok');
      await ctx.page.waitForTimeout(400);
    }
  };
  {
    calls.length = 0;
    scoresDown = false;
    const ctx = await openPage(browser, 'board-end', '', { storage: profileStorage('partial'), api: fake, loginHint: true, touch: PHONE });
    await waitFor(ctx, '云同步', `window.__game?.cloud().state === 'synced'`);
    await loadState(ctx, ended);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await waitFor(ctx, '交分完成', "g.board().state === 'done' && g.board().rank !== undefined");
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/api/scores');
    expect(post.length === 1, `一局只交一次分（${post.length}）`);
    const body = post[0]?.body as { gameId: string; boardId: string; score: number; userId: string } | undefined;
    const want = dailyScore(ended.phase === 'won', ended.account, runSummary(ended).billsPaid);
    expect(!!body && body.gameId === 'kaipan' && body.boardId === boardId && body.score === want && body.userId === 'smoke-user', `交分内容不对：${JSON.stringify(body)}（应是 ${boardId} ${want}）`);
    expect(post[0]?.headers['x-arcade'] === '1', '交分要带 X-Arcade');
    await closeUnlocks(ctx);
    await shot(ctx, 'b5-end-board');
    await press(ctx, 'board');
    await dialogOpen(ctx, 'board:next');
    await shot(ctx, 'b6-end-board-panel');
    await ctx.page.context().close();
  }
  {
    // 交分时连不上：给「重试」，点了再交
    calls.length = 0;
    scoresDown = true;
    const ctx = await openPage(browser, 'board-retry', '', { storage: profileStorage('partial'), api: fake, loginHint: true, touch: PHONE, netErrors: true });
    await waitFor(ctx, '云同步', `window.__game?.cloud().state === 'synced'`);
    await loadState(ctx, ended);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await waitFor(ctx, '交分失败', "g.board().state === 'done' && g.board().result.kind === 'offline'");
    await closeUnlocks(ctx);
    await waitFor(ctx, '重试按钮', "'board:retry' in g.controls()");
    await shot(ctx, 'b7-end-board-offline');
    scoresDown = false;
    await press(ctx, 'board:retry');
    await waitFor(ctx, '重试交上', "g.board().state === 'done' && g.board().result.kind === 'ok'");
    expect(calls.filter((c) => c.path === '/api/scores').length === 2, '重试应再交一次');
    await ctx.page.context().close();
  }
  {
    // 退回模拟行情的一局：不交分
    calls.length = 0;
    const synthetic = playRun(d.seed, botByName('smart'), d.setup);
    const ctx = await openPage(browser, 'board-synthetic', '', { storage: profileStorage('partial'), api: fake, loginHint: true, touch: PHONE });
    await loadState(ctx, synthetic);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await waitFor(ctx, '不计入排行', "g.board().state === 'skip'");
    expect(!calls.some((c) => c.path === '/api/scores'), '模拟行情的局不该交分');
    await ctx.page.context().close();
  }
  {
    // 0.5.11 调试局（不计入档案）：不交分，排行一行写"每日排行 月/日"（0.5.12）、留「排行榜」入口
    calls.length = 0;
    const ctx = await openPage(browser, 'board-none', 'debug=1', { storage: profileStorage('partial'), api: fake, loginHint: true, touch: PHONE });
    await loadState(ctx, ended);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await closeUnlocks(ctx);
    await waitFor(ctx, '排行榜按钮', "g.board().state === 'none' && 'board' in g.controls()");
    expect(!calls.some((c) => c.path === '/api/scores'), '调试局不该交分');
    const rowText = `每日排行 ${String(ended.setup?.daily).slice(5).replace('-', '/')}`;
    const shown = (await ctx.page.evaluate(() => window.__game?.displayList() ?? [])) as string[];
    expect(shown.includes(`text:${rowText}`), `排行一行应写「${rowText}」`);
    await shot(ctx, 'b8-end-board-none');
    await ctx.page.context().close();
  }
  {
    // 0.5.11 云同步没确认账号（第一次问 /api/me 时平台暂停），结束时交分还在问账号就点「大厅」：等交分发出去再走
    calls.length = 0;
    let mes = 0;
    let releaseMe: () => void = () => undefined;
    const meHeld = new Promise<void>((r) => (releaseMe = r));
    const slowMe = async (route: Route): Promise<void> => {
      if (new URL(route.request().url()).pathname === '/api/me' && mes++ === 0) return route.fulfill({ status: 503, json: { error: 'busy' } });
      if (new URL(route.request().url()).pathname === '/api/me') await meHeld;
      return fake(route);
    };
    // 带个参数：页面地址有查询串，才分得清还在本页还是到了大厅 /
    const ctx = await openPage(browser, 'board-lobby', 'anim=0', { storage: profileStorage('partial'), api: slowMe, loginHint: true, touch: PHONE, netErrors: true });
    await ctx.page.route((u) => u.pathname === '/' && u.search === '', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>lobby</title>' }));
    await loadState(ctx, ended);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await closeUnlocks(ctx);
    expect(mes === 2 && (await ctx.page.evaluate(() => window.__game?.board().state)) === 'sending', `交分应在等账号（问了 ${mes} 次 /api/me）`);
    await press(ctx, 'lobby');
    await ctx.page.waitForTimeout(300);
    expect(new URL(ctx.page.url()).search !== '', '交分还在问账号时不该马上走');
    // 等的这一会儿有"正在离开……"（0.5.12）
    expect(await ctx.page.evaluate(() => [...document.querySelectorAll('.kp-banner')].some((e) => e.textContent === '正在离开……')), '等交分时应提示正在离开');
    releaseMe();
    await ctx.page.waitForURL((u) => u.pathname === '/' && u.search === '', { timeout: 5000 });
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/api/scores');
    expect(post.length === 1 && (post[0]?.body as { userId?: string } | undefined)?.userId === 'smoke-user', `回大厅前应把分交出去（${JSON.stringify(post.map((c) => c.body))}）`);
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.6.0 实盘

/** 冒烟用的假钱包：浏览器看钱包（GET /api/wallet）和开盘 Worker 的三条路（POST /api/live/*，冒烟时游戏在根路径下）。 */
function fakeWallet(balance = 12_340) {
  const tiers: Record<string, number> = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 };
  const w = {
    balance,
    stakes: [] as { game: string; ref: string; tier: string; amount: number; mode: string; at: number; until: number }[],
    calls: [] as { action: string; body: Record<string, unknown>; xArcade: string | undefined }[],
    /** 下一次（或一直）怎么回：'down' 回 503，其余当钱包的错误码回 { ok: false, error } */
    fail: { buyin: null as string | null, settle: null as string | null },
    /** 每日上限：进钱包最多这么多（超出的进 capped） */
    capAt: null as number | null,
    view() {
      return { balance: w.balance, stakes: w.stakes, canRelief: false, writesLeft: 200, caps: {}, fresh: false };
    },
    async route(route: Route): Promise<void> {
      const req = route.request();
      const u = new URL(req.url());
      if (u.pathname === '/api/me') return route.fulfill({ json: { user: { id: 'smoke-user', username: 'smoke', displayName: '冒烟' }, service: 'ok', saves: 'ok' } });
      if (u.pathname === '/api/saves/kaipan' && req.method() === 'GET') return route.fulfill({ json: { saves: [] } });
      if (req.method() === 'PUT') return route.fulfill({ json: { rev: 1, updatedAt: 2 } });
      if (u.pathname === '/api/wallet') return route.fulfill({ json: { wallet: w.view(), tiers, reliefTo: 2_000 } });
      const m = /^\/api\/live\/(buyin|settle|refund)$/.exec(u.pathname);
      if (!m || req.method() !== 'POST') return route.fulfill({ status: 404, json: { ok: false, error: 'not_found' } });
      const action = m[1] as 'buyin' | 'settle' | 'refund';
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      w.calls.push({ action, body, xArcade: req.headers()['x-arcade'] });
      const f = action === 'refund' ? null : w.fail[action];
      if (f === 'down') return route.fulfill({ status: 503, json: { ok: false, error: 'unavailable' } });
      if (f) return route.fulfill({ json: { ok: false, error: f, wallet: w.view() } });
      const ref = String(body.ref);
      const i = w.stakes.findIndex((x) => x.game === 'kaipan' && x.ref === ref);
      if (action === 'buyin') {
        const amount = tiers[String(body.tier)] ?? 0;
        if (w.balance < amount) return route.fulfill({ json: { ok: false, error: 'no_funds', wallet: w.view() } });
        w.balance -= amount;
        w.stakes.push({ game: 'kaipan', ref, tier: String(body.tier), amount, mode: 'client', at: Date.now(), until: Date.now() + 86_400_000 });
        return route.fulfill({ json: { ok: true, wallet: w.view() } });
      }
      if (i < 0) return route.fulfill({ json: { ok: false, error: 'no_stake', wallet: w.view() } });
      const stake = w.stakes[i]!;
      w.stakes.splice(i, 1);
      const amount = action === 'refund' ? stake.amount : Math.floor(((tiers[String(body.tier)] ?? 0) * Number(body.bp)) / 10_000);
      const credited = w.capAt !== null ? Math.min(amount, w.capAt) : amount;
      w.balance += credited;
      return route.fulfill({ json: { ok: true, credited, capped: amount - credited, wallet: w.view() } });
    },
  };
  return w;
}

/**
 * 实盘（设计稿第 8 节第 5 步）：假钱包跑一遍"带入 → 打完半年 → 结回"、"还没开盘就收手 → 原样退回"、"打到一半刷新 → 接着打 → 结回"、
 * "结回连不上 / 钱包忙 / 平台内部出错 → 重试"、"放太久 → 改成不算筹码"、"带入没等到回话 → 下次先收回"、"另一台设备上有一局"。
 */
async function liveShots(browser: Browser): Promise<void> {
  const press = (ctx: Ctx, key: string): Promise<void> => (PHONE ? tap(ctx, key) : click(ctx, key));
  const texts = async (ctx: Ctx): Promise<string[]> => (await ctx.page.evaluate(() => window.__game?.displayList() ?? [])).filter((t) => t.startsWith('text:')).map((t) => t.slice(5));
  const hasText = async (ctx: Ctx, part: string): Promise<boolean> => (await texts(ctx)).some((t) => t.includes(part));
  const rec = (ctx: Ctx) => ctx.page.evaluate(() => window.__game?.live() ?? null);
  const startLive = async (ctx: Ctx, tier: string): Promise<void> => {
    await press(ctx, 'live');
    await dialogOpen(ctx, `setup:tier:${tier}`);
    await press(ctx, `setup:tier:${tier}`);
    await ctx.page.waitForTimeout(200);
    await press(ctx, 'setup:start');
    await waitIdle(ctx, '实盘开局', "window.__game.scene === 'trade'");
  };
  /** 在 node 里把这局（同一种子、同一设置）打完，交给画面 */
  const finished = (s: GameState): GameState => {
    useMarket(null);
    useExt(true);
    const end = playRun(s.seed, botByName('normal'), s.setup);
    useExt(false);
    return end;
  };
  const opts = (w: ReturnType<typeof fakeWallet>, net = false): OpenOpts => ({ storage: profileStorage('partial'), api: (r) => w.route(r), loginHint: true, touch: PHONE, netErrors: net });

  // A. 带入 → 打完半年 → 结回
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-full', '', opts(w));
    await shot(ctx, 'l0-title');
    await press(ctx, 'live');
    await dialogOpen(ctx, 'setup:tier:small');
    expect(await hasText(ctx, '钱包 12,340 筹码（无任何现金价值）'), `开局面板应写钱包余额（${(await texts(ctx)).join(' | ')}）`);
    await press(ctx, 'setup:tier:mid');
    await ctx.page.waitForTimeout(200);
    expect(await hasText(ctx, '带 10,000 进场'), '开始按钮应写"带 10,000 进场"');
    await shot(ctx, 'l1-setup-live');
    await press(ctx, 'setup:start');
    await waitIdle(ctx, '实盘开局', "window.__game.scene === 'trade'");
    const r = await rec(ctx);
    const buy = w.calls.find((c) => c.action === 'buyin');
    expect(!!r && r.step === 'playing' && r.tier === 'mid' && r.stake === 10_000, `带入后记录应是 playing（${JSON.stringify(r)}）`);
    expect(!!buy && buy.body.ref === r?.ref && buy.body.tier === 'mid' && buy.xArcade === '1' && Object.keys(buy.body).sort().join() === 'ref,tier', `带入只传 ref 和 tier、带 X-Arcade（${JSON.stringify(buy)}）`);
    const st = await state<GameState>(ctx, 'window.__game.state()');
    expect(st.seed === r?.seed && st.setup?.live?.months === 6 && st.difficulty === 2, `中档是半年、难度 2（${JSON.stringify(st.setup)}）`);
    await waitFor(ctx, '顶栏的实盘小牌子', `g.displayList().some((t) => t === 'text:${PHONE ? '实盘中档 → 约 10,000' : '实盘 · 中档 10,000 → 约 10,000'}')`);
    await shot(ctx, 'l2-trade-badge');
    const end = finished(st);
    const bp = runSummary(end).live?.bp ?? -1;
    await loadState(ctx, end);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await waitFor(ctx, '结回', "g.live()?.step === 'done'");
    const settle = w.calls.find((c) => c.action === 'settle');
    expect(!!settle && settle.body.ref === r?.ref && settle.body.bp === bp && settle.body.tier === 'mid', `结回应传这局的倍数 ${bp}（${JSON.stringify(settle?.body)}）`);
    const got = Math.floor((10_000 * bp) / 10_000);
    await ctx.page.waitForTimeout(400);
    expect(await hasText(ctx, `结回 ${got.toLocaleString('en-US')} 筹码`), `结束页应写结回 ${got}（${(await texts(ctx)).join(' | ')}）`);
    const c = await controls(ctx);
    expect('menu' in c && !('retry' in c) && !('new' in c), `实盘结束页只有「回开始菜单」（${Object.keys(c).join(',')}）`);
    for (const word of ['回本', '翻本', '再来一把', '就差一点', '马上', '限时']) expect(!(await texts(ctx)).some((t) => t.includes(word)), `结束页不该出现"${word}"`);
    await shot(ctx, 'l3-end-settled');
    await press(ctx, 'menu');
    await waitIdle(ctx, '开始菜单', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(300);
    expect(!('notice:ok' in (await controls(ctx))), '结束页说过的结果，开始菜单不再弹');
    await ctx.page.context().close();
  }

  // B. 还没开盘就收手 → 原样退回
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-refund', '', opts(w));
    await startLive(ctx, 'small');
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:quit-live');
    await shot(ctx, 'l4-settings-quit');
    // 设置里改过东西（关掉时要重建画面）再点收手，确认框照样出来
    await ctx.page.evaluate(() => localStorage.setItem('kaipan.view.prefs', JSON.stringify({ hints: 'auto', recap: 'full', autoQuiet: false })));
    await press(ctx, 'settings:quit-live');
    await dialogOpen(ctx, 'confirm:ok');
    expect(await hasText(ctx, '原样退回'), '还没开盘收手应说原样退回');
    await press(ctx, 'confirm:ok');
    await waitIdle(ctx, '回开始菜单', "window.__game.scene === 'title'");
    await dialogOpen(ctx, 'notice:ok');
    const r = await rec(ctx);
    expect(w.calls.some((c) => c.action === 'refund' && c.body.ref === r?.ref) && !w.calls.some((c) => c.action === 'settle'), '还没开盘收手应走 refund');
    expect(r?.step === 'done' && r.kind === 'refund' && r.credited === 2_000 && w.balance === 12_340, `应原样退回（${JSON.stringify(r)}，余额 ${w.balance}）`);
    expect(await hasText(ctx, '退回 2,000 筹码'), '开始菜单应说退回了多少');
    await shot(ctx, 'l5-title-refund');
    await press(ctx, 'notice:ok');
    await ctx.page.waitForTimeout(300);
    expect(!('continue' in (await controls(ctx))), '收手后这局不能再继续');
    await ctx.page.context().close();
  }

  // C. 打到一半刷新 → 接着打 → 结回；开盘以后收手按现在的资产结
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-resume', '', opts(w));
    await startLive(ctx, 'small');
    await dispatch2(ctx, { type: 'open' });
    await ctx.page.reload();
    await waitIdle(ctx, '刷新后', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(400);
    expect(await hasText(ctx, '继续 · 实盘 1月'), `刷新后「继续」应写实盘（${(await texts(ctx)).join(' | ')}）`);
    await shot(ctx, 'l6-title-resume');
    // 实盘没打完时开别的局：先问继续还是收手
    await press(ctx, 'quick');
    await dialogOpen(ctx, 'live:continue');
    await shot(ctx, 'l6b-guard');
    await press(ctx, 'live:continue');
    await waitIdle(ctx, '接着打', "window.__game.scene === 'trade'");
    const st = await state<GameState>(ctx, 'window.__game.state()');
    expect(st.dayIndex === 1, '接着打的是刷新前那一局');
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:quit-live');
    await press(ctx, 'settings:quit-live');
    await dialogOpen(ctx, 'confirm:ok');
    expect(await hasText(ctx, '按现在的资产结算'), '开盘以后收手应按现在的资产结');
    await press(ctx, 'confirm:ok');
    await waitIdle(ctx, '回开始菜单', "window.__game.scene === 'title'");
    const settle = w.calls.find((c) => c.action === 'settle');
    expect(!!settle && typeof settle.body.bp === 'number' && !w.calls.some((c) => c.action === 'refund'), `开盘以后收手走 settle（${JSON.stringify(w.calls.map((c) => c.action))}）`);
    // 0.6.7 提前收手也带战绩小结（0.6.5 线上验证时发现漏了）
    const quitStats = (settle?.body as { stats?: { rounds?: number } } | undefined)?.stats;
    expect(quitStats?.rounds === 1, `提前收手的结回也带战绩小结（${JSON.stringify(settle?.body)}）`);
    await ctx.page.context().close();
  }

  // D. 结回连不上 → 钱包忙 → 平台内部出错 → 联网后结上
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-retry', '', opts(w, true));
    await startLive(ctx, 'small');
    const st = await state<GameState>(ctx, 'window.__game.state()');
    w.fail.settle = 'down';
    await loadState(ctx, finished(st));
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await waitFor(ctx, '待结', "g.live()?.step === 'settling' && g.live()?.wait === 'offline'");
    await ctx.page.waitForTimeout(400);
    expect(await hasText(ctx, '成绩记下了，联网后自动结回'), '连不上时结束页说联网后自动结回');
    await shot(ctx, 'l7-end-settling');
    for (const f of ['busy', 'internal']) {
      w.fail.settle = f;
      const n = w.calls.length;
      await ctx.page.evaluate(() => window.dispatchEvent(new Event('online')));
      await waitFor(ctx, `重发（${f}）`, 'true');
      await ctx.page.waitForTimeout(300);
      expect(w.calls.length === n + 1 && (await rec(ctx))?.step === 'settling', `${f} 应留在 settling 之后重试`);
    }
    w.fail.settle = null;
    w.capAt = 1_000;
    await ctx.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(ctx, '结上了', "g.live()?.step === 'done'");
    const refs = new Set(w.calls.filter((c) => c.action === 'settle').map((c) => c.body.ref));
    expect(refs.size === 1, '重发的都是同一个 ref');
    await ctx.page.waitForTimeout(400);
    expect(await hasText(ctx, '实盘赢够了'), '到顶时结束页说没进钱包的数');
    // 0.6.5 结回带着战绩小结（平台 5.10），重发时一样
    const stats = w.calls.filter((c) => c.action === 'settle').map((c) => JSON.stringify((c.body as { stats?: unknown }).stats ?? null));
    expect(stats.length > 0 && stats[0] !== 'null' && new Set(stats).size === 1, `结回带着同一份战绩小结：${stats[0]}`);
    await shot(ctx, 'l8-end-capped');
    await ctx.page.context().close();
  }

  // E. 放超过一天 → 不算筹码，接着玩
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-expired', '', opts(w));
    await startLive(ctx, 'small');
    await ctx.page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('kaipan.live') ?? '{}') as { until: number };
      r.until = Date.now() - 1000;
      localStorage.setItem('kaipan.live', JSON.stringify(r));
    });
    await ctx.page.reload();
    await waitIdle(ctx, '刷新后', "window.__game.scene === 'title'");
    await dialogOpen(ctx, 'notice:ok');
    expect(await hasText(ctx, '已经原样退回钱包'), '过期应说本金已原样退回');
    expect((await rec(ctx))?.step === 'void' && !w.calls.some((c) => c.action !== 'buyin'), '过期不再找钱包结');
    await shot(ctx, 'l9-title-expired');
    await press(ctx, 'notice:ok');
    await ctx.page.waitForTimeout(300);
    expect(await hasText(ctx, '继续 · 1月'), '过期的局照样能接着玩（不再写实盘）');
    await ctx.page.context().close();
  }

  // F. 带入没等到回话 → 记成 buying，下次打开面板先收回；另一台设备上有一局 → 开不了
  {
    const w = fakeWallet();
    w.fail.buyin = 'down';
    const ctx = await openPage(browser, 'live-buying', '', opts(w, true));
    await press(ctx, 'live');
    await dialogOpen(ctx, 'setup:tier:small');
    await press(ctx, 'setup:start');
    await dialogOpen(ctx, 'notice:ok');
    expect(await hasText(ctx, '钱包暂时连不上'), '带入连不上应提示');
    expect((await rec(ctx))?.step === 'buying' && (await state<string>(ctx, 'window.__game.scene')) === 'title', '带入连不上不开局、记成 buying');
    const ref = (await rec(ctx))?.ref;
    await press(ctx, 'notice:ok');
    w.fail.buyin = null;
    w.stakes.push({ game: 'kaipan', ref: 'kaipan-elsewhere-0000', tier: 'small', amount: 2_000, mode: 'client', at: Date.now(), until: Date.now() + 86_400_000 });
    await press(ctx, 'live');
    await dialogOpen(ctx, 'setup:tier:small');
    expect(w.calls.some((c) => c.action === 'refund' && c.body.ref === ref) && (await rec(ctx)) === null, '再打开面板前先收回没开成的那一份');
    // 0.6.8 桌上有别处的一份不再拦开新局：提示一句，给「回去接着打」「原样退回」
    expect(await hasText(ctx, '你还有一局实盘没结（2,000 筹码）'), '另一台设备上有一局时应提示还有一局没结');
    const c0 = await controls(ctx);
    expect('setup:aside:resume' in c0 && 'setup:aside:refund' in c0, `给「回去接着打」「原样退回」（${Object.keys(c0).join(',')}）`);
    await shot(ctx, 'l10-setup-elsewhere');
    await press(ctx, 'setup:aside:refund');
    await dialogOpen(ctx, 'confirm:ok');
    await press(ctx, 'confirm:ok');
    await dialogOpen(ctx, 'setup:tier:small');
    expect(w.calls.some((c) => c.action === 'refund' && c.body.ref === 'kaipan-elsewhere-0000'), '「原样退回」退的是别处那一份');
    expect(!(await hasText(ctx, '你还有一局实盘没结')), '退回以后不再提示');
    await press(ctx, 'setup:start');
    await waitIdle(ctx, '照样能开新的一局', "window.__game.scene === 'trade'");
    expect(w.calls.filter((c) => c.action === 'buyin').length === 2, '退回以后开得了新的一局');
    await ctx.page.context().close();
  }

  // F2. 娱乐局打到一半去开实盘：先问"开一局新的？"，确认了才带入
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-over-fun', '', opts(w));
    await press(ctx, 'quick');
    await waitIdle(ctx, '娱乐开局', "window.__game.scene === 'trade'");
    await dispatch2(ctx, { type: 'open' });
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:menu');
    expect(!('settings:quit-live' in (await controls(ctx))), '娱乐局的设置里没有「提前收手」');
    await press(ctx, 'settings:menu');
    await waitIdle(ctx, '开始菜单', "window.__game.scene === 'title'");
    await press(ctx, 'live');
    await dialogOpen(ctx, 'setup:tier:small');
    await press(ctx, 'setup:start');
    await dialogOpen(ctx, 'confirm:ok');
    expect(w.calls.length === 0, '确认之前不带入');
    await press(ctx, 'confirm:ok');
    await waitIdle(ctx, '实盘开局', "window.__game.scene === 'trade'");
    expect(w.calls.filter((c) => c.action === 'buyin').length === 1 && (await rec(ctx))?.step === 'playing', '确认后带入、开局');
    await ctx.page.context().close();
  }

  // G. 没登录：「实盘」是灰的
  {
    const w = fakeWallet();
    const ctx = await openPage(browser, 'live-out', '', { storage: profileStorage('partial'), api: (r) => w.route(r), touch: PHONE });
    await press(ctx, 'live');
    await ctx.page.waitForTimeout(400);
    expect(!('setup:start' in (await controls(ctx))) && w.calls.length === 0, '没登录点「实盘」不开面板');
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.5.9 省内存设备

/**
 * iOS 上内存超了网页进程会崩（"网页已崩溃"）。触屏设备的渲染倍数封顶 2（用 2 倍图集）、整屏背景按 1 倍光栅化：
 * 按 iPhone 8 Plus（DPR 3）和 iPad Pro（1366×1024@2）的触屏配置打开，断言倍数、图集、显存估算不超预算，截图看清不清楚。
 */
async function lowMemShots(browser: Browser): Promise<void> {
  /** 纹理 + 文字画布 + 主画布，每像素 4 字节；修之前约 390–870 MB，修之后约 170 MB */
  const BUDGET_MB = 260;
  const devices = [
    { name: 'iphone8plus', screen: { width: 736, height: 414, dpr: 3 } },
    { name: 'ipadpro', screen: { width: 1366, height: 1024, dpr: 2 } },
  ];
  // 看得见的高度比屏幕小 80（iOS Safari 横屏带着地址栏、标签栏）：画布按看得见的铺，顶上的按钮都在里面
  {
    const visible = { width: 667, height: 375 - 80 };
    const ctx = await openPage(browser, 'lowmem-toolbar', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`, { touch: true, screen: { width: 667, height: 375, dpr: 2 }, visible });
    await waitIdle(ctx, 'trade', "window.__game.scene === 'trade'");
    await ctx.page.waitForTimeout(500);
    const c = await controls(ctx);
    for (const k of ['settings', 'help', 'tab:msgs', 'tab:recs', 'tab:board']) {
      const p = c[k];
      expect(!!p, `顶部应有控件 ${k}`);
      if (!p) continue;
      const q = await toPage(ctx, p.x, p.y);
      expect(q.y >= 0 && q.y <= visible.height && q.x >= 0 && q.x <= visible.width, `${k} 应在看得见的区域里（${Math.round(q.x)},${Math.round(q.y)}，可见 ${visible.width}×${visible.height}）`);
    }
    const box = await ctx.page.locator('canvas').boundingBox();
    expect(!!box && box.y >= 0 && box.y + box.height <= visible.height + 1, `画布应在看得见的区域里（${JSON.stringify(box)}）`);
    await shot(ctx, 'm-toolbar-trade');
    // 双指放大（visualViewport.scale = 2，看得见的宽高减半）：画布不跟着缩、不抖（#45 审阅）
    const before = { box: await ctx.page.locator('canvas').boundingBox(), h: await ctx.page.evaluate(() => document.documentElement.style.getPropertyValue('--app-h')) };
    await ctx.page.evaluate(() => {
      const vv = window.visualViewport!;
      const w = vv.width;
      const h = vv.height;
      Object.defineProperty(vv, 'scale', { configurable: true, get: () => 2 });
      Object.defineProperty(vv, 'width', { configurable: true, get: () => w / 2 });
      Object.defineProperty(vv, 'height', { configurable: true, get: () => h / 2 });
      vv.dispatchEvent(new Event('resize'));
    });
    await ctx.page.waitForTimeout(600);
    const after = { box: await ctx.page.locator('canvas').boundingBox(), h: await ctx.page.evaluate(() => document.documentElement.style.getPropertyValue('--app-h')) };
    expect(JSON.stringify(after) === JSON.stringify(before), `双指放大时画布不该变（${JSON.stringify(before)} → ${JSON.stringify(after)}）`);
    // WebGL 上下文丢了：很快恢复就不提示；3 秒没恢复才提示一条，恢复后收起（#45 审阅）
    const banners = (): Promise<number> => ctx.page.evaluate(() => document.querySelectorAll('.kp-banner').length);
    const lose = await ctx.page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2') ?? document.querySelector('canvas')?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
      ext.loseContext();
      return true;
    });
    if (lose) {
      await ctx.page.waitForTimeout(300);
      await ctx.page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
      await ctx.page.waitForTimeout(3500);
      expect((await banners()) === 0, '上下文很快恢复时不该提示');
      await ctx.page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.loseContext());
      await ctx.page.waitForTimeout(3500);
      expect((await banners()) === 1, `3 秒没恢复应提示一条（${await banners()}）`);
      await ctx.page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
      await ctx.page.waitForTimeout(500);
      expect((await banners()) === 0, '恢复后提示应收起');
    } else notes.push('这个浏览器没有 WEBGL_lose_context，跳过上下文丢失的检查');
    await ctx.page.context().close();
  }
  // iOS Safari：开始菜单底下「添加到主屏幕玩更大」，点 × 关掉后记住、不再出现
  {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
    const ctx = await openPage(browser, 'lowmem-hometip', '', { touch: true, screen: { width: 667, height: 375, dpr: 2 }, userAgent: ua });
    await waitIdle(ctx, 'title', "window.__game.scene === 'title'");
    const tip = ctx.page.locator('#home-tip');
    expect(await tip.isVisible(), 'iOS Safari 的开始菜单应提示添加到主屏幕');
    await shot(ctx, 'm-home-tip');
    await tip.locator('button').tap();
    expect(!(await tip.isVisible()), '点 × 应关掉提示');
    expect((await ctx.page.evaluate(() => localStorage.getItem('kaipan.homeTip.off'))) === '1', '关掉后应记在 kaipan.homeTip.off');
    await ctx.page.reload();
    await waitIdle(ctx, 'title', "window.__game.scene === 'title'");
    expect(!(await tip.isVisible()), '关掉过就不再提示');
    await ctx.page.context().close();
  }
  for (const d of devices) {
    for (const [scene, query] of [['title', ''], ['trade', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`]] as const) {
      const ctx = await openPage(browser, `lowmem-${d.name}-${scene}`, query, { touch: true, screen: d.screen });
      await waitIdle(ctx, scene, `window.__game.scene === '${scene}'`);
      await ctx.page.waitForTimeout(800);
      const r = await ctx.page.evaluate(() => {
        const g = window.__game!;
        const a = g.atlas() as unknown as Record<string, { status: string }>;
        return { scale: g.renderScale, game: a.game?.status, meta: a.meta?.status, mem: g.memory() };
      });
      const mb = Math.round(((r.mem.texturePx + r.mem.textPx + r.mem.canvasPx) * 4) / 1e6);
      notes.push(`省内存设备 ${d.name} ${scene}：渲染 ${r.scale} 倍，图集 ${r.game}/${r.meta}，估算 ${mb} MB（纹理 ${r.mem.textures} 个）`);
      expect(r.scale === 2, `${d.name}：触屏设备渲染倍数应封顶 2（实际 ${r.scale}）`);
      expect(r.game === 'used', `${d.name}：应用 2 倍图集（实际 ${r.game}）`);
      expect(mb <= BUDGET_MB, `${d.name} ${scene}：显存估算 ${mb} MB 超过预算 ${BUDGET_MB} MB`);
      await shot(ctx, `m-${d.name}-${scene}`);
      await ctx.page.context().close();
    }
  }
}

// ---------------------------------------------------------------- 0.5.8 回大厅

/**
 * 「大厅」跳平台首页 `/`：只断言地址（拦下 / 的请求，回一页空白），不加载平台的页面。
 * 开始菜单左上角直接走；对局里齿轮 → 回大厅先确认（取消留在这局）；竖屏提示层左上角，对局中先在卡片里问一次。
 */
async function lobbyShots(browser: Browser): Promise<void> {
  const atLobby = async (ctx: Ctx, why: string): Promise<void> => {
    try {
      await ctx.page.waitForURL((u) => u.pathname === '/' && u.search === '', { timeout: 5000 });
    } catch {
      expect(false, `${why}：应跳到大厅 /（现在是 ${ctx.page.url()}）`);
    }
  };
  // 拦下大厅（游戏页带着查询参数打开，地址不会和大厅一样）
  const stubLobby = (ctx: Ctx): Promise<void> => ctx.page.route((u) => u.pathname === '/' && u.search === '', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>lobby</title>' }));
  const press = (ctx: Ctx, key: string): Promise<void> => (PHONE ? tap(ctx, key) : click(ctx, key));
  {
    // 开始菜单：左上角「大厅」，不在一局里，点了直接走
    const ctx = await openPage(browser, 'lobby-title', PHONE ? '' : 'layout=desktop', { touch: PHONE });
    expect('lobby' in (await controls(ctx)), '开始菜单应有「大厅」');
    await shot(ctx, 'l1-title-lobby', { x: 0, y: 0, width: PHONE ? 422 : 640, height: PHONE ? 195 : 360 });
    await stubLobby(ctx);
    await press(ctx, 'lobby');
    await atLobby(ctx, '开始菜单点「大厅」');
    await ctx.page.context().close();
  }
  {
    // 对局里：齿轮 → 回大厅 → 确认框；取消留在这局，确认才走
    const ctx = await openPage(browser, 'lobby-run', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`, { touch: PHONE });
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:lobby');
    await shot(ctx, 'l2-settings-lobby');
    await press(ctx, 'settings:lobby');
    await dialogOpen(ctx, 'confirm:ok');
    await shot(ctx, 'l3-lobby-confirm');
    await press(ctx, 'confirm:cancel');
    await ctx.page.waitForTimeout(300);
    expect((await ctx.page.evaluate(() => window.__game?.scene)) === 'trade' && new URL(ctx.page.url()).search !== '', '取消后应留在这局');
    // 取消后还能接着玩：买一只
    const held = 's.slots.filter((x) => x).length';
    const before = await state<number>(ctx, held);
    await buyVia(ctx, 'buy:0', PHONE);
    await waitIdle(ctx, '取消回大厅后买入');
    expect((await state<number>(ctx, held)) === before + 1, '取消回大厅后应能接着买');
    // 改过设置（平淡日改手动，关掉设置框时要重建画面）再点回大厅：确认框也得出来（#41 审阅）
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:lobby');
    if (!('settings:quiet-manual' in (await controls(ctx)))) await press(ctx, 'settings:tab-1');
    await ctx.page.waitForTimeout(200);
    await press(ctx, 'settings:quiet-manual');
    await press(ctx, 'settings:lobby');
    await dialogOpen(ctx, 'confirm:ok');
    // 取消：这时再按改过的设置重建画面，还在这局
    await press(ctx, 'confirm:cancel');
    await waitIdle(ctx, '取消后重建画面');
    await ctx.page.waitForTimeout(300);
    expect((await ctx.page.evaluate(() => window.__game?.scene)) === 'trade', '改过设置后取消回大厅，应留在这局');
    await stubLobby(ctx);
    await press(ctx, 'settings');
    await dialogOpen(ctx, 'settings:lobby');
    await press(ctx, 'settings:lobby');
    await dialogOpen(ctx, 'confirm:ok');
    await press(ctx, 'confirm:ok');
    await atLobby(ctx, '对局里确认回大厅');
    await ctx.page.context().close();
  }
  {
    // 结束页：左上角「大厅」直接走（这局已经结束、记进档案了）
    const ended = playRun('lobby-end', botByName('smart'), { persona: 'newbie', difficulty: 1 });
    const ctx = await openPage(browser, 'lobby-end', PHONE ? '' : 'layout=desktop', { storage: profileStorage('partial'), touch: PHONE });
    await loadState(ctx, ended);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    // 成就、解锁弹窗一个接一个弹：等着一个个关掉
    for (let k = 0; k < 8; k++) {
      try {
        await waitFor(ctx, '达成弹窗', "'unlock:ok' in g.controls()");
      } catch {
        break;
      }
      await ctx.page.waitForTimeout(300);
      await press(ctx, 'unlock:ok');
      await ctx.page.waitForTimeout(400);
    }
    expect('lobby' in (await controls(ctx)), '结束页应有「大厅」');
    await shot(ctx, 'l5-end-lobby');
    await stubLobby(ctx);
    await press(ctx, 'lobby');
    await atLobby(ctx, '结束页点「大厅」');
    await ctx.page.context().close();
  }
  if (!PHONE) {
    // 竖屏提示层：一局进行中，点「大厅」先在卡片里问；「留下」收起，「回大厅」才走
    const ctx = await openPage(browser, 'lobby-portrait', `seed=pre-1&anim=0&${setupQuery(BASIC_SETUP)}`, { touch: true, screen: { width: 390, height: 844, dpr: 2 } });
    await ctx.page.waitForTimeout(600);
    const lobby = ctx.page.locator('#rotate-hint .rh-lobby');
    expect(await lobby.isVisible(), '竖屏提示层左上角应有「大厅」');
    await lobby.tap();
    expect(await ctx.page.locator('#rotate-hint .rh-ask').isVisible(), '一局进行中点「大厅」应先问一次');
    await shot(ctx, 'l4-portrait-lobby-ask');
    await ctx.page.locator('#rotate-hint .rh-ask button', { hasText: '留下' }).tap();
    expect(!(await ctx.page.locator('#rotate-hint .rh-ask').isVisible()), '点「留下」应收起');
    await stubLobby(ctx);
    await lobby.tap();
    await ctx.page.locator('#rotate-hint .rh-go').tap();
    await atLobby(ctx, '竖屏提示层确认回大厅');
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.3.1 看得懂、说人话

/** 说明书、词典、新手提示、收盘小结、拆解条、新闻、台词气泡、新设置面板。截图名 a0–a9。 */
async function friendlyShots(browser: Browser): Promise<void> {
  // A. 说明书三页（开始菜单入口）、词典
  {
    const ctx = await openPage(browser, 'help', '');
    expect('help' in (await controls(ctx)), '开始菜单应有「怎么玩」');
    await click(ctx, 'help');
    await dialogOpen(ctx, 'help:next');
    // 0.4 C 加了第 4 页（买多少、押跌、银行）
    for (let i = 1; i <= 4; i++) {
      await ctx.page.waitForTimeout(250);
      await shot(ctx, i <= 3 ? `a${i}-help-page-${i}` : `a3b-help-page-${i}`);
      await click(ctx, 'help:next');
    }
    await ctx.page.waitForTimeout(250);
    expect(!('help:next' in (await controls(ctx))), '最后一页点「知道了」应关掉说明书');
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    await click(ctx, 'codex:tab:words');
    await ctx.page.waitForTimeout(250);
    // 手机横屏的词典分页，一页 8 条：点第一页里的一条
    await click(ctx, `codex:card:${PHONE ? 4 : 8}`);
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'a4-codex-words');
    await click(ctx, 'codex:close');
    await ctx.page.waitForTimeout(250);
    await click(ctx, 'settings');
    await dialogOpen(ctx, 'settings:done');
    await shot(ctx, 'a5-settings');
    await click(ctx, 'settings:done');
    await ctx.page.context().close();
  }
  // B. 交易画面：新手提示（全新档案默认打开）→ 买入台词 → 开盘 → 小结卡、新闻 → 点持仓卡看拆解条 → 顶栏「怎么玩」
  {
    const ctx = await openPage(browser, 'friendly-day', `seed=pre-1&${setupQuery({ ...BASIC_SETUP })}`);
    const regions = async (): Promise<Record<string, { x: number; y: number; w: number; h: number }>> => (await ctx.page.evaluate(() => window.__game?.regions())) ?? {};
    expect('hint' in (await regions()), '全新档案开盘前应有新手提示');
    await shot(ctx, 'a6-newbie-hint');
    await click(ctx, 'buy:0');
    await ctx.page.waitForTimeout(350);
    expect(Object.keys(await regions()).some((k) => k.startsWith('quip:')), '买入时小人应冒一句台词');
    await shot(ctx, 'a7-quip-bought');
    await waitIdle(ctx, '买入');
    await dispatch2(ctx, { type: 'open' });
    await ctx.page.waitForTimeout(300);
    // 手机横屏：买入时切到了「推荐」页，新闻在「群聊」页里
    await phoneTab(ctx, 'msgs');
    const r = await regions();
    expect('recap:recap' in r, `收盘后应有小结卡（${Object.keys(r).join(',')}）`);
    notes.push(`收盘后：新闻 ${'news' in r ? '有' : '无'}`);
    // 手机横屏：小结和猫共用左下角，猫的话先收着，小结卡上挂一只小猫
    const catWaiting = PHONE && 'recap:cat' in (await controls(ctx));
    expect('hint' in r || catWaiting, `第二天开盘前猫也应该说话（${Object.keys(r).join(',')}）`);
    await shot(ctx, 'a8-recap-card');
    if ('news' in r) {
      // 新闻默认折叠成一行，点开看全文
      expect(!('news:open' in r), '新闻默认应折叠');
      await click(ctx, 'news:toggle');
      await ctx.page.waitForTimeout(200);
      expect('news:open' in (await regions()), '点新闻条应展开');
      await shot(ctx, 'a8b-news', { x: 960, y: 60, width: 320, height: 660 });
      await click(ctx, 'news:toggle');
      await ctx.page.waitForTimeout(150);
    }
    // 小结卡默认两句，点「展开」看全部
    if ('recap:expand' in (await controls(ctx))) {
      await click(ctx, 'recap:expand');
      await ctx.page.waitForTimeout(200);
      await shot(ctx, 'a8c-recap-expanded');
      await click(ctx, 'recap:expand');
      await ctx.page.waitForTimeout(150);
    }
    if (catWaiting) {
      await click(ctx, 'recap:cat');
      await ctx.page.waitForTimeout(250);
      const r2 = await regions();
      expect('hint' in r2 && !('recap:recap' in r2), '点小结卡上的小猫应收起小结、露出猫的提示');
      await shot(ctx, 'a8d-phone-cat-hint');
    }
    // 点第一格小人：拆解条
    const slot = r.slots!;
    await clickAt(ctx, slot.x + 70, slot.y + 110);
    await ctx.page.waitForTimeout(300);
    expect('recap:breakdown' in (await regions()), '点持仓卡应显示拆解条');
    await shot(ctx, 'a9-breakdown');
    await click(ctx, 'help');
    await dialogOpen(ctx, 'help:next');
    await shot(ctx, 'a9b-help-in-game');
    await ctx.page.context().close();
  }
  // C. 收盘时的台词：挑一个持仓涨停的日子，在涨停那一下之后冻结画面
  {
    const found = findDay(LIMIT_SETUP, (ev) => ev.some((e) => e.type === 'quip'), 'quip', 40, (s) => s.dayInMonth < 3);
    const ctx = await openPage(browser, 'quip-close', `seed=${found.seed}&${setupQuery(LIMIT_SETUP)}`);
    await loadState(ctx, found.state);
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await ctx.page.waitForFunction(`(() => { const g = window.__game; return !!g && Object.keys(g.regions()).some((k) => k.startsWith('quip:')); })()`, null, { timeout: WAIT_MS, polling: 30 });
    await ctx.page.evaluate(() => window.__game?.freeze(true));
    await shot(ctx, 'a10-quip-close');
    await ctx.page.evaluate(() => window.__game?.freeze(false));
    notes.push(`收盘台词：开盘后 ${(await clock(ctx)) - t0} ms 内出现`);
    await waitIdle(ctx, '收盘台词之后');
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 长线界面（0.3.0）

/** 档案样本写进 localStorage 的键值（打开页面前）。 */
function profileStorage(kind: 'fresh' | 'partial' | 'all'): Record<string, string> {
  const p = presetProfile(kind);
  return { 'kaipan.profile': JSON.stringify(p.profile), 'kaipan.codex.viewed.v1': JSON.stringify(p.viewed) };
}

async function dialogOpen(ctx: Ctx, key: string): Promise<void> {
  await waitFor(ctx, `对话框 ${key}`, `${JSON.stringify(key)} in g.controls()`);
  await ctx.page.waitForTimeout(250);
}

/** 开始菜单 → 开局面板 / 每日挑战 / 图鉴 / 成就；结束页的达成与解锁弹窗。截图名 8x / 9x。 */
async function metaShots(browser: Browser): Promise<void> {
  // A. 全新档案（用调试桥构造）：标题、开局面板（锁定的人设与难度）、快速开始
  {
    const ctx = await openPage(browser, 'meta-fresh', '');
    await ctx.page.evaluate(() => window.__game?.setProfile('fresh'));
    await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(400);
    await shot(ctx, '80-title-fresh');
    for (const k of ['quick', 'new', 'daily', 'codex', 'achievements', 'settings', 'about']) expect(k in (await controls(ctx)), `开始菜单应有 ${k}`);
    await click(ctx, 'new');
    await dialogOpen(ctx, 'setup:start');
    await shot(ctx, '81-setup-fresh');
    // 点锁定的人设：抖一下并写出解锁条件；点锁定的难度：写出新增约束和解锁条件
    const unlocked = (await ctx.page.evaluate(() => window.__game?.profile().personas ?? [])) as string[];
    const lockedKey = Object.keys(await controls(ctx)).find((k) => k.startsWith('setup:persona:') && !unlocked.includes(k.slice('setup:persona:'.length)));
    expect(!!lockedKey, '全新档案应有锁定的人设');
    await click(ctx, lockedKey!);
    await ctx.page.waitForTimeout(350);
    await click(ctx, 'setup:diff:4');
    await ctx.page.waitForTimeout(350);
    await shot(ctx, '82-setup-locked-click');
    await click(ctx, 'setup:back');
    await ctx.page.waitForTimeout(250);
    await click(ctx, 'quick');
    await waitIdle(ctx, '快速开始', "window.__game.scene === 'trade'");
    const st = await state<{ persona: string; difficulty: number }>(ctx, '({ persona: s.persona, difficulty: s.difficulty })');
    expect(st.persona === 'newbie' && st.difficulty === 1, `第一次快速开始应是新手 + 第 1 级（${JSON.stringify(st)}）`);
    await shot(ctx, '83-trade-topbar-newbie', { x: 0, y: 0, width: 1280, height: 120 });
    await ctx.page.context().close();
  }
  // B. 全解锁档案（调试桥）：标题、开局面板选人设 + 难度开局、图鉴各页、成就页
  {
    const ctx = await openPage(browser, 'meta-all', '');
    await ctx.page.evaluate(() => window.__game?.setProfile('all'));
    await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(400);
    await shot(ctx, '84-title-all');
    await click(ctx, 'new');
    await dialogOpen(ctx, 'setup:start');
    const personas = Object.keys(await controls(ctx)).filter((k) => k.startsWith('setup:persona:'));
    expect(personas.length === 5, `开局面板应有 5 个人设（${personas.length}）`);
    await click(ctx, personas[3]!);
    await click(ctx, 'setup:diff:6');
    await ctx.page.waitForTimeout(300);
    await shot(ctx, '85-setup-all');
    await click(ctx, 'setup:start');
    await waitIdle(ctx, '选人设开局', "window.__game.scene === 'trade'");
    const st = await state<{ persona: string; difficulty: number }>(ctx, '({ persona: s.persona, difficulty: s.difficulty })');
    expect(st.persona === personas[3]!.slice('setup:persona:'.length) && st.difficulty === 6, `应按选择开局（${JSON.stringify(st)}）`);
    await shot(ctx, '86-trade-persona-level6');
    await ctx.page.evaluate(() => window.__game?.toTitle());
    await waitIdle(ctx, '回菜单', "window.__game.scene === 'title'");
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    await shot(ctx, '87-codex-all-stocks');
    await click(ctx, 'codex:tab:achievements');
    await ctx.page.waitForTimeout(300);
    await shot(ctx, '88-achievements-all');
    await click(ctx, 'codex:close');
    await ctx.page.context().close();
  }
  // C. 玩过几局（一半点亮、一部分没看过）：图鉴五个页签（问号卡、「新」角标）、成就页
  {
    const ctx = await openPage(browser, 'meta-partial', '', { storage: profileStorage('partial') });
    await shot(ctx, '89-title-partial');
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    for (const [i, tab] of ['stocks', 'friends', 'items', 'events'].entries()) {
      await click(ctx, `codex:tab:${tab}`);
      await ctx.page.waitForTimeout(300);
      if (tab === 'stocks') await hover(ctx, 120, 260);
      await shot(ctx, `90${'abcd'[i]}-codex-${tab}`);
    }
    await click(ctx, 'codex:close');
    await ctx.page.waitForTimeout(250);
    await click(ctx, 'achievements');
    await dialogOpen(ctx, 'codex:close');
    await shot(ctx, '91-achievements-partial');
    await click(ctx, 'codex:close');
    // 再打开：看过的不再标「新」
    await ctx.page.waitForTimeout(250);
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    await shot(ctx, '90e-codex-stocks-reopen');
    await click(ctx, 'codex:close');
    await ctx.page.waitForTimeout(250);
    // 每日挑战：入口、开局、局内标记
    await click(ctx, 'daily');
    await dialogOpen(ctx, 'daily:start');
    await shot(ctx, '92-daily-panel');
    await click(ctx, 'daily:start');
    await waitIdle(ctx, '每日挑战开局', "window.__game.scene === 'trade'");
    const daily = await state<string | null>(ctx, 's.setup && s.setup.daily');
    expect(typeof daily === 'string', `每日挑战局应带日期（${daily}）`);
    await shot(ctx, '93-daily-in-game');
    await shot(ctx, '93b-daily-topbar', { x: 0, y: 0, width: 1280, height: 120 });
    await ctx.page.context().close();
  }
  // D. 结束页：全新档案打一局正式的通关（机器人在 node 里打完），新纪录、新成就、新人设、新难度依次弹出
  {
    let won: GameState | null = null;
    for (let i = 0; i < 20 && !won; i++) {
      const s = playRun(`end-smart-${i}`, botByName('smart'), { persona: 'newbie', difficulty: 1 });
      if (s.phase === 'won') won = s;
    }
    expect(won !== null, '机器人没打出通关局');
    const ctx = await openPage(browser, 'meta-end', '', { storage: profileStorage('fresh') });
    await loadState(ctx, won!);
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    const kinds: string[] = [];
    for (let k = 0; k < 8; k++) {
      try {
        await waitFor(ctx, '达成弹窗', "'unlock:ok' in g.controls()");
      } catch {
        break;
      }
      await ctx.page.waitForTimeout(500);
      kinds.push(String(k));
      await shot(ctx, `94${'abcdefgh'[k]}-end-unlock`);
      await click(ctx, 'unlock:ok');
      await ctx.page.waitForTimeout(300);
      if (!(await ctx.page.evaluate(() => 'unlock:ok' in (window.__game?.controls() ?? {})))) {
        await ctx.page.waitForTimeout(300);
        if (!(await ctx.page.evaluate(() => 'unlock:ok' in (window.__game?.controls() ?? {})))) break;
      }
    }
    expect(kinds.length >= 2, `通关后应依次弹出成就和解锁（${kinds.length} 个）`);
    const prof = await ctx.page.evaluate(() => window.__game?.profile());
    expect(prof?.runs === 1 && prof.maxDifficulty === 2, `档案应记下这局并解锁第 2 级（${JSON.stringify({ runs: prof?.runs, max: prof?.maxDifficulty })}）`);
    await shot(ctx, '95-end-new-record');
    // 重建结束页：不重复记、不再弹
    await ctx.page.evaluate(() => window.__game?.setProfile(window.__game.profile()));
    await waitIdle(ctx, '重建结束页');
    await ctx.page.waitForTimeout(500);
    expect(!('unlock:ok' in (await controls(ctx))), '重建结束页不应再弹解锁');
    expect((await ctx.page.evaluate(() => window.__game?.profile().runs)) === 1, '重建结束页不应重复记档案');
    await click(ctx, 'menu');
    await waitIdle(ctx, '回菜单', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(300);
    await shot(ctx, '96-title-after-win');
    await ctx.page.context().close();
  }
  // E. 0.3.0-alpha 的旧存档提示；档案损坏提示
  {
    const old = JSON.stringify({ format: 4, appVersion: '0.3.0-alpha.1', savedAt: '2026-10-05T00:00:00Z', state: {} });
    const ctx = await openPage(browser, 'legacy-03a', '', { storage: { 'kaipan.save': old } });
    await ctx.page.waitForTimeout(200);
    expect('notice:ok' in (await controls(ctx)), '应弹出 0.3a 旧存档提示');
    await shot(ctx, '97-legacy-03a-notice');
    await ctx.page.context().close();
    const bad = await openPage(browser, 'profile-corrupt', '', { storage: { 'kaipan.profile': '{broken' } });
    await bad.page.waitForTimeout(200);
    expect('notice:ok' in (await controls(bad)), '应弹出档案损坏提示');
    await shot(bad, '98-profile-corrupt-notice');
    await bad.page.context().close();
  }
  // F. 没有 meta 图集（模拟文件不存在）：开局面板和图鉴退回单张 SVG
  {
    const ctx = await openPage(browser, 'meta-no-atlas', '', { storage: profileStorage('partial'), routes: [{ pattern: '**/atlas/meta*', body: '<!doctype html><title>fallback</title>', type: 'text/html' }] });
    await click(ctx, 'new');
    await dialogOpen(ctx, 'setup:start');
    await shot(ctx, '99a-setup-no-meta-atlas');
    await click(ctx, 'setup:back');
    await ctx.page.waitForTimeout(250);
    await click(ctx, 'achievements');
    await dialogOpen(ctx, 'codex:close');
    await shot(ctx, '99b-achievements-no-meta-atlas');
    const atlas = await ctx.page.evaluate(() => window.__game?.atlas());
    notes.push(`没有 meta 图集时：${JSON.stringify(atlas?.meta)}`);
    await ctx.page.context().close();
  }
  // H. 顶栏日期行三个标签同时出现（每日挑战 + 市场传闻 + 加班）：要自适应，不能越过「账户」那一列。
  // 加班来自随机事件，和传闻同一天很少见：在 node 里找到有传闻的那天，再把这天标成加班（只为看画面）。
  {
    const setup: RunSetup = { persona: 'newbie', difficulty: 8, daily: '2026-10-10', account: 50_000_000 };
    let s = createRun('flags-0', setup).state;
    for (let d = 0; d < 80 && !(s.phase === 'premarket' && topBar(s).notice); d++) {
      if (s.phase === 'won' || s.phase === 'lost') throw new Error('找传闻日时本局结束');
      s = step(s).state;
    }
    expect(!!topBar(s).notice, '没找到有市场传闻的一天');
    s = { ...s, busyDay: s.today.day };
    expect(topBar(s).busy && !!topBar(s).daily, '构造的局面应同时有每日挑战、传闻和加班');
    const ctx = await openPage(browser, 'topbar-flags', `seed=flags-0&${setupQuery(setup)}`);
    await loadState(ctx, s);
    await ctx.page.waitForTimeout(300);
    const r = await ctx.page.evaluate(() => window.__game?.regions().flags ?? null);
    // 「账户」那一列的左边：电脑 296，手机横屏 216
    const accX = PHONE ? 216 : 296;
    expect(!!r && r.x + r.w <= accX, `日期行标签越过了「账户」那一列（${JSON.stringify(r)}）`);
    notes.push(`顶栏三个标签同时出现：占 x ${r!.x}–${r!.x + r!.w}（账户列从 ${accX} 开始）`);
    await shot(ctx, '99d-topbar-three-flags', { x: 0, y: 0, width: 640, height: 70 });
    await hover(ctx, r!.x + 10, r!.y + 9);
    await ctx.page.waitForTimeout(300);
    await shot(ctx, '99e-topbar-flags-tooltip', { x: 0, y: 0, width: 640, height: 260 });
    await ctx.page.context().close();
  }
  // I. 停在最后的账单上刷新：这一局照样记进档案（状态进入 won / lost 时就记，不等结束页）
  {
    let last: GameState | null = null;
    playRun('end-smart-0', botByName('smart'), { persona: 'newbie', difficulty: 1 }, (st) => {
      if (st.phase === 'premarket') last = structuredClone(st);
    });
    expect(last !== null, '没拿到最后一天的局面');
    const ctx = await openPage(browser, 'record-on-refresh', '', { storage: profileStorage('fresh') });
    await loadState(ctx, last!);
    await dispatchNoWait(ctx, { type: 'open' });
    await waitIdle(ctx, '最后的账单', 'window.__game.awaiting');
    const phase = await state<string>(ctx, 's.phase');
    expect(phase === 'won' || phase === 'lost', `最后一天开盘后应结束（${phase}）`);
    await shot(ctx, '99f-final-bill-before-refresh');
    await ctx.page.reload();
    await waitIdle(ctx, '刷新后', 'true');
    await ctx.page.waitForTimeout(400);
    const prof = await ctx.page.evaluate(() => window.__game?.profile());
    expect(prof?.runs === 1 && Object.keys(prof.achievements).length > 0, `停在账单上刷新后档案里应有这一局（runs ${prof?.runs}，成就 ${Object.keys(prof?.achievements ?? {}).length}）`);
    notes.push(`账单上刷新：档案 runs ${prof?.runs}，成就 ${Object.keys(prof?.achievements ?? {}).length} 个，最高难度 ${prof?.maxDifficulty}`);
    await shot(ctx, '99g-after-refresh');
    await ctx.page.context().close();
  }
  // J. 加班日：卖出按钮「加班中」并禁用，点了给出原因（构造：把第 3 天标成加班）
  {
    const base = advanceTo('busy-1', BASIC_SETUP, 2);
    const busy: GameState = { ...base, busyDay: base.today.day };
    const ctx = await openPage(browser, 'busy-day', `seed=busy-1&${setupQuery(BASIC_SETUP)}`);
    await loadState(ctx, busy);
    await ctx.page.waitForTimeout(300);
    expect(!('sell:0' in (await controls(ctx))), '加班日卖出按钮应禁用');
    // Shift+1：卖第一格（按钮禁用）→ 应弹出原因
    await press(ctx, 'Shift+Digit1');
    await ctx.page.waitForTimeout(250);
    expect('toast' in ((await ctx.page.evaluate(() => window.__game?.regions())) ?? {}), '按禁用的卖出应给出轻提示');
    await shot(ctx, '99h-busy-day-sell');
    await ctx.page.context().close();
  }
  // K. FOMO（4 条推荐）+ 小道消息：当天消息完整显示，推荐卡压扁
  {
    const setup: RunSetup = { items: ['fomo', 'rumor_mill'], account: 50_000_000 };
    const st = advanceTo('fomo-0', setup, 1);
    const cv = chatView(st);
    const ctx = await openPage(browser, 'fomo-rumor', `seed=fomo-0&${setupQuery(setup)}`);
    await loadState(ctx, st);
    await ctx.page.waitForTimeout(300);
    const keys = Object.keys((await ctx.page.evaluate(() => window.__game?.regions())) ?? {});
    const shown = keys.filter((k) => k.startsWith('msg:')).length;
    expect(cv.recs.length >= 4, `FOMO 应有 4 条推荐（${cv.recs.length}）`);
    expect(shown === cv.messages.length, `当天 ${cv.messages.length} 条消息应全部显示（显示了 ${shown} 条）`);
    notes.push(`FOMO + 小道消息：消息 ${cv.messages.length} 条全部显示，推荐 ${cv.recs.length} 条`);
    await shot(ctx, '99i-fomo-rumor-chat');
    await shot(ctx, '99j-fomo-rumor-phone', { x: 960, y: 60, width: 320, height: 660 });
    // 第 4 条推荐的快捷键「4」
    await press(ctx, 'Digit4');
    await waitIdle(ctx, '按 4 买第 4 条');
    const want = cv.recs[3]!.stock.id;
    const held = await state<string[]>(ctx, 's.slots.filter(Boolean).map((h) => h.stockId)');
    expect(held.includes(want), `按 4 应买入第 4 条推荐 ${want}（持仓 ${held.join(',')}）`);
    await ctx.page.context().close();
  }
  // G. 没有标题主视觉、玩过几局：小屋 + 纸面板里的按钮和档案一行
  {
    const ctx = await openPage(browser, 'meta-no-keyart', '', { storage: profileStorage('partial'), routes: [{ pattern: '**/scene/title_keyart.svg', body: '<!doctype html><title>fallback</title>', type: 'text/html' }] });
    await shot(ctx, '99c-title-no-keyart-partial');
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.4 重做：真实行情

/**
 * 真实行情流程：开始菜单开新局（"正在挑选行情……"）→ 交易日 → 玩到通关或失败（中段在 node 里用机器人推进）
 * → 揭晓页 → 结束页 → 图鉴"行情段"；另有一条行情加载失败、退回合成行情的流程。截图名 rN-*。
 */
async function realShots(browser: Browser): Promise<void> {
  {
    const ctx = await openPage(browser, 'real', 'anim=0');
    // 让行情目录晚一点到，截到"正在挑选行情……"
    await ctx.page.route('**/data/segments/index.json', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const seed = 'real-demo-3';
    const r = await ctx.page.evaluate((sd) => window.__game?.newRun(sd, { persona: 'newbie', difficulty: 1 }) ?? { error: '无' }, seed);
    expect(!r.error, `newRun 失败：${r.error}`);
    await ctx.page.waitForTimeout(500);
    await shot(ctx, 'r1-loading');
    await waitIdle(ctx, '真实行情开局', `window.__game.scene === 'trade'`);
    await ctx.page.waitForTimeout(400);
    let st = (await ctx.page.evaluate(() => window.__game?.state())) as GameState;
    expect(!!st.real, '开局应该用上真实行情段');
    const segId = st.real?.segId ?? '';
    notes.push(`真实行情：种子 ${seed} 抽到 ${segId}（${st.real?.from}–${st.real?.to}，${st.real?.regime}）`);
    await shot(ctx, 'r2-trade-day1');
    const body = await ctx.page.evaluate(() => document.body.innerText);
    expect(!/(19|20)\d\d 年/.test(body), '玩的时候页面上不该出现年份');
    // 前 3 天在画面里玩：机器人在 node 里决定操作，画面执行
    const bot = botByName('normal')();
    const rng = rngFor(seed, 'shot-bot');
    for (let k = 0; k < 40 && st.dayIndex < 3; k++) {
      const a = bot.act(st, rng);
      await dispatch2(ctx, isBusy(st) && (a.type === 'buy' || a.type === 'sell') ? { type: 'open' } : a);
      st = (await ctx.page.evaluate(() => window.__game?.state())) as GameState;
    }
    await shot(ctx, 'r3-trade-day4');
    // 中段在 node 里推进到最后一步之前，再交给画面
    let s = structuredClone(st);
    let last: Action | null = null;
    for (let k = 0; k < 3000 && s.phase !== 'won' && s.phase !== 'lost'; k++) {
      let a = bot.act(s, rng);
      if (isBusy(s) && (a.type === 'buy' || a.type === 'sell')) a = { type: 'open' };
      const next = dispatch(s, a, { events: false }).state;
      if (next.phase === 'won' || next.phase === 'lost') {
        last = a;
        break;
      }
      s = next;
    }
    expect(last !== null, '机器人应该能把这局玩完');
    await loadState(ctx, s);
    await dispatchNoWait(ctx, last as Action);
    // 最后的账单 / 结果画面等玩家点继续
    for (let k = 0; k < 6; k++) {
      await waitIdle(ctx, '最后一天', "window.__game.awaiting || window.__game.scene === 'end'");
      if ((await ctx.page.evaluate(() => window.__game?.scene)) === 'end') break;
      await ctx.page.evaluate(() => window.__game?.continue());
    }
    await waitFor(ctx, '这段日子', `'reveal:close' in g.controls()`);
    await ctx.page.waitForTimeout(500);
    await shot(ctx, 'r4-reveal');
    await click(ctx, 'reveal:close');
    await waitIdle(ctx, '结束页');
    await ctx.page.waitForTimeout(300);
    // 成就、解锁弹窗（如果有）逐个关掉
    for (let k = 0; k < 6; k++) {
      const c = await controls(ctx);
      if ('reveal' in c && 'menu' in c && !Object.keys(c).some((x) => x.includes(':'))) break;
      const key = Object.keys(c).find((x) => x.endsWith(':close') || x.endsWith(':ok') || x === 'ok');
      if (!key) break;
      await click(ctx, key);
      await ctx.page.waitForTimeout(400);
    }
    await shot(ctx, 'r5-end');
    await click(ctx, 'menu');
    await waitIdle(ctx, '开始菜单', `window.__game.scene === 'title'`);
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    await click(ctx, 'codex:tab:segments');
    await ctx.page.waitForTimeout(300);
    await shot(ctx, 'r6-codex-segments');
    await ctx.page.context().close();
  }
  {
    // 行情目录拿不到：退回 0.3 的合成行情，提示一句
    const ctx = await openPage(browser, 'real-fallback', 'anim=0');
    await ctx.page.route('**/data/segments/**', (route) => route.fulfill({ status: 404, body: 'nope' }));
    const r = await ctx.page.evaluate(() => window.__game?.newRun('real-fallback-1', { persona: 'newbie', difficulty: 1 }) ?? { error: '无' });
    expect(!r.error, `newRun 失败：${r.error}`);
    await waitIdle(ctx, '合成行情开局', `window.__game.scene === 'trade'`);
    await ctx.page.waitForTimeout(300);
    const st = (await ctx.page.evaluate(() => window.__game?.state())) as GameState;
    expect(!st.real, '加载失败时应退回合成行情');
    await shot(ctx, 'r7-fallback');
    // 这条流程故意让行情段 404：浏览器那条"资源加载失败"是预期内的
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i]?.startsWith('[real-fallback]') && errors[i]?.includes('404')) errors.splice(i, 1);
    await ctx.page.context().close();
  }
}

// ---------------------------------------------------------------- 0.4 重做：这段日子（局末小故事）

/**
 * 五种市况各玩一局（node 里机器人推进到最后一步，画面执行最后一步）→ "这段日子"小故事页；
 * 再把这几局记进档案，打开图鉴"行情段"页，逐个点卡片重看故事。截图名 sN-*。
 */
async function storyShots(browser: Browser): Promise<void> {
  const cases: [string, string, string][] = [
    ['2008-10-crash', 'follower', 'story-crash-1'],
    ['1999-03-bull', 'smart', 'story-bull-2'],
    ['2005-06-flat', 'normal', 'story-flat-1'],
    ['1999-10-bubble', 'smart', 'story-bubble-1'],
    ['2007-11-bear', 'qunzhu', 'story-bear-1'],
  ];
  // --segs a,b,c：只截这几段的开局（第一个交易日）和结局小故事（抽查全量段库用）
  const only = ((): string[] | null => {
    const k = process.argv.indexOf('--segs');
    return k > 0 && process.argv[k + 1] ? (process.argv[k + 1] as string).split(',') : null;
  })();
  if (only) cases.splice(0, cases.length, ...only.map((id) => [id, 'normal', `story-${id}`] as (typeof cases)[number]));
  let profile = emptyProfile();
  for (const [segId, botName, seed] of cases) {
    if (only) {
      const seg0 = loadSegment(segId);
      const s0 = createRun(seed, { persona: 'newbie', difficulty: 1 }, { segment: seg0 }).state;
      const c0 = await openPage(browser, `open-${segId}`, 'anim=0');
      await loadState(c0, s0);
      await c0.page.waitForTimeout(800);
      await shot(c0, `open-${segId}`);
      const b0 = await c0.page.evaluate(() => document.body.innerText);
      expect(!/(19|20)\d\d/.test(b0), '开局画面上不该出现年份');
      notes.push(`${segId} 开局 → open-${segId}`);
      await c0.page.context().close();
    }
    const seg = loadSegment(segId);
    const bot = botByName(botName)();
    const rng = rngFor(seed, 'shot-story');
    let s = createRun(seed, { persona: 'newbie', difficulty: 1 }, { segment: seg }).state;
    let last: Action | null = null;
    for (let k = 0; k < 4000; k++) {
      let a = bot.act(s, rng);
      if (isBusy(s) && (a.type === 'buy' || a.type === 'sell')) a = { type: 'open' };
      const next = dispatch(s, a, { events: false }).state;
      if (next.phase === 'won' || next.phase === 'lost') {
        last = a;
        profile = recordRun(profile, runSummary(next), '2026-10-12').profile;
        break;
      }
      s = next;
    }
    expect(last !== null, `${segId}：机器人应该能把这局玩完`);
    const ctx = await openPage(browser, `story-${segId}`, 'anim=0');
    await loadState(ctx, s);
    await dispatchNoWait(ctx, last as Action);
    for (let k = 0; k < 6; k++) {
      await waitIdle(ctx, '最后一天', "window.__game.awaiting || window.__game.scene === 'end'");
      if ((await ctx.page.evaluate(() => window.__game?.scene)) === 'end') break;
      await ctx.page.evaluate(() => window.__game?.continue());
    }
    await waitFor(ctx, '这段日子', `'reveal:close' in g.controls()`);
    await ctx.page.waitForTimeout(500);
    await shot(ctx, only ? `story-${segId}` : `s1-story-${seg.regime}`);
    const body = await ctx.page.evaluate(() => document.body.innerText);
    expect(!/(19|20)\d\d/.test(body), '故事页上不该出现年份');
    notes.push(`${segId}（${seg.regime}，${botName}）→ s1-story-${seg.regime}`);
    await ctx.page.context().close();
  }
  if (only) return;
  const ctx = await openPage(browser, 'story-codex', 'anim=0', { storage: { 'kaipan.profile': JSON.stringify(profile) } });
  await click(ctx, 'codex');
  await dialogOpen(ctx, 'codex:close');
  await click(ctx, 'codex:tab:segments');
  await ctx.page.waitForTimeout(300);
  await shot(ctx, 's2-codex-segments-0');
  // 手机横屏的行情段一页 4 张，只点第一页里的
  for (const i of PHONE ? [1, 2, 3] : [1, 2, 4]) {
    await click(ctx, `codex:seg:${i}`);
    await ctx.page.waitForTimeout(250);
    await shot(ctx, `s2-codex-segments-${i}`);
  }
  await ctx.page.context().close();
}

// ---------------------------------------------------------------- 0.4 C：仓位、押跌、银行、小知识

const EXT_TIPS_KEY = 'kaipan.extTips.v1';
const EXT_SETUP: RunSetup = { persona: 'newbie', difficulty: 1 };

/** 只开盘不操作地推进到第 month 个月的盘前（ext 局）。 */
function extToMonth(seed: string, setup: RunSetup, month: number): GameState {
  let s = createRun(seed, setup, { ext: true }).state;
  for (let k = 0; k < 400 && !(s.month >= month && s.phase === 'premarket'); k++) s = step(s).state;
  expect(s.month >= month && s.phase === 'premarket', `推进不到 ${month} 月`);
  return s;
}

function must(s: GameState, a: Action): GameState {
  const r = dispatch(s, a);
  if (r.error) throw new Error(`${JSON.stringify(a)}：${r.error}`);
  return r.state;
}

/** 第一条能买的推荐。 */
function firstRec(s: GameState): number {
  const i = chatView(s).recs.findIndex((r) => !r.taken && !r.error);
  expect(i >= 0, '没有能买的推荐');
  return i;
}

/** 截图前确认画面上没有禁用词（Phaser 画在画布上，这里检查调试桥给的控件名和 DOM 文字）。 */
async function noBannedText(ctx: Ctx): Promise<void> {
  const body = await ctx.page.evaluate(() => document.body.innerText);
  softExpect(!/保证金|维持线|Reg T|margin|融资|融券/.test(body), `[${ctx.name}] 页面上出现了禁用词`);
}

async function extShots(browser: Browser): Promise<void> {
  // ① 第一天：新玩法提示"买多少"、选仓位弹窗、重仓买入（筹码堆、现金还剩几份、点亮小知识）
  {
    const ctx = await openPage(browser, 'ext-size', 'anim=0');
    const s0 = createRun('ext-demo-1', EXT_SETUP, { ext: true }).state;
    await loadState(ctx, s0);
    await ctx.page.waitForTimeout(300);
    const regs = await ctx.page.evaluate(() => Object.keys(window.__game?.regions() ?? {}));
    softExpect(regs.includes('tip:size'), `[ext-size] 第一天应该出"买多少"的提示（${regs.join(',')}）`);
    // 手机横屏不放这条（持仓顶着顶栏，没地方），还剩几份看空格的悬停和「买多少」
    if (!PHONE) softExpect(regs.includes('cash'), '[ext-size] 持仓区应该写"现金还剩几份"');
    await shot(ctx, 'e01-tip-size');
    await click(ctx, `buy:${firstRec(s0)}`);
    await dialogOpen(ctx, 'size:heavy');
    await shot(ctx, 'e02-buy-dialog');
    await click(ctx, 'size:heavy');
    await waitIdle(ctx, '重仓买入');
    const st = (await ctx.page.evaluate(() => window.__game?.state())) as GameState;
    expect(st.slots.some((h) => (h?.units ?? 1) >= 4), '重仓应该把 4 份全压上');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'e03-heavy-bought');
    await noBannedText(ctx);
    await ctx.page.context().close();
  }
  // ② 第二天：手里的股票（提示 → 点卡片 → 加仓 / 减一半）
  {
    let s = createRun('ext-demo-2', EXT_SETUP, { ext: true }).state;
    s = must(s, { type: 'buy', rec: firstRec(s), size: 'taste' });
    s = step(s).state;
    expect(s.phase === 'premarket' && !isBusy(s), '第二天应该能操作');
    const ctx = await openPage(browser, 'ext-holding', 'anim=0', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size']) } });
    await loadState(ctx, s);
    await ctx.page.waitForTimeout(300);
    await shot(ctx, 'e04-tip-holding');
    const slot = s.slots.findIndex((h) => h);
    await click(ctx, `card:${slot}`);
    await dialogOpen(ctx, 'hold:add');
    await shot(ctx, 'e05-holding-menu');
    await click(ctx, 'hold:add');
    await waitIdle(ctx, '加仓');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'e06-added');
    await click(ctx, `sell:${slot}`);
    await dialogOpen(ctx, 'hold:trim');
    await click(ctx, 'hold:trim');
    await waitIdle(ctx, '减一半');
    await ctx.page.waitForTimeout(200);
    const after = (await ctx.page.evaluate(() => window.__game?.state())) as GameState;
    notes.push(`加仓后减一半：第 ${slot + 1} 格现在 ${after.slots[slot]?.units ?? 0} 份`);
    await shot(ctx, 'e07-trimmed');
    await ctx.page.context().close();
  }
  // ③ 押跌：许可证解锁 → 推荐卡上的"押跌"按钮 → 弹窗里押跌那一行 → 押跌持仓卡（反色、倒着站）
  {
    // 找一局第一天就有空军老周（唱空的群友）建议押跌的推荐
    let s = createRun('ext-demo-3', { ...EXT_SETUP, items: ['short_permit'], friends: ['kongjun'] }, { ext: true }).state;
    for (let i = 0; i < 200; i++) {
      const t = createRun(`ext-demo-3-${i}`, { ...EXT_SETUP, items: ['short_permit'], friends: ['kongjun'] }, { ext: true }).state;
      if (chatView(t).recs.some((r) => r.short && !r.taken && !r.error)) {
        s = t;
        break;
      }
    }
    const ctx = await openPage(browser, 'ext-short', 'anim=0', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding']) } });
    await loadState(ctx, s);
    await ctx.page.waitForTimeout(300);
    await shot(ctx, 'e08-tip-short');
    const recs = chatView(s).recs;
    const hinted = recs.findIndex((r) => r.short && !r.taken && !r.error);
    notes.push(`押跌：唱空群友推荐 ${hinted >= 0 ? `第 ${hinted + 1} 条` : '这一天没有'}`);
    const rec = hinted >= 0 ? hinted : firstRec(s);
    await click(ctx, `short:${rec}`);
    await dialogOpen(ctx, 'short:half');
    await shot(ctx, 'e09-short-dialog');
    await click(ctx, 'short:half');
    await waitIdle(ctx, '押跌买入');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'e10-short-card');
    await ctx.page.context().close();
  }
  // ④ 被轧：在 node 里找一天押跌的股票涨停（动画开着，冻结在"被轧了！"那一下）
  {
    let found: GameState | null = null;
    for (let i = 0; i < 200 && !found; i++) {
      let s = createRun(`ext-squeeze-${i}`, { ...EXT_SETUP, items: ['short_permit'] }, { ext: true }).state;
      for (let d = 0; d < 30 && !found && s.phase !== 'won' && s.phase !== 'lost'; d++) {
        if (s.phase === 'premarket' && !isBusy(s) && s.slots.every((h) => !h)) {
          for (const [k, r] of chatView(s).recs.entries()) {
            if (r.taken || r.error) continue;
            const b = dispatch(s, { type: 'buy', rec: k, size: 'half', short: true });
            if (b.error) continue;
            const o = dispatch(b.state, { type: 'open' });
            if (o.events.some((e) => e.type === 'squeezed') && !o.events.some((e) => e.type === 'billPaid' || e.type === 'bankrupt')) {
              found = b.state;
              break;
            }
          }
        }
        if (!found) s = step(s).state;
      }
    }
    expect(found !== null, '找不到被轧的一天');
    const ctx = await openPage(browser, 'ext-squeeze', '', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank', 'call']) } });
    await loadState(ctx, found as GameState);
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'thunder', t0, 350, 'e11-squeezed');
    await waitIdle(ctx, '被轧那天收盘');
    await ctx.page.waitForTimeout(300);
    await shot(ctx, 'e12-squeeze-recap');
    await ctx.page.context().close();
  }
  // ⑤ 银行：第 2 个月开门（提示）→ 面板 → 押车借钱 → 面板里有了欠款 → 还钱赎回（动画开着，截彩带）
  {
    const s = extToMonth('ext-bank-1', EXT_SETUP, 2);
    const ctx = await openPage(browser, 'ext-bank', 'anim=0', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short']) } });
    await loadState(ctx, s);
    await ctx.page.waitForTimeout(300);
    await shot(ctx, 'e13-tip-bank');
    await click(ctx, 'bank');
    await dialogOpen(ctx, 'bank:close');
    await shot(ctx, 'e14-bank-panel');
    await click(ctx, 'bank:borrow:car');
    await waitIdle(ctx, '押车借钱');
    await ctx.page.waitForTimeout(200);
    await shot(ctx, 'e15-borrowed');
    await click(ctx, 'bank');
    await dialogOpen(ctx, 'bank:close');
    await shot(ctx, 'e16-bank-panel-loan');
    await ctx.page.context().close();
    const s2 = must(s, { type: 'borrow', id: 'car' });
    const ctx2 = await openPage(browser, 'ext-redeem', '', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank', 'call']) } });
    await loadState(ctx2, s2);
    await click(ctx2, 'bank');
    await dialogOpen(ctx2, 'bank:repay:car');
    const t0 = await clock(ctx2);
    await click(ctx2, 'bank:repay:car');
    await cueShot(ctx2, 'rewardShow', t0, 450, 'e17-redeemed');
    await ctx2.page.context().close();
  }
  // ⑤b 月底账单里多一行"借钱的利息（另付）"
  {
    let s = must(extToMonth('ext-interest-1', EXT_SETUP, 2), { type: 'borrow', id: 'car' });
    let before: GameState | null = null;
    for (let k = 0; k < 40 && !before; k++) {
      if (s.phase === 'premarket' && dispatch(s, { type: 'open' }).events.some((e) => e.type === 'billPaid')) before = s;
      else s = step(s).state;
    }
    expect(before !== null, '找不到借了钱的月底');
    const ctx = await openPage(browser, 'ext-interest', '', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank', 'call']) } });
    await loadState(ctx, before as GameState);
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await cueShot(ctx, 'stamp', t0, 400, 'e25-bill-interest');
    await ctx.page.context().close();
  }
  // ⑥ 银行打电话、东西被收走：押了东西重仓，把账户压到线边上，找一天下跌
  for (const [kind, line, file] of [['bankCalled', 1.41, 'e18-bank-call'], ['seized', 1.21, 'e20-seized']] as const) {
    let found: GameState | null = null;
    for (let i = 0; i < 60 && !found; i++) {
      let s = extToMonth(`ext-${kind}-${i}`, EXT_SETUP, 2);
      s = must(s, { type: 'borrow', id: 'car' });
      s = must(s, { type: 'borrow', id: 'bracelet' });
      for (let d = 0; d < 15 && !found && s.phase !== 'won' && s.phase !== 'lost'; d++) {
        if (s.phase === 'premarket' && !isBusy(s)) {
          let t = s;
          if (t.slots.every((h) => !h)) {
            const k = chatView(t).recs.findIndex((r) => !r.taken && !r.error);
            if (k >= 0) t = must(t, { type: 'buy', rec: k, size: 'heavy' });
          }
          if (t.slots.some((h) => h)) {
            const c = structuredClone(t);
            let debt = 0;
            for (const l of c.ext?.loans ?? []) debt += l.amount;
            c.account = Math.round(debt * line);
            const o = dispatch(c, { type: 'open' });
            if (o.events.some((e) => e.type === kind) && !o.events.some((e) => e.type === 'billPaid' || e.type === 'bankrupt')) found = c;
          }
          s = t;
        }
        if (!found) s = step(s).state;
      }
    }
    expect(found !== null, `找不到 ${kind} 的一天`);
    const ctx = await openPage(browser, `ext-${kind}`, 'anim=0', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank']) } });
    await loadState(ctx, found as GameState);
    await dispatchNoWait(ctx, { type: 'open' });
    await waitIdle(ctx, kind, 'window.__game.awaiting');
    await ctx.page.waitForTimeout(300);
    await shot(ctx, file);
    await ctx.page.evaluate(() => window.__game?.continue());
    await waitIdle(ctx, `${kind} 之后`);
    await ctx.page.waitForTimeout(300);
    if (kind === 'bankCalled') await shot(ctx, 'e19-call-next-day');
    else await shot(ctx, 'e21-seized-after');
    await ctx.page.context().close();
  }
  // ⑥b 月底付账单那天：开盘前猫先提醒会被收走；付完账单真被收走时，卡片写清是账单压垮的
  {
    let found: GameState | null = null;
    for (let i = 0; i < 20 && !found; i++) {
      let s = must(extToMonth(`ext-billseize-${i}`, EXT_SETUP, 2), { type: 'borrow', id: 'car' });
      for (let d = 0; d < 40 && s.phase !== 'won' && s.phase !== 'lost' && !found; d++) {
        if (s.phase === 'premarket' && bankRisk({ ...s, account: 0 }) !== null) {
          const c = structuredClone(s);
          const b = bankView(c);
          c.account = Math.round(b.debt * (BALANCE.ext.seizeLine - 0.1) + c.bill.amount + b.monthlyInterest);
          const o = dispatch(c, { type: 'open' });
          if (bankRisk(c)?.kind === 'seize' && o.events.some((e) => e.type === 'seized' && e.cause === 'bill') && o.events.some((e) => e.type === 'billPaid')) found = c;
          break;
        }
        s = step(s).state;
      }
    }
    expect(found !== null, '找不到付完账单被收走的一天');
    const ctx = await openPage(browser, 'ext-billseize', 'anim=0', { storage: { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank', 'call']) } });
    await loadState(ctx, found as GameState);
    await ctx.page.waitForTimeout(400);
    await shot(ctx, 'e20b-bank-risk');
    await dispatchNoWait(ctx, { type: 'open' });
    // 同一天可能先"银行来电"再"收走"：一张张点过去，截到收走那张
    let seen = false;
    for (let k = 0; k < 4 && !seen; k++) {
      await waitIdle(ctx, '付完账单被收走', 'window.__game.awaiting');
      await ctx.page.waitForTimeout(300);
      seen = await ctx.page.evaluate(() => window.__game?.displayList().some((x) => x.includes('付完月底账单')) ?? false);
      if (seen) await shot(ctx, 'e20c-seized-bill');
      await ctx.page.evaluate(() => window.__game?.continue());
    }
    expect(seen, '付完账单被收走时，卡片应写明是月底账单压垮的');
    await ctx.page.context().close();
  }
  // ⑦ 带着这些经历打完一局真实行情（赌徒机器人：重仓、押跌、押东西借钱）→ "这段日子" → 结束页 → 图鉴小知识
  {
    let profile = emptyProfile();
    let best: { s: GameState; last: Action; score: number; seg: string } | null = null;
    for (const segId of ['2008-10-crash', '1999-03-bull', '2007-11-bear']) {
      const seg = loadSegment(segId);
      for (let i = 0; i < 6; i++) {
        const seed = `ext-story-${segId}-${i}`;
        const bot = botByName('gambler')();
        const rng = rngFor(seed, 'shot-ext');
        let s = createRun(seed, { ...EXT_SETUP, items: ['short_permit'] }, { segment: seg, ext: true }).state;
        for (let k = 0; k < 4000; k++) {
          let a = bot.act(s, rng);
          if (isBusy(s) && a.type !== 'open' && a.type !== 'borrow' && a.type !== 'repay') a = { type: 'open' };
          const r = dispatch(s, a, { events: false });
          if (r.error) {
            s = dispatch(s, { type: s.phase === 'reward' ? 'skipReward' : s.phase === 'event' ? 'choose' : 'open', option: 0 } as Action, { events: false }).state;
            continue;
          }
          if (r.state.phase === 'won' || r.state.phase === 'lost') {
            const sum = runSummary(r.state);
            const score = (sum.recap?.length ?? 0) + (r.state.ext?.log.borrowed.length ?? 0) + (r.state.ext?.log.shorts ? 1 : 0);
            if (!best || score > best.score) best = { s, last: a, score, seg: segId };
            profile = recordRun(profile, sum, '2026-10-12').profile;
            break;
          }
          s = r.state;
        }
      }
    }
    expect(best !== null, '赌徒机器人应该能打完一局');
    const b = best as { s: GameState; last: Action; score: number; seg: string };
    notes.push(`经历最多的一局：${b.seg}，${b.s.seed}`);
    const ctx = await openPage(browser, 'ext-story', 'anim=0');
    await loadState(ctx, b.s);
    await dispatchNoWait(ctx, b.last);
    for (let k = 0; k < 8; k++) {
      await waitIdle(ctx, '最后一天', "window.__game.awaiting || window.__game.scene === 'end'");
      if ((await ctx.page.evaluate(() => window.__game?.scene)) === 'end') break;
      await ctx.page.evaluate(() => window.__game?.continue());
    }
    await waitFor(ctx, '这段日子', `'reveal:close' in g.controls()`);
    await ctx.page.waitForTimeout(500);
    await shot(ctx, 'e22-story');
    await click(ctx, 'reveal:close');
    await waitIdle(ctx, '结束页');
    await ctx.page.waitForTimeout(300);
    for (let k = 0; k < 6; k++) {
      const c = await controls(ctx);
      if ('reveal' in c && 'menu' in c && !Object.keys(c).some((x) => x.includes(':'))) break;
      const key = Object.keys(c).find((x) => x.endsWith(':close') || x.endsWith(':ok') || x === 'ok');
      if (!key) break;
      await click(ctx, key);
      await ctx.page.waitForTimeout(400);
    }
    await shot(ctx, 'e23-end');
    await noBannedText(ctx);
    await ctx.page.context().close();
    // 图鉴"小知识"：点亮一部分
    profile.knowledge = ['size', 'heavy', 'short', 'squeeze', 'borrow', 'call', 'seize'];
    const ctx3 = await openPage(browser, 'ext-codex', 'anim=0', { storage: { 'kaipan.profile': JSON.stringify(profile) } });
    await click(ctx3, 'codex');
    await dialogOpen(ctx3, 'codex:close');
    await click(ctx3, 'codex:tab:knowledge');
    await ctx3.page.waitForTimeout(300);
    await shot(ctx3, 'e24-codex-knowledge');
    await ctx3.page.context().close();
  }
}

// ---------------------------------------------------------------- 试玩

type CueLog = { t: number; cue: { type: string; name?: string } }[];

async function cueCounts(ctx: Ctx, from: number, to = Infinity): Promise<Record<string, number>> {
  const log = (await ctx.page.evaluate(() => window.__game?.cues ?? [])) as CueLog;
  const out: Record<string, number> = {};
  for (const { t, cue } of log) {
    if (t < from || t >= to) continue;
    const k = cue.type === 'ui' ? `ui.${cue.name ?? '?'}` : cue.type;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const fmt = (c: Record<string, number>): string =>
  Object.entries(c)
    .filter(([k]) => k !== 'ui.hover' && k !== 'countUp')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');

/**
 * 实时试玩（动画开启、1 倍速、真实鼠标与键盘）：从开始菜单「新游戏」进入。普通玩家策略：
 * 有空格就买群友战绩最好的人推荐的那只；持有收益跌破 -8% 就卖。前两个月看完整动画，
 * 之后每天开盘后按空格跳过动画，直到本局结束。报告每天的耗时与点击次数。
 */
async function playtest(browser: Browser): Promise<void> {
  const ctx = await openPage(browser, 'playtest', '', { guide: true });
  // 固定「随机」种子，保证每次试玩同一局
  await ctx.page.context().addInitScript(() => {
    const orig = crypto.getRandomValues.bind(crypto);
    let n = 0;
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint32Array && a.length === 2) {
        a[0] = 7919 + n * 13;
        a[1] = 104729 + n++;
        return a;
      }
      return orig(a as never) as T;
    }) as typeof crypto.getRandomValues;
  });
  await ctx.page.reload();
  await waitIdle(ctx, '开始菜单', "window.__game.scene === 'title'");
  await click(ctx, 'quick');
  await waitIdle(ctx, '进入新局', "window.__game.scene === 'trade'");
  const report: string[] = [];
  const times: number[] = [];
  const clicks: number[] = [];
  const seen = new Set<string>();
  // 教程：像新玩家一样，每冒出一步就读完点「知道了」（第一次出现时截图）
  const tutorialSeen: string[] = [];
  const ackGuide = async (): Promise<void> => {
    for (let k = 0; k < 6; k++) {
      const st = await guideStep(ctx);
      if (!st) return;
      if (!tutorialSeen.includes(st)) {
        tutorialSeen.push(st);
        await ctx.page.waitForTimeout(250);
        await shot(ctx, `7${tutorialSeen.length}-playtest-tutorial-${st}`);
      }
      // 要动手的步骤（买入、开盘、卖出）没有「下一步」：交给后面的正常流程去点
      if (!('guide:next' in (await controls(ctx)))) return;
      await click(ctx, 'guide:next');
      await ctx.page.waitForTimeout(250);
    }
  };
  for (let guard = 0; guard < 200; guard++) {
    const phase = await state<string>(ctx, 's.phase');
    if (phase === 'won' || phase === 'lost') break;
    await ackGuide();
    if (phase === 'reward') {
      const from = await clock(ctx);
      const cards = await state<{ kind: string }[]>(ctx, 's.reward.cards');
      const i = Math.max(0, cards.findIndex((c) => c.kind === 'item'));
      await click(ctx, `reward:${i}`);
      let n = 1;
      if (cards[i]?.kind === 'stock') {
        await ctx.page.waitForTimeout(100);
        const c = await controls(ctx);
        const slot = Object.keys(c).find((k) => k.startsWith('slot:'));
        if (slot) {
          await click(ctx, slot);
          n++;
        }
      }
      await waitIdle(ctx, '选完奖励');
      for (const k of Object.keys(await cueCounts(ctx, from))) seen.add(k);
      report.push(`  月度奖励：选了第 ${i + 1} 张（${cards[i]?.kind}），点击 ${n} 次`);
      continue;
    }
    if (phase === 'event') {
      await press(ctx, 'Digit1');
      await waitIdle(ctx, '事件结果', 'window.__game.awaiting');
      // 结果页的账户数字可能还在滚：第一下空格只快进动画，再按一下才继续
      for (let k = 0; k < 3 && (await ctx.page.evaluate(() => window.__game?.awaiting)); k++) {
        await press(ctx, 'Space');
        await ctx.page.waitForTimeout(300);
      }
      // 继续之后还有新月份开场：等它播完
      await waitIdle(ctx, '事件之后', "!window.__game.awaiting && window.__game.state().phase === 'premarket'");
      report.push('  事件：按 1 选第一个，空格继续');
      continue;
    }
    const day = await state<number>(ctx, 's.dayIndex + 1');
    const label = await state<string>(ctx, '`${s.month}月第${s.dayInMonth + 1}天`');
    const fast = day > 10;
    const c0 = await clock(ctx);
    const t0 = Date.now();
    const ops: string[] = [];
    // 卖：持有收益跌破 -8% 的第一只
    const sell = await state<number>(ctx, 's.slots.findIndex((h, i) => h && h.value < 0.92 && h.boughtDay < s.today.day)');
    if (sell >= 0) {
      await click(ctx, `sell:${sell}`);
      await waitIdle(ctx, '卖出');
      ops.push('卖出');
    }
    // 买（当天没卖时）：有空格时买战绩最好的群友推荐的
    const buy = await state<number>(
      ctx,
      `(() => { if (!s.slots.some((h) => !h) || s.today.buysLeft <= 0) return -1; const score = (id) => { const f = s.friends.find((x) => x.id === id); return f ? (f.hits + 1) / (f.total + 2) : 0; }; let b = -1; s.today.recs.forEach((r, i) => { if (!r.taken && !s.slots.some((h) => h && h.stockId === r.stockId) && (b < 0 || score(r.friendId) > score(s.today.recs[b].friendId))) b = i; }); return b; })()`,
    );
    if (sell < 0 && buy >= 0 && `buy:${buy}` in (await controls(ctx))) {
      await buyVia(ctx, `buy:${buy}`);
      await waitIdle(ctx, '买入');
      ops.push('买入');
    }
    const tOpen = Date.now();
    await press(ctx, 'Space');
    ops.push('空格开盘');
    if (fast) {
      await ctx.page.waitForFunction(() => !window.__game?.idle, null, { timeout: 5000 }).catch(() => {});
      await ctx.page.waitForTimeout(250);
      await press(ctx, 'Space');
    }
    // 月底账单：逾期 / 通关时要点「继续」
    await waitIdle(ctx, `第 ${day} 天`);
    if (await ctx.page.evaluate(() => window.__game?.awaiting)) {
      await click(ctx, 'continue');
      ops.push('继续');
      await waitIdle(ctx, '结束页');
    }
    const animMs = Date.now() - tOpen;
    const total = Date.now() - t0;
    const fps = await ctx.page.evaluate(() => window.__game?.fps ?? 0);
    const counts = await cueCounts(ctx, c0);
    for (const k of Object.keys(counts)) seen.add(k);
    const dayOps = ops.filter((o) => o !== '继续').length;
    if (!fast) {
      times.push(animMs);
      clicks.push(dayOps);
    }
    const acc = await state<number>(ctx, 'Math.round(s.account)');
    report.push(
      `${label}${fast ? '（空格跳过）' : ''}：操作 ${ops.length} 次（${ops.join('、')}），开盘到下一步可操作 ${(animMs / 1000).toFixed(1)} 秒，共 ${(total / 1000).toFixed(1)} 秒，帧率约 ${fps.toFixed(0)}；账户 ${acc}；cue：${fmt(counts)}`,
    );
  }
  const end = await state<{ phase: string; month: number; account: number }>(ctx, '({ phase: s.phase, month: s.month, account: Math.round(s.account) })');
  await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
  await shot(ctx, '70-playtest-end');
  const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  report.push(`本局结束：${end.phase === 'won' ? '通关' : '没还上，游戏结束'}，${end.month} 月，账户 ${end.account}`);
  report.push(`教程出现的步骤（按顺序）：${tutorialSeen.join(' → ') || '无'}`);
  report.push(`前 10 天（完整动画）平均开盘到可操作 ${(avg / 1000).toFixed(1)} 秒，最长 ${(Math.max(...times) / 1000).toFixed(1)} 秒；每天操作最多 ${Math.max(...clicks)} 次`);
  report.push(`运行时统计 ${JSON.stringify(await ctx.page.evaluate(() => window.__game?.stats()))}`);
  report.push(`触发过的 cue：${[...seen].sort().join(' ')}`);
  console.log(report.join('\n'));
  if (Math.max(...clicks) > 2) errors.push('[playtest] 每天操作应不超过 2 次（买 / 卖 + 开盘）');
  await ctx.page.context().close();
}

/**
 * 0.5 试玩（--v05）：动画开启、1 倍速、真实鼠标与键盘，从开始菜单「新的一局」选难度开局，打完一整局。
 * 策略同 --playtest（持有跌破 -8% 卖、有空格买战绩最好的群友推荐的）；平淡日有「快进」时按 F，自动快进照默认打开。
 * 记录：一局总时长、每个月停下来等玩家的次数、弹窗数（看点卡、账单、三选一、事件）、
 * 连续"什么都没发生又必须手动点"的最长天数；沿途截看点卡、boss 卡、翻牌、大字、平淡日、自动快进、收盘小结。
 */
async function playtest05(browser: Browser, level: number, tag: string, seedBase: number, until = 99): Promise<void> {
  const ctx = await openPage(browser, `v05-${tag}`, '');
  await ctx.page.context().addInitScript((base) => {
    const orig = crypto.getRandomValues.bind(crypto);
    let n = 0;
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint32Array && a.length === 2) {
        a[0] = base + n * 13;
        a[1] = 104729 + n++;
        return a;
      }
      return orig(a as never) as T;
    }) as typeof crypto.getRandomValues;
  }, seedBase);
  await ctx.page.reload();
  await waitIdle(ctx, '开始菜单', "window.__game.scene === 'title'");
  await ctx.page.evaluate(() => window.__game?.setProfile('all'));
  await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
  await ctx.page.waitForTimeout(400);
  await click(ctx, 'new');
  await dialogOpen(ctx, 'setup:start');
  await click(ctx, `setup:diff:${level}`);
  await ctx.page.waitForTimeout(300);
  await shot(ctx, `${tag}-00-setup`);
  const tStart = Date.now();
  await click(ctx, 'setup:start');
  const report: string[] = [];
  type Month = { stops: number; fast: number; auto: number; cards: number; bills: number; rewards: number; events: number; results: number; bank: number };
  const months = new Map<number, Month>();
  const mon = (m: number): Month => {
    let x = months.get(m);
    if (!x) months.set(m, (x = { stops: 0, fast: 0, auto: 0, cards: 0, bills: 0, rewards: 0, events: 0, results: 0, bank: 0 }));
    return x;
  };
  const shotDone = new Set<string>();
  const once = async (key: string, file: string): Promise<void> => {
    if (shotDone.has(key)) return;
    shotDone.add(key);
    await shot(ctx, `${tag}-${file}`);
  };
  let lastCue = 0;
  let curMonth = 1;
  /** 等画面空闲，顺路截动画中的画面、数弹窗（看点卡、账单）和自动快进的天数。 */
  const settle = async (what: string): Promise<void> => {
    const deadline = Date.now() + WAIT_MS;
    let sawCard = false;
    for (;;) {
      const info = (await ctx.page.evaluate(() => {
        const g = window.__game;
        if (!g) return null;
        const r = g.regions();
        return { idle: g.ready && g.idle, card: 'monthCard' in r, month: g.state().month, phase: g.state().phase, cues: g.cues.map((c) => ({ t: c.t, type: c.cue.type, limit: (c.cue as { limit?: string }).limit ?? null })) };
      })) as { idle: boolean; card: boolean; month: number; phase: string; cues: { t: number; type: string; limit: string | null }[] } | null;
      if (!info) throw new Error('页面没有 __game');
      curMonth = info.month;
      const fresh = info.cues.filter((c) => c.t > lastCue);
      if (fresh.length > 0) lastCue = fresh[fresh.length - 1]!.t;
      for (const c of fresh) {
        if (c.type === 'monthStart') mon(info.month).cards += 1;
        if (c.type === 'bill') mon(info.month).bills += 1;
      }
      if (info.card && !sawCard) {
        sawCard = true;
        const boss = await state<boolean>(ctx, '!!(s.tempo && s.tempo.cur && s.tempo.cur.boss)');
        await ctx.page.waitForTimeout(450);
        if (info.month === 1) await once('card1', '01-month-card');
        else if (boss) await once(`boss${info.month}`, `0${info.month === 4 ? 2 : 3}-boss-card-m${info.month}`);
      }
      if (fresh.some((c) => c.type === 'reveal' && c.limit === 'up')) await once('flipUp', '10-flip-limitup');
      if (fresh.some((c) => c.type === 'reveal' && c.limit === 'down')) await once('flipDown', '11-flip-limitdown');
      if (fresh.some((c) => c.type === 'rewardShow') && info.phase !== 'reward') {
        await ctx.page.waitForTimeout(120);
        await once('shout', '12-shout');
      }
      if (fresh.some((c) => c.type === 'stamp') && info.phase !== 'reward') {
        await ctx.page.waitForTimeout(150);
        await once('stamp', '13-goal-stamp');
      }
      if (info.idle) return;
      if (Date.now() > deadline) throw new Error(`[${ctx.name}] 等待超时：${what}`);
      await ctx.page.waitForTimeout(90);
    }
  };
  await waitFor(ctx, '进入新局', "g.scene === 'trade' && !g.state().phase.startsWith('x')");
  await settle('第一个月');
  let nothingRun = 0;
  let nothingMax = 0;
  let manualDays = 0;
  let autoDays = 0;
  for (let guard = 0; guard < 400; guard++) {
    const phase = await state<string>(ctx, 's.phase');
    if (phase === 'won' || phase === 'lost') break;
    if ((await state<number>(ctx, 's.month')) >= until) break;
    if (phase === 'reward') {
      mon(curMonth).rewards += 1;
      const cards = await state<{ kind: string }[]>(ctx, 's.reward.cards');
      const i = Math.max(0, cards.findIndex((c) => c.kind === 'item'));
      if (!shotDone.has('reward')) await once('reward', '20-reward');
      await click(ctx, `reward:${i}`);
      if (cards[i]?.kind === 'stock') {
        await ctx.page.waitForTimeout(150);
        const slot = Object.keys(await controls(ctx)).find((k) => k.startsWith('slot:'));
        if (slot) await click(ctx, slot);
      }
      await settle('选完奖励');
      continue;
    }
    if (phase === 'event') {
      mon(curMonth).events += 1;
      await press(ctx, 'Digit1');
      for (let k = 0; k < 40; k++) {
        await ctx.page.waitForTimeout(150);
        const st = await ctx.page.evaluate(() => ({ awaiting: window.__game?.awaiting, phase: window.__game?.state().phase, idle: window.__game?.idle }));
        if (st.awaiting) {
          mon(curMonth).results += 1;
          await press(ctx, 'Space');
          await ctx.page.waitForTimeout(200);
          if (await ctx.page.evaluate(() => window.__game?.awaiting)) await press(ctx, 'Space');
          break;
        }
        if (st.phase !== 'event' && !st.awaiting) break;
      }
      await settle('事件之后');
      continue;
    }
    // 开盘前：玩家要做决定（一次"停下"）
    const s0 = await state<{ day: number; month: number; quiet: boolean }>(ctx, '({ day: s.dayIndex, month: s.month, quiet: !!s.today.quiet })');
    const m = mon(s0.month);
    m.stops += 1;
    manualDays += 1;
    let acted = false;
    const c = await controls(ctx);
    if ('fast' in c) await once('quiet', '30-quiet-day');
    const sell = await state<number>(ctx, 's.slots.findIndex((h) => h && h.value < 0.92 && h.boughtDay < s.today.day)');
    if (sell >= 0 && `sell:${sell}` in c) {
      await click(ctx, `sell:${sell}`);
      await ctx.page.waitForTimeout(200);
      const c2 = await controls(ctx);
      const all = Object.keys(c2).find((k) => k === 'hold:sell' || k === 'holding:sell' || k.endsWith(':sellAll') || k === 'menu:sell');
      if (all) await click(ctx, all);
      else await press(ctx, 'Escape');
      await settle('卖出');
      acted = true;
    }
    const buy = await state<number>(
      ctx,
      `(() => { if (!s.slots.some((h) => !h) || s.today.buysLeft <= 0) return -1; const score = (id) => { const f = s.friends.find((x) => x.id === id); return f ? (f.hits + 1) / (f.total + 2) : 0; }; let b = -1; s.today.recs.forEach((r, i) => { if (!r.taken && !r.short && !s.slots.some((h) => h && h.stockId === r.stockId) && (b < 0 || score(r.friendId) > score(s.today.recs[b].friendId))) b = i; }); return b; })()`,
    );
    if (!acted && buy >= 0 && `buy:${buy}` in (await controls(ctx))) {
      await buyVia(ctx, `buy:${buy}`);
      await settle('买入');
      acted = true;
    }
    if (shotDone.has('card1') && !shotDone.has('premarket')) await once('premarket', '31-premarket');
    const useFast = 'fast' in (await controls(ctx));
    if (useFast) {
      m.fast += 1;
      await press(ctx, 'KeyF');
    } else await press(ctx, 'Space');
    await settle(`第 ${s0.day + 1} 天`);
    // 自动快进：看过的那一天之后又自己走了几天
    const after = await state<{ day: number; quiet: boolean | null; pending: boolean }>(ctx, '({ day: s.dayIndex, quiet: s.lastDay && s.lastDay.tempo ? !!s.lastDay.tempo.quiet : null })');
    const auto = Math.max(0, after.day - s0.day - 1);
    autoDays += auto;
    m.auto += auto;
    if (!shotDone.has('recap') && (await state<boolean>(ctx, '!!(s.lastDay && s.lastDay.tempo && s.lastDay.tempo.highlights.length > 0)'))) await once('recap', '40-recap-star');
    if (!shotDone.has('watch') && (await state<boolean>(ctx, '(s.watch || []).some((w) => w.day < s.today.day)'))) await once('watch', '41-chat-watch');
    if (!shotDone.has('big') && (await state<boolean>(ctx, 's.today.messages.some((x) => x.big)'))) await once('big', '42-chat-big');
    // 什么都没发生又得手动点：这一天没买没卖、收盘是平淡日、而且没有被自动快进接走
    if (!acted && after.quiet === true && auto === 0) {
      nothingRun += 1;
      nothingMax = Math.max(nothingMax, nothingRun);
    } else nothingRun = 0;
    if (await ctx.page.evaluate(() => window.__game?.awaiting)) {
      await click(ctx, 'continue');
      await settle('结束页');
    }
  }
  const total = Date.now() - tStart;
  const end = await state<{ phase: string; month: number; account: number; results: unknown }>(ctx, '({ phase: s.phase, month: s.month, account: Math.round(s.account), results: s.tempo ? s.tempo.results : null })');
  if (end.phase === 'won' || end.phase === 'lost') {
    await waitIdle(ctx, '结束页', "window.__game.scene === 'end'");
    await shot(ctx, `${tag}-90-end`);
  }
  report.push(`【${tag}】第 ${level} 级：${end.phase === 'won' ? '通关' : '没撑到最后'}，${end.month} 月，账户 ${end.account}；总时长 ${(total / 1000).toFixed(0)} 秒`);
  report.push(`  手动开盘 ${manualDays} 天、自动快进 ${autoDays} 天；连续"什么都没发生又得手动点"最长 ${nothingMax} 天`);
  for (const [k, x] of [...months.entries()].sort((a, b) => a[0] - b[0])) {
    const pops = x.cards + x.bills + x.rewards + x.events + x.results;
    report.push(`  ${k}月：停下 ${x.stops} 次（其中按 F 快进 ${x.fast}），自动快进 ${x.auto} 天；弹窗 ${pops}（看点卡 ${x.cards}、账单 ${x.bills}、三选一 ${x.rewards}、事件 ${x.events}、事件结果要点 ${x.results}）`);
  }
  report.push(`  月度目标：${JSON.stringify(end.results)}`);
  console.log(report.join('\n'));
  notes.push(...report);
  if (nothingMax >= 3) errors.push(`[${tag}] 连续 ${nothingMax} 天什么都没发生又必须手动点`);
  await ctx.page.context().close();
}

// ---------------------------------------------------------------- 0.5 去文字化：主要画面截图 + 可见汉字数

const visCounts: { file: string; han: number; texts: number }[] = [];

/** 截图并统计画面上看得见的汉字（Phaser 文字对象 + DOM 文字）。 */
async function visShot(ctx: Ctx, file: string): Promise<void> {
  await shot(ctx, file);
  const list = (await ctx.page.evaluate(() => window.__game?.displayList() ?? [])) as string[];
  const texts = list.filter((x) => x.startsWith('text:')).map((x) => x.slice(5));
  const dom = await ctx.page.evaluate(() => document.body.innerText);
  const all = [...texts, dom].join('\n');
  const han = (all.match(/[一-鿿]/g) ?? []).length;
  visCounts.push({ file, han, texts: texts.length });
  const fs = await import('node:fs');
  fs.writeFileSync(`${OUT}/${file}.txt`, `${texts.join('\n---\n')}\n=== DOM ===\n${dom}`);
}

const VIS_TIPS = { [EXT_TIPS_KEY]: JSON.stringify(['size', 'holding', 'short', 'bank', 'call']) };
const VIS_SEG = '2005-06-flat';

function visRun(seed: string): GameState {
  return createRun(seed, EXT_SETUP, { segment: loadSegment(VIS_SEG), ext: true }).state;
}

async function visShots(browser: Browser): Promise<void> {
  // ① 标题 → 选人设和难度 → 本月看点卡 → 盘前 → 开盘翻牌 → 收盘
  {
    const ctx = await openPage(browser, 'vis-main', '', { storage: VIS_TIPS });
    await ctx.page.evaluate(() => window.__game?.setProfile('all'));
    await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(500);
    await visShot(ctx, '01-title');
    await click(ctx, 'new');
    await dialogOpen(ctx, 'setup:start');
    await click(ctx, 'setup:diff:1');
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '02-setup');
    await ctx.page.context().close();
  }
  {
    // 看点卡：从开局面板真实开一局（动画开着），在 monthStart 之后冻结
    const ctx = await openPage(browser, 'vis-card', '', { storage: VIS_TIPS });
    await ctx.page.evaluate(() => window.__game?.setProfile('all'));
    await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(400);
    await click(ctx, 'new');
    await dialogOpen(ctx, 'setup:start');
    await click(ctx, 'setup:diff:1');
    await ctx.page.waitForTimeout(200);
    const t0 = await clock(ctx);
    await click(ctx, 'setup:start');
    await ctx.page.evaluate(([t, s, ms]) => window.__game?.freezeAfterCue(t, s, ms), ['monthStart', t0, 1400] as const);
    await waitFor(ctx, '看点卡冻结', 'g.frozen');
    await ctx.page.waitForTimeout(200);
    await visShot(ctx, '03-month-card');
    await ctx.page.evaluate(() => window.__game?.freeze(false));
    await ctx.page.context().close();
  }
  {
    const ctx = await openPage(browser, 'vis-day', '', { storage: VIS_TIPS });
    const s0 = visRun('vis-1');
    await loadState(ctx, s0);
    await ctx.page.waitForTimeout(500);
    await visShot(ctx, '04-premarket');
    const rec = firstRec(s0);
    await buyVia(ctx, `buy:${rec}`);
    await waitIdle(ctx, '买入');
    await ctx.page.waitForTimeout(300);
    // 0.5.1：持仓卡的放大镜 → 股票详情卡
    if (process.argv.includes('--vis') && 'detail:0' in (await controls(ctx))) {
      await visShot(ctx, '04a-bought');
      await click(ctx, 'detail:0');
      await ctx.page.waitForTimeout(900);
      await visShot(ctx, '04b-detail');
      await press(ctx, 'Escape');
      await ctx.page.waitForTimeout(300);
    }
    const t0 = await clock(ctx);
    await dispatchNoWait(ctx, { type: 'open' });
    await ctx.page.evaluate(([t, s, ms]) => window.__game?.freezeAfterCue(t, s, ms), ['reveal', t0, 400] as const);
    await waitFor(ctx, '翻牌冻结', 'g.frozen');
    await ctx.page.waitForTimeout(150);
    await visShot(ctx, '05-open-flip');
    await ctx.page.evaluate(() => window.__game?.freeze(false));
    await waitIdle(ctx, '收盘');
    await ctx.page.waitForTimeout(500);
    await visShot(ctx, '06-close');
    await ctx.page.context().close();
  }
  // 0.5.1：新手教程第一步（全新进度）
  {
    const ctx = await openPage(browser, 'vis-guide', '', { storage: VIS_TIPS, guide: true });
    await loadState(ctx, visRun('vis-1'));
    await ctx.page.waitForTimeout(1200);
    await visShot(ctx, '04c-tutorial');
    await ctx.page.context().close();
  }
  // ② 月底三选一 → 事件 → 事件结果
  {
    let found: { seed: string; s: GameState } | null = null;
    for (let i = 0; i < 200 && !found; i++) {
      let s = visRun(`vis-m-${i}`);
      let last = s;
      for (let k = 0; k < 80 && s.phase !== 'reward'; k++) {
        if (s.phase === 'won' || s.phase === 'lost') break;
        last = s;
        s = step(s).state;
      }
      if (s.phase === 'reward' && dispatch(s, { type: 'skipReward' }).state.phase === 'event') found = { seed: `vis-m-${i}`, s: last };
    }
    expect(found !== null, '找不到「三选一 + 事件」的局面');
    const ctx = await openPage(browser, 'vis-month', 'anim=0', { storage: VIS_TIPS });
    await loadState(ctx, found!.s);
    await dispatch2(ctx, { type: 'open' });
    for (let k = 0; k < 4 && (await state<string>(ctx, 's.phase')) !== 'reward'; k++) {
      if (await ctx.page.evaluate(() => window.__game?.awaiting)) await ctx.page.evaluate(() => window.__game?.continue());
      await waitIdle(ctx, '三选一');
    }
    await waitIdle(ctx, '三选一', "window.__game.state().phase === 'reward'");
    await ctx.page.waitForTimeout(400);
    await visShot(ctx, '07-reward');
    await click(ctx, 'reward:skip');
    await waitIdle(ctx, '事件', "window.__game.state().phase === 'event'");
    await ctx.page.waitForTimeout(400);
    await visShot(ctx, '08-event');
    await click(ctx, 'event:0');
    await waitIdle(ctx, '事件结果', "window.__game.awaiting || window.__game.state().phase === 'premarket'");
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '09-event-result');
    await ctx.page.context().close();
  }
  // ③ 银行、押跌
  {
    const s = extToMonth('ext-bank-1', EXT_SETUP, 2);
    const ctx = await openPage(browser, 'vis-bank', 'anim=0', { storage: VIS_TIPS });
    await loadState(ctx, s);
    await click(ctx, 'bank');
    await dialogOpen(ctx, 'bank:close');
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '10-bank');
    await ctx.page.context().close();
  }
  {
    let s = createRun('ext-demo-3', { ...EXT_SETUP, items: ['short_permit'], friends: ['kongjun'] }, { ext: true }).state;
    for (let i = 0; i < 200; i++) {
      const t = createRun(`ext-demo-3-${i}`, { ...EXT_SETUP, items: ['short_permit'], friends: ['kongjun'] }, { ext: true }).state;
      if (chatView(t).recs.some((r) => r.short && !r.taken && !r.error)) {
        s = t;
        break;
      }
    }
    const ctx = await openPage(browser, 'vis-short', 'anim=0', { storage: VIS_TIPS });
    await loadState(ctx, s);
    const recs = chatView(s).recs;
    const hinted = recs.findIndex((r) => r.short && !r.taken && !r.error);
    await click(ctx, `short:${hinted >= 0 ? hinted : firstRec(s)}`);
    await dialogOpen(ctx, 'short:half');
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '11-short');
    await ctx.page.context().close();
  }
  // ④ 结局小故事
  {
    const seg = loadSegment(VIS_SEG);
    const bot = botByName('normal')();
    const rng = rngFor('vis-story', 'shot-story');
    let s = createRun('vis-story', EXT_SETUP, { segment: seg }).state;
    let last: Action | null = null;
    for (let k = 0; k < 4000; k++) {
      let a = bot.act(s, rng);
      if (isBusy(s) && (a.type === 'buy' || a.type === 'sell')) a = { type: 'open' };
      const next = dispatch(s, a, { events: false }).state;
      if (next.phase === 'won' || next.phase === 'lost') {
        last = a;
        break;
      }
      s = next;
    }
    expect(last !== null, '机器人应该能把这局玩完');
    const ctx = await openPage(browser, 'vis-story', 'anim=0', { storage: VIS_TIPS });
    await loadState(ctx, s);
    await dispatchNoWait(ctx, last as Action);
    for (let k = 0; k < 6; k++) {
      await waitIdle(ctx, '最后一天', "window.__game.awaiting || window.__game.scene === 'end'");
      if ((await ctx.page.evaluate(() => window.__game?.scene)) === 'end') break;
      await ctx.page.evaluate(() => window.__game?.continue());
    }
    await waitFor(ctx, '这段日子', `'reveal:close' in g.controls()`);
    await ctx.page.waitForTimeout(600);
    await visShot(ctx, '12-story');
    await click(ctx, 'reveal:close');
    await ctx.page.waitForTimeout(600);
    await visShot(ctx, '12b-end');
    await ctx.page.context().close();
  }
  // ⑤ 图鉴、成就、怎么玩
  {
    const ctx = await openPage(browser, 'vis-meta', '', { storage: VIS_TIPS });
    await ctx.page.evaluate(() => window.__game?.setProfile('partial'));
    await waitIdle(ctx, '换档案', "window.__game.scene === 'title'");
    await ctx.page.waitForTimeout(400);
    await click(ctx, 'codex');
    await dialogOpen(ctx, 'codex:close');
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '13-codex');
    await click(ctx, 'codex:tab:achievements');
    await ctx.page.waitForTimeout(300);
    await visShot(ctx, '14-achievements');
    await press(ctx, 'Escape');
    await click(ctx, 'codex:close').catch(() => {});
    await waitFor(ctx, '关掉图鉴', `'help' in g.controls() && !('codex:close' in g.controls())`);
    await ctx.page.waitForTimeout(300);
    await click(ctx, 'help');
    await dialogOpen(ctx, 'help:next');
    for (let i = 1; i <= 8 && 'help:next' in (await controls(ctx)); i++) {
      await ctx.page.waitForTimeout(250);
      await visShot(ctx, `15-help-${i}`);
      await click(ctx, 'help:next');
    }
    await ctx.page.context().close();
  }
  const fs = await import('node:fs');
  fs.writeFileSync(`${OUT}/counts.json`, JSON.stringify(visCounts, null, 1));
  for (const c of visCounts) notes.push(`${c.file}\t${c.han}`);
}

async function main(): Promise<void> {
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  try {
    server = await createServer({
      root: process.cwd(),
      logLevel: 'warn',
      server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false },
    });
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === 'string') throw new Error('vite 没有监听端口');
    BASE = `http://127.0.0.1:${addr.port}/`;
    // 无 GPU 虚拟机：WebGL 走 SwiftShader；受限环境下 zygote/独立 GPU 进程可能起不来，统一关掉
    browser = await chromium.launch({
      args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'],
    });
    if (process.argv.includes('--v05')) {
      const only = process.argv.includes('--l3') ? [3] : process.argv.includes('--l1') ? [1] : [1, 3];
      const ui = process.argv.indexOf('--until');
      const until = ui > 0 ? Number(process.argv[ui + 1]) : 99;
      for (const lv of only) await playtest05(browser, lv, `L${lv}`, lv === 1 ? 7919 : 9001, until);
    } else if (process.argv.includes('--vis')) await visShots(browser);
    else if (process.argv.includes('--playtest')) await playtest(browser);
    else if (process.argv.includes('--meta')) await metaShots(browser);
    else if (process.argv.includes('--friendly')) await friendlyShots(browser);
    else if (process.argv.includes('--real')) await realShots(browser);
    else if (process.argv.includes('--story')) await storyShots(browser);
    else if (process.argv.includes('--ext')) await extShots(browser);
    else if (process.argv.includes('--cloud')) await cloudShots(browser);
    else if (process.argv.includes('--lowmem')) await lowMemShots(browser);
    else if (process.argv.includes('--board')) await boardShots(browser);
    else if (process.argv.includes('--lobby')) await lobbyShots(browser);
    else if (process.argv.includes('--live')) await liveShots(browser);
    else if (process.argv.includes('--main')) await run(browser);
    else {
      await run(browser);
      await metaShots(browser);
      await friendlyShots(browser);
      await realShots(browser);
      await storyShots(browser);
    }
  } catch (err) {
    errors.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
  for (const p of shots) console.log(p);
  for (const n of notes) console.log(n);
  if (errors.length > 0) {
    console.error(`\n失败（${errors.length}）：`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`\n全部通过，共 ${shots.length} 张截图。`);
}

await main();
