/**
 * 移动手感测量：node tools/feel.ts [--hz 60,120] [--out <文件.json>] [--video <目录>]
 *
 * 为什么用虚拟时钟：真实帧间隔有抖动，测不出"画面层自己造成的"抖动。这里替换 requestAnimationFrame / performance.now，
 * 每次推进固定的一帧（1000/hz 毫秒），逐帧记录主角世界坐标、镜头位置、主角在屏幕上的位置。
 * 按键序列：右走 2 秒 → 停 0.5 秒 → 左走 1.5 秒 → 右上斜走 1.5 秒 → 停 0.7 秒。
 * 判据（每个 hz 各算一遍）：
 *   back  移动中主角（世界坐标，地面上看到的）沿按键方向后退的帧数（应为 0）；
 *   jump  相邻两帧位移之差 / 每帧理论位移 的最大值（起停应 ≲ 1）；
 *   cv    匀速段每帧位移的变异系数（越小越匀）；
 *   sway  匀速段主角在屏幕上的位置摆幅（像素，镜头不来回荡就小）；
 *   camRev  匀速段镜头位移与主角世界位移反向的帧数。
 * 只测不改任何东西；端口由系统分配（vite 端口 0），不占 5178/4178。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const argv = process.argv.slice(2);
const opt = (n: string): string | null => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const HZS = (opt('--hz') ?? '60,120').split(',').map(Number);
const OUTF = opt('--out');
const VIDEO = opt('--video');
if (VIDEO) mkdirSync(VIDEO, { recursive: true });

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
await server.listen();
const addr = server.httpServer?.address();
if (!addr || typeof addr === 'string') throw new Error('vite 没有监听端口');
const BASE = `http://127.0.0.1:${addr.port}/?seed=123`;

interface Sample { f: number; seg: string; ok: boolean; hx: number; hy: number; sx: number; sy: number; cx: number; cy: number; shaking: boolean }

const SEGS: { name: string; keys: string[]; ms: number }[] = [
  { name: 'right', keys: ['KeyD'], ms: 2000 },
  { name: 'stop1', keys: [], ms: 500 },
  { name: 'left', keys: ['KeyA'], ms: 1500 },
  { name: 'upright', keys: ['KeyW', 'KeyD'], ms: 1500 },
  { name: 'stop2', keys: [], ms: 700 },
];

async function run(hz: number): Promise<Sample[]> {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(VIDEO ? { recordVideo: { dir: VIDEO, size: { width: 1280, height: 720 } } } : {}) });
  const page: Page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const realRaf = window.requestAnimationFrame.bind(window);
    const realNow = performance.now.bind(performance);
    let virt = false;
    let vt = 0;
    let q: FrameRequestCallback[] = [];
    performance.now = () => (virt ? vt : realNow());
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      realRaf((t) => {
        if (virt) q.push(cb);
        else cb(t);
      });
      return 1;
    };
    w.__virt = () => { virt = true; vt = realNow(); };
    w.__step = (dt: number) => {
      vt += dt;
      const run = q;
      q = [];
      for (const cb of run) cb(vt);
    };
  });
  page.on('console', (m) => m.type() === 'error' && console.error('页面报错', m.text()));
  page.on('pageerror', (e) => console.error('页面异常', e.message));
  await page.goto(BASE, { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { __yx?: unknown }).__yx, null, { timeout: 20_000 });
  await page.locator('[data-a="start"]').first().click();
  await page.waitForFunction(() => !!(window as unknown as { __yx: { world: unknown } }).__yx.world, null, { timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { __virt: () => void }).__virt());
  const dt = 1000 / hz;
  // 这里 rAF 回调是真实 rAF 转进队列的，所以每步前先等一个真实帧
  const step = async (): Promise<Sample | null> =>
    page.evaluate((d) => {
      const g = window as unknown as { __step: (d: number) => void; __yx: { game: { scene: { getScene: (k: string) => any } } } };
      g.__step(d);
      const sc = g.__yx.game.scene.getScene('game');
      const cam = sc.cameras.main;
      const hx = sc.hero.x as number;
      const hy = sc.hero.y as number;
      const play = sc.w.phase === 'play' && !sc.d.cards.open && sc.hold <= 0;
      if (!play && sc.d.cards.open) (document.querySelector('.yx-pick') as HTMLElement | null)?.click();
      return { f: 0, ok: play, seg: '', hx, hy, sx: (hx - cam.worldView.x) * cam.zoom, sy: (hy - cam.worldView.y) * cam.zoom, cx: cam.scrollX, cy: cam.scrollY, shaking: !!cam.shakeEffect?.isRunning };
    }, dt);
  for (let i = 0; i < Math.round(hz); i++) { await page.waitForTimeout(8); await step(); }
  const out: Sample[] = [];
  for (const seg of SEGS) {
    for (const k of seg.keys) await page.keyboard.down(k);
    const n = Math.round((seg.ms / 1000) * hz);
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(6);
      const s = await step();
      if (s) out.push({ ...s, f: out.length, seg: seg.name });
    }
    for (const k of seg.keys) await page.keyboard.up(k);
  }
  await ctx.close();
  await browser.close();
  return out;
}

const DIR: Record<string, [number, number]> = { right: [1, 0], left: [-1, 0], upright: [0.7071, -0.7071] };

function analyse(hz: number, s: Sample[]) {
  const res: Record<string, number | string> = { hz };
  let back = 0, jump = 0, camRev = 0, shakeFrames = 0;
  let cvs: number[] = [], sways: number[] = [];
  const stopJump: number[] = [];
  // 理论每帧位移：取最长匀速段的中位数
  // 位移用主角世界坐标（地面上看到的移动）；sx/sy 是相对镜头的位置，只用来看镜头荡不荡
  const good = (i: number) => i > 0 && s[i]!.ok && s[i - 1]!.ok;
  const steps = (i: number) => ({ dx: s[i]!.hx - s[i - 1]!.hx, dy: s[i]!.hy - s[i - 1]!.hy });
  const mags: number[] = [];
  for (let i = 1; i < s.length; i++) if (good(i) && s[i]!.seg === 'right' && s[i - 1]!.seg === 'right') mags.push(steps(i).dx);
  mags.sort((a, b) => a - b);
  const unit = mags[Math.floor(mags.length * 0.7)] || 1;
  res.unitPx = +unit.toFixed(3);
  let prevAlong = 0;
  for (let i = 1; i < s.length; i++) {
    if (!good(i) || !good(i - 1)) { prevAlong = 0; continue; }
    const { dx, dy } = steps(i);
    const d = DIR[s[i]!.seg];
    if (s[i]!.shaking) shakeFrames++;
    if (d) {
      const along = dx * d[0] + dy * d[1];
      // 换方向后头几帧（插值要过渡掉上一拍的方向）不算后退
      const sinceChange = s.slice(Math.max(0, i - 3), i + 1).some((x) => x.seg !== s[i]!.seg);
      if (!sinceChange && along < -0.01 * unit) back++;
      if (s[i]!.seg === s[i - 1]!.seg) jump = Math.max(jump, Math.abs(along - prevAlong) / unit);
      prevAlong = along;
    } else {
      // 停下后：任何反向（相对上一段方向）或抖动
      const mag = Math.hypot(dx, dy);
      stopJump.push(mag / unit);
      jump = Math.max(jump, Math.abs(mag - Math.hypot(steps(i - 1 || 1).dx, steps(i - 1 || 1).dy)) / unit);
    }
  }
  // 匀速段：每段跳过前 0.4 秒（加速、镜头追上）
  for (const name of Object.keys(DIR)) {
    const idx = s.map((x, i) => (x.seg === name ? i : -1)).filter((i) => good(i));
    const body = idx.slice(Math.round(hz * 0.4));
    const d = DIR[name]!;
    const al = body.map((i) => steps(i).dx * d[0] + steps(i).dy * d[1]);
    const m = al.reduce((a, b) => a + b, 0) / al.length;
    const sd = Math.sqrt(al.reduce((a, b) => a + (b - m) ** 2, 0) / al.length);
    cvs.push(sd / Math.abs(m));
    res['cv_' + name] = +(sd / Math.abs(m)).toFixed(3);
    const sxs = body.map((i) => s[i]!.sx), sys = body.map((i) => s[i]!.sy);
    sways.push(Math.max(Math.max(...sxs) - Math.min(...sxs), Math.max(...sys) - Math.min(...sys)));
    for (const i of body) {
      const cdx = s[i]!.cx - s[i - 1]!.cx, cdy = s[i]!.cy - s[i - 1]!.cy;
      if (cdx * d[0] + cdy * d[1] < -0.01 * unit) camRev++;
    }
  }
  res.back = back;
  res.jump = +jump.toFixed(2);
  res.cv = +Math.max(...cvs).toFixed(3);
  res.swayPx = +Math.max(...sways).toFixed(2);
  res.camRev = camRev;
  res.shakeFrames = shakeFrames;
  // 起停：每段切换后 3 帧内的最大屏幕位移 / unit
  let edge = 0;
  for (let i = 1; i < s.length; i++) if (s[i]!.seg !== s[i - 1]!.seg) for (let k = i; k < Math.min(s.length, i + 4); k++) if (good(k)) edge = Math.max(edge, Math.hypot(steps(k).dx, steps(k).dy) / unit);
  res.edgeMax = +edge.toFixed(2);
  // 竖向垂直抖动：右走段屏幕 y 摆幅（走路 bob）
  const ry = s.filter((x) => x.ok && x.seg === 'right').map((x) => x.hy);
  res.bobPx = +(Math.max(...ry) - Math.min(...ry)).toFixed(2);
  return res;
}

const all: unknown[] = [];
try {
  for (const hz of HZS) {
    const s = await run(hz);
    all.push(analyse(hz, s));
    if (OUTF) writeFileSync(OUTF.replace(/\.json$/, `-${hz}.samples.json`), JSON.stringify(s));
  }
} finally {
  await server.close();
}
console.log(JSON.stringify(all, null, 1));
if (OUTF) writeFileSync(OUTF, JSON.stringify(all, null, 1));
