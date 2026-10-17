/**
 * 随机数：sfc32（只用 Math.imul 和位运算，逐位确定），按用途分流（DESIGN.md 5.1）。
 * 每条流的种子由总种子和用途名哈希得到：一条流多用一次，不影响别的流（多掉一个铜钱不会改变下一张升级卡）。
 */

/** 字符串 + 种子 → 32 位哈希（FNV-1a 后再搅一下） */
export function hash32(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number, stream: string) {
    this.a = hash32(stream, seed);
    this.b = hash32(`${stream}#b`, seed);
    this.c = hash32(`${stream}#c`, seed);
    this.d = 1;
    // 先空转几次，让种子充分混开
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1) */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** [0, n) 的整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** 按概率 p 为真 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 存档、指纹用 */
  snapshot(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }
}
