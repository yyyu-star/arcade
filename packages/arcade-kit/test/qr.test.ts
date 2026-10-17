/**
 * 二维码编码器（0.15.0）：画成像素后用解码库（jsQR，只在测试里用）解回原文。每个版本都过一遍，
 * 版本 7 起才有的版本信息、两组块交错（版本 8–10）、各个掩码都会被走到。
 */
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QR_MAX_VERSION, qrEncode, type QrMatrix } from '../src/qr.ts';

/** 每格 scale 像素、四周留 4 格白边，画成 RGBA */
function decode(m: QrMatrix, scale = 4): string | null {
  const n = (m.size + 8) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.dark[y]![x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * n + (x + 4) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(px, n, n)?.data ?? null;
}

/** 字节模式、纠错 M 每个版本最多放几个字节 */
const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

describe('二维码', () => {
  it('每个版本放满、放到最多那么长：都能解回原文，版本按最小的选', () => {
    expect(QR_MAX_VERSION).toBe(10);
    CAP.forEach((cap, i) => {
      for (const len of [cap, (CAP[i - 1] ?? 0) + 1]) {
        const text = `https://x.example/${'abcdefghij'.repeat(30)}`.slice(0, len);
        const m = qrEncode(text)!;
        expect(m.version, `${len} 字节`).toBe(i + 1);
        expect(m.size).toBe(m.version * 4 + 17);
        expect(decode(m), `${len} 字节`).toBe(text);
      }
    });
  });

  it('游戏链接（带路径和查询）、中文按 UTF-8', () => {
    for (const text of ['https://game.example.com/games/demo/?room=123456', 'https://例子.example/对局/42']) {
      expect(decode(qrEncode(text)!)).toBe(text);
    }
  });

  it('放不下（超过版本 10）返回 null，不抛', () => {
    expect(qrEncode('a'.repeat(213))).not.toBeNull();
    expect(qrEncode('a'.repeat(214))).toBeNull();
  });

  it('格式信息是规范表里纠错 M 的 8 个值之一，两份一致（解码器会纠正格式信息的错，只解码查不出来）', () => {
    const M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
    for (const len of [10, 40, 120, 200]) {
      const m = qrEncode('h'.repeat(len))!;
      const at = (x: number, y: number): number => (m.dark[y]![x] ? 1 : 0);
      let a = 0;
      let b = 0;
      for (let i = 0; i < 15; i++) {
        const p1 = i <= 5 ? at(8, i) : i === 6 ? at(8, 7) : i === 7 ? at(8, 8) : i === 8 ? at(7, 8) : at(14 - i, 8);
        const p2 = i < 8 ? at(m.size - 1 - i, 8) : at(8, m.size - 15 + i);
        a |= p1 << i;
        b |= p2 << i;
      }
      expect(M).toContain(a);
      expect(b).toBe(a);
      expect(at(8, m.size - 8)).toBe(1);
    }
  });

  it('版本 7–10 的版本信息是规范表里的值，两份一致', () => {
    const V: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
    [107, 140, 170, 200].forEach((len, k) => {
      const m = qrEncode('h'.repeat(len))!;
      expect(m.version).toBe(7 + k);
      let tr = 0;
      let bl = 0;
      for (let i = 0; i < 18; i++) {
        const a = m.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        tr |= (m.dark[b]![a] ? 1 : 0) << i;
        bl |= (m.dark[a]![b] ? 1 : 0) << i;
      }
      expect(tr).toBe(V[m.version]);
      expect(bl).toBe(tr);
    });
  });

  it('同样的输入同样的码（纯函数）', () => {
    expect(qrEncode('https://x.example/a')).toEqual(qrEncode('https://x.example/a'));
  });
});
