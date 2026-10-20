/**
 * 斗地主每日挑战：日期按北京时间、种子只看日期、榜名、交分的回话怎么归类（假的 fetch，不起浏览器）。
 */
import { describe, expect, it } from 'vitest';
import { beijingDate, dailySubmitText, ddzDailyBoard, ddzDailySeed, submitDdzDaily } from '../src/view/ddz-daily.ts';

type Call = { url: string; body: unknown };

function fake(me: number, score: { status: number; body?: unknown }): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/me') return new Response(JSON.stringify(me === 200 ? { user: { id: 'u1' } } : { user: null }), { status: 200 });
    return new Response(score.body === undefined ? null : JSON.stringify(score.body), { status: score.status });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe('每日挑战', () => {
  it('日期按北京时间：UTC 16:00 已经是第二天', () => {
    expect(beijingDate(Date.UTC(2026, 9, 19, 15, 59))).toBe('2026-10-19');
    expect(beijingDate(Date.UTC(2026, 9, 19, 16, 0))).toBe('2026-10-20');
  });

  it('同一天同一个种子、榜名带子榜 ddz', () => {
    expect(ddzDailySeed('2026-10-20')).toBe(ddzDailySeed('2026-10-20'));
    expect(ddzDailySeed('2026-10-20')).not.toBe(ddzDailySeed('2026-10-21'));
    expect(ddzDailyBoard('2026-10-20')).toBe('daily-2026-10-20-ddz');
  });

  it('交分带账号和榜名，负分照交；平台回的最好成绩原样带回', async () => {
    const f = fake(200, { status: 200, body: { best: 12, improved: false } });
    const r = await submitDdzDaily('2026-10-20', -5, f.fetch);
    expect(r).toEqual({ kind: 'ok', best: 12, improved: false });
    expect(f.calls[1]).toEqual({ url: '/api/scores', body: { gameId: 'guandan', boardId: 'daily-2026-10-20-ddz', score: -5, userId: 'u1' } });
    expect(dailySubmitText(r, -5)).toContain('12');
  });

  it('没登录不交；429、5xx、别的拒绝分别归类', async () => {
    const out = fake(401, { status: 200 });
    expect(await submitDdzDaily('2026-10-20', 3, out.fetch)).toEqual({ kind: 'out' });
    expect(out.calls.length).toBe(1);
    expect((await submitDdzDaily('2026-10-20', 3, fake(200, { status: 429 }).fetch)).kind).toBe('limit');
    expect((await submitDdzDaily('2026-10-20', 3, fake(200, { status: 503 }).fetch)).kind).toBe('offline');
    expect(await submitDdzDaily('2026-10-20', 3, fake(200, { status: 422 }).fetch)).toEqual({ kind: 'bug', status: 422 });
  });
});
