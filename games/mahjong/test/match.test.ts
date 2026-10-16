import { describe, expect, test } from 'vitest';
import { snapshotBytes } from 'arcade-kit/game';
import { HIDDEN, sichuanXuezhan as XZ, view, type XzState } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { wallLeft } from '../src/core/table/index.ts';
import { runAuto } from '../src/game/driver.ts';
import type { SeatKind } from '../src/core/variants/types.ts';

const ALL_AI: SeatKind[] = ['ai', 'ai', 'ai', 'ai'];
const SETUP = { share: 2_000, base: 40, personas: [0, 1, 2, 4] };

/**
 * 视图里允许出现的字段（数组元素记作 []）。每一个都是这个座位本来就看得到的：桌面上的、自己的、或者结算公开的。
 * 加字段要在这里登记，并想清楚它是不是公开信息（DESIGN.md 5.4）：wallKinds、nextTile 这类"看起来是统计"的字段会直接漏牌
 */
const VIEW_FIELDS = new Set([
  // 桌面：玩法、规则、底分、第几局、庄、轮到谁、牌墙剩几张、换三张方向
  ...['variant', 'v', 'phase', 'opts', 'opts.rounds', 'opts.cap', 'opts.swap', 'opts.zimo', 'opts.transfer', 'share', 'base', 'round', 'dealer', 'turn', 'wall', 'swapDir'],
  // 每家：真人还是电脑、性格、筹码、定缺（定缺阶段别人的是 -1）、选好没有、副露（别人的暗杠牌面是 HIDDEN）、弃牌、张数、胡牌、亮出的手牌（只在胡了、一局结束或自己）、统计
  ...['seats', 'seats[]', 'seats[].kind', 'seats[].persona', 'seats[].chips', 'seats[].que', 'seats[].ready', 'seats[].count', 'seats[].hand', 'seats[].hand[]'],
  ...['seats[].melds', 'seats[].melds[]', 'seats[].melds[].kind', 'seats[].melds[].kan', 'seats[].melds[].from', 'seats[].melds[].tiles', 'seats[].melds[].tiles[]'],
  ...['seats[].river', 'seats[].river[]', 'seats[].river[].tile', 'seats[].river[].taken'],
  ...['seats[].won', 'seats[].won.order', 'seats[].won.tile', 'seats[].won.from', 'seats[].won.fan', 'seats[].won.capped', 'seats[].won.hand', 'seats[].won.hand[]'],
  ...['seats[].won.items', 'seats[].won.items[]', 'seats[].won.items[].id', 'seats[].won.items[].fan', 'seats[].won.items[].n'],
  ...['seats[].stats', 'seats[].stats.rounds', 'seats[].stats.wins', 'seats[].stats.zimo', 'seats[].stats.pao', 'seats[].stats.gangs', 'seats[].stats.maxFan', 'seats[].stats.best', 'seats[].stats.flags', 'seats[].stats.flags[]'],
  // 自己：座位、手牌、刚摸的、换三张换出换进的、这一场的状态
  ...['me', 'me.seat', 'me.hand', 'me.hand[]', 'me.drawn', 'me.swapOut', 'me.swapOut[]', 'me.swapIn', 'me.swapIn[]', 'me.tune', 'me.tune.mood', 'me.tune.soft'],
  // 自己现在能做什么
  ...['prompt', 'prompt.swap', 'prompt.que', 'prompt.discard', 'prompt.discard[]', 'prompt.zimo', 'prompt.kan', 'prompt.kan[]', 'prompt.claim', 'prompt.claim.w', 'prompt.claim.opts', 'prompt.claim.opts[]'],
  // 正在被声明的那张牌（公开）、我答过没有
  ...['claim', 'claim.id', 'claim.tile', 'claim.from', 'claim.rob', 'claim.answered'],
  // 这一步的事件（别人摸的牌、暗杠的牌是 HIDDEN）
  ...['events', 'events[]', 'events[].e', 'events[].round', 'events[].dealer', 'events[].dir', 'events[].seat', 'events[].tile', 'events[].tail', 'events[].from', 'events[].kan'],
  ...['events[].fan', 'events[].items', 'events[].items[]', 'events[].items[].id', 'events[].items[].fan', 'events[].items[].n', 'events[].rob', 'events[].end'],
  ...['events[].pays', 'events[].pays[]', 'events[].pays[].kind', 'events[].pays[].from', 'events[].pays[].to', 'events[].pays[].amount', 'events[].pays[].ref'],
  // 这一局的钱怎么走的、每局小结、一场的结果
  ...['ledger', 'ledger[]', 'ledger[].kind', 'ledger[].from', 'ledger[].to', 'ledger[].amount', 'ledger[].ref'],
  ...['history', 'history[]', 'history[].round', 'history[].dealer', 'history[].net', 'history[].net[]', 'history[].end'],
  ...['history[].wins', 'history[].wins[]', 'history[].wins[].seat', 'history[].wins[].from', 'history[].wins[].fan', 'history[].wins[].items', 'history[].wins[].items[]', 'history[].wins[].items[].id', 'history[].wins[].items[].fan', 'history[].wins[].items[].n'],
  ...['result', 'result.seats', 'result.seats[]', 'result.seats[].chips', 'result.seats[].net', 'result.seats[].stats', 'result.seats[].stats.rounds', 'result.seats[].stats.wins', 'result.seats[].stats.best'],
  ...['result.seats[].stats.max', 'result.seats[].stats.max.xz_fan', 'result.seats[].stats.sum', 'result.seats[].stats.sum.xz_gang', 'result.seats[].stats.sum.xz_zimo', 'result.seats[].stats.titles', 'result.seats[].stats.titles[]'],
]);

/** 视图里不在白名单上的字段（排好序、去重） */
function unknownFields(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: unknown, path: string): void => {
    if (path && !VIEW_FIELDS.has(path)) out.add(path);
    if (Array.isArray(x)) x.forEach((y) => walk(y, `${path}[]`));
    else if (x !== null && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, path ? `${path}.${k}` : k);
  };
  walk(v, '');
  return [...out].sort();
}

/** 全是电脑打完一场；每一步检查：牌一张不多一张不少、筹码总数不变 */
export function playMatch(key: number[], opts = XZ.defaults, check?: (s: XzState) => void): XzState {
  let s = XZ.begin(key, opts, ALL_AI, SETUP) as XzState;
  for (let guard = 0; guard < 100; guard++) {
    for (const step of runAuto(XZ, s, ALL_AI, 2_000)) {
      check?.(step.state as XzState);
      s = step.state as XzState;
    }
    if (XZ.over(s)) return s;
    expect(XZ.pause(s)).not.toBeNull();
    s = XZ.resume(s);
  }
  throw new Error('match did not finish');
}

function tilesConserved(s: XzState): void {
  if (s.phase === 'over' || s.phase === 'end') return;
  let n = wallLeft(s.wall);
  for (const p of s.players) {
    n += p.hand.length + p.melds.reduce((a, m) => a + m.tiles.length, 0) + p.river.filter((r) => !r.taken).length;
    // 胡了的人手里含胡的那张；点炮的那张在弃牌里记成 taken，所以不重复算
  }
  // 一炮多响：同一张算进了几个胡家的手里，多出来的减掉
  const extra = s.players.filter((p) => p.won && p.won.from !== null).length;
  const groups = new Map<string, number>();
  for (const p of s.players) if (p.won && p.won.from !== null) groups.set(`${p.won.from}-${p.won.tile}`, (groups.get(`${p.won.from}-${p.won.tile}`) ?? 0) + 1);
  const dup = [...groups.values()].reduce((a, x) => a + x - 1, 0);
  expect(n - dup, `phase ${s.phase} extra ${extra}`).toBe(108);
}

describe('一整场（全是电脑）', () => {
  test('打得完，筹码总数不变，牌不多不少', () => {
    for (let i = 0; i < 20; i++) {
      const s = playMatch([i, 7, 7, 7, 7, 7, 7, 7], XZ.defaults, (x) => {
        expect(x.chips.reduce((a, b) => a + b, 0)).toBe(8_000);
        expect(x.chips.every((c) => c >= 0)).toBe(true);
        tilesConserved(x);
      });
      expect(s.phase).toBe('over');
      expect(s.history.length).toBeGreaterThan(0);
    }
  });

  test('同一把密钥、同一串操作，结果完全一样', () => {
    const a = playMatch([9, 9, 9, 9, 1, 2, 3, 4]);
    const b = playMatch([9, 9, 9, 9, 1, 2, 3, 4]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = playMatch([9, 9, 9, 9, 1, 2, 3, 5]);
    expect(JSON.stringify(c.history)).not.toBe(JSON.stringify(a.history));
  });

  test('各种选项都能打完', () => {
    for (const o of [
      { rounds: 4, cap: 3, swap: false, zimo: 'fan', transfer: false },
      { rounds: 16, cap: 5, swap: true, zimo: 'di', transfer: true },
    ] as const) {
      const s = playMatch([3, 1, 4, 1, 5, 9, 2, 6], o);
      expect(s.phase).toBe('over');
    }
  });

  test('视图字段白名单：每一步、每个座位（含旁观）的视图只有名单里的字段；别人的暗牌、摸的牌都是暗的；快照不超过 8 KB', () => {
    let max = 0;
    let views = 0;
    for (const [key, opts] of [
      [[2, 7, 1, 8, 2, 8, 1, 8], XZ.defaults],
      [[3, 1, 4, 1, 5, 9, 2, 6], { rounds: 4, cap: 3, swap: false, zimo: 'fan', transfer: false }],
    ] as const) {
      playMatch([...key], opts, (s) => {
        const reveal = s.phase === 'end' || s.phase === 'over';
        for (const seat of [0, 1, 2, 3, null]) {
          const v = view(s, seat);
          views++;
          expect(unknownFields(v), `座位 ${seat} 阶段 ${s.phase}`).toEqual([]);
          if (seat === null) expect([v.me, v.prompt]).toEqual([null, null]);
          v.seats.forEach((x, i) => {
            if (i === seat || reveal || s.players[i]!.won) return;
            expect(x.hand).toBeNull();
            for (const m of x.melds) if (m.kan === 'concealed') expect(m.tiles.every((t) => t === HIDDEN)).toBe(true);
          });
          for (const e of v.events) if (e.e === 'draw' && e.seat !== seat) expect(e.tile).toBe(HIDDEN);
        }
        if (s.phase === 'claim' || s.phase === 'turn') max = Math.max(max, snapshotBytes(XZ as never, s));
      });
    }
    expect(views).toBeGreaterThan(1_000);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(8_192);
  });

  test('白名单抓得住多出来的字段（阳性对照）', () => {
    const v = view(playMatch([1, 1, 2, 3, 5, 8, 13, 21]), 0);
    expect(unknownFields(v)).toEqual([]);
    expect(unknownFields({ ...v, wallKinds: [1, 2] })).toEqual(['wallKinds', 'wallKinds[]']);
    expect(unknownFields({ ...v, me: { ...v.me!, nextTile: 5 } })).toEqual(['me.nextTile']);
    expect(unknownFields({ ...v, seats: v.seats.map((x) => ({ ...x, tenpai: [3] })) })).toEqual(['seats[].tenpai', 'seats[].tenpai[]']);
  });
});
