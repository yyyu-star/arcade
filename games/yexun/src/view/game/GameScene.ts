/**
 * 守夜的对局画面（DESIGN.md 5.3）：
 * - 核心按每秒 30 拍走（累加真实时间，一帧可能走 0–3 拍），画面每帧在两拍之间插值；
 * - 主角本地预测：摇杆一动，主角的画面位置当帧就按新方向挪（手感验收 ②），核心下一拍算出来的位置自然接上；
 * - 打击停顿（hit-stop）只是暂停送拍，核心照样按拍走，不影响确定性；
 * - 怪、子弹、掉落按槽位一一对应一个精灵，槽位的 gen 变了就是换了一只，重设外观。
 * 画面只读核心的状态和事件（w.ev），不自己算规则。
 */
import Phaser from 'phaser';
import { ENEMIES, HOP_AIR, HOP_PERIOD, WATER } from '../../content/enemies.ts';
import { ARENA, DROPS, xpNeed } from '../../content/player.ts';
import { BEAST, DAWN_RED, DAWN_WARN, GATE, RAID_DAWN } from '../../content/explore.ts';
import { TIERS, TIER_INFO, TREASURES } from '../../content/treasures.ts';
import { edgeArrow } from '../../explore/view/guide-hud.ts';
import { guide, newGuide } from '../../explore/guide.ts';
import type { Raid } from '../../explore/raid.ts';
import { DAWN_TICK } from '../../content/waves.ts';
import { MERGES, PASSIVE_IDS, PASSIVES, WEAPON_IDS, WEAPONS } from '../../content/weapons.ts';
import { Drop, Ev, MAX_DROPS, MAX_ENEMIES, MAX_SHOTS, MERGE_CODE, Shot, step, type World } from '../../core/index.ts';
import { COS, SIN } from '../../core/dirs.ts';
import { RAID_TEX, type Atlas, type Frame } from '../art/atlas.ts';
import { artRng } from '../art/draw.ts';
import { treasureIconKey } from '../art/sprites8.ts';
import { MOB_COLOR } from '../art/sprites.ts';
import { music } from '../audio/music.ts';
import { sfx, type SfxName } from '../audio/sfx.ts';
import type { Banners } from '../ui/banner.ts';
import { Cards, describe } from '../ui/cards.ts';
import type { Hud, HudSlot } from '../ui/hud.ts';
import { LOW_MEMORY } from '../viewport.ts';
import { DamageNumbers, Fx } from './fx.ts';
import { weaponLook } from './look.ts';
import type { Input } from './input.ts';

const TICK_MS = 1000 / 30;

/** 夜探院子的铺地：颜色和透明度（盖在雪地上，深度在雪地和点缀之间） */
const YARD_FLOOR: Record<string, [number, number]> = {
  yard: [0xc9bfa8, 0.42],
  plaza: [0xd4c8ae, 0.45],
  ruin: [0xd8dde6, 0.22],
  temple: [0xe0c27a, 0.45],
  vault: [0x8d9bb5, 0.5],
};

/** 怪种类编号 → 图集帧（没画好的先借相近的） */
const MOB_FRAME = ENEMIES.map((e) => e.kind as string);
const MOB_FALLBACK: Record<string, string> = {
  fox: 'wisp', shishi: 'jiangshi_big', general: 'jiangshi_big', boss: 'jiangshi_big',
  horse: 'paper', water: 'wisp', bone: 'paper', bat: 'wisp', scarecrow: 'jiangshi', weasel: 'fox', snow: 'wisp', whitefox: 'fox', palanquin: 'shishi', ice: 'fireball', lord: 'boss', money: 'coin',
};
/** 怪的主色（按编号）：没画好的怪借图时上这个色，死亡碎片也用它 */
const MOB_TINT = [
  MOB_COLOR.paper, MOB_COLOR.wisp, MOB_COLOR.jiangshi, MOB_COLOR.lantern, MOB_COLOR.fox, 0x9aa0ad, 0x2f5a46, 0xb8902e,
  0xf4f1ea, 0x3f9a8a, 0xe8e2d0, 0x5a3a78, 0xc9a04a, 0xb9853a, 0x8fd0f0, 0xf6f8ff, 0xd0362e, 0xf0e0b0,
  // 夜探的守卫：巡夜将（黑甲）、镇门石兽（青石）
  0x343a4a, 0x7f8da0,
];
/** 精英出场的横幅：名字 + 一句怎么打 */
const ELITE_BANNER: Partial<Record<string, [string, string]>> = {
  shishi: ['石狮怪', '刀剑砍不动，用符和铃'],
  general: ['跳尸将军', '会召小跳尸，打倒掉宝箱'],
  whitefox: ['白狐', '连冲三下，看准了躲'],
  palanquin: ['纸轿', '打碎会放出一群纸人'],
};
const WATER_CODE = ENEMIES.findIndex((e) => e.kind === 'water');
/** Boss 进下一段的横幅（按种类、段号） */
const PHASE_BANNER: Partial<Record<string, [string, string][]>> = {
  boss: [['', ''], ['尸王发怒', '会吐尸气了'], ['尸王发狂', '跳砸更大，尸气两圈']],
  lord: [['', ''], ['老爷翻脸', '纸钱两圈，会召纸轿']],
};

/** 子弹种类 → 图集帧（光波画在 Graphics 上，这里给个占位） */
const SHOT_FRAME: Partial<Record<number, string>> = { [Shot.Talisman]: 'talisman', [Shot.Coin]: 'coin', [Shot.Fly]: 'flysword', [Shot.Fireball]: 'fireball', [Shot.Wave]: 'ring', [Shot.Petal]: 'petal', [Shot.Crane]: 'crane', [Shot.Burn]: 'burn' };

const FIRE_SFX: Partial<Record<string, SfxName>> = { sword: 'sword', talisman: 'talisman', coins: 'coins', flysword: 'flysword', thunder: 'thunder', bell: 'bell', mirror: 'mirror', gourd: 'fire', rope: 'rope', petals: 'petal', crane: 'crane' };

export interface GameDeps {
  world: World;
  atlas: Atlas;
  /** 夜探用的第二张图集（buildRaidAtlas）；夜探必传，守夜不用 */
  raidAtlas?: Atlas;
  hud: Hud;
  cards: Cards;
  banners: Banners;
  input: Input;
  zoom: number;
  icon: (key: string) => string;
  /** 第一局：卡片上带一行说明 */
  firstRun: boolean;
  onEnd: (w: World) => void;
  /** 每推一拍（含选卡）的前后：录像在前面记输入，成就计数在后面读事件 */
  beforeStep?: (w: World, dir: number, choice: number) => void;
  afterStep?: (w: World) => void;
  /** 设置里的"震屏"开关（手感清单第 2 条：能关） */
  shake: () => boolean;
  /** 开了宝箱（引导用：第一次开宝箱时提示进化） */
  onChest?: () => void;
  /** 冒烟、截图用：由机器人代替输入 */
  autopilot?: (w: World) => { dir: number; choice: number };
  /** 回放：时间、选卡都交给它推（录像驱动、可变速），每推一拍回调一次 each；场景自己不推 */
  drive?: (dtMs: number, each: () => void) => void;
}

interface MobView {
  gen: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  res: number;
  flash: number;
  kind: number;
}

export class GameScene extends Phaser.Scene {
  private d!: GameDeps;
  private w!: World;
  private acc = 0;
  private freeze = 0;
  /** 冰屑的间隔计时 */
  private frost = 0;
  /** 演出（宝箱、进化、升级光柱）中不送拍 */
  private hold = 0;
  private paused = false;
  private frames!: Map<string, Frame>;
  private hero!: Phaser.GameObjects.Image;
  private heroBack!: Phaser.GameObjects.Image;
  private heroShadow!: Phaser.GameObjects.Image;
  private aura!: Phaser.GameObjects.Image;
  private mobs: (MobView | null)[] = [];
  private shots: ({ gen: number; img: Phaser.GameObjects.Image; trail: number } | null)[] = [];
  private drops: ({ gen: number; img: Phaser.GameObjects.Image; kind: number; key: string; big: boolean } | null)[] = [];
  private fx!: Fx;
  private ground!: Fx;
  private nums!: DamageNumbers;
  private gfx!: Phaser.GameObjects.Graphics;
  private bolts: { pts: number[]; life: number }[] = [];
  /** 这一帧要画的光波：x, y, 半径, 最大半径 */
  private waves: number[] = [];
  /** 桃花雨的落点标记：x、y、离落地多近（0–1） */
  private petalMarks: number[] = [];
  /** 缚妖索的绳子：一串点（从主角开始） */
  private ropes: { pts: number[]; life: number }[] = [];
  private shieldImg!: Phaser.GameObjects.Image;
  private telegraphs: { x: number; y: number; r: number; life: number; max: number; round?: boolean; color?: number }[] = [];
  // ───── 夜探 ─────
  private raid: Raid | null = null;
  private arenaW = ARENA.w;
  private arenaH = ARENA.h;
  /** 地面层的圈（门圈）：画在影子下面，站在圈里的主角和怪盖在它上面 */
  private rg!: Phaser.GameObjects.Graphics;
  private chestViews: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; open: boolean }[] = [];
  private gateViews: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; open: boolean }[] = [];
  private gd = newGuide();
  private gdAt = -99;
  private gdMask = -1;
  /** 守卫头上的"!"：跟着那只怪走 */
  private alerts: { slot: number; gen: number; life: number; img: Phaser.GameObjects.Image }[] = [];
  /** 捡到宝物的飘字（图标 + 名字） */
  private floats: { img: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text; x: number; y: number; life: number }[] = [];
  private bossShown = false;
  private renderX = 0;
  private renderY = 0;
  private walk = 0;
  private stepAcc = 0;
  private footSide = 1;
  private comboN = 0;
  private comboAt = 0;
  private milestone = 0;
  private pickupChain = 0;
  private pickupAt = 0;
  private lowBeat = 0;
  private hitSfxAt = 0;
  private lastMinute = -1;
  private bossOn = false;
  /** 这一局弹过卡片了（第一局只有第一次带说明） */
  private cardsSeen = false;
  private now = 0;

  constructor() {
    super('game');
  }

  init(d: GameDeps): void {
    this.d = d;
    this.w = d.world;
  }

  private shake(ms: number, k: number): void {
    if (this.d.shake()) this.cameras.main.shake(ms, k);
  }

  private frame(key: string): Frame {
    return this.frames.get(key) ?? this.frames.get(MOB_FALLBACK[key] ?? 'glow')!;
  }

  private img(key: string, x = 0, y = 0, scale = 1): Phaser.GameObjects.Image {
    const f = this.frame(key);
    return this.add.image(x, y, f.tex ?? 'atlas', f.key).setOrigin(f.ox, f.oy).setScale(scale / f.res);
  }

  create(): void {
    this.raid = this.w.raid;
    this.arenaW = this.w.arenaW;
    this.arenaH = this.w.arenaH;
    this.frames = new Map(this.d.atlas.frames);
    const tex = this.textures.exists('atlas') ? this.textures.get('atlas') : this.textures.addCanvas('atlas', this.d.atlas.canvas)!;
    for (const f of this.frames.values()) if (!tex.has(f.key)) tex.add(f.key, 0, f.x, f.y, f.w, f.h);
    if (this.raid && this.d.raidAtlas) {
      const t8 = this.textures.exists(RAID_TEX) ? this.textures.get(RAID_TEX) : this.textures.addCanvas(RAID_TEX, this.d.raidAtlas.canvas)!;
      for (const f of this.d.raidAtlas.frames.values()) {
        this.frames.set(f.key, f);
        if (!t8.has(f.key)) t8.add(f.key, 0, f.x, f.y, f.w, f.h);
      }
    }
    const cam = this.cameras.main;
    cam.setZoom(this.d.zoom);
    cam.setBackgroundColor('#dfe4ee');
    cam.setBounds(-200, -200, this.arenaW + 400, this.arenaH + 400);

    // 雪地：一张可平铺的贴图铺满场地，四周一圈压暗当边界
    const gtex = this.textures.get('ground').getSourceImage() as HTMLCanvasElement;
    this.add.tileSprite(this.arenaW / 2, this.arenaH / 2, this.arenaW + 400, this.arenaH + 400, 'ground').setTileScale(512 / gtex.width).setDepth(-1000).setTint(0xd6e0f6);
    this.rg = this.add.graphics().setDepth(-500);
    if (this.raid) this.setupRaid(this.raid);
    this.scatterDecor();
    this.drawBlocks();

    this.ground = new Fx(this, this.d.atlas, LOW_MEMORY ? 60 : 140);
    this.fx = new Fx(this, this.d.atlas, LOW_MEMORY ? 180 : 420);
    this.nums = new DamageNumbers(this, this.d.atlas, 30);
    this.gfx = this.add.graphics().setDepth(8000);

    this.aura = this.img('aura', 0, 0, 1).setAlpha(0.9);
    this.heroShadow = this.img('shadow', 0, 0, 1.1).setAlpha(0.9);
    // 主角外面再描一圈：同一张图涂成墨色、放大一点垫在后面，轮廓更粗、在怪堆里一眼找得到
    this.heroBack = this.img('hero').setTint(0x17131c).setTintMode(Phaser.TintModes.FILL);
    this.hero = this.img('hero');
    // 金钟罩：有护盾时罩在主角身上（半透明，前面）
    this.shieldImg = this.img('goldbell', 0, 0, 1).setVisible(false);
    this.mobs = new Array(MAX_ENEMIES).fill(null);
    this.shots = new Array(MAX_SHOTS).fill(null);
    this.drops = new Array(MAX_DROPS).fill(null);
    this.renderX = this.w.x;
    this.renderY = this.w.y;
    cam.centerOn(this.w.x, this.w.y);
    music.start('night');
    music.setIntensity(0);
  }

  /** 地图上挡路的东西（义庄的墙、棺材、正堂）：墙按段拼，最后一段压缩到刚好对齐；深度按脚底 */
  private drawBlocks(): void {
    for (const b of this.w.blocks) {
      if (b.look === 'wall_h') {
        const n = Math.max(1, Math.round(b.w / 80));
        const step = b.w / n;
        for (let k = 0; k < n; k++) this.img('wall_h', b.x + step * (k + 0.5), b.y + b.h).setScale(step / 80 / this.frame('wall_h').res, 1 / this.frame('wall_h').res).setDepth(b.y + b.h);
      } else if (b.look === 'wall_v') {
        const n = Math.max(1, Math.round(b.h / 80));
        const step = b.h / n;
        for (let k = 0; k < n; k++) this.img('wall_v', b.x + b.w / 2, b.y + step * (k + 1)).setScale(1 / this.frame('wall_v').res, step / 80 / this.frame('wall_v').res).setDepth(b.y + step * (k + 1));
      } else if (b.look === 'coffin') this.img('coffin', b.x + b.w / 2, b.y + b.h + 4).setDepth(b.y + b.h);
      else if (b.look === 'house' || (b.look === 'hall' && this.raid)) this.drawHouse(b, b.look === 'hall');
      else if (b.look === 'stall') this.img('stall', b.x + b.w / 2, b.y + b.h + 4).setDepth(b.y + b.h);
      else if (b.look === 'terrace') {
        const n = Math.max(1, Math.round(b.w / 80));
        const step = b.w / n;
        const f = this.frame('terrace_h');
        for (let k = 0; k < n; k++) this.img('terrace_h', b.x + step * (k + 0.5), b.y + b.h).setScale(step / 80 / f.res, 1 / f.res).setDepth(b.y + b.h);
      } else if (b.look === 'river') continue;
      else this.img('hall', b.x + b.w / 2, b.y + b.h).setDepth(b.y + b.h);
    }
  }

  /** 夜探的房子：长边上一段段拼（横的画正面，竖的画俯视的瓦顶）；庙和石兽院的正房换红墙青瓦，横的中间再立一座门楼 */
  private drawHouse(b: { x: number; y: number; w: number; h: number }, hall: boolean): void {
    if (b.w >= b.h) {
      const n = Math.max(1, Math.round(b.w / 80));
      const step = b.w / n;
      const key = hall ? 'hall_h' : 'house_h';
      const f = this.frame(key);
      for (let k = 0; k < n; k++) this.img(key, b.x + step * (k + 0.5), b.y + b.h).setScale(step / 80 / f.res, 1 / f.res).setDepth(b.y + b.h);
      if (hall && b.w >= 300) this.img('hall', b.x + b.w / 2, b.y + b.h).setDepth(b.y + b.h + 0.1);
    } else {
      const n = Math.max(1, Math.round(b.h / 80));
      const step = b.h / n;
      const key = hall ? 'hall_v' : 'house_v';
      const f = this.frame(key);
      for (let k = 0; k < n; k++) this.img(key, b.x + b.w / 2, b.y + step * (k + 1)).setScale(b.w / 110 / f.res, step / 80 / f.res).setDepth(b.y + step * (k + 1));
    }
  }

  /** 夜探场地的地面：院子的铺地、河（含桥）、宝箱、门 */
  private setupRaid(raid: Raid): void {
    const floor = this.add.graphics().setDepth(-980);
    for (const y of raid.map.yards) {
      const [color, a] = YARD_FLOOR[y.kind] ?? [0xc9bfa8, 0.4];
      floor.fillStyle(color, a);
      floor.fillRect(y.x, y.y, y.w, y.h);
    }
    this.drawRiver(raid);
    const sh = this.frame('shadow');
    for (const c of raid.map.chests) {
      this.add.image(c.x, c.y + 14, 'atlas', 'shadow').setScale(0.8 / sh.res).setDepth(-400).setAlpha(0.8);
      const img = this.img(`chest_${c.tier}`, c.x, c.y + 14).setDepth(c.y + 14);
      const glow = c.tier === 'wood' ? null : this.img('haze', c.x, c.y - 4, c.tier === 'gold' ? 2 : 1.4).setTint(c.tier === 'gold' ? 0xffd860 : 0xffa860).setDepth(c.y + 13);
      this.chestViews.push({ img, glow, open: false });
    }
    for (const g of raid.map.gates) {
      const foot = g.y - 50;
      const img = this.img('gate_closed', g.x, foot).setDepth(foot);
      const glow = this.img('haze', g.x, foot - 56, 4.4).setTint(0xffe08a).setDepth(foot - 1).setVisible(false);
      const label = this.add
        .text(g.x, foot - 112, g.name, { fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#f6efdc', stroke: '#17131c', strokeThickness: 6 })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(9100);
      this.gateViews.push({ img, glow, label, open: false });
    }
  }

  /** 渡口的河：深蓝的水加浅色水纹和浮冰，上下两道雪岸；相邻两段河之间的空当是桥 */
  private drawRiver(raid: Raid): void {
    const rivers = raid.map.blocks.filter((b) => b.look === 'river').sort((a, b) => a.x - b.x);
    if (rivers.length === 0) return;
    const g = this.add.graphics().setDepth(-970);
    const r = artRng(raid.setup.seed ^ 0x51ed);
    const y0 = rivers[0]!.y;
    const h = rivers[0]!.h;
    for (const b of rivers) {
      g.fillStyle(0x2f5f86, 1);
      g.fillRect(b.x, b.y, b.w, b.h);
      g.lineStyle(3, 0x8cc0e0, 0.55);
      for (let i = 0, n = Math.round((b.w * b.h) / 9000); i < n; i++) {
        const x = b.x + r() * b.w;
        const y = b.y + 20 + r() * (b.h - 40);
        const len = 40 + r() * 70;
        g.lineBetween(x, y, x + len, y + (r() - 0.5) * 6);
      }
      g.fillStyle(0xe8f1fa, 0.92);
      g.lineStyle(2.5, 0x17131c, 0.6);
      for (let i = 0, n = Math.round((b.w * b.h) / 60000); i < n; i++) {
        const x = b.x + 40 + r() * (b.w - 80);
        const y = b.y + 40 + r() * (b.h - 80);
        const ew = 60 + r() * 60;
        const eh = 26 + r() * 20;
        g.fillEllipse(x, y, ew, eh);
        g.strokeEllipse(x, y, ew, eh);
      }
      for (const yy of [b.y, b.y + b.h - 12]) {
        g.fillStyle(0xf6f9fd, 1);
        g.fillRect(b.x, yy, b.w, 12);
      }
      g.lineStyle(4, 0x17131c, 0.85);
      g.lineBetween(b.x, b.y + 12, b.x + b.w, b.y + 12);
      g.lineBetween(b.x, b.y + b.h - 12, b.x + b.w, b.y + b.h - 12);
    }
    // 桥：相邻河段之间、最左和最右的空当
    const gaps: [number, number][] = [];
    if (rivers[0]!.x > 0) gaps.push([0, rivers[0]!.x]);
    for (let i = 0; i + 1 < rivers.length; i++) gaps.push([rivers[i]!.x + rivers[i]!.w, rivers[i + 1]!.x]);
    const last = rivers[rivers.length - 1]!;
    if (last.x + last.w < raid.map.size) gaps.push([last.x + last.w, raid.map.size]);
    const br = this.add.graphics().setDepth(-960);
    for (const [x0, x1] of gaps) {
      if (x1 - x0 < 20) continue;
      br.fillStyle(0xa8743f, 1);
      br.fillRect(x0, y0 - 6, x1 - x0, h + 12);
      br.lineStyle(2, 0x5e3b20, 0.8);
      for (let y = y0; y < y0 + h; y += 24) br.lineBetween(x0, y, x1, y);
      for (const x of [x0, x1 - 12]) {
        br.fillStyle(0x6a4a38, 1);
        br.fillRect(x, y0 - 6, 12, h + 12);
        br.lineStyle(3, 0x17131c, 0.9);
        br.strokeRect(x, y0 - 6, 12, h + 12);
        br.fillStyle(0xf6f9fd, 0.9);
        br.fillRect(x + 2, y0 - 6, 8, h + 12);
      }
    }
  }

  /** 点缀：按种子撒在整个场地上（只装饰，不挡路）；枯树、残碑、石灯、石头、青石板、冰面、雪堆、枯草；义庄另撒白灯笼、稻草 */
  private scatterDecor(): void {
    const r = artRng(this.w.setup.seed);
    const blocks = this.w.blocks;
    const spawnX = this.raid ? this.w.x : this.arenaW / 2;
    const spawnY = this.raid ? this.w.y : this.arenaH / 2;
    const put = (key: string, n: number, ground: boolean): void => {
      if (!this.frames.has(key)) return;
      for (let i = 0; i < n; i++) {
        const x = 100 + r() * (this.arenaW - 200);
        const y = 100 + r() * (this.arenaH - 200);
        // 出生点附近留空，开场看得清（夜探的出生点在角上，不在中心）
        if (Math.abs(x - spawnX) < 220 && Math.abs(y - spawnY) < 160) continue;
        // 不压在墙、棺材上（立着的东西离远一点）
        const pad = ground ? 10 : 50;
        if (blocks.some((b) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad * 2)) continue;
        const o = this.img(key, x, y, 0.85 + r() * 0.35);
        if (r() < 0.5) o.setFlipX(true);
        o.setDepth(ground ? -900 + r() : y);
      }
    };
    // 夜探的场地是守夜的四倍大，点缀只多一倍（墙和房子已经很多）
    const dense = (LOW_MEMORY ? 0.6 : 1) * (this.raid ? 2 : 1);
    put('drift', Math.round(60 * dense), true);
    put('puddle', Math.round(26 * dense), true);
    put('slabs', Math.round(30 * dense), true);
    put('grass', Math.round(220 * dense), true);
    const yz = !this.raid && blocks.length > 0;
    put('tree', Math.round((yz ? 26 : 46) * dense), false);
    put('rock', Math.round(60 * dense), false);
    put('stele', Math.round(18 * dense), false);
    put('stonelamp', Math.round(22 * dense), false);
    if (yz) {
      put('white_lantern', Math.round(30 * dense), false);
      put('straw', Math.round(30 * dense), true);
    }
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.d.input.reset();
  }

  /** 每帧脚本耗时（毫秒，滑动平均），冒烟里读 */
  cost = 0;

  override update(_t: number, delta: number): void {
    const t0 = performance.now();
    this.frameUpdate(delta);
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  private frameUpdate(delta: number): void {
    const dt = Math.min(delta, 100);
    this.now += dt;
    if (this.d.drive) {
      if (!this.paused && this.w.phase !== 'over') this.d.drive(dt, () => this.readEvents());
    } else if (!this.paused && !this.d.cards.open) {
      if (this.freeze > 0) this.freeze -= dt;
      else if (this.hold > 0) this.hold -= dt;
      else if (this.w.phase === 'play') {
        this.acc += dt;
        let n = 0;
        while (this.acc >= TICK_MS && n < 4) {
          this.acc -= TICK_MS;
          n++;
          this.tick();
          if (this.w.phase !== 'play' || this.freeze > 0 || this.hold > 0) {
            this.acc = Math.min(this.acc, TICK_MS);
            break;
          }
        }
      } else if (this.w.phase === 'choose') this.openCards();
    }
    this.draw(dt);
  }

  private tick(): void {
    const a = this.d.autopilot?.(this.w);
    this.advance(a ? a.dir : this.d.input.dir(), -1);
    this.readEvents();
    if (this.w.phase === 'choose') {
      // 升级演出：先"叮 + 光柱" 0.3 秒再弹卡片（手感清单第 5 条）
      this.hold = 300;
    }
    if (this.w.phase === 'over') {
      music.stop();
      this.time.delayedCall(this.w.won ? 1200 : 900, () => this.d.onEnd(this.w));
    }
  }

  /** 推一拍：所有 step 都从这里走，前后钩子才不会漏 */
  private advance(dir: number, choice: number): void {
    this.d.beforeStep?.(this.w, dir, choice);
    step(this.w, dir, choice);
    this.d.afterStep?.(this.w);
  }

  private openCards(): void {
    if (this.d.cards.open) return;
    const w = this.w;
    if (this.d.autopilot) {
      this.advance(0, this.d.autopilot(w).choice);
      this.readEvents();
      return;
    }
    this.d.cards.show(
      w.level - w.pendingLevels + 1,
      w.choices.map((c) => describe(w, c)),
      this.d.firstRun && !this.cardsSeen,
      { rerolls: w.rerolls, bans: w.bans },
      (i) => {
        this.cardsSeen = true;
        sfx.play('choose');
        this.advance(0, i);
        this.readEvents();
      },
    );
  }

  // ───────────────────────── 事件 → 特效和声音 ─────────────────────────

  private readEvents(): void {
    const ev = this.w.ev;
    let hits = 0;
    let chests = 0;
    for (let i = 0; i < ev.n; i++) {
      const x = ev.x[i]!;
      const y = ev.y[i]!;
      switch (ev.type[i]) {
        case Ev.Hit: {
          const b = ev.b[i]!;
          const crit = (b & 1) === 1;
          const slot = ev.c[i]!;
          const m = this.mobs[slot];
          if (m) m.flash = 70;
          // 克制：打在怕的地方数字发橙红，被扛住发灰（不用读说明也看得出这怪吃不吃这一套）
          const tint = b & 2 ? 0xff6a2a : b & 4 ? 0x9a9aa8 : undefined;
          this.nums.show(x, y - 30 * (this.w.eSize[slot] ?? 1) - 14, ev.a[i]!, crit, tint);
          if (crit) this.spark(x, y - 20, 0xffcf2e, 0.8);
          hits++;
          break;
        }
        case Ev.Kill:
          this.onKill(x, y, ev.a[i]!, ev.b[i] === 1);
          break;
        case Ev.Block:
          this.spark(x, y, 0xf2c94c, 0.9);
          break;
        case Ev.Steal:
          // 黄鼠狼叼走铜钱：金色一闪 + 一声，追上打死双倍还
          sfx.play('coin');
          this.spark(x, y - 20, 0xf2c94c, 1);
          break;
        case Ev.Slash:
          this.slash(x, y, ev.a[i]!, ev.b[i]!, ev.c[i] === 1);
          break;
        case Ev.Thunder:
          this.thunder(x, y, ev.b[i]!, ev.c[i] === 1);
          break;
        case Ev.Chain:
          // 连锁雷：两只怪之间拉一道横着的电弧
          this.bolts.push({ pts: this.jagged(x, y - 20, ev.b[i]!, ev.c[i]! - 20, 6, 26), life: 220 });
          break;
        case Ev.Bell:
          this.fx.spawn({ frame: 'ring', x, y: y - 10, life: 420, s0: (ev.b[i]! * 2) / 128 * 0.6, s1: (ev.b[i]! * 2) / 128, a0: 0.75, a1: 0, tint: 0xe2b54a, depth: 50 });
          break;
        case Ev.Burst:
          this.burst(x, y, 0xf5b52e, ev.b[i]! / 34);
          break;
        case Ev.Wave:
          if (ev.a[i] === 0) this.ground.spawn({ frame: 'bagua', x, y, life: 600, s0: 0.6, s1: 1.5, a0: 0.9, a1: 0, rot: 0, spin: 2, ground: true });
          break;
        case Ev.Flame:
          this.flame(x, y, ev.a[i]!, ev.b[i]!, ev.c[i]!);
          break;
        case Ev.Bind: {
          const n = ev.a[i]!;
          if (n === 0 || this.ropes.length === 0) this.ropes.push({ pts: [this.renderX, this.renderY - 24], life: 420 });
          this.ropes[this.ropes.length - 1]!.pts.push(x, y - 16);
          this.fx.spawn({ frame: 'ring', x, y: y - 10, life: 300, s0: 0.25, s1: 0.5, a0: 1, a1: 0, tint: 0xf2c94c });
          break;
        }
        case Ev.Petal:
          this.burst(x, y - 6, 0xff6fa8, 1.1);
          if (!LOW_MEMORY) for (let k = 0; k < 3; k++) this.fx.spawn({ frame: 'petal', x, y: y - 6, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 60, g: 300, life: 420, s0: 1.2, s1: 0.6, rot: Math.random() * 6, spin: 8 });
          break;
        case Ev.Shield:
          if (ev.a[i] === 0) {
            sfx.play('shieldBreak');
            this.shake(160, 0.006);
            this.fx.spawn({ frame: 'ring', x, y: y - 20, life: 450, s0: 0.4, s1: (ev.b[i]! * 2.2) / 128, a0: 1, a1: 0, tint: 0xf2c94c, depth: 60 });
            this.fx.spawn({ frame: 'goldbell', x, y: y + 6, life: 300, s0: 1, s1: 1.5, a0: 0.8, a1: 0, depth: this.renderY + 2 });
          } else {
            sfx.play('shieldUp', { volume: 0.5 });
            this.fx.spawn({ frame: 'ring', x, y: y - 20, life: 300, s0: 0.3, s1: 0.8, a0: 0.8, a1: 0, tint: 0xf2c94c });
          }
          break;
        case Ev.Fire: {
          const id = WEAPON_IDS[ev.a[i]!];
          const name = id ? FIRE_SFX[id] : undefined;
          if (name) sfx.play(name, { volume: 0.6 });
          break;
        }
        case Ev.Pickup:
          this.onPickup(x, y, ev.a[i]!);
          break;
        case Ev.LevelUp:
          sfx.play('levelup');
          this.fx.spawn({ frame: 'pillar', x: this.w.x, y: this.w.y + 6, life: 600, s0: 0.6, s1: 1.2, a0: 1, a1: 0, depth: 7000, follow: undefined });
          this.fx.spawn({ frame: 'ring', x: this.w.x, y: this.w.y - 10, life: 500, s0: 0.3, s1: 2.2, a0: 1, a1: 0, tint: 0xffe08a, depth: 7000 });
          break;
        case Ev.Hurt:
          sfx.play('hurt');
          // 被围时每隔一会儿就挨一下，震屏会变成一直抖；改成主角红闪 + 屏幕边缘红晕
          this.d.banners.hurt();
          this.hero.setTint(0xff5a4a);
          this.time.delayedCall(90, () => this.hero.clearTint());
          break;
        case Ev.Chest:
          // 黄历让一个宝箱多升一件：第二件只给一行横幅，不再弹第二次演出
          if (chests++ === 0) this.onChest(ev.a[i]!);
          else this.d.banners.say(`另外 ${this.chestTitle(ev.a[i]!)} 也升了`, 'gold', 1600);
          break;
        case Ev.Evolve:
          break;
        case Ev.Arrive:
          // 夜探里守卫开局就在场上，出场横幅和 Boss 音乐不放（守卫发现主角时由"!"和石兽的预警说话）
          if (!this.raid) this.onArrive(ev.a[i]!);
          break;
        case Ev.GateOpen:
          this.onGateOpen(x, y, ev.a[i]!);
          break;
        case Ev.GateClose:
          this.d.banners.say(`${this.raid!.map.gates[ev.a[i]!]!.name}关了`, 'ink', 1600);
          break;
        case Ev.ChestOpen:
          this.onChestOpen(x, y, ev.b[i]!);
          break;
        case Ev.Loot:
          this.onLoot(x, y, ev.a[i]!, ev.b[i]!);
          break;
        case Ev.Escape:
          sfx.play('extract');
          this.fx.spawn({ frame: 'ring', x, y, life: 700, s0: 0.5, s1: (GATE.r * 2.4) / 128, a0: 1, a1: 0, tint: 0xf2c94c, depth: 6000 });
          this.d.banners.say('撤出了', 'gold', 2400);
          break;
        case Ev.Dawn:
          if (ev.a[i] === 0) this.d.banners.say('还剩 1 分钟天亮', 'warn', 2400, '找到开着的门，撤出去');
          else {
            sfx.play('heartbeat', { volume: 0.8 });
            this.d.banners.say('最后 30 秒', 'warn', 2000, '天亮还在镇里，就迷失了');
          }
          break;
        case Ev.Lost:
          sfx.play('death');
          this.d.banners.say('天亮了 · 没能撤出去', 'warn', 2400);
          break;
        case Ev.Alert:
          this.onAlert(ev.a[i]!, ev.c[i]!);
          break;
        case Ev.Beast:
          this.onBeast(x, y, ev.a[i]!, ev.b[i]!);
          break;
        case Ev.Roamer:
          this.onRoamer(x, y);
          break;
        case Ev.Boss:
          this.onBoss(x, y, ev.a[i]!, ev.b[i]!, ev.c[i]!);
          break;
        case Ev.End:
          if (this.raid) {
            // 夜探：撤出、迷失的提示在 Escape / Lost 里放过了，这里只补倒下的声音
            if (ev.a[i] !== 1 && this.raid.outcome === 'dead') sfx.play('death');
            break;
          }
          sfx.play(ev.a[i] === 1 ? 'dawn' : 'death');
          if (ev.a[i] === 1) this.d.banners.say(ev.b[i] === 1 ? '尸王伏诛 · 天亮了' : '天亮了', 'gold', 2400);
          break;
      }
    }
    // 命中音：一拍最多一个（几百只同时挨打也不吵），暴击单独
    if (hits > 0 && this.now - this.hitSfxAt > 45) {
      sfx.play('hit', { volume: Math.min(1, 0.4 + hits * 0.05) });
      this.hitSfxAt = this.now;
    }
  }

  private onKill(x: number, y: number, code: number, elite: boolean): void {
    const tint = MOB_TINT[code] ?? 0xffffff;
    const big = elite || code === 7;
    const n = LOW_MEMORY ? 4 : big ? 18 : 8;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (big ? 160 : 90) + Math.random() * 90;
      this.fx.spawn({
        frame: 'shard',
        x,
        y: y - 18,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.7 - 80,
        g: 420,
        life: 520 + Math.random() * 220,
        s0: big ? 2.2 : 1.5,
        s1: 0.8,
        a0: 1,
        a1: 0.2,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 18,
        tint,
      });
    }
    this.ground.spawn({ frame: `ink${Math.floor(Math.random() * 3)}`, x, y, life: 2200, s0: big ? 1.6 : 0.7, s1: big ? 1.8 : 0.85, a0: 0.45, a1: 0, rot: Math.random() * 6, ground: true });
    this.burst(x, y - 16, tint, big ? 2 : 0.8);
    sfx.play('kill', { volume: 0.5 });
    // 精英常有，只留一小下顿帧；真正的大怪（code 7）才震屏
    if (big) {
      if (code === 7) this.shake(180, 0.006);
      this.freeze = Math.max(this.freeze, code === 7 ? 90 : 40);
    }
    // 连斩：2 秒内接着杀就一直涨
    if (this.now - this.comboAt > 2000) this.comboN = 0;
    this.comboN++;
    this.comboAt = this.now;
    if (this.comboN >= 10) this.d.hud.setCombo(this.comboN);
    const k = this.w.kills;
    // 里程碑只报跨过的最高一档（一拍里连杀很多时不会一口气弹好几条）
    let hit = 0;
    for (const m of [100, 500, 1000, 2000, 5000]) if (k >= m && this.milestone < m) hit = m;
    if (hit) {
      this.milestone = hit;
      this.d.banners.say(`${hit} 斩`, 'gold', 1500);
    }
  }

  private onPickup(x: number, y: number, kind: number): void {
    if (kind === Drop.Soul) {
      // 连吃音调递增（手感清单第 4 条）；停 0.6 秒以上从头来
      if (this.now - this.pickupAt > 600) this.pickupChain = 0;
      this.pickupAt = this.now;
      this.pickupChain = Math.min(this.pickupChain + 1, 24);
      sfx.play('pickup', { volume: 0.45, pitch: 1 + this.pickupChain * 0.04 });
      this.fx.spawn({ frame: 'mote', x, y, life: 180, s0: 0.8, s1: 0.2, tint: 0x8ff0c8 });
    } else if (kind === Drop.Coin) sfx.play('coin');
    else if (kind === Drop.Bun) {
      sfx.play('heal');
      // 回血数字飘在主角头上（绿色），不占屏幕中间的横幅
      this.nums.show(this.w.x, this.w.y - 70, DROPS.bunHeal, false, 0x5fd38a);
    } else if (kind === Drop.Scroll) {
      sfx.play('pickup', { pitch: 1.6 });
      this.fx.spawn({ frame: 'ring', x: this.w.x, y: this.w.y, life: 600, s0: 0.5, s1: 8, a0: 0.8, a1: 0, tint: 0x8ff0c8, depth: 6000 });
    }
  }

  private chestTitle(code: number): string {
    if (code >= MERGE_CODE) return MERGES[code - MERGE_CODE]!.name;
    if (code >= 100) return PASSIVES[PASSIVE_IDS[code - 100]!].name;
    if (code >= 0) return WEAPONS[WEAPON_IDS[code]!].name;
    return '铜钱';
  }

  private onChest(code: number): void {
    sfx.play('chest');
    const w = this.w;
    let icon = 'coin';
    let title = '铜钱一袋';
    let sub = '铜钱 +40，回 30 点血';
    let evolve = false;
    if (code >= MERGE_CODE) {
      // 合成：比进化更隆重（白闪 + 进化音），空出一个法器格
      const m = MERGES[code - MERGE_CODE]!;
      evolve = true;
      icon = m.icon;
      title = m.name;
      sub = `合成！${m.desc}。空出一个法器格`;
      sfx.play('evolve');
      this.d.banners.whiteFlash();
    } else if (code >= 100) {
      const p = PASSIVES[PASSIVE_IDS[code - 100]!];
      icon = p.icon;
      title = p.name;
      sub = `Lv ${w.passives[p.id] ?? 0} · ${p.text}`;
    } else if (code >= 0) {
      const id = WEAPON_IDS[code]!;
      const o = w.weapons.find((x) => x.id === id);
      const def = WEAPONS[id];
      if (o?.evolved && def.evolve) {
        evolve = true;
        icon = def.evolve.icon;
        title = def.evolve.name;
        sub = `进化！${def.evolve.desc}`;
        sfx.play('evolve');
      } else {
        icon = def.icon;
        title = def.name;
        sub = `升到 Lv ${o?.level ?? 1}`;
      }
    }
    if (this.d.autopilot) return;
    this.hold = 1e9;
    this.d.banners.reveal(this.d.icon(icon), title, sub, evolve, () => {
      this.hold = 0;
      this.d.onChest?.();
    });
  }

  // ───────────────────────── 夜探的事件 ─────────────────────────

  private onGateOpen(x: number, y: number, k: number): void {
    sfx.play('gateOpen');
    this.d.banners.say(`${this.raid!.map.gates[k]!.name}开了`, 'gold', 2600, '站进门圈里 3 秒就能撤出去');
    this.fx.spawn({ frame: 'ring', x, y, life: 900, s0: 0.5, s1: (GATE.r * 2.6) / 128, a0: 1, a1: 0, tint: 0xf2c94c, depth: 60 });
    this.fx.spawn({ frame: 'pillar', x, y, life: 1100, s0: 1, s1: 1.3, a0: 0.9, a1: 0, tint: 0xffe08a, depth: 61 });
  }

  private onChestOpen(x: number, y: number, tier: number): void {
    sfx.play('chest', { volume: 0.8 });
    const tint = tier === 2 ? 0xffd860 : tier === 1 ? 0xffa860 : 0xe8d8b0;
    this.burst(x, y - 10, tint, tier === 2 ? 2 : tier === 1 ? 1.4 : 1);
    this.fx.spawn({ frame: 'ring', x, y, life: 420, s0: 0.3, s1: 1.8 + tier * 0.5, a0: 1, a1: 0, tint, depth: 60 });
    if (tier === 2) this.shake(160, 0.005);
  }

  /** 捡到宝物：图标和名字从箱子上飘起来，颜色按档；一次开出好几件就错开排 */
  private onLoot(x: number, y: number, code: number, tierIdx: number): void {
    const t = TREASURES[code]!;
    const info = TIER_INFO[TIERS[tierIdx]!];
    const hex = `#${info.color.toString(16).padStart(6, '0')}`;
    const n = this.floats.length;
    const f = this.frame(treasureIconKey(t.icon));
    const oy = -64 - n * 30;
    const img = this.add.image(x - 4, y + oy, f.tex ?? 'atlas', f.key).setScale(1.15 / f.res).setDepth(9200);
    const text = this.add
      .text(x + 8, y + oy, t.name, { fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: '20px', fontStyle: 'bold', color: hex, stroke: '#17131c', strokeThickness: 5 })
      .setOrigin(0, 0.5)
      .setResolution(2)
      .setDepth(9200);
    this.floats.push({ img, text, x, y: y + oy, life: 1600 });
    sfx.play('coin', { pitch: 1 + tierIdx * 0.18 });
    this.burst(x, y + oy, info.color, 0.7 + tierIdx * 0.3);
    if (tierIdx === 3) this.d.banners.say(`绝品 · ${t.name}`, 'gold', 2200, t.blurb);
  }

  private onAlert(role: number, slot: number): void {
    const w = this.w;
    if (!w.eAlive[slot]) return;
    if (this.alerts.some((a) => a.slot === slot && a.life > 0)) return;
    const img = this.img('alert', w.eX[slot]!, w.eY[slot]!).setDepth(9300);
    this.alerts.push({ slot, gen: w.eGen[slot]!, life: 1100, img });
    // 铜箱的精英常见，只有巡夜将和石兽才发声
    if (role >= 1) sfx.play('elite', { volume: 0.45 });
  }

  /** 石兽：0 扑击预警（落点）1 扑下 2 甩尾预警 3 甩尾 4 进二段 */
  private onBeast(x: number, y: number, a: number, r: number): void {
    const tick = 1000 / 30;
    if (a === 0) this.telegraphs.push({ x, y, r, life: 0, max: BEAST.pounce.warn * tick, round: true, color: 0xd23a2a });
    else if (a === 2) this.telegraphs.push({ x, y, r, life: 0, max: BEAST.sweep.warn * tick, round: true, color: 0xe27a1a });
    else if (a === 1) {
      sfx.play('bossStomp');
      this.shake(220, 0.01);
      this.freeze = Math.max(this.freeze, 80);
      this.fx.spawn({ frame: 'ring', x, y, life: 500, s0: 0.4, s1: (r * 2.4) / 128, a0: 1, a1: 0, tint: 0x6a7890, depth: 60 });
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2;
        this.fx.spawn({ frame: 'haze', x: x + Math.cos(ang) * r * 0.6, y: y + Math.sin(ang) * r * 0.5, life: 650, s0: 0.6, s1: 1.4, a0: 0.7, a1: 0, tint: 0xc8d0dc });
      }
    } else if (a === 3) {
      sfx.play('bossBreath');
      this.shake(160, 0.007);
      this.fx.spawn({ frame: 'ring', x, y, life: 420, s0: 0.5, s1: (r * 2.2) / 128, a0: 1, a1: 0, tint: 0xe27a1a, depth: 60 });
    } else if (a === 4) {
      sfx.play('boss');
      this.shake(360, 0.008);
      this.d.banners.say('石兽发怒', 'warn', 1800, '扑得更勤，扫得更大');
    }
  }

  /** 游荡的巡夜将出来了：提示它从哪个方向来（相对主角） */
  private onRoamer(x: number, y: number): void {
    const dx = x - this.w.x;
    const dy = y - this.w.y;
    const ew = Math.abs(dx) > Math.abs(dy) * 0.45 ? (dx > 0 ? '东' : '西') : '';
    const ns = Math.abs(dy) > Math.abs(dx) * 0.45 ? (dy > 0 ? '南' : '北') : '';
    sfx.play('elite');
    this.d.banners.say('巡夜将出来了', 'warn', 2200, `从${ns}${ew}边的街上过来，别让它撞见`);
  }

  private onArrive(code: number): void {
    const def = ENEMIES[code]!;
    if (def.boss) {
      sfx.play('boss');
      if (def.kind === 'lord') this.d.banners.say('纸扎老爷来了', 'warn', 2600, '撒纸钱、召纸轿，打倒掉宝箱');
      else this.d.banners.say('尸王来了', 'warn', 2600, '天亮前打倒它，天就提前亮');
      this.shake(400, 0.006);
      music.start('boss');
      this.bossOn = true;
    } else {
      sfx.play('elite');
      const [name, tip] = ELITE_BANNER[def.kind] ?? ['精英', '打倒掉宝箱'];
      this.d.banners.say(name, 'warn', 1600, tip);
    }
  }

  private onBoss(x: number, y: number, a: number, r: number, c: number): void {
    if (a === 4) {
      // 进下一段：吼一声 + 横幅
      const [title, sub] = PHASE_BANNER[ENEMIES[c]!.kind]?.[r] ?? ['', ''];
      sfx.play('boss');
      this.shake(360, 0.008);
      if (title) this.d.banners.say(title, 'warn', 1800, sub);
      return;
    }
    if (a === 5) return sfx.play('bossSummon');
    if (a === 6) return sfx.play('bossBreath');
    if (a === 0) {
      // 跳砸警告：落点一个红圈，越收越紧
      this.telegraphs.push({ x, y, r, life: 0, max: 1000 });
    } else if (a === 1) {
      sfx.play('bossStomp');
      this.shake(260, 0.012);
      this.freeze = Math.max(this.freeze, 100);
      this.fx.spawn({ frame: 'ring', x, y, life: 500, s0: 0.4, s1: (r * 2.4) / 128, a0: 1, a1: 0, tint: 0x8a5a2a, depth: 60 });
      for (let k = 0; k < 14; k++) {
        const ang = (k / 14) * Math.PI * 2;
        this.fx.spawn({ frame: 'haze', x: x + Math.cos(ang) * r * 0.6, y: y + Math.sin(ang) * r * 0.4, life: 700, s0: 0.6, s1: 1.4, a0: 0.7, a1: 0, tint: 0xc8c0b0 });
      }
    } else if (a === 2) sfx.play('bossSummon');
    else sfx.play('bossBreath');
  }

  /** 桃木剑一道斩：半径跟着法器的范围走（主线：月牙半径 ~120 一次两三道），进化后金红色更大 */
  private slash(x: number, y: number, dirIdx: number, r: number, evolved: boolean): void {
    // 斩痕画在主角身后（深度低于主角），满级、进化后范围很大，太实会把主角整个盖住。
    // 等级越高斩痕越长越亮（主线 2b 意见）：外面多一层金色的光，弧再拉长一点
    const o = this.w.weapons.find((x) => x.id === 'sword');
    const k = o ? Math.min(1, (o.evolved ? 9 : o.level) / 8) : 0;
    const scale = r / 72;
    const rot = Math.atan2(SIN[dirIdx]!, COS[dirIdx]!);
    const d = this.renderY - 1;
    const sx = 1 + 0.35 * k;
    const cx = x + COS[dirIdx]! * 6;
    const cy = y - 24 + SIN[dirIdx]! * 6;
    if (k > 0.4) this.fx.spawn({ frame: 'slash', x: cx, y: cy, life: 300, s0: scale * 0.95, s1: scale * 1.35, a0: 0.35 + 0.35 * k, a1: 0, rot: rot - 0.06, sx, tint: evolved ? 0xff5a2a : 0xffd34a, depth: d - 0.5 });
    this.fx.spawn({ frame: 'slash', x: cx, y: cy, life: 220 + 60 * k, s0: scale * 0.8, s1: scale * 1.15, a0: evolved ? 0.85 : 1, a1: 0, rot, sx, tint: evolved ? 0xff8a5a : undefined, depth: d });
    // 第二层：细一点的白锋，晚一点出来，看起来是"刷"的一下
    this.fx.spawn({ frame: 'slash', x: x + COS[dirIdx]! * 10, y: y - 24 + SIN[dirIdx]! * 10, life: 170 + 40 * k, s0: scale * 0.95, s1: scale * 1.2, a0: 0.55 + 0.3 * k, a1: 0, rot: rot + 0.08, sx, tint: 0xffffff, depth: d + 0.5 });
  }

  /** 从 (x0, y0) 到 (x1, y1) 的折线，中间 n 段随机抖 amp */
  private jagged(x0: number, y0: number, x1: number, y1: number, n: number, amp: number): number[] {
    const pts: number[] = [];
    for (let k = 0; k <= n; k++) {
      const j = k > 0 && k < n ? (Math.random() - 0.5) * amp : 0;
      pts.push(x0 + (x1 - x0) * (k / n) + j, y0 + (y1 - y0) * (k / n) + j * 0.4);
    }
    return pts;
  }

  /** 天雷落点；chained：连锁跳过来的那几下不从天上劈（电弧由 Chain 事件画），天雷是常驻法器，不震屏也不顿帧（顿帧会让走位一卡一卡） */
  private thunder(x: number, y: number, r: number, chained = false): void {
    if (!chained) {
      const x0 = x + (Math.random() - 0.5) * 80;
      this.bolts.push({ pts: this.jagged(x0, y - 560, x, y - 20, 10, 46), life: 260 });
    }
    // 落点闪光圈（主线第 1 条）
    this.fx.spawn({ frame: 'ring', x, y, life: 360, s0: 0.2, s1: (r * 2.6) / 128, a0: 1, a1: 0, tint: 0x3a8fe0, depth: 60 });
    this.fx.spawn({ frame: 'haze', x, y: y - 10, life: 260, s0: r / 30, s1: r / 18, a0: 0.9, a1: 0, tint: 0xbfe6ff, depth: 61 });
    this.burst(x, y - 10, 0x55c8ff, chained ? 0.9 : 1.4);
    if (chained) return;
  }

  /** 火葫芦的一口火：沿扇面撒几团火苗往外飞 */
  private flame(x: number, y: number, dirIdx: number, range: number, half: number): void {
    const n = LOW_MEMORY ? 3 : 7;
    for (let k = 0; k < n; k++) {
      const a = Math.atan2(SIN[dirIdx]!, COS[dirIdx]!) + ((Math.random() * 2 - 1) * half * Math.PI * 2) / 256;
      const v = range * (2.2 + Math.random() * 1.2);
      this.fx.spawn({ frame: 'flame', x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 300 + Math.random() * 120, s0: 1, s1: 2.4, a0: 1, a1: 0, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 6 });
    }
  }

  private burst(x: number, y: number, tint: number, size: number): void {
    this.fx.spawn({ frame: 'haze', x, y, life: 220, s0: 0.8 * size, s1: 1.6 * size, a0: 0.8, a1: 0, tint });
    if (LOW_MEMORY) return;
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 * size + Math.random() * 60;
      this.fx.spawn({ frame: 'mote', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 260, s0: 0.6 * size, s1: 0.1, tint });
    }
  }

  private spark(x: number, y: number, tint: number, size: number): void {
    if (LOW_MEMORY) return;
    this.fx.spawn({ frame: 'spark', x, y, life: 200, s0: size * 1.6, s1: 0.2, tint, rot: Math.random() });
  }

  // ───────────────────────── 每帧画 ─────────────────────────

  private draw(dt: number): void {
    const w = this.w;
    const alpha = Math.min(1, this.acc / TICK_MS);
    const inter = (p: number, c: number): number => p + (c - p) * alpha;
    // 主角：始终在核心给的上一拍和这一拍之间插值，和怪、弹幕同一套时间轴。
    // 以前移动时用"预测"（现在的输入往前推）、停下时用插值，起停那一帧两套结果差约一拍，看上去一顿一跳；
    // 代价是比输入晚最多一拍（33 ms），换整条运动曲线连续
    const moving = !this.paused && !this.d.cards.open && this.freeze <= 0 && this.hold <= 0 && w.phase === 'play';
    const dir = moving ? (this.d.autopilot ? 0 : this.d.input.dir()) : 0;
    const slowed = w.tick < w.slowUntil;
    this.renderX = inter(w.px, w.x);
    this.renderY = inter(w.py, w.y);
    const hx = this.renderX;
    const hy = this.renderY;
    const walking = w.moving || dir !== 0;
    if (walking && moving) this.walk += dt * 0.012;
    const bob = walking ? Math.abs(Math.sin(this.walk)) : 0;
    const f = this.frame('hero');
    const face = COS[w.face]! < -0.1 ? -1 : COS[w.face]! > 0.1 ? 1 : this.hero.scaleX < 0 ? -1 : 1;
    // 走路基本是平移：只留不到 1 像素的起伏和极小的挤压，当脚步感（幸存者类走位多，大幅上下晃会让人觉得在抖）
    const sx = (1 / f.res) * (1 + (1 - bob) * 0.012 * (walking ? 1 : 0)) * face;
    const sy = (1 / f.res) * (1 - (walking ? (1 - bob) * 0.012 - bob * 0.008 : Math.sin(this.now * 0.004) * 0.015));
    const blink = w.invuln > 0 && Math.floor(this.now / 60) % 2 === 0;
    this.hero.setPosition(hx, hy - bob * 0.8).setScale(sx, sy).setRotation(0).setDepth(hy).setAlpha(blink ? 0.5 : 1);
    this.heroBack.setPosition(hx, hy - bob * 0.8 + 1).setScale(sx * 1.07, sy * 1.05).setRotation(this.hero.rotation).setDepth(hy - 0.1).setAlpha(this.hero.alpha);
    this.heroShadow.setPosition(hx, hy).setDepth(-400);
    // 被冰锥、水鬼拖慢：脚下冒冰屑
    if (slowed && !LOW_MEMORY && (this.frost += dt) > 90) {
      this.frost = 0;
      this.fx.spawn({ frame: 'mote', x: hx + (Math.random() - 0.5) * 30, y: hy - 4, vy: -30, life: 420, s0: 1.2, s1: 0.2, tint: 0x8fd0f0, rot: 0 });
    }
    if (w.shield > 0) {
      const sf = this.frame('goldbell');
      this.shieldImg
        .setVisible(true)
        .setPosition(hx, hy + 8)
        .setScale((0.95 + Math.sin(this.now * 0.004) * 0.03) / sf.res)
        .setAlpha(0.28 + 0.08 * Math.min(3, w.shield))
        .setDepth(hy + 1);
    } else this.shieldImg.setVisible(false);
    this.aura.setPosition(hx, hy).setDepth(-450).setAlpha(0.75 + Math.sin(this.now * 0.004) * 0.15);
    // 脚印：走着的时候每隔一段在身后留一个
    if (walking && moving) {
      this.stepAcc += dt;
      if (this.stepAcc > 170) {
        this.stepAcc = 0;
        this.footSide = -this.footSide;
        const px = -SIN[w.face]! * 6 * this.footSide;
        const py = COS[w.face]! * 4 * this.footSide;
        this.ground.spawn({ frame: 'footprint', x: hx + px, y: hy + py + 2, life: 3200, a0: 0.8, a1: 0, rot: Math.atan2(SIN[w.face]!, COS[w.face]!), ground: true });
      }
    }
    // 镜头：紧跟主角（幸存者类的标准做法）。以前每帧追 15% 并朝面向方向前瞻 40px：追的快慢跟帧率有关，
    // 转向时前瞻点一跳镜头就荡一下；主角本身已经按拍插值，镜头直接钉在他身上，屏幕上主角就不会晃
    this.cameras.main.centerOn(hx, hy - 20);

    this.gfx.clear();
    this.waves.length = 0;
    this.petalMarks.length = 0;
    this.drawMobs(inter, dt);
    this.drawShots(inter);
    this.drawDrops(inter);
    if (this.raid) this.drawRaid(dt);
    this.drawGfx(dt);
    this.fx.update(dt);
    this.ground.update(dt);
    this.nums.update(dt);
    this.drawHud();
  }

  private drawMobs(inter: (p: number, c: number) => number, dt: number): void {
    const w = this.w;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      let m = this.mobs[i];
      if (!w.eAlive[i]) {
        if (m && m.img.visible) {
          m.img.setVisible(false);
          m.shadow.setVisible(false);
          m.glow?.setVisible(false);
        }
        continue;
      }
      const code = w.eKind[i]!;
      if (!m || m.gen !== w.eGen[i] || m.kind !== code) m = this.mobs[i] = this.dressMob(i, m ?? null);
      const def = ENEMIES[code]!;
      const x = inter(w.ePX[i]!, w.eX[i]!);
      const y = inter(w.ePY[i]!, w.eY[i]!);
      let lift = 0;
      if (def.kind === 'jiangshi' || def.kind === 'general') {
        const t = w.eT[i]! % HOP_PERIOD;
        lift = t < HOP_AIR ? Math.sin((t / HOP_AIR) * Math.PI) * (def.kind === 'general' ? 16 : 11) : 0;
      } else if (def.kind === 'wisp' || def.kind === 'lantern') lift = 8 + Math.sin(this.now * 0.005 + i) * 4;
      else if (def.kind === 'bat') lift = 14 + Math.sin(this.now * 0.02 + i * 2.3) * 5;
      else if (def.kind === 'boss' && w.eS[i] === 1) lift = Math.sin((1 - w.eT[i]! / 30) * Math.PI) * 120;
      // 水鬼从地里冒出来：先沉在地下，慢慢升上来
      const sink = code === WATER_CODE && w.eT[i]! > 0 ? w.eT[i]! / WATER.emerge : 0;
      if (sink > 0) lift = -sink * 34;
      const size = w.eSize[i]!;
      const flip = this.renderX < x ? -1 : 1;
      // 被捆住的发抖
      const bound = w.eBind[i]! > w.tick;
      // 走路的小动作：纸人晃、落地压扁
      const wob = def.kind === 'paper' ? Math.sin(this.now * 0.012 + i * 1.7) * 0.06 : 0;
      const squash = lift === 0 && (def.kind === 'jiangshi' || def.kind === 'general') ? 0.94 : 1;
      m.img
        .setPosition(x + (bound ? Math.sin(this.now * 0.09 + i) * 1.8 : 0), y - lift)
        .setScale((flip * size * (2 - squash)) / m.res, (size * squash) / m.res)
        .setRotation(wob)
        .setAlpha(1 - sink * 0.75)
        .setDepth(y);
      if (m.flash > 0) {
        m.flash -= dt;
        m.img.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        if (m.flash <= 0) m.img.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      }
      const sf = this.frames.get('shadow')!;
      m.shadow.setPosition(x, y).setScale(((w.eR[i]! / 20) * (1 - Math.min(0.5, lift * 0.004))) / sf.res).setDepth(-400);
      if (m.glow) m.glow.setPosition(x, y - lift - w.eR[i]! * 1.4).setDepth(y - 1).setAlpha(def.elite || def.boss ? 0.5 + Math.sin(this.now * 0.006) * 0.12 : 0.4);
    }
    // Boss 血条
    const b = w.bossSlot;
    if (this.raid) {
      // 夜探：只有镇门石兽有血条，主角走近了（它在追或要扑）才亮
      const near = b >= 0 && !!w.eAlive[b] && w.phase !== 'over' && ENEMIES[w.eKind[b]!]!.kind === 'beast' && (w.eX[b]! - w.x) ** 2 + (w.eY[b]! - w.y) ** 2 < 640 * 640;
      if (near) this.d.banners.setBoss('镇门石兽', w.eHp[b]! / w.eHpMax[b]!);
      if (near !== this.bossShown) {
        this.bossShown = near;
        if (!near) this.d.banners.setBoss(null);
      }
    } else if (b >= 0 && w.eAlive[b] && w.phase !== 'over') this.d.banners.setBoss(ENEMIES[w.eKind[b]!]!.kind === 'lord' ? '纸扎老爷' : '尸王', w.eHp[b]! / w.eHpMax[b]!);
    else if (this.bossOn) {
      this.d.banners.setBoss(null);
      this.bossOn = false;
      // 纸扎老爷倒了：换回夜里的音乐
      if (w.phase === 'play') music.start('night');
    }
  }

  private dressMob(i: number, old: MobView | null): MobView {
    const code = this.w.eKind[i]!;
    const def = ENEMIES[code]!;
    const key = MOB_FRAME[code]!;
    const f = this.frame(key);
    const img = old?.img ?? this.add.image(0, 0, f.tex ?? 'atlas', f.key);
    img.setTexture(f.tex ?? 'atlas', f.key).setOrigin(f.ox, f.oy).setVisible(true).clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    // 没画好专属造型的怪先用相近的图换个颜色
    if (!this.frames.has(key)) img.setTint(MOB_TINT[code]!);
    const shadow = old?.shadow ?? this.img('shadow');
    shadow.setVisible(true).setAlpha(0.8);
    let glow = old?.glow ?? null;
    const glowTint = def.elite || def.boss ? 0xa050ff : def.kind === 'lantern' ? 0xff8a3a : def.kind === 'wisp' ? 0x5fd3f0 : null;
    if (glowTint !== null) {
      glow ??= this.img('haze');
      const hf = this.frames.get('haze')!;
      glow.setVisible(true).setTint(glowTint).setScale((def.elite || def.boss ? 2.6 : 1.1) / hf.res);
    } else glow?.setVisible(false);
    return { gen: this.w.eGen[i]!, img, shadow, glow, res: f.res, flash: 0, kind: code };
  }

  private drawShots(inter: (p: number, c: number) => number): void {
    const w = this.w;
    for (let i = 0; i < MAX_SHOTS; i++) {
      let s = this.shots[i];
      if (!w.sAlive[i]) {
        if (s?.img.visible) s.img.setVisible(false);
        continue;
      }
      const kind = w.sKind[i]!;
      const key = kind === Shot.Fireball && w.sState[i] !== 0 ? (w.sState[i] === 1 ? 'ice' : 'money') : (SHOT_FRAME[kind] ?? 'fireball');
      if (!s || s.gen !== w.sGen[i]) {
        const f = this.frame(key);
        const img = s?.img ?? this.add.image(0, 0, 'atlas', f.key);
        img.setFrame(f.key).setOrigin(f.ox, f.oy).setVisible(true).clearTint();
        const sc = kind === Shot.Talisman ? 1.25 : kind === Shot.Coin ? 1.3 : kind === Shot.Fly ? 1.1 : kind === Shot.Petal ? 3 : kind === Shot.Crane ? (w.sIdx[i]! >= 1000 ? 0.8 : 1.3) : kind === Shot.Burn ? 1.6 : 1.2;
        img.setScale(sc / f.res);
        if (key === 'fireball' && !this.frames.has('fireball')) img.setTint(0x7a3aa0);
        // 光波不用图，画在 Graphics 上（drawGfx）
        img.setVisible(kind !== Shot.Wave);
        s = this.shots[i] = { gen: w.sGen[i]!, img, trail: 0 };
      }
      const x = inter(w.sPX[i]!, w.sX[i]!);
      const y = inter(w.sPY[i]!, w.sY[i]!);
      if (kind === Shot.Wave) {
        // 太极镜：单号白、双号黑
        if (w.sR[i]! > 0) this.waves.push(x, y, w.sR[i]!, w.sDist[i]!, w.sState[i] === 1 ? 1 + (w.sIdx[i]! & 1) : 0);
        continue;
      }
      s.img.setPosition(x, y).setDepth(y + 40);
      if (kind === Shot.Fireball && w.sState[i] === 1) s.img.setRotation(Math.atan2(w.sVY[i]!, w.sVX[i]!));
      else if (kind === Shot.Fireball && w.sState[i] === 2) s.img.rotation += 0.12;
      if (kind === Shot.Talisman) {
        s.img.rotation += 0.35;
        if (!LOW_MEMORY && ++s.trail % 2 === 0) this.fx.spawn({ frame: 'mote', x, y, life: 320, s0: 1.1, s1: 0.2, tint: 0xffb42e, rot: Math.random() * 3 });
      } else if (kind === Shot.Coin) {
        s.img.rotation += 0.25;
        if (!LOW_MEMORY && ++s.trail % 3 === 0) this.fx.spawn({ frame: 'coin', x, y, life: 160, s0: 1.1, s1: 0.9, a0: 0.4, a1: 0 });
      } else if (kind === Shot.Fly) {
        const st = w.sState[i]!;
        const vx = st === 0 ? 0 : w.sVX[i]!;
        const vy = st === 0 ? -1 : w.sVY[i]!;
        // 剑尖朝飞的方向（图是剑尖朝上）；待命时微微晃
        s.img.setRotation(st === 0 ? Math.sin(this.now * 0.005 + i) * 0.2 : Math.atan2(vy, vx) + Math.PI / 2);
        if (st !== 0 && !LOW_MEMORY) this.fx.spawn({ frame: 'flysword', x, y, life: 140, s0: 1.1, s1: 1, a0: 0.35, a1: 0, rot: s.img.rotation, tint: 0x9fd8ff });
      } else if (kind === Shot.Burn) {
        // 地上的火：贴地、一跳一跳，快灭时淡出
        const f = this.frame('burn');
        s.img
          .setDepth(y - 30)
          .setScale((1.5 + Math.sin(this.now * 0.03 + i) * 0.1) / f.res, (1.6 + Math.sin(this.now * 0.04 + i * 2) * 0.15) / f.res)
          .setAlpha(Math.min(1, w.sLife[i]! / 20));
      } else if (kind === Shot.Petal) {
        // 从上面飘下来：还剩几拍就离地多高，边落边转
        const left = w.sLife[i]!;
        s.img.setPosition(x + Math.sin(left * 0.7 + i) * 6, y - left * 12).setRotation(left * 0.4 + i).setDepth(y + 40);
        // 地上先亮一圈粉色落点，落地时再迸一小撮花瓣：雪地上也看得见
        this.petalMarks.push(x, y, 1 - Math.min(1, left / 14));
        if (!LOW_MEMORY && left <= 1 && s.trail === 0) {
          s.trail = 1;
          for (let k = 0; k < 4; k++) this.fx.spawn({ frame: 'petal', x, y: y - 4, vx: (Math.random() - 0.5) * 200, vy: -70 - Math.random() * 70, g: 320, life: 460, s0: 1.8, s1: 0.8, rot: Math.random() * 6, spin: 9 });
        }
      } else if (kind === Shot.Crane) {
        const dx = w.sX[i]! - w.sPX[i]!;
        if (Math.abs(dx) > 0.3) s.img.setFlipX(dx < 0);
        const diving = w.sState[i] === 1;
        s.img.setRotation(diving ? Math.atan2(w.sVY[i]!, Math.abs(w.sVX[i]!)) * (dx < 0 ? -1 : 1) * 0.6 : Math.sin(this.now * 0.006 + i) * 0.12).setDepth(y + 200);
        if (diving && !LOW_MEMORY && ++s.trail % 2 === 0) this.fx.spawn({ frame: 'crane', x, y, life: 160, s0: 1.3, s1: 1.2, a0: 0.3, a1: 0, sx: s.img.flipX ? -1 : 1, tint: 0xbfd8ff });
      } else {
        s.img.setScale((1.2 + Math.sin(this.now * 0.02 + i) * 0.15) / this.frame('fireball').res);
      }
    }
  }

  private drawDrops(inter: (p: number, c: number) => number): void {
    const w = this.w;
    for (let i = 0; i < MAX_DROPS; i++) {
      let d = this.drops[i];
      if (!w.dAlive[i]) {
        if (d?.img.visible) d.img.setVisible(false);
        continue;
      }
      const kind = w.dKind[i]!;
      const v = w.dVal[i]!;
      const key = kind === Drop.Soul ? (v >= 5 ? 'bead3' : v >= 2 ? 'bead2' : 'bead1') : kind === Drop.Coin ? 'coin' : kind === Drop.Bun ? 'bun' : kind === Drop.Scroll ? 'scroll' : 'chest';
      // 魂珠比怪小一号、颜色淡，不抢眼；超过上限并成的大珠（经验 ≥ 20）放大、一闪一闪，看得出值得去捡
      const big = kind === Drop.Soul && v >= 20;
      const sc = kind === Drop.Chest ? 1.2 : kind === Drop.Soul ? (big ? 1.5 : 0.75) : 1;
      if (!d || d.gen !== w.dGen[i] || d.kind !== kind || d.key !== key || d.big !== big) {
        const f = this.frame(key);
        const img = d?.img ?? this.add.image(0, 0, 'atlas', f.key);
        img.setFrame(f.key).setOrigin(f.ox, f.oy).setVisible(true).setScale(sc / f.res);
        d = this.drops[i] = { gen: w.dGen[i]!, img, kind, key, big };
      }
      if (big) d.img.setScale((sc + Math.sin(this.now * 0.008 + i) * 0.12) / this.frame(key).res);
      const x = inter(w.dPX[i]!, w.dX[i]!);
      const y = inter(w.dPY[i]!, w.dY[i]!);
      d.img.setPosition(x, y + (kind === Drop.Chest ? 0 : Math.sin(this.now * 0.006 + i) * 2)).setDepth(kind === Drop.Chest ? y : -300 + y * 0.0001);
    }
  }

  /** 夜探每帧要画的：门（换图、光圈）、开过的宝箱、搜箱和撤离的读条、撤离指引（脚印、屏幕边的箭头）、"!"、飘字 */
  private drawRaid(dt: number): void {
    const raid = this.raid!;
    const w = this.w;
    const rg = this.rg;
    const g = this.gfx;
    rg.clear();
    // 宝箱：开了就换成开着的图，光晕收掉
    raid.map.chests.forEach((c, i) => {
      const v = this.chestViews[i]!;
      const open = raid.chestOpen[i] === 1;
      if (open !== v.open) {
        v.open = open;
        v.img.setFrame(`chest_${c.tier}${open ? '_open' : ''}`);
        v.glow?.setVisible(false);
      } else if (!open && v.glow) v.glow.setAlpha(0.45 + Math.sin(this.now * 0.004 + i) * 0.15);
    });
    // 门：开着的门发光，圈里站着读条
    raid.map.gates.forEach((gt, k) => {
      const v = this.gateViews[k]!;
      const open = raid.gateOpen[k] === 1;
      if (open !== v.open) {
        v.open = open;
        v.img.setFrame(open ? 'gate_open' : 'gate_closed');
        v.glow.setVisible(open);
      }
      if (open) {
        const pulse = 0.5 + 0.5 * Math.sin(this.now * 0.005 + k);
        rg.fillStyle(0xffd860, 0.24 + pulse * 0.12);
        rg.fillCircle(gt.x, gt.y, GATE.r);
        rg.lineStyle(9, 0x17131c, 0.55);
        rg.strokeCircle(gt.x, gt.y, GATE.r);
        rg.lineStyle(5, 0xe8a820, 1);
        rg.strokeCircle(gt.x, gt.y, GATE.r);
        v.glow.setAlpha(0.5 + pulse * 0.25);
      } else {
        rg.fillStyle(0x4a5060, 0.08);
        rg.fillCircle(gt.x, gt.y, GATE.r);
        rg.lineStyle(4, 0x4a5060, 0.3);
        rg.strokeCircle(gt.x, gt.y, GATE.r);
      }
    });
    // 撤离读条：门圈里一圈金色，主角头上一条
    const hx = this.renderX;
    const hy = this.renderY;
    const ep = raid.exitProgress();
    if (ep > 0 && raid.exitGate >= 0) {
      const gt = raid.map.gates[raid.exitGate]!;
      g.lineStyle(14, 0x17131c, 0.9);
      g.beginPath();
      g.arc(gt.x, gt.y, GATE.r - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ep);
      g.strokePath();
      g.lineStyle(8, 0xffd23a, 1);
      g.beginPath();
      g.arc(gt.x, gt.y, GATE.r - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ep);
      g.strokePath();
      this.progressBar(hx, hy - 84, ep, 0xffd23a);
    }
    // 搜箱读条
    const sp = raid.searchProgress();
    if (sp > 0 && raid.searchChest >= 0) {
      const c = raid.map.chests[raid.searchChest]!;
      this.progressBar(c.x, c.y - 56, sp, c.tier === 'gold' ? 0xffd23a : c.tier === 'copper' ? 0xff9a3a : 0xf0e0b0);
    }
    // 撤离指引：每 4 帧重算一次（最短路场按开着的门缓存），脚印画在地上，门在屏幕外时边上一个箭头
    if (raid.outcome === 'none') {
      if (this.gdMask !== raid.gateMask || this.now - this.gdAt > 120) {
        this.gdMask = raid.gateMask;
        this.gdAt = this.now;
        guide(raid, w.x, w.y, this.gd);
      }
      const gd = this.gd;
      for (let i = 0; i < gd.trailN; i++) {
        const t = 1 - i / (gd.trailN + 2);
        g.fillStyle(0x17131c, 0.55 * t);
        g.fillCircle(gd.trail[i * 2]!, gd.trail[i * 2 + 1]!, 8);
        g.fillStyle(0xffd23a, 0.95 * t);
        g.fillCircle(gd.trail[i * 2]!, gd.trail[i * 2 + 1]!, 5);
      }
      const cam = this.cameras.main;
      const cssW = this.scale.displaySize.width;
      const cssH = this.scale.displaySize.height;
      const k = cssW / (cam.width / cam.zoom);
      const gate = gd.gate >= 0 ? raid.map.gates[gd.gate]! : null;
      const arrow = gate ? edgeArrow(raid, gd, (gate.x - cam.midPoint.x) * k, (gate.y - cam.midPoint.y) * k, cssW, cssH, 84) : null;
      this.d.hud.setArrow(arrow && !arrow.onScreen ? arrow : null);
    } else this.d.hud.setArrow(null);
    // 守卫头上的"!"
    for (const a of this.alerts) {
      a.life -= dt;
      const i = a.slot;
      if (a.life <= 0 || !w.eAlive[i] || w.eGen[i] !== a.gen) {
        a.life = 0;
        a.img.destroy();
        continue;
      }
      const born = Math.min(1, (1100 - a.life) / 140);
      const f = this.frame('alert');
      a.img.setPosition(w.eX[i]!, w.eY[i]! - w.eR[i]! * 2.4 - 28 - Math.sin(this.now * 0.02) * 2).setScale((1.1 * (0.4 + 0.6 * born)) / f.res).setAlpha(Math.min(1, a.life / 250));
    }
    this.alerts = this.alerts.filter((a) => a.life > 0);
    // 捡到宝物的飘字
    for (const fl of this.floats) {
      fl.life -= dt;
      const t = 1 - fl.life / 1600;
      const y = fl.y - t * 46;
      const al = fl.life < 400 ? Math.max(0, fl.life / 400) : 1;
      fl.img.setPosition(fl.x - 4 - fl.text.width / 2 - 8, y).setAlpha(al);
      fl.text.setPosition(fl.x - fl.text.width / 2 + 8, y).setAlpha(al);
      if (fl.life <= 0) {
        fl.img.destroy();
        fl.text.destroy();
      }
    }
    this.floats = this.floats.filter((fl) => fl.life > 0);
  }

  /** 头上或箱子上的读条：深色边、金色（或档色）填充 */
  private progressBar(x: number, y: number, p: number, color: number): void {
    const g = this.gfx;
    const wd = 64;
    g.fillStyle(0x17131c, 0.9);
    g.fillRoundedRect(x - wd / 2 - 4, y - 8, wd + 8, 16, 6);
    g.fillStyle(0x4a4350, 1);
    g.fillRoundedRect(x - wd / 2, y - 4, wd, 8, 3);
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - wd / 2, y - 4, Math.max(2, wd * p), 8, 3);
  }

  private drawGfx(dt: number): void {
    const g = this.gfx;
    // 八卦镜的光波：深靛外圈 + 亮青内圈，越往外越淡
    const wv = this.waves;
    for (let k = 0; k < wv.length; k += 5) {
      const a = Math.max(0.35, 1 - wv[k + 2]! / wv[k + 3]!);
      const style = wv[k + 4]!;
      const [edge, core] = style === 1 ? [0x17131c, 0x6a6470] : style === 2 ? [0x17131c, 0xffffff] : [0x1f3a78, 0x7fe0ff];
      const r = wv[k + 2]!;
      // 里面铺一层淡色，圈本身加粗：雪地上静帧里也要一眼看见
      g.fillStyle(core, a * 0.16);
      g.fillCircle(wv[k]!, wv[k + 1]!, r);
      g.lineStyle(16, edge, a * 0.8);
      g.strokeCircle(wv[k]!, wv[k + 1]!, r);
      g.lineStyle(8, core, a);
      g.strokeCircle(wv[k]!, wv[k + 1]!, r);
      g.lineStyle(2.5, 0xffffff, a * 0.9);
      g.strokeCircle(wv[k]!, wv[k + 1]!, r - 2);
    }
    // 桃花雨的落点：粉圈 + 深玫瑰边，越近越实
    const pm = this.petalMarks;
    for (let k = 0; k < pm.length; k += 3) {
      const t = pm[k + 2]!;
      g.fillStyle(0xff8fb8, 0.2 + t * 0.35);
      g.fillEllipse(pm[k]!, pm[k + 1]!, 34 + t * 14, 20 + t * 8);
      g.lineStyle(3, 0xb8325f, 0.45 + t * 0.4);
      g.strokeEllipse(pm[k]!, pm[k + 1]!, 34 + t * 14, 20 + t * 8);
    }
    pm.length = 0;
    // 缚妖索：金绳加墨边，一串连起来
    for (const r of this.ropes) {
      r.life -= dt;
      const a = Math.min(1, r.life / 200);
      for (const [wd, c] of [[7, 0x17131c], [3.5, 0xf2c94c]] as const) {
        g.lineStyle(wd, c, a);
        g.beginPath();
        g.moveTo(r.pts[0]!, r.pts[1]!);
        for (let k = 2; k < r.pts.length; k += 2) g.lineTo(r.pts[k]!, r.pts[k + 1]!);
        g.strokePath();
      }
    }
    this.ropes = this.ropes.filter((r) => r.life > 0);
    // 闪电：外面深靛蓝、中间亮蓝、白芯（雪地上要有深色边才看得见）
    for (const b of this.bolts) {
      b.life -= dt;
      const a = Math.max(0, b.life / 260);
      for (const [wd, c] of [[10, 0x23306a], [5.5, 0x55c8ff], [2.2, 0xffffff]] as const) {
        g.lineStyle(wd, c, a);
        g.beginPath();
        g.moveTo(b.pts[0]!, b.pts[1]!);
        for (let k = 2; k < b.pts.length; k += 2) g.lineTo(b.pts[k]!, b.pts[k + 1]!);
        g.strokePath();
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    // 尸王跳砸的落点：红圈，越收越紧
    for (const t of this.telegraphs) {
      t.life += dt;
      const k = Math.min(1, t.life / t.max);
      const col = t.color ?? 0xd23a2a;
      if (t.round) {
        // 石兽的圈按真实的受击范围画成正圆；外圈深色边，里面从圆心往外涨满就是落下的时候
        g.fillStyle(col, 0.06);
        g.fillCircle(t.x, t.y, t.r);
        g.lineStyle(9, 0x17131c, 0.6);
        g.strokeCircle(t.x, t.y, t.r);
        g.lineStyle(5, col, 0.95);
        g.strokeCircle(t.x, t.y, t.r);
        g.fillStyle(col, 0.1 + k * 0.2);
        g.fillCircle(t.x, t.y, t.r * k);
        continue;
      }
      g.lineStyle(4, 0xd23a2a, 0.9);
      g.strokeEllipse(t.x, t.y, t.r * 2, t.r * 1.3);
      g.fillStyle(0xd23a2a, 0.12 + k * 0.2);
      g.fillEllipse(t.x, t.y, t.r * 2 * k, t.r * 1.3 * k);
    }
    this.telegraphs = this.telegraphs.filter((t) => t.life < t.max);
  }

  private drawHud(): void {
    const w = this.w;
    const slots: HudSlot[] = w.weapons.map((o, k) => {
      const s = w.wstats[k]!;
      const cd = Math.max(4, Math.round(s.cd * w.stats.cdMul));
      return { icon: weaponLook(w, o).icon, level: o.evolved ? 9 : o.level, cd: o.id === 'flysword' || o.id === 'coins' || o.id === 'crane' || o.id === 'shield' ? 1 : Math.max(0, Math.min(1, 1 - o.timer / cd)) };
    });
    const raid = this.raid;
    this.d.hud.update({
      hp: Math.max(0, w.hp),
      hpMax: w.stats.hpMax,
      shield: w.shield,
      shieldMax: w.shieldMax,
      level: w.level,
      xp: w.xp / xpNeed(w.level),
      left: ((raid ? RAID_DAWN : DAWN_TICK) - w.tick) / 30,
      raid: raid ? { label: w.tick >= DAWN_WARN ? '天亮' : '离天亮', level: w.tick >= DAWN_RED ? 2 : w.tick >= DAWN_WARN ? 1 : 0, bag: raid.bag.length } : undefined,
      kills: w.kills,
      coins: w.coins,
      slots,
      passives: PASSIVE_IDS.filter((id) => w.passives[id] !== undefined).map((id) => ({ icon: PASSIVES[id].icon, level: w.passives[id]! })),
    });
    // 低血：屏幕边红框 + 心跳（手感清单第 9 条）
    // 夜探最后 30 秒也用这层红框和心跳催人
    const low = ((w.hp > 0 && w.hp < w.stats.hpMax * 0.3) || (raid !== null && raid.outcome === 'none' && w.tick >= DAWN_RED)) && w.phase === 'play' && !this.paused;
    this.d.banners.setLow(low);
    if (low && this.now - this.lowBeat > 1000) {
      sfx.play('heartbeat', { volume: 0.7 });
      this.lowBeat = this.now;
    }
    // 音乐随时间加层：每 4 分钟一层
    const minute = Math.floor(w.tick / 1800);
    if (minute !== this.lastMinute) {
      this.lastMinute = minute;
      if (!this.bossOn) music.setIntensity(Math.min(3, Math.floor(minute / 4)) as 0 | 1 | 2 | 3);
    }
  }
}
