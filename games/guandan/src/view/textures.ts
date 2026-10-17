/**
 * 把美术模块生成的 SVG 字符串烘焙成 Phaser 纹理：按 RENDER_SCALE 倍的像素尺寸栅格化（SVG 根节点的 width/height
 * 直接改成目标像素，浏览器按矢量重画，不是位图放大），再 addCanvas。显示时用 setDisplaySize 回到世界尺寸。
 */
import type Phaser from 'phaser';
import {
  avatarSvg,
  cardBackSvg,
  cardFaceSvg,
  iconSvg,
  levelMarkSvg,
  logoSvg,
  particleSvg,
  stampSvg,
  tableSvg,
  titleArtSvg,
  wildMarkSvg,
  type AvatarId,
  type IconName,
  type Mood,
} from './art/index.ts';
import { app } from './app.ts';
import { withSvgFont } from './fonts.ts';
import { RENDER_SCALE } from './theme.ts';

/** 牌的烘焙尺寸（世界单位）；手牌约 92 宽，略大一点烘焙，缩小显示更锐利。 */
export const CARD_W = 100;
export const CARD_H = 140;

const AVATARS: AvatarId[] = ['me', 'laozhang', 'xiaomei', 'aqiang'];
const MOODS: Mood[] = ['normal', 'happy', 'sad', 'think', 'smug'];
const ICONS: IconName[] = [
  'play', 'pass', 'hint', 'sort', 'undo', 'settings', 'rules', 'sound', 'mute', 'back',
  'stats', 'home', 'close', 'check', 'crown', 'bomb', 'cards', 'robot', 'speed', 'restart',
  'cloudOff', 'cloudCheck', 'cloudSync', 'cloudUp', 'cloudMerge', 'chat', 'invite', 'smile', 'share',
];
const STAMPS: Record<string, string> = {
  头游: '#c8202a',
  二游: '#b0702a',
  三游: '#5a6a7a',
  末游: '#5a5550',
  接风: '#c8202a',
  抗贡: '#7a2a9a',
};
const PARTICLES = ['spark', 'petal', 'coin', 'confetti', 'star', 'smoke'] as const;

export function cardKey(c: number): string {
  const i = c % 54;
  if (i === 52) return 'card:16';
  if (i === 53) return 'card:17';
  return `card:${(i % 13) + 2}:${Math.floor(i / 13)}`;
}

function sized(svg: string, pw: number, ph: number): string {
  // 改根节点的 width/height，保留 viewBox，让浏览器按目标像素矢量栅格化
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const rest = attrs.replace(/\s(width|height)="[^"]*"/g, '');
    return `<svg${rest} width="${pw}" height="${ph}">`;
  });
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG 解码失败'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

interface Job {
  key: string;
  svg: () => string;
  w: number;
  h: number;
  /** 大图限制像素尺寸（部分手机最大纹理 4096） */
  maxPx?: number;
}

async function bake(scene: Phaser.Scene, job: Job): Promise<void> {
  if (scene.textures.exists(job.key)) return;
  let s = RENDER_SCALE;
  if (job.maxPx) s = Math.min(s, job.maxPx / Math.max(job.w, job.h));
  const pw = Math.max(1, Math.round(job.w * s));
  const ph = Math.max(1, Math.round(job.h * s));
  const img = await loadImage(withSvgFont(sized(job.svg(), pw, ph)));
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  ctx.drawImage(img, 0, 0, pw, ph);
  if (scene.textures.exists(job.key)) return;
  scene.textures.addCanvas(job.key, canvas);
}

function jobsCore(): Job[] {
  const jobs: Job[] = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) jobs.push({ key: `card:${r}:${s}`, svg: () => cardFaceSvg(r, s), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'card:16', svg: () => cardFaceSvg(16, -1), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'card:17', svg: () => cardFaceSvg(17, -1), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'back:0', svg: () => cardBackSvg(0), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'back:1', svg: () => cardBackSvg(1), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'mark:level', svg: () => levelMarkSvg(), w: CARD_W, h: CARD_H });
  jobs.push({ key: 'mark:wild', svg: () => wildMarkSvg(), w: CARD_W, h: CARD_H });
  for (const a of AVATARS) for (const m of MOODS) jobs.push({ key: `avatar:${a}:${m}`, svg: () => avatarSvg(a, m), w: 128, h: 128 });
  for (const i of ICONS) jobs.push({ key: `icon:${i}`, svg: () => iconSvg(i, '#ffffff'), w: 48, h: 48 });
  for (const [t, c] of Object.entries(STAMPS)) jobs.push({ key: `stamp:${t}`, svg: () => stampSvg(t, c), w: 150, h: 150 });
  for (const p of PARTICLES) jobs.push({ key: `particle:${p}`, svg: () => particleSvg(p), w: 32, h: 32 });
  // 0.3.0 起好友房一直露出，logo 上不再盖"单机版"的印章
  jobs.push({ key: 'logo', svg: () => logoSvg(false), w: 520, h: 220 });
  return jobs;
}

/** 启动时烘焙全部小素材；onProgress 0..1。 */
export async function bakeAll(scene: Phaser.Scene, onProgress: (p: number) => void): Promise<void> {
  const jobs = jobsCore();
  let done = 0;
  const step = async (j: Job): Promise<void> => {
    await bake(scene, j);
    done++;
    onProgress(done / jobs.length);
  };
  // 分批并发，避免一次塞几百个解码任务卡住主线程
  for (let i = 0; i < jobs.length; i += 12) await Promise.all(jobs.slice(i, i + 12).map(step));
}

/**
 * 背景大图随世界宽度变化，按需烘焙（key 带宽度）。iOS Safari 地址栏一收一放、转屏都会换宽度，
 * 旧宽度的两张不删就越攒越多（2 倍渲染时一套约 28 MB），换完画面后用 dropBackdrops 删掉。
 */
export async function ensureBackdrops(scene: Phaser.Scene, w: number, h: number): Promise<{ table: string; title: string }> {
  const table = `table:${w}`;
  const title = `title:${w}`;
  await Promise.all([
    bake(scene, { key: table, svg: () => tableSvg(w, h), w, h, maxPx: 4096 }),
    bake(scene, { key: title, svg: () => titleArtSvg(w, h), w, h, maxPx: 4096 }),
  ]);
  return { table, title };
}

/** 删掉不是这个宽度的背景大图（场景已经换用新宽度之后再调） */
export function dropBackdrops(scene: Phaser.Scene, keepW: number): void {
  for (const key of scene.textures.getTextureKeys()) {
    const m = /^(table|title):(\d+)$/.exec(key);
    if (!m || Number(m[2]) === keepW) continue;
    const src = scene.textures.get(key).getSourceImage();
    scene.textures.remove(key);
    // WebKit 的画布内存要等垃圾回收才还，先把尺寸清零让它马上还
    if (src instanceof HTMLCanvasElement) src.width = src.height = 0;
  }
}
