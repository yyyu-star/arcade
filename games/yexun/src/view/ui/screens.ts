/**
 * 对局外的几个界面（DOM）：开始菜单、暂停（设置 + 本局法器）、结算、确认框、引导小提示。
 * 第一次打开只有一个大按钮（DESIGN.md 13.7：打开到开打 ≤ 30 秒）；玩过一局以后才出模式卡和难度。
 * 所有按钮 ≥ 44×44（tools/shot.ts 检查）；左上角常驻"大厅"，任何界面两步内回到大厅。
 */
import { MAPS, type MapId } from '../../content/maps.ts';
import { DANGER_IDS, DANGERS, type Danger } from '../../content/waves.ts';
import { CHARACTERS, CURSES, type CharacterId, type CurseId } from '../../content/meta.ts';
import { LIVE_TIER_IDS, LIVE_TIERS, type LiveTier } from '../../content/live.ts';
import { RAID_TEMPLATES, type RaidTemplateId } from '../../content/explore.ts';
import type { TreasureTier } from '../../content/treasures.ts';
import type { Best } from '../../platform/save.ts';
import { drawFlakes, drawModeScene, drawTitleLive, drawTitleStill, makeFlakes, type Flake } from '../art/sprites7.ts';
import './screens.css';

/** 锁：不用表情字符（有的设备、无头浏览器没有表情字体，显示成方框） */
const LOCK_SVG = '<svg class="yx-lock" viewBox="0 0 12 12" aria-label="没解锁"><rect x="2" y="5.5" width="8" height="6" rx="1.2" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

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
  danger: Danger;
  /** 能选的最高危险档 */
  dangerOpen: Danger;
  best: Partial<Record<Danger, Best>>;
  map: MapId;
  /** 铜钱、角色、咒印（开局准备里改，这里只显示） */
  coins: number;
  character: CharacterId;
  curses: CurseId[];
  /** 咒印开了没有（撑到过一次天亮） */
  cursesOpen: boolean;
  /** 实盘能不能选（有平台钱包）、上次是不是在实盘、选的档位 */
  live: { available: boolean; on: boolean; tier: LiveTier };
  /** 义庄开了没有（普通档以上撑到过天亮） */
  yizhuang: boolean;
  /** 夜探：还没进过夜探（第一次固定教学镇，只有一个开始按钮） */
  raidFirst?: boolean;
  /** 夜探卡上"藏宝阁 3/45"那个按钮（没传就不显示） */
  vault?: { got: number; total: number };
}

/** 夜探卡能选的镇子（教学镇不在里面：第一次固定进） */
const RAID_PICK: readonly RaidTemplateId[] = ['guzhen', 'dukou', 'shansi'];

/** 模式卡上的小场景图（画一次缓存成 data URL） */
const sceneCache = new Map<string, string>();
function sceneUrl(kind: 'watch' | 'raid', w: number, h: number): string {
  const key = `${kind}${w}x${h}`;
  let u = sceneCache.get(key);
  if (!u) {
    const cv = document.createElement('canvas');
    cv.width = w * 2;
    cv.height = h * 2;
    const c = cv.getContext('2d')!;
    c.scale(2, 2);
    drawModeScene(c, w, h, kind);
    u = cv.toDataURL();
    sceneCache.set(key, u);
  }
  return u;
}

export class Menu {
  readonly root: HTMLDivElement;
  private readonly art: HTMLCanvasElement;
  private readonly ui: HTMLDivElement;
  private raf = 0;
  private artSize = '';
  private still: HTMLCanvasElement | null = null;
  private info: ReturnType<typeof drawTitleStill> | null = null;
  private flakes: Flake[] = [];
  private last = 0;
  private diff: Danger = 0;
  private map: MapId = 'snow';
  private tpl: RaidTemplateId = 'guzhen';
  private readonly toggles: Toggle[];
  onStart: (d: Danger, map: MapId, endless: boolean) => void = () => undefined;
  /** 无尽：天亮不收工，一直打到倒下（撑到过一次天亮才开） */
  private endless = false;
  onBoards: () => void = () => undefined;
  onReplays: () => void = () => undefined;
  onDaily: () => void = () => undefined;
  /** 夜探开局：镇子（第一次是 'teach'）和危险档（教学镇固定 0；其余用守夜那一排选的档） */
  onRaid: (template: RaidTemplateId, danger: Danger) => void = () => undefined;
  /** 打开藏宝阁 */
  onVault: () => void = () => undefined;
  /** 实盘开局（固定小道士、雪原，档位定危险档） */
  onLive: (tier: LiveTier) => void = () => undefined;
  /** 切娱乐 / 实盘、换档位（main 记进存档） */
  onLiveMode: (on: boolean, tier: LiveTier) => void = () => undefined;
  private live: MenuState['live'] = { available: false, on: false, tier: 'small' };
  private lastState: MenuState | null = null;
  /** 打开开局准备（角色、咒印、加成） */
  onPrep: (tab: 'char' | 'curse' | 'perk') => void = () => undefined;
  onClick: () => void = () => undefined;
  /** 图鉴和成就 */
  onCodex: () => void = () => undefined;

  constructor(parent: HTMLElement, toggles: Toggle[]) {
    this.root = layer(parent, 'yx-menu');
    this.art = document.createElement('canvas');
    this.art.className = 'yx-art';
    this.art.setAttribute('aria-hidden', 'true');
    this.ui = document.createElement('div');
    this.ui.className = 'yx-menu-ui';
    this.root.append(this.art, this.ui);
    this.toggles = toggles;
    onAction(this.root, {
      ...bindToggles(this.root, toggles),
      start: () => (this.live.on && this.live.available ? this.onLive(this.live.tier) : this.onStart(this.diff, this.map, this.endless)),
      mode: (el) => {
        this.live = { ...this.live, on: el.dataset.m === 'live' };
        this.onLiveMode(this.live.on, this.live.tier);
        if (this.lastState) this.show({ ...this.lastState, live: this.live });
      },
      tier: (el) => {
        this.live = { ...this.live, tier: el.dataset.t as LiveTier };
        this.onLiveMode(this.live.on, this.live.tier);
        if (this.lastState) this.show({ ...this.lastState, live: this.live });
      },
      raid: () => (this.lastState?.raidFirst ? this.onRaid('teach', 0) : this.onRaid(this.tpl, this.diff)),
      tpl: (el) => {
        this.tpl = el.dataset.t as RaidTemplateId;
        for (const b of this.root.querySelectorAll<HTMLElement>('[data-a="tpl"]')) b.classList.toggle('on', b.dataset.t === this.tpl);
        const note = this.root.querySelector('.yx-tplnote');
        if (note) note.textContent = RAID_TEMPLATES[this.tpl].blurb;
      },
      vault: () => this.onVault(),
      map: (el) => {
        if (el.classList.contains('locked')) return;
        this.map = el.dataset.m as MapId;
        for (const b of this.root.querySelectorAll<HTMLElement>('[data-a="map"]')) b.classList.toggle('on', b.dataset.m === this.map);
      },
      prep: (el) => this.onPrep(el.dataset.t as 'char' | 'curse' | 'perk'),
      diff: (el) => {
        if (el.classList.contains('locked')) return;
        this.diff = Number(el.dataset.d) as Danger;
        for (const b of this.root.querySelectorAll<HTMLElement>('[data-a="diff"]')) b.classList.toggle('on', Number(b.dataset.d) === this.diff);
        this.renderBest();
      },
      settings: () => this.root.classList.toggle('show-settings'),
      codex: () => this.onCodex(),
      boards: () => this.onBoards(),
      replays: () => this.onReplays(),
      daily: () => this.onDaily(),
      endless: (el) => {
        this.endless = !this.endless;
        el.classList.toggle('on', this.endless);
      },
      home: () => {
        location.href = '/';
      },
    });
    this.root.addEventListener('click', () => this.onClick());
  }

  private best: MenuState['best'] = {};

  private renderBest(): void {
    const el = this.ui.querySelector('.yx-best');
    if (!el) return;
    const b = this.best[this.diff];
    el.textContent = !b ? `${DANGERS[this.diff].blurb} · 还没玩过` : b.won ? `最好：天亮了 · 斩 ${b.kills.toLocaleString('zh-CN')}` : `最好：撑了 ${mmss(b.ticks / 30)} · 斩 ${b.kills.toLocaleString('zh-CN')}`;
  }

  show(s: MenuState): void {
    this.diff = Math.min(s.danger, s.dangerOpen) as Danger;
    this.lastState = s;
    this.live = s.live;
    const live = s.live.available && s.live.on;
    this.map = s.yizhuang ? s.map : 'snow';
    this.best = s.best;
    const top =
      `<button type="button" class="yx-btn yx-home" data-a="home" aria-label="回大厅">${HOME_SVG}</button>` +
      `<button type="button" class="yx-btn yx-gear" data-a="settings" aria-label="设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-.1-1.3 2-1.6-2-3.4-2.4.9a8 8 0 0 0-2.2-1.3L15 2.8h-4l-.4 2.5a8 8 0 0 0-2.2 1.3L6 5.7 4 9.1l2 1.6L5.9 12l.1 1.3-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a8 8 0 0 0 2.2-1.3l2.4.9 2-3.4-2-1.6.1-1.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
      `<div class="yx-settings">${togglesHtml(this.toggles)}</div>` +
      (s.firstTime
        ? ''
        : '<div class="yx-more">' +
          '<button type="button" class="yx-btn" data-a="daily">每日</button>' +
          '<button type="button" class="yx-btn" data-a="boards">排行</button>' +
          '<button type="button" class="yx-btn" data-a="replays">回放</button>' +
          '<button type="button" class="yx-btn" data-a="codex">图鉴</button>' +
          '</div>');
    const title = '<div class="yx-title"><b>夜巡</b><span>道士夜巡雪夜古镇 · 撑到天亮</span></div>';
    if (s.firstTime) {
      this.ui.innerHTML =
        top +
        title +
        '<button type="button" class="yx-big yx-go" data-a="start">开始守夜</button>' +
        '<div class="yx-hint">只管走位，法器自己出手</div>';
    } else {
      const chips = DANGER_IDS.map((d) => {
        const locked = d > s.dangerOpen;
        return `<button type="button" class="yx-chip yx-danger${d === this.diff ? ' on' : ''}${locked ? ' locked' : ''}" data-a="diff" data-d="${d}"${locked ? ' aria-disabled="true" title="撑到天亮解锁下一档"' : ''}><b>${d}</b><small>${locked ? LOCK_SVG : '★'.repeat(DANGERS[d].stars)}</small></button>`;
      }).join('');
      const modeChips = s.live.available
        ? `<div class="yx-chips yx-modesw"><button type="button" class="yx-chip${live ? '' : ' on'}" data-a="mode" data-m="fun"><b>娱乐</b><small>不花筹码</small></button><button type="button" class="yx-chip${live ? ' on' : ''}" data-a="mode" data-m="live"><b>实盘</b><small>带一份筹码</small></button></div>`
        : '';
      const liveHtml =
        `<div class="yx-chips yx-tiers">${LIVE_TIER_IDS.map((t) => `<button type="button" class="yx-chip${t === s.live.tier ? ' on' : ''}" data-a="tier" data-t="${t}"><b>${LIVE_TIERS[t].name}</b><small>${LIVE_TIERS[t].stake.toLocaleString('zh-CN')}</small></button>`).join('')}</div>` +
        `<div class="yx-livenote">危险 ${LIVE_TIERS[s.live.tier].danger} · 固定小道士、雪原，不带加成和咒印<br>撑过 3 分钟开始回本，10 分钟保本，天亮 1.8 份，打倒尸王 3 份；最多输这一份</div>`;
      const curse = s.curses.length ? s.curses.map((c) => CURSES[c].name).join('') : '无';
      const prep =
        `<button type="button" class="yx-chip yx-prep" data-a="prep" data-t="char"><b>${CHARACTERS[s.character].name}</b><small>角色</small></button>` +
        (s.cursesOpen ? `<button type="button" class="yx-chip yx-prep${s.curses.length ? ' hot' : ''}" data-a="prep" data-t="curse"><b>${curse}</b><small>咒印</small></button>` : '') +
        `<button type="button" class="yx-chip yx-prep" data-a="prep" data-t="perk"><b><span class="yx-coin"></span>${s.coins.toLocaleString('zh-CN')}</b><small>加成</small></button>`;
      const maps = (['snow', 'yizhuang'] as const)
        .map((m) => {
          const locked = m === 'yizhuang' && !s.yizhuang;
          return `<button type="button" class="yx-chip yx-map${m === this.map ? ' on' : ''}${locked ? ' locked' : ''}" data-a="map" data-m="${m}"${locked ? ' aria-disabled="true"' : ''}><b>${MAPS[m].name}</b><small>${locked ? '危险 1 撑到天亮开' : MAPS[m].blurb}</small></button>`;
        })
        .join('') +
        (s.cursesOpen
          ? `<button type="button" class="yx-chip yx-map${this.endless ? ' on' : ''}" data-a="endless"><b>无尽</b><small>天亮不收工</small></button>`
          : '');
      this.ui.innerHTML =
        top +
        title +
        '<div class="yx-modes">' +
        `<div class="yx-mode"><img class="yx-scene" alt="" src="${sceneUrl('watch', 320, 100)}"><div class="yx-mode-head"><span class="yx-moon"></span><b>守夜</b><em>15 分钟 · 撑到天亮</em></div>${modeChips}${live ? liveHtml : `<div class="yx-chips yx-dangers" aria-label="危险档">${chips}</div><div class="yx-chips">${maps}</div><div class="yx-chips">${prep}</div><div class="yx-best"></div>`}<button type="button" class="yx-big" data-a="start">开始</button></div>` +
        `<div class="yx-mode"><img class="yx-scene" alt="" src="${sceneUrl('raid', 320, 100)}"><div class="yx-mode-head"><span class="yx-lamp"></span><b>夜探</b><em>搜宝、打怪、找门撤离</em></div>${this.raidHtml(s)}</div>` +
        '</div>';
      this.renderBest();
    }
    this.root.style.display = '';
    this.startArt();
  }

  /** 夜探卡的内容：第一次只有教学镇一个按钮；之后三个镇子可选，危险档沿用守夜那一排 */
  private raidHtml(s: MenuState): string {
    const vault = s.vault ? `<button type="button" class="yx-chip yx-vaultbtn" data-a="vault"><b>藏宝阁</b><small>${s.vault.got} / ${s.vault.total}</small></button>` : '';
    if (s.raidFirst) {
      return (
        `<div class="yx-raidnote"><b>${RAID_TEMPLATES.teach.name}</b>${RAID_TEMPLATES.teach.blurb}</div>` +
        '<div class="yx-chips yx-raidbtns"><button type="button" class="yx-big" data-a="raid">开始夜探</button></div>'
      );
    }
    const chips = RAID_PICK.map((t) => `<button type="button" class="yx-chip yx-tpl${t === this.tpl ? ' on' : ''}" data-a="tpl" data-t="${t}"><b>${RAID_TEMPLATES[t].name}</b></button>`).join('');
    return (
      `<div class="yx-chips yx-tpls" aria-label="镇子">${chips}</div>` +
      `<div class="yx-tplnote">${RAID_TEMPLATES[this.tpl].blurb}</div>` +
      `<div class="yx-chips yx-raidbtns"><button type="button" class="yx-big" data-a="raid">开始夜探</button>${vault}</div>`
    );
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.classList.remove('show-settings');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** 主视觉：静的底图画一次，动的（月晕、灯笼、飘雪）每帧叠；尺寸变了才重画底图。设备像素最多 2 倍（省内存设备同） */
  private startArt(): void {
    cancelAnimationFrame(this.raf);
    const frame = (now: number): void => {
      const w = this.root.clientWidth;
      const h = this.root.clientHeight;
      if (w < 2 || h < 2) {
        this.raf = requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const sizeKey = `${w}x${h}@${dpr}`;
      if (sizeKey !== this.artSize) {
        this.artSize = sizeKey;
        this.art.width = Math.round(w * dpr);
        this.art.height = Math.round(h * dpr);
        const st = document.createElement('canvas');
        st.width = this.art.width;
        st.height = this.art.height;
        const sc = st.getContext('2d')!;
        sc.scale(dpr, dpr);
        this.info = drawTitleStill(sc, w, h);
        this.still = st;
        this.flakes = makeFlakes(w < 600 ? 50 : 90, w, h);
      }
      const c = this.art.getContext('2d')!;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
      this.last = now;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.still!, 0, 0);
      c.scale(dpr, dpr);
      drawTitleLive(c, w, h, this.info!, now);
      drawFlakes(c, this.flakes, w, h, dt, now);
      this.raf = requestAnimationFrame(frame);
    };
    this.last = 0;
    this.raf = requestAnimationFrame(frame);
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
  /** 一句说明（悬停/点一下在面板下方显示）；没有就只显示名字和成绩 */
  desc?: string;
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
    const pick = (e: Event): void => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.yx-cell');
      if (el) this.detail(Number(el.dataset.i));
    };
    this.root.addEventListener('mouseover', pick);
    this.root.addEventListener('click', pick);
    this.root.addEventListener('focusin', pick);
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  /** sets：凑成的套装说明（"剑 2 件 · 暴击 +8%"） */
  show(build: BuildRow[], left: number, sets: string[] = []): void {
    this.rows = build;
    const cell = (r: BuildRow, i: number): string =>
      `<button type="button" class="yx-cell${r.level > 8 ? ' evo' : r.level === 8 ? ' max' : ''}" data-i="${i}" aria-label="${esc(r.name)}"><img alt="" src="${this.icons(r.icon)}"><em>${r.level > 8 ? '进' : r.level === 8 ? '满' : r.level}</em></button>`;
    const weapons = build.map((r, i) => (r.dmg >= 0 ? cell(r, i) : '')).join('');
    const passives = build.map((r, i) => (r.dmg < 0 ? cell(r, i) : '')).join('');
    this.root.innerHTML =
      '<div class="yx-panel yx-pause-panel">' +
      `<div class="yx-panel-head"><b class="yx-brush">暂停</b><em>离天亮 ${mmss(left)}</em></div>` +
      '<div class="yx-pause-body">' +
      '<div class="yx-build">' +
      `<div class="yx-bline"><label>法器</label><div class="yx-grid">${weapons || '<span class="yx-none">还没有</span>'}</div></div>` +
      `<div class="yx-bline"><label>被动</label><div class="yx-grid">${passives || '<span class="yx-none">还没有</span>'}</div></div>` +
      (sets.length ? `<div class="yx-sets">${sets.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '') +
      `<div class="yx-bdetail">悬停或点一下图标，看说明</div>` +
      '</div>' +
      `<div class="yx-pause-side"><div class="yx-toggles">${togglesHtml(this.toggles)}</div>` +
      '<button type="button" class="yx-big yx-resume" data-a="resume">继续</button>' +
      '<div class="yx-row2"><button type="button" class="yx-big ghost" data-a="quit">认输</button><button type="button" class="yx-big ghost" data-a="home">回大厅</button></div>' +
      '</div></div></div>';
    this.root.style.display = '';
  }

  private rows: BuildRow[] = [];

  /** 图标下面那一行详情 */
  private detail(i: number): void {
    const r = this.rows[i];
    const el = this.root.querySelector<HTMLElement>('.yx-bdetail');
    if (!r || !el) return;
    const lv = r.level > 8 ? '已进化' : r.level === 8 ? '满级' : `Lv ${r.level}`;
    const score = r.dmg >= 0 ? ` · ${Math.round(r.dmg).toLocaleString('zh-CN')} 伤 · ${r.kills} 斩` : '';
    el.innerHTML = `<b>${esc(r.name)}</b> ${lv}${score}${r.desc ? `<br><span>${esc(r.desc)}</span>` : ''}${r.hint ? `<br><i>${esc(r.hint)}</i>` : ''}`;
    for (const c of this.root.querySelectorAll<HTMLElement>('.yx-cell')) c.classList.toggle('sel', c.dataset.i === String(i));
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

/** 结算页上的一件宝物 */
export interface RaidItemView {
  /** 图集帧名（treasureIconKey(def.icon)），页面用 icons() 换成图 */
  icon: string;
  name: string;
  tier: TreasureTier;
  value: number;
  /** 这一局第一次收藏到（藏宝阁新点亮） */
  fresh?: boolean;
}

/** 夜探的结果（ResultView.raid 有就按夜探排版） */
export interface RaidResultView {
  outcome: 'escaped' | 'dead' | 'lost';
  /** 教学镇：死了、迷失也不丢包 */
  teach: boolean;
  /** 带出来的、丢在镇里的宝物 */
  kept: RaidItemView[];
  lost: RaidItemView[];
  /** 带出的宝物总价值（铜钱） */
  value: number;
}

export interface ResultView {
  won: boolean;
  quit: boolean;
  bossKilled: boolean;
  seconds: number;
  kills: number;
  level: number;
  coins: number;
  /** 档位那一行写什么（比如"危险 2"） */
  label: string;
  /** 实盘：结回的那一行（结回还没回来时先写"正在结回"，回来了用 setLive 换） */
  live?: string;
  record: boolean;
  build: BuildRow[];
  /** 可选：结算后铜钱总数（本局的 coins 已加进去）。有就画"飞进总数"的动画，没有就只显示本局收获 */
  coinsTotal?: number;
  /** 可选：本局的目标时长（秒），默认 900；用于"离天亮还差" */
  dawnSeconds?: number;
  /** 夜探：有就按夜探排版（won 填"撤出了"；seconds 是在镇里待了多久；coins 填这一局到手的铜钱，已含宝物换的） */
  raid?: RaidResultView;
}

export class Result {
  readonly root: HTMLDivElement;
  private readonly icons: (k: string) => string;
  onAgain: () => void = () => undefined;
  onMenu: () => void = () => undefined;
  /** 分享这一局：有才显示按钮（实盘局不给）；show 之前设好 */
  onShare: (() => void) | null = null;

  constructor(parent: HTMLElement, icons: (k: string) => string) {
    this.root = layer(parent, 'yx-result');
    this.icons = icons;
    onAction(this.root, {
      again: () => this.onAgain(),
      menu: () => this.onMenu(),
      share: () => this.onShare?.(),
      home: () => {
        location.href = '/';
      },
    });
  }

  /** 实盘结回的结果回来了：换掉那一行 */
  setLive(text: string): void {
    const el = this.root.querySelector('.yx-rlive');
    if (el) el.textContent = text;
  }

  /** 交分、存录像的结果：结算面板最下面一行小字（同一局只留一行，后来的替换先前的） */
  setNote(text: string): void {
    const panel = this.root.querySelector('.yx-result-panel');
    if (!panel) return;
    let el = panel.querySelector<HTMLElement>('.yx-rnote');
    if (!el) {
      el = document.createElement('div');
      el.className = 'yx-rnote';
      panel.append(el);
    }
    el.textContent = text;
  }

  /** 夜探的右半边：带出的宝物（按档上色的格子），丢在镇里的灰着排在后面 */
  private raidItems(rr: RaidResultView): string {
    const cell = (it: RaidItemView, lost: boolean): string =>
      `<div class="yx-item t-${it.tier}${lost ? ' lost' : ''}${it.fresh ? ' fresh' : ''}" title="${esc(it.name)} · ${it.value}"><img alt="" src="${this.icons(it.icon)}"><span>${esc(it.name)}</span><em>${it.value}</em>${it.fresh ? '<i>新</i>' : ''}</div>`;
    const kept = rr.kept.map((it) => cell(it, false)).join('');
    const lost = rr.lost.map((it) => cell(it, true)).join('');
    const headKept = rr.outcome === 'escaped' || rr.teach ? `带出 ${rr.kept.length} 件 · 值 ${rr.value} 铜钱` : '';
    return (
      '<div class="yx-rbuild yx-ritemsbox">' +
      (kept ? `<label>${headKept}</label><div class="yx-ritems">${kept}</div>` : `<label>${rr.outcome === 'escaped' ? '背包是空的' : '什么也没带出来'}</label>`) +
      (lost ? `<label>丢在镇里 ${rr.lost.length} 件</label><div class="yx-ritems">${lost}</div>` : '') +
      '</div>'
    );
  }

  show(r: ResultView): void {
    const rr = r.raid;
    const title = rr
      ? rr.outcome === 'escaped'
        ? '撤出了'
        : rr.outcome === 'lost'
          ? '迷失了'
          : '倒下了'
      : r.won
        ? r.bossKilled
          ? '尸王伏诛'
          : '天亮了'
        : r.quit
          ? '收工'
          : '倒下了';
    const dawn = r.dawnSeconds ?? 900;
    const sub = rr
      ? rr.outcome === 'escaped'
        ? '平平安安走出了镇子'
        : rr.teach
          ? '教学镇不丢包，东西照样带出来'
          : rr.outcome === 'lost'
            ? '天亮时还在镇里，背包丢了'
            : '背包丢在了镇里'
      : r.won
        ? r.bossKilled
          ? '打倒尸王，天提前亮了'
          : '撑过了一整夜'
        : r.seconds >= dawn
          ? `天亮后又撑了 ${mmss(r.seconds - dawn)}`
          : `离天亮还差 ${mmss(dawn - r.seconds)}`;
    const fmt = (n: number): string => Math.round(n).toLocaleString('zh-CN');
    const weapons = r.build.filter((b) => b.dmg >= 0).sort((a, b) => b.dmg - a.dmg);
    const top = Math.max(1, ...weapons.map((b) => b.dmg));
    const best = weapons[0] && weapons[0].dmg > 0 ? weapons[0] : null;
    const rows = weapons
      .map(
        (b, i) =>
          `<div class="yx-rrow${i === 0 && best ? ' top' : ''}"><img alt="" src="${this.icons(b.icon)}"><b>${esc(b.name)}</b><div class="yx-rbar"><i style="width:${Math.max(3, Math.round((100 * b.dmg) / top))}%;animation-delay:${0.25 + i * 0.08}s"></i></div><span>${fmt(b.dmg)}</span></div>`,
      )
      .join('');
    const passives = r.build
      .filter((b) => b.dmg < 0)
      .map((b) => `<span class="yx-rpass"><img alt="" src="${this.icons(b.icon)}"><em>${b.level}</em></span>`)
      .join('');
    const total = r.coinsTotal;
    const coinImg = this.icons('coin');
    const coinRow = r.live !== undefined
      ? `<div class="yx-rlive">${esc(r.live)}</div>`
      : total !== undefined
        ? `<div class="yx-rcoins"><span class="yx-gain"><img alt="" src="${coinImg}">+${fmt(r.coins)}</span><span class="yx-arrow">→</span><span class="yx-tot"><img alt="" src="${coinImg}"><b data-from="${Math.max(0, total - r.coins)}" data-to="${total}">${fmt(Math.max(0, total - r.coins))}</b><small>铜钱</small></span>${Array.from({ length: 6 }, (_, i) => `<img class="yx-fly" alt="" src="${coinImg}" style="--i:${i}">`).join('')}</div>`
        : '';
    this.root.innerHTML =
      `<div class="yx-panel yx-result-panel${r.won ? ' won' : ''}${rr ? ' raid' : ''}">` +
      `<div class="yx-rhead"><b class="yx-brush">${title}</b><div class="yx-rtags"><em>${esc(r.label)}</em>${r.record ? '<strong class="yx-record">新纪录</strong>' : ''}${this.onShare ? '<button type="button" class="yx-btn yx-rshare" data-a="share">分享</button>' : ''}</div></div>` +
      '<div class="yx-rmain">' +
      '<div class="yx-rleft">' +
      `<div class="yx-rtime"><span>${rr ? '在镇里' : '撑了'}</span><b>${mmss(r.seconds)}</b><small>${sub}</small></div>` +
      '<div class="yx-rstats">' +
      `<div><b>${r.kills.toLocaleString('zh-CN')}</b><span>斩</span></div>` +
      `<div><b>${r.level}</b><span>级</span></div>` +
      (total === undefined ? `<div><b>${r.coins.toLocaleString('zh-CN')}</b><span>铜钱</span></div>` : '') +
      '</div>' +
      (best && !rr ? `<div class="yx-rbest"><img alt="" src="${this.icons('ui_medal')}"><div><small>本局最强</small><b>${esc(best.name)}</b><span>${fmt(best.dmg)} 伤 · ${best.kills} 斩</span></div></div>` : '') +
      '</div>' +
      (rr ? this.raidItems(rr) : `<div class="yx-rbuild"><label>法器伤害</label>${rows}${passives ? `<div class="yx-rpasses">${passives}</div>` : ''}</div>`) +
      '</div>' +
      coinRow +
      '<div class="yx-row3">' +
      '<button type="button" class="yx-big ghost" data-a="home">大厅</button>' +
      `<button type="button" class="yx-big ghost" data-a="menu">${rr ? '回菜单' : '换难度'}</button>` +
      '<button type="button" class="yx-big yx-again" data-a="again">再来一局</button>' +
      '</div></div>';
    this.root.style.display = '';
    // 铜钱总数从"加之前"数到"加之后"，和飞币动画同步
    const num = this.root.querySelector<HTMLElement>('.yx-tot b');
    if (num) {
      const from = Number(num.dataset.from);
      const to = Number(num.dataset.to);
      const t0 = performance.now() + 700;
      const tick = (now: number): void => {
        if (!num.isConnected) return;
        const k = Math.max(0, Math.min(1, (now - t0) / 800));
        num.textContent = fmt(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
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
