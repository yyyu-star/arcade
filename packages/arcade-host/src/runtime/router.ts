/**
 * 站点入口：Cloudflare 上"按路由把请求分给哪个 Worker"的那一层。规则由生成器从部署工具的约定生成：
 * 游戏挂 /games/<id> 和 /games/<id>/*（tools/deployer 部署时注入的就是这两条路由），其余都给平台。
 * 分到的是模块的静态资源层（assets.ts 的默认入口），由它再按 run_worker_first 决定给 Worker 还是回文件。
 *
 * 另外三件 Cloudflare 本来替我们做、这里要自己做的事：
 *   - /__health：给 systemd、Docker、Caddy 探活，顺手确认各 Worker 定时任务的闹钟挂上了；
 *   - /cdn-cgi/*：Cloudflare 的保留路径，这里没有对应的东西，一律 404（Caddy 前面也挡一次）；
 *   - 真实 IP：平台和 kit 认 cf-connecting-ip。workerd 只听 127.0.0.1（或容器内网），这个头由前面的 Caddy 用真实地址覆盖，
 *     这里不再改它（Caddyfile 模板里写了，换别的反代要照做）。
 */
export interface RouterEnv {
  /** [[路径规则, 服务绑定名], ...]，按顺序匹配；规则只有两种：精确路径、以 /* 结尾的前缀 */
  ROUTES: [string, string][];
  /** 没匹配上的给谁（平台） */
  FALLBACK: string;
  /** 有定时任务的 Worker；每个一个 DO 绑定 cron:<名>（cron-entry.ts 的 ArcadeHostCron） */
  CRON_WORKERS: string[];
  /** PG 模式才有：起来后第一次请求时唤醒存了闹钟的房间（kitstore.ts） */
  KITSTORE?: Fetcher;
  [binding: string]: unknown;
}

let cronReady = false;
let kitWoken = false;

export default {
  async fetch(request: Request, env: RouterEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!cronReady) ctx.waitUntil(ensureCron(env));
    if (!kitWoken && env.KITSTORE) {
      kitWoken = true;
      ctx.waitUntil(wakeRooms(env.KITSTORE));
    }
    if (path === '/__health') {
      await ensureCron(env);
      return new Response('ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (path === '/cdn-cgi' || path.startsWith('/cdn-cgi/')) return new Response(null, { status: 404 });
    return (env[pick(env.ROUTES, path) ?? env.FALLBACK] as Fetcher).fetch(request);
  },
};

export function pick(routes: [string, string][], path: string): string | null {
  for (const [rule, service] of routes) {
    if (rule.endsWith('/*') ? path.startsWith(rule.slice(0, -1)) : path === rule) return service;
  }
  return null;
}

/** 重启后唤醒一次；失败了下一个请求再试 */
async function wakeRooms(kit: Fetcher): Promise<void> {
  try {
    const res = await kit.fetch('http://kitstore/wake', { method: 'POST' });
    if (!res.ok) kitWoken = false;
  } catch {
    kitWoken = false;
  }
}

/** 每个定时任务对象确认闹钟挂上了（第一次起来时没有闹钟）；一个 isolate 成功一次就不再问 */
async function ensureCron(env: RouterEnv): Promise<void> {
  const results = await Promise.all(
    env.CRON_WORKERS.map(async (w) => {
      const ns = env[`cron:${w}`] as DurableObjectNamespace;
      return (await ns.get(ns.idFromName('cron')).fetch('http://cron/ensure', { method: 'POST' })).ok;
    }),
  );
  if (results.every(Boolean)) cronReady = true;
}
