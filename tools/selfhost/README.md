# tools/selfhost：自托管（不用 Cloudflare，自己的机器上跑全站）

运行时和生成器在 [`packages/arcade-host`](../../packages/arcade-host/README.md)（和 Cloudflare 的对照见它的 `docs/verify.md`）。
这里是仓库里的用法：读各模块的 `wrangler.jsonc`，按部署工具同一套规则叠加平台绑定，打成发布包，再加上运维脚本和模板。
**Cloudflare 上的正式站不受影响**：这里不改任何模块，也不碰 `tools/deployer` 的部署流程。

服务器上只要 workerd 一个二进制（发布包里带着）和 bash、curl、tar，不装 Node；Node 只在打包的机器上用。

## 现状

- 存储部署时三选一（`build.mjs` 的 `--db`、`--storage`），之间不能混用：

  | 档 | 参数 | 平台库 | 房间 | 数据目录 |
  |---|---|---|---|---|
  | SQLite | 默认 | SQLite | SQLite | 要 |
  | PG | `--db pg` | PostgreSQL | SQLite | 要 |
  | PG 不落盘 | `--db pg --storage memory` | PostgreSQL | PostgreSQL | 不要 |

- **PG 不落盘要有房间的游戏都用 arcade-kit ≥ 0.21.0**（KIT_STORE），不够 `build.mjs` 直接报错，不生成。main 上现在（2026-10-20）都还不够：

  | 游戏 | arcade-kit | 有 Durable Object | PG 不落盘 |
  |---|---|---|---|
  | 掼蛋 guandan | 0.20.4 | 有 | 不行，要升 kit |
  | 麻将 mahjong | 0.20.4 | 有 | 不行，要升 kit |
  | 德州 texas | 0.20.4 | 有 | 不行，要升 kit（CI 里临时换成 0.21.0 测过，能用） |
  | 飞驰 racing | 0.10.1 | 有 | 不行，要升 kit |
  | 开盘 kaipan、夜巡 yexun | 0.15.1 | 没有 | 不受影响 |

  所以现在整站只能打 SQLite 档和 PG 档；PG 不落盘等这几个游戏升了 kit 再用（`--only` 挑出已升级的也行）。这张表照各游戏的 `package-lock.json`，游戏升级后跟着改。
- **没在真机上验证过的**：Caddy（HTTPS、证书、用真实地址覆盖 `cf-connecting-ip`）、systemd 单元、`install.sh`/`upgrade.sh`/`rollback.sh`。
  CI 里站点都是直连 8787 冒烟，Caddy 一次都没起过；安装、升级、回滚只在打包机上用模拟的 `systemctl` 跑过。第一次上真机时要逐项验。

## 打包

```sh
npm ci --ignore-scripts --prefix tools/deployer          # 钉死的 wrangler（读配置、白名单检查）
(cd packages/arcade-host && npm ci && npm run build)     # 运行时
tools/selfhost/pack-all.sh <产物目录>                     # 各模块 npm ci、构建、wrangler --dry-run 打包（不写名字就是 tools/workers.json 里全部）
tools/selfhost/release.sh <产物目录> <输出目录>           # → <输出目录>/arcade-<版本>.tar.gz
```

`release.sh` 后面可以接 `build.mjs` 的参数：`--only arcade,texas`（只要这几个，必须带平台）、`--db pg`、`--storage memory`（见上面的表）。

| 文件 | 做什么 |
|---|---|
| `build.mjs` | 站点描述 → 发布目录。规则和 `tools/deployer/deploy.mjs` 一样：`checkSourceConfig` 白名单检查、`platformOverlay` 叠加 `ARCADE`/`WALLET` 和 `GATE=login`、游戏路由 `/games/<id>` 和 `/games/<id>/*`；`SITE_ORIGIN` 和平台的 Secret 运行时从环境变量取 |
| `pack-all.sh` | 各模块打成部署作业收的那种产物 |
| `release.sh` | 发布目录 + `bin/workerd`（`packages/arcade-host` 钉死的版本）+ `bin/arcade` 启动脚本 + `ops/` 运维脚本 → tar.gz |
| `arcade.sh` | 发布包里的 `bin/arcade`：在发布目录里起 workerd；管理入口不是回环地址、PG 档没设 `ARCADE_PG_URL` 都拒绝启动 |
| `smoke.mjs` | 全站冒烟（不用浏览器）：静态和路由、建号登录、德州单机带入结回、好友房 WebSocket、定时任务、导出；`--save`/`--rejoin` 测重启后回到同一个房间 |
| `backup.sh`、`restore.sh`、`restore-drill.sh` | 逻辑备份（每个 SQLite 库导出 SQL + 房间目录快照；PG 的库跳过）、恢复、恢复演练（临时端口起同一个发布包，导入再导出必须逐字节一样） |
| `install.sh`、`upgrade.sh`、`rollback.sh` | 第一次安装、升级（先备份、换软链接、等健康检查，起不来自动切回）、回滚 |
| `systemd/arcade.service` | systemd 单元（只听 127.0.0.1、只能写数据目录） |
| `Caddyfile` | HTTPS、用真实地址覆盖 `cf-connecting-ip`、挡 `/cdn-cgi` |
| `docker/Dockerfile`、`docker/compose.yaml` | 镜像（上下文是发布目录）和 arcade + caddy 的 compose，postgres 在 profile pg 里 |
| `pg/migrations/` | 平台迁移的 PG 版（文件名一一对应；文本列一律 `COLLATE "C"`，和 SQLite 一样按字节比较、排序） |
| `pg/overrides.json` | 覆盖表：机械翻译翻不了的平台语句的 PG 版，每条带为什么和对照参数 |
| `pg/check-sql.mjs` | 语句覆盖检查：平台每条 SQL 都在 PG 上 PREPARE，覆盖表和 SQLite 灌同样的数据（`pg/fixture.sql`）对照结果 |
| `pg/verify-import.mjs` | SQLite → PG 迁移后逐表逐行核对，外加钱包筹码合计 |

## 二进制部署（systemd）

```sh
tar -xzf arcade-<版本>.tar.gz
sudo arcade-<版本>/ops/install.sh arcade-<版本>.tar.gz game.example.com
```

- 目录：`/opt/arcade/releases/<版本>/` + `/opt/arcade/current` 软链接；数据 `/var/lib/arcade/data`；Secret `/etc/arcade/secrets.env`（root:arcade 640）。
- Secret：`install.sh` 第一次会生成 `SITE_ORIGIN`、`PEPPER_PW`、`PEPPER_RC`、`PEPPER_SID`、`PEPPER_IP`、`ADMIN_TOKEN`（格式 `<kid>:<随机串>`，见 `platform/.dev.vars.example`），只写文件不打印。
  pepper 用上之后不能丢（库里的哈希靠它），和备份分开另存一份。PG 档再往这个文件里加 `ARCADE_PG_URL`。
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

PG 档：本目录再放 `pg_password.txt`（数据库密码，一行），`secrets.env` 里加 `ARCADE_PG_URL=postgres://arcade:<同一个密码>@postgres:5432/arcade`，
然后 `docker compose --profile pg up -d`（arcade 等 postgres 健康了才起）。`secrets.env`、`pg_password.txt` 都在本目录的 `.gitignore` 里。

## PostgreSQL 模式

平台库（账号、钱包、榜单……）放进 PostgreSQL，平台代码一条 SQL 都不改：`packages/arcade-host` 的 D1 后端把 SQLite 方言机械翻译成 PG 的，
翻不了的走 `pg/overrides.json`。房间放哪见上面的表；PG 不落盘时，进程重启后第一次请求宿主按存着的闹钟把房间叫醒，打到一半的牌局接着打。

```sh
tools/selfhost/release.sh <产物目录> <输出目录> --db pg
ARCADE_PG_URL=postgres://arcade:…@127.0.0.1:5432/arcade ARCADE_DATA=/var/lib/arcade/data bin/arcade   # systemd 的话写进 EnvironmentFile
```

- 第一次起站自动建表（`pg/migrations/`，记在 PG 的 `d1_migrations` 表里）；房间的表（`arcade_kit_rows`、`arcade_kit_alarms`）也是自动建的。
  建库用什么区域设置都行：文本列都带了 `COLLATE "C"`。
- **从 SQLite 档迁过来**：旧站 `ops/backup.sh` 导出平台库 → 停旧站 → PG 档起站 → `ops/restore.sh d1-arcade-DB <备份里的 d1-arcade-DB.sql>`
  （整库替换，一个事务，回的 JSON 里有每张表的行数和数字列总和）→ 在打包的机器上 `node tools/selfhost/pg/verify-import.mjs <同一个 .sql> --pg <连接串>` 逐行核对 → 开站。
  房间（打到一半的牌局）不迁。
- **备份**：平台库（和不落盘时的房间）用 `pg_dump`，比如 Docker 里 `docker compose exec postgres pg_dump -U arcade arcade > arcade.sql`；`backup.sh` 遇到 PG 的库会跳过。
- **平台改了 SQL**：`selfhost.yml` 的 pg 作业会跑 `pg/check-sql.mjs`（它只报警，不挡平台部署）。新语句机械翻译不了（json 函数、`SUM(布尔)`、
  `ON CONFLICT DO UPDATE` 里不带表名的列、推不出类型的参数……），就在 `overrides.json` 加一条 PG 版和对照参数（写语句再加 `after`：跑完查哪张表），
  本地 `node tools/selfhost/pg/check-sql.mjs`（PGlite）或 `--pg <测试库>` 跑通。收 JSON 字符串的参数写 `$N::text::json`（postgres.js 的坑，只有 `--pg` 走真连接才查得出）。
  平台加了迁移，`pg/migrations/` 跟着加同名的 PG 版。

## 验证（CI：`.github/workflows/selfhost.yml`）

只测不部署，不碰线上，Secret 和数据库密码都是这次运行临时生成的。平台、德州、`packages/arcade-host`、本目录改了都会跑。

| 作业 | 做什么 |
|---|---|
| binary | 打平台和德州 → SQLite 档发布包 → 二进制起站：冒烟、备份、恢复演练；管理入口听 0.0.0.0 时必须起不来 |
| docker | 同一个包做成镜像起容器：冒烟、容器里跑定时任务和备份、重启容器后数据还在；compose 文件能解析 |
| pg | postgres:17（en_US 排序，故意不用 C）：语句覆盖检查 → SQLite 档冒烟、备份 → PG 档冒烟 → 备份迁进 PG、逐行核对 → 再冒烟 → PG 不落盘档冒烟、重启、两人回到同一个房间 |
| docker-pg | PG 不落盘包做成镜像，`compose --profile pg` 起 arcade + postgres：冒烟 → 重启 arcade 容器后回到同一个房间 → 容器里跑定时任务和备份 |

德州的 kit 不到 0.21.0 时，pg 作业在自己的工作区里临时把它换成 0.21.0 再打包（不提交）；德州升级后这一步什么都不做。
