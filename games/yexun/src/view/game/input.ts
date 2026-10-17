/**
 * 输入：键盘（WASD / 方向键，8 向）和触屏浮动摇杆（按下处出现，松手消失），都量化成核心要的 32 向（0 = 不动）。
 * 摇杆只要方向不要力度（DESIGN.md 5.4）：力度让录像变大，手感也不更好。
 * 摇杆铺在 HUD 下面的一层上：HUD 的按钮在上层，点按钮不会被当成走路。
 */
const DEAD = 10;
const MAX = 56;

export class Input {
  private keys = new Set<string>();
  private touchDir = 0;
  private pid: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLElement;
  /** 第一次有输入（引导用："拖动走位"的提示看到它就收起） */
  moved = false;
  enabled = true;
  /** 固定摇杆：底座钉在左下角，左半屏按下就以它为中心（设置里可选；默认浮动） */
  private fixed = false;
  private readonly layer: HTMLElement;

  constructor(layer: HTMLElement) {
    this.layer = layer;
    this.stick = document.createElement('div');
    this.stick.className = 'yx-stick';
    this.stick.style.display = 'none';
    this.knob = document.createElement('b');
    this.stick.appendChild(this.knob);
    layer.appendChild(this.stick);

    window.addEventListener('keydown', (e) => {
      if (KEYMAP[e.code]) {
        this.keys.add(e.code);
        this.moved = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pid !== null) return;
      const r = layer.getBoundingClientRect();
      if (this.fixed) {
        // 只认左半屏：右半屏留给以后的按键
        if (e.clientX - r.left > r.width / 2) return;
        const c = this.fixedCenter();
        this.ox = r.left + c.x;
        this.oy = r.top + c.y;
      } else {
        this.ox = e.clientX;
        this.oy = e.clientY;
        this.stick.style.left = `${e.clientX - r.left}px`;
        this.stick.style.top = `${e.clientY - r.top}px`;
      }
      this.pid = e.pointerId;
      layer.setPointerCapture(e.pointerId);
      this.stick.style.display = '';
      this.knob.style.transform = '';
      this.follow(e);
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pid) this.follow(e);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      this.touchDir = 0;
      this.knob.style.transform = '';
      if (!this.fixed) this.stick.style.display = 'none';
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }

  /** 左下角（离左边、下边各 110 像素，矮屏 90） */
  private fixedCenter(): { x: number; y: number } {
    const r = this.layer.getBoundingClientRect();
    const m = r.height < 500 ? 90 : 110;
    return { x: m, y: r.height - m };
  }

  setFixed(on: boolean): void {
    this.fixed = on;
    this.reset();
    if (on) {
      const c = this.fixedCenter();
      this.stick.style.left = `${c.x}px`;
      this.stick.style.top = `${c.y}px`;
    }
  }

  private follow(e: PointerEvent): void {
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    if (d < DEAD) {
      this.touchDir = 0;
    } else {
      this.touchDir = toDir(dx, dy);
      this.moved = true;
    }
    if (d > MAX && !this.fixed) {
      // 拖过头了：底座跟着手指走，松手前方向一直跟手
      this.ox += (dx / d) * (d - MAX);
      this.oy += (dy / d) * (d - MAX);
      const r = this.layer.getBoundingClientRect();
      this.stick.style.left = `${this.ox - r.left}px`;
      this.stick.style.top = `${this.oy - r.top}px`;
    }
    if (d > MAX) {
      dx = (dx / d) * MAX;
      dy = (dy / d) * MAX;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** 这一拍的方向（0–32） */
  dir(): number {
    if (!this.enabled) return 0;
    if (this.touchDir) return this.touchDir;
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const v = KEYMAP[k];
      if (v) {
        dx += v[0];
        dy += v[1];
      }
    }
    return dx === 0 && dy === 0 ? 0 : toDir(dx, dy);
  }

  reset(): void {
    this.keys.clear();
    this.touchDir = 0;
    this.pid = null;
    this.knob.style.transform = '';
    this.stick.style.display = this.fixed ? '' : 'none';
  }
}

const KEYMAP: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** 向量 → 32 向（1–32；1 朝右，按顺时针，屏幕坐标 y 向下）。画面层可以用 Math.atan2 */
export function toDir(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return 1 + ((Math.round((a / (Math.PI * 2)) * 32) % 32) + 32) % 32;
}
