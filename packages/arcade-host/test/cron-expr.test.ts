import { describe, expect, it } from 'vitest';
import { matches, nextFire, parseCron } from '../src/runtime/cron-expr.ts';

const t = (iso: string) => Date.parse(iso);

describe('cron 表达式（UTC）', () => {
  it('平台的每日清理 17 19 * * *', () => {
    const c = parseCron('17 19 * * *');
    expect(nextFire(c, t('2026-10-20T00:00:00Z'))).toBe(t('2026-10-20T19:17:00Z'));
    expect(nextFire(c, t('2026-10-20T19:17:00Z'))).toBe(t('2026-10-20T19:17:00Z'));
    expect(nextFire(c, t('2026-10-20T19:17:00.001Z'))).toBe(t('2026-10-21T19:17:00Z'));
  });
  it('步长、范围、列表、周日写 7', () => {
    expect(nextFire(parseCron('*/15 * * * *'), t('2026-10-20T10:16:00Z'))).toBe(t('2026-10-20T10:30:00Z'));
    expect(nextFire(parseCron('0 9-17/4 * * 1-5'), t('2026-10-24T00:00:00Z'))).toBe(t('2026-10-26T09:00:00Z'));
    expect(matches(parseCron('0 0 * * 7'), t('2026-10-25T00:00:00Z'))).toBe(true);
    expect(nextFire(parseCron('5,10 0 1 1 *'), t('2026-10-20T00:00:00Z'))).toBe(t('2027-01-01T00:05:00Z'));
  });
  it('日和周都限定时满足一个就跑', () => {
    const c = parseCron('0 0 13 * 5');
    expect(matches(c, t('2026-11-13T00:00:00Z'))).toBe(true); // 13 号（周五）
    expect(matches(c, t('2026-10-23T00:00:00Z'))).toBe(true); // 周五
    expect(matches(c, t('2026-10-13T00:00:00Z'))).toBe(true); // 13 号（周二）
    expect(matches(c, t('2026-10-14T00:00:00Z'))).toBe(false);
  });
  it('写错的直接报错，不存在的日子回 Infinity', () => {
    expect(() => parseCron('* * * *')).toThrow();
    expect(() => parseCron('60 * * * *')).toThrow();
    expect(() => parseCron('0 0 * JAN *')).toThrow();
    expect(nextFire(parseCron('0 0 30 2 *'), t('2026-10-20T00:00:00Z'))).toBe(Infinity);
  });
});
