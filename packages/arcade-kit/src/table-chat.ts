/**
 * 牌桌聊天的界面（0.19.0，docs/chat.md 第 5 节）：电脑上牌桌一角常驻的聊天框、手机上的"聊天"按钮和贴底输入条、弹幕、最近 30 条记录。
 * 所有者 2026-10-18：聊天太简陋、不显眼，电脑上气泡太小。TableFun 建它、喂它，游戏不直接用（不进 package.json 的 exports）。
 * 和 table-fun.ts 同样的规矩：import 时不碰 DOM；动画只动 transform、opacity；量位置只在摆放（refresh）和出一条弹幕时。
 */
import { CHAT_MAX, chatRejectText, type ChatBlockWhy } from './chat.js';
import { DANMAKU, barBottom, chatFont, chatMode, danmakuLanes, danmakuSpeed, pickLane, placeBeside, placeDock, seatColor, type Box, type ChatMode } from './fun-logic.js';

export type ChatResultLike = { ok: true } | { ok: false; code: string; why?: ChatBlockWhy; waitMs?: number };

/** 记录里的一行：打的字和快捷短语都记（只在内存里，关页面、换房间就没了） */
export interface ChatLine {
  seat: number;
  name: string;
  text: string;
  me: boolean;
}

/** 存在游戏给的 key 下（`<游戏id>.chat` 这类，checkPrefsKey 查过）：没设过的项按默认 */
interface ChatPrefs {
  /** 弹幕开关；没设过：系统要求减少动态效果、或省内存模式时默认关，其余默认开 */
  danmaku?: boolean;
  /** 电脑版聊天框收起来了 */
  folded?: boolean;
  /** 电脑版聊天框的记录展开成长条 */
  long?: boolean;
}

export interface ChatHost {
  /** 点得到的那一层（.atf-ui）和点击穿透的效果层（弹幕画在这里） */
  ui: HTMLElement;
  fx: HTMLElement;
  prefsKey: string;
  /** 快捷词：游戏的短语表，点了按短语发（走互动的发送通道，没开打字聊天也能用） */
  phrases: readonly string[];
  phrase(i: number): void;
  /** 打字：好友房 RoomClient.chat、单机 localChat */
  send(text: string): ChatResultLike;
  /** 现在能不能发（旁观、没坐下不能） */
  canSend(): boolean;
  /** 不能盖的地方：游戏的禁区、"互动"按钮、头像、名牌 */
  blocked(): Box[];
  /** 正在显示的气泡（弹幕的轨道也避开） */
  bubbles(): Box[];
  /** 各家头像和名牌（默认弹幕区的上沿压到上方各家的下面） */
  seatBoxes(): Box[];
  /** 手机输入条不能盖的：游戏的禁区（手牌、操作按钮）、"互动"按钮、自己的头像和名牌（别家的头像打字时盖住没关系） */
  barBlocked(): Box[];
  /** "互动"按钮的矩形（手机版"聊天"按钮挨着它、跟它一样大），按同样的尺寸参数画 */
  button(): Box | null;
  styleButton(b: HTMLElement): void;
  /** 游戏指定电脑版聊天框的位置（只用 left、top、width），不给就自己挑角 */
  dock?(): Box | null;
  /** 游戏指定手机版"聊天"按钮的位置，不给就挨着"互动"按钮 */
  chatButton?(): Box | null;
  /** 游戏指定弹幕区，不给就是牌桌上半部分 */
  area?(): Box | null;
  /** 省内存模式（弹幕默认关） */
  lite(): boolean;
  /** 手机版"记录"：打开互动面板的聊天页 */
  history(): void;
  later(ms: number, fn: () => void): void;
  now(): number;
  log?(line: string): void;
}

export const CHAT_CSS = `
.atc-dock{position:absolute;left:0;top:0;pointer-events:auto;display:flex;flex-direction:column;gap:6px;background:var(--ak-bg,rgba(43,29,20,.9));border:2px solid var(--ak-border,#d4a64a);border-radius:var(--ak-radius,14px);padding:8px;box-sizing:border-box;color:var(--ak-fg,#fff6e0);box-shadow:0 6px 18px rgba(0,0,0,.4)}
.atc-head{display:flex;align-items:center;gap:6px}
.atc-head b{flex:1;color:var(--ak-title,#f3d98b);font-size:1.05em}
.atc-head .atf-chip{min-height:36px;padding:0 10px;font-size:.8em}
.atc-log{display:flex;flex-direction:column;gap:2px;line-height:1.45;font-size:.9em;overflow-y:auto;overscroll-behavior:contain}
.atc-log .atf-empty{opacity:.6}
.atc-log b,.atf-log b{font-weight:700;margin-right:4px}
.atc-quick{display:flex;gap:6px;overflow-x:auto;overscroll-behavior:contain;scrollbar-width:none;flex-shrink:0;padding-right:28px;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 36px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 36px),transparent)}
.atc-quick::-webkit-scrollbar{display:none}
.atc-quick .atf-chip{flex:none;white-space:nowrap;font-size:.8em}
.atc-row{display:flex;gap:6px;align-items:center}
.atc-row .atf-input{font-size:max(16px,.85em)}
.atc-row .atf-chip{flex:none}
.atc-pill{position:absolute;left:0;top:0;pointer-events:auto;min-height:44px;display:flex;align-items:center;gap:6px;padding:0 16px;border-radius:var(--ak-radius-btn,22px);border:2px solid var(--ak-border,#d4a64a);background:var(--ak-soft,#5a3a22);color:var(--ak-fg,#fff6e0);font:inherit;font-weight:700;cursor:pointer}
.atc-pill svg{width:1.2em;height:1.2em}
.atc-pill.atf-dot::after{content:'';position:absolute;right:4px;top:4px;width:10px;height:10px;border-radius:50%;background:#e8323a;border:2px solid var(--ak-fg,#fff6e0)}
.atc-dock .atf-note:empty,.atc-bar .atf-note:empty{display:none}
.atc-bar{position:absolute;left:8px;right:8px;top:0;pointer-events:auto;display:flex;flex-direction:column;gap:6px;background:var(--ak-bg,rgba(43,29,20,.94));border:2px solid var(--ak-border,#d4a64a);border-radius:var(--ak-radius,14px);padding:6px;box-sizing:border-box;color:var(--ak-fg,#fff6e0);box-shadow:0 -4px 16px rgba(0,0,0,.4)}
.atc-dms{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.atc-dm{position:absolute;left:0;top:0;white-space:nowrap;font-weight:700;color:#fff;padding:2px 12px;border-radius:999px;background:rgba(0,0,0,.38);text-shadow:0 1px 2px rgba(0,0,0,.8);pointer-events:none;will-change:transform}
.atc-dm.atc-me{background:rgba(122,42,30,.78);border:2px solid var(--ak-title,#f3d98b);color:#fff6e0}
`;

const CHAT_ICON = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"><path d="M10 14h44v28H30l-12 10v-10h-8z"/></svg>';

/** prefsKey 只认 `<游戏id>.<名字>` 的写法（存储前缀规则：kit 写的 key 一定带游戏前缀），不合格构造时就抛错 */
export function checkPrefsKey(key: unknown, storageKey: string): string {
  if (typeof key !== 'string' || !key.startsWith(`${storageKey}.`) || !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(key) || key.length > 64) {
    throw new Error(`TableFun prefsKey 要写成 "${storageKey}.<名字>"（小写字母、数字、连字符），收到 ${JSON.stringify(key)}`);
  }
  return key;
}

function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

export class ChatUi {
  /** 最近 KEEP 条，新的在后 */
  readonly lines: ChatLine[] = [];
  static readonly KEEP = 30;
  private readonly h: ChatHost;
  private readonly doc: Document;
  private prefs: ChatPrefs;
  private on = false;
  private mode: ChatMode = 'desk';
  private font = 18;
  private dockEl: HTMLDivElement | null = null;
  private pill: HTMLButtonElement | null = null;
  private btn: HTMLButtonElement | null = null;
  private bar: HTMLDivElement | null = null;
  /** 渲染记录的地方：电脑版聊天框里的那块、互动面板聊天页里的那块 */
  private logs = new Set<HTMLElement>();
  private unread = false;
  private freeAt: number[] = [];
  private live = 0;
  private pending: ChatLine[] = [];
  private waiting = false;
  private vvFix: (() => void) | null = null;
  /** 弹幕自己一层，垫在效果层最底下：气泡、表情、道具永远在弹幕上面 */
  private dm: HTMLDivElement | null = null;

  constructor(host: ChatHost) {
    this.h = host;
    this.doc = host.ui.ownerDocument;
    this.prefs = this.load();
  }

  private dmLayer(): HTMLDivElement {
    if (!this.dm) {
      this.dm = this.el('div', 'atc-dms');
      this.h.fx.insertBefore(this.dm, this.h.fx.firstChild);
    }
    return this.dm;
  }

  // ───────────── 设置 ─────────────

  private load(): ChatPrefs {
    try {
      const raw = JSON.parse(localStorage.getItem(this.h.prefsKey) ?? 'null') as ChatPrefs | null;
      if (!raw || typeof raw !== 'object') return {};
      const out: ChatPrefs = {};
      for (const k of ['danmaku', 'folded', 'long'] as const) if (typeof raw[k] === 'boolean') out[k] = raw[k];
      return out;
    } catch {
      return {};
    }
  }
  private save(): void {
    try {
      localStorage.setItem(this.h.prefsKey, JSON.stringify(this.prefs));
    } catch {
      // 存不了就只是这一次有效
    }
  }

  /** 弹幕开着吗：设过就按设的；没设过，系统要求减少动态效果或省内存模式时关 */
  danmaku(): boolean {
    if (this.prefs.danmaku !== undefined) return this.prefs.danmaku;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !reduce && !this.h.lite();
  }
  setDanmaku(on: boolean): void {
    this.prefs.danmaku = on;
    this.save();
    if (!on) {
      this.pending = [];
      this.dm?.replaceChildren();
    }
    this.h.ui.querySelectorAll<HTMLElement>('[data-key="chat:danmaku"],[data-key="fun:danmaku"]').forEach((c) => (c.textContent = this.danmakuLabel()));
    this.h.log?.(`弹幕 ${on ? '开' : '关'}`);
  }
  danmakuLabel(): string {
    return `弹幕：${this.danmaku() ? '开' : '关'}`;
  }

  // ───────────── 摆放 ─────────────

  /** on = 这会儿有聊天（游戏开了聊天、设置没关）。窗口变了、座位挪了由 TableFun.refresh 调 */
  refresh(on: boolean): void {
    this.on = on;
    const view = { width: window.innerWidth, height: window.innerHeight };
    this.mode = chatMode(view);
    this.font = chatFont(view, this.mode);
    if (!on) {
      this.clearDesk();
      this.clearPhone();
      return;
    }
    if (this.mode === 'desk') {
      this.clearPhone();
      this.drawDesk(view);
    } else {
      this.clearDesk();
      this.drawPhone(view);
    }
  }

  /** 聊天自己占的地方（气泡、弹幕要避开） */
  rects(): Box[] {
    return [this.dockEl, this.pill, this.btn, this.bar].filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.getBoundingClientRect());
  }

  /** 有输入条或聊天框里的输入框正在用（游戏据此暂停快捷键） */
  typing(): boolean {
    return !!this.bar || this.doc.activeElement?.classList.contains('atc-input') === true;
  }

  private clearDesk(): void {
    this.dockEl?.remove();
    this.pill?.remove();
    if (this.dockEl) this.logs.delete(this.dockEl.querySelector('.atc-log')!);
    this.dockEl = null;
    this.pill = null;
  }
  private clearPhone(): void {
    this.btn?.remove();
    this.btn = null;
    this.closeBar();
  }

  private drawDesk(view: { width: number; height: number }): void {
    const w = Math.round(this.font * 17);
    const fixed = this.h.dock?.() ?? null;
    if (this.prefs.folded) {
      if (this.dockEl) this.clearDesk();
      if (!this.pill) {
        const p = this.el('button', 'atc-pill');
        p.type = 'button';
        p.dataset['key'] = 'chat:open';
        p.innerHTML = `${CHAT_ICON}<span>聊天</span>`;
        p.addEventListener('click', (e) => {
          e.stopPropagation();
          this.fold(false);
        });
        this.h.ui.appendChild(p);
        this.pill = p;
      }
      this.pill.style.fontSize = `${this.font - 2}px`;
      this.pill.classList.toggle('atf-dot', this.unread);
      const pw = this.pill.offsetWidth || 110;
      const at = fixed ? { left: fixed.left, top: fixed.top } : placeDock(view, pw, 48, this.h.blocked());
      this.pill.style.transform = `translate(${at.left}px,${at.top}px)`;
      return;
    }
    if (!this.dockEl) this.dockEl = this.buildDock();
    const d = this.dockEl;
    d.style.fontSize = `${this.font - 2}px`;
    d.style.width = `${fixed?.width ?? w}px`;
    const log = d.querySelector<HTMLElement>('.atc-log')!;
    const line = (this.font - 2) * 0.9 * 1.45 + 2;
    // 按内容高度：最少两行（空的时候那句提示），最多 5 行；展开后最多半屏
    log.style.minHeight = `${Math.round(line * 2)}px`;
    log.style.maxHeight = `${Math.round(this.prefs.long ? Math.min(view.height * 0.5, line * ChatUi.KEEP) : line * 5)}px`;
    const input = d.querySelector<HTMLInputElement>('.atc-input');
    if (input) input.disabled = !this.h.canSend();
    const at = fixed ? { left: fixed.left, top: fixed.top } : placeDock(view, w, d.offsetHeight || 260, this.h.blocked());
    d.style.transform = `translate(${at.left}px,${at.top}px)`;
    log.scrollTop = log.scrollHeight;
  }

  private buildDock(): HTMLDivElement {
    const d = this.el('div', 'atc-dock');
    d.dataset['key'] = 'chat:dock';
    d.addEventListener('pointerdown', (e) => e.stopPropagation());
    const head = this.el('div', 'atc-head');
    add(
      head,
      this.el('b', '', '聊天'),
      this.chip(this.danmakuLabel(), 'chat:danmaku', () => this.setDanmaku(!this.danmaku()), 'atf-soft'),
      this.chip(this.prefs.long ? '少看几条' : '展开记录', 'chat:more', () => {
        this.prefs.long = !this.prefs.long;
        this.save();
        this.clearDesk();
        this.refresh(this.on);
      }, 'atf-soft'),
      this.chip('收起', 'chat:fold', () => this.fold(true), 'atf-grey'),
    );
    const log = this.el('div', 'atc-log');
    this.logs.add(log);
    const { row, note } = this.inputRow('chat', 'atc-input');
    add(d, head, log, this.quick('chat'), row, note);
    this.h.ui.appendChild(d);
    this.render();
    return d;
  }

  private fold(on: boolean): void {
    this.prefs.folded = on;
    this.save();
    if (!on) this.setUnread(false);
    this.clearDesk();
    this.refresh(this.on);
  }

  private drawPhone(view: { width: number; height: number }): void {
    const r = this.h.button();
    if (!r) {
      this.clearPhone();
      return;
    }
    if (!this.btn) {
      const b = this.el('button', 'atf-btn');
      b.type = 'button';
      b.dataset['key'] = 'chat:button';
      b.innerHTML = `${CHAT_ICON}<span>聊天</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.bar) this.closeBar();
        else this.openBar();
      });
      this.h.ui.appendChild(b);
      this.btn = b;
    }
    const b = this.btn;
    this.h.styleButton(b);
    const w = Math.max(44, r.width);
    const hh = Math.max(44, r.height);
    b.style.width = `${w}px`;
    b.style.height = `${hh}px`;
    b.classList.toggle('atf-dot', this.unread);
    // 游戏给了位置就放那；不然挨着"互动"按钮（先右后左再上下），手牌、名牌、头像都避开
    const own = this.h.chatButton?.() ?? null;
    const at = own ? { left: own.left, top: own.top } : placeBeside(r, w, hh, view, this.h.blocked(), 4, 8);
    if (own) {
      b.style.width = `${Math.max(44, own.width)}px`;
      b.style.height = `${Math.max(44, own.height)}px`;
    }
    b.style.transform = `translate(${at.left}px,${at.top}px)`;
    if (this.bar) this.placeBar();
  }

  /** 手机版输入条：快捷词一排、输入框、发送、记录、收起；贴在手牌和操作按钮上面 */
  openBar(): void {
    if (this.bar || !this.on) return;
    const bar = this.el('div', 'atc-bar');
    bar.dataset['key'] = 'chat:bar';
    bar.style.fontSize = `${this.font + 1}px`;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    const { row, note, input } = this.inputRow('chat', 'atc-input');
    add(
      row,
      this.chip('记录', 'chat:history', () => {
        this.closeBar();
        this.h.history();
      }, 'atf-soft'),
      this.chip('✕', 'chat:close', () => this.closeBar(), 'atf-grey'),
    );
    add(bar, this.quick('chat'), row, note);
    this.h.ui.appendChild(bar);
    this.bar = bar;
    this.setUnread(false);
    input.addEventListener('focus', () => this.hookViewport());
    this.placeBar();
    this.h.log?.('聊天 输入条');
  }

  closeBar(): void {
    this.unhookViewport();
    this.bar?.remove();
    this.bar = null;
  }

  private placeBar(): void {
    const bar = this.bar;
    if (!bar) return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const h = bar.offsetHeight || 120;
    let bottom = barBottom(view, h, [...this.h.barBlocked(), ...(this.btn ? [this.btn.getBoundingClientRect()] : [])]);
    // 键盘弹起：可见区变矮，输入条跟着站到键盘上面
    const vv = window.visualViewport;
    if (vv && this.doc.activeElement?.classList.contains('atc-input')) bottom = Math.min(bottom, vv.offsetTop + vv.height - 6);
    bar.style.transform = `translateY(${Math.max(4, bottom - h)}px)`;
  }

  private hookViewport(): void {
    const vv = window.visualViewport;
    if (!vv || this.vvFix) return;
    const fix = (): void => this.placeBar();
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

  // ───────────── 小部件 ─────────────

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  chip(label: string, key: string, fn: () => void, cls = ''): HTMLButtonElement {
    const c = this.el('button', `atf-chip ${cls}`.trim(), label);
    c.type = 'button';
    c.dataset['key'] = key;
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return c;
  }

  /** 输入框上方那排快捷词：点了直接按短语发（冷却和互动共用，被冷却挡住时不发） */
  private quick(prefix: string): HTMLDivElement {
    const q = this.el('div', 'atc-quick');
    this.h.phrases.forEach((p, i) => add(q, this.chip(p, `${prefix}:phrase${i}`, () => this.h.phrase(i), 'atf-soft')));
    return q;
  }

  /**
   * 一行输入框 + 发送，下面一行小字（还能打几个字、为什么没发出去）。回车发送；被限速时"发送"倒计时。
   * 电脑版聊天框、手机输入条、互动面板的聊天页共用
   */
  inputRow(prefix: string, cls = ''): { row: HTMLDivElement; note: HTMLDivElement; input: HTMLInputElement } {
    const row = this.el('div', 'atc-row');
    const input = this.el('input', `atf-input ${cls}`.trim());
    input.type = 'text';
    input.enterKeyHint = 'send';
    input.autocomplete = 'off';
    input.placeholder = '说点什么，回车发送';
    input.dataset['key'] = prefix === 'fun' ? 'fun:chatInput' : `${prefix}:input`;
    const send = this.chip('发送', prefix === 'fun' ? 'fun:chatSend' : `${prefix}:send`, () => go());
    const note = this.el('div', 'atf-note');
    const left = (): void => {
      const n = CHAT_MAX - Array.from(input.value.trim()).length;
      note.textContent = n < 0 ? `多了 ${-n} 个字` : input.value ? `还能打 ${n} 个字` : '';
      send.disabled = n < 0 || send.dataset['wait'] === '1' || !this.h.canSend();
    };
    const go = (): void => {
      if (!input.value.trim() || send.disabled) return;
      const r = this.h.send(input.value);
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
      // 打字时不让游戏的快捷键接到
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) go();
      if (e.key === 'Escape') input.blur();
    });
    add(row, input, send);
    left();
    return { row, note, input };
  }

  private countdown(btn: HTMLButtonElement, ms: number, done: () => void): void {
    btn.dataset['wait'] = '1';
    btn.disabled = true;
    const end = this.h.now() + ms;
    const tick = (): void => {
      const s = Math.ceil((end - this.h.now()) / 1000);
      if (s <= 0 || !btn.isConnected) {
        btn.textContent = '发送';
        delete btn.dataset['wait'];
        done();
        return;
      }
      btn.textContent = `${s} 秒`;
      this.h.later(Math.min(1000, end - this.h.now()), tick);
    };
    tick();
  }

  /** 房间拒了一条：看得见的小字行都说一声 */
  note(text: string): void {
    this.h.ui.querySelectorAll<HTMLElement>('.atf-note').forEach((n) => (n.textContent = text));
  }

  // ───────────── 记录 ─────────────

  /** 互动面板的聊天页挂上 / 摘下它的记录区 */
  bindLog(el: HTMLElement | null, old?: HTMLElement | null): void {
    if (old) this.logs.delete(old);
    if (el) {
      this.logs.add(el);
      this.renderOne(el);
    }
  }

  private render(): void {
    for (const el of this.logs) this.renderOne(el);
  }

  private renderOne(log: HTMLElement): void {
    log.replaceChildren();
    if (this.lines.length === 0) add(log, this.el('div', 'atf-empty', '还没人说话。这里的话不保存，散了就没了'));
    for (const m of this.lines) {
      const row = this.el('div', '');
      const b = this.el('b', '', `${m.name}：`);
      b.style.color = seatColor(m.seat);
      add(row, b, this.doc.createTextNode(m.text));
      add(log, row);
    }
    log.scrollTop = log.scrollHeight;
  }

  /** 有人说了一句（打字或快捷短语）：进记录、飘弹幕；看不见聊天的时候亮小红点 */
  push(line: ChatLine, panelOpen: boolean): void {
    this.lines.push(line);
    while (this.lines.length > ChatUi.KEEP) this.lines.shift();
    this.render();
    if (!line.me && !panelOpen && !this.bar && !(this.mode === 'desk' && this.dockEl)) this.setUnread(true);
    this.danmakuOf(line);
  }

  setUnread(on: boolean): void {
    this.unread = on;
    this.btn?.classList.toggle('atf-dot', on);
    this.pill?.classList.toggle('atf-dot', on);
  }

  // ───────────── 弹幕 ─────────────

  private danmakuOf(line: ChatLine): void {
    if (!this.on || !this.danmaku()) return;
    const cap = this.mode === 'desk' ? DANMAKU.maxDesk : DANMAKU.maxPhone;
    if (this.live >= cap || !this.fly(line)) {
      // 满了或没有空轨道：排着，最多 DANMAKU.queue 条，再多丢最老的
      this.pending.push(line);
      while (this.pending.length > DANMAKU.queue) this.pending.shift();
      this.wake();
    }
  }

  /**
   * 弹幕区：游戏给了就用；不给是屏幕 8%–58%，上沿再压到最上面一排座位（头像顶边在屏高 20% 以内的，就是对家那一排）的头像、名牌下沿以下，
   * 顶栏和对家名牌不被横穿；剩下不够两行时往下放宽（最多到 75%），不往上退
   */
  private area(): Box {
    const a = this.h.area?.();
    if (a) return a;
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const lineH = Math.round(this.font * 1.5) + 10;
    const top = Math.max(Math.round(hh * 0.08), ...this.h.seatBoxes().filter((b) => b.top < hh * 0.2).map((b) => b.top + b.height + 4));
    const bottom = Math.min(Math.round(hh * 0.75), Math.max(Math.round(hh * 0.58), top + lineH * 2));
    return { left: 0, top, width: w, height: Math.max(0, bottom - top) };
  }

  /** 找空轨道飞一条；没有空的返回 false */
  private fly(line: ChatLine): boolean {
    const area = this.area();
    // 弹幕层裁在弹幕区里（0.19.1）：从区的右沿出现、左沿消失，不会飘出去擦过两边的座位
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.dmLayer().style.clipPath = `inset(${Math.max(0, area.top)}px ${Math.max(0, vw - area.left - area.width)}px ${Math.max(0, vh - area.top - area.height)}px ${Math.max(0, area.left)}px)`;
    const lineH = Math.round(this.font * 1.5) + 10;
    const lanes = danmakuLanes(area, lineH, [...this.h.blocked(), ...this.h.bubbles(), ...this.rects()], this.mode === 'desk' ? DANMAKU.lanesDesk : DANMAKU.lanesPhone);
    if (lanes.length === 0) return true;
    if (this.freeAt.length !== lanes.length) this.freeAt = lanes.map(() => 0);
    const now = this.h.now();
    const i = pickLane(this.freeAt, now);
    if (i < 0) return false;
    const e = this.el('div', `atc-dm${line.me ? ' atc-me' : ''}`);
    e.style.fontSize = `${this.font}px`;
    const b = this.el('b', '', `${line.name}：`);
    b.style.color = line.me ? '' : seatColor(line.seat);
    add(e, b, this.doc.createTextNode(line.text));
    this.dmLayer().appendChild(e);
    const w = e.offsetWidth || line.text.length * this.font + 60;
    const v = danmakuSpeed(area.width);
    const y = lanes[i]! + (lineH - (e.offsetHeight || lineH)) / 2;
    this.freeAt[i] = now + (w + DANMAKU.gap) / v;
    const from = `translate(${area.left + area.width}px,${y}px)`;
    const to = `translate(${area.left - w}px,${y}px)`;
    e.style.transform = from;
    this.live++;
    const done = (): void => {
      e.remove();
      this.live--;
      this.wake();
    };
    if (typeof e.animate !== 'function') {
      this.h.later((area.width + w) / v, done);
      return true;
    }
    e.animate([{ transform: from }, { transform: to }], { duration: (area.width + w) / v, easing: 'linear', fill: 'both' }).finished.then(done, done);
    return true;
  }

  /** 排着的弹幕：到最早那条轨道空出来时再试 */
  private wake(): void {
    // 满了不用等：哪条飞完了 done 会再叫
    if (this.waiting || this.pending.length === 0 || this.live >= (this.mode === 'desk' ? DANMAKU.maxDesk : DANMAKU.maxPhone)) return;
    const now = this.h.now();
    const ms = this.freeAt.length ? Math.max(50, Math.min(...this.freeAt) - now) : 200;
    this.waiting = true;
    this.h.later(ms, () => {
      this.waiting = false;
      if (!this.on || !this.danmaku()) {
        this.pending = [];
        return;
      }
      const cap = this.mode === 'desk' ? DANMAKU.maxDesk : DANMAKU.maxPhone;
      while (this.pending.length && this.live < cap && this.fly(this.pending[0]!)) this.pending.shift();
      this.wake();
    });
  }

  destroy(): void {
    this.unhookViewport();
    this.pending = [];
    this.logs.clear();
    this.dm?.remove();
  }
}
