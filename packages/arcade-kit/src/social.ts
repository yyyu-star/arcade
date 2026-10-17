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

/** 报位置：在大厅、在玩某个游戏、在某个好友房里（seats 是"3/4"这样的人数） */
export interface Presence {
  place: 'lobby' | 'game' | 'room';
  game?: string;
  room?: string;
  seats?: string;
}

/** 收到的一条邀请；until 是过期时间（毫秒时间戳，平台给字符串也认） */
export interface Invite {
  id: string;
  from: { id: string; name: string };
  game: string;
  room: string;
  until: number;
}

/** 好友列表的一项：平台的原样加 online、where（对方关了"让好友看到我在哪"就没有 where） */
export interface Friend {
  id: string;
  name: string;
  online: boolean;
  where?: Presence;
  [k: string]: unknown;
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
    return (body.friends as Friend[]).filter((f) => f && typeof f.id === 'string').map((f) => ({ ...f, online: f.online === true }));
  } catch {
    return null;
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
  /** 横条的 z-index，默认 1500（在牌桌互动之上，在分享预览之下） */
  zIndex?: number;
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
      `z-index:${this.o.zIndex ?? 1500}`,
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:calc(100vw - 16px)',
      'box-sizing:border-box',
      'padding:6px 6px 6px 16px',
      'border-radius:28px',
      'background:rgba(28,28,32,.94)',
      'color:#fff',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:600 16px system-ui,"PingFang SC","Microsoft YaHei",sans-serif',
      'transform:translate(-50%,-140%)',
      'opacity:0',
      'transition:transform .25s ease-out,opacity .25s ease-out',
    ].join(';');
    const text = document.createElement('span');
    text.textContent = inviteText(v, this.o.gameName);
    text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0';
    const btn = (label: string, key: string, primary: boolean, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset['key'] = key;
      b.style.cssText = `flex:none;min-width:64px;min-height:44px;padding:0 14px;border-radius:22px;border:0;font:inherit;cursor:pointer;${primary ? 'background:#f5c542;color:#222' : 'background:rgba(255,255,255,.14);color:#fff'}`;
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
