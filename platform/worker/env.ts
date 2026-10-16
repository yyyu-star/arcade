/** 平台 Worker 的绑定（wrangler.jsonc）。Secret 不进 Git，用 wrangler secret put 设置（列表见 .dev.vars.example）。 */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /**
   * 站点地址，如 https://game.example.com：设了，/api 只认这个主机名，写请求的 Origin 必须等于它；
   * 没设就按请求自己的地址（Deploy to Cloudflare 一键部署时）。正式部署由工作流用 --var 注入（README 的部署一节）。
   */
  SITE_ORIGIN?: string;
  /** 覆盖 api/config.ts 里的默认上限，只写要改的项。 */
  LIMITS?: Partial<Record<string, unknown>>;
  /** 注册的紧急总闸：只有 "switch" 听管理员的开关（D1 settings，0.8.0），其他值（包括没设）一律关（worker/api/settings.ts）。 */
  REGISTRATION?: string;
  /** 管理接口的令牌（Secret），值写成 "<kid>:<随机串>"，只给维护者的命令行工具用（tools/admin.ts）。没设就不认任何令牌。 */
  ADMIN_TOKEN?: string;
  /** 紧急开关（Secret）：normal / readonly / off，不设按 normal（docs/platform-backend.md 6.6）。 */
  API_MODE?: string;
  /** pepper（Secret），值写成 "<kid>:<随机串>"；*_PREV 是换 pepper 后还要认的旧值。 */
  PEPPER_PW?: string;
  PEPPER_PW_PREV?: string;
  PEPPER_RC?: string;
  PEPPER_RC_PREV?: string;
  PEPPER_SID?: string;
  PEPPER_SID_PREV?: string;
  PEPPER_IP?: string;
}
