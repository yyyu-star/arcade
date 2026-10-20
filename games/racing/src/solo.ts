/**
 * 单机（DESIGN.md 第 4 节）：在浏览器里对电脑跑一场，不连房间、不占任何额度。
 * - 电脑交计划不用等（马上交），亮牌以后电脑一步一步来，每步等画面放完动画再接着走；
 * - 每一步存进 racing.solo，关了页面回来接着跑；跑完删掉。
 */
import { stream } from 'arcade-kit/rng';
import { decide } from './ai/index.ts';
import { pickPersonas, PERSONAS } from './ai/personas.ts';
import { apply, begin, current, decline, pending, RULES_VERSION } from './core/rules.ts';
import type { Action, Opts, State } from './core/types.ts';
import { view, type View } from './core/view.ts';

export const SOLO_KEY = 'racing.solo';
export const ME = 0;

export interface SoloSave {
  v: 1;
  state: State;
  names: string[];
}

export interface SoloUi {
  /** 画一步：放完这一步的动画再 resolve */
  frame(v: View): Promise<void>;
  /** 一场跑完 */
  over(v: View): void;
}

export function loadSolo(): SoloSave | null {
  try {
    const raw = localStorage.getItem(SOLO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SoloSave;
    return s && s.v === 1 && s.state?.v === RULES_VERSION && s.state.phase !== 'over' ? s : null;
  } catch {
    return null;
  }
}

function persist(s: SoloSave): void {
  try {
    if (s.state.phase === 'over') localStorage.removeItem(SOLO_KEY);
    else localStorage.setItem(SOLO_KEY, JSON.stringify(s));
  } catch {
    // 存不上（隐私模式、满了）：这一场照跑，只是关了页面就接不上
  }
}

export function clearSolo(): void {
  try {
    localStorage.removeItem(SOLO_KEY);
  } catch {
    // 无所谓
  }
}

/** 开一场：密钥浏览器现生成（新手教程用写死的那把），0 号座位是自己 */
export function newSolo(opts: Opts, myName: string, key: number[] = [...crypto.getRandomValues(new Uint32Array(8))]): SoloSave {
  const bots = pickPersonas(stream(key, 'persona'), opts.level, opts.cars - 1);
  const kinds: ('human' | 'ai')[] = Array.from({ length: opts.cars }, (_, i) => (i === ME ? 'human' : 'ai'));
  const state = begin(key, opts, kinds, [-1, ...bots]);
  return { v: 1, state, names: [myName, ...bots.map((p) => PERSONAS[p]!.name)] };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export class Solo {
  /** 电脑每一步之后的停顿倍数（"快"是 0.5，冒烟 0.01） */
  speed = 1;
  private busy = false;
  private stopped = false;

  readonly save: SoloSave;
  private readonly ui: SoloUi;
  /** 存不存进 racing.solo：新手教程不存，也不能把玩家正在跑的那场续玩冲掉 */
  private readonly store: boolean;

  constructor(save: SoloSave, ui: SoloUi, store = true) {
    this.save = save;
    this.ui = ui;
    this.store = store;
  }

  get view(): View {
    return view(this.save.state, ME);
  }

  stop(): void {
    this.stopped = true;
  }

  async resume(): Promise<void> {
    await this.ui.frame({ ...this.view, events: [] });
    await this.pump();
  }

  /** 我出手；正在放动画、电脑在走时回 'busy'，不合法回错误码 */
  async act(a: Action): Promise<string | null> {
    if (this.busy) return 'busy';
    const r = apply(this.save.state, ME, a);
    if ('error' in r) return r.error;
    this.busy = true;
    try {
      await this.commit(r);
    } finally {
      this.busy = false;
    }
    await this.pump();
    return null;
  }

  private async commit(s: State): Promise<void> {
    this.save.state = s;
    if (this.store) persist(this.save);
    if (this.stopped) return;
    await this.ui.frame(view(s, ME));
  }

  /** 电脑接着走，直到轮到我或者跑完 */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    /** 电脑交了计划还没画：轮到我之前画一次，名次栏才看得到谁出好了 */
    let unshown = false;
    try {
      while (!this.stopped) {
        const s = this.save.state;
        if (s.phase === 'over') {
          this.ui.over(view(s, ME));
          return;
        }
        const who = s.phase === 'plan' ? pending(s) : [current(s)].filter((x): x is number => x !== null);
        const bot = who.find((i) => s.kinds[i] === 'ai');
        if (bot === undefined) {
          if (unshown) await this.ui.frame({ ...view(s, ME), events: [] });
          return;
        }
        let a = decide(view(s, bot), bot);
        let r = apply(s, bot, a);
        if ('error' in r && s.ask) {
          a = decline(s.ask);
          r = apply(s, bot, a);
        }
        if ('error' in r) throw new Error(`ai ${bot}: ${r.error}`);
        const planning = s.phase === 'plan' && r.phase === 'plan' && r.round === s.round;
        if (planning) {
          // 电脑交计划：不放动画，只更新"选好了"
          this.save.state = r;
          if (this.store) persist(this.save);
          unshown = true;
          continue;
        }
        unshown = false;
        await this.commit(r);
        if (r.events.some((e) => e.e === 'move')) await sleep(260 * this.speed);
      }
    } finally {
      this.busy = false;
    }
  }
}
