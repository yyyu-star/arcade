/**
 * 社交第一期（0.12.0，仓库根 docs/social.md 1.2、1.3）：游戏页面开着时报"我在哪"、收好友的邀请，在页面顶上弹一条"老王叫你来打牌 [去] [不了]"。
 *
 * - 只在有平台、已登录时挂（`mountSocial` 先看 `detectPlatform`）：单独部署、没登录一个请求都不发。
 * - 省平台的写入：位置只在页面在前台时每 2 分钟报一次（平台再按 2 分钟节流，和 last_seen_at 一起写）；邀请每 30 秒问一次（只读）。
 *   切到后台就停，回到前台到点了马上补一次。不用 Web Push。
 * - 没有自由文字：横条上只有对方的昵称（平台的账号名）和游戏名（游戏给的表），都按纯文本放进去。
 * - 这个文件只在调用时碰 DOM，import 时不碰；接口的小函数和挑邀请的逻辑是纯的，测试在 test/social.test.ts（假 fetch）。
 * - 接口形状是主线定的（docs/platform-backend.md 里平台写细节）：都要登录，写的请求带 `x-arcade: 1`、同源（平台的 CSRF 规矩）。
 */
import { detectPlatform, type PlatformInfo } from './client.js';
import { applyTheme, type KitTheme } from './theme.js';

/** 报位置：在大厅、在玩某个游戏、在某个好友房里（seats 是"3/4"这样的人数） */
export interface Presence {
  place: 'lobby' | 'game' | 'room';
  game?: string;
  room?: string;
  seats?: string;
  /** 游戏的显示名：平台在好友列表的 where 里给（0.12.4 起 kit 优先用它）；报位置时不用带 */
  gameName?: string;
}

/**
 * 默认的层级（0.12.4）：游戏自己的弹窗可能很高（掼蛋的房间弹窗 8500），kit 的横条、面板、分享预览默认都在 10000 以上，
 * 顺序是横条 < 面板 < 预览。游戏有更高的层再用 zIndex 选项往上提
 */
export const SOCIAL_Z = { banner: 10500, panel: 10600, preview: 11000 } as const;

/** 收到的一条邀请；until 是过期时间（毫秒时间戳，平台给字符串也认） */
export interface Invite {
  id: string;
  from: { id: string; name: string };
  game: string;
  room: string;
  until: number;
}

/**
 * 好友列表的一项。平台每项是公开资料 `{ userId, displayName, avatar }`（docs/platform-backend.md 15.4，只增不改）加 online、where
 * （对方关了"让好友看到我在哪"就没有 where）；kit 统一成 id、name（0.12.1），平台原样的字段也留着。发邀请的 `to` 用 id
 */
export interface Friend {
  id: string;
  name: string;
  online: boolean;
  where?: Presence;
  avatar?: unknown;
  [k: string]: unknown;
}

/** 平台的一项 → Friend：认 userId / displayName（平台的形状），也认 id / name；没有 id 的丢掉 */
export function parseFriend(x: unknown): Friend | null {
  if (!x || typeof x !== 'object') return null;
  const f = x as Record<string, unknown>;
  const id = typeof f['userId'] === 'string' ? f['userId'] : typeof f['id'] === 'string' ? f['id'] : null;
  if (!id) return null;
  const name = typeof f['displayName'] === 'string' ? f['displayName'] : typeof f['name'] === 'string' ? f['name'] : '';
  return { ...f, id, name, online: f['online'] === true };
}

export interface ApiOptions {
  fetchImpl?: typeof fetch;
}

/** 发邀请的结果：limit 是超了次数（每人每天 50 条、同一好友 1 分钟 1 条），blocked 是被屏蔽或不是好友 */
export type SendInviteResult =
  | { ok: true; id: string }
  | { ok: false; error: 'limit' | 'blocked' | 'login' | 'failed'; retryAfter?: number };

/** 位置每 2 分钟一次、邀请每 30 秒一次（docs/social.md） */
export const PRESENCE_MS = 120_000;
export const INVITE_POLL_MS = 30_000;

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ROOM_CODE = /^[A-Za-z0-9]{4,16}$/;

function api(opts: ApiOptions): typeof fetch {
  return opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
}

/** 写的请求：同源 cookie、`x-arcade: 1`（平台的 CSRF 规矩） */
function write(method: string, body?: unknown, keepalive = false): RequestInit {
  return {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: { 'x-arcade': '1', accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

const READ: RequestInit = { credentials: 'same-origin', headers: { accept: 'application/json' } };

/** 过期时间：数字（毫秒）或能解析的时间字符串；都不是返回 NaN */
export function untilOf(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') return /^\d+$/.test(x) ? Number(x) : Date.parse(x);
  return Number.NaN;
}

/** 平台回的邀请列表：形状不对的项丢掉（游戏 id、房间码按格式查，跳转地址只从这两样拼） */
export function parseInvites(body: unknown): Invite[] {
  const list = (body as { invites?: unknown } | null)?.invites;
  if (!Array.isArray(list)) return [];
  const out: Invite[] = [];
  for (const x of list as unknown[]) {
    const v = x as Partial<Record<keyof Invite, unknown>> | null;
    const from = v?.from as { id?: unknown; name?: unknown } | undefined;
    const until = untilOf(v?.until);
    if (
      typeof v?.id === 'string' && v.id &&
      typeof from?.name === 'string' && from.name &&
      typeof v.game === 'string' && GAME_ID.test(v.game) &&
      typeof v.room === 'string' && ROOM_CODE.test(v.room) &&
      Number.isFinite(until)
    ) {
      out.push({ id: v.id, from: { id: String(from.id ?? ''), name: from.name }, game: v.game, room: v.room, until });
    }
  }
  return out;
}

/**
 * 现在该弹哪一条：没过期、没弹过（skip）、不是我已经在的那个房间的；先到期的先弹
 */
export function pickInvite(list: readonly Invite[], now: number, skip: ReadonlySet<string>, here?: Presence | null): Invite | null {
  let best: Invite | null = null;
  for (const v of list) {
    if (v.until <= now || skip.has(v.id)) continue;
    if (here?.place === 'room' && here.game === v.game && here.room === v.room) continue;
    if (!best || v.until < best.until) best = v;
  }
  return best;
}

/** 点"去"跳到哪：`/games/<id>/?room=<码>`（站点根下，和自己挂在哪无关） */
export function inviteUrl(v: Pick<Invite, 'game' | 'room'>): string {
  return `/games/${encodeURIComponent(v.game)}/?room=${encodeURIComponent(v.room)}`;
}

/** 横条上的那句话：游戏名不认识就说"一起玩" */
export function inviteText(v: Pick<Invite, 'from' | 'game'>, gameName?: (id: string) => string | undefined): string {
  const who = [...v.from.name].slice(0, 12).join('');
  const g = gameName?.(v.game);
  return g ? `${who}叫你来${g}` : `${who}叫你一起玩`;
}

/** 报一次位置。返回 HTTP 状态（0 = 没连上）；平台回 204 */
export async function postPresence(p: Presence, opts: ApiOptions = {}): Promise<number> {
  try {
    return (await api(opts)('/api/presence', write('POST', p))).status;
  } catch {
    return 0;
  }
}

/** 问一次有没有邀请。没连上、不是 200 回 null（和"没有邀请"分开：401 时调用方要停） */
export async function fetchInvites(opts: ApiOptions = {}): Promise<{ status: number; invites: Invite[] }> {
  try {
    const res = await api(opts)('/api/invites', READ);
    if (res.status !== 200) return { status: res.status, invites: [] };
    return { status: 200, invites: parseInvites(await res.json()) };
  } catch {
    return { status: 0, invites: [] };
  }
}

/** "不了"：这条以后不再弹（跳过去之前也调一次，到了游戏页不会再弹同一条） */
export async function dismissInvite(id: string, opts: ApiOptions & { keepalive?: boolean } = {}): Promise<boolean> {
  try {
    const res = await api(opts)(`/api/invites/${encodeURIComponent(id)}/dismiss`, write('POST', undefined, opts.keepalive));
    return res.ok;
  } catch {
    return false;
  }
}

/** 叫好友来：to 是好友的用户 id，game、room 是我在的房间 */
export async function sendInvite(inv: { to: string; game: string; room: string }, opts: ApiOptions = {}): Promise<SendInviteResult> {
  let res: Response;
  try {
    res = await api(opts)('/api/invites', write('POST', inv));
  } catch {
    return { ok: false, error: 'failed' };
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof body?.id === 'string' ? { ok: true, id: body.id } : { ok: false, error: 'failed' };
  }
  if (res.status === 429) {
    const s = Number(res.headers.get('retry-after'));
    return { ok: false, error: 'limit', ...(Number.isFinite(s) && s > 0 ? { retryAfter: s } : {}) };
  }
  if (res.status === 401) return { ok: false, error: 'login' };
  if (res.status === 403 || res.status === 404) return { ok: false, error: 'blocked' };
  return { ok: false, error: 'failed' };
}

/** 好友列表（带在线、在哪）。没连上、不是 200 回 null */
export async function fetchFriends(opts: ApiOptions = {}): Promise<Friend[] | null> {
  try {
    const res = await api(opts)('/api/friends', READ);
    if (res.status !== 200) return null;
    const body = (await res.json()) as { friends?: unknown };
    if (!Array.isArray(body?.friends)) return null;
    return (body.friends as unknown[]).map(parseFriend).filter((f): f is Friend => f !== null);
  } catch {
    return null;
  }
}

/** 名场面编号（平台 15.17）：字母开头、1–24 位 [a-z0-9_] */
const MOMENT_ID = /^[a-z][a-z0-9_]{0,23}$/;

/**
 * 报一条娱乐名场面（社交第二期的好友动态，平台 0.17.0 的 `POST /api/feed`）：只报游戏 id、编号和最多 3 个整数，文字由游戏的 `public/moments.json` 按编号给模板。
 * 平台超了每天 10 条、对方关了开关都静默回 204，所以返回值只说"送没送到"：HTTP 状态，0 = 没连上；编号、数字本地就不合格的不发，回 400。
 * 数字按位置写：n2 有值时 n 也要有
 */
export async function postMoment(game: string, moment: string, n?: number, n2?: number, n3?: number, opts: ApiOptions = {}): Promise<number> {
  const nums = [n, n2, n3];
  while (nums.length && nums[nums.length - 1] === undefined) nums.pop();
  if (!GAME_ID.test(game) || !MOMENT_ID.test(moment) || !nums.every((x) => Number.isSafeInteger(x))) return 400;
  try {
    return (await api(opts)('/api/feed', write('POST', { game, moment, ...(nums.length ? { n: nums } : {}) }))).status;
  } catch {
    return 0;
  }
}

/** "让好友看到我在哪"的开关 */
export async function setShowWhere(show: boolean, opts: ApiOptions = {}): Promise<boolean> {
  try {
    return (await api(opts)('/api/me', write('PATCH', { showWhere: show }))).ok;
  } catch {
    return false;
  }
}

/** "在哪"那一行：好友房带人数，在游戏里写游戏名（不认识的说"在玩游戏"），大厅；没给 where 按离线写几天前来过 */
export function whereText(f: Pick<Friend, 'online' | 'where'> & { lastSeenDaysAgo?: unknown }, gameName?: (id: string) => string | undefined): string {
  if (!f.online) {
    const d = f.lastSeenDaysAgo;
    return typeof d !== 'number' ? '不在线' : d <= 0 ? '今天来过' : d === 1 ? '昨天来过' : `${d} 天前来过`;
  }
  const w = f.where;
  if (!w) return '在线';
  if (w.place === 'lobby') return '在大厅';
  // 平台给的显示名优先（它认识所有登记的游戏），没有再问游戏的回调
  const g = w.gameName || (w.game ? gameName?.(w.game) : undefined);
  if (w.place === 'room') return `在${g ? `${g}的` : ''}好友房${w.seats ? ` · ${w.seats}` : ''}`;
  return g ? `在${g}` : '在玩游戏';
}

/**
 * 叫不了的大白话（平台：429 rate_limited 带 Retry-After，同一个好友 1 分钟一条、每人 24 小时 50 条；403 not_friend：不是好友、屏蔽了、对方不存在一律这个）。
 * 等的时间超过两分钟的是每天的次数用完了
 */
export function inviteErrorText(r: Exclude<SendInviteResult, { ok: true }>): string {
  switch (r.error) {
    case 'limit':
      return r.retryAfter !== undefined && r.retryAfter > 120 ? '今天叫人的次数用完了，明天再叫' : '刚叫过他，过一会儿再叫';
    case 'blocked':
      return '叫不了他（可能已经不是好友了）';
    case 'login':
      return '登录过期了，刷新一下再叫';
    default:
      return '没发出去，过一会儿再试';
  }
}

/** 叫过以后多久不能再叫同一个人（平台同一个好友 1 分钟一条） */
export const INVITE_GAP_MS = 60_000;

// ───────────── 挂到页面上（只在调用时碰 DOM） ─────────────

export interface SocialOptions extends ApiOptions {
  /**
   * 我现在在哪：每次报之前现问。返回 null 这次不报（比如还没进房）。
   * 房间的人数由游戏给（"3/4"），平台不进房间问
   */
  where(): Presence | null;
  /** 游戏 id → 显示的名字（横条上"叫你来<名字>"）；kit 不认识任何游戏，没给或不认识的说"一起玩" */
  gameName?(id: string): string | undefined;
  /**
   * 有没有平台、登没登录：`detectPlatform` 的结果。游戏启动时已经问过 `/api/me` 的传进来，省一次请求；
   * 不传就自己问一次
   */
  platform?: PlatformInfo;
  /** 点"去"：默认先告诉平台这条办了，再跳到 `/games/<id>/?room=<码>`；游戏要先确认离开（打到一半）就自己接 */
  onGo?(invite: Invite): void;
  /** 横条的 z-index，默认 10500（SOCIAL_Z.banner：盖得住游戏的弹窗，在"叫朋友来"面板和分享预览之下） */
  zIndex?: number;
  /** 主题（0.16.0）：写到横条根节点上的 `--ak-*` 变量（`handle.openInvite` 打开的面板默认也用它）；不传就用页面 CSS 里的变量或默认外观 */
  theme?: KitTheme;
  /** 冒烟、调试看的流水：`位置 204`、`邀请 弹 <id>`、`邀请 去`、`邀请 不了`、`邀请 过期` */
  log?(line: string): void;
  /** 测试用：时钟 */
  now?(): number;
}

export interface SocialHandle {
  /** 位置变了（进房、换游戏）马上报一次；离上次不到 2 分钟就不报，平台反正也会节流 */
  presenceNow(force?: boolean): void;
  /** 马上问一次邀请（比如刚从后台回来，或者冒烟） */
  pollNow(): void;
  /** 收起横条、停掉计时、解开监听 */
  stop(): void;
  /** 打开"叫朋友来"面板（0.12.2）：列好友、"叫他来"、复制邀请链接。游戏名用 mountSocial 给的 gameName */
  openInvite(inv: Omit<InvitePanelOptions, 'fetchImpl' | 'gameName'>): InvitePanel;
}

const BANNER_ID = 'arcade-invite-banner';

/**
 * 挂上报位置和收邀请。没平台、没登录、平台连不上都回 null（不挂）；中途掉了登录（401）自己停
 */
export async function mountSocial(opts: SocialOptions): Promise<SocialHandle | null> {
  if (typeof document === 'undefined') return null;
  const info = opts.platform ?? (await detectPlatform(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}));
  if (info.platform !== true || !info.user) return null;
  return new Social(opts);
}

class Social implements SocialHandle {
  private lastPresence = -Infinity;
  private lastPoll = -Infinity;
  private polling = false;
  private stopped = false;
  private readonly skip = new Set<string>();
  private invites: Invite[] = [];
  private shown: { invite: Invite; el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly onVis = (): void => this.tick();

  constructor(private readonly o: SocialOptions) {
    document.addEventListener('visibilitychange', this.onVis);
    // 一个 5 秒的心跳统一看两件事到没到点，后台时什么都不做
    this.timer = setInterval(() => this.tick(), 5_000);
    this.tick();
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  openInvite(inv: Omit<InvitePanelOptions, 'fetchImpl' | 'gameName'>): InvitePanel {
    return openInvite({
      // mountSocial 的主题也给面板用，面板自己传了就以面板的为准
      ...(this.o.theme ? { theme: this.o.theme } : {}),
      ...inv,
      ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}),
      ...(this.o.gameName ? { gameName: this.o.gameName } : {}),
      ...(this.o.now ? { now: this.o.now } : {}),
    });
  }

  private visible(): boolean {
    return document.visibilityState === 'visible';
  }

  private tick(): void {
    if (this.stopped || !this.visible()) return;
    const t = this.now();
    if (t - this.lastPresence >= PRESENCE_MS) this.presenceNow(true);
    if (t - this.lastPoll >= INVITE_POLL_MS) this.pollNow();
  }

  presenceNow(force = false): void {
    if (this.stopped || !this.visible()) return;
    const t = this.now();
    if (!force && t - this.lastPresence < PRESENCE_MS) return;
    const p = this.o.where();
    if (!p) return;
    this.lastPresence = t;
    void postPresence(p, this.o).then((s) => {
      this.o.log?.(`位置 ${s}`);
      if (s === 401) this.stop();
    });
  }

  pollNow(): void {
    if (this.stopped || this.polling) return;
    this.polling = true;
    this.lastPoll = this.now();
    void fetchInvites(this.o).then(({ status, invites }) => {
      this.polling = false;
      if (status === 401) return this.stop();
      if (status !== 200) return; // 连不上、忙：留着上次的，到点再问
      this.invites = invites;
      this.showNext();
    });
  }

  private showNext(): void {
    if (this.stopped || this.shown) return;
    const v = pickInvite(this.invites, this.now(), this.skip, this.o.where());
    if (v) this.show(v);
  }

  private show(v: Invite): void {
    this.skip.add(v.id);
    document.getElementById(BANNER_ID)?.remove();
    const el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:calc(env(safe-area-inset-top, 0px) + 8px)',
      `z-index:${this.o.zIndex ?? SOCIAL_Z.banner}`,
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:calc(100vw - 16px)',
      'box-sizing:border-box',
      'padding:6px 6px 6px 16px',
      'border-radius:var(--ak-radius,28px)',
      'background:var(--ak-bg,rgba(28,28,32,.94))',
      'color:var(--ak-fg,#fff)',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:600 16px var(--ak-font,system-ui,"PingFang SC","Microsoft YaHei",sans-serif)',
      'transform:translate(-50%,-140%)',
      'opacity:0',
      'transition:transform .25s ease-out,opacity .25s ease-out',
    ].join(';');
    // 写在 cssText 之后：cssText 赋值会清掉之前 setProperty 的变量
    applyTheme(el, this.o.theme);
    const text = document.createElement('span');
    text.textContent = inviteText(v, this.o.gameName);
    text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0';
    const btn = (label: string, key: string, primary: boolean, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset['key'] = key;
      b.style.cssText = `flex:none;min-width:64px;min-height:44px;padding:0 14px;border-radius:var(--ak-radius-btn,22px);border:0;font:inherit;cursor:pointer;${primary ? 'background:var(--ak-accent,#f5c542);color:var(--ak-accent-fg,#222)' : 'background:var(--ak-soft,rgba(255,255,255,.14));color:var(--ak-fg,#fff)'}`;
      b.addEventListener('click', fn);
      return b;
    };
    const go = btn('去', 'invite:go', true, () => {
      this.o.log?.('邀请 去');
      this.hide();
      // 先告诉平台办了（keepalive：页面马上要跳走），到了游戏页不会再弹同一条
      void dismissInvite(v.id, { ...this.o, keepalive: true });
      if (this.o.onGo) this.o.onGo(v);
      else location.assign(inviteUrl(v));
    });
    const no = btn('不了', 'invite:no', false, () => {
      this.o.log?.('邀请 不了');
      void dismissInvite(v.id, this.o);
      this.hide();
      this.showNext();
    });
    el.appendChild(text);
    el.appendChild(go);
    el.appendChild(no);
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%,0)';
      el.style.opacity = '1';
    });
    // 过期就收起（不告诉平台：它自己按 until 不再给）
    const timer = setTimeout(() => {
      this.o.log?.('邀请 过期');
      this.hide();
      this.showNext();
    }, Math.max(0, v.until - this.now()));
    this.shown = { invite: v, el, timer };
    this.o.log?.(`邀请 弹 ${v.id}`);
  }

  private hide(): void {
    if (!this.shown) return;
    const { el, timer } = this.shown;
    clearTimeout(timer);
    this.shown = null;
    el.style.transform = 'translate(-50%,-140%)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.hide();
  }
}

// ───────────── "叫朋友来"面板（0.12.2，只在调用时碰 DOM） ─────────────

export interface InvitePanelOptions extends ApiOptions {
  /** 游戏 id、房间码：叫来的就是这个房间 */
  game: string;
  room: string;
  /** 列好友、"叫他来"（有平台、已登录时）；false 只有"复制邀请链接"（单独部署、没登录） */
  friends?: boolean;
  /** 邀请链接，默认 `<站点>/games/<id>/?room=<码>` */
  url?: string;
  /** 系统分享、复制时的那句话，默认"来一起玩！房间码 <码>" */
  text?: string;
  /** 游戏 id → 名字（好友"在哪"那一行） */
  gameName?(id: string): string | undefined;
  /** 默认 10600（SOCIAL_Z.panel：在游戏的弹窗、邀请横条之上，在分享预览之下）；游戏的层更高就传更大的 */
  zIndex?: number;
  /** 主题（0.16.0）：写到面板根节点上的 `--ak-*` 变量；不传就用页面 CSS 里的变量或默认外观 */
  theme?: KitTheme;
  /** 冒烟、调试看的流水：`叫人 打开 <n>`、`叫人 <id> ok|<错误>`、`叫人 复制`、`叫人 关闭` */
  log?(line: string): void;
  /** 测试用：时钟 */
  now?(): number;
}

export interface InvitePanel {
  close(): void;
}

const PANEL_ID = 'arcade-invite-panel';
const PANEL_CSS_ID = 'arcade-invite-css';
/** 和牌桌互动（table-fun）同一套颜色、圆角、按钮 */
const PANEL_CSS = `
.aiv-back{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:8px;box-sizing:border-box;background:var(--ak-overlay,rgba(0,0,0,.5));font-family:var(--ak-font,inherit);-webkit-tap-highlight-color:transparent}
.aiv-box{position:relative;display:flex;flex-direction:column;width:min(420px,calc(100vw - 16px));max-height:calc(100% - 16px);background:var(--ak-bg,rgba(43,29,20,.97));border:2px solid var(--ak-border,#d4a64a);border-radius:var(--ak-radius,14px);padding:12px;box-sizing:border-box;color:var(--ak-fg,#fff6e0);box-shadow:0 6px 18px rgba(0,0,0,.45);animation:aiv-pop .14s ease-out}
.aiv-title{font-size:17px;font-weight:700;color:var(--ak-title,#f3d98b);margin:2px 48px 2px 4px}
.aiv-sub{font-size:13px;opacity:.75;margin:0 4px 8px}
.aiv-x{position:absolute;right:6px;top:6px;width:44px;height:44px;border:0;border-radius:var(--ak-radius-btn,22px);background:transparent;color:var(--ak-title,#f3d98b);font:inherit;font-size:22px;cursor:pointer}
.aiv-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:6px}
.aiv-row{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 10px;border-radius:var(--ak-radius-btn,10px);background:var(--ak-soft,#4a3220)}
.aiv-dot{flex:none;width:10px;height:10px;border-radius:50%;background:#6a6a6a}.aiv-dot.aiv-on{background:#6fd36f}
.aiv-who{flex:1 1 auto;min-width:0}
.aiv-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aiv-where{font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aiv-chip{flex:none;min-width:84px;min-height:44px;border:1px solid var(--ak-border,rgba(212,166,74,.6));border-radius:var(--ak-radius-btn,22px);background:var(--ak-accent,#7a2a1e);color:var(--ak-accent-fg,#fff6e0);font:inherit;font-size:14px;font-weight:700;padding:0 12px;cursor:pointer}
.aiv-chip:disabled,.aiv-chip.aiv-soft{color:var(--ak-fg,#fff6e0)}
.aiv-chip:disabled{background:#3a3a3a;cursor:default;opacity:.8}.aiv-chip.aiv-soft{background:var(--ak-soft,#4a3220)}
.aiv-note{font-size:13px;text-align:center;opacity:.85;padding:10px 4px;min-height:1em}
.aiv-err{color:#ffb0a0}
.aiv-foot{display:flex;justify-content:center;padding-top:10px}
@keyframes aiv-pop{from{opacity:0;scale:.94}to{opacity:1;scale:1}}
`;

/** 叫过的人什么时候能再叫（这一页里记着，关了面板再开也灰着） */
const calledUntil = new Map<string, number>();

/**
 * 打开"叫朋友来"面板：列好友（在线的在前，写在哪），每人一个"叫他来"，发出后变"已叫"、1 分钟内灰着，叫不了的换成大白话；
 * 底下"复制邀请链接"（能系统分享就分享）。点空白处、✕、Esc 关掉。只发平台的 `POST /api/invites`，不写别的
 */
export function openInvite(o: InvitePanelOptions): InvitePanel {
  const doc = document;
  doc.getElementById(PANEL_ID)?.remove();
  if (!doc.getElementById(PANEL_CSS_ID)) {
    const st = doc.createElement('style');
    st.id = PANEL_CSS_ID;
    st.textContent = PANEL_CSS;
    doc.head.appendChild(st);
  }
  const now = (): number => o.now?.() ?? Date.now();
  const url = o.url ?? `${location.origin}${inviteUrl(o)}`;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const back = el('div', 'aiv-back');
  back.id = PANEL_ID;
  back.style.zIndex = String(o.zIndex ?? SOCIAL_Z.panel);
  applyTheme(back, o.theme);
  const box = el('div', 'aiv-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '叫朋友来');
  const x = el('button', 'aiv-x', '✕');
  x.type = 'button';
  x.dataset['key'] = 'invite:close';
  x.setAttribute('aria-label', '关闭');
  const list = el('div', 'aiv-list');
  const note = el('div', 'aiv-note', o.friends === false ? '把链接发给朋友，点开就进房' : '正在找好友…');
  const copy = el('button', 'aiv-chip aiv-soft', '复制邀请链接');
  copy.type = 'button';
  copy.dataset['key'] = 'invite:copy';
  const foot = el('div', 'aiv-foot');
  foot.appendChild(copy);
  box.appendChild(x);
  box.appendChild(el('div', 'aiv-title', '叫朋友来'));
  box.appendChild(el('div', 'aiv-sub', `房间码 ${o.room}`));
  box.appendChild(list);
  box.appendChild(note);
  box.appendChild(foot);
  back.appendChild(box);
  doc.body.appendChild(back);

  let closed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const t of timers) clearTimeout(t);
    doc.removeEventListener('keydown', onKey);
    back.remove();
    o.log?.('叫人 关闭');
  };
  doc.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  x.addEventListener('click', close);

  copy.addEventListener('click', () => {
    const text = o.text ?? `来一起玩！房间码 ${o.room}`;
    const done = (msg: string, err = false): void => {
      note.textContent = msg;
      note.classList.toggle('aiv-err', err);
      o.log?.('叫人 复制');
    };
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      nav.share({ title: text, text, url }).then(
        () => done('发出去了'),
        (e: { name?: string }) => (e?.name === 'AbortError' ? undefined : clip()),
      );
      return;
    }
    clip();
    function clip(): void {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(`${text}：${url}`).then(() => done('链接复制好了，发给朋友，点开就进房'), () => done(`把这个链接发给朋友：${url}`, true));
      else done(`把这个链接发给朋友：${url}`, true);
    }
  });

  /** "叫他来"按钮的样子：叫过的 1 分钟内灰着，到点自己变回来 */
  const paint = (b: HTMLButtonElement, id: string): void => {
    const left = (calledUntil.get(id) ?? 0) - now();
    b.disabled = left > 0;
    b.textContent = left > 0 ? '已叫' : '叫他来';
    if (left > 0) {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!closed) paint(b, id);
      }, left);
      timers.add(t);
    }
  };

  const render = (friends: Friend[]): void => {
    note.textContent = friends.length ? '' : '还没有好友，先把链接发给朋友';
    // 平台已经按在线、最近来过排好；这里再保证在线的在前（稳定排序）
    const sorted = [...friends].sort((a, b) => Number(b.online) - Number(a.online));
    for (const f of sorted) {
      const row = el('div', 'aiv-row');
      row.appendChild(el('span', `aiv-dot${f.online ? ' aiv-on' : ''}`));
      const who = el('div', 'aiv-who');
      who.appendChild(el('div', 'aiv-name', f.name || '好友'));
      who.appendChild(el('div', 'aiv-where', whereText(f, o.gameName)));
      const b = el('button', 'aiv-chip', '叫他来');
      b.type = 'button';
      b.dataset['key'] = `invite:call:${f.id}`;
      paint(b, f.id);
      b.addEventListener('click', () => {
        b.disabled = true;
        void sendInvite({ to: f.id, game: o.game, room: o.room }, o).then((r) => {
          if (closed) return;
          o.log?.(`叫人 ${f.id} ${r.ok ? 'ok' : r.error}`);
          if (r.ok) {
            calledUntil.set(f.id, now() + INVITE_GAP_MS);
            note.textContent = `叫了 ${f.name || '好友'}，他会在页面顶上看到`;
            note.classList.remove('aiv-err');
          } else {
            // 刚叫过（平台按 1 分钟算）也灰到能叫为止
            if (r.error === 'limit') calledUntil.set(f.id, now() + Math.min(r.retryAfter ?? 60, 60) * 1000);
            note.textContent = inviteErrorText(r);
            note.classList.add('aiv-err');
          }
          paint(b, f.id);
        });
      });
      row.appendChild(who);
      row.appendChild(b);
      list.appendChild(row);
    }
    o.log?.(`叫人 打开 ${friends.length}`);
  };

  if (o.friends === false) o.log?.('叫人 打开 0');
  else
    void fetchFriends(o).then((fs) => {
      if (closed) return;
      if (fs) render(fs);
      else {
        note.textContent = '好友列表暂时打不开，可以先把链接发给朋友';
        o.log?.('叫人 打开 失败');
      }
    });
  copy.focus();
  return { close };
}
