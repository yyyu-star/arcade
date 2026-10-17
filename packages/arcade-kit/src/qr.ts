/**
 * 最小的二维码编码器（0.15.0，分享卡右下角的码）：只做字节模式、纠错等级 M、版本 1–10（最多 213 字节，链接够用）。
 * 自己写而不引依赖：kit 没有运行时依赖，引一个包就进了每个游戏的 lockfile 和审阅范围；要的子集只有这么点，规范见 ISO/IEC 18004。
 * 纯函数，不碰 DOM；画在哪、画多大由 share.ts 决定。测试用解码库把码解回原文（test/qr.test.ts）。
 */

/** size × size 的格子，true 是深色。外面的留白（4 格）不在里面，画的时候自己留 */
export interface QrMatrix {
  size: number;
  version: number;
  dark: boolean[][];
}

/** 纠错 M：每个版本的 [每块纠错码字数, 第一组块数, 第一组每块数据码字数, 第二组块数]（第二组每块多 1 个数据码字） */
const BLOCKS_M: readonly (readonly [number, number, number, number])[] = [
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
];
export const QR_MAX_VERSION = BLOCKS_M.length;

/** 校正图形的中心坐标（版本 2 起） */
const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function dataCodewords(v: number): number {
  const [, b1, d1, b2] = BLOCKS_M[v - 1]!;
  return b1 * d1 + b2 * (d1 + 1);
}

/** 编码一段文字（UTF-8）。放不下（超过版本 10）返回 null，调用方就不画码 */
export function qrEncode(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) return null;
  const data = interleave(version, pack(bytes, version));
  return place(version, data);
}

/** 模式指示 0100（字节）+ 长度 + 数据 + 结束符 + 补齐 */
function pack(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const put = (val: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

// GF(256)，本原多项式 0x11d
function gfMul(a: number, b: number): number {
  let r = 0;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >>> 7) * 0x11d);
    r ^= ((b >>> i) & 1) * a;
  }
  return r & 0xff;
}

/** RS 生成多项式（最高次项系数 1 省略） */
function rsGenerator(degree: number): number[] {
  const g = new Array<number>(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j]!, root) ^ (j + 1 < degree ? g[j + 1]! : 0);
    }
    root = gfMul(root, 2);
  }
  return g;
}

function rsRemainder(data: readonly number[], gen: readonly number[]): number[] {
  const r = new Array<number>(gen.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    gen.forEach((c, i) => (r[i] = r[i]! ^ gfMul(c, f)));
  }
  return r;
}

/** 分块、算纠错码、交错排列 */
function interleave(v: number, data: readonly number[]): number[] {
  const [ec, b1, d1, b2] = BLOCKS_M[v - 1]!;
  const gen = rsGenerator(ec);
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = d1 + (i < b1 ? 0 : 1);
    blocks.push(data.slice(k, k + len));
    k += len;
  }
  const ecs = blocks.map((b) => rsRemainder(b, gen));
  const out: number[] = [];
  for (let i = 0; i <= d1; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]!);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 画功能图形、填数据、挑罚分最低的掩码 */
function place(version: number, data: readonly number[]): QrMatrix {
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean): void => {
    dark[y]![x] = on;
    fixed[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = ALIGN[version - 1]!;
  al.forEach((ay, i) =>
    al.forEach((ax, j) => {
      const last = al.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  formatBits(set, size, 0); // 先占位，挑好掩码再写真的
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, on);
      set(b, a, on);
    }
  }
  // 数据：从右下角起两列一组，蛇形上下走，跳过第 6 列（竖的定时线）
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y]![x] && i < data.length * 8) {
          dark[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < MASKS.length; m++) {
    const trial = dark.map((row, y) => row.map((on, x) => (fixed[y]![x] ? on : on !== MASKS[m]!(x, y))));
    formatBits((x, y, on) => (trial[y]![x] = on), size, m);
    const s = penalty(trial);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
  }
  const out = dark.map((row, y) => row.map((on, x) => (fixed[y]![x] ? on : on !== MASKS[best]!(x, y))));
  formatBits((x, y, on) => (out[y]![x] = on), size, best);
  return { size, version, dark: out };
}

/** 格式信息（纠错 M = 00 + 掩码号，BCH 后异或 0x5412），两份；外加那个固定的深色格 */
function formatBits(set: (x: number, y: number, on: boolean) => void, size: number, mask: number): void {
  const data = mask; // M 的两位是 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

/** 掩码罚分（规范的四条），越低越好扫 */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < size; y++) lines.push(m[y]!, m.map((row) => row[y]!));
  const finderLike = /10111010000|00001011101/g;
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // 外面算浅色：两头各补 4 个浅格再找像定位图形的那一串
    const s = `0000${line.map((on) => (on ? 1 : 0)).join('')}0000`;
    score += (s.match(finderLike)?.length ?? 0) * 40;
  }
  let darkCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) darkCount++;
      if (x + 1 < size && y + 1 < size) {
        const c = m[y]![x];
        if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) score += 3;
      }
    }
  }
  const total = size * size;
  score += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}
