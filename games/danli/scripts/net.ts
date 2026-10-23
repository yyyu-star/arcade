/**
 * 好友房走一遍（冒烟 smoke.ts、截图 shots.ts 共用）：两个浏览器上下文（两个游客）、真的本地 Worker（worker.ts）：
 * A 开房 → 复制链接 → B 用链接进房（自动坐进黄队）→ B 换小动物和武器 → A 改 3v3、空位都加电脑（6 个位子），再改 2v2、撤掉一个电脑（2 对 1）、换地图（0.4.0 的生日蛋糕城）→ A 先点开打（B 没准备，开不了）→ B 准备 → A 开打 →
 * 各打几手（真按钮：爬、道具、拖角度盘、按住发射）→ B 刷新页面，回到原来的局面 → 轮到 B 时不动，30 秒后按超时弃权 →
 * B 把自己炸出局（烟花筒正上方连发 +1 叠两个），黄队没人了、打完 → 两边都到结算页 → A 点"再来一局"，两边回到同一个房间，B 的选择还在。
 * 检查控制台零报错（别的请求失败、4xx、5xx 都算）。snap 在几个时刻截图（6 个位子的房间、2 对 1 的房间、某某正在瞄准、结算）。
 */
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { aimAndFire, myTurn, playTurn } from './drive.ts';
import { startWorker } from './worker.ts';

type Net = {
  __danliNet: {
    code: string;
    view(): { phase: string; map: string; slots: ({ k: string; seat: number; look: string; weapon: string; ready: boolean } | null)[]; game: { log: { pass?: true }[] } | null } | null;
    room(): { turn: { seat: number } | null } | null;
    seat(): number | null;
    page(): string | null;
    note(): string | null;
  };
  __danli?: {
    state(): { turn: number; phase: string; actor: number; chars: { x: number; y: number; hp: number; out: boolean }[] };
    preview(a: unknown): { ok: boolean; events?: { t: string; x?: number }[] };
    busy(): boolean;
    net(): { mine: number; log: number; applied: number };
  };
};

export interface NetOpts {
  a: BrowserContextOptions;
  b: BrowserContextOptions;
  /** 动画加速（冒烟）；截图用正常速度 */
  turbo: boolean;
  /** 截图：name 是时刻（room6、room、aim、end），who 是 a 或 b */
  snap?(name: string, who: 'a' | 'b', page: Page): Promise<void>;
  log?(line: string): void;
}

const net = (p: Page) => ({
  view: () => p.evaluate(() => (window as unknown as Net).__danliNet.view()),
  seat: () => p.evaluate(() => (window as unknown as Net).__danliNet.seat()),
  page: () => p.evaluate(() => (window as unknown as Net).__danliNet?.page() ?? null),
  state: () => p.evaluate(() => (window as unknown as Net).__danli!.state()),
  logLen: () => p.evaluate(() => (window as unknown as Net).__danliNet.view()?.game?.log.length ?? 0),
  /** 页面放完了收到的每一手（没在放动画、没有发出去等回音的），放到第几手 */
  settled: () =>
    p.evaluate(() => {
      const d = (window as unknown as Net).__danli;
      if (!d || d.busy()) return -1;
      const n = d.net();
      return n.applied === n.log ? n.log : -1;
    }),
});

/** 两边都放完动画、放到同一手：这时两边的局面才能拿来比 */
async function inSync(a: Page, b: Page): Promise<boolean> {
  const [x, y] = [await net(a).settled(), await net(b).settled()];
  return x >= 0 && x === y;
}

/** 往正上方打（88°）、连发 +1 叠两个，挑落点离自己最近的力度：把自己脚下炸穿 */
async function selfDestruct(page: Page): Promise<void> {
  const pick = await page.evaluate(() => {
    const d = (window as unknown as Net).__danli!;
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

async function until(what: string, ms: number, ok: () => Promise<boolean>): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等不到：${what}`);
}

export async function netRoute(browser: Browser, o: NetOpts): Promise<string[]> {
  const errors: string[] = [];
  const log = o.log ?? (() => {});
  const w = await startWorker();
  const origin = new URL(w.base).origin;
  const watch = (p: Page, who: string): void => {
    p.on('response', (r) => {
      if (r.status() >= 400) errors.push(`${who}: ${r.status()} ${new URL(r.url()).pathname}`);
    });
    p.on('requestfailed', (r) => {
      // 刷新页面时浏览器自己掐断还没回的请求（中止），不算
      if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) errors.push(`${who}: 请求失败 ${new URL(r.url()).pathname}：${r.failure()?.errorText ?? ''}`);
    });
    p.on('console', (m) => {
      if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`);
    });
    p.on('pageerror', (e) => errors.push(`${who}: ${String(e)}`));
  };
  const ctxA = await browser.newContext(o.a);
  const ctxB = await browser.newContext(o.b);
  await ctxA.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  watch(a, 'A');
  watch(b, 'B');
  const q = o.turbo ? '&turbo' : '';
  try {
    // A 开房
    await a.goto(`${w.base}?name=${encodeURIComponent('小A')}${q}`);
    await a.waitForSelector('.dl-lobby .open-room');
    await a.click('.dl-lobby .open-room');
    await a.waitForSelector('.dl-friend .code b');
    const code = (await a.textContent('.dl-friend .code b'))!.trim();
    if (!/^\d{6}$/.test(code)) errors.push(`房间码不对：${code}`);
    if (!a.url().includes(`room=${code}`)) errors.push(`开房以后地址上没有房间码：${a.url()}`);
    await until('A 坐进蓝队 1 号', 10_000, async () => !!(await a.$('.dl-slot.me[data-slot="0"]')));
    await a.click('.dl-friend .copy');
    await until('"链接复制好了"', 5000, async () => ((await a.textContent('.dl-friend .say .line')) ?? '').includes('复制好了'));
    const link = await a.evaluate(() => navigator.clipboard.readText());
    if (!link.includes(`?room=${code}`)) errors.push(`复制的链接不对：${link}`);
    log(`房间 ${code}，链接 ${new URL(link).pathname}${new URL(link).search}`);

    // B 用链接进房：自动坐进黄队 1 号；换兔兔、冲天烟花筒
    await b.goto(`${link}&name=${encodeURIComponent('小B')}${q}`);
    await b.waitForSelector('.dl-friend .dl-slot.me');
    if ((await b.getAttribute('.dl-friend .dl-slot.me', 'data-slot')) !== '3') errors.push('B 进房没坐进黄队 1 号');
    await b.click('.dl-friend .dl-slot.me');
    await b.click('.faces button[data-look="rabbit"]');
    await until('B 换成兔兔', 5000, async () => (await net(b).view())?.slots[3]?.look === 'rabbit');
    await b.click('.arms button[data-weapon="rocket"]');
    await until('B 换成烟花筒', 5000, async () => (await net(b).view())?.slots[3]?.weapon === 'rocket');
    await b.click('.pickfoot .dl-btn:last-child');
    // A 看得到 B 的选择、名字
    await until('A 看到 B', 5000, async () => ((await a.textContent('.dl-slot[data-slot="3"] .who b')) ?? '') === '小B');
    if ((await net(a).view())?.slots[3]?.weapon !== 'rocket') errors.push('A 看到的 B 的武器不对');

    // A：先 3v3、空位都加电脑（6 个位子坐满，截图看竖屏放不放得下），再改 2v2、撤掉黄队 2 号的电脑（2 对 1）
    await a.click('.dl-seg button[data-size="3"]');
    await until('3v3', 5000, async () => !!(await a.$('.dl-slot[data-slot="5"]')));
    for (const i of [1, 2, 4, 5]) {
      await a.click(`.dl-slot.empty[data-slot="${i}"] .botbtn`);
      await until(`电脑坐进 ${i} 号位子`, 5000, async () => (await net(a).view())?.slots[i]?.k === 'bot');
    }
    await until('B 看到 6 个位子', 5000, async () => (await b.$$('.dl-friend .dl-slot:not(.empty)')).length === 6);
    await o.snap?.('room6', 'a', a);
    await o.snap?.('room6', 'b', b);
    await a.click('.dl-seg button[data-size="2"]');
    await until('2v2', 5000, async () => !(await a.$('.dl-slot[data-slot="5"]')));
    await a.click('.dl-slot[data-slot="4"]');
    await a.click('.pick .delbot');
    await until('撤掉黄队 2 号的电脑', 5000, async () => (await net(a).view())?.slots[4] === null && (await net(a).view())?.slots[1]?.k === 'bot');
    if (await b.$('.dl-seg button[data-size="1"]:not([disabled])')) errors.push('B 不是房主，对阵却能点');
    // A 换一张 0.4.0 的新图（生日蛋糕城），B 那边看得到
    await a.click('.dl-friend .tabs button[data-tab="map"]');
    await a.click('.dl-friend .dl-mapcard[data-map="cake"]');
    await until('换成生日蛋糕城', 5000, async () => (await net(b).view())?.map === 'cake');
    await a.click('.dl-room-go[data-act="start"]');
    await until('提示等 B 准备', 5000, async () => ((await a.textContent('.dl-friend .say .line')) ?? '').includes('小B'));
    await b.click('.dl-room-go[data-act="ready"]');
    await until('A 看到 B 准备了', 5000, async () => !!(await a.$('.dl-slot[data-slot="3"] .ready.on')));
    await o.snap?.('room', 'a', a);
    await o.snap?.('room', 'b', b);
    await a.click('.dl-room-go[data-act="start"]');
    await a.waitForSelector('.dl-hud');
    await b.waitForSelector('.dl-hud');
    log('开打');

    // 各打几手；B 刷新一次；B 超时弃权一次；B 最后把自己炸出局
    let shots = { a: 0, b: 0 };
    let reloaded = false;
    let passed = false;
    let aimShot = false;
    let selfTurns = 0;
    const t0 = Date.now();
    while ((await net(a).view())?.phase === 'play') {
      if (Date.now() - t0 > 600_000) throw new Error('打了 10 分钟还没打完');
      if (await myTurn(a)) {
        await playTurn(a, aimShot ? undefined : async () => {
          // 截"某某正在瞄准"：B 看着 A 瞄准
          aimShot = true;
          if (o.snap) {
            await until('截"正在瞄准"前 A、B 两边对齐', 20_000, () => inSync(a, b));
            await o.snap('aim', 'b', b);
          }
        });
        shots.a++;
        continue;
      }
      if (await myTurn(b)) {
        if (shots.b >= 1 && !reloaded) {
          // 刷新：回到原来的局面（同一手、同样的位置），这一手还是 B 的
          reloaded = true;
          // 先等 A、B 两边都把前面几手放完（截图不加速时 A 可能还在放上一手），再拿 A 的局面当"刷新前"
          await until('刷新前 A、B 两边放完动画、对齐', 20_000, () => inSync(a, b));
          const before = await net(a).state();
          const n0 = await net(a).settled();
          await b.reload();
          await b.waitForSelector('.dl-hud');
          await until('B 刷新后回到原来的局面', 30_000, async () => (await net(b).settled()) === n0 && (await net(b).state()).turn === before.turn);
          const after = await net(b).state();
          if (JSON.stringify(after.chars.map((c) => [c.x, c.y, c.hp, c.out])) !== JSON.stringify(before.chars.map((c) => [c.x, c.y, c.hp, c.out]))) errors.push('B 刷新后的局面和 A 看到的不一样');
          log('B 刷新回来了');
          continue;
        }
        if (reloaded && !passed) {
          // 不出手：30 秒后按超时弃权
          passed = true;
          const n = await net(a).logLen();
          await until('超时弃权', 60_000, async () => (await net(a).logLen()) > n);
          const last = await a.evaluate(() => (window as unknown as Net).__danliNet.view()!.game!.log.at(-1));
          if (!last?.pass) errors.push('B 超时以后不是弃权');
          log('B 超时弃权');
          continue;
        }
        if (shots.b < 1) await playTurn(b);
        else {
          await selfDestruct(b);
          selfTurns++;
        }
        shots.b++;
        if (selfTurns > 14) throw new Error('B 炸了 14 手自己还没出局');
        continue;
      }
      await a.waitForTimeout(150);
    }
    log(`打完了：A 出手 ${shots.a} 次，B 出手 ${shots.b} 次（把自己炸了 ${selfTurns} 次）`);
    if (!reloaded || !passed) errors.push(`没走到刷新（${reloaded}）或超时弃权（${passed}）`);
    await a.waitForSelector('.dl-result', { timeout: 60_000 });
    await b.waitForSelector('.dl-result', { timeout: 60_000 });
    await a.waitForTimeout(500);
    await o.snap?.('end', 'a', a);
    await o.snap?.('end', 'b', b);
    if ((await a.$$('.dl-result tr[data-id]')).length !== 3) errors.push('结算表不是 3 行');
    if (!(await b.$('.dl-result .end-again[disabled]'))) errors.push('B 不是房主，"再来一局"却能点');
    // 再来一局：两边回到同一个房间，B 的选择还在、要重新准备
    await a.click('.dl-result .end-again');
    await a.waitForSelector('.dl-friend');
    await b.waitForSelector('.dl-friend');
    const v = await net(b).view();
    const mine = v?.slots[3];
    if (mine?.look !== 'rabbit' || mine.weapon !== 'rocket' || mine.ready) errors.push(`再来一局后 B 的位子不对：${JSON.stringify(mine)}`);
    if (v?.slots[1]?.k !== 'bot' || v.phase !== 'lobby') errors.push('再来一局后电脑或阶段不对');
    if ((await b.textContent('.dl-friend .code b'))?.trim() !== code) errors.push('再来一局后不是同一个房间');
    log('再来一局：回到同一个房间');
  } catch (e) {
    errors.push(String(e));
    await a.screenshot({ path: `${new URL('..', import.meta.url).pathname}shots/smoke-net-fail-a.png` }).catch(() => {});
    await b.screenshot({ path: `${new URL('..', import.meta.url).pathname}shots/smoke-net-fail-b.png` }).catch(() => {});
  }
  await ctxA.close();
  await ctxB.close();
  await w.stop();
  return errors;
}
