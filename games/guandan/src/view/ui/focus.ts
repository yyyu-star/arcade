/**
 * 画布里的键盘操作（0.9.0）：Tab / Shift+Tab、方向键在按钮之间走，回车、空格按下，Esc 关最上面的弹窗。
 * 按钮在 Phaser 画布里，浏览器自己的焦点进不来，所以这里记一份"能按的东西"：kit.ts 的按钮、图标按钮、选项组各登记一次，销毁时自动去掉。
 * 弹窗（kit.ts 的 modal）开着时只在弹窗里面走，和鼠标点不到遮罩下面一样。
 * 焦点框只在用过键盘后出现，鼠标、手指一点就收起，不打扰平常玩。
 * DOM 层（好友房面板、输入框）开着时不接键盘：那边用浏览器自己的焦点。
 */
import type Phaser from 'phaser';
import { FOCUS_RING } from '../theme.ts';

interface Entry {
  obj: Phaser.GameObjects.Container | Phaser.GameObjects.Zone;
  activate: () => void;
  enabled: () => boolean;
  /** 画出来的大小（以对象中心为中心）：焦点框套着它画。底板是 Graphics，getBounds 量不到 */
  w: number;
  h: number;
}

interface Layer {
  root: Phaser.GameObjects.Container;
  onEscape?: () => void;
}

interface State {
  scene: Phaser.Scene;
  entries: Entry[];
  layers: Layer[];
  current: Entry | null;
  keyboard: boolean;
  ring: Phaser.GameObjects.Graphics | null;
  /** 上次画框的位置：没变就不重画（postupdate 每帧都来） */
  drawn: string;
}

const states = new Map<Phaser.Scene, State>();
let listening = false;

function stateOf(scene: Phaser.Scene): State {
  let s = states.get(scene);
  if (!s) {
    const st: State = { scene, entries: [], layers: [], current: null, keyboard: false, ring: null, drawn: '' };
    states.set(scene, st);
    scene.input.on('pointerdown', () => hideRing(st));
    scene.events.on('postupdate', () => st.keyboard && drawRing(st));
    // 场景重启（换世界宽度）或关掉时整份作废，重新登记
    scene.events.once('shutdown', () => {
      st.ring?.destroy();
      states.delete(scene);
    });
    s = st;
  }
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('keydown', onKey);
  }
  return s;
}

/** 登记一个能按的东西；activate 走和点一下同一条路（音效、onClick）；w、h 是画出来的大小 */
export function focusable(obj: Entry['obj'], w: number, h: number, activate: () => void, enabled: () => boolean = () => true): void {
  const s = stateOf(obj.scene);
  const e: Entry = { obj, activate, enabled, w, h };
  s.entries.push(e);
  obj.once('destroy', () => {
    s.entries = s.entries.filter((x) => x !== e);
    if (s.current === e) s.current = null;
  });
}

/** 弹窗开着时焦点只在它里面走；Esc 调 onEscape（一般是关掉） */
export function pushLayer(root: Phaser.GameObjects.Container, onEscape?: () => void): void {
  const s = stateOf(root.scene);
  const layer: Layer = { root, onEscape };
  s.layers.push(layer);
  s.current = null;
  root.once('destroy', () => {
    s.layers = s.layers.filter((l) => l !== layer);
    s.current = null;
  });
}

function shown(obj: Phaser.GameObjects.GameObject): boolean {
  let o: Phaser.GameObjects.GameObject | null = obj;
  while (o) {
    const v = o as unknown as { visible?: boolean; alpha?: number; active: boolean };
    if (!v.active || v.visible === false || (v.alpha !== undefined && v.alpha < 0.05)) return false;
    o = o.parentContainer;
  }
  return true;
}

function inside(obj: Phaser.GameObjects.GameObject, root: Phaser.GameObjects.Container): boolean {
  for (let o: Phaser.GameObjects.GameObject | null = obj; o; o = o.parentContainer) if (o === root) return true;
  return false;
}

/** 画出来的那一块在世界坐标里的矩形（跟着父容器的位置、缩放走） */
function rectOf(e: Entry): { x: number; y: number; w: number; h: number } {
  const m = e.obj.getWorldTransformMatrix();
  const o = e.obj as Phaser.GameObjects.Zone;
  // 区域的原点可能不在中心（setHit 会改成左上角）
  const c = m.transformPoint(o.width * (0.5 - (o.originX ?? 0.5)), o.height * (0.5 - (o.originY ?? 0.5)));
  const w = e.w * m.scaleX;
  const h = e.h * m.scaleY;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/** 现在能走到的，按阅读顺序（先上后下、同一行从左到右；一行按 24 的格子分，免得差几个像素就换行） */
function candidates(s: State): Entry[] {
  const top = s.layers[s.layers.length - 1];
  const list = s.entries.filter((e) => shown(e.obj) && e.enabled() && (!top || inside(e.obj, top.root)) && !!e.obj.input?.enabled);
  const at = new Map(list.map((e) => [e, rectOf(e)]));
  const cy = (e: Entry): number => at.get(e)!.y + at.get(e)!.h / 2;
  const cx = (e: Entry): number => at.get(e)!.x + at.get(e)!.w / 2;
  return list.sort((a, b) => Math.round(cy(a) / 24) - Math.round(cy(b) / 24) || cx(a) - cx(b));
}

function activeState(): State | null {
  let found: State | null = null;
  for (const s of states.values()) if (s.scene.sys.isActive() && s.scene.sys.isVisible()) found = s;
  return found;
}

/** 键盘在 DOM 那边（输入框、好友房面板、转屏提示、出错面板）时不管 */
function domBusy(ev: KeyboardEvent): boolean {
  const t = ev.target as HTMLElement | null;
  if (t && t !== document.body && t.tagName !== 'CANVAS' && t.id !== 'app') return true;
  for (const id of ['online', 'rotate-hint', 'error-panel']) {
    const el = document.getElementById(id);
    if (el && getComputedStyle(el).display !== 'none') return true;
  }
  return false;
}

function onKey(ev: KeyboardEvent): void {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || domBusy(ev)) return;
  const s = activeState();
  if (!s) return;
  const k = ev.key;
  if (k === 'Escape') {
    const top = s.layers[s.layers.length - 1];
    if (top?.onEscape) {
      ev.preventDefault();
      top.onEscape();
    }
    return;
  }
  const back = (k === 'Tab' && ev.shiftKey) || k === 'ArrowLeft' || k === 'ArrowUp';
  const fwd = (k === 'Tab' && !ev.shiftKey) || k === 'ArrowRight' || k === 'ArrowDown';
  if (back || fwd) {
    const list = candidates(s);
    if (!list.length) return;
    ev.preventDefault();
    const i = s.current ? list.indexOf(s.current) : -1;
    s.current = i < 0 ? list[back ? list.length - 1 : 0]! : list[(i + (back ? -1 : 1) + list.length) % list.length]!;
    s.keyboard = true;
    drawRing(s);
    return;
  }
  if ((k === 'Enter' || k === ' ') && s.keyboard && s.current && candidates(s).includes(s.current)) {
    ev.preventDefault();
    s.current.activate();
  }
}

function hideRing(s: State): void {
  s.keyboard = false;
  s.drawn = '';
  s.ring?.setVisible(false);
}

function drawRing(s: State): void {
  const e = s.current;
  if (!e || !shown(e.obj)) {
    s.drawn = '';
    s.ring?.setVisible(false);
    return;
  }
  const r = rectOf(e);
  const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
  if (key === s.drawn && s.ring?.active) return;
  s.drawn = key;
  if (!s.ring || !s.ring.active) s.ring = s.scene.add.graphics().setDepth(99999);
  const pad = 5;
  const rad = Math.min(16, (r.h + pad * 2) / 2);
  s.ring.clear().setVisible(true);
  s.ring.lineStyle(4, 0x000000, 0.45).strokeRoundedRect(r.x - pad, r.y - pad + 1, r.w + pad * 2, r.h + pad * 2, rad);
  s.ring.lineStyle(3, FOCUS_RING, 1).strokeRoundedRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, rad);
}

/** 调试桥：现在键盘停在哪（世界坐标的中心），没在用键盘时是 null */
export function focusedAt(scene: Phaser.Scene): { x: number; y: number } | null {
  const s = states.get(scene);
  if (!s?.keyboard || !s.current) return null;
  const r = rectOf(s.current);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 现在有没有弹窗（焦点层）开着：画布外的 DOM（牌桌互动）据此藏起来，免得挡住弹窗上的按钮 */
export function hasLayer(scene: Phaser.Scene): boolean {
  return (states.get(scene)?.layers.length ?? 0) > 0;
}
