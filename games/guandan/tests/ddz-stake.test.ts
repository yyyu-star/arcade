/**
 * 斗地主单机实盘（src/variants/doudizhu/stake、src/view/ddz-stake.ts）：规则里的数、ref、存档、结回的重试、带入、打完一场的记账。
 * 不起浏览器：假的 localStorage 和 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_ID } from '../src/core/stake.ts';
import { decideDdz, viewDdz } from '../src/variants/doudizhu/index.ts';
import * as gd from '../src/variants/guandan/stake/index.ts';
import {
  DDZ_SOLO_BOTS, DDZ_SOLO_OPTS, POINTS_PER_SHARE, SOLO_DEALS, TIER_IDS, TIERS, isSoloRef, payout, pointValue, soloOp, soloRef, soloRefTier, validSoloResult,
} from '../src/variants/doudizhu/stake/index.ts';
import {
  DdzStakeSession, buyinDdzStake, clearDdzStakeSave, ddzStakeLeft, loadDdzStakeSave, refundDdzStake, settleDdzStake, strayDdzStake, type DdzStakeSave,
} from '../src/view/ddz-stake.ts';
import { KEYS } from '../src/view/store.ts';

const REF = `solo-ddz-mid-${'cd'.repeat(16)}`;
const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

type Answer = { status?: number; body?: unknown } | Error;
function fakeFetch(answers: Answer[]): typeof fetch & { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const a = answers.shift() ?? { status: 500 };
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  }) as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}
const noSleep = async (): Promise<void> => undefined;

function started(seed = 'ddz-stake-t'): DdzStakeSession {
  return DdzStakeSession.start({ userId: 'u1', ref: REF, tier: 'mid', until: Date.now() + 3_600_000 }, seed);
}

/** 我也让电脑（普通档）代打，推到一场结束；stopAfter 副数后停 */
function playOut(ses: DdzStakeSession, stopAfter = Infinity): void {
  for (let guard = 0; guard < 60_000 && !ses.over && ses.dealsDone < stopAfter; guard++) {
    const s = ses.state;
    if (s.phase === 'dealEnd') {
      expect(ses.apply({ type: 'next' }).error).toBeNull();
      continue;
    }
    const a = decideDdz(viewDdz(s, s.turn), 'normal', `t${guard}`)!;
    expect(ses.apply(a).error).toBeNull();
  }
}

describe('规则里的数', () => {
  it('每分是一份的 1/40，各档整除；结回在 0 到 2 份之间', () => {
    expect(POINTS_PER_SHARE).toBe(40);
    for (const t of TIER_IDS) {
      expect(TIERS[t] % POINTS_PER_SHARE).toBe(0);
      expect(payout(t, 0)).toBe(TIERS[t]);
      expect(payout(t, 40)).toBe(2 * TIERS[t]);
      expect(payout(t, -40)).toBe(0);
    }
    expect(pointValue('mid')).toBe(250);
    expect(payout('small', 8)).toBe(2_400);
  });

  it('实盘选项：8 副、每副封顶 24、累计 ±40 结束', () => {
    expect(DDZ_SOLO_OPTS).toEqual({ deals: 8, dealCap: 24, cap: 40 });
    expect(SOLO_DEALS).toBe(8);
  });

  it('结回的数：|分| ≤ 40、0–8 副、整数、一副最多动 48 分', () => {
    expect(validSoloResult(40, 8)).toBe(true);
    expect(validSoloResult(-40, 1)).toBe(true);
    expect(validSoloResult(0, 0)).toBe(true);
    expect(validSoloResult(41, 8)).toBe(false);
    expect(validSoloResult(1, 9)).toBe(false);
    expect(validSoloResult(1, 0)).toBe(false);
    expect(validSoloResult(1.5, 2)).toBe(false);
    expect(validSoloResult('3', 2)).toBe(false);
    expect(validSoloResult(3, undefined)).toBe(false);
  });

  it('ref：带 ddz 标记和档位，满足钱包格式，和掼蛋的互不匹配', () => {
    const hex = 'ab'.repeat(16);
    for (const t of TIER_IDS) {
      const ref = soloRef(t, hex);
      expect(ref).toBe(`solo-ddz-${t}-${hex}`);
      expect(isSoloRef(ref)).toBe(true);
      expect(soloRefTier(ref)).toBe(t);
      expect(gd.isSoloRef(ref)).toBe(false);
      expect(isSoloRef(gd.soloRef(t, hex))).toBe(false);
      for (const k of ['in', 'out', 'refund'] as const) expect(soloOp(ref, k)).toMatch(WALLET_ID);
    }
    expect(() => soloRef('mid', 'xyz')).toThrow();
    expect(soloRefTier(`solo-mid-${hex}`)).toBeNull();
  });

  it('单机每档的电脑：四档都有两个座位的档位', () => {
    for (const t of TIER_IDS) expect(DDZ_SOLO_BOTS[t]).toHaveLength(2);
  });

  it('掼蛋从通用层再导出，导出名和值不变', () => {
    expect(gd.TIERS).toBe(TIERS);
    expect(gd.WALLET_ID).toBe(WALLET_ID);
    expect(gd.POINTS_PER_SHARE).toBe(20);
    expect(gd.pointValue('mid')).toBe(500);
  });
});

describe('实盘牌局', () => {
  it('开局就存进 guandan.ddz.stake，不碰 guandan.ddz.save 和战绩；规则是实盘选项', () => {
    const ses = started();
    expect(mem.has(KEYS.ddzStake)).toBe(true);
    expect(mem.has(KEYS.ddzSave)).toBe(false);
    expect(loadDdzStakeSave()!.ref).toBe(REF);
    expect(ses.state.opts).toEqual(DDZ_SOLO_OPTS);
  });

  it('打到一场结束：记下要结的数（我的累计、副数），不写战绩；结束后不再接受动作', () => {
    const ses = started();
    playOut(ses);
    const s = loadDdzStakeSave()!;
    expect(s.settle).toEqual({ points: ses.state.scores[0], deals: ses.state.results.length });
    expect(s.settle!.deals).toBeLessThanOrEqual(SOLO_DEALS);
    expect(Math.abs(s.settle!.points)).toBeLessThanOrEqual(40);
    expect(ses.state.scores.reduce((a, b) => a + b, 0)).toBe(0);
    expect(mem.has(KEYS.ddzStats)).toBe(false);
    expect(ses.apply({ type: 'next' }).error).not.toBeNull();
    expect(validSoloResult(s.settle!.points, s.settle!.deals)).toBe(true);
  }, 120_000);

  it('打了几副后现在结算：只算打完的副数；从存档接着打是同一个 ref、同样的分', () => {
    const ses = started();
    playOut(ses, 2);
    expect(ses.dealsDone).toBe(2);
    expect(ses.over).toBe(false);
    expect(ddzStakeLeft(loadDdzStakeSave()!)).toEqual({ dealsDone: 2, points: ses.points });
    const again = DdzStakeSession.fromSave(loadDdzStakeSave()!);
    expect(again.points).toBe(ses.points);
    again.finish();
    expect(loadDdzStakeSave()!.settle).toEqual({ points: ses.points, deals: 2 });
    expect(DdzStakeSession.fromSave(loadDdzStakeSave()!).over).toBe(true);
  }, 120_000);

  it('电脑按档位出牌：1、2 号有动作，我（0 号）走基类', () => {
    const ses = started();
    const seat = ses.state.turn;
    if (seat !== 0) expect(ses.botAction(seat)).not.toBeNull();
    expect(ses.isBot(1)).toBe(true);
    expect(ses.isBot(0)).toBe(false);
  });
});

describe('结回、放弃', () => {
  const over = (): DdzStakeSave => {
    const ses = started();
    ses.finish();
    return loadDdzStakeSave()!;
  };

  it('成功：请求带 variant ddz、不带战绩小结，删存档，带回 credited / 钱包余额', async () => {
    const s = over();
    const f = fakeFetch([{ body: { ok: true, credited: 10_000, capped: 0, wallet: { balance: 18_000, stakes: [] } } }]);
    expect(await settleDdzStake(s, { fetcher: f, sleep: noSleep })).toEqual({ kind: 'done', points: 0, credited: 10_000, capped: 0, balance: 18_000 });
    expect(f.calls[0]).toEqual({ url: '/games/guandan/api/stake/settle', body: { variant: 'ddz', ref: REF, tier: 'mid', points: 0, deals: 0 } });
    expect(loadDdzStakeSave()).toBeNull();
  });

  it('钱包忙：同样的请求（同一个 op）重试，最后成功就算成功；一直忙存档留着', async () => {
    const s = over();
    const f = fakeFetch([{ body: { ok: false, error: 'internal' } }, new Error('net'), { body: { ok: true, credited: 1, wallet: { balance: 5, stakes: [] } } }]);
    expect((await settleDdzStake(s, { fetcher: f, sleep: noSleep })).kind).toBe('done');
    expect(f.calls).toHaveLength(3);
    expect(new Set(f.calls.map((c) => JSON.stringify(c.body))).size).toBe(1);
    const t = over();
    const g = fakeFetch([{ body: { ok: false, error: 'busy' } }, { status: 503 }, { body: { ok: false, error: 'internal' } }]);
    expect(await settleDdzStake(t, { fetcher: g, sleep: noSleep })).toEqual({ kind: 'later' });
    expect(loadDdzStakeSave()?.ref).toBe(REF);
  });

  it('已经结过（no_stake）、过期退回过（expired）算办完，不重试；别的错误存档留着', async () => {
    for (const error of ['no_stake', 'expired'] as const) {
      const s = over();
      const f = fakeFetch([{ body: { ok: false, error } }]);
      expect((await settleDdzStake(s, { fetcher: f, sleep: noSleep })).kind).toBe(error === 'no_stake' ? 'gone' : 'expired');
      expect(f.calls).toHaveLength(1);
      expect(loadDdzStakeSave()).toBeNull();
    }
    const s = over();
    expect(await settleDdzStake(s, { fetcher: fakeFetch([{ status: 400 }]), sleep: noSleep })).toEqual({ kind: 'failed', error: 'bad_request' });
    expect(loadDdzStakeSave()).not.toBeNull();
  });

  it('没记 settle 就不结', async () => {
    started();
    const f = fakeFetch([]);
    expect(await settleDdzStake(loadDdzStakeSave()!, { fetcher: f })).toEqual({ kind: 'failed', error: 'not_over' });
    expect(f.calls).toHaveLength(0);
  });

  it('放弃：退回那一份，带 variant ddz；忙就重试', async () => {
    started();
    const f = fakeFetch([{ body: { ok: false, error: 'busy' } }, { body: { ok: true, credited: 10_000, wallet: { balance: 10_000, stakes: [] } } }]);
    expect((await refundDdzStake(loadDdzStakeSave()!, { fetcher: f, sleep: noSleep })).kind).toBe('done');
    expect(f.calls.map((c) => c.body)).toEqual([{ variant: 'ddz', ref: REF }, { variant: 'ddz', ref: REF }]);
    expect(loadDdzStakeSave()).toBeNull();
  });

  it('删存档只删同一场', () => {
    started();
    clearDdzStakeSave(`solo-ddz-mid-${'ff'.repeat(16)}`);
    expect(loadDdzStakeSave()).not.toBeNull();
    clearDdzStakeSave(REF);
    expect(loadDdzStakeSave()).toBeNull();
  });
});

describe('进场', () => {
  it('先问是谁，再带入（variant ddz）；成功开一场并存档', async () => {
    const ref = `solo-ddz-small-${'ab'.repeat(16)}`;
    const f = fakeFetch([{ body: { user: { id: 'u9' } } }, { body: { ok: true, ref, tier: 'small', share: 2000, until: Date.now() + 1000, wallet: { balance: 8000, stakes: [] } } }]);
    const r = await buyinDdzStake('small', f);
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.url)).toEqual(['/api/me', '/games/guandan/api/stake/buyin']);
    expect(f.calls[1]!.body).toEqual({ variant: 'ddz', tier: 'small' });
    expect(loadDdzStakeSave()).toMatchObject({ userId: 'u9', ref, tier: 'small', share: 2000 });
  });

  it('被拒原样带回；没登录不带入；回来的不是斗地主 ref 不开局', async () => {
    const f = fakeFetch([{ body: { user: { id: 'u9' } } }, { body: { ok: false, error: 'no_funds', wallet: { balance: 100, stakes: [] } } }]);
    expect(await buyinDdzStake('big', f)).toEqual({ ok: false, error: 'no_funds', wallet: { balance: 100, stakes: [] } });
    const g = fakeFetch([{ body: { user: null } }]);
    expect(await buyinDdzStake('big', g)).toEqual({ ok: false, error: 'login' });
    expect(g.calls).toHaveLength(1);
    const h = fakeFetch([{ body: { user: { id: 'u9' } } }, { body: { ok: true, ref: `solo-mid-${'ab'.repeat(16)}`, until: Date.now() + 1000 } }]);
    expect(await buyinDdzStake('mid', h)).toEqual({ ok: false, error: 'other' });
    expect(loadDdzStakeSave()).toBeNull();
  });

  it('钱包里有一份、本机没有它的存档：斗地主单机的能退回，掼蛋的不归这里', () => {
    const w = (ref: string) => ({ balance: 0, stakes: [{ game: 'guandan', ref, tier: 'mid' }] });
    expect(strayDdzStake(w(REF), null)).toEqual({ ref: REF, solo: true });
    expect(strayDdzStake(w(`solo-mid-${'ab'.repeat(16)}`), null)).toBeNull();
    expect(strayDdzStake(w(REF), started().stake)).toBeNull();
  });
});
