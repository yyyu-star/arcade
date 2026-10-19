/**
 * 赛道和车（DESIGN.md 第 8 节）：一张 SVG。地图板（mapart.ts）开局烘焙成一张位图；上面依次是标注（限速盾牌、格号、制动牌、弯名，跟着缩放重画）、
 * 落点虚影、棋子、飘字。走车一格一格地走（不是瞬移），冲刺带尾焰、尾流带风线、打滑转一圈退回。
 *
 * 镜头（DESIGN.md 8"镜头"）：方向固定、只平移缩放，不跟着车转（发夹弯里整张图转来转去会晕，也记不住在哪一段）。
 * - 两种看法：跟车（屏幕上 1 个单位约 1 像素，车放在画面偏后、往前多看几格）和全图。手机默认跟车，电脑默认全图；
 * - 跟车时出牌：落点和路上要过的弯放不进画面就缩小，框住我的车、落点和这些弯的牌子；落点变近时等一会儿再放大回去，不来回抖；
 * - 车走的时候镜头跟着我的车，别人的车不追；画面外的车在屏幕边上显示一个小牌（颜色、号码、比我前后几格）；
 * - 手动拖动、缩放以后不再自动动，下一回合恢复；系统"减少动态效果"时直接跳到位。
 * 竖屏时整张图顺时针转 90°（三条赛道都是横的），字转回正向。
 */
import { cellOf, type Pt } from '../track/shape.ts';
import type { Track } from '../track/types.ts';
import type { Ev } from '../core/types.ts';
import { flameSvg } from './cards.ts';
import { LOD, MAP_DEFS, mapArt, type MapArt } from './mapart.ts';
import { ME_RING, pieceMarkup } from './piece.ts';
import { CAR_COLORS } from './text.ts';

const NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export interface BoardCar {
  seat: number;
  pos: number;
  lane: number;
  /** 冲线离场了（半透明） */
  out: boolean;
}

interface CarGlyph {
  g: SVGGElement;
  num: SVGTextElement | null;
  pos: number;
  lane: number;
  x: number;
  y: number;
  angle: number;
}

type Cam = { x: number; y: number; w: number; h: number };

/** 纹理文件 → data URL（烘焙位图时内联进 SVG；同一个页面只读一次） */
const textureCache = new Map<string, Promise<string>>();
async function textures(src: string): Promise<[string, string][]> {
  const hrefs = [...new Set([...src.matchAll(/href="(art\/[a-z]+\.webp)"/g)].map((m) => m[1]!))];
  return Promise.all(
    hrefs.map(async (href): Promise<[string, string]> => {
      let p = textureCache.get(href);
      if (!p) {
        p = fetch(href)
          .then((r) => r.blob())
          .then(
            (b) =>
              new Promise<string>((ok, bad) => {
                const fr = new FileReader();
                fr.onload = () => ok(String(fr.result));
                fr.onerror = bad;
                fr.readAsDataURL(b);
              }),
          );
        textureCache.set(href, p);
      }
      return [href, await p];
    }),
  );
}

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const coarse = (): boolean => window.matchMedia?.('(pointer: coarse)').matches ?? false;

function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 落点变近时等这么久再放大回去 */
const SETTLE_MS = 700;

export class Board {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly scenery: SVGGElement;
  private readonly labelLayer: SVGGElement;
  private readonly ghost: SVGGElement;
  private readonly carLayer: SVGGElement;
  private readonly fxLayer: SVGGElement;
  private readonly edges: HTMLElement;
  private readonly art: MapArt;
  private readonly track: Track;
  private readonly cars = new Map<number, CarGlyph>();
  private readonly edgeChips = new Map<number, HTMLElement>();
  /** 镜头"全图"的框（转过的坐标） */
  private box: Cam = { x: 0, y: 0, w: 1, h: 1 };
  private cam: Cam = { x: 0, y: 0, w: 1, h: 1 };
  /** 竖屏时整张图顺时针转 90° */
  private turned: boolean | null = null;
  /** 玩家选的看法；free 是手动拖过、缩放过（这回合不再自动动） */
  private pref: 'follow' | 'full' = coarse() ? 'follow' : 'full';
  private free = false;
  private me: number | null = null;
  private round = -1;
  private ghostAt: { pos: number; lane: number } | null = null;
  private settleTimer = 0;
  private flyId = 0;
  private labelKey = '';
  private nextCorner = -1;
  /** 动画速度倍数（单机"快"是 0.5） */
  speed = 1;
  private readonly fullBtn: HTMLButtonElement;
  private readonly followBtn: HTMLButtonElement;
  private readonly resize: ResizeObserver;

  constructor(parent: HTMLElement, track: Track) {
    this.track = track;
    this.art = mapArt(track);
    this.root = document.createElement('div');
    this.root.className = 'board';
    parent.appendChild(this.root);
    this.svg = svgEl('svg', { class: 'board-svg', preserveAspectRatio: 'xMidYMid meet' }, this.root);
    svgEl('defs', {}, this.svg).innerHTML = MAP_DEFS;
    this.world = svgEl('g', {}, this.svg);
    // 静止的地图板单独一组（开局后烘焙成位图），标注、虚影、车、飘字在它上面
    this.scenery = svgEl('g', { class: 'scenery' }, this.world);
    this.labelLayer = svgEl('g', { class: 'labels' }, this.world);
    this.ghost = svgEl('g', { class: 'ghost' }, this.world);
    this.carLayer = svgEl('g', { class: 'cars' }, this.world);
    this.fxLayer = svgEl('g', { class: 'fx' }, this.world);
    this.edges = document.createElement('div');
    this.edges.className = 'edges';
    this.root.appendChild(this.edges);
    const tools = document.createElement('div');
    tools.className = 'board-tools';
    this.root.appendChild(tools);
    this.fullBtn = document.createElement('button');
    this.fullBtn.type = 'button';
    this.fullBtn.textContent = '全图';
    this.fullBtn.addEventListener('click', () => this.choose('full'));
    this.followBtn = document.createElement('button');
    this.followBtn.type = 'button';
    this.followBtn.textContent = '跟车';
    this.followBtn.addEventListener('click', () => this.choose('follow'));
    tools.append(this.fullBtn, this.followBtn);
    this.layout();
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.root);
    this.paintTools();
    this.bindGestures();
  }

  // ---------- 摆图 ----------

  /** 按舞台的横竖摆图：竖屏时整张图转 90°、字转回正向；换了方向就重画地图板、重新烘焙 */
  private layout(): void {
    const r = this.root.getBoundingClientRect();
    // 还量不到尺寸时先按横屏画，量到了再说
    const turned = r.width > 10 && r.height > r.width * 1.15;
    if (turned === this.turned) {
      this.home(false);
      return;
    }
    this.turned = turned;
    const b = this.art.board;
    this.world.setAttribute('transform', turned ? 'rotate(90)' : '');
    // 板子外面留一点桌面
    const m = 16;
    this.box = turned ? { x: -(b.y + b.h) - m, y: b.x - m, w: b.h + 2 * m, h: b.w + 2 * m } : { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
    this.scenery.innerHTML = this.art.draw({ detail: true, rot: turned });
    for (const c of this.cars.values()) this.put(c, c.x, c.y, c.angle);
    this.labelKey = '';
    this.cam = { ...this.box };
    this.home(false);
    void this.bake();
  }

  // ---------- 车 ----------

  private spot(pos: number, lane: number): { p: Pt; angle: number } {
    const cell = this.art.geo.cells[cellOf(this.track, pos)]!;
    return { p: cell.spots[lane === 0 ? 0 : 1], angle: cell.angle };
  }

  private glyph(seat: number): CarGlyph {
    let c = this.cars.get(seat);
    if (c) return c;
    const g = svgEl('g', { class: 'car' }, this.carLayer);
    g.innerHTML = ME_RING + pieceMarkup(seat);
    c = { g, num: g.querySelector('.num'), pos: 0, lane: 0, x: 0, y: 0, angle: 0 };
    this.cars.set(seat, c);
    return c;
  }

  private put(c: CarGlyph, x: number, y: number, angle: number): void {
    c.x = x;
    c.y = y;
    c.angle = angle;
    const deg = (angle * 180) / Math.PI;
    c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})`);
    // 号码不跟着车转，竖屏时再转回整张图转掉的 90°
    c.num?.setAttribute('transform', `rotate(${(-deg - (this.turned ? 90 : 0)).toFixed(1)} -2 0)`);
  }

  /** 摆好所有车（不放动画） */
  setCars(list: BoardCar[], me: number | null): void {
    this.me = me;
    this.paintTools();
    for (const car of list) {
      const c = this.glyph(car.seat);
      c.pos = car.pos;
      c.lane = car.lane;
      const s = this.spot(car.pos, car.lane);
      this.put(c, s.p.x, s.p.y, s.angle);
      c.g.classList.toggle('out', car.out);
      c.g.classList.toggle('me', car.seat === me);
    }
    this.markNext();
    if (this.following() && !this.ghostAt) this.home(false);
    else this.paintEdges();
  }

  /** 新的一回合：手动拖过的镜头恢复自动 */
  newRound(round: number): void {
    if (round === this.round) return;
    this.round = round;
    this.free = false;
    this.paintTools();
    this.home(true);
  }

  /** 我的车前面的下一个弯：盾牌描金边（静止的，不放动画） */
  private markNext(): void {
    const c = this.me === null ? undefined : this.cars.get(this.me);
    let at = -1;
    if (c && !c.g.classList.contains('out')) {
      const N = this.track.spaces;
      const cell = cellOf(this.track, c.pos);
      let best = Infinity;
      // 停在弯道线前一格的车，下一步就要过这个弯
      for (const k of this.track.corners) {
        const d = (k.at - cell - 1 + N) % N;
        if (d < best) {
          best = d;
          at = k.at;
        }
      }
    }
    if (at === this.nextCorner) return;
    this.nextCorner = at;
    this.paintLabels();
  }

  /** 选牌时的落点预览：pos 是要停的格（null 是不画），kind 是会不会付热量、打滑 */
  preview(pos: number | null, lane: number, kind: 'ok' | 'pay' | 'spin' = 'ok'): void {
    this.ghost.replaceChildren();
    const same = pos === null ? !this.ghostAt : pos === this.ghostAt?.pos && lane === this.ghostAt?.lane;
    this.ghostAt = pos === null || this.me === null ? null : { pos, lane };
    if (this.ghostAt) {
      const s = this.spot(this.ghostAt.pos, lane);
      const g = svgEl('g', { class: `ghost-car ${kind}`, transform: `translate(${s.p.x.toFixed(1)} ${s.p.y.toFixed(1)}) rotate(${((s.angle * 180) / Math.PI).toFixed(1)})` }, this.ghost);
      svgEl('rect', { x: -16, y: -9, width: 34, height: 18, rx: 7 }, g);
    }
    if (same || !this.following()) return;
    // 要缩小（放不下）马上缩；要放大（落点变近、收回了预览）等一会儿，免得点一张牌画面抖一下
    window.clearTimeout(this.settleTimer);
    const target = this.target();
    if (target.w > this.cam.w * 1.02) this.flyTo(target);
    else this.settleTimer = window.setTimeout(() => this.following() && this.flyTo(this.target()), SETTLE_MS);
  }

  // ---------- 动画 ----------

  /** 按顺序放这一步的事；放完车停在事件里的最终位置 */
  async play(events: readonly Ev[]): Promise<void> {
    const fast = reduceMotion();
    for (const e of events) {
      switch (e.e) {
        case 'reveal':
          this.float(e.seat, `${e.speed}`, 'speed');
          if (!fast) await wait(220 * this.speed);
          break;
        case 'stall':
          this.float(e.seat, '熄火', 'bad');
          if (!fast) await wait(500 * this.speed);
          break;
        case 'move':
          await this.drive(e.seat, e.from, e.to, e.lane, e.why, fast);
          break;
        case 'boost':
          this.float(e.seat, `冲刺 +${e.value}`, 'boost');
          break;
        case 'cool':
          this.float(e.seat, `散热 ${e.n}`, 'cool');
          break;
        case 'corner':
          if (e.paid > 0) {
            this.float(e.seat, `−${e.paid}`, 'heat', true);
            if (!fast) await wait(300 * this.speed);
          }
          break;
        case 'spin':
          this.float(e.seat, '打滑！', 'bad');
          break;
        case 'finish':
          this.float(e.seat, e.rank === 0 ? '冠军！' : `第 ${e.rank + 1}`, 'finish');
          break;
        default:
          break;
      }
    }
  }

  private async drive(seat: number, from: number, to: number, lane: number, why: string, fast: boolean): Promise<void> {
    const c = this.glyph(seat);
    const end = this.spot(to, lane);
    const mine = seat === this.me;
    if (mine) this.preview(null, 0);
    if (fast || from === to) {
      c.pos = to;
      c.lane = lane;
      this.put(c, end.p.x, end.p.y, end.angle);
      if (mine && this.following()) this.home(false);
      else this.paintEdges();
      return;
    }
    // 途经每一格的中线，最后落到车位
    const pts: { x: number; y: number; a: number }[] = [{ x: c.x, y: c.y, a: c.angle }];
    const dir = to > from ? 1 : -1;
    for (let p = from + dir; p !== to; p += dir) {
      const cell = this.art.geo.cells[cellOf(this.track, p)]!;
      pts.push({ x: cell.c.x, y: cell.c.y, a: cell.angle });
    }
    pts.push({ x: end.p.x, y: end.p.y, a: end.angle });
    const per = Math.max(45, Math.min(110, 700 / pts.length)) * this.speed;
    const total = per * (pts.length - 1);
    if (why === 'boost') this.trail(c, 'flame', total);
    if (why === 'slip') this.trail(c, 'wind', total);
    const spin = why === 'spin';
    // 镜头跟着我的车：停掉正在飞的镜头，免得两个动画抢
    if (mine && this.following()) {
      this.flyId++;
      window.clearTimeout(this.settleTimer);
    }
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number): void => {
        // rAF 给的时间戳可能比 t0 还早一点
        const k = Math.max(0, Math.min(1, (now - t0) / total));
        const f = k * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(f));
        const u = f - i;
        const a = pts[i]!;
        const b = pts[i + 1]!;
        let da = b.a - a.a;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const ang = a.a + da * u + (spin ? k * Math.PI * 2 : 0);
        this.put(c, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, ang);
        if (mine && this.following()) this.home(false);
        else this.paintEdges();
        if (k < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    c.pos = to;
    c.lane = lane;
    this.put(c, end.p.x, end.p.y, end.angle);
    if (mine) this.markNext();
  }

  /** 尾焰、风线：挂在车上，过一会儿淡出 */
  private trail(c: CarGlyph, kind: 'flame' | 'wind', ms: number): void {
    const g = svgEl('g', { class: `trail ${kind}` }, c.g);
    if (kind === 'flame') {
      svgEl('path', { d: 'M-16 -4L-32 0L-16 4Z' }, g);
      svgEl('path', { d: 'M-16 -2L-25 0L-16 2Z', class: 'core' }, g);
    } else {
      for (const y of [-9, 0, 9]) svgEl('line', { x1: -20, y1: y, x2: -40, y2: y }, g);
    }
    window.setTimeout(() => g.remove(), ms + 250);
  }

  /** 车上方冒一行字往上飘 */
  private float(seat: number, text: string, kind: string, flame = false): void {
    const c = this.cars.get(seat);
    if (!c) return;
    // 竖屏整张图转了 90°，字转回来
    const holder = this.turned ? svgEl('g', { transform: `rotate(-90 ${c.x.toFixed(1)} ${c.y.toFixed(1)})` }, this.fxLayer) : this.fxLayer;
    const t = svgEl('g', { class: `float ${kind}` }, holder);
    const done = (): void => (holder === this.fxLayer ? t : holder).remove();
    const label = svgEl('text', { x: flame ? c.x + 6 : c.x, y: c.y - 16 }, t);
    label.textContent = text;
    // 付热量：字前面一簇火苗
    if (flame) t.insertAdjacentHTML('afterbegin', flameSvg().replace('<svg ', `<svg x="${c.x - 13}" y="${c.y - 31}" width="12" height="16" `));
    if (reduceMotion() || !t.animate) {
      window.setTimeout(done, 900);
      return;
    }
    const a = t.animate(
      [
        { transform: 'translate(0px, 0px)', opacity: 0 },
        { transform: 'translate(0px, -8px)', opacity: 1, offset: 0.15 },
        { transform: 'translate(0px, -26px)', opacity: 0 },
      ],
      { duration: 1300 * Math.max(0.6, this.speed), easing: 'ease-out' },
    );
    a.onfinish = done;
  }

  // ---------- 镜头 ----------

  private following(): boolean {
    return this.pref === 'follow' && !this.free && this.me !== null;
  }

  private choose(p: 'follow' | 'full'): void {
    this.pref = p;
    this.free = false;
    this.paintTools();
    this.home(true);
  }

  private paintTools(): void {
    const follow = this.following();
    this.followBtn.classList.toggle('on', follow);
    this.fullBtn.classList.toggle('on', this.pref === 'full' && !this.free);
    this.followBtn.hidden = this.me === null;
  }

  /** 回到该在的地方：跟车（有预览时框住预览）或全图 */
  private home(fly: boolean): void {
    const target = this.following() ? this.target() : this.pref === 'full' && !this.free ? this.fit(this.box) : null;
    if (!target) return this.applyCam();
    if (fly) this.flyTo(target);
    else {
      this.flyId++;
      this.cam = target;
      this.applyCam();
    }
  }

  /** 屏幕上的尺寸（像素）和世界单位的比 */
  private screen(): { w: number; h: number } {
    const r = this.svg.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  /** 世界坐标 → 转过的坐标（竖屏顺时针 90°：(x, y) → (-y, x)） */
  private rot(p: Pt): Pt {
    return this.turned ? { x: -p.y, y: p.x } : p;
  }

  /** 让框 b 刚好放进画面（宽高比按画面，b 居中） */
  private fit(b: Cam): Cam {
    const s = this.screen();
    const k = Math.min(s.w / b.w, s.h / b.h);
    const w = s.w / k;
    const h = s.h / k;
    return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
  }

  /** 镜头不跑出板子：板子比画面小的方向就居中 */
  private clamp(c: Cam): Cam {
    const b = this.box;
    const x = c.w >= b.w ? b.x + b.w / 2 - c.w / 2 : Math.min(Math.max(c.x, b.x), b.x + b.w - c.w);
    const y = c.h >= b.h ? b.y + b.h / 2 - c.h / 2 : Math.min(Math.max(c.y, b.y), b.y + b.h - c.h);
    return { x, y, w: c.w, h: c.h };
  }

  /**
   * 跟车的镜头：屏幕上 1 个单位约 1 像素，中心在车和前方 3 格之间（车在画面偏后）；
   * 有落点预览时还要框住落点和路上要过的弯的牌子，放不下就缩小
   */
  private target(): Cam {
    const c = this.me === null ? undefined : this.cars.get(this.me);
    if (!c) return this.fit(this.box);
    const s = this.screen();
    const ahead = this.spot(c.pos + 3, c.lane).p;
    const mid = this.rot({ x: c.x * 0.4 + ahead.x * 0.6, y: c.y * 0.4 + ahead.y * 0.6 });
    let k = 1;
    let center = mid;
    if (this.ghostAt) {
      const pts: Pt[] = [{ x: c.x, y: c.y }, this.spot(this.ghostAt.pos, this.ghostAt.lane).p];
      const N = this.track.spaces;
      const span = this.ghostAt.pos - c.pos;
      // 路上要过的弯：把路边的限速牌也框进来
      for (const k of this.track.corners) {
        const d = (k.at - cellOf(this.track, c.pos) + N) % N;
        if (d >= 1 && d <= span + 1) pts.push(this.art.sign(k.at));
      }
      const rp = pts.map((p) => this.rot(p));
      const pad = 50;
      const x0 = Math.min(...rp.map((p) => p.x)) - pad;
      const x1 = Math.max(...rp.map((p) => p.x)) + pad;
      const y0 = Math.min(...rp.map((p) => p.y)) - pad;
      const y1 = Math.max(...rp.map((p) => p.y)) + pad;
      k = Math.min(1, s.w / (x1 - x0), s.h / (y1 - y0));
      center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
    const w = Math.min(s.w / k, this.box.w * 1.2);
    const h = (w * s.h) / s.w;
    return this.clamp({ x: center.x - w / 2, y: center.y - h / 2, w, h });
  }

  private applyCam(): void {
    const { x, y, w, h } = this.cam;
    this.svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    this.paintLabels();
    this.paintEdges();
  }

  private flyTo(target: Cam): void {
    const id = ++this.flyId;
    if (reduceMotion()) {
      this.cam = target;
      return this.applyCam();
    }
    const from = { ...this.cam };
    const t0 = performance.now();
    const frame = (now: number): void => {
      if (id !== this.flyId) return;
      const k = Math.max(0, Math.min(1, (now - t0) / 350));
      const e = 1 - (1 - k) * (1 - k);
      this.cam = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      this.applyCam();
      if (k < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** 屏幕上 1 个单位多少像素 */
  private zoomK(): number {
    const s = this.screen();
    return Math.min(s.w / this.cam.w, s.h / this.cam.h);
  }

  /** 标注层：缩放跨过"全图"那条线、限速牌该换大小、下一个弯换了，才重画 */
  private paintLabels(): void {
    const k = this.zoomK();
    const detail = k >= LOD;
    // 全图时限速牌放大的倍数按 0.1 一档取，档位内不重画（往上取整，保证换算回来的缩放仍低于"全图"那条线）
    const sc = detail ? 1 : Math.ceil(10 / k) / 10;
    const key = `${detail}|${sc}|${this.nextCorner}|${this.turned}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.labelLayer.innerHTML = this.art.labels({ k: detail ? Math.max(k, LOD) : 1 / sc, rot: !!this.turned, next: this.nextCorner });
  }

  /** 画面外的车：屏幕边上、车所在那个方向一个小牌（颜色、号码、比我前后几格） */
  private paintEdges(): void {
    const cw = this.svg.clientWidth;
    const ch = this.svg.clientHeight;
    if (!cw || !ch) return;
    const s = Math.min(cw / this.cam.w, ch / this.cam.h);
    const ox = (cw - this.cam.w * s) / 2;
    const oy = (ch - this.cam.h * s) / 2;
    const mine = this.me === null ? undefined : this.cars.get(this.me);
    // 已经摆了的小牌：后摆的碰上了就顺着边挪开
    const placed: { x: number; y: number }[] = [];
    for (const [seat, c] of this.cars) {
      let chip = this.edgeChips.get(seat);
      const p = this.rot({ x: c.x, y: c.y });
      const sx = (p.x - this.cam.x) * s + ox;
      const sy = (p.y - this.cam.y) * s + oy;
      const inView = sx > -4 && sx < cw + 4 && sy > -4 && sy < ch + 4;
      if (seat === this.me || inView || c.g.classList.contains('out')) {
        if (chip) chip.hidden = true;
        continue;
      }
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'edge-chip';
        chip.innerHTML = `<b style="background:${CAR_COLORS[seat % CAR_COLORS.length]!.body}">${seat + 1}</b><span></span>`;
        this.edges.appendChild(chip);
        this.edgeChips.set(seat, chip);
      }
      chip.hidden = false;
      const dx = sx - cw / 2;
      const dy = sy - ch / 2;
      // 下边留出"全图""跟车"按钮那一条
      const t = Math.min((cw / 2 - 28) / Math.max(1e-6, Math.abs(dx)), (dy > 0 ? ch / 2 - 44 : ch / 2 - 16) / Math.max(1e-6, Math.abs(dy)));
      let x = cw / 2 + dx * t;
      let y = ch / 2 + dy * t;
      // 贴在左右边上的往上下挪，贴在上下边上的往左右挪；方向一开始定好（往中间），免得来回跳
      const vertical = Math.abs(Math.abs(x - cw / 2) - (cw / 2 - 28)) < 1;
      const dir = vertical ? (y > ch / 2 ? -1 : 1) : x > cw / 2 ? -1 : 1;
      for (let k = 0; k < 6 && placed.some((p) => Math.abs(p.x - x) < 56 && Math.abs(p.y - y) < 26); k++) {
        if (vertical) y += dir * 28;
        else x += dir * 60;
      }
      placed.push({ x, y });
      chip.style.left = `${x.toFixed(0)}px`;
      chip.style.top = `${y.toFixed(0)}px`;
      const diff = mine ? c.pos - mine.pos : null;
      chip.querySelector('span')!.textContent = diff === null ? '' : diff > 0 ? `+${diff}` : String(diff);
    }
  }

  private bindGestures(): void {
    const pts = new Map<number, { x: number; y: number }>();
    let last: { cx: number; cy: number; d: number } | null = null;
    const scaleOf = (): number => {
      const r = this.svg.getBoundingClientRect();
      return Math.max(this.cam.w / Math.max(1, r.width), this.cam.h / Math.max(1, r.height));
    };
    const summary = (): { cx: number; cy: number; d: number } => {
      const list = [...pts.values()];
      const cx = list.reduce((a, p) => a + p.x, 0) / list.length;
      const cy = list.reduce((a, p) => a + p.y, 0) / list.length;
      const d = list.length > 1 ? Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y) : 0;
      return { cx, cy, d };
    };
    // 动了手：这回合不再自动动镜头
    const grab = (): void => {
      if (this.free) return;
      this.free = true;
      this.flyId++;
      window.clearTimeout(this.settleTimer);
      this.paintTools();
    };
    const zoom = (k: number, sx: number, sy: number): void => {
      const r = this.svg.getBoundingClientRect();
      const fx = (sx - r.left) / Math.max(1, r.width);
      const fy = (sy - r.top) / Math.max(1, r.height);
      const w = Math.min(this.box.w * 1.2, Math.max(this.box.w / 6, this.cam.w / k));
      const h = (w * this.cam.h) / this.cam.w;
      this.cam = { x: this.cam.x + (this.cam.w - w) * fx, y: this.cam.y + (this.cam.h - h) * fy, w, h };
      this.applyCam();
    };
    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = summary();
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !last) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = summary();
      const s = scaleOf();
      const dx = (now.cx - last.cx) * s;
      const dy = (now.cy - last.cy) * s;
      if (Math.abs(dx) + Math.abs(dy) > 0.5 || (now.d && last.d)) {
        grab();
        this.cam = { ...this.cam, x: this.cam.x - dx, y: this.cam.y - dy };
        this.applyCam();
        if (now.d && last.d) zoom(now.d / last.d, now.cx, now.cy);
      }
      last = now;
    });
    const up = (e: PointerEvent): void => {
      pts.delete(e.pointerId);
      last = pts.size ? summary() : null;
    };
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        grab();
        zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  // ---------- 静止的地图板烘焙成一张位图 ----------

  /**
   * 地图板是静止的，元素却有一两千个：镜头跟车时每帧整张重画，手机上太慢。
   * 所以开局把它画成一张位图（透明底，桌面是页面的背景），之后平移缩放只挪这一张图；标注、车、虚影、飘字照旧是矢量。
   * 手机按 2 倍画（AGENTS.md 的"渲染倍数封顶 2"），电脑 3 倍；画好前、画失败时一直用矢量的
   */
  private baked: string | null = null;
  /** 转屏后会重画重烘：旧的那次烘完了也不用 */
  private bakeId = 0;

  private async bake(): Promise<void> {
    const id = ++this.bakeId;
    try {
      const b = this.art.board;
      // 板子外面留出投影
      const r = { x: b.x - 16, y: b.y - 16, w: b.w + 40, h: b.h + 44 };
      const scale = Math.min(coarse() ? 2 : 3, Math.sqrt((coarse() ? 5e6 : 1.2e7) / (r.w * r.h)));
      const w = Math.round(r.w * scale);
      const h = Math.round(r.h * scale);
      const defs = this.svg.querySelector('defs')!.outerHTML;
      // 烘焙的这张带纸纹和斑驳（纹理先内联成 data URL，不然当图片画时不会去加载）；页面上先显示的矢量不带
      const art = this.art.draw({ detail: true, rot: !!this.turned, grain: true });
      let src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" width="${w}" height="${h}">${defs}<g>${art}</g></svg>`;
      for (const [href, data] of await textures(src)) src = src.split(`href="${href}"`).join(`href="${data}"`);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.9));
      if (!blob || !this.root.isConnected || id !== this.bakeId) return;
      if (this.baked) URL.revokeObjectURL(this.baked);
      this.baked = URL.createObjectURL(blob);
      const pic = svgEl('image', { href: this.baked, x: r.x, y: r.y, width: r.w, height: r.h, preserveAspectRatio: 'none' });
      this.scenery.replaceChildren(pic);
    } catch {
      // 画不出来（老浏览器、内存不够）就一直用矢量的，只是慢一点
    }
  }

  destroy(): void {
    this.resize.disconnect();
    window.clearTimeout(this.settleTimer);
    this.flyId++;
    if (this.baked) URL.revokeObjectURL(this.baked);
    this.root.remove();
  }
}
