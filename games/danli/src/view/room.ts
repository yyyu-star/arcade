/**
 * 准备房间（DESIGN.md 5.5，单机；设计稿 v2-room / v2-room-maps / v2-room-bot / v2-room-port）：
 * - 顶栏：大厅、"准备房间"、对阵 1v1 / 2v2 / 3v3、"上次的选择已记住"、静音；
 * - 左边对阵板：蓝队、黄队各一排位子，我固定在蓝队 1 号位，其余是电脑；点位子（铅笔）换人物、换武器；
 * - 右边面板三个页签：我的武器（8 张武器卡：攻防格子、范围、角度、一句话、特技"即将推出"）、地图（11 张卡片 + "随机"，往下滑）、
 *   给某个位子换（人物头像一排，同一只小动物一局只上一次，换成在场的那只就对调；武器一排）；
 * - 底下：现在的地图条和"开打！"。
 * 每改一处就回调 onChange（main.ts 存进 danli.prefs），下次进来还是这些。
 */
import { personaById, PERSONAS } from '../ai/personas.ts';
import { MAP_IDS, MAPS, type MapId } from '../core/maps.ts';
import { LOOKS, type Team } from '../core/types.ts';
import { WEAPON_IDS, WEAPONS, type Weapon, type WeaponId } from '../core/weapons.ts';
import { botSeats, setMyLook, setPersona, SIZES, type RoomConfig, type TeamSize } from '../room.ts';
import { LOOK_NAME, portrait } from './chars.ts';
import { el } from './dom.ts';
import { escapeHtml } from './hud.ts';
import { MAP_ART, MATERIALS } from './mapArt.ts';
import { TEAM_NAME } from './palette.ts';
import { Stage } from './stage.ts';
import { mapThumb } from './thumb.ts';
import { glyphIcon, weaponIcon } from './weaponArt.ts';

export interface RoomOpts {
  myName: string;
  homeText: string;
  homeUrl: string;
  cfg: RoomConfig;
  muted: boolean;
  onChange(cfg: RoomConfig): void;
  /** 点静音，回新的状态 */
  onMute(): boolean;
  onStart(cfg: RoomConfig): void;
}

export const BLAST_NAME = { small: '小', mid: '中', big: '大' } as const;

/** 武器卡上的一句话（拖鞋弹弓那句是策划定的：只能平射，打中很疼） */
const WEAPON_TIP: Record<WeaponId, string> = {
  steamer: '什么都能打，好上手',
  melon: '坑大，炸地最快',
  paddle: '耐打，能高能低',
  carrot: '中范围，角度偏高',
  rocket: '只能高抛，打得最疼',
  slipper: '只能平射，打中很疼',
  frisbee: '耐打，角度最宽',
  milktea: '防最高，最耐打',
};

/** 角度那一句：只能高抛 / 只能平射 / 一般 */
export function angleLine(w: Weapon): string {
  if (w.minAngle >= 60) return `只能 ${w.minAngle}–${w.maxAngle}° 高抛`;
  if (w.maxAngle <= 25) return `只能 ${w.minAngle}–${w.maxAngle}° 平射`;
  return `${w.minAngle}–${w.maxAngle}°`;
}

/** 编辑中的位子：'me' 或者电脑座位的序号（botSeats 的下标：0、1 是蓝队 2、3 号，2–4 是黄队 1–3 号） */
type Edit = 'me' | number;
type Tab = 'weapon' | 'map' | 'seat';

export const EMB = [
  '<svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" fill="#fff" stroke="#46291a" stroke-width="1.4"/></svg>',
  '<svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0,-7.5 2.1,-2.6 7.2,-2.3 3.3,1 4.5,6.1 0,3.3 -4.5,6.1 -3.3,1 -7.2,-2.3 -2.1,-2.6Z" fill="#fff" stroke="#46291a" stroke-width="1.4" stroke-linejoin="round"/></svg>',
];

export function renderRoom(host: HTMLElement, o: RoomOpts): Stage {
  let cfg = o.cfg;
  let muted = o.muted;
  let tab: Tab = 'weapon';
  let edit: Edit = 'me';
  const set = (next: RoomConfig): void => {
    cfg = next;
    o.onChange(cfg);
    stage.redraw();
  };

  const stage = new Stage(host, 'dl-room', (v) => {
    const L = v.layer;
    const port = v.port;
    const mapName = cfg.map === 'random' ? '随机地图' : MAPS[cfg.map].name;

    // 顶栏
    const bar = el('div', 'bar', L);
    const home = el('a', 'dl-btn dl-home', bar);
    home.href = o.homeUrl;
    home.append(glyphIcon('home', 17));
    el('span', '', home, o.homeText);
    el('span', 'ttl', bar, '准备房间');
    el('span', 'sp', bar);
    const seg = el('span', 'dl-seg');
    for (const n of SIZES) {
      const b = el('button', cfg.size === n ? 'on' : '', seg, `${n}v${n}`);
      b.dataset.size = String(n);
      b.setAttribute('aria-pressed', String(cfg.size === n));
      b.addEventListener('click', () => {
        // 换对阵时，编辑中的位子这一档用不到了就回到"我的武器"
        if (typeof edit === 'number' && !seatShown(edit, n as TeamSize)) {
          edit = 'me';
          tab = 'weapon';
        }
        set({ ...cfg, size: n as TeamSize });
      });
    }
    const note = el('span', 'note', undefined, '上次的选择已记住');
    if (!port) {
      bar.append(seg);
      el('span', 'sp', bar);
      bar.append(note);
    }
    const mute = el('button', 'dl-btn icon dl-mute', bar);
    mute.style.width = mute.style.height = '36px';
    const paintMute = (): void => {
      mute.replaceChildren(glyphIcon(muted ? 'mute' : 'sound', 20));
      mute.setAttribute('aria-label', muted ? '打开声音' : '静音');
      mute.classList.toggle('on', muted);
    };
    paintMute();
    mute.addEventListener('click', () => {
      muted = o.onMute();
      paintMute();
    });
    if (port) {
      const r2 = el('div', '', L);
      Object.assign(r2.style, { position: 'absolute', left: '12px', right: '12px', top: '56px', display: 'flex', alignItems: 'center', gap: '8px' });
      el('b', '', r2, '对阵').style.fontSize = '13px';
      r2.append(seg, el('span', 'sp'), note);
    }

    // 对阵板
    const board = el('div', 'board dl-card', L);
    Object.assign(board.style, port ? { left: '12px', right: '12px', top: '100px', height: '250px' } : { left: '12px', top: '56px', width: '384px', height: '262px' });
    const rowH = port ? '104px' : '96px';
    for (const team of [0, 1] as const) {
      if (team === 1) board.insertAdjacentHTML('beforeend', '<div class="vs"><i></i><b>VS</b><i></i></div>');
      const row = el('div', `row t${team}`, board);
      row.style.height = rowH;
      const side = el('div', 'side', row);
      side.innerHTML = `${EMB[team]}${TEAM_NAME[team]}`;
      if (team === 0) slot(row, 0, 'me');
      for (let k = 0; k < (team === 0 ? cfg.size - 1 : cfg.size); k++) slot(row, team, team === 0 ? k : 2 + k);
    }
    if (!port) {
      const n = el('div', 'note', board, '点位子上的铅笔：换人物、换武器');
      n.style.margin = '5px 0 0 28px';
    }

    // 右边（竖屏在下面）的面板
    const panel = el('div', 'panel', L);
    Object.assign(panel.style, port ? { left: '12px', right: '12px', top: '356px', height: '388px' } : { left: '404px', top: '52px', width: '428px', height: '268px' });
    const tabs = el('div', 'tabs', panel);
    const tabBtn = (t: Tab, label: string, small: string): void => {
      const b = el('button', tab === t ? 'on' : '', tabs);
      b.dataset.tab = t;
      b.innerHTML = `${escapeHtml(label)}${small ? `<small>${escapeHtml(small)}</small>` : ''}`;
      b.addEventListener('click', () => {
        tab = t;
        stage.redraw();
      });
    };
    if (tab === 'seat') tabBtn('seat', `给 ${seatName(edit)} 换`, seatLabel(edit));
    tabBtn('weapon', '我的武器', tab === 'seat' ? '' : WEAPONS[cfg.me.weapon].name);
    tabBtn('map', '地图', tab === 'seat' ? '' : mapName);
    const sheet = el('div', 'sheet dl-card', panel);
    if (tab === 'weapon') {
      const grid = el('div', 'wgrid', sheet);
      grid.style.gridTemplateColumns = `repeat(${port ? 2 : 3}, minmax(0, 1fr))`;
      for (const id of WEAPON_IDS) weaponCard(grid, id, cfg.me.weapon === id, () => set({ ...cfg, me: { ...cfg.me, weapon: id } }));
    } else if (tab === 'map') {
      const grid = el('div', 'wgrid mapgrid', sheet);
      grid.style.gridTemplateColumns = `repeat(${port ? 2 : 3}, minmax(0, 1fr))`;
      for (const id of MAP_IDS) mapCard(grid, id, cfg.map === id, () => set({ ...cfg, map: id }));
      randomCard(grid, cfg.map === 'random', () => set({ ...cfg, map: 'random' }));
    } else pick(sheet);
    sheet.scrollTop = tab === 'seat' ? 0 : pickedTop(sheet);

    // 底下：地图条、开打
    const foot = el('div', 'foot', L);
    Object.assign(foot.style, port ? { left: '12px', right: '12px', bottom: '14px', height: '76px', flexDirection: 'column', alignItems: 'stretch' } : { left: '12px', right: '12px', top: '326px', height: '56px' });
    if (!port) {
      const chip = el('button', 'mapchip', foot);
      if (cfg.map === 'random') {
        const d = el('span', '', chip);
        Object.assign(d.style, { width: '70px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff1d6', border: '1.5px solid #46291a', borderRadius: '6px' });
        d.append(glyphIcon('dice', 30, '#e2432a'));
      } else chip.append(mapThumb(cfg.map, 70, 38, false));
      const t = el('span', '', chip);
      t.innerHTML = cfg.map === 'random' ? `<b>随机地图</b><small>开打时才揭晓</small>` : `<b>${escapeHtml(mapName)}</b><small>${escapeHtml(MAP_ART[cfg.map].card.short)}</small>`;
      chip.addEventListener('click', () => {
        tab = 'map';
        stage.redraw();
      });
      el('span', 'sp', foot);
    }
    const go = el('button', 'dl-btn go fight dl-room-go', foot);
    if (port) go.style.height = '62px';
    else Object.assign(go.style, { width: '232px', height: '58px' });
    go.innerHTML = `开打！<small>${cfg.size}v${cfg.size}${port ? ` · ${escapeHtml(mapName)}` : ''} · 你是蓝队 1 号</small>`;
    go.addEventListener('click', () => o.onStart(cfg));
  });

  function seatShown(seat: number, size: TeamSize): boolean {
    return seat < 2 ? seat < size - 1 : seat - 2 < size;
  }
  function seatName(e: Edit): string {
    return e === 'me' ? '我' : personaById(botSeats(cfg)[e]!.persona)!.name;
  }
  function seatLabel(e: Edit): string {
    if (e === 'me') return `${TEAM_NAME[0]} 1 号位`;
    return e < 2 ? `${TEAM_NAME[0]} ${e + 2} 号位` : `${TEAM_NAME[1]} ${e - 1} 号位`;
  }

  /** 一个位子：头像、名字、你/电脑、武器条；点了在面板里换人物和武器 */
  function slot(row: HTMLElement, team: Team, e: Edit): void {
    const me = e === 'me';
    const seat = me ? null : botSeats(cfg)[e]!;
    const p = seat ? personaById(seat.persona)! : null;
    const look = me ? cfg.me.look : p!.look;
    const w = me ? cfg.me.weapon : seat!.weapon;
    const b = el('button', `dl-slot${me ? ' me' : ''}${tab === 'seat' && edit === e ? ' editing' : ''}`, row);
    b.dataset.seat = me ? 'me' : String(e);
    if (me) el('i', 'metag', b, '我');
    el('span', 'edit', b).append(glyphIcon('pencil', 14));
    const who = el('div', 'who', b);
    who.append(portrait(look, team, 38));
    const t = el('div', '', who);
    t.innerHTML = `<b>${escapeHtml(me ? o.myName : p!.name)}</b><small>${me ? `${LOOK_NAME[look]} · 你` : '电脑'}</small>`;
    const arm = el('div', 'arm', b);
    arm.append(weaponIcon(w, 20));
    el('span', '', arm, WEAPONS[w].name);
    b.addEventListener('click', () => {
      tab = 'seat';
      edit = e;
      stage.redraw();
    });
  }

  /** 给位子换：人物（我是换小动物）一排、武器一排、底下一句说明和"好了" */
  function pick(sheet: HTMLElement): void {
    const box = el('div', 'pick', sheet);
    const seats = botSeats(cfg);
    const me = edit === 'me';
    const seat = me ? null : seats[edit as number]!;
    const team: Team = me || (edit as number) < 2 ? 0 : 1;
    const curLook = me ? cfg.me.look : personaById(seat!.persona)!.look;
    const used = new Set([cfg.me.look, ...seats.map((s) => personaById(s.persona)!.look)]);
    box.insertAdjacentHTML('beforeend', `<h4>${me ? '小动物' : '人物'}<small>同一只小动物一局只上一次，点在场的就和它对调</small></h4>`);
    const faces = el('div', 'faces', box);
    for (const look of LOOKS) {
      const p = PERSONAS.find((x) => x.look === look)!;
      const f = el('button', look === curLook ? 'on' : used.has(look) ? 'used' : '', faces);
      f.dataset.look = look;
      f.dataset.persona = p.id;
      f.append(portrait(look, team, 40));
      el('span', '', f, LOOK_NAME[look]);
      f.addEventListener('click', () => set(me ? setMyLook(cfg, look) : setPersona(cfg, edit as number, p.id)));
    }
    const weaponNow = me ? cfg.me.weapon : seat!.weapon;
    const fav = me ? null : personaById(seat!.persona)!;
    box.insertAdjacentHTML('beforeend', `<h4>武器<small>${me ? '开局后不能换' : `电脑按性格挑的是${escapeHtml(WEAPONS[fav!.weapons[0]].name)}，你可以替它换`}</small></h4>`);
    const arms = el('div', 'arms', box);
    for (const id of WEAPON_IDS) {
      const a = el('button', id === weaponNow ? 'on' : '', arms);
      a.dataset.weapon = id;
      a.append(weaponIcon(id, 26));
      el('span', '', a, WEAPONS[id].short);
      a.title = WEAPONS[id].name;
      a.addEventListener('click', () => {
        if (me) set({ ...cfg, me: { ...cfg.me, weapon: id } });
        else {
          const mates = cfg.mates.map((s) => ({ ...s }));
          const foes = cfg.foes.map((s) => ({ ...s }));
          const k = edit as number;
          (k < 2 ? mates[k]! : foes[k - 2]!).weapon = id;
          set({ ...cfg, mates, foes });
        }
      });
    }
    const w = WEAPONS[weaponNow];
    const foot = el('div', 'pickfoot', box);
    const line = el('div', 'line', foot);
    line.innerHTML =
      `<b>${escapeHtml(me ? o.myName : fav!.name)}</b>：${escapeHtml(me ? `${LOOK_NAME[curLook]}的样子` : fav!.line)}<br>` +
      `${escapeHtml(w.name)}：攻 ${w.atk} 防 ${w.def} · ${BLAST_NAME[w.blast]}范围 · ${escapeHtml(angleLine(w))}`;
    el('button', 'dl-btn', foot, '好了').addEventListener('click', () => {
      tab = 'weapon';
      edit = 'me';
      stage.redraw();
    });
  }

  return stage;
}

/** 一张武器卡：攻防格子、范围、角度、一句话、特技（即将推出）；on 是选中的；choose 为 null 时只看不能点（好友房里不是自己的） */
export function weaponCard(parent: HTMLElement, id: WeaponId, on: boolean, choose: (() => void) | null): void {
  const w = WEAPONS[id];
  const b = el('button', `dl-wcard${on ? ' on' : ''}`, parent);
  b.dataset.weapon = id;
  b.setAttribute('aria-pressed', String(on));
  if (on) el('span', 'ok', b).append(glyphIcon('check', 13, '#fff'));
  const hd = el('div', 'hd', b);
  hd.append(weaponIcon(id, 28));
  el('b', '', hd, w.name);
  const pips = (n: number, cls: string): string => `<span class="pips ${cls}">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>`;
  b.insertAdjacentHTML(
    'beforeend',
    `<div class="st"><em>攻</em>${pips(w.atk, 'atk')}</div><div class="st"><em>防</em>${pips(w.def, 'def')}</div>` +
      `<div class="rg"><span>${BLAST_NAME[w.blast]}范围</span><span>${w.minAngle}–${w.maxAngle}°</span></div>` +
      `<div class="tip${id === 'slipper' ? ' hot' : ''}">${escapeHtml(WEAPON_TIP[id])}</div>` +
      `<div class="spc">${escapeHtml(w.special.name)}<i class="dl-tag soon">即将推出</i></div>`,
  );
  if (choose) b.addEventListener('click', choose);
  else b.disabled = true;
}

/** 一张地图卡：缩略图、名字、一句话、材质色、推荐人数，"快图""慢图"角标；choose 为 null 时只看（好友房里不是房主） */
export function mapCard(parent: HTMLElement, id: MapId, on: boolean, choose: (() => void) | null): void {
  const m = MAPS[id];
  const art = MAP_ART[id];
  const b = el('button', `dl-mapcard${on ? ' on' : ''}`, parent);
  b.dataset.map = id;
  if (on) el('i', 'dl-picked', b, '已选');
  if (art.card.tag) el('i', art.card.tag === '慢图' ? 'dl-fast slow' : 'dl-fast', b, art.card.tag);
  el('div', 'pic', b).append(mapThumb(id, 120, 40));
  el('b', '', b, m.name);
  el('p', '', b, art.card.short.replace(/^快图：/, ''));
  const ft = el('div', 'ft', b);
  const mats = el('span', 'mats', ft);
  for (const k of [...new Set(m.lands.map((l) => l.mat ?? m.material))].slice(0, 4)) el('i', '', mats).style.background = MATERIALS[k].grad[1];
  el('span', 'dl-tag', ft, art.card.players);
  b.title = art.card.feature;
  if (choose) b.addEventListener('click', choose);
  else b.disabled = true;
}

/** "随机"地图卡 */
export function randomCard(parent: HTMLElement, on: boolean, choose: (() => void) | null): void {
  const b = el('button', `dl-mapcard rnd${on ? ' on' : ''}`, parent);
  b.dataset.map = 'random';
  if (on) el('i', 'dl-picked', b, '已选');
  el('div', 'pic dice', b).append(glyphIcon('dice', 30, '#e2432a'));
  el('b', '', b, '随机');
  el('p', '', b, `从 ${MAP_IDS.length} 张里抽一张，开打时才揭晓`);
  const ft = el('div', 'ft', b);
  el('span', '', ft);
  el('span', 'dl-tag', ft, '1v1–3v3');
  if (choose) b.addEventListener('click', choose);
  else b.disabled = true;
}

/**
 * 打开页签停在顶部；选中的卡片在第一屏放不下，就滚到某一排的上沿（不停在卡片中间）：
 * 挑滚得到（不超过最大滚动量）、又能让选中的卡片整张露出来的最靠下的那一排
 */
export function pickedTop(sheet: HTMLElement): number {
  const sel = sheet.querySelector<HTMLElement>('.dl-wcard.on, .dl-mapcard.on');
  let top = 0;
  if (sel && sel.offsetTop + sel.offsetHeight + 8 > sheet.clientHeight) {
    const max = sheet.scrollHeight - sheet.clientHeight;
    const rows = [...new Set([...sheet.querySelectorAll<HTMLElement>('.dl-wcard, .dl-mapcard')].map((c) => c.offsetTop - 6))].sort((p, q) => p - q);
    top = sel.offsetTop - 6;
    for (const r of rows) if (r <= max && r <= sel.offsetTop - 6 && sel.offsetTop + sel.offsetHeight <= r + sheet.clientHeight) top = r;
  }
  return top;
}
