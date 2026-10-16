/**
 * 群聊：每天的题材消息、推荐股票、收盘后的吐槽。
 */
import { BALANCE, fx } from './balance.ts';
import {
  BIG_LOSS_LINES,
  BIG_WIN_LINES,
  BLAME_LINES,
  BRAG_LINES,
  CHEER_LINES,
  HAND_TAILS,
  MESSAGE_LINES,
  MISS_LINES,
  MOCK_LINES,
  REACT_LINES,
  REACT_MOOD,
  REC_LINES,
  TURN_LINES,
  friendById,
  personaAccount,
  stockById,
  stocksOf,
  themeById,
  type ReactMoment,
} from './content/index.ts';
import { formatMoney } from './format.ts';
import type { Rules } from './hooks.ts';
import { DIRS, clamp, dirOf, effectiveDH, feelOf, turnOf } from './market.ts';
import { bandDir, forwardRet, isTrack } from './real.ts';
import { rngFor, type Rng } from './rng.ts';
import type { RealMarket } from './segment.ts';
import type { Comment, DayReport, Dir, Feel, FriendState, GameState, Message, Rec, StockDef, ThemeId, TurnTalk } from './types.ts';

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function pickLine(rng: Rng, lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) return '';
  return lines[rng.int(lines.length)] as string;
}

/** 按权重不放回地挑 n 个。 */
function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (t: T) => number, n: number): T[] {
  const pool = items.filter((t) => weight(t) > 0);
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const t = rng.weighted(pool, pool.map(weight));
    out.push(t);
    pool.splice(pool.indexOf(t), 1);
  }
  return out;
}

/** 当前最热的题材（热度相同取看板上靠前的）。 */
export function hottestTheme(s: Readonly<GameState>): ThemeId {
  let best = s.themeIds[0] as ThemeId;
  let heat = -1;
  for (const id of s.themeIds) {
    const h = s.themes[id]?.heat ?? 0;
    if (h > heat) {
      heat = h;
      best = id;
    }
  }
  return best;
}

/** 群友实际擅长的题材（已过滤到本局登场的）。大V是当前最热的题材，群主是全部。 */
export function topicsOf(s: Readonly<GameState>, f: Readonly<FriendState>): ThemeId[] {
  const def = friendById(f.id);
  if (def.topics === 'hottest') return [hottestTheme(s)];
  if (def.topics === 'all') return [...s.themeIds];
  return f.topics.filter((t) => s.themeIds.includes(t));
}

/**
 * 0.7.0 群友这一局的状态（隐藏）：可信度偏移和说话权重倍数，按种子和群友 id 定，整局不变、均值为 0 / 1。
 * 中途入群的群友也一样，不用存进存档。只在真实行情下有：0.3 的合成行情是离线兜底，保持和 0.3 逐位相同（见 replay-030 测试）。
 */
export function friendForm(s: Readonly<GameState>, friendId: string): { cred: number; talk: number } {
  if (!isTrack(s.real)) return NO_FORM;
  // 一天要查几十次（每只候选股都要算一次可信度），按种子缓存；同样的输入结果不变，缓存不影响确定性。
  // 数值改了（模拟器 --set、测试里临时改 BALANCE）也要作废
  const { cred, talk } = BALANCE.chat.form;
  if (memo.seed !== s.seed || memo.cred !== cred || memo.talk !== talk) {
    memo.seed = s.seed;
    memo.cred = cred;
    memo.talk = talk;
    memo.forms.clear();
  }
  const hit = memo.forms.get(friendId);
  if (hit) return hit;
  const rng = rngFor(s.seed, 'form', friendId);
  const form = { cred: (rng.next() * 2 - 1) * cred, talk: 1 + (rng.next() * 2 - 1) * talk };
  memo.forms.set(friendId, form);
  return form;
}
const NO_FORM = { cred: 0, talk: 1 } as const;
const memo = { seed: '', cred: Number.NaN, talk: Number.NaN, forms: new Map<string, { cred: number; talk: number }>() };

function credOf(s: Readonly<GameState>, friendId: string, theme: ThemeId, rules: Readonly<Rules>, msg: boolean): number {
  const over = rules.credOverride[friendId];
  if (over !== undefined) return clamp(over, 0, 1);
  const f = s.friends.find((x) => x.id === friendId);
  const [expert, other] = (isTrack(s.real) ? BALANCE.intel.cred[friendId] : BALANCE.cred[friendId]) ?? [0.5, 0.5];
  const isExpert = f ? topicsOf(s, f).includes(theme) : false;
  // 开局就在群里的靠谱群友聊擅长的题材时，消息比他荐的股更准（荐股还要挑个股，消息只说题材的方向）；
  // 道具带进来的群友（内幕哥、主播）按道具说明的可信度，不加
  const { expertMsg, credMax, reliable } = BALANCE.chat;
  const tip = msg && isExpert && expert >= reliable && friendById(friendId).founding ? expertMsg : 0;
  // 所有加成之后封顶：只有道具（credOverride，如老王的小本本）能"必中"，否则 credibility 会泄露今天的真实方向
  // 0.5（真实行情）：难度每高一级，所有人的准确率再低一点
  const diff = isTrack(s.real) ? BALANCE.intel.diffStep * (Math.max(1, s.difficulty) - 1) : 0;
  const form = friendForm(s, friendId).cred;
  const c = clamp((isExpert ? expert : other) + form + tip + (msg ? rules.credDelta : 0) + (rules.credBonus[friendId] ?? 0) - diff, 0, credMax);
  // 消息失真：一部分消息是瞎传的（随机方向），可信度向 1/3 靠拢
  return msg && rules.msgNoise > 0 ? c * (1 - rules.msgNoise) + rules.msgNoise / 3 : c;
}

/** 群友对某题材的消息可信度（说中的概率）。 */
export function credibility(s: Readonly<GameState>, friendId: string, theme: ThemeId, rules: Readonly<Rules>): number {
  return credOf(s, friendId, theme, rules, true);
}

/**
 * 群友推荐股票时判断今天方向的准确率：不受难度"消息失真"（credDelta、msgNoise）影响——失真的是群聊消息，
 * 推荐还是按群友自己的眼光挑；也没有"聊擅长题材"的消息加成（BALANCE.chat.expertMsg）。
 */
export function recCredibility(s: Readonly<GameState>, friendId: string, theme: ThemeId, rules: Readonly<Rules>): number {
  return credOf(s, friendId, theme, rules, false);
}

/** 隐藏：题材今天是拐点时被聊到的权重倍数（不是拐点为 1）。 */
function turnWeight(s: Readonly<GameState>, theme: ThemeId): number {
  const t = s.themes[theme];
  const k = t ? turnOf(t) : null;
  return k ? BALANCE.chat.turn[k] : 1;
}

/**
 * 群友谈某个题材：擅长的优先（开局群友 focus 概率，新群友只谈擅长的），否则随机。
 * 按 热度 + heatBias 加权，今天是拐点的题材再乘 BALANCE.chat.turn。
 */
function pickTopic(s: Readonly<GameState>, f: Readonly<FriendState>, rng: Rng): ThemeId {
  const u = rng.next();
  const k = rng.next();
  const def = friendById(f.id);
  const topics = topicsOf(s, f);
  const focus = def.founding ? BALANCE.chat.focus : 1;
  const list = topics.length > 0 && u < focus ? topics : s.themeIds;
  return pickByWeight(list, list.map((t) => ((s.themes[t]?.heat ?? 0) + BALANCE.chat.heatBias) * turnWeight(s, t)), k);
}

/** 说话的权重：擅长的题材今天是拐点时更爱开口（群主什么都聊，不算）。 */
function talkWeight(s: Readonly<GameState>, f: Readonly<FriendState>, rules: Readonly<Rules>): number {
  const w = (BALANCE.chat.talk[f.id] ?? 1) * (rules.friendWeight[f.id] ?? 1) * friendForm(s, f.id).talk;
  if (friendById(f.id).topics === 'all') return w;
  return topicsOf(s, f).some((t) => turnWeight(s, t) > 1) ? w * BALANCE.chat.turnSpeak : w;
}

/**
 * 消息实际说中的概率：可信度；靠谱的群友（擅长题材可信度 ≥ reliable）在擅长题材的拐点上再加 turnCred。
 * 隐藏信息，画面只显示战绩。
 */
export function messageCred(s: Readonly<GameState>, friendId: string, theme: ThemeId, rules: Readonly<Rules>): number {
  const c = credibility(s, friendId, theme, rules);
  const bonus = BALANCE.chat.turnCred * rules.turnCredMult;
  if (bonus <= 0 || turnWeight(s, theme) <= 1) return c;
  const f = s.friends.find((x) => x.id === friendId);
  const reliable = ((isTrack(s.real) ? BALANCE.intel.cred : BALANCE.cred)[friendId]?.[0] ?? 0) >= BALANCE.chat.reliable;
  if (!f || !reliable || !topicsOf(s, f).includes(theme)) return c;
  return clamp(c + bonus, 0, 1);
}

/** 拐点说法：说的方向和眼下的公开走势相反时用（只看公开体感，不泄露真实阶段）。 */
export function turnTalk(claim: Dir, feel: Feel): TurnTalk | null {
  const quiet = feel === 'cold' || feel === 'cooling';
  if (claim === 'up' && quiet) return 'start';
  if (claim === 'flat' && (feel === 'hot' || feel === 'overheated')) return 'top';
  if (claim === 'down' && !quiet) return 'ebb';
  return null;
}

/** 反方向：涨变跌、跌变涨，横还是横（反着信群主用）。 */
export function flipDir(d: Dir): Dir {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : 'flat';
}

/** 0.7.0 这局手气：已揭晓的消息至少 min 条，说中率到 hot 算手气好、不到 cold 算手气差；chance 是消息带口气的比例。 */
const HAND = { min: 4, hot: 0.7, cold: 0.35, chance: 0.5 };

/** 群友这局的手气（只看本局公开战绩，和画面上的"说对 x/y"一致）。 */
export function handOf(f: Readonly<FriendState>): 'hot' | 'cold' | null {
  if (f.total < HAND.min) return null;
  const r = f.hits / f.total;
  return r >= HAND.hot ? 'hot' : r <= HAND.cold ? 'cold' : null;
}

/** 手气好或差时，一部分消息句尾带一句口气。用单独的随机流，消息本身怎么抽一点不变。 */
function withHand(s: Readonly<GameState>, f: Readonly<FriendState>, key: number, text: string): string {
  const hand = handOf(f);
  const lines = hand ? HAND_TAILS[f.id]?.[hand] : undefined;
  if (!lines || lines.length === 0) return text;
  const rng = rngFor(s.seed, 'hand', s.today.day, key);
  return rng.next() < HAND.chance ? text + pickLine(rng, lines) : text;
}

/**
 * 今天开盘前的题材消息（2–4 条，小道消息再多几条，各来自不同群友）。说中的概率等于可信度（见 messageCred），
 * 说错时改说另外两种方向之一。群友更爱在拐点开口，台词按说的方向和公开走势挑。
 * 反着信群主（道具）：群主的消息按反方向读有 fx('fan_qunzhu','acc') 的概率是对的，消息带 reverse 标记。
 */
export function makeMessages(s: Readonly<GameState>, rules: Readonly<Rules>): Message[] {
  if (s.setup?.noChat) return [];
  if (isTrack(s.real)) return trackMessages(s, s.real as RealMarket, rules);
  const rng = rngFor(s.seed, 'chat', s.today.day);
  const [lo, hi] = BALANCE.messages;
  const n = lo + rng.int(hi - lo + 1) + rules.extraMessages;
  const speakers = pickWeighted(rng, s.friends, (f) => talkWeight(s, f, rules), n);
  return speakers.map((f, i) => {
    const theme = pickTopic(s, f, rng);
    const uClaim = rng.next();
    const uWrong = rng.next();
    const t = s.themes[theme];
    const truth = dirOf(t ? effectiveDH(t.heat, s.today.plan.dH[theme] ?? 0) : 0);
    const reverse = rules.reverseQunzhu && f.id === 'qunzhu';
    // 反指：让"反着读"（flipDir(claim)）以 acc 的概率等于真相
    const target = reverse ? flipDir(truth) : truth;
    const cred = reverse ? fx('fan_qunzhu', 'acc') : messageCred(s, f.id, theme, rules);
    const others = DIRS.filter((d) => d !== target);
    // 0.4 C 空军老周：说错的时候一律唱空
    const wrong: Dir = f.id === 'kongjun' && target !== 'down' ? 'down' : (others[uWrong < 0.5 ? 0 : 1] as Dir);
    const claim: Dir = uClaim < cred ? target : wrong;
    const turn = turnTalk(claim, feelOf(t?.history ?? []));
    const lines = turn ? TURN_LINES[f.id]?.[turn] : MESSAGE_LINES[f.id]?.[claim];
    const text = withHand(s, f, i, fill(pickLine(rng, lines), { theme: themeById(theme).name }));
    const m: Message = { friendId: f.id, theme, claim, text };
    if (turn) m.turn = turn;
    if (reverse) m.reverse = true;
    return m;
  });
}

/**
 * 0.7.0 推荐语：每个群友的推荐语按种子打乱、按天轮着用，同一个人隔几天又推同一只股票也不会一字不差。
 * 推荐语是推荐里最后才定的东西，不从推荐的随机流里抽，推哪只股票不受影响。
 */
function recLine(s: Readonly<GameState>, friendId: string): string {
  const lines = REC_LINES[friendId] ?? [];
  if (lines.length === 0) return '';
  const rng = rngFor(s.seed, 'recLine', friendId);
  const order = lines.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return lines[order[s.today.day % lines.length] as number] as string;
}

function availableStocks(s: Readonly<GameState>, theme: ThemeId | null, taken: ReadonlySet<string>, only: readonly string[] | null = null): StockDef[] {
  const list = theme ? stocksOf(theme) : s.themeIds.flatMap((t) => stocksOf(t));
  return list.filter((d) => {
    const st = s.stocks[d.id];
    return st && !st.delisted && !taken.has(d.id) && (!only || only.includes(d.role));
  });
}

/** 群友对某题材今天方向的判断：以可信度猜中，否则猜成另外两种之一。 */
function believe(s: Readonly<GameState>, friendId: string, theme: ThemeId, rules: Readonly<Rules>, rng: Rng): Dir {
  const t = s.themes[theme];
  const truth = dirOf(t ? effectiveDH(t.heat, s.today.plan.dH[theme] ?? 0) : 0);
  const right = rng.next() < recCredibility(s, friendId, theme, rules);
  const u = rng.next();
  if (right) return truth;
  const others = DIRS.filter((d) => d !== truth);
  return others[u < 0.5 ? 0 : 1] as Dir;
}

/** 凭印象：越热越觉得会涨（与今天的真实方向无关）。 */
function hunch(s: Readonly<GameState>, theme: ThemeId, rng: Rng): Dir {
  const heat = s.themes[theme]?.heat ?? 0;
  return rng.next() < 0.25 + (0.5 * heat) / BALANCE.heat.max ? 'up' : 'flat';
}

function pickByWeight<T>(items: readonly T[], weights: readonly number[], u: number): T {
  let total = 0;
  for (const x of weights) total += x;
  let v = u * total;
  for (let i = 0; i < items.length; i++) {
    v -= weights[i] as number;
    if (v < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

/**
 * 今天的 3 只推荐：推荐人按权重挑（不重复）。群友在擅长的题材里挑自己"觉得今天会涨"的那个
 * （判断的准确率就是他的可信度），不保证能涨；群主专挑高位的题材喊单（反指）；大V只推最热的题材。
 * 关闭群聊时（模拟用）推荐来自行情软件，随机挑，friendId 为空串。
 */
export function makeRecs(s: Readonly<GameState>, rules: Readonly<Rules>): Rec[] {
  if (isTrack(s.real) && !s.setup?.noChat) return trackRecs(s, s.real as RealMarket, rules);
  const rng = rngFor(s.seed, 'recs', s.today.day);
  const taken = new Set<string>();
  for (const h of s.slots) if (h) taken.add(h.stockId);
  const recs: Rec[] = [];
  if (s.setup?.noChat) {
    for (let k = 0; k < BALANCE.recs + rules.extraRecs; k++) {
      const pool = availableStocks(s, null, taken);
      if (pool.length === 0) break;
      const pick = pickByWeight(pool, pool.map((d) => BALANCE.chat.screenerWeights[d.role] ?? 1), rng.next());
      taken.add(pick.id);
      recs.push({ stockId: pick.id, friendId: '', text: `${pick.name}（行情软件推荐）`, taken: false });
    }
    return recs;
  }
  const count = BALANCE.recs + rules.extraRecs;
  const recommenders = pickWeighted(rng, s.friends, (f) => (BALANCE.chat.rec[f.id] ?? 1) * (rules.friendWeight[f.id] ?? 1), count);
  for (const f of recommenders) {
    const def = friendById(f.id);
    const r = rngFor(s.seed, 'rec', s.today.day, f.id);
    const uFocus = r.next();
    const uTheme = r.next();
    const uStock = r.next();
    const topics = topicsOf(s, f);
    let candidates: ThemeId[];
    let memeOnly = false;
    let shill = false;
    if (f.id === 'kongjun') {
      // 0.4 C 空军老周：挑他觉得会跌的风口，建议押它跌（没有看跌的就挑最热的）
      const cands = s.themeIds.filter((t) => availableStocks(s, t, taken).length > 0);
      if (cands.length === 0) break;
      const downs = cands.filter((t) => believe(s, f.id, t, rules, r) === 'down');
      const theme = downs.length > 0 ? (downs[Math.floor(uTheme * downs.length)] as ThemeId) : hottestTheme(s);
      const pool = availableStocks(s, theme, taken);
      const pick = pool.length > 0 ? pickByWeight(pool, pool.map((d) => BALANCE.chat.roleWeights[d.role] ?? 1), uStock) : null;
      if (!pick) continue;
      taken.add(pick.id);
      recs.push({ stockId: pick.id, friendId: f.id, text: fill(recLine(s, f.id), { stock: pick.name }), taken: false, short: true });
      continue;
    }
    if (f.id === 'qunzhu') {
      shill = true;
      candidates = [...s.themeIds];
    } else if (def.topics === 'hottest') {
      candidates = [hottestTheme(s)];
    } else {
      memeOnly = !!def.memes && uFocus >= 0.5;
      // 开局群友什么题材都会推，新群友只推擅长的
      candidates = def.founding ? [...s.themeIds] : topics;
    }
    candidates = candidates.filter((t) => availableStocks(s, t, taken).some((d) => !memeOnly || d.role === 'meme'));
    if (candidates.length === 0) candidates = s.themeIds.filter((t) => availableStocks(s, t, taken).length > 0);
    if (candidates.length === 0) break;
    let theme: ThemeId;
    if (shill) {
      theme = pickByWeight(candidates, candidates.map((t) => BALANCE.chat.shill[s.themes[t]?.stage ?? 'cold']), uTheme);
    } else {
      // 挑自己觉得今天会涨的：擅长的题材优先（focus），其次别的题材，都不看好就推擅长的。
      // 只有 recInsight 的概率真的去判断今天的方向，否则凭印象挑（按热度），推荐本身不带今天的信息
      const insight = r.next() < BALANCE.chat.recInsight;
      const beliefs = candidates.map((t) => (insight ? believe(s, f.id, t, rules, r) : hunch(s, t, r)));
      const ups = candidates.filter((_, i) => beliefs[i] === 'up');
      const upTopics = ups.filter((t) => topics.includes(t));
      const mine = candidates.filter((t) => topics.includes(t));
      const focus = def.founding ? BALANCE.chat.focus : 1;
      const list = upTopics.length > 0 && (uFocus < focus || memeOnly) ? upTopics : ups.length > 0 ? ups : mine.length > 0 ? mine : candidates;
      theme = list[Math.floor(uTheme * list.length)] as ThemeId;
    }
    let pool = availableStocks(s, theme, taken);
    if (memeOnly && pool.some((d) => d.role === 'meme')) pool = pool.filter((d) => d.role === 'meme');
    const boost = (d: StockDef): number => (shill && d.role === 'meme' ? BALANCE.chat.shillMeme : 1);
    // 角色权重按角色分摊：同一题材里同角色的股票多了，不会挤占龙头被推荐的机会
    const roleCount = new Map<string, number>();
    for (const d of pool) roleCount.set(d.role, (roleCount.get(d.role) ?? 0) + 1);
    const pick = pickByWeight(pool, pool.map((d) => ((BALANCE.chat.roleWeights[d.role] ?? 1) * boost(d)) / (roleCount.get(d.role) ?? 1)), uStock);
    taken.add(pick.id);
    recs.push({ stockId: pick.id, friendId: f.id, text: fill(recLine(s, f.id), { stock: pick.name }), taken: false });
  }
  return recs;
}

/** 账户第一次到开局的这些倍数时，群里有人接一句。 */
const RECORD_MULTS = [2, 3, 5, 10, 20, 50, 100] as const;

/** 没有专属说法、或者抽到"随便谁说一句"时用的通用台词（只有这几种时机有）。 */
const GENERIC_LINES: Partial<Record<ReactMoment, readonly string[]>> = {
  bigWin: BIG_WIN_LINES,
  bigLoss: BIG_LOSS_LINES,
  cheer: CHEER_LINES,
  mock: MOCK_LINES,
  miss: MISS_LINES,
};
/** 有通用台词的时机里，随便谁说一句通用话的比例（其余按性格挑人、说他自己的话）。 */
const GENERIC_SHARE = 0.25;

/**
 * 0.7.0 今天收盘群里该接哪句话：只看今天已经揭晓的结果和公开的账面，按下面的先后取第一个。
 * 连赚、这个月亏多了、月底钱不够这几种会连着好几天成立，按概率说，免得天天念叨。
 */
function situation(s: Readonly<GameState>, report: Readonly<DayReport>): { moment: ReactMoment; vars: Record<string, string> } | null {
  const T = BALANCE.talk;
  const held = report.holdings.length > 0;
  const { before, after, ret } = report.account;
  const u = rngFor(s.seed, 'situation', report.day).next();
  const start = s.setup?.account ?? personaAccount(s.persona);
  const mult = [...RECORD_MULTS].reverse().find((m) => before < start * m && after >= start * m);
  if (mult) return { moment: 'record', vars: { n: String(mult) } };
  const amount = formatMoney(Math.abs(after - before));
  if (held && ret >= T.bigWin) return { moment: 'bigWin', vars: { amount } };
  if (held && ret <= T.bigLoss) return { moment: 'bigLoss', vars: { amount } };
  const days = BALANCE.monthDays[s.month - 1] ?? 5;
  if (report.dayInMonth >= days - 2 && s.bill.month === s.month && after < s.bill.amount && u < 0.6) {
    return { moment: 'bill', vars: { bill: formatMoney(s.bill.amount) } };
  }
  // 押跌的那几格另有说法（被轧、押中跌停），这里只看买涨的
  const up = report.holdings.find((h) => !h.short && report.stocks.find((m) => m.id === h.stockId)?.limitUp);
  if (up) return { moment: 'cheer', vars: { stock: stockById(up.stockId).name } };
  const down = report.holdings.find((h) => !h.short && report.stocks.find((m) => m.id === h.stockId)?.limitDown);
  if (down) return { moment: 'mock', vars: { stock: stockById(down.stockId).name } };
  // 连赚的天数：昨天为止的连击（tempo 收盘时才更新）加上今天
  const streak = held && ret > 0 ? (s.tempo?.streak ?? 0) + 1 : 0;
  if (streak >= 3 && u < 0.5) return { moment: 'streak', vars: { n: String(streak) } };
  const open = s.stats.monthOpen;
  if (open > 0 && after <= open * 0.8 && report.dayInMonth >= 1 && u < 0.4) return { moment: 'slump', vars: {} };
  const mood = report.market?.mood;
  if (mood && mood !== 'flat' && mood !== report.market.moodBefore) return { moment: mood, vars: {} };
  const heldThemes = new Set(report.holdings.map((h) => stockById(h.stockId).theme));
  const missed = report.themes.filter((t) => t.dH >= T.missDH && !heldThemes.has(t.id)).sort((a, b) => b.dH - a.dH)[0];
  if (missed) return { moment: 'miss', vars: { theme: themeById(missed.id).name } };
  return null;
}

/** 按性格挑接话的人：只从在群里、对这种时机有话说的人里挑；偶尔随便谁说一句通用的。 */
function reactComment(s: Readonly<GameState>, rng: Rng, moment: ReactMoment, vars: Record<string, string>): Comment | null {
  const friends = s.friends.map((f) => f.id);
  if (friends.length === 0) return null;
  const pool = REACT_LINES[moment];
  const who = friends.filter((id) => (pool[id]?.length ?? 0) > 0);
  const generic = GENERIC_LINES[moment];
  const anyone = friends[rng.int(friends.length)] as string;
  const uGeneric = rng.next();
  if (generic && (who.length === 0 || uGeneric < GENERIC_SHARE)) return { friendId: anyone, text: fill(pickLine(rng, generic), vars), mood: 'normal' };
  if (who.length === 0) return null;
  const id = who[rng.int(who.length)] as string;
  return { friendId: id, text: fill(pickLine(rng, pool[id]), vars), mood: REACT_MOOD[moment]?.[id] ?? 'normal' };
}

/**
 * 收盘后的吐槽，最多 2 条：先按局面有人接一句（见 situation），再挑一条早上的消息，说中的得意、说错的甩锅。
 * 只是群聊的话，不影响局面。
 */
export function makeComments(s: Readonly<GameState>, report: Readonly<DayReport>): Comment[] {
  const rng = rngFor(s.seed, 'comment', report.day);
  const out: Comment[] = [];
  const sit = situation(s, report);
  const c = sit ? reactComment(s, rng, sit.moment, sit.vars) : null;
  if (c) out.push(c);
  if (report.messages.length > 0) {
    const j = report.messages[rng.int(report.messages.length)];
    if (j) {
      // 得意的话跟着他早上说的方向（说"不动"说对了，不能喊"起飞"）
      const lines = j.hit ? BRAG_LINES[j.friendId]?.[j.claim] : BLAME_LINES[j.friendId];
      out.push({
        friendId: j.friendId,
        text: fill(pickLine(rng, lines), { theme: themeById(j.theme).name }),
        mood: j.hit ? 'smug' : 'awkward',
      });
    }
  }
  return out;
}

// ================================================================ 0.5：情报从真实未来推算

/** 消息说几天（1–3）：按 BALANCE.intel.days 加权。 */
function pickDays(u: number): number {
  const w = BALANCE.intel.days;
  let total = 0;
  for (const x of w) total += x;
  let v = u * total;
  for (let k = 0; k < w.length; k++) {
    v -= w[k] as number;
    if (v < 0) return k + 1;
  }
  return w.length;
}

/** 风口接下来 days 天（含今天）的真实方向（隐藏）。 */
export function themeTruth(real: Readonly<RealMarket>, theme: ThemeId, day: number, days: number): Dir {
  const band = BALANCE.intel.flat[Math.min(days, BALANCE.intel.flat.length) - 1] ?? 1;
  return bandDir(forwardRet(real, 'theme', theme, day, days), band);
}

/** 股票接下来 days 天（含今天）的真实方向（隐藏）。 */
export function stockTruth(real: Readonly<RealMarket>, stockId: string, day: number, days: number): Dir {
  const band = BALANCE.intel.stockFlat[Math.min(days, BALANCE.intel.stockFlat.length) - 1] ?? 2;
  return bandDir(forwardRet(real, 'stock', stockId, day, days), band);
}

/** 说错时说成什么：群主多半直接反着说（真相是横时随机），空军老周一律唱空，其余随机挑另一个方向。 */
function wrongDir(friendId: string, truth: Dir, u: number, uFlip: number): Dir {
  if (friendId === 'kongjun' && truth !== 'down') return 'down';
  if (friendId === 'qunzhu' && truth !== 'flat' && uFlip < BALANCE.intel.qunzhuFlip) return flipDir(truth);
  const others = DIRS.filter((d) => d !== truth);
  return others[u < 0.5 ? 0 : 1] as Dir;
}

/**
 * 0.5 群聊消息：话题、说话的人、台词照 0.3；说的是"这个风口接下来 days 天（1–3）会涨 / 横 / 跌"，
 * 真相是行情段里这个行业接下来 days 天的真实累计涨跌（放大后，横盘带 BALANCE.intel.flat）。
 * 说中的概率 = messageCred（群友靠谱程度、擅长题材、拐点、难度）；说错时群主多半反着说。
 */
function trackMessages(s: Readonly<GameState>, real: Readonly<RealMarket>, rules: Readonly<Rules>): Message[] {
  const day = s.today.day;
  const rng = rngFor(s.seed, 'chat', day);
  const [lo, hi] = BALANCE.messages;
  const n = lo + rng.int(hi - lo + 1) + rules.extraMessages;
  const speakers = pickWeighted(rng, s.friends, (f) => talkWeight(s, f, rules), n);
  const out = speakers.map((f, i) => {
    const theme = pickTopic(s, f, rng);
    const uClaim = rng.next();
    const uWrong = rng.next();
    const uFlip = rng.next();
    const days = Math.min(pickDays(rng.next()), Math.max(1, real.days - day));
    const t = s.themes[theme];
    const truth = themeTruth(real, theme, day, days);
    const reverse = rules.reverseQunzhu && f.id === 'qunzhu';
    const target = reverse ? flipDir(truth) : truth;
    const cred = reverse ? fx('fan_qunzhu', 'acc') : messageCred(s, f.id, theme, rules);
    const claim: Dir = uClaim < cred ? target : wrongDir(f.id, target, uWrong, uFlip);
    const turn = turnTalk(claim, feelOf(t?.history ?? []));
    const lines = turn ? TURN_LINES[f.id]?.[turn] : MESSAGE_LINES[f.id]?.[claim];
    const text = withHand(s, f, i, fill(pickLine(rng, lines), { theme: themeById(theme).name }));
    const m: Message = { friendId: f.id, theme, claim, text, days };
    if (turn) m.turn = turn;
    if (reverse) m.reverse = true;
    return m;
  });
  const extra = rules.headlines + (needsHeadline(s) ? 1 : 0);
  for (let k = 0; k < extra; k++) {
    const m = headline(s, real, k, out);
    if (m) out.push(m);
  }
  return out;
}

/** 本月还没有高光、而且到了月末前一天（短月是最后一天）：主题制造一条重磅情报。 */
export function needsHeadline(s: Readonly<GameState>): boolean {
  const cur = s.tempo?.cur;
  if (!cur || cur.month !== s.month || cur.highlights > 0) return false;
  const days = BALANCE.monthDays[s.month - 1] ?? 5;
  return s.dayInMonth === Math.max(0, days - 2);
}

/**
 * 重磅情报：今天真实涨跌幅度最大的风口（第 k 条取第 k 大），由群里最靠谱的人（擅长这个风口的优先）说，
 * 说中的概率 BALANCE.intel.headline（不受难度消息失真影响）。说的是今天（days = 1）。
 */
function headline(s: Readonly<GameState>, real: Readonly<RealMarket>, k: number, taken: readonly Message[]): Message | null {
  const day = s.today.day;
  const used = new Set(taken.filter((m) => m.big).map((m) => m.theme));
  const ranked = s.themeIds
    .filter((t) => !used.has(t))
    .map((t, i) => ({ t, i, x: forwardRet(real, 'theme', t, day, 1) }))
    .sort((a, b) => Math.abs(b.x) - Math.abs(a.x) || a.i - b.i);
  const pick = ranked[0];
  if (!pick) return null;
  const theme = pick.t;
  const rng = rngFor(s.seed, 'headline', day, k);
  const score = (f: Readonly<FriendState>): number => {
    const [expert, other] = BALANCE.intel.cred[f.id] ?? [0.5, 0.5];
    return (topicsOf(s, f).includes(theme) && friendById(f.id).topics !== 'all' ? expert : other) - (f.id === 'qunzhu' ? 1 : 0);
  };
  const speaker = [...s.friends].sort((a, b) => score(b) - score(a))[0];
  if (!speaker) return null;
  const truth = themeTruth(real, theme, day, 1);
  const claim: Dir = rng.next() < BALANCE.intel.headline ? truth : wrongDir(speaker.id, truth, rng.next(), rng.next());
  const lines = MESSAGE_LINES[speaker.id]?.[claim];
  const text = `【重磅】${fill(pickLine(rng, lines), { theme: themeById(theme).name })}`;
  return { friendId: speaker.id, theme, claim, text, days: 1, big: true };
}

/**
 * 0.5 推荐：推荐人照 0.3 挑（权重、擅长、群主喊单、大V只推最热、空军老周押跌），
 * 推的那只是他"觉得接下来 days 天会涨"的：对每只候选股，以 recCredibility 的概率看对它接下来 days 天的真实方向
 * （横盘带 BALANCE.intel.stockFlat），在看涨的里面按角色权重挑。所以靠谱的人推的票大多真的涨，群主推的大多要跌。
 */
function trackRecs(s: Readonly<GameState>, real: Readonly<RealMarket>, rules: Readonly<Rules>): Rec[] {
  const day = s.today.day;
  const rng = rngFor(s.seed, 'recs', day);
  const taken = new Set<string>();
  for (const h of s.slots) if (h) taken.add(h.stockId);
  const recs: Rec[] = [];
  const only = rules.onlyRoles;
  const count = BALANCE.recs + rules.extraRecs;
  const recommenders = pickWeighted(rng, s.friends, (f) => (BALANCE.chat.rec[f.id] ?? 1) * (rules.friendWeight[f.id] ?? 1), count);
  for (const f of recommenders) {
    const def = friendById(f.id);
    const r = rngFor(s.seed, 'rec', day, f.id);
    const uFocus = r.next();
    const uStock = r.next();
    const days = Math.min(pickDays(r.next()), Math.max(1, real.days - day));
    const topics = topicsOf(s, f);
    const short = f.id === 'kongjun';
    let themes: ThemeId[];
    if (f.id === 'qunzhu' || short) themes = [...s.themeIds];
    else if (def.topics === 'hottest') themes = [hottestTheme(s)];
    else themes = def.founding && uFocus >= BALANCE.chat.focus ? [...s.themeIds] : topics.length > 0 ? topics : [...s.themeIds];
    let pool = themes.flatMap((t) => availableStocks(s, t, taken, only));
    if (pool.length === 0) pool = availableStocks(s, null, taken, only);
    if (pool.length === 0) break;
    const want: Dir = short ? 'down' : 'up';
    const believed = pool.filter((d) => {
      const truth = stockTruth(real, d.id, day, days);
      const right = r.next() < recCredibility(s, f.id, d.theme, rules);
      const u = r.next();
      const uFlip = r.next();
      return (right ? truth : wrongDir(f.id, truth, u, uFlip)) === want;
    });
    const list = believed.length > 0 ? believed : pool;
    const roleCount = new Map<string, number>();
    for (const d of list) roleCount.set(d.role, (roleCount.get(d.role) ?? 0) + 1);
    const shill = (d: StockDef): number => (f.id === 'qunzhu' ? BALANCE.chat.shill[s.themes[d.theme]?.stage ?? 'cold'] * (d.role === 'meme' ? BALANCE.chat.shillMeme : 1) : 1);
    const w = (d: StockDef): number =>
      (((BALANCE.chat.roleWeights[d.role] ?? 1) * (rules.recRoleBoost[d.role] ?? 1)) / (roleCount.get(d.role) ?? 1)) * shill(d) * (def.memes && d.role === 'meme' ? 2 : 1);
    const pick = pickByWeight(list, list.map(w), uStock);
    taken.add(pick.id);
    const rec: Rec = { stockId: pick.id, friendId: f.id, text: fill(recLine(s, f.id), { stock: pick.name }), taken: false, days };
    if (short) rec.short = true;
    recs.push(rec);
  }
  return recs;
}
