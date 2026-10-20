/**
 * 新手教程的流程（DESIGN.md 8.1）：第 0–3 课在第一回合交计划时一步步带着点，第 4–6 课在第二回合开始时讲，之后自由驾驶，
 * 冲刺、尾流、拼劲、弃牌的提问和过弯交热量、打滑、熄火各自第一次出现时冒一条提示，冲线以后毕业。
 *
 * 和单机的关系：教程就是一场单机（src/solo.ts，不存续玩），单机每画完一步调 frame：
 * - 讲解和提示在 frame 里等玩家点完才返回，单机等着这一步，电脑也就停着（不会边讲边跑）；
 * - 第一回合的操作步不挡 frame（那时本来就在等我出牌），由驾驶台的样子认出点对了没有；点"出牌"由 planned() 告诉这里。
 * 文案在 game/tutorial.ts，气泡和高亮在 view/coach.ts。
 */
import { STRESS } from './core/cards.ts';
import { nextCorner } from './core/rules.ts';
import type { Plan } from './core/types.ts';
import type { View } from './core/view.ts';
import { GRAD, LINES, TIPS, type Tip } from './game/tutorial.ts';
import { getTrack } from './track/index.ts';
import type { Pt } from './track/shape.ts';
import type { Board } from './view/board.ts';
import { Coach, type CoachStep } from './view/coach.ts';

export interface TutorHost {
  stage: HTMLElement;
  /** 我是几号座位 */
  me: number;
  board(): Board | null;
  /** 跳过教程、毕业点"正式开跑"：回选桌页 */
  exit(): void;
  /** 毕业点"再练一次" */
  again(): void;
}

const $ = (s: string): Element | null => document.querySelector(s);
const NEXT = '下一步 →';

export class Tutor {
  private readonly host: TutorHost;
  private readonly coach: Coach;
  /** intro：第一回合交计划（第 0–3 课）；r1：第一回合走车；free：讲完第 4–6 课以后 */
  private stage: 'intro' | 'r1' | 'free' | 'done' = 'intro';
  private started = false;
  private readonly seen = new Set<Tip>();
  private waitPlan: (() => void) | null = null;

  constructor(host: TutorHost) {
    this.host = host;
    this.coach = new Coach(host.stage, () => host.exit());
  }

  destroy(): void {
    this.stage = 'done';
    this.coach.destroy();
    this.waitPlan?.();
    this.waitPlan = null;
  }

  /** 单机画完一步（动画放完）以后 */
  async frame(v: View): Promise<void> {
    if (this.stage === 'intro') {
      if (!this.started && v.phase === 'plan') {
        this.started = true;
        void this.intro(v);
      }
      return;
    }
    if (this.stage === 'r1' && v.round >= 2 && v.phase === 'plan') {
      await this.lessons(v);
      if (this.ended()) return;
      this.stage = 'free';
    }
    if (this.stage === 'r1' || this.stage === 'free') await this.tips(v);
  }

  /** 玩家点了"出牌"：第 3 课最后一步做完（要在这一回合的第一帧之前切过去，所以不等每帧的检查） */
  planned(): void {
    if (this.stage !== 'intro' || !this.waitPlan) return;
    this.stage = 'r1';
    const w = this.waitPlan;
    this.waitPlan = null;
    this.coach.hide();
    w();
  }

  /**
   * 交计划前改一下：弃牌只问第一次（冒提示讲清楚），之后按"不弃"自动跳过，免得每回合都停下来问；
   * 冲刺、尾流、拼劲一直问
   */
  plan(p: Plan): Plan {
    return this.seen.has('discard') ? { ...p, discard: [] } : p;
  }

  /** 冲线以后（结算弹窗已经出来）：毕业，两个按钮各走各的 */
  graduate(v: View): void {
    this.stage = 'done';
    this.focus(null);
    const rank = v.cars[this.host.me]?.rank ?? null;
    void this.coach.show({
      text: rank === 0 ? GRAD.win : GRAD.done,
      skip: false,
      avoid: ['.mask.end .dialog'],
      buttons: [
        { text: GRAD.go, kind: 'go', onClick: () => this.host.exit() },
        { text: GRAD.again, kind: 'soft', onClick: () => this.host.again() },
      ],
    });
  }

  // ---------- 第 0–3 课：第一回合交计划 ----------

  private async intro(v: View): Promise<void> {
    const me = this.host.me;
    const car = (): Pt[] => this.pts(this.host.board()?.carAt(me));
    if (!(await this.say({ text: LINES.hello, next: NEXT }))) return;
    this.focus(car(), 1);
    if (!(await this.say({ text: LINES.car, next: NEXT, target: ['.board .car.me'] }))) return;
    this.focus(null);
    if (!(await this.say({ text: LINES.hand, next: NEXT, target: ['.dash .hand'] }))) return;
    if (v.me?.hand.some((h) => h.kind === STRESS) && !(await this.say({ text: LINES.stress, next: NEXT, target: [`.dash .hand .card[data-kind="${STRESS}"]`] }))) return;
    if (!(await this.say({ text: LINES.gear, next: NEXT, target: ['.dash .gearbox'] }))) return;
    const gate2 = '.dash .gate-btn[aria-label="2 挡"]';
    if (!(await this.say({ text: LINES.gear2, target: [gate2], allow: [gate2], avoid: ['.dash .gearbox'], until: () => !!$(`${gate2}.on`) }))) return;
    // "挂好了"点下去驾驶台换到出牌这一步，"← 换挡"就出来了
    if (!(await this.say({ text: LINES.shifted, target: ['.dash-action .act.go'], allow: ['.dash-action .act.go'], avoid: ['.dash-action'], until: () => !!$('.dash-action .back') }))) return;
    if (!(await this.say({ text: LINES.pick, target: ['.dash .slots', '.dash .hand'], allow: ['.dash .slots', '.dash .hand'], avoid: ['.dash-action'], until: () => !!$('.dash-action .act.go:not(:disabled)') }))) return;
    this.focus([...car(), ...this.pts(this.host.board()?.ghostPt())]);
    if (!(await this.say({ text: LINES.ghost, next: NEXT, target: ['.board .car.me', '.board .ghost-car'] }))) return;
    this.focus(null);
    // 最后一步等 planned()：出牌按钮点下去就切到第一回合走车
    const go = '.dash-action .act.go';
    const planned = new Promise<void>((r) => (this.waitPlan = r));
    void this.coach.show({ text: LINES.go, target: [go], allow: [go], avoid: ['.dash-action', '.board .ghost-car'] });
    await planned;
  }

  // ---------- 第 4–6 课：第二回合开始 ----------

  private async lessons(v: View): Promise<void> {
    const me = v.cars[this.host.me];
    const track = getTrack(v.opts.track);
    if (!me || !track) return;
    if (!(await this.say({ text: LINES.order, next: NEXT }))) return;
    const k = nextCorner(track, v.finish, me.pos);
    const at = k ? ((k.line % track.spaces) + track.spaces) % track.spaces : null;
    const board = this.host.board();
    if (at !== null && board) this.focus([board.signPt(at)], 1);
    if (!(await this.say({ text: LINES.limit, next: NEXT, target: at === null ? undefined : [`.board .labels .limit[data-at="${at}"]`] }))) return;
    this.focus(null);
    if (!(await this.say({ text: LINES.engine, next: NEXT, target: ['.dash .engine'] }))) return;
    // 制动牌是小字，放大到看得见（全图时不画）
    if (at !== null && board) this.focus([1, 2, 3].map((n) => board.brakePt(at, n)), 1.1);
    if (!(await this.say({ text: LINES.brake, next: NEXT, target: at === null ? undefined : [`.board .labels .brake[data-at="${at}"]`] }))) return;
    this.focus(null);
    if (!(await this.say({ text: LINES.cool, next: NEXT, target: ['.dash .gearbox'] }))) return;
    await this.say({ text: LINES.free, next: '自己开 →' });
  }

  // ---------- 自由驾驶的提示 ----------

  private async tips(v: View): Promise<void> {
    const me = this.host.me;
    const mine = v.events.filter((e) => 'seat' in e && e.seat === me);
    const car = ['.board .car.me'];
    if (mine.some((e) => e.e === 'spin')) await this.tip('spin', car, true);
    else if (mine.some((e) => e.e === 'corner' && e.paid > 0)) await this.tip('paid', ['.dash .engine']);
    if (mine.some((e) => e.e === 'stall')) await this.tip('stall', car, true);
    if (v.cur === me && v.ask) await this.tip(v.ask, v.ask === 'discard' ? ['.dash-action .ask', '.dash .hand'] : ['.dash-action .ask'], v.ask === 'slip');
  }

  private async tip(id: Tip, target: string[], showCar = false): Promise<void> {
    if (this.seen.has(id) || this.stage === 'done') return;
    this.seen.add(id);
    if (showCar) this.focus(this.pts(this.host.board()?.carAt(this.host.me)), 0.9);
    await this.say({ text: TIPS[id], next: '知道了', target, skip: false });
    this.focus(null);
  }

  // ---------- 小工具 ----------

  /** 冒一条等它讲完；中途关掉了（跳过、回大厅）返回 false，后面的不再讲 */
  private async say(step: CoachStep): Promise<boolean> {
    if (this.stage === 'done') return false;
    await this.coach.show(step);
    return !this.ended();
  }

  /** 关掉了（跳过、回选桌、毕业）：await 回来以后要重新看，所以不让 TS 按前面的判断收窄 */
  private ended(): boolean {
    return this.stage === 'done';
  }

  private focus(pts: Pt[] | null, minK = 0): void {
    this.host.board()?.focus(pts, minK);
  }

  private pts(p: Pt | null | undefined): Pt[] {
    return p ? [p] : [];
  }
}
