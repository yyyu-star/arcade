/**
 * 守夜的对局画面（DESIGN.md 5.3）：
 * - 核心按每秒 30 拍走（累加真实时间，一帧可能走 0–3 拍），画面每帧在两拍之间插值；
 * - 主角本地预测：摇杆一动，主角的画面位置当帧就按新方向挪（手感验收 ②），核心下一拍算出来的位置自然接上；
 * - 打击停顿（hit-stop）只是暂停送拍，核心照样按拍走，不影响确定性；
 * - 怪、子弹、掉落按槽位一一对应一个精灵，槽位的 gen 变了就是换了一只，重设外观。
 * 画面只读核心的状态和事件（w.ev），不自己算规则。
 */
import Phaser from 'phaser';
import { DROWN, ENEMIES, HOP_AIR, HOP_PERIOD, SPROUT, WATER } from '../../content/enemies.ts';
import { CHARACTERS } from '../../content/meta.ts';
import { ARENA, DROPS, xpNeed } from '../../content/player.ts';
import { inRects, MAPS, type MapDef } from '../../content/maps.ts';
import { BEAST, DAWN_RED, DAWN_WARN, GATE, RAID_DAWN } from '../../content/explore.ts';
import { TIERS, TIER_INFO, TREASURES } from '../../content/treasures.ts';
import { edgeArrow, walkSecs } from '../../explore/view/guide-hud.ts';
import { guide, newGuide } from '../../explore/guide.ts';
import { Role, type Raid } from '../../explore/raid.ts';
import { DAWN_TICK } from '../../content/waves.ts';
import { MERGES, PASSIVE_IDS, PASSIVES, WEAPON_IDS, WEAPONS } from '../../content/weapons.ts';
import { Drop, Ev, MAX_DROPS, MAX_ENEMIES, MAX_SHOTS, MERGE_CODE, Shot, step, type World } from '../../core/index.ts';
import { COS, SIN } from '../../core/dirs.ts';
import { HERO_TEX, MOB_TEX, RAID_TEX, makeIcons, peekHeroAtlas, type Atlas, type Frame } from '../art/atlas.ts';
import { faceKey, heroKey } from '../art/heroes.ts';
import { artRng } from '../art/draw.ts';
import { BAMBOO_VARIANTS, BAMBOO_WIDTHS, bambooCanvas, bambooKey, GROUND_TINT, paintTerrain, stumpCanvas } from '../art/terrain.ts';
import { treasureIconKey } from '../art/sprites8.ts';
import { MOB_COLOR } from '../art/sprites.ts';
import { music } from '../audio/music.ts';
import { sfx, type SfxName } from '../audio/sfx.ts';
import type { Banners } from '../ui/banner.ts';
import { Cards, describe } from '../ui/cards.ts';
import type { Hud, HudSlot } from '../ui/hud.ts';
import { RaidHud } from '../ui/raidhud.ts';
import { LOW_MEMORY } from '../viewport.ts';
import { DamageNumbers, Fx } from './fx.ts';
import { Items } from './items.ts';
import { weaponLook } from './look.ts';
import { Town } from './town.ts';
import type { Input } from './input.ts';

const TICK_MS = 1000 / 30;
/** 只在 dev 构建里认 ?slowmo=N（截图预览用），正式构建恒为 1 */
const SLOWMO = import.meta.env.DEV ? Math.max(1, Number(new URLSearchParams(location.search).get('slowmo') ?? 1) || 1) : 1;

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
  // 宝妖（金黄）
  0xf2b930,
  // 各地区的特色怪（编号 21 起）：竹精、蛇精、竹王、溺鬼、河蟹、河伯、冰傀、冰凌、冰魄、更夫鬼、石僧
  0x7fc45a, 0x5faa3e, 0x4a8f3a, 0x8c8676, 0xa48c6c, 0x7c9488, 0xbfe6fa, 0xeaf8ff, 0xdff3ff, 0x46598c, 0xb4b8bf,
];
/** 精英出场的横幅：名字 + 一句怎么打 */
const ELITE_BANNER: Partial<Record<string, [string, string]>> = {
  shishi: ['石狮怪', '刀剑砍不动，用符和铃'],
  general: ['跳尸将军', '会召小跳尸，打倒掉宝箱'],
  whitefox: ['白狐', '连冲三下，看准了躲'],
  palanquin: ['纸轿', '打碎会放出一群纸人'],
  bambooking: ['竹王', '隔一阵在你四周种出竹精，看地上的绿圈'],
  hebo: ['河伯', '涨潮放出一圈水弹，还会放溺鬼'],
  frostsoul: ['冰魄', '蓄力后震出寒霜圈，躲出圈外'],
};
const WATER_CODE = ENEMIES.findIndex((e) => e.kind === 'water');
const SPROUT_CODE = ENEMIES.findIndex((e) => e.kind === 'bamsprout');
const DROWN_CODE = ENEMIES.findIndex((e) => e.kind === 'drown');
const SNAKE_CODE = ENEMIES.findIndex((e) => e.kind === 'snakespirit');
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
  /** 各地区特色怪的图集（buildMobAtlas），守夜、夜探都要 */
  mobAtlas: Atlas;
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
  /** 开局头上冒一次的台词气泡（角色的 line）；到点收掉 */
  private bubble: Phaser.GameObjects.Text | null = null;
  private bubbleUntil = 0;
  private heroShadow!: Phaser.GameObjects.Image;
  private aura!: Phaser.GameObjects.Image;
  private mobs: (MobView | null)[] = [];
  private shots: ({ gen: number; img: Phaser.GameObjects.Image; trail: number } | null)[] = [];
  private drops: ({ gen: number; img: Phaser.GameObjects.Image; kind: number; key: string; big: boolean } | null)[] = [];
  private fx!: Fx;
  private ground!: Fx;
  /** 竹林：第几块竹丛 → 它的图（倒了就删） */
  private bamboo = new Map<number, Phaser.GameObjects.Image>();
  private nums!: DamageNumbers;
  /** 摆设、符咒炸弹、开箱光效、铜钱袋飘字（items.ts） */
  private items!: Items;
  /** 上次看到的铜钱袋累计铜钱：铜钱袋的数额在核心里现掷，事件里没有，靠累计差值得到 */
  private purseSeen = 0;
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
  private town: Town | null = null;
  private rhud: RaidHud | null = null;
  private guardXY: number[] = [];
  private arenaW = ARENA.w;
  private arenaH = ARENA.h;
  /** 地面层的圈（门圈）：画在影子下面，站在圈里的主角和怪盖在它上面 */
  private rg!: Phaser.GameObjects.Graphics;
  private chestViews: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image | null; open: boolean }[] = [];
  private gateViews: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; open: boolean }[] = [];
  private gd = newGuide();
  /** 鬼市的三个摊子（开市时建，收市时拆）：棚、货的图标、价钱、灯笼光 */
  private stallViews: { img: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; price: Phaser.GameObjects.Text; glow: Phaser.GameObjects.Image; sig: string }[] = [];
  /** 宝库的封条（金箱上的交叉符纸） */
  private sealImg: Phaser.GameObjects.Image | null = null;
  private gdAt = -99;
  private gdMask = -1;
  private trailG: Phaser.GameObjects.Graphics | null = null;
  private trailHinted = false;
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

  /** 出战角色的对局图名 */
  private get heroFrame(): string {
    return heroKey(this.w.setup.character ?? 'xiaodao');
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
    const tm = this.textures.exists(MOB_TEX) ? this.textures.get(MOB_TEX) : this.textures.addCanvas(MOB_TEX, this.d.mobAtlas.canvas)!;
    for (const f of this.d.mobAtlas.frames.values()) {
      this.frames.set(f.key, f);
      if (!tm.has(f.key)) tm.add(f.key, 0, f.x, f.y, f.w, f.h);
    }
    const ha = peekHeroAtlas();
    if (ha) {
      const th = this.textures.exists(HERO_TEX) ? this.textures.get(HERO_TEX) : this.textures.addCanvas(HERO_TEX, ha.canvas)!;
      for (const f of ha.frames.values()) {
        this.frames.set(f.key, f);
        if (!th.has(f.key)) th.add(f.key, 0, f.x, f.y, f.w, f.h);
      }
    }
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
    // 夜探的街和院子全由 Town 铺满，不再多铺一层雪地（少一次全屏绘制，镇子外圈露出背景的雪色）
    const mapDef = MAPS[this.w.setup.map ?? 'snow'];
    // 省内存设备（手机 GPU 弱）上有地形的图：雪地和地形先合成一张不透明的图，整屏只画一遍；其余照旧平铺雪地 + 地形叠层
    if (!this.raid && !(LOW_MEMORY && this.paintBakedGround(gtex, mapDef))) {
      this.add.tileSprite(this.arenaW / 2, this.arenaH / 2, this.arenaW + 400, this.arenaH + 400, 'ground').setTileScale(512 / gtex.width).setDepth(-1000).setTint(GROUND_TINT[mapDef.tone ?? 'snow']);
      this.paintTerrainLayer();
    }
    this.rg = this.add.graphics().setDepth(-500);
    if (this.raid) {
      this.setupRaid(this.raid);
      this.rhud = new RaidHud(this.d.hud.root, this.d.hud.bagBox, makeIcons(this.d.raidAtlas ?? this.d.atlas), this.raid.map);
      this.events.once(Phaser.Scenes.Events.DESTROY, () => {
        this.rhud?.destroy();
        this.town?.destroy();
      });
      // 第一次夜探（教学镇）：开局一句话说清要干什么，几秒后自己收起
      if (this.raid.teach) {
        // 先说清这是练手的小镇子（所有者试玩时觉得夜探太小），再说玩法
        setTimeout(() => this.d.banners.say('教学镇', 'gold', 3000, '小镇子练手，下一局是 6,400 见方的大镇子'), 500);
        setTimeout(() => this.d.banners.say('搜宝箱 · 躲巡夜将 · 天亮前走门撤离', 'gold', 7000, '没撤出去背包全丢（教学镇例外：不丢）'), 3900);
      }
    }
    this.scatterDecor();
    this.drawBlocks();

    this.ground = new Fx(this, this.d.atlas, LOW_MEMORY ? 60 : 140);
    this.fx = new Fx(this, this.d.atlas, LOW_MEMORY ? 180 : 420);
    this.nums = new DamageNumbers(this, this.d.atlas, 30);
    this.gfx = this.add.graphics().setDepth(8000);
    this.items = new Items({
      scene: this,
      frame: (k) => this.frame(k),
      fx: this.fx,
      ground: this.ground,
      shake: (ms, k) => this.shake(ms, k),
      whiteFlash: () => this.d.banners.whiteFlash(),
      freeze: (ms) => {
        this.freeze = Math.max(this.freeze, ms);
      },
    });
    this.purseSeen = this.w.coinBy.purse;
    if (import.meta.env.DEV) this.debugItems();

    this.aura = this.img('aura', 0, 0, 1).setAlpha(0.9);
    this.heroShadow = this.img('shadow', 0, 0, 1.1).setAlpha(0.9);
    // 主角外面再描一圈：同一张图涂成墨色、放大一点垫在后面，轮廓更粗、在怪堆里一眼找得到
    this.heroBack = this.img(this.heroFrame).setTint(0x17131c).setTintMode(Phaser.TintModes.FILL);
    this.hero = this.img(this.heroFrame);
    const line = CHARACTERS[this.w.setup.character ?? 'xiaodao'].line;
    this.bubble = this.add
      .text(0, 0, line, { fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#2a1f14', backgroundColor: '#fff6dc', padding: { x: 8, y: 5 }, wordWrap: { width: 190 }, align: 'center' })
      .setOrigin(0.5, 1)
      .setDepth(9300);
    this.bubbleUntil = this.now + 3600;
    this.d.hud.setFace(this.d.icon(faceKey(this.w.setup.character ?? 'xiaodao')));
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

  /**
   * 开发预览（只在 dev 构建里有，截图 / 调试用）：?debugitems=row 在主角旁摆一排新图标；
   * =bomb / purse / prop0 / prop1 / chest1 / chest3 / chest5 在开局 1.5 秒后触发对应演出（不动核心状态，只放画面）。
   */
  private debugItems(): void {
    const what = new URLSearchParams(location.search).get('debugitems');
    if (!what) return;
    const { x, y } = this.w;
    if (what === 'row') {
      const put = (key: string, dx: number, dy: number, sc = 1): void => {
        this.img(key, x + dx, y + dy, sc).setDepth(y + dy);
      };
      put('drop_bomb', -120, -80);
      put('drop_purse', -60, -80);
      put('prop_lantern', 40, -80, 0.85);
      put('prop_paper', 120, -80, 0.85);
      put('chest', -90, 40, 1.2);
      put('coin', -40, 40);
      put('bun', 0, 40);
      return;
    }
    // &debugat=毫秒：等多久再放（默认 1.5 秒；截图脚本在开局约 3.5 秒后截，机器慢时可以调）
    this.time.delayedCall(Number(new URLSearchParams(location.search).get('debugat') ?? 1500), () => {
      if (what === 'bomb') this.items.bombBlast(x, y, 520);
      else if (what === 'purse') {
        sfx.play('purse');
        this.items.floatText(x, y - 74, '+19 铜钱', '#ffd23a');
        this.burst(x, y - 30, 0xffc928, 1.3);
      } else if (what === 'prop0' || what === 'prop1') this.items.propBreak(x + 60, y - 30, what === 'prop0' ? 0 : 1, 3);
      else if (what.startsWith('chest')) {
        const n = Number(what.slice(5));
        this.items.chestBig(x, y, n);
        const codes = n >= 5 ? [0, 1, 100, 101, 2] : n >= 3 ? [0, 100, 2] : [0];
        this.onChests(codes, n);
      }
    });
  }

  /** 地图上挡路的东西（义庄的墙、棺材、正堂）：墙按段拼，最后一段压缩到刚好对齐；深度按脚底 */
  private drawBlocks(): void {
    // 夜探的院墙、房子、台阶墙、摊子由 Town 按样式画（town.ts）
    if (this.town) {
      this.town.drawBlocks();
      return;
    }
    this.drawBamboo();
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
      else if (b.look === 'stall') this.img('stall', b.x + b.w / 2, b.y + b.h + 4).setDepth(b.y + b.h);
      else if (b.look === 'terrace') {
        const n = Math.max(1, Math.round(b.w / 80));
        const step = b.w / n;
        const f = this.frame('terrace_h');
        for (let k = 0; k < n; k++) this.img('terrace_h', b.x + step * (k + 0.5), b.y + b.h).setScale(step / 80 / f.res, 1 / f.res).setDepth(b.y + b.h);
      } else if (b.look === 'river') continue;
      else if (b.look === 'bamboo') continue;
      else if (b.look === 'rock') {
        const f = this.frame('rock');
        this.img('rock', b.x + b.w / 2, b.y + b.h + 6).setScale(Math.max(b.w, 56) / 60 / f.res, 1 / f.res).setDepth(b.y + b.h);
      } else this.img('hall', b.x + b.w / 2, b.y + b.h).setDepth(b.y + b.h);
    }
  }

  /** 河、冰、桥、落叶这类整张场地的地形叠层：一张 canvas，缩小存（省内存设备更小） */
  /**
   * 省内存设备：雪地平铺 + 底色调 + 地形画进同一张图（场地四周各多 200，和平铺的范围一样），代替"平铺雪地 + 地形叠层"两遍全屏绘制。
   * 按 0.34 倍画（3,600 见方 → 1,224 像素，图集上限 2,048 以内），雪地纹理细节糊一点，换手机上少一遍全屏绘制。没有地形的图返回 false。
   */
  private paintBakedGround(gtex: HTMLCanvasElement, def: MapDef): boolean {
    const scale = 0.34;
    const terr = paintTerrain(def, this.w.setup.seed, scale);
    if (!terr) return false;
    const pad = 200;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((this.arenaW + pad * 2) * scale);
    cv.height = Math.ceil((this.arenaH + pad * 2) * scale);
    const c = cv.getContext('2d')!;
    // 雪地：一块 512 世界单位，按画布倍数缩小平铺
    const pat = c.createPattern(gtex, 'repeat')!;
    pat.setTransform(new DOMMatrix().scale((512 / gtex.width) * scale));
    c.fillStyle = pat;
    c.fillRect(0, 0, cv.width, cv.height);
    // 底色调：和 setTint 一样是相乘
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = `#${GROUND_TINT[def.tone ?? 'snow'].toString(16).padStart(6, '0')}`;
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(terr, pad * scale, pad * scale);
    const key = `ground_${def.id}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, cv);
    this.add.image(this.arenaW / 2, this.arenaH / 2, key).setScale(1 / scale).setDepth(-1000);
    return true;
  }

  private paintTerrainLayer(): void {
    const def = MAPS[this.w.setup.map ?? 'snow'];
    const scale = LOW_MEMORY ? 0.34 : 0.5;
    const cv = paintTerrain(def, this.w.setup.seed, scale);
    if (!cv) return;
    const key = `terrain_${def.id}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, cv);
    this.add.image(this.arenaW / 2, this.arenaH / 2, key).setScale(1 / scale).setDepth(-950);
  }

  /** 竹林：每丛竹子一张图（按宽度分三档贴图，横向拉伸到脚底宽），深度按脚底；血少了发黄 */
  private drawBamboo(): void {
    const all = this.w.allBlocks;
    if (!all.some((b) => b.look === 'bamboo')) return;
    const res = LOW_MEMORY ? 1 : 2;
    // 6 张竹丛贴图拼成一张纹理（每张是一个帧）：和竹桩一起只占一次纹理切换，同屏几十丛竹子不再每丛打断一次批处理
    if (!this.textures.exists('bamboo_sheet')) {
      // 每个变体一行（一行三种宽度），竹桩接在第一行末尾：整张宽高都在 2,048 以内
      const parts: { key: string; cv: HTMLCanvasElement; x: number; y: number }[] = [];
      let y = 0;
      let width = 0;
      for (let v = 0; v < BAMBOO_VARIANTS; v++) {
        let x = 0;
        let rowH = 0;
        for (const wd of BAMBOO_WIDTHS) {
          const cv = bambooCanvas(wd, v, res);
          parts.push({ key: `bamboo_${wd}_${v}`, cv, x, y });
          x += cv.width;
          rowH = Math.max(rowH, cv.height);
        }
        if (v === 0) {
          const stump = stumpCanvas(res);
          parts.push({ key: 'bamboo_stump', cv: stump, x, y });
          x += stump.width;
        }
        width = Math.max(width, x);
        y += rowH;
      }
      const sheet = document.createElement('canvas');
      sheet.width = width;
      sheet.height = y;
      const sc = sheet.getContext('2d')!;
      for (const q of parts) sc.drawImage(q.cv, q.x, q.y);
      const tex = this.textures.addCanvas('bamboo_sheet', sheet)!;
      for (const q of parts) tex.add(q.key, 0, q.x, q.y, q.cv.width, q.cv.height);
    }
    all.forEach((b, k) => {
      if (b.look !== 'bamboo') return;
      const { key, wd } = bambooKey(b, k);
      const img = this.add.image(b.x + b.w / 2, b.y + b.h + 4, 'bamboo_sheet', key).setOrigin(0.5, 1 - 12 / 250).setDepth(b.y + b.h);
      img.setScale((b.w / wd) / res, 1 / res);
      this.bamboo.set(k, img);
    });
    // 倒了的（回放、继续的局里可能一开始就有）
    this.w.allBlocks.forEach((b, k) => {
      if (b.look === 'bamboo' && this.w.blockHp[k]! <= 0) this.fellBamboo(k, false);
    });
  }

  /** 主角走到竹丛后面（脚比竹丛脚底靠上，身子和头落在竹丛图里）时，把那丛竹子淡到 0.35，离开恢复；每帧只过一遍竹丛，不新建对象 */
  private fadeBambooOverHero(hx: number, hy: number, dt: number): void {
    if (this.bamboo.size === 0) return;
    const step = Math.min(1, dt / 120);
    for (const [k, img] of this.bamboo) {
      const b = this.w.allBlocks[k]!;
      // 竹丛图的包围盒（原点在底边中心偏上 12/250）；两侧各让出 20%，只在竹子真挡在身前时才淡
      const hw = img.displayWidth * 0.3;
      const bottom = img.y + img.displayHeight * (12 / 250);
      const top = bottom - img.displayHeight;
      const behind = hy < b.y + b.h && hx > img.x - hw && hx < img.x + hw && hy > top && hy - 80 < bottom;
      const want = behind ? 0.35 : 1;
      if (img.alpha === want) continue;
      const a = img.alpha + (want - img.alpha) * step;
      img.setAlpha(Math.abs(a - want) < 0.02 ? want : a);
    }
  }

  /** 竹丛挨了一下：抖一抖，掉几片叶子；血过半发黄 */
  private chopBamboo(k: number, x: number, y: number, left: number, fell: boolean): void {
    if (fell) return this.fellBamboo(k, true);
    const img = this.bamboo.get(k);
    if (!img) return;
    img.setTint(left < 0.5 ? 0xe6d47a : 0xf4f0b0);
    this.tweens.add({ targets: img, x: { from: img.x - 4, to: img.x }, duration: 140, ease: 'Sine.easeOut' });
    sfx.play('propWood', { pitch: 1.4, volume: 0.5 });
    if (!LOW_MEMORY) for (let n = 0; n < 3; n++) this.fx.spawn({ frame: 'mote', x: x + (Math.random() - 0.5) * 50, y: y - 80 - Math.random() * 60, vx: (Math.random() - 0.5) * 80, vy: 40 + Math.random() * 40, life: 520, s0: 0.9, s1: 0.4, tint: 0x5aa84c });
  }

  /** 竹丛倒了：整丛往一边砸下去、淡出，留一个竹桩 */
  private fellBamboo(k: number, animate: boolean): void {
    const b = this.w.allBlocks[k]!;
    const img = this.bamboo.get(k);
    this.bamboo.delete(k);
    const stump = this.add.image(b.x + b.w / 2, b.y + b.h + 2, 'bamboo_sheet', 'bamboo_stump').setScale(1 / (LOW_MEMORY ? 1 : 2)).setDepth(-800);
    if (!img) return;
    if (!animate) {
      img.destroy();
      return;
    }
    stump.setAlpha(0);
    this.tweens.add({ targets: stump, alpha: 1, duration: 300 });
    sfx.play('propWood', { pitch: 0.7 });
    this.shake(120, 0.4);
    this.tweens.add({ targets: img, angle: b.x % 2 < 1 ? 80 : -80, alpha: 0, duration: 420, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  /** 夜探场地的地面：街和院子的铺地、河、桥由 Town 分块预渲染；这里摆宝箱和门 */
  private setupRaid(raid: Raid): void {
    this.town = new Town(this, raid, { img: (key, x, y, scale) => this.img(key, x, y, scale), res: (key) => this.frame(key).res, lowMem: LOW_MEMORY });
    this.town.prepare(this.w.x, this.w.y);
    const sh = this.frame('shadow');
    for (const c of raid.map.chests) {
      this.add.image(c.x, c.y + 14, 'atlas', 'shadow').setScale(0.8 / sh.res).setDepth(-400).setAlpha(0.8);
      const img = this.img(`chest_${c.tier}`, c.x, c.y + 14).setDepth(c.y + 14);
      const glow = c.tier === 'wood' ? null : this.img('haze', c.x, c.y - 4, c.tier === 'gold' ? 2 : 1.4).setTint(c.tier === 'gold' ? 0xffd860 : 0xffa860).setDepth(c.y + 13);
      this.chestViews.push({ img, glow, open: false });
    }
    if (raid.vault >= 0) {
      const c = raid.map.chests[raid.vault]!;
      this.sealImg = this.img('seal', c.x, c.y + 4).setDepth(c.y + 16);
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

  /** 点缀：按种子撒在整个场地上（只装饰，不挡路）；枯树、残碑、石灯、石头、青石板、冰面、雪堆、枯草；义庄另撒白灯笼、稻草 */
  private scatterDecor(): void {
    const r = artRng(this.w.setup.seed);
    const blocks = this.w.blocks;
    const mdef = MAPS[this.w.setup.map ?? 'snow'];
    const water = mdef.water ?? [];
    const ice = mdef.ice ?? [];
    const bridges = mdef.bridges ?? [];
    const spawnX = this.raid ? this.w.x : this.arenaW / 2;
    const spawnY = this.raid ? this.w.y : this.arenaH / 2;
    const put = (key: string, n: number, ground: boolean): void => {
      if (!this.frames.has(key)) return;
      for (let i = 0; i < n; i++) {
        const x = 100 + r() * (this.arenaW - 200);
        const y = 100 + r() * (this.arenaH - 200);
        // 出生点附近留空，开场看得清（夜探的出生点在角上，不在中心）
        if (Math.abs(x - spawnX) < 220 && Math.abs(y - spawnY) < 160) continue;
        // 夜探的街面是石板路：不撒枯树、石头、草，只留雪堆
        if (this.town?.onStreet(x, y) && key !== 'drift') continue;
        // 不压在墙、棺材上（立着的东西离远一点）
        const pad = ground ? 10 : 50;
        // 水里、冰面上不撒点缀（桥在水区之间的缺口里，一并避开）
        if (water.length && (inRects(water, x, y) || bridges.some((r) => x > r.x - 30 && x < r.x + r.w + 30 && y > r.y - 30 && y < r.y + r.h + 30)) && key !== 'rock') continue;
        if (water.length && ground && water.some((r) => x > r.x - 40 && x < r.x + r.w + 40 && y > r.y - 40 && y < r.y + r.h + 40)) continue;
        if (ice.length && inRects(ice, x, y) && key !== 'puddle' && key !== 'drift') continue;
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
    put('grass', Math.round(220 * (this.raid ? dense / 2 : dense)), true);
    const yz = !this.raid && this.w.setup.map === 'yizhuang';
    // 山寺的树都是古松（Town 里摆），不再撒枯树
    // 竹林里本来就是竹子，不再撒枯树；冰湖上雪堆多一点
    if (this.raid?.setup.template !== 'shansi' && mdef.tone !== 'bamboo') put('tree', Math.round((yz ? 26 : mdef.tone === 'ice' ? 24 : 46) * dense), false);
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
    // dev 预览：&slowmo=N 把画面时间放慢 N 倍，机器慢、截图间隔长时能截到特效的各个阶段
    const dt = Math.min(delta, 100) / SLOWMO;
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
    const chestCodes: number[] = [];
    let bigN = 0;
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
        case Ev.ChestBig:
          // 先放光（档位由件数决定），升了什么由紧跟着的 Chest 事件收齐，循环结束后一起演
          bigN = ev.a[i]!;
          this.items.chestBig(x, y, bigN);
          break;
        case Ev.Chest:
          chestCodes.push(ev.a[i]!);
          break;
        case Ev.Prop:
          this.items.propBreak(x, y, ev.a[i]!, ev.b[i]!);
          break;
        case Ev.Chop:
          this.chopBamboo(ev.a[i]!, x, y, ev.b[i]!, ev.c[i] === 1);
          break;
        case Ev.Bomb:
          this.items.bombBlast(x, y, ev.b[i]!);
          break;
        case Ev.Evolve:
          break;
        case Ev.Merge: {
          // 合成：用这个合成自己的颜色炸一圈（三个双修各一种）
          const tint = parseInt(MERGES[ev.a[i]!]!.color.slice(1), 16);
          this.fx.spawn({ frame: 'ring', x, y: y - 20, life: 700, s0: 0.5, s1: 7, a0: 1, a1: 0, tint, depth: 60 });
          this.burst(x, y - 30, tint, 2.2);
          break;
        }
        case Ev.Seal:
          if (ev.a[i] === 0) {
            // 贴符：怪头上一枚朱红小印
            this.spark(x, y - 28, 0xd0362e, 1.2);
          } else {
            this.burst(x, y - 14, 0xff5a4a, ev.b[i]! / 34);
            this.fx.spawn({ frame: 'ring', x, y: y - 10, life: 300, s0: 0.3, s1: (ev.b[i]! * 2) / 128, a0: 0.9, a1: 0, tint: 0xd0362e });
          }
          break;
        case Ev.FireRing:
          this.fx.spawn({ frame: 'ring', x, y: y - 8, life: 380, s0: ((ev.b[i]! * 2) / 128) * 0.8, s1: (ev.b[i]! * 2) / 128, a0: 0.8, a1: 0, tint: 0xff8a2a, depth: 60 });
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
        case Ev.Restock:
          this.onRestock(x, y, ev.a[i]!, ev.b[i]!);
          break;
        case Ev.Goblin:
          this.onGoblin(x, y, ev.a[i]!);
          break;
        case Ev.Market:
          this.onMarket(x, y, ev.a[i]!, ev.b[i]!);
          break;
        case Ev.Key:
          sfx.play('pickup');
          this.burst(this.w.x, this.w.y - 40, 0xffd23a, 1.4);
          this.d.banners.say('拿到宝库钥匙', 'gold', 2600, '8:00 以后去开封着的金箱');
          break;
        case Ev.Vault:
          sfx.play('gateOpen', { volume: 0.8 });
          this.fx.spawn({ frame: 'ring', x, y, life: 900, s0: 0.5, s1: 3, a0: 1, a1: 0, tint: 0xffd23a, depth: 60 });
          if (ev.b[i] === 1) this.d.banners.say('宝库开封了', 'gold', 2600);
          else this.d.banners.say('宝库开封了', 'warn', 3000, '要钥匙：打倒精英或守卫掉');
          break;
        case Ev.Roamer:
          this.onRoamer(x, y);
          break;
        case Ev.Boss:
          this.onBoss(x, y, ev.a[i]!, ev.b[i]!, ev.c[i]!);
          break;
        case Ev.Mob:
          this.onMob(x, y, ev.a[i]!, ev.b[i]!, ev.c[i]!);
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
    if (chestCodes.length > 0) this.onChests(chestCodes, bigN);
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
    } else if (kind === Drop.Purse) {
      // 一串叮当 + 头上飘"+N 铜钱"；N 是核心现掷的，靠铜钱袋累计的差值得到
      sfx.play('purse');
      const got = this.w.coinBy.purse - this.purseSeen;
      this.purseSeen = this.w.coinBy.purse;
      if (got > 0) this.items.floatText(this.w.x, this.w.y - 74, `+${got} 铜钱`, '#ffd23a');
      this.burst(this.w.x, this.w.y - 30, 0xffc928, 1.3);
    } else if (kind === Drop.Bomb) {
      // 爆炸的音效、冲击圈、白闪、震屏都跟着同一拍的 Ev.Bomb 放，这里只给捡起一下的小反馈
      this.spark(this.w.x, this.w.y - 30, 0xff7a2a, 1.4);
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

  /** 一件升级的展示内容：图标、名字、说明；evolve 表示进化 / 合成（更隆重） */
  private chestInfo(code: number): { icon: string; title: string; sub: string; evolve: boolean; tint?: string } {
    const w = this.w;
    if (code >= MERGE_CODE) {
      const m = MERGES[code - MERGE_CODE]!;
      return { icon: m.icon, title: m.name, sub: `${m.dual ? '双修' : '合成'}！${m.desc}。空出一个法器格`, evolve: true, tint: m.color };
    }
    if (code >= 100) {
      const p = PASSIVES[PASSIVE_IDS[code - 100]!];
      return { icon: p.icon, title: p.name, sub: `Lv ${w.passives[p.id] ?? 0} · ${p.text}`, evolve: false };
    }
    if (code >= 0) {
      const id = WEAPON_IDS[code]!;
      const o = w.weapons.find((x) => x.id === id);
      const def = WEAPONS[id];
      if (o?.evolved && def.evolve) return { icon: def.evolve.icon, title: def.evolve.name, sub: `进化！${def.evolve.desc}`, evolve: true };
      return { icon: def.icon, title: def.name, sub: `升到 Lv ${o?.level ?? 1}`, evolve: false };
    }
    return { icon: 'coin', title: '铜钱一袋', sub: '铜钱 +40，回 30 点血', evolve: false };
  }

  /**
   * 精英宝箱升了几件。一件：原来的整屏演出（点一下或 1.3 秒结束，期间不送拍）；
   * 三 / 五件：几件依次弹出排一排，不拦点击，只停一小会儿给光柱让位，之后玩家接着走位（核心不暂停）。
   */
  private onChests(codes: number[], big: number): void {
    const infos = codes.map((c) => this.chestInfo(c));
    const tier = codes.length >= 5 ? 5 : codes.length >= 3 ? 3 : 1;
    if (tier === 1) {
      sfx.play('chest');
      const it = infos[0]!;
      if (it.evolve) {
        sfx.play('evolve');
        this.d.banners.whiteFlash();
      }
      // 黄历让一个宝箱多升一件：多出来的只给一行横幅
      for (let k = 1; k < codes.length; k++) this.d.banners.say(`另外 ${this.chestTitle(codes[k]!)} 也升了`, 'gold', 1600);
      if (this.d.autopilot) return;
      this.hold = 1e9;
      this.d.banners.reveal(this.d.icon(it.icon), it.title, it.sub, it.evolve, () => {
        this.hold = 0;
        this.d.onChest?.();
      }, it.tint);
      return;
    }
    // 光效按核心说的件数（big），列表按实际收到的件数；两者一致，不一致以实际为准
    const n = Math.max(codes.length, big);
    this.d.banners.chestRow(
      infos.map((it) => ({ icon: this.d.icon(it.icon), name: it.title, evolve: it.evolve })),
      n >= 5 ? '五连宝箱！' : '三连宝箱',
      tier,
    );
    // 每弹出一件叮一声，音调逐件升高；进化 / 合成那件再加一下
    infos.forEach((it, k) => {
      this.time.delayedCall(k * (tier === 5 ? 190 : 230) + 120, () => {
        sfx.play('pickup', { volume: 0.7, pitch: 1.2 + k * 0.14 });
        if (it.evolve) {
          sfx.play('evolve', { volume: 0.7 });
          this.d.banners.whiteFlash();
        }
      });
    });
    // 光柱出来的头一会儿停一停（五件更久），再放开；演出本身继续留在屏幕上方
    if (!this.d.autopilot) this.hold = Math.max(this.hold, tier === 5 ? 520 : 300);
    this.d.onChest?.();
  }

  // ───────────────────────── 夜探的事件 ─────────────────────────

  /** 撤离指引：主角前方一段小箭头沿路线往门流动。画在地面层（depth −200，在屋顶、墙顶之下），点往离墙远的一侧推开 44px（墙的画面比碰撞脚印宽） */
  private drawTrail(raid: Raid, gd: ReturnType<typeof newGuide>): void {
    const g = (this.trailG ??= this.add.graphics().setDepth(-200));
    g.clear();
    const lit = this.town?.trail;
    if (lit) lit.length = 0;
    if (gd.gate < 0 || gd.trailN < 2) return;
    if (!this.trailHinted) {
      this.trailHinted = true;
      this.d.banners.say(`跟着箭头去${raid.map.gates[gd.gate]!.name}撤离`, 'gold', 3200);
    }
    const tr = gd.trail;
    const near = Math.max(0.85, Math.min(1, 1.3 - gd.dist / 1600));
    // 脚印点隔得远（约 3 格），沿折线每 STEP 单位摆一个箭头；相位按 dt 累加的时间走，朝门流动
    const STEP = LOW_MEMORY ? 110 : 80;
    const span = LOW_MEMORY ? 480 : 760;
    const phase = ((this.now * 0.05) % STEP) / STEP;
    const blocks = raid.map.blocks;
    // 折线从主角脚下开始，接上第一个脚印点
    let px0 = this.renderX, py0 = this.renderY;
    let walked = 0;
    let next = phase * STEP;
    for (let i = 0; i < gd.trailN && walked < span; i++) {
      const x1 = tr[i * 2]!, y1 = tr[i * 2 + 1]!;
      const dx = x1 - px0, dy = y1 - py0;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len, uy = dy / len;
      for (; next < len && walked + next < span; next += STEP) {
        let x = px0 + ux * next, y = py0 + uy * next;
        const dist = walked + next;
        for (const b of blocks) {
          if (x < b.x - 50 || x > b.x + b.w + 50 || y < b.y - 50 || y > b.y + b.h + 50) continue;
          const cx = Math.max(b.x, Math.min(x, b.x + b.w)), cy = Math.max(b.y, Math.min(y, b.y + b.h));
          let ox = x - cx, oy = y - cy;
          const d = Math.hypot(ox, oy);
          if (d >= 44) continue;
          if (d < 0.5) { ox = x - (b.x + b.w / 2); oy = y - (b.y + b.h / 2); }
          const m = Math.hypot(ox, oy) || 1;
          const base = d < 0.5 ? 0 : d;
          x += (ox / m) * (44 - base);
          y += (oy / m) * (44 - base);
        }
        // 头尾淡入淡出，越靠近门越亮越大
        const fade = Math.min(1, dist / 60, (span - dist) / 160);
        // 填色不打折（打折后压在石板上发灰，和门牌的亮黄对不上），只在头尾淡出；越近门越大
        const a = Math.max(0, fade);
        const sz = (LOW_MEMORY ? 16 : 14 + 6 * (1 - dist / span)) * near;
        const px = -uy, py = ux;
        lit?.push(x, y, a);
        for (const [col, grow, al] of [[0x17131c, 3, 0.9], [0xffd23a, 0, 1]] as const) {
          const s2 = sz + grow;
          g.fillStyle(col, al * a);
          // 飞镖形：尖、左后角、尾凹、右后角
          const tx = x + ux * s2, ty = y + uy * s2;
          const lx = x - ux * s2 * 0.8 + px * s2 * 0.85, ly = y - uy * s2 * 0.8 + py * s2 * 0.85;
          const rx = x - ux * s2 * 0.8 - px * s2 * 0.85, ry = y - uy * s2 * 0.8 - py * s2 * 0.85;
          const nx = x - ux * s2 * 0.2, ny = y - uy * s2 * 0.2;
          g.fillTriangle(tx, ty, lx, ly, nx, ny);
          g.fillTriangle(tx, ty, nx, ny, rx, ry);
        }
      }
      next -= len;
      walked += len;
      px0 = x1;
      py0 = y1;
    }
  }

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

  private onRestock(x: number, y: number, c: number, n: number): void {
    if (c < 0) {
      sfx.play('chest', { volume: 0.5 });
      this.d.banners.say(`补货了：${n} 个箱子又满了`, 'gold', 2400);
      return;
    }
    this.burst(x, y - 10, 0xffd860, 1);
    this.fx.spawn({ frame: 'ring', x, y, life: 500, s0: 0.3, s1: 1.6, a0: 1, a1: 0, tint: 0xffd860, depth: 60 });
  }

  private onGoblin(x: number, y: number, a: number): void {
    if (a === 0) {
      sfx.play('elite');
      this.d.banners.say('宝妖出来了', 'gold', 2600, '背着宝袋，追上打倒掉两件好宝物');
      this.fx.spawn({ frame: 'ring', x, y, life: 800, s0: 0.4, s1: 2.4, a0: 1, a1: 0, tint: 0xffc83a, depth: 60 });
    } else if (a === 1) {
      this.d.banners.say('宝妖钻地跑了', 'ink', 2000);
      this.burst(x, y, 0xb57d12, 1.4);
    } else {
      sfx.play('chestGold');
      this.burst(x, y - 10, 0xffc83a, 1.8);
      this.fx.spawn({ frame: 'ring', x, y, life: 600, s0: 0.3, s1: 2.2, a0: 1, a1: 0, tint: 0xffc83a, depth: 60 });
      this.d.banners.say('打倒宝妖！', 'gold', 2000);
    }
  }

  private onMarket(x: number, y: number, a: number, stall: number): void {
    if (a === 0) {
      sfx.play('bell');
      this.d.banners.say('鬼市开了（到 8:00）', 'gold', 3000, '镇中心，拿身上的铜钱买宝物');
    } else if (a === 1) {
      this.d.banners.say('鬼市收了', 'ink', 2000);
    } else {
      sfx.play('purse');
      const price = this.raid!.stallPrice[stall] ?? 0;
      const n = this.floats.length;
      const oy = -64 - n * 30;
      const f = this.frame('coin');
      const img = this.add.image(x - 4, y + oy, f.tex ?? 'atlas', f.key).setScale(1.3 / f.res).setDepth(9200);
      const text = this.add
        .text(x + 8, y + oy, `-${price}`, { fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ff7a5a', stroke: '#17131c', strokeThickness: 5 })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setDepth(9200);
      this.floats.push({ img, text, x, y: y + oy, life: 1600 });
    }
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

  /** 特色怪的技能（Ev.Mob 的子类见 events.ts）：预警画地上的圈，落下时一圈冲击加碎屑 */
  private onMob(x: number, y: number, a: number, r: number, ticks: number): void {
    const tick = 1000 / 30;
    const warn = (color: number): void => {
      this.telegraphs.push({ x, y, r, life: 0, max: ticks * tick, round: true, color });
    };
    const ring = (tint: number, k = 2.4): void => {
      this.fx.spawn({ frame: 'ring', x, y, life: 460, s0: 0.4, s1: (r * k) / 128, a0: 1, a1: 0, tint, depth: 60 });
    };
    switch (a) {
      case 0: // 竹精预警
        warn(0x3fae5a);
        break;
      case 1: // 竹精出土
        ring(0x3fae5a);
        this.burst(x, y - 10, 0x7fc45a, 1.2);
        for (let k = 0; k < (LOW_MEMORY ? 3 : 7); k++) this.fx.spawn({ frame: 'shard', x, y, vx: (Math.random() - 0.5) * 160, vy: -90 - Math.random() * 90, g: 420, life: 520, s0: 1.4, s1: 0.7, tint: 0x85613c, rot: Math.random() * 6, spin: 8 });
        sfx.play('bossStomp', { volume: 0.35 });
        break;
      case 2: // 溺鬼抓住了（b > 0）或刚冒出来（b = 0）
        if (r > 0) {
          ring(0x6a8c98, 1.1);
          sfx.play('hurt', { volume: 0.3, pitch: 0.7 });
        } else this.burst(x, y - 6, 0x9fd0e0, 0.8);
        break;
      case 3: // 冰傀碎裂
        this.burst(x, y - 14, 0xbfe6fa, 1.5);
        sfx.play('bell', { volume: 0.3, pitch: 1.5 });
        break;
      case 4: // 冰刺预警
        warn(0x4aa8ff);
        break;
      case 5: // 冰刺落下
        ring(0x4aa8ff, 2);
        this.burst(x, y - 12, 0xeaf8ff, 1.3);
        sfx.play('talisman', { volume: 0.35, pitch: 0.6 });
        break;
      case 6: // 蛇精窜出
        this.burst(x, y - 8, 0xa6dc72, 0.7);
        break;
      case 7: // 河伯涨潮
        ring(0x5fa9c0, 1.4);
        sfx.play('bossBreath', { volume: 0.5 });
        break;
      case 8: // 冰魄预警
        warn(0x7fd0ff);
        break;
      case 9: // 冰魄霜环
        ring(0x7fd0ff, 2.2);
        this.burst(x, y - 14, 0xeaf8ff, 2);
        sfx.play('bossStomp', { volume: 0.5 });
        this.shake(140, 0.005);
        break;
      case 10: // 更夫敲梆
        sfx.play('propWood', { volume: 0.5 });
        this.fx.spawn({ frame: 'ring', x, y, life: 420, s0: 0.3, s1: 1.4, a0: 1, a1: 0, tint: 0xe0a030, depth: 60 });
        break;
      case 11: // 石僧预警
        warn(0xb4b8bf);
        break;
      case 12: // 石僧掌击
        ring(0x9a9ea8, 2);
        this.burst(x, y - 8, 0xc8ccd4, 1.4);
        sfx.play('bossStomp', { volume: 0.45 });
        this.shake(150, 0.006);
        break;
      case 13: // 竹王破土
        sfx.play('boss', { volume: 0.5 });
        this.shake(200, 0.006);
        break;
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
    const f = this.frame(this.heroFrame);
    const face = COS[w.face]! < -0.1 ? -1 : COS[w.face]! > 0.1 ? 1 : this.hero.scaleX < 0 ? -1 : 1;
    // 走路基本是平移：只留不到 1 像素的起伏和极小的挤压，当脚步感（幸存者类走位多，大幅上下晃会让人觉得在抖）
    const sx = (1 / f.res) * (1 + (1 - bob) * 0.012 * (walking ? 1 : 0)) * face;
    const sy = (1 / f.res) * (1 - (walking ? (1 - bob) * 0.012 - bob * 0.008 : Math.sin(this.now * 0.004) * 0.015));
    const blink = w.invuln > 0 && Math.floor(this.now / 60) % 2 === 0;
    this.hero.setPosition(hx, hy - bob * 0.8).setScale(sx, sy).setRotation(0).setDepth(hy).setAlpha(blink ? 0.5 : 1);
    this.heroBack.setPosition(hx, hy - bob * 0.8 + 1).setScale(sx * 1.07, sy * 1.05).setRotation(this.hero.rotation).setDepth(hy - 0.1).setAlpha(this.hero.alpha);
    this.heroShadow.setPosition(hx, hy).setDepth(-400);
    if (this.bubble) {
      if (this.now > this.bubbleUntil) {
        this.bubble.destroy();
        this.bubble = null;
      } else this.bubble.setPosition(hx, hy - 82).setAlpha(Math.min(1, (this.bubbleUntil - this.now) / 500));
    }
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
    const cam = this.cameras.main;
    cam.centerOn(hx, hy - 20);

    this.gfx.clear();
    this.waves.length = 0;
    this.petalMarks.length = 0;
    this.fadeBambooOverHero(hx, hy, dt);
    this.drawMobs(inter, dt);
    this.drawShots(inter);
    this.drawDrops(inter);
    this.items.drawProps(w, dt);
    if (this.raid) {
      this.drawRaid(dt);
      this.town?.update(cam, this.renderX, this.renderY);
    }
    this.drawGfx(dt);
    this.fx.update(dt);
    this.ground.update(dt);
    this.nums.update(dt);
    this.items.update(dt);
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
      // 竹精、溺鬼同理（竹精出土前还在地下）
      const sink = w.eT[i]! > 0 ? (code === WATER_CODE ? w.eT[i]! / WATER.emerge : code === SPROUT_CODE ? w.eT[i]! / SPROUT.warn : code === DROWN_CODE ? w.eT[i]! / DROWN.emerge : 0) : 0;
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
        .setAlpha(code === SNAKE_CODE && w.eS[i] === 0 ? 0.4 : 1 - sink * (code === SPROUT_CODE ? 1 : 0.75))
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
    const glowTint = def.kind === 'goblin' ? 0xffc83a : def.elite || def.boss ? 0xa050ff : def.kind === 'lantern' ? 0xff8a3a : def.kind === 'wisp' ? 0x5fd3f0 : null;
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
      const key = kind === Drop.Soul ? (v >= 5 ? 'bead3' : v >= 2 ? 'bead2' : 'bead1') : kind === Drop.Coin ? 'coin' : kind === Drop.Bun ? 'bun' : kind === Drop.Scroll ? 'scroll' : kind === Drop.Bomb ? 'drop_bomb' : kind === Drop.Purse ? 'drop_purse' : 'chest';
      // 魂珠比怪小一号、颜色淡，不抢眼；超过上限并成的大珠（经验 ≥ 20）放大、一闪一闪，看得出值得去捡
      const big = kind === Drop.Soul && v >= 20;
      const sc = kind === Drop.Chest ? 1.2 : kind === Drop.Soul ? (big ? 1.5 : 0.75) : kind === Drop.Bomb || kind === Drop.Purse ? 1.2 : 1;
      if (!d || d.gen !== w.dGen[i] || d.kind !== kind || d.key !== key || d.big !== big) {
        const f = this.frame(key);
        const img = d?.img ?? this.add.image(0, 0, 'atlas', f.key);
        img.setFrame(f.key).setOrigin(f.ox, f.oy).setVisible(true).setScale(sc / f.res);
        d = this.drops[i] = { gen: w.dGen[i]!, img, kind, key, big };
      }
      if (big) d.img.setScale((sc + Math.sin(this.now * 0.008 + i) * 0.12) / this.frame(key).res);
      const x = inter(w.dPX[i]!, w.dX[i]!);
      const y = inter(w.dPY[i]!, w.dY[i]!);
      // 炸弹和钱袋比别的掉落更值得捡：浮得高一点、跟着呼吸一胀一缩，带着自己的光晕，远远就认得
      const special = kind === Drop.Bomb || kind === Drop.Purse;
      if (special) d.img.setScale((sc + Math.sin(this.now * 0.008 + i) * 0.08) / this.frame(key).res);
      d.img.setPosition(x, y + (kind === Drop.Chest ? 0 : special ? -4 + Math.sin(this.now * 0.006 + i) * 4 : Math.sin(this.now * 0.006 + i) * 2)).setDepth(kind === Drop.Chest ? y : -300 + y * 0.0001);
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
        v.glow?.setVisible(!open);
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
    this.drawLate(raid);
    // 撤离指引：每 4 帧重算一次（最短路场按开着的门缓存），脚印画在地上，门在屏幕外时边上一个箭头
    if (raid.outcome === 'none') {
      if (this.gdMask !== raid.gateMask || this.now - this.gdAt > 120) {
        this.gdMask = raid.gateMask;
        this.gdAt = this.now;
        guide(raid, w.x, w.y, this.gd);
      }
      const gd = this.gd;
      this.drawTrail(raid, gd);
      const cam = this.cameras.main;
      const cssW = this.scale.displaySize.width;
      const cssH = this.scale.displaySize.height;
      const k = cssW / (cam.width / cam.zoom);
      const gate = gd.gate >= 0 ? raid.map.gates[gd.gate]! : null;
      const arrow = gate ? edgeArrow(raid, gd, (gate.x - cam.midPoint.x) * k, (gate.y - cam.midPoint.y) * k, cssW, cssH, 84) : null;
      this.d.hud.setArrow(arrow && !arrow.onScreen ? arrow : null);
      this.feedRaidHud(raid, gate ? { name: gate.name, secs: walkSecs(gd.dist) } : null);
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

  /** 宝妖在场上的槽位（没有是 −1） */
  private goblinSlot(raid: Raid): number {
    const w = this.w;
    for (let g = 0; g < raid.gUsed; g++) {
      const i = raid.gSlot[g]!;
      if (raid.gRole[g] === Role.goblin && i >= 0 && w.eAlive[i] && w.eGen[i] === raid.gGen[g]) return i;
    }
    return -1;
  }

  /** 后半段规则的画面：鬼市摊子、宝库封条、宝妖的屏幕边箭头 */
  private drawLate(raid: Raid): void {
    const w = this.w;
    // 鬼市：开市期间三个摊子，价钱不够标红，卖掉的空着，站在摊前买的读条画在摊子上方
    if (raid.marketOpen === 1 && this.stallViews.length === 0) {
      for (let k = 0; k < raid.stallX.length; k++) {
        const x = raid.stallX[k]!, y = raid.stallY[k]!;
        const glow = this.img('haze', x, y - 52, 3).setTint(0xff9a4a).setDepth(y - 1).setAlpha(0.5);
        const img = this.img('mstall', x, y).setDepth(y);
        const icon = this.img('shadow', x, y - 46).setDepth(y + 1).setVisible(false);
        const price = this.add
          .text(x, y + 10, '', { fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffe08a', stroke: '#17131c', strokeThickness: 6 })
          .setOrigin(0.5, 0)
          .setResolution(2)
          .setDepth(y + 2);
        this.stallViews.push({ img, icon, price, glow, sig: '' });
      }
    } else if (raid.marketOpen !== 1 && this.stallViews.length > 0) {
      for (const v of this.stallViews) {
        v.img.destroy();
        v.icon.destroy();
        v.price.destroy();
        v.glow.destroy();
      }
      this.stallViews.length = 0;
    }
    this.stallViews.forEach((v, k) => {
      const sold = raid.stallSold[k] === 1;
      const afford = w.coins >= raid.stallPrice[k]!;
      const sig = `${sold ? 1 : 0}${afford ? 1 : 0}`;
      if (sig !== v.sig) {
        v.sig = sig;
        if (sold) {
          v.icon.setVisible(false);
          v.price.setText('售罄').setColor('#9aa0b0');
        } else {
          const t = TREASURES[raid.stallItem[k]!]!;
          const f = this.frame(treasureIconKey(t.icon));
          v.icon.setTexture(f.tex ?? 'atlas', f.key).setOrigin(f.ox, f.oy).setScale(1.5 / f.res).setVisible(true);
          v.price.setText(`${raid.stallPrice[k]} 钱`).setColor(afford ? '#ffe08a' : '#ff5a4a');
        }
      }
      v.glow.setAlpha(0.42 + Math.sin(this.now * 0.005 + k * 1.7) * 0.12);
    });
    if (raid.marketOpen === 1 && raid.buyStall >= 0) {
      const bp = raid.buyProgress();
      if (bp > 0) this.progressBar(raid.stallX[raid.buyStall]!, raid.stallY[raid.buyStall]! - 108, bp, 0xffd23a);
    }
    // 宝库：没开封（时辰没到或没钥匙）且没开过，金箱上贴着封条
    if (this.sealImg) {
      const sealed = raid.chestOpen[raid.vault] !== 1 && !raid.vaultReady(w.tick);
      this.sealImg.setVisible(sealed);
    }
    // 宝妖在屏幕外：屏幕边上一个橙色箭头
    const gi = raid.outcome === 'none' ? this.goblinSlot(raid) : -1;
    let ga: { x: number; y: number; dx: number; dy: number; label: string } | null = null;
    if (gi >= 0) {
      const cam = this.cameras.main;
      const cssW = this.scale.displaySize.width;
      const cssH = this.scale.displaySize.height;
      const k = cssW / (cam.width / cam.zoom);
      const gx = (w.eX[gi]! - cam.midPoint.x) * k, gy = (w.eY[gi]! - cam.midPoint.y) * k;
      const margin = 84;
      const hw = cssW / 2 - margin, hh = cssH / 2 - margin;
      if (!(gx > -hw && gx < hw && gy > -hh && gy < hh)) {
        const len = Math.hypot(gx, gy) || 1;
        const dx = gx / len, dy = gy / len;
        const t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
        // 箭头和撤离箭头撞在一起时错开一点
        ga = { x: cssW / 2 + dx * t, y: cssH / 2 + dy * t, dx, dy, label: `宝妖 · ${walkSecs(Math.hypot(w.eX[gi]! - w.x, w.eY[gi]! - w.y))} 秒` };
      }
    }
    this.d.hud.setGoblinArrow(ga);
  }

  /** 夜探 HUD 的数据：目标条（最近的门、下一批门）、背包、小地图 */
  private feedRaidHud(raid: Raid, gate: { name: string; secs: number } | null): void {
    if (!this.rhud) return;
    const w = this.w;
    let next: { names: string; secs: number } | null = null;
    if (!gate) {
      const win = raid.windows.find((x) => x.from > w.tick);
      if (win) next = { names: win.gates.length > 2 ? `${win.gates.length} 座门` : win.gates.map((g) => raid.map.gates[g]!.name).join('、'), secs: Math.ceil((win.from - w.tick) / 30) };
    }
    const xy = this.guardXY;
    xy.length = 0;
    let gob: [number, number] | null = null;
    for (let g = 0; g < raid.gUsed; g++) {
      const i = raid.gSlot[g]!;
      if (i < 0 || !w.eAlive[i] || w.eGen[i] !== raid.gGen[g]) continue;
      if (raid.gRole[g] === Role.goblin) gob = [w.eX[i]!, w.eY[i]!];
      else xy.push(w.eX[i]!, w.eY[i]!);
    }
    this.rhud.update({
      gate,
      next,
      level: w.tick >= DAWN_RED ? 2 : w.tick >= DAWN_WARN ? 1 : 0,
      teach: raid.teach,
      bag: raid.bag,
      hx: this.renderX,
      hy: this.renderY,
      chestOpen: raid.chestOpen,
      gateOpen: raid.gateOpen,
      guards: xy,
      goblin: gob,
      market: raid.marketOpen === 1 && raid.stallX.length > 0 ? [raid.stallX[1] ?? raid.stallX[0]!, raid.stallY[1] ?? raid.stallY[0]!] : null,
      vault: raid.vault >= 0 && raid.chestOpen[raid.vault] !== 1 && !raid.vaultReady(w.tick) ? raid.vault : -1,
      hasKey: raid.hasKey === 1,
    });
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
      xp: w.xp / xpNeed(w.level, !!w.raid),
      left: ((raid ? RAID_DAWN : DAWN_TICK) - w.tick) / 30,
      raid: raid ? { label: w.tick >= DAWN_WARN ? '天亮' : '离天亮', level: w.tick >= DAWN_RED ? 2 : w.tick >= DAWN_WARN ? 1 : 0, bag: raid.bag.length, value: raid.bag.reduce((a, id) => a + TREASURES[id]!.value, 0) } : undefined,
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
