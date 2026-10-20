/**
 * 站点描述：生成器的输入，和仓库无关的中立格式。字段基本就是 wrangler 配置里本站用到的那部分（规范化之后），
 * 外加构建产物的位置。仓库里由 tools/selfhost/build.mjs 从各模块的 wrangler.jsonc 加部署工具的叠加规则生成，
 * 别的仓库照这个格式自己写一份也能用。所有路径都是绝对路径。
 */
export interface Site {
  /** 没被任何路由接走的请求给谁（本仓库是平台 arcade） */
  fallback: string;
  workers: SiteWorker[];
}

export interface SiteWorker {
  /** Worker 名；服务绑定按这个名字指过来 */
  name: string;
  /** 打包好的入口（单个 ES 模块，wrangler deploy --dry-run --outdir 的产物） */
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  /** 字符串是 text 绑定，别的（对象、数字、布尔）是 json 绑定，和 wrangler 一样 */
  vars?: Record<string, unknown>;
  /** Secret 名：运行时从同名环境变量取（systemd 的 EnvironmentFile、docker 的 env_file） */
  secrets?: string[];
  services?: { binding: string; service: string; entrypoint?: string; props?: Record<string, unknown> }[];
  durable_objects?: { name: string; class_name: string }[];
  d1_databases?: {
    binding: string;
    database_name: string;
    migrations_dir: string;
    /** PG 模式用：PG 版的迁移目录（文件名和 SQLite 版一一对应）、覆盖表（JSON：规范化后的 SQLite 语句 → PG 版） */
    pg?: { migrations_dir: string; overrides?: string };
  }[];
  assets?: {
    directory: string;
    binding?: string;
    html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
    not_found_handling?: 'none' | 'single-page-application' | '404-page';
    run_worker_first?: string[] | boolean;
  };
  crons?: string[];
  /** 路径路由（不带主机名），比如 /games/texas、/games/texas/*；不写就只能经 fallback 或服务绑定到达 */
  routes?: string[];
}
