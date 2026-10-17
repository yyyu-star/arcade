/**
 * 对局外的几个界面（DOM）：开始菜单、暂停（设置 + 本局法器）、结算、确认框、引导小提示。
 * 第一次打开只有一个大按钮（DESIGN.md 13.7：打开到开打 ≤ 30 秒）；玩过一局以后才出模式卡和难度。
 * 所有按钮 ≥ 44×44（tools/shot.ts 检查）；左上角常驻"大厅"，任何界面两步内回到大厅。
 */
import { DIFFICULTIES, type Difficulty } from '../../content/waves.ts';
import type { Best } from '../../platform/save.ts';
import './screens.css';

const HOME_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg><span>大厅</span>';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function layer(parent: HTMLElement, cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = `yx-screen ${cls}`;
  d.style.display = 'none';
  parent.appendChild(d);
  return d;
}

/** 按钮的 data-a 分派 */
function onAction(root: HTMLElement, handlers: Record<string, (el: HTMLElement) => void>): void {
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.a!];
    if (h) h(el);
  });
}

export interface Toggle {
  key: string;
  label: string;
  get: () => boolean;
  set: (on: boolean) => void;
}

function togglesHtml(list: Toggle[]): string {
  return list
    .map((t) => `<button type="button" class="yx-toggle${t.get() ? ' on' : ''}" data-a="toggle" data-k="${t.key}" aria-pressed="${t.get()}"><i></i>${esc(t.label)}</button>`)
    .join('');
}

function bindToggles(root: HTMLElement, list: Toggle[]): Record<string, (el: HTMLElement) => void> {
  return {
    toggle: (el) => {
      const t = list.find((x) => x.key === el.dataset.k);
      if (!t) return;
      t.set(!t.get());
      el.classList.toggle('on', t.get());
      el.setAttribute('aria-pressed', String(t.get()));
      void root;
    },
  };
}

// ───────────────────────── 开始菜单 ─────────────────────────

export interface MenuState {
  firstTime: boolean;
  difficulty: Difficulty;
  best: Partial<Record<Difficulty, Best>>;
}

export class Menu {
  readonly root: HTMLDivElement;
  private diff: Difficulty = 'easy';
  private readonly toggles: Toggle[];
  onStart: (d: Difficulty) => void = () => undefined;
  onClick: () => void = () => undefined;

  constructor(parent: HTMLElement, toggles: Toggle[]) {
    this.root = layer(parent, 'yx-menu');
    this.toggles = toggles;
    onAction(this.root, {
      ...bindToggles(this.root, toggles),
      start: () => this.onStart(this.diff),
      diff: (el) => {
        this.diff = el.dataset.d as Difficulty;
        for (const b of this.root.querySelectorAll<HTMLElement>('[data-a="diff"]')) b.classList.toggle('on', b.dataset.d === this.diff);
        this.renderBest();
      },
      settings: () => this.root.classList.toggle('show-settings'),
      home: () => {
        location.href = '/';
      },
    });
    this.root.addEventListener('click', () => this.onClick());
  }

  private best: MenuState['best'] = {};

  private renderBest(): void {
    const el = this.root.querySelector('.yx-best');
    if (!el) return;
    const b = this.best[this.diff];
    el.textContent = !b ? '还没玩过这个难度' : b.won ? `最好：天亮了 · 斩 ${b.kills.toLocaleString('zh-CN')}` : `最好：撑了 ${mmss(b.ticks / 30)} · 斩 ${b.kills.toLocaleString('zh-CN')}`;
  }

  show(s: MenuState): void {
    this.diff = s.difficulty;
    this.best = s.best;
    const top =
      `<button type="button" class="yx-btn yx-home" data-a="home" aria-label="回大厅">${HOME_SVG}</button>` +
      `<button type="button" class="yx-btn yx-gear" data-a="settings" aria-label="设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-.1-1.3 2-1.6-2-3.4-2.4.9a8 8 0 0 0-2.2-1.3L15 2.8h-4l-.4 2.5a8 8 0 0 0-2.2 1.3L6 5.7 4 9.1l2 1.6L5.9 12l.1 1.3-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a8 8 0 0 0 2.2-1.3l2.4.9 2-3.4-2-1.6.1-1.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
      `<div class="yx-settings">${togglesHtml(this.toggles)}</div>`;
    const title = '<div class="yx-title"><b>夜巡</b><span>道士夜巡雪夜古镇 · 撑到天亮</span></div>';
    if (s.firstTime) {
      this.root.innerHTML =
        top +
        title +
        '<button type="button" class="yx-big yx-go" data-a="start">开始守夜</button>' +
        '<div class="yx-hint">只管走位，法器自己出手</div>';
    } else {
      const chips = (['easy', 'normal', 'hard'] as const)
        .map((d) => `<button type="button" class="yx-chip${d === this.diff ? ' on' : ''}" data-a="diff" data-d="${d}"><b>${DIFFICULTIES[d].name}</b><small>${'★'.repeat(DIFFICULTIES[d].stars)}</small></button>`)
        .join('');
      this.root.innerHTML =
        top +
        title +
        '<div class="yx-modes">' +
        `<div class="yx-mode"><div class="yx-mode-head"><span class="yx-moon"></span><b>守夜</b><em>15 分钟 · 撑到天亮</em></div><div class="yx-chips">${chips}</div><div class="yx-best"></div><button type="button" class="yx-big" data-a="start">开始</button></div>` +
        '<div class="yx-mode off"><div class="yx-mode-head"><span class="yx-lamp"></span><b>夜探</b><em>搜宝、打怪、找门撤离</em></div><div class="yx-soon">还在做，很快开放</div></div>' +
        '</div>';
      this.renderBest();
    }
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.classList.remove('show-settings');
  }
}

// ───────────────────────── 暂停 ─────────────────────────

export interface BuildRow {
  icon: string;
  name: string;
  level: number;
  /** 法器：伤害；被动：-1 */
  dmg: number;
  kills: number;
  /** 进化还差什么（暂停页显示；进化好了或没有进化的为空） */
  hint?: string;
}

export class Pause {
  readonly root: HTMLDivElement;
  private readonly toggles: Toggle[];
  private readonly icons: (k: string) => string;
  onResume: () => void = () => undefined;
  onHome: () => void = () => undefined;
  onQuit: () => void = () => undefined;

  constructor(parent: HTMLElement, toggles: Toggle[], icons: (k: string) => string) {
    this.root = layer(parent, 'yx-pausescr');
    this.toggles = toggles;
    this.icons = icons;
    onAction(this.root, {
      ...bindToggles(this.root, toggles),
      resume: () => this.onResume(),
      home: () => this.onHome(),
      quit: () => this.onQuit(),
    });
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  /** sets：凑成的套装说明（"剑 2 件 · 暴击 +8%"） */
  show(build: BuildRow[], left: number, sets: string[] = []): void {
    const rows = build
      .map(
        (r) =>
          `<div class="yx-brow"><img alt="" src="${this.icons(r.icon)}"><b>${esc(r.name)}</b><em>${r.level > 8 ? '进化' : r.level === 8 ? '满级' : `Lv ${r.level}`}</em>` +
          (r.dmg >= 0 ? `<span>${Math.round(r.dmg).toLocaleString('zh-CN')} 伤 · ${r.kills} 斩${r.hint ? ` · <i>${esc(r.hint)}</i>` : ''}</span>` : '<span></span>') +
          '</div>',
      )
      .join('') + (sets.length ? `<div class="yx-sets">${sets.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '');
    this.root.innerHTML =
      '<div class="yx-panel yx-pause-panel">' +
      `<div class="yx-panel-head"><b class="yx-brush">暂停</b><em>离天亮 ${mmss(left)}</em></div>` +
      '<div class="yx-pause-body">' +
      `<div class="yx-build">${rows}</div>` +
      `<div class="yx-pause-side"><div class="yx-toggles">${togglesHtml(this.toggles)}</div>` +
      '<button type="button" class="yx-big" data-a="resume">继续</button>' +
      '<div class="yx-row2"><button type="button" class="yx-big ghost" data-a="quit">认输</button><button type="button" class="yx-big ghost" data-a="home">回大厅</button></div>' +
      '</div></div></div>';
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

// ───────────────────────── 确认框 ─────────────────────────

export class Confirm {
  private readonly root: HTMLDivElement;
  private cb: ((ok: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = layer(parent, 'yx-confirm');
    onAction(this.root, {
      yes: () => this.close(true),
      no: () => this.close(false),
    });
  }

  get open(): boolean {
    return this.cb !== null;
  }

  ask(text: string, yes: string, no: string, cb: (ok: boolean) => void): void {
    this.cb = cb;
    this.root.innerHTML = `<div class="yx-panel yx-confirm-panel"><p>${esc(text)}</p><div class="yx-row2"><button type="button" class="yx-big ghost" data-a="no">${esc(no)}</button><button type="button" class="yx-big" data-a="yes">${esc(yes)}</button></div></div>`;
    this.root.style.display = '';
  }

  close(ok: boolean): void {
    const cb = this.cb;
    this.cb = null;
    this.root.style.display = 'none';
    cb?.(ok);
  }
}

// ───────────────────────── 结算 ─────────────────────────

export interface ResultView {
  won: boolean;
  quit: boolean;
  bossKilled: boolean;
  seconds: number;
  kills: number;
  level: number;
  coins: number;
  difficulty: Difficulty;
  record: boolean;
  build: BuildRow[];
}

export class Result {
  readonly root: HTMLDivElement;
  private readonly icons: (k: string) => string;
  onAgain: () => void = () => undefined;
  onMenu: () => void = () => undefined;

  constructor(parent: HTMLElement, icons: (k: string) => string) {
    this.root = layer(parent, 'yx-result');
    this.icons = icons;
    onAction(this.root, {
      again: () => this.onAgain(),
      menu: () => this.onMenu(),
      home: () => {
        location.href = '/';
      },
    });
  }

  show(r: ResultView): void {
    const title = r.won ? (r.bossKilled ? '尸王伏诛' : '天亮了') : r.quit ? '收工' : '倒下了';
    const sub = r.won ? (r.bossKilled ? '打倒尸王，天提前亮了' : '撑过了一整夜') : `撑了 ${mmss(r.seconds)}，离天亮还差 ${mmss(Math.max(0, 900 - r.seconds))}`;
    const top = Math.max(1, ...r.build.map((b) => b.dmg));
    const rows = r.build
      .filter((b) => b.dmg >= 0)
      .sort((a, b) => b.dmg - a.dmg)
      .map(
        (b) =>
          `<div class="yx-rrow"><img alt="" src="${this.icons(b.icon)}"><b>${esc(b.name)}</b><div class="yx-rbar"><i style="width:${Math.round((100 * b.dmg) / top)}%"></i></div><span>${Math.round(b.dmg).toLocaleString('zh-CN')}</span></div>`,
      )
      .join('');
    const passives = r.build
      .filter((b) => b.dmg < 0)
      .map((b) => `<span class="yx-rpass"><img alt="" src="${this.icons(b.icon)}"><em>${b.level}</em></span>`)
      .join('');
    this.root.innerHTML =
      `<div class="yx-panel yx-result-panel${r.won ? ' won' : ''}">` +
      `<div class="yx-panel-head"><b class="yx-brush">${title}</b><em>${DIFFICULTIES[r.difficulty].name}${r.record ? ' · <strong>新纪录</strong>' : ''}</em></div>` +
      `<div class="yx-rsub">${sub}</div>` +
      '<div class="yx-rstats">' +
      `<div><b>${r.kills.toLocaleString('zh-CN')}</b><span>斩</span></div>` +
      `<div><b>${r.level}</b><span>级</span></div>` +
      `<div><b>${r.coins.toLocaleString('zh-CN')}</b><span>铜钱</span></div>` +
      `<div><b>${mmss(r.seconds)}</b><span>撑了</span></div>` +
      '</div>' +
      `<div class="yx-rbuild">${rows}${passives ? `<div class="yx-rpasses">${passives}</div>` : ''}</div>` +
      '<div class="yx-row3">' +
      '<button type="button" class="yx-big ghost" data-a="home">大厅</button>' +
      '<button type="button" class="yx-big ghost" data-a="menu">换难度</button>' +
      '<button type="button" class="yx-big" data-a="again">再来一局</button>' +
      '</div></div>';
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

// ───────────────────────── 引导小提示 ─────────────────────────

/** 第一局最多 3 条（DESIGN.md 13.7），每条带"不再提示"，点了以后整套引导都关掉 */
export class Tips {
  private readonly root: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  onOff: () => void = () => undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'yx-tip';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    onAction(this.root, {
      off: () => {
        this.hide();
        this.onOff();
      },
    });
  }

  show(html: string, ms: number): void {
    this.root.innerHTML = `<span>${html}</span><button type="button" data-a="off" aria-label="不再提示">不再提示</button>`;
    this.root.style.display = '';
    if (this.timer) clearTimeout(this.timer);
    this.timer = ms > 0 ? setTimeout(() => this.hide(), ms) : null;
  }

  hide(): void {
    this.root.style.display = 'none';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
