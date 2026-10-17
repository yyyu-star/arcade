/**
 * 规则核心用的数学：只用四则运算和精确的取整（DESIGN.md 5.1）。
 * IEEE 754 规定 + − × ÷ 必须正确舍入，所以在所有引擎上逐位一致；Math.sqrt 规范上允许近似实现，这里不用它。
 */
import { COS, DIR_N, SIN } from './dirs.ts';

const SQ_F64 = new Float64Array(1);
const SQ_U32 = new Uint32Array(SQ_F64.buffer);
/** 4 的 -k 次方、2 的 k 次方，k 从 -512 到 511：乘除 2 的幂是精确的 */
const SQ_SCALE = new Float64Array(1024);
const SQ_POW = new Float64Array(1024);
for (let k = -512; k < 512; k++) {
  let v = 1;
  let p = 1;
  for (let i = 0; i < Math.abs(k); i++) {
    v = k > 0 ? v / 4 : v * 4;
    p = k > 0 ? p * 2 : p / 2;
  }
  SQ_SCALE[k + 512] = v;
  SQ_POW[k + 512] = p;
}
/** 双精度的高 32 位在 Uint32Array 的哪一格（小端是 1） */
const SQ_HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;

/**
 * 开方：先按 4 的幂把 x 缩进 [1, 4)，再从 (1 + x) / 2 起做 6 次牛顿迭代（相对误差 < 1e-15）。
 * 步数固定，结果只取决于输入。x ≤ 0 时回 0。
 */
export function fsqrt(x: number): number {
  if (!(x > 0)) return 0;
  let s = 1;
  // 缩进 [1, 4)：直接读指数，免去循环（乘除 4 的幂是精确的，结果和循环版逐位相同）
  SQ_F64[0] = x;
  const e = ((SQ_U32[SQ_HI]! >>> 20) & 0x7ff) - 1023;
  if (e > -1000 && e < 1000) {
    const k = e >> 1;
    x *= SQ_SCALE[k + 512]!;
    s = SQ_POW[k + 512]!;
  } else {
    while (x >= 4) {
      x /= 4;
      s *= 2;
    }
    while (x < 1) {
      x *= 4;
      s /= 2;
    }
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
