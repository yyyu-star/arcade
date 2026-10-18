// WebAudio 现合成的音效：不带任何音频文件，不从网络加载。
// 随机只用在声音的细微抖动上（画面层），不碰规则。
//
// 音量的约定：各音效自己的峰值大致落在 0.3–0.6（按钮、表情这类轻提示 0.1–0.2），
// 再乘总音量 BASE × volume。不加 DynamicsCompressor 限幅：Chrome 的压缩器自带补偿增益、对几十毫秒的短音反应不稳，
// 实测会把各音效的相对响度打乱（摸牌被压一半、碰被抬高）。改用 softClip：0.6 以下原样通过（单个音效峰值都在 0.45 以下，音色不变），
// 只有十来个大音效同一刻叠上（实测峰值 1.1）时才圆滑地压到 0.9 以内，不会削波出"咔"。

export type Sfx =
  | 'draw' | 'discard' | 'land' | 'pon' | 'kan' | 'hu' | 'zimo' | 'wind' | 'rain'
  | 'turn' | 'tick' | 'win' | 'lose' | 'click' | 'deal'
  | 'chips' | 'button' | 'swap' | 'que' | 'countdown' | 'emote' | 'big';

/** 总音量 1 时 master 的增益；留出余量给叠音 */
const BASE = 0.6;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 1;
let noiseBuf: AudioBuffer | null = null;

const target = (): number => (enabled ? BASE * volume : 0);

/** 改增益走 setTargetAtTime（约 30 ms 收敛），直接跳值会在波形上留个台阶，听起来就是"啪"一声 */
function applyGain(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.setTargetAtTime(target(), now, 0.03);
}

/** 软限幅曲线：|x| ≤ 0.6 线性，往上用 tanh 缓缓弯到 0.9；输入超过 ±1 时 WaveShaper 取端点值，也不会过 0.9 */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    k[i] = a <= 0.6 ? x : Math.sign(x) * (0.6 + 0.38 * Math.tanh((a - 0.6) / 0.38));
  }
  return k;
}

/** 在用户第一次点击里调；浏览器（尤其 iOS）要求有用户操作才能建、才能恢复 AudioContext，之后反复调没副作用 */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = target();
      const clip = ctx.createWaveShaper();
      clip.curve = softClip();
      master.connect(clip).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    syncAmbience();
  } catch {
    ctx = null;
    master = null;
  }
}

// ---------- 茶馆底噪（docs/art-v3.md 第 5 节，0.17.4） ----------
// 很轻的一层：低处是屋里嗡嗡的人声（两层滤波噪声，一层慢慢起伏），隔十来秒一声盖碗碰茶托。
// 走总音量（master），所以跟着"静音"和音量滑块走；设置里还能单独关（prefs.ambience）。页面切到后台就停，回来再起。

/** 底噪在总音量里占多少：比打牌声轻得多，听得见但不抢 */
const AMB_VOL = 0.05;
let ambOn = true;
let amb: { nodes: AudioScheduledSourceNode[]; g: GainNode; timer: number } | null = null;

export function setAmbience(on: boolean): void {
  ambOn = on;
  syncAmbience();
}

function syncAmbience(): void {
  const want = ambOn && !!ctx && !!master && document.visibilityState === 'visible';
  if (want && !amb) startAmbience();
  else if (!want && amb) stopAmbience();
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncAmbience);

function startAmbience(): void {
  const c = ctx!;
  const t = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(AMB_VOL, t + 1.5);
  g.connect(master!);
  const layer = (type: BiquadFilterType, freq: number, q: number, vol: number): { s: AudioBufferSourceNode; v: GainNode } => {
    const s = c.createBufferSource();
    s.buffer = noise(c);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const v = c.createGain();
    v.gain.value = vol;
    s.connect(f).connect(v).connect(g);
    s.start(t, Math.random() * 0.5);
    return { s, v };
  };
  const low = layer('lowpass', 320, 0.5, 1);
  const talk = layer('bandpass', 650, 0.8, 0.5);
  // 人声的起伏：一个 0.13 赫兹的慢波推着中频那层的音量（0.5 ± 0.35）
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.13;
  const depth = c.createGain();
  depth.gain.value = 0.35;
  lfo.connect(depth).connect(talk.v.gain);
  lfo.start(t);
  const clink = (): void => {
    if (!amb || !ctx) return;
    const e = { c: ctx, out: amb.g };
    const at = ctx.currentTime + 0.05;
    const f = 2300 * jit(0.08);
    tone(e, at, 0.25, 0.5, 'sine', f, f, 0.001);
    tone(e, at, 0.12, 0.25, 'sine', f * 2.7, f * 2.7, 0.001);
    amb.timer = window.setTimeout(clink, 7_000 + Math.random() * 9_000);
  };
  amb = { nodes: [low.s, talk.s, lfo], g, timer: window.setTimeout(clink, 4_000) };
}

function stopAmbience(): void {
  if (!amb || !ctx) return;
  const { nodes, g, timer } = amb;
  amb = null;
  window.clearTimeout(timer);
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  for (const n of nodes) n.stop(t + 0.35);
}

export function setSound(on: boolean): void {
  enabled = on;
  applyGain();
}

/** 总音量 0–1；0 和关声音一样，一点声音都不出 */
export function setVolume(v: number): void {
  volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  applyGain();
}

/** 给 arcade-kit/fun 的 playFunSound 用；没解锁、关了声音或音量为 0 返回 null。out 是总音量，我们自己的音效也走它 */
export function audioOut(): { ctx: AudioContext; out: AudioNode } | null {
  if (!enabled || volume <= 0 || !ctx || !master) return null;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return { ctx, out: master };
}

/** 一秒白噪声，整个页面只建一次；各处用随机起点循环播放，听不出重复 */
function noise(c: BaseAudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

type Env = { c: BaseAudioContext; out: AudioNode };

/** ±r 的抖动倍数：同一个音效连着响不至于像复读机 */
const jit = (r: number): number => 1 + (Math.random() * 2 - 1) * r;

/** 一段滤波噪声：t 开始，dur 秒，指数衰减；freq 可从 f0 扫到 f1 */
function burst(e: Env, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, q = 1, f1 = f0, attack = 0.004): void {
  const s = e.c.createBufferSource();
  s.buffer = noise(e.c);
  s.loop = true;
  const f = e.c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = e.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(e.out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

/** 一个音：freq 可滑到 f1；attack 越短越"脆" */
function tone(e: Env, t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.006): void {
  const o = e.c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = e.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(e.out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * 一串噼啪：一个噪声源 + 一个增益上排一串尖峰。
 * 下雨、鞭炮要几十个小颗粒，每颗都建一套节点会一下子堆上百个，手机上会卡；这样只要 3 个节点。
 */
function crackle(e: Env, t: number, times: number[], vol: number, type: BiquadFilterType, freq: number, q = 1, tau = 0.006): void {
  const s = e.c.createBufferSource();
  s.buffer = noise(e.c);
  s.loop = true;
  const f = e.c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = e.c.createGain();
  g.gain.setValueAtTime(0, t);
  const ts = [...times].sort((a, b) => a - b);
  for (const dt of ts) {
    const at = t + dt;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol * jit(0.35), at + 0.0015);
    g.gain.setTargetAtTime(0, at + 0.0015, tau);
  }
  const end = t + (ts[ts.length - 1] ?? 0) + tau * 8 + 0.02;
  s.connect(f).connect(g).connect(e.out);
  s.start(t, Math.random() * 0.5);
  s.stop(end);
}

/**
 * 牌碰牌：麻将牌是实心的硬料，声音是一下极短的"嗒"（窄带噪声）加两个不成谐波的高频共振（象牙/硬木的"脆"），
 * 几十毫秒就没了。pitch 调整体高低：理牌、摸牌高一点、轻一点，定缺、拍桌低一点。
 */
function clack(e: Env, t: number, power: number, pitch = 1): void {
  const j = jit(0.05) * pitch;
  const p = power * jit(0.06);
  burst(e, t, 0.02, 0.45 * p, 'bandpass', 3600 * j, 2.2, 3600 * j, 0.0015);
  tone(e, t, 0.05, 0.2 * p, 'sine', 2250 * j, 2150 * j, 0.0015);
  tone(e, t, 0.03, 0.1 * p, 'sine', 3870 * j, 3870 * j, 0.0015);
}

/** 牌落到桌面：绿呢下面是木头，一声闷的低频 */
function thump(e: Env, t: number, power: number): void {
  const j = jit(0.06);
  tone(e, t, 0.09, 0.32 * power, 'sine', 170 * j, 85, 0.003);
  burst(e, t, 0.05, 0.2 * power, 'lowpass', 900 * j, 0.7, 900 * j, 0.002);
}

/** 筹码碰筹码：金属的高频、不成谐波、尾巴比牌长 */
function clink(e: Env, t: number, vol: number): void {
  const f = 3100 * jit(0.12);
  tone(e, t, 0.22, vol, 'sine', f, f, 0.001);
  tone(e, t, 0.12, vol * 0.5, 'sine', f * 2.76, f * 2.76, 0.001);
  burst(e, t, 0.015, vol * 0.6, 'highpass', 6500, 0.7, 6500, 0.001);
}

const note = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** 钟琴一样的音：三角波基音 + 一点八度泛音，听着亮但不刺 */
function chime(e: Env, t: number, freq: number, vol: number, dur = 0.5): void {
  tone(e, t, dur, vol, 'triangle', freq * jit(0.003));
  tone(e, t, dur * 0.6, vol * 0.3, 'sine', freq * 2);
}

/** 锣：胡牌的"当"；噪声层给金属感，两个低频正弦给体量 */
function gong(e: Env, t: number, power = 1, dur = 1.1): void {
  burst(e, t, dur, 0.22 * power, 'bandpass', 3200, 0.8);
  burst(e, t, dur * 0.6, 0.12 * power, 'highpass', 6000);
  tone(e, t, dur, 0.3 * power, 'sine', 110, 92);
  tone(e, t, dur * 0.85, 0.13 * power, 'sine', 237, 230);
}

/** 鞭炮：一串随机间隔的炸点，前密后疏 */
function firecrackers(e: Env, t: number, n: number, span: number, vol: number): void {
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(span * Math.pow(Math.random(), 1.4));
  crackle(e, t, times, vol, 'bandpass', 2200, 0.6, 0.012);
}

const PLAYERS: Record<Sfx, (e: Env, t: number) => void> = {
  draw: (e, t) => clack(e, t, 0.9, 1.12),
  discard: (e, t) => {
    clack(e, t, 1.2, 0.95);
    thump(e, t + 0.002, 1);
  },
  // 牌飞进河里落到毡面：比 discard 更低更短的一声闷响，只有"嗒"的肉，没有脆的高频
  land: (e, t) => {
    tone(e, t, 0.05, 0.22, 'sine', 140, 70, 0.002);
    burst(e, t, 0.03, 0.12, 'lowpass', 600, 0.7, 600, 0.001);
  },
  // 理牌：一把牌哗啦一下碰在一起，间隔不匀才像手搓出来的
  deal: (e, t) => {
    let at = 0;
    for (let i = 0; i < 6; i++) {
      clack(e, t + at, 0.55 + Math.random() * 0.25, 1.05 + Math.random() * 0.15);
      at += 0.045 + Math.random() * 0.04;
    }
  },
  // 碰：两张牌一齐亮出来，第二下更重，再"嘭"一下落桌
  pon: (e, t) => {
    clack(e, t, 0.9, 1);
    clack(e, t + 0.09, 1.15, 0.92);
    thump(e, t + 0.09, 1.1);
    tone(e, t + 0.09, 0.18, 0.12, 'triangle', note(74), note(74));
  },
  // 杠：三下越来越重，最后一个低音压住；刮风下雨另外由 'wind' / 'rain' 跟上
  kan: (e, t) => {
    clack(e, t, 0.85, 1);
    clack(e, t + 0.09, 1, 0.95);
    clack(e, t + 0.18, 1.2, 0.9);
    thump(e, t + 0.18, 1.3);
    tone(e, t + 0.18, 0.35, 0.25, 'sine', 72, 52);
  },
  // 胡：锣一响，三和弦往上走，落在高八度的主音上；喜庆有劲但不吵
  hu: (e, t) => {
    thump(e, t, 1.3);
    gong(e, t, 1.15);
    [67, 71, 74].forEach((n, i) => chime(e, t + 0.12 + i * 0.1, note(n), 0.18, 0.55));
    chime(e, t + 0.42, note(79), 0.19, 0.8);
  },
  // 自摸：在胡的基础上多一串高处的闪光
  zimo: (e, t) => {
    thump(e, t, 1.3);
    gong(e, t, 1.15);
    [67, 71, 74].forEach((n, i) => chime(e, t + 0.12 + i * 0.1, note(n), 0.18, 0.5));
    [79, 83, 86, 91].forEach((n, i) => chime(e, t + 0.45 + i * 0.07, note(n), 0.09, 0.55));
  },
  // 大番：鞭炮 + 五声音阶跑上去 + 一个大和弦收尾，和普通的胡一听就分得开
  big: (e, t) => {
    gong(e, t, 1, 1.2);
    firecrackers(e, t + 0.02, 26, 0.9, 0.55);
    [67, 69, 72, 74, 76, 79].forEach((n, i) => chime(e, t + 0.1 + i * 0.07, note(n), 0.13, 0.4));
    [72, 76, 79, 84].forEach((n) => chime(e, t + 0.55, note(n), 0.07, 0.85));
  },
  wind: (e, t) => burst(e, t, 0.8, 2.4, 'bandpass', 300, 2, 1800, 0.12),
  // 下雨：四十来滴雨，一个噪声源排尖峰，不再一滴一套节点
  rain: (e, t) => {
    const times: number[] = [];
    for (let i = 0; i < 44; i++) times.push((i / 44) * 0.9 + Math.random() * 0.02);
    crackle(e, t, times, 0.24, 'highpass', 5000, 0.7, 0.004);
  },
  turn: (e, t) => {
    chime(e, t, note(88), 0.16, 0.22);
    chime(e, t + 0.12, note(93), 0.16, 0.28);
  },
  // 普通秒表滴答：很轻，三角波不刺耳
  tick: (e, t) => tone(e, t, 0.04, 0.14, 'triangle', 1500, 1500, 0.002),
  // 最后几秒：木鱼一样"笃"一声，比 tick 实、比 tick 响一点，提醒但不吓人
  countdown: (e, t) => {
    tone(e, t, 0.09, 0.26, 'sine', 1080, 1020, 0.001);
    tone(e, t, 0.035, 0.1, 'sine', 2680, 2680, 0.001);
    burst(e, t, 0.012, 0.12, 'bandpass', 1600, 1.5, 1600, 0.001);
  },
  // 赢：大三和弦往上跑，落在一个亮的和弦上
  win: (e, t) => {
    [60, 64, 67, 72].forEach((n, i) => chime(e, t + i * 0.09, note(n), 0.2, 0.45));
    [76, 79, 84].forEach((n) => chime(e, t + 0.38, note(n), 0.13, 0.9));
  },
  // 输：往下走，但最后落回主音（大调），像"没事，下一把"而不是哀乐
  lose: (e, t) => {
    chime(e, t, note(67), 0.22, 0.35);
    chime(e, t + 0.2, note(64), 0.22, 0.35);
    chime(e, t + 0.4, note(62), 0.2, 0.35);
    tone(e, t + 0.6, 0.6, 0.24, 'triangle', note(60));
    tone(e, t + 0.6, 0.6, 0.09, 'sine', note(67));
  },
  // 旧的"点一下"（报错、兼容旧调用）：一下轻轻的牌碰牌
  click: (e, t) => clack(e, t, 0.5, 1.2),
  // 按钮：比 click 更轻更短，频繁点也不烦
  button: (e, t) => {
    tone(e, t, 0.03, 0.12, 'sine', 1300 * jit(0.03), 900, 0.001);
    burst(e, t, 0.012, 0.06, 'bandpass', 4200, 2, 4200, 0.001);
  },
  // 筹码：两三枚叮当落下，最后一下最轻
  chips: (e, t) => {
    clink(e, t, 0.2);
    clink(e, t + 0.05 + Math.random() * 0.02, 0.16);
    clink(e, t + 0.12 + Math.random() * 0.03, 0.1);
    thump(e, t, 0.35);
  },
  // 换三张：三张牌一推"呼"地滑过去，落定时轻碰三下
  swap: (e, t) => {
    burst(e, t, 0.26, 0.3, 'bandpass', 500, 1.2, 2600, 0.05);
    clack(e, t + 0.16, 0.55, 1.05);
    clack(e, t + 0.21, 0.6, 1);
    clack(e, t + 0.26, 0.7, 0.95);
  },
  // 定缺：像盖章，一下低而实的"嗒"加一个短音，表示"定了"
  que: (e, t) => {
    clack(e, t, 0.9, 0.72);
    thump(e, t, 0.55);
    tone(e, t + 0.03, 0.16, 0.1, 'triangle', note(72), note(72));
  },
  // 表情、道具到了：两个往上滑的小泡泡，很轻，不和打牌声抢
  emote: (e, t) => {
    tone(e, t, 0.08, 0.17, 'sine', 620, 900, 0.004);
    tone(e, t + 0.07, 0.1, 0.14, 'sine', 900, 1350, 0.004);
  },
};

/**
 * 每种音效的最短间隔（秒）和大致时长。一下摸好几张、一串筹码结算时同一种声音会在几毫秒内连发，
 * 全播只会糊成一片还堆节点；间隔内的直接丢掉。时长用来数"正在响的"，超过 MAX_VOICES 时只放行重要的。
 */
const SPEC: Record<Sfx, { gap: number; dur: number; key?: boolean }> = {
  draw: { gap: 0.05, dur: 0.06 },
  discard: { gap: 0.05, dur: 0.1, key: true },
  land: { gap: 0.05, dur: 0.07 },
  deal: { gap: 0.3, dur: 0.45 },
  pon: { gap: 0.15, dur: 0.3, key: true },
  kan: { gap: 0.2, dur: 0.55, key: true },
  hu: { gap: 0.25, dur: 1.25, key: true },
  zimo: { gap: 0.25, dur: 1.25, key: true },
  big: { gap: 0.4, dur: 1.45, key: true },
  wind: { gap: 0.4, dur: 0.85 },
  rain: { gap: 0.4, dur: 0.95 },
  turn: { gap: 0.2, dur: 0.42 },
  tick: { gap: 0.2, dur: 0.05 },
  countdown: { gap: 0.3, dur: 0.1, key: true },
  win: { gap: 0.5, dur: 1.3, key: true },
  lose: { gap: 0.5, dur: 1.25, key: true },
  click: { gap: 0.04, dur: 0.05 },
  button: { gap: 0.03, dur: 0.04 },
  chips: { gap: 0.08, dur: 0.35 },
  swap: { gap: 0.3, dur: 0.3 },
  que: { gap: 0.3, dur: 0.2 },
  emote: { gap: 0.12, dur: 0.18 },
};

/** 同时在响的音效个数上限；超了丢不重要的（理牌、按钮、表情），胡、碰杠、倒计时照放 */
const MAX_VOICES = 8;
const lastAt: Partial<Record<Sfx, number>> = {};
let voices: number[] = [];

export function play(s: Sfx): void {
  const o = audioOut();
  if (!o) return;
  const now = o.ctx.currentTime;
  const spec = SPEC[s];
  const prev = lastAt[s];
  if (prev !== undefined && now - prev < spec.gap) return;
  voices = voices.filter((end) => end > now);
  if (voices.length >= MAX_VOICES && !spec.key) return;
  lastAt[s] = now;
  voices.push(now + spec.dur);
  try {
    PLAYERS[s]({ c: o.ctx, out: o.out }, now + 0.01);
  } catch {
    // 个别老浏览器缺某个节点或参数时只是没声音，不能让一个音效把出牌流程打断
  }
}
