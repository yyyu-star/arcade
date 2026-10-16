/**
 * 手机竖屏提示：触屏设备（pointer: coarse）竖着拿、且宽度小于 600 CSS 像素时，盖一层 DOM 提示「把手机横过来」；
 * 转成横屏后自动消失。纯 CSS 媒体查询控制显隐；风格与 0.3 的炒股小屋一致（暖色纸面、深梅子棕粗描边、橙色强调），
 * 插画先用内联 SVG（不依赖外部素材，素材没加载时也能显示）；真的要显示时再去取美术的 ui/rotate_phone.svg，
 * 取到了就换上（横屏设备上不会发这个请求）。
 */

const ID = 'rotate-hint';
const QUERY = '(orientation: portrait) and (max-width: 599.98px) and (pointer: coarse)';
const ART = 'assets/art/v3/ui/rotate_phone.svg';

/** 一部卡通手机（屏幕上是群聊气泡和一根红 K 线），旁边一道橙色旋转箭头；手机来回转动。 */
const ICON = `
<svg viewBox="0 0 160 140" width="168" height="147" aria-hidden="true">
  <ellipse cx="80" cy="128" rx="46" ry="7" fill="#3a2634" opacity="0.12" />
  <g class="rh-phone">
    <rect x="52" y="14" width="56" height="100" rx="12" fill="#ff7a33" stroke="#3a2634" stroke-width="4" />
    <rect x="59" y="25" width="42" height="74" rx="5" fill="#fff6e6" stroke="#3a2634" stroke-width="3" />
    <rect x="72" y="18" width="16" height="4" rx="2" fill="#3a2634" />
    <circle cx="80" cy="106" r="3.5" fill="#fff6e6" stroke="#3a2634" stroke-width="2" />
    <rect x="63" y="31" width="24" height="9" rx="4.5" fill="#ffe7a8" stroke="#3a2634" stroke-width="2" />
    <rect x="70" y="44" width="27" height="9" rx="4.5" fill="#d9f0ff" stroke="#3a2634" stroke-width="2" />
    <path d="M64 90 L71 80 L77 85 L86 70 L96 76" fill="none" stroke="#d8342c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <rect x="83" y="60" width="6" height="16" rx="1.5" fill="#d8342c" stroke="#3a2634" stroke-width="1.6" />
  </g>
  <path d="M128 38 A50 50 0 0 1 120 104" fill="none" stroke="#3a2634" stroke-width="9" stroke-linecap="round" />
  <path d="M128 38 A50 50 0 0 1 120 104" fill="none" stroke="#ffb03a" stroke-width="5" stroke-linecap="round" />
  <path d="M110 98 L121 106 L127 93" fill="none" stroke="#3a2634" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M110 98 L121 106 L127 93" fill="none" stroke="#ffb03a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

const CSS = `
#${ID} {
  position: fixed; inset: 0; z-index: 9000; display: none;
  align-items: center; justify-content: center; padding: 24px;
  background: #f3e2c7 radial-gradient(circle at 50% 38%, #fff3dc 0, #f3e2c7 70%);
  color: #3a2634; text-align: center;
  font: 16px/1.6 "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
}
#${ID} .rh-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  max-width: 320px; padding: 22px 22px 24px; border-radius: 22px;
  background: #fff6e6; border: 4px solid #3a2634; box-shadow: 0 6px 0 rgba(58, 38, 52, 0.25);
}
#${ID} b { font-size: 24px; letter-spacing: 2px; color: #c4501a; }
#${ID} span { color: #6e5966; font-size: 14px; }
#${ID} i {
  font-style: normal; font-size: 12px; font-weight: bold; color: #3a2634;
  background: #ffe7a8; border: 2px solid #3a2634; border-radius: 999px; padding: 1px 12px;
}
#${ID} .rh-phone { transform-origin: 80px 64px; animation: rh-turn 2.6s ease-in-out infinite; }
@keyframes rh-turn { 0%, 18% { transform: rotate(0deg); } 52%, 80% { transform: rotate(90deg); } 100% { transform: rotate(0deg); } }
#${ID} img.rh-art { width: 150px; height: 150px; animation: rh-bob 2.6s ease-in-out infinite; }
@keyframes rh-bob { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
#${ID} .rh-lobby, #${ID} .rh-ask button {
  font-family: inherit; font-size: 16px; font-weight: bold; line-height: 1; color: #3a2634; cursor: pointer;
  background: #fff6e6; border: 3px solid #3a2634; border-radius: 14px; box-shadow: 0 3px 0 rgba(58, 38, 52, 0.85);
  min-height: 48px; padding: 0 16px; display: inline-flex; align-items: center; gap: 6px;
}
#${ID} .rh-lobby { position: absolute; left: 14px; top: 14px; }
#${ID} .rh-lobby span { color: #3a2634; font-size: 16px; }
#${ID} .rh-ask { display: none; flex-direction: column; align-items: center; gap: 10px; }
#${ID} .rh-ask div { display: flex; gap: 12px; }
#${ID} .rh-ask button.rh-go { background: #ff7a33; color: #fff; }
#${ID}.asking .rh-ask { display: flex; }
@media ${QUERY} { #${ID} { display: flex; } }
@media (prefers-reduced-motion: reduce) { #${ID} .rh-phone { animation: none; transform: rotate(90deg); } #${ID} img.rh-art { animation: none; } }
`;

/** 小房子（大厅按钮上的图标） */
const HOUSE = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" fill="none" stroke="#3a2634" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 10v9.5h13V10" fill="#ff7a33" stroke="#3a2634" stroke-width="2.4" stroke-linejoin="round"/><rect x="10" y="13.5" width="4" height="6" fill="#fff6e6" stroke="#3a2634" stroke-width="1.8"/></svg>`;

/**
 * 竖屏提示左上角的「大厅」（0.5.8）：竖着拿手机时游戏画面被盖住，回大厅的入口放在这一层上。
 * inRun() 为真（一局进行中）时先在卡片里问一次（说明同 confirm），否则直接走。
 * confirm 每次问的时候现取：实盘局和娱乐局的说法不同（0.6.0）。
 */
interface RotateLobby {
  inRun: () => boolean;
  confirm: () => { title: string; body: string; ok: string };
  go: () => void;
}

/** 改左上角按钮的字（0.8.0 单独部署时叫「首页」）。还没挂载时什么都不做。 */
export function setRotateLobbyLabel(text: string): void {
  if (typeof document === 'undefined') return;
  const span = document.querySelector(`#${ID} .rh-lobby span`);
  if (span) span.textContent = text;
}

/** 挂载竖屏提示（重复调用无副作用）。 */
export function mountRotateHint(lobby?: RotateLobby): void {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = ID;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="rh-card">${ICON}<b>把手机横过来</b><span>小屋太宽，竖着放不下看板、持仓和群聊。<br>横过来，画面会自动铺满。</span><i>开盘 · 散户的一年</i></div>`;
  if (lobby) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rh-lobby';
    btn.innerHTML = `${HOUSE}<span>大厅</span>`;
    const ask = document.createElement('div');
    ask.className = 'rh-ask';
    const q = document.createElement('b');
    const why = document.createElement('span');
    why.style.whiteSpace = 'pre-line';
    const row = document.createElement('div');
    const stay = document.createElement('button');
    stay.type = 'button';
    stay.textContent = '留下';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'rh-go';
    const words = (): void => {
      const c = lobby.confirm();
      q.textContent = c.title;
      why.textContent = c.body;
      go.textContent = c.ok;
    };
    // 挂载时会话还没建好，问的时候才取说法
    row.append(stay, go);
    ask.append(q, why, row);
    el.querySelector('.rh-card')?.append(ask);
    btn.addEventListener('click', () => {
      if (lobby.inRun()) {
        words();
        el.classList.add('asking');
      } else lobby.go();
    });
    stay.addEventListener('click', () => el.classList.remove('asking'));
    go.addEventListener('click', () => lobby.go());
    el.prepend(btn);
  }
  document.body.appendChild(el);
  // 第一次需要显示时才取美术插画；取不到（或还没交）就一直用内联的
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  if (!mq) return;
  let tried = false;
  const upgrade = (): void => {
    if (tried || !mq.matches) return;
    tried = true;
    const img = new Image();
    img.className = 'rh-art';
    img.alt = '';
    img.onload = () => el.querySelector('.rh-card > svg')?.replaceWith(img);
    img.src = ART;
  };
  upgrade();
  mq.addEventListener?.('change', upgrade);
}
