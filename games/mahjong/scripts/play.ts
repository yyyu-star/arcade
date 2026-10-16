/**
 * 模拟器共用（sim.ts、stake-room.ts、strength.ts）：打一整场，电脑座位照线上的打法（性格 + 状态 + 场地 + 局面），
 * 代理玩家座位用固定参数（不浮动、不看局面），顺便数每个座位的打法指标。
 *
 * 代理玩家（DESIGN.md 4.1）：
 * - PLAYER"普通玩家"：简单合理的打法，防守、做牌都中等，偶尔打错；
 * - NOVICE"新手"：常打错、不防守、见碰就碰。
 */
import { AIS } from '../src/ai/index.ts';
import type { Persona } from '../src/ai/personas.ts';
import { fixedStyle } from '../src/ai/style.ts';
import { decideAs } from '../src/ai/xuezhan.ts';
import { sichuanXuezhan as XZ, type XzAction, type XzState, type XzView } from '../src/core/variants/sichuan-xuezhan/index.ts';
import type { Tune, VariantAi } from '../src/core/variants/types.ts';
import { baseOf } from '../src/game/stakes.ts';

const base = { kanLove: 400, temper: 0, swing: 0, tempo: 1_000, talk: 0 };
export const PLAYER: Persona = { ...base, name: '普通玩家', style: '', defense: 500, greed: 300, pon: 500, slip: 40, reads: 300, level: 1 };
export const NOVICE: Persona = { ...base, name: '新手', style: '', defense: 100, greed: 150, kanLove: 600, pon: 750, slip: 200, reads: 0, level: 0 };

const KINDS = ['ai', 'ai', 'ai', 'ai'] as const;

export interface Played {
  s: XzState;
  /** 每个座位：碰了几次、做了几次决定 */
  pons: number[];
  moves: number[];
}

/** 打一整场。proxies：这些座位用代理玩家的固定参数；kinds 只影响"手软放过真人小胡"（代理玩家当真人） */
export function playMatch(key: number[], share: number, personas: number[], tunes: Tune[], proxies: ReadonlyMap<number, Persona> = new Map()): Played {
  const ai = AIS[XZ.id]! as VariantAi<XzView, XzAction>;
  const proxyAi = new Map([...proxies].map(([seat, p]) => [seat, { decide: (v: XzView) => decideAs(v, fixedStyle(p)) } as VariantAi<XzView, XzAction>]));
  const kinds = KINDS.map((k, i) => (proxies.has(i) ? 'human' : k));
  let s = XZ.begin(key, XZ.defaults, kinds, { share, base: baseOf(share), personas, tunes }) as XzState;
  const pons = [0, 0, 0, 0];
  const moves = [0, 0, 0, 0];
  for (let n = 0; n < 20_000; n++) {
    if (XZ.over(s)) break;
    const act = XZ.actors(s);
    if (!act || !act.seats.length) {
      s = XZ.resume(s);
      continue;
    }
    const seat = act.seats[0]!;
    const a = XZ.auto(s, seat, proxyAi.get(seat) ?? ai);
    const next = XZ.apply(s, seat, a);
    if ('error' in next) throw new Error(`move rejected: ${next.error}`);
    moves[seat]!++;
    for (const e of (next as XzState).events) if (e.e === 'pon') pons[e.seat]!++;
    s = next as XzState;
  }
  return { s, pons, moves };
}

/** 一个 0–999 之间的整数序列的分位数 */
export const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]!;

/** 均值和标准误 */
export function meanSe(xs: number[]): { mean: number; se: number } {
  const n = xs.length;
  const mean = xs.reduce((a, x) => a + x, 0) / n;
  const v = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / Math.max(1, n - 1);
  return { mean, se: Math.sqrt(v / n) };
}

export const signed = (x: number, d = 3): string => (x >= 0 ? '+' : '') + x.toFixed(d);
