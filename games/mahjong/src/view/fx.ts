/**
 * 胡、自摸、杠的大字加粒子（0.9.0「热闹一点」）。
 *
 * 为什么是纯 CSS 动画加几十个 span：牌桌是 DOM 渲染，没有 canvas；transform / opacity 动画走合成层，
 * 不碰 layout，也不用 filter，手机上不会卡。粒子的方向、时长用 CSS 变量传给样式，JS 只负责摆好和收尾。
 * 这里的随机只管好看，和规则无关（规则核心里才禁 Math.random）。
 */
import './fx.css';
import { el } from './dom.ts';
import { signed } from './text.ts';

export type CelebrateKind = 'hu' | 'zimo' | 'kan';

/** 每种效果的总时长（毫秒，要和 fx.css 里的动画时长一致）、粒子个数 */
const SPEC: Record<CelebrateKind, { ms: number; n: number }> = {
  hu: { ms: 1700, n: 16 },
  zimo: { ms: 1900, n: 26 },
  kan: { ms: 1500, n: 14 },
};

const GOLDS = ['#ffd35a', '#fff1b0', '#ffb02e', '#ffffff', '#ff8a3d'];
const WINDS = ['#e8fff4', '#bff0d8', '#ffffff'];

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** 用户系统设了"减少动态效果"时只留大字淡入淡出，不出粒子 */
const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 在 layer 里 (x, y) 处放一个大字加粒子；x、y 是设计像素（舞台缩放之前），播完自己移除全部节点 */
export function celebrate(layer: HTMLElement, x: number, y: number, text: string, kind: CelebrateKind): void {
  const { ms, n } = SPEC[kind];
  const box = el('div', `celeb ${kind}`, layer);
  box.style.left = `${Math.round(x)}px`;
  box.style.top = `${Math.round(y)}px`;
  el('div', 'celeb-text', box, text);

  if (!reduced()) {
    for (let i = 0; i < n; i++) {
      const p = el('i', 'celeb-p', box);
      const s = p.style;
      if (kind === 'kan') {
        // 风的弧线：从左往右划过去，中间拱起来；长条形，像风带起的草叶
        const side = i % 2 ? 1 : -1;
        s.setProperty('--x0', `${side * rnd(70, 110)}px`);
        s.setProperty('--x1', `${-side * rnd(70, 110)}px`);
        s.setProperty('--y0', `${rnd(-50, 50)}px`);
        s.setProperty('--arc', `${rnd(-30, -12)}px`);
        s.setProperty('--c', pick(WINDS));
        s.setProperty('--w', `${rnd(14, 30)}px`);
        s.setProperty('--d', `${rnd(0.7, 1)}s`);
        s.setProperty('--dl', `${rnd(0.05, 0.45)}s`);
        p.classList.add('wind');
      } else {
        // 从中心向四周炸开，先冲出去再受重力落下一点
        const a = rnd(0, Math.PI * 2);
        const r = rnd(60, kind === 'zimo' ? 190 : 150);
        const dx = Math.cos(a) * r;
        const dy = Math.sin(a) * r * 0.75;
        s.setProperty('--mx', `${Math.round(dx * 0.7)}px`);
        s.setProperty('--my', `${Math.round(dy * 0.7 - 14)}px`);
        s.setProperty('--ex', `${Math.round(dx)}px`);
        s.setProperty('--ey', `${Math.round(dy + rnd(10, 40))}px`);
        s.setProperty('--rot', `${Math.round(rnd(-360, 360))}deg`);
        s.setProperty('--c', pick(GOLDS));
        s.setProperty('--w', `${Math.round(rnd(6, 13))}px`);
        s.setProperty('--d', `${rnd(0.9, 1.3)}s`);
        s.setProperty('--dl', `${rnd(0, 0.25)}s`);
        p.classList.add(i % 3 === 0 ? 'star' : 'bit');
      }
    }
  }
  // 动画结束后清掉所有节点；时间到了不管动画事件有没有触发都删，页面切到后台时不会攒节点
  window.setTimeout(() => box.remove(), ms + 150);
}

/**
 * 一局结算的动画（docs/art-v3.md，0.17.2）：每家的分从 0 数到最后的数（0.6 秒），同时几枚铜钱从输家那一行飞到赢家那一行。
 * box 是 roundSummary() 画的那块（行上有 data-seat，分上有 data-n，box 上有 data-moves）。省内存、减少动态效果时只数数不飞钱。
 * 返回飞没飞钱（飞了由调用的放一声筹码响）。只动 transform / opacity；数字是改文字，一共几十次
 */
export function settleFx(box: HTMLElement): boolean {
  const nets = [...box.querySelectorAll<HTMLElement>('.net[data-n]')];
  const t0 = performance.now();
  const tick = (now: number): void => {
    const k = Math.min(1, (now - t0) / 600);
    const e = 1 - (1 - k) ** 3;
    for (const x of nets) x.textContent = `${signed(Math.round(Number(x.dataset.n) * e))}${x.dataset.unit ?? ''}`;
    if (k < 1 && box.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const lite = reduced() || document.documentElement.dataset.lite === '1';
  const host = box.closest<HTMLElement>('.dialog');
  const moves = (JSON.parse(box.dataset.moves ?? '[]') as string[]).slice(0, 6);
  if (lite || !host || !moves.length) return false;
  // 等弹窗里的东西都摆好（调用时后面可能还要加总结算、按钮，弹窗会重新居中）再量位置
  requestAnimationFrame(() => flyCoins(box, host, moves));
  return true;
}

function flyCoins(box: HTMLElement, host: HTMLElement, moves: string[]): void {
  // 舞台整体缩放过：屏幕坐标除以缩放倍数才是弹窗里的设计像素
  const hb = host.getBoundingClientRect();
  const scale = hb.width / host.offsetWidth || 1;
  const at = (seat: string): { x: number; y: number } | null => {
    const r = box.querySelector(`.row[data-seat='${seat}'] .net`)?.getBoundingClientRect();
    return r ? { x: (r.left + r.width / 2 - hb.left) / scale, y: (r.top + r.height / 2 - hb.top) / scale + host.scrollTop } : null;
  };
  moves.forEach((m, i) => {
    const [from, to] = m.split('>') as [string, string];
    const a = at(from);
    const b = at(to);
    if (!a || !b) return;
    const c = el('i', 'settle-coin', host);
    c.style.left = `${a.x}px`;
    c.style.top = `${a.y}px`;
    c.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(1)`, opacity: 1, offset: 0.85 },
        { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(0.6)`, opacity: 0 },
      ],
      { duration: 650, delay: 120 + i * 90, easing: 'ease-in-out', fill: 'both' },
    ).onfinish = () => c.remove();
  });
}
