# tools/selfhost：自托管（不用 Cloudflare，自己的机器上跑全站）

运行时和生成器在 [`packages/arcade-host`](../../packages/arcade-host/README.md)（为什么这样做、和 Cloudflare 有哪些差别见它的 `docs/verify.md`）。
这里是仓库里的用法：读各模块的 `wrangler.jsonc`，按部署工具同一套规则叠加平台绑定，打成发布包，再加上运维脚本和模板。
**Cloudflare 上的正式站不受影响**：这里不改任何模块，也不碰 `tools/deployer` 的部署流程。

服务器上只要 workerd 一个二进制（发布包里带着）和 bash、curl、tar，不装 Node；Node 只在打包的机器上用。

## 打包

```sh
npm ci --ignore-scripts --prefix tools/deployer          # 钉死的 wrangler（读配置、白名单检查）
(cd packages/arcade-host && npm ci && npm run build)     # 运行时
tools/selfhost/pack-all.sh <产物目录>                     # 各模块 npm ci、构建、wrangler --dry-run 打包（不写名字就是 tools/workers.json 里全部）
tools/selfhost/release.sh <产物目录> <输出目录>           # → <输出目录>/arcade-<版本>.tar.gz
```

`release.sh` 后面可以接 `build.mjs` 的参数：`--only arcade,texas`（只要这几个，必须带平台）、`--storage memory`（不落盘，PostgreSQL 模式的底子，还没做完）。

| 文件 | 做什么 |
|---|---|
| `build.mjs` | 站点描述 → 发布目录。规则和 `tools/deployer/deploy.mjs` 一样：`checkSourceConfig` 白名单检查、`platformOverlay` 叠加 `ARCADE`/`WALLET` 和 `GATE=login`、游戏路由 `/games/<id>` 和 `/games/<id>/*`；`SITE_ORIGIN` 和平台的 Secret 运行时从环境变量取 |
| `pack-all.sh` | 各模块打成部署作业收的那种产物 |
| `release.sh` | 发布目录 + `bin/workerd`（`packages/arcade-host` 钉死的版本）+ `bin/arcade` 启动脚本 + `ops/` 运维脚本 → tar.gz |
| `arcade.sh` | 发布包里的 `bin/arcade`：在发布目录里起 workerd；管理入口不是回环地址就拒绝启动 |
| `smoke.mjs` | 全站冒烟（不用浏览器）：静态和路由、建号登录、德州单机带入结回、好友房 WebSocket、定时任务、导出 |
| `backup.sh`、`restore.sh`、`restore-drill.sh` | 逻辑备份（每个库导出 SQL + 房间目录快照）、恢复、恢复演练（临时端口起同一个发布包，导入再导出必须逐字节一样） |
| `install.sh`、`upgrade.sh`、`rollback.sh` | 第一次安装、升级（先备份、换软链接、等健康检查，起不来自动切回）、回滚 |
| `systemd/arcade.service` | systemd 单元（只听 127.0.0.1、只能写数据目录） |
| `Caddyfile` | HTTPS、用真实地址覆盖 `cf-connecting-ip`、挡 `/cdn-cgi` |
| `docker/Dockerfile`、`docker/compose.yaml` | 镜像（上下文是发布目录）和 arcade + caddy 的 compose（postgres 先占位） |

## 二进制部署（systemd）

```sh
tar -xzf arcade-<版本>.tar.gz
sudo arcade-<版本>/ops/install.sh arcade-<版本>.tar.gz game.example.com
```

- 目录：`/opt/arcade/releases/<版本>/` + `/opt/arcade/current` 软链接；数据 `/var/lib/arcade/data`；Secret `/etc/arcade/secrets.env`（root:arcade 640）。
- Secret：`install.sh` 第一次会生成 `SITE_ORIGIN`、`PEPPER_PW`、`PEPPER_RC`、`PEPPER_SID`、`PEPPER_IP`、`ADMIN_TOKEN`（格式 `<kid>:<随机串>`，见 `platform/.dev.vars.example`），只写文件不打印。
  pepper 用上之后不能丢（库里的哈希靠它），和备份分开另存一份。
- Caddy：`apt install caddy`，`ops/Caddyfile` 拷到 `/etc/caddy/Caddyfile`，`/etc/default/caddy` 里写 `SITE_HOST=<主机名>`。
- 日志：`journalctl -u arcade`（一行一个 JSON）。
- 升级：`sudo /opt/arcade/current/ops/upgrade.sh arcade-<新版本>.tar.gz`（先备份到 `/var/lib/arcade/backups`，起不来自动切回）；回滚：`sudo /opt/arcade/current/ops/rollback.sh`。
  迁移只加不删，旧版本代码认新的库；要连数据一起回到某个时间点，用 `restore.sh` 导入那时的备份。
- 备份：每晚 `ops/backup.sh /var/lib/arcade/backups`（cron 或 systemd timer），再传到异地；隔一段时间跑一次 `ops/restore-drill.sh /opt/arcade/current <备份目录>`。

管理入口（备份、恢复、手动跑定时任务）只听 `127.0.0.1:8788`，没有认证：生成器和启动脚本都不许它听别的地址。

## Docker

```sh
tar -xzf arcade-<版本>.tar.gz
docker build -f tools/selfhost/docker/Dockerfile -t arcade:<版本> arcade-<版本>
cd tools/selfhost/docker && cp <你的 secrets.env> secrets.env
SITE_HOST=game.example.com ARCADE_IMAGE=arcade:<版本> docker compose up -d
docker compose exec arcade /app/ops/backup.sh /data/backups     # 备份（管理入口只在容器里）
```

站点只给 caddy 经内部网络连（不发布到宿主）；管理入口只听容器内的 127.0.0.1。

## 验证

`.github/workflows/selfhost.yml`：打平台和德州 → 发布包 → 二进制起一次（冒烟、备份、恢复演练）→ 同一个包做成镜像起一次（冒烟，容器里跑备份和定时任务）。
