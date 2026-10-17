/**
 * 夜探镇子的画面：街巷石板、院子铺地、河和桥、码头台阶这些大面积的地面预渲染成分块贴图（每块 1200 世界单位，只留镜头附近的几块）；
 * 灯笼杆、井、牌坊、船、亭、山门、香炉、古松等陈设按地图种子确定性地摆（不用 Math.random，也不挡路：只摆在规则层的"空地"上）；
 * 夜色是一张低分辨率的暗幕（每帧在小画布上挖出主角、灯笼、亮窗、开着的门的光圈），整个场景压暗一档、暖光透出来。
 *
 * 只读 raid.map（院子、街、挡路矩形、宝箱、门）和 raid 的状态，不改规则；整个文件只在夜探里用。
 */
import Phaser from 'phaser';
import { RAID_WALL } from '../../content/explore.ts';
import type { Raid } from '../../explore/raid.ts';
import type { RaidBlock } from '../../explore/blocks.ts';
import type { Yard } from '../../explore/mapgen.ts';
import { artRng } from '../art/draw.ts';
import { HOUSE_Z, WALL_H_PERIOD, WALL_OV, WALL_RIDGE, WALL_V_PERIOD, WALL_Z, gatehouse, houseH, houseHLights, houseV, houseVLights, wallHBody, wallHEnd, wallKnot, wallVBody, wallVNorth, wallVSouth, type Piece, type Style } from '../art/sprites10.ts';

/** 分块（只放软的东西：积雪、影子、院里的石纹和碎砖）：世界单位边长、贴图每单位几个像素。硬边的石板、方砖、水纹走平铺贴图，手机放大也清楚 */
const CHUNK = 1200;
const PX = 0.5;
const PX_LOW = 0.35;

interface Light {
  x: number;
  y: number;
  r: number;
  /** 挖暗幕的强度 0–1 */
  a: number;
  /** 暖色罩的强度（0 不罩） */
  warm: number;
}

/** 码头：从哪一岸（dir 1 = 北岸往南伸，−1 = 南岸往北伸）的 x 位置伸进水里 */
interface Dock {
  x: number;
  y: number;
  dir: 1 | -1;
}

const hash = (a: number, b: number, s: number): number => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ s;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

export interface TownDeps {
  img: (key: string, x: number, y: number, scale?: number) => Phaser.GameObjects.Image;
  /** 图集帧的清晰度（显示时按 1 / res 缩放） */
  res: (key: string) => number;
  lowMem: boolean;
}

export class Town {
  private readonly scene: Phaser.Scene;
  private readonly raid: Raid;
  private readonly d: TownDeps;
  private readonly seed: number;
  private readonly size: number;
  private readonly px: number;
  private readonly chunks = new Map<number, { img: Phaser.GameObjects.Image; key: string }>();
  private readonly bands: { x: number; y: number; w: number; h: number }[] = [];
  private readonly rivers: RaidBlock[];
  private readonly docks: Dock[] = [];
  private readonly statics: Phaser.GameObjects.GameObject[] = [];
  /** 平铺的各块：只在镜头里的才提交绘制（街、院子、河一共几十块，每块都是大四边形） */
  private readonly flats: { o: Phaser.GameObjects.TileSprite; x: number; y: number; w: number; h: number }[] = [];
  /** 平铺贴图的清晰度：跟画面的放大倍数走（手机 2 倍屏 × 放大），封顶 2 */
  private readonly tileRes: number;
  private readonly steps: { x0: number; x1: number; y: number }[] = [];
  /** 不随时间变的光：灯笼、亮窗、金铜箱 */
  private readonly lights: Light[] = [];
  /** 撤离箭头的位置（x, y, 亮度 三个一组，GameScene 每帧填）：暗幕上给它们挖小亮圈，不然门牌色的箭头被压成灰的 */
  readonly trail: number[] = [];
  private readonly dark: Phaser.Textures.CanvasTexture;
  private readonly darkImg: Phaser.GameObjects.Image;
  private readonly dctx: CanvasRenderingContext2D;
  private readonly view = new Phaser.Geom.Rectangle();
  /** 建筑的图：清晰度、画过的贴图名（局终删）、要按镜头裁掉的、主角绕到后面时要变淡的正房 */
  private readonly bres: number;
  private readonly made: string[] = [];
  private readonly culls: { o: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite; x: number; y: number; w: number; h: number }[] = [];
  private readonly houses: { o: Phaser.GameObjects.Image; x0: number; x1: number; y0: number; y1: number }[] = [];
  private readonly dw = 256;
  private readonly dh = 128;

  constructor(scene: Phaser.Scene, raid: Raid, d: TownDeps) {
    this.scene = scene;
    this.raid = raid;
    this.d = d;
    this.seed = raid.setup.seed >>> 0;
    this.size = raid.map.size;
    this.px = d.lowMem ? PX_LOW : PX;
    this.rivers = raid.map.blocks.filter((b) => b.look === 'river').sort((a, b) => a.x - b.x);
    const { streets: S, cell, streetPad: pad } = raid.tpl;
    for (const s of S) {
      this.bands.push({ x: 0, y: s * cell + pad, w: this.size, h: cell - 2 * pad });
      this.bands.push({ x: s * cell + pad, y: 0, w: cell - 2 * pad, h: this.size });
    }
    this.tileRes = Math.max(1, Math.min(2, scene.cameras.main.zoom));
    this.bres = d.lowMem ? Math.min(this.tileRes, 1.25) : this.tileRes;
    this.findSteps();
    this.dress();
    this.buildFlats();
    this.buildShapes();
    // 暗幕
    if (scene.textures.exists('town-dark')) scene.textures.remove('town-dark');
    this.dark = scene.textures.createCanvas('town-dark', this.dw, this.dh)!;
    this.dctx = this.dark.getContext();
    this.darkImg = scene.add.image(0, 0, 'town-dark').setDepth(7000).setDisplaySize(10, 10);
  }

  // ───────────────────────── 建筑 ─────────────────────────

  /** 建筑贴图：按需画一次（同一局里同样式、同尺寸的共用），局终删掉。横竖两个方向的缩放各自取整到整像素，平铺的周期不漂 */
  private tex(key: string, pc: Piece): { key: string; sx: number; sy: number } {
    const res = this.bres;
    const pw = Math.max(1, Math.round(pc.w * res));
    const ph = Math.max(1, Math.round(pc.h * res));
    const sx = pw / pc.w;
    const sy = ph / pc.h;
    if (!this.scene.textures.exists(key)) {
      const t = this.scene.textures.createCanvas(key, pw, ph)!;
      const c = t.getContext();
      c.setTransform(sx, 0, 0, sy, pc.ax * sx, pc.ay * sy);
      pc.draw(c);
      t.refresh();
      this.made.push(key);
    }
    return { key, sx, sy };
  }

  /** 摆一张建筑图：参考点放在 (rx, ry)；flip 时以参考点为轴水平翻转 */
  private place(key: string, pc: Piece, rx: number, ry: number, depth: number, flip = false): Phaser.GameObjects.Image {
    const t = this.tex(key, pc);
    const x = flip ? rx - (pc.w - pc.ax) : rx - pc.ax;
    const im = this.scene.add.image(x, ry - pc.ay, t.key).setOrigin(0, 0).setScale(1 / t.sx, 1 / t.sy).setDepth(depth).setFlipX(flip);
    this.cull(im, x, ry - pc.ay, pc.w, pc.h);
    return im;
  }

  private cull(o: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite, x: number, y: number, w: number, h: number): void {
    this.culls.push({ o, x, y, w, h });
  }

  /** 样式：山寺全是红墙黄瓦；其余地方庙和石兽院是红墙黄瓦，渡口是木板墙（屋子茅草顶），古镇、教学镇白墙青瓦 */
  private styleOf(b: { x: number; y: number; w: number; h: number }): Style {
    const tpl = this.raid.setup.template;
    if (tpl === 'shansi') return 'temple';
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const yard = this.raid.map.yards.find((y) => cx >= y.x - 2 && cx <= y.x + y.w + 2 && cy >= y.y - 2 && cy <= y.y + y.h + 2);
    if (yard && (yard.kind === 'temple' || yard.kind === 'vault')) return 'temple';
    return tpl === 'dukou' ? 'hut' : 'town';
  }

  /**
   * 把规则层挡路的矩形画成俯视 3/4 的中式建筑（画法见 sprites10.ts）：
   * 横墙 = 平铺的墙头 + 墙面，两头端头；竖墙 = 平铺的墙头，断口处收头、露墙面，和横墙交在墙角压一个脊头；
   * 横门洞上一座门楼；正房一座一张图。深度：横的按脚底；竖墙、竖屋按北头（人走在旁边时压在上面，绕到北边才被挡住）。
   */
  drawBlocks(): void {
    const T = RAID_WALL.thick;
    const blocks = this.raid.map.blocks;
    const hs = blocks.filter((b) => b.look === 'wall_h');
    for (const b of blocks) {
      const foot = b.y + b.h;
      if (b.look === 'wall_h') {
        const st = this.styleOf(b);
        const pc = wallHBody(st, b.h);
        const t = this.tex(`bq-h-${st}-${b.h}`, pc);
        const ts = this.scene.add.tileSprite(b.x, b.y - pc.ay, b.w, pc.h, t.key).setOrigin(0, 0).setDepth(foot);
        ts.setTileScale(1 / t.sx, 1 / t.sy);
        ts.setTilePosition(((((b.x * 0.37) | 0) % WALL_H_PERIOD) + WALL_H_PERIOD) % WALL_H_PERIOD * t.sx, 0);
        this.cull(ts, b.x, b.y - pc.ay, b.w, pc.h);
        const ec = wallHEnd(st, b.h);
        this.place(`bq-e-${st}-${b.h}`, ec, b.x, b.y, foot + 0.01);
        this.place(`bq-e-${st}-${b.h}`, ec, b.x + b.w, b.y, foot + 0.01, true);
      } else if (b.look === 'wall_v') {
        const st = this.styleOf(b);
        const cover = (yy: number): boolean => hs.some((h) => Math.abs(h.y - yy) < 0.5 && h.x <= b.x + 0.5 && h.x + h.w >= b.x + b.w - 0.5);
        const nj = hs.some((h) => Math.abs(h.y + h.h - b.y) < 0.5 && h.x <= b.x + 0.5 && h.x + h.w >= b.x + b.w - 0.5);
        const sj = cover(b.y + b.h);
        const top = nj ? b.y - T / 2 - WALL_RIDGE : b.y - WALL_OV - WALL_Z + 1;
        const bot = sj ? b.y + b.h + T / 2 - WALL_RIDGE + 2 : b.y + b.h + WALL_OV - WALL_RIDGE + 1;
        const depth = b.y + 1;
        const pc = wallVBody(st, b.w);
        const t = this.tex(`bq-v-${st}-${b.w}`, pc);
        const ts = this.scene.add.tileSprite(b.x - pc.ax, top, pc.w, bot - top, t.key).setOrigin(0, 0).setDepth(depth);
        ts.setTileScale(1 / t.sx, 1 / t.sy);
        ts.setTilePosition(0, ((((top * 0.61) | 0) % WALL_V_PERIOD) + WALL_V_PERIOD) % WALL_V_PERIOD * t.sy);
        this.cull(ts, b.x - pc.ax, top, pc.w, bot - top);
        if (!nj) this.place(`bq-vn-${st}-${b.w}`, wallVNorth(st, b.w), b.x, b.y, depth + 0.01);
        if (!sj) this.place(`bq-vs-${st}-${b.w}`, wallVSouth(st, b.w), b.x, b.y + b.h, depth + 0.01);
      } else if (b.look === 'house' || b.look === 'hall') this.drawHouse(b);
      else if (b.look === 'stall') this.d.img('stall', b.x + b.w / 2, foot + 4).setDepth(foot);
      else if (b.look === 'terrace') {
        const n = Math.max(1, Math.round(b.w / 80));
        const step = b.w / n;
        const r = this.d.res('terrace_h');
        for (let k = 0; k < n; k++) this.d.img('terrace_h', b.x + step * (k + 0.5), foot).setScale(step / 80 / r, 1 / r).setDepth(foot);
      }
    }
    for (const y of this.raid.map.yards) {
      if (y.kind === 'plaza') continue;
      const st = this.styleOf({ x: y.x + 2, y: y.y + 2, w: 1, h: 1 });
      // 墙角：两道墙头的脊交在一起，压一个脊头
      const knot = wallKnot(st);
      for (const [x, yy, dep] of [[y.x, y.y, y.y + T + 2], [y.x + y.w - T, y.y, y.y + T + 2], [y.x, y.y + y.h - T, y.y + y.h + 0.5], [y.x + y.w - T, y.y + y.h - T, y.y + y.h + 0.5]] as const) {
        this.place(`bq-k-${st}`, knot, x + T / 2, yy + T / 2 - WALL_RIDGE - 4, dep);
      }
      // 横墙上的门洞：搭一座门楼（破院不搭）
      if (y.kind === 'ruin') continue;
      for (const line of [y.y, y.y + y.h - T]) {
        const segs = hs.filter((h) => h.y === line && h.x >= y.x - 1 && h.x < y.x + y.w).sort((a, b) => a.x - b.x);
        for (let i = 0; i + 1 < segs.length; i++) {
          const g0 = segs[i]!.x + segs[i]!.w;
          const g = segs[i + 1]!.x - g0;
          if (g < 60 || g > 300) continue;
          this.place(`bq-g-${st}-${Math.round(g)}`, gatehouse(st, g, T, 3), g0, line, line + T + 0.02);
          for (const lx of [g0 + 6, g0 + g - 6]) this.light(lx, line + T - 60, 170, 0.85, 0.3);
        }
      }
    }
  }

  /** 正房：横的一座一张图（靠北墙的正面朝南、有门；靠南墙的朝南是背面），竖的一张图（院子那边屋檐下挂灯笼） */
  private drawHouse(b: RaidBlock): void {
    const st = this.styleOf(b);
    const foot = b.y + b.h;
    const yard = this.raid.map.yards.find((y) => b.x >= y.x && b.x + b.w <= y.x + y.w && b.y >= y.y && b.y + b.h <= y.y + y.h);
    const T = RAID_WALL.thick;
    const seed = (b.x * 13 + b.y * 7) | 0;
    if (b.w >= b.h) {
      const front = !yard || b.y <= yard.y + T + 1;
      const pc = houseH(st, b.w, b.h, front, seed);
      const im = this.place(`bh-${st}-${front ? 'f' : 'b'}-${Math.round(b.w)}-${Math.round(b.h)}-${seed & 3}`, pc, b.x, b.y, foot);
      this.houses.push({ o: im, x0: b.x - 20, x1: b.x + b.w + 20, y0: b.y - pc.ay + 50, y1: foot });
      for (const l of houseHLights(b.w, front)) {
        if (front) this.light(b.x + l.x, foot - 30, l.door ? 200 : 150, l.door ? 0.9 : 0.8, l.door ? 0.32 : 0.22);
        else this.light(b.x + l.x, b.y + b.h - HOUSE_Z + 10, 110, 0.55, 0.15);
      }
      if (front) this.light(b.x + b.w / 2, foot + 40, 220, 0.7, 0.25);
      else this.light(b.x + b.w / 2, b.y - 30, 230, 0.75, 0.28);
    } else {
      const side: 1 | -1 = yard && b.x <= yard.x + T + 1 ? 1 : -1;
      const pc = houseV(st, b.w, b.h, side, seed);
      const im = this.place(`bv-${st}-${side}-${Math.round(b.w)}-${Math.round(b.h)}-${seed & 3}`, pc, b.x, b.y, b.y + 1);
      this.houses.push({ o: im, x0: b.x - 20, x1: b.x + b.w + 20, y0: b.y - pc.ay + 50, y1: b.y + 1 });
      for (const l of houseVLights(b.w, b.h, side)) this.light(b.x + l.x, b.y + l.y, 150, 0.85, 0.3);
      this.light(b.x + (side > 0 ? b.w + 60 : -60), b.y + b.h / 2, 240, 0.7, 0.25);
    }
  }

  // ───────────────────────── 陈设 ─────────────────────────

  /** 摆得下：离墙、房子、河有余地，离宝箱、守卫、门、出生点有距离 */
  private spot(x: number, y: number, r: number): boolean {
    const m = this.raid.map;
    if (x < 60 || y < 60 || x > this.size - 60 || y > this.size - 60) return false;
    if (!m.index.free(x, y, r)) return false;
    for (const c of m.chests) if (Math.abs(c.x - x) < 80 && Math.abs(c.y - y) < 80) return false;
    for (const g of m.guards) if (Math.abs(g.x - x) < 70 && Math.abs(g.y - y) < 70) return false;
    for (const g of m.gates) if (Math.abs(g.x - x) < 170 && Math.abs(g.y - y) < 170) return false;
    return !(Math.abs(m.spawn.x - x) < 170 && Math.abs(m.spawn.y - y) < 170);
  }

  private prop(key: string, x: number, y: number, r: number, scale = 1): Phaser.GameObjects.Image | null {
    if (!this.spot(x, y, r)) return null;
    return this.d.img(key, x, y, scale).setDepth(y);
  }

  /** 点在街上（街面是石板，不撒雪堆、枯草、小石头） */
  onStreet(x: number, y: number): boolean {
    for (const b of this.bands) if (x > b.x - 10 && x < b.x + b.w + 10 && y > b.y - 10 && y < b.y + b.h + 10) return true;
    return false;
  }

  private light(x: number, y: number, r: number, a: number, warm: number): void {
    this.lights.push({ x, y, r, a, warm });
  }

  /** 每道墙缺口（院门）的中心：沿四面墙找相邻两段之间的空当 */
  private doorsOf(yard: Yard): { x: number; y: number; side: number }[] {
    const T = RAID_WALL.thick;
    const out: { x: number; y: number; side: number }[] = [];
    const blocks = this.raid.map.blocks;
    for (let side = 0; side < 4; side++) {
      const horiz = side === 0 || side === 2;
      const line = side === 0 ? yard.y : side === 2 ? yard.y + yard.h - T : side === 3 ? yard.x : yard.x + yard.w - T;
      const segs = blocks
        .filter((b) => (horiz ? b.look === 'wall_h' && b.y === line && b.x >= yard.x - 1 && b.x < yard.x + yard.w : b.look === 'wall_v' && b.x === line && b.y >= yard.y - 1 && b.y < yard.y + yard.h))
        .sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
      for (let i = 0; i + 1 < segs.length; i++) {
        const a = segs[i]!;
        const b = segs[i + 1]!;
        const g0 = horiz ? a.x + a.w : a.y + a.h;
        const g1 = horiz ? b.x : b.y;
        if (g1 - g0 < 60) continue;
        const c = (g0 + g1) / 2;
        out.push(horiz ? { x: c, y: line + (side === 0 ? 0 : T), side } : { x: line + (side === 3 ? 0 : T), y: c, side });
      }
    }
    return out;
  }

  /** 山寺的台阶墙缺口：同一道墙（同 y）上相邻两段之间，加上两头 */
  private findSteps(): void {
    const ter = this.raid.map.blocks.filter((b) => b.look === 'terrace');
    const rows = new Map<number, RaidBlock[]>();
    for (const b of ter) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
    for (const [y, list] of rows) {
      list.sort((a, b) => a.x - b.x);
      const T = list[0]!.h;
      let x = 0;
      for (const b of list) {
        if (b.x - x > 40) this.steps.push({ x0: x, x1: b.x, y: y + T });
        x = b.x + b.w;
      }
      if (this.size - x > 40) this.steps.push({ x0: x, x1: this.size, y: y + T });
    }
  }

  private dress(): void {
    const raid = this.raid;
    const m = raid.map;
    const tpl = raid.setup.template;
    const rnd = artRng(this.seed ^ 0x7077);
    const { streets: S, cell } = raid.tpl;

    // 金铜箱的光（房子的窗、门、灯笼在 drawHouse 里）
    for (const c of m.chests) if (c.tier !== 'wood') this.light(c.x, c.y - 6, c.tier === 'gold' ? 190 : 120, 0.55, 0.14);

    if (tpl === 'dukou') this.dressRiver(rnd);
    const town = tpl !== 'shansi';

    // 街上的灯笼杆：每段街（两个路口之间）一盏，两侧轮流，木杆贴着院墙外
    if (town) {
      let side = 0;
      for (const s of S) {
        const c0 = (s + 0.5) * cell;
        for (let t = 0; t + 1 < S.length; t++) {
          const mid = ((S[t]! + 0.5 + S[t + 1]! + 0.5) / 2) * cell + (rnd() - 0.5) * 120;
          const off = (side++ & 1 ? 1 : -1) * 92;
          for (const [x, y] of [[c0 + off, mid], [mid, c0 + off]] as const) {
            if (this.prop('lamp_pole', x, y, 22)) this.light(x + 15, y - 64, 250, 0.9, 0.3);
          }
        }
      }
    }

    // 院子里的陈设
    for (const y of m.yards) {
      const cx = y.x + y.w / 2;
      const cy = y.y + y.h / 2;
      const T = RAID_WALL.thick;
      if (y.kind === 'plaza') {
        if (this.prop('well', cx, cy + 20, 40)) this.light(cx, cy - 20, 120, 0.3, 0);
        this.prop('vat', cx - 180, cy + 90, 20);
        this.prop('vat', cx + 190, cy - 90, 20);
      } else if (y.kind === 'yard') {
        // 贴着北墙内侧的小棚（只是装饰，不挡路）：避开院门、宝箱、守卫
        const doors = this.doorsOf(y).filter((dd) => dd.side === 0);
        const sx = rnd() < 0.5 ? y.x + T + 70 : y.x + y.w - T - 70;
        const sy = y.y + T + 66;
        if (doors.every((dd) => Math.abs(dd.x - sx) > 150)) {
          const sk = `shed_${raid.setup.template === 'shansi' ? 'temple' : raid.setup.template === 'dukou' ? 'hut' : 'town'}`;
          this.prop(sk, sx, sy, 48);
        }
        for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
          if (rnd() < 0.5) this.prop('vat', dx < 0 ? y.x + T + 36 : y.x + y.w - T - 36, dy < 0 ? y.y + T + 60 : y.y + y.h - T - 36, 20);
        }
      } else if (y.kind === 'temple' || y.kind === 'vault') {
        this.prop('burner', cx - 120, cy + 70, 32);
        this.prop('burner', cx + 120, cy - 60, 32);
        for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) this.prop('jingchuang', cx + dx * (y.w / 2 - T - 50), cy + dy * (y.h / 2 - T - 50), 24);
      }
      // 院门两侧：古镇、渡口在门外挂一盏灯（山寺用石灯）
      if (town && y.kind !== 'ruin') {
        const ds = this.doorsOf(y);
        const d0 = ds[0];
        if (d0) {
          const ox = d0.side === 1 ? 26 : d0.side === 3 ? -26 : 80;
          const oy = d0.side === 0 ? -30 : d0.side === 2 ? 34 : 80;
          if (this.prop('lamp_pole', d0.x + ox, d0.y + oy, 22)) this.light(d0.x + ox + 15, d0.y + oy - 64, 250, 0.9, 0.3);
        }
      }
    }

    // 牌坊：跨竖街的拱，古镇两座（离中心近的两条竖街上），渡口一座；不压宝箱、不压墙
    if (tpl === 'guzhen' || tpl === 'dukou') {
      const want = tpl === 'guzhen' ? [S[2]!, S[3]!] : [S[1]!];
      for (const s of want) {
        const x = (s + 0.5) * cell;
        for (let k = 0; k < 8; k++) {
          const y = ((s - 1 + (k % 2 ? 1.5 : 0.5) + (k >> 1) * 0.3) * cell) | 0;
          if (this.spot(x - 98, y, 18) && this.spot(x + 98, y, 18) && this.spot(x, y, 40)) {
            this.d.img('paifang', x, y).setDepth(y);
            this.light(x - 98, y - 40, 150, 0.5, 0.2);
            this.light(x + 98, y - 40, 150, 0.5, 0.2);
            break;
          }
        }
      }
    }
    if (tpl === 'teach') {
      const x = (S[1]! + 0.5) * cell;
      for (const y of [S[0]! * cell + 700, S[2]! * cell - 600]) {
        if (this.spot(x - 98, y, 18) && this.spot(x + 98, y, 18) && this.spot(x, y, 40)) {
          this.d.img('paifang', x, y).setDepth(y);
          break;
        }
      }
    }

    // 山寺：每个台阶缺口立一座山门；古松成片
    if (tpl === 'shansi') {
      for (const st of this.steps) {
        const w = st.x1 - st.x0;
        if (w > 200) continue;
        const cx = (st.x0 + st.x1) / 2;
        this.d.img('shanmen', cx, st.y + 4).setDepth(st.y + 4);
        this.light(cx, st.y - 40, 220, 0.8, 0.3);
      }
      for (let i = 0; i < 70; i++) {
        const x = 100 + rnd() * (this.size - 200);
        const y = 100 + rnd() * (this.size - 200);
        const t = this.prop('pine', x, y, 36, 0.85 + rnd() * 0.3);
        if (t && rnd() < 0.5) t.setFlipX(true);
      }
    }
  }

  /** 渡口：岸上的亭、伸进河里的栈桥、系着的船、岸边的芦苇 */
  private dressRiver(rnd: () => number): void {
    this.rivers.forEach((b, i) => {
      // 芦苇：两岸各一撮撮
      for (const bank of [b.y + 4, b.y + b.h - 4]) {
        for (let x = b.x + 80; x < b.x + b.w - 120; x += 150 + rnd() * 220) {
          const y = bank + (bank > b.y + 10 ? 12 : 24);
          for (let k = 0; k < 2; k++) this.d.img('reeds', x + k * 22, y + k * 3, 0.9 + rnd() * 0.3).setDepth(y + k * 3);
        }
      }
      if (b.w < 700) return;
      const north = i % 2 === 0;
      const x = b.x + b.w * (0.35 + rnd() * 0.3);
      const bank = north ? b.y : b.y + b.h;
      this.docks.push({ x, y: bank, dir: north ? 1 : -1 });
      // 亭立在岸上，脚在栈桥根旁；船泊在栈桥一侧的水里
      const py = north ? bank - 6 : bank + 150;
      this.d.img('pavilion', x - 150, py).setDepth(py);
      this.light(x - 150, py - 46, 230, 0.9, 0.3);
      const by = bank + (north ? 1 : -1) * 90;
      this.d.img('boat', x + 118, by).setDepth(by);
      this.light(x + 118 + 70, by - 40, 160, 0.7, 0.3);
    });
  }

  // ───────────────────────── 地面分块 ─────────────────────────

  private chunkKey(cx: number, cy: number): number {
    return cy * 64 + cx;
  }

  private makeChunk(cx: number, cy: number): void {
    const px = this.px;
    // 四边各多画 4 个单位：相邻两块的接缝处线性插值不露底
    const M = 4;
    const n = Math.ceil((CHUNK + 2 * M) * px);
    const key = `town-${cx}-${cy}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, n, n)!;
    const c = tex.getContext();
    c.clearRect(0, 0, n, n);
    const wx = cx * CHUNK - M;
    const wy = cy * CHUNK - M;
    c.setTransform(px, 0, 0, px, -wx * px, -wy * px);
    this.paint(c, wx, wy, CHUNK + 2 * M);
    tex.refresh();
    const img = this.scene.add.image(wx, wy, key).setOrigin(0, 0).setDisplaySize(CHUNK + 2 * M, CHUNK + 2 * M).setDepth(-990);
    this.chunks.set(this.chunkKey(cx, cy), { img, key });
  }

  private dropChunk(k: number): void {
    const ch = this.chunks.get(k);
    if (!ch) return;
    ch.img.destroy();
    this.scene.textures.remove(ch.key);
    this.chunks.delete(k);
  }

  /** 开局把出生点周围的几块一次画好 */
  prepare(x: number, y: number): void {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) if (this.inMap(i, j) && !this.chunks.has(this.chunkKey(i, j))) this.makeChunk(i, j);
  }

  private inMap(i: number, j: number): boolean {
    const n = Math.ceil(this.size / CHUNK);
    return i >= 0 && j >= 0 && i < n && j < n;
  }

  /** 每帧：补镜头附近缺的分块（一帧最多画一块，免得一帧卡住），丢掉远处的 */
  private streamChunks(v: Phaser.Geom.Rectangle): void {
    const pad = 500;
    const i0 = Math.floor((v.x - pad) / CHUNK);
    const i1 = Math.floor((v.right + pad) / CHUNK);
    const j0 = Math.floor((v.y - pad) / CHUNK);
    const j1 = Math.floor((v.bottom + pad) / CHUNK);
    let made = false;
    for (let j = j0; j <= j1 && !made; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.inMap(i, j) || this.chunks.has(this.chunkKey(i, j))) continue;
        this.makeChunk(i, j);
        made = true;
        break;
      }
    }
    for (const k of [...this.chunks.keys()]) {
      const i = k % 64;
      const j = Math.floor(k / 64);
      if (i < i0 - 1 || i > i1 + 1 || j < j0 - 1 || j > j1 + 1) this.dropChunk(k);
    }
  }

  /** 画一块：街石板、院子地面、河、桥、码头、台阶 */
  private paint(c: CanvasRenderingContext2D, ox: number, oy: number, size: number): void {
    const hit = (x: number, y: number, w: number, h: number): boolean => x < ox + size && x + w > ox && y < oy + size && y + h > oy;
    const seed = this.seed;
    // 街边的积雪（软）：街两侧一溜、路中偶尔一片；石板本身是平铺贴图
    for (const b of this.bands) {
      if (!hit(b.x, b.y, b.w, b.h)) continue;
      c.save();
      c.beginPath();
      c.rect(b.x, b.y, b.w, b.h);
      c.clip();
      const horiz = b.w > b.h;
      const len = horiz ? b.w : b.h;
      for (let t = Math.max(0, (horiz ? ox : oy) - 100); t < Math.min(len, (horiz ? ox : oy) + size + 100); t += 40) {
        for (const e of [0, 1]) {
          const h = hash(t | 0, e + (horiz ? 7 : 19), seed);
          const th = 5 + h * 9;
          const along = t + h * 30;
          const edge = e ? (horiz ? b.y + b.h : b.x + b.w) - th * 0.4 : (horiz ? b.y : b.x) + th * 0.4;
          c.fillStyle = 'rgba(240,244,252,0.92)';
          c.beginPath();
          if (horiz) c.ellipse(along, edge, 22 + h * 22, th, 0, 0, Math.PI * 2);
          else c.ellipse(edge, along, th, 22 + h * 22, 0, 0, Math.PI * 2);
          c.fill();
        }
        const h2 = hash(t | 0, 99, seed);
        if (h2 < 0.18) {
          c.fillStyle = 'rgba(236,241,250,0.6)';
          c.beginPath();
          const off = 40 + hash(t | 0, 5, seed) * ((horiz ? b.h : b.w) - 80);
          if (horiz) c.ellipse(t, b.y + off, 22, 7, 0, 0, Math.PI * 2);
          else c.ellipse(b.x + off, t, 7, 22, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }

    // 院子地面
    for (const y of this.raid.map.yards) if (hit(y.x, y.y, y.w, y.h)) this.paintYard(c, y);

    // 建筑投在地上的影（月光从西北来）：墙根、屋檐往南一道，竖墙、竖屋往东一道；有了这道影，竖墙才看得出是立着的
    for (const b of this.raid.map.blocks) {
      if (b.look !== 'wall_h' && b.look !== 'wall_v' && b.look !== 'house' && b.look !== 'hall') continue;
      if (!hit(b.x - 10, b.y - 10, b.w + 70, b.h + 70)) continue;
      const big = b.look === 'house' || b.look === 'hall';
      const foot = b.y + b.h;
      const sd = big ? 30 : 18;
      const gs = c.createLinearGradient(0, foot, 0, foot + sd);
      gs.addColorStop(0, `rgba(16,22,52,${big ? 0.5 : 0.42})`);
      gs.addColorStop(1, 'rgba(16,22,52,0)');
      c.fillStyle = gs;
      c.fillRect(b.x + 6, foot, b.w + (big ? 18 : 8), sd);
      if (b.look === 'wall_h') continue;
      const x0 = b.x + b.w + (big ? 8 : 4);
      const ed = big ? 36 : 24;
      const ge = c.createLinearGradient(x0, 0, x0 + ed, 0);
      ge.addColorStop(0, `rgba(16,22,52,${big ? 0.48 : 0.46})`);
      ge.addColorStop(1, 'rgba(16,22,52,0)');
      c.fillStyle = ge;
      c.fillRect(x0, b.y + 10, ed, b.h + (big ? 10 : 0));
    }

  }

  private paintYard(c: CanvasRenderingContext2D, y: Yard): void {
    const seed = this.seed;
    const { x, y: yy, w, h } = y;
    c.save();
    c.beginPath();
    c.rect(x, yy, w, h);
    c.clip();
    const cx = x + w / 2;
    const cy = yy + h / 2;
    if (y.kind === 'plaza') {
      // 广场正中的圆形石纹
      for (const [r, a] of [[170, 0.5], [128, 0.4], [86, 0.45]] as const) {
        c.strokeStyle = `rgba(80,64,44,${a})`;
        c.lineWidth = 5;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = 'rgba(200,186,150,0.6)';
      c.beginPath();
      c.arc(cx, cy, 82, 0, Math.PI * 2);
      c.fill();
    } else if (y.kind === 'temple') {
      // 庙里：中轴一条红毡
      c.fillStyle = 'rgba(176,52,40,0.85)';
      c.fillRect(cx - 36, yy, 72, h);
      c.strokeStyle = 'rgba(226,185,74,0.9)';
      c.lineWidth = 4;
      c.strokeRect(cx - 32, yy + 4, 64, h - 8);
      c.fillStyle = 'rgba(226,185,74,0.35)';
      for (let gy = yy + 40; gy < yy + h - 20; gy += 60) c.fillRect(cx - 8, gy, 16, 16);
    } else if (y.kind === 'vault') {
      for (const r of [150, 112]) {
        c.strokeStyle = 'rgba(224,170,60,0.55)';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
      }
    } else if (y.kind === 'ruin') {
      // 废院：残砖和断瓦
      for (let k = 0; k < 40; k++) {
        const rx = x + 40 + hash(k, 1, seed ^ (x | 0)) * (w - 80);
        const ry = yy + 40 + hash(k, 2, seed ^ (yy | 0)) * (h - 80);
        c.fillStyle = k % 3 ? '#8b95a3' : '#6a7280';
        c.beginPath();
        c.ellipse(rx, ry, 10 + hash(k, 3, seed) * 14, 6 + hash(k, 4, seed) * 8, hash(k, 5, seed), 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(244,247,252,0.9)';
        c.beginPath();
        c.ellipse(rx - 2, ry - 3, 8, 3, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // 积雪：院角和墙根一团团
    c.fillStyle = 'rgba(240,244,252,0.88)';
    for (let k = 0; k < 14 + (w >> 6); k++) {
      const sx = x + hash(k, 11, seed ^ (x | 0)) * w;
      const sy = yy + hash(k, 12, seed ^ (yy | 0)) * h;
      c.beginPath();
      c.ellipse(sx, sy, 20 + hash(k, 13, seed) * 40, 8 + hash(k, 14, seed) * 14, 0, 0, Math.PI * 2);
      c.fill();
    }
    // 墙根的影：院内侧一圈暗边
    const grd = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(20,24,44,0.34)');
      g.addColorStop(1, 'rgba(20,24,44,0)');
      c.fillStyle = g;
      c.fillRect(rx, ry, rw, rh);
    };
    grd(x, yy, x, yy + 60, x, yy, w, 60);
    grd(x, yy + h, x, yy + h - 40, x, yy + h - 40, w, 40);
    grd(x, yy, x + 44, yy, x, yy, 44, h);
    grd(x + w, yy, x + w - 44, yy, x + w - 44, yy, 44, h);
    c.restore();
  }

  // ───────────────────────── 硬边的地面：平铺贴图 + 图形 ─────────────────────────

  /** 一张平铺用的小画布：draw 在世界单位里画，pw × ph 世界单位一周期，贴图 res 倍清晰 */
  private tile(key: string, pw: number, ph: number, draw: (c: CanvasRenderingContext2D) => void): void {
    const res = this.tileRes;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, Math.round(pw * res), Math.round(ph * res))!;
    const c = tex.getContext();
    c.scale(res, res);
    draw(c);
    tex.refresh();
  }

  private flat(key: string, x: number, y: number, w: number, h: number, pw: number, ph: number, depth: number): void {
    const res = this.tileRes;
    const t = this.scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0).setDepth(depth);
    t.setTileScale(1 / res, 1 / res);
    t.setTilePosition(((x % pw) + pw) % pw * res, ((y % ph) + ph) % ph * res);
    this.statics.push(t);
    this.flats.push({ o: t, x, y, w, h });
  }

  /** 画好石板路、各种院子的地面和水的平铺贴图，铺到街、院子、河上 */
  private buildFlats(): void {
    const seed = this.seed;
    // 街：错缝的石板，6 块宽 8 行一周期
    const TW = 36;
    const TH = 24;
    this.tile('town-street', TW * 6, TH * 8, (c) => {
      c.fillStyle = '#5f6679';
      c.fillRect(0, 0, TW * 6, TH * 8);
      for (let j = -1; j <= 8; j++) {
        for (let i = -1; i <= 6; i++) {
          const h = hash(i & 7, j & 7, seed);
          const x = i * TW + (((j % 2) + 2) % 2) * (TW / 2);
          c.fillStyle = h < 0.33 ? '#8e96a9' : h < 0.66 ? '#9aa2b5' : '#848ca0';
          c.fillRect(x + 1.6, j * TH + 1.6, TW - 3.2, TH - 3.2);
          c.fillStyle = 'rgba(255,255,255,0.16)';
          c.fillRect(x + 1.6, j * TH + 1.6, TW - 3.2, 3);
          if (h > 0.82) {
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.fillRect(x + 6, j * TH + 8, TW * 0.45, 4);
          }
        }
      }
    });
    for (const b of this.bands) this.flat('town-street', b.x, b.y, b.w, b.h, TW * 6, TH * 8, -992);

    // 院子：每种一张方砖地
    const base: Record<string, [string, string, number]> = {
      yard: ['#a8997f', 'rgba(70,56,40,0.4)', 60],
      plaza: ['#b4a78c', 'rgba(70,56,40,0.4)', 80],
      ruin: ['#c9cfdb', 'rgba(90,100,120,0.0)', 100],
      temple: ['#a39a86', 'rgba(70,56,40,0.4)', 60],
      vault: ['#6b7791', 'rgba(20,26,50,0.55)', 60],
    };
    const kinds = new Set(this.raid.map.yards.map((y) => y.kind));
    for (const k of kinds) {
      const [col, line, g] = base[k]!;
      const per = g * 4;
      this.tile(`town-yard-${k}`, per, per, (c) => {
        c.fillStyle = col;
        c.fillRect(0, 0, per, per);
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            const h = hash(i, j, seed ^ 0x55);
            c.fillStyle = h < 0.3 ? 'rgba(255,255,255,0.1)' : h < 0.5 ? 'rgba(40,30,20,0.09)' : 'rgba(0,0,0,0)';
            c.fillRect(i * g + 2, j * g + 2, g - 4, g - 4);
          }
        }
        c.strokeStyle = line;
        c.lineWidth = 2.4;
        for (let t = 0; t <= per; t += g) {
          c.beginPath();
          c.moveTo(t, 0);
          c.lineTo(t, per);
          c.moveTo(0, t);
          c.lineTo(per, t);
          c.stroke();
        }
      });
    }
    for (const y of this.raid.map.yards) this.flat(`town-yard-${y.kind}`, y.x, y.y, y.w, y.h, base[y.kind]![2] * 4, base[y.kind]![2] * 4, -991);

    // 水：蓝底、水纹、浮冰
    if (this.rivers.length > 0) {
      this.tile('town-water', 640, 360, (c) => {
        const g = c.createLinearGradient(0, 0, 0, 360);
        g.addColorStop(0, '#2d5d86');
        g.addColorStop(0.5, '#27547d');
        g.addColorStop(1, '#2d5d86');
        c.fillStyle = g;
        c.fillRect(0, 0, 640, 360);
        c.strokeStyle = 'rgba(150,200,232,0.5)';
        c.lineWidth = 3;
        c.lineCap = 'round';
        for (let i = 0; i < 28; i++) {
          const x = hash(i, 1, seed) * 600;
          const y = hash(i, 2, seed) * 340 + 10;
          const l = 30 + hash(i, 3, seed) * 50;
          for (const ox of [-640, 0]) {
            c.beginPath();
            c.moveTo(x + ox, y);
            c.quadraticCurveTo(x + ox + l / 2, y - 6, x + ox + l, y);
            c.stroke();
          }
        }
        for (let i = 0; i < 3; i++) {
          const ex = 100 + hash(i, 4, seed) * 440;
          const ey = 60 + hash(i, 5, seed) * 240;
          c.fillStyle = 'rgba(232,241,250,0.96)';
          c.strokeStyle = 'rgba(23,19,28,0.6)';
          c.lineWidth = 2.5;
          c.beginPath();
          c.ellipse(ex, ey, 40 + i * 8, 17 + i * 3, i, 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
      });
      for (const b of this.rivers) this.flat('town-water', b.x, b.y, b.w, b.h, 640, 360, -989);
    }
  }

  /** 河岸、桥、栈桥、台阶：不多的几块硬边图形，画一次（Graphics 的指令每帧重放，条数要少） */
  private buildShapes(): void {
    if (this.rivers.length === 0 && this.steps.length === 0) return;
    const g = this.scene.add.graphics().setDepth(-988);
    this.statics.push(g);
    const rect = (x: number, y: number, w: number, h: number, fill: number, a = 1): void => {
      g.fillStyle(fill, a);
      g.fillRect(x, y, w, h);
    };
    const edge = (x: number, y: number, w: number, h: number, wd = 3): void => {
      g.lineStyle(wd, 0x17131c, 0.9);
      g.strokeRect(x, y, w, h);
    };
    for (const b of this.rivers) {
      rect(b.x, b.y, b.w, 12, 0xf2f6fb);
      rect(b.x, b.y + b.h - 12, b.w, 12, 0xf2f6fb);
      rect(b.x, b.y + 12, b.w, 3.5, 0x17131c, 0.85);
      rect(b.x, b.y + b.h - 15.5, b.w, 3.5, 0x17131c, 0.85);
    }
    if (this.rivers.length > 0) {
      const rv = this.rivers;
      const y0 = rv[0]!.y;
      const h = rv[0]!.h;
      const gaps: [number, number][] = [];
      if (rv[0]!.x > 0) gaps.push([0, rv[0]!.x]);
      for (let i = 0; i + 1 < rv.length; i++) gaps.push([rv[i]!.x + rv[i]!.w, rv[i + 1]!.x]);
      const last = rv[rv.length - 1]!;
      if (last.x + last.w < this.size) gaps.push([last.x + last.w, this.size]);
      for (const [x0, x1] of gaps) {
        if (x1 - x0 < 20) continue;
        rect(x0, y0 - 6, x1 - x0, h + 12, 0x9c6a3a);
        for (let y = y0; y < y0 + h; y += 22) rect(x0, y, x1 - x0, 2, 0x462a16, 0.85);
        for (const x of [x0, x1 - 14]) {
          rect(x, y0 - 6, 14, h + 12, 0x5e3b20);
          rect(x + 2, y0 - 6, 10, h + 12, 0xf6f9fd, 0.92);
          edge(x, y0 - 6, 14, h + 12);
        }
      }
    }
    for (const d of this.docks) {
      const len = 150;
      const x = d.x - 36;
      const y = d.dir === 1 ? d.y - 6 : d.y - len + 6;
      rect(x, y, 72, len, 0x9c6a3a);
      for (let k = 0; k < len; k += 16) rect(x, y + k, 72, 2, 0x462a16, 0.85);
      edge(x, y, 72, len);
      for (const px of [x - 4, x + 66]) {
        for (let k = d.dir === 1 ? 20 : 8; k < len; k += 44) {
          rect(px, y + k, 10, 10, 0x4a3328);
          rect(px + 1, y + k, 8, 3, 0xf6f9fd);
        }
      }
    }
    // 台阶：缺口里一级级往上
    for (const st of this.steps) {
      const w = st.x1 - st.x0;
      for (let k = 0; k < 8; k++) {
        const y = st.y - 70 + k * 18;
        rect(st.x0, y, w, 18, k % 2 ? 0xa3adbb : 0xb6bfcc);
        rect(st.x0, y + 15, w, 3, 0x5c6677);
        if (hash(k, st.x0 | 0, this.seed) < 0.6) rect(st.x0 + hash(k, 3, this.seed) * (w - 30), y, 26, 4, 0xf5f8fd, 0.9);
      }
      rect(st.x0 - 2, st.y - 70, 3, 144, 0x17131c);
      rect(st.x1 - 1, st.y - 70, 3, 144, 0x17131c);
    }
  }

  // ───────────────────────── 夜色 ─────────────────────────

  /** 每帧：补地面分块，重画暗幕。hx, hy 是主角（画面上的位置） */
  update(cam: Phaser.Cameras.Scene2D.Camera, hx: number, hy: number): void {
    // 镜头刚 centerOn 过，worldView 要到渲染前才更新：自己按中心和缩放算
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    const v = this.view.setTo(cam.midPoint.x - vw / 2, cam.midPoint.y - vh / 2, vw, vh);
    this.streamChunks(v);
    for (const f of this.flats) f.o.setVisible(f.x < v.right + 40 && f.x + f.w > v.x - 40 && f.y < v.bottom + 40 && f.y + f.h > v.y - 40);
    for (const f of this.culls) f.o.setVisible(f.x < v.right + 40 && f.x + f.w > v.x - 40 && f.y < v.bottom + 40 && f.y + f.h > v.y - 40);
    // 主角绕到正房后面（被屋顶挡住）时，屋顶变淡
    for (const h of this.houses) {
      const behind = hx > h.x0 && hx < h.x1 && hy > h.y0 && hy < h.y1;
      const a = behind ? 0.5 : 1;
      if (h.o.alpha !== a) h.o.setAlpha(a);
    }
    const c = this.dctx;
    const sx = this.dw / v.width;
    const sy = this.dh / v.height;
    this.darkImg.setPosition(v.centerX, v.centerY).setDisplaySize(v.width + 2, v.height + 2);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.dw, this.dh);
    c.fillStyle = 'rgba(12,18,48,0.56)';
    c.fillRect(0, 0, this.dw, this.dh);
    c.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, a: number): void => {
      const px = (x - v.x) * sx;
      const py = (y - v.y) * sy;
      const rx = r * sx;
      const ry = r * sy;
      if (px + rx < 0 || px - rx > this.dw || py + ry < 0 || py - ry > this.dh) return;
      c.save();
      c.translate(px, py);
      c.scale(1, ry / rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.45, `rgba(0,0,0,${a * 0.7})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
    };
    hole(hx, hy - 20, 360, 0.96);
    const lights = this.lights;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i]!;
      if (l.x < v.x - l.r || l.x > v.right + l.r || l.y < v.y - l.r || l.y > v.bottom + l.r) continue;
      hole(l.x, l.y, l.r, l.a);
    }
    const gates = this.raid.map.gates;
    for (let k = 0; k < gates.length; k++) {
      const g = gates[k]!;
      hole(g.x, g.y - 50, this.raid.gateOpen[k] === 1 ? 420 : 200, this.raid.gateOpen[k] === 1 ? 0.95 : 0.5);
    }
    const tr = this.trail;
    for (let i = 0; i + 2 < tr.length; i += 3) hole(tr[i]!, tr[i + 1]!, 48, 0.85 * tr[i + 2]!);
    // 暖色罩：灯笼、亮窗、开着的门，叠在挖出来的亮处
    c.globalCompositeOperation = 'source-over';
    const warm = (x: number, y: number, r: number, a: number): void => {
      const px = (x - v.x) * sx;
      const py = (y - v.y) * sy;
      const rx = r * sx;
      const ry = r * sy;
      if (px + rx < 0 || px - rx > this.dw || py + ry < 0 || py - ry > this.dh) return;
      c.save();
      c.translate(px, py);
      c.scale(1, ry / rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(255,176,84,${a})`);
      g.addColorStop(1, 'rgba(255,176,84,0)');
      c.fillStyle = g;
      c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
    };
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i]!;
      if (l.warm === 0 || l.x < v.x - l.r || l.x > v.right + l.r || l.y < v.y - l.r || l.y > v.bottom + l.r) continue;
      warm(l.x, l.y, l.r * 0.9, l.warm);
    }
    for (let k = 0; k < gates.length; k++) if (this.raid.gateOpen[k] === 1) warm(gates[k]!.x, gates[k]!.y - 40, 300, 0.3);
    this.dark.refresh();
  }

  destroy(): void {
    for (const k of [...this.chunks.keys()]) this.dropChunk(k);
    for (const k of this.made) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    this.darkImg.destroy();
    this.scene.textures.remove('town-dark');
  }
}
