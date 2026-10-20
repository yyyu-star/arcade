/**
 * 立直麻将（日麻，天凤式四人）的牌局流程（docs/riichi.md 第 1、2 节）：状态、动作、每一步怎么走。纯函数，单机和好友房共用。
 * 役、符、点数在 score.ts，这里只管谁摸谁打、谁能吃碰杠和、钱（点数）怎么动、一场什么时候结束。
 *
 * 一局：发牌 → 庄家摸第一张 → 摸打、吃碰杠、立直 → 有人和、荒牌流局或中途流局 → 结算点数、换庄、本场、供托。
 * 一场：东南半庄（或东风战），西入、飞了、最后一局庄家第一自动结束；打完按点数、顺位马换筹码（只在一场结束时动一次筹码）。
 *
 * 声明窗口沿用川麻的公平做法（DESIGN.md 第 6 节）：名单是所有别家，真人的回答走 kit 的 free，电脑的回答带 bot、答完离开名单；
 * 有选择的人都答完就裁决：和 > 碰 / 杠 > 吃，两家和是双响，三家和是流局。
 *
 * 所有改动都在 applyMut 里原地做；对外的 apply 先复制一份再改（index.ts）。
 */
import type { Entropy } from 'arcade-kit/rng';
import { stream } from 'arcade-kit/rng';
import type { Payment } from '../../match/index.ts';
import { distance, drawHead, newWall, resolveClaims, wallLeft, type Answer, type ClaimKind, type KanType, type Meld, type RiverTile, type Wall } from '../../table/index.ts';
import { buildWall, byTile, countsOf, HONOR0, kindOf, rankOf, suitOf, type Tile, type TileSet } from '../../tiles/index.ts';
import type { MatchSetup, SeatKind, Tune } from '../types.ts';
import { doraOf, isAgari, isKokushi, liability, payments, RED, scoreWin, waitsOf, type HandScore, type WinContext } from './score.ts';

export const VARIANT = 'riichi' as const;
export const RULES_VERSION = 1;
export const SEATS = 4;
export const TILESET: TileSet = { suits: [0, 1, 2], honors: true, flowers: false, red: RED };

export const START_POINTS = 25_000;
/** 返点：得分按它算，第一名多拿 (返点 − 起始) × 4（头名奖） */
export const RETURN_POINTS = 30_000;
/** 顺位马（千点） */
export const UMA: readonly number[] = [20, 10, -10, -20];
/** 王牌区：宝牌指示 [0, 5)、里宝牌指示 [5, 10)、岭上牌 [10, 14) */
export const DEAD_WALL = 14;
const URA0 = 5;
const RINSHAN0 = 10;
/**
 * 一场的得分（按点数记：+52.3 记 52,300）换筹码：多少分值一份（docs/riichi.md 第 2、7 节，按模拟定）。
 * 半庄 50,000（K = 50，小档一份 2,000 → 每 1,000 分 40 筹码）；东风战打得短、得分摆动小，40,000，两种打法输掉整份的机会差不多（约 5%）
 */
export const SHARE_POINTS: Readonly<Record<RcOpts['length'], number>> = { hanchan: 50_000, tonpuu: 40_000 };

export interface RcOpts {
  /** 东南半庄还是东风战 */
  length: 'hanchan' | 'tonpuu';
}

export const DEFAULT_OPTS: RcOpts = { length: 'hanchan' };

export type Phase = 'turn' | 'claim' | 'end' | 'over';

/** 一局怎么结束的：和了、荒牌流局、流局满贯，或者中途流局的五种 */
export type RcEnd = 'ron' | 'tsumo' | 'draw' | 'nagashi' | 'nine_terminals' | 'four_winds' | 'four_kans' | 'four_riichi' | 'three_ron';

/** 河里的一张：n 是这一局全桌第几张打出的（从 1 起）。现物要看"立直以后别家打的"，鸣牌会打乱轮次，只看各家河里第几张推不准 */
export interface RcRiverTile extends RiverTile {
  n: number;
}

export interface RcPlayer {
  hand: Tile[];
  melds: Meld[];
  river: RcRiverTile[];
  /** 0 没立直，1 立直，2 双立直 */
  riichi: 0 | 1 | 2;
  /** 立直宣告的那张在河里的位置（画面横放）；没立直是 -1 */
  riichiAt: number;
  ippatsu: boolean;
  /** 同巡振听：放过和牌张，到自己下次摸牌（或鸣牌）前不能荣和 */
  passed: boolean;
  /** 立直后放过和牌张：这一局一直振听 */
  locked: boolean;
  /** 刚吃、碰过：这一手不能打的牌种（不许食替） */
  banned: number[];
  /** 这一局摸了几次牌（天和、地和、九种九牌） */
  draws: number;
}

/** 一次和牌（公开） */
export interface RcWin {
  seat: number;
  /** 放铳的人；自摸是 null */
  from: number | null;
  tile: Tile;
  score: HandScore;
  hand: Tile[];
  melds: Meld[];
  /** 这一家拿到的点数（含本场、供托），给结算表 */
  gain: number;
  /** 包牌的责任者 */
  pao: number | null;
}

/** 一局的小结（结算页和一场的历史） */
export interface RoundSummary {
  wind: number;
  hand: number;
  honba: number;
  dealer: number;
  end: RcEnd;
  delta: number[];
  wins: RcWin[];
  /** 荒牌流局时谁听牌 */
  tenpai: boolean[] | null;
  dora: Tile[];
  /** 有立直的人和了才亮里宝指示牌 */
  ura: Tile[];
}

/** 一个座位这一场的统计（都是公开的事，结算页、称号、给钱包的小结用） */
export interface SeatStats {
  rounds: number;
  wins: number;
  tsumo: number;
  /** 放铳 */
  dealIn: number;
  riichi: number;
  maxHan: number;
  yakuman: number;
  /** 最大一局净得点 */
  best: number;
}

/** 声明窗口：opts 是每个座位能做的（隐藏），chi 是能吃的几种吃法（顺子最小那张的牌种），ans、low 是回答 */
export interface Claim {
  id: number;
  tile: Tile;
  from: number;
  /** 抢杠：加杠能被任何和牌抢，暗杠只有国士能抢 */
  rob: 'added' | 'concealed' | null;
  opts: ClaimKind[][];
  chi: number[][];
  /** 这张能凑成和牌形（不管有没有役、振不振听）：没和的人进同巡振听 */
  could: boolean[];
  ans: (Answer | null)[];
  low: (number | null)[];
  bot: boolean[];
}

/** 这一步发生了什么；摸到的牌、暗杠的牌只有本人看得到（view 里过滤） */
export type RcEvent =
  | { e: 'deal'; wind: number; hand: number; honba: number; dealer: number }
  | { e: 'draw'; seat: number; tile: Tile; rinshan: boolean }
  | { e: 'discard'; seat: number; tile: Tile; riichi: boolean }
  | { e: 'riichi'; seat: number; double: boolean }
  | { e: 'chi' | 'pon'; seat: number; from: number; tile: Tile }
  | { e: 'kan'; seat: number; from: number | null; tile: Tile; kan: KanType }
  | { e: 'dora'; indicator: Tile }
  | { e: 'win'; seat: number; from: number | null; tile: Tile; score: HandScore; rob: boolean }
  | { e: 'pay'; pays: Payment[] }
  | { e: 'end'; end: RcEnd }
  | { e: 'over' };

/** 一场打完的名次和得分（按点数记，+52.3 记 52,300；不听罚符有 750 这样的零头，所以不按 100 记） */
export interface Final {
  rank: number[];
  score: number[];
}

export interface RcState {
  variant: typeof VARIANT;
  v: number;
  /** 随机数密钥：只在状态里，view 绝不带 */
  key: Entropy;
  opts: RcOpts;
  share: number;
  base: number;
  kinds: SeatKind[];
  personas: number[];
  tunes?: Tune[];
  /** 筹码只在一场结束时动：chips 是带进来的，结束时换成结回去的 */
  chips: number[];
  stake: number[];
  points: number[];
  /** 这一局开始时的点数（算一局的得失；没打完就收场时这一局不算，回到它） */
  start: number[];
  /** 这一局开始时桌上的供托（同上；部署前的存档没有，按 0） */
  sticks0?: number;
  /** 起家 */
  first: number;
  /** 场风 0 东 1 南 2 西 */
  wind: number;
  /** 第几局（0–3） */
  hand: number;
  honba: number;
  /** 桌上的立直棒（供托）根数 */
  sticks: number;
  /** 这一场的第几局（洗牌的序号，连庄也加一） */
  kyoku: number;
  dealer: number;
  phase: Phase;
  wall: Wall;
  dead: Tile[];
  /** 翻开了几张宝牌指示牌 */
  doraOpen: number;
  /** 明杠、加杠的杠宝：打出下一张（或再开杠）时才翻 */
  pendingDora: number;
  kans: number;
  /** 每一杠是谁开的（四杠散了看是不是同一个人） */
  kanBy: number[];
  players: RcPlayer[];
  turn: number;
  drawn: Tile | null;
  /** 这一手是摸牌开始的（能自摸、能杠）；吃碰以后只能打 */
  canTsumo: boolean;
  /** 这一手是岭上牌 */
  rinshan: boolean;
  claim: Claim | null;
  claimSeq: number;
  /** 这一局还没人吃碰杠（含暗杠）：双立直、天和地和、九种九牌、四风连打 */
  noCalls: boolean;
  discards: number;
  /** 刚宣告立直、还没过窗口的座位（被荣和了立直不成立，不放棒） */
  pendingRiichi: number | null;
  ledger: Payment[];
  events: RcEvent[];
  history: RoundSummary[];
  stats: SeatStats[];
  final: Final | null;
  /**
   * 好友房中途接管座位时，这个座位那一刻的得分（standings）：新来的人只为接手以后的输赢负责。
   * 没人接管过就没有这个字段（按 0）
   */
  entry?: number[];
}

export type RcAction =
  | { t: 'discard'; tile: Tile; riichi?: true }
  | { t: 'tsumo' }
  | { t: 'kan'; tile: Tile }
  | { t: 'kyuushu' }
  | { t: 'claim'; w: number; c: Answer; low?: number; bot?: boolean }
  | { t: 'expire'; w: number };

/** 立直棒、供托的收付用这个座位号代表"桌上" */
export const TABLE = -1;

// ---------- 小工具 ----------

/** 中途流局：最后一局遇到也不算"庄家第一就停" */
const ABORTS: ReadonlySet<RcEnd> = new Set(['nine_terminals', 'four_winds', 'four_kans', 'four_riichi', 'three_ron']);
const isYaochu = (k: number): boolean => k >= HONOR0 || rankOf(k) === 1 || rankOf(k) === 9;
const countKind = (tiles: readonly Tile[], k: number): number => tiles.reduce((a, t) => a + (kindOf(t) === k ? 1 : 0), 0);
const isClosed = (p: RcPlayer): boolean => p.melds.every((m) => m.kan === 'concealed');
export const seatWind = (s: RcState, seat: number): number => distance(s.dealer, seat, SEATS);

export const doraIndicators = (s: RcState): Tile[] => s.dead.slice(0, s.doraOpen);
export const uraIndicators = (s: RcState): Tile[] => s.dead.slice(URA0, URA0 + s.doraOpen);

/** 听哪些牌（13 张时）。自己手里加副露已经四张的那种不算：摸不到也没人打得出来（天凤的"纯空听"不算听牌） */
export function tenpaiKinds(p: RcPlayer): number[] {
  const own = countsOf([...p.hand, ...p.melds.flatMap((m) => m.tiles)]);
  return waitsOf(countsOf(p.hand), p.melds.length).filter((k) => own[k]! < 4);
}

/** 舍张振听、同巡振听、立直后振听 */
export function furiten(p: RcPlayer): 'river' | 'passed' | 'riichi' | null {
  if (p.locked) return 'riichi';
  const waits = waitsOf(countsOf(p.hand), p.melds.length);
  if (p.river.some((r) => waits.includes(kindOf(r.tile)))) return 'river';
  return p.passed ? 'passed' : null;
}

function emptyStats(): SeatStats {
  return { rounds: 0, wins: 0, tsumo: 0, dealIn: 0, riichi: 0, maxHan: 0, yakuman: 0, best: 0 };
}

function emptyPlayer(): RcPlayer {
  return { hand: [], melds: [], river: [], riichi: 0, riichiAt: -1, ippatsu: false, passed: false, locked: false, banned: [], draws: 0 };
}

/** 点数可以付成负数（飞了），所以不用 match 的 payMany（它按付得起的付） */
function move(s: RcState, pays: Payment[], from: number, to: number, amount: number, kind: string): void {
  if (amount <= 0) return;
  if (from !== TABLE) s.points[from]! -= amount;
  if (to !== TABLE) s.points[to]! += amount;
  pays.push({ kind, from, to, amount });
}

function flush(s: RcState, pays: Payment[]): void {
  if (!pays.length) return;
  s.ledger.push(...pays);
  s.events.push({ e: 'pay', pays });
}

function revealDora(s: RcState): void {
  s.doraOpen++;
  s.events.push({ e: 'dora', indicator: s.dead[s.doraOpen - 1]! });
}

function flushDora(s: RcState): void {
  while (s.pendingDora > 0) {
    s.pendingDora--;
    revealDora(s);
  }
}

function clearIppatsu(s: RcState): void {
  for (const p of s.players) p.ippatsu = false;
}

// ---------- 一场、一局 ----------

export function begin(key: Entropy, opts: RcOpts, kinds: readonly SeatKind[], setup: MatchSetup): RcState {
  const first = stream(key, 'seat', 0).below(SEATS);
  const s: RcState = {
    variant: VARIANT,
    v: RULES_VERSION,
    key: [...key],
    opts: { ...opts },
    share: setup.share,
    base: setup.base,
    kinds: [...kinds],
    personas: [...setup.personas],
    ...(setup.tunes ? { tunes: setup.tunes.map((t) => ({ ...t })) } : {}),
    chips: setup.chips ? [...setup.chips] : Array.from({ length: SEATS }, () => setup.share),
    stake: setup.chips ? [...setup.chips] : Array.from({ length: SEATS }, () => setup.share),
    points: Array.from({ length: SEATS }, () => START_POINTS),
    start: [],
    first,
    wind: 0,
    hand: 0,
    honba: 0,
    sticks: 0,
    kyoku: 0,
    dealer: first,
    phase: 'turn',
    wall: newWall([], 0),
    dead: [],
    doraOpen: 0,
    pendingDora: 0,
    kans: 0,
    kanBy: [],
    players: [],
    turn: first,
    drawn: null,
    canTsumo: false,
    rinshan: false,
    claim: null,
    claimSeq: 0,
    noCalls: true,
    discards: 0,
    pendingRiichi: null,
    ledger: [],
    events: [],
    history: [],
    stats: Array.from({ length: SEATS }, emptyStats),
    final: null,
  };
  startRound(s);
  return s;
}

function startRound(s: RcState): void {
  const tiles = buildWall(TILESET, stream(s.key, 'deal', s.kyoku));
  s.dead = tiles.slice(0, DEAD_WALL);
  const live = tiles.slice(DEAD_WALL);
  s.players = Array.from({ length: SEATS }, emptyPlayer);
  for (let i = 0; i < SEATS; i++) {
    const p = s.players[(s.dealer + i) % SEATS]!;
    p.hand = live.slice(i * 13, i * 13 + 13).sort(byTile);
  }
  s.wall = newWall(live, SEATS * 13);
  s.start = s.points.slice();
  s.sticks0 = s.sticks;
  s.doraOpen = 0;
  s.pendingDora = 0;
  s.kans = 0;
  s.kanBy = [];
  s.claim = null;
  s.noCalls = true;
  s.discards = 0;
  s.pendingRiichi = null;
  s.ledger = [];
  for (const st of s.stats) st.rounds++;
  s.events.push({ e: 'deal', wind: s.wind, hand: s.hand, honba: s.honba, dealer: s.dealer });
  revealDora(s);
  drawFor(s, s.dealer, false);
}

/** 摸牌：岭上牌从王牌区摸，海底跟着往前缩一张（王牌区一直是 14 张）；牌墙摸完了荒牌流局 */
function drawFor(s: RcState, seat: number, rinshan: boolean): void {
  let t: Tile | null;
  if (rinshan) {
    t = s.dead[RINSHAN0 + s.kans - 1]!;
    s.wall.tail--;
  } else {
    t = drawHead(s.wall);
    if (t === null) return exhaust(s);
  }
  const p = s.players[seat]!;
  p.hand.push(t);
  p.hand.sort(byTile);
  p.draws++;
  p.passed = false;
  s.turn = seat;
  s.drawn = t;
  s.canTsumo = true;
  s.rinshan = rinshan;
  s.phase = 'turn';
  s.events.push({ e: 'draw', seat, tile: t, rinshan });
}

function advance(s: RcState, from: number): void {
  if (wallLeft(s.wall) <= 0) return exhaust(s);
  drawFor(s, (from + 1) % SEATS, false);
}

/** 和牌的时机（给 score.ts） */
function winContext(s: RcState, seat: number, tile: Tile, tsumo: boolean, rob: boolean): WinContext {
  const p = s.players[seat]!;
  const first = p.draws === 1 && p.river.length === 0 && s.noCalls;
  const last = wallLeft(s.wall) === 0;
  return {
    win: tile,
    tsumo,
    seatWind: seatWind(s, seat),
    roundWind: s.wind,
    riichi: p.riichi,
    ippatsu: p.ippatsu,
    rinshan: tsumo && s.rinshan,
    chankan: rob,
    haitei: tsumo && !s.rinshan && last,
    houtei: !tsumo && !rob && last,
    tenhou: tsumo && first && seat === s.dealer,
    chiihou: tsumo && first && seat !== s.dealer,
    dora: doraIndicators(s).map((t) => doraOf(kindOf(t))),
    ura: p.riichi ? uraIndicators(s).map((t) => doraOf(kindOf(t))) : [],
  };
}

/** 这张牌能不能荣和：成形、有役、不振听；暗杠只有国士能抢 */
function canRon(s: RcState, seat: number, tile: Tile, rob: Claim['rob']): boolean {
  const p = s.players[seat]!;
  const hand = [...p.hand, tile];
  const c = countsOf(hand);
  if (!isAgari(c, p.melds.length)) return false;
  if (rob === 'concealed' && !isKokushi(c)) return false;
  if (furiten(p)) return false;
  return scoreWin(hand, p.melds, winContext(s, seat, tile, false, rob !== null)) !== null;
}

/** 吃、碰以后不能打的牌种（食替）：吃的那张本身，以及吃两头时另一头 */
function kuikae(called: number, low: number | null): number[] {
  if (low === null) return [called];
  const out = [called];
  if (called === low && rankOf(low) <= 6) out.push(low + 3);
  if (called === low + 2 && rankOf(low) >= 2) out.push(low - 1);
  return out;
}

/** 吃碰以后手里得留着能打的牌（全是不能打的就不许鸣） */
function callable(hand: readonly Tile[], used: readonly number[], banned: readonly number[]): boolean {
  const rest = hand.map(kindOf);
  for (const k of used) rest.splice(rest.indexOf(k), 1);
  return rest.some((k) => !banned.includes(k));
}

/** 能吃的几种：返回顺子最小那张的牌种 */
export function chiOptions(hand: readonly Tile[], tile: Tile): number[] {
  const k = kindOf(tile);
  if (k >= HONOR0) return [];
  const have = countsOf(hand);
  const out: number[] = [];
  for (const low of [k - 2, k - 1, k]) {
    if (low < 0 || suitOf(low) !== suitOf(k) || rankOf(low) > 7) continue;
    const need = [low, low + 1, low + 2].filter((x) => x !== k);
    if (need.some((x) => have[x]! < 1)) continue;
    if (callable(hand, need, kuikae(k, low))) out.push(low);
  }
  return out;
}

/** 别人打出（或开杠）一张以后谁能做什么；没人有选择就不开窗口（同巡振听照记），返回开没开 */
function openClaim(s: RcState, tile: Tile, from: number, rob: Claim['rob']): boolean {
  const k = kindOf(tile);
  const opts: ClaimKind[][] = s.players.map(() => []);
  const chi: number[][] = s.players.map(() => []);
  const could = s.players.map(() => false);
  const calls = rob === null && wallLeft(s.wall) > 0;
  let any = false;
  for (let i = 0; i < SEATS; i++) {
    if (i === from) continue;
    const p = s.players[i]!;
    const c = countsOf([...p.hand, tile]);
    could[i] = rob === 'concealed' ? isKokushi(c) : isAgari(c, p.melds.length);
    const o = opts[i]!;
    if (could[i] && canRon(s, i, tile, rob)) o.push('ron');
    if (calls && !p.riichi) {
      const n = countKind(p.hand, k);
      if (n >= 3 && s.kans < 4) o.push('kan');
      if (n >= 2 && callable(p.hand, [k, k], kuikae(k, null))) o.push('pon');
      if (i === (from + 1) % SEATS) {
        chi[i] = chiOptions(p.hand, tile);
        if (chi[i]!.length) o.push('chi');
      }
    }
    if (o.length) any = true;
  }
  const claim: Claim = { id: ++s.claimSeq, tile, from, rob, opts, chi, could, ans: s.players.map(() => null), low: s.players.map(() => null), bot: s.players.map(() => false) };
  if (!any) {
    markPassed(s, claim);
    return false;
  }
  s.claim = claim;
  s.phase = 'claim';
  return true;
}

/** 能和没和的人进同巡振听；立直的人这一局一直振听 */
function markPassed(s: RcState, c: Claim): void {
  c.could.forEach((x, i) => {
    if (!x || c.ans[i] === 'ron') return;
    const p = s.players[i]!;
    p.passed = true;
    if (p.riichi) p.locked = true;
  });
}

/**
 * 打出的牌没被荣和：立直成立（放棒、一发开始），再看中途流局（四家立直、四风连打、四杠散了）。返回这一局是不是因此结束了
 */
function passDiscard(s: RcState): boolean {
  const r = s.pendingRiichi;
  if (r !== null) {
    s.pendingRiichi = null;
    const p = s.players[r]!;
    const double = p.river.length === 1 && s.noCalls;
    p.riichi = double ? 2 : 1;
    p.ippatsu = true;
    s.stats[r]!.riichi++;
    const pays: Payment[] = [];
    move(s, pays, r, TABLE, 1000, 'stick');
    s.sticks++;
    s.events.push({ e: 'riichi', seat: r, double });
    flush(s, pays);
    if (s.players.every((x) => x.riichi)) {
      abort(s, 'four_riichi');
      return true;
    }
  }
  if (s.noCalls && s.discards === SEATS) {
    const k = kindOf(s.players[s.dealer]!.river[0]!.tile);
    if (k >= HONOR0 && k < HONOR0 + 4 && s.players.every((p) => p.river.length === 1 && kindOf(p.river[0]!.tile) === k)) {
      abort(s, 'four_winds');
      return true;
    }
  }
  if (s.kans === 4 && new Set(s.kanBy).size > 1) {
    abort(s, 'four_kans');
    return true;
  }
  return false;
}

/** 有选择的人都答完了（或者到点了） */
function resolve(s: RcState): void {
  const c = s.claim!;
  s.claim = null;
  const ans = c.ans.map((a, i) => (c.opts[i]!.length ? (a ?? 'pass') : null));
  markPassed(s, c);
  const thrower = s.players[c.from]!;
  const r = resolveClaims(ans, c.from, true);
  if (r && 'ron' in r) {
    if (r.ron.length === 3) return abort(s, 'three_ron');
    // 立直宣告牌被荣和：立直不成立，不放棒
    s.pendingRiichi = null;
    if (c.rob === 'added') thrower.hand.splice(thrower.hand.indexOf(c.tile), 1);
    else if (c.rob === null) thrower.river[thrower.river.length - 1]!.taken = true;
    const wins = r.ron.map((seat, i) => recordWin(s, seat, c.tile, c.from, c.rob !== null, i === 0));
    return endRound(s, 'ron', r.ron.includes(s.dealer), wins);
  }
  if (c.rob === 'added') return finishAddedKan(s, c.from, c.tile);
  if (c.rob === 'concealed') return drawFor(s, c.from, true);
  if (passDiscard(s)) return;
  if (!r) return advance(s, c.from);
  const p = s.players[r.seat]!;
  const k = kindOf(c.tile);
  thrower.river[thrower.river.length - 1]!.taken = true;
  clearIppatsu(s);
  s.noCalls = false;
  s.turn = r.seat;
  p.passed = false;
  if (r.kind === 'kan') {
    const mine = p.hand.filter((t) => kindOf(t) === k);
    p.hand = p.hand.filter((t) => kindOf(t) !== k);
    p.melds.push({ kind: 'kan', tiles: [...mine, c.tile].sort(byTile), from: c.from, kan: 'direct' });
    s.events.push({ e: 'kan', seat: r.seat, from: c.from, tile: c.tile, kan: 'direct' });
    addKan(s, r.seat, false);
    return drawFor(s, r.seat, true);
  }
  let used: number[];
  let low: number | null = null;
  if (r.kind === 'chi') {
    low = c.low[r.seat] ?? c.chi[r.seat]![0]!;
    used = [low, low + 1, low + 2].filter((x) => x !== k);
  } else used = [k, k];
  const mine: Tile[] = [];
  for (const x of used) {
    const t = p.hand.find((y) => kindOf(y) === x && !mine.includes(y))!;
    mine.push(t);
  }
  p.hand = p.hand.filter((t) => !mine.includes(t));
  p.melds.push({ kind: r.kind, tiles: r.kind === 'chi' ? [c.tile, ...mine.sort(byTile)] : [...mine, c.tile].sort(byTile), from: c.from });
  p.banned = kuikae(k, low);
  s.drawn = null;
  s.canTsumo = false;
  s.rinshan = false;
  s.phase = 'turn';
  s.events.push({ e: r.kind, seat: r.seat, from: c.from, tile: c.tile });
}

/** 记一杠：先翻掉上一杠还没翻的杠宝；暗杠当场翻，明杠、加杠等打出下一张再翻 */
function addKan(s: RcState, seat: number, concealed: boolean): void {
  flushDora(s);
  s.kans++;
  s.kanBy.push(seat);
  s.noCalls = false;
  clearIppatsu(s);
  if (concealed) revealDora(s);
  else s.pendingDora++;
}

function finishAddedKan(s: RcState, seat: number, tile: Tile): void {
  const p = s.players[seat]!;
  const k = kindOf(tile);
  p.hand.splice(p.hand.indexOf(tile), 1);
  const m = p.melds.find((x) => x.kind === 'pon' && kindOf(x.tiles[0]!) === k)!;
  m.kind = 'kan';
  m.kan = 'added';
  m.tiles = [...m.tiles, tile].sort(byTile);
  s.events.push({ e: 'kan', seat, from: m.from, tile, kan: 'added' });
  addKan(s, seat, false);
  drawFor(s, seat, true);
}

/**
 * 和牌收点：荣和由放铳者付，自摸各家付（score.ts 的 payments）。本场（荣和 300、自摸每家 100）和供托只给 bonus 的那一家
 * （双响时离放铳者最近的，天凤的"上家取り"）。
 * 包牌（大三元、大四喜）：那一倍役满自摸时责任者全付，荣和时责任者和放铳者各付一半；同时有别的役满，那部分照常付
 */
function recordWin(s: RcState, seat: number, tile: Tile, from: number | null, rob: boolean, bonus: boolean): RcWin {
  const p = s.players[seat]!;
  const hand = from === null ? p.hand.slice() : [...p.hand, tile].sort(byTile);
  const score = scoreWin(hand, p.melds, winContext(s, seat, tile, from === null, rob))!;
  const dealer = seat === s.dealer;
  const before = s.points[seat]!;
  const pays: Payment[] = [];
  const liable = score.yakuman ? liability(p.melds) : null;
  const pao = liable && liable.seat !== seat && score.yaku.some((y) => y.id === liable.yaku) ? liable.seat : null;
  const paoBase = pao === null ? 0 : 8000;
  const restBase = score.base - paoBase;
  if (from !== null) {
    if (pao !== null && pao !== from) {
      const half = (payments(paoBase, dealer, false) as { ron: number }).ron / 2;
      move(s, pays, pao, seat, half, 'pao');
      move(s, pays, from, seat, half, 'ron');
    } else if (paoBase) move(s, pays, from, seat, (payments(paoBase, dealer, false) as { ron: number }).ron, 'ron');
    if (restBase > 0) move(s, pays, from, seat, (payments(restBase, dealer, false) as { ron: number }).ron, 'ron');
    if (bonus) move(s, pays, from, seat, 300 * s.honba, 'honba');
  } else {
    if (pao !== null) {
      move(s, pays, pao, seat, (payments(paoBase, dealer, false) as { ron: number }).ron, 'pao');
      if (bonus) move(s, pays, pao, seat, 300 * s.honba, 'honba');
    }
    if (restBase > 0) {
      const t = payments(restBase, dealer, true) as { dealer: number; other: number };
      for (let i = 0; i < SEATS; i++) if (i !== seat) move(s, pays, i, seat, i === s.dealer ? t.dealer : t.other, 'tsumo');
    }
    if (bonus && pao === null) for (let i = 0; i < SEATS; i++) if (i !== seat) move(s, pays, i, seat, 100 * s.honba, 'honba');
  }
  if (bonus && s.sticks) {
    move(s, pays, TABLE, seat, 1000 * s.sticks, 'stick');
    s.sticks = 0;
  }
  const st = s.stats[seat]!;
  st.wins++;
  if (from === null) st.tsumo++;
  else s.stats[from]!.dealIn++;
  st.maxHan = Math.max(st.maxHan, score.yakuman ? 13 : score.han);
  if (score.yakuman) st.yakuman++;
  p.hand = hand;
  s.events.push({ e: 'win', seat, from, tile, score, rob });
  flush(s, pays);
  return { seat, from, tile, score, hand: hand.slice(), melds: structuredClone(p.melds), gain: s.points[seat]! - before, pao };
}

/** 荒牌流局：流局满贯优先（按满贯自摸收，不加本场），没有就付不听罚符 3,000；庄家听牌连庄，本场 +1 */
function exhaust(s: RcState): void {
  const tenpai = s.players.map((p) => tenpaiKinds(p).length > 0);
  const nagashi = s.players.map((p) => p.river.length > 0 && p.river.every((r) => isYaochu(kindOf(r.tile)) && !r.taken));
  const pays: Payment[] = [];
  if (nagashi.some(Boolean)) {
    nagashi.forEach((x, seat) => {
      if (!x) return;
      const t = payments(2000, seat === s.dealer, true) as { dealer: number; other: number };
      for (let i = 0; i < SEATS; i++) if (i !== seat) move(s, pays, i, seat, i === s.dealer ? t.dealer : t.other, 'nagashi');
    });
  } else {
    const n = tenpai.filter(Boolean).length;
    if (n > 0 && n < SEATS) {
      const each = 3000 / ((SEATS - n) * n);
      tenpai.forEach((x, i) => {
        if (x) return;
        tenpai.forEach((y, j) => y && move(s, pays, i, j, each, 'noten'));
      });
    }
  }
  flush(s, pays);
  endRound(s, nagashi.some(Boolean) ? 'nagashi' : 'draw', tenpai[s.dealer]!, [], tenpai);
}

/** 中途流局：庄家不变，本场 +1，供托留在桌上 */
function abort(s: RcState, end: RcEnd): void {
  endRound(s, end, true, []);
}

/** 现在的名次：点数高的在前，同分按起家顺序 */
export function ranking(points: readonly number[], first: number): number[] {
  return [0, 1, 2, 3].sort((a, b) => points[b]! - points[a]! || distance(first, a, SEATS) - distance(first, b, SEATS));
}

/** 这一局是不是最后一局（南四局、东风战东四局）或之后的延长局 */
export function allLast(s: RcState): boolean {
  const last = s.opts.length === 'hanchan' ? 1 : 0;
  return s.wind > last || (s.wind === last && s.hand === 3);
}

/**
 * 一局结束：记小结；换庄、本场；看一场结束没有（飞了；最后一局庄家第一且 30,000 以上就停；
 * 最后一局之后有人到 30,000 就结束，没人到就西入（东风战南入），延长场打完也结束）
 */
function endRound(s: RcState, end: RcEnd, renchan: boolean, wins: RcWin[], tenpai: boolean[] | null = null): void {
  s.claim = null;
  s.drawn = null;
  s.pendingRiichi = null;
  const delta = s.points.map((x, i) => x - s.start[i]!);
  delta.forEach((d, i) => {
    const st = s.stats[i]!;
    st.best = Math.max(st.best, d);
  });
  const ura = wins.some((w) => s.players[w.seat]!.riichi) ? uraIndicators(s) : [];
  s.history.push({ wind: s.wind, hand: s.hand, honba: s.honba, dealer: s.dealer, end, delta, wins, tenpai, dora: doraIndicators(s), ura });
  s.events.push({ e: 'end', end });
  const wasLast = allLast(s);
  const top = ranking(s.points, s.first)[0]!;
  let over = s.points.some((x) => x < 0);
  if (renchan) {
    s.honba++;
    if (wasLast && !ABORTS.has(end) && top === s.dealer && s.points[s.dealer]! >= RETURN_POINTS) over = true;
  } else {
    s.honba = end === 'ron' || end === 'tsumo' ? 0 : s.honba + 1;
    s.hand++;
    if (s.hand === SEATS) {
      s.hand = 0;
      s.wind++;
    }
    s.dealer = (s.first + s.hand) % SEATS;
    if (wasLast && Math.max(...s.points) >= RETURN_POINTS) over = true;
    if (s.wind > (s.opts.length === 'hanchan' ? 2 : 1)) over = true;
  }
  s.kyoku++;
  if (over) return finishMatch(s);
  s.phase = 'end';
}

const midHand = (s: RcState): boolean => s.phase === 'turn' || s.phase === 'claim';

/**
 * 现在的名次和得分（不改状态）。得分按点数记（+52.3 记 52,300），四家合计 0，桌上的供托算给第一名。
 * - 打完了：点数 − 返点 + 马，第一名加头名奖；
 * - 没打完就收场（early：好友房有人离座、提前收场，单机中途离开）：只按点数差（点数 − 起始点数），不算马和头名奖，
 *   一局打到一半的这一局不算（按这一局开始时的点数和供托）。马和头名奖是打完一整场才有的东西，
 *   开局点数都一样时按起家排第一就能白拿头名奖，一开局就走能刷筹码
 */
export function standings(s: RcState, early = false): Final {
  const half = early && midHand(s);
  const points = half ? s.start : s.points;
  const sticks = half ? (s.sticks0 ?? 0) : s.sticks;
  const rank = ranking(points, s.first);
  const oka = (RETURN_POINTS - START_POINTS) * SEATS;
  const score = points.map((x, i) => {
    const r = rank.indexOf(i);
    const bonus = r === 0 ? 1000 * sticks : 0;
    return early ? x + bonus - START_POINTS : x + bonus - RETURN_POINTS + UMA[r]! * 1000 + (r === 0 ? oka : 0);
  });
  return { rank, score };
}

/**
 * 一场结束（early 见 standings）：桌上的供托给第一名，按 standings 的得分换筹码（SHARE_POINTS 分换一份）。
 * 每个座位按"现在坐着的人接手以后"的得分算（entry，好友房中途接管时记）：前一个人离座时已经按那一刻的得分结走了。
 * 输的最多输掉带来的；赢家按应得的比例分输家付得出的，再加上离座的人和庄家之间已经结过的那部分（庄家补上或收回），
 * 所以没人中途换手时四家的筹码总数守恒
 */
export function finishMatch(s: RcState, early = false): void {
  const f = standings(s, early);
  if (early && midHand(s)) {
    s.points = s.start.slice();
    s.sticks = s.sticks0 ?? 0;
  }
  if (s.sticks) {
    s.points[f.rank[0]!]! += 1000 * s.sticks;
    s.sticks = 0;
  }
  s.final = f;
  s.claim = null;
  const per = SHARE_POINTS[s.opts.length];
  const chipsOf = (x: number): number => (x < 0 ? -1 : 1) * Math.floor((Math.abs(x) * s.share) / per);
  const entry = s.entry ?? [0, 0, 0, 0];
  const delta = f.score.map((x, i) => x - entry[i]!);
  const owe = delta.map((x, i) => (x < 0 ? Math.min(chipsOf(-x), Math.max(0, s.chips[i]!)) : 0));
  const want = delta.map((x) => (x > 0 ? chipsOf(x) : 0));
  const pool = Math.max(0, owe.reduce((a, b) => a + b, 0) + chipsOf(-entry.reduce((a, b) => a + b, 0)));
  const total = want.reduce((a, b) => a + b, 0);
  const got = want.map((w) => (total ? Math.floor((w * pool) / total) : 0));
  // 整除剩下的零头按名次给（第一名先拿）
  let left = pool - got.reduce((a, b) => a + b, 0);
  for (const i of f.rank) {
    if (left <= 0 || !total) break;
    if (want[i]! > 0) {
      got[i]!++;
      left--;
    }
  }
  s.chips = s.chips.map((c, i) => c - owe[i]! + got[i]!);
  s.phase = 'over';
  s.events.push({ e: 'over' });
}

// ---------- 动作 ----------

/** 立直时能打哪几张（打了以后还听牌）；条件不够返回空 */
export function riichiOptions(s: RcState, seat: number): Tile[] {
  const p = s.players[seat]!;
  if (s.phase !== 'turn' || s.turn !== seat || !s.canTsumo || p.riichi || !isClosed(p)) return [];
  if (s.points[seat]! < 1000 || wallLeft(s.wall) < 4) return [];
  const ok = new Set<number>();
  const c = countsOf(p.hand);
  for (const k of new Set(p.hand.map(kindOf))) {
    c[k]!--;
    if (waitsOf(c, p.melds.length).length) ok.add(k);
    c[k]!++;
  }
  return p.hand.filter((t) => ok.has(kindOf(t)));
}

/** 能打哪些牌：立直后只能打摸到的；刚吃碰不能食替 */
export function discardOptions(s: RcState, seat: number): Tile[] {
  const p = s.players[seat]!;
  if (p.riichi) return s.drawn !== null ? [s.drawn] : [];
  return p.hand.filter((t) => !p.banned.includes(kindOf(t)));
}

/** 自己这一手能杠的牌：暗杠、加杠；立直后只能暗杠摸到的那种，而且不改听的牌 */
export function kanOptions(s: RcState, seat: number): Tile[] {
  const p = s.players[seat]!;
  if (s.phase !== 'turn' || s.turn !== seat || !s.canTsumo || s.kans >= 4 || wallLeft(s.wall) <= 0) return [];
  const c = countsOf(p.hand);
  const out: Tile[] = [];
  for (let k = 0; k < 34; k++) {
    if (c[k] === 4) {
      if (p.riichi) {
        if (s.drawn === null || kindOf(s.drawn) !== k) continue;
        const before = waitsOf(countsOf(p.hand.filter((t) => t !== s.drawn)), p.melds.length);
        const rest = c.slice();
        rest[k] = 0;
        const after = waitsOf(rest, p.melds.length + 1);
        if (before.length !== after.length || before.some((x, i) => x !== after[i])) continue;
      }
      out.push(p.hand.find((t) => kindOf(t) === k)!);
    } else if (!p.riichi && c[k]! >= 1 && p.melds.some((m) => m.kind === 'pon' && kindOf(m.tiles[0]!) === k)) {
      out.push(p.hand.find((t) => kindOf(t) === k)!);
    }
  }
  return out;
}

export function canTsumo(s: RcState, seat: number): boolean {
  const p = s.players[seat]!;
  if (s.phase !== 'turn' || s.turn !== seat || !s.canTsumo || s.drawn === null) return false;
  if (!isAgari(countsOf(p.hand), p.melds.length)) return false;
  return scoreWin(p.hand, p.melds, winContext(s, seat, s.drawn, true, false)) !== null;
}

/** 九种九牌：自己第一次摸牌、这一局还没人鸣牌，手里幺九牌 9 种以上 */
export function canKyuushu(s: RcState, seat: number): boolean {
  const p = s.players[seat]!;
  if (s.phase !== 'turn' || s.turn !== seat || p.draws !== 1 || p.river.length || !s.noCalls) return false;
  return new Set(p.hand.map(kindOf).filter(isYaochu)).size >= 9;
}

/**
 * 做一步（原地改）。返回 null 是成功，字符串是错误码（固定的短码，不带牌面）。
 * 调用前 events 由调用方清空：这一步发生的事都记在里面。
 */
export function applyMut(s: RcState, seat: number, a: RcAction): string | null {
  if (seat < 0 || seat >= SEATS || !Number.isInteger(seat)) return 'bad_seat';
  const p = s.players[seat]!;
  switch (a.t) {
    case 'discard': {
      if (s.phase !== 'turn' || s.turn !== seat) return 'not_your_turn';
      if (!p.hand.includes(a.tile)) return 'bad_tile';
      if (a.riichi) {
        if (!riichiOptions(s, seat).includes(a.tile)) return 'cannot_riichi';
      } else if (!discardOptions(s, seat).includes(a.tile)) return p.riichi ? 'riichi_locked' : 'kuikae';
      p.hand.splice(p.hand.indexOf(a.tile), 1);
      p.river.push({ tile: a.tile, n: s.discards + 1 });
      if (a.riichi) {
        p.riichiAt = p.river.length - 1;
        s.pendingRiichi = seat;
      } else p.ippatsu = false;
      p.banned = [];
      s.drawn = null;
      s.canTsumo = false;
      s.rinshan = false;
      s.discards++;
      s.events.push({ e: 'discard', seat, tile: a.tile, riichi: !!a.riichi });
      flushDora(s);
      if (!openClaim(s, a.tile, seat, null) && !passDiscard(s)) advance(s, seat);
      return null;
    }
    case 'tsumo': {
      if (!canTsumo(s, seat)) return 'cannot_win';
      const win = recordWin(s, seat, s.drawn!, null, false, true);
      endRound(s, 'tsumo', seat === s.dealer, [win]);
      return null;
    }
    case 'kan': {
      if (!kanOptions(s, seat).includes(a.tile)) return 'cannot_kan';
      const k = kindOf(a.tile);
      s.drawn = null;
      if (countKind(p.hand, k) === 4) {
        const tiles = p.hand.filter((t) => kindOf(t) === k);
        p.hand = p.hand.filter((t) => kindOf(t) !== k);
        p.melds.push({ kind: 'kan', tiles, from: null, kan: 'concealed' });
        s.events.push({ e: 'kan', seat, from: null, tile: a.tile, kan: 'concealed' });
        addKan(s, seat, true);
        if (!openClaim(s, a.tile, seat, 'concealed')) drawFor(s, seat, true);
        return null;
      }
      if (!openClaim(s, a.tile, seat, 'added')) finishAddedKan(s, seat, a.tile);
      return null;
    }
    case 'kyuushu': {
      if (!canKyuushu(s, seat)) return 'cannot_abort';
      abort(s, 'nine_terminals');
      return null;
    }
    case 'claim': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c || c.id !== a.w) return 'stale_claim';
      if (seat === c.from) return 'not_your_turn';
      if (c.ans[seat] !== null || c.bot[seat]) return 'already';
      const opts = c.opts[seat]!;
      if (!opts.length && !(a.bot && a.c === 'pass')) return 'no_claim';
      if (a.c !== 'pass' && !opts.includes(a.c)) return 'cannot_claim';
      if (a.c === 'chi' && a.low !== undefined && !c.chi[seat]!.includes(a.low)) return 'cannot_claim';
      c.ans[seat] = a.c;
      if (a.c === 'chi') c.low[seat] = a.low ?? c.chi[seat]![0]!;
      if (a.bot) c.bot[seat] = true;
      if (c.opts.every((o, i) => !o.length || c.ans[i] !== null)) resolve(s);
      return null;
    }
    case 'expire': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c || c.id !== a.w) return 'stale_claim';
      if (seat === c.from) return 'not_your_turn';
      // 到点：还没答的人能和就和，否则过
      c.opts.forEach((o, i) => {
        if (o.length && c.ans[i] === null) c.ans[i] = o.includes('ron') ? 'ron' : 'pass';
      });
      resolve(s);
      return null;
    }
  }
}

export function resumeMut(s: RcState): void {
  if (s.phase !== 'end') return;
  startRound(s);
}

/** 这一刻谁能出手（声明窗口的名单见文件头） */
export function actorsOf(s: RcState): { seats: number[]; group: string } | null {
  switch (s.phase) {
    case 'turn':
      return { seats: [s.turn], group: `turn-${s.kyoku}` };
    case 'claim': {
      const c = s.claim!;
      return { seats: [0, 1, 2, 3].filter((i) => i !== c.from && !c.bot[i]), group: `claim-${c.id}` };
    }
    default:
      return null;
  }
}

/**
 * 好友房有人接管座位、带入到账：筹码重新记；点数不动，记下这个座位此刻按打完算的得分（含马），终局时新来的人只按接手以后的涨落算。
 * 前一个人离座时按"没打完"结走（不算马，见 standings），两种算法之间的差和电脑代打那一段一样归庄家
 */
export function restakeMut(s: RcState, seat: number, chips: number): void {
  s.chips[seat] = chips;
  s.stake[seat] = chips;
  // 还没开打（开局时真人的带入到账也走这里）：从头算，不记；按名次算马时点数都一样也会差出几万分
  if (s.kyoku === 0 && s.discards === 0) return;
  s.entry = (s.entry ?? [0, 0, 0, 0]).map((x, i) => (i === seat ? standings(s).score[seat]! : x));
}

/** 好友房里座位换了人：只换"是谁"，统计从头算 */
export function seatedMut(s: RcState, seat: number, kind: SeatKind): void {
  if (s.kinds[seat] === kind) return;
  s.kinds[seat] = kind;
  s.stats[seat] = { ...emptyStats(), rounds: s.phase === 'end' || s.phase === 'over' ? 0 : 1 };
}
