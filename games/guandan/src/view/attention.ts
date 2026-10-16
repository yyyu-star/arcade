/**
 * 轮到我时把人叫回来（好友房 0.6.0，单机 0.7.1 起也有）：手机振动一下；标签页在后台时标题闪"轮到你了"，切回来就停。
 * 后台时 Phaser 不跑、声音也停了（main.ts 挂起音频），所以标题闪由房间消息直接触发，不等画面播到那一步。
 */
const FLASH = '【轮到你了】';
let timer: ReturnType<typeof setInterval> | null = null;
let base = '';

export function vibrate(): void {
  try {
    // 用户还没点过页面时 Chrome 不让振，还会在控制台报错（单机开局电脑先出、轮到我时常碰到）：这时就不振
    const act = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (act && !act.hasBeenActive) return;
    navigator.vibrate?.(60);
  } catch {
    // 不支持就算了（iOS 没有）
  }
}

export function flashTitle(): void {
  if (timer !== null || typeof document === 'undefined' || !document.hidden) return;
  base = document.title;
  let on = false;
  timer = setInterval(() => {
    on = !on;
    document.title = on ? FLASH : base;
  }, 1000);
  document.title = FLASH;
  document.addEventListener('visibilitychange', onVisible);
}

/** 不再轮到我（超时被代打、离开房间）：停下、标题还原 */
export function stopFlash(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  document.title = base;
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible(): void {
  if (!document.hidden) stopFlash();
}
