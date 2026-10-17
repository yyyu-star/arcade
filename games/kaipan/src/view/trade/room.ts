import Phaser from 'phaser';
import type { Mood } from '../../core/index.ts';
import { artRef, glyphKey } from '../assets.ts';
import type { Animator } from '../fx/anim.ts';
import { sound } from '../sound.ts';
import { COLOR, GAME_HEIGHT, GAME_WIDTH, LOW_MEMORY, PHONE, RENDER_SCALE } from '../theme.ts';

/** 猫整体左移，让它从手机后面露出来，睡在开盘按钮右边的桌面上 */
const CAT_DX = -112;
/** 手机横屏：房间画缩放倍数和上移量（1280×720 → 960×540，裁掉上下各一截） */
const PHONE_K = 0.75;
const PHONE_OY = -40;

/** 小屋场景的选项 */
interface RoomOpts {
  /** 环境小动画（猫尾巴、热气、雨、闪电）；减少动态效果或关闭动画时为 false */
  ambient: boolean;
}

const MOODS: readonly Mood[] = ['bull', 'flat', 'bear'];

/** 0.15.0 小屋的一天：盘前清晨、开盘白天、收盘傍晚、月底算账夜里（art-v3 第 5 节） */
export type RoomTime = 'morning' | 'day' | 'dusk' | 'night';
const TIMES: readonly RoomTime[] = ['morning', 'day', 'dusk', 'night'];
/** 每个时段一层整屏色调（盖在房间上、台灯和显示器光下面），台灯亮几分 */
const TIME_LIGHT: Record<RoomTime, { color: number; alpha: number; lamp: number }> = {
  morning: { color: 0xfff2d6, alpha: 0.14, lamp: 0.3 },
  day: { color: 0xffffff, alpha: 0, lamp: 0.3 },
  dusk: { color: 0xff7a2e, alpha: 0.24, lamp: 0.8 },
  night: { color: 0x161b4a, alpha: 0.42, lamp: 1 },
};
/** 安全区外延伸出来的那圈（tools/art/scene.ts 的 BLEED）：宽屏、16:10 时看得见 */
const BLEED_X = 320;
const BLEED_Y = 108;
/** 整屏色调、天气压暗盖住的范围：房间连同延伸出来的那圈 */
type Box = readonly [number, number, number, number];
const ROOM_BOX: Box = [-BLEED_X, -BLEED_Y, GAME_WIDTH + BLEED_X * 2, GAME_HEIGHT + BLEED_Y * 2];

/** 窗洞（README：x 420–860，y 56–336），天色、城市、雨只在这里看得见 */
const WINDOW: Box = [416, 52, 448, 288];
/**
 * 各层的不透明范围（2026-10-10 按素材实测，外扩 5px）。整张 1280×720 的图层只画这一块，
 * 软件渲染下填充率能省一大半。
 */
const CROP: Record<string, Box> = {
  sky_bull: WINDOW,
  sky_flat: WINDOW,
  sky_bear: WINDOW,
  city: WINDOW,
  haze_bear: WINDOW,
  lightning: [640, 30, 92, 230],
  lightning_2: [442, 40, 110, 207],
  lightning_3: [722, 34, 106, 166],
  desk: [0, 288, 1280, 432],
  steam: [376, 448, 40, 68],
  cat: [870, 473, 226, 126],
  cat_tail: [994, 540, 115, 68],
  cat_zzz: [833, 409, 67, 93],
  ambient_bull: [374, 325, 619, 367],
  lamp_light: [135, 415, 390, 206],
  monitor_glow: [291, 165, 698, 560],
};

/**
 * 炒股小屋（分层背景）：窗外天色按大盘（晴 / 阴 / 雷雨）交叉淡化，雷雨天下雨、偶尔闪电；
 * 猫在睡觉（尾巴摆动、呼吸、zzz 上飘），咖啡冒热气，显示器微光。
 * 所有循环补间与计时器在场景关闭时由 Phaser 一并回收。
 */
export class Room {
  private readonly scene: Phaser.Scene;
  private readonly sky: Record<Mood, Phaser.GameObjects.Image | null>;
  private readonly ambient: Record<Mood, Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null>;
  private readonly tint: Record<RoomTime, Phaser.GameObjects.Rectangle>;
  private readonly lamp: Phaser.GameObjects.Image | null;
  private time: RoomTime = 'day';
  /** 0.17.0 开盘时灯一亮 */
  private readonly flashRect: Phaser.GameObjects.Rectangle;
  private readonly haze: Phaser.GameObjects.Image | null;
  private readonly rain: Phaser.GameObjects.TileSprite | null;
  private readonly lightning: Phaser.GameObjects.Image[] = [];
  private mood: Mood;
  private readonly opts: RoomOpts;
  private boltTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, mood: Mood, opts: RoomOpts) {
    this.scene = scene;
    this.mood = mood;
    this.opts = opts;
    const first = scene.children.list.length;
    scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLOR.bg).setOrigin(0, 0);
    /** 来自图集的图层（整张 1280×720 的帧，图集已裁掉透明边） */
    const atlased = new Set<Phaser.GameObjects.Image>();
    const layer = (name: string): Phaser.GameObjects.Image | null => {
      const key = `scene:${name}`;
      const ref = artRef(scene.textures, key);
      if (!ref) return null;
      if (ref.frame !== undefined) {
        const img = scene.add.image(0, 0, ref.tex, ref.frame).setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
        atlased.add(img);
        return img;
      }
      const box = CROP[name];
      if (!box) return scene.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      // 在原纹理上切一个子帧，只画不透明的那一块
      const [x, y, w, h] = box;
      const tex = scene.textures.get(key);
      const k = ref.px;
      if (!tex.has('crop')) tex.add('crop', 0, x * k, y * k, w * k, h * k);
      return scene.add.image(x, y, key, 'crop').setOrigin(0, 0).setDisplaySize(w, h);
    };
    this.sky = { bull: layer('sky_bull'), flat: layer('sky_flat'), bear: layer('sky_bear') };
    layer('city');
    this.haze = layer('haze_bear');
    // 0.5.1：窗外飘云（晴天白云、阴天灰云、雷雨天乌云），大涨日挂彩虹
    const [wx0, wy0, ww0] = WINDOW;
    this.rainbow = artRef(scene.textures, glyphKey('rainbow')) ? this.glyphImg('rainbow', wx0 + ww0 * 0.66, wy0 + 120, 210).setAlpha(0) : null;
    for (let i = 0; i < 3; i++) {
      const c = this.glyphImg('cloud', wx0 + 60 + i * 150, wy0 + 40 + (i % 2) * 46, 70 + (i % 2) * 24);
      if (c) this.clouds.push(c);
    }
    // 雨：只铺在窗洞里的平铺图，纹理坐标向下平移循环（周期 720）
    const [wx, wy, ww, wh] = WINDOW;
    const rainRef = artRef(scene.textures, 'scene:rain');
    const rs = rainRef?.px ?? RENDER_SCALE;
    this.rain = rainRef
      ? scene.add.tileSprite(wx, wy, ww * rs, wh * rs, rainRef.tex, rainRef.frame).setOrigin(0, 0).setScale(1 / rs).setTilePosition(wx * rs, wy * rs)
      : null;
    for (const n of ['lightning', 'lightning_2', 'lightning_3']) {
      const l = layer(n);
      if (l) this.lightning.push(l.setAlpha(0));
    }
    layer('wall');
    layer('desk');
    // 0.15.0 铺满：安全区外的墙和桌（没加载到就露底色，和以前一样）
    const strip = (name: string, x: number, y: number, w: number, h: number): void => {
      const ref = artRef(scene.textures, `scene:${name}`);
      if (ref) scene.add.image(x, y, ref.tex, ref.frame).setOrigin(0, 0).setDisplaySize(w, h);
    };
    strip('room_left', -BLEED_X, -BLEED_Y, BLEED_X, GAME_HEIGHT + BLEED_Y * 2);
    strip('room_right', GAME_WIDTH, -BLEED_Y, BLEED_X, GAME_HEIGHT + BLEED_Y * 2);
    strip('room_top', 0, -BLEED_Y, GAME_WIDTH, BLEED_Y);
    strip('room_bottom', 0, GAME_HEIGHT, GAME_WIDTH, BLEED_Y);
    const steam = layer('steam');
    // 猫（整体平移；尾巴绕 (1066, 556) 摆动，身体绕 (985, 584) 呼吸）
    const cat = layer('cat');
    const tail = layer('cat_tail');
    const zzz = layer('cat_zzz');
    const pivot = (img: Phaser.GameObjects.Image | null, name: string, px: number, py: number): void => {
      const b = CROP[name];
      if (!img || !b) return;
      // 图集帧按整张画布定原点；单独纹理只画裁出的那一块
      if (atlased.has(img)) img.setOrigin(px / GAME_WIDTH, py / GAME_HEIGHT).setPosition(px + CAT_DX, py);
      else img.setOrigin((px - b[0]) / b[2], (py - b[1]) / b[3]).setPosition(px + CAT_DX, py);
    };
    pivot(cat, 'cat', 985, 584);
    pivot(tail, 'cat_tail', 1066, 556);
    zzz?.setX(zzz.x + CAT_DX);
    // 阴天、雨天的室内压暗是纯色：直接画矩形，连延伸出来的那圈一起盖住
    const [bx, by, bw, bh] = ROOM_BOX;
    const wash = (color: number, alpha: number): Phaser.GameObjects.Rectangle => scene.add.rectangle(bx, by, bw, bh, color, alpha).setOrigin(0, 0);
    this.ambient = { bull: layer('ambient_bull'), flat: wash(0x6a7690, 0.12), bear: wash(0x1c1f45, 0.34) };
    const tintOf = (t: RoomTime): Phaser.GameObjects.Rectangle => wash(TIME_LIGHT[t].color, TIME_LIGHT[t].alpha).setAlpha(t === this.time ? 1 : 0);
    this.tint = { morning: tintOf('morning'), day: tintOf('day'), dusk: tintOf('dusk'), night: tintOf('night') };
    this.flashRect = wash(0xfff6dc, 0.45).setAlpha(0);
    const lamp = layer('lamp_light');
    this.lamp = lamp;
    const glow = layer('monitor_glow');
    lamp?.setBlendMode(Phaser.BlendModes.SCREEN);
    glow?.setBlendMode(Phaser.BlendModes.ADD);
    this.applyMood(mood);
    if (!LOW_MEMORY) lamp?.setAlpha(TIME_LIGHT[this.time].lamp);
    // 手机横屏：房间是装饰（没有字），整张 1280×720 的画缩到 0.75 铺满 960×444，窗户留在画面里
    if (PHONE) {
      const made = scene.children.list.slice(first);
      this.layer = scene.add.container(0, PHONE_OY, made).setScale(PHONE_K).setDepth(0);
      scene.children.sendToBack(this.layer);
    }

    if (opts.ambient) {
      this.clouds.forEach((c, i) => {
        const span = ww0 + 120;
        const dur = 26000 + i * 7000;
        const startX = c.x;
        scene.tweens.add({
          targets: c,
          x: { from: startX, to: startX + span },
          duration: dur * (1 - (startX - wx0 + 60) / span),
          onComplete: () => {
            c.x = wx0 - 60;
            scene.tweens.add({ targets: c, x: wx0 + ww0 + 60, duration: dur, repeat: -1 });
          },
        });
      });
    }

    if (!opts.ambient) return;
    const tw = scene.tweens;
    if (tail) tw.add({ targets: tail, angle: { from: -3, to: 3 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (cat) tw.add({ targets: cat, scaleY: cat.scaleY * 1.012, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (zzz) tw.add({ targets: zzz, y: { from: zzz.y + 6, to: zzz.y - 14 }, alpha: { from: 0, to: 1 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (steam) tw.add({ targets: steam, y: { from: steam.y + 4, to: steam.y - 8 }, alpha: { from: 0.35, to: 1 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (glow) tw.add({ targets: glow, alpha: { from: 0.75, to: 1 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (this.rain) {
      const y0 = this.rain.tilePositionY;
      tw.add({ targets: this.rain, tilePositionY: { from: y0, to: y0 - GAME_HEIGHT * rs }, duration: 900, repeat: -1 });
    }
    this.scheduleBolt();
  }

  private rainbow: Phaser.GameObjects.Image | null = null;
  /** 手机横屏时房间的所有图层装在这里整体缩放 */
  private layer: Phaser.GameObjects.Container | null = null;

  /** 房间坐标（1280×720）换成世界坐标：手机上房间整体缩小、上移。 */
  private wx(x: number): number {
    return PHONE ? x * PHONE_K : x;
  }
  private wy(y: number): number {
    return PHONE ? y * PHONE_K + PHONE_OY : y;
  }
  private readonly clouds: Phaser.GameObjects.Image[] = [];

  /** 窗洞里的一个小图标（云、彩虹）：只在窗洞范围内画，超出的部分被墙盖住。 */
  private glyphImg(name: string, x: number, y: number, size: number): Phaser.GameObjects.Image {
    const ref = artRef(this.scene.textures, `glyph:${name}`);
    const img = ref ? this.scene.add.image(x, y, ref.tex, ref.frame) : this.scene.add.image(x, y, '__WHITE').setVisible(false);
    img.setDisplaySize(size, size);
    return img;
  }

  /** 大涨日窗外挂彩虹（淡入），其余时候收起。 */
  setRainbow(on: boolean): void {
    const r = this.rainbow;
    if (!r) return;
    const to = on ? 0.92 : 0;
    if (Math.abs(r.alpha - to) < 0.01) return;
    this.scene.tweens.killTweensOf(r);
    if (this.opts.ambient) this.scene.tweens.add({ targets: r, alpha: to, duration: 900 });
    else r.setAlpha(to);
  }

  /**
   * 收盘的房间反馈：赚了从天花板掉金币、亮几颗星；亏了窗前飘过一朵乌云。不阻塞结算，动画关闭时不放。
   */
  celebrate(anim: Animator, ret: number): void {
    if (anim.instant || !this.opts.ambient) return;
    const sc = this.scene;
    if (ret >= 0.3) {
      const n = Math.min(16, 6 + Math.round(ret * 3));
      for (let i = 0; i < n; i++) {
        const x = this.wx(300 + Math.random() * 640);
        const c = this.glyphOr('fx:coin', x, -20, 22 + Math.random() * 10).setDepth(140);
        sc.tweens.add({ targets: c, y: this.wy(470 + Math.random() * 90), angle: (Math.random() - 0.5) * 360, delay: i * 70, duration: 700 + Math.random() * 300, ease: 'Bounce.easeOut', onComplete: () => sc.tweens.add({ targets: c, alpha: 0, duration: 400, delay: 300, onComplete: () => c.destroy() }) });
      }
      for (let i = 0; i < 6; i++) {
        const st = this.glyphImg('star', this.wx(340 + Math.random() * 600), this.wy(80 + Math.random() * 120), 20).setDepth(140).setAlpha(0);
        sc.tweens.add({ targets: st, alpha: { from: 0, to: 1 }, scale: { from: st.scale * 0.4, to: st.scale * 1.2 }, yoyo: true, delay: 200 + i * 120, duration: 360, onComplete: () => st.destroy() });
      }
    } else if (ret <= -0.3) {
      const [wx, wy, ww] = WINDOW;
      const cloud = this.glyphImg('storm', wx - 40, wy + 70, 120).setTint(0x8a8aa0).setAlpha(0).setDepth(2);
      // 窗外的乌云属于房间：手机上跟着房间一起缩放
      this.layer?.add(cloud);
      sc.tweens.add({ targets: cloud, x: wx + ww * 0.55, alpha: { from: 0, to: 0.95 }, duration: 1200, ease: 'Sine.easeOut', onComplete: () => sc.tweens.add({ targets: cloud, alpha: 0, x: cloud.x + 80, duration: 1400, delay: 900, onComplete: () => cloud.destroy() }) });
    }
  }

  private glyphOr(key: string, x: number, y: number, size: number): Phaser.GameObjects.Image {
    const ref = artRef(this.scene.textures, key);
    const img = ref ? this.scene.add.image(x, y, ref.tex, ref.frame) : this.scene.add.image(x, y, '__WHITE').setVisible(false);
    return img.setDisplaySize(size, size);
  }

  get currentMood(): Mood {
    return this.mood;
  }

  /** 切换天气：天色与室内光交叉淡化；动画关闭时直接切。 */
  setMood(mood: Mood, anim: Animator | null): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!anim || anim.instant) {
      this.applyMood(mood);
      return;
    }
    for (const m of MOODS) {
      for (const img of [this.sky[m], this.ambient[m]]) {
        if (!img) continue;
        this.scene.tweens.killTweensOf(img);
        anim.fx({ targets: img, alpha: m === mood ? 1 : 0, duration: 600 }, () => img.setAlpha(m === mood ? 1 : 0));
      }
    }
    const bear = mood === 'bear' ? 1 : 0;
    for (const img of [this.haze, this.rain]) {
      if (img) anim.fx({ targets: img, alpha: bear, duration: 600 }, () => img.setAlpha(bear));
    }
    this.tintClouds(mood);
    if (mood === 'bear' && this.opts.ambient) this.scene.time.delayedCall(450, () => this.bolt());
  }

  /**
   * 换时段：整屏色调交叉淡化 0.5 秒、台灯跟着亮暗。减少动态效果、关了动画时直接换；
   * 省内存设备只换色调，台灯不动（art-v3：省内存不加光层）。
   */
  setTime(time: RoomTime, anim: Animator | null): void {
    if (time === this.time) return;
    this.time = time;
    const fade = !!anim && !anim.instant && this.opts.ambient;
    const to = (img: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle, alpha: number): void => {
      this.scene.tweens.killTweensOf(img);
      if (fade && anim) anim.fx({ targets: img, alpha, duration: 500 }, () => img.setAlpha(alpha));
      else img.setAlpha(alpha);
    };
    for (const t of TIMES) to(this.tint[t], t === time ? 1 : 0);
    if (this.lamp && !LOW_MEMORY) to(this.lamp, TIME_LIGHT[time].lamp);
  }

  /** 0.17.0 开盘：屋里灯一亮（一闪 0.3 秒，不占节拍）；减少动态效果时不闪。 */
  flashLights(anim: Animator): void {
    if (anim.calm || !this.opts.ambient) return;
    const r = this.flashRect;
    this.scene.tweens.killTweensOf(r);
    anim.fx({ targets: r, alpha: { from: 0, to: 1 }, duration: 110, yoyo: true, hold: 60, ease: 'Quad.easeOut' }, () => r.setAlpha(0));
  }

  private tintClouds(mood: Mood): void {
    const tint = mood === 'bull' ? 0xffffff : mood === 'flat' ? 0xc8c4d4 : 0x6e6a82;
    for (const c of this.clouds) c.setTint(tint).setAlpha(mood === 'bull' ? 0.85 : 0.95);
  }

  private applyMood(mood: Mood): void {
    this.tintClouds(mood);
    for (const m of MOODS) {
      this.sky[m]?.setAlpha(m === mood ? 1 : 0);
      this.ambient[m]?.setAlpha(m === mood ? 1 : 0);
    }
    const bear = mood === 'bear' ? 1 : 0;
    this.haze?.setAlpha(bear);
    this.rain?.setAlpha(bear);
  }

  /** 雷雨天每隔 5–11 秒随机闪一道闪电。 */
  private scheduleBolt(): void {
    this.boltTimer = this.scene.time.delayedCall(5000 + Math.random() * 6000, () => {
      if (this.mood === 'bear') this.bolt();
      this.scheduleBolt();
    });
  }

  private bolt(): void {
    if (!this.opts.ambient || this.lightning.length === 0 || !this.scene.sys.isActive()) return;
    const l = this.lightning[Math.floor(Math.random() * this.lightning.length)];
    if (!l) return;
    this.scene.tweens.add({ targets: l, alpha: { from: 1, to: 0 }, duration: 380, ease: 'Quad.easeIn' });
    sound.cue({ type: 'thunder' });
  }

  destroy(): void {
    this.boltTimer?.remove();
  }
}
