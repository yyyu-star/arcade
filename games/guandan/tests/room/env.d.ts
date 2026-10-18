// tests/room 跑在 workerd 里：Workers 运行时的类型、cloudflare:test，以及测试 Worker 的绑定。
/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-plugin/types" />
import type { Env as GameEnv } from '../../worker/gate.ts';

declare global {
  namespace Cloudflare {
    interface Env extends Omit<GameEnv, 'ASSETS' | 'ROOM' | 'ARCADE' | 'MATCH'> {
      ROOM: DurableObjectNamespace;
      MATCH: DurableObjectNamespace;
      ARCADE: Fetcher;
      BANK: DurableObjectNamespace<import('./wallet.ts').WalletBank>;
    }
    interface GlobalProps {
      mainModule: typeof import('./main.ts');
    }
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    roomGames: number;
    roomGamesSolo: number;
    roomIdleRate: number;
  }
}
