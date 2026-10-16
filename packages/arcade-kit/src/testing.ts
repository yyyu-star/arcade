/**
 * 测试和本地试用的假平台钱包（0.8.0，不部署）：游戏的 workerd 测试、冒烟、本地 `wrangler dev` 里代替平台的钱包，各游戏共用这一份。
 *
 * 只复刻游戏碰得到的接口形状和关键规则，不复刻平台的细枝末节（计量、熔断档、流水、战绩怎么存、管理员调规则）：
 * - `WalletService`：游戏经服务绑定调的四个方法（docs/platform-backend.md 5.9"给游戏的 RPC"）。绑定的 `props.game` 必须写，
 *   参数里的 `game` 要和它一致，不然 `bad_game`。这里不维护游戏名单：平台认不认这个游戏是平台的事，假钱包只核对两边一致；
 * - `FakeBank`：一人一个 DO，存钱包（5.9"存储"的简化）。带入、结回、放弃按 `游戏:ref` 一份一份（5.9"带入""结回"）：
 *   只结一次（结完再结 `no_stake`）、余额够这次才能带（`no_funds`）、同一个 `ref` 补码要同档同 mode、操作 id 按游戏去重（`dup`）、
 *   到期原样退回（`expired`）、client 模式每个游戏每天净赢最多 `WIN_UNITS` 份（`capped`）；
 * - 结回带的小结 `stats` 按 5.10 的上限检查（JSON ≤ 256 字节、必填字段、称号和自定义数的格式），不合格回 `statsIgnored`、钱照常结；
 *   收下的记在 `FakeBank.stats` 里给测试核对；
 * - `walletHttp`：浏览器的 `GET /api/wallet`、`POST /api/wallet/relief`（15.9），认平台的会话 cookie，cookie 的值就当 userId。
 *
 * 平台改了钱包接口（参数、错误码、规则），平台 PR 的描述里写"影响 kit/testing"，由维护者安排 kit 跟上；一个 PR 只改一个模块。
 *
 * 游戏怎么接：测试 Worker 的主模块 `export { FakeBank, WalletService } from 'arcade-kit/testing'`，wrangler 配置里
 * 加 DO 绑定 `FAKE_BANK`（class_name `FakeBank`），`WALLET` 服务绑定指回这个 Worker 自己：
 * `{ "binding": "WALLET", "service": "<测试 Worker 名>", "entrypoint": "WalletService", "props": { "game": "<游戏 id>" } }`。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { SESSION_COOKIE } from './internal.js';

/** 新号送多少、补给补到多少、client 模式每天净赢最多几份：平台的默认值（5.9，管理员可调的那几个数按默认算） */
export const NEW_BALANCE = 10_000;
export const RELIEF_TO = 2_000;
export const WIN_UNITS = 10;
/** 各档一份多少（economy.md 第 2 节） */
export const TIERS = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 } as const;
export type Tier = keyof typeof TIERS;
export type Mode = 'server' | 'client';

const DAY_MS = 86_400_000;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** 结回最多是带上桌的加 20 份（平台只防写错） */
const SETTLE_EXTRA_UNITS = 20;

export interface Stake {
  game: string;
  ref: string;
  tier: Tier;
  amount: number;
  mode: Mode;
  at: number;
  until: number;
}

export interface WalletView {
  balance: number;
  stakes: Stake[];
  canRelief: boolean;
  writesLeft: number;
  caps: Record<string, { net: number; cap: number }>;
  fresh: boolean;
}

export type WalletReply =
  | { ok: true; wallet: WalletView; credited?: number; capped?: number; dup?: true; statsIgnored?: StatsProblem }
  | { ok: false; error: string; wallet?: WalletView };

export type StatsProblem = 'too_big' | 'bad_stats';

export interface FakeEnv {
  FAKE_BANK: DurableObjectNamespace<FakeBank>;
}

interface State {
  balance: number;
  /** 桌上的筹码，key 是 `游戏:ref` */
  stakes: Record<string, Stake>;
  reliefDay: string;
  /** client 模式当天每个游戏的带入、结回（算净赢）和带入过的最高档 */
  day: string;
  cin: Record<string, number>;
  cout: Record<string, number>;
  top: Record<string, Tier>;
  /** `游戏:op` → 第一次的结果 */
  ops: Record<string, Done>;
  /** 到期退回过的 `游戏:ref` */
  expired: string[];
  fresh: boolean;
}

type Done = { ok: true; credited?: number; capped?: number; statsIgnored?: StatsProblem };
type Cmd = { t: 'buyin' | 'settle' | 'refund'; game: string; ref: string; tier?: Tier; amount?: number; until?: number; mode: Mode; op: string; stats?: unknown };

const beijingDay = (now: number): string => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
const onTable = (s: State): number => Object.values(s.stakes).reduce((n, k) => n + k.amount, 0);

export class FakeBank extends DurableObject {
  /** 被调了几次、写了几次：测试数游戏调平台几次、平台写几行 */
  calls = 0;
  writes = 0;
  /** 结回带上来的小结，按先后记在内存里；不合格的记 ignored */
  stats: { game: string; ref: string; stats: unknown; ignored?: StatsProblem }[] = [];

  private async load(now: number): Promise<State> {
    const s =
      (await this.ctx.storage.get<State>('w')) ??
      ({ balance: NEW_BALANCE, stakes: {}, reliefDay: '', day: '', cin: {}, cout: {}, top: {}, ops: {}, expired: [], fresh: true } satisfies State);
    const day = beijingDay(now);
    if (s.day !== day) Object.assign(s, { day, cin: {}, cout: {}, top: {} });
    // 到期的那一份原样退回，记下 `游戏:ref`（最近 16 个）
    for (const [key, k] of Object.entries(s.stakes)) {
      if (k.until > now) continue;
      s.balance += k.amount;
      if (k.mode === 'client') s.cin[k.game] = Math.max(0, (s.cin[k.game] ?? 0) - k.amount);
      s.expired = [...s.expired, key].slice(-16);
      delete s.stakes[key];
    }
    return s;
  }

  private async save(s: State): Promise<void> {
    this.writes++;
    // 操作 id 只留最近 32 个
    const ops = Object.entries(s.ops);
    if (ops.length > 32) s.ops = Object.fromEntries(ops.slice(-32));
    await this.ctx.storage.put('w', { ...s, fresh: false });
  }

  private view(s: State): WalletView {
    const caps: WalletView['caps'] = {};
    for (const g of Object.keys(s.cin)) caps[g] = { net: (s.cout[g] ?? 0) - (s.cin[g] ?? 0), cap: WIN_UNITS * TIERS[s.top[g] ?? 'small'] };
    return {
      balance: s.balance,
      stakes: Object.values(s.stakes),
      canRelief: s.balance + onTable(s) < RELIEF_TO && s.reliefDay !== s.day,
      writesLeft: 1_000,
      caps,
      fresh: s.fresh,
    };
  }

  async look(now: number): Promise<WalletView> {
    this.calls++;
    return this.view(await this.load(now));
  }

  /** 只给测试用：直接把余额设成这个数（比如造一个只有 500 的人），不算调用和写入 */
  async setBalance(balance: number, now: number): Promise<void> {
    const s = await this.load(now);
    s.balance = balance;
    await this.ctx.storage.put('w', { ...s, fresh: false });
  }

  async run(c: Cmd, now: number): Promise<WalletReply> {
    this.calls++;
    const s = await this.load(now);
    const key = `${c.game}:${c.op}`;
    const before = s.ops[key];
    if (before) return { ...before, wallet: this.view(s), dup: true };
    const r = this.apply(s, c, now);
    if (!r.ok) return { ...r, wallet: this.view(s) };
    if (c.t === 'settle' && c.stats !== undefined) {
      const ignored = statsProblem(c.stats);
      this.stats.push({ game: c.game, ref: c.ref, stats: c.stats, ...(ignored ? { ignored } : {}) });
      if (ignored) r.statsIgnored = ignored;
    }
    s.ops[key] = r;
    await this.save(s);
    return { ...r, wallet: this.view(s) };
  }

  private apply(s: State, c: Cmd, now: number): Done | { ok: false; error: string } {
    const sk = `${c.game}:${c.ref}`;
    const k = s.stakes[sk];
    if (c.t === 'buyin') {
      const tier = c.tier!;
      const amount = c.amount!;
      if (amount < 1 || amount > TIERS[tier]) return { ok: false, error: 'bad_amount' };
      if (c.until! <= now) return { ok: false, error: 'bad_until' };
      if (s.expired.includes(sk)) return { ok: false, error: 'expired' };
      if (k && k.tier !== tier) return { ok: false, error: 'at_table' };
      if (k && k.mode !== c.mode) return { ok: false, error: 'bad_mode' };
      // 新开一份、补码都只要余额够这次的数（平台 0.10.2）
      if (s.balance < amount) return { ok: false, error: 'no_funds' };
      const until = Math.min(c.until!, now + DAY_MS);
      if (k) {
        k.amount += amount;
        k.until = Math.max(k.until, until);
      } else {
        s.stakes[sk] = { game: c.game, ref: c.ref, tier, amount, mode: c.mode, at: now, until };
      }
      s.balance -= amount;
      if (!s.top[c.game] || TIERS[tier] > TIERS[s.top[c.game]!]) s.top[c.game] = tier;
      if (c.mode === 'client') s.cin[c.game] = (s.cin[c.game] ?? 0) + amount;
      return { ok: true };
    }
    if (!k) return { ok: false, error: s.expired.includes(sk) ? 'expired' : 'no_stake' };
    if (k.mode !== c.mode) return { ok: false, error: 'bad_mode' };
    if (c.t === 'refund') {
      delete s.stakes[sk];
      s.balance += k.amount;
      if (k.mode === 'client') s.cin[c.game] = Math.max(0, (s.cin[c.game] ?? 0) - k.amount);
      return { ok: true, credited: k.amount };
    }
    const amount = c.amount!;
    if (amount > k.amount + SETTLE_EXTRA_UNITS * TIERS[k.tier]) return { ok: false, error: 'bad_amount' };
    delete s.stakes[sk];
    let credited = amount;
    if (k.mode === 'client') {
      // 当天净赢最多 WIN_UNITS 份；带上桌的那一份总能拿回来
      const room = WIN_UNITS * TIERS[s.top[c.game] ?? k.tier] - ((s.cout[c.game] ?? 0) - (s.cin[c.game] ?? 0));
      credited = Math.min(amount, Math.max(room, Math.min(amount, k.amount)));
      s.cout[c.game] = (s.cout[c.game] ?? 0) + credited;
    }
    s.balance += credited;
    return credited < amount ? { ok: true, credited, capped: amount - credited } : { ok: true, credited };
  }

  /** 领补给（15.9）：余额加桌上的不到补给额、今天没领过，补到补给额（平台 0.10.2 起桌上有筹码也能领） */
  async relief(now: number): Promise<{ status: number; body: { error?: string; wallet: WalletView } }> {
    this.calls++;
    const s = await this.load(now);
    const total = s.balance + onTable(s);
    if (total >= RELIEF_TO) return { status: 409, body: { error: 'relief_not_needed', wallet: this.view(s) } };
    if (s.reliefDay === s.day) return { status: 409, body: { error: 'relief_used', wallet: this.view(s) } };
    s.balance += RELIEF_TO - total;
    s.reliefDay = s.day;
    await this.save(s);
    return { status: 200, body: { wallet: this.view({ ...s, fresh: false }) } };
  }
}

const bank = (env: FakeEnv, userId: string) => env.FAKE_BANK.get(env.FAKE_BANK.idFromName(userId));

/** 平台给游戏的 RPC（5.9）：绑定写 `entrypoint: "WalletService"`、`props: { game }` */
export class WalletService extends WorkerEntrypoint<FakeEnv, { game?: string }> {
  async view(userId: string): Promise<WalletReply> {
    if (!this.bound()) return { ok: false, error: 'bad_game' };
    return { ok: true, wallet: await bank(this.env, userId).look(Date.now()) };
  }
  buyin(req: unknown): Promise<WalletReply> {
    return this.op('buyin', req);
  }
  settle(req: unknown): Promise<WalletReply> {
    return this.op('settle', req);
  }
  refund(req: unknown): Promise<WalletReply> {
    return this.op('refund', req);
  }

  private bound(): string | null {
    const g = this.ctx.props?.game;
    return typeof g === 'string' && g !== '' ? g : null;
  }

  private async op(t: Cmd['t'], req: unknown): Promise<WalletReply> {
    const game = this.bound();
    // 平台先查绑定和 game，参数不对也先回这个
    if (!game || (req as { game?: unknown } | null)?.game !== game) return { ok: false, error: 'bad_game' };
    const q = req as Record<string, unknown>;
    const okId = (x: unknown) => typeof x === 'string' && ID.test(x);
    const okNum = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
    if (typeof q.userId !== 'string' || q.userId === '' || !okId(q.ref) || !okId(q.op) || (q.mode !== 'server' && q.mode !== 'client')) return { ok: false, error: 'bad_request' };
    if (t === 'buyin' && (!(typeof q.tier === 'string' && Object.hasOwn(TIERS, q.tier)) || !okNum(q.amount) || !okNum(q.until))) return { ok: false, error: 'bad_request' };
    if (t === 'settle' && !okNum(q.amount)) return { ok: false, error: 'bad_request' };
    const cmd: Cmd = { t, game, ref: q.ref as string, mode: q.mode as Mode, op: q.op as string };
    if (t === 'buyin') Object.assign(cmd, { tier: q.tier as Tier, amount: q.amount as number, until: q.until as number });
    if (t === 'settle') Object.assign(cmd, { amount: q.amount as number, ...(q.stats !== undefined ? { stats: q.stats } : {}) });
    return bank(this.env, q.userId).run(cmd, Date.now());
  }
}

/** 5.10 的检查：JSON 后 ≤ 256 字节；rounds、wins、best 非负整数；称号最多 5 个、格式；max + sum 最多 3 个 key、值是安全整数 */
export function statsProblem(x: unknown): StatsProblem | undefined {
  if (JSON.stringify(x).length > 256) return 'too_big';
  const o = x as Record<string, unknown> | null;
  const nat = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!o || typeof o !== 'object' || !nat(o.rounds) || !nat(o.wins) || !nat(o.best)) return 'bad_stats';
  const id = /^[a-z][a-z0-9_]{0,23}$/;
  if (o.titles !== undefined && !(Array.isArray(o.titles) && o.titles.length <= 5 && o.titles.every((t) => typeof t === 'string' && id.test(t)))) return 'bad_stats';
  let keys = 0;
  for (const k of ['max', 'sum'] as const) {
    const m = o[k];
    if (m === undefined) continue;
    if (!m || typeof m !== 'object') return 'bad_stats';
    for (const [key, v] of Object.entries(m)) {
      if (!/^[a-z][a-z0-9_]{0,15}$/.test(key) || typeof v !== 'number' || !Number.isSafeInteger(v)) return 'bad_stats';
      keys++;
    }
  }
  return keys > 3 ? 'bad_stats' : undefined;
}

/** 浏览器的钱包接口（15.9）：认平台的会话 cookie（值就当 userId）；不是这两条路回 null，调用方接着处理别的 */
export async function walletHttp(request: Request, env: FakeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/wallet' && url.pathname !== '/api/wallet/relief') return null;
  const sid = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
  if (!sid) return Response.json({ error: 'login' }, { status: 401 });
  if (url.pathname === '/api/wallet') {
    if (request.method !== 'GET') return Response.json({ error: 'method' }, { status: 405 });
    return Response.json({ wallet: await bank(env, sid).look(Date.now()), tiers: TIERS, reliefTo: RELIEF_TO, winUnits: WIN_UNITS });
  }
  if (request.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 });
  if (request.headers.get('x-arcade') !== '1') return Response.json({ error: 'forbidden' }, { status: 403 });
  const r = await bank(env, sid).relief(Date.now());
  return Response.json(r.body, { status: r.status });
}
