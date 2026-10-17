/**
 * 战斗中的 HUD（DOM）：左上回大厅、头像、血条护盾；顶部计时和经验条；右上击杀、铜钱、暂停；右侧法器格；连斩横幅。
 * 用 DOM 而不用画布画：字在手机上清楚、好检查 44 像素的点击区域；数字一秒只改几次，开销很小。
 * 毛笔字（连斩横幅）用子集化的马善政楷书（ASSETS.md）。
 */
import './hud.css';

export interface HudSlot {
  icon: string;
  level: number;
  /** 冷却进度 0–1（1 = 刚好转好） */
  cd: number;
}

export interface HudState {
  hp: number;
  hpMax: number;
  shield: number;
  shieldMax: number;
  level: number;
  xp: number;
  /** 剩余秒数（守夜：离天亮） */
  left: number;
  kills: number;
  coins: number;
  slots: HudSlot[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const fmt = (n: number): string => n.toLocaleString('zh-CN');

export class Hud {
  readonly root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private shFill: HTMLDivElement;
  private lv: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private time: HTMLSpanElement;
  private kills: HTMLSpanElement;
  private coins: HTMLSpanElement;
  private slotEls: { box: HTMLDivElement; cd: HTMLDivElement; lv: HTMLSpanElement }[] = [];
  private combo: HTMLDivElement;
  private comboNum: HTMLSpanElement;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, icons: Record<string, string>, face: string, slots: HudSlot[]) {
    const root = el('div', 'yx-hud', parent);
    this.root = root;
    // 左上：回大厅 + 头像 + 血条护盾
    const tl = el('div', 'yx-tl', root);
    const home = el('button', 'yx-btn yx-home', tl);
    home.type = 'button';
    home.setAttribute('aria-label', '回大厅');
    home.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg><span>大厅</span>';
    const card = el('div', 'yx-card', tl);
    const av = el('div', 'yx-avatar', card);
    const img = el('img', '', av);
    img.src = face;
    img.alt = '';
    this.lv = el('span', 'yx-lv', av, '1');
    const bars = el('div', 'yx-bars', card);
    const hp = el('div', 'yx-bar yx-hp', bars);
    this.hpFill = el('div', 'yx-fill', hp);
    this.hpText = el('span', 'yx-bar-text', hp);
    const sh = el('div', 'yx-bar yx-sh', bars);
    this.shFill = el('div', 'yx-fill', sh);
    // 顶部：经验条 + 计时
    const xp = el('div', 'yx-xp', root);
    this.xpFill = el('div', 'yx-fill', xp);
    const timer = el('div', 'yx-timer', root);
    el('span', 'yx-moon', timer);
    const tcol = el('div', 'yx-tcol', timer);
    el('span', 'yx-tlabel', tcol, '离天亮');
    this.time = el('span', 'yx-time', tcol, '15:00');
    // 右上：击杀、铜钱、暂停
    const tr = el('div', 'yx-tr', root);
    const k = el('div', 'yx-stat', tr);
    el('span', 'yx-ico yx-ico-kill', k);
    this.kills = el('span', '', k, '0');
    const c = el('div', 'yx-stat', tr);
    el('span', 'yx-ico yx-ico-coin', c);
    this.coins = el('span', '', c, '0');
    const pause = el('button', 'yx-btn yx-pause', tr);
    pause.type = 'button';
    pause.setAttribute('aria-label', '暂停');
    pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
    // 右侧：法器格
    const col = el('div', 'yx-slots', root);
    for (const s of slots) {
      const box = el('div', 'yx-slot', col);
      const i = el('img', '', box);
      i.src = icons[s.icon] ?? '';
      i.alt = '';
      const cd = el('div', 'yx-cd', box);
      const lv = el('span', 'yx-slot-lv', box);
      this.slotEls.push({ box, cd, lv });
    }
    // 连斩横幅
    this.combo = el('div', 'yx-combo', root);
    el('span', 'yx-ink yx-ink-a', this.combo);
    el('span', 'yx-ink yx-ink-b', this.combo);
    this.comboNum = el('span', 'yx-combo-num', this.combo, '0');
    el('span', 'yx-combo-word', this.combo, '连斩!');
  }

  update(s: HudState): void {
    this.hpFill.style.width = `${(100 * s.hp) / s.hpMax}%`;
    this.hpText.textContent = `${Math.ceil(s.hp)}/${s.hpMax}`;
    this.shFill.style.width = `${(100 * s.shield) / s.shieldMax}%`;
    this.lv.textContent = String(s.level);
    this.xpFill.style.width = `${Math.round(s.xp * 100)}%`;
    const left = Math.max(0, Math.ceil(s.left));
    this.time.textContent = `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`;
    this.kills.textContent = fmt(s.kills);
    this.coins.textContent = fmt(s.coins);
    s.slots.forEach((slot, i) => {
      const e = this.slotEls[i];
      if (!e) return;
      e.cd.style.setProperty('--cd', `${Math.round((1 - slot.cd) * 360)}deg`);
      e.lv.textContent = slot.level >= 8 ? '满' : String(slot.level);
      e.box.classList.toggle('ready', slot.cd >= 1);
    });
  }

  /** 连斩：数字一变就弹一下；2 秒没杀到就收起 */
  setCombo(n: number): void {
    this.comboNum.textContent = String(n);
    this.combo.classList.add('on');
    this.combo.classList.remove('pop');
    void this.combo.offsetWidth;
    this.combo.classList.add('pop');
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => this.combo.classList.remove('on'), 2000);
  }
}
