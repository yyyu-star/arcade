/**
 * 定时任务：Cloudflare 按 wrangler.jsonc 的 triggers.crons 调 Worker 的 scheduled()；workerd 没有这个调度器。
 * 生成器把这个文件放成"有 crons 的 Worker"的主模块：原样转出模块自己的全部导出（./main.js，默认入口不变，服务绑定照旧指向它），
 * 再多导出一个 Durable Object ArcadeHostCron：它的闹钟到点时，在同一个 Worker 里把模块的默认入口实例化（类）或直接拿来（对象），
 * 调它的 scheduled，和 Cloudflare 投的是同一种调用，Worker 那边不用改。
 *
 * 为什么不经服务绑定投：服务绑定上的 scheduled() 默认是 RPC，平台故意不让 RPC 调到 scheduled（platform/worker/index.ts）；
 * 要投真的 scheduled 事件得开实验开关 service_binding_extra_handlers、workerd 带 --experimental 起。在 Worker 里面直接调就都不用。
 *
 * 闹钟存在这个 DO 的存储里，重启后照样在；停机错过的那次，起来后补跑一次（平台的每日清理补跑没有副作用）。全是 UTC，和 Cloudflare 一样。
 */
import { DurableObject } from 'cloudflare:workers';
// 这两个模块由生成器放在同一个 Worker 里（打包时当外部模块，类型见同目录的 .d.ts）
import * as user from './main.js';
import crons from './arcade-host-crons.js';
import { nextFire, parseCron } from './cron-expr';

export * from './main.js';
export { default } from './main.js';

type Handler = { scheduled?: (controller: ScheduledController, env: unknown, ctx: ExecutionContext) => unknown };
type HandlerClass = new (ctx: ExecutionContext, env: unknown) => { scheduled?: (controller: ScheduledController) => unknown };

export class ArcadeHostCron extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ensure') {
      if ((await this.ctx.storage.getAlarm()) === null) await this.schedule(Date.now());
      return new Response('ok');
    }
    if (url.pathname === '/run') {
      // 管理入口的手动触发：只投指定的那一条，不动闹钟和"上次跑过"的记录
      const cron = url.searchParams.get('cron');
      if (!cron || !crons.includes(cron)) return new Response('没有这条定时任务\n', { status: 404 });
      return Response.json({ outcome: await this.fire(cron, Date.now()) });
    }
    return new Response(null, { status: 404 });
  }

  override async alarm(): Promise<void> {
    // 闹钟定在整分钟；晚响（停机、重启）时，上次跑过之后到现在之间该跑的每个 cron 补跑一次
    const at = Math.floor(Date.now() / 60_000) * 60_000;
    const last = (await this.ctx.storage.get<number>('last')) ?? at - 60_000;
    for (const cron of crons.filter((expr) => nextFire(parseCron(expr), last + 60_000) <= at)) await this.fire(cron, at);
    await this.ctx.storage.put('last', at);
    await this.schedule(at + 60_000);
  }

  /** 照 Cloudflare 的样子调一次 scheduled：ctx.waitUntil 收下的都等完才算结束；抛错只记日志，不往外抛（闹钟不重试） */
  private async fire(cron: string, at: number): Promise<string> {
    const waits: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const controller = { scheduledTime: at, cron, type: 'scheduled', noRetry: () => {} } as unknown as ScheduledController;
    try {
      const entry = user.default;
      if (typeof entry === 'function') {
        const instance = new (entry as HandlerClass)(ctx, this.env);
        if (typeof instance.scheduled !== 'function') throw new Error('默认入口没有 scheduled');
        await instance.scheduled(controller);
      } else {
        const handler = entry as Handler;
        if (typeof handler?.scheduled !== 'function') throw new Error('默认入口没有 scheduled');
        await handler.scheduled(controller, this.env, ctx);
      }
      await Promise.all(waits);
      console.log(JSON.stringify({ msg: 'cron', cron, outcome: 'ok' }));
      return 'ok';
    } catch (e) {
      console.error(JSON.stringify({ msg: 'cron failed', cron, error: e instanceof Error ? e.message : String(e) }));
      return 'exception';
    }
  }

  private async schedule(from: number): Promise<void> {
    const next = Math.min(...crons.map((expr) => nextFire(parseCron(expr), from)));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
