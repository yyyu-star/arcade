/** 平台接口的浏览器端封装（接口约定见 docs/platform-backend.md 第 15 节）。 */

export interface User {
  id: string;
  username: string;
  displayName: string;
  friendCode: string;
  createdAt: number;
  /** 让好友看到我在不在线、在哪（0.13.0）；旧的回话里没有，按开着算 */
  showWhere?: boolean;
  /** 好友动态开关（0.17.0）；没有就是开着 */
  showFeed?: boolean;
  /** 搭子战绩开关（0.19.0）；没有就是开着 */
  showMates?: boolean;
  /** 只有管理员有，值总是 true。 */
  isAdmin?: true;
}

export interface MeResponse {
  user: User | null;
  service: 'ok' | 'readonly';
  saves: 'ok' | 'paused';
  /** 测试期邀请制时是 closed：登录页不露"注册"。 */
  registration: 'open' | 'closed';
  /** 大厅公告（0.10.8）：只给登录了的人，没有是 null */
  notice?: Notice | null;
}

export interface Notice {
  text: string;
  at: number;
}

/** 别人的公开资料：不含用户名（5.6）。 */
export interface Profile {
  userId: string;
  displayName: string;
  avatar: unknown;
}

/** 在哪（0.13.0，15.13）：大厅、在玩某个游戏、在某个游戏的房间里（带房间码和人数） */
/** 好友动态的一条（0.17.0，15.17）：data 是编号和数字，文字在 src/feed.tsx 里拼 */
export interface FeedItem {
  id: string;
  user: Profile;
  game: string;
  kind: 'settle' | 'moment';
  at: number;
  data: { tier?: string; units?: number; titles?: string[]; m?: string; n?: number[] };
  reactions: Record<string, number>;
  mine?: string;
}

/** 给我的邀请（0.14.0，docs/social.md 1.3）：until 是过期时间（毫秒） */
export interface Invite {
  id: string;
  from: { id: string; name: string };
  game: string;
  room: string;
  until: number;
}

export interface Where {
  place: 'lobby' | 'game' | 'room';
  game?: string;
  room?: string;
  seats?: string;
}

/** 搭子战绩（0.19.0，15.19）：我和这个好友一起打的，wins 是我赢的、theirWins 是他赢的；teamN、teamWins 是做搭档（同一队）的 */
export interface Together {
  n: number;
  wins: number;
  theirWins: number;
  teamN: number;
  teamWins: number;
}

/** 我的邀请码（0.20.0，15.20）：quota 是额度，taken 是用掉的（已用 + 还有效的），todayLeft 是 24 小时内还能生成几个 */
export interface InviteCodes {
  quota: number;
  taken: number;
  left: number;
  todayLeft: number;
  ttlDays: number;
  codes: {
    id: string;
    hint: string;
    /** 只有没用的才有，ABCD-EFGH-JKMN */
    code?: string;
    createdAt: number;
    expiresAt: number;
    status: 'unused' | 'used' | 'expired' | 'revoked';
    usedAt?: number;
    /** null：用的人已经注销 */
    usedBy?: Profile | null;
  }[];
}

export interface InviteRules {
  userQuota: number;
  adminQuota: number;
  ttlDays: number;
  perDay: number;
}

export interface InviteRulesState {
  rules: InviteRules;
  defaults: InviteRules;
  range: Record<keyof InviteRules, [number, number]>;
  updatedAt: number | null;
}

export interface AdminInviteCode {
  id: string;
  hint: string;
  status: 'unused' | 'used' | 'expired' | 'revoked';
  owner: { username: string; displayName: string } | null;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  usedBy?: { username: string; displayName: string } | null;
}

export interface FriendLists {
  /** online、where（0.13.0）：对方关了"让好友看到我在哪"时 online 是 false、没有 where */
  friends: (Profile & { lastSeenDaysAgo: number; online?: boolean; where?: Where; together?: Together })[];
  incoming: Profile[];
  outgoing: Profile[];
}

export type Relation = 'none' | 'pending_out' | 'pending_in' | 'friends' | 'self';

/** 一个游戏的战绩（15.11 的 GET /api/stats/<id>）：对登录的人公开 */
export interface CareerView {
  /** 结回过几份 */
  n: number;
  net: number;
  /** 本周净赢（北京时间周一清零） */
  wnet: number;
  rounds: number;
  wins: number;
  best: number;
  titles: { id: string; at: number }[];
  max: Record<string, number>;
  sum: Record<string, number>;
}

/** 排行榜的一行（15.12、15.5） */
export interface BoardRow {
  rank: number;
  userId: string;
  displayName: string;
  avatar: unknown;
  isMe: boolean;
}

/** GET /api/leaderboard：本周净赢（total + 各游戏）、称号收集，每榜前 50 加我的名次；有每日榜的游戏今天的榜 id（没人交分时 null） */
export interface LeaderboardResponse {
  week: string;
  boards: Record<string, { entries: (BoardRow & { value: number })[]; me: { rank: number; value: number } | null }>;
  daily: Record<string, string | null>;
}

/** GET /api/boards/<game>/<board>（15.5）；rank 为 null 是"太靠后，没数" */
/** 好友这周的最好成绩超过了我的（0.15.0，读的时候比） */
export interface Overtake {
  gameId: string;
  /** 子榜（0.16.0）：一天几个每日榜的游戏才有 */
  board?: string;
  by: { userId: string; displayName: string };
  score: number;
  mine: number;
}

export interface ScoreBoard {
  entries: (BoardRow & { score: number })[];
  me: { rank: number | null; score: number } | null;
}

export interface StatsResponse {
  user: Profile;
  relation: Relation;
  week: string;
  games: Record<string, CareerView>;
  /** 搭子战绩（0.19.0）：是好友、两边都开着、一起打过才有，按游戏分开 */
  together?: Record<string, Together>;
}

/** 管理员可调的钱包规则（0.10.6，15.7） */
export interface WalletRules {
  reliefTo: number;
  winUnits: number;
  newBalance: number;
  adminAdjustMax: number;
}
export interface WalletRulesState {
  rules: WalletRules;
  defaults: WalletRules;
  range: Record<keyof WalletRules, [number, number]>;
  /** 最近的改动，新的在前 */
  log: { at: number; by: string; changes: Partial<Record<keyof WalletRules, [number, number]>> }[];
  updatedAt: number | null;
}

/** 注册开关：open 是实际开没开；forcedOff 时服务器总闸关着，switchOpen 是管理员开关上记的值（0.8.0）。 */
export interface RegistrationState {
  open: boolean;
  switchOpen: boolean;
  forcedOff: boolean;
  updatedAt: number | null;
}

export interface NoticeState {
  notice: (Notice & { by: string }) | null;
  max: number;
}

/** 管理界面看到的账号。 */
export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: number;
  lastSeenAt: number;
  /** 钱包摘要（0.10.7）：balance 为 null 是还没有钱包；played 是各游戏上桌次数 */
  wallet?: { balance: number | null; onTable: number; played: Record<string, number> };
}

/** 钱包流水的一条（0.10.7）：a 是余额变了多少，带入是负的 */
export interface LedgerEntry {
  at: number;
  t: 'grant' | 'buyin' | 'settle' | 'refund' | 'expire' | 'relief' | 'admin';
  g?: string;
  a: number;
  capped?: number;
}

/** 今日概况（0.10.7）：今天现算的统计加今天来过的人数，前 6 天从每日统计里取 */
export interface AdminOverview {
  today: WalletDayStats & { visitors: number };
  days: WalletDayStats[];
}

export interface SaveSlot {
  slot: string;
  rev: number;
  updatedAt: number;
  data: unknown;
}

/** 接口返回的错误：按 code 判断，message 是服务端给的中文，直接显示。 */
export class ApiFail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** 会话失效（任何请求返回 401 unauthorized）时通知登录状态清掉用户，页面随之变成"去登录"。 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/**
 * 请求的超时：国内到 Cloudflare 时好时坏，偶尔一个请求挂 20 秒不回。不设超时的话页面就一直"请稍等"。
 * /api/me 单独用短一点的（session.tsx 超时后还会重试），其余 15 秒：注册、登录要算 PBKDF2，平时也不到 1 秒。
 */
const ME_TIMEOUT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** 网络层面的失败（没回、超时、回来的不是我们的接口），值得重试；别的错误是服务器明确说的，不重试。 */
export function isNetworkFail(e: unknown): boolean {
  return e instanceof ApiFail && (e.code === 'network' || e.code === 'timeout' || e.code === 'unreachable');
}

/** Retry-After 头：秒数或 HTTP 日期，换成还要等几秒；看不懂就不写多久 */
function retryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const s = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(s) && s > 0 ? Math.min(s, 86_400) : undefined;
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    // 写请求必须带 X-Arcade（15.1）；Origin 浏览器同域 fetch 会自动带
    headers['x-arcade'] = '1';
    headers['content-type'] = 'application/json';
  }
  // 超时连读响应体一起算：头回来了、身子卡住，一样是卡
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const timedOut = () => new ApiFail(0, 'timeout', '网络有点慢，过一会儿再试');
  let res: Response;
  let data: Record<string, unknown> | null = null;
  try {
    try {
      // credentials 不写：fetch 默认就是 same-origin，同域请求照样带会话 cookie
      res = await fetch(path, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        signal: ctrl.signal,
      });
    } catch {
      throw ctrl.signal.aborted ? timedOut() : new ApiFail(0, 'network', '网络不通，检查一下再试');
    }
    if (res.status === 204) return undefined as T;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      if (ctrl.signal.aborted) throw timedOut();
      // 不是 JSON：多半是请求没到我们的 Worker（Cloudflare 或网关的出错页），按"连不上"算，不当成停服
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || !data) {
    // 429 不管回的是什么都是"太频繁"：我们的接口回 JSON（带 retryAfter），网关限速回的是它自己的页面，不能说成"连不上"
    if (res.status === 429) {
      const retryAfter = typeof data?.retryAfter === 'number' ? data.retryAfter : retryAfterHeader(res.headers.get('retry-after'));
      const message = typeof data?.message === 'string' ? data.message : '试得太频繁了，稍等一会儿再来';
      throw new ApiFail(429, typeof data?.error === 'string' ? data.error : 'rate_limited', message, retryAfter);
    }
    if (!data) throw new ApiFail(res.status, 'unreachable', '连不上服务器，过一会儿再试');
    const code = typeof data.error === 'string' ? data.error : 'internal';
    const message = typeof data.message === 'string' ? data.message : '服务器出错了，过一会儿再试';
    if (res.status === 401 && code === 'unauthorized') onUnauthorized?.();
    throw new ApiFail(res.status, code, message, typeof data.retryAfter === 'number' ? data.retryAfter : undefined);
  }
  return data as T;
}

/** 管理页的全站筹码统计（一天一行，worker/api/wallet.ts 的 DayStats）。 */
export interface WalletDayStats {
  day: string;
  total: number;
  wallets: number;
  grant: number;
  relief: number;
  /** 管理员调整的净额（0.9.4 起有，之前的记录里没有） */
  admin?: number;
  /** 那天碰过钱包的人数、领补给的人数（0.10.7 起有） */
  active?: number;
  reliefCount?: number;
  /** players：带筹码上过桌的人数（0.10.7 起有） */
  games: Record<string, { in: number; out: number; back: number; capped: number; players?: number }>;
}

/** 管理员调整筹码的一条记录（0.9.4） */
export interface AdminAdjust {
  at: number;
  amount: number;
  note: string;
  by: string;
  username?: string;
  displayName?: string;
}

/** 桌上的一份筹码（docs/platform-backend.md 5.9）。mode：server 是好友房（服务端算），client 是单机（浏览器算）。 */
export interface Stake {
  game: string;
  ref: string;
  tier: string;
  amount: number;
  mode: 'server' | 'client';
  at: number;
  until: number;
}

/** 钱包（15.9 的 GET /api/wallet）。caps：今天各游戏 client 模式的净赢和上限。fresh：还没建钱包，看到的是新号的初始筹码（管理员可调）。 */
export interface Wallet {
  balance: number;
  stakes: Stake[];
  canRelief: boolean;
  writesLeft: number;
  caps: Record<string, { net: number; cap: number }>;
  fresh: boolean;
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/me', undefined, ME_TIMEOUT_MS),
  wallet: () =>
    request<{ wallet: Wallet; reliefTo: number; winUnits?: number; playing?: Record<string, number>; ledger?: LedgerEntry[]; week?: Record<string, number> }>('GET', '/api/wallet'),
  relief: () => request<{ wallet: Wallet }>('POST', '/api/wallet/relief'),
  /** who 是用户 id，或 me */
  stats: (who: string) => request<StatsResponse>('GET', `/api/stats/${encodeURIComponent(who)}`),
  leaderboard: (scope: 'all' | 'friends') => request<LeaderboardResponse>('GET', `/api/leaderboard?scope=${scope}`),
  board: (game: string, board: string, scope: 'all' | 'friends') =>
    request<ScoreBoard>('GET', `/api/boards/${encodeURIComponent(game)}/${encodeURIComponent(board)}?scope=${scope}`),
  /** 我和好友这周在每日挑战上的最好成绩（0.15.0）；week 是这周一的日期 */
  friendsWeek: (game: string, board: string | null = null) =>
    request<ScoreBoard & { week: string }>('GET', `/api/friends/week/${encodeURIComponent(game)}${board ? `?board=${encodeURIComponent(board)}` : ''}`),
  /** 这周哪个好友超过了我（0.15.0）：每个游戏最多一条 */
  overtakes: () => request<{ overtakes: Overtake[] }>('GET', '/api/friends/overtakes'),
  register: (username: string, password: string, displayName: string, inviteCode?: string) =>
    request<{ user: User; recoveryCode: string }>('POST', '/api/auth/register', { username, password, displayName, ...(inviteCode ? { inviteCode } : {}) }),
  /** 邀请码（0.20.0，15.20） */
  inviteCodes: () => request<InviteCodes>('GET', '/api/invite-codes'),
  createInviteCode: () => request<{ id: string; code: string; link: string; expiresAt: number; left: number }>('POST', '/api/invite-codes', {}),
  revokeInviteCode: (id: string) => request<void>('POST', `/api/invite-codes/${id}/revoke`, {}),
  login: (username: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { username, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  recover: (username: string, recoveryCode: string, newPassword: string) =>
    request<{ user: User; recoveryCode: string }>('POST', '/api/auth/recover', { username, recoveryCode, newPassword }),
  rename: (displayName: string) => request<{ user: User }>('PATCH', '/api/me', { displayName }),
  setShowWhere: (showWhere: boolean) => request<{ user: User }>('PATCH', '/api/me', { showWhere }),
  /** 报位置（0.13.0）：平台每 2 分钟最多记一次，写不了时也回 204 */
  presence: (where: Where) => request<void>('POST', '/api/presence', where),
  /** 邀请（0.14.0）：收是只读；"不了"只改自己收到的那条 */
  invites: () => request<{ invites: Invite[] }>('GET', '/api/invites'),
  /** 好友动态（0.17.0）：我和好友最近 7 天的；赞或扔道具每条每人一次 */
  feed: () => request<{ items: FeedItem[] }>('GET', '/api/feed'),
  react: (id: string, kind: string) => request<void>('POST', `/api/feed/${encodeURIComponent(id)}/react`, { kind }),
  setShowFeed: (showFeed: boolean) => request<{ user: User }>('PATCH', '/api/me', { showFeed }),
  setShowMates: (showMates: boolean) => request<{ user: User }>('PATCH', '/api/me', { showMates }),
  dismissInvite: (id: string) => request<void>('POST', `/api/invites/${encodeURIComponent(id)}/dismiss`),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/api/account/password', { currentPassword, newPassword }),
  newRecoveryCode: (currentPassword: string) =>
    request<{ recoveryCode: string }>('POST', '/api/account/recovery-code', { currentPassword }),
  logoutOthers: (currentPassword: string) => request<void>('POST', '/api/account/logout-others', { currentPassword }),
  deleteAccount: (proof: { currentPassword: string } | { recoveryCode: string }) =>
    request<void>('POST', '/api/account/delete', proof),
  saves: (gameId: string) => request<{ saves: SaveSlot[] }>('GET', `/api/saves/${gameId}`),
  friends: () => request<FriendLists>('GET', '/api/friends'),
  lookupFriendCode: (code: string) =>
    request<{ user: Profile; relation: Relation; blocked?: true }>('GET', `/api/friends/code/${encodeURIComponent(code)}`),
  sendFriendRequest: (friendCode: string) => request<{ status: 'pending' | 'friends' }>('POST', '/api/friends/requests', { friendCode }),
  /** 战绩页上的"加好友"（0.10.5）：按用户 id 发 */
  sendFriendRequestTo: (userId: string) => request<{ status: 'pending' | 'friends' }>('POST', '/api/friends/requests', { userId }),
  acceptFriend: (userId: string) => request<{ status: 'friends' }>('POST', `/api/friends/${userId}/accept`),
  declineFriend: (userId: string) => request<void>('POST', `/api/friends/${userId}/decline`),
  /** 删好友，或撤回自己发出的请求。 */
  removeFriend: (userId: string) => request<void>('DELETE', `/api/friends/${userId}`),
  blocks: () => request<{ blocks: Profile[] }>('GET', '/api/blocks'),
  block: (userId: string) => request<void>('POST', '/api/blocks', { userId }),
  unblock: (userId: string) => request<void>('DELETE', `/api/blocks/${userId}`),
  newFriendCode: () => request<{ friendCode: string }>('POST', '/api/me/friend-code'),
  admin: {
    users: () => request<{ users: AdminUser[] }>('GET', '/api/admin/users'),
    /** password 留空由服务器生成，生成的才会在结果里返回。 */
    create: (username: string, displayName: string, password: string) =>
      request<{ user: AdminUser; password?: string; recoveryCode: string }>('POST', '/api/admin/users', {
        username,
        displayName,
        ...(password ? { password } : {}),
      }),
    resetPassword: (id: string, password: string, newRecoveryCode: boolean) =>
      request<{ password?: string; recoveryCode?: string }>('POST', `/api/admin/users/${id}/password`, {
        ...(password ? { password } : {}),
        newRecoveryCode,
      }),
    remove: (id: string) => request<void>('POST', `/api/admin/users/${id}/delete`),
    registration: () => request<RegistrationState>('GET', '/api/admin/settings/registration'),
    setRegistration: (open: boolean) => request<RegistrationState>('POST', '/api/admin/settings/registration', { open }),
    notice: () => request<NoticeState>('GET', '/api/admin/settings/notice'),
    setNotice: (text: string) => request<NoticeState>('POST', '/api/admin/settings/notice', { text }),
    walletRules: () => request<WalletRulesState>('GET', '/api/admin/settings/wallet'),
    setWalletRules: (rules: Partial<WalletRules>) => request<WalletRulesState>('POST', '/api/admin/settings/wallet', rules),
    walletStats: () => request<{ days: WalletDayStats[] }>('GET', '/api/admin/wallet-stats'),
    walletOf: (username: string) =>
      request<{ user: { username: string; displayName: string }; wallet: Wallet; log: AdminAdjust[]; career?: Record<string, CareerView>; ledger?: LedgerEntry[] }>(
        'GET',
        `/api/admin/wallet/${encodeURIComponent(username)}`,
      ),
    overview: () => request<AdminOverview>('GET', '/api/admin/overview'),
    adjust: (username: string, amount: number, note: string) =>
      request<{ wallet: Wallet; credited: number }>('POST', '/api/admin/wallet/adjust', { username, amount, note }),
    recentAdjustments: () => request<{ recent: AdminAdjust[] }>('GET', '/api/admin/wallet-adjustments'),
    inviteRules: () => request<InviteRulesState>('GET', '/api/admin/settings/invites'),
    setInviteRules: (rules: Partial<InviteRules>) => request<InviteRulesState>('POST', '/api/admin/settings/invites', rules),
    setInviteQuota: (userId: string, quota: number | null) =>
      request<{ quota: number | null; custom: boolean }>('POST', `/api/admin/users/${userId}/invite-quota`, { quota }),
    inviteCodes: (status: 'all' | 'unused' | 'used') => request<{ codes: AdminInviteCode[] }>('GET', `/api/admin/invite-codes?status=${status}`),
    revokeInviteCode: (id: string) => request<void>('POST', `/api/admin/invite-codes/${id}/revoke`, {}),
  },
};

/** 按错误码换掉服务端的通用说法，比如找回页的 bad_credentials 说"用户名或恢复码不对"。 */
export type ErrorTexts = Partial<Record<string, string>>;

/** 把错误变成给玩家看的一句话。 */
export function errorText(e: unknown, texts: ErrorTexts = {}): string {
  if (e instanceof ApiFail) {
    const text = texts[e.code] ?? e.message;
    if ((e.code === 'rate_limited' || e.code === 'too_soon') && e.retryAfter) return `${text}（${waitText(e.retryAfter)}后）`;
    return text;
  }
  return '出了点问题，刷新一下再试';
}

function waitText(s: number): string {
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.ceil(s / 60)} 分钟`;
  return `${Math.ceil(s / 3600)} 小时`;
}
