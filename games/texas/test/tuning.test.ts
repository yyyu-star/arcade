/**
 * 电脑的难度（DESIGN.md 4.3）：只断言不会随便翻的结论，精确的数字靠 npm run sim -- --vs 跑几十万手。
 * 种子和 scripts/vs.ts 一样，同一场在各档发的牌一样（配对比较，手数少也比得出高低）。
 */
import { shuffle, stream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { equity } from '../src/ai/equity.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { strength, TOP } from '../src/ai/preflop.ts';
import { parseCards } from '../src/core/cards.ts';
import { categoryOf, evalCards, HIGH_CARD } from '../src/core/eval.ts';
import { FUN_LEVEL, LEVEL_HOUSE, SESSION_HANDS, type StakesId } from '../src/core/stakes.ts';
import { isFail, newTable, PERSONA_COUNT, seatHouse } from '../src/core/table.ts';
import { view, type View } from '../src/core/view.ts';
import { runBots, runSession, runVs } from './bots.ts';
import { SEED } from './helpers.ts';
import { STRATEGIES } from './strategies.ts';

/** n 场 × 100 手，每场的每百手大盲的平均 */
function bb100(stakes: StakesId, strategy: string, n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += runVs({ seed: [k, 0x7e4a5, 3, 4, 5, 6, 7, 8], stakes, size: 6, hands: 100, strategy: STRATEGIES[strategy]! }).mbb;
  return sum / n / 1000;
}

/**
 * 打法统计：size 人桌打 sessions 场 × hands 手，第 k 场坐 pick(k) 这几种性格；返回每种性格的入池、翻牌前加注（%，没上桌的是 NaN）
 */
function style(stakes: StakesId, size: number, sessions: number, hands: number, pick: (k: number) => number[]): { vpip: number; pfr: number }[] {
  const n = PERSONAS.map(() => ({ dealt: 0, vpip: 0, pfr: 0 }));
  for (let k = 0; k < sessions; k++) {
    const personas = pick(k);
    let hand = -1;
    let seen = 0;
    let flop = false;
    let vpip = new Set<number>();
    let pfr = new Set<number>();
    const close = (): void => {
      for (const i of vpip) n[personas[i]!]!.vpip++;
      for (const i of pfr) n[personas[i]!]!.pfr++;
    };
    runBots({
      seed: [k, 2, 3, 4, 5, 6, 7, 8],
      size,
      hands,
      stakes,
      personas,
      chaos: false,
      onStep: (t) => {
        if (t.handNo !== hand) {
          close();
          vpip = new Set();
          pfr = new Set();
          hand = t.handNo;
          seen = 0;
          flop = false;
          t.seats.forEach((s, i) => s.status !== 'out' && n[personas[i]!]!.dealt++);
        }
        for (const e of t.log.slice(seen)) {
          if (e.seat < 0) flop = true;
          else if (!flop && (e.act === 'call' || e.act === 'raise')) (e.act === 'raise' ? pfr : vpip).add(e.seat);
        }
        for (const s of pfr) vpip.add(s);
        seen = t.log.length;
      },
    });
    close();
  }
  return n.map((x) => ({ vpip: Math.round((x.vpip * 100) / x.dealt), pfr: Math.round((x.pfr * 100) / x.dealt) }));
}

/** 从 6 人桌小桌混打里收集翻牌前轮到电脑的视图（满足 pick 的，最多 2,000 个） */
function preflopSpots(pick: (v: View) => boolean): View[] {
  const spots: View[] = [];
  runBots({
    seed: SEED,
    size: 6,
    hands: 3000,
    personas: [9, 0, 2, 4, 6, 8],
    chaos: false,
    onStep: (t) => {
      const s = t.toAct;
      if (s === null || t.board.length > 0 || spots.length >= 2000) return;
      const v = view(t, s);
      if (pick(v)) spots.push(v);
    },
  });
  return spots;
}

const fmt = (xs: { vpip: number; pfr: number }[]): string =>
  xs.flatMap((x, i) => (Number.isNaN(x.vpip) ? [] : [`${PERSONAS[i]!.name} ${x.vpip}/${x.pfr}`])).join('、');

describe('电脑的难度', () => {
  it('配平（0.12.0）：娱乐新手档小白平均赢、过半场次赢；高手档小白平均输，同一批牌比新手档输得多', () => {
    // 每格 80 场 × 40 手（一场约 0.2 秒），种子和 scripts/balance.ts 一样。长期的数字（每格 2,000 场）见 DESIGN.md 4.10；
    // 新手档长期 +0.21 份、赢 68%，高手档 −0.33 份；80 场的 2 倍标准误约 ±0.1 份、±10%，这里只拦方向翻掉
    const cell = (level: number): { mean: number; won: number } => {
      let sum = 0;
      let won = 0;
      for (let k = 0; k < 80; k++) {
        const r = runSession({ seed: [k, 0xba1a, 3, 4, 5, 6, 7, 8], stakes: 'small', size: 6, hands: SESSION_HANDS, strategy: STRATEGIES.novice!, level }).result;
        sum += r;
        if (r > 0) won++;
      }
      return { mean: sum / 80, won: won / 80 };
    };
    const easy = cell(FUN_LEVEL.easy);
    const hard = cell(FUN_LEVEL.hard);
    console.log(`小白 80 场：新手档 ${easy.mean.toFixed(3)} 份、赢 ${easy.won}；高手档 ${hard.mean.toFixed(3)} 份、赢 ${hard.won}`);
    expect(easy.mean).toBeGreaterThan(0);
    expect(easy.won).toBeGreaterThan(0.5);
    expect(hard.mean).toBeLessThan(0);
    expect(hard.mean).toBeLessThan(easy.mean - 0.2);
  }, 60_000);

  it('跟注站、乱全下在豪华桌输得很多；小桌对跟注站没那么狠', () => {
    // 0.12.0 配平（DESIGN.md 4.10）：小桌的电脑多跟少加、价值注小，"什么都跟"的人在小桌差不多打平（6 场约 −60），这是配平要的
    const station = { small: bb100('small', 'station', 6), lux: bb100('lux', 'station', 6) };
    const jammer = { small: bb100('small', 'jammer', 6), lux: bb100('lux', 'jammer', 6) };
    console.log(`每百手：跟注站 小桌 ${station.small.toFixed(0)}、豪华桌 ${station.lux.toFixed(0)}；乱全下 小桌 ${jammer.small.toFixed(0)}、豪华桌 ${jammer.lux.toFixed(0)}`);
    expect(station.lux).toBeLessThan(-300);
    expect(jammer.lux).toBeLessThan(-150);
    expect(station.small).toBeGreaterThan(-1_300);
    expect(station.small).toBeGreaterThan(station.lux);
    expect(jammer.small).toBeLessThan(0);
  });

  it('简单打法在小桌不输太多', () => {
    // 40 场的标准误约 ±23（一场 100 手的标准差约 150），长期是 +23（DESIGN.md 4.3）；这里只拦"小桌的电脑变得太难"
    const small = bb100('small', 'simple', 40);
    console.log(`简单打法在小桌 40 场 × 100 手：${small.toFixed(1)} 个大盲/百手`);
    expect(small).toBeGreaterThan(-25);
  });

  it('同一批翻牌后被下注的局面，小桌、豪华桌两档的电脑决定得不一样（强弱档管用；0.5.0 起按强弱档）', () => {
    // 从机器人对打里收集"翻牌后要跟注"的局面，换成各档的视图让电脑重新决定。整场输赢太吵，几十场比不出来，这里直接比决定
    const spots: View[] = [];
    runBots({
      seed: SEED,
      size: 6,
      hands: 1000,
      chaos: false,
      onStep: (t) => {
        const s = t.toAct;
        if (s !== null && t.board.length > 0 && spots.length < 800) {
          const v = view(t, s);
          if (v.legal!.call > 0) spots.push(v);
        }
      },
    });
    // 0.12.0 以前是"豪华桌弃得多"；配平后小桌第 1 档跟注放得宽、被加注又只跟不加，弃牌数和豪华桌差不多，差别在怎么打（DESIGN.md 4.10）
    const act = (level: number): string[] => spots.map((v, i) => decide({ ...v, level }, stream(SEED, 'spot', i)).t);
    const small = act(1);
    const lux = act(4);
    const differ = small.filter((a, i) => a !== lux[i]).length;
    const raised = (xs: string[]): number => xs.filter((a) => a === 'raise' || a === 'allin').length;
    console.log(`翻牌后被下注 ${spots.length} 个局面：两档决定不一样 ${differ} 次；加注 小桌 ${raised(small)}、豪华桌 ${raised(lux)} 次`);
    expect(spots.length).toBe(800);
    expect(differ).toBeGreaterThan(spots.length * 0.1);
    expect(raised(small)).toBeLessThan(raised(lux));
  });

  it('小桌整体松、很少加注（0.12.0），性格照样拉得开：老好最松，稳哥、慢慢最紧；豪华桌收回去', () => {
    // 原来的 6 种坐 6 人桌（每场轮换座位），6 场 × 500 手，每种性格约 3,000 手，入池比例的标准误约 ±1%。长期的数字见 DESIGN.md 4.3
    const six = (k: number): number[] => Array.from({ length: 6 }, (_, i) => (i + k) % 6);
    const small = style('small', 6, 6, 500, six);
    const lux = style('lux', 6, 6, 500, six);
    console.log(`6 人桌入池 / 翻牌前加注（%）小桌 ${fmt(small)}`);
    console.log(`                           豪华桌 ${fmt(lux)}`);
    // 0.12.0 小桌改用第 1 档（松、不敢先打）：入池整体高、翻牌前加注少；0.11 及以前的区间见 CHANGELOG
    const [wen, abiao, laohao, manman] = small;
    expect(laohao!.vpip).toBeGreaterThanOrEqual(55);
    expect(laohao!.vpip).toBeLessThanOrEqual(75);
    expect(laohao!.pfr).toBeLessThanOrEqual(10);
    expect(abiao!.vpip).toBeGreaterThanOrEqual(40);
    expect(abiao!.vpip).toBeLessThanOrEqual(58);
    expect(abiao!.pfr).toBeGreaterThan(laohao!.pfr + 4);
    for (const x of [wen!, manman!]) {
      expect(x.vpip).toBeGreaterThanOrEqual(22);
      expect(x.vpip).toBeLessThanOrEqual(40);
    }
    expect(laohao!.vpip).toBeGreaterThan(wen!.vpip + 20);
    expect(manman!.pfr).toBeGreaterThanOrEqual(2);
    expect(manman!.pfr).toBeLessThanOrEqual(7);
    // 松只在软桌：豪华桌的老好、阿飙明显收紧
    expect(lux[2]!.vpip).toBeLessThan(laohao!.vpip - 8);
    expect(lux[1]!.vpip).toBeLessThan(abiao!.vpip);
  });

  it('9 人桌：新手、话多松而不加注；豪华桌紧凶老手一进就加，爱诈唬加得多，新手收回去', () => {
    // 10 种性格每场洗一遍取 9 个（和 scripts/vs.ts 的混桌一样），10 场 × 300 手，每种性格约 2,700 手。长期的数字见 DESIGN.md 4.3
    const nine = (k: number): number[] => shuffle(Array.from({ length: PERSONA_COUNT }, (_, i) => i), stream([k, 2, 3, 4, 5, 6, 7, 8], 'mix')).slice(0, 9);
    const small = style('small', 9, 10, 300, nine);
    const lux = style('lux', 9, 10, 300, nine);
    console.log(`9 人桌入池 / 翻牌前加注（%）小桌 ${fmt(small)}`);
    console.log(`                           豪华桌 ${fmt(lux)}`);
    const [wen, , laohao, manman, suanpan, jianghu, , laoying, daodao, xiaobai] = small;
    // 0.3.0：小白、叨叨原来 ≥ 17（实测 22），新的目标是松（9 人桌人多，比 6 人桌的 45–60% 低一点）
    expect(xiaobai!.vpip).toBeGreaterThanOrEqual(40);
    expect(xiaobai!.pfr).toBeLessThanOrEqual(9);
    expect(daodao!.vpip).toBeGreaterThanOrEqual(40);
    expect(daodao!.pfr).toBeLessThanOrEqual(12);
    expect(laoying!.pfr).toBeGreaterThan(wen!.pfr);
    // 0.12.0：小桌第 1 档不敢先打，"一进就加""加得多"只在豪华桌看（DESIGN.md 4.10）
    expect(lux[7]!.pfr).toBeGreaterThanOrEqual(lux[7]!.vpip * 0.6);
    expect(lux[6]!.pfr).toBeGreaterThanOrEqual(10);
    expect(manman!.vpip).toBeLessThanOrEqual(35);
    expect(laohao!.vpip).toBeGreaterThan(wen!.vpip + 20);
    for (const x of [suanpan!, jianghu!]) {
      expect(x.vpip).toBeGreaterThanOrEqual(25);
      expect(x.vpip).toBeLessThanOrEqual(45);
    }
    expect(lux[9]!.vpip).toBeLessThan(xiaobai!.vpip - 6);
  });

  it('"小白一直弃牌"（0.3.0）：6 人桌没人加注、前面位置只补一个大盲，小白一半左右会跟进看牌', () => {
    // 原来翻牌前没人加注也查底池赔率（按 5 个对手的胜率比 400‰），除了 JJ 以上基本全弃
    const spots = preflopSpots((v) => v.seats[v.me!]!.persona === 9 && v.legal!.call === v.bb && v.seats.filter((s) => s.status === 'active').length >= 5);
    const play = spots.filter((v, i) => decide(v, stream(SEED, 'spot', i)).t !== 'fold').length;
    console.log(`小白没人加注、至少 5 人在：${spots.length} 个局面，跟进或加注 ${play} 次`);
    expect(spots.length).toBeGreaterThanOrEqual(150);
    expect(play).toBeGreaterThanOrEqual(spots.length * 0.4);
  });

  it('上头（View.tilt > 0）的电脑翻牌前松一点', () => {
    const spots = preflopSpots((v) => v.legal!.call > 0);
    const play = (tilt: number): number => spots.filter((v, i) => decide({ ...v, tilt }, stream(SEED, 'spot', i)).t !== 'fold').length;
    const calm = play(0);
    const hot = play(5);
    console.log(`翻牌前要跟注的 ${spots.length} 个局面：平时不弃 ${calm} 次，上头 ${hot} 次`);
    expect(hot).toBeGreaterThan(calm * 1.1);
  });

  it('河牌没人下注、手里只有高牌：爱诈唬的常偷一把，老实的很少（0.3.0 实打后，摊牌才亮得出"诈唬"）', () => {
    // 翻牌的诈唬多半当场把人打走，空气很少打到河牌；河牌的诈唬常被有一对的人跟到摊牌
    const spots: View[] = [];
    runBots({
      seed: SEED,
      size: 6,
      hands: 3000,
      personas: [9, 0, 2, 4, 6, 8],
      chaos: false,
      onStep: (t) => {
        const s = t.toAct;
        if (s === null || t.board.length !== 5 || spots.length >= 400) return;
        const v = view(t, s);
        if (v.legal!.check && categoryOf(evalCards([...v.hole, ...v.board])) === HIGH_CARD) spots.push(v);
      },
    });
    // 换成虎子、老好各决定一次（对手数照原样）
    const bets = (persona: number): number =>
      spots.filter((v, i) => {
        const seats = v.seats.map((x, j) => (j === v.me ? { ...x, persona } : x));
        // 0.12.0：小桌第 1 档几乎不诈唬（配平），性格的差别放在豪华桌那一档比
        return decide({ ...v, seats, level: 4 }, stream(SEED, 'river', i)).t !== 'check';
      }).length;
    const huzi = bets(6);
    const laohao = bets(2);
    console.log(`河牌空气可过牌 ${spots.length} 个局面：虎子下注 ${huzi} 次，老好 ${laohao} 次`);
    expect(spots.length).toBeGreaterThanOrEqual(200);
    expect(huzi).toBeGreaterThanOrEqual(spots.length * 0.3);
    expect(laohao).toBeLessThan(huzi / 3);
  });

  it('没人加注时不乱全下：筹码有 20 个大盲以上的电脑开池从不全下（上头也一样）', () => {
    const spots = preflopSpots((v) => v.legal!.raise && v.log.every((e) => e.act !== 'raise') && v.seats[v.me!]!.stack >= 20 * v.bb);
    let raises = 0;
    for (const [i, v] of spots.entries())
      for (const tilt of [0, 5]) {
        const a = decide({ ...v, tilt }, stream(SEED, 'spot', i));
        expect(a.t).not.toBe('allin');
        if (a.t === 'raise') raises++;
      }
    expect(raises).toBeGreaterThan(100);
  });

  it('小桌热闹：简单打法对 5 个电脑，每手平均 2 人以上看翻牌', () => {
    let hands = 0;
    let seers = 0;
    for (let k = 0; k < 20; k++) {
      let hand = -1;
      let dealt = 0;
      let folds = 0;
      let seen = 0;
      let flop = false;
      runVs({
        seed: [k, 0x7e4a5, 3, 4, 5, 6, 7, 8],
        stakes: 'small',
        size: 6,
        hands: 100,
        strategy: STRATEGIES.simple!,
        onStep: (t) => {
          if (t.handNo !== hand) {
            if (hand >= 0 && t.lastHand?.handNo === hand) {
              hands++;
              if (t.lastHand.board.length >= 3) seers += dealt - folds;
            }
            [hand, dealt, folds, seen, flop] = [t.handNo, t.seats.filter((s) => s.status !== 'out').length, 0, 0, false];
          }
          for (const e of t.log.slice(seen)) {
            if (e.seat < 0) flop = true;
            else if (!flop && e.act === 'fold') folds++;
          }
          seen = t.log.length;
        },
      });
    }
    console.log(`小桌 6 人 ${hands} 手：每手平均 ${(seers / hands).toFixed(2)} 人看翻牌`);
    // 0.2.5 时约 1.5（之前的数字见 CHANGELOG）
    expect(seers / hands).toBeGreaterThan(2);
  });

  it('补位按强弱档的权重挑（单机按档位定强弱档，0.5.0）：小桌多来爱跟注、胆小、新手、话多的，豪华桌多来紧凶、会算、爱诈唬的', () => {
    // 两人桌只补一个电脑，看得出权重；9 人桌 8 个电脑只差两个
    const count = (stakes: StakesId): number[] => {
      const n = new Array<number>(PERSONA_COUNT).fill(0);
      for (let k = 0; k < 600; k++) {
        const t = seatHouse(newTable(stakes, 2, [k, ...SEED.slice(1)]), 1);
        if (isFail(t)) throw new Error(t.error);
        n[t.seats[1]!.persona]!++;
      }
      return n;
    };
    const small = count('small');
    const lux = count('lux');
    // 稳哥 + 算盘 对 老好 + 慢慢
    expect(small[2]! + small[3]!).toBeGreaterThan(2 * (small[0]! + small[4]!));
    expect(lux[0]! + lux[4]!).toBeGreaterThan(3 * (lux[2]! + lux[3]!));
    // 叨叨 + 小白 对 虎子 + 老鹰
    expect(small[8]! + small[9]!).toBeGreaterThan(2 * (small[6]! + small[7]!));
    expect(lux[6]! + lux[7]!).toBeGreaterThan(3 * (lux[8]! + lux[9]!));
    for (const w of LEVEL_HOUSE) expect(w.length).toBe(PERSONA_COUNT);
  });

  it('猜范围：对手翻牌前加过注，同一手牌的胜率要低一截', () => {
    const hole = parseCards('Kd Jc');
    const board = parseCards('Js 7h 2c');
    const r = (): ReturnType<typeof stream> => stream(SEED, 'test', 7);
    const any = equity(hole, board, 1, 3000, r());
    const raiser = equity(hole, board, 1, 3000, r(), [TOP[20]!]);
    console.log(`KJ 在 J72 上对 1 人：随机牌 ${any}‰，对前 20% ${raiser}‰`);
    expect(any - raiser).toBeGreaterThan(50);
    // 下限 0 等于不猜，随机数的用法也一样（翻牌前胜率表不用重新生成）
    expect(equity(hole, board, 1, 3000, r(), [0])).toBe(any);
  });

  it('起手牌排名：TOP 从紧到松单调，AA 在最前面', () => {
    for (let p = 1; p <= 100; p++) expect(TOP[p]!).toBeLessThanOrEqual(TOP[p - 1]!);
    expect(strength(parseCards('As')[0]!, parseCards('Ah')[0]!)).toBeGreaterThanOrEqual(TOP[1]!);
    expect(strength(parseCards('7c')[0]!, parseCards('2d')[0]!)).toBeLessThan(TOP[50]!);
  });
});
