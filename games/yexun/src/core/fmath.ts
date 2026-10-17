/**
 * 规则核心用的数学：只用四则运算和精确的取整（DESIGN.md 5.1）。
 * IEEE 754 规定 + − × ÷ 必须正确舍入，所以在所有引擎上逐位一致；Math.sqrt 规范上允许近似实现，这里不用它。
 */
import { COS, DIR_N, SIN } from './dirs.ts';

/**
 * 开方：先按 4 的幂把 x 缩进 [1, 4)，再从 (1 + x) / 2 起做 6 次牛顿迭代（相对误差 < 1e-15）。
 * 步数固定，结果只取决于输入。x ≤ 0 时回 0。
 */
export function fsqrt(x: number): number {
  if (!(x > 0)) return 0;
  let s = 1;
  while (x >= 4) {
    x /= 4;
    s *= 2;
  }
  while (x < 1) {
    x *= 4;
    s /= 2;
  }
  let y = (1 + x) / 2;
  y = (y + x / y) / 2;
  y = (y + x / y) / 2;
  y = (y + x / y) / 2;
  y = (y + x / y) / 2;
  y = (y + x / y) / 2;
  y = (y + x / y) / 2;
  return y * s;
}

/** 距离 */
export function dist(dx: number, dy: number): number {
  return fsqrt(dx * dx + dy * dy);
}

/** 摇杆的 32 向：1–32 对应方向表里的 0、8、16……（0 = 不动） */
export const INPUT_DIRS = 32;
export function inputCos(d: number): number {
  return d === 0 ? 0 : COS[((d - 1) * (DIR_N / INPUT_DIRS)) & (DIR_N - 1)]!;
}
export function inputSin(d: number): number {
  return d === 0 ? 0 : SIN[((d - 1) * (DIR_N / INPUT_DIRS)) & (DIR_N - 1)]!;
}

/** 方向表下标（0–255，可以越界，自动取模） */
export function dcos(i: number): number {
  return COS[i & (DIR_N - 1)]!;
}
export function dsin(i: number): number {
  return SIN[i & (DIR_N - 1)]!;
}

/**
 * 把向量量化成最近的方向表下标（不用 atan2）：在 256 个方向里找点积最大的。
 * 只在开局、换目标这类低频的地方用；热路径直接用归一化向量。
 */
export function dirIndex(dx: number, dy: number): number {
  let best = 0;
  let bv = -Infinity;
  for (let i = 0; i < DIR_N; i += 1) {
    const v = COS[i]! * dx + SIN[i]! * dy;
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
