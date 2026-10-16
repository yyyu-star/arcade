/**
 * 音效全用 WebAudio 现合成（DESIGN.md 8.1），没有音频文件：发牌是纸牌的"啪"，筹码是陶瓷的"叮嗒"，
 * 过牌是指节敲桌毡两下，赢了是带一点闪光的琶音。所有声音先进一个总音量，再过一个压限器，防止叠音爆音。
 *
 * AudioContext 只在用户手势里建、在手势里 resume（iOS Safari 的硬要求）；切后台回来变成
 * suspended / interrupted 后，下一次手势再唤醒。
 */
import { playFunSound, type FunPhase, type PropId } from 'arcade-kit/fun';

export type Sfx =
  | 'card' | 'flip' | 'chip' | 'check' | 'fold' | 'win' | 'turn' | 'tick' | 'taunt' | 'banner' | 'bigpot'
  | 'tap' | 'allin' | 'lose' | 'shuffle' | 'collect' | 'reveal' | 'emote';

/** 旧 Safari 只有带前缀的构造器；类型上手工补一下，不用 any */
type AudioCtor = typeof AudioContext;
const Ctor: AudioCtor | undefined =
  typeof window === 'undefined'
    ? undefined
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);

/** 同时发声的上限：快速连点或一串动画叠起来时，超过就丢掉新的，宁可少响也不卡 */
const MAX_VOICES = 24;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let on = true;
let volume = 0.8;
let voices = 0;

export function setSound(enabled: boolean): void {
  on = enabled;
}

/** 总音量 0–1；静音开关另算 */
export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.8));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.015);
}

export function getVolume(): number {
  return volume;
}

/** 'interrupted' 是 iOS 特有的状态，lib.dom 的类型里没有，按字符串比 */
function needsResume(c: AudioContext): boolean {
  const s = c.state as string;
  return s === 'suspended' || s === 'interrupted';
}

/** 在用户手势里调：第一次建上下文，之后每次手势都顺手唤醒（iOS 切后台回来会被挂起） */
export function unlockAudio(): void {
  if (!Ctor) return;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    const c = ctx;
    master = c.createGain();
    master.gain.value = volume;
    // 轻压限：几个声音叠在一起（大池子 + 赢牌 + 横幅）也不削波
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(c.destination);
    // 一份噪声反复用：1 秒，比最长的一段（全下的蓄力约 0.5 秒）长，每次取不同起点
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // iOS 要在手势里真的出一声才算解锁：播一个静音的单样本
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, c.sampleRate);
    s.connect(c.destination);
    s.start(0);
  }
  if (needsResume(ctx)) void ctx.resume().catch(() => undefined);
}

// 第一次手势自动解锁，之后每次手势都检查是否被系统挂起；不依赖调用方是否只绑了一次
if (typeof window !== 'undefined') {
  for (const e of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(e, unlockAudio, { capture: true, passive: true });
  }
}

/** 能不能发声：开着、已解锁、上下文在跑。被挂起时直接丢，免得恢复后一股脑补响 */
function ready(): boolean {
  if (!on || !ctx || !master || !noise) return false;
  if (ctx.state !== 'running') {
    if (needsResume(ctx)) void ctx.resume().catch(() => undefined);
    return false;
  }
  return voices < MAX_VOICES;
}

/** 发声源停下后把整条链拆掉，并归还名额 */
function track(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  voices++;
  src.onended = () => {
    voices--;
    src.disconnect();
    for (const n of nodes) n.disconnect();
  };
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

interface BurstOpt {
  type?: BiquadFilterType;
  /** 滤波中心在时长内滑到这个频率（挥动、扫过的感觉） */
  to?: number;
  attack?: number;
}

/** 一小段滤过的噪声 */
function burst(t: number, freq: number, q: number, peak: number, decay: number, o: BurstOpt = {}): void {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.002) + decay);
  f.Q.value = q;
  const g = c.createGain();
  env(g, t, peak, o.attack ?? 0.002, decay);
  src.connect(f).connect(g).connect(master!);
  track(src, [f, g]);
  const dur = (o.attack ?? 0.002) + decay + 0.02;
  // 偏移不能是负的（start 会抛 RangeError）：0.10.0 全下那段 0.5 秒正好等于噪声长度，偏移成了负数，抛错把牌局卡住
  src.start(t, Math.random() * Math.max(0, noise!.duration - dur - 0.01), dur);
}

interface ToneOpt {
  /** 频率在时长内滑到这个值 */
  to?: number;
  attack?: number;
  /** 低通截止，削掉刺耳的高次谐波 */
  lp?: number;
}

function tone(t: number, freq: number, type: OscillatorType, peak: number, decay: number, o: ToneOpt = {}): void {
  const c = ctx!;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const a = o.attack ?? 0.004;
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + a + decay);
  const g = c.createGain();
  env(g, t, peak, a, decay);
  const nodes: AudioNode[] = [g];
  let out: AudioNode = osc;
  if (o.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    out = out.connect(f);
    nodes.push(f);
  }
  out.connect(g).connect(master!);
  track(osc, nodes);
  osc.start(t);
  osc.stop(t + a + decay + 0.05);
}

/** 陶瓷筹码相碰的"叮"：两个不成整数倍的高频正弦（金属/陶瓷质感）+ 一点噪声 */
function clink(t: number, base: number, peak: number): void {
  tone(t, base, 'sine', peak, 0.05);
  tone(t, base * 1.51, 'sine', peak * 0.6, 0.035);
  burst(t, base * 1.3, 4, peak * 0.9, 0.02);
}

/** 钟声似的一个音：基音 + 二倍音，听着圆、不尖 */
function bell(t: number, freq: number, peak: number, decay: number): void {
  tone(t, freq, 'sine', peak, decay);
  tone(t, freq * 2, 'sine', peak * 0.25, decay * 0.6);
}

function sparkle(t: number, n: number, peak: number): void {
  for (let i = 0; i < n; i++) {
    tone(t + i * 0.04 + Math.random() * 0.03, 2400 + Math.random() * 2400, 'sine', peak, 0.14);
  }
}

/** 放一个音效；出了错只记一笔，声音永远不打断牌局 */
export function play(s: Sfx): void {
  if (!ready()) return;
  try {
    sfx(s);
  } catch (e) {
    console.error(`texas: 音效 ${s} 出错`, e);
  }
}

function sfx(s: Sfx): void {
  const t = ctx!.currentTime + 0.005;
  const j = 1 + (Math.random() - 0.5) * 0.12;
  switch (s) {
    // 发牌：纸牌擦过桌毡的"啪"——高频脆响 + 一点低频纸身
    case 'card':
      burst(t, 3400 * j, 0.8, 0.22, 0.035);
      burst(t, 1100 * j, 0.7, 0.14, 0.06);
      tone(t, 700, 'sine', 0.05, 0.03, { to: 300 });
      break;
    // 翻牌：先一下掠过，再落一下
    case 'flip':
      burst(t, 1400 * j, 1.2, 0.14, 0.07, { to: 4200, attack: 0.02 });
      burst(t + 0.07, 2800 * j, 0.9, 0.18, 0.04);
      break;
    // 摊牌亮牌：比翻牌慢半拍、带一点低音和闪光，像"揭晓"
    case 'reveal':
      burst(t, 900 * j, 1.1, 0.14, 0.1, { to: 3200, attack: 0.04 });
      burst(t + 0.1, 2200 * j, 0.8, 0.2, 0.05);
      tone(t + 0.1, 220, 'sine', 0.12, 0.12, { to: 140 });
      tone(t + 0.12, 2637, 'sine', 0.035, 0.22);
      break;
    // 筹码：两三下陶瓷叮嗒，音高随机略错开
    case 'chip':
      for (let i = 0; i < 3; i++) clink(t + i * 0.04 + Math.random() * 0.01, (3300 + i * 350) * j, 0.07 - i * 0.012);
      break;
    // 过牌：指节在桌毡上敲两下
    case 'check':
      for (let i = 0; i < 2; i++) {
        const k = t + i * 0.13;
        tone(k, 190 - i * 15, 'sine', 0.4, 0.09, { to: 85 });
        burst(k, 500, 0.8, 0.12, 0.03, { type: 'lowpass' });
      }
      break;
    // 弃牌：牌被轻轻推出去的"嗖"，软、往下
    case 'fold':
      burst(t, 2600 * j, 0.7, 0.1, 0.2, { to: 500, attack: 0.03 });
      break;
    // 赢：暖亮的琶音，末尾几点闪光
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) => {
        const k = t + i * 0.085;
        tone(k, f, 'sine', 0.15, 0.5);
        tone(k, f * 2, 'triangle', 0.035, 0.3);
      });
      sparkle(t + 0.3, 5, 0.025);
      break;
    // 输：两个往下的软音，不悲情，一听就过去了
    case 'lose':
      tone(t, 392, 'triangle', 0.13, 0.22, { lp: 1600 });
      tone(t + 0.16, 311, 'triangle', 0.12, 0.36, { lp: 1400 });
      break;
    // 轮到我（0.3.0 朋友们："到自己出牌来点音效提示一下"）：三个音往上走的钟声，友好、听得清
    case 'turn':
      bell(t, 784, 0.19, 0.25);
      bell(t + 0.11, 988, 0.17, 0.25);
      bell(t + 0.22, 1319, 0.16, 0.4);
      break;
    // 计时最后 5 秒的嘀嗒：木块敲一下
    case 'tick':
      tone(t, 1250, 'sine', 0.1, 0.025, { to: 800 });
      burst(t, 2200, 5, 0.07, 0.018);
      break;
    // 有人发嘲讽：俏皮的"啵"，音高往上弹
    case 'taunt':
      tone(t, 380 * j, 'sine', 0.16, 0.09, { to: 960 * j });
      burst(t, 2000, 2, 0.04, 0.02);
      tone(t + 0.07, 1250 * j, 'sine', 0.06, 0.07);
      break;
    // 表情/贴纸出现：小气泡"噗"+一点闪
    case 'emote':
      tone(t, 520 * j, 'sine', 0.1, 0.07, { to: 1300 * j });
      tone(t + 0.05, 2100 * j, 'sine', 0.035, 0.12);
      break;
    // 名场面横幅：短促的号角（锯齿波过低通，铜管感，但不吵）
    case 'banner':
      [392, 523, 659].forEach((f, i) => tone(t + i * 0.07, f, 'sawtooth', 0.06, 0.22, { lp: 2400 }));
      tone(t + 0.24, 784, 'sawtooth', 0.07, 0.5, { lp: 2800 });
      tone(t + 0.24, 1047, 'triangle', 0.08, 0.55);
      break;
    // 大池子收进赢家：一串筹码哗啦啦往下落，越来越稀
    case 'bigpot':
      for (let i = 0; i < 12; i++) {
        const k = t + i * 0.042 + Math.random() * 0.02;
        clink(k, 2800 + Math.random() * 1800, 0.085 * (1 - i * 0.05));
      }
      break;
    // 界面按钮：轻轻一"嗒"，不抢戏
    case 'tap':
      tone(t, 1700, 'sine', 0.06, 0.025, { to: 1100 });
      burst(t, 3500, 2, 0.03, 0.012);
      break;
    // 全下：噪声上扬蓄力，落一记低沉的"咚"，再撒一把筹码
    case 'allin':
      burst(t, 300, 1.5, 0.12, 0.28, { to: 3800, attack: 0.2 });
      tone(t, 110, 'sawtooth', 0.04, 0.3, { to: 220, attack: 0.2, lp: 700 });
      tone(t + 0.3, 120, 'sine', 0.5, 0.35, { to: 42 });
      burst(t + 0.3, 400, 0.8, 0.2, 0.08, { type: 'lowpass' });
      for (let i = 0; i < 4; i++) clink(t + 0.32 + i * 0.04, 3000 + Math.random() * 1500, 0.07);
      break;
    // 开新一手：洗牌的哗哗声（一串短促的噪声，中间最响）
    case 'shuffle':
      for (let i = 0; i < 14; i++) {
        const mid = 1 - Math.abs(i - 6.5) / 7;
        burst(t + i * 0.024 + Math.random() * 0.008, (2200 + Math.random() * 1600) * j, 1, 0.05 + 0.1 * mid, 0.022);
      }
      burst(t + 0.38, 1300, 0.7, 0.14, 0.05);
      break;
    // 下注收进池子：一掠 + 几下筹码聚拢
    case 'collect':
      burst(t, 1200, 1, 0.09, 0.2, { to: 3200, attack: 0.04 });
      for (let i = 0; i < 4; i++) clink(t + 0.05 + i * 0.05 - i * i * 0.004, (3000 + i * 250) * j, 0.065);
      tone(t + 0.26, 260, 'sine', 0.12, 0.1, { to: 180 });
      break;
  }
}

/** 好友房道具的声音（kit 0.7.0 现场合成）：跟着静音开关和总音量走，用同一个 AudioContext */
export function funSound(prop: PropId, phase: FunPhase): void {
  if (!on || !ctx || !master || ctx.state !== 'running') {
    if (on && ctx && needsResume(ctx)) void ctx.resume().catch(() => undefined);
    return;
  }
  try {
    playFunSound(ctx, master, prop, phase, 0.8);
  } catch (e) {
    console.error(`texas: 道具声音 ${prop} 出错`, e);
  }
}
