/**
 * 全局错误兜底：未捕获的异常不留白屏，弹一个独立于 Phaser 的 DOM 面板：继续 / 重新载入 / 放弃存档重开。
 * 最近 20 条错误记在 localStorage（guandan.errors），方便排查。
 */
import { clearSave, rememberError } from './store.ts';
import { mountThemeCss } from './theme.ts';

let panel: HTMLElement | null = null;

function isNoise(message: string, filename?: string): boolean {
  if (filename && !filename.startsWith(location.origin) && !filename.startsWith('blob:')) return true;
  return /ResizeObserver loop|Script error\.?$/i.test(message);
}

export function showErrorPanel(err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  rememberError({ time: new Date().toISOString(), message: e.message, stack: e.stack ?? '', version: __APP_VERSION__ });
  if (panel) return;
  document.getElementById('boot')?.remove();
  const el = document.createElement('div');
  el.id = 'error-panel';
  el.innerHTML = `
    <div class="ep-card">
      <b>哎呀，出了点小问题</b>
      <span>进度已经自动保存，一般点"继续"就好。</span>
      <code></code>
      <div class="ep-row">
        <button type="button" class="gd-btn" data-act="go">继续</button>
        <button type="button" class="gd-btn" data-act="reload">重新载入</button>
        <button type="button" class="gd-btn gd-2" data-act="reset">放弃存档重开</button>
      </div>
    </div>`;
  (el.querySelector('code') as HTMLElement).textContent = e.message.slice(0, 200);
  el.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).getAttribute('data-act');
    if (act === 'go') {
      el.remove();
      panel = null;
    } else if (act === 'reload') location.reload();
    else if (act === 'reset') {
      clearSave();
      location.reload();
    }
  });
  document.body.appendChild(el);
  panel = el;
}

/** 关掉兜底面板（问题自己好了，比如 WebGL 画面恢复了） */
export function hideErrorPanel(): void {
  panel?.remove();
  panel = null;
}

export function installErrorHandler(): void {
  mountThemeCss();
  const style = document.createElement('style');
  style.textContent = `
#error-panel { position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center;
  background: rgba(10, 6, 4, 0.72); font: 16px/1.6 var(--gd-font); }
#error-panel .ep-card { max-width: 420px; margin: var(--gd-s4); padding: var(--gd-s6); border-radius: var(--gd-r-lg); background: var(--gd-paper);
  border: 5px solid var(--gd-wood); box-shadow: 0 0 0 2px var(--gd-gold) inset; color: var(--gd-ink); display: flex; flex-direction: column; gap: var(--gd-s3); }
#error-panel b { font-size: 22px; color: var(--gd-red); }
#error-panel code { font-size: 12px; color: var(--gd-muted); word-break: break-all; background: #f1e4c6; padding: var(--gd-s2); border-radius: var(--gd-r-sm); }
#error-panel .ep-row { display: flex; gap: var(--gd-s2); flex-wrap: wrap; }
#error-panel .gd-btn { flex: 1; min-width: 96px; }`;
  document.head.appendChild(style);
  window.addEventListener('error', (ev) => {
    if (isNoise(ev.message ?? '', ev.filename)) return;
    showErrorPanel(ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => showErrorPanel(ev.reason));
}
