/**
 * 无头浏览器冒烟 + 截图：账号界面的主流程和各种出错提示（docs/platform-backend.md 5.2、5.7），
 * 0.5.0 起加上邀请制：注册关着、管理员建号、管理命令行工具（tools/admin.ts）。
 *
 *   npm run smoke                 先构建，再跑；截图放 shots/（不进 Git）
 *   node tools/smoke.ts --out <目录>
 *
 * 用临时目录里的本地 D1 起 wrangler dev（127.0.0.1:5181，平台登记的接口端口），界面和接口同源，和线上一样；
 * 静态资源的 public/_headers（CSP 等）wrangler dev 也会加上（0.4.1 实测），所以页面是在正式的 CSP 下跑的。
 * Secret 用命令行传的假值，不读也不改 .dev.vars。REGISTRATION 不传，用 wrangler.jsonc 里的默认值（switch，D1 里没设过按关），顺带验证默认是关着的。
 *
 * 失败条件，任何一条都以非零码退出：
 * - 页面报错、控制台 error（"Failed to load resource" 除外，它们按下面的 HTTP 检查算）、CSP 拦下了任何东西；
 * - 没有事先声明的 4xx/5xx 响应；
 * - 断言不成立。
 * 服务端不好造的情况（只读档、停服、429、断网、网关出错页）用 page.route 在浏览器里模拟。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Dialog, type Locator, type Page, type Route } from 'playwright-core';
// 大厅登记的游戏（和 test/ 一样以 src/games.ts 为准）：按游戏 mock 的地方照它来，新登记的游戏不会漏
import { GAMES } from '../src/games.ts';

const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1]! : 'shots');

const problems: string[] = [];
/** 事先声明会出现的错误响应（状态码 + 路径），出现一次划掉一个。 */
const expected: { status: number; path: string }[] = [];
let shotNo = 0;

function fail(msg: string): never {
  throw new Error(msg);
}

function check(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function expectHttp(status: number, path: string): void {
  expected.push({ status, path });
}

/** 盯住一个页面：报错、控制台、CSP 拦截、错误响应。 */
async function watch(page: Page, label: string): Promise<Page> {
  page.on('pageerror', (e) => problems.push(`[${label}] 页面报错：${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().startsWith('Failed to load resource')) return;
    problems.push(`[${label}] 控制台：${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const path = new URL(r.url()).pathname;
    const i = expected.findIndex((e) => e.status === r.status() && e.path === path);
    if (i >= 0) expected.splice(i, 1);
    else problems.push(`[${label}] 没想到的 ${r.status()}：${path}`);
  });
  // CSP 拦下的东西有时只是一条 warning：直接听 securitypolicyviolation 事件，换页后也照样报
  await page.exposeBinding('__cspViolation', (_src, what: string) => problems.push(`[${label}] CSP 拦下了：${what}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolation: (s: string) => void }).__cspViolation(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return page;
}

/** 记下这个页面发过的 /api 请求。 */
function apiCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) calls.push(`${r.method()} ${u.pathname}`);
  });
  return calls;
}

async function shot(page: Page, name: string): Promise<void> {
  shotNo += 1;
  const file = join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  截图 ${file}`);
}

type Screen = 'desktop' | 'portrait' | 'landscape';

async function newPage(browser: Browser, label: string, screen: Screen = 'desktop', extra: BrowserContextOptions = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const opts: Record<Screen, BrowserContextOptions> = {
    desktop: { viewport: { width: 1280, height: 800 } },
    portrait: { viewport: { width: 390, height: 844 }, ...phone },
    landscape: { viewport: { width: 844, height: 390 }, ...phone },
  };
  const ctx = await browser.newContext({ ...opts[screen], ...extra });
  return { ctx, page: await watch(await ctx.newPage(), label) };
}

const fold = (page: Page, title: string) => page.locator('details', { has: page.locator(`summary:text-is("${title}")`) });

async function openFold(page: Page, title: string) {
  const d = fold(page, title);
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
  return d;
}

/** 下一个弹窗（confirm、beforeunload）点"取消"，返回它的类型；5 秒内没弹出来返回 'none'（让断言失败，而不是一直等）。 */
function dismissNextDialog(page: Page): Promise<string> {
  return new Promise((ok) => {
    const onDialog = (d: Dialog) => {
      clearTimeout(timer);
      ok(d.type());
      void d.dismiss();
    };
    const timer = setTimeout(() => {
      page.off('dialog', onDialog);
      ok('none');
    }, 5_000);
    page.once('dialog', onDialog);
  });
}

/** 装作登录着：写上登录提示 cookie（addCookies 不收 __Host- 前缀，localhost 是安全上下文，页面里能写）。 */
async function fakeLoginHint(page: Page): Promise<void> {
  await page.goto(`${BASE}/privacy`);
  await page.evaluate(() => {
    document.cookie = '__Host-arcade_li=1; Path=/; Secure; SameSite=Lax';
  });
}

const FAKE_USER = { id: 'x', username: 'someone', displayName: '某人', friendCode: 'ABCD2345', createdAt: Date.UTC(2026, 9, 1) };
const FAKE_ADMIN = { ...FAKE_USER, id: 'a', username: 'owner', displayName: '阿国', isAdmin: true };
/** 模拟登录的页面也要模拟钱包：不然真的 /api/wallet 回 401，页面会当成会话失效、退回没登录 */
const FAKE_WALLET = {
  wallet: { balance: 10_000, stakes: [], canRelief: false, writesLeft: 200, caps: {}, fresh: true },
  tiers: { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 },
  reliefTo: 2_000,
};
/** 只给冒烟用的假令牌（wrangler dev 用 --var 传进去）。 */
const ADMIN_TOKEN = 'smoke:smoke-only-admin-token-0000';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * 装作某人登录着：/api/me、/api/wallet 都用假的，再写上登录提示 cookie。
 * me 里的字段盖掉 /api/me 默认的几项（写 undefined 就是不带这一项）；wallet 是函数时每次请求现算，用来模拟领完补给这类前后变化。
 */
async function mockSession(
  page: Page,
  { user = FAKE_USER, me = {}, wallet = FAKE_WALLET }: { user?: object; me?: Record<string, unknown>; wallet?: object | (() => object) } = {},
): Promise<void> {
  await page.route('**/api/me', (r) => r.fulfill(json({ user, service: 'ok', saves: 'ok', registration: 'closed', ...me })));
  await page.route('**/api/wallet', (r) => r.fulfill(json(typeof wallet === 'function' ? wallet() : wallet)));
  await fakeLoginHint(page);
}

// ---------- 起本地接口 ----------

function startServer(state: string): ChildProcess {
  const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'arcade', '--local', '--persist-to', state], {
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  if (migrate.status !== 0) fail(`迁移失败：\n${migrate.stdout}\n${migrate.stderr}`);
  // 管理页的筹码统计表要有一行才画得出来：本地库里先放一天的（冒烟里不跑 Cron）
  const day = { day: '2026-10-14', total: 1_234_567, wallets: 3, grant: 30_000, relief: 2_000, games: { kaipan: { in: 4_000, out: 6_000, back: 0, capped: 500 } } };
  const seed = spawnSync('npx', ['wrangler', 'd1', 'execute', 'arcade', '--local', '--persist-to', state, '--command',
    `INSERT INTO wallet_stats (day, data, created_at) VALUES ('${day.day}', '${JSON.stringify(day)}', 0)`], {
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  if (seed.status !== 0) fail(`放统计行失败：\n${seed.stdout}\n${seed.stderr}`);
  const fake = (k: string) => ['--var', `${k}:smoke:smoke-only-pepper-${k.toLowerCase()}-0000`];
  const args = [
    'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--local-upstream', `localhost:${PORT}`,
    '--persist-to', state, '--show-interactive-dev-session=false',
    '--var', `SITE_ORIGIN:${BASE}`,
    ...fake('PEPPER_PW'), ...fake('PEPPER_RC'), ...fake('PEPPER_SID'), ...fake('PEPPER_IP'),
    '--var', `ADMIN_TOKEN:${ADMIN_TOKEN}`,
  ];
  // 单独一个进程组，结束时整组杀掉（npx 下面还有 wrangler 和 workerd）
  return spawn('npx', args, { detached: true, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
}

/** 5181 已经有人在用（比如开着 npm run dev:api，或者上次没收干净）：直接失败，免得连到别的服务上测了个寂寞。 */
async function ensurePortFree(): Promise<void> {
  try {
    await fetch(`${BASE}/`);
  } catch {
    return;
  }
  fail(`${PORT} 端口已经有服务在跑，先停掉它（npm run dev:api 或上次残留的 wrangler dev）`);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/me`);
      if (r.status === 200) return;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail('wrangler dev 60 秒内没起来');
}

// ---------- 场景 ----------

const STAMP = Date.now().toString(36);
/** 管理员（管理命令行工具建）、朋友（管理员在界面上建，密码自动生成）、给管理员删的号。用户名最长 20 位。 */
const ADMIN = `owner_${STAMP}`;
const NAME = `smoke_${STAMP}`;
const NAME2 = `smoke2_${STAMP}`;
const PW2 = 'Smoke-Test-Pass-2';
const PW3 = 'Smoke-Test-Pass-3';
const READABLE = /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/;

async function breathe(page: Page, seconds: number): Promise<void> {
  console.log(`  （等 ${seconds} 秒，让匿名接口的令牌回满）`);
  await page.waitForTimeout(seconds * 1000);
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.locator('.account__name').waitFor();
}

/** 跑一次管理命令行工具（和维护者用的是同一个脚本），接口指向本地。 */
function adminCli(args: string[], token = ADMIN_TOKEN): { code: number; out: string } {
  const r = spawnSync(process.execPath, ['tools/admin.ts', ...args, `--base=${BASE}`], {
    encoding: 'utf8',
    env: { ...process.env, ARCADE_ADMIN_TOKEN: token },
  });
  const out = `${r.stdout}${r.stderr}`;
  check(!out.includes(token), '建号工具不该把令牌打印出来');
  return { code: r.status ?? -1, out };
}

const field = (out: string, name: string): string => new RegExp(`^${name}：(.+)$`, 'm').exec(out)?.[1]?.trim() ?? fail(`输出里没有"${name}"：\n${out}`);

async function anonymous(browser: Browser): Promise<void> {
  console.log('没登录：首页一个 /api 请求都不发，游戏卡片是"登录后才能玩"；各页面带 CSP');
  const { ctx, page } = await newPage(browser, '没登录');
  const calls = apiCalls(page);
  const res = await page.goto(`${BASE}/`);
  const csp = res?.headers()['content-security-policy'] ?? '';
  for (const part of ["script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) {
    check(csp.includes(part), `首页的 CSP 缺 ${part}：${csp || '（没有 CSP 头）'}`);
  }
  await page.getByRole('heading', { name: '开盘' }).waitFor();
  const play = page.locator('.card', { hasText: '开盘' }).getByRole('link', { name: '登录后才能玩' });
  check((await play.getAttribute('href')) === '/login?from=kaipan', '"登录后才能玩"应该去 /login?from=kaipan');
  check((await page.getByRole('link', { name: '进入游戏' }).count()) === 0, '没登录时不该有"进入游戏"');
  check((await page.locator('.account').textContent()) === '登录', '没登录时右上角是"登录"');
  check((await page.getByRole('link', { name: '管理' }).count()) === 0, '没登录时不该有"管理"');
  check(calls.length === 0, `没登录时首页不该调接口：${calls.join(', ')}`);
  await shot(page, 'home-anon');
  for (const path of ['/me', '/forgot', '/privacy']) {
    const r = await page.goto(`${BASE}${path}`);
    // 单页回退的地址也要带 CSP
    check((r?.headers()['content-security-policy'] ?? '').includes("script-src 'self'"), `${path} 没有 CSP 头`);
  }

  console.log('注册关着（wrangler.jsonc 默认）：登录页只有登录，没有"注册"两个字；直接调注册接口 403');
  await page.goto(`${BASE}/`);
  await Promise.all([page.waitForResponse(`${BASE}/api/me`), play.click()]);
  await page.getByText('现在只对受邀的朋友开放，账号找邀请你的人要').waitFor();
  await page.getByText('登录后回到「开盘」').waitFor();
  check(new URL(page.url()).search === '?from=kaipan', `点"登录后才能玩"应该带上 from：${page.url()}`);
  check((await page.getByText('注册').count()) === 0, '注册关着时登录页不该出现"注册"');
  await shot(page, 'login-invite');
  await Promise.all([page.waitForResponse(`${BASE}/api/me`), page.goto(`${BASE}/login?tab=register`)]);
  await page.getByText('现在只对受邀的朋友开放').waitFor();
  check((await page.getByRole('heading', { name: '注册' }).count()) === 0, '注册关着时 ?tab=register 也不该出现注册表单');
  expectHttp(403, '/api/auth/register');
  const reg = await page.evaluate(async () => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'x-arcade': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody_here', password: 'Whatever-Pass-1', displayName: '路人' }),
    });
    return [r.status, ((await r.json()) as { error: string }).error] as const;
  });
  check(reg[0] === 403 && reg[1] === 'registration_closed', `注册关着时接口应该回 403 registration_closed：${reg.join(' ')}`);

  console.log('没登录打开好友链接：叫人先登录，登录后回到这个链接');
  await page.goto(`${BASE}/f/ABCD2345`);
  await page.getByText('登录后才能加好友').waitFor();
  check((await page.getByRole('link', { name: '去登录' }).getAttribute('href')) === '/login?from=f%2FABCD2345', '好友链接的"去登录"应该带上 from');
  await Promise.all([page.waitForResponse(`${BASE}/api/me`), page.getByRole('link', { name: '去登录' }).click()]);
  await page.getByText('登录后回到刚才那一页').waitFor();

  console.log('没登录进 /admin：回首页');
  await page.goto(`${BASE}/admin`);
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('heading', { name: '开盘' }).waitFor();
  check(calls.every((c) => c === 'GET /api/me' || c === 'POST /api/auth/register'), `没登录时只该问 /api/me：${calls.join(', ')}`);
  await ctx.close();
}

/** 管理命令行工具：返回建好、又重设过一次的管理员密码。 */
function cli(): string {
  console.log('管理命令行工具：令牌不对 401；用对的令牌建管理员、列出账号；不打印令牌');
  const wrong = adminCli(['list'], 'smoke:wrong-token-0000000000');
  check(wrong.code === 1 && wrong.out.includes('401'), `令牌不对时应该 401 退出：\n${wrong.out}`);
  const made = adminCli(['create', ADMIN, '冒烟阿国', '--admin']);
  check(made.code === 0, `建管理员失败：\n${made.out}`);
  check(made.out.includes('（管理员）'), `建出来的应该是管理员：\n${made.out}`);
  const pw = field(made.out, '密码');
  check(READABLE.test(pw), `生成的密码不像"3 个词 + 2 位数字"：${pw}`);
  check(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}/.test(field(made.out, '恢复码')), '建号工具没给恢复码');
  check(field(made.out, '游戏地址') === BASE, '发给对方的话里游戏地址不对');
  const list = adminCli(['list']);
  check(list.code === 0 && new RegExp(`${ADMIN}\\t冒烟阿国\\t管理员`).test(list.out), `list 里没有刚建的管理员：\n${list.out}`);
  const bad = adminCli(['create', 'x']);
  check(bad.code === 1 && bad.out.includes('用法'), '参数不对时应该给用法');
  // 令牌里混了换行：先挡住，不发请求，报错里也不带原文（adminCli 会查输出里有没有令牌）
  const newline = adminCli(['list'], 'smoke:secret-part-one\nsecret-part-two');
  check(newline.code === 1 && newline.out.includes('令牌格式不对') && !newline.out.includes('secret-part'), `令牌格式不对时应该拒绝且不回显：\n${newline.out}`);
  // 不是 https 也不是本机：不把令牌明文发出去
  const plain = spawnSync(process.execPath, ['tools/admin.ts', 'list', '--base=http://example.com'], {
    encoding: 'utf8',
    env: { ...process.env, ARCADE_ADMIN_TOKEN: ADMIN_TOKEN },
  });
  check(plain.status === 1 && plain.stderr.includes('只能是 https'), `--base 是外站 http 时应该拒绝：\n${plain.stderr}`);
  // 没给站点地址：不猜默认地址，直接报错
  const { ARCADE_BASE_URL: _unused, ...noBase } = process.env;
  const missing = spawnSync(process.execPath, ['tools/admin.ts', 'list'], { encoding: 'utf8', env: { ...noBase, ARCADE_ADMIN_TOKEN: ADMIN_TOKEN } });
  check(missing.status === 1 && missing.stderr.includes('不知道站点地址'), `没给 --base 也没设 ARCADE_BASE_URL 时应该报错：\n${missing.stderr}`);
  // 用户名按 NFKC 找：全角也认
  const fullwidth = adminCli(['reset', ADMIN.replace('o', 'Ｏ')]);
  check(fullwidth.code === 0 && fullwidth.out.includes('重设好了'), `全角用户名应该也能找到：\n${fullwidth.out}`);
  const pw2 = field(fullwidth.out, '密码');
  check(READABLE.test(pw2) && pw2 !== pw, '重设后应该是新生成的密码');
  return pw2;
}

/** 管理页（0.11.0 起分区）：点左边（窄屏是顶上）的分区导航，等那一区出来 */
async function adminSection(page: Page, label: '概览' | '用户' | '钱包统计' | '设置'): Promise<void> {
  const id = { 概览: 'overview', 用户: 'users', 钱包统计: 'stats', 设置: 'settings' }[label];
  await page.locator('.console__nav').getByRole('link', { name: label }).click();
  await page.getByTestId(`admin-${id}`).waitFor();
}

/** 管理页·用户：点列表里的一个人，等右边（窄屏是进去的）详情出来，返回详情 */
async function pickUser(page: Page, username: string): Promise<Locator> {
  await page.getByTestId(`user-${username}`).click();
  const detail = page.getByTestId(`detail-${username}`);
  await detail.waitFor();
  return detail;
}

async function adminFlow(browser: Browser, adminPw: string): Promise<void> {
  const admin = await newPage(browser, '管理员', 'desktop', { permissions: ['clipboard-read', 'clipboard-write'] });
  const page = admin.page;
  await login(page, ADMIN, adminPw);

  console.log('管理员：右上角有"管理"；建号时弱密码 422，留空自动生成');
  await page.getByRole('link', { name: '管理' }).click();
  await page.getByTestId('admin-overview').waitFor();
  await adminSection(page, '钱包统计');

  console.log('管理页的筹码统计表；钱包：新号看到 10,000、还没建行，余额够时领补给 409，浏览器没有带入的路');
  const stats = page.getByTestId('wallet-stats');
  await stats.getByText('10-14').waitFor();
  await stats.getByText('1,234,567').waitFor();
  await stats.locator('.per-game li', { hasText: '开盘 带入 4,000 · 结回 6,000 · 退回 0' }).waitFor();
  expectHttp(409, '/api/wallet/relief');
  expectHttp(404, '/api/wallet/buyin');
  const wallet = await page.evaluate(async () => {
    const post = (path: string) => fetch(path, { method: 'POST', headers: { 'x-arcade': '1', 'content-type': 'application/json' }, body: '{}' });
    const r = await fetch('/api/wallet');
    const relief = await post('/api/wallet/relief');
    const buy = await post('/api/wallet/buyin');
    return {
      status: r.status,
      body: (await r.json()) as { wallet: { balance: number; fresh: boolean } },
      relief: [relief.status, ((await relief.json()) as { error: string }).error],
      buy: buy.status,
    };
  });
  check(wallet.status === 200 && wallet.body.wallet.balance === 10_000 && wallet.body.wallet.fresh, `新号的钱包不对：${JSON.stringify(wallet)}`);
  check(wallet.relief[0] === 409 && wallet.relief[1] === 'relief_not_needed', `余额够时领补给应该 409：${JSON.stringify(wallet.relief)}`);
  check(wallet.buy === 404, `浏览器不该有带入的路：${wallet.buy}`);
  await shot(page, 'admin-wallet-stats');

  console.log('管理员开关注册：默认关着；点了先确认，取消不改；打开后 /api/me 马上是 open，再关回去');
  await adminSection(page, '设置');
  const sw = page.getByTestId('registration-switch');
  await sw.getByText('现在：只邀请').waitFor();
  await sw.getByText('还没改过（默认关着）').waitFor();
  const regOf = () => page.evaluate(async () => ((await (await fetch('/api/me')).json()) as { registration: string }).registration);
  const asked = dismissNextDialog(page);
  await sw.getByRole('button', { name: '打开注册' }).click();
  check((await asked) === 'confirm', '打开注册前应该先确认一次');
  check((await regOf()) === 'closed', '取消了确认，注册不该被打开');
  page.once('dialog', (d) => void d.accept());
  await sw.getByRole('button', { name: '打开注册' }).click();
  await sw.getByText('现在：开放注册').waitFor();
  await sw.getByText(/^上次改动：/).waitFor();
  check((await regOf()) === 'open', '打开注册后 /api/me 应该马上是 open');
  await shot(page, 'admin-registration-open');
  page.once('dialog', (d) => void d.accept());
  await sw.getByRole('button', { name: '关闭注册' }).click();
  await sw.getByText('现在：只邀请').waitFor();
  check((await regOf()) === 'closed', '关闭注册后 /api/me 应该马上是 closed');
  await adminSection(page, '用户');
  await (await pickUser(page, ADMIN)).getByText('你自己的密码去"我的账号"改').waitFor();
  await page.getByTestId('new-user').click();
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('昵称').fill('冒烟小王');
  await page.getByLabel('密码').fill('password1');
  expectHttp(422, '/api/admin/users');
  await page.getByRole('button', { name: '建号', exact: true }).click();
  await page.getByText('密码太简单了').waitFor();
  await page.getByLabel('密码').fill('');
  await page.getByRole('button', { name: '建号', exact: true }).click();
  await page.getByRole('heading', { name: '账号建好了' }).waitFor();
  const pw1 = (await page.getByTestId('cred-password').textContent())!.trim();
  const rc1 = (await page.getByTestId('cred-recovery').textContent())!.trim();
  check(READABLE.test(pw1), `生成的密码不像"3 个词 + 2 位数字"：${pw1}`);
  check((await page.getByTestId('cred-username').textContent()) === NAME, '卡片上的用户名不对');
  const done = page.getByRole('button', { name: '好了' });
  check(await done.isDisabled(), '没勾"已经发给对方了"之前不能关卡片');
  await page.getByRole('button', { name: '复制成一段话' }).click();
  await page.getByRole('button', { name: '已复制' }).waitFor();
  const msg = await page.evaluate(() => navigator.clipboard.readText());
  for (const line of [`游戏地址：${BASE}`, `用户名：${NAME}`, `密码：${pw1}`, `恢复码：${rc1}`, '登录后可以在"我的账号"改密码', '恢复码是聊天发给你的，登录后可以在"我的账号"换一个新的']) {
    check(msg.includes(line), `复制的那段话里缺"${line}"：\n${msg}`);
  }
  await shot(page, 'admin-created');
  // 离开提醒：点右上角、后退都先问；点"取消"留在原地
  let kind = dismissNextDialog(page);
  await page.locator('.account', { hasText: '冒烟阿国' }).click();
  check((await kind) === 'confirm', '密码卡片没勾之前点别的链接应该先确认');
  kind = dismissNextDialog(page);
  await page.goBack();
  check((await kind) === 'confirm', '密码卡片没勾之前后退应该先确认');
  await page.getByTestId('cred-password').waitFor();
  await page.getByLabel('已经发给对方了').check();
  await done.click();
  await page.getByTestId(`user-${NAME}`).waitFor();

  console.log('重名 409；给了密码时卡片上显示的就是那个密码');
  await page.getByTestId('new-user').click();
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('昵称').fill('撞名的人');
  expectHttp(409, '/api/admin/users');
  await page.getByRole('button', { name: '建号', exact: true }).click();
  await page.getByText('这个用户名已经有人用了').waitFor();
  await page.getByLabel('用户名').fill(NAME2);
  await page.getByLabel('昵称').fill('要删的号');
  await page.getByLabel('密码').fill(PW3);
  await page.getByRole('button', { name: '建号', exact: true }).click();
  await page.getByRole('heading', { name: '账号建好了' }).waitFor();
  check((await page.getByTestId('cred-password').textContent()) === PW3, '给了密码时卡片上应该是那个密码');
  await page.getByLabel('已经发给对方了').check();
  await done.click();
  await page.getByTestId(`user-${NAME2}`).waitFor();
  await shot(page, 'admin-list');

  console.log('朋友用管理员给的密码登录：首页能进游戏；没有"管理"；进不了 /admin');
  const friend = await newPage(browser, '朋友', 'desktop', { permissions: ['clipboard-read', 'clipboard-write'] });
  await login(friend.page, NAME, pw1);
  const enter = friend.page.locator('.card', { hasText: '开盘' }).getByRole('link', { name: '进入游戏' });
  check((await enter.getAttribute('href')) === '/games/kaipan/', '登录后"进入游戏"应该指向 /games/kaipan/');
  check((await friend.page.getByRole('link', { name: '管理' }).count()) === 0, '普通用户不该看到"管理"');
  await shot(friend.page, 'friend-home');
  console.log('登录后掼蛋卡片有"好友房"：指向 /games/guandan/?online=1，点了就去；开盘卡片没有');
  const online = friend.page.locator('.card', { hasText: '掼蛋' }).getByRole('link', { name: '好友房' });
  check((await online.getAttribute('href')) === '/games/guandan/?online=1', '"好友房"应该指向 /games/guandan/?online=1');
  check((await friend.page.locator('.card', { hasText: '开盘' }).getByRole('link', { name: '好友房' }).count()) === 0, '开盘不该有"好友房"');
  console.log('德州扑克的卡片：进入游戏、好友房（?online=1）；三张封面都画得出来');
  const texas = friend.page.locator('.card', { hasText: '德州扑克' });
  check((await texas.getByRole('link', { name: '进入游戏' }).getAttribute('href')) === '/games/texas/', '德州"进入游戏"应该指向 /games/texas/');
  check((await texas.getByRole('link', { name: '好友房' }).getAttribute('href')) === '/games/texas/?online=1', '德州"好友房"应该指向 /games/texas/?online=1');
  // 麻将的好友房（0.10.16）
  const mahjong = friend.page.locator('.card', { hasText: '雀馆' }).getByRole('link', { name: '好友房' });
  check((await mahjong.getAttribute('href')) === '/games/mahjong/?online=1', '麻将"好友房"应该指向 /games/mahjong/?online=1');
  // 《飞驰》（0.10.24 起能玩）：进入游戏、好友房（?online=1）
  const racing = friend.page.locator('.card', { hasText: '飞驰' });
  check((await racing.getByRole('link', { name: '进入游戏' }).getAttribute('href')) === '/games/racing/', '飞驰"进入游戏"应该指向 /games/racing/');
  check((await racing.getByRole('link', { name: '好友房' }).getAttribute('href')) === '/games/racing/?online=1', '飞驰"好友房"应该指向 /games/racing/?online=1');
  for (const img of await friend.page.locator('.card__cover').all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el: HTMLImageElement) => el.decode());
    const w = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    check(w >= 800, `封面没画出来：${await img.getAttribute('src')}，宽 ${w}`);
  }
  await texas.scrollIntoViewIfNeeded();
  await shot(friend.page, 'home-texas');
  await friend.page.evaluate(() => window.scrollTo(0, 0));
  // 本地没有掼蛋的 Worker，平台对 /games/* 回 404，这里只看跳到了哪
  expectHttp(404, '/games/guandan/');
  await Promise.all([friend.page.waitForURL(`${BASE}/games/guandan/?online=1`), online.click()]);
  await friend.page.goto(`${BASE}/`);
  await friend.page.locator('.card', { hasText: '掼蛋' }).getByRole('link', { name: '好友房' }).waitFor();
  await friend.page.goto(`${BASE}/admin`);
  await friend.page.waitForURL(`${BASE}/`);
  check((await friend.page.getByRole('heading', { name: '给朋友建个账号' }).count()) === 0, '普通用户进不了管理界面');

  console.log('管理员重设朋友的密码（顺便换恢复码）：朋友那边会话失效，旧密码登不上，新密码能登');
  const row = await pickUser(page, NAME);
  await row.getByRole('button', { name: '重设密码' }).click();
  await row.getByLabel('恢复码也换一个').check();
  await shot(page, 'admin-reset-form');
  await row.locator('form').getByRole('button', { name: '重设密码' }).click();
  await page.getByRole('heading', { name: '密码重设好了' }).waitFor();
  const pw2 = (await page.getByTestId('cred-password').textContent())!.trim();
  const rc2 = (await page.getByTestId('cred-recovery').textContent())!.trim();
  check(READABLE.test(pw2) && pw2 !== pw1 && rc2 !== rc1, '重设后应该是新的密码和恢复码');
  await shot(page, 'admin-reset-card');
  await page.getByLabel('已经发给对方了').check();
  await done.click();
  await friend.page.goto(`${BASE}/me`);
  await friend.page.getByRole('link', { name: '去登录' }).waitFor();
  await friend.page.goto(`${BASE}/login`);
  await friend.page.getByLabel('用户名').fill(NAME);
  await friend.page.getByLabel('密码').fill(pw1);
  expectHttp(401, '/api/auth/login');
  await friend.page.getByRole('button', { name: '登录' }).click();
  await friend.page.getByText('用户名或密码不对').waitFor();
  await friend.page.getByLabel('密码').fill(pw2);
  await friend.page.getByRole('button', { name: '登录' }).click();
  await friend.page.locator('.account__name', { hasText: '冒烟小王' }).waitFor();

  console.log('管理员删号：要先勾确认；删完列表里没了');
  const row2 = await pickUser(page, NAME2);
  await row2.getByRole('button', { name: '删号' }).click();
  const del = row2.locator('form').getByRole('button', { name: '删号' });
  check(await del.isDisabled(), '没勾确认之前不能删号');
  await row2.getByLabel(/确定删掉「要删的号」/).check();
  await shot(page, 'admin-delete');
  await del.click();
  await page.getByText(`已经删掉「要删的号」（${NAME2}）`).waitFor();
  // 提示先出来，列表随后重读：等这一行消失（5 秒内不消失就算失败）
  await page.getByTestId(`user-${NAME2}`).waitFor({ state: 'detached', timeout: 5_000 });

  await friendsFlow(page, friend.page);
  await admin.ctx.close();

  await friendFlow(browser, friend.ctx, friend.page, pw2, rc2);
}

/** 好友：管理员（a）和朋友（b）互加、屏蔽、解除、拒绝、换好友码。 */
async function friendsFlow(a: Page, b: Page): Promise<void> {
  console.log('好友：朋友的好友页有好友码和链接，复制链接');
  await b.getByRole('link', { name: '好友', exact: true }).click();
  await b.getByRole('heading', { name: '我的好友码' }).waitFor();
  const code = (await b.getByTestId('my-friend-code').textContent())!.trim();
  const link = (await b.getByTestId('my-friend-link').textContent())!.trim();
  check(link === `${BASE}/f/${code}`, `分享链接不对：${link}`);
  // 0.10.5 起电脑上（没有系统分享）是一个大按钮"复制我的好友链接"
  await b.getByTestId('share-link').click();
  await b.getByTestId('share-link').getByText('已复制，发给朋友吧').waitFor();
  check((await b.evaluate(() => navigator.clipboard.readText())) === link, '复制的不是好友链接');
  await b.getByText('还没有好友').waitFor();
  await shot(b, 'friends-empty');

  console.log('管理员打开好友链接：看到昵称（没有用户名），点"加好友"');
  await a.goto(link);
  await a.getByText('冒烟小王').waitFor();
  check((await a.getByText(NAME).count()) === 0, '好友链接页不该显示对方的用户名');
  await a.getByRole('button', { name: '加好友' }).click();
  await a.getByText('已发送，等对方接受').waitFor();
  await shot(a, 'friend-link-sent');

  console.log('朋友接受：两边都在好友列表里，"今天来过"');
  await b.reload();
  const req = b.getByTestId('person-冒烟阿国');
  await req.getByText('想加你为好友').waitFor();
  await shot(b, 'friends-incoming');
  await req.getByRole('button', { name: '接受' }).click();
  await b.getByRole('heading', { name: '好友（1）' }).waitFor();
  await b.getByTestId('person-冒烟阿国').getByText('今天来过').waitFor();
  await a.getByRole('link', { name: '好友', exact: true }).click();
  await a.getByTestId('person-冒烟小王').getByText('今天来过').waitFor();
  await shot(a, 'friends-list');

  console.log('朋友屏蔽管理员：要先勾确认；好友没了，屏蔽的人里有');
  const row = b.getByTestId('person-冒烟阿国');
  await row.getByRole('button', { name: '屏蔽' }).click();
  const blockBtn = row.locator('.people__confirm').getByRole('button', { name: '屏蔽' });
  check(await blockBtn.isDisabled(), '没勾确认之前不能屏蔽');
  await row.getByLabel(/确定屏蔽「冒烟阿国」/).check();
  await shot(b, 'friends-block-confirm');
  await blockBtn.click();
  await b.getByRole('heading', { name: '好友（0）' }).waitFor();
  await b.getByRole('heading', { name: '屏蔽的人（1）' }).waitFor();
  await shot(b, 'friends-blocked');

  console.log('被屏蔽的管理员看不出来：再打开链接照常能发，显示"已发送"；朋友那边收不到');
  await a.goto(link);
  await a.getByRole('button', { name: '加好友' }).click();
  await a.getByText('已发送，等对方接受').waitFor();
  await b.reload();
  await b.getByRole('heading', { name: '屏蔽的人（1）' }).waitFor();
  check((await b.getByRole('heading', { name: /想加你的人/ }).count()) === 0, '屏蔽的人发来的请求不该显示');

  console.log('解除屏蔽后请求重新出现；拒绝');
  await b.getByTestId('person-冒烟阿国').getByRole('button', { name: '解除屏蔽' }).click();
  await b.getByRole('heading', { name: '想加你的人（1）' }).waitFor();
  await b.getByTestId('person-冒烟阿国').getByRole('button', { name: '拒绝' }).click();
  // 列表随后重读：等"想加你的人"那一块消失（5 秒内）
  await b.getByRole('heading', { name: /想加你的人/ }).waitFor({ state: 'detached', timeout: 5_000 });

  console.log('坏编码的好友链接：显示"没找到"，页面不崩');
  expectHttp(404, '/api/friends/code/%25E0');
  await a.goto(`${BASE}/f/%E0`);
  await a.getByText('没有找到这个好友码').waitFor();

  console.log('朋友换好友码：旧链接失效');
  await b.getByText('换一个好友码').click();
  await b.getByRole('button', { name: '换好友码' }).click();
  await b.getByText('换好了').waitFor();
  const code2 = (await b.getByTestId('my-friend-code').textContent())!.trim();
  check(code2 !== code && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code2), `新好友码不对：${code2}`);
  expectHttp(404, `/api/friends/code/${code}`);
  await a.goto(link);
  await a.getByText('没有找到这个好友码').waitFor();
  await shot(a, 'friend-link-missing');
}

/** 朋友的"我的账号"：资料、云存档、改密码、换恢复码、退出、找回、注销。 */
async function friendFlow(browser: Browser, ctx: BrowserContext, page: Page, pw1: string, rc1: string): Promise<void> {
  const calls = apiCalls(page);

  console.log('已经登录着、从游戏点"登录"过来：给"回到开盘"');
  await page.goto(`${BASE}/login?from=kaipan`);
  await page.getByRole('link', { name: '回到开盘' }).waitFor();
  check((await page.getByRole('link', { name: '回到开盘' }).getAttribute('href')) === '/games/kaipan/', '"回到开盘"应该指向 /games/kaipan/');
  await shot(page, 'login-already');

  console.log('我的账号：资料、云存档（模拟游戏存一份）');
  await page.evaluate(async () => {
    const r = await fetch('/api/saves/kaipan/profile', {
      method: 'PUT',
      headers: { 'x-arcade': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, data: { runs: 3, best: '股神', tutorial: true } }),
    });
    if (r.status !== 200) throw new Error(`存档失败 ${r.status}`);
  });

  console.log('排行榜（模拟游戏交分、读榜；没有界面）：真的 D1 上迁移和路由都通');
  // 每日榜只收北京时间昨天到明天的，按真实时间算今天
  const today = `daily-${new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)}`;
  const board = await page.evaluate(async (boardId) => {
    const post = (score: number) =>
      fetch('/api/scores', {
        method: 'POST',
        headers: { 'x-arcade': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'kaipan', boardId, score }),
      }).then((r) => r.json());
    const first = await post(120);
    const lower = await post(80);
    const read = await fetch(`/api/boards/kaipan/${boardId}?scope=friends`).then((r) => r.json());
    return { first, lower, read };
  }, today);
  check(JSON.stringify(board.first) === '{"best":120,"improved":true}', `第一次交分不对：${JSON.stringify(board.first)}`);
  check(JSON.stringify(board.lower) === '{"best":120,"improved":false}', `更低的分不该覆盖：${JSON.stringify(board.lower)}`);
  check(board.read.me?.rank === 1 && board.read.entries?.[0]?.isMe === true && !('username' in board.read.entries[0]), `读榜不对：${JSON.stringify(board.read)}`);

  await page.getByTitle('我的账号').click();
  await page.getByRole('heading', { name: '我的账号' }).waitFor();
  await page.getByTestId('saves-kaipan').getByText(/^1 份/).waitFor();
  await page.getByTestId('saves-guandan').getByText('还没有存档').waitFor();
  await shot(page, 'me');

  console.log('改昵称；写接口的 429、503、断网提示（浏览器里模拟）');
  let d = await openFold(page, '改昵称');
  await d.getByLabel('新昵称').fill('冒烟大刘');
  await d.getByRole('button', { name: '保存' }).click();
  await d.getByText('改好了').waitFor();
  await page.locator('.account__name', { hasText: '冒烟大刘' }).waitFor();
  const patchOnly = (handle: (r: Route) => Promise<void>) => (r: Route) => (r.request().method() === 'PATCH' ? handle(r) : r.continue());
  for (const [what, handler, text, status] of [
    ['429', patchOnly((r) => r.fulfill(json({ error: 'rate_limited', message: '操作太频繁，过一会儿再试', retryAfter: 120 }, 429))), '操作太频繁，过一会儿再试（2 分钟后）', 429],
    ['503', patchOnly((r) => r.fulfill(json({ error: 'busy', message: '服务器有点忙，明天再来' }, 503))), '服务器有点忙，明天再来', 503],
    ['断网', patchOnly((r) => r.abort('internetdisconnected')), '网络不通，检查一下再试', 0],
  ] as const) {
    await page.route('**/api/me', handler);
    if (status) expectHttp(status, '/api/me');
    await d.getByRole('button', { name: '保存' }).click();
    await d.getByText(text).waitFor();
    if (what === '429') await shot(page, 'rename-429');
    await page.unroute('**/api/me');
  }

  console.log('改密码：先输错一次（401，提示"密码不对"），再改成功');
  d = await openFold(page, '改密码');
  await d.getByLabel('现在的密码').fill('Wrong-Pass-000');
  await d.getByLabel('新密码').fill(PW2);
  expectHttp(401, '/api/account/password');
  await d.getByRole('button', { name: '改密码' }).click();
  await d.getByText('密码不对', { exact: true }).waitFor();
  await shot(page, 'change-password-wrong');
  await d.getByLabel('现在的密码').fill(pw1);
  await d.getByRole('button', { name: '改密码' }).click();
  await d.getByText('改好了，别的设备都已退出').waitFor();

  console.log('换恢复码：复制、存图；没存好时点链接、后退、整页跳走、点"退出登录"都先确认，点"取消"人还登录着、码还在');
  d = await openFold(page, '换一个恢复码');
  await d.getByLabel('现在的密码').fill(PW2);
  await d.getByRole('button', { name: '换恢复码' }).click();
  const codeEl = d.getByTestId('recovery-code');
  await codeEl.waitFor();
  const code2 = (await codeEl.textContent())!.trim();
  check(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(code2) && code2 !== rc1, `新恢复码格式不对或没变：${code2}`);
  check(await d.getByRole('button', { name: '好了' }).isDisabled(), '没勾"我已经存好了"之前不能继续');
  await d.getByRole('button', { name: '复制', exact: true }).click();
  await d.getByRole('button', { name: '已复制' }).waitFor();
  check((await page.evaluate(() => navigator.clipboard.readText())) === code2, '复制到剪贴板的不是恢复码');
  // 存成图片：浏览器里现画，下载下来放进截图目录，人工看一眼（这一步也在 CSP 下）
  const [download] = await Promise.all([page.waitForEvent('download'), d.getByRole('button', { name: '存成图片' }).click()]);
  check(download.suggestedFilename() === `恢复码-${NAME}.png`, `图片文件名不对：${download.suggestedFilename()}`);
  await download.saveAs(join(OUT, 'recovery-code-image.png'));
  console.log(`  图片 ${join(OUT, 'recovery-code-image.png')}`);
  let kind = dismissNextDialog(page);
  await page.getByRole('link', { name: '隐私说明' }).click();
  check((await kind) === 'confirm', '恢复码没存好就点链接应该先确认');
  await codeEl.waitFor();
  kind = dismissNextDialog(page);
  await page.goBack();
  check((await kind) === 'confirm', '恢复码没存好时后退应该先确认');
  await codeEl.waitFor();
  kind = dismissNextDialog(page);
  await page.evaluate(() => {
    location.href = '/privacy';
  });
  check((await kind) === 'beforeunload', '恢复码没存好时整页跳走应该有 beforeunload 提醒');
  await page.waitForTimeout(300);
  check(new URL(page.url()).pathname === '/me', `取消离开后应该还在我的账号：${page.url()}`);
  // 复审 A：先问再退出。点"取消"时不该发出退出请求，人还登录着，码还在
  const logouts = () => calls.filter((c) => c === 'POST /api/auth/logout').length;
  const before = logouts();
  kind = dismissNextDialog(page);
  await page.getByRole('button', { name: '退出登录' }).click();
  check((await kind) === 'confirm', '恢复码没存好时点"退出登录"应该先确认');
  await page.waitForTimeout(300);
  check(logouts() === before, '点了"取消"却还是发了退出请求');
  await codeEl.waitFor();
  await page.locator('.account__name', { hasText: '冒烟大刘' }).waitFor();
  await shot(page, 'new-recovery-code');
  await d.getByLabel('我已经存好了').check();
  await d.getByRole('button', { name: '好了' }).click();

  console.log('退出其他设备；被退出的那台设备再操作：401，页面变成"去登录"，cookie 被清掉');
  const other = await newPage(browser, '另一台设备');
  await login(other.page, NAME, PW2);
  await other.page.goto(`${BASE}/me`);
  const od = await openFold(other.page, '改昵称');
  d = await openFold(page, '退出其他设备');
  await d.getByLabel('现在的密码').fill(PW2);
  await d.getByRole('button', { name: '退出其他设备' }).click();
  await d.getByText('别的设备都已退出').waitFor();
  await od.getByLabel('新昵称').fill('冒烟小刘');
  expectHttp(401, '/api/me');
  await od.getByRole('button', { name: '保存' }).click();
  await other.page.getByRole('link', { name: '去登录' }).waitFor();
  check((await other.page.locator('.account').textContent()) === '登录', '会话失效后右上角回到"登录"');
  check(!(await other.ctx.cookies(BASE)).some((c) => c.name === '__Host-arcade_li' && c.value), '401 之后登录提示 cookie 应该被清掉');
  await shot(other.page, 'session-expired');
  await other.ctx.close();

  console.log('没有离开提醒时退出登录：不问，直接回首页');
  kind = dismissNextDialog(page);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.locator('.account', { hasText: '登录' }).waitFor();
  check((await kind) === 'none', '没有要保存的东西时退出不该弹确认');
  check(!(await ctx.cookies(BASE)).some((c) => c.name === '__Host-sid' && c.value), '退出后会话 cookie 应该清掉');

  // 登录、找回、建号工具都吃同一个 IP 的匿名令牌（每分钟 10 个，5.4），本地所有请求都是一个 IP：
  // 到这里已经用了十来个，后面还有 6 次登录和找回，等它回满再走，免得被 429
  await breathe(page, 40);

  console.log('从游戏来登录：登录后回到游戏（德州的闸门也带 from=texas 过来）');
  await page.goto(`${BASE}/login?from=texas`);
  await page.getByText('登录后回到「德州扑克」').waitFor();
  await page.goto(`${BASE}/login?from=kaipan`);
  await page.getByText('登录后回到「开盘」').waitFor();
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('密码').fill(PW2);
  // 本地没有开盘的 Worker，平台对 /games/* 回 404，这里只看跳到了哪
  expectHttp(404, '/games/kaipan/');
  await Promise.all([page.waitForURL(`${BASE}/games/kaipan/`), page.getByRole('button', { name: '登录' }).click()]);

  console.log('from 是外站网址：不认，回首页');
  await page.goto(`${BASE}/me`);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.locator('.account', { hasText: '登录' }).waitFor();
  await page.goto(`${BASE}/login?from=${encodeURIComponent('https://evil.example/')}`);
  check((await page.getByText('登录后回到').count()) === 0, '外站 from 不该显示"回到"');
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('密码').fill(PW2);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.locator('.account__name').waitFor();
  await page.goto(`${BASE}/me`);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.locator('.account', { hasText: '登录' }).waitFor();

  console.log('登录输错密码：提示，不说是哪个错');
  await page.goto(`${BASE}/login`);
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('密码').fill('Wrong-Pass-000');
  expectHttp(401, '/api/auth/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('用户名或密码不对').waitFor();
  await shot(page, 'login-wrong');

  console.log('忘了密码：恢复码错时说"用户名或恢复码不对"；用对的重设，复制不了时给提示');
  await page.getByRole('link', { name: '用恢复码找回' }).click();
  await page.getByRole('heading', { name: '忘了密码' }).waitFor();
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('恢复码').fill('AAAAA-AAAAA-AAAAA-AAAAA');
  await page.getByLabel('新密码').fill(PW3);
  expectHttp(401, '/api/auth/recover');
  await page.getByRole('button', { name: '重设密码' }).click();
  await page.getByText('用户名或恢复码不对').waitFor();
  await page.getByLabel('恢复码').fill(code2.toLowerCase().replaceAll('-', ' '));
  await shot(page, 'forgot');
  await page.getByRole('button', { name: '重设密码' }).click();
  await page.getByTestId('recovery-code').waitFor();
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('不让用'));
  });
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByText('复制不了，长按上面的码手动复制').waitFor();
  await shot(page, 'forgot-done');
  await page.getByLabel('我已经存好了').check();
  await page.getByRole('button', { name: '回首页' }).click();
  await page.locator('.account__name', { hasText: '冒烟大刘' }).waitFor();

  console.log('注销：恢复码错时说"恢复码不对"；勾选前按钮不能点；注销后回首页，提示只出现一次');
  await page.getByTitle('我的账号').click();
  d = await openFold(page, '注销账号');
  await d.getByRole('button', { name: '忘了密码？用恢复码' }).click();
  await d.getByLabel('恢复码').fill('AAAAA-AAAAA-AAAAA-AAAAA');
  check(await d.getByRole('button', { name: '注销账号' }).isDisabled(), '没勾"我知道删了就找不回来"之前不能注销');
  await d.getByLabel('我知道删了就找不回来').check();
  expectHttp(401, '/api/account/delete');
  await d.getByRole('button', { name: '注销账号' }).click();
  await d.getByText('恢复码不对', { exact: true }).waitFor();
  await d.getByRole('button', { name: '改用密码' }).click();
  check((await d.getByText('恢复码不对', { exact: true }).count()) === 0, '换成用密码后，恢复码的出错提示应该清掉');
  await d.getByLabel('现在的密码').fill(PW3);
  await shot(page, 'delete');
  await d.getByRole('button', { name: '注销账号' }).click();
  await page.getByText('账号已经注销').waitFor();
  check(!page.url().includes('deleted'), `注销提示显示后应该把 ?deleted=1 从网址里去掉：${page.url()}`);
  check((await page.locator('.account').textContent()) === '登录', '注销后右上角回到"登录"');
  check((await page.getByRole('link', { name: '登录后才能玩' }).count()) > 0, '注销后游戏卡片回到"登录后才能玩"');
  await shot(page, 'deleted');
  await page.reload();
  await page.getByRole('heading', { name: '开盘' }).waitFor();
  check((await page.getByText('账号已经注销').count()) === 0, '刷新后注销提示不该再出现');
  // 账号真没了：同样的用户名和密码登不上
  await page.goto(`${BASE}/login`);
  await page.getByLabel('用户名').fill(NAME);
  await page.getByLabel('密码').fill(PW3);
  expectHttp(401, '/api/auth/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('用户名或密码不对').waitFor();
  await ctx.close();
}

const FAKE_LIST = [
  { id: 'a', username: 'owner', displayName: '阿国', role: 'admin', createdAt: Date.UTC(2026, 9, 14), lastSeenAt: Date.UTC(2026, 9, 14, 8) },
  {
    id: 'b',
    username: 'xiaoming_2026',
    displayName: '小明',
    role: 'user',
    createdAt: Date.UTC(2026, 9, 14, 9),
    lastSeenAt: Date.UTC(2026, 9, 14, 9),
    wallet: { balance: 23_400, onTable: 2_000, played: { kaipan: 3, texas: 12 } },
  },
  {
    id: 'c',
    username: 'a_very_long_name_20',
    displayName: '名字有十二个字那么长的人',
    role: 'user',
    createdAt: Date.UTC(2026, 9, 14, 10),
    lastSeenAt: Date.UTC(2026, 9, 15, 10),
    wallet: { balance: null, onTable: 0, played: {} },
  },
];

/** 今日概况（0.10.7）：今天现算，前一天是 0.10.7 以前记的（没有人数） */
const FAKE_OVERVIEW = {
  today: {
    day: '2026-10-16', total: 12_400_000, wallets: 44, grant: 20_000, relief: 3_500, admin: 5_000, active: 9, reliefCount: 2, visitors: 14,
    games: { kaipan: { in: 6_000, out: 9_000, back: 0, capped: 1_200, players: 3 }, texas: { in: 24_000, out: 21_000, back: 2_000, capped: 0, players: 6 } },
  },
  days: [{ day: '2026-10-15', total: 12_345_678, wallets: 42, grant: 120_000, relief: 6_000, games: { kaipan: { in: 8_000, out: 14_000, back: 2_000, capped: 1_500 } } }],
};

/** 手机上的筹码统计表：几个游戏、大数字，看横向能不能滑开 */
const FAKE_STATS = [
  { day: '2026-10-15', total: 12_345_678, wallets: 42, grant: 120_000, relief: 6_000,
    games: { guandan: { in: 20_000, out: 18_500, back: 0, capped: 0 }, kaipan: { in: 8_000, out: 14_000, back: 2_000, capped: 1_500 }, texas: { in: 50_000, out: 38_000, back: 2_000, capped: 0 } } },
  { day: '2026-10-14', total: 12_100_000, wallets: 40, grant: 100_000, relief: 2_000, games: {} },
];

/** 用模拟的管理员登录状态打开管理界面（不占真实登录次数）。 */
const DEFAULT_RULES = { reliefTo: 2_000, winUnits: 10, newBalance: 10_000, adminAdjustMax: 1_000_000 };
const FAKE_RULES = {
  rules: DEFAULT_RULES,
  defaults: DEFAULT_RULES,
  range: { reliefTo: [0, 1_000_000], winUnits: [1, 1_000], newBalance: [0, 10_000_000], adminAdjustMax: [1, 100_000_000] },
  log: [],
  updatedAt: null,
};

/** 装作管理员登录着，管理页要读的接口都用假的；registration 是"开放注册"那块读到的状态。 */
async function mockAdmin(page: Page, registration: object = { open: true, switchOpen: true, forcedOff: false, updatedAt: Date.UTC(2026, 9, 14, 12, 5) }): Promise<void> {
  await mockSession(page, { user: FAKE_ADMIN });
  await page.route('**/api/admin/users', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ users: FAKE_LIST }))
      : r.fulfill(json({ user: FAKE_LIST[1], password: 'maple-otter-sunny-42', recoveryCode: 'BJ342-PD1HQ-H29E6-HZVR3' }, 201)),
  );
  await page.route('**/api/admin/settings/registration', (r) => r.fulfill(json(registration)));
  await page.route('**/api/admin/wallet-stats', (r) => r.fulfill(json({ days: FAKE_STATS })));
  await page.route('**/api/admin/settings/wallet', (r) => r.fulfill(json(FAKE_RULES)));
  await page.route('**/api/admin/overview', (r) => r.fulfill(json(FAKE_OVERVIEW)));
  await page.route('**/api/admin/settings/notice', (r) => r.fulfill(json({ notice: null, max: 120 })));
  // 点开一个人就读他的钱包：默认给个没用过钱包的空摘要，要看具体内容的段落再单独挂（后挂的先匹配）
  await page.route('**/api/admin/wallet/*', (r) => r.fulfill(json({ ...FAKE_WALLET, log: [] })));
}

/** 用模拟的管理员打开管理页：先看一眼钱包统计画出来，再停在"用户"一区等账号列表。 */
async function fakeAdmin(page: Page): Promise<void> {
  await mockAdmin(page);
  await page.goto(`${BASE}/admin?s=stats`);
  await page.getByTestId('wallet-stats').locator('.per-game li', { hasText: '德州扑克 带入 50,000 · 结回 38,000 · 退回 2,000' }).waitFor();
  await adminSection(page, '用户');
  await page.getByTestId('user-xiaoming_2026').waitFor();
}

const FAKE_FRIENDS = {
  friends: [
    { userId: 'f1', displayName: '小明', avatar: null, lastSeenDaysAgo: 0 },
    { userId: 'f2', displayName: '名字有十二个字那么长的人', avatar: null, lastSeenDaysAgo: 1 },
    { userId: 'f3', displayName: '阿花', avatar: null, lastSeenDaysAgo: 23 },
  ],
  incoming: [{ userId: 'f4', displayName: '新朋友', avatar: null }],
  outgoing: [{ userId: 'f5', displayName: '老同学', avatar: null }],
};

/** 用模拟的登录状态打开好友页（不占真实登录次数）。 */
async function fakeFriends(page: Page): Promise<void> {
  await mockSession(page);
  await page.route('**/api/friends', (r) => r.fulfill(json(FAKE_FRIENDS)));
  await page.route('**/api/blocks', (r) => r.fulfill(json({ blocks: [{ userId: 'f6', displayName: '烦人的人', avatar: null }] })));
  await page.route('**/api/friends/code/*', (r) => r.fulfill(json({ user: { userId: 'f7', displayName: '小红', avatar: null }, relation: 'pending_in' })));
  await page.goto(`${BASE}/friends`);
  await page.getByRole('heading', { name: '好友（3）' }).waitFor();
}

async function mobile(browser: Browser): Promise<void> {
  console.log('手机竖屏：首页、登录（注册关着/开着）、隐私说明、我的账号、管理界面；可点的地方至少 44 高');
  const { ctx, page } = await newPage(browser, '手机竖屏', 'portrait');
  await page.goto(`${BASE}/`);
  await page.locator('.account').waitFor();
  await shot(page, 'mobile-home');
  const playBox = await page.getByRole('link', { name: '登录后才能玩' }).first().boundingBox();
  check(playBox && playBox.height >= 44, `"登录后才能玩"不到 44 高（${playBox?.height ?? 0}）`);
  await Promise.all([page.waitForResponse(`${BASE}/api/me`), page.goto(`${BASE}/login`)]);
  await page.getByText('现在只对受邀的朋友开放').waitFor();
  await shot(page, 'mobile-login');
  // 以后打开注册时的样子（接口回 open）
  await page.route('**/api/me', (r) => r.fulfill(json({ user: null, service: 'ok', saves: 'ok', registration: 'open' })));
  await page.goto(`${BASE}/login?tab=register`);
  await page.getByRole('heading', { name: '注册' }).waitFor();
  await shot(page, 'mobile-register-open');
  await page.unroute('**/api/me');
  await page.goto(`${BASE}/privacy`);
  await page.getByRole('heading', { name: '我们存了你什么' }).waitFor();
  await page.getByText(/^我们不放广告，也不卖你的数据；除了下面"访问统计"/).waitFor();
  await page.getByText(/^排行榜：每个榜只留你最好的一次成绩/).waitFor();
  await page.getByText(/^我们用 Cloudflare 的网站统计，看有多少次访问/).waitFor();
  // 注册开着、关着都成立的说法；不再说"只对受邀的朋友开放"
  await page.getByText('有账号、登录后才能玩。注册不一定一直开着，没开的时候，账号由管理员给朋友建。').waitFor();
  check((await page.getByText(/受邀/).count()) === 0, '隐私说明不该再说"受邀"');
  // 积分和筹码那段（维护者 2026-10-14 定）：免费没充值、没有现金价值、不涉及线下财物、可能清零、包括德州扑克
  await page.getByRole('heading', { name: '积分和筹码' }).waitFor();
  for (const text of [
    /^这是朋友之间一起玩的娱乐小站：免费，也没有充值。$/,
    /^游戏里的积分、筹码只能在游戏里用，没有任何现金价值：不能买，不能换成钱或东西，不能转给或送给别的玩家，也不设任何奖品。$/,
    /^本站不涉及任何线下的财物或交易。$/,
    /^调整规则或清理数据时，筹码、积分和战绩可能会被清零。$/,
    /^所有游戏都是这样，包括以后新上的游戏。$/,
  ]) {
    check(await page.getByText(text).isVisible(), `隐私说明里没有显示：${text.source}`);
  }
  await shot(page, 'mobile-privacy');
  // 用模拟的登录状态打开"我的账号"，量点击区
  await mockSession(page);
  await page.route('**/api/saves/*', (r) => r.fulfill(json({ saves: [] })));
  // 登录后的首页：掼蛋卡片的"进入游戏""好友房"并排，都至少 44 高
  await page.goto(`${BASE}/`);
  const guandan = page.locator('.card', { hasText: '掼蛋' });
  await guandan.getByRole('link', { name: '好友房' }).waitFor();
  for (const name of ['进入游戏', '好友房']) {
    const box = await guandan.getByRole('link', { name }).boundingBox();
    check(box && box.height >= 44, `首页"${name}"不到 44 高（${box?.height ?? 0}）`);
  }
  await guandan.scrollIntoViewIfNeeded();
  await shot(page, 'mobile-home-signed-in');
  await page.goto(`${BASE}/me`);
  await page.getByRole('heading', { name: '我的账号' }).waitFor();
  await openFold(page, '注销账号');
  const targets = [
    ...(await page.locator('.fold > summary').all()),
    page.getByRole('button', { name: '忘了密码？用恢复码' }),
    page.getByRole('link', { name: '隐私说明' }),
  ];
  for (const t of targets) {
    const box = await t.boundingBox();
    check(box && box.height >= 44, `点击区不到 44 高：${await t.textContent()}（${box?.height ?? 0}）`);
  }
  await shot(page, 'mobile-me');
  await ctx.close();

  const adm = await newPage(browser, '手机竖屏管理', 'portrait');
  await fakeAdmin(adm.page);
  await shot(adm.page, 'mobile-admin');
  const row = await pickUser(adm.page, 'a_very_long_name_20');
  check(await adm.page.getByTestId('user-xiaoming_2026').isHidden(), '手机上点进一个人以后列表应该收起来');
  for (const t of await row.locator('.btn').all()) {
    const box = await t.boundingBox();
    check(box && box.height >= 44, `管理界面的按钮不到 44 高：${await t.textContent()}（${box?.height ?? 0}）`);
  }
  await row.getByRole('button', { name: '删号' }).click();
  await row.getByLabel(/确定删掉/).waitFor();
  await shot(adm.page, 'mobile-admin-delete');
  await row.getByRole('button', { name: '返回列表' }).click();
  await adm.page.getByTestId('new-user').click();
  check(await adm.page.getByTestId('user-xiaoming_2026').isHidden(), '手机上点"+ 建号"以后列表应该收起来');
  await adm.page.getByRole('button', { name: '建号', exact: true }).click(); // 必填项空着：浏览器自己拦下，不发请求
  await adm.page.getByLabel('用户名').fill('xiaoming_2026');
  await adm.page.getByLabel('昵称').fill('小明');
  await adm.page.getByRole('button', { name: '建号', exact: true }).click();
  await adm.page.getByRole('heading', { name: '账号建好了' }).waitFor();
  await shot(adm.page, 'mobile-admin-card');
  await adm.ctx.close();

  const fr = await newPage(browser, '手机竖屏好友', 'portrait');
  await fakeFriends(fr.page);
  await fr.page.getByText('23 天前来过').waitFor();
  await fr.page.getByText('昨天来过').waitFor();
  await shot(fr.page, 'mobile-friends');
  for (const t of await fr.page.locator('.people .btn').all()) {
    const box = await t.boundingBox();
    check(box && box.height >= 44, `好友页的按钮不到 44 高：${await t.textContent()}（${box?.height ?? 0}）`);
  }
  await fr.page.goto(`${BASE}/f/ABCD2345`);
  await fr.page.getByRole('button', { name: '接受，成为好友' }).waitFor();
  await shot(fr.page, 'mobile-friend-link');
  await fr.ctx.close();

  console.log('手机横屏：首页、登录、我的账号、隐私说明、管理界面、好友页');
  const land = await newPage(browser, '手机横屏', 'landscape');
  await land.page.goto(`${BASE}/`);
  await land.page.locator('.account').waitFor();
  await shot(land.page, 'landscape-home');
  await Promise.all([land.page.waitForResponse(`${BASE}/api/me`), land.page.goto(`${BASE}/login`)]);
  await land.page.getByRole('heading', { name: '登录' }).waitFor();
  await shot(land.page, 'landscape-login');
  await mockSession(land.page);
  await land.page.route('**/api/saves/*', (r) => r.fulfill(json({ saves: [] })));
  await land.page.goto(`${BASE}/me`);
  await land.page.getByRole('heading', { name: '我的账号' }).waitFor();
  await shot(land.page, 'landscape-me');
  await land.page.goto(`${BASE}/privacy`);
  await land.page.getByText(/^我们不放广告，也不卖你的数据；除了下面"访问统计"/).waitFor();
  await land.page.getByRole('heading', { name: '积分和筹码' }).waitFor();
  await shot(land.page, 'landscape-privacy');
  await land.ctx.close();
  const land2 = await newPage(browser, '手机横屏管理', 'landscape');
  await fakeAdmin(land2.page);
  await shot(land2.page, 'landscape-admin');
  await land2.ctx.close();
  const land3 = await newPage(browser, '手机横屏好友', 'landscape');
  await fakeFriends(land3.page);
  await shot(land3.page, 'landscape-friends');
  await land3.ctx.close();
}

/** 0.10.11：大厅提醒。一处筹码在桌上时直达那个游戏；筹码见底时就地领补给，领完提醒收起。 */
/** 0.10.26：大厅的点按声。开着时按下能点的东西才建 AudioContext；页脚关掉以后记住，再按什么都不建（一点声音都不出），刷新后照样关着 */
async function lobbySound(browser: Browser): Promise<void> {
  console.log('大厅点按声：开着响、关了记住且一点不响');
  const { ctx, page } = await newPage(browser, '点按声', 'portrait');
  await page.addInitScript(() => {
    const w = window as unknown as { AudioContext: typeof AudioContext; __audio: number };
    w.__audio = 0;
    const Real = w.AudioContext;
    w.AudioContext = class extends Real {
      constructor() {
        super();
        w.__audio++;
      }
    };
  });
  const audio = () => page.evaluate(() => (window as unknown as { __audio: number }).__audio);
  const press = (loc: ReturnType<Page['locator']>) => loc.dispatchEvent('pointerdown', { button: 0, pointerType: 'touch' });
  await page.goto(`${BASE}/`);
  const toggle = page.getByTestId('sound-toggle');
  await toggle.getByText('声音：开').waitFor();
  check((await audio()) === 0, '还没按任何东西就建了 AudioContext');
  await press(page.locator('.card__play').first());
  check((await audio()) === 1, `开着时按下按钮应该响一声：建了 ${await audio()} 个 AudioContext`);
  await toggle.click();
  await toggle.getByText('声音：关').waitFor();
  check((await page.evaluate(() => localStorage.getItem('arcade.sound'))) === 'off', '关掉以后应该记在 arcade.sound');
  await page.reload();
  await toggle.getByText('声音：关').waitFor();
  await press(page.locator('.card__play').first());
  await press(page.getByRole('link', { name: '隐私说明' }));
  check((await audio()) === 0, '关着时按什么都不该建 AudioContext');
  await shot(page, 'lobby-sound-off');
  await toggle.click();
  await toggle.getByText('声音：开').waitFor();
  check((await audio()) === 1, '打开时应该响一声确认');
  check((await page.evaluate(() => localStorage.getItem('arcade.sound'))) === null, '打开以后 arcade.sound 应该删掉');
  await ctx.close();
}

async function lobbyNudge(browser: Browser): Promise<void> {
  console.log('大厅提醒：桌上的筹码、就地领补给');
  const { ctx, page } = await newPage(browser, '大厅提醒', 'portrait');
  const stake = { game: 'texas', ref: 'room-123456', tier: 'small', amount: 1_000, mode: 'server', at: Date.UTC(2026, 9, 16, 1), until: Date.UTC(2026, 9, 16, 9) };
  const low = { balance: 300, stakes: [stake], canRelief: true, writesLeft: 200, caps: {}, fresh: false };
  let relieved = false;
  await mockSession(page, { me: { notice: null }, wallet: () => ({ ...FAKE_WALLET, wallet: relieved ? { ...low, balance: 1_000, canRelief: false } : low, ledger: [] }) });
  await page.route('**/api/wallet/relief', (r) => {
    relieved = true;
    return r.fulfill(json({ wallet: { ...low, balance: 1_000, canRelief: false } }));
  });
  await page.goto(`${BASE}/`);
  const toTable = page.getByTestId('nudge-stake');
  await toTable.getByText('德州扑克好友房桌上还有 1,000').waitFor();
  // 同一个游戏两份（单机加好友房）：还是直达德州，不说"2 个游戏"
  await page.unroute('**/api/wallet');
  const solo = { ...stake, ref: 'solo-abcdef', mode: 'client', amount: 2_000 };
  await page.route('**/api/wallet', (r) => r.fulfill(json({ ...FAKE_WALLET, wallet: { ...low, stakes: [stake, solo] }, ledger: [] })));
  await page.reload();
  await toTable.getByText('德州扑克桌上还有 3,000（2 份）').waitFor();
  await toTable.getByRole('link', { name: '回去接着打' }).waitFor();
  await page.unroute('**/api/wallet');
  await page.route('**/api/wallet', (r) =>
    r.fulfill(json({ ...FAKE_WALLET, wallet: relieved ? { ...low, balance: 1_000, canRelief: false } : low, ledger: [] })),
  );
  await page.reload();
  await toTable.getByText('德州扑克好友房桌上还有 1,000').waitFor();
  const href = await toTable.getByRole('link', { name: '回去接着打' }).getAttribute('href');
  check(href === '/games/texas/', `"回去接着打"指错了：${href}`);
  await page.getByTestId('nudge-relief').getByText('连桌上的补到 2,000').waitFor();
  const btn = (await page.getByRole('button', { name: '领补给' }).boundingBox())!;
  check(btn.height >= 44, `"领补给"不到 44 高（${btn.height}）`);
  await shot(page, 'lobby-nudge');
  await page.getByRole('button', { name: '领补给' }).click();
  await page.getByTestId('wallet-badge').getByText('1,000').waitFor();
  await page.getByTestId('nudge-relief').waitFor({ state: 'detached' });
  await toTable.waitFor();
  await ctx.close();
}

/** 0.10.8：管理页发大厅公告，大厅顶上显示（只给登录了的人）。 */
async function lobbyNotice(browser: Browser): Promise<void> {
  console.log('管理页发大厅公告，大厅里看到');
  const text = '今晚 9 点掼蛋好友局，来凑一桌！德州新加了表情，欢迎来试试，有问题直接找阿国。';
  const at = Date.UTC(2026, 9, 15, 13);
  {
    const { ctx, page } = await newPage(browser, '发公告');
    await fakeAdmin(page);
    let sent: unknown = null;
    await page.route('**/api/admin/settings/notice', (r) => {
      if (r.request().method() === 'GET') return r.fulfill(json({ notice: null, max: 120 }));
      sent = r.request().postDataJSON();
      return r.fulfill(json({ notice: { text, at, by: 'owner' }, max: 120 }));
    });
    await page.goto(`${BASE}/admin?s=settings`);
    const form = page.getByTestId('notice-admin');
    await form.getByText('现在没有公告').waitFor();
    await form.getByLabel('公告内容').fill('字'.repeat(121));
    await form.getByText('太长了，最多 120 个字（现在 121）').waitFor();
    check(await form.getByRole('button', { name: '发布' }).isDisabled(), '太长了还能点发布');
    await form.getByLabel('公告内容').fill(text);
    await form.getByRole('button', { name: '发布' }).click();
    await form.getByText('现在挂着：owner').waitFor();
    await form.getByRole('button', { name: '撤下公告' }).waitFor();
    check(JSON.stringify(sent) === JSON.stringify({ text }), `发的不对：${JSON.stringify(sent)}`);
    await shot(page, 'admin-notice');
    await ctx.close();
  }
  const { ctx, page } = await newPage(browser, '大厅公告', 'portrait');
  await mockSession(page, { me: { notice: { text, at } } });
  await page.goto(`${BASE}/`);
  await page.getByTestId('notice').getByText(text).waitFor();
  await shot(page, 'lobby-notice');
  await ctx.close();
}

/** 0.10.7：管理页的今日概况、账号列表的钱包摘要、展开一个人的战绩和流水。 */
async function adminOverview(browser: Browser): Promise<void> {
  for (const screen of ['desktop', 'portrait'] as const) {
    console.log(`管理页今日概况、账号的钱包和战绩（${screen}）`);
    const { ctx, page } = await newPage(browser, `今日概况 ${screen}`, screen);
    await fakeAdmin(page);
    const at = (h: number) => Date.UTC(2026, 9, 15, h);
    await page.route('**/api/admin/wallet/xiaoming_2026', (r) =>
      r.fulfill(
        json({
          user: { username: 'xiaoming_2026', displayName: '小明' },
          wallet: { ...FAKE_WALLET.wallet, balance: 23_400, fresh: false, stakes: [{ game: 'texas', ref: 'room-123456', tier: 'small', amount: 2_000, mode: 'server', at: at(9), until: at(30) }] },
          log: [],
          career: { texas: { n: 12, net: 9_400, wnet: 3_000, rounds: 340, wins: 71, best: 8_800, titles: [{ id: 'bluff_king', at: at(3) }], max: {}, sum: {} } },
          ledger: [
            { at: at(9), t: 'buyin', g: 'texas', a: -2_000 },
            { at: at(8), t: 'settle', g: 'kaipan', a: 22_000, capped: 8_000 },
            { at: at(7), t: 'admin', a: 5_000 },
          ],
        }),
      ),
    );
    await page.goto(`${BASE}/admin`);
    const ov = page.getByTestId('overview');
    await ov.getByText('14').waitFor();
    const texasToday = (await page.locator('.game-today li', { hasText: '德州扑克' }).innerText()).replace(/\s+/g, ' ');
    check(texasToday.includes('6 人') && texasToday.includes('带入 24,000 · 结回 21,000'), `今天各游戏里德州那行不对：${texasToday}`);
    // 模拟数据只有两天：x 轴照样排满 7 天，没记录的天是 0 高的柱
    const chartDays = await page.locator('.chart__day .chart__label').allTextContents();
    check(chartDays.join(' ') === '10-10 10-11 10-12 10-13 10-14 10-15 今天', `趋势图应该固定 7 天：${chartDays.join(' ')}`);
    check((await page.locator('.chart__day .chart__in[height="0"]').count()) === 5, '没记录的 5 天应该画 0');
    if (screen !== 'portrait') {
      await page.locator('.chart__day').last().hover();
      const tip = (await page.locator('.chart__tip').innerText()).replace(/\s+/g, ' ');
      check(tip.includes('今天') && tip.includes('带入 30,000') && tip.includes('玩过 9 人'), `悬停今天应该浮出当天的数字：${tip}`);
    }
    check(await page.locator('.panel__head').getByTestId('admin-chips-open').isVisible(), '"管理筹码"应该在"今天各游戏"的标题行里');
    await shot(page, `admin-console-${screen}`);
    const trendOld = await page.getByTestId('trend').locator('tbody tr').nth(1).locator('td').nth(1).textContent();
    check(trendOld === '—', `0.10.7 以前的记录应该写"—"：${trendOld}`);
    const trendHead = await page.getByTestId('trend').locator('thead th').allTextContents();
    check(trendHead.includes('德州扑克') && !trendHead.includes('飞驰'), `趋势表按用钱包的游戏分列，不列飞驰：${trendHead.join(' ')}`);
    await adminSection(page, '用户');
    await page.getByTestId('user-xiaoming_2026').getByTestId('user-wallet').getByText('余额 23,400 · 桌上 2,000 · 开盘 3 次、德州扑克 12 次').waitFor();
    await page.getByTestId('user-a_very_long_name_20').getByText('还没用过钱包').waitFor();
    const user = await pickUser(page, 'xiaoming_2026');
    const ledger = user.getByTestId('ledger');
    await ledger.getByText('到顶没进 8,000').waitFor();
    await ledger.locator('.ledger__kind--settle').getByText('结回').waitFor();
    await ledger.locator('.ledger__amount.up', { hasText: '+22,000' }).waitFor();
    await user.getByTestId('user-detail').getByText('21%').waitFor();
    await shot(page, `admin-overview-${screen}`);
    await ctx.close();
  }
}

/** 0.10.6：管理页的钱包规则：不合格的数直接提示、不发请求；改一条要确认，发的只有改了的那条，改完显示记录。 */
async function walletRulesAdmin(browser: Browser): Promise<void> {
  console.log('管理页改钱包规则：补给额 2,000 → 3,000');
  const { ctx, page } = await newPage(browser, '钱包规则');
  await fakeAdmin(page);
  let sent: unknown = null;
  await page.route('**/api/admin/settings/wallet', (r) => {
    if (r.request().method() === 'GET') return r.fulfill(json(FAKE_RULES));
    sent = r.request().postDataJSON();
    return r.fulfill(
      json({ ...FAKE_RULES, rules: { ...DEFAULT_RULES, reliefTo: 3_000 }, log: [{ at: Date.UTC(2026, 9, 15, 16), by: 'owner', changes: { reliefTo: [2_000, 3_000] } }], updatedAt: Date.UTC(2026, 9, 15, 16) }),
    );
  });
  await page.goto(`${BASE}/admin?s=settings`);
  const form = page.getByTestId('wallet-rules');
  await form.getByLabel('单机实盘每天最多赢几份').fill('0');
  await form.getByText('要是 1 到 1,000 的整数').waitFor();
  await form.getByLabel('单机实盘每天最多赢几份').fill('10');
  await form.getByLabel('每日补给补到').fill('3000');
  page.once('dialog', (d) => {
    check(d.message().includes('每日补给补到：2,000 → 3,000'), `确认框说的不对：${d.message()}`);
    void d.accept();
  });
  await form.getByRole('button', { name: '保存（改 1 条）' }).click();
  await form.getByText('改好了，已经生效').waitFor();
  check(JSON.stringify(sent) === JSON.stringify({ reliefTo: 3_000 }), `发的不对：${JSON.stringify(sent)}`);
  await form.getByText('改动记录（1）').click();
  await page.getByTestId('rules-log').getByText('每日补给补到 2,000 → 3,000').waitFor();
  await shot(page, 'admin-wallet-rules');
  await ctx.close();
}

/** 0.10.5：好友更好用。好友页的大分享按钮（手机走系统分享，电脑复制）、点好友名字看战绩、战绩页上加好友。 */
async function friendsUx(browser: Browser): Promise<void> {
  const id = (c: string) => c.repeat(22);
  const lists = { friends: [{ userId: id('F'), displayName: '小明', avatar: null, lastSeenDaysAgo: 0 }], incoming: [], outgoing: [] };
  const stub = async (page: Page) => {
    await mockSession(page);
    await page.route('**/api/friends', (r) => r.fulfill(json(lists)));
    await page.route('**/api/blocks', (r) => r.fulfill(json({ blocks: [] })));
    await page.route(`**/api/stats/${id('F')}`, (r) => r.fulfill(json({ user: { userId: id('F'), displayName: '小明', avatar: null }, relation: 'friends', week: '2026-10-12', games: {} })));
    await page.route(`**/api/stats/${id('S')}`, (r) => r.fulfill(json({ user: { userId: id('S'), displayName: '排行榜上的人', avatar: null }, relation: 'none', week: '2026-10-12', games: {} })));
  };

  console.log('电脑：没有系统分享，大按钮直接复制好友链接；点好友名字进战绩页');
  {
    const { ctx, page } = await newPage(browser, '好友分享 电脑');
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stub(page);
    await page.goto(`${BASE}/friends`);
    await page.getByTestId('share-link').getByText('复制我的好友链接').click();
    await page.getByTestId('share-link').getByText('已复制，发给朋友吧').waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(copied.endsWith(`/f/${FAKE_USER.friendCode}`), `复制的不是好友链接：${copied}`);
    await page.getByRole('link', { name: '小明' }).click();
    await page.getByRole('heading', { name: '小明 的战绩' }).waitFor();
    await page.getByText('你们是好友。').waitFor();
    await ctx.close();
  }

  console.log('手机：大按钮叫"分享给朋友"，走系统分享面板；战绩页上给不是好友的人加好友');
  {
    const { ctx, page } = await newPage(browser, '好友分享 手机', 'portrait');
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        value: async (d: ShareData) => {
          (window as unknown as { shared: ShareData }).shared = d;
        },
      });
    });
    await stub(page);
    let sent: unknown = null;
    await page.route('**/api/friends/requests', (r) => {
      sent = r.request().postDataJSON();
      return r.fulfill(json({ status: 'pending' }));
    });
    await page.goto(`${BASE}/friends`);
    await page.getByTestId('share-link').getByText('分享给朋友').click();
    const shared = await page.waitForFunction(() => (window as unknown as { shared?: ShareData }).shared?.url ?? null);
    check(String(await shared.jsonValue()).endsWith(`/f/${FAKE_USER.friendCode}`), '分享出去的不是好友链接');
    await shot(page, 'friends-share-portrait');
    await page.goto(`${BASE}/u/${id('S')}`);
    await page.getByTestId('add-friend').click();
    await page.getByTestId('friend-pending').waitFor();
    check(JSON.stringify(sent) === JSON.stringify({ userId: id('S') }), `加好友发的不对：${JSON.stringify(sent)}`);
    await shot(page, 'stats-add-friend-portrait');
    await ctx.close();
  }
}

/** 0.10.4：排行榜页。本周净赢（总榜、各游戏）、开盘每日挑战（0.10.18 起分数写法读游戏的 daily.json）、称号收集，全部 / 只看好友；我不在前 50 时单独一行。 */
async function boardsPage(browser: Browser): Promise<void> {
  const u = (i: number) => String.fromCharCode(65 + i).repeat(22);
  const row = (i: number, name: string, value: number, rank = i + 1, isMe = false) => ({ rank, userId: u(i), displayName: name, avatar: null, value, isMe });
  const board = (entries: ReturnType<typeof row>[], me: { rank: number; value: number } | null = null) => ({ entries, me });
  const all = {
    week: '2026-10-12',
    daily: { kaipan: 'daily-2026-10-15-v2' },
    boards: {
      total: board([row(0, '老王的徒弟', 48_000), row(1, '小明', 12_500), row(2, '某人', 12_500, 2, true), row(3, '输光了', -6_000, 4)], { rank: 2, value: 12_500 }),
      kaipan: board([row(1, '小明', 12_000)]),
      guandan: board([]),
      texas: board([row(0, '老王的徒弟', 48_000), row(2, '某人', 500, 2, true)], { rank: 2, value: 500 }),
      titles: board([row(1, '小明', 9), row(0, '老王的徒弟', 4)], { rank: 73, value: 1 }),
    },
  };
  const friends = { ...all, boards: { ...all.boards, total: board([row(2, '某人', 12_500, 1, true)], { rank: 1, value: 12_500 }) } };
  for (const screen of ['desktop', 'portrait'] as const) {
    console.log(`排行榜（${screen}）`);
    const { ctx, page } = await newPage(browser, `排行榜 ${screen}`, screen);
    await mockSession(page);
    await page.route('**/api/leaderboard?scope=*', (r) => r.fulfill(json(new URL(r.request().url()).searchParams.get('scope') === 'friends' ? friends : all)));
    await page.route('**/api/boards/kaipan/daily-2026-10-15-v2?scope=*', (r) =>
      r.fulfill(json({ entries: [{ rank: 1, userId: u(1), displayName: '小明', avatar: null, score: 1e11 + 3_820_000, isMe: false }, { rank: 2, userId: u(4), displayName: '韭菜', avatar: null, score: 7, isMe: false }], me: null })),
    );
    // 跟开盘约定的格式（docs/platform-backend.md 15.12）
    await page.route('**/games/kaipan/daily.json', (r) =>
      r.fulfill(json({ note: '每天一样的行情，比谁打得好。', score: [{ from: 1e11, text: '通关 · {n} 元' }, { text: '撑了 {n} 个月' }] })),
    );
    await page.goto(`${BASE}/`);
    await page.locator('.topbar').getByRole('link', { name: '排行' }).click();
    await page.getByTestId('ranks').getByText('+48,000').waitFor();
    await page.getByTestId('ranks').locator('.rank--me').getByText('某人').waitFor();
    await shot(page, `boards-${screen}`);
    await page.getByRole('button', { name: '只看好友' }).click();
    // 好友榜里只有我：等全部榜的第二行消失
    await page.locator('.rank').nth(1).waitFor({ state: 'detached' });
    await page.locator('.rank--me').getByText('+12,500').waitFor();
    await page.getByRole('button', { name: '全部' }).click();
    await page.getByRole('button', { name: '掼蛋' }).click();
    await page.getByTestId('board-empty').waitFor();
    // 不用钱包的游戏（飞驰，0.10.25）不开"本周净赢"的标签：只会是空的
    check((await page.getByRole('group', { name: '哪个游戏' }).getByRole('button', { name: '飞驰' }).count()) === 0, '本周净赢不该有飞驰的标签');
    await page.getByRole('link', { name: '开盘每日' }).click();
    await page.getByText('通关 · 3,820,000 元').waitFor();
    await page.getByText('撑了 7 个月').waitFor();
    await page.getByText('开盘的每日挑战：每天一样的行情，比谁打得好。').waitFor();
    await page.getByRole('link', { name: '称号收集' }).click();
    await page.getByTestId('my-rank').getByText('第 73 名').waitFor();
    if (screen === 'portrait') await shot(page, 'boards-titles-portrait');
    await page.getByTestId('ranks').getByRole('link', { name: '小明' }).click();
    await page.waitForURL((x) => x.pathname === `/u/${u(1)}`);
    await ctx.close();
  }
}

/** 0.10.3：战绩页。自己的、别人的；称号目录读得到的显示名字（没拿到的灰着），读不到的显示"神秘称号"。 */
async function statsPage(browser: Browser): Promise<void> {
  const career = (o: Record<string, unknown>) => ({ n: 3, net: 2_000, wnet: 0, rounds: 0, wins: 0, best: 0, titles: [], max: {}, sum: {}, ...o });
  const games = {
    texas: career({ n: 4, wnet: -1_500, rounds: 1_000, wins: 213, best: 18_400, titles: [{ id: 'bluff_king', at: Date.UTC(2026, 9, 14, 12) }] }),
    kaipan: career({ n: 2, wnet: 12_000, rounds: 2, wins: 1, best: 12_000, titles: [{ id: 'first_year', at: Date.UTC(2026, 9, 13, 3) }, { id: 'diamond_hands', at: Date.UTC(2026, 9, 15, 3) }] }),
  };
  const catalog = { first_year: { name: '熬过一年', desc: '实盘打满 12 个月' }, diamond_hands: { name: '钻石手', desc: '一只票拿满半年' }, all_in: { name: '满仓侠', desc: '满仓过一个月' } };
  for (const screen of ['desktop', 'portrait'] as const) {
    console.log(`战绩页（${screen}）：局数、胜率、最大一把、本周净赢、称号墙`);
    const { ctx, page } = await newPage(browser, `战绩 ${screen}`, screen);
    await mockSession(page);
    await page.route('**/api/stats/me', (r) => r.fulfill(json({ user: { userId: FAKE_USER.id, displayName: FAKE_USER.displayName, avatar: null }, relation: 'self', week: '2026-10-12', games })));
    await page.route('**/games/kaipan/titles.json', (r) => r.fulfill(json(catalog)));
    // 德州还没放称号文件：显示"神秘称号"，不报错
    await page.route('**/games/texas/titles.json', (r) => {
      expectHttp(404, '/games/texas/titles.json');
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${BASE}/me/stats`);
    await page.getByTestId('career-texas').getByText('21%').waitFor();
    await page.getByTestId('career-kaipan').getByText('+12,000').waitFor();
    await page.getByText('钻石手').waitFor();
    await page.getByText('满仓侠').waitFor();
    await page.getByText('神秘称号').waitFor();
    const order = await page.locator('.career').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    check(order.join() === 'career-kaipan,career-texas', `战绩应该按大厅顺序排：${order}`);
    await shot(page, `stats-${screen}`);
    await ctx.close();
  }
  console.log('别人的战绩：/u/<id>，没战绩时说"还没有战绩"');
  const { ctx, page } = await newPage(browser, '别人的战绩');
  const other = 'B'.repeat(22);
  await mockSession(page);
  await page.route(`**/api/stats/${other}`, (r) => r.fulfill(json({ user: { userId: other, displayName: '小明', avatar: null }, relation: 'friends', week: '2026-10-12', games: {} })));
  await page.goto(`${BASE}/u/${other}`);
  await page.getByRole('heading', { name: '小明 的战绩' }).waitFor();
  await page.getByTestId('career-empty').waitFor();
  await ctx.close();
}

/** 0.10.1：游戏"叫朋友来"，没登录的朋友带 next 去登录，登录后带着房间码回到游戏；不合格的 next 不认，按 from 回游戏首页。 */
async function loginNext(browser: Browser): Promise<void> {
  console.log('登录出错的提示：网关 429（带 Retry-After）、平台 429、502、断网都有一句话，按钮恢复能点');
  console.log('登录页带 next：登录后回到 /games/texas/?room=123456；next 是外站时不认，按 from 回游戏');
  const { ctx, page } = await newPage(browser, '登录 next');
  let loggedIn = false;
  await page.route('**/api/me', (r) => r.fulfill(json({ user: loggedIn ? FAKE_USER : null, service: 'ok', saves: 'ok', registration: 'closed' })));
  // 登录出错时的提示（0.10.23）：网关限速回的 429 不是 JSON，以前被说成"连不上服务器"；每种都要有一句话，按钮恢复能点
  let failWith: ((r: Route) => Promise<void>) | null = null;
  await page.route('**/api/auth/login', (r) => {
    if (failWith) return failWith(r);
    loggedIn = true;
    return r.fulfill(json({ user: FAKE_USER }));
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('用户名').fill('someone');
  await page.getByLabel('密码').fill('password-123');
  for (const [handler, text, status] of [
    [(r: Route) => r.fulfill({ status: 429, contentType: 'text/html', headers: { 'retry-after': '30' }, body: '<html>rate limited</html>' }), '试得太频繁了，稍等一会儿再来（30 秒后）', 429],
    [(r: Route) => r.fulfill(json({ error: 'rate_limited', message: '操作太频繁了，歇一会儿再试', retryAfter: 505 }, 429)), '操作太频繁了，歇一会儿再试（9 分钟后）', 429],
    [(r: Route) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>bad gateway</html>' }), '连不上服务器，过一会儿再试', 502],
    [(r: Route) => r.abort('internetdisconnected'), '网络不通，检查一下再试', 0],
  ] as const) {
    failWith = handler;
    if (status) expectHttp(status, '/api/auth/login');
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByText(text).waitFor();
    check(await page.getByRole('button', { name: '登录' }).isEnabled(), `登录出错（${text}）后按钮应该能再点`);
    if (status === 429 && text.startsWith('试得')) await shot(page, 'login-429');
  }
  failWith = null;
  await page.route('**/api/wallet', (r) => r.fulfill(json(FAKE_WALLET)));
  // 游戏是另一个 Worker，本地没有：只看跳到了哪里
  await page.route('**/games/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>game</title>' }));
  for (const [query, want] of [
    [`next=${encodeURIComponent('/games/texas/?room=123456')}`, '/games/texas/?room=123456'],
    [`from=texas&next=${encodeURIComponent('//evil.example/games/x')}`, '/games/texas/'],
  ] as const) {
    loggedIn = false;
    await page.goto(`${BASE}/login?${query}`);
    await page.getByLabel('用户名').fill('someone');
    await page.getByLabel('密码').fill('password-123');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/games/'));
    const u = new URL(page.url());
    check(u.pathname + u.search === want, `登录后应该到 ${want}，实际 ${u.pathname + u.search}`);
  }
  await ctx.close();
}

/** 0.9.8：发版后旧分块没了（404）：整页重载一次拿新版；还是 404 就停下来提示刷新，不来回重载、不白屏。 */
async function staleChunk(browser: Browser): Promise<void> {
  console.log('发版后点进钱包页，分块 404：重载一次，还不行就提示刷新；好了以后点"刷新"能进');
  const { ctx, page } = await newPage(browser, '分块 404');
  await mockSession(page);
  await page.goto(`${BASE}/`);
  await page.getByTestId('wallet-badge').waitFor();
  let missing = 0;
  await page.route('**/assets/Wallet-*.js', (r) => {
    missing++;
    expectHttp(404, new URL(r.request().url()).pathname);
    return r.fulfill({ status: 404, body: '' });
  });
  await page.evaluate(() => ((window as unknown as { beforeDeploy: boolean }).beforeDeploy = true));
  await page.getByTestId('wallet-badge').click();
  await page.getByTestId('page-load-failed').waitFor();
  check(new URL(page.url()).pathname === '/wallet', `应该停在 /wallet，实际 ${page.url()}`);
  check(!(await page.evaluate(() => (window as unknown as { beforeDeploy?: boolean }).beforeDeploy)), '分块 404 后没有整页重载');
  check(missing === 2, `分块应该请求 2 次（第一次 + 重载后一次），实际 ${missing}`);
  await shot(page, 'stale-chunk');
  await page.unroute('**/assets/Wallet-*.js');
  await page.getByTestId('page-load-failed').getByRole('button', { name: '刷新' }).click();
  await page.getByTestId('wallet-balance').waitFor();
  await ctx.close();
}

/** 0.9.2：/api/me 挂住时大厅不卡；钱包页和顶栏的筹码牌子（电脑、手机竖屏、横屏）。 */
async function walletAndSlowNet(browser: Browser): Promise<void> {
  console.log('/api/me 一直不回：8 秒后卡片能点"进入游戏"，顶上写"正在重连"');
  {
    const { ctx, page } = await newPage(browser, '网络卡住');
    await page.route('**/api/me', () => {
      // 不回，模拟国内网络卡住
    });
    await fakeLoginHint(page);
    const t0 = Date.now();
    await page.goto(`${BASE}/`);
    await page.locator('.card', { hasText: '开盘' }).getByText('请稍等…').waitFor();
    const enter = page.locator('.card', { hasText: '开盘' }).getByRole('link', { name: '进入游戏' });
    await enter.waitFor({ timeout: 12_000 });
    const waited = Date.now() - t0;
    check(waited >= 7_000 && waited < 12_000, `"进入游戏"应该在 8 秒左右出来，实际 ${waited} ms`);
    await page.getByTestId('reconnecting').waitFor();
    await shot(page, 'slow-net-home');
    await ctx.close();
  }
  const wallet = {
    balance: 10_320,
    canRelief: false,
    writesLeft: 180,
    fresh: false,
    caps: { kaipan: { net: 2_400, cap: 6_000 }, guandan: { net: -1_200, cap: 30_000 } },
    stakes: [
      { game: 'texas', ref: 'room-123456', tier: 'small', amount: 2_000, mode: 'server', at: Date.UTC(2026, 9, 15, 12, 5), until: Date.UTC(2026, 9, 16, 12, 5) },
      { game: 'kaipan', ref: 'solo-abcdef', tier: 'mid', amount: 10_000, mode: 'client', at: Date.UTC(2026, 9, 15, 13, 0), until: Date.UTC(2026, 9, 16, 13, 0) },
    ],
  };
  const at = (h: number) => Date.UTC(2026, 9, 16, h);
  const ledger = [
    { at: at(5), t: 'buyin', g: 'texas', a: -20_000 },
    { at: at(4), t: 'settle', g: 'kaipan', a: 12_000, capped: 1_200 },
    { at: at(3), t: 'buyin', g: 'kaipan', a: -2_000 },
    { at: at(2), t: 'relief', a: 1_500 },
    { at: at(1), t: 'grant', a: 10_000 },
  ];
  for (const screen of ['desktop', 'portrait', 'landscape'] as const) {
    console.log(`钱包页和顶栏的筹码牌子（${screen}）`);
    const { ctx, page } = await newPage(browser, `钱包 ${screen}`, screen);
    await mockSession(page, {
      user: { ...FAKE_USER, displayName: '名字有八个字的人' },
      wallet: { wallet, tiers: { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 }, reliefTo: 2_000, playing: { texas: 12, kaipan: 3 }, ledger, week: { kaipan: 9_400, texas: -1_200 } },
    });
    await page.goto(`${BASE}/`);
    const badge = page.getByTestId('wallet-badge');
    await badge.getByText('10,320').waitFor();
    // 0.10.11 大厅提醒：两个游戏有筹码在桌上，指去钱包页
    await page.getByTestId('nudge-stake').getByText('2 个游戏的桌上还有 12,000').waitFor();
    check((await page.getByTestId('nudge-relief').count()) === 0, '钱包加桌上的够多，不该提醒领补给');
    // 0.10.12：最近玩过的排前面（流水里最后碰的是德州），卡片上有本周净赢，这周没玩的没有
    const order = await page.locator('.card__title').evaluateAll((els) => els.map((e) => e.firstChild?.textContent));
    check(order.slice(0, 3).join() === '德州扑克,开盘,掼蛋', `卡片顺序不对：${order.join()}`);
    await page.getByTestId('week-kaipan').getByText('本周 +9,400').waitFor();
    await page.getByTestId('week-texas').getByText('本周 -1,200').waitFor();
    check((await page.getByTestId('week-guandan').count()) === 0, '掼蛋这周没玩，不该有本周净赢');
    // 0.9.9 封面右上角的人数：有人玩的才显示
    await page.getByTestId('playing-texas').getByText('今天 12 人玩过').waitFor();
    await page.getByTestId('playing-kaipan').getByText('今天 3 人玩过').waitFor();
    check((await page.getByTestId('playing-guandan').count()) === 0, '掼蛋今天没人玩，不该有人数牌子');
    const box = (await badge.boundingBox())!;
    const vw = page.viewportSize()!.width;
    check(box.x >= 0 && box.x + box.width <= vw, `筹码牌子出了屏幕：${JSON.stringify(box)}，屏宽 ${vw}`);
    const tops = await page.locator('.topbar .account').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check(new Set(tops).size === 1, `顶栏换行了：${tops}`);
    await shot(page, `wallet-badge-${screen}`);
    await badge.click();
    await page.getByTestId('wallet-balance').getByText('10,320').waitFor();
    await page.getByTestId('relief-why').getByText('钱包加桌上的还有 22,320').waitFor();
    await page.getByTestId('stakes').getByText('回房间点“离开房间”').waitFor();
    await page.getByText('开盘：今天实盘赢了 2,400，还能再赢 3,600。').waitFor();
    // 0.10.10 最近进出
    await page.getByTestId('ledger').locator('.ledger__row', { hasText: '开盘' }).getByText('到顶没进 1,200').waitFor();
    await page.getByTestId('ledger').getByText('+12,000').waitFor();
    await shot(page, `wallet-${screen}`);
    await ctx.close();
  }
  for (const screen of ['desktop', 'portrait'] as const) {
    console.log(`管理筹码的小窗口（${screen}）：查人、加 5,000、确认一次、显示新余额和最近的调整`);
    const { ctx, page } = await newPage(browser, `管理筹码 ${screen}`, screen);
    // 入口只在 /admin 页里（0.9.7，维护者：外面的按钮重复了）；大厅顶栏照旧一行、没有这个按钮
    await mockAdmin(page, { open: false, switchOpen: false, forcedOff: false, updatedAt: null });
    const target = { username: 'xiaoming_2026', displayName: '小明' };
    let recent = [{ ...target, at: Date.UTC(2026, 9, 15, 2, 0), amount: -500, note: '多给了', by: 'owner' }];
    await page.route('**/api/admin/wallet-adjustments', (r) => r.fulfill(json({ recent })));
    await page.route('**/api/admin/wallet/xiaoming_2026', (r) => r.fulfill(json({ user: target, wallet: { ...wallet, balance: 3_200 }, log: [] })));
    await page.route('**/api/admin/wallet/adjust', (r) => {
      recent = [{ ...target, at: Date.UTC(2026, 9, 15, 3, 0), amount: 5_000, note: '同学测试', by: 'owner' }, ...recent];
      return r.fulfill(json({ wallet: { ...wallet, balance: 8_200 }, credited: 5_000 }));
    });
    await page.goto(`${BASE}/`);
    await page.getByTestId('wallet-badge').waitFor();
    const tops = await page.locator('.topbar .account').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check(new Set(tops).size === 1, `管理员的顶栏换行了：${tops}`);
    check((await page.getByTestId('admin-chips-open').count()) === 0, '大厅不该再有"管理筹码"按钮');
    await page.getByRole('link', { name: '管理', exact: true }).click();
    await page.getByTestId('admin-chips-open').click();
    const box = page.getByTestId('admin-chips');
    await box.getByLabel('用户名').fill('xiaoming_2026');
    await box.getByRole('button', { name: '查' }).click();
    await box.getByTestId('admin-chips-balance').getByText('3,200').waitFor();
    await box.getByLabel('数量').fill('5000');
    await box.getByLabel('备注').fill('同学测试');
    const asked = new Promise<string>((res) => page.once('dialog', (d) => (res(d.message()), void d.accept())));
    await box.getByRole('button', { name: '确认' }).click();
    check((await asked) === '给 小明（xiaoming_2026）加 5,000？', `确认的话不对：${await asked}`);
    await box.getByText('加了 5,000，现在余额 8,200').waitFor();
    await box.getByTestId('admin-chips-recent').getByText('同学测试').waitFor();
    await shot(page, `admin-chips-${screen}`);
    await ctx.close();
  }
}

async function serviceStates(browser: Browser): Promise<void> {
  console.log('只读档：写按钮灰掉，云存档标暂停；一个游戏的存档读不到不连累别的');
  {
    const { ctx, page } = await newPage(browser, '只读档');
    // 这一版 /api/me 不带 registration
    await mockSession(page, { me: { service: 'readonly', saves: 'paused', registration: undefined } });
    // 每个登记了的游戏都要模拟：漏一个就是真请求，回 401 会把假登录当成失效。掼蛋那份读不到
    const broken = 'guandan';
    for (const g of GAMES) {
      await page.route(`**/api/saves/${g.id}`, (r) =>
        r.fulfill(g.id === broken ? json({ error: 'internal', message: '服务器出错了，过一会儿再试' }, 500) : json({ saves: [] })),
      );
    }
    expectHttp(500, `/api/saves/${broken}`);
    await page.goto(`${BASE}/me`);
    await page.locator('.banner', { hasText: '服务器有点忙，现在只能看、不能改' }).waitFor();
    await page.getByTestId('saves-paused').waitFor();
    for (const g of GAMES) await page.getByTestId(`saves-${g.id}`).getByText(g.id === broken ? '服务器出错了' : '还没有存档').waitFor();
    for (const [title, button] of [
      ['改昵称', '保存'],
      ['改密码', '改密码'],
      ['换一个恢复码', '换恢复码'],
      ['退出其他设备', '退出其他设备'],
    ] as const) {
      const d = await openFold(page, title);
      check(await d.getByRole('button', { name: button }).isDisabled(), `只读档时"${title}"的按钮应该灰掉`);
    }
    check(!(await page.getByRole('button', { name: '退出登录' }).isDisabled()), '只读档时退出登录照常能点');
    await shot(page, 'readonly');
    await ctx.close();
  }

  console.log('停服档（接口回 busy）：提示休息，不叫人去登录，右上角不放入口');
  {
    const { ctx, page } = await newPage(browser, '停服档');
    await page.route('**/api/me', (r) => r.fulfill(json({ error: 'busy', message: '服务器有点忙，明天再来' }, 503)));
    expectHttp(503, '/api/me');
    await fakeLoginHint(page);
    await page.goto(`${BASE}/me`);
    await page.locator('.banner', { hasText: '账号服务暂时休息' }).waitFor();
    await page.getByText('账号服务暂时休息，过一会儿再来看').waitFor();
    check((await page.getByRole('link', { name: '去登录' }).count()) === 0, '停服档不该叫人去登录');
    check((await page.locator('.account').count()) === 0, '停服档右上角不该有登录入口');
    await shot(page, 'banner-off');
    await ctx.close();
  }

  console.log('连不上：断网、网关回的非 JSON 503 都算"连不上"（不算停服），点"重试"恢复');
  for (const [what, handler, status] of [
    ['断网', (r: Route) => r.abort('internetdisconnected'), 0],
    ['网关出错页', (r: Route) => r.fulfill({ status: 503, contentType: 'text/html', body: '<html><body>error code: 1027</body></html>' }), 503],
  ] as const) {
    const { ctx, page } = await newPage(browser, `连不上（${what}）`);
    await page.route('**/api/me', handler);
    // 网络层面的失败会再试 2 次（session.tsx），一共 3 次
    if (status) for (let i = 0; i < 3; i++) expectHttp(status, '/api/me');
    await fakeLoginHint(page);
    await page.goto(`${BASE}/me`);
    await page.locator('.banner', { hasText: '连不上服务器' }).waitFor();
    check((await page.locator('.banner', { hasText: '账号服务暂时休息' }).count()) === 0, `${what}不该被当成停服`);
    check((await page.getByRole('link', { name: '去登录' }).count()) === 0, `${what}时不该叫人去登录`);
    if (what === '断网') await shot(page, 'unreachable');
    await page.unroute('**/api/me');
    await page.route('**/api/me', (r) => r.fulfill(json({ user: FAKE_USER, service: 'ok', saves: 'ok' })));
    await page.route('**/api/wallet', (r) => r.fulfill(json(FAKE_WALLET)));
    await page.route('**/api/saves/*', (r) => r.fulfill(json({ saves: [] })));
    await page.getByRole('button', { name: '重试' }).click();
    await page.locator('.account__name', { hasText: '某人' }).waitFor();
    await page.getByRole('heading', { name: '我的账号' }).waitFor();
    await ctx.close();
  }
}

// ---------- 主程序 ----------

const state = mkdtempSync(join(tmpdir(), 'arcade-smoke-'));
mkdirSync(OUT, { recursive: true });
// 清掉上一次跑出来的图（只删本脚本起的名字），免得新旧混在一起看错
for (const f of readdirSync(OUT)) {
  if (/^\d{2}-.+\.png$/.test(f) || f === 'recovery-code-image.png') rmSync(join(OUT, f));
}
let server: ChildProcess | null = null;
let browser: Browser | null = null;
let ok = false;
// 被 Ctrl+C 或超时杀掉时也把 wrangler dev 整组收掉，不留占着端口的进程
const killServer = () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // 已经退了
    }
  }
};
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    killServer();
    rmSync(state, { recursive: true, force: true });
    process.exit(130);
  });
}
try {
  await ensurePortFree();
  server = startServer(state);
  await waitForServer();
  // 无头环境常常没有可用的 GPU 进程：GPU 放进浏览器进程里、用软件渲染；环境里设了代理变量时 localhost 也不能走代理
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--no-zygote', '--in-process-gpu'] });
  // npm run smoke -- --only=<名字>：只跑其中一段（改界面时先跑相关的那段）；不带就全跑
  const only: Record<string, (b: Browser) => Promise<void>> = {
    wallet: walletAndSlowNet, // 0.9.2 的钱包页和网络卡住
    chunk: staleChunk, // 发版后分块 404
    next: loginNext, // 登录页的 next
    stats: statsPage, // 战绩页
    boards: boardsPage, // 排行榜
    friends: friendsUx, // 好友分享、点名字看战绩、战绩页加好友
    rules: walletRulesAdmin, // 管理页的钱包规则
    overview: adminOverview, // 管理页的今日概况和账号详情
    notice: lobbyNotice, // 大厅公告
    nudge: lobbyNudge, // 大厅提醒
    sound: lobbySound, // 大厅点按声
  };
  const picked = Object.keys(only).find((k) => process.argv.includes(`--only=${k}`));
  if (picked) await only[picked]!(browser);
  else {
    await anonymous(browser);
    await adminFlow(browser, cli());
    await mobile(browser);
    await serviceStates(browser);
    await walletAndSlowNet(browser);
    await staleChunk(browser);
    await loginNext(browser);
    await statsPage(browser);
    await boardsPage(browser);
    await friendsUx(browser);
    await walletRulesAdmin(browser);
    await adminOverview(browser);
    await lobbyNotice(browser);
    await lobbyNudge(browser);
    await lobbySound(browser);
  }
  for (const e of expected) problems.push(`说好会出现、却没出现的 ${e.status}：${e.path}`);
  ok = problems.length === 0;
} catch (e) {
  problems.push(e instanceof Error ? (e.stack ?? e.message) : String(e));
} finally {
  await browser?.close();
  killServer();
  rmSync(state, { recursive: true, force: true });
}
if (!ok) {
  console.error(`\n冒烟失败（${problems.length} 条）：`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`\n冒烟通过：控制台零报错、CSP 没拦任何东西，截图 ${shotNo} 张在 ${OUT}`);
