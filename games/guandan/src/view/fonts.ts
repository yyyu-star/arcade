/**
 * 标题字体：Noto Serif SC Bold 的子集（SIL OFL 1.1，许可见 fonts/OFL.txt，生成方法见 README 素材一节）。
 * 安卓手机和多数 Linux 没有宋体类中文字体，不带字体的话标题、大字会退成黑体。
 * - gd-title.woff2：画布上用 font: 'title' 的文字（大字、横幅、弹窗标题），字表 fonts/title-chars.txt，测试检查不缺字；
 * - gd-serif-svg.woff2：SVG 美术里的宋体字（logo、牌背、印章），SVG 当图片栅格化时用不了页面字体，只能内嵌。
 */
import titleUrl from './fonts/gd-title.woff2?url';
import serifSvg from './fonts/gd-serif-svg.woff2?inline';

const TITLE_FAMILY = 'GD Title';
const SVG_SERIF_FAMILY = 'GD Serif';

/** 加载画布标题字体。最多等 timeout 毫秒；失败或超时就用系统字体，不挡启动。 */
export async function loadTitleFont(timeout = 2500): Promise<boolean> {
  if (typeof FontFace === 'undefined' || !document.fonts) return false;
  try {
    const face = new FontFace(TITLE_FAMILY, `url(${titleUrl}) format("woff2")`, { weight: '100 900' });
    document.fonts.add(face);
    await Promise.race([face.load(), new Promise((_, reject) => setTimeout(() => reject(new Error('字体加载超时')), timeout))]);
    return true;
  } catch {
    return false;
  }
}

/** 给用到宋体字的 SVG 内嵌小字体（插在根节点开头）。 */
export function withSvgFont(svg: string): string {
  if (!svg.includes(SVG_SERIF_FAMILY)) return svg;
  const i = svg.indexOf('>') + 1;
  return `${svg.slice(0, i)}<style>@font-face{font-family:"${SVG_SERIF_FAMILY}";src:url(${serifSvg}) format("woff2");font-weight:100 900}</style>${svg.slice(i)}`;
}
