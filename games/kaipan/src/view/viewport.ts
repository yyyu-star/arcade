import type Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PHONE, RENDER_SCALE, VIEW } from './theme.ts';

/** 按手机布局（960×444）搭的场景。setupCamera 时登记，不靠比较相机缩放来猜。 */
const phoneScenes = new WeakSet<object>();

/**
 * 相机怎么摆（0.5.5）：电脑上，或手机上适配过的场景（phoneReady），按渲染倍数 1:1 显示世界；
 * 手机上还按 1280×720 布局的场景整体缩小、居中放进 960×444（和以前在手机上看到的一样大）。
 *
 * 0.14.0（art-v3 ①）画布用 EXPAND：窗口不是 16:9 时画布在一个方向上变长（以前是两边留空条），
 * 世界仍按 1280×720（手机 960×444）布局，相机把它居中，多出来的边由各场景画宽一些的背景填满。
 * size 是画布的实际像素尺寸（Phaser 的 gameSize），不给时按正好 16:9 算。
 */
export function cameraFor(
  phoneReady: boolean,
  phone = PHONE,
  scale = RENDER_SCALE,
  size: { w: number; h: number } = phone ? { w: VIEW_PHONE.w * scale, h: VIEW_PHONE.h * scale } : { w: GAME_WIDTH * scale, h: GAME_HEIGHT * scale },
): { zoom: number; scrollX: number; scrollY: number; phoneLayout: boolean } {
  const fit = phone && !phoneReady;
  const k = fit ? Math.min(VIEW_PHONE.w / GAME_WIDTH, VIEW_PHONE.h / GAME_HEIGHT) : 1;
  const zoom = scale * k;
  // 世界内容的尺寸：手机上没适配的场景仍按 1280×720 布局
  const W = fit ? GAME_WIDTH : phone ? VIEW_PHONE.w : GAME_WIDTH;
  const H = fit ? GAME_HEIGHT : phone ? VIEW_PHONE.h : GAME_HEIGHT;
  return { zoom, scrollX: (W - size.w / zoom) / 2, scrollY: (H - size.h / zoom) / 2, phoneLayout: phone && !fit };
}

/** 手机的世界尺寸（VIEW 在电脑上是 1280×720，这里单独写一份给 cameraFor 算兜底用） */
const VIEW_PHONE = { w: 960, h: 444 };

/** 每个场景只挂一次窗口缩放的监听（场景重启时 create 会再调 applyCamera） */
const resizeBound = new WeakSet<object>();

/** 按 cameraFor 设好场景的相机，并登记这个场景是不是手机布局；窗口缩放（EXPAND 下画布尺寸会变）后重摆。 */
export function applyCamera(scene: Phaser.Scene, phoneReady: boolean): void {
  const g = scene.scale.gameSize;
  const c = cameraFor(phoneReady, PHONE, RENDER_SCALE, { w: g.width, h: g.height });
  scene.cameras.main.setOrigin(0, 0).setSize(g.width, g.height).setZoom(c.zoom).setScroll(c.scrollX, c.scrollY);
  if (c.phoneLayout) phoneScenes.add(scene);
  else phoneScenes.delete(scene);
  if (resizeBound.has(scene)) return;
  resizeBound.add(scene);
  const onResize = (): void => {
    if (scene.sys.isActive()) applyCamera(scene, phoneReady);
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => {
    scene.scale.off('resize', onResize);
    resizeBound.delete(scene);
  });
}

/**
 * 画面实际看得见的世界范围（EXPAND 下比 1280×720 宽或高）：铺满的背景按它画。
 * 窗口缩放后会变，背景要么画得比它大，要么在 resize 时重画。
 */
export function bleedOf(scene: Phaser.Scene): { x: number; y: number; w: number; h: number } {
  const cam = scene.cameras.main;
  return { x: cam.scrollX, y: cam.scrollY, w: cam.width / cam.zoom, h: cam.height / cam.zoom };
}

/**
 * 全屏遮罩、点击挡板用的范围：比任何看得见的范围都大（安全区的三倍），窗口怎么缩放都盖得住，不用跟着重画。
 */
export function coverOf(scene: Phaser.Scene): { x: number; y: number; w: number; h: number } {
  const V = viewOf(scene);
  return { x: -V.w, y: -V.h, w: V.w * 3, h: V.h * 3 };
}

/**
 * 场景实际在用的世界尺寸：电脑上一律 1280×720；手机上适配过的场景是 960×444，
 * 还没适配的场景整体缩小放进来、仍按 1280×720 布局。
 * 遮罩、居中弹窗、悬停说明的夹紧都按它来，不直接用 GAME_WIDTH / GAME_HEIGHT。
 */
export function viewOf(scene: Phaser.Scene): { w: number; h: number } {
  return PHONE && phoneScenes.has(scene) ? VIEW : { w: GAME_WIDTH, h: GAME_HEIGHT };
}

/** 这个场景是不是按手机布局（960×444）。 */
export function phoneLayout(scene: Phaser.Scene): boolean {
  return PHONE && phoneScenes.has(scene);
}
