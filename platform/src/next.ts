/** 登录页的 next 参数（0.10.1）。 */

/** next 解析后的路径只能落在这几处：游戏目录，或平台自己的页面（不含登录、找回，免得绕回来） */
const NEXT_PATH = /^\/(?:games\/.+|friends|feed|f\/[0-9A-Za-z-]{8,9}|u\/[A-Za-z0-9_-]{22}|me(?:\/[a-z]+)?|wallet|boards|privacy|admin)?$/;

/**
 * /login?next=<同源路径> 登录后回哪里（0.10.1）：游戏"叫朋友来"的房间链接 /games/<id>/?room=… 要带着房间码回来，
 * 只认 from=<id> 会把查询丢掉。只认以 / 开头、不超过 200 个字符的本站路径；//、反斜杠（浏览器把 /\ 当成 //）、
 * 空白和控制字符（解析时会被删掉、拼出 //）一律不认。再按本站地址解析一遍，解析后还得是本站、落在上面几处。
 * 不认的返回 null，按 from 处理（docs/platform-backend.md 5.7）。不碰 DOM：测试里也能跑，origin 由调用方给。
 */
export function safeNext(raw: string | null, origin: string): string | null {
  if (!raw || raw.length > 200 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin || !NEXT_PATH.test(u.pathname)) return null;
  return u.pathname + u.search + u.hash;
}
