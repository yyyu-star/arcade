/**
 * 新手教程的教练气泡和高亮（DESIGN.md 8.1）：阿驰的头像（coachart.ts）加一段话。
 * 气泡是一张印刷的人物卡：头上一条色带（讲解深绿、操作红、毕业金）印着名字和"跳过教程"，头像徽章压在色带左头，
 * 贴着目标放时伸出一个小尖角指过去（金边框着的就是他在说的东西）。
 * - 讲解步：气泡上"下一步 →"，右上角"跳过教程"；
 * - 操作步：要点的东西描一圈闪动的金边，周围压暗；除了它（和顶栏、气泡）别的都点不了，点对了由 until 认出来自动往下走，气泡上不放"下一步"；
 * - 气泡摆在不压着目标（和 avoid 里那些东西）的地方，横屏、竖屏都一样算；系统"减少动态效果"时金边不闪（style.css）。
 * 目标用选择器找：驾驶台、赛道的标注每一步都会整个重画，所以每一帧重新找、重新量（只在气泡开着时跑）。
 * 有别的弹窗（确认框、规则）开着时整个藏起来，免得压住弹窗；结算弹窗例外（毕业那一条就是冲着它说的）。
 */
import { COACH_NAME, GRAD, LINES, TIPS } from '../game/tutorial.ts';
import { coachFaceSvg, type Mood } from './coachart.ts';
import { button, el } from './dom.ts';

export interface CoachStep {
  text: string;
  /** 高亮哪些东西（几个选择器合成一个框）；不给就不压暗 */
  target?: string[];
  /** 操作步：这些东西能点（别的都挡住）；讲解步不给，只能点气泡 */
  allow?: string[];
  /** 讲解步的按钮字（"下一步 →""知道了"），点了往下走 */
  next?: string;
  /** 操作步：玩家点对了没有（每一帧问一次），对了就往下走 */
  until?: () => boolean;
  /** 别的按钮（毕业的"正式开跑""再练一次"）：点了只做自己的事 */
  buttons?: { text: string; kind: 'go' | 'soft'; onClick(): void }[];
  /** 气泡还要躲开的东西 */
  avoid?: string[];
  /** 右上角的"跳过教程"（默认有） */
  skip?: boolean;
  /** 阿驰的表情；不给按文案挑（MOODS），再不行毕业那种带按钮的笑、别的平常 */
  mood?: Mood;
}

/**
 * 哪句话配哪个表情（看文案挑的）：吹牛、放手、毕业、冲刺尾流拼劲这些"好事"大笑；打滑、熄火"哎哟"；别的讲解都是平常脸。
 * 交罚款那句是宽心的俏皮话，也笑着说
 */
const MOODS = new Map<string, Mood>([
  [LINES.hello, 'grin'],
  [LINES.free, 'grin'],
  [TIPS.boost, 'grin'],
  [TIPS.slip, 'grin'],
  [TIPS.adren, 'grin'],
  [TIPS.paid, 'grin'],
  [TIPS.spin, 'oops'],
  [TIPS.stall, 'oops'],
  [GRAD.win, 'grin'],
  [GRAD.done, 'grin'],
]);

function moodOf(step: CoachStep): Mood {
  return step.mood ?? MOODS.get(step.text) ?? (step.buttons?.length ? 'grin' : 'talk');
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 顶栏、气泡自己、弹窗里的东西一直能点：两步内回大厅（AGENTS.md 第 2 节），弹窗是盖在最上面的 */
const ALWAYS = ['.coach-bubble', '.topbar', '.mask'];
const BLOCK = ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'touchstart', 'contextmenu'] as const;

export class Coach {
  private readonly stage: HTMLElement;
  private readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly bubble: HTMLElement;
  private tail: HTMLElement | null = null;
  private readonly onSkip: () => void;
  private step: CoachStep | null = null;
  private done: (() => void) | null = null;
  private raf = 0;
  private placed = '';
  private readonly block = (e: Event): void => {
    if (!this.step || this.root.hidden) return;
    const t = e.target as Element | null;
    const ok = [...ALWAYS, ...(this.step.allow ?? [])].join(',');
    if (t?.closest?.(ok)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };

  constructor(stage: HTMLElement, onSkip: () => void) {
    this.stage = stage;
    this.onSkip = onSkip;
    this.root = el('div', 'coach', stage);
    this.root.hidden = true;
    this.spot = el('div', 'coach-spot', this.root);
    this.bubble = el('div', 'coach-bubble', this.root);
    for (const type of BLOCK) stage.addEventListener(type, this.block, { capture: true, passive: false });
  }

  destroy(): void {
    for (const type of BLOCK) this.stage.removeEventListener(type, this.block, { capture: true });
    cancelAnimationFrame(this.raf);
    this.finish();
    this.root.remove();
  }

  /** 冒一条；讲解步点了按钮、操作步点对了才 resolve（毕业那条只有自己的按钮，不 resolve） */
  show(step: CoachStep): Promise<void> {
    this.finish();
    this.step = step;
    this.placed = '';
    this.paint(step);
    this.root.hidden = false;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.tick());
    return new Promise((resolve) => (this.done = resolve));
  }

  hide(): void {
    this.finish();
    this.step = null;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
  }

  /** 正在讲的还没完的那一步：放掉（换下一条、关掉时），免得等它的人一直挂着 */
  private finish(): void {
    const d = this.done;
    this.done = null;
    d?.();
  }

  private paint(step: CoachStep): void {
    const b = this.bubble;
    b.replaceChildren();
    b.classList.toggle('op', !!step.until);
    b.classList.toggle('grad', !step.until && !!step.buttons?.length);
    const mood = moodOf(step);
    b.dataset.mood = mood;
    const face = el('span', 'coach-face', b);
    face.innerHTML = coachFaceSvg(mood);
    const head = el('div', 'coach-head', b);
    el('b', 'coach-name', head, COACH_NAME);
    if (step.skip !== false) button('coach-skip', head, '跳过教程', () => this.onSkip());
    // 正文绕开压下来的头像（.coach-body::before 是一块浮动的空位）
    const body = el('div', 'coach-body', b);
    for (const para of step.text.split('\n')) {
      const p = el('p', 'coach-text', body);
      // "①"不是每台手机的字体都有：画成和棋子车顶一样的白圆牌
      para.split(/([①-⑥])/).forEach((part, i) => {
        if (i % 2) el('span', 'coach-num', p, String(part.charCodeAt(0) - 0x245f));
        else if (part) p.append(part);
      });
    }
    const row = el('div', 'coach-acts', b);
    if (step.next)
      button('act go', row, step.next, () => {
        this.hide();
      });
    for (const x of step.buttons ?? []) button(`act ${x.kind}`, row, x.text, x.onClick);
    if (!row.childElementCount) row.remove();
    this.tail = el('i', 'coach-tail', b);
    this.tail.hidden = true;
  }

  // ---------- 每一帧：找目标、量位置、摆气泡 ----------

  private tick(): void {
    const step = this.step;
    if (!step) return;
    this.raf = requestAnimationFrame(() => this.tick());
    if (step.until?.()) {
      this.hide();
      return;
    }
    // 确认框、规则这些弹窗开着：先藏起来，关了再出来
    const covered = !!this.stage.querySelector('.mask:not(.end)');
    this.root.hidden = covered;
    if (covered) return;
    const W = this.stage.offsetWidth;
    const H = this.stage.offsetHeight;
    const t = this.union(step.target ?? []);
    const avoid = (step.avoid ?? []).map((s) => this.union([s])).filter((x): x is Box => !!x);
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const key = [t, ...avoid].map((r) => (r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : '-')).join('|') + `|${W}x${H}|${bw}x${bh}`;
    if (key === this.placed) return;
    this.placed = key;
    if (t) {
      const pad = 6;
      Object.assign(this.spot.style, { left: `${t.x - pad}px`, top: `${t.y - pad}px`, width: `${t.w + 2 * pad}px`, height: `${t.h + 2 * pad}px` });
      this.spot.hidden = false;
    } else this.spot.hidden = true;
    const p = this.place(t, avoid, bw, bh, W, H);
    this.bubble.style.left = `${Math.round(p.x)}px`;
    this.bubble.style.top = `${Math.round(p.y)}px`;
    this.aim(t, p, bw, bh);
  }

  /**
   * 小尖角：气泡贴着目标的哪一边、两者又有对得上的一段，就从那一边伸出去，指着对得上那段的中间；
   * 离得远（挤到别处去了）或者斜对着就不伸，免得指错地方
   */
  private aim(t: Box | null, p: { x: number; y: number }, bw: number, bh: number): void {
    const tail = this.tail;
    if (!tail) return;
    const near = 64;
    // 左右两边的尖角不伸在色带那一截（色带竖屏约 40 高）
    const inset = 22;
    const top = 48;
    // 上沿的尖角躲开压在左头的头像
    const face = 80;
    let side = '';
    let at = 0;
    if (t) {
      const x0 = Math.max(p.x, t.x);
      const x1 = Math.min(p.x + bw, t.x + t.w);
      const y0 = Math.max(p.y, t.y);
      const y1 = Math.min(p.y + bh, t.y + t.h);
      const along = (a: number, b: number, len: number, lo = inset): number => Math.min(Math.max((a + b) / 2, lo), len - inset);
      if (x1 - x0 > 12 && p.y >= t.y + t.h && p.y - (t.y + t.h) < near) [side, at] = ['top', along(x0 - p.x, x1 - p.x, bw, face)];
      else if (x1 - x0 > 12 && p.y + bh <= t.y && t.y - (p.y + bh) < near) [side, at] = ['bottom', along(x0 - p.x, x1 - p.x, bw)];
      else if (y1 - y0 > 12 && p.x >= t.x + t.w && p.x - (t.x + t.w) < near) [side, at] = ['left', along(y0 - p.y, y1 - p.y, bh, top)];
      else if (y1 - y0 > 12 && p.x + bw <= t.x && t.x - (p.x + bw) < near) [side, at] = ['right', along(y0 - p.y, y1 - p.y, bh, top)];
    }
    tail.hidden = !side;
    if (side) {
      tail.dataset.side = side;
      tail.style.setProperty('--at', `${Math.round(at)}px`);
    }
  }

  /** 几个选择器找到的东西合成一个框（舞台坐标：舞台整个缩放过，屏幕上的像素要换回来）；一个都找不到是 null */
  private union(sels: string[]): Box | null {
    if (!sels.length) return null;
    const sr = this.stage.getBoundingClientRect();
    const k = sr.width / Math.max(1, this.stage.offsetWidth);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of sels)
      for (const e of this.stage.querySelectorAll(s)) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        x0 = Math.min(x0, (r.left - sr.left) / k);
        y0 = Math.min(y0, (r.top - sr.top) / k);
        x1 = Math.max(x1, (r.right - sr.left) / k);
        y1 = Math.max(y1, (r.bottom - sr.top) / k);
      }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * 气泡摆哪：先试目标的上下左右（目标在下半屏先试上面），再试赛道上几个固定的位置；
   * 挑第一个整个在舞台里（顶栏以下）、不压目标也不压 avoid 的；都不行挑压得最少的
   */
  private place(t: Box | null, avoid: Box[], bw: number, bh: number, W: number, H: number): { x: number; y: number } {
    const area = { x: 6, y: 46, w: W - 12, h: H - 52 };
    const gap = 14;
    const clampX = (x: number): number => Math.min(Math.max(x, area.x), area.x + area.w - bw);
    const clampY = (y: number): number => Math.min(Math.max(y, area.y), area.y + area.h - bh);
    const cands: { x: number; y: number }[] = [];
    if (t) {
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      const above = { x: clampX(cx - bw / 2), y: t.y - gap - bh };
      const below = { x: clampX(cx - bw / 2), y: t.y + t.h + gap };
      const right = { x: t.x + t.w + gap, y: clampY(cy - bh / 2) };
      const left = { x: t.x - gap - bw, y: clampY(cy - bh / 2) };
      cands.push(...(cy > H / 2 ? [above, right, left, below] : [below, right, left, above]));
      // 贴着目标放不下（旁边是要躲开的东西）：放到目标连同要躲开的东西整块的上面或下面
      if (avoid.length) {
        const u = avoid.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }), t);
        const ux = clampX(u.x + u.w / 2 - bw / 2);
        cands.push(...(cy > H / 2 ? [{ x: ux, y: u.y - gap - bh }, { x: ux, y: u.y + u.h + gap }] : [{ x: ux, y: u.y + u.h + gap }, { x: ux, y: u.y - gap - bh }]));
      }
    }
    const board = this.union(['.board']) ?? area;
    // 没有目标时摆在赛道上方正中；再不行在赛道和整个舞台里挑几处
    cands.push({ x: clampX(board.x + board.w / 2 - bw / 2), y: clampY(board.y + 12) });
    for (const fy of [0, 0.5, 1])
      for (const fx of [0.5, 0, 1]) cands.push({ x: clampX(area.x + (area.w - bw) * fx), y: clampY(area.y + (area.h - bh) * fy) });
    const hit = (p: { x: number; y: number }): number => {
      let n = 0;
      for (const o of t ? [grow(t, 8), ...avoid] : avoid) {
        const w = Math.min(p.x + bw, o.x + o.w) - Math.max(p.x, o.x);
        const h = Math.min(p.y + bh, o.y + o.h) - Math.max(p.y, o.y);
        if (w > 0 && h > 0) n += w * h;
      }
      return n;
    };
    const inside = (p: { x: number; y: number }): boolean => p.x >= area.x - 0.5 && p.y >= area.y - 0.5 && p.x + bw <= area.x + area.w + 0.5 && p.y + bh <= area.y + area.h + 0.5;
    const ok = cands.find((p) => inside(p) && hit(p) === 0);
    if (ok) return ok;
    return cands.filter(inside).sort((a, b) => hit(a) - hit(b))[0] ?? { x: area.x, y: area.y };
  }
}

function grow(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}
