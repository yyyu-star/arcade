/**
 * 结算页的分享卡（0.13.0）和报位置（docs/social.md 1.1、1.2）：只拼数据的纯函数。画卡、分享在 kit（它自己有测试），这里不碰 DOM。
 */
import { describe, expect, it } from 'vitest';
import { SHARE_ACCENT, myTitle, shareCardOf, shareUrl } from '../src/view/share-card.ts';
import { INVITE_Z, presenceOf } from '../src/view/social.ts';
import onlineSrc from '../src/view/online.ts?raw';
import rotateSrc from '../src/view/orientation.ts?raw';
import errorsSrc from '../src/view/errors.ts?raw';
import { emptyMatchLog, type MatchLog, type Title } from '../src/variants/guandan/stake/titles.ts';
import type { NetSession } from '../src/view/net.ts';

const log = (over: Partial<MatchLog> = {}): MatchLog => ({ ...emptyMatchLog(), deals: 6, firsts: [2, 1, 3, 0], bombs: [3, 0, 1, 2], ...over });

describe('分享卡的数据', () => {
  it('娱乐整局：胜负是大字，三条小数据都是我的（画面座位 0），单机不写名字', () => {
    const c = shareCardOf({ kind: 'game', win: true, room: null }, log(), [], null);
    expect(c).toMatchObject({ game: '掼蛋', title: '单机 · 打到 A', big: { value: '胜利', label: '我方先过 A' }, accent: SHARE_ACCENT });
    expect(c.stats).toEqual([
      { label: '打了', value: '6 副' },
      { label: '头游', value: '2 次' },
      { label: '炸弹', value: '3 个' },
    ]);
    expect(c.line).toBe('拿了 2 次头游');
    expect(c.player).toBeUndefined();
    expect(shareCardOf({ kind: 'game', win: false, room: '123456' }, log({ firsts: [0, 0, 0, 0] }), [], '小王')).toMatchObject({
      title: '好友房 123456 · 打到 A',
      big: { value: '惜败' },
      line: '差一点就过 A 了，下局再来',
      player: { name: '小王' },
    });
  });

  it('实盘：筹码是大字（带分），副数按这一场；我拿了称号就写称号、做徽章', () => {
    const titles: Title[] = [{ id: 'bomb_maniac', seat: 0, why: '一共炸了 3 次' }];
    const c = shareCardOf({ kind: 'stake', tier: 'mid', points: 3, chips: 1500, deals: 5, room: null }, log(), titles, '小王');
    expect(c.title).toBe('单机 · 实盘中档');
    expect(c.big).toEqual({ value: '+1,500', label: '筹码（+3 分）' });
    expect(c.stats![0]).toEqual({ label: '打了', value: '5 副' });
    expect(c.line).toBe('炸弹狂魔：一共炸了 3 次');
    expect(c.player).toEqual({ name: '小王', badge: '炸弹狂魔' });
  });

  it('称号：别人的不算我的；一队两个人的（对家拿的）也算我', () => {
    expect(myTitle([{ id: 'ninja', seat: 1, why: '' }])).toBeNull();
    expect(myTitle([{ id: 'best_partner', seat: 2, why: '', pair: true }])?.id).toBe('best_partner');
    expect(myTitle([{ id: 'scapegoat', seat: 2, why: '' }])).toBeNull();
  });

  it('链接：游戏地址；好友房带房间码', () => {
    expect(shareUrl('https://game.example.com', '/games/guandan/', null)).toBe('https://game.example.com/games/guandan/');
    expect(shareUrl('https://game.example.com', '/games/guandan/', '123456')).toBe('https://game.example.com/games/guandan/?room=123456');
  });
});

describe('报位置', () => {
  const ses = (status: string, roomStatus: string, kinds: string[]) =>
    ({ code: '123456', status, room: { status: roomStatus, seats: kinds.map((kind) => ({ kind })) } }) as unknown as NetSession;

  it('连着的好友房：place room、房间码、真人几个；没连上、打完了、不在房间里报在掼蛋', () => {
    expect(presenceOf(ses('open', 'playing', ['human', 'ai', 'human', 'human']))).toEqual({ place: 'room', game: 'guandan', room: '123456', seats: '3/4' });
    expect(presenceOf(ses('open', 'waiting', ['human', 'empty', 'empty', 'empty']))).toMatchObject({ seats: '1/4' });
    expect(presenceOf(ses('reconnecting', 'playing', ['human', 'ai', 'ai', 'ai']))).toEqual({ place: 'game', game: 'guandan' });
    expect(presenceOf(ses('open', 'over', ['human', 'ai', 'ai', 'ai']))).toEqual({ place: 'game', game: 'guandan' });
    expect(presenceOf(null)).toEqual({ place: 'game', game: 'guandan' });
  });
});

describe('"叫朋友来"面板的层级（0.13.2）', () => {
  const z = (src: string, sel: string): number => Number(new RegExp(`${sel} \\{[^}]*z-index: (\\d+)`).exec(src)?.[1]);

  it('盖住房间弹窗 #online，在"请横过来"和出错面板之下', () => {
    expect(z(onlineSrc, '#online')).toBe(8500);
    expect(INVITE_Z).toBeGreaterThan(z(onlineSrc, '#online'));
    expect(INVITE_Z).toBeLessThan(z(rotateSrc, '#rotate-hint'));
    expect(INVITE_Z).toBeLessThan(z(errorsSrc, '#error-panel'));
  });
});
