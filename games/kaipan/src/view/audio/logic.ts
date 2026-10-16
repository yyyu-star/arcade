/**
 * 音频层的纯逻辑：不触碰 Web Audio，便于在 Node 下单元测试。
 * 包括音阶/和弦生成、调度时间计算、节流、增益映射、揭晓/连线/滚动音高、结算分档、并发音效淘汰策略等。
 */
import type { Settings } from '../../platform/settings.ts';
import type { Cue, Mood } from './types.ts';

// ───────────────────────── 基础换算 ─────────────────────────

/** MIDI 音高 → 频率（A4 = 69 = 440 Hz）。 */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** 线性增益 → dB；0 返回 -Infinity。 */
export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ───────────────────────── 增益映射 ─────────────────────────

/**
 * 音量滑条（0..1）→ 线性增益。用平方律近似人耳的对数感知：
 * 0.5 ≈ -12 dB，0.8 ≈ -1.9 dB；非有限值按 0 处理。
 */
export function volumeToGain(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = clamp(v, 0, 1);
  return c * c;
}

export interface BusLevels {
  /** 主输出增益（含静音） */
  master: number;
  sfx: number;
  music: number;
}

/** 设置 → 三个增益节点的目标值；实际听感增益 = master × 分项 × (muted ? 0 : 1)。 */
export function busLevels(s: Pick<Settings, 'masterVolume' | 'sfxVolume' | 'musicVolume' | 'muted'>): BusLevels {
  return {
    master: s.muted ? 0 : volumeToGain(s.masterVolume),
    sfx: volumeToGain(s.sfxVolume),
    music: volumeToGain(s.musicVolume),
  };
}

/** 设置下是否有可能出声：静音或总音量为 0 时一律不发声（连音效节点都不创建）。 */
export function audible(s: Pick<Settings, 'masterVolume' | 'muted'>): boolean {
  return !s.muted && volumeToGain(s.masterVolume) > 0;
}

/** 改设置时的增益斜坡时长（秒），≥ 30 ms 防爆音。 */
export const LEVEL_RAMP = 0.05;

// ───────────────────────── 随机数 ─────────────────────────

/** mulberry32：可复现的小型伪随机数，供生成式音乐与音效的细微变化使用。 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** [lo, hi) 均匀分布 */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    const v = arr[this.int(arr.length)];
    if (v === undefined) throw new Error('Rng.pick: 空数组');
    return v;
  }
}

// ───────────────────────── 音阶与和弦 ─────────────────────────

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

type ScaleName = keyof typeof SCALES;

/** 音阶第 degree 级（0 起，可为负或超过一个八度）的 MIDI 音高。 */
export function scaleNote(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return root + oct * 12 + (scale[idx] ?? 0);
}

/** 在音阶内以三度叠置构造和弦：degree 为根音级数，size 为音数（3 三和弦，4 七和弦，5 九和弦）。 */
export function buildChord(root: number, scale: readonly number[], degree: number, size = 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(scaleNote(root, scale, degree + i * 2));
  return out;
}

/**
 * 声部进行：把和弦音按八度移位到 [lo, hi] 音域内，并选取与上一个和弦总移动最小的转位，
 * 让铺底和弦平滑衔接而不是整体跳动。
 */
export function voiceLead(prev: readonly number[] | null, chord: readonly number[], lo: number, hi: number): number[] {
  const pcs = chord.map((m) => ((m % 12) + 12) % 12);
  const candidates: number[][] = [];
  // 所有转位：以第 r 个音为最低音，依次向上叠
  for (let r = 0; r < pcs.length; r++) {
    for (let base = lo; base < lo + 12; base++) {
      if (base % 12 !== pcs[r]) continue;
      const v: number[] = [base];
      for (let k = 1; k < pcs.length; k++) {
        const pc = pcs[(r + k) % pcs.length] ?? 0;
        let m = (v[k - 1] ?? base) + 1;
        while (((m % 12) + 12) % 12 !== pc) m++;
        v.push(m);
      }
      if ((v[v.length - 1] ?? 0) <= hi) candidates.push(v);
    }
  }
  if (candidates.length === 0) return chord.slice();
  if (!prev || prev.length === 0) {
    // 无前一个和弦：取最低音最接近音域中部偏下的转位
    const target = lo + (hi - lo) * 0.35;
    return candidates.reduce((a, b) => (Math.abs((b[0] ?? 0) - target) < Math.abs((a[0] ?? 0) - target) ? b : a));
  }
  const cost = (v: readonly number[]): number => {
    let c = 0;
    for (const m of v) {
      let best = Infinity;
      for (const p of prev) best = Math.min(best, Math.abs(m - p));
      c += best;
    }
    return c;
  };
  return candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

/** 从候选里挑一个与上次不同的下标（候选只有一个时允许重复）。 */
export function pickDifferent(n: number, prev: number, rng: Rng): number {
  if (n <= 1) return 0;
  let i = rng.int(n - 1);
  if (i >= prev && prev >= 0) i++;
  return i;
}

// ───────────────────────── 调度时间 ─────────────────────────

/** 一个步进（十六分音符）的时长（秒）。 */
export function stepDuration(bpm: number, stepsPerBeat = 4): number {
  return 60 / bpm / stepsPerBeat;
}

interface DueSteps {
  /** 需要排程的步序号与对应时间 */
  steps: { index: number; time: number }[];
  nextIndex: number;
  nextTime: number;
}

/**
 * 前瞻调度：返回 [now, now + horizon) 内所有尚未排程的步。
 * 若计时器迟到（比如页面卡顿），已经过去超过 maxLate 秒的步直接跳过，避免一次性挤出一堆音符。
 */
export function dueSteps(
  nextIndex: number,
  nextTime: number,
  now: number,
  horizon: number,
  stepDur: number,
  maxLate = 0.05,
): DueSteps {
  let i = nextIndex;
  let t = nextTime;
  if (t < now - maxLate) {
    const skip = Math.ceil((now - maxLate - t) / stepDur);
    i += skip;
    t += skip * stepDur;
  }
  const steps: { index: number; time: number }[] = [];
  const end = now + horizon;
  while (t < end) {
    steps.push({ index: i, time: Math.max(t, now) });
    i++;
    t += stepDur;
  }
  return { steps, nextIndex: i, nextTime: t };
}

// ───────────────────────── 节流 ─────────────────────────

/** 最小间隔节流：两次放行之间至少间隔 minInterval 秒。 */
export class Throttle {
  private last = -Infinity;
  private readonly minInterval: number;
  constructor(minInterval: number) {
    this.minInterval = minInterval;
  }
  allow(now: number): boolean {
    if (now - this.last < this.minInterval) return false;
    this.last = now;
    return true;
  }
  reset(): void {
    this.last = -Infinity;
  }
}

/**
 * 连发型 cue 的最小间隔（秒）：账户滚动每帧都可能发，合并到约 33 次/秒；
 * 群聊、揭晓、连线、道具只合并同一帧内的重复（正常节奏不会被吞）。
 */
export const RAPID_INTERVAL: Partial<Record<Cue['type'], number>> = {
  countUp: 0.03,
  chat: 0.02,
  reveal: 0.02,
  chain: 0.02,
  item: 0.02,
};

// ───────────────────────── 音效参数映射 ─────────────────────────

/** 音效与音乐共用的调性主音（D）。 */
const KEY_ROOT = 62; // D4

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/** 群聊“叮”的音级循环（五声音阶，A5 起）：同一天连续几条略有起伏，不机械重复。 */
const CHAT_STEPS = [0, 1, 2, 1, 3, 2] as const;

/** 群聊第 index 条（0 起）的音高：A5 起在五声音阶上小幅起伏，范围 A5–E6。 */
export function chatPitch(index: number): number {
  const i = Math.max(0, Math.floor(finite(index)));
  return scaleNote(KEY_ROOT + 12, SCALES.majorPentatonic, 3 + (CHAT_STEPS[i % CHAT_STEPS.length] ?? 0));
}

/** 揭晓音高的满量程（百分点）：±REVEAL_RANGE 对应 ±REVEAL_STEPS 个五声音级，超出夹住。 */
export const REVEAL_RANGE = 10;
const REVEAL_STEPS = 7;
/** |move| 低于此值（百分点）视为平盘 */
const REVEAL_FLAT = 0.5;

/**
 * 持仓揭晓的音高：个股涨跌 move（百分点）线性映射到 D 大调五声音阶（涨高跌低），
 * 中心 D5，±10% 对应 ±7 级（A3 … F♯6），单调不减、有界；非有限按 0。返回 MIDI 音高。
 */
export function revealPitch(move: number): number {
  const m = clamp(finite(move), -REVEAL_RANGE, REVEAL_RANGE);
  const deg = Math.round((m / REVEAL_RANGE) * REVEAL_STEPS);
  return scaleNote(KEY_ROOT + 12, SCALES.majorPentatonic, deg);
}

type RevealTier = 'limitUp' | 'up' | 'flat' | 'down' | 'limitDown';

/** 揭晓分档：涨停/跌停优先，其次按 move 正负（|move| < REVEAL_FLAT 为平）。 */
export function revealTier(move: number, limit: 'up' | 'down' | null): RevealTier {
  if (limit === 'up') return 'limitUp';
  if (limit === 'down') return 'limitDown';
  const m = finite(move);
  if (Math.abs(m) < REVEAL_FLAT) return 'flat';
  return m > 0 ? 'up' : 'down';
}

/** 连线音高的最高级数：第 CHAIN_MAX_STEP 条起不再上升。 */
export const CHAIN_MAX_STEP = 7;

/** 龙头带动的连线：第 index 条（0 起）沿 D 大调五声音阶逐条上行，F♯5 起（第 7 条 B6），超过上限夹住。 */
export function chainPitch(index: number): number {
  const i = clamp(Math.floor(finite(index)), 0, CHAIN_MAX_STEP);
  return scaleNote(KEY_ROOT + 12, SCALES.majorPentatonic, 2 + i);
}

/** 账户滚动：进度 0..1 → 沿 D 大调音阶上行 10 级（像计价器越跳越高），D5 起。 */
export function countUpPitch(progress: number): number {
  const p = clamp(finite(progress), 0, 1);
  return scaleNote(KEY_ROOT + 12, SCALES.major, Math.round(p * 10));
}

interface HeatMix {
  /** 升温 / 退潮各自的份额（0..1，二者之和为 1；都没动时均为 0） */
  warm: number;
  cool: number;
  /** 整体力度 0.3..1，由最大 |ΔH| 决定 */
  intensity: number;
}

/** 热度满力度对应的 |ΔH|（题材热度单日变化通常在 ±25 以内） */
const HEAT_FULL = 20;

/** 热度变化 → 升温火苗与退潮冰晶的混合比例和力度。 */
export function heatMix(up: number, down: number, max: number): HeatMix {
  const u = Math.max(0, finite(up));
  const d = Math.max(0, finite(down));
  const intensity = clamp(Math.abs(finite(max)) / HEAT_FULL, 0.3, 1);
  if (u + d === 0) return { warm: 0, cool: 0, intensity };
  return { warm: u / (u + d), cool: d / (u + d), intensity };
}

type HeatTier = 'up' | 'down' | 'mixed' | 'none';

export function heatTier(up: number, down: number): HeatTier {
  const u = Math.max(0, finite(up));
  const d = Math.max(0, finite(down));
  if (u > 0 && d > 0) return 'mixed';
  if (u > 0) return 'up';
  if (d > 0) return 'down';
  return 'none';
}

type SettleTier = 'bigWin' | 'win' | 'flat' | 'loss' | 'bigLoss';

/** 持平阈值（百分点）：|ret| 低于此值视为持平 */
export const SETTLE_FLAT = 0.3;
/** 大赚 / 大亏阈值（百分点）：账户单日 ±4% 已是很大的波动 */
export const SETTLE_BIG = 4;

/** 账户当日收益分档：ret 为百分点；非有限按持平。 */
export function settleTier(ret: number): SettleTier {
  if (!Number.isFinite(ret) || Math.abs(ret) < SETTLE_FLAT) return 'flat';
  if (ret >= SETTLE_BIG) return 'bigWin';
  if (ret <= -SETTLE_BIG) return 'bigLoss';
  return ret > 0 ? 'win' : 'loss';
}

/** 正负分档（事件结果、道具改动）：正为 gain，负为 loss，0 或非法为 none。 */
export function signTier(delta: number): 'gain' | 'loss' | 'none' {
  const d = finite(delta);
  return d > 0 ? 'gain' : d < 0 ? 'loss' : 'none';
}

// ───────────────────────── 音效分类、优先级与闪避 ─────────────────────────

/** 响度/优先级层级：micro（账户滚动这类高频小跳音）< ui < event < big */
type SfxCategory = 'micro' | 'ui' | 'event' | 'big';

interface CueProfile {
  category: SfxCategory;
  /** 并发超限时的保留优先级：越大越不容易被挤掉 */
  priority: number;
  /** 音乐闪避深度（dB，0 为不闪避）与保持时长（秒） */
  duckDb: number;
  duckHold: number;
}

const PRIORITY: Record<SfxCategory, number> = { micro: 0, ui: 1, event: 2, big: 3 };

function profile(category: SfxCategory, duckDb = 0, duckHold = 0): CueProfile {
  return { category, priority: PRIORITY[category], duckDb, duckHold };
}

/** 每种 cue 的分类：决定响度层级、并发优先级与是否闪避音乐。 */
export function cueProfile(c: Cue): CueProfile {
  switch (c.type) {
    case 'countUp':
      return profile('micro');
    case 'ui':
    case 'chat':
    case 'guide':
      return profile('ui');
    case 'settle': {
      const t = settleTier(c.ret);
      if (t === 'bigWin') return profile('big', -5, 1.2);
      if (t === 'bigLoss') return profile('big', -5, 1.1);
      return profile('event');
    }
    case 'limitUp':
      return profile('big', -4, 1.4);
    case 'stamp':
      return profile('big', -5, 1.0);
    case 'runWon':
      return profile('big', -6, 2.6);
    case 'runLost':
      return profile('big', -6, 2.0);
    // 中等事件：轻闪避，让低沉/长的声音透出来
    case 'limitDown':
      return profile('event', -3, 1.2);
    case 'weather':
      return c.to === 'bear' ? profile('event', -3, 1.2) : profile('event');
    case 'monthStart':
      return profile('event', -3, 0.8);
    case 'buy':
    case 'sell':
    case 'marketOpen':
    case 'thunder':
    case 'heat':
    case 'reveal':
    case 'chain':
    case 'item':
    case 'news':
    case 'autoSold':
    case 'judge':
    case 'bill':
    case 'rewardShow':
    case 'reward':
    case 'event':
    case 'eventResult':
    case 'friendJoin':
      return profile('event');
  }
}

/** 变体名：用于试听面板、测量表格和调试日志，例如 `settle:bigWin`、`reveal:limitUp`。 */
export function cueKey(c: Cue): string {
  switch (c.type) {
    case 'ui':
      return `ui:${c.name}`;
    case 'weather':
      return `weather:${c.to}`;
    case 'heat':
      return `heat:${heatTier(c.up, c.down)}`;
    case 'reveal':
      return `reveal:${revealTier(c.move, c.limit)}`;
    case 'item':
      return `item:${c.delta < 0 ? 'minus' : 'plus'}`;
    case 'news':
      return `news:${c.kind}`;
    case 'autoSold':
      return `autoSold:${c.reason}`;
    case 'settle':
      return `settle:${settleTier(c.ret)}`;
    case 'judge':
      return `judge:${c.hit ? 'hit' : 'miss'}`;
    case 'stamp':
      return `stamp:${c.paid ? 'paid' : 'overdue'}${c.credit ? '+credit' : ''}`;
    case 'reward':
      return `reward:${c.kind ?? 'skip'}`;
    case 'eventResult':
      return `eventResult:${signTier(c.delta)}`;
    default:
      return c.type;
  }
}

interface VoiceInfo {
  priority: number;
  start: number;
}

/**
 * 并发超限时选择要淘汰的音效：优先级最低者中最旧的一个。
 * 若新音效的优先级比所有在播音效都低，返回 -1 表示直接丢弃新音效。
 */
export function pickVictim(voices: readonly VoiceInfo[], incomingPriority: number): number {
  let idx = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const best = idx >= 0 ? voices[idx] : undefined;
    if (!v) continue;
    if (!best || v.priority < best.priority || (v.priority === best.priority && v.start < best.start)) idx = i;
  }
  const victim = idx >= 0 ? voices[idx] : undefined;
  if (!victim || victim.priority > incomingPriority) return -1;
  return idx;
}

// ───────────────────────── 音乐：情绪 ─────────────────────────

/** 情绪切换的交叉淡化时长（秒） */
export const CROSSFADE = 1.8;

/** 情绪是否需要调度音符。 */
function moodPlays(m: Mood): boolean {
  return m !== 'silent';
}

/** 音乐是否应当调度：已解锁、未暂停、非 silent。 */
export function shouldSchedule(unlocked: boolean, paused: boolean, mood: Mood): boolean {
  return unlocked && !paused && moodPlays(mood);
}

/**
 * 闪避包络：在 at 时刻压低 depthDb，保持 hold 秒后用 release 秒恢复。
 * 多个大音效重叠时取更深、更晚结束的那个：返回合并后的 (depth, until)。
 */
export function mergeDuck(
  cur: { depthDb: number; until: number } | null,
  at: number,
  depthDb: number,
  hold: number,
): { depthDb: number; until: number } {
  const until = at + hold;
  if (!cur || cur.until <= at) return { depthDb, until };
  return { depthDb: Math.min(cur.depthDb, depthDb), until: Math.max(cur.until, until) };
}
