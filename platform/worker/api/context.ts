/** 一个 /api 请求的上下文，路由把它交给各接口。 */
import type { Env } from '../env';
import { ApiError } from './http';
import type { Limits } from './config';
import type { Db } from './db';
import type { Tier } from './meter';
import type { Session } from './session';

export interface Ctx {
  request: Request;
  env: Env;
  limits: Limits;
  now: number;
  /** 按路由类别记写入的 D1。 */
  db: Db;
  /** 生效的档位：计量算出的和 API_MODE 开关取更严的那个。 */
  tier: Tier;
  /** 请求体（GET 为空对象）。 */
  body: Record<string, unknown>;
  /** 路由校验过的路径参数（如 gameId、slot）。 */
  params: Record<string, string>;
  /** 请求里的 __Host-sid 原值；没带为 null。 */
  sidCookie: string | null;
  /** 有效会话；没登录或会话无效为 null。 */
  session: Session | null;
  /** 管理接口的调用方：命令行工具的令牌，或者当前会话的管理员（docs/platform-backend.md 5.x 管理接口）。其他接口为 null。 */
  admin: { by: 'token' } | { by: 'session'; userId: string } | null;
  /** IP 哈希，用到才算。 */
  ipHash(): Promise<string>;
}

/** 用户 id 的形状：只看字符和长度、放宽一点（注册时生成的是 22 位 base64url），不对的不碰库 */
export function isUserIdShape(x: unknown): x is string {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
}

/** 用户 id 必须正好是注册时生成的 22 位；不对直接 404，不计数、不碰库 */
export function checkUserId(id: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new ApiError(404, 'not_found');
  return id;
}

/** 路径里的用户 id（好友、屏蔽、管理接口、战绩页） */
export function userParams(segments: string[]): Record<string, string> {
  return { userId: checkUserId(segments[0]!) };
}

/**
 * 可选的 userId：客户端认为自己在给谁写、在读谁的数据。写（存档、交分）放请求体，读存档列表放查询参数 ?userId=，各认各的来源。
 * 别的标签页刚换了账号时，cookie 已经是新号，页面里还是旧号的数据：写的时候 rev 恰好相同就会把旧号的数据写进新号；
 * 读的时候先问 /api/me 是旧号、拉存档时已经换成新号，就会把新号的云端存档合并进旧号的本地数据。
 * 客户端堵不干净，所以由服务端对一下：不一致 409 wrong_user。要在计数、读库和所有写入之前调用。不带就不查。
 */
function checkExpectedUser(c: Ctx, expected: unknown): void {
  if (expected === undefined) return;
  if (!isUserIdShape(expected)) throw new ApiError(400, 'bad_request');
  if (expected !== c.session!.user.id) throw new ApiError(409, 'wrong_user');
}

/** 写接口：请求体里的 userId。 */
export function checkBodyUser(c: Ctx): void {
  checkExpectedUser(c, c.body.userId);
}

/**
 * 读接口：查询参数 ?userId=（参数名区分大小写，按解码后的名字认，user%49d 也算）。
 * 带了多个、没有等号或值为空、或者出现 userid、UserId 这类大小写不同的写法，都是 400：游戏端拼错了要能发现，不能悄悄当成没带。
 */
export function checkQueryUser(c: Ctx): void {
  const params = new URL(c.request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== 'userId' && key.toLowerCase() === 'userid') throw new ApiError(400, 'bad_request');
  }
  const all = params.getAll('userId');
  if (all.length > 1) throw new ApiError(400, 'bad_request');
  checkExpectedUser(c, all[0]);
}

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
