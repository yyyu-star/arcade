/**
 * 新道具的画面和反馈：摆设（灯笼架、纸扎）的场上精灵池与碎裂演出、符咒炸弹的全屏冲击、精英宝箱三档开箱的光效、
 * 铜钱袋的飘字。只读核心的状态和事件，不影响规则；GameScene 在对应事件里调这里的函数。
 * 单独成文件是因为 GameScene 已经 1500 行，这些东西彼此相关、又都要"池化 + 每帧推进"。
 */
import Phaser from 'phaser';
import { MAX_PROPS, type World } from '../../core/index.ts';
import type { Frame } from '../art/atlas.ts';
import { sfx } from '../audio/sfx.ts';
import { LOW_MEMORY } from '../viewport.ts';
import type { Fx } from './fx.ts';

export interface ItemsHost {
  scene: Phaser.Scene;
  frame: (key: string) => Frame;
  fx: Fx;
  ground: Fx;
  shake: (ms: number, k: number) => void;
  whiteFlash: () => void;
  /** 打击停顿：只是暂停送拍（核心照样按拍走，确定性不受影响） */
  freeze: (ms: number) => void;
}

/** 摆设的显示大小（原图按主角 70 高画的，摆设略小一点，不抢怪的风头） */
const PROP_SCALE = 0.85;
/** 灯笼在图里的位置相对脚底的偏移（暖光晕放这儿） */
const LANTERN_GLOW = { x: 18 * PROP_SCALE, y: -43 * PROP_SCALE };

const WOOD = [0x9a6a3a, 0x6d4524, 0xb98a52];
const PAPER = [0xf7f1e4, 0xe2452f, 0xf2c94c, 0x2f9e6e];
const RAINBOW = [0xff5a4a, 0xffd23a, 0x5fd38a, 0x4aa8ff, 0xb46bff];
const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

interface PropView {
  gen: number;
  kind: number;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
}

export class Items {
  private readonly props: (PropView | null)[] = new Array(MAX_PROPS).fill(null);
  private readonly gfx: Phaser.GameObjects.Graphics;
  /** 炸弹的符文圈：圆心、最大半径、已过多久 */
  private rings: { x: number; y: number; r: number; t: number }[] = [];
  private readonly floats: { text: Phaser.GameObjects.Text; t: number; x: number; y: number }[] = [];
  private now = 0;

  private readonly h: ItemsHost;

  constructor(h: ItemsHost) {
    this.h = h;
    this.gfx = h.scene.add.graphics().setDepth(8100);
  }

  // ───────────── 摆设：场上精灵池 ─────────────

  /** 每帧：摆设按槽位对应一个精灵（pGen 变了就是换了一个，重设外观）；深度按脚底 y，和怪、主角正确遮挡 */
  drawProps(w: World, dt: number): void {
    this.now += dt;
    for (let i = 0; i < MAX_PROPS; i++) {
      let v = this.props[i];
      if (!w.pAlive[i]) {
        if (v?.img.visible) {
          v.img.setVisible(false);
          v.glow.setVisible(false);
        }
        continue;
      }
      const kind = w.pKind[i]!;
      if (!v || v.gen !== w.pGen[i] || v.kind !== kind) {
        const f = this.h.frame(kind === 0 ? 'prop_lantern' : 'prop_paper');
        const img = v?.img ?? this.h.scene.add.image(0, 0, 'atlas', f.key);
        const glow = v?.glow ?? this.h.scene.add.image(0, 0, 'atlas', this.h.frame('haze').key);
        const hz = this.h.frame('haze');
        img.setFrame(f.key).setOrigin(f.ox, f.oy).setVisible(true).setScale(PROP_SCALE / f.res);
        // 灯笼架夜里有暖光晕；纸扎不发光。普通混合的橙色，雪地上也看得出
        glow.setFrame(hz.key).setOrigin(hz.ox, hz.oy).setTint(0xff8a2a).setScale(2.1 / hz.res).setVisible(kind === 0);
        v = this.props[i] = { gen: w.pGen[i]!, kind, img, glow };
      }
      const x = w.pX[i]!;
      const y = w.pY[i]!;
      v.img.setPosition(x, y).setDepth(y);
      if (kind === 0) {
        v.glow.setPosition(x + LANTERN_GLOW.x, y + LANTERN_GLOW.y).setDepth(y - 0.2).setAlpha(0.45 + Math.sin(this.now * 0.007 + i * 1.7) * 0.07 + Math.sin(this.now * 0.019 + i) * 0.03);
      }
    }
  }

  // ───────────── 摆设：碎裂 ─────────────

  /** 碰碎摆设（Ev.Prop）：灯笼架飞木片、红纸和火星；纸扎飞彩纸屑；掉了东西就在原地迸一圈金星，像是从里面蹦出来 */
  propBreak(x: number, y: number, kind: number, drop: number): void {
    const { fx, ground } = this.h;
    const n = LOW_MEMORY ? 0.4 : 1;
    if (kind === 0) {
      sfx.play('propWood', { volume: 0.8 });
      for (let k = 0; k < Math.round(9 * n) + 2; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 110 + Math.random() * 120;
        fx.spawn({ frame: 'shard', x, y: y - 24, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 150, g: 520, life: 520 + Math.random() * 240, s0: 3, s1: 1.6, a0: 1, a1: 0.2, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 20, tint: WOOD[k % WOOD.length] });
      }
      // 灯笼本体掉下来摔开：一盏红灯笼砸向地面、淡出
      fx.spawn({ frame: 'lantern', x: x + 14, y: y - 40, vx: 20, vy: -60, g: 900, life: 360, s0: 0.9, s1: 0.7, a0: 1, a1: 0, rot: 0, spin: 3, tint: 0xff5a3a });
      if (!LOW_MEMORY) {
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI * 2;
          fx.spawn({ frame: 'mote', x: x + 10, y: y - 30, vx: Math.cos(a) * 90, vy: -90 - Math.random() * 120, g: 120, life: 520 + Math.random() * 260, s0: 1.1, s1: 0.1, tint: k % 2 ? 0xffb02e : 0xff5a2a });
        }
      }
      fx.spawn({ frame: 'haze', x: x + 12, y: y - 36, life: 260, s0: 1, s1: 3, a0: 0.8, a1: 0, tint: 0xff8a2a });
      ground.spawn({ frame: 'ring', x, y, life: 360, s0: 0.3, s1: 1.1, a0: 0.8, a1: 0, tint: 0xc0702a, ground: true });
    } else {
      sfx.play('propPaper', { volume: 0.8 });
      for (let k = 0; k < Math.round(14 * n) + 2; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 70 + Math.random() * 130;
        // 纸片轻：重力小、转得慢、飘得久
        fx.spawn({ frame: 'petal', x, y: y - 28, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 120, g: 160, life: 800 + Math.random() * 400, s0: 2.2, s1: 1.2, a0: 1, a1: 0, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10, tint: PAPER[k % PAPER.length] });
      }
      for (let k = 0; k < Math.round(5 * n); k++) {
        const a = Math.random() * Math.PI * 2;
        fx.spawn({ frame: 'shard', x, y: y - 20, vx: Math.cos(a) * 100, vy: -80 - Math.random() * 60, g: 480, life: 480, s0: 1.8, s1: 1, a0: 1, a1: 0.2, rot: Math.random() * 6, spin: 10, tint: 0xe8d7a8 });
      }
      fx.spawn({ frame: 'haze', x, y: y - 26, life: 300, s0: 0.8, s1: 2.2, a0: 0.75, a1: 0, tint: 0xf6efdc });
    }
    if (drop !== 0) {
      // 掉了东西：原地一圈金色涟漪 + 几颗向上蹦的金星，和碎片错开一点时间看得更清楚
      const tint = drop === 6 ? 0xff7a2a : 0xffd23a;
      fx.spawn({ frame: 'ring', x, y: y - 6, life: 380, s0: 0.2, s1: 1.1, a0: 1, a1: 0, tint, depth: y + 2100 });
      if (!LOW_MEMORY) {
        for (let k = 0; k < 6; k++) {
          const a = -Math.PI / 2 + (k - 2.5) * 0.45;
          fx.spawn({ frame: 'spark', x, y: y - 8, vx: Math.cos(a) * 140, vy: Math.sin(a) * 200, g: 600, life: 420, s0: 1.1, s1: 0.3, tint: k % 2 ? 0xffd23a : 0xffffff, rot: Math.random() });
        }
      }
    }
  }

  // ───────────── 符咒炸弹 ─────────────

  /** 全屏冲击：金色符文圈从主角扩到半径、符纸向外飞、白闪、震屏（大事件，可以震）、一声重音效 */
  bombBlast(x: number, y: number, r: number): void {
    const { fx, ground } = this.h;
    sfx.play('bomb');
    this.h.whiteFlash();
    this.h.shake(340, 0.013);
    this.h.freeze(70);
    this.rings.push({ x, y, r, t: 0 });
    fx.spawn({ frame: 'haze', x, y: y - 20, life: 320, s0: 1, s1: 9, a0: 0.9, a1: 0, tint: 0xff9a2a, depth: 7000 });
    ground.spawn({ frame: 'bagua', x, y, life: 700, s0: 1, s1: (r * 2) / 44, a0: 0.55, a1: 0, rot: 0, spin: 3, ground: true });
    // 符纸：绕一圈向外飞，到半径处落尽
    const n = LOW_MEMORY ? 8 : 20;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const sp = r / 0.55;
      fx.spawn({ frame: 'talisman', x, y: y - 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75, life: 550, s0: 1.4, s1: 1, a0: 1, a1: 0, rot: a, spin: 6, depth: 7000 });
    }
    if (!LOW_MEMORY) for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 260;
      fx.spawn({ frame: 'spark', x, y: y - 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, life: 420, s0: 1.4, s1: 0.2, tint: k % 2 ? 0xffd23a : 0xff7a2a, rot: Math.random() * 3, depth: 7000 });
    }
  }

  // ───────────── 精英宝箱 ─────────────

  /** 开箱的光：1 件普通光圈；3 件金光 + 光柱；5 件五色光柱 + 彩纸 + 层层光圈。顿帧返回给调用方当作"停顿" */
  chestBig(x: number, y: number, n: number): void {
    const { fx, ground, scene } = this.h;
    if (n >= 5) {
      sfx.play('chestRainbow');
      this.h.whiteFlash();
      this.h.shake(260, 0.007);
      this.h.freeze(160);
      ground.spawn({ frame: 'bagua', x, y, life: 1500, s0: 1.2, s1: 3.6, a0: 0.9, a1: 0, rot: 0, spin: 2, ground: true });
      RAINBOW.forEach((c, k) => {
        const ox = (k - 2) * 46;
        // 光柱压在主角后面（不把主角染成一个颜色）；叠两节一直通到屏幕上沿
        for (const up of [0, 300]) fx.spawn({ frame: 'pillar', x: x + ox, y: y + 8 - up, life: 1500, s0: 1.2, s1: 1.8, a0: 0.95, a1: 0, tint: c, depth: y - 0.5 });
        scene.time.delayedCall(k * 110, () => {
          fx.spawn({ frame: 'ring', x, y: y - 10, life: 700, s0: 0.3, s1: 3 + k * 0.5, a0: 1, a1: 0, tint: c, depth: 7000 });
        });
      });
      const m = LOW_MEMORY ? 10 : 36;
      for (let k = 0; k < m; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const v = 180 + Math.random() * 260;
        fx.spawn({ frame: k % 2 ? 'petal' : 'shard', x, y: y - 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 420, life: 1000 + Math.random() * 500, s0: 1.8, s1: 1, a0: 1, a1: 0, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 14, tint: RAINBOW[k % 5], depth: 7100 });
      }
    } else if (n >= 3) {
      sfx.play('chestGold');
      this.h.shake(120, 0.004);
      this.h.freeze(110);
      ground.spawn({ frame: 'bagua', x, y, life: 1100, s0: 1, s1: 2.6, a0: 0.9, a1: 0, rot: 0, spin: 2, ground: true });
      for (const up of [0, 300]) fx.spawn({ frame: 'pillar', x, y: y + 8 - up, life: 1200, s0: 1.6, s1: 2.3, a0: 1, a1: 0, tint: 0xffc928, depth: y - 0.5 });
      fx.spawn({ frame: 'haze', x, y: y - 10, life: 500, s0: 1.5, s1: 5, a0: 0.8, a1: 0, tint: 0xffc928, depth: y - 0.4 });
      fx.spawn({ frame: 'ring', x, y: y - 10, life: 600, s0: 0.3, s1: 3.2, a0: 1, a1: 0, tint: 0xffd23a, depth: 7000 });
      scene.time.delayedCall(150, () => fx.spawn({ frame: 'ring', x, y: y - 10, life: 600, s0: 0.3, s1: 4.4, a0: 1, a1: 0, tint: 0xffa82e, depth: 7000 }));
      const m = LOW_MEMORY ? 6 : 18;
      for (let k = 0; k < m; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        const v = 140 + Math.random() * 180;
        fx.spawn({ frame: 'spark', x, y: y - 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 380, life: 800, s0: 1.4, s1: 0.3, a0: 1, a1: 0, tint: k % 2 ? 0xffd23a : 0xffffff, rot: Math.random() * 3, depth: 7100 });
      }
    } else {
      // 一件：和以前一样的普通光，不抢戏
      fx.spawn({ frame: 'ring', x, y: y - 10, life: 420, s0: 0.3, s1: 2, a0: 1, a1: 0, tint: 0xffe08a, depth: 7000 });
      fx.spawn({ frame: 'pillar', x, y: y + 8, life: 500, s0: 0.7, s1: 1, a0: 0.9, a1: 0, depth: 7000 });
    }
  }

  // ───────────── 飘字 ─────────────

  /** 头上飘一行字（"+N 铜钱"）：池里最多几条，不新建 */
  floatText(x: number, y: number, text: string, color: string): void {
    let f = this.floats.find((q) => q.t < 0);
    if (!f) {
      if (this.floats.length >= 6) return;
      const t = this.h.scene.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#ffd23a', stroke: '#17131c', strokeThickness: 6 })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(9200);
      f = { text: t, t: -1, x, y };
      this.floats.push(f);
    }
    f.text.setText(text).setColor(color).setVisible(true);
    f.t = 0;
    f.x = x;
    f.y = y;
  }

  // ───────────── 每帧推进 ─────────────

  update(dt: number): void {
    for (const f of this.floats) {
      if (f.t < 0) continue;
      f.t += dt;
      const p = f.t / 1000;
      if (p >= 1) {
        f.t = -1;
        f.text.setVisible(false);
        continue;
      }
      // 先弹一下再慢慢上飘淡出
      const pop = p < 0.12 ? 0.6 + (p / 0.12) * 0.6 : 1.2 - Math.min(0.2, (p - 0.12) * 0.5);
      f.text.setPosition(f.x, f.y - 20 - p * 46).setScale(pop).setAlpha(p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4);
    }
    const g = this.gfx;
    g.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const q = this.rings[i]!;
      q.t += dt;
      const p = q.t / 650;
      if (p >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      const r = q.r * e;
      const a = 1 - p * p;
      // 外圈：墨边 + 金线；内圈慢半拍，跟在后面像第二道
      for (const [k, w0] of [[1, 12], [0.82, 8]] as const) {
        const rr = r * k;
        g.lineStyle(w0 + 5, 0x17131c, a * 0.9).strokeEllipse(q.x, q.y - 8, rr * 2, rr * 1.5);
        g.lineStyle(w0, 0xffc928, a).strokeEllipse(q.x, q.y - 8, rr * 2, rr * 1.5);
      }
      // 圈上的符文刻度：一圈短竖线，随圈一起转
      const marks = 28;
      g.lineStyle(5, 0xc8402f, a);
      for (let k = 0; k < marks; k++) {
        const ang = (k / marks) * Math.PI * 2 + p * 1.6;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        g.lineBetween(q.x + c * (r - 14), q.y - 8 + s * (r - 14) * 0.75, q.x + c * (r + 4), q.y - 8 + s * (r + 4) * 0.75);
      }
    }
  }
}
