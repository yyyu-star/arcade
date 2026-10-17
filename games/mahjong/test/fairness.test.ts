/**
 * 电脑不看牌（DESIGN.md 5.4）：反事实的属性测试，谁都能自己跑（npm test，或者只跑这个：npx vitest run test/fairness.test.ts）。
 *
 * 做法：单机（newSolo 开场）和好友房（mahjongRoom.begin 开场）各打几场，每到电脑要出手，造一个"平行世界"：
 * 这个座位能看到的一切不变（自己的手牌和换三张、所有弃牌和明副露、定缺、胡了亮出的牌、每家张数、牌墙剩几张、公开的历史和事件），
 * 把它没看见的牌（别家手牌、别家暗杠的牌、别家换三张的牌、牌墙）在"它没看见的那些牌"里重新洗一遍，再换掉密钥和别家这一场的状态（mood）。
 * 要求：这个座位的视图一个字节都不变，电脑的决定（单机走 XZ.auto、超时走 XZ.timeout、好友房走 mahjongRoom.ai）也不变。
 * 阳性对照：同样的点上让几个故意偷看的电脑（看别家手牌、看牌墙下一张、视图里多一个"牌墙里每种还剩几张"）跑，测试必须抓得出来——
 * 证明平行世界真的改到了看不见的东西，"0 不一致"不是因为什么都没变。
 */
import { stream, type RandomStream } from 'arcade-kit/rng';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { AIS } from '../src/ai/index.ts';
import { decide } from '../src/ai/xuezhan.ts';
import { isComplete } from '../src/core/hand/index.ts';
import { wallLeft } from '../src/core/table/index.ts';
import { countsOf, kindOf, suitOf, type Suit, type Tile } from '../src/core/tiles/index.ts';
import { hasQue, SHAPE, sichuanXuezhan as XZ, view, type XzAction, type XzPlayer, type XzState, type XzView } from '../src/core/variants/sichuan-xuezhan/index.ts';
import type { StakesId } from '../src/game/stakes.ts';
import { mahjongRoom, type RoomState } from '../src/room/rules.ts';
import { newSolo } from '../src/solo.ts';

const AI = AIS[XZ.id]!;
const SEED = [0x66616972, 0x6e657373, 2026, 10, 16, 1, 2, 3];
const J = (x: unknown): string => JSON.stringify(x);
/** 每个决策点造几个平行世界 */
const WORLDS = 2;
const OPTS = [
  { rounds: 4, cap: 4, swap: true, zimo: 'di', transfer: true },
  { rounds: 4, cap: 3, swap: false, zimo: 'fan', transfer: false },
] as const;

// ---------- 平行世界 ----------

function canWin(p: XzPlayer, hand: readonly Tile[]): boolean {
  if (p.que >= 0 && hand.some((t) => suitOf(kindOf(t)) === p.que)) return false;
  return isComplete(countsOf(hand), p.melds.length, SHAPE);
}

/**
 * me 这个座位看不见的东西重洗一遍（me 是 null：没入座的旁观，所有人的暗牌都看不见）。暗杠整组换成另一种（4 张都在没看见的牌里、不是那家的缺门），保持"4 张同种"；
 * 声明窗口里别家能做什么也是暗的，按新手牌重算；定缺阶段别家选了什么也是暗的，换一个。
 * 返回新状态和"看不见的牌到底变没变"（洗了却没变的平行世界不算数）
 */
function perturb(s0: XzState, me: number | null, r: RandomStream): { s: XzState; changed: boolean } {
  const s = structuredClone(s0);
  const P = s.players;
  const known = new Set<Tile>();
  const add = (t: Tile): void => void known.add(t);
  if (me !== null) {
    P[me]!.hand.forEach(add);
    P[me]!.swapOut?.forEach(add);
    P[me]!.swapIn?.forEach(add);
  }
  const hiddenKans: { seat: number; tiles: Tile[] }[] = [];
  P.forEach((p, i) => {
    p.river.forEach((x) => add(x.tile));
    if (p.won) p.hand.forEach(add);
    for (const m of p.melds) {
      if (m.kan === 'concealed' && i !== me && !p.won) hiddenKans.push({ seat: i, tiles: m.tiles });
      else m.tiles.forEach(add);
    }
  });
  if (s.claim) add(s.claim.tile);
  const free = new Set(Array.from({ length: 108 }, (_, t) => t).filter((t) => !known.has(t)));
  const pi = new Map<Tile, Tile>();
  for (const { seat, tiles } of hiddenKans) {
    const cands: number[] = [];
    for (let k = 0; k < 27; k++) {
      if (suitOf(k) === P[seat]!.que || hiddenKans.some((h) => h.tiles !== tiles && kindOf(h.tiles[0]!) === k)) continue;
      if ([0, 1, 2, 3].every((c) => free.has(k * 4 + c))) cands.push(k);
    }
    // 暗杠里有我自己换出去的牌（我知道它在那家）：这一组不动
    if (!cands.length) {
      tiles.forEach((t) => free.delete(t));
      continue;
    }
    const k2 = cands[r.below(cands.length)]!;
    const src = [...tiles].sort((a, b) => a - b);
    src.forEach((t, c) => {
      pi.set(t, k2 * 4 + c);
      pi.set(k2 * 4 + c, t);
      free.delete(t);
      free.delete(k2 * 4 + c);
    });
  }
  const rest = [...free];
  const to = rest.slice();
  for (let i = to.length - 1; i > 0; i--) {
    const j = r.below(i + 1);
    [to[i], to[j]] = [to[j]!, to[i]!];
  }
  rest.forEach((t, i) => pi.set(t, to[i]!));
  const f = (t: Tile): Tile => pi.get(t) ?? t;
  const before = P.map((p) => p.hand.join(','));
  P.forEach((p, i) => {
    if (i === me || p.won) return;
    p.hand = p.hand.map(f).sort((a, b) => a - b);
    if (p.swapOut) p.swapOut = p.swapOut.map(f);
    if (p.swapIn) p.swapIn = p.swapIn.map(f);
    for (const m of p.melds) if (m.kan === 'concealed') m.tiles = m.tiles.map(f).sort((a, b) => a - b);
    if (s.phase === 'que' && p.que >= 0) p.que = r.below(3) as Suit;
  });
  s.wall.tiles = s.wall.tiles.map(f);
  if (s.drawn !== null && s.turn !== me) s.drawn = f(s.drawn);
  s.events = s.events.map((e) => ((e.e === 'draw' && e.seat !== me) || (e.e === 'kan' && e.kan === 'concealed' && e.seat !== me) ? { ...e, tile: f(e.tile) } : e));
  if (s.claim) {
    const c = s.claim;
    const k = kindOf(c.tile);
    for (let i = 0; i < 4; i++) {
      if (i === me || i === c.from) continue;
      const p = P[i]!;
      const o: string[] = [];
      if (!p.won && suitOf(k) !== p.que) {
        if (!hasQue(p) && canWin(p, [...p.hand, c.tile])) o.push('ron');
        if (!c.rob && wallLeft(s.wall) > 0) {
          const n = p.hand.filter((t) => kindOf(t) === k).length;
          if (n >= 3) o.push('kan');
          if (n >= 2) o.push('pon');
        }
      }
      (c.opts as string[][])[i] = o;
    }
  }
  s.key = Array.from({ length: 8 }, () => r.u32());
  if (s.tunes) s.tunes = s.tunes.map((t, i) => (i === me ? t : { ...t, mood: r.u32() | 1 }));
  const changed = P.some((p, i) => i !== me && !p.won && p.hand.join(',') !== before[i]) || wallLeft(s.wall) > 0;
  return { s, changed };
}

// ---------- 故意偷看的电脑（阳性对照） ----------

/** 看别家手牌：把别家的牌当成"已经打出来的"喂给正常电脑（有效牌、危险度都按真牌算） */
function peekHands(s: XzState, seat: number): XzAction | null {
  const v = view(s, seat);
  if (!v.prompt) return null;
  v.seats.forEach((x, i) => {
    if (i !== seat && !s.players[i]!.won) x.river = [...x.river, ...s.players[i]!.hand.map((tile) => ({ tile, taken: false }))];
  });
  return decide(v);
}
/** 看牌墙：下一张能让我胡，就打掉凑成胡的那张 */
function peekWall(s: XzState, seat: number): XzAction | null {
  const v = view(s, seat);
  if (!v.prompt) return null;
  if (v.prompt.discard && wallLeft(s.wall) > 0) {
    const next = s.wall.tiles[s.wall.head]!;
    const p = s.players[seat]!;
    for (const t of v.prompt.discard) if (canWin(p, [...p.hand.filter((x) => x !== t), next])) return { t: 'discard', tile: t };
  }
  return decide(v);
}
/** 视图里多一个"看起来公开"的字段：牌墙里每种还剩几张；电脑打掉剩得最少的那种 */
function leakyView(s: XzState, seat: number): XzView & { wallKinds: number[] } {
  const c = new Array<number>(27).fill(0);
  for (let i = s.wall.head; i <= s.wall.tail; i++) c[kindOf(s.wall.tiles[i]!)]!++;
  return { ...view(s, seat), wallKinds: c };
}
function peekLeaky(s: XzState, seat: number): XzAction | null {
  const v = leakyView(s, seat);
  if (!v.prompt) return null;
  if (!v.prompt.discard?.length) return decide(v);
  let best = v.prompt.discard[0]!;
  for (const t of v.prompt.discard) if (v.wallKinds[kindOf(t)]! < v.wallKinds[kindOf(best)]!) best = t;
  return { t: 'discard', tile: best };
}
const CHEATS = { hands: peekHands, wall: peekWall, leaky: peekLeaky } as const;

// ---------- 打牌、在每个决策点比 ----------

const tally = {
  points: 0,
  worlds: 0,
  unchanged: 0,
  viewDiff: 0,
  soloDiff: 0,
  timeoutDiff: 0,
  roomDiff: 0,
  leakyViewDiff: 0,
  /** 旁观（没入座，房间按座位 null 给的视图）：查了几步、几个平行世界、视图变了几次、漏牌的阳性对照抓到几次 */
  watch: { points: 0, worlds: 0, diff: 0, leak: 0 },
  cheat: { hands: 0, wall: 0, leaky: 0 } as Record<keyof typeof CHEATS, number>,
  by: new Map<string, number>(),
};
const bump = (k: string): void => void tally.by.set(k, (tally.by.get(k) ?? 0) + 1);

function check(s: XzState, seat: number, rs: RoomState | null, r: RandomStream): void {
  const v0 = J(view(s, seat));
  const a0 = J(XZ.auto(s, seat, AI));
  const t0 = J(XZ.timeout(s, seat, AI));
  const room0 = rs ? J(mahjongRoom.ai(rs, seat)) : '';
  const cheat0 = Object.fromEntries(Object.entries(CHEATS).map(([k, f]) => [k, J(f(s, seat))]));
  const leaky0 = J(leakyView(s, seat));
  tally.points++;
  const choice = !(s.phase === 'claim' && !s.claim!.opts[seat]!.length);
  bump(`${rs ? 'room' : 'solo'}:${s.phase}${choice ? '' : '(没得选)'}`);
  bump(`action:${(JSON.parse(a0) as XzAction).t}`);
  if (s.players.some((p, i) => i !== seat && !p.won && p.melds.some((m) => m.kan === 'concealed'))) bump('别家有暗杠');
  for (let w = 0; w < WORLDS; w++) {
    const { s: s1, changed } = perturb(s, seat, r);
    tally.worlds++;
    if (!changed) tally.unchanged++;
    if (J(view(s1, seat)) !== v0) tally.viewDiff++;
    if (J(XZ.auto(s1, seat, AI)) !== a0) tally.soloDiff++;
    if (J(XZ.timeout(s1, seat, AI)) !== t0) tally.timeoutDiff++;
    if (rs && J(mahjongRoom.ai({ ...rs, g: s1 }, seat)) !== room0) tally.roomDiff++;
    for (const [k, f] of Object.entries(CHEATS)) if (J(f(s1, seat)) !== cheat0[k]) tally.cheat[k as keyof typeof CHEATS]++;
    if (J(leakyView(s1, seat)) !== leaky0) tally.leakyViewDiff++;
  }
}

/**
 * 旁观（docs/social.md 1.4）：kit 给没入座的连接发 mahjongRoom.view(状态, null)。所有人的暗牌、牌墙、密钥怎么洗，这份视图一个字节都不变；
 * 阳性对照：把还没胡的第一家的真手牌塞进视图（"漏了一家手牌"），平行世界里它得跟着变
 */
function checkWatch(rs: RoomState, r: RandomStream): void {
  const g = rs.g as XzState;
  const v0 = J(mahjongRoom.view(rs, null));
  const k = g.players.findIndex((p) => !p.won);
  const leak = (st: RoomState): string => {
    const v = mahjongRoom.view(st, null);
    const gv = v.g as XzView;
    return J({ ...v, g: { ...gv, seats: gv.seats.map((x, i) => (i === k ? { ...x, hand: (st.g as XzState).players[i]!.hand } : x)) } });
  };
  const leak0 = leak(rs);
  tally.watch.points++;
  for (let w = 0; w < WORLDS; w++) {
    const { s: s1, changed } = perturb(g, null, r);
    if (!changed) continue;
    tally.watch.worlds++;
    const rs1 = { ...rs, g: s1 };
    if (J(mahjongRoom.view(rs1, null)) !== v0) tally.watch.diff++;
    if (k >= 0 && leak(rs1) !== leak0) tally.watch.leak++;
  }
}

/** 单机：newSolo 开场（密钥来自"浏览器随机数"，这里换成带种子的），照 solo.ts 的循环推；真人座位也用电脑代打，只推进不计数 */
function runSolo(stakes: StakesId, n: number): void {
  const rng = stream(SEED, 'crypto', n);
  const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
    const u = a as unknown as Uint32Array;
    for (let i = 0; i < u.length; i++) u[i] = rng.u32();
    return a;
  });
  let s = newSolo(stakes, OPTS[n % OPTS.length]!, 'tester', null, 2_000).state;
  spy.mockRestore();
  const r = stream(SEED, 'perturb', n);
  for (let k = 0; k < 20_000 && !XZ.over(s); k++) {
    const act = XZ.actors(s);
    if (!act || !act.seats.length) {
      s = XZ.resume(s);
      continue;
    }
    const seat = act.seats.find((i) => s.kinds[i] === 'ai') ?? act.seats[0]!;
    if (s.kinds[seat] === 'ai') check(s, seat, null, r);
    s = XZ.apply(s, seat, XZ.auto(s, seat, AI)) as XzState;
  }
  expect(XZ.over(s)).toBe(true);
}

/** 好友房：mahjongRoom.begin 开场，带入都到账；电脑座位走 mahjongRoom.ai（kit 调的就是它），真人用电脑代打 */
function runRoom(stakes: StakesId, humans: number, n: number): void {
  const er = stream(SEED, 'entropy', n);
  const entropy = Array.from({ length: 8 }, () => er.u32());
  const kinds = [0, 1, 2, 3].map((i) => (i < humans ? 'human' : 'ai')) as ('human' | 'ai')[];
  let rs = mahjongRoom.begin!(entropy, 1, { opts: { variant: XZ.id, stakes, rules: OPTS[n % OPTS.length] }, seats: kinds } as never);
  for (let k = 0; k < 3; k++) for (const e of mahjongRoom.effects!(rs)) rs = mahjongRoom.settled!(rs, e.id, { ok: true });
  const r = stream(SEED, 'perturb', 1_000 + n);
  for (let k = 0; k < 20_000 && !mahjongRoom.over(rs); k++) {
    const act = mahjongRoom.actors!(rs);
    const seats = Array.isArray(act) ? act : act.seats;
    if (!seats.length) {
      if (mahjongRoom.pause!(rs) === null) break;
      rs = mahjongRoom.resume!(rs);
      continue;
    }
    const g = rs.g as XzState;
    checkWatch(rs, r);
    let seat = seats.find((i) => rs.kinds[i] === 'ai');
    let a;
    if (seat !== undefined) {
      check(g, seat, rs, r);
      a = mahjongRoom.ai(rs, seat);
    } else {
      seat = seats.find((i) => view(g, i).prompt)!;
      const { bot: _bot, ...x } = XZ.auto(g, seat, AI) as XzAction & { bot?: boolean };
      a = { t: 'play' as const, v: XZ.id, a: x };
    }
    rs = mahjongRoom.apply(rs, seat, a) as RoomState;
  }
}

beforeAll(() => {
  // 各场地都有（单机五档、好友房娱乐和实盘），两套规则选项轮着用
  let n = 0;
  for (const st of ['fun', 'small', 'mid', 'big', 'lux'] as const) for (let i = 0; i < 2; i++) runSolo(st, n++);
  for (const [st, humans] of [
    ['fun', 1],
    ['small', 2],
    ['lux', 2],
  ] as const)
    for (let i = 0; i < 2; i++) runRoom(st, humans, n++);
  // 本机约 8 秒，CI 的机器慢一倍多，钩子默认 10 秒不够
}, 120_000);
afterAll(() => {
  vi.restoreAllMocks();
  // 跑完打一行数字，自己复现时对得上
  const { by, ...rest } = tally;
  console.info('电脑不看牌：', JSON.stringify({ ...rest, by: Object.fromEntries([...by].sort()) }));
});

describe('电脑不看牌（反事实）', () => {
  test('覆盖到：单机、好友房，换三张、定缺、摸打、有得选的声明窗口、暗杠；各种出手', () => {
    const by = Object.fromEntries(tally.by);
    for (const k of ['solo:swap', 'solo:que', 'solo:turn', 'solo:claim', 'room:swap', 'room:que', 'room:turn', 'room:claim', '别家有暗杠', 'action:discard', 'action:claim', 'action:kan', 'action:zimo'])
      expect(by[k] ?? 0, `${k}：${JSON.stringify(by)}`).toBeGreaterThan(0);
    // 平行世界真的改到了看不见的牌（只有牌墙摸完、别家都胡了的最后几步可能没得改）
    expect(tally.unchanged / tally.worlds).toBeLessThan(0.02);
  });

  test('看不见的牌、密钥、别家的状态怎么换，视图和决定都 0 不一致（单机、超时代出、好友房三条路）', () => {
    expect(tally.points).toBeGreaterThan(1_000);
    expect({ view: tally.viewDiff, solo: tally.soloDiff, timeout: tally.timeoutDiff, room: tally.roomDiff }).toEqual({ view: 0, solo: 0, timeout: 0, room: 0 });
  });

  test('旁观（座位 null）的视图里没有任何人的暗牌：所有暗牌、牌墙、密钥重洗，好友房每一步的旁观视图都 0 不一致；漏一家手牌的对照被抓出来', () => {
    expect(tally.watch.points).toBeGreaterThan(500);
    expect(tally.watch.diff).toBe(0);
    expect(tally.watch.leak).toBeGreaterThan(tally.watch.worlds / 10);
  });

  test('阳性对照：故意偷看的电脑在同样的点上都被抓出来', () => {
    expect(tally.cheat.hands).toBeGreaterThan(tally.worlds / 10);
    expect(tally.cheat.wall).toBeGreaterThan(0);
    expect(tally.cheat.leaky).toBeGreaterThan(tally.worlds / 10);
    // 多出来的那个字段本身就让视图变了：视图字段白名单（match.test.ts）也会抓到它
    expect(tally.leakyViewDiff).toBeGreaterThan(tally.worlds / 2);
  });
});
