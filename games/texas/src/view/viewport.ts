/**
 * 看得见的区域（AGENTS.md 第 4 节的 iOS 几条）：
 * - 高度不用 100vh：CSS 先写 100vh → 100dvh，再由这里按 visualViewport（没有就 innerHeight）写 --app-h；
 *   转屏、收放地址栏后重算，转屏后过一会儿再补算一次（iOS 转屏时第一次拿到的尺寸常常是旧的）；
 * - 双指放大时（visualViewport.scale 明显不是 1）不改尺寸、不重排，缩回 1 倍再说；
 * - 舞台按 layout.fit 缩放，safe-area 由 CSS 的 env(safe-area-inset-*, 0px) 让出来。
 * 牌桌是 DOM + CSS，没有画布和 WebGL，"画布倍数封顶 2""WebGL 上下文丢失"那两条不适用（DESIGN.md 8.1）。
 */
import { fit, type Geo } from './layout.ts';

export interface Fit extends Geo {
  scale: number;
}

export function watchViewport(app: HTMLElement, stage: HTMLElement, onFit: (f: Fit) => void): () => Fit {
  let last: Fit = { w: 960, h: 540, tall: false, scale: 1 };
  let timer = 0;

  const measure = (): void => {
    const vv = window.visualViewport;
    if (vv && Math.abs(vv.scale - 1) > 0.05) return;
    const h = vv?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    // 舞台放在去掉 safe-area 以后的区域里
    const r = app.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const f = fit(r.width, r.height);
    if (Math.abs(f.w - last.w) < 0.5 && Math.abs(f.h - last.h) < 0.5 && f.tall === last.tall && Math.abs(f.scale - last.scale) < 0.001) return;
    last = f;
    stage.style.width = `${f.w}px`;
    stage.style.height = `${f.h}px`;
    // 竖屏（0.10.0）：手机竖着拿，换竖的牌桌（style.css 的 .stage.tall、layout.ts 的竖屏位置）
    stage.classList.toggle('tall', f.tall);
    stage.style.transform = `translate(-50%, -50%) scale(${f.scale})`;
    // 一个屏幕像素合几个设计单位（大屏是 1）：小字的下限、触屏按钮能点的范围按它放大（style.css 的 --fs-1..3、--hit）。
    // 写在根上，根上那几个变量才算得到
    document.documentElement.style.setProperty('--ui', Math.max(1, 1 / f.scale).toFixed(3));
    // 手机横屏（缩到 0.9 倍以下）：字和按钮放大以后标题页放不下，换紧凑的排法（style.css 的 .stage.tight）
    stage.classList.toggle('tight', f.scale < 0.9);
    onFit(f);
  };
  const later = (): void => {
    measure();
    window.clearTimeout(timer);
    timer = window.setTimeout(measure, 350);
  };

  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.visualViewport?.addEventListener('resize', later);
  measure();
  return () => last;
}
