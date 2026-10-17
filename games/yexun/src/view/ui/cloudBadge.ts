import type { CloudView } from '../../platform/cloud.ts';

/** 云朵的图标和悬停说明（未登录不显示）；DOM 由菜单自己放，这里只给文字 */
export function cloudBadge(v: CloudView): { icon: string; title: string } | null {
  switch (v.state) {
    case 'out':
      return null;
    case 'syncing':
      return { icon: '☁…', title: '正在同步' };
    case 'pending':
      return { icon: '☁!', title: v.note ?? '有进度还没传上去' };
    case 'merged':
      return { icon: '☁✓', title: v.note ?? '已同步' };
    case 'synced':
      return { icon: '☁✓', title: '已同步' };
  }
}
