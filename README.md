# DNSFleet

**Unified Control Plane for AdGuard Home Fleets.**  
多节点 AdGuard Home 的统一控制面（v0.1 开发中）。

## 文档与协作说明

产品需求、开发路线图、AI 分步提示、审查提示及根目录 **`AGENTS.md`** 等 **仅存维护者本机**，**不**纳入本 Git 远程（见仓库根目录 `.gitignore` 说明）。克隆本仓库若需相同资料，请从维护者提供的私有渠道获取。

## 仓库布局（代码）

| 路径 | 说明 |
|------|------|
| `cmd/dnsfleet/` | Go 可执行入口 |
| `internal/` | 应用私有代码 |
| `api/` | 预留 API 契约 |
| `web/` | 预留前端工程 |
| `deploy/` | 预留容器与编排 |
| `scripts/` | 可选脚本 |

## Configuration

进程通过环境变量配置（开发时可复制 [`.env.example`](.env.example) 为 `.env` 并自行导出；当前实现使用 `os.Getenv`，不自动加载 `.env` 文件）。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DNSFLEET_DB_PATH` | `./data/dnsfleet.db` | SQLite **数据库文件**路径（环境变量可为相对路径；`config.Load` 会解析为**绝对路径**再交给后续 Open，避免工作目录变化导致找不到库）；不支持 `:memory:` / `file::memory:`；父目录在 `Load` 时创建 |
| `DNSFLEET_HTTP_ADDR` | `:8080` | HTTP 监听地址（Echo 监听该地址） |

## Run（Step 1.5）

最小进程：`go run ./cmd/dnsfleet`（或 `go build -o bin/dnsfleet ./cmd/dnsfleet` 后运行二进制）。启动时会初始化 SQLite 并执行 GORM `AutoMigrate`，然后监听 HTTP。**健康检查**：`GET /healthz` → `200`，响应体纯文本 `ok`。

## 状态

Step 1.5 已提供可运行入口与健康检查；业务 API（节点/全局配置等）按路线图后续 Step 推进。

## 许可证

待定；确定后于本仓库根目录添加 `LICENSE`。
