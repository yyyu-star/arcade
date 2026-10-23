/**
 * 地图的画面数据（美术代理 2026-10-21 交付，照原数据改写成 TS）：材质的颜色和纹理、每张图的远景主题、主材质配色、准备房间卡片的文案。
 * 规则核心只认材质码（core/mapData.ts 的 MATERIAL_CODE），这里按材质 id 查颜色。
 */
import type { MapId, MaterialId } from '../core/maps.ts';
import type { ThemeId } from './backdrops.ts';
import { MAP_ART2, MATERIALS2, type TexId2 } from './mapArt2.ts';

export type TexId = 'pores' | 'chips' | 'seeds' | 'bean' | 'swirl' | 'waffle' | 'sparkle' | 'pleats' | 'grains' | 'rolls' | 'cuts' | 'batter' | 'florets' | 'docked' | 'stripes' | 'scores' | 'none' | 'layers' | 'nori' | 'bamboo' | 'strawseed' | 'band' | TexId2;

export interface Material {
  code: number;
  name: string;
  /** 从上到下四档 */
  grad: readonly [string, string, string, string];
  /** 地表皮（null 是不画） */
  crust: string | null;
  /** 炸焦的坑边 */
  rim: string;
  /** 碎屑两色 */
  crumb: readonly [string, string];
  tex: TexId;
}

export const MATERIALS: Readonly<Record<MaterialId, Material>> = {
  ...MATERIALS2,
  dough: {code: 1, name: '面团', grad: ['#fdeccb','#f8dfb2','#efc78c','#d99a5c'], crust: '#eba650', rim: '#e08f3e', crumb: ['#f8dfb2','#e3a865'], tex: 'pores'},
  mint: {code: 2, name: '薄荷冰淇淋', grad: ['#d9f5e8','#bfead6','#9fd9c0','#7cc2a6'], crust: '#fffaf2', rim: '#5fae90', crumb: ['#bfead6','#5a3a2a'], tex: 'chips'},
  berry: {code: 3, name: '草莓冰淇淋', grad: ['#ffe1ea','#fbc6d6','#f2a3bd','#de7fa0'], crust: '#fffaf2', rim: '#cf6a8e', crumb: ['#fbc6d6','#e2432a'], tex: 'seeds'},
  vanilla: {code: 4, name: '香草冰淇淋', grad: ['#fff8e2','#fdf0c8','#f6e0a6','#e8c886'], crust: '#fffdf6', rim: '#d8b070', crumb: ['#fdf0c8','#6a4a2a'], tex: 'bean'},
  choco: {code: 5, name: '巧克力冰淇淋', grad: ['#b98466','#a06c50','#875640','#6d4232'], crust: '#d4a58a', rim: '#5a3426', crumb: ['#a06c50','#ffcf6a'], tex: 'swirl'},
  waffle: {code: 6, name: '华夫甜筒', grad: ['#f6cd8a','#ecb86c','#dc9e52','#c4843e'], crust: '#f9dca6', rim: '#a8682c', crumb: ['#ecb86c','#c4843e'], tex: 'waffle'},
  snow: {code: 7, name: '积雪', grad: ['#ffffff','#eef5fb','#d6e5f2','#b5cce2'], crust: '#ffffff', rim: '#8fb0d0', crumb: ['#ffffff','#cfe0f0'], tex: 'sparkle'},
  dumpling: {code: 8, name: '饺子皮', grad: ['#fffdf4','#fbf4e2','#f2e6c8','#e2d0a8'], crust: '#fffef9', rim: '#d6b884', crumb: ['#fbf4e2','#7aa35a'], tex: 'pleats'},
  rice: {code: 9, name: '米饭', grad: ['#ffffff','#fbfaf4','#f0ede0','#ddd8c4'], crust: '#ffffff', rim: '#d9c49a', crumb: ['#ffffff','#e8e2cc'], tex: 'grains'},
  tamago: {code: 10, name: '玉子烧', grad: ['#ffe680','#ffd95a','#f7c840','#e8b030'], crust: '#e8a23a', rim: '#c88420', crumb: ['#ffd95a','#e8a23a'], tex: 'rolls'},
  sausage: {code: 11, name: '小香肠', grad: ['#ff9a8a','#f47c6c','#e2604e','#c84a3a'], crust: '#ffb8a8', rim: '#a8382a', crumb: ['#f47c6c','#ffe0d0'], tex: 'cuts'},
  tempura: {code: 12, name: '天妇罗', grad: ['#ffe9a8','#fbd77e','#f0bf58','#dca040'], crust: '#ffefc0', rim: '#c8862c', crumb: ['#fbd77e','#fff3d0'], tex: 'batter'},
  broccoli: {code: 13, name: '西兰花', grad: ['#9ad66a','#7cc252','#62a83e','#4a8c30'], crust: '#b4e488', rim: '#3c7426', crumb: ['#7cc252','#4a8c30'], tex: 'florets'},
  biscuit: {code: 14, name: '饼干', grad: ['#f8d79a','#efc47a','#e2ab5c','#cc9044'], crust: '#d98c3a', rim: '#a8682c', crumb: ['#efc47a','#cc9044'], tex: 'docked'},
  awning: {code: 15, name: '雨棚', grad: ['#fffaf0','#fffaf0','#f4ead8','#e8dcc4'], crust: null, rim: '#a8382a', crumb: ['#e2432a','#fffaf0'], tex: 'stripes'},
  toast: {code: 16, name: '吐司', grad: ['#fff4d8','#fdebc0','#f6dca4','#ecc888'], crust: '#c8803a', rim: '#a8682c', crumb: ['#fdebc0','#c8803a'], tex: 'pores'},
  baguette: {code: 17, name: '法棍', grad: ['#f2be72','#e6a656','#d68e40','#c07830'], crust: '#b8702c', rim: '#8a5020', crumb: ['#e6a656','#fff1d6'], tex: 'scores'},
  eggwhite: {code: 18, name: '蛋白', grad: ['#ffffff','#fffdf6','#f6f2e6','#ece6d4'], crust: '#ffffff', rim: '#e6c08a', crumb: ['#ffffff','#ffd23a'], tex: 'none'},
  yolk: {code: 19, name: '蛋黄', grad: ['#ffd84a','#ffc828','#f8b418','#ec9c10'], crust: '#ffe680', rim: '#d88a10', crumb: ['#ffc828','#ffe680'], tex: 'none'},
  butter: {code: 20, name: '黄油', grad: ['#fff4b8','#ffec98','#f8de78','#ecca5c'], crust: '#fffad8', rim: '#d8b048', crumb: ['#ffec98','#fffad8'], tex: 'none'},
  pancake: {code: 21, name: '松饼', grad: ['#f8d690','#f0c070','#e4a650','#c88838'], crust: '#a85a24', rim: '#8a4a1c', crumb: ['#f0c070','#a85a24'], tex: 'layers'},
  nori: {code: 23, name: '海苔', grad: ['#3f5e4a','#34523f','#2b4636','#233c2e'], crust: '#567a5e', rim: '#1c3024', crumb: ['#34523f','#ffffff'], tex: 'nori'},
  bamboo: {code: 24, name: '竹蒸笼', grad: ['#f2df98','#e6cc78','#d6b65c','#c09c44'], crust: '#c8a848', rim: '#8f7a2c', crumb: ['#e6cc78','#fdebc6'], tex: 'bamboo'},
  strawberry: {code: 25, name: '草莓', grad: ['#ff7a7a','#f25a5a','#e04444','#c83434'], crust: '#ff9a9a', rim: '#a82a2a', crumb: ['#f25a5a','#ffe680'], tex: 'strawseed'},
  mug: {code: 22, name: '马克杯', grad: ['#f4fbff','#e6f2fa','#d2e4f2','#bcd2e6'], crust: '#ffffff', rim: '#6f93b8', crumb: ['#e6f2fa','#4f86c8'], tex: 'band'},
};

export interface MapCard {
  /** 一句话特色 */
  short: string;
  /** 打法说明 */
  feature: string;
  /** 推荐人数 */
  players: string;
  /** 角标：便当群岛是"快图"（一局短），早餐吐司桥是"慢图"（桥上不放出生点，掉出画本的少，一局长；策划 2026-10-21 定） */
  tag?: '快图' | '慢图';
}

export interface MapArt {
  theme: ThemeId;
  card: MapCard;
}

export const MAP_ART: Readonly<Record<MapId, MapArt>> = {
  ...MAP_ART2,
  kitchen: { theme: 'kitchen', card: {short: '什么都有一点，上手就选它', feature: '左山头挡平射；中间长台地有口井，炸井边能把人送下去；右边凹谷四面是崖，进去难出来；两块浮岛是高点', players: '1v1–3v3'} },
  icecream: { theme: 'icecream', card: {short: '平射过不去，只能高抛或者把塔打穿', feature: '三层高塔挡死平射，塔顶是全图最高点也最险；塔脚两颗冰淇淋球贴着塔，是躲高抛的死角；两边山坡起伏，坑多好藏', players: '1v1–3v3'} },
  dumpling: { theme: 'dumpling', card: {short: '躲进隧道，只有平射、钻地和窄缝打得着', feature: '山肚子里一段隧道：躲进去高抛打不着，拖鞋平射、萝卜钻能掏进去；隧道只在中间有底，山顶两侧打穿就直接掉出画本；山顶窄缝正对隧道中段，从蒸笼上往下垂直打；两头的大饺子是掩体', players: '1v1–3v3'} },
  bento: { theme: 'bento', card: {short: '快图：岛小又不连着，最容易掉出画本', feature: '每座岛都小而薄，两三炮就能把岛炸空；走不过去，换位置只能坐纸飞机；中间饭碗最大，碗上西兰花是制高点', players: '1v1–3v3', tag: '快图'} },
  nightmarket: { theme: 'nightmarket', card: {short: '雨棚挡高抛，两炮就穿；钻到棚下平射', feature: '四个雨棚两炮就穿：站棚上是高点，躲棚下高抛打不着，只怕平射；中间戏台高出一截，两道水沟把街切成三段', players: '1v1–3v3'} },
  breakfast: { theme: 'breakfast', card: {short: '桥薄得一炮就断，断了人就掉下去', feature: '法棍桥只有 44 厚，一炮就断，断开的那段原地悬着；桥上不放出生点，走上去全凭胆子；草莓、香肠、煎蛋浮在桥上方，是高点也挡高抛；右边马克杯是个坑，掉进去只能坐纸飞机出来', players: '1v1–3v3', tag: '慢图'} },
};
