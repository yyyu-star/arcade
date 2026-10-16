/**
 * "添加到主屏幕玩更大"：只在 iOS Safari（不是已经从主屏幕打开的）标题页左下角露一条，点 ✕ 关掉后不再出现。
 * Safari 横屏时地址栏和标签栏占掉一截高度，从主屏幕打开是全屏，牌桌能大一圈。
 */
import { isIOSSafari, isStandalone } from './device.ts';
import { KEYS, rawStore } from './store.ts';
import { mountThemeCss } from './theme.ts';

const SHARE = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M6 11H4.8v9.6h14.4V11H18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let el: HTMLElement | null = null;

function eligible(): boolean {
  return isIOSSafari() && !isStandalone() && rawStore.read(KEYS.a2hs) !== 1;
}

function mount(): HTMLElement {
  mountThemeCss();
  const style = document.createElement('style');
  style.textContent = `
#a2hs { position: fixed; z-index: 8000; left: max(var(--gd-s3), env(safe-area-inset-left, 0px)); bottom: max(var(--gd-s3), env(safe-area-inset-bottom, 0px));
  display: none; align-items: center; gap: var(--gd-s3); padding: var(--gd-s1) var(--gd-s1) var(--gd-s1) var(--gd-s4); border-radius: var(--gd-r-pill); background: rgba(43, 22, 10, 0.88);
  border: 2px solid var(--gd-gold); color: #ffe9c2; font: bold 15px/1.3 var(--gd-font); }
#a2hs.on { display: flex; }
#a2hs small { display: flex; align-items: center; gap: var(--gd-s1); font-weight: normal; color: #e8d6b4; font-size: 13px; }
#a2hs .gd-btn { width: var(--gd-hit); padding: 0; border-radius: var(--gd-r-pill); background: #6b3f20; color: #ffe9c2; font-size: 18px; }`;
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.id = 'a2hs';
  box.innerHTML = `<span>添加到主屏幕玩更大<small>点分享 ${SHARE} →「添加到主屏幕」</small></span><button type="button" class="gd-btn" aria-label="关掉">✕</button>`;
  box.querySelector('button')!.addEventListener('click', () => {
    rawStore.write(KEYS.a2hs, 1);
    box.classList.remove('on');
  });
  document.body.appendChild(box);
  return box;
}

/** 标题页进来时 true、离开时 false；不符合条件或关掉过就什么都不做 */
export function showA2hs(on: boolean): void {
  if (on && !eligible()) return;
  if (!el) {
    if (!on) return;
    el = mount();
  }
  el.classList.toggle('on', on);
}
