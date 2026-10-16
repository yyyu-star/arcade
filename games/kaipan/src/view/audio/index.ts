/**
 * 音频系统入口（实时播放）。接口见 types.ts。
 *
 * - unlock 之前不创建 AudioContext，所有 cue 直接丢弃；mood 与设置会被记住，unlock 后生效。
 * - 音乐调度器：每 25 ms 用 audioContext.currentTime 排未来 ~120 ms 的音符；只在已解锁、未暂停、非 silent 时工作。
 * - setPaused(true) 挂起 AudioContext 并停止调度；dispose 释放全部节点并关闭上下文。
 * - URL 带 soundboard=1 时挂出试听面板（soundboard.ts）。
 */
import { getSettings, type Settings } from '../../platform/settings.ts';
import { AudioEngine, type EngineStats } from './engine.ts';
import { audible, busLevels, shouldSchedule } from './logic.ts';
import { mountSoundboard } from './soundboard.ts';
import type { AudioApi, Cue, Mood } from './types.ts';

export type * from './types.ts';

/** 调度器心跳间隔（毫秒） */
const PUMP_MS = 25;

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** 音频异常只记一次警告，绝不抛到画面层（声音出错不应影响游戏）。 */
let warned = false;
function guard(what: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`音频异常（${what}），已忽略：`, err);
    }
  }
}

/** 实时音频：持有 AudioContext、引擎和调度计时器。 */
class RealtimeAudio {
  ctx: AudioContext | null = null;
  engine: AudioEngine | null = null;
  private settings: Settings;
  private mood: Mood = 'silent';
  private paused = false;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unmountBoard: (() => void) | null = null;

  constructor() {
    this.settings = getSettings();
  }

  readonly api: AudioApi = {
    unlock: () => guard('unlock', () => this.unlock()),
    cue: (c: Cue) => guard('cue', () => this.cue(c)),
    setMood: (m: Mood) => guard('setMood', () => this.setMood(m)),
    applySettings: (s: Settings) => guard('applySettings', () => this.applySettings(s)),
    setPaused: (p: boolean) => guard('setPaused', () => this.setPaused(p)),
    dispose: () => guard('dispose', () => this.dispose()),
  };

  get unlocked(): boolean {
    return this.engine !== null;
  }

  stats(): (EngineStats & { state: string }) | null {
    if (!this.engine || !this.ctx) return null;
    return { ...this.engine.stats(), state: this.ctx.state };
  }

  setBoard(unmount: () => void): void {
    this.unmountBoard = unmount;
  }

  private unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch (err) {
        console.warn('音频不可用：', err);
        return;
      }
      try {
        this.engine = new AudioEngine(this.ctx, busLevels(this.settings), () => performance.now() / 1000);
        this.engine.setMood(this.mood);
      } catch (err) {
        // 建图失败：关闭上下文，保持静音（下次 unlock 会重试）
        void this.ctx.close().catch(() => {});
        this.ctx = null;
        this.engine = null;
        throw err;
      }
    }
    if (this.paused) {
      void this.ctx.suspend().catch(() => {});
      return;
    }
    this.resume();
  }

  private resume(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    this.syncTimer();
  }

  private cue(c: Cue): void {
    if (!this.engine || !this.ctx || this.paused || this.disposed) return;
    // 静音 / 总音量 0：一点声音都不出（音乐的总线增益另由 applySettings 压到 0）
    if (!audible(this.settings)) return;
    // 某些浏览器会在切后台/来电后把上下文置为 suspended/interrupted：尝试恢复，但这一声丢掉。
    // 暂停中的上下文时钟不走，排进去的音效会在恢复的一瞬间全部一起响。
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().catch(() => {});
      return;
    }
    this.engine.cue(c);
  }

  private setMood(m: Mood): void {
    if (this.disposed) return;
    this.mood = m;
    this.engine?.setMood(m);
    this.syncTimer();
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.engine?.applySettings(s);
  }

  private setPaused(p: boolean): void {
    if (this.disposed || p === this.paused) return;
    this.paused = p;
    if (!this.ctx) return;
    if (p) {
      this.syncTimer();
      void this.ctx.suspend().catch(() => {});
    } else {
      this.resume();
    }
  }

  /** 按状态启停调度计时器；silent 时仍保持心跳直到淡出的播放器回收完毕。 */
  private syncTimer(): void {
    const want = this.engine !== null && !this.paused && !this.disposed && (shouldSchedule(true, false, this.mood) || this.engine.stats().players > 0);
    if (want && this.timer === null) {
      this.timer = setInterval(() => this.tick(), PUMP_MS);
    } else if (!want && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const e = this.engine;
    if (!e || !this.ctx) return;
    if (this.ctx.state === 'running') guard('pump', () => e.pump());
    if (this.mood === 'silent' && e.stats().players === 0) this.syncTimer();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.engine?.dispose();
    this.engine = null;
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.unmountBoard?.();
    this.unmountBoard = null;
  }
}

/** 创建音频系统。URL 带 soundboard=1 时同时挂出试听面板。 */
export function createAudio(): AudioApi {
  const rt = new RealtimeAudio();
  if (typeof location !== 'undefined' && typeof document !== 'undefined' && new URLSearchParams(location.search).get('soundboard') === '1') {
    const host = { api: rt.api, stats: () => rt.stats() };
    const unmount = mountSoundboard(host);
    if (unmount) rt.setBoard(unmount);
    // 试听模式下暴露给控制台与自动化测试
    (globalThis as { __kpAudio?: typeof host }).__kpAudio = host;
  }
  return rt.api;
}
