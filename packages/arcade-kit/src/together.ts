/**
 * 搭子战绩上报（0.13.0，平台 0.19.0，docs/platform-backend.md 15.19）：好友房打完一场，房间的服务端把同桌真人和各自输赢经钱包服务绑定的 `together()` 报给平台，
 * 平台给其中已经是好友的每一对累计"一起打了几场、谁赢了几场、做搭档几场"。浏览器碰不到这条路（只有服务绑定），所以只在房间里调。
 *
 * 不依赖 `cloudflare:workers`（纯函数加一次 RPC），`arcade-kit/room` 转出；房间子类一般用 `GameRoom.reportMatch`，它按座位认人、拼 op。
 */

/** 一个真人这一场：team 只有分队的游戏才带（同一个数字是一队，0–3）；win 由游戏定，写进各自的 DESIGN */
export interface TogetherPlayer {
  userId: string;
  team?: number;
  win: boolean;
}

export type TogetherReply = { ok: true; pairs: number } | { ok: false; error: string };

/** 平台一次最多收几个人（15.19：2–8 个真人） */
export const TOGETHER_MAX = 8;

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface TogetherWallet {
  together?: (req: { op: string; players: TogetherPlayer[] }) => Promise<unknown>;
}

/**
 * 一场的编号：平台按它去重（同一对的同一个 op 再报不加），所以同一场重报要得到同一个 op，不同的场不能撞。
 * 房间码会被别的房间重用，所以带上开房时刻：`<房间码>-<开房时刻 36 进制>-<第几场>`，不合格的字符换成 `_`，截到 64 位
 */
export function togetherOp(code: string, createdAt: number, match: number | string): string {
  return `${code}-${createdAt.toString(36)}-${match}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64).padEnd(8, '_');
}

/**
 * 报一场。players 只放真人（电脑、游客不报），同一个 userId 只留第一个；少于 2 个、超过 TOGETHER_MAX 个、op 不合格，
 * 或者没有 `env.WALLET`（单独部署）、它没有 `together`（平台还没上 0.19.0）时什么都不做，回 null。
 * 平台的回话原样返回；RPC 抛错吞掉、只记错误类型（不记 userId），也回 null。**不重试**：平台忙时回 busy，少记一场不影响打牌。
 * 只经服务绑定调，不用 setTimeout；房间在一场结束时交给 `ctx.waitUntil`（见 GameRoom.reportMatch）
 */
export async function reportTogether(env: unknown, op: string, players: readonly TogetherPlayer[]): Promise<TogetherReply | null> {
  const wallet = (env as { WALLET?: TogetherWallet } | null | undefined)?.WALLET;
  if (!wallet || typeof wallet.together !== 'function') return null;
  const seen = new Set<string>();
  const list: TogetherPlayer[] = [];
  for (const p of players) {
    if (!p.userId || seen.has(p.userId)) continue;
    seen.add(p.userId);
    list.push(p.team === undefined ? { userId: p.userId, win: p.win } : { userId: p.userId, team: p.team, win: p.win });
  }
  if (list.length < 2 || list.length > TOGETHER_MAX || !OP_RE.test(op)) return null;
  try {
    return (await wallet.together({ op, players: list })) as TogetherReply;
  } catch (e) {
    console.error('together failed', e instanceof Error ? e.name : typeof e);
    return null;
  }
}
