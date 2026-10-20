/**
 * 在真的 workerd 上核实自托管依赖的行为（实测项，结论汇总在 docs/verify.md）：
 * 绑定（变量、Secret、带 props 的 RPC）、D1 后端的语义、DO 存储和闹钟跨重启、WebSocket 休眠和自动应答、定时任务、备份恢复、内存存储。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureSite, startSite, type Running } from './harness.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;

describe('sqlite 存储', () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSite(fixtureSite(), {}, { PROBE_SECRET: 's3cret' });
  });
  afterAll(async () => s?.cleanup());

  const p = (path: string, init?: RequestInit) => fetch(`${s.base}/games/probe${path}`, init);
  const d1 = (op: string) => json(p('/d1', { method: 'POST', body: JSON.stringify({ op }) }));

  it('路由：游戏的两条路由给游戏，其余给兜底，/cdn-cgi 挡掉', async () => {
    expect((await p('/nope')).status).toBe(404);
    expect(await (await fetch(`${s.base}/games/probex`)).text()).toBe('worker /games/probex');
    expect((await fetch(`${s.base}/cdn-cgi/trace`)).status).toBe(404);
  });

  it('变量和 Secret：字符串是 text、对象是 json、中文走 embed，Secret 从环境变量取', async () => {
    expect(await json(p('/env'))).toEqual({ secret: 's3cret', text: 'plain', obj: { a: 1, nested: { b: [1, 2] } }, cn: '中文变量' });
  });

  it('带 props 的服务绑定 RPC（钱包 WalletService 的 props.game 就是这样传的）', async () => {
    expect(await json(p('/rpc'))).toEqual({ x: 'x', props: { game: 'probe' } });
  });

  it('D1：迁移跑过、写入的 meta、raw、BLOB、exec 多行', async () => {
    // rows_written 和 miniflare 一样取 DO 游标的计数：表一行 + 两个索引 + sqlite_sequence = 4（平台按写入行数做的测试和预算在两边一致）
    expect(await d1('insert')).toEqual({ changes: 1, last: 1, written: 4 });
    expect(await d1('raw')).toEqual([['id', 'name'], [1, 'a']]);
    expect(await d1('blob')).toEqual({ data: [1, 2, 255] });
    const exec = await d1('exec');
    expect(exec.count).toBe(2);
    expect(await d1('count')).toEqual({ n: 4 });
  });

  it('D1：batch 里一条出错整体回滚，错误原文和 D1 一样', async () => {
    const before = (await d1('count')).n;
    expect((await d1('batch-fail')).error).toMatch(/^D1_ERROR: no such table: nope/);
    expect((await d1('count')).n).toBe(before);
    expect((await d1('unique')).error).toMatch(/UNIQUE constraint failed: items\.name/);
  });

  it('DO：SQL 和键值存储、locationHint 被忽略', async () => {
    expect(await json(p('/do/a/sql?v=5'))).toEqual({ n: 1, s: 5 });
    await p('/do/a/kv?v=hello', { method: 'POST' });
    expect(await json(p('/do/a/kv'))).toEqual({ v: 'hello' });
  });

  it('WebSocket：自动应答 ping、休眠后收到消息会重建对象、连接不断', async () => {
    const ws = new WebSocket(`${s.base.replace('http', 'ws')}/games/probe/do/ws1/ws`);
    const msgs: string[] = [];
    ws.onmessage = (e) => msgs.push(String(e.data));
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    ws.send('ping');
    ws.send('hi');
    await sleep(300);
    expect(msgs[0]).toBe('pong');
    const first = JSON.parse(msgs[1]!);
    expect(first.echo).toBe('hi');
    // workerd：没有请求 10 秒后对象被驱逐（休眠的连接留着），再来消息时重新构造
    await sleep(12_000);
    ws.send('ping');
    ws.send('again');
    await sleep(300);
    expect(msgs[2]).toBe('pong');
    const second = JSON.parse(msgs[3]!);
    expect(second.echo).toBe('again');
    expect(second.born).toBeGreaterThan(first.born);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  }, 20_000);

  it('定时任务：管理入口手动投一次，类写法的默认入口（scheduled 是实例字段）收到 cron、ctx.waitUntil 做完', async () => {
    const r = await json(fetch(`${s.admin}/cron/run?worker=probe&cron=${encodeURIComponent('17 19 * * *')}`, { method: 'POST' }));
    expect(r).toEqual({ outcome: 'ok' });
    expect(await d1('ticks')).toEqual([{ cron: '17 19 * * *' }]);
    expect((await fetch(`${s.admin}/cron/run?worker=probe&cron=x`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${s.admin}/cron/run?worker=nope&cron=x`, { method: 'POST' })).status).toBe(404);
    // 平台靠这一点防游戏自己触发清理：经服务绑定还是 RPC 调不到 scheduled
    expect((await json(p('/rpc-scheduled'))).reachable).toBe(false);
  });

  it('定时任务：闹钟自己到点投（对象写法的默认入口，每分钟一次）', async () => {
    const deadline = Date.now() + 65_000;
    while (!/home tick \* \* \* \* \* \d+/.test(s.log()) && Date.now() < deadline) await sleep(1_000);
    expect(s.log()).toMatch(/home tick \* \* \* \* \* \d+/);
  }, 70_000);

  it('备份恢复：导出 → 改动 → 导入，库回到导出时的样子（含迁移记录）', async () => {
    const dump = await (await fetch(`${s.admin}/d1/d1-probe-DB/export`)).text();
    expect(dump).toContain('INSERT INTO "d1_migrations"');
    const before = (await d1('count')).n;
    await d1('add');
    expect((await d1('count')).n).toBe(before + 1);
    const imp = await json(fetch(`${s.admin}/d1/d1-probe-DB/import`, { method: 'POST', body: dump }));
    expect(imp.ok).toBe(true);
    expect((await d1('count')).n).toBe(before);
    expect(await (await fetch(`${s.admin}/d1/d1-probe-DB/export`)).text()).toBe(dump);
    // 坏的导入整体回滚
    const bad = await json(fetch(`${s.admin}/d1/d1-probe-DB/import`, { method: 'POST', body: `${dump}INSERT INTO nope VALUES (1);\n` }));
    expect(bad.ok).toBe(false);
    expect((await d1('count')).n).toBe(before);
  });

  it('重启：D1、DO 的数据都在，迁移不重跑，没响的闹钟重启后照响', async () => {
    const count = (await d1('count')).n;
    await p('/do/al/alarm?ms=1500');
    await s.restart();
    expect((await d1('count')).n).toBe(count);
    expect(await json(p('/do/a/kv'))).toEqual({ v: 'hello' });
    expect(s.log().split('0001_items.sql').length - 1).toBe(1);
    // 停机期间到点的闹钟：起来后立刻补响
    await sleep(2_500);
    const fired = await json(p('/do/al/alarm-fired'));
    expect(fired.fired).toBeGreaterThan(0);
    expect(fired.alarm).toBeNull();
  }, 20_000);

});

describe('memory 存储（PostgreSQL 模式的底子：不留任何 SQLite 文件）', () => {
  let s: Running;
  beforeAll(async () => {
    // 内存存储下 SQLite 版的 D1 不许用（生成器拦），这里只看 DO：把 D1 去掉
    const site = fixtureSite();
    site.workers[0]!.d1_databases = [];
    s = await startSite(site, { storage: 'memory' }, { PROBE_SECRET: 'x' });
  });
  afterAll(async () => s?.cleanup());
  const p = (path: string, init?: RequestInit) => fetch(`${s.base}/games/probe${path}`, init);

  it('storage.sql 不可用（这一版 workerd 的内存存储不带 SQLite），键值存储和闹钟可用，重启后全部清空', async () => {
    const sql = await p('/do/m/sql?v=1');
    expect(sql.status).toBe(500);
    expect(s.log()).toContain('not backed by SQLite storage');
    await p('/do/m/kv?v=mem', { method: 'POST' });
    expect(await json(p('/do/m/kv'))).toEqual({ v: 'mem' });
    await p('/do/m/alarm?ms=300');
    await sleep(1_000);
    expect((await json(p('/do/m/alarm-fired'))).fired).toBeGreaterThan(0);
    await s.restart();
    expect(await json(p('/do/m/kv'))).toEqual({ v: null });
  });
});
