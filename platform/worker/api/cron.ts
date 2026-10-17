/**
 * 每天的清理（docs/platform-backend.md 7.3）：过期会话、窗口已过的限流计数、60 天前的每日榜、7 天前的计量行、1 年没登录的账号；
 * 清理前先记一行昨天的全站筹码统计（5.9）。
 * 写入记在"系统"类；每次最多删 cleanupMaxRows 行，删不完留到第二天，系统类预算用完就当天不清。
 */
import { feedCleanupCutoff } from './feed';
import type { Env } from '../env';
import { limitsOf } from './config';
import { DAY } from './context';
import { Db, newStats } from './db';
import { hourKey, meter } from './meter';
import { GAME_IDS } from '../../src/games';
import { deleteUserStatements } from './session';
import { beijingDate } from './time';
import { recordWalletStats } from './wallet-store';

export async function runCleanup(env: Env, now: number): Promise<{ rowsWritten: number; rowsRead: number }> {
  const limits = limitsOf(env);
  const stats = newStats();
  const db = new Db(env.DB, stats, 'sys');
  meter.countCall();
  try {
    await meter.ensureFresh(env.DB, limits, now);
    if (meter.tier(limits, now) === 'off' || meter.exhausted('sys', limits, now)) return { rowsWritten: 0, rowsRead: 0 };
    const budget = () => limits.cleanupMaxRows - stats.rowsWritten;

    // 先记昨天的全站筹码统计（1 行，economy.md 第 6 节），再删一年没来的账号：统计里还算着他们。出错不影响后面的清理。
    // 单独记行数：cleanupMaxRows 只管删，不让这 1 行挤掉一次删除（计量照样记在系统类）
    try {
      await recordWalletStats(new Db(env.DB, newStats(), 'sys'), now);
    } catch (e) {
      console.error('wallet stats failed', e instanceof Error ? e.name : 'unknown');
    }

    // 1 年没登录的账号：每个人的行数不定，按人删，删一个算一个。管理员不清：清掉最后一个就没人能建号了
    const inactive = await db.all<{ id: string; username: string }>(
      db.stmt("SELECT id, username FROM users WHERE last_seen_at < ?1 AND role = 'user' LIMIT ?2", now - limits.inactiveUserMs, limits.inactiveUsersPerRun),
    );
    for (const u of inactive) {
      if (budget() <= 0) break;
      await db.batch(deleteUserStatements(db, u.id, u.username));
    }
    // 会话删一行实测写 1 行；限流计数的窗口最长 24 小时、锁最长 1 小时，留 2 天足够
    if (budget() > 0) {
      await db.run(
        db.stmt(
          'DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at < ?1 LIMIT ?2)',
          now, budget(),
        ),
      );
    }
    if (budget() > 0) {
      await db.run(
        db.stmt(
          `DELETE FROM rate_counters WHERE key IN
             (SELECT key FROM rate_counters WHERE window_start < ?1 AND blocked_until < ?2 LIMIT ?3)`,
          now - 2 * DAY, now, budget(),
        ),
      );
    }
    // 旧的每日榜：board_id 是 daily-YYYY-MM-DD 或 daily-YYYY-MM-DD-v<n>（交分时已经卡住形式，boards.ts），
    // 按字典序 [daily-, daily-<截止日>) 正好是截止日以前的每日榜；每个游戏沿排名索引按范围取，只读要删的行
    for (const gameId of GAME_IDS) {
      if (budget() <= 0) break;
      await db.run(
        db.stmt(
          `DELETE FROM boards WHERE (user_id, game_id, board_id) IN
             (SELECT user_id, game_id, board_id FROM boards WHERE game_id = ?1 AND board_id >= 'daily-' AND board_id < ?2 LIMIT ?3)`,
          gameId, `daily-${beijingDate(now - limits.dailyBoardKeepDays * DAY)}`, budget(),
        ),
      );
    }
    // 好友动态留 feedKeepMs：id 带时间前缀，动态和赞都按主键范围删
    if (budget() > 0) {
      const cutoff = feedCleanupCutoff(now, limits);
      await db.run(db.stmt('DELETE FROM feed WHERE id IN (SELECT id FROM feed WHERE id < ?1 LIMIT ?2)', cutoff, budget()));
    }
    if (budget() > 0) {
      const cutoff = feedCleanupCutoff(now, limits);
      await db.run(
        db.stmt(
          'DELETE FROM feed_reactions WHERE (item_id, user_id) IN (SELECT item_id, user_id FROM feed_reactions WHERE item_id < ?1 LIMIT ?2)',
          cutoff, budget(),
        ),
      );
    }
    // 邀请 10 分钟就过期；留 2 天是为了按"最近 24 小时"数每人发了几条（invites.ts），表小，按发出时间扫
    if (budget() > 0) {
      await db.run(
        db.stmt('DELETE FROM invites WHERE id IN (SELECT id FROM invites WHERE created_at < ?1 LIMIT ?2)', now - 2 * DAY, budget()),
      );
    }
    if (budget() > 0) {
      const cutoff = hourKey(now - 7 * DAY);
      await db.run(
        db.stmt('DELETE FROM meter_hourly WHERE hour IN (SELECT hour FROM meter_hourly WHERE hour < ?1 LIMIT ?2)', cutoff, budget()),
      );
    }
    return { rowsWritten: stats.rowsWritten, rowsRead: stats.rowsRead };
  } finally {
    await meter.flush(env.DB, limits, now);
  }
}
