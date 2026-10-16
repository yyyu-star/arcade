/** 听牌提示只按自己看得见的算：别人手里藏着的不减（不漏信息），桌上亮出来的才减 */
import { describe, expect, it } from 'vitest';
import { sichuanXuezhan as XZ } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { tingOf } from '../src/view/variants/sichuan-xuezhan/ting.ts';
import { kinds } from './helpers.ts';
import { RON, act, tileIn } from './xz-table.ts';

const k = (s: string): number => kinds(s)[0]!;

describe('听牌提示', () => {
  it('现在这手：别人手里的不算，打到河里的才减', () => {
    const s = RON();
    // 1 号听 5p；0 号手里藏着一张 5p，1 号看不见，还是剩 4 张
    expect(tingOf(XZ.view(s, 1), null)).toEqual([{ kind: k('5p'), left: 4 }]);
    const t = act(s, 0, { t: 'discard', tile: tileIn(s, 0, '5p') });
    expect(t.phase).toBe('claim');
    expect(tingOf(XZ.view(t, 1), null)).toEqual([{ kind: k('5p'), left: 3 }]);
  });

  it('轮到我打：打哪张能听、听什么；打的那张自己的不算剩', () => {
    const s = RON();
    const v = XZ.view(s, 0);
    // 打 5p 听 6p、9p：2 号手里的 6p 看不见，不减
    expect(tingOf(v, tileIn(s, 0, '5p'))).toEqual([
      { kind: k('6p'), left: 4 },
      { kind: k('9p'), left: 4 },
    ]);
    expect(tingOf(v, tileIn(s, 0, '1s'))).toBeNull();
    // 14 张时"现在这手"没有意义
    expect(tingOf(v, null)).toBeNull();
  });

  it('手里还有缺门就不算听', () => {
    const s = RON();
    // 3 号手里只有一张 9m，不是 13 张，不提示；1 号改成缺筒（手里还有筒）就不算听
    expect(tingOf(XZ.view(s, 3), null)).toBeNull();
    s.players[1]!.que = 1;
    expect(tingOf(XZ.view(s, 1), null)).toBeNull();
  });
});

describe('自审 C7', () => {
  it('四张都在自己手里和碰杠里的那种不提示听', () => {
    const s = RON();
    const k5 = kinds('5p')[0]!;
    const t = (k: string, copy: number) => kinds(k)[0]! * 4 + copy;
    // 1 号：碰了 5p，手里 123m456m789m 加第 4 张 5p 单钓（0 号手里那张 5p 拿掉，免得重复）
    s.players[0]!.hand = s.players[0]!.hand.filter((x) => x >> 2 !== k5);
    s.players[1]!.hand = [...['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'].map((k) => t(k, 1)), t('5p', 3)];
    s.players[1]!.melds = [{ kind: 'pon', tiles: [t('5p', 0), t('5p', 1), t('5p', 2)], from: 0 }];
    expect(tingOf(XZ.view(s, 1), null)).toBeNull();
    // 轮到 1 号、手里 14 张（多摸一张 9p）：打 9p 还是单钓 5p，四张都是自己的，不提示；
    // 打掉第 4 张 5p 以后那张进了河、不算自己的了，和规则（tenpaiKinds 按打之后的手）一样不排除——这时手里也没有 5p，本来就听不了 5p
    const s14 = structuredClone(s);
    s14.players[1]!.hand = [...s14.players[1]!.hand, t('9p', 1)].sort((x, y) => x - y);
    s14.turn = 1;
    s14.phase = 'turn';
    s14.claim = null;
    s14.drawn = t('9p', 1);
    expect(tingOf(XZ.view(s14, 1), t('9p', 1))).toBeNull();
    // 碰的换成 6p：单钓 5p 照提示（剩 0 张也提示，只是画暗）
    s.players[1]!.melds = [{ kind: 'pon', tiles: [t('6p', 0), t('6p', 1), t('6p', 2)], from: 0 }];
    expect(tingOf(XZ.view(s, 1), null)?.map((w) => w.kind)).toEqual([k5]);
  });
});
