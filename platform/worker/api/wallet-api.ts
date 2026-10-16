/**
 * 钱包的 HTTP 接口（docs/platform-backend.md 15.9）：浏览器看钱包、领补给；管理页的概况、统计和给人加减筹码。
 * 带入、结回、放弃不在这里，只有游戏经 RPC 调（worker/wallet-service.ts）。
 */
import type { Ctx } from './context';
import { ApiError, json, rateLimited } from './http';
import { beijingDate, beijingDayStart, beijingWeek, nextBeijingMidnight } from './time';
import { normalizeUsername } from './validate';
import { careerView, freshState, normalize, TIERS, viewOf, type WalletState } from './wallet';
import { type DayStats, playingToday, runOp, summarizeDay, viewWallet, walletRules } from './wallet-store';

// ---------- 浏览器的两个接口（docs/platform-backend.md 5.9） ----------

/** GET /api/wallet：看自己的钱包，加上档位表。只读档不写（到期的那一份在回话里退、下次再写）。 */
export async function getWallet(c: Ctx): Promise<Response> {
  const rules = await walletRules(c.db, c.now);
  const r = await viewWallet(c.db, c.session!.user.id, c.now, { write: c.tier === 'normal' || c.tier === 'noGrowth', rules, mine: true });
  if (!r.ok) throw new ApiError(500, 'internal');
  return json(200, {
    wallet: r.wallet,
    tiers: TIERS,
    reliefTo: rules.reliefTo,
    winUnits: rules.winUnits,
    playing: await playingToday(c.db, c.now),
    // 0.10.10：钱包页的"最近进出"，自己的最近 30 笔
    ledger: r.ledger ?? [],
    // 0.10.12：大厅卡片上"本周 +3,000"，这周玩过的游戏才有
    week: r.week ?? {},
  });
}

/** POST /api/wallet/relief：领每日补给。被拒 409（或今天写满 429），写 0 行；领到写 1 行。 */
export async function claimRelief(c: Ctx): Promise<Response> {
  const r = await runOp(c.db, c.session!.user.id, { t: 'relief' }, c.now, { create: c.tier === 'normal' });
  if (r.ok) return json(200, { wallet: r.wallet });
  if (r.error === 'limit') throw rateLimited(nextBeijingMidnight(c.now) - c.now);
  if (r.error === 'busy') throw new ApiError(503, 'busy');
  if (r.error === 'relief_used' || r.error === 'relief_not_needed') throw new ApiError(409, r.error, { wallet: r.wallet });
  throw new ApiError(500, 'internal');
}

/**
 * GET /api/admin/overview（0.10.7）：今日概况，加最近 7 天的趋势。写 0 行。
 * 今天的数现算（和 Cron 记昨天用的是同一个汇总，读的行数 = 钱包数 × 2），另数今天来过的账号（users 一遍）；
 * 前 6 天从 wallet_stats 里取（Cron 每天记一行，0.10.7 以前的记录没有人数）。
 */
export async function adminOverview(c: Ctx): Promise<Response> {
  const day = beijingDate(c.now);
  const dayStart = beijingDayStart(day);
  const [today, seen, rows] = await Promise.all([
    summarizeDay(c.db, day),
    c.db.first<{ n: number }>(c.db.stmt('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?1', dayStart)),
    c.db.all<{ data: string }>(c.db.stmt('SELECT data FROM wallet_stats WHERE day < ?1 ORDER BY day DESC LIMIT 6', day)),
  ]);
  return json(200, { today: { ...today, visitors: seen?.n ?? 0 }, days: rows.map((r) => JSON.parse(r.data) as DayStats) });
}

/** 管理页：最近 30 天的统计，新的在前。 */
export async function listWalletStats(c: Ctx): Promise<Response> {
  const rows = await c.db.all<{ data: string }>(c.db.stmt('SELECT data FROM wallet_stats ORDER BY day DESC LIMIT 30'));
  return json(200, { days: rows.map((r) => JSON.parse(r.data) as DayStats) });
}

// ---------- 管理员调整筹码（0.9.4，维护者给朋友加减；只认管理员会话，记在账号安全类） ----------

async function adminTarget(c: Ctx, username: unknown): Promise<{ id: string; username: string; display_name: string }> {
  if (typeof username !== 'string' || !username) throw new ApiError(400, 'bad_request');
  const u = await c.db.first<{ id: string; username: string; display_name: string }>(
    c.db.stmt('SELECT id, username, display_name FROM users WHERE username = ?1', normalizeUsername(username)),
  );
  if (!u) throw new ApiError(404, 'not_found');
  return u;
}

function onlySession(c: Ctx): string {
  // 令牌给管理命令行工具用，调筹码只在管理页做，这样记录里总有一个管理员的名字
  if (c.admin?.by !== 'session') throw new ApiError(403, 'not_admin');
  return c.session!.user.username;
}

/** GET /api/admin/wallet/<用户名>：昵称、钱包（没有钱包时是新号的样子）、这个人最近的调整。只读。 */
export async function adminLookup(c: Ctx): Promise<Response> {
  onlySession(c);
  const u = await adminTarget(c, c.params.username);
  const row = await c.db.first<{ state: string }>(c.db.stmt('SELECT state FROM wallets WHERE user_id = ?1', u.id));
  const rules = await walletRules(c.db, c.now);
  const s = row ? normalize(JSON.parse(row.state) as WalletState, c.now).s : freshState(c.now, rules);
  const week = beijingWeek(c.now);
  const career = Object.fromEntries(Object.entries(s.career ?? {}).map(([g, x]) => [g, careerView(x, week)]));
  return json(200, {
    user: { username: u.username, displayName: u.display_name },
    wallet: viewOf(s, !row, rules),
    log: [...(s.adminLog ?? [])].reverse(),
    // 0.10.7：战绩和流水（新的在前）；没有钱包的人流水是空的
    career,
    ledger: row ? [...(s.ledger ?? [])].reverse() : [],
  });
}

/** POST /api/admin/wallet/adjust {username, amount, note?}：加（正）或扣（负），写 1 行。没有钱包的先按新号建。 */
export async function adminAdjust(c: Ctx): Promise<Response> {
  const by = onlySession(c);
  const { amount, note } = c.body;
  const rules = await walletRules(c.db, c.now);
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > rules.adminAdjustMax) {
    // 上限管理员能调（0.10.6）：文案里写现在的数，管理窗口直接显示
    const max = rules.adminAdjustMax;
    throw new ApiError(400, 'bad_amount', { max, message: `数量要是不为 0 的整数，一次最多加减 ${max.toLocaleString('en-US')}` });
  }
  if (note !== undefined && typeof note !== 'string') throw new ApiError(400, 'bad_request');
  const cleanNote = (note ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  const u = await adminTarget(c, c.body.username);
  const r = await runOp(c.db, u.id, { t: 'admin', amount, note: cleanNote, by }, c.now, { create: c.tier === 'normal' });
  if (r.ok) return json(200, { wallet: r.wallet, credited: r.credited ?? 0 });
  if (r.error === 'no_change') throw new ApiError(409, 'no_change', { wallet: r.wallet });
  if (r.error === 'busy') throw new ApiError(503, 'busy');
  throw new ApiError(500, 'internal');
}

/** GET /api/admin/wallet-adjustments：全站最近 10 次调整。从各钱包里的记录汇总（只花读，不另存一份）。 */
export async function adminRecentAdjustments(c: Ctx): Promise<Response> {
  onlySession(c);
  const rows = await c.db.all<{ username: string; display_name: string; at: number; amount: number; note: string; by: string }>(
    c.db.stmt(
      `SELECT u.username, u.display_name, json_extract(l.value, '$.at') AS at, json_extract(l.value, '$.amount') AS amount,
         json_extract(l.value, '$.note') AS note, json_extract(l.value, '$.by') AS by
       FROM wallets w, json_each(w.state, '$.adminLog') l JOIN users u ON u.id = w.user_id
       ORDER BY at DESC LIMIT 10`,
    ),
  );
  return json(200, { recent: rows.map((r) => ({ username: r.username, displayName: r.display_name, at: r.at, amount: r.amount, note: r.note, by: r.by })) });
}
