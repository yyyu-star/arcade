/**
 * 内部管理入口：单独一个监听（默认 127.0.0.1:8788），不在站点路由上，Caddy 也不转发。只给本机的运维脚本用：
 *   GET  /d1                          有哪些库（服务名）
 *   GET  /d1/<服务名>/export          整库导出成 SQL（备份）
 *   POST /d1/<服务名>/import          用导出的 SQL 整库替换（恢复；先清空再导入，一个事务，失败原样不动）
 *   POST /cron/run?worker=<名>&cron=<表达式>   立刻投一次定时任务（冒烟、补跑）
 * 没有认证：只许听回环地址（生成器和启动脚本都会拦），容器里也只听容器内的 127.0.0.1，用 docker exec 进去调；
 * 能连上这个端口的人本来就在这台机器（这个容器）里，能直接读数据目录。
 */
export interface AdminEnv {
  /** 库的服务名列表；每个库一个同名的 DO 绑定 */
  D1_LIST: string[];
  /** 有定时任务的 Worker；每个一个 DO 绑定 cron:<名> */
  CRON_WORKERS: string[];
  [binding: string]: unknown;
}

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'd1') {
      if (parts.length === 1 && request.method === 'GET') return Response.json(env.D1_LIST);
      const name = parts[1];
      if (!name || !env.D1_LIST.includes(name)) return new Response('没有这个库\n', { status: 404 });
      const ns = env[name] as DurableObjectNamespace;
      const stub = ns.get(ns.idFromName('db'));
      if (parts[2] === 'export' && request.method === 'GET') return stub.fetch(`http://d1/__export${url.search}`, { method: 'POST' });
      if (parts[2] === 'import' && request.method === 'POST') return stub.fetch('http://d1/__import', { method: 'POST', body: request.body });
    }
    if (parts[0] === 'cron' && parts[1] === 'run' && request.method === 'POST') {
      const worker = url.searchParams.get('worker') ?? '';
      if (!env.CRON_WORKERS.includes(worker)) return new Response('没有这条定时任务\n', { status: 404 });
      const ns = env[`cron:${worker}`] as DurableObjectNamespace;
      return ns.get(ns.idFromName('cron')).fetch(`http://cron/run${url.search}`, { method: 'POST' });
    }
    return new Response('not found\n', { status: 404 });
  },
};
