/**
 * 音效（src/view/sound.ts）在一个照 WebAudio 规矩查参数的假 AudioContext 上全放一遍：哪个都不许抛错。
 * 0.10.0 线上：全下那段噪声 0.5 秒正好等于噪声缓冲的长度，start 的偏移成了负数、抛 RangeError，牌局卡死。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Sound from '../src/view/sound.ts';

class Param {
  value = 0;
  setValueAtTime(v: number, t: number) {
    if (!Number.isFinite(v) || t < 0) throw new RangeError('setValueAtTime');
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.setValueAtTime(v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v === 0) throw new RangeError('exponentialRamp to 0');
    this.setValueAtTime(v, t);
  }
  setTargetAtTime() {}
}
class Node {
  frequency = new Param();
  gain = new Param();
  Q = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  type = '';
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
  // 照规范：偏移、时长不能是负的（start 同步抛 RangeError）
  start(when = 0, offset = 0, dur?: number) {
    if (when < 0 || offset < 0 || (dur !== undefined && dur < 0)) throw new RangeError(`start(${when}, ${offset}, ${dur})`);
    if (this.buffer && offset >= this.buffer.duration) throw new Error(`offset ${offset} past buffer ${this.buffer.duration}`);
    queueMicrotask(() => this.onended?.());
  }
  stop() {}
}
class FakeCtx {
  state = 'running';
  currentTime = 1;
  sampleRate = 8000;
  destination = new Node();
  createGain = () => new Node();
  createBiquadFilter = () => new Node();
  createOscillator = () => new Node();
  createBufferSource = () => new Node();
  createDynamicsCompressor = () => new Node();
  createBuffer = (_ch: number, len: number, rate: number) => ({ duration: len / rate, getChannelData: () => new Float32Array(len) });
  resume = async () => {};
}

let sound: typeof Sound;
beforeAll(async () => {
  vi.stubGlobal('window', { AudioContext: FakeCtx, addEventListener() {} });
  sound = await import('../src/view/sound.ts');
  sound.unlockAudio();
});
afterEach(() => vi.restoreAllMocks());

const ALL: Sound.Sfx[] = ['card', 'flip', 'chip', 'check', 'fold', 'win', 'turn', 'tick', 'taunt', 'banner', 'bigpot', 'tap', 'allin', 'lose', 'shuffle', 'collect', 'reveal', 'emote'];

describe('音效', () => {
  it('每个音效放 50 次（随机起点各不相同），参数都合规矩、不报错', async () => {
    const err = vi.spyOn(console, 'error');
    for (const s of ALL) {
      for (let i = 0; i < 50; i++) {
        sound.play(s);
        await Promise.resolve();
      }
    }
    expect(err).not.toHaveBeenCalled();
  });

  it('音效出了错也不往外抛（声音永远不打断牌局）', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Node.prototype, 'start').mockImplementation(() => {
      throw new RangeError('boom');
    });
    expect(() => sound.play('allin')).not.toThrow();
    expect(err).toHaveBeenCalled();
  });
});
