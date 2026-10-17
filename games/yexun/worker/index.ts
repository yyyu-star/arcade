/**
 * 夜巡的 Worker（DESIGN.md 5.6）。两种部署由 env 决定（共用包 0.10 起）：
 * - 本站：部署工具按 tools/workers.json 补上平台绑定 ARCADE（认人）、WALLET（钱包）和 GATE=login；
 * - 单独部署（wrangler.jsonc 原样）：没有平台，谁打开都能玩，站点根 / 转到 /games/yexun/。
 * 首页三种写法过共用包的登录闸门 loginGate：登录了放行，没登录 302 到平台登录页，平台不可用回 503 页。
 * 实盘的带入、结回走 /games/yexun/api/live/*（./live.ts），不看 GATE、总要认人。入口模块只导出 default（具名导出会让单独部署的 Worker 起不来）。
 */
import { loginGate, standaloneRoot, type GateEnv } from 'arcade-kit/worker';
import { LIVE_PREFIX, handleLive, type LiveEnv } from './live.ts';

const GAME = 'yexun';
const BASE = `/games/${GAME}`;

/** 平台不可用时的 503 页：夜巡自己的标题和配色 */
const DOWN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>夜巡</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1c2230;color:#f6efdc;font:16px/1.6 system-ui,sans-serif;text-align:center}a{color:#f2c94c}</style></head>
<body><main><h1>平台暂时连不上</h1><p>稍等一会儿再刷新试试。</p><p><a href="/">回大厅</a></p></main></body></html>`;

export default {
  async fetch(request: Request, env: GateEnv & LiveEnv): Promise<Response> {
    const root = standaloneRoot(request, env, GAME);
    if (root) return root;
    const path = new URL(request.url).pathname;
    if (path.startsWith(LIVE_PREFIX)) return handleLive(request, env);
    if (path === BASE) return Response.redirect(new URL(`${BASE}/`, request.url).toString(), 301);
    if (path === `${BASE}/` || path === `${BASE}/index.html`) return loginGate(request, env, { downPage: DOWN_PAGE });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<GateEnv & LiveEnv>;
