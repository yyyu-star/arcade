/**
 * 这一页有没有平台（DESIGN.md 10.1）：开局时 main.ts 用 kit 的 detectPlatform 问一次同域的 /api/me，之后不变。
 * 单独部署（没有平台）时没有登录、云存档、钱包和实盘：单机只有娱乐，好友房用游客身份、带上桌的筹码不记账。
 * 平台抖了一下（unknown）按有平台算，和以前一样。
 */
import { TWO_NOTE } from './room/rules.ts';

export const site = { standalone: false };

/** 好友房能打的真人不到两个时的说明：规则里那句说的是实盘，单独部署没有实盘 */
export const twoText = (): string => (site.standalone ? '好友房至少要两个人才开打；一个人想玩，去单机' : TWO_NOTE);
