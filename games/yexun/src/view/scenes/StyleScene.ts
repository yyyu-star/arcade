/**
 * 画风样图（第 1 步，DESIGN.md 第 11 节）：一段自动演示的战斗场景，给所有者看画风和打击感。
 * 这里的"模拟"是画面层里随手写的演示脚本，不是规则核心；第 2 步换成 src/core 的真模拟后删掉。
 */
import Phaser from 'phaser';
import type { Atlas, Frame } from '../art/atlas.ts';
import { MOB_COLOR } from '../art/sprites.ts';
import type { Hud } from '../ui/hud.ts';
import { LOW_MEMORY } from '../viewport.ts';

type Kind = 'paper' | 'wisp' | 'jiangshi' | 'lantern' | 'elite';

interface Mob {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  speed: number;
  r: number;
  hop: number;
  flash: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  alive: boolean;
}

interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  img: Phaser.GameObjects.Image;
  trailT: number;
}

interface Soul {
  x: number;
  y: number;
  img: Phaser.GameObjects.Image;
  pull: boolean;
}

const KIND: Record<Kind, { frame: string; hp: number; speed: number; r: number; color: number; glow: number | null }> = {
  paper: { frame: 'paper', hp: 14, speed: 62, r: 14, color: MOB_COLOR.paper, glow: null },
  wisp: { frame: 'wisp', hp: 10, speed: 104, r: 12, color: MOB_COLOR.wisp, glow: 0x5fd3f0 },
  jiangshi: { frame: 'jiangshi', hp: 40, speed: 52, r: 18, color: MOB_COLOR.jiangshi, glow: null },
  lantern: { frame: 'lantern', hp: 26, speed: 46, r: 16, color: MOB_COLOR.lantern, glow: 0xff8a3a },
  elite: { frame: 'jiangshi_big', hp: 6000, speed: 40, r: 30, color: 0x8a5cc8, glow: 0xa050ff },
};

export class StyleScene extends Phaser.Scene {
  private atlas!: Atlas;
  private hud!: Hud;
  private zoomBase = 1;
  private hero!: Phaser.GameObjects.Image;
  private heroShadow!: Phaser.GameObjects.Image;
  private hx = 0;
  private hy = 0;
  private face = 1;
  private t = 0;
  private mobs: Mob[] = [];
  private bolts: Bolt[] = [];
  private souls: Soul[] = [];
  private slashCd = 0.3;
  private boltCd = 0.2;
  private thunderCd = 1.6;
  private freeze = 0;
  private kills = 1268;
  private combo = 2016;
  private coins = 3412;
  private xp = 0.62;
  private spawnCd = 0;
  private flakes: Phaser.GameObjects.Image[] = [];
  private thunderGfx!: Phaser.GameObjects.Graphics;
  private dmgPool: Phaser.GameObjects.Container[] = [];
  private rnd = new Phaser.Math.RandomDataGenerator(['yexun-style']);
  private paused = false;

  constructor() {
    super('style');
  }

  init(data: { atlas: Atlas; hud: Hud; zoom: number }): void {
    this.atlas = data.atlas;
    this.hud = data.hud;
    this.zoomBase = data.zoom;
  }

  private frame(key: string): Frame {
    const f = this.atlas.frames.get(key);
    if (!f) throw new Error(`没有这一帧：${key}`);
    return f;
  }

  /** 放一张图集里的图：按这一帧的倍数缩回世界尺寸，锚点用这一帧的 */
  private img(key: string, x: number, y: number, scale = 1): Phaser.GameObjects.Image {
    const f = this.frame(key);
    return this.add.image(x, y, 'atlas', key).setOrigin(f.ox, f.oy).setScale(scale / f.res);
  }

  create(): void {
    const tex = this.textures.addCanvas('atlas', this.atlas.canvas)!;
    for (const f of this.atlas.frames.values()) tex.add(f.key, 0, f.x, f.y, f.w, f.h);
    const cam = this.cameras.main;
    cam.setZoom(this.zoomBase);
    cam.setBackgroundColor('#e4e8f0');

    // 雪地：一张可平铺的贴图铺满场地
    const ground = this.add.tileSprite(0, 0, 6400, 6400, 'ground').setOrigin(0.5).setDepth(-1000);
    const gres = (this.textures.get('ground').getSourceImage() as HTMLCanvasElement).width / 512;
    ground.setTileScale(1 / gres);

    this.scatterDecor();
    this.heroShadow = this.img('shadow', 0, 0, 1.1).setAlpha(0.9);
    this.hero = this.img('hero', 0, 0);
    this.thunderGfx = this.add.graphics().setDepth(5000);

    for (let i = 0; i < 36; i++) this.spawn(this.pickKind(), true);
    this.spawn('elite', true, 230, -60);

    // 飘雪：屏幕空间里慢慢落，省内存设备减半
    const n = LOW_MEMORY ? 30 : 70;
    for (let i = 0; i < n; i++) {
      const f = this.img('glow', 0, 0, 0.08 + this.rnd.frac() * 0.12).setDepth(9000).setAlpha(0.85);
      // 屏幕坐标（0–1）记在 data 里，每帧按镜头换算成世界坐标
      f.setData('v', 0.02 + this.rnd.frac() * 0.04).setData('s', this.rnd.frac() * 10).setData('sx', this.rnd.frac()).setData('sy', this.rnd.frac());
      this.flakes.push(f);
    }
    cam.centerOn(0, 0);
    this.hud.setCombo(this.combo);
  }

  /** 稀疏的点缀：枯树、石头、残碑、青石板、枯草（只装饰，不挡路） */
  private scatterDecor(): void {
    const r = new Phaser.Math.RandomDataGenerator(['decor']);
    const put = (key: string, n: number, spread: number, minD: number): void => {
      for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        do {
          x = (r.frac() - 0.5) * spread;
          y = (r.frac() - 0.5) * spread;
        } while (Math.hypot(x, y) < minD);
        const o = this.img(key, x, y, 0.85 + r.frac() * 0.3);
        if (r.frac() < 0.5) o.setFlipX(true);
        o.setDepth(key === 'slabs' || key === 'grass' ? -900 : y);
      }
    };
    put('slabs', 7, 2200, 160);
    put('grass', 40, 2200, 60);
    put('tree', 6, 2400, 260);
    put('rock', 9, 2200, 180);
    put('stele', 3, 2000, 240);
  }

  private pickKind(): Kind {
    const v = this.rnd.frac();
    return v < 0.42 ? 'paper' : v < 0.62 ? 'jiangshi' : v < 0.84 ? 'wisp' : 'lantern';
  }

  private spawn(kind: Kind, near = false, fx?: number, fy?: number): void {
    const k = KIND[kind];
    const a = this.rnd.frac() * Math.PI * 2;
    const d = near ? 110 + this.rnd.frac() * 300 : 420 + this.rnd.frac() * 120;
    const x = fx ?? this.hx + Math.cos(a) * d;
    const y = fy ?? this.hy + Math.sin(a) * d * 0.8;
    const shadow = this.img('shadow', x, y, k.r / 20).setAlpha(0.8);
    const glow = k.glow === null ? null : this.img('haze', x, y, kind === 'elite' ? 2.6 : 1.1).setTint(k.glow).setAlpha(kind === 'elite' ? 0.55 : 0.4);
    const img = this.img(k.frame, x, y);
    this.mobs.push({ kind, x, y, vx: 0, vy: 0, hp: k.hp, speed: k.speed * (0.85 + this.rnd.frac() * 0.3), r: k.r, hop: this.rnd.frac(), flash: 0, img, shadow, glow, alive: true });
  }

  override update(_time: number, deltaMs: number): void {
    if (this.paused) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    // 打击停顿：画面整个停一下（第 2 步起是"暂停送拍"，核心照样按拍走）
    if (this.freeze > 0) {
      this.freeze -= dt;
      this.tickFlakes(dt);
      return;
    }
    this.t += dt;
    this.moveHero(dt);
    this.moveMobs(dt);
    this.weapons(dt);
    this.moveBolts(dt);
    this.moveSouls(dt);
    this.tickFlakes(dt);
    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.mobs.length < 40) {
      this.spawn(this.pickKind());
      this.spawnCd = 0.12;
    }
    const cam = this.cameras.main;
    // 镜头跟人，朝移动方向稍微前瞻
    cam.centerOn(this.hx + this.face * 30, this.hy);
    this.hud.update({
      hp: 132 + Math.sin(this.t * 0.7) * 6,
      hpMax: 150,
      shield: 11,
      shieldMax: 15,
      level: 23,
      xp: this.xp,
      left: 8 * 60 + 42 - this.t,
      kills: this.kills,
      coins: this.coins,
      slots: [
        { icon: 'i_sword', level: 8, cd: Math.min(1, 1 - this.slashCd / 0.7) },
        { icon: 'i_talisman', level: 6, cd: Math.min(1, 1 - this.boltCd / 0.28) },
        { icon: 'i_thunder', level: 4, cd: Math.min(1, 1 - this.thunderCd / 2.4) },
        { icon: 'i_coins', level: 3, cd: 1 },
        { icon: 'i_bell', level: 2, cd: 1 },
      ],
    });
  }

  private moveHero(dt: number): void {
    // 演示：慢慢绕一个大圈走，偶尔折返
    const a = this.t * 0.32;
    const nx = Math.cos(a) * 140;
    const ny = Math.sin(a * 1.3) * 90;
    const vx = (nx - this.hx) / Math.max(dt, 1e-3);
    this.hx = nx;
    this.hy = ny;
    if (Math.abs(vx) > 4) this.face = vx > 0 ? 1 : -1;
    // 走路：上下颠、压扁拉伸、左右晃
    const step = this.t * 9;
    const bob = Math.abs(Math.sin(step));
    const f = this.frame('hero');
    this.hero.setPosition(this.hx, this.hy - bob * 3);
    this.hero.setScale((1 / f.res) * (1 + (1 - bob) * 0.05) * this.face, (1 / f.res) * (1 - (1 - bob) * 0.05 + bob * 0.03));
    this.hero.setRotation(Math.sin(step) * 0.05);
    this.hero.setDepth(this.hy);
    this.heroShadow.setPosition(this.hx, this.hy).setDepth(this.hy - 1000);
  }

  private moveMobs(dt: number): void {
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const dx = this.hx - m.x;
      const dy = this.hy - m.y;
      const d = Math.hypot(dx, dy) || 1;
      let sp = m.speed;
      let lift = 0;
      if (m.kind === 'jiangshi' || m.kind === 'elite') {
        // 跳尸一跳一跳：落地时停一下
        m.hop += dt * (m.kind === 'elite' ? 1.1 : 1.6);
        const ph = m.hop % 1;
        lift = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) * (m.kind === 'elite' ? 18 : 12) : 0;
        sp = ph < 0.6 ? sp * 1.6 : 0;
      } else if (m.kind === 'wisp' || m.kind === 'lantern') {
        lift = 8 + Math.sin(this.t * 3 + m.hop * 6) * 4;
      }
      // 停在主角身边一点的地方（演示里主角不掉血）
      const want = d > m.r + 26 ? sp : 0;
      m.vx += ((dx / d) * want - m.vx) * Math.min(1, dt * 6);
      m.vy += ((dy / d) * want - m.vy) * Math.min(1, dt * 6);
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // 怪与怪之间轻推挤
      for (const o of this.mobs) {
        if (o === m || !o.alive) continue;
        const ex = m.x - o.x;
        const ey = m.y - o.y;
        const rr = m.r + o.r;
        const e2 = ex * ex + ey * ey;
        if (e2 < rr * rr && e2 > 0.01) {
          const e = Math.sqrt(e2);
          const push = ((rr - e) / e) * 0.5;
          m.x += ex * push;
          m.y += ey * push;
        }
      }
      if (m.flash > 0) {
        m.flash -= dt;
        if (m.flash <= 0) m.img.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      }
      const f = this.frame(KIND[m.kind].frame);
      const flip = dx < 0 ? -1 : 1;
      const squash = m.kind === 'paper' ? 1 + Math.sin(this.t * 10 + m.hop * 9) * 0.04 : 1;
      m.img.setPosition(m.x, m.y - lift).setScale((flip / f.res) * (2 - squash), (1 / f.res) * squash);
      m.img.setRotation(m.kind === 'paper' ? Math.sin(this.t * 7 + m.hop * 5) * 0.08 : 0);
      m.img.setDepth(m.y);
      m.shadow.setPosition(m.x, m.y).setDepth(m.y - 1000).setScale((m.r / 20 / this.frame('shadow').res) * (1 - lift * 0.012));
      if (m.glow) {
        m.glow.setPosition(m.x, m.y - lift - (m.kind === 'elite' ? 52 : 18)).setDepth(m.y - 1);
        if (m.kind === 'elite') m.glow.setAlpha(0.45 + Math.sin(this.t * 4) * 0.12);
      }
    }
    this.mobs = this.mobs.filter((m) => m.alive);
  }

  private nearest(maxD = 9999): Mob | null {
    let best: Mob | null = null;
    let bd = maxD;
    for (const m of this.mobs) {
      const d = Math.hypot(m.x - this.hx, m.y - this.hy);
      if (m.alive && d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private weapons(dt: number): void {
    // 桃木剑：朝面向横扫一道弧
    this.slashCd -= dt;
    if (this.slashCd <= 0) {
      this.slashCd = 0.7;
      this.slash(this.face);
    }
    // 符咒：飞向最近的怪
    this.boltCd -= dt;
    if (this.boltCd <= 0) {
      this.boltCd = 0.28;
      const m = this.nearest();
      if (m) {
        const a = Math.atan2(m.y - this.hy, m.x - this.hx) + (this.rnd.frac() - 0.5) * 0.8;
        const img = this.img('talisman', this.hx, this.hy - 30, 1.15).setDepth(4000);
        this.bolts.push({ x: this.hx, y: this.hy - 30, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 1.6, img, trailT: 0 });
      }
    }
    // 雷符：随机劈一只，带溅射（演示停顿和震屏）
    this.thunderCd -= dt;
    if (this.thunderCd <= 0) {
      this.thunderCd = 2.4;
      const m = this.nearest(420);
      if (m) this.thunder(m);
    }
  }

  private slash(dir: number): void {
    const f = this.frame('slash');
    for (const side of [dir, -dir]) {
      const s = this.add.image(this.hx + side * 10, this.hy - 26, 'atlas', 'slash').setOrigin(f.ox, f.oy).setDepth(4500);
      s.setScale((side / f.res) * 1.15, (1 / f.res) * 1.15).setAlpha(side === dir ? 1 : 0.75);
      this.tweens.add({ targets: s, scaleX: (side / f.res) * 1.5, scaleY: (1 / f.res) * 1.45, alpha: 0, duration: 230, ease: 'Cubic.easeOut', onComplete: () => s.destroy() });
    }
    for (const m of this.mobs) {
      const dx = m.x - this.hx;
      const dy = m.y - this.hy;
      if (Math.hypot(dx, dy) < 130 + m.r && Math.abs(dy) < 90) this.hit(m, 18 + Math.floor(this.rnd.frac() * 10), this.rnd.frac() < 0.15, dx, dy);
    }
  }

  private moveBolts(dt: number): void {
    for (const b of this.bolts) {
      b.life -= dt;
      // 追踪：慢慢把速度转向最近的怪
      const m = this.nearest();
      if (m) {
        const dx = m.x - b.x;
        const dy = m.y - 20 - b.y;
        const d = Math.hypot(dx, dy) || 1;
        b.vx += ((dx / d) * 520 - b.vx) * Math.min(1, dt * 5);
        b.vy += ((dy / d) * 520 - b.vy) * Math.min(1, dt * 5);
        if (d < m.r + 10) {
          this.burst(b.x, b.y, 0xf5d54e, 0.9);
          this.hit(m, 12 + Math.floor(this.rnd.frac() * 6), this.rnd.frac() < 0.2, b.vx, b.vy);
          b.life = 0;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.img.setPosition(b.x, b.y).setRotation(b.img.rotation + dt * 14);
      // 金色拖尾
      b.trailT -= dt;
      if (b.trailT <= 0 && !LOW_MEMORY) {
        b.trailT = 0.025;
        const g = this.img('mote', b.x, b.y, 0.7).setTint(0xffc23a).setDepth(3990).setRotation(this.rnd.frac() * 3);
        this.tweens.add({ targets: g, alpha: 0, scale: g.scale * 0.2, duration: 300, onComplete: () => g.destroy() });
      }
      if (b.life <= 0) b.img.destroy();
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  private thunder(target: Mob): void {
    const g = this.thunderGfx;
    g.clear();
    const x0 = target.x + (this.rnd.frac() - 0.5) * 60;
    const y0 = target.y - 520;
    // 折线闪电：外面一层青蓝光、里面一条白芯
    const pts: [number, number][] = [[x0, y0]];
    for (let i = 1; i <= 9; i++) pts.push([x0 + (target.x - x0) * (i / 9) + (this.rnd.frac() - 0.5) * 34, y0 + (target.y - 20 - y0) * (i / 9)]);
    for (const [w, c, a] of [[16, 0x6fb8ff, 0.3], [9, 0x23306a, 1], [5.5, 0x55c8ff, 1], [2.2, 0xffffff, 1]] as const) {
      g.lineStyle(w, c, a);
      g.beginPath();
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts) g.lineTo(p[0], p[1]);
      g.strokePath();
    }
    g.setAlpha(1);
    this.tweens.add({ targets: g, alpha: 0, duration: 260 });
    this.burst(target.x, target.y - 10, 0x8fd0ff, 1.6);
    const ring = this.img('ring', target.x, target.y, 0.3).setTint(0x3a8fe0).setDepth(4600);
    this.tweens.add({ targets: ring, scale: ring.scale * 4, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    for (const m of this.mobs) if (Math.hypot(m.x - target.x, m.y - target.y) < 90) this.hit(m, 60 + Math.floor(this.rnd.frac() * 30), true, m.x - target.x, m.y - target.y);
    this.cameras.main.flash(70, 200, 230, 255, false);
    this.cameras.main.shake(140, 0.004);
    this.freeze = 0.06;
  }

  private hit(m: Mob, dmg: number, crit: boolean, kx: number, ky: number): void {
    if (!m.alive) return;
    const d = crit ? dmg * 2 : dmg;
    m.hp -= d;
    // 命中闪白 + 后退
    m.img.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    m.flash = 0.07;
    const kd = Math.hypot(kx, ky) || 1;
    const push = m.kind === 'elite' ? 3 : 14;
    m.x += (kx / kd) * push;
    m.y += (ky / kd) * push;
    this.damage(m.x, m.y - m.r * 2.4, d, crit);
    if (crit && m.kind !== 'elite') this.freeze = Math.max(this.freeze, 0.035);
    if (m.hp <= 0) this.kill(m);
  }

  private kill(m: Mob): void {
    m.alive = false;
    const k = KIND[m.kind];
    // 碎片按怪的主色飞散
    const n = LOW_MEMORY ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const s = this.img('shard', m.x, m.y - 20, 0.8 + this.rnd.frac() * 0.8).setTint(k.color).setDepth(m.y + 1);
      const a = this.rnd.frac() * Math.PI * 2;
      const v = 40 + this.rnd.frac() * 60;
      this.tweens.add({
        targets: s,
        x: m.x + Math.cos(a) * v,
        y: m.y - 20 + Math.sin(a) * v * 0.6 + 26,
        angle: (this.rnd.frac() - 0.5) * 720,
        alpha: 0,
        duration: 420 + this.rnd.frac() * 200,
        ease: 'Quad.easeOut',
        onComplete: () => s.destroy(),
      });
    }
    // 墨点溅在地上，慢慢淡掉
    const ink = this.img(`ink${Math.floor(this.rnd.frac() * 3)}`, m.x, m.y, 0.5 + this.rnd.frac() * 0.4).setDepth(-800).setAlpha(0.5).setRotation(this.rnd.frac() * 6);
    this.tweens.add({ targets: ink, alpha: 0, duration: 1600, delay: 400, onComplete: () => ink.destroy() });
    this.burst(m.x, m.y - 16, k.color, 0.8);
    // 魂火
    const soul = this.img('soul', m.x, m.y - 6).setDepth(m.y);
    this.souls.push({ x: m.x, y: m.y - 6, img: soul, pull: false });
    m.img.destroy();
    m.shadow.destroy();
    m.glow?.destroy();
    this.kills += 1;
    this.combo += 1;
    this.hud.setCombo(this.combo);
  }

  /** 一团光点 + 几颗火星（ADD 叠加） */
  private burst(x: number, y: number, tint: number, size: number): void {
    const g = this.img('haze', x, y, 0.9 * size).setTint(tint).setAlpha(0.8).setDepth(4700);
    this.tweens.add({ targets: g, scale: g.scale * 1.8, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    if (LOW_MEMORY) return;
    for (let i = 0; i < 5; i++) {
      const s = this.img('mote', x, y, 0.55 * size).setTint(tint).setDepth(4700);
      const a = this.rnd.frac() * Math.PI * 2;
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 34 * size, y: y + Math.sin(a) * 34 * size, alpha: 0, scale: 0, duration: 260, onComplete: () => s.destroy() });
    }
  }

  /** 伤害数字：弹起、落下、淡掉；暴击金色加大 */
  private damage(x: number, y: number, n: number, crit: boolean): void {
    const c = this.dmgPool.pop() ?? this.add.container(0, 0);
    c.removeAll(true);
    const s = String(n);
    const fd = this.frame('d0');
    const w = (fd.w / fd.res) * 0.62;
    [...s].forEach((ch, i) => {
      const im = this.add.image((i - (s.length - 1) / 2) * w, 0, 'atlas', `d${ch}`).setScale(1 / fd.res);
      if (crit) im.setTint(0xffd23a);
      c.add(im);
    });
    const base = crit ? 1.05 : 0.68;
    c.setPosition(x + (this.rnd.frac() - 0.5) * 16, y).setDepth(6000).setAlpha(1).setScale(base * 1.6).setVisible(true);
    this.tweens.add({ targets: c, scale: base, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: y - 34, duration: 520, ease: 'Cubic.easeOut' });
    this.tweens.add({
      targets: c,
      alpha: 0,
      delay: 380,
      duration: 220,
      onComplete: () => {
        c.setVisible(false);
        this.dmgPool.push(c);
      },
    });
  }

  private moveSouls(dt: number): void {
    for (const s of this.souls) {
      const dx = this.hx - s.x;
      const dy = this.hy - 20 - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 150) s.pull = true;
      if (s.pull) {
        const v = 520 * dt;
        s.x += (dx / (d || 1)) * Math.min(v, d);
        s.y += (dy / (d || 1)) * Math.min(v, d);
        if (d < 14) {
          s.img.destroy();
          s.pull = false;
          s.x = NaN;
          this.xp = (this.xp + 0.012) % 1;
          continue;
        }
      }
      s.img.setPosition(s.x, s.y + Math.sin(this.t * 5 + s.y) * 2).setDepth(s.y);
    }
    this.souls = this.souls.filter((s) => !Number.isNaN(s.x));
  }

  private tickFlakes(dt: number): void {
    const v = this.cameras.main.worldView;
    for (const f of this.flakes) {
      let sy = (f.getData('sy') as number) + (f.getData('v') as number) * dt * 2;
      let sx = (f.getData('sx') as number) + Math.sin(this.t * 0.8 + (f.getData('s') as number)) * 0.01 * dt;
      if (sy > 1.02) {
        sy = -0.02;
        sx = this.rnd.frac();
      }
      f.setData('sx', sx).setData('sy', sy);
      f.setPosition(v.x + sx * v.width, v.y + sy * v.height);
    }
  }

  /** 截图用：暂停在当前一帧 */
  setPaused(p: boolean): void {
    this.paused = p;
  }
}
