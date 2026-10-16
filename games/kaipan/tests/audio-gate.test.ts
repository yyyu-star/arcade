import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/platform/settings.ts';
import { audible, busLevels } from '../src/view/audio/logic.ts';
import type { AudioApi, Cue } from '../src/view/audio/types.ts';

// 引擎换成记录器：这里只测 index.ts 的闸门（解锁、静音、暂停、上下文状态），不真合成声音
const calls = vi.hoisted(() => ({ cues: [] as unknown[], moods: [] as string[], settings: [] as unknown[], created: 0 }));
vi.mock('../src/view/audio/engine.ts', () => ({
  AudioEngine: class {
    constructor() {
      calls.created++;
    }
    cue(c: unknown): void {
      calls.cues.push(c);
    }
    setMood(m: string): void {
      calls.moods.push(m);
    }
    applySettings(s: unknown): void {
      calls.settings.push(s);
    }
    pump(): void {}
    stats(): { players: number } {
      return { players: 0 };
    }
    dispose(): void {}
  },
}));
vi.mock('../src/view/audio/soundboard.ts', () => ({ mountSoundboard: () => null }));

class FakeCtx {
  static last: FakeCtx | null = null;
  state: string = 'suspended';
  currentTime = 0;
  constructor() {
    FakeCtx.last = this;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

const buy: Cue = { type: 'buy' };
const settings = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
let api: AudioApi;

async function setup(): Promise<void> {
  vi.resetModules();
  const m = await import('../src/view/audio/index.ts');
  api = m.createAudio();
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.cues.length = 0;
  calls.moods.length = 0;
  calls.settings.length = 0;
  calls.created = 0;
  FakeCtx.last = null;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx;
});
afterEach(() => {
  api?.dispose();
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe('音频闸门：设置、解锁、暂停', () => {
  it('静音或总音量 0：音量总线 master 为 0，且 cue 一律不发', async () => {
    expect(audible(settings({ muted: true }))).toBe(false);
    expect(audible(settings({ masterVolume: 0 }))).toBe(false);
    expect(audible(settings({ muted: false, masterVolume: 0.5 }))).toBe(true);
    expect(busLevels(settings({ muted: true })).master).toBe(0);
    await setup();
    api.applySettings(settings({ muted: true }));
    api.unlock();
    await flush();
    api.cue(buy);
    expect(calls.cues).toHaveLength(0);
    // 取消静音后恢复出声
    api.applySettings(settings({ muted: false }));
    api.cue(buy);
    expect(calls.cues).toHaveLength(1);
  });

  it('总音量、音效、音乐滑条改动都会传到引擎的增益总线', async () => {
    const a = busLevels(settings({ masterVolume: 1, sfxVolume: 1, musicVolume: 1, muted: false }));
    const b = busLevels(settings({ masterVolume: 0.5, sfxVolume: 0.25, musicVolume: 0, muted: false }));
    expect(b.master).toBeLessThan(a.master);
    expect(b.sfx).toBeLessThan(a.sfx);
    expect(b.music).toBe(0);
    await setup();
    api.unlock();
    await flush();
    const s = settings({ masterVolume: 0.3 });
    api.applySettings(s);
    expect(calls.settings.at(-1)).toBe(s);
  });

  it('首次交互（unlock）之前不创建上下文也不出声；解锁前的 cue 不会排队到解锁后', async () => {
    await setup();
    api.cue(buy);
    api.cue(buy);
    expect(FakeCtx.last).toBeNull();
    api.unlock();
    await flush();
    expect(calls.created).toBe(1);
    expect(calls.cues).toHaveLength(0);
    api.cue(buy);
    expect(calls.cues).toHaveLength(1);
  });

  it('解锁前设的情绪被记住，解锁后交给引擎', async () => {
    await setup();
    api.setMood('bull');
    api.unlock();
    await flush();
    expect(calls.moods).toContain('bull');
  });

  it('页面隐藏：挂起上下文、期间的 cue 丢弃；回来后恢复且不补播', async () => {
    await setup();
    api.unlock();
    await flush();
    api.setPaused(true);
    await flush();
    expect(FakeCtx.last?.state).toBe('suspended');
    api.cue(buy);
    api.cue(buy);
    expect(calls.cues).toHaveLength(0);
    api.setPaused(false);
    await flush();
    expect(FakeCtx.last?.state).toBe('running');
    expect(calls.cues).toHaveLength(0);
    api.cue(buy);
    expect(calls.cues).toHaveLength(1);
  });

  it('上下文被系统挂起（来电、切后台）时：尝试恢复，但这一声丢掉，不积压', async () => {
    await setup();
    api.unlock();
    await flush();
    if (FakeCtx.last) FakeCtx.last.state = 'interrupted';
    api.cue(buy);
    expect(calls.cues).toHaveLength(0);
    await flush();
    expect(FakeCtx.last?.state).toBe('running');
    api.cue(buy);
    expect(calls.cues).toHaveLength(1);
  });

  it('隐藏时解锁：保持挂起，不出声', async () => {
    await setup();
    api.setPaused(true);
    api.unlock();
    await flush();
    expect(FakeCtx.last?.state).toBe('suspended');
    api.cue(buy);
    expect(calls.cues).toHaveLength(0);
  });
});
