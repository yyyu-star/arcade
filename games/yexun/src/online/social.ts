/**
 * social 部件接线（DESIGN.md 14，kit 0.12 的 `arcade-kit/social`）：报位置（在菜单 / 守夜中 / 夜探中）、收好友邀请的横条。
 * 只在有平台且已登录时挂（mountSocial 自己判断，不满足返回 null，这里就什么都不做）。
 * 不 import kit：mountSocial 从外面传进来（装的 kit 到 0.12 才有 social），接线时 `createSocial({ mount: mountSocial, ... })`。
 */
export type Where = 'menu' | 'vigil' | 'raid';

interface PresenceLike {
  place: 'lobby' | 'game' | 'room';
  game?: string;
  room?: string;
  seats?: string;
}

interface InviteLike {
  game: string;
  room: string;
}

interface HandleLike {
  presenceNow(force?: boolean): void;
  pollNow(): void;
  stop(): void;
}

export interface SocialDeps {
  mount(opts: {
    where(): PresenceLike | null;
    gameName?(id: string): string | undefined;
    onGo?(invite: InviteLike): void;
    platform?: unknown;
    log?(line: string): void;
  }): Promise<HandleLike | null>;
  /** detectPlatform 的结果（启动时已经问过 /api/me 的传进来，省一次请求） */
  platform?: unknown;
  /** 点横条上的"去"：正在打的局先要玩家确认离开（并补传云存档）；没给就直接去 */
  confirmLeave?(go: () => void): void;
  /** 默认的"去"：跳到 /games/<id>/?room=<码> */
  go?(invite: InviteLike): void;
  log?(line: string): void;
}

export interface Social {
  start(): Promise<boolean>;
  /** 进了菜单 / 开了一局：马上报一次（kit 自己节流，离上次不到 2 分钟不会重复写） */
  setWhere(w: Where): void;
  stop(): void;
}

export function createSocial(deps: SocialDeps): Social {
  let where: Where = 'menu';
  let handle: HandleLike | null = null;
  return {
    async start() {
      handle = await deps.mount({
        // 夜巡没有房间：位置就是"在夜巡里"；菜单 / 守夜 / 夜探的区别要 kit 的 Presence 带一个可选 label 才能传给平台（见交付清单）
        where: () => ({ place: 'game', game: 'yexun' }),
        gameName: (id) => (id === 'yexun' ? '夜巡' : undefined),
        ...(deps.platform !== undefined ? { platform: deps.platform } : {}),
        // 玩着的时候（不在菜单）点"去"先确认
        onGo: (inv) => {
          const go = (): void => (deps.go ?? defaultGo)(inv);
          if (where !== 'menu' && deps.confirmLeave) deps.confirmLeave(go);
          else go();
        },
        ...(deps.log ? { log: deps.log } : {}),
      });
      return handle !== null;
    },
    setWhere(w) {
      where = w;
      handle?.presenceNow();
    },
    stop() {
      handle?.stop();
      handle = null;
    },
  };
}

function defaultGo(inv: InviteLike): void {
  location.href = `/games/${encodeURIComponent(inv.game)}/?room=${encodeURIComponent(inv.room)}`;
}
