/** 11 张图（0.2.0 的 6 张、0.4.0 的 5 张，都是美术交付，DESIGN.md 第 3 节）：数据齐全、材质码对得上、画面数据（远景主题、卡片文案、材质颜色）每张都有 */
import { describe, expect, it } from 'vitest';
import { buildTerrain, MAP_IDS, MAPS, MATERIAL_CODE } from '../src/core/maps.ts';
import { MAT_MASK } from '../src/core/terrain.ts';
import { THEMES } from '../src/view/backdrops.ts';
import { MAP_ART, MATERIALS } from '../src/view/mapArt.ts';

describe('地图数据', () => {
  it('11 张：老的 6 张在前，0.4.0 的 5 张接在后面；寿司长台 3600 宽，别的 3000', () => {
    expect(MAP_IDS.map((id) => MAPS[id].name)).toEqual([
      '厨房面团岛', '冰淇淋雪山', '雪夜饺子铺', '便当群岛', '夜市灯笼街', '早餐吐司桥',
      '生日蛋糕城', '火锅沸腾谷', '披萨火山', '寿司长台', '下午茶花园',
    ]);
    for (const id of MAP_IDS) {
      expect(MAPS[id].id).toBe(id);
      expect(MAPS[id].width).toBe(id === 'sushi' ? 3600 : 3000);
      expect(MAPS[id].height).toBe(780);
    }
  });

  it('材质码互不重复、都在 1–127（格子低 7 位），规则核心和画面的材质表对得上', () => {
    const codes = Object.values(MATERIAL_CODE);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c >= 1 && c <= MAT_MASK).toBe(true);
    for (const [id, code] of Object.entries(MATERIAL_CODE)) expect(MATERIALS[id as keyof typeof MATERIALS].code).toBe(code);
  });

  for (const id of MAP_IDS) {
    it(`${MAPS[id].name}：光栅化出来的格子只用这张图写到的材质；画面数据齐全`, () => {
      const m = MAPS[id];
      const t = buildTerrain(m);
      const want = new Set(m.lands.map((l) => MATERIAL_CODE[l.mat ?? m.material]));
      const seen = new Set<number>();
      for (const v of t.cells) if (v & MAT_MASK) seen.add(v & MAT_MASK);
      expect(seen.size).toBeGreaterThan(0);
      for (const c of seen) expect(want.has(c)).toBe(true);
      const art = MAP_ART[id];
      expect(THEMES[art.theme]).toBeDefined();
      expect(art.card.short.length).toBeGreaterThan(0);
      expect(art.card.players).toBe('1v1–3v3');
    });
  }

  it('便当群岛的卡片有"快图"角标，早餐吐司桥、寿司长台有"慢图"角标，别的（包括火锅）没有', () => {
    expect(MAP_ART.bento.card.tag).toBe('快图');
    expect(MAP_ART.breakfast.card.tag).toBe('慢图');
    expect(MAP_ART.sushi.card.tag).toBe('慢图');
    expect(MAP_ART.hotpot.card.tag).toBeUndefined();
    expect(MAP_IDS.filter((id) => MAP_ART[id].card.tag)).toEqual(['bento', 'breakfast', 'sushi']);
  });
});
