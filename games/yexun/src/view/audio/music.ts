// 《夜巡》背景音乐：五声音阶（宫商角徵羽）程序生成，笛子 + 古筝拨弦 + 低鼓，
// 用 AudioContext 时钟提前调度（lookahead），不依赖帧率，切后台也不会拖拍。
// 与 sfx.ts 共用同一个 AudioContext 和压缩器总线，所以音乐不会和音效一起把声音顶爆。

import { audioBus, onAudioReady, readFlag, writeFlag } from './sfx.ts';

type TrackName = 'night' | 'boss' | 'raid';
type Level = 0 | 1 | 2 | 3;

const _ = null;
type Phrase = Array<number | null>; // 16 个八分音符 = 2 小节，值为五声音阶级数

interface TrackDef {
  bpm: number;
  fluteRoot: number;       // 笛子 0 级的频率（Hz）
  phrases: Record<string, Phrase>;
  order: string[];         // 每个乐句占 2 小节；order 长度 x 2 = 全曲小节数
  bass: number[];          // 每小节的低音级数（循环）
  level: number;           // 整体音量
}

const TRACKS: Record<TrackName, TrackDef> = {
  // 守夜：舒缓，32 小节
  night: {
    bpm: 76, fluteRoot: 587.33, level: 1,
    phrases: {
      A: [4, _, 3, _, 2, _, _, _, 3, _, 2, _, 0, _, _, _],
      B: [0, _, 2, _, 3, _, 4, _, 3, _, _, _, 2, _, _, _],
      C: [4, _, _, 3, 4, _, 5, _, 4, _, 3, _, 2, _, _, _],
      D: [5, _, 4, _, 3, _, 2, _, 0, _, _, _, _, _, _, _],
    },
    order: ['A', 'B', 'A', 'C', 'B', 'A', 'C', 'D', 'A', 'C', 'B', 'D', 'A', 'B', 'C', 'D'],
    bass: [0, 0, -2, -3],
  },
  // 首领：更急，调式落在羽，16 小节
  boss: {
    bpm: 132, fluteRoot: 659.26, level: 1,
    phrases: {
      A: [0, 0, 2, 0, 3, 0, 2, 0, 4, 4, 3, 2, 3, 2, 0, _],
      B: [4, _, 4, 5, 4, 3, 2, 3, 4, _, 5, _, 6, _, 5, 4],
      C: [3, 3, 4, 3, 2, 2, 3, 2, 0, 2, 3, 4, 3, 2, 0, _],
      D: [5, 4, 3, 2, 3, 4, 5, 6, 7, _, 6, 5, 4, _, 3, _],
    },
    order: ['A', 'B', 'A', 'C', 'B', 'D', 'C', 'D'],
    bass: [-1, -1, -1, -3],
  },
  // 撤离/突袭：安静紧张，稀疏，16 小节
  raid: {
    bpm: 88, fluteRoot: 523.25, level: 0.8,
    phrases: {
      A: [4, _, _, _, _, _, 2, _, 3, _, _, _, _, _, _, _],
      B: [_, _, 2, _, _, _, 3, _, 4, _, _, _, 2, _, _, _],
      C: [3, _, _, _, 2, _, _, _, 0, _, _, _, _, _, _, _],
      D: [_, _, 0, _, 2, _, 0, _, 4, _, _, _, _, _, _, _],
    },
    order: ['A', 'B', 'A', 'C', 'B', 'A', 'D', 'C'],
    bass: [0, 0, -1, -1],
  },
};

const PENT = [0, 2, 4, 7, 9];
function pent(deg: number, root: number): number {
  const oct = Math.floor(deg / 5);
  const i = ((deg % 5) + 5) % 5;
  return root * 2 ** (oct + (PENT[i] ?? 0) / 12);
}

// ---------- 发声（音乐自己的节点计数，上限比音效低，保证两边合计不失控）----------
const MAX_MUSIC_VOICES = 18;
let mv = 0;

interface Env {
  ctx: AudioContext;
  out: GainNode;       // 当前曲目的音量节点（换曲时单独淡出）
  noise: AudioBuffer;
}

function tone(e: Env, type: OscillatorType, f: number, t: number, dur: number, v: number, atk: number,
  vib?: [number, number]): void {
  if (mv >= MAX_MUSIC_VOICES) return;
  const osc = e.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = f;
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + Math.min(atk, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(e.out);
  let lfo: OscillatorNode | null = null;
  let lg: GainNode | null = null;
  if (vib && mv + 1 < MAX_MUSIC_VOICES) {
    lfo = e.ctx.createOscillator();
    lfo.frequency.value = vib[0];
    lg = e.ctx.createGain();
    lg.gain.value = vib[1];
    lfo.connect(lg);
    lg.connect(osc.detune);
    mv++;
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    lfo.onended = () => { mv--; lfo!.disconnect(); lg!.disconnect(); };
  }
  mv++;
  osc.onended = () => { mv--; osc.disconnect(); g.disconnect(); };
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(e: Env, type: BiquadFilterType, f: number, q: number, t: number, dur: number, v: number,
  atk = 0.005): void {
  if (mv >= MAX_MUSIC_VOICES) return;
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  src.loop = true;
  const flt = e.ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + Math.min(atk, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(e.out);
  mv++;
  src.onended = () => { mv--; src.disconnect(); flt.disconnect(); g.disconnect(); };
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

/** 笛子：正弦 + 三角叠出圆润的基音，缓起，加颤音和一点气声。 */
function flute(e: Env, f: number, t: number, dur: number, v: number, bright: boolean): void {
  tone(e, 'sine', f, t, dur, v, 0.07, [5, bright ? 8 : 12]);
  tone(e, 'triangle', f, t, dur, v * (bright ? 0.5 : 0.3), 0.07);
  noise(e, 'bandpass', Math.min(f * 2, 6000), 4, t, Math.min(dur, 0.35), v * 0.35, 0.05);
}

/** 古筝：三角波瞬间起音、短衰减，外加一个二倍音的"弦响"。 */
function zheng(e: Env, f: number, t: number, v: number): void {
  tone(e, 'triangle', f, t, 0.55, v, 0.003);
  tone(e, 'sine', f * 2, t, 0.25, v * 0.25, 0.003);
}

function drum(e: Env, t: number, v: number, f = 110): void {
  const osc = e.ctx.createOscillator();
  if (mv >= MAX_MUSIC_VOICES) return;
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  osc.connect(g);
  g.connect(e.out);
  mv++;
  osc.onended = () => { mv--; osc.disconnect(); g.disconnect(); };
  osc.start(t);
  osc.stop(t + 0.35);
  noise(e, 'lowpass', 500, 0.7, t, 0.08, v * 0.4);
}

function gong(e: Env, t: number, f: number): void {
  [1, 1.52, 2.1, 3.4].forEach((r, i) => tone(e, 'sine', f * r, t, 3.2 / (1 + i * 0.6), 0.2 / (1 + i * 0.7), 0.01));
  noise(e, 'bandpass', 1800, 1.5, t, 0.25, 0.08);
}

// ---------- 逐步调度 ----------
let intensity: Level = 0;

/** 调度第 step 个八分音符（一小节 8 步）。 */
function scheduleStep(name: TrackName, e: Env, step: number, t: number, stepDur: number): void {
  const def = TRACKS[name];
  const bar = Math.floor(step / 8);
  const s = step % 8;
  const phraseIdx = Math.floor(bar / 2) % def.order.length;
  const phrase = def.phrases[def.order[phraseIdx] ?? 'A'] ?? [];
  const pos = (bar % 2) * 8 + s;
  const bassDeg = def.bass[bar % def.bass.length] ?? 0;
  const bassRoot = def.fluteRoot / 4;
  const lv = intensity;
  const quiet = name === 'raid';

  // 笛子主旋律：一个音持续到下一个音前
  const deg = phrase[pos];
  if (deg !== null && deg !== undefined) {
    let len = 1;
    while (pos + len < 16 && phrase[pos + len] === null) len++;
    const dur = len * stepDur * 0.97;
    const v = quiet ? 0.1 : 0.14;
    flute(e, pent(deg, def.fluteRoot), t, dur, v, name === 'boss');
    if (lv >= 3) flute(e, pent(deg - 3, def.fluteRoot), t, dur, v * 0.45, false); // 加层：下方五度叠音
  }

  // 古筝分解和弦：越往后越密
  const arp = [0, 2, 1, 2, 3, 2, 1, 2];
  const zhengOn =
    name === 'boss' ? (lv >= 1 || s % 2 === 0)
    : name === 'raid' ? (lv >= 3 ? s % 2 === 0 : lv >= 1 && s % 4 === 0)
    : (lv >= 3 || (lv >= 1 && s % 2 === 0));
  if (zhengOn) {
    const chord = [0, 2, 3, 5][arp[s] ?? 0] ?? 0;
    zheng(e, pent(bassDeg + chord, def.fluteRoot / 2), t, quiet ? 0.07 : 0.1);
  }

  // 低鼓
  if (name === 'night') {
    const kicks = lv === 0 ? [0] : lv === 1 ? [0, 4] : lv === 2 ? [0, 4, 6] : [0, 2, 4, 6];
    if (kicks.includes(s)) drum(e, t, s === 0 ? 0.5 : 0.3);
    if (lv >= 2 && s % 2 === 1) noise(e, 'bandpass', 2800, 3, t, 0.04, 0.05); // 木鱼般的轻点
  } else if (name === 'boss') {
    if ([0, 3, 4, 7].includes(s) || (lv >= 2 && (s === 2 || s === 6))) drum(e, t, s === 0 ? 0.6 : 0.38, 95);
    if (bar % 4 === 0 && s === 0) gong(e, t, 98);
    if (lv >= 1 && s % 2 === 1) noise(e, 'bandpass', 3200, 3, t, 0.04, 0.06);
  } else {
    // 像心跳：咚—咚
    if (s === 0) drum(e, t, 0.32, 85);
    if (s === 1) drum(e, t, 0.2, 80);
    if (lv >= 2 && s === 4) drum(e, t, 0.2, 85);
    if (lv >= 1 && (s === 2 || s === 6)) noise(e, 'bandpass', 3000, 4, t, 0.03, 0.04);
  }

  // 低音长垫（两小节换一次）：night 加层后、boss 常驻、raid 一开始就有，托住紧张感
  if (s === 0 && bar % 2 === 0) {
    const padOn = name === 'boss' || (name === 'night' && lv >= 2) || (name === 'raid' && lv >= 1);
    if (padOn) {
      const dur = stepDur * 16;
      tone(e, 'sine', pent(bassDeg, bassRoot), t, dur, 0.1, 0.6);
      tone(e, 'sine', pent(bassDeg + 3, bassRoot), t, dur, 0.05, 0.8);
    }
  }
}

// ---------- 播放控制 ----------
const LOOKAHEAD = 0.25;   // 提前调度多少秒
const TICK_MS = 60;

let enabled = readFlag('music', true);
let wanted: TrackName | null = null;     // 想播的曲目（即使暂时没解锁/被关掉也记着）
let current: { name: TrackName; env: Env } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;

function clearTimer(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
}

function fadeOutCurrent(sec: number): void {
  if (!current) return;
  const { ctx, out } = current.env;
  const t = ctx.currentTime;
  out.gain.cancelScheduledValues(t);
  out.gain.setValueAtTime(out.gain.value, t);
  out.gain.linearRampToValueAtTime(0.0001, t + sec);
  // 淡出后摘掉；已调度的长音尾巴（锣）也一并被静音
  setTimeout(() => { try { out.disconnect(); } catch { /* 已断开 */ } }, sec * 1000 + 300);
  current = null;
}

function tick(): void {
  if (!current) return;
  const { ctx } = current.env;
  if (ctx.state !== 'running') return;
  // 切后台被浏览器降频、落后太多时重新对齐，免得一口气补一堆音
  if (nextTime < ctx.currentTime - 0.1) nextTime = ctx.currentTime + 0.05;
  const def = TRACKS[current.name];
  const stepDur = 60 / def.bpm / 2;
  const total = def.order.length * 16;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    try {
      scheduleStep(current.name, current.env, step % total, nextTime, stepDur);
    } catch { /* 音乐出错也不能影响游戏 */ }
    nextTime += stepDur;
    step++;
  }
}

function begin(): void {
  clearTimer();
  if (!enabled || !wanted) return;
  const bus = audioBus();
  if (!bus) return; // 还没解锁：解锁后会再回调
  const first = !current;
  if (current && current.name === wanted) { timer = setInterval(tick, TICK_MS); return; }
  const prevFade = current ? 1.2 : 0;
  if (current) fadeOutCurrent(prevFade);
  const out = bus.ctx.createGain();
  const target = TRACKS[wanted].level * 0.9;
  const t0 = bus.ctx.currentTime;
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(target, t0 + (first ? 1 : 1.4));
  out.connect(bus.musicIn);
  current = { name: wanted, env: { ctx: bus.ctx, out, noise: bus.noise } };
  step = 0;
  nextTime = t0 + 0.1;
  timer = setInterval(tick, TICK_MS);
  tick();
}

export const music = {
  start(track: 'night' | 'boss' | 'raid'): void {
    if (typeof setInterval !== 'function') return;
    wanted = track;
    if (current && current.name === track && timer !== null) return;
    onAudioReady(begin); // 已解锁则立即执行，否则等 sfx.unlock()
  },
  setIntensity(level: 0 | 1 | 2 | 3): void {
    intensity = level;
  },
  stop(): void {
    wanted = null;
    clearTimer();
    fadeOutCurrent(0.8);
  },
  setEnabled(on: boolean): void {
    enabled = on;
    writeFlag('music', on);
    if (on) {
      onAudioReady(begin);
    } else {
      clearTimer();
      fadeOutCurrent(0.4);
    }
  },
  get enabled(): boolean { return enabled; },
};
