/**
 * 回放驱动：按录像逐拍喂核心，支持暂停、1×、2×、4×。画面层每帧调 `advance(毫秒)`，然后照常画 `world`
 * （和实打同一个场景，只是输入来自录像，不读键盘 / 摇杆）。
 * 规则版本和现在不一样的录像照放，但标 `outdated`（"旧版本，可能放不对"）；放完（或放歪了）用最后的状态指纹对一下，`exact` 告诉你放得对不对。
 */
import { createWorld, fingerprint, RULES_VERSION, step, TICKS_PER_SECOND, type World } from '../core/index.ts';
import { decodeDirs, decodePicks, type ReplayRecord } from './format.ts';

export type Speed = 1 | 2 | 4;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
/** 一次 advance 最多推多少拍：切后台回来不要一口气卡住画面 */
const MAX_TICKS_PER_CALL = 60;
/** 选卡阶段录像里没有对应选择（放歪了）时选第一张，免得卡死 */
const FALLBACK_PICK = 0;

/** step 会改 phase，让 TS 别按进函数时的值收窄 */
const phaseOf = (w: World): World['phase'] => w.phase;

export class ReplayPlayer {
  readonly world: World;
  readonly outdated: boolean;
  speed: Speed = 1;
  paused = false;
  /** 每推一拍之后（画面层读这一拍的事件：特效、音效、数字） */
  onStep: () => void = () => undefined;
  private readonly dirs: Uint8Array;
  private readonly picks: { tick: number; choice: number }[];
  private at = 0;
  private pickAt = 0;
  private acc = 0;

  readonly record: ReplayRecord;

  private constructor(record: ReplayRecord, dirs: Uint8Array, picks: { tick: number; choice: number }[]) {
    this.record = record;
    this.dirs = dirs;
    this.picks = picks;
    this.outdated = record.rules !== RULES_VERSION;
    // 设置快照里多出来的字段（danger、curses 等）核心认了就用，不认就被忽略
    this.world = createWorld(record.setup);
  }

  /** 录像坏了（方向串解不开）返回 null */
  static from(record: ReplayRecord): ReplayPlayer | null {
    const dirs = decodeDirs(record.dirs, record.ticks);
    const picks = decodePicks(record.picks);
    return dirs && picks ? new ReplayPlayer(record, dirs, picks) : null;
  }

  /** 放完了：方向用完，或者局已经结束 */
  get done(): boolean {
    return this.at >= this.dirs.length || this.world.phase === 'over';
  }

  /** 进度 0–1 */
  get progress(): number {
    return this.dirs.length === 0 ? 1 : Math.min(1, this.at / this.dirs.length);
  }

  /** 放完以后：状态指纹和录制时一样才算放得对 */
  get exact(): boolean | null {
    return this.done && this.at === this.dirs.length ? fingerprint(this.world) === this.record.fp : null;
  }

  /** 画面每帧调一次；返回这次推进了几拍（画面做插值用 world 里的上一拍位置） */
  advance(dtMs: number): number {
    if (this.paused || this.done) return 0;
    this.acc += Math.max(0, dtMs) * this.speed;
    let n = 0;
    while (this.acc + 1e-6 >= MS_PER_TICK && n < MAX_TICKS_PER_CALL && !this.done) {
      this.acc = Math.max(0, this.acc - MS_PER_TICK);
      this.tickOnce();
      n++;
    }
    if (n === MAX_TICKS_PER_CALL) this.acc = 0;
    return n;
  }

  /** 推一拍（暂停时单步用） */
  tickOnce(): void {
    const w = this.world;
    if (this.done) return;
    // 选卡阶段不推进时间：把录像里这一拍的选择依次喂进去，直到回到 play
    let guard = 0;
    while (w.phase === 'choose' && guard++ < 64) {
      const p = this.picks[this.pickAt];
      if (p) this.pickAt++;
      step(w, 0, p ? p.choice : FALLBACK_PICK);
      this.onStep();
    }
    if (phaseOf(w) !== 'play') return;
    step(w, this.dirs[this.at]!, -1);
    this.at++;
    this.onStep();
    // 这一拍把局推进到了选卡：马上把这一拍后面录好的选择喂掉，画面不用停在一张看不出谁点的卡上
    guard = 0;
    while (phaseOf(w) === 'choose' && this.pickAt < this.picks.length && guard++ < 64) {
      step(w, 0, this.picks[this.pickAt++]!.choice);
      this.onStep();
    }
  }
}
