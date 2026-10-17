/**
 * 开局准备（DESIGN.md 3.7、3.8、13.2）：选角色、挂咒印、买永久加成。只管画和点，规则和存档在 save.ts，状态由 main.ts 每次重新给。
 */
import { CHARACTER_IDS, CHARACTERS, CURSE_COIN_BONUS, CURSE_IDS, CURSES, MAX_CURSES, PERK_IDS, PERKS, type CharacterId, type CurseId, type PerkId } from '../../content/meta.ts';
import { WEAPONS } from '../../content/weapons.ts';
import './prep.css';

/** 锁：不用表情字符（有的设备、无头浏览器没有表情字体，显示成方框） */
const LOCK_SVG = '<svg class="yx-lock" viewBox="0 0 12 12" aria-label="没解锁"><rect x="2" y="5.5" width="8" height="6" rx="1.2" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

export type PrepTab = 'char' | 'curse' | 'perk';

export interface PrepState {
  coins: number;
  character: CharacterId;
  /** 每个角色：开了没有、买得到的价格 */
  chars: Record<CharacterId, { open: boolean; price?: number }>;
  curses: CurseId[];
  cursesOpen: boolean;
  perks: Partial<Record<PerkId, number>>;
}

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class Prep {
  readonly root: HTMLDivElement;
  private tab: PrepTab = 'char';
  private state: PrepState | null = null;
  onPickChar: (id: CharacterId) => void = () => undefined;
  onBuyChar: (id: CharacterId) => void = () => undefined;
  onToggleCurse: (id: CurseId) => void = () => undefined;
  onBuyPerk: (id: PerkId) => void = () => undefined;
  onRefund: () => void = () => undefined;
  onClose: () => void = () => undefined;

  private readonly icons: (k: string) => string;

  constructor(parent: HTMLElement, icons: (k: string) => string) {
    this.icons = icons;
    this.root = document.createElement('div');
    this.root.className = 'yx-screen yx-prep-layer';
    this.root.style.display = 'none';
    parent.append(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || el.getAttribute('aria-disabled') === 'true') return;
      const id = el.dataset.id ?? '';
      switch (el.dataset.a) {
        case 'tab':
          this.tab = el.dataset.t as PrepTab;
          this.render();
          break;
        case 'char':
          this.onPickChar(id as CharacterId);
          break;
        case 'buychar':
          this.onBuyChar(id as CharacterId);
          break;
        case 'curse':
          this.onToggleCurse(id as CurseId);
          break;
        case 'perk':
          this.onBuyPerk(id as PerkId);
          break;
        case 'refund':
          this.onRefund();
          break;
        case 'close':
          this.onClose();
          break;
      }
    });
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  show(tab: PrepTab, s: PrepState): void {
    this.tab = tab === 'curse' && !s.cursesOpen ? 'char' : tab;
    this.state = s;
    this.render();
    this.root.style.display = '';
  }

  /** 状态变了（买了、选了）：留在当前标签页重画 */
  update(s: PrepState): void {
    this.state = s;
    if (this.open) this.render();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private render(): void {
    const s = this.state!;
    const tabs = (
      [
        ['char', '角色'],
        ...(s.cursesOpen ? [['curse', '咒印']] : []),
        ['perk', '加成'],
      ] as [PrepTab, string][]
    )
      .map(([t, n]) => `<button type="button" class="yx-ptab${t === this.tab ? ' on' : ''}" data-a="tab" data-t="${t}">${n}</button>`)
      .join('');
    const body = this.tab === 'char' ? this.chars(s) : this.tab === 'curse' ? this.cursesHtml(s) : this.perksHtml(s);
    this.root.innerHTML =
      '<div class="yx-panel yx-prep">' +
      `<div class="yx-prep-head"><div class="yx-ptabs">${tabs}</div><span class="yx-pcoins"><span class="yx-coin"></span>${s.coins.toLocaleString('zh-CN')}</span>` +
      '<button type="button" class="yx-btn yx-pclose" data-a="close" aria-label="关上">✕</button></div>' +
      `<div class="yx-prep-body">${body}</div></div>`;
  }

  private chars(s: PrepState): string {
    return (
      '<div class="yx-pgrid">' +
      CHARACTER_IDS.map((id) => {
        const c = CHARACTERS[id];
        const st = s.chars[id];
        const on = id === s.character;
        const action = st.open ? `data-a="char" data-id="${id}"` : st.price !== undefined ? `data-a="buychar" data-id="${id}"${s.coins < st.price ? ' aria-disabled="true"' : ''}` : 'aria-disabled="true"';
        const foot = st.open ? (on ? '出战中' : '选他') : st.price !== undefined ? `<span class="yx-coin"></span>${st.price}` : `${LOCK_SVG} ${esc(c.unlock)}`;
        return (
          `<button type="button" class="yx-pcard${on ? ' on' : ''}${st.open ? '' : ' locked'}" ${action}>` +
          `<img alt="" src="${this.icons(WEAPONS[c.start].icon)}"><b>${esc(c.name)}</b><small>起手 ${esc(WEAPONS[c.start].name)}</small><p>${esc(c.perk)}</p><em>${foot}</em></button>`
        );
      }).join('') +
      '</div>'
    );
  }

  private cursesHtml(s: PrepState): string {
    const n = s.curses.length;
    return (
      `<div class="yx-pnote">最多挂 ${MAX_CURSES} 条；每条这局的铜钱多 ${Math.round(CURSE_COIN_BONUS * 100)}%（现在 +${Math.round(n * CURSE_COIN_BONUS * 100)}%）</div>` +
      '<div class="yx-pgrid">' +
      CURSE_IDS.map((id) => {
        const on = s.curses.includes(id);
        const full = !on && n >= MAX_CURSES;
        return `<button type="button" class="yx-pcard yx-pcurse${on ? ' on' : ''}" data-a="curse" data-id="${id}"${full ? ' aria-disabled="true"' : ''}><b class="yx-brush">${esc(CURSES[id].name)}</b><p>${esc(CURSES[id].text)}</p><em>${on ? '挂上了' : full ? '已满' : '挂上'}</em></button>`;
      }).join('') +
      '</div>'
    );
  }

  private perksHtml(s: PrepState): string {
    const any = PERK_IDS.some((id) => (s.perks[id] ?? 0) > 0);
    return (
      '<div class="yx-pnote">只在娱乐里生效；随时能全退，花掉的铜钱全数还回来</div>' +
      '<div class="yx-pgrid yx-pperks">' +
      PERK_IDS.map((id) => {
        const p = PERKS[id];
        const lv = s.perks[id] ?? 0;
        const max = p.cost.length;
        const price = p.cost[lv];
        const pips = Array.from({ length: max }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('');
        const dis = price === undefined || s.coins < price;
        return `<button type="button" class="yx-pcard yx-pperk" data-a="perk" data-id="${id}"${dis ? ' aria-disabled="true"' : ''}><b>${esc(p.name)}</b><p>${esc(p.text)}</p><span class="yx-pips">${pips}</span><em>${price === undefined ? '满了' : `<span class="yx-coin"></span>${price}`}</em></button>`;
      }).join('') +
      '</div>' +
      (any ? '<button type="button" class="yx-big ghost yx-prefund" data-a="refund">全退重配</button>' : '')
    );
  }
}
