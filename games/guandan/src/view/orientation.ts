/**
 * 手机竖屏时盖一层"请横过来"的提示（纯 CSS 媒体查询控制显隐，转过来自动消失）。
 * 左上角留一个"大厅"按钮：竖屏时牌桌整个被盖住，不放这里就回不去平台首页。
 */
import { mountThemeCss } from './theme.ts';

const QUERY = '(orientation: portrait) and (max-width: 820px)';

const ICON = `
<svg viewBox="0 0 160 140" width="160" height="140" aria-hidden="true">
  <g class="rh-phone">
    <rect x="52" y="14" width="56" height="100" rx="12" fill="#b3202a" stroke="#e0b45a" stroke-width="4"/>
    <rect x="59" y="25" width="42" height="74" rx="5" fill="#1f5a43"/>
    <rect x="64" y="40" width="16" height="22" rx="3" fill="#fff7e6"/>
    <rect x="76" y="46" width="16" height="22" rx="3" fill="#fff7e6"/>
    <text x="70" y="56" font-size="11" font-weight="bold" fill="#b3202a" font-family="Arial">A</text>
  </g>
  <path d="M128 38 A50 50 0 0 1 120 104" fill="none" stroke="#e0b45a" stroke-width="7" stroke-linecap="round"/>
  <path d="M110 98 L121 106 L127 93" fill="none" stroke="#e0b45a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const HOUSE = `<svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true"><path d="M14 28V55H50V28" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M7 31L32 10L57 31" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function mountRotateHint(onLobby: () => void): void {
  if (document.getElementById('rotate-hint')) return;
  mountThemeCss();
  const style = document.createElement('style');
  style.textContent = `
#rotate-hint { position: fixed; inset: 0; z-index: 9000; display: none; align-items: center; justify-content: center;
  flex-direction: column; gap: var(--gd-s4); background: radial-gradient(circle at 50% 40%, #2a6a50 0, var(--gd-felt-dark) 75%); color: var(--gd-gold-light);
  font: bold 22px/1.5 var(--gd-font); text-align: center; }
#rotate-hint span { font-size: 15px; font-weight: normal; color: #d8e8dc; }
#rotate-hint .rh-phone { transform-origin: 80px 64px; animation: rh-turn 2.4s ease-in-out infinite; }
@keyframes rh-turn { 0%, 18% { transform: rotate(0deg); } 52%, 80% { transform: rotate(90deg); } 100% { transform: rotate(0deg); } }
#rh-lobby { position: absolute; top: max(var(--gd-s3), env(safe-area-inset-top, 0px)); left: max(var(--gd-s3), env(safe-area-inset-left, 0px));
  border-radius: var(--gd-r-pill); border-color: var(--gd-gold); background: #6b3f20; color: #ffe9c2; font-size: 17px; }
@media ${QUERY} { #rotate-hint { display: flex; } }`;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'rotate-hint';
  el.innerHTML = `<button id="rh-lobby" class="gd-btn" type="button">${HOUSE}大厅</button>${ICON}<div>把手机横过来</div><span>牌桌是横的，横屏才排得下 27 张牌</span>`;
  el.querySelector('#rh-lobby')!.addEventListener('click', onLobby);
  document.body.appendChild(el);
}

/** 单独部署时"大厅"改叫"首页"（platform.ts）；提示层启动就挂上了，问完平台再改字 */
export function setRotateLobbyLabel(name: string): void {
  const b = document.getElementById('rh-lobby');
  if (b) b.innerHTML = `${HOUSE}${name}`;
}

