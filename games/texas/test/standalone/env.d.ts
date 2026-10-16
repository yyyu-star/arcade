import type { Env as WorkerEnv } from '../../worker/main.ts';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: typeof import('../../worker/main.ts');
    }
  }
}
