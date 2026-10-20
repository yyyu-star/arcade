/**
 * 斗地主的单机会话（牌馆 0.28.0，docs/doudizhu.md 第 4、5 节）：我是 0 号，1 号下家老周、2 号上家王姐都是电脑。
 * 和掼蛋的 Session 同一个思路：推进只走规则核心的 dispatchDdz，事件交给画面一条条播；电脑只拿 viewDdz；
 * 电脑的随机数按这一局的种子另外派生（和发牌的流不相干，见 session.ts 的 soloSeeds）。存档、战绩在 store.ts（guandan.ddz.*）。
 */
import { hashSeed } from '../core/rng.ts';
import {
  createDdz, decideDdz, dispatchDdz, viewDdz,
  type DdzAction, type DdzEvent, type DdzLevel, type DdzOptions, type DdzState, type DdzView,
} from '../variants/doudizhu/index.ts';
import type { DailySubmit } from './ddz-daily.ts';
import { clearDdzSave, loadDdzSave, recordDdzDeal, recordDdzGame, writeDdzSave } from './store.ts';

export const DDZ_ME = 0;

/** 电脑的随机流：只和这一局的种子有关，电脑拿不到发牌的种子 */
export function ddzSeeds(seed: string): { ai: number } {
  return { ai: hashSeed(seed, 'ddz-solo-ai') };
}

export class DdzSession {
  state: DdzState;
  level: DdzLevel;
  /** 进场时要播的事件（新开的一局） */
  lastEvents: DdzEvent[];
  /** 调试：电脑代打我 */
  autoplay = false;
  /** 存档、记战绩（测试、调试开局、每日挑战关掉） */
  persist = true;
  /** 每日挑战的日期（北京时间）；null 是平常的一局 */
  daily: string | null = null;
  /** 每日挑战这一场交过分了（交分的结果，结束页重建时接着显示） */
  dailySent = false;
  dailyResult: Promise<DailySubmit> | null = null;
  private counted = false;
  private dealsCounted = 0;

  constructor(state: DdzState, events: DdzEvent[], level: DdzLevel) {
    this.state = state;
    this.lastEvents = events;
    this.level = level;
  }

  /** persist 为假：调试开局（URL 带种子）时已有存档就不写，免得覆盖玩家进度 */
  static fresh(seed: string, level: DdzLevel, opts?: Partial<DdzOptions>, persist = true): DdzSession {
    const { state, events } = createDdz(seed, opts);
    const s = new DdzSession(state, events, level);
    s.persist = persist;
    s.save();
    return s;
  }

  static restore(): DdzSession | null {
    const d = loadDdzSave();
    if (!d || d.state.phase === 'gameOver') return null;
    const s = new DdzSession(d.state, [], d.level);
    s.counted = d.counted;
    s.dealsCounted = d.dealsCounted;
    return s;
  }

  view(seat = DDZ_ME): DdzView {
    return viewDdz(this.state, seat);
  }

  /** 推进一步；非法时回 error，状态不变 */
  apply(a: DdzAction): { events: DdzEvent[]; error: string | null } {
    const r = dispatchDdz(this.state, a);
    if (r.error) return { events: [], error: r.error };
    this.state = r.state;
    for (const e of r.events) {
      if (e.type === 'dealEnd' && this.persist && this.state.results.length > this.dealsCounted) {
        this.dealsCounted = this.state.results.length;
        const me = e.result.delta[DDZ_ME]!;
        recordDdzDeal(me > 0, e.result.landlord === DDZ_ME, e.result.spring !== null);
      }
      if (e.type === 'gameOver' && this.persist && !this.counted) {
        this.counted = true;
        recordDdzGame(this.state.scores[DDZ_ME]! > 0);
      }
    }
    this.save();
    return { events: r.events, error: null };
  }

  isBot(seat: number): boolean {
    return seat !== DDZ_ME || this.autoplay;
  }

  /** 电脑（或代打的我）在这个座位的决定：代打的我按最强 */
  botAction(seat: number): DdzAction | null {
    const level: DdzLevel = seat === DDZ_ME ? 'pro' : this.level;
    return decideDdz(this.view(seat), level, `${ddzSeeds(this.state.seed).ai}|${seat}|${this.state.step}`);
  }

  save(): void {
    if (!this.persist) return;
    if (this.state.phase === 'gameOver') clearDdzSave();
    else writeDdzSave({ v: 1, state: this.state, level: this.level, counted: this.counted, dealsCounted: this.dealsCounted });
  }
}
