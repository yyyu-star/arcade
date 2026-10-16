import Phaser from 'phaser';
import type { Rect } from '../rect.ts';
import { COLOR, RADIUS } from '../theme.ts';
import { addText } from './text.ts';
import { viewOf } from '../viewport.ts';

export interface TipContent {
  title: string;
  body: string;
  color?: number;
  /** 放在目标右侧（左栏看板用）；缺省放在下方或上方 */
  side?: 'right';
}

const W = 280;
/** 场景 data 里教程气泡的位置：说明框尽量不和它叠在一起。 */
export const GUIDE_BOX_KEY = 'kp.guideBox';
/** 盖在对话框（300）上面：对话框里的悬停说明也要看得见。 */
const DEPTH = 400;
/** 触屏按住多久算长按（毫秒）。 */
const LONG_PRESS_MS = 450;

/**
 * 悬停说明框：每个场景一个，悬停到绑定的对象上时显示在其上方或下方。
 *
 * 触屏没有悬停：长按显示，并在说明框下垫一层全屏透明挡板。挡板吃掉松手那一下，长按就不会顺带
 * 触发按钮（买入、卖出）；说明框留在屏幕上，再点任意处收起，这一下同样被挡板吃掉，不会误点到下面。
 * 没有说明可看的（比如能点的买入按钮只在不能买时才有说明）也一样吃掉松手：长按永远不算点击。
 */
class Tooltip {
  private box: Phaser.GameObjects.Container | null = null;
  private shield: Phaser.GameObjects.Rectangle | null = null;
  private owner: unknown = null;

  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(owner: unknown, rect: Rect, c: TipContent): void {
    this.hide();
    this.owner = owner;
    const s = this.scene;
    const V = viewOf(s);
    const title = addText(s, 12, 10, c.title, { size: 15, bold: true, color: COLOR.accentDark, wrap: W - 24 });
    const body = addText(s, 12, 14 + title.height, c.body, { size: 13, color: COLOR.ink, wrap: W - 24, lineSpacing: 4 });
    const h = 24 + title.height + body.height;
    const bg = s.add.rectangle(0, 0, W, h, COLOR.paperHi, 0.98).setOrigin(0, 0).setRounded(RADIUS.md).setStrokeStyle(2, COLOR.ink, 1);
    // 优先放在目标下方，放不下放上方；左右夹在屏幕内
    let y = rect.y + rect.h + 8;
    if (y + h > V.h - 6) y = rect.y - h - 8;
    let x = rect.x + rect.w / 2 - W / 2;
    if (c.side === 'right') {
      x = rect.x + rect.w + 10;
      y = rect.y;
    }
    y = Math.max(6, Math.min(V.h - h - 6, y));
    x = Math.max(6, Math.min(V.w - W - 6, x));
    // 和教程气泡叠上了：换到目标的另一侧（上 ↔ 下，右侧放的改到左侧）
    const g = s.data?.get(GUIDE_BOX_KEY) as Rect | undefined;
    const hits = (bx: number, by: number): boolean => !!g && bx < g.x + g.w && bx + W > g.x && by < g.y + g.h && by + h > g.y;
    if (hits(x, y)) {
      const alt =
        c.side === 'right'
          ? { x: Math.max(6, rect.x - W - 10), y }
          : { x, y: Math.max(6, Math.min(V.h - h - 6, y > rect.y ? rect.y - h - 8 : rect.y + rect.h + 8)) };
      if (!hits(alt.x, alt.y)) ({ x, y } = alt);
    }
    this.box = s.add.container(x, y, [bg, title, body]).setDepth(DEPTH);
  }

  /** 长按显示：钉住，直到下一次点击才收起；没有说明时只吃掉这次松手。 */
  pin(owner: unknown, rect: Rect, c: TipContent | null): void {
    if (c) this.show(owner, rect, c);
    else this.hide();
    const shield = this.scene.add.rectangle(0, 0, viewOf(this.scene).w, viewOf(this.scene).h, 0x000000, 0.001).setOrigin(0, 0).setDepth(DEPTH - 1).setInteractive();
    // 长按的手指还按着，第一次松手不算；之后的一次完整点击才收起
    let armed = false;
    const stop = (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData): void => ev.stopPropagation();
    shield.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, x: number, y: number, ev: Phaser.Types.Input.EventData) => {
      armed = true;
      stop(p, x, y, ev);
    });
    shield.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, x: number, y: number, ev: Phaser.Types.Input.EventData) => {
      stop(p, x, y, ev);
      if (armed || !c) this.hide();
    });
    this.shield = shield;
  }

  /** 当前是否是长按钉住的说明（触屏松手时的移出事件不收起它）。 */
  pinned(owner: unknown): boolean {
    return this.shield !== null && this.owner === owner;
  }

  hide(owner?: unknown): void {
    if (owner !== undefined && owner !== this.owner) return;
    if (this.box?.active) this.box.destroy();
    if (this.shield?.active) this.shield.destroy();
    this.box = null;
    this.shield = null;
    this.owner = null;
  }
}

const tips = new WeakMap<Phaser.Scene, Tooltip>();

function tooltipOf(scene: Phaser.Scene): Tooltip {
  let t = tips.get(scene);
  if (!t) {
    t = new Tooltip(scene);
    tips.set(scene, t);
  }
  return t;
}

/** 点了一下就把说明钉在屏幕上（下一次点击收起），给"点了只解释"的东西用。 */
export function pinTooltip(obj: Phaser.GameObjects.GameObject, rect: Rect, c: TipContent): void {
  tooltipOf(obj.scene).pin(obj, rect, c);
}

/** 隐藏场景里的说明框（场景重绘前调用）。 */
export function hideTooltip(scene: Phaser.Scene): void {
  tips.get(scene)?.hide();
}

/**
 * 给一个可交互对象绑定悬停说明。rect 与 content 在悬停时求值；content 返回 null 时不显示。
 * 鼠标悬停即显示；触屏要长按（见 Tooltip 的说明）。对象销毁时自动收起。
 */
export function bindTooltip(obj: Phaser.GameObjects.GameObject, rect: () => Rect, content: () => TipContent | null): void {
  const scene = obj.scene;
  if (!obj.input) obj.setInteractive();
  let timer: Phaser.Time.TimerEvent | null = null;
  const cancel = (): void => {
    timer?.remove();
    timer = null;
  };
  // 触屏：手指按下开始计时，按满时长再显示，短按照常当点击。
  // 0.9.0 按下（POINTER_DOWN）也开始计时：手指按下时 Phaser 不一定先发"移入"，只等移入的话长按不出说明、松手照样算点击
  const arm = (p: Phaser.Input.Pointer): void => {
    if (timer) return;
    timer = scene.time.delayedCall(LONG_PRESS_MS, () => {
      timer = null;
      if (!obj.active || !p.isDown) return;
      const c = content();
      tooltipOf(scene).pin(obj, rect(), c);
      if (c) globalThis.navigator?.vibrate?.(12);
    });
  };
  obj.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    if (p.wasTouch) arm(p);
  });
  obj.on(Phaser.Input.Events.POINTER_UP, cancel);
  obj.on(Phaser.Input.Events.POINTER_OVER, (p: Phaser.Input.Pointer) => {
    if (p.wasTouch) return arm(p);
    const c = content();
    if (c) tooltipOf(scene).show(obj, rect(), c);
  });
  obj.on(Phaser.Input.Events.POINTER_OUT, () => {
    cancel();
    const t = tooltipOf(scene);
    if (!t.pinned(obj)) t.hide(obj);
  });
  obj.once(Phaser.GameObjects.Events.DESTROY, () => {
    cancel();
    tooltipOf(scene).hide(obj);
  });
}
