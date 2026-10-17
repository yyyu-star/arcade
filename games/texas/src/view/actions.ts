/**
 * 右下角的操作区（DESIGN.md 8.2）：弃牌 / 过牌或跟注 / 加注；加注展开滑杆和"最小、½ 池、¾ 池、1 池、全下"。
 * 0.2.1：按钮上面一行写池子多大、要跟多少、赔率（要有多大把握才值得跟），再一排一键下注（半池、⅔ 池、满池、全下，点了直接下）。
 * 不该我说话时可以预选"过牌或弃牌""跟任何注"，轮到我时自动做（只在页面里，不发消息）。
 * 桌面上有快捷键：F 弃牌、C 过牌或跟注、R 加注、回车确认。
 */
import type { Action } from '../core/table.ts';
import type { View } from '../core/view.ts';
import { el, setText, toggle } from './dom.ts';
import { chips } from './text.ts';

type Pre = 'checkfold' | 'callany' | null;

export class ActionBar {
  readonly root: HTMLDivElement;
  private readonly fold: HTMLButtonElement;
  private readonly call: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly slider: HTMLInputElement;
  private readonly amount: HTMLSpanElement;
  private readonly presets: HTMLButtonElement[] = [];
  private readonly pre: HTMLDivElement;
  private readonly odds: HTMLDivElement;
  private readonly quick: HTMLDivElement;
  private readonly quicks: HTMLButtonElement[] = [];
  private readonly preCheck: HTMLButtonElement;
  private readonly preCall: HTMLButtonElement;
  private v: View | null = null;
  private preset: Pre = null;
  /** 预选是在哪一手、面对多大的注时选的：注变了"过牌或弃牌"就不再自动弃 */
  private presetHand = -1;
  private onAct: (a: Action) => void;
  private onPanel: (r: DOMRect | null) => void;

  /** onPanel：操作区（含赔率、一键下注、展开的加注面板）在屏幕上的位置，收起时 null；牌桌把被盖住的座位挪开 */
  constructor(parent: HTMLElement, onAct: (a: Action) => void, onPanel: (r: DOMRect | null) => void = () => {}) {
    this.onAct = onAct;
    this.onPanel = onPanel;
    this.root = el('div', 'actions', parent);
    this.panel = el('div', 'raise-panel', this.root);
    const row = el('div', 'presets', this.panel);
    for (const [label, frac] of [['最小', 0], ['½池', 0.5], ['¾池', 0.75], ['1池', 1], ['全下', -1]] as const) {
      const b = el('button', 'preset', row, label);
      b.type = 'button';
      b.dataset.frac = String(frac);
      b.addEventListener('click', () => this.setRaise(this.presetTo(frac)));
      this.presets.push(b);
    }
    const line = el('div', 'raise-line', this.panel);
    const minus = el('button', 'step', line, '−');
    this.slider = el('input', 'slider', line);
    this.slider.type = 'range';
    const plus = el('button', 'step', line, '+');
    // 下注额放在滑杆这一行的最右边（0.18.2）：原来单独占一行，面板高出一截，6 人桌右下角的座位被挤成只剩名牌
    this.amount = el('span', 'raise-amt', line);
    minus.type = plus.type = 'button';
    minus.addEventListener('click', () => this.nudge(-1));
    plus.addEventListener('click', () => this.nudge(1));
    this.slider.addEventListener('input', () => this.setRaise(Number(this.slider.value)));

    this.odds = el('div', 'odds', this.root);
    this.quick = el('div', 'quick', this.root);
    for (const [label, frac] of [['半池', 0.5], ['⅔池', 2 / 3], ['满池', 1], ['全下', -1]] as const) {
      const b = btn(this.quick, 'qbet', label, () => this.quickBet(frac));
      b.dataset.frac = String(frac);
      this.quicks.push(b);
    }
    const bar = el('div', 'buttons', this.root);
    this.fold = btn(bar, 'act fold', '弃牌', () => this.send({ t: 'fold' }));
    this.call = btn(bar, 'act call', '过牌', () => this.doCall());
    this.raise = btn(bar, 'act raise', '加注', () => this.doRaise());

    this.pre = el('div', 'pre', parent);
    this.preCheck = btn(this.pre, 'pre-btn', '过牌或弃牌', () => this.togglePre('checkfold'));
    this.preCall = btn(this.pre, 'pre-btn', '跟任何注', () => this.togglePre('callany'));

    window.addEventListener('keydown', (e) => this.key(e));
  }

  /** 按视图摆出来；轮到我且有预选时返回要自动做的操作 */
  update(v: View | null, enabled: boolean): Action | null {
    this.v = v;
    const lg = v && enabled && v.me !== null && v.toAct === v.me ? v.legal : null;
    toggle(this.root, 'on', lg !== null);
    if (v && v.handNo !== this.presetHand) this.preset = null;
    const inHand = !!v && v.me !== null && v.seats[v.me]?.status === 'active' && v.phase !== 'idle';
    toggle(this.pre, 'on', !lg && inHand && v?.toAct !== v?.me);
    toggle(this.preCheck, 'sel', this.preset === 'checkfold');
    toggle(this.preCall, 'sel', this.preset === 'callany');
    if (!lg || !v) {
      this.closePanel();
      return null;
    }
    // 轮到我了：先看预选
    const p = this.preset;
    this.preset = null;
    if (p === 'checkfold') return lg.check ? { t: 'check' } : { t: 'fold' };
    if (p === 'callany') return lg.check ? { t: 'check' } : { t: 'call' };

    const me = v.seats[v.me!]!;
    const allinCall = !lg.check && lg.call >= me.stack;
    setText(this.call, lg.check ? '过牌' : allinCall ? `全下 ${chips(lg.call)}` : `跟注 ${chips(lg.call)}`);
    toggle(this.call, 'allin', allinCall);
    toggle(this.raise, 'hidden', !lg.raise);
    // 能过牌时弃牌放一边、淡一点（白白弃牌多半是点错了）
    toggle(this.fold, 'soft', lg.check);
    this.drawOdds(v);
    queueMicrotask(() => this.cover());
    this.slider.min = String(lg.minTo);
    this.slider.max = String(lg.maxTo);
    this.slider.step = String(Math.max(1, v.sb));
    if (this.panelOpen()) this.setRaise(Number(this.slider.dataset.v ?? this.slider.value));
    else setText(this.raise, v.currentBet === 0 ? '下注' : '加注');
    return null;
  }

  /**
   * 池子多大、要跟多少、赔率。赔率 = 跟了以后能赢的（现在的池子）: 要跟的；
   * "要赢 X%" = 跟的 ÷（池子 + 跟的）：赢面比这个大，长期跟就不亏
   */
  private drawOdds(v: View): void {
    const lg = v.legal!;
    const pot = v.pot;
    if (lg.check) this.odds.innerHTML = `底池 <b>${chips(pot)}</b>`;
    else {
      const ratio = pot / lg.call;
      const need = Math.round((lg.call / (pot + lg.call)) * 100);
      this.odds.innerHTML = `底池 <b>${chips(pot)}</b> · 跟 <b>${chips(lg.call)}</b> · 赔率 <b>${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} : 1</b><span class="need">（赢面过 ${need}% 可跟）</span>`;
    }
    // 一键下注：每个按钮写上会下到多少；和最小加注、全下一样多的不重复给
    toggle(this.quick, 'hidden', !lg.raise);
    if (!lg.raise) return;
    const seen = new Set<number>();
    for (const b of this.quicks) {
      const frac = Number(b.dataset.frac);
      const to = this.presetTo(frac);
      const dup = frac >= 0 && (to >= lg.maxTo || seen.has(to));
      seen.add(to);
      toggle(b, 'hidden', dup);
      b.textContent = frac < 0 ? `全下 ${chips(lg.maxTo)}` : `${b.textContent!.split(' ')[0]} ${chips(to)}`;
    }
  }

  /** 一键下注：直接下，不展开滑杆 */
  private quickBet(frac: number): void {
    const lg = this.v?.legal;
    if (!lg?.raise) return;
    const to = this.presetTo(frac);
    this.send(to >= lg.maxTo ? { t: 'allin' } : { t: 'raise', to });
  }

  /** 告诉牌桌操作区现在盖着哪一块（没亮时 null） */
  private cover(): void {
    this.onPanel(this.root.classList.contains('on') ? this.root.getBoundingClientRect() : null);
  }

  private send(a: Action): void {
    toggle(this.root, 'on', false);
    this.closePanel();
    this.onAct(a);
  }

  private doCall(): void {
    const lg = this.v?.legal;
    if (!lg) return;
    this.send(lg.check ? { t: 'check' } : { t: 'call' });
  }

  /** 第一次点展开滑杆，再点确认 */
  private doRaise(): void {
    const lg = this.v?.legal;
    if (!lg?.raise) return;
    if (!this.panelOpen()) {
      this.root.classList.add('open');
      this.setRaise(this.presetTo(this.v!.currentBet === 0 ? 0.5 : 0));
      this.cover();
      return;
    }
    const to = Number(this.slider.dataset.v ?? this.slider.value);
    this.send(to >= lg.maxTo ? { t: 'allin' } : { t: 'raise', to });
  }

  /** 按池子算加到多少：加到 = 最高注 + 比例 × (跟注以后的池子)；0 是最小加注，-1 全下 */
  private presetTo(frac: number): number {
    const v = this.v!;
    const lg = v.legal!;
    if (frac === 0) return lg.minTo;
    if (frac < 0) return lg.maxTo;
    const raw = v.currentBet + Math.round(frac * (v.pot + lg.call));
    const step = Math.max(1, v.sb);
    return clamp(Math.round(raw / step) * step, lg.minTo, lg.maxTo);
  }

  private setRaise(to: number): void {
    const v = this.v;
    const lg = v?.legal;
    if (!v || !lg) return;
    const x = clamp(to, lg.minTo, lg.maxTo);
    this.slider.value = String(x);
    // 滑杆的值会按 step 取整，最大值（全下）可能不在格子上，以 x 为准
    this.slider.dataset.v = String(x);
    const all = x >= lg.maxTo;
    setText(this.amount, all ? `全下 ${chips(x)}` : `${v.currentBet === 0 ? '下注' : '加到'} ${chips(x)}`);
    setText(this.raise, all ? '全下' : '确认');
    toggle(this.raise, 'allin', all);
    for (const b of this.presets) toggle(b, 'sel', this.presetTo(Number(b.dataset.frac)) === x);
  }

  private nudge(dir: number): void {
    const v = this.v;
    if (!v) return;
    this.setRaise(Number(this.slider.dataset.v ?? this.slider.value) + dir * Math.max(v.bb, 1));
  }

  private panelOpen(): boolean {
    return this.root.classList.contains('open');
  }

  private closePanel(): void {
    this.root.classList.remove('open');
    this.cover();
    if (this.v?.legal) setText(this.raise, this.v.currentBet === 0 ? '下注' : '加注');
    toggle(this.raise, 'allin', false);
  }

  private togglePre(p: Exclude<Pre, null>): void {
    this.preset = this.preset === p ? null : p;
    this.presetHand = this.v?.handNo ?? -1;
    toggle(this.preCheck, 'sel', this.preset === 'checkfold');
    toggle(this.preCall, 'sel', this.preset === 'callany');
  }

  private key(e: KeyboardEvent): void {
    if (!this.root.classList.contains('on') || e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (k === 'f') this.send({ t: 'fold' });
    else if (k === 'c') this.doCall();
    else if (k === 'r' || (k === 'enter' && this.panelOpen())) this.doRaise();
    else if (k === 'escape') this.closePanel();
    else return;
    e.preventDefault();
  }
}

function btn(parent: HTMLElement, cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
