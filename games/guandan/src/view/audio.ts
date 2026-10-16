// 掼蛋音效与背景音：全部用 WebAudio 现场合成，不依赖任何音频文件（省包体、不用管版权与加载）。
// 所有入口都对"没有 AudioContext / 创建失败 / 未解锁"安全空转，且绝不往 console 打错误（冒烟要求控制台零报错）。

import { playFunSound, type FunPhase, type PropId } from 'arcade-kit/fun';

export type Sfx =
  | 'click' | 'select' | 'deselect' | 'deal' | 'play' | 'playBig' | 'pass' | 'bomb' | 'jokerBomb'
  | 'tribute' | 'stamp' | 'levelUp' | 'win' | 'lose' | 'turn' | 'error' | 'jiefeng'
  | 'collect' | 'call' | 'gong'
  | 'tick' | 'taunt' | 'sticker';

export interface AudioSettings { volume: number; music: boolean; muted: boolean }
export type Mood = 'title' | 'table' | 'tense' | 'off';

/** 一次音效播放的上下文：t 为起始时间，k 为音高倍率，v 为相对音量 */
interface Ctx { c: AudioContext; out: AudioNode; t: number; k: number; v: number; noise: AudioBuffer }

const semi = (n: number): number => Math.pow(2, n / 12);
// 中式五声音阶（宫商角徵羽）相对宫音的半音数
const PENTA = [0, 2, 4, 7, 9];
/** 把"音阶级数"（可跨八度）转成相对 C 的半音数 */
const scaleSemi = (deg: number): number => {
  const oct = Math.floor(deg / 5);
  return oct * 12 + (PENTA[((deg % 5) + 5) % 5] ?? 0);
};
const C4 = 261.6256;

// ---------- 合成积木 ----------

interface ToneOpt {
  type?: OscillatorType; slideTo?: number; attack?: number; lp?: number; delay?: number;
}

/** 单个音：振荡器 → 包络 → 可选低通 → 输出；播完自动断开，避免节点泄漏 */
function tone(a: Ctx, freq: number, dur: number, vol: number, o: ToneOpt = {}): void {
  const { c } = a;
  const t = a.t + (o.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq * a.k, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo * a.k), t + dur);
  const atk = o.attack ?? 0.004;
  const peak = Math.max(0.0002, vol * a.v);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let tail: AudioNode = g;
  osc.connect(g);
  let lp: BiquadFilterNode | null = null;
  if (o.lp) {
    lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp;
    g.connect(lp);
    tail = lp;
  }
  tail.connect(a.out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  osc.onended = () => { osc.disconnect(); g.disconnect(); lp?.disconnect(); };
}

interface NoiseOpt { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; attack?: number; delay?: number }

/** 滤波噪声：用于拍桌、爆裂、嗖声、镲 */
function noise(a: Ctx, dur: number, vol: number, o: NoiseOpt = {}): void {
  const { c } = a;
  const t = a.t + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = a.noise;
  src.loop = true; // 噪声缓冲只有 1 秒，较长的爆炸需要循环
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  const f0 = o.f0 ?? 2000;
  f.frequency.setValueAtTime(f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
  f.Q.value = o.q ?? 0.7;
  const g = c.createGain();
  const atk = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol * a.v), t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(a.out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.03);
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
}

/** 一串音符（相对 C5 的音阶级数），用于升级/胜利/接风等 */
function run(a: Ctx, degs: number[], gap: number, dur: number, vol: number, base = C4 * 2, delay = 0): void {
  degs.forEach((d, i) => {
    const f = base * semi(scaleSemi(d));
    tone(a, f, dur, vol, { type: 'triangle', delay: delay + i * gap, lp: 5000 });
    tone(a, f * 2, dur * 0.6, vol * 0.25, { type: 'sine', delay: delay + i * gap });
  });
}

const thump = (a: Ctx, f: number, to: number, dur: number, vol: number, delay = 0): void =>
  tone(a, f, dur, vol, { slideTo: to, delay, attack: 0.002 });

/** 金属/铜器泛音：频率比不成整数，才像锣镲而不是音符；每个泛音衰减各异，尾巴更真 */
const metal = (a: Ctx, base: number, ratios: number[], dur: number, vol: number, delay = 0, attack = 0.004): void =>
  ratios.forEach((r, i) => tone(a, base * r, dur / (1 + i * 0.35), vol / (1 + i * 0.5), { delay, attack }));

/** 木鱼/木块的"嗒"：短促的带通噪声(敲击) + 两个不成整数比的快衰减正弦(木腔共鸣) */
const wood = (a: Ctx, f: number, vol: number, delay = 0): void => {
  noise(a, 0.025, vol * 0.7, { type: 'bandpass', f0: f * 2.2, q: 2, delay });
  tone(a, f, 0.07, vol, { delay, slideTo: f * 0.85, attack: 0.001 });
  tone(a, f * 1.58, 0.04, vol * 0.4, { delay, attack: 0.001 });
};

// ---------- 各音效配方 ----------

const RECIPES: Record<Sfx, (a: Ctx) => void> = {
  // 轻敲木头的"嗒"
  click: (a) => wood(a, 980, 0.2),
  // 选牌很轻很短，取消略低，听感上一升一降
  select: (a) => tone(a, 1500, 0.035, 0.11),
  deselect: (a) => tone(a, 1050, 0.035, 0.09),
  // 发牌要连发 27 次，所以极短极轻：三个错开几毫秒的高频噪声小点，像牌沿拨过的"唰"
  deal: (a) => {
    [0, 0.011, 0.023].forEach((d, i) => noise(a, 0.014, 0.07 - i * 0.015, { type: 'bandpass', f0: 4200 + i * 600, q: 1.6, delay: d }));
    tone(a, 520, 0.025, 0.03, { slideTo: 380, delay: 0.02 });
  },
  // 牌拍在木桌上："啪"的高频脆响 + 桌面的闷响 + 木腔共鸣
  play: (a) => {
    noise(a, 0.03, 0.34, { type: 'bandpass', f0: 2600, f1: 1400, q: 0.9 });
    noise(a, 0.07, 0.22, { type: 'lowpass', f0: 1500, f1: 400 });
    thump(a, 170, 80, 0.1, 0.42);
    tone(a, 310, 0.05, 0.1, { type: 'triangle', slideTo: 260 });
  },
  // 大牌：在 play 上叠更深的低频和一点上方的亮度
  playBig: (a) => {
    noise(a, 0.1, 0.42, { type: 'lowpass', f0: 2600, f1: 500 });
    thump(a, 200, 85, 0.12, 0.4);
    thump(a, 110, 50, 0.24, 0.5);
    tone(a, 523, 0.22, 0.12, { type: 'triangle', lp: 3000, delay: 0.02 });
  },
  pass: (a) => tone(a, 220, 0.26, 0.26, { slideTo: 196, attack: 0.03, lp: 900 }),
  // 炸弹：低频冲击 + 噪声爆裂 + 锯齿隆隆，尾巴是一串渐隐的金属泛音，全长 ≤ 1.2s
  bomb: (a) => {
    thump(a, 130, 32, 1.0, 0.75);
    noise(a, 0.7, 0.55, { type: 'lowpass', f0: 5000, f1: 180 });
    tone(a, 70, 0.6, 0.18, { type: 'sawtooth', slideTo: 40, lp: 300 });
    noise(a, 0.2, 0.22, { type: 'highpass', f0: 3000, delay: 0.01 });
    metal(a, 330, [1, 1.51, 2.37, 3.12], 1.1, 0.1, 0.04);
  },
  // 天王炸：更大更长的冲击，金属尾巴更长，再叠一层上扬的泛音
  jokerBomb: (a) => {
    thump(a, 150, 30, 1.5, 0.8);
    noise(a, 1.0, 0.55, { type: 'lowpass', f0: 6000, f1: 150 });
    tone(a, 65, 1.0, 0.2, { type: 'sawtooth', slideTo: 35, lp: 300 });
    metal(a, 280, [1, 1.51, 2.37, 3.12, 4.2], 1.7, 0.12, 0.05);
    [880, 1320, 1760, 2217].forEach((f, i) => {
      tone(a, f, 1.4, 0.07, { slideTo: f * 1.5, delay: 0.15 + i * 0.05, attack: 0.05 });
    });
    noise(a, 1.2, 0.12, { type: 'highpass', f0: 6000, delay: 0.1, attack: 0.1 });
  },
  // 嗖 + 叮
  tribute: (a) => {
    noise(a, 0.25, 0.16, { type: 'bandpass', f0: 500, f1: 3500, q: 1.5, attack: 0.1 });
    tone(a, 1568, 0.4, 0.2, { delay: 0.22 });
    tone(a, 3136, 0.2, 0.05, { delay: 0.22 });
  },
  // 盖章：闷而有力的一击，随后一声温暖的小铜铃(宫+徵)，有"喜"的意思
  stamp: (a) => {
    thump(a, 95, 45, 0.32, 0.7);
    noise(a, 0.08, 0.3, { type: 'lowpass', f0: 700 });
    tone(a, C4 * 2, 0.5, 0.1, { type: 'triangle', delay: 0.06, lp: 3500 });
    tone(a, C4 * 3, 0.4, 0.06, { delay: 0.06 });
  },
  // 升级：五声音阶上行，每音带一缕铃音，末音收在一个温暖的和音上
  levelUp: (a) => {
    run(a, [0, 1, 2, 3, 4, 5], 0.09, 0.4, 0.2);
    [0, 1, 2, 3, 4, 5].forEach((d, i) => tone(a, C4 * 4 * semi(scaleSemi(d)), 0.18, 0.035, { delay: i * 0.09 + 0.01 }));
    [5, 7].forEach((d) => tone(a, C4 * 2 * semi(scaleSemi(d)), 0.7, 0.1, { type: 'triangle', delay: 0.55, lp: 3500 }));
  },
  // 胜利：五声音阶乐句 + 长和弦 + 锣/镲，全长 ≈ 2.6s
  win: (a) => {
    run(a, [0, 2, 3, 4, 3, 4, 5], 0.15, 0.3, 0.2);
    [5, 3, 2].forEach((d) => tone(a, C4 * 2 * semi(scaleSemi(d)), 1.3, 0.14, { type: 'triangle', delay: 1.1, lp: 4000 }));
    // 锣：几个不成整数比的泛音，缓慢衰减
    [180, 283, 391, 527].forEach((f, i) => tone(a, f, 2.2 - i * 0.3, 0.12 / (i + 1) ** 0.5, { delay: 1.1, attack: 0.01 }));
    noise(a, 1.2, 0.14, { type: 'highpass', f0: 5500, delay: 1.1, attack: 0.01 });
  },
  // 失败：缓慢下行、低通后很柔
  lose: (a) => {
    [4, 3, 2, 0].forEach((d, i) =>
      tone(a, C4 * semi(scaleSemi(d)), 0.5, 0.2, { type: 'triangle', delay: i * 0.22, attack: 0.02, lp: 1200 }));
  },
  // 轮到自己：清楚的一声"叮——"（0.6.0 起更亮、更长，后台标签页另有标题闪）
  turn: (a) => {
    tone(a, 1568, 0.5, 0.24, { type: 'sine' });
    tone(a, 3136, 0.3, 0.07, { type: 'sine' });
    tone(a, 2093, 0.35, 0.12, { type: 'triangle', delay: 0.09 });
  },
  error: (a) => tone(a, 150, 0.13, 0.25, { type: 'sawtooth', slideTo: 120, lp: 600 }),
  // 接风：两声轻快上扬，尾音带一点铃响，喜气
  jiefeng: (a) => {
    run(a, [3, 5], 0.11, 0.25, 0.22);
    tone(a, C4 * 4 * semi(scaleSemi(5)), 0.35, 0.05, { delay: 0.11 });
    tone(a, C4 * semi(scaleSemi(3)), 0.3, 0.08, { type: 'triangle', lp: 900 });
  },
  // 收墩：一把牌扫过桌面的"唰"，很轻，只为听出一墩到头了
  collect: (a) => {
    noise(a, 0.22, 0.14, { type: 'bandpass', f0: 1800, f1: 700, q: 0.9, attack: 0.04 });
    tone(a, 300, 0.08, 0.06, { slideTo: 220, delay: 0.12 });
  },
  // 报牌：木鱼两响（急的时候调用方升调）
  call: (a) => {
    tone(a, 820, 0.09, 0.3, { type: 'triangle', lp: 2400 });
    tone(a, 820, 0.09, 0.26, { type: 'triangle', lp: 2400, delay: 0.13 });
  },
  // 头游：一声锣。先一记低沉的"嗡"，再是不成整数比的泛音缓慢衰减，起音略微上漂像敲击后的颤动
  gong: (a) => {
    tone(a, 150, 1.8, 0.2, { slideTo: 138, attack: 0.012, lp: 600 });
    [210, 331, 457, 612, 905].forEach((f, i) =>
      tone(a, f, 1.7 - i * 0.22, 0.15 / (i + 1) ** 0.5, { attack: 0.006, slideTo: f * 0.985 }));
    noise(a, 0.4, 0.09, { type: 'bandpass', f0: 3800, q: 0.8, attack: 0.004 });
  },
  // 读秒：木鱼的"笃"(调用方最后两秒升调)
  tick: (a) => wood(a, 1050, 0.26),
  // 嘲讽：弹簧"嘣～"一声，调皮
  taunt: (a) => {
    tone(a, 330, 0.32, 0.22, { type: 'triangle', slideTo: 520 });
    tone(a, 520, 0.18, 0.12, { type: 'sine', slideTo: 300, delay: 0.16 });
  },
  // 表情：轻轻"啵"
  sticker: (a) => tone(a, 600, 0.09, 0.22, { slideTo: 1100 }),
};

/** 大动静出来时背景音让一让（毫秒）：炸弹、天王炸、升级、胜负、头游 */
const DUCK: Partial<Record<Sfx, number>> = { bomb: 1600, jokerBomb: 2400, levelUp: 1200, win: 2800, lose: 2000, gong: 1400 };

// ---------- 主类 ----------

const MUSIC_LEVEL = 0.25;
const MOOD_LEVEL: Record<Exclude<Mood, 'off'>, number> = { title: 1, table: 0.7, tense: 0.85 };

export class GameAudio {
  readonly log: { t: number; name: Sfx }[] = [];
  private ctx: AudioContext | null = null;
  private failed = false;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private moodGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private settings: AudioSettings = { volume: 0.8, music: true, muted: false };
  private last = new Map<Sfx, number>();
  private mood: Mood = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private padNodes: { stop: () => void } | null = null;
  private nextT = 0;
  private step = 0;
  private deg = 7; // 当前旋律所在音阶级数
  private paused = false;

  private ensure(): AudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    try {
      const AC: typeof AudioContext | undefined = typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
      if (!AC) { this.failed = true; return null; }
      const c = new AC();
      const master = c.createGain();
      const comp = c.createDynamicsCompressor();
      // 压得偏狠一点：叠加的爆炸、锣镲也不会削波
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 8;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      const sfxBus = c.createGain();
      const musicBus = c.createGain();
      musicBus.gain.value = MUSIC_LEVEL; // 背景音远低于音效，不抢戏
      const moodGain = c.createGain();
      moodGain.gain.value = 0;
      sfxBus.connect(master);
      moodGain.connect(musicBus);
      musicBus.connect(master);
      master.connect(comp);
      comp.connect(c.destination);
      // 1 秒白噪声，所有噪声类音效共用
      const len = Math.floor(c.sampleRate);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = c; this.master = master; this.sfxBus = sfxBus;
      this.musicBus = musicBus; this.moodGain = moodGain; this.noiseBuf = buf;
      this.applyGain();
      return c;
    } catch {
      this.failed = true; // 创建失败就永久静音，别反复重试
      this.ctx = null;
      return null;
    }
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    const s = this.settings;
    const v = s.muted ? 0 : Math.min(1, Math.max(0, s.volume));
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  unlock(): void {
    try {
      const c = this.ensure();
      if (c && c.state === 'suspended' && !this.paused) void c.resume().catch(() => {});
      if (c) this.syncMusic();
    } catch { /* 静默 */ }
  }

  apply(s: AudioSettings): void {
    this.settings = { ...s };
    this.applyGain();
    this.syncMusic();
  }

  sfx(name: Sfx, opts?: { pitch?: number; vol?: number }): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.log.push({ t: now, name });
    if (this.log.length > 100) this.log.shift();
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.noiseBuf || this.paused || c.state !== 'running') return;
    if (this.settings.muted || this.settings.volume <= 0) return;
    // 同一种音 30ms 内只响一次：发牌连发时避免瞬间堆叠
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < 30) return;
    this.last.set(name, now);
    const duck = DUCK[name];
    if (duck && this.musicBus) {
      // 先压到两成再慢慢回来，音效才"站在前面"
      const g = this.musicBus.gain;
      const t = c.currentTime;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(MUSIC_LEVEL * 0.2, t, 0.03);
      g.setTargetAtTime(MUSIC_LEVEL, t + duck / 1000, 0.4);
    }
    try {
      RECIPES[name]({
        c, out: this.sfxBus, t: c.currentTime + 0.005, k: semi(opts?.pitch ?? 0),
        v: Math.min(1, Math.max(0, opts?.vol ?? 1)), noise: this.noiseBuf,
      });
    } catch { /* 音效失败不能影响游戏 */ }
  }

  /** 互动道具的声音（arcade-kit/fun 的配方，走音效总线、跟着静音） */
  fun(prop: PropId, phase: FunPhase): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || this.paused || c.state !== 'running' || this.settings.muted || this.settings.volume <= 0) return;
    playFunSound(c, this.sfxBus, prop, phase);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    const c = this.ctx;
    if (!c) return;
    try {
      if (paused) void c.suspend().catch(() => {});
      else void c.resume().catch(() => {});
    } catch { /* 静默 */ }
  }

  music(mood: Mood): void {
    this.mood = mood;
    this.syncMusic();
  }

  // ---------- 背景音 ----------

  private syncMusic(): void {
    const c = this.ctx;
    if (!c || !this.moodGain) return; // 未解锁：记住 mood，解锁后再起
    const want = this.settings.music && this.mood !== 'off' ? this.mood : 'off';
    const g = this.moodGain.gain;
    if (want === 'off') {
      g.cancelScheduledValues(c.currentTime);
      g.setTargetAtTime(0, c.currentTime, 0.4); // 淡出
      this.stopSchedulerLater();
      return;
    }
    g.cancelScheduledValues(c.currentTime);
    g.setTargetAtTime(MOOD_LEVEL[want], c.currentTime, 0.5); // 淡入或情绪间平滑过渡
    if (this.timer === null) {
      this.nextT = c.currentTime + 0.1;
      this.step = 0;
      this.startPad(c);
      this.timer = setInterval(() => this.tick(), 25);
    }
  }

  private stopSchedulerLater(): void {
    if (this.timer === null) return;
    const timer = this.timer;
    const pad = this.padNodes;
    this.timer = null; this.padNodes = null;
    clearInterval(timer);
    // 等淡出完再停低音 pad，否则会听到突然截断
    setTimeout(() => pad?.stop(), 2200);
  }

  /** 很轻的持续低音 pad：宫音与五度，微失谐产生缓慢拍频 */
  private startPad(c: AudioContext): void {
    if (!this.moodGain) return;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.09, c.currentTime, 1.5);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    lp.connect(g); g.connect(this.moodGain);
    const oscs = [C4 / 4, C4 / 4 * 1.004, C4 / 4 * 1.5].map((f, i) => {
      const o = c.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return o;
    });
    this.padNodes = {
      stop: () => {
        try {
          oscs.forEach((o) => { o.stop(); o.disconnect(); });
          lp.disconnect(); g.disconnect();
        } catch { /* 已停 */ }
      },
    };
  }

  private tick(): void {
    const c = this.ctx;
    if (!c || !this.moodGain || this.paused) return;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05; // 挂起恢复后别疯狂补拍
    const tense = this.mood === 'tense';
    const eighth = 60 / (tense ? 88 : 74) / 2;
    while (this.nextT < c.currentTime + 0.12) {
      this.scheduleStep(c, this.nextT, tense);
      this.nextT += eighth;
      this.step++;
    }
  }

  private scheduleStep(c: AudioContext, t: number, tense: boolean): void {
    if (!this.noiseBuf || !this.moodGain) return;
    const a: Ctx = { c, out: this.moodGain, t, k: 1, v: 1, noise: this.noiseBuf };
    const s = this.step;
    // 旋律：在五声音阶上做小幅随机游走，偶尔休止；每小节首拍强一点
    const rest = Math.random() < (tense ? 0.25 : 0.4) && s % 8 !== 0;
    if (!rest) {
      const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)] ?? 0;
      this.deg = Math.min(11, Math.max(2, this.deg + move));
      pluck(a, C4 * semi(scaleSemi(this.deg)), s % 8 === 0 ? 0.22 : 0.15);
    }
    // 低音：每小节首拍一个宫音，第五拍一个徵音，像拨低弦
    if (s % 8 === 0) pluck(a, C4 / 2, 0.2);
    else if (s % 8 === 4) pluck(a, C4 / 2 * semi(7), 0.14);
    // 紧张：每拍一下轻低音鼓
    if (tense && s % 2 === 0) {
      tone(a, 90, 0.16, 0.4, { slideTo: 45, attack: 0.002 });
    }
  }
}

/** 古筝式拨弦：锯齿波经快速闭合的低通，加一个八度泛音，衰减自然 */
function pluck(a: Ctx, freq: number, vol: number): void {
  const { c, t } = a;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 7, t);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(lp); lp.connect(g); g.connect(a.out);
  o.start(t);
  o.stop(t + 1.15);
  o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
}

export const audio: GameAudio = new GameAudio();
