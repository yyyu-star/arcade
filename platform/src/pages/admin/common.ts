/** 管理页各块共用的：建号、重设后要发出去的账号；游戏名、时间和数字的写法（和其他页一样，来自 src/format.ts）。 */
export { dateText, gameName, num, timeText } from '../../format.ts';

/** 建号、重设成功后要发给朋友的东西：只显示这一次。 */
export interface Credentials {
  title: string;
  username: string;
  password: string;
  recoveryCode?: string;
}
