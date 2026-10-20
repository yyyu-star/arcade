/**
 * 选桌页：挑赛道（带小地图）、圈数、几辆车、电脑强弱；单机开跑、开好友房、输房间号进房、接着上一场；新手教程（第一次来的人旁边冒个气泡）。
 */
import { LEVELS, type Level, type Opts } from '../core/types.ts';
import { FIXED } from '../track/fixed.ts';
import { MAP_DEFS, mapArt } from './mapart.ts';
import { coachFaceSvg } from './coachart.ts';
import { button, el } from './dom.ts';
import { GAME_NAME, LEVEL_NAME } from './text.ts';

export interface LobbyHooks {
  opts: Opts;
  canResume: boolean;
  /** 从平台大厅"好友房"进来：把开房、进房摆在最前面 */
  friends: boolean;
  /** 独立部署（没有平台账号）时的昵称输入；平台模式是 null */
  nickname: { value: string; onChange(name: string): void } | null;
  /** 没来过新手教程（没有 racing.tutorial）：教程按钮旁冒"第一次来？" */
  firstTime: boolean;
  onTutorial(): void;
  onSolo(o: Opts): void;
  onResume(): void;
  onRoom(o: Opts): void;
  onJoin(code: string): void;
  onRules(): void;
}

/** 赛道小图：和比赛里同一块地图板（不画细节），框住整块板子 */
function miniMap(parent: HTMLElement, id: string): void {
  const t = FIXED.find((x) => x.id === id)!;
  const art = mapArt(t);
  const b = art.board;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${b.x - 12} ${b.y - 12} ${b.w + 32} ${b.h + 36}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  // 小图只有一百多像素宽：盾牌按全图的大小画
  svg.innerHTML = `<defs>${MAP_DEFS}</defs>${art.draw({ detail: false, rot: false })}${art.labels({ k: 0.45, rot: false, next: -1 })}`;
  parent.appendChild(svg);
}

export function renderLobby(parent: HTMLElement, h: LobbyHooks): void {
  parent.replaceChildren();
  const o: Opts = { ...h.opts };
  const wrap = el('div', 'lobby-wrap', parent);
  const head = el('div', 'lobby-head', wrap);
  el('h1', '', head, GAME_NAME);
  el('p', 'tag', head, '换挡出牌、热量、过弯、吸尾流的回合制赛车');
  button('pill', head, '规则', h.onRules);
  // 新手教程：一直在，随时能重玩；第一次来的人旁边冒一个气泡（点气泡也进教程）
  const tut = el('div', 'tut-entry', head);
  const tb = button('tut-btn', tut, '新手教程', h.onTutorial);
  // 阿驰的小头像（得意脸）：先在选桌页混个脸熟
  const mini = el('span', 'coach-mini');
  mini.innerHTML = coachFaceSvg('grin');
  tb.prepend(mini);
  if (h.firstTime) button('tut-hint', tut, '第一次来？先跟阿驰跑一圈 →', h.onTutorial);

  const tracks = el('div', 'tracks', wrap);
  const paint = (): void => {
    for (const b of tracks.querySelectorAll<HTMLElement>('.track-card')) b.classList.toggle('on', b.dataset.id === o.track);
    for (const b of wrap.querySelectorAll<HTMLElement>('[data-laps]')) b.classList.toggle('on', Number(b.dataset.laps) === o.laps);
    for (const b of wrap.querySelectorAll<HTMLElement>('[data-cars]')) b.classList.toggle('on', Number(b.dataset.cars) === o.cars);
    for (const b of wrap.querySelectorAll<HTMLElement>('[data-level]')) b.classList.toggle('on', b.dataset.level === o.level);
  };
  for (const t of FIXED) {
    const b = button('track-card', tracks, '', () => {
      o.track = t.id;
      o.laps = t.laps;
      paint();
    });
    b.dataset.id = t.id;
    miniMap(el('div', 'map', b), t.id);
    el('b', '', b, t.name);
    el('span', 'blurb', b, t.blurb);
    el('span', 'facts', b, `一圈 ${t.spaces} 格 · ${t.corners.length} 个弯 · 热量 ${t.heat}`);
  }

  const opts = el('div', 'opts', wrap);
  const row = (label: string, fill: (r: HTMLElement) => void): void => {
    const r = el('div', 'opt-row', opts);
    el('span', 'lbl', r, label);
    fill(r);
  };
  row('圈数', (r) => {
    for (const n of [1, 2, 3])
      button('seg', r, `${n} 圈`, () => {
        o.laps = n;
        paint();
      }).dataset.laps = String(n);
  });
  row('几辆车', (r) => {
    for (const n of [2, 3, 4, 5, 6])
      button('seg', r, String(n), () => {
        o.cars = n;
        paint();
      }).dataset.cars = String(n);
  });
  row('电脑', (r) => {
    for (const l of LEVELS)
      button('seg', r, LEVEL_NAME[l], () => {
        o.level = l as Level;
        paint();
      }).dataset.level = l;
  });

  const acts = el('div', 'lobby-acts', wrap);
  if (h.canResume) button('act soft', acts, '接着上一场', h.onResume);
  button('act go', acts, '单机开跑', () => h.onSolo({ ...o }));
  if (h.nickname) {
    const nick = h.nickname;
    const r = el('div', 'opt-row', opts);
    el('span', 'lbl', r, '昵称');
    const name = el('input', 'nick', r);
    name.placeholder = '不填就叫"游客"';
    name.maxLength = 12;
    name.value = nick.value;
    name.addEventListener('change', () => nick.onChange(name.value));
  }
  const friends = el('div', `friends${h.friends ? ' hot' : ''}`, wrap);
  button('act go', friends, '开好友房', () => h.onRoom({ ...o }));
  const input = el('input', 'code', friends);
  input.placeholder = '房间号';
  input.inputMode = 'numeric';
  input.maxLength = 6;
  button('act soft', friends, '进房', () => h.onJoin(input.value.trim()));
  el('p', 'note', wrap, '好友房：人不够电脑补位；开打后掉线由电脑代开，回来接着开。');
  el('p', 'version', wrap, `版本 ${__RACING_VERSION__}`);
  paint();
}
