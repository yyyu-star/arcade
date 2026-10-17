// 《夜巡》音效：全部用 WebAudio 现场合成，不带任何音频文件。
// 总线：音效 -> sfxIn、音乐 -> musicIn，两路汇到同一个压缩器再到出口。
// 几百只怪同时挨打时压缩器兜住峰值，不会爆音；发声节点数和同帧同名次数另有硬上限（见 play）。

export type SfxName =
  | 'sword' | 'talisman' | 'coins' | 'flysword' | 'mirror' | 'thunder' | 'bell' | 'fire'
  | 'rope' | 'petal' | 'shieldUp' | 'shieldBreak' | 'crane'
  | 'hit' | 'crit' | 'kill' | 'pickup' | 'coin' | 'heal' | 'levelup' | 'choose' | 'evolve'
  | 'chest' | 'hurt' | 'heartbeat' | 'elite' | 'boss' | 'bossStomp' | 'bossSummon' | 'bossBreath'
  | 'gateOpen' | 'extract' | 'dawn' | 'death' | 'click';

const SETTINGS_KEY = 'yexun.settings';

/** 读设置里的一个布尔字段；存储不可用、内容损坏都当没有，用默认值。 */
export function readFlag(field: string, def: boolean): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const o: unknown = JSON.parse(raw);
    if (o && typeof o === 'object') {
      const v = (o as Record<string, unknown>)[field];
      if (typeof v === 'boolean') return v;
    }
  } catch { /* 隐私模式等：照常运行 */ }
  return def;
}

/** 写一个字段：先读出整个对象合并再写回，不能覆盖同一个 key 里别人的字段。 */
export function writeFlag(field: string, value: boolean): void {
  try {
    let o: Record<string, unknown> = {};
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) o = p as Record<string, unknown>;
    }
    o[field] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(o));
  } catch { /* 写不进去就算了，只是下次不记得 */ }
}

// ---------- 音频环境 ----------
let ctx: AudioContext | null = null;
let sfxIn: GainNode | null = null;
let musicIn: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let failed = false;
const readyHooks: Array<() => void> = [];

function ensureCtx(): AudioContext | null {
  if (ctx || failed) return ctx;
  try {
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) { failed = true; return null; }
    const c = new Ctor();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    const master = c.createGain();
    master.gain.value = 0.8;
    comp.connect(master);
    master.connect(c.destination);
    sfxIn = c.createGain();
    sfxIn.gain.value = 0.9;
    sfxIn.connect(comp);
    musicIn = c.createGain();
    musicIn.gain.value = 0.5; // 音乐比音效低
    musicIn.connect(comp);
    // 噪声缓冲只建一次（2 秒单声道），所有噪声音色随机偏移复用
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    ctx = c;
    return c;
  } catch {
    failed = true;
    return null;
  }
}

/** 给 music.ts 用：拿到共用的上下文、音乐总线和噪声缓冲；还没解锁时返回 null。 */
export function audioBus(): { ctx: AudioContext; musicIn: GainNode; noise: AudioBuffer } | null {
  if (!ctx || !musicIn || !noiseBuf) return null;
  return { ctx, musicIn, noise: noiseBuf };
}

/** 上下文可用时回调（已可用则立刻调）。音乐在用户手势之前不创建上下文，靠它等解锁。 */
export function onAudioReady(cb: () => void): void {
  if (ctx) cb(); else readyHooks.push(cb);
}

// ---------- 发声原语 ----------
const MAX_VOICES = 24;
let voices = 0;
let cap = MAX_VOICES;
let pitch = 1;
let vol = 1;

interface ToneOpts {
  type?: OscillatorType;
  f1?: number;      // 结束频率（指数滑音）
  vol?: number;
  attack?: number;
  vib?: [rate: number, cents: number];
}

function tone(f0: number, t: number, dur: number, o: ToneOpts = {}): void {
  const c = ctx!;
  if (voices >= cap) return;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(f0 * pitch, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * pitch), t + dur);
  const g = c.createGain();
  const peak = (o.vol ?? 0.3) * vol;
  const atk = Math.min(o.attack ?? 0.004, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(sfxIn!);
  let lfo: OscillatorNode | null = null;
  let lg: GainNode | null = null;
  if (o.vib && voices + 1 < cap) {
    lfo = c.createOscillator();
    lfo.frequency.value = o.vib[0];
    lg = c.createGain();
    lg.gain.value = o.vib[1];
    lfo.connect(lg);
    lg.connect(osc.detune);
    voices++;
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
    lfo.onended = () => { voices--; lfo!.disconnect(); lg!.disconnect(); };
  }
  voices++;
  osc.onended = () => { voices--; osc.disconnect(); g.disconnect(); };
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

interface NoiseOpts {
  type?: BiquadFilterType;
  f0?: number;
  f1?: number;      // 滤波频率扫到这里
  q?: number;
  vol?: number;
  attack?: number;
}

function noise(t: number, dur: number, o: NoiseOpts = {}): void {
  const c = ctx!;
  if (voices >= cap || !noiseBuf) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  const fa = o.f0 ?? 1000;
  f.frequency.setValueAtTime(fa, t);
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + dur);
  const g = c.createGain();
  const atk = Math.min(o.attack ?? 0.004, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, (o.vol ?? 0.3) * vol), t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(sfxIn!);
  voices++;
  src.onended = () => { voices--; src.disconnect(); f.disconnect(); g.disconnect(); };
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.03);
}

/** 五声音阶（宫商角徵羽）：deg 0..4 为本八度，可为负或超过 4 跨八度。 */
const PENT = [0, 2, 4, 7, 9];
function pent(deg: number, root = 523.25): number {
  const oct = Math.floor(deg / 5);
  const i = ((deg % 5) + 5) % 5;
  return root * 2 ** (oct + (PENT[i] ?? 0) / 12);
}

/** 带不和谐泛音的金属声（锣、铃）：比例不是整数倍，才像金属。 */
function metal(f: number, t: number, dur: number, ratios: number[], v: number): void {
  ratios.forEach((r, i) => tone(f * r, t, dur / (1 + i * 0.5), { vol: v / (1 + i * 0.6), attack: 0.003 }));
}

// ---------- 各音色 ----------
type Voice = (t: number) => void;

const VOICES: Record<SfxName, Voice> = {
  // 法器出手 ----
  sword: (t) => { // 剑风：带通噪声从低扫到高
    noise(t, 0.16, { f0: 700, f1: 4200, q: 2.5, vol: 0.28, attack: 0.02 });
    tone(1800, t, 0.06, { f1: 900, vol: 0.05 });
  },
  talisman: (t) => { // 符纸爆：短噪声 + 高音叮
    noise(t, 0.07, { type: 'highpass', f0: 3000, vol: 0.25 });
    tone(2400, t + 0.01, 0.16, { vol: 0.14 });
    tone(3600, t + 0.01, 0.1, { vol: 0.06 });
  },
  coins: (t) => { // 铜钱叮当：高频正弦泛音错开两下
    for (const [d, f] of [[0, 3100], [0.055, 4150]] as const) {
      tone(f, t + d, 0.22, { vol: 0.1 });
      tone(f * 1.51, t + d, 0.12, { vol: 0.05 });
      tone(f * 2.3, t + d, 0.07, { vol: 0.03 });
    }
  },
  flysword: (t) => { // 飞剑嗖：快速上扬
    tone(380, t, 0.2, { type: 'triangle', f1: 2000, vol: 0.14, attack: 0.02 });
    noise(t, 0.18, { f0: 2500, f1: 7000, q: 1.5, vol: 0.12, attack: 0.03 });
  },
  mirror: (t) => { // 镜光嗡：和声正弦 + 颤音
    tone(523, t, 0.42, { vol: 0.1, vib: [7, 14], attack: 0.04 });
    tone(784, t, 0.42, { vol: 0.08, vib: [7.5, 14], attack: 0.04 });
    tone(1568, t, 0.3, { vol: 0.03, attack: 0.05 });
  },
  thunder: (t) => { // 雷击：低频冲击 + 噪声爆裂
    tone(110, t, 0.35, { f1: 38, vol: 0.5 });
    noise(t, 0.4, { type: 'lowpass', f0: 2400, f1: 250, vol: 0.35 });
    noise(t, 0.05, { type: 'highpass', f0: 4000, vol: 0.2 });
  },
  bell: (t) => { // 铃声：不和谐泛音，长尾
    metal(660, t, 1.4, [1, 2.76, 5.4, 8.93], 0.16);
  },
  fire: (t) => { // 喷火：低通噪声呼呼
    noise(t, 0.34, { type: 'lowpass', f0: 500, f1: 1300, q: 0.7, vol: 0.28, attack: 0.05 });
    noise(t + 0.05, 0.25, { type: 'bandpass', f0: 250, f1: 180, vol: 0.2, attack: 0.04 });
  },
  rope: (t) => { // 甩绳：短促的抽"咻"+ 绳子绷紧的低弦
    noise(t, 0.12, { f0: 1800, f1: 600, q: 3, vol: 0.2, attack: 0.01 });
    tone(196, t + 0.08, 0.22, { type: 'triangle', f1: 180, vol: 0.14 });
  },
  petal: (t) => { // 落花：很轻的两声高音，五声音阶
    tone(pent(7), t, 0.18, { vol: 0.06, attack: 0.01 });
    tone(pent(9), t + 0.06, 0.2, { vol: 0.05, attack: 0.01 });
  },
  shieldUp: (t) => { // 金钟罩回一层：短钟声
    metal(392, t, 0.6, [1, 2.4, 4.1], 0.1);
  },
  shieldBreak: (t) => { // 金钟罩碎：重钟 + 碎裂噪声
    metal(196, t, 1.1, [1, 2.4, 4.1, 6.3], 0.22);
    noise(t, 0.25, { type: 'highpass', f0: 2500, f1: 6000, vol: 0.22 });
  },
  crane: (t) => { // 纸鹤俯冲：纸翅扑扇
    noise(t, 0.05, { f0: 3500, q: 2, vol: 0.1 });
    noise(t + 0.06, 0.05, { f0: 3000, q: 2, vol: 0.08 });
    tone(900, t, 0.12, { type: 'triangle', f1: 1600, vol: 0.05 });
  },
  // 战斗反馈 ----
  hit: (t) => { // 短促有肉感
    tone(230, t, 0.08, { f1: 85, vol: 0.28 });
    noise(t, 0.04, { f0: 1500, q: 1, vol: 0.18 });
  },
  crit: (t) => { // 暴击：比 hit 亮
    tone(280, t, 0.09, { f1: 90, vol: 0.28 });
    noise(t, 0.05, { f0: 2600, q: 1, vol: 0.22 });
    tone(1900, t, 0.18, { type: 'triangle', vol: 0.12 });
    tone(2850, t, 0.14, { vol: 0.07 });
  },
  kill: (t) => { // 轻"噗"
    noise(t, 0.1, { type: 'lowpass', f0: 1000, f1: 200, vol: 0.2 });
    tone(320, t, 0.1, { f1: 110, vol: 0.14 });
  },
  pickup: (t) => { // 清脆小音；pitch 由调用方连吸时递增
    tone(1200, t, 0.08, { f1: 1650, vol: 0.12 });
    tone(2400, t, 0.05, { type: 'triangle', vol: 0.04 });
  },
  coin: (t) => {
    tone(1760, t, 0.09, { vol: 0.12 });
    tone(2637, t + 0.045, 0.2, { vol: 0.12 });
  },
  heal: (t) => {
    [0, 2, 4].forEach((d, i) => tone(pent(d, 440), t + i * 0.09, 0.3, { vol: 0.1, attack: 0.02 }));
  },
  levelup: (t) => { // 上行五声音阶琶音
    [0, 1, 2, 3, 4, 5].forEach((d, i) => {
      tone(pent(d), t + i * 0.07, 0.3, { type: 'triangle', vol: 0.13 });
      tone(pent(d) * 2, t + i * 0.07, 0.15, { vol: 0.04 });
    });
  },
  choose: (t) => {
    tone(880, t, 0.09, { f1: 1320, vol: 0.12 });
    tone(1760, t + 0.04, 0.12, { vol: 0.06 });
  },
  evolve: (t) => { // 长一点、华丽：上扫气流 + 两个八度琶音 + 铃光
    noise(t, 0.6, { f0: 300, f1: 5000, q: 1.2, vol: 0.18, attack: 0.3 });
    [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((d, i) => {
      tone(pent(d, 392), t + 0.1 + i * 0.065, 0.45, { type: 'triangle', vol: 0.11 });
    });
    metal(1568, t + 0.7, 1.2, [1, 2.76], 0.1);
    tone(pent(5, 392), t + 0.7, 0.9, { vol: 0.1, vib: [6, 10], attack: 0.03 });
  },
  chest: (t) => { // 开箱：金属撞击 + 闪光琶音
    noise(t, 0.08, { f0: 4200, q: 3, vol: 0.2 });
    tone(1250, t, 0.18, { vol: 0.1 });
    tone(1870, t, 0.14, { vol: 0.07 });
    [2, 3, 4, 5, 7].forEach((d, i) => tone(pent(d, 784), t + 0.1 + i * 0.05, 0.25, { vol: 0.08 }));
  },
  hurt: (t) => { // 受伤：下坠锯齿 + 闷噪声
    tone(210, t, 0.22, { type: 'sawtooth', f1: 70, vol: 0.22 });
    noise(t, 0.18, { type: 'lowpass', f0: 1400, f1: 200, vol: 0.28 });
  },
  heartbeat: (t) => { // 咚—咚
    tone(62, t, 0.14, { f1: 42, vol: 0.5 });
    tone(55, t + 0.17, 0.16, { f1: 38, vol: 0.38 });
  },
  elite: (t) => { // 精英登场：短锣 + 上扬警示
    metal(150, t, 0.9, [1, 1.5, 2.3], 0.25);
    tone(300, t, 0.4, { type: 'triangle', f1: 600, vol: 0.1, attack: 0.1 });
  },
  boss: (t) => { // 低沉的锣 + 三声鼓
    metal(98, t, 2.8, [1, 1.52, 2.1, 3.4], 0.4);
    noise(t, 0.3, { type: 'lowpass', f0: 1800, f1: 300, vol: 0.2 });
    [0, 0.4, 0.8].forEach((d) => tone(75, t + d, 0.3, { f1: 38, vol: 0.5 }));
  },
  bossStomp: (t) => {
    tone(58, t, 0.45, { f1: 28, vol: 0.55 });
    noise(t, 0.35, { type: 'lowpass', f0: 600, f1: 90, vol: 0.35 });
  },
  bossSummon: (t) => { // 召唤：颤抖上行 + 阴冷噪声
    tone(180, t, 0.7, { type: 'triangle', f1: 720, vol: 0.14, vib: [9, 30], attack: 0.15 });
    noise(t, 0.7, { f0: 600, f1: 2400, q: 3, vol: 0.12, attack: 0.25 });
  },
  bossBreath: (t) => { // 吐息：低沉的长呼
    noise(t, 0.95, { type: 'lowpass', f0: 350, f1: 1500, q: 0.8, vol: 0.32, attack: 0.3 });
    noise(t + 0.3, 0.6, { type: 'bandpass', f0: 900, f1: 300, q: 1, vol: 0.12, attack: 0.2 });
  },
  gateOpen: (t) => { // 城门吱呀 + 闷响
    tone(70, t, 0.6, { type: 'sawtooth', f1: 150, vol: 0.12, vib: [14, 40], attack: 0.1 });
    noise(t, 0.6, { f0: 300, f1: 900, q: 4, vol: 0.12, attack: 0.15 });
    tone(55, t + 0.55, 0.3, { f1: 35, vol: 0.4 });
  },
  extract: (t) => { // 撤离：四音上行，收得稳
    [0, 2, 3, 5].forEach((d, i) => tone(pent(d, 392), t + i * 0.11, 0.5, { type: 'triangle', vol: 0.13 }));
    metal(1568, t + 0.4, 0.8, [1, 2.76], 0.06);
  },
  dawn: (t) => { // 天亮：明亮上行和弦（不模仿鸡叫）
    noise(t, 0.5, { type: 'highpass', f0: 4000, vol: 0.05, attack: 0.3 });
    [0, 2, 3, 5].forEach((d, i) => {
      tone(pent(d, 523), t + i * 0.12, 1.5, { type: 'triangle', vol: 0.12, attack: 0.02 });
      tone(pent(d, 523) * 2, t + i * 0.12, 1.1, { vol: 0.04 });
    });
    tone(800, t, 0.5, { f1: 1600, vol: 0.05, attack: 0.2 });
  },
  death: (t) => { // 下行
    [4, 3, 2, 0, -2].forEach((d, i) => tone(pent(d, 392), t + i * 0.2, 0.5, { type: 'triangle', vol: 0.14 }));
    tone(90, t + 0.8, 0.7, { f1: 35, vol: 0.5 });
  },
  click: (t) => {
    tone(1000, t, 0.025, { vol: 0.1 });
    tone(1500, t + 0.01, 0.03, { vol: 0.05 });
  },
};

/** 高频触发、丢了不心疼的音：同帧限 2 个，节点紧张时先丢；其余音在稍高的上限内放行。 */
const FREQUENT = new Set<SfxName>([
  'sword', 'talisman', 'coins', 'flysword', 'mirror', 'thunder', 'bell', 'fire',
  'hit', 'crit', 'kill', 'pickup', 'coin', 'heartbeat',
]);

const frame = new Map<SfxName, { t: number; n: number }>();
let enabled = readFlag('sfx', true);

export const sfx = {
  unlock(): void {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') void c.resume().catch(() => { /* 手势外 resume 会拒绝，下次手势再来 */ });
    while (readyHooks.length) {
      try { readyHooks.shift()!(); } catch { /* 钩子出错不影响音效 */ }
    }
  },
  play(name: SfxName, opts?: { volume?: number; pitch?: number }): void {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const voice = VOICES[name];
    if (!voice) return;
    // 同一帧（16 ms）同名最多 2 个
    const now = performance.now();
    const rec = frame.get(name);
    if (rec && now - rec.t < 16) {
      if (rec.n >= 2) return;
      rec.n++;
    } else {
      frame.set(name, { t: now, n: 1 });
    }
    cap = FREQUENT.has(name) ? MAX_VOICES : MAX_VOICES + 6;
    if (voices >= cap) return;
    pitch = opts?.pitch && opts.pitch > 0 ? opts.pitch : 1;
    vol = opts?.volume !== undefined ? Math.max(0, opts.volume) : 1;
    try {
      voice(ctx.currentTime + 0.005);
    } catch { /* 音效永远不该拖垮游戏 */ }
    pitch = 1;
    vol = 1;
  },
  setEnabled(on: boolean): void {
    enabled = on;
    writeFlag('sfx', on);
  },
  get enabled(): boolean { return enabled; },
  get ctx(): AudioContext | null { return ctx; },
};
