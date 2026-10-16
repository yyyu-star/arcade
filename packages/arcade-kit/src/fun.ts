/**
 * 好玩素材（0.7.0）：表情包气泡、互动道具（扔番茄、臭鸡蛋……），浏览器里用，纯 DOM + SVG + Web Animations，不依赖任何渲染库。
 *
 * - 编号到内容的表由游戏自己定：房间只转发 emote 的 id（RoomGame.emotes 是总数），游戏按"自己的起始编号 + 下标"映射到 STICKERS、PROPS；
 *   这两个列表顺序固定、只往后加。kit 只管画法和动画，不知道哪个游戏、哪句话；
 * - 只动 transform 和 opacity（合成层完成，不触发重排），所有元素 pointer-events: none，点击穿透到下面的牌桌；
 * - 同一个图层同时最多 MAX_PLAYING 个效果在播，多出来的直接丢掉（返回 false）；同一个头像上的污渍最多叠 MAX_STAINS 层，再多先去掉最早的；
 * - 声音不在这里放：throwAt 在起飞、引信、命中时调 opts.sound(prop, phase)，游戏用自己的音频（跟着静音开关）去放，
 *   配方是 playFunSound（WebAudio 现场合成）；
 * - 被扔的头像抖一下由游戏做（头像在游戏的画布或 DOM 里，kit 碰不到）：命中时调 opts.onHit(prop)。
 * 这个文件引用 DOM，但只在调用时才碰：在 workerd、Node 里 import 不会出错（测试只测纯函数和素材）。
 */
import { BURST, DRIP, PETAL, PROPS, SHELL, SMOKE, SOOT, SPARK, SPLAT_TOMATO, STAR, STICKERS, STINK, dot, propSvg, splatEgg, stickerSvg, type PropId, type StickerId } from './fun-art.js';

export { PROPS, STICKERS, propSvg, stickerSvg, type PropId, type StickerId };

/** 同一个图层同时最多几个效果在播 */
export const MAX_PLAYING = 4;
/** 同一个头像上的污渍最多叠几层 */
export const MAX_STAINS = 3;
/** 默认的图层 z-index：比牌桌高、比游戏的弹窗低（游戏的弹窗要高于它，或者打开弹窗时 hide） */
export const FUN_LAYER_Z = 50;

/** 屏幕坐标的矩形：getBoundingClientRect() 的结果（DOMRect）直接能传 */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FunLayer {
  /** 根元素：position: fixed; inset: 0; pointer-events: none，带 class arcade-fun */
  readonly el: HTMLElement;
  /** 藏起来（visibility: hidden）：正在播的不中断，show 时接着显示。游戏打开弹窗时用 */
  hide(): void;
  show(): void;
  /** 拿掉整个图层（离开牌桌时） */
  destroy(): void;
}

export interface LayerOptions {
  /** 默认 FUN_LAYER_Z（50） */
  zIndex?: number;
  /** 挂在哪里，默认 document.body */
  parent?: HTMLElement;
}

/**
 * 建一个铺满屏幕、点击穿透的图层。挂在 body 上：游戏的界面如果在自己的层叠上下文里（fixed 容器、带 transform 的舞台），
 * 光靠 z-index 夹不到"牌桌之上、弹窗之下"，这时打开弹窗前 hide()、关掉后 show()。
 */
export function createFunLayer(opts: LayerOptions = {}): FunLayer {
  const doc = (opts.parent ?? document.body).ownerDocument;
  const el = doc.createElement('div');
  el.className = 'arcade-fun';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;inset:0;pointer-events:none;overflow:hidden;contain:strict;z-index:${opts.zIndex ?? FUN_LAYER_Z}`;
  (opts.parent ?? doc.body).appendChild(el);
  return {
    el,
    hide: () => void (el.style.visibility = 'hidden'),
    show: () => void (el.style.visibility = ''),
    destroy: () => el.remove(),
  };
}

export type FunPhase = 'fly' | 'fuse' | 'hit';

export interface ThrowOptions {
  /** 起飞（fly）、炸弹点引信（fuse）、命中（hit）时调：游戏放声音（playFunSound），自己判断静音 */
  sound?(prop: PropId, phase: FunPhase): void;
  /** 命中那一刻：游戏让被扔的头像抖一下、缩一下 */
  onHit?(prop: PropId): void;
  /**
   * 污渍按谁记（同一个人最多叠 MAX_STAINS 层）：游戏传座位号之类最稳。不传就按目标位置取整（头像在抖时位置差几个像素也算同一个人）
   */
  target?: string | number;
}

// ---------- 纯函数（测试覆盖） ----------

export interface Pt {
  x: number;
  y: number;
}

/** 抛物线上的 n 个点（含起点终点）：二次贝塞尔，控制点在中点往上抬 lift（默认按距离算，至少 60） */
export function arcPoints(a: Pt, b: Pt, n: number, lift?: number): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const h = lift ?? Math.max(60, d * 0.35);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - h };
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/** 屏幕矩形换成图层里的中心点和边长（取宽高里小的那个） */
export function centerIn(r: RectLike, origin: Pt): { c: Pt; s: number } {
  return { c: { x: r.left - origin.x + r.width / 2, y: r.top - origin.y + r.height / 2 }, s: Math.max(24, Math.min(r.width, r.height)) };
}

// ---------- 播放的账（按图层记） ----------

const playing = new WeakMap<HTMLElement, number>();
const stains = new WeakMap<HTMLElement, Map<string, HTMLElement[]>>();

/** 占一个播放名额；满了返回 false（调用方直接丢掉这一次） */
function claim(el: HTMLElement): boolean {
  const n = playing.get(el) ?? 0;
  if (n >= MAX_PLAYING) return false;
  playing.set(el, n + 1);
  return true;
}
function release(el: HTMLElement): void {
  playing.set(el, Math.max(0, (playing.get(el) ?? 1) - 1));
}

/** 正在播几个（冒烟、测试看） */
export function playingCount(layer: FunLayer): number {
  return playing.get(layer.el) ?? 0;
}

// ---------- DOM 小工具 ----------

const wait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const pos = (p: Pt, size: number, extra = ''): string => `translate(${(p.x - size / 2).toFixed(1)}px,${(p.y - size / 2).toFixed(1)}px) ${extra}`;

function sprite(layer: HTMLElement, svg: string, size: number, p: Pt, extra = '', opacity = 1): HTMLDivElement {
  const d = layer.ownerDocument.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none;will-change:transform,opacity;opacity:${opacity};transform:${pos(p, size, extra)}`;
  d.innerHTML = svg;
  layer.appendChild(d);
  return d;
}

/** Web Animations；没有就按时长等一下（老浏览器只是没有动画，不报错） */
function play(el: HTMLElement, frames: Keyframe[], ms: number, o: { delay?: number; easing?: string } = {}): Promise<void> {
  if (typeof el.animate !== 'function') return wait(ms + (o.delay ?? 0));
  const a = el.animate(frames, { duration: ms, delay: o.delay ?? 0, easing: o.easing ?? 'linear', fill: 'both' });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

function origin(layer: HTMLElement): Pt {
  // 自己建的图层铺满屏幕，原点就是 (0, 0)；挂在别处的按它的位置换算（只读一次）
  if (layer.classList.contains('arcade-fun') && layer.style.position === 'fixed') return { x: 0, y: 0 };
  const r = layer.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

/** 污渍：挂到这个头像的账上，超过 MAX_STAINS 层先去掉最早的；留 ms 毫秒再淡出 */
function stain(layer: HTMLElement, key: string, group: HTMLElement, ms: number): void {
  let byKey = stains.get(layer);
  if (!byKey) stains.set(layer, (byKey = new Map()));
  const list = byKey.get(key) ?? [];
  list.push(group);
  while (list.length > MAX_STAINS) list.shift()!.remove();
  byKey.set(key, list);
  void play(group, [{ opacity: 1 }, { opacity: 0 }], 400, { delay: ms }).then(() => {
    group.remove();
    const now = byKey.get(key);
    if (now) {
      const i = now.indexOf(group);
      if (i >= 0) now.splice(i, 1);
    }
  });
}

function group(layer: HTMLElement): HTMLDivElement {
  const g = layer.ownerDocument.createElement('div');
  g.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:opacity';
  layer.appendChild(g);
  return g;
}

// ---------- 表情包 ----------

/** 每个表情的小动作（1 秒内） */
const STICKER_MOTION: Record<StickerId, string[]> = {
  smug: ['rotate(0deg)', 'rotate(-10deg)', 'rotate(8deg)', 'rotate(-6deg)', 'rotate(0deg)'],
  doge: ['translateY(0)', 'translateY(-8%) rotate(-6deg)', 'translateY(0)', 'translateY(-6%) rotate(6deg)', 'translateY(0)'],
  cry: ['translateX(0)', 'translateX(-5%)', 'translateX(5%)', 'translateX(-5%)', 'translateX(5%)', 'translateX(0)'],
  sweat: ['rotate(0deg)', 'rotate(-4deg) translateY(3%)', 'rotate(0deg)', 'rotate(-4deg) translateY(3%)', 'rotate(0deg)'],
  shock: ['scale(1)', 'scale(1.25) translateY(-10%)', 'scale(0.95)', 'scale(1.08)', 'scale(1)'],
  sly: ['rotate(0deg)', 'rotate(8deg)', 'rotate(-8deg)', 'rotate(6deg)', 'rotate(0deg)'],
  love: ['scale(1)', 'scale(1.15)', 'scale(1)', 'scale(1.15)', 'scale(1)'],
  angry: ['translateX(0)', 'translateX(-6%) rotate(-3deg)', 'translateX(6%) rotate(3deg)', 'translateX(-6%)', 'translateX(6%)', 'translateX(0)'],
  sleep: ['scale(1) rotate(0deg)', 'scale(1.05) rotate(-4deg)', 'scale(1) rotate(0deg)', 'scale(1.05) rotate(-4deg)', 'scale(1) rotate(0deg)'],
  clap: ['scale(1)', 'scale(0.9)', 'scale(1.06)', 'scale(0.9)', 'scale(1.06)', 'scale(1)'],
  lol: ['rotate(0deg)', 'rotate(-12deg)', 'rotate(10deg)', 'rotate(-8deg)', 'rotate(0deg)'],
  cool: ['translateX(-30%) rotate(-10deg)', 'translateX(4%) rotate(4deg)', 'translateX(0) rotate(0deg)', 'rotate(-4deg)', 'rotate(0deg)'],
};

/**
 * 在一个人头像旁冒一个表情（rect 是头像的屏幕矩形）：弹出来、做 1 秒内的小动作、停一会儿淡出，共约 2 秒。
 * 名额满了返回 false。
 */
export async function showSticker(layer: FunLayer, rect: RectLike, id: StickerId): Promise<boolean> {
  const el = layer.el;
  if (!claim(el)) return false;
  try {
    const { c, s } = centerIn(rect, origin(el));
    const size = Math.min(96, Math.max(44, s * 0.9));
    // 冒在头像右上方，不盖住头像本身
    const p = { x: c.x + s * 0.45, y: c.y - s * 0.55 };
    const d = sprite(el, stickerSvg(id), size, p, 'scale(0)');
    await play(d, [{ transform: pos(p, size, 'scale(0)') }, { transform: pos(p, size, 'scale(1.18)') }, { transform: pos(p, size, 'scale(1)') }], 220, { easing: 'ease-out' });
    await play(d, STICKER_MOTION[id].map((m) => ({ transform: pos(p, size, m) })), 800, { easing: 'ease-in-out' });
    await play(d, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], 1000);
    d.remove();
    return true;
  } finally {
    release(el);
  }
}

// ---------- 互动道具 ----------

/** 飞行时转几圈（度） */
const SPIN: Record<PropId, number> = { tomato: 540, egg: 600, stinkyEgg: 600, slipper: 900, bomb: 360, rose: 200, like: 0, cheers: 30 };
const FLY_MS = 700;

/**
 * 从 from（发的人头像的屏幕矩形）扔到 to（对象头像），命中后按道具播效果，污渍留 1.5–2 秒再淡出。
 * 名额满了直接返回 false；播完（不含污渍的停留）返回 true。
 */
export async function throwAt(layer: FunLayer, from: RectLike, to: RectLike, prop: PropId, opts: ThrowOptions = {}): Promise<boolean> {
  const el = layer.el;
  if (!claim(el)) return false;
  try {
    const o = origin(el);
    const a = centerIn(from, o).c;
    const { c, s } = centerIn(to, o);
    const size = Math.round(Math.min(84, Math.max(40, s * 0.72)));
    const svg = propSvg(prop);
    const n = 14;
    const pts = arcPoints(a, c, n);
    const frames = (alpha: number): Keyframe[] =>
      pts.map((p, i) => ({ transform: pos(p, size, `rotate(${((SPIN[prop] * i) / (n - 1)).toFixed(0)}deg) scale(${(1 + 0.3 * Math.sin((Math.PI * i) / (n - 1))).toFixed(2)})`), opacity: alpha }));
    opts.sound?.(prop, 'fly');
    // 两层残影跟在后面
    const ghosts = [0.32, 0.16].map((alpha, i) => {
      const g = sprite(el, svg, size, a, '', 0);
      void play(g, frames(alpha), FLY_MS, { delay: 45 * (i + 1), easing: 'cubic-bezier(.3,.1,.6,1)' }).then(() => {
        g.remove();
      });
      return g;
    });
    const main = sprite(el, svg, size, a);
    await play(main, frames(1), FLY_MS, { easing: 'cubic-bezier(.3,.1,.6,1)' });
    ghosts.forEach((g) => g.style.setProperty('display', 'none'));
    const grid = Math.max(24, s * 0.75);
    const key = opts.target !== undefined ? `t:${opts.target}` : `${Math.round(c.x / grid)}:${Math.round(c.y / grid)}`;
    await HIT[prop]({ el, main, c, s, size, key, prop, opts });
    return true;
  } finally {
    release(el);
  }
}

interface Hit {
  el: HTMLElement;
  /** 飞过来的那个道具（各效果自己决定留着还是拿掉） */
  main: HTMLDivElement;
  c: Pt;
  s: number;
  size: number;
  key: string;
  prop: PropId;
  opts: ThrowOptions;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** 一把小东西往四周溅开（汁水、碎片、星星），各自带重力感，淡出后拿掉 */
function scatter(el: HTMLElement, svg: string, c: Pt, count: number, dist: [number, number], size: number, ms: number, opt: { spin?: boolean; up?: number } = {}): Promise<void> {
  const all: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + rnd(-0.3, 0.3);
    const r = rnd(dist[0], dist[1]);
    const end = { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r * 0.8 + (opt.up ?? r * 0.4) };
    const mid = { x: c.x + Math.cos(ang) * r * 0.6, y: c.y + Math.sin(ang) * r * 0.6 - r * 0.15 };
    const sz = size * rnd(0.6, 1.1);
    const d = sprite(el, svg, sz, c);
    const rot = opt.spin ? rnd(-200, 200) : 0;
    all.push(
      play(
        d,
        [
          { transform: pos(c, sz, 'scale(.4) rotate(0deg)'), opacity: 1 },
          { transform: pos(mid, sz, `scale(1) rotate(${rot / 2}deg)`), opacity: 1, offset: 0.35 },
          { transform: pos(end, sz, `scale(.8) rotate(${rot}deg)`), opacity: 0 },
        ],
        ms,
        { easing: 'ease-out' },
      ).then(() => {
        d.remove();
      }),
    );
  }
  return Promise.all(all).then(() => undefined);
}

/** 糊上去的一大摊：先"啪"地放大，再挂到污渍账上 */
async function splat(h: Hit, svg: string, scale: number, extra?: (g: HTMLElement) => void): Promise<HTMLElement> {
  const g = group(h.el);
  const sz = h.s * scale;
  const d = sprite(g, svg, sz, h.c, `rotate(${rnd(-20, 20).toFixed(0)}deg)`);
  extra?.(g);
  stain(h.el, h.key, g, 1700);
  await play(d, [{ transform: pos(h.c, sz, 'scale(.25)') }, { transform: pos(h.c, sz, 'scale(1.18)'), offset: 0.6 }, { transform: pos(h.c, sz, 'scale(1)') }], 180, { easing: 'ease-out' });
  return g;
}

const HIT: Record<PropId, (h: Hit) => Promise<void>> = {
  tomato: async (h) => {
    h.main.remove();
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    await Promise.all([splat(h, SPLAT_TOMATO, 1.55), scatter(h.el, dot('#d93a28'), h.c, 11, [h.s * 0.7, h.s * 1.3], h.s * 0.16, 560)]);
  },
  egg: (h) => eggHit(h, false),
  stinkyEgg: (h) => eggHit(h, true),
  slipper: async (h) => {
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    const sz = h.size;
    const off = { x: h.c.x + h.s * 0.6, y: h.c.y + h.s * 1.1 };
    // 拍扁一下再弹开掉下去；星星绕着冒出来
    await Promise.all([
      play(
        h.main,
        [
          { transform: pos(h.c, sz, 'rotate(0deg) scale(1.25,.8)') },
          { transform: pos({ x: h.c.x + h.s * 0.3, y: h.c.y - h.s * 0.4 }, sz, 'rotate(120deg) scale(1)'), offset: 0.35 },
          { transform: pos(off, sz, 'rotate(260deg) scale(.9)'), opacity: 0 },
        ],
        650,
        { easing: 'ease-in' },
      ).then(() => {
        h.main.remove();
      }),
      scatter(h.el, STAR, { x: h.c.x, y: h.c.y - h.s * 0.2 }, 5, [h.s * 0.55, h.s * 0.8], h.s * 0.28, 950, { spin: true, up: -h.s * 0.05 }),
    ]);
  },
  bomb: async (h) => {
    // 引信闪三下，再炸开：冒烟，头像熏黑一下
    h.opts.sound?.(h.prop, 'fuse');
    const sp = { x: h.c.x + h.size * 0.42, y: h.c.y - h.size * 0.42 };
    const spark = sprite(h.el, SPARK, h.size * 0.6, sp);
    await play(spark, [0.6, 1.5, 0.6, 1.5, 0.6, 1.7].map((k) => ({ transform: pos(sp, h.size * 0.6, `scale(${k})`) })), 520);
    spark.remove();
    h.main.remove();
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    const bz = h.s * 2.4;
    const burst = sprite(h.el, BURST, bz, h.c);
    const soot = sprite(h.el, SOOT, h.s * 0.98, h.c, '', 0);
    const smoke = [0, 1, 2, 3].map((i) => {
      const from = { x: h.c.x + rnd(-h.s * 0.25, h.s * 0.25), y: h.c.y };
      const d = sprite(h.el, SMOKE, h.s * 0.85, from, '', 0);
      return play(
        d,
        [
          { transform: pos(from, h.s * 0.85, 'scale(.4)'), opacity: 0.85 },
          { transform: pos({ x: from.x + rnd(-24, 24), y: from.y - h.s * 1.1 }, h.s * 0.85, 'scale(1.5)'), opacity: 0 },
        ],
        1100,
        { delay: i * 70, easing: 'ease-out' },
      ).then(() => {
        d.remove();
      });
    });
    await Promise.all([
      play(burst, [{ transform: pos(h.c, bz, 'scale(.2) rotate(0deg)'), opacity: 1 }, { transform: pos(h.c, bz, 'scale(1.05) rotate(15deg)'), opacity: 1, offset: 0.45 }, { transform: pos(h.c, bz, 'scale(1.2) rotate(25deg)'), opacity: 0 }], 650, { easing: 'ease-out' }).then(() => {
        burst.remove();
      }),
      play(soot, [{ opacity: 0 }, { opacity: 0.78, offset: 0.1 }, { opacity: 0.78, offset: 0.45 }, { opacity: 0 }], 1100).then(() => {
        soot.remove();
      }),
      ...smoke,
    ]);
  },
  rose: async (h) => {
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    // 玫瑰落在头像下沿，花瓣从上面飘下来；玫瑰本身当"污渍"留一会儿
    const g = group(h.el);
    const rest = { x: h.c.x, y: h.c.y + h.s * 0.3 };
    h.main.remove();
    const rose = sprite(g, propSvg('rose'), h.size * 1.3, rest);
    stain(h.el, h.key, g, 1600);
    void play(rose, [{ transform: pos(rest, h.size * 1.3, 'rotate(-30deg) scale(1.2)') }, { transform: pos(rest, h.size * 1.3, 'rotate(-18deg) scale(1)') }], 260, { easing: 'ease-out' });
    const petals = Array.from({ length: 9 }, (_, i) => {
      const x0 = h.c.x + rnd(-h.s * 0.6, h.s * 0.6);
      const top = { x: x0, y: h.c.y - h.s * 0.7 };
      const sz = h.s * 0.24;
      const d = sprite(h.el, PETAL, sz, top, '', 0);
      const sway = rnd(10, 20);
      return play(
        d,
        [
          { transform: pos(top, sz, 'rotate(0deg)'), opacity: 0 },
          { transform: pos({ x: x0 + sway, y: top.y + h.s * 0.35 }, sz, 'rotate(60deg)'), opacity: 1, offset: 0.25 },
          { transform: pos({ x: x0 - sway, y: top.y + h.s * 0.75 }, sz, 'rotate(140deg)'), opacity: 1, offset: 0.6 },
          { transform: pos({ x: x0 + sway / 2, y: top.y + h.s * 1.2 }, sz, 'rotate(220deg)'), opacity: 0 },
        ],
        1400,
        { delay: i * 90, easing: 'ease-in-out' },
      ).then(() => {
        d.remove();
      });
    });
    await Promise.all(petals);
  },
  like: async (h) => {
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    const sz = h.size;
    const up = { x: h.c.x, y: h.c.y - h.s * 0.45 };
    await Promise.all([
      play(
        h.main,
        [
          { transform: pos(h.c, sz, 'scale(.5)'), opacity: 1 },
          { transform: pos(h.c, sz, 'scale(1.9)'), opacity: 1, offset: 0.2 },
          { transform: pos(h.c, sz, 'scale(1.5)'), opacity: 1, offset: 0.35 },
          { transform: pos(up, sz, 'scale(1.5)'), opacity: 0 },
        ],
        1300,
        { easing: 'ease-out' },
      ).then(() => {
        h.main.remove();
      }),
      scatter(h.el, STAR, h.c, 6, [h.s * 0.6, h.s * 0.9], h.s * 0.2, 850, { spin: true, up: -h.s * 0.1 }),
    ]);
  },
  cheers: async (h) => {
    h.main.remove();
    // 两杯从两边碰到一起：叮一下，泡沫往上冒
    const sz = h.size * 1.25;
    const mug = propSvg('cheers');
    const l = sprite(h.el, mug, sz, h.c);
    const r = sprite(h.el, mug, sz, h.c);
    const at = (dx: number, k: string): string => pos({ x: h.c.x + dx, y: h.c.y }, sz, k);
    const meet = Promise.all([
      play(l, [{ transform: at(-h.s * 0.7, 'rotate(0deg)') }, { transform: at(-h.s * 0.2, 'rotate(18deg)') }], 260, { easing: 'ease-in' }),
      play(r, [{ transform: at(h.s * 0.7, 'scaleX(-1) rotate(0deg)') }, { transform: at(h.s * 0.2, 'scaleX(-1) rotate(18deg)') }], 260, { easing: 'ease-in' }),
    ]);
    await meet;
    h.opts.sound?.(h.prop, 'hit');
    h.opts.onHit?.(h.prop);
    const top = { x: h.c.x, y: h.c.y - h.s * 0.35 };
    const bubbles = Array.from({ length: 7 }, (_, i) => {
      const from = { x: top.x + rnd(-h.s * 0.25, h.s * 0.25), y: top.y };
      const sz2 = h.s * rnd(0.07, 0.13);
      const d = sprite(h.el, dot('#ffffff', '#f5d27a'), sz2, from, '', 0);
      return play(
        d,
        [
          { transform: pos(from, sz2, 'scale(.5)'), opacity: 0.95 },
          { transform: pos({ x: from.x + rnd(-10, 10), y: from.y - h.s * rnd(0.4, 0.8) }, sz2, 'scale(1.2)'), opacity: 0 },
        ],
        900,
        { delay: i * 60, easing: 'ease-out' },
      ).then(() => {
        d.remove();
      });
    });
    await Promise.all([
      scatter(h.el, STAR, top, 4, [h.s * 0.3, h.s * 0.5], h.s * 0.22, 550, { spin: true, up: -h.s * 0.1 }),
      ...bubbles,
      play(l, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], 1100, {}).then(() => {
        l.remove();
      }),
      play(r, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], 1100, {}).then(() => {
        r.remove();
      }),
    ]);
  },
};

async function eggHit(h: Hit, stinky: boolean): Promise<void> {
  h.main.remove();
  h.opts.sound?.(h.prop, 'hit');
  h.opts.onHit?.(h.prop);
  const shells = scatter(h.el, SHELL, h.c, 4, [h.s * 0.5, h.s * 0.85], h.s * 0.28, 700, { spin: true });
  const g = await splat(h, splatEgg(stinky), 1.35, (grp) => {
    // 慢慢往下流的一道
    const dz = h.s * 0.42;
    const p = { x: h.c.x + h.s * 0.12, y: h.c.y + h.s * 0.18 };
    const drip = sprite(grp, DRIP, dz, p);
    void play(drip, [{ transform: pos(p, dz, 'translateY(0) scaleY(.5)') }, { transform: pos({ x: p.x, y: p.y + h.s * 0.6 }, dz, 'scaleY(1.4)') }], 1700, { delay: 150, easing: 'ease-in' });
  });
  if (stinky) {
    // 几缕臭气飘起来（跟着污渍一起淡出）
    for (let i = 0; i < 3; i++) {
      const from = { x: h.c.x + (i - 1) * h.s * 0.28, y: h.c.y - h.s * 0.15 };
      const sz = h.s * 0.5;
      const d = sprite(g, STINK, sz, from, '', 0);
      void play(
        d,
        [
          { transform: pos(from, sz, 'scale(.6)'), opacity: 0 },
          { transform: pos({ x: from.x + 6, y: from.y - h.s * 0.3 }, sz, 'scale(1)'), opacity: 0.9, offset: 0.4 },
          { transform: pos({ x: from.x - 6, y: from.y - h.s * 0.6 }, sz, 'scale(1.1)'), opacity: 0 },
        ],
        1100,
        { delay: 120 + i * 200, easing: 'ease-out' },
      );
    }
  }
  await shells;
}

// ---------- 音效配方（WebAudio 现场合成，游戏用自己的 AudioContext 和输出节点放，跟着自己的静音开关） ----------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseOf(ac: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ac);
  if (!b) {
    b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.6), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, b);
  }
  return b;
}

function tone(ac: BaseAudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

function hiss(ac: BaseAudioContext, out: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number): void {
  const src = ac.createBufferSource();
  src.buffer = noiseOf(ac);
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/**
 * 道具的音效（全部 0.1–1 秒）：fly 起飞的嗖声，fuse 炸弹引信的嘶嘶声，hit 各道具命中的声音（蛋壳碎、番茄爆、拖鞋啪、炸弹轰、碰杯叮……）。
 * 游戏在 ThrowOptions.sound 里调它，传自己的 AudioContext 和输出节点（静音时别调）。出错不往外抛。
 */
export function playFunSound(ac: BaseAudioContext, out: AudioNode, prop: PropId, phase: FunPhase, vol = 1): void {
  try {
    const t = ac.currentTime + 0.005;
    const v = (x: number): number => x * vol;
    if (phase === 'fly') return hiss(ac, out, t, 'bandpass', 400, 2400, 0.45, v(0.16));
    if (phase === 'fuse') {
      for (let i = 0; i < 4; i++) hiss(ac, out, t + i * 0.12, 'highpass', 5000, 3000, 0.1, v(0.12));
      return;
    }
    switch (prop) {
      case 'egg':
      case 'stinkyEgg':
        for (let i = 0; i < 3; i++) hiss(ac, out, t + i * 0.025, 'highpass', 3000, 2500, 0.012, v(0.3));
        hiss(ac, out, t + 0.06, 'lowpass', 700, 180, 0.28, v(0.4));
        if (prop === 'stinkyEgg') tone(ac, out, t + 0.25, 200, 110, 0.5, v(0.18), 'triangle');
        return;
      case 'tomato':
        hiss(ac, out, t, 'lowpass', 1800, 260, 0.3, v(0.55));
        tone(ac, out, t, 150, 60, 0.16, v(0.4));
        return;
      case 'slipper':
        hiss(ac, out, t, 'highpass', 1500, 1200, 0.06, v(0.65));
        tone(ac, out, t, 900, 480, 0.05, v(0.2), 'triangle');
        tone(ac, out, t + 0.12, 1800, 2100, 0.12, v(0.12));
        tone(ac, out, t + 0.22, 2200, 2500, 0.12, v(0.1));
        return;
      case 'bomb':
        tone(ac, out, t, 120, 32, 1.0, v(0.8));
        hiss(ac, out, t, 'lowpass', 4500, 120, 0.9, v(0.6));
        return;
      case 'rose':
        [1047, 1319, 1568].forEach((f, i) => tone(ac, out, t + i * 0.09, f, f, 0.5, v(0.12), 'triangle'));
        return;
      case 'like':
        tone(ac, out, t, 600, 1200, 0.08, v(0.3));
        tone(ac, out, t + 0.08, 1568, 1568, 0.4, v(0.16));
        return;
      case 'cheers':
        tone(ac, out, t, 2637, 2637, 0.35, v(0.18));
        tone(ac, out, t, 3520, 3520, 0.3, v(0.12));
        hiss(ac, out, t + 0.05, 'highpass', 6000, 5000, 0.4, v(0.06));
        return;
    }
  } catch {
    // 声音出错不能影响游戏
  }
}
