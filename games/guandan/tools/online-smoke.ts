/**
 * 联机冒烟：本地联机栈（tools/online-dev.ts：wrangler dev 跑掼蛋 Worker + 房间 + 假平台）上开四个无头浏览器，
 * 电脑 1280×720（房主）、iPhone 横屏、安卓横屏、iPad，各自登一个号，开房 → 输码进房 → 选座 → 房主开局 → 托管打完一整副。
 *
 * 检查：
 * - 四个客户端控制台零报错；
 * - 每个客户端收到的下行原文里没有 seed、hands、key（发牌密钥）；按同一步（view.step）四家的视图拼出真相，任何一份视图（含重连快照）里都没有别人手里的牌，
 *   贡牌、还贡牌按规则给（贡牌分配后公开、分配前只有交的人看得到；还贡牌只有双方看得到）；
 * - 断线 10 秒回来接着打；断线 70 秒（超过 60 秒宽限）期间电脑代打，回来交还；
 * - 页面冻结（模拟切后台）20 秒再恢复能续上；同一个号在另一台设备进房，旧连接让位（4001）并提示。
 *
 * 用法：node tools/online-smoke.ts [--out <截图目录>] [--no-build] [--quick]（--quick 跳过 70 秒那项）
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core';
import type { Card } from '../src/core/index.ts';
import type { NetView } from '../src/net/rules.ts';
import { startOnlineStack, type OnlineStack } from './online-dev.ts';

const OUT = ((): string => {
  const i = process.argv.indexOf('--out');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : `${process.cwd()}/shots/online`;
})();
const QUICK = process.argv.includes('--quick');
/** 省内存标记要带当前版本号才认（device.ts：换了版本就重新试正常画质） */
const VERSION = (JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as { version: string }).version;
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

interface Spec {
  name: string;
  user: string;
  ctx: BrowserContextOptions;
  /** 预置本地存储（iPhone 用"上次被杀"标记进省内存档） */
  storage?: Record<string, string>;
}

const SPECS: Spec[] = [
  { name: '电脑', user: 'u-desk', ctx: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  {
    name: 'iPhone',
    user: 'u-ios',
    ctx: { viewport: { width: 667, height: 331 }, screen: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS },
    storage: { 'guandan.boot': JSON.stringify({ v: 1, pending: 1, low: 0, ver: VERSION }) },
  },
  { name: '安卓', user: 'u-and', ctx: { viewport: { width: 915, height: 412 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID } },
  { name: 'iPad', user: 'u-pad', ctx: { viewport: { width: 1180, height: 820 }, screen: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD } },
];

const errors: string[] = [];
const notes: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

/** 一条收到的下行消息（原文，真实座位视角） */
interface Got {
  seq: number;
  t: string;
  views: NetView[];
}

interface Client {
  spec: Spec;
  context: BrowserContext;
  page: Page;
  got: Got[];
  raw: string[];
}

async function openClient(browser: Browser, stack: OnlineStack, spec: Spec, query: string, reuse?: BrowserContext, online = true): Promise<Client> {
  const context = reuse ?? (await browser.newContext(spec.ctx));
  if (!reuse) {
    // 真平台的会话 cookie 叫 __Host-sid：必须 Secure、Path=/、不带 Domain。Chromium 把 127.0.0.1 当可信来源，http 下也存、也发（含 ws://）
    await context.addCookies([{ name: '__Host-sid', value: spec.user, domain: new URL(stack.origin).hostname, path: '/', secure: true }]);
    // 页面自己问"现在是谁"（记着的房间分账号）走同域 /api/me：本地联机栈里假平台只是服务绑定、同域上没有，这里按这个客户端的账号回答
    await context.route('**/api/me', (r) => r.fulfill({ json: { user: { id: spec.user, displayName: `玩家${spec.user}` } } }));
    const storage = { 'guandan.tutorial': JSON.stringify({ v: 1, done: true }), ...(spec.storage ?? {}) };
    await context.addInitScript((kv) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await context.newPage();
  const c: Client = { spec, context, page, got: [], raw: [] };
  page.on('console', (m) => {
    // 断线测试里浏览器自己打的连接失败不算（关页面、断网是故意的）
    if (m.type() === 'error' && !/WebSocket connection|Failed to load resource/.test(m.text())) errors.push(`[${spec.name}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${spec.name}] pageerror: ${e.message}`));
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString();
      if (text === 'pong') return;
      c.raw.push(text);
      try {
        const m = JSON.parse(text) as { t: string; seq?: number; view?: NetView | null; frames?: { view: NetView | null }[] };
        const views = m.t === 'welcome' ? (m.view ? [m.view] : []) : m.t === 'state' ? (m.frames ?? []).map((f) => f.view).filter((v): v is NetView => !!v) : [];
        c.got.push({ seq: m.seq ?? -1, t: m.t, views });
      } catch {
        errors.push(`[${spec.name}] 下行不是 JSON：${text.slice(0, 80)}`);
      }
    });
  });
  // 机器忙时（别的代理也在跑浏览器）首屏 1.6 MB 的包加载会超过默认的 30 秒
  await page.goto(`${stack.origin}/games/guandan/?${online ? 'online=1&' : ''}debug=1&anim=0&autoplay=1${query}`, { timeout: 90_000 });
  return c;
}

async function until(c: Client, what: string, cond: string, timeout = 60_000): Promise<void> {
  try {
    await c.page.waitForFunction(`(() => { const g = window.__game; return !!g && (${cond}); })()`, null, { timeout, polling: 100 });
  } catch {
    const info = await c.page.evaluate(() => ({ net: window.__game?.net() ?? null, scene: window.__game?.scene, phase: window.__game?.view()?.phase, deal: window.__game?.view()?.dealNo })).catch(() => null);
    throw new Error(`[${c.spec.name}] 等待超时：${what}（${JSON.stringify(info)}）`);
  }
}

async function shot(c: Client, file: string): Promise<void> {
  await c.page.waitForTimeout(300);
  await c.page.screenshot({ path: `${OUT}/${file}.png` });
}

/** 视图里带牌的字段 */
function cardsIn(nv: NetView): Card[] {
  const v = nv.view;
  const out: Card[] = [...v.hand];
  for (const h of v.history) if (h.play) out.push(...h.play.cards);
  if (v.trick.last) out.push(...v.trick.last.play.cards);
  for (const e of v.tribute?.entries ?? []) {
    if (e.card !== null) out.push(e.card);
    if (e.back !== null) out.push(e.back);
  }
  if (v.myTribute) out.push(...v.myTribute.allowed);
  for (const e of nv.events) {
    if (e.type === 'play') out.push(...e.play.cards);
    if (e.type === 'tribute') out.push(e.card);
    if (e.type === 'returnCard' && e.card !== null) out.push(e.card);
  }
  return out;
}

/**
 * 隐藏信息：冒烟拿不到房间的真实状态，就用同一步（view.step）四个座位收到的视图拼出真相——每家的手牌就是它自己的 hand，
 * 贡牌交的人自己看得到、还贡牌双方看得到，所以四家的并集就是真实的贡牌和还贡牌。再按规则查每一份视图：
 * 贡牌分配了（to ≥ 0）才公开、分配前只有交的人看得到；还贡牌只有双方看得到；没入座的人只看得到分配过的贡牌；
 * 别人手里的牌一张都不能出现（按规则看得到的贡牌、还贡牌除外）。
 * 按 step 对（不按 seq），重连后的进房快照（welcome）也算进去；只比四家都收到了的那一步。返回比对过的视图份数（其中带贡牌的份数）。
 */
function checkLeaks(clients: Client[]): { compared: number; withTribute: number } {
  for (const x of clients) for (const t of x.raw) assert(!/"seed"|"hands"|"key"/.test(t), `[${x.spec.name}] 下行里出现了 seed、hands 或发牌密钥`);
  const byStep = new Map<number, { who: string; nv: NetView }[]>();
  for (const c of clients) {
    for (const g of c.got) {
      for (const nv of g.views) {
        const list = byStep.get(nv.view.step) ?? [];
        list.push({ who: c.spec.name, nv });
        byStep.set(nv.view.step, list);
      }
    }
  }
  let compared = 0;
  let withTribute = 0;
  for (const [step, list] of byStep) {
    const seated = new Map<number, NetView>();
    for (const { nv } of list) if (nv.view.seat >= 0) seated.set(nv.view.seat, nv);
    if (seated.size < 4) continue;
    const ref = seated.get(0)!.view;
    const hands = [0, 1, 2, 3].map((k) => seated.get(k)!.view.hand);
    // 真实的贡牌、还贡牌：四家看到的并集
    const truth = (ref.tribute?.entries ?? []).map((e, i) => {
      let card: Card | null = null;
      let back: Card | null = null;
      for (const nv of seated.values()) {
        const x = nv.view.tribute?.entries[i];
        if (x?.card != null) card = x.card;
        if (x?.back != null) back = x.back;
      }
      return { from: e.from, to: e.to, card, back };
    });
    for (const { who, nv } of list) {
      const me = nv.view.seat;
      const tag = `[${who}] 第 ${step} 步（座位 ${me}）`;
      const allowed = new Set<Card>();
      const entries = nv.view.tribute?.entries ?? [];
      assert(entries.length === truth.length, `${tag} 贡牌条数和别家不一样`);
      truth.forEach((t, i) => {
        const card = t.to >= 0 || (me >= 0 && t.from === me) ? t.card : null;
        const back = me >= 0 && (t.from === me || t.to === me) ? t.back : null;
        assert(entries[i]!.card === card, `${tag} 贡牌 ${i} 应为 ${card}，收到 ${entries[i]!.card}`);
        assert(entries[i]!.back === back, `${tag} 还贡牌 ${i} 应为 ${back}，收到 ${entries[i]!.back}`);
        if (card !== null) allowed.add(card);
        if (back !== null) allowed.add(back);
      });
      for (const e of nv.events) {
        const c = e.type === 'tribute' || e.type === 'returnCard' ? e.card : null;
        assert(c === null || allowed.has(c), `${tag} 事件里有不该看的贡牌/还贡牌 ${c}`);
      }
      for (const card of cardsIn(nv)) {
        if (allowed.has(card)) continue;
        for (let o = 0; o < 4; o++) assert(o === me || !hands[o]!.includes(card), `${tag} 看到了座位 ${o} 手里的牌 ${card}`);
      }
      compared++;
      if (truth.length) withTribute++;
    }
  }
  return { compared, withTribute };
}

async function netOf(c: Client): Promise<{ code: string; seat: number | null; status: string; closeCode: number | null; room: string | null; seats: string[] } | null> {
  return c.page.evaluate(() => window.__game?.net() ?? null);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const stack = await startOnlineStack({ build: !process.argv.includes('--no-build') });
  notes.push(`联机栈：${stack.origin}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  const clients: Client[] = [];
  try {
    // ① 房主开房
    const host = await openClient(browser, stack, SPECS[0]!, '');
    clients.push(host);
    await until(host, '标题页', "g.ready && g.scene === 'title'");
    const p = (await host.page.evaluate(() => window.__game!.controls()))['online']!;
    await host.page.mouse.click(p.x, p.y);
    await host.page.click('#ol-create');
    await host.page.waitForSelector('#ol-room-code');
    const code = (await host.page.textContent('#ol-room-code'))!.trim();
    assert(/^\d{6}$/.test(code), `房间码格式不对：${code}`);
    // 开房的人自动坐 0 号位
    await until(host, '房主坐下', 'g.net()?.seat === 0');
    // 开房后地址栏带上房间码：刷新还在这个房间、还是房主、还坐 0 号位
    const search = await host.page.evaluate(() => window.location.search);
    assert(search.includes(`room=${code}`) && search.includes('online=1'), `开房后地址栏应带 room=${code}（实际 ${search}）`);
    await host.page.reload({ timeout: 90_000 });
    await until(host, '刷新后回到房间', `g.net()?.code === '${code}' && g.net()?.seat === 0 && g.net()?.status === 'open'`, 30_000);
    await host.page.waitForSelector('#ol-start', { timeout: 10_000 });
    notes.push(`开房后地址栏带 room=${code}，刷新回到房间（0 号位、房主）`);
    await shot(host, '50-online-lobby-host');
    // ② 另外三个人用邀请链接进房、各坐一个位
    for (let i = 1; i < 4; i++) {
      const c = await openClient(browser, stack, SPECS[i]!, `&room=${code}`);
      clients.push(c);
      // 点开链接自动坐第一个空位（0.6.0），不用再点"坐这里"
      await until(c, '自动坐下', `g.net()?.seat === ${i}`, 30_000);
    }
    await until(host, '四人都坐下', "g.net()?.seats.every((s) => s.startsWith('human'))");
    await shot(host, '51-online-lobby-full');
    await host.page.click('#ol-start');
    for (const c of clients) await until(c, '进牌桌', "g.scene === 'table' && g.view()?.dealNo >= 1", 30_000);
    await shot(clients[1]!, '52-online-iphone-table');
    // 快捷短语：1 号点开互动按钮（fun:button）、选第 1 句；房主那边（画面上 1 号在右手边，是画面座位 1）冒气泡
    const say = clients[1]!;
    const chat = (await say.page.evaluate(() => window.__game!.controls()))['fun:button']!;
    await say.page.mouse.click(chat.x, chat.y);
    await until(say, '短语面板', "!!g.controls()['fun:phrase0']");
    const e0 = (await say.page.evaluate(() => window.__game!.controls()))['fun:phrase0']!;
    await say.page.mouse.click(e0.x, e0.y);
    await until(host, '房主看到 1 号的短语', "g.fxLog.includes('短语 1:0')", 10_000);
    await until(say, '自己也看到自己的短语', "g.fxLog.includes('短语 0:0')", 10_000);
    await shot(host, '52b-online-emote');
    notes.push('快捷短语：1 号发"好牌！"，房主在右手边看到气泡');
    // 道具：1 号点房主的头像（1 号画面上房主在左手边，画面座位 3），扔番茄；两边都播到"1 号扔给 0 号"
    const av = (await say.page.evaluate(() => window.__game!.controls()))['fun:seat3']!;
    await say.page.mouse.click(av.x, av.y);
    await until(say, '头像菜单', "!!g.controls()['fun:prop0']");
    const tom = (await say.page.evaluate(() => window.__game!.controls()))['fun:prop0']!;
    await say.page.mouse.click(tom.x, tom.y);
    await until(host, '房主被扔番茄', "g.fxLog.includes('道具 1>0:tomato')", 10_000);
    await until(say, '扔的人也看到', "g.fxLog.includes('道具 0>3:tomato')", 10_000);
    await host.page.waitForTimeout(900);
    await shot(host, '52c-online-prop');
    notes.push('道具：1 号点房主头像扔番茄，房主头像上糊了一层');
    // 牌桌上也能叫朋友（0.6.1）：无头浏览器没有系统分享，走复制链接或者把链接写出来，不报错
    const inv = (await host.page.evaluate(() => window.__game!.controls()))['invite']!;
    assert(inv, '好友房牌桌上应该有"叫朋友来"');
    await host.page.mouse.click(inv.x, inv.y);
    await host.page.waitForTimeout(500);
    notes.push('牌桌上点"叫朋友来"：不报错');
    // iPhone 带着"上次被杀"标记进来：省内存档（1 倍渲染）
    const iosScale = await clients[1]!.page.evaluate(() => window.__game!.renderScale);
    assert(iosScale === 1, `iPhone 上次被杀过，这次应该是省内存档 1 倍（实际 ${iosScale}）`);
    notes.push(`iPhone（上次被杀）进省内存档：渲染倍数 ${iosScale}`);

    // ③ 打完第一副（托管自动出；头游自动开下一副）
    for (const c of clients) await until(c, '第一副打完、开第二副', 'g.view()?.dealNo >= 2', 420_000);
    for (const [i, c] of clients.entries()) await shot(c, `53-online-deal2-${i}-${c.spec.name}`);
    notes.push(`一整副打完：${Math.round((Date.now() - t0) / 1000)} 秒`);

    // ④ 断线 10 秒回来：从平台大厅点进来那样打开（不带 ?online=1、不带房间码），标题页上点"回到房间"
    const and = clients[2]!;
    await and.page.close();
    await host.page.waitForTimeout(3000);
    const away = await netOf(host);
    assert(away?.seats[2]?.includes(':away'), `安卓断开后房主应看到他掉线（${JSON.stringify(away?.seats)}）`);
    await host.page.waitForTimeout(7000);
    const back = await openClient(browser, stack, and.spec, '', and.context, false);
    back.got = and.got;
    back.raw = and.raw;
    clients[2] = back;
    await until(back, '标题页有"回到房间"', "g.ready && g.scene === 'title' && !!g.controls()['back']");
    const rb = (await back.page.evaluate(() => window.__game!.controls()))['back']!;
    await back.page.mouse.click(rb.x, rb.y);
    await until(back, '10 秒后回来接着打', "g.scene === 'table' && g.net()?.seat === 2 && g.net()?.status === 'open'", 30_000);
    const step0 = await back.page.evaluate(() => window.__game!.view()!.step);
    await until(back, '回来后牌局往前走', `g.view()?.step > ${step0}`, 60_000);
    notes.push('断线 10 秒回来（不带 ?online=1，标题页点"回到房间"）：座位还在，牌局继续');

    // ⑤ 切后台 20 秒（iPad）：页面隐藏、冻结、断网——手机切后台时 JS 停住、连接多半被掐；回前台时恢复并发 visibilitychange
    const pad = clients[3]!;
    const setHidden = (hidden: boolean): Promise<void> =>
      pad.page.evaluate((h) => {
        const d = document as unknown as Record<string, unknown>;
        if (h) {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        } else {
          delete d['hidden'];
          delete d['visibilityState'];
        }
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    const cdp = await pad.context.newCDPSession(pad.page);
    await setHidden(true);
    await pad.context.setOffline(true);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    let sawAway = false;
    for (let i = 0; i < 10; i++) {
      await host.page.waitForTimeout(2000);
      if ((await netOf(host))?.seats[3]?.includes(':away')) sawAway = true;
    }
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await pad.context.setOffline(false);
    await setHidden(false);
    const hostStep = await host.page.evaluate(() => window.__game!.view()!.step);
    await until(pad, '切回前台后追上', `g.net()?.status === 'open' && g.view()?.step >= ${hostStep}`, 60_000);
    notes.push(`切后台 20 秒（隐藏 + 冻结 + 断网）再回来：续上了（期间房主${sawAway ? '看到他掉线，回来是重连接上的' : '没看到他掉线，连接挺过来了'}）`);

    // ⑥ 断线 70 秒：60 秒后电脑托管，回来交还
    if (!QUICK) {
      const ios = clients[1]!;
      await ios.page.close();
      await host.page.waitForTimeout(70_000);
      const auto = await netOf(host);
      assert(auto?.seats[1]?.includes(':auto'), `iPhone 断开 70 秒后应由电脑托管（${JSON.stringify(auto?.seats)}）`);
      await shot(host, '54-online-host-sees-auto');
      const ios2 = await openClient(browser, stack, ios.spec, `&room=${code}`, ios.context);
      ios2.got = ios.got;
      ios2.raw = ios.raw;
      clients[1] = ios2;
      await until(ios2, '70 秒后回来', "g.scene === 'table' && g.net()?.seat === 1 && g.net()?.status === 'open'", 30_000);
      await until(host, '托管交还', "!g.net()?.seats[1]?.includes(':auto') && !g.net()?.seats[1]?.includes(':away')", 15_000);
      notes.push('断线 70 秒：期间电脑托管，回来交还');
    }

    // ⑦ 同一个号在另一台设备进房：旧连接 4001 让位，提示说清楚
    const old = clients[0]!;
    const other = await openClient(browser, stack, { ...SPECS[0]!, name: '电脑（另一台）' }, `&room=${code}`);
    await until(other, '另一台设备接上', "g.scene === 'table' && g.net()?.seat === 0", 30_000);
    await until(old, '旧连接让位', 'g.net()?.closeCode === 4001', 15_000);
    const said = await old.page.evaluate(() => document.getElementById('net-banner')?.textContent ?? '');
    assert(said.includes('别的地方'), `旧设备上应该说清楚为什么断开（看到的是"${said}"）`);
    await shot(old, '55-online-replaced');
    notes.push(`同号另一台设备进房：旧连接 4001，旧设备上提示"${said}"`);
    clients[0] = other;

    // ⑦b 同一台设备换了账号：本机记着的是房主 u-desk 的房间，现在登录的是别人——标题页不给"回到房间"，记录清掉
    {
      const other = await openClient(
        browser,
        stack,
        { ...SPECS[0]!, name: '换了账号', user: 'u-switch', storage: { 'guandan.room': JSON.stringify({ code, host: true, at: Date.now(), userId: 'u-desk' }) } },
        '',
        undefined,
        false,
      );
      await until(other, '标题页', "g.ready && g.scene === 'title'");
      await other.page.waitForFunction(() => localStorage.getItem('guandan.room') === null, null, { timeout: 15_000 });
      const ctl = await other.page.evaluate(() => Object.keys(window.__game!.controls()));
      // "好友房"（online）一直有；"回到房间"（back）只给记下它的那个账号
      assert(ctl.includes('online') && !ctl.includes('back'), `换了账号还看到了上一个人的"回到房间"（${ctl.join(',')}）`);
      notes.push('同一台设备换了账号：看不到上一个人的"回到房间"，记录清掉了');
      await other.context.close();
    }

    // ⑧ 隐藏信息：按步拼出真相，逐份视图比对
    const { compared, withTribute } = checkLeaks(clients.concat([old]));
    assert(compared > 100, `比对的视图太少（${compared}）`);
    notes.push(`隐藏信息：按步拼出真相比对 ${compared} 份视图（带贡牌的 ${withTribute} 份），没有看到别人手里的牌，贡牌、还贡牌按规则给；下行里没有 seed、hands、key`);
    const msgs = clients.map((c) => `${c.spec.name} ${c.raw.length} 条`).join('，');
    notes.push(`下行消息数：${msgs}`);

    // ⑨ 电脑的互动（0.7.1）：另一个号开房、一个人开局（空位电脑补），冲三个电脑各扔一个番茄；
    // 电脑按性格回怼、装没看见或认怂，三个都不理的概率约 4%，加上打牌时炸弹、头游的显摆，等 90 秒总该有一条
    const solo = await openClient(browser, stack, { ...SPECS[0]!, name: '电脑房', user: 'u-bots' }, '');
    await until(solo, '标题页', "g.ready && g.scene === 'title'");
    const op = (await solo.page.evaluate(() => window.__game!.controls()))['online']!;
    await solo.page.mouse.click(op.x, op.y);
    await solo.page.click('#ol-create');
    await until(solo, '房主坐下', 'g.net()?.seat === 0');
    await solo.page.click('#ol-start');
    await until(solo, '进牌桌', "g.scene === 'table' && g.view()?.dealNo >= 1", 30_000);
    for (const v of [3, 1, 2]) {
      const a = (await solo.page.evaluate((k) => window.__game!.controls()[`fun:seat${k}`], v))!;
      await solo.page.mouse.click(a.x, a.y);
      await until(solo, '头像菜单', "!!g.controls()['fun:prop0']");
      const t = (await solo.page.evaluate(() => window.__game!.controls()))['fun:prop0']!;
      await solo.page.mouse.click(t.x, t.y);
      await until(solo, `扔给 ${v} 号`, `g.fxLog.includes('道具 0>${v}:tomato')`, 10_000);
      await solo.page.waitForTimeout(1500);
    }
    await until(solo, '电脑说了一句', "g.fxLog.some((l) => /^(短语|电脑|表情) [123]:|^道具 [123]>/.test(l))", 90_000);
    await solo.page.waitForTimeout(600);
    await shot(solo, '59-online-bot-fun');
    const botFun = await solo.page.evaluate(() => window.__game!.fxLog.filter((l) => /^(短语|电脑|表情) [123]:|^道具 [123]>/.test(l)));
    notes.push(`好友房电脑互动：冲三个电脑扔番茄，电脑这边 ${botFun.length} 条（${botFun.slice(0, 4).join('、')}）`);
    await solo.context.close();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    // 失败现场：每个客户端截一张图、记下联机状态和大厅里的提示
    for (const [i, c] of clients.entries()) {
      if (c.page.isClosed()) continue;
      const info = await c.page
        .evaluate(() => ({ net: window.__game?.net() ?? null, scene: window.__game?.scene ?? null, lobby: document.querySelector('#online')?.textContent?.slice(0, 200) ?? null }))
        .catch(() => null);
      notes.push(`失败现场 ${c.spec.name}：${JSON.stringify(info)}`);
      const tail = c.raw.slice(-4).map((t) => {
        const m = JSON.parse(t) as { t: string; seq?: number; code?: string; ack?: string; room?: { turn: unknown }; frames?: { view: NetView | null }[] };
        const v = m.frames?.at(-1)?.view?.view;
        return { t: m.t, seq: m.seq, code: m.code, ack: m.ack, turn: m.room?.turn, phase: v?.phase, vturn: v?.turn, step: v?.step, frames: m.frames?.length };
      });
      notes.push(`  最后几条下行：${JSON.stringify(tail)}，此刻 ${Date.now()}`);
      await c.page.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => undefined);
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
  for (const n of notes) console.log(`· ${n}`);
  console.log(`截图 → ${OUT}`);
  if (errors.length) {
    console.log(`失败 ${errors.length} 项：`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    process.exitCode = 1;
  } else console.log('联机冒烟通过：四个客户端控制台零报错');
}

await main();
