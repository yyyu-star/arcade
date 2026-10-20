# 更新日志

## 0.1.0（2026-10-20）

第一版（自托管阶段 0、1 的运行时和生成器）：
- 运行时：D1 的 SQLite 后端（DO + `ctx.storage.sql`，事务、迁移、导出导入）、静态资源（照 Cloudflare 的规则，和 wrangler dev 逐条对照）、路由、定时任务（DO 闹钟）、内部管理入口；
- 生成器：站点描述 → workerd 配置和发布目录，存储可选 sqlite（落盘）或 memory；
- 阶段 0 实测结论 `docs/verify.md`：平台 + 德州原样跑通；cron 要 `--experimental`；内存存储没有 SQL，PostgreSQL 模式的房间存储要 kit 的持久化接口整个包住 sql。
