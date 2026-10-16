/**
 * window.__game：只读为主的调试桥（开发模式或 ?debug=1 时挂载），冒烟脚本靠它等待状态、取控件坐标。
 * 推进状态只走和玩家相同的路径（TableScene.debugDispatch → Session.apply → 核心 dispatch）。
 */
import type Phaser from 'phaser';
import type { Action, Card, GameState, PlayerView } from '../core/index.ts';
import { anim } from '../view/anim.ts';
import { app } from '../view/app.ts';
import { audio } from '../view/audio.ts';
import { lobbySession } from '../view/online.ts';
import { loadStake } from '../view/stake.ts';
import type { StakeView } from '../net/stake.ts';
import type { TableScene } from '../view/scenes/TableScene.ts';
import type { TitleScene } from '../view/scenes/TitleScene.ts';
import { GAME_HEIGHT, RENDER_SCALE } from '../view/theme.ts';
import { focusedAt } from '../view/ui/focus.ts';
import { tutorialState } from '../view/tutorial.ts';

type Pt = { x: number; y: number };

interface GameBridge {
  readonly ready: boolean;
  readonly scene: string | null;
  /** 牌桌没在播动画、电脑没在想；标题页总是 idle */
  readonly idle: boolean;
  readonly overlay: string | null;
  readonly tutorialStep: number;
  readonly renderScale: number;
  readonly bootMs: number;
  /** #app 改过几次尺寸 */
  readonly fits: number;
  /** 牌桌画面建过几次（重排会重建） */
  readonly builds: number;
  readonly fxLog: string[];
  readonly lastError: string | null;
  readonly sfx: string[];
  state(): GameState | null;
  view(): PlayerView | null;
  /** 世界坐标 → 页面 CSS 坐标 */
  toScreen(p: Pt): Pt;
  /** 主要控件（页面 CSS 坐标） */
  controls(): Record<string, Pt & { enabled?: boolean; visible?: boolean }>;
  /**
   * 现在点得到的东西的点按区域（页面 CSS 坐标的矩形，0.9.0）：冒烟查有没有小于 44 CSS 像素、有没有互相压着的。
   * 只列看得见、开着输入的；整屏挡点击的遮罩（和画面一样大）不算。
   */
  hits(): { x: number; y: number; w: number; h: number; kind: string }[];
  /** 键盘焦点停在哪（页面 CSS 坐标的中心），没在用键盘时是 null（0.9.0） */
  focused(): Pt | null;
  /** 手牌某张牌露出部分的中心（页面 CSS 坐标） */
  cardPoint(c: Card): Pt | null;
  selected(): Card[];
  dispatch(a: Action): string | null;
  setAutoplay(on: boolean): void;
  setInstant(on: boolean): void;
  open(kind: 'settings' | 'rules'): void;
  closeOverlay(): void;
  toTitle(): void;
  stats(): { tweens: number; textures: number; objects: number };
  /** 内存估算（像素数）：纹理按 key 前缀分组、在场文字各自的画布、主画布；tools/mem.ts 用 */
  memory(): { textures: Record<string, number>; text: number; texts: number; canvas: number; webgl: boolean };
  /** 联机会话：房间码、我的真实座位、连接状态、房间状态、座位、最近的错误、排队的帧数 */
  net(): { code: string; seat: number | null; status: string; closeCode: number | null; closeReason: string | null; room: string | null; seats: string[]; error: string | null; queue: number; pending: boolean; stake: StakeView | null } | null;
  /** 云存档状态（云朵图标显示的） */
  cloud(): { status: string; note: string | null } | null;
  /** 单机实盘：本机的实盘存档（没有为 null）和牌桌上这一场结算的结果 */
  stake(): { save: { ref: string; tier: string; deals: number[]; settle: { points: number; deals: number } | null; until: number } | null; outcome: unknown } | null;
}

declare global {
  interface Window {
    __game?: GameBridge;
  }
}

export function mountBridge(game: Phaser.Game): void {
  const active = (): Phaser.Scene | null => game.scene.getScenes(true)[0] ?? null;
  const table = (): TableScene | null => {
    const s = active();
    return s && s.scene.key === 'table' ? (s as TableScene) : null;
  };
  const toScreen = (p: Pt): Pt => {
    const r = game.canvas.getBoundingClientRect();
    const f = r.width / (game.scale.gameSize.width / RENDER_SCALE);
    return { x: Math.round(r.left + p.x * f), y: Math.round(r.top + p.y * f) };
  };
  window.__game = {
    get ready() {
      return app.ready;
    },
    get scene() {
      return active()?.scene.key ?? null;
    },
    get idle() {
      const t = table();
      return t ? !t.isBusy : true;
    },
    get overlay() {
      return table()?.overlay ?? null;
    },
    get tutorialStep() {
      return tutorialState.step;
    },
    renderScale: RENDER_SCALE,
    get bootMs() {
      return app.bootMs;
    },
    get fits() {
      return app.fits;
    },
    get builds() {
      return table()?.builds ?? 0;
    },
    get fxLog() {
      return [...(table()?.fxLog ?? [])];
    },
    get lastError() {
      return table()?.lastError ?? null;
    },
    get sfx() {
      return audio.log.map((l) => l.name);
    },
    state: () => app.session?.state ?? null,
    view: () => (app.net?.shown ? app.net.view() : (app.session?.view() ?? null)),
    toScreen,
    controls: () => {
      const out: Record<string, Pt & { enabled?: boolean; visible?: boolean }> = {};
      const s = active();
      if (!s) return out;
      if (s.scene.key === 'title') {
        for (const [k, p] of Object.entries((s as TitleScene).controls())) out[k] = toScreen(p);
      } else if (s.scene.key === 'table') {
        for (const [k, p] of Object.entries((s as TableScene).controls())) out[k] = { ...toScreen(p), enabled: p.enabled, visible: p.visible };
      }
      if (tutorialState.step >= 0) for (const [k, p] of Object.entries(tutorialState.buttons)) out[`tutorial:${k}`] = toScreen(p);
      return out;
    },
    hits: () => {
      const s = active();
      if (!s) return [];
      const out: { x: number; y: number; w: number; h: number; kind: string }[] = [];
      const W = s.scale.gameSize.width / RENDER_SCALE;
      const shown = (o: Phaser.GameObjects.GameObject): boolean => {
        for (let p: Phaser.GameObjects.GameObject | null = o; p; p = p.parentContainer) {
          const v = p as unknown as { visible?: boolean; alpha?: number; active: boolean };
          if (!v.active || v.visible === false || (v.alpha !== undefined && v.alpha < 0.05)) return false;
        }
        return true;
      };
      const list = (s.input as unknown as { _list: Phaser.GameObjects.GameObject[] })._list.filter((o) => o.input?.enabled && shown(o));
      // 整屏挡点击的遮罩（弹窗、引导）下面的点不到：只看最上面那层遮罩所在的层和更上面的
      const top = (o: Phaser.GameObjects.GameObject): Phaser.GameObjects.GameObject => {
        let t = o;
        while (t.parentContainer) t = t.parentContainer;
        return t;
      };
      const depth = (o: Phaser.GameObjects.GameObject): number => {
        const t = top(o);
        return (t as unknown as { depth: number }).depth * 1e6 + s.children.getIndex(t);
      };
      const full = (o: Phaser.GameObjects.GameObject): boolean => {
        const r = o.input!.hitArea as Phaser.Geom.Rectangle;
        return r.width >= W - 1 && r.height >= GAME_HEIGHT - 1;
      };
      const floor = Math.max(-Infinity, ...list.filter(full).map(depth));
      for (const o of list) {
        const inp = o.input!;
        if (depth(o) < floor) continue;
        // 只认矩形的点按区域（按钮、区域、头像都是）；Phaser 的类型是运行时的，这里只按形状认
        const r = inp.hitArea as Phaser.Geom.Rectangle;
        if (typeof r?.width !== 'number' || typeof r.right !== 'number') continue;
        const t = o as unknown as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Origin;
        const m = t.getWorldTransformMatrix();
        const a = m.transformPoint(r.x - (t.displayOriginX ?? 0), r.y - (t.displayOriginY ?? 0));
        const b = m.transformPoint(r.right - (t.displayOriginX ?? 0), r.bottom - (t.displayOriginY ?? 0));
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        if (w >= W - 1 && h >= GAME_HEIGHT - 1) continue;
        const p0 = toScreen({ x: x0, y: y0 });
        const p1 = toScreen({ x: x0 + w, y: y0 + h });
        out.push({ x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y, kind: o.type });
      }
      return out;
    },
    focused: () => {
      const s = active();
      const p = s ? focusedAt(s) : null;
      return p ? toScreen(p) : null;
    },
    cardPoint: (c) => {
      const p = table()?.cardPoint(c);
      return p ? toScreen(p) : null;
    },
    selected: () => table()?.handSelected() ?? [],
    dispatch: (a) => table()?.debugDispatch(a) ?? '不在牌桌',
    setAutoplay: (on) => {
      if (app.session) app.session.autoplay = on;
      table()?.debugCloseOverlay();
    },
    setInstant: (on) => {
      anim.instant = on;
    },
    open: (kind) => table()?.debugOpen(kind),
    closeOverlay: () => table()?.debugCloseOverlay(),
    toTitle: () => active()?.scene.start('title'),
    cloud: () => (app.cloud ? { status: app.cloud.status, note: app.cloud.note } : null),
    stake: () => {
      const s = loadStake();
      return { save: s ? { ref: s.ref, tier: s.tier, deals: s.match.deals, settle: s.settle, until: s.until } : null, outcome: table()?.stakeOutcome ?? null };
    },
    net: () => {
      const n = app.net ?? lobbySession();
      if (!n) return null;
      return {
        code: n.code,
        seat: n.mySeat,
        status: n.status,
        closeCode: n.closeCode,
        closeReason: n.closeReason,
        room: n.room?.status ?? null,
        seats: n.room?.seats.map((s) => `${s.kind}${s.away ? ':away' : ''}${s.auto ? ':auto' : ''}`) ?? [],
        error: n.lastError,
        queue: n.queue.length,
        pending: n.pending !== null,
        // 好友房实盘：最新一帧里每个座位的账（按我的座位转过，我是 0 号）
        stake: n.queue[n.queue.length - 1]?.nv.stake ?? n.shown?.stake ?? null,
      };
    },
    stats: () => {
      const s = active();
      return {
        tweens: s ? s.tweens.getTweens().length : 0,
        textures: game.textures.getTextureKeys().length,
        objects: s ? s.children.length : 0,
      };
    },
    memory: () => {
      const textures: Record<string, number> = {};
      for (const key of game.textures.getTextureKeys()) {
        const g = key.split(':')[0] ?? key;
        for (const src of game.textures.get(key).source) textures[g] = (textures[g] ?? 0) + src.width * src.height;
      }
      // Text 不进纹理表，每个各占一张画布（销毁后回池子会缩成 1×1，不用算）
      let text = 0;
      let texts = 0;
      const walk = (list: Phaser.GameObjects.GameObject[]): void => {
        for (const o of list) {
          const c = (o as Partial<Phaser.GameObjects.Text>).canvas;
          if (o.type === 'Text' && c) {
            text += c.width * c.height;
            texts++;
          }
          const sub = (o as Partial<Phaser.GameObjects.Container>).list;
          if (Array.isArray(sub)) walk(sub);
        }
      };
      for (const sc of game.scene.getScenes(true)) walk(sc.children.list);
      return { textures, text, texts, canvas: game.canvas.width * game.canvas.height, webgl: game.renderer.type === 2 };
    },
  };
}
