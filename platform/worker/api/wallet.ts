/**
 * 钱包的核心（筹码体系第 1 步：docs/economy.md 第 3、4、6 节；接口、写入行数、限流见 docs/platform-backend.md 5.9）：
 * 类型、常量、纯函数的账（apply）和游戏参数的解析。不碰 D1、不碰请求；读写那一行在 wallet-store.ts，接口在 wallet-api.ts。
 * 依赖方向只有一个：wallet-api → wallet-store → wallet（这里不 import 那两个）。
 *
 * - 账是纯函数（apply）：输入这一行的状态、一条操作、现在的时间，输出新状态或者拒绝的理由。
 *   操作 id 幂等、到期退回、记下退回过的 ref；每个游戏可以同时有几份在桌上。
 * - 带入、结回、放弃只由游戏的服务端经 RPC 调（worker/wallet-service.ts）；浏览器只能看钱包、领补给（wallet-api.ts）。
 *
 * 筹码只是游戏积分：没有转给别人、买、换的路（docs/project.md 第 3 节、economy.md 第 0 节）。
 */
import { GAME_IDS } from '../../src/games';
import { HOUR } from './context';
import { beijingDate, beijingWeek } from './time';

/** 档位表（economy.md 第 2 节）：一份多少。所有游戏共用。 */
export const TIERS = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 } as const;
export type TierId = keyof typeof TIERS;

/** 余额封顶：安全整数以内 */
const MAX_BALANCE = 1_000_000_000_000;
/**
 * 每人每天最多写几次（各游戏合计）。到了上限不能再带入、领补给；结回、放弃、到期退回不受限（economy.md 第 4 节）。
 * 0.10.2 从 200 放到 1,000（维护者定）：只防脚本，正常玩碰不到；全站的钱包预算才是兜底
 */
export const DAILY_WRITES = 1_000;
/** 桌上那一份最长放多久（游戏给 until，超过的按这个算） */
const MAX_HOLD_MS = 24 * HOUR;
/** 一次结回最多 = 带上桌的 + 这么多份：只防写错（比如多乘了个 100），不防作弊。好友房一桌最多几个人，赢走全桌也到不了 */
const SETTLE_SLACK_UNITS = 20;
/** 记住最近几次操作的 id 和结果：游戏重发、补发都在这个范围里 */
const RECENT_OPS = 32;
/** 记住最近几个到期退回过的 ref（"游戏:ref"）：它们再来结回就拒绝，买入已经退过了 */
const RECENT_EXPIRED = 16;
/** 每个钱包留最近几次管理员调整 */
const ADMIN_LOG = 20;
/** 钱包流水留几条：一条约 60 字节，30 条不到 2 KB */
const LEDGER = 30;
/**
 * 管理员能随时调的几条规则（0.10.6，存在 settings 的 wallet_rules 一行里，读写和缓存在 wallet-store.ts），改了不用发版；
 * 没设过、读不到就是代码里的默认值。只有这四条，别的数（每天写入次数、到期时间这些）仍是常量。
 */
export interface WalletRules {
  /** 补给补到多少 */
  reliefTo: number;
  /** 单机实盘每个游戏每天最多净赢几份 */
  winUnits: number;
  /** 新号第一次用钱包时送多少 */
  newBalance: number;
  /** 管理员单次加减最多多少 */
  adminAdjustMax: number;
}

/** 战绩小结 JSON 后最多几字节（docs/platform-backend.md 5.10） */
const STATS_MAX_BYTES = 256;
/** 一份最多算几局：德州坐一晚上可能上千手，超出的截掉，不整份忽略 */
const STATS_MAX_ROUNDS = 1_000;
/** 每个游戏最多记几个称号、几个自定义数的 key（游戏改名换 key 时旧的留着） */
const CAREER_TITLES = 64;
const CAREER_KEYS = 8;

/** 规则的默认值（没设过、读不到时用） */
export const DEFAULT_RULES: WalletRules = {
  // 小档一份
  reliefTo: 2_000,
  // economy.md 第 4 节；0.10.2 从 3 份放到 10 份（维护者定）
  winUnits: 10,
  newBalance: 10_000,
  // 防多打几个 0
  adminAdjustMax: 1_000_000,
};
/** 操作 id、ref 的样子 */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type Mode = 'server' | 'client';

/** 桌上那一份 */
export interface Stake {
  game: string;
  ref: string;
  tier: TierId;
  amount: number;
  mode: Mode;
  at: number;
  until: number;
}

/** 某个游戏当天的计数 */
export interface GameDay {
  /** 带入（所有模式，统计用） */
  in: number;
  /** 结回进了钱包的（所有模式，统计用） */
  out: number;
  /** 放弃、到期退回的 */
  back: number;
  /** 超出每日上限、没进钱包的 */
  capped: number;
  /** client 模式带入的（放弃、到期退回时减回去，不低于 0）：算净赢用 */
  cin: number;
  /** client 模式结回的：净赢 = cout − cin */
  cout: number;
  /** 当天在这个游戏带入过的最高档的一份；0 是今天还没带入过 */
  top: number;
}

/** 一天的计数（北京日期） */
export interface DayCounters {
  day: string;
  writes: number;
  /** 新号送的 */
  grant: number;
  /** 补给补进来的 */
  relief: number;
  /** 管理员调整的净额（0.9.4；之前的状态里没有这一项，按 0 算） */
  admin?: number;
  games: Record<string, GameDay>;
}

/** 一次管理员调整（0.9.4）：amount 是实际加减的（扣到 0、加到上限时比要的少），by 是管理员的用户名 */
export interface AdminAdjust {
  at: number;
  amount: number;
  note: string;
  by: string;
}

/** 一条流水：什么时候、哪种动作、哪个游戏、余额变了多少（带入是负的）；结回到顶没进钱包的在 capped */
export interface LedgerEntry {
  at: number;
  t: 'grant' | 'buyin' | 'settle' | 'refund' | 'expire' | 'relief' | 'admin';
  g?: string;
  a: number;
  capped?: number;
}

/** 一次操作的结果：重发时原样回给游戏 */
export interface OpResult {
  credited?: number;
  capped?: number;
  /** 结回带的小结被忽略了（钱照常结） */
  statsIgnored?: StatsError;
}

/** 结回时可选带的这一份小结（0.10.0，5.10）。游戏那边照抄文档里的同名类型 */
export interface SettleStats {
  rounds: number;
  wins: number;
  best: number;
  titles?: string[];
  max?: Record<string, number>;
  sum?: Record<string, number>;
}

export type StatsError = 'too_big' | 'bad_stats';

/** 一个人在一个游戏里的战绩（钱包 state 的 career[game]，对登录的人公开） */
export interface Career {
  /** 结回过几份（带不带小结都算） */
  n: number;
  /** 累计净赢：每份结回进钱包的 − 带上桌的 */
  net: number;
  /** 本周（北京时间这周一的日期）和本周净赢；读的时候 wk 不是这周就当 0 */
  wk: string;
  wnet: number;
  rounds: number;
  wins: number;
  best: number;
  /** 称号 id → 第一次拿到的时间 */
  titles: Record<string, number>;
  max: Record<string, number>;
  sum: Record<string, number>;
}

export interface WalletState {
  v: 1;
  balance: number;
  /** 桌上的筹码，key 是"游戏:ref"：同一个游戏可以同时有好几份（单机一桌加好友房，0.9.5） */
  stakes: Record<string, Stake>;
  /** 上次领补给的北京日期 */
  reliefDay: string;
  today: DayCounters;
  /** 上一个有计数的日子：Cron 第二天凌晨统计"昨天"时，今天已经碰过的钱包从这里取 */
  prev: DayCounters | null;
  /** 最近的操作：id 是"游戏:操作 id"，各游戏合计留 RECENT_OPS 个 */
  ops: { id: string; r: OpResult }[];
  expired: string[];
  /** 最近的管理员调整（0.9.4），留 ADMIN_LOG 条 */
  adminLog?: AdminAdjust[];
  /** 钱包流水（0.10.7，管理页看）：最近 LEDGER 条余额变动；之前的状态里没有 */
  ledger?: LedgerEntry[];
  /** 各游戏的战绩（0.10.0）；之前的状态里没有，第一次结回时建 */
  career?: Record<string, Career>;
  createdAt: number;
}

export type WalletError =
  | 'bad_request'
  | 'unknown_game'
  | 'bad_game'
  | 'no_user'
  | 'limit'
  | 'no_funds'
  | 'at_table'
  | 'bad_amount'
  | 'bad_until'
  | 'bad_mode'
  | 'no_stake'
  | 'expired'
  | 'relief_used'
  | 'relief_not_needed'
  | 'no_change'
  | 'busy'
  | 'internal';

export type Cmd =
  | { t: 'buyin'; game: string; ref: string; tier: TierId; amount: number; until: number; mode: Mode; op: string }
  | { t: 'settle'; game: string; ref: string; amount: number; mode: Mode; op: string; stats?: SettleStats; statsIgnored?: StatsError }
  | { t: 'refund'; game: string; ref: string; mode: Mode; op: string }
  | { t: 'relief' }
  | { t: 'admin'; amount: number; note: string; by: string };

/** 游戏和页面看到的钱包 */
export interface WalletView {
  balance: number;
  stakes: Stake[];
  /** 今天能不能领补给 */
  canRelief: boolean;
  /** 今天还能写几次（到 0 后不能再带入、领补给） */
  writesLeft: number;
  /** client 模式今天的净赢和上限（只列今天带入过的游戏） */
  caps: Record<string, { net: number; cap: number }>;
  /** 还没建过行（第一次写入时才真的建，余额就是 NEW_BALANCE） */
  fresh: boolean;
}

function careerOf(s: WalletState, game: string): Career {
  s.career ??= {};
  return (s.career[game] ??= { n: 0, net: 0, wk: '', wnet: 0, rounds: 0, wins: 0, best: 0, titles: {}, max: {}, sum: {} });
}

/** 给别人看的一个游戏的战绩：本周净赢不是这周的按 0 给 */
export interface CareerView {
  n: number;
  net: number;
  wnet: number;
  rounds: number;
  wins: number;
  best: number;
  /** 称号和第一次拿到的时间，先拿到的在前 */
  titles: { id: string; at: number }[];
  max: Record<string, number>;
  sum: Record<string, number>;
}

export function careerView(c: Career, week: string): CareerView {
  return {
    n: c.n,
    net: c.net,
    wnet: c.wk === week ? c.wnet : 0,
    rounds: c.rounds,
    wins: c.wins,
    best: c.best,
    titles: Object.entries(c.titles)
      .map(([id, at]) => ({ id, at }))
      .sort((a, b) => a.at - b.at),
    max: c.max,
    sum: c.sum,
  };
}

/** 一份结回记进战绩：净赢按钱算（不靠小结），小结里的局数、称号这些另加 */
function addCareer(s: WalletState, game: string, net: number, paid: number, stats: SettleStats | undefined, now: number): void {
  const c = careerOf(s, game);
  c.n++;
  c.net += net;
  const wk = beijingWeek(now);
  if (c.wk !== wk) {
    c.wk = wk;
    c.wnet = 0;
  }
  c.wnet += net;
  if (!stats) return;
  c.rounds += stats.rounds;
  c.wins += stats.wins;
  // 最大一把不超过这一份结回的钱：防游戏写错（比如多乘了个 100）
  c.best = Math.max(c.best, Math.min(stats.best, paid));
  for (const t of stats.titles ?? []) {
    if (!Object.hasOwn(c.titles, t) && Object.keys(c.titles).length < CAREER_TITLES) c.titles[t] = now;
  }
  for (const [k, v] of Object.entries(stats.max ?? {})) {
    if (Object.hasOwn(c.max, k)) c.max[k] = Math.max(c.max[k]!, v);
    else if (Object.keys(c.max).length < CAREER_KEYS) c.max[k] = v;
  }
  for (const [k, v] of Object.entries(stats.sum ?? {})) {
    if (Object.hasOwn(c.sum, k)) c.sum[k] = clampSum(c.sum[k]! + v);
    else if (Object.keys(c.sum).length < CAREER_KEYS) c.sum[k] = v;
  }
}

const clampSum = (x: number) => Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, x));

function emptyDay(day: string): DayCounters {
  return { day, writes: 0, grant: 0, relief: 0, admin: 0, games: {} };
}

function emptyGame(): GameDay {
  return { in: 0, out: 0, back: 0, capped: 0, cin: 0, cout: 0, top: 0 };
}

/** 新钱包：送 NEW_BALANCE，记在当天的"新号送的"里 */
export function freshState(now: number, rules: WalletRules): WalletState {
  const today = emptyDay(beijingDate(now));
  today.grant = rules.newBalance;
  const ledger: LedgerEntry[] = rules.newBalance ? [{ at: now, t: 'grant', a: rules.newBalance }] : [];
  return { v: 1, balance: rules.newBalance, stakes: {}, reliefDay: '', today, prev: null, ops: [], expired: [], createdAt: now, ledger };
}

const addBalance = (b: number, x: number) => Math.min(MAX_BALANCE, b + x);
const addLedger = (s: WalletState, e: LedgerEntry) => {
  s.ledger = [...(s.ledger ?? []), e].slice(-LEDGER);
};
const stakeKey = (game: string, ref: string) => `${game}:${ref}`;
const gameDay = (s: WalletState, game: string) => (s.today.games[game] ??= emptyGame());

/**
 * 碰一下钱包：过了北京时间 0 点，当天计数挪到 prev、从 0 算；到期的那一份原样退回、记下 ref。
 * 返回新状态（不改入参）和有没有到期退回（有就要写库）。
 */
export function normalize(s0: WalletState, now: number): { s: WalletState; expired: boolean } {
  const s: WalletState = structuredClone(s0);
  const day = beijingDate(now);
  if (s.today.day !== day) {
    if (s.today.writes || s.today.grant || s.today.admin) s.prev = s.today;
    s.today = emptyDay(day);
    // 跨零点还在桌上的 client 那一份算进新一天的带入和最高档：否则结回时本金被当成赢的、挤占上限；
    // 放弃、到期退回减 cin 时也才对得上
    for (const st of Object.values(s.stakes)) {
      if (st.mode !== 'client') continue;
      const g = gameDay(s, st.game);
      g.cin += st.amount;
      g.top = Math.max(g.top, TIERS[st.tier]);
    }
  }
  let expired = false;
  for (const [k, st] of Object.entries(s.stakes)) {
    if (now < st.until) continue;
    expired = true;
    s.balance = addBalance(s.balance, st.amount);
    addLedger(s, { at: now, t: 'expire', g: st.game, a: st.amount });
    const g = gameDay(s, st.game);
    g.back += st.amount;
    if (st.mode === 'client') g.cin = Math.max(0, g.cin - st.amount);
    s.expired = [...s.expired, k].slice(-RECENT_EXPIRED);
    delete s.stakes[k];
  }
  return { s, expired };
}

/** 余额加上桌上的：补给看的是这个（0.10.2 起桌上有筹码也能领，免得一小份卡在桌上就领不了） */
const holdings = (s: WalletState): number => Object.values(s.stakes).reduce((t, st) => t + st.amount, s.balance);

const canRelief = (s: WalletState, rules: WalletRules): boolean => holdings(s) < rules.reliefTo && s.reliefDay !== s.today.day;

/** 已经 normalize 过的状态 → 看到的钱包 */
export function viewOf(s: WalletState, fresh: boolean, rules: WalletRules): WalletView {
  const caps: WalletView['caps'] = {};
  for (const [game, g] of Object.entries(s.today.games)) {
    if (g.top) caps[game] = { net: g.cout - g.cin, cap: rules.winUnits * g.top };
  }
  return {
    balance: s.balance,
    stakes: Object.values(s.stakes),
    canRelief: canRelief(s, rules),
    writesLeft: Math.max(0, DAILY_WRITES - s.today.writes),
    caps,
    fresh,
  };
}

/**
 * 做一条操作。dup：这个操作 id 最近做过，什么都不改、不写，回当时的结果。
 * 拒绝时不写；成功时当天写入次数 + 1、记下操作 id 和结果。
 */
export function apply(
  s0: WalletState,
  cmd: Cmd,
  now: number,
  rules: WalletRules,
): { state: WalletState; result: OpResult } | { dup: OpResult } | { error: WalletError } {
  // 操作 id 按游戏分开记：两个游戏碰巧拼出同一个 op，不能拿到对方的结果当成重复
  const key = cmd.t === 'relief' || cmd.t === 'admin' ? '' : `${cmd.game}:${cmd.op}`;
  if (key) {
    const seen = s0.ops.find((o) => o.id === key);
    if (seen) return { dup: seen.r };
  }
  const { s } = normalize(s0, now);
  // 结回、放弃不受每天的次数管：桌上的筹码总要能回来（次数由带入那头管住）
  if ((cmd.t === 'buyin' || cmd.t === 'relief') && s.today.writes >= DAILY_WRITES) return { error: 'limit' };
  const before = s.balance;
  const out = step(s, cmd, now, rules);
  if ('error' in out) return out;
  addLedger(s, {
    at: now,
    t: cmd.t,
    ...(cmd.t === 'relief' || cmd.t === 'admin' ? {} : { g: cmd.game }),
    a: s.balance - before,
    ...(out.capped ? { capped: out.capped } : {}),
  });
  // 管理员调整不占这个人每天 DAILY_WRITES 次的写入
  if (cmd.t !== 'admin') s.today.writes++;
  if (key) s.ops = [...s.ops, { id: key, r: out }].slice(-RECENT_OPS);
  return { state: s, result: out };
}

/** 在 s 上就地改（s 是 normalize 出来的副本）。 */
function step(s: WalletState, cmd: Cmd, now: number, rules: WalletRules): OpResult | { error: WalletError } {
  switch (cmd.t) {
    case 'buyin': {
      const unit = TIERS[cmd.tier];
      if (cmd.amount < 1 || cmd.amount > unit) return { error: 'bad_amount' };
      if (cmd.until <= now) return { error: 'bad_until' };
      const until = Math.min(cmd.until, now + MAX_HOLD_MS);
      // 同一个游戏可以同时有好几份（单机一桌、好友房各一份），按 ref 分开
      const key = stakeKey(cmd.game, cmd.ref);
      const st = s.stakes[key];
      if (st) {
        // 补码：同一个 ref、同一档、同一种模式才能加到那一份上，到期时间取晚的
        if (st.tier !== cmd.tier) return { error: 'at_table' };
        if (st.mode !== cmd.mode) return { error: 'bad_mode' };
        if (s.balance < cmd.amount) return { error: 'no_funds' };
        st.amount += cmd.amount;
        st.until = Math.max(st.until, until);
      } else {
        // 这个 ref 已经到期退回过：再用它开一份，之后的结回就分不清是哪一份了
        if (s.expired.includes(key)) return { error: 'expired' };
        // 余额够这次带入就行（0.10.2 去掉了"钱包 ≥ 一整份"的进场要求，economy.md 第 2 节）
        if (s.balance < cmd.amount) return { error: 'no_funds' };
        s.stakes[key] = { game: cmd.game, ref: cmd.ref, tier: cmd.tier, amount: cmd.amount, mode: cmd.mode, at: now, until };
      }
      s.balance -= cmd.amount;
      const g = gameDay(s, cmd.game);
      g.in += cmd.amount;
      if (cmd.mode === 'client') g.cin += cmd.amount;
      g.top = Math.max(g.top, unit);
      return {};
    }
    case 'settle': {
      const key = stakeKey(cmd.game, cmd.ref);
      const st = s.stakes[key];
      if (!st) return { error: s.expired.includes(key) ? 'expired' : 'no_stake' };
      if (st.mode !== cmd.mode) return { error: 'bad_mode' };
      const unit = TIERS[st.tier];
      if (cmd.amount < 0 || cmd.amount > st.amount + SETTLE_SLACK_UNITS * unit) return { error: 'bad_amount' };
      const g = gameDay(s, cmd.game);
      let credited = cmd.amount;
      if (cmd.mode === 'client') {
        // 结回后净赢（cout − cin）不超过 winUnits 份；份按今天带入过的最高档（隔天结回的那一份也算上它自己的档）。
        // 带上桌的那一份总能拿回来，上限只管赢的部分
        const cap = rules.winUnits * Math.max(g.top, unit);
        const room = Math.max(st.amount, cap + g.cin - g.cout);
        credited = Math.min(cmd.amount, room);
        g.cout += credited;
      }
      const capped = cmd.amount - credited;
      s.balance = addBalance(s.balance, credited);
      g.out += credited;
      g.capped += capped;
      delete s.stakes[key];
      addCareer(s, cmd.game, credited - st.amount, cmd.amount, cmd.stats, now);
      const out: OpResult = capped ? { credited, capped } : { credited };
      if (cmd.statsIgnored) out.statsIgnored = cmd.statsIgnored;
      return out;
    }
    case 'refund': {
      const key = stakeKey(cmd.game, cmd.ref);
      const st = s.stakes[key];
      if (!st) return { error: s.expired.includes(key) ? 'expired' : 'no_stake' };
      if (st.mode !== cmd.mode) return { error: 'bad_mode' };
      s.balance = addBalance(s.balance, st.amount);
      const g = gameDay(s, cmd.game);
      g.back += st.amount;
      if (st.mode === 'client') g.cin = Math.max(0, g.cin - st.amount);
      delete s.stakes[key];
      return { credited: st.amount };
    }
    case 'admin': {
      // 加到余额上限、扣到 0 为止，只动余额，不碰桌上那一份；不算进实盘每日净赢
      const credited = cmd.amount > 0 ? Math.min(cmd.amount, MAX_BALANCE - s.balance) : -Math.min(-cmd.amount, s.balance);
      if (credited === 0) return { error: 'no_change' };
      s.balance += credited;
      s.today.admin = (s.today.admin ?? 0) + credited;
      s.adminLog = [...(s.adminLog ?? []), { at: now, amount: credited, note: cmd.note, by: cmd.by }].slice(-ADMIN_LOG);
      return { credited };
    }
    case 'relief': {
      // 补到"余额加桌上的"正好是补给额：补进来的都进余额
      const credited = rules.reliefTo - holdings(s);
      if (credited <= 0) return { error: 'relief_not_needed' };
      if (s.reliefDay === s.today.day) return { error: 'relief_used' };
      s.today.relief += credited;
      s.balance += credited;
      s.reliefDay = s.today.day;
      return { credited };
    }
  }
}

// ---------- 解析游戏传来的参数（只认形状；余额、桌上那一份这些在 apply 里查） ----------

const isId = (x: unknown): x is string => typeof x === 'string' && ID_RE.test(x);
const isChips = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isMode = (x: unknown): x is Mode => x === 'server' || x === 'client';
const isTier = (x: unknown): x is TierId => typeof x === 'string' && Object.hasOwn(TIERS, x);


/** 游戏传来的一条操作 → Cmd；形状不对返回错误码。game 是否认识也在这里查。 */
export function parseCmd(t: 'buyin' | 'settle' | 'refund', raw: unknown): Cmd | WalletError {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bad_request';
  const b = raw as Record<string, unknown>;
  if (typeof b.game !== 'string' || !GAME_IDS.has(b.game)) return 'unknown_game';
  if (!isId(b.ref) || !isId(b.op) || !isMode(b.mode)) return 'bad_request';
  const base = { game: b.game, ref: b.ref, op: b.op, mode: b.mode };
  switch (t) {
    case 'buyin':
      if (!isTier(b.tier) || !isChips(b.amount) || !isChips(b.until)) return 'bad_request';
      return { t, ...base, tier: b.tier, amount: b.amount, until: b.until };
    case 'settle': {
      if (!isChips(b.amount)) return 'bad_request';
      if (b.stats === undefined || b.stats === null) return { t, ...base, amount: b.amount };
      const stats = parseStats(b.stats);
      return typeof stats === 'string' ? { t, ...base, amount: b.amount, statsIgnored: stats } : { t, ...base, amount: b.amount, stats };
    }
    case 'refund':
      return { t, ...base };
  }
}

// 以字母开头：排除 __proto__ 这类会碰到原型的 key
const STAT_KEY = /^[a-z][a-z0-9_]{0,15}$/;
const TITLE_ID = /^[a-z][a-z0-9_]{0,23}$/;
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isPlain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * 小结 → 校验过的 SettleStats。超长、形状不对整份忽略（钱照常结）；局数超出只截断：德州一份能打上千手，
 * 赢的局数跟着截到不超过局数。
 */
function parseStats(raw: unknown): SettleStats | StatsError {
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    return 'bad_stats';
  }
  if (new TextEncoder().encode(text).length > STATS_MAX_BYTES) return 'too_big';
  if (!isPlain(raw) || !isCount(raw.rounds) || !isCount(raw.wins) || !isCount(raw.best)) return 'bad_stats';
  const rounds = Math.min(raw.rounds, STATS_MAX_ROUNDS);
  const out: SettleStats = { rounds, wins: Math.min(raw.wins, rounds), best: Math.min(raw.best, MAX_BALANCE) };
  if (raw.titles !== undefined) {
    if (!Array.isArray(raw.titles) || raw.titles.length > 5 || !raw.titles.every((t) => typeof t === 'string' && TITLE_ID.test(t))) return 'bad_stats';
    out.titles = [...new Set(raw.titles as string[])];
  }
  let keys = 0;
  for (const kind of ['max', 'sum'] as const) {
    const m = raw[kind];
    if (m === undefined) continue;
    if (!isPlain(m)) return 'bad_stats';
    const entries = Object.entries(m);
    if (!entries.every(([k, v]) => STAT_KEY.test(k) && typeof v === 'number' && Number.isSafeInteger(v))) return 'bad_stats';
    keys += entries.length;
    out[kind] = Object.fromEntries(entries) as Record<string, number>;
  }
  if (keys > 3) return 'bad_stats';
  return out;
}
