/**
 * 看得见的区域（AGENTS.md 第 4 节 iOS 那几条，DESIGN.md 第 7 节）：
 * - 高度不用 100vh：CSS 先写 100vh → 100dvh，再由这里按 visualViewport（没有就 innerHeight）写 --app-h；
 *   转屏、收放地址栏后重算，转屏后过一会儿再补算一次（iOS 转屏时第一次拿到的尺寸常常是旧的）；
 * - 双指放大时（visualViewport.scale 明显不是 1）不改尺寸、不重排，缩回 1 倍再说；
 * - 舞台是设计尺寸（横屏 1000×560、竖屏 560×1120），按看得见的区域等比缩放，safe-area 由 CSS 让出来；
 *   竖屏的高度跟着屏幕比例在 920–1240 之间变（中间那一截上下挪，CSS 用 --cut，高过 1120 时是负数），
 *   不然 iPhone SE 工具栏展开时（约 375×553）按 1120 高缩到 0.49 倍，两边留黑、手牌只有 18 像素宽；现在约 0.6 倍。
 *   上限以前是 1120，390×844 这类长屏上下各留 32 像素黑边（0.18.0 手机专项）；1240 盖住 19.5:9 的手机。
 *   竖屏的宽度也能在 560–700 之间变：iPad 竖着拿（820×1180）高到下限 920 还宽，以前左右各留 51 像素黑边，现在舞台铺满、牌桌 560 宽居中。
 * 横屏的宽度也跟着屏幕比例在 1000–1500 之间变（高按 560 缩放）：电脑宽屏（1920×911 约 2.1:1）以前两边各留一条深色空边，
 *   现在舞台铺满；牌桌本身还是 1000 宽的几何、居中（style.css），多出来的是同一块呢子，选桌页按宽度排两栏。
 * 牌桌是 DOM + SVG，没有画布和 WebGL，"渲染倍数封顶 2""WebGL 上下文丢失"那两条不适用。
 */
export type Orient = 'land' | 'port';

export const STAGE: Record<Orient, { w: number; h: number }> = { land: { w: 1000, h: 560 }, port: { w: 560, h: 1120 } };
/** 竖屏舞台最矮多少：对家贴顶、自己贴底，中间最多让出 200（再矮牌河就碰到对家的副露、自己的头像） */
const PORT_MIN_H = 920;
/** 竖屏舞台最高多少：再高上下牌河离中控盘太远 */
const PORT_MAX_H = 1240;
/** 竖屏舞台最宽多少：牌桌 560 宽居中，两边露板壁 */
const PORT_MAX_W = 700;
/** 横屏舞台最宽多少：再宽牌桌两边的空呢子太多，按高缩放后两边留边 */
const LAND_MAX_W = 1500;

export function watchViewport(app: HTMLElement, stage: HTMLElement, onChange: (o: Orient) => void): void {
  let orient: Orient | null = null;
  let scale = 0;
  let height = 0;
  let width = 0;
  let timer = 0;
  const measure = (): void => {
    const vv = window.visualViewport;
    if (vv && Math.abs(vv.scale - 1) > 0.05) return;
    const vh = vv?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(vh)}px`);
    const r = app.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    // 竖屏且明显窄（手机竖着拿）用竖屏布局，其余都用横屏
    const o: Orient = r.height > r.width * 1.15 ? 'port' : 'land';
    const st = STAGE[o];
    const h = o === 'port' ? Math.round(Math.min(PORT_MAX_H, Math.max(PORT_MIN_H, (st.w * r.height) / r.width))) : st.h;
    const w =
      o === 'land'
        ? Math.round(Math.min(LAND_MAX_W, Math.max(st.w, (st.h * r.width) / r.height)))
        : Math.round(Math.min(PORT_MAX_W, Math.max(st.w, (h * r.width) / r.height)));
    const s = Math.min(r.width / w, r.height / h);
    if (o === orient && h === height && w === width && Math.abs(s - scale) < 0.001) return;
    scale = s;
    height = h;
    width = w;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.setProperty('--cut', `${st.h - h}px`);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    // 点按区域在屏幕上至少 44 像素：折成舞台里的设计像素（手机上约 63），按钮的隐形点按区按它撑开（style.css 的 --tap）
    stage.style.setProperty('--tap', `${Math.ceil(44 / s)}px`);
    // kit 的"互动"按钮浮在舞台外面（屏幕像素），按这个倍数放大字和图标（style.css 的 .atf-btn）
    document.documentElement.style.setProperty('--stage-scale', s.toFixed(3));
    // 字号同理：缩小的舞台上按倍数把字放回来，屏幕上的字不小于写的数（style.css 的 --fs-*）
    document.documentElement.style.setProperty('--fs-k', Math.max(1, 1 / s).toFixed(3));
    if (o !== orient) {
      orient = o;
      stage.dataset.orient = o;
      onChange(o);
    }
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
}
