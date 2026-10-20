/**
 * 开局准备（DESIGN.md 3.7、3.8、13.2）：选角色、挂咒印、买永久加成。只管画和点，规则和存档在 save.ts，状态由 main.ts 每次重新给。
 */
import { CHARACTER_IDS, CHARACTERS, CURSE_COIN_BONUS, CURSE_IDS, CURSES, MAX_CURSES, PERK_IDS, PERKS, type CharacterId, type CurseId, type PerkId } from '../../content/meta.ts';
import { WEAPONS } from '../../content/weapons.ts';
import { heroKey } from '../art/heroes.ts';
import './prep.css';

/** 锁：不用表情字符（有的设备、无头浏览器没有表情字体，显示成方框） */
const LOCK_SVG = '<svg class="yx-lock" viewBox="0 0 12 12" aria-label="没解锁"><rect x="2" y="5.5" width="8" height="6" rx="1.2" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

export type PrepTab = 'char' | 'curse' | 'perk';

export interface PrepState {
  coins: number;
  character: CharacterId;
  /** 每个角色：开了没有、买得到的价格 */
  chars: Record<CharacterId, { open: boolean; price?: number; progress: string }>;
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

  private readonly icons: (k: string, px?: number) => string;

  constructor(parent: HTMLElement, icons: (k: string, px?: number) => string) {
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

  /** 初始数值对比条：以小道士（全 1）为基准画在 50% 处；高于基准绿、低于红，右边写百分比差。冷却取倒数（出手快慢），拾取和运气合成一根 */
  private statBars(id: CharacterId): string {
    const b = CHARACTERS[id].base;
    const rows: [string, number][] = [
      ['血量', b.hp],
      ['移速', b.speed],
      ['伤害', b.might],
      ['出手', 1 / b.cd],
      ['范围', b.area],
      ['拾取运气', b.magnet + b.luck],
    ];
    return (
      '<span class="yx-pbars">' +
      rows
        .map(([name, v]) => {
          const pct = Math.round((v - 1) * 100);
          const txt = pct === 0 ? '—' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
          // 条满长对应 2 倍；基准在 50%，差的那一段按方向上色
          const lo = Math.max(0, Math.min(100, Math.min(v, 1) * 50));
          const hi = Math.max(0, Math.min(100, Math.max(v, 1) * 50));
          const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
          return (
            `<span class="yx-pbar ${cls}"><i class="yx-pbn">${name}</i>` +
            `<span class="yx-pbt"><span class="yx-pbf" style="width:${lo}%"></span><span class="yx-pbd" style="left:${lo}%;width:${hi - lo}%"></span></span>` +
            `<i class="yx-pbv">${txt}</i></span>`
          );
        })
        .join('') +
      '</span>'
    );
  }

  /** 六张角色卡：头像（对局精灵）、名字、起手法器、被动、人设；选中的显示台词；没解锁的灰着显示怎么解锁和进度 */
  private chars(s: PrepState): string {
    return (
      '<div class="yx-pgrid yx-pchars">' +
      CHARACTER_IDS.map((id) => {
        const c = CHARACTERS[id];
        const st = s.chars[id];
        const on = id === s.character;
        const w = WEAPONS[c.start];
        const canBuy = !st.open && st.price !== undefined;
        const afford = canBuy && s.coins >= st.price!;
        const action = st.open ? `data-a="char" data-id="${id}"` : canBuy ? `data-a="buychar" data-id="${id}"${afford ? '' : ' aria-disabled="true"'}` : 'aria-disabled="true"';
        let foot: string;
        if (st.open) foot = on ? '出战中' : '选他';
        else if (canBuy) foot = afford ? `<span class="yx-coin"></span>${st.price} 请他` : `<span class="yx-coin"></span>${st.price}（还差 ${st.price! - s.coins}）`;
        else foot = `${LOCK_SVG} 还没解锁`;
        const note = st.open ? '' : `<small class="yx-pneed">${esc(st.progress || c.unlock)}</small>`;
        return (
          `<button type="button" class="yx-pcard yx-pchar${on ? ' on' : ''}${st.open ? '' : ' locked'}" ${action}>` +
          `<span class="yx-pface"><img alt="" src="${this.icons(heroKey(id), 128)}"></span>` +
          `<b>${esc(c.name)}</b><span class="yx-pstart"><img alt="" src="${this.icons(w.icon)}">起手 ${esc(w.name)}</span>` +
          `<span class="yx-pperkname">${esc(c.perkName)}</span><p>${esc(c.perk)}</p>` +
          this.statBars(id) +
          `<span class="yx-ppriv">小特权：${esc(c.privilege)}</span>` +
          (on && st.open ? `<q class="yx-pline">${esc(c.line)}</q>` : `<span class="yx-plook">${esc(c.look)}</span>`) +
          `${canBuy ? '' : note}<em>${foot}</em></button>`
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
