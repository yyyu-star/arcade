/**
 * 空气墙看得见（所有者 10-20：边界和不可走的地方要一眼看出来）：
 * 守夜场地四边画一圈栅栏（按地图换样子），栅栏外盖一层夜雾；主角顶着墙、块或边界还在往前推时，
 * 接触点冒火星、墙段闪一下、轻震一下屏。只读核心的位置和输入，不改规则。
 */
import type Phaser from 'phaser';
import type { World } from '../../core/state.ts';
import { inputCos, inputSin } from '../../core/fmath.ts';
import type { MapDef } from '../../content/maps.ts';

/** 柱子、横杆的颜色：雪原冰湖木栅栏，竹林竹篱，河滩石堤，义庄院墙 */
const LOOK: Record<string, { post: number; rail: number; postW: number; gap: number; solid?: boolean }> = {
  snow: { post: 0x5a3a22, rail: 0x8a5a32, postW: 12, gap: 70 },
  ice: { post: 0x4a3a32, rail: 0x7a6250, postW: 12, gap: 70 },
  bamboo: { post: 0x2f6a2c, rail: 0x5a9a3c, postW: 10, gap: 36 },
  river: { post: 0x4a4a52, rail: 0x7a7a84, postW: 40, gap: 46, solid: true },
  yizhuang: { post: 0x3a3238, rail: 0x8a8088, postW: 30, gap: 60, solid: true },
};
const INK = 0x17131c;
/** 栅栏外那圈雾的颜色（夜蓝） */
const FOG = 0x1c2338;

export function drawArenaWall(scene: Phaser.Scene, aw: number, ah: number, def: MapDef): void {
  const look = LOOK[def.tone ?? 'snow'] ?? LOOK.snow!;
  const g = scene.add.graphics().setDepth(-900);
  // 栅栏外：一层实雾 + 往里三道渐淡，墙外一看就是"出不去"
  g.fillStyle(FOG, 0.72);
  g.fillRect(-400, -400, aw + 800, 400);
  g.fillRect(-400, ah, aw + 800, 400);
  g.fillRect(-400, 0, 400, ah);
  g.fillRect(aw, 0, 400, ah);
  for (let i = 1; i <= 3; i++) {
    const d = i * 14;
    g.fillStyle(FOG, 0.14 / i);
    g.fillRect(0, 0, aw, d);
    g.fillRect(0, ah - d, aw, d);
    g.fillRect(0, d, d, ah - 2 * d);
    g.fillRect(aw - d, d, d, ah - 2 * d);
  }
  // 两道横杆（或一道实墙）贴着边，主角最远能走到离边 20 的地方，正好顶到墙
  const t = look.solid ? 14 : 5;
  g.fillStyle(INK, 1);
  for (const [x, y, w, h] of edges(aw, ah, t + 4)) g.fillRect(x, y, w, h);
  g.fillStyle(look.rail, 1);
  for (const [x, y, w, h] of edges(aw, ah, t)) g.fillRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
  // 柱子：沿四边等距
  const p = look.postW;
  const post = (x: number, y: number): void => {
    g.fillStyle(INK, 1);
    g.fillRect(x - p / 2 - 2, y - p / 2 - 2, p + 4, p + 4);
    g.fillStyle(look.post, 1);
    g.fillRect(x - p / 2, y - p / 2, p, p);
  };
  for (let x = 0; x <= aw; x += look.gap) {
    post(x, 0);
    post(x, ah);
  }
  for (let y = look.gap; y < ah; y += look.gap) {
    post(0, y);
    post(aw, y);
  }
}

/** 贴着四边、厚 t 的四条 */
function edges(aw: number, ah: number, t: number): [number, number, number, number][] {
  return [
    [-t / 2, -t / 2, aw + t, t],
    [-t / 2, ah - t / 2, aw + t, t],
    [-t / 2, -t / 2, t, ah + t],
    [aw - t / 2, -t / 2, t, ah + t],
  ];
}

/**
 * 撞墙：有输入但这一拍几乎没走动（被边界、墙、石头、房子挡下），隔一会儿反馈一次。
 * 冰上滑、水里慢都不算（水里也有一半速度，远高于门槛）。
 */
export class Bump {
  private x0 = 0;
  private y0 = 0;
  private dir = 0;
  private until = 0;

  before(w: World, dir: number): void {
    this.x0 = w.x;
    this.y0 = w.y;
    this.dir = w.phase === 'play' ? dir : 0;
  }

  /** 撞上了就返回接触点和推的方向；冷却中或没撞返回 null */
  after(w: World, now: number, speed: number): { x: number; y: number; cx: number; cy: number } | null {
    if (this.dir === 0 || w.phase !== 'play' || now < this.until) return null;
    const dx = w.x - this.x0;
    const dy = w.y - this.y0;
    if (dx * dx + dy * dy > speed * speed * 0.04) return null;
    if (w.ice.length > 0 && (w.pvx !== 0 || w.pvy !== 0)) return null;
    this.until = now + 650;
    const cx = inputCos(this.dir);
    const cy = inputSin(this.dir);
    return { x: w.x + cx * 22, y: w.y + cy * 22, cx, cy };
  }
}
