/**
 * 电脑出手（DESIGN.md 4.2；0.3.0 的改动见 4.6）。参数是这个座位的视图，不是完整状态：电脑在结构上就拿不到别人的底牌和牌堆。
 * 手牌强度（翻牌前查表、翻牌后蒙特卡洛）→ 和底池赔率、位置、性格、这一档的功力比 → 弃、过、跟、加。全程整数。
 */
import type { RandomStream } from 'arcade-kit/rng';
import type { Action } from '../core/table.ts';
import type { View } from '../core/view.ts';
import { categoryOf, evalCards, HIGH_CARD } from '../core/eval.ts';
import { equity } from './equity.ts';
import { PERSONAS, SKILL, type Persona, type Skill } from './personas.ts';
import { preflopEquity, TOP } from './preflop.ts';

/**
 * 翻牌后蒙特卡洛的次数。对手多时胜率本来就小，200 次误差也在 ±3% 左右；
 * 随机数用 arcade-kit 的 ChaCha20（每个数约 60 ns），这样 5 个对手单次决策 p99 约 0.3 ms（test/ai.test.ts 有预算断言）
 */
export const mcIters = (opponents: number): number => (opponents <= 2 ? 300 : 200);
/** 真人座位没有性格时（托管、模拟）按"算盘" */
const DEFAULT_PERSONA = 4;

/** 每次决定，跟进、加注的门槛上下随机浮动这么多（相对强度）：同样的牌不总是同样的打法（0.3.0） */
const JITTER = 80;
/** 翻牌后没人下注时，相对强度到这儿就算"有点牌"，按 THIN_BET + 性格的 bluff（‰）的概率先下一注（0.3.0） */
const THIN = 1000;
const THIN_BET = 200;
/** 翻牌前面对加注，自己已经投了钱（平跟过、盲注）时跟注门槛再放低多少（相对强度，0.3.0） */
const INVESTED = 200;
/** "上头"时（View.tilt > 0）：跟进门槛再放低、加注门槛再放低、诈唬翻倍、翻牌后多跟一点（0.3.0，DESIGN.md 4.6） */
const TILT = { loose: 150, wild: 100, bluff: 2, slack: 30 } as const;

export function decide(v: View, r: RandomStream): Action {
  const me = v.me;
  const lg = v.legal;
  if (me === null || !lg) throw new Error('decide: not my turn');
  const seat = v.seats[me]!;
  const p: Persona = PERSONAS[seat.persona] ?? PERSONAS[DEFAULT_PERSONA]!;
  const k = SKILL[v.strong ? 'lux' : v.stakes];
  const others = v.seats.flatMap((s, i) => (i !== me && (s.status === 'active' || s.status === 'allin') ? [i] : []));
  const opp = others.length;
  const raises = raisesThisStreet(v);
  const pre = v.board.length === 0;
  const raw = pre ? preflopEquity(v.hole[0]!, v.hole[1]!, opp) : equity(v.hole, v.board, opp, mcIters(opp), r, ranges(v, others, k, p));
  // 有人这一轮下注、加注时他的牌通常更好，每有一次打一个折扣（翻牌前的门槛另按加注次数抬高）
  // 0.3.0 起按次数连乘（原来是线性的 read × 次数）：read 调大以后，对随机牌还有四五成的高牌、空气碰到下注就该弃，不再每手跟到摊牌
  let eq = raw;
  // 越往后的下注越说明有牌：转牌的折扣 ×1.15、河牌 ×1.3（河牌对随机牌的胜率最虚，空气也常有四五成）
  const read = Math.floor((k.read * (1000 + 150 * (v.board.length - 3))) / 1000);
  if (!pre) for (let i = 0; i < Math.min(raises, 3); i++) eq = Math.floor((eq * (1000 - read)) / 1000);
  const rel = eq * (opp + 1);
  const pos = positionBonus(v, me);
  // 旧存档、旧房间的视图没有 tilt，按 0 算
  const tilt = (v.tilt ?? 0) > 0;
  const jit = r.below(2 * JITTER + 1) - JITTER;
  // 这一档的翻牌前门槛：功力的 tight 加上性格在软桌上放松的部分（老好更爱跟、阿飙更爱加，见 personas.ts 的 loose / wild）；
  // loose 同时把面对加注时的底池赔率放宽 ¼，否则赔率这一关挡住，松不起来
  const loose = Math.floor((p.loose * k.soft) / 1000) + (tilt ? TILT.loose : 0);
  const callAt = p.call + k.tight - loose + jit;
  const raiseAt = (pre && raises === 0 ? (p.open ?? p.raise) : p.raise) + k.tight - Math.floor((p.wild * k.soft) / 1000) - (tilt ? TILT.wild : 0) + jit;
  const toCall = lg.call;
  // 底池赔率：要跟的钱 ÷（池子 + 要跟的钱），千分数
  const odds = Math.floor((toCall * 1000) / (v.pot + toCall));

  // 大牌：加注（偶尔慢打）
  if (lg.raise && rel >= raiseAt + k.pre * raises - pos) {
    const slow = eq >= 800 && v.board.length < 5 && r.below(1000) < p.slow;
    if (!slow) return raise(v, p, eq, raises, r);
  }

  if (pre) {
    // 再加注：凶的人（阿飙、虎子）面对一次加注，能跟的牌偶尔再加一手，不只拿大牌再加
    if (lg.raise && raises === 1 && rel >= callAt - pos && r.below(1000) < p.threebet) return raise(v, p, eq, raises, r);
    if (lg.check) return { t: 'check' };
    let ok: boolean;
    if (raises === 0) {
      // 没人加注，只是补一个大盲（或小盲补半个）看翻牌：只看牌力和位置，不查底池赔率。
      // 赔率按全桌的胜率算，6 人桌前面位置平跟要 400‰，5 个对手时普通牌只有 150–170‰，原来除了 JJ 以上全弃（0.3.0，"小白一直弃牌"）
      ok = rel >= callAt - pos || (toCall * 2 <= v.bb && rel >= callAt - 200);
    } else {
      // 有人加注：要跟的钱多了，门槛按加注次数抬高、再看赔率。松的人不太把加注当回事，抬得少（loose 抵掉一部分，小桌的老好、小白基本不抬）。
      // 胜率按"真的掏了钱的人"算（后面没说话的多半会弃），不按全桌
      const eqIn = preflopEquity(v.hole[0]!, v.hole[1]!, voluntary(v, me));
      // 已经投了钱（平跟过、在盲注位）的再放低一点：真人很少平跟完又被一加就弃
      const sunk = seat.bet > 0 ? INVESTED : 0;
      ok = rel >= callAt + Math.max(0, k.pre - 50 - loose) * raises - pos - sunk && eqIn * 1000 >= odds * (1000 - loose / 4);
    }
    return ok ? { t: 'call' } : { t: 'fold' };
  }

  if (lg.check) {
    if (lg.raise && raises === 0) {
      const mine = lastAggressor(v, prevStreet(v)) === me;
      const river = v.board.length === 5;
      let chance: number;
      if (mine && v.board.length > 3) {
        // 上一轮是我下的注：接着打第二枪、第三枪（虎子、阿飙爱这样连着诈唬），对手越多越收着
        chance = Math.floor((p.barrel * k.bluff) / 1000) - 60 * Math.max(0, opp - 1);
      } else {
        // 没人下注：偶尔诈唬，对手越少越敢；翻牌前自己加过注的，翻牌上常"接着打"（持续下注）
        const cbet = v.board.length === 3 && lastPreflopRaiser(v) === me ? 3 : 1;
        chance = Math.floor((p.bluff * k.bluff * 2 * cbet) / 1000 / (opp + 1)) + pos / 2;
      }
      // 中等牌（比这一桌平均强）也常先下一注，不全靠过牌看牌：有来有回，弱牌被打走，不是每手都摊牌
      // 对手多时收着：每多一个对手少 80‰（不往 8 个人里薄打）
      if (rel >= THIN + jit - pos) chance = Math.max(chance, THIN_BET + p.bluff - 80 * (opp - 1));
      // 河牌没牌、没人下注：爱诈唬的人常在这儿偷一把（被跟到就亮出"诈唬"）
      else if (river && categoryOf(evalCards([...v.hole, ...v.board])) === HIGH_CARD) chance = Math.max(chance, Math.floor((p.river * k.bluff) / 1000) - 80 * (opp - 1));
      if (tilt) chance *= TILT.bluff;
      if (r.below(1000) < chance) {
        // 河牌上连着打过来的，偶尔全下吓人（筹码不到池子 3 倍才推，不然下 1.25 池的重注）
        if (river && mine && r.below(1000) < p.shove) return seat.stack <= 3 * v.pot ? { t: 'allin' } : betTo(v, Math.floor((v.pot * 1250) / 1000));
        return betTo(v, Math.floor((v.pot * p.size * (600 + 100 * r.below(5))) / 1_000_000));
      }
    }
    return { t: 'check' };
  }
  // 爱跟的性格（slack 为正）和 loose 一样按档的 soft 打折：小桌全用，越往上越收（中桌的小白原来翻牌后照样跟到底，每百手 −150）
  const slack = p.slack > 0 ? Math.floor((p.slack * k.soft) / 1000) : p.slack;
  const ok = eq >= odds - slack - k.slack - (tilt ? TILT.slack : 0);
  return ok ? { t: 'call' } : { t: 'fold' };
}

/** 翻牌前这一手里真的掏了钱的对手（跟、加过，还没弃），至少 1 个 */
function voluntary(v: View, me: number): number {
  const s = new Set<number>();
  for (const e of v.log) {
    if (e.seat < 0) break;
    if (e.seat !== me && (e.act === 'call' || e.act === 'raise' || e.act === 'bet') && v.seats[e.seat]!.status !== 'folded') s.add(e.seat);
  }
  return Math.max(1, s.size);
}

/** 上一轮（翻牌上看翻牌前，转牌上看翻牌……）在操作记录里的起止下标；翻牌前没有上一轮 */
function prevStreet(v: View): [number, number] {
  const marks = v.log.flatMap((e, i) => (e.seat < 0 ? [i] : []));
  if (marks.length === 0) return [0, 0];
  const end = marks[marks.length - 1]!;
  return [marks.length >= 2 ? marks[marks.length - 2]! + 1 : 0, end];
}

/** 这一段操作记录里最后一个下注或加注的人，没有是 -1 */
function lastAggressor(v: View, [from, to]: [number, number]): number {
  let who = -1;
  for (let i = from; i < to; i++) {
    const e = v.log[i]!;
    if (e.act === 'raise' || e.act === 'bet') who = e.seat;
  }
  return who;
}

/** 这一轮有过几次下注或加注（盲注不算） */
function raisesThisStreet(v: View): number {
  let n = 0;
  for (let i = v.log.length - 1; i >= 0; i--) {
    const e = v.log[i]!;
    if (e.seat < 0) break;
    if (e.act === 'bet' || e.act === 'raise') n++;
  }
  return n;
}

/** 翻牌前最后一个加注的人，没有是 -1 */
function lastPreflopRaiser(v: View): number {
  let who = -1;
  for (const e of v.log) {
    if (e.seat < 0) break;
    if (e.act === 'raise' || e.act === 'bet') who = e.seat;
  }
  return who;
}

/**
 * 按翻牌前的动作猜每个对手的底牌范围（给蒙特卡洛的下限，见 equity.ts）：加过注的最紧，跟过加注的次之，平跟的再松一点。
 * 加注的人按这一档和性格里紧的那个猜（小桌只有老好、阿飙猜：他们翻牌前跟得松，翻牌后不看人会输穿）。
 * 都不猜时返回 undefined，蒙特卡洛按随机牌算
 */
function ranges(v: View, others: readonly number[], k: Skill, p: Persona): number[] | undefined {
  const raiser = Math.min(k.raiser, p.raiser);
  if (raiser >= 100 && k.caller >= 100 && k.limper >= 100) return undefined;
  const pct = new Map<number, number>();
  let level = v.bb;
  for (const e of v.log) {
    if (e.seat < 0) break;
    if (e.act === 'raise' || e.act === 'bet') {
      pct.set(e.seat, Math.min(pct.get(e.seat) ?? 100, raiser));
      level = e.amount;
    } else if (e.act === 'call') pct.set(e.seat, Math.min(pct.get(e.seat) ?? 100, level > v.bb ? k.caller : k.limper));
  }
  return others.map((s) => {
    const x = pct.get(s) ?? 100;
    return x >= 100 ? 0 : TOP[x]!;
  });
}

/** 位置：按钮位最好，关煞位次之（千分数，加在门槛上） */
function positionBonus(v: View, me: number): number {
  if (me === v.button) return 100;
  const n = v.seats.length;
  for (let i = 1; i < n; i++) {
    const k = (v.button - i + n) % n;
    if (v.seats[k]!.status !== 'out') return k === me ? 50 : 0;
  }
  return 0;
}

/** 加注的尺度带一点随机，像人：不总是同一个数 */
function raise(v: View, p: Persona, eq: number, raises: number, r: RandomStream): Action {
  const lg = v.legal!;
  let to: number;
  if (v.board.length === 0) {
    // 翻牌前：开池 2.5–3.5 个大盲（前面每有一个跟进的多加 1 个），再加注约 2.5–3.5 倍
    const limpers = v.log.filter((e) => e.act === 'call').length;
    const x = 5 + r.below(3);
    to = raises === 0 ? Math.floor((x * v.bb) / 2) + limpers * v.bb : Math.floor((x * v.currentBet) / 2);
  } else {
    // 翻牌后：性格的基本尺度乘 0.7–1.3（五档随机挑，不总是同一个数）；很大的牌再大一点
    // 河牌上的大牌，凶的人偶尔直接全下
    if (v.board.length === 5 && eq >= 900 && r.below(1000) < p.shove) return { t: 'allin' };
    const size = Math.floor((p.size * (700 + 150 * r.below(5))) / 1000) + (eq >= 850 ? 250 : 0);
    to = v.currentBet + Math.floor(((v.pot + lg.call) * size) / 1000);
  }
  return betTo(v, to);
}

/** 加到 to：取整到小盲的整数倍，夹在能加的范围里；剩的筹码不到池子一半就直接全下 */
function betTo(v: View, to: number): Action {
  const lg = v.legal!;
  let x = Math.floor(to / v.sb) * v.sb;
  x = Math.min(lg.maxTo, Math.max(lg.minTo, x));
  const me = v.seats[v.me!]!;
  const potAfter = v.pot + (x - me.bet);
  if ((lg.maxTo - x) * 2 < potAfter) x = lg.maxTo;
  return x === lg.maxTo ? { t: 'allin' } : { t: 'raise', to: x };
}
