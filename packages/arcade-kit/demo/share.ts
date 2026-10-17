/** 分享卡的演示：图标是现画的 canvas，图集是一张 2×2 的 canvas 切右下那块，坏图是一个加载不了的 img。冒烟由脚本读 window.share */
import { demoTheme } from './theme.ts';
import { drawShareCard, prepareShare, shareCard, shareLink, type ShareCard } from '../src/share.ts';

function icon(size: number, color: string, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 ${size * 0.4}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, size / 2, size / 2);
  return c;
}

// 2×2 的图集，每格 128：左上红 A、右上绿 B、左下蓝 C、右下黄 D
const atlas = document.createElement('canvas');
atlas.width = atlas.height = 256;
['#c33', '#3a3', '#36c', '#db3'].forEach((col, i) => atlas.getContext('2d')!.drawImage(icon(128, col, 'ABCD'[i]!), (i % 2) * 128, Math.floor(i / 2) * 128));

const broken = new Image();
broken.src = '/demo/does-not-exist.png';

const date = new Date(Date.UTC(2026, 9, 16, 4));
const cards: ShareCard[] = [
  {
    game: '示例牌局',
    title: '实盘小档 · 8 副',
    big: { value: '+3.5', label: '份筹码' },
    stats: [{ label: '头游', value: '4 次' }, { label: '炸弹', value: '6 个' }, { label: '名次', value: '第 1' }],
    line: '最后一手四个 A 炸穿全场，对家直接看傻了',
    accent: '#b03a2e',
    art: icon(256, '#fff3', '牌'),
    player: { name: '小明', badge: '炸弹狂人' },
    date,
  },
  {
    game: '示例图集',
    title: '每日挑战',
    big: { value: '128', label: '天' },
    stats: [{ label: '最高', value: '¥12,345' }, { label: '回撤', value: '-8%' }],
    accent: '#1f6f8b',
    art: { image: atlas, crop: { x: 128, y: 128, w: 128, h: 128 }, fit: 'cover' },
    player: { name: '一个名字特别特别长的玩家啊' },
    date,
  },
  {
    game: '坏图也出卡',
    title: '好友房 ABC123',
    big: { value: '第 2 名', label: '这一场' },
    line: 'A very long english line that should wrap by words and get an ellipsis at the end because it keeps going and going',
    accent: 'not-a-color',
    art: broken,
    date,
  },
];

const out: { w: number; h: number; ok: boolean }[] = [];
for (const card of cards) {
  // 右下角的二维码（0.15.0）：链接只给路径，域名用运行时的 origin
  const cv = await drawShareCard(card, undefined, shareLink('/games/demo/?room=123456', location.origin));
  document.getElementById('cards')!.appendChild(cv);
  out.push({ w: cv.width, h: cv.height, ok: true });
}
const log: string[] = [];
document.getElementById('share')!.addEventListener('click', () => {
  void shareCard(cards[0]!, { url: '/games/demo/', theme: demoTheme, log: (l) => log.push(l) }).then((r) => log.push(`结果 ${r}`));
});
// 结算页一出现就先画好（0.12.3）：点的时候同步调系统分享，iOS 的用户激活还在
const prepared = prepareShare(cards[0]!, { url: '/games/demo/', theme: demoTheme, log: (l) => log.push(l) });
document.getElementById('prepared')!.addEventListener('click', () => {
  (window as unknown as { inClick: boolean }).inClick = true;
  void prepared.share().then((r) => log.push(`先画好 结果 ${r}`));
  (window as unknown as { inClick: boolean }).inClick = false;
});
Object.assign(window, { share: { out, log, cards, prepared } });
