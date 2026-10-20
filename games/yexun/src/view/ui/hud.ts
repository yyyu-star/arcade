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
  /** 被动：只显示图标和等级，不点 */
  passives: { icon: string; level: number }[];
  /** 夜探：顶上换成天亮倒计时（label 是"离天亮"或"天亮"，level 1 = 14:00 起醒目，2 = 最后 30 秒变红），右上多一个背包件数 */
  raid?: { label: string; level: 0 | 1 | 2; bag: number; value: number };
}

/** 屏幕边上的撤离箭头（guide-hud.ts 的 EdgeArrow 里画面要用的几个字段） */
export interface HudArrow {
  x: number;
  y: number;
  dx: number;
  dy: number;
  label: string;
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
  readonly homeBtn: HTMLButtonElement;
  readonly pauseBtn: HTMLButtonElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private shFill: HTMLDivElement;
  private shBar: HTMLDivElement;
  private lv: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private time: HTMLSpanElement;
  private tlabel: HTMLSpanElement;
  private timer: HTMLDivElement;
  /** 夜探的背包按钮（可点，点开背包面板，见 raidhud.ts） */
  readonly bagBox: HTMLButtonElement;
  private bag: HTMLSpanElement;
  private arrow: HTMLDivElement;
  private arrowIcon: HTMLElement;
  private arrowText: HTMLSpanElement;
  /** 宝妖的箭头（橙色，和撤离箭头同一套摆法） */
  private gbArrow: HTMLDivElement;
  private gbIcon: HTMLElement;
  private gbText: HTMLSpanElement;
  /** 夜市的箭头（青绿色） */
  private mkArrow: HTMLDivElement;
  private mkIcon: HTMLElement;
  private mkText: HTMLSpanElement;
  /** 夜市买的临时增益小标签（顶栏计时下面） */
  private buffTag: HTMLDivElement;
  private raidOn = false;
  private kills: HTMLSpanElement;
  private coins: HTMLSpanElement;
  private slotEls: { box: HTMLDivElement; cd: HTMLDivElement; lv: HTMLSpanElement }[] = [];
  private slotsCol: HTMLDivElement;
  private passCol: HTMLDivElement;
  /** 法器格、被动格的组成（图标 + 顺序）变了才重建 DOM，平时只改冷却和等级 */
  private slotSig = '';
  private passSig = '';
  readonly icons: (key: string) => string;
  private combo: HTMLDivElement;
  private comboNum: HTMLSpanElement;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  private faceImg: HTMLImageElement | null = null;

  /** 换头像（开局按出战的角色换） */
  setFace(src: string): void {
    if (this.faceImg) this.faceImg.src = src;
  }

  constructor(parent: HTMLElement, icons: (key: string) => string, face: string) {
    this.icons = icons;
    const root = el('div', 'yx-hud', parent);
    this.root = root;
    // 左上：回大厅 + 头像 + 血条护盾
    // 顶栏三块（左上、计时、右上）放进一个容器：电脑上它不生成盒子（display: contents，三块各自贴边或居中），
    // 手机竖屏和大屏上它是一行 flex / 网格，三块自然排开、不会叠
    const top = el('div', 'yx-top', root);
    const tl = el('div', 'yx-tl', top);
    const home = el('button', 'yx-btn yx-home', tl);
    this.homeBtn = home;
    home.type = 'button';
    home.setAttribute('aria-label', '回大厅');
    home.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg><span>大厅</span>';
    const card = el('div', 'yx-card', tl);
    const av = el('div', 'yx-avatar', card);
    const img = el('img', '', av);
    this.faceImg = img;
    img.src = face;
    img.alt = '';
    this.lv = el('span', 'yx-lv', av, '1');
    const bars = el('div', 'yx-bars', card);
    const hp = el('div', 'yx-bar yx-hp', bars);
    this.hpFill = el('div', 'yx-fill', hp);
    this.hpText = el('span', 'yx-bar-text', hp);
    const sh = el('div', 'yx-bar yx-sh', bars);
    this.shFill = el('div', 'yx-fill', sh);
    this.shBar = sh;
    // 顶部：经验条 + 计时
    const xp = el('div', 'yx-xp', root);
    this.xpFill = el('div', 'yx-fill', xp);
    const timer = el('div', 'yx-timer', top);
    this.timer = timer;
    el('span', 'yx-moon', timer);
    const tcol = el('div', 'yx-tcol', timer);
    this.tlabel = el('span', 'yx-tlabel', tcol, '离天亮');
    this.time = el('span', 'yx-time', tcol, '15:00');
    // 右上：击杀、铜钱、暂停
    const tr = el('div', 'yx-tr', top);
    // 击杀和铜钱合成一个胶囊，两个数字并排
    const caps = el('div', 'yx-stat yx-caps', tr);
    const k = el('span', 'yx-cap', caps);
    el('span', 'yx-ico yx-ico-kill', k);
    this.kills = el('span', '', k, '0');
    const c = el('span', 'yx-cap', caps);
    el('span', 'yx-ico yx-ico-coin', c);
    this.coins = el('span', '', c, '0');
    // 胶囊底下一行小字说这些铜钱去哪（所有者 10-20：娱乐、实盘一样，局内夜市花，剩下的局后存入账户）
    el('span', 'yx-cnote', caps, '夜市可花，剩下局后存入');
    // 夜探的背包件数（守夜不显示）
    this.bagBox = el('button', 'yx-stat yx-bag', tr);
    this.bagBox.type = 'button';
    this.bagBox.setAttribute('aria-label', '背包');
    el('span', 'yx-ico yx-ico-bag', this.bagBox);
    this.bag = el('span', '', this.bagBox, '0');
    this.bagBox.style.display = 'none';
    const pause = el('button', 'yx-btn yx-pause', tr);
    this.pauseBtn = pause;
    pause.type = 'button';
    pause.setAttribute('aria-label', '暂停');
    pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
    // 右侧：法器格（一列，底下垫半透明的板子，雪地上也看得清），被动在它左边一列小格
    const side = el('div', 'yx-side', root);
    this.passCol = el('div', 'yx-passives', side);
    this.slotsCol = el('div', 'yx-slots', side);
    this.passCol.style.display = 'none';
    this.slotsCol.style.display = 'none';
    // 撤离指引：门在屏幕外时，贴着屏幕边的一个箭头 + "东门 · 12 秒"
    this.arrow = el('div', 'yx-xa', root);
    this.arrowIcon = el('i', 'yx-xa-ico', this.arrow);
    this.arrowIcon.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 20h24M20 8l12 12-12 12" fill="none" stroke="#17131c" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h24M20 8l12 12-12 12" fill="none" stroke="#ffd23a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.arrowText = el('span', 'yx-xa-text', this.arrow);
    this.arrow.style.display = 'none';
    this.gbArrow = el('div', 'yx-xa gb', root);
    this.gbIcon = el('i', 'yx-xa-ico', this.gbArrow);
    this.gbIcon.innerHTML = this.arrowIcon.innerHTML.replace(/#ffd23a/g, '#ff8a2a');
    this.gbText = el('span', 'yx-xa-text', this.gbArrow);
    this.gbArrow.style.display = 'none';
    this.mkArrow = el('div', 'yx-xa mk', root);
    this.mkIcon = el('i', 'yx-xa-ico', this.mkArrow);
    this.mkIcon.innerHTML = this.arrowIcon.innerHTML.replace(/#ffd23a/g, '#5fe0b0');
    this.mkText = el('span', 'yx-xa-text', this.mkArrow);
    this.mkArrow.style.display = 'none';
    this.buffTag = el('div', 'yx-buffs', root);
    this.buffTag.style.display = 'none';
    // 连斩横幅
    this.combo = el('div', 'yx-combo', root);
    el('span', 'yx-ink yx-ink-a', this.combo);
    el('span', 'yx-ink yx-ink-b', this.combo);
    this.comboNum = el('span', 'yx-combo-num', this.combo, '0');
    el('span', 'yx-combo-word', this.combo, '连斩!');
  }

  update(s: HudState): void {
    this.hpFill.style.width = `${(100 * s.hp) / s.hpMax}%`;
    // 血上限按百分比放大会带浮点尾巴（100 × 1.15 = 114.99999999999999），显示时取整；当前血不超过显示的上限
    const max = Math.round(s.hpMax);
    this.hpText.textContent = `${Math.min(Math.ceil(s.hp), max)}/${max}`;
    // 没有护盾的时候整条不显示（空着的深色条像是坏了）
    this.shBar.style.visibility = s.shieldMax > 0 ? '' : 'hidden';
    if (s.shieldMax > 0) this.shFill.style.width = `${(100 * s.shield) / s.shieldMax}%`;
    this.lv.textContent = String(s.level);
    this.xpFill.style.width = `${Math.round(s.xp * 100)}%`;
    const left = Math.max(0, Math.ceil(s.left));
    this.time.textContent = `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`;
    if (s.raid) {
      this.tlabel.textContent = s.raid.label;
      this.timer.classList.toggle('warn', s.raid.level === 1);
      this.timer.classList.toggle('red', s.raid.level === 2);
      this.bag.textContent = `${s.raid.bag} 件 · ${s.raid.value}`;
    }
    if (!!s.raid !== this.raidOn) {
      this.raidOn = !!s.raid;
      this.bagBox.style.display = this.raidOn ? '' : 'none';
      if (!this.raidOn) {
        this.tlabel.textContent = '离天亮';
        this.timer.classList.remove('warn', 'red');
        this.setArrow(null);
        this.setGoblinArrow(null);
      }
    }
    this.kills.textContent = fmt(s.kills);
    this.coins.textContent = fmt(s.coins);
    const sig = s.slots.map((x) => x.icon).join();
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      this.slotsCol.innerHTML = '';
      this.slotEls = s.slots.map((x) => {
        const box = el('div', 'yx-slot', this.slotsCol);
        const i = el('img', '', box);
        i.src = this.icons(x.icon);
        i.alt = '';
        return { box, cd: el('div', 'yx-cd', box), lv: el('span', 'yx-slot-lv', box) };
      });
      this.slotsCol.style.display = s.slots.length ? '' : 'none';
    }
    const psig = s.passives.map((x) => `${x.icon}${x.level}`).join();
    if (psig !== this.passSig) {
      this.passSig = psig;
      this.passCol.innerHTML = '';
      for (const x of s.passives) {
        const box = el('div', 'yx-pass', this.passCol);
        const i = el('img', '', box);
        i.src = this.icons(x.icon);
        i.alt = '';
        el('span', 'yx-slot-lv', box, String(x.level));
      }
      this.passCol.style.display = s.passives.length ? '' : 'none';
    }
    s.slots.forEach((slot, i) => {
      const e = this.slotEls[i];
      if (!e) return;
      e.cd.style.setProperty('--cd', `${Math.round((1 - slot.cd) * 360)}deg`);
      e.lv.textContent = slot.level > 8 ? '进' : slot.level === 8 ? '满' : String(slot.level);
      e.box.classList.toggle('ready', slot.cd >= 1);
    });
  }

  /** 撤离箭头：null 收起；x、y 是屏幕边上的位置（CSS 像素），dx、dy 是朝向的单位向量 */
  setArrow(a: HudArrow | null): void {
    this.place(this.arrow, this.arrowIcon, this.arrowText, a);
  }

  /** 宝妖的箭头：同 setArrow，橙色 */
  setGoblinArrow(a: HudArrow | null): void {
    this.place(this.gbArrow, this.gbIcon, this.gbText, a);
  }

  /** 夜市的箭头：同 setArrow，青绿色 */
  setMarketArrow(a: HudArrow | null): void {
    this.place(this.mkArrow, this.mkIcon, this.mkText, a);
  }

  /** 临时增益小标签：null 收起；文字没变不碰 DOM */
  setBuffs(text: string | null): void {
    if (!text) {
      if (this.buffTag.style.display !== 'none') this.buffTag.style.display = 'none';
      return;
    }
    this.buffTag.style.display = '';
    if (this.buffTag.textContent !== text) this.buffTag.textContent = text;
  }

  private place(box: HTMLDivElement, icon: HTMLElement, text: HTMLSpanElement, a: HudArrow | null): void {
    if (!a) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    box.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
    icon.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(a.dy, a.dx)}rad)`;
    if (text.textContent !== a.label) text.textContent = a.label;
    // 文字放在箭头靠屏幕中心的那一侧，不被边缘切掉
    text.style.transform = `translate(${a.dx > 0.3 ? '-100%' : a.dx < -0.3 ? '0%' : '-50%'}, ${a.dy > 0.3 ? '-170%' : a.dy < -0.3 ? '70%' : '-50%'})`;
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
