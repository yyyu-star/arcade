/**
 * 关键时刻的特效（0.18.3，docs/art-v3.md 第 5 节）：赢牌的金币、全下的聚光、大锅的金边。
 * 都是一次性的临时节点，放完就删；不等它们放完牌局照走（画面不许卡住牌局，DESIGN.md 8.6）。
 * 时长按动画快慢缩放、封顶 1.5 秒（主线：大锅、全下别太长，快档更短）。只动 transform / opacity。
 * 省内存设备（根上的 .lowfx，scene.ts 判断）不放金币粒子，只留一下光。
 */
import type { Pt } from './layout.ts';

/** 正常速度下的时长；pace 是 TableView 的动画快慢（快档 0.55，减少动态效果 0.3） */
export const FX_MS = 1200;
const MAX_MS = 1500;

export const fxMs = (pace: number): number => Math.min(MAX_MS, Math.round(FX_MS * pace));

const lowFx = (): boolean => document.documentElement.classList.contains('lowfx');

/** 金币从赢家头像里迸出来、往上撒开再落下；big 时更多更远。down：顶上的座位往下（桌子那边）撒，不撒进顶栏 */
export function coinBurst(layer: HTMLElement, at: Pt, pace: number, big = false, down = false): void {
  const ms = fxMs(pace);
  if (ms <= 0 || lowFx()) return;
  const n = big ? 16 : 9;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'fx-coin';
    c.style.left = `${at.x}px`;
    c.style.top = `${at.y}px`;
    layer.appendChild(c);
    // 往上半圈撒开（-160° 到 -20°；down 是 20° 到 160°），远近、转几圈各不一样；画面层的随机不进规则，用 Math.random 没关系
    const a = (((down ? 20 : -160) + (140 * (i + Math.random() * 0.6)) / n) * Math.PI) / 180;
    const r = (big ? 90 : 60) + Math.random() * (big ? 70 : 40);
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    c.animate(
      [
        { transform: 'translate(-50%, -50%) translate(0, 0) rotateY(0) scale(.6)', opacity: 0 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotateY(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(-50%, -50%) translate(${dx * 1.15}px, ${dy + 40}px) rotateY(${spin}deg) scale(.9)`, opacity: 0 },
      ],
      { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)', delay: Math.random() * ms * 0.12 },
    ).finished.then(
      () => c.remove(),
      () => c.remove(),
    );
  }
}

/** 全下：整张桌子暗下去，聚光收在这个座位上，亮一下再散开 */
export function spotlight(layer: HTMLElement, at: Pt, pace: number): void {
  const ms = fxMs(pace);
  if (ms <= 0) return;
  const s = document.createElement('div');
  s.className = 'fx-spot';
  s.style.setProperty('--x', `${at.x}px`);
  s.style.setProperty('--y', `${at.y}px`);
  layer.appendChild(s);
  s.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out' }).finished.then(
    () => s.remove(),
    () => s.remove(),
  );
}

/** 大锅：舞台四边泛一圈金光 */
export function edgeGlow(layer: HTMLElement, pace: number): void {
  const ms = fxMs(pace);
  if (ms <= 0) return;
  const g = document.createElement('div');
  g.className = 'fx-glow';
  layer.appendChild(g);
  g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).finished.then(
    () => g.remove(),
    () => g.remove(),
  );
}
