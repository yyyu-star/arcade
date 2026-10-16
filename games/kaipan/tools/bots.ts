/**
 * 自动玩家：数值模拟（tools/sim.ts）和测试共用。按设计稿第 11 节：
 * - random：随机买卖。
 * - follower：总是买推荐里的第一只，从不卖。
 * - chaser：追最热的题材，热度下降就卖。
 * - normal：普通人。参考群友战绩，在升温早期买入，过热又遇到看空消息时卖出，分散在两个题材里。
 * - smart：对题材阶段做贝叶斯推断，结合群友的可信度做期望值决策。
 *   smart-focus（集中单题材）、smart-spread（每个题材最多一只）是它的两种仓位风格。
 * - oracle：知道真实阶段和当天的热度变化。
 * - qunzhu：无脑跟群主（买群主推荐的，群主说跌就卖）。
 * 除 oracle 外，机器人只看玩家能看到的信息（热度与走势、群聊、战绩、持仓、日历、自己的道具），
 * 不读题材真实阶段、今天预先掷好的行情等隐藏字段。
 */
import {
  BALANCE,
  ITEMS,
  MONTHS,
  STAGES,
  baseBill,
  canSell,
  coldPull,
  createRun,
  credibility,
  forwardRet,
  messageCred,
  topicsOf,
  turnOf,
  dispatch,
  dirOf,
  effectiveDH,
  failChance,
  feelOf,
  flipDir,
  fx,
  isBusy,
  marketRulesFor,
  totalDays,
  recCredibility,
  rngFor,
  rulesOf,
  stageDH,
  stageDays,
  stockById,
  stocksOf,
  canShortNow,
  collateralTerms,
  freeUnits,
  realDH,
  tapeIndex,
  validate,
  COLLATERAL_IDS,
  type Action,
  type Dir,
  type GameEvent,
  type GameState,
  type Segment,
  type MarketRules,
  type Rng,
  type Role,
  type Rules,
  type RunSetup,
  type Stage,
  type ThemeId,
} from '../src/core/index.ts';

export interface Bot {
  name: string;
  act(s: GameState, rng: Rng): Action;
}

/** 机器人工厂：有记忆的机器人每局要新建一个。 */
export type BotFactory = () => Bot;

/** 行情来源：缺省为 0.3 的合成行情；模拟真实行情时设成"按种子给行情段"（见 tools/segments-disk.ts）。 */
let marketOf: ((seed: string) => Segment | null) | null = null;

export function useMarket(fn: ((seed: string) => Segment | null) | null): void {
  marketOf = fn;
}

/** 0.4 C：机器人的局打不打开新机制（仓位、押跌、抵押）。缺省关（0.3 玩法）；sim --ext 打开。 */
let extOn = false;

export function useExt(on: boolean): void {
  extOn = on;
}

/** 让机器人从开局一直玩到结束，返回终局状态。onStep 在每步之后收到新状态与事件。 */
export function playRun(
  seed: string,
  bot: Bot | BotFactory,
  setup: RunSetup | null = null,
  onStep?: (state: GameState, events: readonly GameEvent[], action: Action) => void,
  maxActions = 2000,
): GameState {
  const b = typeof bot === 'function' ? bot() : bot;
  const rng = rngFor(seed, 'bot', b.name);
  let state = createRun(seed, setup, { segment: marketOf?.(seed) ?? null, ext: extOn || NEEDS_EXT.has(b.name) }).state;
  for (let i = 0; i < maxActions && state.phase !== 'won' && state.phase !== 'lost'; i++) {
    let action = b.act(state, rng);
    // 加班日不能买卖：机器人照常思考（更新信念），然后直接开盘
    if (isBusy(state) && (action.type === 'buy' || action.type === 'sell')) action = { type: 'open' };
    const r = dispatch(state, action, { events: onStep !== undefined, inPlace: true });
    if (r.error) throw new Error(`${b.name} 在种子 ${seed} 第 ${i} 步给出非法操作 ${JSON.stringify(action)}：${r.error}`);
    state = r.state;
    onStep?.(state, r.events, action);
  }
  return state;
}

// ================================================================ 公共小工具

function emptySlot(s: GameState): number {
  return s.slots.findIndex((h) => h === null);
}

function sellableSlots(s: GameState): number[] {
  const out: number[] = [];
  s.slots.forEach((h, i) => {
    if (h && canSell(s, i)) out.push(i);
  });
  return out;
}

function themeOfStock(id: string): ThemeId {
  return stockById(id).theme;
}

function lastDelta(s: GameState, theme: ThemeId): number {
  const h = s.themes[theme]?.history ?? [];
  return h.length >= 2 ? (h[h.length - 1] ?? 0) - (h[h.length - 2] ?? 0) : 0;
}

function heldThemes(s: GameState): Map<ThemeId, number> {
  const m = new Map<ThemeId, number>();
  for (const h of s.slots) if (h) m.set(themeOfStock(h.stockId), (m.get(themeOfStock(h.stockId)) ?? 0) + 1);
  return m;
}

function buyable(s: GameState, rec: number): boolean {
  const r = s.today.recs[rec];
  return !!r && !r.taken && s.today.buysLeft > 0 && !s.slots.some((h) => h?.stockId === r.stockId);
}

/** 奖励里的股票卡放到哪：空格，否则换掉持有收益最低的可卖持仓；都不行返回 -1。 */
function stockCardSlot(s: GameState): number {
  const e = emptySlot(s);
  if (e >= 0) return e;
  let worst = -1;
  let v = Infinity;
  s.slots.forEach((h, i) => {
    if (h && h.value < v) {
      v = h.value;
      worst = i;
    }
  });
  return worst;
}

/** 简单的领奖励：按偏好表打分。 */
function pickRewardBy(s: GameState, score: (kind: string, id: string) => number): Action {
  const cards = s.reward?.cards ?? [];
  let best = -1;
  let bestScore = -Infinity;
  cards.forEach((c, i) => {
    const v = score(c.kind, c.id);
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  });
  if (best < 0 || bestScore <= -100) return { type: 'skipReward' };
  const card = cards[best];
  if (card?.kind === 'stock') {
    const slot = stockCardSlot(s);
    if (slot < 0) return { type: 'skipReward' };
    return { type: 'pickReward', index: best, slot };
  }
  return { type: 'pickReward', index: best };
}

// ================================================================ random / follower / chaser / qunzhu

function randomBot(): Bot {
  return {
    name: 'random',
    act(s, rng) {
      if (s.phase === 'reward') {
        const n = s.reward?.cards.length ?? 0;
        if (n === 0) return { type: 'skipReward' };
        const i = rng.int(n);
        if (s.reward?.cards[i]?.kind === 'stock') return { type: 'pickReward', index: i, slot: rng.int(s.slots.length) };
        return { type: 'pickReward', index: i };
      }
      if (s.phase === 'event') return { type: 'choose', option: rng.int(2) };
      if (s.today.ops < 2) {
        const u = rng.next();
        const sellable = sellableSlots(s);
        if (u < 0.25 && sellable.length > 0) return { type: 'sell', slot: sellable[rng.int(sellable.length)] as number };
        if (u < 0.6 && s.today.buysLeft > 0) {
          const rec = rng.int(Math.max(1, s.today.recs.length));
          if (buyable(s, rec)) {
            const e = emptySlot(s);
            if (e >= 0) return { type: 'buy', rec, slot: e };
            if (sellable.length > 0) return { type: 'buy', rec, slot: sellable[rng.int(sellable.length)] as number };
          }
        }
      }
      return { type: 'open' };
    },
  };
}

function followerBot(): Bot {
  return {
    name: 'follower',
    act(s) {
      if (s.phase === 'reward') return pickRewardBy(s, (kind) => (kind === 'stock' ? (emptySlot(s) >= 0 ? 1 : -1000) : 0));
      if (s.phase === 'event') return { type: 'choose', option: 0 };
      if (emptySlot(s) >= 0 && buyable(s, 0)) return { type: 'buy', rec: 0 };
      return { type: 'open' };
    },
  };
}

function chaserBot(): Bot {
  return {
    name: 'chaser',
    act(s) {
      if (s.phase === 'reward') return pickRewardBy(s, (kind, id) => (kind === 'item' ? 2 + simpleItemPref(id) : kind === 'stock' ? 1 : 0.5));
      if (s.phase === 'event') return { type: 'choose', option: s.event?.id === 'livestream' ? 0 : 1 };
      // 热度下降就卖
      for (const i of sellableSlots(s)) {
        const h = s.slots[i];
        if (h && lastDelta(s, themeOfStock(h.stockId)) < 0) return { type: 'sell', slot: i };
      }
      // 追最热的题材
      if (emptySlot(s) >= 0 && s.today.buysLeft > 0) {
        let best = -1;
        let heat = -1;
        s.today.recs.forEach((r, i) => {
          const h = s.themes[themeOfStock(r.stockId)]?.heat ?? 0;
          if (buyable(s, i) && h > heat) {
            heat = h;
            best = i;
          }
        });
        if (best >= 0) return { type: 'buy', rec: best };
      }
      return { type: 'open' };
    },
  };
}

/**
 * 0.10.0 小白（docs/balance.md 第 1 节）：追最热的题材、不止损、不看消息真假。
 * 群里谁说涨就信谁、谁说跌就卖；亏了也拿着等回本，只在题材明显凉透（降温、冷）时才卖；不押跌、不抵押、不加仓。
 */
function xiaobaiBot(): Bot {
  return {
    name: 'xiaobai',
    act(s, rng) {
      if (s.phase === 'reward') return pickRewardBy(s, (kind, id) => (kind === 'stock' ? (emptySlot(s) >= 0 ? 3 : 0.5) : kind === 'item' ? 1 + simpleItemPref(id) / 2 : 1) + rng.next());
      if (s.phase === 'event') return { type: 'choose', option: s.event ? casualEvent(s.event.id, rng) : 1 };
      const said = (theme: ThemeId): number => {
        let v = 0;
        for (const m of s.today.messages) if (m.theme === theme) v += m.claim === 'up' ? 1 : m.claim === 'down' ? -1 : 0;
        return v;
      };
      if (s.today.ops < 2) {
        for (const i of sellableSlots(s)) {
          const h = s.slots[i];
          if (!h) continue;
          const theme = themeOfStock(h.stockId);
          const feel = feelOf(s.themes[theme]?.history ?? []);
          if (said(theme) < 0 || feel === 'cold' || (feel === 'cooling' && h.value >= 1)) return { type: 'sell', slot: i };
        }
      }
      if (emptySlot(s) >= 0 && s.today.buysLeft > 0 && s.today.ops < 2) {
        let best = -1;
        let top = -Infinity;
        s.today.recs.forEach((r, i) => {
          if (!buyable(s, i)) return;
          const theme = themeOfStock(r.stockId);
          const v = (s.themes[theme]?.heat ?? 0) + said(theme) * 15;
          if (v > top) {
            top = v;
            best = i;
          }
        });
        if (best >= 0) return { type: 'buy', rec: best };
      }
      return { type: 'open' };
    },
  };
}

/** 无脑跟群主：买群主推荐的；群主说哪个题材跌，就卖哪个题材。 */
function qunzhuBot(): Bot {
  return {
    name: 'qunzhu',
    act(s) {
      if (s.phase === 'reward') return pickRewardBy(s, (kind, id) => (kind === 'item' ? 2 + simpleItemPref(id) : kind === 'stock' ? 1 : 0.5));
      if (s.phase === 'event') return { type: 'choose', option: 0 };
      const down = new Set(s.today.messages.filter((m) => m.friendId === 'qunzhu' && m.claim === 'down').map((m) => m.theme));
      for (const i of sellableSlots(s)) {
        const h = s.slots[i];
        if (h && down.has(themeOfStock(h.stockId))) return { type: 'sell', slot: i };
      }
      const rec = s.today.recs.findIndex((r, i) => r.friendId === 'qunzhu' && buyable(s, i));
      if (rec >= 0) {
        const e = emptySlot(s);
        if (e >= 0) return { type: 'buy', rec, slot: e };
        const sellable = sellableSlots(s);
        if (sellable.length > 0) return { type: 'buy', rec, slot: sellable[0] as number };
      }
      return { type: 'open' };
    },
  };
}

/** 普通玩家对道具的朴素偏好（越大越想要）。 */
function simpleItemPref(id: string): number {
  const pref: Record<string, number> = {
    extra_slot: 3,
    ipo: 2.5,
    double_buy: 2,
    margin: 1.5,
    credit: 2,
    longtou: 1.5,
    genfeng: 1,
    baima: 1,
    yaogu: 1,
    lianban: 1,
    dixi: 1,
    zhisun: 2,
    zhiying: 1.5,
    paid_group: 2,
    notebook: 1.5,
    mood_meter: 2,
    hot_money: 1.5,
    value_eye: 1,
    fan_qunzhu: 1.5,
    diversify: 1,
    fomo: 1.5,
    night_review: 1.5,
    crowd_fund: 2.5,
    rumor_mill: 1.5,
  };
  return pref[id] ?? 1;
}

/** 下个月的常规月供（估算，公开规则：基础月供 × 规则表倍数）。 */
function nextBillOf(s: GameState): number {
  const m = Math.min(MONTHS, s.month + 1);
  return baseBill(m) * rulesOf(s).billMult * s.nextBillMult;
}

/** 熬夜复盘：今天盘前能看到哪个题材昨天收盘时的阶段。 */
function reviewOf(s: GameState, theme: ThemeId): Stage | null {
  const r = s.review;
  return r && r.day === s.dayIndex - 1 && r.theme === theme ? r.stage : null;
}

/** 本月有股灾传闻、且还没发生（公开：lastDay.crash 收盘后揭晓）。返回今天出事的概率（0 表示不会）。 */
function crashRisk(s: GameState, crashed: boolean): number {
  if (s.notice?.id !== 'crash' || crashed) return 0;
  const [lo, hi] = BALANCE.crash.day;
  const d = s.dayInMonth;
  if (d < lo || d > hi) return 0;
  return 1 / (hi - d + 1);
}

/** 消息对机器人来说的方向：反着信群主的消息要反过来读。 */
function readClaim(m: { claim: Dir; reverse?: boolean }): Dir {
  return m.reverse ? flipDir(m.claim) : m.claim;
}

/** 新事件的普通人选择（大致随机，偏向占小便宜）。 */
function casualEvent(id: string, rng: Rng): number {
  const yes: Record<string, number> = {
    landlord: 0.5,
    classmate_loan: 0.5,
    side_hustle: 0.5,
    cat_keyboard: 0.5,
    red_packet: 0.8,
    quant_trial: 0.5,
    blind_box: 0.4,
    fund_manager: 0.3,
    overtime: 0.6,
  };
  return rng.next() < (yes[id] ?? 0.5) ? 0 : 1;
}

// ================================================================ normal

/** 机器人对股灾的记忆：收盘后公开的 lastDay.crash 记下出事的月份。 */
class CrashMemory {
  private month = -1;
  update(s: GameState): void {
    if (s.lastDay?.crash) this.month = s.lastDay.month;
  }
  /** 本月有传闻、还没出事 */
  pending(s: GameState): boolean {
    return s.notice?.id === 'crash' && this.month !== s.month;
  }
  crashed(s: GameState): boolean {
    return this.month === s.month;
  }
}

/** 题材的公开打分（体感 + 消息 + 情绪指标）。正数看多。 */
function normalThemeScore(s: GameState, theme: ThemeId, trust: (f: string) => number, ignoreMsg = false): number {
  const t = s.themes[theme];
  if (!t) return -9;
  const feel = feelOf(t.history);
  const reveal = rulesOf(s).revealStages ? t.lastStage : reviewOf(s, theme);
  let score: number;
  if (reveal) {
    score = { cold: 0, sprout: 1.5, ferment: 1.5, rally: 0.8, climax: -1, ebb: -1.5 }[reveal];
  } else {
    score = { cold: 0, warming: t.heat < 60 ? 1.2 : 0.6, hot: 0.3, overheated: -0.5, cooling: -1 }[feel];
  }
  for (const m of ignoreMsg ? [] : s.today.messages) {
    if (m.theme !== theme) continue;
    const w = ((m.reverse ? fx('fan_qunzhu', 'acc') : trust(m.friendId)) - 0.45) * 3;
    const claim = readClaim(m);
    score += (claim === 'up' ? 1 : claim === 'down' ? -1 : -0.2) * w;
  }
  return score;
}

/** normal 割肉线：持有亏损超过这个比例就卖。 */
const NORMAL_CUT = 0.2;
/** normal 买入的最低打分 */
const NORMAL_BUY = 0.4;
/** normal 对角色的偏好（喜欢龙头，不碰 ST） */
const NORMAL_ROLE: Record<Role, number> = { leader: 0.6, follower: 0, bluechip: -0.2, meme: 0.1, st: -1 };

function normalBot(ignoreMsg = false): Bot {
  const crash = new CrashMemory();
  return {
    name: ignoreMsg ? 'normal-nomsg' : 'normal',
    act(s, rng) {
      crash.update(s);
      const trust = (id: string): number => {
        const f = s.friends.find((x) => x.id === id);
        if (!f || f.total < 3) return 0.6;
        return f.hits / f.total;
      };
      if (s.phase === 'reward') {
        return pickRewardBy(s, (kind, id) => {
          if (kind === 'item') return 2 + simpleItemPref(id) + rng.next();
          if (kind === 'friend') return 3 + rng.next();
          const theme = themeOfStock(id);
          return emptySlot(s) >= 0 ? 4 : normalThemeScore(s, theme, trust, ignoreMsg) > 0 ? 3 : 1;
        });
      }
      if (s.phase === 'event') {
        const e = s.event;
        if (!e) return { type: 'choose', option: 1 };
        if (e.id === 'cousin') return { type: 'choose', option: rng.next() < 0.3 ? 0 : 1 };
        if (e.id === 'course' || e.id === 'lottery') return { type: 'choose', option: rng.next() < 0.25 ? 0 : 1 };
        if (e.id === 'livestream') return { type: 'choose', option: e.theme && heldThemes(s).has(e.theme) ? 0 : 1 };
        if (e.id === 'lottery_party' || e.id === 'bonus') return { type: 'choose', option: 0 };
        return { type: 'choose', option: casualEvent(e.id, rng) };
      }
      // 股灾：传闻出来时普通人将信将疑、照常操作；真跌了就吓得全卖、这个月不敢再买（割在地板上，错过反弹）
      if (crash.crashed(s)) {
        const sell = sellableSlots(s)[0];
        if (sell !== undefined && s.today.ops < 2) return { type: 'sell', slot: sell };
        return { type: 'open' };
      }
      // 卖出：过热又遇到看空消息；战绩好的群友说跌；连跌两天；亏太多割肉
      const coolTwice = (theme: ThemeId): boolean => {
        const hist = s.themes[theme]?.history ?? [];
        const n = hist.length;
        if (n < 3) return false;
        return (hist[n - 1] as number) - (hist[n - 2] as number) <= -4 && (hist[n - 2] as number) - (hist[n - 3] as number) <= -4;
      };
      if (s.today.ops < 2) {
        for (const i of sellableSlots(s)) {
          const h = s.slots[i];
          if (!h) continue;
          const theme = themeOfStock(h.stockId);
          const t = s.themes[theme];
          if (!t) continue;
          const feel = feelOf(t.history);
          const msgs = ignoreMsg ? [] : s.today.messages.filter((m) => m.theme === theme);
          const tr = (m: (typeof msgs)[number]): number => (m.reverse ? fx('fan_qunzhu', 'acc') : trust(m.friendId));
          const bearish = msgs.some((m) => readClaim(m) === 'down');
          const trustedDown = msgs.some((m) => readClaim(m) === 'down' && tr(m) >= 0.65);
          const hotNow = feel === 'overheated' || feel === 'hot';
          const cut = h.value < 1 - NORMAL_CUT;
          const seen = rulesOf(s).revealStages ? t.lastStage : reviewOf(s, theme);
          const reveal = seen === 'ebb' || seen === 'climax';
          const cooling = feel === 'cooling' && !msgs.some((m) => readClaim(m) === 'up' && tr(m) >= 0.65);
          if ((hotNow && bearish) || trustedDown || cooling || coolTwice(theme) || cut || reveal) return { type: 'sell', slot: i };
        }
      }
      // 买入：升温早期，分散在两个题材里（手里的题材凉了可以换）；没有空格时把亏钱或降温的换掉
      if (s.today.buysLeft > 0 && s.today.ops < 2) {
        const held = heldThemes(s);
        const stale = new Set<ThemeId>();
        for (const th of held.keys()) {
          const f = feelOf(s.themes[th]?.history ?? []);
          if (f === 'cooling' || f === 'cold') stale.add(th);
        }
        const fresh = [...held.keys()].filter((th) => !stale.has(th));
        let best = -1;
        let bestScore = NORMAL_BUY;
        s.today.recs.forEach((r, i) => {
          if (!buyable(s, i)) return;
          const theme = themeOfStock(r.stockId);
          if (fresh.length >= 2 && !held.has(theme)) return;
          if ((held.get(theme) ?? 0) >= 2) return;
          const def = stockById(r.stockId);
          let score = normalThemeScore(s, theme, trust, ignoreMsg) + NORMAL_ROLE[def.role];
          score += (trust(r.friendId) - 0.5) * 2;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        });
        if (best >= 0) {
          const e = emptySlot(s);
          if (e >= 0) return { type: 'buy', rec: best, slot: e };
          if (bestScore > 1.2) {
            const victim = sellableSlots(s).find((i) => {
              const h = s.slots[i];
              return !!h && (h.value < 0.92 || stale.has(themeOfStock(h.stockId)));
            });
            if (victim !== undefined) return { type: 'buy', rec: best, slot: victim };
          }
        }
      }
      return { type: 'open' };
    },
  };
}

// ================================================================ smart：题材阶段的贝叶斯滤波

const NS = STAGES.length;
const MAXAGE = 16;
const SI: Record<Stage, number> = { cold: 0, sprout: 1, ferment: 2, rally: 3, climax: 4, ebb: 5 };

type Dist = Float64Array;

function newDist(): Dist {
  return new Float64Array(NS * MAXAGE);
}

function idx(stage: number, age: number): number {
  return stage * MAXAGE + Math.min(MAXAGE, age) - 1;
}

function normalize(d: Dist): void {
  let t = 0;
  for (let i = 0; i < d.length; i++) t += d[i] as number;
  if (t <= 0) {
    d.fill(1 / d.length);
    return;
  }
  for (let i = 0; i < d.length; i++) d[i] = (d[i] as number) / t;
}

function stageMass(d: Dist): number[] {
  const m = new Array<number>(NS).fill(0);
  for (let s = 0; s < NS; s++) for (let a = 1; a <= MAXAGE; a++) m[s] = (m[s] as number) + (d[idx(s, a)] as number);
  return m;
}

/** 阶段持续天数服从 [lo, hi] 上的均匀分布：已持续 age 天后今天结束的概率。 */
function hazard(theme: ThemeId, stage: Stage, age: number): number {
  const [lo, hi] = stageDays(stage, theme);
  if (age < lo) return 0;
  if (age >= hi) return 1;
  return 1 / (hi - age + 1);
}

/** 开盘前推进一天（与引擎 advanceStage 的规则一致）。heat 为今天开盘前的热度。 */
function predict(prev: Dist, theme: ThemeId, heat: number, mr: MarketRules): Dist {
  const out = newDist();
  const top = heat >= BALANCE.heat.max;
  const sproutChance = Math.min(1, mr.sprout + (mr.sproutTheme[theme] ?? 0));
  for (let si = 0; si < NS; si++) {
    const stage = STAGES[si] as Stage;
    for (let a = 1; a <= MAXAGE; a++) {
      const m = prev[idx(si, a)] as number;
      if (m <= 0) continue;
      if (top && (stage === 'sprout' || stage === 'ferment' || stage === 'rally')) {
        out[idx(SI.climax, 1)] = (out[idx(SI.climax, 1)] as number) + m;
        continue;
      }
      if (top && stage === 'climax') {
        out[idx(SI.ebb, 1)] = (out[idx(SI.ebb, 1)] as number) + m;
        continue;
      }
      const h = hazard(theme, stage, a);
      const end = m * h;
      let stay = m - end;
      if (stage === 'cold' && sproutChance > 0) {
        const early = stay * sproutChance;
        stay -= early;
        out[idx(SI.sprout, 1)] = (out[idx(SI.sprout, 1)] as number) + early;
      }
      out[idx(si, a + 1)] = (out[idx(si, a + 1)] as number) + stay;
      if (end > 0) {
        switch (stage) {
          case 'cold':
            out[idx(SI.sprout, 1)] = (out[idx(SI.sprout, 1)] as number) + end;
            break;
          case 'sprout': {
            const f = failChance('sprout', theme, mr);
            out[idx(SI.cold, 1)] = (out[idx(SI.cold, 1)] as number) + end * f;
            out[idx(SI.ferment, 1)] = (out[idx(SI.ferment, 1)] as number) + end * (1 - f);
            break;
          }
          case 'ferment': {
            const f = failChance('ferment', theme, mr);
            out[idx(SI.ebb, 1)] = (out[idx(SI.ebb, 1)] as number) + end * f;
            out[idx(SI.rally, 1)] = (out[idx(SI.rally, 1)] as number) + end * (1 - f);
            break;
          }
          case 'rally':
            out[idx(SI.climax, 1)] = (out[idx(SI.climax, 1)] as number) + end;
            break;
          case 'climax':
            out[idx(SI.ebb, 1)] = (out[idx(SI.ebb, 1)] as number) + end;
            break;
          case 'ebb':
            out[idx(SI.cold, 1)] = (out[idx(SI.cold, 1)] as number) + end;
            break;
        }
      }
    }
  }
  return out;
}

/** 某阶段今天热度变化的连续范围（含日历、直播间、冷门回落）。 */
function dHRange(stage: Stage, theme: ThemeId, heat: number, mr: MarketRules, boost: number): [number, number] {
  const [lo, hi] = stageDH(stage, theme, mr);
  const b = (mr.themeDH[theme] ?? 0) + boost + coldPull(stage, heat);
  // 震荡的噪声：两个均匀分布之和近似成一个更宽的均匀分布
  const n = mr.dHNoise;
  return [lo + b - n, hi + b + n];
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** P(实际热度变化 = d | 范围)：先在范围上均匀取值再四舍五入，最后截断到 0..100。 */
function likDEff(range: [number, number], heat: number, d: number): number {
  const [lo, hi] = range;
  const w = Math.max(1e-6, hi - lo);
  const max = BALANCE.heat.max;
  if (heat + d >= max && d > 0) return overlap(max - heat - 0.5, 1e9, lo, hi) / w;
  if (heat + d <= 0 && d < 0) return overlap(-1e9, -heat + 0.5, lo, hi) / w;
  if (heat + d >= max && d === 0 && heat >= max) return overlap(-0.5, 1e9, lo, hi) / w;
  if (heat + d <= 0 && d === 0 && heat <= 0) return overlap(-1e9, 0.5, lo, hi) / w;
  return overlap(d - 0.5, d + 0.5, lo, hi) / w;
}

/** 截断后的热度变化落在 涨 / 横 / 跌 的概率。 */
function dirProbs(range: [number, number], heat: number): [number, number, number] {
  const [lo, hi] = range;
  const w = Math.max(1e-6, hi - lo);
  const t = BALANCE.heat.dirThreshold;
  const max = BALANCE.heat.max;
  // 截断：上涨最多 max-heat，下跌最多 -heat
  const upCut = max - heat >= t ? t - 0.5 : Infinity;
  const downCut = -heat <= -t ? -t + 0.5 : -Infinity;
  const pUp = overlap(upCut, 1e9, lo, hi) / w;
  const pDown = overlap(-1e9, downCut, lo, hi) / w;
  return [pUp, Math.max(0, 1 - pUp - pDown), pDown];
}

/** 截断后热度变化的均值（数值积分）。 */
function meanDEff(range: [number, number], heat: number): number {
  const [lo, hi] = range;
  const n = 8;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += effectiveDH(heat, lo + ((hi - lo) * (k + 0.5)) / n);
  return sum / n;
}

/** 一个题材的信念：昨天收盘后的后验，以及今天开盘前的先验（含今天的消息）。 */
interface ThemeBelief {
  /** 今天开盘前的先验（还没看消息） */
  prior: Dist;
  /** 今天看过消息后的信念 */
  today: Dist;
  /** 今天开盘前的热度 */
  heat: number;
}

function uniformStart(theme: ThemeId): Dist {
  const d = newDist();
  for (let si = 0; si < NS; si++) {
    const [lo, hi] = stageDays(STAGES[si] as Stage, theme);
    for (let a = 1; a <= Math.min(MAXAGE, hi); a++) d[idx(si, a)] = (hi - lo + 1) / (hi + 1);
  }
  normalize(d);
  return d;
}

/** 股灾（公开规则）：今天以概率 q 出事，出事时萌芽 / 发酵 / 主升 / 高潮全部转入退潮第 1 天。 */
function mixCrash(d: Dist, q: number): Dist {
  if (q <= 0) return d;
  const out = new Float64Array(d.length);
  for (let si = 0; si < NS; si++) {
    const hot = si === SI.sprout || si === SI.ferment || si === SI.rally || si === SI.climax;
    for (let a = 1; a <= MAXAGE; a++) {
      const m = d[idx(si, a)] as number;
      if (m <= 0) continue;
      out[idx(si, a)] = (out[idx(si, a)] as number) + m * (hot ? 1 - q : 1);
      if (hot) out[idx(SI.ebb, 1)] = (out[idx(SI.ebb, 1)] as number) + m * q;
    }
  }
  return out;
}

/** 用一天的观测（开盘前热度、实际热度变化）更新：先验 × 似然。 */
function observe(prior: Dist, theme: ThemeId, heat: number, d: number, mr: MarketRules, boost: number): Dist {
  const post = newDist();
  for (let si = 0; si < NS; si++) {
    const l = likDEff(dHRange(STAGES[si] as Stage, theme, heat, mr, boost), heat, d) + 1e-4;
    for (let a = 1; a <= MAXAGE; a++) post[idx(si, a)] = (prior[idx(si, a)] as number) * l;
  }
  normalize(post);
  return post;
}

/** 一条消息：方向、平时的可信度、在拐点上的可信度（靠谱群友在擅长题材的拐点上更准）。 */
interface Claim {
  claim: Dir;
  cred: number;
  turnCred: number;
}

function applyMessages(prior: Dist, theme: ThemeId, heat: number, mr: MarketRules, boost: number, claims: Claim[]): Dist {
  if (claims.length === 0) return prior;
  const out = new Float64Array(prior);
  const lik = (range: [number, number], turn: boolean): number => {
    const [pu, pf, pd] = dirProbs(range, heat);
    let l = 1;
    for (const c of claims) {
      const cred = turn ? c.turnCred : c.cred;
      const wrong = (1 - cred) / 2;
      const pc = (d: Dir): number => (d === c.claim ? cred : wrong);
      l *= pu * pc('up') + pf * pc('flat') + pd * pc('down');
    }
    return l + 1e-6;
  };
  for (let si = 0; si < NS; si++) {
    const stage = STAGES[si] as Stage;
    const range = dHRange(stage, theme, heat, mr, boost);
    const l = lik(range, false);
    const lt = stage === 'sprout' || stage === 'climax' || stage === 'ebb' ? lik(range, true) : l;
    out[idx(si, 1)] = (out[idx(si, 1)] as number) * lt;
    for (let a = 2; a <= MAXAGE; a++) out[idx(si, a)] = (out[idx(si, a)] as number) * l;
  }
  normalize(out);
  return out;
}

/** 群友在拐点上的可信度（规则公开：靠谱群友在擅长题材的拐点上 + turnCred）。 */
function turnCredOf(s: GameState, friendId: string, theme: ThemeId, rules: Rules): number {
  const c = credibility(s, friendId, theme, rules);
  const f = s.friends.find((x) => x.id === friendId);
  if (!f || (BALANCE.cred[friendId]?.[0] ?? 0) < BALANCE.chat.reliable || !topicsOf(s, f).includes(theme)) return c;
  return Math.min(1, c + BALANCE.chat.turnCred * rules.turnCredMult);
}

/** 期望热度变化：今天和之后 days−1 天（往后用期望热度近似）。 */
function projectDH(belief: Dist, theme: ThemeId, heat: number, mrs: MarketRules[], boost: { dH: number; days: number } | null, days: number): number[] {
  const out: number[] = [];
  let d = belief;
  let h = heat;
  for (let k = 0; k < days; k++) {
    const mr = mrs[Math.min(k, mrs.length - 1)] as MarketRules;
    if (k > 0) d = predict(d, theme, h, mr);
    const b = boost && boost.days > k ? boost.dH : 0;
    out.push(expectedDH(d, theme, h, mr, b));
    h = Math.max(0, Math.min(BALANCE.heat.max, h + (out[out.length - 1] as number)));
  }
  return out;
}

/** 信念下今天的期望热度变化。 */
function expectedDH(d: Dist, theme: ThemeId, heat: number, mr: MarketRules, boost: number): number {
  const m = stageMass(d);
  let e = 0;
  for (let si = 0; si < NS; si++) {
    const p = m[si] as number;
    if (p > 1e-9) e += p * meanDEff(dHRange(STAGES[si] as Stage, theme, heat, mr, boost), heat);
  }
  return e;
}

// ---------------------------------------------------------------- 个股期望

function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / 2.5066282746310002;
}

function Phi(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const p = phi(z) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

interface Clip {
  mean: number;
  /** E[min(X, 0)]（亏损部分） */
  neg: number;
  pUp: number;
  pDown: number;
}

/** X ~ N(μ, σ) 截断到 [lo, hi] 后的均值、负部、触及上下限的概率。 */
function clipNormal(mu: number, sigma: number, lo: number, hi: number): Clip {
  const s = Math.max(0.05, sigma);
  const a = (lo - mu) / s;
  const b = (hi - mu) / s;
  const z0 = (0 - mu) / s;
  const Pa = Phi(a);
  const Pb = Phi(b);
  const mean = lo * Pa + hi * (1 - Pb) + mu * (Pb - Pa) + s * (phi(a) - phi(b));
  // E[min(clip(X), 0)] = lo*Pa + ∫_{a}^{z0} (μ+σz)φ dz
  const P0 = Phi(Math.min(z0, b));
  const neg = lo * Pa + mu * Math.max(0, P0 - Pa) + s * (phi(a) - phi(Math.min(z0, b)));
  return { mean, neg: Math.min(0, neg), pUp: 1 - Pb, pDown: Pa };
}

interface Outlook {
  /** 各题材今天起的期望题材涨幅（pp），[今天, 明天, 后天] */
  theme: Map<ThemeId, number[]>;
  /** 各题材今天处于主升的概率（低吸大师用） */
  rally: Map<ThemeId, number[]>;
  /** 大盘今天的期望涨幅 */
  market: number;
  mr: MarketRules;
}

const HORIZON = 3;
/** 真实行情下一条群聊消息（按可信度超过瞎猜的部分）对风口今天涨跌的估计（pp），sim --real 标定 */
let REAL_MSG = 5;
export function setRealMsg(v: number): void {
  REAL_MSG = v;
}
/** 推荐当作"涨"的信号时可信度打的折扣 */
const REC_SIGNAL = 0.9;
/** smart 往空格里买入的最低价值（3 天期望收益的折现和，pp）；空格是现金，正期望就值得买 */
const SMART_FILL = 1.0;

/** 某只股票今天起 HORIZON 天的期望收益（含道具修正），以及今天涨停的概率。 */
function stockOutlook(
  s: GameState,
  o: Outlook,
  rules: Rules,
  stockId: string,
  opt: {
    held: boolean;
    boughtToday: boolean;
    lowBuy: boolean;
    leaderUpProb: Map<ThemeId, number>;
    holdingLeader: ReadonlySet<ThemeId>;
    /** 今天的第一只买入（游资席位） */
    firstBuy?: boolean;
  },
): { e: number[]; pUp: number } {
  // 月底在第几天之后（价值眼光的分红）；超出视野为 -1
  const monthEndK = BALANCE.monthDays[s.month - 1]! - s.dayInMonth - 1;
  const def = stockById(stockId);
  const p = BALANCE.roles[def.role];
  const st = s.stocks[stockId];
  const items = s.items;
  const themeE = o.theme.get(def.theme) ?? [0, 0, 0];
  const beta = p.beta * (o.mr.beta[def.role] ?? 1);
  const noise = p.noise * (o.mr.noise[def.role] ?? 1) * o.mr.vol;
  const out: number[] = [];
  let pUp0 = 0;
  for (let k = 0; k < HORIZON; k++) {
    const boards = k === 0 ? (st?.boards ?? 0) : 0;
    const mm = opt.held ? rules.momentumMult : 1;
    const bm = opt.held ? rules.blowMult : 1;
    let mu = beta * (themeE[k] ?? 0) + p.market * (k === 0 ? o.market : o.market * 0.8) + boards * BALANCE.boards.momentum * mm;
    const sigma = Math.sqrt(noise * noise + (beta * 1.2) * (beta * 1.2) + (def.role === 'meme' ? p.jumpProb * 64 : 0));
    if (def.role === 'follower') mu += (opt.leaderUpProb.get(def.theme) ?? 0) * BALANCE.chain;
    const c = clipNormal(mu, sigma, -p.limit, p.limit);
    let e = c.mean;
    if (boards > 0) {
      const pb = Math.min(1, boards * BALANCE.boards.blow * bm * o.mr.blowMult);
      e = (1 - pb) * e + pb * BALANCE.boards.blowMove;
    }
    if (def.role === 'st') e = Math.min(e, 0.3) - BALANCE.st.warn * (st?.warnings ?? 0 ? 40 : 6);
    // 道具
    if (items.includes('baima') && def.role === 'bluechip') e -= c.neg * 0.5;
    if (items.includes('yaogu') && def.role === 'meme') e += c.pUp * ((BALANCE.fx.yaogu?.limitUpAs ?? 15) - p.limit);
    if (items.includes('genfeng') && def.role === 'follower') e += (opt.leaderUpProb.get(def.theme) ?? 0) * BALANCE.chain;
    if (items.includes('longtou') && def.role !== 'leader' && opt.holdingLeader.has(def.theme)) e += (opt.leaderUpProb.get(def.theme) ?? 0) * 3;
    if (items.includes('dixi') && opt.lowBuy) e += (o.rally.get(def.theme)?.[k] ?? 0) * 2;
    if (items.includes('zhisun') && !(opt.boughtToday && k === 0)) {
      const stop = BALANCE.fx.zhisun?.stop ?? -4;
      const cs = clipNormal(mu, sigma, stop, p.limit);
      e += Math.max(0, cs.mean - c.mean);
    }
    if (items.includes('value_eye') && def.role === 'bluechip' && k === monthEndK) e += fx('value_eye', 'bonus');
    if (items.includes('hot_money') && opt.firstBuy && opt.boughtToday && k === 0) e += c.pUp * fx('hot_money', 'bonus');
    if (k === 0) pUp0 = c.pUp;
    out.push(e);
  }
  return { e: out, pUp: pUp0 };
}

// ---------------------------------------------------------------- smart 本体

interface SmartOptions {
  name: string;
  /** 同一题材最多持有几只 */
  maxPerTheme: number;
  /** 每多一只同题材持仓的加分（集中流用） */
  sameThemeBonus: number;
  /** 最多同时持有几个题材（集中流为 1） */
  maxThemes?: number;
  /** 用真实信息（oracle） */
  oracle: boolean;
  /** oracle 是否知道今天的热度变化（false 时只知道真实阶段） */
  oracleToday?: boolean;
  /** 诊断用：偷看今天的热度变化（相当于消息全中、覆盖全部题材） */
  peek?: boolean;
  /** 诊断用：只偷看今天有消息的题材 */
  peekMsg?: boolean;
  /** 诊断用：不看消息（推荐照常） */
  ignoreMsg?: boolean;
  /** 诊断用：不把推荐当信号 */
  ignoreRec?: boolean;
  /** 诊断用：消息的方向全部换成真相（只知道涨 / 横 / 跌，不知道幅度） */
  trueDir?: boolean;
  /** 诊断用：只有拐点题材的消息换成真相 */
  trueDirTurn?: boolean;
  /** 诊断用：只偷看今天处在拐点的题材（拐点消息价值的上限） */
  peekTurn?: boolean;
  /** 往空格里买入的最低价值（缺省 SMART_FILL）；oracle 信息完整，可以更积极 */
  fill?: number;
  /** 满仓时换股的最低价值差（缺省 1.8） */
  swap?: number;
  /** 只买这些角色（成就"价值投资"：只买白马） */
  roles?: readonly Role[];
  /** 一个道具都不拿（成就"裸考"） */
  noItems?: boolean;
  /** 0.4 C：能押跌时也押跌（期望为负的推荐押它跌） */
  short?: boolean;
}

/** smart 领奖励时对道具的估值（拍脑袋的经验值，再加流派偏好；与第二轮相同）。 */
const ITEM_VALUE: Record<string, number> = {
  extra_slot: 6,
  double_buy: 4,
  margin: 5,
  ipo: 6,
  credit: 4,
  longtou: 3,
  genfeng: 2,
  baima: 2,
  yaogu: 3,
  lianban: 2,
  dixi: 2.5,
  zhisun: 3,
  zhiying: 2.5,
  paid_group: 4,
  notebook: 3,
  mood_meter: 6,
  hot_money: 2.5,
  value_eye: 2,
  fan_qunzhu: 3,
  diversify: 2,
  fomo: 3,
  night_review: 4,
  crowd_fund: 5,
  rumor_mill: 3,
};

/** oracle 领奖励时的估值：按 --value 实测的"开局持有"价值取整（pp），不挑流派。 */
const ORACLE_ITEM_VALUE: Record<string, number> = {
  extra_slot: 0,
  double_buy: 6,
  margin: 8,
  ipo: 8,
  credit: 6,
  longtou: 3.5,
  genfeng: 1.5,
  baima: 1,
  yaogu: 4.5,
  lianban: 1.5,
  dixi: 4,
  zhisun: 6.5,
  zhiying: 0,
  paid_group: 0,
  notebook: 0,
  mood_meter: 0,
  hot_money: 3,
  value_eye: 2,
  fan_qunzhu: 0,
  diversify: 2,
  fomo: 2,
  night_review: 0,
  crowd_fund: 6,
  rumor_mill: 0,
};

/** 第 8 节的五个流派（smart 每局随机倾向其中一个，领奖励时加分）。 */
export const ARCHETYPES: Record<string, readonly string[]> = {
  题材流: ['longtou', 'genfeng'],
  打板流: ['yaogu', 'lianban'],
  稳健杠杆流: ['baima', 'margin', 'ipo'],
  低吸流: ['dixi', 'mood_meter', 'zhiying'],
  消息流: ['paid_group', 'notebook'],
};

class SmartBot implements Bot {
  name: string;
  private opt: SmartOptions;
  private beliefs = new Map<ThemeId, Dist>();
  /** 已经用观测更新到的交易日（下一天的后验已就绪） */
  private seenDay = -1;
  /** 今天开盘前的先验，按题材 */
  private priors = new Map<ThemeId, Dist>();
  private priorDay = -1;
  private archetype: string | null = null;
  private crash = new CrashMemory();

  constructor(opt: SmartOptions) {
    this.name = opt.name;
    this.opt = opt;
  }

  /** 开局：从均匀先验出发，用预跑留下的走势过滤一遍。 */
  private init(s: GameState): void {
    const mr0 = marketRulesFor(0, s.difficulty);
    for (const id of s.themeIds) {
      const t = s.themes[id];
      if (!t) continue;
      let d = uniformStart(id);
      const h = t.history;
      for (let i = 1; i < h.length; i++) {
        const heat = h[i - 1] as number;
        d = predict(d, id, heat, mr0);
        d = observe(d, id, heat, (h[i] as number) - heat, mr0, 0);
      }
      this.beliefs.set(id, d);
    }
    this.seenDay = s.dayIndex - 1;
  }

  /** 每天第一次被调用时：用昨天的结算更新，再推进到今天。 */
  private sync(s: GameState): void {
    if (this.beliefs.size === 0) this.init(s);
    const r = s.lastDay;
    if (r && r.day > this.seenDay) {
      const mrDay = marketRulesFor(r.month, s.difficulty);
      for (const tm of r.themes) {
        const prior = this.priors.get(tm.id) ?? this.beliefs.get(tm.id);
        if (!prior) continue;
        // 只用公开的热度变化（tm.stage 是隐藏信息，不读）
        const boost = this.boostSeen.get(tm.id) ?? 0;
        this.beliefs.set(tm.id, observe(prior, tm.id, tm.heatBefore, tm.dH, mrDay, boost));
      }
      this.seenDay = r.day;
    }
    if (this.priorDay !== s.today.day) {
      const mr = marketRulesFor(s.month, s.difficulty);
      const q = crashRisk(s, this.crash.crashed(s));
      for (const id of s.themeIds) {
        const t = s.themes[id];
        const post = this.beliefs.get(id);
        if (!t || !post) continue;
        this.priors.set(id, mixCrash(predict(post, id, t.heat, mr), q));
        this.boostSeen.set(id, t.boost?.dH ?? 0);
      }
      this.priorDay = s.today.day;
    }
  }

  private boostSeen = new Map<ThemeId, number>();

  /** 今天各题材的展望（smart 用信念，oracle 用真实信息）。 */
  private outlook(s: GameState, rules: Rules): Outlook {
    const mr = marketRulesFor(s.month, s.difficulty);
    const nextMr = s.dayInMonth + 1 < BALANCE.monthDays[s.month - 1]! ? mr : marketRulesFor(Math.min(12, s.month + 1), s.difficulty);
    const mrs = [mr, nextMr, nextMr];
    const theme = new Map<ThemeId, number[]>();
    const rally = new Map<ThemeId, number[]>();
    const coef = BALANCE.heat.coef;
    for (const id of s.themeIds) {
      const t = s.themes[id];
      if (!t) continue;
      if (this.opt.oracle) {
        // 真实阶段 + 今天预先掷好的热度变化
        const d0 =
          this.opt.oracleToday === false
            ? meanDEff(dHRange(t.stage, id, t.heat, mr, t.boost?.dH ?? 0), t.heat)
            : effectiveDH(t.heat, s.today.plan.dH[id] ?? 0);
        // 真实行情：往后几天直接看行情段（oracle 是上限）；合成行情按真实阶段推
        const rest = s.real
          ? [1, 2].map((k) => (s.dayIndex + k < totalDays() ? realDH(s.real as NonNullable<GameState['real']>, t, tapeIndex(s.real as NonNullable<GameState['real']>, s.dayIndex + k)) : 0))
          : projectOracle(t.stage, t.left, id, t.heat + d0, mrs, t.boost);
        theme.set(id, [coef * d0, ...rest.map((x) => coef * x)]);
        rally.set(id, [t.stage === 'rally' ? 1 : 0, t.stage === 'rally' && t.left > 1 ? 1 : 0.3, 0.3]);
        continue;
      }
      if (s.real) {
        // 0.4 C 重新标定（真实行情）：0.3 的阶段模型在真实行情下不成立。真实行情里风口涨跌 = 行业超额收益按 smooth 均摊，
        // 所以今天的期望 ≈ (1 − smooth) × 昨天的风口涨跌（一阶自回归），再按群聊方向和群友可信度加减
        const k = 1 - BALANCE.real.smooth;
        const last = s.lastDay?.themes.find((x) => x.id === id)?.ret ?? 0;
        let shift = 0;
        for (const m of s.today.messages) {
          if (m.theme !== id || this.opt.ignoreMsg) continue;
          const claim = m.reverse ? flipDir(m.claim) : m.claim;
          const c = m.reverse ? fx('fan_qunzhu', 'acc') : credibility(s, m.friendId, id, rules);
          shift += (claim === 'up' ? 1 : claim === 'down' ? -1 : 0) * Math.max(0, c - 1 / 3) * REAL_MSG;
        }
        const e0 = k * last + shift;
        theme.set(id, [e0, k * e0, k * k * e0]);
        const f = feelOf(t.history);
        rally.set(id, [f === 'warming' || f === 'hot' ? 0.4 : 0.1, 0.2, 0.15]);
        continue;
      }
      let prior = this.priors.get(id);
      if (!prior) continue;
      const seen = rules.revealStages ? t.lastStage : reviewOf(s, id);
      if (seen) {
        // 情绪指标 / 熬夜复盘：昨天的真实阶段是公开的，先把昨天的后验收拢到那个阶段再推进
        const post = this.beliefs.get(id);
        if (post) {
          const c = newDist();
          const si = SI[seen];
          for (let a = 1; a <= MAXAGE; a++) c[idx(si, a)] = post[idx(si, a)] as number;
          let tot = 0;
          for (let i = 0; i < c.length; i++) tot += c[i] as number;
          if (tot <= 1e-9) for (let a = 1; a <= 3; a++) c[idx(si, a)] = 1;
          normalize(c);
          prior = mixCrash(predict(c, id, t.heat, mr), crashRisk(s, this.crash.crashed(s)));
        }
      }
      const claims: Claim[] = s.today.messages
        .filter((m) => m.theme === id && !this.opt.ignoreMsg)
        .map((m) =>
          this.opt.trueDir || (this.opt.trueDirTurn && turnOf(t) !== null)
            ? { claim: dirOf(effectiveDH(t.heat, s.today.plan.dH[id] ?? 0)), cred: 0.98, turnCred: 0.98 }
            : m.reverse
              ? { claim: flipDir(m.claim), cred: fx('fan_qunzhu', 'acc'), turnCred: fx('fan_qunzhu', 'acc') }
              : { claim: m.claim, cred: credibility(s, m.friendId, id, rules), turnCred: turnCredOf(s, m.friendId, id, rules) },
        );
      // 推荐也是信号：群友挑的是他觉得今天会涨的题材（打个折当作一条"涨"）
      for (const r of s.today.recs) {
        if (this.opt.ignoreRec || !r.friendId || r.friendId === 'qunzhu' || r.friendId === 'dav' || themeOfStock(r.stockId) !== id) continue;
        const c = recCredibility(s, r.friendId, id, rules);
        const rc = 0.34 + (c - 0.34) * REC_SIGNAL * BALANCE.chat.recInsight;
        claims.push({ claim: 'up', cred: rc, turnCred: rc });
      }
      const peekThis =
        this.opt.peek || (this.opt.peekMsg && s.today.messages.some((m) => m.theme === id)) || (this.opt.peekTurn && turnOf(t) !== null);
      const today = peekThis
        ? observe(prior, id, t.heat, effectiveDH(t.heat, s.today.plan.dH[id] ?? 0), mr, t.boost?.dH ?? 0)
        : applyMessages(prior, id, t.heat, mr, t.boost?.dH ?? 0, claims);
      const dh = projectDH(today, id, t.heat, mrs, t.boost, HORIZON);
      if (peekThis) dh[0] = effectiveDH(t.heat, s.today.plan.dH[id] ?? 0);
      theme.set(id, dh.map((x) => coef * x));
      const m0 = stageMass(today);
      const m1 = stageMass(predict(today, id, t.heat + (dh[0] ?? 0), nextMr));
      rally.set(id, [m0[SI.rally] as number, m1[SI.rally] as number, (m1[SI.rally] as number) * 0.7]);
    }
    let market = BALANCE.market.ret[s.mood] * BALANCE.market.persist + mr.marketAdd + crashRisk(s, this.crash.crashed(s)) * BALANCE.crash.marketHit;
    if (this.opt.oracle && this.opt.oracleToday !== false) market = s.today.plan.marketRet;
    return { theme, rally, market, mr };
  }

  act(s: GameState): Action {
    this.crash.update(s);
    if (s.phase === 'reward') return this.reward(s);
    if (s.phase === 'event') return this.event(s);
    this.sync(s);
    if (s.today.ops >= 2) return { type: 'open' };
    const rules = rulesOf(s);
    const o = this.outlook(s, rules);

    // 龙头今天涨停的概率（跟风、龙头战法用）
    const holdingLeader = new Set<ThemeId>();
    for (const h of s.slots) if (h && stockById(h.stockId).role === 'leader') holdingLeader.add(stockById(h.stockId).theme);
    const leaderUpProb = new Map<ThemeId, number>();
    for (const id of s.themeIds) {
      const leader = stocksOf(id).find((d) => d.role === 'leader');
      if (!leader || !s.stocks[leader.id]) continue;
      const r = stockOutlook(s, o, rules, leader.id, { held: false, boughtToday: false, lowBuy: false, leaderUpProb: new Map(), holdingLeader });
      leaderUpProb.set(id, r.pUp);
    }

    const value = (e: number[]): number => (e[0] ?? 0) + 0.6 * (e[1] ?? 0) + 0.35 * (e[2] ?? 0);
    const held = heldThemes(s);
    // 分散投资：同题材叠加要扣分（凑够 4 个题材亏损打折）
    const sameK = s.items.includes('diversify') ? Math.min(this.opt.sameThemeBonus, -0.8) : this.opt.sameThemeBonus;
    const sameBonus = (theme: ThemeId, excludeSelf: boolean): number => {
      const n = (held.get(theme) ?? 0) - (excludeSelf ? 1 : 0);
      return sameK * Math.max(0, n);
    };

    // 持仓的价值（押跌的反过来，扣手续费）
    const fee = BALANCE.ext.shortFee;
    const holdVals: { slot: number; v: number; e0: number }[] = [];
    s.slots.forEach((h, i) => {
      if (!h) return;
      const r = stockOutlook(s, o, rules, h.stockId, { held: true, boughtToday: !canSell(s, i), lowBuy: h.lowBuy, leaderUpProb, holdingLeader });
      if (h.short) holdVals.push({ slot: i, v: -value(r.e) - 2 * fee, e0: -(r.e[0] ?? 0) - fee });
      else holdVals.push({ slot: i, v: value(r.e) + sameBonus(themeOfStock(h.stockId), true), e0: r.e[0] ?? 0 });
    });

    // 1. 卖出：期望为负的（先卖最差的）
    const sellable = new Set(sellableSlots(s));
    const bad = holdVals.filter((x) => sellable.has(x.slot) && x.v < -0.4 && x.e0 < 0).sort((a, b) => a.v - b.v);
    if (bad.length > 0) {
      // 如果还能买到更好的，就留一次操作给替换
      const first = bad[0] as (typeof bad)[number];
      return { type: 'sell', slot: first.slot };
    }

    // 2. 买入：推荐里价值最高的
    if (s.today.buysLeft > 0) {
      let best = -1;
      let bestV = -Infinity;
      s.today.recs.forEach((rec, i) => {
        if (!buyable(s, i)) return;
        const theme = themeOfStock(rec.stockId);
        if ((held.get(theme) ?? 0) >= this.opt.maxPerTheme) return;
        if (this.opt.roles && !this.opt.roles.includes(stockById(rec.stockId).role)) return;
        if (this.opt.maxThemes !== undefined && !held.has(theme) && held.size >= this.opt.maxThemes && emptySlot(s) >= 0) return;
        const feel = feelOf(s.themes[theme]?.history ?? []);
        const lowBuy = feel === 'cold' || feel === 'cooling';
        const r = stockOutlook(s, o, rules, rec.stockId, { held: true, boughtToday: true, lowBuy, leaderUpProb, holdingLeader, firstBuy: s.today.buys === 0 });
        const v = value(r.e) + sameBonus(theme, false);
        if (v > bestV) {
          bestV = v;
          best = i;
        }
      });
      if (best >= 0) {
        const e = emptySlot(s);
        // 多开的那一格：拿满之后每只的权重从 1/4 变成 1/5，新买的要比现有持仓的平均价值高才划算
        const n = holdVals.length;
        const dilute = n >= BALANCE.slots ? holdVals.reduce((a, x) => a + x.v, 0) / n : -Infinity;
        // 0.4 C：押跌更划算时押跌（期望最负的那条推荐）
        if (this.opt.short && canShortNow(s) && e >= 0) {
          let sb = -1;
          let sv = -Infinity;
          s.today.recs.forEach((rec, i) => {
            if (!buyable(s, i) || stockById(rec.stockId).role === 'meme') return;
            const r = stockOutlook(s, o, rules, rec.stockId, { held: false, boughtToday: true, lowBuy: false, leaderUpProb, holdingLeader });
            const v = -value(r.e) - 2 * fee;
            if (v > sv) {
              sv = v;
              sb = i;
            }
          });
          if (sb >= 0 && sv > Math.max(bestV, (this.opt.fill ?? SMART_FILL) + 0.6) && validate(s, { type: 'buy', rec: sb, slot: e, short: true }) === null) {
            return { type: 'buy', rec: sb, slot: e, short: true };
          }
        }
        if (e >= 0 && bestV > (this.opt.fill ?? SMART_FILL) && bestV > dilute + 0.5) return { type: 'buy', rec: best, slot: e };
        // 满仓（或者多开的那一格不值得开）：考虑换掉最差的
        if (e < 0 || n >= BALANCE.slots) {
          const swap = holdVals.filter((x) => sellable.has(x.slot)).sort((a, b) => a.v - b.v)[0];
          if (swap && bestV - swap.v > (this.opt.swap ?? 1.8) && bestV > 1.0) return { type: 'buy', rec: best, slot: swap.slot };
        }
      }
    }
    return { type: 'open' };
  }

  private reward(s: GameState): Action {
    // 0.4 C：会押跌的先拿押跌许可证
    if (this.opt.short && !canShortNow(s)) {
      const k = s.reward?.cards.findIndex((c) => c.kind === 'item' && c.id === 'short_permit') ?? -1;
      if (k >= 0) return { type: 'pickReward', index: k };
    }
    // 只买白马的风格：白马信仰、价值眼光（多一只白马推荐）是核心
    const valueBonus = (id: string): number => (this.opt.roles?.includes('bluechip') && (id === 'value_eye' || id === 'baima') ? 8 : 0);
    if (this.opt.oracle) {
      // oracle 是上限：不挑流派，只按实测价值拿；它已经知道真实阶段和今天的行情，消息类道具和群友对它没用
      return pickRewardBy(s, (kind, id) => {
        if (kind === 'stock' && this.opt.roles && !this.opt.roles.includes(stockById(id).role)) return -1000;
        if (kind === 'item') return (ORACLE_ITEM_VALUE[id] ?? 2) + valueBonus(id);
        if (kind === 'friend') return 0;
        return emptySlot(s) >= 0 ? 7 : 3;
      });
    }
    if (this.archetype === null) {
      const names = Object.keys(ARCHETYPES);
      this.archetype = names[rngFor(s.seed, 'archetype', this.name).int(names.length)] as string;
    }
    const want = new Set(ARCHETYPES[this.archetype] ?? []);
    const rules = rulesOf(s);
    return pickRewardBy(s, (kind, id) => {
      if (kind === 'item' && this.opt.noItems) return -1000;
      if (kind === 'stock' && this.opt.roles && !this.opt.roles.includes(stockById(id).role)) return -1000;
      if (kind === 'item') return (ITEM_VALUE[id] ?? 2) + (want.has(id) ? 4 : 0) + valueBonus(id);
      if (kind === 'friend') return id === 'neimu' ? 4 + (want.has('paid_group') ? 4 : 0) : 3;
      // 稀有股票：空格或有亏损持仓时很值
      const e = emptySlot(s);
      if (e >= 0) return 7;
      const worst = Math.min(...s.slots.map((h) => (h ? h.value : 9)));
      return worst < 0.97 ? 5.5 : rules.slots > 4 ? 4 : 3;
    });
  }

  private event(s: GameState): Action {
    const e = s.event;
    if (!e) return { type: 'choose', option: 1 };
    const bad = rulesOf(s).eventBadMult;
    // 坏结果更坏（第 8 级）时，花钱碰运气的都不碰
    if (bad > 1 && ['side_hustle', 'fund_manager', 'blind_box', 'red_packet', 'course', 'lottery', 'classmate_loan'].includes(e.id)) {
      return { type: 'choose', option: 1 };
    }
    // 量化软件只对看不到真实阶段的人有用
    if (e.id === 'quant_trial' && this.opt.oracle) return { type: 'choose', option: 1 };
    // 0.4 C：押跌体验卡（会押跌的收下）；银行经理、爸妈的电话不借钱、说实话；丈母娘发红包
    if (e.id === 'bear_live') return { type: 'choose', option: this.opt.short ? 0 : 1 };
    if (e.id === 'bank_manager' || e.id === 'parents_call') return { type: 'choose', option: 1 };
    if (e.id === 'mother_in_law') return { type: 'choose', option: 0 };
    // 只买白马 / 不拿道具的风格：不收来路不明的股票和道具
    if (this.opt.roles && (e.id === 'cousin' || e.id === 'cat_keyboard')) return { type: 'choose', option: 1 };
    if (this.opt.noItems && (e.id === 'course' || e.id === 'blind_box' || e.id === 'quant_trial')) return { type: 'choose', option: 1 };
    switch (e.id) {
      case 'cousin':
        return { type: 'choose', option: 1 };
      case 'livestream': {
        const t = e.theme ? s.themes[e.theme] : undefined;
        return { type: 'choose', option: e.theme && heldThemes(s).has(e.theme) && (t?.heat ?? 100) < 80 ? 0 : 1 };
      }
      case 'course':
        return { type: 'choose', option: s.items.filter((id) => ITEMS.find((d) => d.id === id)?.kind === 'tactic').length < 2 ? 0 : 1 };
      case 'lottery':
        return { type: 'choose', option: 1 };
      case 'landlord':
        return { type: 'choose', option: (e.amount ?? 0) * bad < nextBillOf(s) * (fx('landlord', 'billMult') - 1) * bad ? 1 : 0 };
      case 'classmate_loan':
      case 'cat_keyboard':
        return { type: 'choose', option: 1 };
      case 'red_packet':
        return { type: 'choose', option: rulesOf(s).eventBadMult > 1 ? 1 : 0 };
      case 'side_hustle':
      case 'fund_manager':
        return { type: 'choose', option: s.account - (e.amount ?? 0) > nextBillOf(s) * 1.6 ? 0 : 1 };
      case 'blind_box':
        return { type: 'choose', option: s.account - (e.amount ?? 0) > nextBillOf(s) * 1.4 ? 0 : 1 };
      default:
        return { type: 'choose', option: 0 };
    }
  }
}

/** oracle：已知阶段与剩余天数，往后几天的期望热度变化。 */
function projectOracle(
  stage: Stage,
  left: number,
  theme: ThemeId,
  heat: number,
  mrs: MarketRules[],
  boost: { dH: number; days: number } | null,
): number[] {
  // 用一个确定的分布：今天之后的阶段按剩余天数推进
  const out: number[] = [];
  let d = newDist();
  // 构造“已持续若干天、还剩 left−1 天”的分布：用 hazard 近似，直接把年龄设成让剩余天数最可能的值
  const [, hi] = stageDays(stage, theme);
  const age = Math.max(1, Math.min(MAXAGE, hi - (left - 1)));
  d[idx(SI[stage], age)] = 1;
  let h = heat;
  for (let k = 1; k < HORIZON; k++) {
    const mr = mrs[Math.min(k, mrs.length - 1)] as MarketRules;
    if (k === 1 && left - 1 > 0) {
      const c = newDist();
      c[idx(SI[stage], Math.min(MAXAGE, age + 1))] = 1;
      d = h >= BALANCE.heat.max ? predict(d, theme, h, mr) : c;
    } else {
      d = predict(d, theme, h, mr);
    }
    const b = boost && boost.days > k ? boost.dH : 0;
    const e = expectedDH(d, theme, h, mr, b);
    out.push(e);
    h = Math.max(0, Math.min(BALANCE.heat.max, h + e));
  }
  return out;
}

// ================================================================ 名录

// ================================================================ 0.4 C：重仓派、押跌派、抵押赌徒

/** 这些机器人要用新机制，playRun 总是给它们打开 ext。 */
const NEEDS_EXT = new Set(['heavy', 'shorter', 'gambler', 'gambler-smart']);

/**
 * 在一个机器人外面套一层：仓位、押跌、借钱。inner 看到的局面里，押跌的格子当成空的（它只管买涨）。
 * - heavy：买涨一律重仓（剩下的钱全压上）；
 * - short：拿押跌许可证、收体验卡；风口过热 / 降温、或者唱空群友建议押跌的推荐押它跌（1 份）；
 *   押跌的风口转暖、被轧、亏 12% 就平掉；
 * - gamble：第 2 个月起能押的都押（借最多的先），银行经理上门就借，从不主动赎回。
 */
function extBot(name: string, inner: Bot, o: { heavy?: boolean; short?: boolean; gamble?: boolean }): Bot {
  return {
    name,
    act(s, rng) {
      if (s.phase === 'reward' && o.short && !canShortNow(s)) {
        const k = s.reward?.cards.findIndex((c) => c.kind === 'item' && c.id === 'short_permit') ?? -1;
        if (k >= 0) return { type: 'pickReward', index: k };
      }
      if (s.phase === 'event' && s.event) {
        const id = s.event.id;
        if (id === 'bear_live') return { type: 'choose', option: o.short ? 0 : 1 };
        if (id === 'bank_manager') return { type: 'choose', option: o.gamble ? 0 : 1 };
        if (id === 'mother_in_law') return { type: 'choose', option: 0 };
        if (id === 'parents_call') return { type: 'choose', option: 1 };
      }
      if (s.phase !== 'premarket') return inner.act(s, rng);
      if (o.gamble && !isBusy(s)) {
        const ids = [...COLLATERAL_IDS].sort((a, b) => (collateralTerms(b, s.difficulty)?.amount ?? 0) - (collateralTerms(a, s.difficulty)?.amount ?? 0));
        for (const id of ids) if (validate(s, { type: 'borrow', id }) === null) return { type: 'borrow', id };
      }
      if (o.short && canShortNow(s) && !isBusy(s) && s.today.ops < 2) {
        // 平掉押错的
        for (const i of sellableSlots(s)) {
          const h = s.slots[i];
          if (!h?.short) continue;
          const f = feelOf(s.themes[themeOfStock(h.stockId)]?.history ?? []);
          if (f === 'warming' || f === 'cold' || (h.squeezed ?? 0) > 0 || h.value < 0.88) return { type: 'sell', slot: i };
        }
        // 押跌：过热、降温的风口，或者唱空群友点名的
        const e = emptySlot(s);
        if (e >= 0 && s.today.buysLeft > 0 && s.slots.filter((h) => h?.short).length < 2) {
          const k = s.today.recs.findIndex((r, i) => {
            if (!buyable(s, i) || stockById(r.stockId).role === 'meme') return false;
            const f = feelOf(s.themes[themeOfStock(r.stockId)]?.history ?? []);
            return f === 'cooling' || f === 'overheated' || (!!r.short && f !== 'warming' && f !== 'cold');
          });
          if (k >= 0 && validate(s, { type: 'buy', rec: k, slot: e, short: true }) === null) return { type: 'buy', rec: k, slot: e, short: true };
        }
      }
      // 买涨交给 inner（押跌的格子对它来说是空的）
      const view: GameState = o.short ? { ...s, slots: s.slots.map((h) => (h?.short ? null : h)) } : s;
      let a = inner.act(view, rng);
      if (a.type === 'buy') {
        if (a.slot !== undefined && s.slots[a.slot]?.short) {
          const e = emptySlot(s);
          if (e < 0) return { type: 'open' };
          a = { ...a, slot: e };
        }
        if (o.heavy) a = { ...a, size: 'heavy' };
        if (validate(s, a) !== null) a = { type: 'open' };
      }
      if (a.type === 'sell' && (!s.slots[a.slot] || s.slots[a.slot]?.short)) a = { type: 'open' };
      // 重仓派：赚钱的那只有现金就加
      if (a.type === 'open' && o.heavy && !isBusy(s) && freeUnits(s) >= 1) {
        const k = s.slots.findIndex((h, i) => !!h && !h.short && (h.todayRet ?? 0) > 0 && h.value > 1.05 && validate(s, { type: 'add', slot: i }) === null);
        if (k >= 0) return { type: 'add', slot: k };
      }
      return a;
    },
  };
}


// ================================================================ 0.5：个股照搬真实走势时的机器人

/**
 * 真实行情 0.5 下，smart / oracle 的选股改用情报的期望值（0.4 的贝叶斯阶段模型针对的是"风口热度决定个股涨跌"，
 * 现在个股照搬真实走势，热度只是信息）。
 * - smart：知道每个群友真实的准确率（messageCred / recCredibility，相当于玩了很多局的老玩家），按"说中概率超过瞎猜的部分"给期望；
 * - truster（信靠谱群友）：只看战绩（说对次数 / 发言次数，带先验）好的群友，其余的话当没听见；
 * - oracle：直接看行情段里今天和明天的真实涨跌（上限）。
 * 领奖励和事件交给 normal。
 */
const TRACK_MSG = 4;
const TRACK_REC = 6;
const TRACK_BUY = 0.6;
const TRACK_SELL = -0.6;
const TRACK_SWAP = 2;

interface TrackMemo {
  until: number;
  e: number;
}

function trackBot(name: string, mode: 'smart' | 'oracle' | 'truster', inner: Bot): Bot {
  const stockMemo = new Map<string, TrackMemo>();
  const themeMemo: { theme: ThemeId; until: number; e: number }[] = [];
  let seenDay = -1;
  let opsToday = 0;
  return {
    name,
    act(s, rng) {
      if (s.phase !== 'premarket') return inner.act(s, rng);
      const real = s.real as NonNullable<GameState['real']>;
      const day = s.today.day;
      const rules = rulesOf(s);
      const observed = (id: string): number => {
        const f = s.friends.find((x) => x.id === id);
        return ((f?.hits ?? 0) + 0.5 * 4) / ((f?.total ?? 0) + 4);
      };
      const msgCred = (m: GameState['today']['messages'][number]): number => {
        if (m.reverse) return fx('fan_qunzhu', 'acc');
        if (mode === 'truster') {
          const c = observed(m.friendId);
          return c >= 0.55 ? c : 1 / 3;
        }
        return messageCred(s, m.friendId, m.theme, rules);
      };
      const recCred = (r: GameState['today']['recs'][number]): number => {
        if (mode === 'truster') {
          const c = observed(r.friendId);
          return c >= 0.55 ? c : 1 / 3;
        }
        return recCredibility(s, r.friendId, stockById(r.stockId).theme, rules);
      };
      if (seenDay !== day) {
        seenDay = day;
        opsToday = 0;
        for (const m of s.today.messages) {
          const claim = m.reverse ? flipDir(m.claim) : m.claim;
          const sign = claim === 'up' ? 1 : claim === 'down' ? -1 : 0;
          const days = m.days ?? 1;
          if (sign !== 0) themeMemo.push({ theme: m.theme, until: day + days - 1, e: (sign * (msgCred(m) - 1 / 3) * TRACK_MSG) / days });
        }
        for (const r of s.today.recs) {
          const days = r.days ?? 1;
          const sign = r.short ? -1 : 1;
          stockMemo.set(r.stockId, { until: day + days - 1, e: (sign * (recCred(r) - 1 / 3) * TRACK_REC) / days });
        }
      }
      const expect = (id: string): number => {
        if (mode === 'oracle') return forwardRet(real, 'stock', id, day, 1) + 0.5 * forwardRet(real, 'stock', id, day + 1, 1);
        const theme = stockById(id).theme;
        let e = 0;
        for (const m of themeMemo) if (m.theme === theme && m.until >= day) e += m.e;
        const st = stockMemo.get(id);
        if (st && st.until >= day) e += st.e;
        return e;
      };
      if (opsToday >= 4) return { type: 'open' };
      // 卖：期望明显为负
      for (const i of sellableSlots(s)) {
        const h = s.slots[i];
        if (!h) continue;
        const e = h.short ? -expect(h.stockId) : expect(h.stockId);
        if (e < TRACK_SELL) {
          opsToday += 1;
          return { type: 'sell', slot: i };
        }
      }
      // 买：期望最高的推荐（只做多）；空格优先，否则换掉期望最低、能卖的
      if (s.today.buysLeft > 0) {
        let best = -1;
        let bestE = TRACK_BUY;
        s.today.recs.forEach((r, i) => {
          if (r.short || !buyable(s, i)) return;
          const only = rules.onlyRoles;
          if (only && !only.includes(stockById(r.stockId).role)) return;
          const e = expect(r.stockId);
          if (e > bestE) {
            bestE = e;
            best = i;
          }
        });
        if (best >= 0) {
          const e = emptySlot(s);
          if (e >= 0) {
            opsToday += 1;
            return { type: 'buy', rec: best, slot: e };
          }
          let victim = -1;
          let vE = Infinity;
          for (const i of sellableSlots(s)) {
            const h = s.slots[i];
            if (!h) continue;
            const x = h.short ? -expect(h.stockId) : expect(h.stockId);
            if (x < vE) {
              vE = x;
              victim = i;
            }
          }
          if (victim >= 0 && bestE - vE > TRACK_SWAP) {
            opsToday += 1;
            return { type: 'buy', rec: best, slot: victim };
          }
        }
      }
      return { type: 'open' };
    },
  };
}

/** 真实行情 0.5 用 trackBot，其余（合成行情、0.4 旧档）用原来的机器人。 */
function dual(track: Bot, old: Bot): Bot {
  return {
    name: track.name,
    act(s, rng) {
      return s.real?.track ? track.act(s, rng) : old.act(s, rng);
    },
  };
}

export const BOTS: Record<string, BotFactory> = {
  heavy: () => extBot('heavy', normalBot(), { heavy: true }),
  shorter: () => extBot('shorter', normalBot(), { short: true }),
  gambler: () => extBot('gambler', normalBot(), { gamble: true }),
  'gambler-smart': () => extBot('gambler-smart', BOTS.smart!(), { gamble: true }),
  random: randomBot,
  follower: followerBot,
  chaser: chaserBot,
  xiaobai: xiaobaiBot,
  putong: () => ({ ...normalBot(), name: 'putong' }),
  normal: () => normalBot(),
  'normal-nomsg': () => normalBot(true),
  smart: () => dual(trackBot('smart', 'smart', normalBot()), new SmartBot({ name: 'smart', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, short: true })),
  truster: () => dual(trackBot('truster', 'truster', normalBot()), normalBot()),
  'smart-focus1': () => new SmartBot({ name: 'smart-focus1', maxPerTheme: 9, sameThemeBonus: 0.8, maxThemes: 1, oracle: false }),
  'smart-focus2': () => new SmartBot({ name: 'smart-focus2', maxPerTheme: 9, sameThemeBonus: 0.8, maxThemes: 2, oracle: false }),
  'smart-spread': () => new SmartBot({ name: 'smart-spread', maxPerTheme: 2, sameThemeBonus: -0.4, oracle: false }),
  'smart-spread1': () => new SmartBot({ name: 'smart-spread1', maxPerTheme: 1, sameThemeBonus: 0, oracle: false }),
  oracle: () => dual(trackBot('oracle', 'oracle', normalBot()), new SmartBot({ name: 'oracle', maxPerTheme: 9, sameThemeBonus: 0, oracle: true, fill: 0.2, short: true })),
  'smart-value': () => new SmartBot({ name: 'smart-value', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, roles: ['bluechip'], fill: 0.3 }),
  'smart-naked': () => new SmartBot({ name: 'smart-naked', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, noItems: true }),
  'oracle-value': () => new SmartBot({ name: 'oracle-value', maxPerTheme: 9, sameThemeBonus: 0, oracle: true, roles: ['bluechip'], fill: 0 }),
  'smart-peek': () => new SmartBot({ name: 'smart-peek', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, peek: true }),
  'smart-peekmsg': () => new SmartBot({ name: 'smart-peekmsg', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, peekMsg: true }),
  'smart-nomsg': () => new SmartBot({ name: 'smart-nomsg', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, ignoreMsg: true }),
  'smart-truedir': () => new SmartBot({ name: 'smart-truedir', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, trueDir: true }),
  'smart-truedirturn': () => new SmartBot({ name: 'smart-truedirturn', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, trueDirTurn: true }),
  'smart-peekturn': () => new SmartBot({ name: 'smart-peekturn', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, peekTurn: true }),
  'smart-norec': () => new SmartBot({ name: 'smart-norec', maxPerTheme: 2, sameThemeBonus: 0, oracle: false, ignoreRec: true }),
  'oracle-stage': () => new SmartBot({ name: 'oracle-stage', maxPerTheme: 9, sameThemeBonus: 0, oracle: true, oracleToday: false }),
  qunzhu: qunzhuBot,
};

export function botByName(name: string): BotFactory {
  const b = BOTS[name];
  if (!b) throw new Error(`未知机器人：${name}（可选：${Object.keys(BOTS).join('、')}）`);
  return b;
}

/** 机器人的角色偏好说明（--list 用）。 */
export const BOT_DESC: Record<string, string> = {
  random: '随机买卖',
  truster: '0.5 信靠谱群友：只听战绩好（带先验 ≥ 55%）的群友的推荐和消息，期望值决策；合成行情下同 normal',
  follower: '总是买推荐里的第一只，从不卖',
  chaser: '追最热的题材，热度下降就卖',
  xiaobai: '0.10.0 小白（balance.md）：追最热的题材、谁说涨都信、说跌就卖，不止损、不押跌、不抵押',
  putong: '0.10.0 普通（balance.md）：同 normal，简单合理的打法，会止损',
  normal: '普通人：看战绩、升温早期买、过热且看空就卖、两个题材',
  smart: '贝叶斯推断题材阶段 + 群友可信度，期望值决策（同题材最多 2 只）',
  'smart-focus1': 'smart，只拿 1 个题材（极端集中）',
  'smart-focus2': 'smart，集中：最多 2 个题材，同题材优先叠加',
  'smart-spread': 'smart，分散：同题材最多 2 只，偏好新题材',
  'smart-spread1': 'smart，极端分散：每个题材最多 1 只',
  oracle: '知道真实阶段和当天的热度变化（真实行情下还能看行情段往后两天）；能押跌时押跌',
  heavy: '0.4 C 重仓派：normal 的选股，买一律重仓，赚钱的有现金就加仓',
  shorter: '0.4 C 押跌派：先拿押跌许可证；过热、降温的风口押跌，转暖、被轧就平；其余像 normal',
  gambler: '0.4 C 抵押赌徒：normal 的选股，第 2 个月起能押的都押去借钱，从不主动赎回',
  'gambler-smart': '0.4 C 诊断：smart 的选股 + 能押的都押',
  qunzhu: '无脑跟群主：买群主推荐的，群主说跌就卖',
  'normal-nomsg': '诊断：normal 不看消息（推荐照常）',
  'smart-peek': '诊断：smart + 偷看所有题材今天的热度变化（消息价值的上限）',
  'smart-peekmsg': '诊断：smart + 偷看今天有消息的题材',
  'smart-nomsg': '诊断：smart 不看消息（推荐照常）',
  'smart-norec': '诊断：smart 不把推荐当信号',
  'smart-truedir': '诊断：smart + 今天的消息方向全对（只有方向）',
  'smart-truedirturn': '诊断：smart + 拐点题材的消息方向全对',
  'smart-peekturn': '诊断：smart + 偷看今天处在拐点的题材',
  'oracle-stage': '诊断：oracle 只知道真实阶段，不知道今天的热度变化',
  'smart-value': '成就用：smart 只买白马（价值投资）',
  'oracle-value': '诊断：oracle 只买白马（价值投资的上限）',
  'smart-naked': '成就用：smart 一个道具都不拿（裸考）',
};
