#!/usr/bin/env node
/**
 * 自托管的全站冒烟（不用浏览器，只发 HTTP 和 WebSocket）：起好的站点上走一遍主流程，任何一步不对就非零退出。
 *   1. /__health、平台首页（带 _headers 里的 CSP）、游戏首页的登录闸门、/cdn-cgi 挡掉；
 *   2. 管理令牌建两个号（平台 /api/admin/users），各自登录拿会话，/api/me 认得；
 *   3. 德州单机：带入 400 → 钱包少 400；结回 500 → 钱包多 500（WALLET 服务绑定 + props.game 的 RPC）；
 *   4. 德州好友房：A 开房，A、B 各连一条 WebSocket，都收到 welcome（ARCADE 认人、DO、WebSocket 休眠接口）；
 *   5. 管理入口手动投一次平台的定时清理，结果是 ok；导出平台库，里面有刚建的号（PG 模式不经管理入口导出，回 501，备份用 pg_dump）。
 * 用法：ADMIN_TOKEN=… node tools/selfhost/smoke.mjs --base http://127.0.0.1:8787 --admin http://127.0.0.1:8788
 * Docker 里管理入口只听容器内的 127.0.0.1，宿主连不到：--admin skip 跳过第 5 步，由 selfhost.yml 用 docker exec 在容器里做。
 * 只认 tools/workers.json 里本仓库的平台和德州：别的游戏起没起都不影响。
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: { base: { type: 'string', default: 'http://127.0.0.1:8787' }, admin: { type: 'string', default: 'http://127.0.0.1:8788' } },
});
const base = args.base.replace(/\/$/, '');
const admin = args.admin.replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error('smoke：要 ADMIN_TOKEN 环境变量（和站点的 Secret 同一个值）');
  process.exit(1);
}

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const check = (cond, msg, detail) => {
  if (!cond) {
    console.error(`  ✗ ${msg}${detail === undefined ? '' : `：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    process.exit(1);
  }
};
const write = { 'x-arcade': '1', origin: base, 'content-type': 'application/json' };
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
const body = async (res) => {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

// 1. 静态和路由
{
  const h = await get('/__health');
  check(h.status === 200, '/__health 不是 200', h.status);
  const home = await get('/');
  check(home.status === 200 && (home.headers.get('content-type') ?? '').startsWith('text/html'), '平台首页', home.status);
  check((home.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), '平台首页没有 _headers 里的 CSP');
  const spa = await get('/login', { headers: { 'sec-fetch-mode': 'navigate' } });
  check(spa.status === 200, '/login 单页回退', spa.status);
  const gate = await get('/games/texas/');
  check(gate.status === 302 && (gate.headers.get('location') ?? '').includes('/login?next='), '德州首页没登录应 302 到登录', gate.status);
  const nope = await get('/games/nope');
  check(nope.status === 404, '没有的游戏应 404', nope.status);
  const cdn = await get('/cdn-cgi/trace');
  check(cdn.status === 404, '/cdn-cgi 应挡掉', cdn.status);
  ok('健康检查、平台首页和 CSP、单页回退、德州登录闸门、404、/cdn-cgi');
}

// 2. 建号、登录
async function account(tag) {
  const username = `smoke${tag}${randomBytes(3).toString('hex')}`;
  const r = await fetch(`${base}/api/admin/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: `冒烟${tag}` }),
  });
  const made = await body(r);
  check(r.ok && made.password, `建号 ${username}`, made);
  const login = await get('/api/auth/login', { method: 'POST', headers: write, body: JSON.stringify({ username, password: made.password }) });
  check(login.ok, `登录 ${username}`, await body(login));
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const me = await body(await get('/api/me', { headers: { cookie } }));
  check(me.user?.username === username, '/api/me 认不出刚登录的人', me);
  return { username, cookie, userId: me.user.userId ?? me.user.id };
}
const a = await account('a');
const b = await account('b');
ok(`管理令牌建号、登录、/api/me（${a.username}、${b.username}）`);

// 3. 单机带入、结回
{
  const balance = async () => {
    const w = await body(await get('/api/wallet', { headers: { cookie: a.cookie } }));
    check(typeof w.wallet?.balance === 'number', '/api/wallet 没有余额', w);
    return w.wallet.balance;
  };
  const before = await balance();
  const session = `s${randomBytes(8).toString('hex')}`;
  const post = (sub, payload) =>
    get(`/games/texas/api/solo/${sub}`, { method: 'POST', headers: { ...write, cookie: a.cookie }, body: JSON.stringify(payload) });
  const bi = await post('buyin', { op: `b${randomBytes(8).toString('hex')}`, session, stakes: 'small', amount: 400 });
  check(bi.ok, '德州单机带入', await body(bi));
  check((await balance()) === before - 400, '带入后钱包应少 400');
  const co = await post('cashout', { op: `c${randomBytes(8).toString('hex')}`, session, amount: 500 });
  check(co.ok, '德州单机结回', await body(co));
  check((await balance()) === before + 100, '结回后钱包应比开始多 100');
  ok(`德州单机带入 400、结回 500，钱包 ${before} → ${before + 100}（WALLET 的 RPC）`);
}

// 4. 好友房
{
  const r = await get('/games/texas/rooms', { method: 'POST', headers: { ...write, cookie: a.cookie }, body: JSON.stringify({ opts: { stakes: 'small', size: 6, fun: true } }) });
  const created = await body(r);
  check(r.status === 201 && created.code, '德州开房', created);
  const welcome = (who) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/games/texas/rooms/${created.code}/ws`, {
        headers: { cookie: who.cookie, origin: base },
      });
      const timer = setTimeout(() => reject(new Error(`${who.username} 10 秒没收到 welcome`)), 10_000);
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === 'welcome') {
          clearTimeout(timer);
          resolve(ws);
        } else if (m.t === 'error') reject(new Error(`${who.username} 进房被拒：${JSON.stringify(m)}`));
      };
      ws.onerror = () => reject(new Error(`${who.username} 的 WebSocket 连不上`));
    });
  try {
    const sockets = await Promise.all([welcome(a), welcome(b)]);
    for (const ws of sockets) ws.close();
  } catch (e) {
    check(false, '进房', e.message);
  }
  ok(`德州开房 ${created.code}，两人 WebSocket 进房收到 welcome`);
}

// 5. 定时任务、导出
if (admin === 'skip') {
  console.log('  - 5. 管理入口跳过（--admin skip）');
} else {
  const r = await fetch(`${admin}/cron/run?worker=arcade&cron=${encodeURIComponent('17 19 * * *')}`, { method: 'POST' });
  const out = await body(r);
  check(r.ok && out.outcome === 'ok', '手动投平台的定时清理', out);
  const ex = await fetch(`${admin}/d1/d1-arcade-DB/export`);
  if (ex.status === 501) {
    await ex.body?.cancel();
    ok('平台定时清理 outcome=ok；PG 模式，平台库不经管理入口导出');
  } else {
    const dump = await ex.text();
    check(dump.includes(a.username) && dump.includes('d1_migrations'), '导出的平台库里没有刚建的号');
    ok(`平台定时清理 outcome=ok；导出平台库 ${dump.split('\n').length} 行`);
  }
}
console.log('selfhost smoke：全部通过');
