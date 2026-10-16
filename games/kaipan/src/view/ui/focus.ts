/**
 * 0.9.0 键盘焦点：Tab / Shift+Tab 在当前能点的按钮之间走，回车或空格按下去，焦点框只在用键盘的时候显示（鼠标、手指一点就收起）。
 *
 * 画布里没有浏览器自带的焦点，所以自己管：按钮建出来时登记，销毁时注销。
 * 有弹窗时只在最上面那层（按钮所在顶层容器的 depth 最大的一层）里走，不会走到被遮住的按钮上。
 * 在 window 的捕获阶段处理按键：焦点框亮着时回车、空格交给按钮，并拦住，不再触发场景的快捷键（比如空格开盘）。
 */

/** 焦点管理只需要按钮的这些能力（Button 实现它；单测里用假的）。 */
export interface Focusable {
  /** 现在能不能点（可见、可用、没锁、父容器都可见、场景在跑） */
  focusable(): boolean;
  /** 所在的层：顶层容器的 depth */
  layer(): number;
  /** 世界坐标下的矩形（排顺序用） */
  rect(): { x: number; y: number; w: number; h: number };
  setFocused(on: boolean): void;
  press(): boolean;
}

const all = new Set<Focusable>();
let current: Focusable | null = null;
let visible = false;

export function registerFocusable(b: Focusable): void {
  all.add(b);
}

export function unregisterFocusable(b: Focusable): void {
  all.delete(b);
  if (current === b) current = null;
}

/** 同一行的容差：上沿差不到这么多算一行，按 x 排 */
const ROW = 12;

/** 阅读顺序：先上后下，同一行从左到右。 */
function byReading(a: Focusable, b: Focusable): number {
  const ra = a.rect();
  const rb = b.rect();
  return Math.abs(ra.y - rb.y) < ROW ? ra.x - rb.x : ra.y - rb.y;
}

/** 这一刻能走到的按钮：能点、在最上面那层，按阅读顺序。 */
export function focusOrder(items: Iterable<Focusable>): Focusable[] {
  const live = [...items].filter((b) => b.focusable());
  if (live.length === 0) return [];
  const top = Math.max(...live.map((b) => b.layer()));
  return live.filter((b) => b.layer() === top).sort(byReading);
}

/** 从 cur 往前或往后走一个；cur 不在里面时从头（往后）或从尾（往前）开始。 */
export function step(order: readonly Focusable[], cur: Focusable | null, dir: 1 | -1): Focusable | null {
  if (order.length === 0) return null;
  const i = cur ? order.indexOf(cur) : -1;
  if (i < 0) return dir > 0 ? order[0]! : order[order.length - 1]!;
  return order[(i + dir + order.length) % order.length]!;
}

function show(next: Focusable | null): void {
  if (current && current !== next) current.setFocused(false);
  current = next;
  visible = next !== null;
  next?.setFocused(true);
}

/** 收起焦点框（鼠标、手指操作时）；记住的按钮不变，下次按 Tab 从它接着走。 */
function hide(): void {
  if (!visible) return;
  visible = false;
  current?.setFocused(false);
}

function editing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** 按键处理；返回 true 表示已处理（调用方拦住事件）。导出给单测。 */
export function handleKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.key === 'Tab') {
    const order = focusOrder(all);
    if (order.length === 0) return false;
    // 第一次按 Tab 先把框亮在记住的按钮上（它还在这一层的话），再按才往下走
    const keep = !visible && current && order.includes(current);
    show(keep ? current : step(order, current, e.shiftKey ? -1 : 1));
    return true;
  }
  if (e.key === 'Escape') {
    hide();
    return false;
  }
  if ((e.key === 'Enter' || e.key === ' ') && visible && current) {
    // 焦点框亮着以后又弹出了窗口：框下的按钮被盖住了，不能隔着弹窗按
    if (!focusOrder(all).includes(current)) {
      hide();
      return false;
    }
    current.press();
    return true;
  }
  return false;
}

let installed = false;

/** 启动时调用一次。 */
export function installFocus(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat || editing(e.target) || !handleKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
  window.addEventListener('pointerdown', hide, { capture: true, passive: true });
}
