/**
 * kit 内部用的东西：房间的内部地址、身份头、按房间码取 stub。不在 package.json 的 exports 里，游戏引用不到，
 * 只能经 worker.ts 的 acceptCreate / acceptJoin 开房进房，没法自己拼内部请求。
 */

/**
 * 平台会话 cookie 的名字（docs/platform-backend.md 15.8："平台只读 __Host-sid"）。kit 里只在这里写一次：
 * 认人时请求里没有它就直接算没登录，不去问平台。
 */
export const SESSION_COOKIE = '__Host-sid';

/** 请求的 Cookie 头里有没有非空的平台会话 cookie。 */
export function hasSessionCookie(cookie: string | null): boolean {
  if (!cookie) return false;
  return cookie.split(';').some((part) => {
    const i = part.indexOf('=');
    return i > 0 && part.slice(0, i).trim() === SESSION_COOKIE && part.slice(i + 1).trim() !== '';
  });
}

/** 游戏 Worker 认出来的人（auth.ts 经平台 /api/me 拿到）。 */
export interface Identity {
  userId: string;
  name: string;
}

/**
 * 房间 fetch 只认这个主机名：kit 自己拼的内部地址（acceptJoin）。游戏 Worker 要是把浏览器的原始请求直接转进来，
 * 地址是站点自己的域名，一律拒绝，浏览器自己带的 x-kit-user 头就不可能被当成身份。
 */
export const KIT_HOST = 'arcade-kit.internal';

/** 身份头：JSON 再 URL 编码（昵称是中文，请求头里只放 ASCII）。只有 acceptJoin 拼的内部请求会带它。 */
export function identityHeader(me: Identity): string {
  return encodeURIComponent(JSON.stringify({ userId: me.userId, name: me.name }));
}

export function parseIdentity(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<Identity>;
    return typeof v.userId === 'string' && v.userId && typeof v.name === 'string' ? { userId: v.userId, name: v.name } : null;
  } catch {
    return null;
  }
}

/** 6 位房间码（crypto 随机）。 */
export function newRoomCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
}

/** 房间的 stub：按房间码取，尽量放在亚太（4.1）。 */
export function roomStub(ns: DurableObjectNamespace, code: string): DurableObjectStub {
  return ns.get(ns.idFromName(code), { locationHint: 'apac' });
}

/** 计量的名字：每个游戏 Worker 只有这一个实例（meter.ts）。 */
export const METER_NAME = 'kit-meter';

/** 进房猜码的计数（0.14.0）：按人（u:<userId>）、按 IP（ip:<地址>）各一个小实例，和全站的计量同一个类、不同名字，不挤一个热点 */
export function missStub(ns: DurableObjectNamespace, key: string): DurableObjectStub {
  return ns.get(ns.idFromName(`kit-miss:${key}`), { locationHint: 'apac' });
}

/** 房间告诉 acceptJoin"这个码没有房间"的内部头（只在房间回给 Worker 的 101 上，转给浏览器前去掉） */
export const MISS_HEADER = 'x-kit-miss';

/** acceptJoin 告诉房间"这个人猜码超了门槛"的内部头：房间只放自己人（房主、入座的、绑过座位的）进来，别人一律 1013 */
export const LIMITED_HEADER = 'x-kit-limited';

/** 计量的 stub：和房间一样放在亚太，开房、报数少绕路。 */
export function meterStub(ns: DurableObjectNamespace): DurableObjectStub {
  return ns.get(ns.idFromName(METER_NAME), { locationHint: 'apac' });
}
