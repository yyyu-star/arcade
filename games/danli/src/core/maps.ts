/**
 * 地图（DESIGN.md 第 3 节）："轮廓多边形 + 预挖的洞"描述，开局光栅化成地形网格；另有一张出生点的候选表（只给 x），开局由 rules.ts 洗牌挑。
 * 整张图是一页画本：世界 3000×780（0.4.0 的寿司长台 3600 宽），地形悬空，下面是雾；左、右、下三边是纸边，出了纸边就出局。上边不封顶。
 * 轮廓的上沿、下沿各是几个关键点，按 Catmull-Rom 采样成折线；只用加减乘除，再取整。
 * 每块地有材质（面团、冰淇淋、饺子皮……），材质码写进格子（规则上都一样能炸穿，只给画面分颜色）。
 * 11 张图的数据在 mapData.ts（0.2.0 的 6 张）和 mapData2.ts（0.4.0 的 5 张），都是美术代理交付的；准备房间的地图卡片墙和"随机"按 MAP_IDS 取。
 */
import { BENTO, BREAKFAST, DUMPLING, ICECREAM, KITCHEN, MATERIAL_CODE, NIGHTMARKET } from './mapData.ts';
import { CAKE, HOTPOT, MAP_IDS2, PIZZA, SUSHI, TEATIME, type MapId2, type MaterialId2 } from './mapData2.ts';
import { carve, CELL, emptyTerrain, fillPolygon, SCORCH, type Pt, type Terrain } from './terrain.ts';

export type MapId = 'kitchen' | 'icecream' | 'dumpling' | 'bento' | 'nightmarket' | 'breakfast' | MapId2;

export type MaterialId =
  | 'dough' | 'mint' | 'berry' | 'vanilla' | 'choco' | 'waffle' | 'snow' | 'dumpling' | 'rice' | 'tamago' | 'sausage' | 'tempura' | 'broccoli'
  | 'biscuit' | 'awning' | 'toast' | 'baguette' | 'eggwhite' | 'yolk' | 'butter' | 'pancake' | 'nori' | 'bamboo' | 'strawberry' | 'mug' | MaterialId2;

interface LandDef {
  /** 上沿的关键点（从左到右） */
  keys: readonly Pt[];
  /** 下沿的关键点（从右往左，接着上沿最右的点绕回最左的点）：往下垂的面团，一起一伏 */
  bottom: readonly Pt[];
  /** 每两个关键点之间采几个点 */
  per: number;
  /** 这块地的材质（不写就是整张图的主材质） */
  mat?: MaterialId;
}

export interface MapDef {
  id: MapId;
  name: string;
  /** 一句话特色（准备房间的地图卡片） */
  line: string;
  /** 推荐几对几（准备房间的地图卡片） */
  recommend: string;
  width: number;
  height: number;
  /** 主材质 */
  material: MaterialId;
  lands: readonly LandDef[];
  /** 开局就有的坑（圆心、半径） */
  craters: readonly (readonly [number, number, number])[];
  /** 打穿到底的井：x0..x1，井口圆顶的中心高度 top */
  shafts: readonly { x0: number; x1: number; top: number }[];
  /**
   * 出生点的候选（DESIGN.md 第 3 节）：只给 x，y 是这一列从上往下第一块地的地面。两队共用一张表，至少 10 个，散在地图各处；
   * 每个点都要站得稳（脚下厚、左右能走、附近没有通到底的洞），test/spawns.test.ts 逐个检查。开局怎么挑见 rules.ts 的 pickSpawns
   */
  spawns: readonly { x: number }[];
}

/** Catmull-Rom 采样成折线，取整到世界单位 */
function sample(keys: readonly Pt[], per: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const p0 = keys[Math.max(0, i - 1)]!;
    const p1 = keys[i]!;
    const p2 = keys[i + 1]!;
    const p3 = keys[Math.min(keys.length - 1, i + 2)]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, c2: number, d: number): number =>
        0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push([Math.round(c(p0[0], p1[0], p2[0], p3[0])), Math.round(c(p0[1], p1[1], p2[1], p3[1]))]);
    }
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

/** 一块地形的轮廓（世界坐标的多边形）：上沿从左到右，下沿从右绕回左 */
export function landOutline(l: LandDef): Pt[] {
  const top = sample(l.keys, l.per);
  const ring = [top[top.length - 1]!, ...l.bottom, top[0]!];
  return [...top, ...sample(ring, l.per).slice(1, -1)];
}

export { BENTO, BREAKFAST, DUMPLING, ICECREAM, KITCHEN, MATERIAL_CODE, NIGHTMARKET };

export const MAPS: Readonly<Record<MapId, MapDef>> = { kitchen: KITCHEN, icecream: ICECREAM, dumpling: DUMPLING, bento: BENTO, nightmarket: NIGHTMARKET, breakfast: BREAKFAST, cake: CAKE, hotpot: HOTPOT, pizza: PIZZA, sushi: SUSHI, teatime: TEATIME };

/** 准备房间的地图卡片墙按这个顺序摆 */
export const MAP_IDS: readonly MapId[] = ['kitchen', 'icecream', 'dumpling', 'bento', 'nightmarket', 'breakfast', ...MAP_IDS2];

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && Object.hasOwn(MAPS, v);
}

/** 开局的地形：按顺序填轮廓（后填的盖住先填的，材质码照块的材质）、挖开局的坑和井 */
export function buildTerrain(m: MapDef): Terrain {
  const t = emptyTerrain(m.width, m.height);
  for (const l of m.lands) fillPolygon(t, landOutline(l), MATERIAL_CODE[l.mat ?? m.material]);
  for (const [x, y, r] of m.craters) carve(t, x, y, r);
  for (const s of m.shafts) {
    const r = (s.x1 - s.x0) / 2;
    carve(t, s.x0 + r, s.top, r);
    // 井身：竖着挖穿到底，井壁也标成焦边
    for (let row = Math.floor(s.top / CELL); row < t.rows; row++) {
      for (let col = Math.floor((s.x0 - 6) / CELL); col <= Math.floor((s.x1 + 6) / CELL); col++) {
        const cx = col * CELL + CELL / 2;
        const i = row * t.cols + col;
        if (cx >= s.x0 && cx < s.x1) t.cells[i] = 0;
        else if (t.cells[i]) t.cells[i] = t.cells[i]! | SCORCH;
      }
    }
  }
  return t;
}
