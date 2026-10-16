/**
 * 大厅的点按声（0.10.26）：按下按钮、链接时一声很轻的"嗒"，WebAudio 现场合成，不下载音频文件。
 * 可以关（页脚的"声音"），关掉记在 localStorage 的 `arcade.sound`（平台的 key 加 arcade. 前缀）。
 * 关着的时候连 AudioContext 都不建，保证一点声音都不出；开着时也等第一次按下才建（手机浏览器要用户先碰一下屏幕才放声音）。
 * 只有大厅这边有：游戏页是整页跳过去的，各游戏有自己的声音和开关。
 */
const KEY = 'arcade.sound';
const listeners = new Set<() => void>();
let on = readPref();
let ctx: AudioContext | null = null;

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    // 隐私模式等用不了 localStorage：照默认开着，只是记不住
    return true;
  }
}

export const soundOn = () => on;

/** 给 useSyncExternalStore 用 */
export function subscribeSound(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function setSoundOn(next: boolean) {
  try {
    if (next) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // 记不住就算了，这一页里照样按选的来
  }
  on = next;
  if (!next) {
    void ctx?.close();
    ctx = null;
  }
  for (const f of listeners) f();
  // 刚打开时响一声高一点的，让人知道开了
  if (next) tap(true);
}

/** 一声"嗒"：正弦波从高往低滑一点，50 毫秒左右收住 */
function tap(confirm = false) {
  if (!on) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const [from, to, len] = confirm ? [880, 1320, 0.12] : [700, 420, 0.05];
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + len);
  gain.gain.setValueAtTime(0.0001, t);
  // 音量压得很低：只是手指下的一点反馈，不吵
  gain.gain.exponentialRampToValueAtTime(confirm ? 0.05 : 0.035, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

/** 整页只挂一个监听：按下能点的东西（没禁用的按钮、链接、折叠标题）就响一声 */
export function installTapSound() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!on || e.button !== 0) return;
      const el = (e.target as Element | null)?.closest('a[href], button:not(:disabled), summary');
      // 声音开关自己在打开时响确认的那一声
      if (el && !el.closest('[data-sound-toggle]')) tap();
    },
    { capture: true, passive: true },
  );
  // 触屏的按下不算"用户碰过页面"，手机上第一声可能放不出来；抬起时把声音通道叫醒，下一次就有了
  document.addEventListener('pointerup', () => void (ctx?.state === 'suspended' && ctx.resume()), { capture: true, passive: true });
}
