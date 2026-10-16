/** 电脑说话（0.3.0 实打后）：推全下和跟全下分开说；同一个电脑同一句话至少隔 REPEAT_HANDS 手；每个性格每种时刻有几句可换 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINES, REPEAT_HANDS, Talk, type Moment } from '../src/view/talk.ts';

afterEach(() => vi.restoreAllMocks());

/** 顺序同 PERSONAS */
const LAOHAO = 2;
const JIANGHU = 5;

describe('电脑说话', () => {
  it('自己推全下和跟别人的全下说的不一样（老好推的时候不说"跟到底"）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const push = new Talk().line(1, LAOHAO, 1, 'allin', true);
    const call = new Talk().line(1, LAOHAO, 1, 'callAllin', true);
    expect(push).toBeTruthy();
    expect(call).toBeTruthy();
    expect(LINES[LAOHAO]!.allin).toContain(push);
    expect(LINES[LAOHAO]!.callAllin).toContain(call);
    expect(push).not.toBe(call);
    for (const x of LINES[LAOHAO]!.allin!) expect(LINES[LAOHAO]!.callAllin).not.toContain(x);
  });

  it(`同一个电脑同一句话隔 ${REPEAT_HANDS} 手才再说；有别的说法就换一句，没有就不说`, () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pool = LINES[JIANGHU]!.bluffWon!;
    const t = new Talk();
    const said: string[] = [];
    // 池里的话一手一句说完（每手说一次，都在 REPEAT_HANDS 之内），没重复
    for (let i = 0; i < pool.length; i++) said.push(t.line(3, JIANGHU, 1 + i, 'bluffWon', true)!);
    expect([...said].sort()).toEqual([...pool].sort());
    // 都刚说过：不说
    expect(t.line(3, JIANGHU, pool.length + 1, 'bluffWon', true)).toBeNull();
    // 别的座位不受影响
    expect(t.line(4, JIANGHU, pool.length + 1, 'bluffWon', true)).toBeTruthy();
    // 第一句过了 REPEAT_HANDS 手又能说
    expect(t.line(3, JIANGHU, 1 + REPEAT_HANDS, 'bluffWon', true)).toBe(said[0]);
  });

  it('每个性格每种定义过的时刻至少 2 句，每句不超过 12 个字，同一时刻内不重复', () => {
    expect(LINES).toHaveLength(10);
    for (const [i, lines] of LINES.entries()) {
      for (const m of Object.keys(lines) as Moment[]) {
        const pool = lines[m]!;
        expect(pool.length, `性格 ${i} 的 ${m}`).toBeGreaterThanOrEqual(2);
        expect(new Set(pool).size, `性格 ${i} 的 ${m} 有重复`).toBe(pool.length);
        for (const x of pool) expect([...x].length, x).toBeLessThanOrEqual(12);
      }
    }
  });

  it('bigLoss 能说出来，并且一手一个人最多一句', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const t = new Talk();
    expect(LINES[LAOHAO]!.bigLoss).toContain(t.line(1, LAOHAO, 1, 'bigLoss', true));
    expect(t.line(1, LAOHAO, 1, 'bigLoss', true)).toBeNull();
  });
});
