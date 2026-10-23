/**
 * 验收截图（真实运行，正常速度，不开 ?turbo）：电脑 1280×720、手机竖屏 390×844，存到 shots/v030-<屏>-<场景>.png。
 * - lobby 首页；room-weapons 准备房间（3v3、我的武器页签）、room-maps（地图页签）、room-maps-2（往下滑，"快图""慢图"角标）、room-maps-3（滑到底：0.4.0 的新图和"随机"）、room-bot（给黄队 2 号换人物和武器）；
 * - map-<id> 11 张图各开一局 3v3，轮到我时截一张；items 第一张轮得到我的图上道具栏叠了一组（三岔 + 连发 +1 + 连发 +2）；
 * - lobby-resume 打到一半回首页（有"接着上一局"）；
 * - out 最后一张图上我故意把自己炸出局（烟花筒正上方连发 +1 叠两个），出现"快进""跳到结果"；end 跳到结果以后的结算页。
 * - friend-* 好友房（scripts/net.ts，本机起真的 Worker，两个浏览器上下文 A、B 同一种屏）：room6（3v3 六个位子坐满）、room（两个真人 + 一个电脑，2 对 1）、
 *   aim（B 看着 A 瞄准："小A正在瞄准…"、倒计时）、end（结算），后缀 -a / -b 是谁的屏幕。
 * - tilt 角色贴着斜坡站（找一个开局我就站在斜坡上、先手是我的种子，读档进来）；
 *   craters 8 把武器的坑形和焦痕在实战里：每把一局 1v1（两边同一把武器），我先往身边打一发、电脑回一发，轮到我时截我身边，8 张拼成一张。
 * "我"用真按钮和手势出手（scripts/drive.ts），电脑那边照常。种子写死（?seed=1），每屏一样。
 * - v031-desk-flight 一发高抛（冲天烟花筒，我真按发射）从出手到落地每 0.25 秒截一张，拼成一张（看上升减速、到顶、下落加速，DESIGN.md 2.2.1）。
 * 用法：npm run shots [desk|port|friend|art|flight]（friend 只截好友房，art 只截 tilt、craters，flight 只截连拍）
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { launch } from './browser.ts';
import { aimAndFire, myTurn } from './drive.ts';
import { netRoute } from './net.ts';
import { plan, planActions } from '../src/ai/index.ts';
import { apply, newGame } from '../src/core/rules.ts';
import { solidAt } from '../src/core/terrain.ts';
import type { Action, Setup, State } from '../src/core/types.ts';
import { WEAPON_IDS, WEAPONS, type WeaponId } from '../src/core/weapons.ts';
import { MAP_IDS } from '../src/core/maps.ts';
import { defaultRoom, roomSetup } from '../src/room.ts';
import { SOLO_KEY, SOLO_VERSION } from '../src/solo.ts';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}shots`, { recursive: true });
const only = process.argv[2];
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await launch();
const MAPS = MAP_IDS;

type Hook = { __danli: { state(): { phase: string; actor: number; chars: { x: number; out: boolean; ai: boolean }[] }; preview(a: unknown): { ok: boolean; events?: { t: string; x?: number }[] } } };

/** 等到轮到我；我出局了或者打完了回 false */
async function waitMine(page: Page, ms = 240_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.$('.dl-spect:not([hidden]), .dl-result')) return false;
    if (await myTurn(page)) return true;
    await page.waitForTimeout(80);
  }
  throw new Error('等太久了');
}

/** 往正上方打（88°）、连发 +1 叠两个，挑落点离自己最近的力度 */
async function selfDestruct(page: Page): Promise<void> {
  const power = await page.evaluate(() => {
    const d = (window as unknown as Hook).__danli;
    const me = d.state().chars[d.state().actor]!;
    let best = { power: 6, dist: 1e9 };
    for (let p = 1; p <= 30; p++) {
      const r = d.preview({ t: 'fire', angle: 88, power: p, facing: 1, p1: 2 });
      const booms = (r.ok ? (r.events ?? []) : []).filter((e) => e.t === 'boom');
      if (!booms.length) continue;
      const dist = booms.reduce((n, e) => n + Math.abs((e.x ?? 0) - me.x), 0) / booms.length;
      if (dist < best.dist) best = { power: p, dist };
    }
    return best.power;
  });
  await page.click('.dl-item[data-item="p1"]');
  await page.click('.dl-item[data-item="p1"]');
  await aimAndFire(page, 88, 1, power);
}

/** 从首页进房间，选好 3v3、这张图、我拿冲天烟花筒，开打 */
async function startOn(page: Page, map: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/games/danli/?seed=1`);
  await page.waitForSelector('.dl-lobby .start');
  await page.click('.dl-lobby .start');
  await page.waitForSelector('.dl-room');
  await page.click('.dl-seg button[data-size="3"]');
  await page.click('.tabs button[data-tab="map"]');
  await page.click(`.dl-mapcard[data-map="${map}"]`);
  await page.click('.dl-room-go');
  await page.waitForSelector('.dl-hud');
}

const SCREENS = [
  ['desk', { viewport: { width: 1280, height: 720 } }],
  ['port', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
] as const;

for (const [name, opts] of SCREENS) {
  if (only && only !== name) continue;
  const page = await browser.newPage(opts);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const file = (s: string): string => `${root}shots/v030-${name}-${s}.png`;
  await page.goto(`http://127.0.0.1:${port}/games/danli/?seed=1`);
  await page.waitForSelector('.dl-lobby');
  await page.evaluate(() => {
    localStorage.removeItem('danli.solo');
    localStorage.removeItem('danli.prefs');
  });
  await page.reload();
  await page.waitForSelector('.dl-lobby .start');
  await page.waitForTimeout(400);
  await page.screenshot({ path: file('lobby') });

  // 准备房间三张：我的武器、地图、给黄队 2 号换
  await page.click('.dl-lobby .start');
  await page.waitForSelector('.dl-room');
  await page.click('.dl-seg button[data-size="3"]');
  await page.click('.dl-wcard[data-weapon="rocket"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('room-weapons') });
  await page.click('.tabs button[data-tab="map"]');
  await page.click('.dl-mapcard[data-map="dumpling"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('room-maps') });
  // 地图页签往下滑：第二排（便当群岛"快图"、早餐吐司桥"慢图"）
  await page.evaluate(() => {
    const sheet = document.querySelector('.dl-room .sheet') as HTMLElement;
    sheet.scrollTo(0, (document.querySelector('.dl-mapcard[data-map="bento"]') as HTMLElement).offsetTop - 14);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('room-maps-2') });
  // 滑到底：0.4.0 的 5 张新图和"随机"
  await page.evaluate(() => {
    const sheet = document.querySelector('.dl-room .sheet') as HTMLElement;
    sheet.scrollTo(0, sheet.scrollHeight);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('room-maps-3') });
  await page.click('.dl-slot[data-seat="3"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('room-bot') });

  // 11 张图各开一局，轮到我时截一张；最后一张接着打：把自己炸出局、跳到结果
  let itemsShot = false;
  for (const map of MAPS) {
    await startOn(page, map);
    const alive = await waitMine(page, 120_000);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: file(`map-${map}`) });
    // 0.3.0 不推人以后，开局几手里我可能还没出手就被炸下去了：道具那张截在第一张轮得到我的图上
    if (alive && !itemsShot) {
      itemsShot = true;
      // 道具栏叠了一组：三岔 + 连发 +1 + 连发 +2（正好 100 体力），上面那一行写着选了什么
      for (const k of ['fork', 'p1', 'p2']) await page.click(`.dl-item[data-item="${k}"]`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: file('items') });
    }
  }
  // 打到一半回首页：有"接着上一局"
  await page.goto(`http://127.0.0.1:${port}/games/danli/?seed=1`);
  await page.waitForSelector('.dl-lobby .resume');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file('lobby-resume') });
  await page.click('.dl-lobby .resume');
  await page.waitForSelector('.dl-hud');
  let n = 0;
  while (await waitMine(page)) {
    await selfDestruct(page);
    if (++n > 12) throw new Error('炸了 12 手自己还没出局');
  }
  if (!(await page.$('.dl-result'))) {
    await page.waitForSelector('.dl-spect:not([hidden])');
    await page.waitForTimeout(600);
    await page.screenshot({ path: file('out') });
    await page.click('.dl-skip-btn');
  }
  await page.waitForSelector('.dl-result', { timeout: 300_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file('end') });
  console.log(`${name}: ${errors.length ? errors.join('；') : '截完'}`);
  await page.close();
}

/** 1v1 的开局设置：两边同一把武器 */
function duel(map: 'kitchen' | 'icecream' | 'dumpling' | 'bento' | 'nightmarket' | 'breakfast', w: WeaponId): Setup {
  const r = roomSetup({ ...defaultRoom(), size: 1, map }, '我', () => map);
  return { ...r, players: r.players.map((p) => ({ ...p, weapon: w })) };
}

/** 脚下地面的坡度（度）：和画面（view/scene.ts 的 slopeAt）同一个量法 */
function slope(s: State, id: number): number {
  const c = s.chars[id]!;
  const surface = (x: number): number | null => {
    for (let y = c.y - 16; y <= c.y + 24; y += 2) if (solidAt(s.terrain, x, y)) return y;
    return null;
  };
  const l = surface(c.x - 12) ?? c.y;
  const r = surface(c.x + 12) ?? c.y;
  return (Math.atan2(r - l, 24) * 180) / Math.PI;
}

/** 把一局存成单机存档，从首页"接着上一局"读进来，等到轮到我 */
async function resumeSave(page: Page, key: number[], setup: Setup, log: Action[]): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/games/danli/`);
  await page.waitForSelector('.dl-lobby');
  await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [SOLO_KEY, JSON.stringify({ v: SOLO_VERSION, key, setup, log })]);
  await page.reload();
  await page.waitForSelector('.dl-lobby .resume');
  await page.click('.dl-lobby .resume');
  await page.waitForSelector('.dl-hud');
  await waitMine(page, 60_000);
  await page.waitForTimeout(1500);
}

for (const [name, opts] of SCREENS) {
  if (only && only !== name && only !== 'art') continue;
  const page = await browser.newPage(opts);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // 斜坡：找开局我就站在 18°–35° 的坡上、先手是我的
  let found: { key: number[]; setup: Setup; deg: number } | null = null;
  for (let seed = 1; seed < 400 && !found; seed++) {
    for (const map of ['icecream', 'kitchen', 'nightmarket', 'dumpling'] as const) {
      const key = [seed, 7, 7, 7, 7, 7, 7, 7];
      const setup = duel(map, 'steamer');
      const st = newGame(key, setup);
      const deg = slope(st, 0);
      if (st.actor === 0 && Math.abs(deg) >= 18 && Math.abs(deg) <= 35) {
        found = { key, setup, deg };
        break;
      }
    }
  }
  if (!found) throw new Error('找不到开局站在斜坡上的种子');
  await resumeSave(page, found.key, found.setup, []);
  await page.screenshot({ path: `${root}shots/v030-${name}-tilt.png` });
  // 8 把武器的坑：每把一局，我往身边打一发、电脑回一发，轮到我时截我身边
  const tiles: string[] = [];
  for (const w of WEAPON_IDS) {
    let made: { key: number[]; setup: Setup; log: Action[] } | null = null;
    for (let seed = 1; seed < 200 && !made; seed++) {
      const key = [seed, 9, 9, 9, 9, 9, 9, 9];
      const setup = duel('kitchen', w);
      let st = newGame(key, setup);
      if (st.actor !== 0) continue;
      const me = st.chars[0]!;
      const wp = WEAPONS[w];
      let shot: Action | null = null;
      for (let a = wp.minAngle; a <= wp.maxAngle && !shot; a += 2) {
        for (let p = 8; p <= 60 && !shot; p++) {
          for (const facing of [1, -1] as const) {
            const act: Action = { t: 'fire', angle: a, power: p, facing };
            const r = apply(st, act);
            if (!r.ok) continue;
            const b = r.events.find((e) => e.t === 'boom');
            if (!b || b.t !== 'boom' || r.events.some((e) => e.t === 'hurt' || e.t === 'fall')) continue;
            const dx = Math.abs(b.x - me.x);
            if (dx >= 70 && dx <= 130 && b.y > me.y - 10 && b.y < me.y + 30) {
              shot = act;
              break;
            }
          }
        }
      }
      if (!shot) continue;
      const log: Action[] = [shot];
      st = (apply(st, shot) as { state: State }).state;
      while (st.phase === 'play' && st.actor !== 0) {
        for (const a of planActions(plan(st, {}))) {
          const r = apply(st, a);
          if (!r.ok) throw new Error(r.error);
          log.push(a);
          st = r.state;
        }
      }
      if (st.phase === 'play' && !st.chars[0]!.out) made = { key, setup, log };
    }
    if (!made) throw new Error(`${w}：找不到合适的一局`);
    await resumeSave(page, made.key, made.setup, made.log);
    const at = (await page.evaluate('window.__danli.actorScreen()')) as [number, number];
    const vw = page.viewportSize()!;
    const cw = Math.min(360, vw.width - 20);
    const ch = 220;
    const x = Math.max(0, Math.min(vw.width - cw, at[0] - cw / 2));
    const y = Math.max(0, Math.min(vw.height - ch, at[1] - ch / 2));
    const buf = await page.screenshot({ clip: { x, y, width: cw, height: ch } });
    tiles.push(`<figure><img src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${WEAPONS[w].name}</figcaption></figure>`);
  }
  // 拼图：桌面 4 × 2，竖屏 2 × 4
  const cols = name === 'desk' ? 4 : 2;
  const sheet = await browser.newPage({ viewport: { width: cols * 380, height: 100 }, deviceScaleFactor: 1 });
  await sheet.setContent(
    `<style>body{margin:0;padding:10px;background:#efe6d2;font:700 16px sans-serif;color:#46291a;display:grid;grid-template-columns:repeat(${cols},360px);gap:10px}` +
      `figure{margin:0}img{width:360px;display:block;border:2px solid #46291a;border-radius:8px}figcaption{text-align:center;padding-top:4px}</style>${tiles.join('')}`,
  );
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${root}shots/v030-${name}-craters.png`, fullPage: true });
  await sheet.close();
  console.log(`${name} 斜坡（${found.deg.toFixed(0)}°）、坑形：${errors.length ? errors.join('；') : '截完'}`);
  await page.close();
}

// 连拍：一发高抛，每 0.25 秒一张（电脑屏）
if (!only || only === 'desk' || only === 'flight') {
  const page = await browser.newPage(SCREENS[0][1]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // 先手是我、往对手那边 72° 高抛能落在地上（离我 500–1000、飞 2–3 秒）的一局
  let pick: { key: number[]; setup: Setup; facing: 1 | -1; power: number } | null = null;
  for (let seed = 1; seed < 300 && !pick; seed++) {
    const key = [seed, 5, 5, 5, 5, 5, 5, 5];
    const setup = duel('kitchen', 'rocket');
    const st = newGame(key, setup);
    if (st.actor !== 0) continue;
    const me = st.chars[0]!;
    const facing: 1 | -1 = st.chars[1]!.x > me.x ? 1 : -1;
    for (let power = 40; power <= 80 && !pick; power += 2) {
      const r = apply(st, { t: 'fire', angle: 72, power, facing });
      if (!r.ok) continue;
      const shot = r.events.find((e) => e.t === 'shot');
      const boom = r.events.find((e) => e.t === 'boom');
      if (!shot || shot.t !== 'shot' || !boom || boom.t !== 'boom' || r.events.some((e) => e.t === 'hurt' && e.id === 0)) continue;
      const steps = shot.flights[0]!.path.length / 2;
      const dx = Math.abs(boom.x - me.x);
      if (steps >= 120 && steps <= 180 && dx >= 500 && dx <= 1000) pick = { key, setup, facing, power };
    }
  }
  if (!pick) throw new Error('找不到合适的高抛');
  await resumeSave(page, pick.key, pick.setup, []);
  // 用 CDP 的屏幕录像拿每一帧（带时间戳），再挑离 0、0.25、0.5……秒最近的那一帧：逐张截图本身要 0.3 秒，赶不上
  const cdp = await page.context().newCDPSession(page);
  const shots: { ts: number; data: string }[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    shots.push({ ts: f.metadata.timestamp ?? Date.now() / 1000, data: f.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await aimAndFire(page, 72, pick.facing, pick.power);
  const flying = (): Promise<boolean> => page.evaluate('window.__danli.flying()') as Promise<boolean>;
  const t0 = Date.now();
  while (!(await flying()) && Date.now() - t0 < 5000) await page.waitForTimeout(5);
  const start = Date.now() / 1000;
  while ((await flying()) && Date.now() / 1000 - start < 10) await page.waitForTimeout(5);
  const end = Date.now() / 1000;
  await page.waitForTimeout(700);
  await cdp.send('Page.stopScreencast');
  const frames: { t: number; png: string; label: string }[] = [];
  const nearest = (t: number): { ts: number; data: string } => shots.reduce((a, b) => (Math.abs(b.ts - t) < Math.abs(a.ts - t) ? b : a));
  for (let t = start; t <= end + 0.001; t += 0.25) {
    const f = nearest(t);
    frames.push({ t: f.ts - start, png: f.data, label: `${(t - start).toFixed(2)} 秒` });
  }
  frames.push({ t: end - start + 0.7, png: shots.at(-1)!.data, label: '落地后' });
  const sheet = await browser.newPage({ viewport: { width: 3 * 650 + 40, height: 100 }, deviceScaleFactor: 1 });
  await sheet.setContent(
    `<style>body{margin:0;padding:10px;background:#efe6d2;font:700 15px sans-serif;color:#46291a;display:grid;grid-template-columns:repeat(3,640px);gap:10px}` +
      `figure{margin:0}img{width:640px;display:block;border:2px solid #46291a;border-radius:8px}figcaption{text-align:center;padding-top:3px}</style>` +
      frames.map((f) => `<figure><img src="data:image/png;base64,${f.png}"><figcaption>${f.label}</figcaption></figure>`).join(''),
  );
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${root}shots/v031-desk-flight.png`, fullPage: true });
  await sheet.close();
  console.log(`连拍：飞了 ${(end - start).toFixed(2)} 秒，${frames.length - 1} 张飞行中 + 1 张落地后（录到 ${shots.length} 帧）${errors.length ? `；${errors.join('；')}` : '，截完'}`);
  await page.close();
}

// 好友房：两个游客、真的本地 Worker，两边同一种屏
for (const [name, opts] of SCREENS) {
  if (only && only !== name && only !== 'friend') continue;
  const errors = await netRoute(browser, {
    a: opts,
    b: opts,
    turbo: false,
    snap: (moment, who, page) => page.waitForTimeout(400).then(() => page.screenshot({ path: `${root}shots/v030-${name}-friend-${moment}-${who}.png` })).then(() => {}),
  });
  console.log(`${name} 好友房：${errors.length ? errors.join('；') : '截完'}`);
}

await browser.close();
await server.close();
