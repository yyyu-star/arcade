/**
 * 平台巡检用的 GET /games/yexun/health：回 ok 和版本。在登录闸门之前、不读存储、不问平台，单独部署时也能访问。
 * 单独一个模块：入口 index.ts 只能导出 default，测试从这里引。
 */
import pkg from '../package.json' with { type: 'json' };

export const HEALTH_PATH = '/games/yexun/health';

/** 是巡检请求就回答，不是回 null 交给后面的路由 */
export function health(request: Request, path: string): Response | null {
  if (path !== HEALTH_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  return Response.json({ ok: true, version: pkg.version }, { headers: { 'Cache-Control': 'no-store' } });
}
