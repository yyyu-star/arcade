/**
 * 好友房的规则（DESIGN.md 5.6）：kit 的 RoomGame，房间（worker/room.ts）和页面共用，纯函数。
 *
 * 一个房间从开房到关掉是 kit 的"一局"：房主一进房页面就让 kit 开局（kit 层面从此一直在打），
 * 房间里的准备（座位、对阵、地图、小动物、武器、准备）、对局、结算都是这里的状态，所以"再来一局"大家还在同一个房间里。
 * - kit 的座位（6 个）只表示"房间里的这个人"；蓝、黄两队各 3 个位子（slot 0–2 蓝队 1–3 号，3–5 黄队 1–3 号）是这里的状态，
 *   真人点空位坐下、换位子都是不轮流的操作（kit 的 free），不受 kit"开打以后座位绑人"的限制；
 * - 准备阶段（lobby）和结算（result）只有房主算"该出手的人"（时限一天，在线时到不了）：房主掉线满 60 秒，kit 转托管、调 ai，房间把房主交给
 *   下一个坐着的真人（handoff，按座位顺序）；对局中不交，回来也不收回。都交不出去时谁也不等（waiting）；
 * - 对局里一回合 = 一条 act（turn：爬动序列、道具、角度、力度、朝向；或者 pass 弃权），房间逐项验证（replay.ts 的 stepRec）；
 *   超时（30 秒）算弃权；掉线超过 60 秒、离座由 kit 交给电脑托管（ai → auto）；
 * - 每一手打完先"停一会儿"（kit 的 pause），时长是页面放完这一手的动画要多久（anim.ts），停够了下一个人的 30 秒才开始；
 * - 电脑的回合：轮到的"座位"是一个没人坐的 kit 座位，kit 马上调 ai → auto，联机档电脑（ai/online.ts）想一步、结算；
 *   一次只算一个（maxAiBatch 1），下一个电脑等这一手放完、闹钟响了再算。kit 座位全坐满真人时，借一个真人的座位、1 秒后按超时代出；
 * - 视图不带种子（房间的 key、这一局的 key）：页面拿到开局设置、出生点、先手、第一回合的风和每一回合的 Rec（带下一回合的风），自己重放；
 * - 服务端的局面（地形网格）不进存储：存的是角色这些小东西加"挖过的坑"（每个 x、y、半径），房间被驱逐后按地图 + 坑重建，内存里按对象缓存。
 */
import type { RoomGame, RoomSetup } from 'arcade-kit/game';
import { stream, type Entropy } from 'arcade-kit/rng';
import { planActions } from '../ai/index.ts';
import { planLite } from '../ai/online.ts';
import { favoriteWeapon, personaById, PERSONAS } from '../ai/personas.ts';
import { COMMON, COMMONS, type Common, type Loadout } from '../core/items.ts';
import { buildTerrain, isMapId, MAP_IDS, MAPS, type MapId } from '../core/maps.ts';
import { opening, startFrom, windFor } from '../core/rules.ts';
import { cloneTerrain, dig, type Terrain } from '../core/terrain.ts';
import { LOOKS, type Dir, type Look, type PlayerSetup, type Setup, type State, type Team } from '../core/types.ts';
import { isWeaponId, WEAPON_IDS, type WeaponId } from '../core/weapons.ts';
import { playMs, START_MS } from './anim.ts';
import { MAX_MOVES, stepRec, toRec, type Rec } from './replay.ts';

/** kit 的座位数：房间里最多 6 个人能坐下（另外最多 4 个人只看） */
export const SEATS = 6;
/** 两队的位子：0–2 蓝队 1–3 号，3–5 黄队 1–3 号 */
export const SLOTS = 6;
export const TURN_MS = 30_000;
/** 电脑的回合借真人的座位时，过多久按超时代出 */
export const BOT_TURN_MS = 1000;
export const RULES_VERSION = 3;
/**
 * 页面版本（kit 的 clientVersion，页面 src/friend.ts 连房间时带上）；房间只收不低于它的页面（worker/room.ts 的 minClientVersion），旧页面收到 4005、提示刷新。
 * 规则含义变了（RULES_VERSION 加一）就跟着加一：旧页面按旧规则重放会和房间对不上（0.3.1：纸飞机不限次数，旧页面重放第 3 次纸飞机会出错；
 * 0.4.0：多了 5 张图、"随机"从 11 张里抽，旧页面认不得新图）。
 */
export const CLIENT_VERSION = 3;
/** 准备、结算时房主"出手"的时限：只是为了让 kit 在房主掉线满宽限（60 秒，转托管）时调 ai 把房主交出去，在线的房主永远等不到它 */
export const HOST_WAIT_MS = 24 * 3_600_000;

export type Format = 1 | 2 | 3;
export type Phase = 'lobby' | 'play' | 'result';

export interface Person {
  look: Look;
  weapon: WeaponId;
  ready: boolean;
}

export type Slot = { seat: number } | { persona: string; weapon: WeaponId } | null;

/** 服务端的这一局（不下发的：key、lite、carves） */
export interface Match {
  no: number;
  /** 这一局的种子（从房间的种子按局号分出来），只在服务端 */
  key: Entropy;
  setup: Setup;
  /** 每个角色由哪个 kit 座位操控；电脑是 null */
  owners: (number | null)[];
  xs: number[];
  first: Team;
  wind: number;
  log: Rec[];
  /** 现在的局面（不含地形、种子、开局设置） */
  lite: Lite;
  /** 挖过的坑：x、y、大小、武器（WEAPON_IDS 里的序号，定坑形），四个数一个坑，一个接一个 */
  carves: number[];
  /** 正在等页面放完动画（毫秒）；0 是在等人出手 */
  anim: number;
}

type Lite = Omit<State, 'key' | 'setup' | 'terrain'>;

export interface RoomState {
  v: 1;
  /** 房间的种子（kit 开局时给的 256 位熵），只在服务端 */
  key: Entropy;
  /** 房主的 kit 座位（只有他能改对阵、地图、电脑，开打、再来一局） */
  host: number;
  /** 每个 kit 座位现在是不是有真人 */
  humans: boolean[];
  /** 每个 kit 座位上的人选的小动物、武器、准备了没有 */
  people: (Person | null)[];
  phase: Phase;
  format: Format;
  map: MapId | 'random';
  slots: Slot[];
  /** 开过几局 */
  matches: number;
  /** 掉线太久被交出房主的人（kit 座位）：他再做点什么（说明回来了）就从这里拿掉；在这里的人不会再被选成房主 */
  idle?: number[];
  game: Match | null;
}

export type SlotView = { k: 'human'; seat: number; look: Look; weapon: WeaponId; ready: boolean } | { k: 'bot'; persona: string; look: Look; weapon: WeaponId } | null;

export interface GameView {
  no: number;
  setup: Setup;
  owners: (number | null)[];
  xs: number[];
  first: Team;
  wind: number;
  log: Rec[];
  /** 房间在等大家放完上一手的动画 */
  anim: boolean;
}

export interface RoomView {
  phase: Phase;
  host: number;
  format: Format;
  map: MapId | 'random';
  slots: SlotView[];
  /** 房间里坐下了、但没上位子的人（kit 座位）的小动物，给"看台"画头像 */
  bench: { seat: number; look: Look }[];
  game: GameView | null;
}

/** 一回合：爬动序列、角度、力度、朝向，道具每种几个（0 个可以不写），锅盖、纸飞机 */
export type TurnAct = { t: 'turn'; m: string; a: number; p: number; f: Dir; lid?: boolean; plane?: boolean } & Partial<Record<Common, number>>;

const TURN_KEYS = new Set(['t', 'm', 'a', 'p', 'f', 'lid', 'plane', ...COMMON]);

/** 一回合打成 act：0 个的道具、没用的锅盖纸飞机都不写（消息越短越好） */
export function turnAct(moves: readonly Dir[], angle: number, power: number, facing: Dir, l: Loadout): TurnAct {
  const a: TurnAct = { t: 'turn', m: moves.map((d) => (d < 0 ? 'L' : 'R')).join(''), a: angle, p: power, f: facing };
  for (const k of COMMON) if (l[k]) a[k] = l[k];
  if (l.lid) a.lid = true;
  if (l.plane) a.plane = true;
  return a;
}

export type NetAction =
  | TurnAct
  | { t: 'pass' }
  /** 电脑代出（电脑的回合、掉线托管）：只由房间的 ai / timeout 给，parse 不收，真人发不了 */
  | { t: 'auto' }
  /** 准备、结算时房主掉线满 60 秒（kit 转托管）：房间用 ai 交出房主；parse 不收 */
  | { t: 'handoff' }
  | { t: 'sit'; slot: number }
  | { t: 'bench' }
  | { t: 'look'; look: Look }
  | { t: 'weapon'; weapon: WeaponId }
  | { t: 'ready'; on: boolean }
  | { t: 'format'; n: Format }
  | { t: 'map'; map: MapId | 'random' }
  | { t: 'addbot'; slot: number; persona?: string }
  | { t: 'delbot'; slot: number }
  | { t: 'setbot'; slot: number; persona?: string; weapon?: WeaponId }
  | { t: 'kick'; slot: number }
  | { t: 'start' }
  | { t: 'again' };

const LOBBY_ACTS = new Set(['sit', 'bench', 'look', 'weapon', 'ready', 'format', 'map', 'addbot', 'delbot', 'setbot', 'kick', 'start', 'again']);

// ---------- 位子 ----------

export function slotTeam(slot: number): Team {
  return slot < 3 ? 0 : 1;
}

/** 这个位子这一档对阵用不用（1v1 只用两队各 1 号位） */
export function slotOpen(format: Format, slot: number): boolean {
  return slot % 3 < format;
}

export function slotOf(s: RoomState, seat: number): number {
  return s.slots.findIndex((x) => x !== null && 'seat' in x && x.seat === seat);
}

function lookOf(s: RoomState, x: Exclude<Slot, null>): Look {
  return 'seat' in x ? s.people[x.seat]!.look : personaById(x.persona)!.look;
}

/** 在用的位子上已经有哪些小动物（同一只一局只上一次）；skip 是不算的那个位子 */
function usedLooks(s: RoomState, skip = -1): Set<Look> {
  const out = new Set<Look>();
  s.slots.forEach((x, i) => {
    if (x && i !== skip && slotOpen(s.format, i)) out.add(lookOf(s, x));
  });
  return out;
}

function personaOfLook(look: Look): string {
  return PERSONAS.find((p) => p.look === look)!.id;
}

function freeLook(used: Set<Look>, prefer?: Look): Look {
  if (prefer && !used.has(prefer)) return prefer;
  return LOOKS.find((l) => !used.has(l)) ?? LOOKS[0]!;
}

function copyRoom(s: RoomState): RoomState {
  return { ...s, humans: [...s.humans], people: s.people.map((p) => (p ? { ...p } : null)), slots: s.slots.map((x) => (x ? { ...x } : null)) };
}

/** 人坐进一个位子：小动物和场上的撞了就换一只没人用的 */
function seatInto(s: RoomState, seat: number, slot: number): void {
  const old = slotOf(s, seat);
  if (old >= 0) s.slots[old] = null;
  s.slots[slot] = { seat };
  const p = s.people[seat]!;
  p.look = freeLook(usedLooks(s, slot), p.look);
}

/** 对局里离座走了的人（他的角色电脑替他打完了）：打完、开下一局前把他的位子空出来；房主走了交给下一个还在的人 */
function purgeGone(s: RoomState): void {
  s.slots.forEach((x, i) => {
    if (x && 'seat' in x && !s.humans[x.seat]) s.slots[i] = null;
  });
  s.people = s.people.map((p, seat) => (s.humans[seat] ? p : null));
  if (!s.humans[s.host]) {
    const next = s.humans.findIndex((h) => h);
    if (next >= 0) s.host = next;
  }
}

/** 第一个空着的、在用的位子：人少的那队优先 */
function emptySlot(s: RoomState, team?: Team): number {
  const count = (t: Team): number => s.slots.filter((x, i) => x && slotTeam(i) === t && slotOpen(s.format, i)).length;
  const order: Team[] = team !== undefined ? [team, (1 - team) as Team] : count(1) < count(0) ? [1, 0] : [0, 1];
  for (const t of order) for (let k = 0; k < 3; k++) if (slotOpen(s.format, t * 3 + k) && s.slots[t * 3 + k] === null) return t * 3 + k;
  return -1;
}

function newPerson(s: RoomState): Person {
  const used = usedLooks(s);
  for (const p of s.people) if (p) used.add(p.look);
  return { look: freeLook(used), weapon: 'steamer', ready: false };
}

// ---------- 服务端的局面 ----------

/** 每张图光栅化好的地形（同一个进程里的房间共用，只读；用的时候复制一份） */
const BASE = new Map<MapId, Terrain>();
function baseTerrain(id: MapId): Terrain {
  let t = BASE.get(id);
  if (!t) {
    t = buildTerrain(MAPS[id]);
    BASE.set(id, t);
  }
  return cloneTerrain(t);
}

/** 这一局现在的完整局面：内存里按对象缓存；没有（刚从存储读出来）就按地图加挖过的坑重建 */
const CORE = new WeakMap<Match, State>();
export function coreOf(g: Match): State {
  const hit = CORE.get(g);
  if (hit) return hit;
  const t = baseTerrain(g.setup.map);
  for (let i = 0; i + 3 < g.carves.length; i += 4) dig(t, g.carves[i]!, g.carves[i + 1]!, g.carves[i + 2]!, WEAPON_IDS[g.carves[i + 3]!]!);
  const s: State = { ...g.lite, key: g.key, setup: g.setup, terrain: t };
  CORE.set(g, s);
  return s;
}

function liteOf(s: State): Lite {
  const { key: _k, setup: _s, terrain: _t, ...lite } = s;
  return lite;
}

/** 第 no 局的种子和"随机"地图：从房间的种子按局号分一条流 */
function matchSeed(key: Entropy, no: number): { key: Entropy; pick: number } {
  const r = stream(key, 'match', no);
  const k = Array.from({ length: 8 }, () => r.u32());
  return { key: k, pick: r.below(MAP_IDS.length) };
}

// ---------- 开局 ----------

/** 开打的条件：在用的位子上的真人都准备了（房主不用）、两队都至少有一个人。页面按视图问同一个函数 */
export function startError(v: Pick<RoomView, 'slots' | 'format' | 'host'>): string | null {
  const teams = [0, 0];
  for (let i = 0; i < SLOTS; i++) {
    const x = v.slots[i];
    if (!x || !slotOpen(v.format, i)) continue;
    teams[slotTeam(i)]! += 1;
    if (x.k === 'human' && x.seat !== v.host && !x.ready) return 'not_ready';
  }
  if (!teams[0] || !teams[1]) return 'empty_team';
  return null;
}

function startMatch(s: RoomState): RoomState {
  const no = s.matches + 1;
  const seed = matchSeed(s.key, no);
  const players: PlayerSetup[] = [];
  const owners: (number | null)[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const x = s.slots[i];
    if (!x || !slotOpen(s.format, i)) continue;
    if ('seat' in x) {
      const p = s.people[x.seat]!;
      // 真人的名字页面按 kit 座位上的昵称换上（房间不知道昵称）；这里只是占位
      players.push({ name: `#${x.seat + 1}`, team: slotTeam(i), look: p.look, weapon: p.weapon, ai: false });
      owners.push(x.seat);
    } else {
      const per = personaById(x.persona)!;
      players.push({ name: per.name, team: slotTeam(i), look: per.look, weapon: x.weapon, ai: true });
      owners.push(null);
    }
  }
  const map = s.map === 'random' ? MAP_IDS[seed.pick]! : s.map;
  const setup: Setup = { map, players };
  const { xs, first } = opening(seed.key, setup);
  const wind = windFor(seed.key, 1);
  const core = startFrom(seed.key, setup, baseTerrain(map), xs, first, wind);
  const g: Match = { no, key: seed.key, setup, owners, xs, first, wind, log: [], lite: liteOf(core), carves: [], anim: START_MS };
  CORE.set(g, core);
  return { ...s, phase: 'play', matches: no, game: g, people: s.people.map((p) => (p ? { ...p, ready: false } : null)) };
}

// ---------- 对局 ----------

/** 这一手由哪个 kit 座位出：真人角色是他的座位；电脑是一个没人坐的座位（kit 马上用 ai 代出），都坐满了借一个真人的座位（超时代出） */
function actorSeat(s: RoomState): number | null {
  const g = s.game;
  if (s.phase !== 'play' || !g || g.anim > 0) return null;
  const core = g.lite;
  if (core.phase !== 'play') return null;
  const owner = g.owners[core.actor];
  if (owner !== null && owner !== undefined) return owner;
  const free = s.humans.findIndex((h) => !h);
  return free >= 0 ? free : s.host;
}

function botTurn(s: RoomState): boolean {
  const g = s.game;
  return !!g && g.owners[g.lite.actor] === null;
}

/** 做一回合：rec 不带风（风由种子算），回新的房间状态 */
function playRec(s: RoomState, rec: Omit<Rec, 'w'>): RoomState | { error: string } {
  const g = s.game!;
  const out = stepRec(coreOf(g), rec);
  if ('error' in out) return out;
  const ns = out.state;
  if (ns.turn === g.lite.turn && ns.phase === 'play') return { error: 'unfinished' };
  const carves = [...g.carves];
  for (const e of out.events) if (e.t === 'boom') carves.push(e.x, e.y, e.r, WEAPON_IDS.indexOf(e.w));
  const over = ns.phase === 'over';
  const room = over ? copyRoom(s) : s;
  if (over) purgeGone(room);
  const next: Match = {
    ...g,
    log: [...g.log, { ...rec, w: ns.wind }],
    lite: liteOf(ns),
    carves,
    anim: over ? 0 : playMs(out.events, rec.pass ? null : (rec.p ?? null)),
  };
  CORE.set(next, ns);
  return { ...room, phase: over ? 'result' : 'play', game: next };
}

/** 电脑出手（电脑的回合、掉线托管）：联机档电脑想一步；万一算出不合法的就弃权 */
function autoRec(s: RoomState): Omit<Rec, 'w'> {
  const core = coreOf(s.game!);
  const p = planLite(core);
  const fire = planActions(p).at(-1)!;
  if (fire.t !== 'fire') return { pass: true };
  return toRec(p.moves, fire);
}

// ---------- 操作 ----------

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function parseAction(raw: unknown): NetAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  switch (r.t) {
    case 'turn': {
      if (typeof r.m !== 'string' || r.m.length > MAX_MOVES || !/^[LR]*$/.test(r.m)) return null;
      if (!isInt(r.a, 0, 90) || !isInt(r.p, 1, 100) || (r.f !== 1 && r.f !== -1)) return null;
      // 形状要严：不认识的字段（比如旧的 mode、boost）、不是整数、超过一回合上限的都拒
      if (Object.keys(r).some((k) => !TURN_KEYS.has(k))) return null;
      for (const k of COMMON) if (r[k] !== undefined && !isInt(r[k], 0, COMMONS[k].max)) return null;
      if (r.lid !== undefined && typeof r.lid !== 'boolean') return null;
      if (r.plane !== undefined && typeof r.plane !== 'boolean') return null;
      const a: TurnAct = { t: 'turn', m: r.m, a: r.a, p: r.p, f: r.f };
      for (const k of COMMON) if (r[k]) a[k] = r[k] as number;
      if (r.lid !== undefined) a.lid = r.lid;
      if (r.plane !== undefined) a.plane = r.plane;
      return a;
    }
    case 'pass':
    case 'bench':
    case 'start':
    case 'again':
      return { t: r.t };
    case 'sit':
    case 'delbot':
    case 'kick':
      return isInt(r.slot, 0, SLOTS - 1) ? { t: r.t, slot: r.slot } : null;
    case 'look':
      return LOOKS.includes(r.look as Look) ? { t: 'look', look: r.look as Look } : null;
    case 'weapon':
      return isWeaponId(r.weapon) ? { t: 'weapon', weapon: r.weapon } : null;
    case 'ready':
      return typeof r.on === 'boolean' ? { t: 'ready', on: r.on } : null;
    case 'format':
      return r.n === 1 || r.n === 2 || r.n === 3 ? { t: 'format', n: r.n } : null;
    case 'map':
      return r.map === 'random' || isMapId(r.map) ? { t: 'map', map: r.map as MapId | 'random' } : null;
    case 'addbot':
    case 'setbot': {
      if (!isInt(r.slot, 0, SLOTS - 1)) return null;
      if (r.persona !== undefined && (typeof r.persona !== 'string' || !personaById(r.persona))) return null;
      if (r.t === 'addbot') return r.persona === undefined ? { t: 'addbot', slot: r.slot } : { t: 'addbot', slot: r.slot, persona: r.persona as string };
      if (r.weapon !== undefined && !isWeaponId(r.weapon)) return null;
      const a: NetAction = { t: 'setbot', slot: r.slot };
      if (r.persona !== undefined) a.persona = r.persona as string;
      if (r.weapon !== undefined) a.weapon = r.weapon as WeaponId;
      return a;
    }
    default:
      return null;
  }
}

/** 准备阶段、结算页上的操作 */
function lobbyAct(s0: RoomState, seat: number, a: NetAction): RoomState | { error: string } {
  if (s0.phase === 'play') return { error: 'playing' };
  if (!s0.people[seat]) return { error: 'not_seated' };
  const host = seat === s0.host;
  const s = copyRoom(s0);
  const me = s.people[seat]!;
  const mine = slotOf(s, seat);
  switch (a.t) {
    case 'sit': {
      if (!slotOpen(s.format, a.slot)) return { error: 'slot_closed' };
      if (s.slots[a.slot] !== null) return { error: 'slot_taken' };
      seatInto(s, seat, a.slot);
      return s;
    }
    case 'bench':
      if (mine < 0) return { error: 'not_in_slot' };
      s.slots[mine] = null;
      me.ready = false;
      return s;
    case 'look': {
      if (me.look === a.look) return s;
      const other = s.slots.findIndex((x, i) => x && i !== mine && slotOpen(s.format, i) && lookOf(s, x) === a.look);
      if (other >= 0) {
        const x = s.slots[other]!;
        if ('seat' in x) return { error: 'look_taken' };
        // 电脑在用这只：和它对调（它换成我原来那只的人物，拿那位喜欢的武器；我不在位子上就给它一只没人用的）
        const used = usedLooks(s, other);
        used.add(a.look);
        const swap = personaById(personaOfLook(mine >= 0 ? me.look : freeLook(used, me.look)))!;
        s.slots[other] = { persona: swap.id, weapon: favoriteWeapon(swap) };
      }
      me.look = a.look;
      return s;
    }
    case 'weapon':
      me.weapon = a.weapon;
      return s;
    case 'ready':
      if (mine < 0 && a.on) return { error: 'not_in_slot' };
      me.ready = a.on;
      return s;
    default:
      break;
  }
  if (!host) return { error: 'not_host' };
  switch (a.t) {
    case 'format': {
      s.format = a.n;
      // 这一档用不到的位子：真人挪到空着的位子（先本队），挪不下就下场；电脑撤掉
      for (let i = 0; i < SLOTS; i++) {
        const x = s.slots[i];
        if (!x || slotOpen(s.format, i)) continue;
        s.slots[i] = null;
        if ('seat' in x) {
          const to = emptySlot(s, slotTeam(i));
          if (to >= 0) seatInto(s, x.seat, to);
          else s.people[x.seat]!.ready = false;
        }
      }
      // 位子多了：在看台上的人坐进去
      s.people.forEach((p, seat) => {
        if (!p || !s.humans[seat] || slotOf(s, seat) >= 0) return;
        const to = emptySlot(s);
        if (to >= 0) seatInto(s, seat, to);
      });
      return s;
    }
    case 'map':
      s.map = a.map;
      return s;
    case 'addbot': {
      if (!slotOpen(s.format, a.slot)) return { error: 'slot_closed' };
      if (s.slots[a.slot] !== null) return { error: 'slot_taken' };
      const used = usedLooks(s);
      const per = a.persona ? personaById(a.persona)! : PERSONAS.find((p) => !used.has(p.look))!;
      if (used.has(per.look)) return { error: 'look_taken' };
      s.slots[a.slot] = { persona: per.id, weapon: favoriteWeapon(per) };
      return s;
    }
    case 'delbot': {
      const x = s.slots[a.slot];
      if (!x || 'seat' in x) return { error: 'not_bot' };
      s.slots[a.slot] = null;
      return s;
    }
    case 'setbot': {
      const x = s.slots[a.slot];
      if (!x || 'seat' in x) return { error: 'not_bot' };
      let bot = { ...x };
      if (a.persona && a.persona !== x.persona) {
        const per = personaById(a.persona)!;
        const other = s.slots.findIndex((y, i) => y && i !== a.slot && slotOpen(s.format, i) && lookOf(s, y) === per.look);
        if (other >= 0) {
          const y = s.slots[other]!;
          if ('seat' in y) return { error: 'look_taken' };
          // 别的电脑是这位：两个对调
          const old = personaById(x.persona)!;
          s.slots[other] = { persona: old.id, weapon: favoriteWeapon(old) };
        }
        bot = { persona: per.id, weapon: favoriteWeapon(per) };
      }
      if (a.weapon) bot.weapon = a.weapon;
      s.slots[a.slot] = bot;
      return s;
    }
    case 'kick': {
      const x = s.slots[a.slot];
      if (!x || !('seat' in x)) return { error: 'not_human' };
      if (x.seat === seat) return { error: 'self' };
      s.slots[a.slot] = null;
      s.people[x.seat]!.ready = false;
      return s;
    }
    case 'start': {
      purgeGone(s);
      const bad = startError(viewOf(s));
      return bad ? { error: bad } : startMatch(s);
    }
    case 'again':
      if (s.phase !== 'result') return { error: 'not_over' };
      purgeGone(s);
      return { ...s, phase: 'lobby', game: null };
    default:
      return { error: 'bad_action' };
  }
}

/**
 * 房主交给下一个人（准备、结算阶段房主掉线满 60 秒时，kit 托管他、调 ai）：按座位顺序找下一个坐着、没被交出过房主的真人；
 * 一个都没有就先不交（房主进 idle，谁也不等），他回来做点什么就又是房主。对局中不交（对局里房主没有要做的事）
 */
function handoff(s0: RoomState, seat: number): RoomState | { error: string } {
  if (s0.phase === 'play') return { error: 'playing' };
  if (seat !== s0.host) return { error: 'not_host' };
  const s = copyRoom(s0);
  const idle = [...(s.idle ?? []).filter((x) => x !== seat), seat];
  for (let k = 1; k < SEATS; k++) {
    const c = (seat + k) % SEATS;
    if (s.humans[c] && !idle.includes(c)) {
      s.host = c;
      break;
    }
  }
  return { ...s, idle };
}

function applyAction(s: RoomState, seat: number, a: NetAction): RoomState | { error: string } {
  if (a.t === 'handoff') return handoff(s, seat);
  const out = applyInner(s, seat, a);
  // 做了点什么就是回来了：不再算掉线太久的人
  if (!('error' in out) && out.idle?.includes(seat)) return { ...out, idle: out.idle.filter((x) => x !== seat) };
  return out;
}

function applyInner(s: RoomState, seat: number, a: NetAction): RoomState | { error: string } {
  if (LOBBY_ACTS.has(a.t)) return lobbyAct(s, seat, a);
  if (s.phase !== 'play' || !s.game) return { error: 'not_playing' };
  if (actorSeat(s) !== seat) return { error: 'not_your_turn' };
  if (a.t === 'auto') return playRec(s, autoRec(s));
  // 真人的操作：只能出自己角色的那一手（电脑的回合借来的座位不能替电脑出）
  if (botTurn(s)) return { error: 'not_your_turn' };
  if (a.t === 'pass') return playRec(s, { pass: true });
  if (a.t !== 'turn') return { error: 'bad_action' };
  const rec: Omit<Rec, 'w'> = toRec(
    [...a.m].map((c) => (c === 'L' ? -1 : 1)),
    { angle: a.a, power: a.p, facing: a.f, ...Object.fromEntries(COMMON.filter((k) => a[k]).map((k) => [k, a[k]])), ...(a.lid ? { lid: true } : {}), ...(a.plane ? { plane: true } : {}) },
  );
  return playRec(s, rec);
}

// ---------- 视图 ----------

const VIEWS = new WeakMap<RoomState, RoomView>();

/** 所有人看到的都一样（没有暗牌）：不带房间和这一局的种子、服务端的局面 */
export function viewOf(s: RoomState): RoomView {
  const hit = VIEWS.get(s);
  if (hit) return hit;
  const slots: SlotView[] = s.slots.map((x) => {
    if (!x) return null;
    if ('seat' in x) {
      const p = s.people[x.seat]!;
      return { k: 'human', seat: x.seat, look: p.look, weapon: p.weapon, ready: p.ready };
    }
    return { k: 'bot', persona: x.persona, look: personaById(x.persona)!.look, weapon: x.weapon };
  });
  const bench: RoomView['bench'] = [];
  s.people.forEach((p, seat) => {
    if (p && s.humans[seat] && slotOf(s, seat) < 0) bench.push({ seat, look: p.look });
  });
  const g = s.game;
  const v: RoomView = {
    phase: s.phase,
    host: s.host,
    format: s.format,
    map: s.map,
    slots,
    bench,
    game: g ? { no: g.no, setup: g.setup, owners: g.owners, xs: g.xs, first: g.first, wind: g.wind, log: g.log, anim: g.anim > 0 } : null,
  };
  VIEWS.set(s, v);
  return v;
}

// ---------- kit 的规则接口 ----------

export function newRoom(entropy: Entropy, seats: readonly string[]): RoomState {
  const humans = Array.from({ length: SEATS }, (_, i) => seats[i] === 'human');
  const host = Math.max(0, humans.indexOf(true));
  const s: RoomState = {
    v: 1,
    key: [...entropy],
    host,
    humans,
    people: humans.map(() => null),
    phase: 'lobby',
    format: 1,
    map: 'kitchen',
    slots: Array.from({ length: SLOTS }, () => null),
    matches: 0,
    game: null,
  };
  humans.forEach((h, seat) => {
    if (!h) return;
    s.people[seat] = newPerson(s);
    const to = emptySlot(s, seat === host ? 0 : undefined);
    if (to >= 0) seatInto(s, seat, to);
  });
  return s;
}

export const ROOM_RULES: RoomGame<RoomState, NetAction, RoomView> = {
  seats: SEATS,
  rulesVersion: RULES_VERSION,
  begin: (entropy, _rv, setup?: RoomSetup<unknown>) => newRoom(entropy, setup?.seats ?? ['human']),
  start: () => {
    throw new Error('danli 用 begin 开局');
  },
  parse: parseAction,
  apply: (s, seat, a) => applyAction(s, seat, a),
  turn: (s) => (s.phase !== 'play' ? (s.humans[s.host] && !s.idle?.includes(s.host) ? s.host : null) : actorSeat(s)),
  actors: (s) => {
    // 准备、结算：房主是"该出手的人"（时限一天，在线时永远到不了）；他掉线满 60 秒被 kit 托管，kit 调 ai 交出房主
    if (s.phase !== 'play') return s.humans[s.host] && !s.idle?.includes(s.host) ? { seats: [s.host], group: `host-${s.host}` } : [];
    const seat = actorSeat(s);
    return seat === null ? [] : { seats: [seat], group: `${s.game!.no}-${s.game!.lite.turn}` };
  },
  turnMs: (s) => (s.phase !== 'play' ? HOST_WAIT_MS : botTurn(s) ? BOT_TURN_MS : TURN_MS),
  view: (s) => viewOf(s),
  ai: (s) => (s.phase !== 'play' ? { t: 'handoff' } : { t: 'auto' }),
  // 真人超时算弃权；电脑的回合（借真人的座位时）到点由电脑出
  timeout: (s) => (s.phase !== 'play' ? { t: 'handoff' } : botTurn(s) ? { t: 'auto' } : { t: 'pass' }),
  over: () => false,
  breakPoint: (s) => s.phase !== 'play',
  free: (a) => LOBBY_ACTS.has(a.t),
  waiting: (s) => s.phase !== 'play',
  pause: (s) => (s.phase === 'play' && s.game && s.game.anim > 0 ? s.game.anim : null),
  resume: (s) => {
    const g = s.game!;
    const next: Match = { ...g, anim: 0 };
    const core = CORE.get(g);
    if (core) CORE.set(next, core);
    return { ...s, game: next };
  },
  seated: (s0, seat, kind) => {
    const s = copyRoom(s0);
    s.humans[seat] = kind === 'human';
    if (kind === 'human') {
      s.people[seat] ??= newPerson(s);
      if (s.phase !== 'play' && slotOf(s, seat) < 0) {
        const to = emptySlot(s);
        if (to >= 0) seatInto(s, seat, to);
      }
      return s;
    }
    // 离座：准备阶段、结算页上把他的位子空出来；对局里他的角色由电脑接着打（kit 托管），打完再空
    if (s.phase !== 'play') purgeGone(s);
    return s;
  },
};
