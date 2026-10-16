/** 几处页面都要用的数字、日期、游戏名写法：放一处，免得各页各写一份、慢慢写得不一样。 */
import { GAMES } from './games.ts';

/** 筹码、人数这类整数：按中文习惯加千分位 */
export const num = (n: number) => n.toLocaleString('zh-CN');
/** 输赢：正数带 +，负数本来就有 - */
export const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));
/** 加绿减红：给数字配 up / down 类 */
export const tone = (n: number): 'up' | 'down' | undefined => (n > 0 ? 'up' : n < 0 ? 'down' : undefined);
/** 只要月日，比如"10/15" */
export const dateText = (ms: number) => new Date(ms).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
/** 带年份的日期：2026年9月26日 */
export const fullDateText = (ms: number) => new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
/** 月日加时分，一律 24 小时制，比如"10/15 21:05"（0.10.17 统一：以前有几处没写 hour12，换个系统设置就可能成了"下午 9:05"） */
export const timeText = (ms: number) =>
  new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** 游戏 id 换成大厅上的名字；大厅里没有的（下架了）原样显示 id */
export const gameName = (id: string) => GAMES.find((g) => g.id === id)?.name ?? id;
