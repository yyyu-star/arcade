/**
 * 分层背景（docs/art-v3.md 第 3、5 节）：铺满整个看得见的区域，在舞台后面，主页、选桌、牌桌、等人页共用。
 * 从远到近：墙面的暗色渐变 → 散景光斑 → 吊灯和吧台的剪影（内联 SVG）→ 从上往下的光锥和浮尘。全部程序画，没有图片文件。
 * 动画只动 transform 和 opacity（老 iPhone 上不重绘）；减少动态效果、省内存设备（触屏且内存 ≤ 4 GB，或者省流量）整张静止。
 * 触屏在牌桌上也静止：打牌时一直在动的背景只是吃电，主页上才动。
 */
import { el } from './dom.ts';

/** 散景光斑：[x %, y %, 直径（设计单位，按屏幕高缩放）, 颜色序号, 漂一圈几秒, 起点延迟]，固定的，每次打开一样 */
const BOKEH: readonly (readonly [number, number, number, number, number, number])[] = [
  [6, 18, 90, 0, 23, 0],
  [15, 62, 54, 1, 29, -6],
  [24, 30, 36, 2, 19, -3],
  [33, 80, 70, 0, 31, -11],
  [44, 12, 44, 1, 25, -8],
  [58, 70, 32, 2, 21, -2],
  [66, 22, 80, 0, 27, -14],
  [76, 54, 40, 1, 33, -5],
  [85, 14, 58, 2, 22, -9],
  [93, 72, 86, 0, 28, -17],
  [52, 40, 26, 1, 18, -4],
];

/** 浮尘：光锥里慢慢往上飘的小点，[x %（光锥里的位置）, 起点 %, 几秒, 延迟] */
const DUST: readonly (readonly [number, number, number, number])[] = [
  [38, 90, 11, 0],
  [46, 70, 14, -4],
  [55, 95, 12, -7],
  [61, 60, 16, -2],
  [42, 50, 13, -9],
  [52, 80, 15, -12],
  [58, 40, 12, -5],
];

/** 三盏吊灯（x 占宽度的比例、绳长）和一排吧台上的酒瓶（x、高、宽），viewBox 1600 宽 */
const LAMPS: readonly (readonly [number, number])[] = [
  [260, 70],
  [800, 40],
  [1340, 70],
];
const BOTTLES: readonly (readonly [number, number, number])[] = [
  [70, 70, 18], [100, 86, 20], [134, 60, 22], [166, 92, 16], [196, 74, 20], [232, 66, 24],
  [1360, 80, 20], [1392, 64, 22], [1424, 94, 16], [1452, 72, 20], [1486, 86, 18], [1520, 62, 24],
];

function lampsSvg(): string {
  const lamps = LAMPS.map(
    ([x, cord]) =>
      `<line x1="${x}" y1="0" x2="${x}" y2="${cord}" class="cord"/>` +
      `<path d="M${x - 46} ${cord + 44} Q${x} ${cord - 6} ${x + 46} ${cord + 44} Z" class="shade"/>` +
      `<ellipse cx="${x}" cy="${cord + 44}" rx="46" ry="5" class="rim"/>` +
      `<ellipse cx="${x}" cy="${cord + 52}" rx="150" ry="60" class="halo"/>`,
  ).join('');
  return (
    '<svg class="sc-lamps" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMin slice" aria-hidden="true">' +
    '<defs><radialGradient id="sc-halo"><stop offset="0" stop-color="var(--sc-light)" stop-opacity=".55"/><stop offset="1" stop-color="var(--sc-light)" stop-opacity="0"/></radialGradient></defs>' +
    lamps +
    '</svg>'
  );
}

function barSvg(): string {
  const bottles = BOTTLES.map(([x, h, w]) => {
    const top = 200 - h;
    const neck = Math.round(w / 3);
    return `<path d="M${x} 200 V${top + 22} Q${x} ${top + 10} ${x + w / 2 - neck / 2} ${top + 6} V${top} H${x + w / 2 + neck / 2} V${top + 6} Q${x + w} ${top + 10} ${x + w} ${top + 22} V200 Z"/>`;
  }).join('');
  return (
    '<svg class="sc-bar" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
    `<g class="bottles">${bottles}</g>` +
    '<rect x="0" y="200" width="1600" height="60" class="counter"/>' +
    '<rect x="0" y="200" width="1600" height="2" class="edge"/>' +
    '</svg>'
  );
}

/** 省内存设备：和 AGENTS.md 手机平板那几条一样的判断（触屏且内存小），加上用户开了省流量 */
function lowMemory(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return (coarse && (nav.deviceMemory ?? 8) <= 4) || nav.connection?.saveData === true;
}

/**
 * 放在 #app 的最前面（舞台之前，画在它后面）。舞台进牌桌、进房间时（.at-table / .in-room）跟着换构图：
 * 主页的光锥打在左边的扇形牌上，牌桌上光锥收起来（桌面自己有聚光），光斑暗一点
 */
export function mountScene(app: HTMLElement, stage: HTMLElement): HTMLDivElement {
  const scene = el('div', 'scene');
  app.prepend(scene);
  scene.setAttribute('aria-hidden', 'true');
  const bokeh = el('div', 'sc-bokeh', scene);
  for (const [x, y, d, c, s, delay] of BOKEH) {
    const b = el('i', `c${c}`, bokeh);
    b.style.cssText = `left:${x}%;top:${y}%;--d:${d};animation-duration:${s}s;animation-delay:${delay}s`;
  }
  scene.insertAdjacentHTML('beforeend', barSvg() + lampsSvg());
  const cone = el('div', 'sc-cone', scene);
  const dust = el('div', 'sc-dust', cone);
  for (const [x, y, s, delay] of DUST) {
    const p = el('i', '', dust);
    p.style.cssText = `left:${x}%;top:${y}%;animation-duration:${s}s;animation-delay:${delay}s`;
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const still = reduced || lowMemory();
  scene.classList.toggle('still', still);
  // 牌桌上的特效（fx.ts、荷官）也按这个降级：根上挂 .lowfx
  document.documentElement.classList.toggle('lowfx', still);
  const follow = (): void => {
    scene.classList.toggle('table', stage.classList.contains('at-table') || stage.classList.contains('in-room'));
    scene.classList.toggle('tall', stage.classList.contains('tall'));
  };
  new MutationObserver(follow).observe(stage, { attributes: true, attributeFilter: ['class'] });
  follow();
  return scene;
}
