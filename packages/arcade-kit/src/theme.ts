/**
 * DOM 组件的主题（0.16.0）：颜色、圆角、字体走 CSS 自定义属性 `--ak-*`，每处写成 `var(--ak-xxx, <原来的值>)`，
 * 不给主题时外观和以前完全一样。两种用法：组件的选项里传 `theme`（写到组件根节点上），或游戏自己的 CSS 在 :root / body 上写 `--ak-*`（靠继承）。
 * 纯函数，import 时不碰 DOM。值来自游戏代码，仍要挡 CSS 注入：含 `;` `{` `}` `<` `url(` `expression` 等的字段整个忽略。
 */

/** 主题字段，全是可选的字符串（合法的 CSS 值，如 `#2b1d14`、`14px`、`"Noto Serif SC",serif`） */
export interface KitTheme {
  /** --ak-bg：面板、菜单、横条的底色 */
  bg?: string;
  /** --ak-fg：面板上的文字色（分享预览的字和次按钮的边、字也用它） */
  fg?: string;
  /** --ak-accent：主按钮底色（去、叫他来、互动里的主操作、保存/复制图片） */
  accent?: string;
  /** --ak-accent-fg：主按钮上的文字色 */
  accentFg?: string;
  /** --ak-border：面板、按钮的边框色 */
  border?: string;
  /** --ak-radius：面板、横条、气泡、预览图的圆角 */
  radius?: string;
  /** --ak-radius-btn：按钮、格子、好友行的圆角 */
  radiusBtn?: string;
  /** --ak-font：字体（font-family 的值） */
  font?: string;
  /** --ak-overlay：遮罩色（分享预览、叫朋友面板背后那层） */
  overlay?: string;
  /** --ak-soft：次按钮、格子、好友行的底色 */
  soft?: string;
  /** --ak-title：标题、✕、强调字（如飘字、横幅的金色）的颜色 */
  title?: string;
}

const NAMES: ReadonlyArray<readonly [keyof KitTheme, string]> = [
  ['bg', '--ak-bg'],
  ['fg', '--ak-fg'],
  ['accent', '--ak-accent'],
  ['accentFg', '--ak-accent-fg'],
  ['border', '--ak-border'],
  ['radius', '--ak-radius'],
  ['radiusBtn', '--ak-radius-btn'],
  ['font', '--ak-font'],
  ['overlay', '--ak-overlay'],
  ['soft', '--ak-soft'],
  ['title', '--ak-title'],
];

/** 能跳出一条声明、一个块，或带出外部资源、脚本的写法 */
const UNSAFE = /[;{}<>\\]|\/\*|url\s*\(|expression|@import|javascript:/i;

/** 值是不是能放进 CSS 自定义属性：非空字符串、不太长、不含注入写法 */
export function safeThemeValue(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 200 && !UNSAFE.test(v);
}

/** 主题对象 → [变量名, 值] 列表；不认识的字段、不合格的值忽略，空对象（或不是对象）给空列表 */
export function themeVars(theme: KitTheme | null | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!theme || typeof theme !== 'object') return out;
  for (const [key, name] of NAMES) {
    const v = theme[key];
    if (safeThemeValue(v)) out.push([name, v.trim()]);
  }
  return out;
}

/** 把主题写到组件根节点上；没传、没有合格字段就什么也不写（游戏可以只在自己的 CSS 里写 `--ak-*`） */
export function applyTheme(el: HTMLElement, theme: KitTheme | null | undefined): void {
  for (const [name, v] of themeVars(theme)) el.style.setProperty(name, v);
}
