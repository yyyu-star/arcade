/** 名场面和称号（0.3.0）：只用亮出来的牌和操作记录 */
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards.ts';
import { evalCards } from '../src/core/eval.ts';
import type { HandResult, LogEntry } from '../src/core/table.ts';
import { invested, NO_FAME, noteHand, settleStats, TITLES } from '../src/core/fame.ts';
import { funItem, PROPS, propId } from 'arcade-kit/fun-logic';
import { EMOTE_COUNT, TAUNT_COUNT } from '../src/room/rules.ts';
import { riverTurnaround } from '../src/core/fame.ts';
import { TAUNTS } from '../src/fun/taunts.ts';
import { suggest } from '../src/view/fun.ts';
import { showcase, showcaseText, Tally } from '../src/view/titles.ts';

const board = parseCards('Ah 7d 2c 9s Kh');
const sh = (seat: number, hole: string) => {
  const h = parseCards(hole);
  return { seat, hole: h, value: evalCards([...h, ...board]) };
};
const result = (shown: ReturnType<typeof sh>[], winner: number, over: Partial<HandResult> = {}): HandResult => ({
  handNo: 1,
  board,
  shown,
  pots: [{ amount: 400, winners: [{ seat: winner, won: 400 }] }],
  uncalled: null,
  byFold: false,
  ...over,
});
const e = (seat: number, act: LogEntry['act'], amount = 0, allin = false): LogEntry => ({ seat, act, amount, ...(allin ? { allin: true as const } : {}) });

describe('名场面', () => {
  it('河牌逆转：转牌时亮出来的另一家更大，河牌赢了主池', () => {
    // 转牌（A 7 2 9）时 1 号一对 A、0 号一对 9；河牌 K 来了 0 号两对 K9 翻盘
    const r = result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 0);
    expect(riverTurnaround(r)).toBe(0);
    expect(showcase(r, [])).toEqual({ kind: 'river', seat: 0 });
    // 转牌时就领先的赢了：不算
    expect(riverTurnaround(result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 1))).toBeNull();
    // 没摊牌、只亮一家：不算
    expect(riverTurnaround(result([sh(0, 'Kd 9d')], 0))).toBeNull();
    expect(showcase(result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 0, { byFold: true }), [])).toBeNull();
  });
  it('四条以上、全下对决', () => {
    const quads = result([sh(0, 'Ad Ac'), sh(1, '7h 7c')], 0, { board: parseCards('As Ah 7d 2c 9s') });
    quads.shown = quads.shown.map((s) => ({ ...s, value: evalCards([...s.hole, ...quads.board]) }));
    expect(showcase(quads, [])).toEqual({ kind: 'quads', seat: 0 });
    const plain = result([sh(0, 'Ad Qc'), sh(1, '8h 8c')], 0);
    expect(showcase(plain, [])).toBeNull();
    expect(showcase(plain, [e(1, 'bb', 20, true)])).toBeNull();
    expect(showcase(plain, [e(1, 'raise', 2000, true), e(0, 'call', 1980)])).toEqual({ kind: 'allin', seat: 0 });
  });
  it('全下对决按主池的赢家写：只平分了边池的不算笑到最后；主池平分写"平分秋色"（0.3.0 实打）', () => {
    const allin = [e(2, 'raise', 2000, true), e(0, 'call', 1980), e(1, 'call', 1980)];
    // 2 号赢了主池，0、1 号平分边池；0 号排在 shown 前面
    const side = result([sh(0, 'Ad Qc'), sh(1, 'Ac Qd'), sh(2, '7h 7c')], 2, {
      pots: [
        { amount: 5_560, winners: [{ seat: 2, won: 5_560 }] },
        { amount: 220, winners: [{ seat: 0, won: 110 }, { seat: 1, won: 110 }] },
      ],
    });
    expect(showcase(side, allin)).toEqual({ kind: 'allin', seat: 2 });
    expect(showcaseText(showcase(side, allin)!, '算盘', side)).toBe('全下对决，算盘 笑到最后');
    const chop = result([sh(0, 'Ad Qc'), sh(1, 'Ac Qd')], 0, { pots: [{ amount: 4_000, winners: [{ seat: 0, won: 2_000 }, { seat: 1, won: 2_000 }] }] });
    const heads = [e(0, 'raise', 2000, true), e(1, 'call', 2000)];
    expect(showcase(chop, heads)).toEqual({ kind: 'allin', seat: 0, split: true });
    expect(showcaseText(showcase(chop, heads)!, '老好', chop)).toBe('全下对决，平分秋色');
  });
});

describe('称号', () => {
  it('诈唬王、天选之人、跟注站、大赢家、送财童子；数不够的不给', () => {
    const t = new Tally();
    const who = (i: number) => ({ key: `k${i}`, name: `p${i}` });
    // 1 号翻牌后最后下注、亮出高牌：诈唬
    const bluff = result([sh(0, 'Ad Qc'), sh(1, '4h 3h')], 0);
    t.observe(bluff, [e(0, 'call', 20), e(-1, 'flop'), e(1, 'bet', 40), e(0, 'call', 40)], who);
    t.observe(result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 0), [e(1, 'call'), e(1, 'call'), e(1, 'call'), e(1, 'call'), e(1, 'call'), e(1, 'call')], who);
    const got = t.titles([
      { name: 'p0', net: 500 },
      { name: 'p1', net: -500 },
    ]);
    expect(got.map((x) => [x.title, x.name])).toEqual([
      ['诈唬王', 'p1'],
      ['天选之人', 'p0'],
      ['跟注站', 'p1'],
      ['大赢家', 'p0'],
      ['送财童子', 'p1'],
    ]);
    t.clear();
    expect(t.titles([])).toEqual([]);
  });
});

describe('嘲讽（0.3.0）', () => {
  it('短语表和房间允许的编号一样多；只能往后加', () => {
    expect(TAUNTS.length).toBe(TAUNT_COUNT);
    // 编号表：0–14 短语、15–26 表情、27–34 道具（kit 的 funItem，0.13.0）；催促炸弹是第 5 个道具
    expect(EMOTE_COUNT).toBe(35);
    expect(funItem(propId(TAUNT_COUNT, PROPS.indexOf('bomb')), TAUNT_COUNT)).toMatchObject({ kind: 'prop', index: 4 });
    expect(TAUNTS[0]).toBe('就这？');
    expect(TAUNTS[3]).toBe('谢谢老板');
  });
  it('顺手提示只看公开发生的事', () => {
    const say = (ids: number[]) => ids.map((i) => TAUNTS[i]);
    // 我下注别人都弃了
    expect(say(suggest(result([], 0, { byFold: true }), [e(0, 'bet', 40)], 0))).toEqual(['就这？', '谢谢老板']);
    // 别人下注我弃了：没什么好说的
    expect(suggest(result([], 1, { byFold: true }), [e(1, 'bet', 40)], 0)).toEqual([]);
    // 抓到亮出来的诈唬
    const caught = result([sh(0, 'Ad Qc'), sh(1, '4h 3h')], 0);
    expect(say(suggest(caught, [e(-1, 'flop'), e(1, 'bet', 40), e(0, 'call', 40)], 0))[0]).toBe('你在诈唬，我看出来了');
    // 被河牌逆转
    expect(say(suggest(result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 0), [], 1))[0]).toBe('运气而已，别骄傲');
    // 没亮牌的人（弃了的）不给
    expect(suggest(caught, [], 2)).toEqual([]);
  });
});

describe('战绩小结（0.3.0，平台 settle.stats）', () => {
  it('每个称号 id 在 public/titles.json 里有名字，文件不超过 32 KB；小结最坏也不超过 256 字节', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(new URL('../public/titles.json', import.meta.url), 'utf8');
    expect(raw.length).toBeLessThan(32 * 1024);
    const names = JSON.parse(raw) as Record<string, { name: string; desc: string }>;
    for (const id of Object.keys(TITLES)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
      expect(names[id]?.name, id).toBeTruthy();
    }
    const worst = settleStats({ hands: 99_999, wins: 99_999, best: 9_999_999, bluffs: 999, rivers: 999, quads: 9, calls: 9_999 }, 9_999_999, 1);
    expect(JSON.stringify(worst).length).toBeLessThanOrEqual(256);
    expect(worst.titles!.length).toBeLessThanOrEqual(5);
  });
  it('一手的数：投了多少按记录算（加注是加到多少、跟注是跟了多少），赢回的减投的是净赢；不在这一手的不记', () => {
    const r = result([sh(0, 'Kd 9d'), sh(1, 'Ac 3d')], 0, { pots: [{ amount: 480, winners: [{ seat: 0, won: 480 }] }] });
    const log = [e(0, 'sb', 10), e(1, 'bb', 20), e(0, 'raise', 60), e(1, 'call', 40), e(-1, 'flop'), e(1, 'bet', 100), e(0, 'call', 100), e(-1, 'turn'), e(-1, 'river'), e(0, 'bet', 80), e(1, 'call', 80)];
    expect(invested(log, 0, r)).toBe(240);
    const f = noteHand(NO_FAME, r, log, 0);
    expect(f).toMatchObject({ hands: 1, wins: 1, best: 240, rivers: 1, calls: 1 });
    expect(noteHand(NO_FAME, r, log, 1)).toMatchObject({ hands: 1, wins: 0, best: 0 });
    expect(noteHand(NO_FAME, r, log, 3)).toBe(NO_FAME);
    expect(settleStats(f, 0, 2000)).toEqual({ rounds: 1, wins: 1, best: 240, titles: ['river_god'], sum: { rivers: 1 } });
  });
});
