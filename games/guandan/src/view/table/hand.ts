/**
 * 我的手牌：按点数（或按牌型）分列，同列竖着叠放，大牌在左。点选或按住滑动多选，选中上抬。
 *
 * 手机横屏（844×390）时世界坐标缩到约 0.54 倍。叠放高度有上限（不能盖到按钮），一列 5 张时每张只露约 30（约 16 CSS 像素），
 * 4 张时露约 40（约 21 CSS 像素）。所以横向放得下时一列最多 4 张（列间距不小于 72，约 39 CSS 像素），放不下才用 5 张。
 */
import Phaser from 'phaser';
import { sortHand, type Card } from '../../variants/guandan/core/index.ts';
import { audio } from '../audio.ts';
import { dur, settle } from '../anim.ts';
import { worldH, worldW } from '../ui/kit.ts';
import { CardView, HAND_H, HAND_W } from './card.ts';

export type { SortMode } from './columns.ts';
import { MAX_COL, columnsFor, type SortMode } from './columns.ts';

const BOTTOM_PAD = 8;
/** 手牌区最高能叠到多高（含一张整牌） */
const MAX_STACK = 248;
const LIFT = 24;
/** 一列最多 4 张时，列间距至少要这么宽才用 */
const MIN_SPACING_SHORT = 72;

interface Slot {
  x: number;
  y: number;
  depth: number;
}

export class HandView {
  private scene: Phaser.Scene;
  private views = new Map<Card, CardView>();
  private sel = new Set<Card>();
  private slots = new Map<Card, Slot>();
  private level = 2;
  private cards: Card[] = [];
  mode: SortMode = 'rank';
  private allowed: Set<Card> | null = null;
  private single = false;
  enabled = false;
  private dragging: { mode: boolean; seen: Set<Card> } | null = null;
  onChange: () => void = () => {};

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.move(p));
    scene.input.on('pointerup', () => (this.dragging = null));
    scene.input.on('pointerupoutside', () => (this.dragging = null));
  }

  get topY(): number {
    let top = worldH;
    for (const s of this.slots.values()) top = Math.min(top, s.y - HAND_H / 2);
    return top;
  }

  private world(p: Phaser.Input.Pointer): { x: number; y: number } {
    const v = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    return { x: v.x, y: v.y };
  }

  private hit(x: number, y: number): Card | null {
    let best: Card | null = null;
    let bestDepth = -1;
    for (const [c, v] of this.views) {
      if (!v.visible) continue;
      if (Math.abs(x - v.x) <= HAND_W / 2 && Math.abs(y - v.y) <= HAND_H / 2 && v.depth > bestDepth) {
        best = c;
        bestDepth = v.depth;
      }
    }
    return best;
  }

  private down(p: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    const { x, y } = this.world(p);
    const c = this.hit(x, y);
    if (c === null) return;
    if (this.allowed && !this.allowed.has(c)) return;
    const on = !this.sel.has(c);
    if (this.single) {
      this.setSelected(on ? [c] : []);
      this.onChange();
      return;
    }
    this.dragging = { mode: on, seen: new Set([c]) };
    this.toggle(c, on);
    this.onChange();
  }

  private move(p: Phaser.Input.Pointer): void {
    if (!this.dragging || !p.isDown) return;
    const { x, y } = this.world(p);
    const c = this.hit(x, y);
    if (c === null || this.dragging.seen.has(c)) return;
    if (this.allowed && !this.allowed.has(c)) return;
    this.dragging.seen.add(c);
    this.toggle(c, this.dragging.mode);
    this.onChange();
  }

  private toggle(c: Card, on: boolean): void {
    if (on === this.sel.has(c)) return;
    if (on) this.sel.add(c);
    else this.sel.delete(c);
    audio.sfx(on ? 'select' : 'deselect');
    this.place(c, true);
  }

  selected(): Card[] {
    return this.cards.filter((c) => this.sel.has(c));
  }

  setSelected(cards: readonly Card[]): void {
    const want = new Set(cards.filter((c) => this.views.has(c)));
    for (const c of this.cards) {
      const on = want.has(c);
      if (on !== this.sel.has(c)) {
        if (on) this.sel.add(c);
        else this.sel.delete(c);
        this.place(c, true);
      }
    }
  }

  /** 进贡/还贡时只允许点这些牌，且只能选一张；null 恢复正常。 */
  setAllowed(allowed: readonly Card[] | null): void {
    this.allowed = allowed ? new Set(allowed) : null;
    this.single = allowed !== null;
    for (const [c, v] of this.views) v.setDim(this.allowed !== null && !this.allowed.has(c));
    if (this.allowed) this.setSelected(this.selected().filter((c) => this.allowed!.has(c)));
  }

  positionOf(c: Card): { x: number; y: number } | null {
    const v = this.views.get(c);
    return v ? { x: v.x, y: v.y } : null;
  }

  private computeSlots(): void {
    const W = worldW(this.scene);
    const margin = 26;
    const avail = W - margin * 2;
    const spacingFor = (n: number) => (n <= 1 ? 0 : Math.min(HAND_W + 6, (avail - HAND_W) / (n - 1)));
    let cols = columnsFor(this.cards, this.level, this.mode, MAX_COL - 1);
    if (cols.length > 1 && spacingFor(cols.length) < MIN_SPACING_SHORT) cols = columnsFor(this.cards, this.level, this.mode);
    const n = cols.length;
    const spacing = spacingFor(n);
    const total = spacing * (n - 1) + HAND_W;
    const x0 = W / 2 - total / 2 + HAND_W / 2;
    const maxLen = Math.max(1, ...cols.map((c) => c.length));
    const dy = maxLen <= 1 ? 0 : Math.min(40, (MAX_STACK - HAND_H) / (maxLen - 1));
    const bottomY = worldH - BOTTOM_PAD - HAND_H / 2;
    this.slots.clear();
    cols.forEach((col, i) => {
      col.forEach((c, j) => {
        this.slots.set(c, { x: x0 + i * spacing, y: bottomY - (col.length - 1 - j) * dy, depth: 100 + i * 10 + j });
      });
    });
  }

  private place(c: Card, animate: boolean): void {
    const v = this.views.get(c);
    const s = this.slots.get(c);
    if (!v || !s) return;
    const y = s.y - (this.sel.has(c) ? LIFT : 0);
    v.setDepth(s.depth);
    v.setSelected(this.sel.has(c));
    this.scene.tweens.killTweensOf(v);
    if (animate && dur(1) > 0) this.scene.tweens.add({ targets: v, x: s.x, y, duration: dur(140), ease: 'Quad.easeOut' });
    else v.setPosition(s.x, y);
  }

  /**
   * 换成新手牌：已有的牌移到新位置，新增的牌从 from（世界坐标）飞入，去掉的牌直接销毁（出牌动画另做）。
   */
  setHand(cards: readonly Card[], level: number, opts: { animate?: boolean; from?: { x: number; y: number } } = {}): void {
    const levelChanged = level !== this.level;
    this.level = level;
    this.cards = sortHand(cards, level);
    const keep = new Set(this.cards);
    for (const [c, v] of this.views) {
      if (!keep.has(c)) {
        v.destroy();
        this.views.delete(c);
        this.sel.delete(c);
      }
    }
    this.computeSlots();
    for (const c of this.cards) {
      let v = this.views.get(c);
      if (!v) {
        const s = this.slots.get(c)!;
        const from = opts.from ?? { x: s.x, y: s.y };
        v = new CardView(this.scene, from.x, from.y, c, level);
        this.views.set(c, v);
        if (this.allowed) v.setDim(!this.allowed.has(c));
      } else if (levelChanged) v.setLevel(level);
      this.place(c, opts.animate ?? true);
    }
  }

  /** 拿走一些牌的显示对象（出牌时交给出牌区继续做飞出动画），手牌重排。 */
  take(cards: readonly Card[]): CardView[] {
    const out: CardView[] = [];
    for (const c of cards) {
      const v = this.views.get(c);
      if (!v) continue;
      this.views.delete(c);
      this.sel.delete(c);
      v.setSelected(false);
      out.push(v);
    }
    const left = new Set(cards);
    this.cards = this.cards.filter((c) => !left.has(c));
    this.computeSlots();
    for (const c of this.cards) this.place(c, true);
    return out;
  }

  setMode(mode: SortMode): void {
    this.mode = mode;
    this.computeSlots();
    for (const c of this.cards) this.place(c, true);
  }

  relayout(): void {
    this.computeSlots();
    for (const c of this.cards) this.place(c, false);
  }

  /** 发牌动画：牌背从桌心逐张飞到位置后翻开。 */
  async dealIn(fromX: number, fromY: number): Promise<void> {
    const list = [...this.cards].sort((a, b) => this.slots.get(a)!.depth - this.slots.get(b)!.depth);
    if (dur(1) === 0) {
      for (const c of list) this.place(c, false);
      return;
    }
    const step = dur(26);
    await settle(new Promise<void>((resolve) => {
      list.forEach((c, i) => {
        const v = this.views.get(c)!;
        const s = this.slots.get(c)!;
        v.flip(false, this.level);
        v.setPosition(fromX, fromY).setScale(0.6).setAngle(-12);
        this.scene.tweens.add({
          targets: v,
          x: s.x,
          y: s.y,
          scale: 1,
          angle: 0,
          delay: i * step,
          duration: dur(260),
          ease: 'Cubic.easeOut',
          onStart: () => audio.sfx('deal'),
          onComplete: () => {
            this.scene.tweens.add({
              targets: v,
              scaleX: 0,
              duration: dur(90),
              yoyo: true,
              onYoyo: () => v.flip(true, this.level),
              onComplete: () => {
                if (i === list.length - 1) resolve();
              },
            });
          },
        });
      });
      if (list.length === 0) resolve();
    }), list.length * step + dur(260) + 2 * dur(90));
  }

  get count(): number {
    return this.cards.length;
  }

  destroy(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
  }

  /** 调试/冒烟：某张牌在世界坐标里的可点位置（露出部分的中心）。 */
  tapPoint(c: Card): { x: number; y: number } | null {
    const v = this.views.get(c);
    if (!v) return null;
    return { x: v.x - HAND_W / 2 + 22, y: v.y - HAND_H / 2 + 14 };
  }

  get size(): number {
    return this.views.size;
  }
}
