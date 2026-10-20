/**
 * 监控（docs/platform-backend.md 第 16 节）：健康检查、浏览器报错上报、每 5 分钟的巡检、给告警流程读的状态。
 * 仓库和 /api/monitor 都是公开的：这里返回、记下的只有模块、检查项和计数，没有域名、IP、用户名、userId。
 * 告警本身在 GitHub Actions 里（读 /api/monitor，转为失败开 issue、恢复关 issue），平台不发任何通知。
 */
import pkg from '../../package.json';
import { GAMES, GAME_IDS } from '../../src/games';
import type { Env } from '../env';
import { limitsOf, type Limits } from './config';
import type { Ctx } from './context';
import { Db, newStats } from './db';
import { ApiError, json, noContent } from './http';
import { meter } from './meter';
import { takeIpToken } from './ratelimit';
import { readSetting, writeSettingStatement } from './settings';

export const VERSION: string = pkg.version;
const STATE_KEY = 'monitor';
const MSG_MAX = 200;
const STACK_MAX = 1_000;
/** 同一签名上次记下的时间（本 isolate）：刷屏的报错 5 分钟只记一次 */
const lastLogged = new Map<string, number>();

/** 只给测试用：清掉本 isolate 记着的签名 */
export function resetMonitorForTests(): void {
  lastLogged.clear();
}

export interface Check {
  id: string;
  ok: boolean;
  n?: number;
  pct?: number;
  /** 游戏还没接健康检查（/health 回 404）：不算失败 */
  skip?: boolean;
}

interface State {
  at: number;
  checks: Check[];
  /** 各游戏当天报错总数的快照（只在变了时多一条），用来算"最近 10 分钟报了几条" */
  snaps: { at: number; day: string; totals: Record<string, number> }[];
}

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const clip = (v: unknown, max: number) => (typeof v === 'string' ? Array.from(v).slice(0, max).join('') : '');

/** GET /api/health：版本和数据库能不能查，不写库 */
export async function health(c: Ctx): Promise<Response> {
  let db = false;
  try {
    db = !!(await c.db.first<{ x: number }>(c.db.stmt('SELECT 1 AS x')));
  } catch {
    // 查不了就是 db: false
  }
  return json(db ? 200 : 503, { ok: db, version: VERSION, db });
}

/** 签名：游戏 + 报错前 80 字的哈希，不存原文 */
async function signature(game: string, msg: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${game}\n${Array.from(msg).slice(0, 80).join('')}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /api/client-error：浏览器报错（kit 的 reportErrors 用 sendBeacon 发，带不了 X-Arcade，只认 Origin）。
 * 每个 IP 每分钟 10 条（内存令牌桶，不碰 D1）；同一签名本 isolate 5 分钟只记一次：一行 console.error 进 Workers Logs，计数 upsert 1 行。
 */
export async function clientError(c: Ctx): Promise<Response> {
  const { game, ver, msg, stack, path } = c.body as Record<string, unknown>;
  if (typeof game !== 'string' || !GAME_IDS.has(game) || typeof msg !== 'string' || !msg.trim()) throw new ApiError(400, 'bad_request');
  takeIpToken(`ce:${await c.ipHash()}`, c.limits.clientErrorsPerIpPerMinute, c.now);
  const sig = await signature(game, msg);
  const last = lastLogged.get(sig);
  if (last !== undefined && c.now - last < c.limits.clientErrorDedupMs) return noContent();
  if (lastLogged.size >= 5_000) lastLogged.clear();
  lastLogged.set(sig, c.now);
  const version = clip(ver, 32) || '?';
  // 只留路径：查询串、#后面可能带房间码、邀请码
  const where = clip(path, 200).split(/[?#]/)[0];
  console.error(JSON.stringify({ kind: 'client-error', game, ver: version, sig, msg: clip(msg, MSG_MAX), stack: clip(stack, STACK_MAX) || undefined, path: where || undefined }));
  await c.db.run(
    c.db.stmt(
      `INSERT INTO monitor_counts (day, game, kind, sig, n, first_ver, ver, last_at) VALUES (?1, ?2, 'error', ?3, 1, ?4, ?4, ?5)
       ON CONFLICT (day, game, kind, sig) DO UPDATE SET n = monitor_counts.n + 1, ver = excluded.ver, last_at = excluded.last_at`,
      utcDay(c.now), game, sig, version, c.now,
    ),
  );
  return noContent();
}

async function readState(db: Db): Promise<State | null> {
  const row = await readSetting(db, STATE_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as State;
  } catch {
    return null;
  }
}

/** GET /api/monitor：公开、只读。巡检的结果加上现算的额度和"巡检本身还在跑吗" */
export async function monitorStatus(c: Ctx): Promise<Response> {
  const state = await readState(c.db);
  const pct = meter.usagePct(c.limits, c.now);
  const checks: Check[] = [
    ...(state?.checks ?? []),
    { id: 'quota', ok: pct === null || pct < c.limits.monitorQuotaPct, ...(pct === null ? {} : { pct }) },
    { id: 'cron', ok: !!state && c.now - state.at < c.limits.monitorStaleMs },
  ];
  return json(200, { checks, at: state?.at ?? null }, { 'cache-control': 'no-store' });
}

/** 查一个游戏的 /games/<id>/health（同域，5 秒超时）。404 = 游戏还没接，不算失败 */
async function gameHealth(origin: string, id: string, limits: Limits): Promise<Check> {
  try {
    const res = await fetch(`${origin}/games/${id}/health`, { signal: AbortSignal.timeout(limits.monitorHealthTimeoutMs), redirect: 'manual' });
    if (res.status === 404) return { id: `health:${id}`, ok: true, skip: true };
    const body = res.ok ? ((await res.json().catch(() => null)) as { ok?: unknown } | null) : null;
    return { id: `health:${id}`, ok: body?.ok === true };
  } catch {
    return { id: `health:${id}`, ok: false };
  }
}

/** 钱包总账的自检：余额、桌上的筹码都得是非负整数（每天一次） */
async function walletCheck(db: Db): Promise<Check> {
  const row = await db.first<{ bad: number }>(
    db.stmt(
      `SELECT COUNT(*) AS bad FROM wallets
       WHERE typeof(json_extract(state, '$.balance')) != 'integer' OR json_extract(state, '$.balance') < 0
          OR EXISTS (SELECT 1 FROM json_each(state, '$.stakes') AS s
                     WHERE typeof(json_extract(s.value, '$.amount')) != 'integer' OR json_extract(s.value, '$.amount') < 0)`,
    ),
  );
  const bad = row?.bad ?? 0;
  return { id: 'wallet', ok: bad === 0, ...(bad ? { n: bad } : {}) };
}

/** 当前版本才出现、以前几天没见过的签名里报得最多的那个有几次 */
async function newSignatureMax(db: Db, game: string, day: string): Promise<number> {
  const row = await db.first<{ n: number | null }>(
    db.stmt(
      `SELECT MAX(m.n) AS n FROM monitor_counts AS m
       WHERE m.day = ?1 AND m.game = ?2 AND m.kind = 'error'
         AND m.first_ver = (SELECT ver FROM monitor_counts WHERE day = ?1 AND game = ?2 ORDER BY last_at DESC LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM monitor_counts AS o WHERE o.game = ?2 AND o.sig = m.sig AND o.day < ?1)`,
      day, game,
    ),
  );
  return row?.n ?? 0;
}

/**
 * 每 5 分钟的巡检（第 2 个 Cron）。每天那次清理之后也跑一遍，顺带查钱包；其余几次沿用上次的钱包结果。
 * 状态放 settings 的 monitor 一行 JSON，只在结果变了时写（另外每小时写一次，/api/monitor 靠它判断巡检还在跑）
 */
export async function runMonitor(env: Env, now: number, opts: { wallet: boolean }): Promise<void> {
  const limits = limitsOf(env);
  const db = new Db(env.DB, newStats(), 'mon');
  meter.countCall();
  try {
    await meter.ensureFresh(env.DB, limits, now);
    if (meter.tier(limits, now) === 'off') return;
    const prev = await readState(db);
    const playable = GAMES.filter((g) => g.status === 'playable').map((g) => g.id);
    // 本地和一键部署没设站点地址：不查游戏
    const origin = env.SITE_ORIGIN;
    const healthChecks = origin ? await Promise.all(playable.map((id) => gameHealth(origin, id, limits))) : [];

    const day = utcDay(now);
    const rows = await db.all<{ game: string; total: number }>(
      db.stmt("SELECT game, SUM(n) AS total FROM monitor_counts WHERE day = ?1 AND kind = 'error' GROUP BY game", day),
    );
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.game] = r.total;
    // 10 分钟前的快照：快照只在变了时记，所以"10 分钟前或更早里最新的那条"就是 10 分钟前的数；跨天了按 0 算
    const snaps = prev?.snaps ?? [];
    const base = [...snaps].reverse().find((s) => s.at <= now - 600_000);
    const errorChecks: Check[] = [];
    for (const id of playable) {
      const recent = (totals[id] ?? 0) - (base?.day === day ? (base.totals[id] ?? 0) : 0);
      const fresh = recent > 0 ? await newSignatureMax(db, id, day) : 0;
      const ok = recent < limits.monitorErrorsPer10Min && fresh < limits.monitorNewSigMin;
      errorChecks.push({ id: `errors:${id}`, ok, ...(recent ? { n: recent } : {}) });
    }
    const wallet = opts.wallet ? await walletCheck(db) : prev?.checks.find((x) => x.id === 'wallet');
    const checks = [...healthChecks, ...errorChecks, ...(wallet ? [wallet] : [])];

    const totalsChanged = JSON.stringify(snaps.at(-1)?.totals ?? {}) !== JSON.stringify(totals) || snaps.at(-1)?.day !== day;
    // 快照只留 15 分钟内的，加一条更早的当基准
    const nextSnaps = totalsChanged ? [...snaps, { at: now, day, totals }] : snaps;
    const keepFrom = nextSnaps.findLastIndex((s) => s.at <= now - 900_000);
    const trimmed = keepFrom > 0 ? nextSnaps.slice(keepFrom) : nextSnaps;
    const changed = !prev || totalsChanged || JSON.stringify(prev.checks) !== JSON.stringify(checks);
    if (!changed && now - prev.at < limits.monitorHeartbeatMs) return;
    const state: State = { at: now, checks, snaps: trimmed };
    await db.run(writeSettingStatement(db, STATE_KEY, JSON.stringify(state), now));
  } catch (e) {
    console.error('monitor failed', e instanceof Error ? e.name : 'unknown');
  } finally {
    await meter.flush(env.DB, limits, now);
  }
}

/** 每天清理时删旧的报错计数（留 monitorKeepDays 天） */
export function monitorCleanupStatement(db: Db, now: number, limits: Limits, max: number): D1PreparedStatement {
  return db.stmt(
    `DELETE FROM monitor_counts WHERE (day, game, kind, sig) IN
       (SELECT day, game, kind, sig FROM monitor_counts WHERE day < ?1 LIMIT ?2)`,
    utcDay(now - limits.monitorKeepDays * 86_400_000), max,
  );
}
