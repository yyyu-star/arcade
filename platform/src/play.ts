/** 进游戏、回游戏的地址。 */
import { GAMES, type GameEntry } from './games.ts';

/** 当前环境下进入游戏的地址：开发时去游戏自己的开发服务器，线上用同域路径。 */
export function playUrl(g: GameEntry): string {
  return import.meta.env.DEV && g.devUrl ? g.devUrl : g.path;
}

/**
 * /login?from=<id> 登录后回哪里：只认游戏目录里的 id，别的值（包括网址）一律不认，
 * 免得这个链接被拿来把人带到外站（docs/platform-backend.md 5.7）。
 */
export function returnGame(from: string | null): GameEntry | null {
  return GAMES.find((g) => g.id === from) ?? null;
}

/** 好友页、好友链接 /f/<码> 点了"登录"：from 是 friends 或 f/<码>，登录后回到那一页。只认这两种，同样不认网址。 */
export function returnFriendPath(from: string | null): string | null {
  return from && /^(friends|f\/[0-9A-Za-z-]{8,9})$/.test(from) ? `/${from}` : null;
}

/** next 指向某个游戏目录时是哪个游戏（登录页上说"登录后回到「开盘」"用） */
export function gameOfPath(path: string | null): GameEntry | null {
  return path ? (GAMES.find((g) => path.startsWith(g.path)) ?? null) : null;
}
