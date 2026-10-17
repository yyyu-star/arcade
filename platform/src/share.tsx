/**
 * 晒战绩、晒名次（0.21.0）：卡由共用包 arcade-kit/share 画（和游戏的分享卡一个样），平台只交数据。
 * 链接是本人的好友链接 /f/<码>：朋友扫码或点开，登录后直接加好友。图在浏览器里画，不上传、不写库。
 * iOS 只许在点击的那一下里调系统分享，所以卡在 effect 里先画好（prepareShare），点的时候同步调 share()。
 */
import { useEffect, useRef } from 'react';
import { prepareShare, type PreparedShare, type ShareCard } from 'arcade-kit/share';
import type { CareerView } from './api.ts';
import { gameName, num } from './format.ts';
import { GAMES } from './games.ts';

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

const rate = (c: CareerView) => (c.rounds > 0 ? Math.round((c.wins / c.rounds) * 100) : 0);

/**
 * 战绩卡：大数字是一共打了多少局；小数据挑局数最多的三个游戏写胜率（kit 每条值最多 10 个字，写长了会被截）；一句话写最大一把和称号数。
 * 称号名给了就挂在昵称旁边（第一个），读不到就不挂。
 */
export function statsCard(name: string, games: Record<string, CareerView>, badge?: string): ShareCard {
  const list = Object.entries(games).filter(([, c]) => c.n > 0);
  const rounds = list.reduce((t, [, c]) => t + c.rounds, 0);
  const titles = list.reduce((t, [, c]) => t + c.titles.length, 0);
  const best = list.reduce<[string, number] | null>((b, [g, c]) => (c.best > (b?.[1] ?? 0) ? [g, c.best] : b), null);
  const top = [...list]
    .sort(([a, x], [b, y]) => y.rounds - x.rounds || GAMES.findIndex((g) => g.id === a) - GAMES.findIndex((g) => g.id === b))
    .slice(0, 3)
    .map(([g, c]) => {
      if (c.rounds <= 0) return { label: gameName(g), value: `上桌 ${num(c.n)} 次` };
      // kit 把值截到 10 个字：放得下就带上局数（"62% · 48局"），放不下只写胜率
      const both = `${rate(c)}% · ${num(c.rounds)}局`;
      return { label: `${gameName(g)}胜率`, value: Array.from(both).length <= 10 ? both : `${rate(c)}%` };
    });
  const line = [best && `最大一把 ${gameName(best[0])} ${num(best[1])}`, titles > 0 && `称号 ${titles} 个`].filter(Boolean).join(' · ');
  return {
    game: '街机厅战绩',
    title: `${list.length} 个游戏`,
    accent: SHARE_ACCENT,
    big: { value: num(rounds), label: '局' },
    stats: top,
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
