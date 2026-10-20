/**
 * 对局外的几个界面（DOM）：开始菜单、暂停（设置 + 本局法器）、结算、确认框、引导小提示。
 * 第一次打开只有一个大按钮（DESIGN.md 13.7：打开到开打 ≤ 30 秒）；玩过一局以后才出模式卡和难度。
 * 所有按钮 ≥ 44×44（tools/shot.ts 检查）；左上角常驻"大厅"，任何界面两步内回到大厅。
 */
import { MAP_IDS, MAP_UNLOCK, MAPS, type MapId } from '../../content/maps.ts';
import { drawMapThumb } from '../art/terrain.ts';
import { DANGER_IDS, DANGERS, type Danger } from '../../content/waves.ts';
import { CHARACTERS, CURSES, type CharacterId, type CurseId } from '../../content/meta.ts';
import { LIVE_MAX_BP, LIVE_TIER_IDS, LIVE_TIERS, liveMapOk, vigilBp, type LiveTier } from '../../content/live.ts';
import { RAID_LIVE, RAID_TEMPLATES, raidCharCoef, type RaidLiveTemplate, type RaidLiveTier, type RaidTemplateId } from '../../content/explore.ts';
import type { TreasureTier } from '../../content/treasures.ts';
import { RAID_REGIONS, VIGIL_REGIONS, type Region } from '../../content/regions.ts';
import type { Best, LastMode, RaidPick } from '../../platform/save.ts';
import { MONSTER_INFO } from './codex.ts';
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
  danger: Danger;
  /** 能选的最高危险档 */
  dangerOpen: Danger;
  best: Partial<Record<Danger, Best>>;
  map: MapId;
  /** 铜钱、角色、咒印（开局准备里改，这里只显示） */
  coins: number;
  character: CharacterId;
  /** 出战角色的头像（data URL） */
  charFace?: string;
  curses: CurseId[];
  /** 咒印开了没有（撑到过一次天亮） */
  cursesOpen: boolean;
  /** 实盘能不能选（有平台钱包）、上次是不是在实盘、选的档位 */
  live: { available: boolean; on: boolean; tier: LiveTier; offWhy?: string };
  /** 每张图开了没有（MAP_UNLOCK） */
  maps: Record<MapId, boolean>;
  /** 夜探：还没进过夜探（第一次固定教学镇，只有一个开始按钮） */
  raidFirst?: boolean;
  /** 夜探卡上"藏宝阁 3/45"那个按钮（没传就不显示） */
  vault?: { got: number; total: number };
  /** 上次开的模式、夜探选的镇子（主页"开始"一步直达用） */
  lastMode: LastMode;
  raidTpl: RaidPick;
  /** 图集里一帧画成小图（特色怪头像用） */
  mobIcon: (key: string, px?: number) => string;
}

/** 夜探卡能选的镇子（教学镇不在里面：第一次固定进） */
const RAID_PICK: readonly RaidPick[] = ['guzhen', 'dukou', 'shansi'];

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

/** 主视觉（月、灯笼、飘雪）：静底图画一次，动的（月晕、灯笼、飘雪）每帧叠；尺寸变了才重画底图。设备像素最多 2 倍（省内存设备同） */
class TitleArt {
  readonly canvas: HTMLCanvasElement;
  private raf = 0;
  private artSize = '';
  private still: HTMLCanvasElement | null = null;
  private info: ReturnType<typeof drawTitleStill> | null = null;
  private flakes: Flake[] = [];
  private last = 0;

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'yx-art';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    const frame = (now: number): void => {
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      if (w < 2 || h < 2) {
        this.raf = requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const sizeKey = `${w}x${h}@${dpr}`;
      if (sizeKey !== this.artSize) {
        this.artSize = sizeKey;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        const st = document.createElement('canvas');
        st.width = this.canvas.width;
        st.height = this.canvas.height;
        const sc = st.getContext('2d')!;
        sc.scale(dpr, dpr);
        this.info = drawTitleStill(sc, w, h);
        this.still = st;
        this.flakes = makeFlakes(w < 600 ? 50 : 90, w, h);
      }
      const c = this.canvas.getContext('2d')!;
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

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** 顶上的"大厅"按钮（两屏都有，回大厅两步内到） */
const HOME_BTN = `<button type="button" class="yx-btn yx-home" data-a="home" aria-label="回大厅">${HOME_SVG}</button>`;

const bestText = (b: Best | undefined): { big: string; small: string } =>
  !b ? { big: '还没玩过', small: '' } : { big: b.won ? '天亮了' : mmss(b.ticks / 30), small: `斩 ${b.kills.toLocaleString('zh-CN')}` };

// ───────────────────────── 主页 ─────────────────────────
/** 第一屏：标题 + 大"开始"（用上次的模式和地图，一步直达）+ 去选模式/地图 + 战绩小卡。第一次进来只有一个大按钮（13.7） */
export class Home {
  readonly root: HTMLDivElement;
  private readonly ui: HTMLDivElement;
  private readonly art: TitleArt;
  private readonly toggles: Toggle[];

  private readonly m: Menu;

  constructor(parent: HTMLElement, toggles: Toggle[], m: Menu) {
    this.m = m;
    this.root = layer(parent, 'yx-menu yx-homescreen');
    this.ui = document.createElement('div');
    this.ui.className = 'yx-menu-ui';
    this.art = new TitleArt(this.root);
    this.root.append(this.art.canvas, this.ui);
    this.toggles = toggles;
    onAction(this.root, {
      ...bindToggles(this.root, toggles),
      quick: () => this.m.quick(),
      select: () => this.m.openSelect(),
      settings: () => this.root.classList.toggle('show-settings'),
      codex: () => this.m.onCodex(),
      guide: () => this.m.onGuide(),
      boards: () => this.m.onBoards(),
      replays: () => this.m.onReplays(),
      daily: () => this.m.onDaily(),
      home: () => {
        location.href = '/';
      },
    });
    this.root.addEventListener('click', () => this.m.onClick());
  }

  get shown(): boolean {
    return this.root.style.display !== 'none';
  }

  show(s: MenuState): void {
    const top =
      HOME_BTN +
      `<button type="button" class="yx-btn yx-gear" data-a="settings" aria-label="设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-.1-1.3 2-1.6-2-3.4-2.4.9a8 8 0 0 0-2.2-1.3L15 2.8h-4l-.4 2.5a8 8 0 0 0-2.2 1.3L6 5.7 4 9.1l2 1.6L5.9 12l.1 1.3-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a8 8 0 0 0 2.2-1.3l2.4.9 2-3.4-2-1.6.1-1.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
      `<div class="yx-settings">${togglesHtml(this.toggles)}</div>` +
      '<div class="yx-more">' +
      '<button type="button" class="yx-btn" data-a="daily">每日</button>' +
      '<button type="button" class="yx-btn" data-a="boards">排行</button>' +
      '<button type="button" class="yx-btn" data-a="replays">回放</button>' +
      '<button type="button" class="yx-btn" data-a="codex">图鉴</button>' +
      '<button type="button" class="yx-btn" data-a="guide">玩法</button>' +
      '</div>';
    const title = '<div class="yx-title"><b>夜巡</b><span>道士夜巡雪夜古镇 · 撑到天亮</span></div>';
    // 新老玩家同一版主页（所有者 10-18：新手专用首屏只有"开始守夜"，找不到夜探和实盘）。
    // 新玩家的"上次选择"是存档默认值（守夜 · 雪原 · 危险 0），第一局的引导照旧由局里管
    {
      const d = Math.min(s.danger, s.dangerOpen) as Danger;
      const q = quickLive(s);
      const fun = s.lastMode === 'raid' && !s.raidFirst ? `夜探 · ${RAID_TEMPLATES[s.raidTpl].name} · 危险 ${d}` : s.lastMode === 'raid' ? '夜探 · 教学镇' : `守夜 · ${MAPS[s.maps[s.map] ? s.map : 'snow'].name} · 危险 ${d}`;
      // 上次是实盘：按钮上写清带入多少，一点就带入；开不了实盘就按娱乐开，并说为什么
      const plan = q ? `${q.raid ? `夜探${RAID_TEMPLATES[q.raid].name}` : `守夜${MAPS[s.maps[s.map] ? s.map : 'snow'].name}`} · ${LIVE_TIERS[q.tier].name}档 ${LIVE_TIERS[q.tier].stake.toLocaleString('zh-CN')}` : fun;
      const why = q || !s.live.on ? '' : `${quickOffWhy(s)}，这次按娱乐开`;
      const b = bestText(s.best[d]);
      this.ui.innerHTML =
        top +
        title +
        '<div class="yx-quick">' +
        `<button type="button" class="yx-big yx-go" data-a="quick"><span>${q ? '开始实盘' : '开始'}</span><small>${plan}</small></button>` +
        (why ? `<div class="yx-mwhy">${esc(why)}</div>` : '') +
        // 和"开始"一样大：守夜、夜探、实盘都从这里进
        `<button type="button" class="yx-big ghost yx-go yx-pick" data-a="select"><span>选模式</span><small>${s.live.available ? '守夜 · 夜探 · 实盘' : '守夜 · 夜探'}</small></button>` +
        '</div>' +
        '<div class="yx-stats">' +
        `<div><span>危险 ${d} 最好</span><b>${b.big}</b><small>${b.small}</small></div>` +
        `<div><span>铜钱</span><b><i class="yx-coin"></i>${s.coins.toLocaleString('zh-CN')}</b><small>${s.character === 'xiaodao' ? '' : CHARACTERS[s.character].name}</small></div>` +
        '</div>';
    }
    this.root.style.display = '';
    this.art.start();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.classList.remove('show-settings');
    this.art.stop();
  }
}

// ───────────────────────── 选模式 / 地图 ─────────────────────────
type Kind = 'vigil' | 'raid';

/** 第二屏：最上面娱乐 | 实盘（有钱包才出现），下面守夜 / 夜探两张模式卡，再是地图（或镇子）大卡；难度、角色加成、开始在右栏（窄屏在底部） */
export class Select {
  readonly root: HTMLDivElement;
  private readonly ui: HTMLDivElement;
  private readonly art: TitleArt;
  private kind: Kind = 'vigil';
  private diff: Danger = 0;
  private map: MapId = 'snow';
  private tpl: RaidPick = 'guzhen';
  private endless = false;
  private live: MenuState['live'] = { available: false, on: false, tier: 'small' };
  private s: MenuState | null = null;
  /** 从主页点进来时按存档重新取"上次的模式和地图"；在这一屏里点来点去、开角色页再回来不重置 */
  private fresh = true;

  private readonly m: Menu;

  constructor(parent: HTMLElement, m: Menu) {
    this.m = m;
    this.root = layer(parent, 'yx-menu yx-selscreen');
    this.ui = document.createElement('div');
    this.ui.className = 'yx-menu-ui';
    this.art = new TitleArt(this.root);
    this.root.append(this.art.canvas, this.ui);
    onAction(this.root, {
      back: () => this.m.show(this.s!, 'home'),
      home: () => {
        location.href = '/';
      },
      lv: (el) => {
        this.live = { ...this.live, on: el.dataset.m === 'live' };
        this.fixTier();
        this.m.onLiveMode(this.live.on, this.live.tier);
        this.render();
      },
      kind: (el) => {
        if (el.getAttribute('aria-disabled') === 'true') return;
        this.kind = el.dataset.k as Kind;
        this.fixTier();
        this.render();
      },
      tier: (el) => {
        this.live = { ...this.live, tier: el.dataset.t as LiveTier };
        this.m.onLiveMode(this.live.on, this.live.tier);
        this.render();
      },
      map: (el) => {
        if (el.getAttribute('aria-disabled') === 'true') return;
        this.map = el.dataset.m as MapId;
        this.render();
      },
      tpl: (el) => {
        this.tpl = el.dataset.t as RaidPick;
        this.render();
      },
      diff: (el) => {
        if (el.getAttribute('aria-disabled') === 'true') return;
        this.diff = Number(el.dataset.d) as Danger;
        this.render();
      },
      endless: () => {
        this.endless = !this.endless;
        this.render();
      },
      prep: (el) => this.m.onPrep(el.dataset.t as 'char' | 'curse' | 'perk'),
      vault: () => this.m.onVault(),
      go: () => this.go(),
    });
    this.root.addEventListener('click', () => this.m.onClick());
  }

  get shown(): boolean {
    return this.root.style.display !== 'none';
  }

  /** 从主页点进来：下次 show 按存档重取 */
  enter(): void {
    this.fresh = true;
  }

  /** 实盘里夜探只开 RAID_LIVE.open 里的档（豪华档只有守夜）：当前档开不了就换成第一个能开的 */
  private fixTier(): void {
    if (this.live.on && this.kind === 'raid' && !raidTierOk(this.live.tier) && RAID_LIVE.open.length) this.live = { ...this.live, tier: RAID_LIVE.open[0]! };
  }

  private go(): void {
    const s = this.s!;
    const live = this.live.available && this.live.on;
    if (this.kind === 'vigil') return live ? this.m.onLive(this.live.tier, this.map) : this.m.onStart(this.diff, this.map, this.endless);
    if (s.raidFirst) return this.m.onRaid('teach', 0);
    if (live) return raidTierOk(this.live.tier) ? this.m.onRaidLive(this.live.tier as RaidLiveTier, this.tpl) : undefined;
    this.m.onRaid(this.tpl, this.diff);
  }

  show(s: MenuState): void {
    this.s = s;
    this.live = s.live;
    if (this.fresh) {
      this.fresh = false;
      this.kind = s.lastMode === 'raid' && !s.raidFirst ? 'raid' : 'vigil';
      this.tpl = s.raidTpl;
      this.endless = false;
      this.diff = Math.min(s.danger, s.dangerOpen) as Danger;
      this.map = s.maps[s.map] ? s.map : 'snow';
      if (this.live.on && this.live.available) this.fixTier();
    }
    this.diff = Math.min(this.diff, s.dangerOpen) as Danger;
    if (!s.maps[this.map]) this.map = 'snow';
    this.render();
    this.root.style.display = '';
    this.art.start();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.art.stop();
  }

  private render(): void {
    const s = this.s!;
    const live = this.live.available && this.live.on;
    const raid = this.kind === 'raid';
    const keep = this.root.scrollTop;
    const esc2 = esc;
    const heads = (r: Region | undefined, names: boolean): string => {
      if (!r) return '<span class="yx-mobs"><em>只有常规怪</em></span>';
      const list = r.mobs.map((x) => ({ k: x.kind, n: MONSTER_INFO[x.kind].name }));
      return `<span class="yx-mobs">${list.map((x) => `<img class="yx-mob" alt="${esc2(x.n)}" title="${esc2(x.n)}" src="${s.mobIcon(x.k, 48)}">`).join('')}${names ? `<em>${list.map((x) => x.n).join('、')}</em>` : ''}</span>`;
    };
    const top = HOME_BTN + '<div class="yx-more"><button type="button" class="yx-btn" data-a="back" aria-label="返回主页">‹ 返回</button></div>';
    const lvSw = this.live.available
      ? `<div class="yx-chips yx-modesw yx-selfx"><button type="button" class="yx-chip${live ? '' : ' on'}" data-a="lv" data-m="fun"><b>娱乐</b><small>不花筹码</small></button><button type="button" class="yx-chip${live ? ' on' : ''}" data-a="lv" data-m="live"><b>实盘</b><small>带一份筹码</small></button></div>`
      : '';
    // 模式卡：实盘里夜探一档都没开就灰着
    const raidOff = live && RAID_LIVE.open.length === 0;
    const kinds =
      '<div class="yx-kinds">' +
      `<button type="button" class="yx-kind${raid ? '' : ' on'}" data-a="kind" data-k="vigil"><img class="yx-scene" alt="" src="${sceneUrl('watch', 320, 100)}"><span class="yx-kindtxt"><span class="yx-moon"></span><b>守夜</b><em>15 分钟 · 撑到天亮</em></span></button>` +
      `<button type="button" class="yx-kind${raid ? ' on' : ''}${raidOff ? ' locked' : ''}" data-a="kind" data-k="raid"${raidOff ? ' aria-disabled="true"' : ''}><img class="yx-scene" alt="" src="${sceneUrl('raid', 320, 100)}"><span class="yx-kindtxt"><span class="yx-lamp"></span><b>夜探</b><em>搜宝、打怪、找门撤离</em></span></button>` +
      '</div>';

    // 地图 / 镇子大卡
    // 实盘里还没配系数的新图灰着（选中的是它就退回雪原）
    if (live && !liveMapOk(this.map)) this.map = 'snow';
    const mapCards = MAP_IDS.map((id) => {
      const liveOff = live && !liveMapOk(id);
      const locked = !s.maps[id] || liveOff;
      const u = MAP_UNLOCK[id];
      const why = liveOff ? '实盘暂不开放' : u ? `${u.text}解锁` : '';
      return (
        `<button type="button" class="yx-mcard yx-mapcard${id === this.map ? ' on' : ''}${locked ? ' locked' : ''}" data-a="map" data-m="${id}"${locked ? ` aria-disabled="true" title="${why}"` : ''}>` +
        `<canvas class="yx-thumb" data-thumb="${id}" width="144" height="144" aria-hidden="true"></canvas>` +
        `<span class="yx-cardtxt"><b>${MAPS[id].name}</b>${id === 'yizhuang' || id === 'temple' ? '<i class="yx-hard">难</i>' : ''}` +
        (locked && why ? `<em class="yx-unlock">${LOCK_SVG}${why}</em>` : `<small>${MAPS[id].blurb}</small>${heads(VIGIL_REGIONS[id], true)}`) +
        '</span></button>'
      );
    }).join('');
    const townCards = RAID_PICK.map(
      (t) =>
        `<button type="button" class="yx-mcard yx-towncard${t === this.tpl ? ' on' : ''}" data-a="tpl" data-t="${t}"><span class="yx-cardtxt"><b>${RAID_TEMPLATES[t].name}</b><small>${RAID_TEMPLATES[t].blurb}</small>${heads(RAID_REGIONS[t], true)}</span></button>`,
    ).join('');
    const tierOn = (t: LiveTier): boolean => !raid || raidTierOk(t);
    const tiers = `<div class="yx-chips yx-tiers">${LIVE_TIER_IDS.map((t) => `<button type="button" class="yx-chip${t === this.live.tier ? ' on' : ''}${tierOn(t) ? '' : ' locked'}" data-a="tier" data-t="${t}"${tierOn(t) ? '' : ' disabled aria-disabled="true"'}><b>${LIVE_TIERS[t].name}</b><small>${LIVE_TIERS[t].stake.toLocaleString('zh-CN')}</small></button>`).join('')}</div>`;

    let pick: string;
    let opts = '';
    let note = '';
    let startLabel = raid ? '开始夜探' : '开始';
    let startOff = false;
    if (raid && s.raidFirst) {
      pick = `<div class="yx-raidnote"><b>${RAID_TEMPLATES.teach.name}</b>${RAID_TEMPLATES.teach.blurb}</div>`;
    } else if (live) {
      if (raid) {
        const t = this.live.tier;
        startOff = !raidTierOk(t);
        note = raidTierOk(t) ? raidLiveNote(t as RaidLiveTier, this.tpl, s.character) : '豪华档只有守夜；夜探先开小档';
        pick = `<div class="yx-pickgrid yx-towns">${townCards}</div>`;
      } else {
        note = `危险 ${LIVE_TIERS[this.live.tier].danger} · 不带加成和咒印<br>${liveNote(this.live.tier, s.character, this.map)}`;
        pick = `<div class="yx-pickgrid yx-maps" aria-label="地图">${mapCards}</div>`;
      }
    } else {
      pick = raid ? `<div class="yx-pickgrid yx-towns">${townCards}</div>` : `<div class="yx-pickgrid yx-maps" aria-label="地图">${mapCards}</div>`;
    }
    const charChip = `<button type="button" class="yx-chip yx-prep yx-prepchar" data-a="prep" data-t="char">${s.charFace ? `<img alt="" src="${s.charFace}">` : ''}<b>${CHARACTERS[s.character].name}</b><small>角色</small></button>`;
    if (!live) {
      const dangers = DANGER_IDS.map((d) => {
        const locked = d > s.dangerOpen;
        return `<button type="button" class="yx-chip yx-danger${d === this.diff ? ' on' : ''}${locked ? ' locked' : ''}" data-a="diff" data-d="${d}"${locked ? ' aria-disabled="true" title="撑到天亮解锁下一档"' : ''}><b>${d}</b><small>${locked ? LOCK_SVG : '★'.repeat(DANGERS[d].stars)}</small></button>`;
      }).join('');
      const curse = s.curses.length ? s.curses.map((c) => CURSES[c].name).join('') : '无';
      const prep =
        charChip +
        (s.cursesOpen && !raid ? `<button type="button" class="yx-chip yx-prep${s.curses.length ? ' hot' : ''}" data-a="prep" data-t="curse"><b>${curse}</b><small>咒印</small></button>` : '') +
        `<button type="button" class="yx-chip yx-prep" data-a="prep" data-t="perk"><b><span class="yx-coin"></span>${s.coins.toLocaleString('zh-CN')}</b><small>加成</small></button>`;
      const endless = s.cursesOpen && !raid ? `<button type="button" class="yx-chip yx-map${this.endless ? ' on' : ''}" data-a="endless"><b>无尽</b><small>天亮不收工</small></button>` : '';
      const dg = raid && s.raidFirst ? '' : `<div class="yx-chips yx-dangers" aria-label="危险档">${dangers}</div>`;
      const bt = bestText(s.best[this.diff]);
      const best = raid ? '' : `<div class="yx-best">${s.best[this.diff] ? `最好：${bt.big} · ${bt.small}` : `${DANGERS[this.diff].blurb} · 还没玩过`}</div>`;
      opts = `${dg}<div class="yx-chips">${prep}${endless}</div>${best}`;
    } else {
      // 档位、说明、开始排成一列：选多少 → 怎么算 → 开始
      // 实盘能换已解锁的角色和地图（各自有实盘系数，DESIGN 4.2a），加成、咒印不带
      opts = `${tiers}${raid && s.raidFirst ? '' : `<div class="yx-chips">${charChip}</div>`}<div class="yx-livenote">${note}</div>`;
    }
    const vault = raid && s.vault && !live ? `<button type="button" class="yx-chip yx-vaultbtn" data-a="vault"><b>藏宝阁</b><small>${s.vault.got} / ${s.vault.total}</small></button>` : '';
    const aside = `<div class="yx-aside"><div class="yx-opts">${opts}</div><div class="yx-startbar"><button type="button" class="yx-big" data-a="go"${startOff ? ' disabled' : ''}>${startLabel}</button>${vault}</div></div>`;

    this.ui.innerHTML = `${top}<div class="yx-sel">${lvSw}${kinds}<div class="yx-pickarea">${pick}</div>${aside}</div>`;
    for (const cv of this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]')) drawMapThumb(cv, MAPS[cv.dataset.thumb as MapId]);
    this.root.scrollTop = keep;
  }
}

/** 主页一键开的实盘：上次选了实盘、现在开得了，夜探还要过了教学镇、档位开着；否则 null（按娱乐开） */
function quickLive(s: MenuState): { tier: LiveTier; raid?: RaidLiveTemplate } | null {
  if (!s.live.on || !s.live.available) return null;
  if (s.lastMode !== 'raid') return { tier: s.live.tier };
  return !s.raidFirst && raidTierOk(s.live.tier) ? { tier: s.live.tier, raid: s.raidTpl } : null;
}

/** 上次选了实盘、这次却按娱乐开的原因（主页按钮下面那行字） */
function quickOffWhy(s: MenuState): string {
  if (!s.live.available) return s.live.offWhy ?? '现在开不了实盘';
  if (s.raidFirst) return '第一次夜探先走教学镇';
  return `夜探没有${LIVE_TIERS[s.live.tier].name}档`;
}

/** 夜探实盘能开的档（豪华档只有守夜；中、大档看 RAID_LIVE.open） */
function raidTierOk(t: LiveTier): boolean {
  return t !== 'luxe' && RAID_LIVE.open.includes(t);
}

// ───────────────────────── 开始菜单（两屏的总管） ─────────────────────────
/** 主页 → 选模式/地图 → 对局。对外的回调和以前的一页菜单一样，main.ts 只接线 */
export class Menu {
  onStart: (d: Danger, map: MapId, endless: boolean) => void = () => undefined;
  onBoards: () => void = () => undefined;
  onReplays: () => void = () => undefined;
  onDaily: () => void = () => undefined;
  /** 夜探开局：镇子（第一次是 'teach'）和危险档（教学镇固定 0；其余用选的档） */
  onRaid: (template: RaidTemplateId, danger: Danger) => void = () => undefined;
  /** 打开藏宝阁 */
  onVault: () => void = () => undefined;
  /** 实盘开局（档位定危险档；地图选的、角色用存档里的，不带加成和咒印）；fallback：主页一键开时带入失败，玩家选"按娱乐开"走这里 */
  onLive: (tier: LiveTier, map: MapId, fallback?: () => void) => void = () => undefined;
  /** 夜探实盘开局（档位、镇子；角色用存档里的，不带加成） */
  onRaidLive: (tier: LiveTier, template: RaidLiveTemplate, fallback?: () => void) => void = () => undefined;
  /** 切娱乐 / 实盘、换档位（main 记进存档） */
  onLiveMode: (on: boolean, tier: LiveTier) => void = () => undefined;
  /** 打开开局准备（角色、咒印、加成） */
  onPrep: (tab: 'char' | 'curse' | 'perk') => void = () => undefined;
  onClick: () => void = () => undefined;
  /** 图鉴和成就 */
  onCodex: () => void = () => undefined;
  onGuide: () => void = () => undefined;

  private readonly home: Home;
  private readonly select: Select;
  private screen: 'home' | 'select' = 'home';
  private state: MenuState | null = null;

  constructor(parent: HTMLElement, toggles: Toggle[]) {
    this.home = new Home(parent, toggles, this);
    this.select = new Select(parent, this);
  }

  get visible(): boolean {
    return this.home.shown || this.select.shown;
  }

  /** 显示哪一屏；不指定就回到上次停的那一屏（角色页、图鉴关掉后回到原处） */
  show(s: MenuState, to: 'home' | 'select' = this.screen): void {
    this.state = s;
    this.screen = to;
    if (to === 'home') {
      this.select.hide();
      this.home.show(s);
    } else {
      this.home.hide();
      this.select.show(s);
    }
  }

  hide(): void {
    this.home.hide();
    this.select.hide();
  }

  openSelect(): void {
    this.select.enter();
    this.show(this.state!, 'select');
  }

  /** 主页的"开始"：一步直达，按上次的完整选择（娱乐 / 实盘、模式、镇子或地图、档位）；实盘开不了或带入失败就按娱乐开 */
  quick(): void {
    const q = quickLive(this.state!);
    const fun = (): void => this.quickFun();
    if (!q) return fun();
    if (q.raid) this.onRaidLive(q.tier, q.raid, fun);
    else this.onLive(q.tier, this.state!.maps[this.state!.map] ? this.state!.map : 'snow', fun);
  }

  private quickFun(): void {
    const s = this.state!;
    const d = Math.min(s.danger, s.dangerOpen) as Danger;
    if (s.lastMode === 'raid') return this.onRaid(s.raidFirst ? 'teach' : s.raidTpl, d);
    this.onStart(d, s.maps[s.map] ? s.map : 'snow', false);
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
  onGuide: () => void = () => undefined;

  constructor(parent: HTMLElement, toggles: Toggle[], icons: (k: string) => string) {
    this.root = layer(parent, 'yx-pausescr');
    this.toggles = toggles;
    this.icons = icons;
    onAction(this.root, {
      ...bindToggles(this.root, toggles),
      resume: () => this.onResume(),
      home: () => this.onHome(),
      quit: () => this.onQuit(),
      guide: () => this.onGuide(),
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
      '<button type="button" class="yx-big ghost yx-pguide" data-a="guide">玩法说明</button>' +
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
  /** 本局铜钱的来源明细（按顺序显示）；让玩家看懂钱是怎么挣的，没有或为空就不显示 */
  sources?: { label: string; coins: number }[];
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
  /** 教学镇结算的「去大镇子」：直接开一局正式镇子 */
  onBigTown: () => void = () => undefined;
  /** 分享这一局：有才显示按钮（实盘局不给）；show 之前设好 */
  onShare: (() => void) | null = null;

  constructor(parent: HTMLElement, icons: (k: string) => string) {
    this.root = layer(parent, 'yx-result');
    this.icons = icons;
    onAction(this.root, {
      again: () => this.onAgain(),
      menu: () => this.onMenu(),
      big: () => this.onBigTown(),
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
    // 实盘：结回一行，局内铜钱照样存进账户（所有者 10-20），底下照常一行铜钱
    const coinRow = (r.live !== undefined ? `<div class="yx-rlive">${esc(r.live)}</div>` : '') +
      (total !== undefined
        ? `<div class="yx-rcoins"><span class="yx-gain"><img alt="" src="${coinImg}">+${fmt(r.coins)}</span><span class="yx-arrow">→</span><span class="yx-tot"><img alt="" src="${coinImg}"><b data-from="${Math.max(0, total - r.coins)}" data-to="${total}">${fmt(Math.max(0, total - r.coins))}</b><small>铜钱</small></span>${Array.from({ length: 6 }, (_, i) => `<img class="yx-fly" alt="" src="${coinImg}" style="--i:${i}">`).join('')}</div>`
        : '');
    const src = r.live === undefined && !rr && total !== undefined ? (r.sources ?? []).filter((x) => x.coins > 0) : [];
    const srcHtml = src.length
      ? `<div class="yx-rsrc${src.length > 6 ? ' two' : ''}">${src
          .map((x, i) => `<div style="animation-delay:${0.3 + i * 0.06}s"><img alt="" src="${coinImg}"><span>${esc(x.label)}</span><b>+${fmt(x.coins)}</b></div>`)
          .join('')}</div>`
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
      (rr?.teach ? '<div class="yx-livenote">下一局起是正式镇子：铜箱、金箱、巡夜将、镇门石兽守的宝库</div>' : '') +
      srcHtml +
      '<div class="yx-row3">' +
      '<button type="button" class="yx-big ghost" data-a="home">大厅</button>' +
      `<button type="button" class="yx-big ghost" data-a="menu">${rr ? '回菜单' : '换难度'}</button>` +
      (rr?.teach
        ? '<button type="button" class="yx-big yx-again" data-a="big">去大镇子</button>'
        : '<button type="button" class="yx-big yx-again" data-a="again">再来一局</button>') +
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

/** 实盘守夜的一句话说明：天亮、尸王各结回几份按这一档的 dawnBp 算（倍数按档拟合，四档不同） */
/** 夜探实盘的说明：危险档、多少价值算一份、上限 */
/** 夜探实盘说明：角色系数乘在算好的倍数上（settle.ts），这里把它折进"多少铜钱算 1 份"和保底里，写的就是这个角色实际拿到的 */
function raidLiveNote(tier: RaidLiveTier, tpl: RaidLiveTemplate, character: CharacterId): string {
  const c = raidCharCoef(character, tier, tpl) ?? 10_000;
  const base = Math.round((RAID_LIVE.base[tier][tpl] * 10_000) / c);
  const floor = Math.max(1, Math.floor(RAID_LIVE.floor[tier] * c) / 10_000);
  return `危险 ${RAID_LIVE.danger[tier]} · 不带加成<br>撤出来至少拿回 1 份，待满 ${RAID_LIVE.floorRamp[tier] / 1800} 分钟再撤保底 ${Number(floor.toFixed(2))} 份；带出 ${base.toLocaleString('zh-CN')} 铜钱的宝物算 1 份，最多 ${RAID_LIVE.cap} 份；没撤出这一份就没了`;
}

/** 守夜实盘说明：按选的角色、地图算（各有实盘系数） */
function liveNote(tier: LiveTier, character: CharacterId, map: MapId): string {
  const dawn = vigilBp(tier, 0, true, false, character, map);
  const boss = vigilBp(tier, 0, true, true, character, map);
  const f = (bp: number): string => String(Number((bp / 10_000).toFixed(2)));
  // 系数大的组合（义庄豪华档）天亮就到封顶：打不打倒尸王都一样，直说，免得以为还能多拿
  const top = dawn >= LIVE_MAX_BP ? `天亮就封顶 ${f(dawn)} 份` : `天亮 ${f(dawn)} 份，打倒尸王 ${f(boss)} 份`;
  return `撑过 3 分钟开始回钱，越久越多：${top}；最多输这一份`;
}
