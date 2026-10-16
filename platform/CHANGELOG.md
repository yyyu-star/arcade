# 平台（platform）更新日志

更早的版本没有单独的更新日志：各版本做了什么，见 `docs/platform-backend.md` 各节里的版本标注。

## 0.10.20

开源整改，线上行为不变（同一个域名、同一个库）：
- 仓库里不再写正式站的域名和 D1 的 id。正式部署时由工作流从 GitHub `production` 环境的 secret 注入：
  域名用 `--domain` 挂成自定义域名，`SITE_ORIGIN` 用 `--var` 注入；D1 的 id 由 `tools/deploy-config.ts` 写进一份不进 Git 的部署配置，迁移和部署都用它。
  id 没设或不像 id 时直接失败，不会让 wrangler 自动新建空库。
- `SITE_ORIGIN` 改成可选：设了照旧只认这个主机名；没设（一键部署）按请求自己的地址，写请求的同站检查照样挡得住跨站。
- 支持 Deploy to Cloudflare 一键部署：`.dev.vars.example` 列全 Secret 并写明说明，`package.json` 加 `cloudflare.bindings` 说明，
  `npm run deploy` 先跑 D1 迁移再部署；部署后绑自定义域名、建第一个管理员的步骤写在 README。
- 管理命令行工具（`npm run admin`）不再有默认地址，必须用 `--base` 或环境变量 `ARCADE_BASE_URL` 给。
- 恢复码图片上的站点地址改成当前页面的地址（`location.host`）。
- 测试里的域名换成 `game.example.com`；文档和注释去掉内部分工的说法；`package.json` 加 `"license": "MIT"`。
- 搬家前旧仓库的 PR 编号不再写成 `#NN`（公开仓库里会被链接到同号的无关 PR）：能靠版本号说清的删掉，其余写成"旧仓库 PR NN"。
