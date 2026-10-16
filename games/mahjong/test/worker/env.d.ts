import type { Env as WorkerEnv } from '../../worker/main.ts';
import type { FakeEnv } from 'arcade-kit/testing';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv, FakeEnv {}
    interface GlobalProps {
      mainModule: typeof import('./entry.ts');
    }
  }
}
