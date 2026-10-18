/**
 * 牌桌（DESIGN.md 第 7 节）：所有玩法共用的那部分——座位、手牌、副露、弃牌河、中间的牌墙和局数、胡碰杠过的按钮、动作大字。
 * 玩法专属的（川麻的换三张、定缺、缺门标记、刮风下雨、结算）由 VariantUi 挂进来（view/variants/<id>/）。
 *
 * 每次来新的视图整桌重画（一桌不到两百个元素，重画比对比省事）；新打出的那张牌带 fresh 做个落下的动画。
 * 座位按"我在下面"换算：rel = (座位 - 我) mod 4，0 下、1 右（下家）、2 上（对家）、3 左（上家）。
 */
import type { Tile } from '../core/tiles/index.ts';
import { kindOf, tileOf } from '../core/tiles/index.ts';
import type { Meld, RiverTile } from '../core/table/index.ts';
import { avatarSvg } from './avatar.ts';
import { celebrate, type CelebrateKind } from './fx.ts';
import { button, clear, el } from './dom.ts';
import { play } from './sound.ts';
import { num } from './text.ts';
import { backUrl, tileName, tileUrl } from './tiles.ts';

/** 牌桌要的视图字段（各玩法的视图都有这些，川麻的 XzView 满足它） */
export interface TableView {
  phase: string;
  round: number;
  dealer: number;
  turn: number;
  wall: number;
  opts: { rounds: number };
  base: number;
  seats: {
    chips: number;
    melds: Meld[];
    river: RiverTile[];
    count: number;
    won: { fan: number; from: number | null; tile: Tile; order: number } | null;
    hand: Tile[] | null;
  }[];
  me: { seat: number; hand: Tile[]; drawn: Tile | null } | null;
  prompt: { discard?: Tile[]; zimo?: true; kan?: Tile[]; claim?: { w: number; opts: string[] } } | null;
  claim: { id: number; tile: Tile; from: number; answered: boolean } | null;
}

export interface SeatMeta {
  name: string;
  bot: boolean;
  /** 掉线、托管（好友房） */
  away?: boolean;
  auto?: boolean;
  /** 没人（好友房开打前） */
  empty?: boolean;
}

export interface Frame<V extends TableView> {
  v: V;
  seats: SeatMeta[];
  /** 这一手的倒计时（好友房）：哪些座位、到什么时候 */
  timer?: { seats: number[]; until: number } | null;
}

/** 玩法挂进来的部分 */
export interface VariantUi<V extends TableView, A> {
  /** 座位名字下面的小标记（川麻：缺门） */
  seatTags(v: V, seat: number): HTMLElement | null;
  /** 手牌里同时能选几张（川麻换三张选 3）；0 是一张一张打 */
  multi(v: V): number;
  /** 手里这张牌要不要画暗（川麻：缺门的牌） */
  dim(v: V, tile: Tile): boolean;
  /** 玩法自己的操作条（换三张、定缺）；接管了返回 true */
  bar(v: V, bar: HTMLElement, ctx: BarCtx<A>): boolean;
  /** 这一步的事件 → 动作字、音效、特效 */
  effects(v: V, fx: Fx, names: string[]): void;
  /** 听牌提示：打掉 discard（null 是现在这手）听哪些牌种、各还剩几张没看见；听不了返回 null */
  ting(v: V, discard: Tile | null): { kind: number; left: number }[] | null;
}

export interface BarCtx<A> {
  selected: Tile[];
  act(a: A): void;
  /** 改了选择、要重画 */
  setSelected(tiles: Tile[]): void;
}

/** 画面效果：给玩法用 */
export interface Fx {
  banner(seat: number, text: string, cls?: string): void;
  /** 整桌的特效（川麻：刮风、下雨） */
  weather(kind: 'wind' | 'rain'): void;
  /** 盖在牌桌中间的一块（川麻：胡牌亮牌）：不挡点击、不动计时，delay 毫秒后出来、ms 毫秒后自己收掉 */
  overlay(node: HTMLElement, ms: number, delay?: number): void;
  /** 胡、自摸、杠的大字加粒子（view/fx.ts），在这个座位前面放 */
  celebrate(seat: number, text: string, kind: CelebrateKind): void;
  /** 开局发牌的过场：牌从中控盘 4-4-4-1 发到各家，不到 1 秒，点一下桌面就跳过 */
  deal(): void;
}

/** 通用的动作（胡、碰、杠、过、自摸、打牌）由牌桌直接发，交给控制器包成玩法的动作 */
export type CommonAct = { t: 'discard'; tile: Tile } | { t: 'zimo' } | { t: 'kan'; tile: Tile } | { t: 'claim'; w: number; c: string };

const CLAIM_TEXT: Record<string, string> = { ron: '胡', kan: '杠', pon: '碰', pass: '过' };

/** 往上拖过这么多像素松手就打出去（手机上不用再点两下） */
const DRAG_OUT = 40;
/** 手指动了这么多才算拖，不然还是点 */
const DRAG_START = 8;
/**
 * 打出的牌飞进河里多久（0.16.2，所有者嫌手感慢）：自己的 120 毫秒（以前 300），别人的 200（以前 340），牌在 72% 处落桌。
 * 落桌声按它们算（玩法的 ui.ts），只是画面，不改计时和规则
 */
/** 开局发牌过场的总长（4 批 × 200 毫秒错开 + 每张 300 毫秒），所有者要求不超过 1 秒 */
const DEAL_MS = 900;
export const FLY_MS = { me: 120, other: 200 } as const;
/** 落到桌上的那一刻（飞行动画 72% 处）：玩法在这时补一声落桌 */
export const landAt = (mine: boolean): number => Math.round((mine ? FLY_MS.me : FLY_MS.other) * 0.72);
const calm = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class TableUi<V extends TableView, A> {
  readonly root: HTMLElement;
  private badges: HTMLElement[] = [];
  private hands: HTMLElement[] = [];
  private melds: HTMLElement[] = [];
  private rivers: HTMLElement[] = [];
  private center: HTMLElement;
  private myHand: HTMLElement;
  private bar: HTMLElement;
  private slot: HTMLElement;
  private fxLayer: HTMLElement;
  private frame: Frame<V> | null = null;
  private selected: Tile[] = [];
  private riverLen = [0, 0, 0, 0];
  /** 最近一次打牌的座位（-1 是这一局还没人打） */
  private lastDiscard = -1;
  /** 自己打的那张从手里哪儿飞出去（下一帧落到河里时用）；只是画面，不影响计时和规则 */
  private flyFrom: { tile: Tile; rect: DOMRect } | null = null;
  /** 上一帧摸到的牌：新摸的那张落下来一下 */
  private lastDrawn: Tile | null = null;
  private tick = 0;
  /** 选中一张牌、再点一次才打（手机上防误触）；电脑上双击直接打 */
  private readonly confirmTap = true;

  private readonly ui: VariantUi<V, A>;
  private readonly send: (a: CommonAct | A) => void;

  constructor(parent: HTMLElement, ui: VariantUi<V, A>, send: (a: CommonAct | A) => void) {
    this.ui = ui;
    this.send = send;
    this.root = el('div', 'table', parent);
    // 每家的手牌和碰杠排成一排（自己的横着、左右两家竖着），整排沿桌边居中：碰杠多了少了，整排一起挪，不会一边空一边挤
    for (let r = 0; r < 4; r++) {
      this.rivers.push(el('div', `river r${r}`, this.root));
      const side = el('div', `side r${r}`, this.root);
      this.hands.push(el('div', r > 0 ? `opp-hand r${r}` : 'my-hand', side));
      this.melds.push(el('div', `melds r${r}`, side));
      this.badges.push(el('div', `badge r${r}`, this.root));
    }
    this.center = el('div', 'center', this.root);
    this.myHand = this.hands[0]!;
    this.bar = el('div', 'bar', this.root);
    this.slot = el('div', 'fun-slot', this.root);
    this.fxLayer = el('div', 'fx', this.root);
    document.addEventListener('keydown', this.onKey);
  }

  /**
   * 电脑上用键盘打（0.16.2）：← → 选牌，回车、空格、↑ 打出，Esc 放下；碰杠胡过：H 胡（自摸）、P 碰、G 杠、X 过。
   * 只在牌桌还在页面上、没有弹窗、焦点不在输入框时管；牌桌换掉了就自己摘掉
   */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root.isConnected) {
      document.removeEventListener('keydown', this.onKey);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector('.mask')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const v = this.frame?.v;
    if (!v?.prompt) return;
    const key = e.key.toLowerCase();
    const hot: Record<string, string> = { h: '.bar .act.ron', p: '.bar .act.pon', g: '.bar .act.kan', x: '.bar .act.pass' };
    const hit = hot[key] ? this.bar.querySelector<HTMLElement>(hot[key]) : null;
    if (hit) {
      e.preventDefault();
      hit.click();
      return;
    }
    if (!v.prompt.discard || this.ui.multi(v) > 0) return;
    const can = [...this.myHand.querySelectorAll<HTMLElement>('.tile:not(.off)')];
    if (!can.length) return;
    const at = can.findIndex((x) => x.classList.contains('up'));
    if (key === 'arrowleft' || key === 'arrowright') {
      e.preventDefault();
      const next = at < 0 ? (key === 'arrowleft' ? can.length - 1 : 0) : (at + (key === 'arrowleft' ? can.length - 1 : 1)) % can.length;
      can[next]!.click();
    } else if ((key === 'enter' || key === ' ' || key === 'arrowup') && at >= 0) {
      e.preventDefault();
      can[at]!.click();
    } else if (key === 'escape' && this.selected.length) {
      this.selected = [];
      this.drawHand();
      this.drawBar();
    }
  };

  get me(): number {
    return this.frame?.v.me?.seat ?? 0;
  }

  rel(seat: number): number {
    return (seat - this.me + 4) % 4;
  }

  /** 头像在屏幕上的位置（扔道具、表情包的起点终点） */
  avatarRect(seat: number): DOMRect {
    const b = this.badges[this.rel(seat)]!;
    return (b.querySelector('.avatar') ?? b).getBoundingClientRect();
  }

  avatarEl(seat: number): HTMLElement | null {
    return this.badges[this.rel(seat)]!.querySelector('.avatar');
  }

  /** 这个座位上是谁（互动：名字、是不是电脑、空位） */
  /** 现在画着的视图（互动的首次提示要看现在是什么阶段） */
  view(): V | null {
    return this.frame?.v ?? null;
  }

  seatMeta(seat: number): SeatMeta | null {
    return this.frame?.seats[seat] ?? null;
  }

  /** 互动的菜单、面板不能盖的：自己的手牌和操作条 */
  avoidRects(): DOMRect[] {
    return [this.myHand.getBoundingClientRect(), this.bar.getBoundingClientRect()].filter((r) => r.width > 0);
  }

  /** 名牌（头像、名字、筹码、缺门和状态签整块，kit 0.19.0 的 plate）：气泡、弹幕、聊天按钮都避开，自己的气泡不盖自己的筹码数 */
  plateRect(seat: number): DOMRect {
    const b = this.badges[this.rel(seat)]!;
    const r = b.getBoundingClientRect();
    // 倒计时的数字挂在名牌外面（头上），一起算进去，气泡不压它
    const c = b.querySelector('.clock')?.getBoundingClientRect();
    if (!c || c.width === 0) return r;
    const left = Math.min(r.left, c.left);
    const top = Math.min(r.top, c.top);
    return new DOMRect(left, top, Math.max(r.right, c.right) - left, Math.max(r.bottom, c.bottom) - top);
  }

  /** 牌桌中间的信息区（kit 0.19.0 的 center）：中控盘（剩余张数、局数）和四家的弃牌区；弹幕不横穿、聊天框和气泡不压 */
  centerRects(): DOMRect[] {
    return [this.center, ...this.rivers].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  }

  /**
   * 电脑版聊天框（kit 0.19.0 的 chatDock，横屏才有）：左上那家名牌下面、左家竖排手牌右边，弃牌区上面那块空呢子；
   * kit 自己挑角会放到左下，压住我的头像和筹码
   */
  chatDock(): DOMRect | null {
    if (this.root.closest<HTMLElement>('[data-orient]')?.dataset.orient !== 'land') return null;
    const top = this.badges[3]!.getBoundingClientRect();
    const side = this.hands[3]!.parentElement!.getBoundingClientRect();
    const left = side.right + 12;
    const right = this.center.getBoundingClientRect().left - 12;
    return new DOMRect(left, top.bottom + 10, Math.min(340, right - left), 0);
  }

  /** 对家那一排（头像、名牌、手牌）的下沿：弹幕从这儿往下飘，不压上面两家的名牌 */
  topRowBottom(): number {
    return Math.max(...[this.badges[2]!, this.badges[3]!, this.hands[2]!.parentElement!].map((e) => e.getBoundingClientRect().bottom));
  }

  /** "互动"按钮的位置：牌桌上留的空位（自己头像右边，style.css 按横竖屏摆） */
  funSlot(): DOMRect {
    return this.slot.getBoundingClientRect();
  }

  render(frame: Frame<V>): void {
    const fresh = this.frame?.v.round !== frame.v.round;
    this.frame = frame;
    if (fresh) {
      this.riverLen = [0, 0, 0, 0];
      this.lastDiscard = -1;
    }
    const v = frame.v;
    // 选中的牌已经不在手里（打出去了、换掉了）就清掉
    const hand = v.me?.hand ?? [];
    this.selected = this.selected.filter((t) => hand.includes(t));
    // 全桌最近打出的那张描一圈：这一步谁的牌河多了一张就是谁打的；没人打牌的步子（摸牌、碰杠）沿用上一次
    for (let s = 0; s < 4; s++) if (v.seats[s]!.river.length === this.riverLen[s]! + 1) this.lastDiscard = s;
    for (let s = 0; s < 4; s++) {
      const r = this.rel(s);
      this.drawBadge(s, r);
      this.drawMelds(s, r);
      this.drawRiver(s, r);
      if (r > 0) this.drawOpp(s, r);
    }
    this.flyFrom = null;
    this.drawCenter();
    this.drawHand();
    this.drawBar();
    this.dealAnimate();
    this.ui.effects(v, this.fx, frame.seats.map((x) => x.name));
    this.startTimer();
  }

  readonly fx: Fx = {
    deal: () => this.dealIn(),
    banner: (seat, text, cls = '') => {
      const b = el('div', `banner r${this.rel(seat)} ${cls}`, this.fxLayer, text);
      window.setTimeout(() => b.remove(), 1_500);
    },
    weather: (kind) => {
      const w = el('div', `weather ${kind}`, this.fxLayer);
      for (let i = 0; i < (kind === 'rain' ? 40 : 14); i++) {
        const d = el('i', '', w);
        d.style.left = `${(i * 37) % 100}%`;
        d.style.animationDelay = `${((i * 53) % 60) / 100}s`;
        d.style.top = `${(i * 29) % 90}%`;
      }
      window.setTimeout(() => w.remove(), 1_400);
    },
    overlay: (node, ms, delay = 0) => {
      node.style.setProperty('--ms', `${ms}ms`);
      window.setTimeout(() => {
        this.fxLayer.appendChild(node);
        window.setTimeout(() => node.remove(), ms);
      }, delay);
    },
    celebrate: (seat, text, kind) => {
      const r = this.rel(seat);
      // 大字放在这个人的牌河那边（画面坐标，舞台没缩放前的像素）
      const box = this.rivers[r]!;
      celebrate(this.fxLayer, box.offsetLeft + box.offsetWidth / 2, box.offsetTop + box.offsetHeight / 2, text, kind);
    },
  };

  // ---------- 各部分 ----------

  private drawBadge(seat: number, r: number): void {
    const f = this.frame!;
    const v = f.v;
    const meta = f.seats[seat]!;
    const s = v.seats[seat]!;
    const b = this.badges[r]!;
    clear(b);
    b.classList.toggle('turn', v.turn === seat && (v.phase === 'turn' || v.phase === 'claim'));
    b.classList.toggle('won', !!s.won);
    b.classList.toggle('empty', !!meta.empty);
    // 点头像互动由 kit 的 table-fun 在头像上盖一块透明热区接（view/fun.ts），这里只画
    const av = el('div', 'avatar', b);
    av.appendChild(this.avatarArt(seat, meta.name, meta.bot));
    if (v.dealer === seat) el('span', 'dealer', av, '庄');
    const info = el('div', 'info', b);
    el('div', 'name', info, meta.empty ? '空位' : meta.name);
    el('div', 'chips', info, num(s.chips));
    const tags = el('div', 'tags', info);
    const t = this.ui.seatTags(v, seat);
    if (t) tags.appendChild(t);
    if (meta.away) el('span', 'tag away', tags, meta.auto ? '托管' : '掉线');
    if (s.won) el('div', 'stamp', b, s.won.from === null ? '自摸' : '胡');
    el('div', 'clock', b);
  }

  /**
   * 头像的 SVG 每个人只解析一次：整桌每一帧重画，头像是手绘的（一张几十个节点），每帧 innerHTML 四张占了对局里大半的主线程。
   * 缓存的是节点本身，重画时挪进新的头像框；同一个节点只能在一处，所以按座位 + 名字缓存（几个空位同名也不抢）
   */
  private avatars = new Map<string, Element>();
  private avatarArt(seat: number, name: string, bot: boolean): Element {
    const key = `${seat}${bot ? 1 : 0}${name}`;
    let art = this.avatars.get(key);
    if (!art) {
      const box = document.createElement('div');
      box.innerHTML = avatarSvg(name, bot);
      art = box.firstElementChild!;
      this.avatars.set(key, art);
    }
    return art;
  }

  private tile(t: Tile, size: string, parent: HTMLElement): HTMLElement {
    const e = el('div', `tile ${size}`, parent);
    if (t < 0) e.style.backgroundImage = `url("${backUrl()}")`;
    else {
      e.style.backgroundImage = `url("${tileUrl(kindOf(t))}")`;
      e.title = tileName(kindOf(t));
    }
    return e;
  }

  private drawMelds(seat: number, r: number): void {
    const box = this.melds[r]!;
    clear(box);
    for (const m of this.frame!.v.seats[seat]!.melds) {
      const g = el('div', `meld ${m.kind}`, box);
      m.tiles.forEach((t, i) => {
        // 暗杠：自己看得到的也扣两张，桌上一眼看出是暗杠
        const hide = m.kan === 'concealed' && (i === 0 || i === 3);
        this.tile(hide ? -1 : t, r === 0 ? 'md' : 'sm', g);
      });
    }
  }

  private drawRiver(seat: number, r: number): void {
    const v = this.frame!.v;
    const box = this.rivers[r]!;
    const river = v.seats[seat]!.river;
    clear(box);
    // 只多了一张（正常打牌）：从出牌的地方飞过来；一下多好几张（刚进来、断线回来）就原地落下
    const one = river.length === this.riverLen[seat]! + 1;
    river.forEach((x, i) => {
      const e = this.tile(x.tile, 'sm', box);
      if (x.taken) e.classList.add('taken');
      if (i >= this.riverLen[seat]! && !(one && this.fly(e, r, x.tile))) e.classList.add('fresh');
      if (v.claim && v.claim.from === seat && v.claim.tile === x.tile) e.classList.add('hot');
      else if (seat === this.lastDiscard && i === river.length - 1 && !x.taken) e.classList.add('last');
    });
    this.riverLen[seat] = river.length;
  }

  /** 打出的牌飞进河里：自己的从手里那张的位置，别人的从他的手牌那边 */
  /**
   * 开局发牌（docs/art-v3.md 第 5 节，0.17.4）：我的手牌从中控盘飞到手里，四张一批、四批（4-4-4-1），别家的牌背跟着一批批亮出来；
   * 一共 0.9 秒，点一下桌面全部放完。只是画面：牌早就在 DOM 里、能点，不挡换三张；减少动态效果时不放。
   * 牌桌每来一个视图整桌重画（换三张时电脑几毫秒就选好，紧接着就是下一帧），所以记下开始的时刻，
   * 这 0.9 秒里每次重画都给新画的牌接着放（负的延迟 = 从中间接上）
   */
  private dealAt = 0;
  private dealIn(): void {
    if (calm()) return;
    this.dealAt = performance.now();
    const skip = (): void => {
      this.dealAt = 0;
      for (const e of this.root.querySelectorAll<HTMLElement>('.my-hand .tile, .opp-hand > *')) for (const a of e.getAnimations()) if (a.id === 'deal') a.finish();
    };
    this.root.addEventListener('pointerdown', skip, { once: true, capture: true });
    window.setTimeout(() => this.root.removeEventListener('pointerdown', skip, { capture: true }), DEAL_MS);
    this.dealAnimate();
  }

  private dealAnimate(): void {
    const t = performance.now() - this.dealAt;
    if (!this.dealAt || t >= DEAL_MS) return;
    const c = this.center.getBoundingClientRect();
    // 舞台整体缩放过：屏幕上的距离除以缩放倍数才是牌在舞台里要挪的距离
    const k = this.root.getBoundingClientRect().width / (this.root.offsetWidth || 1) || 1;
    const batch = (i: number): number => Math.min(3, Math.floor(i / 4)) * 200 - t;
    [...this.myHand.querySelectorAll<HTMLElement>('.tile')].forEach((e, i) => {
      const r = e.getBoundingClientRect();
      const dx = (c.left + c.width / 2 - (r.left + r.width / 2)) / k;
      const dy = (c.top + c.height / 2 - (r.top + r.height / 2)) / k;
      e.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
        id: 'deal',
        duration: 300,
        delay: batch(i),
        easing: 'cubic-bezier(.2,.8,.3,1)',
        fill: 'backwards',
      });
    });
    for (let r = 1; r < 4; r++)
      [...this.hands[r]!.children].forEach((e, i) =>
        (e as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { id: 'deal', duration: 200, delay: batch(i) + 100, fill: 'backwards' }),
      );
  }

  private fly(e: HTMLElement, r: number, t: Tile): boolean {
    if (calm()) return false;
    const from = r === 0 ? (this.flyFrom?.tile === t ? this.flyFrom.rect : null) : this.hands[r]!.getBoundingClientRect();
    if (!from || !from.width) return false;
    const to = e.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const k = r === 0 ? from.width / to.width : 1.2;
    // 落到桌上轻轻弹一下（落桌声由玩法在同一时刻放）
    e.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, easing: 'cubic-bezier(.2,.75,.3,1)' },
        { transform: 'translateY(0) scale(1)', offset: 0.72, easing: 'ease-out' },
        { transform: 'translateY(-3px) scale(1.04)', offset: 0.86, easing: 'ease-in' },
        { transform: 'none' },
      ],
      { duration: r === 0 ? FLY_MS.me : FLY_MS.other },
    );
    return true;
  }

  private drawOpp(seat: number, r: number): void {
    const v = this.frame!.v;
    const s = v.seats[seat]!;
    const box = this.hands[r]!;
    clear(box);
    if (s.hand) {
      for (const t of s.hand) this.tile(t, 'xs', box);
      return;
    }
    for (let i = 0; i < s.count; i++) el('div', 'back', box);
  }

  private drawCenter(): void {
    const v = this.frame!.v;
    const c = this.center;
    clear(c);
    for (let s = 0; s < 4; s++) {
      const d = el('div', `dir r${this.rel(s)}`, c);
      // 轮到谁、或者大家在等谁回碰杠胡：那一边的灯亮、箭头指过去
      d.classList.toggle('on', v.turn === s && (v.phase === 'turn' || v.phase === 'claim'));
      d.classList.toggle('done', !!v.seats[s]!.won);
    }
    const mid = el('div', 'mid', c);
    el('div', 'wall', mid, `${v.wall}`);
    el('div', 'wall-label', mid, '剩余');
    el('div', 'round', mid, `第 ${Math.min(v.round + 1, v.opts.rounds)}/${v.opts.rounds} 局`);
  }

  private drawHand(): void {
    const v = this.frame!.v;
    const box = this.myHand;
    clear(box);
    const me = v.me;
    if (!me) {
      // 旁观（没入座）：底下这家和别家一样，暗着的画牌背、亮牌时画牌面（视图里本来就只有公开的），点不了
      const s = v.seats[0]!;
      for (const t of s.hand ?? Array<Tile>(s.count).fill(-1)) this.tile(t, 'lg', box).classList.add('off');
      return;
    }
    const multi = this.ui.multi(v);
    const discard = v.prompt?.discard;
    // 轮到我打牌：手牌底下亮一道金边（中控盘的方向灯离手牌远，低头看手牌时看不到）
    box.classList.toggle('turn', !!discard && multi === 0);
    let tiles = me.hand.slice();
    let drawn: Tile | null = null;
    if (me.drawn !== null && tiles.includes(me.drawn)) {
      tiles.splice(tiles.indexOf(me.drawn), 1);
      drawn = me.drawn;
    }
    const s = v.seats[me.seat]!;
    if (s.won) tiles = me.hand.filter((t) => t !== s.won!.tile);
    // 轮到我打：打了能听的牌头上标个"听"（同种牌只算一次）
    const ting = new Map<number, boolean>();
    const put = (t: Tile, extra = ''): void => {
      const e = this.tile(t, 'lg', box);
      if (extra) e.classList.add(...extra.split(' '));
      if (discard?.includes(t) && multi === 0) {
        const k = kindOf(t);
        if (!ting.has(k)) ting.set(k, this.ui.ting(v, t) !== null);
        if (ting.get(k)) e.classList.add('ting');
      }
      if (this.ui.dim(v, t)) e.classList.add('que');
      if (this.selected.includes(t)) e.classList.add('up');
      const can = multi > 0 || (discard?.includes(t) ?? false);
      if (!can) e.classList.add('off');
      // 轮到我打、这张不能打（有缺先打缺）：画暗；没轮到我时整手照常亮着
      if (!can && discard) e.classList.add('ban');
      if (can)
        e.addEventListener('click', () => {
          if (e.dataset.dragged) delete e.dataset.dragged;
          else this.tap(t, e);
        });
      if (can && multi === 0) this.draggable(e, t);
    };
    for (const t of tiles) put(t);
    if (drawn !== null) put(drawn, drawn !== this.lastDrawn && !calm() ? 'drawn new' : 'drawn');
    this.lastDrawn = drawn;
    if (s.won) {
      const w = this.tile(s.won.tile, 'lg', box);
      w.classList.add('drawn', 'win-tile');
    } else if (drawn === null && tiles.length % 3 === 1) {
      // 没摸牌时摸牌的位置空着占住：整排居中，不然每摸一张、打一张整手牌左右晃半张
      el('div', 'tile lg drawn ghost off', box);
    }
  }

  /** 按住一张往上拖、松手打出；拖不够就弹回去。拖动只是画面，不改规则和计时 */
  private draggable(e: HTMLElement, t: Tile): void {
    e.addEventListener('pointerdown', (d) => {
      // 上次拖完浏览器不一定补 click（手机上常这样），标记留着会吞掉这次的点
      delete e.dataset.dragged;
      if (d.button !== 0) return;
      const x0 = d.clientX;
      const y0 = d.clientY;
      let moved = false;
      e.setPointerCapture(d.pointerId);
      const move = (m: PointerEvent): void => {
        const dx = m.clientX - x0;
        const dy = Math.min(0, m.clientY - y0);
        if (!moved && Math.hypot(dx, dy) < DRAG_START) return;
        moved = true;
        e.classList.add('drag');
        e.classList.toggle('out', dy < -DRAG_OUT);
        e.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const up = (u: PointerEvent): void => {
        e.removeEventListener('pointermove', move);
        e.removeEventListener('pointerup', up);
        e.removeEventListener('pointercancel', up);
        if (!moved) return;
        // 拖过以后浏览器还会补一个 click，别让它再当成"点一下"
        e.dataset.dragged = '1';
        if (u.type === 'pointerup' && u.clientY - y0 < -DRAG_OUT) {
          this.discard(t, e);
          return;
        }
        e.classList.remove('drag', 'out');
        e.style.transform = '';
      };
      e.addEventListener('pointermove', move);
      e.addEventListener('pointerup', up);
      e.addEventListener('pointercancel', up);
    });
  }

  private discard(t: Tile, from: HTMLElement): void {
    this.selected = [];
    this.flyFrom = { tile: t, rect: from.getBoundingClientRect() };
    this.send({ t: 'discard', tile: t });
  }

  private tap(t: Tile, from: HTMLElement): void {
    const v = this.frame!.v;
    const multi = this.ui.multi(v);
    if (multi > 0) {
      const i = this.selected.indexOf(t);
      if (i >= 0) this.selected.splice(i, 1);
      else this.selected = [...this.selected, t].slice(-multi);
      this.drawHand();
      this.drawBar();
      return;
    }
    if (!this.confirmTap || this.selected[0] === t) {
      this.discard(t, from);
      return;
    }
    this.selected = [t];
    this.drawHand();
    this.drawBar();
  }

  private drawBar(): void {
    const v = this.frame!.v;
    const bar = this.bar;
    clear(bar);
    const ctx: BarCtx<A> = {
      selected: this.selected,
      act: (a) => this.send(a),
      setSelected: (tiles) => {
        this.selected = tiles;
        this.drawHand();
        this.drawBar();
      },
    };
    if (this.ui.bar(v, bar, ctx)) return;
    const p = v.prompt;
    if (!p?.discard && !p?.claim) {
      const now = this.ui.ting(v, null);
      if (now) this.drawTing(bar, now, '听');
    }
    if (!p) {
      if (v.claim && !v.claim.answered && v.me && v.claim.from !== v.me.seat) el('div', 'hint', bar, '等别人想一想…');
      return;
    }
    if (p.claim) {
      const c = p.claim;
      const tile = v.claim!.tile;
      const show = el('div', 'claim-tile', bar);
      this.tile(tile, 'md', show);
      for (const o of [...c.opts, 'pass']) {
        button(`act ${o}`, bar, CLAIM_TEXT[o] ?? o, () => this.send({ t: 'claim', w: c.w, c: o }));
      }
      return;
    }
    if (p.zimo) button('act ron', bar, '自摸', () => this.send({ t: 'zimo' }));
    for (const t of p.kan ?? []) {
      const b = button('act kan', bar, '杠', () => this.send({ t: 'kan', tile: t }));
      this.tile(t, 'xs', b);
    }
    if (!p.discard) return;
    const after = this.selected.length ? this.ui.ting(v, this.selected[0]!) : null;
    if (after) this.drawTing(bar, after, '打了听');
    else el('div', 'hint', bar, this.selected.length ? '再点一下打出' : p.zimo || p.kan ? '' : '点两下或往上拖打出');
  }

  /** 听哪些牌、每种还剩几张（只按自己看得见的算） */
  private drawTing(bar: HTMLElement, ws: { kind: number; left: number }[], lead: string): void {
    const box = el('div', 'ting', bar);
    el('span', 'lead', box, lead);
    let sum = 0;
    for (const w of ws) {
      sum += w.left;
      const k = el('span', w.left ? 'k' : 'k none', box);
      this.tile(tileOf(w.kind, 0), 'xs', k);
      el('small', '', k, `${w.left}`);
    }
    el('span', 'sum', box, sum ? `剩 ${sum} 张` : '都没了');
  }

  // ---------- 倒计时 ----------

  private startTimer(): void {
    window.clearInterval(this.tick);
    const timer = this.frame?.timer;
    // 轮到我、要我做点什么：最后 5 秒每秒嘀嗒一下
    const mine = !!timer && timer.seats.includes(this.me) && !!this.frame?.v.prompt;
    let ticked = -1;
    const clocks = [0, 1, 2, 3].map((s) => this.badges[this.rel(s)]!.querySelector<HTMLElement>('.clock'));
    const paint = (): void => {
      let running = false;
      for (let s = 0; s < 4; s++) {
        const clock = clocks[s];
        if (!clock) continue;
        if (!timer || !timer.seats.includes(s)) {
          clock.textContent = '';
          continue;
        }
        const left = Math.max(0, Math.ceil((timer.until - Date.now()) / 1000));
        if (left > 0) running = true;
        // 一秒才变一次：没变就不碰 DOM
        const text = `${left}`;
        if (clock.textContent === text) continue;
        clock.textContent = text;
        clock.classList.toggle('low', left <= 5);
        if (mine && s === this.me && left <= 5 && left > 0 && left !== ticked) {
          ticked = left;
          play('countdown');
        }
      }
      // 都走到 0 了就停（之后由下一帧的新计时重开）
      if (!running) window.clearInterval(this.tick);
    };
    paint();
    if (timer) this.tick = window.setInterval(paint, 250);
  }

  destroy(): void {
    window.clearInterval(this.tick);
    this.root.remove();
  }
}
