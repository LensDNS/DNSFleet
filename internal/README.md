# internal

私有应用代码包（不可被外部仓库 `import`）。

里程碑与包边界以维护者本机 `docs/`（不随远程克隆）为准。

后续 Step 建议子包命名（可按实现微调）：

- `internal/models` — GORM 领域模型
- `internal/db` — 数据库连接与迁移
- `internal/adguard` — AdGuard Home HTTP 客户端（Step 2）
- `internal/http` 或 `internal/server` — Echo/Fiber 路由与中间件（Step 3）
- `internal/stream` — 日志 WebSocket 聚合（Step 4）
