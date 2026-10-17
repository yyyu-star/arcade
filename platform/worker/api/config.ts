/**
 * 上限和阈值的默认值。数字的来历见 docs/platform-backend.md 5.4、6.6、15.6；
 * 线上要调就在 wrangler.jsonc 的 vars.LIMITS 里写要改的项；嵌套的 budget、readonly、off 可以只写其中几项（按项深合并）。
 */
import type { Env } from '../env';

export const DEFAULT_LIMITS = {
  /** PBKDF2 迭代次数；哈希串里记着次数，改了以后用户登录时透明重哈希。 */
  pbkdf2Iterations: 100_000,

  // 计量（6.6）
  meterFlushCalls: 50,
  meterFlushAnonAttempts: 10,
  meterFlushMs: 60_000,
  meterRetryMs: 10_000,
  /** 任何一项用到这个比例后，有真实写入就提前上报；两次之间至少隔 meterEagerMinMs。 */
  meterEagerRatio: 0.8,
  meterEagerMinMs: 1_000,
  /** 等一次上报最多等多久；D1 挂住时按上报失败处理（停服），免得整个 isolate 的请求跟着挂住。 */
  meterFlushTimeoutMs: 3_000,
  /**
   * D1 写入的分类预算（行/天，UTC）。合计 4 万不变。
   * 排行榜（board）从存档里分出 2_500（0.7.0）：交分一次最多 3 行，够 800 多次交分；刷榜只停排行榜，不把云存档挤停。
   * 钱包（wallet）再从存档里分出 3_000（0.9.0）：每次带入、结回、放弃、领补给 1 行，一场实盘 2 行，够 1,500 场；合计仍是 4 万。
   * 0.10.2 再从存档挪 3_000 给钱包（维护者定）：三个游戏都接了钱包，玩的人多了不该先撞上"服务器有点忙"；有几天实际用量后再调。
   * 好友在线和邀请（live，0.13.0，docs/social.md）：从存档、登录找回各挪 2_000。报位置每人每 2 分钟最多 1 行，50 人每天在线 2 小时约 3,000 行，邀请另算（platform-backend.md 15.13）。
   */
  budget: { reg: 2_700, auth: 10_000, save: 4_300, social: 5_000, acct: 2_000, board: 2_500, wallet: 6_000, live: 4_000, sys: 3_500 },
  /** 账号安全类超出预算后另给的封顶；0 表示不给超额。 */
  acctOverflow: 3_000,
  noGrowthDbBytes: 300_000_000,
  readonly: { calls: 40_000, rowsWritten: 50_000, rowsRead: 3_000_000, dbBytes: 400_000_000 },
  off: { calls: 60_000, rowsWritten: 80_000, rowsRead: 4_500_000 },

  // 限流（5.4、15.6）
  anonPerIpPerMinute: 10,
  regPerIpDay: 20,
  regAllDay: 300,
  loginPerIpHour: 30,
  loginAllHour: 300,
  recoverPerIpHour: 10,
  recoverAllHour: 100,
  /** 连续失败几次后开始等待，第一次等多久、最长等多久，失败计数多久清零。 */
  failFree: 5,
  failBaseMs: 30_000,
  failMaxMs: 3_600_000,
  failWindowMs: 86_400_000,
  profilePerDay: 10,
  acctPerDay: 10,
  /** 好友（5.6、15.6）：每天发请求、查好友码、换好友码、屏蔽的次数；待处理的请求（发出、收到各算）、好友数上限。 */
  friendRequestsPerDay: 30,
  friendCodeLookupsPerDay: 100,
  friendCodeChangesPerDay: 3,
  /** 屏蔽、解除屏蔽每天合计。 */
  friendBlocksPerDay: 30,
  friendPendingMax: 20,
  friendsMax: 200,
  /** 管理接口：令牌比对的失败名额（每个 IP、全站，每小时；比对成功的会还回去），每个管理员（或令牌）每天的写操作次数，账号列表最多几条。 */
  adminFailPerIpHour: 10,
  adminFailAllHour: 30,
  adminPerDay: 300,
  adminListMax: 500,

  // 云存档（5.5、15.3）
  /** 每人每天 PUT 次数（含冲突和 too_soon）。0.10.2 从 100 放到 500：自动存档玩得久的人会碰到，全站存档预算兜底。 */
  savePerDay: 500,
  /** 同一个槽两次写入至少隔多久。 */
  saveMinIntervalMs: 10_000,
  /** 每槽 data 序列化后的 UTF-8 字节数上限（keepalive 整个请求体 64 KB，留余量）。 */
  saveSlotBytes: 48 * 1024,
  saveSlotsPerGame: 8,
  /** 每人所有游戏合计。 */
  saveUserBytes: 256 * 1024,

  // 排行榜（简单版，不防作弊）
  /** 每人每天交分次数（所有游戏、所有榜合计）：一局交一次。0.10.2 从 50 放到 200，玩得多的人不该碰到；刷满也只用掉排行榜类预算。 */
  scorePerDay: 200,
  /** 算"我第几名"时最多数到多少，再多只说"多少名以后"（读的行数有上限）。 */
  boardRankCountMax: 10_000,
  /** 每日榜（board_id 形如 daily-YYYY-MM-DD[-v<n>]，北京时间）留多少天，Cron 删更早的。 */
  dailyBoardKeepDays: 60,

  // 会话（5.1）
  sessionTtlMs: 400 * 86_400_000,
  sessionRenewMs: 30 * 86_400_000,
  lastSeenEveryMs: 3_600_000,
  /** 报位置（0.13.0，docs/social.md 1.2）：浏览器每 2 分钟报一次，平台按这个节流（略短于 2 分钟，计时器的抖动不至于丢掉一半）；超过 presenceOnlineMs 没报算离线 */
  presenceEveryMs: 110_000,
  presenceOnlineMs: 300_000,
  /** 位置变了（进房、换游戏）马上写，但同一个人最快这么久写一次（0.14.1） */
  presenceMoveGapMs: 10_000,
  /** 邀请（0.14.0，docs/social.md 1.3）：10 分钟有效；每人 24 小时最多发这么多条、叫同一个好友至少隔这么久 */
  inviteTtlMs: 600_000,
  invitesPerDay: 50,
  inviteGapMs: 60_000,
  /** 好友动态（0.17.0，15.17）：每人每天（北京时间）最多几条（结回生成的和游戏报的合计）、留几天、每人每天赞和扔道具最多几次 */
  feedPerDay: 10,
  feedKeepMs: 7 * 86_400_000,
  feedReactPerDay: 100,
  /** 异步挑战（0.18.0，15.18）：有效期、每人每天发起几个、每个挑战最多几个人交 */
  challengeTtlMs: 30 * 86_400_000,
  challengesPerDay: 20,
  challengeMaxResults: 100,

  // Cron 清理（7.3）
  cleanupMaxRows: 3_000,
  inactiveUserMs: 365 * 86_400_000,
  inactiveUsersPerRun: 200,
};

export type Limits = typeof DEFAULT_LIMITS;

/** 覆盖值：嵌套的 budget、readonly、off 可以只写其中几项。 */
export type LimitsOverride = {
  [K in keyof Limits]?: Limits[K] extends object ? Partial<Limits[K]> : Limits[K];
};

/** 可以为 0 的项。 */
const ZERO_OK = new Set(['acctOverflow']);
/** 可以是小数的项（比例）；其余都是次数、行数、毫秒、字节、迭代数，必须是整数：比如迭代数写成小数，哈希串就验不回来了。 */
const FRACTION_OK = new Set(['meterEagerRatio']);

function ok(key: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (!FRACTION_OK.has(key) && !Number.isSafeInteger(v)) return false;
  return v > 0 || (v === 0 && ZERO_OK.has(key));
}

/**
 * 深合并：budget、readonly、off 按项合并；每个值都必须是正整数（比例可以是小数，acctOverflow 可以是 0），
 * 不合格的回退到原值并记一条日志。
 * 只写 readonly.calls 不会让同组的别的阈值变成 undefined，写错类型也不会让阈值失效。
 */
export function mergeLimits(base: Limits, override: unknown): Limits {
  if (!override || typeof override !== 'object') return base;
  const src = override as Record<string, unknown>;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, def] of Object.entries(base)) {
    if (!(key in src)) continue;
    const v = src[key];
    if (typeof def === 'number') {
      if (ok(key, v)) out[key] = v;
      else console.error('bad limit', key);
    } else if (v && typeof v === 'object') {
      const group = { ...(def as Record<string, number>) };
      for (const [sub, subDef] of Object.entries(group)) {
        const sv = (v as Record<string, unknown>)[sub];
        if (sv === undefined) continue;
        if (ok(`${key}.${sub}`, sv)) group[sub] = sv;
        else console.error('bad limit', `${key}.${sub}`, subDef);
      }
      out[key] = group;
    } else {
      console.error('bad limit', key);
    }
  }
  return out as Limits;
}

let testOverride: LimitsOverride | null = null;
const cache = new WeakMap<object, Limits>();

export function limitsOf(env: Env): Limits {
  let hit = cache.get(env);
  if (!hit) {
    hit = mergeLimits(DEFAULT_LIMITS, env.LIMITS);
    cache.set(env, hit);
  }
  return testOverride ? mergeLimits(hit, testOverride) : hit;
}

/** 只给测试用：临时改上限。传 null 恢复。 */
export function setLimitsForTests(override: LimitsOverride | null): void {
  testOverride = override;
}
