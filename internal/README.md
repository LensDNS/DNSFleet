# internal

私有应用代码包（不可被外部仓库 `import`）。

里程碑与包边界以维护者本机 `docs/`（不随远程克隆）为准。

## 已建脚手架（Step 1.1）

- `internal/models` — GORM 领域模型（当前仅 `doc.go`；实体在 Step 1.3）
- `internal/db` — 数据库连接与迁移（当前仅 `doc.go`；实现在 Step 1.4）

## Step 1.2

- `internal/config` — 环境变量与默认值（`DNSFLEET_DB_PATH`、`DNSFLEET_HTTP_ADDR`）；启动时创建 SQLite 父目录；不含 Admin Token（Step 3）

## 后续 Step 预告

- `internal/adguard` — AdGuard Home HTTP 客户端（Step 2）
- `internal/http` 或 `internal/server` — Echo/Fiber 路由与中间件（Step 3）
- `internal/stream` — 日志 WebSocket 聚合（Step 4）
