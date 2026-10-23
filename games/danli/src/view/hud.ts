/**
 * 对局界面（DESIGN.md 第 4 节）：DOM 叠在画布上。
 * - 顶栏：大厅、谁的回合和第几轮、风（风向袋 + 箭头 + 级数）、全图、静音、两队总血量；
 * - 底栏：体力（10 格）和左右爬按钮、本局武器、力度条（带"上次"刻度）、发射键（按住蓄力，松手发射）；
 * - 出局纸签"掉出画本啦！"、电脑想事的小牌。
 * 特技还没做，先不放。
 * 整层按设计尺寸（横屏 844×390、竖屏 390×844）等比缩放，宽高按屏幕反算，所以四角永远贴着屏幕的四角。
 */
import { STEP_COST } from '../core/rules.ts';
import { CHARGE_MS } from '../net/anim.ts';
import type { Dir, Team } from '../core/types.ts';
import type { WeaponId } from '../core/weapons.ts';
import { el } from './dom.ts';
import { itemIconSvg, PAL, PAL_DIM, PAL_GRAY, pawSvg, type IconId } from './itemIcons.ts';
import type { Size } from './viewport.ts';
import { weaponIcon } from './weaponArt.ts';

/** 蓄满要多久（DESIGN.md 第 4 节：0.3.0 起 3 秒，原来 1.8 秒太快、停不准）：和好友房的停顿（net/anim.ts）同一个数 */
export { CHARGE_MS };
const STEP_MS = 90;

export interface HudHandlers {
  /** 爬一步；回 false 就停（体力不够、爬不过去） */
  step(dir: Dir): boolean;
  fire(power: number): void;
  view(): void;
  /** 点了一个道具按钮（加一个；一回合 1 个的是选上或取消） */
  item(key: ItemKey): void;
  /** 已选那一行：点一项减一个、"清空" */
  unpick(key: ItemKey): void;
  clearItems(): void;
  /** 静音开关 */
  mute(): void;
  /** 蓄力到多少（0..100），松手或取消时是 null（蓄力的音效跟着它） */
  charge?(p: number | null): void;
  /** 我方真人全部出局以后：快进（来回切）、跳到结果 */
  fast(): void;
  skip(): void;
}

/** 静音按钮的图标：喇叭，静音时打个叉 */
export function speakerSvg(muted: boolean): string {
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#f0913a" stroke="#46291a" stroke-width="2" stroke-linejoin="round"/>' +
    (muted
      ? '<path d="M16 9l5 6M21 9l-5 6" stroke="#e2432a" stroke-width="2.4" stroke-linecap="round"/>'
      : '<path d="M16 9.5c1.4 1.4 1.4 3.6 0 5M18.5 7c2.8 2.8 2.8 7.2 0 10" fill="none" stroke="#46291a" stroke-width="2" stroke-linecap="round"/>') +
    '</svg>'
  );
}

/** 道具栏的按钮：连发 +1、+2、三岔，加力 10%、20%、50%，纸飞机、锅盖 */
export type ItemKey = 'p1' | 'p2' | 'fork' | 'b10' | 'b20' | 'b50' | 'plane' | 'lid';

export interface ItemView {
  key: ItemKey;
  label: string;
  title: string;
  cost: number;
  /** 这一回合选了几个（特殊道具是 0 或 1） */
  count: number;
  /** 一回合最多 1 个（三岔、加力 50%、锅盖、纸飞机）：选过以后标"已选"，再点一下是取消 */
  once: boolean;
  /** 还能再加一个（体力够、没到上限、组合合法）；不能就标红边 */
  can: boolean;
  /** 选上了画勾 */
  special?: boolean;
  /** 锅盖这一局还剩几次（纸飞机不限次数，不带） */
  uses?: number;
}

/** 道具按钮用哪个图标（view/itemIcons.ts） */
const ICON: Record<ItemKey, IconId> = { p1: 'burst1', p2: 'burst2', fork: 'fork', b10: 'power10', b20: 'power20', b50: 'power50', plane: 'plane', lid: 'lid' };
/** 选中：左上角的勾 */
const TICK =
  '<svg class="dl-item-tick" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="7" fill="#ffbf1a" stroke="#46291a" stroke-width="1.5"/><path d="M-3.4,0.2l2.4,2.4l4.2,-4.6" fill="none" stroke="#46291a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** 体力不够：右下角的小锁（红边之外再加一个形状，色弱也分得开） */
const LOCK =
  '<svg class="dl-item-lock" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="7" fill="#e2432a" stroke="#46291a" stroke-width="1.5"/><path d="M-2.4,-0.8v-1.8a2.4,2.4 0 0 1 4.8,0v1.8" fill="none" stroke="#fffaf0" stroke-width="1.5"/><rect x="-3.4" y="-1" width="6.8" height="5" rx="1.2" fill="#fffaf0"/></svg>';

const EMBLEM = [
  '<svg viewBox="0 0 20 20" class="dl-emb" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#2f78e0" stroke="#46291a" stroke-width="2"/><circle cx="10" cy="10" r="3.4" fill="#fff"/></svg>',
  '<svg viewBox="0 0 20 20" class="dl-emb" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.8l-5.2 2.8 1-5.8L1.5 7.7l5.9-.8z" fill="#f5ad00" stroke="#46291a" stroke-width="1.8" stroke-linejoin="round"/></svg>',
];

export function emblemSvg(team: Team): string {
  return EMBLEM[team]!;
}

export class Hud {
  readonly root: HTMLElement;
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;
  readonly home: HTMLAnchorElement;
  private turnEl: HTMLElement;
  private clockEl: HTMLElement;
  private windEl: HTMLElement;
  private viewBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private teamEls: { num: HTMLElement; bar: HTMLElement }[] = [];
  private stamNum: HTMLElement;
  private stamSegs: HTMLElement[] = [];
  private powerNum: HTMLElement;
  private powerFill: HTMLElement;
  private powerLast: HTMLElement;
  private fireBtn: HTMLButtonElement;
  private climbBtns: HTMLButtonElement[] = [];
  private weaponEl: HTMLElement;
  private itemBtns = new Map<ItemKey, HTMLButtonElement>();
  /** 道具栏上面那一行：已选的组合 */
  private pickedEl: HTMLElement;
  private pickedSig = '';
  /** 每个按钮上次画的样子（状态、次数），没变就不重画 SVG */
  private itemSig = new Map<ItemKey, string>();
  private thinkEl: HTMLElement;
  private spectEl: HTMLElement;
  private fastBtn: HTMLButtonElement;
  private bannerEl: HTMLElement;
  private enabled = false;
  private charging: { t0: number; raf: number; power: number; id: number } | null = null;
  private stepTimer = 0;
  scale = 1;

  private h: HudHandlers;

  constructor(host: HTMLElement, h: HudHandlers) {
    this.h = h;
    this.root = el('div', 'dl-hud', host);
    this.top = el('div', 'dl-top', this.root);
    this.home = el('a', 'dl-home', this.top);
    this.home.href = '/';
    this.home.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg><span>大厅</span>';
    this.turnEl = el('div', 'dl-turn', this.top);
    // 好友房的回合倒计时（服务器算的 30 秒）；单机不限时，一直收着
    this.clockEl = el('div', 'dl-clock', this.top);
    this.clockEl.hidden = true;
    this.windEl = el('div', 'dl-wind', this.top);
    this.viewBtn = el('button', 'dl-view', this.top);
    this.viewBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M5 16l5-6 4 4 2-2 3 4"/></svg><span>全图</span>';
    this.viewBtn.addEventListener('click', () => this.h.view());
    this.muteBtn = el('button', 'dl-mute', this.top);
    this.muteBtn.addEventListener('click', () => this.h.mute());
    this.setMuted(false);
    const teams = el('div', 'dl-teams', this.top);
    for (const t of [0, 1] as const) {
      const box = el('div', `dl-team t${t}`, teams);
      box.innerHTML = EMBLEM[t]!;
      const num = el('b', 'dl-team-num', box);
      const bar = el('i', 'dl-team-bar', el('span', 'dl-team-track', box));
      this.teamEls.push({ num, bar });
    }

    this.bottom = el('div', 'dl-bottom', this.root);
    const stam = el('div', 'dl-stam', this.bottom);
    const stamHead = el('div', 'dl-stam-head', stam);
    el('span', '', stamHead, '体力');
    this.stamNum = el('b', '', stamHead);
    const segs = el('div', 'dl-stam-bar', stam);
    segs.innerHTML = '<svg viewBox="0 0 24 24" class="dl-paw" aria-hidden="true"><ellipse cx="12" cy="15" rx="5" ry="4.2"/><circle cx="6" cy="9" r="2.3"/><circle cx="10" cy="6" r="2.3"/><circle cx="14" cy="6" r="2.3"/><circle cx="18" cy="9" r="2.3"/></svg>';
    for (let i = 0; i < 10; i++) this.stamSegs.push(el('i', '', segs));
    const climb = el('div', 'dl-climb', stam);
    for (const dir of [-1, 1] as const) {
      const b = el('button', `dl-climb-btn ${dir < 0 ? 'left' : 'right'}`, climb);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir < 0 ? 'M14 5 7 12l7 7v-4h4V9h-4z' : 'M10 5l7 7-7 7v-4H6V9h4z'}"/></svg>`;
      b.setAttribute('aria-label', dir < 0 ? '往左爬' : '往右爬');
      this.holdStep(b, dir);
      this.climbBtns.push(b);
    }
    // 中间一栏：上面力度条（标题里带本局武器），下面道具栏（常用：发射方式、加力；特殊：纸飞机、锅盖）
    const mid = el('div', 'dl-mid', this.bottom);
    const power = el('div', 'dl-power', mid);
    const ph = el('div', 'dl-power-head', power);
    el('span', '', ph, '力度');
    this.powerNum = el('b', '', ph);
    this.weaponEl = el('span', 'dl-weapon', ph);
    const track = el('div', 'dl-power-bar', power);
    for (let i = 1; i < 10; i++) el('i', 'dl-tick', track).style.left = `${i * 10}%`;
    this.powerFill = el('div', 'dl-power-fill', track);
    this.powerLast = el('div', 'dl-power-last', track);
    el('span', '', this.powerLast, '上次');
    // 道具栏：发射方式、加力、特殊三组，组之间用间距和细虚线隔开；按钮上只有图标（不放汉字），名字放在 aria-label 和悬停提示里
    this.pickedEl = el('div', 'dl-picked', mid);
    const items = el('div', 'dl-items', mid);
    for (const keys of [
      ['p1', 'p2', 'fork'],
      ['b10', 'b20', 'b50'],
      ['plane', 'lid'],
    ] as const) {
      const g = el('div', 'dl-items-group', items);
      for (const key of keys) {
        const b = el('button', 'dl-item', g);
        b.dataset.item = key;
        b.addEventListener('click', () => this.enabled && this.h.item(key));
        this.itemBtns.set(key, b);
      }
    }
    this.fireBtn = el('button', 'dl-fire', this.bottom);
    this.fireBtn.innerHTML = '<b>发射</b><small>按住蓄力</small>';
    this.bindFire();

    this.thinkEl = el('div', 'dl-think', this.root);
    this.thinkEl.hidden = true;
    // 我方真人全部出局以后才出现：快进（动画 ×4）、跳到结果（直接算完）
    this.spectEl = el('div', 'dl-spect', this.root);
    this.spectEl.hidden = true;
    el('span', '', this.spectEl, '你出局了，看队友打');
    this.fastBtn = el('button', 'dl-btn soft dl-fast-btn', this.spectEl, '快进 ×4');
    this.fastBtn.addEventListener('click', () => this.h.fast());
    el('button', 'dl-btn go dl-skip-btn', this.spectEl, '跳到结果').addEventListener('click', () => this.h.skip());
    this.bannerEl = el('div', 'dl-banner', this.root);
    this.bannerEl.hidden = true;
    this.setPower(0, null);
  }

  /** 屏幕尺寸变了：按设计尺寸算缩放，宽高反算到正好铺满 */
  layout(s: Size): void {
    const k = s.port ? Math.min(1.35, Math.max(0.78, s.w / 390)) : Math.min(1.4, Math.max(0.78, Math.min(s.w / 844, s.h / 390)));
    this.scale = k;
    this.root.dataset.orient = s.port ? 'port' : 'land';
    this.root.style.width = `${s.w / k}px`;
    this.root.style.height = `${s.h / k}px`;
    this.root.style.transform = `scale(${k})`;
  }

  /** 顶栏、底栏在屏幕上挡住多高（像素） */
  insets(): { top: number; bottom: number } {
    const k = this.scale;
    return { top: (this.top.offsetTop + this.top.offsetHeight) * k, bottom: (this.root.offsetHeight - this.bottom.offsetTop) * k };
  }

  /** 打完了：顶栏写"打完了"和打到第几轮 */
  setOver(round: number): void {
    this.turnEl.innerHTML = `<b>打完了</b><span class="dl-round">${round} 轮</span>`;
    this.turnEl.classList.remove('mine');
  }

  /** 谁的回合、第几轮（所有还活着的角色各出手一次算一轮） */
  setTurn(name: string, team: Team, round: number, maxRounds: number, mine: boolean): void {
    this.turnEl.innerHTML = `${EMBLEM[team]}<b>${escapeHtml(name)}的回合</b><span class="dl-round" title="所有还活着的角色各出手一次算一轮">第 ${round} 轮 / ${maxRounds}</span>`;
    this.turnEl.classList.toggle('mine', mine);
  }

  /** 好友房的回合倒计时：还剩几秒（null 收起）；10 秒以内变红 */
  setClock(sec: number | null, mine = false): void {
    this.clockEl.hidden = sec === null;
    if (sec === null) return;
    const t = `${Math.max(0, Math.ceil(sec))}`;
    if (this.clockEl.textContent !== t) this.clockEl.textContent = t;
    this.clockEl.classList.toggle('hot', sec <= 10);
    this.clockEl.classList.toggle('mine', mine);
    this.clockEl.title = mine ? '这一手还剩几秒，到了算弃权' : '这一手还剩几秒';
  }

  /** 风：-5..5。风向袋朝风吹去的方向，箭头 + 级数 + 5 片叶子（几级亮几片） */
  setWind(w: number): void {
    const a = Math.abs(w);
    const dir = w < 0 ? -1 : 1;
    const leaves = Array.from({ length: 5 }, (_, i) => `<i class="${i < a ? 'on' : ''}"></i>`).join('');
    this.windEl.innerHTML =
      `<span>风</span><svg viewBox="0 0 40 20" class="dl-sock${dir < 0 ? ' flip' : ''}${a === 0 ? ' calm' : ''}" aria-hidden="true">` +
      '<path d="M3 2v17" stroke="#46291a" stroke-width="2.4" stroke-linecap="round"/><path d="M4 4h30l-4 6 4 6H4z" fill="#fffaf0" stroke="#46291a" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M4 4h10v12H4zM22 4h6l-1 6 1 6h-6z" fill="#e2432a"/></svg>' +
      `<b>${a === 0 ? '0' : `${dir < 0 ? '←' : '→'}${a}`}</b><span class="dl-leaves">${leaves}</span>`;
    this.windEl.title = a === 0 ? '没有风' : `${dir < 0 ? '往左' : '往右'}吹 ${a} 级`;
  }

  setTeams(hp: [number, number], max: [number, number], out: [boolean, boolean]): void {
    for (const t of [0, 1] as const) {
      this.teamEls[t]!.num.textContent = String(hp[t]);
      this.teamEls[t]!.bar.style.width = `${max[t] ? (100 * hp[t]) / max[t] : 0}%`;
      this.teamEls[t]!.num.parentElement!.classList.toggle('dead', out[t]);
    }
  }

  /**
   * 体力：n 是这回合还剩的，reserved 是选了的道具要花的（发射时才扣）。10 格里绿的是"选了这些以后还剩多少能爬"，黄色斜线的是预扣给道具的。
   */
  setStamina(n: number, show: boolean, reserved = 0): void {
    const free = Math.max(0, n - reserved);
    // 选了道具时写"剩多少 / 这回合一共多少"，一眼看出预扣了多少（只写 100 容易看成还没花）
    this.stamNum.textContent = reserved ? `剩 ${free} / ${n} · 能爬 ${Math.floor(free / STEP_COST)} 步` : String(n);
    this.stamNum.title = reserved ? `道具预扣 ${reserved}（黄色斜线那几格）` : '';
    const on = Math.ceil(free / 10);
    const held = Math.ceil(n / 10);
    this.stamSegs.forEach((s, i) => {
      s.classList.toggle('on', i < on);
      s.classList.toggle('held', i >= on && i < held);
    });
    this.stamNum.parentElement!.parentElement!.classList.toggle('off', !show);
  }

  /** 本局武器（当前出手的人的）：图标、名字、能用的角度 */
  setWeapon(id: WeaponId, name: string, min: number, max: number): void {
    this.weaponEl.innerHTML = `<b>${escapeHtml(name)}</b><small>${min}–${max}°</small>`;
    this.weaponEl.prepend(weaponIcon(id, 22));
  }

  setMuted(muted: boolean): void {
    this.muteBtn.innerHTML = speakerSvg(muted);
    this.muteBtn.classList.toggle('on', muted);
    this.muteBtn.setAttribute('aria-label', muted ? '打开声音' : '静音');
    this.muteBtn.title = muted ? '打开声音' : '静音';
  }

  /**
   * 道具栏（美术 2026-10-21 的样张）：图标按钮，下沿挂一张"爪印 + 体力数"的小签，特殊道具右上角圆章写剩几次。四种状态：
   * 体力够绿边；体力不够红边、右下角小锁、图标压暗；选中绿边外加金框、左上角打勾、抬起一点；用完了灰色虚线框、次数章写 0。
   */
  setItems(views: readonly ItemView[]): void {
    for (const v of views) {
      const b = this.itemBtns.get(v.key)!;
      const empty = v.uses !== undefined && v.uses <= 0 && v.count === 0;
      const state = empty ? 'empty' : v.count > 0 ? 'selected' : v.can ? 'ok' : 'short';
      // 选了几个还能再加吗：不能就在选中的样子外面描红边（买不起第二个）；一回合 1 个的不标
      const more = v.count > 0 && !v.once && !v.can ? 'no' : 'yes';
      const sig = `${state}|${more}|${v.count}|${v.uses ?? ''}`;
      b.dataset.state = state;
      b.dataset.more = more;
      b.dataset.count = String(v.count);
      const tip =
        `${v.label}：${v.title}；体力 ${v.cost}${v.uses !== undefined ? `，这一局还剩 ${v.uses} 次` : ''}` +
        `${v.count ? (v.once ? '（已选，再点取消）' : `（选了 ${v.count} 个）`) : ''}${state === 'short' ? '（体力不够）' : state === 'empty' ? '（用完了）' : ''}`;
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.setAttribute('aria-pressed', String(v.count > 0));
      if (this.itemSig.get(v.key) === sig) continue;
      this.itemSig.set(v.key, sig);
      const pal = state === 'short' ? PAL_DIM : state === 'empty' ? PAL_GRAY : PAL;
      const pawFill = state === 'short' ? '#e2432a' : state === 'empty' ? '#b4a896' : '#3fa34d';
      const mark = v.count === 0 ? '' : v.once ? (v.special ? TICK : '<span class="dl-item-n once">已选</span>') : `<span class="dl-item-n">×${v.count}</span>`;
      b.innerHTML =
        `<span class="dl-item-face">${itemIconSvg(ICON[v.key], pal)}</span>` +
        `<span class="dl-item-tag"><svg viewBox="-6 -7 12 12" aria-hidden="true">${pawSvg(PAL, 0, 0, 1, pawFill)}</svg><b>${v.cost}</b></span>` +
        (v.uses !== undefined ? `<span class="dl-item-uses">${v.uses <= 0 ? '0' : `×${v.uses}`}</span>` : '') +
        mark +
        (state === 'short' ? LOCK : '');
    }
  }

  /** 道具栏上面那一行：已选的组合，点一项减一个，"清空"；没选时写一句提示 */
  setPicked(list: readonly { key: ItemKey; text: string }[]): void {
    const sig = list.map((x) => `${x.key}:${x.text}`).join('|');
    if (sig === this.pickedSig) return;
    this.pickedSig = sig;
    this.pickedEl.replaceChildren();
    if (!list.length) {
      el('span', 'dl-picked-hint', this.pickedEl, '点道具加上去，能叠，体力够就行');
      return;
    }
    for (const x of list) {
      const c = el('button', 'dl-picked-chip', this.pickedEl, x.text);
      c.dataset.item = x.key;
      c.title = '点一下减一个';
      c.addEventListener('click', () => this.enabled && this.h.unpick(x.key));
    }
    const clr = el('button', 'dl-picked-clear', this.pickedEl, '清空');
    clr.addEventListener('click', () => this.enabled && this.h.clearItems());
  }

  /** 力度条：现在的力度（0..100）和上次的刻度 */
  setPower(p: number, last: number | null): void {
    this.powerNum.textContent = String(Math.round(p));
    this.powerFill.style.width = `${p}%`;
    this.powerLast.hidden = last === null;
    if (last !== null) this.powerLast.style.left = `${last}%`;
  }

  /** 轮到真人：底栏能按；电脑和动画时收起来（按钮点不了） */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.bottom.classList.toggle('off', !on);
    this.fireBtn.disabled = !on;
    for (const b of this.climbBtns) b.disabled = !on;
    for (const b of this.itemBtns.values()) b.disabled = !on;
    for (const b of this.pickedEl.querySelectorAll('button')) b.disabled = !on;
    if (!on) this.cancelCharge();
  }

  setView(overview: boolean): void {
    this.viewBtn.classList.toggle('on', overview);
    this.viewBtn.querySelector('span')!.textContent = overview ? '跟随' : '全图';
  }

  /** 观战的按钮：null 收起；fast 是现在开没开快进 */
  setSpectate(v: { fast: boolean } | null): void {
    this.spectEl.hidden = !v;
    if (!v) return;
    this.fastBtn.classList.toggle('on', v.fast);
    this.fastBtn.textContent = v.fast ? '快进中 · 点了恢复' : '快进 ×4';
  }

  think(text: string | null): void {
    this.thinkEl.hidden = !text;
    if (text) this.thinkEl.textContent = text;
  }

  /** 出局纸签：大字一行，下面一行小字 */
  banner(title: string | null, sub = ''): void {
    this.bannerEl.hidden = !title;
    if (title) this.bannerEl.innerHTML = `<b>${escapeHtml(title)}</b><small>${escapeHtml(sub)}</small>`;
  }

  // ---------- 按住爬、按住蓄力 ----------

  private holdStep(b: HTMLButtonElement, dir: Dir): void {
    const stop = (): void => {
      window.clearInterval(this.stepTimer);
      this.stepTimer = 0;
      b.classList.remove('down');
    };
    b.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      stop();
      b.classList.add('down');
      if (!this.h.step(dir)) return stop();
      this.stepTimer = window.setInterval(() => {
        if (!this.enabled || !this.h.step(dir)) stop();
      }, STEP_MS);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 冒烟和键盘用：开始蓄力、松手发射 */
  startCharge(id = -1): void {
    if (!this.enabled || this.charging) return;
    const c = { t0: performance.now(), raf: 0, power: 0, id };
    this.charging = c;
    this.fireBtn.classList.add('down');
    const tick = (): void => {
      if (this.charging !== c) return;
      c.power = Math.min(100, ((performance.now() - c.t0) / CHARGE_MS) * 100);
      this.setPower(c.power, this.lastPower);
      this.h.charge?.(c.power);
      c.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  releaseCharge(id = -1): void {
    const c = this.charging;
    if (!c || c.id !== id) return;
    // 按松手那一刻算，不按最后一帧（手机卡的时候也准）
    c.power = Math.min(100, ((performance.now() - c.t0) / CHARGE_MS) * 100);
    this.cancelCharge();
    const p = Math.max(1, Math.round(c.power));
    this.setPower(p, this.lastPower);
    this.h.fire(p);
  }

  private cancelCharge(): void {
    if (!this.charging) return;
    cancelAnimationFrame(this.charging.raf);
    this.charging = null;
    this.fireBtn.classList.remove('down');
    this.h.charge?.(null);
  }

  lastPower: number | null = null;

  private bindFire(): void {
    const b = this.fireBtn;
    b.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      this.startCharge(e.pointerId);
    });
    b.addEventListener('pointerup', (e) => this.releaseCharge(e.pointerId));
    b.addEventListener('pointercancel', () => this.cancelCharge());
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

