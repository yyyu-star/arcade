/**
 * 远景和纸边（DESIGN.md 第 3、4 节）：整张图是一页画本，下面越往下越虚；左、右、下三边是撕开的纸边，纸边外是书桌（画外）。
 * 远景（按地图的主题：厨房、冰淇淋店、雪夜……往下淡成雾，见 backdrops.ts）开局整张烘焙成一张低分辨率的图，放在镜头那一层里，镜头动时只挪这一张；
 * 纸边是玩法边界，要清楚：每帧按矢量描（几百个点，很便宜）。
 */
import { lcg, paintBackdrop, THEMES, type ThemeId } from './backdrops.ts';
import { INK } from './palette.ts';

/** 烘焙的范围（世界坐标）：比画本大一圈（左右各 700），镜头拉远、拖到边上也有东西；宽按地图宽算（0.4.0 的寿司长台 3600 宽） */
const BX0 = -700;
const BY0 = -900;
const BMARGIN = 1400;
const BH = 2100;
const BAKE = 0.4;

export class Backdrop {
  private canvas: HTMLCanvasElement;
  /** 纸边的折线（左边从上到下、底边从左到右、右边从下到上） */
  readonly edge: Path2D;

  readonly width: number;
  /** 烘焙的宽（世界单位）：地图宽 + BMARGIN */
  private readonly bw: number;
  readonly height: number;
  private theme: ThemeId;

  constructor(width: number, height: number, theme: ThemeId) {
    this.width = width;
    this.bw = width + BMARGIN;
    this.height = height;
    this.theme = theme;
    const r = lcg(13);
    const jag = (n: number): number => (r() - 0.5) * n;
    const pts: [number, number][] = [];
    for (let y = BY0; y <= height; y += 16) pts.push([jag(9), y]);
    for (let x = 0; x <= width; x += 16) pts.push([x, height + jag(9)]);
    for (let y = height; y >= BY0; y -= 16) pts.push([width + jag(9), y]);
    this.edge = new Path2D();
    this.edge.moveTo(pts[0]![0], pts[0]![1]);
    for (const p of pts) this.edge.lineTo(p[0], p[1]);
    this.canvas = this.bake(pts);
  }

  private bake(pts: [number, number][]): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.ceil(this.bw * BAKE);
    c.height = Math.ceil(BH * BAKE);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(BAKE, 0, 0, BAKE, -BX0 * BAKE, -BY0 * BAKE);
    const W = this.width;
    const H = this.height;
    // 远景：按地图的主题画（美术的 backdrops.ts），墙 / 天空 + 装饰 + 往下淡成的雾
    paintBackdrop(ctx, this.theme, W, H, { x0: BX0, y0: BY0, w: this.bw, h: BH });
    const th = THEMES[this.theme];
    const f = lcg(31);
    // 纸边外是书桌：深色 + 木纹
    ctx.save();
    const page = new Path2D();
    page.moveTo(pts[0]![0], pts[0]![1]);
    for (const p of pts) page.lineTo(p[0], p[1]);
    page.closePath();
    const outside = new Path2D();
    outside.rect(BX0, BY0, this.bw, BH);
    outside.addPath(page);
    ctx.fillStyle = th.desk;
    ctx.fill(outside, 'evenodd');
    ctx.clip(outside, 'evenodd');
    ctx.strokeStyle = th.deskLine;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let y = H + 30; y < BY0 + BH; y += 22) {
      ctx.moveTo(BX0, y);
      for (let x = BX0; x < BX0 + this.bw; x += 600) ctx.quadraticCurveTo(x + 300, y + (f() - 0.5) * 14, x + 600, y);
    }
    for (let x = -40; x > BX0; x -= 22) {
      ctx.moveTo(x, BY0);
      ctx.lineTo(x, BY0 + BH);
      ctx.moveTo(W - x, BY0);
      ctx.lineTo(W - x, BY0 + BH);
    }
    ctx.stroke();
    ctx.restore();
    return c;
  }

  /** 放进镜头那一层（world，按世界坐标摆）：镜头动时由合成器去挪、去缩放 */
  mount(layer: HTMLElement): void {
    const st = this.canvas.style;
    st.position = 'absolute';
    st.left = `${BX0}px`;
    st.top = `${BY0}px`;
    st.width = `${this.bw}px`;
    st.height = `${BH}px`;
    layer.prepend(this.canvas);
  }

  /** 纸边：一道亮的毛边 + 墨线 + 纸往桌上投一点影；lw 是屏幕上 1 像素对应的世界单位 */
  drawEdge(ctx: CanvasRenderingContext2D, lw: number): void {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.translate(3 * lw, 4 * lw);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 8 * lw;
    ctx.stroke(this.edge);
    ctx.restore();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fbf5e6';
    ctx.lineWidth = 6 * lw;
    ctx.stroke(this.edge);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * lw;
    ctx.stroke(this.edge);
  }
}
