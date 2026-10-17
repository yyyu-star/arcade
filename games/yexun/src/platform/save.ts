/**
 * 本机存档（localStorage `yexun.save`）和设置（`yexun.settings`，音效、音乐开关由 audio/ 读写，同一个 key 里各管各的字段）。
 * 存储不可用（隐私模式、满了）时照常能玩，只是不记得。云存档（`cloud.ts`）同步的就是这一份去掉本机字段后的样子，合并见 `mergeSave`。
 *
 * 局外成长（DESIGN.md 3.7、3.8）：铜钱只在游戏里，和筹码完全分开。铜钱不存一个总数，存"流水"（每局赚的、每次花的各一条，带 id）：
 * 两台设备各玩各花，合并时按 id 取并集再加总，不会因为"取较大的那个总数"白送或者扣成负数（5.5）。
 */
import { DANGER_IDS, type Danger, type Difficulty } from '../content/waves.ts';
import type { MapId } from '../content/maps.ts';
import { CHARACTER_IDS, CHARACTERS, CURSE_COIN_BONUS, CURSE_IDS, FIRST_RUN_COINS, RUN_BONUS, MAX_CURSES, PERK_IDS, PERKS, ASSIST, type CharacterId, type CurseId, type PerkId } from '../content/meta.ts';
import { readFlag, writeFlag } from '../view/audio/sfx.ts';
import { isLiveTier, type LiveTier } from '../content/live.ts';
import { emptyVault, herbalistUnlocked, normalizeVault, type VaultSave } from '../explore/vault.ts';

const SAVE_KEY = 'yexun.save';

export interface Best {
  /** 撑了多少拍（赢了 = 天亮） */
  ticks: number;
  kills: number;
  won: boolean;
}

/** 铜钱流水的一条：[id, 变化]；id 是局号或者"买了什么" */
export type Entry = [string, number];

export interface Save {
  v: 1;
  runs: number;
  wins: number;
  /** 引导做过的几条（moved / cards / chest），做过就不再提示 */
  tips: string[];
  /** 玩家点了"不再提示" */
  tipsOff: boolean;
  /** 上次选的难度（菜单三档）、地图 */
  difficulty: Difficulty;
  map: MapId;
  best: Partial<Record<Difficulty, Best>>;
  /** 上次选的危险档、角色、咒印 */
  danger: Danger;
  character: CharacterId;
  curses: CurseId[];
  /** 每个危险档的最好成绩（键是 0–5） */
  bestD: Partial<Record<Danger, Best>>;
  /** 撑到天亮过的最高危险档（−1 = 还没有）；下一档随之解锁 */
  cleared: number;
  /** 永久加成的等级 */
  perks: Partial<Record<PerkId, number>>;
  /** 花铜钱买下的角色（别的角色按成绩解锁，见 charOpen） */
  bought: CharacterId[];
  /** 铜钱流水，太长时最旧的并进 coinBase */
  ledger: Entry[];
  coinBase: number;
  /** 单局最长撑了几秒、最多打死几只（解锁角色用） */
  maxSeconds: number;
  maxKills: number;
  /** 藏宝阁：带出过的宝物（各几件）和见过的（夜探） */
  vault: VaultSave;
  /** 打过教学镇了（之后夜探才能选模板和危险档） */
  raidDone: boolean;
  /** 连着倒下几局（赢了、认输都清零） */
  streak: number;
  /** "降低伤害"开着（成绩不进总榜）；问过了没有（问过不再追着问，设置里能随时开关） */
  assist: boolean;
  assistAsked: boolean;
  /** 菜单上次停在实盘、选的哪一档（本机） */
  liveOn: boolean;
  liveTier: LiveTier;
}

/** 流水超过这么多条，最旧的并成一个数（并过的流水在两台设备上可能各算一次，所以留得够长：几百局才会碰到） */
const LEDGER_MAX = 400;

export const fresh = (): Save => ({
  v: 1,
  runs: 0,
  wins: 0,
  tips: [],
  tipsOff: false,
  difficulty: 'easy',
  map: 'snow',
  best: {},
  danger: 0,
  character: 'xiaodao',
  curses: [],
  bestD: {},
  cleared: -1,
  perks: {},
  bought: [],
  ledger: [],
  coinBase: 0,
  maxSeconds: 0,
  maxKills: 0,
  vault: emptyVault(),
  raidDone: false,
  streak: 0,
  assist: false,
  assistAsked: false,
  liveOn: false,
  liveTier: 'small',
});

const num = (v: unknown, min = 0, max = 1e12): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : null);
const strs = (v: unknown, max = 500): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(0, max) : []);
const best = (v: unknown): Best | null => {
  if (!v || typeof v !== 'object') return null;
  const b = v as Partial<Best>;
  const ticks = num(b.ticks);
  const kills = num(b.kills);
  return ticks === null || kills === null ? null : { ticks, kills, won: !!b.won };
};

/** 不可信的数据（本机旧档、云端）→ 干净的存档；读不懂的字段用默认值 */
export function reviveSave(o: unknown): Save | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (r.v !== 1) return null;
  const s = fresh();
  s.runs = num(r.runs) ?? 0;
  s.wins = num(r.wins) ?? 0;
  s.tips = strs(r.tips, 20);
  s.tipsOff = r.tipsOff === true;
  if (r.difficulty === 'easy' || r.difficulty === 'normal' || r.difficulty === 'hard') s.difficulty = r.difficulty;
  if (r.map === 'snow' || r.map === 'yizhuang') s.map = r.map;
  if (r.best && typeof r.best === 'object') {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const b = best((r.best as Record<string, unknown>)[d]);
      if (b) s.best[d] = b;
    }
  }
  const dg = num(r.danger, 0, 5);
  if (dg !== null) s.danger = dg as Danger;
  if (typeof r.character === 'string' && r.character in CHARACTERS) s.character = r.character as CharacterId;
  s.curses = CURSE_IDS.filter((c) => strs(r.curses).includes(c)).slice(0, MAX_CURSES);
  if (r.bestD && typeof r.bestD === 'object') {
    for (const d of DANGER_IDS) {
      const b = best((r.bestD as Record<string, unknown>)[d]);
      if (b) s.bestD[d] = b;
    }
  }
  s.cleared = num(r.cleared, -1, 5) ?? -1;
  if (r.perks && typeof r.perks === 'object') {
    for (const id of PERK_IDS) {
      const lv = num((r.perks as Record<string, unknown>)[id], 0, PERKS[id].cost.length);
      if (lv) s.perks[id] = lv;
    }
  }
  s.bought = CHARACTER_IDS.filter((c) => strs(r.bought).includes(c));
  if (Array.isArray(r.ledger)) {
    const seen = new Set<string>();
    for (const e of r.ledger) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || e[0].length > 64 || seen.has(e[0])) continue;
      const n = num(e[1], -1e9, 1e9);
      if (n === null) continue;
      seen.add(e[0]);
      s.ledger.push([e[0], n]);
    }
  }
  s.coinBase = num(r.coinBase, -1e9, 1e12) ?? 0;
  s.maxSeconds = num(r.maxSeconds) ?? 0;
  s.maxKills = num(r.maxKills) ?? 0;
  s.vault = normalizeVault(r.vault);
  s.raidDone = r.raidDone === true;
  s.streak = num(r.streak, 0, 1000) ?? 0;
  s.assist = r.assist === true;
  s.assistAsked = r.assistAsked === true;
  s.liveOn = r.liveOn === true;
  if (isLiveTier(r.liveTier)) s.liveTier = r.liveTier;
  return s;
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return (raw && reviveSave(JSON.parse(raw))) || fresh();
  } catch {
    return fresh();
  }
}

/** 存档写进本机以后通知（main.ts 接云存档：标记 profile 槽待上传） */
export const saveHooks = { onWrite: (): void => undefined };

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* 写不进去就算了 */
  }
  saveHooks.onWrite();
}

// ───────────────────────── 成绩 ─────────────────────────

/** a 比 b 好：先比赢没赢，再比撑的时间，再比击杀 */
function better(a: Best, b: Best | undefined): boolean {
  return !b || (a.won ? !b.won || a.kills > b.kills : !b.won && (a.ticks > b.ticks || (a.ticks === b.ticks && a.kills > b.kills)));
}

/** 记一局；返回这局是不是这个难度的新纪录；counts = false（认输）只记局数 */
export function recordRun(s: Save, d: Difficulty, run: Best, counts = true): boolean {
  s.runs++;
  if (run.won) s.wins++;
  if (!counts) {
    writeSave(s);
    return false;
  }
  const b = better(run, s.best[d]);
  if (b) s.best[d] = run;
  writeSave(s);
  return b;
}

export interface RunEnd {
  /** 这一局的 id（铜钱流水用；同一局在两台设备上不会重复） */
  id: string;
  danger: Danger;
  won: boolean;
  quit: boolean;
  ticks: number;
  kills: number;
  /** 局里捡到的铜钱 */
  coins: number;
  curses: number;
  /** 打倒了尸王 */
  boss?: boolean;
  /** 局里铜钱的来源（核心 w.coinBy）；没传就整笔算"捡到的" */
  coinBy?: { drop: number; purse: number; prop: number; chest: number };
  /** 今天的日期（北京时间 YYYY-MM-DD），每日首胜用；没传不发 */
  day?: string;
}

/** 结算页的一行：从哪来、几枚 */
export interface CoinSource {
  label: string;
  coins: number;
}

export interface RunReward {
  /** 这一局记进流水的铜钱（咒印加成、第一局保底以后） */
  coins: number;
  record: boolean;
  /** 刚好这一局解锁了下一档危险 */
  unlockedDanger: Danger | null;
  /** 该问"要不要降低伤害"了 */
  askAssist: boolean;
  /** 按来源分的明细（加起来 = coins，加上每日首胜那笔） */
  sources: CoinSource[];
}

/** 一局的铜钱明细：局里捡的按来源，再加撑的时间、击杀、天亮、尸王（按危险档放大）、咒印加成 */
export function runCoins(r: RunEnd): CoinSource[] {
  const out: CoinSource[] = [];
  const add = (label: string, n: number): void => {
    if (n > 0) out.push({ label, coins: Math.floor(n) });
  };
  const by = r.coinBy;
  if (by) {
    const rest = Math.max(0, r.coins - by.purse - by.chest - by.prop);
    add('捡到的铜钱', rest);
    add('碰碎的摆设', by.prop);
    add('铜钱袋', by.purse);
    add('宝箱', by.chest);
  } else add('捡到的铜钱', r.coins);
  const k = 1 + RUN_BONUS.dangerStep * r.danger;
  add(`撑了 ${Math.floor(r.ticks / 1800)} 分钟`, Math.floor(r.ticks / 1800) * RUN_BONUS.perMin * k);
  add(`打倒 ${r.kills} 只`, Math.floor(r.kills / RUN_BONUS.killsPer) * k);
  if (r.won) add('撑到天亮', RUN_BONUS.dawn * k);
  if (r.boss) add('打倒尸王', RUN_BONUS.boss * k);
  const sum = out.reduce((a, c) => a + c.coins, 0);
  if (r.curses > 0) add(`咒印 ${r.curses} 条`, sum * CURSE_COIN_BONUS * r.curses);
  return out;
}

/**
 * 一局结束（危险档那一套；菜单三档的 recordRun 另记）：铜钱进流水、危险档解锁、连死计数、解锁角色用的单局最好。
 * 第一局（无论胜负）至少给 FIRST_RUN_COINS，正好够买一级最便宜的加成（3.8）。
 */
export function finishRun(s: Save, r: RunEnd): RunReward {
  const first = s.ledger.every(([id]) => !id.startsWith('run:')) && s.coinBase === 0;
  s.runs++;
  if (r.won) s.wins++;
  const sources = runCoins(r);
  let coins = sources.reduce((a, c) => a + c.coins, 0);
  if (first && coins < FIRST_RUN_COINS) {
    sources.push({ label: '第一局见面礼', coins: FIRST_RUN_COINS - coins });
    coins = FIRST_RUN_COINS;
  }
  if (coins > 0) earn(s, `run:${r.id}`, coins);
  // 每日首胜：流水 id 带日期，同一天（两台设备也算）只记一次
  if (r.won && r.day && !s.ledger.some(([x]) => x === `dailywin:${r.day}`)) {
    earn(s, `dailywin:${r.day}`, RUN_BONUS.dailyWin);
    sources.push({ label: '今天第一次天亮', coins: RUN_BONUS.dailyWin });
    coins += RUN_BONUS.dailyWin;
  }
  const run: Best = { ticks: r.ticks, kills: r.kills, won: r.won };
  const record = !r.quit && better(run, s.bestD[r.danger]);
  if (record) s.bestD[r.danger] = run;
  let unlockedDanger: Danger | null = null;
  if (r.won && r.danger > s.cleared) {
    s.cleared = r.danger;
    if (r.danger < 5) unlockedDanger = (r.danger + 1) as Danger;
  }
  s.maxSeconds = Math.max(s.maxSeconds, Math.floor(r.ticks / 30));
  s.maxKills = Math.max(s.maxKills, r.kills);
  s.streak = !r.won && !r.quit ? s.streak + 1 : 0;
  const askAssist = !s.assist && !s.assistAsked && s.streak >= ASSIST.deaths;
  if (askAssist) s.assistAsked = true;
  writeSave(s);
  return { coins, record, unlockedDanger, askAssist, sources };
}

// ───────────────────────── 解锁 ─────────────────────────

/** 能选的最高危险档：撑到天亮过的下一档；第一局锁危险 0（13.2） */
export function dangerOpen(s: Save): Danger {
  return (s.runs === 0 ? 0 : Math.min(5, s.cleared + 1)) as Danger;
}

/** 义庄：雪原危险 1 撑到天亮（DESIGN.md 3.6）；老存档里普通、高手档赢过的也算 */
export function yizhuangOpen(s: Save): boolean {
  return s.cleared >= 1 || !!(s.best.normal?.won || s.best.hard?.won);
}

/** 角色解锁（3.7） */
export function charOpen(s: Save, c: CharacterId): boolean {
  switch (c) {
    case 'xiaodao':
      return true;
    case 'fushi':
      return s.maxSeconds >= 600;
    case 'jianxia':
      return s.maxKills >= 1500;
    case 'pang':
      return s.bought.includes('pang');
    case 'gengfu':
      return s.cleared >= 2;
    case 'caiyao':
      return herbalistUnlocked(s.vault);
  }
}

/** 花铜钱买的角色和价格 */
export const CHAR_PRICE: Partial<Record<CharacterId, number>> = { pang: 600 };

// ───────────────────────── 铜钱 ─────────────────────────

export function coins(s: Save): number {
  let n = s.coinBase;
  for (const [, v] of s.ledger) n += v;
  return n;
}

function earn(s: Save, id: string, n: number): void {
  if (s.ledger.some(([x]) => x === id)) return;
  s.ledger.push([id, n]);
  if (s.ledger.length > LEDGER_MAX) {
    const old = s.ledger.splice(0, s.ledger.length - LEDGER_MAX);
    for (const [, v] of old) s.coinBase += v;
  }
}

/** 记一笔别处来的铜钱（成就奖励等）；同一个 id 只记一次 */
export function grantCoins(s: Save, id: string, n: number): void {
  if (n <= 0) return;
  earn(s, id, n);
  writeSave(s);
}

/** 流水 id 要在两台设备上都不撞：带上本机的随机后缀（画面层传进来，核心不碰随机） */
function spend(s: Save, id: string, n: number): boolean {
  if (n > coins(s)) return false;
  earn(s, id, -n);
  return true;
}

/** 下一级的价格；满级为 null */
export function perkPrice(s: Save, id: PerkId): number | null {
  return PERKS[id].cost[s.perks[id] ?? 0] ?? null;
}

/** 买一级加成；nonce 让流水 id 唯一（画面层给一个随机串） */
export function buyPerk(s: Save, id: PerkId, nonce: string): boolean {
  const price = perkPrice(s, id);
  if (price === null || !spend(s, `perk:${id}:${(s.perks[id] ?? 0) + 1}:${nonce}`, price)) return false;
  s.perks[id] = (s.perks[id] ?? 0) + 1;
  writeSave(s);
  return true;
}

/** 全退：加成清零，花掉的铜钱全数还回来（3.8"随时全退重配"） */
export function refundPerks(s: Save, nonce: string): number {
  let back = 0;
  for (const id of PERK_IDS) for (let lv = 0; lv < (s.perks[id] ?? 0); lv++) back += PERKS[id].cost[lv]!;
  if (back <= 0) return 0;
  earn(s, `refund:${nonce}`, back);
  s.perks = {};
  writeSave(s);
  return back;
}

export function buyChar(s: Save, c: CharacterId, nonce: string): boolean {
  const price = CHAR_PRICE[c];
  if (price === undefined || s.bought.includes(c) || !spend(s, `char:${c}:${nonce}`, price)) return false;
  s.bought.push(c);
  writeSave(s);
  return true;
}

// ───────────────────────── 云存档合并 ─────────────────────────

/**
 * 两份存档合成一份（DESIGN.md 5.5）：集合取并集、计数和最好成绩取较好的、铜钱流水按 id 取并集。
 * 加成等级取较高的：两台设备各买了一级同一项时等级只算一次而钱扣了两次，偏向玩家吃亏一点而不是白送；
 * 全退一次（refund 流水）就能拿回来。本机才有意义的（上次选了什么、引导、连死、降低伤害）以本机为准。
 */
export function mergeSave(local: Save, cloud: Save): Save {
  const m: Save = { ...local };
  m.runs = Math.max(local.runs, cloud.runs);
  m.wins = Math.max(local.wins, cloud.wins);
  m.tips = [...new Set([...local.tips, ...cloud.tips])];
  for (const d of ['easy', 'normal', 'hard'] as const) {
    const c = cloud.best[d];
    m.best = { ...m.best };
    if (c && better(c, local.best[d])) m.best[d] = c;
  }
  m.bestD = { ...local.bestD };
  for (const d of DANGER_IDS) {
    const c = cloud.bestD[d];
    if (c && better(c, local.bestD[d])) m.bestD[d] = c;
  }
  m.cleared = Math.max(local.cleared, cloud.cleared);
  m.perks = { ...local.perks };
  for (const id of PERK_IDS) {
    const lv = Math.max(local.perks[id] ?? 0, cloud.perks[id] ?? 0);
    if (lv) m.perks[id] = lv;
  }
  m.bought = CHARACTER_IDS.filter((c) => local.bought.includes(c) || cloud.bought.includes(c));
  const seen = new Set(local.ledger.map(([id]) => id));
  m.ledger = [...local.ledger, ...cloud.ledger.filter(([id]) => !seen.has(id))];
  m.coinBase = Math.max(local.coinBase, cloud.coinBase);
  m.maxSeconds = Math.max(local.maxSeconds, cloud.maxSeconds);
  m.maxKills = Math.max(local.maxKills, cloud.maxKills);
  // 藏宝阁：每件取两边多的那个数，见过的取并集（两台设备各打各的都不丢）
  const got: Record<string, number> = { ...cloud.vault.got };
  for (const [id, n] of Object.entries(local.vault.got)) got[id] = Math.max(n, got[id] ?? 0);
  m.vault = normalizeVault({ got, seen: [...local.vault.seen, ...cloud.vault.seen] });
  m.raidDone = local.raidDone || cloud.raidDone;
  m.assistAsked = local.assistAsked || cloud.assistAsked;
  if (m.ledger.length > LEDGER_MAX) {
    const old = m.ledger.splice(0, m.ledger.length - LEDGER_MAX);
    for (const [, v] of old) m.coinBase += v;
  }
  return m;
}

/** 上云的内容：去掉只在本机有意义的字段 */
export function savePayload(s: Save): Omit<Save, 'difficulty' | 'map' | 'danger' | 'character' | 'curses' | 'streak' | 'assist' | 'tipsOff' | 'liveOn' | 'liveTier'> {
  const { difficulty: _d, map: _m, danger: _g, character: _c, curses: _u, streak: _s, assist: _a, tipsOff: _t, liveOn: _l, liveTier: _lt, ...rest } = s;
  return rest;
}

/** 设置里除了声音的几项（声音开关在 audio/ 里） */
export const settings = {
  get shake(): boolean {
    return readFlag('shake', true);
  },
  set shake(on: boolean) {
    writeFlag('shake', on);
  },
  /** 固定摇杆（左下角）；默认浮动摇杆（按哪儿出在哪儿） */
  get fixedStick(): boolean {
    return readFlag('fixedStick', false);
  },
  set fixedStick(on: boolean) {
    writeFlag('fixedStick', on);
  },
};
