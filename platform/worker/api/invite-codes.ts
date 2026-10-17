/**
 * 邀请码（0.20.0，docs/platform-backend.md 15.20）：老用户生成码给朋友，朋友凭码注册，注册成功两人自动成为好友。
 * 公开注册关着时必须带码（auth.ts 的 register），开着时可填可不填。
 *
 * - 额度 = 已用的 + 还有效的（没用、没撤回、没过期）；过期、撤回的未用码把额度还回来。额度和"24 小时内最多生成几个"都写在插入语句的条件里，
 *   并发冲不破，被拒 0 行，不另开计数行（主线定）。
 * - 四个数（普通用户额度、管理员额度、有效期、每天上限）存在 settings 的 invite_rules，管理员能改、不用发版（同钱包规则）；
 *   单个人的额度在 users.invite_quota，空就按角色用默认。
 * - 码存明文（主线定），用掉、撤回、过期以后接口只给末 4 位。
 */
import { type Ctx, DAY } from './context';
import { formatInviteCode, newInviteCode, newTimeId } from './crypto';
import type { Db } from './db';
import { ApiError, json, noContent, rateLimited } from './http';
import { readSetting, writeSettingStatement } from './settings';

// ---------- 管理员可调的四个数 ----------

export interface InviteRules {
  userQuota: number;
  adminQuota: number;
  ttlDays: number;
  perDay: number;
}

export const DEFAULT_INVITE_RULES: InviteRules = { userQuota: 3, adminQuota: 50, ttlDays: 7, perDay: 5 };

/** 能调的范围：防手滑，不是业务上限 */
export const INVITE_RULE_RANGE: Record<keyof InviteRules, readonly [number, number]> = {
  userQuota: [0, 100],
  adminQuota: [0, 1000],
  ttlDays: [1, 90],
  perDay: [1, 100],
};

/** 单个人的额度能改到多少 */
export const USER_QUOTA_MAX = 1000;

const RULES_KEY = 'invite_rules';
/** 每个 isolate 记 30 秒，同钱包规则 */
const RULES_CACHE_MS = 30_000;
const RULES_LOG = 20;

interface RulesChange {
  at: number;
  by: string;
  changes: Partial<Record<keyof InviteRules, [number, number]>>;
}

let rulesCache: { rules: InviteRules; at: number } | null = null;

export function resetInviteRulesCacheForTests(): void {
  rulesCache = null;
}

const inRange = (k: keyof InviteRules, v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= INVITE_RULE_RANGE[k][0] && v <= INVITE_RULE_RANGE[k][1];

async function readRulesRow(db: Db): Promise<{ rules: InviteRules; log: RulesChange[]; updatedAt: number | null }> {
  const row = await readSetting(db, RULES_KEY);
  const v = row ? (JSON.parse(row.value) as { rules: Partial<InviteRules>; log?: RulesChange[] }) : { rules: {}, log: [] };
  const rules = { ...DEFAULT_INVITE_RULES };
  for (const k of Object.keys(DEFAULT_INVITE_RULES) as (keyof InviteRules)[]) if (inRange(k, v.rules[k])) rules[k] = v.rules[k];
  return { rules, log: v.log ?? [], updatedAt: row?.updated_at ?? null };
}

/** 生成、注册用的规则：30 秒缓存；读不到按默认值 */
export async function inviteRules(db: Db, now: number): Promise<InviteRules> {
  if (rulesCache && now >= rulesCache.at && now - rulesCache.at < RULES_CACHE_MS) return rulesCache.rules;
  try {
    const { rules } = await readRulesRow(db);
    rulesCache = { rules, at: now };
    return rules;
  } catch {
    return DEFAULT_INVITE_RULES;
  }
}

const defaultQuota = (rules: InviteRules, role: string) => (role === 'admin' ? rules.adminQuota : rules.userQuota);

// ---------- 自己的码 ----------

interface CodeRow {
  id: string;
  code: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
}

type Status = 'unused' | 'used' | 'expired' | 'revoked';

function statusOf(r: CodeRow, now: number): Status {
  if (r.used_at !== null) return 'used';
  if (r.revoked_at !== null) return 'revoked';
  return r.expires_at <= now ? 'expired' : 'unused';
}

/** 算进额度的：已用的，或者没撤回、没过期的。?1 是本人，?2 是现在 */
const TAKEN = `(SELECT COUNT(*) FROM invite_codes WHERE owner_id = ?1 AND (used_at IS NOT NULL OR (revoked_at IS NULL AND expires_at > ?2)))`;
/** 24 小时内生成的。?1 是本人，?3 是 24 小时前 */
const RECENT = `(SELECT COUNT(*) FROM invite_codes WHERE owner_id = ?1 AND created_at > ?3)`;

async function quotaState(c: Ctx, rules: InviteRules) {
  const me = c.session!.user;
  const row = await c.db.first<{ quota: number | null; taken: number; recent: number }>(
    c.db.stmt(`SELECT (SELECT invite_quota FROM users WHERE id = ?1) AS quota, ${TAKEN} AS taken, ${RECENT} AS recent`, me.id, c.now, c.now - DAY),
  );
  const quota = row?.quota ?? defaultQuota(rules, me.role);
  const taken = row?.taken ?? 0;
  return { quota, taken, left: Math.max(0, quota - taken), todayLeft: Math.max(0, rules.perDay - (row?.recent ?? 0)) };
}

/** 路径里的码 id：时间前缀 id 的形状，不对直接 404，不碰库 */
export function codeIdParams(segments: string[]): Record<string, string> {
  const id = segments[0] ?? '';
  if (!/^[0-9a-z]{9}[A-Za-z0-9_-]{11}$/.test(id)) throw new ApiError(404, 'not_found');
  return { id };
}

const LIST_MAX = 50;
const hint = (code: string) => `…${code.slice(-4)}`;

/** GET /api/invite-codes：额度、最近 50 个码。只读，0 行 */
export async function listMyCodes(c: Ctx): Promise<Response> {
  const rules = await inviteRules(c.db, c.now);
  const q = await quotaState(c, rules);
  const rows = await c.db.all<CodeRow & { used_by: string | null; display_name: string | null; avatar_json: string | null }>(
    c.db.stmt(
      `SELECT i.id, i.code, i.created_at, i.expires_at, i.used_at, i.revoked_at, i.used_by, u.display_name, u.avatar_json
       FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by
       WHERE i.owner_id = ?1 ORDER BY i.created_at DESC LIMIT ?2`,
      c.session!.user.id, LIST_MAX,
    ),
  );
  const codes = rows.map((r) => {
    const status = statusOf(r, c.now);
    return {
      id: r.id,
      hint: hint(r.code),
      ...(status === 'unused' ? { code: formatInviteCode(r.code) } : {}),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      status,
      ...(r.used_at !== null
        ? {
            usedAt: r.used_at,
            // 用的人注销了：used_by 已清空，显示"账号已注销"
            usedBy: r.used_by && r.display_name !== null ? { userId: r.used_by, displayName: r.display_name, avatar: r.avatar_json ? (JSON.parse(r.avatar_json) as unknown) : null } : null,
          }
        : {}),
    };
  });
  return json(200, { ...q, ttlDays: rules.ttlDays, codes });
}

/**
 * POST /api/invite-codes：生成一个。额度没满、24 小时内没满 perDay 才插进去（一条语句里判断，并发冲不破）。
 * 写入：表 + 两个索引 = 3 行；被拒 0 行（满了先只读查一遍给出准确的错误码）。码撞上唯一索引（60 bit，几乎不会）就换一个再试。
 */
export async function createCode(c: Ctx): Promise<Response> {
  const rules = await inviteRules(c.db, c.now);
  const me = c.session!.user;
  const q = await quotaState(c, rules);
  if (q.left <= 0) throw new ApiError(409, 'quota_full', { quota: q.quota });
  // 24 小时内生成满了：等最早那个满 24 小时（不精确到那一个，按 1 小时报，够用）
  if (q.todayLeft <= 0) throw rateLimited(3_600_000);
  const expiresAt = c.now + rules.ttlDays * DAY;
  for (let attempt = 0; ; attempt++) {
    const id = newTimeId(c.now);
    const code = newInviteCode();
    try {
      const meta = await c.db.run(
        c.db.stmt(
          `INSERT INTO invite_codes (id, code, owner_id, created_at, expires_at)
           SELECT ?4, ?5, ?1, ?2, ?6
           WHERE ${TAKEN} < COALESCE((SELECT invite_quota FROM users WHERE id = ?1), ?7) AND ${RECENT} < ?8`,
          me.id, c.now, c.now - DAY, id, code, expiresAt, defaultQuota(rules, me.role), rules.perDay,
        ),
      );
      // 并发里别的请求先占满了
      if (!meta.changes) throw new ApiError(409, 'quota_full', { quota: q.quota });
      return json(201, { id, code: formatInviteCode(code), link: `/i/${code}`, expiresAt, left: q.left - 1 });
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('invite_codes.code')) || attempt >= 2) throw e;
    }
  }
}

/** POST /api/invite-codes/<id>/revoke：撤回自己没用的码，额度还回来。1 行；不是自己的、已用、已撤回、已过期 404、0 行 */
export async function revokeCode(c: Ctx): Promise<Response> {
  const meta = await c.db.run(
    c.db.stmt(
      'UPDATE invite_codes SET revoked_at = ?1 WHERE id = ?2 AND owner_id = ?3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1',
      c.now, c.params.id!, c.session!.user.id,
    ),
  );
  if (!meta.changes) throw new ApiError(404, 'not_found');
  return noContent();
}

// ---------- 注册时用 ----------

/** 能用的码：没用、没撤回、没过期。只读 */
export async function findUsableCode(db: Db, code: string, now: number): Promise<{ id: string; owner_id: string } | null> {
  return db.first<{ id: string; owner_id: string }>(
    db.stmt('SELECT id, owner_id FROM invite_codes WHERE code = ?1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?2', code, now),
  );
}

/** 占码（注册 batch 的第一条）：条件更新，并发里只有一个人改得成。1 行 */
export function claimStatement(db: Db, id: string, userId: string, now: number): D1PreparedStatement {
  return db.stmt(
    'UPDATE invite_codes SET used_by = ?1, used_at = ?2 WHERE id = ?3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?2',
    userId, now, id,
  );
}

/** 注册成功顺带加好友：新号建成了、邀请人好友没满才加（满了只建号）。表 + user_b 索引 2 行 */
export function inviteFriendStatement(db: Db, ownerId: string, newId: string, now: number, friendsMax: number): D1PreparedStatement {
  const [a, b] = ownerId < newId ? [ownerId, newId] : [newId, ownerId];
  return db.stmt(
    `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at)
     SELECT ?1, ?2, 'accepted', ?3, ?4
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ?5)
       AND (SELECT COUNT(*) FROM friendships WHERE (user_a = ?3 OR user_b = ?3) AND status = 'accepted') < ?6`,
    a, b, ownerId, now, newId, friendsMax,
  );
}

// ---------- 管理 ----------

async function rulesState(c: Ctx) {
  const { rules, log, updatedAt } = await readRulesRow(c.db);
  return { rules, defaults: DEFAULT_INVITE_RULES, range: INVITE_RULE_RANGE, log: [...log].reverse(), updatedAt };
}

/** GET /api/admin/settings/invites：读 1 行 */
export async function getInviteRules(c: Ctx): Promise<Response> {
  return json(200, await rulesState(c));
}

/**
 * POST /api/admin/settings/invites {userQuota?, adminQuota?, ttlDays?, perDay?}：只改传了的，每条要在范围里，不合格整个 400。
 * 有变化时返回要写的语句（settings 1 行），调用方和管理员每日计数一起 batch；没变化返回 null
 */
export async function planInviteRulesChange(c: Ctx, by: string): Promise<{ stmt: D1PreparedStatement | null; rules: InviteRules }> {
  const cur = await readRulesRow(c.db);
  const next = { ...cur.rules };
  const changes: RulesChange['changes'] = {};
  for (const k of Object.keys(DEFAULT_INVITE_RULES) as (keyof InviteRules)[]) {
    const v = c.body[k];
    if (v === undefined) continue;
    if (!inRange(k, v)) throw new ApiError(400, 'bad_request', { field: k, range: INVITE_RULE_RANGE[k] });
    if (v !== cur.rules[k]) {
      changes[k] = [cur.rules[k], v];
      next[k] = v;
    }
  }
  if (!Object.keys(changes).length) return { stmt: null, rules: cur.rules };
  const log = [...cur.log, { at: c.now, by, changes }].slice(-RULES_LOG);
  return { stmt: writeSettingStatement(c.db, RULES_KEY, JSON.stringify({ rules: next, log }), c.now), rules: next };
}

export function rememberInviteRules(rules: InviteRules, now: number): void {
  rulesCache = { rules, at: now };
}

export { rulesState as inviteRulesState };

/** 管理页的全站列表：最近 100 个，看得到用户名（管理员本来就看得到） */
export async function adminCodes(c: Ctx): Promise<Response> {
  const status = new URL(c.request.url).searchParams.get('status') ?? 'all';
  if (!['all', 'unused', 'used'].includes(status)) throw new ApiError(400, 'bad_request');
  const where = status === 'used' ? 'WHERE i.used_at IS NOT NULL' : status === 'unused' ? 'WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?1' : '';
  const rows = await c.db.all<CodeRow & { owner_name: string | null; owner_display: string | null; used_name: string | null; used_display: string | null }>(
    c.db.stmt(
      `SELECT i.id, i.code, i.created_at, i.expires_at, i.used_at, i.revoked_at,
              o.username AS owner_name, o.display_name AS owner_display, u.username AS used_name, u.display_name AS used_display
       FROM invite_codes i LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users u ON u.id = i.used_by
       ${where} ORDER BY i.created_at DESC LIMIT 100`,
      // 只有"没用的"要比现在的时间；别的不带参数（多给 D1 会报绑定个数不对）
      ...(status === 'unused' ? [c.now] : []),
    ),
  );
  return json(200, {
    codes: rows.map((r) => {
      const st = statusOf(r, c.now);
      return {
        id: r.id,
        hint: hint(r.code),
        status: st,
        owner: r.owner_name ? { username: r.owner_name, displayName: r.owner_display } : null,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        ...(r.used_at !== null ? { usedAt: r.used_at, usedBy: r.used_name ? { username: r.used_name, displayName: r.used_display } : null } : {}),
      };
    }),
  });
}

/** 管理员撤回：没用的码才能撤（1 行），调用方加每日计数 */
export function adminRevokeStatement(db: Db, id: string, now: number): D1PreparedStatement {
  return db.stmt('UPDATE invite_codes SET revoked_at = ?1 WHERE id = ?2 AND used_at IS NULL AND revoked_at IS NULL', now, id);
}

/** 单个人的额度：整数 0–USER_QUOTA_MAX，或 null 恢复默认 */
export function parseUserQuota(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= USER_QUOTA_MAX) return v;
  throw new ApiError(400, 'bad_request', { max: USER_QUOTA_MAX });
}

// ---------- 清理 ----------

/** Cron：没用的码过期或撤回满 30 天就删（已用的留着，额度要算）。表小，按条件扫 */
export const INVITE_KEEP_MS = 30 * DAY;
export function cleanupStatement(db: Db, now: number, limit: number): D1PreparedStatement {
  return db.stmt(
    `DELETE FROM invite_codes WHERE id IN (SELECT id FROM invite_codes
       WHERE used_at IS NULL AND (expires_at < ?1 OR revoked_at < ?1) LIMIT ?2)`,
    now - INVITE_KEEP_MS, limit,
  );
}
