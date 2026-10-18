/// <reference types="@cloudflare/workers-types" />
/**
 * 掼蛋 Worker 的请求处理（worker/index.ts 的全部逻辑，单独成文件好测试）：登录闸门 + 联机房间的开房、进房两个路由。
 * 部署入口是 worker/main.ts（默认导出 + 房间类 Room），这里只放普通函数和常量。单机实盘的接口 /games/guandan/api/stake/* 在 stake.ts。
 *
 * 两种部署（kit 0.10，由 env 决定）：本站有平台绑定 ARCADE、WALLET 和 GATE=login（部署工具按 tools/workers.json 补的），认平台的账号；
 * 单独部署（wrangler.jsonc 原样）没有平台：首页和开房发游客 cookie，站点根 / 转到 /games/guandan/，没有钱包，实盘一律回 409 no_wallet。
 *
 * 登录闸门只管首页。静态资源仍由 Workers 静态资源直接返回，只有首页导航的三个路径和房间接口 /games/guandan/room/*
 * （wrangler.jsonc 的 assets.run_worker_first）先经过这里，js、图片不经过、不多花请求额度。
 *
 * 首页的闸门用 arcade-kit 的 loginGate（0.6.5 起，原来自己写的一份和它做法相同）：
 * GATE = "off"：原样交给静态资源。其他值（包括没配）都要登录：经服务绑定 ARCADE 问平台的 /api/me（地址按请求的 origin 拼）。
 *   - 已登录 → 放行；未登录 → 302 到 /login?next=<请求的路径 + 查询>：登录完整页回到原链接，房间链接 ?room= 直接进房（0.6.0"叫朋友来"）；
 *   - 平台出错、超时、GATE=login 却没绑 ARCADE → 503（掼蛋自己的页面 DOWN_PAGE）。宁可暂时谁都进不去，也不能放行。
 * 没有 ARCADE、GATE 也不是 login：单独部署，放行并补发游客 cookie。
 */

import type { GuestOptions } from 'arcade-kit/guest';
import { acceptCreate, acceptJoin, acceptMatch, json, loginGate, readJson, standaloneRoot, type GateEnv, type GateOptions, type KitEnv } from 'arcade-kit/worker';
import { CLOSE } from 'arcade-kit/protocol';
import { MATCH_FUN, MATCH_PATH, MATCH_TIERS } from '../src/net/match.ts';
import { ROOM_PATH } from '../src/net/version.ts';
import { routeStake, type WalletRpc } from './stake.ts';

/** 服务绑定和静态资源绑定只用到 fetch；闸门的测试用假的绑定，这里自己声明最小接口。 */
export interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  /** 平台（认人）：本站部署时由部署工具绑上，单独部署没有（这时用游客 cookie） */
  ARCADE?: Fetcher;
  GATE?: string;
  /** 联机房间（Durable Object，worker/room.ts 的 Room） */
  ROOM?: DurableObjectNamespace;
  /** 快速匹配的排队（0.26.0，worker/match.ts 的 Queue，每个档位一个实例） */
  MATCH?: DurableObjectNamespace;
  /** "on" 才开联机；其他值（含没配）开房 404、进房 4004 */
  ONLINE?: string;
  /** 只认这个网站发起的请求（Origin）：正式部署由工作流注入 https://<站点>；不设就按请求自己的 origin */
  SITE_ORIGIN?: string;
  /** arcade-kit 的计量（房间自己用：开房占名额、报写入）；这里不碰，列出来是为了一眼看全 */
  METER?: DurableObjectNamespace;
  /** 计量的门槛（wrangler.jsonc 的 vars，计量自己读） */
  KIT_QUOTA?: unknown;
  /** 平台钱包（服务绑定 RPC，入口 WalletService，props.game = guandan）：单机实盘的带入、结回、放弃（stake.ts）。单独部署没有，实盘一律 no_wallet */
  WALLET?: WalletRpc;
}

/** 和 wrangler.jsonc 的 run_worker_first 一致；不在这里的路径（理论上不会进 Worker）一律原样交给静态资源 */
export const GATED_PATHS = ['/games/guandan', '/games/guandan/', '/games/guandan/index.html'];

/** 平台连不上时的 503 页（loginGate 回它）：掼蛋自己的标题和配色 */
const DOWN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>掼蛋</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d2a1f;color:#e8f0e8;
font:18px/1.6 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;text-align:center}a{color:#ffe3a0}</style></head>
<body><main><p>暂时确认不了你登录没有（平台一时连不上），过一会儿刷新再来</p><p><a href="/">回首页</a></p></main></body>
</html>`;

/**
 * 单独部署时的游客：首页、开房、进房三处同一个设置。昵称不许冒充电脑（kit 按包含判断，"老张1"也挡住）；
 * 和画面上的名字（src/view/art/avatars.ts 的 PERSONAS）是同一份，tests/gate.test.ts 核对
 */
export const GUEST: GuestOptions = { reserved: ['老张', '小美', '阿强'] };

const CREATE_PATH = `${ROOM_PATH}/rooms`;
const JOIN_RE = new RegExp(`^${ROOM_PATH}/rooms/([^/]+)/ws$`);
const MATCH_RE = new RegExp(`^${MATCH_PATH}/([^/]+)$`);

/**
 * 联机房间的三个路由：开房、进房、快速匹配排队（0.26.0）（wrangler.jsonc 的 run_worker_first 放行 /games/guandan/room/*），其余交给 arcade-kit：
 * 查 Origin、经平台 /api/me 认人、找房间都在 acceptCreate / acceptJoin / acceptMatch 里，这里不碰浏览器的原始请求。
 * 不经过 GATE：进房本来就要登录（kit 认不出人就拒绝），GATE=off 时也一样。
 * 返回 null 表示不是房间的路径。
 */
export function routeRoom(request: Request, env: Env): Promise<Response> | Response | null {
  const path = new URL(request.url).pathname;
  const join = JOIN_RE.exec(path);
  const match = MATCH_RE.exec(path);
  if (path !== CREATE_PATH && !join && !match) return path.startsWith(`${ROOM_PATH}/`) || path === ROOM_PATH ? new Response('not found', { status: 404 }) : null;
  const on = env.ONLINE === 'on' && env.ROOM !== undefined;
  // 整个 env 交给 kit：它要看 GATE 决定是不是独立模式（只挑 ROOM、ARCADE 时丢了 GATE，本站部署 ARCADE 掉了会退成游客放行，0.12.4 审计）。
  // 闸门的 Fetcher 只声明了 fetch；运行时的服务绑定就是 kit 要的 Fetcher；ROOM 上面 on 已经查过
  const kitEnv = env as unknown as KitEnv;
  const opts: GateOptions = env.SITE_ORIGIN ? { siteOrigin: env.SITE_ORIGIN, guest: GUEST } : { guest: GUEST };
  if (path === CREATE_PATH) return on ? createWithOptions(request, env, kitEnv, opts) : new Response('not found', { status: 404 });
  // 联机关着：和"没有这个房间"一样，接受升级后马上 4004 关掉（浏览器的 WebSocket 拿不到 HTTP 状态码，客户端认得 4004、不再重连）
  if (!on) return refuseSocket(request, CLOSE.noRoom, 'online off');
  if (match) {
    // 快速匹配（0.26.0）：档位不认得、没开放的，kit 回 4004。没有钱包（单独部署）只开娱乐，实盘的排不了
    if (!env.MATCH) return refuseSocket(request, CLOSE.noRoom, 'no match');
    const tiers = env.WALLET ? MATCH_TIERS : [MATCH_FUN];
    return acceptMatch(request, { ...kitEnv, MATCH: env.MATCH }, match[1]!, { ...opts, tiers });
  }
  return acceptJoin(request, kitEnv, join![1]!, opts);
}

function refuseSocket(request: Request, code: number, reason: string): Response {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 });
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/**
 * 开房：请求体里带 { stake: 档位 } 的是实盘房间（docs/stake.md 3.1，kit 0.4.0 的"开房就定选项"）；没带（或没有请求体）和以前一样是娱乐房间。
 * 档位不认得的照样交给 kit，由规则的 options 校验后回 400 bad_options。
 */
async function createWithOptions(request: Request, env: Env, kitEnv: KitEnv, opts: GateOptions): Promise<Response> {
  let stake: unknown;
  if (request.headers.get('content-type')?.includes('application/json')) {
    // 认人之前读请求体：kit 的 readJson 只读带 content-length 且不超过 512 字节的（{ stake } 只有几十字节）。kit 开房不读请求体
    const body = await readJson(request, 512);
    if (body && typeof body === 'object') stake = (body as { stake?: unknown }).stake;
  }
  if (stake === undefined || stake === null) return acceptCreate(request, kitEnv, opts);
  // 没有钱包（单独部署）开不了实盘房：页面上本来就不给选，这里挡住手写的请求
  if (!env.WALLET) return json({ error: 'no_wallet' }, 409);
  return acceptCreate(request, kitEnv, { ...opts, options: { stake } });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  // 单独部署：站点根 / 转到 /games/guandan/（有平台时回 null，站点根归平台）
  const root = standaloneRoot(request, env, 'guandan');
  if (root) return root;
  const room = routeRoom(request, env);
  if (room) return room;
  // 实盘接口自己认人（和房间一样不经过 GATE）
  const stake = routeStake(request, env);
  if (stake) return stake;
  if (!GATED_PATHS.includes(new URL(request.url).pathname)) return env.ASSETS.fetch(request);
  // 闸门的 Fetcher 只声明了 fetch；运行时的绑定就是 kit 要的 Fetcher
  return loginGate(request, env as GateEnv, { downPage: DOWN_PAGE, guest: GUEST });
}
