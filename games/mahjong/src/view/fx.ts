/**
 * 胡、自摸、杠的大字加粒子（0.9.0「热闹一点」）。
 *
 * 为什么是纯 CSS 动画加几十个 span：牌桌是 DOM 渲染，没有 canvas；transform / opacity 动画走合成层，
 * 不碰 layout，也不用 filter，手机上不会卡。粒子的方向、时长用 CSS 变量传给样式，JS 只负责摆好和收尾。
 * 这里的随机只管好看，和规则无关（规则核心里才禁 Math.random）。
 */
import './fx.css';
import { el } from './dom.ts';

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
