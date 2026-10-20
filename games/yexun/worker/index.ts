/** 夜巡的 Worker 入口：只导出 default（具名导出会让单独部署的 Worker 起不来），路由在 ./route.ts */
import { route, type Env } from './route.ts';

export default { fetch: route } satisfies ExportedHandler<Env>;
