/**
 * 掼蛋的金样（牌馆重构 ①a，docs/doudizhu.md 1.3）：把现在的代码在一批固定种子上的完整输出按固定顺序 JSON 序列化、算 sha256。
 * 重构（①b）时这些哈希一个都不许变——规则、电脑、房间规则层、实盘账、称号颁奖复盘分享卡的数据逐字节不变才算没改行为。
 * 覆盖面优先于局数（主线 10-20：CI 里一分钟内）：每种场地、难度、局长、房间开法都走到，局数按耗时调。
 * 重新生成 / 导出明细见 tools/golden.ts。
 */
import { createHash } from 'node:crypto';
import { snapshotBytes } from 'arcade-kit/game';
import { botFor, type SoloLevel, type Venue } from '../src/variants/guandan/ai/venue.ts';
import { decide, styleOf, suggest } from '../src/variants/guandan/ai/index.ts';
import {
  SHORT_END_LEVEL, canPass, createGame, dispatch, eventsFor, hint, legalPlays, previewNext, replay, seatsToAct, timeoutAction, viewFor,
  type Action, type DealResult, type GameState, type Options, type PlayRecord,
} from '../src/variants/guandan/core/index.ts';
import { matchAwards, winnerOf } from '../src/variants/guandan/net/awards.ts';
import { dealMoment, momentOf, victimOf } from '../src/variants/guandan/net/fun-moments.ts';
import { rotateNetView } from '../src/variants/guandan/net/rotate.ts';
import { guandanRoom as R, testKey, type NetAction, type NetState } from '../src/variants/guandan/net/rules.ts';
import { matchEnd } from '../src/variants/guandan/net/together.ts';
import { TIER_IDS, payout, soloAddDeal, soloOver, soloPoints, type SoloMatch, type TierId } from '../src/variants/guandan/stake/index.ts';
import { statsOf, tallyDeal, emptyTally } from '../src/variants/guandan/stake/stats.ts';
import { bombsBy, dealTitles, emptyMatchLog, logDeal, matchTitles, type MatchLog } from '../src/variants/guandan/stake/titles.ts';
import { feedPick } from '../src/view/feed.ts';
import { dealHighlights, highlightText } from '../src/view/highlights.ts';
import { dealRecap } from '../src/view/recap.ts';
import { Session } from '../src/view/session.ts';
import { shareCardOf } from '../src/view/share-card.ts';

/** 一条场景的记录：逐项喂进 sha256；dump 给了就把每一项也写成一行（导出明细对比用） */
export class Rec {
  private h = createHash('sha256');
  n = 0;
  /** 每种记录、每种牌局事件出现了几次（金样测试据此核对覆盖面：进贡、抗贡、再来一场、重新带入、换人……都走到了） */
  readonly seen = new Map<string, number>();
  private readonly dump: ((line: string) => void) | undefined;
  constructor(dump?: (line: string) => void) {
    this.dump = dump;
  }
  add(tag: string, x: unknown): void {
    const line = `${tag}\t${JSON.stringify(x ?? null)}`;
    this.h.update(line);
    this.h.update('\n');
    this.n++;
    this.seen.set(tag, (this.seen.get(tag) ?? 0) + 1);
    const evs = (x as { events?: unknown } | null)?.events;
    if (Array.isArray(evs)) for (const e of evs) this.seen.set(`ev:${(e as { type: string }).type}`, (this.seen.get(`ev:${(e as { type: string }).type}`) ?? 0) + 1);
    this.dump?.(line);
  }
  digest(): string {
    return this.h.digest('hex');
  }
}

// ---------- 一副、一局打完时的公开数据（称号、复盘、名场面、分享卡……） ----------

function dealExtras(rec: Rec, r: DealResult, history: readonly PlayRecord[], log: MatchLog): MatchLog {
  rec.add('bombsBy', bombsBy(history));
  rec.add('dealTitles', dealTitles(r, history));
  rec.add('recap', dealRecap(r, history));
  const hl = dealHighlights(r, history);
  rec.add('highlights', hl.map((h) => [h, highlightText(h, (s) => `座${s}`)]));
  const first = feedPick(hl, []);
  rec.add('feed', [first, first ? feedPick(hl, [first.moment]) : null]);
  rec.add('dealMoment', dealMoment(r));
  rec.add('victim', victimOf(history));
  const next = logDeal(log, r, history);
  rec.add('log', next);
  return next;
}

function matchExtras(rec: Rec, log: MatchLog, gameWinner: number): void {
  const titles = matchTitles(log);
  rec.add('matchTitles', titles);
  const w = winnerOf(log, gameWinner);
  rec.add('awards', [w, matchAwards(log, w)]);
  rec.add('share', [
    shareCardOf({ kind: 'game', win: gameWinner === 0, room: null }, log, titles, null),
    shareCardOf({ kind: 'game', win: gameWinner === 0, room: '123456', goal: '打到 10' }, log, titles, '小明'),
    shareCardOf({ kind: 'stake', tier: 'mid', points: 7, chips: payout('mid', 7), deals: log.deals, room: null }, log, titles, null),
  ]);
}

// ---------- 单机：真实的 Session（座位 0 代打，电脑按场地） ----------

class GoldenSession extends Session {
  private readonly v: Venue;
  constructor(st: GameState, level: SoloLevel, v: Venue) {
    super(st, [], level);
    this.v = v;
    this.persist = false;
    this.scored = false;
  }
  protected override venue(): Venue {
    return this.v;
  }
}

/** 单机打一局：每一步的动作、状态、事件、四家视图，轮到的人的合法牌、提示、超时代出、电脑状态；每副的称号等公开数据 */
export function soloGame(rec: Rec, seed: string, venue: Venue, options?: Partial<Options>, maxDeals = 99): void {
  const level: SoloLevel = venue.kind === 'solo' ? venue.level : 'normal';
  const created = createGame(seed, options);
  rec.add('create', created);
  const ses = new GoldenSession(created.state, level, venue);
  const actions: Action[] = [];
  let log = emptyMatchLog();
  let m: SoloMatch | null = venue.kind === 'soloStake' ? { tier: venue.tier, deals: [] } : null;
  let tally = emptyTally();
  for (let step = 0; ; step++) {
    const st = ses.state;
    if (st.phase === 'gameOver' || st.dealNo > maxDeals || step > 20000) break;
    let a: Action;
    if (st.phase === 'dealEnd') {
      rec.add('preview', ses.preview());
      a = { type: 'nextDeal' };
    } else {
      const seat = seatsToAct(st)[0]!;
      const v = viewFor(st, seat);
      rec.add('actor', [seat, seatsToAct(st)]);
      rec.add('legal', [legalPlays(v), canPass(v)]);
      rec.add('hint', [hint(v), suggest(v, ses.hintSeed())]);
      rec.add('timeout', timeoutAction(v));
      if (seat !== 0) rec.add('style', [ses.botStyle(seat), styleOf(v, botFor(venue, seat).difficulty, botFor(venue, seat).persona, 'golden', seat)]);
      a = ses.botAction(seat)!;
    }
    const before = ses.state;
    const raw = dispatch(before, a);
    const r = ses.apply(a);
    rec.add('action', a);
    rec.add('dispatch', raw);
    rec.add('mine', r);
    actions.push(a);
    for (let s = 0; s < 4; s++) rec.add('view', [viewFor(ses.state, s), eventsFor(raw.events, s)]);
    for (const e of raw.events) {
      rec.add('moment', [momentOf(e, victimOf(ses.state.history), ses.state.hands[0]?.length ?? 0)]);
      if (e.type === 'dealEnd') {
        log = dealExtras(rec, e.result, ses.state.history, log);
        tally = tallyDeal(tally, e.result, ses.state.history, 0, venue.kind === 'soloStake' ? venue.tier : 'small');
        rec.add('tally', [tally, statsOf(tally)]);
        if (m) {
          m = soloAddDeal(m, e.result);
          rec.add('solo', [m, soloPoints(m), soloOver(m, ses.state.phase)]);
        }
      }
      if (e.type === 'gameOver') matchExtras(rec, log, e.winner);
    }
  }
  // 回放：同一个种子、同一串动作得到同一个终局
  const same = JSON.stringify(replay(seed, options, actions)) === JSON.stringify(ses.state);
  if (!same) throw new Error(`金样 ${seed}：回放的终局和直接打的不一样`);
  rec.add('replay', same);
}

// ---------- 房间规则层：照 kit 的样子驱动（actors → ai / timeout → apply），钱包立刻办完 ----------

type Kind = 'empty' | 'human' | 'ai';

export interface RoomPlan {
  seed: number;
  setup?: { opts: { stake: TierId } | undefined; seats: Kind[] };
  /** 第几步换人：[步, 座位, 坐的是谁] */
  swaps?: [number, number, 'human' | 'ai'][];
  /** 这些座位的带入被拒 */
  refuse?: number[];
  /** 最多走几步（整场太长的只走一段） */
  maxSteps?: number;
}

function roomFrame(rec: Rec, s: NetState): void {
  rec.add('state', s);
  for (const seat of [-1, 0, 1, 2, 3]) {
    const v = R.view(s, seat === -1 ? null : seat);
    rec.add('view', seat >= 0 ? [v, rotateNetView(v, seat)] : v);
  }
  const over = R.over(s);
  rec.add('meta', [over ? null : R.actors(s), over ? null : R.turnMs(s), R.breakPoint(s), over, R.pause!(s), R.effects!(s), snapshotBytes(R, s), matchEnd(s)]);
}

export function roomGame(rec: Rec, p: RoomPlan): void {
  let s = R.begin(testKey(p.seed), R.rulesVersion, p.setup as never);
  roomFrame(rec, s);
  // 被拒的座位只拒第一次（retry 里的人下一步重新带入一次，再带入就到账）
  const refusedOnce = new Set<number>();
  const refused = new Set<number>();
  const settleAll = () => {
    for (const e of R.effects!(s)) {
      const no = e.kind === 'in' && p.refuse?.includes(e.seat) === true && !refusedOnce.has(e.seat);
      if (no) {
        refusedOnce.add(e.seat);
        refused.add(e.seat);
      }
      s = R.settled!(s, e.id, no ? { ok: false, error: 'insufficient' } : { ok: true });
      rec.add('settled', [e.id, no]);
      roomFrame(rec, s);
    }
  };
  for (let i = 0; i < (p.maxSteps ?? 20000); i++) {
    settleAll();
    if (R.over(s)) break;
    for (const [at, seat, kind] of p.swaps ?? []) if (at === i) {
      s = R.seated!(s, seat, kind);
      rec.add('seated', [seat, kind]);
      roomFrame(rec, s);
      settleAll();
    }
    // 被拒的人重新带入一次
    for (const seat of refused) {
      const re = R.apply(s, seat, { type: 'buyin' } as NetAction);
      rec.add('buyin', [seat, 'error' in re ? re.error : null]);
      if (!('error' in re)) s = re;
      refused.delete(seat);
      settleAll();
    }
    if (R.pause!(s) !== null) {
      s = R.resume!(s);
      rec.add('resume', true);
      roomFrame(rec, s);
      continue;
    }
    const { seats } = R.actors(s);
    if (!seats.length) break;
    const seat = seats[0]!;
    const a = i % 7 === 3 ? R.timeout!(s, seat) : R.ai(s, seat);
    const next = R.apply(s, seat, a);
    rec.add('act', [seat, a, 'error' in next ? next.error : null]);
    if ('error' in next) throw new Error(`房间金样 ${p.seed} 第 ${i} 步：${next.error}`);
    s = next;
    roomFrame(rec, s);
  }
  if (R.closing) {
    s = R.closing(s);
    rec.add('closing', true);
    roomFrame(rec, s);
    settleAll();
  }
}

// ---------- 场景表 ----------

export interface Scenario {
  name: string;
  run(rec: Rec): void;
}

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  const levels: SoloLevel[] = ['novice', 'normal', 'pro'];
  // 单机娱乐：三档 × 完整局、短局（短局整局打完，完整局打前 6 副，进贡、还贡、抗贡、双下都会碰到）
  for (const level of levels) {
    for (let i = 0; i < 4; i++) {
      out.push({ name: `solo-${level}-short-${i}`, run: (r) => soloGame(r, `g-${level}-s${i}`, { kind: 'solo', level }, { endLevel: SHORT_END_LEVEL }) });
      out.push({ name: `solo-${level}-full-${i}`, run: (r) => soloGame(r, `g-${level}-f${i}`, { kind: 'solo', level }, undefined, 6) });
    }
  }
  // 单机实盘：四档各一场（8 副）
  for (const tier of TIER_IDS) for (let i = 0; i < 2; i++) out.push({ name: `solo-stake-${tier}-${i}`, run: (r) => soloGame(r, `g-stake-${tier}-${i}`, { kind: 'soloStake', tier }, undefined, 8) });
  // 地方规则开关
  out.push({ name: 'solo-options', run: (r) => soloGame(r, 'g-opts', { kind: 'solo', level: 'normal' }, { fullHouseJokerPair: false, maxBombSize: 8, aFailLimit: 0, returnMaxRank: 14, antiTributeCombined: false }, 6) });
  // 房间：老局（没有 setup）、娱乐（一个真人 / 两个真人 / 中途有人走、有人接管）、实盘（两人 / 四人 / 有人带入被拒、中途离开）
  out.push({ name: 'room-legacy', run: (r) => roomGame(r, { seed: 1, maxSteps: 400 }) });
  // 一个真人的娱乐房打完整场（到"再来一场"的等待和收场）
  out.push({ name: 'room-fun-1h', run: (r) => roomGame(r, { seed: 2, setup: { opts: undefined, seats: ['human', 'ai', 'ai', 'ai'] } }) });
  out.push({ name: 'room-fun-2h-swap', run: (r) => roomGame(r, { seed: 3, setup: { opts: undefined, seats: ['human', 'ai', 'human', 'ai'] }, swaps: [[40, 2, 'ai'], [120, 1, 'human']], maxSteps: 1500 }) });
  for (const [k, tier] of TIER_IDS.entries()) {
    out.push({ name: `room-stake-${tier}`, run: (r) => roomGame(r, { seed: 10 + k, setup: { opts: { stake: tier }, seats: k % 2 ? ['human', 'human', 'human', 'human'] : ['human', 'ai', 'human', 'ai'] }, refuse: k === 1 ? [3] : [], swaps: k === 2 ? [[60, 2, 'ai'], [200, 2, 'human']] : [] }) });
  }
  return out;
}

export interface Outcome {
  hash: string;
  items: number;
  seen: Record<string, number>;
}

export function runScenario(sc: Scenario, dump?: (line: string) => void): Outcome {
  const rec = new Rec(dump);
  sc.run(rec);
  return { hash: rec.digest(), items: rec.n, seen: Object.fromEntries([...rec.seen].sort(([a], [b]) => (a < b ? -1 : 1))) };
}
