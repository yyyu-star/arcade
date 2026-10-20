/**
 * 实盘结回带的战绩小结（src/stake/stats.ts，平台 0.10.0 docs/platform-backend.md 5.10）和称号的名字（public/titles.json）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, interpret, parseCards, type DealResult, type PlayRecord } from '../src/variants/guandan/core/index.ts';
import { stakeBegin, stakeDeal, stakeSeated, stakeSettled, type StakeTable } from '../src/variants/guandan/net/stake.ts';
import { testKey } from '../src/variants/guandan/net/rules.ts';
import { emptyTally, statsOf, tallyDeal } from '../src/variants/guandan/stake/stats.ts';
import { TITLE_INFO } from '../src/variants/guandan/stake/titles.ts';

const play = (s: string) => interpret(parseCards(s), 2, DEFAULT_OPTIONS)[0]!;
const BOMB = play('♠9 ♥9 ♣9 ♦9');
const deal = (dealNo: number, order: number[], doubleDown = false): DealResult => ({
  dealNo, order, winnerTeam: order[0]! % 2, up: 3, doubleDown, levelsBefore: [2, 2], levelsAfter: [5, 2], aFailedTeam: -1, aResetTeam: -1,
});

describe('战绩小结', () => {
  it('副数、赢的副数、最大一把赢多少筹码、称号、炸弹和头游累计；JSON 后不超过 256 字节', () => {
    const hist: PlayRecord[] = [{ seat: 0, play: BOMB }, { seat: 0, play: BOMB }, { seat: 1, play: null }];
    let t = emptyTally();
    t = tallyDeal(t, deal(1, [0, 2, 1, 3], true), hist, 0, 'mid');
    t = tallyDeal(t, deal(2, [1, 3, 0, 2]), [], 0, 'mid');
    t = tallyDeal(t, deal(3, [0, 1, 2, 3]), [], 0, 'mid');
    const s = statsOf(t);
    // 双下 +3 分 × 每分 500
    expect(s).toEqual({ rounds: 3, wins: 2, best: 1500, titles: ['bomb_maniac', 'best_partner', 'first_king'], sum: { bombs: 2, firsts: 2 } });
    // 平台的格式：称号 id、自定义 key
    for (const id of s.titles!) expect(id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
    for (const k of Object.keys(s.sum!)) expect(k).toMatch(/^[a-z][a-z0-9_]{0,15}$/);
    // 最坏情况：5 个最长的称号、上千副，也在 256 字节以内
    const worst = statsOf({ rounds: 1000, wins: 1000, best: 200_000 * 3, bombs: 99_999, firsts: 9_999, titles: Object.keys(TITLE_INFO) as never });
    expect(JSON.stringify(worst).length).toBeLessThanOrEqual(256);
  });

  it('好友房：只记到账以后的副；结回的 effect 带上小结，中途离开的按那一刻的', () => {
    const KEY = testKey('stats');
    let t: StakeTable = stakeBegin(KEY, 'small', ['human', 'human', 'ai', 'ai']);
    t = stakeSettled(t, `${t.ref}-s0-in`, { ok: true });
    // 1 号的带入还没到账：这一副不记他的
    t = stakeDeal(t, deal(1, [0, 2, 1, 3]), 'dealEnd', []);
    t = stakeSettled(t, `${t.ref}-s1-in`, { ok: true });
    t = stakeDeal(t, deal(2, [1, 3, 0, 2]), 'dealEnd', []);
    // 同一副再来一次不重复记
    expect(stakeDeal(t, deal(2, [1, 3, 0, 2]), 'dealEnd', [])).toBe(t);
    t = stakeSeated(t, 0, 'ai');
    const out0 = t.pending.find((e) => e.id === `${t.ref}-s0-out`)!;
    expect(out0.stats).toMatchObject({ rounds: 2, wins: 1, best: 300 });
    expect(t.tally![1]).toMatchObject({ rounds: 1, wins: 1 });
  });
});

describe('称号的名字（public/titles.json，平台的称号墙读）', () => {
  it('和代码里的 TITLE_INFO 一样；每个都有 name、desc；不超过 32 KB', () => {
    const raw = readFileSync(fileURLToPath(new URL('../public/titles.json', import.meta.url)), 'utf8');
    expect(raw.length).toBeLessThan(32 * 1024);
    expect(JSON.parse(raw)).toEqual(TITLE_INFO);
    for (const [id, v] of Object.entries(TITLE_INFO)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
      expect(v.name.length).toBeGreaterThanOrEqual(2);
      expect(v.name.length).toBeLessThanOrEqual(6);
    }
  });
});
