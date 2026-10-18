/**
 * 牌桌互动组件（0.11.0，仓库根 docs/table-fun.md 第 0 节）：头像菜单、互动面板、表情菜单、首次提示、冷却和护盾、连击和回敬、
 * 电脑的反应、名场面横幅。几个牌桌游戏共用一套，外观、位置规则、动画、声音完全一样；游戏只做接线：
 * 告诉组件每个座位的头像在屏幕上的矩形、名字、是不是电脑和互动性格，哪些地方不能盖（手牌、操作按钮），怎么把东西发出去，
 * 再把收到的（好友房经房间转发的，单机自己的）交给 receive、把公开的名场面交给 moment。
 *
 * - DOM 实现：头像上盖一块透明的热区接点按和长按（画布游戏把世界坐标换成屏幕矩形传进来就行），菜单和面板是普通的 DOM，点按区 ≥ 44px；
 *   效果（表情、道具、污渍）走 fun.ts 的图层，点击穿透。这个文件只在调用时碰 DOM，import 时不碰（房间、测试里 import 没事）。
 * - 动画只动 transform、opacity；量位置（getBoundingClientRect）只在开菜单、给冒烟报控件时。
 * - 公平：人人一样、免费；只是画面和声音，不停计时、不改规则；电脑的出牌不读这些。电脑的反应只在画面层（单机）或房间的互动钩子里算。
 * - kit 不认识任何游戏：短语表、名场面的映射、电脑人物都由游戏给。
 */
import { CHAT_MAX, chatRejectText, type ChatBlockWhy } from './chat.js';
import { applyTheme, type KitTheme } from './theme.js';
import { PROPS, STICKERS, createFunLayer, propSvg, showSticker, stickerSvg, throwAt, type FunLayer, type FunPhase, type PropId, type RectLike, type StickerId } from './fun.js';
import {
  BOT_REACT,
  FUN_TIMING,
  FunCooldown,
  FunTally,
  botReact,
  funItem,
  newBotState,
  fitMenuWidth,
  placeMenu,
  propId,
  stickerId,
  stickerMood,
  type BotAction,
  type BotReactConfig,
  type BotState,
  type FunEvent,
  type FunItem,
  type FunMood,
  type FunTemper,
} from './fun-logic.js';

export * from './fun-logic.js';
export type { RectLike };

/** 一个座位此刻的样子（每次用到时现问，座位换人、头像挪了都跟得上） */
export interface FunSeat {
  /** 头像的屏幕矩形（CSS 像素，getBoundingClientRect 的结果能直接传） */
  rect: RectLike;
  name: string;
  /** 是我自己（点了出表情菜单，长按发上次那个表情） */
  me?: boolean;
  /** 是电脑（单机时组件替它反应；首次提示冒在电脑头像上） */
  bot?: boolean;
  /** 电脑的互动性格，默认 normal */
  temper?: FunTemper;
}

/**
 * storageKey 的检查（0.13.1）：它就是游戏 id，kit 拿它拼 `<id>.hint.fun`、`<id>.fun.blocked`。同站的几个游戏和平台只靠 `<id>.` 前缀分开存储，
 * 所以只认游戏 id 的写法（小写字母、数字、连字符，字母或数字开头，最多 32 位）；带点（"guandan." 会拼出 "guandan..fun"）、大写、空串、
 * 平台自己的前缀 arcade 都不行。不合格直接抛错：同一个字符串每次都一样，开发时第一次打开牌桌就看得到，不会带到线上
 */
export function checkStorageKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(key) || key === 'arcade') {
    throw new Error(`arcade-kit/table-fun: storageKey 要写游戏 id（比如 "mygame"，存成 "mygame.hint.fun"），收到 ${JSON.stringify(key)}`);
  }
  return key;
}

export interface TableFunOptions {
  /** 游戏 id：首次提示、屏蔽名单的存储 key 前缀（`<id>.hint.fun`、`<id>.fun.blocked`）；不是游戏 id 的写法构造时就抛错（checkStorageKey） */
  storageKey: string;
  /** 本游戏的短语表（编号 0..P-1，见 fun-logic 的 funItem） */
  phrases: readonly string[];
  /** 头像菜单里那 3 句点名短语（短语表的下标），默认前 3 句 */
  named?: readonly number[];
  /** 座位：下标就是发送、收到时用的座位号；空座位给 null */
  seats(): readonly (FunSeat | null)[];
  /** 菜单、面板不能盖的地方（手牌、操作按钮），屏幕矩形 */
  avoid?(): readonly RectLike[];
  /** "互动"按钮放哪（屏幕矩形，组件画按钮）；null 就不画（比如没坐下） */
  button?(): RectLike | null;
  /** 发出去：好友房走 kit emote，单机直接回给 receive */
  send(id: number, to?: number): void;
  /** 现在能不能发（好友房：坐下了才能），默认能 */
  canSend?(): boolean;
  /**
   * 首次提示"点头像扔道具"冒在哪个座位（0.17.0）：返回座位号，或 null = 现在不合适（比如那家的出牌区上有牌，气泡会挡住），
   * 组件过 2 秒再问。不给就挑第一个电脑（没有就第一个别人），和以前一样
   */
  hintSeat?(): number | null;
  /**
   * 好友房聊天（0.18.0，docs/chat.md）：给了它"互动"面板才有"聊天"页。好友房传 `(text) => client.chat(text)`，返回 RoomClient.chat 的结果；
   * 收到的经 TableFun.chat 交进来。单机不给（单机没有聊天）
   */
  chat?(text: string): ChatResultLike;
  /** 设置里"聊天：开 / 不看"（和"互动"分开）：不看时别人说的不冒气泡、不进记录，自己也没有聊天页；默认开 */
  chatEnabled?(): boolean;
  /** 设置里"互动：开 / 不看"，关了别人的一律不播，单机电脑也不反应；默认开 */
  enabled?(): boolean;
  /** 屏蔽名单按这个分开（房间码；单机一个固定值），默认 'solo' */
  scope?(): string;
  /** 单机：电脑的反应由组件按 botReact 算、在本地播（好友房的电脑在房间里算，这里别开） */
  localBots?: boolean;
  /** 各种情绪时电脑气泡说的话；不给就用 kit 的默认（不提任何游戏） */
  moodLines?: Partial<Record<FunMood, readonly string[]>>;
  /** 道具声音：起飞、引信、命中时调，游戏用自己的音频（跟着静音开关）放 playFunSound */
  sound?(prop: PropId, phase: FunPhase): void;
  /** 命中那一刻：游戏让被扔的头像抖一下 */
  onHit?(seat: number, prop: PropId): void;
  /** 冒烟、调试看的流水：`道具 0>1:tomato ×2 回敬`、`表情 0:smug`、`短语 2:3`、`护盾 1`、`提示 头像` */
  log?(line: string): void;
  /** 效果图层的 z-index，菜单和热区在它上面一层；默认 50 */
  zIndex?: number;
  /** 主题（0.16.0）：写到菜单根节点（.atf-ui）上的 `--ak-*` 变量；不传就用页面 CSS 里的变量或默认外观 */
  theme?: KitTheme;
  /** 电脑反应的参数，默认规范的数字 */
  react?: BotReactConfig;
  /** 测试、复现用 */
  rand?(): number;
  now?(): number;
}

const DEFAULT_LINES: Record<FunMood, readonly string[]> = {
  angry: ['等着瞧', '你给我等着', '好啊你'],
  sweat: ['手滑了', '这……', '别扔了别扔了'],
  love: ['谢谢！', '够意思', '收下了'],
  smug: ['就这？', '承让承让', '手气好没办法'],
  shock: ['好家伙', '不是吧', '这都行？'],
  cry: ['服了', '下把再来', '太难了'],
};

const HINT_TEXT = '点头像扔道具，长按连扔';

/** RoomClient.chat 的结果里组件要看的部分（不 import client.ts，单机的游戏也能用组件） */
export type ChatResultLike = { ok: true } | { ok: false; code: string; why?: ChatBlockWhy; waitMs?: number };

/** 聊天：气泡停多久、页面里记最近几条（只在内存里） */
export const CHAT_UI = { bubbleMs: 4000, keep: 30 } as const;

/**
 * 首次提示冒在哪个座位（纯函数，测试直接测）：游戏给了 pick 就听它的，它给的座位空着或不存在当作"现在不行"；
 * 没给就挑第一个电脑，没有电脑挑第一个别人。null = 这会儿不提示，过一会儿再问
 */
export function hintSeatFor(seats: readonly (FunSeat | null)[], pick?: () => number | null): number | null {
  if (pick) {
    const at = pick();
    return at !== null && Number.isInteger(at) && seats[at] ? at : null;
  }
  const i = seats.findIndex((s) => !!s?.bot);
  const at = i >= 0 ? i : seats.findIndex((s) => !!s && !s.me);
  return at >= 0 ? at : null;
}
const CSS_ID = 'arcade-table-fun-css';
const CSS = `
.atf-ui{position:fixed;inset:0;pointer-events:none;font-family:var(--ak-font,inherit);-webkit-tap-highlight-color:transparent}
.atf-hot{position:absolute;left:0;top:0;pointer-events:auto;border-radius:50%;touch-action:manipulation;cursor:pointer;-webkit-user-select:none;user-select:none}
.atf-away{position:absolute;inset:0;pointer-events:auto}
.atf-box{position:absolute;left:0;top:0;pointer-events:auto;background:var(--ak-bg,rgba(43,29,20,.96));border:2px solid var(--ak-border,#d4a64a);border-radius:var(--ak-radius,14px);padding:8px;box-sizing:border-box;color:var(--ak-fg,#fff6e0);box-shadow:0 6px 18px rgba(0,0,0,.45);transform-origin:center;animation:atf-pop .14s ease-out}
.atf-title{font-size:15px;font-weight:700;color:var(--ak-title,#f3d98b);margin:0 4px 6px}
.atf-row{display:flex;gap:4px;flex-wrap:wrap}
.atf-cell{position:relative;width:48px;height:48px;border:0;border-radius:var(--ak-radius-btn,10px);background:var(--ak-soft,#4a3220);padding:4px;box-sizing:border-box;cursor:pointer;overflow:hidden}
.atf-cell svg{width:100%;height:100%;display:block;pointer-events:none}
.atf-chip{min-height:44px;border:1px solid var(--ak-border,rgba(212,166,74,.6));border-radius:var(--ak-radius-btn,22px);background:var(--ak-accent,#7a2a1e);color:var(--ak-accent-fg,#fff6e0);font:inherit;font-size:14px;font-weight:700;padding:0 12px;cursor:pointer}
.atf-chip.atf-soft,.atf-chip.atf-grey,.atf-chip.atf-on,.atf-chip.atf-pick{color:var(--ak-fg,#fff6e0)}
.atf-chip.atf-soft{background:var(--ak-soft,#4a3220)}.atf-chip.atf-grey{background:#3a3a3a}.atf-chip.atf-on{background:#b3202a}.atf-chip.atf-pick{background:#3a6a2a}
.atf-grid{display:grid;gap:4px}
.atf-scroll{overflow-y:auto;overscroll-behavior:contain}
.atf-cool{position:absolute;inset:0;border-radius:var(--ak-radius-btn,10px);background:rgba(0,0,0,.5);pointer-events:none}
.atf-cool::after{content:'';position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:var(--ak-title,#f3d98b);animation:atf-spin .7s linear infinite}
.atf-btn{position:absolute;left:0;top:0;pointer-events:auto;min-width:44px;min-height:44px;border-radius:var(--ak-radius-btn,22px);border:2px solid var(--ak-border,#d4a64a);background:var(--ak-soft,#5a3a22);color:var(--ak-fg,#fff6e0);font:inherit;font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:2px 6px;box-sizing:border-box}
.atf-btn svg{width:22px;height:22px}
.atf-btn.atf-dot::after{content:'';position:absolute;right:2px;top:2px;width:10px;height:10px;border-radius:50%;background:#e8323a;border:2px solid var(--ak-fg,#fff6e0)}
.atf-say{white-space:normal;max-width:240px;word-break:break-all;font-weight:600}
.atf-log{display:flex;flex-direction:column;gap:4px;font-size:14px;line-height:1.4;min-height:44px}
.atf-log b{color:var(--ak-title,#f3d98b);font-weight:700;margin-right:4px}
.atf-log .atf-empty{opacity:.6}
.atf-input{flex:1;min-width:0;min-height:44px;border:1px solid var(--ak-border,rgba(212,166,74,.6));border-radius:var(--ak-radius-btn,10px);background:#fffaf0;color:#2b1d14;font:inherit;font-size:16px;padding:0 10px;box-sizing:border-box}
.atf-note{font-size:13px;margin:4px 4px 0;opacity:.85;min-height:18px}
.atf-chip:disabled{opacity:.5;cursor:default}
.atf-bubble{position:absolute;left:0;top:0;max-width:220px;padding:6px 12px;border-radius:var(--ak-radius,14px);background:#fffaf0;color:#2b1d14;font-size:15px;font-weight:700;box-shadow:0 3px 8px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.atf-flash{position:absolute;left:0;top:0;font-size:26px;font-weight:900;color:var(--ak-title,#f3d98b);-webkit-text-stroke:1.5px #2b1d14;pointer-events:none;white-space:nowrap}
.atf-banner{position:absolute;left:50%;top:18%;padding:10px 34px;background:linear-gradient(#c8323a,#8a1a20);border:2px solid var(--ak-title,#f3d98b);border-radius:6px;color:var(--ak-fg,#fff6e0);font-size:28px;font-weight:900;letter-spacing:4px;text-align:center;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.atf-banner small{display:block;font-size:15px;letter-spacing:1px;color:var(--ak-title,#f3d98b)}
@keyframes atf-pop{from{opacity:0;scale:.92}to{opacity:1;scale:1}}
@keyframes atf-spin{to{transform:rotate(360deg)}}
`;

const SMILE = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><circle cx="32" cy="32" r="24"/><circle cx="23" cy="27" r="2.5" fill="currentColor"/><circle cx="41" cy="27" r="2.5" fill="currentColor"/><path d="M20 37Q32 49 44 37"/></svg>';

type Rect = { left: number; top: number; width: number; height: number };
type Tab = 'phrase' | 'sticker' | 'prop' | 'chat';

/** 挂子元素（Workers 的类型里也有一个 append，签名对不上，所以统一用 appendChild） */
function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

/** 动画：只动 transform、opacity；没有 animate 的环境按时长等 */
function anim(el: HTMLElement, frames: Keyframe[], ms: number, delay = 0): Promise<void> {
  if (typeof el.animate !== 'function') return new Promise((ok) => setTimeout(ok, ms + delay));
  return el.animate(frames, { duration: ms, delay, easing: 'ease-out', fill: 'both' }).finished.then(
    () => undefined,
    () => undefined,
  );
}

export class TableFun {
  readonly layer: FunLayer;
  private readonly ui: HTMLDivElement;
  private readonly doc: Document;
  private readonly o: TableFunOptions;
  private readonly P: number;
  private readonly cool = new FunCooldown();
  private readonly tally = new FunTally();
  private readonly bots: BotState = newBotState();
  private hots: HTMLDivElement[] = [];
  private btn: HTMLButtonElement | null = null;
  private open: HTMLElement | null = null;
  private tab: Tab = 'phrase';
  private target = -1;
  private lastProp: PropId = 'tomato';
  private lastSticker: StickerId = 'smug';
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** 聊天记录（最近 CHAT_UI.keep 条，只在内存里；关页面、换房间就没了） */
  private chatLog: { seat: number; name: string; text: string }[] = [];
  private chatLogEl: HTMLElement | null = null;
  /** 每个人最近的那个聊天气泡：同一个人连说两条，后一条顶掉前一条 */
  private says = new Map<number, HTMLElement>();
  private unread = false;
  /** 键盘弹出时跟着可见区挪面板（输入框聚焦时挂上） */
  private vvFix: (() => void) | null = null;
  private dead = false;
  private readonly onResize = (): void => this.refresh();

  constructor(opts: TableFunOptions) {
    // 先查 key 再碰 DOM：不合格的不留下半个界面
    checkStorageKey(opts.storageKey);
    this.o = opts;
    this.P = opts.phrases.length;
    this.doc = document;
    if (!this.doc.getElementById(CSS_ID)) {
      const st = this.doc.createElement('style');
      st.id = CSS_ID;
      st.textContent = CSS;
      this.doc.head.appendChild(st);
    }
    const z = opts.zIndex ?? 50;
    this.layer = createFunLayer({ zIndex: z });
    this.ui = this.doc.createElement('div');
    this.ui.className = 'atf-ui';
    this.ui.style.zIndex = String(z + 1);
    applyTheme(this.ui, opts.theme);
    this.doc.body.appendChild(this.ui);
    window.addEventListener('resize', this.onResize);
    this.refresh();
    this.later(1500, () => this.hint());
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }
  private rand(): number {
    return this.o.rand?.() ?? Math.random();
  }
  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) fn();
    }, ms);
    this.timers.add(t);
  }
  private seat(i: number): FunSeat | null {
    return this.o.seats()[i] ?? null;
  }
  private meSeat(): number {
    return this.o.seats().findIndex((s) => !!s?.me);
  }
  private canSend(): boolean {
    return this.o.canSend?.() ?? true;
  }
  private enabled(): boolean {
    return this.o.enabled?.() ?? true;
  }

  // ───────────── 布局 ─────────────

  /** 头像挪了、窗口变了、座位换人：重新摆热区和按钮（游戏重排画面后调；窗口 resize 自己会调） */
  refresh(): void {
    if (this.dead) return;
    const seats = this.o.seats();
    while (this.hots.length < seats.length) this.hots.push(this.makeHot(this.hots.length));
    this.hots.forEach((h, i) => {
      const s = seats[i];
      if (!s) {
        h.style.display = 'none';
        return;
      }
      h.style.display = '';
      h.style.width = `${Math.max(44, s.rect.width)}px`;
      h.style.height = `${Math.max(44, s.rect.height)}px`;
      h.style.transform = `translate(${s.rect.left + s.rect.width / 2 - Math.max(44, s.rect.width) / 2}px,${s.rect.top + s.rect.height / 2 - Math.max(44, s.rect.height) / 2}px)`;
    });
    const r = this.o.button?.() ?? null;
    if (!r) {
      this.btn?.remove();
      this.btn = null;
    } else {
      if (!this.btn) {
        const b = this.doc.createElement('button');
        b.className = 'atf-btn';
        b.type = 'button';
        b.innerHTML = `${SMILE}<span>互动</span>`;
        b.classList.toggle('atf-dot', this.unread);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.open?.dataset['kind'] === 'panel') this.closeAll();
          else this.openPanel(this.tab);
        });
        this.ui.appendChild(b);
        this.btn = b;
      }
      this.btn.style.width = `${Math.max(44, r.width)}px`;
      this.btn.style.height = `${Math.max(44, r.height)}px`;
      this.btn.style.transform = `translate(${r.left}px,${r.top}px)`;
    }
  }

  /** 头像热区：点一下开菜单（别人）或表情菜单（自己）；按住 longPressMs 直接扔上次的道具 / 发上次的表情 */
  private makeHot(i: number): HTMLDivElement {
    const h = this.doc.createElement('div');
    h.className = 'atf-hot';
    h.dataset['seat'] = String(i);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    const clear = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      fired = false;
      clear();
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        this.quick(i);
      }, FUN_TIMING.longPressMs);
    });
    h.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      clear();
      if (!fired) this.tapSeat(i);
    });
    h.addEventListener('pointerleave', clear);
    h.addEventListener('pointercancel', clear);
    h.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ui.appendChild(h);
    return h;
  }

  private tapSeat(i: number): void {
    const s = this.seat(i);
    if (!s || !this.canSend()) return;
    if (this.open?.dataset['seat'] === String(i)) return this.closeAll();
    if (s.me) this.openStickers(i);
    else this.openMenu(i);
  }

  /** 长按：别人 → 扔上次那个道具；自己 → 发上次那个表情 */
  private quick(i: number): void {
    const s = this.seat(i);
    if (!s || !this.canSend()) return;
    this.closeAll();
    if (s.me) this.pick(stickerId(this.P, STICKERS.indexOf(this.lastSticker)));
    else this.pick(propId(this.P, PROPS.indexOf(this.lastProp)), i);
  }

  // ───────────── 发 ─────────────

  private pick(id: number, to?: number): boolean {
    const it = funItem(id, this.P);
    if (!it || !this.canSend()) return false;
    if (!this.cool.take(it.kind === 'prop' ? 'prop' : 'talk', this.now())) return false;
    if (it.kind === 'prop') this.lastProp = PROPS[it.index]!;
    if (it.kind === 'sticker') this.lastSticker = STICKERS[it.index]!;
    this.closeAll();
    this.o.send(id, to);
    return true;
  }

  // ───────────── 菜单、面板 ─────────────

  private box(kind: string, w: number, h: number, anchor: Rect, seat?: number): HTMLDivElement {
    this.closeAll();
    const away = this.doc.createElement('div');
    away.className = 'atf-away';
    away.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeAll();
    });
    const b = this.doc.createElement('div');
    b.className = 'atf-box';
    b.dataset['kind'] = kind;
    if (seat !== undefined) b.dataset['seat'] = String(seat);
    // 窄屏两边各留 8px（0.11.2，和 placeMenu 的 fitMenuWidth 一致）；收窄了的内容会折行，由 fit() 按真实高度重摆
    b.style.width = `min(${w}px, calc(100vw - 16px))`;
    b.style.height = `${h}px`;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const at = placeMenu(anchor, w, h, view, this.o.avoid?.() ?? []);
    b.style.transform = `translate(${at.left}px,${at.top}px)`;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    const wrap = this.doc.createElement('div');
    wrap.dataset['kind'] = kind;
    if (seat !== undefined) wrap.dataset['seat'] = String(seat);
    add(wrap, away, b);
    this.ui.appendChild(wrap);
    this.open = wrap;
    return b;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private chip(label: string, key: string, fn: () => void, cls = ''): HTMLButtonElement {
    const c = this.el('button', `atf-chip ${cls}`, label);
    c.type = 'button';
    c.dataset['key'] = key;
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return c;
  }

  private cell(svg: string, key: string, fn: () => void, prop = false): HTMLButtonElement {
    const c = this.el('button', 'atf-cell');
    c.type = 'button';
    c.dataset['key'] = key;
    c.innerHTML = svg;
    const left = prop ? this.cool.left('prop', this.now()) : 0;
    if (left > 0) {
      // 冷却中：盖一层转圈，到点拿掉
      const ov = this.el('div', 'atf-cool');
      c.appendChild(ov);
      setTimeout(() => ov.remove(), left);
    }
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return c;
  }

  /** 点别人头像：第一排 8 个道具（第一格是上次扔的那个），第二排 3 句点名短语，最后"屏蔽他" */
  private openMenu(v: number): void {
    const s = this.seat(v);
    if (!s) return;
    const W = 8 * 52 + 16;
    const b = this.box('menu', W, 196, s.rect, v);
    add(b, this.el('div', 'atf-title', `对 ${s.name}`));
    const row = this.el('div', 'atf-row');
    const order = [this.lastProp, ...PROPS.filter((p) => p !== this.lastProp)];
    order.forEach((p, k) => add(row, this.cell(propSvg(p), `fun:prop${k}`, () => void this.pick(propId(this.P, PROPS.indexOf(p)), v), true)));
    add(b, row);
    const row2 = this.el('div', 'atf-row');
    row2.style.marginTop = '6px';
    const named = this.o.named ?? [0, 1, 2];
    named.slice(0, 3).forEach((ix, k) => {
      const c = this.chip(this.o.phrases[ix] ?? '', `fun:named${k}`, () => void this.pick(ix, v));
      c.style.flex = '1';
      add(row2, c);
    });
    add(b, row2);
    const blocked = this.isBlocked(v);
    const blk = this.chip(blocked ? '不再屏蔽' : '屏蔽他', 'fun:block', () => {
      this.setBlocked(v, !blocked);
      this.closeAll();
    }, 'atf-grey');
    blk.style.marginTop = '6px';
    blk.style.width = '100%';
    add(b, blk);
    // 窄屏上一排 8 个道具放不下、折成两排：高度跟着内容
    if (fitMenuWidth(W, window.innerWidth) < W) this.fit(b, s.rect, W);
  }

  /** 高度跟着内容，量完按真实高度重新摆、避开禁区 */
  private fit(b: HTMLDivElement, anchor: Rect, w: number): void {
    b.style.height = 'auto';
    const at = placeMenu(anchor, w, b.offsetHeight, { width: window.innerWidth, height: window.innerHeight }, this.o.avoid?.() ?? []);
    b.style.transform = `translate(${at.left}px,${at.top}px)`;
  }

  /** 点自己头像：12 个表情 */
  private openStickers(v: number): void {
    const s = this.seat(v);
    if (!s) return;
    const b = this.box('stickers', 6 * 52 + 16, 2 * 52 + 16, s.rect, v);
    const g = this.el('div', 'atf-grid');
    g.style.gridTemplateColumns = 'repeat(6,48px)';
    STICKERS.forEach((st, k) => add(g, this.cell(stickerSvg(st), `fun:sticker${k}`, () => void this.pick(stickerId(this.P, k)))));
    add(b, g);
  }

  /** "互动"按钮：短语 / 表情 / 道具三个页签；道具页先选人再选道具 */
  openPanel(tab: Tab = this.tab): void {
    if (!this.canSend() || !this.btn) return;
    this.tab = tab;
    const r = this.btn.getBoundingClientRect();
    const hasChat = this.chatOn();
    if (tab === 'chat' && !hasChat) tab = this.tab = 'phrase';
    const b = this.box('panel', 440, 300, r);
    const tabs = this.el('div', 'atf-row');
    const list: [Tab, string][] = [['phrase', '短语'], ['sticker', '表情'], ['prop', '道具'], ...(hasChat ? [['chat', '聊天'] as [Tab, string]] : [])];
    list.forEach(([t, label]) => {
      const c = this.chip(label, `fun:tab:${t}`, () => this.openPanel(t), t === tab ? 'atf-on' : 'atf-soft');
      c.style.flex = '1';
      add(tabs, c);
    });
    const others = this.o.seats().map((s, i) => (s && !s.me ? i : -1)).filter((i) => i >= 0);
    const all = others.length > 0 && others.every((i) => this.isBlocked(i));
    const blk = this.chip(all ? '全部恢复' : '全部屏蔽', 'fun:blockAll', () => {
      for (const i of others) this.setBlocked(i, !all);
      this.closeAll();
    }, 'atf-grey');
    add(tabs, blk);
    add(b, tabs);
    const body = this.el('div', 'atf-scroll');
    body.style.maxHeight = '224px';
    body.style.marginTop = '8px';
    if (tab === 'chat') {
      add(b, body);
      this.chatBody(b, body);
      this.fit(b, r, 440);
      return;
    }
    if (tab === 'phrase') {
      const g = this.el('div', 'atf-grid');
      g.style.gridTemplateColumns = 'repeat(3,1fr)';
      this.o.phrases.forEach((p, i) => add(g, this.chip(p, `fun:phrase${i}`, () => void this.pick(i), 'atf-soft')));
      add(body, g);
    } else if (tab === 'sticker') {
      const g = this.el('div', 'atf-grid');
      g.style.gridTemplateColumns = 'repeat(6,48px)';
      g.style.justifyContent = 'center';
      STICKERS.forEach((st, k) => add(g, this.cell(stickerSvg(st), `fun:psticker${k}`, () => void this.pick(stickerId(this.P, k)))));
      add(body, g);
    } else {
      if (!others.includes(this.target)) this.target = others[0] ?? -1;
      const who = this.el('div', 'atf-row');
      for (const i of others) {
        const c = this.chip(`扔给 ${this.seat(i)!.name}`, `fun:target${i}`, () => {
          this.target = i;
          this.openPanel('prop');
        }, i === this.target ? 'atf-pick' : 'atf-soft');
        c.style.flex = '1';
        add(who, c);
      }
      const row = this.el('div', 'atf-row');
      row.style.marginTop = '10px';
      row.style.justifyContent = 'center';
      PROPS.forEach((p, k) => add(row, this.cell(propSvg(p), `fun:pprop${k}`, () => void this.pick(propId(this.P, k), this.target), true)));
      add(body, who, row);
    }
    add(b, body);
    // 高度跟着内容（短语少时不留一大块空），量完按真实高度重新避开禁区
    this.fit(b, r, 440);
  }

  closeAll(): void {
    this.open?.remove();
    this.open = null;
    this.chatLogEl = null;
    this.unhookViewport();
  }

  // ───────────── 聊天（0.18.0） ─────────────

  private chatOn(): boolean {
    return !!this.o.chat && (this.o.chatEnabled?.() ?? true);
  }

  /** 聊天页：上面最近 30 条（新的在下），下面一行输入框 + 发送，再下面一行小字（还能打几个字、为什么没发出去） */
  private chatBody(b: HTMLDivElement, body: HTMLDivElement): void {
    this.setUnread(false);
    // 记录自己滚，输入框一直在下面看得见
    const log = this.el('div', 'atf-log atf-scroll');
    log.style.maxHeight = '160px';
    this.chatLogEl = log;
    this.renderLog();
    add(body, log);
    const row = this.el('div', 'atf-row');
    row.style.marginTop = '8px';
    row.style.flexWrap = 'nowrap';
    const input = this.el('input', 'atf-input');
    input.type = 'text';
    input.enterKeyHint = 'send';
    input.autocomplete = 'off';
    input.placeholder = '说点什么';
    input.dataset['key'] = 'fun:chatInput';
    const send = this.chip('发送', 'fun:chatSend', () => go());
    const note = this.el('div', 'atf-note');
    const left = (): void => {
      const n = CHAT_MAX - Array.from(input.value.trim()).length;
      note.textContent = n < 0 ? `多了 ${-n} 个字` : `还能打 ${n} 个字`;
      send.disabled = n < 0 || send.dataset['wait'] === '1';
    };
    const go = (): void => {
      if (!input.value.trim() || send.disabled) return;
      const r = this.o.chat!(input.value);
      if (r.ok) {
        input.value = '';
        left();
        return;
      }
      note.textContent = chatRejectText(r.code, r.why);
      if (r.code === 'chat_too_fast' && r.waitMs) this.countdown(send, r.waitMs, left);
    };
    input.addEventListener('input', left);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) go();
    });
    input.addEventListener('focus', () => this.hookViewport(b));
    add(row, input, send);
    add(body, row, note);
    left();
    body.style.maxHeight = '';
    log.scrollTop = log.scrollHeight;
  }

  /** 被限速时"发送"按钮倒计时，到点恢复 */
  private countdown(btn: HTMLButtonElement, ms: number, done: () => void): void {
    btn.dataset['wait'] = '1';
    btn.disabled = true;
    const end = this.now() + ms;
    const tick = (): void => {
      const s = Math.ceil((end - this.now()) / 1000);
      if (s <= 0 || !btn.isConnected) {
        btn.textContent = '发送';
        delete btn.dataset['wait'];
        done();
        return;
      }
      btn.textContent = `${s} 秒`;
      this.later(Math.min(1000, end - this.now()), tick);
    };
    tick();
  }

  private renderLog(): void {
    const log = this.chatLogEl;
    if (!log) return;
    log.replaceChildren();
    if (this.chatLog.length === 0) add(log, this.el('div', 'atf-empty', '还没人说话。这里的话不保存，房间散了就没了'));
    for (const m of this.chatLog) {
      const row = this.el('div', '');
      add(row, this.el('b', '', `${m.name}：`), this.doc.createTextNode(m.text));
      add(log, row);
    }
    log.scrollTop = log.scrollHeight;
  }

  /**
   * iOS 键盘弹出时会盖住下半屏、页面不一定跟着滚：按 visualViewport 把面板整个往上挪到键盘上面，记录区限在可见高度的 60% 以内。
   * 只动这个面板的 top（transform 里是 placeMenu 摆的位置），收起菜单时摘掉
   */
  private hookViewport(b: HTMLDivElement): void {
    const vv = window.visualViewport;
    if (!vv || this.vvFix) return;
    const fix = (): void => {
      const log = this.chatLogEl;
      if (log) log.style.maxHeight = `${Math.max(44, Math.floor(vv.height * 0.6) - 110)}px`;
      b.style.top = '0px';
      const r = b.getBoundingClientRect();
      const bottom = vv.offsetTop + vv.height - 8;
      if (r.bottom > bottom) b.style.top = `${Math.max(vv.offsetTop + 4 - r.top, bottom - r.bottom)}px`;
    };
    this.vvFix = fix;
    vv.addEventListener('resize', fix);
    vv.addEventListener('scroll', fix);
    fix();
  }

  private unhookViewport(): void {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (this.vvFix && vv) {
      vv.removeEventListener('resize', this.vvFix);
      vv.removeEventListener('scroll', this.vvFix);
    }
    this.vvFix = null;
  }

  private setUnread(on: boolean): void {
    this.unread = on;
    this.btn?.classList.toggle('atf-dot', on);
  }

  /**
   * 有人说了一句（好友房 RoomClient 的 onChat 交进来）：头像旁冒 4 秒气泡、记进聊天页。
   * 别人说的在"聊天：不看"、被屏蔽（单个或全部屏蔽）时一律不显示；面板没开在聊天页时"互动"按钮上亮个小红点
   */
  chat(from: number, text: string, _masked = false): void {
    if (this.dead || !this.o.chat) return;
    const src = this.seat(from);
    if (!src) return;
    if (!src.me && (!(this.o.chatEnabled?.() ?? true) || this.isBlocked(from))) return;
    this.chatLog.push({ seat: from, name: src.me ? '我' : src.name, text });
    while (this.chatLog.length > CHAT_UI.keep) this.chatLog.shift();
    this.says.get(from)?.remove();
    const bb = this.bubble(from, text, CHAT_UI.bubbleMs, 'atf-say');
    if (bb) this.says.set(from, bb);
    if (this.chatLogEl) this.renderLog();
    else if (!src.me) this.setUnread(true);
    this.o.log?.(`聊天 ${from}`);
  }

  /** 房间拒了一条（RoomClient 的 onChatError）：聊天页开着就在小字那行说一声 */
  chatError(code: string): void {
    const note = this.open?.querySelector<HTMLElement>('.atf-note');
    if (note) note.textContent = chatRejectText(code);
  }

  /** 有菜单或面板开着（游戏可以据此暂停自己的快捷键） */
  isOpen(): boolean {
    return this.open !== null;
  }

  // ───────────── 屏蔽（只是自己不看；这一局 / 这个房间有效） ─────────────

  private blockKey(): string {
    return `${this.o.storageKey}.fun.blocked`;
  }
  private blockedNames(): string[] {
    try {
      const raw = JSON.parse(sessionStorage.getItem(this.blockKey()) ?? 'null') as { scope?: string; names?: unknown } | null;
      return raw && raw.scope === (this.o.scope?.() ?? 'solo') && Array.isArray(raw.names) ? raw.names.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  isBlocked(seat: number): boolean {
    const s = this.seat(seat);
    return !!s && !s.me && this.blockedNames().includes(`${seat}:${s.name}`);
  }
  setBlocked(seat: number, on: boolean): void {
    const s = this.seat(seat);
    if (!s) return;
    const key = `${seat}:${s.name}`;
    const names = this.blockedNames().filter((n) => !n.startsWith(`${seat}:`));
    if (on) names.push(key);
    try {
      sessionStorage.setItem(this.blockKey(), JSON.stringify({ scope: this.o.scope?.() ?? 'solo', names }));
    } catch {
      // 存不了就只是不记
    }
  }

  // ───────────── 收 ─────────────

  /** 有人发了东西（好友房房间转发来的、单机自己的、电脑的）：按种类播；别人的东西在关了互动、被屏蔽时不播 */
  receive(from: number, id: number, to?: number): void {
    if (this.dead) return;
    const it = funItem(id, this.P);
    const src = this.seat(from);
    if (!it || !src) return;
    if (!src.me && (!this.enabled() || this.isBlocked(from))) return;
    // 好友房的电脑（房间里 botReact 算的）：晚一点播，表情配一句话，和单机的电脑看起来一样
    if (src.bot && !this.o.localBots) {
      this.later(FUN_TIMING.botLagMs, () => this.play(from, it, to, true));
      return;
    }
    this.play(from, it, to, false);
  }

  private play(from: number, it: FunItem, to: number | undefined, botTalk: boolean): void {
    const src = this.seat(from);
    if (!src || (!src.me && (!this.enabled() || this.isBlocked(from)))) return;
    if (it.kind === 'phrase') {
      const t = to !== undefined && to !== from ? this.seat(to) : null;
      this.bubble(from, `${t ? `@${t.name} ` : ''}${this.o.phrases[it.index] ?? ''}`);
      this.o.log?.(`短语 ${from}:${it.index}`);
    } else if (it.kind === 'sticker') {
      const name = STICKERS[it.index]!;
      void showSticker(this.layer, src.rect, name);
      const mood = botTalk ? stickerMood(name) : null;
      if (mood) this.bubble(from, this.line(mood));
      this.o.log?.(`表情 ${from}:${name}`);
    } else {
      const prop = PROPS[it.index]!;
      const dst = to === undefined ? null : this.seat(to);
      if (!dst || to === from) return;
      const r = this.tally.hit(from, to!, this.now());
      if (r.shield) {
        this.flash(to!, '护盾', '#9fd8ff');
        this.o.log?.(`护盾 ${to}`);
        return;
      }
      void throwAt(this.layer, src.rect, dst.rect, prop, {
        sound: this.o.sound,
        target: to,
        onHit: () => {
          this.o.onHit?.(to!, prop);
          if (r.combo >= 2) this.flash(to!, `×${r.combo}`, '#f3d98b');
        },
      });
      if (r.revenge) this.flash(to!, '回敬！', '#ffb070', -0.95);
      this.o.log?.(`道具 ${from}>${to}:${prop}${r.combo >= 2 ? ` ×${r.combo}` : ''}${r.revenge ? ' 回敬' : ''}`);
    }
    // 单机：冲电脑来的，电脑按性格反应（好友房的电脑在房间里算）
    if (this.o.localBots && to !== undefined && to !== from && this.seat(to)?.bot && (it.kind === 'prop' || it.kind === 'phrase')) {
      const prop = it.kind === 'prop' ? PROPS[it.index] : undefined;
      this.react({ kind: 'hit', from, to, ...(prop ? { prop } : {}) }, [to]);
    }
  }

  /** 名场面（游戏把自己的公开事件映射过来）：单机里电脑按性格起哄；横幅另由 banner 播 */
  moment(ev: Extract<FunEvent, { kind: 'moment' }>): void {
    if (!this.o.localBots) return;
    const bots = this.o.seats().map((s, i) => (s?.bot ? i : -1)).filter((i) => i >= 0);
    this.react(ev, bots);
  }

  private react(ev: FunEvent, seats: readonly number[]): void {
    if (!this.enabled()) return;
    for (const i of seats) {
      const s = this.seat(i);
      if (!s?.bot) continue;
      const a = botReact(ev, { seat: i, temper: s.temper ?? 'normal' }, this.bots, this.now(), () => this.rand(), this.o.react ?? BOT_REACT);
      if (a) this.later(a.delay, () => this.perform(a));
    }
  }

  /** 电脑的反应一定看得见：表情加一句话的气泡同时出；回敬再让道具飞过去 */
  private perform(a: BotAction): void {
    const s = this.seat(a.from);
    if (!s || !this.enabled() || this.isBlocked(a.from)) return;
    void showSticker(this.layer, s.rect, a.sticker);
    const t = a.to !== undefined ? this.seat(a.to) : null;
    this.bubble(a.from, `${t && a.prop === undefined ? `@${t.name} ` : ''}${this.line(a.mood)}`);
    this.o.log?.(`电脑 ${a.from}:${a.mood}`);
    if (a.prop && a.to !== undefined) this.receive(a.from, propId(this.P, PROPS.indexOf(a.prop)), a.to);
  }

  private line(mood: FunMood): string {
    const lines = this.o.moodLines?.[mood] ?? DEFAULT_LINES[mood];
    return lines[Math.floor(this.rand() * lines.length) % lines.length]!;
  }

  // ───────────── 小效果 ─────────────

  /** 头像旁的一句话：朝屏幕中间那侧冒，2.4 秒后淡出；cls 加样式（聊天的气泡能折行） */
  bubble(seat: number, text: string, ms = 2400, cls = ''): HTMLElement | undefined {
    const s = this.seat(seat);
    if (!s) return undefined;
    const b = this.el('div', `atf-bubble ${cls}`.trim(), text);
    this.layer.el.appendChild(b);
    const w = Math.min(cls ? 240 : 220, b.offsetWidth || text.length * 15 + 24);
    const cx = s.rect.left + s.rect.width / 2;
    const right = cx < window.innerWidth / 2;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, right ? s.rect.left + s.rect.width + 6 : s.rect.left - 6 - w));
    const y = Math.max(4, s.rect.top - 6);
    b.style.transform = `translate(${x}px,${y}px)`;
    void anim(b, [{ opacity: 0 }, { opacity: 1 }], 160).then(() => anim(b, [{ opacity: 1 }, { opacity: 0 }], 260, ms)).then(() => b.remove());
    return b;
  }

  /** 头像上方冒一个字（×N、回敬！、护盾）：放大弹一下再飘走 */
  private flash(seat: number, label: string, color: string, dy = -0.7): void {
    const s = this.seat(seat);
    if (!s) return;
    const f = this.el('div', 'atf-flash', label);
    f.style.color = color;
    this.layer.el.appendChild(f);
    const x = s.rect.left + s.rect.width * 0.6;
    const y = s.rect.top + s.rect.height * (0.5 + dy) - 14;
    const at = (k: string): string => `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) ${k}`;
    void anim(f, [{ transform: at('scale(.4)'), opacity: 0 }, { transform: at('scale(1.15)'), opacity: 1 }, { transform: at('scale(1)'), opacity: 1 }], 240)
      .then(() => anim(f, [{ transform: at('translateY(0)'), opacity: 1 }, { transform: at('translateY(-24px)'), opacity: 0 }], 380, 700))
      .then(() => f.remove());
  }

  /** 名场面横幅：屏幕上方居中一条红底金边，1.8 秒 */
  banner(text: string, sub?: string): void {
    const b = this.el('div', 'atf-banner', text);
    if (sub) add(b, this.el('small', '', sub));
    this.layer.el.appendChild(b);
    void anim(b, [{ transform: 'translateX(-50%) scaleX(.2)', opacity: 0 }, { transform: 'translateX(-50%) scaleX(1.05)', opacity: 1 }, { transform: 'translateX(-50%) scaleX(1)', opacity: 1 }], 280)
      .then(() => anim(b, [{ opacity: 1 }, { opacity: 0 }], 300, 1500))
      .then(() => b.remove());
  }

  /** 首次进牌桌：在一个电脑（没有就别人）头像旁说一句怎么玩，3 秒后收起，只出一次 */
  private hint(): void {
    const key = `${this.o.storageKey}.hint.fun`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    const at = hintSeatFor(this.o.seats(), this.o.hintSeat);
    if (at === null || !this.canSend() || !this.enabled() || this.open) return this.later(2000, () => this.hint());
    try {
      localStorage.setItem(key, '1');
    } catch {
      // 记不住就下次再提示一次
    }
    this.bubble(at, HINT_TEXT, FUN_TIMING.hintMs);
    this.o.log?.('提示 头像');
  }

  // ───────────── 游戏的弹窗、离开牌桌 ─────────────

  /** 游戏开自己的弹窗时藏起来（正在播的不中断），关掉后 show */
  hide(): void {
    this.closeAll();
    this.layer.hide();
    this.ui.style.visibility = 'hidden';
  }
  show(): void {
    this.layer.show();
    this.ui.style.visibility = '';
  }

  /** 冒烟用：按钮、头像热区、开着的菜单里每一项的屏幕中心和大小（查点按区 ≥ 44） */
  controls(): Record<string, { x: number; y: number; w: number; h: number }> {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const c = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    };
    if (this.btn) out['fun:button'] = c(this.btn);
    this.hots.forEach((h, i) => {
      if (h.style.display !== 'none') out[`fun:seat${i}`] = c(h);
    });
    this.open?.querySelectorAll<HTMLElement>('[data-key]').forEach((e) => (out[e.dataset['key']!] = c(e)));
    return out;
  }

  destroy(): void {
    this.dead = true;
    this.unhookViewport();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    window.removeEventListener('resize', this.onResize);
    this.ui.remove();
    this.layer.destroy();
  }
}
