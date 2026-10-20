// 测试用的 Worker：把 workerd 上要核实的行为各开一个接口（test/runtime.test.ts 调）。不是真站点的代码。
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

export class Probe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.born = Date.now();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/sql') {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS t (v INTEGER)');
      this.ctx.storage.sql.exec('INSERT INTO t VALUES (?)', Number(url.searchParams.get('v') ?? 1));
      return Response.json(this.ctx.storage.sql.exec('SELECT count(*) AS n, sum(v) AS s FROM t').one());
    }
    if (url.pathname === '/kv') {
      if (request.method === 'POST') await this.ctx.storage.put('k', url.searchParams.get('v'));
      return Response.json({ v: (await this.ctx.storage.get('k')) ?? null });
    }
    if (url.pathname === '/alarm') {
      await this.ctx.storage.setAlarm(Date.now() + Number(url.searchParams.get('ms')));
      return Response.json({ set: true });
    }
    if (url.pathname === '/alarm-fired') {
      return Response.json({ fired: (await this.ctx.storage.get('fired')) ?? null, alarm: await this.ctx.storage.getAlarm() });
    }
    return new Response('no', { status: 404 });
  }
  async alarm() {
    await this.ctx.storage.put('fired', Date.now());
  }
  webSocketMessage(ws, msg) {
    ws.send(JSON.stringify({ echo: String(msg), born: this.born }));
  }
}

// 默认入口和平台一样是 WorkerEntrypoint 类，scheduled 写成实例字段（RPC 调不到，只能由运行时投）
export default class Probe2 extends WorkerEntrypoint {
  async fetch(request) {
    const env = this.env;
    const url = new URL(request.url);
    const sub = url.pathname.replace(/^\/games\/probe/, '');
    if (sub.startsWith('/do/')) {
      const [, , name, ...rest] = sub.split('/');
      const stub = env.PROBE.get(env.PROBE.idFromName(name), { locationHint: 'apac' });
      return stub.fetch(new Request(`http://do/${rest.join('/')}${url.search}`, request));
    }
    if (sub === '/d1') {
      const { op } = await request.json();
      return Response.json(await d1(env.DB, op));
    }
    if (sub === '/env') return Response.json({ secret: env.PROBE_SECRET, text: env.TEXT, obj: env.OBJ, cn: env.CN });
    if (sub === '/rpc') return Response.json(await env.SELF_RPC.hello('x'));
    if (sub === '/rpc-scheduled') {
      try {
        await env.SELF_DEFAULT.scheduled({});
        return Response.json({ reachable: true });
      } catch (e) {
        return Response.json({ reachable: false, error: e.message });
      }
    }
    return new Response('probe', { status: 404 });
  }

  scheduled = async (controller) => {
    // 和平台一样经 ctx.waitUntil 干活：运行时要等它做完
    this.ctx.waitUntil(this.env.DB.prepare('INSERT INTO ticks (cron, at) VALUES (?, ?)').bind(controller.cron, controller.scheduledTime).run());
  };
}

export class Hello extends WorkerEntrypoint {
  hello(x) {
    return { x, props: this.ctx.props };
  }
}

async function d1(db, op) {
  try {
    switch (op) {
      case 'insert': {
        const r = await db.prepare('INSERT INTO items (name) VALUES (?1)').bind('a').run();
        return { changes: r.meta.changes, last: r.meta.last_row_id, written: r.meta.rows_written };
      }
      case 'batch-fail': {
        await db.batch([db.prepare("INSERT INTO items (name) VALUES ('b')"), db.prepare('INSERT INTO nope VALUES (1)')]);
        return { ok: true };
      }
      case 'add':
        return (await db.prepare('INSERT INTO items (name) VALUES (?)').bind(crypto.randomUUID()).run()).meta;
      case 'count':
        return await db.prepare('SELECT count(*) AS n FROM items').first();
      case 'raw':
        return await db.prepare('SELECT id, name FROM items ORDER BY id').raw({ columnNames: true });
      case 'blob': {
        await db.prepare('INSERT INTO items (name, data) VALUES (?, ?)').bind('blob', new Uint8Array([1, 2, 255])).run();
        const row = await db.prepare("SELECT data FROM items WHERE name = 'blob'").first();
        return { data: Array.from(row.data) };
      }
      case 'unique': {
        await db.prepare("INSERT INTO items (name) VALUES ('dup')").run();
        await db.prepare("INSERT INTO items (name) VALUES ('dup')").run();
        return { ok: true };
      }
      case 'exec':
        return await db.exec("INSERT INTO items (name) VALUES ('e1');\nINSERT INTO items (name) VALUES ('e2');");
      case 'ticks':
        return (await db.prepare('SELECT cron FROM ticks').all()).results;
    }
  } catch (e) {
    return { error: e.message };
  }
}
