/**
 * 录像录制：在每次调 `step` 之前调一下 `before(world, dir, choice)`。
 * 只记推进时间的拍（phase 为 play 的调用）的方向，和选卡阶段的选择（带当时的拍号）；选卡阶段画面每帧都在调 step，那些空转的不记。
 */
import { fingerprint, RULES_VERSION, type World } from '../core/index.ts';
import type { OnlineSetup } from '../online/types.ts';
import { encodeDirs, encodePicks, type ReplayRecord } from './format.ts';

export class Recorder {
  private dirs: number[] = [];
  private picks: { tick: number; choice: number }[] = [];

  readonly setup: OnlineSetup;
  readonly at: number;

  constructor(setup: OnlineSetup, at: number) {
    this.setup = setup;
    this.at = at;
  }

  /** 要在 step(w, dir, choice) 之前调，参数和 step 一样 */
  before(w: World, dir: number, choice = -1): void {
    if (w.phase === 'play') this.dirs.push(Number.isInteger(dir) && dir >= 0 && dir <= 32 ? dir : 0);
    else if (w.phase === 'choose' && choice >= 0) this.picks.push({ tick: w.tick, choice });
  }

  get ticks(): number {
    return this.dirs.length;
  }

  /** 打完（或认输）时封存；summary 由结算页算好传进来 */
  finish(w: World, summary: ReplayRecord['summary'], scores: Record<string, number> = {}): ReplayRecord {
    return {
      v: 1,
      id: `${this.at.toString(36)}-${(this.setup.seed >>> 0).toString(36)}`,
      rules: RULES_VERSION,
      at: this.at,
      setup: this.setup,
      dirs: encodeDirs(this.dirs),
      ticks: this.dirs.length,
      picks: encodePicks(this.picks),
      fp: fingerprint(w),
      summary,
      bestFor: [],
      scores,
    };
  }
}
