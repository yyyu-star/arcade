/**
 * 晒战绩、晒名次（0.21.0）：卡由共用包 arcade-kit/share 画（和游戏的分享卡一个样），平台只交数据。
 * 链接是本人的好友链接 /f/<码>：朋友扫码或点开，登录后直接加好友。图在浏览器里画，不上传、不写库。
 * iOS 只许在点击的那一下里调系统分享，所以卡在 effect 里先画好（prepareShare），点的时候同步调 share()。
 */
import { useEffect, useRef } from 'react';
import { prepareShare, type PreparedShare, type ShareCard } from 'arcade-kit/share';
import type { CareerView } from './api.ts';
import { num } from './format.ts';
import { pickStats } from './share-pick.ts';

/** 平台的主题色（和大厅的橙色一致） */
export const SHARE_ACCENT = '#e8742c';

/** 头像：和页面上一样，主题色圆里写昵称的第一个字。画成一个小 canvas 当卡上的图 */
function avatarArt(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = SHARE_ACCENT;
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 128px system-ui, "PingFang SC", "Noto Sans SC", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(Array.from(name)[0] ?? '我', 128, 136);
  }
  return c;
}

/**
 * 战绩卡：大数字是一共打了多少局；三个小格和底下一句怎么挑见 share-pick.ts（0.21.1）。
 * 称号名给了就挂在昵称旁边（调用方用 pickBadge 挑过体面的），没有就不挂。
 */
export function statsCard(name: string, games: Record<string, CareerView>, badge?: string): ShareCard {
  const list = Object.values(games).filter((c) => c.n > 0);
  const { stats, line } = pickStats(games);
  return {
    game: '街机厅战绩',
    title: `${list.length} 个游戏`,
    accent: SHARE_ACCENT,
    big: { value: num(list.reduce((t, c) => t + c.rounds, 0)), label: '局' },
    stats,
    ...(line ? { line } : {}),
    art: avatarArt(name),
    player: badge ? { name, badge } : { name },
  };
}

/** 名次卡：哪个榜、第几名、成绩 */
export function rankCard(name: string, board: string, rank: number, scoreText: string, friends: boolean): ShareCard {
  return {
    game: '街机厅排行榜',
    title: board,
    accent: SHARE_ACCENT,
    big: { value: `第 ${rank} 名`, label: friends ? '好友里' : '全站' },
    stats: [{ label: '成绩', value: scoreText }],
    art: avatarArt(name),
    player: { name },
  };
}

/**
 * 本人的好友链接 /f/<码>（只给路径）：kit 0.15.0 拿运行时的 origin 拼成完整链接，画进卡右下角的二维码，也是系统分享的链接。
 * 朋友圈里的图不能点，扫码是唯一入口；扫码的人登录后直接加好友
 */
export function friendLink(friendCode: string): string {
  return `/f/${friendCode}`;
}

/**
 * "晒一晒"按钮：card 变了才重画（按内容比，不按对象）。点的时候前面不能有 await，iOS 的点击激活才还在。
 * log 给冒烟用（kit 写"分享 系统"、"分享 预览"这些）。
 */
export function ShareButton({ card, url, label, testId }: { card: ShareCard; url: string; label: string; testId: string }) {
  const prepared = useRef<PreparedShare | null>(null);
  const { art: _, ...data } = card;
  const key = JSON.stringify(data) + url;
  useEffect(() => {
    prepared.current = prepareShare(card, { url, text: `${card.game} · ${card.title}`, fileName: 'arcade.png', log: shareLog });
    return () => {
      prepared.current = null;
    };
    // 只在内容变了时重画：card 每次渲染都是新对象
  }, [key]);
  return (
    <button
      className="btn btn--small btn--primary"
      type="button"
      data-testid={testId}
      onClick={() => {
        const p = prepared.current ?? prepareShare(card, { url, fileName: 'arcade.png', log: shareLog });
        void p.share().catch(() => undefined);
      }}
    >
      {label}
    </button>
  );
}

/** 冒烟读这个看分享走的是系统还是预览；线上只是一个小数组 */
function shareLog(line: string): void {
  const w = window as Window & { __arcadeShareLog?: string[] };
  (w.__arcadeShareLog ??= []).push(line);
}
