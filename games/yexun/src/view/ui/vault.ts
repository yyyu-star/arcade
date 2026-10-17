/**
 * 藏宝阁（DESIGN.md 2.3、3.8）：45 件宝物的图鉴，凡 / 良 / 珍 / 绝四个标签，顶上是收藏度和采药女的解锁进度。
 * - 收藏（带出来过）：点亮，显示名字和带出过几件；
 * - 见过（捡到过但没带出来）：剪影加名字；
 * - 没见过：黑影加问号。
 * 数据每次 show 时重新取（传进来的是取数函数，结算后再打开就是最新的），同 Codex。图标用图集帧 `treasureIconKey(def.icon)`。
 */
import { VAULT_UNLOCK } from '../../content/explore.ts';
import { TIERS, TIER_INFO, TREASURES, type TreasureTier } from '../../content/treasures.ts';
import { vaultProgress, type VaultSave } from '../../explore/vault.ts';
import { treasureIconKey } from '../art/sprites8.ts';
import './codex.css';
import './vault.css';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Vault {
  readonly root: HTMLDivElement;
  private tab: TreasureTier = 'fan';
  /** 选中的宝物编号（详情行），−1 没选 */
  private sel = -1;
  private readonly icons: (k: string) => string;
  private readonly getSave: () => VaultSave;
  onClose: () => void = () => undefined;

  /** icons：图集帧名 → 图片地址（要含夜探图集的 treasureIconKey 帧）；getSave：取最新的藏宝阁存档 */
  constructor(parent: HTMLElement, icons: (k: string) => string, getSave: () => VaultSave) {
    this.icons = icons;
    this.getSave = getSave;
    this.root = document.createElement('div');
    this.root.className = 'yx-screen yx-codex yx-vault';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || !this.root.contains(el)) return;
      if (el.dataset.a === 'close') this.onClose();
      else if (el.dataset.a === 'tab') {
        this.tab = el.dataset.t as TreasureTier;
        this.sel = -1;
        this.render();
      } else if (el.dataset.a === 'pick') {
        this.sel = Number(el.dataset.i);
        this.render();
      }
    });
  }

  show(tab?: TreasureTier): void {
    if (tab) this.tab = tab;
    this.sel = -1;
    this.render();
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private render(): void {
    const v = this.getSave();
    const pr = vaultProgress(v);
    const tabs = TIERS.map((t) => {
      const b = pr.byTier[t];
      return `<button type="button" class="yx-tab yx-vtab t-${t}${t === this.tab ? ' on' : ''}" data-a="tab" data-t="${t}"><b>${TIER_INFO[t].name}</b><small>${b.got}/${b.total}</small></button>`;
    }).join('');
    const herb = pr.got >= VAULT_UNLOCK.herbalist ? '采药女已解锁' : `再收藏 ${VAULT_UNLOCK.herbalist - pr.got} 件解锁采药女`;
    const cells = TREASURES.map((t, i) => (t.tier === this.tab ? this.cell(i, v) : '')).join('');
    this.root.innerHTML =
      '<div class="yx-panel yx-codex-panel yx-vault-panel">' +
      `<div class="yx-panel-head"><b class="yx-brush">藏宝阁</b><em>收藏 <strong>${pr.got}</strong> / ${pr.total} · 见过 ${pr.seen} · ${herb}</em></div>` +
      `<div class="yx-cbar"><i style="width:${Math.round((100 * pr.got) / pr.total)}%"></i></div>` +
      `<div class="yx-tabs">${tabs}</div>` +
      `<div class="yx-cbody"><div class="yx-vgrid">${cells}</div></div>` +
      `<div class="yx-vdetail">${this.detail(v)}</div>` +
      '<div class="yx-row3"><button type="button" class="yx-big ghost" data-a="close">返回</button></div>' +
      '</div>';
  }

  private cell(i: number, v: VaultSave): string {
    const t = TREASURES[i]!;
    const got = v.got[t.id] ?? 0;
    const seen = got > 0 || v.seen.includes(t.id);
    const cls = `yx-vcell t-${t.tier}${got ? ' got' : seen ? ' seen' : ' lock'}${i === this.sel ? ' sel' : ''}`;
    const img = `<img alt="" class="${got ? '' : 'sil'}" src="${this.icons(treasureIconKey(t.icon))}">`;
    return `<button type="button" class="${cls}" data-a="pick" data-i="${i}" aria-label="${seen ? esc(t.name) : '没见过的宝物'}">${img}<b>${seen ? esc(t.name) : '？？？'}</b>${got > 1 ? `<em>×${got}</em>` : ''}</button>`;
  }

  /** 选中那件的详情：收藏的写全，见过的写名字和档，没见过的只给个提示 */
  private detail(v: VaultSave): string {
    const t = this.sel >= 0 ? TREASURES[this.sel] : undefined;
    if (!t) return '点一件看看说明';
    const got = v.got[t.id] ?? 0;
    const seen = got > 0 || v.seen.includes(t.id);
    if (!seen) return `<b>？？？</b> ${TIER_INFO[t.tier].name}档 · 还没见过，去夜探里找`;
    return `<b>${esc(t.name)}</b> ${TIER_INFO[t.tier].name}档 · 值 ${t.value} 铜钱 · ${got ? `带出过 ${got} 件` : '捡到过，还没带出来'}<br><span>${esc(t.blurb)}</span>`;
  }
}
