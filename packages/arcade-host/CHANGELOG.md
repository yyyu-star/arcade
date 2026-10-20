# 更新日志

## 0.3.0（2026-10-20）

PostgreSQL 模式（阶段 5 的宿主侧，v2.1：和 SQLite 二选一）：
- `db: 'pg'`：D1 后端换成 PostgreSQL（`runtime/d1pg.ts`，postgres.js，连接池在 DO 里）；SQLite 方言机械翻译（`sql-translate.ts`）+ 站点给的覆盖表，翻不了又没覆盖的报错不猜；报错还原成 SQLite 原文；
  PG 版迁移和 SQLite 版一一对应（生成时检查）；`/d1/<库>/import` 收 SQLite 导出做数据迁移（核对行数和数字列总和）；
- `db: 'pg'` + `storage: 'memory'`：给有 DO 的 Worker 注入 `KIT_STORE`（`runtime/kitstore.ts`，按 props.game 隔开游戏，接口和 kit 持有者定的一样），重启后唤醒存了闹钟的对象；
- 只给连 PG 的 Worker 放开内网出站（`pg-network`）；`storage: 'memory'` 配 SQLite 版 D1 时生成器报错（平台库会丢）；
- 测试：本机用 PGlite，CI 新增 test-pg 作业连真的 postgres:17。

## 0.2.1（2026-10-20）

- **恢复（`/d1/<库>/import`）修好跨行的建表语句**：0.1.0 起按"一行一条语句"执行导出文件，可建表语句是 `sqlite_schema` 里的原文，平台的迁移跨行、带注释，
  真站的备份导入直接报 `incomplete input`（tools/selfhost 的恢复演练发现）。现在整个文件交给 SQLite 执行（同一个事务，失败原样不动）；测试的迁移也改成跨行带注释的。

## 0.2.0（2026-10-20）

- **定时任务不再要 `workerd --experimental`**（主线 10-20）：去掉单独的 cron Worker 和实验开关 `service_binding_extra_handlers`；有 crons 的 Worker 的主模块换成包装入口 `cron-entry`（原样转出模块的全部导出），
  多一个 DO 类 `ArcadeHostCron`，闹钟到点在同一个 Worker 里实例化默认入口调 `scheduled`（类写法、对象写法都支持，`ctx.waitUntil` 等完）。服务绑定照旧 RPC 调不到 `scheduled`（测试锁住）。
  存储键从 `arcade-host-cron` 换成 `<Worker 名>-ArcadeHostCron`（还没有正式部署，不用搬数据）。
- **管理入口只许回环地址**：生成器的 `adminListen` 不是 127.x / localhost / [::1] 直接报错。

## 0.1.0（2026-10-20）

第一版（自托管阶段 0、1 的运行时和生成器）：
- 运行时：D1 的 SQLite 后端（DO + `ctx.storage.sql`，事务、迁移、导出导入）、静态资源（照 Cloudflare 的规则，和 wrangler dev 逐条对照）、路由、定时任务（DO 闹钟）、内部管理入口；
- 生成器：站点描述 → workerd 配置和发布目录，存储可选 sqlite（落盘）或 memory；
- 阶段 0 实测结论 `docs/verify.md`：平台 + 德州原样跑通；cron 要 `--experimental`；内存存储没有 SQL，PostgreSQL 模式的房间存储要 kit 的持久化接口整个包住 sql。
