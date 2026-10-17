/**
 * 升级三选一（DESIGN.md 2.1，手感清单第 5 条）：卡片弹入，点、按 1/2/3、方向键加回车都能选，1 秒内能选完。
 * 卡片排在屏幕中下部、左右手拇指都够得着（手感清单第 10 条）。
 */
import { PASSIVES, WEAPONS, MAX_WEAPON_LEVEL, type PassiveId, type WeaponId } from '../../content/weapons.ts';
import type { Choice, World } from '../../core/index.ts';
import './cards.css';

export interface CardView {
  icon: string;
  name: string;
  /** "新" 或 "Lv 3 → 4" */
  tag: string;
  text: string;
  /** 进化提示："进化还差：朱砂" / "满级 + 朱砂 → 斩妖剑" */
  hint: string | null;
}

export function describe(w: World, c: Choice): CardView {
  if (c.kind === 'weapon') {
    const def = WEAPONS[c.id as WeaponId];
    const o = w.weapons.find((x) => x.id === def.id);
    const evo = def.evolve;
    const hint = evo ? `满级 + ${PASSIVES[evo.with].name} → ${evo.name}${(w.passives[evo.with] ?? 0) > 0 ? '（已有）' : ''}` : null;
    if (!o) return { icon: def.icon, name: def.name, tag: '新', text: def.desc, hint };
    return { icon: def.icon, name: def.name, tag: o.level + 1 >= MAX_WEAPON_LEVEL ? `Lv ${o.level} → 满` : `Lv ${o.level} → ${o.level + 1}`, text: def.ups[o.level - 1]?.text ?? '', hint };
  }
  if (c.kind === 'passive') {
    const def = PASSIVES[c.id as PassiveId];
    const lv = w.passives[def.id] ?? 0;
    const pairs = Object.values(WEAPONS).filter((x) => x.evolve?.with === def.id && w.weapons.some((o) => o.id === x.id));
    return {
      icon: def.icon,
      name: def.name,
      tag: lv === 0 ? '新' : `Lv ${lv} → ${lv + 1}`,
      text: def.text,
      hint: pairs.length ? `${pairs.map((p) => p.name).join('、')}进化要它` : null,
    };
  }
  return { icon: 'coin', name: '铜钱一袋', tag: '', text: '铜钱 +25，回 20 点血', hint: null };
}

export class Cards {
  private readonly root: HTMLDivElement;
  private onPick: ((i: number) => void) | null = null;
  private focus = 0;
  private items: HTMLButtonElement[] = [];
  private openedAt = 0;
  private readonly icons: (key: string) => string;
  /** 弹出时通知（引导记一笔：带说明的卡片看过了） */
  onShow: (firstTime: boolean) => void = () => undefined;

  constructor(parent: HTMLElement, icons: (key: string) => string) {
    this.icons = icons;
    this.root = document.createElement('div');
    this.root.className = 'yx-picks';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.onPick) return;
      const n = this.items.length;
      if (e.key >= '1' && e.key <= String(n)) this.pick(Number(e.key) - 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'a' || e.key === 'w') this.setFocus((this.focus + n - 1) % n);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'd' || e.key === 's') this.setFocus((this.focus + 1) % n);
      else if (e.key === 'Enter' || e.key === ' ') this.pick(this.focus);
      else return;
      e.preventDefault();
    });
  }

  get open(): boolean {
    return this.onPick !== null;
  }

  show(level: number, cards: CardView[], firstTime: boolean, onPick: (i: number) => void): void {
    this.onPick = onPick;
    this.openedAt = performance.now();
    this.root.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'yx-picks-head';
    head.innerHTML = `<span class="yx-picks-lv">升到 ${level} 级</span>${firstTime ? '<span class="yx-picks-tip">挑一个：新法器、法器升级，或者被动</span>' : ''}`;
    this.root.appendChild(head);
    const row = document.createElement('div');
    row.className = 'yx-picks-row';
    this.items = cards.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'yx-pick';
      b.style.animationDelay = `${i * 60}ms`;
      b.innerHTML =
        `<span class="yx-pick-key">${i + 1}</span>` +
        `<img alt="" src="${this.icons(c.icon)}">` +
        `<span class="yx-pick-name">${c.name}${c.tag ? `<em${c.tag === '新' ? ' class="new"' : ''}>${c.tag}</em>` : ''}</span>` +
        `<span class="yx-pick-text">${c.text}</span>` +
        (c.hint ? `<span class="yx-pick-hint">${c.hint}</span>` : '');
      b.addEventListener('click', () => this.pick(i));
      row.appendChild(b);
      return b;
    });
    this.root.appendChild(row);
    this.root.style.display = '';
    this.setFocus(0);
    this.onShow(firstTime);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.items.forEach((b, k) => b.classList.toggle('focus', k === i));
  }

  private pick(i: number): void {
    // 卡片刚弹出的 150 ms 里不收，免得正在连点屏幕走路的手误选
    if (!this.onPick || performance.now() - this.openedAt < 150) return;
    const cb = this.onPick;
    this.onPick = null;
    this.root.style.display = 'none';
    cb(i);
  }
}
