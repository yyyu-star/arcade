/**
 * 定时任务：Cloudflare 按 wrangler.jsonc 的 triggers.crons 调 Worker 的 scheduled()；workerd 没有这个调度器，
 * 这里用一个 Durable Object 的闹钟代替：闹钟响了，把这一分钟该跑的 cron 经服务绑定的 Fetcher.scheduled() 投给对应的 Worker
 * （和 Cloudflare 投的是同一种事件，Worker 那边不用改），再定下一次。闹钟存在 DO 的存储里，重启后照样在；
 * 停机错过的那次在重启后补跑一次（闹钟过期会立刻响），平台的每日清理补跑没有副作用。
 * 全是 UTC，和 Cloudflare 一样。
 */
import { DurableObject } from 'cloudflare:workers';
import { nextFire, parseCron } from './cron-expr';

export interface CronEnv {
  /** [[服务绑定名, cron 表达式], ...] */
  CRONS: [string, string][];
  [binding: string]: unknown;
}

/** 开了 service_binding_extra_handlers 的 Fetcher 有 scheduled()（投的是真的 scheduled 事件，不是 RPC），workers-types 里没写 */
interface ScheduledFetcher {
  scheduled(options: { scheduledTime?: Date; cron?: string }): Promise<{ outcome: string; noRetry: boolean }>;
}

export default {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
};

export class Cron extends DurableObject<CronEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ensure') {
      if ((await this.ctx.storage.getAlarm()) === null) await this.schedule(Date.now());
      return new Response('ok');
    }
    if (url.pathname === '/run') {
      // 管理入口的手动触发：只投指定的那一条，不动闹钟和"上次跑过"的记录
      const worker = url.searchParams.get('worker');
      const cron = url.searchParams.get('cron');
      if (!this.env.CRONS.some(([w, c]) => w === worker && c === cron)) return new Response('没有这条定时任务\n', { status: 404 });
      const outcome = await this.fire(worker!, cron!, Date.now());
      return Response.json({ outcome });
    }
    return new Response(null, { status: 404 });
  }

  private async fire(binding: string, cron: string, at: number): Promise<string> {
    try {
      const r = await (this.env[binding] as ScheduledFetcher).scheduled({ scheduledTime: new Date(at), cron });
      console.log(JSON.stringify({ msg: 'cron', binding, cron, outcome: r.outcome }));
      return r.outcome;
    } catch (e) {
      console.error(JSON.stringify({ msg: 'cron failed', binding, cron, error: e instanceof Error ? e.message : String(e) }));
      return 'exception';
    }
  }

  override async alarm(): Promise<void> {
    // 闹钟定在整分钟；晚响（停机、重启）时，上次跑过之后到现在之间该跑的每个 cron 补跑一次
    const at = Math.floor(Date.now() / 60_000) * 60_000;
    const last = (await this.ctx.storage.get<number>('last')) ?? at - 60_000;
    const due = this.env.CRONS.filter(([, expr]) => nextFire(parseCron(expr), last + 60_000) <= at);
    await Promise.all(due.map(([binding, cron]) => this.fire(binding, cron, at)));
    await this.ctx.storage.put('last', at);
    await this.schedule(at + 60_000);
  }

  private async schedule(from: number): Promise<void> {
    const next = Math.min(...this.env.CRONS.map(([, expr]) => nextFire(parseCron(expr), from)));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
