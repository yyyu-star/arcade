/**
 * 主页（标题页）的排版（art-v3 PR ①，docs/art-v3.md 第 4 节）：纯函数，画背景的 SVG 和场景摆东西用同一份，宽屏时一起铺开。
 * 世界坐标高 720、宽 1280..1720。左边是主视觉（茶馆一角、四个人），右边一块面板放标题、主按钮、模式卡、战绩。
 */
import type { AvatarId, Mood } from './art/index.ts';

export interface HomeLayout {
  W: number;
  /** 主视觉占的宽度（面板左边再让出 24） */
  artW: number;
  panel: { x: number; y: number; w: number; h: number };
  /** 月洞窗中心和半径 */
  window: { x: number; y: number; r: number };
  /** 灯笼挂点（绳子的顶端）和缩放 */
  lanterns: { x: number; y: number; s: number }[];
  /** 四个人：头肩像底边中点、缩放、微微歪的角度 */
  figures: { id: AvatarId; mood: Mood; x: number; y: number; s: number; tilt: number }[];
  /** 桌子后沿、前沿的 y */
  table: { back: number; front: number };
}

/** 面板宽：1280 时 500，越宽越大，封顶 560（多出的宽度主要给主视觉） */
export function panelWidth(W: number): number {
  return Math.min(560, 500 + Math.round((W - 1280) * 0.25));
}

export function homeLayout(W: number): HomeLayout {
  const pw = panelWidth(W);
  const margin = 32;
  const panel = { x: W - margin - pw, y: 92, w: pw, h: 600 };
  const artW = panel.x - 24;
  const back = 486;
  // 四个人等距排在主视觉里，彼此压一点（像围坐），最右的一位不压到面板
  const order: [AvatarId, Mood, number, number][] = [
    ['laozhang', 'smug', 30, -4],
    ['xiaomei', 'normal', 20, 2],
    ['aqiang', 'happy', 26, 5],
    ['me', 'happy', 34, -3],
  ];
  const figures = order.map(([id, mood, dy, tilt], i) => ({ id, mood, x: Math.round(artW * (0.14 + 0.24 * i)), y: back + dy, s: 1.62, tilt }));
  return {
    W,
    artW,
    panel,
    window: { x: Math.round(artW * 0.46), y: 290, r: 230 },
    lanterns: [
      { x: Math.round(artW * 0.07), y: 10, s: 0.95 },
      { x: Math.round(artW * 0.84), y: 0, s: 0.8 },
    ],
    figures,
    table: { back, front: 640 },
  };
}

/** 头肩像纹理的原始尺寸（homeFigureSvg 的画布，底边中点在 (80, 160)） */
export const FIGURE_SIZE = { w: 160, h: 170, footY: 160 } as const;
/** 灯笼纹理的原始尺寸和挂点（lanternArtSvg） */
export const LANTERN_SIZE = { w: 120, h: 280, pivotY: 10 } as const;
