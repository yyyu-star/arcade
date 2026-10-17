/**
 * 画面特效：斩痕、光圈、火星、碎片、墨点、拖尾、伤害数字、脚印……
 * 全部用对象池里的 Image，每帧自己推进（不建补间：满屏几百个特效时补间的开销和垃圾太多）。
 * 只读核心的事件来放，不影响规则（DESIGN.md 5.3）。
 */
import Phaser from 'phaser';
import type { Atlas, Frame } from '../art/atlas.ts';

interface P {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 往下的加速度（碎片落地） */
  g: number;
  s0: number;
  s1: number;
  a0: number;
  a1: number;
  spin: number;
  /** 宽高各自缩放（斩痕要翻转） */
  sx: number;
  /** 跟着某个点走（光环跟主角） */
  follow: (() => { x: number; y: number }) | null;
  /** 不按 1/res 缩放的特殊图（Graphics 不在这里） */
  res: number;
  /** 地面层的东西：深度固定在地面 */
  ground: boolean;
}

export interface Spawn {
  frame: string;
  x: number;
  y: number;
  life: number;
  vx?: number;
  vy?: number;
  g?: number;
  s0?: number;
  s1?: number;
  a0?: number;
  a1?: number;
  rot?: number;
  spin?: number;
  tint?: number;
  /** 水平翻转（-1） */
  sx?: number;
  depth?: number;
  ground?: boolean;
  add?: boolean;
  follow?: () => { x: number; y: number };
}

export class Fx {
  private readonly free: Phaser.GameObjects.Image[] = [];
  private readonly live: P[] = [];
  private readonly frames: Map<string, Frame>;
  private readonly scene: Phaser.Scene;
  /** 同屏上限：超了丢新来的小东西（不会卡） */
  cap: number;

  constructor(scene: Phaser.Scene, atlas: Atlas, cap: number) {
    this.scene = scene;
    this.frames = atlas.frames;
    this.cap = cap;
  }

  get count(): number {
    return this.live.length;
  }

  spawn(o: Spawn): void {
    if (this.live.length >= this.cap) return;
    const f = this.frames.get(o.frame);
    if (!f) return;
    const img = this.free.pop() ?? this.scene.add.image(0, 0, 'atlas', o.frame);
    img.setFrame(o.frame).setOrigin(f.ox, f.oy).setVisible(true).setActive(true);
    img.setRotation(o.rot ?? 0).setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.tint !== undefined) img.setTint(o.tint);
    else img.clearTint();
    img.setDepth(o.depth ?? (o.ground ? -500 : o.y + 2000));
    this.live.push({
      img,
      life: 0,
      max: o.life,
      x: o.x,
      y: o.y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      g: o.g ?? 0,
      s0: o.s0 ?? 1,
      s1: o.s1 ?? o.s0 ?? 1,
      a0: o.a0 ?? 1,
      a1: o.a1 ?? 0,
      spin: o.spin ?? 0,
      sx: o.sx ?? 1,
      follow: o.follow ?? null,
      res: f.res,
      ground: !!o.ground,
    });
    this.place(this.live[this.live.length - 1]!, 0);
  }

  private place(p: P, t: number): void {
    // 缩放用"先快后慢"的缓动，透明度线性
    const e = 1 - (1 - t) * (1 - t);
    const s = (p.s0 + (p.s1 - p.s0) * e) / p.res;
    let x = p.x;
    let y = p.y;
    if (p.follow) {
      const q = p.follow();
      x += q.x;
      y += q.y;
    }
    p.img.setPosition(x, y).setScale(s * p.sx, s).setAlpha(p.a0 + (p.a1 - p.a0) * t);
  }

  update(dtMs: number): void {
    const live = this.live;
    let j = 0;
    for (let i = 0; i < live.length; i++) {
      const p = live[i]!;
      p.life += dtMs;
      if (p.life >= p.max) {
        p.img.setVisible(false).setActive(false);
        this.free.push(p.img);
        continue;
      }
      const dt = dtMs / 1000;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin) p.img.rotation += p.spin * dt;
      this.place(p, p.life / p.max);
      live[j++] = p;
    }
    live.length = j;
  }
}

/** 伤害数字：同屏最多 cap 个（手感清单第 3 条：30），满了顶掉最老的；暴击金色加大、弹一下 */
export class DamageNumbers {
  private readonly pool: { c: Phaser.GameObjects.Container; life: number; x: number; y: number; crit: boolean }[] = [];
  private next = 0;
  private readonly digitW: number;
  private readonly res: number;
  readonly cap: number;

  constructor(scene: Phaser.Scene, atlas: Atlas, cap = 30) {
    this.cap = cap;
    const f = atlas.frames.get('d0')!;
    this.res = f.res;
    this.digitW = (f.w / f.res) * 0.74;
    for (let i = 0; i < cap; i++) {
      const c = scene.add.container(0, 0).setVisible(false).setDepth(9000);
      for (let k = 0; k < 6; k++) c.add(scene.add.image(0, 0, 'atlas', 'd0').setVisible(false));
      this.pool.push({ c, life: -1, x: 0, y: 0, crit: false });
    }
  }

  get visible(): number {
    return this.pool.filter((p) => p.life >= 0).length;
  }

  show(x: number, y: number, n: number, crit: boolean): void {
    // 普通伤害满了就不出（暴击优先占位）
    let slot = this.pool.find((p) => p.life < 0);
    if (!slot) {
      if (!crit) return;
      slot = this.pool[this.next]!;
      this.next = (this.next + 1) % this.cap;
    }
    const s = String(Math.round(n));
    const imgs = slot.c.list as Phaser.GameObjects.Image[];
    for (let k = 0; k < imgs.length; k++) {
      const im = imgs[k]!;
      if (k < s.length) {
        im.setFrame(`d${s[k]}`)
          .setVisible(true)
          .setScale(1 / this.res)
          .setPosition((k - (s.length - 1) / 2) * this.digitW, 0);
        if (crit) im.setTint(0xffcf2e);
        else im.clearTint();
      } else im.setVisible(false);
    }
    slot.life = 0;
    slot.x = x + (Math.random() - 0.5) * 18;
    slot.y = y;
    slot.crit = crit;
    slot.c.setVisible(true).setAlpha(1);
  }

  update(dtMs: number): void {
    for (const p of this.pool) {
      if (p.life < 0) continue;
      p.life += dtMs;
      const t = p.life / 650;
      if (t >= 1) {
        p.life = -1;
        p.c.setVisible(false);
        continue;
      }
      // 先弹大再落回，往上飘，最后淡掉
      const base = p.crit ? 1.15 : 0.72;
      const pop = t < 0.15 ? 1 + (1 - t / 0.15) * 0.7 : 1;
      p.c.setPosition(p.x, p.y - 38 * (1 - (1 - t) * (1 - t))).setScale(base * pop).setAlpha(t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
    }
  }
}
