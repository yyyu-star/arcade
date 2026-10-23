/**
 * 冒烟（AGENTS.md 第 4 节"每个游戏一个无头浏览器冒烟"）：起 vite 开发服务器（系统分配端口），手机横屏 844×390、竖屏 390×844 各走一遍
 * （都按手机模拟：触屏、像素比 3、CPU 降速 4 倍当省内存设备；?turbo 动画加速）：
 * 首页 → 准备房间 → 选地图（横屏披萨火山、竖屏冰淇淋雪山）→ 3v3 → 换我的武器（冲天烟花筒）和小动物（兔兔，和电脑同一张人物选单，换成在场的就对调）、替一个电脑换武器、静音来回点 →
 * 开打 → 我故意把自己炸出局（烟花筒往正上方打、连发 +1 叠两个（3 轮），落回自己头上）→ 出现"快进""跳到结果"→ 跳到结果 → 结算页 → 回房间。检查：
 * - 控制台零报错。开发时平台接口没起，只放过 /api/ 下的 502、504 和掐断；别的请求失败或 4xx、5xx 都算失败；
 * - danli.prefs 记下了房间里的选择；开局的座位、人物、武器、地图和房间里选的一样；顶栏写"第 N 轮 / 15"；对局里的静音也记得住；
 * - "全图"能切过去再切回来；对局中点"大厅"先问一次（点"接着打"留下）；
 * - 横屏那一遍：模拟一次双指放大（画布和 HUD 不能重排）；轮到我时刷新页面，首页有"接着上一局"（写着地图），接着打出手次数对得上；
 *   叠一组道具（三岔 + 连发 +1 + 连发 +2）真打出去，"已选"那一行、"已选"标记、买不起的红边都对；
 *   出局以后先点一下"快进"再"跳到结果"；
 * - 竖屏那一遍：第一手用一次纸飞机（人真的飞过去了；纸飞机不限次数，按钮上不标剩几次）；
 * - 结算页：6 行（每人一行）、有伤害和结果章、有"再来一局""回房间""大厅"；danli.solo 删掉了；整个画面没被滚走；回房间以后还是 3v3、这张图。
 * 最后走一遍好友房（scripts/net.ts）：打包、本机起真的 Worker（wrangler dev），A 手机横屏、B 手机竖屏两个上下文，
 * 开房 → 链接进房 → 选人选武器、准备 → 加电脑 2 对 1 → 开打 → 各打几手 → B 刷新回到原局面 → B 超时弃权 → 打完 → 再来一局。
 * 用法：npm run smoke（只走好友房：npm run smoke net）。截图在 shots/smoke-*.png。
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { launch } from './browser.ts';
import { aimAndFire, myTurn, playTurn } from './drive.ts';
import { netRoute } from './net.ts';
import { MAP_IDS, MAPS } from '../src/core/maps.ts';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(`${root}shots`, { recursive: true });
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}/games/danli/`;
const browser = await launch();
let failed = false;

type Prefs = { muted: boolean; room: { size: number; map: string; me: { weapon: string; look: string }; foes: { persona: string; weapon: string }[] } };
const prefsOf = (page: Page): Promise<Prefs | null> => page.evaluate(() => JSON.parse(localStorage.getItem('danli.prefs') ?? 'null') as Prefs | null);

type St = { turn: number; round: number; phase: string; actor: number; stamina: number; setup: { map: string }; chars: { x: number; out: boolean; ai: boolean; look: string; name: string; team: number; weapon: string; special: Record<string, number> }[] };
type Hook = { __danli: { state(): St; preview(a: unknown): { ok: boolean; events?: { t: string; x?: number }[] } } };
const stOf = (page: Page): Promise<St> => page.evaluate(() => (window as unknown as Hook).__danli.state());

/** 往正上方打（88°）、连发 +1 叠两个（3 轮），挑三颗落点离自己最近的力度：把自己脚下炸穿 */
async function selfDestruct(page: Page): Promise<void> {
  const pick = await page.evaluate(() => {
    const d = (window as unknown as Hook).__danli;
    const me = d.state().chars[d.state().actor]!;
    let best = { power: 6, dist: 1e9 };
    for (let power = 1; power <= 30; power++) {
      const r = d.preview({ t: 'fire', angle: 88, power, facing: 1, p1: 2 });
      if (!r.ok) continue;
      const booms = (r.events ?? []).filter((e) => e.t === 'boom');
      if (!booms.length) continue;
      const dist = booms.reduce((n, e) => n + Math.abs((e.x ?? 0) - me.x), 0) / booms.length;
      if (dist < best.dist) best = { power, dist };
    }
    return best;
  });
  await page.click('.dl-item[data-item="p1"]');
  await page.click('.dl-item[data-item="p1"]');
  await aimAndFire(page, 88, 1, pick.power);
}

const onlyNet = process.argv[2] === 'net';
for (const [name, viewport] of onlyNet
  ? []
  : ([
      ['land', { width: 844, height: 390 }],
      ['port', { width: 390, height: 844 }],
    ] as const)) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors: string[] = [];
  // 横屏打 0.4.0 的新图（披萨火山），竖屏打老图（冰淇淋雪山）
  const mapId = name === 'land' ? 'pizza' : 'icecream';
  const mapName = MAPS[mapId].name;
  const isApi = (url: string): boolean => new URL(url).pathname.startsWith('/api/');
  page.on('response', (r) => {
    if (r.status() >= 400 && !(isApi(r.url()) && (r.status() === 502 || r.status() === 504))) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on('requestfailed', (r) => {
    if (!isApi(r.url())) errors.push(`请求失败 ${new URL(r.url()).pathname}：${r.failure()?.errorText ?? ''}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 加载失败的资源由上面的 response 逐条核对（浏览器这条消息不带地址）
    if (/^Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    await page.goto(`${base}?turbo&seed=${name === 'land' ? 11 : 12}`);
    await page.waitForSelector('.dl-lobby');
    await page.evaluate(() => {
      localStorage.removeItem('danli.solo');
      localStorage.removeItem('danli.prefs');
    });
    await page.reload();
    await page.waitForSelector('.dl-lobby .start');
    if (await page.$('.dl-lobby .resume')) errors.push('没有存档时首页也有"接着上一局"');
    await page.screenshot({ path: `${root}shots/smoke-${name}-lobby.png` });

    // 准备房间
    await page.click('.dl-lobby .start');
    await page.waitForSelector('.dl-room');
    await page.click('.dl-seg button[data-size="3"]');
    if ((await page.$$('.dl-slot')).length !== 6) errors.push(`3v3 的房间里不是 6 个位子：${(await page.$$('.dl-slot')).length}`);
    await page.click('.tabs button[data-tab="map"]');
    if ((await page.$$('.dl-mapcard')).length !== MAP_IDS.length + 1) errors.push(`地图卡片不是 ${MAP_IDS.length} 张加"随机"：${(await page.$$('.dl-mapcard')).length}`);
    if (!(await page.$('.dl-mapcard[data-map="bento"] .dl-fast'))) errors.push('便当群岛的卡片上没有"快图"角标');
    await page.click(`.dl-mapcard[data-map="${mapId}"]`);
    await page.click('.tabs button[data-tab="weapon"]');
    await page.click('.dl-wcard[data-weapon="rocket"]');
    if (!((await (await page.$('.dl-wcard[data-weapon="slipper"] .tip'))?.textContent()) ?? '').includes('只能平射，打中很疼')) errors.push('拖鞋弹弓的卡上没有"只能平射，打中很疼"');
    // 我的位子：同一张人物选单，换成兔兔（兔兔原来在黄队 1 号，和我对调成柴柴）
    await page.click('.dl-slot[data-seat="me"]');
    if ((await page.$$('.faces button')).length !== 6) errors.push('我的位子的人物选单不是那 6 只');
    await page.click('.faces button[data-persona="tutu"]');
    // 黄队 2 号（鼠鼠）换飞盘
    await page.click('.dl-slot[data-seat="3"]');
    await page.click('.arms button[data-weapon="frisbee"]');
    await page.screenshot({ path: `${root}shots/smoke-${name}-room.png` });
    await page.click('.pickfoot .dl-btn');
    await page.click('.dl-room .dl-mute');
    if (!(await prefsOf(page))?.muted) errors.push('点了静音，danli.prefs 里没记下');
    await page.click('.dl-room .dl-mute');
    const pf = await prefsOf(page);
    if (pf?.muted !== false || pf.room.size !== 3 || pf.room.map !== mapId || pf.room.me.weapon !== 'rocket' || pf.room.me.look !== 'rabbit' || pf.room.foes[1]?.weapon !== 'frisbee')
      errors.push(`danli.prefs 没记对：${JSON.stringify(pf)}`);
    await page.click('.dl-room-go');
    await page.waitForSelector('.dl-hud');
    const st0 = await stOf(page);
    const lineup = st0.chars.map((c) => `${c.team}${c.ai ? '电脑' : `我(${c.look})`}${c.ai ? c.name : ''}:${c.weapon}`).join(' ');
    if (st0.setup.map !== mapId || lineup !== '0我(rabbit):rocket 0电脑橘子:steamer 0电脑团团:milktea 1电脑柴柴:melon 1电脑鼠鼠:frisbee 1电脑企企:paddle')
      errors.push(`开局和房间里选的不一样：${st0.setup.map} ${lineup}`);
    const badge = (await (await page.$('.dl-turn .dl-round'))?.textContent()) ?? '';
    if (!/^第 \d+ 轮 \/ 15$/.test(badge)) errors.push(`顶栏的轮数不对：${badge}`);
    await page.click('.dl-hud .dl-mute');
    await page.click('.dl-hud .dl-mute');
    if ((await prefsOf(page))?.muted !== false) errors.push('对局里的静音点了两下，没回到有声');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${root}shots/smoke-${name}-start.png` });
    // 全图来回切
    await page.click('.dl-view');
    await page.waitForTimeout(600);
    if (!(await page.$('.dl-view.on'))) errors.push('点了"全图"没切过去');
    await page.click('.dl-view');
    if (await page.$('.dl-view.on')) errors.push('再点"全图"没切回跟随');
    if (name === 'land') {
      // 双指放大：CDP 设页面缩放 = 手指捏开的结果；放大时画布和 HUD 的尺寸不能跟着变
      const dims = (): Promise<string> => page.evaluate(() => `${document.querySelector('canvas')!.width}x${document.querySelector('canvas')!.height} ${(document.querySelector('.dl-hud') as HTMLElement).style.cssText}`);
      const before = await dims();
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(600);
      if ((await page.evaluate(() => window.visualViewport?.scale ?? 1)) < 1.5) errors.push('页面没放大');
      if ((await dims()) !== before) errors.push('双指放大时画布或 HUD 重排了');
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(600);
    }
    // 对局中点"大厅"：先问一次，点"接着打"留下
    await page.click('.dl-hud .dl-home');
    await page.waitForSelector('.dl-mask.confirm');
    await page.click('.dl-mask.confirm button:has-text("接着打")');

    const waitMine = async (): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < 180_000) {
        if (await page.$('.dl-spect:not([hidden])')) return false;
        if ((await stOf(page)).phase !== 'play') return false;
        if (await myTurn(page)) return true;
        await page.waitForTimeout(100);
      }
      throw new Error('三分钟还没轮到我');
    };
    if (!(await waitMine())) throw new Error('还没轮到我就出局了');
    if (name === 'land') {
      // 刷新，首页有"接着上一局"，接着打：出手次数对得上
      const turn = (await stOf(page)).turn;
      await page.reload();
      await page.waitForSelector('.dl-lobby');
      const card = (await (await page.$('.dl-lobby .resume'))?.textContent()) ?? '';
      if (!card.includes(mapName) || !card.includes('3v3')) errors.push(`首页"接着上一局"写的不对：${card}`);
      await page.click('.dl-lobby .resume');
      await page.waitForSelector('.dl-hud');
      await page.waitForTimeout(300);
      if ((await stOf(page)).turn !== turn) errors.push(`接着上一局出手次数对不上：${(await stOf(page)).turn} ≠ ${turn}`);
      await waitMine();
      // 叠一组道具真打出去：三岔 + 连发 +1 + 连发 +2（正好 100 体力，4 轮 × 3 颗）。
      // 道具栏上面那一行写着选了什么；连发 +1 想再加一个买不起，描红边
      await page.click('.dl-item[data-item="fork"]');
      await page.click('.dl-item[data-item="p1"]');
      await page.click('.dl-item[data-item="p2"]');
      const picked = (await page.textContent('.dl-picked')) ?? '';
      if (!picked.includes('三岔') || !picked.includes('连发+1') || !picked.includes('连发+2')) errors.push(`"已选"那一行不对：${picked}`);
      if ((await page.getAttribute('.dl-item[data-item="fork"]', 'data-state')) !== 'selected') errors.push('三岔选了没标出来');
      if ((await page.getAttribute('.dl-item[data-item="p1"]', 'data-more')) !== 'no') errors.push('连发 +1 再加一个买不起，没描红边');
      const logLen = (): Promise<number> => page.evaluate(() => (window as unknown as { __danli: { log(): unknown[] } }).__danli.log().length);
      const n0 = await logLen();
      const sug = await page.evaluate(() => (window as unknown as { __danli: { suggest(): { angle: number; power: number; facing: 1 | -1 } } }).__danli.suggest());
      await aimAndFire(page, sug.angle, sug.facing, sug.power);
      const t0 = Date.now();
      while ((await logLen()) === n0 && Date.now() - t0 < 10_000) await page.waitForTimeout(100);
      const last = await page.evaluate(() => (window as unknown as { __danli: { log(): { t: string; fork?: number; p1?: number; p2?: number }[] } }).__danli.log().at(-1));
      if (last?.t !== 'fire' || last.fork !== 1 || last.p1 !== 1 || last.p2 !== 1) errors.push(`三岔 + 连发 +1 + 连发 +2 没打出去：${JSON.stringify(last)}`);
      else console.log(`${name}: 三岔 + 连发 +1 + 连发 +2 打出去了`);
    } else {
      // 竖屏：第一手用纸飞机
      const before = (await stOf(page)).chars[0]!;
      await playTurn(page, undefined, { p1: 0, p2: 0, fork: 0, b10: 0, b20: 0, b50: 0, lid: false, plane: true });
      await page.waitForTimeout(300);
      while ((await stOf(page)).actor === 0 && (await stOf(page)).phase === 'play') await page.waitForTimeout(100);
      const after = (await stOf(page)).chars[0]!;
      if ('plane' in after.special) errors.push(`纸飞机不限次数，状态里不该还记着次数：${JSON.stringify(after.special)}`);
      if (await page.$('.dl-item[data-item="plane"] .dl-item-uses')) errors.push('纸飞机按钮上还标着剩几次');
      if (after.x === before.x && !after.out) errors.push('纸飞机用了，人没动（可能飞出画本作废了）');
    }
    // 把自己炸出局
    let mine = 0;
    while (await waitMine()) {
      await selfDestruct(page);
      if (++mine === 1) await page.screenshot({ path: `${root}shots/smoke-${name}-mid.png` });
      await page.waitForTimeout(300);
      if (mine > 12) throw new Error('炸了 12 手自己还没出局');
    }
    const st1 = await stOf(page);
    if (st1.phase === 'play') {
      await page.waitForSelector('.dl-spect:not([hidden])', { timeout: 30_000 });
      await page.screenshot({ path: `${root}shots/smoke-${name}-out.png` });
      if (name === 'land') {
        await page.click('.dl-fast-btn');
        await page.waitForTimeout(800);
        if (!(await page.$('.dl-fast-btn.on'))) errors.push('点了"快进"没开');
      }
      await page.click('.dl-skip-btn');
    }
    await page.waitForSelector('.dl-result', { timeout: 300_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${root}shots/smoke-${name}-end.png` });
    if ((await page.$$('.dl-result tr[data-id]')).length !== 6) errors.push('结算表不是 6 行');
    for (const sel of ['.end-again', '.end-room', '.end-home', '.dl-result .st', '.dl-result .dmg']) if (!(await page.$(sel))) errors.push(`结算页没有 ${sel}`);
    const scrolled = await page.evaluate(() => {
      const a = document.querySelector('.dl-app')!;
      return a.scrollLeft + a.scrollTop + window.scrollX + window.scrollY;
    });
    if (scrolled) errors.push(`画面被滚走了 ${scrolled} 像素`);
    if (await page.evaluate(() => localStorage.getItem('danli.solo'))) errors.push('打完了 danli.solo 还在');
    const sub = (await (await page.$('.dl-result .sub'))?.textContent()) ?? '';
    console.log(`${name}: ${sub}，我出手 ${mine} 次把自己炸出局`);
    await page.click('.end-room');
    await page.waitForSelector('.dl-room');
    if (!(await page.$('.dl-seg button.on[data-size="3"]'))) errors.push('回房间以后不是 3v3 了');
    await page.click('.tabs button[data-tab="map"]');
    if (!(await page.$(`.dl-mapcard.on[data-map="${mapId}"]`))) errors.push(`回房间以后地图不是${mapName}了`);
  } catch (e) {
    errors.push(String(e));
    await page.screenshot({ path: `${root}shots/smoke-${name}-fail.png` }).catch(() => {});
  }
  if (errors.length) {
    failed = true;
    console.error(`${name}: ${errors.length} 个问题\n  ${errors.join('\n  ')}`);
  } else console.log(`${name}: 通过`);
  await page.close();
}

// 好友房：两个浏览器上下文、真的本地 Worker
{
  const errors = await netRoute(browser, {
    a: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    b: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    turbo: true,
    snap: (moment, who, page) => page.screenshot({ path: `${root}shots/smoke-net-${moment}-${who}.png` }).then(() => {}),
    log: (l) => console.log(`好友房：${l}`),
  });
  if (errors.length) {
    failed = true;
    console.error(`好友房：${errors.length} 个问题\n  ${errors.join('\n  ')}`);
  } else console.log('好友房：通过');
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
