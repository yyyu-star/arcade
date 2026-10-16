/**
 * 运行时设置（settings 表，迁移 0004，一个键一行）：这里管"开放注册"开关（维护者 2026-10-14 要求管理员随时能开关，改了不用重新部署）和大厅公告（0.10.8，见文件末尾）。
 * 钱包规则（wallet_rules）也存在这张表里，代码在 wallet-store.ts。
 *
 * 规则（维护者 2026-10-14 同意）：
 * - vars.REGISTRATION 是紧急总闸：只有 "switch"（不分大小写、去首尾空白）才听 D1 的开关；"off"、没设、写错、旧的 "open"/"closed" 一律强制关（fail-closed）。
 * - 听开关时：settings 里 registration = 'open' 才开，没有这一行按关。
 * - 注册接口每次读最新值（1 行）：关了以后不会还有人注册进来。
 * - /api/me 的 registration 字段用每个 isolate 30 秒的内存缓存：游戏闸门每次打开游戏首页都问 /api/me，不想给每次访问都加一次 D1 读；
 *   代价是登录页的"注册"入口最多晚 30 秒变。
 * 总闸关着时，管理接口和管理页明确说"开关暂时不起作用"，不会出现界面上开着、实际关着。
 *
 * 0.10.8 加大厅公告（key = notice，value 是 {"text", "by"} 的 JSON，没有这一行就是没公告）：
 * 只回给登录了的人（没带 cookie 的访客照样不碰 D1），和注册开关一样每个 isolate 缓存 30 秒，撤下以后最多晚 30 秒消失。
 */
import type { Env } from '../env';
import type { Ctx } from './context';
import type { Db } from './db';

const KEY = 'registration';
const CACHE_MS = 30_000;

/** 总闸：只有 "switch" 听开关，其余一律强制关。 */
export function registrationForcedOff(env: Env): boolean {
  return env.REGISTRATION?.trim().toLowerCase() !== 'switch';
}

let cache: { open: boolean; at: number } | null = null;

/** 读一个键；没有这一行是 null */
export function readSetting(db: Db, key: string): Promise<{ value: string; updated_at: number } | null> {
  return db.first<{ value: string; updated_at: number }>(db.stmt('SELECT value, updated_at FROM settings WHERE key = ?1', key));
}

/** 写一个键（有就改）：1 行 */
export function writeSettingStatement(db: Db, key: string, value: string, now: number): D1PreparedStatement {
  return db.stmt(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, value, now,
  );
}

export function resetSettingsCacheForTests(): void {
  cache = null;
  noticeCache = null;
}

/** D1 里的开关（不管总闸）。 */
export async function readRegistrationSwitch(db: Db): Promise<{ open: boolean; updatedAt: number | null }> {
  const row = await readSetting(db, KEY);
  return { open: row?.value === 'open', updatedAt: row?.updated_at ?? null };
}

/** 注册时用：每次读最新值。 */
export async function registrationOpenFresh(c: Ctx): Promise<boolean> {
  if (registrationForcedOff(c.env)) return false;
  const { open } = await readRegistrationSwitch(c.db);
  cache = { open, at: c.now };
  return open;
}

/** /api/me 用：30 秒缓存；停服档或读不到时按关（只影响登录页露不露"注册"，真正注册时还会再读）。 */
export async function registrationOpenCached(c: Ctx): Promise<boolean> {
  if (registrationForcedOff(c.env)) return false;
  if (cache && c.now >= cache.at && c.now - cache.at < CACHE_MS) return cache.open;
  if (c.tier === 'off') return false;
  try {
    return await registrationOpenFresh(c);
  } catch {
    return false;
  }
}

/** 管理员改开关：1 行。同一个 isolate 的缓存马上跟着变。 */
export function setRegistrationStatement(db: Db, open: boolean, now: number): D1PreparedStatement {
  return writeSettingStatement(db, KEY, open ? 'open' : 'closed', now);
}

export function rememberRegistration(open: boolean, now: number): void {
  cache = { open, at: now };
}

// ---------- 大厅公告（0.10.8） ----------

const NOTICE_KEY = 'notice';
/** 大厅顶上一行放得下；按字（码点）数 */
export const NOTICE_MAX = 120;

export interface Notice {
  text: string;
  at: number;
}

let noticeCache: { notice: Notice | null; at: number } | null = null;

/** 现在的公告和谁发的；坏数据当没有公告。 */
export async function readNotice(db: Db): Promise<(Notice & { by: string }) | null> {
  const row = await readSetting(db, NOTICE_KEY);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as { text?: unknown; by?: unknown };
    if (typeof v.text !== 'string' || !v.text) return null;
    return { text: v.text, at: row.updated_at, by: typeof v.by === 'string' ? v.by : '' };
  } catch {
    return null;
  }
}

/** /api/me 用：30 秒缓存；停服档或读不到时当没有公告（公告不值得让 /api/me 出错）。 */
export async function noticeCached(c: Ctx): Promise<Notice | null> {
  if (noticeCache && c.now >= noticeCache.at && c.now - noticeCache.at < CACHE_MS) return noticeCache.notice;
  if (c.tier === 'off') return null;
  try {
    const n = await readNotice(c.db);
    rememberNotice(n && { text: n.text, at: n.at }, c.now);
    return noticeCache!.notice;
  } catch {
    return null;
  }
}

/** 管理员发公告（text）或撤下（null）：1 行。 */
export function setNoticeStatement(db: Db, text: string | null, by: string, now: number): D1PreparedStatement {
  if (text === null) return db.stmt('DELETE FROM settings WHERE key = ?1', NOTICE_KEY);
  return writeSettingStatement(db, NOTICE_KEY, JSON.stringify({ text, by }), now);
}

export function rememberNotice(notice: Notice | null, now: number): void {
  noticeCache = { notice, at: now };
}
