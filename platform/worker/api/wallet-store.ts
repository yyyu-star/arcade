/**
 * 钱包的存储：一人一行（wallets，迁移 0005），整行一个 JSON；更新带 rev 条件，同一个人两个游戏同时调钱包时冲突了就重读再算。
 * 还有管理员可调的规则（settings 里 wallet_rules 一行，带缓存）、今天在玩的人数、每天的统计（Cron）。
 * 账怎么算在 wallet.ts（这里只读、算、写回）；接口在 wallet-api.ts。
 */
import { DAY } from './context';
import type { Db } from './db';
import { ApiError } from './http';
import { readSetting, writeSettingStatement } from './settings';
import { beijingDate, beijingWeek } from './time';
import {
  apply,
  type Cmd,
  DEFAULT_RULES,
  freshState,
  type LedgerEntry,
  normalize,
  type StatsError,
  viewOf,
  type WalletError,
  type WalletRules,
  type WalletState,
  type WalletView,
} from './wallet';

// ---------- 存储：一人一行，带 rev 的乐观并发 ----------

interface Row {
  rev: number;
  state: string;
}

/** 两个游戏同时写同一个钱包时最多重试几次（每次重读、重算，写 0 行的冲突不算钱） */
const MAX_TRIES = 4;

async function readRow(db: Db, userId: string): Promise<Row | null> {
  return db.first<Row>(db.stmt('SELECT rev, state FROM wallets WHERE user_id = ?1', userId));
}

async function userExists(db: Db, userId: string): Promise<boolean> {
  return !!(await db.first(db.stmt('SELECT 1 AS x FROM users WHERE id = ?1', userId)));
}

/**
 * 写回：有行就按 rev 更新，没行就插入；被别人抢先了返回 false（0 行）。
 * retry：D1 一时出错时重试。两条语句本身幂等（rev 条件、DO NOTHING），但"写成了、回话丢了"再重试会写 0 行、走重读：
 * 带操作 id 的游戏操作重读后认出是重复、回当时的结果；没有 id 的（管理员调整）会再做一遍，所以只给游戏操作开。
 */
async function writeRow(db: Db, userId: string, row: Row | null, s: WalletState, now: number, retry = false): Promise<boolean> {
  const state = JSON.stringify(s);
  const meta = row
    ? await db.run(
        db.stmt('UPDATE wallets SET rev = ?1, state = ?2, updated_at = ?3 WHERE user_id = ?4 AND rev = ?5', row.rev + 1, state, now, userId, row.rev),
        { idempotent: retry },
      )
    : await db.run(
        db.stmt('INSERT INTO wallets (user_id, rev, state, updated_at) VALUES (?1, 1, ?2, ?3) ON CONFLICT (user_id) DO NOTHING', userId, state, now),
        { idempotent: retry },
      );
  return (meta.changes ?? 0) > 0;
}

export type WalletReply =
  | { ok: true; wallet: WalletView; credited?: number; capped?: number; statsIgnored?: StatsError; dup?: true; ledger?: LedgerEntry[]; week?: Record<string, number> }
  | { ok: false; error: WalletError; wallet?: WalletView };

/**
 * 读出、算、写回一条操作。opts.create：没有钱包时能不能建（停增长档不建）。
 * 被拒、重复写 0 行；成功写 1 行（冲突重试时失败的那几次 0 行）。
 */
export async function runOp(db: Db, userId: string, cmd: Cmd, now: number, opts: { create: boolean; rules?: WalletRules }): Promise<WalletReply> {
  const rules = opts.rules ?? (await walletRules(db, now));
  for (let i = 0; i < MAX_TRIES; i++) {
    const row = await readRow(db, userId);
    let s0: WalletState;
    if (row) s0 = JSON.parse(row.state) as WalletState;
    else {
      if (!(await userExists(db, userId))) return { ok: false, error: 'no_user' };
      s0 = freshState(now, rules);
    }
    const out = apply(s0, cmd, now, rules);
    if ('dup' in out) return { ok: true, wallet: viewOf(normalize(s0, now).s, !row, rules), ...out.dup, dup: true };
    if ('error' in out) return { ok: false, error: out.error, wallet: viewOf(normalize(s0, now).s, !row, rules) };
    if (!row && !opts.create) return { ok: false, error: 'busy' };
    if (await writeRow(db, userId, row, out.state, now, 'op' in cmd)) return { ok: true, wallet: viewOf(out.state, false, rules), ...out.result };
  }
  console.error('wallet write conflict');
  return { ok: false, error: 'busy' };
}

/**
 * 看钱包。到期的那一份要退回时写 1 行（opts.write 为 false 时只在回话里退、不写，比如只读档）；其余 0 行。
 * 没有钱包的人看到的是新钱包（余额是规则里的新号筹码，fresh），不建行。
 * opts.mine：本人看自己的钱包时多回的——流水（新的在前）和本周各游戏的净赢（这周玩过的才有，大厅卡片上显示）。
 * 游戏的 RPC 不要，免得每次多传 2 KB。
 */
export async function viewWallet(db: Db, userId: string, now: number, opts: { write: boolean; rules?: WalletRules; mine?: boolean }): Promise<WalletReply> {
  const rules = opts.rules ?? (await walletRules(db, now));
  const row = await readRow(db, userId);
  if (!row) {
    if (!(await userExists(db, userId))) return { ok: false, error: 'no_user' };
    return { ok: true, wallet: viewOf(freshState(now, rules), true, rules), ...(opts.mine && { ledger: [], week: {} }) };
  }
  const { s, expired } = normalize(JSON.parse(row.state) as WalletState, now);
  if (expired && opts.write) {
    s.today.writes++;
    // 抢输了也没关系：别人已经写了更新的状态，下次碰时再退
    await writeRow(db, userId, row, s, now);
  }
  if (!opts.mine) return { ok: true, wallet: viewOf(s, false, rules) };
  const wk = beijingWeek(now);
  const week: Record<string, number> = {};
  for (const [g, c] of Object.entries(s.career ?? {})) if (c.wk === wk) week[g] = c.wnet;
  return { ok: true, wallet: viewOf(s, false, rules), ledger: [...(s.ledger ?? [])].reverse(), week };
}

// ---------- 管理员可调的规则（0.10.6，settings 里 wallet_rules 一行） ----------

const RULES_KEY = 'wallet_rules';
/** 每个 isolate 记 30 秒，和注册开关一样：改了以后别的 isolate 最多晚 30 秒跟上 */
const RULES_CACHE_MS = 30_000;
/** 改动记录留几条 */
const RULES_LOG = 20;

/** 每条规则能调的范围：防手滑（比如多打几个 0），不是业务上限 */
export const RULE_RANGE: Record<keyof WalletRules, readonly [number, number]> = {
  reliefTo: [0, 1_000_000],
  winUnits: [1, 1_000],
  newBalance: [0, 10_000_000],
  adminAdjustMax: [1, 100_000_000],
};

/** 一次改动：谁、什么时候、哪几条从多少改成多少 */
export interface RulesChange {
  at: number;
  by: string;
  changes: Partial<Record<keyof WalletRules, [number, number]>>;
}

interface RulesValue {
  rules: Partial<WalletRules>;
  log: RulesChange[];
}

let rulesCache: { rules: WalletRules; at: number } | null = null;

export function resetWalletRulesCacheForTests(): void {
  rulesCache = null;
}

const inRange = (k: keyof WalletRules, v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= RULE_RANGE[k][0] && v <= RULE_RANGE[k][1];

/** 存着的值 → 完整的规则：缺的、不合格的用默认值 */
function mergeRules(saved: Partial<WalletRules>): WalletRules {
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof WalletRules)[]) if (inRange(k, saved[k])) out[k] = saved[k];
  return out;
}

/** 读那一行（管理页用，不走缓存）。没设过时规则全是默认值、记录是空的。 */
export async function readRulesRow(db: Db): Promise<{ rules: WalletRules; log: RulesChange[]; updatedAt: number | null }> {
  const row = await readSetting(db, RULES_KEY);
  const v = row ? (JSON.parse(row.value) as RulesValue) : { rules: {}, log: [] };
  return { rules: mergeRules(v.rules), log: v.log ?? [], updatedAt: row?.updated_at ?? null };
}

/** 钱包每次操作用的规则：30 秒缓存；读不到按默认值，钱包照常 */
export async function walletRules(db: Db, now: number): Promise<WalletRules> {
  if (rulesCache && now >= rulesCache.at && now - rulesCache.at < RULES_CACHE_MS) return rulesCache.rules;
  try {
    const { rules } = await readRulesRow(db);
    rulesCache = { rules, at: now };
    return rules;
  } catch {
    return DEFAULT_RULES;
  }
}

/**
 * 管理员改规则：只改传了的几条，每条要在 RULE_RANGE 里，不合格整个拒（bad_request）。没有真的变化时不写。
 * 返回要写的语句（1 行，settings）和新的值；调用方和管理员每日计数一起 batch。同一个 isolate 的缓存马上跟着变。
 */
export async function planRulesChange(
  db: Db,
  input: Record<string, unknown>,
  by: string,
  now: number,
): Promise<{ stmt: D1PreparedStatement | null; rules: WalletRules; log: RulesChange[] }> {
  const cur = await readRulesRow(db);
  const next = { ...cur.rules };
  const changes: RulesChange['changes'] = {};
  for (const k of Object.keys(DEFAULT_RULES) as (keyof WalletRules)[]) {
    if (input[k] === undefined) continue;
    if (!inRange(k, input[k])) throw new ApiError(400, 'bad_request', { field: k, range: RULE_RANGE[k] });
    if (input[k] !== cur.rules[k]) {
      changes[k] = [cur.rules[k], input[k]];
      next[k] = input[k];
    }
  }
  if (!Object.keys(changes).length) return { stmt: null, rules: cur.rules, log: cur.log };
  const log = [...cur.log, { at: now, by, changes }].slice(-RULES_LOG);
  const value: RulesValue = { rules: next, log };
  const stmt = writeSettingStatement(db, RULES_KEY, JSON.stringify(value), now);
  return { stmt, rules: next, log };
}

export function rememberRules(rules: WalletRules, now: number): void {
  rulesCache = { rules, at: now };
}

// ---------- 今天大家在玩什么（0.9.9，大厅卡片上的人数） ----------

/** 每个 isolate 记 10 分钟：一次读的行数 = 钱包数，来大厅的人再多，一个 isolate 10 分钟也只扫一遍 */
const PLAYING_TTL = 10 * 60 * 1000;
let playingCache: { day: string; at: number; counts: Record<string, number> } | null = null;

/**
 * 北京时间今天各游戏带筹码上过桌的人数（只有人数，不带名字）。不另写计数：今天的带入本来就记在每人的钱包行里。
 * 读不到就当没有，钱包照常回。
 */
export async function playingToday(db: Db, now: number): Promise<Record<string, number>> {
  const day = beijingDate(now);
  if (playingCache && playingCache.day === day && now - playingCache.at < PLAYING_TTL) return playingCache.counts;
  try {
    const rows = await db.all<{ game: string; n: number }>(
      db.stmt(
        `SELECT g.key AS game, COUNT(*) AS n FROM wallets, json_each(state, '$.today.games') AS g
         WHERE json_extract(state, '$.today.day') = ?1 AND json_extract(g.value, '$.in') > 0 GROUP BY g.key`,
        day,
      ),
    );
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.game] = r.n;
    playingCache = { day, at: now, counts };
    return counts;
  } catch {
    return {};
  }
}

// ---------- 每天的统计（Cron，economy.md 第 6 节） ----------

export interface DayStats {
  day: string;
  /** 记录时全站的筹码：余额 + 桌上的 */
  total: number;
  wallets: number;
  grant: number;
  relief: number;
  /** 管理员调整的净额（0.9.4 起有） */
  admin: number;
  /** 那天碰过钱包的人数、领了补给的人数（0.10.7 起有；之前的记录里没有） */
  active?: number;
  reliefCount?: number;
  /** 各游戏当天：带入、结回进钱包的、放弃和到期退回的、超出每日上限没进钱包的；players 是带筹码上过桌的人数（0.10.7 起有） */
  games: Record<string, { in: number; out: number; back: number; capped: number; players?: number }>;
}

/** 那一天的计数：当天碰过、之后没再碰的钱包在 today，第二天又碰过的挪到了 prev */
const DAY_OF = `CASE WHEN json_extract(state, '$.today.day') = ?1 THEN json_extract(state, '$.today')
                     WHEN json_extract(state, '$.prev.day') = ?1 THEN json_extract(state, '$.prev') END`;

/**
 * 汇总某一天（北京日期）的全站数。在 D1 里用 JSON 函数算，Worker 不逐行解析（免费版 Cron 每次只有 10 ms CPU）。
 * 读的行数 = 钱包数 × 2（两条查询各扫一遍）。
 */
export async function summarizeDay(db: Db, day: string): Promise<DayStats> {
  const [totals, games] = await Promise.all([
    db.first<{ wallets: number; total: number; grant: number; relief: number; admin: number; active: number; relief_n: number }>(
      db.stmt(
        `SELECT COUNT(*) AS wallets,
           COALESCE(SUM(CASE WHEN ${DAY_OF} IS NOT NULL THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN json_extract(${DAY_OF}, '$.relief') > 0 THEN 1 ELSE 0 END), 0) AS relief_n,
           COALESCE(SUM(json_extract(state, '$.balance')
             + COALESCE((SELECT SUM(json_extract(value, '$.amount')) FROM json_each(state, '$.stakes')), 0)), 0) AS total,
           COALESCE(SUM(json_extract(${DAY_OF}, '$.grant')), 0) AS "grant",
           COALESCE(SUM(json_extract(${DAY_OF}, '$.relief')), 0) AS relief,
           COALESCE(SUM(json_extract(${DAY_OF}, '$.admin')), 0) AS admin
         FROM wallets`,
        day,
      ),
    ),
    db.all<{ game: string; i: number; o: number; b: number; c: number; p: number }>(
      db.stmt(
        `SELECT g.key AS game, SUM(json_extract(g.value, '$.in')) AS i, SUM(json_extract(g.value, '$.out')) AS o,
           SUM(CASE WHEN json_extract(g.value, '$.in') > 0 THEN 1 ELSE 0 END) AS p,
           SUM(json_extract(g.value, '$.back')) AS b, SUM(json_extract(g.value, '$.capped')) AS c
         FROM (SELECT ${DAY_OF} AS d FROM wallets) AS w, json_each(w.d, '$.games') AS g
         WHERE w.d IS NOT NULL GROUP BY g.key ORDER BY g.key`,
        day,
      ),
    ),
  ]);
  const out: DayStats = {
    day,
    total: totals?.total ?? 0,
    wallets: totals?.wallets ?? 0,
    grant: totals?.grant ?? 0,
    relief: totals?.relief ?? 0,
    admin: totals?.admin ?? 0,
    active: totals?.active ?? 0,
    reliefCount: totals?.relief_n ?? 0,
    games: {},
  };
  for (const g of games) out.games[g.game] = { in: g.i, out: g.o, back: g.b, capped: g.c, players: g.p };
  return out;
}

/** Cron 每天一次：记下北京时间昨天的统计（1 行，记在系统类）。同一天已经记过就不再写（0 行）。 */
export async function recordWalletStats(db: Db, now: number): Promise<void> {
  const day = beijingDate(now - DAY);
  if (await db.first(db.stmt('SELECT 1 AS x FROM wallet_stats WHERE day = ?1', day))) return;
  const stats = await summarizeDay(db, day);
  await db.run(
    db.stmt('INSERT INTO wallet_stats (day, data, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (day) DO NOTHING', day, JSON.stringify(stats), now),
  );
}
