/**
 * 升级三选一（DESIGN.md 2.1，手感清单第 5 条）：卡片弹入，点、按 1/2/3、方向键加回车都能选，1 秒内能选完。
 * 卡片排在屏幕中下部、左右手拇指都够得着（手感清单第 10 条）。
 */
import { ELEMENT_SET, PASSIVES, TYPE_SETS, WEAPONS, MAX_WEAPON_LEVEL, type PassiveId, type WeaponId } from '../../content/weapons.ts';
import { Pick, type Choice, type World } from '../../core/index.ts';
import { MONSTER_INFO } from './codex.ts';
import { counterLine } from './counters.ts';
import { mergeHint, type MergeHint } from './mergeHint.ts';
import './cards.css';

export interface CardView {
  icon: string;
  name: string;
  /** "新" 或 "Lv 3 → 4" */
  tag: string;
  text: string;
  /** 进化提示："进化还差：朱砂" / "满级 + 朱砂 → 斩妖剑" */
  hint: string | null;
  /** 法器的五行·类型 */
  tags?: string;
  /** 克制小字（克 X · 怕 Y，从怪的 vs 表派生） */
  counter?: string;
  /** 拿了以后凑成的套装："剑 2 件：暴击 +8%" */
  set?: string;
  /** 拿了离合成 / 双修只差一步或正好凑成 */
  merge?: MergeHint;
}

export function describe(w: World, c: Choice): CardView {
  const v = describeBase(w, c);
  const merge = mergeHint(w, c);
  return merge ? { ...v, merge } : v;
}

function describeBase(w: World, c: Choice): CardView {
  if (c.kind === 'weapon') {
    const def = WEAPONS[c.id as WeaponId];
    const o = w.weapons.find((x) => x.id === def.id);
    const evo = def.evolve;
    const hint = evo ? `满级 + ${PASSIVES[evo.with].name} → ${evo.name}${(w.passives[evo.with] ?? 0) > 0 ? '（已有）' : ''}` : null;
    const tags = `${def.el}·${def.type}`;
    const counter = counterLine(def.type, def.el, (k) => MONSTER_INFO[k].name) ?? undefined;
    if (!o) {
      // 新法器：拿了以后能凑成哪个套装
      const sameType = w.weapons.filter((x) => WEAPONS[x.id].type === def.type).length + 1;
      const sameEl = w.weapons.filter((x) => WEAPONS[x.id].el === def.el).length + 1;
      let set: string | undefined;
      if (sameType === 2 || sameType === 3) set = `${def.type} ${sameType} 件：${TYPE_SETS[def.type][sameType - 2]}`;
      else if (sameEl === 2 || sameEl === 3) set = `${def.el} ${sameEl} 件：${ELEMENT_SET[sameEl - 2]}`;
      return { icon: def.icon, name: def.name, tag: '新', text: def.desc, hint, tags, set, counter };
    }
    return { icon: def.icon, name: def.name, tag: o.level + 1 >= MAX_WEAPON_LEVEL ? `Lv ${o.level} → 满` : `Lv ${o.level} → ${o.level + 1}`, text: def.ups[o.level - 1]?.text ?? '', hint, tags, counter };
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
  /** 封禁模式：下一张点的卡被封掉 */
  private banning = false;
  private counts = { rerolls: 0, bans: 0 };
  private bar: HTMLDivElement | null = null;

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
      else if (e.key === 'r' || e.key === 'R') this.action(Pick.Reroll);
      else if (e.key === 'b' || e.key === 'B') this.toggleBan();
      else if (e.key === 'x' || e.key === 'X') this.action(Pick.Skip);
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

  /** onPick 收到的是 step 的 choice：0–2 选第几张，或 Pick.Reroll / Pick.Ban + i / Pick.Skip */
  show(level: number, cards: CardView[], firstTime: boolean, counts: { rerolls: number; bans: number; live?: boolean }, onPick: (i: number) => void): void {
    this.onPick = onPick;
    this.counts = counts;
    this.banning = false;
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
        (c.tags ? `<span class="yx-pick-tags">${c.tags}</span>` : '') +
        `<span class="yx-pick-text">${c.text}</span>` +
        (c.counter ? `<span class="yx-pick-counter">${c.counter}</span>` : '') +
        (c.set ? `<span class="yx-pick-set">${c.set}</span>` : '') +
        (c.merge ? `<span class="yx-pick-merge${c.merge.ready ? ' ready' : ''}" style="--mc:${c.merge.color}"><b>${c.merge.dual ? '双' : '合'}</b>${c.merge.text}</span>` : '') +
        (c.hint ? `<span class="yx-pick-hint">${c.hint}</span>` : '');
      b.addEventListener('click', () => this.pick(i));
      row.appendChild(b);
      return b;
    });
    this.root.appendChild(row);
    // 卡片三件套：刷新、封禁（点了以后再点一张卡）、跳过（换一点魂）
    const bar = document.createElement('div');
    bar.className = 'yx-picks-bar';
    bar.innerHTML =
      `<button type="button" data-a="reroll"${counts.rerolls > 0 ? '' : ' disabled'}><span>刷新 <b>${counts.rerolls}</b></span><small>整批换掉</small></button>` +
      `<button type="button" data-a="ban"${counts.bans > 0 ? '' : ' disabled'}><span>封禁 <b>${counts.bans}</b></span><small>这张整局不再出现</small></button>` +
      (counts.live
        ? '<button type="button" data-a="skip"><span>跳过</span><small>换一点魂</small></button>'
        : '<button type="button" data-a="skip"><span>跳过 · 随机小奖</span><small>随机拿个小奖</small></button>');
    bar.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'reroll') this.action(Pick.Reroll);
      else if (a === 'ban') this.toggleBan();
      else if (a === 'skip') this.action(Pick.Skip);
    });
    this.bar = bar;
    this.root.appendChild(bar);
    this.root.classList.remove('banning');
    this.root.classList.add('open');
    this.root.style.display = '';
    this.setFocus(0);
    this.onShow(firstTime);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.items.forEach((b, k) => b.classList.toggle('focus', k === i));
  }

  private pick(i: number): void {
    this.action(this.banning ? Pick.Ban + i : i);
  }

  private toggleBan(): void {
    if (!this.onPick || this.counts.bans <= 0) return;
    this.banning = !this.banning;
    this.root.classList.toggle('banning', this.banning);
    this.bar?.querySelector('[data-a="ban"]')?.classList.toggle('on', this.banning);
  }

  private action(code: number): void {
    // 卡片刚弹出的 150 ms 里不收，免得正在连点屏幕走路的手误选
    if (!this.onPick || performance.now() - this.openedAt < 150) return;
    if (code === Pick.Reroll && this.counts.rerolls <= 0) return;
    const cb = this.onPick;
    this.onPick = null;
    this.root.classList.remove('open');
    this.root.style.display = 'none';
    cb(code);
  }
}
