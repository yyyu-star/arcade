import type Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, LEGACY_PHONE, PHONE, RENDER_SCALE, VIEW } from './theme.ts';

/** 按手机布局搭的场景（setupCamera 时登记，不靠比较相机缩放来猜）；值是它用的世界尺寸 */
const phoneScenes = new WeakMap<object, { w: number; h: number }>();

/**
 * 场景在手机上怎么布局：true = 按手机世界（VIEW）布局；'legacy' = 0.19.0 还没重排、仍按旧的 960×444 布局，
 * 整体缩放进手机世界；false = 只有电脑布局（1280×720），整体缩小放进来。
 */
export type PhoneReady = boolean | 'legacy';

/**
 * 相机怎么摆（0.5.5）：电脑上，或手机上适配过的场景（phoneReady），按渲染倍数 1:1 显示世界；
 * 手机上没适配的场景（1280×720）和 0.19.0 还没重排的场景（960×444）整体缩小、居中放进手机世界。
 *
 * 0.14.0（art-v3 ①）画布用 EXPAND：窗口和世界比例不同时画布在一个方向上变长（以前是两边留空条），
 * 相机把世界居中，多出来的边由各场景画宽一些的背景填满。
 * size 是画布的实际像素尺寸（Phaser 的 gameSize），不给时按正好是世界尺寸算。
 */
export function cameraFor(
  phoneReady: PhoneReady,
  phone = PHONE,
  scale = RENDER_SCALE,
  size?: { w: number; h: number },
  view: { w: number; h: number } = VIEW,
): { zoom: number; scrollX: number; scrollY: number; phoneLayout: boolean; world: { w: number; h: number } } {
  const sz = size ?? { w: view.w * scale, h: view.h * scale };
  // 世界内容的尺寸：手机上没适配的场景按 1280×720，没重排的按 960×444
  const world = !phone ? { w: GAME_WIDTH, h: GAME_HEIGHT } : phoneReady === true ? view : phoneReady === 'legacy' ? LEGACY_PHONE : { w: GAME_WIDTH, h: GAME_HEIGHT };
  const k = Math.min(view.w / world.w, view.h / world.h, 1);
  const zoom = scale * k;
  return { zoom, scrollX: (world.w - sz.w / zoom) / 2, scrollY: (world.h - sz.h / zoom) / 2, phoneLayout: phone && phoneReady !== false, world };
}

/** 每个场景只挂一次窗口缩放的监听（场景重启时 create 会再调 applyCamera） */
const resizeBound = new WeakSet<object>();

/** 按 cameraFor 设好场景的相机，并登记这个场景是不是手机布局；窗口缩放（EXPAND 下画布尺寸会变）后重摆。 */
export function applyCamera(scene: Phaser.Scene, phoneReady: PhoneReady): void {
  const g = scene.scale.gameSize;
  const c = cameraFor(phoneReady, PHONE, RENDER_SCALE, { w: g.width, h: g.height });
  scene.cameras.main.setOrigin(0, 0).setSize(g.width, g.height).setZoom(c.zoom).setScroll(c.scrollX, c.scrollY);
  if (c.phoneLayout) phoneScenes.set(scene, c.world);
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
  return (PHONE && phoneScenes.get(scene)) || { w: GAME_WIDTH, h: GAME_HEIGHT };
}

/** 0.19.0 这个场景是不是按新的手机世界（VIEW）布局：字号、点击区的手机下限只对它生效（没重排的场景还按旧尺寸排，抬了会挤） */
export function phoneNew(scene: Phaser.Scene): boolean {
  const v = PHONE ? phoneScenes.get(scene) : undefined;
  return !!v && v.h === VIEW.h && v.w === VIEW.w;
}

/** 这个场景是不是按手机布局（960×444）。 */
export function phoneLayout(scene: Phaser.Scene): boolean {
  return PHONE && phoneScenes.has(scene);
}
