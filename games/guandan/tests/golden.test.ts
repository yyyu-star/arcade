/**
 * 掼蛋金样（牌馆重构 ①a，docs/doudizhu.md 第 2 节）：现在的规则、电脑、房间规则层、实盘账、称号颁奖复盘分享卡的数据，在固定种子上逐字节不变。
 * 哈希不一致说明掼蛋的行为变了：重构（①b）里不许出现；有意改行为的 PR 用 `node tools/golden.ts --write` 重生成，并在说明里写为什么。
 * 找第一个不同的地方：改前改后各跑一次 `node tools/golden.ts --dump <场景> <文件>`，diff 两个文件。
 */
import { describe, expect, it } from 'vitest';
import golden from './golden/guandan.json';
import { runScenario, scenarios, type Outcome } from './golden-scenarios.ts';

const want = golden as Record<string, { hash: string; items: number }>;
const got = new Map<string, Outcome>();

describe('掼蛋金样：行为逐字节不变', () => {
  const list = scenarios();
  it('场景表和金样文件一一对应', () => {
    expect(list.map((s) => s.name).sort()).toEqual(Object.keys(want).sort());
  });
  for (const sc of list) {
    it(sc.name, () => {
      const o = runScenario(sc);
      got.set(sc.name, o);
      expect({ hash: o.hash, items: o.items }).toEqual(want[sc.name]);
    });
  }
  it('覆盖面：进贡、抗贡、还贡、一局打完、再来一场、换人、带入被拒后重新带入、关房结回都走到了', () => {
    const sum = (k: string) => [...got.values()].reduce((n, o) => n + (o.seen[k] ?? 0), 0);
    for (const k of ['ev:tribute', 'ev:antiTribute', 'ev:returnCard', 'ev:gameOver', 'resume', 'seated', 'buyin', 'settled', 'closing', 'share', 'awards', 'solo']) {
      expect(sum(k), k).toBeGreaterThan(0);
    }
    // 每局都回放过、而且和直接打的终局一样（replay 记的是比较结果，哈希里锁着 true）
    expect(sum('replay')).toBe(list.filter((s) => s.name.startsWith('solo-')).length);
  });
});
