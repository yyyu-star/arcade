/**
 * 主题房（0.18.1，docs/art-v3.md 第 3 节）：四个档位各一间房，越往上越华丽——"往上走"的感觉。
 * 只换颜色和材质（rooms.css 按 data-room 换 --felt-*、--wood-*、--sc-* 变量），座位、按钮、布局不变。
 * 娱乐（三个难度）都在小桌那一间：难度只管电脑，不是往上走。
 */
import type { StakesId } from '../core/stakes.ts';

export const ROOM_NAME: Readonly<Record<StakesId, string>> = {
  small: '街角牌室',
  mid: '湖畔会所',
  big: '红厅',
  lux: '黑金',
};

/** 给舞台、背景（和选桌的小桌面）挂上这一间的 data-room；null 是回到默认（小桌那一间） */
export function setRoom(els: readonly HTMLElement[], id: StakesId | null): void {
  for (const e of els) {
    if (id && id !== 'small') e.dataset.room = id;
    else delete e.dataset.room;
  }
}
