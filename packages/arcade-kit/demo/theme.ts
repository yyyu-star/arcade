/** 演示用主题：网址带 ?theme（如 /demo/table-fun.html?theme）就换成深色木纹 + 金色强调，不带就是 kit 的默认外观 */
import type { KitTheme } from '../src/theme.ts';

export const demoTheme: KitTheme | undefined = new URLSearchParams(location.search).has('theme')
  ? {
      bg: '#1b120b',
      fg: '#f4e9d3',
      accent: '#e0b43c',
      accentFg: '#2a1a08',
      border: '#e0b43c',
      radius: '4px',
      radiusBtn: '6px',
      font: 'Georgia,"Songti SC","Noto Serif CJK SC",serif',
      overlay: 'rgba(10,6,2,.82)',
      soft: '#3a2a1a',
      title: '#ffd76a',
    }
  : undefined;
